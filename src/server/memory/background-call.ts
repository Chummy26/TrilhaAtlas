import { normalizeContext, type Message } from "@earendil-works/pi-ai";
import { PATHS } from "../../../config.ts";
import { piEngineForSpec, type PiEngine } from "../../agent/models.ts";
import { connectionBackgroundAllowed, isSubscriptionProvider } from "../../agent/subscription-connections.ts";
import { usageWasAdmitted } from "../../agent/subscription-request-cycle.ts";
import { workerRequestStream } from "../../agent/worker-request-admission.ts";
import { CLAUDE_CODE_PROVIDER } from "../../core/contracts/claude-code.ts";
import { estimateTokens } from "../../core/memory/tokens.ts";
import { resolveRoleSpec } from "../../core/settings-resolution.ts";
import { BACKGROUND_MODEL_ROLES } from "../../core/settings.ts";
import { dayKey } from "../../core/stats/dates.ts";
import { createDomainsStore } from "../../store/domains-store.ts";
import { createStatsStore } from "../../store/stats-store.ts";
import { providerKeyPresent } from "../keys.ts";
import { refreshConnectionCatalog } from "../model-catalog.ts";
import { stores } from "../stores.ts";
import { chatStepUsage, observeEngineUsage } from "../study-usage.ts";
import type { MemoryLlmCall, MemoryLlmRequest } from "./extractor.ts";

// All Next bundles share reservations. Count in-flight work against today's
// allowance even across midnight: usage is recorded on completion.
const budgetKey = Symbol.for("learnharness.memory.background-budget");
interface BudgetState {
	pending: Map<string, number>;
	unlogged: Map<string, { day: string; tokens: number }>;
}
const shared = globalThis as typeof globalThis & { [budgetKey]?: BudgetState };
const budget = shared[budgetKey] ??= { pending: new Map(), unlogged: new Map() };
const legacyBackground = new Set<string>([...BACKGROUND_MODEL_ROLES.filter(role => role !== "sideQuestion"), "compaction"]);

function dailyAllowance(domain: string): number {
	const limits = createDomainsStore(PATHS.data).readManifest(domain)?.backgroundBudget;
	if (!limits?.enabled) throw new Error("Memória em segundo plano desativada neste domínio.");
	const start = new Date();
	start.setHours(0, 0, 0, 0);
	const end = new Date(start);
	end.setDate(start.getDate() + 1);
	const saved = createStatsStore(PATHS.data).readUsage({ from: start.toISOString(), to: end.toISOString() }, { domain });
	let used = 0;
	for (const event of saved.events) {
		if (!(event.background ?? legacyBackground.has(event.op))) continue;
		used += event.budgetEstimateTokens ?? (event.inputTokens + event.outputTokens + event.cachedTokens + (event.cacheWriteTokens ?? 0));
	}
	const unlogged = budget.unlogged.get(domain);
	if (unlogged?.day === localDay()) used += unlogged.tokens;
	return limits.tokensPerDay - used - (budget.pending.get(domain) ?? 0);
}

function localDay(): string {
	return dayKey(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone);
}

function rememberUnloggedUsage(domain: string, tokens: number) {
	const day = localDay();
	const previous = budget.unlogged.get(domain);
	budget.unlogged.set(domain, { day, tokens: tokens + (previous?.day === day ? previous.tokens : 0) });
}

function requestContext(request: MemoryLlmRequest | ExpansionRequest, engine: PiEngine) {
	const timestamp = Date.now();
	const messages = request.messages.map((turn): Message => {
		if (turn.role === "user") return { role: "user", content: turn.content, timestamp };
		return {
			role: "assistant", api: engine.model.api, model: engine.model.id, provider: engine.model.provider,
			content: [{ type: "text", text: turn.content }], stopReason: "stop", timestamp,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		};
	});
	return normalizeContext({ systemPrompt: request.system, messages });
}

/** Until the role registry is integrated, the memory judge uses the auditor
 * override; all other memory roles use the extractor override and cheap slot. */
export function domainMemoryLlmCall(domain: string, engineFor: typeof piEngineForSpec = piEngineForSpec): MemoryLlmCall {
	return domainBackgroundCall(domain, engineFor);
}

type ExpansionRequest = Omit<MemoryLlmRequest, "role" | "op"> & { role: "curriculum"; op: "reinforce" };

