/**
 * FSRS-7 scheduling engine for Flashcards.
 *
 * Sources: docs/research/00-SINTESE.md D20/D22 and §2.4(d) item 4;
 * extra-open-spaced-repetition__ts-fsrs.md §8, §14.1 and §14.6; r7 §8.1 and §8.4.
 *
 * - Memory: ts-fsrs@6.0.0 FSRS-7 (34 default weights, dual-trace stability) fed with
 *   exact fractional elapsed time, so same-day reviews count (the reason FSRS-7 beats
 *   FSRS-6 in the srs-benchmark).
 * - Policy: the official middlewares (desired retention, stats, scheduled days,
 *   learning steps, maximum interval, monotonic intervals). Fuzz stays off (the plugin
 *   promises deterministic intervals) and `allowModelOverride` stays off so the
 *   configured learning/relearning steps remain authoritative (ts-fsrs report §15.7).
 * - Calendar adapter (unchanged from the legacy engine): Review intervals are rounded to
 *   whole study days and fall due at the local study-day rollover (`dayStart`, logical
 *   `dueDay`); intraday steps keep their exact due instant.
 * - Migration without loss (§14.6): a legacy FSRS-6 schedule becomes FSRS-7 by replaying
 *   its complete review segment with `Reschedule.replay`. Only memory changes; due,
 *   state, counters and learning step are preserved and the FSRS-6 memory is kept in
 *   `migratedFrom`. A schedule whose history cannot be proven complete stays FSRS-6
 *   (routed by the absent `model` tag) instead of inventing `stabilityFast`.
 * - Invariant (property-tested): folding `rateFsrs7` over a history yields the same
 *   memory as `replayMemory` of that history; `replayMergedSchedule` (review mode
 *   "anki") is exactly that fold over the merged app + Anki log.
 */

import {
	dateChrono,
	defineScheduler,
	schedulerDesiredRetentionMiddleware,
	schedulerLearningStepsMiddleware,
	schedulerMaximumIntervalMiddleware,
	schedulerMonotonicIntervalMiddleware,
	schedulerScheduledDaysMiddleware,
	schedulerStatsMiddleware,
	type Grade,
} from "ts-fsrs";
import { FSRS7_DEFAULT_WEIGHTS, FSRS7Model } from "ts-fsrs/models/fsrs-7";
import { Reschedule } from "ts-fsrs/reschedule";
import legacy from "./scheduler.cjs";

export const FSRS7_MODEL = "fsrs-7";
export const MAXIMUM_INTERVAL_DAYS = 36500;
const DAY_MS = 86_400_000;

export type ScheduleState = 0 | 1 | 2 | 3;
export type ReviewRating = 1 | 2 | 3 | 4;
export type LegacySchedule = legacy.LegacySchedule;
export type SchedulerSettings = legacy.SchedulerSettings;

export interface MemoryState {
	stability: number;
	stabilityFast: number;
	difficulty: number;
}

/** Persisted FSRS-7 schedule: the legacy field names plus `model` and `stabilityFast`. */
export interface Fsrs7Schedule extends MemoryState {
	model: typeof FSRS7_MODEL;
	due: number;
	dueDay?: string;
	/** Fractional days since the previous review, at the latest rating (informational). */
	elapsed_days: number;
	scheduled_days: number;
	reps: number;
	lapses: number;
	learning_steps: number;
	state: ScheduleState;
	last_review: number | null;
	/** FSRS-6 memory replaced by the replay migration, kept for audit. */
	migratedFrom?: { model: "fsrs-6"; stability: number; difficulty: number; migratedAt: number };
}

export type AnySchedule = Fsrs7Schedule | LegacySchedule;

export interface TimedRating {
	rating: ReviewRating;
	at: number;
}

/** The subset of a stored review record that history replay needs. */
export interface StoredReviewLike {
	propositionId?: unknown;
	rating?: unknown;
	at?: unknown;
	before?: { state?: unknown; reps?: unknown } | null;
}

interface ResolvedSettings {
	retention: number;
	learningSteps: readonly number[];
	relearningSteps: readonly number[];
	dayStart: number;
}

