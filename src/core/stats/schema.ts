/**
 * Runtime validation of stats events (docs/research/00-SINTESE.md §2.3, §2.10).
 *
 * Writers validate before appending (a bad event is a bug: it throws); readers
 * validate each JSONL line and SKIP the bad ones (a hand-edited or truncated
 * line must not hide a month of stats). Pure and browser-safe (zod only).
 */

import { z } from "zod";
import { isDayKey } from "./dates.ts";
import { ACTIVITY_KINDS, type ActivityEvent, type UsageEvent } from "./types.ts";

export class StatsEventError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StatsEventError";
	}
}

const tokenCount = z.number().int().nonnegative();
const isoInstant = z.iso.datetime({ offset: true });

export const usageEventSchema = z.object({
	day: z.string().refine(isDayKey, "dia inválido (AAAA-MM-DD)"),
	at: isoInstant,
	domain: z.string().min(1),
	op: z.string().min(1),
	background: z.boolean().optional(),
	budgetEstimateTokens: tokenCount.optional(),
	connection: z.string().min(1),
	provider: z.string().min(1),
	model: z.string().min(1),
	billing: z.enum(["subscription", "api", "local", "unknown"]),
	inputTokens: tokenCount,
	cachedTokens: tokenCount,
	outputTokens: tokenCount,
	reasoningTokens: tokenCount,
	durationMs: z.number().nonnegative().finite(),
	cacheWriteTokens: tokenCount.optional(),
	cacheWrite1hTokens: tokenCount.optional(),
	usageIncomplete: z.literal(true).optional(),
}) satisfies z.ZodType<UsageEvent>;

export const activityEventSchema = z.object({
	at: isoInstant,
	domain: z.string().min(1),
	kind: z.enum(ACTIVITY_KINDS),
	activeSec: z.number().nonnegative().finite(),
}) satisfies z.ZodType<ActivityEvent>;

function describe(error: z.ZodError): string {
	return error.issues.map((issue) => `${issue.path.join(".") || "(raiz)"}: ${issue.message}`).join("; ");
}

/** The event, or null when `value` is not a valid UsageEvent. */
export function parseUsageEvent(value: unknown): UsageEvent | null {
	const parsed = usageEventSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

/** The event, or null when `value` is not a valid ActivityEvent. */
export function parseActivityEvent(value: unknown): ActivityEvent | null {
	const parsed = activityEventSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

export function assertUsageEvent(value: unknown): UsageEvent {
	const parsed = usageEventSchema.safeParse(value);
	if (!parsed.success) throw new StatsEventError(`UsageEvent inválido: ${describe(parsed.error)}`);
	return parsed.data;
}

export function assertActivityEvent(value: unknown): ActivityEvent {
	const parsed = activityEventSchema.safeParse(value);
	if (!parsed.success) throw new StatsEventError(`ActivityEvent inválido: ${describe(parsed.error)}`);
	return parsed.data;
}
