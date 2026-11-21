/**
 * Server persistence and orchestration for adaptive KST diagnostic placement.
 * Stores the serialized particle-filter state atomically at:
 *   <data>/domains/<id>/learner/placement.json
 */

import fs from "node:fs";
import path from "node:path";
import { activeDomainId, PATHS } from "../../config.ts";
import { learnerDir } from "../core/domains/paths.ts";
import { graphIndex, type LearnerGraphView } from "../core/learner/graph-view.ts";
import { particleMarginal, type DiagnosticState } from "../core/learner/kst.ts";
import { LEARNER_CONSTANTS } from "../core/learner/params.ts";
import {
	currentPlacementQuestion,
	deserializeDiagnostic,
	recordPlacementAnswer,
	serializeDiagnostic,
	startPlacement,
	summarizePlacement,
	type PlacementQuestion,
	type PlacementSummary,
	type SerializedDiagnostic,
} from "../core/study/placement.ts";
import { removeLeftoverTemps, writeFileAtomicSync } from "../store/atomic-write.ts";
import { appendStudyEvent, nextStudySeq, readStudyEvents } from "./study-log.ts";
import { loadCurriculum, studyDomains, StudyError } from "./study.ts";

const MAX_PLACEMENT_QUESTIONS = 15;
const MIN_EARLY_FINISH_QUESTIONS = 4;

interface StoredPlacement {
	version: 1;
	domainId: string;
	curriculumHash: string;
	startedAt?: string;
	diagnostic: SerializedDiagnostic | null;
	lastSummary?: PlacementSummary;
	finishedAt?: string;
}

export interface DomainPlacementStatus {
	active: boolean;
	question: PlacementQuestion | null;
	asked: number;
	maxQuestions: number;
	confidencePct: number;
	lastSummary?: PlacementSummary;
}

export type PlacementAnswerResult =
	| { finished: true; summary: PlacementSummary }
	| { finished: false; question: PlacementQuestion };

function placementFile(domainId: string): string {
	return path.join(learnerDir(PATHS.data, domainId), "placement.json");
}

function requireActiveCurriculum() {
	const id = activeDomainId();
	if (!id) throw new StudyError(409, "Nenhum domínio de estudo ativo.");
	const store = studyDomains();
	const manifest = store.readManifest(id);
	if (!manifest) throw new StudyError(404, `Domínio sem manifesto: ${id}`);
	const profile = store.readProfile(id);
	const cur = loadCurriculum(id, manifest, profile?.goal.targetNodeIds);
	if (!cur) throw new StudyError(409, "Este domínio ainda não tem currículo.");
	return { id, manifest, profile, cur };
}

