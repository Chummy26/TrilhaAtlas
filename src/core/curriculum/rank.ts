/**
 * Rank certificate producers over the EFFECTIVE system (docs/research/
 * 00-SINTESE.md §2.13 "cycle (R2 via rank e Kahn)"; r10 §2.1, §6.2, §11.5
 * "kahn certificante", "forwardChain").
 *
 *   kahnOrder     — Kahn's algorithm with a min-heap tie-break on dense ids
 *                   (= code-unit id order), so the order is a pure function of
 *                   the system: replaying the same ledger yields the same
 *                   certificate. On failure it returns a cycle witness
 *                   [x, …, x] where every consecutive pair (a, b) is an edge
 *                   "a is a prerequisite of b" (walk back through remaining
 *                   predecessors until a repeat, then reverse — O(V+E)).
 *   forwardChain  — Horn-style forward chaining (counter per alternative,
 *                   watcher lists): the largest reachable state and a learning
 *                   word for it; restricted to `allowed` it is the INTERIOR of a
 *                   set (r10 §11.1 item 7). O(n + Σ|C|).
 *   curriculumIndex — cached (WeakMap per snapshot object) effective system +
 *                   topological order + reverse adjacency; every read-side
 *                   module (frontier, hours, triggers, query) goes through it.
 *
 * The joint graph used for the order is effective prerequisites ∪ soft
 * prerequisites (r3 I3: requires ∪ builds_towards must stay acyclic), so the
 * certificate order also respects soft edges; the checker (./certificate.ts)
 * only needs the effective edges (R2).
 *
 * Pure and browser-safe.
 */

import { buildEffectiveSystem, mergeSorted, type DenseAlternatives, type EffectiveSystem } from "./effective.ts";
import { CurriculumError, type CurriculumSnapshot } from "./types.ts";

export type KahnResult = { ok: true; order: number[] } | { ok: false; order: number[]; cycle: number[] };

/** Minimal binary min-heap of non-negative ints. */
class IntMinHeap {
	private data: number[] = [];
	get size(): number {
		return this.data.length;
	}
	push(x: number): void {
		const d = this.data;
		d.push(x);
		let i = d.length - 1;
		while (i > 0) {
			const p = (i - 1) >> 1;
			if (d[p]! <= x) break;
			d[i] = d[p]!;
			i = p;
		}
		d[i] = x;
	}
	pop(): number {
		const d = this.data;
		const top = d[0]!;
		const last = d.pop()!;
		if (d.length > 0) {
			let i = 0;
			const n = d.length;
			for (;;) {
				const l = 2 * i + 1;
				if (l >= n) break;
				const r = l + 1;
				const c = r < n && d[r]! < d[l]! ? r : l;
				if (d[c]! >= last) break;
				d[i] = d[c]!;
				i = c;
			}
			d[i] = last;
		}
		return top;
	}
}

/**
 * Kahn over `n` dense nodes whose predecessors are `preds[x]` (sorted unique);
 * `extra[x]` (optional, sorted unique) adds further predecessors (soft edges).
 */
export function kahnOrder(n: number, preds: readonly (readonly number[])[], extra?: readonly (readonly number[])[]): KahnResult {
	const allPreds: (readonly number[])[] = new Array<readonly number[]>(n);
	const outCount = new Int32Array(n + 1);
	for (let x = 0; x < n; x++) {
		const e = extra?.[x];
		const ps = e && e.length > 0 ? mergeSorted(preds[x]!, e) : preds[x]!;
		allPreds[x] = ps;
		for (const p of ps) outCount[p + 1]!++;
	}
	// CSR of successors.
	for (let i = 0; i < n; i++) outCount[i + 1]! += outCount[i]!;
	const succ = new Int32Array(outCount[n]!);
	const fill = outCount.slice(0, n);
	const indeg = new Int32Array(n);
	for (let x = 0; x < n; x++) {
		const ps = allPreds[x]!;
		indeg[x] = ps.length;
		for (const p of ps) succ[fill[p]!++] = x;
	}
	const heap = new IntMinHeap();
	for (let x = 0; x < n; x++) if (indeg[x] === 0) heap.push(x);
	const order: number[] = [];
	while (heap.size > 0) {
		const v = heap.pop();
		order.push(v);
		for (let k = outCount[v]!; k < outCount[v + 1]!; k++) {
			const w = succ[k]!;
			if (--indeg[w]! === 0) heap.push(w);
		}
	}
	if (order.length === n) return { ok: true, order };
	return { ok: false, order, cycle: extractCycle(n, allPreds, indeg) };
}

/** Walk back through remaining predecessors from the smallest remaining node until a repeat. */
function extractCycle(n: number, preds: readonly (readonly number[])[], indeg: Int32Array): number[] {
	let start = -1;
	for (let x = 0; x < n; x++)
		if (indeg[x]! > 0) {
			start = x;
			break;
		}
	if (start < 0) return [];
	const path: number[] = [];
	const at = new Map<number, number>();
	let cur = start;
	for (;;) {
		at.set(cur, path.length);
		path.push(cur);
		let next = -1;
		for (const p of preds[cur]!)
			if (indeg[p]! > 0) {
				next = p;
				break;
			}
		if (next < 0) return []; // unreachable when indeg bookkeeping is consistent
		const seenAt = at.get(next);
		if (seenAt !== undefined) {
			// path[i+1] is a predecessor of path[i]; the cycle is path[seenAt..] closed by next.
			const segment = path.slice(seenAt);
			const forward = [next, ...segment.slice(1).reverse(), next];
			return segment.length === 1 ? [next, next] : forward;
		}
		cur = next;
	}
}

