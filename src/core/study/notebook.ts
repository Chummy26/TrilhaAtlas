/**
 * Domain study notebook aggregator: groups learner mistakes (low-grade evidence
 * and reinforcement verdicts), misconception beliefs (Beta posterior), and
 * mastered/completed concept summaries per curriculum unit/module.
 *
 * Pure and browser-safe: no Node APIs, no I/O, no wall clock.
 */

import type { CurriculumItem, CurriculumSnapshot } from "../curriculum/types.ts";
import type { LearnerGraphView } from "../learner/graph-view.ts";
import type { Grade, ItemFormat, LearnerEvent, LearnerSnapshot } from "../learner/types.ts";

export interface NotebookMistake {
	id: string;
	kind: "evidence" | "reinforce";
	nodeId: string;
	nodeTitle: string;
	at: string;
	sessionId?: string;
	grade?: Grade;
	format?: ItemFormat;
	quizContext?: { question: string; answer: string; expected?: string };
	feedback?: string;
}

export interface NotebookMisconception {
	id: string;
	nodeId: string;
	nodeTitle: string;
	text: string;
	probability: number;
	status: "active" | "resolved";
	lastSeenAt: string;
}

export interface NotebookMasteredConcept {
	nodeId: string;
	title: string;
	summary: string;
	objectives: string[];
	mastered: boolean;
	durable: boolean;
	completedAt?: string;
}

export interface NotebookModuleEntry {
	moduleId: string;
	moduleTitle: string;
	areaTitle?: string;
	mistakes: NotebookMistake[];
	misconceptions: NotebookMisconception[];
	masteredConcepts: NotebookMasteredConcept[];
}

export interface DomainNotebook {
	domainId: string;
	at: string;
	totalMistakes: number;
	activeMisconceptions: number;
	resolvedMisconceptions: number;
	totalMasteredConcepts: number;
	modules: NotebookModuleEntry[];
}

export interface BuildDomainNotebookInput {
	domainId: string;
	snapshot: CurriculumSnapshot;
	graph: LearnerGraphView;
	learner: LearnerSnapshot;
	events: readonly LearnerEvent[];
	at: string;
}

const ACTIVE_MISCONCEPTION_THRESHOLD = 0.35;

function round4(value: number): number {
	return Math.round(value * 10_000) / 10_000;
}

