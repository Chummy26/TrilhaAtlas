/**
 * Thin wrapper over ts-fsrs@6.0.0 (FSRS-7) for node-level memory
 * (docs/research/extra-open-spaced-repetition__ts-fsrs.md §4, §14.1;
 * r2 §9.4, §9.6b; SÍNTESE §2.6).
 *
 * Scheduler = defineScheduler({ model: FSRS7Model, chrono: dateChrono }) +
 * the 7 preset middlewares in the official order (desiredRetention → fuzzing
 * → stats → scheduledDays → learningSteps → maximumInterval →
 * monotonicInterval) with `fractionalDays: true` (same-day checks), learning
 * and relearning steps ['20m'], fuzz on (deterministic by cardId + reps),
 * maximum interval 1095 d (r2 §9.11). Instances are cached per
 * (weights, desired retention): retention is a scheduler config value and a
 * node's retention depends on its role (0.93 / 0.90 / 0.85).
 *
 * Determinism: every call receives `at` (never the wall clock) and an explicit
 * cardId (`${nodeId}@v${version}`), so newCard never draws a random UUID.
 * Clock skew (at < lastReviewAt) is clamped, never thrown (ts-fsrs pitfall 3).
 *
 * FsrsMemory (types.ts) is the serialized Card with ISO dates; scheduledDays
 * is not persisted (verified not to influence review results) and is rebuilt
 * as (dueAt − lastReviewAt) in days.
 *
 * Implicit credit (r2 §9.6b): with S_good, S_f,good from preview(Good),
 *   S' = S + w(S_good − S), S_f' = S_f + w(S_f,good − S_f),
 *   t'_last = t_last + w(t_now − t_last), D unchanged,
 *   dueAt' = t'_last + scheduler.nextInterval(state', r, {card, Good, elapsed}).
 * w = 0 is the identity; w = 1 reproduces the Good review's S, S_f and t_last
 * (the nextInterval context is the pre-review card) except D, reps and state;
 * its dueAt lands within one day of the Good preview's (D is unchanged and the
 * fuzz is seeded by reps and works in whole days).
 */

import { dateChrono, defineScheduler } from "ts-fsrs";
import {
	schedulerDesiredRetentionMiddleware,
	schedulerFuzzingMiddleware,
	schedulerLearningStepsMiddleware,
	schedulerMaximumIntervalMiddleware,
	schedulerMonotonicIntervalMiddleware,
	schedulerScheduledDaysMiddleware,
	schedulerStatsMiddleware,
} from "ts-fsrs/middlewares";
import { clipFSRS7Parameters, FSRS7_DEFAULT_WEIGHTS, FSRS7Model } from "ts-fsrs/models/fsrs-7";
import type { FsrsRating } from "./bkt-fsrs.ts";
import { clamp01, DAY_MS, toIso, toMs } from "./math.ts";
import { LEARNER_CONSTANTS } from "./params.ts";
import type { FsrsMemory, LearnerParams, NodeId } from "./types.ts";

const definition = defineScheduler({ model: FSRS7Model, chrono: dateChrono }).use(
	schedulerDesiredRetentionMiddleware,
	schedulerFuzzingMiddleware,
	schedulerStatsMiddleware,
	schedulerScheduledDaysMiddleware,
	schedulerLearningStepsMiddleware,
	schedulerMaximumIntervalMiddleware,
	schedulerMonotonicIntervalMiddleware,
);

export type FsrsScheduler = ReturnType<typeof definition.create>;
type SchedulerCard = ReturnType<FsrsScheduler["newCard"]>;
type MemoryState = { stability: number; stabilityFast: number; difficulty: number };

/** FSRS card states (ts-fsrs State). */
export const FSRS_STATE = { new: 0, learning: 1, review: 2, relearning: 3 } as const;

export class FsrsWrapperError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "FsrsWrapperError";
	}
}

const schedulerCache = new Map<string, FsrsScheduler>();

function weightsOf(params: LearnerParams): readonly number[] {
	if (!params.fsrsWeights) return FSRS7_DEFAULT_WEIGHTS;
	if (params.fsrsWeights.length !== 34) {
		throw new FsrsWrapperError(`FSRS-7 exige 34 pesos (recebido ${params.fsrsWeights.length}).`);
	}
	return clipFSRS7Parameters(params.fsrsWeights);
}

