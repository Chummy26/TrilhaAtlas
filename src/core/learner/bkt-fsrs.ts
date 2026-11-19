/**
 * Local single-node update: BKT latent L × FSRS availability M (r2 §9.4;
 * docs/research/00-SINTESE.md §2.6).
 *
 *   K = L ∧ M,  P(M=1 | L=1) = R(t) (FSRS-7, computed BEFORE the review),
 *   P(M=1 | L=0) = 0, so P(K) = p·R (R = 1 without a card yet).
 *
 *   P(ŷ)          = pR·ẽ1 + (1 − pR)·ẽ0
 *   P(L=1 | ŷ)    = p·[R·ẽ1 + (1 − R)·ẽ0] / P(ŷ)
 *   p'            = P(L | ŷ) + (1 − P(L | ŷ))·T,   T = clamp(T0·speed, 0, 0.6)
 *
 * Fractional evidence (flashcard weight 0.3): the likelihoods are tempered,
 * posterior ∝ p·L1^w vs (1−p)·L0^w, and the transition is scaled by w. With
 * w = 1 this is exactly the formula above.
 *
 * Grade → FSRS Rating (r2 §9.4 table):
 *   ŷ ∈ {0,1} → Again · ŷ = 2 → Hard (Hard is a PASS) · ŷ = 3 → Good ·
 *   ŷ = 3 ∧ level ≥ 4 ∧ latency < median ∧ selfConfidence 3 → Easy (rare).
 * A hinted answer is at most "right with help" (ŷ ≤ 2).
 */

import { clamp, clamp01 } from "./math.ts";
import { LEARNER_CONSTANTS } from "./params.ts";
import type { Grade, ItemLevel, LearnerParams } from "./types.ts";

/** FSRS rating values (ts-fsrs Rating: Again 1 · Hard 2 · Good 3 · Easy 4). */
export type FsrsRating = 1 | 2 | 3 | 4;
export const RATING = { again: 1, hard: 2, good: 3, easy: 4 } as const;

export interface LocalUpdateResult {
	/** P(L) after observation and transition. */
	pL: number;
	/** P(L | ŷ) before the transition. */
	posterior: number;
	/** Predictive P(ŷ). */
	py: number;
	/** ẽ1(ŷ) / ẽ0(ŷ) (Infinity when ẽ0 = 0). */
	likelihoodRatio: number;
}

/** Tempered posterior p·L1^w / (p·L1^w + (1−p)·L0^w); returns p when uninformative. */
export function temperedPosterior(p: number, l1: number, l0: number, weight = 1): number {
	const prior = clamp01(p);
	const w = weight > 0 ? weight : 0;
	if (w === 0) return prior;
	const a = prior * Math.pow(Math.max(0, l1), w);
	const b = (1 - prior) * Math.pow(Math.max(0, l0), w);
	const den = a + b;
	if (!(den > 0)) return prior;
	return clamp01(a / den);
}

/** P(L=1 | ŷ) for the L∧M model (exact r2 §9.4 formula when weight = 1). */
export function posteriorAcquired(p: number, R: number, e1y: number, e0y: number, weight = 1): number {
	const r = clamp01(R);
	return temperedPosterior(p, r * e1y + (1 - r) * e0y, e0y, weight);
}

/** BKT learning transition p + (1 − p)·T. */
export function learningTransition(p: number, T: number): number {
	const t = clamp01(T);
	return clamp01(p + (1 - p) * t);
}

/** r2 §9.4 `localUpdate` (tables are the NOISY ẽ1/ẽ0; `y` indexes them). */
export function localUpdate(
	pL: number,
	R: number,
	e1: readonly number[],
	e0: readonly number[],
	y: number,
	T: number,
	weight = 1,
): LocalUpdateResult {
	const e1y = e1[y];
	const e0y = e0[y];
	if (e1y === undefined || e0y === undefined) throw new RangeError(`Índice de nota fora da tabela de emissão: ${y}`);
	const pK = clamp01(pL) * clamp01(R);
	const py = pK * e1y + (1 - pK) * e0y;
	const posterior = posteriorAcquired(pL, R, e1y, e0y, weight);
	return {
		pL: learningTransition(posterior, T * (weight > 0 ? Math.min(weight, 1) : 0)),
		posterior,
		py,
		likelihoodRatio: e0y > 0 ? e1y / e0y : Number.POSITIVE_INFINITY,
	};
}

/** Practice transition rate T = clamp(tPractice·speed, 0, 0.6). */
export function practiceTransition(params: LearnerParams, speed: number): number {
	return clamp(params.tPractice * (Number.isFinite(speed) ? speed : 1), 0, LEARNER_CONSTANTS.maxTransition);
}

/** Lesson transition rate T_lesson·speed, same clamp. */
export function lessonTransition(params: LearnerParams, speed: number): number {
	return clamp(params.tLesson * (Number.isFinite(speed) ? speed : 1), 0, LEARNER_CONSTANTS.maxTransition);
}

/** A hinted answer counts at most as "right with help". */
export function effectiveGrade(grade: Grade, hints: number): Grade {
	return hints > 0 && grade === 3 ? 2 : grade;
}

export function isSuccessGrade(grade: Grade): boolean {
	return grade >= 2;
}

export interface RatingContext {
	level: ItemLevel;
	hints: number;
	latencyMs?: number;
	/** Median-latency reference for the node (geometric mean of past latencies). */
	medianLatencyMs?: number;
	selfConfidence?: 1 | 2 | 3;
}

/** Map an (effective) grade to an FSRS Rating (r2 §9.4 table). */
export function gradeToRating(grade: Grade, ctx: RatingContext): FsrsRating {
	const g = effectiveGrade(grade, ctx.hints);
	if (g <= 1) return RATING.again;
	if (g === 2) return RATING.hard;
	const fast =
		ctx.latencyMs !== undefined && ctx.medianLatencyMs !== undefined && ctx.latencyMs > 0 && ctx.latencyMs < ctx.medianLatencyMs;
	if (ctx.level >= LEARNER_CONSTANTS.easyMinLevel && fast && ctx.selfConfidence === 3) return RATING.easy;
	return RATING.good;
}

/** Update the running ln-latency mean; returns the new record (or the old one when latency is absent). */
export function updateLatency(
	prev: { logMean: number; n: number } | undefined,
	latencyMs: number | undefined,
): { logMean: number; n: number } | undefined {
	if (latencyMs === undefined || !(latencyMs > 0) || !Number.isFinite(latencyMs)) return prev;
	const x = Math.log(latencyMs);
	if (!prev) return { logMean: x, n: 1 };
	const n = prev.n + 1;
	return { logMean: prev.logMean + (x - prev.logMean) / n, n };
}

/** Median-latency proxy exp(mean ln latency) once enough samples exist. */
export function medianLatency(latency: { logMean: number; n: number } | undefined): number | undefined {
	if (!latency || latency.n < LEARNER_CONSTANTS.easyMinLatencySamples) return undefined;
	return Math.exp(latency.logMean);
}
