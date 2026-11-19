/**
 * Property-based tests of the curriculum core (docs/research/00-SINTESE.md
 * §2.13; r10 §3.3 Teorema LS-rank (a)–(h), §3.6 mand/LB/UB, §4 teoremas de
 * preservação + §4.1 refine_lift/refine_project, §6.2 verificação empírica
 * "n ≤ 9, enumeração de 2ⁿ", §8/§11.7 arbSystem).
 *
 * Systems come from tests/curriculum-fixtures.ts (arbFlat: AND/OR atoms under
 * the root; arbHier: containers with inherited entry clauses and stubs), are
 * loaded through the real seed pipeline (applySeedFiles) and compared with a
 * brute-force oracle (leafFamily) that enumerates every leaf subset.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import {
	applyPatch,
	applySeedFiles,
	buildEffectiveSystem,
	checkSnapshotCertificate,
	closureIds,
	curriculumIndex,
	goalFrontier,
	goalPlan,
	inferredRepair,
	innerFringe,
	interiorState,
	isFeasibleState,
	leavesOf,
	mandatory,
	outerFringe,
	replayLedger,
	validate,
	type CurriculumSeedFile,
	type CurriculumSnapshot,
	type ExpansionOp,
	type PatchEnvelope,
	type ValidationErrorCode,
} from "../src/core/curriculum/index.ts";
import { arbFlat, arbHier, envelope, leafFamily, maskToIds, type LeafFamily } from "./curriculum-fixtures.ts";

const CREATED = "2026-11-18T00:00:00.000Z";
const RUNS = 200;

function load(file: CurriculumSeedFile): { snap: CurriculumSnapshot; seedEnv: PatchEnvelope } {
	const res = applySeedFiles([file], { createdAt: CREATED });
	if (!res.ok) throw new Error(`seed gerado inválido: ${JSON.stringify(res.errors)}`);
	return { snap: res.snapshot, seedEnv: res.envelope };
}

interface Family extends LeafFamily {
	bit: Map<string, number>;
	feasibleMasks: number[];
	/** Leaf mask that makes `id` attained (a leaf: its bit; a container: all its leaves). */
	needOf: (id: string) => number;
	maskOf: (ids: Iterable<string>) => number;
}

function family(snap: CurriculumSnapshot): Family {
	const fam = leafFamily(snap);
	const bit = new Map(fam.leaves.map((id, i) => [id, i]));
	const sys = buildEffectiveSystem(snap.items);
	const needOf = (id: string) => leavesOf(sys, id).reduce((m, l) => m | (1 << bit.get(l)!), 0);
	const maskOf = (ids: Iterable<string>) => {
		let m = 0;
		for (const id of ids) if (bit.has(id)) m |= 1 << bit.get(id)!;
		return m;
	};
	const feasibleMasks: number[] = [];
	for (let m = 0; m <= fam.full; m++) if (fam.feasible[m] === 1) feasibleMasks.push(m);
	return { ...fam, bit, feasibleMasks, needOf, maskOf };
}

const bits = (m: number) => {
	const out: number[] = [];
	for (let i = 0; m >> i; i++) if ((m >> i) & 1) out.push(i);
	return out;
};

const arbSystem = fc.oneof(arbFlat(9), arbHier(9));

// ─── LS-rank (a)–(h) ────────────────────────────────────────────────────────

