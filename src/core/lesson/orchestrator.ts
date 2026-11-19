/**
 * Lesson orchestrator: a PURE, event-sourced state machine
 *     reduce(state, event) → { state, effects[] }
 * (docs/research/00-SINTESE.md §1.2 P5–P7, P11, P14; §1.3 "Protocolo de aula
 * por nó"; §2.4(c)(d); r1 §6.3–§6.8, §7).
 *
 * The server owns the state and executes the effects (model calls, storage,
 * UI pushes); this file decides WHAT happens next and never does I/O. Same
 * state + same event → same transition (no clock, no randomness: every event
 * carries `at`, epoch ms). The input state is never mutated.
 *
 * Script (built from the plan at `plan_ready`):
 *   orient → predict? → warmup×n → [segment → socratic?]×1..3 →
 *   [worked → self_explanation? → faded → practice*]×KP → variation? →
 *   recap → closing? → cards → exit, with the `remediate` detour.
 *   The closing exit ticket is posed only when practice left doubt (a failed
 *   or revealed item, r1 §6.9) and the check budget still allows it.
 *
 * Rules enforced here (SÍNTESE P5/P6, r1 §6.4–§6.8):
 *   • No model call without a click (P14): nothing but `learner_clicked_start`
 *     produces `prepare_plan`, and nothing renders before a plan exists.
 *   • A question is ALWAYS a UI card (`pose_item`, `endsTurn: true`) that
 *     ends the turn; prose renders carry `questionAllowed: false`. A
 *     confident correct answer (grade 3) gets no prose follow-up at all.
 *   • Conversational checks (predict, socratic, self-explanation, closing):
 *     ≤3 per node, never two in a row (a practice card must come between),
 *     ≤1 forced check every 3 min, ≤2 turns in a row ending in a question; a
 *     socratic follow-up is exempt from the spacing rules but not the budget.
 *     A check that does not fit is SKIPPED, never squeezed in.
 *   • Hint ladder cue → principle → next step → solution (./hints.ts); the
 *     solution comes after 2 wrong attempts or on request.
 *   • Remediation after a final error that carries a plan misconception, or
 *     after 2 failed items in the KP; at most once per KP. A KP that cannot
 *     pass any more ends the lesson as `deferred` (re-teach differently).
 *   • KP pass rule (MA-like, ./protocol.ts passRuleSatisfied).
 *   • Item choice targets 80–85% success: argmin |E − 0.825| on the Elo-400
 *     scale when the learner θ and item b are known, else an accuracy
 *     controller on the plan's difficulty 1..3.
 *   • Fatigue (./fatigue.ts: latency vs baseline, easy errors, "não sei",
 *     skips, block time) switches format → skips optional steps → suggests a
 *     break → wraps up; time_up / skip lesson wrap up too.
 *   • Wrap-up: recap (only if a KP passed) → cards → exit.
 *   • Learner-model events: `record_exposure` once (before the node's first
 *     Evidence, so the fold applies the lesson transition first), then one
 *     `record_evidence` per finished practice-like card.
 *
 * Keys stay server-side: effects reference items by id and carry
 * toClientItem() projections only; renderRequest()/graderRequest() in
 * ./payloads.ts are the only places that read answer keys for prompts.
 */

import type { Evidence, Grade } from "../learner/types.ts";
import {
	appendTurn,
	describeProseTurn,
	EMPTY_HISTORY,
	questionsLeft,
	questionStreak,
	TURN_BUDGET,
	violatesBudget,
	WORD_BUDGETS,
	type BudgetHistory,
	type BudgetPhase,
	type BudgetViolation,
} from "./budget.ts";
import {
	createFatigueState,
	FATIGUE_LADDER,
	FATIGUE_THRESHOLDS,
	fatigueLevel,
	fatigueMessage,
	fatigueSignals,
	recordActivity,
	recordSample,
	recordSelfReport,
	recordSkip,
	type FatigueAction,
	type FatigueLevel,
	type FatigueSignals,
	type FatigueState,
} from "./fatigue.ts";
import { gradingMethodFor, validateResponse, type GradingMethod, type LearnerResponse } from "./grading.ts";
import { afterCorrectAttempt, afterWrongAttempt, decideHint, evidenceGrade, evidenceHints, INITIAL_HINT_STATE, passCredit, type HintLevel, type HintState } from "./hints.ts";
import {
	CHECK_ROLES,
	findPlanItem,
	itemFormatOf,
	kpExhausted,
	passRuleSatisfied,
	PLAN_LIMITS,
	planItems,
	toClientItem,
	toClientLessonOutline,
	type AnswerKey,
	type ClientItem,
	type ClientLessonOutline,
	type Difficulty,
	type FlashcardCandidate,
	type ItemRole,
	type KnowledgePoint,
	type LessonPlan,
	type Phase,
	type PracticeItem,
	type PracticeItemKind,
	type VariationFormat,
	type WarmupItem,
	type WorkedStep,
} from "./protocol.ts";

// ─── Constants ──────────────────────────────────────────────────────────────

/** ≤1 forced conversational check every 3 minutes (r1 §6.4). */
export const CHECK_MIN_INTERVAL_MS = 3 * 60_000;
/** Target success probability (80–85%, r1 §6.7 / Wilson 2019 band). */
export const TARGET_SUCCESS = 0.825;
export const ACCURACY_BAND = Object.freeze({ lo: 0.8, hi: 0.85 });
/** Warm-up items review earlier nodes: assume ≥1 day since exposure unless told. */
export const WARMUP_DEFAULT_EXPOSURE_MINUTES = 24 * 60;

const RECENT_RESULTS = 5;
const MINUTE = 60_000;
/** Largest |epoch ms| a JavaScript Date accepts. */
const MAX_DATE_MS = 8.64e15;
const ADVANCE_GUARD = 256;

interface RoleRule {
	maxAttempts: number;
	/** Records Evidence for the learner model. */
	evidence: boolean;
	/** The hint ladder is available on this card. */
	hints: boolean;
	phase: Phase;
}

/** Per-role behavior (r1 §6.3 table). Socratic attempts = the segment's maxRounds. */
export const ROLE_RULES: Readonly<Record<ItemRole, Readonly<RoleRule>>> = Object.freeze({
	predict: { maxAttempts: 1, evidence: false, hints: false, phase: "predict" },
	warmup: { maxAttempts: 1, evidence: true, hints: true, phase: "warmup" },
	socratic: { maxAttempts: 2, evidence: false, hints: false, phase: "explain" },
	self_explanation: { maxAttempts: 1, evidence: true, hints: false, phase: "worked" },
	faded: { maxAttempts: 2, evidence: true, hints: true, phase: "faded" },
	practice: { maxAttempts: 2, evidence: true, hints: true, phase: "practice" },
	bridge: { maxAttempts: 2, evidence: true, hints: true, phase: "remediate" },
	variation: { maxAttempts: 1, evidence: true, hints: true, phase: "variation" },
	closing: { maxAttempts: 1, evidence: true, hints: false, phase: "exit" },
});

// ─── Events ─────────────────────────────────────────────────────────────────

export type EvidenceAttribution = NonNullable<Evidence["attributions"]>[number];

/** Evidence minus the fields the server assigns when appending to the domain log. */
export type EvidenceDraft = Omit<Evidence, "id" | "seq" | "domainId" | "sessionId">;

export type LessonEvent =
	| { type: "learner_clicked_start"; at: number }
	| { type: "plan_ready"; at: number; plan: LessonPlan; warmups?: readonly WarmupItem[] }
	| { type: "plan_failed"; at: number; reason: string }
	/**
	 * The pending render was shown and the learner moved on ("continuar"; for
	 * hint/feedback renders, as soon as it is on screen). `text` is what was
	 * shown, after violatesBudget() and the single rewrite: it feeds the
	 * budget history (questions, streak).
	 */
	| { type: "phase_rendered"; at: number; renderId: string; text?: string }
	| { type: "answer_submitted"; at: number; itemId: string; response: LearnerResponse; latencyMs?: number; selfConfidence?: 1 | 2 | 3 }
	| {
			type: "answer_graded";
			at: number;
			itemId: string;
			grade: Grade;
			/** 1 = deterministic. */
			confidence: number;
			misconceptionId?: string | null;
			newMisconception?: string | null;
			attributions?: readonly EvidenceAttribution[];
	  }
	| { type: "hint_requested"; at: number; itemId: string; wantsAnswer?: boolean }
	| { type: "skip_requested"; at: number; scope?: "step" | "lesson" }
	| { type: "fatigue_signal"; at: number; signal: "tick" | "tired" | "ok" }
	| { type: "remediation_needed"; at: number; kpId?: string; misconceptionId?: string }
	| { type: "time_up"; at: number };

