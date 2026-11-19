/**
 * Monte Carlo calibration of levels and tiers → config/progression.json
 * (docs/research/00-SINTESE.md §2.11 "Monte Carlo", M7; r7 §5).
 *
 * Usage:  npx tsx scripts/calibrate-progression.ts [--learners 2000] [--seed 20261118] [--days 1100]
 *                                                  [--out config/progression.json] [--doc docs/impl/progress.md]
 *
 * Runs the PURE simulator of src/core/progress/simulate.ts, which prices every
 * credit with the same `eventCredit` + `softCapped` the runtime ledger uses,
 * measures mastery with the same `masteryPoints` / `structuralStage` and
 * schedules reviews with the runtime learner's memory model (ts-fsrs FSRS-7,
 * default weights; recorded as `source.memoryModel`).
 *
 * Calibration (r7 §5.4 recipe):
 *   1. level curve a·L^p through the 3 h/day medians: L10 on day 7, L100 on
 *      day 365 (`fitLevelCurve`);
 *   2. tier thresholds τ_k = median, over the 3 h/day learners, of the PM at
 *      the weekly evaluation where each learner COMPLETES stage k under the
 *      structural criterion (r7 §4.2: f_1..f_k ≥ q = 0.8). The continuous PM
 *      tier then lines up with the structural one, and the 3 h/day calendar
 *      it yields reproduces r7 §5.2 (6/27/76/160/279/412/556 d, Doutor ≈ 18.2
 *      months). Deviation from r7 §5.4, documented: r7 took the median PM at
 *      weeks 2/6/13/24/37/52/70, which puts Doutor at week 70 (≈ 16 months)
 *      and contradicts its own §5.2; anchoring PM at a fixed late day is also
 *      degenerate here, because a learner who finished the core has PM = 28
 *      (DR 0.9 keeps practically every learned node at R ≥ 0.7), so τ₇ would
 *      become 28 = "never forget a single node";
 *   3. validation: Doutor medians at 3/4 h/day (18.2 ± 1 / 11.6–13.6
 *      months) and at 2 h/day ≈ 27 months with r7's own statistic (median
 *      among the learners who reach Doutor within 1 000 days), farmers
 *      ≤ 0.7 × honest XP/h, thresholds monotonic;
 *   4. outputs: pace quantiles per day ("Eu vs Eu"), tier forecasts per daily
 *      budget, weekly-XP quantiles for the opt-in simulated cohort.
 *
 * Writes config/progression.json and the results block of
 * docs/impl/progress.md (between the calibration markers). Exits with code 1
 * when an acceptance check fails (files are still written, marked ✗).
 * Deterministic for a given seed (only `generatedAt` changes).
 *
 * Both files are replaced atomically (src/store/atomic-write.ts: temp + fsync
 * + rename, with the Windows retry), so the app never reads a half-written
 * config/progression.json (which would silently fall back to the defaults).
 * The doc keeps its own line endings (a CRLF checkout stays CRLF).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseProgressionConfig, SIMULATED_COHORT_LABEL, type CohortProfile, type PaceCurve, type ProgressionConfig, type TierForecast } from "../src/core/progress/config.ts";
import { fitLevelCurve, levelFromXp, xpForLevel, xpToAdvance } from "../src/core/progress/levels.ts";
import { RULES } from "../src/core/progress/rules.ts";
import {
	DEFAULT_SIM_PARAMS,
	firstWeekDay,
	fsrs7Memory,
	honestProfile,
	quantileSorted,
	REFERENCE_CORE,
	simulateCohort,
	type LearnerProfile,
	type LearnerTrajectory,
} from "../src/core/progress/simulate.ts";
import { DEFAULT_RETAINED_R, DEFAULT_STAGE_QUOTA, STAGE_COUNT, TIERS, validateTierThresholds } from "../src/core/progress/tiers.ts";
import type { LevelCurve } from "../src/core/progress/types.ts";
import { writeFileAtomicSync } from "../src/store/atomic-write.ts";

// ─── CLI ────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argValue(name: string, fallback: string): string {
	const index = process.argv.indexOf(`--${name}`);
	if (index === -1) return fallback;
	const value = process.argv[index + 1];
	if (value === undefined || value.startsWith("--")) throw new Error(`Faltou o valor de --${name}.`);
	return value;
}

function intArg(name: string, fallback: number, min: number): number {
	const value = Number(argValue(name, String(fallback)));
	if (!Number.isInteger(value) || value < min) throw new Error(`--${name} precisa ser um inteiro ≥ ${min} (recebido ${value}).`);
	return value;
}

const LEARNERS = intArg("learners", 2000, 10);
const SEED = intArg("seed", 20261118, 0);
const DAYS = intArg("days", 1100, 400);
const OUT = path.resolve(ROOT, argValue("out", "config/progression.json"));
const DOC = path.resolve(ROOT, argValue("doc", "docs/impl/progress.md"));
const FARM_DAYS = 180;

/** r7 §5.2: medians (days) of the structural criterion at 3 h/day — the calendar the calibration must reproduce. */
const R7_CALENDAR_3H = [6, 27, 76, 160, 279, 412, 556] as const;
const PACE_QUANTILES = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95];
const COHORT_QUANTILES = Array.from({ length: 21 }, (_, i) => i / 20);
const PACE_DAYS = [
	1, 2, 3, 4, 5, 6, 7, 10, 14, 21, 28, 35, 42, 49, 56, 63, 70, 77, 84, 91, 105, 120, 135, 150, 165, 180, 210, 240, 270, 300, 330, 365, 425, 485, 545, 605,
	665, 730, 800, 870, 940, 1010, 1095,
].filter((day) => day <= DAYS);
const XP_MARKS = [1, 7, 30, 90, 180, 365, 540, 730, 1095].filter((day) => day <= DAYS);
const DAYS_PER_MONTH = 30.44;

