/**
 * Propagation in the prerequisite DAG (r2 §9.6 a–c; SÍNTESE §2.6
 * "Propagação"; mathua §7 FIRe ledger; r10 §3.5).
 *
 * (a) Consistency projection (probabilistic KST). For a prerequisite edge
 *     a → b: p_b ≤ p_a + ε (ε = 0.05; the view has no edge strength, so
 *     ρ = 1). When v = p_b − p_a − ε > 0, the evidence-weighted L2 projection
 *     (n = nEff + 1)
 *         p_a += v·n_b/(n_a + n_b),   p_b −= v·n_a/(n_a + n_b)
 *     solves min n_a(x_a−p_a)² + n_b(x_b−p_b)² s.t. x_b − x_a = ε exactly.
 *     OR clauses: the constraint is applied edge-wise against the clause with
 *     the largest product Π p (r2's "max over clauses"), which reduces to the
 *     plain edge rule for single-clause nodes. Clauses are EXPANDED through
 *     containers (graph-view.ts `expandedClauses`): a unit-level prerequisite
 *     constrains b against the unit's leaves, and containers are never
 *     projected themselves (no learner state; a missing container would
 *     otherwise act as a phantom p = 0.15 dragging every dependent down).
 *     Local sweeps cover the h ≤ 3
 *     ball of the updated nodes; the global pass alternates topological and
 *     reverse sweeps until every violation is ≤ tol (then it is idempotent:
 *     a second application changes nothing, because only v > tol moves).
 *
 * (b) Implicit FIRe credit. w*_{nk} = max over paths n ⇝ k (≤ 3 hops) of the
 *     product of encompass weights, kept when ≥ 0.1. Non-primary Q-vector
 *     nodes join with weight q_k (r2 §9.5). Eligible target: card in Review,
 *     DUE now (SÍNTESE: "aplicado só quando o nó está vencido"), p_k ≥ 0.9,
 *     D_k ≤ 7, lapses_k ≤ 2 (speed proxy); source p_n ≥ 0.9. Credit is booked
 *     in integer micro-units (Micro = 1e6 = one repetition): raw =
 *     round(Micro·w), largest-remainder allocation under a per-attempt cap
 *     (3 repetitions, ties by id, order independent), then the per-target
 *     ledger cap MaxBank = 3 repetitions per epoch (epoch = real-review count).
 *     The applied credit interpolates the FSRS state (fsrs.ts) and is recorded
 *     as an `implicit-credit` LearnerEvent so replay is deterministic.
 *     Non-due targets receive nothing (fail-closed; no deferred bank).
 *
 * (c) Penalties. Failure in k shortens the due of every n encompassing k:
 *     due_n ← now + (1 − w*·b_k)(due_n − now) (S_n untouched). Downward blame
 *     comes from DINA / LLM attribution (dina.ts) and decays with a 14-day
 *     half-life; blame > 0.3 flags a probe.
 */

import { fireModeOf, LEARNER_CONSTANTS } from "./params.ts";
import { FSRS_STATE, interpolateCredit, isDueAt, shortenDue } from "./fsrs.ts";
import { expandedClauses, graphIndex, type LearnerGraphView } from "./graph-view.ts";
import { compareIds, daysBetween, halfLifeFactor } from "./math.ts";
import type { FireMode, FsrsMemory, LearnerParams, NodeId, NodeState } from "./types.ts";

// ─── (a) consistency projection ──────────────────────────────────────────────

export interface ProjectionValue {
	/** P(L). */
	p: number;
	/** Evidence weight n = nEff + 1. */
	n: number;
}

export interface ProjectionOptions {
	eps: number;
	/** Only edges with both endpoints inside the scope move (default: whole graph). */
	scope?: ReadonlySet<NodeId>;
	maxPasses: number;
	/** Violations ≤ tol are left alone (makes the converged result idempotent). */
	tolerance: number;
	/** Value assumed for ids missing from the map (materialized when moved). */
	fallback: ProjectionValue;
}