const definition = defineScheduler({ model: FSRS7Model, chrono: dateChrono }).use(
	schedulerDesiredRetentionMiddleware,
	schedulerStatsMiddleware,
	schedulerScheduledDaysMiddleware,
	schedulerLearningStepsMiddleware,
	schedulerMaximumIntervalMiddleware,
	schedulerMonotonicIntervalMiddleware,
);
type Fsrs7Scheduler = ReturnType<typeof definition.create>;
type SchedulerCard = Parameters<Fsrs7Scheduler["review"]>[0]["card"];

const schedulers = new Map<string, Fsrs7Scheduler>();
const round8 = (value: number): number => +value.toFixed(8);

export function isFsrs7Schedule(schedule: unknown): schedule is Fsrs7Schedule {
	return typeof schedule === "object" && schedule !== null && (schedule as { model?: unknown }).model === FSRS7_MODEL;
}

function assertTimestamp(now: number): number {
	if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) {
		throw new RangeError("Expected a finite epoch-millisecond timestamp");
	}
	return now;
}

function assertRating(rating: number): asserts rating is ReviewRating {
	if (!Number.isInteger(rating) || rating < 1 || rating > 4) throw new RangeError("rating must be 1–4");
}

function assertSchedule(schedule: { state?: unknown } | null | undefined): void {
	const state = schedule?.state;
	if (typeof state !== "number" || !Number.isInteger(state) || state < 0 || state > 3) {
		throw new RangeError("Invalid schedule state");
	}
}

function stepList(value: readonly number[] | undefined, fallback: readonly number[]): readonly number[] {
	const steps = value ?? fallback;
	if (!Array.isArray(steps) || steps.some((step) => typeof step !== "number" || !Number.isFinite(step) || step <= 0)) {
		throw new RangeError("Learning steps must be arrays of positive minutes");
	}
	return steps;
}

function resolveSettings(settings: SchedulerSettings): ResolvedSettings {
	const retention = settings.retention ?? 0.9;
	if (!Number.isFinite(retention) || retention <= 0 || retention >= 1) {
		throw new RangeError("retention must be in (0, 1) for FSRS-7");
	}
	const dayStart = settings.dayStart ?? 4;
	legacy.dayBounds(Date.UTC(2026, 0, 1), dayStart);
	return {
		retention,
		learningSteps: stepList(settings.learningSteps, [1, 10]),
		relearningSteps: stepList(settings.relearningSteps, [10]),
		dayStart,
	};
}

function schedulerFor(settings: ResolvedSettings): Fsrs7Scheduler {
	const key = JSON.stringify([settings.retention, settings.learningSteps, settings.relearningSteps]);
	let scheduler = schedulers.get(key);
	if (!scheduler) {
		if (schedulers.size >= 16) schedulers.clear();
		scheduler = definition.create({
			config: {
				weights: FSRS7_DEFAULT_WEIGHTS,
				fractionalDays: true,
				desiredRetention: settings.retention,
				enableShortTerm: true,
				learningSteps: settings.learningSteps.map((minutes) => `${minutes}m` as const),
				relearningSteps: settings.relearningSteps.map((minutes) => `${minutes}m` as const),
				graduatingInterval: 1,
				allowModelOverride: false,
				maximumInterval: MAXIMUM_INTERVAL_DAYS,
				clearStatsOnForget: false,
			},
		});
		schedulers.set(key, scheduler);
	}
	return scheduler;
}

/** A step index beyond a shortened step list takes effect when graded (legacy semantics). */
function currentStep(schedule: Fsrs7Schedule, settings: ResolvedSettings): number {
	const steps = schedule.state === 2 || schedule.state === 3 ? settings.relearningSteps : settings.learningSteps;
	const step = schedule.learning_steps || 0;
	return steps.length && step >= steps.length ? steps.length - 1 : step;
}

function toCard(schedule: Fsrs7Schedule, settings: ResolvedSettings): SchedulerCard {
	const status = schedule.state === 0 ? "new" : schedule.state === 2 ? "review" : "learning";
	return {
		stability: schedule.stability,
		stabilityFast: schedule.stabilityFast,
		difficulty: schedule.difficulty,
		state: schedule.state,
		scheduleStatus: status,
		dueAt: new Date(schedule.due),
		lastReviewAt: schedule.last_review == null ? null : new Date(schedule.last_review),
		reps: schedule.reps,
		lapses: schedule.lapses,
		scheduledDays: Math.max(0, schedule.scheduled_days || 0),
		learningStep: currentStep(schedule, settings),
	} as SchedulerCard;
}

