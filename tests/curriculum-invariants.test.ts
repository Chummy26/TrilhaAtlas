/**
 * validate(snapshot) — one test per ValidationErrorCode it can produce and
 * per lint warning (docs/research/00-SINTESE.md §2.13 invariantes; r10 §3.1
 * R1–R3, §11.1 modo estrito; r3 §4.4 I1–I10).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildEffectiveSystem,
	checkCycleWitness,
	validate,
	validateReport,
	type CurriculumItem,
	type CurriculumSnapshot,
	type ValidationError,
	type ValidationErrorCode,
} from "../src/core/curriculum/index.ts";
import { item, sampleSnapshot, snapshot } from "./curriculum-fixtures.ts";

function base(): CurriculumItem[] {
	return [
		item("ee", null, "domain"),
		item("ee.a", "ee", "area"),
		item("ee.a.x", "ee.a", "atom"),
		item("ee.a.y", "ee.a", "atom", { clauses: [["ee.a.x"]] }),
		item("ee.b", "ee", "area", { status: "stub", hours: { lo: 1, hi: 2 } }),
	];
}

/** Base items with replacements/additions by id. */
function withItems(...changes: CurriculumItem[]): CurriculumSnapshot {
	const map = new Map(base().map((it) => [it.id, it]));
	for (const c of changes) map.set(c.id, c);
	return snapshot([...map.values()]);
}

function codes(errors: readonly ValidationError[]): ValidationErrorCode[] {
	return [...new Set(errors.map((e) => e.code))].sort();
}

function expectError(errors: readonly ValidationError[], code: ValidationErrorCode, pattern?: RegExp): ValidationError {
	const found = errors.find((e) => e.code === code && (!pattern || pattern.test(e.message)));
	assert.ok(found, `esperado erro ${code}${pattern ? ` ${pattern}` : ""}; obtido ${JSON.stringify(errors)}`);
	return found;
}

describe("validate: valid snapshots", () => {
	it("accepts the base and the sample domain", () => {
		assert.deepEqual(validate(withItems()), []);
		assert.deepEqual(validate(sampleSnapshot()), []);
		assert.deepEqual(validate(sampleSnapshot(), { schema: "none" }), []);
	});

	it("reports stats and keeps the effective system and order", () => {
		const r = validateReport(sampleSnapshot());
		assert.equal(r.stats.items, 9);
		assert.equal(r.stats.live, 9);
		assert.equal(r.stats.leaves, 6);
		assert.ok(r.sys && r.order && r.order.length === 9);
		assert.ok(r.stats.ms >= 0);
	});
});

describe("validate: schema", () => {
	it("zod shape errors carry readable paths", () => {
		const bad = withItems({ ...item("ee.a.z", "ee.a", "atom"), hours: { lo: 2, hi: 1 } });
		expectError(validate(bad), "schema", /items\.ee\.a\.z\.hours|ee\.a\.z.*hours|hours/);
		const badId = withItems(item("ee.a.Bad", "ee.a", "atom"));
		expectError(validate(badId), "schema", /id inválido/);
	});

	it("record key must equal the id; foreign domain; atomType on a container; empty alternative; self encompasses; self-loop edge", () => {
		const s = withItems();
		const keyed = { ...s, items: { ...s.items, "ee.a.q": item("ee.a.w", "ee.a", "atom") } };
		expectError(validate(keyed), "schema", /chave deve ser o próprio id/);
		expectError(validate(withItems(item("ee.a.z", "ee.a", "atom", { domainId: "outro" }))), "schema", /domainId/);
		expectError(validate(withItems(item("ee.b", "ee", "area", { atomType: "concept" }))), "schema", /atomType/);
		expectError(validate(withItems(item("ee.a.z", "ee.a", "atom", { clauses: [[]] }))), "schema", /alternativa 0 vazia/);
		expectError(validate(withItems(item("ee.a.z", "ee.a", "atom", { encompasses: [{ id: "ee.a.z", w: 0.5 }] }))), "schema", /encompasses/);
		expectError(validate({ ...s, edges: [{ from: "ee.a.x", to: "ee.a.x", kind: "related" }] }), "schema", /para si mesmo/);
	});

	it("the schema scope can be limited to touched ids", () => {
		const bad = withItems({ ...item("ee.a.z", "ee.a", "atom"), hours: { lo: 2, hi: 1 } });
		assert.ok(validate(bad, { schema: new Set(["ee.a.z"]) }).some((e) => e.code === "schema"));
		assert.ok(!validate(bad, { schema: new Set(["ee.a.x"]) }).some((e) => e.code === "schema"));
	});
});

