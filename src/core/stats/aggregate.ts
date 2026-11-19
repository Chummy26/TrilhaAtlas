/**
 * Stats aggregation (docs/research/00-SINTESE.md §2.10 "Stats: tokens e
 * horas"; r5 §5.5; lh-agent-providers.md §5.4–5.5).
 *
 * Tokens — aggregateUsage(events):
 *  - rows by day × domain × op × model (model = connection + provider + id +
 *    billing), plus rollups by model, day, domain and op, and a grand total;
 *  - US$ ONLY for billing "api", through an injected pricer (prices are never
 *    copied here): usdFromCallPricer adapts the server's existing CallPricer
 *    (src/core/prices.ts), pricingFromRates adapts per-1M rate lookups such
 *    as merged ModelMetadata.cost;
 *  - "créditos estimados" ONLY for billing "subscription", through an injected
 *    credit function (rates come from data/config, never from code);
 *  - `usd`/`estimatedCredits` are null when no call of the group could be
 *    priced; `unpricedCalls`/`uncreditedCalls` say when a sum is partial; an
 *    event flagged `usageIncomplete` is always unpriced/uncredited (its
 *    zeros are placeholders, not counts);
 *  - cacheHitRate = cached / (fresh input + cached + cache writes) — the
 *    buckets are disjoint (pi convention), null without prompt tokens;
 *  - outputTokensPerSec per model = Σ output / Σ duration (effective
 *    throughput, feeds the "fastest" role preference).
 *
 * Hours — aggregateActivity(heartbeats):
 *  - each heartbeat covers [at − min(activeSec, window), at] (window = 30 s):
 *    a heartbeat never credits more than its window;
 *  - spans are UNIONED before summing, so duplicate or overlapping heartbeats
 *    (two windows, retries) never double-count a wall-clock second; per-domain
 *    and per-kind totals are unions within that domain/kind;
 *  - union spans are split exactly at local midnight (binary search on the
 *    zone's day function), so a session crossing midnight is shared correctly;
 *  - a "session" is a cluster of active spans whose gaps are ≤ idle (120 s),
 *    counted on the day it starts.
 *
 * Heatmap — activityHeatmap(daily, {endDay, weeks}): N full weeks ending with
 * the week of endDay; level = how many of the minute thresholds
 * (default 1/30/90/180 min; 180 = default daily budget) the day reached.
 *
 * Pure and deterministic: no clock reads, sorted outputs.
 */

import type { CallUsage } from "../contracts.ts";
import type { CallPricer } from "../prices.ts";
import { addDays, dayKeyIn, daysBetween, toEpochMs, weekdayOf } from "./dates.ts";
import { mergeSpans } from "./events.ts";
import {
	HEARTBEAT_WINDOW_SEC,
	IDLE_TIMEOUT_SEC,
	type ActivityEvent,
	type ActivityKind,
	type BillingKind,
	type TimeRange,
	type UsageEvent,
} from "./types.ts";

// ═══ tokens ═════════════════════════════════════════════════════════════════

export interface TokenTotals {
	calls: number;
	inputTokens: number;
	cachedTokens: number;
	cacheWriteTokens: number;
	outputTokens: number;
	reasoningTokens: number;
	durationMs: number;
}

export interface CostTotals {
	/** Σ USD of priced api calls; null when none could be priced. */
	usd: number | null;
	/** api calls without a known price. */
	unpricedCalls: number;
	/** Σ estimated plan credits of subscription calls; null when none could be estimated. */
	estimatedCredits: number | null;
	/** subscription calls without a credit estimate. */
	uncreditedCalls: number;
	cacheHitRate: number | null;
}

export type UsageTotals = TokenTotals & CostTotals;

export interface ModelIdentity {
	connection: string;
	provider: string;
	model: string;
	billing: BillingKind;
}

export interface UsageRow extends ModelIdentity, TokenTotals {
	day: string;
	domain: string;
	op: string;
}

export interface ModelUsage extends ModelIdentity, UsageTotals {
	outputTokensPerSec: number | null;
}

