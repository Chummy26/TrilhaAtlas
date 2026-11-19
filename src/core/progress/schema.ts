/**
 * Runtime validation at the progress boundaries (docs/research/00-SINTESE.md
 * §2.3, §2.11; r7 §4.3, §4.7).
 *
 *   • `parseProgressEvent` — what `ctx.progress.record(ev)` and the server
 *     accept. Objects are STRICT: an event carrying `rating`, `grade`, `ease`
 *     or any other unknown key is refused, so XP cannot depend on the
 *     Again/Hard/Good/Easy self-assessment even by accident (invariant I7 at
 *     the boundary, not only in the formulas).
 *   • `parseLedgerEntry` / `parseLedgerLine` — the JSONL reader: writers
 *     validate and throw; readers skip a bad line instead of hiding a month
 *     of XP (same policy as src/core/stats/schema.ts).
 *
 * Identity fields are VALIDATED, never transformed: an id with surrounding
 * whitespace is refused instead of trimmed, so the eventId the ledger dedupes
 * on is byte-for-byte the one the caller sent (a trimming schema made rows
 * produced by `creditEvent` unreadable: `id` no longer matched
 * `xp:<eventId>`). `domainId` follows DOMAIN_ID_PATTERN, so XP can never land
 * in a look-alike bucket ("Electronics", "electronics ").
 *
 * `isIsoInstant` is THE instant check: `creditEvent` (./xp.ts) uses it too, so
 * every row it produces passes `parseLedgerEntry`. `Date.parse` alone is not
 * enough: V8 accepts "2026-02-30T00:00:00Z" and engine-specific formats,
 * which would make study-day keys engine-dependent.
 *
 * Sanity bounds (a corrupted or hostile line must not inflate XP or hang the
 * level computation): one event carries at most one day (1 440 min) of
 * focused time; a ledger row has `multiplier ≤ 1.5` (r7 I5) and
 * `raw ≤ minutes × multiplier` up to the coarsest rounding a rule set may use.
 *
 * Pure: browser-safe (zod only).
 */

import { z } from "zod";
import { DOMAIN_ID_PATTERN } from "../domains/types.ts";
import { MAX_MULTIPLIER } from "./rules.ts";
import type { ProgressEvent, XpLedgerEntry } from "./types.ts";

export class ProgressEventError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ProgressEventError";
	}
}

/** Focused minutes one event may carry (a full day). */
export const MAX_EVENT_MINUTES = 24 * 60;
/** Largest rounding slack of any valid rule set (xpDecimals = 0 → ±0.5 XP). */
const MAX_ROUNDING_SLACK = 0.5 + 1e-9;

const finite = z.number().refine(Number.isFinite, "número finito");
const minutes = finite.refine((x) => x >= 0, "minutos ≥ 0");
const eventMinutes = minutes.refine((x) => x <= MAX_EVENT_MINUTES, `no máximo ${MAX_EVENT_MINUTES} minutos por evento`);
const positiveMinutes = finite.refine((x) => x > 0 && x <= MAX_EVENT_MINUTES, `valor > 0 e ≤ ${MAX_EVENT_MINUTES}`);

/** Non-blank and without surrounding whitespace (validated, never trimmed). */
export function isCleanId(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.trim() === value;
}

const id = z.string().refine(isCleanId, "id não vazio e sem espaços nas pontas");
const domainId = z.string().regex(DOMAIN_ID_PATTERN, "domainId inválido (minúsculas, dígitos e hífen)");
const isoInstant = z.iso.datetime({ offset: true });

/** ISO-8601 instant with an explicit offset (`Z` or ±hh:mm), as the ledger stores it. */
export function isIsoInstant(value: unknown): value is string {
	return isoInstant.safeParse(value).success;
}

const envelope = { eventId: id, at: isoInstant, domainId };

const lessonSchema = z.strictObject({
	...envelope,
	kind: z.literal("lesson"),
	nodeId: id,
	focusedMin: eventMinutes,
	expectedMin: positiveMinutes.optional(),
	checkPassed: z.boolean().optional(),
});

