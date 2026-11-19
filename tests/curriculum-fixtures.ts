/**
 * Shared fixtures for tests/curriculum-*.test.ts (not a test file itself).
 *
 *   item / snapshot / envelope — terse builders for hand-written cases;
 *   sampleSnapshot            — a small Electronics-like domain exercising
 *                               containers, inherited entry requirements,
 *                               alternatives, stubs and soft prerequisites;
 *   arbFlat / arbHier          — fast-check generators of AND/OR systems with a
 *                               hidden rank (r10 §8 / §11.7 arbSystem), as seed
 *                               files: flat (atoms under the root) and
 *                               hierarchical (containers, inherited entry
 *                               clauses, stub leaves);
 *   leafFamily                 — brute-force oracle: every subset of leaves whose
 *                               closure is a feasible state, computed straight
 *                               from the effective clauses (independent of
 *                               src/core/curriculum/frontier.ts).
 */

import fc from "fast-check";
import { buildEffectiveSystem, effectiveClausesOf } from "../src/core/curriculum/effective.ts";
import { computeCertificate } from "../src/core/curriculum/certificate.ts";
import type {
	CurriculumItem,
	CurriculumSeedFile,
	CurriculumSnapshot,
	ExpansionOp,
	NodeKind,
	PatchEnvelope,
	SeedItem,
} from "../src/core/curriculum/types.ts";

export const T0 = "2026-11-18T00:00:00.000Z";

export function item(id: string, parentId: string | null, kind: NodeKind, extra: Partial<CurriculumItem> = {}): CurriculumItem {
	return {
		id,
		domainId: "electronics",
		kind,
		parentId,
		order: 0,
		title: { pt: id, en: id },
		aliases: [],
		scope: "",
		summary: "",
		objectives: [],
		assess: [],
		level: { scheme: "ee", band: 1 },
		clauses: [],
		softPrereqs: [],
		encompasses: [],
		hours: kind === "atom" ? { lo: 0.25, hi: 0.5 } : { lo: 1, hi: 2 },
		anchors: [],
		status: kind === "atom" ? "stable" : "stable",
		version: 1,
		provenance: { createdBy: "seed", createdAt: T0 },
		...extra,
	};
}

/** Snapshot from items (certificate computed when acyclic, placeholder otherwise). */
export function snapshot(items: CurriculumItem[], extra: Partial<CurriculumSnapshot> = {}): CurriculumSnapshot {
	const base = {
		schemaVersion: 1 as const,
		domainId: "electronics",
		version: 3,
		items: Object.fromEntries(items.map((it) => [it.id, it])),
		edges: [],
		...extra,
	};
	let certificate = { order: [] as string[], hash: "" };
	try {
		certificate = computeCertificate(base);
	} catch {
		/* cyclic on purpose */
	}
	return { ...base, certificate, updatedAt: T0, ...extra };
}

export function envelope(base: CurriculumSnapshot, ops: ExpansionOp[], extra: Partial<PatchEnvelope> = {}): PatchEnvelope {
	return {
		patchId: `p-${base.version + 1}`,
		domainId: base.domainId,
		baseVersion: base.version,
		trigger: { kind: "frontier", reason: "teste", priority: 60 },
		ops,
		itemPayloads: {},
		risk: "low",
		provenance: { model: "test-model", promptVersion: "v1", samples: 1 },
		createdAt: "2026-11-18T12:00:00.000Z",
		...extra,
	};
}

/**
 *  ee (domain)
 *  ├─ ee.math (area)                 entry
 *  │   ├─ ee.math.algebra (atom)     entry
 *  │   └─ ee.math.calculus (atom)    [[algebra]]
 *  ├─ ee.dc (area)                   [[ee.math]]  ← entry requirement of the area
 *  │   ├─ ee.dc.ohm (atom)           entry → inherits [[ee.math]]
 *  │   ├─ ee.dc.kvl (atom)           [[ohm]] (internal)
 *  │   └─ ee.dc.nodal (topic, stub)  [[kvl], [ee.math.calculus]] (mixed: 2nd alt inherits)
 *  └─ ee.ac (area, stub, 20–30 h)    [[ee.dc]]   soft: ee.math.calculus
 */
export function sampleSnapshot(): CurriculumSnapshot {
	return snapshot([
		item("ee", null, "domain", { hours: { lo: 100, hi: 200 } }),
		item("ee.math", "ee", "area", { order: 0 }),
		item("ee.math.algebra", "ee.math", "atom", { order: 0, title: { pt: "Álgebra básica", en: "Basic algebra" } }),
		item("ee.math.calculus", "ee.math", "atom", { order: 1, clauses: [["ee.math.algebra"]], title: { pt: "Cálculo", en: "Calculus" } }),
		item("ee.dc", "ee", "area", { order: 1, clauses: [["ee.math"]] }),
		item("ee.dc.ohm", "ee.dc", "atom", { order: 0, title: { pt: "Lei de Ohm", en: "Ohm's law" }, aliases: ["resistência"] }),
		item("ee.dc.kvl", "ee.dc", "atom", { order: 1, clauses: [["ee.dc.ohm"]], title: { pt: "Leis de Kirchhoff", en: "Kirchhoff laws" } }),
		item("ee.dc.nodal", "ee.dc", "topic", {
			order: 2,
			status: "stub",
			hours: { lo: 2, hi: 3 },
			clauses: [["ee.dc.kvl"], ["ee.math.calculus"]],
			title: { pt: "Análise nodal", en: "Nodal analysis" },
		}),
		item("ee.ac", "ee", "area", {
			order: 2,
			status: "stub",
			hours: { lo: 20, hi: 30 },
			clauses: [["ee.dc"]],
			softPrereqs: ["ee.math.calculus"],
			title: { pt: "Corrente alternada", en: "AC circuits" },
		}),
	]);
}

