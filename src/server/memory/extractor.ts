/**
 * LLM-backed `Extractor` port for the memory store (r4 §7.6.2 extraction,
 * §7.6.2-4 supersession judge, §7.6.3 observer/reflector, §7.6.5 consolidation
 * + diary; §7.9 roles extractor/judge/observer/consolidator; SÍNTESE §2.9
 * "nenhum id de modelo hardcoded: toda chamada nomeia um PAPEL").
 *
 * The model call itself is injected (`call`): this module only builds the
 * prompts (src/agent/prompts/memory/*.md as system text, a JSON payload as the
 * user turn), parses the answer tolerantly (code fences, prose around the
 * JSON) and validates it with the core zod schemas. One corrective retry is
 * made when the answer is not JSON, fails its schema, drops > 20 % of its
 * elements (Hindsight's retry threshold) or carries an invalid mental-model op
 * batch; after the retry, unparseable output and invalid op batches throw
 * (`llm-output-invalid` / `ops-invalid`), partially valid lists are kept.
 * Grounding (quotes verbatim in the source) is NOT checked here: MemoryDb runs
 * core/memory/extract.ts on whatever this returns.
 */

import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../../config.ts";
import type { ModelRole } from "../../core/models/role-spec.ts";
import {
	parseConsolidationOutput,
	parseDiaryOutput,
	parseExtractionOutput,
	parseJudgeOutput,
	parseObserveOutput,
	type ParsedLlmOutput,
} from "../../core/memory/schemas.ts";
import {
	FACT_KINDS,
	MENTAL_MODEL_SECTIONS,
	MemoryError,
	type ConsolidationInput,
	type ConsolidationOutput,
	type DiaryInput,
	type DiaryOutput,
	type ExtractionInput,
	type ExtractionOutput,
	type Extractor,
	type JudgeInput,
	type JudgeOutput,
	type LlmUsage,
	type ObserveInput,
	type ObserveOutput,
	type SourceMessage,
} from "../../core/memory/types.ts";

export const MEMORY_PROMPTS_DIR = path.join(PATHS.root, "src", "agent", "prompts", "memory");

export type MemoryOp = "extract" | "judge" | "observe" | "consolidate" | "diary";

export const MEMORY_PROMPT_FILES: Readonly<Record<MemoryOp, string>> = Object.freeze({
	extract: "extract.md",
	judge: "supersede-judge.md",
	observe: "observe.md",
	consolidate: "consolidate.md",
	diary: "diary.md",
});

/** Model role per operation (core/models/role-spec.ts). The diary is written by the consolidator. */
export const MEMORY_OP_ROLES: Readonly<Record<MemoryOp, Extract<ModelRole, "extractor" | "judge" | "observer" | "consolidator">>> = Object.freeze({
	extract: "extractor",
	judge: "judge",
	observe: "observer",
	consolidate: "consolidator",
	diary: "consolidator",
});

const MAX_OUTPUT_TOKENS: Readonly<Record<MemoryOp, number>> = Object.freeze({
	extract: 4000,
	judge: 1200,
	observe: 4000,
	consolidate: 3000,
	diary: 800,
});

/** Fraction of malformed elements above which the answer is retried once. */
export const RETRY_DROP_RATIO = 0.2;

export interface MemoryLlmMessage {
	role: "user" | "assistant";
	content: string;
}

export interface MemoryLlmRequest {
	role: Extract<ModelRole, "extractor" | "judge" | "observer" | "consolidator">;
	op: MemoryOp;
	system: string;
	/** Conversation: the payload, and on a retry the previous answer + the correction. */
	messages: MemoryLlmMessage[];
	maxOutputTokens: number;
	/** The caller should ask the provider for a JSON object when it supports it. */
	json: true;
}

export interface MemoryLlmResponse {
	text: string;
	modelId?: string;
	inputTokens?: number;
	outputTokens?: number;
	cachedTokens?: number;
}

export type MemoryLlmCall = (request: MemoryLlmRequest) => Promise<MemoryLlmResponse>;

export interface LlmExtractorOptions {
	call: MemoryLlmCall;
	/** Folder with the memory prompts (default src/agent/prompts/memory). */
	promptsDir?: string;
	/** Leave an operation out to disable it (e.g. no observer). Default: all five. */
	ops?: readonly MemoryOp[];
	clock?: () => number;
}

// ─── JSON recovery ──────────────────────────────────────────────────────────

