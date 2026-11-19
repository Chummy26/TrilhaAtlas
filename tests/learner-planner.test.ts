/**
 * Learner model — daily planner (r2 §9.9; SÍNTESE §2.4(a) "o que estudar
 * agora"; r10 §3.6 goal plan): budget, frontier-only new nodes, vehicle
 * compression, load controller, warm-ups, pt-BR reasons.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import { foldEvents, ingestEvents } from "../src/core/learner/fold.ts";
import { structuralState } from "../src/core/learner/kst.ts";
import { DEFAULT_LEARNER_PARAMS } from "../src/core/learner/params.ts";
import { goalPlanOf, planDay, PlannerError, projectedDailyLoad } from "../src/core/learner/planner.ts";
import { computeSignals } from "../src/core/learner/signals.ts";
import type { Grade, LearnerEvent, LearnerParams, NodeId, StudyPlan } from "../src/core/learner/types.ts";
import { chain, clauseSystemArb, day, DOMAIN, evidence, graph, masterySteps, must, node, practice } from "./learner-fixtures.ts";

const P = DEFAULT_LEARNER_PARAMS;

function assertPlanInvariants(plan: StudyPlan, frontier: readonly NodeId[]): void {
	const used = plan.items.reduce((s, i) => s + i.estMinutes, 0);
	assert.ok(used <= plan.budgetMin + 1e-9, `plan uses ${used} of ${plan.budgetMin} min`);
	assert.ok(plan.reviewMinutes + plan.newMinutes <= used + 1e-9);
	const ids = plan.items.map((i) => i.nodeId);
	assert.equal(new Set(ids).size, ids.length, "each node at most once");
	for (const item of plan.items) {
		if (item.kind === "new") assert.ok(frontier.includes(item.nodeId), `new ${item.nodeId} outside the frontier ${frontier}`);
		assert.ok(item.reason.length > 0 && item.estMinutes > 0 && Number.isFinite(item.value));
	}
	if (plan.next) assert.ok(plan.items.includes(plan.next), "next is one of the items");
	else assert.equal(plan.items.length, 0);
}

describe("learner planner — invariants (r2 §9.9)", () => {
	it("never exceeds the budget and never proposes a new node outside the frontier (property)", () => {
		const scenario = clauseSystemArb(2, 8).chain((view) =>
			fc.tuple(
				fc.constant(view),
				fc.array(
					fc.record({
						node: fc.integer({ min: 0, max: view.ids.length - 1 }),
						grade: fc.constantFrom<Grade>(0, 1, 2, 3, 3, 3),
						gap: fc.double({ min: 0.01, max: 10, noNaN: true }),
					}),
					{ maxLength: 30 },
				),
				fc.integer({ min: 0, max: 240 }),
				fc.double({ min: 0, max: 60, noNaN: true }),
			),
		);
		fc.assert(
			fc.property(scenario, ([view, steps, budget, later]) => {
				let d = 0;
				const events: LearnerEvent[] = steps.map((s, i) => {
					d += s.gap;
					return evidence({ seq: i + 1, at: day(d), nodeId: view.ids[s.node] as NodeId, grade: s.grade, minutes: s.gap * 1440 });
				});
				const snapshot =
					events.length > 0
						? ingestEvents(null, events, view, P).snapshot
						: { schemaVersion: 1 as const, domainId: DOMAIN, seq: 0, nodes: {}, theta: 0, thetaN: 0, speed: 1, updatedAt: day(0) };
				const at = day(d + later);
				const plan = planDay(snapshot, view, P, { at, budgetMin: budget });
				assertPlanInvariants(plan, structuralState(snapshot, view).frontier);
				assert.deepEqual(planDay(snapshot, view, P, { at, budgetMin: budget }), plan, "deterministic");
			}),
			{ numRuns: 60 },
		);
	});

	it("a fresh learner gets the entry node, with a pt-BR reason", () => {
		const view = chain(5);
		const empty = { schemaVersion: 1 as const, domainId: DOMAIN, seq: 0, nodes: {}, theta: 0, thetaN: 0, speed: 1, updatedAt: day(0) };
		const plan = planDay(empty, view, P, { at: day(0), budgetMin: 60 });
		assert.deepEqual(
			plan.items.map((i) => [i.kind, i.nodeId]),
			[["new", "n0"]],
		);
		assert.equal(plan.next?.nodeId, "n0");
		assert.equal(plan.next?.reason, "Pronto para aprender — abre caminho para 4 tópicos");
		assert.equal(plan.date, "2026-01-01");
		assert.equal(planDay(empty, view, P, { at: day(0), budgetMin: 0 }).next, null);
		assert.throws(() => planDay(empty, view, P, { at: day(0), budgetMin: -5 }), PlannerError);
		assert.throws(() => planDay(empty, view, P, { at: day(0), budgetMin: Number.NaN }), /Orçamento/);
	});
});

describe("learner planner — reviews and compression", () => {
	const view = graph(
		node("x"),
		node("y"),
		node("z"),
		node("v", { clauses: [["x", "y", "z"]], encompasses: ["x", "y", "z"].map((id) => ({ id, w: 0.9 })) }),
	);
	const studied = ingestEvents(null, practice(masterySteps(["x", "y", "z", "v"])), view, P).snapshot;

	it("one practice of an encompassing node replaces three due reviews (vehicle)", () => {
		const at = day(46);
		const sig = computeSignals(studied, view, P, at);
		for (const id of ["x", "y", "z"]) assert.ok(must(sig.signals.get(id)).reviewDue, `${id} due`);
		const plan = planDay(studied, view, P, { at, budgetMin: 60, signals: sig });
		assert.deepEqual(
			plan.items.map((i) => [i.kind, i.nodeId, i.covers ?? []]),
			[["vehicle", "v", ["x", "y", "z"]]],
		);
		assert.equal(plan.next?.reason, "Revisa 3 tópicos de uma vez");
		assert.equal(plan.reviewMinutes, 6);
	});

	it("reviews far below their target retention are mandatory and come first", () => {
		const at = day(400);
		const plan = planDay(studied, view, P, { at, budgetMin: 60 });
		const first = must(plan.items[0]);
		assert.equal(first.kind, "review");
		assert.match(first.reason, /^Revisão urgente — retenção caiu para \d+%$/);
		assertPlanInvariants(plan, structuralState(studied, view).frontier);
	});

	it("review time respects the ρ_rev share of the budget", () => {
		const plan = planDay(studied, view, { ...P, planner: { ...P.planner, reviewShare: 0.05 } }, { at: day(46), budgetMin: 60 });
		assert.ok(plan.reviewMinutes <= 0.05 * 60 + 1e-9 || plan.items.every((i) => i.reason.startsWith("Revisão urgente")));
	});
});

describe("learner planner — new nodes", () => {
	const view = chain(3);
	const prefix = ingestEvents(null, practice(masterySteps(["n0", "n1"])), view, P).snapshot;

	it("brings at-risk prerequisites as warm-ups before the new node (never re-locks)", () => {
		let at = day(11);
		for (let d = 11; d < 60; d += 0.25) {
			const n1 = must(computeSignals(prefix, view, P, day(d)).signals.get("n1"));
			if (n1.R < n1.retention + 0.03 && !n1.reviewDue) {
				at = day(d);
				break;
			}
		}
		const plan = planDay(prefix, view, P, { at, budgetMin: 60 });
		assert.deepEqual(
			plan.items.map((i) => [i.kind, i.nodeId]),
			[
				["review", "n1"],
				["new", "n2"],
			],
		);
		assert.equal(must(plan.items[0]).reason, 'Aquecimento: pré-requisito de "Tópico n2"');
		assert.equal(plan.next?.nodeId, "n2", "the suggestion is still the new node");
	});

	it("the load controller suspends new material when projected reviews exceed ρ_rev·B", () => {
		const load = projectedDailyLoad(prefix, view, P, day(11));
		assert.ok(load > 0);
		assert.equal(projectedDailyLoad(prefix, view, P, day(11)), load, "seeded simulation");
		const tight: LearnerParams = { ...P, planner: { ...P.planner, reviewShare: load / 120 } };
		const suspended = planDay(prefix, view, tight, { at: day(11), budgetMin: 60 });
		assert.equal(suspended.items.filter((i) => i.kind === "new").length, 0);
		const open = planDay(prefix, view, P, { at: day(11), budgetMin: 60 });
		assert.deepEqual(
			open.items.filter((i) => i.kind === "new").map((i) => i.nodeId),
			["n2"],
		);
	});

	it("follows the goal plan: cheapest clause towards the goal, goal-first reasons", () => {
		const goalView = graph(
			node("base"),
			node("cheap", { clauses: [["base"]], hours: 1 }),
			node("pricey", { clauses: [["base"]], hours: 6 }),
			node("side", { clauses: [["base"]], hours: 0.5 }),
			node("goal", { clauses: [["cheap"], ["pricey"]], goal: 1 }),
		);
		assert.deepEqual([...goalPlanOf(goalView, new Set())].sort(), ["base", "cheap", "goal"]);
		assert.deepEqual([...goalPlanOf(goalView, new Set(["base"]))].sort(), ["cheap", "goal"]);
		assert.deepEqual(goalPlanOf(chain(2), new Set()), new Set(["n0", "n1"]), "no explicit goal → everything");

		const s = ingestEvents(null, practice(masterySteps(["base"])), goalView, P).snapshot;
		const plan = planDay(s, goalView, P, { at: day(5), budgetMin: 90 });
		const fresh = plan.items.filter((i) => i.kind === "new").map((i) => [i.nodeId, i.estMinutes]);
		assert.deepEqual(fresh, [["cheap", 60]], "side and pricey are frontier but off the goal plan");
		const short = planDay(s, goalView, P, { at: day(5), budgetMin: 45 });
		assert.deepEqual(
			short.items.map((i) => [i.kind, i.nodeId, i.estMinutes]),
			[["new", "cheap", 45]],
			"a 1 h node in a 45 min day becomes a partial session",
		);
		assert.equal(planDay(s, goalView, P, { at: day(5), budgetMin: 8 }).items.length, 0, "below 10 min no new session starts");
		const near = ingestEvents(s, practice(masterySteps(["cheap"], 6), s.seq + 1), goalView, P).snapshot;
		const last = planDay(near, goalView, P, { at: day(12), budgetMin: 60 });
		assert.equal(last.next?.nodeId, "goal");
		assert.equal(last.next?.reason, "Próximo passo rumo à sua meta");
	});
});

describe("learner planner — weak points and probes", () => {
	it("a weak prerequisite of today's new node is remediated first", () => {
		const view = chain(3);
		const base = ingestEvents(null, practice(masterySteps(["n0", "n1"])), view, P).snapshot;
		const at = day(11);
		const failed = foldEvents(
			base,
			[
				evidence({ seq: base.seq + 1, at, nodeId: "n1", grade: 0 }),
				evidence({ seq: base.seq + 2, at, nodeId: "n1", grade: 0 }),
			],
			view,
			P,
		);
		assert.ok(must(failed.nodes.n1).blame >= 0.3);
		const plan = planDay(failed, view, P, { at, budgetMin: 90 });
		assert.deepEqual(
			plan.items.map((i) => [i.kind, i.nodeId]),
			[
				["remediate", "n1"],
				["new", "n2"],
			],
			"n2 stays unlocked (no re-lock) but n1 is repaired first",
		);
		assert.equal(plan.next?.nodeId, "n1");
		assert.equal(plan.next?.reason, 'Ponto fraco: erros recentes neste tópico (pré-requisito de "Tópico n2")');
		const alone = planDay(failed, chain(2), P, { at, budgetMin: 90 });
		assert.deepEqual(
			alone.items.map((i) => [i.kind, i.nodeId, i.reason]),
			[["remediate", "n1", "Ponto fraco: erros recentes neste tópico"]],
		);
	});

	it("a node placed by the diagnostic without direct evidence is probed", () => {
		const view = chain(3);
		const placed = foldEvents(
			null,
			[{ kind: "diagnostic", id: "d1", seq: 1, at: day(0), domainId: DOMAIN, estimates: [{ nodeId: "n0", p: 0.9 }] }],
			view,
			P,
		);
		const plan = planDay(placed, view, P, { at: day(0), budgetMin: 60 });
		const probe = plan.items.find((i) => i.kind === "probe");
		assert.equal(probe?.nodeId, "n0");
		assert.equal(probe?.reason, "Sonda rápida: confirmar se você já domina");
		assert.equal(plan.items.find((i) => i.kind === "new")?.nodeId, "n1", "placement unlocks the next node");
	});
});
