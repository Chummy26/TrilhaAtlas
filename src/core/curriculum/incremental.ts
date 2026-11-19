/**
 * Incremental acyclicity: Pearce–Kelly dynamic topological order SEEDED by
 * Kahn (docs/research/00-SINTESE.md §2.13 "Pearce–Kelly ingênuo é patológico
 * (9,6 s), mas semeado com a ordem de Kahn cai para 8,4 ms; inserções
 * incrementais: 2–3 µs"; r10 §6.2 código testado, §11.6 conclusões (1)–(2)).
 *
 * The graph is stored AS a topological order. Inserting u → v with
 * ord(u) > ord(v): (1) forward search from v bounded by ord < ord(u) — reaching
 * u means a cycle, returned as a witness [u, …, u] whose consecutive pairs are
 * edges (the new one included); (2) backward search from u bounded by
 * ord > ord(v); (3) the affected nodes are re-slotted, ancestors of u before
 * descendants of v. Cost ∝ the affected region. Removing an edge never
 * reorders.
 *
 * Loading a whole graph edge by edge from an arbitrary order is pathological
 * (r10 §11.6), so the only constructors seed the order with Kahn
 * (./rank.ts). applyPatch revalidates the whole domain (milliseconds, r10
 * §11.6 (1)); this structure serves interactive/agent pre-checks such as
 * `checkPrereqCandidate` ("would this prerequisite create a cycle?").
 *
 * Pure and browser-safe.
 */

import { buildEffectiveSystem, denseDescendants, isProperAncestor, normalizeClauses } from "./effective.ts";
import { curriculumIndex, kahnOrder } from "./rank.ts";
import type { CurriculumSnapshot, ValidationError } from "./types.ts";

export type AddEdgeResult = { ok: true; reordered: number } | { ok: false; cycle: string[] };

export class DynamicTopoOrder {
	private readonly ord = new Map<string, number>();
	private readonly slots: string[] = [];
	private readonly out = new Map<string, Set<string>>();
	private readonly inn = new Map<string, Set<string>>();

	private constructor() {}

	/** Seed from nodes + edges [u, v] (u before v) with Kahn; a cyclic input returns the witness. */
	static seed(
		nodes: Iterable<string>,
		edges: Iterable<readonly [string, string]>,
	): { ok: true; dag: DynamicTopoOrder } | { ok: false; cycle: string[] } {
		const ids = [...new Set(nodes)].sort();
		const index = new Map<string, number>();
		ids.forEach((id, i) => index.set(id, i));
		const preds: Set<number>[] = ids.map(() => new Set<number>());
		const edgeList: [string, string][] = [];
		for (const [u, v] of edges) {
			const iu = index.get(u);
			const iv = index.get(v);
			if (iu === undefined || iv === undefined) throw new RangeError(`aresta ${u} → ${v} com extremidade desconhecida`);
			preds[iv]!.add(iu);
			edgeList.push([u, v]);
		}
		const res = kahnOrder(
			ids.length,
			preds.map((s) => [...s].sort((a, b) => a - b)),
		);
		if (!res.ok) return { ok: false, cycle: res.cycle.map((x) => ids[x]!) };
		const dag = new DynamicTopoOrder();
		for (const x of res.order) dag.addNode(ids[x]!);
		for (const [u, v] of edgeList) {
			dag.out.get(u)!.add(v);
			dag.inn.get(v)!.add(u);
		}
		return { ok: true, dag };
	}

	/** Seed from a snapshot's effective ∪ soft graph (its cached Kahn order). Throws on a cyclic snapshot. */
	static fromSnapshot(snapshot: CurriculumSnapshot): DynamicTopoOrder {
		const { sys, order } = curriculumIndex(snapshot);
		const dag = new DynamicTopoOrder();
		for (const x of order) dag.addNode(sys.ids[x]!);
		for (let x = 0; x < sys.ids.length; x++) {
			const v = sys.ids[x]!;
			for (const p of [...sys.prereqs[x]!, ...sys.soft[x]!]) {
				const u = sys.ids[p]!;
				dag.out.get(u)!.add(v);
				dag.inn.get(v)!.add(u);
			}
		}
		return dag;
	}

	get size(): number {
		return this.ord.size;
	}

	hasNode(v: string): boolean {
		return this.ord.has(v);
	}

	hasEdge(u: string, v: string): boolean {
		return this.out.get(u)?.has(v) ?? false;
	}

	/** Position of `v` in the maintained order. */
	position(v: string): number {
		const p = this.ord.get(v);
		if (p === undefined) throw new RangeError(`nó desconhecido: ${v}`);
		return p;
	}

	/** Append a new node at the end of the order (no edges yet). */
	addNode(v: string): void {
		if (this.ord.has(v)) throw new RangeError(`nó duplicado: ${v}`);
		this.ord.set(v, this.slots.length);
		this.slots.push(v);
		this.out.set(v, new Set());
		this.inn.set(v, new Set());
	}

	/** Forward search from v bounded by ord < ord(u); a path to u closes a cycle. */
	private findPath(u: string, v: string, ub: number): { path: string[] | null; visited: string[] } {
		const parent = new Map<string, string | null>([[v, null]]);
		const visited: string[] = [];
		const stack = [v];
		while (stack.length > 0) {
			const n = stack.pop()!;
			visited.push(n);
			for (const w of this.out.get(n)!) {
				if (w === u) {
					const path: string[] = [];
					for (let c: string | null = n; c !== null; c = parent.get(c)!) path.push(c);
					return { path: path.reverse(), visited };
				}
				if (this.ord.get(w)! < ub && !parent.has(w)) {
					parent.set(w, n);
					stack.push(w);
				}
			}
		}
		return { path: null, visited };
	}

