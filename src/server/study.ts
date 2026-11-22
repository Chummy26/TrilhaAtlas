/**
 * Study service (estudos-sota integration; docs/research/00-SINTESE.md §2.2,
 * §2.3, §2.6): study domains, the curriculum per domain, the learner event
 * log and the single "Hoje" suggestion.
 *
 *   <data>/profile/active-domain.json            which world is open
 *   <data>/domains/<id>/curriculum/ledger.jsonl  patch ledger (entry 0 = seed)
 *   <data>/domains/<id>/curriculum/snapshot.json validated snapshot
 *   <data>/domains/<id>/learner/events.jsonl     append-only LearnerEvent log
 *
 * The learner snapshot is a PURE FOLD of the log over the projected graph,
 * recomputed on read (logs are small; a cached snapshot is a later
 * optimization). Switching domain is refused (409) while any turn or job
 * runs: every per-world path (chats, graph, jobs) follows the active domain.
 *
 * Integration defaults (documented in docs/impl/integration.md):
 *  - "Geral" (no active domain) is the original learnharness world, untouched.
 *  - A self-check after a lesson is WEAK evidence: format "explain",
 *    graderConfidence 0.5, weight 0.5. Its #self marker excludes it from
 *    mastery family counts and delayed independent retrieval.
 *  - "Já domino" is a diagnostic placement (p = 0.9): the node unlocks its
 *    dependents but stays `inferred` until a real check.
 */

import fs from "node:fs";
import path from "node:path";
import { activeDomainId, PATHS, setActiveDomainId } from "../../config.ts";
import { hoursMid } from "../core/curriculum/hours.ts";
import type { CurriculumSeedFile, CurriculumSnapshot } from "../core/curriculum/types.ts";
import { activeDomainFile, curriculumDir, learnerDir } from "../core/domains/paths.ts";
import type { DomainId, DomainManifest, DomainProfile } from "../core/domains/types.ts";
import { emit } from "../core/events.ts";
import type { LearnerGraphView } from "../core/learner/graph-view.ts";
import { emptySnapshot, foldEvents } from "../core/learner/fold.ts";
import { DEFAULT_LEARNER_PARAMS, LEARNER_CONSTANTS } from "../core/learner/params.ts";
import { planDay, routeTo } from "../core/learner/planner.ts";
import { buildPromptSnapshot } from "../core/learner/snapshot.ts";
import { computeSignals } from "../core/learner/signals.ts";
import { structuralState } from "../core/learner/kst.ts";
import {
	activeModuleOf,
	campaignCompletionProgress,
	campaignQueue,
	defaultCampaignTargets,
	guidedLessonOptions,
	lessonCourseContext,
	pendingReinforcements,
	studyCampaign,
	type LessonCourseContext,
	type LessonCourseProgress,
} from "../core/study/campaign.ts";
import type { Evidence, Grade, LearnerEvent, LearnerSnapshot, PlanItem } from "../core/learner/types.ts";
import { learnerViewOf, lessonBranchNodes, nodeBrief, type StudyNodeBrief } from "../core/study/projection.ts";
import { buildStudySyllabus } from "../core/study/syllabus.ts";
import { DEFAULT_SKILL_MAP_STYLE, isSkillMapStyle, type SkillMapStyle } from "../core/study/map-style.ts";
import type {
	LessonContinuityMeta,
	StudyDomainList,
	StudyProfile,
	StudyToday,
	StudyTodayCoolingAlert,
	StudyTodayModuleAssessment,
	StudyTodayPacing,
	StudyTodayUrgentReview,
} from "../core/study/types.ts";
import { lessonCredit } from "../core/progress/xp.ts";
import { levelProgress } from "../core/progress/levels.ts";
import { tierStanding } from "../core/progress/tiers.ts";
import { FSRS_STATE, retrievability } from "../core/learner/fsrs.ts";
import { aggregateActivity, aggregateUsage, denseDailySeries } from "../core/stats/aggregate.ts";
import { addDays, dayKey } from "../core/stats/dates.ts";
import { parseActivityEvent } from "../core/stats/schema.ts";
import { chatsDir, isUsableDomainId } from "../core/domains/paths.ts";
import { buildDomainTranscript } from "../core/study/transcript.ts";
import { isAdvancedDefenseNode, isAdvancedReadingRequiredNode } from "../core/study/tutor-pedagogy.ts";
import { STUDY_HEARTBEAT_SEC, WORKSPACE_SCOPE } from "../core/stats/types.ts";
import { createStatsStore, type StatsStore } from "../store/stats-store.ts";
import {
	hasSavedPrepNote,
	readModuleScoreMap,
	readPrepNote,
	readProblemSetScoreMap,
	studyActivitySummary,
} from "./course-store.ts";
import { appendStudyEvent, nextStudySeq, persistChatEvent, readStudyEvents, studyLogRevision } from "./study-log.ts";
import { gradeStudyQuiz } from "../core/study/quiz.ts";
import { failedChecks, queueReinforcements } from "./study-expansion.ts";
import { eligibleReview, matchesReviewAnswer, type CampaignReview } from "../core/study/campaign-review.ts";
import { availableReviews } from "./campaign-review-bank.ts";
import { skillMap } from "../core/study/map.ts";
import { questionCallsOf, type LhMessage } from "../core/native-messages.ts";
import type { TurnUsage } from "../core/contracts/chat.ts";
import { createDomainsStore, type DomainsStore } from "../store/domains-store.ts";
import { electronicsCurriculumStamp, loadDomainCurriculum } from "./curriculum-migration.ts";
import { anyTurnRunning } from "./turn-liveness.ts";

export class StudyError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.name = "StudyError";
		this.status = status;
	}
}

// ─── domains ─────────────────────────────────────────────────────────────────

type CurriculumSource = CurriculumSeedFile["sources"][number];
type ProjectedHistoryEntry = { revision: string; events: LearnerEvent[]; snap: LearnerSnapshot };

type StudyState = {
	root: string;
	store: DomainsStore;
	seeded: boolean;
	curricula: Map<string, { stamp: number | string; snapshot: CurriculumSnapshot; view: LearnerGraphView }>;
	projectedHistory: Map<string, ProjectedHistoryEntry>;
	sourceCatalogs: Map<string, { stamp: string | null; sources: Map<string, CurriculumSource> }>;
	usageByChatFile: Map<string, { revision: string; turns: TurnUsage[] }>;
	headerDomainXp: Map<string, { revision: string; xp: number }>;
};

type StudyGlobal = {
	__lhStudy?: Partial<StudyState> & { root: string; store: DomainsStore; seeded: boolean; curricula: StudyState["curricula"] };
};

function state(): StudyState {
	const g = globalThis as typeof globalThis & StudyGlobal;
	if (!g.__lhStudy || g.__lhStudy.root !== PATHS.data) {
		g.__lhStudy = {
			root: PATHS.data,
			store: createDomainsStore(PATHS.data),
			seeded: false,
			curricula: new Map(),
			projectedHistory: new Map(),
			sourceCatalogs: new Map(),
			usageByChatFile: new Map(),
			headerDomainXp: new Map(),
		};
	}
	const s = g.__lhStudy;
	s.projectedHistory ??= new Map();
	s.sourceCatalogs ??= new Map();
	s.usageByChatFile ??= new Map();
	s.headerDomainXp ??= new Map();
	return s as StudyState;
}

/** The domains store, with the workspace and the built-in domains created once per process. */
export function studyDomains(): DomainsStore {
	const s = state();
	if (!s.seeded) {
		s.store.ensureWorkspace();
		s.store.seedBuiltinDomains();
		s.seeded = true;
	}
	return s.store;
}

export function recordStudyActivity(body: unknown): boolean {
	const event = parseActivityEvent(body);
	if (!event || event.activeSec > STUDY_HEARTBEAT_SEC) return false;
	if (event.domain !== WORKSPACE_SCOPE && (!isUsableDomainId(event.domain) || !studyDomains().hasDomain(event.domain))) return false;
	if (event.activeSec > 0) createStatsStore(PATHS.data).appendActivity(event);
	return true;
}

export function listStudyDomains(): StudyDomainList {
	const active = activeDomainId();
	const domains = studyDomains()
		.scanDomains()
		.manifests.map((m) => ({
			id: m.id,
			title: { ...m.title },
			accent: m.accent,
			icon: m.icon,
			active: m.id === active,
		}));
	return { domains, active };
}

function anyJobRunning(): boolean {
	let names: string[];
	try {
		names = fs.readdirSync(PATHS.jobs).filter((n) => n.endsWith(".json"));
	} catch {
		return false;
	}
	for (const name of names) {
		try {
			const record = JSON.parse(fs.readFileSync(path.join(PATHS.jobs, name), "utf8")) as { status?: unknown };
			if (record.status === "running") return true;
		} catch {
			/* a torn record is not a running job */
		}
	}
	return false;
}

/** Open another world (null = "Geral"). 409 while a turn or job is running. */
export function switchStudyDomain(id: string | null): StudyDomainList {
	const store = studyDomains();
	if (id === activeDomainId()) return listStudyDomains();
	if (anyTurnRunning() || anyJobRunning()) throw new StudyError(409, "Há uma sessão ou tarefa em andamento. Termine-a antes de trocar de domínio.");
	if (id !== null) {
		if (!store.hasDomain(id)) throw new StudyError(404, `Domínio desconhecido: ${id}`);
		store.setActiveDomain(id);
	} else {
		fs.rmSync(activeDomainFile(PATHS.data), { force: true });
	}
	setActiveDomainId(id);
	emit("domain-changed", { domainId: id });
	return listStudyDomains();
}

