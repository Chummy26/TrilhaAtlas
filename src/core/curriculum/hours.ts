/**
 * Study-hour arithmetic over the effective system (docs/research/
 * 00-SINTESE.md §2.13 "Horas mand / LB / UB"; r10 §3.6 cotas de horas, §11.4
 * "horas no caso E/OU: cotas mais fortes"; r3 §5 dimensionamento).
 *
 *   • only LEAVES cost time (atoms and unrefined stubs); containers are
 *     milestones (cost 0) whose rolled-up hours are the sum of their live
 *     descendant leaves — a container's own stored `hours` is the pre-
 *     refinement estimate, kept for history and for the refine conservation
 *     check, never added on top of its children;
 *   • lower bound h_max (r10 §11.4, admissible):
 *         LB_K(x) = 0                                  if x ∈ K
 *                 = lo(x) + min_C max_{y∈C} LB_K(y)    otherwise (max ∅ = 0)
 *   • additive upper estimate (r10 §11.4):
 *         UB_K(x) = 0                                  if x ∈ K
 *                 = hi(x) + min_C Σ_{y∈C} UB_K(y)      otherwise
 *     (a valid bound; ./frontier.ts goalPlan tightens it with a concrete
 *     greedy plan that counts shared prerequisites once);
 *   • mandatory lower bound Σ_{v ∈ mand(t)∖K} lo(v) lives with mand(t) in
 *     ./frontier.ts.
 * Both DPs run once in topological order: O(V + Σ|C|).
 *
 * Pure and browser-safe.
 */

import { asIndex, type CurriculumIndex } from "./rank.ts";
import type { CurriculumSnapshot, Hours } from "./types.ts";

export function hoursMid(h: Hours): number {
	return (h.lo + h.hi) / 2;
}

export function sumHours(list: Iterable<Hours>): Hours {
	let lo = 0;
	let hi = 0;
	for (const h of list) {
		lo += h.lo;
		hi += h.hi;
	}
	return { lo, hi };
}

/** Rolled-up hours of every live item: leaves their own, containers Σ of their live descendant leaves. */
export function rollupHours(source: CurriculumSnapshot | CurriculumIndex): Map<string, Hours> {
	const { sys } = asIndex(source);
	const n = sys.ids.length;
	const lo = new Float64Array(n);
	const hi = new Float64Array(n);
	for (let h = sys.treeOrder.length - 1; h >= 0; h--) {
		const x = sys.treeOrder[h]!;
		const kids = sys.children[x]!;
		if (kids.length === 0) {
			lo[x] = sys.hoursLo[x]!;
			hi[x] = sys.hoursHi[x]!;
		} else
			for (const c of kids) {
				lo[x] = lo[x]! + lo[c]!;
				hi[x] = hi[x]! + hi[c]!;
			}
	}
	const out = new Map<string, Hours>();
	for (let x = 0; x < n; x++) out.set(sys.ids[x]!, { lo: lo[x]!, hi: hi[x]! });
	return out;
}

/** Σ hours of every live leaf (the whole track). */
export function totalHours(source: CurriculumSnapshot | CurriculumIndex): Hours {
	const { sys } = asIndex(source);
	let lo = 0;
	let hi = 0;
	for (let x = 0; x < sys.ids.length; x++) {
		lo += sys.hoursLo[x]!;
		hi += sys.hoursHi[x]!;
	}
	return { lo, hi };
}

/** Σ hours of the live leaves NOT in the dense state `known`. */
export function remainingHoursDense(index: CurriculumIndex, known: Uint8Array): Hours {
	const { sys } = index;
	let lo = 0;
	let hi = 0;
	for (let x = 0; x < sys.ids.length; x++)
		if (known[x] !== 1) {
			lo += sys.hoursLo[x]!;
			hi += sys.hoursHi[x]!;
		}
	return { lo, hi };
}

/** h_max admissible lower bound per item from the dense state `known` (r10 §11.4). */
export function lowerBoundHmax(index: CurriculumIndex, known: Uint8Array): Float64Array {
	const { sys, order } = index;
	const lb = new Float64Array(sys.ids.length);
	for (const x of order) {
		if (known[x] === 1) continue;
		let best = Number.POSITIVE_INFINITY;
		for (const alt of sys.clauses[x]!) {
			let worst = 0;
			for (const y of alt) worst = Math.max(worst, lb[y]!);
			best = Math.min(best, worst);
		}
		lb[x] = sys.hoursLo[x]! + (best === Number.POSITIVE_INFINITY ? 0 : best);
	}
	return lb;
}

/** Additive upper estimate per item from the dense state `known` (r10 §11.4). */
export function upperBoundAdditive(index: CurriculumIndex, known: Uint8Array): Float64Array {
	const { sys, order } = index;
	const ub = new Float64Array(sys.ids.length);
	for (const x of order) {
		if (known[x] === 1) continue;
		let best = Number.POSITIVE_INFINITY;
		for (const alt of sys.clauses[x]!) {
			let sum = 0;
			for (const y of alt) sum += ub[y]!;
			best = Math.min(best, sum);
		}
		ub[x] = sys.hoursHi[x]! + (best === Number.POSITIVE_INFINITY ? 0 : best);
	}
	return ub;
}
