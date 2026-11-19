/**
 * XP pricing and ledger invariants (docs/research/00-SINTESE.md §2.11;
 * r7 §4.3, §4.7 I1–I7):
 *   I1 XP ≥ 0 per event · I2 idempotent by eventId · soft cap monotonic ·
 *   I5 XP/h ≤ 90 · I6 ∂XP/∂R ≤ 0 for reviews · I7 XP independent of the
 *   Again/Hard/Good/Easy self-assessment · rulesVersion recorded ·
 *   recalibration never reduces XP already granted.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import {
	creditEvent,
	deriveRules,
	eventCredit,
	gReview,
	MAX_MULTIPLIER,
	mDif,
	MemoryLedgerIndex,
	parseLedgerLine,
	parseProgressEvent,
	ProgressEventError,
	ProgressRuleError,
	recordEvent,
	replayXpLedger,
	RULES,
	softCapped,
	softCappedExact,
	studyDay,
	summarizeLedger,
	validateRules,
	type ProgressEvent,
	type ProgressEventBody,
	type XpLedgerEntry,
} from "../src/core/progress/index.ts";

const DAY0 = Date.parse("2026-11-02T12:00:00Z");
const at = (minuteOffset: number): string => new Date(DAY0 + minuteOffset * 60_000).toISOString();

const minutesArb = fc.double({ min: 0, max: 600, noNaN: true, noDefaultInfinity: true });
const unitArb = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });

const bodyArb: fc.Arbitrary<ProgressEventBody> = fc.oneof(
	fc.record({
		kind: fc.constant("lesson" as const),
		nodeId: fc.constant("n1"),
		focusedMin: minutesArb,
		expectedMin: fc.option(fc.double({ min: 1, max: 120, noNaN: true }), { nil: undefined }),
		checkPassed: fc.option(fc.boolean(), { nil: undefined }),
	}),
	fc.record({
		kind: fc.constant("media" as const),
		resourceId: fc.constant("yt:abc"),
		focusedMin: minutesArb,
		mediaMin: fc.option(fc.double({ min: 1, max: 180, noNaN: true }), { nil: undefined }),
		checkPassed: fc.option(fc.boolean(), { nil: undefined }),
	}),
	fc.record({
		kind: fc.constant("item" as const),
		itemId: fc.constant("i1"),
		theta: fc.double({ min: 0, max: 2600, noNaN: true }),
		b: fc.double({ min: 0, max: 2600, noNaN: true }),
		correct: fc.boolean(),
		focusedMin: minutesArb,
		hints: fc.option(fc.integer({ min: 0, max: 6 }), { nil: undefined }),
		medianMin: fc.option(fc.double({ min: 0.5, max: 30, noNaN: true }), { nil: undefined }),
	}),
	fc.record({
		kind: fc.constant("review" as const),
		nodeId: fc.constant("n2"),
		R: unitArb,
		focusedMin: minutesArb,
		cards: fc.option(fc.integer({ min: 1, max: 50 }), { nil: undefined }),
		origin: fc.option(fc.constantFrom("app" as const, "anki" as const, "obsidian" as const), { nil: undefined }),
	}),
	fc.record({
		kind: fc.constant("diagnostic" as const),
		items: fc.integer({ min: 0, max: 60 }),
		focusedMin: fc.option(minutesArb, { nil: undefined }),
	}),
);

const eventsArb = fc.array(fc.tuple(bodyArb, fc.integer({ min: 0, max: 3 * 24 * 60 })), { maxLength: 40 }).map((pairs) =>
	pairs.map(([body, offset], i): ProgressEvent => ({ ...body, eventId: `e${i}`, at: at(offset), domainId: i % 3 === 0 ? "english" : "electronics" })),
);

const review = (eventId: string, minuteOffset: number, R: number, focusedMin: number): ProgressEvent => ({
	kind: "review",
	eventId,
	at: at(minuteOffset),
	domainId: "electronics",
	nodeId: "ee.ohm",
	R,
	focusedMin,
});

describe("multipliers (r7 §2.3 tables)", () => {
	it("mDif follows the Elo expected-score table", () => {
		assert.equal(mDif(0.95), 0.3);
		assert.ok(Math.abs(mDif(0.8) - 1) < 1e-12);
		assert.equal(mDif(0.7), 1.5);
		assert.equal(mDif(0.2), 1.5);
	});

	it("gReview follows the retrievability table (DR 0.9)", () => {
		assert.ok(Math.abs(gReview(0.9) - 1) < 1e-12);
		assert.ok(Math.abs(gReview(0.98) - 0.2) < 1e-12);
		assert.equal(gReview(0.85), 1.5);
		assert.equal(gReview(1), 0.1);
	});

	it("rejects out-of-range inputs with a clear error", () => {
		assert.throws(() => mDif(1.2), ProgressRuleError);
		assert.throws(() => gReview(-0.1), ProgressRuleError);
		assert.throws(() => gReview(0.9, 1), ProgressRuleError);
	});
});

describe("per-kind rules (r7 §4.3)", () => {
	it("caps lesson time at 1.5× expected and zeroes a rushed failed check", () => {
		const passed = eventCredit({ kind: "lesson", nodeId: "n", focusedMin: 100, expectedMin: 30, checkPassed: true });
		assert.equal(passed.minutes, 45);
		assert.equal(passed.multiplier, 1);
		const effort = eventCredit({ kind: "lesson", nodeId: "n", focusedMin: 20, expectedMin: 30, checkPassed: false });
		assert.equal(effort.multiplier, 0.25);
		const rushed = eventCredit({ kind: "lesson", nodeId: "n", focusedMin: 10, expectedMin: 30, checkPassed: false });
		assert.equal(rushed.multiplier, 0);
	});

	it("gives 0 XP to a guess and floors the hint factor at 0.4", () => {
		const guess = eventCredit({ kind: "item", itemId: "i", theta: 1000, b: 1000, correct: false, focusedMin: 0.1, medianMin: 2 });
		assert.equal(guess.multiplier, 0);
		const hinted = eventCredit({ kind: "item", itemId: "i", theta: 1000, b: 1000, correct: true, focusedMin: 2, hints: 9 });
		assert.ok(Math.abs(hinted.multiplier - mDif(0.5) * 0.4) < 1e-12);
	});

	it("caps Anki review time at 60 s per card", () => {
		const anki = eventCredit({ kind: "review", nodeId: "c", R: 0.9, focusedMin: 30, cards: 10, origin: "anki" });
		assert.equal(anki.minutes, 10);
		const app = eventCredit({ kind: "review", nodeId: "c", R: 0.9, focusedMin: 30, cards: 10 });
		assert.equal(app.minutes, 20);
	});
});

describe("invariants I1–I7", () => {
	it("I1: every credited event has 0 ≤ capped ≤ raw", () => {
		fc.assert(
			fc.property(eventsArb, (events) => {
				for (const entry of replayXpLedger(events)) {
					assert.ok(entry.capped >= 0, `capped < 0 em ${entry.eventId}`);
					assert.ok(entry.capped <= entry.raw, `capped > raw em ${entry.eventId}`);
				}
			}),
		);
	});

	it("I2: replaying an eventId grants nothing and the ledger ignores input order", () => {
		fc.assert(
			fc.property(
				eventsArb.chain((events) => fc.tuple(fc.constant(events), fc.shuffledSubarray(events, { minLength: events.length, maxLength: events.length }))),
				([events, shuffled]) => {
					const once = replayXpLedger(events);
					const twice = replayXpLedger([...events, ...events]);
					assert.deepEqual(twice, once);
					assert.deepEqual(replayXpLedger(shuffled), once);
					let entries: readonly XpLedgerEntry[] = once;
					for (const event of events) {
						const result = recordEvent(entries, event);
						assert.equal(result.duplicate, true);
						entries = result.entries;
					}
					assert.equal(entries, once);
				},
			),
		);
	});

	it("I2: totals count each eventId once even if a corrupted file repeats a row", () => {
		const entries = replayXpLedger([review("a", 0, 0.9, 3), review("b", 1, 0.9, 3)]);
		const corrupted = [...entries, entries[0] as XpLedgerEntry];
		assert.equal(summarizeLedger(corrupted).totalXp, summarizeLedger(entries).totalXp);
	});

	it("soft cap: additive over splits, never above minutes × multiplier, non-increasing in minutes already credited", () => {
		fc.assert(
			fc.property(minutesArb, minutesArb, minutesArb, fc.double({ min: 0, max: MAX_MULTIPLIER, noNaN: true }), (a, b, already, k) => {
				const whole = softCappedExact(a + b, k, already);
				const split = softCappedExact(a, k, already) + softCappedExact(b, k, already + a);
				assert.ok(Math.abs(whole - split) < 1e-6);
				assert.ok(whole <= (a + b) * k + 1e-9);
				assert.ok(softCappedExact(a, k, already + b) <= softCappedExact(a, k, already) + 1e-9);
				assert.ok(softCapped(a, k, already) >= 0);
			}),
		);
	});

	it("soft cap: 240 min at full rate, then ×0.5 until 360, then ×0.25", () => {
		assert.equal(softCapped(240, 1, 0), 240);
		assert.equal(softCapped(120, 1, 240), 60);
		assert.equal(softCapped(100, 1, 360), 25);
		assert.equal(softCapped(600, 1, 0), 240 + 60 + 60);
	});

	it("I5: XP per credited minute ≤ 1.5 (XP/h ≤ 90) for any sequence", () => {
		fc.assert(
			fc.property(eventsArb, (events) => {
				const entries = replayXpLedger(events);
				const xp = entries.reduce((sum, entry) => sum + entry.capped, 0);
				const minutes = entries.reduce((sum, entry) => sum + entry.minutes, 0);
				assert.ok(xp <= MAX_MULTIPLIER * minutes + 0.05 * entries.length + 1e-9);
				for (const entry of entries) assert.ok(entry.multiplier <= MAX_MULTIPLIER + 1e-12);
			}),
		);
	});

	it("I6: for reviews, XP never increases with R (reviewing earlier never pays more)", () => {
		fc.assert(
			fc.property(unitArb, unitArb, minutesArb, (r1, r2, focusedMin) => {
				const [lo, hi] = r1 <= r2 ? [r1, r2] : [r2, r1];
				const xp = (R: number) => {
					const credit = eventCredit({ kind: "review", nodeId: "n", R, focusedMin });
					return credit.minutes * credit.multiplier;
				};
				assert.ok(xp(hi) <= xp(lo) + 1e-9);
			}),
		);
	});

	it("I7: XP does not depend on the self-assessment, and the boundary refuses a rating field", () => {
		fc.assert(
			fc.property(unitArb, minutesArb, fc.constantFrom(1, 2, 3, 4), (R, focusedMin, rating) => {
				const plain = review("r", 0, R, focusedMin);
				const rated = { ...plain, rating } as unknown as ProgressEvent;
				const index = new MemoryLedgerIndex();
				const a = creditEvent(plain, index);
				const b = creditEvent(rated, index);
				assert.equal(a.status, "credited");
				assert.equal(b.status, "credited");
				if (a.status === "credited" && b.status === "credited") assert.equal(a.entry.capped, b.entry.capped);
			}),
		);
		assert.throws(() => parseProgressEvent({ ...review("r", 0, 0.9, 3), rating: 3 }), ProgressEventError);
		assert.throws(() => parseProgressEvent({ ...review("r", 0, 0.9, 3), grade: "good" }), ProgressEventError);
		assert.deepEqual(parseProgressEvent(review("r", 0, 0.9, 3)), review("r", 0, 0.9, 3));
	});

	it("records the rules version on every row", () => {
		fc.assert(
			fc.property(eventsArb, (events) => {
				for (const entry of replayXpLedger(events)) {
					assert.equal(entry.rulesVersion, "2026-11-r1");
					assert.equal(entry.id, `xp:${entry.eventId}`);
				}
			}),
		);
	});

	it("recalibration never reduces XP already granted (grandfathered rows)", () => {
		const stingy = deriveRules(RULES, { gReviewMax: 0.5, mDifMax: 0.5, lessonFailCredit: 0, mediaFactor: 0.1 }, "2027-01-r2");
		fc.assert(
			fc.property(eventsArb, eventsArb, (past, future) => {
				const granted = replayXpLedger(past);
				const later = future.map((event) => ({ ...event, eventId: `f-${event.eventId}` }));
				const recalibrated = replayXpLedger([...past, ...later], { existing: granted, rules: stingy });
				assert.deepEqual(recalibrated.slice(0, granted.length), granted);
				assert.ok(summarizeLedger(recalibrated).totalXp >= summarizeLedger(granted).totalXp);
				for (const entry of recalibrated.slice(granted.length)) assert.equal(entry.rulesVersion, "2027-01-r2");
			}),
		);
	});

	it("a recalibration must carry a new version and keep the structural guarantees", () => {
		assert.throws(() => deriveRules(RULES, {}, RULES.version), ProgressRuleError);
		assert.throws(() => deriveRules(RULES, { mDifMax: 2 }, "x"), ProgressRuleError);
		assert.throws(() => deriveRules(RULES, { softCap: [{ afterMin: 240, factor: 0.5 }, { afterMin: 360, factor: 0.75 }] }, "x"), ProgressRuleError);
		assert.doesNotThrow(() => validateRules(RULES));
	});
});

describe("study day and ledger rows", () => {
	it("buckets the soft cap by study day (default: day starts at 04:00)", () => {
		assert.equal(studyDay("2026-11-03T01:30:00Z"), "2026-11-02");
		assert.equal(studyDay("2026-11-03T04:00:00Z"), "2026-11-03");
		assert.equal(studyDay("2026-11-03T05:00:00Z", { utcOffsetMin: -180 }), "2026-11-02");
	});

	it("applies the daily cap across domains via otherMinutesToday", () => {
		const index = new MemoryLedgerIndex();
		const decision = creditEvent(review("x", 0, 0.9, 10), index, { otherMinutesToday: 400 });
		assert.equal(decision.status, "credited");
		if (decision.status === "credited") {
			assert.equal(decision.entry.raw, 10);
			assert.equal(decision.entry.capped, 2.5);
			assert.match(decision.entry.reason, /limite diário/);
		}
	});

	it("round-trips ledger rows through the JSONL reader and skips bad lines", () => {
		const [entry] = replayXpLedger([review("a", 0, 0.9, 3)]);
		assert.ok(entry);
		assert.deepEqual(parseLedgerLine(JSON.stringify(entry)), entry);
		assert.equal(parseLedgerLine("{\"id\":"), null);
		assert.equal(parseLedgerLine(JSON.stringify({ ...entry, capped: entry.raw + 1 })), null);
		assert.equal(parseLedgerLine("   "), null);
	});

	it("rejects an event without eventId or with a bad date", () => {
		assert.throws(() => creditEvent({ ...review("a", 0, 0.9, 3), eventId: " " }, new MemoryLedgerIndex()), ProgressRuleError);
		assert.throws(() => creditEvent({ ...review("a", 0, 0.9, 3), at: "ontem" }, new MemoryLedgerIndex()), ProgressRuleError);
	});
});
