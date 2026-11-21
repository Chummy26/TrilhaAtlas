/**
 * LearnerGraphView — the ONLY shape of the curriculum the learner model reads
 * (decoupling seam: docs/research/00-SINTESE.md §2.3 + §2.6; r10 §3.1).
 *
 * The curriculum module owns the graph (src/core/curriculum); the integration
 * layer projects a CurriculumSnapshot into this view. The learner never sees
 * stored clauses or ledger patches — only the EFFECTIVE clause system:
 *
 *   ids           — every item, in a topological order of the effective
 *                   clause system (every clause member precedes its owner).
 *   clauses       — EFFECTIVE clauses, OR-of-ANDs: reachable when all ids of
 *                   ANY inner array are attained. `[]` = entry item.
 *                   Containers carry `[[...children]]` (milestones).
 *   encompasses   — FIRe edges: practicing this node implicitly reviews `id`
 *                   with weight w ∈ (0, 1].
 *   hoursMid      — (lo + hi) / 2 study hours.
 *   depth         — prerequisite rank: length of the longest chain of
 *                   effective prerequisites below the node (0 = entry item).
 *                   Seeds the diagnostic difficulty (r2 §9.7).
 *   goalWeight    — goal relevance in [0, 1] (1 = explicit learner target).
 *
 * Derived indexes (dependents, reverse encompasses, positions, expanded
 * clauses) are computed once per view object and memoized in a WeakMap — the
 * view must be treated as immutable once built.
 *
 * Containers appear as clause MEMBERS of other nodes (effective clauses keep
 * unit-level prerequisites). They never carry learner state, so numeric rules
 * use `expandedClauses` (containers replaced by their own clauses), while the
 * structural rules (KST fringes) keep the containers as milestones.
 */

import type { NodeId } from "./types.ts";

export interface LearnerGraphNode {
	/** Display title (pt-BR). */
	title: string;
	/** Node DEFINITION version (learner evidence resets on bump via a `node-version` event). */
	version: number;
	/** Studyable leaf (atom or unrefined stub). Containers are milestones, never taught. */
	isLeaf: boolean;
	reinforcementFor?: string;
	parentId: NodeId | null;
	children: readonly NodeId[];
	/** EFFECTIVE clauses (OR of ANDs). */
	clauses: readonly (readonly NodeId[])[];
	encompasses: readonly { id: NodeId; w: number }[];
	hoursMid: number;
	depth: number;
	goalWeight: number;
}

export interface LearnerGraphView {
	/** Topological order over the effective clause system. */
	readonly ids: readonly NodeId[];
	readonly nodes: ReadonlyMap<NodeId, LearnerGraphNode>;
}

export class LearnerGraphError extends Error {
	readonly witness: string[];
	constructor(message: string, witness: string[] = []) {
		super(message);
		this.name = "LearnerGraphError";
		this.witness = witness;
	}
}

export interface GraphIndex {
	/** Topological position of each id. */
	pos: ReadonlyMap<NodeId, number>;
	/** j such that id ∈ some clause of j (sorted by topological position). */
	dependents: ReadonlyMap<NodeId, readonly NodeId[]>;
	/** Union of clause members (distinct). */
	prereqs: ReadonlyMap<NodeId, readonly NodeId[]>;
	/** n such that n.encompasses contains id, with the edge weight. */
	encompassedBy: ReadonlyMap<NodeId, readonly { id: NodeId; w: number }[]>;
	/** Non-leaf container ids in topological order. */
	containers: readonly NodeId[];
	/** True when any container has an empty clause system or empty clause (always satisfied). */
	hasEmptyContainer: boolean;
	/** Mandatory clause members (intersection across OR clauses) per id. */
	mandatory: ReadonlyMap<NodeId, readonly NodeId[]>;
	/** Undirected expanded leaf-to-leaf adjacency (a <-> b iff leaf a ∈ expandedClauses(b)). */
	readonly leafNeighbors: ReadonlyMap<NodeId, readonly NodeId[]>;
	/** Memoized studyable (leaf) dependents per id, looking through container milestones. */
	studyableDependentsCache: Map<NodeId, readonly NodeId[]>;
}

const EMPTY: readonly NodeId[] = Object.freeze([]);
const indexCache = new WeakMap<LearnerGraphView, GraphIndex>();