export type LessonEventType = LessonEvent["type"];

// ─── Effects ────────────────────────────────────────────────────────────────

/** What a render is about. References only: the server resolves content (and keys) via renderRequest(). */
export type RenderInputs =
	| { kind: "orient" }
	| { kind: "segment"; segmentId: string; index: number; total: number; resolvesPrediction: boolean }
	| { kind: "worked"; kpId: string }
	| {
			kind: "feedback";
			itemId: string;
			role: ItemRole;
			attempt: number;
			correct: boolean;
			grade: Grade;
			/** Include the cue (rung 1) so the learner can retry. */
			pointer: boolean;
			/** Confident error: explain the why in more depth (feedback_elaborate). */
			elaborate: boolean;
			misconceptionId?: string;
			response?: LearnerResponse;
	  }
	| { kind: "hint"; itemId: string; level: 1 | 2 | 3 }
	| { kind: "solution"; itemId: string; role: ItemRole; reason: "attempts" | "request" | "ladder"; elaborate: boolean; misconceptionId?: string; response?: LearnerResponse }
	| { kind: "remediation"; kpId: string; misconceptionId?: string }
	| { kind: "variation"; format: VariationFormat }
	| { kind: "recap"; passedKpIds: string[]; pendingKpIds: string[] };

export type PoseContext =
	| { kind: "faded"; problem: string; given: WorkedStep[]; blankSubgoal: string }
	| { kind: "worked_step"; problem: string; step: WorkedStep }
	| { kind: "variation"; format: VariationFormat; intro: string };

export interface ErrorCardRef {
	itemId: string;
	nodeId: string;
	kpId?: string;
	misconceptionId?: string;
	reason: "misconception" | "high_confidence_error";
}

export type LessonOutcome = "completed" | "deferred" | "time_up" | "fatigue" | "skipped" | "inactive" | "error";

export interface LessonSummary {
	kpsPassed: string[];
	kpsPending: string[];
	answered: number;
	correct: number;
	hintsRequested: number;
	revealed: number;
	checksPosed: number;
	remediations: number;
	skips: number;
	minutes: number;
}

export type LessonEffect =
	| { type: "prepare_plan"; nodeId: string; nodeVersion: number; domainId: string }
	| { type: "render_phase"; renderId: string; phase: Phase; budgetPhase: BudgetPhase; maxWords: number; questionAllowed: false; inputs: RenderInputs }
	| {
			type: "pose_item";
			/** A question is ALWAYS a UI card that ends the tutor's turn (no prose after it). */
			endsTurn: true;
			itemId: string;
			role: ItemRole;
			phase: Phase;
			nodeId: string;
			attempt: number;
			maxAttempts: number;
			hintLevel: HintLevel;
			allowHints: boolean;
			item: ClientItem;
			context?: PoseContext;
	  }
	| { type: "grade_item"; itemId: string; role: ItemRole; nodeId: string; method: GradingMethod; response: LearnerResponse }
	| { type: "record_evidence"; evidence: EvidenceDraft }
	/**
	 * LearnerEvent `exposure` minus the fields the server assigns (BKT lesson
	 * transition, learner/fold.ts). Emitted once per lesson, right before the
	 * node's first Evidence (or at the end when no item followed); `at` is the
	 * first explanation render and `minutes` the time until then.
	 */
	| { type: "record_exposure"; nodeId: string; source: "ai_lesson"; at: string; minutes: number }
	| { type: "propose_cards"; nodeId: string; candidates: FlashcardCandidate[]; errorCards: ErrorCardRef[] }
	| { type: "fatigue_action"; action: FatigueAction; level: FatigueLevel; message: string; signals: FatigueSignals }
	| { type: "end_lesson"; outcome: LessonOutcome; message: string; summary: LessonSummary }
	| { type: "event_rejected"; event: LessonEventType; reason: string; itemId?: string };

// ─── State ──────────────────────────────────────────────────────────────────

export interface LessonInit {
	nodeId: string;
	nodeVersion: number;
	domainId: string;
	/** Learner ability on the Elo-400 scale (convert with learner/elo.ts toElo400). */
	theta?: number;
	/** Calibrated item difficulty b (Elo-400) by item id. */
	itemElo?: Readonly<Record<string, number>>;
	/** Today's median answer latency (ms), for the fatigue baseline. */
	baselineLatencyMs?: number;
	/** When the study block started (epoch ms); default: the click on "start". */
	blockStartedAt?: number;
}

export type LessonStatus = "idle" | "preparing" | "active" | "ended";
export type WrapUpReason = "time_up" | "fatigue" | "skipped" | "deferred";

export type ScriptStep =
	| { kind: "orient" }
	| { kind: "predict" }
	| { kind: "warmup"; index: number }
	| { kind: "segment"; index: number }
	| { kind: "socratic"; segmentIndex: number }
	| { kind: "worked"; kpIndex: number }
	| { kind: "self_explanation" }
	| { kind: "faded"; kpIndex: number }
	| { kind: "practice"; kpIndex: number }
	| { kind: "variation_intro" }
	| { kind: "variation_item" }
	| { kind: "recap" }
	| { kind: "closing" }
	| { kind: "cards" }
	| { kind: "exit" };

export interface ActiveItem {
	itemId: string;
	role: ItemRole;
	/** Node the Evidence goes to (the lesson node, or the warm-up's node). */
	nodeId: string;
	kpId?: string;
	phase: Phase;
	maxAttempts: number;
	/** The card is on screen (false between a feedback render and the re-pose). */
	posed: boolean;
	awaiting: "answer" | "grade";
	posedAt: number;
	hint: HintState;
	response?: LearnerResponse;
	latencyMs?: number;
	selfConfidence?: 1 | 2 | 3;
	lastGrade?: Grade;
	lastConfidence?: number;
	lastMisconceptionId?: string;
	newMisconception?: string;
	attributions?: EvidenceAttribution[];
	/** P(grade ≥ 2) before observing (Elo), for calibration. */
	predicted?: number;
}

export interface PendingRender {
	renderId: string;
	phase: Phase;
	budgetPhase: BudgetPhase;
}

export interface KpProgress {
	id: string;
	/** Practice items already posed (in order). */
	used: string[];
	/** Pass-rule results of finished practice items (correct without rungs 3–4). */
	results: boolean[];
	/** Finished faded/practice items answered wrong. */
	failures: number;
	remediated: boolean;
	passed: boolean;
	exhausted: boolean;
	lastDifficulty: Difficulty | null;
	lastCorrect: boolean | null;
}

export interface Remediation {
	kpId: string;
	misconceptionId?: string;
	stage: "render" | "bridge";
}

export interface LessonStats {
	answered: number;
	correct: number;
	hintsRequested: number;
	revealed: number;
	checksPosed: number;
	remediations: number;
	skips: number;
}

export interface LessonState {
	status: LessonStatus;
	init: LessonInit;
	/** SERVER-ONLY (carries answer keys). Clients get toClientLessonView(). */
	plan: LessonPlan | null;
	warmups: readonly WarmupItem[];
	script: readonly ScriptStep[];
	cursor: number;
	phase: Phase;
	active: ActiveItem | null;
	pendingRender: PendingRender | null;
	renderSeq: number;
	kps: KpProgress[];
	remediation: Remediation | null;
	remediatedMisconceptions: string[];
	observedMisconceptions: string[];
	posedItems: string[];
	prediction: { itemId: string; optionId: string | null } | null;
	variationShown: boolean;
	budget: BudgetHistory;
	lastCheckAt: number | null;
	lastPosedKind: "check" | "practice" | null;
	lastPosedItemKind: PracticeItemKind | null;
	/** Last faded/practice/bridge results (accuracy controller). */
	recentResults: boolean[];
	fatigue: FatigueState;
	fatigueLevel: FatigueLevel;
	formatSwitch: boolean;
	skipOptional: boolean;
	wrapUp: WrapUpReason | null;
	errorCards: ErrorCardRef[];
	stats: LessonStats;
	startedAt: number | null;
	/** First explanation render (Evidence.minutesSinceExposure of the lesson node). */
	exposureAt: number | null;
	/** The `record_exposure` effect was emitted. */
	exposureRecorded: boolean;
	outcome: LessonOutcome | null;
	lastEventAt: number;
}

