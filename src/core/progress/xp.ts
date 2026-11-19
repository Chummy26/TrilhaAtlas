/**
 * XP pricing and the idempotent XP ledger (docs/research/00-SINTESE.md §2.11,
 * §1.4; r7 §2.3, §4.3; ledger pattern from extra-chuma-beep__mathua.md §8).
 *
 * Unit: 1 XP ≈ 1 focused, productive minute.
 *
 *   lesson      min(T, 1.5·T_exp) · q        q = 1 check passed; 0.25 failed or
 *                                            no check; 0 when the check failed
 *                                            after < 50 % of T_exp (rush)
 *   media       min(T, T_media) · 0.8 · q    q as above (no rush rule)
 *   item        min(T, 1.5·T_med) · mDif(E) · c · h
 *                 E = expectedScore(θ, b); mDif = clamp((1−E)/(1−0.8), 0.3, 1.5)
 *                 c = 1 right · 0.5 wrong · 0 guess (wrong ∧ T < 0.2·T_med)
 *                 h = max(0.4, 1 − 0.2·hints)
 *   review      min(T, cap) · gReview(R)     gReview = clamp((1−R)/(1−DR), 0.1, 1.5)
 *                 cap = 2 min/card (Anki: 60 s/card) or 15 min per node review
 *   diagnostic  T (or items × 1 min)
 *
 * Daily soft cap (per ACCOUNT, in chronological credit order): credited
 * minutes beyond 240/day are worth ×0.5 and beyond 360/day ×0.25.
 *
 * Invariants (tests/progress-*.test.ts): XP ≥ 0 per event (I1); replaying an
 * `eventId` grants nothing (I2); the soft cap only reduces and is monotonic;
 * every multiplier ≤ 1.5 ⇒ XP/h ≤ 90 (I5); ∂XP/∂R ≤ 0 for reviews (I6); no
 * event carries a rating, so XP cannot depend on Again/Hard/Good/Easy (I7);
 * every row records its `rulesVersion`; granted rows are never re-priced.
 *
 * Boundary consistency: `creditEvent` accepts exactly what the ledger schema
 * (./schema.ts) can read back — clean ids, a DOMAIN_ID_PATTERN domain, an
 * ISO-8601 instant with offset, ≤ 1 440 focused minutes per event — so a row
 * it returns never fails `parseLedgerEntry` (a row the reader skipped would
 * lose its XP AND its dedupe key, paying the event twice on re-send).
 *
 * Ledger shape: the store keeps an append-only JSONL of `XpLedgerEntry`; this
 * module decides (pure) and the store persists. `LedgerIndex` is the minimal
 * read view a decision needs (has this event been credited? how many minutes
 * were already credited on that study day?).
 *
 * Pure: browser-safe.
 */

import { isDomainId } from "../domains/types.ts";
import { expectedScore } from "./elo.ts";
import { ProgressRuleError, RULES, roundXp, type XpRules } from "./rules.ts";
import { isCleanId, isIsoInstant, MAX_EVENT_MINUTES } from "./schema.ts";
import type { ProgressEvent, ProgressEventBody, XpCredit, XpLedgerEntry } from "./types.ts";

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

// ─── multipliers ────────────────────────────────────────────────────────────

/** Difficulty multiplier from the Elo expected score (item vs. current level). */
export function mDif(E: number, rules: XpRules = RULES): number {
	if (!Number.isFinite(E) || E < 0 || E > 1) throw new ProgressRuleError(`mDif: expected score fora de [0, 1] (${E}).`);
	return clamp((1 - E) / (1 - rules.targetExpected), rules.mDifMin, rules.mDifMax);
}

/** Review multiplier from FSRS retrievability: early reviews pay little, overdue ones are capped. */
export function gReview(R: number, desiredRetention: number = RULES.desiredRetention, rules: XpRules = RULES): number {
	if (!Number.isFinite(R) || R < 0 || R > 1) throw new ProgressRuleError(`gReview: retrievability fora de [0, 1] (${R}).`);
	if (!Number.isFinite(desiredRetention) || desiredRetention <= 0 || desiredRetention >= 1) {
		throw new ProgressRuleError(`gReview: retenção desejada fora de (0, 1) (${desiredRetention}).`);
	}
	return clamp((1 - R) / (1 - desiredRetention), rules.gReviewMin, rules.gReviewMax);
}

// ─── per-kind credit (shared verbatim by the runtime and the Monte Carlo) ──

