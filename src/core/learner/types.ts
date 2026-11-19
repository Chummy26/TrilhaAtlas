/**
 * Learner model contracts (docs/research/00-SINTESE.md §2.6; r2 §9; r10 §3.5).
 *
 * The learner state of a domain is a PURE FOLD over an append-only Evidence
 * log (event sourcing): replayable, auditable, deterministic. The LLM is only
 * a SENSOR (rubric grade 0–3 + confidence + attributions), never a predictor.
 *
 * Per node:  BKT latent L ("acquired") × FSRS-7 availability M ("retrievable
 * now"): P(knows now) = pL · R_FSRS(t).
 *
 * State definitions (each threshold has ONE role — §2.6 table):
 *   attainedAt  — first time pL ≥ 0.85 WITH direct evidence. MONOTONIC: never
 *                 cleared by failures; only a node DEFINITION change (version
 *                 bump) resets it. Drives structural unlocking (frontier).
 *   readiness   — all prerequisites with pL·R ≥ 0.85; failing it schedules a
 *                 warm-up, it NEVER re-locks content.
 *   masteredAt  — pL ≥ 0.95 ∧ ≥2 distinct correct items ∧ ≥1 delayed (≥24 h)
 *                 hint-free success. Badges, FIRe vehicles, tier cores.
 *   demonstrated— a summative checkpoint passed.
 *   retained    — R ≥ 0.7 (tiers).
 *
 * Pure types: browser-safe.
 */

import type { DomainId } from "../domains/types.ts";

export type NodeId = string;

/** 0 wrong · 1 partial (core wrong) · 2 right with help/hesitation · 3 right. */
export type Grade = 0 | 1 | 2 | 3;

export type ItemFormat = "mcq" | "numeric" | "short" | "derivation" | "explain" | "flashcard" | "dialogue" | "dictation" | "speak" | "sim";

/** ~Bloom: 1 recall · 2 understand · 3 apply · 4 analyze · 5 transfer. */
export type ItemLevel = 1 | 2 | 3 | 4 | 5;

/** Mirrors ts-fsrs v6 (FSRS-7) Card, serialized (ISO dates). */
export interface FsrsMemory {
	cardId: string;
	/** 0 New · 1 Learning · 2 Review · 3 Relearning */
	state: 0 | 1 | 2 | 3;
	stability: number;
	stabilityFast: number;
	difficulty: number;
	lastReviewAt?: string;
	dueAt: string;
	reps: number;
	lapses: number;
	learningStep?: number;
	scheduleStatus: string;
}

export interface MisconceptionBelief {
	/** Beta posterior (prior Beta(1,4)). Active if a/(a+b) ≥ 0.5; resolved if < 0.2 after remediation. */
	a: number;
	b: number;
	lastSeenAt: string;
	text: string;
}

export interface NodeState {
	nodeId: NodeId;
	/** Node definition version this state belongs to (reset on bump). */
	nodeVersion: number;
	/** P(acquired) — BKT. */
	pL: number;
	/** Effective evidence count (weight in consistency projection). */
	nEff: number;
	/** Has direct evidence (not only inferred / propagated). */
	verified: boolean;
	/** Created at the first retrieval attempt. */
	fsrs?: FsrsMemory;
	/** 0.85–0.93 depending on the node's role relative to the frontier. */
	desiredRetention: number;
	/** Elo difficulty b per item level 1..5 (index 0 = level 1). */
	levelElo: number[];
	/** Decayed blame mass (half-life 14 d). */
	blame: number;
	blameAt?: string;
	misconceptions: Record<string, MisconceptionBelief>;
	/** Distinct item families answered correctly. */
	correctFamilies: string[];
	/** Successes with delayed (≥24 h) hint-free retrieval. */
	delayedSuccesses: number;
	lastEvidenceAt?: string;
	/** MONOTONIC (see header). */
	attainedAt?: string;
	masteredAt?: string;
	demonstratedAt?: string;
	/** Inferred by diagnosis/propagation without direct check. */
	inferred?: boolean;
	/**
	 * (addition: learner module) First time a diagnostic placement estimated
	 * pL ≥ attainThreshold for this still-unverified node. MONOTONIC like
	 * attainedAt; unlocks structurally but the node stays `inferred` (probe).
	 */
	placedAt?: string;
	/** (addition: learner module) FIRe ledger of implicit credit since the last real review (r2 §9.6b; mathua §7.1). */
	fire?: FireLedger;
	/** (addition: learner module) Running mean of ln(latencyMs) — median proxy for the Easy rating (r2 §9.4). */
	latency?: { logMean: number; n: number };
	/**
	 * (addition: learner module) Instant of the last folded `exposure` event
	 * (lesson/video/book) on this node. Restarts the delayed-retrieval clock and
	 * the "immediate" emission regime even when the evidence's
	 * minutesSinceExposure is stale (tutor-mcp "Retained": any instruction
	 * resets the clock).
	 */
	lastExposureAt?: string;
}

/**
 * (addition: learner module) Integer micro-unit ledger (Micro = 1_000_000 =
 * one implicit repetition). `epoch` = the card's real-review count (`reps`)
 * when the units were applied; a real review opens a new epoch (units → 0).
 * Invariant: 0 ≤ units ≤ MaxBank·Micro, integer.
 */
export interface FireLedger {
	epoch: number;
	units: number;
}

/** (addition: learner module) FIRe rollout mode — unknown values parse to "shadow" (fail-closed, mathua §7.3). */
export type FireMode = "off" | "shadow" | "active";

