/**
 * Calendar helpers for stats (docs/research/00-SINTESE.md §2.10: "horas por
 * dia", monthly JSONL files, heatmap).
 *
 *  - dayKey(at, timeZone?): local "YYYY-MM-DD" via Intl (DST-aware, browser-
 *    safe); UTC when no zone is given.
 *  - monthKeyUtc / monthsInRange: the JSONL files are partitioned by the UTC
 *    month of `at`, so a range read only depends on instants, never on zones.
 *  - Day arithmetic works on "YYYY-MM-DD" strings through UTC dates, so it is
 *    exact regardless of the host zone.
 *
 * Pure: no clock reads.
 */

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export class StatsDateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StatsDateError";
	}
}

/** Milliseconds since the epoch of an ISO string, Date or number; throws on invalid input. */
export function toEpochMs(at: string | number | Date): number {
	const ms = typeof at === "number" ? at : typeof at === "string" ? Date.parse(at) : at.getTime();
	if (!Number.isFinite(ms)) throw new StatsDateError(`Data inválida: "${String(at)}".`);
	return ms;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
	let formatter = formatters.get(timeZone);
	if (!formatter) {
		try {
			formatter = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
		} catch {
			throw new StatsDateError(`Fuso horário desconhecido: "${timeZone}".`);
		}
		formatters.set(timeZone, formatter);
	}
	return formatter;
}

/** Local calendar day "YYYY-MM-DD" of an instant in `timeZone` (UTC when omitted). */
export function dayKey(at: string | number | Date, timeZone?: string): string {
	const ms = toEpochMs(at);
	if (timeZone === undefined || timeZone === "UTC") return new Date(ms).toISOString().slice(0, 10);
	let year = "";
	let month = "";
	let day = "";
	for (const part of formatterFor(timeZone).formatToParts(ms)) {
		if (part.type === "year") year = part.value;
		else if (part.type === "month") month = part.value;
		else if (part.type === "day") day = part.value;
	}
	return `${year.padStart(4, "0")}-${month}-${day}`;
}

/** A dayKey function bound to one zone (cheap to call in loops). */
export function dayKeyIn(timeZone?: string): (ms: number) => string {
	if (timeZone !== undefined && timeZone !== "UTC") formatterFor(timeZone); // fail fast on a bad zone
	return (ms) => dayKey(ms, timeZone);
}

/** UTC month "YYYY-MM" of an instant: the JSONL partition key. */
export function monthKeyUtc(at: string | number | Date): string {
	return new Date(toEpochMs(at)).toISOString().slice(0, 7);
}

/** Every UTC month touched by the half-open range [from, to), oldest first. */
export function monthsInRange(from: string | number | Date, to: string | number | Date): string[] {
	const start = toEpochMs(from);
	const end = toEpochMs(to);
	if (end <= start) return [];
	const first = new Date(start);
	const last = new Date(end - 1);
	const months: string[] = [];
	let year = first.getUTCFullYear();
	let month = first.getUTCMonth();
	while (year < last.getUTCFullYear() || (year === last.getUTCFullYear() && month <= last.getUTCMonth())) {
		months.push(`${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}`);
		month += 1;
		if (month === 12) {
			month = 0;
			year += 1;
		}
	}
	return months;
}

function parseDay(day: string): number {
	const match = DAY_PATTERN.exec(day);
	if (!match) throw new StatsDateError(`Dia inválido: "${day}" (esperado AAAA-MM-DD).`);
	const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
	if (new Date(ms).toISOString().slice(0, 10) !== day) throw new StatsDateError(`Dia inexistente: "${day}".`);
	return ms;
}

export function isDayKey(value: unknown): value is string {
	if (typeof value !== "string" || !DAY_PATTERN.test(value)) return false;
	try {
		parseDay(value);
		return true;
	} catch {
		return false;
	}
}

/** `day` shifted by `days` calendar days. */
export function addDays(day: string, days: number): string {
	return new Date(parseDay(day) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(day: string): number {
	return new Date(parseDay(day)).getUTCDay();
}

/** Whole calendar days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
	return Math.round((parseDay(b) - parseDay(a)) / MS_PER_DAY);
}
