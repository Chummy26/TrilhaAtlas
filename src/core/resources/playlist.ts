/**
 * Per-node resource playlist: score → gates → MMR → pedagogical slots → ONE
 * suggestion at a time (SÍNTESE §2.8 "Playlist por nó", §1.2 P15–P16, §2.4b
 * "Nunca mais de uma sugestão por vez"; r6 §7.5, §12.1–12.2).
 *
 * Ranking (r6 §12.1): for every CoverageLink of the node that is not
 * rejected, compute the score parts (score.ts) and keep only those passing
 * the gates rel ≥ 0,35 and lang > 0; then MMR with λ = 0,7 and the
 * channel-aware similarity (mmr.ts).
 *   rel   videos: 0,5·llm + 0,3·cos + 0,2·bm25 when signals exist, else the
 *         link score; books/articles: the link score, which by contract
 *         (CoverageLink.score) already IS coverage × confidence.
 *   qual  videos: rubric/channel trust/caption quality; books: the feedback
 *         posterior when given, else the source prior (OpenStax/OTL 0,8,
 *         Wikibooks 0,5, the learner's own file 0,9).
 *   dur   videos: the linked SPAN (or the whole video) vs T* = geometric
 *         centre of policy.videoMinutes; books: pages × 3 min vs a 15-min
 *         reading target (decision: r6 gives no reading T*; 15 min ≈ centre
 *         of the "topic" 10–20 band).
 *   pref  caller's Thompson sample (default 0,5 = no information).
 *
 * Slots (r6 §7.5 step 3):
 *   ai-explanation   always (generated on demand by the tutor);
 *   intuition-video  best video with known duration ≤ 12 min;
 *   primary-reading  best book section (role "primary" first);
 *   deep-dive        best remaining long video / higher-level / advanced item.
 * Order: explain-first (Electronics): AI → intuition → reading → deep-dive.
 * input-first (English, `requireOriginalAudio` — P15 "Inglês começa por
 * input"; r6 §12.2): the EN input video comes first (its cap is the policy's
 * videoMinutes.hi), then the AI explanation.
 * Budget (r6 §7.5 step 4): mandatory = AI explanation + primary reading (+ the
 * input video in input-first); optional entries enter only if the remaining
 * minutes of the day still fit them, in slot order.
 * Everything not placed goes to `more` (the collapsed "Mais materiais").
 *
 * Pure: browser-safe; randomness (Thompson sampling) stays with the caller.
 */

import type { DomainResourcePolicy } from "../domains/types.ts";
import { languageFit, type LangFitContext } from "./language-fit.ts";
import { channelAwareSimilarity, DEFAULT_MMR_LAMBDA, mmr } from "./mmr.ts";
import {
	bookRelevance,
	bookSourcePrior,
	captionQuality,
	DEFAULT_WEIGHTS,
	durationFit,
	ENGLISH_WEIGHTS,
	levelFit,
	quality,
	readingSeconds,
	relevance,
	rubricScore,
	scoreResource,
	targetSeconds,
	type GateFailure,
	type LlmCoverage,
	type Rubric,
	type ScoreParts,
	type ScoreWeights,
} from "./score.ts";
import type { CoverageLink, PlaylistSlot, Resource } from "./types.ts";

export const INTUITION_MAX_SECONDS = 12 * 60;
export const READING_TARGET_SECONDS = 15 * 60;
export const DEFAULT_AI_LESSON_MINUTES = 10;

export interface CandidateSignals {
	llmCoverage?: LlmCoverage;
	cos?: number;
	bm25?: number;
	rubric?: Rubric;
	/** Posterior mean of the channel/source trust (score.channelTrust). */
	channelTrust?: number;
	/** Thompson sample of the (channel, format) preference. */
	pref?: number;
	/** Embedding of the transcript summary / section summary (MMR similarity). */
	embedding?: ArrayLike<number>;
}

export interface Candidate {
	resource: Resource;
	link: CoverageLink;
	signals?: CandidateSignals;
}

