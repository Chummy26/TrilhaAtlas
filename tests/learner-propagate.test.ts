/**
 * Learner model — consistency projection, FIRe credit and upward penalties
 * (r2 §9.6 a/b/c; mathua §7.1 integer ledger; §9.13 (5)(6)).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import { foldEvents, ingestEvent, ingestEvents } from "../src/core/learner/fold.ts";
import type { LearnerGraphView } from "../src/core/learner/graph-view.ts";
import { DEFAULT_LEARNER_PARAMS, LEARNER_CONSTANTS } from "../src/core/learner/params.ts";
import {
	allocateCredit,
	applyCredit,
	encompassingWeights,
	encompassWeights,
	FireLedgerError,
	ledgerUnits,
	maxConsistencyViolation,
	projectConsistency,
	upwardPenalties,
	type ProjectionOptions,
	type ProjectionValue,
} from "../src/core/learner/propagate.ts";
import type { LearnerEvent, LearnerParams, LearnerSnapshot, NodeId } from "../src/core/learner/types.ts";
import { clauseSystemArb, day, DOMAIN, encompassingChain, evidence, graph, masterySteps, must, node, practice } from "./learner-fixtures.ts";

const P = DEFAULT_LEARNER_PARAMS;
const MICRO = LEARNER_CONSTANTS.fire.micro;
const close = (actual: number, expected: number, tol: number, msg?: string) =>
	assert.ok(Math.abs(actual - expected) <= tol, `${msg ?? ""} expected ${expected} ± ${tol}, got ${actual}`);

const GLOBAL: ProjectionOptions = { eps: 0.05, maxPasses: 500, tolerance: 1e-9, fallback: { p: 0.15, n: 1.5 } };

function values(entries: Record<NodeId, [number, number]>): Map<NodeId, ProjectionValue> {
	return new Map(Object.entries(entries).map(([id, [p, n]]) => [id, { p, n }]));
}

describe("learner consistency projection (r2 §9.6a)", () => {
	it("moves the prerequisite up and the dependent down, weighted by evidence", () => {
		const view = graph(node("a"), node("b", { clauses: [["a"]] }));
		const even = values({ a: [0.2, 1], b: [0.9, 1] });
		projectConsistency(even, view, GLOBAL);
		close(even.get("a")?.p ?? 0, 0.525, 1e-12);
		close(even.get("b")?.p ?? 0, 0.575, 1e-12);

		const strongA = values({ a: [0.2, 9], b: [0.9, 1] });
		projectConsistency(strongA, view, GLOBAL);
		close(strongA.get("a")?.p ?? 0, 0.265, 1e-12, "well-evidenced prerequisite barely moves");
		close(strongA.get("b")?.p ?? 0, 0.315, 1e-12);
		close(9 * (strongA.get("a")?.p ?? 0) + (strongA.get("b")?.p ?? 0), 9 * 0.2 + 0.9, 1e-12, "weighted mass preserved");
	});

	it("an OR node is constrained only through its best clause", () => {
		const view = graph(node("a"), node("b"), node("c", { clauses: [["a"], ["b"]] }));
		const v = values({ a: [0.1, 1], b: [0.8, 1], c: [0.9, 1] });
		projectConsistency(v, view, GLOBAL);
		assert.equal(v.get("a")?.p, 0.1, "the weak alternative is not dragged up");
		assert.ok((v.get("c")?.p ?? 0) <= (v.get("b")?.p ?? 0) + 0.05 + 1e-9);
	});

	it("a satisfied system is a fixed point", () => {
		const view = graph(node("a"), node("b", { clauses: [["a"]] }));
		const v = values({ a: [0.5, 1], b: [0.54, 1] });
		const r = projectConsistency(v, view, GLOBAL);
		assert.equal(r.changed.size, 0);
		assert.equal(r.passes, 1);
	});

	it("global projection converges, stays in [0,1] and is idempotent (property)", () => {
		fc.assert(
			fc.property(
				clauseSystemArb(2, 8).chain((view) =>
					fc.tuple(
						fc.constant(view),
						fc.array(fc.tuple(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 1, max: 20, noNaN: true })), {
							minLength: view.ids.length,
							maxLength: view.ids.length,
						}),
					),
				),
				([view, raw]) => {
					const v = new Map<NodeId, ProjectionValue>(view.ids.map((id, i) => [id, { p: raw[i]?.[0] ?? 0, n: raw[i]?.[1] ?? 1 }]));
					const r = projectConsistency(v, view, GLOBAL);
					assert.ok(r.maxViolation <= 1e-6, `violation ${r.maxViolation} after ${r.passes} passes`);
					assert.ok(maxConsistencyViolation(v, view, 0.05, GLOBAL.fallback) <= 1e-6);
					for (const x of v.values()) assert.ok(x.p >= 0 && x.p <= 1, `p = ${x.p}`);
					const snapshot = new Map([...v].map(([id, x]) => [id, { ...x }]));
					const again = projectConsistency(v, view, GLOBAL);
					assert.equal(again.changed.size, 0, "second projection must not move anything");
					assert.deepEqual(v, snapshot);
				},
			),
			{ numRuns: 200 },
		);
	});

	it("a scoped projection never touches nodes outside the scope", () => {
		const view = graph(node("a"), node("b", { clauses: [["a"]] }), node("c", { clauses: [["b"]] }));
		const v = values({ a: [0.1, 1], b: [0.5, 1], c: [0.9, 1] });
		projectConsistency(v, view, { ...GLOBAL, scope: new Set(["b", "c"]) });
		assert.equal(v.get("a")?.p, 0.1);
		assert.ok((v.get("c")?.p ?? 1) <= (v.get("b")?.p ?? 0) + 0.05 + 1e-9);
	});
});

describe("learner FIRe weights and allocation (r2 §9.6b)", () => {
	const view = graph(
		node("a"),
		node("b", { encompasses: [{ id: "a", w: 0.5 }] }),
		node("c", { encompasses: [{ id: "b", w: 0.8 }] }),
		node("d", { encompasses: [{ id: "c", w: 0.9 }, { id: "a", w: 0.2 }] }),
	);

	it("w* is the max-product path within the hop limit, above the minimum weight", () => {
		const w = encompassWeights(view, "d", 3, 0.1);
		close(w.get("c") ?? 0, 0.9, 1e-12);
		close(w.get("b") ?? 0, 0.72, 1e-12);
		close(w.get("a") ?? 0, 0.36, 1e-12, "max(0.9·0.8·0.5, 0.2)");
		close(encompassWeights(view, "d", 2, 0.1).get("a") ?? 0, 0.2, 1e-12, "3-hop path cut at h = 2");
		assert.equal(encompassWeights(view, "d", 3, 0.4).has("a"), false);
		const back = encompassingWeights(view, "a", 3, 0.1);
		close(back.get("b") ?? 0, 0.5, 1e-12);
		close(back.get("c") ?? 0, 0.4, 1e-12);
		close(back.get("d") ?? 0, 0.36, 1e-12);
	});

	it("largest-remainder allocation: pass-through under the cap, exact cap above it", () => {
		assert.deepEqual(
			allocateCredit(
				[
					{ nodeId: "b", rawUnits: 800_000 },
					{ nodeId: "a", rawUnits: 500_000 },
				],
				3 * MICRO,
			),
			[
				{ nodeId: "a", units: 500_000 },
				{ nodeId: "b", units: 800_000 },
			],
		);
		const seven = allocateCredit(
			Array.from({ length: 7 }, (_, i) => ({ nodeId: `n${i}`, rawUnits: MICRO })),
			3 * MICRO,
		);
		assert.equal(
			seven.reduce((s, x) => s + x.units, 0),
			3 * MICRO,
		);
		assert.deepEqual(
			seven.map((x) => x.units),
			[428_572, 428_572, 428_572, 428_571, 428_571, 428_571, 428_571],
		);
	});

	it("allocation invariants and order independence (property)", () => {
		fc.assert(
			fc.property(
				fc.uniqueArray(fc.record({ nodeId: fc.stringMatching(/^[a-z]{1,4}$/), rawUnits: fc.integer({ min: 0, max: MICRO }) }), {
					selector: (c) => c.nodeId,
					maxLength: 30,
				}),
				fc.integer({ min: 0, max: 5 * MICRO }),
				(cands, cap) => {
					const out = allocateCredit(cands, cap);
					const total = cands.reduce((s, c) => s + c.rawUnits, 0);
					const sum = out.reduce((s, x) => s + x.units, 0);
					assert.equal(sum, Math.min(total, cap));
					for (const x of out) {
						assert.ok(Number.isSafeInteger(x.units) && x.units > 0);
						assert.ok(x.units <= (cands.find((c) => c.nodeId === x.nodeId)?.rawUnits ?? -1));
					}
					assert.deepEqual(allocateCredit([...cands].reverse(), cap), out);
				},
			),
		);
	});

	it("rejects malformed candidates", () => {
		assert.throws(() => allocateCredit([{ nodeId: "a", rawUnits: -1 }], MICRO), FireLedgerError);
		assert.throws(() => allocateCredit([{ nodeId: "a", rawUnits: 0.5 }], MICRO), FireLedgerError);
		assert.throws(() => allocateCredit([{ nodeId: "a", rawUnits: MICRO + 1 }], MICRO), FireLedgerError);
		assert.throws(
			() =>
				allocateCredit(
					[
						{ nodeId: "a", rawUnits: 1 },
						{ nodeId: "a", rawUnits: 2 },
					],
					MICRO,
				),
			/duplicado/,
		);
		assert.throws(() => allocateCredit([], -1), FireLedgerError);
	});
});

/** a, b, c mastered by day 16 (3 spaced successes each). */
function masteredChain(params: LearnerParams = P): { view: LearnerGraphView; snapshot: LearnerSnapshot; log: LearnerEvent[] } {
	const view = encompassingChain();
	const { snapshot, log } = ingestEvents(null, practice(masterySteps(["a", "b", "c"])), view, params);
	return { view, snapshot, log };
}

