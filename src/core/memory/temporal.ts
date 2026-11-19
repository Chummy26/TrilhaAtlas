/**
 * Time expressions for the recall `time` channel and for chronological
 * rendering (r4 §7.6.4 step 1 "tr = chrono.parse(texto, now, pt|en)", L3
 * "tempo explícito: datas absolutas, intervalos e há N dias"; Hindsight
 * "datas grosseiras ocupam o período inteiro" [extra-vectorize-io__hindsight.md §5.1]).
 *
 * chrono-node 2.10 covers absolute dates well in pt and en ("15 de março",
 * "March 3", "segunda-feira") but its pt locale misses most relative periods
 * ("semana passada", "há 3 dias", "mês passado", "anteontem"). Those are
 * handled first by a small deterministic rule table (pt + en, accent-folded);
 * chrono is the fallback for explicit dates. Every result is a half-open
 * interval [from, to) in local time, at the granularity the expression names:
 * a day → that day, a week → that calendar week (Monday-based), a month →
 * that month, "nos últimos N dias" → [now − N d, now].
 *
 * Memory queries look backwards: a chrono date with no explicit year that
 * lands in the future is moved one year back (weekday-only: one week back).
 * Bare numeric slashes ("3/20", common in arithmetic) are ignored unless they
 * carry a 4-digit year, so a formula is never mistaken for a date. Likewise
 * the pt ordinals that double as weekdays ("segunda lei de Kirchhoff",
 * "quinta harmônica"), the noun "marco" (folded "março") and the bare
 * present ("now", "agora") are not time references. "desde / since / a partir
 * de <data>" opens the interval up to now ("desde outubro" = [1º out, agora]).
 *
 * Pure and browser-safe (chrono-node is plain JS).
 */

import * as chrono from "chrono-node";
import { DAY_MS } from "./decay.ts";
import { contentTokens, foldText } from "./lexical.ts";

export type TimeGranularity = "day" | "week" | "month" | "year" | "window";

export interface TimeRange {
	/** Inclusive start (epoch ms). */
	from: number;
	/** Exclusive end (epoch ms). */
	to: number;
	granularity: TimeGranularity;
	/** The matched expression (folded for rule matches, raw for chrono). */
	matched: string;
}

// ─── calendar helpers (local time, DST-safe through Date arithmetic) ────────