// ─── helpers ────────────────────────────────────────────────────────────────

const sorted = (values: Iterable<number>): Float64Array => Float64Array.from(values).sort();
const median = (values: Iterable<number>): number => quantileSorted(sorted(values), 0.5);
const round = (x: number, decimals: number): number => Math.round(x * 10 ** decimals) / 10 ** decimals;
const finiteOrNull = (x: number, decimals = 0): number | null => (Number.isFinite(x) ? round(x, decimals) : null);
const months = (days: number): string => (Number.isFinite(days) ? (days / DAYS_PER_MONTH).toFixed(1).replace(".", ",") : "—");
const fmt = (x: number, decimals = 0): string => (Number.isFinite(x) ? x.toFixed(decimals).replace(".", ",") : "—");
const fmtInt = (x: number): string => (Number.isFinite(x) ? Math.round(x).toLocaleString("pt-BR") : "—");

function log(message: string): void {
	process.stdout.write(`${message}\n`);
}

function timed<T>(label: string, run: () => T): T {
	const started = performance.now();
	const result = run();
	log(`  ${label}: ${((performance.now() - started) / 1000).toFixed(1)} s`);
	return result;
}

/** XP/h over the first `days` days. */
function xpPerHour(t: LearnerTrajectory, days: number, naive = false): number {
	const minutes = t.cumMinutes[days - 1] as number;
	const xp = (naive ? t.cumNaiveXp : t.cumXp)[days - 1] as number;
	return minutes > 0 ? xp / (minutes / 60) : 0;
}

/** PM at the last weekly evaluation on or before 1-based study day `day` (0 before the first). */
function pmAtDay(t: LearnerTrajectory, day: number): number {
	const week = Math.floor((day - 7) / 7);
	return week >= 0 ? (t.pmByWeek[Math.min(week, t.pmByWeek.length - 1)] as number) : 0;
}

function tierDays(trajectories: readonly LearnerTrajectory[], thresholds: readonly number[]): Float64Array[] {
	return thresholds.map((tau) => sorted(trajectories.map((t) => firstWeekDay(t.pmByWeek, (pm) => pm >= tau))));
}