describe("LS-rank theorem by enumeration (n ≤ 9)", () => {
	it("(a) ∅ and Q are states; the certificate order is a learning word", () => {
		fc.assert(
			fc.property(arbSystem, (file) => {
				const { snap } = load(file);
				const f = family(snap);
				if (f.feasible[0] !== 1 || f.feasible[f.full] !== 1) return false;
				let m = 0;
				for (const id of snap.certificate.order) {
					if (!f.bit.has(id)) continue;
					m |= 1 << f.bit.get(id)!;
					if (f.feasible[m] !== 1) return false;
				}
				return m === f.full && isFeasibleState(snap, f.leaves);
			}),
			{ numRuns: RUNS },
		);
	});

	it("(b) union-closed and the implementation's feasibility matches the oracle", () => {
		fc.assert(
			fc.property(arbSystem, (file) => {
				const { snap } = load(file);
				const f = family(snap);
				const idx = curriculumIndex(snap);
				for (let m = 0; m <= f.full; m++) if (isFeasibleState(idx, maskToIds(f, m)) !== (f.feasible[m] === 1)) return false;
				for (const a of f.feasibleMasks) for (const b of f.feasibleMasks) if (f.feasible[a | b] !== 1) return false;
				return true;
			}),
			{ numRuns: RUNS },
		);
	});

	it("(c) accessible, and innerFringe(K) = {q ∈ K : K∖q ∈ 𝒦}", () => {
		fc.assert(
			fc.property(arbSystem, (file) => {
				const { snap } = load(file);
				const f = family(snap);
				const idx = curriculumIndex(snap);
				for (const k of f.feasibleMasks) {
					const removable = bits(k).filter((i) => f.feasible[k & ~(1 << i)] === 1);
					if (k !== 0 && removable.length === 0) return false;
					const inner = new Set(innerFringe(idx, maskToIds(f, k)));
					if (inner.size !== removable.length || !removable.every((i) => inner.has(f.leaves[i]!))) return false;
				}
				return true;
			}),
			{ numRuns: RUNS },
		);
	});

	it("(d)+(e) the outer fringe is never empty before Q and equals {q ∉ K : K ∪ q ∈ 𝒦}", () => {
		fc.assert(
			fc.property(arbSystem, (file) => {
				const { snap } = load(file);
				const f = family(snap);
				const idx = curriculumIndex(snap);
				for (const k of f.feasibleMasks) {
					const addable = f.leaves.map((_, i) => i).filter((i) => !((k >> i) & 1) && f.feasible[k | (1 << i)] === 1);
					if (k !== f.full && addable.length === 0) return false;
					const outer = outerFringe(idx, maskToIds(f, k));
					if (outer.length !== addable.length || !addable.every((i) => outer.includes(f.leaves[i]!))) return false;
				}
				return true;
			}),
			{ numRuns: RUNS },
		);
	});

	it("(f) learning consistency [L2], (g) goal-directed progress, (h) learning smoothness [L1]", () => {
		fc.assert(
			fc.property(arbSystem, (file) => {
				const { snap } = load(file);
				const f = family(snap);
				for (const k of f.feasibleMasks) {
					const fringe = f.leaves.map((_, i) => i).filter((i) => !((k >> i) & 1) && f.feasible[k | (1 << i)] === 1);
					for (const l of f.feasibleMasks) {
						// (g) with P = l ⊄ K: some q ∈ P∖K is addable to K.
						if ((l & ~k) !== 0 && !bits(l & ~k).some((i) => f.feasible[k | (1 << i)] === 1)) return false;
						if ((k & l) !== k) continue;
						// (f) K ⊆ L: every q addable to K is addable to L.
						for (const q of fringe) if (!((l >> q) & 1) && f.feasible[l | (1 << q)] !== 1) return false;
						// (h) K ⊆ L: a one-item-at-a-time feasible path from K to L.
						let cur = k;
						while (cur !== l) {
							const next = bits(l & ~cur).find((i) => f.feasible[cur | (1 << i)] === 1);
							if (next === undefined) return false;
							cur |= 1 << next;
						}
					}
				}
				return true;
			}),
			{ numRuns: 150 },
		);
	});
});

// ─── mand(t), LB ≤ OPT ≤ UB, goal plan ──────────────────────────────────────

