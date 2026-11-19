/**
 * Calibrated config and opt-in comparisons (docs/research/00-SINTESE.md
 * §2.11 "Rankings"; r7 §4.6; mathua planWeek/moversFor): config parsing and
 * fallback, the generated config/progression.json (read-only), "Eu vs Eu"
 * pace percentiles, the labelled simulated cohort and deterministic leagues.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import {
	DEFAULT_PROGRESSION_CONFIG,
	levelFromXp,
	moversFor,
	nearestProfile,
	pacePercentile,
	paceStandingFor,
	parseProgressionConfig,
	planWeek,
	ProgressionConfigError,
	progressionConfigOrDefault,
	selfLeague,
	SIMULATED_COHORT_LABEL,
	simulatedRivals,
	validateTierThresholds,
	type CohortProfile,
	type PaceCurve,
	type ProgressionConfig,
} from "../src/core/progress/index.ts";

const CONFIG_FILE = path.join(import.meta.dirname, "..", "config", "progression.json");
const QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95];
const CURVE: PaceCurve = {
	profileId: "3h",
	hoursPerDay: 3,
	days: [1, 11],
	xp: [
		[50, 100, 150, 200, 250],
		[550, 1100, 1650, 2200, 2750],
	],
	pm: [
		[0, 0, 0, 0, 0],
		[1, 1, 1, 1, 1],
	],
};

describe("progression config", () => {
	it("the defaults are a valid config (r7 curve and thresholds)", () => {
		const parsed = parseProgressionConfig(JSON.parse(JSON.stringify(DEFAULT_PROGRESSION_CONFIG)));
		assert.deepEqual(parsed.levelCurve, { a: 20.1, p: 1.696 });
		assert.deepEqual(parsed.tiers.thresholds, [1.71, 3.71, 6.32, 9.69, 13.37, 17.69, 23.49]);
		assert.equal(parsed.cohort.label, SIMULATED_COHORT_LABEL);
	});

	it("rejects broken files with a located pt-BR message and falls back to the defaults", () => {
		const broken = { ...structuredClone(DEFAULT_PROGRESSION_CONFIG), tiers: { ...DEFAULT_PROGRESSION_CONFIG.tiers, thresholds: [1, 2, 3, 2, 5, 6, 7] } };
		assert.throws(() => parseProgressionConfig(broken), (error: unknown) => error instanceof ProgressionConfigError && /tiers\.thresholds/.test(error.message));
		const fallback = progressionConfigOrDefault(broken);
		assert.equal(fallback.config, DEFAULT_PROGRESSION_CONFIG);
		assert.match(fallback.error ?? "", /inválido/);
		assert.deepEqual(progressionConfigOrDefault(undefined), { config: DEFAULT_PROGRESSION_CONFIG, error: null });
	});

	it("the generated config/progression.json is valid and meets the calibration targets", (t) => {
		if (!fs.existsSync(CONFIG_FILE)) {
			t.skip("config/progression.json ainda não foi gerado (npx tsx scripts/calibrate-progression.ts)");
			return;
		}
		const config: ProgressionConfig = parseProgressionConfig(JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")));
		assert.equal(config.rulesVersion, "2026-11-r1");
		validateTierThresholds(config.tiers.thresholds);
		assert.ok(config.levelCurve.p > 1.5 && config.levelCurve.p < 1.9);
		const reference = config.pace.curves.find((curve) => curve.profileId === "3h");
		assert.ok(reference, "curva de 3 h/dia presente");
		const median = config.pace.quantiles.indexOf(0.5);
		const day7 = reference.xp[reference.days.indexOf(7)]?.[median] ?? 0;
		const day365 = reference.xp[reference.days.indexOf(365)]?.[median] ?? 0;
		assert.equal(levelFromXp(day7, config.levelCurve), 10);
		assert.ok(Math.abs(levelFromXp(day365, config.levelCurve) - 100) <= 1);
		const doctorMonths = (profileId: string): number => {
			const day = config.forecast.find((forecast) => forecast.profileId === profileId)?.medianDay[6];
			return day === null || day === undefined ? Number.NaN : day / 30.44;
		};
		assert.ok(Math.abs(doctorMonths("3h") - 18.2) <= 1, `Doutor a 3 h/dia em ${doctorMonths("3h")} meses`);
		assert.ok(doctorMonths("4h") >= 11.6 && doctorMonths("4h") <= 13.6, `Doutor a 4 h/dia em ${doctorMonths("4h")} meses`);
		// 2 h/dia: the forecast stores the honest median (non-reachers count as "not yet"); r7's 27 months is the median among
		// reachers, checked by the calibration script. Here: more daily time never makes Doutor later.
		assert.ok(doctorMonths("4h") < doctorMonths("3h") && doctorMonths("3h") < doctorMonths("2h"), "Doutor mais cedo com mais horas por dia");
		// Calibrated on the runtime learner's scheduler (the first version ran FSRS-6 while the app runs FSRS-7).
		assert.equal(config.source?.memoryModel, "fsrs-7");
		assert.equal(config.cohort.size, 29);
		assert.ok(config.cohort.profiles.length > 0);
	});
});

describe("Eu vs Eu", () => {
	it("places cumulative XP on the simulated pace curve, interpolating days and quantiles", () => {
		assert.equal(pacePercentile(CURVE, QUANTILES, 1, 150).percentile, 50);
		assert.equal(pacePercentile(CURVE, QUANTILES, 6, 1200).percentile, 75);
		assert.equal(pacePercentile(CURVE, QUANTILES, 6, 1100).percentile, 67);
		const middle = pacePercentile(CURVE, QUANTILES, 11, 1925);
		assert.equal(middle.percentile, 63);
		assert.equal(middle.medianXp, 1650);
		assert.match(middle.message, /p63 dos alunos simulados de 3 h\/dia/);
		const low = pacePercentile(CURVE, QUANTILES, 11, 10);
		assert.equal(low.clamped, "low");
		assert.match(low.message, /≤ p5/);
		assert.equal(pacePercentile(CURVE, QUANTILES, 400, 99_999).clamped, "high");
	});

	it("picks the curve of the closest daily budget", () => {
		const config: ProgressionConfig = { ...structuredClone(DEFAULT_PROGRESSION_CONFIG), pace: { quantiles: QUANTILES, curves: [CURVE, { ...CURVE, profileId: "2h", hoursPerDay: 2 }] } };
		assert.equal(nearestProfile(config.pace.curves, 2.4)?.profileId, "2h");
		assert.equal(paceStandingFor(config, 3.6, 1, 150)?.profileId, "3h");
		assert.equal(paceStandingFor(DEFAULT_PROGRESSION_CONFIG, 3, 1, 150), null);
	});

	it("compares this week with the learner's own previous weeks", () => {
		const { rows, medianLastFour } = selfLeague(500, [
			{ weekStart: "2026-10-05", xp: 900 },
			{ weekStart: "2026-10-12", xp: 300 },
			{ weekStart: "2026-10-19", xp: 600 },
			{ weekStart: "2026-10-26", xp: 400 },
			{ weekStart: "2026-11-02", xp: 450 },
			{ weekStart: "2026-09-28", xp: 9999 },
		]);
		assert.equal(rows.length, 6);
		assert.equal(medianLastFour, 425);
		assert.ok(rows.every((row) => row.move === "stay" && !row.simulated));
		assert.equal(rows.find((row) => row.id === "you")?.rank, 3);
	});
});

describe("simulated cohort and leagues", () => {
	const profile: CohortProfile = { profileId: "3h", hoursPerDay: 3, weeklyXp: [0, 400, 800, 1000, 1200, 1500, 2400] };
	const quantiles = [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1];

	it("moversFor follows mathua: n < 6 → 0, else min(5, ⌊n/3⌋)", () => {
		assert.deepEqual(
			[0, 5, 6, 9, 14, 15, 30].map(moversFor),
			[0, 0, 2, 3, 4, 5, 5],
		);
	});

	it("samples 29 rivals labelled as simulated, deterministically per week and seed", () => {
		const a = simulatedRivals(profile, quantiles, "2026-11-16", 7);
		assert.equal(a.length, 29);
		assert.ok(a.every((rival) => rival.simulated && rival.name.startsWith("Simulado ") && rival.xp >= 0 && rival.xp <= 2400));
		assert.deepEqual(simulatedRivals(profile, quantiles, "2026-11-16", 7), a);
		assert.notDeepEqual(simulatedRivals(profile, quantiles, "2026-11-23", 7), a);
	});

	it("planWeek orders by XP, shares ranks on ties, promotes/demotes k and protects a met weekly goal", () => {
		const rivals = simulatedRivals(profile, quantiles, "2026-11-16", 3);
		const you = { id: "you", name: "Você", xp: 0, simulated: false, protectedFromDemotion: true };
		const rows = planWeek([...rivals, you]);
		assert.equal(rows.length, 30);
		const k = moversFor(30);
		assert.equal(rows.filter((row) => row.move === "up").length, k);
		assert.equal(rows.at(-1)?.id, "you");
		assert.equal(rows.at(-1)?.move, "stay");
		for (let i = 1; i < rows.length; i++) assert.ok((rows[i - 1]?.xp ?? 0) >= (rows[i]?.xp ?? 0));
		const tied = planWeek([
			{ id: "b", name: "B", xp: 10, simulated: true },
			{ id: "a", name: "A", xp: 10, simulated: true },
			{ id: "c", name: "C", xp: 5, simulated: true },
		]);
		assert.deepEqual(
			tied.map((row) => [row.id, row.rank]),
			[
				["a", 1],
				["b", 1],
				["c", 3],
			],
		);
		assert.throws(() => planWeek([you, you]));
	});
});