function structuralDays(trajectories: readonly LearnerTrajectory[]): Float64Array[] {
	return TIERS.map((tier) => sorted(trajectories.map((t) => firstWeekDay(t.stageByWeek, (stage) => stage >= tier.index))));
}

/** Number of tier thresholds reached before 0-based day `days`. */
function tiersBefore(t: LearnerTrajectory, thresholds: readonly number[], days: number): number {
	return thresholds.filter((tau) => firstWeekDay(t.pmByWeek, (pm) => pm >= tau) < days).length;
}

function hoursUntil(t: LearnerTrajectory, day: number): number {
	return Number.isFinite(day) ? (t.cumMinutes[Math.min(day, t.cumMinutes.length - 1)] as number) / 60 : Number.POSITIVE_INFINITY;
}

interface ProfileSummary {
	profile: LearnerProfile;
	tierDays: Float64Array[];
	structuralDays: Float64Array[];
	doctorHours: Float64Array;
	xpAt: Map<number, number>;
	xpPerHour180: number;
	naivePerHour180: number;
	pm180: number;
	tiers180: number;
	reviewShare: number;
	reviewShareBase: number;
	pace: PaceCurve;
	weeklyXp: number[];
}

function summarize(profile: LearnerProfile, trajectories: readonly LearnerTrajectory[], thresholds: readonly number[]): ProfileSummary {
	const pmTierDays = tierDays(trajectories, thresholds);
	const doctorTau = thresholds[STAGE_COUNT - 1] as number;
	const doctorHours = sorted(trajectories.map((t) => hoursUntil(t, firstWeekDay(t.pmByWeek, (pm) => pm >= doctorTau))));
	const xpAt = new Map(XP_MARKS.map((day) => [day, median(trajectories.map((t) => t.cumXp[day - 1] as number))]));
	const pace: PaceCurve = {
		profileId: profile.id,
		hoursPerDay: profile.hoursPerDay,
		days: PACE_DAYS,
		xp: PACE_DAYS.map((day) => {
			const values = sorted(trajectories.map((t) => t.cumXp[day - 1] as number));
			return PACE_QUANTILES.map((q) => round(quantileSorted(values, q), 1));
		}),
		pm: PACE_DAYS.map((day) => {
			const values = sorted(trajectories.map((t) => pmAtDay(t, day)));
			return PACE_QUANTILES.map((q) => round(quantileSorted(values, q), 3));
		}),
	};
	const weekly: number[] = [];
	const lastWeek = Math.min(52, Math.floor(DAYS / 7));
	for (const t of trajectories) {
		for (let week = 1; week < lastWeek; week++) weekly.push((t.cumXp[week * 7 + 6] as number) - (t.cumXp[week * 7 - 1] as number));
	}
	const weeklySorted = sorted(weekly);
	return {
		profile,
		tierDays: pmTierDays,
		structuralDays: structuralDays(trajectories),
		doctorHours,
		xpAt,
		xpPerHour180: median(trajectories.map((t) => xpPerHour(t, FARM_DAYS))),
		naivePerHour180: median(trajectories.map((t) => xpPerHour(t, FARM_DAYS, true))),
		pm180: median(trajectories.map((t) => pmAtDay(t, FARM_DAYS))),
		tiers180: median(trajectories.map((t) => tiersBefore(t, thresholds, FARM_DAYS))),
		reviewShare: median(trajectories.map((t) => t.reviewMinutes / Math.max(1, t.reviewMinutes + t.lessonMinutes))),
		reviewShareBase: median(trajectories.map((t) => (t.reviews * DEFAULT_SIM_PARAMS.reviewMin) / Math.max(1, t.reviewMinutes + t.lessonMinutes))),
		pace,
		weeklyXp: COHORT_QUANTILES.map((q) => round(quantileSorted(weeklySorted, q), 1)),
	};
}