export function createFsrs7Schedule(now: number = Date.now()): Fsrs7Schedule {
	return {
		model: FSRS7_MODEL,
		due: assertTimestamp(now),
		stability: 0,
		stabilityFast: 0,
		difficulty: 0,
		elapsed_days: 0,
		scheduled_days: 0,
		reps: 0,
		lapses: 0,
		learning_steps: 0,
		state: 0,
		last_review: null,
	};
}

export function rateFsrs7(schedule: Fsrs7Schedule, rating: number, now: number = Date.now(), settings: SchedulerSettings = {}): Fsrs7Schedule {
	assertTimestamp(now);
	assertRating(rating);
	assertSchedule(schedule);
	if (!isFsrs7Schedule(schedule)) throw new RangeError("Expected an FSRS-7 schedule");
	const options = resolveSettings(settings);
	// A clock moved backwards must not produce a negative elapsed time.
	const at = schedule.last_review == null ? now : Math.max(now, schedule.last_review);
	const { card } = schedulerFor(options).review({ card: toCard(schedule, options), grade: rating as Grade, now: new Date(at) });
	const state = card.state as ScheduleState;
	const next: Fsrs7Schedule = {
		model: FSRS7_MODEL,
		due: card.dueAt.getTime(),
		stability: card.stability,
		stabilityFast: card.stabilityFast,
		difficulty: card.difficulty,
		elapsed_days: schedule.state === 0 || schedule.last_review == null ? 0 : round8((at - schedule.last_review) / DAY_MS),
		scheduled_days: Math.floor(card.scheduledDays),
		reps: card.reps,
		lapses: card.lapses,
		learning_steps: card.learningStep,
		state,
		last_review: at,
		...(schedule.migratedFrom ? { migratedFrom: schedule.migratedFrom } : {}),
	};
	if (state === 2) {
		const days = Math.min(Math.max(Math.round(card.scheduledDays), 1), MAXIMUM_INTERVAL_DAYS);
		next.scheduled_days = days;
		next.due = legacy.reviewDue(at, days, options.dayStart);
		next.dueDay = legacy.studyDay(next.due, options.dayStart);
	}
	return next;
}

export function previewFsrs7(schedule: Fsrs7Schedule, now: number = Date.now(), settings: SchedulerSettings = {}): Record<ReviewRating, Fsrs7Schedule> {
	return {
		1: rateFsrs7(schedule, 1, now, settings),
		2: rateFsrs7(schedule, 2, now, settings),
		3: rateFsrs7(schedule, 3, now, settings),
		4: rateFsrs7(schedule, 4, now, settings),
	};
}

/** Rebuilds FSRS-7 memory from a (sorted or unsorted) review history. */
export function replayMemory(history: readonly TimedRating[]): MemoryState {
	if (!history.length) throw new RangeError("Replay needs at least one review");
	for (const review of history) {
		assertRating(review.rating);
		assertTimestamp(review.at);
	}
	const { memoryState } = new Reschedule(schedulerFor(resolveSettings({}))).replay({
		history: history.map((review) => ({ rating: review.rating as Grade, reviewTime: new Date(review.at) })),
	});
	return { stability: memoryState.stability, stabilityFast: memoryState.stabilityFast, difficulty: memoryState.difficulty };
}

function isValidReview(review: StoredReviewLike): review is StoredReviewLike & TimedRating {
	return typeof review.at === "number" && Number.isFinite(review.at)
		&& typeof review.rating === "number" && Number.isInteger(review.rating) && review.rating >= 1 && review.rating <= 4;
}

/**
 * Returns the replayable history of a legacy schedule: the reviews since its last
 * fresh start (graded from New), only when their count, chaining and final time
 * match the schedule exactly. Anything less is not provably complete → null.
 */
