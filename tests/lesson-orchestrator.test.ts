/**
 * Orchestrator state machine (docs/impl/lesson.md; SÍNTESE §1.2 P5–P7, P11,
 * P14; §1.3; §2.4(c)(d); r1 §6.3–§6.8): happy path, check budget and
 * spacing, hints and reveal, remediation, deferral, fatigue, skip, time-up,
 * purity/replay and no key leakage to clients.
 *
 * The LessonDriver deep-freezes the state before every reduce(), so any
 * mutation of the input state would throw.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fc from "fast-check";
import { WORD_BUDGETS } from "../src/core/lesson/budget.ts";
import {
	canPoseCheck,
	CHECK_MIN_INTERVAL_MS,
	createLesson,
	expectedScore,
	reduce,
	replay,
	targetDifficulty,
	toClientLessonView,
	type LessonEffect,
	type LessonEvent,
} from "../src/core/lesson/orchestrator.ts";
import { CHECK_ROLES, type ItemRole } from "../src/core/lesson/protocol.ts";
import { assertNoKeyMaterial, compiledPlan, LessonDriver, NODE_ID, SECRET, T0, warmupItem } from "./lesson-fixtures.ts";

type Of<T extends LessonEffect["type"]> = Extract<LessonEffect, { type: T }>;

/** Answer every card correctly until `stop(itemId)` is true for the open card (returns it) or the lesson ends. */
function runUntil(d: LessonDriver, stop: (itemId: string) => boolean): string | null {
	for (let guard = 0; guard < 80; guard++) {
		const id = d.pump();
		if (id === null) return null;
		if (stop(id)) return id;
		d.answerCorrect();
	}
	throw new Error("runUntil: no convergence");
}

function started(init: ConstructorParameters<typeof LessonDriver>[0] = {}, warmups = [warmupItem()]): LessonDriver {
	const d = new LessonDriver(init);
	d.start();
	d.ready(compiledPlan(), warmups);
	return d;
}

const poses = (d: LessonDriver) => d.effectsOf("pose_item");
const posedIds = (d: LessonDriver) => poses(d).map((p) => p.itemId);
const renders = (d: LessonDriver) => d.effectsOf("render_phase");
const ended = (d: LessonDriver) => d.effectsOf("end_lesson")[0];

describe("no model call without a click (P14)", () => {
	test("createLesson emits nothing; only the click asks for a plan", () => {
		const d = new LessonDriver();
		assert.equal(d.state.status, "idle");
		const effects = d.start();
		assert.deepEqual(effects, [{ type: "prepare_plan", nodeId: NODE_ID, nodeVersion: 1, domainId: "electronics" }]);
		assert.equal(d.state.status, "preparing");
	});

	test("property: before the click, no event produces model work", () => {
		const plan = compiledPlan();
		const eventArb: fc.Arbitrary<LessonEvent> = fc.oneof(
			fc.record({ type: fc.constant("plan_ready" as const), at: fc.nat(), plan: fc.constant(plan) }),
			fc.record({ type: fc.constant("plan_failed" as const), at: fc.nat(), reason: fc.string() }),
			fc.record({ type: fc.constant("phase_rendered" as const), at: fc.nat(), renderId: fc.constantFrom("r1", "r2"), text: fc.string() }),
			fc.record({ type: fc.constant("answer_submitted" as const), at: fc.nat(), itemId: fc.constantFrom("pred", "kp1.i1"), response: fc.constant({ kind: "dont_know" as const }) }),
			fc.record({ type: fc.constant("answer_graded" as const), at: fc.nat(), itemId: fc.constant("kp1.i1"), grade: fc.constantFrom(0 as const, 3 as const), confidence: fc.double({ min: 0, max: 1, noNaN: true }) }),
			fc.record({ type: fc.constant("hint_requested" as const), at: fc.nat(), itemId: fc.constant("kp1.i1") }),
			fc.record({ type: fc.constant("skip_requested" as const), at: fc.nat(), scope: fc.constantFrom("step" as const, "lesson" as const) }),
			fc.record({ type: fc.constant("fatigue_signal" as const), at: fc.nat(), signal: fc.constantFrom("tick" as const, "tired" as const, "ok" as const) }),
			fc.record({ type: fc.constant("remediation_needed" as const), at: fc.nat() }),
			fc.record({ type: fc.constant("time_up" as const), at: fc.nat() }),
		);
		fc.assert(
			fc.property(fc.array(eventArb, { maxLength: 12 }), (events) => {
				const { state, effects } = replay({ nodeId: NODE_ID, nodeVersion: 1, domainId: "electronics" }, events);
				assert.equal(state.status, "idle");
				assert.ok(effects.every((e) => e.type === "event_rejected"));
			}),
			{ numRuns: 150 },
		);
	});

	test("nothing renders before the plan arrives", () => {
		const d = new LessonDriver();
		d.start();
		d.dispatch({ type: "time_up", at: T0 + 1 });
		assert.equal(ended(d)?.outcome, "time_up");
		assert.equal(renders(d).length, 0);
	});
});

