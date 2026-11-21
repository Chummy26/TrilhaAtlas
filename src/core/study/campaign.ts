import type { CurriculumItem, CurriculumSnapshot } from "../curriculum/types.ts";
import { foundationTag, regionExitTag } from "../curriculum/campaign.ts";
import type { LearnerGraphView } from "../learner/graph-view.ts";
import { LEARNER_CONSTANTS } from "../learner/params.ts";
import type { LearnerEvent, PlanItem } from "../learner/types.ts";
import { englishCampaign, englishFinale } from "./english-campaign.ts";
import { isAdvancedDefenseNode } from "./tutor-pedagogy.ts";

export interface CampaignChapter {
	level: string;
	title: string;
	mission: string;
	entry: string;
	finale: string;
	entryMinutes: number;
	landmarks: { id: string; title: string; known: boolean }[];
	total: number;
	known: number;
}

export interface CampaignModuleLesson {
	id: string;
	title: string;
	status: "done" | "current" | "available" | "locked";
	minutes: number;
	isFinale?: boolean;
	isLandmark?: boolean;
}

export interface CampaignModule {
	id: string;
	title: string;
	chapterLevel: string;
	chapterTitle: string;
	index: number;
	totalModules: number;
	completed: number;
	total: number;
	lessons: CampaignModuleLesson[];
}

export interface CampaignQueueItem {
	kind: PlanItem["kind"];
	nodeId: string;
	title: string;
	moduleTitle: string;
	estMinutes: number;
	reason: string;
	isFinale?: boolean;
	isLandmark?: boolean;
}

export interface LessonCourseContext {
	chapterLevel: string;
	chapterTitle: string;
	chapterIndex: number;
	totalChapters: number;
	chapterKnown: number;
	chapterTotal: number;
	moduleId: string;
	moduleTitle: string;
	moduleIndex: number;
	totalModules: number;
	moduleCompleted: number;
	moduleTotal: number;
	lessonIndex: number;
	isFinale: boolean;
	isLandmark: boolean;
	isAdvancedDefense?: boolean;
}

export interface LessonCourseProgress extends LessonCourseContext {
	moduleJustCompleted: boolean;
	chapterJustCompleted: boolean;
	nextModuleTitle?: string;
	nextChapterTitle?: string;
}

export interface StudyCampaign {
	journey: CampaignChapter[];
	priority: (id: string) => number;
	lessonMinutes: Map<string, number>;
}

const cefr = ["pre-A1", "A1", "A2", "B1", "B2", "C1", "C2"];
const electronics = ["Fundamentos", "Técnico", "Graduação", "Avançado", "Pesquisa"];

function band(item: CurriculumItem) {
	return item.level.scheme === "cefr" ? cefr.indexOf(item.level.cefr) : item.level.band;
}

export function defaultCampaignTargets(snapshot: CurriculumSnapshot) {
	const exits = Object.values(snapshot.items).filter(item => item.kind === "atom" && item.status !== "deprecated" &&
		item.level.scheme === "generic" && item.tags?.includes(regionExitTag));
	const last = exits.reduce((max, item) => Math.max(max, band(item)), -Infinity);
	return exits.filter(item => band(item) === last).map(item => item.id);
}

function inheritedGroup(snapshot: CurriculumSnapshot, item: CurriculumItem, kind: "area" | "unit") {
	let parent = item;
	let area: CurriculumItem | undefined;
	while (parent.parentId && parent.kind !== kind) {
		if (parent.kind === "area") area = parent;
		parent = snapshot.items[parent.parentId]!;
	}
	return parent.kind === kind ? parent : area ?? parent;
}

function objective(item: CurriculumItem) {
	return item.practice?.exitCriterion || item.objectives[0] || item.summary || item.title.pt;
}

interface Stage {
	title: string;
	ids: string[];
	units: Map<string, number>;
}

const stageCache = new WeakMap<LearnerGraphView, Stage[]>();

