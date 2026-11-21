/**
 * Adaptive KST diagnostic placement wrapper — pure & browser-safe.
 *
 * Wraps `src/core/learner/kst.ts` with lossless JSON serialization for the
 * particle filter (`Uint32Array` bitsets + `Float64Array` weights), a balanced
 * topological skeleton of up to 120 leaves, a 15-question cap, and post-placement
 * frontier/chapter/module recommendations.
 */

import type { CurriculumSnapshot } from "../curriculum/types.ts";
import { graphIndex, type LearnerGraphView } from "../learner/graph-view.ts";
import {
	defaultSkeleton,
	diagnosticEstimates,
	diagnosticEvent,
	nextDiagnosticQuestion,
	particleMarginal,
	recordDiagnosticAnswer,
	shouldStopDiagnostic,
	startDiagnostic,
	structuralState,
	type DiagnosticAnswer,
	type DiagnosticState,
} from "../learner/kst.ts";
import { LEARNER_CONSTANTS } from "../learner/params.ts";
import type { LearnerEvent, NodeState } from "../learner/types.ts";
import { activeModuleOf, studyCampaign } from "./campaign.ts";
import { nodeBrief } from "./projection.ts";

export interface SerializedDiagnostic {
	version: 1;
	ids: string[];
	words: number;
	count: number;
	/** Unsigned 32-bit particle bitset words (length = count * words). */
	bits: number[];
	/** IEEE-754 particle weights (length = count). */
	weights: number[];
	rngState: number;
	skeleton: string[];
	answers: DiagnosticAnswer[];
}

export interface PlacementQuestion {
	nodeId: string;
	title: string;
	path: string[];
	prompt: string;
	objectives: string[];
	asked: number;
	minQuestions: number;
	maxQuestions: number;
	confidencePct: number;
}

export interface PlacementSummary {
	asked: number;
	correctCount: number;
	totalLeaves: number;
	placedCount: number;
	placedPct: number;
	placedNodeIds: string[];
	frontierNodeIds: string[];
	recommendedChapter?: { level: string; title: string };
	recommendedModule?: { id: string; title: string; chapterLevel: string; chapterTitle: string };
	recommendedNodeId?: string;
	recommendedNodeTitle?: string;
	confidencePct: number;
	message: string;
}

const PLACEMENT_MIN_QUESTIONS = 8;
const PLACEMENT_MAX_QUESTIONS = 15;
const PLACEMENT_SKELETON_MAX = 120;
const PLACEMENT_THRESHOLD = 0.85;

function placementConfidencePct(graph: LearnerGraphView, state: DiagnosticState): number {
	if (state.skeleton.length === 0) return 100;
	const pos = graphIndex(graph).pos;
	const { stopLo, stopHi } = LEARNER_CONSTANTS.particles;
	let resolved = 0;
	for (const id of state.skeleton) {
		const idx = pos.get(id);
		if (idx === undefined) continue;
		const p = particleMarginal(state, idx);
		if (p < stopLo || p > stopHi) resolved++;
	}
	return Math.max(0, Math.min(100, Math.round((resolved / state.skeleton.length) * 100)));
}

function balancedSkeleton(graph: LearnerGraphView, max = PLACEMENT_SKELETON_MAX): string[] {
	const canonicalLeaves = graph.ids.filter((id) => {
		const node = graph.nodes.get(id);
		return Boolean(node?.isLeaf && !node.reinforcementFor);
	});
	if (canonicalLeaves.length === 0) return defaultSkeleton(graph, max);
	if (canonicalLeaves.length <= max) return canonicalLeaves;
	const out: string[] = [];
	for (let i = 0; i < max; i++) {
		out.push(canonicalLeaves[Math.floor((i * canonicalLeaves.length) / max)]!);
	}
	return out;
}

function buildPlacementPrompt(snapshot: CurriculumSnapshot, nodeId: string, title: string): string {
	const item = snapshot.items[nodeId];
	const target = item?.practice?.exitCriterion?.trim()
		|| item?.objectives[0]?.trim()
		|| item?.summary?.trim()
		|| title;
	const cleaned = target.replace(/[.!?]+$/u, "");
	const lower = cleaned.replace(/^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]/u, (ch) => ch.toLowerCase());
	return `Sem consultar anotações, você consegue hoje, com segurança, ${lower}?`;
}

