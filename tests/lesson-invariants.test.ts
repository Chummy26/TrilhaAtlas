/**
 * Orchestrator invariants under random learner behavior (docs/impl/lesson.md;
 * SÍNTESE §1.2 P2/P5–P7/P12, §2.4(c); r1 §6.4, §6.7). A fast-check driver
 * answers right or wrong, asks for hints or the answer, says "não sei",
 * skips steps or the lesson, lets time pass or runs out of session time;
 * after every event the
 * invariants the rest of the system relies on must hold:
 *
 *   • every Evidence passes the checks of learner/fold.ts validateEvidence
 *     (which THROWS on a bad grade, confidence, level, blame or clock);
 *   • conversational checks: ≤3 per node, never two first-attempt checks in
 *     a row, ≥3 min apart; prose renders never allow a question;
 *   • nothing a client receives carries key material;
 *   • the lesson always ends (no stuck state, no runaway loop).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fc from "fast-check";
import { CHECK_MIN_INTERVAL_MS, toClientLessonView, type EvidenceDraft, type LessonEffect } from "../src/core/lesson/orchestrator.ts";
import { CHECK_ROLES, type ItemRole } from "../src/core/lesson/protocol.ts";
import { assertNoKeyMaterial, compiledPlan, LessonDriver, warmupItem } from "./lesson-fixtures.ts";

/** Mirror of learner/fold.ts validateEvidence (not exported there). */
function assertFoldable(ev: EvidenceDraft): void {
	assert.ok([0, 1, 2, 3].includes(ev.grade), `grade ${ev.grade}`);
	assert.ok([1, 2, 3, 4, 5].includes(ev.level), `level ${ev.level}`);
	assert.ok(ev.nodes.length > 0 && ev.nodes.every((r) => r.q > 0 && r.q <= 1), "Q vector");
	assert.ok(ev.graderConfidence >= 0 && ev.graderConfidence <= 1, `graderConfidence ${ev.graderConfidence}`);
	assert.ok(Number.isInteger(ev.hints) && ev.hints >= 0, `hints ${ev.hints}`);
	assert.ok(ev.minutesSinceExposure >= 0, `minutesSinceExposure ${ev.minutesSinceExposure}`);
	for (const a of ev.attributions ?? []) assert.ok(a.blame >= 0 && a.blame <= 1, `blame ${a.blame}`);
	assert.ok(!Number.isNaN(Date.parse(ev.at)), `at ${ev.at}`);
	if (ev.latencyMs !== undefined) assert.ok(Number.isFinite(ev.latencyMs) && ev.latencyMs >= 0, `latencyMs ${ev.latencyMs}`);
}

type Action = "right" | "wrong" | "hint" | "answer" | "dont_know" | "skip" | "tick" | "quit";
const ACTIONS: Action[] = ["right", "right", "right", "wrong", "wrong", "hint", "answer", "dont_know", "skip", "tick"];

function runRandomLesson(choices: readonly number[], quitAt: number | null, withClash: boolean): LessonDriver {
	const d = new LessonDriver();
	d.freeze = true;
	d.start();
	const w = warmupItem();
	const warmups = withClash ? [w, { ...w, item: { ...w.item, id: "kp1.i1" }, key: { ...w.key, itemId: "kp1.i1" } }] : [w];
	d.ready(compiledPlan(), warmups);
	let step = 0;
	for (let guard = 0; guard < 400 && d.state.status === "active"; guard++) {
		assertNoKeyMaterial(toClientLessonView(d.state), "client view");
		if (d.state.pendingRender) {
			d.ack();
			continue;
		}
		const a = d.state.active;
		if (!a || !a.posed || a.awaiting !== "answer") throw new Error(`stuck: no render and no open card (cursor ${d.state.cursor})`);
		const action: Action = quitAt !== null && step === quitAt ? "quit" : (ACTIONS[(choices[step % choices.length] ?? 0) % ACTIONS.length] ?? "right");
		step++;
		switch (action) {
			case "right":
				d.answerCorrect({ selfConfidence: 2 });
				break;
			case "wrong":
				d.answerWrong({ selfConfidence: step % 3 === 0 ? 3 : 1 });
				break;
			case "hint":
				d.dispatch({ type: "hint_requested", at: d.tick(5_000).now, itemId: a.itemId });
				break;
			case "answer":
				d.dispatch({ type: "hint_requested", at: d.tick(5_000).now, itemId: a.itemId, wantsAnswer: true });
				break;
			case "dont_know":
				d.answer({ kind: "dont_know" });
				break;
			case "skip":
				d.dispatch({ type: "skip_requested", at: d.tick(2_000).now, scope: "step" });
				break;
			case "tick":
				d.dispatch({ type: "fatigue_signal", at: d.tick(60_000).now, signal: "tick" });
				break;
			case "quit":
				// Alternate between the learner leaving and the session clock running out.
				if (step % 2 === 0) d.dispatch({ type: "skip_requested", at: d.tick(1_000).now, scope: "lesson" });
				else d.dispatch({ type: "time_up", at: d.tick(1_000).now });
				break;
		}
		// A refused action (e.g. a hint on a check card) leaves the card open: answer it instead.
		if (d.last.length === 1 && d.last[0]?.type === "event_rejected" && d.state.active?.awaiting === "answer" && d.state.active.posed) d.answerCorrect();
	}
	return d;
}

function checkInvariants(d: LessonDriver): void {
	assert.equal(d.state.status, "ended", "the lesson always ends");
	for (const e of d.effectsOf("record_evidence")) assertFoldable(e.evidence);
	for (const r of d.effectsOf("render_phase")) assert.equal(r.questionAllowed, false);
	for (const p of d.effectsOf("pose_item")) {
		assert.equal(p.endsTurn, true);
		assertNoKeyMaterial(p.item, `pose ${p.itemId}`);
	}
	const checkPoses = d.timeline.flatMap(({ at, effects }) =>
		effects.filter((e): e is Extract<LessonEffect, { type: "pose_item" }> => e.type === "pose_item" && CHECK_ROLES.has(e.role)).map((e) => ({ at, attempt: e.attempt })),
	);
	assert.ok(checkPoses.length <= 3, `${checkPoses.length} conversational checks in one node`);
	const firsts = checkPoses.filter((c) => c.attempt === 1);
	for (let i = 1; i < firsts.length; i++) assert.ok((firsts[i]?.at ?? 0) - (firsts[i - 1]?.at ?? 0) >= CHECK_MIN_INTERVAL_MS, "checks ≥3 min apart");
	const roles = d.effectsOf("pose_item").filter((p) => p.attempt === 1).map((p) => p.role);
	for (let i = 1; i < roles.length; i++) {
		assert.ok(!(CHECK_ROLES.has(roles[i] as ItemRole) && CHECK_ROLES.has(roles[i - 1] as ItemRole)), `two checks in a row: ${roles.join()}`);
	}
	assert.equal(d.effectsOf("end_lesson").length, 1);
	const exposure = d.effectsOf("record_exposure");
	assert.ok(exposure.length <= 1, "one exposure per lesson");
}

describe("orchestrator invariants under random behavior", () => {
	test("property: evidence is foldable, checks are budgeted, nothing leaks, the lesson ends", () => {
		fc.assert(
			fc.property(
				fc.array(fc.nat({ max: 999 }), { minLength: 1, maxLength: 60 }),
				fc.option(fc.nat({ max: 40 }), { nil: null }),
				fc.boolean(),
				(choices, quitAt, withClash) => {
					checkInvariants(runRandomLesson(choices, quitAt, withClash));
				},
			),
			{ numRuns: 120 },
		);
	});
});