describe("validate: duplicate-id and unknown-id (R3)", () => {
	it("the same id under two keys", () => {
		const s = withItems();
		const dup = { ...s, items: { ...s.items, "ee.a.x2": { ...s.items["ee.a.x"]! } } };
		expectError(validate(dup), "duplicate-id", /ee\.a\.x/);
	});

	it("dangling parent, clause member, soft prerequisite, encompasses, aliasOf, supersededBy and edge endpoints", () => {
		expectError(validate(withItems(item("ee.q.z", "ee.q", "atom"))), "unknown-id", /pai "ee\.q"/);
		expectError(validate(withItems(item("ee.a.z", "ee.a", "atom", { clauses: [["ee.nada"]] }))), "unknown-id", /"ee\.nada" não existe/);
		expectError(validate(withItems(item("ee.a.z", "ee.a", "atom", { softPrereqs: ["ee.nada"] }))), "unknown-id", /suave/);
		expectError(validate(withItems(item("ee.a.z", "ee.a", "atom", { encompasses: [{ id: "ee.nada", w: 0.3 }] }))), "unknown-id", /encompasses/);
		expectError(validate(withItems(item("ee.a.z", "ee.a", "atom", { aliasOf: "ee.nada" }))), "unknown-id", /aliasOf/);
		expectError(validate(withItems(item("ee.a.z", "ee.a", "atom", { supersededBy: ["ee.nada"] }))), "unknown-id", /supersededBy/);
		const s = withItems();
		const errs = validate({ ...s, edges: [{ from: "ee.nada", to: "ee.zero", kind: "related" }] });
		expectError(errs, "unknown-id", /origem/);
		expectError(errs, "unknown-id", /destino/);
		// anchored_to / covered_by point outside the graph: only `from` must exist.
		assert.deepEqual(validate({ ...s, edges: [{ from: "ee.a.x", to: "openstax:physics-2e#9.3", kind: "anchored_to" }] }), []);
	});

	it("a retired clause member is dangling; a retired soft prerequisite is only a warning", () => {
		const retired = item("ee.a.x", "ee.a", "atom", { status: "deprecated" });
		expectError(validate(withItems(retired, item("ee.a.k", "ee.a", "atom"))), "unknown-id", /aposentado/);
		const soft = withItems(item("ee.a.k", "ee.a", "atom", { status: "deprecated" }), item("ee.b", "ee", "area", { status: "stub", softPrereqs: ["ee.a.k"] }));
		const r = validateReport(soft);
		assert.deepEqual(r.errors, []);
		assert.ok(r.warnings.some((w) => w.code === "stale-reference"));
	});
});

describe("validate: hierarchy", () => {
	it("exactly one live root of kind domain, without clauses", () => {
		expectError(validate(withItems(item("ef", null, "domain"))), "hierarchy", /2 raízes/);
		const noRoot = snapshot(base().map((it) => (it.id === "ee" ? { ...it, status: "deprecated" as const } : it)));
		expectError(validate(noRoot), "hierarchy", /sem raiz viva|não tem raiz viva/);
		expectError(validate(withItems(item("ee", null, "area"))), "hierarchy", /kind "domain"/);
		expectError(validate(withItems(item("ee", null, "domain", { clauses: [["ee.a.x"]] }))), "hierarchy", /raiz ee não pode ter cláusulas/);
	});

	it("kinds descend, atoms are leaves, live items never hang from retired parents, ids keep the prefix", () => {
		expectError(validate(withItems(item("ee.a.u", "ee.a", "unit"), item("ee.a.u.v", "ee.a.u", "area"))), "hierarchy", /o kind deve descer/);
		expectError(validate(withItems(item("ee.a.x.k", "ee.a.x", "atom"))), "hierarchy", /átomo ee\.a\.x tem filhos/);
		expectError(validate(withItems(item("ee.a.k", "ee.a", "domain"))), "hierarchy", /só a raiz/);
		expectError(
			validate(withItems(item("ee.c", "ee", "area", { status: "deprecated" }), item("ee.c.k", "ee.c", "atom"))),
			"hierarchy",
			/pai ee\.c foi aposentado/,
		);
		expectError(validate(withItems(item("ff.k", "ee.a", "atom"))), "hierarchy", /fora do prefixo/);
	});

	it("parent cycles are reported", () => {
		const errs = validate(withItems(item("ee.p", "ee.q", "unit"), item("ee.q", "ee.p", "unit")));
		expectError(errs, "hierarchy", /part_of tem ciclo/);
	});

	it("clauses never mention an ancestor or a descendant", () => {
		expectError(validate(withItems(item("ee.a.z", "ee.a", "atom", { clauses: [["ee.a"]] }))), "hierarchy", /ancestral ee\.a/);
		expectError(validate(withItems(item("ee.a", "ee", "area", { clauses: [["ee.a.x"]] }))), "hierarchy", /descendente ee\.a\.x/);
	});
});