export interface RankContext {
	policy: DomainResourcePolicy;
	/** Node level on the 0–5 scale. */
	nodeLevel: number;
	/** Mastery adjustment added to the node level (r6 §7.2 lvl). */
	masteryAdj?: number;
	langFit?: LangFitContext;
	weights?: ScoreWeights;
	/** Video target duration T*; default = centre of policy.videoMinutes. */
	targetSec?: number;
	lambda?: number;
	/** Resource ids already seen or refused (r6 §7.2 `novel`). */
	excludeIds?: ReadonlySet<string>;
}

export interface RankedResource {
	resource: Resource;
	link: CoverageLink;
	score: number;
	parts: ScoreParts;
	/** MMR marginal value when picked. */
	marginal: number;
	estMinutes: number;
}

export interface RejectedCandidate {
	resourceId: string;
	reason: GateFailure | "excluded" | "rejected-link";
	parts?: ScoreParts;
}

const TEXT_KINDS = new Set<Resource["kind"]>(["book", "book_section", "article"]);

function isText(r: Resource): boolean {
	return TEXT_KINDS.has(r.kind);
}

/** Seconds covered by the link span (time), else the resource duration. */
export function spanSeconds(c: Pick<Candidate, "resource" | "link">): number | undefined {
	const s = c.link.span;
	if (s?.startSec !== undefined && s.endSec !== undefined && s.endSec > s.startSec) return s.endSec - s.startSec;
	if (s?.startSec !== undefined && c.resource.durationSec !== undefined && c.resource.durationSec > s.startSec) return c.resource.durationSec - s.startSec;
	return c.resource.durationSec;
}

/** Page count of a "12-18" / "12" range; undefined when absent or malformed. */
export function pagesInRange(pages: string | undefined): number | undefined {
	if (!pages) return undefined;
	const m = pages.trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
	if (!m) return undefined;
	const from = Number(m[1]);
	const to = m[2] ? Number(m[2]) : from;
	return to >= from ? to - from + 1 : undefined;
}

/** Estimated study minutes of a candidate (video span, or pages × 3 min). */
export function estimateMinutes(c: Pick<Candidate, "resource" | "link">): number {
	if (c.resource.kind === "ai_lesson") return DEFAULT_AI_LESSON_MINUTES;
	if (isText(c.resource)) {
		const pages = pagesInRange(c.link.span?.pages) ?? c.resource.pages;
		return pages !== undefined ? readingSeconds(pages) / 60 : 10;
	}
	const sec = spanSeconds(c);
	return sec !== undefined ? sec / 60 : 10;
}

function weightsFor(ctx: RankContext): ScoreWeights {
	return ctx.weights ?? (ctx.policy.requireOriginalAudio ? ENGLISH_WEIGHTS : DEFAULT_WEIGHTS);
}

function videoTarget(ctx: RankContext): number {
	return ctx.targetSec ?? targetSeconds(ctx.policy.videoMinutes);
}

/** All six components of one candidate (before gates). */
export function scoreParts(c: Candidate, ctx: RankContext): ScoreParts {
	const s = c.signals ?? {};
	const r = c.resource;
	const text = isText(r);
	const hasRelSignals = s.llmCoverage !== undefined || s.cos !== undefined || s.bm25 !== undefined;
	// CoverageLink.score is ALREADY coverage × confidence (SÍNTESE §2.3), so it
	// is the book relevance as is; multiplying by a second confidence counted
	// it twice.
	const rel = text || !hasRelSignals ? bookRelevance(c.link.score) : relevance({ llmCoverage: s.llmCoverage, cos: s.cos, bm25: s.bm25 });
	const qual = text
		? s.rubric !== undefined
			? quality({ rubric: rubricScore(s.rubric), channelTrust: s.channelTrust ?? bookSourcePrior(r.provider) })
			: (s.channelTrust ?? bookSourcePrior(r.provider))
		: quality({ rubric: s.rubric ? rubricScore(s.rubric) : undefined, channelTrust: s.channelTrust, captionQ: captionQuality(r.captions, r.hasManualCaptions, r.audioLang ?? r.lang) });
	const lang = languageFit(r, ctx.policy, ctx.langFit);
	const lvl = levelFit(r.level, ctx.nodeLevel, ctx.masteryAdj ?? 0);
	const dur = text ? durationFit(estimateMinutes(c) * 60, READING_TARGET_SECONDS) : durationFit(spanSeconds(c), videoTarget(ctx));
	const pref = s.pref ?? 0.5;
	return { rel, qual, lang, lvl, dur, pref };
}

