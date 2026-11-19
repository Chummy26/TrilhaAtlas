/**
 * Region mastery badges (docs/research/00-SINTESE.md §2.11 layer 3; r7 §4.5).
 *
 * Derived from learner-model signals per node of a graph region, weighted by
 * w_n (default 1):
 *
 *   Explorada    ≥ 1 node learned (attained)
 *   Familiar     ≥ 50 % learned
 *   Proficiente  ≥ 80 % retained (attained ∧ R ≥ 0.7)
 *   Dominada     ≥ 90 % retained ∧ region "boss" passed
 *   Enferrujada  overlay: the peak was Proficiente/Dominada but the retained
 *                fraction fell below 70 % → "Restaurar" opens a review session
 *                of `restoreTargets`
 *
 * The badge SHOWN is the peak (never taken away, r7 P8); `current` is what the
 * signals support now. Badges give 0 XP (mastery is not a currency, r7 §4.3).
 *
 * Pure: browser-safe.
 */

import { DEFAULT_RETAINED_R, isRetained } from "./tiers.ts";
import type { RegionBadgeLevel, RegionBadgeState, RegionNodeSignal, RegionSignals } from "./types.ts";

export const BADGE_ORDER: readonly RegionBadgeLevel[] = Object.freeze(["none", "explored", "familiar", "proficient", "mastered"]);

export const BADGE_LABELS: Readonly<Record<RegionBadgeLevel, string>> = Object.freeze({
	none: "Inexplorada",
	explored: "Explorada",
	familiar: "Familiar",
	proficient: "Proficiente",
	mastered: "Dominada",
});

export const RUSTY_LABEL = "Enferrujada";

export interface BadgeThresholds {
	familiarLearned: number;
	proficientRetained: number;
	masteredRetained: number;
	/** Below this retained fraction a Proficiente/Dominada peak shows "Enferrujada". */
	rustyBelow: number;
	retainedR: number;
}

export const DEFAULT_BADGE_THRESHOLDS: Readonly<BadgeThresholds> = Object.freeze({
	familiarLearned: 0.5,
	proficientRetained: 0.8,
	masteredRetained: 0.9,
	rustyBelow: 0.7,
	retainedR: DEFAULT_RETAINED_R,
});

export class BadgeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BadgeError";
	}
}

export function badgeRank(level: RegionBadgeLevel): number {
	return BADGE_ORDER.indexOf(level);
}

export function maxBadge(a: RegionBadgeLevel, b: RegionBadgeLevel): RegionBadgeLevel {
	return badgeRank(a) >= badgeRank(b) ? a : b;
}

function nodeWeight(node: RegionNodeSignal): number {
	const weight = node.weight ?? 1;
	if (!Number.isFinite(weight) || weight < 0) throw new BadgeError(`Peso inválido para o nó "${node.nodeId}": ${node.weight}.`);
	return weight;
}

/** Weighted learned and retained fractions of a region (0 when the region has no weight). */
export function regionFractions(
	nodes: readonly RegionNodeSignal[],
	retainedR: number = DEFAULT_RETAINED_R,
): { learnedFraction: number; retainedFraction: number; anyLearned: boolean } {
	let total = 0;
	let learned = 0;
	let retained = 0;
	let anyLearned = false;
	for (const node of nodes) {
		const weight = nodeWeight(node);
		total += weight;
		if (!node.attained) continue;
		anyLearned = true;
		learned += weight;
		if (isRetained(node.R, retainedR)) retained += weight;
	}
	return {
		learnedFraction: total > 0 ? learned / total : 0,
		retainedFraction: total > 0 ? retained / total : 0,
		anyLearned,
	};
}

/** Level the region signals support right now. */
export function currentBadge(signals: RegionSignals, thresholds: BadgeThresholds = DEFAULT_BADGE_THRESHOLDS): RegionBadgeLevel {
	const { learnedFraction, retainedFraction, anyLearned } = regionFractions(signals.nodes, thresholds.retainedR);
	if (retainedFraction >= thresholds.masteredRetained && signals.bossPassed) return "mastered";
	if (retainedFraction >= thresholds.proficientRetained) return "proficient";
	if (learnedFraction >= thresholds.familiarLearned) return "familiar";
	if (anyLearned) return "explored";
	return "none";
}

/**
 * Badge state of a region. `previousPeak` is the persisted peak (absent on the
 * first evaluation); the returned `peak` is never lower than it.
 */
export function regionBadge(
	signals: RegionSignals,
	previousPeak: RegionBadgeLevel = "none",
	thresholds: BadgeThresholds = DEFAULT_BADGE_THRESHOLDS,
): RegionBadgeState {
	const { learnedFraction, retainedFraction } = regionFractions(signals.nodes, thresholds.retainedR);
	const current = currentBadge(signals, thresholds);
	const peak = maxBadge(previousPeak, current);
	const rusty = badgeRank(peak) >= badgeRank("proficient") && retainedFraction < thresholds.rustyBelow;
	const label = rusty ? `${BADGE_LABELS[peak]} · ${RUSTY_LABEL}` : BADGE_LABELS[peak];
	return { regionId: signals.regionId, current, peak, rusty, learnedFraction, retainedFraction, label };
}

/** Attained nodes that are no longer retained, weakest (lowest R) first: the "Restaurar" session. */
export function restoreTargets(signals: RegionSignals, retainedR: number = DEFAULT_RETAINED_R): string[] {
	return signals.nodes
		.filter((node) => node.attained && !isRetained(node.R, retainedR))
		.sort((a, b) => (a.R ?? 0) - (b.R ?? 0) || (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0))
		.map((node) => node.nodeId);
}
