/**
 * Knowledge Space Theory over the EFFECTIVE clause system (r2 §9.7–9.8;
 * r10 §3.3–3.5; SÍNTESE §2.6 "Estrutura KST").
 *
 * Feasible K ⇔ every q ∈ K has a clause C ⊆ K (`[]` or an empty clause = entry).
 * Because the view's `ids` are a topological order (R2 rank), the INTERIOR of
 * X (largest feasible subset, r10 §3.4) is ONE forward pass, and:
 *   outer fringe  K^O = {q ∉ K : ∃C ∈ cl q, C ⊆ K}       (r10 (e))
 *   inner fringe  K^I = {k ∈ K : K∖{k} feasible}
 *
 * Structural state used for UNLOCKING (monotonic, r10 §3.5): A = least fixed
 * point of implicit credit over
 *   raw = {attainedAt} ∪ {placedAt (diagnostic placement)},
 *   m*(u) = max(raw(u), α·max{m*(v) : u mandatory in v})   (α = 1 for unlocking)
 * where "mandatory in v" = u belongs to EVERY clause of v (E/OU: only then is
 * credit guaranteed), computed in one reverse-topological pass; then
 * containers (milestones, clause [[children]]) join A when their clause is
 * inside A. The frontier is the outer fringe of A restricted to leaves.
 * Failures never shrink A (attainedAt/placedAt are monotonic).
 *
 * Crisp mastered state K* (r2 §9.8 / SÍNTESE: "núcleo K*") =
 * interior(lfp-closure({masteredAt})). Its inner fringe is "você domina (topo)".
 *
 * Particle-filter diagnostic (r2 §9.7): M particles, each a FEASIBLE state
 * (bitset over ids, containers canonical). Generation: θ ~ N(0,1), node passes
 * when θ + ε > b (ε ~ N(0, 0.5), b = standardized depth), then interior.
 * Question = skeleton node minimizing |2P̂ − 1| (half-split). BLIM update:
 * q ∈ K: correct ×(1−β), wrong ×β; q ∉ K: correct ×η, wrong ×(1−η)
 * (β = 0.1; η = 0.05 open, 1/k MCQ). Systematic resampling when ESS < M/2,
 * then symmetric MCMC rejuvenation (toggle a uniformly drawn leaf: add when in
 * the outer fringe, remove when in the inner fringe; Metropolis on the
 * likelihood of all answers so far). Stop after 25 questions, or after ≥ 8
 * when every skeleton P̂ is outside [0.2, 0.8]. Fully deterministic per seed.
 */

import { graphIndex, type LearnerGraphView } from "./graph-view.ts";
import { Rng } from "./math.ts";
import { LEARNER_CONSTANTS } from "./params.ts";
import type { DomainId } from "../domains/types.ts";
import type { LearnerEvent, LearnerParams, LearnerSnapshot, NodeId } from "./types.ts";

// ─── clause helpers ──────────────────────────────────────────────────────────

/** True when the node is an entry item or some clause is fully contained in `has`. */
export function clauseSatisfied(clauses: readonly (readonly NodeId[])[], has: (id: NodeId) => boolean): boolean {
	if (clauses.length === 0) return true;
	for (const clause of clauses) {
		let ok = true;
		for (const m of clause) {
			if (!has(m)) {
				ok = false;
				break;
			}
		}
		if (ok) return true;
	}
	return false;
}

/** Members present in EVERY clause (∅ for entry items). */
export function mandatoryMembers(clauses: readonly (readonly NodeId[])[]): NodeId[] {
	if (clauses.length === 0) return [];
	const [first, ...rest] = clauses;
	if (!first || first.length === 0) return [];
	return first.filter((m) => rest.every((c) => c.includes(m)));
}

export function isFeasible(graph: LearnerGraphView, K: ReadonlySet<NodeId>): boolean {
	for (const id of K) {
		const node = graph.nodes.get(id);
		if (!node || !clauseSatisfied(node.clauses, (m) => K.has(m))) return false;
	}
	return true;
}

