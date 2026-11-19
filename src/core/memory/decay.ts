/**
 * Lifetime priors, temporal proximity and archiving (r4 §7.6.4 steps 4–5,
 * §7.6.5-5; MemOS decay 0.5^(Δt/30d) and relative cut 0.4).
 *
 *   s *= (0.6 + 0.4·importance) · 0.5^(Δdays/τ) · 1.15 [same session] · 0.3 [superseded, historical only]
 *   τ = 30 days for episodic memory (messages, episodes, experience/affect facts), ∞ for semantic
 *       memory (world/learner/preference/misconception/goal/plan facts, observations).
 *
 * Decision (ambiguous in r4): "prefer dense facts over raw messages" is a
 * 0.9 kind prior on raw messages, applied here so packing stays a plain greedy.
 */

import type { FactKind, MemoryItemKind } from "./types.ts";

export const DAY_MS = 86_400_000;
export const EPISODIC_HALF_LIFE_DAYS = 30;
export const SAME_SESSION_BOOST = 1.15;
export const SUPERSEDED_FACTOR = 0.3;
export const MESSAGE_KIND_PRIOR = 0.9;
export const RELATIVE_CUT = 0.4;
export const MAX_CANDIDATES = 40;

export function clamp01(x: number): number {
	return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** 0.5^(age/τ); τ = ∞ → 1; future items count as fresh. */
export function recency(ageMs: number, halfLifeDays: number): number {
	if (!Number.isFinite(halfLifeDays)) return 1;
	if (ageMs <= 0) return 1;
	return Math.pow(0.5, ageMs / DAY_MS / halfLifeDays);
}

const EPISODIC_FACTS: ReadonlySet<FactKind> = new Set<FactKind>(["experience", "affect"]);

export function halfLifeDaysFor(kind: MemoryItemKind, factKind?: FactKind): number {
	if (kind === "message" || kind === "episode") return EPISODIC_HALF_LIFE_DAYS;
	if (kind === "fact" && factKind && EPISODIC_FACTS.has(factKind)) return EPISODIC_HALF_LIFE_DAYS;
	return Number.POSITIVE_INFINITY;
}

export interface PriorInput {
	kind: MemoryItemKind;
	factKind?: FactKind;
	importance: number;
	at: number;
	now: number;
	sameSession: boolean;
	superseded: boolean;
}

export function lifePrior(p: PriorInput): number {
	const importance = 0.6 + 0.4 * clamp01(p.importance);
	const rec = recency(p.now - p.at, halfLifeDaysFor(p.kind, p.factKind));
	const session = p.sameSession ? SAME_SESSION_BOOST : 1;
	const superseded = p.superseded ? SUPERSEDED_FACTOR : 1;
	const kindPrior = p.kind === "message" ? MESSAGE_KIND_PRIOR : 1;
	return importance * rec * session * superseded * kindPrior;
}

/** Drop items below ratio·max and keep at most `max` (input must be sorted best-first). */
export function relativeCut<T extends { score: number }>(sorted: readonly T[], ratio = RELATIVE_CUT, max = MAX_CANDIDATES): T[] {
	if (sorted.length === 0) return [];
	const top = Math.max(...sorted.map((x) => x.score));
	if (!(top > 0)) return sorted.slice(0, max);
	return sorted.filter((x) => x.score >= ratio * top).slice(0, max);
}

/**
 * Hindsight temporal score: overlap required, then 1 − |mid − mid_q| / (Δq/2),
 * clamped to [0,1]. Returns null when the item interval misses the query range.
 */
export function temporalProximity(itemFrom: number, itemTo: number, rangeFrom: number, rangeTo: number): number | null {
	const lo = Math.min(itemFrom, itemTo);
	const hi = Math.max(itemFrom, itemTo);
	if (hi < rangeFrom || lo >= rangeTo) return null;
	const half = (rangeTo - rangeFrom) / 2;
	if (!(half > 0)) return 1;
	const mid = (lo + hi) / 2;
	const midQ = (rangeFrom + rangeTo) / 2;
	return clamp01(1 - Math.abs(mid - midQ) / half);
}

export const ARCHIVE_AFTER_DAYS = 180;
export const ARCHIVE_MAX_IMPORTANCE = 0.3;

/** r4 §7.6.5-5: low importance, never accessed, older than 180 days. */
export function shouldArchive(p: { importance: number; accessCount: number; ageMs: number }): boolean {
	return p.importance < ARCHIVE_MAX_IMPORTANCE && p.accessCount === 0 && p.ageMs > ARCHIVE_AFTER_DAYS * DAY_MS;
}
