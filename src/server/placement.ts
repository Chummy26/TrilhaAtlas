/**
 * Server persistence and orchestration for adaptive KST diagnostic placement.
 * Stores the serialized particle-filter state atomically at:
 *   <data>/domains/<id>/learner/placement.json
 */

import fs from "node:fs";
import path from "node:path";
import { activeDomainId, PATHS } from "../../config.ts";
import { learnerDir } from "../core/domains/paths.ts";
import { emit } from "../core/events.ts";
import type { LearnerGraphView } from "../core/learner/graph-view.ts";
import type { DiagnosticState } from "../core/learner/kst.ts";
import {
	currentPlacementQuestion,
	deserializeDiagnostic,
	placementConfidencePct,
	recordPlacementAnswer,
	serializeDiagnostic,
	startPlacement,
	summarizePlacement,
	undoPlacementAnswer,
	type PlacementQuestion,
	type PlacementSummary,
	type SerializedDiagnostic,
} from "../core/study/placement.ts";
import { removeLeftoverTemps, writeFileAtomicSync } from "../store/atomic-write.ts";
import { appendStudyEvent, nextStudySeq, readStudyEvents } from "./study-log.ts";
import { learnerSnapshotOf, loadCurriculum, studyDomains, StudyError } from "./study.ts";

const MAX_PLACEMENT_QUESTIONS = 15;
const MIN_EARLY_FINISH_QUESTIONS = 4;

