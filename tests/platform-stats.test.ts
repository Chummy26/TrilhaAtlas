/**
 * Platform · stats (docs/research/00-SINTESE.md §2.3, §2.10; r5 §5.5):
 *
 *  1. Provider hook: CallUsage → UsageEvent (disjoint pi buckets, local day).
 *  2. Token aggregation: day × domain × op × model rows, totals per model,
 *     US$ only for billing "api", estimated credits only for "subscription".
 *  3. Hours from heartbeats: 30 s window, 120 s idle, unions (no double
 *     counting), midnight split in a time zone, sessions; fast-check
 *     properties (bounded, order- and duplicate-invariant).
 *  4. Heatmap of N weeks.
 *  5. JSONL store in a temp dir: monthly files, atomic appends, range reads,
 *     corrupt lines skipped, invalid batches rejected whole.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import fc from "fast-check";
import {
	activeSecondsInWindow,
	activityHeatmap,
	aggregateActivity,
	aggregateUsage,
	callUsageOf,
	costFromRates,
	dayKey,
	denseDailySeries,
	heartbeatEvent,
	heatLevel,
	monthsInRange,
	pricingFromRates,
	StatsDateError,
	StatsEventError,
	usageEventFromCall,
	usdFromCallPricer,
	type ActivityEvent,
	type UsageEvent,
} from "../src/core/stats/index.ts";
import { activityLogFile, usageLogFile } from "../src/core/domains/paths.ts";
import { createStatsStore } from "../src/store/stats-store.ts";

const T0 = Date.parse("2026-11-18T13:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const SP = "America/Sao_Paulo"; // UTC-3, no DST

const tmpRoots: string[] = [];
function tmpRoot(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-platform-stats-"));
	tmpRoots.push(dir);
	return dir;
}
after(() => {
	for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true });
});

function usage(overrides: Partial<UsageEvent> = {}): UsageEvent {
	return {
		day: "2026-11-18",
		at: iso(T0),
		domain: "english",
		op: "tutor",
		connection: "conn-a",
		provider: "prov-a",
		model: "model-x",
		billing: "api",
		inputTokens: 1000,
		cachedTokens: 0,
		outputTokens: 100,
		reasoningTokens: 0,
		durationMs: 1000,
		...overrides,
	};
}

function beat(endMs: number, activeSec = 30, overrides: Partial<ActivityEvent> = {}): ActivityEvent {
	return { at: iso(endMs), domain: "english", kind: "lesson", activeSec, ...overrides };
}

/** n consecutive full heartbeats starting at startMs. */
function beats(startMs: number, n: number, overrides: Partial<ActivityEvent> = {}): ActivityEvent[] {
	return Array.from({ length: n }, (_, i) => beat(startMs + (i + 1) * 30_000, 30, overrides));
}

