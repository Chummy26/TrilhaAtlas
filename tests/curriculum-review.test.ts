/**
 * Regression tests from the adversarial review of the curriculum core
 * (docs/impl/curriculum.md "Revisão adversarial"). Each `describe` pins one
 * bug that the original suite let through, plus an INDEPENDENT oracle for the
 * effective clause system (the LS-rank oracle of curriculum-fixtures.ts reads
 * the effective clauses from the implementation itself, so a builder bug
 * would have been invisible to it). References: docs/research/00-SINTESE.md
 * §2.4(e) passo 7, §2.13; r10 §3.6, §4.1, §11.4; types.ts header.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import {
	applyPatch,
	applySeedFiles,
	buildEffectiveSystem,
	checkSnapshotCertificate,
	classifyRisk,
	closureIds,
	curriculumIndex,
	effectiveClausesOf,
	goalPlan,
	mandatory,
	replayLedger,
	seedFilesToPatch,
	validate,
	type ApplyPatchResult,
	type CurriculumItem,
	type CurriculumSnapshot,
	type ExpansionOp,
	type NodeKind,
	type PatchEnvelope,
	type ValidationErrorCode,
} from "../src/core/curriculum/index.ts";
import { arbFlat, arbHier, envelope, item, leafFamily, maskToIds, sampleSnapshot, snapshot } from "./curriculum-fixtures.ts";

const T = (pt: string) => ({ pt, en: pt });
const ATOM_H = { lo: 0.25, hi: 0.5 };
const CREATED = "2026-11-18T00:00:00.000Z";

function apply(s: CurriculumSnapshot, ops: ExpansionOp[], extra: Partial<PatchEnvelope> = {}): ApplyPatchResult {
	return applyPatch(s, envelope(s, ops, extra));
}

function ok(res: ApplyPatchResult) {
	assert.ok(res.ok, `patch recusado: ${JSON.stringify(!res.ok && res.errors)}`);
	assert.deepEqual(validate(res.next), []);
	assert.deepEqual(checkSnapshotCertificate(res.next), { ok: true });
	return res;
}

function fails(res: ApplyPatchResult, code: ValidationErrorCode, pattern?: RegExp): void {
	assert.ok(!res.ok, "esperado patch recusado");
	assert.ok(
		res.errors.some((e) => e.code === code && (!pattern || pattern.test(e.message))),
		`esperado ${code}${pattern ? ` ${pattern}` : ""}; obtido ${JSON.stringify(res.errors)}`,
	);
}

function seedFile(rootExtra: Record<string, unknown>) {
	return {
		schemaVersion: 1,
		domainId: "testdomain",
		areaId: "tq",
		sources: [],
		items: [
			{ id: "tq", kind: "domain", parentId: null, title: T("Raiz"), summary: "", level: { scheme: "generic", band: 0 }, hours: { lo: 1, hi: 2 }, ...rootExtra },
			{ id: "tq.a", kind: "atom", parentId: "tq", title: T("a"), summary: "", level: { scheme: "generic", band: 0 }, hours: ATOM_H },
		],
	};
}

// ─── Bug: a bad seed root made the result-returning APIs THROW ─────────────

describe("review: bad domain roots are reported, never thrown", () => {
	it("seedFilesToPatch / applySeedFiles return hierarchy errors for a root with clauses or retired", () => {
		for (const [extra, pattern] of [
			[{ clauses: [["tq.a"]] }, /cláusulas/],
			[{ status: "deprecated" }, /aposentada/],
		] as const) {
			const seeded = seedFilesToPatch([seedFile(extra)], { createdAt: CREATED });
			assert.ok(!seeded.ok && seeded.errors.some((e) => e.code === "hierarchy" && pattern.test(e.message)), JSON.stringify(seeded));
			let res: ReturnType<typeof applySeedFiles> | undefined;
			assert.doesNotThrow(() => (res = applySeedFiles([seedFile(extra)], { createdAt: CREATED })));
			assert.ok(res && !res.ok && res.errors.some((e) => e.code === "hierarchy" && pattern.test(e.message)));
		}
	});

	it("replayLedger reports a seed envelope whose root payload is not a valid root (failedAt 0)", () => {
		const good = applySeedFiles([seedFile({})], { createdAt: CREATED });
		assert.ok(good.ok);
		if (!good.ok) return;
		const env = structuredClone(good.envelope);
		env.itemPayloads.tq = { ...env.itemPayloads.tq, clauses: [["tq.a"]] };
		let replay: ReturnType<typeof replayLedger> | undefined;
		assert.doesNotThrow(() => (replay = replayLedger([env])));
		assert.ok(replay && !replay.ok && replay.failedAt === 0 && replay.errors.some((e) => e.code === "hierarchy"), JSON.stringify(replay));
	});
});

// ─── Bug: the seed root payload was trusted blindly ─────────────────────────

describe("review: the seed root payload must be the snapshot root", () => {
	it("a seed envelope whose root payload differs from version 0 is refused (replay would diverge)", () => {
		const seeded = seedFilesToPatch([seedFile({})], { createdAt: CREATED });
		assert.ok(seeded.ok);
		if (!seeded.ok) return;
		const base = applySeedFiles([seedFile({})], { createdAt: CREATED });
		assert.ok(base.ok);
		if (!base.ok) return;
		// Same envelope, but version 0 built from a root that differs from the payload.
		const v0 = { schemaVersion: 1 as const, domainId: "testdomain", version: 0, items: { tq: { ...seeded.root, summary: "outra" } }, edges: [], certificate: { order: ["tq"], hash: "" }, updatedAt: CREATED };
		fails(applyPatch(v0, seeded.envelope), "schema", /raiz do seed/);
		// A "seed" envelope later in the ledger cannot smuggle a root payload either.
		const later = base.snapshot;
		fails(
			applyPatch(later, envelope(later, [{ op: "setHours", item: "tq.a", hours: ATOM_H }], { trigger: { kind: "seed", reason: "x", priority: 0 }, itemPayloads: { tq: seeded.envelope.itemPayloads.tq! } })),
			"schema",
			/não corresponde/,
		);
	});
});

// ─── Bug: updateItem compared JSON with key order and bumped per op ─────────

describe("review: updateItem versions and no-ops", () => {
	it("the same title written with another key order is not a definition change", () => {
		const s0 = sampleSnapshot();
		const ohm = s0.items["ee.dc.ohm"]!;
		const s = snapshot(Object.values({ ...s0.items, "ee.dc.ohm": { ...ohm, title: { en: ohm.title.en, pt: ohm.title.pt } } }));
		const res = ok(apply(s, [{ op: "updateItem", item: "ee.dc.ohm", fields: { title: { pt: ohm.title.pt, en: ohm.title.en } } }]));
		assert.equal(res.next.items["ee.dc.ohm"]!.version, 1);
		assert.deepEqual(res.receipt.changedIds, []);
		assert.equal(res.next.items["ee.dc.ohm"], s.items["ee.dc.ohm"], "no-op keeps the shared object");
	});

	it("several definition edits in one patch bump the version once; A → B → A is no change at all", () => {
		const s = sampleSnapshot();
		const twice = ok(apply(s, [
			{ op: "updateItem", item: "ee.dc.ohm", fields: { summary: "V = R·I" } },
			{ op: "updateItem", item: "ee.dc.ohm", fields: { objectives: ["aplicar V = R·I"] } },
		]));
		assert.equal(twice.next.items["ee.dc.ohm"]!.version, 2);
		const back = ok(apply(s, [
			{ op: "updateItem", item: "ee.dc.ohm", fields: { summary: "outro" } },
			{ op: "updateItem", item: "ee.dc.ohm", fields: { summary: "" } },
			{ op: "setHours", item: "ee.ac", hours: { lo: 20, hi: 31 } },
		]));
		assert.equal(back.next.items["ee.dc.ohm"], s.items["ee.dc.ohm"]);
		assert.deepEqual(back.receipt.changedIds, ["ee.ac"]);
	});

	it("an item created and then updated in the same patch stays at version 1", () => {
		const s = sampleSnapshot();
		const res = ok(apply(s, [
			{ op: "addItem", id: "ee.dc.thevenin", parentId: "ee.dc", kind: "atom", title: T("Thévenin"), hours: ATOM_H, clauses: [["ee.dc.kvl"]] },
			{ op: "updateItem", item: "ee.dc.thevenin", fields: { summary: "equivalente" } },
		]));
		assert.equal(res.next.items["ee.dc.thevenin"]!.version, 1);
		assert.equal(res.next.items["ee.dc.thevenin"]!.summary, "equivalente");
	});

	it("empty fields, unknown (typo) fields and unknown payload keys are schema errors, not silent no-ops", () => {
		const s = sampleSnapshot();
		fails(apply(s, [{ op: "updateItem", item: "ee.dc.ohm", fields: {} }]), "schema", /vazio/);
		fails(applyPatch(s, envelope(s, [{ op: "updateItem", item: "ee.dc.ohm", fields: { sumary: "x" } } as unknown as ExpansionOp])), "schema", /sumary/);
		fails(
			applyPatch(
				s,
				envelope(s, [{ op: "addItem", id: "ee.dc.x", parentId: "ee.dc", kind: "atom", title: T("x"), hours: ATOM_H, clauses: "entry" }], {
					itemPayloads: { "ee.dc.x": { sumary: "x" } as unknown as Partial<CurriculumItem> },
				}),
			),
			"schema",
			/sumary/,
		);
	});
});

// ─── Bug: an empty alternative silently erased every prerequisite ──────────

describe("review: addAlternative needs a non-empty route", () => {
	it("an empty clause is refused (it was normalised to TRUE, making the item an entry item)", () => {
		const s = sampleSnapshot();
		fails(apply(s, [{ op: "addAlternative", item: "ee.dc.kvl", clause: [] }]), "schema", /ao menos um pré-requisito/);
		assert.deepEqual(s.items["ee.dc.kvl"]!.clauses, [["ee.dc.ohm"]]);
	});
});

// ─── Bug: relations could be added to retired items ─────────────────────────

describe("review: addEdge links live items only", () => {
	it("new relations from/to retired or missing items are refused; external anchors are fine", () => {
		const s = sampleSnapshot();
		const r = ok(apply(s, [{ op: "retire", item: "ee.math.calculus", reroute: [{ item: "ee.dc.nodal", clause: ["ee.math.algebra"] }] }]));
		const s1 = r.next;
		fails(apply(s1, [{ op: "addEdge", edge: { from: "ee.math.calculus", to: "ee.dc.ohm", kind: "related" } }]), "hierarchy", /aposentado/);
		fails(apply(s1, [{ op: "addEdge", edge: { from: "ee.dc.ohm", to: "ee.math.calculus", kind: "confusable_with" } }]), "hierarchy", /aposentado/);
		fails(apply(s1, [{ op: "addEdge", edge: { from: "ee.dc.ohm", to: "ee.nada", kind: "also_in" } }]), "unknown-id");
		ok(apply(s1, [{ op: "addEdge", edge: { from: "ee.dc.ohm", to: "openstax:physics#20.2", kind: "anchored_to" } }]));
	});
});

// ─── Bug: updateItem.hours dodged the setHours risk rule ───────────────────

describe("review: classifyRisk sees hours changed through updateItem", () => {
	it("> 25% through updateItem is structural, like setHours", () => {
		const s = sampleSnapshot();
		assert.equal(classifyRisk(s, { ops: [{ op: "updateItem", item: "ee.dc.ohm", fields: { hours: { lo: 0.6, hi: 0.9 } } }] }).risk, "structural");
		assert.equal(classifyRisk(s, { ops: [{ op: "setHours", item: "ee.dc.ohm", hours: { lo: 0.6, hi: 0.9 } }] }).risk, "structural");
		assert.equal(classifyRisk(s, { ops: [{ op: "updateItem", item: "ee.ac", fields: { hours: { lo: 21, hi: 31 } } }] }).risk, "low");
	});
});

// ─── Bug: the certificate checker trusted the per-object hash cache ────────

describe("review: checkSnapshotCertificate re-hashes", () => {
	it("an item mutated in place after hashing is caught", () => {
		const s = sampleSnapshot();
		assert.deepEqual(checkSnapshotCertificate(s), { ok: true });
		(s.items["ee.dc.ohm"] as { summary: string }).summary = "adulterado";
		const check = checkSnapshotCertificate(s);
		assert.ok(!check.ok && /hash divergente/.test(check.reason), JSON.stringify(check));
	});
});

// ─── Bug: LB > UB on an infeasible attained set ─────────────────────────────

describe("review: goal-plan bounds are consistent on any attained set", () => {
	it("the mand lower bound ignores prerequisites of items already attained (LB ≤ UB)", () => {
		const s = snapshot([
			item("ee", null, "domain"),
			item("ee.a", "ee", "atom", { order: 0 }),
			item("ee.b", "ee", "atom", { order: 1, clauses: [["ee.a"]] }),
			item("ee.t", "ee", "atom", { order: 2, clauses: [["ee.b"]], hours: { lo: 0.25, hi: 0.3 } }),
		]);
		// {b} is infeasible (a missing), e.g. right after a tightening patch, before any repair.
		const plan = goalPlan(s, ["ee.b"], ["ee.t"]);
		assert.deepEqual(plan.study, ["ee.t"]);
		assert.deepEqual(plan.mandatory, ["ee.t"]);
		assert.ok(plan.lowerBound <= plan.upperBound + 1e-9, JSON.stringify(plan));
	});

	it("property: LB ≤ UB for every leaf subset; on feasible states `mandatory` = mand(t) ∖ K", () => {
		fc.assert(
			fc.property(fc.oneof(arbFlat(8), arbHier(8)), fc.nat(), (file, pick) => {
				const res = applySeedFiles([file], { createdAt: CREATED });
				if (!res.ok) throw new Error(JSON.stringify(res.errors));
				const idx = curriculumIndex(res.snapshot);
				const fam = leafFamily(res.snapshot);
				const target = idx.sys.ids[pick % idx.sys.ids.length]!;
				const mand = mandatory(idx, target);
				for (let m = 0; m <= fam.full; m++) {
					const attained = maskToIds(fam, m);
					const plan = goalPlan(idx, attained, [target]);
					if (plan.lowerBound > plan.upperBound + 1e-9) return false;
					if (fam.feasible[m] === 1) {
						const closure = new Set(closureIds(idx, attained));
						const expected = mand.filter((id) => !closure.has(id));
						if (plan.mandatory.join() !== expected.join()) return false;
					}
				}
				return true;
			}),
			{ numRuns: 150 },
		);
	});
});

// ─── Independent oracle of the effective clause system ──────────────────────

type Dnf = string[][];

/** Minimal DNF as a canonical string (alternatives sorted; supersets and duplicates dropped). */
function canonicalDnf(alts: Dnf): string {
	const sets = alts.map((a) => [...new Set(a)].sort());
	const kept = sets.filter((a, i) => !sets.some((b, j) => j !== i && b.every((y) => a.includes(y)) && (b.length < a.length || j < i)));
	return kept
		.map((a) => a.join("+"))
		.sort()
		.join(" | ");
}