function requireMinutes(what: string, value: number): number {
	if (!Number.isFinite(value) || value < 0) throw new ProgressRuleError(`${what}: minutos inválidos (${value}); use um número ≥ 0.`);
	return value;
}

/** Focused minutes of ONE event: 0 … 1 440 (the same bound the ledger schema reads back). */
function requireEventMinutes(what: string, value: number): number {
	requireMinutes(what, value);
	if (value > MAX_EVENT_MINUTES) throw new ProgressRuleError(`${what}: ${value} minutos num só evento (máximo ${MAX_EVENT_MINUTES}).`);
	return value;
}

function optionalPositive(what: string, value: number | undefined): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isFinite(value) || value <= 0 || value > MAX_EVENT_MINUTES) {
		throw new ProgressRuleError(`${what}: valor inválido (${value}); use um número > 0 e ≤ ${MAX_EVENT_MINUTES}.`);
	}
	return value;
}

/** Lesson attempt credit. `checkPassed` undefined = no comprehension check = effort credit. */
export function lessonCredit(focusedMin: number, expectedMin: number | undefined, checkPassed: boolean | undefined, rules: XpRules = RULES): XpCredit {
	const active = requireEventMinutes("Aula", focusedMin);
	const expected = optionalPositive("Aula: tempo esperado", expectedMin);
	const minutes = expected === undefined ? active : Math.min(active, rules.lessonMaxOverExpected * expected);
	if (checkPassed === true) return { minutes, multiplier: 1, label: "Aula com check aprovado" };
	if (checkPassed === false && expected !== undefined && active < rules.lessonRushFraction * expected) {
		return { minutes, multiplier: 0, label: "Aula apressada (check não aprovado)" };
	}
	return {
		minutes,
		multiplier: rules.lessonFailCredit,
		label: checkPassed === false ? "Aula com check não aprovado (crédito de esforço)" : "Aula sem check (crédito de esforço)",
	};
}

/** Book chapter / video credit. */
export function mediaCredit(focusedMin: number, mediaMin: number | undefined, checkPassed: boolean | undefined, rules: XpRules = RULES): XpCredit {
	const active = requireEventMinutes("Mídia", focusedMin);
	const length = optionalPositive("Mídia: duração", mediaMin);
	const minutes = length === undefined ? active : Math.min(active, length);
	const q = checkPassed === true ? 1 : rules.lessonFailCredit;
	return {
		minutes,
		multiplier: rules.mediaFactor * q,
		label: checkPassed === true ? "Mídia com perguntas de recuperação" : "Mídia sem verificação (crédito de esforço)",
	};
}

/** Rated item (exercise, teacher question, lesson check item). */
export function itemCredit(
	input: { theta: number; b: number; correct: boolean; focusedMin: number; hints?: number; medianMin?: number },
	rules: XpRules = RULES,
): XpCredit {
	const active = requireEventMinutes("Exercício", input.focusedMin);
	const median = optionalPositive("Exercício: tempo mediano", input.medianMin);
	const hints = input.hints ?? 0;
	if (!Number.isInteger(hints) || hints < 0) throw new ProgressRuleError(`Exercício: número de dicas inválido (${input.hints}).`);
	const minutes = median === undefined ? active : Math.min(active, rules.itemMaxOverMedian * median);
	const guess = !input.correct && median !== undefined && active < rules.itemGuessFraction * median;
	const correctness = input.correct ? 1 : guess ? 0 : rules.itemWrongCredit;
	const hintFactor = Math.max(rules.itemHintFloor, 1 - rules.itemHintPenalty * hints);
	const multiplier = mDif(expectedScore(input.theta, input.b), rules) * correctness * hintFactor;
	const label = input.correct ? "Exercício resolvido" : guess ? "Resposta apressada (sem XP)" : "Exercício com tentativa genuína";
	return { minutes, multiplier, label };
}

/** Spaced review of a node or of `cards` flashcards. Depends only on time and R (never on the rating). */
export function reviewCredit(
	input: { R: number; focusedMin: number; cards?: number; origin?: "app" | "anki" | "obsidian"; desiredRetention?: number },
	rules: XpRules = RULES,
): XpCredit {
	const active = requireEventMinutes("Revisão", input.focusedMin);
	if (input.cards !== undefined && (!Number.isInteger(input.cards) || input.cards < 1)) {
		throw new ProgressRuleError(`Revisão: número de cartões inválido (${input.cards}).`);
	}
	const dr = input.desiredRetention ?? rules.desiredRetention;
	const cap =
		input.cards === undefined
			? rules.reviewNodeMaxMin
			: input.cards * (input.origin === "anki" ? rules.reviewAnkiMaxSecPerCard / 60 : rules.reviewMaxMinPerCard);
	const multiplier = gReview(input.R, dr, rules);
	const label = input.R > dr + 0.02 ? "Revisão antecipada" : input.R < dr - 0.05 ? "Revisão atrasada" : "Revisão no tempo certo";
	return { minutes: Math.min(active, cap), multiplier, label };
}