/** Largest feasible subset of X (one forward pass in topological order). */
export function interior(graph: LearnerGraphView, X: ReadonlySet<NodeId> | ((id: NodeId) => boolean)): Set<NodeId> {
	const inX = typeof X === "function" ? X : (id: NodeId) => X.has(id);
	const K = new Set<NodeId>();
	for (const id of graph.ids) {
		if (!inX(id)) continue;
		const node = graph.nodes.get(id);
		if (node && clauseSatisfied(node.clauses, (m) => K.has(m))) K.add(id);
	}
	return K;
}

/** Outer fringe {q ∉ K : some clause ⊆ K}, in topological order. */
export function outerFringe(graph: LearnerGraphView, K: ReadonlySet<NodeId>, opts: { leavesOnly?: boolean } = {}): NodeId[] {
	const out: NodeId[] = [];
	for (const id of graph.ids) {
		if (K.has(id)) continue;
		const node = graph.nodes.get(id);
		if (!node || (opts.leavesOnly && !node.isLeaf)) continue;
		if (clauseSatisfied(node.clauses, (m) => K.has(m))) out.push(id);
	}
	return out;
}

/** Inner fringe {k ∈ K : K∖{k} feasible}, in topological order (K assumed feasible). */
export function innerFringe(graph: LearnerGraphView, K: ReadonlySet<NodeId>, opts: { leavesOnly?: boolean } = {}): NodeId[] {
	const index = graphIndex(graph);
	const out: NodeId[] = [];
	for (const k of graph.ids) {
		if (!K.has(k)) continue;
		const node = graph.nodes.get(k);
		if (!node || (opts.leavesOnly && !node.isLeaf)) continue;
		const without = (m: NodeId) => m !== k && K.has(m);
		let removable = true;
		for (const j of index.dependents.get(k) ?? []) {
			if (!K.has(j)) continue;
			const dep = graph.nodes.get(j);
			if (dep && !clauseSatisfied(dep.clauses, without)) {
				removable = false;
				break;
			}
		}
		if (removable) out.push(k);
	}
	return out;
}

/**
 * Least fixed point of implicit credit (r10 §3.5):
 * m*(u) = max(raw(u), α·max{m*(v) : u mandatory in v}), one reverse pass.
 */
export function impliedCredit(graph: LearnerGraphView, raw: (id: NodeId) => number, alpha = 1): Map<NodeId, number> {
	const m = new Map<NodeId, number>();
	for (const id of graph.ids) m.set(id, Math.max(0, raw(id)));
	for (let i = graph.ids.length - 1; i >= 0; i--) {
		const v = graph.ids[i] as NodeId;
		const mv = m.get(v) ?? 0;
		if (mv <= 0) continue;
		const node = graph.nodes.get(v);
		if (!node) continue;
		for (const u of mandatoryMembers(node.clauses)) {
			const cand = alpha * mv;
			if (cand > (m.get(u) ?? 0)) m.set(u, cand);
		}
	}
	return m;
}

/** Boolean closure: raw set plus everything mandatory below it. */
export function impliedClosure(graph: LearnerGraphView, raw: ReadonlySet<NodeId>): Set<NodeId> {
	const out = new Set<NodeId>();
	for (const id of raw) if (graph.nodes.has(id)) out.add(id);
	if (out.size === 0) return out;
	const mandatory = graphIndex(graph).mandatory;
	for (let i = graph.ids.length - 1; i >= 0; i--) {
		const v = graph.ids[i] as NodeId;
		if (!out.has(v)) continue;
		const req = mandatory.get(v);
		if (!req) continue;
		for (let j = 0; j < req.length; j++) out.add(req[j] as NodeId);
	}
	return out;
}

