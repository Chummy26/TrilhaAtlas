/**
 * Progress module barrel: XP ledger, levels, Elo, tiers, region badges,
 * weekly streak, calibrated config, opt-in comparisons and the Monte Carlo
 * simulator (docs/research/00-SINTESE.md §2.11; r7 part A).
 *
 * Pure and browser-safe. The store persists `xp-ledger.jsonl`, `streak.json`
 * and `standing.json` (SÍNTESE §2.2) and reads config/progression.json; this
 * module only decides.
 *
 * Names another core barrel already exports are left out (they would be
 * ambiguous in src/core/index.ts): `expectedScore` (see below). The generic
 * simulate.ts statistics helpers (`quantile`, `quantileSorted`,
 * `firstWeekDay`) stay out too; import them from ./simulate.ts.
 */

export * from "./types.ts";
export * from "./rules.ts";
// `expectedScore` stays in ./elo.ts (same formula as src/core/lesson's export of that name): star-exporting
// both from src/core/index.ts would be an ambiguous re-export (TS2308), so the barrel leaves it out.
export { ELO_PER_LOGIT, eloK, eloUpdate, itemPriorB, type ItemEloUpdate } from "./elo.ts";
export * from "./xp.ts";
export * from "./levels.ts";
export * from "./tiers.ts";
export * from "./badges.ts";
export * from "./streak.ts";
export * from "./config.ts";
export * from "./schema.ts";
export * from "./standing.ts";
export * from "./cohort.ts";
export * from "./random.ts";
export {
	createMemoryModel,
	DEFAULT_SIM_PARAMS,
	fsrs6Memory,
	fsrs7Memory,
	honestProfile,
	REFERENCE_CORE,
	SIM_MAXIMUM_INTERVAL_DAYS,
	simulateCohort,
	simulateLearner,
	type FarmerStrategy,
	type LearnerProfile,
	type LearnerTrajectory,
	type MemoryGrade,
	type MemoryModel,
	type SimCreditEvent,
	type SimDomain,
	type SimMemory,
	type SimMemoryState,
	type SimParams,
	type SimStage,
	type SimulateOptions,
} from "./simulate.ts";