interface StoredPlacement {
	version: 1;
	domainId: string;
	curriculumHash: string;
	seed?: string;
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
		const seed = typeof parsed.seed === "string" && parsed.seed.trim()
			? parsed.seed.trim()
			: typeof parsed.diagnostic?.seed === "string" && parsed.diagnostic.seed.trim()
				? parsed.diagnostic.seed.trim()
				: undefined;
		return {
			version: 1,
			domainId,
			curriculumHash: typeof parsed.curriculumHash === "string" ? parsed.curriculumHash : "",
			...(seed ? { seed } : {}),
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

function withBackFlag(
	question: PlacementQuestion,
	state: DiagnosticState,
	seed: string | undefined,
	previousAnswer?: boolean,
): PlacementQuestion {
	return {
		...question,
		canGoBack: state.answers.length > 0 && Boolean(seed),
		...(previousAnswer !== undefined ? { previousAnswer } : {}),
	};
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
	const existingSnap = learnerSnapshotOf(domainId, graph, events, at);
	const eventId = `placement-${seq}-${Math.random().toString(36).slice(2, 8)}`;
	const { summary, event } = summarizePlacement(snapshot, graph, state, {
		id: eventId,
		seq,
		at,
		domainId,
	}, existingSnap);
	appendStudyEvent(domainId, event);
	writeStoredPlacement(domainId, {
		version: 1,
		domainId,
		curriculumHash,
		diagnostic: null,
		lastSummary: summary,
		finishedAt: at,
	});
	emit("curriculum-expanded", { domainId, nodeId: summary.recommendedNodeId ?? domainId });
	return summary;
}

/** Return the active KST placement status (current question, progress, and last completed summary). */
export function getDomainPlacement(): DomainPlacementStatus {
	const { id, cur } = requireActiveCurriculum();
	const hash = cur.snapshot.certificate.hash;
	const stored = readStoredPlacement(id);
	const state = restoreActiveState(stored, hash);
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
	if (!question) {
		if (state.answers.length >= MIN_EARLY_FINISH_QUESTIONS) {
			const summary = finalizeState(id, hash, cur.snapshot, cur.view, state);
			return {
				active: false,
				question: null,
				asked: summary.asked,
				maxQuestions: MAX_PLACEMENT_QUESTIONS,
				confidencePct: summary.confidencePct,
				lastSummary: summary,
			};
		}
		return {
			active: false,
			question: null,
			asked: state.answers.length,
			maxQuestions: MAX_PLACEMENT_QUESTIONS,
			confidencePct: placementConfidencePct(cur.view, state),
			...(stored?.lastSummary ? { lastSummary: stored.lastSummary } : {}),
		};
	}
	const seed = stored?.seed;
	return {
		active: true,
		question: withBackFlag(question, state, seed),
		asked: state.answers.length,
		maxQuestions: question.maxQuestions,
		confidencePct: question.confidencePct,
		...(stored?.lastSummary ? { lastSummary: stored.lastSummary } : {}),
	};
}

/** Start a fresh KST adaptive placement for the active domain and return the first question. */
export function startDomainPlacement(seed?: string): DomainPlacementStatus {
	const { id, cur } = requireActiveCurriculum();
	const effectiveSeed = seed && seed.trim()
		? seed.trim()
		: `${id}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
	const state = startPlacement(cur.view, effectiveSeed, cur.snapshot);
	const previous = readStoredPlacement(id);
	writeStoredPlacement(id, {
		version: 1,
		domainId: id,
		curriculumHash: cur.snapshot.certificate.hash,
		seed: effectiveSeed,
		startedAt: new Date().toISOString(),
		diagnostic: serializeDiagnostic(state, effectiveSeed),
		...(previous?.lastSummary ? { lastSummary: previous.lastSummary } : {}),
	});
	const rawQuestion = currentPlacementQuestion(cur.snapshot, cur.view, state);
	const question = rawQuestion ? withBackFlag(rawQuestion, state, effectiveSeed) : null;
	return {
		active: question !== null,
		question,
		asked: state.answers.length,
		maxQuestions: question?.maxQuestions ?? MAX_PLACEMENT_QUESTIONS,
		confidencePct: question?.confidencePct ?? placementConfidencePct(cur.view, state),
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

	const seed = stored?.seed;
	// Guard against double-click / duplicate submissions of an already answered node.
	const lastAnswer = state.answers[state.answers.length - 1];
	if (lastAnswer?.nodeId === nodeId) {
		const currentQ = currentPlacementQuestion(cur.snapshot, cur.view, state);
		if (!currentQ) {
			const summary = finalizeState(id, hash, cur.snapshot, cur.view, state);
			return { finished: true, summary };
		}
		return { finished: false, question: withBackFlag(currentQ, state, seed) };
	}
	if (state.answers.some((a) => a.nodeId === nodeId)) {
		throw new StudyError(409, "Esta pergunta já foi respondida.");
	}

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
		...(seed ? { seed } : {}),
		...(stored?.startedAt ? { startedAt: stored.startedAt } : {}),
		diagnostic: serializeDiagnostic(nextState, seed),
		...(stored?.lastSummary ? { lastSummary: stored.lastSummary } : {}),
	});
	return { finished: false, question: withBackFlag(nextQuestion, nextState, seed) };
}

/** Step back one question in an active placement by replaying the particle filter from its seed. */
export function undoDomainPlacement(): { finished: false; question: PlacementQuestion } {
	const { id, cur } = requireActiveCurriculum();
	const hash = cur.snapshot.certificate.hash;
	const stored = readStoredPlacement(id);
	const state = restoreActiveState(stored, hash);
	if (!state) throw new StudyError(409, "Nenhum teste de nivelamento em andamento.");
	if (state.answers.length === 0) {
		throw new StudyError(400, "Já está na primeira pergunta do nivelamento.");
	}
	const seed = stored?.seed;
	if (!seed) {
		throw new StudyError(409, "Este nivelamento foi iniciado antes do suporte a voltar. Reinicie para habilitar voltar.");
	}
	const rebuilt = undoPlacementAnswer(cur.view, cur.snapshot, state, seed);
	if (!rebuilt) {
		throw new StudyError(400, "Já está na primeira pergunta do nivelamento.");
	}
	const prevQuestion = currentPlacementQuestion(cur.snapshot, cur.view, rebuilt.state);
	if (!prevQuestion) {
		throw new StudyError(409, "Não foi possível restaurar a pergunta anterior.");
	}
	writeStoredPlacement(id, {
		version: 1,
		domainId: id,
		curriculumHash: hash,
		seed,
		...(stored?.startedAt ? { startedAt: stored.startedAt } : {}),
		diagnostic: serializeDiagnostic(rebuilt.state, seed),
		...(stored?.lastSummary ? { lastSummary: stored.lastSummary } : {}),
	});
	return {
		finished: false,
		question: withBackFlag(prevQuestion, rebuilt.state, seed, rebuilt.undoneAnswer.correct),
	};
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
