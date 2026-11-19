/**
 * Scheduling facade used by the backend: new schedules are FSRS-7 (fsrs7.ts);
 * legacy FSRS-6 schedules whose history could not be replayed keep the vendored
 * engine (scheduler.cjs). Routing is by the persisted `model` tag, so one
 * proposition never mixes models (docs/research/00-SINTESE.md D22;
 * extra-open-spaced-repetition__ts-fsrs.md §14.6 step 3).
 *
 * Same API as the legacy module (createSchedule, rate, preview, chooseCue,
 * studyDay, dayBounds, isDue) so queue, statistics and tickets are unchanged.
 */

import legacy from "./scheduler.cjs";
import { createFsrs7Schedule, isFsrs7Schedule, migrateLegacySchedule, previewFsrs7, rateFsrs7, type AnySchedule, type ReviewRating, type SchedulerSettings } from "./fsrs7.ts";

export const createSchedule = createFsrs7Schedule;

/** A legacy schedule that was never graded has no memory to lose: it starts on FSRS-7. */
function upgradeNew(schedule: AnySchedule): AnySchedule {
	return !isFsrs7Schedule(schedule) && schedule.state === 0 ? migrateLegacySchedule(schedule, []) ?? schedule : schedule;
}

export function rate(schedule: AnySchedule, rating: number, now: number = Date.now(), settings: SchedulerSettings = {}): AnySchedule {
	const current = upgradeNew(schedule);
	return isFsrs7Schedule(current) ? rateFsrs7(current, rating, now, settings) : legacy.rate(current, rating, now, settings);
}

export function preview(schedule: AnySchedule, now: number = Date.now(), settings: SchedulerSettings = {}): Record<ReviewRating, AnySchedule> {
	const current = upgradeNew(schedule);
	return isFsrs7Schedule(current) ? previewFsrs7(current, now, settings) : legacy.preview(current, now, settings);
}

export const chooseCue = legacy.chooseCue;
export const studyDay = legacy.studyDay;
export const dayBounds = legacy.dayBounds;
export const isDue = legacy.isDue;