/** Move a study domain to the local trash (`domains/.trash/`).
 *  If it is currently active, switches cleanly to another remaining domain (or
 *  "Geral") before removal. Refuses with 409 while a turn or job is running. */
export function removeStudyDomain(id: string): StudyDomainList & { removed: DomainId; activeChanged: boolean } {
	if (!isUsableDomainId(id)) throw new StudyError(400, "Identificador de domínio inválido.");
	const store = studyDomains();
	if (!store.hasDomain(id)) throw new StudyError(404, `Domínio desconhecido: ${id}`);
	if (anyTurnRunning() || anyJobRunning()) {
		throw new StudyError(409, "Há uma sessão ou tarefa em andamento. Termine-a antes de remover um domínio.");
	}
	const wasActive = activeDomainId() === id;
	if (wasActive) {
		const fallback = store.listDomains().find((d) => d.id !== id)?.id ?? null;
		if (fallback !== null) {
			store.setActiveDomain(fallback);
		} else {
			fs.rmSync(activeDomainFile(PATHS.data), { force: true });
		}
		setActiveDomainId(fallback);
	}
	try {
		store.removeDomain(id);
	} catch (error) {
		if (wasActive) {
			// Best-effort restore if filesystem move failed.
			if (store.hasDomain(id)) {
				store.setActiveDomain(id);
				setActiveDomainId(id);
			}
		}
		throw new StudyError(409, error instanceof Error ? error.message : "Não foi possível remover o domínio.");
	}
	const s = state();
	s.curricula.delete(id);
	s.headerDomainXp.delete(id);
	s.sourceCatalogs.delete(curriculumDir(PATHS.data, id));
	const historyPrefix = `${PATHS.data}|${id}|`;
	for (const key of s.projectedHistory.keys()) {
		if (key.startsWith(historyPrefix)) s.projectedHistory.delete(key);
	}
	emit("domain-changed", { domainId: activeDomainId() });
	return { ...listStudyDomains(), removed: id, activeChanged: wasActive };
}

function requireActive(): { id: DomainId; manifest: DomainManifest; profile: DomainProfile | null } {
	const id = activeDomainId();
	if (id === null) throw new StudyError(409, "Nenhum domínio de estudo ativo.");
	const store = studyDomains();
	const manifest = store.readManifest(id);
	if (!manifest) throw new StudyError(404, `Domínio sem manifesto: ${id}`);
	return { id, manifest, profile: store.readProfile(id) };
}

// ─── curriculum ──────────────────────────────────────────────────────────────

function seedFilesOf(id: DomainId): CurriculumSeedFile[] {
	const dir = path.join(/* turbopackIgnore: true */ PATHS.root, "content", "curricula", id);
	let names: string[];
	try {
		names = fs.readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
	} catch {
		return [];
	}
	return names.map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), "utf8").replace(/^﻿/, "")) as CurriculumSeedFile);
}

/**
 * The domain's curriculum snapshot + projected learner view. First open of a
 * domain with shipped seeds validates them (applySeedFiles: schema, R1–R3,
 * rank certificate) and persists ledger entry 0 + the snapshot. null when
 * the domain has no curriculum yet (custom domains before generation).
 */
const goalViews = new WeakMap<CurriculumSnapshot, { key: string; view: LearnerGraphView }>();
const viewGoalsKey = new WeakMap<LearnerGraphView, string>();

export function loadCurriculum(id: DomainId, manifest: DomainManifest, goals: readonly string[] = []): { snapshot: CurriculumSnapshot; view: LearnerGraphView } | null {
	const dir = curriculumDir(PATHS.data, id);
	const cache = state().curricula;
	const stamp = electronicsCurriculumStamp(dir);
	let entry = cache.get(id);
	if (!entry || entry.stamp !== stamp) {
		const loaded = loadDomainCurriculum(id, dir, manifest.edgeMode, () => seedFilesOf(id));
		if (!loaded) return null;
		const view = learnerViewOf(loaded.snapshot);
		viewGoalsKey.set(view, "");
		entry = { ...loaded, view };
		cache.set(id, entry);
	} else if (!viewGoalsKey.has(entry.view)) {
		viewGoalsKey.set(entry.view, "");
	}
	if (!goals.length) return entry;
	const key = JSON.stringify(goals);
	let weighted = goalViews.get(entry.snapshot);
	if (weighted?.key !== key) {
		const view = learnerViewOf(entry.snapshot, goals);
		viewGoalsKey.set(view, key);
		weighted = { key, view };
		goalViews.set(entry.snapshot, weighted);
	}
	return { snapshot: entry.snapshot, view: weighted.view };
}

export function curriculumSources(id: DomainId) {
	const dir = curriculumDir(PATHS.data, id);
	const file = path.join(dir, "sources.json");
	const stat = fs.statSync(file, { bigint: true, throwIfNoEntry: false });
	const stamp = stat && stat.isFile() ? `${stat.dev}|${stat.ino}|${stat.ctimeNs}|${stat.mtimeNs}|${stat.size}` : null;
	const catalogs = state().sourceCatalogs;
	const cached = catalogs.get(dir);
	if (cached && cached.stamp === stamp) return cached.sources;
	const records: CurriculumSource[] = stamp !== null ? JSON.parse(fs.readFileSync(file, "utf8")) : seedFilesOf(id).flatMap(seed => seed.sources);
	const sources = new Map(records.map(source => [source.id, source]));
	catalogs.set(dir, { stamp, sources });
	return sources;
}

// ─── learner log ─────────────────────────────────────────────────────────────

// The generated final performances are installed as profile targets. Older
// generation receipts lack the original IDs, so recover them from the tree.
const installedTargets = new WeakMap<CurriculumSnapshot, Set<string>>();

function hasCustomCampaignGoal(snapshot: CurriculumSnapshot, targets: readonly string[] = []) {
	if (!targets.length) return false;
	let defaults = installedTargets.get(snapshot);
	if (!defaults) {
		const file = path.join(curriculumDir(PATHS.data, snapshot.domainId), "generation.json");
		defaults = new Set<string>();
		try {
			const receipt = JSON.parse(fs.readFileSync(file, "utf8")) as { targets?: string[] };
			defaults = new Set(receipt.targets ?? defaultCampaignTargets(snapshot));
		} catch {
			// Imported trees have no receipt. Without a readable generation
			// record, honor the saved targets as the learner's own selection.
		}
		installedTargets.set(snapshot, defaults);
	}
	return defaults.size !== targets.length || targets.some(id => !defaults.has(id));
}

type Exposure = Extract<LearnerEvent, { kind: "exposure" }>;
type StudyLesson = { domainId: string; nodeId: string; minutes: number; exploratory?: boolean };

export function validateStudyLesson(raw: unknown, nodeId: string | undefined): StudyLesson {
	const { id, manifest } = requireActive();
	const lesson = raw as { domainId?: unknown; minutes?: unknown; exploratory?: unknown } | null;
	if (lesson?.domainId !== id) throw new StudyError(409, "O domínio da aula mudou.");
	const node = nodeId && loadCurriculum(id, manifest)?.view.nodes.get(nodeId);
	if (!nodeId || !node || (!node.isLeaf && lesson.exploratory !== true)) throw new StudyError(400, "Nó de aula inválido.");
	const minutes = lesson.minutes;
	if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1) throw new StudyError(400, "Duração da aula inválida.");
	return { domainId: id, nodeId, minutes: Math.min(240, minutes), ...((node.reinforcementFor || lesson.exploratory === true) && { exploratory: true }) };
}

export function saveStudyLesson(lesson: StudyLesson, chatId: string, marker: LhMessage, save: () => void) {
	const { domainId, nodeId, minutes } = lesson;
	const seq = nextStudySeq(readStudyEvents(domainId));
	const event: Exposure = { kind: "exposure", id: "lesson-" + chatId, seq, at: new Date(marker.timestamp).toISOString(),
		domainId, sessionId: chatId, nodeId, source: "ai_lesson", minutes, ...(lesson.exploratory && { exploratory: true }) };
	persistChatEvent(domainId, { chatId, messageId: marker.id, event }, save);
}

/** The quiz's nodeId belongs to the conversation plan. The graph-context
 * pick and the lesson exposure identify the actual curriculum leaf. */
