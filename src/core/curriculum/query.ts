/**
 * Read-side queries for tools, UI zooms and the expansion context pack
 * (docs/research/00-SINTESE.md §2.4(e) passo 1 "contexto (escopo do pai,
 * irmãos, vizinhos, âncoras)", §2.14 três zooms (região / vizinhança ≤ 200
 * nós); r3 §7.2 `pack`, §7.4(b) normalização; r10 §0.3 próximo passo).
 *
 *   normalizeForSearch  NFD + strip combining marks + lowercase + collapse
 *                       non-alphanumerics: "Função de Transferência" and
 *                       "funcao de transferencia" match.
 *   searchItems         title (pt/en), aliases and the last id segment;
 *                       scored exact > prefix > all-tokens > substring.
 *   neighborhood        k-hop BFS over effective prerequisite edges
 *                       (prereqs / dependents / both), optionally hierarchy
 *                       and soft edges; capped (default 200 nodes).
 *   dependencyPath      shortest chain a ⇝ b in the effective graph ("why do
 *                       I need A for B?").
 *   regionSubgraph      a subtree with its internal stored edges and the
 *                       external prerequisites/dependents crossing its border.
 *   itemContext         path, siblings, children, prerequisites, dependents
 *                       and effective clauses of one item.
 *   studyPath           alias of the goal plan (./frontier.ts goalPlan).
 *
 * Pure and browser-safe.
 */

import { ancestorsOf, toContractClauses } from "./effective.ts";
import { goalPlan, type GoalPlan } from "./frontier.ts";
import { asIndex, type CurriculumIndex } from "./rank.ts";
import type { CurriculumItem, CurriculumSnapshot } from "./types.ts";

type Source = CurriculumSnapshot | CurriculumIndex;