function forecastOf(summary: ProfileSummary): TierForecast {
	return {
		profileId: summary.profile.id,
		hoursPerDay: summary.profile.hoursPerDay,
		medianDay: summary.tierDays.map((days) => finiteOrNull(quantileSorted(days, 0.5))),
		p10Day: summary.tierDays.map((days) => finiteOrNull(quantileSorted(days, 0.1))),
		p90Day: summary.tierDays.map((days) => finiteOrNull(quantileSorted(days, 0.9))),
		reachedFraction: summary.tierDays.map((days) => round(days.filter(Number.isFinite).length / days.length, 4)),
		doctorMedianHours: finiteOrNull(quantileSorted(summary.doctorHours, 0.5)),
	};
}

// ─── run ────────────────────────────────────────────────────────────────────

const params = { days: DAYS };
/** The runtime learner's model (src/core/learner/fsrs.ts): FSRS-7 with its default weights. */
const memory = fsrs7Memory();
const domain = REFERENCE_CORE;
const coreNodes = domain.stages.reduce((sum, stage) => sum + stage.nodes, 0);
const lessonHours = domain.stages.reduce((sum, stage) => sum + stage.nodes * stage.lessonMin, 0) / 60;

log(`Calibração de progressão — ${LEARNERS} alunos/perfil, ${DAYS} dias, seed ${SEED}, núcleo ${coreNodes} nós (${lessonHours.toFixed(0)} h de aula), DR ${DEFAULT_SIM_PARAMS.desiredRetention}, memória ${memory.name}`);

// 1) reference profile: 3 h/day → level curve and tier thresholds.
const reference = honestProfile(3);
const referenceRuns = timed("3 h/dia (referência)", () => simulateCohort(reference, domain, LEARNERS, SEED, { params, memory }));
const xpDay7 = median(referenceRuns.map((t) => t.cumXp[6] as number));
const xpDay365 = median(referenceRuns.map((t) => t.cumXp[364] as number));
const fitted = fitLevelCurve({ level: 10, xp: xpDay7 }, { level: 100, xp: xpDay365 });
// Publish with 4 decimals; nudge `a` down so the medians land on (not 1 ulp under) L10 / L100.
const levelCurve: LevelCurve = { a: Math.floor(fitted.a * 1e4) / 1e4, p: round(fitted.p, 4) };
while (levelFromXp(xpDay7, levelCurve) < 10 || levelFromXp(xpDay365, levelCurve) < 100) levelCurve.a = round(levelCurve.a - 1e-4, 4);

/** PM at the weekly evaluation where the learner first completes stage k structurally (NaN if never). */
const pmAtCompletion = (t: LearnerTrajectory, stage: number): number => {
	for (let week = 0; week < t.stageByWeek.length; week++) if ((t.stageByWeek[week] as number) >= stage) return t.pmByWeek[week] as number;
	return Number.NaN;
};
const thresholds = TIERS.map((tier) => round(median(referenceRuns.map((t) => pmAtCompletion(t, tier.index)).filter(Number.isFinite)), 2));
const thresholdsIncreasing = thresholds.every((tau, k) => Number.isFinite(tau) && (k === 0 || tau > (thresholds[k - 1] as number)));
validateTierThresholds(thresholds);
const structuralCalendar3h = structuralDays(referenceRuns).map((days) => quantileSorted(days, 0.5));
const referenceSummary = summarize(reference, referenceRuns, thresholds);
referenceRuns.length = 0;

