/**
 * Learner-state geometry over the effective system: fringes, mandatory
 * items, hour bounds and the greedy goal plan (docs/research/00-SINTESE.md
 * §2.6 "o que estudar agora", §2.13 "fronteira nunca fica vazia"; r10 §2.2
 * fronteiras, §3.3 teorema LS-rank, §3.6 cotas de horas, §3.7 política de
 * seleção, §11.4).
 *
 * The learner hands us the set ATTAINED of node ids (monotonic,
 * learner/types.ts). Its CLOSURE K is computed here:
 *   • a container id in the input is LIFTED to all its CURRENT descendant
 *     leaves (refine_lift, r10 §4.1: an old "x attained" survives refinement
 *     of x). Callers therefore pass the ids the learner attained AS LEAVES (or
 *     placed explicitly); passing a container id that was only rolled up
 *     would also attain children added to it later (addItem tightens a
 *     milestone, it must not hand out the new child for free);
 *   • leaves keep their own flag; containers are attained by ROLLUP exactly
 *     when every live child is (milestones are derived, never taught);
 *   • unknown and retired ids are ignored (stale learner state).
 * Studyable items are LEAVES only (atoms and unrefined stubs).
 *
 *   outerFringe(K) = leaves q ∉ K with an effective alternative ⊆ K — the
 *                    "ready to learn" set (LS-rank (e)); non-empty while
 *                    K ≠ Q on a valid snapshot (LS-rank (d)).
 *   innerFringe(K) = attained leaves q whose removal (q and the containers
 *                    that roll up through it) leaves every other attained item
 *                    that had a satisfied alternative still satisfied (the
 *                    KST inner fringe when K is feasible).
 *   mandatory(t)   = mand(t) = {t} ∪ ⋂_{C ∈ cl t} ⋃_{c ∈ C} mand(c): items in
 *                    EVERY feasible state containing t (r10 §3.6), computed in
 *                    topological order over t's ancestor cone with bitsets
 *                    released after their last use (no recursion, no |cone|²
 *                    memory).
 *   goalPlan       = greedy concrete plan (r10 §3.6 "escolher a cláusula de
 *                    menor custo estimado e unir"): walk the order backwards
 *                    from the goals, for each needed item pick the alternative
 *                    with the least MARGINAL additive estimate; the plan's
 *                    Σ hi is the upper bound, max(Σ_{mand_K} lo, h_max) the
 *                    lower bound, where mand_K is mand relative to K (= mand∖K
 *                    for a feasible K; for an infeasible K, mand∖K would count
 *                    prerequisites of attained items that the plan never
 *                    studies and break LB ≤ UB); `study` is a learning word
 *                    (topological).
 *   goalFrontier   = outerFringe ∩ plan (r10 §0.3: the next step is computed;
 *                    the LLM only chooses inside this set).
 *   interiorState  = conservative repair after a tightening patch: the
 *                    largest feasible sub-state (r10 §3.4; the default);
 *   inferredRepair = optimistic repair: keep everything, infer the cheapest
 *                    missing prerequisites (to confirm with a probe).
 * Neither touches learner records: they only compute sets. The learner store
 * keeps `attainedAt` (monotonic) and the integration decides what `dropped`
 * (re-teach) and `inferred` (probe) mean for it.
 *
 * Pure and browser-safe.
 */

import { denseDescendants } from "./effective.ts";
import { lowerBoundHmax, upperBoundAdditive } from "./hours.ts";
import { asIndex, forwardChain, type CurriculumIndex } from "./rank.ts";
import { CurriculumError, type CurriculumSnapshot, type Hours } from "./types.ts";

type Source = CurriculumSnapshot | CurriculumIndex;

// ─── Closure ────────────────────────────────────────────────────────────────

