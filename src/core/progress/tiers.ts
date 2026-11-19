/**
 * Domain tiers: RETAINED mastery of the frozen canonical core
 * (docs/research/00-SINTESE.md §2.11; r7 §4.2, §5.4).
 *
 *   retained(n)  ⇔ n is attained ∧ R_n(t) ≥ 0.70
 *   f_s          = |retained(core[s])| / |core[s]|          (stage s = 1..7)
 *   PM           = Σ_s s · f_s                              (0 … 28)
 *   tier         = number of thresholds τ_k with PM ≥ τ_k   (0 = Novato)
 *   division     = III / II / I as PM crosses 1/3 and 2/3 of [τ_k, τ_{k+1})
 *                  (Doutor: of [τ_7, 28])
 *   form         = retained / learned over the whole core (1 when nothing learned)
 *
 * The tier depends ONLY on the retention snapshot of the core (invariant "tier
 * só depende de retenção"): no XP, no time, no self-assessment goes in. The
 * TITLE shown is the peak (`updateTierPeak`, never demoted, r7 P8); `form`
 * is the thermometer that can fall.
 *
 * Thresholds default to the r7 §5.4 values (1.71 / 3.71 / 6.32 / 9.69 /
 * 13.37 / 17.69 / 23.49); the calibrated ones live in config/progression.json
 * and arrive through ./config.ts (core stays pure: no file reads here).
 *
 * `structuralStage` is the r7 §4.2 "structural" criterion (stage s complete ⇔
 * f_s ≥ q = 0.8 and every earlier stage complete). The runtime shows the
 * continuous PM tier; the Monte Carlo uses the structural stage to report how
 * both criteria line up.
 *
 * An empty core stage has f_s = 0 (nothing there can be retained yet).
 *
 * Pure: browser-safe.
 */

import type { RetentionSnapshot, Tier, TierCore, TierDivision, TierIndex, TierStanding } from "./types.ts";

export const TIERS: readonly Tier[] = Object.freeze([
	Object.freeze({ index: 1, id: "bronze", label: "Bronze", stage: 1 }),
	Object.freeze({ index: 2, id: "silver", label: "Prata", stage: 2 }),
	Object.freeze({ index: 3, id: "gold", label: "Ouro", stage: 3 }),
	Object.freeze({ index: 4, id: "platinum", label: "Platina", stage: 4 }),
	Object.freeze({ index: 5, id: "diamond", label: "Diamante", stage: 5 }),
	Object.freeze({ index: 6, id: "master", label: "Mestre", stage: 6 }),
	Object.freeze({ index: 7, id: "doctor", label: "Doutor", stage: 7 }),
] as Tier[]);

export const STAGE_COUNT = 7;
/** Σ_s s = 28. */
export const PM_MAX = (STAGE_COUNT * (STAGE_COUNT + 1)) / 2;
/** r7 §5.4 thresholds (3 h/day reference learner, weeks 2/6/13/24/37/52/70). */
export const DEFAULT_TIER_THRESHOLDS: readonly number[] = Object.freeze([1.71, 3.71, 6.32, 9.69, 13.37, 17.69, 23.49]);
/** A node counts as retained when R ≥ this. */
export const DEFAULT_RETAINED_R = 0.7;
/** Structural criterion: fraction of a stage core that must be retained. */
export const DEFAULT_STAGE_QUOTA = 0.8;

export const NOVICE_LABEL = "Novato";

export class TierError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TierError";
	}
}

/** Throws unless there are 7 strictly increasing thresholds in (0, 28]. */
export function validateTierThresholds(thresholds: readonly number[]): readonly number[] {
	if (thresholds.length !== STAGE_COUNT) {
		throw new TierError(`Limiares de tier inválidos: esperado ${STAGE_COUNT} valores, recebido ${thresholds.length}.`);
	}
	let previous = 0;
	for (const [index, value] of thresholds.entries()) {
		if (!Number.isFinite(value) || value <= previous || value > PM_MAX) {
			throw new TierError(`Limiares de tier inválidos: τ${index + 1} = ${value} (precisam ser crescentes, > 0 e ≤ ${PM_MAX}).`);
		}
		previous = value;
	}
	return thresholds;
}

/** Throws unless the core has 7 stages and no node appears twice. */
export function validateTierCore(core: TierCore): TierCore {
	if (core.stages.length !== STAGE_COUNT) {
		throw new TierError(`Núcleo canônico inválido: esperado ${STAGE_COUNT} estágios, recebido ${core.stages.length}.`);
	}
	const seen = new Set<string>();
	for (const [stage, ids] of core.stages.entries()) {
		for (const id of ids) {
			if (seen.has(id)) throw new TierError(`Núcleo canônico inválido: o nó "${id}" aparece mais de uma vez (estágio ${stage + 1}).`);
			seen.add(id);
		}
	}
	return core;
}

export function isRetained(R: number | undefined, retainedR: number = DEFAULT_RETAINED_R): boolean {
	return R !== undefined && Number.isFinite(R) && R >= retainedR;
}

