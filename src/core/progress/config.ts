/**
 * Calibrated progression parameters: the shape of config/progression.json
 * (docs/research/00-SINTESE.md §2.11 "Monte Carlo"; r7 §4.8, §5.4).
 *
 * scripts/calibrate-progression.ts writes the file; the server/store reads it
 * and hands the parsed value to the pure functions here (core never touches
 * the file system). When the file is missing or invalid, callers fall back to
 * `DEFAULT_PROGRESSION_CONFIG` — the r7 values (level curve 20.10·L^1.696,
 * tier thresholds 1.71/3.71/6.32/9.69/13.37/17.69/23.49) with no pace curves
 * or simulated cohort (those UI features then stay hidden).
 *
 * JSON cannot hold Infinity: a "never reached in the horizon" day is `null`.
 *
 * Pure: browser-safe (zod only).
 */

import { z } from "zod";
import { DEFAULT_LEVEL_CURVE } from "./levels.ts";
import { RULES } from "./rules.ts";
import { DEFAULT_RETAINED_R, DEFAULT_STAGE_QUOTA, DEFAULT_TIER_THRESHOLDS, PM_MAX, STAGE_COUNT } from "./tiers.ts";
import type { LevelCurve } from "./types.ts";

/** Quantiles of cumulative XP of one simulated profile, by study day ("Eu vs Eu"). */
export interface PaceCurve {
	profileId: string;
	hoursPerDay: number;
	/** 1-based study days (day 1 = first day) at which quantiles are stored, ascending. */
	days: number[];
	/** xp[i][j] = quantile `pace.quantiles[j]` of cumulative XP at the end of `days[i]`. */
	xp: number[][];
	/** pm[i][j] = same quantile of the mastery points (PM) at the last weekly evaluation ≤ days[i]. */
	pm: number[][];
}

/**
 * When each tier is reached (PM criterion) for one profile: the honest forecast.
 *
 * Day convention (differs from `PaceCurve.days`, which is 1-based): days
 * ELAPSED since the first study day, as in r7 §5.2 — tiers are evaluated at
 * the end of each 7th day, so the first evaluation is day 6. Add 1 to compare
 * with a 1-based study day.
 */
export interface TierForecast {
	profileId: string;
	hoursPerDay: number;
	/** Per tier 1..7: median / p10 / p90 elapsed day (null = not reached by that quantile within the horizon). */
	medianDay: (number | null)[];
	p10Day: (number | null)[];
	p90Day: (number | null)[];
	/** Fraction of simulated learners reaching each tier within the horizon. */
	reachedFraction: number[];
	/** Median study hours until Doutor (null when the median does not reach it). */
	doctorMedianHours: number | null;
}

/** Weekly XP distribution of one profile: what the opt-in simulated cohort is sampled from. */
export interface CohortProfile {
	profileId: string;
	hoursPerDay: number;
	/** Quantiles (at `cohort.quantiles`) of XP per week, weeks 2–52 pooled. */
	weeklyXp: number[];
}

export interface ProgressionConfig {
	schemaVersion: 1;
	rulesVersion: string;
	generatedAt: string;
	source: {
		script: string;
		seed: number;
		learnersPerProfile: number;
		days: number;
		coreNodes: number;
		desiredRetention: number;
		/** Memory model the simulator ran on ("fsrs-7" = the runtime learner's); absent in files written before it was recorded. */
		memoryModel?: string;
	} | null;
	levelCurve: LevelCurve;
	tiers: {
		/** τ₁..τ₇ on the PM scale (0..28), strictly increasing. */
		thresholds: number[];
		retainedR: number;
		stageQuota: number;
		/** Profile the thresholds were calibrated on and its target day per tier (elapsed days, as in TierForecast). */
		referenceProfile: string | null;
		targetDays: number[] | null;
	};
	pace: { quantiles: number[]; curves: PaceCurve[] };
	forecast: TierForecast[];
	cohort: {
		/** pt-BR label that MUST be shown with the cohort (r7 P5: never pretend they are people). */
		label: string;
		size: number;
		quantiles: number[];
		profiles: CohortProfile[];
	};
}

export const SIMULATED_COHORT_LABEL = "Coorte simulada — rivais gerados pela simulação, não são pessoas reais";

/** Recursively frozen copy: the fallback config is shared, so nobody may mutate it. */
function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}

export const DEFAULT_PROGRESSION_CONFIG: Readonly<ProgressionConfig> = deepFreeze<ProgressionConfig>({
	schemaVersion: 1,
	rulesVersion: RULES.version,
	generatedAt: "2026-11-18T00:00:00.000Z",
	source: null,
	levelCurve: { ...DEFAULT_LEVEL_CURVE },
	tiers: {
		thresholds: [...DEFAULT_TIER_THRESHOLDS],
		retainedR: DEFAULT_RETAINED_R,
		stageQuota: DEFAULT_STAGE_QUOTA,
		referenceProfile: null,
		targetDays: null,
	},
	pace: { quantiles: [], curves: [] },
	forecast: [],
	cohort: { label: SIMULATED_COHORT_LABEL, size: 29, quantiles: [], profiles: [] },
});

export class ProgressionConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ProgressionConfigError";
	}
}