/** Dense closure of an attained set (lift containers, roll up milestones). */
export function attainedClosure(source: Source, attained: Iterable<string>): Uint8Array {
	const { sys } = asIndex(source);
	const known = new Uint8Array(sys.ids.length);
	for (const id of attained) {
		const x = sys.index.get(id);
		if (x === undefined) continue;
		if (sys.children[x]!.length === 0) known[x] = 1;
		else for (const d of denseDescendants(sys, x)) if (sys.children[d]!.length === 0 && !sys.items[d]!.reinforcementFor) known[d] = 1;
	}
	for (let h = sys.treeOrder.length - 1; h >= 0; h--) {
		const x = sys.treeOrder[h]!;
		const kids = sys.children[x]!;
		if (kids.length === 0) continue;
		let all = true;
		for (const c of kids)
			if (known[c] !== 1 && !sys.items[c]!.reinforcementFor) {
				all = false;
				break;
			}
		known[x] = all ? 1 : 0;
	}
	return known;
}

/** Ids in the closure, in topological order. */
export function closureIds(source: Source, attained: Iterable<string>): string[] {
	const idx = asIndex(source);
	const known = attainedClosure(idx, attained);
	return idx.order.filter((x) => known[x] === 1).map((x) => idx.sys.ids[x]!);
}

function satisfiedIn(alts: readonly (readonly number[])[], known: Uint8Array, removed?: ReadonlySet<number>): boolean {
	for (const alt of alts) {
		let ok = true;
		for (const y of alt)
			if (known[y] !== 1 || (removed !== undefined && removed.has(y))) {
				ok = false;
				break;
			}
		if (ok) return true;
	}
	return false;
}

/** Is the closure of `attained` a feasible state (every attained item has a satisfied alternative)? */
export function isFeasibleState(source: Source, attained: Iterable<string>): boolean {
	const { sys } = asIndex(source);
	const known = attainedClosure(source, attained);
	for (let x = 0; x < sys.ids.length; x++) if (known[x] === 1 && !satisfiedIn(sys.clauses[x]!, known)) return false;
	return true;
}

// ─── State repair (r10 §3.4) ────────────────────────────────────────────────

export interface StateRepair {
	/** Attained leaves of the repaired state, topological order. */
	attained: string[];
	/** Input leaves the repair removed (interior) — empty for the inference repair. */
	dropped: string[];
	/** Leaves the repair adds as INFERRED (to confirm with a quick probe) — empty for the interior. */
	inferred: string[];
}

function leafIdsIn(idx: CurriculumIndex, known: Uint8Array): string[] {
	const { sys, order } = idx;
	const out: string[] = [];
	for (const x of order) if (known[x] === 1 && sys.children[x]!.length === 0) out.push(sys.ids[x]!);
	return out;
}

/**
 * Conservative repair (the default, SÍNTESE §2.13): the INTERIOR of the
 * closure of `attained` — its largest feasible sub-state, by forward chaining
 * restricted to it (r10 §3.4, §11.1 item 7). Never infers learning; after an
 * `addPrereq`, `refine` or `retire` it drops exactly the leaves whose every
 * route lost a prerequisite (and what depended on them).
 */
export function interiorState(source: Source, attained: Iterable<string>): StateRepair {
	const idx = asIndex(source);
	const { sys } = idx;
	const closure = attainedClosure(idx, attained);
	const { known } = forwardChain(sys.ids.length, sys.clauses, (x) => closure[x] === 1);
	const dropped: string[] = [];
	for (const x of idx.order) if (closure[x] === 1 && known[x] !== 1 && sys.children[x]!.length === 0) dropped.push(sys.ids[x]!);
	return { attained: leafIdsIn(idx, known), dropped, inferred: [] };
}

/**
 * Optimistic repair (r10 §3.4 "inferência otimista marcada", r3 §4.5
 * migração): keep every attained item and INFER the cheapest missing
 * prerequisites so the state becomes feasible again ("surmise": who masters
 * v probably masters its prerequisites). Items are visited dependents-first
 * (reverse topological order); an attained or already-inferred item without
 * a satisfied alternative gets the alternative with the least additive
 * estimate of its unknown members. The result is always a feasible state
 * containing the closure of `attained`; `inferred` are the new leaves (the
 * caller marks them `inferred` and schedules a probe).
 */