describe("mand(t), hour bounds and the goal plan (r10 §3.6)", () => {
	it("mand(t) is inside every state containing t", () => {
		fc.assert(
			fc.property(arbSystem, (file) => {
				const { snap } = load(file);
				const f = family(snap);
				const idx = curriculumIndex(snap);
				for (const t of idx.sys.ids) {
					const need = mandatory(idx, t).map((id) => f.needOf(id));
					const nt = f.needOf(t);
					for (const m of f.feasibleMasks) if ((m & nt) === nt && !need.every((n) => (m & n) === n)) return false;
				}
				return true;
			}),
			{ numRuns: RUNS },
		);
	});

	it("the plan is a learning word reaching the goal, LB ≤ OPT(lo) and OPT(hi) ≤ UB, goal frontier non-empty", () => {
		fc.assert(
			fc.property(arbSystem, fc.nat(), fc.nat(), (file, kPick, tPick) => {
				const { snap } = load(file);
				const f = family(snap);
				const idx = curriculumIndex(snap);
				const k = f.feasibleMasks[kPick % f.feasibleMasks.length]!;
				const t = idx.sys.ids[tPick % idx.sys.ids.length]!;
				const nt = f.needOf(t);
				const attained = maskToIds(f, k);
				const plan = goalPlan(idx, attained, [t]);
				if (plan.lowerBound > plan.upperBound + 1e-9) return false;
				// Learning word: every prefix of `study` keeps the state feasible.
				let cur = k;
				for (const id of plan.study) {
					cur |= 1 << f.bit.get(id)!;
					if (f.feasible[cur] !== 1) return false;
				}
				if ((cur & nt) !== nt) return false;
				if ((k & nt) === nt) return plan.study.length === 0 && goalFrontier(idx, attained, [t]).length === 0;
				// Brute-force optimum over feasible supersets of K containing t.
				const lo = (i: number) => snap.items[f.leaves[i]!]!.hours.lo;
				const hi = (i: number) => snap.items[f.leaves[i]!]!.hours.hi;
				let optLo = Number.POSITIVE_INFINITY;
				let optHi = Number.POSITIVE_INFINITY;
				for (const m of f.feasibleMasks) {
					if ((m & k) !== k || (m & nt) !== nt) continue;
					const extra = bits(m & ~k);
					optLo = Math.min(optLo, extra.reduce((s, i) => s + lo(i), 0));
					optHi = Math.min(optHi, extra.reduce((s, i) => s + hi(i), 0));
				}
				const gf = goalFrontier(idx, attained, [t]);
				const outer = new Set(outerFringe(idx, attained));
				return plan.lowerBound <= optLo + 1e-9 && optHi <= plan.upperBound + 1e-9 && gf.length > 0 && gf.every((q) => outer.has(q));
			}),
			{ numRuns: 300 },
		);
	});
});