/** Add every container whose clause lies inside the set (forward pass). */
function addMilestones(graph: LearnerGraphView, set: Set<NodeId>): Set<NodeId> {
	const containers = graphIndex(graph).containers;
	for (let i = 0; i < containers.length; i++) {
		const id = containers[i] as NodeId;
		if (set.has(id)) continue;
		const node = graph.nodes.get(id)!;
		if (clauseSatisfied(node.clauses, (m) => set.has(m))) set.add(id);
	}
	return set;
}

// ─── structural state ────────────────────────────────────────────────────────

export interface StructuralState {
	/** attainedAt (direct evidence). */
	attained: Set<NodeId>;
	/** placedAt without attainedAt (diagnostic placement). */
	placed: Set<NodeId>;
	/** In A only through implicit credit or milestone completion. */
	implied: Set<NodeId>;
	/** The unlocking set A (monotonic). */
	known: Set<NodeId>;
	/** Leaves not in A whose clause is satisfied by A (study candidates). */
	frontier: NodeId[];
}

/** Lightweight unlocking set A (avoids attained/placed/implied/outerFringe work). */
export function knownSetOf(snapshot: Pick<LearnerSnapshot, "nodes">, graph: LearnerGraphView): Set<NodeId> {
	const raw = new Set<NodeId>();
	for (const id of Object.keys(snapshot.nodes)) {
		const s = snapshot.nodes[id];
		if (s && (s.attainedAt || s.placedAt || s.lessonCompletedAt) && graph.nodes.has(id)) raw.add(id);
	}
	if (raw.size === 0 && !graphIndex(graph).hasEmptyContainer) return raw;
	return addMilestones(graph, impliedClosure(graph, raw));
}

export function structuralState(snapshot: Pick<LearnerSnapshot, "nodes">, graph: LearnerGraphView): StructuralState {
	const attained = new Set<NodeId>();
	const placed = new Set<NodeId>();
	const raw = new Set<NodeId>();
	for (const id of Object.keys(snapshot.nodes)) {
		const s = snapshot.nodes[id];
		if (!s || !graph.nodes.has(id)) continue;
		if (s.attainedAt) {
			attained.add(id);
			raw.add(id);
		} else if (s.placedAt) {
			placed.add(id);
			raw.add(id);
		}
		if (s.lessonCompletedAt) raw.add(id);
	}
	const known = raw.size === 0 && !graphIndex(graph).hasEmptyContainer
		? new Set<NodeId>()
		: addMilestones(graph, impliedClosure(graph, raw));
	const implied = new Set<NodeId>();
	for (const id of known) if (!raw.has(id)) implied.add(id);
	return { attained, placed, implied, known, frontier: outerFringe(graph, known, { leavesOnly: true }) };
}

/** K* = interior of the implied closure of {masteredAt} (milestones included). */
export function crispState(snapshot: Pick<LearnerSnapshot, "nodes">, graph: LearnerGraphView): Set<NodeId> {
	const mastered = new Set<NodeId>();
	for (const id of Object.keys(snapshot.nodes)) {
		if (snapshot.nodes[id]?.masteredAt && graph.nodes.has(id)) mastered.add(id);
	}
	if (mastered.size === 0 && !graphIndex(graph).hasEmptyContainer) return mastered;
	return interior(graph, addMilestones(graph, impliedClosure(graph, mastered)));
}

/**
 * Leaf inner fringe that looks through container milestones: leaves k ∈ K
 * whose removal breaks no OTHER leaf of K (containers that lose their clause
 * drop out with k). Plain `innerFringe` would hide every leaf under a
 * completed unit, since the unit itself depends on all of them.
 */
export function topLeaves(graph: LearnerGraphView, K: ReadonlySet<NodeId>): NodeId[] {
	const index = graphIndex(graph);
	const out: NodeId[] = [];
	for (const k of graph.ids) {
		if (K.has(k) && graph.nodes.get(k)?.isLeaf && leafRemovable(graph, index.dependents, K, k)) out.push(k);
	}
	return out;
}

