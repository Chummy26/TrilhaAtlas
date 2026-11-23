import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CurriculumItem, CurriculumSnapshot } from "../src/core/curriculum/types.ts";
import { structuralState } from "../src/core/learner/kst.ts";
import { studyCampaign } from "../src/core/study/campaign.ts";
import { buildCourseOutline } from "../src/core/study/course-outline.ts";
import { learnerViewOf } from "../src/core/study/projection.ts";
import {
	buildStudySyllabus,
	type StudySyllabus,
	type SyllabusChapter,
	type SyllabusLesson,
	type SyllabusModule,
} from "../src/core/study/syllabus.ts";

function makeLesson(overrides: Partial<SyllabusLesson> & { id: string; title: string }): SyllabusLesson {
	return {
		status: "available",
		minutes: 25,
		hours: 0.42,
		retention: null,
		durable: false,
		hasLab: false,
		isFinale: false,
		isLandmark: false,
		...overrides,
	};
}

function makeModule(overrides: Partial<SyllabusModule> & { id: string; title: string; index: number; lessons: SyllabusLesson[] }): SyllabusModule {
	const completed = overrides.completed ?? overrides.lessons.filter((l) => l.status === "done").length;
	const total = overrides.total ?? overrides.lessons.length;
	return {
		completed,
		total,
		hoursTotal: 2,
		hoursRemaining: 1,
		avgRetention: null,
		examUnlocked: false,
		books: [],
		videos: [],
		...overrides,
	};
}

function makeSyllabus(chapters: SyllabusChapter[], overrides?: Partial<StudySyllabus>): StudySyllabus {
	return {
		domainId: "electronics",
		chapters,
		totalLessons: chapters.reduce((acc, c) => acc + c.total, 0),
		completedLessons: chapters.reduce((acc, c) => acc + c.completed, 0),
		totalHours: 10,
		completedLessonHours: 3,
		remainingHours: 7,
		studiedHours: 3,
		activeChapterIndex: 0,
		activeModuleId: chapters[0]?.modules[0]?.id ?? null,
		schedule: {
			weeklyHoursObserved: 5,
			weeklyHoursPlanned: 10,
			effectiveWeeklyHours: 10,
			reviewReserveShare: 0.33,
			paceSource: "planned",
			remainingHours: 7,
			weeksToFinish: 1.04,
			weeksToFinishP80: 1.3,
			estimatedCompletionDate: "2026-12-01",
			estimatedCompletionDateP80: "2026-12-05",
			activeChapterWeeks: 1.04,
		},
		...overrides,
	};
}

function makeChapter(overrides: Partial<SyllabusChapter> & { level: string; title: string; index: number; modules: SyllabusModule[] }): SyllabusChapter {
	const completed = overrides.completed ?? overrides.modules.reduce((acc, m) => acc + m.completed, 0);
	const total = overrides.total ?? overrides.modules.reduce((acc, m) => acc + m.total, 0);
	return {
		mission: "Master the fundamentals.",
		completed,
		total,
		hoursTotal: 5,
		hoursRemaining: 2,
		active: false,
		...overrides,
	};
}