export interface ProjectionResult {
	changed: Set<NodeId>;
	passes: number;
	/** Largest remaining violation p_b − p_a − ε over constrained edges (≥ 0). */
	maxViolation: number;
}

/** The clause whose member product is maximal; null when the node is an entry (some clause empty) or has none. */
export function bestClause(clauses: readonly (readonly NodeId[])[], valueOf: (id: NodeId) => number): readonly NodeId[] | null {
	let best: readonly NodeId[] | null = null;
	let bestProduct = -1;
	for (const clause of clauses) {
		if (clause.length === 0) return null;
		let product = 1;
		for (const m of clause) product *= valueOf(m);
		if (product > bestProduct) {
			bestProduct = product;
			best = clause;
		}
	}
	return best;
}

/** The scope's ids in topological order (the whole order when unscoped). */
export function scopedOrder(graph: LearnerGraphView, scope?: ReadonlySet<NodeId>): readonly NodeId[] {
	if (!scope) return graph.ids;
	const pos = graphIndex(graph).pos;
	return [...scope].filter((id) => pos.has(id)).sort((a, b) => (pos.get(a) as number) - (pos.get(b) as number));
}

function sweep(
	values: Map<NodeId, ProjectionValue>,
	graph: LearnerGraphView,
	order: readonly NodeId[],
	opts: ProjectionOptions,
	changed: Set<NodeId>,
): number {
	let moves = 0;
	const get = (id: NodeId): ProjectionValue => values.get(id) ?? opts.fallback;
	for (const b of order) {
		const node = graph.nodes.get(b);
		if (!node || !node.isLeaf || node.clauses.length === 0) continue;
		const clause = bestClause(expandedClauses(graph, b), (id) => get(id).p);
		if (!clause) continue;
		for (const a of clause) {
			if (opts.scope && !opts.scope.has(a)) continue;
			const va = get(a);
			const vb = get(b);
			const v = vb.p - va.p - opts.eps;
			if (!(v > opts.tolerance)) continue;
			const total = va.n + vb.n;
			values.set(a, { p: Math.min(1, va.p + (v * vb.n) / total), n: va.n });
			values.set(b, { p: Math.max(0, vb.p - (v * va.n) / total), n: vb.n });
			changed.add(a);
			changed.add(b);
			moves++;
		}
	}
	return moves;
}

/** Largest violation over the (scoped) constraint system. */
export function maxConsistencyViolation(
	values: ReadonlyMap<NodeId, ProjectionValue>,
	graph: LearnerGraphView,
	eps: number,
	fallback: ProjectionValue,
	scope?: ReadonlySet<NodeId>,
): number {
	let worst = 0;
	const get = (id: NodeId): number => (values.get(id) ?? fallback).p;
	for (const b of scopedOrder(graph, scope)) {
		const node = graph.nodes.get(b);
		if (!node || !node.isLeaf) continue;
		const clause = bestClause(expandedClauses(graph, b), get);
		if (!clause) continue;
		for (const a of clause) {
			if (scope && !scope.has(a)) continue;
			worst = Math.max(worst, get(b) - get(a) - eps);
		}
	}
	return worst;
}

/** Alternating projection sweeps (topological, then reverse) until nothing moves or maxPasses. */
export function projectConsistency(values: Map<NodeId, ProjectionValue>, graph: LearnerGraphView, opts: ProjectionOptions): ProjectionResult {
	const changed = new Set<NodeId>();
	const forward = scopedOrder(graph, opts.scope);
	const backward = [...forward].reverse();
	let passes = 0;
	while (passes < opts.maxPasses) {
		const order = passes % 2 === 0 ? forward : backward;
		passes++;
		if (sweep(values, graph, order, opts, changed) === 0) break;
	}
	return { changed, passes, maxViolation: Math.max(0, maxConsistencyViolation(values, graph, opts.eps, opts.fallback, opts.scope)) };
}

