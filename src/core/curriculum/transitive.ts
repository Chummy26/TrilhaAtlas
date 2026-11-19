/**
 * Transitive reduction of hard prerequisites (docs/research/00-SINTESE.md §2.7
 * "regras de aresta do open-mastery: necessário, não suficiente e direta, não
 * transitiva, aplicadas com redução transitiva"; r3 §4.4 I5; open-mastery
 * §2.4 regra 2 and §5.4 I8).
 *
 * A member p of a stored alternative A of item x is REDUNDANT when another
 * member q ∈ A already requires p on every route: p ∈ mand(q) (r10 §3.6).
 * Removing p then leaves the family of feasible states unchanged (for a
 * feasible K: A ⊆ K ⇔ A∖{p} ⊆ K, because q ∈ K ⇒ mand(q) ⊆ K).
 *
 * We detect p ∈ mand(q) SOUNDLY and cheaply by a bounded backward search
 * from q through HARD links only — items whose effective clauses have a
 * single alternative (containers included: a milestone hard-requires every
 * child) — pruned to the slice of the topological order between p and q. This finds the classic shortcut A→B→C stored as C:[A,B] and
 * "unit U + one of U's atoms". It can miss redundancy that only shows through
 * an intersection of alternatives; missing a redundancy is harmless (it is a
 * lint), reporting a false one is impossible.
 *
 * One more guard: removing p must not flip A from internal to external (see
 * ./effective.ts), so a p that is A's only member inside x's parent subtree is
 * never reported.
 *
 * There is no "removePrereq" op: findings surface as lint warnings
 * (./invariants.ts) and seeds can be reduced before they enter the ledger
 * (./ledger.ts applySeedFiles with reduceTransitive).
 *
 * Pure and browser-safe.
 */

import { isProperAncestor, normalizeClauses, type EffectiveSystem } from "./effective.ts";
import { asIndex, effectiveKahn, type CurriculumIndex } from "./rank.ts";
import type { CurriculumItem, CurriculumSnapshot } from "./types.ts";

export interface RedundantPrereq {
	item: string;
	/** Index of the stored alternative that holds the redundant member. */
	clauseIndex: number;
	prereq: string;
	/** The other member of the same alternative that already requires `prereq`. */
	impliedBy: string;
}

export interface RedundancyOptions {
	/** Only inspect these items (default: every live item). */
	items?: Iterable<string>;
	/** Visit cap of each backward search (default 512). */
	maxVisits?: number;
	/** Dense topological order of `sys` when already known (computed with Kahn otherwise). */
	order?: readonly number[];
}

/**
 * Does `q` hard-require `p`? Bounded backward search from q through
 * single-alternative effective links, pruned to nodes ranked after p (a
 * prerequisite chain ending at p only climbs in the topological order).
 */
function hardRequires(sys: EffectiveSystem, pos: Int32Array, q: number, p: number, maxVisits: number): boolean {
	const floor = pos[p]!;
	const seen = new Set<number>();
	const stack = [q];
	while (stack.length > 0 && seen.size < maxVisits) {
		const v = stack.pop()!;
		const alts = sys.clauses[v]!;
		if (alts.length !== 1) continue;
		for (const y of alts[0]!) {
			if (y === p) return true;
			if (pos[y]! < floor || seen.has(y)) continue;
			seen.add(y);
			stack.push(y);
		}
	}
	return false;
}

/** Redundant members of stored alternatives of an ACYCLIC effective system (a cyclic one yields []: the cycle check owns it). */
export function redundantPrereqsOf(sys: EffectiveSystem, opts: RedundancyOptions = {}): RedundantPrereq[] {
	const maxVisits = opts.maxVisits ?? 512;
	let order = opts.order;
	if (!order) {
		const res = effectiveKahn(sys);
		if (!res.ok) return [];
		order = res.order;
	}
	const pos = new Int32Array(sys.ids.length);
	order.forEach((x, i) => (pos[x] = i));
	const targets = opts.items ? [...opts.items].map((id) => sys.index.get(id)).filter((x): x is number => x !== undefined) : sys.ids.map((_, i) => i);
	const out: RedundantPrereq[] = [];
	for (const x of [...new Set(targets)].sort((a, b) => a - b)) {
		const item = sys.items[x]!;
		const parent = sys.parent[x]!;
		item.clauses.forEach((alt, clauseIndex) => {
			if (alt.length < 2) return;
			const members = [...new Set(alt)].map((id) => sys.index.get(id)).filter((m): m is number => m !== undefined);
			if (members.length < 2) return;
			const internal = (m: number) => parent >= 0 && m !== parent && isProperAncestor(sys.parent, parent, m);
			let internalLeft = members.filter(internal).length;
			const removed = new Set<number>();
			for (const p of members) {
				if (internal(p) && internalLeft <= 1) continue;
				for (const q of members) {
					if (q === p || removed.has(q) || pos[q]! < pos[p]!) continue;
					if (!hardRequires(sys, pos, q, p, maxVisits)) continue;
					removed.add(p);
					if (internal(p)) internalLeft--;
					out.push({ item: item.id, clauseIndex, prereq: sys.ids[p]!, impliedBy: sys.ids[q]! });
					break;
				}
			}
		});
	}
	return out;
}

/** Redundant members of stored alternatives of a valid snapshot (see header). */
export function findRedundantPrereqs(source: CurriculumSnapshot | CurriculumIndex, opts: RedundancyOptions = {}): RedundantPrereq[] {
	const idx = asIndex(source);
	return redundantPrereqsOf(idx.sys, { order: idx.order, ...opts });
}

/** Stored clauses of `item` with the given redundant members removed (normalised). */
export function reduceStoredClauses(item: Pick<CurriculumItem, "id" | "clauses">, redundant: readonly RedundantPrereq[]): string[][] {
	const drop = new Map<number, Set<string>>();
	for (const r of redundant) {
		if (r.item !== item.id) continue;
		const set = drop.get(r.clauseIndex) ?? new Set<string>();
		set.add(r.prereq);
		drop.set(r.clauseIndex, set);
	}
	if (drop.size === 0) return item.clauses.map((alt) => [...alt]);
	return normalizeClauses(item.clauses.map((alt, i) => alt.filter((id) => !drop.get(i)?.has(id))));
}
