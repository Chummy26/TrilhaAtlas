/**
 * Flashcards FSRS-6 → FSRS-7 migration (plugins/flashcards/src/fsrs7.ts, store.cjs,
 * scheduling.ts). SÍNTESE M4: "migra para ts-fsrs@6 com Reschedule.replay de
 * state.reviews, sem perda"; ts-fsrs report §14.6.
 *
 *  - a store written by the legacy engine opens as FSRS-7 with every review kept,
 *    the same review count, due, state and counters, and replayed memory;
 *  - an incomplete history stays FSRS-6 instead of inventing memory;
 *  - properties: incremental grading equals replay, and migration never changes reps;
 *  - regression: the merged app + Anki replay rebuilds the whole FSRS-7 schedule (state,
 *    reps, due), never leaving a reviewed card New or skipping never-graded legacy ones.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import legacy from "../plugins/flashcards/src/scheduler.cjs";
import {
	createFsrs7Schedule,
	isFsrs7Schedule,
	migrateLegacySchedule,
	rateFsrs7,
	replayMemory,
	replayMergedSchedule,
	type Fsrs7Schedule,
	type LegacySchedule,
} from "../plugins/flashcards/src/fsrs7.ts";
import * as scheduling from "../plugins/flashcards/src/scheduling.ts";

const pluginDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../plugins/flashcards");
const requirePlugin = createRequire(path.join(pluginDir, "package.json"));
const { openStore } = requirePlugin("./src/store.cjs") as { openStore(directory: string): { get(): StoreState } };

const DAY = 86_400_000;
const SETTINGS = { retention: 0.9, learningSteps: [1, 10], relearningSteps: [10], dayStart: 4, fuzz: false, chunkBudget: 4000, modelOverride: null };
const START = new Date(2026, 0, 5, 10).getTime();

interface StoredReview { id: string; propositionId: string; cueId: string; rating: number; at: number; before: LegacySchedule; after: LegacySchedule }
interface StoreState { revision: number; reviews: StoredReview[]; propositions: Record<string, { schedule: Fsrs7Schedule | LegacySchedule }> }

const temporaryDirectories: string[] = [];
after(() => { for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

/** A fresh directory under the OS temp folder, removed after the suite (never the repo data/). */
function temporaryDirectory(prefix = "lh-flashcards-fsrs7-"): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	temporaryDirectories.push(directory);
	return directory;
}

function tempDir(): string {
	return temporaryDirectory();
}

/** Grades with the legacy FSRS-6 engine and records reviews exactly like backend.cjs does. */
function legacyHistory(steps: ReadonlyArray<readonly [rating: number, gapMs: number]>, propositionId = "p1") {
	let schedule = legacy.createSchedule(START);
	let at = START;
	const reviews: StoredReview[] = [];
	steps.forEach(([rating, gap], index) => {
		at += gap;
		const before = schedule;
		schedule = legacy.rate(before, rating, at, SETTINGS);
		reviews.push({ id: `${propositionId}-r${index}`, propositionId, cueId: `${propositionId}-c1`, rating, at, before, after: schedule });
	});
	return { schedule, reviews };
}

function legacyStore(directory: string, schedule: LegacySchedule, reviews: StoredReview[]) {
	const state = {
		version: 1,
		revision: 7,
		settings: SETTINGS,
		decks: [{ id: "d1", name: "Verbos", newLimit: 20, propositionIds: ["p1", "p2"] }],
		propositions: {
			p1: { id: "p1", origin: "manual", name: "Fato", statement: "", cues: [{ id: "p1-c1", question: "Q?", answer: "A", latestRating: 3 }], schedule, firstReviewedAt: START, learningCueId: null, version: 3 },
			p2: { id: "p2", origin: "manual", name: "Novo", statement: "", cues: [{ id: "p2-c1", question: "Q2?", answer: "A2", latestRating: null }], schedule: legacy.createSchedule(START), firstReviewedAt: null, learningCueId: null, version: 1 },
		},
		reviews: reviews.map((review, index) => ({ ...review, requestId: `q${index}`, ticketId: `t${index}`, introduced: index === 0, deckIds: index === 0 ? ["d1"] : [], settings: SETTINGS })),
		batches: [],
	};
	fs.writeFileSync(path.join(directory, "flashcards.json"), JSON.stringify(state));
	return state;
}

const HISTORY: ReadonlyArray<readonly [number, number]> = [[3, 0], [3, 11 * 60_000], [3, 2 * DAY], [1, 9 * DAY], [3, 10 * 60_000], [4, 6 * DAY], [2, 30 * DAY]];

