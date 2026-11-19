/**
 * Healthy weekly streak (docs/research/00-SINTESE.md §2.11; r7 §4.4): weekly
 * goal 5/7, valid day = 10 min or empty review queue, freezes earned (1 per 2
 * completed weeks, max 2) and consumed automatically, 48 h repair, travel mode.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeStreak, dayKeyFromNumber, dayNumber, StreakError, weekStartOf, type DayActivity } from "../src/core/progress/index.ts";

const W1 = "2026-11-02"; // Monday
const plus = (day: string, n: number): string => dayKeyFromNumber(dayNumber(day) + n);
/** `count` valid days (15 min) starting on `monday`. */
const week = (monday: string, count: number, minutes = 15): DayActivity[] => Array.from({ length: count }, (_, i) => ({ day: plus(monday, i), activeMinutes: minutes }));

describe("weekly streak", () => {
	it("counts completed weeks and earns one freeze every two of them", () => {
		const days = [...week(W1, 5), ...week(plus(W1, 7), 6)];
		const state = computeStreak(days, plus(W1, 14));
		assert.equal(state.weekStart, plus(W1, 14));
		assert.equal(state.weeksStreak, 2);
		assert.equal(state.bestWeeksStreak, 2);
		assert.equal(state.freezes, 1);
		assert.equal(state.weeksTowardFreeze, 0);
		assert.deepEqual(
			state.history.map((w) => w.outcome),
			["completed", "completed"],
		);
		assert.equal(state.currentWeekValidDays, 0);
		assert.equal(state.daysLeftInWeek, 6);
		assert.equal(state.targetReachable, true);
	});

	it("consumes a freeze automatically on a missed week and keeps the streak", () => {
		const days = [...week(W1, 5), ...week(plus(W1, 7), 5), ...week(plus(W1, 14), 2), ...week(plus(W1, 21), 5)];
		const state = computeStreak(days, plus(W1, 28));
		assert.deepEqual(
			state.history.map((w) => w.outcome),
			["completed", "completed", "frozen", "completed"],
		);
		assert.equal(state.weeksStreak, 3);
		assert.equal(state.freezes, 0);
	});

	it("never holds more than two freezes", () => {
		const days = Array.from({ length: 8 }, (_, w) => week(plus(W1, 7 * w), 5)).flat();
		const state = computeStreak(days, plus(W1, 56));
		assert.equal(state.weeksStreak, 8);
		assert.equal(state.freezes, 2);
	});

	it("offers a 48 h repair after a missed week without freezes, and the repair restores the streak", () => {
		const base = [...week(W1, 5), ...week(plus(W1, 7), 2)];
		const monday3 = plus(W1, 14);

		const pending = computeStreak(base, monday3);
		assert.equal(pending.weeksStreak, 0);
		assert.deepEqual(pending.repair, { lostStreak: 1, lastDay: plus(monday3, 1), minutesNeeded: 20 });
		assert.equal(pending.history.at(-1)?.outcome, "broken");

		const repaired = computeStreak([...base, { day: plus(monday3, 1), activeMinutes: 25 }], plus(monday3, 1));
		assert.equal(repaired.history.at(-1)?.outcome, "repaired");
		assert.equal(repaired.weeksStreak, 1);
		assert.equal(repaired.repair, null);

		const tooShort = computeStreak([...base, { day: monday3, activeMinutes: 15 }], plus(monday3, 2));
		assert.equal(tooShort.history.at(-1)?.outcome, "broken");
		assert.equal(tooShort.repair, null);

		const tooLate = computeStreak([...base, { day: plus(monday3, 2), activeMinutes: 40 }], plus(monday3, 2));
		assert.equal(tooLate.history.at(-1)?.outcome, "broken");
		assert.equal(tooLate.weeksStreak, 0);
		assert.equal(tooLate.repair, null);
	});

	it("travel days pause the week and spend the yearly allowance only when the day is not valid", () => {
		const travel = [0, 1, 2].map((i) => ({ day: plus(W1, 7 + i), activeMinutes: 0, travel: true }));
		const studiedWhileTravelling = { day: plus(W1, 10), activeMinutes: 30, travel: true };
		const days = [...week(W1, 5), ...travel, studiedWhileTravelling, { day: plus(W1, 11), activeMinutes: 12 }];
		const state = computeStreak(days, plus(W1, 14));
		assert.equal(state.history[1]?.outcome, "paused");
		assert.equal(state.history[1]?.travelDays, 3);
		assert.equal(state.history[1]?.validDays, 2);
		assert.equal(state.weeksStreak, 1);
		assert.equal(state.travelDaysLeft, 11);

		const limited = computeStreak(days, plus(W1, 14), { travelDaysPerYear: 2 });
		assert.equal(limited.history[1]?.travelDays, 2);
		assert.notEqual(limited.history[1]?.outcome, "paused");
	});

	it("an empty review queue makes a short day valid", () => {
		const days: DayActivity[] = Array.from({ length: 5 }, (_, i) => ({ day: plus(W1, i), activeMinutes: 3, reviewQueueCleared: true }));
		assert.equal(computeStreak(days, plus(W1, 7)).history[0]?.outcome, "completed");
		assert.equal(computeStreak(days.map((d) => ({ ...d, reviewQueueCleared: false })), plus(W1, 7)).history[0]?.outcome, "paused");
	});

	it("never breaks on the learner's first (partial) week", () => {
		const thursday = plus(W1, 3);
		const days = [...week(thursday, 2), ...week(plus(W1, 7), 5)];
		const state = computeStreak(days, plus(W1, 14));
		assert.deepEqual(
			state.history.map((w) => w.outcome),
			["paused", "completed"],
		);
		assert.equal(state.weeksStreak, 1);
	});

	it("weeks with no activity break the streak once freezes run out", () => {
		const days = [...week(W1, 5), ...week(plus(W1, 7), 5), ...week(plus(W1, 35), 5)];
		const state = computeStreak(days, plus(W1, 42));
		assert.deepEqual(
			state.history.map((w) => w.outcome),
			["completed", "completed", "frozen", "broken", "broken", "completed"],
		);
		assert.equal(state.weeksStreak, 1);
		assert.equal(state.bestWeeksStreak, 2);
	});

	it("shows the current week as soon as its goal is met, and the informative day run", () => {
		const days = [...week(W1, 5), ...week(plus(W1, 7), 5)];
		const state = computeStreak(days, plus(W1, 11));
		assert.equal(state.weeksStreak, 2);
		assert.equal(state.currentWeekValidDays, 5);
		assert.equal(state.dayRun, 5);
		const gap = computeStreak(days, plus(W1, 13));
		assert.equal(gap.dayRun, 0);
	});

	it("applies a goal change only from its week on", () => {
		const days = [...week(W1, 3), ...week(plus(W1, 7), 3)];
		const state = computeStreak(days, plus(W1, 14), { weeklyTarget: 5 }, { targetChanges: [{ weekStart: plus(W1, 7), weeklyTarget: 3 }] });
		assert.deepEqual(
			state.history.map((w) => [w.target, w.outcome]),
			[
				[5, "paused"],
				[3, "completed"],
			],
		);
	});

	it("ignores days after asOf, is deterministic, and validates its configuration", () => {
		const days = [...week(W1, 5), ...week(plus(W1, 7), 5)];
		assert.deepEqual(computeStreak(days, plus(W1, 6)), computeStreak(days.slice(0, 5), plus(W1, 6)));
		assert.deepEqual(computeStreak(days, plus(W1, 9)), computeStreak([...days].reverse(), plus(W1, 9)));
		assert.throws(() => computeStreak(days, plus(W1, 9), { weeklyTarget: 8 }), StreakError);
		assert.throws(() => computeStreak(days, "2026-13-01"), StreakError);
		assert.equal(weekStartOf("2026-11-18"), "2026-11-16");
		const empty = computeStreak([], "2026-11-18");
		assert.equal(empty.weeksStreak, 0);
		assert.equal(empty.targetReachable, true);
	});
});
