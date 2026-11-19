/**
 * Misconception beliefs and the weak score (r2 §9.10; SÍNTESE §2.6
 * "Catálogo de misconceptions por nó com posterior Beta").
 *
 *   prior Beta(1, 4) per (node, misconception);
 *   error tagged with the misconception        → a += c   (c = LLM blame);
 *   correct answer on an item that would reveal it (distractor) → b += 1;
 *   active   ⇔ a / (a + b) ≥ 0.5;
 *   resolved ⇔ a / (a + b) < 0.2 after it was observed at least once
 *              (a above the prior), i.e. after remediation.
 *   newMisconception text → a new entry with the prior, id derived from the
 *   normalized text (exact-text dedup; semantic dedup is the integration's).
 *
 * Weak score W_k = (1 − p_k·R_k)·I_k·(1 + |desc_blocked(k)|)
 *                 + Σ_m 1[active]·a_m/(a_m + b_m).
 */

import { fnv1a32 } from "./math.ts";
import { LEARNER_CONSTANTS } from "./params.ts";
import type { MisconceptionBelief, NodeState } from "./types.ts";

export type MisconceptionStatus = "active" | "resolved" | "dormant";

const M = LEARNER_CONSTANTS.misconception;

export function misconceptionMean(m: Pick<MisconceptionBelief, "a" | "b">): number {
	const total = m.a + m.b;
	return total > 0 ? m.a / total : 0;
}

export function misconceptionStatus(m: MisconceptionBelief): MisconceptionStatus {
	const mean = misconceptionMean(m);
	if (mean >= M.active) return "active";
	if (mean < M.resolved && m.a > M.priorA) return "resolved";
	return "dormant";
}

export function isActiveMisconception(m: MisconceptionBelief): boolean {
	return misconceptionStatus(m) === "active";
}

/** Normalized text key (case/accents/space-insensitive) for exact dedup. */
export function normalizeMisconceptionText(text: string): string {
	return text
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

/** Deterministic id for an LLM-proposed misconception text. */
export function misconceptionIdFor(text: string): string {
	return `mc.${fnv1a32(normalizeMisconceptionText(text)).toString(36)}`;
}

/** Find an existing entry with the same normalized text. */
export function findByText(state: NodeState, text: string): string | undefined {
	const key = normalizeMisconceptionText(text);
	for (const [id, m] of Object.entries(state.misconceptions)) {
		if (normalizeMisconceptionText(m.text) === key) return id;
	}
	return undefined;
}

function withBelief(state: NodeState, id: string, belief: MisconceptionBelief): NodeState {
	return { ...state, misconceptions: { ...state.misconceptions, [id]: belief } };
}

/** Error tagged with misconception `id` (created with the prior when unknown): a += c. */
export function observeMisconception(state: NodeState, id: string, c: number, at: string, text?: string): NodeState {
	const amount = Math.min(1, Math.max(0, c));
	const prev = state.misconceptions[id];
	const base: MisconceptionBelief = prev ?? { a: M.priorA, b: M.priorB, lastSeenAt: at, text: text ?? id };
	return withBelief(state, id, { ...base, a: base.a + amount, lastSeenAt: at, text: base.text || text || id });
}

/** A new LLM-proposed misconception: dedup by text, else create; then a += c. Returns the id used. */
export function proposeMisconception(state: NodeState, text: string, c: number, at: string): { state: NodeState; id: string } {
	const trimmed = text.trim();
	if (!trimmed) return { state, id: "" };
	const id = findByText(state, trimmed) ?? misconceptionIdFor(trimmed);
	return { state: observeMisconception(state, id, c, at, trimmed), id };
}

/** Correct answer on an item that would reveal `id`: b += 1 (unknown ids are ignored). */
export function refuteMisconception(state: NodeState, id: string, at: string): NodeState {
	const prev = state.misconceptions[id];
	if (!prev) return state;
	return withBelief(state, id, { ...prev, b: prev.b + 1, lastSeenAt: at });
}

/** Σ over active misconceptions of a/(a+b). */
export function activeMisconceptionMass(state: Pick<NodeState, "misconceptions">): number {
	let mass = 0;
	for (const m of Object.values(state.misconceptions)) if (isActiveMisconception(m)) mass += misconceptionMean(m);
	return mass;
}

/** Strongest active misconception (text), for the prompt snapshot. */
export function topActiveMisconception(state: Pick<NodeState, "misconceptions">): MisconceptionBelief | undefined {
	let best: MisconceptionBelief | undefined;
	for (const m of Object.values(state.misconceptions)) {
		if (!isActiveMisconception(m)) continue;
		if (!best || misconceptionMean(m) > misconceptionMean(best)) best = m;
	}
	return best;
}

/** r2 §9.10 weak score. */
export function weakScore(pKnowsNow: number, importance: number, blockedDescendants: number, state: Pick<NodeState, "misconceptions">): number {
	return (1 - pKnowsNow) * importance * (1 + Math.max(0, blockedDescendants)) + activeMisconceptionMass(state);
}