export interface LessonTransition {
	state: LessonState;
	effects: LessonEffect[];
}

export function createLesson(init: LessonInit): LessonState {
	if (!init.nodeId.trim()) throw new Error("createLesson: nodeId é obrigatório.");
	if (!Number.isInteger(init.nodeVersion) || init.nodeVersion < 1) throw new Error("createLesson: nodeVersion deve ser um inteiro ≥ 1.");
	return {
		status: "idle",
		init: { ...init, ...(init.itemElo ? { itemElo: { ...init.itemElo } } : {}) },
		plan: null,
		warmups: [],
		script: [],
		cursor: 0,
		phase: "prepare",
		active: null,
		pendingRender: null,
		renderSeq: 0,
		kps: [],
		remediation: null,
		remediatedMisconceptions: [],
		observedMisconceptions: [],
		posedItems: [],
		prediction: null,
		variationShown: false,
		budget: EMPTY_HISTORY,
		lastCheckAt: null,
		lastPosedKind: null,
		lastPosedItemKind: null,
		recentResults: [],
		fatigue: createFatigueState(init.blockStartedAt ?? 0, init.baselineLatencyMs ?? null),
		fatigueLevel: 0,
		formatSwitch: false,
		skipOptional: false,
		wrapUp: null,
		errorCards: [],
		stats: { answered: 0, correct: 0, hintsRequested: 0, revealed: 0, checksPosed: 0, remediations: 0, skips: 0 },
		startedAt: null,
		exposureAt: null,
		exposureRecorded: false,
		outcome: null,
		lastEventAt: 0,
	};
}

/** The step list the lesson walks (exported for tests and the client outline). */
export function buildScript(plan: LessonPlan, warmups: readonly WarmupItem[]): ScriptStep[] {
	const steps: ScriptStep[] = [{ kind: "orient" }];
	if (plan.prediction) steps.push({ kind: "predict" });
	warmups.forEach((_, index) => steps.push({ kind: "warmup", index }));
	plan.segments.forEach((segment, index) => {
		steps.push({ kind: "segment", index });
		if (segment.socratic) steps.push({ kind: "socratic", segmentIndex: index });
	});
	plan.knowledgePoints.forEach((kp, kpIndex) => {
		steps.push({ kind: "worked", kpIndex });
		if (plan.selfExplanation?.kpId === kp.id) steps.push({ kind: "self_explanation" });
		steps.push({ kind: "faded", kpIndex }, { kind: "practice", kpIndex });
	});
	if (plan.variation) {
		steps.push({ kind: "variation_intro" });
		if (plan.variation.item) steps.push({ kind: "variation_item" });
	}
	steps.push({ kind: "recap" });
	if (plan.closing) steps.push({ kind: "closing" });
	steps.push({ kind: "cards" }, { kind: "exit" });
	return steps;
}

// ─── Item lookup (server-side) ──────────────────────────────────────────────

export interface LessonItemRef {
	item: PracticeItem;
	/** SERVER-ONLY. */
	key: AnswerKey;
	role: ItemRole;
	nodeId: string;
	kpId?: string;
	misconceptionId?: string;
	minutesSinceExposure?: number;
}

/** Item + key by id (plan items and warm-ups). Server-only: the result carries the key. */
export function lessonItem(state: Pick<LessonState, "plan" | "warmups">, itemId: string): LessonItemRef | null {
	const plan = state.plan;
	if (!plan) return null;
	const ref = findPlanItem(plan, itemId);
	if (ref) {
		const key = plan.answerKeys[itemId];
		if (!key) return null;
		return {
			item: ref.item,
			key,
			role: ref.role,
			nodeId: plan.nodeId,
			...(ref.kpId ? { kpId: ref.kpId } : {}),
			...(ref.misconceptionId ? { misconceptionId: ref.misconceptionId } : {}),
		};
	}
	const warmup = state.warmups.find((w) => w.item.id === itemId);
	if (!warmup) return null;
	return {
		item: warmup.item,
		key: warmup.key,
		role: "warmup",
		nodeId: warmup.nodeId,
		minutesSinceExposure: warmup.minutesSinceExposure ?? WARMUP_DEFAULT_EXPOSURE_MINUTES,
	};
}

/**
 * Warm-ups the lesson will pose (r1 §6.3 F2: 1–2 items): keyless or
 * mismatched entries are dropped, at most PLAN_LIMITS.warmups.max are kept,
 * and an id that collides with a plan item (or an earlier warm-up) is
 * namespaced as `${nodeId}/${itemId}` — item ids are authored per node
 * ("kp1.i2"), so collisions across nodes are the rule, not the exception, and
 * dropping them would silently lose the FIRe review the scheduler planned.
 * The copy keeps item and key consistent (key.itemId follows the new id).
 */
export function usableWarmups(planItemIds: readonly string[], warmups: readonly WarmupItem[]): WarmupItem[] {
	const seen = new Set(planItemIds);
	const usable: WarmupItem[] = [];
	for (const w of warmups) {
		if (usable.length >= PLAN_LIMITS.warmups.max) break;
		if (w.key.itemId !== w.item.id) continue;
		const id = seen.has(w.item.id) ? `${w.nodeId}/${w.item.id}` : w.item.id;
		if (seen.has(id)) continue;
		seen.add(id);
		// Evidence.minutesSinceExposure must be ≥ 0 (learner/fold.ts throws otherwise): a bad value falls back to the default.
		const minutesOk = w.minutesSinceExposure === undefined || (Number.isFinite(w.minutesSinceExposure) && w.minutesSinceExposure >= 0);
		const { minutesSinceExposure: _dropped, ...rest } = w;
		const base: WarmupItem = minutesOk ? w : rest;
		usable.push(id === w.item.id ? base : { ...base, item: { ...w.item, id }, key: { ...w.key, itemId: id } });
	}
	return usable;
}

// ─── Item selection (80–85% target) ─────────────────────────────────────────

/** Elo expected score E = 1 / (1 + 10^((b − θ)/400)). */
export function expectedScore(theta: number, b: number): number {
	return 1 / (1 + 10 ** ((b - theta) / 400));
}

function clampDifficulty(d: number): Difficulty {
	return (d <= 1 ? 1 : d >= 3 ? 3 : Math.round(d)) as Difficulty;
}

/**
 * Accuracy controller (no calibration available): start at the easiest item;
 * after a correct answer go harder only while rolling accuracy is above 85%;
 * after an error go easier only when it fell below 80%.
 */
export function targetDifficulty(progress: Pick<KpProgress, "lastDifficulty" | "lastCorrect">, recent: readonly boolean[], candidates: readonly PracticeItem[]): Difficulty {
	const easiest = clampDifficulty(Math.min(...candidates.map((c) => c.difficulty)));
	if (progress.lastDifficulty === null) return easiest;
	const accuracy = recent.length > 0 ? recent.filter(Boolean).length / recent.length : null;
	if (progress.lastCorrect) return clampDifficulty(accuracy !== null && accuracy > ACCURACY_BAND.hi ? progress.lastDifficulty + 1 : progress.lastDifficulty);
	return clampDifficulty(accuracy !== null && accuracy < ACCURACY_BAND.lo ? progress.lastDifficulty - 1 : progress.lastDifficulty);
}

/** Next practice item of a KP (null = pool empty). Ties keep plan order. */
export function selectPracticeItem(state: LessonState, kp: KnowledgePoint, progress: KpProgress): PracticeItem | null {
	const candidates = kp.items.filter((i) => !progress.used.includes(i.id));
	if (candidates.length === 0) return null;
	const { theta, itemElo } = state.init;
	const sameKindPenalty = (item: PracticeItem): boolean => state.formatSwitch && item.kind === state.lastPosedItemKind;
	let score: (item: PracticeItem) => number;
	if (theta !== undefined && itemElo && candidates.every((c) => typeof itemElo[c.id] === "number")) {
		score = (item) => Math.abs(expectedScore(theta, itemElo[item.id] ?? theta) - TARGET_SUCCESS) + (sameKindPenalty(item) ? 0.05 : 0);
	} else {
		const target = targetDifficulty(progress, state.recentResults, candidates);
		score = (item) => Math.abs(item.difficulty - target) + (sameKindPenalty(item) ? 0.5 : 0);
	}
	let best: PracticeItem | null = null;
	let bestScore = Number.POSITIVE_INFINITY;
	for (const item of candidates) {
		const s = score(item);
		if (s < bestScore) {
			best = item;
			bestScore = s;
		}
	}
	return best;
}

