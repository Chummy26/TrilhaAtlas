/**
 * zod schemas for the JSON the memory roles return (r4 §7.6.2 "Saída JSON,
 * validada com zod"; §7.9 roles extractor/judge/observer/consolidator).
 *
 * Tolerance policy (Hindsight retries when > 20 % of facts are malformed
 * [extra-vectorize-io__hindsight.md §5.1]): lists are parsed ELEMENT BY
 * ELEMENT — a malformed fact/episode/action is dropped and counted, the rest
 * survives. Common aliases are accepted (snake_case keys, `flashcardCandidates`,
 * lower-case verdicts). Mental-model ops are the exception: the batch is
 * atomic (ops.ts), so one malformed op invalidates all ops of the response.
 *
 * Pure: zod only.
 */

import { z } from "zod";
import type {
	ConsolidationOutput,
	DiaryOutput,
	EpisodeCandidate,
	EvidenceCandidate,
	ExtractionOutput,
	FactCandidate,
	FlashcardCandidate,
	JudgeOutput,
	MentalModelOp,
	ObservationAction,
	ObserveOutput,
	SupersedeVerdict,
} from "./types.ts";

const str = z.string();
const optStr = z.string().nullish();
const strList = z.array(z.string()).nullish().transform((v) => v ?? []);
const num01 = z.number().min(0).max(1);

/** Rename snake_case / alias keys before validation. */
function aliased(raw: unknown, aliases: Record<string, string>): unknown {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
	const out: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
	for (const [from, to] of Object.entries(aliases)) {
		if (from in out && !(to in out)) out[to] = out[from];
	}
	return out;
}

const episodeSchema = z.object({
	firstMsgId: str,
	lastMsgId: str,
	title: str,
	narrative: str,
	nodeIds: strList,
	importance: num01.nullish(),
});

/**
 * `type` is free text here on purpose: an unknown entity type (e.g. "formula")
 * must not drop a fact whose quote is grounded — extract.ts maps unknown
 * types to "concept".
 */
const entitySchema = z.object({
	name: str,
	type: z.string().nullish(),
});

const factSchema = z.object({
	kind: str,
	text: str,
	quote: str,
	sourceMsgIds: strList,
	nodeIds: strList,
	aboutNode: optStr,
	entities: z
		.array(z.union([entitySchema, z.string().transform((name) => ({ name }))]))
		.nullish()
		.transform((v) => v ?? []),
	validFrom: optStr,
	validTo: optStr,
	confidence: num01.nullish(),
	importance: num01.nullish(),
	scope: optStr,
	maybeSupersedes: optStr,
});

const evidenceSchema = z.object({
	nodes: z.array(z.object({ nodeId: str, q: z.number().gt(0).max(1).default(1), primary: z.boolean().nullish() })).min(1),
	grade: z.number().int().min(0).max(3),
	graderConfidence: num01.default(0.5),
	level: z.number().int().min(1).max(5).nullish(),
	quote: str,
	sourceMsgIds: strList,
	attributions: z
		.array(z.object({ nodeId: str, blame: num01, misconceptionId: optStr }))
		.nullish()
		.transform((v) => v ?? []),
});

const flashcardSchema = z.object({ front: str, back: str, nodeId: optStr, sourceMsgIds: strList });

const FACT_ALIASES = {
	source_msg_ids: "sourceMsgIds",
	node_ids: "nodeIds",
	about_node: "aboutNode",
	valid_from: "validFrom",
	valid_to: "validTo",
	maybe_supersedes: "maybeSupersedes",
};
const EPISODE_ALIASES = { first_msg_id: "firstMsgId", last_msg_id: "lastMsgId", node_ids: "nodeIds" };
const EVIDENCE_ALIASES = { grader_confidence: "graderConfidence", source_msg_ids: "sourceMsgIds" };
const FLASHCARD_ALIASES = { node_id: "nodeId", source_msg_ids: "sourceMsgIds" };

function parseList<T>(raw: unknown, schema: z.ZodType<T>, aliases: Record<string, string>): { items: T[]; dropped: number } {
	if (raw === undefined || raw === null) return { items: [], dropped: 0 };
	if (!Array.isArray(raw)) return { items: [], dropped: 1 };
	const items: T[] = [];
	let dropped = 0;
	for (const el of raw) {
		const parsed = schema.safeParse(aliased(el, aliases));
		if (parsed.success) items.push(parsed.data);
		else dropped += 1;
	}
	return { items, dropped };
}

function stripNullish<T extends object>(o: T): T {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined) out[k] = v;
	return out as T;
}

export interface ParsedLlmOutput<T> {
	output: T;
	/** Elements dropped because they failed their schema. */
	dropped: number;
	/** Elements seen (kept + dropped). */
	total: number;
}

