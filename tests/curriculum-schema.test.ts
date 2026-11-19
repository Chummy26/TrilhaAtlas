/**
 * Zod schemas and the fast shape guards of src/core/curriculum/schema.ts
 * (docs/research/00-SINTESE.md §2.13 "zod → clone → invariantes"; the guards
 * keep validate() of a 20 000-node domain in milliseconds).
 *
 * The guards must be SOUND w.r.t. zod (guard true ⇒ zod accepts); in practice
 * they are equivalent, which fast-check checks on random mutations of a fully
 * populated item, edge and snapshot. The key list is pinned to the schema
 * shape so a new schema field cannot slip past the guard unnoticed.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { performance } from "node:perf_hooks";
import fc from "fast-check";
import {
	CurriculumEdgeSchema,
	CurriculumItemSchema,
	CurriculumSnapshotSchema,
	isCurriculumEdgeShape,
	isCurriculumItemShape,
	isCurriculumSnapshotShape,
	ITEM_SHAPE_KEYS,
	validate,
	type CurriculumItem,
	type CurriculumSnapshot,
} from "../src/core/curriculum/index.ts";
import { item, sampleSnapshot, syntheticSnapshot } from "./curriculum-fixtures.ts";

/** An item with every optional field present. */
function fullItem(): CurriculumItem {
	return item("ee.a.x", "ee.a", "atom", {
		atomType: "concept",
		bloom: "apply",
		aliases: ["xis"],
		objectives: ["calcular"],
		assess: ["numeric"],
		misconceptions: ["sinal trocado"],
		level: { scheme: "cefr", cefr: "B1", gse: 51 },
		clauses: [["ee.a.w", "ee.b"], ["ee.c"]],
		softPrereqs: ["ee.d"],
		encompasses: [{ id: "ee.a.w", w: 0.5 }],
		anchors: [{ source: "ngsl", ref: "12", span: "1-3", embeddable: true, evidence: "lista" }],
		estMinutesObserved: { mean: 20, n: 3 },
		lexicalItems: [{ lemma: "run", pos: "v", cefr: "A1", ngslRank: 120 }],
		practice: { targetHours: 10, exitCriterion: "falar 2 min" },
		provenance: {
			createdBy: "expansion",
			trigger: "frontier:p1",
			model: "m",
			promptVersion: "v1",
			createdAt: "2026-11-18T00:00:00.000Z",
			validation: { dedupMaxSim: 0.4, consensus: 0.8, critic: "ok", anchorCoverage: 1 },
		},
		aliasOf: "ee.a.v",
		supersededBy: ["ee.a.u"],
		tags: ["core"],
	});
}

type Path = readonly (string | number)[];

const ITEM_PATHS: readonly Path[] = [
	...ITEM_SHAPE_KEYS.map((k) => [k]),
	["title", "pt"],
	["title", "en"],
	["aliases", 0],
	["objectives", 0],
	["assess", 0],
	["misconceptions", 0],
	["level", "scheme"],
	["level", "cefr"],
	["level", "gse"],
	["level", "band"],
	["clauses", 0],
	["clauses", 0, 1],
	["softPrereqs", 0],
	["encompasses", 0],
	["encompasses", 0, "id"],
	["encompasses", 0, "w"],
	["hours", "lo"],
	["hours", "hi"],
	["anchors", 0, "source"],
	["anchors", 0, "ref"],
	["anchors", 0, "span"],
	["anchors", 0, "embeddable"],
	["anchors", 0, "evidence"],
	["estMinutesObserved", "mean"],
	["estMinutesObserved", "n"],
	["lexicalItems", 0, "lemma"],
	["lexicalItems", 0, "ngslRank"],
	["practice", "targetHours"],
	["practice", "exitCriterion"],
	["provenance", "createdBy"],
	["provenance", "createdAt"],
	["provenance", "trigger"],
	["provenance", "validation"],
	["provenance", "validation", "consensus"],
	["provenance", "validation", "critic"],
	["supersededBy", 0],
	["tags", 0],
];

/** Values that hit every branch of the guards (valid ones included). */
const arbValue: fc.Arbitrary<unknown> = fc.oneof(
	fc.constantFrom<unknown>(
		undefined,
		null,
		"",
		"ee",
		"ee.a.x",
		"EE.X",
		"ee..x",
		"stub",
		"atom",
		"concept",
		"cefr",
		"ee",
		"generic",
		"B1",
		"seed",
		0,
		-0,
		1,
		4,
		5,
		-1,
		0.5,
		1.5,
		2 ** 53,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		true,
		false,
		[],
		{},
		[[]],
		[["ee.b"]],
		{ pt: "a", en: "b" },
		{ lo: 1, hi: 0 },
		{ lo: 0, hi: 1 },
		{ scheme: "ee", band: 2 },
		{ scheme: "ee", band: 7 },
	),
	fc.integer({ min: -3, max: 6 }),
	fc.double(),
	fc.string({ maxLength: 4 }),
	fc.array(fc.oneof(fc.string({ maxLength: 3 }), fc.integer()), { maxLength: 2 }),
);

function setPath(root: unknown, path: Path, value: unknown, remove: boolean): void {
	if (typeof root !== "object" || root === null) return;
	let cur = root as Record<string | number, unknown>;
	for (let i = 0; i < path.length - 1; i++) {
		const next = cur[path[i]!];
		if (typeof next !== "object" || next === null) return;
		cur = next as Record<string | number, unknown>;
	}
	const last = path[path.length - 1]!;
	if (remove) delete cur[last];
	else cur[last] = value;
}

