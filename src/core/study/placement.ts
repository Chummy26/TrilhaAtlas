/**
 * Adaptive KST diagnostic placement wrapper — pure & browser-safe.
 *
 * Wraps `src/core/learner/kst.ts` with lossless JSON serialization for the
 * particle filter (`Uint32Array` bitsets + `Float64Array` weights), a balanced
 * topological skeleton of up to 120 leaves, a 15-question cap, and post-placement
 * frontier/chapter/module recommendations.
 */

import type { CurriculumItem, CurriculumSnapshot } from "../curriculum/types.ts";
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
import type { LearnerEvent, LearnerSnapshot, NodeState } from "../learner/types.ts";
import { activeModuleOf, chapterUnitsOf, studyCampaign } from "./campaign.ts";
import { nodeBrief } from "./projection.ts";

export type PlacementHint = "beginner" | "intermediate" | "advanced";

export function isPlacementHint(value: unknown): value is PlacementHint {
	return value === "beginner" || value === "intermediate" || value === "advanced";
}

export interface SerializedDiagnostic {
	version: 1;
	/** Seed used to initialize the particle filter, enabling exact deterministic undo. */
	seed?: string;
	/** Optional starting-level hint used to calibrate the initial ability prior. */
	hint?: PlacementHint;
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
	/** Short description of the skill/topic (distinct from title/prompt). */
	summary?: string;
	/** Explicit scope contract (what is inside/outside the topic). */
	scope?: string;
	/** Human-readable level badge (e.g. "CEFR B2", "Fundamentos"). */
	levelLabel?: string;
	/** Concrete sample words/items from the curriculum node so the learner can judge accurately. */
	examples?: string[];
	/** Common pitfalls/misconceptions to help self-verify mastery. */
	misconceptions?: string[];
	/** Whether the user can step back to the previous question. */
	canGoBack?: boolean;
	/** Previous choice if the user just stepped back to this question. */
	previousAnswer?: boolean;
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
const CHAPTER_PLACED_OUT_RATIO = 0.8;
const CEFR_DIFFICULTY_ORDER = ["pre-A1", "A1", "A2", "B1", "B2", "C1", "C2"] as const;
const CEFR_DEFAULT_GSE = [15, 25, 36, 50, 66, 80, 88] as const;

function levelSignalOf(item: CurriculumItem | undefined): number | null {
	if (!item) return null;
	if (item.level.scheme === "cefr") {
		if (typeof item.level.gse === "number" && Number.isFinite(item.level.gse)) {
			return item.level.gse;
		}
		const idx = CEFR_DIFFICULTY_ORDER.indexOf(item.level.cefr);
		return idx >= 0 ? CEFR_DEFAULT_GSE[idx]! : null;
	}
	return item.level.band;
}

function buildPlacementDifficulty(
	graph: LearnerGraphView,
	snapshot?: CurriculumSnapshot,
): ((id: string) => number) | undefined {
	const ids = graph.ids;
	if (ids.length === 0) return undefined;

	const canonicalLeaves = ids.filter((id) => {
		const node = graph.nodes.get(id);
		return Boolean(node?.isLeaf && !node.reinforcementFor);
	});
	const zeroDepthLeaves = canonicalLeaves.filter((id) => (graph.nodes.get(id)?.depth ?? 0) === 0).length;
	const isFlatGraph = canonicalLeaves.length > 0 && zeroDepthLeaves / canonicalLeaves.length > 0.35;

	let maxDepth = 0;
	for (const id of ids) {
		const d = graph.nodes.get(id)?.depth ?? 0;
		if (d > maxDepth) maxDepth = d;
	}

	const levelRaw = new Map<string, number>();
	let minLevel = Infinity;
	let maxLevel = -Infinity;
	if (snapshot) {
		for (const id of ids) {
			const val = levelSignalOf(snapshot.items[id]);
			if (val !== null) {
				levelRaw.set(id, val);
				if (val < minLevel) minLevel = val;
				if (val > maxLevel) maxLevel = val;
			}
		}
	}
	const hasLevelSpread = levelRaw.size > 0 && maxLevel > minLevel;

	// Deep DAGs without explicit snapshot levels use KST's standard depthDifficulty.
	if (!hasLevelSpread && !isFlatGraph) return undefined;

	const maxPos = Math.max(1, ids.length - 1);
	const raw = new Map<string, number>();
	let sum = 0;
	for (let i = 0; i < ids.length; i++) {
		const id = ids[i]!;
		const depthNorm = maxDepth > 0 ? (graph.nodes.get(id)?.depth ?? 0) / maxDepth : 0;
		const posNorm = i / maxPos;
		let score: number;
		if (hasLevelSpread) {
			const lv = levelRaw.get(id);
			const levelNorm = lv !== undefined ? (lv - minLevel) / (maxLevel - minLevel) : posNorm;
			score = isFlatGraph
				? 0.75 * levelNorm + 0.15 * posNorm + 0.10 * depthNorm
				: 0.55 * levelNorm + 0.35 * depthNorm + 0.10 * posNorm;
		} else {
			score = 0.75 * posNorm + 0.25 * depthNorm;
		}
		raw.set(id, score);
		sum += score;
	}
	const mean = sum / ids.length;
	let variance = 0;
	for (const val of raw.values()) variance += (val - mean) ** 2;
	const sd = Math.sqrt(variance / ids.length) || 1;
	return (id: string) => ((raw.get(id) ?? mean) - mean) / sd;
}

const EE_BAND_LABELS: readonly string[] = [
	"Fundamentos",
	"Técnico",
	"Graduação",
	"Avançado",
	"Pós-graduação",
];

function levelLabelOf(item: CurriculumItem | undefined): string | undefined {
	if (!item) return undefined;
	if (item.level.scheme === "cefr") return `CEFR ${item.level.cefr}`;
	if (item.level.scheme === "ee") return EE_BAND_LABELS[item.level.band] ?? `Faixa ${item.level.band}`;
	return `Nível ${item.level.band}`;
}

function examplesOf(item: CurriculumItem | undefined): string[] {
	if (!item?.lexicalItems?.length) return [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const lex of item.lexicalItems) {
		const lemma = lex.lemma.trim();
		if (!lemma) continue;
		const key = lemma.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(lemma);
		if (out.length >= 12) break;
	}
	return out;
}

/** Convergence percentage of the KST particle filter, scaled from 0% before the first answer. */
export function placementConfidencePct(graph: LearnerGraphView, state: DiagnosticState): number {
	if (state.skeleton.length === 0) return 100;
	if (state.answers.length === 0) return 0;
	const pos = graphIndex(graph).pos;
	const { stopLo, stopHi } = LEARNER_CONSTANTS.particles;
	let resolved = 0;
	for (const id of state.skeleton) {
		const idx = pos.get(id);
		if (idx === undefined) continue;
		const p = particleMarginal(state, idx);
		if (p < stopLo || p > stopHi) resolved++;
	}
	const rawRatio = resolved / state.skeleton.length;
	const ramp = Math.min(1, state.answers.length / PLACEMENT_MIN_QUESTIONS);
	return Math.max(0, Math.min(100, Math.round(rawRatio * ramp * 100)));
}

const PLACEMENT_HINT_PRIOR: Record<PlacementHint, number> = {
	beginner: -0.85,
	intermediate: 0,
	advanced: 0.95,
};

function balancedSkeleton(graph: LearnerGraphView, max = PLACEMENT_SKELETON_MAX, snapshot?: CurriculumSnapshot): string[] {
	const canonicalLeaves = graph.ids.filter((id) => {
		const node = graph.nodes.get(id);
		return Boolean(node?.isLeaf && !node.reinforcementFor);
	});
	if (canonicalLeaves.length === 0) return defaultSkeleton(graph, max);
	if (canonicalLeaves.length <= max) return canonicalLeaves;
	// Ensure foundation/entry nodes have strong coverage alongside balanced sampling across the full tree.
	const picked = new Set<string>();
	const out: string[] = [];
	if (snapshot) {
		const early = canonicalLeaves.filter((id) => {
			const lv = snapshot.items[id]?.level;
			if (!lv) return false;
			if (lv.scheme === "cefr") return lv.cefr === "pre-A1" || lv.cefr === "A1";
			return lv.band === 0;
		});
		const earlyQuota = Math.min(early.length, Math.max(8, Math.floor(max * 0.2)));
		for (let i = 0; i < earlyQuota; i++) {
			const id = early[Math.floor((i * early.length) / earlyQuota)]!;
			if (!picked.has(id)) {
				picked.add(id);
				out.push(id);
			}
		}
	}
	for (let i = 0; i < max && out.length < max; i++) {
		const id = canonicalLeaves[Math.floor((i * canonicalLeaves.length) / max)]!;
		if (!picked.has(id)) {
			picked.add(id);
			out.push(id);
		}
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
	// Keep acronyms (e.g. IPA, MOSFET, RC) uppercase while lowercasing sentence-case starts.
	const lower = cleaned.replace(/^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ](?![A-ZÁÀÂÃÉÊÍÓÔÕÚÇ])/u, (ch) => ch.toLowerCase());
	return `Sem consultar anotações, você consegue hoje, com segurança, ${lower}?`;
}

/** Lossless JSON-safe serialization of a KST particle-filter DiagnosticState. */
export function serializeDiagnostic(
	state: DiagnosticState,
	seed?: string,
	hint?: PlacementHint,
): SerializedDiagnostic {
	return {
		version: 1,
		...(seed ? { seed } : {}),
		...(hint ? { hint } : {}),
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
export function startPlacement(
	graph: LearnerGraphView,
	seed: string,
	snapshot?: CurriculumSnapshot,
	hint?: PlacementHint,
): DiagnosticState {
	const skeleton = balancedSkeleton(graph, PLACEMENT_SKELETON_MAX, snapshot);
	const difficulty = buildPlacementDifficulty(graph, snapshot);
	const priorMean = hint ? PLACEMENT_HINT_PRIOR[hint] : undefined;
	return startDiagnostic(graph, {
		seed,
		skeleton,
		...(difficulty ? { difficulty } : {}),
		...(priorMean !== undefined ? { priorMean } : {}),
	});
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
	const item = snapshot.items[nodeId];
	const brief = nodeBrief(snapshot, nodeId);
	const title = brief?.title ?? graph.nodes.get(nodeId)?.title ?? nodeId;
	const path = brief?.path ?? [];
	const objectives = brief?.objectives ?? item?.objectives ?? [];
	const summary = (brief?.summary ?? item?.summary ?? "").trim();
	const scope = (brief?.scope ?? item?.scope ?? "").trim();
	const levelLabel = levelLabelOf(item);
	const examples = examplesOf(item);
	const misconceptions = (brief?.misconceptions ?? item?.misconceptions ?? [])
		.map((m) => m.trim())
		.filter(Boolean)
		.slice(0, 3);
	const showSummary = summary && summary.toLowerCase() !== title.trim().toLowerCase() ? summary : undefined;
	return {
		nodeId,
		title,
		path,
		prompt: buildPlacementPrompt(snapshot, nodeId, title),
		objectives: [...objectives],
		...(showSummary ? { summary: showSummary } : {}),
		...(scope ? { scope } : {}),
		...(levelLabel ? { levelLabel } : {}),
		...(examples.length > 0 ? { examples } : {}),
		...(misconceptions.length > 0 ? { misconceptions } : {}),
		canGoBack: asked > 0,
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

/**
 * Step back one placement answer by deterministically replaying the particle
 * filter from `seed` over `answers.slice(0, -1)`. Returns null at question 1.
 */
export function undoPlacementAnswer(
	graph: LearnerGraphView,
	snapshot: CurriculumSnapshot,
	state: DiagnosticState,
	seed: string,
	hint?: PlacementHint,
): { state: DiagnosticState; undoneAnswer: DiagnosticAnswer } | null {
	if (state.answers.length === 0) return null;
	const undoneAnswer = state.answers[state.answers.length - 1]!;
	const priorAnswers = state.answers.slice(0, -1);
	let rebuilt = startPlacement(graph, seed, snapshot, hint);
	for (const answer of priorAnswers) {
		rebuilt = recordDiagnosticAnswer(rebuilt, graph, answer);
	}
	return { state: rebuilt, undoneAnswer };
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
	existingLearner?: Pick<LearnerSnapshot, "nodes"> | null,
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

	// Preserve existing attained/verified/completed learner progress before merging
	// new placement estimates so re-running placement never regresses completed work.
	if (existingLearner?.nodes) {
		for (const [nodeId, nodeState] of Object.entries(existingLearner.nodes)) {
			if (nodeState) virtualNodes[nodeId] = { ...nodeState };
		}
	}

	for (const estimate of estimates) {
		if (!leafSet.has(estimate.nodeId)) continue;
		if (estimate.p >= PLACEMENT_THRESHOLD) {
			placedNodeIds.push(estimate.nodeId);
			const existing = virtualNodes[estimate.nodeId];
			if (!existing) {
				const version = graph.nodes.get(estimate.nodeId)?.version ?? 1;
				virtualNodes[estimate.nodeId] = minimalPlacedNodeState(estimate.nodeId, version, estimate.p, meta.at);
			} else if (!existing.verified && !existing.attainedAt && !existing.lessonCompletedAt) {
				virtualNodes[estimate.nodeId] = {
					...existing,
					pL: Math.max(existing.pL, estimate.p),
					placedAt: existing.placedAt ?? meta.at,
				};
			}
		}
	}

	const struct = structuralState({ nodes: virtualNodes }, graph);
	const frontierNodeIds = struct.frontier.filter((id) => leafSet.has(id));
	const effectiveFrontier = frontierNodeIds.length > 0 ? frontierNodeIds : struct.frontier;

	const campaign = studyCampaign(snapshot, graph, struct.known);
	const structure = chapterUnitsOf(snapshot, graph, campaign);
	const chapterIndexByNode = new Map<string, number>();
	for (const cu of structure) {
		for (const mod of cu.modules) {
			for (const leafId of mod.leafIds) {
				chapterIndexByNode.set(leafId, cu.chapterIndex);
			}
		}
	}

	// Pick the first chapter where the learner has NOT effectively placed out (< 80% known),
	// so stray unplaced beginner leaves never drag an advanced learner back to A1 / Etapa 1.
	const targetChapterIdx = (() => {
		const belowPlacedOut = campaign.journey.findIndex(
			(c) => c.total > 0 && c.known / c.total < CHAPTER_PLACED_OUT_RATIO,
		);
		if (belowPlacedOut >= 0) return belowPlacedOut;
		for (let i = campaign.journey.length - 1; i >= 0; i--) {
			const c = campaign.journey[i]!;
			if (c.known < c.total) return i;
		}
		return campaign.journey.length > 0 ? campaign.journey.length - 1 : -1;
	})();

	const targetChapterFrontier = targetChapterIdx >= 0
		? effectiveFrontier.filter((id) => chapterIndexByNode.get(id) === targetChapterIdx)
		: [];
	const candidateFrontier = targetChapterFrontier.length > 0
		? targetChapterFrontier
		: effectiveFrontier;

	let recommendedNodeId: string | undefined;
	let bestRank = -Infinity;
	let bestPriority = -Infinity;
	for (const id of candidateFrontier) {
		const chIdx = chapterIndexByNode.get(id) ?? -1;
		const prio = campaign.priority(id);
		// When falling back outside targetChapter, prefer the highest frontier chapter first.
		const rank = targetChapterFrontier.length > 0 ? 0 : chIdx;
		if (rank > bestRank || (rank === bestRank && prio > bestPriority)) {
			bestRank = rank;
			bestPriority = prio;
			recommendedNodeId = id;
		}
	}
	if (!recommendedNodeId) recommendedNodeId = candidateFrontier[0];

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
	const targetChapter = targetChapterIdx >= 0 ? campaign.journey[targetChapterIdx] : campaign.journey.at(-1);
	const recommendedChapter = activeMod
		? { level: activeMod.chapterLevel, title: activeMod.chapterTitle }
		: targetChapter
			? { level: targetChapter.level, title: targetChapter.title }
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
