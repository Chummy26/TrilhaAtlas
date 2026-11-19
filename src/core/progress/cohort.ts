/**
 * Opt-in comparisons — all OFF by default (docs/research/00-SINTESE.md §2.11
 * "Rankings"; r7 §4.6, P5; extra-chuma-beep__mathua.md §9.1, §9.3, §14.3).
 *
 *   • "Eu vs Eu": your pace as a percentile of the simulated curve of your own
 *     daily budget (`pacePercentile`), and this week against your previous
 *     weeks (`selfLeague`: 5 "ghosts" that are your own past weeks).
 *   • Simulated cohort: 29 rivals EXPLICITLY labelled as simulated, sampled
 *     (inverse CDF, seeded per week) from the Monte Carlo weekly-XP quantiles
 *     of the same daily budget — the honest analogue of Duolingo's
 *     "matching by habit". Never presented as people.
 *   • `moversFor(n) = n < 6 ? 0 : min(5, ⌊n/3⌋)` and the deterministic
 *     `planWeek` ordering (XP desc, name asc, id asc; ties share a rank
 *     1, 1, 3) are ported from mathua. r7 adds: the learner is never demoted
 *     in a week where the weekly goal was met (`protectedFromDemotion`).
 *
 * Pure: browser-safe.
 */

import type { CohortProfile, PaceCurve, ProgressionConfig } from "./config.ts";
import { deriveSeed, mulberry32 } from "./random.ts";

export class CohortError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CohortError";
	}
}

// ─── interpolation helpers ──────────────────────────────────────────────────

function interpolateRow(days: readonly number[], rows: readonly (readonly number[])[], day: number): number[] {
	if (days.length === 0) throw new CohortError("Curva de ritmo vazia.");
	const first = days[0] as number;
	const last = days[days.length - 1] as number;
	if (day <= first) return [...(rows[0] as readonly number[])];
	if (day >= last) return [...(rows[rows.length - 1] as readonly number[])];
	let hi = 1;
	while ((days[hi] as number) < day) hi += 1;
	const d0 = days[hi - 1] as number;
	const d1 = days[hi] as number;
	const t = (day - d0) / (d1 - d0);
	const r0 = rows[hi - 1] as readonly number[];
	const r1 = rows[hi] as readonly number[];
	return r0.map((value, j) => value + ((r1[j] as number) - value) * t);
}

/**
 * Inverse of a quantile function given by points (quantiles[j], values[j]):
 * the probability level of `value`. A value equal to a RUN of tied points
 * (e.g. the 5–25 % of simulated learners with 0 XP on a skipped first day)
 * gets the middle of that run (mid-rank), not its lower end: the old lower-end
 * rule reported "p5" to a learner tied with the bottom quarter.
 */
function levelOf(quantiles: readonly number[], values: readonly number[], value: number): number {
	const n = values.length;
	if (n === 0) throw new CohortError("Quantis vazios.");
	if (value < (values[0] as number)) return quantiles[0] as number;
	if (value > (values[n - 1] as number)) return quantiles[n - 1] as number;
	let first = -1;
	let last = -1;
	for (let j = 0; j < n; j++) {
		if (values[j] !== value) continue;
		if (first < 0) first = j;
		last = j;
	}
	if (first >= 0) return ((quantiles[first] as number) + (quantiles[last] as number)) / 2;
	for (let j = 1; j < n; j++) {
		const v0 = values[j - 1] as number;
		const v1 = values[j] as number;
		if (value < v1) {
			const q0 = quantiles[j - 1] as number;
			const q1 = quantiles[j] as number;
			return q0 + ((q1 - q0) * (value - v0)) / (v1 - v0);
		}
	}
	return quantiles[n - 1] as number;
}