/**
 * Undirected h-hop ball over the clause graph (prerequisites ∪ dependents).
 * Containers are traversed for free (they are milestones, not learning
 * steps), so a leaf behind a unit-level prerequisite is as close as a direct
 * prerequisite — matching the expanded clauses the projection uses.
 */
export function neighborhood(graph: LearnerGraphView, seeds: Iterable<NodeId>, hops: number): Set<NodeId> {
	const index = graphIndex(graph);
	const seen = new Set<NodeId>();
	let layer: NodeId[] = [];
	for (const s of seeds) {
		if (!graph.nodes.has(s) || seen.has(s)) continue;
		seen.add(s);
		layer.push(s);
	}
	for (let h = 0; h < hops && layer.length > 0; h++) {
		const next: NodeId[] = [];
		for (let i = 0; i < layer.length; i++) {
			const id = layer[i] as NodeId;
			for (const nb of [...(index.prereqs.get(id) ?? []), ...(index.dependents.get(id) ?? [])]) {
				if (seen.has(nb)) continue;
				seen.add(nb);
				if (graph.nodes.get(nb)?.isLeaf === false) layer.push(nb);
				else next.push(nb);
			}
		}
		layer = next;
	}
	return seen;
}

// ─── (b) FIRe weights, allocation, ledger ────────────────────────────────────

type EdgeLookup = (id: NodeId) => readonly { id: NodeId; w: number }[];

function boundedMaxProduct(start: NodeId, edges: EdgeLookup, hops: number, minWeight: number): Map<NodeId, number> {
	let best = new Map<NodeId, number>([[start, 1]]);
	for (let h = 0; h < hops; h++) {
		const next = new Map(best);
		for (const [from, wFrom] of best) {
			for (const e of edges(from)) {
				if (e.id === start) continue;
				const cand = wFrom * e.w;
				if (cand > (next.get(e.id) ?? 0)) next.set(e.id, cand);
			}
		}
		best = next;
	}
	best.delete(start);
	for (const [id, w] of best) if (w < minWeight) best.delete(id);
	return best;
}

/** w*_{nk}: max over ≤ hops paths of the product of encompass weights (k encompassed by n). */
export function encompassWeights(graph: LearnerGraphView, n: NodeId, hops: number, minWeight: number): Map<NodeId, number> {
	return boundedMaxProduct(n, (id) => graph.nodes.get(id)?.encompasses ?? [], hops, minWeight);
}

/** Reverse w*: nodes n whose practice implicitly reviews k (for upward penalties and planner vehicles). */
export function encompassingWeights(graph: LearnerGraphView, k: NodeId, hops: number, minWeight: number): Map<NodeId, number> {
	const index = graphIndex(graph);
	return boundedMaxProduct(k, (id) => index.encompassedBy.get(id) ?? [], hops, minWeight);
}

export class FireLedgerError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "FireLedgerError";
	}
}

export interface CreditCandidate {
	nodeId: NodeId;
	rawUnits: number;
}

/**
 * Largest-remainder allocation of integer credit under a cap (mathua §7.1,
 * §14.2): pass-through when Σraw ≤ cap, else proportional floors plus one
 * unit to the largest remainders (ties by id). Output sorted by id; the
 * result does not depend on the input order.
 */