export function inferredRepair(source: Source, attained: Iterable<string>): StateRepair {
	const idx = asIndex(source);
	const { sys, order } = idx;
	const closure = attainedClosure(idx, attained);
	const ub = upperBoundAdditive(idx, closure);
	const inState = closure.slice();
	for (let i = order.length - 1; i >= 0; i--) {
		const x = order[i]!;
		if (inState[x] !== 1 || satisfiedIn(sys.clauses[x]!, inState)) continue;
		let best: readonly number[] = [];
		let bestCost = Number.POSITIVE_INFINITY;
		for (const alt of sys.clauses[x]!) {
			let cost = 0;
			for (const y of alt) if (inState[y] !== 1) cost += ub[y]!;
			if (cost < bestCost) {
				bestCost = cost;
				best = alt;
			}
		}
		for (const y of best) inState[y] = 1;
	}
	const leaves: number[] = [];
	for (const x of order) if (inState[x] === 1 && sys.children[x]!.length === 0) leaves.push(x);
	const repaired = attainedClosure(idx, leaves.map((x) => sys.ids[x]!));
	const inferred = leaves.filter((x) => closure[x] !== 1).map((x) => sys.ids[x]!);
	return { attained: leafIdsIn(idx, repaired), dropped: [], inferred };
}

// ─── Fringes ────────────────────────────────────────────────────────────────

function denseOuterFringe(idx: CurriculumIndex, known: Uint8Array): number[] {
	const { sys, order } = idx;
	const out: number[] = [];
	for (const x of order) if (known[x] !== 1 && sys.children[x]!.length === 0 && satisfiedIn(sys.clauses[x]!, known)) out.push(x);
	return out;
}

/** Leaves ready to learn now, in topological order. */
export function outerFringe(source: Source, attained: Iterable<string>): string[] {
	const idx = asIndex(source);
	return denseOuterFringe(idx, attainedClosure(idx, attained)).map((x) => idx.sys.ids[x]!);
}

/** Attained leaves that can be "un-learned" alone (see header), in topological order. */
export function innerFringe(source: Source, attained: Iterable<string>): string[] {
	const idx = asIndex(source);
	const { sys, order, dependents } = idx;
	const known = attainedClosure(idx, attained);
	const out: string[] = [];
	for (const q of order) {
		if (known[q] !== 1 || sys.children[q]!.length > 0) continue;
		const removed = new Set<number>([q]);
		for (let a = sys.parent[q]!; a >= 0 && known[a] === 1; a = sys.parent[a]!) removed.add(a);
		let ok = true;
		outer: for (const r of removed)
			for (const d of dependents[r]!) {
				if (known[d] !== 1 || removed.has(d)) continue;
				if (satisfiedIn(sys.clauses[d]!, known) && !satisfiedIn(sys.clauses[d]!, known, removed)) {
					ok = false;
					break outer;
				}
			}
		if (ok) out.push(sys.ids[q]!);
	}
	return out;
}

/** Leaves that become ready once `id` (and the milestones it completes) is attained. */
export function unlockedBy(source: Source, attained: Iterable<string>, id: string): string[] {
	const idx = asIndex(source);
	const list = [...attained];
	const before = new Set(denseOuterFringe(idx, attainedClosure(idx, list)));
	const x = idx.sys.index.get(id);
	return denseOuterFringe(idx, attainedClosure(idx, [...list, id]))
		.filter((y) => !before.has(y) && y !== x)
		.map((y) => idx.sys.ids[y]!);
}

// ─── mand(t) ────────────────────────────────────────────────────────────────

function requireDense(idx: CurriculumIndex, id: string): number {
	const x = idx.sys.index.get(id);
	if (x === undefined) throw new CurriculumError([{ code: "unknown-id", message: `meta "${id}" não existe (ou está aposentada)`, witness: [id] }]);
	return x;
}