function parseMs(iso: string): number {
	const ms = Date.parse(iso);
	return Number.isFinite(ms) ? ms : 0;
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

function moduleOfNode(snapshot: CurriculumSnapshot, nodeId: string): { id: string; title: string; areaTitle?: string } | null {
	const raw = snapshot.items[nodeId];
	if (!raw) return null;
	const target = raw.reinforcementFor ? (snapshot.items[raw.reinforcementFor] ?? raw) : raw;
	const unit = inheritedGroup(snapshot, target, "unit");
	const area = inheritedGroup(snapshot, target, "area");
	return {
		id: unit.id,
		title: unit.title.pt,
		...(area.id !== unit.id ? { areaTitle: area.title.pt } : {}),
	};
}

function normalizeKey(text: string): string {
	return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Build the per-module study notebook (mistakes, misconceptions, and mastered notes). */
export function buildDomainNotebook(input: BuildDomainNotebookInput): DomainNotebook {
	const { domainId, snapshot, graph, learner, events, at } = input;

	// Establish didactic module ordering from the projected graph.
	const moduleOrder = new Map<string, number>();
	const moduleMeta = new Map<string, { id: string; title: string; areaTitle?: string }>();
	const ensureModule = (nodeId: string): string | null => {
		const mod = moduleOfNode(snapshot, nodeId);
		if (!mod) return null;
		if (!moduleMeta.has(mod.id)) {
			moduleOrder.set(mod.id, moduleOrder.size);
			moduleMeta.set(mod.id, mod);
		}
		return mod.id;
	};

	for (const id of graph.ids) {
		if (!graph.nodes.get(id)?.isLeaf) continue;
		ensureModule(id);
	}

	const mistakesByModule = new Map<string, { entry: NotebookMistake; seq: number }[]>();
	const pushMistake = (moduleId: string, entry: NotebookMistake, seq: number): void => {
		const list = mistakesByModule.get(moduleId) ?? [];
		list.push({ entry, seq });
		mistakesByModule.set(moduleId, list);
	};

	for (const event of events) {
		if (event.kind === "evidence") {
			const ev = event.evidence;
			if (ev.domainId !== domainId || ev.grade >= 2) continue;
			const nodeId = ev.nodes.find((n) => n.primary)?.nodeId ?? ev.nodes[0]?.nodeId;
			if (!nodeId) continue;
			const moduleId = ensureModule(nodeId);
			if (!moduleId) continue;
			const nodeTitle = graph.nodes.get(nodeId)?.title ?? snapshot.items[nodeId]?.title.pt ?? nodeId;
			const entry: NotebookMistake = {
				id: ev.id,
				kind: "evidence",
				nodeId,
				nodeTitle,
				at: ev.at,
				sessionId: ev.sessionId,
				grade: ev.grade,
				format: ev.format,
				...(ev.quizContext ? { quizContext: { ...ev.quizContext } } : {}),
			};
			pushMistake(moduleId, entry, ev.seq);
		} else if (event.kind === "lesson-finished") {
			if (event.domainId !== domainId || event.outcome !== "reinforce") continue;
			const moduleId = ensureModule(event.nodeId);
			if (!moduleId) continue;
			const nodeTitle = graph.nodes.get(event.nodeId)?.title ?? snapshot.items[event.nodeId]?.title.pt ?? event.nodeId;
			const entry: NotebookMistake = {
				id: event.id,
				kind: "reinforce",
				nodeId: event.nodeId,
				nodeTitle,
				at: event.at,
				feedback: event.feedback ?? "Retome este tópico para consolidar os objetivos pendentes.",
			};
			pushMistake(moduleId, entry, event.seq);
		}
	}

	const misconceptionsByModule = new Map<string, NotebookMisconception[]>();
	for (const [nodeId, st] of Object.entries(learner.nodes)) {
		const entries = Object.entries(st.misconceptions ?? {});
		if (entries.length === 0) continue;
		const moduleId = ensureModule(nodeId);
		if (!moduleId) continue;
		const nodeTitle = graph.nodes.get(nodeId)?.title ?? snapshot.items[nodeId]?.title.pt ?? nodeId;
		const list = misconceptionsByModule.get(moduleId) ?? [];
		for (const [misconceptionId, belief] of entries) {
			const denom = belief.a + belief.b;
			const probability = denom > 0 ? round4(belief.a / denom) : 0;
			list.push({
				id: misconceptionId,
				nodeId,
				nodeTitle,
				text: belief.text,
				probability,
				status: probability >= ACTIVE_MISCONCEPTION_THRESHOLD ? "active" : "resolved",
				lastSeenAt: belief.lastSeenAt,
			});
		}
		misconceptionsByModule.set(moduleId, list);
	}

	const masteredByModule = new Map<string, NotebookMasteredConcept[]>();
	const seenConceptNodes = new Set<string>();
	const recordConcept = (nodeId: string): void => {
		if (seenConceptNodes.has(nodeId)) return;
		const item = snapshot.items[nodeId];
		if (!item || item.reinforcementFor) return;
		const st = learner.nodes[nodeId];
		if (!st || !(st.masteredAt || st.lessonCompletedAt || st.attainedAt || st.placedAt)) return;
		const moduleId = ensureModule(nodeId);
		if (!moduleId) return;
		seenConceptNodes.add(nodeId);
		const completedAt = st.masteredAt ?? st.lessonCompletedAt ?? st.attainedAt ?? st.placedAt;
		const list = masteredByModule.get(moduleId) ?? [];
		list.push({
			nodeId,
			title: graph.nodes.get(nodeId)?.title ?? item.title.pt,
			summary: item.summary,
			objectives: [...item.objectives],
			mastered: Boolean(st.masteredAt),
			durable: Boolean(st.independentRecallAt || (st.delayedSuccesses ?? 0) >= 1),
			...(completedAt ? { completedAt } : {}),
		});
		masteredByModule.set(moduleId, list);
	};

	for (const id of graph.ids) {
		if (!graph.nodes.get(id)?.isLeaf) continue;
		recordConcept(id);
	}
	for (const nodeId of Object.keys(learner.nodes)) {
		if (graph.nodes.get(nodeId)?.isLeaf) recordConcept(nodeId);
	}

	let totalMistakes = 0;
	let activeMisconceptions = 0;
	let resolvedMisconceptions = 0;
	let totalMasteredConcepts = 0;

	const modules: NotebookModuleEntry[] = [];
	const orderedIds = [...moduleMeta.keys()].sort((a, b) => (moduleOrder.get(a) ?? 0) - (moduleOrder.get(b) ?? 0));

	for (const moduleId of orderedIds) {
		const meta = moduleMeta.get(moduleId)!;
		const rawMistakes = mistakesByModule.get(moduleId) ?? [];
		rawMistakes.sort((a, b) => parseMs(b.entry.at) - parseMs(a.entry.at) || b.seq - a.seq);

		const seenIds = new Set<string>();
		const seenFingerprints = new Set<string>();
		const mistakes: NotebookMistake[] = [];
		for (const { entry } of rawMistakes) {
			if (seenIds.has(entry.id)) continue;
			const fingerprint = entry.kind === "reinforce" && entry.feedback
				? `reinforce:${entry.nodeId}:${normalizeKey(entry.feedback)}`
				: entry.quizContext
					? `quiz:${entry.nodeId}:${normalizeKey(entry.quizContext.question)}|${normalizeKey(entry.quizContext.answer)}`
					: null;
			if (fingerprint && seenFingerprints.has(fingerprint)) continue;
			seenIds.add(entry.id);
			if (fingerprint) seenFingerprints.add(fingerprint);
			mistakes.push(entry);
		}

		const misconceptions = (misconceptionsByModule.get(moduleId) ?? []).slice().sort((a, b) => {
			if (a.status !== b.status) return a.status === "active" ? -1 : 1;
			if (b.probability !== a.probability) return b.probability - a.probability;
			return parseMs(b.lastSeenAt) - parseMs(a.lastSeenAt);
		});

		const masteredConcepts = masteredByModule.get(moduleId) ?? [];

		if (mistakes.length === 0 && misconceptions.length === 0 && masteredConcepts.length === 0) {
			continue;
		}

		totalMistakes += mistakes.length;
		for (const m of misconceptions) {
			if (m.status === "active") activeMisconceptions++;
			else resolvedMisconceptions++;
		}
		totalMasteredConcepts += masteredConcepts.length;

		modules.push({
			moduleId: meta.id,
			moduleTitle: meta.title,
			...(meta.areaTitle ? { areaTitle: meta.areaTitle } : {}),
			mistakes,
			misconceptions,
			masteredConcepts,
		});
	}

	return {
		domainId,
		at,
		totalMistakes,
		activeMisconceptions,
		resolvedMisconceptions,
		totalMasteredConcepts,
		modules,
	};
}