/** Retained fraction f_s of each stage (index 0 = stage 1). */
export function stageFractions(core: TierCore, retention: RetentionSnapshot, retainedR: number = DEFAULT_RETAINED_R): number[] {
	return core.stages.map((ids) => {
		if (ids.length === 0) return 0;
		let retained = 0;
		for (const id of ids) if (isRetained(retention.get(id), retainedR)) retained += 1;
		return retained / ids.length;
	});
}

/** PM = Σ_s s · f_s. */
export function masteryPoints(fractions: readonly number[]): number {
	let pm = 0;
	for (const [index, fraction] of fractions.entries()) {
		if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) throw new TierError(`Fração retida inválida no estágio ${index + 1}: ${fraction}.`);
		pm += (index + 1) * fraction;
	}
	return pm;
}

/** Number of thresholds PM has reached (0 = Novato … 7 = Doutor). */
export function tierFromPm(pm: number, thresholds: readonly number[] = DEFAULT_TIER_THRESHOLDS): TierIndex {
	let tier = 0;
	for (const threshold of thresholds) {
		if (pm >= threshold) tier += 1;
		else break;
	}
	return tier as TierIndex;
}

/** r7 §4.2 structural criterion: highest stage s with f_1..f_s all ≥ q. */
export function structuralStage(fractions: readonly number[], quota: number = DEFAULT_STAGE_QUOTA): TierIndex {
	let stage = 0;
	for (const fraction of fractions) {
		if (fraction >= quota) stage += 1;
		else break;
	}
	return Math.min(stage, STAGE_COUNT) as TierIndex;
}

/** Bounds [lo, hi) of the PM band of `tier` (Novato: [0, τ₁); Doutor: [τ₇, 28]). */
export function tierBand(tier: TierIndex, thresholds: readonly number[] = DEFAULT_TIER_THRESHOLDS): { lo: number; hi: number } {
	const lo = tier === 0 ? 0 : (thresholds[tier - 1] ?? PM_MAX);
	const hi = tier >= STAGE_COUNT ? PM_MAX : (thresholds[tier] ?? PM_MAX);
	return { lo, hi };
}

/** III → II → I as PM crosses a third of the tier band (Novato has no division). */
export function divisionFor(pm: number, tier: TierIndex, thresholds: readonly number[] = DEFAULT_TIER_THRESHOLDS): TierDivision | null {
	if (tier === 0) return null;
	const { lo, hi } = tierBand(tier, thresholds);
	const progress = hi > lo ? (pm - lo) / (hi - lo) : 1;
	if (progress >= 2 / 3) return "I";
	if (progress >= 1 / 3) return "II";
	return "III";
}

export function tierInfo(tier: TierIndex): Tier | null {
	return tier === 0 ? null : (TIERS[tier - 1] ?? null);
}

/** "Novato", "Ouro", or "Ouro II" when a division is given. */
export function tierLabel(tier: TierIndex, division: TierDivision | null = null): string {
	const info = tierInfo(tier);
	if (!info) return NOVICE_LABEL;
	return division ? `${info.label} ${division}` : info.label;
}

/** Retained / learned over the whole core: the "forma" ring (1 when nothing was learned). */
export function retentionForm(core: TierCore, retention: RetentionSnapshot, retainedR: number = DEFAULT_RETAINED_R): number {
	let learned = 0;
	let retained = 0;
	for (const ids of core.stages) {
		for (const id of ids) {
			const R = retention.get(id);
			if (R === undefined) continue;
			learned += 1;
			if (isRetained(R, retainedR)) retained += 1;
		}
	}
	return learned === 0 ? 1 : retained / learned;
}

export interface TierOptions {
	thresholds?: readonly number[];
	retainedR?: number;
}

/** Current tier standing of a domain. Depends ONLY on the core and the retention snapshot. */
export function tierStanding(core: TierCore, retention: RetentionSnapshot, options: TierOptions = {}): TierStanding {
	const thresholds = validateTierThresholds(options.thresholds ?? DEFAULT_TIER_THRESHOLDS);
	const retainedR = options.retainedR ?? DEFAULT_RETAINED_R;
	// NaN would silently make every node "not retained" (Novato for everyone).
	if (!(retainedR > 0 && retainedR < 1)) throw new TierError(`Limiar de retenção inválido: ${retainedR} (esperado em (0, 1)).`);
	validateTierCore(core);
	const fractions = stageFractions(core, retention, retainedR);
	const pm = masteryPoints(fractions);
	const tier = tierFromPm(pm, thresholds);
	const division = divisionFor(pm, tier, thresholds);
	const { lo, hi } = tierBand(tier, thresholds);
	return {
		tier,
		tierId: tierInfo(tier)?.id ?? null,
		label: tierLabel(tier, division),
		division,
		pm,
		fractions,
		form: retentionForm(core, retention, retainedR),
		nextThreshold: tier >= STAGE_COUNT ? null : (thresholds[tier] ?? null),
		progressToNext: hi > lo ? Math.min(1, Math.max(0, (pm - lo) / (hi - lo))) : 1,
	};
}

/** The title shown is the peak: never demoted (invariant I4). */
export function updateTierPeak(previousPeak: TierIndex, current: TierIndex): TierIndex {
	return (current > previousPeak ? current : previousPeak) as TierIndex;
}
