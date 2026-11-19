/**
 * Learner model — KST structure (r10 §3.3–3.5 interior/fringes/implied
 * credit; SÍNTESE §2.6 unlocking set A) and the particle-filter diagnostic
 * (r2 §9.7 BLIM + SMC).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import { foldEvents } from "../src/core/learner/fold.ts";
import type { LearnerGraphView } from "../src/core/learner/graph-view.ts";
import {
	crispState,
	desiredRetentionFor,
	DiagnosticError,
	diagnosticEstimates,
	diagnosticEvent,
	type DiagnosticState,
	impliedClosure,
	innerFringe,
	interior,
	isFeasible,
	mandatoryMembers,
	masteredTop,
	nextDiagnosticQuestion,
	outerFringe,
	recordDiagnosticAnswer,
	retentionRole,
	startDiagnostic,
	structuralState,
	topLeaves,
} from "../src/core/learner/kst.ts";
import { DEFAULT_LEARNER_PARAMS, LEARNER_CONSTANTS } from "../src/core/learner/params.ts";
import type { LearnerSnapshot, NodeId, NodeState } from "../src/core/learner/types.ts";
import { allSubsets, chain, clauseSystemArb, day, DOMAIN, graph, must, node } from "./learner-fixtures.ts";

const P = DEFAULT_LEARNER_PARAMS;

const subset = (a: ReadonlySet<NodeId>, b: ReadonlySet<NodeId>) => [...a].every((x) => b.has(x));

/** View + a random subset X of its ids. */
const systemWithSubset = clauseSystemArb(2, 7).chain((view) =>
	fc.tuple(fc.constant(view), fc.subarray([...view.ids]).map((xs) => new Set<NodeId>(xs))),
);

function snapshotWith(states: Record<NodeId, Partial<NodeState>>): LearnerSnapshot {
	const nodes: Record<NodeId, NodeState> = {};
	for (const [id, patch] of Object.entries(states)) {
		nodes[id] = {
			nodeId: id,
			nodeVersion: 1,
			pL: 0.9,
			nEff: 3,
			verified: true,
			desiredRetention: 0.9,
			levelElo: [0, 0, 0, 0, 0],
			blame: 0,
			misconceptions: {},
			correctFamilies: [],
			delayedSuccesses: 0,
			...patch,
		};
	}
	return { schemaVersion: 1, domainId: DOMAIN, seq: 0, nodes, theta: 0, thetaN: 0, speed: 1, updatedAt: day(0) };
}

describe("learner KST interior and fringes (r10 §3.3)", () => {
	it("interior(X) is the largest feasible subset of X (brute force, property)", () => {
		fc.assert(
			fc.property(systemWithSubset, ([view, X]) => {
				const K = interior(view, X);
				assert.ok(subset(K, X));
				assert.ok(isFeasible(view, K), "interior is feasible");
				for (const S of allSubsets(view)) {
					if (subset(S, X) && isFeasible(view, S)) assert.ok(subset(S, K), `feasible ${[...S]} ⊄ interior ${[...K]}`);
				}
			}),
			{ numRuns: 150 },
		);
	});

	it("outer and inner fringes match their definitions (brute force, property)", () => {
		fc.assert(
			fc.property(clauseSystemArb(2, 6), (view) => {
				for (const K of allSubsets(view)) {
					if (!isFeasible(view, K)) continue;
					const outer = view.ids.filter((q) => !K.has(q) && isFeasible(view, new Set([...K, q])));
					assert.deepEqual(outerFringe(view, K), outer);
					const inner = view.ids.filter((k) => K.has(k) && isFeasible(view, new Set([...K].filter((x) => x !== k))));
					assert.deepEqual(innerFringe(view, K), inner);
				}
			}),
			{ numRuns: 60 },
		);
	});

	it("mandatory members are the intersection of the OR alternatives", () => {
		assert.deepEqual(mandatoryMembers([]), []);
		assert.deepEqual(mandatoryMembers([["a", "b"]]), ["a", "b"]);
		assert.deepEqual(mandatoryMembers([["a", "b"], ["a", "c"]]), ["a"]);
		assert.deepEqual(mandatoryMembers([["a"], ["b"]]), []);
	});

	it("implied closure follows mandatory members only (OR alternatives get no credit)", () => {
		const view = graph(
			node("a"),
			node("b"),
			node("c"),
			node("and", { clauses: [["a", "b"]] }),
			node("or", { clauses: [["a"], ["b"]] }),
			node("mix", { clauses: [["a", "b"], ["a", "c"]] }),
		);
		assert.deepEqual([...impliedClosure(view, new Set(["and"]))].sort(), ["a", "and", "b"]);
		assert.deepEqual([...impliedClosure(view, new Set(["or"]))], ["or"]);
		assert.deepEqual([...impliedClosure(view, new Set(["mix"]))].sort(), ["a", "mix"]);
	});
});