describe("happy path", () => {
	const d = started();
	runUntil(d, () => false);

	test("walks the full protocol and completes", () => {
		assert.equal(d.state.status, "ended");
		assert.equal(ended(d)?.outcome, "completed");
		assert.equal(d.effectsOf("event_rejected").length, 0);
		assert.deepEqual(
			renders(d).map((r) => r.phase),
			["orient", "explain", "explain", "worked", "worked", "variation", "recap"],
		);
		assert.deepEqual(posedIds(d), ["pred", "w1", "soc1", "kp1.faded", "kp1.i1", "kp1.i2", "se1", "kp2.faded", "kp2.i1", "kp2.i2", "var1"]);
	});

	test("item choice climbs difficulty while accuracy is above 85%", () => {
		const practice = poses(d).filter((p) => p.role === "practice").map((p) => p.itemId);
		assert.deepEqual(practice, ["kp1.i1", "kp1.i2", "kp2.i1", "kp2.i2"]);
	});

	test("conversational checks: ≤3 per node, never two in a row, ≥3 min apart", () => {
		const checks = d.timeline.flatMap(({ at, effects }) => effects.filter((e): e is Of<"pose_item"> => e.type === "pose_item" && CHECK_ROLES.has(e.role)).map((e) => ({ at, role: e.role })));
		assert.deepEqual(checks.map((c) => c.role), ["predict", "socratic", "self_explanation"]);
		for (let i = 1; i < checks.length; i++) assert.ok((checks[i]?.at ?? 0) - (checks[i - 1]?.at ?? 0) >= CHECK_MIN_INTERVAL_MS);
		const roles = poses(d).filter((p) => p.attempt === 1).map((p) => p.role);
		for (let i = 1; i < roles.length; i++) assert.ok(!(CHECK_ROLES.has(roles[i] as ItemRole) && CHECK_ROLES.has(roles[i - 1] as ItemRole)), `checks in a row at ${i}`);
		assert.ok(!posedIds(d).includes("close1"), "the closing check is skipped once the budget is spent");
	});

	test("renders never allow questions and carry the phase word budget; every question is a turn-ending card", () => {
		for (const r of renders(d)) {
			assert.equal(r.questionAllowed, false);
			assert.equal(r.maxWords, WORD_BUDGETS[r.budgetPhase]);
		}
		for (const p of poses(d)) assert.equal(p.endsTurn, true);
	});

	test("a confident correct answer gets no prose follow-up", () => {
		const feedback = renders(d).filter((r) => r.inputs.kind === "feedback");
		assert.deepEqual(feedback, [], "every answer in the happy path was a grade-3 success");
	});

	test("evidence: one per finished practice-like card, with node, format and exposure", () => {
		const evidence = d.effectsOf("record_evidence").map((e) => e.evidence);
		assert.deepEqual(evidence.map((e) => e.itemId), ["w1", "kp1.faded", "kp1.i1", "kp1.i2", "se1", "kp2.faded", "kp2.i1", "kp2.i2", "var1"]);
		const warm = evidence[0];
		assert.equal(warm?.nodes[0]?.nodeId, "ee.dc.ohm");
		assert.equal(warm?.minutesSinceExposure, 2880);
		const i2 = evidence.find((e) => e.itemId === "kp1.i2");
		assert.equal(i2?.nodes[0]?.nodeId, NODE_ID);
		assert.equal(i2?.format, "numeric");
		assert.equal(i2?.grade, 3);
		assert.equal(i2?.hints, 0);
		assert.equal(i2?.level, 3);
		assert.ok((i2?.minutesSinceExposure ?? 0) > 0);
		const mcq = evidence.find((e) => e.itemId === "kp2.i1");
		assert.equal(mcq?.options, 3);
		assert.deepEqual(mcq?.diagnoses, [{ nodeId: NODE_ID, misconceptionId: "m.current_consumed" }]);
		assert.equal(evidence.find((e) => e.itemId === "se1")?.graderConfidence, 0.8);
	});

	test("one exposure, at the first explanation, logged before the node's first evidence", () => {
		const exposures = d.effectsOf("record_exposure");
		assert.equal(exposures.length, 1);
		const firstSegmentAt = d.timeline.find(({ effects }) => effects.some((e) => e.type === "render_phase" && e.phase === "explain"))?.at ?? 0;
		assert.equal(exposures[0]?.at, new Date(firstSegmentAt).toISOString());
		assert.equal(exposures[0]?.nodeId, NODE_ID);
		assert.ok((exposures[0]?.minutes ?? 0) > 0);
		const kinds = d.log.filter((e) => e.type === "record_exposure" || e.type === "record_evidence").map((e) => (e.type === "record_evidence" ? e.evidence.nodes[0]?.nodeId : "exposure"));
		assert.deepEqual(kinds.slice(0, 3), ["ee.dc.ohm", "exposure", NODE_ID], "the warm-up (other node) may come first");
	});

	test("cards: only for passed KPs and observed misconceptions, then the end", () => {
		const cards = d.effectsOf("propose_cards");
		assert.equal(cards.length, 1);
		assert.deepEqual(cards[0]?.candidates.map((c) => c.kpId), ["kp1", "kp2"]);
		assert.deepEqual(cards[0]?.errorCards, []);
		assert.equal(d.log.at(-1)?.type, "end_lesson");
		assert.deepEqual(ended(d)?.summary.kpsPassed, ["kp1", "kp2"]);
	});

	test("no key material reaches clients at any point", () => {
		for (const p of poses(d)) assertNoKeyMaterial(p, `pose_item ${p.itemId}`);
		let state = createLesson({ nodeId: NODE_ID, nodeVersion: 1, domainId: "electronics" });
		for (const event of d.events) {
			state = reduce(state, event).state;
			assertNoKeyMaterial(toClientLessonView(state), `view after ${event.type}`);
		}
		for (const e of d.log) {
			if (e.type === "grade_item") continue; // echoes the learner's own response
			assert.ok(!JSON.stringify(e).includes(SECRET), `${e.type} carries a secret`);
		}
	});

	test("replay is deterministic (event sourcing)", () => {
		const a = replay({ nodeId: NODE_ID, nodeVersion: 1, domainId: "electronics" }, d.events);
		const b = replay({ nodeId: NODE_ID, nodeVersion: 1, domainId: "electronics" }, d.events);
		assert.deepEqual(a, b);
		assert.deepEqual(a.state, d.state);
		assert.deepEqual(a.effects, d.log);
	});

	test("events after the end are rejected without changing the state", () => {
		const before = d.state;
		const t = reduce(before, { type: "time_up", at: d.now + 1 });
		assert.equal(t.state, before);
		assert.deepEqual(t.effects.map((e) => e.type), ["event_rejected"]);
	});
});

