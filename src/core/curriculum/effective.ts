/**
 * EFFECTIVE clause system of a curriculum snapshot (docs/research/00-SINTESE.md
 * §2.3 + §2.13; r10 §3.1 "sistema de cláusulas com rank", §4.1 "refinamento-
 * marco"; contract header of ./types.ts).
 *
 * Stored clauses are what authors/the model write; every algorithm (rank,
 * certificate, frontier, hours, triggers) runs on the EFFECTIVE system built
 * here, over LIVE items only (status ≠ "deprecated" — retired ids stay in the
 * snapshot as tombstones but leave the system):
 *
 *   • container (has live children): effective = [[...children]] — a
 *     milestone, attained exactly when every child is attained.
 *   • entry(x) — the DNF a learner must satisfy to start x's content:
 *       for each stored alternative A of x (stored `[]` ≡ one empty
 *       alternative = no requirement):
 *         A is INTERNAL (mentions a node strictly inside the parent's subtree,
 *         i.e. a sibling or a sibling's descendant)  → A as is
 *         otherwise                                  → A ∧ entry(parent)
 *     so a container's stored clauses are ENTRY requirements inherited by its
 *     source children, recursively down the tree.
 *   • leaf: effective = entry(x).
 *
 * Decision (documented generalisation of the types.ts header): inheritance is
 * decided PER ALTERNATIVE and "sibling" includes a sibling's descendants. In
 * every case the header describes (a child whose clauses mention no sibling /
 * a child with one alternative through a sibling) the result is identical;
 * the generalisation guarantees the stronger invariant "every route into a
 * subtree passes through its root's entry requirements" even for children
 * with mixed alternatives such as [[sibling], [external]].
 *
 * Dense representation (r10 §11.5 "núcleo TS com ids densos"): live ids are
 * sorted (code-unit order) and mapped to 0..n-1, so integer order equals id
 * order and every tie-break is deterministic. Alternatives are sorted unique
 * int arrays; a DNF is minimised by absorption (A ∨ (A∧B) = A).
 * Internally TRUE = [[]] (one empty alternative) and FALSE = [] (no route —
 * only for broken references); the contract form (`[]` = entry) is produced
 * by `toContractClauses`.
 *
 * The builder is TOTAL: it never throws on a broken snapshot (unknown ids,
 * parent cycles, …) — ./invariants.ts reports those; here they only degrade
 * gracefully (dead alternatives dropped, parent cycles cut) and are recorded
 * in `diagnostics`.
 *
 * Pure and browser-safe.
 */

import type { CurriculumItem, CurriculumSnapshot, NodeKind } from "./types.ts";

/** Hierarchy depth rank: a child's kind rank is strictly greater than its parent's (skips allowed). */
export const KIND_RANK: Readonly<Record<NodeKind, number>> = { domain: 0, area: 1, unit: 2, topic: 3, atom: 4 };

/** Kind used by default for a new container directly below a node of `kind`. */
export const NEXT_KIND: Readonly<Record<NodeKind, NodeKind>> = {
	domain: "area",
	area: "unit",
	unit: "topic",
	topic: "atom",
	atom: "atom",
};

/** Hard cap on effective alternatives per item (AND-combining DNFs multiplies alternatives). */
export const MAX_EFFECTIVE_ALTERNATIVES = 64;

/** DNF over dense ids: each alternative sorted ascending and unique. TRUE = [[]], FALSE = []. */
export type DenseAlternatives = number[][];

export interface EffectiveDiagnostics {
	/** Parent-pointer cycles found (each cut at its smallest id to keep the builder total). */
	parentCycles: string[][];
	/** Items whose effective alternatives hit MAX_EFFECTIVE_ALTERNATIVES and were truncated. */
	overflow: string[];
	/** Stored clause references that do not resolve to a LIVE item (dropped alternatives). */
	deadRefs: { item: string; ref: string }[];
}

