/**
 * Level curve over XP (docs/research/00-SINTESE.md §2.11; r7 §3).
 *
 *   XP_total(L) = a · L^p        (power curve, 1 < p < 2)
 *   L(XP)       = max(1, ⌊(XP / a)^(1/p)⌋)
 *
 * Defaults a = 20.10, p = 1.696 come from the r7 Monte Carlo fit "the 3 h/day
 * reference learner is at L10 on day 7 and L100 on day 365";
 * scripts/calibrate-progression.ts re-fits them with the same pure XP rules
 * and writes them to config/progression.json (read through ./config.ts).
 *
 * Conventions (documented because the raw formula is ambiguous at L = 1):
 *   • level 1 starts at 0 XP — `xpForLevel(1) = 0`; every L ≥ 2 starts at
 *     exactly a·L^p. So `levelFromXp(xpForLevel(L)) === L` for every L ≥ 1.
 *   • `levelFromXp` corrects the floating-point floor with an exact
 *     comparison against `xpForLevel`, so the two functions are true inverses
 *     and the level is monotonic (non-decreasing) in XP (invariant I3).
 *   • no practical cap: levels keep going after 100 (r7: cosmetic
 *     "prestige" only); only absurd totals saturate at MAX_LEVEL = 10⁹.
 *
 * Pure: browser-safe.
 */

import type { LevelCurve, LevelProgress } from "./types.ts";

export const DEFAULT_LEVEL_CURVE: Readonly<LevelCurve> = Object.freeze({ a: 20.1, p: 1.696 });

export class LevelCurveError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LevelCurveError";
	}
}

/** Throws when the curve could make levels non-monotonic or explode. */
export function validateLevelCurve(curve: LevelCurve): LevelCurve {
	if (!Number.isFinite(curve.a) || curve.a <= 0) throw new LevelCurveError(`Curva de nível inválida: a = ${curve.a} (precisa ser > 0).`);
	if (!Number.isFinite(curve.p) || curve.p < 1 || curve.p > 3) {
		throw new LevelCurveError(`Curva de nível inválida: p = ${curve.p} (esperado entre 1 e 3).`);
	}
	return curve;
}

/** Total XP at which level `level` starts (level 1 → 0). */
export function xpForLevel(level: number, curve: LevelCurve = DEFAULT_LEVEL_CURVE): number {
	if (!Number.isInteger(level) || level < 1) throw new LevelCurveError(`Nível inválido: ${level} (inteiro ≥ 1).`);
	if (level === 1) return 0;
	return curve.a * level ** curve.p;
}

/**
 * Saturation level. Unreachable in practice (default curve: ≈ 4·10¹⁶ XP), but
 * it keeps the exact-floor correction finite: above 2⁵³ `level + 1 === level`
 * and the old loop spun forever on a corrupted total such as 1e30 XP.
 */
export const MAX_LEVEL = 1_000_000_000;

/** Level reached with `xp` total XP (negative or non-finite XP counts as 0; saturates at MAX_LEVEL). */
export function levelFromXp(xp: number, curve: LevelCurve = DEFAULT_LEVEL_CURVE): number {
	validateLevelCurve(curve);
	const safeXp = Number.isFinite(xp) ? Math.max(0, xp) : 0;
	const estimate = Math.floor((safeXp / curve.a) ** (1 / curve.p));
	if (!(estimate < MAX_LEVEL)) return MAX_LEVEL;
	let level = Math.max(1, estimate);
	// Exact correction of the floating-point floor: the level must agree with xpForLevel.
	while (level < MAX_LEVEL && xpForLevel(level + 1, curve) <= safeXp) level += 1;
	while (level > 1 && xpForLevel(level, curve) > safeXp) level -= 1;
	return level;
}

/** XP needed to go from `level` to `level + 1`. */
export function xpToAdvance(level: number, curve: LevelCurve = DEFAULT_LEVEL_CURVE): number {
	return xpForLevel(level + 1, curve) - xpForLevel(level, curve);
}

/** Level plus the short-range progress bar (goal-gradient, r7 P9). */
export function levelProgress(xp: number, curve: LevelCurve = DEFAULT_LEVEL_CURVE): LevelProgress {
	const safeXp = Number.isFinite(xp) ? Math.max(0, xp) : 0;
	const level = levelFromXp(safeXp, curve);
	const levelStartXp = xpForLevel(level, curve);
	const nextLevelXp = xpForLevel(level + 1, curve);
	const span = nextLevelXp - levelStartXp;
	const xpIntoLevel = safeXp - levelStartXp;
	return {
		level,
		xp: safeXp,
		levelStartXp,
		nextLevelXp,
		xpIntoLevel,
		xpToNext: nextLevelXp - safeXp,
		fraction: span > 0 ? Math.min(1, Math.max(0, xpIntoLevel / span)) : 0,
	};
}

/**
 * Fit a·L^p through two anchors (XP x₁ at level L₁, XP x₂ at level L₂) — the
 * calibration recipe of r7 §3 (L10 at day 7, L100 at day 365 for 3 h/day).
 */
export function fitLevelCurve(anchorLow: { level: number; xp: number }, anchorHigh: { level: number; xp: number }): LevelCurve {
	const { level: l1, xp: x1 } = anchorLow;
	const { level: l2, xp: x2 } = anchorHigh;
	if (!(l1 >= 1 && l2 > l1 && x1 > 0 && x2 > x1)) {
		throw new LevelCurveError(`Âncoras inválidas para a curva de nível: (${l1}, ${x1}) e (${l2}, ${x2}).`);
	}
	const p = Math.log(x2 / x1) / Math.log(l2 / l1);
	const a = x1 / l1 ** p;
	return validateLevelCurve({ a, p });
}
