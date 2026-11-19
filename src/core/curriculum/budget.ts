/**
 * Lexicographic expansion budget (docs/research/00-SINTESE.md §2.4(e)
 * "orçamento lexicográfico (budget.ts) [r10]: (prioridade do gatilho,
 * profundidade, custo estimado) + teto diário de tokens do domínio"; r10 §3.7
 * "a medida lexicográfica (B, |Q∖K|) decresce a cada evento"; r3 §7.1
 * scheduler com orçamento diário).
 *
 *   compareCandidates — total order: priority DESC, depth ASC (closer to the
 *                       learner first), estimated tokens ASC, key ASC.
 *   selectExpansions  — walks candidates in that order and admits each one
 *                       that fits every remaining ceiling (tokens/day,
 *                       expansions/day, live-item cap); the rest are deferred
 *                       with a reason. Background expansion disabled ⇒ only
 *                       explicit learner requests may run (the learner is
 *                       waiting on them).
 *   chargeExpansion   — books a finished expansion (rolling the day over).
 *   terminationMeasure / measureDecreases — the r10 §3.7 variant
 *                       (B, |Q∖K|): every expansion consumes budget, every
 *                       mastery shrinks |Q∖K|, so "expand + study" terminates.
 *
 * Pure and browser-safe.
 */

import type { TriggerRef } from "./types.ts";

export interface ExpansionCandidate {
	trigger: TriggerRef;
	/** Hops from the learner frontier (0 = on it); unknown → large. */
	depth: number;
	/** Estimated tokens of the whole expansion job (k samples + critic). */
	estTokens: number;
	/** Idempotency key (see ./triggers.ts triggerKey). */
	key: string;
}

export interface ExpansionBudgetLimits {
	/** DomainManifest.backgroundBudget.enabled. */
	enabled: boolean;
	tokensPerDay: number;
	expansionsPerDay: number;
	/** Live-item ceiling of the domain (N_max); omitted = no ceiling. */
	maxItems?: number;
	/** Items an expansion is assumed to add when checking maxItems (default 6, r3 "2–6 átomos"). */
	itemsPerExpansion?: number;
}

export interface ExpansionBudgetState {
	/** YYYY-MM-DD the counters refer to. */
	day: string;
	tokensUsed: number;
	expansions: number;
}

export type DeferReason = "disabled" | "tokens" | "expansions" | "items" | "duplicate";

export interface BudgetSelection {
	selected: ExpansionCandidate[];
	deferred: { candidate: ExpansionCandidate; reason: DeferReason }[];
	/** Budget left after the selected candidates. */
	remaining: { tokens: number; expansions: number };
}

/** Lexicographic order of expansion candidates (see header). */
export function compareCandidates(a: ExpansionCandidate, b: ExpansionCandidate): number {
	if (a.trigger.priority !== b.trigger.priority) return b.trigger.priority - a.trigger.priority;
	if (a.depth !== b.depth) return a.depth - b.depth;
	if (a.estTokens !== b.estTokens) return a.estTokens - b.estTokens;
	return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** Counters for `day` (fresh when the stored state belongs to another day). */
export function budgetForDay(state: ExpansionBudgetState | null | undefined, day: string): ExpansionBudgetState {
	return state && state.day === day ? { ...state } : { day, tokensUsed: 0, expansions: 0 };
}

/** Pick the candidates that fit today's budget, in lexicographic order. */
export function selectExpansions(
	candidates: readonly ExpansionCandidate[],
	state: ExpansionBudgetState | null | undefined,
	limits: ExpansionBudgetLimits,
	ctx: { day: string; liveItems: number },
): BudgetSelection {
	const today = budgetForDay(state, ctx.day);
	let tokens = Math.max(0, limits.tokensPerDay - today.tokensUsed);
	let expansions = Math.max(0, limits.expansionsPerDay - today.expansions);
	let items = ctx.liveItems;
	const perExpansion = limits.itemsPerExpansion ?? 6;
	const selected: ExpansionCandidate[] = [];
	const deferred: BudgetSelection["deferred"] = [];
	const seen = new Set<string>();
	for (const c of [...candidates].sort(compareCandidates)) {
		if (seen.has(c.key)) {
			deferred.push({ candidate: c, reason: "duplicate" });
			continue;
		}
		seen.add(c.key);
		if (!limits.enabled && c.trigger.kind !== "request") deferred.push({ candidate: c, reason: "disabled" });
		else if (expansions < 1) deferred.push({ candidate: c, reason: "expansions" });
		else if (c.estTokens > tokens) deferred.push({ candidate: c, reason: "tokens" });
		else if (limits.maxItems !== undefined && items + perExpansion > limits.maxItems) deferred.push({ candidate: c, reason: "items" });
		else {
			selected.push(c);
			tokens -= c.estTokens;
			expansions -= 1;
			items += perExpansion;
		}
	}
	return { selected, deferred, remaining: { tokens, expansions } };
}

/** Book a finished expansion against the day's counters. */
export function chargeExpansion(state: ExpansionBudgetState | null | undefined, day: string, tokens: number): ExpansionBudgetState {
	const today = budgetForDay(state, day);
	return { day, tokensUsed: today.tokensUsed + Math.max(0, tokens), expansions: today.expansions + 1 };
}

/** r10 §3.7 variant: (remaining expansion budget, unattained items). */
export function terminationMeasure(remainingBudget: number, unattained: number): readonly [number, number] {
	return [remainingBudget, unattained];
}

/** Strict lexicographic decrease of the variant. */
export function measureDecreases(before: readonly [number, number], after: readonly [number, number]): boolean {
	return after[0] < before[0] || (after[0] === before[0] && after[1] < before[1]);
}