/** Gate + score every candidate, then diversify with MMR (λ = 0,7). */
export function rankCandidates(candidates: readonly Candidate[], ctx: RankContext): { ranked: RankedResource[]; rejected: RejectedCandidate[] } {
	const rejected: RejectedCandidate[] = [];
	const passed: Array<{ item: Candidate & { parts: ScoreParts; estMinutes: number }; score: number }> = [];
	const indexByKey = new Map<string, number>();
	for (const c of candidates) {
		if (c.link.status === "rejected") {
			rejected.push({ resourceId: c.resource.id, reason: "rejected-link" });
			continue;
		}
		if (ctx.excludeIds?.has(c.resource.id)) {
			rejected.push({ resourceId: c.resource.id, reason: "excluded" });
			continue;
		}
		const parts = scoreParts(c, ctx);
		const result = scoreResource(parts, weightsFor(ctx));
		if (!result.passed) {
			rejected.push({ resourceId: c.resource.id, reason: result.gate!, parts: result.parts });
			continue;
		}
		// One entry per resource + span: a duplicate keeps the better score.
		const span = c.link.span;
		const key = `${c.resource.id}|${span?.startSec ?? ""}|${span?.pages ?? ""}|${span?.sectionId ?? ""}`;
		const entry = { item: { ...c, parts: result.parts, estMinutes: estimateMinutes(c) }, score: result.score };
		const existing = indexByKey.get(key);
		if (existing === undefined) {
			indexByKey.set(key, passed.length);
			passed.push(entry);
		} else if (passed[existing]!.score < result.score) {
			passed[existing] = entry;
		}
	}
	const picks = mmr(
		passed,
		(a, b) => channelAwareSimilarity({ channelId: a.resource.channelId, embedding: a.signals?.embedding }, { channelId: b.resource.channelId, embedding: b.signals?.embedding }),
		ctx.lambda ?? DEFAULT_MMR_LAMBDA,
	);
	const ranked = picks.map((p) => ({ resource: p.item.resource, link: p.item.link, score: p.score, parts: p.item.parts, marginal: p.marginal, estMinutes: p.item.estMinutes }));
	return { ranked, rejected };
}

// ─── playlist ────────────────────────────────────────────────────────────────

export type PlaylistOrder = "explain-first" | "input-first";

export function playlistOrderFor(policy: DomainResourcePolicy): PlaylistOrder {
	return policy.requireOriginalAudio ? "input-first" : "explain-first";
}

export interface PlaylistEntry {
	slot: PlaylistSlot;
	resourceId: string;
	resource?: Resource;
	link?: CoverageLink;
	score?: number;
	estMinutes: number;
	optional: boolean;
	/** Short pt-BR line shown with the suggestion. */
	reason: string;
}

export interface NodePlaylist {
	nodeId: string;
	order: PlaylistOrder;
	entries: PlaylistEntry[];
	/** Ranked items not placed in a slot (collapsed "Mais materiais"). */
	more: RankedResource[];
}

export interface PlaylistInput {
	nodeId: string;
	ranked: readonly RankedResource[];
	policy: DomainResourcePolicy;
	nodeLevel: number;
	aiLesson?: { resourceId?: string; estMinutes?: number };
	/** Cap of the intuition/input video; default 12 min (input-first: policy.videoMinutes.hi). */
	intuitionMaxSec?: number;
	/** Minutes left in today's study budget; undefined = no limit. */
	budgetMinutes?: number;
}

function knownSeconds(r: RankedResource): number | undefined {
	return spanSeconds(r);
}

function formatMinutes(min: number): string {
	return `${Math.max(1, Math.round(min))} min`;
}