function stagesOf(snapshot: CurriculumSnapshot, graph: LearnerGraphView) {
	const cached = stageCache.get(graph);
	if (cached) return cached;
	const leaves = graph.ids.map(id => snapshot.items[id]!).filter(item => graph.nodes.get(item.id)!.isLeaf && !item.reinforcementFor);
	const splitByUnit = new Set(leaves.map(band)).size === 1;
	const authorsOrder = new Map<string, number>();
	if (splitByUnit) {
		const stack = graph.ids.filter(id => !graph.nodes.get(id)!.parentId).reverse();
		while (stack.length) {
			const id = stack.pop()!;
			authorsOrder.set(id, authorsOrder.size);
			const children = graph.nodes.get(id)!.children;
			for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
		}
	}
	const groupOf = new Map<string, number>();
	const labels = new Map<number, Set<string>>();
	for (const item of leaves) {
		const owner = inheritedGroup(snapshot, item, splitByUnit ? "unit" : "area");
		const key = splitByUnit ? authorsOrder.get(owner.id)! : band(item);
		const title = splitByUnit ? owner.title.pt : item.level.scheme === "ee" ? electronics[item.level.band]! :
			item.level.scheme === "cefr" ? item.level.cefr : owner.title.pt;
		groupOf.set(item.id, key);
		const names = labels.get(key) ?? new Set<string>();
		names.add(title);
		labels.set(key, names);
	}
	const effective = new Map<string, number>();
	const stages = new Map<number, Stage>();
	// A lesson can start as soon as one whole prerequisite route is available.
	// Carry stages through containers as well, including on older imported trees.
	for (const id of graph.ids) {
		const node = graph.nodes.get(id)!;
		const incoming = node.clauses.reduce((earliest, route) => Math.min(earliest,
			route.reduce((latest, parent) => Math.max(latest, effective.get(parent)!), -Infinity)), Infinity);
		const declared = groupOf.get(id);
		const key = Math.max(declared ?? -Infinity, node.clauses.length ? incoming : -Infinity);
		effective.set(id, key);
		if (declared === undefined) continue;
		const stage = stages.get(key) ?? { title: [...labels.get(key)!].join(" · "), ids: [], units: new Map<string, number>() };
		stage.ids.push(id);
		const unit = inheritedGroup(snapshot, snapshot.items[id]!, "unit").id;
		if (!stage.units.has(unit)) stage.units.set(unit, stage.units.size);
		stages.set(key, stage);
	}
	const ordered = [...stages].sort(([a], [b]) => a - b).map(([, stage]) => stage);
	stageCache.set(graph, ordered);
	return ordered;
}