export function saveStudyAnswer(chatId: string, previous: LhMessage[], result: LhMessage | undefined, save: () => void) {
	const domainId = activeDomainId();
	const marker = previous[0];
	if (!domainId || marker?.role !== "custom" || marker.customType !== "graph-context" || result?.role !== "toolResult" || result.toolName !== "quiz" || result.isError) return save();
	const picks = (marker.details as { propositions?: { id: string; statement?: string }[] } | null)?.propositions;
	const nodeId = picks?.length === 1 ? picks[0]?.id : undefined;
	if (!nodeId) return save();
	const call = questionCallsOf(previous).find(c => c.status === "answerable" && c.tool === "quiz" && c.toolCallId === result.toolCallId);
	if (!call) return save();
	const graded = gradeStudyQuiz(call.input, call.toolCallId, result.details);
	if (!graded) return save();
	const events = readStudyEvents(domainId);
	const exposures = events.filter((e): e is Exposure => e.kind === "exposure" && e.nodeId === nodeId);
	const bound = exposures.find(e => e.sessionId === chatId);
	// Before chat-bound exposures, Today wrote "hoje" immediately before chat creation.
	// Keep old lessons readable; never borrow an exposure from another bound chat.
	const exposure = bound ?? exposures.findLast(e => e.sessionId === "hoje" && Date.parse(e.at) <= marker.timestamp &&
		picks?.[0]?.statement?.endsWith(`Aula de ~${e.minutes} min do curr\u00edculo do dom\u00ednio; ensine em pt-BR.`));
	if (!exposure) return save();
	if (exposure.exploratory) {
		const manifest = studyDomains().readManifest(domainId);
		if (!manifest || !loadCurriculum(domainId, manifest)?.view.nodes.get(nodeId)?.isLeaf) return save();
	}
	const itemId = JSON.stringify([chatId, call.messageId, call.contentIndex]);
	const id = "quiz-" + itemId;
	if (events.some(e => e.kind === "evidence" && e.evidence.id === id)) return save();
	const evidence: Evidence = {
		id, seq: nextStudySeq(events), at: new Date(result.timestamp).toISOString(), domainId, sessionId: chatId,
		lessonExposureId: exposure.id, itemId, itemFamily: nodeId + "#mcq", nodes: [{ nodeId, q: 1, primary: true }],
		format: "mcq", level: 2, graderConfidence: 1, hints: 0, ...graded,
		minutesSinceExposure: Math.max(0, (result.timestamp - Date.parse(exposure.at)) / 60_000),
	};
	persistChatEvent(domainId, { chatId, messageId: result.id, event: { kind: "evidence", evidence } }, save);
	if (graded.grade === 0) queueReinforcements(domainId, [...events, { kind: "evidence", evidence }]);
}

/** Pair every lesson with its first objective check, or its fallback self-rating.
 * Older events share sessionId "hoje", so resolve them in append order. */
function ratedLessons(events: readonly LearnerEvent[]) {
	const lessons = new Map<string, { exposure: Exposure; rating?: Evidence }>();
	const bySessionNode = new Map<string, string>();
	for (const event of events) {
		if (event.kind === "exposure") {
			lessons.set(event.id, { exposure: event });
			bySessionNode.set(JSON.stringify([event.sessionId, event.nodeId]), event.id);
		} else if (event.kind === "evidence") {
			const e = event.evidence;
			const node = e.nodes.find(n => n.primary) ?? e.nodes[0];
			const id = e.lessonExposureId ?? bySessionNode.get(JSON.stringify([e.sessionId, node?.nodeId]));
			const lesson = id && lessons.get(id);
			if (lesson && (!lesson.rating || (lesson.rating.format === "explain" && e.format === "mcq"))) lesson.rating = e;
		}
	}
	return lessons;
}

function eventNodes(ev: LearnerEvent): string[] {
	switch (ev.kind) {
		case "evidence":
			return ev.evidence.nodes.map((n) => n.nodeId);
		case "exposure":
		case "lesson-finished":
		case "node-version":
			return [ev.nodeId];
		case "implicit-credit":
			return [ev.fromNodeId, ev.toNodeId];
		case "diagnostic":
			return ev.estimates.map((e) => e.nodeId);
	}
}

export function learnerSnapshotOf(id: DomainId, view: LearnerGraphView, events: readonly LearnerEvent[], at: string): LearnerSnapshot {
	if (events.length === 0) return emptySnapshot(id, at);
	try {
		return foldEvents(null, events, view, DEFAULT_LEARNER_PARAMS);
	} catch {
		// A curriculum change may orphan old events: fold only those whose nodes still exist.
		const kept = events.filter((ev) => eventNodes(ev).every((n) => view.nodes.has(n)));
		return kept.length > 0 ? foldEvents(null, kept, view, DEFAULT_LEARNER_PARAMS) : emptySnapshot(id, at);
	}
}

/** Find a prerequisite route the student can actually take, including inherited alternatives. */
export function lessonRoute(id: DomainId, view: LearnerGraphView, events: LearnerEvent[], nodeId: string, snapshot?: CurriculumSnapshot) {
	const clauses = view.nodes.get(nodeId)?.clauses ?? [];
	if (!clauses.length) return { route: [], missing: [] };
	const learner = snapshot
		? readLearnerHistory(id, snapshot, view, new Date().toISOString()).snap
		: learnerSnapshotOf(id, view, events, new Date().toISOString());
	const { known } = structuralState(learner, view);
	const alternatives = clauses.map(clause => ({
		route: clause.filter(key => known.has(key)).map(key => view.nodes.get(key)!.title),
		missing: clause.filter(key => !known.has(key)).map(key => ({ id: key, title: view.nodes.get(key)!.title })),
	}));
	return alternatives.sort((a,b) => a.missing.length-b.missing.length || a.route.length-b.route.length)[0]!;
}

export function studyLearnerPrompt(domainId: string, focus?: readonly string[]) {
	const store = studyDomains();
	const manifest = store.readManifest(domainId);
	const profile = store.readProfile(domainId);
	const cur = manifest && loadCurriculum(domainId, manifest, profile?.goal.targetNodeIds);
	if (!cur) return null;
	const at = new Date().toISOString();
	const { events, snap } = readLearnerHistory(domainId, cur.snapshot, cur.view, at);
	const budgetMin = profile?.dailyBudgetMin ?? 180;
	const signals = computeSignals(snap, cur.view, DEFAULT_LEARNER_PARAMS, at);
	const lessonNodes = focus && lessonBranchNodes(cur.snapshot, cur.view, focus);
	const route = new Set(focus);
	for (const id of focus ?? []) {
		if (!cur.view.nodes.get(id)?.isLeaf) continue;
		for (const prerequisite of routeTo(id, cur.view, signals)) {
			lessonNodes!.add(prerequisite);
			route.add(prerequisite);
		}
	}
	const campaign = !hasCustomCampaignGoal(cur.snapshot, profile?.goal.targetNodeIds) ? studyCampaign(cur.snapshot, cur.view, signals.structure.known) : undefined;
	const plan = !lessonNodes || lessonNodes.size ? planDay(snap, cur.view, DEFAULT_LEARNER_PARAMS, { at, budgetMin, signals,
		...guidedLessonOptions(campaign, events, at, campaign && eligibleReview(reviewBank(domainId, cur.view), events, at)?.nodeId) }) : null;
	const prompt = buildPromptSnapshot(snap, cur.view, DEFAULT_LEARNER_PARAMS, { at, plan, signals, nodes: lessonNodes });
	const failures = focus?.length ? failedChecks(events) : [];
	if (failures.length) {
		const streaks = new Map(failures.map(candidate => [candidate.target, candidate.checks]));
		for (const id of route) {
			const checks = streaks.get(id);
			const node = cur.view.nodes.get(id);
			if (!node || !checks) continue;
			const sourcesExist = checks.every(({ sessionId }) => /^[A-Za-z0-9_-]+$/.test(sessionId)
				&& fs.existsSync(path.join(chatsDir(PATHS.data, domainId), sessionId + ".json")));
			if (!sourcesExist) continue;
			prompt.recentErrors = {
				title: node.title,
				checks: checks.map(({ quizContext, at, sessionId }) => ({
					question: quizContext!.question, answer: quizContext!.answer, at, sessionId,
				})),
			};
			break;
		}
	}
	return { prompt, lessonNodes, weak: prompt.weak.map(w => ({ nodeId: w.nodeId, weakness: signals.signals.get(w.nodeId)!.weakScore })) };
}

type NewEvent =
	| { kind: "exposure"; nodeId: string; minutes: number }
	| { kind: "self-check"; nodeId: string; grade: Grade; exposureId?: string; sessionId?: string }
	| { kind: "known"; nodeId: string };

export function parseStudyEvent(body: unknown): NewEvent | null {
	if (typeof body !== "object" || body === null) return null;
	const b = body as Record<string, unknown>;
	if (typeof b.nodeId !== "string" || b.nodeId.length === 0 || b.nodeId.length > 600) return null;
	if (b.kind === "exposure") {
		const minutes = typeof b.minutes === "number" && Number.isFinite(b.minutes) ? Math.min(240, Math.max(1, Math.round(b.minutes))) : 20;
		return { kind: "exposure", nodeId: b.nodeId, minutes };
	}
	if (b.kind === "self-check" && (b.grade === 0 || b.grade === 1 || b.grade === 2 || b.grade === 3)) return { kind: "self-check", nodeId: b.nodeId, grade: b.grade, ...(typeof b.exposureId === "string" ? { exposureId: b.exposureId } : {}), ...(typeof b.sessionId === "string" ? { sessionId: b.sessionId } : {}) };
	if (b.kind === "known") return { kind: "known", nodeId: b.nodeId };
	return null;
}

