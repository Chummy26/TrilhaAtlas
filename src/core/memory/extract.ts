/**
 * Deterministic validation + grounding of extractor output (r4 §7.6.2 step 0,
 * L12 — HaluMem shows hallucination is born at extraction/update; ThreadAtlas
 * checks every fact against its source passage; SÍNTESE §2.5 "Aterramento").
 *
 * GROUNDING RULE (strict, per the module task): a fact's `quote` MUST occur
 * verbatim in a source utterance of the batch, otherwise the fact is
 * DISCARDED. "Verbatim" is compared after the same normalisation the FTS
 * index uses (lowercase, no diacritics, unified quotes/dashes, collapsed
 * whitespace) — case/accents/spacing never decide grounding, words do. The
 * match is on WHOLE words (a quote cannot start or end inside a word). A
 * quote may elide with "..."/"…": every fragment (≥ 4 characters each) must
 * then appear, in order, in the same message. r4's fuzzy trigram ≥ 0.8 path
 * is deliberately NOT used to accept a quote (it would let paraphrases through).
 *
 * The quote is searched first in the declared `sourceMsgIds`; if the model
 * mis-cited, any batch message containing it is accepted and the fact is
 * re-attributed to it (`reattributed`). Facts about the learner's own voice
 * (learner, preference, goal, affect, misconception) must quote a USER
 * message — the tutor saying "você confundiu…" is not the learner's words.
 * Dialogue evidence follows the same rule and is capped at
 * graderConfidence ≤ 0.6 (r4: "aqui o peso é menor").
 */

import { canonicalEntity, foldText } from "./lexical.ts";
import {
	isFactKind,
	type DialogueEvidence,
	type EntityRef,
	type ExtractionOutput,
	type FactKind,
	type FactScope,
	type SourceMessage,
} from "./types.ts";

export const MIN_QUOTE_CHARS = 4;
export const MAX_FACT_CHARS = 600;
export const MAX_NARRATIVE_CHARS = 2400;
export const MAX_CARD_CHARS = 600;
export const MAX_DIALOGUE_CONFIDENCE = 0.6;
export const DEFAULT_FACT_CONFIDENCE = 0.7;
export const DEFAULT_IMPORTANCE = 0.5;

/** Kinds that describe the learner in the learner's own words. */
export const LEARNER_VOICE_KINDS: ReadonlySet<FactKind> = new Set<FactKind>(["learner", "preference", "goal", "affect", "misconception"]);

const ENTITY_TYPES = new Set(["concept", "person", "resource", "tool", "place", "org", "other"]);

export interface GroundedEntity {
	name: string;
	canonical: string;
	type: NonNullable<EntityRef["type"]>;
}

export interface GroundedFact {
	kind: FactKind;
	text: string;
	quote: string;
	sourceMsgIds: string[];
	nodeIds: string[];
	aboutNode: string | null;
	entities: GroundedEntity[];
	validFrom: number;
	validTo: number | null;
	confidence: number;
	importance: number;
	scope: FactScope;
	maybeSupersedes: string | null;
	reattributed: boolean;
}

export interface ValidEpisode {
	firstMsgId: string;
	lastMsgId: string;
	tStart: number;
	tEnd: number;
	title: string;
	narrative: string;
	nodeIds: string[];
	importance: number;
}

export interface ValidFlashcard {
	front: string;
	back: string;
	nodeId: string | null;
	sourceMsgIds: string[];
}

export type RejectedKind = "fact" | "episode" | "evidence" | "flashcard";

export interface Rejected {
	kind: RejectedKind;
	index: number;
	reason: string;
	text: string;
}

export interface ValidatedExtraction {
	facts: GroundedFact[];
	episodes: ValidEpisode[];
	evidence: DialogueEvidence[];
	flashcards: ValidFlashcard[];
	rejected: Rejected[];
}

export interface ExtractionContext {
	domainId: string;
	sessionId: string;
	messages: readonly SourceMessage[];
}

function collapse(s: string): string {
	return s.replace(/\s+/g, " ").trim();
}