describe("check gating", () => {
	test("a check within 3 minutes of the previous one is skipped", () => {
		const d = started();
		d.readMs = 30_000;
		runUntil(d, () => false);
		assert.ok(!posedIds(d).includes("soc1"));
		assert.equal(ended(d)?.outcome, "completed");
	});

	test("canPoseCheck rules", () => {
		const base = createLesson({ nodeId: NODE_ID, nodeVersion: 1, domainId: "electronics" });
		assert.equal(canPoseCheck(base, 0), true);
		assert.equal(canPoseCheck({ ...base, lastPosedKind: "check", lastCheckAt: 0 }, CHECK_MIN_INTERVAL_MS), false);
		assert.equal(canPoseCheck({ ...base, lastPosedKind: "practice", lastCheckAt: 0 }, CHECK_MIN_INTERVAL_MS - 1), false);
		assert.equal(canPoseCheck({ ...base, lastPosedKind: "practice", lastCheckAt: 0 }, CHECK_MIN_INTERVAL_MS), true);
		assert.equal(canPoseCheck({ ...base, lastPosedKind: "check", lastCheckAt: 0 }, 1, true), true, "socratic follow-up is exempt from spacing");
	});
});

describe("hints and reveal", () => {
	test("ladder cue → principle → next step; asking for the answer before trying arms it; the next ask reveals", () => {
		const d = started();
		runUntil(d, (id) => id === "kp1.faded");
		d.dispatch({ type: "hint_requested", at: d.now, itemId: "kp1.faded" });
		const h1 = d.last.find((e): e is Of<"render_phase"> => e.type === "render_phase");
		assert.deepEqual(h1?.inputs, { kind: "hint", itemId: "kp1.faded", level: 1 });
		assert.equal(h1?.budgetPhase, "hint");
		assert.equal(h1?.maxWords, 35);
		d.ack();
		assert.equal(d.last.length, 0, "the card stays open after a hint");
		d.dispatch({ type: "hint_requested", at: d.now, itemId: "kp1.faded" });
		d.ack();
		d.dispatch({ type: "hint_requested", at: d.now, itemId: "kp1.faded", wantsAnswer: true });
		const h3 = d.last.find((e): e is Of<"render_phase"> => e.type === "render_phase");
		assert.deepEqual(h3?.inputs, { kind: "hint", itemId: "kp1.faded", level: 3 });
		d.ack();
		d.dispatch({ type: "hint_requested", at: d.now, itemId: "kp1.faded", wantsAnswer: true });
		const ev = d.last.find((e): e is Of<"record_evidence"> => e.type === "record_evidence");
		assert.equal(ev?.evidence.itemId, "kp1.faded");
		assert.equal(ev?.evidence.grade, 0);
		assert.equal(ev?.evidence.hints, 4);
		const sol = d.last.find((e): e is Of<"render_phase"> => e.type === "render_phase");
		assert.equal(sol?.budgetPhase, "solution");
		assert.equal(sol?.inputs.kind === "solution" && sol.inputs.reason, "request");
		assert.equal(d.state.active, null);
		assert.equal(d.state.stats.revealed, 1);
	});

	test("two wrong attempts: pointer feedback, re-pose, then the solution", () => {
		const d = started();
		runUntil(d, (id) => id === "kp1.i1");
		d.answerWrong();
		const fb = d.last.find((e): e is Of<"render_phase"> => e.type === "render_phase");
		assert.equal(fb?.budgetPhase, "feedback");
		assert.equal(fb?.inputs.kind === "feedback" && fb.inputs.pointer, true);
		assert.equal(d.pump(), "kp1.i1");
		const repose = d.last.find((e): e is Of<"pose_item"> => e.type === "pose_item");
		assert.equal(repose?.attempt, 2);
		assert.equal(repose?.hintLevel, 1);
		d.answerWrong();
		const sol = d.last.find((e): e is Of<"render_phase"> => e.type === "render_phase");
		assert.equal(sol?.budgetPhase, "solution");
		assert.equal(sol?.inputs.kind === "solution" && sol.inputs.reason, "attempts");
		const ev = d.last.find((e): e is Of<"record_evidence"> => e.type === "record_evidence");
		assert.equal(ev?.evidence.grade, 0);
		assert.equal(ev?.evidence.hints, 4);
		assert.deepEqual(d.state.kps[0]?.results, [false]);
	});

	test("right after a cue: credit for the pass rule, evidence capped at 2", () => {
		const d = started();
		runUntil(d, (id) => id === "kp1.i1");
		d.dispatch({ type: "hint_requested", at: d.now, itemId: "kp1.i1" });
		d.ack();
		d.answerCorrect();
		const ev = d.last.find((e): e is Of<"record_evidence"> => e.type === "record_evidence");
		assert.equal(ev?.evidence.grade, 2);
		assert.equal(ev?.evidence.hints, 1);
		assert.deepEqual(d.state.kps[0]?.results, [true]);
	});

	test("a confident error gets elaborated feedback and an error card", () => {
		const d = started();
		runUntil(d, (id) => id === "kp1.i1");
		d.answerWrong({ selfConfidence: 3 });
		const fb = d.last.find((e): e is Of<"render_phase"> => e.type === "render_phase");
		assert.equal(fb?.budgetPhase, "feedback_elaborate");
		d.pump();
		d.answerWrong({ selfConfidence: 3 });
		assert.deepEqual(d.state.errorCards, [{ itemId: "kp1.i1", nodeId: NODE_ID, kpId: "kp1", reason: "high_confidence_error" }]);
	});

	test("hints are refused on check cards; invalid answers do not consume the attempt", () => {
		const d = started();
		assert.equal(d.pump(), "pred");
		d.dispatch({ type: "hint_requested", at: d.now, itemId: "pred" });
		assert.equal(d.last[0]?.type, "event_rejected");
		runUntil(d, (id) => id === "kp1.i1");
		d.dispatch({ type: "answer_submitted", at: d.now, itemId: "kp1.i1", response: { kind: "text", text: "4300" } });
		assert.equal(d.last[0]?.type, "event_rejected");
		assert.match(d.last[0]?.type === "event_rejected" ? d.last[0].reason : "", /unidade/);
		assert.equal(d.state.active?.awaiting, "answer");
		assert.equal(d.state.active?.hint.attempts, 0);
	});
});