// ─── Reducer plumbing ───────────────────────────────────────────────────────

interface Ctx {
	s: LessonState;
	effects: LessonEffect[];
	at: number;
}

function cloneState(s: LessonState): LessonState {
	return {
		...s,
		active: s.active
			? { ...s.active, hint: { ...s.active.hint }, ...(s.active.attributions ? { attributions: s.active.attributions.map((a) => ({ ...a })) } : {}) }
			: null,
		pendingRender: s.pendingRender ? { ...s.pendingRender } : null,
		kps: s.kps.map((k) => ({ ...k, used: [...k.used], results: [...k.results] })),
		remediation: s.remediation ? { ...s.remediation } : null,
		remediatedMisconceptions: [...s.remediatedMisconceptions],
		observedMisconceptions: [...s.observedMisconceptions],
		posedItems: [...s.posedItems],
		prediction: s.prediction ? { ...s.prediction } : null,
		recentResults: [...s.recentResults],
		errorCards: s.errorCards.map((c) => ({ ...c })),
		stats: { ...s.stats },
	};
}

function emit(ctx: Ctx, effect: LessonEffect): void {
	ctx.effects.push(effect);
}

function reject(ctx: Ctx, event: LessonEventType, reason: string, itemId?: string): void {
	emit(ctx, { type: "event_rejected", event, reason, ...(itemId ? { itemId } : {}) });
}

function isGrade(value: unknown): value is Grade {
	return value === 0 || value === 1 || value === 2 || value === 3;
}

function isValidLatency(value: number | undefined): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function planOf(s: LessonState): LessonPlan {
	if (!s.plan) throw new Error("orchestrator: estado ativo sem plano.");
	return s.plan;
}

/**
 * The transition function. Never throws on learner/server misuse: invalid
 * events come back as `event_rejected` effects with a pt-BR reason and the
 * state unchanged (except the event clock).
 */
export function reduce(state: LessonState, event: LessonEvent): LessonTransition {
	if (state.status === "ended") {
		return { state, effects: [{ type: "event_rejected", event: event.type, reason: "A aula já terminou." }] };
	}
	// Outside ±8.64e15 ms a Date is invalid and toISOString() would throw while
	// building Evidence; such a clock is treated like a missing one.
	const at = Math.max(Number.isFinite(event.at) && Math.abs(event.at) <= MAX_DATE_MS ? event.at : state.lastEventAt, state.lastEventAt);
	const ctx: Ctx = { s: cloneState(state), effects: [], at };
	ctx.s.lastEventAt = at;
	switch (event.type) {
		case "learner_clicked_start":
			onStart(ctx);
			break;
		case "plan_ready":
			onPlanReady(ctx, event.plan, event.warmups ?? []);
			break;
		case "plan_failed":
			if (ctx.s.status !== "preparing") reject(ctx, event.type, "Nenhum plano estava sendo preparado.");
			else endLesson(ctx, "error");
			break;
		case "phase_rendered":
			onRendered(ctx, event.renderId, event.text);
			break;
		case "answer_submitted":
			onSubmitted(ctx, event);
			break;
		case "answer_graded":
			onGraded(ctx, event);
			break;
		case "hint_requested":
			onHint(ctx, event.itemId, event.wantsAnswer ?? false);
			break;
		case "skip_requested":
			onSkip(ctx, event.scope ?? "step");
			break;
		case "fatigue_signal":
			onFatigueSignal(ctx, event.signal);
			break;
		case "remediation_needed":
			onRemediationNeeded(ctx, event.kpId, event.misconceptionId);
			break;
		case "time_up":
			onTimeUp(ctx);
			break;
	}
	return { state: ctx.s, effects: ctx.effects };
}

/** Fold a sequence of events (event-sourcing replay). */
export function replay(init: LessonInit, events: readonly LessonEvent[]): LessonTransition {
	let state = createLesson(init);
	const effects: LessonEffect[] = [];
	for (const event of events) {
		const t = reduce(state, event);
		state = t.state;
		effects.push(...t.effects);
	}
	return { state, effects };
}

// ─── Event handlers ─────────────────────────────────────────────────────────

function onStart(ctx: Ctx): void {
	const s = ctx.s;
	if (s.status !== "idle") return reject(ctx, "learner_clicked_start", "A aula já foi iniciada.");
	s.status = "preparing";
	s.phase = "prepare";
	s.startedAt = ctx.at;
	s.fatigue = s.init.blockStartedAt === undefined ? createFatigueState(ctx.at, s.init.baselineLatencyMs ?? null) : recordActivity(s.fatigue, ctx.at);
	emit(ctx, { type: "prepare_plan", nodeId: s.init.nodeId, nodeVersion: s.init.nodeVersion, domainId: s.init.domainId });
}

function onPlanReady(ctx: Ctx, plan: LessonPlan, warmups: readonly WarmupItem[]): void {
	const s = ctx.s;
	if (s.status !== "preparing") return reject(ctx, "plan_ready", "Nenhum plano estava sendo preparado.");
	if (plan.nodeId !== s.init.nodeId) return reject(ctx, "plan_ready", `O plano é do nó "${plan.nodeId}", não de "${s.init.nodeId}".`);
	const refs = planItems(plan);
	const missing = refs.filter((r) => plan.answerKeys[r.item.id]?.itemId !== r.item.id).map((r) => r.item.id);
	if (missing.length > 0) return reject(ctx, "plan_ready", `Plano sem gabarito para: ${missing.join(", ")}.`);
	s.plan = plan;
	s.warmups = usableWarmups(refs.map((r) => r.item.id), warmups);
	s.script = buildScript(plan, s.warmups);
	s.cursor = 0;
	s.kps = plan.knowledgePoints.map((kp) => ({
		id: kp.id,
		used: [],
		results: [],
		failures: 0,
		remediated: false,
		passed: false,
		exhausted: false,
		lastDifficulty: null,
		lastCorrect: null,
	}));
	s.status = "active";
	advance(ctx);
}

function onRendered(ctx: Ctx, renderId: string, text: string | undefined): void {
	const s = ctx.s;
	const pending = s.pendingRender;
	if (s.status !== "active" || !pending || pending.renderId !== renderId) {
		return reject(ctx, "phase_rendered", "Renderização desconhecida ou já substituída.");
	}
	s.budget = appendTurn(
		s.budget,
		text === undefined ? { phase: pending.budgetPhase, kind: "prose", questions: 0, endedWithQuestion: false } : describeProseTurn(text, pending.budgetPhase),
	);
	s.pendingRender = null;
	s.fatigue = recordActivity(s.fatigue, ctx.at);
	advance(ctx);
}

/** The open card matching `itemId`, or a rejection. */
function openCard(ctx: Ctx, event: LessonEventType, itemId: string): ActiveItem | null {
	const a = ctx.s.active;
	if (ctx.s.status !== "active" || !a || a.itemId !== itemId || !a.posed || a.awaiting !== "answer") {
		reject(ctx, event, "Este cartão não está aguardando resposta.", itemId);
		return null;
	}
	return a;
}

function onSubmitted(ctx: Ctx, e: Extract<LessonEvent, { type: "answer_submitted" }>): void {
	const s = ctx.s;
	const a = openCard(ctx, "answer_submitted", e.itemId);
	if (!a) return;
	const found = lessonItem(s, a.itemId);
	if (!found) return reject(ctx, "answer_submitted", "Item desconhecido.", a.itemId);
	const problem = validateResponse(found.item, e.response);
	if (problem) return reject(ctx, "answer_submitted", problem.message, a.itemId);
	s.fatigue = recordActivity(s.fatigue, ctx.at);
	// While a card is open the only possible pending render is a hint for it:
	// answering makes the hint moot. Left pending, it would either show after
	// the answer or, after a grade-3 answer (no feedback render), hold the
	// next card hostage until its stale acknowledgment arrives.
	s.pendingRender = null;
	if (a.role === "predict") {
		s.prediction = { itemId: a.itemId, optionId: e.response.kind === "choice" ? e.response.optionId : null };
		s.active = null;
		advance(ctx);
		return;
	}
	a.awaiting = "grade";
	a.response = e.response;
	// A client-reported latency that is not a finite, non-negative number would
	// poison Evidence.latencyMs (the learner model takes its logarithm).
	a.latencyMs = isValidLatency(e.latencyMs) ? e.latencyMs : Math.max(0, ctx.at - a.posedAt);
	if (e.selfConfidence !== undefined) a.selfConfidence = e.selfConfidence;
	emit(ctx, { type: "grade_item", itemId: a.itemId, role: a.role, nodeId: a.nodeId, method: gradingMethodFor(found.item, e.response), response: e.response });
}

