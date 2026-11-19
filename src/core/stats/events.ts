/**
 * Event builders for the two stats streams (docs/research/00-SINTESE.md §2.10;
 * lh-agent-providers.md §5.1/§5.5).
 *
 *  - usageEventFromCall: the single provider-layer hook turns each pi
 *    CallUsage step (one LLM request) into one UsageEvent. Missing counters
 *    become 0 (the stream stores counts, not "unknown"); cache writes stay
 *    optional, as in CallUsage.
 *  - activeSecondsInWindow: what the renderer reports in each 30 s heartbeat.
 *    The learner is active for IDLE_TIMEOUT_SEC (120 s) after every
 *    interaction (key, pointer, scroll) and during "busy" spans such as a
 *    playing video; the heartbeat counts the part of its window covered by
 *    that union. Callers send one every HEARTBEAT_WINDOW_SEC (30 s), only
 *    while the window is focused.
 *
 * Pure: every instant is a parameter.
 */

import type { CallUsage } from "../contracts.ts";
import { dayKey, toEpochMs } from "./dates.ts";
import { IDLE_TIMEOUT_SEC, type ActivityEvent, type ActivityKind, type UsageEvent } from "./types.ts";

export interface UsageContext {
	/** End of the call (ISO). */
	at: string;
	domain: string;
	op: string;
	connection: string;
	provider: string;
	model: string;
	billing: UsageEvent["billing"];
	durationMs: number;
	/** Zone used to derive `day`; UTC when omitted. Use the same zone as the stats reader. */
	timeZone?: string;
}

const count = (value: number | undefined): number => (value !== undefined && Number.isFinite(value) && value > 0 ? Math.round(value) : 0);
const reported = (value: number | undefined): boolean => value !== undefined && Number.isFinite(value) && value >= 0;

/**
 * One UsageEvent for one LLM request. Unreported input/output counters are
 * stored as 0 but flag the event `usageIncomplete` (never priced from them);
 * the cache-write split (`cacheWrite1hTokens`, clamped to the writes) is kept
 * so the server's CallPricer can still price providers whose 5 min and 1 h
 * writes bill differently.
 */
export function usageEventFromCall(call: Partial<CallUsage>, context: UsageContext): UsageEvent {
	const event: UsageEvent = {
		day: dayKey(context.at, context.timeZone),
		at: new Date(toEpochMs(context.at)).toISOString(),
		domain: context.domain,
		op: context.op,
		connection: context.connection,
		provider: context.provider,
		model: context.model,
		billing: context.billing,
		inputTokens: count(call.inputTokens),
		cachedTokens: count(call.cacheReadTokens),
		outputTokens: count(call.outputTokens),
		reasoningTokens: count(call.reasoningTokens),
		durationMs: Math.max(0, Number.isFinite(context.durationMs) ? context.durationMs : 0),
	};
	if (call.cacheWriteTokens !== undefined) {
		event.cacheWriteTokens = count(call.cacheWriteTokens);
		if (call.cacheWrite1hTokens !== undefined) event.cacheWrite1hTokens = Math.min(count(call.cacheWrite1hTokens), event.cacheWriteTokens);
	}
	if (!reported(call.inputTokens) || !reported(call.outputTokens)) event.usageIncomplete = true;
	return event;
}

export interface ActivityWindowInput {
	windowStartMs: number;
	windowEndMs: number;
	/** Interaction instants (ms), including the last one BEFORE the window. */
	interactionsMs: readonly number[];
	/** Spans that count as active without input, e.g. a playing video [startMs, endMs). */
	busySpansMs?: readonly (readonly [number, number])[];
	idleSec?: number;
}

/** Whole seconds of [windowStart, windowEnd) during which the learner was active. */
export function activeSecondsInWindow(input: ActivityWindowInput): number {
	const { windowStartMs: start, windowEndMs: end } = input;
	if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
	const idleMs = (input.idleSec ?? IDLE_TIMEOUT_SEC) * 1000;
	const spans: [number, number][] = [];
	for (const t of input.interactionsMs) if (Number.isFinite(t)) spans.push([t, t + idleMs]);
	for (const [s, e] of input.busySpansMs ?? []) if (Number.isFinite(s) && Number.isFinite(e) && e > s) spans.push([s, e]);
	let covered = 0;
	for (const [s, e] of mergeSpans(spans)) covered += Math.max(0, Math.min(e, end) - Math.max(s, start));
	return Math.round(covered / 1000);
}

/** Union of half-open spans, sorted. */
export function mergeSpans(spans: readonly (readonly [number, number])[]): [number, number][] {
	const sorted = spans.filter(([s, e]) => e > s).map(([s, e]): [number, number] => [s, e]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const merged: [number, number][] = [];
	for (const span of sorted) {
		const last = merged[merged.length - 1];
		if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
		else merged.push(span);
	}
	return merged;
}

/** The heartbeat the renderer posts at the end of a window. */
export function heartbeatEvent(input: ActivityWindowInput & { domain: string; kind: ActivityKind }): ActivityEvent {
	return {
		at: new Date(toEpochMs(input.windowEndMs)).toISOString(),
		domain: input.domain,
		kind: input.kind,
		activeSec: activeSecondsInWindow(input),
	};
}