/** Quantile function given by points: the value at probability level `u`. */
function valueAt(quantiles: readonly number[], values: readonly number[], u: number): number {
	const n = quantiles.length;
	if (n === 0 || values.length !== n) throw new CohortError("Quantis da coorte inconsistentes.");
	if (u <= (quantiles[0] as number)) return values[0] as number;
	if (u >= (quantiles[n - 1] as number)) return values[n - 1] as number;
	let j = 1;
	while ((quantiles[j] as number) < u) j += 1;
	const q0 = quantiles[j - 1] as number;
	const q1 = quantiles[j] as number;
	const v0 = values[j - 1] as number;
	const v1 = values[j] as number;
	return v0 + ((v1 - v0) * (u - q0)) / (q1 - q0);
}

// ─── "Eu vs Eu": pace percentile ────────────────────────────────────────────

/** The stored curve (or cohort profile) whose daily budget is closest to `hoursPerDay`. */
export function nearestProfile<T extends { hoursPerDay: number; profileId: string }>(profiles: readonly T[], hoursPerDay: number): T | null {
	let best: T | null = null;
	for (const profile of profiles) {
		if (!best || Math.abs(profile.hoursPerDay - hoursPerDay) < Math.abs(best.hoursPerDay - hoursPerDay)) best = profile;
	}
	return best;
}

export interface PaceStanding {
	profileId: string;
	/** Percentile 0..100 of your cumulative XP among simulated learners of the same budget on the same day. */
	percentile: number;
	/** The percentile is outside the stored band (shown as "≤ p5" / "≥ p95"). */
	clamped: "low" | "high" | null;
	/** Median simulated XP on that day. */
	medianXp: number;
	/** pt-BR one-liner, e.g. "Seu ritmo está no p70 dos alunos simulados de 3 h/dia". */
	message: string;
}

/** Where cumulative `xp` on study day `day` (1-based) falls on a simulated pace curve. */
export function pacePercentile(curve: PaceCurve, quantiles: readonly number[], day: number, xp: number): PaceStanding {
	if (!Number.isFinite(day) || day < 1) throw new CohortError(`Dia de estudo inválido: ${day} (≥ 1).`);
	// NaN fails every comparison inside levelOf and used to fall through to the TOP quantile ("p90").
	if (!Number.isFinite(xp)) throw new CohortError(`XP acumulado inválido: ${xp} (use um número finito).`);
	const row = interpolateRow(curve.days, curve.xp, day);
	const level = levelOf(quantiles, row, Math.max(0, xp));
	const lowest = quantiles[0] as number;
	const highest = quantiles[quantiles.length - 1] as number;
	const clamped = level <= lowest && xp < (row[0] as number) ? "low" : level >= highest && xp > (row[row.length - 1] as number) ? "high" : null;
	const percentile = Math.round(level * 100);
	const medianXp = valueAt(quantiles, row, 0.5);
	const shown = clamped === "low" ? `≤ p${percentile}` : clamped === "high" ? `≥ p${percentile}` : `p${percentile}`;
	return {
		profileId: curve.profileId,
		percentile,
		clamped,
		medianXp,
		message: `Seu ritmo está no ${shown} dos alunos simulados de ${formatHours(curve.hoursPerDay)}.`,
	};
}

/** Convenience: pick the nearest curve of `config` and compute the pace standing (null when there are no curves). */
export function paceStandingFor(config: ProgressionConfig, hoursPerDay: number, day: number, xp: number): PaceStanding | null {
	const curve = nearestProfile(config.pace.curves, hoursPerDay);
	return curve ? pacePercentile(curve, config.pace.quantiles, day, xp) : null;
}

function formatHours(hours: number): string {
	return `${String(hours).replace(".", ",")} h/dia`;
}

// ─── leagues (mathua planWeek / moversFor) ──────────────────────────────────

/** Promotions = demotions per cohort of n: n < 6 ? 0 : min(5, ⌊n/3⌋). */
export function moversFor(n: number): number {
	if (!Number.isInteger(n) || n < 0) throw new CohortError(`Tamanho de coorte inválido: ${n}.`);
	return n < 6 ? 0 : Math.min(5, Math.floor(n / 3));
}

