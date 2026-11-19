/**
 * XP rule set, versioned (docs/research/00-SINTESE.md §2.11; r7 §2.3, §4.3,
 * §5.7).
 *
 * Every number that turns an event into XP lives here, under one version tag
 * that is written on every ledger row (`rulesVersion`). Recalibration policy:
 *
 *   • a recalibration produces a NEW rule set with a NEW version
 *     (`deriveRules`); it only prices events credited after it;
 *   • ledger rows already granted are final — replays keep them verbatim
 *     (`replayXpLedger(..., { existing })` in ./xp.ts), so recalibrating can
 *     never reduce XP that was already granted (invariant I7 of the SÍNTESE
 *     list / r7 P8 "nada é perdido").
 *
 * `validateRules` enforces the structural guarantees the invariants rely on:
 * every multiplier ≤ 1.5 (⇒ XP/h ≤ 90, r7 I5), soft-cap factors in [0, 1] and
 * non-increasing (⇒ the cap only ever reduces), no negative credit (⇒ I1).
 *
 * Deviation from r7 §4.3, documented: the "lapse ×0.8" review factor is NOT
 * part of the rules, because for flashcards a lapse IS the Again rating, and
 * XP must never depend on the self-assessment (I7). Review XP depends only on
 * time and on R.
 *
 * Pure: browser-safe.
 */

import type { RulesVersion } from "./types.ts";

export interface SoftCapTier {
	/** Credited minutes already accounted today from which `factor` applies. */
	afterMin: number;
	factor: number;
}

export interface XpRules {
	version: RulesVersion;
	/** E* — target expected score (Wilson et al. 85 % rule → 0.80). */
	targetExpected: number;
	/** Default desired retention DR of the review schedule. */
	desiredRetention: number;
	mDifMin: number;
	mDifMax: number;
	gReviewMin: number;
	gReviewMax: number;
	/** Daily soft cap (per account): ascending `afterMin`, non-increasing factors. */
	softCap: readonly SoftCapTier[];
	/** Lesson credited time ≤ this × expected time. */
	lessonMaxOverExpected: number;
	/** Effort credit for a failed or missing comprehension check. */
	lessonFailCredit: number;
	/** A failed check after less than this × expected time is a rush: 0 XP. */
	lessonRushFraction: number;
	/** Passive media is worth this × focused time. */
	mediaFactor: number;
	itemWrongCredit: number;
	/** Wrong AND faster than this × median = guess: 0 XP. */
	itemGuessFraction: number;
	itemHintPenalty: number;
	itemHintFloor: number;
	/** Item credited time ≤ this × median time (when a median is known). */
	itemMaxOverMedian: number;
	reviewMaxMinPerCard: number;
	reviewAnkiMaxSecPerCard: number;
	/** Node (non-card) review credited time cap, minutes. */
	reviewNodeMaxMin: number;
	diagnosticMinPerItem: number;
	/** Rounding of granted XP (1 → 0.1 XP). */
	xpDecimals: number;
}

/** Upper bound for any multiplier: keeps XP/h ≤ 90 (r7 invariant I5). */
export const MAX_MULTIPLIER = 1.5;

/** The current rule set (r7 §4.3 + the lesson rush rule calibrated by the Monte Carlo). */
export const RULES: Readonly<XpRules> = Object.freeze({
	version: "2026-11-r1",
	targetExpected: 0.8,
	desiredRetention: 0.9,
	mDifMin: 0.3,
	mDifMax: 1.5,
	gReviewMin: 0.1,
	gReviewMax: 1.5,
	softCap: Object.freeze([Object.freeze({ afterMin: 240, factor: 0.5 }), Object.freeze({ afterMin: 360, factor: 0.25 })]),
	lessonMaxOverExpected: 1.5,
	lessonFailCredit: 0.25,
	lessonRushFraction: 0.5,
	mediaFactor: 0.8,
	itemWrongCredit: 0.5,
	itemGuessFraction: 0.2,
	itemHintPenalty: 0.2,
	itemHintFloor: 0.4,
	itemMaxOverMedian: 1.5,
	reviewMaxMinPerCard: 2,
	reviewAnkiMaxSecPerCard: 60,
	reviewNodeMaxMin: 15,
	diagnosticMinPerItem: 1,
	xpDecimals: 1,
}) as Readonly<XpRules>;

export class ProgressRuleError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ProgressRuleError";
	}
}