export function studyCampaign(snapshot: CurriculumSnapshot, graph: LearnerGraphView, known: ReadonlySet<string>): StudyCampaign {
	const stages = stagesOf(snapshot, graph);
	if (snapshot.domainId === "english") {
		const authored = englishCampaign(snapshot, graph, known);
		const compatible = authored.journey.every(c => graph.nodes.get(c.entry)?.isLeaf && graph.nodes.get(c.finale)?.isLeaf) &&
			stages.every(stage => stage.ids.every(id => {
				const level = snapshot.items[id]!.level;
				return level.scheme === "cefr" && level.cefr === stage.title;
			}));
		if (compatible) return authored;
	}
	const lessonMinutes = new Map<string, number>();
	const priorities = new Map<string, number>();
	const { minNewMinutes, maxNewMinutes } = LEARNER_CONSTANTS.planner;
	let foundCurrent = false;
	const journey = stages.map(({ title, ids, units }, index) => {
		const entry = ids[0]!;
		const finale = ids.at(-1)!;
		const count = ids.reduce((n,id) => n + Number(known.has(id)), 0);
		const active = !foundCurrent && count < ids.length;
		if (active) foundCurrent = true;
		const landmarks = new Set([entry, finale]);
		const exits = ids.filter(id => snapshot.items[id]!.tags?.includes(regionExitTag) && id !== finale);
		const middle = exits.length ? exits : ids.slice(1, -1);
		const stops = Math.min(3, middle.length);
		for (let i = 0; i < stops; i++) landmarks.add(middle[Math.floor((i + .5) * middle.length / stops)]!);
		let activeUnitId: string | undefined;
		if (active) {
			const unitProgress = new Map<string, { known: number; total: number }>();
			for (const id of ids) {
				const unitId = inheritedGroup(snapshot, snapshot.items[id]!, "unit").id;
				const stat = unitProgress.get(unitId) ?? { known: 0, total: 0 };
				stat.total++;
				if (known.has(id)) stat.known++;
				unitProgress.set(unitId, stat);
			}
			for (const [unitId, stat] of unitProgress) {
				if (stat.known > 0 && stat.known < stat.total) {
					activeUnitId = unitId;
					break;
				}
			}
		}
		for (const id of ids) {
			const minutes = Math.max(minNewMinutes, Math.round(graph.nodes.get(id)!.hoursMid * 60));
			lessonMinutes.set(id, Math.min(minutes, maxNewMinutes, id === entry ? 25 : id === finale ? 45 : 35));
			if (active) {
				const item = snapshot.items[id]!;
				const unitId = inheritedGroup(snapshot, item, "unit").id;
				const region = units.get(unitId)!;
				const inActiveUnit = activeUnitId && unitId === activeUnitId ? 2 * units.size + 2 : 0;
				const urgency = inActiveUnit + 2 * (units.size - region) + Number(item.tags?.includes(foundationTag) ?? false);
				priorities.set(id, id === entry ? 4 * units.size + 8 : id === finale ? 1 : urgency);
			}
		}
		return { level: "Etapa " + (index + 1), title, mission: objective(snapshot.items[finale]!), entry, finale,
			entryMinutes: lessonMinutes.get(entry)!, known: count, total: ids.length,
			landmarks: ids.filter(id => landmarks.has(id)).map(id => ({ id, title: graph.nodes.get(id)!.title, known: known.has(id) })) };
	});
	return { journey, lessonMinutes, priority: id => priorities.get(id) ?? 0 };
}

export function campaignFinale(snapshot: CurriculumSnapshot, campaign: StudyCampaign, id: string) {
	const stage = campaign.journey.find(chapter => chapter.finale === id);
	if (!stage) return;
	return (snapshot.domainId === "english" && englishFinale(id)) || stage.mission;
}

/** Latest reinforcement feedback per node whose most recent exam closed with reinforcement. */
export function pendingReinforcements(events: readonly LearnerEvent[], known: ReadonlySet<string>): Map<string, string> {
	const result = new Map<string, string>();
	for (const e of events) {
		if (e.kind !== "lesson-finished") continue;
		if (known.has(e.nodeId)) {
			result.delete(e.nodeId);
			continue;
		}
		if (e.outcome === "reinforce") {
			result.set(e.nodeId, e.feedback ?? "Retome este tópico para consolidar os objetivos pendentes.");
		} else {
			result.delete(e.nodeId);
		}
	}
	return result;
}

export function guidedLessonOptions(
	campaign: StudyCampaign | undefined,
	events: readonly LearnerEvent[],
	at: string,
	due?: string,
	reinforced?: ReadonlySet<string>,
) {
	if (!campaign) return {};
	const recent = new Set<string>();
	const cutoff = Date.parse(at) - LEARNER_CONSTANTS.delayedMinutes * 60_000;
	for (const e of events) if (e.kind === "exposure" && !e.exploratory && Date.parse(e.at) > cutoff) recent.add(e.nodeId);
	return {
		goalPlan: new Set(campaign.lessonMinutes.keys()),
		newPriority: campaign.priority,
		eligibleNew: (id: string) => campaign.priority(id) > 0 && (!recent.has(id) || !!reinforced?.has(id)) && id !== due,
		lessonMinutes: campaign.lessonMinutes,
	};
}

interface ChapterUnits {
	chapterIndex: number;
	chapter: CampaignChapter;
	modules: { id: string; title: string; leafIds: string[] }[];
}

