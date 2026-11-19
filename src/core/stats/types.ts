/**
 * Stats contracts: one token stream + one activity stream
 * (docs/research/00-SINTESE.md §2.3 "src/core/stats/types.ts", §2.10; r5 §5.5).
 *
 *  - UsageEvent: one per model CALL (a CallUsage step), written by a single
 *    provider-layer hook. Memory, curriculum and every other background op are
 *    just different `op` values in the SAME stream ("um só stream, não dois").
 *  - ActivityEvent: one per renderer heartbeat (every 30 s while the window is
 *    focused and the learner interacted in the last 120 s). Hours per day are
 *    the sum of `activeSec`, the same base as XP's focused minutes.
 *
 * Token semantics follow pi's CallUsage (src/core/contracts/chat.ts): buckets
 * are disjoint — `inputTokens` is FRESH input (cache reads excluded),
 * `cachedTokens` are cache reads, and `reasoningTokens` are the reasoning
 * portion INCLUDED in `outputTokens`.
 *
 * Additions to the §2.3 contract (all optional, so §2.3 events stay valid):
 *  - `cacheWriteTokens` and its one-hour subset `cacheWrite1hTokens`: the
 *    server's CallPricer (src/server/pricing.ts) refuses to price a call with
 *    cache writes but no 1h split when the two retentions bill differently,
 *    so dropping the split would leave every such call unpriced;
 *  - `usageIncomplete`: the provider did not report input or output tokens.
 *    The counters still hold numbers (0 for the missing ones), but the call
 *    is never priced or credited from them ("absent stays absent",
 *    src/core/prices.ts): it counts as unpriced instead of a silent US$ 0.
 * Pure types: browser-safe.
 */

import type { BillingKind } from "../models/role-spec.ts";

export type { BillingKind };

/** Usage outside any study domain (workspace-level calls). Cannot collide with a DomainId. */
export const WORKSPACE_SCOPE = "_workspace";

export interface UsageEvent {
	/** Local calendar day of the call, "YYYY-MM-DD" (see dayKey). */
	day: string;
	/** ISO timestamp of the call's end. */
	at: string;
	/** Domain id, or WORKSPACE_SCOPE. */
	domain: string;
	/** "tutor" | "grader" | "extractor" | "consolidator" | … (a ModelRole or job kind). */
	op: string;
	/** Purpose at dispatch. Older events may not carry it. */
	background?: boolean;
	/** Reserved tokens when a memory provider omitted usage. Budget accounting only. */
	budgetEstimateTokens?: number;
	connection: string;
	provider: string;
	model: string;
	billing: BillingKind | "unknown";
	inputTokens: number;
	cachedTokens: number;
	outputTokens: number;
	reasoningTokens: number;
	durationMs: number;
	cacheWriteTokens?: number;
	/** Subset of cacheWriteTokens written with one-hour retention (pi CallUsage.cacheWrite1hTokens). */
	cacheWrite1hTokens?: number;
	/** True when the provider did not report input or output tokens: never priced from the zeros. */
	usageIncomplete?: true;
}

export const ACTIVITY_KINDS = ["lesson", "practice", "review", "media", "reading"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface ActivityEvent {
	/** ISO timestamp of the heartbeat (the END of the window it reports). */
	at: string;
	domain: string;
	kind: ActivityKind;
	/** Active seconds inside the heartbeat window (0..window). */
	activeSec: number;
}

/** Renderer heartbeat period (§2.10). */
export const HEARTBEAT_WINDOW_SEC = 30;
/** Study renderer cadence (HANDOFF item 2); old 30-second events remain valid. */
export const STUDY_HEARTBEAT_SEC = 60;
/** Inactivity after which the learner no longer counts as active (§2.10). */
export const IDLE_TIMEOUT_SEC = 120;

/** Half-open instant range [from, to), ISO strings. */
export interface TimeRange {
	from: string;
	to: string;
}