function requireRange(name: string, value: number, lo: number, hi: number): void {
	if (!Number.isFinite(value) || value < lo || value > hi) {
		throw new ProgressRuleError(`Regra de XP inválida: ${name} = ${value} (esperado entre ${lo} e ${hi}).`);
	}
}

/** Throws ProgressRuleError when a rule set would break an invariant (I1, I5, soft cap monotonic). */
export function validateRules(rules: XpRules): XpRules {
	// Same rule as the ledger schema: a version with surrounding spaces would write rows the reader refuses.
	if (typeof rules.version !== "string" || rules.version.trim() === "" || rules.version.trim() !== rules.version) {
		throw new ProgressRuleError(`Regra de XP inválida: version ${JSON.stringify(rules.version)} (não vazia, sem espaços nas pontas).`);
	}
	requireRange("targetExpected", rules.targetExpected, 0.5, 0.99);
	requireRange("desiredRetention", rules.desiredRetention, 0.7, 0.99);
	requireRange("mDifMin", rules.mDifMin, 0, MAX_MULTIPLIER);
	requireRange("mDifMax", rules.mDifMax, rules.mDifMin, MAX_MULTIPLIER);
	requireRange("gReviewMin", rules.gReviewMin, 0, MAX_MULTIPLIER);
	requireRange("gReviewMax", rules.gReviewMax, rules.gReviewMin, MAX_MULTIPLIER);
	requireRange("lessonMaxOverExpected", rules.lessonMaxOverExpected, 1, 3);
	requireRange("lessonFailCredit", rules.lessonFailCredit, 0, 1);
	requireRange("lessonRushFraction", rules.lessonRushFraction, 0, 1);
	requireRange("mediaFactor", rules.mediaFactor, 0, 1);
	requireRange("itemWrongCredit", rules.itemWrongCredit, 0, 1);
	requireRange("itemGuessFraction", rules.itemGuessFraction, 0, 1);
	requireRange("itemHintPenalty", rules.itemHintPenalty, 0, 1);
	requireRange("itemHintFloor", rules.itemHintFloor, 0, 1);
	requireRange("itemMaxOverMedian", rules.itemMaxOverMedian, 1, 3);
	requireRange("reviewMaxMinPerCard", rules.reviewMaxMinPerCard, 0.1, 10);
	requireRange("reviewAnkiMaxSecPerCard", rules.reviewAnkiMaxSecPerCard, 1, 600);
	requireRange("reviewNodeMaxMin", rules.reviewNodeMaxMin, 1, 60);
	requireRange("diagnosticMinPerItem", rules.diagnosticMinPerItem, 0, 10);
	if (!Number.isInteger(rules.xpDecimals) || rules.xpDecimals < 0 || rules.xpDecimals > 3) {
		throw new ProgressRuleError(`Regra de XP inválida: xpDecimals = ${rules.xpDecimals} (inteiro 0–3).`);
	}
	let previousAfter = 0;
	let previousFactor = 1;
	for (const [index, tier] of rules.softCap.entries()) {
		requireRange(`softCap[${index}].afterMin`, tier.afterMin, previousAfter, 24 * 60);
		requireRange(`softCap[${index}].factor`, tier.factor, 0, previousFactor);
		if (index > 0 && tier.afterMin === previousAfter) {
			throw new ProgressRuleError(`Regra de XP inválida: softCap[${index}].afterMin repete ${tier.afterMin}.`);
		}
		previousAfter = tier.afterMin;
		previousFactor = tier.factor;
	}
	return rules;
}

/**
 * A recalibrated rule set. The version MUST change: ledger rows keep the
 * version that priced them, and rows already granted are never re-priced.
 */
export function deriveRules(base: XpRules, patch: Partial<Omit<XpRules, "version">>, version: RulesVersion): Readonly<XpRules> {
	if (version === base.version) {
		throw new ProgressRuleError(`Recalibração exige nova versão de regras (recebido "${version}", igual à atual).`);
	}
	const next: XpRules = { ...base, ...patch, version, softCap: (patch.softCap ?? base.softCap).map((tier) => ({ ...tier })) };
	return Object.freeze(validateRules(next));
}

/** Round to the rule set's XP precision (half away from zero is irrelevant: XP ≥ 0). */
export function roundXp(value: number, rules: XpRules = RULES): number {
	const scale = 10 ** rules.xpDecimals;
	return Math.round(value * scale) / scale;
}