// ─── Seed-file generators (hidden rank ⇒ valid by construction) ─────────────

const atomHours = { lo: 0.25, hi: 0.5 };
const stubHours = { lo: 0.5, hi: 1 };

function seedFile(items: SeedItem[]): CurriculumSeedFile {
	return { schemaVersion: 1, domainId: "testdomain", areaId: "tq", items, sources: [] };
}

function rootSeed(): SeedItem {
	return { id: "tq", kind: "domain", parentId: null, title: { pt: "Raiz", en: "Root" }, summary: "raiz", level: { scheme: "generic", band: 0 }, hours: { lo: 1, hi: 2 } };
}

const rawClauses = (maxAlts: number) =>
	fc.array(fc.array(fc.nat({ max: 63 }), { minLength: 1, maxLength: 3 }), { minLength: 0, maxLength: maxAlts });

/** Flat AND/OR system: atoms tq.q0..q(n-1) under the root; clauses of q_i only cite q_k, k < i. */
export const arbFlat = (maxN = 9) =>
	fc.integer({ min: 1, max: maxN }).chain((n) =>
		fc.array(rawClauses(2), { minLength: n, maxLength: n }).map((raw) => {
			const ids = raw.map((_, i) => `tq.q${i}`);
			const items: SeedItem[] = [rootSeed()];
			raw.forEach((alts, i) => {
				const clauses = i === 0 ? [] : alts.map((alt) => [...new Set(alt.map((k) => ids[k % i]!))]);
				items.push({ id: ids[i]!, kind: "atom", parentId: "tq", title: { pt: ids[i]!, en: ids[i]! }, summary: "", level: { scheme: "generic", band: 0 }, hours: atomHours, clauses });
			});
			return seedFile(items);
		}),
	);

interface HierNode {
	id: string;
	parent: number;
	depth: number;
	children: number[];
}

/**
 * Hierarchical system: a random tree (≤ maxNodes non-root nodes, containers
 * up to depth 3), post-order rank r with subtree start s; a clause member y
 * of x must satisfy r(y) < s(x) — this excludes ancestors and descendants
 * and keeps the effective graph (inherited entry requirements included)
 * acyclic. Containers get ≤ 1 alternative, leaves ≤ 2, so effective
 * alternatives stay ≤ 2 (strict mode). Leaves at depth ≤ 3 may be stubs.
 */
export const arbHier = (maxNodes = 9) =>
	fc.integer({ min: 1, max: maxNodes }).chain((n) =>
		fc
			.record({
				parents: fc.array(fc.nat({ max: 63 }), { minLength: n, maxLength: n }),
				clauses: fc.array(rawClauses(2), { minLength: n, maxLength: n }),
				stubs: fc.array(fc.boolean(), { minLength: n, maxLength: n }),
			})
			.map(({ parents, clauses, stubs }) => {
				const nodes: HierNode[] = [{ id: "tq", parent: -1, depth: 0, children: [] }];
				for (let i = 0; i < n; i++) {
					const candidates = nodes.map((_, j) => j).filter((j) => nodes[j]!.depth <= 3);
					const p = candidates[parents[i]! % candidates.length]!;
					const id = `${nodes[p]!.id}.n${i}`;
					nodes.push({ id, parent: p, depth: nodes[p]!.depth + 1, children: [] });
					nodes[p]!.children.push(nodes.length - 1);
				}
				// Post-order rank and subtree start.
				const r = new Array<number>(nodes.length).fill(0);
				const s = new Array<number>(nodes.length).fill(0);
				let counter = 0;
				const visit = (v: number): number => {
					let start = Number.POSITIVE_INFINITY;
					for (const c of nodes[v]!.children) start = Math.min(start, visit(c));
					r[v] = counter++;
					s[v] = Math.min(start, r[v]!);
					return s[v]!;
				};
				visit(0);
				const kinds: NodeKind[] = ["domain", "area", "unit", "topic", "atom"];
				const items: SeedItem[] = [rootSeed()];
				for (let v = 1; v < nodes.length; v++) {
					const node = nodes[v]!;
					const isContainer = node.children.length > 0;
					const stub = !isContainer && node.depth <= 3 && stubs[v - 1]!;
					const kind: NodeKind = isContainer || stub ? kinds[node.depth]! : "atom";
					const allowed = nodes.map((_, y) => y).filter((y) => y !== 0 && r[y]! < s[v]!);
					const alts = clauses[v - 1]!.slice(0, isContainer ? 1 : 2);
					const cl = allowed.length === 0 ? [] : alts.map((alt) => [...new Set(alt.map((k) => nodes[allowed[k % allowed.length]!]!.id))]);
					items.push({
						id: node.id,
						kind,
						parentId: nodes[node.parent]!.id,
						title: { pt: node.id, en: node.id },
						summary: "",
						level: { scheme: "generic", band: 0 },
						hours: kind === "atom" ? atomHours : stubHours,
						clauses: cl,
					});
				}
				return seedFile(items);
			}),
	);