/** Strip wrapping quote marks / ellipses a model tends to add around a quote. */
export function cleanQuote(quote: string): string {
	return quote
		.trim()
		.replace(/^["'“”‘’«»\s]+|["'“”‘’«»\s]+$/g, "")
		.replace(/^(?:\.\.\.|…)\s*|\s*(?:\.\.\.|…)$/g, "")
		.trim();
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

function isWordChar(ch: string | undefined): boolean {
	return ch !== undefined && WORD_CHAR.test(ch);
}

/**
 * First index ≥ `from` where `needle` occurs as WHOLE words: a needle that
 * starts (ends) with a letter/digit may not be preceded (followed) by one.
 * "ensao" therefore never matches inside "tensao".
 */
function indexOfWholeWords(hay: string, needle: string, from: number): number {
	const startsWord = isWordChar(needle[0]);
	const endsWord = isWordChar(needle[needle.length - 1]);
	for (let at = hay.indexOf(needle, from); at !== -1; at = hay.indexOf(needle, at + 1)) {
		const okStart = !startsWord || !isWordChar(hay[at - 1]);
		const okEnd = !endsWord || !isWordChar(hay[at + needle.length]);
		if (okStart && okEnd) return at;
	}
	return -1;
}

/**
 * True when the (cleaned, folded) quote occurs verbatim in the text, elisions
 * allowed. Every fragment must be a real excerpt: at least MIN_QUOTE_CHARS
 * characters with a letter or digit, aligned on word boundaries, in order.
 * (Without the per-fragment floor "o al ... no" would "ground" any sentence.)
 */
export function quoteOccursIn(quote: string, text: string): boolean {
	const fragments = foldText(cleanQuote(quote))
		.split(/\s*(?:\.\.\.|…)\s*/)
		.map((f) => f.trim())
		.filter((f) => f.length > 0);
	if (fragments.length === 0) return false;
	if (fragments.some((f) => f.length < MIN_QUOTE_CHARS || !WORD_CHAR.test(f))) return false;
	const hay = foldText(text);
	let from = 0;
	for (const fragment of fragments) {
		const at = indexOfWholeWords(hay, fragment, from);
		if (at === -1) return false;
		from = at + fragment.length;
	}
	return true;
}

export interface GroundingResult {
	grounded: boolean;
	sourceMsgIds: string[];
	reattributed: boolean;
}

/**
 * Find the messages that contain `quote`: the declared sources first, then
 * the whole batch. `roles` restricts which speakers may be quoted.
 */
export function groundQuote(
	quote: string,
	declared: readonly string[],
	messages: readonly SourceMessage[],
	roles?: ReadonlySet<SourceMessage["role"]>,
): GroundingResult {
	const allowed = roles ? messages.filter((m) => roles.has(m.role)) : messages;
	const declaredSet = new Set(declared);
	const declaredHits = allowed.filter((m) => declaredSet.has(m.id) && quoteOccursIn(quote, m.text)).map((m) => m.id);
	if (declaredHits.length > 0) return { grounded: true, sourceMsgIds: declaredHits, reattributed: false };
	const anyHits = allowed.filter((m) => quoteOccursIn(quote, m.text)).map((m) => m.id);
	if (anyHits.length > 0) return { grounded: true, sourceMsgIds: anyHits.slice(0, 3), reattributed: true };
	return { grounded: false, sourceMsgIds: [], reattributed: false };
}

function clamp01(x: unknown, fallback: number): number {
	return typeof x === "number" && Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : fallback;
}

function parseInstant(value: unknown): number | null {
	if (typeof value !== "string" || value.trim() === "") return null;
	const t = Date.parse(value);
	return Number.isFinite(t) ? t : null;
}

function cleanIds(ids: unknown): string[] {
	if (!Array.isArray(ids)) return [];
	return [...new Set(ids.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean))];
}

function cleanEntities(raw: unknown): GroundedEntity[] {
	if (!Array.isArray(raw)) return [];
	const out = new Map<string, GroundedEntity>();
	for (const e of raw) {
		const name = typeof e === "string" ? e : e && typeof e === "object" ? (e as { name?: unknown }).name : undefined;
		if (typeof name !== "string" || collapse(name) === "" || collapse(name).length > 120) continue;
		const typeRaw = e && typeof e === "object" ? (e as { type?: unknown }).type : undefined;
		const type = (typeof typeRaw === "string" && ENTITY_TYPES.has(typeRaw) ? typeRaw : "concept") as GroundedEntity["type"];
		const canonical = canonicalEntity(name);
		if (!canonical) continue;
		const key = `${canonical}|${type}`;
		if (!out.has(key)) out.set(key, { name: collapse(name), canonical, type });
	}
	return [...out.values()];
}

const USER_ONLY: ReadonlySet<SourceMessage["role"]> = new Set(["user"]);

/** Validate + ground one extraction batch. Pure; never throws on bad model output. */
export function validateExtraction(output: ExtractionOutput, ctx: ExtractionContext): ValidatedExtraction {
	const byId = new Map(ctx.messages.map((m) => [m.id, m]));
	const rejected: Rejected[] = [];
	const reject = (kind: RejectedKind, index: number, reason: string, text: string) => rejected.push({ kind, index, reason, text: text.slice(0, 200) });

	const facts: GroundedFact[] = [];
	(output.facts ?? []).forEach((f, index) => {
		const text = typeof f?.text === "string" ? collapse(f.text) : "";
		if (!text) return reject("fact", index, "texto vazio", "");
		if (text.length > MAX_FACT_CHARS) return reject("fact", index, `texto com mais de ${MAX_FACT_CHARS} caracteres`, text);
		if (!isFactKind(f.kind)) return reject("fact", index, `tipo inválido: ${String(f.kind)}`, text);
		const quote = typeof f.quote === "string" ? collapse(cleanQuote(f.quote)) : "";
		if (!quote) return reject("fact", index, "sem quote", text);
		const roles = LEARNER_VOICE_KINDS.has(f.kind) ? USER_ONLY : undefined;
		const g = groundQuote(quote, cleanIds(f.sourceMsgIds), ctx.messages, roles);
		if (!g.grounded) {
			const where = roles ? "em nenhuma fala do aluno" : "em nenhuma fala-fonte";
			return reject("fact", index, `quote não encontrado verbatim ${where}`, text);
		}
		const sources = g.sourceMsgIds.map((id) => byId.get(id)).filter((m): m is SourceMessage => !!m);
		const sourceTs = Math.min(...sources.map((m) => m.ts));
		const validFrom = parseInstant(f.validFrom) ?? sourceTs;
		let validTo = parseInstant(f.validTo);
		if (validTo !== null && validTo < validFrom) validTo = null;
		const sourceNodes = cleanIds(sources.flatMap(m => m.nodeIds));
		const nodeIds = sourceNodes.length ? sourceNodes : cleanIds(f.nodeIds);
		const proposed = typeof f.aboutNode === "string" ? f.aboutNode.trim() : "";
		const aboutNode = proposed && (!sourceNodes.length || sourceNodes.includes(proposed)) ? proposed : (nodeIds[0] ?? null);
		if (aboutNode && !nodeIds.includes(aboutNode)) nodeIds.unshift(aboutNode);
		const scope: FactScope = f.scope === "global" || f.scope === "session" ? f.scope : "domain";
		facts.push({
			kind: f.kind,
			text,
			quote,
			sourceMsgIds: g.sourceMsgIds,
			nodeIds,
			aboutNode,
			entities: cleanEntities(f.entities),
			validFrom,
			validTo,
			confidence: clamp01(f.confidence, DEFAULT_FACT_CONFIDENCE),
			importance: clamp01(f.importance, DEFAULT_IMPORTANCE),
			scope,
			maybeSupersedes: typeof f.maybeSupersedes === "string" && f.maybeSupersedes.trim() ? collapse(f.maybeSupersedes) : null,
			reattributed: g.reattributed,
		});
	});

	const episodes: ValidEpisode[] = [];
	(output.episodes ?? []).forEach((e, index) => {
		const title = typeof e?.title === "string" ? collapse(e.title) : "";
		const narrative = typeof e?.narrative === "string" ? e.narrative.trim() : "";
		if (!title || !narrative) return reject("episode", index, "título ou narrativa vazios", title);
		if (narrative.length > MAX_NARRATIVE_CHARS) return reject("episode", index, `narrativa com mais de ${MAX_NARRATIVE_CHARS} caracteres`, title);
		const first = byId.get(e.firstMsgId);
		const last = byId.get(e.lastMsgId);
		if (!first || !last) return reject("episode", index, "firstMsgId/lastMsgId fora do lote", title);
		if (first.seq > last.seq) return reject("episode", index, "firstMsgId depois de lastMsgId", title);
		episodes.push({
			firstMsgId: first.id,
			lastMsgId: last.id,
			tStart: first.ts,
			tEnd: last.ts,
			title,
			narrative,
			nodeIds: cleanIds(e.nodeIds),
			importance: clamp01(e.importance, DEFAULT_IMPORTANCE),
		});
	});

	const evidence: DialogueEvidence[] = [];
	(output.evidence ?? []).forEach((ev, index) => {
		const quote = typeof ev?.quote === "string" ? collapse(cleanQuote(ev.quote)) : "";
		const label = quote || "(sem quote)";
		const nodes = (Array.isArray(ev?.nodes) ? ev.nodes : []).filter(
			(n) => typeof n?.nodeId === "string" && n.nodeId.trim() && typeof n.q === "number" && n.q > 0 && n.q <= 1,
		);
		if (nodes.length === 0) return reject("evidence", index, "sem nós", label);
		if (!Number.isInteger(ev.grade) || ev.grade < 0 || ev.grade > 3) return reject("evidence", index, `nota inválida: ${ev.grade}`, label);
		if (!quote) return reject("evidence", index, "sem quote", label);
		const g = groundQuote(quote, cleanIds(ev.sourceMsgIds), ctx.messages, USER_ONLY);
		if (!g.grounded) return reject("evidence", index, "quote não encontrado verbatim em nenhuma fala do aluno", label);
		const at = Math.max(...g.sourceMsgIds.map((id) => byId.get(id)?.ts ?? 0));
		const level = Number.isInteger(ev.level) && (ev.level as number) >= 1 && (ev.level as number) <= 5 ? (ev.level as 1 | 2 | 3 | 4 | 5) : 3;
		evidence.push({
			domainId: ctx.domainId,
			sessionId: ctx.sessionId,
			at,
			nodes: nodes.map((n) => ({ nodeId: n.nodeId.trim(), q: n.q, ...(n.primary ? { primary: true } : {}) })),
			grade: ev.grade as 0 | 1 | 2 | 3,
			graderConfidence: Math.min(MAX_DIALOGUE_CONFIDENCE, clamp01(ev.graderConfidence, 0.5)),
			level,
			quote,
			sourceMsgIds: g.sourceMsgIds,
			...(Array.isArray(ev.attributions) && ev.attributions.length > 0
				? {
						attributions: ev.attributions
							.filter((a) => typeof a?.nodeId === "string" && a.nodeId.trim())
							.map((a) => ({
								nodeId: a.nodeId.trim(),
								blame: clamp01(a.blame, 0),
								...(typeof a.misconceptionId === "string" && a.misconceptionId ? { misconceptionId: a.misconceptionId } : {}),
							})),
					}
				: {}),
		});
	});

	const flashcards: ValidFlashcard[] = [];
	(output.flashcards ?? []).forEach((c, index) => {
		const front = typeof c?.front === "string" ? c.front.trim() : "";
		const back = typeof c?.back === "string" ? c.back.trim() : "";
		if (!front || !back) return reject("flashcard", index, "frente ou verso vazios", front);
		if (front.length > MAX_CARD_CHARS || back.length > MAX_CARD_CHARS) return reject("flashcard", index, "cartão longo demais", front);
		flashcards.push({
			front,
			back,
			nodeId: typeof c.nodeId === "string" && c.nodeId.trim() ? c.nodeId.trim() : null,
			sourceMsgIds: cleanIds(c.sourceMsgIds).filter((id) => byId.has(id)),
		});
	});

	return { facts, episodes, evidence, flashcards, rejected };
}
