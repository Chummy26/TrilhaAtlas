/**
 * Learner model — signals (SÍNTESE §2.6 table), prompt snapshot (r2 §9.14),
 * calibration (r2 §9.12), Elo level choice (r2 §9.9) and misconception
 * beliefs (r2 §9.10).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import { auc, calibrationByWindow, calibrationPoints, logLoss, rmseBins } from "../src/core/learner/calibration.ts";
import { chooseLevel, eloStep, guessFor, inPracticeBand, predictCorrect, toElo400, updateElo } from "../src/core/learner/elo.ts";
import { foldEvents, freshNodeState, ingestEvents } from "../src/core/learner/fold.ts";
import {
	activeMisconceptionMass,
	misconceptionIdFor,
	misconceptionStatus,
	normalizeMisconceptionText,
	observeMisconception,
	proposeMisconception,
	refuteMisconception,
	topActiveMisconception,
	weakScore,
} from "../src/core/learner/misconceptions.ts";
import { DEFAULT_LEARNER_PARAMS } from "../src/core/learner/params.ts";
import { planDay } from "../src/core/learner/planner.ts";
import { computeSignals, descendantCounts, importanceOf, knowsNow, readinessOf, unlockValues } from "../src/core/learner/signals.ts";
import { buildPromptSnapshot, renderPromptSnapshot } from "../src/core/learner/snapshot.ts";
import type { LearnerEvent, NodeState } from "../src/core/learner/types.ts";
import { chain, day, evidence, graph, masterySteps, must, node, practice } from "./learner-fixtures.ts";

const P = DEFAULT_LEARNER_PARAMS;
const freshState = (id: string): NodeState => freshNodeState(id, 1, P);
const close = (actual: number, expected: number, tol: number, msg?: string) =>
	assert.ok(Math.abs(actual - expected) <= tol, `${msg ?? ""} expected ${expected} ± ${tol}, got ${actual}`);

describe("learner signals (SÍNTESE §2.6)", () => {
	const view = chain(4);
	const studied = ingestEvents(null, practice(masterySteps(["n0", "n1"])), view, P).snapshot;

	it("graph metrics: descendants, importance and unlock value", () => {
		const desc = descendantCounts(view);
		assert.deepEqual(
			view.ids.map((id) => desc.get(id)),
			[3, 2, 1, 0],
		);
		close(importanceOf(view, "n0", P), 1 + 0.5 * Math.log(4), 1e-12);
		const goalChain = graph(node("a"), node("b", { clauses: [["a"]] }), node("c", { clauses: [["b"]], goal: 1 }));
		const U = unlockValues(goalChain, 0.6);
		close(U.get("b") ?? 0, 0.6, 1e-12);
		close(U.get("a") ?? 0, 0.36, 1e-12);
		assert.equal(U.get("c"), 0);
	});

	it("readiness is the best clause product of p·R; entries are always ready", () => {
		const pr = (id: string) => ({ a: 0.9, b: 0.5, c: 0.8 })[id] ?? 0;
		assert.equal(readinessOf([], pr), 1);
		close(readinessOf([["a", "b"]], pr), 0.45, 1e-12);
		close(readinessOf([["a", "b"], ["c"]], pr), 0.8, 1e-12);
	});

	it("separates attained / mastered / estimated / retained / demonstrated / unlocked", () => {
		const at = day(11);
		const sig = computeSignals(studied, view, P, at);
		const n1 = must(sig.signals.get("n1"));
		assert.ok(n1.attained && n1.mastered && n1.unlocked && n1.retained && n1.retentionVerified);
		assert.equal(n1.estimated, true, "pL ≥ 0.85 now");
		assert.equal(n1.demonstrated, false);
		assert.equal(n1.status, "mastered");
		close(n1.pKnowsNow, knowsNow(studied.nodes.n1, at, P), 1e-12);
		const n2 = must(sig.signals.get("n2"));
		assert.equal(n2.status, "frontier");
		assert.ok(n2.unlocked && !n2.attained);
		assert.equal(must(sig.signals.get("n3")).status, "locked");
		assert.deepEqual(sig.structure.frontier, ["n2"]);
		for (const s of sig.signals.values()) {
			for (const v of [s.pL, s.R, s.pKnowsNow, s.readiness, s.retention]) assert.ok(v >= 0 && v <= 1, `${s.nodeId}: ${v}`);
		}
	});

	it("an overdue card shows review_due without unlocking anything less", () => {
		const sig = computeSignals(studied, view, P, day(200));
		assert.equal(must(sig.signals.get("n0")).status, "review_due");
		assert.deepEqual(sig.structure.frontier, ["n2"]);
	});

	it("a learner in progress is 'learning'; containers report from their children", () => {
		const started = foldEvents(null, [evidence({ seq: 1, at: day(0), nodeId: "n0", grade: 3 })], view, P);
		assert.equal(must(computeSignals(started, view, P, day(0)).signals.get("n0")).status, "learning");
		const unit = graph(node("l1"), node("l2"), node("u", { leaf: false, children: ["l1", "l2"], clauses: [["l1", "l2"]] }));
		const done = ingestEvents(null, practice(masterySteps(["l1", "l2"])), unit, P).snapshot;
		assert.equal(must(computeSignals(done, unit, P, day(11)).signals.get("u")).status, "mastered");
	});
});

describe("learner prompt snapshot (r2 §9.14)", () => {
	it("summarizes frontier, top mastered, weak points, due reviews and today's plan in pt-BR", () => {
		const view = chain(3);
		const base = ingestEvents(null, practice(masterySteps(["n0", "n1"])), view, P).snapshot;
		const at = day(11);
		const plan = planDay(base, view, P, { at, budgetMin: 60 });
		const s = buildPromptSnapshot(base, view, P, { at, plan });
		assert.deepEqual(
			s.frontier.map((f) => f.nodeId),
			["n2"],
		);
		assert.deepEqual(
			s.topMastered.map((m) => m.nodeId),
			["n1"],
		);
		assert.deepEqual(s.weak, []);
		assert.equal(s.dueReviews, 0);
		const text = renderPromptSnapshot(s);
		assert.match(text, /^## Estado do aluno\n/);
		assert.match(text, /Pronto para aprender: Tópico n2 \(prontidão \d+%\)\./);
		assert.match(text, /Domina \(topo\): Tópico n1\./);
		assert.match(text, /Revisões vencidas: 0\./);
		assert.match(text, /Plano de hoje: .*Tópico n2 \(30 min\)/);
	});

	it("stays near 300 tokens on a large graph with long titles", () => {
		const big = graph(
			...Array.from({ length: 120 }, (_, i) => ({
				...node(`k${i}`, { clauses: i < 10 ? [] : [[`k${i - 10}`]] }),
				title: `Um título de tópico propositalmente muito longo número ${i} para testar o corte`,
			})),
		);
		const events: LearnerEvent[] = practice(masterySteps(Array.from({ length: 20 }, (_, i) => `k${i}`), 0, 1));
		const snap = ingestEvents(null, events, big, P).snapshot;
		const at = day(70);
		const text = renderPromptSnapshot(buildPromptSnapshot(snap, big, P, { at, plan: planDay(snap, big, P, { at, budgetMin: 120 }) }));
		assert.ok(text.length <= 1800, `${text.length} chars`);
		for (const line of text.split("\n")) assert.ok(!line.includes("propositalmente muito longo número 1 para testar o corte"), "titles are clipped");
	});
});

describe("learner calibration (r2 §9.12)", () => {
	const pts = (pairs: [number, 0 | 1][]) => pairs.map(([predicted, outcome]) => ({ predicted, outcome }));

	it("log loss, AUC and binned RMSE on known inputs", () => {
		close(logLoss(pts([[0.5, 1], [0.5, 0]])) ?? 0, Math.LN2, 1e-12);
		assert.ok((logLoss(pts([[1, 1], [0, 0]])) ?? 1) < 1e-5, "clipped, finite");
		assert.equal(logLoss([]), null);
		assert.equal(auc(pts([[0.9, 1], [0.8, 1], [0.2, 0]])), 1);
		assert.equal(auc(pts([[0.1, 1], [0.9, 0]])), 0);
		assert.equal(auc(pts([[0.5, 1], [0.5, 0]])), 0.5, "ties get average ranks");
		assert.equal(auc(pts([[0.5, 1]])), null);
		close(rmseBins(pts([[0.75, 1], [0.75, 0], [0.15, 0]])) ?? 0, Math.sqrt((2 * 0.25 ** 2 + 0.15 ** 2) / 3), 1e-12);
	});

	it("AUC stays in [0,1] and log loss ≥ 0 (property)", () => {
		fc.assert(
			fc.property(fc.array(fc.tuple(fc.double({ min: 0, max: 1, noNaN: true }), fc.constantFrom<0 | 1>(0, 1)), { minLength: 1, maxLength: 50 }), (pairs) => {
				const p = pts(pairs);
				const a = auc(p);
				if (a !== null) assert.ok(a >= 0 && a <= 1);
				assert.ok((logLoss(p) ?? -1) >= 0);
				const r = rmseBins(p);
				assert.ok(r !== null && r >= 0 && r <= 1);
			}),
		);
	});

	it("windows carry AVG and moving-average baselines computed from the past only", () => {
		const events = [0, 1, 2, 10, 11, 12].map((d, i) => {
			const ev = evidence({ seq: i + 1, at: day(d), nodeId: "n0", grade: i % 3 === 0 ? 0 : 3 });
			if (ev.kind === "evidence") ev.evidence.predicted = 0.7;
			return ev;
		});
		events.push(evidence({ seq: 99, at: day(13), nodeId: "n0", grade: 3 }));
		const points = calibrationPoints(events);
		assert.equal(points.length, 6, "evidence without a recorded prediction is skipped");
		const windows = calibrationByWindow(points, { windowDays: 7 });
		assert.equal(windows.length, 2);
		const [w1, w2] = [must(windows[0]), must(windows[1])];
		assert.equal(w1.n, 3);
		assert.equal(w1.positives, 2);
		assert.equal(w1.avgBaselineLogLoss, null, "nothing before the first window");
		close(w2.avgBaselineLogLoss ?? 0, logLoss(pts([[2 / 3, 0], [2 / 3, 1], [2 / 3, 1]])) ?? 0, 1e-12);
		assert.ok(w2.movingAvgLogLoss !== null);
		assert.throws(() => calibrationByWindow(points, { windowDays: 0 }), RangeError);
	});
});

describe("learner Elo level choice (r2 §9.9)", () => {
	it("targets 0.75 for practice and 0.5 for probes; easier levels are likelier", () => {
		const elo = [0, 0, 0, 0, 0];
		const ps = [1, 2, 3, 4, 5].map((l) => predictCorrect(0.9, l as 1 | 2 | 3 | 4 | 5, elo, 0, 0.2));
		for (let i = 1; i < ps.length; i++) assert.ok((ps[i] as number) < (ps[i - 1] as number));
		const practice = chooseLevel(0.9, elo, 0, 0.2);
		for (const p of ps) assert.ok(Math.abs(practice.p - 0.75) <= Math.abs(p - 0.75) + 1e-12);
		const probe = chooseLevel(0.5, elo, 0, 0.2, "probe");
		assert.ok(Math.abs(probe.p - 0.5) < 0.1);
		assert.equal(chooseLevel(0.9, elo, 0, 0.2, "practice", [2]).level, 2);
		assert.ok(inPracticeBand(0.75) && !inPracticeBand(0.95));
		assert.equal(guessFor("mcq", 5), 0.2);
		assert.equal(guessFor("short"), 0.2);
	});

	it("updates move θ with the surprise and item difficulty against it", () => {
		const up = updateElo(0, 0, [0, 0, 0, 0, 0], 3, 0, 1, 0.6);
		close(up.theta, 0.4, 1e-12);
		close(up.levelElo[2] ?? 0, -0.4, 1e-12);
		assert.equal(up.thetaN, 1);
		const down = updateElo(0, 0, [0, 0, 0, 0, 0], 3, 0, 0, 0.6);
		assert.ok(down.theta < 0 && (down.levelElo[2] ?? 0) > 0);
		assert.ok(eloStep(100) < eloStep(10) && eloStep(0) === 1);
		close(toElo400(Math.LN10), 400, 1e-9);
	});

	it("predictions stay in [0,1] (property)", () => {
		fc.assert(
			fc.property(
				fc.double({ min: 0, max: 1, noNaN: true }),
				fc.constantFrom(1, 2, 3, 4, 5),
				fc.array(fc.double({ min: -5, max: 5, noNaN: true }), { minLength: 5, maxLength: 5 }),
				fc.double({ min: -5, max: 5, noNaN: true }),
				fc.double({ min: 0, max: 1, noNaN: true }),
				(pR, level, elo, theta, guess) => {
					const p = predictCorrect(pR, level as 1 | 2 | 3 | 4 | 5, elo, theta, guess);
					assert.ok(p >= 0 && p <= 1);
				},
			),
		);
	});
});

describe("learner misconceptions (r2 §9.10)", () => {
	it("Beta(1,4) belief: dormant → active on errors → resolved after refutations", () => {
		let s: NodeState = freshState("n0");
		const text = "Soma resistores em paralelo";
		const { state, id } = proposeMisconception(s, text, 1, day(0));
		s = state;
		assert.equal(id, misconceptionIdFor(text));
		assert.equal(misconceptionStatus(must(s.misconceptions[id])), "dormant");
		s = observeMisconception(s, id, 1, day(1));
		s = observeMisconception(s, id, 1, day(2));
		assert.equal(misconceptionStatus(must(s.misconceptions[id])), "active");
		close(activeMisconceptionMass(s), 4 / 8, 1e-12);
		assert.equal(topActiveMisconception(s)?.text, text);
		for (let i = 0; i < 16; i++) s = refuteMisconception(s, id, day(3 + i));
		assert.equal(misconceptionStatus(must(s.misconceptions[id])), "resolved");
		assert.equal(activeMisconceptionMass(s), 0);
		assert.equal(refuteMisconception(s, "mc.unknown", day(30)), s);
	});

	it("text normalization dedups case, accents and spacing", () => {
		assert.equal(normalizeMisconceptionText("  Tensão   É Corrente "), "tensao e corrente");
		assert.equal(misconceptionIdFor("Tensão é corrente"), misconceptionIdFor("tensao  E CORRENTE"));
		assert.equal(proposeMisconception(freshState("n0"), "   ", 1, day(0)).id, "");
	});

	it("weak score adds the active misconception mass", () => {
		const base = weakScore(0.5, 2, 3, freshState("n0"));
		close(base, 0.5 * 2 * 4, 1e-12);
		let s = proposeMisconception(freshState("n0"), "x", 1, day(0)).state;
		s = observeMisconception(s, misconceptionIdFor("x"), 1, day(0));
		s = observeMisconception(s, misconceptionIdFor("x"), 1, day(0));
		close(weakScore(0.5, 2, 3, s), base + 0.5, 1e-12);
	});
});