// ─── Brute-force oracle ─────────────────────────────────────────────────────

export interface LeafFamily {
	leaves: string[];
	/** feasible[mask]: the closure of the leaf subset `mask` is a feasible state. */
	feasible: Uint8Array;
	full: number;
}

/** Enumerate every leaf subset (≤ 12 leaves) and decide feasibility from the effective clauses. */
export function leafFamily(snap: CurriculumSnapshot): LeafFamily {
	const sys = buildEffectiveSystem(snap.items);
	const leaves = sys.ids.filter((_, x) => sys.children[x]!.length === 0);
	if (leaves.length > 12) throw new Error("oracle limited to 12 leaves");
	const bit = new Map(leaves.map((id, i) => [id, i]));
	const leafDesc = new Map<string, number>();
	const maskOf = (x: number): number => {
		const id = sys.ids[x]!;
		const kids = sys.children[x]!;
		if (kids.length === 0) return 1 << bit.get(id)!;
		let m = 0;
		for (const c of kids) m |= maskOf(c);
		return m;
	};
	sys.ids.forEach((id, x) => leafDesc.set(id, maskOf(x)));
	const clauses = new Map(leaves.map((id) => [id, effectiveClausesOf(sys, id)]));
	const full = (1 << leaves.length) - 1;
	const feasible = new Uint8Array(full + 1);
	for (let mask = 0; mask <= full; mask++) {
		const attainedId = (id: string) => (leafDesc.get(id)! & mask) === leafDesc.get(id)!;
		let ok = true;
		for (const [id, cs] of clauses) {
			if (!(mask & (1 << bit.get(id)!))) continue;
			if (cs.length > 0 && !cs.some((alt) => alt.every(attainedId))) {
				ok = false;
				break;
			}
		}
		feasible[mask] = ok ? 1 : 0;
	}
	return { leaves, feasible, full };
}

export function maskToIds(fam: LeafFamily, mask: number): string[] {
	return fam.leaves.filter((_, i) => mask & (1 << i));
}

// ─── Synthetic large domain (performance) ───────────────────────────────────

/**
 * Deterministic ~`target`-node domain: 16 areas × 12 units × 10 topics, atoms
 * filling the rest; every atom needs 1–3 of the previous 60 atoms (post-order,
 * so never an ancestor/descendant: acyclic), every unit after the first needs
 * the previous unit as an ENTRY requirement (inherited by its source atoms).
 */
export function syntheticSnapshot(target = 20_000): CurriculumSnapshot {
	let seed = 0x2545f491;
	const rand = () => {
		seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
		return seed / 0x100000000;
	};
	const items: CurriculumItem[] = [item("ee", null, "domain")];
	const areas = 16;
	const units = 12;
	const topics = 10;
	const atomsTotal = target - 1 - areas - areas * units - areas * units * topics;
	const perTopic = atomsTotal / (areas * units * topics);
	const leaves: string[] = [];
	let made = 0;
	let topicIndex = 0;
	let prevUnit: string | null = null;
	for (let a = 0; a < areas; a++) {
		const aid = `ee.a${a}`;
		items.push(item(aid, "ee", "area", { order: a }));
		for (let u = 0; u < units; u++) {
			const uid = `${aid}.u${u}`;
			items.push(item(uid, aid, "unit", { order: u, clauses: prevUnit ? [[prevUnit]] : [] }));
			for (let t = 0; t < topics; t++) {
				const tid = `${uid}.t${t}`;
				items.push(item(tid, uid, "topic", { order: t }));
				topicIndex++;
				const quota = Math.round(topicIndex * perTopic) - made;
				for (let k = 0; k < quota; k++) {
					const id = `${tid}.k${k}`;
					const clauses: string[][] = [];
					if (leaves.length > 0 && rand() < 0.85) {
						const deg = 1 + Math.floor(rand() * 3);
						const alt = new Set<string>();
						for (let j = 0; j < deg; j++) alt.add(leaves[Math.max(0, leaves.length - 1 - Math.floor(rand() * 60))]!);
						clauses.push([...alt]);
					}
					items.push(item(id, tid, "atom", { order: k, clauses }));
					leaves.push(id);
					made++;
				}
			}
			prevUnit = uid;
		}
	}
	return snapshot(items);
}
