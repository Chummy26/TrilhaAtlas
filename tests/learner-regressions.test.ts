/**
 * Learner model — regression tests from the adversarial review (docs/impl/
 * learner.md "Correções da revisão"; SÍNTESE §2.6; r2 §9.3–§9.9, §9.13).
 * Each `describe` pins one bug that the original suite let through:
 * containers acting as phantom nodes, fold/signals retention disagreement,
 * node-version resets lost on replay, co-node fallback for an unknown
 * primary, flashcards counted as full evidence, folded lessons ignored by the
 * delayed clock, OR-alternative warm-ups, early-stopping compression and a
 * permissive graph validator.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import {
	effectiveMinutesSinceExposure,
	evidenceWeight,
	foldEvents,
	ingestEvent,
	ingestEvents,
	LearnerFoldError,
	primaryIdOf,
} from "../src/core/learner/fold.ts";
import {
	assertGraphView,
	buildGraphView,
	expandedClauses,
	LearnerGraphError,
	MAX_EXPANDED_ALTERNATIVES,
	type LearnerGraphView,
} from "../src/core/learner/graph-view.ts";
import { DEFAULT_LEARNER_PARAMS, LEARNER_CONSTANTS } from "../src/core/learner/params.ts";
import { planDay, routeTo } from "../src/core/learner/planner.ts";
import { computeSignals } from "../src/core/learner/signals.ts";
import type { Evidence, Grade, LearnerEvent, LearnerSnapshot, NodeId } from "../src/core/learner/types.ts";
import { clauseSystemArb, day, DOMAIN, evidence, graph, masterySteps, must, node, practice } from "./learner-fixtures.ts";

const P = DEFAULT_LEARNER_PARAMS;

/** l1, l2 under the container `unit` (milestone [[l1, l2]]); `next` requires the unit. */
function containerGraph(): LearnerGraphView {
	return graph(
		node("l1"),
		node("l2"),
		node("unit", { leaf: false, children: ["l1", "l2"], clauses: [["l1", "l2"]] }),
		node("next", { clauses: [["unit"]], depth: 1 }),
	);
}

/** The same prerequisite structure without the container. */
function flatGraph(): LearnerGraphView {
	return graph(node("l1"), node("l2"), node("next", { clauses: [["l1", "l2"]], depth: 1 }));
}

function evidenceOf(event: LearnerEvent): Evidence {
	if (event.kind !== "evidence") throw new Error("not an evidence event");
	return event.evidence;
}

