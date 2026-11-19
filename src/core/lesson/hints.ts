/**
 * Hint ladder and the "never withhold unproductively" rule
 * (docs/research/00-SINTESE.md §1.2 P6, §2.4(c) item 5; r1 §0.10, §6.7).
 *
 *   rung 1  cue (pista)            "Olhe qual corrente passa por R2."
 *   rung 2  principle (princípio)  "Em série, a corrente é a mesma…"
 *   rung 3  next step              "I = 9 V / (1 kΩ + 2 kΩ) = 3 mA."
 *   rung 4  solution               verified steps, then an isomorphic item.
 *
 * Reveal policy (r1 §6.7 escalation table):
 *   • a plain hint request climbs one rung; asking past rung 3 bottoms out
 *     at the solution (the ladder never loops);
 *   • an explicit "show me the answer" reveals it if the learner has tried
 *     at least once (or already holds rung 3); with no attempt yet it gives
 *     the next rung and arms `answerOnNextRequest`, so the NEXT request
 *     reveals it;
 *   • the 2nd wrong attempt reveals the solution automatically;
 *   • a 1st wrong attempt makes the feedback carry the cue (rung 1) — "the
 *     smallest pointer that lets them retry" (r1 §7.4).
 * A KP pass needs correctness without rungs 3–4 (r1 §6.7 pass rule).
 *
 * Pure and browser-safe.
 */

import type { Grade } from "../learner/types.ts";
import type { AnswerKey } from "./protocol.ts";

/** 0 none · 1 cue · 2 principle · 3 next step · 4 solution. */
export type HintLevel = 0 | 1 | 2 | 3 | 4;

export const HINT_RUNGS = ["cue", "principle", "next_step", "solution"] as const;

/** Attempts before the solution is shown automatically. */
export const MAX_ATTEMPTS_BEFORE_SOLUTION = 2;

/** Highest rung that still counts as an independent success for the pass rule. */
export const MAX_RUNG_FOR_PASS_CREDIT = 2;

export interface HintState {
	level: HintLevel;
	attempts: number;
	answerOnNextRequest: boolean;
	revealed: boolean;
}

export const INITIAL_HINT_STATE: Readonly<HintState> = Object.freeze({ level: 0, attempts: 0, answerOnNextRequest: false, revealed: false });

export type HintDecision =
	| { kind: "hint"; level: 1 | 2 | 3; state: HintState }
	| { kind: "solution"; reason: "request" | "ladder_exhausted"; state: HintState }
	| { kind: "denied"; reason: "already_revealed"; state: HintState };

/** What a hint request yields. */
export function decideHint(state: HintState, request: { wantsAnswer?: boolean } = {}): HintDecision {
	if (state.revealed) return { kind: "denied", reason: "already_revealed", state };
	if (request.wantsAnswer) {
		if (state.attempts >= 1 || state.answerOnNextRequest || state.level >= 3) {
			return { kind: "solution", reason: "request", state: { ...state, level: 4, revealed: true } };
		}
		const level = Math.min(3, state.level + 1) as 1 | 2 | 3;
		return { kind: "hint", level, state: { ...state, level, answerOnNextRequest: true } };
	}
	if (state.level >= 3) return { kind: "solution", reason: "ladder_exhausted", state: { ...state, level: 4, revealed: true } };
	const level = (state.level + 1) as 1 | 2 | 3;
	return { kind: "hint", level, state: { ...state, level } };
}

export interface WrongAttemptResult {
	state: HintState;
	/** Show the solution now (attempts exhausted). */
	reveal: boolean;
	/** The feedback should include the cue (first pointer). */
	pointer: boolean;
}

/** Register a wrong attempt. `maxAttempts` defaults to 2; roles with one attempt reveal at once. */
export function afterWrongAttempt(state: HintState, maxAttempts = MAX_ATTEMPTS_BEFORE_SOLUTION, givesPointer = true): WrongAttemptResult {
	const attempts = state.attempts + 1;
	if (attempts >= maxAttempts) return { state: { ...state, attempts, level: 4, revealed: true }, reveal: true, pointer: false };
	const pointer = givesPointer && state.level < 1;
	return { state: { ...state, attempts, level: pointer ? 1 : state.level }, reveal: false, pointer };
}

export function afterCorrectAttempt(state: HintState): HintState {
	return { ...state, attempts: state.attempts + 1 };
}

/** Text of a rung (1–3) or the solution steps (4). */
export function hintText(key: AnswerKey, level: 1 | 2 | 3 | 4): string {
	if (level === 4) return key.solution.join("\n");
	const [cue, principle, nextStep] = key.hints;
	return level === 1 ? cue : level === 2 ? principle : nextStep;
}

/** Hints count recorded in Evidence (4 = the solution was shown). */
export function evidenceHints(state: HintState): number {
	return state.revealed ? 4 : state.level;
}

/** Correct, independent enough to count toward the KP pass rule. */
export function passCredit(correct: boolean, state: HintState): boolean {
	return correct && !state.revealed && state.level <= MAX_RUNG_FOR_PASS_CREDIT;
}

/**
 * Evidence grade from the grader's grade and the help used: a correct answer
 * after a retry or any rung is "right with help" (≤2); a revealed item keeps
 * at most partial credit (≤1).
 */
export function evidenceGrade(rawGrade: Grade, correct: boolean, state: HintState): Grade {
	if (state.revealed && !correct) return Math.min(rawGrade, 1) as Grade;
	if (correct && (state.attempts > 1 || state.level > 0)) return Math.min(rawGrade, 2) as Grade;
	return rawGrade;
}