describe("state repair (r10 §3.4)", () => {
	it("interiorState is the largest feasible state inside X; inferredRepair is a feasible superset of X", () => {
		fc.assert(
			fc.property(arbSystem, fc.nat(), (file, pick) => {
				const { snap } = load(file);
				const f = family(snap);
				const idx = curriculumIndex(snap);
				const x = pick % (f.full + 1);
				const xIds = maskToIds(f, x);
				// Interior: feasible, ⊆ X, and contains every feasible state ⊆ X (maximal).
				const inner = interiorState(idx, xIds);
				const i = f.maskOf(inner.attained);
				if (f.feasible[i] !== 1 || (i & x) !== i) return false;
				if (f.maskOf(inner.dropped) !== (x & ~i) || inner.inferred.length !== 0) return false;
				for (const m of f.feasibleMasks) if ((m & x) === m && (m & i) !== m) return false;
				// Inference: feasible, ⊇ X, inferred = R ∖ X; a feasible X is left alone.
				const opt = inferredRepair(idx, xIds);
				const r = f.maskOf(opt.attained);
				if (f.feasible[r] !== 1 || (r & x) !== x || f.maskOf(opt.inferred) !== (r & ~x) || opt.dropped.length !== 0) return false;
				if (f.feasible[x] === 1 && (r !== x || i !== x)) return false;
				return true;
			}),
			{ numRuns: RUNS },
		);
	});

	it("after addPrereq the interior drops exactly the leaves that lost every route", () => {
		const { snap } = load({
			schemaVersion: 1,
			domainId: "testdomain",
			areaId: "tq",
			sources: [],
			items: [
				{ id: "tq", kind: "domain", parentId: null, title: { pt: "r", en: "r" }, summary: "", level: { scheme: "generic", band: 0 }, hours: { lo: 1, hi: 2 } },
				{ id: "tq.a", kind: "atom", parentId: "tq", title: { pt: "a", en: "a" }, summary: "", level: { scheme: "generic", band: 0 }, hours: { lo: 0.25, hi: 0.5 } },
				{ id: "tq.b", kind: "atom", parentId: "tq", title: { pt: "b", en: "b" }, summary: "", level: { scheme: "generic", band: 0 }, hours: { lo: 0.25, hi: 0.5 } },
				{ id: "tq.c", kind: "atom", parentId: "tq", title: { pt: "c", en: "c" }, summary: "", level: { scheme: "generic", band: 0 }, hours: { lo: 0.25, hi: 0.5 }, clauses: [["tq.b"]] },
			],
		});
		const next = applyPatch(snap, envelope(snap, [{ op: "addPrereq", item: "tq.b", clauseIndex: 0, prereq: "tq.a" }]));
		assert.ok(next.ok);
		const attained = ["tq.b", "tq.c"];
		assert.equal(isFeasibleState(next.next, attained), false);
		assert.deepEqual(interiorState(next.next, attained), { attained: [], dropped: ["tq.b", "tq.c"], inferred: [] });
		assert.deepEqual(inferredRepair(next.next, attained), { attained: ["tq.a", "tq.b", "tq.c"], dropped: [], inferred: ["tq.a"] });
	});
});

describe("transitive reduction (open-mastery I8)", () => {
	it("dropping the reported redundant members never changes the family of states", () => {
		let reducedSystems = 0;
		fc.assert(
			fc.property(arbSystem, (file) => {
				const plain = applySeedFiles([file], { createdAt: CREATED });
				const reduced = applySeedFiles([file], { createdAt: CREATED, reduceTransitive: true });
				if (!plain.ok || !reduced.ok) return false;
				if (reduced.removed.length > 0) reducedSystems++;
				const a = leafFamily(plain.snapshot);
				const b = leafFamily(reduced.snapshot);
				return a.leaves.join() === b.leaves.join() && a.feasible.every((v, i) => v === b.feasible[i]);
			}),
			{ numRuns: RUNS },
		);
		assert.ok(reducedSystems > 0, "o gerador deve produzir arestas transitivas");
	});
});

// ─── Operator theorems on families (r10 §4) ─────────────────────────────────

/**
 * Re-express a `source`-family mask over the `target` family's leaves (a
 * refined x is attained iff all its new children are; leaves missing from the
 * source are left out).
 */
function project(target: Family, source: Family, m: number, refined?: { x: string; children: string[] }): number {
	let out = 0;
	for (const [id, i] of target.bit) {
		if (refined && id === refined.x) {
			if (refined.children.every((c) => (m >> source.bit.get(c)!) & 1)) out |= 1 << i;
			continue;
		}
		const j = source.bit.get(id);
		if (j !== undefined && (m >> j) & 1) out |= 1 << i;
	}
	return out;
}

function applied(snap: CurriculumSnapshot, ops: ExpansionOp[], edgeMode: "strict" | "relaxed" = "strict"): CurriculumSnapshot {
	const res = applyPatch(snap, envelope(snap, ops), { edgeMode });
	if (!res.ok) throw new Error(`patch recusado: ${JSON.stringify(res.errors)}`);
	return res.next;
}