/** Slots for one node, in teaching order, fitted to the day's budget. */
export function buildNodePlaylist(input: PlaylistInput): NodePlaylist {
	const order = playlistOrderFor(input.policy);
	const cap = input.intuitionMaxSec ?? (order === "input-first" ? Math.max(INTUITION_MAX_SECONDS, input.policy.videoMinutes.hi * 60) : INTUITION_MAX_SECONDS);
	const used = new Set<RankedResource>();
	const take = (pred: (r: RankedResource) => boolean): RankedResource | undefined => {
		const hit = input.ranked.find((r) => !used.has(r) && pred(r));
		if (hit) used.add(hit);
		return hit;
	};

	const intuition = take((r) => r.resource.kind === "video" && (knownSeconds(r) ?? Infinity) <= cap);
	const reading = take((r) => isText(r.resource) && r.link.role === "primary") ?? take((r) => isText(r.resource));
	const deep = take((r) => {
		const sec = knownSeconds(r);
		const longVideo = r.resource.kind === "video" && sec !== undefined && sec > cap;
		const higher = r.resource.level !== undefined && r.resource.level > input.nodeLevel;
		return longVideo || higher || r.link.depth === "advanced" || r.link.role === "supplement";
	});

	const ai: PlaylistEntry = {
		slot: "ai-explanation",
		resourceId: input.aiLesson?.resourceId ?? `ai:${input.nodeId}`,
		estMinutes: input.aiLesson?.estMinutes ?? DEFAULT_AI_LESSON_MINUTES,
		optional: false,
		reason: "Explicação curta da IA, no seu ritmo.",
	};
	const source = new Map<PlaylistEntry, RankedResource>();
	const entryOf = (slot: PlaylistSlot, r: RankedResource, optional: boolean, reason: string): PlaylistEntry => {
		const entry: PlaylistEntry = { slot, resourceId: r.resource.id, resource: r.resource, link: r.link, score: r.score, estMinutes: r.estMinutes, optional, reason };
		source.set(entry, r);
		return entry;
	};
	const video = intuition
		? entryOf(
				"intuition-video",
				intuition,
				order === "explain-first",
				order === "input-first" ? `Vídeo em inglês com áudio original (${formatMinutes(intuition.estMinutes)}).` : `Vídeo curto para intuição (${formatMinutes(intuition.estMinutes)}).`,
			)
		: undefined;
	const read = reading ? entryOf("primary-reading", reading, false, `Leitura principal (${formatMinutes(reading.estMinutes)}).`) : undefined;
	const deepEntry = deep ? entryOf("deep-dive", deep, true, `Aprofundamento opcional (${formatMinutes(deep.estMinutes)}).`) : undefined;

	const ordered = (order === "input-first" ? [video, ai, read, deepEntry] : [ai, video, read, deepEntry]).filter((e): e is PlaylistEntry => e !== undefined);
	const entries = fitBudget(ordered, input.budgetMinutes);
	const placed = new Set(entries.map((e) => source.get(e)).filter((r): r is RankedResource => r !== undefined));
	return { nodeId: input.nodeId, order, entries, more: input.ranked.filter((r) => !placed.has(r)) };
}

/** Keep mandatory entries; add optional ones in order while they fit the remaining minutes. */
export function fitBudget(entries: readonly PlaylistEntry[], budgetMinutes: number | undefined): PlaylistEntry[] {
	if (budgetMinutes === undefined) return [...entries];
	let left = budgetMinutes - entries.filter((e) => !e.optional).reduce((acc, e) => acc + e.estMinutes, 0);
	return entries.filter((e) => {
		if (!e.optional) return true;
		if (e.estMinutes <= left) {
			left -= e.estMinutes;
			return true;
		}
		return false;
	});
}

export interface PlaylistProgress {
	/** Entry keys (`slot:resourceId`) the learner finished. */
	done?: ReadonlySet<string>;
	/** Entry keys the learner skipped. */
	dismissed?: ReadonlySet<string>;
}

export function entryKey(e: Pick<PlaylistEntry, "slot" | "resourceId">): string {
	return `${e.slot}:${e.resourceId}`;
}

/** The ONE next suggestion (P16): the first entry neither done nor dismissed. */
export function nextSuggestion(playlist: NodePlaylist, progress: PlaylistProgress = {}): PlaylistEntry | null {
	for (const e of playlist.entries) {
		const key = entryKey(e);
		if (progress.done?.has(key) || progress.dismissed?.has(key)) continue;
		return e;
	}
	return null;
}

/** How many suggestions remain after the current one (shown collapsed). */
export function remainingAfterNext(playlist: NodePlaylist, progress: PlaylistProgress = {}): number {
	const open = playlist.entries.filter((e) => !progress.done?.has(entryKey(e)) && !progress.dismissed?.has(entryKey(e)));
	return Math.max(0, open.length - 1);
}