describe("remediation", () => {
	test("misconception on the final attempt → remediate render → bridge item → back to practice", () => {
		const d = started();
		runUntil(d, (id) => id === "kp2.i1");
		d.answerWrong({ misconceptionId: "m.current_consumed" });
		d.pump();
		d.answerWrong({ misconceptionId: "m.current_consumed" });
		assert.equal(d.pump(), "bridge1");
		const tail = renders(d).slice(-2).map((r) => r.inputs.kind);
		assert.deepEqual(tail, ["solution", "remediation"]);
		const rem = renders(d).at(-1);
		assert.equal(rem?.phase, "remediate");
		assert.deepEqual(rem?.inputs, { kind: "remediation", kpId: "kp2", misconceptionId: "m.current_consumed" });
		assert.equal(poses(d).at(-1)?.role, "bridge");
		d.answerCorrect();
		const next = d.pump();
		assert.ok(next?.startsWith("kp2.i"), String(next));
		assert.equal(d.state.stats.remediations, 1);
		assert.deepEqual(d.state.errorCards.map((c) => c.reason), ["misconception"]);
	});

	test("two failed items → remediation once; ✗✗✓✓ still passes the KP", () => {
		const d = started();
		runUntil(d, (id) => id === "kp1.i1");
		d.answerWrong();
		d.pump();
		d.answerWrong();
		const second = d.pump();
		assert.equal(second, "kp1.i2", "after an error the controller stays on/below the last difficulty");
		d.answerWrong();
		d.pump();
		d.answerWrong();
		assert.equal(d.state.remediation?.kpId, "kp1");
		const next = d.pump();
		assert.equal(renders(d).filter((r) => r.inputs.kind === "remediation").length, 1);
		assert.ok(next && next !== "kp1.i1" && next !== "kp1.i2");
		d.answerCorrect();
		d.pump();
		d.answerCorrect();
		assert.deepEqual(d.state.kps[0]?.results, [false, false, true, true]);
		assert.equal(d.state.kps[0]?.passed, true);
		assert.equal(d.pump(), "se1", "the lesson moves on to KP2");
	});

	test("a KP that can no longer pass ends the lesson as deferred (no recap, no cards)", () => {
		const d = started();
		runUntil(d, (id) => id === "kp1.i1");
		for (let guard = 0; guard < 20 && d.state.status === "active"; guard++) {
			const id = d.pump();
			if (!id) break;
			d.answerWrong();
		}
		assert.equal(ended(d)?.outcome, "deferred");
		assert.equal(d.state.stats.remediations, 1, "at most one remediation per KP");
		assert.ok(!renders(d).some((r) => r.phase === "recap"));
		assert.equal(d.effectsOf("propose_cards").length, 0);
		assert.equal(d.state.kps[0]?.exhausted, true);
	});

	test("remediation_needed from the server is queued after the open card; repeats are rejected", () => {
		const d = started();
		runUntil(d, (id) => id === "kp2.i1");
		d.dispatch({ type: "remediation_needed", at: d.now, misconceptionId: "m.current_consumed" });
		assert.equal(d.last.length, 0);
		d.dispatch({ type: "remediation_needed", at: d.now, kpId: "kp2" });
		assert.equal(d.last[0]?.type, "event_rejected");
		d.answerCorrect();
		const rem = d.last.find((e): e is Of<"render_phase"> => e.type === "render_phase");
		assert.equal(rem?.inputs.kind, "remediation");
	});
});