/**
 * Straight transcription of the types.ts header + effective.ts definition,
 * recursive and string-based (no dense ids, no shared code):
 *   entry(x) = for each stored alternative A ([] ≡ one empty alternative):
 *              A, when A cites a node STRICTLY inside parent(x)'s subtree;
 *              A ∧ entry(parent) otherwise;   roots: their stored clauses.
 *   effective(x) = [children] for a container, entry(x) for a leaf.
 */
function referenceSystem(items: CurriculumItem[]): { effective: Map<string, Dnf>; entry: (x: string) => Dnf; inside: (p: string, y: string) => boolean } {
	const byId = new Map(items.map((it) => [it.id, it]));
	const kids = new Map<string, string[]>();
	for (const it of items) if (it.parentId !== null) kids.set(it.parentId, [...(kids.get(it.parentId) ?? []), it.id]);
	const inside = (p: string, y: string): boolean => {
		for (let c = byId.get(y)?.parentId ?? null; c !== null; c = byId.get(c)?.parentId ?? null) if (c === p) return true;
		return false;
	};
	const memo = new Map<string, Dnf>();
	const entry = (x: string): Dnf => {
		const hit = memo.get(x);
		if (hit) return hit;
		const it = byId.get(x)!;
		const stored: Dnf = it.clauses.length === 0 ? [[]] : it.clauses.map((a) => [...a]);
		let out: Dnf;
		if (it.parentId === null) out = stored;
		else {
			const p = it.parentId;
			const inherited = entry(p);
			out = [];
			for (const a of stored) {
				if (a.some((y) => inside(p, y))) out.push(a);
				else for (const b of inherited) out.push([...a, ...b]);
			}
		}
		memo.set(x, out);
		return out;
	};
	const effective = new Map<string, Dnf>();
	for (const it of items) {
		const children = kids.get(it.id);
		effective.set(it.id, children ? [children] : entry(it.id));
	}
	return { effective, entry, inside };
}