describe("flashcards FSRS-6 → FSRS-7 migration", () => {
	it("opens a legacy store as FSRS-7 keeping every review, the review count, due and state", () => {
		const directory = tempDir();
		const { schedule, reviews } = legacyHistory(HISTORY);
		const written = legacyStore(directory, schedule, reviews);
		const opened = openStore(directory).get();
		const migrated = opened.propositions.p1?.schedule;
		assert.ok(migrated && isFsrs7Schedule(migrated));
		assert.equal(opened.revision, written.revision + 1, "the migration is one durable write");
		assert.deepEqual(opened.reviews, written.reviews, "no review record is lost or rewritten");
		assert.equal(migrated.reps, reviews.length);
		assert.equal(migrated.reps, schedule.reps);
		for (const key of ["due", "dueDay", "state", "lapses", "learning_steps", "scheduled_days", "last_review", "elapsed_days"] as const) {
			assert.deepEqual(migrated[key], schedule[key], key);
		}
		assert.deepEqual(migrated.migratedFrom && { stability: migrated.migratedFrom.stability, difficulty: migrated.migratedFrom.difficulty }, { stability: schedule.stability, difficulty: schedule.difficulty });
		const replayed = replayMemory(reviews.map((review) => ({ rating: review.rating as 1 | 2 | 3 | 4, at: review.at })));
		assert.deepEqual({ stability: migrated.stability, stabilityFast: migrated.stabilityFast, difficulty: migrated.difficulty }, replayed);
		assert.ok(migrated.stabilityFast > 0);
		assert.deepEqual(opened.propositions.p2?.schedule, written.propositions.p2.schedule, "unreviewed schedules are not rewritten on open");
		const reopened = openStore(directory).get();
		assert.equal(reopened.revision, opened.revision, "migration is idempotent");
		assert.deepEqual(reopened.propositions, opened.propositions);
	});

	it("continues grading a migrated schedule with FSRS-7 and upgrades never-graded legacy schedules", () => {
		const directory = tempDir();
		const { schedule, reviews } = legacyHistory(HISTORY);
		legacyStore(directory, schedule, reviews);
		const opened = openStore(directory).get();
		const migrated = opened.propositions.p1?.schedule as Fsrs7Schedule;
		const next = scheduling.rate(migrated, 3, migrated.due + DAY, SETTINGS);
		assert.ok(isFsrs7Schedule(next));
		assert.equal(next.reps, reviews.length + 1);
		const fresh = scheduling.rate(opened.propositions.p2?.schedule as LegacySchedule, 3, START + DAY, SETTINGS);
		assert.ok(isFsrs7Schedule(fresh), "a New legacy schedule starts on FSRS-7");
		assert.equal(fresh.reps, 1);
	});

	it("keeps FSRS-6 when the review history is incomplete", () => {
		const directory = tempDir();
		const { schedule, reviews } = legacyHistory(HISTORY);
		const written = legacyStore(directory, schedule, reviews.slice(1));
		const opened = openStore(directory).get();
		assert.equal(opened.revision, written.revision, "nothing to migrate means no write");
		const kept = opened.propositions.p1?.schedule as LegacySchedule;
		assert.equal(isFsrs7Schedule(kept), false);
		assert.deepEqual(kept, schedule);
		const next = scheduling.rate(kept, 3, kept.due + DAY, SETTINGS);
		assert.equal(isFsrs7Schedule(next), false, "the legacy engine keeps rating it");
		assert.equal(next.reps, schedule.reps + 1);
		assert.equal(migrateLegacySchedule(schedule, reviews.slice(0, -1)), null, "a missing latest review is also incomplete");
	});

	it("puts Review dues on the study-day rollover and keeps intraday steps exact", () => {
		const first = rateFsrs7(createFsrs7Schedule(START), 3, START, SETTINGS);
		assert.equal(first.state, 1);
		assert.equal(first.due, START + 10 * 60_000);
		const graduated = rateFsrs7(first, 3, first.due, SETTINGS);
		assert.equal(graduated.state, 2);
		assert.ok(Number.isInteger(graduated.scheduled_days) && graduated.scheduled_days >= 1);
		assert.equal(graduated.due, legacy.reviewDue(first.due, graduated.scheduled_days, 4));
		assert.equal(graduated.dueDay, legacy.studyDay(graduated.due, 4));
		assert.equal(new Date(graduated.due).getHours(), 4);
	});

	const rating = fc.integer({ min: 1, max: 4 });
	const gap = fc.oneof(fc.integer({ min: 0, max: 3 * 3_600_000 }), fc.integer({ min: 0, max: 60 * DAY }));

	it("property: grading incrementally yields exactly the replayed memory", () => {
		fc.assert(fc.property(fc.array(fc.tuple(rating, gap), { minLength: 1, maxLength: 25 }), (steps) => {
			let schedule = createFsrs7Schedule(START);
			let at = START;
			const history: Array<{ rating: 1 | 2 | 3 | 4; at: number }> = [];
			for (const [grade, delta] of steps) {
				at += delta;
				schedule = rateFsrs7(schedule, grade, at, SETTINGS);
				history.push({ rating: grade as 1 | 2 | 3 | 4, at });
			}
			assert.deepEqual(replayMemory(history), { stability: schedule.stability, stabilityFast: schedule.stabilityFast, difficulty: schedule.difficulty });
			assert.equal(schedule.reps, steps.length);
		}), { numRuns: 150 });
	});

	it("property: migrating any complete legacy history preserves the review count and policy fields", () => {
		fc.assert(fc.property(fc.array(fc.tuple(rating, gap), { minLength: 1, maxLength: 20 }), (steps) => {
			const { schedule, reviews } = legacyHistory(steps.map(([grade, delta], index) => [grade, index === 0 ? 0 : delta] as const));
			const migrated = migrateLegacySchedule(schedule, reviews, START);
			assert.ok(migrated);
			assert.equal(migrated.reps, reviews.length);
			assert.equal(migrated.due, schedule.due);
			assert.equal(migrated.state, schedule.state);
			assert.equal(migrated.lapses, schedule.lapses);
			assert.equal(migrateLegacySchedule(migrated, reviews), null, "already FSRS-7");
		}), { numRuns: 100 });
	});

	it("property: a merged (app + Anki) replay equals grading the merged history in order", () => {
		const history = fc.uniqueArray(fc.tuple(rating, fc.integer({ min: 0, max: 400 * DAY })), { selector: ([, offset]) => offset, minLength: 1, maxLength: 15 })
			.map((pairs) => pairs.map(([grade, offset]) => ({ rating: grade as 1 | 2 | 3 | 4, at: START + offset })));
		fc.assert(fc.property(history, (reviews) => {
			const sorted = [...reviews].sort((a, b) => a.at - b.at);
			let expected = createFsrs7Schedule(START);
			for (const review of sorted) expected = rateFsrs7(expected, review.rating, review.at, SETTINGS);
			const input = createFsrs7Schedule(START);
			const frozen = structuredClone(input);
			const replayed = replayMergedSchedule(input, reviews, SETTINGS);
			assert.deepEqual(input, frozen, "the input schedule is not mutated");
			assert.deepEqual(replayed, expected);
			assert.notEqual(replayed.state, 0, "a reviewed card is never New");
			assert.equal(replayed.reps, reviews.length);
			assert.deepEqual({ stability: replayed.stability, stabilityFast: replayed.stabilityFast, difficulty: replayed.difficulty }, replayMemory(reviews));
		}), { numRuns: 150 });
	});

	it("merged replay rebuilds never-graded legacy schedules, keeps migratedFrom and ignores an empty history", () => {
		const fresh = legacy.createSchedule(START);
		const history = [{ rating: 3 as const, at: START + DAY }, { rating: 4 as const, at: START + 3 * DAY }];
		const rebuilt = replayMergedSchedule(fresh, history, SETTINGS);
		assert.ok(isFsrs7Schedule(rebuilt));
		assert.equal(rebuilt.reps, 2);
		assert.equal(rebuilt.last_review, START + 3 * DAY);
		assert.equal(replayMergedSchedule(fresh, [], SETTINGS), fresh);
		const { schedule, reviews } = legacyHistory(HISTORY);
		const migrated = migrateLegacySchedule(schedule, reviews, START) as Fsrs7Schedule;
		const merged = replayMergedSchedule(migrated, [...reviews.map((review) => ({ rating: review.rating as 1 | 2 | 3 | 4, at: review.at })), { rating: 3, at: (schedule.last_review ?? START) + DAY }], SETTINGS);
		assert.equal(merged.reps, reviews.length + 1);
		assert.deepEqual(isFsrs7Schedule(merged) && merged.migratedFrom, migrated.migratedFrom);
	});
});