describe("learner structural state A (SÍNTESE §2.6)", () => {
	const view = graph(
		node("l1"),
		node("l2"),
		node("unit", { leaf: false, children: ["l1", "l2"], clauses: [["l1", "l2"]] }),
		node("next", { clauses: [["unit"]] }),
		node("deep", { clauses: [["next"]] }),
		node("alt", { clauses: [["l1"], ["deep"]] }),
	);

	it("containers become milestones; the frontier holds leaves only", () => {
		const s = structuralState(snapshotWith({ l1: { attainedAt: day(0) }, l2: { attainedAt: day(1) } }), view);
		assert.deepEqual([...s.known].sort(), ["l1", "l2", "unit"]);
		assert.deepEqual(s.frontier, ["next", "alt"]);
		assert.ok(s.implied.has("unit"));
	});

	it("attaining a deep node implies its mandatory chain; placements unlock too", () => {
		const s = structuralState(snapshotWith({ deep: { attainedAt: day(0) } }), view);
		for (const id of ["l1", "l2", "unit", "next", "deep"]) assert.ok(s.known.has(id), id);
		assert.deepEqual(s.frontier, ["alt"]);
		const placed = structuralState(snapshotWith({ l1: { placedAt: day(0), verified: false } }), view);
		assert.ok(placed.placed.has("l1") && placed.known.has("l1"));
	});

	it("K* is the interior of the mastered closure; 'domina (topo)' is its leaf inner fringe", () => {
		const snap = snapshotWith({
			l1: { attainedAt: day(0), masteredAt: day(0) },
			l2: { attainedAt: day(0), masteredAt: day(0) },
			next: { attainedAt: day(1) },
		});
		assert.deepEqual([...crispState(snap, view)].sort(), ["l1", "l2", "unit"]);
		assert.deepEqual(innerFringe(view, crispState(snap, view), { leavesOnly: true }), [], "plain fringe hides leaves under a unit");
		assert.deepEqual(masteredTop(snap, view), ["l1", "l2"]);
		const deeper = snapshotWith({
			l1: { masteredAt: day(0) },
			l2: { masteredAt: day(0) },
			next: { masteredAt: day(1) },
		});
		assert.deepEqual(masteredTop(deeper, view), ["next"], "a leaf another mastered leaf builds on is not the top");
	});

	it("top leaves: removing one keeps every other leaf of K feasible (brute force, property)", () => {
		const containerArb = clauseSystemArb(3, 7).map((view) => {
			// Turn the last node into a container over its first clause (if any).
			const entries = view.ids.map((id, i) => {
				const n = must(view.nodes.get(id));
				const container = i === view.ids.length - 1 && n.clauses.length > 0;
				return node(id, { clauses: n.clauses.map((c) => [...c]), leaf: !container, children: container ? [...(n.clauses[0] ?? [])] : [] });
			});
			return graph(...entries);
		});
		fc.assert(
			fc.property(containerArb, (view) => {
				const leaves = (S: ReadonlySet<NodeId>) => [...S].filter((id) => view.nodes.get(id)?.isLeaf);
				for (const K of allSubsets(view)) {
					if (!isFeasible(view, K)) continue;
					const expected = leaves(K).filter((k) => {
						const rest = interior(view, new Set([...K].filter((x) => x !== k)));
						return leaves(K).every((j) => j === k || rest.has(j));
					});
					assert.deepEqual(new Set(topLeaves(view, K)), new Set(expected));
				}
			}),
			{ numRuns: 60 },
		);
	});

	it("desired retention by role: 0.93 frontier prerequisite, 0.85 distant leaf, 0.90 otherwise", () => {
		const known = new Set(["l1", "l2", "unit"]);
		const isKnown = (id: NodeId) => known.has(id);
		assert.equal(retentionRole(view, "l1", isKnown), "frontierPrereq", "l1 → alt is on the frontier");
		assert.equal(retentionRole(view, "l2", isKnown), "frontierPrereq", "looks through the container to 'next'");
		assert.equal(desiredRetentionFor(view, "l2", isKnown, P), 0.93);
		assert.equal(retentionRole(view, "alt", isKnown), "distantLeaf");
		assert.equal(desiredRetentionFor(view, "alt", isKnown, P), 0.85);
		assert.equal(retentionRole(view, "next", isKnown), "default", "its dependent is still locked");
	});

	it("structural state ignores pL: a failure after attainment keeps the node in A", () => {
		const snap = foldEvents(
			snapshotWith({ l1: { attainedAt: day(0), pL: 0.95 }, l2: { attainedAt: day(0), pL: 0.95 } }),
			[
				{
					kind: "evidence",
					evidence: {
						id: "e1",
						seq: 1,
						at: day(2),
						domainId: DOMAIN,
						sessionId: "s1",
						itemId: "i1",
						itemFamily: "f1",
						nodes: [{ nodeId: "l1", q: 1, primary: true }],
						format: "short",
						level: 3,
						grade: 0,
						graderConfidence: 1,
						hints: 0,
						minutesSinceExposure: 3000,
					},
				},
			],
			view,
			P,
		);
		assert.ok(must(snap.nodes.l1).pL < 0.85);
		assert.ok(structuralState(snap, view).known.has("unit"));
	});
});