export interface UsageReport {
	rows: UsageRow[];
	byModel: ModelUsage[];
	byDay: (UsageTotals & { day: string })[];
	byDomain: (UsageTotals & { domain: string })[];
	byOp: (UsageTotals & { op: string })[];
	total: UsageTotals;
}

export interface UsagePricing {
	/** USD of one api-billed call, or null when its price is unknown. */
	usd?: (event: UsageEvent) => number | null;
	/** Estimated plan credits of one subscription call, or null when unknown. */
	credits?: (event: UsageEvent) => number | null;
}

export interface UsageFilter {
	range?: TimeRange;
	domain?: string;
	ops?: readonly string[];
}

/** Rates per 1M tokens (USD or credits). */
export interface TokenRates {
	input: number;
	output: number;
	/** Cache-read rate; the input rate when unknown (conservative). */
	cacheRead?: number;
	/** Cache-write rate; the input rate when unknown (conservative). */
	cacheWrite?: number;
}

/** Cost of one event at per-1M-token rates (reasoning is inside output). */
export function costFromRates(rates: TokenRates, event: Pick<UsageEvent, "inputTokens" | "cachedTokens" | "outputTokens" | "cacheWriteTokens">): number {
	const cacheRead = rates.cacheRead ?? rates.input;
	const cacheWrite = rates.cacheWrite ?? rates.input;
	return (
		(event.inputTokens * rates.input +
			event.cachedTokens * cacheRead +
			(event.cacheWriteTokens ?? 0) * cacheWrite +
			event.outputTokens * rates.output) /
		1_000_000
	);
}

/**
 * The pi CallUsage of one event (for the server's existing CallPricer).
 * An incomplete event gives back undefined input/output (never the stored
 * zeros), so the pricer reports it as unpriced; the 1h cache-write split is
 * passed through when known.
 */
export function callUsageOf(event: UsageEvent): CallUsage {
	const call: CallUsage = {
		inputTokens: event.usageIncomplete ? undefined : event.inputTokens,
		outputTokens: event.usageIncomplete ? undefined : event.outputTokens,
		cacheReadTokens: event.cachedTokens,
		cacheWriteTokens: event.cacheWriteTokens,
		reasoningTokens: event.reasoningTokens,
	};
	if (event.cacheWrite1hTokens !== undefined) call.cacheWrite1hTokens = event.cacheWrite1hTokens;
	return call;
}

/** Price one event with an injected pricer; incomplete usage is never priced from its zeros. */
function priceOf(event: UsageEvent, pricer: ((event: UsageEvent) => number | null) | undefined): number | null | undefined {
	if (!pricer) return undefined;
	return event.usageIncomplete ? null : pricer(event);
}

/**
 * UsagePricing from per-1M rate lookups. A lookup returns undefined when the
 * model has no known rate; the call then counts as unpriced/uncredited.
 * USD rates usually come from merged ModelMetadata.cost (api billing); credit
 * rates from the plan's credit table in data/config (subscription billing).
 */
export function pricingFromRates(lookups: {
	usdRates?: (event: UsageEvent) => TokenRates | undefined;
	creditRates?: (event: UsageEvent) => TokenRates | undefined;
}): UsagePricing {
	const { usdRates, creditRates } = lookups;
	const pricing: UsagePricing = {};
	if (usdRates) pricing.usd = (event) => priceWith(usdRates(event), event);
	if (creditRates) pricing.credits = (event) => priceWith(creditRates(event), event);
	return pricing;
}

function priceWith(rates: TokenRates | undefined, event: UsageEvent): number | null {
	return rates && !event.usageIncomplete ? costFromRates(rates, event) : null;
}

/**
 * UsagePricing.usd backed by the server's CallPricer (src/core/prices.ts),
 * which prices "provider:model" from pi's catalog (§2.10 "reaproveitando
 * src/core/prices.ts").
 */
export function usdFromCallPricer(price: CallPricer): (event: UsageEvent) => number | null {
	return (event) => price(callUsageOf(event), `${event.provider}:${event.model}`);
}

