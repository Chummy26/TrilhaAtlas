import type { CurriculumSnapshot, NodeKind } from "../curriculum/types.ts";
import { structuralState } from "../learner/kst.ts";
import type { LearnerGraphView } from "../learner/graph-view.ts";
import type { LearnerSnapshot } from "../learner/types.ts";

export interface SkillNode {
	id: string;
	title: string;
	parent: string | null;
	region: string | null;
	kind: NodeKind;
	order: number;
	level: string;
	leaf: boolean;
	reinforcementFor?: string;
	state: "available" | "known" | "locked" | "group";
	inProgress: boolean;
	independentRecallAt?: string;
	completed: boolean;
	requires: string[][];
	related: string[];
}

export interface SkillMap {
	domain: string;
	title: string;
	nodes: SkillNode[];
	next?: string;
	position?: string;
	reinforcement?: string;
}

export interface PdfCitationBook {
	book: string;
	region: string;
	title: string;
	fileTitle: string;
	pages: number;
}

export interface StudyMaterial {
	kind: "book" | "video";
	title: string;
	part: string;
	url: string;
	lang: string;
	nodes: string[];
	suggested?: boolean;
	bookKey?: string;
	saved?: boolean;
	linkOnly?: boolean;
}

/** Preserve the best-ranked reading and video in the lesson's six source slots. */
export type LessonResource = Pick<StudyMaterial, "kind" | "title" | "part" | "url" | "suggested">;
export function lessonResources(materials: readonly StudyMaterial[]): LessonResource[] {
	return (["book", "video"] as const).flatMap(kind => {
		const match = materials.find(m => m.kind === kind && /^https:\/\//i.test(m.url));
		return match ? [{ kind, title: match.title, part: match.part, url: match.url, suggested: match.suggested }] : [];
	});
}

export function lessonSourceLines(materials: readonly StudyMaterial[]): string[] {
	const book = materials.find(m => m.kind === "book");
	const video = materials.find(m => m.kind === "video");
	const selected = new Set([book, video].filter((m): m is StudyMaterial => !!m));
	for (const m of materials) {
		if (selected.size >= 6) break;
		selected.add(m);
	}
	return [...selected].map(m => `${m.suggested ? "Sugestão" : "Referência"} · ${m.kind === "video" ? "Vídeo" : "Livro"} · ${m.title} · ${m.part} (${m.url})`);
}

export interface RegionMaterials {
	region: string;
	localReadings?: { id: string; title: string; readable: boolean }[];
	materials: StudyMaterial[];
	references: { title: string; url?: string; parts: string[] }[];
	videoSearch: boolean;
	message?: string;
}

export function skillMap(snapshot: CurriculumSnapshot, view: LearnerGraphView, learner: LearnerSnapshot, title: string): SkillMap {
	const state = structuralState(learner, view);
	const available = new Set(state.frontier);
	const nodes = view.ids.map((id): SkillNode => {
		const item = snapshot.items[id]!;
		const graphNode = view.nodes.get(id)!;
		let region = item;
		while (region.kind !== "unit" && region.parentId) region = snapshot.items[region.parentId]!;
		const level = item.level;
		const progress = learner.nodes[id];
		const completed = Boolean(progress?.attainedAt || progress?.masteredAt || progress?.demonstratedAt);
		return {
			id, title: item.title.pt, parent: item.parentId, order: item.order, kind: item.kind, reinforcementFor: item.reinforcementFor,
			level: level.scheme === "cefr" ? level.cefr : level.scheme === "ee" ? ["Fundamentos", "Técnico", "Graduação", "Avançado", "Pesquisa"][level.band]! : String(level.band),
			region: region.kind === "unit" ? region.id : null, leaf: graphNode.isLeaf,
			state: state.known.has(id) ? "known" : !graphNode.isLeaf ? "group" : available.has(id) ? "available" : "locked",
			completed, inProgress: !completed && Boolean(progress?.lastExposureAt || progress?.lastEvidenceAt),
			...(progress?.independentRecallAt && { independentRecallAt: progress.independentRecallAt }),
			requires: graphNode.isLeaf ? graphNode.clauses.map(c => [...c]) : item.clauses, related: item.softPrereqs,
		};
	});
	const byId = new Map(nodes.map(node => [node.id, node]));
	function summarizeGroup(node: SkillNode) {
		if (node.leaf) return;
		const children = view.nodes.get(node.id)!.children.map(id => byId.get(id)!);
		for (const child of children) summarizeGroup(child);
		const required = children.filter(child => !child.reinforcementFor);
		node.completed = required.length > 0 && required.every(child => child.completed);
		node.inProgress = !node.completed && children.some(child => child.completed || child.inProgress);
	}
	for (const node of nodes) if (!node.parent) summarizeGroup(node);
	return { domain: snapshot.domainId, title, nodes };
}