/** Parse the JSON value in a model answer: bare, fenced (```json), or surrounded by prose. */
export function extractJson(text: string): unknown {
	const trimmed = text.trim();
	const candidates: string[] = [];
	const fence = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/g;
	for (const m of trimmed.matchAll(fence)) if (m[1]) candidates.push(m[1].trim());
	candidates.push(trimmed);
	const firstObj = trimmed.indexOf("{");
	const lastObj = trimmed.lastIndexOf("}");
	if (firstObj >= 0 && lastObj > firstObj) candidates.push(trimmed.slice(firstObj, lastObj + 1));
	const firstArr = trimmed.indexOf("[");
	const lastArr = trimmed.lastIndexOf("]");
	if (firstArr >= 0 && lastArr > firstArr) candidates.push(trimmed.slice(firstArr, lastArr + 1));
	for (const c of candidates) {
		try {
			return JSON.parse(c);
		} catch {
			// try the next candidate
		}
	}
	throw new MemoryError("llm-output-invalid", `resposta do modelo sem JSON válido: ${JSON.stringify(trimmed.slice(0, 200))}`);
}

// ─── payloads ───────────────────────────────────────────────────────────────

function iso(ms: number | null | undefined): string | null {
	return typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function messagesPayload(messages: readonly SourceMessage[]): object[] {
	return messages.map((m) => ({ id: m.id, seq: m.seq, role: m.role, at: iso(m.ts), nodeIds: m.nodeIds, text: m.text }));
}

function userTurn(title: string, payload: object): string {
	return `${title}\n\n\`\`\`json\n${JSON.stringify(payload, null, 1)}\n\`\`\`\n\nResponda SOMENTE com o objeto JSON pedido.`;
}

export function extractPayload(input: ExtractionInput): string {
	return userTurn("INPUT (extraction)", {
		domainId: input.domainId,
		sessionId: input.sessionId,
		now: iso(input.now),
		sessionStartedAt: iso(input.sessionStartedAt),
		focusNodes: input.focusNodes,
		factKinds: FACT_KINDS,
		messages: messagesPayload(input.messages),
	});
}

export function judgePayload(input: JudgeInput): string {
	return userTurn("INPUT (supersession pairs)", {
		now: iso(input.now),
		pairs: input.pairs.map((p) => ({
			pairId: p.pairId,
			newFact: { kind: p.newFact.kind, text: p.newFact.text, validFrom: iso(p.newFact.validFrom), recordedAt: iso(p.newFact.recordedAt) },
			oldFact: { kind: p.oldFact.kind, text: p.oldFact.text, validFrom: iso(p.oldFact.validFrom), recordedAt: iso(p.oldFact.recordedAt) },
		})),
	});
}

export function observePayload(input: ObserveInput): string {
	return userTurn(input.reflect ? "INPUT (observe + REFLECT: the log is over budget, reorganise it)" : "INPUT (observe)", {
		sessionId: input.sessionId,
		now: iso(input.now),
		reflect: input.reflect,
		currentLog: input.currentLog,
		messages: messagesPayload(input.messages),
	});
}

export function consolidatePayload(input: ConsolidationInput): string {
	return userTurn("INPUT (consolidation)", {
		domainId: input.domainId,
		now: iso(input.now),
		sections: input.sections.length > 0 ? input.sections : MENTAL_MODEL_SECTIONS,
		facts: input.facts.map((f) => ({ ...f, validFrom: iso(f.validFrom), recordedAt: iso(f.recordedAt) })),
		observations: input.observations.map((o) => ({ ...o, updatedAt: iso(o.updatedAt) })),
		mentalModel: input.mentalModel.map((e) => ({ id: e.id, section: e.section, text: e.text, refs: e.refs })),
		learner: input.learner,
	});
}

export function diaryPayload(input: DiaryInput): string {
	return userTurn("INPUT (session diary)", {
		domainId: input.domainId,
		sessionId: input.sessionId,
		now: iso(input.now),
		previous: input.previous ? { mission: input.previous.mission, summary: input.previous.summary, nextFocus: input.previous.nextFocus, at: iso(input.previous.createdAt) } : null,
		focusNodes: input.focusNodes,
		facts: input.facts,
		observationLog: input.observationLog,
		messages: messagesPayload(input.messages),
	});
}

// ─── extractor ──────────────────────────────────────────────────────────────

interface Attempt<T> {
	parsed: ParsedLlmOutput<T> & { opsRejected?: boolean };
	problem: string | null;
}

function problemOf<T>(parsed: ParsedLlmOutput<T> & { opsRejected?: boolean }): string | null {
	if (parsed.opsRejected) return "o lote mentalModelOps não segue o esquema (op/section/text/refs, targetId/newText/newRefs ou targetId/reason)";
	if (parsed.total > 0 && parsed.dropped / parsed.total > RETRY_DROP_RATIO) {
		return `${parsed.dropped} de ${parsed.total} elementos não seguem o esquema`;
	}
	return null;
}

export class LlmMemoryExtractor implements Extractor {
	private readonly callModel: MemoryLlmCall;
	private readonly promptsDir: string;
	private readonly clock: () => number;
	private readonly prompts = new Map<MemoryOp, string>();
	judge?: (input: JudgeInput) => Promise<JudgeOutput>;
	observe?: (input: ObserveInput) => Promise<ObserveOutput>;
	consolidate?: (input: ConsolidationInput) => Promise<ConsolidationOutput>;
	diary?: (input: DiaryInput) => Promise<DiaryOutput>;

	constructor(options: LlmExtractorOptions) {
		if (typeof options?.call !== "function") throw new MemoryError("invalid-input", "LlmMemoryExtractor precisa de uma função `call`");
		this.callModel = options.call;
		this.promptsDir = options.promptsDir ?? MEMORY_PROMPTS_DIR;
		this.clock = options.clock ?? Date.now;
		const ops = new Set<MemoryOp>(options.ops ?? ["extract", "judge", "observe", "consolidate", "diary"]);
		if (!ops.has("extract")) throw new MemoryError("invalid-input", "a operação 'extract' é obrigatória");
		if (ops.has("judge")) this.judge = (input) => this.run("judge", judgePayload(input), parseJudgeOutput);
		if (ops.has("observe")) this.observe = (input) => this.run("observe", observePayload(input), parseObserveOutput);
		if (ops.has("consolidate")) this.consolidate = (input) => this.run("consolidate", consolidatePayload(input), parseConsolidationOutput);
		if (ops.has("diary")) this.diary = (input) => this.run("diary", diaryPayload(input), parseDiaryOutput);
	}

	extract(input: ExtractionInput): Promise<ExtractionOutput> {
		return this.run("extract", extractPayload(input), parseExtractionOutput);
	}

	/** System prompt of an operation (read once from disk, then cached). */
	prompt(op: MemoryOp): string {
		let text = this.prompts.get(op);
		if (text === undefined) {
			const file = path.join(this.promptsDir, MEMORY_PROMPT_FILES[op]);
			try {
				// The leading <!-- header --> documents the file for humans; the model never sees it.
				text = fs.readFileSync(file, "utf8").replace(/^\s*<!--[\s\S]*?-->\s*/, "").trim();
			} catch (error) {
				throw new MemoryError("invalid-input", `prompt de memória ausente: ${file} (${error instanceof Error ? error.message : String(error)})`);
			}
			if (!text) throw new MemoryError("invalid-input", `prompt de memória vazio: ${file}`);
			this.prompts.set(op, text);
		}
		return text;
	}

	private async run<T extends { usage?: LlmUsage }>(
		op: MemoryOp,
		payload: string,
		parse: (raw: unknown) => ParsedLlmOutput<T> & { opsRejected?: boolean },
	): Promise<T> {
		const system = this.prompt(op);
		const messages: MemoryLlmMessage[] = [{ role: "user", content: payload }];
		const usage: LlmUsage = { op, modelId: "", inputTokens: 0, outputTokens: 0, cachedTokens: 0, ms: 0 };
		const attempt = async (): Promise<{ text: string; result: Attempt<T> | Error }> => {
			const t0 = this.clock();
			const res = await this.callModel({ role: MEMORY_OP_ROLES[op], op, system, messages: [...messages], maxOutputTokens: MAX_OUTPUT_TOKENS[op], json: true });
			usage.ms += Math.max(0, this.clock() - t0);
			usage.modelId = res.modelId ?? usage.modelId;
			usage.inputTokens += res.inputTokens ?? 0;
			usage.outputTokens += res.outputTokens ?? 0;
			usage.cachedTokens = (usage.cachedTokens ?? 0) + (res.cachedTokens ?? 0);
			const text = typeof res?.text === "string" ? res.text : "";
			try {
				const parsed = parse(extractJson(text));
				return { text, result: { parsed, problem: problemOf(parsed) } };
			} catch (error) {
				return { text, result: error instanceof Error ? error : new Error(String(error)) };
			}
		};

		const first = await attempt();
		if (!(first.result instanceof Error) && first.result.problem === null) return { ...first.result.parsed.output, usage };
		const reason = first.result instanceof Error ? first.result.message : first.result.problem;
		messages.push(
			{ role: "assistant", content: first.text || "(resposta vazia)" },
			{ role: "user", content: `Sua resposta anterior foi rejeitada: ${reason}. Responda de novo SOMENTE com o objeto JSON no formato pedido pelo sistema, sem texto fora dele.` },
		);
		const second = await attempt();
		if (second.result instanceof Error) {
			throw new MemoryError("llm-output-invalid", `${op}: saída inválida após nova tentativa (${second.result.message})`);
		}
		if (second.result.parsed.opsRejected) {
			throw new MemoryError("ops-invalid", `${op}: lote de ops do modelo mental inválido após nova tentativa`);
		}
		return { ...second.result.parsed.output, usage };
	}
}

export function createLlmExtractor(options: LlmExtractorOptions): LlmMemoryExtractor {
	return new LlmMemoryExtractor(options);
}