/** Exposure IDs whose lesson has been closed (passed or reinforced). */
export function finishedExposures(events: readonly LearnerEvent[]) {
	const finished = new Set<string>();
	for (const e of events) {
		if (e.kind === "lesson-finished") finished.add(e.exposureId);
		if (e.kind === "evidence" && e.evidence.lessonExposureId && /#(?:self|teacher)$/.test(e.evidence.itemFamily))
			finished.add(e.evidence.lessonExposureId);
	}
	return finished;
}

function completionState(events: LearnerEvent[], sessionId: string) {
	const exposure = events.find((e): e is Exposure => e.kind === "exposure" && e.source === "ai_lesson" && !e.exploratory && e.sessionId === sessionId);
	return exposure ? { exposure, completed: finishedExposures(events).has(exposure.id) } : null;
}

function enrichNextWithSyllabus(
	domainId: string,
	rawNext: StudyToday["next"],
	currentModuleId: string | undefined,
	syllabus: ReturnType<typeof buildStudySyllabus>,
): StudyToday["next"] {
	if (!rawNext) return null;
	const prepNote = readPrepNote(domainId, rawNext.nodeId);
	const nextModuleId = syllabus.chapters
		.flatMap((c) => c.modules)
		.find((m) => m.lessons.some((l) => l.id === rawNext.nodeId))?.id ?? currentModuleId;
	const prepHref = nextModuleId
		? `/ementa?dominio=${encodeURIComponent(domainId)}&modulo=${encodeURIComponent(nextModuleId)}`
		: `/ementa?dominio=${encodeURIComponent(domainId)}`;
	return {
		...rawNext,
		hasPrepNote: hasSavedPrepNote(prepNote),
		prepHref,
	};
}

function buildLessonContinuityMeta(params: {
	domainId: string;
	cur: { snapshot: CurriculumSnapshot; view: LearnerGraphView };
	snap: LearnerSnapshot;
	known: ReadonlySet<string>;
	available: ReadonlySet<string>;
	campaign: ReturnType<typeof studyCampaign>;
	course: LessonCourseContext | null;
	dailyBudgetMin: number;
	at: string;
	dueReviewsCount?: number;
	optionalPractice: { id: string; title: string } | null;
	rawNext: StudyToday["next"];
	currentModuleId?: string;
}): { continuity: LessonContinuityMeta; enrichedNext: StudyToday["next"] } {
	const { domainId, cur, snap, known, available, campaign, course, dailyBudgetMin, at, dueReviewsCount, optionalPractice: rawOptional, rawNext, currentModuleId } = params;
	const moduleScores = readModuleScoreMap(domainId);
	const problemSetScores = readProblemSetScoreMap(domainId);
	const syllabus = buildStudySyllabus({
		snapshot: cur.snapshot,
		graph: cur.view,
		learner: snap,
		campaign,
		known,
		available,
		at,
		recentMinutes14d: 0,
		dailyBudgetMin,
		moduleScores,
		problemSetScores,
	});
	const enrichedNext = enrichNextWithSyllabus(domainId, rawNext, currentModuleId, syllabus);
	const chapter = course
		? syllabus.chapters.find((c) => c.level === course.chapterLevel)
		: undefined;
	const mod = course
		? (chapter?.modules.find((m) => m.id === course.moduleId)
			?? syllabus.chapters.flatMap((c) => c.modules).find((m) => m.id === course.moduleId))
		: undefined;
	const prepHref = enrichedNext?.prepHref
		?? (course
			? `/ementa?dominio=${encodeURIComponent(domainId)}&modulo=${encodeURIComponent(course.moduleId)}`
			: undefined);
	const optionalPractice = rawOptional
		? {
			id: rawOptional.id,
			nodeId: rawOptional.id,
			domain: domainId,
			title: rawOptional.title,
		}
		: null;
	return {
		enrichedNext,
		continuity: {
			...(mod ? {
				moduleExamUnlocked: mod.examUnlocked,
				moduleExamPassed: Boolean(mod.examPassed),
				...(mod.examScore !== undefined ? { moduleExamScore: mod.examScore } : {}),
				problemSetPassed: Boolean(mod.problemSetPassed),
				...(mod.problemSetScore !== undefined ? { problemSetScore: mod.problemSetScore } : {}),
			} : {}),
			...(chapter ? {
				chapterId: chapter.level,
				chapterExamUnlocked: Boolean(chapter.examUnlocked),
				chapterExamPassed: Boolean(chapter.examPassed),
				...(chapter.examScore !== undefined ? { chapterExamScore: chapter.examScore } : {}),
			} : course ? {
				chapterId: course.chapterLevel,
			} : {}),
			...(dueReviewsCount !== undefined ? { dueReviewCount: dueReviewsCount } : {}),
			optionalPractice,
			...(prepHref ? { prepHref } : {}),
		},
	};
}

export function lessonCompletionState(domainId: string, sessionId: string) {
	const store = studyDomains();
	const manifest = store.readManifest(domainId);
	const profile = store.readProfile(domainId);
	const cur = manifest && loadCurriculum(domainId, manifest, profile?.goal.targetNodeIds);
	const at = new Date().toISOString();
	const history = cur ? readLearnerHistory(domainId, cur.snapshot, cur.view, at) : null;
	const events = history ? history.events : readStudyEvents(domainId);
	const state = completionState(events, sessionId);
	if (!state) return null;
	const reinforcement = state.completed ? events.find(e => e.kind === "lesson-finished" && e.exposureId === state.exposure.id && e.outcome === "reinforce") : undefined;
	let course: LessonCourseContext | null = null;
	let next: StudyToday["next"] = null;
	let resume: string | null = null;
	let retry: { nodeId: string; brief: StudyNodeBrief; estMinutes: number; feedback: string } | null = null;
	let continuity: LessonContinuityMeta = {};
	if (cur && manifest) {
		const isActive = activeDomainId() === domainId;
		const todayPlan = isActive
			? computeTodayPlan({ id: domainId, manifest, profile, cur, at, runReinforcementQueue: false })
			: null;
		const snap = todayPlan ? todayPlan.snap : history!.snap;
		const signals = todayPlan ? todayPlan.signals : computeSignals(snap, cur.view, DEFAULT_LEARNER_PARAMS, at);
		const known = signals.structure.known;
		const available = todayPlan ? todayPlan.available : new Set(signals.structure.frontier);
		const campaign = todayPlan ? todayPlan.campaign : studyCampaign(cur.snapshot, cur.view, known);
		course = lessonCourseContext(cur.snapshot, cur.view, campaign, known, state.exposure.nodeId);
		let rawNext: StudyToday["next"] = null;
		if (reinforcement?.kind === "lesson-finished") {
			const brief = nodeBrief(cur.snapshot, state.exposure.nodeId);
			if (brief) {
				retry = {
					nodeId: state.exposure.nodeId,
					brief,
					estMinutes: Math.round(campaign.lessonMinutes.get(state.exposure.nodeId) ?? state.exposure.minutes),
					feedback: reinforcement.feedback ?? "Retome este nó para praticar os objetivos pendentes.",
				};
			}
		} else if (state.completed && todayPlan) {
			rawNext = todayPlan.next?.nodeId !== state.exposure.nodeId ? todayPlan.next : null;
			const finished = finishedExposures(events);
			const domainChatsDir = chatsDir(PATHS.data, domainId);
			const sessionExists = (id: string) => !id.startsWith("chat_") || fs.existsSync(path.join(domainChatsDir, id + ".json"));
			const pending = rawNext && [...ratedLessons(events).values()].reverse().find(({ exposure: prior, rating }) =>
				!rating && !finished.has(prior.id) && !prior.exploratory && prior.nodeId === rawNext!.nodeId && prior.sessionId !== "hoje" &&
				sessionExists(prior.sessionId) &&
				Date.now() - Date.parse(prior.at) <= 3 * 86_400_000);
			resume = pending?.exposure.sessionId ?? null;
		}
		const built = buildLessonContinuityMeta({
			domainId,
			cur,
			snap,
			known,
			available,
			campaign,
			course,
			dailyBudgetMin: profile?.dailyBudgetMin ?? 180,
			at,
			...(todayPlan ? { dueReviewsCount: todayPlan.dueReviewsCount } : {}),
			optionalPractice: todayPlan?.suggestion ? { id: todayPlan.suggestion.id, title: todayPlan.suggestion.title.pt } : null,
			rawNext,
			currentModuleId: todayPlan?.currentModule?.id,
		});
		next = built.enrichedNext;
		continuity = built.continuity;
	}
	return {
		domainId,
		sessionId,
		nodeId: state.exposure.nodeId,
		completed: state.completed,
		course,
		...(next && { next }),
		...(resume && { resume }),
		...(retry && { retry }),
		...(reinforcement?.kind === "lesson-finished" && { reinforcement: reinforcement.feedback ?? "Retome este nó para praticar os objetivos pendentes." }),
		...continuity,
	};
}

export function lessonConclusionObjective(domainId: string, sessionId: string) {
	const manifest = studyDomains().readManifest(domainId);
	const cur = manifest && loadCurriculum(domainId, manifest);
	const history = cur ? readLearnerHistory(domainId, cur.snapshot, cur.view, new Date().toISOString()) : null;
	const events = history ? history.events : readStudyEvents(domainId);
	const state = completionState(events, sessionId);
	if (!state || state.completed || !cur || !history) return undefined;
	const item = cur.snapshot.items[state.exposure.nodeId];
	if (!item) return undefined;
	const priorReinforcement = [...events].reverse().find(e => e.kind === "lesson-finished" && e.nodeId === state.exposure.nodeId && e.outcome === "reinforce" && e.exposureId !== state.exposure.id);
	const campaign = studyCampaign(cur.snapshot, cur.view, structuralState(history.snap, cur.view).known);
	const isFinale = campaign.journey.some(chapter => chapter.finale === state.exposure.nodeId);
	const isAdvancedDefense = isAdvancedDefenseNode(item, isFinale);
	const requiresQualityReading = isAdvancedReadingRequiredNode(item, isFinale);
	const levelLabel = item.level.scheme === "cefr"
		? item.level.cefr
		: item.level.scheme === "ee"
			? ["Fundamentos", "Técnico", "Graduação", "Avançado", "Pesquisa"][item.level.band]
			: undefined;
	return {
		title: item.title.pt,
		objectives: item.objectives.length ? item.objectives : [item.summary || item.title.pt],
		assessment: item.assess,
		misconceptions: item.misconceptions ?? [],
		...(isAdvancedDefense ? { isAdvancedDefense: true } : {}),
		...(requiresQualityReading ? { requiresQualityReading: true } : {}),
		...(levelLabel ? { levelLabel } : {}),
		...(priorReinforcement?.kind === "lesson-finished" && priorReinforcement.feedback ? { priorReinforcement: priorReinforcement.feedback } : {}),
	};
}

export function finishStudyLesson(domainId: string, sessionId: string, grade: Grade, reinforcement?: { feedback: string }) {
	const { id, manifest, profile } = requireActive();
	if (id !== domainId) throw new StudyError(409, "O domínio da aula mudou.");
	const at = new Date().toISOString();
	const cur = loadCurriculum(id, manifest, profile?.goal.targetNodeIds);
	const beforeHistory = cur ? readLearnerHistory(id, cur.snapshot, cur.view, at) : null;
	const events = beforeHistory ? beforeHistory.events : readStudyEvents(id);
	const state = completionState(events, sessionId);
	if (!state) throw new StudyError(409, "Esta sessão não pertence a uma missão da campanha.");
	const { exposure, completed } = state;
	const domains = listStudyDomains().domains;
	const before = studyAccountSummary(domains).xp;
	const seq = nextStudySeq(events);
	if (!completed && !reinforcement && grade < 2) throw new StudyError(409, "O objetivo do nó ainda precisa de prática.");
	const snapBefore = beforeHistory ? beforeHistory.snap : null;
	const knownBefore = cur && snapBefore ? structuralState(snapBefore, cur.view).known : null;
	const campaignBefore = cur && knownBefore ? studyCampaign(cur.snapshot, cur.view, knownBefore) : null;

	if (!completed && (reinforcement || ratedLessons(events).get(exposure.id)?.rating)) {
		appendStudyEvent(id, { kind: "lesson-finished", id: "finished-" + exposure.id, at: new Date().toISOString(),
			seq: nextStudySeq(events), nodeId: exposure.nodeId, domainId, exposureId: exposure.id, assessedBy: "teacher",
			...(reinforcement && { outcome: "reinforce", feedback: reinforcement.feedback }) });
	} else if (!completed) {
		appendStudyEvent(id, { kind: "evidence", evidence: {
			id: "teacher-" + exposure.id, seq, at, domainId, sessionId, lessonExposureId: exposure.id,
			itemId: exposure.id + "#performance", itemFamily: exposure.nodeId + "#teacher",
			nodes: [{ nodeId: exposure.nodeId, q: 1, primary: true }], format: "explain", level: 3,
			grade, graderConfidence: 0.8, hints: grade === 2 ? 1 : 0, summative: grade === 3,
			minutesSinceExposure: Math.max(0, (Date.parse(at) - Date.parse(exposure.at)) / 60000),
		} });
	}
	const afterAt = new Date().toISOString();
	const todayPlan = cur ? computeTodayPlan({ id, manifest, profile, cur, at: afterAt, runReinforcementQueue: true }) : null;
	const freshEvents = todayPlan ? todayPlan.events : readStudyEvents(id);
	const rawNext = !reinforcement && todayPlan?.next?.nodeId !== exposure.nodeId ? (todayPlan?.next ?? null) : null;
	const finished = finishedExposures(freshEvents);
	const domainChatsDir = chatsDir(PATHS.data, id);
	const sessionExists = (sessionId: string) => !sessionId.startsWith("chat_") || fs.existsSync(path.join(domainChatsDir, sessionId + ".json"));
	const pending = rawNext && [...ratedLessons(freshEvents).values()].reverse().find(({ exposure: prior, rating }) =>
		!rating && !finished.has(prior.id) && !prior.exploratory && prior.nodeId === rawNext.nodeId && prior.sessionId !== "hoje" &&
		sessionExists(prior.sessionId) &&
		Date.now() - Date.parse(prior.at) <= 3 * 86_400_000);
	let course: LessonCourseProgress | null = null;
	let retry: { nodeId: string; brief: StudyNodeBrief; estMinutes: number; feedback: string } | null = null;
	let continuity: LessonContinuityMeta = {};
	let next: StudyToday["next"] = rawNext;
	if (cur && todayPlan && knownBefore && campaignBefore) {
		const snapAfter = todayPlan.snap;
		const knownAfter = todayPlan.known;
		const campaignAfter = todayPlan.campaign;
		course = campaignCompletionProgress(cur.snapshot, cur.view, campaignBefore, campaignAfter, knownBefore, knownAfter, exposure.nodeId);
		if (reinforcement) {
			const brief = nodeBrief(cur.snapshot, exposure.nodeId);
			if (brief) {
				retry = {
					nodeId: exposure.nodeId,
					brief,
					estMinutes: Math.round(campaignAfter.lessonMinutes.get(exposure.nodeId) ?? exposure.minutes),
					feedback: reinforcement.feedback,
				};
			}
		}
		const built = buildLessonContinuityMeta({
			domainId: id,
			cur,
			snap: snapAfter,
			known: knownAfter,
			available: todayPlan.available,
			campaign: campaignAfter,
			course,
			dailyBudgetMin: profile?.dailyBudgetMin ?? 180,
			at: afterAt,
			dueReviewsCount: todayPlan.dueReviewsCount,
			optionalPractice: todayPlan.suggestion ? { id: todayPlan.suggestion.id, title: todayPlan.suggestion.title.pt } : null,
			rawNext,
			currentModuleId: todayPlan.currentModule?.id,
		});
		next = built.enrichedNext;
		continuity = built.continuity;
	}
	if (!completed) {
		emit("curriculum-expanded", { domainId: id, nodeId: exposure.nodeId });
	}
	return {
		before,
		after: studyAccountSummary(domains).xp,
		alreadyCompleted: completed,
		resume: pending?.exposure.sessionId ?? null,
		next,
		course,
		...(retry && { retry }),
		...continuity,
	};
}

export function recordStudyEvent(input: NewEvent): StudyToday {
	const { id, manifest } = requireActive();
	const cur = loadCurriculum(id, manifest);
	if (!cur) throw new StudyError(409, "Este domínio ainda não tem currículo.");
	const node = cur.view.nodes.get(input.nodeId);
	if (!node || !node.isLeaf) throw new StudyError(400, `Nó de estudo desconhecido: ${input.nodeId}`);
	const events = readStudyEvents(id);
	const seq = nextStudySeq(events);
	const at = new Date().toISOString();
	const uid = `${input.kind}-${seq}-${Math.random().toString(36).slice(2, 8)}`;
	let event: LearnerEvent;
	if (input.kind === "exposure") {
		event = { kind: "exposure", id: uid, seq, at, domainId: id, sessionId: "hoje", nodeId: input.nodeId, source: "ai_lesson", minutes: input.minutes };
	} else if (input.kind === "known") {
		event = { kind: "diagnostic", id: uid, seq, at, domainId: id, estimates: [{ nodeId: input.nodeId, p: 0.9 }] };
	} else {
		const lastExposure = [...events]
			.reverse()
			.find((ev): ev is Extract<LearnerEvent, { kind: "exposure" }> => ev.kind === "exposure" && !ev.exploratory && ev.nodeId === input.nodeId && (!input.exposureId || ev.id === input.exposureId) && (!input.sessionId || ev.sessionId === input.sessionId));
		if ((input.exposureId || input.sessionId) && !lastExposure) throw new StudyError(409, "Esta aula não está pendente.");
		if (lastExposure && lastExposure.sessionId !== "hoje") throw new StudyError(403, "O professor conclui esta missão após avaliar o objetivo.");
		if (lastExposure && ratedLessons(events).get(lastExposure.id)?.rating) return studyToday();
		const minutesSinceExposure = lastExposure ? Math.max(0, (Date.parse(at) - Date.parse(lastExposure.at)) / 60_000) : 100_000;
		const evidence: Evidence = {
			id: uid,
			seq,
			at,
			domainId: id,
			sessionId: lastExposure?.sessionId ?? "hoje",
			lessonExposureId: lastExposure?.id,
			itemId: `${input.nodeId}#self-${seq}`,
			itemFamily: `${input.nodeId}#self`,
			nodes: [{ nodeId: input.nodeId, q: 1, primary: true }],
			format: "explain",
			level: 2,
			grade: input.grade,
			graderConfidence: 0.5,
			hints: 0,
			minutesSinceExposure,
			weight: 0.5,
		};
		event = { kind: "evidence", evidence };
	}
	appendStudyEvent(id, event);
	return studyToday();
}

// ─── "Hoje" ──────────────────────────────────────────────────────────────────

function reviewBank(id: string, view: LearnerGraphView): CampaignReview[] {
	return availableReviews(id).filter(task => view.nodes.get(task.nodeId)?.isLeaf && view.nodes.get(task.nodeId)?.version === (task.nodeVersion ?? 1));
}


export function answerCampaignReview(domain: string, reviewId: string, answer: string) {
	const { id, manifest } = requireActive();
	if (domain !== id) throw new StudyError(409, "O domínio mudou. Atualize a revisão.");
	const cur = loadCurriculum(id, manifest);
	if (!cur) throw new StudyError(409, "Currículo indisponível.");
	const bank = reviewBank(id, cur.view);
	const task = bank.find(entry => entry.id === reviewId);
	const events = readStudyEvents(id);
	const at = new Date().toISOString();
	if (!task) throw new StudyError(409, "Revisão indisponível.");
	const receipt = "review-" + task.id;
	const prior = events.find(e => e.kind === "evidence" && e.evidence.id === receipt);
	if (prior?.kind === "evidence") return { correct: prior.evidence.grade === 3, explanation: task.explanation };
	if (eligibleReview(bank, events, at)?.id !== reviewId) throw new StudyError(409, "Essa revisão ainda não está disponível.");
	const exposure = events.findLast((e): e is Exposure => e.kind === "exposure" && e.nodeId === task.nodeId && !e.exploratory)!;
	const correct = matchesReviewAnswer(task, answer);
	appendStudyEvent(id, { kind: "evidence", evidence: { id: receipt, seq: nextStudySeq(events), at, domainId: id,
		sessionId: "review-" + task.id, itemId: task.id, itemFamily: task.nodeId + (task.format ? "#language-form" : "#application"),
		nodes: [{ nodeId: task.nodeId, q: 1, primary: true }], format: task.format ?? "short", level: task.level ?? 3, grade: correct ? 3 : 0,
		graderConfidence: 1, hints: 0, minutesSinceExposure: (Date.parse(at) - Date.parse(exposure.at)) / 60_000 } });
	return { correct, explanation: task.explanation };
}

// A fold is determined by the curriculum and event log. Plans, retention and
// review windows are evaluated against the caller's current clock on every read.
const MAX_PROJECTED_HISTORIES = 32;

export function readLearnerHistory(id: DomainId, snapshot: CurriculumSnapshot, view: LearnerGraphView, at: string) {
	const revision = studyLogRevision(id);
	const emptyLogPath = path.join(learnerDir(PATHS.data, id), "events.jsonl");
	if (revision === emptyLogPath) {
		return { events: [] as LearnerEvent[], snap: emptySnapshot(id, at) };
	}
	const goalsKey = viewGoalsKey.get(view) ?? "";
	const cacheKey = `${PATHS.data}|${id}|${snapshot.version}|${snapshot.certificate.hash}|${goalsKey}`;
	const cache = state().projectedHistory;
	const cached = cache.get(cacheKey);
	if (cached && revision !== undefined && revision === cached.revision) return cached;
	const events = readStudyEvents(id);
	const snap = learnerSnapshotOf(id, view, events, at);
	// An empty/orphan-only history uses the request time as its snapshot date.
	if (revision !== undefined && snap.seq > 0) {
		if (cache.size >= MAX_PROJECTED_HISTORIES && !cache.has(cacheKey)) {
			const oldest = cache.keys().next().value;
			if (oldest !== undefined) cache.delete(oldest);
		}
		cache.set(cacheKey, { revision, events, snap });
	}
	return { events, snap };
}

/** Lightweight shared planner step without studyActivitySummary or buildStudySyllabus. */
export function computeTodayPlan(params: {
	id: DomainId;
	manifest: DomainManifest;
	profile: DomainProfile | null;
	cur: { snapshot: CurriculumSnapshot; view: LearnerGraphView };
	at: string;
	runReinforcementQueue?: boolean;
}) {
	const { id, profile, cur, at, runReinforcementQueue = false } = params;
	const budgetMin = profile?.dailyBudgetMin ?? 180;
	const { events, snap } = readLearnerHistory(id, cur.snapshot, cur.view, at);
	const review = eligibleReview(reviewBank(id, cur.view), events, at);
	if (runReinforcementQueue) queueReinforcements(id, events);
	const signals = computeSignals(snap, cur.view, DEFAULT_LEARNER_PARAMS, at);
	const known = signals.structure.known;
	const reinforced = pendingReinforcements(events, known);
	const reinforcedIds = new Set(reinforced.keys());
	// Spacing rule: a node TAUGHT in the last 20 h is not re-taught as "new" —
	// its consolidation comes from tomorrow's delayed check, unless its latest
	// formal exam closed with reinforcement (allow immediate guided retry).
	const recent = new Set<string>();
	const atMs = Date.parse(at);
	for (const ev of events) {
		if (ev.kind === "exposure" && !ev.exploratory && !reinforcedIds.has(ev.nodeId) && atMs - Date.parse(ev.at) < 20 * 3_600_000) {
			recent.add(ev.nodeId);
		}
	}
	const campaign = studyCampaign(cur.snapshot, cur.view, known);
	const customGoal = hasCustomCampaignGoal(cur.snapshot, profile?.goal.targetNodeIds);
	const plan = planDay(snap, cur.view, DEFAULT_LEARNER_PARAMS, {
		at,
		budgetMin,
		signals,
		...guidedLessonOptions(customGoal ? undefined : campaign, events, at, review?.nodeId, reinforcedIds),
	});
	const rawPick = [plan.next, ...plan.items].find((it): it is PlanItem => !!it && !(it.kind === "new" && recent.has(it.nodeId))) ?? null;
	const reinforceNote = rawPick && reinforced.get(rawPick.nodeId);
	const pick = rawPick && reinforceNote
		? { ...rawPick, kind: "remediate" as const, reason: `Reforço da tentativa anterior: ${reinforceNote}` }
		: rawPick;
	const next = pick ? { ...pick, brief: nodeBrief(cur.snapshot, pick.nodeId) as StudyNodeBrief } : null;

	let pendingCheck: StudyToday["pendingCheck"] = null;
	const lessons = [...ratedLessons(events).values()];
	const finished = finishedExposures(events);
	const latestFinishByNode = new Map<string, number>();
	for (const ev of events) {
		if (ev.kind === "lesson-finished") {
			const ts = Date.parse(ev.at);
			latestFinishByNode.set(ev.nodeId, Math.max(latestFinishByNode.get(ev.nodeId) ?? -Infinity, ts));
		} else if (ev.kind === "evidence" && /#(?:self|teacher)$/.test(ev.evidence.itemFamily)) {
			const nodeId = (ev.evidence.nodes.find(n => n.primary) ?? ev.evidence.nodes[0])?.nodeId;
			if (nodeId) latestFinishByNode.set(nodeId, Math.max(latestFinishByNode.get(nodeId) ?? -Infinity, Date.parse(ev.evidence.at)));
		}
	}
	const domainChatsDir = chatsDir(PATHS.data, id);
	const sessionExists = (sessionId: string) => !sessionId.startsWith("chat_") || fs.existsSync(path.join(domainChatsDir, sessionId + ".json"));
	const pending = lessons.reverse().find(({ exposure, rating }) => {
		if (exposure.exploratory || !cur.view.nodes.has(exposure.nodeId)) return false;
		const exposedAt = Date.parse(exposure.at);
		if (atMs - exposedAt > 3 * 86_400_000) return false;
		if (exposure.sessionId === "hoje") return !rating;
		if (finished.has(exposure.id) || !sessionExists(exposure.sessionId)) return false;
		// A newer finished lesson for this same node supersedes older unfinished attempts.
		if ((latestFinishByNode.get(exposure.nodeId) ?? -Infinity) >= exposedAt) return false;
		return true;
	});
	if (pending) {
		const { id: exposureId, nodeId, sessionId, at: exposedAt } = pending.exposure;
		pendingCheck = { exposureId, nodeId, sessionId, title: cur.view.nodes.get(nodeId)?.title ?? nodeId, at: exposedAt };
	}
	const available = new Set(signals.structure.frontier);
	const focusNodeId = pendingCheck?.nodeId ?? next?.nodeId;
	const currentModule = activeModuleOf(cur.snapshot, cur.view, campaign, known, available, focusNodeId);
	const queue = campaignQueue(cur.snapshot, cur.view, campaign, plan.items.filter(it => !(it.kind === "new" && recent.has(it.nodeId))), next?.nodeId, 4);
	const reinforceHint = pick && reinforceNote && next
		? { nodeId: next.nodeId, title: next.brief.title, feedback: reinforceNote }
		: undefined;

	const dueSignals = [...signals.signals.values()].filter(
		(s) => s.reviewDue && cur.view.nodes.get(s.nodeId)?.isLeaf !== false,
	);
	const dueReviewsCount = dueSignals.length;
	let urgentReview: StudyTodayUrgentReview | null = null;
	if (dueSignals.length > 0) {
		const mandatoryMargin = LEARNER_CONSTANTS.planner.mandatoryMargin;
		const sortedDue = [...dueSignals].sort((a, b) => {
			const aMand = a.R < a.retention - mandatoryMargin ? 1 : 0;
			const bMand = b.R < b.retention - mandatoryMargin ? 1 : 0;
			if (aMand !== bMand) return bMand - aMand;
			return a.R - b.R || b.importance - a.importance || (a.nodeId < b.nodeId ? -1 : 1);
		});
		const topDue = sortedDue[0]!;
		const plannedReview = plan.items.find((item) => item.nodeId === topDue.nodeId && (item.kind === "review" || item.kind === "vehicle"));
		const pct = Math.round(Math.max(0, Math.min(1, topDue.R)) * 100);
		const defaultReason = topDue.R < topDue.retention - mandatoryMargin
			? `Revisão urgente — retenção caiu para ${pct}%`
			: `Revisão vencida — retenção estimada ${pct}%`;
		urgentReview = {
			nodeId: topDue.nodeId,
			title: cur.view.nodes.get(topDue.nodeId)?.title ?? cur.snapshot.items[topDue.nodeId]?.title.pt ?? topDue.nodeId,
			retrievability: Math.round(topDue.R * 10_000) / 10_000,
			reason: plannedReview?.reason ?? defaultReason,
		};
	}

	const support = new Map(Object.values(cur.snapshot.items).filter(n => n.reinforcementFor && n.status !== "deprecated" &&
		!snap.nodes[n.id]?.attainedAt && !snap.nodes[n.id]?.placedAt).map(n => [n.reinforcementFor, n]));
	const suggestion = support.size ? failedChecks(events).sort((a, b) => b.checks[0]!.seq - a.checks[0]!.seq)
		.map(c => support.get(c.target)).find(Boolean) : undefined;

	return {
		budgetMin,
		events,
		snap,
		review,
		signals,
		known,
		available,
		campaign,
		customGoal,
		plan,
		next,
		pendingCheck,
		focusNodeId,
		currentModule,
		queue,
		reinforceHint,
		dueReviewsCount,
		urgentReview,
		suggestion,
	};
}

export function studyMap() {
	const { id, manifest, profile } = requireActive();
	const cur = loadCurriculum(id, manifest, profile?.goal.targetNodeIds);
	if (!cur) throw new StudyError(404, "Currículo indisponível.");
	const todayPlan = computeTodayPlan({ id, manifest, profile, cur, at: new Date().toISOString(), runReinforcementQueue: true });
	const map = skillMap(cur.snapshot, cur.view, todayPlan.snap, manifest.title.pt);
	map.mapStyle = manifest.mapStyle ?? DEFAULT_SKILL_MAP_STYLE;
	map.next = todayPlan.next?.nodeId;
	if (todayPlan.next?.kind === "remediate") map.reinforcement = todayPlan.next.reason;
	const latest = todayPlan.events.findLast((e): e is Exposure => e.kind === "exposure" && !e.exploratory && e.source === "ai_lesson" && cur.view.nodes.has(e.nodeId));
	map.position = latest?.nodeId;
	return map;
}

export function setStudyMapStyle(domainId: string | undefined, style: unknown): { domain: DomainId; mapStyle: SkillMapStyle } {
	if (!isSkillMapStyle(style)) throw new StudyError(400, "Estilo de árvore inválido.");
	const targetId = domainId?.trim() || activeDomainId();
	if (!targetId) throw new StudyError(404, "Nenhum domínio ativo.");
	const store = studyDomains();
	if (!store.hasDomain(targetId)) throw new StudyError(404, `Domínio desconhecido: ${targetId}`);
	const updated = store.updateManifest(targetId, (current) => ({ ...current, mapStyle: style }));
	return { domain: updated.id, mapStyle: updated.mapStyle ?? style };
}

export function studyToday(): StudyToday {
	const { id, manifest, profile } = requireActive();
	const domain = { id, title: manifest.title.pt, accent: manifest.accent, icon: manifest.icon };
	const budgetMin = profile?.dailyBudgetMin ?? 180;
	const cur = loadCurriculum(id, manifest, profile?.goal.targetNodeIds);
	if (!cur) {
		return {
			domain,
			ready: false,
			next: null,
			pendingCheck: null,
			plan: { budgetMin, reviewMinutes: 0, newMinutes: 0, items: 0 },
			progress: { leaves: 0, attained: 0, mastered: 0, totalHours: 0, attainedHours: 0 },
		};
	}
	const at = new Date().toISOString();
	const todayPlan = computeTodayPlan({ id, manifest, profile, cur, at, runReinforcementQueue: true });
	const {
		snap,
		review,
		known,
		available,
		campaign,
		customGoal,
		plan,
		next,
		pendingCheck,
		focusNodeId,
		currentModule,
		queue,
		reinforceHint,
		dueReviewsCount,
		urgentReview,
		suggestion,
	} = todayPlan;

	const moduleScores = readModuleScoreMap(id);
	const problemSetScores = readProblemSetScoreMap(id);
	const activity = studyActivitySummary(id, at);
	const syllabus = buildStudySyllabus({
		snapshot: cur.snapshot,
		graph: cur.view,
		learner: snap,
		campaign,
		known,
		available,
		at,
		recentMinutes14d: activity.minutes14d,
		activeDays14d: activity.activeDays14d,
		totalStudiedMinutes: activity.totalStudiedMinutes,
		dailyBudgetMin: budgetMin,
		moduleScores,
		problemSetScores,
		...(focusNodeId ? { focusNodeId } : {}),
	});

	const enrichedNext = enrichNextWithSyllabus(id, next, currentModule?.id, syllabus);

	const pacing: StudyTodayPacing = {
		plannedWeeklyHours: syllabus.schedule.weeklyHoursPlanned,
		effectiveWeeklyHours: syllabus.schedule.effectiveWeeklyHours,
		activeChapterWeeks: syllabus.activeChapterIndex !== null ? syllabus.schedule.activeChapterWeeks : null,
		realisticTotalWeeks: syllabus.totalLessons > 0 ? syllabus.schedule.weeksToFinish : null,
	};

	const activeSyllabusMod = currentModule
		? syllabus.chapters.flatMap((c) => c.modules).find((m) => m.id === currentModule.id)
		: undefined;
	const moduleAssessment: StudyTodayModuleAssessment | undefined = activeSyllabusMod
		? {
			moduleId: activeSyllabusMod.id,
			examUnlocked: activeSyllabusMod.examUnlocked,
			examPassed: Boolean(activeSyllabusMod.examPassed),
			...(activeSyllabusMod.examScore !== undefined ? { examScore: activeSyllabusMod.examScore } : {}),
			problemSetPassed: Boolean(activeSyllabusMod.problemSetPassed),
			...(activeSyllabusMod.problemSetScore !== undefined ? { problemSetScore: activeSyllabusMod.problemSetScore } : {}),
		}
		: undefined;

	let leaves = 0;
	let attained = 0;
	let mastered = 0;
	let rawTotalHours = 0;
	let plannedPracticeHours = 0;
	let rawAttainedHours = 0;
	let coolingAlert: StudyTodayCoolingAlert | null = null;
	for (const nodeId of cur.view.ids) {
		const node = cur.view.nodes.get(nodeId);
		if (!node?.isLeaf || cur.snapshot.items[nodeId]?.reinforcementFor) continue;
		leaves++;
		const h = hoursMid(cur.snapshot.items[nodeId]?.hours ?? { lo: 0, hi: 0 });
		rawTotalHours += h;
		plannedPracticeHours += cur.snapshot.items[nodeId]?.practice?.targetHours ?? 0;
		const st = snap.nodes[nodeId];
		if (st?.lessonCompletedAt || st?.attainedAt || st?.placedAt) {
			attained++;
			rawAttainedHours += h;
		}
		if (st?.masteredAt) mastered++;
		if (st?.fsrs && st.fsrs.state !== FSRS_STATE.new && st.fsrs.lastReviewAt) {
			const r = retrievability(st.fsrs, at, DEFAULT_LEARNER_PARAMS);
			if (r < 0.85 && (!coolingAlert || r < coolingAlert.retrievability)) {
				coolingAlert = {
					nodeId,
					title: node.title ?? cur.snapshot.items[nodeId]?.title.pt ?? nodeId,
					retrievability: Math.round(r * 10_000) / 10_000,
				};
			}
		}
	}
	const alignedTotalHours = syllabus.totalHours > 0
		? Math.round(syllabus.totalHours * 10) / 10
		: Math.round(rawTotalHours * 10) / 10;
	const alignedAttainedHours = syllabus.totalHours > 0
		? Math.round(syllabus.completedLessonHours * 10) / 10
		: Math.round(rawAttainedHours * 10) / 10;

	return {
		domain,
		ready: true,
		chapters: campaign.journey,
		...(currentModule && { currentModule }),
		...(queue.length > 0 && { queue }),
		...(reinforceHint && { reinforceHint }),
		...(customGoal && { campaignGoal: profile?.goal.text || "Meta personalizada" }),
		...(review && { review: { id: review.id, prompt: review.prompt, title: cur.view.nodes.get(review.nodeId)!.title } }),
		...(suggestion && { optionalPractice: { id: suggestion.id, title: suggestion.title.pt } }),
		next: enrichedNext,
		pendingCheck,
		plan: { budgetMin, reviewMinutes: plan.reviewMinutes, newMinutes: plan.newMinutes, items: plan.items.length },
		progress: {
			leaves,
			attained,
			mastered,
			totalHours: alignedTotalHours,
			attainedHours: alignedAttainedHours,
			...(plannedPracticeHours > 0 && { plannedPracticeHours: Math.round(plannedPracticeHours) }),
		},
		dueReviewsCount,
		urgentReview,
		pacing,
		...(moduleAssessment && { moduleAssessment }),
		coolingAlert,
	};
}

// ─── profile ─────────────────────────────────────────────────────────────────

/**
 * XP = credited lesson minutes (progress/xp.ts lessonCredit): a lesson earns
 * XP from the first quiz check or, in its absence, the self-check — passed (grade >= 2) = full credit,
 * otherwise effort credit. XP uses the planned lesson minutes.
 */
function domainXp(events: readonly LearnerEvent[]): { xp: number; lessons: number } {
	let xp = 0;
	let lessons = 0;
	for (const { exposure, rating } of ratedLessons(events).values()) {
		if (!rating) continue;
		const minutes = Math.min(exposure.minutes, 1440);
		const credit = lessonCredit(minutes, minutes, rating.grade >= 2);
		xp += credit.minutes * credit.multiplier;
		lessons++;
	}
	return { xp: Math.round(xp), lessons };
}

/** Seven tier stages = the curriculum's leaves in teaching order, cut by cumulative hours. */
function tierCoreOf(view: LearnerGraphView, snapshot: CurriculumSnapshot): { coreVersion: string; stages: string[][] } {
	const leaves = view.ids.filter((id) => view.nodes.get(id)?.isLeaf && !snapshot.items[id]?.reinforcementFor);
	const hoursOf = (id: string) => hoursMid(snapshot.items[id]?.hours ?? { lo: 0, hi: 0 });
	const total = leaves.reduce((a, id) => a + hoursOf(id), 0) || 1;
	const stages: string[][] = [[], [], [], [], [], [], []];
	let acc = 0;
	for (const id of leaves) {
		const h = hoursOf(id);
		const stage = Math.min(6, Math.floor((7 * (acc + h / 2)) / total));
		(stages[stage] as string[]).push(id);
		acc += h;
	}
	return { coreVersion: "hours-7@" + snapshot.certificate.hash.slice(0, 12), stages };
}

function chatTurns(dirs: readonly string[]): TurnUsage[] {
	const s = state();
	const usageByChatFile = s.usageByChatFile;
	const turns: TurnUsage[] = [];
	const next: typeof usageByChatFile = new Map();
	for (const dir of dirs) {
		let names: string[];
		try {
			names = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
		} catch {
			continue;
		}
		for (const name of names) {
			try {
				const file = path.join(dir, name);
				const stat = fs.statSync(file, { bigint: true });
				const revision = [stat.dev, stat.ino, stat.size, stat.ctimeNs, stat.mtimeNs].join("/");
				let entry = usageByChatFile.get(file);
				if (entry?.revision !== revision) {
					const record = JSON.parse(fs.readFileSync(file, "utf8")) as { turns?: TurnUsage[] };
					entry = { revision, turns: Array.isArray(record.turns) ? record.turns : [] };
				}
				next.set(file, entry);
				for (const turn of entry.turns) turns.push(turn);
			} catch {
				/* unreadable record: skipped */
			}
		}
	}
	s.usageByChatFile = next;
	return turns;
}

function profileUsage(stats: StatsStore, domainChatDirs: string[], until: string): StudyProfile["usage"] {
	type Row = StudyProfile["usage"]["byModel"][number];
	const models = new Map<string, Row>();
	let totalTokens = 0;
	let calls = 0;
	function add(model: string, input: number, output: number, cached: number, count: number) {
		const row = models.get(model) ?? { model, input: 0, output: 0, cached: 0, tokens: 0, calls: 0 };
		row.input += input;
		row.output += output;
		row.cached += cached;
		row.tokens += input + output + cached;
		row.calls += count;
		models.set(model, row);
		totalTokens += input + output + cached;
		calls += count;
	}
	const firstMonth = stats.listMonths("usage")[0];
	if (firstMonth) {
		const { events } = stats.readUsage({ from: firstMonth + "-01T00:00:00Z", to: until });
		for (const row of aggregateUsage(events).byModel) {
			add(row.provider + ":" + row.model, row.inputTokens, row.outputTokens, row.cachedTokens + row.cacheWriteTokens, row.calls);
		}
	}
	// Preserve historical counters and calls where telemetry could not be written.
	for (const turn of chatTurns([path.join(PATHS.data, "chats"), ...domainChatDirs])) {
		for (const step of turn.steps ?? []) {
			if (!step.recordedInStats) add(turn.model, step.inputTokens ?? 0, step.outputTokens ?? 0, (step.cacheReadTokens ?? 0) + (step.cacheWriteTokens ?? 0), 1);
		}
	}
	return { totalTokens, calls, byModel: [...models.values()].sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model)) };
}