describe("validate: strict-alternatives", () => {
	it("at most 2 stored alternatives in strict mode; relaxed lifts the limit; the limit is configurable", () => {
		const s = withItems(
			item("ee.a.k", "ee.a", "atom"),
			item("ee.a.z", "ee.a", "atom", { clauses: [["ee.a.x"], ["ee.a.y"], ["ee.a.k"]] }),
		);
		expectError(validate(s), "strict-alternatives", /3 alternativas/);
		assert.deepEqual(validate(s, { edgeMode: "relaxed" }), []);
		assert.deepEqual(validate(s, { strictMaxAlternatives: 3 }), []);
	});

	it("counts EFFECTIVE alternatives (inherited entry alternatives multiply)", () => {
		const s = withItems(
			item("ee.a.k", "ee.a", "atom"),
			item("ee.a.m", "ee.a", "atom"),
			item("ee.b", "ee", "area", { clauses: [["ee.a.x"], ["ee.a.k"]] }),
			item("ee.b.z", "ee.b", "atom", { clauses: [["ee.a.y"], ["ee.a.m"]] }),
		);
		expectError(validate(s), "strict-alternatives", /alternativas efetivas/);
		assert.deepEqual(validate(s, { edgeMode: "relaxed" }), []);
	});

	it("an effective DNF overflow (> 64) is an error in any mode", () => {
		const atoms = Array.from({ length: 17 }, (_, i) => item(`ee.a.p${i}`, "ee.a", "atom"));
		const s = withItems(
			...atoms,
			item("ee.b", "ee", "area", { clauses: atoms.slice(0, 8).map((a) => [a.id]) }),
			item("ee.b.z", "ee.b", "atom", { clauses: atoms.slice(8).map((a) => [a.id]) }),
		);
		expectError(validate(s, { edgeMode: "relaxed" }), "strict-alternatives", /explodiu/);
	});
});

describe("validate: budget", () => {
	it("atoms outside the hard 8–60 min band; regime atoms are exempt", () => {
		expectError(validate(withItems(item("ee.a.z", "ee.a", "atom", { hours: { lo: 0.05, hi: 0.05 } }))), "budget", /3 min/);
		expectError(validate(withItems(item("ee.a.z", "ee.a", "atom", { hours: { lo: 1, hi: 2 } }))), "budget", /divida o átomo/);
		assert.deepEqual(validate(withItems(item("ee.a.z", "ee.a", "atom", { atomType: "practice_regime", hours: { lo: 10, hi: 20 } }))), []);
	});

	it("domain ceilings: live items and total hours", () => {
		expectError(validate(withItems(), { limits: { maxItems: 4 } }), "budget", /5 itens vivos/);
		expectError(validate(withItems(), { limits: { maxTotalHours: 1 } }), "budget", /teto é 1 h/);
		assert.deepEqual(validate(withItems(), { limits: { maxItems: 5, maxTotalHours: 10 } }), []);
	});
});