describe("operator theorems (r10 §4, §4.1)", () => {
	it("refine_lift and refine_project: refining a stub keeps old dependencies and lifts/projects states", () => {
		fc.assert(
			fc.property(arbHier(9), fc.nat(), fc.boolean(), (file, pick, chained) => {
				const { snap } = load(file);
				const sys = curriculumIndex(snap).sys;
				const stubs = sys.ids.filter((id, x) => sys.children[x]!.length === 0 && sys.items[x]!.kind !== "atom");
				fc.pre(stubs.length > 0);
				const x = stubs[pick % stubs.length]!;
				const children = [`${x}.r0`, `${x}.r1`];
				const next = applied(snap, [
					{
						op: "refine",
						item: x,
						sub: [
							{ id: children[0]!, kind: "atom", title: { pt: "a", en: "a" }, hours: { lo: 0.25, hi: 0.5 }, clauses: "entry" },
							{ id: children[1]!, kind: "atom", title: { pt: "b", en: "b" }, hours: { lo: 0.25, hi: 0.5 }, clauses: chained ? [[children[0]!]] : "entry" },
						],
					},
				]);
				const oldF = family(snap);
				const newF = family(next);
				const oldIds = new Set(sys.ids);
				// refine_lift: every old state, read in the new system, is a state with the same old items.
				for (const m of oldF.feasibleMasks) {
					const ids = maskToIds(oldF, m);
					if (!isFeasibleState(next, ids)) return false;
					const before = closureIds(snap, ids).sort();
					const after = closureIds(next, ids)
						.filter((id) => oldIds.has(id))
						.sort();
					if (before.join() !== after.join()) return false;
				}
				// refine_project: every new state projects onto an old state.
				for (const m of newF.feasibleMasks) if (oldF.feasible[project(oldF, newF, m, { x, children })] !== 1) return false;
				return true;
			}),
			{ numRuns: RUNS },
		);
	});

	it("addAlternative relaxes (old states survive); addPrereq tightens (no new states)", () => {
		fc.assert(
			fc.property(arbSystem, fc.nat(), fc.nat(), fc.boolean(), (file, xPick, yPick, relax) => {
				const { snap } = load(file);
				const idx = curriculumIndex(snap);
				const { sys, pos } = idx;
				const ancestors = (x: number) => {
					const out = new Set<number>();
					for (let p = sys.parent[x]!; p >= 0; p = sys.parent[p]!) out.add(p);
					return out;
				};
				const leaves = sys.ids.map((_, i) => i).filter((i) => sys.children[i]!.length === 0 && (!relax || sys.items[i]!.clauses.length > 0));
				fc.pre(leaves.length > 0);
				const x = leaves[xPick % leaves.length]!;
				const anc = ancestors(x);
				const ys = sys.ids.map((_, i) => i).filter((y) => y !== x && !anc.has(y) && pos[y]! < pos[x]!);
				fc.pre(ys.length > 0);
				const y = sys.ids[ys[yPick % ys.length]!]!;
				const id = sys.ids[x]!;
				const op: ExpansionOp = relax ? { op: "addAlternative", item: id, clause: [y] } : { op: "addPrereq", item: id, clauseIndex: 0, prereq: y };
				const next = applied(snap, [op], "relaxed");
				const oldF = family(snap);
				const newF = family(next);
				for (let m = 0; m <= oldF.full; m++) {
					const nm = project(newF, oldF, m);
					const before = oldF.feasible[m] === 1;
					const after = newF.feasible[nm] === 1;
					if (relax ? before && !after : after && !before) return false;
				}
				return true;
			}),
			{ numRuns: RUNS },
		);
	});

	it("addItem of an entry atom under the root: new family = old family × {with, without}", () => {
		fc.assert(
			fc.property(arbFlat(8), (file) => {
				const { snap } = load(file);
				const next = applied(snap, [{ op: "addItem", id: "tq.extra", parentId: "tq", kind: "atom", title: { pt: "x", en: "x" }, hours: { lo: 0.25, hi: 0.5 }, clauses: "entry" }]);
				const oldF = family(snap);
				const newF = family(next);
				const extra = 1 << newF.bit.get("tq.extra")!;
				for (let m = 0; m <= oldF.full; m++) {
					const nm = project(newF, oldF, m);
					const before = oldF.feasible[m] === 1;
					if ((newF.feasible[nm] === 1) !== before || (newF.feasible[nm | extra] === 1) !== before) return false;
				}
				return true;
			}),
			{ numRuns: RUNS },
		);
	});
});

