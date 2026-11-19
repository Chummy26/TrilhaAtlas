/**
 * Bitemporal supersession (r4 §7.4 notes, §7.6.2-4, §7.6.5-1/2, §7.11
 * invariants 1–2; Graphiti/Zep bitemporal model; L4).
 *
 * Two time lines per fact:
 *   world  (T)  valid_from / valid_to   — when it was/is true for the learner
 *   system (T') recorded_at / expired_at — when memory learned / retired it
 *
 * NOTHING IS OVERWRITTEN. Supersession only CLOSES the old fact
 * (valid_to, expired_at, superseded_by) and links it to its successor; the
 * text, quote and sources of the old fact stay untouched, so `historical`
 * recall can still show "o aluno tratava 20 mA como 20 A (superado em …)".
 *
 *   DUPLICATE            → keep the old fact, proof_count += new, sources ∪; the new one is not stored
 *   UPDATES/CONTRADICTS  → old.valid_to = clamp(new.valid_from ?? now), old.expired_at = now,
 *                          old.superseded_by = new.id, edge `supersedes`
 *   REFINES              → keep both, edge `refines` (new → old)
 *   INDEPENDENT          → nothing
 *
 * Only a CURRENT fact can be superseded, which keeps `superseded_by` a
 * function (≤ 1 successor) and the supersession graph a forest.
 */

import { MemoryError, type FactKind, type SupersedeVerdict } from "./types.ts";

export type FactStatus = "active" | "archived" | "forgotten";

export interface BitemporalFact {
	id: string;
	kind: FactKind;
	validFrom: number | null;
	validTo: number | null;
	recordedAt: number;
	expiredAt: number | null;
	supersededBy: string | null;
	status: FactStatus;
	proofCount: number;
	sourceMsgIds: readonly string[];
}

/** r4 §7.4: expired_at IS NULL AND (valid_to IS NULL OR valid_to > now) AND status = 'active'. */
export function isCurrentFact(f: Pick<BitemporalFact, "expiredAt" | "validTo" | "status">, now: number): boolean {
	return f.status === "active" && f.expiredAt === null && (f.validTo === null || f.validTo > now);
}

/** Interval well-formedness (invariant 1). Empty array = well-formed. */
export function intervalIssues(f: Pick<BitemporalFact, "id" | "validFrom" | "validTo" | "recordedAt" | "expiredAt">): string[] {
	const issues: string[] = [];
	if (f.validFrom !== null && f.validTo !== null && f.validFrom > f.validTo) {
		issues.push(`${f.id}: valid_from (${f.validFrom}) > valid_to (${f.validTo})`);
	}
	if (f.expiredAt !== null && f.recordedAt > f.expiredAt) {
		issues.push(`${f.id}: recorded_at (${f.recordedAt}) > expired_at (${f.expiredAt})`);
	}
	return issues;
}

export type SupersedeEffect =
	| { type: "duplicate"; keepId: string; proofCount: number; sourceMsgIds: string[] }
	| { type: "close"; closeId: string; validTo: number; expiredAt: number; supersededBy: string }
	| { type: "refine"; srcId: string; dstId: string }
	| { type: "independent" };

function union(a: readonly string[], b: readonly string[]): string[] {
	return [...new Set([...a, ...b])];
}

/**
 * valid_to for a superseded fact: the successor's start, never later than an
 * already-known end, never before the old fact's own start (invariant 1).
 */
export function closingValidTo(old: Pick<BitemporalFact, "validFrom" | "validTo">, successorFrom: number): number {
	const end = old.validTo === null ? successorFrom : Math.min(old.validTo, successorFrom);
	return old.validFrom === null ? end : Math.max(old.validFrom, end);
}

/** Translate a judge verdict on (old, new) into the effect to persist. */
export function resolveSupersession(
	oldFact: BitemporalFact,
	newFact: Pick<BitemporalFact, "id" | "validFrom" | "proofCount" | "sourceMsgIds">,
	verdict: SupersedeVerdict,
	now: number,
): SupersedeEffect {
	if (oldFact.id === newFact.id) throw new MemoryError("invalid-input", `um fato não pode superar a si mesmo (${oldFact.id})`);
	if (!isCurrentFact(oldFact, now)) return { type: "independent" };
	switch (verdict) {
		case "DUPLICATE":
			return {
				type: "duplicate",
				keepId: oldFact.id,
				proofCount: oldFact.proofCount + Math.max(1, newFact.proofCount),
				sourceMsgIds: union(oldFact.sourceMsgIds, newFact.sourceMsgIds),
			};
		case "UPDATES":
		case "CONTRADICTS":
			return {
				type: "close",
				closeId: oldFact.id,
				validTo: closingValidTo(oldFact, newFact.validFrom ?? now),
				expiredAt: Math.max(now, oldFact.recordedAt),
				supersededBy: newFact.id,
			};
		case "REFINES":
			return { type: "refine", srcId: newFact.id, dstId: oldFact.id };
		case "INDEPENDENT":
			return { type: "independent" };
	}
}