/**
 * Dense mand(t) for several targets (r10 §3.6), as member lists. Sets are
 * bitsets over the targets' ancestor cone (cone-local indices) built in
 * topological order; a set is released as soon as its last dependent inside
 * the cone has consumed it, so memory follows the width of the cone instead
 * of |cone|² (a 20 000-node domain stays in a few MB).
 *
 * With `known` it computes mand RELATIVE to the state K (the goal plan's
 * view): mand_K(x) = ∅ for x ∈ K, else {x} ∪ ⋂_C ⋃_{c∈C} mand_K(c). Every
 * plan from K that treats K as given contains mand_K(t), so Σ lo(mand_K(t))
 * never exceeds the plan's hours; for a FEASIBLE K it equals mand(t) ∖ K
 * (mand(c) ⊆ K for every c ∈ K). Without `known` it is the plain mand(t).
 */
function denseMandatory(idx: CurriculumIndex, targets: readonly number[], known?: Uint8Array): Map<number, number[]> {
	const { sys, pos } = idx;
	const n = sys.ids.length;
	const given = (x: number) => known !== undefined && known[x] === 1;
	const inCone = new Uint8Array(n);
	const stack: number[] = [];
	for (const t of targets)
		if (inCone[t] === 0) {
			inCone[t] = 1;
			stack.push(t);
		}
	const cone: number[] = [];
	while (stack.length > 0) {
		const v = stack.pop()!;
		cone.push(v);
		if (given(v)) continue; // mand_K(v) = ∅: its prerequisites are not consulted through v
		for (const p of sys.prereqs[v]!)
			if (inCone[p] === 0) {
				inCone[p] = 1;
				stack.push(p);
			}
	}
	cone.sort((a, b) => pos[a]! - pos[b]!);
	const local = new Int32Array(n).fill(-1);
	cone.forEach((x, i) => (local[x] = i));
	const words = (cone.length + 31) >>> 5;
	const uses = new Int32Array(n);
	for (const x of cone) if (!given(x)) for (const p of sys.prereqs[x]!) uses[p]!++;
	const keep = new Uint8Array(n);
	for (const t of targets) keep[t] = 1;
	const sets: (Uint32Array | null)[] = new Array<Uint32Array | null>(cone.length).fill(null);
	for (let i = 0; i < cone.length; i++) {
		const x = cone[i]!;
		if (given(x)) {
			sets[i] = new Uint32Array(words);
			continue;
		}
		let inter: Uint32Array | null = null;
		for (const alt of sys.clauses[x]!) {
			const union = new Uint32Array(words);
			for (const c of alt) {
				const m = sets[local[c]!]!;
				for (let w = 0; w < words; w++) union[w]! |= m[w]!;
			}
			if (inter === null) inter = union;
			else for (let w = 0; w < words; w++) inter[w]! &= union[w]!;
		}
		const res = inter ?? new Uint32Array(words);
		res[i >>> 5]! |= 1 << (i & 31);
		sets[i] = res;
		for (const p of sys.prereqs[x]!) if (--uses[p]! === 0 && keep[p] === 0) sets[local[p]!] = null;
	}
	const out = new Map<number, number[]>();
	for (const t of targets) {
		const bits = sets[local[t]!]!;
		const members: number[] = [];
		for (let i = 0; i < cone.length; i++) if ((bits[i >>> 5]! >>> (i & 31)) & 1) members.push(cone[i]!);
		out.set(t, members);
	}
	return out;
}

/**
 * mand(t): items present in every feasible state that contains `target`, in
 * topological order. Exact on leaves; a container that is forced only by
 * ROLLUP (e.g. t is its only child) is in every such state but not listed —
 * containers cost 0 h, so the hour bounds are unaffected.
 */
export function mandatory(source: Source, target: string): string[] {
	const idx = asIndex(source);
	const t = requireDense(idx, target);
	const m = denseMandatory(idx, [t]).get(t)!;
	return [...m].sort((a, b) => idx.pos[a]! - idx.pos[b]!).map((x) => idx.sys.ids[x]!);
}