const finite = z.number().refine(Number.isFinite, "número finito");
const nonNegative = finite.refine((x) => x >= 0, "≥ 0");
const ascending = (values: readonly number[]): boolean => values.every((value, i) => i === 0 || value > (values[i - 1] as number));
const nonDecreasing = (values: readonly number[]): boolean => values.every((value, i) => i === 0 || value >= (values[i - 1] as number));
const quantileList = z.array(finite.refine((q) => q >= 0 && q <= 1, "quantil em [0, 1]")).refine(ascending, "quantis crescentes");
const nullableDay = nonNegative.nullable();
const perTier = <T extends z.ZodType>(item: T) => z.array(item).length(STAGE_COUNT);

const configSchema = z.object({
	schemaVersion: z.literal(1),
	rulesVersion: z.string().min(1),
	generatedAt: z.string().min(1),
	source: z
		.object({
			script: z.string(),
			seed: finite,
			learnersPerProfile: z.number().int().positive(),
			days: z.number().int().positive(),
			coreNodes: z.number().int().positive(),
			desiredRetention: finite,
			memoryModel: z.string().min(1).optional(),
		})
		.nullable(),
	levelCurve: z.object({ a: finite.refine((a) => a > 0, "a > 0"), p: finite.refine((p) => p >= 1 && p <= 3, "1 ≤ p ≤ 3") }),
	tiers: z.object({
		thresholds: perTier(finite)
			.refine(ascending, "limiares crescentes")
			.refine((t) => (t[0] ?? 0) > 0 && (t[t.length - 1] ?? Infinity) <= PM_MAX, `limiares em (0, ${PM_MAX}]`),
		retainedR: finite.refine((r) => r > 0 && r < 1, "0 < R < 1"),
		stageQuota: finite.refine((q) => q > 0 && q <= 1, "0 < q ≤ 1"),
		referenceProfile: z.string().nullable(),
		targetDays: perTier(nonNegative).nullable(),
	}),
	pace: z.object({
		quantiles: quantileList,
		curves: z.array(
			z.object({
				profileId: z.string().min(1),
				hoursPerDay: nonNegative,
				days: z.array(z.number().int().positive()).min(1, "ao menos um dia").refine(ascending, "dias crescentes"),
				xp: z.array(z.array(nonNegative).refine(nonDecreasing, "quantis de XP não decrescentes")),
				pm: z.array(z.array(nonNegative)),
			}),
		),
	}),
	forecast: z.array(
		z.object({
			profileId: z.string().min(1),
			hoursPerDay: nonNegative,
			medianDay: perTier(nullableDay),
			p10Day: perTier(nullableDay),
			p90Day: perTier(nullableDay),
			reachedFraction: perTier(finite.refine((f) => f >= 0 && f <= 1, "fração em [0, 1]")),
			doctorMedianHours: nonNegative.nullable(),
		}),
	),
	cohort: z.object({
		label: z.string().min(1),
		size: z.number().int().min(1).max(99),
		quantiles: quantileList,
		profiles: z.array(
			z.object({
				profileId: z.string().min(1),
				hoursPerDay: nonNegative,
				weeklyXp: z.array(nonNegative).refine(nonDecreasing, "quantis de XP semanal não decrescentes"),
			}),
		),
	}),
});

/** Validate a parsed config/progression.json; throws ProgressionConfigError with a pt-BR message. */
export function parseProgressionConfig(raw: unknown): ProgressionConfig {
	const result = configSchema.safeParse(raw);
	if (!result.success) {
		const issue = result.error.issues[0];
		const where = issue?.path.length ? issue.path.join(".") : "(raiz)";
		throw new ProgressionConfigError(`config/progression.json inválido em ${where}: ${issue?.message ?? "formato inesperado"}.`);
	}
	const config = result.data as ProgressionConfig;
	// pacePercentile / simulatedRivals interpolate between quantile points: a file that parses must be usable.
	if (config.pace.curves.length > 0 && config.pace.quantiles.length < 2) {
		throw new ProgressionConfigError("config/progression.json inválido: pace.quantiles precisa de ao menos 2 quantis quando há curvas.");
	}
	if (config.cohort.profiles.length > 0 && config.cohort.quantiles.length < 2) {
		throw new ProgressionConfigError("config/progression.json inválido: cohort.quantiles precisa de ao menos 2 quantis quando há perfis.");
	}
	for (const curve of config.pace.curves) {
		const width = config.pace.quantiles.length;
		if (curve.xp.length !== curve.days.length || curve.pm.length !== curve.days.length) {
			throw new ProgressionConfigError(`config/progression.json inválido: curva "${curve.profileId}" tem ${curve.days.length} dias mas linhas de tamanho diferente.`);
		}
		if ([...curve.xp, ...curve.pm].some((row) => row.length !== width)) {
			throw new ProgressionConfigError(`config/progression.json inválido: curva "${curve.profileId}" não tem ${width} quantis por dia.`);
		}
	}
	for (const profile of config.cohort.profiles) {
		if (profile.weeklyXp.length !== config.cohort.quantiles.length) {
			throw new ProgressionConfigError(`config/progression.json inválido: coorte "${profile.profileId}" não tem ${config.cohort.quantiles.length} quantis.`);
		}
	}
	return config;
}

/** Parse or fall back to the defaults (never throws): the store's read path. */
export function progressionConfigOrDefault(raw: unknown): { config: ProgressionConfig; error: string | null } {
	if (raw === undefined || raw === null) return { config: DEFAULT_PROGRESSION_CONFIG, error: null };
	try {
		return { config: parseProgressionConfig(raw), error: null };
	} catch (error) {
		return { config: DEFAULT_PROGRESSION_CONFIG, error: error instanceof Error ? error.message : String(error) };
	}
}