describe("provider hook (usageEventFromCall)", () => {
	it("keeps pi's disjoint buckets and fills missing counters with 0", () => {
		const event = usageEventFromCall(
			{ inputTokens: 1200, cacheReadTokens: 800, outputTokens: 300, reasoningTokens: 120, cacheWriteTokens: undefined },
			{ at: "2026-11-18T02:30:00Z", domain: "electronics", op: "grader", connection: "c", provider: "p", model: "m", billing: "subscription", durationMs: 2500, timeZone: SP },
		);
		assert.deepEqual(event, {
			day: "2026-11-17", // 23:30 in São Paulo
			at: "2026-11-18T02:30:00.000Z",
			domain: "electronics",
			op: "grader",
			connection: "c",
			provider: "p",
			model: "m",
			billing: "subscription",
			inputTokens: 1200,
			cachedTokens: 800,
			outputTokens: 300,
			reasoningTokens: 120,
			durationMs: 2500,
		});
		const sparse = usageEventFromCall({ outputTokens: 5, cacheWriteTokens: 40 }, { at: iso(T0), domain: "english", op: "tutor", connection: "c", provider: "p", model: "m", billing: "api", durationMs: -3 });
		assert.equal(sparse.inputTokens, 0);
		assert.equal(sparse.cacheWriteTokens, 40);
		assert.equal(sparse.durationMs, 0);
		assert.equal(sparse.usageIncomplete, true, "input was not reported");
		assert.deepEqual(callUsageOf(sparse), { inputTokens: undefined, outputTokens: undefined, cacheReadTokens: 0, cacheWriteTokens: 40, reasoningTokens: 0 });
	});

	it("keeps the 1h cache-write split so the server's CallPricer can still price the call", () => {
		const event = usageEventFromCall(
			{ inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 300, cacheWrite1hTokens: 100, reasoningTokens: 0 },
			{ at: iso(T0), domain: "english", op: "tutor", connection: "c", provider: "p", model: "m", billing: "api", durationMs: 1 },
		);
		assert.equal(event.cacheWrite1hTokens, 100);
		assert.equal(event.usageIncomplete, undefined);
		assert.equal(callUsageOf(event).cacheWrite1hTokens, 100);
		// A pricer with the server's rule: writes without the 1h split cannot be priced when retentions differ.
		const serverLike = usdFromCallPricer((call) => ((call.cacheWriteTokens ?? 0) > 0 && call.cacheWrite1hTokens === undefined ? null : 1));
		assert.equal(serverLike(event), 1);
		const clamped = usageEventFromCall({ inputTokens: 1, outputTokens: 1, cacheWriteTokens: 5, cacheWrite1hTokens: 9 }, { at: iso(T0), domain: "english", op: "tutor", connection: "c", provider: "p", model: "m", billing: "api", durationMs: 1 });
		assert.equal(clamped.cacheWrite1hTokens, 5, "the 1h subset never exceeds the writes");
	});
});