export function startOfDay(t: number): number {
	const d = new Date(t);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

export function addDays(t: number, n: number): number {
	const d = new Date(t);
	d.setDate(d.getDate() + n);
	return d.getTime();
}

function startOfWeek(t: number): number {
	const d = new Date(startOfDay(t));
	const mondayIndex = (d.getDay() + 6) % 7;
	d.setDate(d.getDate() - mondayIndex);
	return d.getTime();
}

function startOfMonth(t: number): number {
	const d = new Date(t);
	return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function addMonths(t: number, n: number): number {
	const d = new Date(t);
	d.setMonth(d.getMonth() + n);
	return d.getTime();
}

function startOfYear(t: number): number {
	return new Date(new Date(t).getFullYear(), 0, 1).getTime();
}

function dayRange(t: number, matched: string): TimeRange {
	const from = startOfDay(t);
	return { from, to: addDays(from, 1), granularity: "day", matched };
}

function monthRange(year: number, month: number, matched: string): TimeRange {
	return { from: new Date(year, month, 1).getTime(), to: new Date(year, month + 1, 1).getTime(), granularity: "month", matched };
}

/** Local calendar date "YYYY-MM-DD". */
export function formatDay(t: number): string {
	const d = new Date(t);
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Whole calendar days between the two instants (positive = `at` is in the past). */
export function calendarDaysAgo(at: number, now: number): number {
	return Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
}

/** pt-BR relative phrase: "hoje", "ontem", "há 14 dias", "há 3 meses", "em 2 dias". */
export function relativeDayPt(at: number, now: number): string {
	const days = calendarDaysAgo(at, now);
	if (days === 0) return "hoje";
	if (days === 1) return "ontem";
	if (days === -1) return "amanhã";
	if (days < 0) return `em ${-days} dias`;
	if (days < 60) return `há ${days} dias`;
	if (days < 730) return `há ${Math.round(days / 30.44)} meses`;
	return `há ${Math.round(days / 365.25)} anos`;
}

// ─── rule table (pt + en, folded text) ──────────────────────────────────────

const NUMBER_WORDS: Readonly<Record<string, number>> = {
	um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
	onze: 11, doze: 12, quinze: 15, vinte: 20, trinta: 30, alguns: 3, algumas: 3,
	a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
	eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, few: 3, couple: 2,
};

const NUM = `(\\d{1,3}|${Object.keys(NUMBER_WORDS).join("|")})`;
const UNIT = "(dias?|semanas?|mes|meses|anos?|days?|weeks?|months?|years?)";

type Unit = "day" | "week" | "month" | "year";

function parseNumber(token: string): number | null {
	if (/^\d+$/.test(token)) return Number(token);
	return NUMBER_WORDS[token] ?? null;
}

function parseUnit(token: string): Unit {
	if (token.startsWith("dia") || token.startsWith("day")) return "day";
	if (token.startsWith("semana") || token.startsWith("week")) return "week";
	if (token.startsWith("mes") || token.startsWith("month")) return "month";
	return "year";
}

function shift(now: number, n: number, unit: Unit): number {
	if (unit === "day") return addDays(now, -n);
	if (unit === "week") return addDays(now, -7 * n);
	if (unit === "month") return addMonths(now, -n);
	return addMonths(now, -12 * n);
}

/** "há N <unit>" — a window around the instant N units ago, sized by the unit. */
function agoRange(now: number, n: number, unit: Unit, matched: string): TimeRange {
	const at = shift(now, n, unit);
	if (unit === "day") return dayRange(at, matched);
	const half = unit === "week" ? 3.5 * DAY_MS : unit === "month" ? 15 * DAY_MS : 182 * DAY_MS;
	return { from: at - half, to: Math.min(now, at + half), granularity: "window", matched };
}

interface Rule {
	re: RegExp;
	build: (m: RegExpExecArray, now: number) => TimeRange | null;
}

const MONTHS_PT = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const RULES: readonly Rule[] = [
	{ re: /\b(anteontem|day before yesterday)\b/, build: (m, now) => dayRange(addDays(now, -2), m[0]) },
	{ re: /\b(ontem|yesterday)\b/, build: (m, now) => dayRange(addDays(now, -1), m[0]) },
	{ re: /\b(hoje|today)\b/, build: (m, now) => dayRange(now, m[0]) },
	{
		re: new RegExp(`\\b(?:n?[oa]s )?(?:ultim[oa]s|passad[oa]s|last|past) ${NUM} ${UNIT}\\b`),
		build: (m, now) => {
			const n = parseNumber(m[1] as string);
			if (!n) return null;
			return { from: shift(now, n, parseUnit(m[2] as string)), to: now + 1, granularity: "window", matched: m[0] };
		},
	},
	{
		re: new RegExp(`\\b(?:ha|faz) (?:uns |umas |cerca de )?${NUM} ${UNIT}(?: atras)?\\b`),
		build: (m, now) => {
			const n = parseNumber(m[1] as string);
			return n ? agoRange(now, n, parseUnit(m[2] as string), m[0]) : null;
		},
	},
	{
		re: new RegExp(`\\b${NUM} ${UNIT} (?:atras|ago)\\b`),
		build: (m, now) => {
			const n = parseNumber(m[1] as string);
			return n ? agoRange(now, n, parseUnit(m[2] as string), m[0]) : null;
		},
	},
	{
		re: /\b(?:semana passada|semana anterior|last week|previous week)\b/,
		build: (m, now) => {
			const thisWeek = startOfWeek(now);
			return { from: addDays(thisWeek, -7), to: thisWeek, granularity: "week", matched: m[0] };
		},
	},
	{
		re: /\b(?:ultima semana|past week)\b/,
		build: (m, now) => ({ from: addDays(now, -7), to: now + 1, granularity: "window", matched: m[0] }),
	},
	{
		re: /\b(?:n?(?:esta|essa) semana|this week)\b/,
		build: (m, now) => ({ from: startOfWeek(now), to: now + 1, granularity: "week", matched: m[0] }),
	},
	{
		re: /\b(?:mes passado|mes anterior|ultimo mes|last month|previous month)\b/,
		build: (m, now) => {
			const thisMonth = startOfMonth(now);
			return { from: addMonths(thisMonth, -1), to: thisMonth, granularity: "month", matched: m[0] };
		},
	},
	{
		re: /\b(?:n?(?:este|esse) mes|this month)\b/,
		build: (m, now) => ({ from: startOfMonth(now), to: now + 1, granularity: "month", matched: m[0] }),
	},
	{
		re: /\b(?:ano passado|ano anterior|last year|previous year)\b/,
		build: (m, now) => {
			const thisYear = startOfYear(now);
			return { from: addMonths(thisYear, -12), to: thisYear, granularity: "year", matched: m[0] };
		},
	},
	{
		re: /\b(?:n?(?:este|esse) ano|this year)\b/,
		build: (m, now) => ({ from: startOfYear(now), to: now + 1, granularity: "year", matched: m[0] }),
	},
];

/** "em março", "março de 2026" (chrono's pt locale has no bare-month parser). */
const MONTH_RE = new RegExp(`\\b(em |de |desde |a partir de |ate |no mes de )?(${MONTHS_PT.join("|")})(?: de (\\d{4}))?\\b`);

/** Folded text ending in "desde", "since", "a partir de/do/da": the date opens an interval up to now. */
const OPEN_START_RE = /\b(?:desde|since|a partir d[eoa]s?|starting(?: from)?)\s*$/;

/** [start of `range`, now] when `prefix` opens an interval ("desde outubro"); the range itself otherwise. */
function openEnded(range: TimeRange, prefix: string, now: number): TimeRange {
	if (!OPEN_START_RE.test(foldText(prefix)) || range.from > now) return range;
	return { from: range.from, to: Math.max(range.to, now + 1), granularity: "window", matched: range.matched };
}

function monthNameRange(raw: string, folded: string, now: number): TimeRange | null {
	const m = MONTH_RE.exec(folded);
	if (!m) return null;
	// Folded "marco" is also the noun "marco" (landmark: "o marco zero"): accept it
	// only when spelled "março", introduced by a preposition or followed by a year.
	if (m[2] === "marco" && !m[1] && !m[3] && !/março/i.test(raw)) return null;
	const month = MONTHS_PT.indexOf(m[2] as string);
	const nowDate = new Date(now);
	let year = m[3] ? Number(m[3]) : nowDate.getFullYear();
	if (!m[3] && new Date(year, month, 1).getTime() > now) year -= 1;
	return openEnded(monthRange(year, month, m[0]), folded.slice(0, m.index + (m[1]?.length ?? 0)), now);
}

// ─── chrono fallback ────────────────────────────────────────────────────────

/** Accept chrono matches that name a date in words, or a numeric date with a 4-digit year. */
function plausibleDateText(text: string): boolean {
	return /\p{L}/u.test(text) || /\d{4}/.test(text);
}

/** "now"/"agora" name the present instant, not a period worth recalling. */
const PRESENT_ONLY = new Set(["now", "right now", "agora", "agora mesmo"]);

/**
 * pt weekdays "segunda…sexta" are also ordinals ("segunda lei de Kirchhoff",
 * "quinta harmônica", "na segunda questão"). Without "-feira", the word is a
 * weekday only when nothing follows it or what follows is a function word or
 * a time word ("na segunda eu errei", "na sexta passada", "na terça de manhã").
 */
const ORDINAL_WEEKDAYS = new Set(["segunda", "terca", "quarta", "quinta", "sexta"]);
const WEEKDAY_FOLLOWERS = new Set(["passada", "passado", "retrasada", "anterior", "que", "manha", "tarde", "noite", "cedo"]);

/** `matched` is the chrono match, `after` the raw text that follows it. */
export function isOrdinalNotWeekday(matched: string, after: string): boolean {
	if (!ORDINAL_WEEKDAYS.has(foldText(matched))) return false;
	const next = /^[\s,]*([\p{L}\p{N}]+)/u.exec(foldText(after))?.[1];
	if (next === undefined || WEEKDAY_FOLLOWERS.has(next)) return false;
	return contentTokens(next).length > 0;
}

function chronoRange(raw: string, now: number): TimeRange | null {
	const ref = new Date(now);
	const results = [...chrono.pt.parse(raw, ref), ...chrono.en.parse(raw, ref)]
		.filter((r) => plausibleDateText(r.text))
		.filter((r) => !PRESENT_ONLY.has(foldText(r.text)))
		.filter((r) => !isOrdinalNotWeekday(r.text, raw.slice(r.index + r.text.length)))
		.sort((a, b) => a.index - b.index);
	for (const r of results) {
		const range = chronoResultRange(r, now);
		if (range) return openEnded(range, raw.slice(0, r.index), now);
	}
	return null;
}

function chronoResultRange(r: chrono.ParsedResult, now: number): TimeRange | null {
	const known = (k: "day" | "month" | "year" | "weekday") => r.start.isCertain(k);
	if (!known("day") && !known("weekday") && !known("month") && !known("year")) return null;
	let start = r.start.date().getTime();
	let end = r.end ? r.end.date().getTime() : null;
	if (!known("year") && start > now + DAY_MS / 2) {
		const back = known("day") || known("month") ? (t: number) => addMonths(t, -12) : (t: number) => addDays(t, -7);
		start = back(start);
		end = end === null ? null : back(end);
	}
	if (end !== null && end > start) {
		return { from: startOfDay(start), to: addDays(startOfDay(end), 1), granularity: "window", matched: r.text };
	}
	if (known("day") || known("weekday")) return dayRange(start, r.text);
	const d = new Date(start);
	if (known("month")) return monthRange(d.getFullYear(), d.getMonth(), r.text);
	return { from: startOfYear(start), to: addMonths(startOfYear(start), 12), granularity: "year", matched: r.text };
}

/**
 * The time range a recall query refers to, or null. Relative rules win over
 * chrono; the first matching rule (in table order) decides.
 */
export function parseTimeRange(text: string, now: number): TimeRange | null {
	if (!text || !Number.isFinite(now)) return null;
	const folded = foldText(text);
	for (const rule of RULES) {
		const m = rule.re.exec(folded);
		if (!m) continue;
		const range = rule.build(m, now);
		if (range) return range;
	}
	return chronoRange(text, now) ?? monthNameRange(text, folded, now);
}