export interface EvidenceNodeRef {
	nodeId: NodeId;
	/** Q-vector entry: probability this node is really needed (0,1]. */
	q: number;
	primary?: boolean;
}

export interface Evidence {
	/** The lesson earning credit for this check (legacy logs omit it). */
	lessonExposureId?: string;
	/** Bounded visible quiz text used to diagnose repeated mistakes. */
	quizContext?: { question: string; answer: string; expected?: string };
	id: string;
	/** Monotonic sequence inside the domain log. */
	seq: number;
	at: string;
	domainId: DomainId;
	sessionId: string;
	itemId: string;
	/** e.g. `${nodeId}#L3` — distinct families count toward mastery. */
	itemFamily: string;
	nodes: EvidenceNodeRef[];
	format: ItemFormat;
	level: ItemLevel;
	grade: Grade;
	/** 0..1; 1 = deterministic grading. */
	graderConfidence: number;
	hints: number;
	latencyMs?: number;
	selfConfidence?: 1 | 2 | 3;
	/** Minutes since the last exposure (lesson) to the primary node. ≤20 = "immediate" (weak evidence). */
	minutesSinceExposure: number;
	attributions?: { nodeId: NodeId; blame: number; misconceptionId?: string; newMisconception?: string }[];
	/** P(grade ≥ 2) recorded BEFORE observing (calibration). */
	predicted?: number;
	/** Evidence weight (flashcard = 0.3). Default 1. */
	weight?: number;
	/** Summative checkpoint item. */
	summative?: boolean;
	/** (addition: learner module) MCQ option count k (emission 1/k). Default 4. */
	options?: number;
	/**
	 * (addition: learner module) Misconceptions this item can reveal (its
	 * distractors). A correct answer adds b += 1 to each (r2 §9.10).
	 */
	diagnoses?: { nodeId: NodeId; misconceptionId: string }[];
}

/** Non-graded learning events folded into the model (lesson exposure, implicit credit). */
export type LearnerEvent =
	| { kind: "evidence"; evidence: Evidence }
	| { kind: "exposure"; id: string; seq: number; at: string; domainId: DomainId; sessionId: string; nodeId: NodeId; source: "ai_lesson" | "video" | "book" | "article"; minutes: number; exploratory?: boolean }
	| { kind: "implicit-credit"; id: string; seq: number; at: string; domainId: DomainId; fromNodeId: NodeId; toNodeId: NodeId; w: number }
	| { kind: "diagnostic"; id: string; seq: number; at: string; domainId: DomainId; estimates: { nodeId: NodeId; p: number }[] }
	| { kind: "node-version"; id: string; seq: number; at: string; domainId: DomainId; nodeId: NodeId; version: number };

export interface EmissionParams {
	/** P(grade | knows) for open/delayed answers, index = grade. */
	e1: [number, number, number, number];
	/** P(grade | doesn't know) delayed. */
	e0: [number, number, number, number];
	/** P(grade | doesn't know) immediate (≤ immediateMinutes after exposure). */
	e0Immediate: [number, number, number, number];
	immediateMinutes: number;
}

export interface LearnerParams {
	emission: EmissionParams;
	tLesson: number;
	tPractice: number;
	attainThreshold: number; // 0.85
	masteryThreshold: number; // 0.95
	readinessThreshold: number; // 0.85
	retainedR: number; // 0.7
	consistencyEps: number; // 0.05
	llmAttributionLambda: number; // 1.5
	blameHalfLifeDays: number; // 14
	propagationHops: number; // ≤3
	fireMinWeight: number; // 0.1
	desiredRetention: { frontierPrereq: number; default: number; distantLeaf: number };
	planner: { reviewShare: number; maxNewPerDay: number; gamma: number; alphaGoal: number; betaDesc: number; avgNewMinutes: number };
	/** FSRS-7 weights override (after per-domain optimization). */
	fsrsWeights?: number[];
	/** (addition: learner module) FIRe rollout mode; default "active". */
	fireMode?: FireMode;
}

export interface LearnerSnapshot {
	schemaVersion: 1;
	domainId: DomainId;
	/** Last folded event seq. */
	seq: number;
	nodes: Record<NodeId, NodeState>;
	/** Global Elo-like ability for the domain. */
	theta: number;
	thetaN: number;
	/** Learning-speed multiplier (≈1). */
	speed: number;
	updatedAt: string;
}

export type NodeStatus = "locked" | "frontier" | "learning" | "attained" | "mastered" | "review_due" | "weak" | "inferred";

export type PlanItemKind = "review" | "vehicle" | "new" | "remediate" | "probe";

export interface PlanItem {
	kind: PlanItemKind;
	nodeId: NodeId;
	estMinutes: number;
	value: number;
	/** Human-readable (pt-BR) one-liner, shown collapsed. */
	reason: string;
	/** For vehicles: due nodes implicitly reviewed. */
	covers?: NodeId[];
}

export interface StudyPlan {
	domainId: DomainId;
	date: string;
	budgetMin: number;
	items: PlanItem[];
	/** The single suggestion surfaced on "Hoje". */
	next: PlanItem | null;
	reviewMinutes: number;
	newMinutes: number;
}

/** ~300-token learner snapshot for prompts (r2 §9.14). */
export interface LearnerPromptSnapshot {
	frontier: { nodeId: NodeId; title: string; readiness: number }[];
	topMastered: { nodeId: NodeId; title: string }[];
	weak: { nodeId: NodeId; title: string; misconception?: string }[];
	dueReviews: number;
	todayPlan: string[];
}