describe("closing exit ticket (r1 §6.9)", () => {
	test("never asked after a clean run (practice is the evidence), even with budget left", () => {
		const d = started({}, []);
		d.readMs = 200_000;
		runUntil(d, () => false);
		assert.equal(d.state.stats.checksPosed, 2, "predict + self-explanation: one check left in the budget");
		assert.ok(!posedIds(d).includes("close1"));
		assert.equal(ended(d)?.outcome, "completed");
	});

	test("asked after a struggled KP when the check budget still allows it", () => {
		const d = new LessonDriver();
		d.start();
		d.ready(planWithoutChecks(compiledPlan()), []);
		assert.equal(runUntil(d, (id) => id === "kp1.i1"), "kp1.i1");
		d.answerWrong();
		d.pump();
		d.answerWrong();
		runUntil(d, (id) => id === "close1");
		assert.equal(d.state.active?.itemId, "close1");
		assert.equal(d.state.active?.role, "closing");
		assert.equal(d.state.phase, "exit");
		d.answerCorrect();
		d.pump();
		assert.equal(ended(d)?.outcome, "completed");
	});
});

/** The fixture plan without prediction, socratic and self-explanation, so the check budget is untouched. */
function planWithoutChecks(plan: ReturnType<typeof compiledPlan>): ReturnType<typeof compiledPlan> {
	const { prediction: _p, selfExplanation: _s, ...rest } = plan;
	return { ...rest, segments: plan.segments.map(({ socratic: _soc, ...seg }) => ({ ...seg, resolvesPrediction: false })) };
}

describe("fatigue", () => {
	test("slow answers vs the day's baseline switch the format, once", () => {
		const d = started({ baselineLatencyMs: 5_000 });
		for (let guard = 0; guard < 40 && d.state.status === "active"; guard++) {
			const id = d.pump();
			if (!id) break;
			d.answerCorrect({ latencyMs: 12_000 });
		}
		const actions = d.effectsOf("fatigue_action");
		assert.equal(actions[0]?.action, "switch_format");
		assert.equal(actions.filter((a) => a.action === "switch_format").length, 1);
		assert.ok((actions[0]?.signals.latencyRatio ?? 0) >= 1.5);
	});

	test("slow answers plus easy errors skip the optional steps", () => {
		const d = started({ baselineLatencyMs: 5_000 });
		assert.equal(runUntil(d, (id) => id === "w1"), "w1");
		d.answerWrong({ latencyMs: 12_000 });
		d.pump();
		d.answerCorrect({ latencyMs: 12_000 }); // soc1 (check, no evidence)
		assert.equal(d.pump(), "kp1.faded");
		d.answerWrong({ latencyMs: 12_000 });
		d.pump();
		d.answerWrong({ latencyMs: 12_000 });
		assert.equal(d.pump(), "kp1.i1");
		d.answerCorrect({ latencyMs: 12_000 }); // third timed sample: the latency signal joins the easy errors
		const levels = d.effectsOf("fatigue_action").map((a) => a.action);
		assert.ok(levels.includes("skip_optional"), levels.join());
		assert.equal(d.state.skipOptional, true);
		runUntil(d, () => false);
		assert.ok(!posedIds(d).includes("se1") && !posedIds(d).includes("var1"));
		assert.ok(!renders(d).some((r) => r.phase === "variation"));
	});

	test("'tired' suggests a break once; 'ok' clears the nudges", () => {
		const d = started();
		runUntil(d, (id) => id === "kp1.i1");
		d.dispatch({ type: "fatigue_signal", at: d.now, signal: "tired" });
		assert.equal(d.last.find((e): e is Of<"fatigue_action"> => e.type === "fatigue_action")?.action, "suggest_break");
		d.dispatch({ type: "fatigue_signal", at: d.now, signal: "tired" });
		assert.equal(d.last.length, 0);
		d.dispatch({ type: "fatigue_signal", at: d.now, signal: "ok" });
		assert.equal(d.last.length, 0);
		assert.equal(d.state.skipOptional, false);
		assert.equal(d.state.formatSwitch, false);
	});

	test("a 50-minute block wraps up; with no KP passed it ends right away", () => {
		const d = started({ blockStartedAt: T0 - 49 * 60_000 });
		runUntil(d, () => false);
		assert.deepEqual(d.effectsOf("fatigue_action").map((a) => a.action), ["wrap_up"]);
		assert.equal(ended(d)?.outcome, "fatigue");
		assert.ok(!renders(d).some((r) => r.phase === "recap"));
	});

	test("two \"não sei\" answers switch the format", () => {
		const d = started();
		runUntil(d, (id) => id === "kp1.i1");
		d.answer({ kind: "dont_know" });
		d.pump();
		d.answer({ kind: "dont_know" });
		assert.equal(d.pump(), "kp1.i2");
		d.answer({ kind: "dont_know" });
		d.pump();
		d.answer({ kind: "dont_know" });
		const action = d.effectsOf("fatigue_action")[0];
		assert.equal(action?.action, "switch_format");
		assert.equal(action?.signals.dontKnowLast5, 2);
		assert.equal(d.state.formatSwitch, true);
	});

	test("20 minutes without activity ends the lesson as inactive", () => {
		const d = started();
		runUntil(d, (id) => id === "kp1.faded");
		d.dispatch({ type: "fatigue_signal", at: d.now + 21 * 60_000, signal: "tick" });
		assert.equal(ended(d)?.outcome, "inactive");
	});
});