// ─── Goal plan ──────────────────────────────────────────────────────────────

export interface GoalPlan {
	goals: string[];
	/** Every item the plan newly attains (milestones included), topological order. */
	items: string[];
	/** Leaves to study, topological order — a learning word from the current state when it is feasible. */
	study: string[];
	/** Σ hours of `study`. */
	hours: Hours;
	/**
	 * Items every plan from the current state must still attain: mand_K of the
	 * goals (= mand ∖ K when K is feasible; see denseMandatory), topological order.
	 */
	mandatory: string[];
	/** Sound lower bound of the remaining hours: max(Σ lo over mand_K, h_max) — never above `upperBound`. */
	lowerBound: number;
	/** Upper bound: Σ hi of this concrete plan. */
	upperBound: number;
}

/** Greedy concrete plan reaching every goal from the current attained set (see header). */
export function goalPlan(source: Source, attained: Iterable<string>, goals: readonly string[]): GoalPlan {
	const idx = asIndex(source);
	const { sys, order, pos } = idx;
	const n = sys.ids.length;
	const known = attainedClosure(idx, attained);
	const targets = [...new Set(goals)].map((g) => requireDense(idx, g));
	const ubAdd = upperBoundAdditive(idx, known);
	const lbH = lowerBoundHmax(idx, known);

	const needed = new Uint8Array(n);
	const inPlan = new Uint8Array(n);
	for (const t of targets) if (known[t] !== 1) needed[t] = 1;
	for (let i = order.length - 1; i >= 0; i--) {
		const x = order[i]!;
		if (needed[x] !== 1 || known[x] === 1) continue;
		inPlan[x] = 1;
		let best: readonly number[] | null = null;
		let bestCost = Number.POSITIVE_INFINITY;
		for (const alt of sys.clauses[x]!) {
			let cost = 0;
			for (const y of alt) if (known[y] !== 1 && inPlan[y] !== 1 && needed[y] !== 1) cost += ubAdd[y]!;
			if (cost < bestCost) {
				bestCost = cost;
				best = alt;
			}
		}
		for (const y of best ?? []) if (known[y] !== 1) needed[y] = 1;
	}

	const items: number[] = [];
	for (const x of order) if (inPlan[x] === 1) items.push(x);
	const study = items.filter((x) => sys.children[x]!.length === 0);
	let lo = 0;
	let hi = 0;
	for (const x of study) {
		lo += sys.hoursLo[x]!;
		hi += sys.hoursHi[x]!;
	}

	// mand RELATIVE to K: with an infeasible K (a tightening patch before repair) mand(t) ∖ K would also count
	// prerequisites of attained items that no plan from K studies, and the lower bound could exceed the plan.
	const memo = denseMandatory(idx, targets, known);
	const mand = new Set<number>();
	for (const t of targets) for (const m of memo.get(t)!) mand.add(m);
	let lbMand = 0;
	for (const m of mand) lbMand += sys.hoursLo[m]!;
	let lbHmax = 0;
	for (const t of targets) lbHmax = Math.max(lbHmax, lbH[t]!);

	return {
		goals: targets.map((t) => sys.ids[t]!),
		items: items.map((x) => sys.ids[x]!),
		study: study.map((x) => sys.ids[x]!),
		hours: { lo, hi },
		mandatory: [...mand].sort((a, b) => pos[a]! - pos[b]!).map((x) => sys.ids[x]!),
		lowerBound: Math.max(lbMand, lbHmax),
		upperBound: hi,
	};
}

/** Ready leaves that advance the goals: outerFringe ∩ plan (topological order). */
export function goalFrontier(source: Source, attained: Iterable<string>, goals: readonly string[]): string[] {
	const idx = asIndex(source);
	const list = [...attained];
	const plan = new Set(goalPlan(idx, list, goals).study);
	return outerFringe(idx, list).filter((id) => plan.has(id));
}