const mediaSchema = z.strictObject({
	...envelope,
	kind: z.literal("media"),
	resourceId: id,
	focusedMin: eventMinutes,
	mediaMin: positiveMinutes.optional(),
	checkPassed: z.boolean().optional(),
});

const itemSchema = z.strictObject({
	...envelope,
	kind: z.literal("item"),
	itemId: id,
	theta: finite,
	b: finite,
	correct: z.boolean(),
	focusedMin: eventMinutes,
	hints: z.number().int().nonnegative().optional(),
	medianMin: positiveMinutes.optional(),
});

const reviewSchema = z.strictObject({
	...envelope,
	kind: z.literal("review"),
	nodeId: id,
	R: finite.refine((r) => r >= 0 && r <= 1, "R em [0, 1]"),
	focusedMin: eventMinutes,
	cards: z.number().int().positive().optional(),
	origin: z.enum(["app", "anki", "obsidian"]).optional(),
	desiredRetention: finite.refine((dr) => dr > 0 && dr < 1, "retenção desejada em (0, 1)").optional(),
});

const diagnosticSchema = z.strictObject({
	...envelope,
	kind: z.literal("diagnostic"),
	items: z.number().int().nonnegative().max(MAX_EVENT_MINUTES),
	focusedMin: eventMinutes.optional(),
});

export const progressEventSchema = z.discriminatedUnion("kind", [lessonSchema, mediaSchema, itemSchema, reviewSchema, diagnosticSchema]);

function describeIssue(error: z.ZodError): string {
	const issue = error.issues[0];
	if (!issue) return "formato inesperado";
	const where = issue.path.length ? issue.path.join(".") : "(raiz)";
	return `${where}: ${issue.message}`;
}

/** Validate an incoming event; throws ProgressEventError (pt-BR) on anything unexpected. */
export function parseProgressEvent(raw: unknown): ProgressEvent {
	const result = progressEventSchema.safeParse(raw);
	if (!result.success) throw new ProgressEventError(`Evento de progresso inválido — ${describeIssue(result.error)}.`);
	return result.data as ProgressEvent;
}

export const xpLedgerEntrySchema = z
	.object({
		id: id,
		eventId: id,
		at: isoInstant,
		domainId,
		raw: minutes,
		capped: minutes,
		rulesVersion: id,
		reason: z.string(),
		kind: z.enum(["lesson", "media", "item", "review", "diagnostic"]),
		day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dia AAAA-MM-DD"),
		minutes: eventMinutes,
		multiplier: minutes.refine((x) => x <= MAX_MULTIPLIER, `multiplicador ≤ ${MAX_MULTIPLIER}`),
	})
	.refine((entry) => entry.capped <= entry.raw, "capped ≤ raw")
	.refine((entry) => entry.raw <= entry.minutes * entry.multiplier + MAX_ROUNDING_SLACK, "raw ≤ minutos × multiplicador")
	.refine((entry) => entry.id === `xp:${entry.eventId}`, "id = xp:<eventId>");

/** Validate a ledger row before appending; throws ProgressEventError. */
export function parseLedgerEntry(raw: unknown): XpLedgerEntry {
	const result = xpLedgerEntrySchema.safeParse(raw);
	if (!result.success) throw new ProgressEventError(`Linha do ledger de XP inválida — ${describeIssue(result.error)}.`);
	return result.data as XpLedgerEntry;
}

/** Reader path: one JSONL line → entry, or null when the line is blank, truncated or invalid (CRLF-safe). */
export function parseLedgerLine(line: string): XpLedgerEntry | null {
	const trimmed = line.trim();
	if (trimmed === "") return null;
	try {
		const result = xpLedgerEntrySchema.safeParse(JSON.parse(trimmed));
		return result.success ? (result.data as XpLedgerEntry) : null;
	} catch {
		return null;
	}
}