describe("regression — containers are looked through, never phantom nodes", () => {
	it("expandedClauses replaces containers (nested), dedupes members and drops empty containers", () => {
		const view = graph(
			node("a"),
			node("b"),
			node("c"),
			node("empty", { leaf: false }),
			node("inner", { leaf: false, children: ["a", "b"], clauses: [["a", "b"]] }),
			node("outer", { leaf: false, children: ["inner", "c"], clauses: [["inner", "c"], ["a"]] }),
			node("t", { clauses: [["outer", "a"], ["empty", "c"]] }),
		);
		assert.deepEqual(expandedClauses(view, "inner"), [["a", "b"]]);
		assert.deepEqual(expandedClauses(view, "outer"), [["a", "b", "c"], ["a"]]);
		assert.deepEqual(expandedClauses(view, "t"), [["a", "b", "c"], ["a"], ["c"]], "a deduplicated, empty container dropped");
		assert.equal(expandedClauses(view, "t"), expandedClauses(view, "t"), "memoized per view");
		assert.deepEqual(expandedClauses(view, "a"), []);
	});

	it("expandedClauses caps the alternatives of a cross product", () => {
		const leaves = Array.from({ length: 14 }, (_, i) => node(`p${i}`));
		const units = Array.from({ length: 7 }, (_, i) =>
			node(`u${i}`, { leaf: false, children: [`p${2 * i}`, `p${2 * i + 1}`], clauses: [[`p${2 * i}`], [`p${2 * i + 1}`]] }),
		);
		const view = graph(...leaves, ...units, node("goal", { clauses: [units.map((u) => u.id)] }));
		const alts = expandedClauses(view, "goal");
		assert.equal(alts.length, MAX_EXPANDED_ALTERNATIVES, "2^7 = 128 alternatives capped");
		for (const alt of alts) assert.equal(alt.length, 7);
	});

	it("without containers expandedClauses is the clause system itself (property)", () => {
		fc.assert(
			fc.property(clauseSystemArb(2, 8), (view) => {
				for (const id of view.ids) assert.deepEqual(expandedClauses(view, id), must(view.nodes.get(id)).clauses);
			}),
			{ numRuns: 60 },
		);
	});

	it("successes on a node behind a container match the flat graph and never create container state", () => {
		const extra: (s: LearnerSnapshot) => LearnerEvent[] = (s) =>
			practice(
				[
					{ d: 12, nodeId: "next", grade: 3 },
					{ d: 14, nodeId: "next", grade: 3 },
				],
				s.seq + 1,
			);
		const run = (view: LearnerGraphView) => {
			const base = ingestEvents(null, practice(masterySteps(["l1", "l2"])), view, P).snapshot;
			return ingestEvents(base, extra(base), view, P).snapshot;
		};
		const withUnit = run(containerGraph());
		const flat = run(flatGraph());
		assert.equal(withUnit.nodes.unit, undefined, "the container never carries learner state");
		const nextUnit = must(withUnit.nodes.next);
		const nextFlat = must(flat.nodes.next);
		assert.ok(Math.abs(nextUnit.pL - nextFlat.pL) <= 1e-12, `next: ${nextUnit.pL} vs flat ${nextFlat.pL}`);
		assert.ok(nextUnit.pL > 0.9, "two successes on next are not dragged down by a phantom prior");
		for (const id of ["l1", "l2"]) {
			assert.ok(Math.abs(must(withUnit.nodes[id]).pL - must(flat.nodes[id]).pL) <= 1e-12, `${id} pL`);
		}
	});

	it("readiness of a node behind a container equals the flat graph's", () => {
		const at = day(11);
		const readiness = (view: LearnerGraphView) => {
			const s = ingestEvents(null, practice(masterySteps(["l1", "l2"])), view, P).snapshot;
			return must(computeSignals(s, view, P, at).signals.get("next")).readiness;
		};
		const withUnit = readiness(containerGraph());
		const flat = readiness(flatGraph());
		assert.ok(Math.abs(withUnit - flat) <= 1e-12, `${withUnit} vs ${flat}`);
		assert.ok(withUnit > P.readinessThreshold, "mastered prerequisites make next ready (was the 0.15 prior)");
	});

	it("random practice around a container keeps it stateless and unplanned (property)", () => {
		const scenario = clauseSystemArb(2, 6).chain((base) =>
			fc.tuple(
				fc.constant(base),
				fc.uniqueArray(fc.integer({ min: 0, max: base.ids.length - 1 }), { minLength: 1, maxLength: 3 }),
				fc.array(
					fc.record({ node: fc.integer({ min: 0, max: base.ids.length }), grade: fc.constantFrom<Grade>(0, 1, 2, 3, 3), gap: fc.double({ min: 0.05, max: 5, noNaN: true }) }),
					{ minLength: 1, maxLength: 20 },
				),
			),
		);
		fc.assert(
			fc.property(scenario, ([base, members, steps]) => {
				const children = members.map((m) => `x${m}`);
				const entries = base.ids.map((id) => {
					const n = must(base.nodes.get(id));
					return node(id, { clauses: n.clauses.map((c) => [...c]) });
				});
				const view = graph(...entries, node("u", { leaf: false, children, clauses: [children] }), node("w", { clauses: [["u"]] }));
				const leaves = [...base.ids, "w"];
				let d = 0;
				const events = steps.map((s, i) => {
					d += s.gap;
					return evidence({ seq: i + 1, at: day(d), nodeId: leaves[s.node] as NodeId, grade: s.grade, minutes: s.gap * 1440 });
				});
				const snapshot = ingestEvents(null, events, view, P).snapshot;
				assert.equal(snapshot.nodes.u, undefined);
				for (const s of Object.values(snapshot.nodes)) assert.ok(s.pL >= 0 && s.pL <= 1 && Number.isFinite(s.pL));
				const plan = planDay(snapshot, view, P, { at: day(d + 1), budgetMin: 60 });
				assert.ok(plan.items.every((i) => i.nodeId !== "u"), "containers are never planned");
			}),
			{ numRuns: 40 },
		);
	});
});

