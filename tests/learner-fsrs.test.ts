/**
 * Learner model — FSRS-7 wrapper (ts-fsrs 6.0.0) and FIRe interpolation
 * (r2 §9.4 availability M, §9.6b fractional credit, §9.13 (4)).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import {
	cardIdFor,
	FSRS_STATE,
	fromSchedulerCard,
	interpolateCredit,
	isDueAt,
	newMemory,
	previewMemory,
	retrievability,
	reviewMemory,
	shortenDue,
	toSchedulerCard,
} from "../src/core/learner/fsrs.ts";
import { DEFAULT_LEARNER_PARAMS } from "../src/core/learner/params.ts";
import type { FsrsMemory } from "../src/core/learner/types.ts";
import { day } from "./learner-fixtures.ts";

const P = DEFAULT_LEARNER_PARAMS;
const close = (actual: number, expected: number, tol: number, msg?: string) =>
	assert.ok(Math.abs(actual - expected) <= tol, `${msg ?? ""} expected ${expected} ± ${tol}, got ${actual}`);

/** A card in the Review state: Good on day 0, Good again on day 3. */
function reviewCard(): FsrsMemory {
	const id = cardIdFor("ohm", 1);
	const first = reviewMemory(undefined, id, 3, day(0), 0.9, P);
	return reviewMemory(first, id, 3, day(3), 0.9, P);
}

describe("learner FSRS-7 wrapper", () => {
	it("first Good review matches the FSRS-7 default weights (golden values)", () => {
		const m = reviewMemory(undefined, cardIdFor("ohm", 1), 3, day(0), 0.9, P);
		close(m.stability, 3.9221, 1e-4, "S");
		close(m.stabilityFast, 3.13768, 1e-4, "Sf");
		close(m.difficulty, 3.53072398, 1e-6, "D");
		assert.equal(m.reps, 1);
		assert.equal(m.lastReviewAt, day(0));
		assert.equal(m.cardId, "ohm@v1");
	});

	it("serialization round-trips through the scheduler card", () => {
		const m = reviewCard();
		assert.deepEqual(fromSchedulerCard(toSchedulerCard(m)), m);
		const fresh = newMemory("x@v2", day(0), P, 0.9);
		assert.equal(fresh.state, FSRS_STATE.new);
		assert.deepEqual(fromSchedulerCard(toSchedulerCard(fresh)), fresh);
	});

	it("R(t) is 1 without a card, in (0,1] and non-increasing with elapsed time", () => {
		assert.equal(retrievability(undefined, day(10), P), 1);
		assert.equal(retrievability(newMemory("x@v1", day(0), P, 0.9), day(10), P), 1);
		const m = reviewCard();
		let prev = 1;
		for (const d of [3, 3.5, 5, 10, 30, 100, 1000]) {
			const r = retrievability(m, day(d), P);
			assert.ok(r > 0 && r <= 1 && r <= prev + 1e-12, `R(${d}) = ${r}`);
			prev = r;
		}
		close(retrievability(m, day(3), P), 1, 1e-4, "R at the review instant");
	});

	it("Again after Good is a lapse; Hard is a pass", () => {
		const m = reviewCard();
		const again = reviewMemory(m, m.cardId, 1, day(20), 0.9, P);
		assert.equal(again.lapses, m.lapses + 1);
		const hard = reviewMemory(m, m.cardId, 2, day(20), 0.9, P);
		assert.equal(hard.lapses, m.lapses);
		assert.ok(hard.stability > m.stability, "Hard still grows stability when recalled late");
	});

	it("clock skew (review before lastReviewAt) never throws and never moves time back", () => {
		const m = reviewCard();
		const skewed = reviewMemory(m, m.cardId, 3, day(1), 0.9, P);
		assert.equal(skewed.lastReviewAt, m.lastReviewAt);
		assert.doesNotThrow(() => interpolateCredit(m, 0.5, day(1), 0.9, P));
	});

	it("is deterministic (fuzz is seeded by the card)", () => {
		assert.deepEqual(reviewCard(), reviewCard());
		const m = reviewCard();
		assert.deepEqual(reviewMemory(m, m.cardId, 3, day(30), 0.9, P), reviewMemory(m, m.cardId, 3, day(30), 0.9, P));
	});

	it("shortenDue pulls a future due date towards now, never pushes it", () => {
		const m = reviewCard();
		const at = day(4);
		const s = shortenDue(m, 0.5, at);
		assert.ok(Date.parse(s.dueAt) < Date.parse(m.dueAt) && Date.parse(s.dueAt) > Date.parse(at));
		assert.equal(shortenDue(m, 1, at), m);
		const due = { ...m, dueAt: day(2) };
		assert.equal(shortenDue(due, 0.5, at), due);
		assert.equal(isDueAt(due, at), true);
	});
});

describe("learner FIRe interpolation (r2 §9.6b)", () => {
	it("w* = 0 changes nothing", () => {
		const m = reviewCard();
		assert.equal(interpolateCredit(m, 0, day(20), 0.9, P), m);
	});

	it("w* = 1 equals a Good review (S, Sf, last review, due) and keeps D", () => {
		const m = reviewCard();
		const at = day(20);
		const credited = interpolateCredit(m, 1, at, 0.9, P);
		const good = previewMemory(m, 3, at, 0.9, P);
		close(credited.stability, good.stability, 1e-9, "S");
		close(credited.stabilityFast, good.stabilityFast, 1e-9, "Sf");
		assert.equal(credited.lastReviewAt, good.lastReviewAt);
		const dueGap = Math.abs(Date.parse(credited.dueAt) - Date.parse(good.dueAt));
		assert.ok(dueGap <= 86_400_000, `due differs by ${dueGap} ms`);
		assert.equal(credited.difficulty, m.difficulty, "implicit credit never touches D");
		assert.equal(credited.reps, m.reps, "implicit credit is not a real repetition");
		assert.equal(credited.lapses, m.lapses);
	});

	it("credit is monotone in w*: S, Sf and R(now) never decrease (property)", () => {
		const m = reviewCard();
		fc.assert(
			fc.property(
				fc.double({ min: 0, max: 1, noNaN: true }),
				fc.double({ min: 0, max: 1, noNaN: true }),
				fc.double({ min: 4, max: 200, noNaN: true }),
				(a, b, d) => {
					const [lo, hi] = a <= b ? [a, b] : [b, a];
					const at = day(d);
					const x = interpolateCredit(m, lo, at, 0.9, P);
					const y = interpolateCredit(m, hi, at, 0.9, P);
					assert.ok(y.stability >= x.stability - 1e-9 && y.stabilityFast >= x.stabilityFast - 1e-9);
					const rx = retrievability(x, at, P);
					const ry = retrievability(y, at, P);
					assert.ok(rx >= 0 && rx <= 1 && ry >= 0 && ry <= 1);
					assert.ok(ry >= rx - 1e-9, `R(${hi}) = ${ry} < R(${lo}) = ${rx}`);
				},
			),
			{ numRuns: 60 },
		);
	});

	it("New cards receive no credit", () => {
		const fresh = newMemory("x@v1", day(0), P, 0.9);
		assert.equal(interpolateCredit(fresh, 1, day(5), 0.9, P), fresh);
	});
});
