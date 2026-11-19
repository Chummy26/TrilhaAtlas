/**
 * Per-node status and the three UI axes Estimated / Retained / Demonstrated
 * (r2 §9.8; SÍNTESE §2.6 state table; tutor-mcp §6.9 evidence ladder), plus
 * the graph metrics shared by the planner and the prompt snapshot
 * (importance I_k, descendants, unlock value U — r2 §9.9).
 *
 * Status (one per node, first match wins):
 *   containers: attained/mastered when the milestone is reached, learning
 *               when some child is started, else locked;
 *   not in A  : learning (unlocked and pL ≥ 0.3, or weak) · frontier
 *               (unlocked) · locked;
 *   in A      : weak (decayed blame ≥ 0.3 or an active misconception) ·
 *               inferred (placed/implied, no direct evidence) · review_due
 *               (card due or R < r_role) · mastered (masteredAt) · attained.
 * A is the MONOTONIC structural set of kst.ts, so a failure can move a node
 * to weak/review_due but never back to locked/frontier/learning (regression
 * of the tutor-mcp hysteresis bug).
 *
 * Axes: estimated = pL ≥ 0.85 now; retained = reviewed card with R ≥ 0.7;
 * retentionVerified = ≥ 1 delayed hint-free success; demonstrated =
 * summative checkpoint passed (independent of estimated, tutor-mcp §9.4).
 *
 * Metrics: I_k = 1 + α·goal_k + β·ln(1 + |desc(k)|) (exact descendant
 * counts by bitsets up to 4096 nodes, else a path-count bound capped at N);
 * U_j = Σ_{c ∈ dependents(j)} γ·(goal_c + U_c)/indeg(c) by reverse DP.
 */

import { FSRS_STATE, retrievability } from "./fsrs.ts";
import { expandedClauses, graphIndex, type LearnerGraphView } from "./graph-view.ts";
import { clauseSatisfied, crispState, desiredRetentionFor, structuralState, type StructuralState } from "./kst.ts";
import { toMs } from "./math.ts";
import { activeMisconceptionMass, topActiveMisconception, weakScore } from "./misconceptions.ts";
import { LEARNER_CONSTANTS } from "./params.ts";
import { decayedBlame } from "./propagate.ts";
import type { LearnerParams, LearnerSnapshot, NodeId, NodeState, NodeStatus } from "./types.ts";

/** pL at which an unlocked node counts as "learning" (r2 §9.8). */
export const LEARNING_MIN_P = 0.3;

// ─── graph metrics (memoized per view) ───────────────────────────────────────

const descCache = new WeakMap<LearnerGraphView, ReadonlyMap<NodeId, number>>();
const EXACT_DESC_LIMIT = 4096;

/** |desc(k)|: number of transitive dependents (exact up to 4096 nodes). */
export function descendantCounts(graph: LearnerGraphView): ReadonlyMap<NodeId, number> {
	const cached = descCache.get(graph);
	if (cached) return cached;
	const index = graphIndex(graph);
	const n = graph.ids.length;
	const counts = new Map<NodeId, number>();
	if (n <= EXACT_DESC_LIMIT) {
		const words = Math.max(1, Math.ceil(n / 32));
		const sets = new Map<NodeId, Uint32Array>();
		for (let i = n - 1; i >= 0; i--) {
			const id = graph.ids[i] as NodeId;
			const set = new Uint32Array(words);
			for (const d of index.dependents.get(id) ?? []) {
				const di = index.pos.get(d) as number;
				set[di >>> 5] = (set[di >>> 5] as number) | (1 << (di & 31));
				const sub = sets.get(d) as Uint32Array;
				for (let w = 0; w < words; w++) set[w] = (set[w] as number) | (sub[w] as number);
			}
			sets.set(id, set);
			let c = 0;
			for (let w = 0; w < words; w++) c += popcount(set[w] as number);
			counts.set(id, c);
		}
	} else {
		for (let i = n - 1; i >= 0; i--) {
			const id = graph.ids[i] as NodeId;
			let c = 0;
			for (const d of index.dependents.get(id) ?? []) c += 1 + (counts.get(d) ?? 0);
			counts.set(id, Math.min(c, n - 1));
		}
	}
	descCache.set(graph, counts);
	return counts;
}