/** Placement diagnostic: honest endowed progress (r7 §1.6). */
export function diagnosticCredit(items: number, focusedMin: number | undefined, rules: XpRules = RULES): XpCredit {
	if (!Number.isInteger(items) || items < 0) throw new ProgressRuleError(`Diagnóstico: número de itens inválido (${items}).`);
	const minutes = focusedMin === undefined ? Math.min(MAX_EVENT_MINUTES, items * rules.diagnosticMinPerItem) : requireEventMinutes("Diagnóstico", focusedMin);
	return { minutes, multiplier: 1, label: "Diagnóstico inicial" };
}

/** Credited minutes and multiplier of any event body (before the daily soft cap). The Monte Carlo prices with this same function. */
export function eventCredit(event: ProgressEventBody, rules: XpRules = RULES): XpCredit {
	switch (event.kind) {
		case "lesson":
			return lessonCredit(event.focusedMin, event.expectedMin, event.checkPassed, rules);
		case "media":
			return mediaCredit(event.focusedMin, event.mediaMin, event.checkPassed, rules);
		case "item":
			return itemCredit(event, rules);
		case "review":
			return reviewCredit(event, rules);
		case "diagnostic":
			return diagnosticCredit(event.items, event.focusedMin, rules);
		default: {
			const unknownKind: never = event;
			throw new ProgressRuleError(`Evento de progresso desconhecido: ${JSON.stringify(unknownKind)}.`);
		}
	}
}

// ─── daily soft cap ─────────────────────────────────────────────────────────

/** Unrounded XP of `minutes` at `multiplier` given `minutesAlreadyToday` credited minutes. */
export function softCappedExact(minutes: number, multiplier: number, minutesAlreadyToday: number, rules: XpRules = RULES): number {
	requireMinutes("Limite diário", minutes);
	requireMinutes("Limite diário (minutos do dia)", minutesAlreadyToday);
	if (!Number.isFinite(multiplier) || multiplier < 0) throw new ProgressRuleError(`Limite diário: multiplicador inválido (${multiplier}).`);
	let xp = 0;
	let cursor = minutesAlreadyToday;
	let left = minutes;
	let factor = 1;
	for (const tier of rules.softCap) {
		const take = Math.max(0, Math.min(left, tier.afterMin - cursor));
		xp += take * multiplier * factor;
		cursor += take;
		left -= take;
		factor = tier.factor;
	}
	xp += left * multiplier * factor;
	return Math.max(0, xp);
}

/** XP granted for `minutes` at `multiplier` after `minutesAlreadyToday` credited minutes (rounded). */
export function softCapped(minutes: number, multiplier: number, minutesAlreadyToday: number, rules: XpRules = RULES): number {
	return roundXp(softCappedExact(minutes, multiplier, minutesAlreadyToday, rules), rules);
}

// ─── study day ──────────────────────────────────────────────────────────────

export interface StudyDayOptions {
	/** Learner's UTC offset in minutes (e.g. −180 for BRT). Default 0. */
	utcOffsetMin?: number;
	/** Local hour at which a new study day starts (default 4: 01:30 still counts as "yesterday"). */
	dayStartHour?: number;
}

/** Real-world UTC offsets span −12:00 … +14:00. */
const MAX_UTC_OFFSET_MIN = 14 * 60;

/** The day key the ledger schema reads back (4-digit year). */
const STUDY_DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Study-day key (YYYY-MM-DD) of an ISO-8601 instant with offset (other formats are refused: Date.parse is engine-specific).
 * The shift by offset/day start can leave the 4-digit-year range at the edges ("0000-01-01T01:00Z" → year −1,
 * "9999-12-31T23:00Z" at +14:00 → year 10000), where toISOString writes "-000001-12-31"/"+010000-01-01"; such a key
 * would make the ledger row unreadable (its XP AND its dedupe key lost), so it is refused instead.
 */