export function parseExtractionOutput(raw: unknown): ParsedLlmOutput<ExtractionOutput> {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TypeError("saída do extrator não é um objeto JSON");
	const o = raw as Record<string, unknown>;
	const episodes = parseList(o.episodes, episodeSchema, EPISODE_ALIASES);
	const facts = parseList(o.facts, factSchema, FACT_ALIASES);
	const evidence = parseList(o.evidence, evidenceSchema, EVIDENCE_ALIASES);
	const cards = parseList(o.flashcards ?? o.flashcardCandidates ?? o.flashcard_candidates, flashcardSchema, FLASHCARD_ALIASES);
	const output: ExtractionOutput = {
		episodes: episodes.items.map((e) => stripNullish(e) as EpisodeCandidate),
		facts: facts.items.map((f) => stripNullish(f) as FactCandidate),
		evidence: evidence.items.map((e) => stripNullish(e) as EvidenceCandidate),
		flashcards: cards.items.map((c) => stripNullish(c) as FlashcardCandidate),
	};
	const dropped = episodes.dropped + facts.dropped + evidence.dropped + cards.dropped;
	const total = dropped + output.episodes.length + output.facts.length + output.evidence.length + output.flashcards.length;
	return { output, dropped, total };
}

const verdictSchema = z
	.string()
	.transform((v) => v.trim().toUpperCase())
	.pipe(z.enum(["DUPLICATE", "UPDATES", "CONTRADICTS", "REFINES", "INDEPENDENT"]));

const judgeItemSchema = z.object({ pairId: str, verdict: verdictSchema });

export function parseJudgeOutput(raw: unknown): ParsedLlmOutput<JudgeOutput> {
	const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? (raw as Record<string, unknown>).verdicts : undefined;
	const parsed = parseList(list, judgeItemSchema, { pair_id: "pairId" });
	return {
		output: { verdicts: parsed.items.map((v) => ({ pairId: v.pairId, verdict: v.verdict as SupersedeVerdict })) },
		dropped: parsed.dropped,
		total: parsed.dropped + parsed.items.length,
	};
}

export function parseObserveOutput(raw: unknown): ParsedLlmOutput<ObserveOutput> {
	const log = typeof raw === "string" ? raw : raw && typeof raw === "object" ? (raw as Record<string, unknown>).log : undefined;
	if (typeof log !== "string" || log.trim() === "") throw new TypeError("saída do observador sem campo 'log'");
	return { output: { log: log.trim() }, dropped: 0, total: 1 };
}

const subjectType = z.enum(["node", "learner", "entity"]);
const evidenceIds = z.array(z.string()).min(1);
const observationActionSchema = z.discriminatedUnion("op", [
	z.object({ op: z.literal("create"), subjectType, subjectId: str, text: str, evidenceFactIds: evidenceIds }),
	z.object({ op: z.literal("repeat"), observationId: str, evidenceFactIds: evidenceIds }),
	z.object({ op: z.literal("change"), observationId: str, text: str, evidenceFactIds: evidenceIds }),
	z.object({ op: z.literal("end"), observationId: str, evidenceFactIds: evidenceIds }),
]);

const mentalOpSchema = z.discriminatedUnion("op", [
	z.object({ op: z.literal("add"), section: str, text: str, refs: z.array(z.string()) }),
	z.object({ op: z.literal("edit"), targetId: str, newText: str, newRefs: z.array(z.string()) }),
	z.object({ op: z.literal("delete"), targetId: str, reason: z.enum(["contradicted", "superseded", "stale", "low-signal"]) }),
]);

export interface ParsedConsolidation extends ParsedLlmOutput<ConsolidationOutput> {
	/** Mental-model ops failed schema validation: the whole batch is rejected. */
	opsRejected: boolean;
}

export function parseConsolidationOutput(raw: unknown): ParsedConsolidation {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TypeError("saída do consolidador não é um objeto JSON");
	const o = raw as Record<string, unknown>;
	const actions = parseList(o.observations, observationActionSchema, {
		subject_type: "subjectType",
		subject_id: "subjectId",
		observation_id: "observationId",
		evidence_fact_ids: "evidenceFactIds",
	});
	const opsRaw = o.mentalModelOps ?? o.mental_model_ops ?? [];
	const ops = z.array(mentalOpSchema).safeParse(
		Array.isArray(opsRaw)
			? opsRaw.map((op) => aliased(op, { target_id: "targetId", new_text: "newText", new_refs: "newRefs" }))
			: opsRaw,
	);
	return {
		output: { observations: actions.items as ObservationAction[], mentalModelOps: ops.success ? (ops.data as MentalModelOp[]) : [] },
		dropped: actions.dropped,
		total: actions.dropped + actions.items.length,
		opsRejected: !ops.success,
	};
}

const diarySchema = z.object({ mission: optStr, summary: str.min(1), nextFocus: str.min(1) });

export function parseDiaryOutput(raw: unknown): ParsedLlmOutput<DiaryOutput> {
	const parsed = diarySchema.safeParse(aliased(raw, { next_focus: "nextFocus" }));
	if (!parsed.success) throw new TypeError(`diário inválido: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
	const d = parsed.data;
	return { output: { mission: d.mission ?? null, summary: d.summary.trim(), nextFocus: d.nextFocus.trim() }, dropped: 0, total: 1 };
}
