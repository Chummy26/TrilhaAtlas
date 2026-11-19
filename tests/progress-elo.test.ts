/**
 * Elo on the 400 scale (docs/research/00-SINTESE.md §2.11; r7 §2.1–§2.3,
 * Pelánek 2016): the expected score that feeds the XP difficulty multiplier
 * mDif(E), Pelánek's K(n), the learner × item update and the stage priors.
 * The module had no tests before the second review.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import { ELO_PER_LOGIT, eloK, eloUpdate, eventCredit, itemPriorB } from "../src/core/progress/index.ts";
import { expectedScore } from "../src/core/progress/elo.ts";

const rating = fc.double({ min: -4000, max: 4000, noNaN: true });

describe("expected score", () => {
	it("is the logistic on the 400 scale: 0.5 at equal ratings, 10:1 odds at +400", () => {
		assert.equal(expectedScore(1000, 1000), 0.5);
		assert.ok(Math.abs(expectedScore(1400, 1000) - 10 / 11) < 1e-12);
		assert.ok(Math.abs(expectedScore(1000, 1400) - 1 / 11) < 1e-12);
	});

	it("is symmetric (E(θ, b) + E(b, θ) = 1), in [0, 1] and increasing in θ (property)", () => {
		fc.assert(
			fc.property(rating, rating, (theta, b) => {
				const e = expectedScore(theta, b);
				assert.ok(e >= 0 && e <= 1);
				assert.ok(Math.abs(e + expectedScore(b, theta) - 1) < 1e-12);
				assert.ok(expectedScore(theta + 50, b) >= e);
			}),
		);
	});

	it("refuses non-finite ratings", () => {
		assert.throws(() => expectedScore(Number.NaN, 1000), RangeError);
		assert.throws(() => expectedScore(1000, Number.POSITIVE_INFINITY), RangeError);
	});

	it("feeds mDif(E) of the XP rules: an even item (E = 0.5) is worth ×1.5 with no hints", () => {
		const credit = eventCredit({ kind: "item", itemId: "i", theta: 1200, b: 1200, correct: true, focusedMin: 2 });
		assert.ok(Math.abs(credit.multiplier - 1.5) < 1e-12);
	});
});

describe("K(n) and the update", () => {
	it("K(0) = 400/ln 10 ≈ 173.72 and halves after 20 answers (s = 0.05)", () => {
		assert.ok(Math.abs(ELO_PER_LOGIT - 173.7177927613) < 1e-9);
		assert.equal(eloK(0), ELO_PER_LOGIT);
		assert.ok(Math.abs(eloK(20) - ELO_PER_LOGIT / 2) < 1e-12);
		assert.throws(() => eloK(-1), RangeError);
		assert.throws(() => eloK(Number.NaN), RangeError);
	});

	it("moves θ up and b down on a correct answer; zero-sum when both counts are equal (property)", () => {
		fc.assert(
			fc.property(rating, rating, fc.boolean(), fc.integer({ min: 0, max: 500 }), (theta, b, correct, n) => {
				const update = eloUpdate({ theta, b, correct, studentAnswers: n, itemAnswers: n });
				assert.equal(update.expected, expectedScore(theta, b));
				assert.ok(Math.abs(update.theta - theta + (update.b - b)) < 1e-9, "Δθ = −Δb");
				if (correct) assert.ok(update.theta >= theta && update.b <= b);
				else assert.ok(update.theta <= theta && update.b >= b);
			}),
		);
	});

	it("a new item moves more than a well-measured learner (uncertainty function)", () => {
		const update = eloUpdate({ theta: 1000, b: 1000, correct: true, studentAnswers: 200, itemAnswers: 0 });
		assert.ok(Math.abs(update.b - 1000) > Math.abs(update.theta - 1000));
	});
});

describe("item priors from the node stage", () => {
	it("b₀ = 1000 + 200·(s − 1) + 60·z with z clamped to [−1, 1]", () => {
		assert.equal(itemPriorB(1), 1000);
		assert.equal(itemPriorB(4, 0.5), 1630);
		assert.equal(itemPriorB(7, 3), 2260);
		assert.equal(itemPriorB(2, -9), 1140);
		assert.equal(itemPriorB(3, Number.NaN), 1400);
		for (const stage of [0, 8, 2.5, Number.NaN]) assert.throws(() => itemPriorB(stage), RangeError, String(stage));
	});
});