export function domainBackgroundCall(domain: string, engineFor: typeof piEngineForSpec = piEngineForSpec) {
	return async (request: MemoryLlmRequest | ExpansionRequest) => {
		if (dailyAllowance(domain) <= 0) throw new Error("Orçamento diário de memória esgotado.");
		const settings = stores.settingsStore.readSettings();
		const role = request.role === "curriculum" ? "researcher" : request.role === "judge" ? "auditor" : "extractor";
		const spec = resolveRoleSpec(role, settings) ?? resolveRoleSpec("extractor", settings);
		if (!spec) throw new Error("Configure um modelo para a extração de memória.");
		if (spec.provider === CLAUDE_CODE_PROVIDER || !connectionBackgroundAllowed(spec.provider)) {
			throw new Error("O provedor selecionado não permite memória em segundo plano.");
		}
		if (isSubscriptionProvider(spec.provider)) await refreshConnectionCatalog(spec.provider);
		if (!providerKeyPresent(spec.provider)) throw new Error("A conexão do modelo de memória está indisponível.");
		const engine = engineFor(spec, true, undefined, () => stores.settingsStore.readSettings()?.models?.cheap?.cacheRetention);
		const context = requestContext(request, engine);
		const maxOutput = Math.min(request.maxOutputTokens, engine.model.maxTokens);
		const estimatedInput = estimateTokens(request.system) + request.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
		if (maxOutput <= 0 || estimatedInput + maxOutput > engine.model.contextWindow) throw new Error("O pedido de memória excede o contexto do modelo.");
		// ChatGPT strips max_output_tokens. Pi's Anthropic and Bedrock adapters
		// can add a separate thinking allowance even with an explicit maxTokens.
		const expandedThinking = engine.level && engine.level !== "off"
			&& (engine.model.api === "anthropic-messages" || engine.model.api === "bedrock-converse-stream");
		const outputCeiling = spec.provider === "chatgpt" || expandedThinking ? engine.model.maxTokens : maxOutput;
		// UTF-8 bytes include the envelopes and conservatively cover input
		// tokenization. At settlement the ledger uses reported, disjoint buckets.
		const reserved = Buffer.byteLength(JSON.stringify(context.messages)) + outputCeiling;
		const observed = observeEngineUsage(engine, (request.role === "curriculum" ? "curriculum." : "memory.") + request.op, { domain, background: true, reservedTokens: reserved });
		let admitted = false;
		function release() {
			if (!admitted) return;
			admitted = false;
			const remaining = (budget.pending.get(domain) ?? 0) - reserved;
			if (remaining > 0) budget.pending.set(domain, remaining);
			else budget.pending.delete(domain);
		}
		const stream = workerRequestStream((model, ctx, opts) => {
			// Consent and allowance may change while waiting for a worker permit.
			if (!connectionBackgroundAllowed(spec.provider)) throw new Error("Uso em segundo plano desativado no provedor.");
			if (dailyAllowance(domain) < reserved) throw new Error("Orçamento diário de memória insuficiente.");
			budget.pending.set(domain, (budget.pending.get(domain) ?? 0) + reserved);
			admitted = true;
			const source = observed.streamFn(model, ctx, opts);
			// The observer writes first. Release the reservation before the worker
			// pool wakes the next request, so it sees only the settled charge.
			void source.result().then(reply => {
				const usage = reply.usage;
				const total = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
				if (usageWasAdmitted(usage) && !chatStepUsage(usage).recordedInStats && (total > 0 || reply.stopReason !== "aborted")) {
					rememberUnloggedUsage(domain, total || reserved);
				}
				release();
			}, release);
			return source;
		});
		try {
			const reply = await stream(engine.model, context, { maxTokens: maxOutput, maxRetries: 0, sessionId: (request.role === "curriculum" ? "curriculum-" : "memory-") + domain }).result();
			const usage = reply.usage;
			if (reply.stopReason !== "stop") throw new Error(reply.errorMessage ?? "Resposta de memória incompleta.");
			return {
				text: reply.content.flatMap(block => block.type === "text" ? [block.text] : []).join(""),
				modelId: spec.provider + ":" + spec.id, inputTokens: usage.input, outputTokens: usage.output,
				cachedTokens: usage.cacheRead + usage.cacheWrite,
			};
		} finally {
			release();
		}
	};
}