/** Share of prompt tokens served from cache; null without prompt tokens. */
export function cacheHitRate(totals: Pick<TokenTotals, "inputTokens" | "cachedTokens" | "cacheWriteTokens">): number | null {
	const prompt = totals.inputTokens + totals.cachedTokens + totals.cacheWriteTokens;
	return prompt > 0 ? totals.cachedTokens / prompt : null;
}

function inRange(atMs: number, range: TimeRange | undefined): boolean {
	if (!range) return true;
	return atMs >= toEpochMs(range.from) && atMs < toEpochMs(range.to);
}

/** Events kept by a filter (range is half-open on `at`). */
export function filterUsage(events: readonly UsageEvent[], filter: UsageFilter = {}): UsageEvent[] {
	const ops = filter.ops ? new Set(filter.ops) : undefined;
	return events.filter((event) => {
		const atMs = Date.parse(event.at);
		if (!Number.isFinite(atMs) || !inRange(atMs, filter.range)) return false;
		if (filter.domain !== undefined && event.domain !== filter.domain) return false;
		return !ops || ops.has(event.op);
	});
}

class UsageAccumulator {
	readonly tokens: TokenTotals = { calls: 0, inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0, durationMs: 0 };
	private usdSum = 0;
	private priced = 0;
	private unpriced = 0;
	private creditSum = 0;
	private credited = 0;
	private uncredited = 0;
	private timedOutput = 0;
	private timedMs = 0;

	add(event: UsageEvent, cost: { usd: number | null | undefined; credits: number | null | undefined }): void {
		const t = this.tokens;
		t.calls += 1;
		t.inputTokens += event.inputTokens;
		t.cachedTokens += event.cachedTokens;
		t.cacheWriteTokens += event.cacheWriteTokens ?? 0;
		t.outputTokens += event.outputTokens;
		t.reasoningTokens += event.reasoningTokens;
		t.durationMs += event.durationMs;
		if (event.durationMs > 0 && event.outputTokens > 0) {
			this.timedOutput += event.outputTokens;
			this.timedMs += event.durationMs;
		}
		if (event.billing === "api") {
			if (isAmount(cost.usd)) {
				this.usdSum += cost.usd;
				this.priced += 1;
			} else this.unpriced += 1;
		} else if (event.billing === "subscription") {
			if (isAmount(cost.credits)) {
				this.creditSum += cost.credits;
				this.credited += 1;
			} else this.uncredited += 1;
		}
	}

	totals(): UsageTotals {
		return {
			...this.tokens,
			usd: this.priced > 0 ? this.usdSum : null,
			unpricedCalls: this.unpriced,
			estimatedCredits: this.credited > 0 ? this.creditSum : null,
			uncreditedCalls: this.uncredited,
			cacheHitRate: cacheHitRate(this.tokens),
		};
	}

	outputTokensPerSec(): number | null {
		return this.timedMs > 0 ? this.timedOutput / (this.timedMs / 1000) : null;
	}
}

function isAmount(value: number | null | undefined): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function bucket<K>(map: Map<string, { key: K; acc: UsageAccumulator }>, id: string, key: K): UsageAccumulator {
	let entry = map.get(id);
	if (!entry) {
		entry = { key, acc: new UsageAccumulator() };
		map.set(id, entry);
	}
	return entry.acc;
}

const SEP = "\u0000";

function compareStrings(a: string, b: string): number {
	return a === b ? 0 : a < b ? -1 : 1;
}

function compareTuple(a: readonly string[], b: readonly string[]): number {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const result = compareStrings(a[i] ?? "", b[i] ?? "");
		if (result !== 0) return result;
	}
	return 0;
}

function identityTuple(m: ModelIdentity): string[] {
	return [m.connection, m.provider, m.model, m.billing];
}

