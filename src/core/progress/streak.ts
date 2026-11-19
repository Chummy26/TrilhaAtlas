/**
 * Healthy weekly streak (docs/research/00-SINTESE.md §2.11 "Streak"; r7 §1.4,
 * §4.4). A habit tool only: it never grants XP.
 *
 *   • valid day   = ≥ 10 active minutes OR the due-review queue reached zero;
 *   • weekly goal = N valid days per ISO week (Monday–Sunday), N ∈ 3..7,
 *                   default 5; the streak counts COMPLETED WEEKS (the daily
 *                   run is informative only);
 *   • freezes     = 1 earned per 2 completed weeks, at most 2 held, consumed
 *                   automatically by a missed week, never bought;
 *   • repair      = a missed week with no freeze can be repaired within 48 h
 *                   (the Monday/Tuesday after it) by one session of
 *                   2 × the valid-day minimum (Silverman & Barasch 2023);
 *   • travel mode = up to 14 marked days per calendar year pause the streak:
 *                   each honoured travel day lowers that week's requirement
 *                   by one, and a week whose requirement is met that way is
 *                   "paused" (neutral). A day that is valid counts as valid,
 *                   so it does not spend travel allowance.
 *
 * Decisions where r7 is silent (simplest choice that keeps the invariants):
 *   • the learner's FIRST (usually partial) week can never break the streak;
 *   • a missed week whose repair window is still open is reported as
 *     "broken" with a `repair` offer carrying the streak that will come back
 *     (`lostStreak`); recomputing after the repair session yields "repaired";
 *   • the current week counts toward `weeksStreak` as soon as its goal is met
 *     (immediate, informative feedback); freezes are only earned at week close;
 *   • a goal change applies from the week given in `targetChanges` on, so it
 *     never re-judges past weeks.
 *
 * Pure fold over day activity: deterministic, replayable, no clock reads.
 *
 * Pure: browser-safe.
 */

import type { DayActivity, StreakConfig, StreakRepairOffer, StreakState, WeekOutcome, WeekRecord } from "./types.ts";

export const DEFAULT_STREAK_CONFIG: Readonly<StreakConfig> = Object.freeze({
	weeklyTarget: 5,
	validDayMinutes: 10,
	maxFreezes: 2,
	weeksPerFreeze: 2,
	repairWindowDays: 2,
	repairMinutesMultiplier: 2,
	travelDaysPerYear: 14,
});

export class StreakError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StreakError";
	}
}

// ─── day arithmetic (UTC calendar on YYYY-MM-DD keys) ───────────────────────

const DAY_MS = 86_400_000;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Days since 1970-01-01 of a YYYY-MM-DD key. */
export function dayNumber(day: string): number {
	if (!DAY_KEY.test(day)) throw new StreakError(`Dia inválido: "${day}" (use AAAA-MM-DD).`);
	const ms = Date.parse(`${day}T00:00:00Z`);
	if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== day) throw new StreakError(`Dia inválido: "${day}".`);
	return Math.round(ms / DAY_MS);
}

export function dayKeyFromNumber(dayNum: number): string {
	return new Date(dayNum * DAY_MS).toISOString().slice(0, 10);
}

/** Monday (as a day number) of the ISO week containing `dayNum` (1970-01-01 was a Thursday). */
function mondayOf(dayNum: number): number {
	return dayNum - ((((dayNum + 3) % 7) + 7) % 7);
}

/** Monday (YYYY-MM-DD) of the ISO week containing `day`. */
export function weekStartOf(day: string): string {
	return dayKeyFromNumber(mondayOf(dayNumber(day)));
}

// ─── configuration ──────────────────────────────────────────────────────────

function requireInt(name: string, value: number, lo: number, hi: number): void {
	if (!Number.isInteger(value) || value < lo || value > hi) {
		throw new StreakError(`Configuração de streak inválida: ${name} = ${value} (inteiro entre ${lo} e ${hi}).`);
	}
}

export function resolveStreakConfig(partial: Partial<StreakConfig> = {}): StreakConfig {
	const config: StreakConfig = { ...DEFAULT_STREAK_CONFIG, ...partial };
	requireInt("weeklyTarget", config.weeklyTarget, 3, 7);
	if (!Number.isFinite(config.validDayMinutes) || config.validDayMinutes <= 0 || config.validDayMinutes > 240) {
		throw new StreakError(`Configuração de streak inválida: validDayMinutes = ${config.validDayMinutes} (entre 0 e 240).`);
	}
	requireInt("maxFreezes", config.maxFreezes, 0, 7);
	requireInt("weeksPerFreeze", config.weeksPerFreeze, 1, 52);
	requireInt("repairWindowDays", config.repairWindowDays, 0, 7);
	if (!Number.isFinite(config.repairMinutesMultiplier) || config.repairMinutesMultiplier < 1 || config.repairMinutesMultiplier > 10) {
		throw new StreakError(`Configuração de streak inválida: repairMinutesMultiplier = ${config.repairMinutesMultiplier} (entre 1 e 10).`);
	}
	requireInt("travelDaysPerYear", config.travelDaysPerYear, 0, 366);
	return config;
}

