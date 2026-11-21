/**
 * File adapter for the two stats streams (docs/research/00-SINTESE.md §2.2
 * "profile/stats/…", §2.10 "Stats: tokens e horas"; r5 §5.5).
 *
 *   <root>/profile/stats/usage-YYYY-MM.jsonl     one UsageEvent per line
 *   <root>/profile/stats/activity-YYYY-MM.jsonl  one ActivityEvent (heartbeat) per line
 *
 * Files are partitioned by the UTC month of `at` (monthKeyUtc), so a range
 * read opens only the months the instants touch, independent of time zones.
 *
 * Writes: every event is validated first (all-or-nothing: one bad event
 * rejects the whole batch, nothing is written), then each touched month is
 * rewritten with writeFileAtomicSync (temp + fsync + rename). Readers thus
 * see the old file or the complete new one, never a torn line. A month file
 * stays small (≈11k heartbeats/month at 3 h/day ≈ 1 MB), so the
 * read-append-rewrite cost is negligible next to an LLM call. No in-place
 * fallback: if Windows holds the file past the retry, the append throws and
 * the month file is untouched (losing one heartbeat beats risking a month).
 * Single writer per data dir (the server process), as everywhere in §2.2.
 *
 * Reads: lines that are not valid JSON or not a valid event (hand edits,
 * a newer build's shape) are SKIPPED and counted, never fatal. Results are
 * filtered to the half-open range [from, to) on `at` and sorted by `at`
 * (stable, so file order breaks ties).
 */

import fs from "node:fs";
import path from "node:path";
import { activityLogFile, statsDir, usageLogFile } from "../core/domains/paths.ts";
import { monthKeyUtc, monthsInRange, toEpochMs } from "../core/stats/dates.ts";
import { StatsEventError, assertActivityEvent, assertUsageEvent, parseActivityEvent, parseUsageEvent } from "../core/stats/schema.ts";
import type { ActivityEvent, TimeRange, UsageEvent } from "../core/stats/types.ts";
import { writeFileAtomicSync } from "./atomic-write.ts";

export type StatsStream = "usage" | "activity";

export interface StatsReadFilter {
	/** Only events of this domain (or WORKSPACE_SCOPE). */
	domain?: string;
}

export interface StatsReadResult<T> {
	events: T[];
	/** Lines skipped because they were not valid JSON or not a valid event. */
	skippedLines: number;
}

export interface StatsStore {
	readonly root: string;
	/** Append usage events; returns how many were written. */
	appendUsage(events: UsageEvent | readonly UsageEvent[]): number;
	/** Append activity heartbeats; returns how many were written. */
	appendActivity(events: ActivityEvent | readonly ActivityEvent[]): number;
	/** Usage events with `at` in [range.from, range.to). */
	readUsage(range: TimeRange, filter?: StatsReadFilter): StatsReadResult<UsageEvent>;
	/** Activity heartbeats with `at` in [range.from, range.to). */
	readActivity(range: TimeRange, filter?: StatsReadFilter): StatsReadResult<ActivityEvent>;
	/** Months ("YYYY-MM") that have a file for the stream, oldest first. */
	listMonths(stream: StatsStream): string[];
}

const MONTH_FILE = /^(usage|activity)-(\d{4}-(?:0[1-9]|1[0-2]))\.jsonl$/;

interface StreamSpec<T extends { at: string; domain: string }> {
	stream: StatsStream;
	fileFor(root: string, month: string): string;
	assert(value: unknown): T;
	parse(value: unknown): T | null;
}

const USAGE: StreamSpec<UsageEvent> = { stream: "usage", fileFor: usageLogFile, assert: assertUsageEvent, parse: parseUsageEvent };
const ACTIVITY: StreamSpec<ActivityEvent> = { stream: "activity", fileFor: activityLogFile, assert: assertActivityEvent, parse: parseActivityEvent };

type ParsedMonthEntry = {
	stamp: string;
	stream: StatsStream;
	parsed: readonly { event: unknown; atMs: number }[];
	skippedLines: number;
};

const STATS_CACHE_KEY = Symbol.for("learnharness.store.stats");
const MAX_STATS_CACHE_ENTRIES = 128;

function statsCache(): Map<string, ParsedMonthEntry> {
	const g = globalThis as typeof globalThis & { [STATS_CACHE_KEY]?: Map<string, ParsedMonthEntry> };
	return (g[STATS_CACHE_KEY] ??= new Map());
}

function statsStatStamp(stat: fs.BigIntStats): string {
	return `${stat.dev}|${stat.ino}|${stat.ctimeNs}|${stat.mtimeNs}|${stat.size}`;
}

function asList<T>(events: T | readonly T[]): readonly T[] {
	return Array.isArray(events) ? (events as readonly T[]) : [events as T];
}

/** Validated events grouped by UTC month, in input order. */
function groupByMonth<T extends { at: string; domain: string }>(spec: StreamSpec<T>, events: readonly unknown[]): Map<string, T[]> {
	const byMonth = new Map<string, T[]>();
	events.forEach((value, index) => {
		let event: T;
		try {
			event = spec.assert(value);
		} catch (error) {
			throw new StatsEventError(`Evento ${index + 1} de ${events.length} rejeitado; nada foi gravado. ${(error as Error).message}`);
		}
		const month = monthKeyUtc(event.at);
		const list = byMonth.get(month) ?? [];
		list.push(event);
		byMonth.set(month, list);
	});
	return byMonth;
}