function chapterUnitsOf(snapshot: CurriculumSnapshot, graph: LearnerGraphView, campaign: StudyCampaign): ChapterUnits[] {
	const leaves = graph.ids.filter(id => graph.nodes.get(id)?.isLeaf && !snapshot.items[id]?.reinforcementFor);
	const isEnglish = snapshot.domainId === "english" && campaign.journey.every(c => cefr.includes(c.level));
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
		const stages = stagesOf(snapshot, graph);
		stages.forEach((stage, idx) => stageMap.set(idx, stage.ids));
	}
	return campaign.journey.map((chapter, chapterIndex) => {
		const ids = stageMap.get(chapterIndex) ?? [];
		const byUnit = new Map<string, { id: string; title: string; leafIds: string[] }>();
		for (const id of ids) {
			const unit = inheritedGroup(snapshot, snapshot.items[id]!, "unit");
			const mod = byUnit.get(unit.id) ?? { id: unit.id, title: unit.title.pt, leafIds: [] };
			mod.leafIds.push(id);
			byUnit.set(unit.id, mod);
		}
		return { chapterIndex, chapter, modules: [...byUnit.values()] };
	});
}

/** Build the ordered lesson list of the active unit/module (online-course syllabus view). */
export function activeModuleOf(
	snapshot: CurriculumSnapshot,
	graph: LearnerGraphView,
	campaign: StudyCampaign,
	known: ReadonlySet<string>,
	available: ReadonlySet<string>,
	focusNodeId?: string,
): CampaignModule | undefined {
	const structure = chapterUnitsOf(snapshot, graph, campaign);
	let target: { cu: ChapterUnits; modIndex: number } | undefined;
	if (focusNodeId) {
		for (const cu of structure) {
			const modIndex = cu.modules.findIndex(m => m.leafIds.includes(focusNodeId));
			if (modIndex >= 0) { target = { cu, modIndex }; break; }
		}
	}
	if (!target) {
		const cu = structure.find(entry => entry.chapter.known < entry.chapter.total) ?? structure.at(-1);
		if (!cu || !cu.modules.length) return undefined;
		const inProgress = cu.modules.findIndex(m => m.leafIds.some(id => known.has(id)) && m.leafIds.some(id => !known.has(id)));
		const firstIncomplete = cu.modules.findIndex(m => m.leafIds.some(id => !known.has(id)));
		target = { cu, modIndex: inProgress >= 0 ? inProgress : firstIncomplete >= 0 ? firstIncomplete : cu.modules.length - 1 };
	}
	const { cu, modIndex } = target;
	const mod = cu.modules[modIndex]!;
	const landmarks = new Set(cu.chapter.landmarks.map(l => l.id));
	const completed = mod.leafIds.reduce((n, id) => n + Number(known.has(id)), 0);
	const lessons: CampaignModuleLesson[] = mod.leafIds.map(id => {
		const status: CampaignModuleLesson["status"] = known.has(id)
			? "done"
			: id === focusNodeId
				? "current"
				: available.has(id)
					? "available"
					: "locked";
		return {
			id,
			title: graph.nodes.get(id)?.title ?? snapshot.items[id]?.title.pt ?? id,
			status,
			minutes: Math.round(campaign.lessonMinutes.get(id) ?? Math.max(10, (graph.nodes.get(id)?.hoursMid ?? 0.4) * 60)),
			...(id === cu.chapter.finale && { isFinale: true }),
			...(landmarks.has(id) && { isLandmark: true }),
		};
	});
	return {
		id: mod.id,
		title: mod.title,
		chapterLevel: cu.chapter.level,
		chapterTitle: cu.chapter.title,
		index: modIndex + 1,
		totalModules: cu.modules.length,
		completed,
		total: mod.leafIds.length,
		lessons,
	};
}