export interface StreakOptions {
	/** Weekly goal changes, each effective from its `weekStart` (a Monday) on. */
	targetChanges?: readonly { weekStart: string; weeklyTarget: number }[];
}

// ─── classification ─────────────────────────────────────────────────────────

type DayClass = "valid" | "travel" | "none";

interface DayInfo {
	minutes: number;
	cleared: boolean;
	travel: boolean;
}

/** Merge entries of the same day (minutes add up, flags OR). */
function mergeDays(days: readonly DayActivity[], lastDay: number): Map<number, DayInfo> {
	const merged = new Map<number, DayInfo>();
	for (const entry of days) {
		const n = dayNumber(entry.day);
		if (n > lastDay) continue;
		if (!Number.isFinite(entry.activeMinutes) || entry.activeMinutes < 0) {
			throw new StreakError(`Minutos ativos inválidos em ${entry.day}: ${entry.activeMinutes}.`);
		}
		const info = merged.get(n) ?? { minutes: 0, cleared: false, travel: false };
		info.minutes += entry.activeMinutes;
		info.cleared ||= entry.reviewQueueCleared === true;
		info.travel ||= entry.travel === true;
		merged.set(n, info);
	}
	return merged;
}

export function isValidDay(activity: Pick<DayActivity, "activeMinutes" | "reviewQueueCleared">, config: StreakConfig = DEFAULT_STREAK_CONFIG): boolean {
	return activity.activeMinutes >= config.validDayMinutes || activity.reviewQueueCleared === true;
}

/** Valid / honoured-travel / nothing for every day, spending the yearly travel allowance in order. */
function classifyDays(merged: Map<number, DayInfo>, config: StreakConfig): { classes: Map<number, DayClass>; travelUsedByYear: Map<string, number> } {
	const classes = new Map<number, DayClass>();
	const travelUsedByYear = new Map<string, number>();
	for (const n of [...merged.keys()].sort((a, b) => a - b)) {
		const info = merged.get(n);
		if (!info) continue;
		if (isValidDay({ activeMinutes: info.minutes, reviewQueueCleared: info.cleared }, config)) {
			classes.set(n, "valid");
			continue;
		}
		if (info.travel) {
			const year = dayKeyFromNumber(n).slice(0, 4);
			const used = travelUsedByYear.get(year) ?? 0;
			if (used < config.travelDaysPerYear) {
				travelUsedByYear.set(year, used + 1);
				classes.set(n, "travel");
				continue;
			}
		}
		classes.set(n, "none");
	}
	return { classes, travelUsedByYear };
}

// ─── fold ───────────────────────────────────────────────────────────────────

function targetResolver(config: StreakConfig, options: StreakOptions): (monday: number) => number {
	const changes = (options.targetChanges ?? [])
		.map((change) => {
			requireInt("targetChanges.weeklyTarget", change.weeklyTarget, 3, 7);
			return { monday: mondayOf(dayNumber(change.weekStart)), target: change.weeklyTarget };
		})
		.sort((a, b) => a.monday - b.monday);
	return (monday) => {
		let target = config.weeklyTarget;
		for (const change of changes) if (change.monday <= monday) target = change.target;
		return target;
	};
}

function countWeek(classes: Map<number, DayClass>, monday: number, lastDay: number): { valid: number; travel: number } {
	let valid = 0;
	let travel = 0;
	for (let n = monday; n < monday + 7 && n <= lastDay; n++) {
		const cls = classes.get(n);
		if (cls === "valid") valid += 1;
		else if (cls === "travel") travel += 1;
	}
	return { valid, travel };
}

/** No activity yet: the goal in force this week still honours `targetChanges`. */
function emptyState(asOfNum: number, config: StreakConfig, target: number): StreakState {
	const monday = mondayOf(asOfNum);
	const daysLeft = monday + 6 - asOfNum;
	return {
		asOf: dayKeyFromNumber(asOfNum),
		weeklyTarget: target,
		weekStart: dayKeyFromNumber(monday),
		currentWeekValidDays: 0,
		daysLeftInWeek: daysLeft,
		targetReachable: daysLeft + 1 >= target,
		weeksStreak: 0,
		bestWeeksStreak: 0,
		freezes: 0,
		weeksTowardFreeze: 0,
		dayRun: 0,
		travelDaysLeft: config.travelDaysPerYear,
		repair: null,
		history: [],
	};
}