describe("skip and time-up", () => {
	test("skipping a card abandons it without evidence and moves on", () => {
		const d = started();
		runUntil(d, (id) => id === "kp1.i1");
		d.dispatch({ type: "skip_requested", at: d.now, scope: "step" });
		const next = d.last.find((e): e is Of<"pose_item"> => e.type === "pose_item");
		assert.ok(next && next.itemId !== "kp1.i1");
		assert.ok(!d.effectsOf("record_evidence").some((e) => e.evidence.itemId === "kp1.i1"));
	});

	test("skipping a render drops it; its late acknowledgment is rejected", () => {
		const d = started();
		const orient = d.state.pendingRender;
		assert.equal(orient?.phase, "orient");
		d.dispatch({ type: "skip_requested", at: d.now, scope: "step" });
		assert.equal(d.last.find((e): e is Of<"pose_item"> => e.type === "pose_item")?.itemId, "pred");
		d.dispatch({ type: "phase_rendered", at: d.now, renderId: orient?.renderId ?? "" });
		assert.equal(d.last[0]?.type, "event_rejected");
	});

	test("two skips count as a fatigue signal", () => {
		const d = started();
		runUntil(d, (id) => id === "kp1.i1");
		d.dispatch({ type: "skip_requested", at: d.now, scope: "step" });
		d.dispatch({ type: "skip_requested", at: d.now, scope: "step" });
		assert.equal(d.effectsOf("fatigue_action")[0]?.action, "switch_format");
	});

	test("skipping the lesson after a passed KP: recap → cards (passed KP only) → end", () => {
		const d = started();
		runUntil(d, (id) => id === "kp2.faded");
		d.dispatch({ type: "skip_requested", at: d.now, scope: "lesson" });
		assert.equal(d.state.pendingRender?.phase, "recap");
		d.pump();
		assert.deepEqual(d.effectsOf("propose_cards")[0]?.candidates.map((c) => c.kpId), ["kp1"]);
		assert.equal(ended(d)?.outcome, "skipped");
	});

	test("time-up while a grade is pending waits for it, then wraps up", () => {
		const d = started();
		runUntil(d, (id) => id === "kp1.i1");
		const a = d.state.active;
		assert.ok(a);
		d.dispatch({ type: "answer_submitted", at: d.now, itemId: "kp1.i1", response: { kind: "text", text: "1 kΩ" } });
		d.dispatch({ type: "time_up", at: d.now });
		assert.equal(d.state.status, "active");
		d.dispatch({ type: "answer_graded", at: d.now, itemId: "kp1.i1", grade: 0, confidence: 1 });
		assert.equal(d.last.find((e): e is Of<"render_phase"> => e.type === "render_phase")?.budgetPhase, "solution", "no retry once time is up");
		d.pump();
		assert.equal(ended(d)?.outcome, "time_up");
	});

	test("skipping right after the explanation still records the exposure; nothing before it does", () => {
		const d = started({}, []);
		runUntil(d, (id) => id === "kp1.faded");
		d.dispatch({ type: "skip_requested", at: d.now, scope: "lesson" });
		assert.equal(ended(d)?.outcome, "skipped");
		assert.equal(d.effectsOf("record_exposure").length, 1);
		const early = new LessonDriver();
		early.start();
		early.ready(compiledPlan(), []);
		early.dispatch({ type: "skip_requested", at: early.now, scope: "lesson" });
		assert.equal(early.effectsOf("record_exposure").length, 0, "orient alone is not an explanation");
	});

	test("skip lesson while preparing ends it", () => {
		const d = new LessonDriver();
		d.start();
		d.dispatch({ type: "skip_requested", at: T0, scope: "lesson" });
		assert.equal(ended(d)?.outcome, "skipped");
	});
});