// ─── Preservation under random patches + ledger replay ──────────────────────

const KNOWN_CODES = new Set<ValidationErrorCode>([
	"schema",
	"cycle",
	"unknown-id",
	"duplicate-id",
	"no-route",
	"budget",
	"hours-conservation",
	"hierarchy",
	"strict-alternatives",
	"immutable-id",
	"retire-reroute",
]);

/** A patch op that the theorems say must be accepted (falls back to updateItem when the chosen kind does not apply). */
function validOp(snap: CurriculumSnapshot, r: () => number, step: number, mode: "strict" | "relaxed"): ExpansionOp {
	const idx = curriculumIndex(snap);
	const { sys, pos } = idx;
	const pick = <T>(xs: readonly T[]): T => xs[r() % xs.length]!;
	const isLeaf = (i: number) => sys.children[i]!.length === 0;
	const ancestors = (x: number) => {
		const out = new Set<number>();
		for (let p = sys.parent[x]!; p >= 0; p = sys.parent[p]!) out.add(p);
		return out;
	};
	const all = sys.ids.map((_, i) => i);
	const fallback: ExpansionOp = { op: "updateItem", item: sys.ids[pick(all)]!, fields: { summary: `resumo ${step}` } };
	const earlier = (x: number) => {
		const anc = ancestors(x);
		return all.filter((y) => y !== x && !anc.has(y) && pos[y]! < pos[x]!);
	};
	switch (r() % 8) {
		case 0:
			return fallback;
		case 1: {
			const cands = all.filter((i) => sys.items[i]!.kind !== "atom");
			const lo = 0.25 + (r() % 20) / 4;
			return { op: "setHours", item: sys.ids[pick(cands)]!, hours: { lo, hi: lo + (r() % 8) / 4 } };
		}
		case 2: {
			if (all.length < 2) return fallback;
			const a = pick(all);
			const b = pick(all.filter((i) => i !== a));
			return { op: "addEdge", edge: { from: sys.ids[a]!, to: sys.ids[b]!, kind: "related" } };
		}
		case 3: {
			const stubs = all.filter((i) => isLeaf(i) && sys.items[i]!.kind !== "atom");
			if (stubs.length === 0) return fallback;
			const x = pick(stubs);
			const id = sys.ids[x]!;
			const mid = (sys.items[x]!.hours.lo + sys.items[x]!.hours.hi) / 2;
			const k = Math.max(1, Math.ceil(mid / 0.5));
			const each = mid / k;
			if (each < 10 / 60) return fallback;
			return {
				op: "refine",
				item: id,
				sub: Array.from({ length: k }, (_, j) => ({
					id: `${id}.r${step}x${j}`,
					kind: "atom" as const,
					title: { pt: `parte ${j}`, en: `part ${j}` },
					hours: { lo: each * 0.8, hi: each * 1.2 },
					clauses: j === 0 || r() % 2 === 0 ? ("entry" as const) : [[`${id}.r${step}x${j - 1}`]],
				})),
			};
		}
		case 4: {
			const others = all.filter((i) => sys.parent[i]! >= 0);
			const clauses = others.length > 0 && r() % 2 === 0 ? [[sys.ids[pick(others)]!]] : ("entry" as const);
			return { op: "addItem", id: `tq.add${step}`, parentId: sys.ids[sys.roots[0]!]!, kind: "atom", title: { pt: "novo", en: "new" }, hours: { lo: 0.25, hi: 0.5 }, clauses };
		}
		case 5:
		case 6: {
			const relax = mode === "relaxed" && r() % 2 === 0;
			const leaves = all.filter((i) => isLeaf(i) && (!relax || sys.items[i]!.clauses.length > 0));
			if (leaves.length === 0) return fallback;
			const x = pick(leaves);
			const ys = earlier(x);
			if (ys.length === 0) return fallback;
			const y = sys.ids[pick(ys)]!;
			if (relax) return { op: "addAlternative", item: sys.ids[x]!, clause: [y] };
			const alts = Math.max(1, sys.items[x]!.clauses.length);
			return { op: "addPrereq", item: sys.ids[x]!, clauseIndex: r() % alts, prereq: y };
		}
		default: {
			const cands = all.filter((i) => isLeaf(i) && sys.parent[i]! >= 0 && sys.children[sys.parent[i]!]!.length >= 2);
			if (cands.length === 0) return fallback;
			const id = sys.ids[pick(cands)]!;
			const dependents = sys.ids.filter((d, i) => i !== sys.index.get(id) && sys.items[i]!.clauses.some((alt) => alt.includes(id)));
			return { op: "retire", item: id, reroute: dependents.map((d) => ({ item: d, clause: [] })) };
		}
	}
}