describe("token aggregation", () => {
	const events: UsageEvent[] = [
		usage({ day: "2026-11-17", at: iso(T0 - 86_400_000), model: "model-x", op: "tutor" }),
		usage({ day: "2026-11-18", model: "model-x", op: "tutor", inputTokens: 500, cachedTokens: 1500, outputTokens: 200, durationMs: 2000 }),
		usage({ day: "2026-11-18", model: "model-x", op: "tutor", domain: "electronics" }),
		usage({ day: "2026-11-18", connection: "plan-b", provider: "prov-b", model: "model-y", billing: "subscription", op: "grader", inputTokens: 2000, outputTokens: 50 }),
		usage({ day: "2026-11-18", connection: "local", provider: "prov-c", model: "model-z", billing: "local", op: "extractor" }),
	];

	it("groups day × domain × op × model and totals per model", () => {
		const report = aggregateUsage(events);
		assert.equal(report.rows.length, 5);
		assert.equal(report.total.calls, 5);
		assert.equal(report.total.inputTokens, 1000 + 500 + 1000 + 2000 + 1000);
		const x = report.byModel.find((m) => m.model === "model-x");
		assert.ok(x);
		assert.equal(x.calls, 3);
		assert.equal(x.inputTokens, 2500);
		assert.equal(x.cachedTokens, 1500);
		assert.equal(x.outputTokens, 400);
		assert.equal(x.durationMs, 4000);
		assert.equal(x.outputTokensPerSec, 100); // 400 tokens / 4 s
		assert.equal(x.cacheHitRate, 1500 / 4000);
		assert.deepEqual(
			report.byDay.map((d) => [d.day, d.calls]),
			[
				["2026-11-17", 1],
				["2026-11-18", 4],
			],
		);
		assert.deepEqual(
			report.byDomain.map((d) => [d.domain, d.calls]),
			[
				["electronics", 1],
				["english", 4],
			],
		);
		assert.deepEqual(
			report.byOp.map((o) => o.op),
			["extractor", "grader", "tutor"],
		);
	});

	it("US$ only for api calls, estimated credits only for subscription calls", () => {
		const pricing = pricingFromRates({
			usdRates: (e) => (e.model === "model-x" ? { input: 2, output: 10, cacheRead: 0.2 } : undefined),
			creditRates: (e) => (e.model === "model-y" ? { input: 25, output: 125 } : undefined),
		});
		const report = aggregateUsage(events, { pricing });
		const usdX = 2 * ((1000 * 2 + 100 * 10) / 1e6) + (500 * 2 + 1500 * 0.2 + 200 * 10) / 1e6;
		assert.ok(Math.abs((report.total.usd ?? NaN) - usdX) < 1e-12);
		assert.equal(report.total.unpricedCalls, 0);
		assert.equal(report.total.estimatedCredits, (2000 * 25 + 50 * 125) / 1e6);
		const z = report.byModel.find((m) => m.model === "model-z");
		assert.equal(z?.usd, null, "local billing never gets US$");
		assert.equal(z?.estimatedCredits, null, "local billing never gets credits");
		const y = report.byModel.find((m) => m.model === "model-y");
		assert.equal(y?.usd, null, "subscription billing never gets US$");
	});

	it("counts unpriced calls and never reports a partial sum as zero", () => {
		const report = aggregateUsage(events, { pricing: { usd: () => null } });
		assert.equal(report.total.usd, null);
		assert.equal(report.total.unpricedCalls, 3);
		assert.equal(report.total.uncreditedCalls, 1);
	});

	it("never prices a call whose input/output the provider did not report (no silent US$ 0)", () => {
		const incomplete = usageEventFromCall(
			{ cacheReadTokens: 50 },
			{ at: iso(T0), domain: "english", op: "tutor", connection: "conn-a", provider: "prov-a", model: "model-x", billing: "api", durationMs: 1 },
		);
		const plan = { ...incomplete, connection: "plan-b", billing: "subscription" as const };
		const rates = { input: 2, output: 10 };
		const pricing = pricingFromRates({ usdRates: () => rates, creditRates: () => rates });
		const report = aggregateUsage([incomplete, plan], { pricing });
		assert.equal(report.total.usd, null);
		assert.equal(report.total.unpricedCalls, 1);
		assert.equal(report.total.estimatedCredits, null);
		assert.equal(report.total.uncreditedCalls, 1);
		assert.equal(pricing.usd?.(incomplete), null);
		const viaPricer = aggregateUsage([incomplete], { pricing: { usd: () => 0.5 } });
		assert.equal(viaPricer.total.usd, null, "an injected pricer is not even asked");
		assert.equal(report.total.cachedTokens, 100, "tokens that were reported still count");
	});

	it("adapts the server's CallPricer with provider-qualified model ids", () => {
		const seen: string[] = [];
		const usd = usdFromCallPricer((call, model) => {
			seen.push(model);
			return (call.inputTokens ?? 0) / 1e6;
		});
		assert.equal(usd(usage()), 0.001);
		assert.deepEqual(seen, ["prov-a:model-x"]);
	});

	it("filters by range, domain and op", () => {
		const report = aggregateUsage(events, { filter: { range: { from: iso(T0), to: iso(T0 + 1) }, domain: "english", ops: ["tutor"] } });
		assert.equal(report.total.calls, 1);
	});

	it("prices cache writes and reads at their own rates", () => {
		assert.equal(costFromRates({ input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 }, { inputTokens: 1e6, cachedTokens: 1e6, cacheWriteTokens: 1e6, outputTokens: 1e6 }), 1 + 0.1 + 1.25 + 2);
	});
});