describe("buildCourseOutline", () => {
	it("clusters consecutive lessons by topicId and falls back to title: null for ungrouped lessons", () => {
		const modGrouped = makeModule({
			id: "m1",
			title: "Circuit Basics",
			index: 1,
			lessons: [
				makeLesson({ id: "l1", title: "Ohm's Law", topicId: "t.dc", topicTitle: "DC Circuits" }),
				makeLesson({ id: "l2", title: "Series Resistors", topicId: "t.dc", topicTitle: "DC Circuits" }),
				makeLesson({ id: "l3", title: "Kirchhoff Current Law", topicId: "t.kcl", topicTitle: "Kirchhoff Laws", hasLab: true }),
				makeLesson({ id: "l4", title: "Bonus Voltage Divider", topicId: "t.dc", topicTitle: "DC Circuits" }),
			],
		});
		const modUngrouped = makeModule({
			id: "m2",
			title: "Standalone Module",
			index: 2,
			lessons: [
				makeLesson({ id: "l5", title: "Safety First" }),
				makeLesson({ id: "l6", title: "Multimeter Probes" }),
			],
		});
		const syllabus = makeSyllabus([
			makeChapter({ level: "B0", title: "Foundations", index: 1, active: true, modules: [modGrouped, modUngrouped] }),
		]);

		const outline = buildCourseOutline(syllabus, "l3");
		const m1 = outline.chapters[0]!.modules[0]!;
		const m2 = outline.chapters[0]!.modules[1]!;

		assert.equal(m1.groups.length, 3, "non-consecutive repeated topicId forms a distinct sequential group");
		assert.equal(m1.groups[0]!.id, "t.dc");
		assert.equal(m1.groups[0]!.title, "DC Circuits");
		assert.deepEqual(m1.groups[0]!.lessons.map((l) => l.id), ["l1", "l2"]);

		assert.equal(m1.groups[1]!.id, "t.kcl");
		assert.equal(m1.groups[1]!.title, "Kirchhoff Laws");
		assert.equal(m1.groups[1]!.lessons[0]!.kind, "lab");
		assert.equal(m1.groups[1]!.lessons[0]!.isCurrent, true);

		assert.equal(m1.groups[2]!.id, "t.dc#1", "re-appearing topicId gets a unique group id");
		assert.equal(m1.groups[2]!.title, "DC Circuits");
		assert.deepEqual(m1.groups[2]!.lessons.map((l) => l.id), ["l4"]);

		assert.equal(m2.groups.length, 1);
		assert.equal(m2.groups[0]!.title, null);
		assert.deepEqual(m2.groups[0]!.lessons.map((l) => l.id), ["l5", "l6"]);
	});

	it("detects active chapter and module from activeNodeId even when syllabus defaults differ", () => {
		const syllabus = makeSyllabus(
			[
				makeChapter({
					level: "B0",
					title: "Chapter 1",
					index: 1,
					active: true,
					modules: [makeModule({ id: "m1", title: "Mod 1", index: 1, lessons: [makeLesson({ id: "a1", title: "A1", status: "done" })] })],
				}),
				makeChapter({
					level: "B1",
					title: "Chapter 2",
					index: 2,
					active: false,
					modules: [
						makeModule({ id: "m2", title: "Mod 2", index: 1, lessons: [makeLesson({ id: "b1", title: "B1", status: "done" })] }),
						makeModule({ id: "m3", title: "Mod 3", index: 2, lessons: [makeLesson({ id: "b2", title: "B2", status: "in-progress" })] }),
					],
				}),
			],
			{ activeChapterIndex: 0, activeModuleId: "m1" },
		);

		const outline = buildCourseOutline(syllabus, "b2");
		assert.equal(outline.activeChapterIndex, 1);
		assert.equal(outline.activeModuleId, "m3");
		assert.equal(outline.chapters[0]!.active, false);
		assert.equal(outline.chapters[1]!.active, true);
		assert.equal(outline.chapters[1]!.modules[0]!.isActive, false);
		assert.equal(outline.chapters[1]!.modules[1]!.isActive, true);
		assert.equal(outline.chapters[1]!.modules[1]!.groups[0]!.lessons[0]!.isCurrent, true);
	});

	it("flags low retention (< 0.85) per lesson and aggregates lowRetentionCount per module", () => {
		const mod = makeModule({
			id: "m1",
			title: "Retention Module",
			index: 1,
			avgRetention: 0.78,
			lessons: [
				makeLesson({ id: "l1", title: "L1", status: "done", retention: 0.92, durable: true }),
				makeLesson({ id: "l2", title: "L2", status: "done", retention: 0.85 }),
				makeLesson({ id: "l3", title: "L3", status: "done", retention: 0.84 }),
				makeLesson({ id: "l4", title: "L4", status: "done", retention: 0.61 }),
				makeLesson({ id: "l5", title: "L5", status: "available", retention: null }),
			],
		});
		const syllabus = makeSyllabus([makeChapter({ level: "B0", title: "Ch1", index: 1, active: true, modules: [mod] })]);

		const outline = buildCourseOutline(syllabus, "l5");
		const outMod = outline.chapters[0]!.modules[0]!;
		const lessons = outMod.groups[0]!.lessons;

		assert.equal(lessons[0]!.lowRetention, false);
		assert.equal(lessons[1]!.lowRetention, false, "threshold is strictly < 0.85");
		assert.equal(lessons[2]!.lowRetention, true);
		assert.equal(lessons[3]!.lowRetention, true);
		assert.equal(lessons[4]!.lowRetention, false);
		assert.equal(outMod.lowRetentionCount, 2);
		assert.equal(outMod.avgRetention, 0.78);
		assert.equal(outMod.percent, 80);
	});

	it("builds optional multimodal supportSteps (curated book or flipped pre-reading + optional video)", () => {
		const modWithMedia = makeModule({
			id: "m1",
			title: "Semiconductors",
			index: 1,
			books: [
				{ title: "Electronics Fundamentals", part: "Ch. 2", url: "https://example.org/ef-ch2" },
				{ title: "Diode Physics Handbook", part: "Sec. 4", url: "https://example.org/diode-book" },
			],
			videos: [
				{ title: "Intro to PN Junctions", part: "0:00-8:00", url: "https://youtube.com/watch?v=pn123" },
				{ title: "Diode Rectifier Lab", part: "0:00-6:30", url: "https://youtube.com/watch?v=rect456" },
			],
			lessons: [
				makeLesson({ id: "l1", title: "Diode Rectifier Circuits" }),
			],
		});
		const modNoMedia = makeModule({
			id: "m2",
			title: "No Curated Media",
			index: 2,
			books: [],
			videos: [],
			lessons: [
				makeLesson({ id: "l2", title: "Nodal Analysis" }),
			],
		});
		const syllabus = makeSyllabus([
			makeChapter({ level: "B1", title: "Analog", index: 1, active: true, modules: [modWithMedia, modNoMedia] }),
		]);

		const outline = buildCourseOutline(syllabus, "l1");
		const l1Steps = outline.chapters[0]!.modules[0]!.groups[0]!.lessons[0]!.supportSteps;
		assert.equal(l1Steps.length, 2);
		assert.equal(l1Steps[0]!.kind, "reading");
		assert.equal(l1Steps[0]!.minutes, 5);
		assert.equal(l1Steps[0]!.optional, true);
		assert.equal(l1Steps[0]!.title, "Diode Physics Handbook", "matches book by lesson keywords");
		assert.equal(l1Steps[0]!.url, "https://example.org/diode-book");

		assert.equal(l1Steps[1]!.kind, "video");
		assert.equal(l1Steps[1]!.minutes, 6);
		assert.equal(l1Steps[1]!.optional, true);
		assert.equal(l1Steps[1]!.title, "Diode Rectifier Lab", "matches video by lesson keywords");
		assert.equal(l1Steps[1]!.url, "https://youtube.com/watch?v=rect456");

		const l2Steps = outline.chapters[0]!.modules[1]!.groups[0]!.lessons[0]!.supportSteps;
		assert.equal(l2Steps.length, 1, "omits video step when module has no curated videos");
		assert.equal(l2Steps[0]!.kind, "reading");
		assert.equal(l2Steps[0]!.minutes, 5);
		assert.equal(l2Steps[0]!.optional, true);
		assert.equal(l2Steps[0]!.title, "Nodal Analysis");
		assert.equal(l2Steps[0]!.url, undefined, "flipped pre-reading has no external URL");
	});

	it("emits problem-set and exam milestones with unlocked and scored state", () => {
		const modLocked = makeModule({
			id: "m1",
			title: "Locked Exam",
			index: 1,
			examUnlocked: false,
			lessons: [makeLesson({ id: "l1", title: "L1" })],
		});
		const modScored = makeModule({
			id: "m2",
			title: "Scored Module",
			index: 2,
			examUnlocked: true,
			problemSetScore: 8.5,
			problemSetPassed: true,
			examScore: 6.2,
			examPassed: false,
			lessons: [makeLesson({ id: "l2", title: "L2", status: "done" })],
		});
		const syllabus = makeSyllabus([
			makeChapter({ level: "B0", title: "Ch1", index: 1, active: true, modules: [modLocked, modScored] }),
		]);

		const outline = buildCourseOutline(syllabus, "l1");
		const m1Milestones = outline.chapters[0]!.modules[0]!.milestones;
		assert.deepEqual(m1Milestones, [
			{ kind: "problem-set", minutes: 15, unlocked: true, hrefAction: "lista" },
			{ kind: "exam", minutes: 20, unlocked: false, hrefAction: "prova" },
		]);

		const m2Milestones = outline.chapters[0]!.modules[1]!.milestones;
		assert.deepEqual(m2Milestones, [
			{ kind: "problem-set", minutes: 15, unlocked: true, score: 8.5, passed: true, hrefAction: "lista" },
			{ kind: "exam", minutes: 20, unlocked: true, score: 6.2, passed: false, hrefAction: "prova" },
		]);
	});

	it("computes nextUp skipping current/done lessons and rolling over to the next module", () => {
		const m1 = makeModule({
			id: "m1",
			title: "Module 1",
			index: 1,
			lessons: [
				makeLesson({ id: "l1", title: "L1", status: "done", minutes: 20 }),
				makeLesson({ id: "l2", title: "L2", status: "in-progress", minutes: 25 }),
				makeLesson({ id: "l3", title: "L3", status: "done", minutes: 30 }),
				makeLesson({ id: "l4", title: "L4", status: "available", minutes: 35 }),
			],
		});
		const m2 = makeModule({
			id: "m2",
			title: "Module 2",
			index: 2,
			lessons: [
				makeLesson({ id: "l5", title: "L5", status: "available", minutes: 22 }),
				makeLesson({ id: "l6", title: "L6", status: "locked", minutes: 28 }),
			],
		});
		const syllabus = makeSyllabus([makeChapter({ level: "B0", title: "Ch1", index: 1, active: true, modules: [m1, m2] })]);

		// In middle of m1: skips current (l2) and done (l3), picks l4.
		const mid = buildCourseOutline(syllabus, "l2");
		assert.deepEqual(mid.nextUp, {
			nodeId: "l4",
			title: "L4",
			minutes: 35,
			status: "available",
			moduleId: "m1",
			moduleTitle: "Module 1",
		});

		// At end of m1 (l4): rolls over to m2's first non-done lesson (l5).
		const endOfMod = buildCourseOutline(syllabus, "l4");
		assert.deepEqual(endOfMod.nextUp, {
			nodeId: "l5",
			title: "L5",
			minutes: 22,
			status: "available",
			moduleId: "m2",
			moduleTitle: "Module 2",
		});

		// At last lesson of course (l6): wraps back to first undone lesson in active module (l5), skipping l6.
		const endOfCourse = buildCourseOutline(syllabus, "l6");
		assert.equal(endOfCourse.nextUp?.nodeId, "l5");
		assert.equal(endOfCourse.nextUp?.moduleId, "m2");

		// When all earlier lessons in active module m2 are done, wraps back to earliest undone lesson in chapter (l2 in m1).
		const m2OnlyL6Undone = makeModule({
			...m2,
			lessons: [
				makeLesson({ id: "l5", title: "L5", status: "done", minutes: 22 }),
				makeLesson({ id: "l6", title: "L6", status: "locked", minutes: 28 }),
			],
		});
		const syllabusWrapChapter = makeSyllabus([
			makeChapter({ level: "B0", title: "Ch1", index: 1, active: true, modules: [m1, m2OnlyL6Undone] }),
		]);
		assert.equal(buildCourseOutline(syllabusWrapChapter, "l6").nextUp?.nodeId, "l2");

		// When every lesson is done, nextUp is null.
		const allDoneSyllabus = makeSyllabus([
			makeChapter({
				level: "B0",
				title: "Ch1",
				index: 1,
				active: false,
				modules: [
					makeModule({
						id: "m1",
						title: "Module 1",
						index: 1,
						lessons: [
							makeLesson({ id: "d1", title: "D1", status: "done" }),
							makeLesson({ id: "d2", title: "D2", status: "done" }),
						],
					}),
				],
			}),
		]);
		assert.equal(buildCourseOutline(allDoneSyllabus, "d1").nextUp, null);
	});
});