describe("robustness", () => {
	test("stale or foreign events are rejected with a reason", () => {
		const d = new LessonDriver();
		d.start();
		const other = { ...compiledPlan(), nodeId: "ee.other" };
		d.dispatch({ type: "plan_ready", at: T0, plan: other });
		assert.equal(d.last[0]?.type, "event_rejected");
		d.ready();
		d.dispatch({ type: "answer_graded", at: T0, itemId: "kp1.i1", grade: 3, confidence: 1 });
		assert.equal(d.last[0]?.type, "event_rejected");
		d.dispatch({ type: "phase_rendered", at: T0, renderId: "nope" });
		assert.equal(d.last[0]?.type, "event_rejected");
		d.dispatch({ type: "learner_clicked_start", at: T0 });
		assert.equal(d.last[0]?.type, "event_rejected");
	});

	test("a grade outside 0..3 or a NaN confidence is rejected, not folded into Evidence", () => {
		const d = started();
		runUntil(d, (id) => id === "kp1.i1");
		d.dispatch({ type: "answer_submitted", at: d.now, itemId: "kp1.i1", response: { kind: "text", text: "4,3 kΩ" }, latencyMs: Number.NaN });
		assert.equal(d.state.active?.latencyMs !== undefined && Number.isFinite(d.state.active.latencyMs), true, "a NaN latency falls back to the measured one");
		d.dispatch({ type: "answer_graded", at: d.now, itemId: "kp1.i1", grade: 5 as 3, confidence: 1 });
		assert.equal(d.last[0]?.type, "event_rejected");
		d.dispatch({ type: "answer_graded", at: d.now, itemId: "kp1.i1", grade: 3, confidence: Number.NaN });
		assert.equal(d.last[0]?.type, "event_rejected");
		assert.equal(d.state.active?.awaiting, "grade", "the card still waits for a valid grade");
		d.dispatch({ type: "answer_graded", at: d.now, itemId: "kp1.i1", grade: 3, confidence: 1 });
		const ev = d.last.find((e): e is Of<"record_evidence"> => e.type === "record_evidence");
		assert.equal(ev?.evidence.graderConfidence, 1);
		assert.ok(Number.isFinite(ev?.evidence.latencyMs));
	});

	test("Evidence always passes learner/fold.ts validation: bad blame rejected, bad warm-up minutes and clocks sanitized", () => {
		const w = { ...warmupItem(), minutesSinceExposure: -5 };
		const d = started({}, [w]);
		assert.equal(runUntil(d, (id) => id === "w1"), "w1");
		d.answerCorrect();
		const warm = d.last.find((e): e is Of<"record_evidence"> => e.type === "record_evidence");
		assert.equal(warm?.evidence.minutesSinceExposure, 1440, "a negative exposure age falls back to the default");
		runUntil(d, (id) => id === "kp1.i1");
		d.dispatch({ type: "answer_submitted", at: d.now, itemId: "kp1.i1", response: { kind: "text", text: "1 kΩ" } });
		d.dispatch({ type: "answer_graded", at: d.now, itemId: "kp1.i1", grade: 0, confidence: 1, attributions: [{ nodeId: NODE_ID, blame: 2 }] });
		assert.equal(d.last[0]?.type, "event_rejected");
		// A clock beyond the Date range would make toISOString() throw while building Evidence.
		assert.doesNotThrow(() => d.dispatch({ type: "answer_graded", at: 1e20, itemId: "kp1.i1", grade: 3, confidence: 1 }));
		const ev = d.last.find((e): e is Of<"record_evidence"> => e.type === "record_evidence");
		assert.ok(ev && !Number.isNaN(Date.parse(ev.evidence.at)));
	});

	test("a wrong first attempt's blame and proposed misconception do not ride on a correct retry", () => {
		const d = started();
		runUntil(d, (id) => id === "kp1.i1");
		d.answerWrong({ attributions: [{ nodeId: NODE_ID, blame: 1, newMisconception: "acha que resistores em série se dividem" }] });
		assert.equal(d.pump(), "kp1.i1");
		d.answerCorrect();
		const ev = d.last.find((e): e is Of<"record_evidence"> => e.type === "record_evidence");
		assert.equal(ev?.evidence.itemId, "kp1.i1");
		assert.equal(ev?.evidence.grade, 2, "right with help");
		assert.equal(ev?.evidence.attributions, undefined, "a correct final answer carries no blame or proposed misconception");
	});

	test("answering while a hint render is pending drops the hint: the next card does not wait for it", () => {
		const d = started();
		runUntil(d, (id) => id === "kp1.i1");
		d.dispatch({ type: "hint_requested", at: d.now, itemId: "kp1.i1" });
		const hint = d.state.pendingRender;
		assert.equal(hint?.budgetPhase, "hint");
		d.answerCorrect(); // grade 3: no feedback render
		assert.equal(d.state.pendingRender, null);
		const next = d.last.find((e): e is Of<"pose_item"> => e.type === "pose_item");
		assert.ok(next && next.itemId !== "kp1.i1", "the next card is posed right away");
		d.dispatch({ type: "phase_rendered", at: d.now, renderId: hint?.renderId ?? "" });
		assert.equal(d.last[0]?.type, "event_rejected", "the stale hint acknowledgment is ignored");
	});

	test("time-up while the recap is on screen keeps the recap (it is the wrap-up itself)", () => {
		const d = started();
		for (let guard = 0; guard < 120 && d.state.status === "active" && d.state.pendingRender?.phase !== "recap"; guard++) {
			if (d.state.pendingRender) d.ack();
			else if (d.state.active?.posed) d.answerCorrect();
			else break;
		}
		const recap = d.state.pendingRender;
		assert.equal(recap?.phase, "recap");
		d.dispatch({ type: "time_up", at: d.now });
		assert.equal(d.state.pendingRender?.renderId, recap?.renderId, "the recap render survives the wrap-up");
		d.ack();
		assert.equal(ended(d)?.outcome, "completed");
		assert.equal(renders(d).filter((r) => r.phase === "recap").length, 1);
	});

	test("a KP that can no longer pass is deferred without posing hopeless items", () => {
		const d = started();
		runUntil(d, (id) => id === "kp1.i1");
		for (let guard = 0; guard < 20 && d.state.status === "active"; guard++) {
			const id = d.pump();
			if (!id) break;
			d.answerWrong();
		}
		assert.equal(ended(d)?.outcome, "deferred");
		const practice = poses(d).filter((p) => p.role === "practice" && p.attempt === 1).map((p) => p.itemId);
		assert.equal(practice.length, 3, `✗✗✗ with one item left cannot end ✓✓; posed: ${practice.join()}`);
	});

	test("plan failure ends the lesson with an error outcome", () => {
		const d = new LessonDriver();
		d.start();
		d.dispatch({ type: "plan_failed", at: T0, reason: "timeout" });
		assert.equal(ended(d)?.outcome, "error");
	});

	test("a warm-up whose id collides with a plan item is namespaced, posed and graded with ITS key", () => {
		// Item ids are authored per node ("kp1.i1"): a warm-up from another node
		// colliding with this plan is the common case, not an error.
		const w = warmupItem();
		const clash = { ...w, item: { ...w.item, id: "kp1.i1" }, key: { ...w.key, itemId: "kp1.i1" } };
		const d = started({}, [clash]);
		assert.equal(d.state.warmups.length, 1);
		const id = `${w.nodeId}/kp1.i1`;
		assert.equal(d.state.warmups[0]?.item.id, id);
		assert.equal(d.state.warmups[0]?.key.itemId, id);
		assert.equal(runUntil(d, (x) => x === id), id);
		assert.equal(d.ref(id).nodeId, w.nodeId);
		d.answer({ kind: "text", text: "2 mA" });
		const ev = d.last.find((e): e is Of<"record_evidence"> => e.type === "record_evidence");
		assert.equal(ev?.evidence.nodes[0]?.nodeId, w.nodeId, "evidence goes to the warm-up's node");
		assert.equal(ev?.evidence.grade, 3, "graded against the warm-up key, not the plan item kp1.i1 (4,3 kΩ)");
		assert.equal(d.state.kps[0]?.results.length, 0, "the plan's KP is untouched");
	});

	test("at most two warm-ups are posed (r1 §6.3 F2: 1–2 items); keyless ones are dropped", () => {
		const w = warmupItem();
		const many = [1, 2, 3].map((n) => ({ ...w, item: { ...w.item, id: `w${n}` }, key: { ...w.key, itemId: `w${n}` } }));
		const mismatched = { ...w, item: { ...w.item, id: "w0" } };
		const d = started({}, [mismatched, ...many]);
		assert.deepEqual(d.state.warmups.map((x) => x.item.id), ["w1", "w2"]);
		runUntil(d, () => false);
		assert.deepEqual(poses(d).filter((p) => p.role === "warmup").map((p) => p.itemId), ["w1", "w2"]);
	});
});