/** Cached scheduler for (weights, desired retention ∈ (0,1)). */
export function fsrsScheduler(params: LearnerParams, desiredRetention: number): FsrsScheduler {
	if (!(desiredRetention > 0 && desiredRetention < 1)) {
		throw new FsrsWrapperError(`Retenção desejada deve estar em (0,1): ${desiredRetention}`);
	}
	const weights = weightsOf(params);
	const key = `${weights.join(",")}|${desiredRetention}`;
	const cached = schedulerCache.get(key);
	if (cached) return cached;
	const p = LEARNER_CONSTANTS.fsrs;
	const created = definition.create({
		config: {
			weights,
			fractionalDays: true,
			desiredRetention,
			enableShortTerm: p.enableShortTerm,
			learningSteps: [...p.learningSteps],
			relearningSteps: [...p.relearningSteps],
			allowModelOverride: p.allowModelOverride,
			graduatingInterval: p.graduatingInterval,
			enableFuzz: p.enableFuzz,
			maximumInterval: p.maximumInterval,
			clearStatsOnForget: false,
		},
	});
	schedulerCache.set(key, created);
	return created;
}

/** Stable card id of a node definition. */
export function cardIdFor(nodeId: NodeId, version: number): string {
	return `${nodeId}@v${version}`;
}

function memoryStateOf(mem: Pick<FsrsMemory, "stability" | "stabilityFast" | "difficulty">): MemoryState {
	return { stability: mem.stability, stabilityFast: mem.stabilityFast, difficulty: mem.difficulty };
}

/** FsrsMemory (ISO) → scheduler card (Date). */
export function toSchedulerCard(mem: FsrsMemory): SchedulerCard {
	const dueMs = toMs(mem.dueAt, "dueAt");
	const lastMs = mem.lastReviewAt === undefined ? undefined : toMs(mem.lastReviewAt, "lastReviewAt");
	const scheduledDays = lastMs === undefined ? 0 : Math.max(0, (dueMs - lastMs) / DAY_MS);
	return {
		cardId: mem.cardId,
		state: mem.state,
		scheduleStatus: mem.scheduleStatus,
		stability: mem.stability,
		stabilityFast: mem.stabilityFast,
		difficulty: mem.difficulty,
		dueAt: new Date(dueMs),
		lastReviewAt: lastMs === undefined ? null : new Date(lastMs),
		reps: mem.reps,
		lapses: mem.lapses,
		scheduledDays,
		learningStep: mem.learningStep ?? 0,
	} as SchedulerCard;
}

/** Scheduler card (Date) → FsrsMemory (ISO). */
export function fromSchedulerCard(card: SchedulerCard): FsrsMemory {
	const c = card as unknown as {
		cardId: string | number;
		state: number;
		scheduleStatus: string;
		stability: number;
		stabilityFast: number;
		difficulty: number;
		dueAt: Date;
		lastReviewAt: Date | null;
		reps: number;
		lapses: number;
		learningStep?: number;
	};
	const mem: FsrsMemory = {
		cardId: String(c.cardId),
		state: c.state as FsrsMemory["state"],
		stability: c.stability,
		stabilityFast: c.stabilityFast,
		difficulty: c.difficulty,
		dueAt: c.dueAt.toISOString(),
		reps: c.reps,
		lapses: c.lapses,
		scheduleStatus: c.scheduleStatus,
	};
	if (c.lastReviewAt) mem.lastReviewAt = c.lastReviewAt.toISOString();
	if (c.learningStep !== undefined) mem.learningStep = c.learningStep;
	return mem;
}

/** A fresh (New) card for a node definition. */
export function newMemory(cardId: string, at: string, params: LearnerParams, desiredRetention: number): FsrsMemory {
	const s = fsrsScheduler(params, desiredRetention);
	return fromSchedulerCard(s.newCard({ cardId, now: new Date(toMs(at)) }));
}

/** Clamp the review instant to ≥ lastReviewAt (clock skew must not throw). */
function reviewInstant(mem: FsrsMemory | undefined, at: string): Date {
	const atMs = toMs(at);
	const lastMs = mem?.lastReviewAt === undefined ? -Infinity : toMs(mem.lastReviewAt);
	return new Date(Math.max(atMs, lastMs));
}