/** Random forest-shaped domain (≤ 10 nodes, depth ≤ 3) whose clauses cite ANY node (siblings, cousins, ancestors, itself). */
const arbRawTree = fc
	.record({
		parents: fc.array(fc.nat({ max: 63 }), { minLength: 1, maxLength: 10 }),
		clauses: fc.array(fc.array(fc.array(fc.nat({ max: 63 }), { minLength: 0, maxLength: 3 }), { minLength: 0, maxLength: 2 }), { minLength: 11, maxLength: 11 }),
	})
	.map(({ parents, clauses }) => {
		const nodes: { id: string; parent: number; depth: number }[] = [{ id: "ee", parent: -1, depth: 0 }];
		parents.forEach((pick, i) => {
			const cands = nodes.map((_, j) => j).filter((j) => nodes[j]!.depth < 3);
			const p = cands[pick % cands.length]!;
			nodes.push({ id: `${nodes[p]!.id}.n${i}`, parent: p, depth: nodes[p]!.depth + 1 });
		});
		const kinds: NodeKind[] = ["domain", "area", "unit", "topic"];
		return nodes.map((nd, v) =>
			item(nd.id, nd.parent < 0 ? null : nodes[nd.parent]!.id, kinds[nd.depth]!, {
				order: v,
				clauses: v === 0 ? [] : clauses[v]!.map((alt) => alt.map((k) => nodes[k % nodes.length]!.id)),
			}),
		);
	});