// 2) other daily budgets, sensitivity variants and farmers (same thresholds).
const honestHours = [1, 2, 4];
const summaries = new Map<string, ProfileSummary>([[reference.id, referenceSummary]]);
for (const hours of honestHours) {
	const profile = honestProfile(hours);
	const runs = timed(`${hours} h/dia`, () => simulateCohort(profile, domain, LEARNERS, SEED, { params, memory }));
	summaries.set(profile.id, summarize(profile, runs, thresholds));
}
const sensitivity: LearnerProfile[] = [
	honestProfile(3, { id: "3h-acerto75", label: "3 h/dia, check 75 %", checkPassRate: 0.75 }),
	honestProfile(3, { id: "3h-lento", label: "3 h/dia, velocidade 1,3× (mais lento)", speed: 1.3 }),
	honestProfile(3, { id: "3h-rapido", label: "3 h/dia, velocidade 0,8× (mais rápido)", speed: 0.8 }),
];
for (const profile of sensitivity) {
	const runs = timed(profile.label, () => simulateCohort(profile, domain, LEARNERS, SEED, { params, memory }));
	summaries.set(profile.id, summarize(profile, runs, thresholds));
}
const farmers: LearnerProfile[] = [
	honestProfile(3, { id: "3h-farm-antecipadas", label: "Revisões antecipadas (50 % do tempo)", farmer: { kind: "early-reviews", share: 0.5 } }),
	honestProfile(3, { id: "3h-farm-skimmer", label: "Skimmer (aula a 40 %, check 35 %)", farmer: { kind: "skimmer", timeFraction: 0.4, passRate: 0.35 } }),
];
const farmerResults = farmers.map((profile) => {
	const runs = timed(profile.label, () => simulateCohort(profile, domain, LEARNERS, SEED, { params: { days: FARM_DAYS }, memory }));
	return {
		profile,
		xpPerHour: median(runs.map((t) => xpPerHour(t, FARM_DAYS))),
		naivePerHour: median(runs.map((t) => xpPerHour(t, FARM_DAYS, true))),
		pm180: median(runs.map((t) => pmAtDay(t, FARM_DAYS))),
		tiers180: median(runs.map((t) => tiersBefore(t, thresholds, FARM_DAYS))),
	};
});

// ─── acceptance checks ──────────────────────────────────────────────────────

const doctorMedian = (id: string): number => quantileSorted((summaries.get(id) as ProfileSummary).tierDays[STAGE_COUNT - 1] as Float64Array, 0.5);
const doctorMonths = (id: string): number => doctorMedian(id) / DAYS_PER_MONTH;
const honestXph = referenceSummary.xpPerHour180;
const calendar3h = referenceSummary.tierDays.map((days) => quantileSorted(days, 0.5));
/** Worst deviation from the r7 §5.2 calendar; a 7-day (one evaluation) slack absorbs the weekly granularity of the early tiers. */
const calendarDeviation = Math.max(...calendar3h.map((day, k) => Math.max(0, Math.abs(day - (R7_CALENDAR_3H[k] as number)) - 7) / (R7_CALENDAR_3H[k] as number)));
/** r7's own statistic for 2 h/day: median among the learners who reach Doutor within 1 000 days. */
const doctor2hAmongReachers = (() => {
	const days = (summaries.get("2h") as ProfileSummary).tierDays[STAGE_COUNT - 1] as Float64Array;
	return quantileSorted(days.filter((day) => day < 1000), 0.5);
})();
const checks: { label: string; value: string; ok: boolean }[] = [
	{
		label: "Calendário de tiers a 3 h/dia (PM) reproduz r7 §5.2 (desvio ≤ 15 % além de 1 semana)",
		value: `${calendar3h.map(fmtInt).join(" / ")} d (desvio máx. ${fmt(calendarDeviation * 100, 1)} %)`,
		ok: calendarDeviation <= 0.15,
	},
	{ label: "L10 no dia 7 (3 h/dia, mediana)", value: `L${levelFromXp(xpDay7, levelCurve)}`, ok: levelFromXp(xpDay7, levelCurve) === 10 },
	{ label: "L100 no dia 365 (3 h/dia, mediana)", value: `L${levelFromXp(xpDay365, levelCurve)}`, ok: levelFromXp(xpDay365, levelCurve) === 100 },
	{ label: "Doutor mediano a 3 h/dia = 18,2 ± 1 meses", value: `${months(doctorMedian("3h"))} meses`, ok: Math.abs(doctorMonths("3h") - 18.2) <= 1 },
	{ label: "Doutor mediano a 4 h/dia ≈ 12–13 meses (11,6–13,6)", value: `${months(doctorMedian("4h"))} meses`, ok: doctorMonths("4h") >= 11.6 && doctorMonths("4h") <= 13.6 },
	// r7's 27 months at 2 h/day is the median AMONG the learners who reach Doutor within 1 000 days: compare the same
	// statistic (the honest median, which counts the others as "not yet", is shown next to it and in the tables).
	{
		label: "Doutor a 2 h/dia ≈ 27 meses (25–29; estatística do r7: mediana entre quem chega em 1.000 dias)",
		value: `${months(doctor2hAmongReachers)} meses (mediana honesta, contando quem não chega: ${months(doctorMedian("2h"))} meses)`,
		ok: doctor2hAmongReachers / DAYS_PER_MONTH >= 25 && doctor2hAmongReachers / DAYS_PER_MONTH <= 29,
	},
	...farmerResults.map((farmer) => ({
		label: `Farmer "${farmer.profile.label}" ≤ 0,7× XP/h do honesto`,
		value: `${fmt(farmer.xpPerHour / honestXph, 2)}×`,
		ok: farmer.xpPerHour <= 0.7 * honestXph,
	})),
	{ label: "Limiares de tier estritamente crescentes", value: thresholds.map((t) => fmt(t, 2)).join(" < "), ok: thresholdsIncreasing },
];
const failed = checks.filter((check) => !check.ok);