function readStoredPlacement(domainId: string): StoredPlacement | null {
	const file = placementFile(domainId);
	let raw: string;
	try {
		raw = fs.readFileSync(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	try {
		const parsed = JSON.parse(raw) as Partial<StoredPlacement>;
		if (parsed.version !== 1 || parsed.domainId !== domainId) return null;
		return {
			version: 1,
			domainId,
			curriculumHash: typeof parsed.curriculumHash === "string" ? parsed.curriculumHash : "",
			...(typeof parsed.startedAt === "string" ? { startedAt: parsed.startedAt } : {}),
			diagnostic: parsed.diagnostic ?? null,
			...(parsed.lastSummary ? { lastSummary: parsed.lastSummary } : {}),
			...(typeof parsed.finishedAt === "string" ? { finishedAt: parsed.finishedAt } : {}),
		};
	} catch {
		return null;
	}
}

function writeStoredPlacement(domainId: string, record: StoredPlacement): void {
	const file = placementFile(domainId);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	writeFileAtomicSync(file, JSON.stringify(record, null, "\t"), { allowInPlaceFallback: true });
}

function confidencePctOf(graph: LearnerGraphView, state: DiagnosticState): number {
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

function restoreActiveState(stored: StoredPlacement | null, curriculumHash: string): DiagnosticState | null {
	if (!stored?.diagnostic) return null;
	if (stored.curriculumHash && stored.curriculumHash !== curriculumHash) return null;
	try {
		return deserializeDiagnostic(stored.diagnostic);
	} catch {
		return null;
	}
}

function finalizeState(
	domainId: string,
	curriculumHash: string,
	snapshot: ReturnType<typeof requireActiveCurriculum>["cur"]["snapshot"],
	graph: LearnerGraphView,
	state: DiagnosticState,
): PlacementSummary {
	const events = readStudyEvents(domainId);
	const seq = nextStudySeq(events);
	const at = new Date().toISOString();
	const eventId = `placement-${seq}-${Math.random().toString(36).slice(2, 8)}`;
	const { summary, event } = summarizePlacement(snapshot, graph, state, {
		id: eventId,
		seq,
		at,
		domainId,
	});
	appendStudyEvent(domainId, event);
	writeStoredPlacement(domainId, {
		version: 1,
		domainId,
		curriculumHash,
		diagnostic: null,
		lastSummary: summary,
		finishedAt: at,
	});
	return summary;
}

/** Return the active KST placement status (current question, progress, and last completed summary). */
export function getDomainPlacement(): DomainPlacementStatus {
	const { id, cur } = requireActiveCurriculum();
	const stored = readStoredPlacement(id);
	const state = restoreActiveState(stored, cur.snapshot.certificate.hash);
	if (!state) {
		return {
			active: false,
			question: null,
			asked: 0,
			maxQuestions: MAX_PLACEMENT_QUESTIONS,
			confidencePct: stored?.lastSummary?.confidencePct ?? 0,
			...(stored?.lastSummary ? { lastSummary: stored.lastSummary } : {}),
		};
	}
	const question = currentPlacementQuestion(cur.snapshot, cur.view, state);
	return {
		active: true,
		question,
		asked: state.answers.length,
		maxQuestions: question?.maxQuestions ?? MAX_PLACEMENT_QUESTIONS,
		confidencePct: question?.confidencePct ?? confidencePctOf(cur.view, state),
		...(stored?.lastSummary ? { lastSummary: stored.lastSummary } : {}),
	};
}

/** Start a fresh KST adaptive placement for the active domain and return the first question. */
export function startDomainPlacement(seed?: string): DomainPlacementStatus {
	const { id, cur } = requireActiveCurriculum();
	const effectiveSeed = seed && seed.trim()
		? seed.trim()
		: `${id}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
	const state = startPlacement(cur.view, effectiveSeed);
	const previous = readStoredPlacement(id);
	writeStoredPlacement(id, {
		version: 1,
		domainId: id,
		curriculumHash: cur.snapshot.certificate.hash,
		startedAt: new Date().toISOString(),
		diagnostic: serializeDiagnostic(state),
		...(previous?.lastSummary ? { lastSummary: previous.lastSummary } : {}),
	});
	const question = currentPlacementQuestion(cur.snapshot, cur.view, state);
	return {
		active: question !== null,
		question,
		asked: state.answers.length,
		maxQuestions: question?.maxQuestions ?? MAX_PLACEMENT_QUESTIONS,
		confidencePct: question?.confidencePct ?? confidencePctOf(cur.view, state),
		...(previous?.lastSummary ? { lastSummary: previous.lastSummary } : {}),
	};
}

/** Record one placement answer; automatically finalizes and persists the diagnostic event on convergence or cap. */
export function answerDomainPlacement(nodeId: string, correct: boolean): PlacementAnswerResult {
	const { id, cur } = requireActiveCurriculum();
	const hash = cur.snapshot.certificate.hash;
	const stored = readStoredPlacement(id);
	const state = restoreActiveState(stored, hash);
	if (!state) throw new StudyError(409, "Nenhum teste de nivelamento em andamento.");
	if (!cur.view.nodes.has(nodeId)) throw new StudyError(400, `Habilidade inválida para este domínio: ${nodeId}`);

	const nextState = recordPlacementAnswer(state, cur.view, nodeId, correct);
	const nextQuestion = currentPlacementQuestion(cur.snapshot, cur.view, nextState);
	if (!nextQuestion) {
		const summary = finalizeState(id, hash, cur.snapshot, cur.view, nextState);
		return { finished: true, summary };
	}

	writeStoredPlacement(id, {
		version: 1,
		domainId: id,
		curriculumHash: hash,
		...(stored?.startedAt ? { startedAt: stored.startedAt } : {}),
		diagnostic: serializeDiagnostic(nextState),
		...(stored?.lastSummary ? { lastSummary: stored.lastSummary } : {}),
	});
	return { finished: false, question: nextQuestion };
}

/** Finalize an in-progress placement early once at least 4 answers have been recorded. */
export function finishDomainPlacement(): { finished: true; summary: PlacementSummary } {
	const { id, cur } = requireActiveCurriculum();
	const hash = cur.snapshot.certificate.hash;
	const stored = readStoredPlacement(id);
	const state = restoreActiveState(stored, hash);
	if (!state) throw new StudyError(409, "Nenhum teste de nivelamento em andamento.");
	if (state.answers.length < MIN_EARLY_FINISH_QUESTIONS) {
		throw new StudyError(400, `Responda pelo menos ${MIN_EARLY_FINISH_QUESTIONS} perguntas antes de concluir o nivelamento.`);
	}
	const summary = finalizeState(id, hash, cur.snapshot, cur.view, state);
	return { finished: true, summary };
}

/** Cancel and remove placement.json for the active domain. */
export function cancelDomainPlacement(): { cancelled: true } {
	const id = activeDomainId();
	if (!id) throw new StudyError(409, "Nenhum domínio de estudo ativo.");
	const file = placementFile(id);
	fs.rmSync(file, { force: true });
	removeLeftoverTemps(file);
	return { cancelled: true };
}