export function normalizeForSearch(text: string): string {
	return text
		.normalize("NFD")
		.replace(/\p{M}+/gu, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

export interface SearchHit {
	id: string;
	score: number;
	/** The text that matched best (title, alias or id segment). */
	matched: string;
}

function scoreText(query: string, qTokens: readonly string[], text: string): number {
	const t = normalizeForSearch(text);
	if (t.length === 0) return 0;
	if (t === query) return 100;
	if (t.startsWith(query)) return 80 + Math.min(10, (10 * query.length) / t.length);
	const tokens = t.split(" ");
	if (qTokens.length > 0 && qTokens.every((q) => tokens.some((tok) => tok.startsWith(q)))) return 60 + Math.min(10, (10 * query.length) / t.length);
	if (t.includes(query)) return 40;
	return 0;
}

/** Accent-insensitive search over live items (or all items with `includeRetired`). */
export function searchItems(source: Source, query: string, opts: { limit?: number; includeRetired?: boolean } = {}): SearchHit[] {
	const q = normalizeForSearch(query);
	if (q.length === 0) return [];
	const qTokens = q.split(" ");
	const pool: readonly CurriculumItem[] = opts.includeRetired ? Object.values(("sys" in source ? source.snapshot : source).items) : asIndex(source).sys.items;
	const hits: SearchHit[] = [];
	for (const item of pool) {
		const lastSegment = item.id.slice(item.id.lastIndexOf(".") + 1).replace(/-/g, " ");
		let best = 0;
		let matched = "";
		for (const text of [item.title.pt, item.title.en, ...item.aliases, lastSegment]) {
			const s = scoreText(q, qTokens, text);
			if (s > best) {
				best = s;
				matched = text;
			}
		}
		if (best > 0) hits.push({ id: item.id, score: best, matched });
	}
	hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	return hits.slice(0, opts.limit ?? 20);
}

export interface NeighborhoodOptions {
	/** Max hops (default 2). */
	k?: number;
	direction?: "prereqs" | "dependents" | "both";
	/** Also walk parent/children links (default false). */
	hierarchy?: boolean;
	/** Also walk soft prerequisites (default false). */
	soft?: boolean;
	/** Node cap (default 200, the React Flow zoom limit). */
	limit?: number;
}

/** k-hop neighbourhood: id → hop distance (the start has 0). */
export function neighborhood(source: Source, id: string, opts: NeighborhoodOptions = {}): Map<string, number> {
	const { sys, dependents } = asIndex(source);
	const start = sys.index.get(id);
	const out = new Map<string, number>();
	if (start === undefined) return out;
	const k = opts.k ?? 2;
	const dir = opts.direction ?? "both";
	const limit = opts.limit ?? 200;
	const softDeps = new Map<number, number[]>();
	if (opts.soft)
		for (let x = 0; x < sys.ids.length; x++)
			for (const s of sys.soft[x]!) {
				const list = softDeps.get(s) ?? [];
				list.push(x);
				softDeps.set(s, list);
			}
	const dist = new Map<number, number>([[start, 0]]);
	const queue = [start];
	for (let h = 0; h < queue.length && dist.size < limit; h++) {
		const v = queue[h]!;
		const d = dist.get(v)!;
		if (d >= k) continue;
		const next: number[] = [];
		if (dir !== "dependents") next.push(...sys.prereqs[v]!, ...(opts.soft ? sys.soft[v]! : []));
		if (dir !== "prereqs") next.push(...dependents[v]!, ...(softDeps.get(v) ?? []));
		if (opts.hierarchy) {
			const p = sys.parent[v]!;
			if (p >= 0) next.push(p);
			next.push(...sys.children[v]!);
		}
		for (const w of next) {
			if (dist.has(w)) continue;
			if (dist.size >= limit) break;
			dist.set(w, d + 1);
			queue.push(w);
		}
	}
	for (const [x, d] of dist) out.set(sys.ids[x]!, d);
	return out;
}

/** Shortest chain from `from` to `to` following "is a prerequisite of" edges, or null. */
export function dependencyPath(source: Source, from: string, to: string): string[] | null {
	const { sys, dependents } = asIndex(source);
	const a = sys.index.get(from);
	const b = sys.index.get(to);
	if (a === undefined || b === undefined) return null;
	const prev = new Map<number, number>([[a, -1]]);
	const queue = [a];
	for (let h = 0; h < queue.length; h++) {
		const v = queue[h]!;
		if (v === b) {
			const path: string[] = [];
			for (let c = b; c !== -1; c = prev.get(c)!) path.push(sys.ids[c]!);
			return path.reverse();
		}
		for (const w of dependents[v]!)
			if (!prev.has(w)) {
				prev.set(w, v);
				queue.push(w);
			}
	}
	return null;
}

export interface RegionSubgraph {
	rootId: string;
	/** Live items of the subtree (preorder, teaching order). */
	items: string[];
	/** Stored prerequisite edges [prereq, item] with both ends inside. */
	edges: [string, string][];
	/** Outside items the region's stored clauses require. */
	externalPrereqs: string[];
	/** Outside items whose stored clauses require something inside. */
	externalDependents: string[];
}

/** A subtree with its border (UI region zoom, expansion context). */
export function regionSubgraph(source: Source, rootId: string, opts: { maxDepth?: number } = {}): RegionSubgraph {
	const { sys } = asIndex(source);
	const r = sys.index.get(rootId);
	if (r === undefined) return { rootId, items: [], edges: [], externalPrereqs: [], externalDependents: [] };
	const maxDepth = opts.maxDepth ?? Number.POSITIVE_INFINITY;
	const inside = new Set<number>();
	const items: string[] = [];
	const stack: [number, number][] = [[r, 0]];
	while (stack.length > 0) {
		const [v, d] = stack.pop()!;
		inside.add(v);
		items.push(sys.ids[v]!);
		if (d >= maxDepth) continue;
		const kids = sys.children[v]!;
		for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i]!, d + 1]);
	}
	const edges: [string, string][] = [];
	const extPre = new Set<string>();
	const extDep = new Set<string>();
	for (let x = 0; x < sys.ids.length; x++) {
		const refs = new Set(sys.items[x]!.clauses.flat());
		for (const ref of refs) {
			const y = sys.index.get(ref);
			if (y === undefined) continue;
			if (inside.has(x) && inside.has(y)) edges.push([ref, sys.ids[x]!]);
			else if (inside.has(x)) extPre.add(ref);
			else if (inside.has(y)) extDep.add(sys.ids[x]!);
		}
	}
	return { rootId, items, edges, externalPrereqs: [...extPre].sort(), externalDependents: [...extDep].sort() };
}

export interface ItemContext {
	item: CurriculumItem;
	/** Root → parent. */
	path: string[];
	siblings: string[];
	children: string[];
	/** Ids mentioned in the stored clauses. */
	prereqs: string[];
	/** Items whose stored clauses mention this one. */
	dependents: string[];
	/** Effective clauses (contract form). */
	effectiveClauses: string[][];
	isLeaf: boolean;
}

/** Everything an expansion/tutor prompt needs about one live item. */
export function itemContext(source: Source, id: string): ItemContext | null {
	const idx = asIndex(source);
	const { sys } = idx;
	const x = sys.index.get(id);
	if (x === undefined) return null;
	const item = sys.items[x]!;
	const p = sys.parent[x]!;
	const dependents: string[] = [];
	for (let y = 0; y < sys.ids.length; y++) if (sys.items[y]!.clauses.some((alt) => alt.includes(id))) dependents.push(sys.ids[y]!);
	return {
		item,
		path: [...ancestorsOf(idx.snapshot.items, id)].reverse(),
		siblings: p >= 0 ? sys.children[p]!.filter((c) => c !== x).map((c) => sys.ids[c]!) : [],
		children: sys.children[x]!.map((c) => sys.ids[c]!),
		prereqs: [...new Set(item.clauses.flat())].sort(),
		dependents,
		effectiveClauses: toContractClauses(sys, sys.clauses[x]!),
		isLeaf: sys.children[x]!.length === 0,
	};
}

/** Study path to the goals (the greedy goal plan; see ./frontier.ts). */
export function studyPath(source: Source, attained: Iterable<string>, goals: readonly string[]): GoalPlan {
	return goalPlan(source, attained, goals);
}
