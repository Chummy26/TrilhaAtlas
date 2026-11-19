/**
 * Learner model — emissions, BKT×FSRS local update and DINA (r2 §9.4, §9.5,
 * §9.13 (2)(3); r10 §3.5 non-degeneracy G + S ≤ 1).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import { effectiveGrade, gradeToRating, localUpdate, posteriorAcquired, RATING } from "../src/core/learner/bkt-fsrs.ts";
import { dinaUpdate, primaryNodeOf } from "../src/core/learner/dina.ts";
import {
	assertEmissionValid,
	assertTablesValid,
	confusionMatrix,
	DEFAULT_EMISSION,
	EmissionError,
	mcqTables,
	noisyEmission,
	resolveEmission,
	slipGuess,
	type Emission4,
} from "../src/core/learner/emission.ts";
import { foldEvents } from "../src/core/learner/fold.ts";
import { DEFAULT_LEARNER_PARAMS, LEARNER_CONSTANTS, LearnerParamsError, validateLearnerParams } from "../src/core/learner/params.ts";
import type { Grade, LearnerParams } from "../src/core/learner/types.ts";
import { day, evidence, graph, node } from "./learner-fixtures.ts";

const P = DEFAULT_LEARNER_PARAMS;
const E = DEFAULT_EMISSION;
const close = (actual: number, expected: number, tol: number, msg?: string) =>
	assert.ok(Math.abs(actual - expected) <= tol, `${msg ?? ""} expected ${expected} ± ${tol}, got ${actual}`);

describe("learner emission tables", () => {
	it("default tables are valid distributions, MLRP and non-degenerate (G + S ≤ 1)", () => {
		assertEmissionValid(E);
		for (const [e1, e0] of [
			[E.e1, E.e0],
			[E.e1, E.e0Immediate],
			[mcqTables(4).e1, mcqTables(4).e0],
		] as [Emission4, Emission4][]) {
			const { slip, guess } = slipGuess(e1, e0);
			assert.ok(slip + guess <= 1, `G + S = ${slip + guess}`);
		}
	});

	it("rejects a degenerate table (G + S > 1) and a non-monotone ratio", () => {
		assert.throws(() => assertTablesValid("t", [0.4, 0.3, 0.2, 0.1], [0.1, 0.1, 0.3, 0.5]), EmissionError);
		assert.throws(() => assertTablesValid("t", [0.1, 0.1, 0.5, 0.3], [0.4, 0.3, 0.1, 0.2]), /razão/);
	});

	it("the immediate check is weak evidence (LR(3) 2.6 vs 8.1 delayed)", () => {
		close(E.e1[3] / E.e0Immediate[3], 2.6, 1e-9);
		close(E.e1[3] / E.e0[3], 8.125, 1e-9);
		assert.equal(resolveEmission(E, { format: "short", minutesSinceExposure: 10, graderConfidence: 1 }).immediate, true);
		assert.equal(resolveEmission(E, { format: "short", minutesSinceExposure: 30, graderConfidence: 1 }).immediate, false);
	});

	it("κ confusion is row-stochastic and keeps MLRP for κ ∈ [0.6, 1] (property)", () => {
		fc.assert(
			fc.property(fc.double({ min: 0.6, max: 1, noNaN: true }), (kappa) => {
				for (const row of confusionMatrix(kappa)) close(row.reduce((s, v) => s + v, 0), 1, 1e-12);
				const e1 = noisyEmission(E.e1, kappa);
				const e0 = noisyEmission(E.e0, kappa);
				assertTablesValid("noisy", e1, e0);
				assertTablesValid("noisy-imm", e1, noisyEmission(E.e0Immediate, kappa));
			}),
		);
	});

	it("MCQ collapses grades to wrong/right and is deterministic (κ = 1)", () => {
		const r = resolveEmission(E, { format: "mcq", minutesSinceExposure: 0, graderConfidence: 0.3, options: 5 });
		assert.equal(r.kappa, 1);
		assert.equal(r.index(2), 3);
		assert.equal(r.index(1), 0);
		close(r.e0[3], 0.2, 1e-12);
	});
});

describe("learner BKT×FSRS local update (r2 §9.4)", () => {
	it("reproduces the numeric example 0.30 → 0.777 → 0.81 → 0.972 → 0.976", () => {
		const first = localUpdate(0.3, 1, E.e1, E.e0, 3, 0.15);
		close(first.posterior, 0.777, 5e-4, "P(L|y) step 1");
		close(first.pL, 0.81, 5e-3, "pL step 1");
		const second = localUpdate(first.pL, 1, E.e1, E.e0, 3, 0.15);
		close(second.posterior, 0.972, 1e-3, "P(L|y) step 2");
		close(second.pL, 0.976, 1e-3, "pL step 2");
		assert.ok(second.pL >= P.masteryThreshold);
	});

	it("fold reproduces the first step from a post-lesson prior of 0.30", () => {
		const view = graph(node("ohm"));
		const params: LearnerParams = { ...P, tLesson: 0.15 / 0.85 };
		const s = foldEvents(
			null,
			[
				{ kind: "exposure", id: "x1", seq: 1, at: day(0), domainId: "electronics", sessionId: "s", nodeId: "ohm", source: "ai_lesson", minutes: 20 },
				evidence({ seq: 2, at: day(1), nodeId: "ohm", grade: 3 }),
			],
			view,
			params,
		);
		close(s.nodes.ohm?.pL ?? 0, 0.81, 5e-3);
	});

	it("evidence monotonicity: better-than-chance grades never lower P(L), worse never raise it (property)", () => {
		fc.assert(
			fc.property(
				fc.double({ min: 0, max: 1, noNaN: true }),
				fc.double({ min: 0, max: 1, noNaN: true }),
				fc.double({ min: 0.6, max: 1, noNaN: true }),
				fc.constantFrom<Grade>(0, 1, 2, 3),
				fc.boolean(),
				fc.double({ min: 0.05, max: 1, noNaN: true }),
				(p, R, kappa, y, immediate, weight) => {
					const e1 = noisyEmission(E.e1, kappa);
					const e0 = noisyEmission(immediate ? E.e0Immediate : E.e0, kappa);
					const post = posteriorAcquired(p, R, e1[y], e0[y], weight);
					assert.ok(post >= 0 && post <= 1, `posterior ${post}`);
					if (e1[y] >= e0[y]) assert.ok(post >= p - 1e-12, `grade ${y} lowered ${p} → ${post}`);
					else assert.ok(post <= p + 1e-12, `grade ${y} raised ${p} → ${post}`);
					const upd = localUpdate(p, R, e1, e0, y, 0.15, weight);
					assert.ok(upd.pL >= upd.posterior - 1e-12 && upd.pL <= 1, "transition is monotone and bounded");
				},
			),
		);
	});

	it("maps grades to FSRS ratings (Hard is a pass; Easy is rare)", () => {
		assert.equal(gradeToRating(0, { level: 3, hints: 0 }), RATING.again);
		assert.equal(gradeToRating(1, { level: 3, hints: 0 }), RATING.again);
		assert.equal(gradeToRating(2, { level: 3, hints: 0 }), RATING.hard);
		assert.equal(gradeToRating(3, { level: 3, hints: 0 }), RATING.good);
		assert.equal(gradeToRating(3, { level: 3, hints: 1 }), RATING.hard, "hinted right = right with help");
		assert.equal(gradeToRating(3, { level: 4, hints: 0, latencyMs: 5000, medianLatencyMs: 9000, selfConfidence: 3 }), RATING.easy);
		assert.equal(gradeToRating(3, { level: 4, hints: 0, latencyMs: 5000, selfConfidence: 3 }), RATING.good, "no median → no Easy");
		assert.equal(effectiveGrade(3, 2), 2);
	});
});

describe("learner DINA mean-field (r2 §9.5)", () => {
	it("reduces to the single-node update with q = 1", () => {
		fc.assert(
			fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), fc.constantFrom<Grade>(0, 1, 2, 3), (p, R, y) => {
				const [r] = dinaUpdate([{ nodeId: "a", q: 1, pL: p, R }], E.e1[y], E.e0[y], { lambda: 1.5, failure: y <= 1 });
				close(r?.posterior ?? -1, posteriorAcquired(p, R, E.e1[y], E.e0[y]), 1e-12);
			}),
		);
	});

	it("blames the weakest link more after a failure", () => {
		const res = dinaUpdate(
			[
				{ nodeId: "strong", q: 1, pL: 0.95, R: 1 },
				{ nodeId: "weak", q: 1, pL: 0.4, R: 1 },
			],
			E.e1[0],
			E.e0[0],
			{ lambda: 1.5, failure: true },
		);
		const strong = res.find((r) => r.nodeId === "strong");
		const weak = res.find((r) => r.nodeId === "weak");
		assert.ok(strong && weak && weak.blame > strong.blame, JSON.stringify(res));
		for (const r of res) assert.ok(r.posterior >= 0 && r.posterior <= 1 && r.blame >= 0 && r.blame <= 1);
	});

	it("an LLM attribution alone is bounded evidence (likelihood ratio ≤ 1 + λ)", () => {
		const p = 0.7;
		const [r] = dinaUpdate([{ nodeId: "units", q: 0, pL: p, R: 1, attribution: 1 }], E.e1[0], E.e0[0], { lambda: 1.5, failure: true });
		const odds = (x: number) => x / (1 - x);
		close(odds(p) / odds(r?.posterior ?? 0), 2.5, 1e-9);
		const [ok] = dinaUpdate([{ nodeId: "units", q: 0, pL: p, R: 1, attribution: 1 }], E.e1[3], E.e0[3], { lambda: 1.5, failure: false });
		close(ok?.posterior ?? 0, p, 1e-12, "attributions ignored on success");
	});

	it("probabilities stay in [0,1] for any Q-vector (property)", () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.record({
						q: fc.double({ min: 0, max: 1, noNaN: true }),
						pL: fc.double({ min: 0, max: 1, noNaN: true }),
						R: fc.double({ min: 0, max: 1, noNaN: true }),
						attribution: fc.double({ min: 0, max: 1, noNaN: true }),
					}),
					{ minLength: 1, maxLength: 5 },
				),
				fc.constantFrom<Grade>(0, 1, 2, 3),
				fc.double({ min: 0, max: 1, noNaN: true }),
				(nodes, y, weight) => {
					const res = dinaUpdate(
						nodes.map((n, i) => ({ nodeId: `n${i}`, ...n })),
						E.e1[y],
						E.e0[y],
						{ lambda: 1.5, weight, failure: y <= 1 },
					);
					for (const r of res) {
						for (const v of [r.posterior, r.pNotKnowPost, r.pNotKnowPrior, r.blame]) assert.ok(v >= 0 && v <= 1, JSON.stringify(r));
					}
				},
			),
		);
	});

	it("picks the flagged primary, else the largest q", () => {
		assert.equal(primaryNodeOf([{ nodeId: "a", q: 0.4 }, { nodeId: "b", q: 0.9 }])?.nodeId, "b");
		assert.equal(primaryNodeOf([{ nodeId: "a", q: 0.4, primary: true }, { nodeId: "b", q: 0.9 }])?.nodeId, "a");
	});
});

describe("learner parameters", () => {
	it("defaults follow r2 §9.11 and validate", () => {
		validateLearnerParams(P);
		assert.equal(P.tLesson, 0.25);
		assert.equal(P.tPractice, 0.15);
		assert.equal(P.consistencyEps, 0.05);
		assert.equal(P.llmAttributionLambda, 1.5);
		assert.deepEqual(P.desiredRetention, { frontierPrereq: 0.93, default: 0.9, distantLeaf: 0.85 });
		assert.equal(P.planner.gamma, 0.6);
		assert.equal(LEARNER_CONSTANTS.fire.micro, 1_000_000);
		assert.equal(LEARNER_CONSTANTS.fire.maxBank, 3);
	});

	it("Elo slip + guess per level never exceeds 1", () => {
		for (const s of LEARNER_CONSTANTS.slipByLevel) assert.ok(s + LEARNER_CONSTANTS.guessOpen <= 1);
	});

	it("rejects invalid parameters with clear errors", () => {
		assert.throws(() => validateLearnerParams({ ...P, masteryThreshold: 0.8 }), LearnerParamsError);
		assert.throws(() => validateLearnerParams({ ...P, propagationHops: 4 }), /propagationHops/);
		assert.throws(() => validateLearnerParams({ ...P, fsrsWeights: [1, 2, 3] }), /34 pesos/);
		assert.throws(() => validateLearnerParams({ ...P, emission: { ...E, e0: [0.1, 0.1, 0.3, 0.5] } }), EmissionError);
	});
});
