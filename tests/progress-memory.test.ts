/**
 * The Monte Carlo memory model must BE the runtime's (docs/research/
 * 00-SINTESE.md §2.11 "calibração e runtime não divergem", "ts-fsrs FSRS-7
 * ou modelo exponencial equivalente"; r7 §5.1).
 *
 *   • FSRS-7 (the default): `fsrs7Memory` is driven side by side with the
 *     runtime learner's own `reviewMemory` (src/core/learner/fsrs.ts:
 *     FSRS7Model, default weights, 20-minute relearning step, maximum
 *     interval 1095 d). The second review found the simulator running FSRS-6
 *     while the app schedules with FSRS-7 (2–2.5× longer intervals): the
 *     calibration described a scheduler the app does not run. This block
 *     would have caught it.
 *   • FSRS-6 (comparison model): the closed form is checked step by step
 *     against ts-fsrs's `FSRS6Algorithm.next_state`. The first review found
 *     two divergences inherited from r7's sim.mjs — mean reversion toward a
 *     CLAMPED D₀(Easy) and lapses floored at S instead of S/e^{w17·w18} (up
 *     to 4.5 % off).
 *
 * Also: the simulator refuses inputs that used to hang it or fail deep inside
 * the XP rules.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import { default_w } from "ts-fsrs";
import { FSRS6_MODEL_BOUNDS, FSRS6Algorithm } from "ts-fsrs/models/fsrs-6";
import { FSRS7_DEFAULT_WEIGHTS } from "ts-fsrs/models/fsrs-7";
import { retrievability as runtimeRetrievability, reviewMemory } from "../src/core/learner/fsrs.ts";
import { DEFAULT_LEARNER_PARAMS, LEARNER_CONSTANTS } from "../src/core/learner/params.ts";
import type { FsrsMemory } from "../src/core/learner/types.ts";
import {
	createMemoryModel,
	DEFAULT_SIM_PARAMS,
	fsrs6Memory,
	fsrs7Memory,
	honestProfile,
	SIM_MAXIMUM_INTERVAL_DAYS,
	simulateLearner,
	type MemoryGrade,
	type SimDomain,
	type SimMemoryState,
} from "../src/core/progress/index.ts";

const memory = createMemoryModel();
const reference = new FSRS6Algorithm([...default_w], true, FSRS6_MODEL_BOUNDS);
/** ts-fsrs rounds every intermediate to 8 decimals. */
const close = (actual: number, expected: number, what: string) =>
	assert.ok(Math.abs(actual - expected) <= 1e-6 * Math.max(1, Math.abs(expected)), `${what}: ${actual} ≠ ${expected}`);

describe("FSRS-6 closed form = ts-fsrs FSRS6Algorithm", () => {
	it("first review (new card) for every grade", () => {
		for (const grade of [1, 2, 3, 4] as const) {
			const state = reference.next_state(null, 0, grade);
			close(memory.initialStability(grade), state.stability, `S₀(${grade})`);
			close(memory.initialDifficulty(grade), state.difficulty, `D₀(${grade})`);
		}
	});

	it("day-scale reviews: stability, difficulty, retrievability and interval (property)", () => {
		fc.assert(
			fc.property(
				fc.double({ min: 0.01, max: 3000, noNaN: true }),
				fc.double({ min: 1, max: 10, noNaN: true }),
				fc.integer({ min: 1, max: 2000 }),
				fc.constantFrom<MemoryGrade>(1, 2, 3, 4),
				(stability, difficulty, elapsed, grade) => {
					const next = reference.next_state({ stability, difficulty }, elapsed, grade);
					const R = memory.retrievability(elapsed, stability);
					close(R, reference.forgetting_curve(elapsed, stability), "R");
					const S = grade === 1 ? memory.stabilityAfterLapse(difficulty, stability, R) : memory.stabilityAfterRecall(difficulty, stability, R, grade);
					close(S, next.stability, `S'(${grade})`);
					close(memory.nextDifficulty(difficulty, grade), next.difficulty, `D'(${grade})`);
					// ts-fsrs rounds `factor` to 8 decimals: at an exact .5 the integer interval may differ by one day.
					assert.ok(Math.abs(memory.intervalDays(stability, 0.9) - reference.next_interval(stability, 0.9)) <= 1);
				},
			),
			{ numRuns: 500 },
		);
	});

	it("covers the two formerly divergent branches explicitly", () => {
		// Lapse of a tiny stability: the S/e^{w17·w18} floor binds (r7's floor at S gave 0.2109 instead of 0.2018).
		const lapse = reference.next_state({ stability: 0.212, difficulty: 1 }, 100, 1);
		close(memory.stabilityAfterLapse(1, 0.212, memory.retrievability(100, 0.212)), lapse.stability, "lapse floor");
		// Mean reversion toward the UNCLAMPED D₀(Easy) ≈ −4.77.
		close(memory.nextDifficulty(1, 1), reference.next_state({ stability: 0.212, difficulty: 1 }, 1, 1).difficulty, "mean reversion");
	});
});