function leafRemovable(graph: LearnerGraphView, dependents: ReadonlyMap<NodeId, readonly NodeId[]>, K: ReadonlySet<NodeId>, k: NodeId): boolean {
	const removed = new Set<NodeId>([k]);
	const has = (m: NodeId) => K.has(m) && !removed.has(m);
	const queue = [...(dependents.get(k) ?? [])];
	while (queue.length > 0) {
		const j = queue.pop() as NodeId;
		if (!has(j)) continue;
		const node = graph.nodes.get(j);
		if (!node || clauseSatisfied(node.clauses, has)) continue;
		if (node.isLeaf) return false;
		removed.add(j);
		queue.push(...(dependents.get(j) ?? []));
	}
	return true;
}

/** "Você domina (topo)": top leaves of K* (see `topLeaves`). */
export function masteredTop(snapshot: LearnerSnapshot, graph: LearnerGraphView): NodeId[] {
	return topLeaves(graph, crispState(snapshot, graph));
}

// ─── retention role (r2 §9.9 "Retenção desejada por papel") ──────────────────

/** Studyable dependents of id, looking through container milestones (memoized per view). */
export function studyableDependents(graph: LearnerGraphView, id: NodeId): readonly NodeId[] {
	const index = graphIndex(graph);
	const cached = index.studyableDependentsCache.get(id);
	if (cached) return cached;
	const out = new Set<NodeId>();
	const seen = new Set<NodeId>([id]);
	const stack = [...(index.dependents.get(id) ?? [])];
	while (stack.length > 0) {
		const d = stack.pop() as NodeId;
		if (seen.has(d)) continue;
		seen.add(d);
		const node = graph.nodes.get(d);
		if (!node) continue;
		if (node.isLeaf) out.add(d);
		else for (const next of index.dependents.get(d) ?? []) stack.push(next);
	}
	const list = [...out];
	index.studyableDependentsCache.set(id, list);
	return list;
}

export type RetentionRole = "frontierPrereq" | "default" | "distantLeaf";

/**
 * 0.93 when id is a prerequisite of a frontier node (looking through
 * containers), 0.85 for leaves nothing studyable builds on and outside the
 * goals, 0.90 otherwise.
 */
export function retentionRole(
	graph: LearnerGraphView,
	id: NodeId,
	isKnown: (id: NodeId) => boolean,
	frontierSet?: ReadonlySet<NodeId>,
): RetentionRole {
	const node = graph.nodes.get(id);
	if (!node) return "default";
	const deps = studyableDependents(graph, id);
	if (frontierSet) {
		for (let i = 0; i < deps.length; i++) {
			if (frontierSet.has(deps[i] as NodeId)) return "frontierPrereq";
		}
	} else {
		for (let i = 0; i < deps.length; i++) {
			const j = deps[i] as NodeId;
			if (isKnown(j)) continue;
			const dep = graph.nodes.get(j);
			if (dep && clauseSatisfied(dep.clauses, isKnown)) return "frontierPrereq";
		}
	}
	if (deps.length === 0 && node.goalWeight <= 0) return "distantLeaf";
	return "default";
}

export function desiredRetentionFor(
	graph: LearnerGraphView,
	id: NodeId,
	isKnown: (id: NodeId) => boolean,
	params: LearnerParams,
	frontierSet?: ReadonlySet<NodeId>,
): number {
	return params.desiredRetention[retentionRole(graph, id, isKnown, frontierSet)];
}

// ─── particle-filter diagnostic (r2 §9.7) ────────────────────────────────────

export interface DiagnosticAnswer {
	nodeId: NodeId;
	correct: boolean;
	/** MCQ option count (η = 1/k); omitted = open answer. */
	options?: number;
}

export interface DiagnosticState {
	/** Topological ids (bit index = position). */
	ids: readonly NodeId[];
	words: number;
	count: number;
	/** count × words bitsets. */
	bits: Uint32Array;
	weights: Float64Array;
	rngState: number;
	skeleton: readonly NodeId[];
	answers: readonly DiagnosticAnswer[];
}