/** Lossless JSON-safe serialization of a KST particle-filter DiagnosticState. */
export function serializeDiagnostic(state: DiagnosticState): SerializedDiagnostic {
	return {
		version: 1,
		ids: [...state.ids],
		words: state.words,
		count: state.count,
		bits: Array.from(state.bits),
		weights: Array.from(state.weights),
		rngState: state.rngState >>> 0,
		skeleton: [...state.skeleton],
		answers: state.answers.map((answer) => ({
			nodeId: answer.nodeId,
			correct: answer.correct,
			...(answer.options !== undefined ? { options: answer.options } : {}),
		})),
	};
}

/** Restore a DiagnosticState losslessly from SerializedDiagnostic. */
export function deserializeDiagnostic(raw: SerializedDiagnostic): DiagnosticState {
	if (!Number.isInteger(raw.count) || raw.count <= 0 || !Number.isInteger(raw.words) || raw.words <= 0) {
		throw new Error("Estado de nivelamento serializado inválido: dimensões incompatíveis.");
	}
	if (raw.bits.length !== raw.count * raw.words) {
		throw new Error(`Tamanho de bits inválido no nivelamento: esperado ${raw.count * raw.words}, recebido ${raw.bits.length}.`);
	}
	if (raw.weights.length !== raw.count) {
		throw new Error(`Tamanho de weights inválido no nivelamento: esperado ${raw.count}, recebido ${raw.weights.length}.`);
	}
	return {
		ids: [...raw.ids],
		words: raw.words,
		count: raw.count,
		bits: new Uint32Array(raw.bits),
		weights: new Float64Array(raw.weights),
		rngState: raw.rngState >>> 0,
		skeleton: [...raw.skeleton],
		answers: raw.answers.map((answer) => ({
			nodeId: answer.nodeId,
			correct: answer.correct,
			...(answer.options !== undefined ? { options: answer.options } : {}),
		})),
	};
}

/** Initialize an adaptive KST placement over up to 120 balanced topological leaves. */
export function startPlacement(graph: LearnerGraphView, seed: string): DiagnosticState {
	const skeleton = balancedSkeleton(graph, PLACEMENT_SKELETON_MAX);
	return startDiagnostic(graph, { seed, skeleton });
}

/** Current half-split placement question, or null when converged or capped at 15 answers. */
export function currentPlacementQuestion(
	snapshot: CurriculumSnapshot,
	graph: LearnerGraphView,
	state: DiagnosticState,
): PlacementQuestion | null {
	const asked = state.answers.length;
	if (asked >= PLACEMENT_MAX_QUESTIONS || shouldStopDiagnostic(state)) return null;
	const nodeId = nextDiagnosticQuestion(state);
	if (!nodeId) return null;
	const brief = nodeBrief(snapshot, nodeId);
	const title = brief?.title ?? graph.nodes.get(nodeId)?.title ?? nodeId;
	const path = brief?.path ?? [];
	const objectives = brief?.objectives ?? snapshot.items[nodeId]?.objectives ?? [];
	return {
		nodeId,
		title,
		path,
		prompt: buildPlacementPrompt(snapshot, nodeId, title),
		objectives: [...objectives],
		asked,
		minQuestions: PLACEMENT_MIN_QUESTIONS,
		maxQuestions: PLACEMENT_MAX_QUESTIONS,
		confidencePct: placementConfidencePct(graph, state),
	};
}

/** Fold one placement answer into the KST particle filter (immutable). */
export function recordPlacementAnswer(
	state: DiagnosticState,
	graph: LearnerGraphView,
	nodeId: string,
	correct: boolean,
): DiagnosticState {
	return recordDiagnosticAnswer(state, graph, { nodeId, correct });
}

function minimalPlacedNodeState(nodeId: string, version: number, p: number, at: string): NodeState {
	return {
		nodeId,
		nodeVersion: version,
		pL: p,
		nEff: LEARNER_CONSTANTS.diagnosticNEff,
		verified: false,
		desiredRetention: 0.9,
		levelElo: [0, 0, 0, 0, 0],
		blame: 0,
		misconceptions: {},
		correctFamilies: [],
		delayedSuccesses: 0,
		inferred: true,
		placedAt: at,
	};
}