export interface DuplicateMerge {
	winner: { id: string; proofCount: number; sourceMsgIds: string[] };
	loser: { id: string; expiredAt: number; supersededBy: string };
}

/**
 * Consolidation dedup (r4 §7.6.5-2): the loser is retired from the system
 * timeline (expired_at + superseded_by); its world validity is unchanged,
 * because a duplicate does not make the statement false.
 */
export function mergeDuplicateFacts(winner: BitemporalFact, loser: BitemporalFact, now: number): DuplicateMerge {
	if (winner.id === loser.id) throw new MemoryError("invalid-input", `fusão de um fato consigo mesmo (${winner.id})`);
	if (winner.kind !== loser.kind) throw new MemoryError("invalid-input", `fusão entre tipos diferentes (${winner.kind} × ${loser.kind})`);
	return {
		winner: { id: winner.id, proofCount: winner.proofCount + loser.proofCount, sourceMsgIds: union(winner.sourceMsgIds, loser.sourceMsgIds) },
		loser: { id: loser.id, expiredAt: Math.max(now, loser.recordedAt), supersededBy: winner.id },
	};
}

/** Older recorded first, then lower id: the deterministic dedup winner. */
export function compareForWinner(a: BitemporalFact, b: BitemporalFact): number {
	return a.recordedAt - b.recordedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export interface SupersessionCandidate {
	fact: BitemporalFact;
	cosine: number;
	nodeIds: readonly string[];
	entityKeys: readonly string[];
}

/**
 * r4 §7.6.2-4: current facts of the same kind that share a node or an entity
 * with the new fact (or neither side has any anchor) and have cos ≥ minCosine;
 * best `topK` by cosine (ties: id).
 */
export function pickSupersessionCandidates(
	newFact: { id: string; kind: FactKind; nodeIds: readonly string[]; entityKeys: readonly string[] },
	candidates: readonly SupersessionCandidate[],
	options: { minCosine: number; topK: number; now: number },
): SupersessionCandidate[] {
	const nodes = new Set(newFact.nodeIds);
	const ents = new Set(newFact.entityKeys);
	const anchored = nodes.size > 0 || ents.size > 0;
	return candidates
		.filter((c) => {
			if (c.fact.id === newFact.id || c.fact.kind !== newFact.kind) return false;
			if (!isCurrentFact(c.fact, options.now) || !(c.cosine >= options.minCosine)) return false;
			const candidateAnchored = c.nodeIds.length > 0 || c.entityKeys.length > 0;
			if (!anchored && !candidateAnchored) return true;
			return c.nodeIds.some((n) => nodes.has(n)) || c.entityKeys.some((e) => ents.has(e));
		})
		.sort((a, b) => b.cosine - a.cosine || (a.fact.id < b.fact.id ? -1 : a.fact.id > b.fact.id ? 1 : 0))
		.slice(0, options.topK);
}

/**
 * Invariants 1–2 of r4 §7.11 over a set of facts: well-formed intervals,
 * successors exist, no self-loop, no cycle, every superseded fact is expired.
 * Returns human-readable violations (empty = consistent).
 */
export function checkSupersessionInvariants(facts: readonly BitemporalFact[]): string[] {
	const byId = new Map(facts.map((f) => [f.id, f]));
	const issues: string[] = [];
	for (const f of facts) {
		issues.push(...intervalIssues(f));
		if (f.supersededBy === null) continue;
		if (f.supersededBy === f.id) issues.push(`${f.id}: superseded_by aponta para si mesmo`);
		else if (!byId.has(f.supersededBy)) issues.push(`${f.id}: superseded_by aponta para fato inexistente ${f.supersededBy}`);
		if (f.expiredAt === null) issues.push(`${f.id}: superado sem expired_at`);
	}
	const state = new Map<string, 1 | 2>();
	for (const start of facts) {
		const path: string[] = [];
		let cur: BitemporalFact | undefined = start;
		while (cur && state.get(cur.id) !== 2) {
			if (state.get(cur.id) === 1) {
				issues.push(`ciclo de supersessão: ${[...path, cur.id].join(" → ")}`);
				break;
			}
			state.set(cur.id, 1);
			path.push(cur.id);
			cur = cur.supersededBy ? byId.get(cur.supersededBy) : undefined;
		}
		for (const id of path) state.set(id, 2);
	}
	return issues;
}