/**
 * Streak state on study day `asOf` from the learner's day activity (days after
 * `asOf` are ignored). Pure: the same history always yields the same state.
 */
export function computeStreak(days: readonly DayActivity[], asOf: string, partialConfig: Partial<StreakConfig> = {}, options: StreakOptions = {}): StreakState {
	const config = resolveStreakConfig(partialConfig);
	const asOfNum = dayNumber(asOf);
	const merged = mergeDays(days, asOfNum);
	const targetFor = targetResolver(config, options);
	if (merged.size === 0) return emptyState(asOfNum, config, targetFor(mondayOf(asOfNum)));

	const { classes, travelUsedByYear } = classifyDays(merged, config);
	const firstMonday = mondayOf(Math.min(...merged.keys()));
	const currentMonday = mondayOf(asOfNum);
	const repairMinutes = config.repairMinutesMultiplier * config.validDayMinutes;

	let streak = 0;
	let best = 0;
	let freezes = 0;
	let towardFreeze = 0;
	let repair: StreakRepairOffer | null = null;
	const history: WeekRecord[] = [];

	for (let monday = firstMonday; monday < currentMonday; monday += 7) {
		const target = targetFor(monday);
		const { valid, travel } = countWeek(classes, monday, asOfNum);
		const required = Math.max(0, target - travel);
		let outcome: WeekOutcome;
		if (valid >= target) {
			outcome = "completed";
		} else if ((travel > 0 && valid >= required) || monday === firstMonday) {
			outcome = "paused";
		} else if (freezes > 0) {
			outcome = "frozen";
		} else {
			const windowStart = monday + 7;
			const windowEnd = windowStart + config.repairWindowDays - 1;
			let repaired = false;
			for (let n = windowStart; n <= Math.min(windowEnd, asOfNum); n++) {
				if ((merged.get(n)?.minutes ?? 0) >= repairMinutes) repaired = true;
			}
			outcome = repaired ? "repaired" : "broken";
			repair = !repaired && asOfNum <= windowEnd && streak > 0 ? { lostStreak: streak, lastDay: dayKeyFromNumber(windowEnd), minutesNeeded: repairMinutes } : null;
		}

		if (outcome === "completed") {
			streak += 1;
			towardFreeze += 1;
			if (towardFreeze >= config.weeksPerFreeze) {
				freezes = Math.min(config.maxFreezes, freezes + 1);
				towardFreeze = 0;
			}
		} else if (outcome === "frozen") {
			freezes -= 1;
		} else if (outcome === "broken") {
			streak = 0;
			towardFreeze = 0;
		}
		if (outcome !== "broken") repair = null;
		best = Math.max(best, streak);
		history.push({ weekStart: dayKeyFromNumber(monday), target, validDays: valid, travelDays: travel, outcome });
	}

	const target = targetFor(currentMonday);
	const current = countWeek(classes, currentMonday, asOfNum);
	const daysLeft = currentMonday + 6 - asOfNum;
	const required = Math.max(0, target - current.travel);
	// Today can still become valid unless it already is one, or is an honoured
	// travel day: that one already lowered `required` (counting it as "open"
	// too promised a reachable goal that was not).
	const todayClass = classes.get(asOfNum);
	const todayStillOpen = todayClass === "valid" || todayClass === "travel" ? 0 : 1;
	const shownStreak = current.valid >= target ? streak + 1 : streak;

	return {
		asOf: dayKeyFromNumber(asOfNum),
		weeklyTarget: target,
		weekStart: dayKeyFromNumber(currentMonday),
		currentWeekValidDays: current.valid,
		daysLeftInWeek: daysLeft,
		targetReachable: current.valid + daysLeft + todayStillOpen >= required,
		weeksStreak: shownStreak,
		bestWeeksStreak: Math.max(best, shownStreak),
		freezes,
		weeksTowardFreeze: towardFreeze,
		dayRun: dayRun(classes, asOfNum),
		travelDaysLeft: Math.max(0, config.travelDaysPerYear - (travelUsedByYear.get(dayKeyFromNumber(asOfNum).slice(0, 4)) ?? 0)),
		repair,
		history,
	};
}

/** Consecutive valid days ending on `asOf` (or the day before, if today is not valid yet); travel days are skipped. */
function dayRun(classes: Map<number, DayClass>, asOfNum: number): number {
	let n = classes.get(asOfNum) === "valid" ? asOfNum : asOfNum - 1;
	let run = 0;
	for (;;) {
		const cls = classes.get(n);
		if (cls === "valid") run += 1;
		else if (cls !== "travel") break;
		n -= 1;
	}
	return run;
}