describe("item selection (80–85% target)", () => {
	test("Elo: picks the item whose expected score is closest to 0.825", () => {
		const theta = 1500;
		const itemElo = { "kp1.i1": 1500, "kp1.i2": 1230, "kp1.i3": 1000, "kp1.i4": 1700 };
		const d = started({ theta, itemElo });
		assert.equal(runUntil(d, (id) => id.startsWith("kp1.i")), "kp1.i2");
		assert.ok(Math.abs(expectedScore(theta, 1230) - 0.825) < 0.01);
		d.answerCorrect();
		const ev = d.last.find((e): e is Of<"record_evidence"> => e.type === "record_evidence");
		assert.ok(Math.abs((ev?.evidence.predicted ?? 0) - expectedScore(theta, 1230)) < 1e-12);
	});

	test("accuracy controller", () => {
		const items = [1, 2, 3].map((difficulty) => ({ id: `i${difficulty}`, kind: "short" as const, stem: "?", difficulty: difficulty as 1 | 2 | 3, maxWords: 5 }));
		assert.equal(targetDifficulty({ lastDifficulty: null, lastCorrect: null }, [], items), 1);
		assert.equal(targetDifficulty({ lastDifficulty: 1, lastCorrect: true }, [true, true], items), 2);
		assert.equal(targetDifficulty({ lastDifficulty: 2, lastCorrect: true }, [true, true, false, true, true], items), 2);
		assert.equal(targetDifficulty({ lastDifficulty: 2, lastCorrect: false }, [true, false], items), 1);
		assert.equal(targetDifficulty({ lastDifficulty: 3, lastCorrect: true }, [true], items), 3);
	});
});