export function allocateCredit(candidates: readonly CreditCandidate[], cap: number): { nodeId: NodeId; units: number }[] {
	const { micro, maxCandidates } = LEARNER_CONSTANTS.fire;
	if (!Number.isSafeInteger(cap) || cap < 0) throw new FireLedgerError(`cap inválido: ${cap}`);
	if (candidates.length > maxCandidates) throw new FireLedgerError(`Candidatos demais: ${candidates.length} > ${maxCandidates}`);
	const ids = new Set<NodeId>();
	for (const c of candidates) {
		if (!Number.isSafeInteger(c.rawUnits) || c.rawUnits < 0 || c.rawUnits > micro) throw new FireLedgerError(`rawUnits inválido para ${c.nodeId}: ${c.rawUnits}`);
		if (ids.has(c.nodeId)) throw new FireLedgerError(`Candidato duplicado: ${c.nodeId}`);
		ids.add(c.nodeId);
	}
	const total = candidates.reduce((s, c) => s + c.rawUnits, 0);
	if (cap === 0 || total === 0) return [];
	const byId = [...candidates].sort((x, y) => compareIds(x.nodeId, y.nodeId));
	if (total <= cap) return byId.filter((c) => c.rawUnits > 0).map((c) => ({ nodeId: c.nodeId, units: c.rawUnits }));
	const shares = byId.map((c) => {
		const product = c.rawUnits * cap;
		return { nodeId: c.nodeId, units: Math.floor(product / total), rem: product % total };
	});
	let left = cap - shares.reduce((s, x) => s + x.units, 0);
	const byRemainder = [...shares].sort((x, y) => y.rem - x.rem || compareIds(x.nodeId, y.nodeId));
	for (let i = 0; i < byRemainder.length && left > 0; i++, left--) (byRemainder[i] as { units: number }).units++;
	return shares.filter((s) => s.units > 0).map(({ nodeId, units }) => ({ nodeId, units }));
}

/** Units already applied in the current epoch (0 after a real review). */
export function ledgerUnits(state: NodeState): number {
	if (!state.fsrs || !state.fire || state.fire.epoch !== state.fsrs.reps) return 0;
	return state.fire.units;
}

/** Remaining ledger capacity in micro-units. */
export function ledgerCapacity(state: NodeState): number {
	const { micro, maxBank } = LEARNER_CONSTANTS.fire;
	return Math.max(0, maxBank * micro - ledgerUnits(state));
}

/** r2 §9.6b target eligibility (card in Review, due, p ≥ 0.9, D ≤ 7, lapses ≤ 2, capacity left). */
export function isCreditEligible(state: NodeState | undefined, at: string): state is NodeState & { fsrs: FsrsMemory } {
	const f = LEARNER_CONSTANTS.fire;
	if (!state?.fsrs) return false;
	const mem = state.fsrs;
	return (
		mem.state === FSRS_STATE.review &&
		isDueAt(mem, at) &&
		state.pL >= f.minTargetP &&
		mem.difficulty <= f.maxTargetDifficulty &&
		mem.lapses <= f.maxTargetLapses &&
		ledgerCapacity(state) > 0
	);
}

export interface CreditRecord {
	fromNodeId: NodeId;
	toNodeId: NodeId;
	/** Applied micro-units (integer, > 0). */
	units: number;
	/** units / Micro. */
	w: number;
}

export interface CreditDerivation {
	mode: FireMode;
	/** Credits to apply (and record) — empty unless mode is "active". */
	credits: CreditRecord[];
	/** Credits computed in "shadow" mode (audit only, never applied). */
	shadow: CreditRecord[];
}

export interface CreditSource {
	/** Primary node that received the real review. */
	nodeId: NodeId;
	/** Its P(L) after the update. */
	pL: number;
	/** Non-primary Q-vector nodes (weight q). */
	coNodes: readonly { nodeId: NodeId; q: number }[];
	success: boolean;
}

/**
 * Derive the implicit credits of one successful attempt (r2 §9.6b). Pure:
 * reads node states through `stateOf`, never mutates.
 */
