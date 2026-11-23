/**
 * Pure Coursera-inspired course outline view-model builder for lesson navigation.
 * Groups syllabus lessons into chapters → modules → topic sub-groups with typed
 * multimodal support steps (optional pre-reading & video) and module milestones.
 *
 * 100% pure and browser-safe: no Node APIs, no I/O, no wall clock.
 */

import type { StudySyllabus, SyllabusLesson, SyllabusMaterialRef, SyllabusModule } from "./syllabus.ts";

export type CourseOutlineStepKind = "reading" | "video" | "lesson" | "lab" | "problem-set" | "exam";

export interface CourseOutlineSupportStep {
	kind: "reading" | "video";
	minutes: number;
	title: string;
	part?: string;
	url?: string;
	optional: true;
}

export interface CourseOutlineLesson {
	id: string;
	title: string;
	status: SyllabusLesson["status"];
	minutes: number;
	kind: "lesson" | "lab";
	retention: number | null;
	lowRetention: boolean;
	durable: boolean;
	isFinale: boolean;
	isLandmark: boolean;
	isCurrent: boolean;
	supportSteps: CourseOutlineSupportStep[];
}

export interface CourseOutlineGroup {
	id: string;
	title: string | null;
	lessons: CourseOutlineLesson[];
}

export interface CourseOutlineMilestone {
	kind: "problem-set" | "exam";
	minutes: number;
	unlocked: boolean;
	score?: number;
	passed?: boolean;
	hrefAction: "lista" | "prova";
}

export interface CourseOutlineModule {
	id: string;
	index: number;
	title: string;
	completed: number;
	total: number;
	percent: number;
	avgRetention: number | null;
	lowRetentionCount: number;
	isActive: boolean;
	groups: CourseOutlineGroup[];
	milestones: CourseOutlineMilestone[];
}

export interface CourseOutlineChapter {
	level: string;
	title: string;
	index: number;
	completed: number;
	total: number;
	active: boolean;
	modules: CourseOutlineModule[];
}

export type CourseOutlineNextUp = {
	nodeId: string;
	title: string;
	minutes: number;
	status: SyllabusLesson["status"];
	moduleId: string;
	moduleTitle: string;
} | null;

export interface CourseOutlineView {
	domainId: string;
	activeChapterIndex: number;
	activeModuleId: string | null;
	chapters: CourseOutlineChapter[];
	nextUp: CourseOutlineNextUp;
}

const LOW_RETENTION_THRESHOLD = 0.85;
const READING_STEP_MINUTES = 5;
const VIDEO_STEP_MINUTES = 6;
const PROBLEM_SET_MINUTES = 15;
const EXAM_MINUTES = 20;

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.split(/[^a-z0-9]+/)
		.filter((token) => token.length >= 3);
}

function pickBestMaterial(
	materials: readonly SyllabusMaterialRef[],
	lessonTitle: string,
	topicTitle?: string,
): SyllabusMaterialRef | undefined {
	if (materials.length === 0) return undefined;
	if (materials.length === 1) return materials[0];

	const queryTokens = new Set(tokenize(`${lessonTitle} ${topicTitle ?? ""}`));
	if (queryTokens.size === 0) return materials[0];

	let best = materials[0];
	let bestScore = 0;
	for (const mat of materials) {
		const matTokens = tokenize(`${mat.title} ${mat.part}`);
		let score = 0;
		for (const token of matTokens) {
			if (queryTokens.has(token)) score++;
		}
		if (score > bestScore) {
			bestScore = score;
			best = mat;
		}
	}
	return best;
}

function buildSupportSteps(mod: SyllabusModule, lesson: SyllabusLesson): CourseOutlineSupportStep[] {
	const steps: CourseOutlineSupportStep[] = [];

	const book = pickBestMaterial(mod.books, lesson.title, lesson.topicTitle);
	if (book) {
		steps.push({
			kind: "reading",
			minutes: READING_STEP_MINUTES,
			title: book.title,
			...(book.part ? { part: book.part } : {}),
			...(book.url ? { url: book.url } : {}),
			optional: true,
		});
	} else {
		steps.push({
			kind: "reading",
			minutes: READING_STEP_MINUTES,
			title: lesson.title,
			optional: true,
		});
	}

	const video = pickBestMaterial(mod.videos, lesson.title, lesson.topicTitle);
	if (video) {
		steps.push({
			kind: "video",
			minutes: VIDEO_STEP_MINUTES,
			title: video.title,
			...(video.part ? { part: video.part } : {}),
			...(video.url ? { url: video.url } : {}),
			optional: true,
		});
	}

	return steps;
}