function computeMandatory(clauses: readonly (readonly NodeId[])[]): readonly NodeId[] {
	if (clauses.length === 0) return EMPTY;
	const first = clauses[0];
	if (!first || first.length === 0) return EMPTY;
	if (clauses.length === 1) return first;
	const out: NodeId[] = [];
	for (let i = 0; i < first.length; i++) {
		const m = first[i] as NodeId;
		let all = true;
		for (let c = 1; c < clauses.length; c++) {
			if (!clauses[c]!.includes(m)) {
				all = false;
				break;
			}
		}
		if (all) out.push(m);
	}
	return out.length > 0 ? out : EMPTY;
}

/** Memoized derived indexes of a view. */
export function graphIndex(view: LearnerGraphView): GraphIndex {
	const cached = indexCache.get(view);
	if (cached) return cached;
	const pos = new Map<NodeId, number>();
	view.ids.forEach((id, i) => pos.set(id, i));
	const dependents = new Map<NodeId, NodeId[]>();
	const prereqs = new Map<NodeId, NodeId[]>();
	const encompassedBy = new Map<NodeId, { id: NodeId; w: number }[]>();
	const containers: NodeId[] = [];
	const mandatory = new Map<NodeId, readonly NodeId[]>();
	let hasEmptyContainer = false;
	for (const id of view.ids) {
		const node = view.nodes.get(id);
		if (!node) continue;
		if (!node.isLeaf) {
			containers.push(id);
			if (!hasEmptyContainer && (node.clauses.length === 0 || node.clauses.some((c) => c.length === 0))) {
				hasEmptyContainer = true;
			}
		}
		const req = computeMandatory(node.clauses);
		if (req.length > 0) mandatory.set(id, req);
		const members = new Set<NodeId>();
		for (const clause of node.clauses) for (const m of clause) members.add(m);
		const list = [...members].filter((m) => pos.has(m));
		prereqs.set(id, list);
		for (const m of list) {
			let deps = dependents.get(m);
			if (!deps) dependents.set(m, (deps = []));
			deps.push(id);
		}
		for (const e of node.encompasses) {
			if (!pos.has(e.id) || e.id === id) continue;
			let rev = encompassedBy.get(e.id);
			if (!rev) encompassedBy.set(e.id, (rev = []));
			rev.push({ id, w: e.w });
		}
	}
	let cachedLeafNeighbors: ReadonlyMap<NodeId, readonly NodeId[]> | null = null;
	const index: GraphIndex = {
		pos,
		dependents,
		prereqs,
		encompassedBy,
		containers,
		hasEmptyContainer,
		mandatory,
		studyableDependentsCache: new Map<NodeId, readonly NodeId[]>(),
		get leafNeighbors(): ReadonlyMap<NodeId, readonly NodeId[]> {
			if (cachedLeafNeighbors) return cachedLeafNeighbors;
			const adj = new Map<NodeId, Set<NodeId>>();
			const link = (u: NodeId, v: NodeId) => {
				let su = adj.get(u);
				if (!su) adj.set(u, (su = new Set()));
				su.add(v);
				let sv = adj.get(v);
				if (!sv) adj.set(v, (sv = new Set()));
				sv.add(u);
			};
			for (let i = 0; i < view.ids.length; i++) {
				const b = view.ids[i] as NodeId;
				const node = view.nodes.get(b);
				if (!node || !node.isLeaf || node.clauses.length === 0) continue;
				const clauses = expandedClauses(view, b);
				for (let c = 0; c < clauses.length; c++) {
					const clause = clauses[c]!;
					for (let j = 0; j < clause.length; j++) {
						const a = clause[j] as NodeId;
						if (a !== b && pos.has(a)) link(a, b);
					}
				}
			}
			const out = new Map<NodeId, readonly NodeId[]>();
			for (const [id, set] of adj) out.set(id, [...set]);
			cachedLeafNeighbors = out;
			return out;
		},
	};
	indexCache.set(view, index);
	return index;
}

export function dependentsOf(view: LearnerGraphView, id: NodeId): readonly NodeId[] {
	return graphIndex(view).dependents.get(id) ?? EMPTY;
}

export function prereqsOf(view: LearnerGraphView, id: NodeId): readonly NodeId[] {
	return graphIndex(view).prereqs.get(id) ?? EMPTY;
}

/** Cap on alternatives produced by `expandedClauses` (same order of magnitude as the curriculum's effective DNF cap). */
export const MAX_EXPANDED_ALTERNATIVES = 64;