/** Aggregate the usage stream (see header for the cost rules). */
export function aggregateUsage(events: readonly UsageEvent[], options: { filter?: UsageFilter; pricing?: UsagePricing } = {}): UsageReport {
	const rows = new Map<string, { key: Omit<UsageRow, keyof TokenTotals>; acc: UsageAccumulator }>();
	const models = new Map<string, { key: ModelIdentity; acc: UsageAccumulator }>();
	const days = new Map<string, { key: string; acc: UsageAccumulator }>();
	const domains = new Map<string, { key: string; acc: UsageAccumulator }>();
	const ops = new Map<string, { key: string; acc: UsageAccumulator }>();
	const total = new UsageAccumulator();
	for (const event of filterUsage(events, options.filter)) {
		const identity: ModelIdentity = { connection: event.connection, provider: event.provider, model: event.model, billing: event.billing };
		const modelId = identityTuple(identity).join(SEP);
		const cost = {
			usd: event.billing === "api" ? priceOf(event, options.pricing?.usd) : undefined,
			credits: event.billing === "subscription" ? priceOf(event, options.pricing?.credits) : undefined,
		};
		bucket(rows, [event.day, event.domain, event.op, modelId].join(SEP), { day: event.day, domain: event.domain, op: event.op, ...identity }).add(event, cost);
		bucket(models, modelId, identity).add(event, cost);
		bucket(days, event.day, event.day).add(event, cost);
		bucket(domains, event.domain, event.domain).add(event, cost);
		bucket(ops, event.op, event.op).add(event, cost);
		total.add(event, cost);
	}
	const promptAndOutput = (t: TokenTotals) => t.inputTokens + t.cachedTokens + t.cacheWriteTokens + t.outputTokens;
	return {
		rows: [...rows.values()]
			.map(({ key, acc }) => ({ ...key, ...acc.tokens }))
			.sort((a, b) => compareTuple([a.day, a.domain, a.op, ...identityTuple(a)], [b.day, b.domain, b.op, ...identityTuple(b)])),
		byModel: [...models.values()]
			.map(({ key, acc }) => ({ ...key, ...acc.totals(), outputTokensPerSec: acc.outputTokensPerSec() }))
			.sort((a, b) => promptAndOutput(b) - promptAndOutput(a) || compareTuple(identityTuple(a), identityTuple(b))),
		byDay: [...days.values()].map(({ key, acc }) => ({ day: key, ...acc.totals() })).sort((a, b) => compareStrings(a.day, b.day)),
		byDomain: [...domains.values()].map(({ key, acc }) => ({ domain: key, ...acc.totals() })).sort((a, b) => compareStrings(a.domain, b.domain)),
		byOp: [...ops.values()].map(({ key, acc }) => ({ op: key, ...acc.totals() })).sort((a, b) => compareStrings(a.op, b.op)),
		total: total.totals(),
	};
}

// ═══ hours ══════════════════════════════════════════════════════════════════

export interface ActivitySpan {
	startMs: number;
	endMs: number;
	domain: string;
	kind: ActivityKind;
}

export interface ActivityOptions {
	/** IANA zone for local days; UTC when omitted. */
	timeZone?: string;
	/** Max seconds one heartbeat may credit (default 30). */
	windowSec?: number;
	/** Gap that ends a study session (default 120). */
	idleSec?: number;
	range?: TimeRange;
	domain?: string;
}

export interface DailyActivity {
	day: string;
	/** Wall-clock active seconds (union over every domain and kind). */
	activeSec: number;
	byDomain: Record<string, number>;
	byKind: Partial<Record<ActivityKind, number>>;
	/** Study sessions (clusters separated by more than the idle gap) that started this day. */
	sessions: number;
}

/** The span each heartbeat covers, clipped to the range; zero-length ones dropped. */
export function heartbeatSpans(events: readonly ActivityEvent[], options: Pick<ActivityOptions, "windowSec" | "range" | "domain"> = {}): ActivitySpan[] {
	const windowMs = (options.windowSec ?? HEARTBEAT_WINDOW_SEC) * 1000;
	const from = options.range ? toEpochMs(options.range.from) : Number.NEGATIVE_INFINITY;
	const to = options.range ? toEpochMs(options.range.to) : Number.POSITIVE_INFINITY;
	const spans: ActivitySpan[] = [];
	for (const event of events) {
		if (options.domain !== undefined && event.domain !== options.domain) continue;
		const endMs = Date.parse(event.at);
		if (!Number.isFinite(endMs) || !Number.isFinite(event.activeSec) || event.activeSec <= 0) continue;
		const startMs = endMs - Math.min(event.activeSec * 1000, windowMs);
		const clippedStart = Math.max(startMs, from);
		const clippedEnd = Math.min(endMs, to);
		if (clippedEnd > clippedStart) spans.push({ startMs: clippedStart, endMs: clippedEnd, domain: event.domain, kind: event.kind });
	}
	return spans;
}