export interface DiagnosticOptions {
	seed: string;
	particles?: number;
	/** Representative nodes that may be asked (default: ≤ 300 leaves spread over the order). */
	skeleton?: readonly NodeId[];
	/** Difficulty b per node (default: standardized depth). */
	difficulty?: (id: NodeId) => number;
	/** Optional mean shift for the initial latent-ability prior θ ~ N(priorMean, 1). Defaults to 0. */
	priorMean?: number;
}

export class DiagnosticError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DiagnosticError";
	}
}

function hasBit(bits: Uint32Array, base: number, i: number): boolean {
	return ((bits[base + (i >>> 5)] as number) & (1 << (i & 31))) !== 0;
}

function setBit(bits: Uint32Array, base: number, i: number): void {
	bits[base + (i >>> 5)] = (bits[base + (i >>> 5)] as number) | (1 << (i & 31));
}

/** Default skeleton: up to 300 leaves evenly spread over the topological order. */
export function defaultSkeleton(graph: LearnerGraphView, max = 300): NodeId[] {
	const leaves = graph.ids.filter((id) => graph.nodes.get(id)?.isLeaf);
	if (leaves.length <= max) return leaves;
	const out: NodeId[] = [];
	for (let i = 0; i < max; i++) out.push(leaves[Math.floor((i * leaves.length) / max)] as NodeId);
	return out;
}

function depthDifficulty(graph: LearnerGraphView): (id: NodeId) => number {
	const depths = graph.ids.map((id) => graph.nodes.get(id)?.depth ?? 0);
	const mean = depths.reduce((s, d) => s + d, 0) / Math.max(1, depths.length);
	const variance = depths.reduce((s, d) => s + (d - mean) ** 2, 0) / Math.max(1, depths.length);
	const sd = Math.sqrt(variance) || 1;
	return (id) => ((graph.nodes.get(id)?.depth ?? mean) - mean) / sd;
}

/** Canonical feasible state from a membership predicate (containers iff their clause holds). */
function canonicalInterior(graph: LearnerGraphView, member: Uint8Array, pos: ReadonlyMap<NodeId, number>): void {
	graph.ids.forEach((id, i) => {
		const node = graph.nodes.get(id);
		if (!node) {
			member[i] = 0;
			return;
		}
		const wanted = node.isLeaf ? member[i] === 1 : true;
		member[i] = wanted && clauseSatisfied(node.clauses, (m) => member[pos.get(m) ?? -1] === 1) ? 1 : 0;
	});
}

export function startDiagnostic(graph: LearnerGraphView, opts: DiagnosticOptions): DiagnosticState {
	const P = LEARNER_CONSTANTS.particles;
	const count = opts.particles ?? P.count;
	if (!(Number.isInteger(count) && count > 0)) throw new DiagnosticError(`Número de partículas inválido: ${count}`);
	const ids = graph.ids;
	const pos = graphIndex(graph).pos;
	const words = Math.max(1, Math.ceil(ids.length / 32));
	const bits = new Uint32Array(count * words);
	const rng = new Rng(opts.seed);
	const difficulty = opts.difficulty ?? depthDifficulty(graph);
	const priorMean = typeof opts.priorMean === "number" && Number.isFinite(opts.priorMean) ? opts.priorMean : 0;
	const b = ids.map((id) => difficulty(id));
	const member = new Uint8Array(ids.length);
	for (let m = 0; m < count; m++) {
		const theta = priorMean + rng.normal();
		for (let i = 0; i < ids.length; i++) member[i] = theta + P.thresholdNoise * rng.normal() > (b[i] as number) ? 1 : 0;
		canonicalInterior(graph, member, pos);
		const base = m * words;
		for (let i = 0; i < ids.length; i++) if (member[i] === 1) setBit(bits, base, i);
	}
	const skeleton = (opts.skeleton ?? defaultSkeleton(graph)).filter((id) => pos.has(id));
	if (skeleton.length === 0) throw new DiagnosticError("Esqueleto do diagnóstico vazio.");
	return { ids, words, count, bits, weights: new Float64Array(count).fill(1 / count), rngState: rng.state, skeleton, answers: [] };
}

