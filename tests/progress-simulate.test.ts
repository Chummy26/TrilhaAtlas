/**
 * Monte Carlo simulator (docs/research/00-SINTESE.md §2.11; r7 §5): seeded
 * determinism, parity with the runtime ledger (the calibration prices credits
 * with the same functions), the FSRS-6 closed form kept for comparison runs
 * (the default FSRS-7 memory is parity-tested in progress-memory.test.ts), and
 * the anti-farming direction of the rules.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { default_w } from "ts-fsrs";
import {
	createMemoryModel,
	deriveSeed,
	honestProfile,
	mulberry32,
	REFERENCE_CORE,
	replayXpLedger,
	simulateCohort,
	simulateLearner,
	summarizeLedger,
	type ProgressEvent,
	type SimCreditEvent,
	type SimDomain,
} from "../src/core/progress/index.ts";
import { firstWeekDay, quantile, quantileSorted } from "../src/core/progress/simulate.ts";

/** A small core (≈ 1/10 of the reference) keeps the tests fast. */
const SMALL_CORE: SimDomain = {
	stages: REFERENCE_CORE.stages.map((stage) => ({ nodes: Math.max(2, Math.round(stage.nodes / 10)), lessonMin: stage.lessonMin })),
	unlockFraction: REFERENCE_CORE.unlockFraction,
};

describe("seeded PRNG", () => {
	it("mulberry32 is deterministic and uniform-ish in [0, 1)", () => {
		const a = mulberry32(42);
		const b = mulberry32(42);
		const values = Array.from({ length: 10_000 }, () => a());
		assert.deepEqual(
			values.slice(0, 5),
			Array.from({ length: 5 }, () => b()),
		);
		assert.ok(values.every((v) => v >= 0 && v < 1));
		const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
		assert.ok(Math.abs(mean - 0.5) < 0.02);
		assert.notEqual(deriveSeed(1, "3h", 0), deriveSeed(1, "3h", 1));
		assert.equal(deriveSeed(7, "3h", 5), deriveSeed(7, "3h", 5));
	});
});

describe("simulator determinism", () => {
	const profile = honestProfile(3);
	const params = { days: 200 };

	it("the same seed reproduces the trajectory exactly; another seed does not", () => {
		const a = simulateLearner(profile, SMALL_CORE, 123, { params });
		const b = simulateLearner(profile, SMALL_CORE, 123, { params });
		assert.deepEqual(a, b);
		const c = simulateLearner(profile, SMALL_CORE, 124, { params });
		assert.notDeepEqual(a.cumXp, c.cumXp);
	});

	it("cohort learner i uses its own stream (order-independent)", () => {
		const cohort = simulateCohort(profile, SMALL_CORE, 3, 99, { params });
		assert.deepEqual(cohort[2], simulateLearner(profile, SMALL_CORE, deriveSeed(99, profile.id, 2), { params }));
	});

	it("produces bounded, monotone accumulators", () => {
		const t = simulateLearner(profile, SMALL_CORE, 5, { params });
		for (let day = 1; day < params.days; day++) {
			assert.ok((t.cumXp[day] as number) >= (t.cumXp[day - 1] as number));
			assert.ok((t.cumMinutes[day] as number) >= (t.cumMinutes[day - 1] as number));
		}
		for (const pm of t.pmByWeek) assert.ok(pm >= 0 && pm <= 28);
		const totalXp = t.cumXp[params.days - 1] as number;
		const totalMin = t.cumMinutes[params.days - 1] as number;
		assert.ok(totalXp <= 1.5 * totalMin + 1e-6, "XP/h ≤ 90 (I5)");
		assert.ok(t.learnedNodes > 0);
	});
});