/** Split [startMs, endMs) at day boundaries of `dayOf` (assumed monotone in time). */
export function splitSpanByDay(startMs: number, endMs: number, dayOf: (ms: number) => string): { day: string; ms: number }[] {
	const pieces: { day: string; ms: number }[] = [];
	let start = startMs;
	while (start < endMs) {
		const day = dayOf(start);
		if (dayOf(endMs - 1) === day) {
			pieces.push({ day, ms: endMs - start });
			break;
		}
		let lo = start; // dayOf(lo) === day
		let hi = endMs - 1; // dayOf(hi) !== day
		while (hi - lo > 1) {
			const mid = lo + Math.floor((hi - lo) / 2);
			if (dayOf(mid) === day) lo = mid;
			else hi = mid;
		}
		pieces.push({ day, ms: hi - start });
		start = hi;
	}
	return pieces;
}

function addUnionByDay(target: Map<string, number>, spans: readonly (readonly [number, number])[], dayOf: (ms: number) => string): void {
	for (const [start, end] of mergeSpans(spans)) {
		for (const piece of splitSpanByDay(start, end, dayOf)) target.set(piece.day, (target.get(piece.day) ?? 0) + piece.ms);
	}
}

function groupSpans<K extends string>(spans: readonly ActivitySpan[], keyOf: (span: ActivitySpan) => K): Map<K, [number, number][]> {
	const groups = new Map<K, [number, number][]>();
	for (const span of spans) {
		const key = keyOf(span);
		const list = groups.get(key) ?? [];
		list.push([span.startMs, span.endMs]);
		groups.set(key, list);
	}
	return groups;
}

const toSeconds = (ms: number): number => Math.round(ms / 1000);

/** Active seconds per local day, from heartbeats (see header for the rules). */
export function aggregateActivity(events: readonly ActivityEvent[], options: ActivityOptions = {}): DailyActivity[] {
	const dayOf = dayKeyIn(options.timeZone);
	const idleMs = (options.idleSec ?? IDLE_TIMEOUT_SEC) * 1000;
	const spans = heartbeatSpans(events, options);
	const daily = new Map<string, DailyActivity>();
	const dayEntry = (day: string): DailyActivity => {
		let entry = daily.get(day);
		if (!entry) {
			entry = { day, activeSec: 0, byDomain: {}, byKind: {}, sessions: 0 };
			daily.set(day, entry);
		}
		return entry;
	};

	const all = spans.map((span): [number, number] => [span.startMs, span.endMs]);
	const totalMs = new Map<string, number>();
	addUnionByDay(totalMs, all, dayOf);
	for (const [day, ms] of totalMs) dayEntry(day).activeSec = toSeconds(ms);

	for (const [domain, list] of groupSpans(spans, (span) => span.domain)) {
		const perDay = new Map<string, number>();
		addUnionByDay(perDay, list, dayOf);
		for (const [day, ms] of perDay) dayEntry(day).byDomain[domain] = toSeconds(ms);
	}
	for (const [kind, list] of groupSpans(spans, (span) => span.kind)) {
		const perDay = new Map<string, number>();
		addUnionByDay(perDay, list, dayOf);
		for (const [day, ms] of perDay) dayEntry(day).byKind[kind] = toSeconds(ms);
	}

	let sessionEnd = Number.NEGATIVE_INFINITY;
	for (const [start, end] of mergeSpans(all)) {
		if (start - sessionEnd > idleMs) dayEntry(dayOf(start)).sessions += 1;
		sessionEnd = Math.max(sessionEnd, end);
	}

	return [...daily.values()].sort((a, b) => compareStrings(a.day, b.day));
}

export function secondsToHours(seconds: number): number {
	return seconds / 3600;
}