describe("regression — fold and signals agree on the retention role", () => {
	it("the card's desired retention uses the structural set (milestones included)", () => {
		const view = containerGraph();
		const s = ingestEvents(null, practice(masterySteps(["l1", "l2"])), view, P).snapshot;
		const l2 = must(s.nodes.l2);
		const sig = must(computeSignals(s, view, P, day(10)).signals.get("l2"));
		assert.equal(l2.desiredRetention, sig.retention);
		assert.equal(l2.desiredRetention, P.desiredRetention.frontierPrereq, "next is on the frontier through the unit milestone");
	});
});

describe("regression — node-version resets survive a full replay", () => {
	it("incremental fold (v1 graph, then bump on v2) equals the replay of the whole log on v2", () => {
		const v1 = graph(node("a"));
		const v2 = graph(node("a", { version: 2 }));
		const evs = [evidence({ seq: 1, at: day(0), nodeId: "a", grade: 3 }), evidence({ seq: 2, at: day(2), nodeId: "a", grade: 3 })];
		const bump: LearnerEvent = { kind: "node-version", id: "v", seq: 3, at: day(3), domainId: DOMAIN, nodeId: "a", version: 2 };
		const incremental = foldEvents(foldEvents(null, evs, v1, P), [bump], v2, P);
		const replay = foldEvents(null, [...evs, bump], v2, P);
		assert.deepEqual(replay, incremental);
		assert.equal(must(replay.nodes.a).nodeVersion, 2);
		assert.equal(must(replay.nodes.a).pL, LEARNER_CONSTANTS.priorP, "the bump resets the evidence on replay too");
	});

	it("a state is born at version 1 even when the current graph is already at v3", () => {
		const v3 = graph(node("a", { version: 3 }));
		const s = foldEvents(null, [evidence({ seq: 1, at: day(0), nodeId: "a", grade: 3 })], v3, P);
		assert.equal(must(s.nodes.a).nodeVersion, LEARNER_CONSTANTS.initialNodeVersion);
	});
});

describe("regression — an unknown declared primary never falls back to a co-node", () => {
	const view = graph(node("b"), node("a", { clauses: [["b"]], encompasses: [{ id: "b", w: 0.9 }], depth: 1 }));
	const base = ingestEvents(null, practice(masterySteps(["b", "a"])), view, P).snapshot;

	it("no FSRS review, family or FIRe source for the co-node", () => {
		const ghost = evidence({ seq: base.seq + 1, at: day(40), nodeId: "ghost", grade: 3, family: "ghost#x", extraNodes: [{ nodeId: "a", q: 0.6 }] });
		assert.equal(primaryIdOf(evidenceOf(ghost), view), null);
		const result = ingestEvent(base, ghost, view, P);
		const before = must(base.nodes.a);
		const after = must(result.snapshot.nodes.a);
		assert.deepEqual(after.fsrs, before.fsrs, "the co-node's card is untouched");
		assert.deepEqual(after.correctFamilies, before.correctFamilies);
		assert.deepEqual(after.levelElo, before.levelElo);
		assert.equal(result.snapshot.theta, base.theta, "no Elo update without a known primary");
		assert.deepEqual(result.derived, [], "no implicit credit derived from a co-node");
	});

	it("a known primary still reviews and derives credit (control)", () => {
		const real = evidence({ seq: base.seq + 1, at: day(40), nodeId: "a", grade: 3 });
		assert.equal(primaryIdOf(evidenceOf(real), view), "a");
		const result = ingestEvent(base, real, view, P);
		assert.notDeepEqual(must(result.snapshot.nodes.a).fsrs, must(base.nodes.a).fsrs);
	});
});