export interface EffectiveSystem {
	/** Live ids, sorted by code-unit order (dense id = index). */
	readonly ids: readonly string[];
	/** Every record key of the snapshot (live and retired), sorted by code-unit order. */
	readonly keys: readonly string[];
	readonly index: ReadonlyMap<string, number>;
	/** Live items by dense id. */
	readonly items: readonly CurriculumItem[];
	/** Dense parent (-1 for roots, orphans and cut parent cycles). */
	readonly parent: Int32Array;
	/** Tree depth (roots = 0). */
	readonly depth: Int32Array;
	/** Live children sorted by (order, id). */
	readonly children: readonly (readonly number[])[];
	/** Dense ids of nodes without a parent, sorted. */
	readonly roots: readonly number[];
	/** Parents-before-children traversal (BFS from roots). */
	readonly treeOrder: readonly number[];
	/** Entry requirements (see header). */
	readonly entry: readonly DenseAlternatives[];
	/** Effective clauses. */
	readonly clauses: readonly DenseAlternatives[];
	/** Union of the members of the effective clauses (sorted unique) = predecessors in the union graph. */
	readonly prereqs: readonly (readonly number[])[];
	/** Live soft prerequisites (builds_towards; never gate, but must keep the joint graph acyclic — r3 I3). */
	readonly soft: readonly (readonly number[])[];
	/** Study cost: leaves carry their own hours, containers 0 (milestones are never taught). */
	readonly hoursLo: Float64Array;
	readonly hoursHi: Float64Array;
	readonly diagnostics: EffectiveDiagnostics;
}

// ─── Dense DNF helpers ──────────────────────────────────────────────────────

export const TRUE_DNF: DenseAlternatives = [[]];