/** Header totals use the same rated lessons as the profile, without loading curricula or usage charts. */
export function studyAccountSummary(domains: StudyDomainList["domains"]) {
	const s = state();
	const headerDomainXp = s.headerDomainXp;
	const current: typeof headerDomainXp = new Map();
	let xp = 0;
	for (const { id } of domains) {
		const revision = studyLogRevision(id);
		const cached = headerDomainXp.get(id);
		if (cached && cached.revision === revision) {
			current.set(id, cached);
			xp += cached.xp;
			continue;
		}
		const emptyLogPath = path.join(learnerDir(PATHS.data, id), "events.jsonl");
		const value = revision === emptyLogPath ? 0 : domainXp(readStudyEvents(id)).xp;
		if (revision !== undefined) current.set(id, { revision, xp: value });
		xp += value;
	}
	s.headerDomainXp = current;
	return { xp, level: levelProgress(xp).level };
}

export function studyProfile(): StudyProfile {
	const store = studyDomains();
	const at = new Date().toISOString();
	const domains: StudyProfile["domains"] = [];
	let totalXp = 0;
	const manifests = store.scanDomains().manifests;
	for (const manifest of manifests) {
		const cur = loadCurriculum(manifest.id, manifest);
		const history = cur && readLearnerHistory(manifest.id, cur.snapshot, cur.view, at);
		const xp = domainXp(history?.events ?? readStudyEvents(manifest.id));
		totalXp += xp.xp;
		let tier = { label: "Novato", pm: 0, fractions: [0, 0, 0, 0, 0, 0, 0] };
		let attained = 0;
		let mastered = 0;
		let leaves = 0;
		let transcript: StudyProfile["domains"][number]["transcript"];
		if (cur && history) {
			const { snap } = history;
			const retention = new Map<string, number>();
			for (const id of cur.view.ids) {
				if (!cur.view.nodes.get(id)?.isLeaf || cur.snapshot.items[id]?.reinforcementFor) continue;
				leaves++;
				const st = snap.nodes[id];
				if (st?.masteredAt) mastered++;
				if (!st || (!st.attainedAt && !st.placedAt && !st.lessonCompletedAt)) continue;
				attained++;
				// Placements without a card count at their diagnostic confidence.
				retention.set(id, st.fsrs ? retrievability(st.fsrs, at, DEFAULT_LEARNER_PARAMS) : 0.9);
			}
			const standing = tierStanding(tierCoreOf(cur.view, cur.snapshot), retention);
			tier = {
				label: standing.label,
				pm: Math.round(standing.pm * 100) / 100,
				fractions: standing.fractions.map((f) => Math.round(f * 1000) / 1000),
			};
			const known = structuralState(snap, cur.view).known;
			const campaign = studyCampaign(cur.snapshot, cur.view, known);
			transcript = buildDomainTranscript({
				domainId: manifest.id,
				domainTitle: manifest.title.pt,
				snapshot: cur.snapshot,
				graph: cur.view,
				learner: snap,
				campaign,
				known,
				at,
				moduleScores: readModuleScoreMap(manifest.id),
			});
		}
		domains.push({
			id: manifest.id, title: manifest.title.pt, accent: manifest.accent, icon: manifest.icon,
			xp: xp.xp, lessons: xp.lessons, tier, attained, mastered, leaves,
			...(transcript ? { transcript } : {}),
		});
	}

	const stats = createStatsStore(PATHS.data);
	const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const until = new Date(Date.now() + 1).toISOString();
	const today = dayKey(at, timeZone);
	const startDay = addDays(today, -13);
	const start = new Date(at);
	start.setDate(start.getDate() - 13);
	start.setHours(0, 0, 0, 0);
	const range = { from: start.toISOString(), to: until };
	const daily = aggregateActivity(stats.readActivity(range).events, { range, timeZone, windowSec: STUDY_HEARTBEAT_SEC });
	const days = denseDailySeries(daily, startDay, today).map(d => ({ day: d.day, minutes: d.activeSec / 60 }));

	const lp = levelProgress(totalXp);
	return {
		account: { level: lp.level, xp: totalXp, xpIntoLevel: Math.round(lp.xpIntoLevel), xpToNext: Math.round(lp.xpToNext), fraction: lp.fraction },
		domains,
		usage: profileUsage(stats, manifests.map(d => chatsDir(PATHS.data, d.id)), until),
		days,
	};
}