export function completeHistory(schedule: LegacySchedule, reviews: readonly StoredReviewLike[]): TimedRating[] | null {
	if (schedule.state === 0 || !Number.isSafeInteger(schedule.reps) || schedule.reps < 1 || schedule.last_review == null) return null;
	if (reviews.some((review) => !isValidReview(review))) return null;
	const sorted = [...reviews as readonly (StoredReviewLike & TimedRating)[]].sort((a, b) => a.at - b.at);
	let start = -1;
	sorted.forEach((review, index) => { if (review.before?.state === 0) start = index; });
	if (start < 0) return null;
	const segment = sorted.slice(start);
	if (segment.length !== schedule.reps || segment.at(-1)?.at !== schedule.last_review) return null;
	if (segment.some((review, index) => review.before?.reps !== index)) return null;
	return segment.map((review) => ({ rating: review.rating, at: review.at }));
}

/** Converts one legacy schedule; null means "leave unchanged" (already FSRS-7, invalid, or incomplete history). */
export function migrateLegacySchedule(schedule: unknown, reviews: readonly StoredReviewLike[], now: number = Date.now()): Fsrs7Schedule | null {
	if (typeof schedule !== "object" || schedule === null || isFsrs7Schedule(schedule)) return null;
	const candidate = schedule as LegacySchedule;
	if (![0, 1, 2, 3].includes(candidate.state) || typeof candidate.due !== "number") return null;
	if (candidate.state === 0) {
		return { ...candidate, model: FSRS7_MODEL, stability: 0, stabilityFast: 0, difficulty: 0, state: 0 };
	}
	const history = completeHistory(candidate, reviews);
	if (!history) return null;
	return {
		...candidate,
		...replayMemory(history),
		model: FSRS7_MODEL,
		migratedFrom: { model: "fsrs-6", stability: candidate.stability, difficulty: candidate.difficulty, migratedAt: now },
	};
}

interface MigratableStore {
	propositions: Record<string, { id?: string; schedule?: unknown }>;
	reviews: readonly StoredReviewLike[];
}

/**
 * Store-level migration (idempotent). Unreviewed (New) legacy schedules carry no memory
 * and are left as they are: the scheduling facade upgrades them when first graded, so
 * opening a store never rewrites it just to add a tag. Returns how many reviewed
 * schedules were replayed and how many stay FSRS-6 (incomplete history).
 */
export function migrateStoreSchedules(state: MigratableStore, now: number = Date.now()): { migrated: number; legacy: number } {
	const byProposition = new Map<string, StoredReviewLike[]>();
	for (const review of state.reviews) {
		if (typeof review.propositionId !== "string") continue;
		const list = byProposition.get(review.propositionId) ?? [];
		list.push(review);
		byProposition.set(review.propositionId, list);
	}
	let migrated = 0, kept = 0;
	for (const [id, proposition] of Object.entries(state.propositions)) {
		if (!proposition.schedule || isFsrs7Schedule(proposition.schedule) || (proposition.schedule as { state?: unknown }).state === 0) continue;
		const next = migrateLegacySchedule(proposition.schedule, byProposition.get(id) ?? [], now);
		if (next) {
			proposition.schedule = next;
			migrated++;
		} else kept++;
	}
	return { migrated, legacy: kept };
}

/**
 * Rebuilds a proposition's schedule from its merged review log (app + Anki; r7 §8.1
 * "state = replay(revlog)", §8.4) by grading the sorted history from New with the
 * same engine and calendar as live reviews. Memory therefore equals `replayMemory`
 * (property-tested), and state/due/steps/counters are consistent with it: a proposition
 * reviewed only in Anki never stays New with memory attached. The FSRS-6 audit trail
 * (`migratedFrom`) is kept. An empty history leaves the schedule unchanged.
 */
export function replayMergedSchedule<T extends AnySchedule>(schedule: T, history: readonly TimedRating[], settings: SchedulerSettings = {}): T | Fsrs7Schedule {
	if (!history.length) return schedule;
	const sorted = [...history].sort((a, b) => a.at - b.at);
	let next = createFsrs7Schedule((sorted[0] as TimedRating).at);
	for (const review of sorted) next = rateFsrs7(next, review.rating, review.at, settings);
	const migratedFrom = isFsrs7Schedule(schedule) ? schedule.migratedFrom : undefined;
	return migratedFrom ? { ...next, migratedFrom } : next;
}