function onGraded(ctx: Ctx, e: Extract<LessonEvent, { type: "answer_graded" }>): void {
	const s = ctx.s;
	const a = s.active;
	if (s.status !== "active" || !a || a.itemId !== e.itemId || a.awaiting !== "grade") {
		return reject(ctx, "answer_graded", "Nenhuma correção pendente para este item.", e.itemId);
	}
	// The grade becomes Evidence: a value outside 0..3 or a NaN confidence
	// (Math.max(0, NaN) is NaN) would corrupt the learner model downstream.
	if (!isGrade(e.grade)) return reject(ctx, "answer_graded", "Nota inválida: use 0, 1, 2 ou 3.", e.itemId);
	if (typeof e.confidence !== "number" || !Number.isFinite(e.confidence)) {
		return reject(ctx, "answer_graded", "Confiança da correção inválida: use um número entre 0 e 1.", e.itemId);
	}
	// learner/fold.ts rejects (throws on) Evidence whose blame is outside [0,1].
	if (e.attributions?.some((x) => !(typeof x.blame === "number" && x.blame >= 0 && x.blame <= 1) || !x.nodeId)) {
		return reject(ctx, "answer_graded", "Atribuição inválida: cada culpa deve estar entre 0 e 1 e apontar um nó.", e.itemId);
	}
	const grade = e.grade;
	const correct = grade >= 2;
	a.lastGrade = grade;
	a.lastConfidence = Math.min(1, Math.max(0, e.confidence));
	// Diagnosis fields describe THIS grading only (like lastMisconceptionId): a
	// wrong first attempt's blame or proposed misconception must not ride on
	// the Evidence of a correct second attempt (grader.md: "empty list for a
	// correct response").
	delete a.lastMisconceptionId;
	delete a.newMisconception;
	delete a.attributions;
	if (!correct && e.misconceptionId) {
		a.lastMisconceptionId = e.misconceptionId;
		if (!s.observedMisconceptions.includes(e.misconceptionId)) s.observedMisconceptions.push(e.misconceptionId);
	}
	if (!correct && e.newMisconception) a.newMisconception = e.newMisconception;
	if (!correct && e.attributions && e.attributions.length > 0) a.attributions = e.attributions.map((x) => ({ ...x }));

	if (correct) {
		a.hint = afterCorrectAttempt(a.hint);
		finishItem(ctx, a, true);
		if (grade < 3) renderFeedback(ctx, a, true, false, false);
		advance(ctx);
		return;
	}
	let maxAttempts = a.maxAttempts;
	const lastChance = a.hint.attempts + 1;
	if (s.wrapUp) maxAttempts = lastChance;
	else if (a.role === "socratic" && lastChance < maxAttempts && !canPoseCheck(s, ctx.at, true)) maxAttempts = lastChance;
	const wrong = afterWrongAttempt(a.hint, maxAttempts, ROLE_RULES[a.role].hints);
	a.hint = wrong.state;
	const elaborate = a.selfConfidence === 3;
	if (wrong.reveal) {
		finishItem(ctx, a, false);
		renderSolution(ctx, a, "attempts", elaborate);
	} else {
		a.awaiting = "answer";
		a.posed = false;
		renderFeedback(ctx, a, false, wrong.pointer, elaborate);
	}
	advance(ctx);
}

function onHint(ctx: Ctx, itemId: string, wantsAnswer: boolean): void {
	const s = ctx.s;
	const a = openCard(ctx, "hint_requested", itemId);
	if (!a) return;
	if (!ROLE_RULES[a.role].hints) return reject(ctx, "hint_requested", "Dicas não estão disponíveis neste cartão.", itemId);
	const decision = decideHint(a.hint, { wantsAnswer });
	if (decision.kind === "denied") return reject(ctx, "hint_requested", "A solução deste item já foi mostrada.", itemId);
	s.stats.hintsRequested++;
	s.fatigue = recordActivity(s.fatigue, ctx.at);
	a.hint = decision.state;
	if (decision.kind === "hint") {
		emitRender(ctx, a.phase, "hint", { kind: "hint", itemId, level: decision.level });
		return;
	}
	finishItem(ctx, a, false);
	renderSolution(ctx, a, decision.reason === "request" ? "request" : "ladder", false);
	advance(ctx);
}

function onSkip(ctx: Ctx, scope: "step" | "lesson"): void {
	const s = ctx.s;
	if (s.status === "idle") return reject(ctx, "skip_requested", "A aula ainda não começou.");
	if (s.status === "preparing") {
		if (scope === "lesson") endLesson(ctx, "skipped");
		else reject(ctx, "skip_requested", "A aula ainda está sendo preparada.");
		return;
	}
	if (scope === "step" && s.active?.awaiting === "grade") return reject(ctx, "skip_requested", "Aguarde a correção da resposta.", s.active.itemId);
	s.stats.skips++;
	s.fatigue = recordSkip(s.fatigue, ctx.at);
	if (scope === "lesson") {
		enterWrapUp(ctx, "skipped");
	} else if (s.active) {
		// Any pending render while a card is open is about that card (hint/feedback).
		s.active = null;
		s.pendingRender = null;
	} else if (s.pendingRender) {
		s.pendingRender = null;
	}
	evaluateFatigue(ctx);
	advance(ctx);
}

function onFatigueSignal(ctx: Ctx, signal: "tick" | "tired" | "ok"): void {
	const s = ctx.s;
	if (s.status !== "active") return reject(ctx, "fatigue_signal", "Sinais de cansaço só valem durante a aula.");
	if (signal === "tired") {
		s.fatigue = recordSelfReport(s.fatigue, "tired", ctx.at);
	} else if (signal === "ok") {
		// The learner wants to go on: clear the counters and the nudges; the
		// 50-min block cap and inactivity still apply.
		s.fatigue = recordSelfReport(s.fatigue, "ok", ctx.at);
		s.fatigueLevel = Math.min(3, fatigueLevel(fatigueSignals(s.fatigue, ctx.at))) as FatigueLevel;
		s.formatSwitch = false;
		s.skipOptional = false;
	}
	evaluateFatigue(ctx);
	advance(ctx);
}

function onRemediationNeeded(ctx: Ctx, kpId: string | undefined, misconceptionId: string | undefined): void {
	const s = ctx.s;
	if (s.status !== "active") return reject(ctx, "remediation_needed", "Não há aula em andamento.");
	if (s.wrapUp) return reject(ctx, "remediation_needed", "A aula está sendo encerrada; a remediação fica para a próxima sessão.");
	const plan = planOf(s);
	const targetId = kpId ?? s.active?.kpId ?? currentKpId(s) ?? s.kps.find((k) => !k.passed)?.id;
	const kp = s.kps.find((k) => k.id === targetId);
	if (!kp) return reject(ctx, "remediation_needed", "Ponto da aula desconhecido para remediação.");
	if (kp.remediated) return reject(ctx, "remediation_needed", "Este ponto já teve remediação nesta aula.");
	const declared = misconceptionId && plan.misconceptions.some((m) => m.id === misconceptionId) ? misconceptionId : undefined;
	if (!queueRemediation(s, kp, declared)) return reject(ctx, "remediation_needed", "Já existe uma remediação em curso.");
	advance(ctx);
}

function onTimeUp(ctx: Ctx): void {
	const s = ctx.s;
	if (s.status === "idle") return reject(ctx, "time_up", "A aula ainda não começou.");
	if (s.status === "preparing") return endLesson(ctx, "time_up");
	enterWrapUp(ctx, "time_up");
	advance(ctx);
}

// ─── Core transitions ───────────────────────────────────────────────────────

function currentKpId(s: LessonState): string | undefined {
	const step = s.script[s.cursor];
	if (!step || !("kpIndex" in step)) return undefined;
	return s.plan?.knowledgePoints[step.kpIndex]?.id;
}