/** Any op at all: random kinds over live, retired, missing and fresh ids, random clauses and hours. */
function chaosOp(snap: CurriculumSnapshot, r: () => number, step: number): ExpansionOp {
	const ids = [...Object.keys(snap.items), "tq.ghost", `tq.fresh${step}`, `tq.n0.fresh${step}`];
	const pick = <T>(xs: readonly T[]): T => xs[r() % xs.length]!;
	const clause = () => Array.from({ length: 1 + (r() % 2) }, () => pick(ids));
	const hours = () => {
		const lo = (r() % 12) / 8;
		return { lo, hi: lo + (r() % 6) / 8 };
	};
	const kinds = ["area", "unit", "topic", "atom"] as const;
	const spec = (id: string) => ({ id, kind: pick(kinds), title: { pt: id, en: id }, hours: hours(), clauses: r() % 3 === 0 ? ("entry" as const) : [clause()] });
	switch (r() % 9) {
		case 0:
			return { op: "addItem", parentId: pick(ids), ...spec(`tq.c${step}`) };
		case 1:
			return { op: "addAlternative", item: pick(ids), clause: clause() };
		case 2:
			return { op: "addPrereq", item: pick(ids), clauseIndex: r() % 3, prereq: pick(ids) };
		case 3:
			return { op: "refine", item: pick(ids), sub: [spec(`tq.s${step}a`), spec(`tq.s${step}b`)].map(({ id, ...rest }) => ({ id: `${pick(ids)}.${id.slice(3)}`, ...rest })) };
		case 4:
			return { op: "addSubdomain", id: `tq.sd${step}`, parentId: pick(ids), title: { pt: "sd", en: "sd" }, items: [{ parentId: `tq.sd${step}`, ...spec(`tq.sd${step}.k`) }] };
		case 5:
			return { op: "retire", item: pick(ids), reroute: r() % 2 === 0 ? [] : [{ item: pick(ids), clause: r() % 2 === 0 ? [] : clause() }] };
		case 6:
			return { op: "setHours", item: pick(ids), hours: hours() };
		case 7:
			return { op: "updateItem", item: pick(ids), fields: r() % 2 === 0 ? { summary: `s${step}` } : { status: pick(["stub", "stable", "deprecated", "provisional"] as const) } };
		default:
			return { op: "addEdge", edge: { from: pick(ids), to: pick(ids), kind: pick(["related", "also_in", "confusable_with"] as const) } };
	}
}

