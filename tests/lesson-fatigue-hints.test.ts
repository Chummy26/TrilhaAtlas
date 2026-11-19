/**
 * Hint ladder and fatigue state (docs/impl/lesson.md; SÍNTESE §1.2 P6, P11;
 * §2.4(d); r1 §6.7, §6.8).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fc from "fast-check";
import {
	createFatigueState,
	decideFatigueAction,
	FATIGUE_LADDER,
	fatigueLevel,
	fatigueMessage,
	fatigueSignals,
	recordSample,
	recordSelfReport,
	recordSkip,
	type FatigueState,
} from "../src/core/lesson/fatigue.ts";
import {
	afterCorrectAttempt,
	afterWrongAttempt,
	decideHint,
	evidenceGrade,
	evidenceHints,
	hintText,
	INITIAL_HINT_STATE,
	passCredit,
	type HintState,
} from "../src/core/lesson/hints.ts";
import type { AnswerKey } from "../src/core/lesson/protocol.ts";

const MIN = 60_000;
const key: AnswerKey = {
	itemId: "x",
	answer: { kind: "text", accepted: [], reference: "r", rubric: ["c"] },
	hints: ["pista", "princípio", "próximo passo"],
	solution: ["passo 1", "passo 2"],
	verifiedBy: "key",
};

describe("hint ladder", () => {
	test("cue → principle → next step → solution, never looping", () => {
		let s: HintState = { ...INITIAL_HINT_STATE };
		const kinds: string[] = [];
		for (let i = 0; i < 5; i++) {
			const d = decideHint(s);
			kinds.push(d.kind === "hint" ? `hint${d.level}` : d.kind);
			s = d.state;
		}
		assert.deepEqual(kinds, ["hint1", "hint2", "hint3", "solution", "denied"]);
		assert.equal(s.revealed, true);
		assert.equal(evidenceHints(s), 4);
	});

	test("'show me the answer' before any attempt gives the next rung and arms the reveal", () => {
		const first = decideHint(INITIAL_HINT_STATE, { wantsAnswer: true });
		assert.equal(first.kind, "hint");
		assert.equal(first.state.answerOnNextRequest, true);
		const second = decideHint(first.state, { wantsAnswer: true });
		assert.equal(second.kind === "solution" && second.reason, "request");
	});

	test("'show me the answer' after an attempt reveals at once", () => {
		const tried = afterWrongAttempt(INITIAL_HINT_STATE).state;
		assert.equal(decideHint(tried, { wantsAnswer: true }).kind, "solution");
	});

	test("wrong attempts: the first gives the cue, the second reveals; one-shot roles reveal at once", () => {
		const one = afterWrongAttempt(INITIAL_HINT_STATE);
		assert.deepEqual([one.pointer, one.reveal, one.state.level], [true, false, 1]);
		const two = afterWrongAttempt(one.state);
		assert.deepEqual([two.pointer, two.reveal, two.state.level], [false, true, 4]);
		assert.equal(afterWrongAttempt(INITIAL_HINT_STATE, 1).reveal, true);
		assert.equal(afterWrongAttempt(INITIAL_HINT_STATE, 2, false).pointer, false);
		assert.equal(afterCorrectAttempt(INITIAL_HINT_STATE).attempts, 1);
	});

	test("pass credit needs no rung beyond the principle and no reveal", () => {
		assert.equal(passCredit(true, { ...INITIAL_HINT_STATE, level: 2 }), true);
		assert.equal(passCredit(true, { ...INITIAL_HINT_STATE, level: 3 }), false);
		assert.equal(passCredit(true, { ...INITIAL_HINT_STATE, level: 4, revealed: true }), false);
		assert.equal(passCredit(false, INITIAL_HINT_STATE), false);
	});

	test("evidence grade: help caps at 2, a reveal caps a wrong answer at 1", () => {
		assert.equal(evidenceGrade(3, true, INITIAL_HINT_STATE), 3);
		assert.equal(evidenceGrade(3, true, { ...INITIAL_HINT_STATE, level: 1 }), 2);
		assert.equal(evidenceGrade(3, true, { ...INITIAL_HINT_STATE, attempts: 2 }), 2);
		assert.equal(evidenceGrade(1, false, { ...INITIAL_HINT_STATE, revealed: true, level: 4 }), 1);
		assert.equal(evidenceGrade(0, false, { ...INITIAL_HINT_STATE, revealed: true, level: 4 }), 0);
	});

	test("hint texts come from the key", () => {
		assert.equal(hintText(key, 1), "pista");
		assert.equal(hintText(key, 3), "próximo passo");
		assert.equal(hintText(key, 4), "passo 1\npasso 2");
	});

	test("property: the level never decreases and the ladder ends in ≤4 requests", () => {
		fc.assert(
			fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }), (asks) => {
				let s: HintState = { ...INITIAL_HINT_STATE };
				let revealedAt = -1;
				asks.forEach((wantsAnswer, i) => {
					const d = decideHint(s, { wantsAnswer });
					assert.ok(d.state.level >= s.level);
					if (d.kind === "solution" && revealedAt < 0) revealedAt = i;
					s = d.state;
				});
				if (asks.length >= 4) assert.ok(revealedAt >= 0 && revealedAt <= 3);
			}),
		);
	});
});

describe("fatigue", () => {
	const T = 1_000_000;
	const sample = (s: FatigueState, i: number, latencyMs: number, correct = true, difficulty: 1 | 2 | 3 = 2) => recordSample(s, { at: T + i * 1000, latencyMs, difficulty, correct });

	test("fresh state: no signal", () => {
		const s = createFatigueState(T, 5_000);
		assert.equal(fatigueLevel(fatigueSignals(s, T)), 0);
		assert.equal(decideFatigueAction(s, T), "none");
	});

	test("latency vs the day's baseline (needs ≥3 samples)", () => {
		let s = createFatigueState(T, 5_000);
		s = sample(s, 1, 9_000);
		s = sample(s, 2, 9_000);
		assert.equal(fatigueSignals(s, T).latencyRatio, null);
		s = sample(s, 3, 9_000);
		assert.equal(fatigueSignals(s, T).latencyRatio, 1.8);
		assert.equal(decideFatigueAction(s, T), "switch_format");
	});

	test("without a day baseline, the first three samples are the baseline", () => {
		let s = createFatigueState(T);
		for (const [i, l] of [4_000, 4_000, 4_000, 9_000, 9_000].entries()) s = sample(s, i, l);
		assert.equal(fatigueSignals(s, T).latencyRatio, 1);
		s = sample(s, 6, 9_000);
		assert.ok((fatigueSignals(s, T).latencyRatio ?? 0) >= 1.5);
	});

	test("the derived baseline is frozen: a slow drift past the sample cap still shows", () => {
		let s = createFatigueState(T);
		for (let i = 0; i < 3; i++) s = sample(s, i, 4_000);
		assert.equal(s.baselineLatencyMs, 4_000, "frozen as soon as three latencies exist");
		for (let i = 3; i < 40; i++) s = sample(s, i, 9_000);
		assert.equal(s.baselineLatencyMs, 4_000);
		assert.ok((fatigueSignals(s, T).latencyRatio ?? 0) >= 1.5, "40 slow answers later the slowdown is still visible");
	});

	test("non-finite latencies are ignored for the baseline", () => {
		let s = createFatigueState(T);
		s = sample(s, 0, Number.NaN);
		s = sample(s, 1, Number.POSITIVE_INFINITY);
		for (let i = 2; i < 5; i++) s = sample(s, i, 4_000);
		assert.equal(s.baselineLatencyMs, 4_000);
	});

	test("easy errors and skips stack up the ladder", () => {
		let s = createFatigueState(T, 5_000);
		s = sample(s, 1, 5_000, false, 1);
		s = sample(s, 2, 5_000, false, 1);
		assert.equal(fatigueSignals(s, T).easyErrorsLast5, 2);
		assert.equal(decideFatigueAction(s, T), "switch_format");
		s = recordSkip(recordSkip(s, T), T);
		assert.equal(decideFatigueAction(s, T), "skip_optional");
		s = sample(s, 3, 20_000, true);
		s = sample(s, 4, 20_000, true);
		s = sample(s, 5, 20_000, true);
		assert.equal(decideFatigueAction(s, T), "suggest_break");
	});

	test("frequent \"não sei\" (≥2 of the last 5) is a give-up signal", () => {
		let s = createFatigueState(T, 5_000);
		s = recordSample(s, { at: T + 1, difficulty: 2, correct: false, dontKnow: true });
		assert.equal(decideFatigueAction(s, T + 1), "none");
		s = recordSample(s, { at: T + 2, difficulty: 3, correct: false, dontKnow: true });
		assert.equal(fatigueSignals(s, T + 2).dontKnowLast5, 2);
		assert.equal(decideFatigueAction(s, T + 2), "switch_format");
		for (let i = 3; i <= 6; i++) s = recordSample(s, { at: T + i, difficulty: 2, correct: true });
		assert.equal(fatigueSignals(s, T + 6).dontKnowLast5, 1, "only the last five items count");
	});

	test("block time: break at 45 min, wrap-up at 50; self-report and inactivity", () => {
		const s = createFatigueState(T, 5_000);
		assert.equal(decideFatigueAction(recordSample(s, { at: T + 44 * MIN, difficulty: 2, correct: true }), T + 44 * MIN), "none");
		assert.equal(decideFatigueAction(recordSample(s, { at: T + 46 * MIN, difficulty: 2, correct: true }), T + 46 * MIN), "suggest_break");
		assert.equal(decideFatigueAction(recordSample(s, { at: T + 50 * MIN, difficulty: 2, correct: true }), T + 50 * MIN), "wrap_up");
		assert.equal(decideFatigueAction(recordSelfReport(s, "tired", T), T), "suggest_break");
		assert.equal(decideFatigueAction(s, T + 21 * MIN), "wrap_up");
	});

	test("'ok' clears samples and skips", () => {
		let s = createFatigueState(T, 5_000);
		s = recordSkip(recordSkip(s, T), T);
		s = sample(s, 1, 5_000, false, 1);
		s = recordSelfReport(s, "ok", T + 1);
		assert.equal(s.samples.length, 0);
		assert.equal(s.skipRequests, 0);
		assert.equal(decideFatigueAction(s, T + 2), "none");
	});

	test("every action but none has a pt-BR message", () => {
		for (const action of FATIGUE_LADDER) assert.equal(fatigueMessage(action).length > 0, action !== "none");
	});

	test("property: more skips or easy errors never lower the level", () => {
		fc.assert(
			fc.property(fc.nat({ max: 4 }), fc.nat({ max: 5 }), fc.option(fc.double({ min: 0.5, max: 3, noNaN: true }), { nil: null }), (skips, easy, ratio) => {
				const base = { latencyRatio: ratio, easyErrorsLast5: easy, dontKnowLast5: 0, skipRequests: skips, minutesInBlock: 10, inactiveMinutes: 0, selfReport: null };
				assert.ok(fatigueLevel({ ...base, skipRequests: skips + 1 }) >= fatigueLevel(base));
				assert.ok(fatigueLevel({ ...base, easyErrorsLast5: easy + 1 }) >= fatigueLevel(base));
				assert.ok(fatigueLevel({ ...base, dontKnowLast5: 2 }) >= fatigueLevel(base));
			}),
		);
	});
});