describe("hours from heartbeats (window 30 s, idle 120 s)", () => {
	it("the renderer credits 120 s after each interaction, window by window", () => {
		const windows = [0, 1, 2, 3, 4, 5].map((i) => activeSecondsInWindow({ windowStartMs: T0 + i * 30_000, windowEndMs: T0 + (i + 1) * 30_000, interactionsMs: [T0] }));
		assert.deepEqual(windows, [30, 30, 30, 30, 0, 0]);
		const partial = activeSecondsInWindow({ windowStartMs: T0 + 90_000, windowEndMs: T0 + 120_000, interactionsMs: [T0 - 20_000] });
		assert.equal(partial, 10);
		const video = activeSecondsInWindow({ windowStartMs: T0 + 300_000, windowEndMs: T0 + 330_000, interactionsMs: [T0], busySpansMs: [[T0 + 310_000, T0 + 400_000]] });
		assert.equal(video, 20, "a playing video keeps the learner active");
		const event = heartbeatEvent({ windowStartMs: T0, windowEndMs: T0 + 30_000, interactionsMs: [T0 + 5_000], domain: "english", kind: "media" });
		assert.deepEqual(event, { at: iso(T0 + 30_000), domain: "english", kind: "media", activeSec: 25 });
	});

	it("sums consecutive heartbeats into hours per day", () => {
		const daily = aggregateActivity(beats(T0, 120)); // 120 × 30 s = 1 h
		assert.equal(daily.length, 1);
		assert.equal(daily[0]?.day, "2026-11-18");
		assert.equal(daily[0]?.activeSec, 3600);
		assert.equal(daily[0]?.sessions, 1);
		assert.equal(daily[0]?.byDomain.english, 3600);
		assert.equal(daily[0]?.byKind.lesson, 3600);
	});

	it("never double-counts duplicate or overlapping heartbeats, and caps one heartbeat at its window", () => {
		const once = beats(T0, 10);
		const daily = aggregateActivity([...once, ...once, beat(T0 + 150_000, 30)]);
		assert.equal(daily[0]?.activeSec, 300);
		const capped = aggregateActivity([beat(T0, 999)]);
		assert.equal(capped[0]?.activeSec, 30);
		const partial = aggregateActivity([beat(T0, 12)]);
		assert.equal(partial[0]?.activeSec, 12);
	});

	it("splits a heartbeat that crosses local midnight", () => {
		const midnightSp = Date.parse("2026-11-19T03:00:00.000Z"); // 00:00 in São Paulo
		const daily = aggregateActivity([beat(midnightSp + 15_000, 30)], { timeZone: SP });
		assert.deepEqual(
			daily.map((d) => [d.day, d.activeSec]),
			[
				["2026-11-18", 15],
				["2026-11-19", 15],
			],
		);
		assert.equal(dayKey(midnightSp - 1, SP), "2026-11-18");
	});

	it("separates sessions by gaps longer than the idle timeout", () => {
		const first = beats(T0, 4); // ends at T0 + 120 s
		const close = beats(T0 + 120_000 + 120_000, 2); // gap of 120 s → same session
		const far = beats(T0 + 600_000, 2); // gap of > 120 s → new session
		const daily = aggregateActivity([...first, ...close, ...far]);
		assert.equal(daily[0]?.sessions, 2);
		assert.equal(daily[0]?.activeSec, 8 * 30);
	});

	it("keeps per-domain and per-kind unions separate", () => {
		const daily = aggregateActivity([...beats(T0, 4), ...beats(T0, 2, { domain: "electronics", kind: "reading" })]);
		assert.equal(daily[0]?.activeSec, 120, "parallel windows are one wall-clock span");
		assert.equal(daily[0]?.byDomain.english, 120);
		assert.equal(daily[0]?.byDomain.electronics, 60);
		assert.equal(daily[0]?.byKind.reading, 60);
		const onlyEe = aggregateActivity([...beats(T0, 4), ...beats(T0, 2, { domain: "electronics" })], { domain: "electronics" });
		assert.equal(onlyEe[0]?.activeSec, 60);
	});

	it("property: bounded by Σ min(activeSec, 30), invariant to order and duplication", () => {
		const eventArb = fc.record({
			offsetSec: fc.integer({ min: 0, max: 3 * 86_400 }),
			activeSec: fc.integer({ min: 0, max: 60 }),
			domain: fc.constantFrom("english", "electronics"),
			kind: fc.constantFrom("lesson", "practice", "review", "media", "reading" as const),
		});
		fc.assert(
			fc.property(fc.array(eventArb, { maxLength: 60 }), fc.constantFrom(undefined, SP), (raw, timeZone) => {
				const events: ActivityEvent[] = raw.map((r) => ({ at: iso(T0 + r.offsetSec * 1000), domain: r.domain, kind: r.kind, activeSec: r.activeSec }));
				const daily = aggregateActivity(events, { timeZone });
				const total = daily.reduce((s, d) => s + d.activeSec, 0);
				const bound = events.reduce((s, e) => s + Math.min(e.activeSec, 30), 0);
				assert.ok(total <= bound + daily.length, `${total} > ${bound}`); // +1 s rounding per day
				for (const d of daily) {
					assert.ok(d.activeSec <= 86_400);
					const domainSum = Object.values(d.byDomain).reduce((s, v) => s + v, 0);
					assert.ok(d.activeSec <= domainSum + 1);
					for (const v of Object.values(d.byDomain)) assert.ok(v <= d.activeSec + 1);
				}
				const shuffled = [...events].reverse();
				assert.deepEqual(aggregateActivity([...shuffled, ...events], { timeZone }), daily);
			}),
			{ numRuns: 150 },
		);
	});
});