function buildModuleMilestones(mod: SyllabusModule): CourseOutlineMilestone[] {
	return [
		{
			kind: "problem-set",
			minutes: PROBLEM_SET_MINUTES,
			unlocked: true,
			...(mod.problemSetScore !== undefined ? { score: mod.problemSetScore } : {}),
			...(mod.problemSetPassed !== undefined ? { passed: mod.problemSetPassed } : {}),
			hrefAction: "lista",
		},
		{
			kind: "exam",
			minutes: EXAM_MINUTES,
			unlocked: mod.examUnlocked,
			...(mod.examScore !== undefined ? { score: mod.examScore } : {}),
			...(mod.examPassed !== undefined ? { passed: mod.examPassed } : {}),
			hrefAction: "prova",
		},
	];
}

function buildModuleGroups(
	mod: SyllabusModule,
	activeNodeId: string | null,
): { groups: CourseOutlineGroup[]; lowRetentionCount: number } {
	const groups: CourseOutlineGroup[] = [];
	const usedIds = new Map<string, number>();
	let lastKey: string | null = null;
	let lowRetentionCount = 0;

	for (const lesson of mod.lessons) {
		const lowRetention = lesson.retention !== null && lesson.retention < LOW_RETENTION_THRESHOLD;
		if (lowRetention) lowRetentionCount++;

		const mapped: CourseOutlineLesson = {
			id: lesson.id,
			title: lesson.title,
			status: lesson.status,
			minutes: lesson.minutes,
			kind: lesson.hasLab ? "lab" : "lesson",
			retention: lesson.retention,
			lowRetention,
			durable: lesson.durable,
			isFinale: lesson.isFinale,
			isLandmark: lesson.isLandmark,
			isCurrent: Boolean(activeNodeId && lesson.id === activeNodeId),
			supportSteps: buildSupportSteps(mod, lesson),
		};

		const cleanTopicTitle = lesson.topicTitle?.trim() || null;
		const groupKey = lesson.topicId ?? (cleanTopicTitle ? `topic:${cleanTopicTitle}` : "");

		if (groups.length > 0 && lastKey === groupKey) {
			const current = groups[groups.length - 1]!;
			current.lessons.push(mapped);
			if (current.title === null && cleanTopicTitle !== null) {
				current.title = cleanTopicTitle;
			}
		} else {
			const baseId = lesson.topicId || `${mod.id}:group-${groups.length}`;
			const seen = usedIds.get(baseId) ?? 0;
			usedIds.set(baseId, seen + 1);
			const groupId = seen === 0 ? baseId : `${baseId}#${seen}`;
			groups.push({
				id: groupId,
				title: cleanTopicTitle,
				lessons: [mapped],
			});
			lastKey = groupKey;
		}
	}

	return { groups, lowRetentionCount };
}

interface FlatLessonEntry {
	chapterIdx: number;
	moduleId: string;
	moduleTitle: string;
	lesson: SyllabusLesson;
}

function toNextUp(entry: FlatLessonEntry): NonNullable<CourseOutlineNextUp> {
	return {
		nodeId: entry.lesson.id,
		title: entry.lesson.title,
		minutes: entry.lesson.minutes,
		status: entry.lesson.status,
		moduleId: entry.moduleId,
		moduleTitle: entry.moduleTitle,
	};
}