// ─── config/progression.json ────────────────────────────────────────────────

const honestOrder = ["1h", "2h", "3h", "4h"];
const honestSummaries = honestOrder.map((id) => summaries.get(id) as ProfileSummary);
const config: ProgressionConfig = {
	schemaVersion: 1,
	rulesVersion: RULES.version,
	generatedAt: new Date().toISOString(),
	source: {
		script: "scripts/calibrate-progression.ts",
		seed: SEED,
		learnersPerProfile: LEARNERS,
		days: DAYS,
		coreNodes,
		desiredRetention: DEFAULT_SIM_PARAMS.desiredRetention,
		memoryModel: memory.name,
	},
	levelCurve,
	tiers: {
		thresholds,
		retainedR: DEFAULT_RETAINED_R,
		stageQuota: DEFAULT_STAGE_QUOTA,
		referenceProfile: reference.id,
		targetDays: structuralCalendar3h.map((day) => round(day, 0)),
	},
	pace: { quantiles: PACE_QUANTILES, curves: honestSummaries.map((summary) => summary.pace) },
	forecast: honestSummaries.map(forecastOf),
	cohort: {
		label: SIMULATED_COHORT_LABEL,
		size: 29,
		quantiles: COHORT_QUANTILES,
		profiles: honestSummaries.map((summary): CohortProfile => ({ profileId: summary.profile.id, hoursPerDay: summary.profile.hoursPerDay, weeklyXp: summary.weeklyXp })),
	},
};
parseProgressionConfig(JSON.parse(JSON.stringify(config)));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
writeFileAtomicSync(OUT, `${JSON.stringify(config, null, "\t")}\n`);
log(`config escrito em ${path.relative(ROOT, OUT)}`);

// ─── results block for docs/impl/progress.md ────────────────────────────────