describe("regression — flashcards default to the r2 §9.3 weight", () => {
	const view = graph(node("a"));
	it("a flashcard without weight equals one with weight 0.3", () => {
		const bare = foldEvents(null, [evidence({ seq: 1, at: day(0), nodeId: "a", grade: 3, format: "flashcard" })], view, P);
		const weighted = foldEvents(null, [evidence({ seq: 1, at: day(0), nodeId: "a", grade: 3, format: "flashcard", weight: 0.3 })], view, P);
		assert.deepEqual(bare.nodes, weighted.nodes);
		const full = foldEvents(null, [evidence({ seq: 1, at: day(0), nodeId: "a", grade: 3, format: "flashcard", weight: 1 })], view, P);
		assert.ok(must(full.nodes.a).pL > must(bare.nodes.a).pL, "an explicit weight still wins");
		assert.equal(evidenceWeight(evidenceOf(evidence({ seq: 1, at: day(0), nodeId: "a", grade: 3, format: "flashcard" }))), LEARNER_CONSTANTS.flashcardWeight);
		assert.equal(evidenceWeight(evidenceOf(evidence({ seq: 1, at: day(0), nodeId: "a", grade: 3 }))), 1);
		assert.equal(evidenceWeight(evidenceOf(evidence({ seq: 1, at: day(0), nodeId: "a", grade: 3, weight: 4 }))), 1, "clamped to 1");
	});

	it("weight 0, negative or non-finite is rejected", () => {
		for (const weight of [0, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			assert.throws(() => foldEvents(null, [evidence({ seq: 1, at: day(0), nodeId: "a", grade: 3, weight })], view, P), LearnerFoldError, `weight ${weight}`);
		}
	});
});

describe("regression — a folded lesson restarts the delayed-retrieval clock", () => {
	const view = graph(node("a"));
	const lesson: LearnerEvent = { kind: "exposure", id: "x", seq: 1, at: day(0), domainId: DOMAIN, sessionId: "s", nodeId: "a", source: "ai_lesson", minutes: 20 };

	it("a success 15 min after a folded lesson is immediate, whatever the stale minutesSinceExposure says", () => {
		const stale = foldEvents(null, [lesson, evidence({ seq: 2, at: day(0.01), nodeId: "a", grade: 3, minutes: 3000 })], view, P);
		const honest = foldEvents(null, [lesson, evidence({ seq: 2, at: day(0.01), nodeId: "a", grade: 3, minutes: 14.4 })], view, P);
		assert.equal(must(stale.nodes.a).delayedSuccesses, 0);
		assert.deepEqual(stale.nodes, honest.nodes);
		assert.equal(must(stale.nodes.a).lastExposureAt, day(0));
	});

	it("effectiveMinutesSinceExposure: min of both clocks; later-dated exposures (skew) are ignored", () => {
		const ev = evidenceOf(evidence({ seq: 2, at: day(1), nodeId: "a", grade: 3, minutes: 3000 }));
		const state = must(foldEvents(null, [lesson], view, P).nodes.a);
		assert.equal(effectiveMinutesSinceExposure(ev, undefined), 3000);
		assert.ok(Math.abs(effectiveMinutesSinceExposure(ev, state) - 1440) < 1e-6);
		assert.equal(effectiveMinutesSinceExposure({ ...ev, minutesSinceExposure: 30 }, state), 30);
		assert.equal(effectiveMinutesSinceExposure(ev, { ...state, lastExposureAt: day(2) }), 3000);
	});

	it("a success a day after the lesson still counts as delayed", () => {
		const s = foldEvents(null, [lesson, evidence({ seq: 2, at: day(1.5), nodeId: "a", grade: 3, minutes: 3000 })], view, P);
		assert.equal(must(s.nodes.a).delayedSuccesses, 1);
	});
});

describe("regression — warm-ups follow the route actually taken", () => {
	it("a weak member of an OR alternative not taken is not a warm-up of the new node", () => {
		const view = graph(node("a"), node("b"), node("g", { clauses: [["a"], ["b"]], depth: 1 }));
		const base = ingestEvents(null, practice(masterySteps(["a", "b"])), view, P).snapshot;
		const at = day(11);
		const failed = foldEvents(
			base,
			[evidence({ seq: base.seq + 1, at, nodeId: "b", grade: 0 }), evidence({ seq: base.seq + 2, at, nodeId: "b", grade: 0 })],
			view,
			P,
		);
		assert.ok(must(failed.nodes.b).blame >= LEARNER_CONSTANTS.probeBlame, "b is weak");
		assert.deepEqual(routeTo("g", view, computeSignals(failed, view, P, at)), ["a"]);
		const plan = planDay(failed, view, P, { at, budgetMin: 90 });
		assert.equal(plan.next?.nodeId, "g", "the lesson comes first: g is reached through a");
		const b = plan.items.find((i) => i.nodeId === "b");
		if (b) assert.equal(b.reason, "Ponto fraco: erros recentes neste tópico", "b is remediated on its own, not as a prerequisite of g");
	});

	it("a weak leaf reached through a container IS remediated before the new node", () => {
		const view = containerGraph();
		const base = ingestEvents(null, practice(masterySteps(["l1", "l2"])), view, P).snapshot;
		const at = day(11);
		const failed = foldEvents(
			base,
			[evidence({ seq: base.seq + 1, at, nodeId: "l2", grade: 0 }), evidence({ seq: base.seq + 2, at, nodeId: "l2", grade: 0 })],
			view,
			P,
		);
		assert.deepEqual(routeTo("next", view, computeSignals(failed, view, P, at)), ["l1", "l2"]);
		const plan = planDay(failed, view, P, { at, budgetMin: 90 });
		assert.deepEqual(
			plan.items.map((i) => [i.kind, i.nodeId, i.reason]),
			[
				["review", "l1", 'Aquecimento: pré-requisito de "Tópico next"'],
				["remediate", "l2", 'Ponto fraco: erros recentes neste tópico (pré-requisito de "Tópico next")'],
				["new", "next", "Pronto para aprender"],
			],
			"the unit's members are warm-ups of next (the container itself has no card)",
		);
		assert.equal(plan.next?.nodeId, "l2", "the weak prerequisite is repaired first");
	});
});

describe("regression — compression keeps going when the best candidate does not fit", () => {
	it("a 5-min review share still gets one review when the 6-min vehicle does not fit", () => {
		const view = graph(
			node("x"),
			node("y"),
			node("z"),
			node("v", { clauses: [["x", "y", "z"]], encompasses: ["x", "y", "z"].map((id) => ({ id, w: 0.9 })) }),
		);
		const studied = ingestEvents(null, practice(masterySteps(["x", "y", "z", "v"])), view, P).snapshot;
		const at = day(46);
		const roomy = planDay(studied, view, P, { at, budgetMin: 60 });
		assert.deepEqual(
			roomy.items.map((i) => i.kind),
			["vehicle"],
			"control: with room the vehicle is the best candidate",
		);
		const tight = planDay(studied, view, { ...P, planner: { ...P.planner, reviewShare: 0.1 } }, { at, budgetMin: 50 });
		const reviews = tight.items.filter((i) => i.kind === "review" || i.kind === "vehicle");
		assert.deepEqual(
			reviews.map((i) => [i.kind, i.estMinutes]),
			[["review", 5]],
		);
		assert.equal(tight.reviewMinutes, 5);
	});
});

describe("regression — the graph contract rejects what would poison the model", () => {
	const ok = () => graph(node("a"), node("b", { clauses: [["a"]] }));

	it("buildGraphView and assertGraphView reject bad encompasses and non-finite fields", () => {
		assert.throws(() => graph(node("a"), node("b", { encompasses: [{ id: "a", w: 0 }] })), LearnerGraphError);
		assert.throws(() => graph(node("a"), node("b", { encompasses: [{ id: "a", w: 1.5 }] })), LearnerGraphError);
		assert.throws(() => graph(node("a"), node("b", { encompasses: [{ id: "zz", w: 0.5 }] })), LearnerGraphError);
		assert.throws(() => graph(node("a", { hours: Number.NaN })), /hoursMid/);
		assert.throws(() => graph(node("a", { hours: -1 })), /hoursMid/);
		assert.throws(() => graph(node("a", { depth: Number.POSITIVE_INFINITY })), /depth/);
		assert.throws(() => graph(node("a", { goal: 2 })), /goalWeight/);
		assert.throws(() => graph(node("a", { goal: Number.NaN })), /goalWeight/);
		assert.throws(() => buildGraphView([node("a"), node("a")]), /duplicado/);
		assertGraphView(ok());
	});

	it("assertGraphView rejects hand-built views: duplicate ids, missing nodes, broken order", () => {
		const view = ok();
		assert.throws(() => assertGraphView({ ids: ["a", "a", "b"], nodes: view.nodes }), /repetido/);
		assert.throws(() => assertGraphView({ ids: ["b", "a"], nodes: view.nodes }), /Ordem topológica/);
		assert.throws(() => assertGraphView({ ids: ["a"], nodes: view.nodes }), /ausentes/);
		const bad = new Map(view.nodes);
		bad.set("b", { ...must(view.nodes.get("b")), encompasses: [{ id: "a", w: Number.NaN }] });
		assert.throws(() => assertGraphView({ ids: view.ids, nodes: bad }), /Peso de encompasses/);
	});
});