const expandedCache = new WeakMap<LearnerGraphView, Map<NodeId, readonly (readonly NodeId[])[]>>();

/**
 * Clauses of `id` with every CONTAINER member replaced by its own (expanded)
 * clauses — the numeric view of the clause system. Containers are milestones
 * (attained exactly when their clause holds) and carry no learner state of
 * their own, so every numeric rule that reads clause members (consistency
 * projection, readiness, warm-ups, Fréchet prior) must look through them;
 * otherwise a never-taught container would act as a phantom node with the
 * prior p = 0.15. Members are deduplicated per alternative (first-seen order);
 * a container with no clause is an entry and drops out. Memoized per view;
 * at most MAX_EXPANDED_ALTERNATIVES alternatives (first ones, deterministic).
 */
export function expandedClauses(view: LearnerGraphView, id: NodeId): readonly (readonly NodeId[])[] {
	let memo = expandedCache.get(view);
	if (!memo) expandedCache.set(view, (memo = new Map()));
	const cached = memo.get(id);
	if (cached) return cached;
	const node = view.nodes.get(id);
	const out: NodeId[][] = [];
	for (const clause of node?.clauses ?? []) {
		let partial: NodeId[][] = [[]];
		for (const m of clause) {
			const member = view.nodes.get(m);
			const subs: readonly (readonly NodeId[])[] = member && !member.isLeaf ? expandedClauses(view, m) : [[m]];
			if (subs.length === 0) continue;
			const next: NodeId[][] = [];
			for (const p of partial) {
				if (next.length >= MAX_EXPANDED_ALTERNATIVES) break;
				if (p.length === 0) {
					for (const sub of subs) {
						if (next.length >= MAX_EXPANDED_ALTERNATIVES) break;
						next.push([...sub]);
					}
				} else {
					for (const sub of subs) {
						if (next.length >= MAX_EXPANDED_ALTERNATIVES) break;
						const seen = new Set<NodeId>(p);
						const merged = [...p];
						for (const x of sub) {
							if (!seen.has(x)) {
								seen.add(x);
								merged.push(x);
							}
						}
						next.push(merged);
					}
				}
			}
			partial = next;
		}
		for (const p of partial) if (out.length < MAX_EXPANDED_ALTERNATIVES) out.push(p);
	}
	memo.set(id, out);
	return out;
}

function heapPush(heap: number[], value: number): void {
	let i = heap.length;
	heap.push(value);
	while (i > 0) {
		const parent = (i - 1) >>> 1;
		const pv = heap[parent] as number;
		if (pv <= value) break;
		heap[i] = pv;
		i = parent;
	}
	heap[i] = value;
}

function heapPop(heap: number[]): number {
	const top = heap[0] as number;
	const last = heap.pop() as number;
	const n = heap.length;
	if (n > 0) {
		let i = 0;
		const half = n >>> 1;
		while (i < half) {
			let child = (i << 1) + 1;
			let cv = heap[child] as number;
			const right = child + 1;
			if (right < n && (heap[right] as number) < cv) {
				child = right;
				cv = heap[right] as number;
			}
			if (last <= cv) break;
			heap[i] = cv;
			i = child;
		}
		heap[i] = last;
	}
	return top;
}

/**
 * Build a view from an unordered node list: validates references and
 * computes a deterministic topological order (Kahn, ties by input order).
 * Throws LearnerGraphError on duplicate or dangling ids, self references,
 * cycles, or a node failing `assertGraphView` (bad weights, NaN fields).
 */
