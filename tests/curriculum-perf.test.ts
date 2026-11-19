/**
 * Performance budget of the curriculum core (docs/research/00-SINTESE.md
 * §2.13 "validação completa em milissegundos"; r10 §6.2, §11.6: Kahn em lote
 * 8,4 ms com n = 20 000, inserções PK 2–3 µs). Target of this module:
 * validate() of a 20 000-node synthetic domain under 200 ms (median of 5 warm
 * runs; the first, cold call is also recorded; the timings are printed as
 * test diagnostics). The schema stage runs the sound fast guards of
 * src/core/curriculum/schema.ts on every item (zod only explains rejects).
 */

import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { describe, it } from "node:test";
import {
	applyPatch,
	checkPrereqCandidate,
	checkSnapshotCertificate,
	computeTriggers,
	curriculumIndex,
	DynamicTopoOrder,
	goalPlan,
	outerFringe,
	validate,
	validateReport,
} from "../src/core/curriculum/index.ts";
import { envelope, syntheticSnapshot } from "./curriculum-fixtures.ts";

function median(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)]!;
}

function time(fn: () => unknown, runs = 5): { median: number; all: number[] } {
	fn(); // warm-up (JIT, zod schema compilation)
	const all: number[] = [];
	for (let i = 0; i < runs; i++) {
		const t0 = performance.now();
		fn();
		all.push(performance.now() - t0);
	}
	return { median: median(all), all };
}

const fmt = (ms: number) => `${ms.toFixed(1)} ms`;

describe("performance (20 000 nodes)", () => {
	const t0 = performance.now();
	const big = syntheticSnapshot(20_000);
	const buildMs = performance.now() - t0;

	it("validate() < 200 ms (schema guard on every item + every invariant)", (t) => {
		assert.equal(Object.keys(big.items).length, 20_000);
		const cold0 = performance.now();
		assert.deepEqual(validate(big), []);
		const coldMs = performance.now() - cold0;
		const full = time(() => validate(big));
		const noSchema = time(() => validate(big, { schema: "none" }));
		t.diagnostic(`fixture ${fmt(buildMs)}; validate a frio ${fmt(coldMs)}; validate completo: mediana ${fmt(full.median)} [${full.all.map(fmt).join(", ")}]`);
		t.diagnostic(`validate sem etapa de schema: mediana ${fmt(noSchema.median)}`);
		assert.ok(full.median < 200, `validate levou ${fmt(full.median)} (meta < 200 ms)`);
	});

	it("records the cost of lint, certificate check, a patch and learner queries", (t) => {
		const lint = time(() => validateReport(big), 3);
		const cert = time(() => checkSnapshotCertificate(big), 3);
		assert.deepEqual(checkSnapshotCertificate(big), { ok: true });
		const patch = time(() => {
			const res = applyPatch(big, envelope(big, [{ op: "addItem", id: "ee.a0.u0.t0.extra", parentId: "ee.a0.u0.t0", kind: "atom", title: { pt: "x", en: "x" }, hours: { lo: 0.25, hi: 0.5 }, clauses: "entry" }]));
			assert.ok(res.ok);
		}, 3);
		const idx = curriculumIndex(big);
		const leaves = idx.sys.ids.filter((_, x) => idx.sys.children[x]!.length === 0);
		const attained = leaves.slice(0, 5_000);
		const fringe = time(() => outerFringe(idx, attained), 3);
		const plan = time(() => goalPlan(idx, attained, ["ee.a15"]), 3);
		const triggers = time(() => computeTriggers(idx, { attained, goals: ["ee.a15"] }), 3);
		t.diagnostic(`validateReport+lint ${fmt(lint.median)} · checkSnapshotCertificate ${fmt(cert.median)} · applyPatch(addItem) ${fmt(patch.median)}`);
		t.diagnostic(`outerFringe ${fmt(fringe.median)} · goalPlan ${fmt(plan.median)} · computeTriggers ${fmt(triggers.median)}`);
		assert.ok(patch.median < 1_000, `applyPatch levou ${fmt(patch.median)}`);
		assert.ok(fringe.median < 200 && plan.median < 200, "consultas do aluno devem ser interativas");
	});

	it("Pearce–Kelly seeded by Kahn: bulk load + incremental checks", (t) => {
		const seedT0 = performance.now();
		const dag = DynamicTopoOrder.fromSnapshot(big);
		const seedMs = performance.now() - seedT0;
		const order = dag.order();
		let inserted = 0;
		let refused = 0;
		const insT0 = performance.now();
		for (let i = 0; i < 5_000; i++) {
			const a = order[(i * 7919) % order.length]!;
			const b = order[(i * 104729 + 13) % order.length]!;
			if (a === b) continue;
			const res = dag.addEdge(a, b);
			if (res.ok) inserted++;
			else refused++;
		}
		const insMs = performance.now() - insT0;
		const cand = time(() => checkPrereqCandidate(big, "ee.a15.u11.t9", "ee.a0.u0.t0"), 3);
		t.diagnostic(
			`PK fromSnapshot ${fmt(seedMs)} · 5 000 inserções ${fmt(insMs)} (${inserted} aceitas, ${refused} recusadas por ciclo) · checkPrereqCandidate ${fmt(cand.median)}`,
		);
		assert.ok(seedMs < 2_000);
		assert.ok(inserted + refused > 4_000);
	});
});