describe("calibration and runtime cannot diverge", () => {
	it("replaying the simulator's credits through the real ledger yields the same XP, soft cap included", () => {
		const credits: SimCreditEvent[] = [];
		const trajectory = simulateLearner(honestProfile(4, { speed: 1 }), SMALL_CORE, 2026, { params: { days: 120 }, onCredit: (credit) => credits.push(credit) });
		const base = Date.parse("2026-01-05T12:00:00Z");
		const events = credits.map(
			(credit): ProgressEvent => ({
				...credit.body,
				eventId: `sim-${credit.day}-${credit.seq}`,
				at: new Date(base + credit.day * 86_400_000 + credit.seq * 1000).toISOString(),
				domainId: "electronics",
			}),
		);
		const ledger = replayXpLedger(events);
		assert.equal(ledger.length, credits.length);
		assert.ok(Math.abs(summarizeLedger(ledger).totalXp - (trajectory.cumXp[119] as number)) < 1e-6);
		ledger.forEach((entry, i) => assert.ok(Math.abs(entry.capped - (credits[i] as SimCreditEvent).xp) < 1e-9));
		assert.ok(
			ledger.some((entry) => entry.capped < entry.raw),
			"4 h/dia deve exercitar o limite diário",
		);
	});
});

describe("memory model (FSRS-6 closed form)", () => {
	const memory = createMemoryModel();

	it("uses the ts-fsrs FSRS-6 default weights", () => {
		assert.deepEqual([...memory.weights], [...default_w]);
		assert.equal(memory.weights.length, 21);
	});

	it("R(0) = 1, R(interval) ≈ DR, and maxElapsedFor inverts R exactly", () => {
		for (const S of [0.5, 2.3, 10, 80, 400]) {
			assert.equal(memory.retrievability(0, S), 1);
			const t = memory.maxElapsedFor(S, 0.7);
			assert.ok(Math.abs(memory.retrievability(t, S) - 0.7) < 1e-9);
			const interval = memory.intervalDays(S, 0.9);
			assert.ok(interval >= 1);
			if (S >= 10) assert.ok(Math.abs(memory.retrievability(interval, S) - 0.9) < 0.01);
		}
		assert.ok(memory.stabilityAfterRecall(5, 10, 0.9, 3) > 10);
		assert.ok(memory.stabilityAfterLapse(5, 10, 0.9) <= 10);
		assert.throws(() => createMemoryModel([1, 2, 3]), RangeError);
	});
});

describe("anti-farming direction (r7 §5.5)", () => {
	it("early-review farmers and skimmers earn less XP per hour than honest learners", () => {
		const params = { days: 120 };
		const rate = (profile: ReturnType<typeof honestProfile>) =>
			quantile(
				simulateCohort(profile, SMALL_CORE, 40, 11, { params }).map((t) => (t.cumXp[119] as number) / ((t.cumMinutes[119] as number) / 60)),
				0.5,
			);
		const honest = rate(honestProfile(3));
		const early = rate(honestProfile(3, { id: "early", farmer: { kind: "early-reviews", share: 0.5 } }));
		const skimmer = rate(honestProfile(3, { id: "skim", farmer: { kind: "skimmer", timeFraction: 0.4, passRate: 0.35 } }));
		assert.ok(early < honest, `antecipadas ${early} ≥ honesto ${honest}`);
		assert.ok(skimmer < honest, `skimmer ${skimmer} ≥ honesto ${honest}`);
	});
});

describe("statistics helpers", () => {
	it("interpolates quantiles and treats Infinity as 'not reached'", () => {
		assert.equal(quantile([3, 1, 2], 0.5), 2);
		assert.equal(quantileSorted([1, 2, 3, 4], 0.5), 2.5);
		assert.equal(quantileSorted([1, 2, Infinity], 0.5), 2);
		assert.equal(quantileSorted([1, Infinity, Infinity], 0.5), Infinity);
		assert.equal(firstWeekDay([0, 1, 5, 9], (pm) => pm >= 5), 20);
		assert.equal(firstWeekDay([0, 1], (pm) => pm >= 5), Infinity);
	});
});