describe("buildStudySyllabus topic parent metadata", () => {
	it("populates topicId and topicTitle when a leaf's parent has kind === 'topic'", () => {
		const baseItem = (
			id: string,
			kind: CurriculumItem["kind"],
			parentId: string | null,
			order: number,
			pt: string,
			en: string,
		): CurriculumItem => ({
			id,
			domainId: "demo",
			kind,
			parentId,
			order,
			title: { pt, en },
			aliases: [],
			scope: pt,
			summary: pt,
			objectives: ["Demonstrate understanding"],
			assess: ["explain"],
			level: { scheme: "generic", band: 0 },
			clauses: [],
			softPrereqs: [],
			encompasses: [],
			hours: { lo: 0.3, hi: 0.5 },
			anchors: [],
			status: "stable",
			version: 1,
			provenance: { createdBy: "seed", createdAt: "2026-01-01T00:00:00Z" },
		});

		const items: Record<string, CurriculumItem> = {
			"demo.root": baseItem("demo.root", "domain", null, 0, "Demo", "Demo"),
			"demo.area": baseItem("demo.area", "area", "demo.root", 0, "Area 1", "Area 1"),
			"demo.u1": baseItem("demo.u1", "unit", "demo.area", 0, "Unidade 1", "Unit 1"),
			"demo.t1": baseItem("demo.t1", "topic", "demo.u1", 0, "Tópico A", "Topic A"),
			"demo.t2": baseItem("demo.t2", "topic", "demo.u1", 1, "", "Fallback English Topic"),
			"demo.a1": baseItem("demo.a1", "atom", "demo.t1", 0, "Lição 1", "Lesson 1"),
			"demo.a2": baseItem("demo.a2", "atom", "demo.t2", 0, "Lição 2", "Lesson 2"),
			"demo.a3": baseItem("demo.a3", "atom", "demo.u1", 2, "Lição Direta", "Direct Lesson"),
		};
		const snapshot: CurriculumSnapshot = {
			schemaVersion: 1,
			domainId: "demo",
			version: 1,
			items,
			edges: [],
			certificate: { order: [], hash: "test" },
			updatedAt: "2026-01-01T00:00:00Z",
		};

		const graph = learnerViewOf(snapshot);
		const st = structuralState({ nodes: {} }, graph);
		const campaign = studyCampaign(snapshot, graph, st.known);
		const syllabus = buildStudySyllabus({
			snapshot,
			graph,
			learner: {
				schemaVersion: 1,
				domainId: "demo",
				seq: 0,
				nodes: {},
				theta: 0,
				thetaN: 0,
				speed: 1,
				updatedAt: "2026-10-01T00:00:00Z",
			},
			campaign,
			known: st.known,
			available: new Set(st.frontier),
			at: "2026-10-01T00:00:00Z",
			recentMinutes14d: 0,
			dailyBudgetMin: 60,
		});

		const lessons = syllabus.chapters.flatMap((c) => c.modules.flatMap((m) => m.lessons));
		const byId = new Map(lessons.map((l) => [l.id, l]));

		assert.equal(byId.get("demo.a1")?.topicId, "demo.t1");
		assert.equal(byId.get("demo.a1")?.topicTitle, "Tópico A");
		assert.equal(byId.get("demo.a2")?.topicId, "demo.t2");
		assert.equal(byId.get("demo.a2")?.topicTitle, "Fallback English Topic");
		assert.equal(byId.get("demo.a3")?.topicId, undefined);
		assert.equal(byId.get("demo.a3")?.topicTitle, undefined);
	});
});