function popcount(x: number): number {
	let v = x - ((x >>> 1) & 0x55555555);
	v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
	return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function importanceOf(graph: LearnerGraphView, id: NodeId, params: LearnerParams): number {
	const node = graph.nodes.get(id);
	const desc = descendantCounts(graph).get(id) ?? 0;
	return 1 + params.planner.alphaGoal * (node?.goalWeight ?? 0) + params.planner.betaDesc * Math.log(1 + desc);
}

const unlockCache = new WeakMap<LearnerGraphView, Map<number, ReadonlyMap<NodeId, number>>>();

/** U_j by reverse-topological DP (r2 §9.9). */
export function unlockValues(graph: LearnerGraphView, gamma: number): ReadonlyMap<NodeId, number> {
	let perGamma = unlockCache.get(graph);
	if (!perGamma) unlockCache.set(graph, (perGamma = new Map()));
	const cached = perGamma.get(gamma);
	if (cached) return cached;
	const index = graphIndex(graph);
	const U = new Map<NodeId, number>();
	for (let i = graph.ids.length - 1; i >= 0; i--) {
		const id = graph.ids[i] as NodeId;
		let u = 0;
		for (const c of index.dependents.get(id) ?? []) {
			const indeg = Math.max(1, index.prereqs.get(c)?.length ?? 1);
			u += (gamma * ((graph.nodes.get(c)?.goalWeight ?? 0) + (U.get(c) ?? 0))) / indeg;
		}
		U.set(id, u);
	}
	perGamma.set(gamma, U);
	return U;
}

/** Non-attained descendants of id (BFS, capped). */
export function blockedDescendants(graph: LearnerGraphView, id: NodeId, known: ReadonlySet<NodeId>, cap = 2000): number {
	const index = graphIndex(graph);
	const seen = new Set<NodeId>([id]);
	const stack = [...(index.dependents.get(id) ?? [])];
	let count = 0;
	while (stack.length > 0 && count < cap) {
		const d = stack.pop() as NodeId;
		if (seen.has(d)) continue;
		seen.add(d);
		if (!known.has(d)) count++;
		for (const next of index.dependents.get(d) ?? []) stack.push(next);
	}
	return count;
}

// ─── signals ─────────────────────────────────────────────────────────────────

export interface NodeSignal {
	nodeId: NodeId;
	status: NodeStatus;
	/** In the monotonic structural set A. */
	attained: boolean;
	mastered: boolean;
	estimated: boolean;
	retained: boolean;
	retentionVerified: boolean;
	demonstrated: boolean;
	/** Clause satisfied by A (structurally available). */
	unlocked: boolean;
	pL: number;
	/** FSRS R now (1 without a reviewed card). */
	R: number;
	pKnowsNow: number;
	/** max over the EXPANDED clauses (containers looked through) of Π p·R of the members (1 for entry items). */
	readiness: number;
	/** Role-based desired retention (0.93 / 0.90 / 0.85). */
	retention: number;
	reviewDue: boolean;
	dueAt?: string;
	blame: number;
	misconceptionMass: number;
	/** Text of the strongest active misconception. */
	misconception?: string;
	importance: number;
	weakScore: number;
}

export interface SignalsResult {
	at: string;
	structure: StructuralState;
	/** K* (crisp mastered state). */
	crisp: Set<NodeId>;
	signals: Map<NodeId, NodeSignal>;
}

/** pL·R of a node (prior values when it has no state). */
export function knowsNow(state: NodeState | undefined, at: string, params: LearnerParams): number {
	if (!state) return LEARNER_CONSTANTS.priorP;
	return state.pL * retrievability(state.fsrs, at, params);
}

/** Readiness_j = max over clauses of Π_{a ∈ C} p_a·R_a (r2 §9.9 with OR clauses). */
export function readinessOf(clauses: readonly (readonly NodeId[])[], pr: (id: NodeId) => number): number {
	if (clauses.length === 0) return 1;
	let best = 0;
	for (const clause of clauses) {
		let product = 1;
		for (const m of clause) product *= pr(m);
		best = Math.max(best, product);
	}
	return best;
}

/** Card due now: reviewed card with dueAt ≤ at or R < the role retention. */
export function isReviewDue(state: NodeState | undefined, at: string, retention: number, R: number): boolean {
	const mem = state?.fsrs;
	if (!mem || mem.state === FSRS_STATE.new || !mem.lastReviewAt) return false;
	return toMs(mem.dueAt) <= toMs(at) || R < retention;
}

function statusOf(
	graph: LearnerGraphView,
	id: NodeId,
	sig: Omit<NodeSignal, "status">,
	state: NodeState | undefined,
	started: (id: NodeId) => boolean,
	isWeak: boolean,
): NodeStatus {
	const node = graph.nodes.get(id);
	if (node && !node.isLeaf) {
		if (sig.attained) return sig.mastered ? "mastered" : "attained";
		return node.children.some(started) ? "learning" : "locked";
	}
	if (!sig.attained) {
		if (!sig.unlocked) return "locked";
		if (isWeak && state?.verified) return "weak";
		return sig.pL >= LEARNING_MIN_P && (state?.verified || state?.lastEvidenceAt) ? "learning" : "frontier";
	}
	if (isWeak) return "weak";
	if (!state?.attainedAt && !state?.verified) return "inferred";
	if (sig.reviewDue) return "review_due";
	return sig.mastered ? "mastered" : "attained";
}

/** All per-node signals at `at` (one O(N + E) pass plus the structural closure). */
export function computeSignals(snapshot: LearnerSnapshot, graph: LearnerGraphView, params: LearnerParams, at: string): SignalsResult {
	const structure = structuralState(snapshot, graph);
	const crisp = crispState(snapshot, graph);
	const isKnown = (id: NodeId) => structure.known.has(id);
	const started = (id: NodeId) => structure.known.has(id) || !!snapshot.nodes[id]?.lastEvidenceAt;
	const prCache = new Map<NodeId, number>();
	const pr = (id: NodeId): number => {
		let v = prCache.get(id);
		if (v === undefined) prCache.set(id, (v = knowsNow(snapshot.nodes[id], at, params)));
		return v;
	};
	const signals = new Map<NodeId, NodeSignal>();
	for (const id of graph.ids) {
		const node = graph.nodes.get(id);
		if (!node) continue;
		const state = snapshot.nodes[id];
		const R = retrievability(state?.fsrs, at, params);
		const pL = state?.pL ?? LEARNER_CONSTANTS.priorP;
		const retention = desiredRetentionFor(graph, id, isKnown, params);
		const blame = state ? decayedBlame(state, at, params.blameHalfLifeDays) : 0;
		const misconceptionMass = state ? activeMisconceptionMass(state) : 0;
		const attained = structure.known.has(id);
		const importance = importanceOf(graph, id, params);
		const isWeak = !!state && (blame >= LEARNER_CONSTANTS.probeBlame || misconceptionMass > 0);
		const top = state ? topActiveMisconception(state) : undefined;
		const base: Omit<NodeSignal, "status"> = {
			nodeId: id,
			attained,
			mastered: !!state?.masteredAt || (!node.isLeaf && crisp.has(id)),
			estimated: pL >= params.attainThreshold,
			retained: !!state?.fsrs && state.fsrs.state !== FSRS_STATE.new && R >= params.retainedR,
			retentionVerified: (state?.delayedSuccesses ?? 0) >= LEARNER_CONSTANTS.masteryDelayed,
			demonstrated: !!state?.demonstratedAt,
			unlocked: clauseSatisfied(node.clauses, isKnown),
			pL,
			R,
			pKnowsNow: pL * R,
			// Through containers: a unit prerequisite is ready when its leaves are (no phantom p = 0.15).
			readiness: readinessOf(expandedClauses(graph, id), pr),
			retention,
			reviewDue: isReviewDue(state, at, retention, R),
			blame,
			misconceptionMass,
			importance,
			weakScore: state ? weakScore(pL * R, importance, isWeak ? blockedDescendants(graph, id, structure.known) : 0, state) : 0,
			...(state?.fsrs ? { dueAt: state.fsrs.dueAt } : {}),
			...(top ? { misconception: top.text } : {}),
		};
		signals.set(id, { ...base, status: statusOf(graph, id, base, state, started, isWeak) });
	}
	return { at, structure, crisp, signals };
}
