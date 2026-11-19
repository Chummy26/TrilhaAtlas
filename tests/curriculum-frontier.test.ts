/**
 * Learner-state geometry, expansion triggers/budget, read-side queries and
 * the incremental (Pearce–Kelly) order (docs/research/00-SINTESE.md §2.4(e),
 * §2.6, §2.13, §2.14; r10 §2.2, §3.3, §3.6–3.7, §4.2, §6.2, §11.6).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import {
	applyPatch,
	attainedClosure,
	budgetForDay,
	chargeExpansion,
	checkCycleWitness,
	checkPrereqCandidate,
	checkTopoCertificate,
	closureIds,
	compareCandidates,
	computeTriggers,
	CurriculumError,
	curriculumIndex,
	dependencyPath,
	DynamicTopoOrder,
	goalFrontier,
	goalPlan,
	innerFringe,
	isFeasibleState,
	itemContext,
	mandatory,
	measureDecreases,
	neighborhood,
	normalizeForSearch,
	outerFringe,
	regionSubgraph,
	searchItems,
	selectExpansions,
	studyPath,
	terminationMeasure,
	unlockedBy,
	type ExpansionCandidate,
	type TriggerKind,
} from "../src/core/curriculum/index.ts";
import { envelope, item, sampleSnapshot, snapshot } from "./curriculum-fixtures.ts";

const s = sampleSnapshot();

describe("frontier: closure and fringes", () => {
	it("lifts container ids to their leaves and rolls milestones up; ignores unknown ids", () => {
		assert.deepEqual(closureIds(s, ["ee.math"]), ["ee.math.algebra", "ee.math.calculus", "ee.math"]);
		assert.deepEqual(closureIds(s, ["ee.math.algebra", "ee.math.calculus", "ee.nada"]), ["ee.math.algebra", "ee.math.calculus", "ee.math"]);
		assert.deepEqual(closureIds(s, ["ee.math.algebra"]), ["ee.math.algebra"]);
		const known = attainedClosure(s, ["ee"]);
		assert.ok(known.every((k) => k === 1), "the root lifts to everything");
	});

	it("outer fringe = leaves ready now; inner fringe = attained leaves removable alone", () => {
		assert.deepEqual(outerFringe(s, []), ["ee.math.algebra"]);
		assert.deepEqual(outerFringe(s, ["ee.math.algebra"]), ["ee.math.calculus"]);
		assert.deepEqual(outerFringe(s, ["ee.math"]), ["ee.dc.ohm", "ee.dc.nodal"]);
		assert.deepEqual(innerFringe(s, ["ee.math", "ee.dc.ohm"]), ["ee.dc.ohm"]);
		assert.deepEqual(innerFringe(s, ["ee.math"]), ["ee.math.calculus"]);
		assert.deepEqual(unlockedBy(s, ["ee.math.algebra"], "ee.math.calculus"), ["ee.dc.ohm", "ee.dc.nodal"]);
	});

	it("feasibility of a state", () => {
		assert.equal(isFeasibleState(s, []), true);
		assert.equal(isFeasibleState(s, ["ee.math", "ee.dc.ohm"]), true);
		assert.equal(isFeasibleState(s, ["ee.dc.ohm"]), false);
	});

	it("the outer fringe never empties before everything is attained (greedy walk)", () => {
		const attained: string[] = [];
		const total = curriculumIndex(s).sys.ids.length;
		for (let step = 0; step < 20; step++) {
			const known = attainedClosure(s, attained);
			if (known.every((k) => k === 1)) break;
			const f = outerFringe(s, attained);
			assert.ok(f.length > 0, `fronteira vazia com ${attained.length} itens`);
			attained.push(f[0]!);
		}
		assert.equal(closureIds(s, attained).length, total);
	});
});

describe("frontier: mand(t), bounds and the goal plan", () => {
	it("mandatory items of a target (intersection over its alternatives)", () => {
		assert.deepEqual(mandatory(s, "ee.dc.nodal"), ["ee.math.algebra", "ee.math.calculus", "ee.math", "ee.dc.nodal"]);
		assert.equal(mandatory(s, "ee.ac").length, 8);
		assert.throws(() => mandatory(s, "ee.nada"), CurriculumError);
	});

	it("goal plan: topological study word, LB ≤ UB, attained items excluded", () => {
		const p = goalPlan(s, [], ["ee.ac"]);
		assert.deepEqual(p.study, ["ee.math.algebra", "ee.math.calculus", "ee.dc.ohm", "ee.dc.kvl", "ee.dc.nodal", "ee.ac"]);
		assert.deepEqual(p.hours, { lo: 23, hi: 35 });
		assert.equal(p.lowerBound, 23);
		assert.equal(p.upperBound, 35);
		const q = goalPlan(s, ["ee.math"], ["ee.dc.nodal"]);
		assert.deepEqual(q.study, ["ee.dc.nodal"]);
		assert.deepEqual(q.mandatory, ["ee.dc.nodal"]);
		assert.ok(q.lowerBound <= q.upperBound);
		const done = goalPlan(s, ["ee"], ["ee.ac"]);
		assert.deepEqual([done.items, done.study, done.lowerBound, done.upperBound], [[], [], 0, 0]);
		assert.deepEqual(studyPath(s, [], ["ee.ac"]), p);
	});

	it("goal frontier = ready leaves that advance the goals", () => {
		assert.deepEqual(goalFrontier(s, [], ["ee.dc.nodal"]), ["ee.math.algebra"]);
		assert.deepEqual(goalFrontier(s, ["ee.math"], ["ee.dc.nodal"]), ["ee.dc.nodal"]);
	});
});

describe("triggers", () => {
	it("frontier lookahead and granularity in the reachable region", () => {
		// algebra (fringe) → calculus → nodal (hard alternative) and → ee.ac (builds_towards): both stubs at 2 hops (r3 §7.1).
		const t = computeTriggers(s, { attained: [] });
		assert.deepEqual(
			t.map((x) => [x.key, x.trigger.priority, x.depth]),
			[
				["frontier:ee.ac", 50, 2],
				["frontier:ee.dc.nodal", 50, 2],
				["granularity:ee.ac", 50, 2],
			],
		);
		// Without the soft edge ee.ac is 4 hard hops away: outside the refine radius, still a (lower-priority) granularity target.
		const hardOnly = snapshot(Object.values(s.items).map((it) => (it.id === "ee.ac" ? { ...it, softPrereqs: [] } : it)));
		assert.deepEqual(
			computeTriggers(hardOnly, { attained: [] }).map((x) => [x.key, x.trigger.priority, x.depth]),
			[
				["frontier:ee.dc.nodal", 50, 2],
				["granularity:ee.ac", 30, 4],
			],
		);
		const g = computeTriggers(s, { attained: ["ee.math", "ee.dc.ohm", "ee.dc.kvl"], goals: ["ee.ac"] });
		assert.deepEqual(
			g.map((x) => x.key),
			["frontier:ee.dc.nodal", "frontier:ee.ac", "granularity:ee.ac"],
		);
	});

	it("extend trigger when the fringe has fewer than k ready atoms and no stub in range", () => {
		const atoms = snapshot([item("ee", null, "domain"), item("ee.a", "ee", "atom"), item("ee.b", "ee", "atom", { clauses: [["ee.a"]] })]);
		const t = computeTriggers(atoms, { attained: [] });
		assert.equal(t.length, 1);
		assert.equal(t[0]!.key, "frontier:ee");
		assert.match(t[0]!.trigger.reason, /estender/);
		assert.deepEqual(computeTriggers(atoms, { attained: ["ee"], goals: ["ee.b"] }), []);
		assert.deepEqual(computeTriggers(atoms, { attained: ["ee.a", "ee.b"] }), [], "a finished domain is not extended automatically");
		assert.equal(computeTriggers(atoms, { attained: ["ee.a"] })[0]!.key, "frontier:ee");
	});

	it("weakness (≥ 2 failures or missing concept, prerequisites attained); failing stubs also ask for refinement", () => {
		const w = computeTriggers(s, { attained: ["ee.math.algebra"], signals: [{ nodeId: "ee.math.calculus", failures: 2 }] });
		assert.ok(w.some((x) => x.key === "weakness:ee.math.calculus" && x.trigger.priority === 80));
		assert.ok(!computeTriggers(s, { attained: ["ee.math.algebra"], signals: [{ nodeId: "ee.math.calculus", failures: 1 }] }).some((x) => x.trigger.kind === "weakness"));
		assert.ok(computeTriggers(s, { attained: ["ee.math.algebra"], signals: [{ nodeId: "ee.math.calculus", failures: 0, missingConcept: true }] }).some((x) => x.trigger.kind === "weakness"));
		assert.ok(!computeTriggers(s, { attained: [], signals: [{ nodeId: "ee.math.calculus", failures: 5 }] }).some((x) => x.trigger.kind === "weakness"), "not enabled yet");
		const stub = computeTriggers(s, { attained: ["ee.math"], signals: [{ nodeId: "ee.dc.nodal", failures: 3 }] });
		assert.ok(stub.some((x) => x.key === "weakness:ee.dc.nodal"));
		assert.ok(stub.some((x) => x.key === "granularity:ee.dc.nodal" && x.trigger.priority === 55));
	});

	it("requests and coverage gaps get idempotency keys; recent keys and duplicates are dropped; budget order", () => {
		const t = computeTriggers(s, {
			attained: ["ee"],
			requests: [{ text: "Quero  aprender FILTROS ativos" }, { text: "quero aprender filtros ativos" }, { text: "mais exercícios", nodeId: "ee.ac" }],
			coverageGaps: [{ source: "openstax", ref: "ch20", nearNodeId: "ee.dc.ohm" }, { source: "mit", ref: "6.002" }],
			// Everything is attained (so no automatic extension); the node request was already queued.
			recentKeys: ["request:ee.ac"],
		});
		assert.deepEqual(
			t.map((x) => x.key),
			["request:*#quero aprender filtros ativos", "coverage-gap:*#mit:6.002", "coverage-gap:ee.dc.ohm#openstax:ch20"],
		);
		for (let i = 1; i < t.length; i++) assert.ok(t[i - 1]!.trigger.priority >= t[i]!.trigger.priority);
	});
});

describe("budget", () => {
	const cand = (kind: TriggerKind, priority: number, depth: number, estTokens: number, key: string): ExpansionCandidate => ({
		trigger: { kind, reason: key, priority },
		depth,
		estTokens,
		key,
	});

	it("lexicographic order: priority DESC, depth ASC, tokens ASC, key", () => {
		const list = [cand("frontier", 60, 2, 10, "b"), cand("frontier", 60, 1, 50, "c"), cand("request", 90, 9, 99, "d"), cand("frontier", 60, 1, 10, "a")];
		assert.deepEqual(
			[...list].sort(compareCandidates).map((c) => c.key),
			["d", "a", "c", "b"],
		);
	});

	it("admits candidates under every ceiling and defers the rest with a reason", () => {
		const list = [cand("request", 90, 0, 600, "r"), cand("frontier", 60, 0, 300, "f1"), cand("frontier", 55, 1, 300, "f2"), cand("granularity", 50, 0, 50, "g"), cand("frontier", 60, 0, 1, "r")];
		const sel = selectExpansions(list, { day: "2026-11-18", tokensUsed: 0, expansions: 0 }, { enabled: true, tokensPerDay: 1000, expansionsPerDay: 3 }, { day: "2026-11-18", liveItems: 10 });
		assert.deepEqual(
			sel.selected.map((c) => c.key),
			["r", "f1", "g"],
		);
		assert.deepEqual(
			sel.deferred.map((d) => [d.candidate.key, d.reason]),
			[
				["r", "duplicate"],
				["f2", "tokens"],
			],
		);
		assert.deepEqual(sel.remaining, { tokens: 50, expansions: 0 });
		const capped = selectExpansions(list, null, { enabled: true, tokensPerDay: 1e6, expansionsPerDay: 1 }, { day: "d", liveItems: 0 });
		assert.ok(capped.deferred.some((d) => d.reason === "expansions"));
		const full = selectExpansions(list, null, { enabled: true, tokensPerDay: 1e6, expansionsPerDay: 9, maxItems: 14, itemsPerExpansion: 6 }, { day: "d", liveItems: 10 });
		assert.ok(full.selected.length === 0 && full.deferred.some((d) => d.reason === "items"));
		const off = selectExpansions(list, null, { enabled: false, tokensPerDay: 1e6, expansionsPerDay: 9 }, { day: "d", liveItems: 0 });
		assert.deepEqual(
			off.selected.map((c) => c.trigger.kind),
			["request"],
		);
		assert.ok(off.deferred.some((d) => d.reason === "disabled"));
	});

	it("daily counters roll over; the termination measure decreases on every event", () => {
		assert.deepEqual(budgetForDay({ day: "2026-11-17", tokensUsed: 9, expansions: 2 }, "2026-11-18"), { day: "2026-11-18", tokensUsed: 0, expansions: 0 });
		const st = chargeExpansion(chargeExpansion(null, "2026-11-18", 100), "2026-11-18", -5);
		assert.deepEqual(st, { day: "2026-11-18", tokensUsed: 100, expansions: 2 });
		const m0 = terminationMeasure(10, 5);
		assert.equal(measureDecreases(m0, terminationMeasure(9, 8)), true, "expansion consumes budget");
		assert.equal(measureDecreases(m0, terminationMeasure(10, 4)), true, "mastery shrinks Q∖K");
		assert.equal(measureDecreases(m0, terminationMeasure(10, 5)), false);
	});
});

describe("queries", () => {
	it("accent-insensitive search over titles, aliases and the last id segment", () => {
		assert.equal(normalizeForSearch("Função de Transferência!"), "funcao de transferencia");
		assert.deepEqual(
			searchItems(s, "lei").map((h) => h.id),
			["ee.dc.ohm", "ee.dc.kvl"],
		);
		assert.deepEqual(searchItems(s, "analise NODAL")[0], { id: "ee.dc.nodal", score: 100, matched: "Análise nodal" });
		assert.equal(searchItems(s, "resistencia")[0]!.id, "ee.dc.ohm");
		assert.equal(searchItems(s, "kvl")[0]!.id, "ee.dc.kvl");
		assert.deepEqual(searchItems(s, "   "), []);
		assert.equal(searchItems(s, "e", { limit: 2 }).length, 2);
		const retired = { ...s, items: { ...s.items, "ee.ac": { ...s.items["ee.ac"]!, status: "deprecated" as const } } };
		assert.deepEqual(searchItems(retired, "corrente alternada"), []);
		assert.equal(searchItems(retired, "corrente alternada", { includeRetired: true })[0]!.id, "ee.ac");
	});

	it("k-hop neighbourhood, dependency path, region subgraph, item context", () => {
		assert.deepEqual(
			[...neighborhood(s, "ee.dc.kvl", { k: 1 })],
			[
				["ee.dc.kvl", 0],
				["ee.dc.ohm", 1],
				["ee.dc", 1],
				["ee.dc.nodal", 1],
			],
		);
		assert.deepEqual([...neighborhood(s, "ee.dc.kvl", { k: 1, direction: "prereqs" }).keys()], ["ee.dc.kvl", "ee.dc.ohm"]);
		assert.equal(neighborhood(s, "ee.dc.kvl", { k: 5, limit: 3 }).size, 3);
		assert.ok(neighborhood(s, "ee.ac", { k: 1, direction: "prereqs", soft: true }).has("ee.math.calculus"));
		assert.ok(neighborhood(s, "ee.ac", { k: 1, direction: "prereqs", hierarchy: true }).has("ee"));
		assert.equal(neighborhood(s, "ee.nada").size, 0);
		assert.deepEqual(dependencyPath(s, "ee.math.algebra", "ee.ac"), ["ee.math.algebra", "ee.math", "ee.dc.nodal", "ee.dc", "ee.ac"]);
		assert.equal(dependencyPath(s, "ee.ac", "ee.math.algebra"), null);
		assert.deepEqual(regionSubgraph(s, "ee.dc"), {
			rootId: "ee.dc",
			items: ["ee.dc", "ee.dc.ohm", "ee.dc.kvl", "ee.dc.nodal"],
			edges: [
				["ee.dc.ohm", "ee.dc.kvl"],
				["ee.dc.kvl", "ee.dc.nodal"],
			],
			externalPrereqs: ["ee.math", "ee.math.calculus"],
			externalDependents: ["ee.ac"],
		});
		assert.deepEqual(regionSubgraph(s, "ee", { maxDepth: 1 }).items, ["ee", "ee.math", "ee.dc", "ee.ac"]);
		const ctx = itemContext(s, "ee.dc.nodal")!;
		assert.deepEqual(ctx.path, ["ee", "ee.dc"]);
		assert.deepEqual(ctx.siblings, ["ee.dc.ohm", "ee.dc.kvl"]);
		assert.deepEqual(ctx.effectiveClauses, [["ee.dc.kvl"], ["ee.math", "ee.math.calculus"]]);
		assert.equal(ctx.isLeaf, true);
		assert.deepEqual(itemContext(s, "ee.dc.kvl")!.dependents, ["ee.dc.nodal"]);
		assert.equal(itemContext(s, "ee.nada"), null);
	});
});

describe("incremental order (Pearce–Kelly seeded by Kahn)", () => {
	it("seeds with Kahn, reorders on backward insertions and returns cycle witnesses", () => {
		assert.deepEqual(DynamicTopoOrder.seed(["a", "b"], [["a", "b"], ["b", "a"]]).ok, false);
		const seeded = DynamicTopoOrder.seed(["d", "c", "b", "a"], [["a", "b"]]);
		assert.ok(seeded.ok);
		if (!seeded.ok) return;
		const dag = seeded.dag;
		assert.deepEqual(dag.order(), ["a", "b", "c", "d"]);
		assert.deepEqual(dag.addEdge("d", "a"), { ok: true, reordered: 3 });
		assert.deepEqual(checkTopoCertificate(dag.order(), dag.edges(), dag.order()), { ok: true });
		assert.ok(dag.position("d") < dag.position("a"));
		assert.deepEqual(dag.wouldCreateCycle("b", "d"), ["b", "d", "a", "b"]);
		const before = dag.order();
		const res = dag.addEdge("b", "d");
		assert.equal(res.ok, false);
		assert.deepEqual(dag.order(), before, "a refused insertion changes nothing");
		if (!res.ok) assert.deepEqual(checkCycleWitness((u, v) => dag.hasEdge(u, v) || (u === "b" && v === "d"), res.cycle), { ok: true });
		assert.deepEqual(dag.addEdge("a", "a"), { ok: false, cycle: ["a", "a"] });
		const copy = dag.clone();
		dag.removeEdge("d", "a");
		assert.equal(dag.hasEdge("d", "a"), false);
		assert.equal(copy.hasEdge("d", "a"), true);
		assert.throws(() => dag.addNode("a"), RangeError);
		assert.throws(() => dag.addEdge("a", "zz"), RangeError);
		assert.equal(dag.size, 4);
	});

	it("model-based: verdicts match DFS reachability and the order stays topological", () => {
		fc.assert(
			fc.property(fc.integer({ min: 2, max: 12 }).chain((n) => fc.tuple(fc.constant(n), fc.array(fc.tuple(fc.nat({ max: n - 1 }), fc.nat({ max: n - 1 })), { maxLength: 40 }))), ([n, pairs]) => {
				const nodes = Array.from({ length: n }, (_, i) => `n${i}`);
				const seeded = DynamicTopoOrder.seed(nodes, []);
				if (!seeded.ok) return false;
				const dag = seeded.dag;
				const adj = new Map(nodes.map((v) => [v, new Set<string>()]));
				const reaches = (from: string, to: string) => {
					const seen = new Set([from]);
					const stack = [from];
					while (stack.length) {
						const v = stack.pop()!;
						if (v === to) return true;
						for (const w of adj.get(v)!) if (!seen.has(w)) (seen.add(w), stack.push(w));
					}
					return false;
				};
				for (const [a, b] of pairs) {
					const u = nodes[a]!;
					const v = nodes[b]!;
					const cyclic = u === v || reaches(v, u);
					const res = dag.addEdge(u, v);
					if (res.ok === cyclic) return false;
					if (res.ok) adj.get(u)!.add(v);
					else if (!checkCycleWitness((x, y) => adj.get(x)!.has(y) || (x === u && y === v), res.cycle).ok) return false;
					if (!checkTopoCertificate(nodes, dag.edges(), dag.order()).ok) return false;
				}
				return true;
			}),
			{ numRuns: 300 },
		);
	});

	it("fromSnapshot follows the effective ∪ soft graph", () => {
		const dag = DynamicTopoOrder.fromSnapshot(s);
		assert.deepEqual(checkTopoCertificate(dag.order(), dag.edges(), dag.order()), { ok: true });
		assert.ok(dag.hasEdge("ee.math.calculus", "ee.ac"), "soft edge");
		assert.ok(dag.hasEdge("ee.math", "ee.dc.ohm"), "inherited entry requirement");
	});

	it("checkPrereqCandidate agrees with applyPatch(addPrereq) on every pair of the sample", () => {
		assert.deepEqual(checkPrereqCandidate(s, "ee.dc.kvl", "ee.math.calculus"), { ok: true });
		const cyc = checkPrereqCandidate(s, "ee.math.algebra", "ee.dc.ohm");
		assert.ok(!cyc.ok && cyc.error.code === "cycle");
		const hier = checkPrereqCandidate(s, "ee.dc.ohm", "ee.dc");
		assert.ok(!hier.ok && hier.error.code === "hierarchy");
		const unknown = checkPrereqCandidate(s, "ee.dc.ohm", "ee.nada");
		assert.ok(!unknown.ok && unknown.error.code === "unknown-id");
		const self = checkPrereqCandidate(s, "ee.dc.ohm", "ee.dc.ohm");
		assert.ok(!self.ok && self.error.code === "cycle");
		const range = checkPrereqCandidate(s, "ee.dc.ohm", "ee.math.calculus", 3);
		assert.ok(!range.ok && range.error.code === "schema");
		const ids = curriculumIndex(s).sys.ids.filter((id) => id !== "ee");
		for (const it of ids)
			for (const p of ids) {
				const cand = checkPrereqCandidate(s, it, p);
				const res = applyPatch(s, envelope(s, [{ op: "addPrereq", item: it, clauseIndex: 0, prereq: p }]));
				assert.equal(cand.ok, res.ok, `${it} ⇐ ${p}`);
				if (!cand.ok && !res.ok) assert.ok(res.errors.some((e) => e.code === cand.error.code), `${it} ⇐ ${p}: ${cand.error.code} vs ${JSON.stringify(res.errors)}`);
			}
	});
});