const arbMutation = fc.record({ path: fc.constantFrom(...ITEM_PATHS), value: arbValue, remove: fc.boolean() });

describe("fast shape guards", () => {
	it("the guard knows exactly the schema's item keys", () => {
		assert.deepEqual([...ITEM_SHAPE_KEYS].sort(), Object.keys(CurriculumItemSchema.shape).sort());
	});

	it("accepts fully populated valid data", () => {
		const it0 = fullItem();
		assert.equal(CurriculumItemSchema.safeParse(it0).success, true);
		assert.equal(isCurriculumItemShape(it0), true);
		const s = sampleSnapshot();
		assert.equal(isCurriculumSnapshotShape(s), true);
		assert.equal(isCurriculumEdgeShape({ from: "ee.a", to: "youtube:abc", kind: "covered_by", w: 1 }), true);
	});

	it("items: guard ⇔ zod on random mutations (soundness: guard ⇒ zod)", () => {
		fc.assert(
			fc.property(fc.array(arbMutation, { minLength: 1, maxLength: 3 }), (muts) => {
				const x = structuredClone(fullItem()) as unknown;
				for (const m of muts) setPath(x, m.path, m.value, m.remove);
				const guard = isCurriculumItemShape(x);
				const zod = CurriculumItemSchema.safeParse(x).success;
				if (guard && !zod) return false;
				return guard === zod;
			}),
			{ numRuns: 3000 },
		);
	});

	it("edges: guard ⇔ zod on random edges", () => {
		const arbEdge = fc.record(
			{
				from: fc.oneof(fc.constantFrom("ee.a", "EE", ""), arbValue),
				to: fc.oneof(fc.constantFrom("ee.b", "url:x", ""), arbValue),
				kind: fc.oneof(fc.constantFrom("also_in", "related", "confusable_with", "anchored_to", "covered_by", "requires"), arbValue),
				w: arbValue,
			},
			{ requiredKeys: [] },
		);
		fc.assert(
			fc.property(arbEdge, (e) => {
				const guard = isCurriculumEdgeShape(e);
				return guard === CurriculumEdgeSchema.safeParse(e).success;
			}),
			{ numRuns: 2000 },
		);
	});

	it("snapshots: guard ⇔ zod on random top-level and item mutations", () => {
		const keys = ["schemaVersion", "domainId", "version", "items", "edges", "certificate", "updatedAt"] as const;
		const arbSnapMutation = fc.oneof(
			fc.record({ kind: fc.constant("top" as const), key: fc.constantFrom(...keys), value: arbValue }),
			fc.record({ kind: fc.constant("item" as const), m: arbMutation }),
			fc.record({ kind: fc.constant("cert" as const), value: arbValue }),
		);
		fc.assert(
			fc.property(fc.array(arbSnapMutation, { minLength: 1, maxLength: 2 }), (muts) => {
				const s = structuredClone(sampleSnapshot()) as unknown as Record<string, unknown>;
				for (const m of muts) {
					if (m.kind === "top") s[m.key] = m.value;
					else if (m.kind === "cert") setPath(s, ["certificate", "order", 0], m.value, false);
					else if (typeof s.items === "object" && s.items !== null) setPath((s.items as Record<string, unknown>)["ee.dc.ohm"], m.m.path, m.m.value, m.m.remove);
				}
				const guard = isCurriculumSnapshotShape(s);
				return guard === CurriculumSnapshotSchema.safeParse(s).success;
			}),
			{ numRuns: 1500 },
		);
	});

	it("item maps with a custom prototype or symbol keys get the same verdict as zod", () => {
		const s = sampleSnapshot();
		const proto = { ...s, items: Object.assign(Object.create({ inherited: 1 }) as object, s.items) } as unknown as CurriculumSnapshot;
		assert.equal(isCurriculumSnapshotShape(proto), CurriculumSnapshotSchema.safeParse(proto).success);
		const sym = { ...s, items: { ...s.items, [Symbol("x")]: 1 } } as unknown as CurriculumSnapshot;
		assert.equal(isCurriculumSnapshotShape(sym), false);
		assert.equal(CurriculumSnapshotSchema.safeParse(sym).success, false);
	});

	it("validate() still reports zod's messages for rejected items", () => {
		const s = sampleSnapshot();
		const bad = { ...s, items: { ...s.items, "ee.dc.ohm": { ...s.items["ee.dc.ohm"]!, hours: { lo: 2, hi: 1 } } } };
		const errors = validate(bad);
		assert.ok(errors.some((e) => e.code === "schema" && /items\.ee\.dc\.ohm\.hours.*lo/.test(e.message)), JSON.stringify(errors));
		const touched = validate(bad, { schema: new Set(["ee.dc.ohm"]) });
		assert.ok(touched.some((e) => e.code === "schema" && /items\["ee\.dc\.ohm"\]\.hours/.test(e.message)), JSON.stringify(touched));
	});

	it("checks a 20 000-item snapshot in a few milliseconds (zod is the fallback)", (t) => {
		const big = syntheticSnapshot(20_000);
		isCurriculumSnapshotShape(big);
		const t0 = performance.now();
		assert.equal(isCurriculumSnapshotShape(big), true);
		const guardMs = performance.now() - t0;
		const t1 = performance.now();
		assert.equal(CurriculumSnapshotSchema.safeParse(big).success, true);
		const zodMs = performance.now() - t1;
		t.diagnostic(`guarda rápida ${guardMs.toFixed(1)} ms · zod ${zodMs.toFixed(1)} ms (20 000 itens)`);
		assert.ok(guardMs < zodMs);
	});
});
