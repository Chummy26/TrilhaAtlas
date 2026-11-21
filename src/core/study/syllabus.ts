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
import type { CampaignChapter, StudyCampaign } from "./campaign.ts";

export interface SyllabusMaterialRef {
	title: string;
	part: string;
	url: string;
}

export interface SyllabusLesson {
	id: string;
	title: string;
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

const CEFR_BANDS = ["pre-A1", "A1", "A2", "B1", "B2", "C1", "C2"] as const;

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

function round4(value: number): number {
	return Math.round(value * 10_000) / 10_000;
}

function bandOf(item: CurriculumItem): number {
	return item.level.scheme === "cefr" ? CEFR_BANDS.indexOf(item.level.cefr) : item.level.band;
}

function inheritedGroup(snapshot: CurriculumSnapshot, item: CurriculumItem, kind: "area" | "unit"): CurriculumItem {
	let parent = item;
	let area: CurriculumItem | undefined;
	const visited = new Set<string>([item.id]);
	while (parent.parentId && parent.kind !== kind && !visited.has(parent.parentId)) {
		if (parent.kind === "area") area = parent;
		const next = snapshot.items[parent.parentId];
		if (!next) break;
		visited.add(next.id);
		parent = next;
	}
	return parent.kind === kind ? parent : area ?? parent;
}

interface ChapterUnits {
	chapterIndex: number;
	chapter: CampaignChapter;
	modules: { id: string; title: string; leafIds: string[] }[];
}

function chapterUnitsOf(snapshot: CurriculumSnapshot, graph: LearnerGraphView, campaign: StudyCampaign): ChapterUnits[] {
	const leaves = graph.ids.filter((id) => {
		const item = snapshot.items[id];
		return Boolean(graph.nodes.get(id)?.isLeaf && item && !item.reinforcementFor);
	});
	const isEnglish = snapshot.domainId === "english" && campaign.journey.every((c) => CEFR_BANDS.includes(c.level as (typeof CEFR_BANDS)[number]));
	const stageMap = new Map<number, string[]>();

	if (isEnglish) {
		const indexByLevel = new Map(campaign.journey.map((c, i) => [c.level, i]));
		for (const id of leaves) {
			const item = snapshot.items[id]!;
			if (item.level.scheme !== "cefr") continue;
			const level = item.level.cefr === "pre-A1" ? "A1" : item.level.cefr;
			const idx = indexByLevel.get(level);
			if (idx === undefined) continue;
			const list = stageMap.get(idx) ?? [];
			list.push(id);
			stageMap.set(idx, list);
		}
	} else {
		const leafItems = leaves.map((id) => snapshot.items[id]!);
		const splitByUnit = new Set(leafItems.map(bandOf)).size === 1;
		const authorsOrder = new Map<string, number>();
		if (splitByUnit) {
			const stack = graph.ids.filter((id) => !graph.nodes.get(id)?.parentId).reverse();
			while (stack.length > 0) {
				const id = stack.pop()!;
				authorsOrder.set(id, authorsOrder.size);
				const children = graph.nodes.get(id)?.children ?? [];
				for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
			}
		}
		const groupOf = new Map<string, number>();
		for (const item of leafItems) {
			const owner = inheritedGroup(snapshot, item, splitByUnit ? "unit" : "area");
			const key = splitByUnit ? (authorsOrder.get(owner.id) ?? 0) : bandOf(item);
			groupOf.set(item.id, key);
		}
		const effective = new Map<string, number>();
		const stages = new Map<number, string[]>();
		for (const id of graph.ids) {
			const node = graph.nodes.get(id);
			if (!node) continue;
			const incoming = node.clauses.reduce(
				(earliest, route) => Math.min(earliest, route.reduce((latest, parent) => Math.max(latest, effective.get(parent) ?? -Infinity), -Infinity)),
				Infinity,
			);
			const declared = groupOf.get(id);
			const key = Math.max(declared ?? -Infinity, node.clauses.length ? incoming : -Infinity);
			effective.set(id, key);
			if (declared === undefined) continue;
			const list = stages.get(key) ?? [];
			list.push(id);
			stages.set(key, list);
		}
		[...stages]
			.sort(([a], [b]) => a - b)
			.forEach(([, ids], idx) => stageMap.set(idx, ids));
	}

	return campaign.journey.map((chapter, chapterIndex) => {
		const ids = stageMap.get(chapterIndex) ?? [];
		const byUnit = new Map<string, { id: string; title: string; leafIds: string[] }>();
		for (const id of ids) {
			const item = snapshot.items[id];
			if (!item) continue;
			const unit = inheritedGroup(snapshot, item, "unit");
			const mod = byUnit.get(unit.id) ?? { id: unit.id, title: unit.title.pt, leafIds: [] };
			mod.leafIds.push(id);
			byUnit.set(unit.id, mod);
		}
		return { chapterIndex, chapter, modules: [...byUnit.values()] };
	});
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