describe("heatmap", () => {
	it("lays out N full weeks ending with the week of endDay", () => {
		const daily = [
			{ day: "2026-11-08", activeSec: 60 },
			{ day: "2026-11-10", activeSec: 1800 },
			{ day: "2026-11-17", activeSec: 10_800 },
			{ day: "2026-11-20", activeSec: 999 }, // after endDay: ignored
		];
		const map = activityHeatmap(daily, { endDay: "2026-11-18", weeks: 2 });
		assert.equal(map.startDay, "2026-11-08"); // Sunday
		assert.equal(map.weeks.length, 2);
		assert.ok(map.weeks.every((w) => w.length === 7));
		assert.deepEqual(
			map.weeks.flat().filter((c) => !c.inRange).map((c) => c.day),
			["2026-11-19", "2026-11-20", "2026-11-21"],
		);
		assert.equal(map.totalSec, 60 + 1800 + 10_800);
		assert.equal(map.activeDays, 3);
		assert.equal(map.maxSec, 10_800);
		assert.deepEqual(
			[0, 30, 60, 1800, 5400, 10_800].map((s) => heatLevel(s)),
			[0, 0, 1, 2, 3, 4],
		);
		const monday = activityHeatmap(daily, { endDay: "2026-11-18", weeks: 1, weekStartsOn: 1 });
		assert.equal(monday.startDay, "2026-11-16");
		assert.throws(() => activityHeatmap(daily, { endDay: "2026-11-18", weeks: 0 }), RangeError);
	});

	it("denseDailySeries fills gaps and refuses malformed days instead of looping forever", () => {
		assert.deepEqual(denseDailySeries([{ day: "2026-11-17", activeSec: 60 }], "2026-11-16", "2026-11-18"), [
			{ day: "2026-11-16", activeSec: 0 },
			{ day: "2026-11-17", activeSec: 60 },
			{ day: "2026-11-18", activeSec: 0 },
		]);
		assert.deepEqual(denseDailySeries([], "2026-11-18", "2026-11-16"), []);
		assert.throws(() => denseDailySeries([], "2026-11-16", "today"), StatsDateError);
		assert.throws(() => denseDailySeries([], "2026-11-16", "2026-11-31"), StatsDateError);
	});
});