export function buildGraphView(entries: readonly ({ id: NodeId } & LearnerGraphNode)[]): LearnerGraphView {
	const n = entries.length;
	const nodes = new Map<NodeId, LearnerGraphNode>();
	const order = new Map<NodeId, number>();
	const idByIndex: NodeId[] = new Array(n);
	for (let i = 0; i < n; i++) {
		const entry = entries[i]!;
		if (nodes.has(entry.id)) throw new LearnerGraphError(`Nó duplicado no grafo: ${entry.id}`, [entry.id]);
		const { id, ...node } = entry;
		nodes.set(id, node);
		order.set(id, i);
		idByIndex[i] = id;
	}
	const indeg = new Int32Array(n);
	const out: number[][] = Array.from({ length: n }, () => []);
	for (let i = 0; i < n; i++) {
		const id = idByIndex[i] as NodeId;
		const node = nodes.get(id) as LearnerGraphNode;
		const members = new Set<number>();
		for (const clause of node.clauses) {
			for (const m of clause) {
				if (m === id) throw new LearnerGraphError(`Nó ${id} referencia a si mesmo nas cláusulas.`, [id]);
				const mIdx = order.get(m);
				if (mIdx === undefined) throw new LearnerGraphError(`Cláusula de ${id} referencia id inexistente: ${m}`, [id, m]);
				members.add(mIdx);
			}
		}
		for (const e of node.encompasses) {
			if (!nodes.has(e.id)) throw new LearnerGraphError(`encompasses de ${id} referencia id inexistente: ${e.id}`, [id, e.id]);
			if (!(e.w > 0 && e.w <= 1)) throw new LearnerGraphError(`Peso de encompasses fora de (0,1] em ${id} → ${e.id}: ${e.w}`, [id, e.id]);
		}
		indeg[i] = members.size;
		for (const mIdx of members) out[mIdx]!.push(i);
	}
	// Ascending insertion order already satisfies the binary min-heap property.
	const heap: number[] = [];
	for (let i = 0; i < n; i++) if (indeg[i] === 0) heap.push(i);
	const ids: NodeId[] = [];
	while (heap.length > 0) {
		const idx = heapPop(heap);
		ids.push(idByIndex[idx] as NodeId);
		const deps = out[idx]!;
		for (let j = 0; j < deps.length; j++) {
			const dep = deps[j] as number;
			const left = (indeg[dep] as number) - 1;
			indeg[dep] = left;
			if (left === 0) heapPush(heap, dep);
		}
	}
	if (ids.length !== n) {
		const stuck: NodeId[] = [];
		for (let i = 0; i < n; i++) if ((indeg[i] as number) > 0) stuck.push(idByIndex[i] as NodeId);
		throw new LearnerGraphError(`Ciclo nas cláusulas efetivas envolvendo: ${stuck.join(", ")}`, stuck);
	}
	const view: LearnerGraphView = { ids, nodes };
	assertGraphView(view);
	return view;
}

/**
 * Assert that a (projected) view honours the contract: `ids` is a duplicate-
 * free topological order covering `nodes`, encompasses edges reference known
 * ids with w ∈ (0, 1] (r2 §9.13 (1)), and the numeric fields are finite
 * (hoursMid, depth ≥ 0; goalWeight ∈ [0, 1]) — a NaN here would silently
 * poison importance, FIRe allocation or the planner.
 */
export function assertGraphView(view: LearnerGraphView): void {
	const seen = new Set<NodeId>();
	for (const id of view.ids) {
		if (seen.has(id)) throw new LearnerGraphError(`Id ${id} repetido em ids.`, [id]);
		const node = view.nodes.get(id);
		if (!node) throw new LearnerGraphError(`Id ${id} listado em ids mas ausente de nodes.`, [id]);
		for (const clause of node.clauses) {
			for (const m of clause) {
				if (!seen.has(m)) throw new LearnerGraphError(`Ordem topológica violada: ${m} deve vir antes de ${id}.`, [m, id]);
			}
		}
		for (const e of node.encompasses) {
			if (!view.nodes.has(e.id)) throw new LearnerGraphError(`encompasses de ${id} referencia id inexistente: ${e.id}`, [id, e.id]);
			if (!(e.w > 0 && e.w <= 1)) throw new LearnerGraphError(`Peso de encompasses fora de (0,1] em ${id} → ${e.id}: ${e.w}`, [id, e.id]);
		}
		if (!(Number.isFinite(node.hoursMid) && node.hoursMid >= 0)) throw new LearnerGraphError(`hoursMid inválido em ${id}: ${node.hoursMid}`, [id]);
		if (!(Number.isFinite(node.depth) && node.depth >= 0)) throw new LearnerGraphError(`depth inválido em ${id}: ${node.depth}`, [id]);
		if (!(node.goalWeight >= 0 && node.goalWeight <= 1)) throw new LearnerGraphError(`goalWeight fora de [0,1] em ${id}: ${node.goalWeight}`, [id]);
		seen.add(id);
	}
	if (seen.size !== view.nodes.size) throw new LearnerGraphError("nodes contém ids ausentes de ids.");
}
