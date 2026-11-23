/**
 * Full-domain course syllabus projection and completion schedule estimator.
 * Groups every curriculum leaf into chapters → modules (units) → lessons in
 * didactic order, combining campaign structure, FSRS retention, lab flags,
 * optional unit materials, and observed vs. planned weekly pace.
 *
 * Pure and browser-safe: no Node APIs, no I/O, no wall clock.
 */

import type { CurriculumItem, CurriculumSnapshot } from "../curriculum/types.ts";
import { FSRS_STATE, retrievability } from "../learner/fsrs.ts";
import type { LearnerGraphView } from "../learner/graph-view.ts";
import { DAY_MS } from "../learner/math.ts";
import { DEFAULT_LEARNER_PARAMS, LEARNER_CONSTANTS } from "../learner/params.ts";
import type { LearnerSnapshot } from "../learner/types.ts";
import { chapterUnitsOf, type StudyCampaign } from "./campaign.ts";

export interface SyllabusMaterialRef {
	title: string;
	part: string;
	url: string;
}

export interface SyllabusLesson {
	id: string;
	title: string;
	topicId?: string;
	topicTitle?: string;
	status: "done" | "in-progress" | "available" | "locked";
	minutes: number;
	hours: number;
	retention: number | null;
	durable: boolean;
	hasLab: boolean;
	isFinale: boolean;
	isLandmark: boolean;
}

export interface SyllabusModule {
	id: string;
	title: string;
	index: number;
	completed: number;
	total: number;
	hoursTotal: number;
	hoursRemaining: number;
	avgRetention: number | null;
	examScore?: number;
	examPassed?: boolean;
	examAt?: string;
	examUnlocked: boolean;
	problemSetScore?: number;
	problemSetPassed?: boolean;
	problemSetAt?: string;
	books: SyllabusMaterialRef[];
	videos: SyllabusMaterialRef[];
	lessons: SyllabusLesson[];
}

export interface SyllabusChapter {
	level: string;
	title: string;
	mission: string;
	index: number;
	completed: number;
	total: number;
	hoursTotal: number;
	hoursRemaining: number;
	active: boolean;
	examUnlocked?: boolean;
	examScore?: number;
	examPassed?: boolean;
	examAt?: string;
	modules: SyllabusModule[];
}

export interface CourseScheduleEstimate {
	weeklyHoursObserved: number;
	weeklyHoursPlanned: number;
	effectiveWeeklyHours: number;
	/** Share of study time reserved for spaced reviews/exams (Monte Carlo r7: ~33%). */
	reviewReserveShare: number;
	paceSource: "observed" | "planned";
	remainingHours: number;
	weeksToFinish: number;
	weeksToFinishP80: number;
	estimatedCompletionDate: string;
	estimatedCompletionDateP80: string;
	activeChapterWeeks: number;
}

export interface StudySyllabus {
	domainId: string;
	chapters: SyllabusChapter[];
	totalLessons: number;
	completedLessons: number;
	totalHours: number;
	completedLessonHours: number;
	remainingHours: number;
	/** Actual recorded active study time in this domain (hours). */
	studiedHours: number;
	activeChapterIndex: number | null;
	activeModuleId: string | null;
	schedule: CourseScheduleEstimate;
}