export function studyDay(at: string, options: StudyDayOptions = {}): string {
	if (!isIsoInstant(at)) throw new ProgressRuleError(`Data inválida no evento de progresso: "${at}" (use ISO-8601 com fuso, ex.: 2026-11-18T14:30:00Z).`);
	const offset = options.utcOffsetMin ?? 0;
	const startHour = options.dayStartHour ?? 4;
	if (!Number.isFinite(offset) || Math.abs(offset) > MAX_UTC_OFFSET_MIN) {
		throw new ProgressRuleError(`Fuso inválido: utcOffsetMin = ${offset} (entre −${MAX_UTC_OFFSET_MIN} e ${MAX_UTC_OFFSET_MIN}).`);
	}
	if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) {
		throw new ProgressRuleError(`Hora de início do dia inválida: ${startHour} (inteiro 0–23).`);
	}
	const shifted = new Date(Date.parse(at) + (offset - startHour * 60) * 60_000);
	const key = Number.isFinite(shifted.getTime()) ? shifted.toISOString().slice(0, 10) : "";
	if (!STUDY_DAY_KEY.test(key)) {
		throw new ProgressRuleError(`Data fora do intervalo suportado no evento de progresso: "${at}" (o dia de estudo precisa ficar entre os anos 0000 e 9999).`);
	}
	return key;
}

// ─── ledger ─────────────────────────────────────────────────────────────────

/** Minimal read view a credit decision needs. */
export interface LedgerIndex {
	has(eventId: string): boolean;
	/** Credited minutes already accounted on `day` (all domains when the caller aggregates them). */
	minutesOn(day: string): number;
}

/** In-memory index over stored entries (the store can keep one alive and `add` to it). */
export class MemoryLedgerIndex implements LedgerIndex {
	private readonly ids = new Set<string>();
	private readonly dayMinutes = new Map<string, number>();
	constructor(entries: readonly XpLedgerEntry[] = []) {
		for (const entry of entries) this.add(entry);
	}
	has(eventId: string): boolean {
		return this.ids.has(eventId);
	}
	minutesOn(day: string): number {
		return this.dayMinutes.get(day) ?? 0;
	}
	add(entry: XpLedgerEntry): void {
		if (this.ids.has(entry.eventId)) return;
		this.ids.add(entry.eventId);
		this.dayMinutes.set(entry.day, (this.dayMinutes.get(entry.day) ?? 0) + entry.minutes);
	}
}

export interface CreditOptions extends StudyDayOptions {
	rules?: XpRules;
	/** Minutes credited today in OTHER ledgers (other domains): the soft cap is per account. */
	otherMinutesToday?: number;
}

export type CreditDecision = { status: "duplicate" } | { status: "credited"; entry: XpLedgerEntry };

function validateEnvelope(event: ProgressEvent): void {
	if (!isCleanId(event.eventId)) throw new ProgressRuleError(`Evento de progresso sem eventId válido (${JSON.stringify(event.eventId)}): não vazio e sem espaços nas pontas.`);
	if (!isDomainId(event.domainId)) throw new ProgressRuleError(`Evento ${event.eventId} com domainId inválido (${JSON.stringify(event.domainId)}).`);
}

const formatPt = (value: number, decimals: number): string => value.toFixed(decimals).replace(".", ",");

/** pt-BR explanation built from the APPLIED value (mathua: never show the calculated one as if granted). */
function describe(label: string, minutes: number, multiplier: number, raw: number, capped: number, decimals: number): string {
	const base = `${label}: +${formatPt(capped, decimals)} XP (${formatPt(minutes, 1)} min × ${formatPt(multiplier, 2)}`;
	return capped < raw ? `${base}; limite diário aplicado, seriam ${formatPt(raw, decimals)})` : `${base})`;
}

/**
 * Price one event against the ledger view. Pure: returns the row to append
 * (the caller persists it and updates its index) or "duplicate".
 */
export function creditEvent(event: ProgressEvent, index: LedgerIndex, options: CreditOptions = {}): CreditDecision {
	validateEnvelope(event);
	if (index.has(event.eventId)) return { status: "duplicate" };
	const rules = options.rules ?? RULES;
	const credit = eventCredit(event, rules);
	const day = studyDay(event.at, options);
	const already = index.minutesOn(day) + requireMinutes("Minutos de outros domínios", options.otherMinutesToday ?? 0);
	const raw = roundXp(credit.minutes * credit.multiplier, rules);
	const capped = Math.min(raw, softCapped(credit.minutes, credit.multiplier, already, rules));
	const entry: XpLedgerEntry = {
		id: `xp:${event.eventId}`,
		eventId: event.eventId,
		at: event.at,
		domainId: event.domainId,
		raw,
		capped,
		rulesVersion: rules.version,
		reason: describe(credit.label, credit.minutes, credit.multiplier, raw, capped, rules.xpDecimals),
		kind: event.kind,
		day,
		minutes: credit.minutes,
		multiplier: credit.multiplier,
	};
	return { status: "credited", entry };
}