function readTextIfExists(file: string): string | null {
	try {
		return fs.readFileSync(file, "utf-8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

function appendLinesAtomic(file: string, lines: readonly string[]): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const current = readTextIfExists(file) ?? "";
	// A hand-edited file may lack the final newline: never glue two records.
	const prefix = current === "" || current.endsWith("\n") ? current : `${current}\n`;
	writeFileAtomicSync(file, `${prefix}${lines.join("\n")}\n`);
	statsCache().delete(path.resolve(file));
}

/** Fast O(1) append for high-frequency activity heartbeats while still guarding
 * against a missing trailing newline in hand-edited files. */
function appendLinesDirect(file: string, lines: readonly string[]): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	let needsLeadingNewline = false;
	const stat = fs.statSync(file, { throwIfNoEntry: false });
	if (stat && stat.size > 0) {
		const fd = fs.openSync(file, "r");
		try {
			const tail = Buffer.allocUnsafe(1);
			if (fs.readSync(fd, tail, 0, 1, stat.size - 1) === 1 && tail[0] !== 0x0a) {
				needsLeadingNewline = true;
			}
		} finally {
			fs.closeSync(fd);
		}
	}
	fs.appendFileSync(file, `${needsLeadingNewline ? "\n" : ""}${lines.join("\n")}\n`, "utf-8");
	statsCache().delete(path.resolve(file));
}

function append<T extends { at: string; domain: string }>(root: string, spec: StreamSpec<T>, events: readonly unknown[]): number {
	const byMonth = groupByMonth(spec, events);
	const writeLines = spec.stream === "activity" ? appendLinesDirect : appendLinesAtomic;
	for (const [month, list] of [...byMonth].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
		writeLines(
			spec.fileFor(root, month),
			list.map((event) => JSON.stringify(event)),
		);
	}
	return events.length;
}

function parseLine<T extends { at: string; domain: string }>(spec: StreamSpec<T>, line: string): T | null {
	try {
		return spec.parse(JSON.parse(line));
	} catch {
		return null;
	}
}

function readMonthCached<T extends { at: string; domain: string }>(file: string, spec: StreamSpec<T>): { parsed: readonly { event: T; atMs: number }[]; skippedLines: number } | null {
	const resolved = path.resolve(file);
	const cache = statsCache();
	const stat = fs.statSync(/* turbopackIgnore: true */ resolved, { bigint: true, throwIfNoEntry: false });
	if (!stat || !stat.isFile()) {
		cache.delete(resolved);
		return null;
	}
	const stamp = statsStatStamp(stat);
	const cached = cache.get(resolved);
	if (cached && cached.stamp === stamp && cached.stream === spec.stream) {
		return { parsed: cached.parsed as readonly { event: T; atMs: number }[], skippedLines: cached.skippedLines };
	}
	const text = readTextIfExists(resolved);
	if (text === null) {
		cache.delete(resolved);
		return null;
	}
	const parsed: { event: T; atMs: number }[] = [];
	let skippedLines = 0;
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (line === "") continue;
		const event = parseLine(spec, line);
		if (!event) {
			skippedLines += 1;
			continue;
		}
		parsed.push({ event, atMs: Date.parse(event.at) });
	}
	if (cache.size >= MAX_STATS_CACHE_ENTRIES && !cache.has(resolved)) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	cache.set(resolved, { stamp, stream: spec.stream, parsed, skippedLines });
	return { parsed, skippedLines };
}

function read<T extends { at: string; domain: string }>(root: string, spec: StreamSpec<T>, range: TimeRange, filter: StatsReadFilter = {}): StatsReadResult<T> {
	const fromMs = toEpochMs(range.from);
	const toMs = toEpochMs(range.to);
	const existingMonths = new Set(listMonths(root, spec.stream));
	if (existingMonths.size === 0) return { events: [], skippedLines: 0 };
	const kept: { event: T; atMs: number; index: number }[] = [];
	let skippedLines = 0;
	for (const month of monthsInRange(fromMs, toMs)) {
		if (!existingMonths.has(month)) continue;
		const entry = readMonthCached(spec.fileFor(root, month), spec);
		if (!entry) continue;
		skippedLines += entry.skippedLines;
		for (const item of entry.parsed) {
			if (item.atMs < fromMs || item.atMs >= toMs) continue;
			if (filter.domain !== undefined && item.event.domain !== filter.domain) continue;
			kept.push({ event: item.event, atMs: item.atMs, index: kept.length });
		}
	}
	kept.sort((a, b) => a.atMs - b.atMs || a.index - b.index);
	return { events: kept.map((k) => k.event), skippedLines };
}

function listMonths(root: string, stream: StatsStream): string[] {
	let names: string[];
	try {
		names = fs.readdirSync(statsDir(root));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const months: string[] = [];
	for (const name of names) {
		const match = MONTH_FILE.exec(name);
		if (match && match[1] === stream && match[2]) months.push(match[2]);
	}
	return months.sort();
}

/** Stats store rooted at `root` (= LH_DATA_DIR). */
export function createStatsStore(root: string): StatsStore {
	statsDir(root); // validates the root eagerly
	return {
		root,
		appendUsage: (events) => append(root, USAGE, asList(events)),
		appendActivity: (events) => append(root, ACTIVITY, asList(events)),
		readUsage: (range, filter) => read(root, USAGE, range, filter),
		readActivity: (range, filter) => read(root, ACTIVITY, range, filter),
		listMonths: (stream) => listMonths(root, stream),
	};
}