function entropy(seq: readonly number[]): () => number {
	let i = 0;
	return () => seq[i++ % seq.length]! + i;
}

describe("invariant preservation and ledger replay", () => {
	it("valid patches are always accepted and keep every invariant; replaying the ledger gives the same hash", () => {
		fc.assert(
			fc.property(arbSystem, fc.constantFrom("strict" as const, "relaxed" as const), fc.array(fc.nat({ max: 1_000_000 }), { minLength: 16, maxLength: 64 }), fc.integer({ min: 1, max: 8 }), (file, mode, seq, steps) => {
				const { snap, seedEnv } = load(file);
				const r = entropy(seq);
				const ledger: PatchEnvelope[] = [seedEnv];
				let cur = snap;
				for (let step = 0; step < steps; step++) {
					const op = validOp(cur, r, step, mode);
					const env = envelope(cur, [op], { createdAt: `2026-11-18T10:00:${String(step).padStart(2, "0")}.000Z` });
					const before = JSON.stringify(cur);
					const res = applyPatch(cur, env, { edgeMode: mode });
					assert.ok(res.ok, `${JSON.stringify(op)} → ${JSON.stringify(!res.ok && res.errors)}`);
					assert.equal(JSON.stringify(cur), before, "input mutated");
					assert.equal(res.next.version, cur.version + 1);
					assert.deepEqual(validate(res.next, { edgeMode: mode }), []);
					assert.deepEqual(checkSnapshotCertificate(res.next), { ok: true });
					assert.ok(outerFringe(res.next, []).length > 0, "fronteira inicial vazia");
					ledger.push(env);
					cur = res.next;
				}
				const replay = replayLedger(JSON.parse(JSON.stringify(ledger)) as unknown[], { edgeMode: mode });
				assert.ok(replay.ok, JSON.stringify(!replay.ok && replay.errors));
				assert.equal(replay.snapshot.certificate.hash, cur.certificate.hash);
				assert.deepEqual(replay.snapshot, cur);
			}),
			{ numRuns: 150 },
		);
	});

	it("arbitrary patches never yield an invalid snapshot and never mutate the input", (t) => {
		let acceptedTotal = 0;
		let rejectedTotal = 0;
		fc.assert(
			fc.property(arbSystem, fc.constantFrom("strict" as const, "relaxed" as const), fc.array(fc.nat({ max: 1_000_000 }), { minLength: 16, maxLength: 64 }), (file, mode, seq) => {
				const { snap } = load(file);
				const r = entropy(seq);
				let cur = snap;
				let accepted = 0;
				for (let step = 0; step < 12; step++) {
					const ops = Array.from({ length: 1 + (r() % 3) }, (_, j) => chaosOp(cur, r, step * 3 + j));
					const before = JSON.stringify(cur);
					const res = applyPatch(cur, envelope(cur, ops), { edgeMode: mode });
					assert.equal(JSON.stringify(cur), before, "input mutated");
					if (res.ok) {
						accepted++;
						acceptedTotal++;
						assert.equal(res.next.version, cur.version + 1);
						assert.deepEqual(validate(res.next, { edgeMode: mode }), [], JSON.stringify(ops));
						assert.deepEqual(checkSnapshotCertificate(res.next), { ok: true });
						cur = res.next;
					} else {
						rejectedTotal++;
						assert.ok(res.errors.length > 0);
						for (const e of res.errors) assert.ok(KNOWN_CODES.has(e.code) && e.message.length > 0, JSON.stringify(e));
					}
				}
				return accepted >= 0;
			}),
			{ numRuns: 150 },
		);
		t.diagnostic(`patches aleatórios: ${acceptedTotal} aceitos, ${rejectedTotal} recusados`);
		assert.ok(acceptedTotal > 50, "o gerador caótico precisa exercitar também o caminho de sucesso");
	});
});