function resolveNextUp(
	syllabus: StudySyllabus,
	activeNodeId: string | null,
	activeChapterIndex: number,
	activeModuleId: string | null,
): CourseOutlineNextUp {
	const flat: FlatLessonEntry[] = [];
	for (let cIdx = 0; cIdx < syllabus.chapters.length; cIdx++) {
		const ch = syllabus.chapters[cIdx]!;
		for (const mod of ch.modules) {
			for (const lesson of mod.lessons) {
				flat.push({
					chapterIdx: cIdx,
					moduleId: mod.id,
					moduleTitle: mod.title,
					lesson,
				});
			}
		}
	}

	if (flat.length === 0) return null;

	const isCandidate = (entry: FlatLessonEntry): boolean =>
		entry.lesson.status !== "done" && entry.lesson.id !== activeNodeId;

	const activeIdx = activeNodeId ? flat.findIndex((e) => e.lesson.id === activeNodeId) : -1;
	if (activeIdx >= 0) {
		// Scan forward from the active lesson (remaining in current module, then subsequent modules/chapters).
		for (let i = activeIdx + 1; i < flat.length; i++) {
			if (isCandidate(flat[i]!)) return toNextUp(flat[i]!);
		}
		// Wrap around: prefer earlier undone lessons in the active module, then active chapter, then any chapter.
		const activeModId = flat[activeIdx]!.moduleId;
		const activeChapIdx = flat[activeIdx]!.chapterIdx;
		for (let i = 0; i < activeIdx; i++) {
			const e = flat[i]!;
			if (e.moduleId === activeModId && isCandidate(e)) return toNextUp(e);
		}
		for (let i = 0; i < activeIdx; i++) {
			const e = flat[i]!;
			if (e.chapterIdx === activeChapIdx && isCandidate(e)) return toNextUp(e);
		}
		for (let i = 0; i < activeIdx; i++) {
			if (isCandidate(flat[i]!)) return toNextUp(flat[i]!);
		}
		return null;
	}

	if (activeModuleId) {
		const inActiveMod = flat.find((e) => e.moduleId === activeModuleId && isCandidate(e));
		if (inActiveMod) return toNextUp(inActiveMod);
	}
	const inActiveChapter = flat.find((e) => e.chapterIdx === activeChapterIndex && isCandidate(e));
	if (inActiveChapter) return toNextUp(inActiveChapter);

	const anywhere = flat.find(isCandidate);
	return anywhere ? toNextUp(anywhere) : null;
}

/** Build the hierarchical course outline view-model for the lesson sidebar drawer. */
export function buildCourseOutline(
	syllabus: StudySyllabus,
	activeNodeId?: string | null,
): CourseOutlineView {
	const normalizedActiveId = activeNodeId?.trim() || null;

	let activeChapterIndex = 0;
	let activeModuleId: string | null = null;

	// 1. Locate active chapter/module directly from activeNodeId when present.
	if (normalizedActiveId) {
		outer: for (let cIdx = 0; cIdx < syllabus.chapters.length; cIdx++) {
			const ch = syllabus.chapters[cIdx]!;
			for (const mod of ch.modules) {
				if (mod.lessons.some((l) => l.id === normalizedActiveId)) {
					activeChapterIndex = cIdx;
					activeModuleId = mod.id;
					break outer;
				}
			}
		}
	}

	// 2. Fall back to syllabus.activeModuleId / syllabus.activeChapterIndex.
	if (activeModuleId === null && syllabus.activeModuleId) {
		for (let cIdx = 0; cIdx < syllabus.chapters.length; cIdx++) {
			const ch = syllabus.chapters[cIdx]!;
			if (ch.modules.some((m) => m.id === syllabus.activeModuleId)) {
				activeChapterIndex = cIdx;
				activeModuleId = syllabus.activeModuleId;
				break;
			}
		}
	}

	if (activeModuleId === null && syllabus.chapters.length > 0) {
		const fallbackChapterIdx =
			syllabus.activeChapterIndex !== null &&
			syllabus.activeChapterIndex >= 0 &&
			syllabus.activeChapterIndex < syllabus.chapters.length
				? syllabus.activeChapterIndex
				: 0;
		activeChapterIndex = fallbackChapterIdx;
		activeModuleId = syllabus.chapters[fallbackChapterIdx]?.modules[0]?.id ?? null;
	}

	const chapters: CourseOutlineChapter[] = syllabus.chapters.map((ch, cIdx) => ({
		level: ch.level,
		title: ch.title,
		index: ch.index,
		completed: ch.completed,
		total: ch.total,
		active: cIdx === activeChapterIndex,
		modules: ch.modules.map((mod) => {
			const { groups, lowRetentionCount } = buildModuleGroups(mod, normalizedActiveId);
			const percent = mod.total > 0 ? Math.round((100 * mod.completed) / mod.total) : 0;
			return {
				id: mod.id,
				index: mod.index,
				title: mod.title,
				completed: mod.completed,
				total: mod.total,
				percent,
				avgRetention: mod.avgRetention,
				lowRetentionCount,
				isActive: mod.id === activeModuleId,
				groups,
				milestones: buildModuleMilestones(mod),
			};
		}),
	}));

	const nextUp = resolveNextUp(syllabus, normalizedActiveId, activeChapterIndex, activeModuleId);

	return {
		domainId: syllabus.domainId,
		activeChapterIndex,
		activeModuleId,
		chapters,
		nextUp,
	};
}