describe("validate: cycle (R2) and no-route (R1)", () => {
	function assertWitnessOnEffectiveGraph(s: CurriculumSnapshot, err: ValidationError): void {
		const sys = buildEffectiveSystem(s.items);
		const hasEdge = (u: string, v: string) => {
			const x = sys.index.get(v)!;
			const y = sys.index.get(u)!;
			return sys.prereqs[x]!.includes(y) || sys.soft[x]!.includes(y);
		};
		assert.deepEqual(checkCycleWitness(hasEdge, err.witness!), { ok: true }, JSON.stringify(err));
	}

	it("a direct cycle has a verifiable witness and a step-by-step message", () => {
		const s = withItems(item("ee.a.x", "ee.a", "atom", { clauses: [["ee.a.y"]] }));
		const err = expectError(validate(s), "cycle", /exige/);
		assertWitnessOnEffectiveGraph(s, err);
		assert.ok(!validate(s).some((e) => e.code === "no-route"), "no-route is not reported on top of a cycle");
	});

	it("self requirement", () => {
		expectError(validate(withItems(item("ee.a.z", "ee.a", "atom", { clauses: [["ee.a.z"]] }))), "cycle", /a si mesmo/);
	});

	it("cycles through inherited entry requirements and milestones", () => {
		// ee.a requires ee.b (entry); ee.b.k requires ee.a.x ⇒ ee.b ⇐ ee.b.k ⇐ ee.a.x ⇐ ee.b.
		const s = withItems(item("ee.a", "ee", "area", { clauses: [["ee.b"]] }), item("ee.b", "ee", "area"), item("ee.b.k", "ee.b", "atom", { clauses: [["ee.a.x"]] }));
		const err = expectError(validate(s), "cycle", /herda|marco/);
		assertWitnessOnEffectiveGraph(s, err);
	});

	it("soft prerequisites take part in acyclicity (r3 I3)", () => {
		const s = withItems(item("ee.a.x", "ee.a", "atom", { softPrereqs: ["ee.a.y"] }));
		const err = expectError(validate(s), "cycle", /suave/);
		assertWitnessOnEffectiveGraph(s, err);
	});

	it("items whose every alternative is dead have no route (and neither do their dependents)", () => {
		const s = withItems(item("ee.a.k", "ee.a", "atom", { clauses: [["ee.gone"]] }), item("ee.a.m", "ee.a", "atom", { clauses: [["ee.a.k"]] }));
		const errs = validate(s);
		const nr = expectError(errs, "no-route");
		for (const id of ["ee.a.k", "ee.a.m", "ee.a", "ee"]) assert.ok(nr.witness!.includes(id), id);
		assert.deepEqual(codes(errs), ["no-route", "unknown-id"]);
	});
});

describe("validateReport: lint warnings", () => {
	it("granularity, fan-in, level monotonicity, encompasses of a non-ancestor", () => {
		const s = withItems(
			...Array.from({ length: 6 }, (_, i) => item(`ee.a.p${i}`, "ee.a", "atom")),
			item("ee.a.fan", "ee.a", "atom", { clauses: [Array.from({ length: 6 }, (_, i) => `ee.a.p${i}`)] }),
			item("ee.a.hi", "ee.a", "atom", { level: { scheme: "ee", band: 3 } }),
			item("ee.a.lo", "ee.a", "atom", { clauses: [["ee.a.hi"]], encompasses: [{ id: "ee.a.x", w: 0.5 }] }),
			item("ee.a.big", "ee.a", "atom", { hours: { lo: 0.75, hi: 0.95 } }),
			item("ee.b", "ee", "area", { status: "stub", hours: { lo: 5, hi: 9 } }),
		);
		const r = validateReport(s);
		assert.deepEqual(r.errors, []);
		const has = (code: string, id: string) => r.warnings.some((w) => w.code === code && w.witness?.[0] === id);
		assert.ok(has("fan-in", "ee.a.fan"));
		assert.ok(has("level-monotonicity", "ee.a.lo"));
		assert.ok(has("encompasses-non-ancestor", "ee.a.lo"));
		assert.ok(has("granularity", "ee.a.big"));
		assert.ok(has("granularity", "ee.b"));
		assert.equal(validateReport(s, { lint: false }).warnings.length, 0);
	});

	it("encompasses of a real (indirect) prerequisite is fine", () => {
		const s = withItems(item("ee.a.z", "ee.a", "atom", { clauses: [["ee.a.y"]], encompasses: [{ id: "ee.a.x", w: 0.4 }] }));
		assert.ok(!validateReport(s).warnings.some((w) => w.code === "encompasses-non-ancestor"));
	});

	it("caps repeated errors per code with a summary line", () => {
		const many = Array.from({ length: 60 }, (_, i) => item(`ee.a.d${i}`, "ee.a", "atom", { clauses: [[`ee.gone${i}`]] }));
		const errs = validate(withItems(...many)).filter((e) => e.code === "unknown-id");
		assert.equal(errs.length, 51);
		assert.match(errs[50]!.message, /mais 10 erros/);
	});
});