function compareIds(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** Sorted-unique union of two sorted-unique int arrays. */
export function mergeSorted(a: readonly number[], b: readonly number[]): number[] {
	const out: number[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length || j < b.length) {
		const x = i < a.length ? a[i]! : Number.POSITIVE_INFINITY;
		const y = j < b.length ? b[j]! : Number.POSITIVE_INFINITY;
		if (x === y) {
			out.push(x);
			i++;
			j++;
		} else if (x < y) {
			out.push(x);
			i++;
		} else {
			out.push(y);
			j++;
		}
	}
	return out;
}

/** Is sorted `a` ⊆ sorted `b`? */
export function isSortedSubset(a: readonly number[], b: readonly number[]): boolean {
	if (a.length > b.length) return false;
	let j = 0;
	for (const x of a) {
		while (j < b.length && b[j]! < x) j++;
		if (j >= b.length || b[j] !== x) return false;
		j++;
	}
	return true;
}

function compareAlternatives(a: readonly number[], b: readonly number[]): number {
	if (a.length !== b.length) return a.length - b.length;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
	return 0;
}

/** Minimise a DNF: drop duplicate and absorbed (superset) alternatives; canonical order (size, then lexicographic). */
export function absorb(alts: DenseAlternatives): DenseAlternatives {
	const sorted = [...alts].sort(compareAlternatives);
	const kept: DenseAlternatives = [];
	for (const alt of sorted) {
		if (kept.some((k) => isSortedSubset(k, alt))) continue;
		kept.push(alt);
	}
	return kept;
}

/** a ∧ b for DNFs, minimised; `overflow` when the product exceeds `cap` alternatives (truncated). */
export function andDnf(a: DenseAlternatives, b: DenseAlternatives, cap = MAX_EFFECTIVE_ALTERNATIVES): { alts: DenseAlternatives; overflow: boolean } {
	const out: DenseAlternatives = [];
	for (const x of a) for (const y of b) out.push(mergeSorted(x, y));
	const min = absorb(out);
	return min.length > cap ? { alts: min.slice(0, cap), overflow: true } : { alts: min, overflow: false };
}

/** Does `alt` hold in the dense state `known` (1 = attained)? */
export function alternativeHolds(alt: readonly number[], known: Uint8Array): boolean {
	for (const y of alt) if (known[y] !== 1) return false;
	return true;
}

/** Is some alternative of `alts` satisfied in `known`? */
export function dnfHolds(alts: DenseAlternatives, known: Uint8Array): boolean {
	for (const alt of alts) if (alternativeHolds(alt, known)) return true;
	return false;
}

// ─── Stored-clause normalisation (string level) ─────────────────────────────

/**
 * Canonical stored clauses: members deduplicated (first occurrence kept),
 * duplicate and absorbed alternatives dropped (first kept), and any empty
 * alternative collapses the whole list to `[]` (entry: TRUE ∨ … = TRUE).
 */
export function normalizeClauses(clauses: readonly (readonly string[])[]): string[][] {
	const alts: string[][] = [];
	for (const alt of clauses) {
		const uniq = [...new Set(alt)];
		if (uniq.length === 0) return [];
		alts.push(uniq);
	}
	const kept: string[][] = [];
	for (let i = 0; i < alts.length; i++) {
		const a = alts[i]!;
		const aSet = new Set(a);
		let absorbed = false;
		for (let j = 0; j < alts.length && !absorbed; j++) {
			if (i === j) continue;
			const b = alts[j]!;
			if (b.length > a.length || !b.every((x) => aSet.has(x))) continue;
			// b ⊆ a: a is absorbed by b, unless they are equal and a comes first.
			if (b.length < a.length || j < i) absorbed = true;
		}
		if (!absorbed) kept.push(a);
	}
	return kept;
}

/** Same stored clauses up to normalisation and alternative/member order? */
export function sameClauses(a: readonly (readonly string[])[], b: readonly (readonly string[])[]): boolean {
	const key = (cs: readonly (readonly string[])[]) =>
		normalizeClauses(cs)
			.map((alt) => [...alt].sort(compareIds).join("\u0001"))
			.sort(compareIds)
			.join("\u0002");
	return key(a) === key(b);
}

// ─── Builder ────────────────────────────────────────────────────────────────

/** Live items sorted by id, unique by id (first key wins). One sort when every key equals its id. */
function liveItemsSorted(items: Readonly<Record<string, CurriculumItem>>, keys: readonly string[]): CurriculumItem[] {
	const live: CurriculumItem[] = [];
	let keyed = true;
	for (const key of keys) {
		const it = items[key]!;
		if (it.id !== key) keyed = false;
		if (it.status !== "deprecated") live.push(it);
	}
	if (keyed) return live;
	const byId = new Map<string, CurriculumItem>();
	for (const it of live) if (!byId.has(it.id)) byId.set(it.id, it);
	return [...byId.values()].sort((a, b) => compareIds(a.id, b.id));
}

const NO_IDS: readonly number[] = Object.freeze([]) as readonly number[];

/** Sort and dedupe a freshly built int list IN PLACE (returns it). */
function sortedUnique(xs: number[]): number[] {
	if (xs.length < 2) return xs;
	xs.sort((a, b) => a - b);
	let w = 1;
	for (let r = 1; r < xs.length; r++) if (xs[r] !== xs[w - 1]) xs[w++] = xs[r]!;
	xs.length = w;
	return xs;
}

/** Cut parent-pointer cycles in place (at the smallest id of each cycle); returns them. */
function cutParentCycles(parent: Int32Array, ids: readonly string[]): string[][] {
	const n = parent.length;
	const state = new Uint8Array(n); // 0 new · 1 on current walk · 2 done
	const cycles: string[][] = [];
	for (let i = 0; i < n; i++) {
		if (state[i] !== 0) continue;
		const path: number[] = [];
		let v = i;
		while (v >= 0 && state[v] === 0) {
			state[v] = 1;
			path.push(v);
			v = parent[v]!;
		}
		if (v >= 0 && state[v] === 1) {
			const cycle = path.slice(path.indexOf(v));
			const cut = Math.min(...cycle);
			parent[cut] = -1;
			cycles.push(cycle.map((c) => ids[c]!));
		}
		for (const p of path) state[p] = 2;
	}
	return cycles;
}

/** Is `a` a proper ancestor of `y` in the (cycle-free) dense parent forest? */
export function isProperAncestor(parent: Int32Array, a: number, y: number): boolean {
	let q = parent[y]!;
	while (q >= 0) {
		if (q === a) return true;
		q = parent[q]!;
	}
	return false;
}

/** Build the effective system of a snapshot's items (total: never throws). */
export function buildEffectiveSystem(items: Readonly<Record<string, CurriculumItem>>): EffectiveSystem {
	const keys = Object.keys(items).sort(compareIds);
	const live = liveItemsSorted(items, keys);
	const n = live.length;
	const ids = live.map((it) => it.id);
	const index = new Map<string, number>();
	for (let i = 0; i < n; i++) index.set(ids[i]!, i);

	const parent = new Int32Array(n).fill(-1);
	for (let i = 0; i < n; i++) {
		const p = live[i]!.parentId;
		if (p !== null) parent[i] = index.get(p) ?? -1;
	}
	const parentCycles = cutParentCycles(parent, ids);

	const childLists: number[][] = new Array<number[]>(n);
	for (let i = 0; i < n; i++) childLists[i] = [];
	const roots: number[] = [];
	for (let i = 0; i < n; i++) {
		const p = parent[i]!;
		if (p >= 0) childLists[p]!.push(i);
		else roots.push(i);
	}
	for (const list of childLists) if (list.length > 1) list.sort((a, b) => live[a]!.order - live[b]!.order || a - b);

	const depth = new Int32Array(n);
	const treeOrder: number[] = [...roots];
	for (let h = 0; h < treeOrder.length; h++) {
		const v = treeOrder[h]!;
		for (const c of childLists[v]!) {
			depth[c] = depth[v]! + 1;
			treeOrder.push(c);
		}
	}

	const deadRefs: { item: string; ref: string }[] = [];
	const overflow: string[] = [];
	const entry: DenseAlternatives[] = new Array<DenseAlternatives>(n);
	const clauses: DenseAlternatives[] = new Array<DenseAlternatives>(n);
	const prereqs: number[][] = new Array<number[]>(n);
	const soft: number[][] = new Array<number[]>(n);
	const hoursLo = new Float64Array(n);
	const hoursHi = new Float64Array(n);

	const isInternal = (alt: readonly number[], p: number): boolean => {
		for (const y of alt) if (y !== p && isProperAncestor(parent, p, y)) return true;
		return false;
	};

	/** One stored alternative in dense form, or null when it cites an id that is not live. */
	const denseAlternative = (item: CurriculumItem, alt: readonly string[]): number[] | null => {
		const dense: number[] = [];
		let dead = false;
		for (const ref of alt) {
			const r = index.get(ref);
			if (r === undefined) {
				deadRefs.push({ item: item.id, ref });
				dead = true;
			} else dense.push(r);
		}
		return dead ? null : sortedUnique(dense);
	};

	for (const x of treeOrder) {
		const item = live[x]!;
		const stored: DenseAlternatives = [];
		if (item.clauses.length === 0) stored.push([]);
		for (const alt of item.clauses) {
			const dense = denseAlternative(item, alt);
			if (dense !== null) stored.push(dense);
		}
		const p = parent[x]!;
		const inherited = p >= 0 ? entry[p]! : TRUE_DNF;
		const inheritsNothing = inherited.length === 1 && inherited[0]!.length === 0;
		let own: DenseAlternatives = [];
		let overflowed = false;
		for (const alt of stored) {
			if (p < 0 || inheritsNothing || isInternal(alt, p)) own.push(alt);
			else if (inherited.length === 1) own.push(mergeSorted(alt, inherited[0]!));
			else {
				const res = andDnf([alt], inherited);
				overflowed ||= res.overflow;
				own.push(...res.alts);
			}
		}
		if (own.length > 1) own = absorb(own);
		if (own.length > MAX_EFFECTIVE_ALTERNATIVES) {
			own = own.slice(0, MAX_EFFECTIVE_ALTERNATIVES);
			overflowed = true;
		}
		if (overflowed) overflow.push(item.id);
		entry[x] = own;
		const kids = childLists[x]!;
		if (kids.length > 0) {
			clauses[x] = [kids.length > 1 ? [...kids].sort((a, b) => a - b) : [...kids]];
		} else {
			clauses[x] = own;
			hoursLo[x] = item.hours.lo;
			hoursHi[x] = item.hours.hi;
		}
		const cs = clauses[x]!;
		if (cs.length === 1) prereqs[x] = cs[0]!;
		else {
			let union: number[] = [];
			for (const alt of cs) union = mergeSorted(union, alt);
			prereqs[x] = union;
		}
		if (item.softPrereqs.length === 0) soft[x] = NO_IDS as number[];
		else {
			const softIds: number[] = [];
			for (const s of item.softPrereqs) {
				const r = index.get(s);
				if (r !== undefined) softIds.push(r);
			}
			soft[x] = sortedUnique(softIds);
		}
	}

	return {
		ids,
		keys,
		index,
		items: live,
		parent,
		depth,
		children: childLists,
		roots,
		treeOrder,
		entry,
		clauses,
		prereqs,
		soft,
		hoursLo,
		hoursHi,
		diagnostics: { parentCycles, overflow, deadRefs },
	};
}

// ─── String-level helpers ───────────────────────────────────────────────────

/** Contract form of a dense DNF: `[]` when an empty alternative holds (entry item). */
export function toContractClauses(sys: EffectiveSystem, alts: DenseAlternatives): string[][] {
	if (alts.some((a) => a.length === 0)) return [];
	return alts.map((a) => a.map((y) => sys.ids[y]!));
}

function denseOf(sys: EffectiveSystem, id: string): number {
	const i = sys.index.get(id);
	if (i === undefined) throw new RangeError(`item "${id}" não existe (ou está aposentado) no sistema efetivo`);
	return i;
}

/** Effective clauses of a live item, in contract form. */
export function effectiveClausesOf(sys: EffectiveSystem, id: string): string[][] {
	return toContractClauses(sys, sys.clauses[denseOf(sys, id)]!);
}

/** Entry requirements of a live item (what a learner needs before starting it), contract form. */
export function entryRequirementsOf(sys: EffectiveSystem, id: string): string[][] {
	return toContractClauses(sys, sys.entry[denseOf(sys, id)]!);
}

/** Live children, in teaching order. */
export function childrenOf(sys: EffectiveSystem, id: string): string[] {
	return sys.children[denseOf(sys, id)]!.map((c) => sys.ids[c]!);
}

/** Is the live item a studyable leaf (atom or unrefined stub)? */
export function isLeaf(sys: EffectiveSystem, id: string): boolean {
	return sys.children[denseOf(sys, id)]!.length === 0;
}

/** Ancestors from the parent up to the root (nearest first). Works on any item, live or not. */
export function ancestorsOf(items: Readonly<Record<string, CurriculumItem>>, id: string): string[] {
	const out: string[] = [];
	const seen = new Set<string>([id]);
	let p = items[id]?.parentId ?? null;
	while (p !== null && !seen.has(p)) {
		out.push(p);
		seen.add(p);
		p = items[p]?.parentId ?? null;
	}
	return out;
}

/** Root → … → id (inclusive). */
export function pathTo(items: Readonly<Record<string, CurriculumItem>>, id: string): string[] {
	return [...ancestorsOf(items, id)].reverse().concat(id);
}

/** Dense live descendants of `x` (excluding x), preorder in teaching order. */
export function denseDescendants(sys: EffectiveSystem, x: number): number[] {
	const out: number[] = [];
	const stack = [...sys.children[x]!].reverse();
	while (stack.length > 0) {
		const v = stack.pop()!;
		out.push(v);
		const kids = sys.children[v]!;
		for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
	}
	return out;
}

/** Live descendants (excluding the item), preorder in teaching order. */
export function descendantsOf(sys: EffectiveSystem, id: string): string[] {
	return denseDescendants(sys, denseOf(sys, id)).map((d) => sys.ids[d]!);
}

/** Studyable leaves under (or equal to) the item, in teaching order. */
export function leavesOf(sys: EffectiveSystem, id: string): string[] {
	const x = denseOf(sys, id);
	if (sys.children[x]!.length === 0) return [id];
	return denseDescendants(sys, x)
		.filter((d) => sys.children[d]!.length === 0)
		.map((d) => sys.ids[d]!);
}

/** Every live studyable leaf, sorted by id. */
export function allLeaves(sys: EffectiveSystem): string[] {
	const out: string[] = [];
	for (let i = 0; i < sys.ids.length; i++) if (sys.children[i]!.length === 0) out.push(sys.ids[i]!);
	return out;
}

/** The unique live root, or null when there is not exactly one. */
export function rootOf(sys: EffectiveSystem): string | null {
	return sys.roots.length === 1 ? sys.ids[sys.roots[0]!]! : null;
}

/** Effective system of a snapshot (no caching; see ./rank.ts curriculumIndex for the cached index). */
export function effectiveSystemOf(snapshot: CurriculumSnapshot): EffectiveSystem {
	return buildEffectiveSystem(snapshot.items);
}
