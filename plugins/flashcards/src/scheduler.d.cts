// Type declarations for the legacy FSRS-6 engine and study-day calendar in
// scheduler.cjs (plugin-local JavaScript, adapted from ts-fsrs@5.2.3). The
// FSRS-7 engine (fsrs7.ts) reuses the calendar helpers declared here; legacy
// schedules whose review history cannot be replayed keep using `rate`
// (docs/research/00-SINTESE.md D22; extra-open-spaced-repetition__ts-fsrs.md §14.6).

declare namespace legacyScheduler {
	/** 0 New · 1 Learning · 2 Review · 3 Relearning. */
	type ScheduleState = 0 | 1 | 2 | 3;

	/** Persisted FSRS-6 schedule (ts-fsrs ≤ 5 field names, epoch milliseconds). */
	interface LegacySchedule {
		due: number;
		stability: number;
		difficulty: number;
		elapsed_days: number;
		scheduled_days: number;
		reps: number;
		lapses: number;
		learning_steps: number;
		state: ScheduleState;
		last_review: number | null;
		/** Logical study day (YYYY-MM-DD) of a Review due; absent for intraday steps. */
		dueDay?: string;
	}

	interface SchedulerSettings {
		retention?: number;
		learningSteps?: readonly number[];
		relearningSteps?: readonly number[];
		dayStart?: number;
	}

	interface WeightedCue {
		latestRating?: number | null;
	}
}

declare const legacyScheduler: {
	createSchedule(now?: number): legacyScheduler.LegacySchedule;
	rate(schedule: legacyScheduler.LegacySchedule, rating: number, now?: number, settings?: legacyScheduler.SchedulerSettings): legacyScheduler.LegacySchedule;
	preview(schedule: legacyScheduler.LegacySchedule, now?: number, settings?: legacyScheduler.SchedulerSettings): Record<1 | 2 | 3 | 4, legacyScheduler.LegacySchedule>;
	chooseCue<T extends legacyScheduler.WeightedCue>(cues: readonly T[], random?: () => number): T | null;
	studyDay(now: number, startHour?: number): string;
	dayBounds(now: number, startHour?: number): { start: number; end: number };
	isDue(schedule: { state: number; due: number; dueDay?: string }, now?: number, startHour?: number): boolean;
	reviewDue(now: number, days: number, dayStart: number): number;
};

export = legacyScheduler;