/** P̂(q ∈ K) for one node. */
export function particleMarginal(state: DiagnosticState, index: number): number {
	let total = 0;
	let inside = 0;
	for (let m = 0; m < state.count; m++) {
		const w = state.weights[m] as number;
		total += w;
		if (hasBit(state.bits, m * state.words, index)) inside += w;
	}
	return total > 0 ? inside / total : 0;
}

function askedSet(state: DiagnosticState): Set<NodeId> {
	return new Set(state.answers.map((a) => a.nodeId));
}

export function shouldStopDiagnostic(state: DiagnosticState): boolean {
	const P = LEARNER_CONSTANTS.particles;
	if (state.answers.length >= P.maxQuestions) return true;
	const asked = askedSet(state);
	const open = state.skeleton.filter((id) => !asked.has(id));
	if (open.length === 0) return true;
	if (state.answers.length < P.minQuestions) return false;
	const position = new Map(state.ids.map((id, i) => [id, i] as const));
	return state.skeleton.every((id) => {
		const p = particleMarginal(state, position.get(id) as number);
		return p < P.stopLo || p > P.stopHi;
	});
}

/** Half-split question: unasked skeleton node minimizing |2P̂ − 1| (null when the diagnostic should stop). */
export function nextDiagnosticQuestion(state: DiagnosticState): NodeId | null {
	if (shouldStopDiagnostic(state)) return null;
	const asked = askedSet(state);
	const position = new Map(state.ids.map((id, i) => [id, i] as const));
	let best: NodeId | null = null;
	let bestScore = Infinity;
	for (const id of state.skeleton) {
		if (asked.has(id)) continue;
		const score = Math.abs(2 * particleMarginal(state, position.get(id) as number) - 1);
		if (score < bestScore - 1e-12) {
			bestScore = score;
			best = id;
		}
	}
	return best;
}

function blimLikelihood(inK: boolean, answer: DiagnosticAnswer): number {
	const { beta, etaOpen } = LEARNER_CONSTANTS.blim;
	const eta = answer.options && answer.options >= 2 ? 1 / answer.options : etaOpen;
	if (inK) return answer.correct ? 1 - beta : beta;
	return answer.correct ? eta : 1 - eta;
}

function stateLikelihood(member: Uint8Array, answers: readonly DiagnosticAnswer[], pos: ReadonlyMap<NodeId, number>): number {
	let l = 1;
	for (const a of answers) l *= blimLikelihood(member[pos.get(a.nodeId) ?? -1] === 1, a);
	return l;
}

function readMember(state: DiagnosticState, bits: Uint32Array, m: number, out: Uint8Array): void {
	const base = m * state.words;
	for (let i = 0; i < state.ids.length; i++) out[i] = hasBit(bits, base, i) ? 1 : 0;
}

function writeMember(state: DiagnosticState, bits: Uint32Array, m: number, member: Uint8Array): void {
	const base = m * state.words;
	bits.fill(0, base, base + state.words);
	for (let i = 0; i < state.ids.length; i++) if (member[i] === 1) setBit(bits, base, i);
}

/** One symmetric toggle move on a leaf; returns true when accepted. */
function mcmcMove(
	graph: LearnerGraphView,
	member: Uint8Array,
	leaves: readonly number[],
	answers: readonly DiagnosticAnswer[],
	pos: ReadonlyMap<NodeId, number>,
	rng: Rng,
): void {
	if (leaves.length === 0) return;
	const i = leaves[rng.int(leaves.length)] as number;
	const id = graph.ids[i] as NodeId;
	const node = graph.nodes.get(id);
	if (!node) return;
	const proposal = Uint8Array.from(member);
	if (member[i] === 1) {
		proposal[i] = 0;
		canonicalInterior(graph, proposal, pos);
		for (const j of leaves) if (j !== i && member[j] === 1 && proposal[j] === 0) return;
	} else {
		if (!clauseSatisfied(node.clauses, (m) => member[pos.get(m) ?? -1] === 1)) return;
		proposal[i] = 1;
		canonicalInterior(graph, proposal, pos);
	}
	const before = stateLikelihood(member, answers, pos);
	const after = stateLikelihood(proposal, answers, pos);
	if (after >= before || rng.next() < after / before) member.set(proposal);
}