describe("FSRS-7 simulator memory = the runtime learner's scheduler", () => {
	const sim = fsrs7Memory();
	const DAY = 86_400_000;
	const T0 = Date.parse("2026-01-05T12:00:00Z");
	const iso = (ms: number): string => new Date(ms).toISOString();
	const stateOf = (card: FsrsMemory): SimMemoryState => ({ stability: card.stability, stabilityFast: card.stabilityFast, difficulty: card.difficulty });
	const sameState = (actual: SimMemoryState, card: FsrsMemory, what: string): void => {
		close(actual.stability, card.stability, `${what} S`);
		close(actual.stabilityFast, card.stabilityFast, `${what} S_f`);
		close(actual.difficulty, card.difficulty, `${what} D`);
	};

	it("uses the runtime's weights and maximum interval", () => {
		assert.equal(SIM_MAXIMUM_INTERVAL_DAYS, LEARNER_CONSTANTS.fsrs.maximumInterval);
		assert.equal(DEFAULT_LEARNER_PARAMS.fsrsWeights ?? null, null, "o runtime usa os pesos padrão do FSRS-7 quando o domínio não otimizou os seus");
		assert.equal(DEFAULT_SIM_PARAMS.relearnStepDays * 1440, 20);
		assert.deepEqual([...LEARNER_CONSTANTS.fsrs.relearningSteps], ["20m"]);
		assert.throws(() => fsrs7Memory(FSRS7_DEFAULT_WEIGHTS.slice(0, 21)), RangeError);
		assert.throws(() => fsrs7Memory(FSRS7_DEFAULT_WEIGHTS, 0), RangeError);
	});

	it("a learned node starts where the runtime's first Good leaves a new card", () => {
		const card = reviewMemory(undefined, "n@v1", 3, iso(T0), 0.9, DEFAULT_LEARNER_PARAMS);
		sameState(sim.initial(3), card, "Good inicial");
	});

	it("reviews (with the 20-minute relearning step after a lapse) match reviewMemory step by step (property)", () => {
		fc.assert(
			fc.property(fc.array(fc.tuple(fc.integer({ min: 1, max: 400 }), fc.constantFrom<MemoryGrade>(1, 2, 3, 4)), { minLength: 1, maxLength: 8 }), (steps) => {
				let at = T0;
				let card = reviewMemory(undefined, "n@v1", 3, iso(at), 0.9, DEFAULT_LEARNER_PARAMS);
				let state = sim.initial(3);
				for (const [elapsed, grade] of steps) {
					at += elapsed * DAY;
					const R = sim.retrievability(elapsed, state);
					close(R, runtimeRetrievability(card, iso(at), DEFAULT_LEARNER_PARAMS), "R");
					card = reviewMemory(card, "n@v1", grade, iso(at), 0.9, DEFAULT_LEARNER_PARAMS);
					state = sim.next(state, elapsed, R, grade);
					sameState(state, card, `nota ${grade}`);
					if (grade === 1) {
						const step = DEFAULT_SIM_PARAMS.relearnStepDays;
						at += step * DAY;
						card = reviewMemory(card, "n@v1", 3, iso(at), 0.9, DEFAULT_LEARNER_PARAMS);
						state = sim.next(state, step, sim.retrievability(step, state), 3);
						sameState(state, card, "passo de reaprendizagem");
					}
				}
			}),
			{ numRuns: 150 },
		);
	});

	it("schedules straight Goods like the runtime (up to its fuzz) and caps at the maximum interval", () => {
		let at = T0;
		let card = reviewMemory(undefined, "n@v1", 3, iso(at), 0.9, DEFAULT_LEARNER_PARAMS);
		for (let review = 0; review < 7; review++) {
			const runtimeInterval = Math.round((Date.parse(card.dueAt) - at) / DAY);
			const simInterval = sim.intervalDays(stateOf(card), 0.9);
			assert.ok(Math.abs(runtimeInterval - simInterval) <= Math.max(1, 0.15 * simInterval) + 1, `revisão ${review}: runtime ${runtimeInterval} d, simulador ${simInterval} d`);
			const R = runtimeRetrievability(card, card.dueAt, DEFAULT_LEARNER_PARAMS);
			at = Date.parse(card.dueAt);
			card = reviewMemory(card, "n@v1", 3, card.dueAt, 0.9, DEFAULT_LEARNER_PARAMS);
			assert.ok(R > 0.85, `R no vencimento ${R}`);
		}
		assert.equal(sim.intervalDays({ stability: 30_000, stabilityFast: 30_000, difficulty: 1 }, 0.9), SIM_MAXIMUM_INTERVAL_DAYS);
		// retainedDays inverts the curve (the weekly "R ≥ 0.7" test).
		for (const state of [sim.initial(3), sim.next(sim.initial(3), 5, sim.retrievability(5, sim.initial(3)), 3)]) {
			assert.ok(Math.abs(sim.retrievability(sim.retainedDays(state, 0.7), state) - 0.7) < 1e-6);
		}
	});

	it("the simulator runs FSRS-7 by default (not FSRS-6)", () => {
		const domain: SimDomain = { stages: [{ nodes: 40, lessonMin: 20 }], unlockFraction: 0.7 };
		const params = { days: 120 };
		const byDefault = simulateLearner(honestProfile(2), domain, 7, { params });
		assert.deepEqual(byDefault, simulateLearner(honestProfile(2), domain, 7, { params, memory: fsrs7Memory() }));
		assert.notDeepEqual(byDefault.cumXp, simulateLearner(honestProfile(2), domain, 7, { params, memory: fsrs6Memory() }).cumXp);
	});
});