	/** Would adding u → v close a cycle? Returns the witness [u, v, …, u] or null. Never mutates. */
	wouldCreateCycle(u: string, v: string): string[] | null {
		const ou = this.ord.get(u);
		const ov = this.ord.get(v);
		if (ou === undefined || ov === undefined) throw new RangeError(`aresta ${u} → ${v} com extremidade desconhecida`);
		if (u === v) return [u, u];
		if (ou < ov || this.hasEdge(u, v)) return null;
		const { path } = this.findPath(u, v, ou);
		return path ? [u, ...path, u] : null;
	}

	/** Insert u → v ("u is a prerequisite of v"), keeping the order topological. */
	addEdge(u: string, v: string): AddEdgeResult {
		const ou = this.ord.get(u);
		const ov = this.ord.get(v);
		if (ou === undefined || ov === undefined) throw new RangeError(`aresta ${u} → ${v} com extremidade desconhecida`);
		if (u === v) return { ok: false, cycle: [u, u] };
		if (this.hasEdge(u, v)) return { ok: true, reordered: 0 };
		let reordered = 0;
		if (ou > ov) {
			const { path, visited: deltaF } = this.findPath(u, v, ou);
			if (path) return { ok: false, cycle: [u, ...path, u] };
			const seenB = new Set<string>([u]);
			const deltaB: string[] = [];
			const stackB = [u];
			while (stackB.length > 0) {
				const n = stackB.pop()!;
				deltaB.push(n);
				for (const w of this.inn.get(n)!)
					if (this.ord.get(w)! > ov && !seenB.has(w)) {
						seenB.add(w);
						stackB.push(w);
					}
			}
			const byOrd = (a: string, b: string) => this.ord.get(a)! - this.ord.get(b)!;
			deltaB.sort(byOrd);
			deltaF.sort(byOrd);
			const moved = [...deltaB, ...deltaF];
			const slots = moved.map((n) => this.ord.get(n)!).sort((a, b) => a - b);
			moved.forEach((n, i) => {
				this.ord.set(n, slots[i]!);
				this.slots[slots[i]!] = n;
			});
			reordered = moved.length;
		}
		this.out.get(u)!.add(v);
		this.inn.get(v)!.add(u);
		return { ok: true, reordered };
	}

	removeEdge(u: string, v: string): void {
		this.out.get(u)?.delete(v);
		this.inn.get(v)?.delete(u);
	}

	/** The maintained topological order (the certificate). */
	order(): string[] {
		return [...this.slots];
	}

	edges(): [string, string][] {
		const es: [string, string][] = [];
		for (const [u, vs] of this.out) for (const v of vs) es.push([u, v]);
		return es;
	}

	clone(): DynamicTopoOrder {
		const c = new DynamicTopoOrder();
		for (const v of this.slots) c.addNode(v);
		for (const [u, vs] of this.out) for (const v of vs) {
			c.out.get(u)!.add(v);
			c.inn.get(v)!.add(u);
		}
		return c;
	}
}

/**
 * Agent pre-check: would adding `prereq` to alternative `clauseIndex` of
 * `item` keep the effective system acyclic and the hierarchy rule intact?
 * The effective change is confined to `item`'s subtree (inherited entry
 * requirements flow downwards), so only the new effective edges of that
 * subtree are inserted into a Kahn-seeded Pearce–Kelly order.
 */
export function checkPrereqCandidate(
	snapshot: CurriculumSnapshot,
	item: string,
	prereq: string,
	clauseIndex = 0,
): { ok: true } | { ok: false; error: ValidationError } {
	const base = curriculumIndex(snapshot);
	const x = base.sys.index.get(item);
	const p = base.sys.index.get(prereq);
	if (x === undefined) return { ok: false, error: { code: "unknown-id", message: `item "${item}" não existe ou está aposentado`, witness: [item] } };
	if (p === undefined) return { ok: false, error: { code: "unknown-id", message: `pré-requisito "${prereq}" não existe ou está aposentado`, witness: [prereq] } };
	if (x === p) return { ok: false, error: { code: "cycle", message: `${item} não pode exigir a si mesmo`, witness: [item, item] } };
	if (isProperAncestor(base.sys.parent, p, x) || isProperAncestor(base.sys.parent, x, p))
		return { ok: false, error: { code: "hierarchy", message: `${item} e ${prereq} estão na mesma linhagem (ancestral/descendente)`, witness: [item, prereq] } };
	const stored = base.sys.items[x]!;
	const alts = stored.clauses.length > 0 ? stored.clauses.map((a) => [...a]) : [[]];
	if (clauseIndex < 0 || clauseIndex >= alts.length)
		return { ok: false, error: { code: "schema", message: `clauseIndex ${clauseIndex} fora do intervalo (${alts.length} alternativa(s))`, witness: [item] } };
	alts[clauseIndex]!.push(prereq);
	const next = buildEffectiveSystem({ ...snapshot.items, [item]: { ...stored, clauses: normalizeClauses(alts) } });
	const dag = DynamicTopoOrder.fromSnapshot(snapshot);
	for (const d of [x, ...denseDescendants(next, x)]) {
		const before = new Set(base.sys.prereqs[d]!);
		for (const y of next.prereqs[d]!) {
			if (before.has(y)) continue;
			const res = dag.addEdge(next.ids[y]!, next.ids[d]!);
			if (!res.ok)
				return { ok: false, error: { code: "cycle", message: `exigir ${prereq} em ${item} cria o ciclo ${res.cycle.join(" → ")}`, witness: res.cycle } };
		}
	}
	return { ok: true };
}