function particleSets(state: DiagnosticState): Set<NodeId>[] {
	const out: Set<NodeId>[] = [];
	for (let m = 0; m < state.count; m++) {
		const s = new Set<NodeId>();
		state.ids.forEach((id, i) => {
			if (((state.bits[m * state.words + (i >>> 5)] as number) & (1 << (i & 31))) !== 0) s.add(id);
		});
		out.push(s);
	}
	return out;
}

/** Run the adaptive loop for a simulated learner who knows exactly `truth`. */
function runDiagnostic(view: LearnerGraphView, truth: ReadonlySet<NodeId>, seed: string, particles = 500): DiagnosticState {
	let state = startDiagnostic(view, { seed, particles });
	for (let q = nextDiagnosticQuestion(state); q !== null; q = nextDiagnosticQuestion(state)) {
		state = recordDiagnosticAnswer(state, view, { nodeId: q, correct: truth.has(q) });
	}
	return state;
}

describe("learner particle-filter diagnostic (r2 §9.7)", () => {
	const view = chain(8);
	const truth = new Set(["n0", "n1", "n2", "n3"]);

	it("every particle is a feasible knowledge state, before and after resampling", () => {
		const start = startDiagnostic(view, { seed: "s", particles: 300 });
		for (const K of particleSets(start)) assert.ok(isFeasible(view, K));
		const end = runDiagnostic(view, truth, "s", 300);
		for (const K of particleSets(end)) assert.ok(isFeasible(view, K));
		for (const { p } of diagnosticEstimates(end)) assert.ok(p >= 0 && p <= 1);
	});

	it("is deterministic for a seed and never mutates the previous state", () => {
		const a = runDiagnostic(view, truth, "seed-1");
		const b = runDiagnostic(view, truth, "seed-1");
		assert.deepEqual(diagnosticEstimates(a), diagnosticEstimates(b));
		assert.deepEqual(a.answers, b.answers);
		const s0 = startDiagnostic(view, { seed: "x", particles: 200 });
		const weights = Float64Array.from(s0.weights);
		const q = must(nextDiagnosticQuestion(s0));
		recordDiagnosticAnswer(s0, view, { nodeId: q, correct: true });
		assert.deepEqual(s0.weights, weights);
		assert.equal(s0.answers.length, 0);
	});

	it("converges on the true state of a chain within the question budget", () => {
		const end = runDiagnostic(view, truth, "conv");
		const C = LEARNER_CONSTANTS.particles;
		assert.ok(end.answers.length >= Math.min(C.minQuestions, view.ids.length) && end.answers.length <= C.maxQuestions);
		const p = new Map(diagnosticEstimates(end).map((e) => [e.nodeId, e.p]));
		for (const id of ["n0", "n1", "n2", "n3"]) assert.ok((p.get(id) ?? 0) > 0.8, `${id} known: ${p.get(id)}`);
		for (const id of ["n4", "n5", "n6", "n7"]) assert.ok((p.get(id) ?? 1) < 0.2, `${id} unknown: ${p.get(id)}`);
		const ev = diagnosticEvent(end, { id: "diag1", seq: 1, at: day(0), domainId: DOMAIN });
		assert.equal(ev.kind, "diagnostic");
		const placed = foldEvents(null, [ev], view, P);
		assert.deepEqual(structuralState(placed, view).frontier, ["n4"]);
	});

	it("rejects invalid configurations and answers", () => {
		assert.throws(() => startDiagnostic(view, { seed: "s", particles: 0 }), DiagnosticError);
		assert.throws(() => startDiagnostic(view, { seed: "s", skeleton: ["ghost"] }), /vazio/);
		const s = startDiagnostic(view, { seed: "s", particles: 50 });
		assert.throws(() => recordDiagnosticAnswer(s, view, { nodeId: "ghost", correct: true }), DiagnosticError);
	});
});