/** Forward chaining: the largest reachable state (restricted to `allowed`) and a learning word for it. */
export function forwardChain(
	n: number,
	clauses: readonly DenseAlternatives[],
	allowed?: (x: number) => boolean,
): { known: Uint8Array; word: number[] } {
	const ok = (x: number) => (allowed ? allowed(x) : true);
	// Alternatives numbered globally; watcher lists in CSR form (no per-edge allocation).
	let altCount = 0;
	const watchCount = new Int32Array(n + 1);
	for (let x = 0; x < n; x++)
		for (const alt of clauses[x]!) {
			altCount++;
			for (const y of alt) watchCount[y + 1]!++;
		}
	for (let y = 0; y < n; y++) watchCount[y + 1]! += watchCount[y]!;
	const watchAlt = new Int32Array(watchCount[n]!);
	const fill = watchCount.slice(0, n);
	const altOwner = new Int32Array(altCount);
	const missing = new Int32Array(altCount);
	const known = new Uint8Array(n);
	const queued = new Uint8Array(n);
	const queue: number[] = [];
	let a = 0;
	for (let x = 0; x < n; x++)
		for (const alt of clauses[x]!) {
			altOwner[a] = x;
			missing[a] = alt.length;
			for (const y of alt) watchAlt[fill[y]!++] = a;
			if (alt.length === 0 && queued[x] === 0 && ok(x)) {
				queued[x] = 1;
				queue.push(x);
			}
			a++;
		}
	const word: number[] = [];
	for (let h = 0; h < queue.length; h++) {
		const y = queue[h]!;
		known[y] = 1;
		word.push(y);
		for (let k = watchCount[y]!; k < watchCount[y + 1]!; k++) {
			const alt = watchAlt[k]!;
			if (--missing[alt]! !== 0) continue;
			const x = altOwner[alt]!;
			if (queued[x] === 0 && ok(x)) {
				queued[x] = 1;
				queue.push(x);
			}
		}
	}
	return { known, word };
}

/** Kahn over an effective system (effective ∪ soft edges). */
export function effectiveKahn(sys: EffectiveSystem): KahnResult {
	return kahnOrder(sys.ids.length, sys.prereqs, sys.soft);
}

/** Longest chain of effective prerequisites below each node (0 = entry item), given a topological order. */
export function prerequisiteDepth(sys: EffectiveSystem, order: readonly number[]): Int32Array {
	const depth = new Int32Array(sys.ids.length);
	for (const x of order) {
		let d = 0;
		for (const p of sys.prereqs[x]!) d = Math.max(d, depth[p]! + 1);
		depth[x] = d;
	}
	return depth;
}

// ─── Cached index ───────────────────────────────────────────────────────────

export interface CurriculumIndex {
	readonly snapshot: CurriculumSnapshot;
	readonly sys: EffectiveSystem;
	/** Topological order (dense) of the effective ∪ soft graph. */
	readonly order: readonly number[];
	/** Position of each dense id in `order`. */
	readonly pos: Int32Array;
	/** Reverse of sys.prereqs: items having x in some effective clause (sorted). */
	readonly dependents: readonly (readonly number[])[];
}

const indexCache = new WeakMap<CurriculumSnapshot, CurriculumIndex>();

/** Build an index from an already-built system and a valid topological order. */
export function indexFromOrder(snapshot: CurriculumSnapshot, sys: EffectiveSystem, order: readonly number[]): CurriculumIndex {
	const n = sys.ids.length;
	const pos = new Int32Array(n);
	order.forEach((x, i) => (pos[x] = i));
	const dependents: number[][] = Array.from({ length: n }, () => []);
	for (let x = 0; x < n; x++) for (const p of sys.prereqs[x]!) dependents[p]!.push(x);
	return { snapshot, sys, order, pos, dependents };
}

/**
 * Cached index of a snapshot (snapshots are treated as immutable). Throws a
 * CurriculumError with the cycle witness when the effective system is cyclic
 * (validated snapshots never are).
 */
export function curriculumIndex(snapshot: CurriculumSnapshot): CurriculumIndex {
	const cached = indexCache.get(snapshot);
	if (cached) return cached;
	const sys = buildEffectiveSystem(snapshot.items);
	const res = effectiveKahn(sys);
	if (!res.ok) {
		const witness = res.cycle.map((x) => sys.ids[x]!);
		throw new CurriculumError([{ code: "cycle", message: `o sistema efetivo tem ciclo: ${witness.join(" → ")}`, witness }]);
	}
	const idx = indexFromOrder(snapshot, sys, res.order);
	indexCache.set(snapshot, idx);
	return idx;
}

/** Accept either a snapshot or an index. */
export function asIndex(source: CurriculumSnapshot | CurriculumIndex): CurriculumIndex {
	return "sys" in source ? source : curriculumIndex(source);
}