describe("review: independent oracle of the effective system", () => {
	it("buildEffectiveSystem = the recursive definition, for any references (even invalid ones)", () => {
		fc.assert(
			fc.property(arbRawTree, (items) => {
				const sys = buildEffectiveSystem(Object.fromEntries(items.map((it) => [it.id, it])));
				const ref = referenceSystem(items).effective;
				for (const it of items) {
					const got = effectiveClausesOf(sys, it.id);
					const want = canonicalDnf(ref.get(it.id)!);
					if (canonicalDnf(got.length === 0 ? [[]] : got) !== want) return false;
				}
				return true;
			}),
			{ numRuns: 400 },
		);
	});

	it("every route into a subtree passes through its root's entry requirements (all feasible states)", () => {
		fc.assert(
			fc.property(arbHier(9), (file) => {
				const res = applySeedFiles([file], { createdAt: CREATED });
				if (!res.ok) throw new Error(JSON.stringify(res.errors));
				const snap = res.snapshot;
				const items = Object.values(snap.items).filter((it) => it.status !== "deprecated");
				const ref = referenceSystem(items);
				const containers = items.filter((p) => items.some((c) => c.parentId === p.id));
				const fam = leafFamily(snap);
				const idx = curriculumIndex(snap);
				for (let m = 0; m <= fam.full; m++) {
					if (fam.feasible[m] !== 1) continue;
					const leaves = maskToIds(fam, m);
					const known = new Set(closureIds(idx, leaves));
					for (const p of containers) {
						if (!leaves.some((leaf) => ref.inside(p.id, leaf))) continue;
						if (!ref.entry(p.id).some((alt) => alt.every((y) => known.has(y)))) return false;
					}
				}
				return true;
			}),
			{ numRuns: 150 },
		);
	});
});

// ─── Bug: the id-scoped schema step crashed on a malformed snapshot ─────────

describe("review: validate never throws on malformed snapshots", () => {
	it("schema scoped to a set of ids still reports `items: null` as a schema error", () => {
		const bad = { ...sampleSnapshot(), items: null } as unknown as CurriculumSnapshot;
		for (const schema of ["all", new Set(["ee"])] as const) {
			let errors: ReturnType<typeof validate> = [];
			assert.doesNotThrow(() => (errors = validate(bad, { schema })));
			assert.ok(errors.some((e) => e.code === "schema"), JSON.stringify(errors));
		}
	});
});
