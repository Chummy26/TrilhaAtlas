/**
 * Domain and account standing: everything the progress UI shows, derived from
 * the ledger, the learner retention snapshot and the calibrated config
 * (docs/research/00-SINTESE.md §2.11 "Quatro camadas"; r7 §4.1).
 *
 *   XP / level  ← ledger rows of the domain (account: all domains)
 *   tier        ← retention of the frozen core only (never XP)
 *   peaks       ← the two values the store persists: `levelPeak` (a level
 *                 curve recalibration never lowers the level shown) and
 *                 `tierPeak` (a title is never demoted, r7 P8)
 *
 * Pure: browser-safe.
 */

import type { DomainId } from "../domains/types.ts";
import { DEFAULT_PROGRESSION_CONFIG, type ProgressionConfig } from "./config.ts";
import { levelProgress } from "./levels.ts";
import { RULES, type XpRules } from "./rules.ts";
import { tierLabel, tierStanding, updateTierPeak } from "./tiers.ts";
import type { LevelProgress, RetentionSnapshot, Standing, TierCore, TierIndex, XpLedgerEntry } from "./types.ts";
import { summarizeLedger } from "./xp.ts";

export interface StandingInput {
	domainId: DomainId;
	/** Ledger rows (rows of other domains are ignored). */
	entries: readonly XpLedgerEntry[];
	core: TierCore;
	retention: RetentionSnapshot;
	/** Persisted peaks from the previous standing (absent on first computation). */
	peaks?: { levelPeak?: number; tierPeak?: TierIndex };
	config?: ProgressionConfig;
	rules?: XpRules;
}

export function computeStanding(input: StandingInput): Standing {
	const config = input.config ?? DEFAULT_PROGRESSION_CONFIG;
	const rules = input.rules ?? RULES;
	const domainEntries = input.entries.filter((entry) => entry.domainId === input.domainId);
	const xp = summarizeLedger(domainEntries, rules).totalXp;
	const level = levelProgress(xp, config.levelCurve);
	const tier = tierStanding(input.core, input.retention, { thresholds: config.tiers.thresholds, retainedR: config.tiers.retainedR });
	const tierPeak = updateTierPeak(input.peaks?.tierPeak ?? 0, tier.tier);
	return {
		domainId: input.domainId,
		rulesVersion: rules.version,
		xp,
		level,
		levelPeak: Math.max(input.peaks?.levelPeak ?? 1, level.level),
		tier,
		tierPeak,
		tierPeakLabel: tierLabel(tierPeak),
	};
}

/** Account level: the same curve over the XP of every domain (r7 §3). */
export function accountLevel(entries: readonly XpLedgerEntry[], config: ProgressionConfig = DEFAULT_PROGRESSION_CONFIG, rules: XpRules = RULES): LevelProgress {
	return levelProgress(summarizeLedger(entries, rules).totalXp, config.levelCurve);
}