/** Fractional days elapsed since the last review (0 when never reviewed). */
export function elapsedDays(mem: FsrsMemory | undefined, at: string): number {
	if (!mem?.lastReviewAt) return 0;
	return Math.max(0, (toMs(at) - toMs(mem.lastReviewAt)) / DAY_MS);
}

/** R(t) of the dual-trace FSRS-7 curve; 1 without a card or for New (r2 §9.4). */
export function retrievability(mem: FsrsMemory | undefined, at: string, params: LearnerParams): number {
	if (!mem || mem.state === FSRS_STATE.new || !mem.lastReviewAt) return 1;
	const s = fsrsScheduler(params, 0.9);
	return clamp01(s.model.forgettingCurve(memoryStateOf(mem), elapsedDays(mem, at)));
}

/** Real review: creates the card when missing, then applies the rating. */
export function reviewMemory(
	mem: FsrsMemory | undefined,
	cardId: string,
	rating: FsrsRating,
	at: string,
	desiredRetention: number,
	params: LearnerParams,
): FsrsMemory {
	const s = fsrsScheduler(params, desiredRetention);
	const now = reviewInstant(mem, at);
	const card = mem ? toSchedulerCard(mem) : s.newCard({ cardId, now });
	return fromSchedulerCard(s.review({ card, grade: rating, now }).card);
}

/** What the card would become with `rating` now (no mutation). */
export function previewMemory(mem: FsrsMemory, rating: FsrsRating, at: string, desiredRetention: number, params: LearnerParams): FsrsMemory {
	const s = fsrsScheduler(params, desiredRetention);
	const now = reviewInstant(mem, at);
	for (const item of s.preview({ card: toSchedulerCard(mem), now })) {
		if ((item.grade as number) === rating) return fromSchedulerCard(item.card);
	}
	throw new FsrsWrapperError(`preview sem a nota ${rating}.`);
}

/**
 * FIRe fractional credit (r2 §9.6b): interpolate the memory state between the
 * current card and its Good preview by w ∈ [0, 1]. D, reps, lapses, state and
 * learning step are kept; dueAt is recomputed through the scheduler policy.
 */
export function interpolateCredit(mem: FsrsMemory, w: number, at: string, desiredRetention: number, params: LearnerParams): FsrsMemory {
	const weight = clamp01(w);
	if (weight === 0 || mem.state === FSRS_STATE.new || !mem.lastReviewAt) return mem;
	const s = fsrsScheduler(params, desiredRetention);
	const now = reviewInstant(mem, at);
	const good = previewMemory(mem, 3, now.toISOString(), desiredRetention, params);
	const lastMs = toMs(mem.lastReviewAt);
	const nowMs = now.getTime();
	const state: MemoryState = {
		stability: mem.stability + weight * (good.stability - mem.stability),
		stabilityFast: mem.stabilityFast + weight * (good.stabilityFast - mem.stabilityFast),
		difficulty: mem.difficulty,
	};
	const newLastMs = lastMs + weight * (nowMs - lastMs);
	const interval = s.nextInterval(state, desiredRetention, {
		card: toSchedulerCard(mem),
		grade: 3,
		elapsedDays: (nowMs - lastMs) / DAY_MS,
	});
	return {
		...mem,
		stability: state.stability,
		stabilityFast: state.stabilityFast,
		lastReviewAt: toIso(newLastMs),
		dueAt: toIso(newLastMs + interval * DAY_MS),
	};
}

/** due ← now + factor·(due − now) when due is in the future (r2 §9.6c penalties). */
export function shortenDue(mem: FsrsMemory, factor: number, at: string): FsrsMemory {
	const atMs = toMs(at);
	const dueMs = toMs(mem.dueAt, "dueAt");
	if (dueMs <= atMs) return mem;
	const f = clamp01(factor);
	if (f === 1) return mem;
	return { ...mem, dueAt: toIso(atMs + f * (dueMs - atMs)) };
}

export function isDueAt(mem: FsrsMemory, at: string): boolean {
	return toMs(mem.dueAt, "dueAt") <= toMs(at);
}

/** "Equivalent stability" for the UI: days until R falls to `retention` (model, no policy). */
export function intervalDays(mem: FsrsMemory, retention: number, params: LearnerParams): number {
	if (mem.state === FSRS_STATE.new) return 0;
	return fsrsScheduler(params, 0.9).model.nextInterval(memoryStateOf(mem), retention);
}