/** Immutable append: the new entries array, the row, and whether the event was a replay. */
export function recordEvent(
	entries: readonly XpLedgerEntry[],
	event: ProgressEvent,
	options: CreditOptions = {},
): { entries: readonly XpLedgerEntry[]; entry: XpLedgerEntry | null; duplicate: boolean } {
	const decision = creditEvent(event, new MemoryLedgerIndex(entries), options);
	if (decision.status === "duplicate") return { entries, entry: null, duplicate: true };
	return { entries: [...entries, decision.entry], entry: decision.entry, duplicate: false };
}

const byCreditOrder = (a: ProgressEvent, b: ProgressEvent): number =>
	Date.parse(a.at) - Date.parse(b.at) || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0);

/**
 * Rebuild a ledger from events in chronological credit order. `existing` rows
 * are GRANDFATHERED: kept verbatim (whatever rules priced them) and their
 * events are skipped, so re-running with recalibrated rules never reduces XP
 * already granted. The result does not depend on the input order of `events`.
 *
 * A replay spans many study days, so the minutes of OTHER domains' ledgers
 * come per day (`otherMinutesOn(day)`), never as `otherMinutesToday`: that
 * single number used to be added to EVERY replayed day, soft-capping days on
 * which the learner studied nothing else.
 */
export function replayXpLedger(
	events: readonly ProgressEvent[],
	options: Omit<CreditOptions, "otherMinutesToday"> & { existing?: readonly XpLedgerEntry[]; otherMinutesOn?: (day: string) => number } = {},
): XpLedgerEntry[] {
	if ((options as CreditOptions).otherMinutesToday !== undefined) {
		throw new ProgressRuleError("replayXpLedger: use otherMinutesOn(dia) — um único otherMinutesToday seria somado a todos os dias da reconstrução.");
	}
	const { existing = [], otherMinutesOn, ...creditOptions } = options;
	const index = new MemoryLedgerIndex(existing);
	const view: LedgerIndex = otherMinutesOn
		? { has: (eventId) => index.has(eventId), minutesOn: (day) => index.minutesOn(day) + requireMinutes(`Minutos de outros domínios em ${day}`, otherMinutesOn(day)) }
		: index;
	const out = [...existing];
	for (const event of [...events].sort(byCreditOrder)) {
		const decision = creditEvent(event, view, creditOptions);
		if (decision.status === "duplicate") continue;
		index.add(decision.entry);
		out.push(decision.entry);
	}
	return out;
}

export interface LedgerSummary {
	totalXp: number;
	byDomain: Record<string, number>;
	byDay: Record<string, number>;
	minutesByDay: Record<string, number>;
	count: number;
}

/** Totals from stored rows (first row per eventId wins, so a corrupted duplicate never double-counts). */
export function summarizeLedger(entries: readonly XpLedgerEntry[], rules: XpRules = RULES): LedgerSummary {
	const seen = new Set<string>();
	const summary: LedgerSummary = { totalXp: 0, byDomain: {}, byDay: {}, minutesByDay: {}, count: 0 };
	for (const entry of entries) {
		if (seen.has(entry.eventId)) continue;
		seen.add(entry.eventId);
		const xp = Math.max(0, entry.capped);
		summary.totalXp += xp;
		summary.byDomain[entry.domainId] = (summary.byDomain[entry.domainId] ?? 0) + xp;
		summary.byDay[entry.day] = (summary.byDay[entry.day] ?? 0) + xp;
		summary.minutesByDay[entry.day] = (summary.minutesByDay[entry.day] ?? 0) + entry.minutes;
		summary.count += 1;
	}
	summary.totalXp = roundXp(summary.totalXp, rules);
	for (const key of Object.keys(summary.byDomain)) summary.byDomain[key] = roundXp(summary.byDomain[key] ?? 0, rules);
	for (const key of Object.keys(summary.byDay)) summary.byDay[key] = roundXp(summary.byDay[key] ?? 0, rules);
	return summary;
}