const lines: string[] = [];
const table = (header: string[], rows: string[][]): void => {
	lines.push(`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows.map((row) => `| ${row.join(" | ")} |`), "");
};
const dayCell = (days: Float64Array): string => {
	const p50 = quantileSorted(days, 0.5);
	const reached = days.filter(Number.isFinite).length / days.length;
	return `${fmtInt(p50)} d (${months(p50)} m) [${fmtInt(quantileSorted(days, 0.1))}–${fmtInt(quantileSorted(days, 0.9))}] ${fmt(reached * 100)} %`;
};

lines.push(
	`Gerado por \`npx tsx scripts/calibrate-progression.ts\` — ${LEARNERS} alunos por perfil, ${DAYS} dias, seed ${SEED}, núcleo de ${coreNodes} nós (${fmt(lessonHours)} h de aula), DR ${fmt(DEFAULT_SIM_PARAMS.desiredRetention, 2)}, memória ${memory.name.toUpperCase()} (ts-fsrs, pesos padrão — o modelo do aluno em runtime), regras \`${RULES.version}\`. Dia = dia de calendário desde o início; tiers avaliados semanalmente (dia 7w+6). "—" = a mediana não chega no horizonte.`,
	"",
	"**Verificações de aceitação**",
	"",
);
table(
	["Verificação", "Resultado", "OK"],
	checks.map((check) => [check.label, check.value, check.ok ? "✓" : "✗"]),
);

lines.push("**Parâmetros calibrados** (gravados em `config/progression.json`)", "");
table(
	["Parâmetro", "Valor"],
	[
		["Curva de nível", `XP(L) = ${fmt(levelCurve.a, 4)} · L^${fmt(levelCurve.p, 4)} (r7: 20,10 · L^1,696)`],
		["XP mediano 3 h/dia no dia 7 / 365", `${fmtInt(xpDay7)} / ${fmtInt(xpDay365)}`],
		["XP para subir L1→2 · L10→11 · L50→51 · L100→101 · L150→151", [1, 10, 50, 100, 150].map((l) => fmtInt(xpToAdvance(l, levelCurve))).join(" · ")],
		["Limiares de PM τ₁…τ₇ = PM mediano ao concluir o estágio k (r7 §5.4: 1,71 / 3,71 / 6,32 / 9,69 / 13,37 / 17,69 / 23,49)", thresholds.map((t) => fmt(t, 2)).join(" / ")],
		["Calendário estrutural a 3 h/dia, mediana em dias (r7 §5.2: 6 / 27 / 76 / 160 / 279 / 412 / 556)", structuralCalendar3h.map(fmtInt).join(" / ")],
	],
);

lines.push("**Quando cada tier é atingido (critério PM)** — mediana [p10–p90] e fração que chega no horizonte", "");
table(
	["Tier", ...honestSummaries.map((s) => s.profile.label)],
	TIERS.map((tier, k) => [tier.label, ...honestSummaries.map((s) => dayCell(s.tierDays[k] as Float64Array))]),
);

lines.push("**Critério estrutural (q = 0,8 por estágio, em ordem)** — mediana em dias, para conferir o alinhamento com o PM", "");
table(
	["Tier", ...honestSummaries.map((s) => s.profile.label)],
	TIERS.map((tier, k) => [tier.label, ...honestSummaries.map((s) => `${fmtInt(quantileSorted(s.structuralDays[k] as Float64Array, 0.5))} d`)]),
);

lines.push("**XP acumulado e nível (medianas)**", "");
table(
	["Perfil", ...XP_MARKS.map((day) => `d${day}`)],
	honestSummaries.flatMap((s) => [
		[`XP ${s.profile.label}`, ...XP_MARKS.map((day) => fmtInt(s.xpAt.get(day) ?? Number.NaN))],
		[`Nível ${s.profile.label}`, ...XP_MARKS.map((day) => String(levelFromXp(s.xpAt.get(day) ?? 0, levelCurve)))],
	]),
);

lines.push("**Esforço e revisões**", "");
table(
	["Perfil", "XP/h (180 d)", "Horas até Doutor (p50)", "Tempo em revisões (incl. reaprendizagem)", "Revisões × 3 min / tempo (métrica do r7)"],
	[...honestSummaries, ...sensitivity.map((p) => summaries.get(p.id) as ProfileSummary)].map((s) => [
		s.profile.label,
		fmt(s.xpPerHour180, 1),
		`${fmtInt(quantileSorted(s.doctorHours, 0.5))} h`,
		`${fmt(s.reviewShare * 100, 1)} %`,
		`${fmt(s.reviewShareBase * 100, 1)} %`,
	]),
);

lines.push("**Sensibilidade (3 h/dia)** — Doutor pelo critério PM", "");
table(
	["Variante", "Doutor p50", "Ouro p50", "PM @180 d"],
	[referenceSummary, ...sensitivity.map((p) => summaries.get(p.id) as ProfileSummary)].map((s) => [
		s.profile.id === "3h" ? "base (check 90 %, κ ~ LogN(1; 0,25))" : s.profile.label,
		dayCell(s.tierDays[STAGE_COUNT - 1] as Float64Array),
		`${fmtInt(quantileSorted(s.tierDays[2] as Float64Array, 0.5))} d`,
		fmt(s.pm180, 2),
	]),
);

lines.push(`**Anti-farming (3 h/dia, ${FARM_DAYS} dias, medianas)**`, "");
table(
	["Estratégia", "XP/h (regras 2026-11-r1)", "× honesto", "XP/h (regra ingênua +50/aula, +10/revisão)", "× honesto (ingênua)", `PM @${FARM_DAYS} d`, `Tiers @${FARM_DAYS} d`],
	[
		["Honesto", fmt(honestXph, 1), "1,00×", fmt(referenceSummary.naivePerHour180, 1), "1,00×", fmt(referenceSummary.pm180, 2), fmt(referenceSummary.tiers180, 0)],
		...farmerResults.map((f) => [
			f.profile.label,
			fmt(f.xpPerHour, 1),
			`${fmt(f.xpPerHour / honestXph, 2)}×`,
			fmt(f.naivePerHour, 1),
			`${fmt(f.naivePerHour / referenceSummary.naivePerHour180, 2)}×`,
			fmt(f.pm180, 2),
			fmt(f.tiers180, 0),
		]),
	],
);

const twoHours = summaries.get("2h") as ProfileSummary;
lines.push(
	`Nota sobre 2 h/dia: o r7 relatou 27,1 meses como a mediana **entre os alunos que chegam a Doutor em 1.000 dias** (76 % deles). Aqui a mediana conta quem não chega como "ainda não" (horizonte de ${DAYS} dias); a estatística equivalente à do r7 dá ${months(doctor2hAmongReachers)} meses.`,
	"",
);
const medianQuantileIndex = PACE_QUANTILES.indexOf(0.5);
const l100Row = twoHours.pace.days.findIndex((_, i) => ((twoHours.pace.xp[i] as number[])[medianQuantileIndex] as number) >= xpForLevel(100, levelCurve));
const l100Day2h = l100Row >= 0 ? (twoHours.pace.days[l100Row] as number) : Number.NaN;
const xpPerDay2hLate = ((twoHours.xpAt.get(730) ?? 0) - (twoHours.xpAt.get(365) ?? 0)) / 365;
const daysPerLevel2h = xpToAdvance(100, levelCurve) / Math.max(1, xpPerDay2hLate);
lines.push(
	`Informativo (receita r7 §5.4, item 4): a 2 h/dia o aluno mediano chega a L100 por volta do dia ${fmtInt(l100Day2h)}, e perto de L100 cada nível custa ~${fmtInt(xpToAdvance(100, levelCurve))} XP ≈ ${fmt(daysPerLevel2h, 1)} dias de estudo (meta da receita: ≤ 7 dias). ${daysPerLevel2h <= 7 ? "A meta é cumprida." : "Os níveis finais a 2 h/dia ficam, portanto, um pouco mais espaçados que a meta; a curva é ajustada para o aluno de referência de 3 h/dia, como pede a SÍNTESE."}`,
	"",
);

const BEGIN = "<!-- calibration:begin -->";
const END = "<!-- calibration:end -->";
const existing = fs.existsSync(DOC) ? fs.readFileSync(DOC, "utf8") : `# Módulo progress\n\n## Resultados da calibração Monte Carlo\n\n${BEGIN}\n${END}\n`;
const eol = existing.includes("\r\n") ? "\r\n" : "\n";
const block = `${BEGIN}${eol}${lines.join(eol)}${END}`;
const start = existing.indexOf(BEGIN);
const end = existing.indexOf(END);
const updated =
	start !== -1 && end > start
		? `${existing.slice(0, start)}${block}${existing.slice(end + END.length)}`
		: `${existing.trimEnd()}${eol}${eol}## Resultados da calibração Monte Carlo${eol}${eol}${block}${eol}`;
fs.mkdirSync(path.dirname(DOC), { recursive: true });
writeFileAtomicSync(DOC, updated);
log(`resumo escrito em ${path.relative(ROOT, DOC)}`);

for (const check of checks) log(`  ${check.ok ? "✓" : "✗"} ${check.label}: ${check.value}`);
if (failed.length > 0) {
	log(`${failed.length} verificação(ões) falharam.`);
	process.exitCode = 1;
}