/**
 * The exit ticket is asked only when practice did not already show the
 * central point (r1 §6.3 F8, §6.9): some KP item failed or a solution had to
 * be revealed. A clean run is its own evidence; asking again would be a
 * check for its own sake.
 */
export function practiceLeftDoubt(s: Pick<LessonState, "kps" | "stats">): boolean {
	return s.stats.revealed > 0 || s.kps.some((k) => k.failures > 0);
}

/** May a conversational check be posed now? (budget, streak, spacing, never two in a row). */
export function canPoseCheck(s: Pick<LessonState, "budget" | "lastPosedKind" | "lastCheckAt">, at: number, followUp = false): boolean {
	if (questionsLeft(s.budget) < 1) return false;
	if (questionStreak(s.budget) >= TURN_BUDGET.maxQuestionStreak) return false;
	if (followUp) return true;
	if (s.lastPosedKind === "check") return false;
	return s.lastCheckAt === null || at - s.lastCheckAt >= CHECK_MIN_INTERVAL_MS;
}

function queueRemediation(s: LessonState, kp: KpProgress, misconceptionId: string | undefined): boolean {
	if (s.wrapUp || s.remediation || kp.remediated) return false;
	kp.remediated = true;
	s.remediation = { kpId: kp.id, stage: "render", ...(misconceptionId ? { misconceptionId } : {}) };
	if (misconceptionId) s.remediatedMisconceptions.push(misconceptionId);
	s.stats.remediations++;
	return true;
}

function emitRender(ctx: Ctx, phase: Phase, budgetPhase: BudgetPhase, inputs: RenderInputs): void {
	const s = ctx.s;
	if (s.status !== "active") return;
	s.renderSeq++;
	const renderId = `r${s.renderSeq}`;
	s.pendingRender = { renderId, phase, budgetPhase };
	s.phase = phase;
	emit(ctx, { type: "render_phase", renderId, phase, budgetPhase, maxWords: WORD_BUDGETS[budgetPhase], questionAllowed: false, inputs });
}

function renderFeedback(ctx: Ctx, a: ActiveItem, correct: boolean, pointer: boolean, elaborate: boolean): void {
	emitRender(ctx, a.phase, elaborate && !correct ? "feedback_elaborate" : "feedback", {
		kind: "feedback",
		itemId: a.itemId,
		role: a.role,
		attempt: a.hint.attempts,
		correct,
		grade: a.lastGrade ?? 0,
		pointer,
		elaborate: elaborate && !correct,
		...(a.lastMisconceptionId ? { misconceptionId: a.lastMisconceptionId } : {}),
		...(a.response ? { response: a.response } : {}),
	});
}

function renderSolution(ctx: Ctx, a: ActiveItem, reason: "attempts" | "request" | "ladder", elaborate: boolean): void {
	emitRender(ctx, a.phase, "solution", {
		kind: "solution",
		itemId: a.itemId,
		role: a.role,
		reason,
		elaborate,
		...(a.lastMisconceptionId ? { misconceptionId: a.lastMisconceptionId } : {}),
		...(a.response ? { response: a.response } : {}),
	});
}

function poseContext(s: LessonState, a: ActiveItem): PoseContext | undefined {
	const plan = planOf(s);
	if (a.role === "faded") {
		const kp = plan.knowledgePoints.find((k) => k.id === a.kpId);
		if (!kp) return undefined;
		return { kind: "faded", problem: kp.fadedSteps.problem, given: kp.fadedSteps.given.map((g) => ({ ...g })), blankSubgoal: kp.fadedSteps.blankSubgoal };
	}
	if (a.role === "self_explanation" && plan.selfExplanation) {
		const kp = plan.knowledgePoints.find((k) => k.id === plan.selfExplanation?.kpId);
		const step = kp?.workedExample.steps[plan.selfExplanation.stepIndex];
		return kp && step ? { kind: "worked_step", problem: kp.workedExample.problem, step: { ...step } } : undefined;
	}
	if (a.role === "variation" && plan.variation) return { kind: "variation", format: plan.variation.format, intro: plan.variation.intro };
	return undefined;
}

function emitPose(ctx: Ctx): void {
	const s = ctx.s;
	const a = s.active;
	if (!a || s.status !== "active") return;
	const found = lessonItem(s, a.itemId);
	if (!found) throw new Error(`orchestrator: item "${a.itemId}" não está no plano.`);
	const check = CHECK_ROLES.has(a.role);
	a.posed = true;
	a.posedAt = ctx.at;
	s.phase = a.phase;
	s.budget = appendTurn(s.budget, { phase: a.phase, kind: check ? "check" : "practice", questions: 1, endedWithQuestion: true, ...(a.role === "socratic" ? { socratic: true } : {}) });
	if (check) {
		s.lastCheckAt = ctx.at;
		s.stats.checksPosed++;
	}
	s.lastPosedKind = check ? "check" : "practice";
	s.lastPosedItemKind = found.item.kind;
	const context = poseContext(s, a);
	emit(ctx, {
		type: "pose_item",
		endsTurn: true,
		itemId: a.itemId,
		role: a.role,
		phase: a.phase,
		nodeId: a.nodeId,
		attempt: a.hint.attempts + 1,
		maxAttempts: a.maxAttempts,
		hintLevel: a.hint.level,
		allowHints: ROLE_RULES[a.role].hints,
		item: toClientItem(found.item),
		...(context ? { context } : {}),
	});
}

function poseNew(ctx: Ctx, item: PracticeItem, role: ItemRole, nodeId: string, kpId?: string, maxAttempts?: number): void {
	const s = ctx.s;
	const { theta, itemElo } = s.init;
	const b = itemElo?.[item.id];
	s.active = {
		itemId: item.id,
		role,
		nodeId,
		...(kpId ? { kpId } : {}),
		phase: ROLE_RULES[role].phase,
		maxAttempts: maxAttempts ?? ROLE_RULES[role].maxAttempts,
		posed: false,
		awaiting: "answer",
		posedAt: ctx.at,
		hint: { ...INITIAL_HINT_STATE },
		...(theta !== undefined && b !== undefined ? { predicted: expectedScore(theta, b) } : {}),
	};
	s.posedItems.push(item.id);
	emitPose(ctx);
}

function defaultLevel(role: ItemRole, difficulty: Difficulty): Evidence["level"] {
	switch (role) {
		case "practice":
			return (difficulty + 1) as Evidence["level"];
		case "self_explanation":
		case "variation":
		case "closing":
			return 3;
		case "predict":
			return 1;
		default:
			return 2;
	}
}

function buildEvidence(s: LessonState, a: ActiveItem, found: LessonItemRef, correct: boolean, at: number): EvidenceDraft {
	const item = found.item;
	const minutes =
		found.minutesSinceExposure !== undefined ? found.minutesSinceExposure : s.exposureAt !== null ? Math.max(0, (at - s.exposureAt) / MINUTE) : 0;
	const spec = found.key.answer;
	const diagnoses =
		spec.kind === "choice" ? [...new Set(Object.values(spec.distractors))].map((misconceptionId) => ({ nodeId: found.nodeId, misconceptionId })) : [];
	let attributions = a.attributions?.map((x) => ({ ...x }));
	if (a.newMisconception) {
		attributions = attributions ?? [];
		const primary = attributions.find((x) => x.nodeId === found.nodeId);
		if (primary) primary.newMisconception = a.newMisconception;
		else attributions.push({ nodeId: found.nodeId, blame: 1, newMisconception: a.newMisconception });
	}
	return {
		at: new Date(at).toISOString(),
		itemId: item.id,
		itemFamily: item.family ?? `${found.nodeId}#${a.kpId ?? a.role}#d${item.difficulty}`,
		nodes: [{ nodeId: found.nodeId, q: 1, primary: true }],
		format: itemFormatOf(item.kind),
		level: item.level ?? defaultLevel(a.role, item.difficulty),
		grade: evidenceGrade(a.lastGrade ?? 0, correct, a.hint),
		graderConfidence: a.lastConfidence ?? 1,
		hints: evidenceHints(a.hint),
		minutesSinceExposure: Math.round(minutes * 100) / 100,
		...(a.latencyMs !== undefined ? { latencyMs: a.latencyMs } : {}),
		...(a.selfConfidence !== undefined ? { selfConfidence: a.selfConfidence } : {}),
		...(a.predicted !== undefined ? { predicted: a.predicted } : {}),
		...(item.kind === "mcq" || item.kind === "minimal_pair" ? { options: item.options.length } : {}),
		...(diagnoses.length > 0 ? { diagnoses } : {}),
		...(attributions && attributions.length > 0 ? { attributions } : {}),
	};
}