/** Produce the diagnostic LearnerEvent and post-placement frontier recommendation. */
export function summarizePlacement(
	snapshot: CurriculumSnapshot,
	graph: LearnerGraphView,
	state: DiagnosticState,
	meta: { id: string; seq: number; at: string; domainId: string },
): { summary: PlacementSummary; event: LearnerEvent } {
	const event = diagnosticEvent(state, meta);
	const estimates = diagnosticEstimates(state);

	const canonicalLeaves = graph.ids.filter((id) => {
		const node = graph.nodes.get(id);
		return Boolean(node?.isLeaf && !node.reinforcementFor);
	});
	const leafIds = canonicalLeaves.length > 0
		? canonicalLeaves
		: graph.ids.filter((id) => Boolean(graph.nodes.get(id)?.isLeaf));
	const leafSet = new Set(leafIds);

	const placedNodeIds: string[] = [];
	const virtualNodes: Record<string, NodeState> = {};
	for (const estimate of estimates) {
		if (!leafSet.has(estimate.nodeId)) continue;
		if (estimate.p >= PLACEMENT_THRESHOLD) {
			placedNodeIds.push(estimate.nodeId);
			const version = graph.nodes.get(estimate.nodeId)?.version ?? 1;
			virtualNodes[estimate.nodeId] = minimalPlacedNodeState(estimate.nodeId, version, estimate.p, meta.at);
		}
	}

	const struct = structuralState({ nodes: virtualNodes }, graph);
	const frontierNodeIds = struct.frontier.filter((id) => leafSet.has(id));
	const effectiveFrontier = frontierNodeIds.length > 0 ? frontierNodeIds : struct.frontier;

	const campaign = studyCampaign(snapshot, graph, struct.known);
	let recommendedNodeId: string | undefined;
	let bestPriority = -Infinity;
	for (const id of effectiveFrontier) {
		const prio = campaign.priority(id);
		if (prio > bestPriority) {
			bestPriority = prio;
			recommendedNodeId = id;
		}
	}
	if (!recommendedNodeId) recommendedNodeId = effectiveFrontier[0];

	const recommendedNodeTitle = recommendedNodeId
		? (snapshot.items[recommendedNodeId]?.title.pt ?? graph.nodes.get(recommendedNodeId)?.title ?? recommendedNodeId)
		: undefined;

	const activeMod = activeModuleOf(
		snapshot,
		graph,
		campaign,
		struct.known,
		new Set(struct.frontier),
		recommendedNodeId,
	);
	const firstOpenChapter = campaign.journey.find((c) => c.known < c.total) ?? campaign.journey.at(-1);
	const recommendedChapter = activeMod
		? { level: activeMod.chapterLevel, title: activeMod.chapterTitle }
		: firstOpenChapter
			? { level: firstOpenChapter.level, title: firstOpenChapter.title }
			: undefined;
	const recommendedModule = activeMod
		? {
			id: activeMod.id,
			title: activeMod.title,
			chapterLevel: activeMod.chapterLevel,
			chapterTitle: activeMod.chapterTitle,
		}
		: undefined;

	const totalLeaves = leafIds.length;
	const placedCount = placedNodeIds.length;
	const placedPct = totalLeaves > 0 ? Math.round((placedCount / totalLeaves) * 100) : 0;
	const asked = state.answers.length;
	const correctCount = state.answers.filter((a) => a.correct).length;
	const confidencePct = placementConfidencePct(graph, state);

	const targetLabel = recommendedModule
		? `${recommendedModule.chapterLevel} · ${recommendedModule.title}`
		: recommendedChapter
			? `${recommendedChapter.level} · ${recommendedChapter.title}`
			: "início da trilha";
	const message = placedCount > 0
		? `Nivelamento concluído (${asked} perguntas): ${placedCount}/${totalLeaves} habilidades posicionadas (${placedPct}%). Ponto de partida recomendado: ${targetLabel}.`
		: `Nivelamento concluído (${asked} perguntas): recomendamos começar pelos fundamentos em ${targetLabel}.`;

	return {
		summary: {
			asked,
			correctCount,
			totalLeaves,
			placedCount,
			placedPct,
			placedNodeIds,
			frontierNodeIds: effectiveFrontier,
			...(recommendedChapter ? { recommendedChapter } : {}),
			...(recommendedModule ? { recommendedModule } : {}),
			...(recommendedNodeId ? { recommendedNodeId } : {}),
			...(recommendedNodeTitle ? { recommendedNodeTitle } : {}),
			confidencePct,
			message,
		},
		event,
	};
}