export function deriveCredits(
	source: CreditSource,
	stateOf: (id: NodeId) => NodeState | undefined,
	graph: LearnerGraphView,
	params: LearnerParams,
	at: string,
): CreditDerivation {
	const mode = fireModeOf(params);
	const empty: CreditDerivation = { mode, credits: [], shadow: [] };
	const f = LEARNER_CONSTANTS.fire;
	if (mode === "off" || !source.success || source.pL < f.minSourceP || !graph.nodes.has(source.nodeId)) return empty;
	const weights = encompassWeights(graph, source.nodeId, params.propagationHops, params.fireMinWeight);
	for (const co of source.coNodes) {
		if (co.nodeId === source.nodeId || !graph.nodes.has(co.nodeId)) continue;
		weights.set(co.nodeId, Math.max(weights.get(co.nodeId) ?? 0, Math.min(1, Math.max(0, co.q))));
	}
	const candidates: CreditCandidate[] = [];
	for (const [id, w] of weights) {
		if (!isCreditEligible(stateOf(id), at)) continue;
		const rawUnits = Math.round(f.micro * w);
		if (rawUnits > 0) candidates.push({ nodeId: id, rawUnits });
	}
	const allocated = allocateCredit(candidates, f.attemptCapReps * f.micro);
	const records: CreditRecord[] = [];
	for (const a of allocated) {
		const state = stateOf(a.nodeId);
		const units = Math.min(a.units, state ? ledgerCapacity(state) : 0);
		if (units > 0) records.push({ fromNodeId: source.nodeId, toNodeId: a.nodeId, units, w: units / f.micro });
	}
	return mode === "active" ? { mode, credits: records, shadow: [] } : { mode, credits: [], shadow: records };
}

/**
 * Apply one implicit credit to a node state (fail-closed: no card, not in
 * Review or no capacity → unchanged). Re-checks the ledger cap so a replayed
 * log can never exceed MaxBank.
 */
export function applyCredit(state: NodeState, w: number, at: string, params: LearnerParams): NodeState {
	const { micro } = LEARNER_CONSTANTS.fire;
	const mem = state.fsrs;
	if (!mem || mem.state !== FSRS_STATE.review) return state;
	const requested = Math.round(Math.min(1, Math.max(0, w)) * micro);
	const applied = Math.min(requested, ledgerCapacity(state));
	if (applied <= 0) return state;
	return {
		...state,
		fsrs: interpolateCredit(mem, applied / micro, at, state.desiredRetention, params),
		fire: { epoch: mem.reps, units: ledgerUnits(state) + applied },
	};
}

// ─── (c) penalties and blame ─────────────────────────────────────────────────

/** Blame mass decayed to `at` (half-life in days). */
export function decayedBlame(state: Pick<NodeState, "blame" | "blameAt">, at: string, halfLifeDays: number): number {
	if (!(state.blame > 0)) return 0;
	if (!state.blameAt) return state.blame;
	return state.blame * halfLifeFactor(daysBetween(state.blameAt, at), halfLifeDays);
}

/** Add fresh blame on top of the decayed mass. */
export function addBlame(state: NodeState, amount: number, at: string, halfLifeDays: number): NodeState {
	if (!(amount > 0)) return state;
	return { ...state, blame: decayedBlame(state, at, halfLifeDays) + amount, blameAt: at };
}

/** Upward penalty factor list: (n, 1 − w*·b_k) for every n encompassing the failed k. */
export function upwardPenalties(graph: LearnerGraphView, k: NodeId, blameK: number, params: LearnerParams): { nodeId: NodeId; factor: number }[] {
	if (!(blameK > 0)) return [];
	const out: { nodeId: NodeId; factor: number }[] = [];
	for (const [n, w] of encompassingWeights(graph, k, params.propagationHops, params.fireMinWeight)) {
		out.push({ nodeId: n, factor: Math.max(0, 1 - w * Math.min(1, blameK)) });
	}
	return out.sort((a, b) => compareIds(a.nodeId, b.nodeId));
}

/** Apply a due-shortening factor to a node's card (no card or past due → unchanged). */
export function penalizeDue(state: NodeState, factor: number, at: string): NodeState {
	if (!state.fsrs || factor >= 1) return state;
	const next = shortenDue(state.fsrs, factor, at);
	return next === state.fsrs ? state : { ...state, fsrs: next };
}