/** Close the active item: Evidence, KP progress, error cards, remediation trigger, fatigue. */
function finishItem(ctx: Ctx, a: ActiveItem, correct: boolean): void {
	const s = ctx.s;
	s.active = null;
	const found = lessonItem(s, a.itemId);
	if (!found) return;
	const rule = ROLE_RULES[a.role];
	if (a.hint.revealed) s.stats.revealed++;
	if (rule.evidence) {
		if (found.nodeId === s.init.nodeId) recordExposure(ctx);
		emit(ctx, { type: "record_evidence", evidence: buildEvidence(s, a, found, correct, ctx.at) });
		s.stats.answered++;
		if (correct) s.stats.correct++;
		s.fatigue = recordSample(s.fatigue, {
			at: ctx.at,
			difficulty: found.item.difficulty,
			correct,
			...(a.latencyMs !== undefined ? { latencyMs: a.latencyMs } : {}),
			...(a.response?.kind === "dont_know" ? { dontKnow: true } : {}),
		});
	}
	if (a.role === "faded" || a.role === "practice" || a.role === "bridge") s.recentResults = [...s.recentResults, correct].slice(-RECENT_RESULTS);
	const kp = a.kpId ? s.kps.find((k) => k.id === a.kpId) : undefined;
	const planKp = a.kpId ? s.plan?.knowledgePoints.find((k) => k.id === a.kpId) : undefined;
	if (kp && planKp && a.role === "practice") {
		kp.results.push(passCredit(correct, a.hint));
		kp.lastDifficulty = found.item.difficulty;
		kp.lastCorrect = correct;
		kp.passed = passRuleSatisfied(kp.results, planKp.passRule);
	}
	if (!correct && rule.evidence && (a.lastMisconceptionId || a.selfConfidence === 3) && !s.errorCards.some((c) => c.itemId === a.itemId)) {
		s.errorCards.push({
			itemId: a.itemId,
			nodeId: found.nodeId,
			...(a.kpId ? { kpId: a.kpId } : {}),
			...(a.lastMisconceptionId ? { misconceptionId: a.lastMisconceptionId } : {}),
			reason: a.lastMisconceptionId ? "misconception" : "high_confidence_error",
		});
	}
	if (kp && !correct && (a.role === "practice" || a.role === "faded")) {
		kp.failures++;
		const mis = a.lastMisconceptionId;
		const declared = mis && s.plan?.misconceptions.some((m) => m.id === mis) ? mis : undefined;
		if ((declared && !s.remediatedMisconceptions.includes(declared)) || kp.failures >= 2) queueRemediation(s, kp, declared);
	}
	evaluateFatigue(ctx);
}

function evaluateFatigue(ctx: Ctx): void {
	const s = ctx.s;
	if (s.status !== "active") return;
	const signals = fatigueSignals(s.fatigue, ctx.at);
	const level = fatigueLevel(signals);
	if (level <= s.fatigueLevel) return;
	s.fatigueLevel = level;
	if (level >= 1) s.formatSwitch = true;
	if (level >= 2) s.skipOptional = true;
	const action = FATIGUE_LADDER[level];
	emit(ctx, { type: "fatigue_action", action, level, message: fatigueMessage(action), signals });
	if (level < 4) return;
	if (signals.inactiveMinutes >= FATIGUE_THRESHOLDS.inactivityMinutes) endLesson(ctx, "inactive");
	else enterWrapUp(ctx, "fatigue");
}

function enterWrapUp(ctx: Ctx, reason: WrapUpReason): void {
	const s = ctx.s;
	if (s.status !== "active" || s.wrapUp) return;
	s.wrapUp = reason;
	s.remediation = null;
	if (s.active?.awaiting === "answer") s.active = null;
	// Drop whatever was being shown, EXCEPT the recap: it is the wrap-up's own
	// first step and the cursor is already past it (jumpForWrapUp would not
	// bring it back), so dropping it would end the lesson without a recap.
	if (reason !== "deferred" && s.pendingRender?.phase !== "recap") s.pendingRender = null;
}

function jumpForWrapUp(s: LessonState): void {
	const recap = s.script.findIndex((st) => st.kind === "recap");
	const exit = s.script.findIndex((st) => st.kind === "exit");
	if (recap >= 0 && s.cursor < recap) s.cursor = s.kps.some((k) => k.passed) ? recap : exit;
}

function computeOutcome(s: LessonState): LessonOutcome {
	if (s.kps.length > 0 && s.kps.every((k) => k.passed)) return "completed";
	if (s.wrapUp === "time_up" || s.wrapUp === "fatigue" || s.wrapUp === "skipped") return s.wrapUp;
	return "deferred";
}

const END_MESSAGES: Readonly<Record<LessonOutcome, string>> = Object.freeze({
	completed: "Aula concluída. Os cartões novos entram na sua revisão.",
	deferred: "Este ponto precisa de outra abordagem: ele volta numa próxima sessão com uma explicação diferente.",
	time_up: "Tempo do bloco encerrado. O que ficou pendente volta na próxima sessão.",
	fatigue: "Bloco encerrado para preservar o rendimento. Continuamos depois.",
	skipped: "Aula encerrada a seu pedido. O nó continua disponível.",
	inactive: "Aula pausada por inatividade. Ela fica disponível para retomar.",
	error: "Não foi possível preparar esta aula. Tente de novo em instantes.",
});

function summarize(s: LessonState, at: number): LessonSummary {
	return {
		kpsPassed: s.kps.filter((k) => k.passed).map((k) => k.id),
		kpsPending: s.kps.filter((k) => !k.passed).map((k) => k.id),
		...s.stats,
		minutes: Math.round(((at - (s.startedAt ?? at)) / MINUTE) * 10) / 10,
	};
}

/** Emit the lesson's exposure once, if an explanation was shown. */
function recordExposure(ctx: Ctx): void {
	const s = ctx.s;
	if (s.exposureAt === null || s.exposureRecorded) return;
	s.exposureRecorded = true;
	emit(ctx, {
		type: "record_exposure",
		nodeId: s.init.nodeId,
		source: "ai_lesson",
		at: new Date(s.exposureAt).toISOString(),
		// Engaged time only: an idle tail (inactivity, time-up) is not exposure.
		minutes: Math.round(((Math.max(s.exposureAt, Math.min(ctx.at, s.fatigue.lastActivityAt)) - s.exposureAt) / MINUTE) * 10) / 10,
	});
}

function endLesson(ctx: Ctx, forced?: LessonOutcome): void {
	const s = ctx.s;
	recordExposure(ctx);
	const outcome = forced ?? computeOutcome(s);
	s.status = "ended";
	s.outcome = outcome;
	s.phase = "exit";
	s.active = null;
	s.pendingRender = null;
	s.remediation = null;
	emit(ctx, { type: "end_lesson", outcome, message: END_MESSAGES[outcome], summary: summarize(s, ctx.at) });
}

/** Cards only for what was actually learned or diagnosed (P8: never cards of the unknown). */
function cardCandidates(s: LessonState, plan: LessonPlan): FlashcardCandidate[] {
	const passed = new Set(s.kps.filter((k) => k.passed).map((k) => k.id));
	return plan.flashcardCandidates
		.filter((c) => (c.kpId ? passed.has(c.kpId) : c.misconceptionId ? s.observedMisconceptions.includes(c.misconceptionId) : passed.size > 0))
		.map((c) => ({ ...c, cues: [...c.cues] }));
}

/** Remediation detour; true = something blocking was emitted. */
function stepRemediation(ctx: Ctx, r: Remediation): boolean {
	const s = ctx.s;
	if (r.stage === "render") {
		emitRender(ctx, "remediate", "remediate", { kind: "remediation", kpId: r.kpId, ...(r.misconceptionId ? { misconceptionId: r.misconceptionId } : {}) });
		r.stage = "bridge";
		return true;
	}
	s.remediation = null;
	const bridge = r.misconceptionId ? planOf(s).misconceptions.find((m) => m.id === r.misconceptionId)?.bridgeItem : undefined;
	if (!bridge || s.posedItems.includes(bridge.id)) return false;
	poseNew(ctx, bridge, "bridge", planOf(s).nodeId, r.kpId);
	return true;
}

