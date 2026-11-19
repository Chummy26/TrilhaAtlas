/**
 * applyPatch — every op (happy path + its error codes), envelope checks,
 * copy-on-write immutability, ceilings, receipts and risk classes
 * (docs/research/00-SINTESE.md §2.4(e) passos 6–7, §2.13 pipeline
 * applyPatch; r10 §4 operadores, §4.1 refinamento-marco, §6.3; Clew §5–6).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	applyPatch,
	attainedClosure,
	buildEffectiveSystem,
	checkSnapshotCertificate,
	classifyRisk,
	curriculumIndex,
	effectiveClausesOf,
	outerFringe,
	rollupHours,
	validate,
	type ApplyPatchOptions,
	type ApplyPatchResult,
	type CurriculumSnapshot,
	type ExpansionOp,
	type PatchEnvelope,
	type ValidationErrorCode,
} from "../src/core/curriculum/index.ts";
import { envelope, sampleSnapshot } from "./curriculum-fixtures.ts";

const T = (pt: string) => ({ pt, en: pt });
const ATOM_H = { lo: 0.25, hi: 0.5 };

function apply(s: CurriculumSnapshot, ops: ExpansionOp[], extra: Partial<PatchEnvelope> = {}, opts: ApplyPatchOptions = {}): ApplyPatchResult {
	return applyPatch(s, envelope(s, ops, extra), opts);
}

function mustApply(s: CurriculumSnapshot, ops: ExpansionOp[], extra: Partial<PatchEnvelope> = {}, opts: ApplyPatchOptions = {}) {
	const res = apply(s, ops, extra, opts);
	assert.ok(res.ok, `patch recusado: ${JSON.stringify(!res.ok && res.errors)}`);
	assert.deepEqual(validate(res.next, { edgeMode: opts.edgeMode }), []);
	assert.deepEqual(checkSnapshotCertificate(res.next), { ok: true });
	assert.equal(res.next.version, s.version + 1);
	return res;
}

function mustFail(res: ApplyPatchResult, code: ValidationErrorCode, pattern?: RegExp): void {
	assert.ok(!res.ok, "esperado patch recusado");
	assert.ok(
		res.errors.some((e) => e.code === code && (!pattern || pattern.test(e.message))),
		`esperado ${code}${pattern ? ` ${pattern}` : ""}; obtido ${JSON.stringify(res.errors)}`,
	);
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const v of Object.values(value)) deepFreeze(v);
	}
	return value;
}

const atomOp = (id: string, parentId: string, clauses: string[][] | "entry" = "entry"): ExpansionOp => ({
	op: "addItem",
	id,
	parentId,
	kind: "atom",
	title: T(id),
	hours: ATOM_H,
	clauses,
});

describe("applyPatch: addItem", () => {
	it("adds an atom under a container with defaults, payload fields and provenance", () => {
		const s = sampleSnapshot();
		const { next, receipt } = mustApply(s, [atomOp("ee.dc.thevenin", "ee.dc", [["ee.dc.kvl"]])], {
			itemPayloads: { "ee.dc.thevenin": { summary: "Equivalente de Thévenin", aliases: ["thevenin"], objectives: ["reduzir redes lineares"] } },
		});
		const it = next.items["ee.dc.thevenin"]!;
		assert.equal(it.status, "provisional");
		assert.equal(it.order, 3);
		assert.equal(it.summary, "Equivalente de Thévenin");
		assert.equal(it.scope, "Equivalente de Thévenin");
		assert.deepEqual(it.aliases, ["thevenin"]);
		assert.deepEqual(it.level, s.items["ee.dc"]!.level);
		assert.equal(it.version, 1);
		assert.deepEqual(it.provenance, { createdBy: "expansion", trigger: "frontier:p-4", model: "test-model", promptVersion: "v1", createdAt: "2026-11-18T12:00:00.000Z" });
		assert.deepEqual(receipt.addedIds, ["ee.dc.thevenin"]);
		assert.deepEqual(receipt.changedIds, []);
		// The milestone now also waits for the new child.
		assert.ok(effectiveClausesOf(buildEffectiveSystem(next.items), "ee.dc")[0]!.includes("ee.dc.thevenin"));
	});

	it("allows a new area under the domain root and a whole chain created in the same patch", () => {
		const s = sampleSnapshot();
		const { next } = mustApply(s, [
			{ op: "addItem", id: "ee.digital", parentId: "ee", kind: "area", title: T("Digital"), hours: { lo: 1, hi: 2 }, clauses: [["ee.dc"]] },
			{ op: "addItem", id: "ee.digital.logic", parentId: "ee.digital", kind: "unit", title: T("Lógica"), hours: { lo: 1, hi: 2 }, clauses: "entry" },
			atomOp("ee.digital.logic.gates", "ee.digital.logic"),
		]);
		assert.equal(next.items["ee.digital"]!.status, "provisional", "defaulted container with children is materialised");
		assert.equal(next.items["ee.digital.logic.gates"]!.status, "provisional");
		assert.deepEqual(effectiveClausesOf(buildEffectiveSystem(next.items), "ee.digital.logic.gates"), [["ee.dc"]]);
	});

	it("refuses to hang a child from an existing leaf (that is refine)", () => {
		const s = sampleSnapshot();
		mustFail(apply(s, [atomOp("ee.dc.ohm.k", "ee.dc.ohm")]), "hierarchy", /use refine/);
		mustFail(apply(s, [{ op: "addItem", id: "ee.ac.k", parentId: "ee.ac", kind: "unit", title: T("k"), hours: { lo: 1, hi: 2 }, clauses: "entry" }]), "hierarchy", /refine/);
	});

	it("duplicate and unknown ids, ancestor prerequisites, contradicting or orphan payloads, atom size", () => {
		const s = sampleSnapshot();
		mustFail(apply(s, [atomOp("ee.dc.ohm", "ee.dc")]), "duplicate-id");
		mustFail(apply(s, [atomOp("ee.zz.k", "ee.zz")]), "unknown-id", /pai "ee\.zz"/);
		mustFail(apply(s, [atomOp("ee.dc.k", "ee.dc", [["ee.dc"]])]), "hierarchy", /ancestral/);
		mustFail(apply(s, [atomOp("ee.dc.k", "ee.dc", [["ee.nada"]])]), "unknown-id");
		mustFail(apply(s, [atomOp("ee.dc.k", "ee.dc")], { itemPayloads: { "ee.dc.k": { kind: "topic" } } }), "schema", /contradiz/);
		mustFail(apply(s, [atomOp("ee.dc.k", "ee.dc")], { itemPayloads: { "ee.dc.k": { hours: { lo: 1, hi: 1 } } } }), "schema", /horas/);
		mustFail(apply(s, [atomOp("ee.dc.k", "ee.dc")], { itemPayloads: { "ee.dc.k": { status: "deprecated" } } }), "schema", /aposentado/);
		mustFail(apply(s, [atomOp("ee.dc.k", "ee.dc")], { itemPayloads: { "ee.dc.k": { version: 2 } } }), "schema", /version/);
		mustFail(apply(s, [atomOp("ee.dc.k", "ee.dc")], { itemPayloads: { "ee.dc.ohm": { summary: "x" } } }), "schema", /não corresponde/);
		mustFail(apply(s, [{ ...atomOp("ee.dc.k", "ee.dc"), hours: { lo: 0.05, hi: 0.05 } } as ExpansionOp]), "budget");
	});

	it("ids are never reused, even after retirement", () => {
		const s = sampleSnapshot();
		const { next } = mustApply(s, [{ op: "retire", item: "ee.ac", reroute: [] }]);
		mustFail(apply(next, [{ op: "addItem", id: "ee.ac", parentId: "ee", kind: "area", title: T("ac"), hours: { lo: 1, hi: 2 }, clauses: "entry" }]), "duplicate-id", /aposentado/);
		mustFail(apply(next, [atomOp("ee.ac.k", "ee.ac")]), "hierarchy", /aposentado/);
	});
});

describe("applyPatch: addAlternative / addPrereq", () => {
	it("addAlternative relaxes an item with an OR route", () => {
		const s = sampleSnapshot();
		const { next, receipt } = mustApply(s, [{ op: "addAlternative", item: "ee.dc.kvl", clause: ["ee.math.calculus"] }]);
		assert.deepEqual(next.items["ee.dc.kvl"]!.clauses, [["ee.dc.ohm"], ["ee.math.calculus"]]);
		assert.deepEqual(effectiveClausesOf(buildEffectiveSystem(next.items), "ee.dc.kvl"), [["ee.dc.ohm"], ["ee.math", "ee.math.calculus"]]);
		assert.deepEqual(receipt.changedIds, ["ee.dc.kvl"]);
	});

	it("addAlternative: strict limit, relaxed mode, entry items, unknown ids, cycles", () => {
		const s = sampleSnapshot();
		mustFail(apply(s, [{ op: "addAlternative", item: "ee.dc.nodal", clause: ["ee.dc.ohm"] }]), "strict-alternatives");
		mustApply(s, [{ op: "addAlternative", item: "ee.dc.nodal", clause: ["ee.dc.ohm"] }], {}, { edgeMode: "relaxed" });
		mustFail(apply(s, [{ op: "addAlternative", item: "ee.math.algebra", clause: ["ee.dc.ohm"] }]), "schema", /item de entrada/);
		mustFail(apply(s, [{ op: "addAlternative", item: "ee.nada", clause: ["ee.dc.ohm"] }]), "unknown-id");
		// calculus ⇐ ohm ⇐ (inherited) ee.math ⇐ (milestone) calculus.
		mustFail(apply(s, [{ op: "addAlternative", item: "ee.math.calculus", clause: ["ee.dc.ohm"] }]), "cycle");
	});

	it("addPrereq tightens an alternative; an entry item's [] is one empty alternative", () => {
		const s = sampleSnapshot();
		const a = mustApply(s, [{ op: "addPrereq", item: "ee.dc.kvl", clauseIndex: 0, prereq: "ee.math.calculus" }]);
		assert.deepEqual(a.next.items["ee.dc.kvl"]!.clauses, [["ee.dc.ohm", "ee.math.calculus"]]);
		const b = mustApply(s, [{ op: "addPrereq", item: "ee.dc.ohm", clauseIndex: 0, prereq: "ee.math.calculus" }]);
		assert.deepEqual(b.next.items["ee.dc.ohm"]!.clauses, [["ee.math.calculus"]]);
		assert.deepEqual(effectiveClausesOf(buildEffectiveSystem(b.next.items), "ee.dc.ohm"), [["ee.math", "ee.math.calculus"]]);
	});

	it("addPrereq: index out of range, self requirement, cycle through inheritance", () => {
		const s = sampleSnapshot();
		mustFail(apply(s, [{ op: "addPrereq", item: "ee.dc.kvl", clauseIndex: 1, prereq: "ee.math.calculus" }]), "schema", /fora do intervalo/);
		mustFail(apply(s, [{ op: "addPrereq", item: "ee.dc.kvl", clauseIndex: 0, prereq: "ee.dc.kvl" }]), "cycle", /a si mesmo/);
		mustFail(apply(s, [{ op: "addPrereq", item: "ee.math.algebra", clauseIndex: 0, prereq: "ee.dc.ohm" }]), "cycle");
	});
});

describe("applyPatch: refine (milestone refinement)", () => {
	const sub = (lo: number, hi: number) => [
		{ id: "ee.ac.phasors", kind: "unit" as const, title: T("Fasores"), hours: { lo, hi }, clauses: "entry" as const },
		{ id: "ee.ac.power", kind: "unit" as const, title: T("Potência CA"), hours: { lo, hi }, clauses: [["ee.ac.phasors"]] },
	];

	it("keeps the id as a milestone, inherits its requirements and conserves hours", () => {
		const s = sampleSnapshot();
		const { next, receipt } = mustApply(s, [{ op: "refine", item: "ee.ac", sub: sub(10, 15) }]);
		assert.equal(next.items["ee.ac"]!.status, "provisional");
		assert.equal(next.items["ee.ac.phasors"]!.status, "stub");
		assert.deepEqual(receipt.addedIds, ["ee.ac.phasors", "ee.ac.power"]);
		assert.deepEqual(receipt.changedIds, ["ee.ac"]);
		const sys = buildEffectiveSystem(next.items);
		assert.deepEqual(effectiveClausesOf(sys, "ee.ac"), [["ee.ac.phasors", "ee.ac.power"]]);
		assert.deepEqual(effectiveClausesOf(sys, "ee.ac.phasors"), [["ee.dc"]]);
		assert.deepEqual(effectiveClausesOf(sys, "ee.ac.power"), [["ee.ac.phasors"]]);
		assert.deepEqual(rollupHours(next).get("ee.ac"), { lo: 20, hi: 30 });
		// refine_lift: "ee.ac attained" survives the refinement.
		const known = attainedClosure(next, ["ee.ac"]);
		const idx = curriculumIndex(next);
		for (const id of ["ee.ac", "ee.ac.phasors", "ee.ac.power"]) assert.equal(known[idx.sys.index.get(id)!], 1, id);
		assert.ok(!outerFringe(next, ["ee.ac"]).includes("ee.ac.phasors"));
	});

	it("hours-conservation: ±25% by default, configurable ε", () => {
		const s = sampleSnapshot();
		mustApply(s, [{ op: "refine", item: "ee.ac", sub: sub(12, 18) }]);
		mustFail(apply(s, [{ op: "refine", item: "ee.ac", sub: sub(15, 20) }]), "hours-conservation", /reestime/);
		mustFail(apply(s, [{ op: "refine", item: "ee.ac", sub: sub(5, 6) }]), "hours-conservation");
		mustApply(s, [{ op: "refine", item: "ee.ac", sub: sub(15, 20) }], {}, { refineEpsilon: 0.5 });
	});

	it("only leaves that are not atoms; sub ids fresh and unique; kinds descend", () => {
		const s = sampleSnapshot();
		const one = (id: string, kind: "atom" | "unit" | "area" = "atom") => [{ id, kind, title: T(id), hours: { lo: 2, hi: 3 }, clauses: "entry" as const }];
		mustFail(apply(s, [{ op: "refine", item: "ee.dc.ohm", sub: one("ee.dc.ohm.k") }]), "hierarchy", /átomo/);
		mustFail(apply(s, [{ op: "refine", item: "ee.dc", sub: one("ee.dc.k") }]), "hierarchy", /já é contêiner/);
		mustFail(apply(s, [{ op: "refine", item: "ee.dc.nodal", sub: [...one("ee.dc.nodal.k"), ...one("ee.dc.nodal.k")] }]), "duplicate-id");
		mustFail(apply(s, [{ op: "refine", item: "ee.dc.nodal", sub: [{ ...one("ee.dc.ohm")[0]!, hours: { lo: 2, hi: 3 } }] }]), "duplicate-id");
		mustFail(apply(s, [{ op: "refine", item: "ee.ac", sub: [{ id: "ee.ac.k", kind: "area", title: T("k"), hours: { lo: 20, hi: 30 }, clauses: "entry" }] }]), "hierarchy", /kind deve descer/);
	});
});

describe("applyPatch: addSubdomain", () => {
	it("creates the container (kind one level down, hours Σ items, entry clauses from the payload) and resolves parents first", () => {
		const s = sampleSnapshot();
		const { next, receipt } = mustApply(
			s,
			[
				{
					op: "addSubdomain",
					id: "ee.digital",
					parentId: "ee",
					title: T("Eletrônica digital"),
					items: [
						{ id: "ee.digital.logic.gates", parentId: "ee.digital.logic", kind: "atom", title: T("Portas"), hours: ATOM_H, clauses: "entry" },
						{ id: "ee.digital.logic", parentId: "ee.digital", kind: "unit", title: T("Lógica"), hours: { lo: 1, hi: 2 }, clauses: "entry" },
					],
				},
			],
			{ itemPayloads: { "ee.digital": { clauses: [["ee.dc"]], summary: "Sistemas digitais" } } },
		);
		const d = next.items["ee.digital"]!;
		assert.equal(d.kind, "area");
		assert.deepEqual(d.hours, { lo: 1.25, hi: 2.5 });
		assert.equal(d.status, "provisional");
		assert.equal(d.summary, "Sistemas digitais");
		assert.deepEqual(receipt.addedIds, ["ee.digital", "ee.digital.logic", "ee.digital.logic.gates"]);
		assert.deepEqual(effectiveClausesOf(buildEffectiveSystem(next.items), "ee.digital.logic.gates"), [["ee.dc"]]);
	});

	it("items must live inside; the parent must accept children; the container cannot be an atom", () => {
		const s = sampleSnapshot();
		const sd = (parentId: string, items: Extract<ExpansionOp, { op: "addSubdomain" }>["items"]): ExpansionOp => ({ op: "addSubdomain", id: `${parentId}.sd`, parentId, title: T("sd"), items });
		mustFail(apply(s, [sd("ee", [{ id: "ee.dc.k", parentId: "ee.dc", kind: "atom", title: T("k"), hours: ATOM_H, clauses: "entry" }])]), "hierarchy", /fora do subdomínio/);
		const inner = (sdId: string) => [{ id: `${sdId}.k`, parentId: sdId, kind: "atom" as const, title: T("k"), hours: ATOM_H, clauses: "entry" as const }];
		mustFail(apply(s, [sd("ee.dc.ohm", inner("ee.dc.ohm.sd"))]), "hierarchy", /refine/);
		mustFail(apply(s, [sd("ee", inner("ee.sd"))], { itemPayloads: { "ee.sd": { kind: "atom" } } }), "hierarchy", /contêiner/);
		mustFail(apply(s, [sd("ee", [])]), "schema", /ao menos um item/);
		mustFail(
			apply(s, [
				sd("ee", [
					{ id: "ee.sd.a", parentId: "ee.sd.b", kind: "topic", title: T("a"), hours: { lo: 1, hi: 2 }, clauses: "entry" },
					{ id: "ee.sd.b", parentId: "ee.sd.a", kind: "topic", title: T("b"), hours: { lo: 1, hi: 2 }, clauses: "entry" },
				]),
			]),
			"hierarchy",
			/ciclo/,
		);
	});
});

describe("applyPatch: retire", () => {
	it("requires a reroute for every dependent and rewrites (C ∖ retired) ∪ R", () => {
		const s = sampleSnapshot();
		mustFail(apply(s, [{ op: "retire", item: "ee.dc.kvl", reroute: [] }]), "retire-reroute", /ee\.dc\.nodal/);
		const { next, receipt } = mustApply(s, [{ op: "retire", item: "ee.dc.kvl", reroute: [{ item: "ee.dc.nodal", clause: ["ee.dc.ohm"] }] }]);
		assert.equal(next.items["ee.dc.kvl"]!.status, "deprecated", "tombstone kept");
		assert.deepEqual(next.items["ee.dc.nodal"]!.clauses, [["ee.dc.ohm"], ["ee.math.calculus"]]);
		assert.ok(!next.certificate.order.includes("ee.dc.kvl"));
		assert.deepEqual(receipt.changedIds, ["ee.dc.kvl", "ee.dc.nodal"]);
	});

	it("retires a whole subtree and drops soft/encompasses references into it", () => {
		const s = sampleSnapshot();
		const { next } = mustApply(s, [
			{
				op: "retire",
				item: "ee.math",
				reroute: [
					{ item: "ee.dc", clause: [] },
					{ item: "ee.dc.nodal", clause: ["ee.dc.ohm"] },
				],
			},
		]);
		for (const id of ["ee.math", "ee.math.algebra", "ee.math.calculus"]) assert.equal(next.items[id]!.status, "deprecated", id);
		assert.deepEqual(next.items["ee.dc"]!.clauses, []);
		assert.deepEqual(next.items["ee.dc.nodal"]!.clauses, [["ee.dc.kvl"], ["ee.dc.ohm"]]);
		assert.deepEqual(next.items["ee.ac"]!.softPrereqs, []);
	});

	it("root, last live child, already retired, unknown, bad reroutes", () => {
		const s = sampleSnapshot();
		mustFail(apply(s, [{ op: "retire", item: "ee", reroute: [] }]), "hierarchy", /raiz/);
		mustFail(
			apply(s, [
				{ op: "retire", item: "ee.math.algebra", reroute: [{ item: "ee.math.calculus", clause: [] }] },
				{ op: "retire", item: "ee.math.calculus", reroute: [] },
			]),
			"hierarchy",
			/sem filhos vivos/,
		);
		const { next } = mustApply(s, [{ op: "retire", item: "ee.ac", reroute: [] }]);
		mustFail(apply(next, [{ op: "retire", item: "ee.ac", reroute: [] }]), "retire-reroute", /já está aposentado/);
		mustFail(apply(s, [{ op: "retire", item: "ee.nada", reroute: [] }]), "unknown-id");
		mustFail(
			apply(s, [{ op: "retire", item: "ee.dc.kvl", reroute: [{ item: "ee.dc.nodal", clause: ["ee.dc.ohm"] }, { item: "ee.ac", clause: [] }] }]),
			"retire-reroute",
			/não depende/,
		);
		mustFail(apply(s, [{ op: "retire", item: "ee.dc", reroute: [{ item: "ee.ac", clause: ["ee.dc.ohm"] }] }]), "retire-reroute", /sendo aposentados/);
	});
});

describe("applyPatch: setHours / updateItem / addEdge", () => {
	it("setHours re-estimates without a definition bump; atom bands still apply", () => {
		const s = sampleSnapshot();
		const { next, receipt } = mustApply(s, [{ op: "setHours", item: "ee.ac", hours: { lo: 10, hi: 12 } }]);
		assert.deepEqual(next.items["ee.ac"]!.hours, { lo: 10, hi: 12 });
		assert.equal(next.items["ee.ac"]!.version, 1);
		assert.deepEqual(receipt.changedIds, ["ee.ac"]);
		mustFail(apply(s, [{ op: "setHours", item: "ee.dc.ohm", hours: { lo: 2, hi: 3 } }]), "budget");
		mustFail(apply(s, [{ op: "setHours", item: "ee.nada", hours: { lo: 2, hi: 3 } }]), "unknown-id");
		mustFail(apply(s, [{ op: "setHours", item: "ee.ac", hours: { lo: 3, hi: 2 } }]), "schema");
	});

	it("updateItem bumps the item version only when a definition field changes", () => {
		const s = sampleSnapshot();
		const a = mustApply(s, [{ op: "updateItem", item: "ee.dc.ohm", fields: { summary: "V = R·I" } }]);
		assert.equal(a.next.items["ee.dc.ohm"]!.version, 2);
		assert.equal(a.next.items["ee.dc.ohm"]!.summary, "V = R·I");
		const b = mustApply(s, [{ op: "updateItem", item: "ee.dc.ohm", fields: { aliases: ["ohm", "resistor"] } }]);
		assert.equal(b.next.items["ee.dc.ohm"]!.version, 1);
		const c = mustApply(s, [{ op: "updateItem", item: "ee.dc.ohm", fields: { summary: "" } }]);
		assert.equal(c.next.items["ee.dc.ohm"]!.version, 1, "same value: no bump");
		const d = mustApply(s, [{ op: "updateItem", item: "ee.ac", fields: { status: "stable" } }]);
		assert.equal(d.next.items["ee.ac"]!.status, "stable");
	});

	it("updateItem: identity/structure are immutable, version is derived, retirement needs retire", () => {
		const s = sampleSnapshot();
		for (const fields of [{ id: "ee.dc.x" }, { parentId: "ee.math" }, { kind: "topic" }, { domainId: "x" }, { clauses: [["ee.math"]] }])
			mustFail(applyPatch(s, envelope(s, [{ op: "updateItem", item: "ee.dc.ohm", fields } as unknown as ExpansionOp])), "immutable-id");
		mustFail(applyPatch(s, envelope(s, [{ op: "updateItem", item: "ee.dc.ohm", fields: { version: 9 } }])), "schema", /derivada/);
		mustFail(apply(s, [{ op: "updateItem", item: "ee.dc.ohm", fields: { status: "deprecated" } }]), "retire-reroute", /retire/);
		mustFail(apply(s, [{ op: "updateItem", item: "ee.nada", fields: { summary: "x" } }]), "unknown-id");
	});

	it("addEdge stores non-gating relations, replacing duplicates and mirrored symmetric pairs", () => {
		const s = sampleSnapshot();
		const a = mustApply(s, [
			{ op: "addEdge", edge: { from: "ee.dc.ohm", to: "ee.dc.kvl", kind: "related" } },
			{ op: "addEdge", edge: { from: "ee.dc.kvl", to: "ee.dc.ohm", kind: "related", w: 0.5 } },
			{ op: "addEdge", edge: { from: "ee.dc.kvl", to: "ee.dc.ohm", kind: "confusable_with" } },
			{ op: "addEdge", edge: { from: "ee.dc.ohm", to: "openstax:physics-2e#20.2", kind: "anchored_to" } },
		]);
		assert.equal(a.next.edges.length, 3);
		assert.deepEqual(a.next.edges.find((e) => e.kind === "related"), { from: "ee.dc.kvl", to: "ee.dc.ohm", kind: "related", w: 0.5 });
		assert.notEqual(a.next.certificate.hash, s.certificate.hash);
		mustFail(apply(s, [{ op: "addEdge", edge: { from: "ee.dc.ohm", to: "ee.dc.ohm", kind: "related" } }]), "schema", /si mesmo/);
		mustFail(apply(s, [{ op: "addEdge", edge: { from: "ee.nada", to: "ee.dc.ohm", kind: "related" } }]), "unknown-id");
	});
});

describe("applyPatch: envelope, atomicity, immutability, receipts", () => {
	it("rejects malformed envelopes, foreign domains and stale base versions", () => {
		const s = sampleSnapshot();
		const env = envelope(s, [{ op: "setHours", item: "ee.ac", hours: { lo: 10, hi: 12 } }]);
		mustFail(applyPatch(s, null), "schema");
		mustFail(applyPatch(s, { ...env, ops: [] }), "schema", /ao menos uma operação/);
		mustFail(applyPatch(s, { ...env, ops: [{ op: "explode", item: "ee.ac" }] }), "schema");
		mustFail(applyPatch(s, { ...env, extra: true }), "schema");
		mustFail(applyPatch(s, { ...env, domainId: "outro" }), "schema", /domínio/);
		mustFail(applyPatch(s, { ...env, baseVersion: 2 }), "schema", /conflito de versão/);
	});

	it("is all-or-nothing and names the failing op", () => {
		const s = sampleSnapshot();
		const before = JSON.stringify(s);
		const res = apply(s, [
			{ op: "setHours", item: "ee.ac", hours: { lo: 10, hi: 12 } },
			{ op: "setHours", item: "ee.nada", hours: { lo: 1, hi: 2 } },
		]);
		mustFail(res, "unknown-id", /^ops\[1\] setHours ee\.nada:/);
		assert.equal(JSON.stringify(s), before);
	});

	it("never mutates the (deep-frozen) input and shares untouched items (copy-on-write)", () => {
		const s = deepFreeze(sampleSnapshot());
		const env = deepFreeze(
			envelope(
				s,
				[
					atomOp("ee.dc.thevenin", "ee.dc", [["ee.dc.kvl"]]),
					{ op: "addAlternative", item: "ee.dc.kvl", clause: ["ee.math.calculus"] },
					{ op: "addPrereq", item: "ee.dc.ohm", clauseIndex: 0, prereq: "ee.math.calculus" },
					{ op: "refine", item: "ee.ac", sub: [{ id: "ee.ac.phasors", kind: "unit", title: T("f"), hours: { lo: 20, hi: 30 }, clauses: "entry" }] },
					{ op: "setHours", item: "ee.dc.nodal", hours: { lo: 2, hi: 4 } },
					{ op: "updateItem", item: "ee.math.algebra", fields: { summary: "nova", aliases: ["álgebra"] } },
					{ op: "addEdge", edge: { from: "ee.dc.ohm", to: "ee.dc.kvl", kind: "related" } },
					{ op: "retire", item: "ee.dc.thevenin", reroute: [] },
				],
				{ itemPayloads: { "ee.dc.thevenin": { aliases: ["thevenin"] } } },
			),
		);
		const before = JSON.stringify(s);
		const res = applyPatch(s, env);
		assert.ok(res.ok, JSON.stringify(!res.ok && res.errors));
		assert.equal(JSON.stringify(s), before);
		assert.equal(res.next.items["ee.math.calculus"], s.items["ee.math.calculus"], "untouched item shared");
		assert.notEqual(res.next.items["ee.dc.kvl"], s.items["ee.dc.kvl"]);
		assert.equal(res.next.items["ee.dc.thevenin"]!.status, "deprecated");
		assert.deepEqual(validate(res.next), []);
	});

	it("ceilings: items per patch and live items", () => {
		const s = sampleSnapshot();
		const two = [atomOp("ee.dc.k1", "ee.dc"), atomOp("ee.dc.k2", "ee.dc")];
		mustFail(apply(s, two, {}, { limits: { maxAddedPerPatch: 1 } }), "budget", /teto por patch/);
		mustFail(apply(s, two, {}, { limits: { maxItems: 10 } }), "budget", /itens vivos/);
		mustApply(s, two, {}, { limits: { maxAddedPerPatch: 2, maxItems: 11 } });
	});

	it("receipt: versions, hash, apply time (envelope time unless overridden), flags; deterministic", () => {
		const s = sampleSnapshot();
		const ops: ExpansionOp[] = [{ op: "setHours", item: "ee.ac", hours: { lo: 10, hi: 12 } }];
		const a = mustApply(s, ops);
		assert.deepEqual(
			{ ...a.receipt },
			{
				patchId: "p-4",
				appliedAt: "2026-11-18T12:00:00.000Z",
				fromVersion: 3,
				toVersion: 4,
				certificateHash: a.next.certificate.hash,
				addedIds: [],
				changedIds: ["ee.ac"],
				autoApplied: false,
				undoable: true,
			},
		);
		assert.equal(a.next.updatedAt, "2026-11-18T12:00:00.000Z");
		const b = mustApply(s, ops, {}, { now: "2026-11-19T00:00:00.000Z", autoApplied: true });
		assert.equal(b.receipt.appliedAt, "2026-11-19T00:00:00.000Z");
		assert.equal(b.receipt.autoApplied, true);
		assert.equal(b.next.certificate.hash, a.next.certificate.hash, "apply time is not part of the hash");
	});
});

describe("classifyRisk", () => {
	const s = sampleSnapshot();
	const risk = (ops: ExpansionOp[]) => classifyRisk(s, { ops }).risk;

	it("low for local, non-stable edits; structural otherwise", () => {
		assert.equal(risk([{ op: "setHours", item: "ee.ac", hours: { lo: 20, hi: 31 } }]), "low");
		assert.equal(risk([{ op: "setHours", item: "ee.ac", hours: { lo: 40, hi: 50 } }]), "structural");
		assert.equal(risk([{ op: "refine", item: "ee.ac", sub: [] }]), "low");
		assert.equal(risk([{ op: "updateItem", item: "ee.dc.ohm", fields: { aliases: ["x"] } }]), "low");
		assert.equal(risk([{ op: "addEdge", edge: { from: "ee.dc.ohm", to: "ee.dc.kvl", kind: "related" } }]), "low");
		assert.equal(risk([{ op: "updateItem", item: "ee.dc.ohm", fields: { summary: "x" } }]), "structural");
		assert.equal(risk([atomOp("ee.dc.k", "ee.dc")]), "structural");
		assert.equal(risk([{ op: "addPrereq", item: "ee.dc.kvl", clauseIndex: 0, prereq: "ee.math.calculus" }]), "structural");
		assert.equal(risk([{ op: "retire", item: "ee.ac", reroute: [] }]), "structural");
		const r = classifyRisk(s, { ops: [{ op: "addSubdomain", id: "ee.x", parentId: "ee", title: T("x"), items: [] }] });
		assert.equal(r.risk, "structural");
		assert.match(r.reasons[0]!, /estrutural/);
	});
});
