import type { CurriculumItem, CurriculumSnapshot } from "../curriculum/types.ts";
import { foundationTag, regionExitTag } from "../curriculum/campaign.ts";
import type { LearnerGraphView } from "../learner/graph-view.ts";
import { LEARNER_CONSTANTS } from "../learner/params.ts";
import type { LearnerEvent } from "../learner/types.ts";
import { englishCampaign, englishFinale } from "./english-campaign.ts";

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

interface StudyCampaign {
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
		for (const id of ids) {
			const minutes = Math.max(minNewMinutes, Math.round(graph.nodes.get(id)!.hoursMid * 60));
			lessonMinutes.set(id, Math.min(minutes, maxNewMinutes, id === entry ? 25 : id === finale ? 45 : 35));
			if (active) {
				const item = snapshot.items[id]!;
				const region = units.get(inheritedGroup(snapshot, item, "unit").id)!;
				const urgency = 2 * (units.size - region) + Number(item.tags?.includes(foundationTag) ?? false);
				priorities.set(id, id === entry ? 2 * units.size + 4 : id === finale ? 1 : urgency);
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

export function guidedLessonOptions(campaign: StudyCampaign | undefined, events: readonly LearnerEvent[], at: string, due?: string) {
	if (!campaign) return {};
	const recent = new Set<string>();
	const cutoff = Date.parse(at) - LEARNER_CONSTANTS.delayedMinutes * 60_000;
	for (const e of events) if (e.kind === "exposure" && !e.exploratory && Date.parse(e.at) > cutoff) recent.add(e.nodeId);
	return {
		goalPlan: new Set(campaign.lessonMinutes.keys()),
		newPriority: campaign.priority,
		eligibleNew: (id: string) => campaign.priority(id) > 0 && !recent.has(id) && id !== due,
		lessonMinutes: campaign.lessonMinutes,
	};
}