describe("stats store (temp dir JSONL)", () => {
	it("appends to monthly files by UTC month and reads a half-open range", () => {
		const root = tmpRoot();
		const store = createStatsStore(root);
		const oct = usage({ day: "2026-10-31", at: "2026-10-31T23:59:59.000Z" });
		const nov1 = usage({ day: "2026-11-01", at: "2026-11-01T00:00:00.000Z", domain: "electronics" });
		const nov18 = usage({ at: iso(T0) });
		assert.equal(store.appendUsage([nov18, oct]), 2);
		assert.equal(store.appendUsage(nov1), 1);
		assert.deepEqual(store.listMonths("usage"), ["2026-10", "2026-11"]);
		assert.deepEqual(store.listMonths("activity"), []);
		const novFile = fs.readFileSync(usageLogFile(root, "2026-11"), "utf-8");
		assert.equal(novFile.split("\n").filter(Boolean).length, 2);
		assert.ok(novFile.endsWith("\n"));

		const all = store.readUsage({ from: "2026-10-01T00:00:00Z", to: "2026-12-01T00:00:00Z" });
		assert.deepEqual(
			all.events.map((e) => e.at),
			[oct.at, nov1.at, nov18.at],
		);
		assert.equal(all.skippedLines, 0);
		const halfOpen = store.readUsage({ from: "2026-10-31T00:00:00Z", to: "2026-11-01T00:00:00Z" });
		assert.deepEqual(
			halfOpen.events.map((e) => e.at),
			[oct.at],
		);
		const ee = store.readUsage({ from: "2026-10-01T00:00:00Z", to: "2026-12-01T00:00:00Z" }, { domain: "electronics" });
		assert.deepEqual(
			ee.events.map((e) => e.domain),
			["electronics"],
		);
		assert.deepEqual(monthsInRange("2026-10-31T00:00:00Z", "2026-11-01T00:00:00Z"), ["2026-10"]);
		assert.deepEqual(
			fs.readdirSync(path.dirname(usageLogFile(root, "2026-11"))).sort(),
			["usage-2026-10.jsonl", "usage-2026-11.jsonl"],
			"atomic writes leave no temp files beside the month files",
		);
	});

	it("skips corrupt lines, tolerates a missing final newline, and reads what it wrote", () => {
		const root = tmpRoot();
		const store = createStatsStore(root);
		store.appendActivity(beats(T0, 3));
		const file = activityLogFile(root, "2026-11");
		fs.appendFileSync(file, '{"not":"an event"}\nnot json at all\n{"at":"2026-11-18T13:05:00.000Z","domain":"english","kind":"lesson","activeSec":30}');
		store.appendActivity(beat(T0 + 400_000));
		const read = store.readActivity({ from: iso(T0), to: iso(T0 + 3_600_000) });
		assert.equal(read.skippedLines, 2);
		assert.equal(read.events.length, 5);
		const daily = aggregateActivity(read.events);
		assert.equal(daily[0]?.activeSec, 5 * 30);
	});

	it("persists the cache-write split and the incomplete-usage flag through JSONL", () => {
		const root = tmpRoot();
		const store = createStatsStore(root);
		const ctx = { at: iso(T0), domain: "english", op: "tutor", connection: "c", provider: "p", model: "m", billing: "api" as const, durationMs: 1 };
		store.appendUsage([
			usageEventFromCall({ inputTokens: 1, outputTokens: 1, cacheWriteTokens: 30, cacheWrite1hTokens: 10 }, ctx),
			usageEventFromCall({ outputTokens: 7 }, { ...ctx, at: iso(T0 + 1) }),
		]);
		const [complete, incomplete] = store.readUsage({ from: iso(T0), to: iso(T0 + 2) }).events;
		assert.equal(complete?.cacheWrite1hTokens, 10);
		assert.equal(complete?.usageIncomplete, undefined);
		assert.equal(incomplete?.usageIncomplete, true);
		assert.equal(aggregateUsage([incomplete as UsageEvent], { pricing: { usd: () => 1 } }).total.unpricedCalls, 1);
	});

	it("rejects an invalid batch whole: nothing is written", () => {
		const root = tmpRoot();
		const store = createStatsStore(root);
		store.appendUsage(usage());
		const before = fs.readFileSync(usageLogFile(root, "2026-11"), "utf-8");
		assert.throws(() => store.appendUsage([usage({ at: iso(T0 + 1) }), { ...usage(), inputTokens: -1 }]), StatsEventError);
		assert.throws(() => store.appendActivity({ at: "yesterday", domain: "english", kind: "lesson", activeSec: 30 }), StatsEventError);
		assert.equal(fs.readFileSync(usageLogFile(root, "2026-11"), "utf-8"), before);
		assert.equal(fs.existsSync(activityLogFile(root, "2026-11")), false);
	});

	it("round-trips the whole pipeline: hook → store → aggregate", () => {
		const root = tmpRoot();
		const store = createStatsStore(root);
		for (let i = 0; i < 20; i++) {
			store.appendUsage(
				usageEventFromCall(
					{ inputTokens: 100, outputTokens: 10, cacheReadTokens: 50, reasoningTokens: 2 },
					{ at: iso(T0 + i * 60_000), domain: i % 2 ? "english" : "electronics", op: "tutor", connection: "c", provider: "p", model: i < 5 ? "m-small" : "m-large", billing: "api", durationMs: 500 },
				),
			);
		}
		const report = aggregateUsage(store.readUsage({ from: iso(T0), to: iso(T0 + 86_400_000) }).events);
		assert.equal(report.total.calls, 20);
		assert.deepEqual(
			report.byModel.map((m) => [m.model, m.calls]),
			[
				["m-large", 15],
				["m-small", 5],
			],
		);
		assert.equal(report.byDomain.find((d) => d.domain === "english")?.calls, 10);
	});
});
