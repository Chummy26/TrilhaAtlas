import type { Usage } from "@earendil-works/pi-ai";
import { PATHS, activeDomainId } from "../../config.ts";
import { piEngineForSpec, type PiEngine } from "../agent/models.ts";
import { isSubscriptionProvider } from "../agent/subscription-connections.ts";
import { usageWasAdmitted } from "../agent/subscription-request-cycle.ts";
import type { CallUsage } from "../core/contracts/chat.ts";
import { CLAUDE_CODE_PROVIDER } from "../core/contracts/claude-code.ts";
import { CUSTOM_PROVIDER } from "../core/auth-keys.ts";
import { usageEventFromCall } from "../core/stats/events.ts";
import { WORKSPACE_SCOPE } from "../core/stats/types.ts";
import { createStatsStore } from "../store/stats-store.ts";

const usageKey = Symbol.for("learnharness.recordedStatsUsage");
const shared = globalThis as typeof globalThis & { [usageKey]?: WeakSet<Usage> };
const recorded = shared[usageKey] ??= new WeakSet<Usage>();

/** Chat records keep their existing counters for per-turn UI and pricing. */
export function chatStepUsage(usage: Usage): CallUsage {
	return {
		inputTokens: usage.input,
		outputTokens: usage.output,
		cacheReadTokens: usage.cacheRead,
		cacheWriteTokens: usage.cacheWrite,
		cacheWrite1hTokens: usage.cacheWrite1h ?? 0,
		reasoningTokens: usage.reasoning ?? 0,
		...(recorded.has(usage) ? { recordedInStats: true } : {}),
	};
}

export function observeEngineUsage(engine: PiEngine, op: string, scope?: { domain?: string; background?: boolean | (() => boolean); reservedTokens?: number }): PiEngine {
	return {
		...engine,
		streamFn(model, context, options) {
			const domain = scope?.domain ?? activeDomainId() ?? WORKSPACE_SCOPE;
			const background = typeof scope?.background === "function" ? scope.background() : scope?.background;
			const started = Date.now();
			const stream = engine.streamFn(model, context, options);
			// Native provider streams settle result() independently of iteration.
			// Attach before the caller so its chat step can acknowledge the write.
			void stream.result().then(message => {
				const usage = message.usage;
				if (!usageWasAdmitted(usage)) return;
				const hasTokens = usage.totalTokens || usage.input || usage.output || usage.cacheRead || usage.cacheWrite || usage.reasoning;
				if (message.stopReason === "aborted" && !hasTokens) return;
				const provider = model.provider;
				const billing = isSubscriptionProvider(provider) ? "subscription"
					: provider === CLAUDE_CODE_PROVIDER || provider === CUSTOM_PROVIDER.id ? "unknown" : "api";
				const event = usageEventFromCall(chatStepUsage(usage), {
					at: new Date().toISOString(), domain, op, connection: provider, provider, model: model.id, billing,
					durationMs: message.durationMs ?? Date.now() - started,
					timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				});
				if (message.stopReason === "error" && !hasTokens) event.usageIncomplete = true;
				if (!hasTokens && scope?.reservedTokens !== undefined) {
					event.usageIncomplete = true;
					event.budgetEstimateTokens = scope.reservedTokens;
				}
				if (background !== undefined) event.background = background;
				createStatsStore(PATHS.data).appendUsage(event);
				recorded.add(usage);
			}).catch(error => console.error("[stats] could not record model usage", error));
			return stream;
		},
	};
}

export function studyEngineForSpec(op: string, ...args: Parameters<typeof piEngineForSpec>): PiEngine {
	return observeEngineUsage(piEngineForSpec(...args), op, { background: args[1] ?? true });
}
