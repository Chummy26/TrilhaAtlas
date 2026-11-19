/**
 * Elo-style ability θ (per domain) and item-family difficulty b per level
 * (per node), used ONLY to choose the item level — never to move P(L)
 * (r2 §9.9 "Dificuldade do item", §9.11 Elo row; SÍNTESE §2.4(c)).
 *
 *   s_{k,ℓ} = σ(logit(s_ℓ) + b_{k,ℓ} − θ),  s_ℓ = 0.05, 0.10, 0.15, 0.25, 0.35
 *   P(correct | ℓ) = pR·(1 − s_{k,ℓ}) + (1 − pR)·g_ℓ
 *   g = 0.2 for open answers (P(ŷ ≥ 2 | K=0), delayed table), 1/k for MCQ.
 *   Practice targets P ≈ 0.75 (band 0.70–0.85); probes target 0.5.
 *   Update after an observation y ∈ {0,1} with prediction P:
 *     θ += U(n_θ)·(y − P),  b_{k,ℓ} −= U(n_k)·(y − P),  U(n) = 1/(1 + 0.05·n)
 *   (Pelánek 2016). θ and b live on the logit scale; the 400-point Elo scale
 *   of SÍNTESE §2.4(c) is x₄₀₀ = x·400/ln 10 (`toElo400`).
 */

import { clamp01, logit, sigmoid } from "./math.ts";
import { LEARNER_CONSTANTS } from "./params.ts";
import type { ItemFormat, ItemLevel } from "./types.ts";

export const ITEM_LEVELS: readonly ItemLevel[] = [1, 2, 3, 4, 5];

export function defaultLevelElo(): number[] {
	return [0, 0, 0, 0, 0];
}

export function eloStep(n: number): number {
	return 1 / (1 + LEARNER_CONSTANTS.eloDecay * Math.max(0, n));
}

export function baseSlip(level: ItemLevel): number {
	return LEARNER_CONSTANTS.slipByLevel[level - 1] ?? 0.35;
}

/** s_{k,ℓ} = σ(logit(s_ℓ) + b − θ). */
export function slipFor(level: ItemLevel, b: number, theta: number): number {
	return sigmoid(logit(baseSlip(level)) + b - theta);
}

/** Guess probability: 1/k for MCQ, else the open-answer default. */
export function guessFor(format: ItemFormat, options = 4): number {
	if (format === "mcq") return 1 / (Number.isInteger(options) && options >= 2 ? options : 4);
	return LEARNER_CONSTANTS.guessOpen;
}

/** P(correct | ℓ) = pR(1 − s) + (1 − pR)·g — also the `predicted` value for calibration. */
export function predictCorrect(pR: number, level: ItemLevel, levelElo: readonly number[], theta: number, guess: number): number {
	const s = slipFor(level, levelElo[level - 1] ?? 0, theta);
	const k = clamp01(pR);
	return clamp01(k * (1 - s) + (1 - k) * clamp01(guess));
}

export interface LevelChoice {
	level: ItemLevel;
	p: number;
}

/**
 * Level whose predicted success is closest to the target (0.75 practice,
 * 0.5 probes); ties prefer the higher level (more informative/transfer).
 */
export function chooseLevel(
	pR: number,
	levelElo: readonly number[],
	theta: number,
	guess: number,
	mode: "practice" | "probe" = "practice",
	allowed: readonly ItemLevel[] = ITEM_LEVELS,
): LevelChoice {
	const target = mode === "probe" ? LEARNER_CONSTANTS.probeTarget : LEARNER_CONSTANTS.practiceTarget.mid;
	let best: LevelChoice | null = null;
	for (const level of allowed) {
		const p = predictCorrect(pR, level, levelElo, theta, guess);
		if (!best || Math.abs(p - target) < Math.abs(best.p - target) - 1e-12 || (Math.abs(Math.abs(p - target) - Math.abs(best.p - target)) <= 1e-12 && level > best.level)) {
			best = { level, p };
		}
	}
	if (!best) throw new RangeError("Nenhum nível de item permitido.");
	return best;
}

/** True when the predicted success sits in the practice band 0.70–0.85. */
export function inPracticeBand(p: number): boolean {
	const t = LEARNER_CONSTANTS.practiceTarget;
	return p >= t.lo && p <= t.hi;
}

export interface EloUpdate {
	theta: number;
	thetaN: number;
	levelElo: number[];
}

/** One Elo step after observing y (1 = ŷ ≥ 2) with prediction `expected`. */
export function updateElo(
	theta: number,
	thetaN: number,
	levelElo: readonly number[],
	level: ItemLevel,
	itemN: number,
	y: 0 | 1,
	expected: number,
): EloUpdate {
	const err = y - clamp01(expected);
	const next = [...levelElo];
	while (next.length < 5) next.push(0);
	next[level - 1] = (next[level - 1] ?? 0) - eloStep(itemN) * err;
	return { theta: theta + eloStep(thetaN) * err, thetaN: thetaN + 1, levelElo: next };
}

/** Logit-scale value on the 400-point Elo scale. */
export function toElo400(x: number): number {
	return (x * 400) / Math.LN10;
}