describe("simulator input validation", () => {
	const tiny = (lessonMin: number): SimDomain => ({ stages: [{ nodes: 3, lessonMin }], unlockFraction: 0.7 });

	it("refuses zero / negative lesson minutes with a clear RangeError", () => {
		assert.throws(() => simulateLearner(honestProfile(3), tiny(0), 1, { params: { days: 10 } }), RangeError);
		assert.throws(() => simulateLearner(honestProfile(3), tiny(-5), 1, { params: { days: 10 } }), RangeError);
		assert.throws(() => simulateLearner(honestProfile(3), { stages: [{ nodes: 1.5, lessonMin: 10 }], unlockFraction: 0.7 }, 1, { params: { days: 10 } }), RangeError);
	});

	it("refuses farmer parameters that would learn for free or grow the daily budget", () => {
		const skimmer = honestProfile(3, { id: "s", farmer: { kind: "skimmer", timeFraction: 0, passRate: 0.35 } });
		assert.throws(() => simulateLearner(skimmer, tiny(10), 1, { params: { days: 10 } }), RangeError);
		const negativeShare = honestProfile(3, { id: "e", farmer: { kind: "early-reviews", share: -0.5 } });
		assert.throws(() => simulateLearner(negativeShare, tiny(10), 1, { params: { days: 10 } }), RangeError);
	});
});