/** Course breadcrumb and progress position for a specific campaign skill. */
export function lessonCourseContext(
	snapshot: CurriculumSnapshot,
	graph: LearnerGraphView,
	campaign: StudyCampaign,
	known: ReadonlySet<string>,
	nodeId: string,
): LessonCourseContext | null {
	const structure = chapterUnitsOf(snapshot, graph, campaign);
	for (const cu of structure) {
		const modIndex = cu.modules.findIndex(m => m.leafIds.includes(nodeId));
		if (modIndex < 0) continue;
		const mod = cu.modules[modIndex]!;
		const lessonIndex = mod.leafIds.indexOf(nodeId) + 1;
		const moduleCompleted = mod.leafIds.reduce((n, id) => n + Number(known.has(id)), 0);
		const landmarks = new Set(cu.chapter.landmarks.map(l => l.id));
		const isFinale = cu.chapter.finale === nodeId;
		const item = snapshot.items[nodeId];
		return {
			chapterLevel: cu.chapter.level,
			chapterTitle: cu.chapter.title,
			chapterIndex: cu.chapterIndex + 1,
			totalChapters: structure.length,
			chapterKnown: cu.chapter.known,
			chapterTotal: cu.chapter.total,
			moduleId: mod.id,
			moduleTitle: mod.title,
			moduleIndex: modIndex + 1,
			totalModules: cu.modules.length,
			moduleCompleted,
			moduleTotal: mod.leafIds.length,
			lessonIndex,
			isFinale,
			isLandmark: landmarks.has(nodeId),
			...(item && isAdvancedDefenseNode(item, isFinale) ? { isAdvancedDefense: true } : {}),
		};
	}
	return null;
}

/** Detect module/chapter transitions right after completing a lesson node. */
export function campaignCompletionProgress(
	snapshot: CurriculumSnapshot,
	graph: LearnerGraphView,
	campaignBefore: StudyCampaign,
	campaignAfter: StudyCampaign,
	knownBefore: ReadonlySet<string>,
	knownAfter: ReadonlySet<string>,
	nodeId: string,
): LessonCourseProgress | null {
	const after = lessonCourseContext(snapshot, graph, campaignAfter, knownAfter, nodeId);
	if (!after) return null;
	const before = lessonCourseContext(snapshot, graph, campaignBefore, knownBefore, nodeId);
	const moduleJustCompleted = after.moduleCompleted === after.moduleTotal && after.moduleTotal > 0
		&& (!before || before.moduleCompleted < before.moduleTotal);
	const chapterJustCompleted = after.chapterKnown === after.chapterTotal && after.chapterTotal > 0
		&& (!before || before.chapterKnown < before.chapterTotal);
	let nextModuleTitle: string | undefined;
	let nextChapterTitle: string | undefined;
	if (chapterJustCompleted) {
		const nextChapter = campaignAfter.journey[after.chapterIndex];
		if (nextChapter) nextChapterTitle = `${nextChapter.level} · ${nextChapter.title}`;
	} else if (moduleJustCompleted) {
		const structure = chapterUnitsOf(snapshot, graph, campaignAfter);
		const nextMod = structure[after.chapterIndex - 1]?.modules[after.moduleIndex];
		if (nextMod) nextModuleTitle = nextMod.title;
	}
	return {
		...after,
		moduleJustCompleted,
		chapterJustCompleted,
		...(nextModuleTitle && { nextModuleTitle }),
		...(nextChapterTitle && { nextChapterTitle }),
	};
}

/** Build the continuous "up next" queue for the home campaign card. */
export function campaignQueue(
	snapshot: CurriculumSnapshot,
	graph: LearnerGraphView,
	campaign: StudyCampaign,
	planItems: readonly PlanItem[],
	nextId: string | undefined,
	limit = 4,
): CampaignQueueItem[] {
	const landmarks = new Set(campaign.journey.flatMap(c => c.landmarks.map(l => l.id)));
	const finales = new Set(campaign.journey.map(c => c.finale));
	const seen = new Set<string>(nextId ? [nextId] : []);
	const out: CampaignQueueItem[] = [];
	for (const item of planItems) {
		if (out.length >= limit) break;
		if (seen.has(item.nodeId)) continue;
		const curriculumItem = snapshot.items[item.nodeId];
		if (!curriculumItem) continue;
		seen.add(item.nodeId);
		const unit = inheritedGroup(snapshot, curriculumItem, "unit");
		out.push({
			kind: item.kind,
			nodeId: item.nodeId,
			title: graph.nodes.get(item.nodeId)?.title ?? curriculumItem.title.pt,
			moduleTitle: unit.title.pt,
			estMinutes: Math.round(item.estMinutes),
			reason: item.reason,
			...(finales.has(item.nodeId) && { isFinale: true }),
			...(landmarks.has(item.nodeId) && { isLandmark: true }),
		});
	}
	return out;
}