export interface BuildStudySyllabusInput {
	snapshot: CurriculumSnapshot;
	graph: LearnerGraphView;
	learner: LearnerSnapshot;
	campaign: StudyCampaign;
	known: ReadonlySet<string>;
	available: ReadonlySet<string>;
	at: string;
	recentMinutes14d: number;
	/** Distinct active study days in the last 14 days (avoids diluting day-1 sessions across 14 days). */
	activeDays14d?: number;
	/** Total recorded active study minutes in this domain (all-time). */
	totalStudiedMinutes?: number;
	dailyBudgetMin: number;
	moduleScores?: ReadonlyMap<string, { score: number; passed: boolean; at: string }>;
	problemSetScores?: ReadonlyMap<string, { score: number; passed: boolean; at: string }>;
	materialsByUnit?: ReadonlyMap<string, { books: SyllabusMaterialRef[]; videos: SyllabusMaterialRef[] }>;
	focusNodeId?: string;
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

function round4(value: number): number {
	return Math.round(value * 10_000) / 10_000;
}

function lessonHasLab(item: CurriculumItem | undefined): boolean {
	if (!item) return false;
	return item.atomType === "lab"
		|| Boolean(item.tags?.includes("lab"))
		|| item.assess.includes("sim")
		|| item.assess.includes("lab");
}

/** Build the complete chapter → module → lesson syllabus and pace estimate for a domain. */
export function buildStudySyllabus(input: BuildStudySyllabusInput): StudySyllabus {
	const {
		snapshot,
		graph,
		learner,
		campaign,
		known,
		available,
		at,
		recentMinutes14d,
		activeDays14d,
		totalStudiedMinutes,
		dailyBudgetMin,
		moduleScores,
		problemSetScores,
		materialsByUnit,
		focusNodeId,
	} = input;
	const { minNewMinutes, maxNewMinutes } = LEARNER_CONSTANTS.planner;

	const structure = chapterUnitsOf(snapshot, graph, campaign);
	let activeChapterIndex: number | null = null;
	let activeModuleId: string | null = null;
	let totalLessons = 0;
	let completedLessons = 0;
	let totalHoursRaw = 0;
	let remainingHoursRaw = 0;

	const chapters: SyllabusChapter[] = structure.map((cu, chapterIdx) => {
		const landmarks = new Set(cu.chapter.landmarks.map((l) => l.id));
		let chapterCompleted = 0;
		let chapterTotal = 0;
		let chapterHoursTotal = 0;
		let chapterHoursRemaining = 0;

		const modules: SyllabusModule[] = cu.modules.map((mod, modIdx) => {
			let modCompleted = 0;
			let modHoursTotal = 0;
			let modHoursRemaining = 0;
			let retentionSum = 0;
			let retentionCount = 0;

			const lessons: SyllabusLesson[] = mod.leafIds.map((id) => {
				const item = snapshot.items[id];
				const parent = item?.parentId ? snapshot.items[item.parentId] : undefined;
				const topicParent = parent?.kind === "topic" ? parent : undefined;
				const topicTitle = topicParent ? (topicParent.title.pt || topicParent.title.en) : undefined;
				const graphNode = graph.nodes.get(id);
				const st = learner.nodes[id];
				const isDone = known.has(id);
				const isStarted = Boolean(st?.lastExposureAt || st?.lastEvidenceAt);
				const status: SyllabusLesson["status"] = isDone
					? "done"
					: (id === focusNodeId || isStarted)
						? "in-progress"
						: available.has(id)
							? "available"
							: "locked";

				const plannedCap = campaign.lessonMinutes.get(id) ?? maxNewMinutes;
				const minutes = Math.round(
					Math.min(plannedCap, maxNewMinutes, Math.max(minNewMinutes, (graphNode?.hoursMid ?? 0.4) * 60)),
				);
				// Keep syllabus lesson hours aligned with guided session duration (15–45 min),
				// rather than raw multi-month CEFR mastery ceilings that inflate completed hours.
				const rawHours = minutes / 60;
				const hours = round2(rawHours);

				let retention: number | null = null;
				if (st?.fsrs && st.fsrs.state !== FSRS_STATE.new && st.fsrs.lastReviewAt) {
					retention = round4(retrievability(st.fsrs, at, DEFAULT_LEARNER_PARAMS));
					retentionSum += retention;
					retentionCount++;
				}

				const durable = Boolean(st?.independentRecallAt || (st?.delayedSuccesses ?? 0) >= 1);
				if (isDone) {
					modCompleted++;
				} else {
					modHoursRemaining += rawHours;
				}
				modHoursTotal += rawHours;

				if (focusNodeId && id === focusNodeId) {
					activeModuleId = mod.id;
				}

				return {
					id,
					title: graphNode?.title ?? item?.title.pt ?? id,
					...(topicParent ? { topicId: topicParent.id, ...(topicTitle ? { topicTitle } : {}) } : {}),
					status,
					minutes,
					hours,
					retention,
					durable,
					hasLab: lessonHasLab(item),
					isFinale: id === cu.chapter.finale,
					isLandmark: landmarks.has(id),
				};
			});

			const modTotal = lessons.length;
			const examThreshold = Math.max(1, Math.ceil(modTotal * 0.7));
			const examUnlocked = modTotal > 0 && modCompleted >= examThreshold;
			const score = moduleScores?.get(mod.id);
			const psScore = problemSetScores?.get(mod.id);
			const mats = materialsByUnit?.get(mod.id);

			chapterCompleted += modCompleted;
			chapterTotal += modTotal;
			chapterHoursTotal += modHoursTotal;
			chapterHoursRemaining += modHoursRemaining;

			return {
				id: mod.id,
				title: mod.title,
				index: modIdx + 1,
				completed: modCompleted,
				total: modTotal,
				hoursTotal: round2(modHoursTotal),
				hoursRemaining: round2(modHoursRemaining),
				avgRetention: retentionCount > 0 ? round4(retentionSum / retentionCount) : null,
				...(score !== undefined ? { examScore: score.score, examPassed: score.passed, examAt: score.at } : {}),
				examUnlocked,
				...(psScore !== undefined ? { problemSetScore: psScore.score, problemSetPassed: psScore.passed, problemSetAt: psScore.at } : {}),
				books: mats ? mats.books.map((b) => ({ ...b })) : [],
				videos: mats ? mats.videos.map((v) => ({ ...v })) : [],
				lessons,
			};
		});

		const active = activeChapterIndex === null && chapterCompleted < chapterTotal;
		if (active) activeChapterIndex = chapterIdx;

		const chapterExamThreshold = Math.max(1, Math.ceil(chapterTotal * 0.7));
		const chapterExamUnlocked = chapterTotal > 0 && (
			chapterCompleted >= chapterExamThreshold
			|| (modules.length > 0 && modules.every((m) => m.examUnlocked || m.completed >= m.total))
		);
		const chapterScore = moduleScores?.get(cu.chapter.level) ?? moduleScores?.get(String(chapterIdx + 1));

		totalLessons += chapterTotal;
		completedLessons += chapterCompleted;
		totalHoursRaw += chapterHoursTotal;
		remainingHoursRaw += chapterHoursRemaining;

		return {
			level: cu.chapter.level,
			title: cu.chapter.title,
			mission: cu.chapter.mission,
			index: chapterIdx + 1,
			completed: chapterCompleted,
			total: chapterTotal,
			hoursTotal: round2(chapterHoursTotal),
			hoursRemaining: round2(chapterHoursRemaining),
			active,
			examUnlocked: chapterExamUnlocked,
			...(chapterScore !== undefined ? { examScore: chapterScore.score, examPassed: chapterScore.passed, examAt: chapterScore.at } : {}),
			modules,
		};
	});

	if (activeModuleId === null && activeChapterIndex !== null) {
		const activeMods = chapters[activeChapterIndex]?.modules ?? [];
		const inProgressMod = activeMods.find((m) => m.completed > 0 && m.completed < m.total);
		const firstIncompleteMod = activeMods.find((m) => m.completed < m.total);
		activeModuleId = (inProgressMod ?? firstIncompleteMod ?? activeMods[0])?.id ?? null;
	}

	const totalHours = round2(totalHoursRaw);
	const remainingHours = round2(remainingHoursRaw);
	const completedLessonHours = round2(Math.max(0, totalHoursRaw - remainingHoursRaw));
	const studiedHours = round2(Math.max(0, totalStudiedMinutes ?? recentMinutes14d) / 60);
	const weeklyHoursObserved = round2(Math.max(0, recentMinutes14d) / 2 / 60);
	const weeklyHoursPlanned = round2((Math.max(0, dailyBudgetMin) * 5) / 60);
	const reviewReserveShare = 0.33;
	// Require at least 3 active study days (when tracked) before overriding planned pace,
	// so a single first-day session isn't diluted across 14 days into a multi-year forecast.
	const hasEnoughObservedDays = activeDays14d === undefined || activeDays14d >= 3;
	const paceSource: CourseScheduleEstimate["paceSource"] = hasEnoughObservedDays && weeklyHoursObserved >= 1 ? "observed" : "planned";
	const effectiveWeeklyHours = paceSource === "observed" ? weeklyHoursObserved : weeklyHoursPlanned;
	// Reserve 33% of weekly study time for FSRS reviews and integrative exams (r7 Monte Carlo).
	const netNewPace = Math.max(0.25, effectiveWeeklyHours * (1 - reviewReserveShare));

	const weeksToFinish = remainingHours <= 0 ? 0 : round2(remainingHours / netNewPace);
	const weeksToFinishP80 = remainingHours <= 0 ? 0 : round2(weeksToFinish * 1.25);
	const activeChapter = activeChapterIndex !== null ? chapters[activeChapterIndex] : undefined;
	const activeChapterWeeks = !activeChapter || activeChapter.hoursRemaining <= 0
		? 0
		: round2(activeChapter.hoursRemaining / netNewPace);

	const parsedAt = Date.parse(at);
	const baseMs = Number.isFinite(parsedAt) ? parsedAt : 0;
	// Clamp projection horizon to 100 years to guarantee a valid ISO date.
	const completionMs = baseMs + Math.min(weeksToFinish, 5200) * 7 * DAY_MS;
	const completionMsP80 = baseMs + Math.min(weeksToFinishP80, 5200) * 7 * DAY_MS;
	const estimatedCompletionDate = new Date(completionMs).toISOString().slice(0, 10);
	const estimatedCompletionDateP80 = new Date(completionMsP80).toISOString().slice(0, 10);

	return {
		domainId: snapshot.domainId,
		chapters,
		totalLessons,
		completedLessons,
		totalHours,
		completedLessonHours,
		remainingHours,
		studiedHours,
		activeChapterIndex,
		activeModuleId,
		schedule: {
			weeklyHoursObserved,
			weeklyHoursPlanned,
			effectiveWeeklyHours,
			reviewReserveShare,
			paceSource,
			remainingHours,
			weeksToFinish,
			weeksToFinishP80,
			estimatedCompletionDate,
			estimatedCompletionDateP80,
			activeChapterWeeks,
		},
	};
}
