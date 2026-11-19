/**
 * Regression tests from the adversarial review of src/core/progress
 * (docs/research/00-SINTESE.md §2.3, §2.11; r7 §4.3–§4.7; mathua §8): each
 * block pins one bug that the original suite let through.
 *
 *   • rows produced by `creditEvent` must always be readable by the ledger
 *     schema (non-ISO `at`, whitespace ids and > 1 day events broke this);
 *   • the learner-facing reason shows the APPLIED XP;
 *   • a corrupted ledger total must not hang `levelFromXp`;
 *   • streak goal changes apply with no activity; a travel day is not "open";
 *   • tied simulated learners get a mid-rank percentile;
 *   • the barrel does not re-export names that collide with other core barrels.
 *
 * Second review:
 *   • an `at` whose study day falls outside years 0000–9999 produced a key
 *     like "+010000-01-01" that the ledger reader rejects (the row and its
 *     dedupe key were lost); it is now refused up front;
 *   • `pacePercentile` with NaN XP reported "p90";
 *   • a config that parsed could still make the pace / cohort functions throw
 *     (empty `days`, fewer than 2 quantiles);
 *   • `expectedScore` was star-exported by both this barrel and the lesson
 *     barrel (ambiguous in src/core/index.ts) — now checked against EVERY
 *     sibling core barrel;
 *   • the simulator compounded retries (the k-th retry cost 0.3^k of the
 *     lesson), so learners failing most checks learned almost for free;
 *   • `replayXpLedger` added one `otherMinutesToday` to EVERY replayed day
 *     (other domains' minutes now come per day: `otherMinutesOn`).
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import fc from "fast-check";
import * as progress from "../src/core/progress/index.ts";
import {
	CohortError,
	computeStreak,
	DEFAULT_PROGRESSION_CONFIG,
	honestProfile,
	creditEvent,
	deriveRules,
	diagnosticCredit,
	eventCredit,
	LevelCurveError,
	levelFromXp,
	levelProgress,
	MAX_EVENT_MINUTES,
	MAX_LEVEL,
	MemoryLedgerIndex,
	pacePercentile,
	parseLedgerEntry,
	parseLedgerLine,
	parseProgressEvent,
	parseProgressionConfig,
	ProgressEventError,
	ProgressionConfigError,
	progressionConfigOrDefault,
	ProgressRuleError,
	replayXpLedger,
	RULES,
	simulateLearner,
	studyDay,
	summarizeLedger,
	TierError,
	tierStanding,
	type PaceCurve,
	type ProgressEvent,
	type ProgressEventBody,
	type ProgressionConfig,
	type XpLedgerEntry,
} from "../src/core/progress/index.ts";
import { expectedScore } from "../src/core/progress/elo.ts";

const base = (overrides: Partial<ProgressEvent> = {}): ProgressEvent =>
	({ kind: "diagnostic", eventId: "d1", at: "2026-11-02T12:00:00Z", domainId: "electronics", items: 3, ...overrides }) as ProgressEvent;

const minutesArb = fc.double({ min: 0, max: MAX_EVENT_MINUTES, noNaN: true, noDefaultInfinity: true });
const bodyArb: fc.Arbitrary<ProgressEventBody> = fc.oneof(
	fc.record({
		kind: fc.constant("lesson" as const),
		nodeId: fc.constant("n1"),
		focusedMin: minutesArb,
		expectedMin: fc.option(fc.double({ min: 0.1, max: 600, noNaN: true }), { nil: undefined }),
		checkPassed: fc.option(fc.boolean(), { nil: undefined }),
	}),
	fc.record({
		kind: fc.constant("item" as const),
		itemId: fc.constant("i1"),
		theta: fc.double({ min: -3000, max: 3000, noNaN: true }),
		b: fc.double({ min: -3000, max: 3000, noNaN: true }),
		correct: fc.boolean(),
		focusedMin: minutesArb,
		hints: fc.option(fc.integer({ min: 0, max: 9 }), { nil: undefined }),
		medianMin: fc.option(fc.double({ min: 0.1, max: 60, noNaN: true }), { nil: undefined }),
	}),
	fc.record({
		kind: fc.constant("review" as const),
		nodeId: fc.constant("n2"),
		R: fc.double({ min: 0, max: 1, noNaN: true }),
		focusedMin: minutesArb,
		cards: fc.option(fc.integer({ min: 1, max: 200 }), { nil: undefined }),
		origin: fc.option(fc.constantFrom("app" as const, "anki" as const, "obsidian" as const), { nil: undefined }),
	}),
	fc.record({
		kind: fc.constant("diagnostic" as const),
		items: fc.integer({ min: 0, max: MAX_EVENT_MINUTES }),
		focusedMin: fc.option(minutesArb, { nil: undefined }),
	}),
);

describe("ledger boundary: what creditEvent writes, the reader reads back", () => {
	it("every row produced by replayXpLedger passes parseLedgerEntry (property)", () => {
		const eventsArb = fc
			.array(fc.tuple(bodyArb, fc.integer({ min: 0, max: 5 * 24 * 60 }), fc.constantFrom("english", "electronics")), { maxLength: 40 })
			.map((rows) =>
				rows.map(
					([body, offset, domainId], i): ProgressEvent => ({
						...body,
						eventId: `e${i}`,
						at: new Date(Date.parse("2026-11-02T03:00:00Z") + offset * 60_000).toISOString(),
						domainId,
					}),
				),
			);
		fc.assert(
			fc.property(eventsArb, (events) => {
				for (const entry of replayXpLedger(events)) {
					assert.deepEqual(parseLedgerEntry(entry), entry);
					assert.deepEqual(parseLedgerLine(`${JSON.stringify(entry)}\r`), entry);
				}
			}),
		);
	});

	it("refuses an `at` that is not ISO-8601 with offset (Date.parse is engine-specific)", () => {
		for (const at of ["Nov 2, 2026 12:00", "2026-11-02 12:00", "2026-02-30T00:00:00Z", "2026-11-02T12:00:00"]) {
			assert.throws(() => creditEvent(base({ at }), new MemoryLedgerIndex()), ProgressRuleError, at);
			assert.throws(() => studyDay(at), ProgressRuleError, at);
		}
		assert.equal(studyDay("2026-11-02T12:00:00-03:00", { utcOffsetMin: -180 }), "2026-11-02");
	});

	it("keeps ids verbatim: whitespace is refused, never trimmed (the dedupe key must not change)", () => {
		assert.throws(() => creditEvent(base({ eventId: " d1 " }), new MemoryLedgerIndex()), ProgressRuleError);
		assert.throws(() => parseProgressEvent(base({ eventId: " d1 " })), ProgressEventError);
		const decision = creditEvent(base({ eventId: "anki:1700000000000" }), new MemoryLedgerIndex());
		assert.equal(decision.status, "credited");
		if (decision.status === "credited") assert.equal(parseLedgerEntry(decision.entry).eventId, "anki:1700000000000");
		// The rules version is written on every row too: it obeys the same rule.
		assert.throws(() => deriveRules(RULES, {}, " 2027-01-r2 "), ProgressRuleError);
	});

	it("refuses look-alike domain ids that would split one domain's XP", () => {
		for (const domainId of ["Electronics", "electronics ", "", "../etc"]) {
			assert.throws(() => creditEvent(base({ domainId }), new MemoryLedgerIndex()), ProgressRuleError, domainId);
			assert.throws(() => parseProgressEvent(base({ domainId })), ProgressEventError, domainId);
		}
	});

	it("bounds one event to a day of focused time, in the pricing and at the boundary", () => {
		assert.throws(() => eventCredit({ kind: "lesson", nodeId: "n", focusedMin: MAX_EVENT_MINUTES + 1 }), ProgressRuleError);
		assert.throws(() => parseProgressEvent({ kind: "review", eventId: "r1", at: "2026-11-02T12:00:00Z", domainId: "electronics", nodeId: "n", R: 0.9, focusedMin: 100_000 }), ProgressEventError);
		assert.equal(diagnosticCredit(5000, undefined).minutes, MAX_EVENT_MINUTES);
	});

	it("the reader rejects rows whose XP cannot come from minutes × multiplier (no inflated totals)", () => {
		const [entry] = replayXpLedger([base()]);
		assert.ok(entry);
		const inflated: XpLedgerEntry = { ...entry, raw: 1e30, capped: 1e30 };
		assert.equal(parseLedgerLine(JSON.stringify(inflated)), null);
		assert.equal(parseLedgerLine(JSON.stringify({ ...entry, multiplier: 2 })), null);
		assert.throws(() => parseLedgerEntry(inflated), ProgressEventError);
	});

	it("the reason shows the APPLIED XP, and the calculated one only as context", () => {
		const plain = creditEvent(base({ items: 30 }), new MemoryLedgerIndex());
		assert.equal(plain.status, "credited");
		if (plain.status === "credited") assert.match(plain.entry.reason, /^Diagnóstico inicial: \+30,0 XP \(30,0 min × 1,00\)$/);
		const capped = creditEvent({ ...base(), kind: "review", nodeId: "n", R: 0.9, focusedMin: 10 }, new MemoryLedgerIndex(), { otherMinutesToday: 400 });
		assert.equal(capped.status, "credited");
		if (capped.status === "credited") assert.match(capped.entry.reason, /\+2,5 XP .*limite diário aplicado, seriam 10,0/);
	});

	it("validates study-day options with a clear error instead of an engine RangeError", () => {
		assert.throws(() => studyDay("2026-11-02T12:00:00Z", { utcOffsetMin: Number.NaN }), ProgressRuleError);
		assert.throws(() => studyDay("2026-11-02T12:00:00Z", { dayStartHour: 24 }), ProgressRuleError);
	});
});

describe("levels never hang", () => {
	it("a corrupted total (1e30, MAX_VALUE) saturates at MAX_LEVEL instead of looping forever", () => {
		assert.equal(levelFromXp(1e30), MAX_LEVEL);
		assert.equal(levelFromXp(Number.MAX_VALUE), MAX_LEVEL);
		assert.equal(levelProgress(1e30).level, MAX_LEVEL);
		assert.ok(levelFromXp(1e15) < MAX_LEVEL);
		fc.assert(
			fc.property(fc.double({ min: 0, max: 1e300, noNaN: true }), fc.double({ min: 0, max: 1e300, noNaN: true }), (x, y) => {
				const [lo, hi] = x <= y ? [x, y] : [y, x];
				assert.ok(levelFromXp(lo) <= levelFromXp(hi));
			}),
		);
		assert.equal(summarizeLedger([]).totalXp, 0);
	});

	it("an invalid curve is refused with LevelCurveError", () => {
		assert.throws(() => levelFromXp(100, { a: 0, p: 1.7 }), LevelCurveError);
		assert.throws(() => levelFromXp(100, { a: 20, p: Number.NaN }), LevelCurveError);
	});
});

describe("tiers", () => {
	it("refuses a NaN retention threshold instead of silently reporting Novato", () => {
		const core = { coreVersion: "v1", stages: [["a"], ["b"], ["c"], ["d"], ["e"], ["f"], ["g"]] };
		assert.throws(() => tierStanding(core, new Map([["a", 0.9]]), { retainedR: Number.NaN }), TierError);
	});
});

describe("streak edge cases", () => {
	it("with no activity yet, the weekly goal in force still honours targetChanges", () => {
		const state = computeStreak([], "2026-11-18", { weeklyTarget: 5 }, { targetChanges: [{ weekStart: "2026-11-02", weeklyTarget: 3 }] });
		assert.equal(state.weeklyTarget, 3);
	});

	it("a travel day today is not counted as an open day (it already lowered the requirement)", () => {
		// Week of 2026-11-16: Mon, Tue valid; Saturday (asOf) is travel; only Sunday left.
		// Target 5 − 1 travel = 4 needed; 2 valid + 1 open day = 3 → unreachable.
		const days = [
			{ day: "2026-11-09", activeMinutes: 15 },
			{ day: "2026-11-16", activeMinutes: 15 },
			{ day: "2026-11-17", activeMinutes: 15 },
			{ day: "2026-11-21", activeMinutes: 0, travel: true },
		];
		assert.equal(computeStreak(days, "2026-11-21").targetReachable, false);
		// Studying today instead makes it valid: still 3 + 1 open (Sunday) < 5.
		assert.equal(computeStreak([...days.slice(0, 3), { day: "2026-11-21", activeMinutes: 15 }], "2026-11-21").targetReachable, false);
		// A plain day today is still open: on Thursday, 2 valid + today + 3 days left = 6 ≥ 5.
		assert.equal(computeStreak(days.slice(0, 3), "2026-11-19").targetReachable, true);
	});
});

describe("Eu vs Eu with ties", () => {
	it("a learner tied with a run of simulated learners gets the middle of the run, not its bottom", () => {
		const quantiles = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95];
		const curve: PaceCurve = { profileId: "3h", hoursPerDay: 3, days: [1, 2], xp: [[0, 0, 0, 40, 90, 130, 150], [0, 0, 0, 40, 90, 130, 150]], pm: [[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]] };
		const tied = pacePercentile(curve, quantiles, 1, 0);
		assert.equal(tied.percentile, 15);
		assert.equal(tied.clamped, null);
		assert.equal(pacePercentile(curve, quantiles, 1, 90).percentile, 75);
		assert.equal(pacePercentile(curve, quantiles, 1, 65).percentile, 63);
	});
});

describe("barrel names", () => {
	it("does not re-export names that collide with other core barrels (curriculum replayLedger, stats dayKey)", () => {
		const names = Object.keys(progress);
		for (const clash of ["replayLedger", "dayKey"]) assert.ok(!names.includes(clash), `progress exporta ${clash}`);
		for (const renamed of ["replayXpLedger", "dayKeyFromNumber"]) assert.ok(names.includes(renamed), `progress não exporta ${renamed}`);
	});

	it("shares no runtime name with ANY sibling core barrel (lesson's expectedScore clashed with elo.ts)", async () => {
		const coreDir = path.join(import.meta.dirname, "..", "src", "core");
		const siblings = fs
			.readdirSync(coreDir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && entry.name !== "progress" && fs.existsSync(path.join(coreDir, entry.name, "index.ts")))
			.map((entry) => entry.name);
		assert.ok(siblings.includes("lesson"), "o barrel de lesson existe");
		const ours = new Set(Object.keys(progress));
		for (const sibling of siblings) {
			const theirs = Object.keys((await import(pathToFileURL(path.join(coreDir, sibling, "index.ts")).href)) as object);
			const clashes = theirs.filter((name) => ours.has(name));
			assert.deepEqual(clashes, [], `progress e ${sibling} exportam os mesmos nomes (export * ambíguo em src/core/index.ts)`);
		}
		assert.ok(!ours.has("expectedScore"));
		assert.equal(typeof expectedScore, "function", "expectedScore continua em ./elo.ts");
	});
});

describe("study days outside years 0000–9999", () => {
	it("are refused up front instead of writing a row the ledger reader rejects", () => {
		for (const [at, utcOffsetMin] of [
			["0000-01-01T01:00:00Z", 0],
			["9999-12-31T23:00:00Z", 14 * 60],
		] as const) {
			assert.throws(() => studyDay(at, { utcOffsetMin }), ProgressRuleError, at);
			assert.throws(() => creditEvent(base({ at }), new MemoryLedgerIndex(), { utcOffsetMin }), ProgressRuleError, at);
		}
		// The last representable days still work and round-trip through the reader.
		for (const at of ["0000-01-01T05:00:00Z", "9999-12-31T12:00:00Z"]) {
			const decision = creditEvent(base({ at }), new MemoryLedgerIndex());
			assert.equal(decision.status, "credited", at);
			if (decision.status === "credited") assert.deepEqual(parseLedgerLine(JSON.stringify(decision.entry)), decision.entry);
		}
	});
});

describe("pace percentile with a non-finite XP", () => {
	it("throws CohortError instead of reporting the top quantile", () => {
		const quantiles = [0.05, 0.5, 0.95];
		const curve: PaceCurve = { profileId: "3h", hoursPerDay: 3, days: [1, 2], xp: [[0, 50, 100], [10, 60, 120]], pm: [[0, 0, 0], [0, 0, 0]] };
		for (const xp of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) assert.throws(() => pacePercentile(curve, quantiles, 1, xp), CohortError, String(xp));
		assert.equal(pacePercentile(curve, quantiles, 1, 50).percentile, 50);
	});
});

describe("a config that parses is usable", () => {
	const withPace = (pace: ProgressionConfig["pace"]): unknown => ({ ...structuredClone(DEFAULT_PROGRESSION_CONFIG), pace });
	const withCohort = (cohort: Partial<ProgressionConfig["cohort"]>): unknown => ({ ...structuredClone(DEFAULT_PROGRESSION_CONFIG), cohort: { ...DEFAULT_PROGRESSION_CONFIG.cohort, ...cohort } });

	it("refuses a pace curve without days and fewer than 2 quantiles", () => {
		assert.throws(() => parseProgressionConfig(withPace({ quantiles: [0.5, 0.9], curves: [{ profileId: "3h", hoursPerDay: 3, days: [], xp: [], pm: [] }] })), ProgressionConfigError);
		assert.throws(() => parseProgressionConfig(withPace({ quantiles: [0.5], curves: [{ profileId: "3h", hoursPerDay: 3, days: [1], xp: [[10]], pm: [[0]] }] })), ProgressionConfigError);
		assert.throws(() => parseProgressionConfig(withCohort({ quantiles: [0.5], profiles: [{ profileId: "3h", hoursPerDay: 3, weeklyXp: [100] }] })), ProgressionConfigError);
		// The store's read path falls back to the defaults instead of handing the UI a config that throws later.
		assert.equal(progressionConfigOrDefault(withPace({ quantiles: [0.5], curves: [{ profileId: "3h", hoursPerDay: 3, days: [1], xp: [[10]], pm: [[0]] }] })).config, DEFAULT_PROGRESSION_CONFIG);
		// No curves / profiles: empty quantile lists are fine (the features stay hidden).
		assert.doesNotThrow(() => parseProgressionConfig(withPace({ quantiles: [], curves: [] })));
	});
});

describe("replaying a ledger next to other domains", () => {
	const review = (eventId: string, at: string): ProgressEvent => ({ kind: "review", eventId, at, domainId: "english", nodeId: "n", R: 0.9, focusedMin: 10 });
	const events = [review("a", "2026-11-02T12:00:00Z"), review("b", "2026-11-03T12:00:00Z")];
	const otherMinutesOn = (day: string): number => (day === "2026-11-02" ? 400 : 0);

	it("takes the other domains' minutes per study day, like crediting each event on its own day", () => {
		const replayed = replayXpLedger(events, { otherMinutesOn });
		assert.deepEqual(
			replayed.map((entry) => entry.capped),
			[2.5, 10],
		);
		const index = new MemoryLedgerIndex();
		const incremental = events.map((event) => {
			const decision = creditEvent(event, index, { otherMinutesToday: otherMinutesOn(studyDay(event.at)) });
			assert.equal(decision.status, "credited");
			if (decision.status !== "credited") throw new Error("unreachable");
			index.add(decision.entry);
			return decision.entry;
		});
		assert.deepEqual(replayed, incremental);
	});

	it("refuses a single otherMinutesToday for a multi-day replay and a bad per-day value", () => {
		assert.throws(() => replayXpLedger(events, { otherMinutesToday: 400 } as never), ProgressRuleError);
		assert.throws(() => replayXpLedger(events, { otherMinutesOn: () => Number.NaN }), ProgressRuleError);
	});
});

describe("simulator retries do not compound", () => {
	it("each retry costs retryFraction × the FIRST attempt: lesson minutes per learned node ≈ 1 + 0.3·(1/p − 1)", () => {
		const domain = { stages: [{ nodes: 3000, lessonMin: 10 }], unlockFraction: 0.7 };
		const params = { days: 60, nodeTimeSigma: 0, dailyMinutesSigma: 0, skipProbability: { lo: 0, hi: 0 }, vacationDaysPerYear: 0 };
		const perNode = (checkPassRate: number): number => {
			const t = simulateLearner(honestProfile(3, { id: `p${checkPassRate}`, checkPassRate, speed: 1, speedSigma: 0 }), domain, 42, { params });
			return t.lessonMinutes / t.learnedNodes / 10;
		};
		assert.ok(Math.abs(perNode(1) - 1) < 0.01, "sem falhas, uma tentativa por nó");
		// p = 0.2: 4 failures on average → 1 + 0.3·4 = 2.2 (compounding gave ≈ 1.4).
		const lowPass = perNode(0.2);
		assert.ok(lowPass > 1.9 && lowPass < 2.5, `minutos de aula por nó aprendido = ${lowPass.toFixed(2)}× a aula`);
	});
});