function creditsIn(log: readonly LearnerEvent[]): Extract<LearnerEvent, { kind: "implicit-credit" }>[] {
	return log.filter((e): e is Extract<LearnerEvent, { kind: "implicit-credit" }> => e.kind === "implicit-credit");
}

describe("learner FIRe in the fold (r2 §9.6b)", () => {
	it("a successful practice of c credits its due, encompassed prerequisites by w*", () => {
		const { view, snapshot, log } = masteredChain();
		for (const id of ["a", "b", "c"]) assert.ok(snapshot.nodes[id]?.masteredAt, `${id} mastered`);
		assert.equal(creditsIn(log).length, 0, "nothing was due while mastering");
		const ev = evidence({ seq: snapshot.seq + 1, at: day(80), nodeId: "c", grade: 3 });
		const r = ingestEvent(snapshot, ev, view, P);
		assert.deepEqual(
			r.derived.map((e) => (e.kind === "implicit-credit" ? [e.toNodeId, e.w, e.seq] : null)),
			[
				["a", 0.5, snapshot.seq + 2],
				["b", 0.8, snapshot.seq + 3],
			],
		);
		for (const id of ["a", "b"]) {
			const before = snapshot.nodes[id]?.fsrs;
			const after = r.snapshot.nodes[id];
			assert.ok(before && after?.fsrs);
			assert.ok(after.fsrs.stability > before.stability, `${id} S grows`);
			assert.ok(Date.parse(after.fsrs.dueAt) > Date.parse(day(80)), `${id} is no longer due`);
			assert.equal(after.fsrs.difficulty, before.difficulty);
			assert.equal(after.fsrs.reps, before.reps, "implicit credit is not a real review");
			assert.deepEqual(after.fire, { epoch: before.reps, units: id === "a" ? 500_000 : 800_000 });
		}
		assert.deepEqual(foldEvents(null, [...log, ev, ...r.derived], view, P), r.snapshot, "replay of the persisted log is exact");
	});

	it("failures, not-yet-due targets and flashcards earn no credit", () => {
		const { view, snapshot } = masteredChain();
		const fail = ingestEvent(snapshot, evidence({ seq: snapshot.seq + 1, at: day(80), nodeId: "c", grade: 0 }), view, P);
		assert.equal(fail.derived.length, 0);
		const early = ingestEvent(snapshot, evidence({ seq: snapshot.seq + 1, at: day(17), nodeId: "c", grade: 3 }), view, P);
		assert.equal(early.derived.length, 0);
		const card = ingestEvent(snapshot, evidence({ seq: snapshot.seq + 1, at: day(80), nodeId: "c", grade: 3, format: "flashcard" }), view, P);
		assert.equal(card.derived.length, 0);
	});

	it("shadow mode computes but never applies; off mode does nothing", () => {
		const shadowParams: LearnerParams = { ...P, fireMode: "shadow" };
		const { view, snapshot } = masteredChain(shadowParams);
		const ev = evidence({ seq: snapshot.seq + 1, at: day(80), nodeId: "c", grade: 3 });
		const shadow = ingestEvent(snapshot, ev, view, shadowParams);
		assert.equal(shadow.derived.length, 0);
		assert.deepEqual(
			shadow.shadow.map((c) => [c.toNodeId, c.units]),
			[
				["a", 500_000],
				["b", 800_000],
			],
		);
		assert.deepEqual(shadow.snapshot.nodes.a, snapshot.nodes.a);
		const off = ingestEvent(snapshot, ev, view, { ...P, fireMode: "off" });
		assert.equal(off.derived.length + off.shadow.length, 0);
	});

	it("the ledger never exceeds MaxBank, even for a forged log; a real review opens a new epoch", () => {
		const { view, snapshot } = masteredChain();
		const forged: LearnerEvent[] = Array.from({ length: 5 }, (_, i) => ({
			kind: "implicit-credit",
			id: `forged${i}`,
			seq: snapshot.seq + 1 + i,
			at: day(80),
			domainId: DOMAIN,
			fromNodeId: "c",
			toNodeId: "a",
			w: 1,
		}));
		const three = foldEvents(snapshot, forged.slice(0, 3), view, P);
		const five = foldEvents(snapshot, forged, view, P);
		assert.equal(ledgerUnits(must(five.nodes.a)), 3 * MICRO);
		assert.deepEqual(five.nodes.a, three.nodes.a, "credits beyond MaxBank are ignored");
		const reviewed = foldEvents(five, [evidence({ seq: five.seq + 1, at: day(81), nodeId: "a", grade: 3 })], view, P);
		assert.equal(ledgerUnits(must(reviewed.nodes.a)), 0);
	});

	it("applyCredit is fail-closed without a Review card", () => {
		const { snapshot } = masteredChain();
		const a = snapshot.nodes.a;
		assert.ok(a?.fsrs);
		const noCard = { ...a };
		delete noCard.fsrs;
		assert.equal(applyCredit(noCard, 1, day(80), P), noCard);
		const learning = { ...a, fsrs: { ...a.fsrs, state: 1 as const } };
		assert.equal(applyCredit(learning, 1, day(80), P), learning);
		assert.equal(applyCredit(a, 0, day(80), P), a, "w* = 0 changes nothing");
	});
});

describe("learner upward penalties (r2 §9.6c)", () => {
	it("a blamed failure of k pulls the due date of every node that encompasses it", () => {
		const factors = upwardPenalties(encompassingChain(), "a", 0.6, P);
		assert.deepEqual(factors, [{ nodeId: "c", factor: 1 - 0.5 * 0.6 }]);
		assert.deepEqual(upwardPenalties(encompassingChain(), "a", 0, P), []);
	});

	it("in the fold, failing a shortens c's interval but keeps c's flags", () => {
		const { view, snapshot } = masteredChain();
		const at = day(18);
		const after = foldEvents(snapshot, [evidence({ seq: snapshot.seq + 1, at, nodeId: "a", grade: 0 })], view, P);
		const before = snapshot.nodes.c;
		const now = after.nodes.c;
		assert.ok(before?.fsrs && now?.fsrs);
		assert.ok(Date.parse(now.fsrs.dueAt) < Date.parse(before.fsrs.dueAt), "c due earlier");
		assert.ok(Date.parse(now.fsrs.dueAt) > Date.parse(at));
		assert.equal(now.masteredAt, before.masteredAt);
		assert.ok((after.nodes.a?.blame ?? 0) > 0);
	});
});