/** Σ active seconds of a daily series. */
export function totalActiveSec(daily: readonly Pick<DailyActivity, "activeSec">[]): number {
	return daily.reduce((sum, day) => sum + day.activeSec, 0);
}

/**
 * A dense [startDay..endDay] series with zeros for days without activity.
 * Both ends must be real "YYYY-MM-DD" days (a malformed end such as "today"
 * would compare greater than every day and never end the loop).
 */
export function denseDailySeries(daily: readonly Pick<DailyActivity, "day" | "activeSec">[], startDay: string, endDay: string): { day: string; activeSec: number }[] {
	const length = daysBetween(startDay, endDay) + 1; // validates both days
	const byDay = new Map(daily.map((d) => [d.day, d.activeSec]));
	const series: { day: string; activeSec: number }[] = [];
	for (let i = 0; i < length; i++) {
		const day = addDays(startDay, i);
		series.push({ day, activeSec: byDay.get(day) ?? 0 });
	}
	return series;
}

// ═══ heatmap ════════════════════════════════════════════════════════════════

export type HeatLevel = 0 | 1 | 2 | 3 | 4;

/** Minutes a day must reach for levels 1..4 (180 = default daily budget). */
export const DEFAULT_HEATMAP_THRESHOLDS_MIN = Object.freeze([1, 30, 90, 180] as const);

export interface HeatmapCell {
	day: string;
	activeSec: number;
	level: HeatLevel;
	/** False for days after endDay (the rest of the current week). */
	inRange: boolean;
}

export interface Heatmap {
	/** Oldest week first; each week has 7 cells starting on `weekStartsOn`. */
	weeks: HeatmapCell[][];
	startDay: string;
	endDay: string;
	totalSec: number;
	maxSec: number;
	activeDays: number;
}

export interface HeatmapOptions {
	endDay: string;
	weeks: number;
	/** 0 = Sunday (default), 1 = Monday. */
	weekStartsOn?: 0 | 1;
	levelThresholdsMin?: readonly [number, number, number, number];
}

export function heatLevel(activeSec: number, thresholdsMin: readonly number[] = DEFAULT_HEATMAP_THRESHOLDS_MIN): HeatLevel {
	const minutes = activeSec / 60;
	let level = 0;
	for (const threshold of thresholdsMin) if (activeSec > 0 && minutes >= threshold) level += 1;
	return Math.min(level, 4) as HeatLevel;
}

/** N full weeks ending with the week that contains endDay. */
export function activityHeatmap(daily: readonly Pick<DailyActivity, "day" | "activeSec">[], options: HeatmapOptions): Heatmap {
	if (!Number.isInteger(options.weeks) || options.weeks < 1 || options.weeks > 520) {
		throw new RangeError(`Número de semanas inválido: ${options.weeks} (use um inteiro entre 1 e 520).`);
	}
	const weekStartsOn = options.weekStartsOn ?? 0;
	const thresholds = options.levelThresholdsMin ?? DEFAULT_HEATMAP_THRESHOLDS_MIN;
	const byDay = new Map(daily.map((d) => [d.day, d.activeSec]));
	const offset = (weekdayOf(options.endDay) - weekStartsOn + 7) % 7;
	const startDay = addDays(options.endDay, -offset - 7 * (options.weeks - 1));
	const weeks: HeatmapCell[][] = [];
	let totalSec = 0;
	let maxSec = 0;
	let activeDays = 0;
	for (let w = 0; w < options.weeks; w++) {
		const week: HeatmapCell[] = [];
		for (let d = 0; d < 7; d++) {
			const day = addDays(startDay, w * 7 + d);
			const inRangeDay = day <= options.endDay;
			const activeSec = inRangeDay ? byDay.get(day) ?? 0 : 0;
			if (activeSec > 0) {
				totalSec += activeSec;
				maxSec = Math.max(maxSec, activeSec);
				activeDays += 1;
			}
			week.push({ day, activeSec, level: heatLevel(activeSec, thresholds), inRange: inRangeDay });
		}
		weeks.push(week);
	}
	return { weeks, startDay, endDay: options.endDay, totalSec, maxSec, activeDays };
}