export interface LeagueMember {
	id: string;
	name: string;
	xp: number;
	/** True for every simulated rival (the UI must label it). */
	simulated: boolean;
	/** r7: never demoted in a week where the weekly goal was met. */
	protectedFromDemotion?: boolean;
}

export type LeagueMove = "up" | "down" | "stay";

export interface LeagueRow extends LeagueMember {
	/** 1-based; ties share a rank (1, 1, 3). */
	rank: number;
	move: LeagueMove;
}

const compareMembers = (a: LeagueMember, b: LeagueMember): number =>
	b.xp - a.xp || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Deterministic weekly resolution of one cohort: order, ranks and moves. */
export function planWeek(members: readonly LeagueMember[]): LeagueRow[] {
	const ids = new Set<string>();
	for (const member of members) {
		if (ids.has(member.id)) throw new CohortError(`Membro repetido na coorte: "${member.id}".`);
		if (!Number.isFinite(member.xp) || member.xp < 0) throw new CohortError(`XP inválido para "${member.id}": ${member.xp}.`);
		ids.add(member.id);
	}
	const ordered = [...members].sort(compareMembers);
	const k = moversFor(ordered.length);
	let rank = 0;
	return ordered.map((member, i) => {
		if (i === 0 || (ordered[i - 1] as LeagueMember).xp !== member.xp) rank = i + 1;
		const move: LeagueMove = k > 0 && i < k ? "up" : k > 0 && i >= ordered.length - k && !member.protectedFromDemotion ? "down" : "stay";
		return { ...member, rank, move };
	});
}

/**
 * The opt-in simulated cohort for one week: `size` rivals sampled from the
 * weekly-XP quantiles of the learner's budget. Deterministic in (seed, weekStart).
 */
export function simulatedRivals(profile: CohortProfile, quantiles: readonly number[], weekStart: string, seed: number, size = 29): LeagueMember[] {
	if (!Number.isInteger(size) || size < 1) throw new CohortError(`Tamanho da coorte simulada inválido: ${size}.`);
	if (profile.weeklyXp.length !== quantiles.length || quantiles.length < 2) throw new CohortError(`Quantis da coorte "${profile.profileId}" inconsistentes.`);
	const lo = quantiles[0] as number;
	const hi = quantiles[quantiles.length - 1] as number;
	return Array.from({ length: size }, (_, i) => {
		const u = lo + (hi - lo) * mulberry32(deriveSeed(seed, "cohort", profile.profileId, weekStart, i))();
		const label = String(i + 1).padStart(2, "0");
		return { id: `sim-${label}`, name: `Simulado ${label}`, xp: Math.round(valueAt(quantiles, profile.weeklyXp, u)), simulated: true };
	});
}

/** "Eu vs Eu" league: this week against your previous `ghosts` weeks (default 5). */
export function selfLeague(
	currentWeekXp: number,
	previousWeeks: readonly { weekStart: string; xp: number }[],
	ghosts = 5,
): { rows: LeagueRow[]; medianLastFour: number | null } {
	const recent = [...previousWeeks].sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1)).slice(0, ghosts);
	const members: LeagueMember[] = [
		{ id: "you", name: "Você (esta semana)", xp: currentWeekXp, simulated: false },
		...recent.map((week) => ({ id: `week-${week.weekStart}`, name: `Semana de ${week.weekStart}`, xp: week.xp, simulated: false })),
	];
	const lastFour = recent
		.slice(0, 4)
		.map((week) => week.xp)
		.sort((a, b) => a - b);
	const medianLastFour =
		lastFour.length === 0
			? null
			: lastFour.length % 2 === 1
				? (lastFour[(lastFour.length - 1) / 2] as number)
				: ((lastFour[lastFour.length / 2 - 1] as number) + (lastFour[lastFour.length / 2] as number)) / 2;
	return { rows: planWeek(members).map((row) => ({ ...row, move: "stay" as const })), medianLastFour };
}