/** Execute one script step; true = something blocking was emitted (render, card or end). */
function runStep(ctx: Ctx, step: ScriptStep): boolean {
	const s = ctx.s;
	const plan = planOf(s);
	const optionalOk = !s.skipOptional && !s.wrapUp;
	switch (step.kind) {
		case "orient":
			s.cursor++;
			emitRender(ctx, "orient", "orient", { kind: "orient" });
			return true;
		case "predict":
			s.cursor++;
			if (!plan.prediction || !optionalOk || !canPoseCheck(s, ctx.at)) return false;
			poseNew(ctx, plan.prediction, "predict", plan.nodeId);
			return true;
		case "warmup": {
			s.cursor++;
			const w = s.warmups[step.index];
			if (!w || !optionalOk) return false;
			poseNew(ctx, w.item, "warmup", w.nodeId);
			return true;
		}
		case "segment": {
			s.cursor++;
			const segment = plan.segments[step.index];
			if (!segment) return false;
			s.exposureAt = s.exposureAt ?? ctx.at;
			emitRender(ctx, "explain", "explain", {
				kind: "segment",
				segmentId: segment.id,
				index: step.index,
				total: plan.segments.length,
				resolvesPrediction: segment.resolvesPrediction && s.prediction !== null,
			});
			return true;
		}
		case "socratic": {
			s.cursor++;
			const socratic = plan.segments[step.segmentIndex]?.socratic;
			if (!socratic || !optionalOk || !canPoseCheck(s, ctx.at)) return false;
			poseNew(ctx, socratic.item, "socratic", plan.nodeId, undefined, socratic.maxRounds);
			return true;
		}
		case "worked": {
			s.cursor++;
			const kp = plan.knowledgePoints[step.kpIndex];
			if (!kp) return false;
			s.exposureAt = s.exposureAt ?? ctx.at;
			emitRender(ctx, "worked", "worked", { kind: "worked", kpId: kp.id });
			return true;
		}
		case "self_explanation": {
			s.cursor++;
			const se = plan.selfExplanation;
			if (!se || !optionalOk || !canPoseCheck(s, ctx.at)) return false;
			poseNew(ctx, se.item, "self_explanation", plan.nodeId, se.kpId);
			return true;
		}
		case "faded": {
			s.cursor++;
			const kp = plan.knowledgePoints[step.kpIndex];
			if (!kp) return false;
			poseNew(ctx, kp.fadedSteps.blank, "faded", plan.nodeId, kp.id);
			return true;
		}
		case "practice": {
			const kp = plan.knowledgePoints[step.kpIndex];
			const progress = s.kps[step.kpIndex];
			if (!kp || !progress) {
				s.cursor++;
				return false;
			}
			if (progress.passed || passRuleSatisfied(progress.results, kp.passRule)) {
				progress.passed = true;
				s.cursor++;
				return false;
			}
			const next = kpExhausted(progress.used.length, kp.items.length, kp.passRule, progress.results) ? null : selectPracticeItem(s, kp, progress);
			if (!next) {
				progress.exhausted = true;
				enterWrapUp(ctx, "deferred");
				return false;
			}
			progress.used.push(next.id);
			poseNew(ctx, next, "practice", plan.nodeId, kp.id);
			return true;
		}
		case "variation_intro":
			s.cursor++;
			if (!plan.variation || !optionalOk) return false;
			s.variationShown = true;
			emitRender(ctx, "variation", "variation", { kind: "variation", format: plan.variation.format });
			return true;
		case "variation_item": {
			s.cursor++;
			const item = plan.variation?.item;
			if (!item || !s.variationShown || !optionalOk) return false;
			poseNew(ctx, item, "variation", plan.nodeId);
			return true;
		}
		case "recap":
			s.cursor++;
			emitRender(ctx, "recap", "recap", {
				kind: "recap",
				passedKpIds: s.kps.filter((k) => k.passed).map((k) => k.id),
				pendingKpIds: s.kps.filter((k) => !k.passed).map((k) => k.id),
			});
			return true;
		case "closing":
			s.cursor++;
			if (!plan.closing || !optionalOk || !practiceLeftDoubt(s) || !canPoseCheck(s, ctx.at)) return false;
			poseNew(ctx, plan.closing, "closing", plan.nodeId);
			return true;
		case "cards": {
			s.cursor++;
			s.phase = "cards";
			const candidates = cardCandidates(s, plan);
			if (candidates.length > 0 || s.errorCards.length > 0) {
				emit(ctx, { type: "propose_cards", nodeId: plan.nodeId, candidates, errorCards: s.errorCards.map((c) => ({ ...c })) });
			}
			return false;
		}
		case "exit":
			endLesson(ctx);
			return true;
	}
}

/** Walk the script until something blocks (a render, a card, a pending grade) or the lesson ends. */
function advance(ctx: Ctx): void {
	for (let guard = 0; guard < ADVANCE_GUARD; guard++) {
		const s = ctx.s;
		if (s.status !== "active" || s.pendingRender) return;
		if (s.active) {
			if (s.active.awaiting === "answer" && !s.active.posed) emitPose(ctx);
			return;
		}
		if (s.remediation && !s.wrapUp) {
			if (stepRemediation(ctx, s.remediation)) return;
			continue;
		}
		if (s.wrapUp) {
			s.remediation = null;
			jumpForWrapUp(s);
		}
		const step = s.script[s.cursor];
		if (!step) {
			endLesson(ctx);
			return;
		}
		if (runStep(ctx, step)) return;
	}
	throw new Error("orchestrator: advance() não convergiu (script inconsistente).");
}

// ─── Projections and helpers for the server ─────────────────────────────────

export interface ClientLessonView {
	status: LessonStatus;
	phase: Phase;
	outline: ClientLessonOutline | null;
	active: {
		itemId: string;
		role: ItemRole;
		phase: Phase;
		attempt: number;
		maxAttempts: number;
		hintLevel: HintLevel;
		allowHints: boolean;
		awaiting: "answer" | "grade";
		item: ClientItem;
		context?: PoseContext;
	} | null;
	knowledgePoints: Array<{ id: string; title: string; passed: boolean; practiced: number }>;
	prediction: { itemId: string; optionId: string | null } | null;
	fatigueLevel: FatigueLevel;
	wrapUp: WrapUpReason | null;
	outcome: LessonOutcome | null;
}

/** Everything a client may see of the lesson (whitelist; no keys, no hints text, no difficulty). */
export function toClientLessonView(state: LessonState): ClientLessonView {
	const plan = state.plan;
	const a = state.active;
	const found = a && a.posed ? lessonItem(state, a.itemId) : null;
	const context = a && found ? poseContext(state, a) : undefined;
	return {
		status: state.status,
		phase: state.phase,
		outline: plan ? toClientLessonOutline(plan) : null,
		active:
			a && found
				? {
						itemId: a.itemId,
						role: a.role,
						phase: a.phase,
						attempt: a.hint.attempts + 1,
						maxAttempts: a.maxAttempts,
						hintLevel: a.hint.level,
						allowHints: ROLE_RULES[a.role].hints,
						awaiting: a.awaiting,
						item: toClientItem(found.item),
						...(context ? { context } : {}),
					}
				: null,
		knowledgePoints: (plan?.knowledgePoints ?? []).map((kp, i) => ({
			id: kp.id,
			title: kp.title,
			passed: state.kps[i]?.passed ?? false,
			practiced: state.kps[i]?.results.length ?? 0,
		})),
		prediction: state.prediction ? { ...state.prediction } : null,
		fatigueLevel: state.fatigueLevel,
		wrapUp: state.wrapUp,
		outcome: state.outcome,
	};
}

/** Budget history of the current node (for violatesBudget before a render is shown). */
export function budgetHistoryOf(state: LessonState): BudgetHistory {
	return state.budget;
}

/**
 * Check a rendered text against the pending render's budget (server side,
 * before emitting `phase_rendered`). Throws when nothing is being rendered.
 */
export function validateRender(state: LessonState, renderId: string, text: string): BudgetViolation[] {
	const pending = state.pendingRender;
	if (!pending || pending.renderId !== renderId) throw new Error(`validateRender: a renderização "${renderId}" não está pendente.`);
	return violatesBudget(text, pending.budgetPhase, state.budget, { questionAllowed: false });
}