/** Fold one answer into the particle cloud (returns a NEW state). */
export function recordDiagnosticAnswer(state: DiagnosticState, graph: LearnerGraphView, answer: DiagnosticAnswer): DiagnosticState {
	const pos = graphIndex(graph).pos;
	const index = pos.get(answer.nodeId);
	if (index === undefined || state.ids[index] !== answer.nodeId) throw new DiagnosticError(`Nó fora do diagnóstico: ${answer.nodeId}`);
	const weights = Float64Array.from(state.weights);
	let total = 0;
	for (let m = 0; m < state.count; m++) {
		const w = (weights[m] as number) * blimLikelihood(hasBit(state.bits, m * state.words, index), answer);
		weights[m] = w;
		total += w;
	}
	if (!(total > 0)) throw new DiagnosticError("Pesos das partículas degeneraram para zero.");
	let sumSq = 0;
	for (let m = 0; m < state.count; m++) {
		const w = (weights[m] as number) / total;
		weights[m] = w;
		sumSq += w * w;
	}
	const answers = [...state.answers, answer];
	const ess = 1 / sumSq;
	if (ess >= state.count / 2) return { ...state, weights, answers };
	return resampleAndMove({ ...state, weights, answers }, graph);
}

function resampleAndMove(state: DiagnosticState, graph: LearnerGraphView): DiagnosticState {
	const rng = new Rng(state.rngState);
	const pos = graphIndex(graph).pos;
	const bits = new Uint32Array(state.bits.length);
	const step = 1 / state.count;
	let u = rng.next() * step;
	let cumulative = state.weights[0] as number;
	let src = 0;
	for (let m = 0; m < state.count; m++) {
		while (u > cumulative && src < state.count - 1) {
			src++;
			cumulative += state.weights[src] as number;
		}
		bits.set(state.bits.subarray(src * state.words, (src + 1) * state.words), m * state.words);
		u += step;
	}
	const leaves: number[] = [];
	state.ids.forEach((id, i) => {
		if (graph.nodes.get(id)?.isLeaf) leaves.push(i);
	});
	const member = new Uint8Array(state.ids.length);
	for (let m = 0; m < state.count; m++) {
		readMember(state, bits, m, member);
		for (let s = 0; s < LEARNER_CONSTANTS.particles.mcmcSteps; s++) mcmcMove(graph, member, leaves, state.answers, pos, rng);
		writeMember(state, bits, m, member);
	}
	return { ...state, bits, weights: new Float64Array(state.count).fill(step), rngState: rng.state };
}

/** p_q = P̂(q ∈ K) for every node (r2 §9.7 output). */
export function diagnosticEstimates(state: DiagnosticState): { nodeId: NodeId; p: number }[] {
	const totals = new Float64Array(state.ids.length);
	let total = 0;
	for (let m = 0; m < state.count; m++) {
		const w = state.weights[m] as number;
		total += w;
		const base = m * state.words;
		for (let i = 0; i < state.ids.length; i++) if (hasBit(state.bits, base, i)) totals[i] = (totals[i] as number) + w;
	}
	return state.ids.map((nodeId, i) => ({ nodeId, p: total > 0 ? (totals[i] as number) / total : 0 }));
}

/** The `diagnostic` LearnerEvent carrying the estimates (fold marks unverified nodes as inferred/placed). */
export function diagnosticEvent(state: DiagnosticState, meta: { id: string; seq: number; at: string; domainId: DomainId }): LearnerEvent {
	return { kind: "diagnostic", id: meta.id, seq: meta.seq, at: meta.at, domainId: meta.domainId, estimates: diagnosticEstimates(state) };
}
