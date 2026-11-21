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
import { activeDomainFile, curriculumDir } from "../core/domains/paths.ts";
import type { DomainId, DomainManifest, DomainProfile } from "../core/domains/types.ts";
import { emit } from "../core/events.ts";
import type { LearnerGraphView } from "../core/learner/graph-view.ts";
import { emptySnapshot, foldEvents } from "../core/learner/fold.ts";
import { DEFAULT_LEARNER_PARAMS } from "../core/learner/params.ts";
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
import type { StudyDomainList, StudyProfile, StudyToday } from "../core/study/types.ts";
import { lessonCredit } from "../core/progress/xp.ts";
import { levelProgress } from "../core/progress/levels.ts";
import { tierStanding } from "../core/progress/tiers.ts";
import { retrievability } from "../core/learner/fsrs.ts";
import { aggregateActivity, aggregateUsage, denseDailySeries } from "../core/stats/aggregate.ts";
import { addDays, dayKey } from "../core/stats/dates.ts";
import { parseActivityEvent } from "../core/stats/schema.ts";
import { chatsDir, isUsableDomainId, learnerDir } from "../core/domains/paths.ts";
import { buildDomainTranscript } from "../core/study/transcript.ts";
import { isAdvancedDefenseNode } from "../core/study/tutor-pedagogy.ts";
import { STUDY_HEARTBEAT_SEC, WORKSPACE_SCOPE } from "../core/stats/types.ts";
import { createStatsStore, type StatsStore } from "../store/stats-store.ts";
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

type StudyGlobal = {
	__lhStudy?: { root: string; store: DomainsStore; seeded: boolean; curricula: Map<string, { stamp: number | string; snapshot: CurriculumSnapshot; view: LearnerGraphView }> };
};

function state() {
	const g = globalThis as typeof globalThis & StudyGlobal;
	if (!g.__lhStudy || g.__lhStudy.root !== PATHS.data) {
		g.__lhStudy = { root: PATHS.data, store: createDomainsStore(PATHS.data), seeded: false, curricula: new Map() };
	}
	return g.__lhStudy;
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
		.listDomains()
		.map((d) => ({ ...d, active: d.id === active }));
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

export function loadCurriculum(id: DomainId, manifest: DomainManifest, goals: readonly string[] = []): { snapshot: CurriculumSnapshot; view: LearnerGraphView } | null {
	const dir = curriculumDir(PATHS.data, id);
	const cache = state().curricula;
	const stamp = electronicsCurriculumStamp(dir);
	let entry = cache.get(id);
	if (!entry || entry.stamp !== stamp) {
		const loaded = loadDomainCurriculum(id, dir, manifest.edgeMode, () => seedFilesOf(id));
		if (!loaded) return null;
		entry = { ...loaded, view: learnerViewOf(loaded.snapshot) };
		cache.set(id, entry);
	}
	if (!goals.length) return entry;
	const key = JSON.stringify(goals);
	let weighted = goalViews.get(entry.snapshot);
	if (weighted?.key !== key) {
		weighted = { key, view: learnerViewOf(entry.snapshot, goals) };
		goalViews.set(entry.snapshot, weighted);
	}
	return { snapshot: entry.snapshot, view: weighted.view };
}

type CurriculumSource = CurriculumSeedFile["sources"][number];
const sourceCatalogs = new Map<string, Map<string, CurriculumSource>>();

export function curriculumSources(id: DomainId) {
	const dir = curriculumDir(PATHS.data, id);
	let sources = sourceCatalogs.get(dir);
	if (!sources) {
		const file = path.join(dir, "sources.json");
		const records: CurriculumSource[] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : seedFilesOf(id).flatMap(seed => seed.sources);
		sources = new Map(records.map(source => [source.id, source]));
		sourceCatalogs.set(dir, sources);
	}
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
export function lessonRoute(id: DomainId, view: LearnerGraphView, events: LearnerEvent[], nodeId: string) {
	const clauses = view.nodes.get(nodeId)?.clauses ?? [];
	if (!clauses.length) return { route: [], missing: [] };
	const learner = learnerSnapshotOf(id, view, events, new Date().toISOString());
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
	const events = readStudyEvents(domainId);
	const snap = learnerSnapshotOf(domainId, cur.view, events, at);
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

/** Append one learner event to the ACTIVE domain's log; returns the fresh "Hoje". */
function finishedExposures(events: readonly LearnerEvent[]) {
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

export function lessonCompletionState(domainId: string, sessionId: string) {
	const events = readStudyEvents(domainId);
	const state = completionState(events, sessionId);
	if (!state) return null;
	const reinforcement = state.completed ? events.find(e => e.kind === "lesson-finished" && e.exposureId === state.exposure.id && e.outcome === "reinforce") : undefined;
	const manifest = studyDomains().readManifest(domainId);
	const profile = studyDomains().readProfile(domainId);
	const cur = manifest && loadCurriculum(domainId, manifest, profile?.goal.targetNodeIds);
	let course: LessonCourseContext | null = null;
	let next: StudyToday["next"] = null;
	let resume: string | null = null;
	let retry: { nodeId: string; brief: StudyNodeBrief; estMinutes: number; feedback: string } | null = null;
	if (cur) {
		const at = new Date().toISOString();
		const snap = learnerSnapshotOf(domainId, cur.view, events, at);
		const signals = computeSignals(snap, cur.view, DEFAULT_LEARNER_PARAMS, at);
		const campaign = studyCampaign(cur.snapshot, cur.view, signals.structure.known);
		course = lessonCourseContext(cur.snapshot, cur.view, campaign, signals.structure.known, state.exposure.nodeId);
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
		} else if (state.completed && activeDomainId() === domainId) {
			const today = studyToday();
			next = today.next?.nodeId !== state.exposure.nodeId ? today.next : null;
			const finished = finishedExposures(events);
			const domainChatsDir = chatsDir(PATHS.data, domainId);
			const sessionExists = (id: string) => !id.startsWith("chat_") || fs.existsSync(path.join(domainChatsDir, id + ".json"));
			const pending = next && [...ratedLessons(events).values()].reverse().find(({ exposure: prior, rating }) =>
				!rating && !finished.has(prior.id) && !prior.exploratory && prior.nodeId === next!.nodeId && prior.sessionId !== "hoje" &&
				sessionExists(prior.sessionId) &&
				Date.now() - Date.parse(prior.at) <= 3 * 86_400_000);
			resume = pending?.exposure.sessionId ?? null;
		}
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
	};
}

export function lessonConclusionObjective(domainId: string, sessionId: string) {
	const events = readStudyEvents(domainId);
	const state = completionState(events, sessionId);
	const manifest = state && !state.completed && studyDomains().readManifest(domainId);
	const cur = manifest && loadCurriculum(domainId, manifest);
	const item = cur && state && cur.snapshot.items[state.exposure.nodeId];
	if (!item || !state || !cur) return undefined;
	const priorReinforcement = [...events].reverse().find(e => e.kind === "lesson-finished" && e.nodeId === state.exposure.nodeId && e.outcome === "reinforce" && e.exposureId !== state.exposure.id);
	const snap = learnerSnapshotOf(domainId, cur.view, events, new Date().toISOString());
	const campaign = studyCampaign(cur.snapshot, cur.view, structuralState(snap, cur.view).known);
	const isFinale = campaign.journey.some(chapter => chapter.finale === state.exposure.nodeId);
	const isAdvancedDefense = isAdvancedDefenseNode(item, isFinale);
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
		...(levelLabel ? { levelLabel } : {}),
		...(priorReinforcement?.kind === "lesson-finished" && priorReinforcement.feedback ? { priorReinforcement: priorReinforcement.feedback } : {}),
	};
}

export function finishStudyLesson(domainId: string, sessionId: string, grade: Grade, reinforcement?: { feedback: string }) {
	const { id, manifest, profile } = requireActive();
	if (id !== domainId) throw new StudyError(409, "O domínio da aula mudou.");
	const events = readStudyEvents(id);
	const state = completionState(events, sessionId);
	if (!state) throw new StudyError(409, "Esta sessão não pertence a uma missão da campanha.");
	const { exposure, completed } = state;
	const domains = studyDomains().listDomains();
	const before = studyAccountSummary(domains).xp;
	const seq = nextStudySeq(events);
	const at = new Date().toISOString();
	if (!completed && !reinforcement && grade < 2) throw new StudyError(409, "O objetivo do nó ainda precisa de prática.");
	const cur = loadCurriculum(id, manifest, profile?.goal.targetNodeIds);
	const snapBefore = cur ? learnerSnapshotOf(id, cur.view, events, at) : null;
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
	const freshEvents = readStudyEvents(id);
	const today = studyToday();
	const next = !reinforcement && today.next?.nodeId !== exposure.nodeId ? today.next : null;
	const finished = finishedExposures(freshEvents);
	const domainChatsDir = chatsDir(PATHS.data, id);
	const sessionExists = (sessionId: string) => !sessionId.startsWith("chat_") || fs.existsSync(path.join(domainChatsDir, sessionId + ".json"));
	const pending = next && [...ratedLessons(freshEvents).values()].reverse().find(({ exposure: prior, rating }) =>
		!rating && !finished.has(prior.id) && !prior.exploratory && prior.nodeId === next.nodeId && prior.sessionId !== "hoje" &&
		sessionExists(prior.sessionId) &&
		Date.now() - Date.parse(prior.at) <= 3 * 86_400_000);
	let course: LessonCourseProgress | null = null;
	let retry: { nodeId: string; brief: StudyNodeBrief; estMinutes: number; feedback: string } | null = null;
	if (cur && knownBefore && campaignBefore) {
		const snapAfter = learnerSnapshotOf(id, cur.view, freshEvents, new Date().toISOString());
		const knownAfter = structuralState(snapAfter, cur.view).known;
		const campaignAfter = studyCampaign(cur.snapshot, cur.view, knownAfter);
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
	}
	return {
		before,
		after: studyAccountSummary(domains).xp,
		alreadyCompleted: completed,
		resume: pending?.exposure.sessionId ?? null,
		next,
		course,
		...(retry && { retry }),
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
const projectedHistory = new WeakMap<LearnerGraphView, {
	revision: string; events: LearnerEvent[]; snap: LearnerSnapshot;
}>();

function readLearnerHistory(id: DomainId, view: LearnerGraphView, at: string) {
	const revision = studyLogRevision(id);
	const cached = projectedHistory.get(view);
	if (cached && revision === cached.revision) return cached;
	const events = readStudyEvents(id);
	const snap = learnerSnapshotOf(id, view, events, at);
	// An empty/orphan-only history uses the request time as its snapshot date.
	if (revision !== undefined && snap.seq > 0) projectedHistory.set(view, { revision, events, snap });
	return { events, snap };
}

export function studyMap() {
	const { id, manifest } = requireActive();
	const cur = loadCurriculum(id, manifest);
	if (!cur) throw new StudyError(404, "Currículo indisponível.");
	const { events, snap } = readLearnerHistory(id, cur.view, new Date().toISOString());
	const map = skillMap(cur.snapshot, cur.view, snap, manifest.title.pt);
	const next = studyToday().next;
	map.next = next?.nodeId;
	if (next?.kind === "remediate") map.reinforcement = next.reason;
	const latest = events.findLast((e): e is Exposure => e.kind === "exposure" && !e.exploratory && e.source === "ai_lesson" && cur.view.nodes.has(e.nodeId));
	map.position = latest?.nodeId;
	return map;
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
	const { events, snap } = readLearnerHistory(id, cur.view, at);
	const review = eligibleReview(reviewBank(id, cur.view), events, at);
	queueReinforcements(id, events);
	const signals = computeSignals(snap, cur.view, DEFAULT_LEARNER_PARAMS, at);
	const reinforced = pendingReinforcements(events, signals.structure.known);
	const reinforcedIds = new Set(reinforced.keys());
	// Spacing rule: a node TAUGHT in the last 20 h is not re-taught as "new" —
	// its consolidation comes from tomorrow's delayed check, unless its latest
	// formal exam closed with reinforcement (allow immediate guided retry).
	const recent = new Set<string>();
	for (const ev of events) {
		if (ev.kind === "exposure" && !ev.exploratory && !reinforcedIds.has(ev.nodeId) && Date.parse(at) - Date.parse(ev.at) < 20 * 3_600_000) {
			recent.add(ev.nodeId);
		}
	}
	const campaign = studyCampaign(cur.snapshot, cur.view, signals.structure.known);
	const customGoal = hasCustomCampaignGoal(cur.snapshot, profile?.goal.targetNodeIds);
	const plan = planDay(snap, cur.view, DEFAULT_LEARNER_PARAMS, { at, budgetMin, signals,
		...guidedLessonOptions(customGoal ? undefined : campaign, events, at, review?.nodeId, reinforcedIds) });
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
		if (Date.parse(at) - exposedAt > 3 * 86_400_000) return false;
		if (exposure.sessionId === "hoje") return !rating;
		if (finished.has(exposure.id) || !sessionExists(exposure.sessionId)) return false;
		// A newer finished lesson for this same node supersedes older unfinished attempts.
		if ((latestFinishByNode.get(exposure.nodeId) ?? -Infinity) >= exposedAt) return false;
		return true;
	});
	if (pending) {
		const { id: exposureId, nodeId, sessionId, at } = pending.exposure;
		pendingCheck = { exposureId, nodeId, sessionId, title: cur.view.nodes.get(nodeId)?.title ?? nodeId, at };
	}
	const available = new Set(signals.structure.frontier);
	const focusNodeId = pendingCheck?.nodeId ?? next?.nodeId;
	const currentModule = activeModuleOf(cur.snapshot, cur.view, campaign, signals.structure.known, available, focusNodeId);
	const queue = campaignQueue(cur.snapshot, cur.view, campaign, plan.items.filter(it => !(it.kind === "new" && recent.has(it.nodeId))), next?.nodeId, 4);
	const reinforceHint = pick && reinforceNote && next
		? { nodeId: next.nodeId, title: next.brief.title, feedback: reinforceNote }
		: undefined;

	const support = new Map(Object.values(cur.snapshot.items).filter(n => n.reinforcementFor && n.status !== "deprecated" &&
		!snap.nodes[n.id]?.attainedAt && !snap.nodes[n.id]?.placedAt).map(n => [n.reinforcementFor, n]));
	const suggestion = support.size ? failedChecks(events).sort((a,b) => b.checks[0]!.seq - a.checks[0]!.seq)
		.map(c => support.get(c.target)).find(Boolean) : undefined;
	let leaves = 0;
	let attained = 0;
	let mastered = 0;
	let totalHours = 0;
	let plannedPracticeHours = 0;
	let attainedHours = 0;
	for (const nodeId of cur.view.ids) {
		const node = cur.view.nodes.get(nodeId);
		if (!node?.isLeaf || cur.snapshot.items[nodeId]?.reinforcementFor) continue;
		leaves++;
		const h = hoursMid(cur.snapshot.items[nodeId]?.hours ?? { lo: 0, hi: 0 });
		totalHours += h;
		plannedPracticeHours += cur.snapshot.items[nodeId]?.practice?.targetHours ?? 0;
		const st = snap.nodes[nodeId];
		if (st?.lessonCompletedAt || st?.attainedAt || st?.placedAt) {
			attained++;
			attainedHours += h;
		}
		if (st?.masteredAt) mastered++;
	}
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
		next,
		pendingCheck,
		plan: { budgetMin, reviewMinutes: plan.reviewMinutes, newMinutes: plan.newMinutes, items: plan.items.length },
		progress: { leaves, attained, mastered, totalHours: Math.round(totalHours), attainedHours: Math.round(attainedHours),
			...(plannedPracticeHours > 0 && { plannedPracticeHours: Math.round(plannedPracticeHours) }) },
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

let usageByChatFile = new Map<string, { revision: string; turns: TurnUsage[] }>();

function chatTurns(dirs: readonly string[]): TurnUsage[] {
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
	usageByChatFile = next;
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

let headerDomainXp = new Map<string, { revision: string; xp: number }>();

/** Header totals use the same rated lessons as the profile, without loading curricula or usage charts. */
export function studyAccountSummary(domains: StudyDomainList["domains"]) {
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
		const value = domainXp(readStudyEvents(id)).xp;
		if (revision !== undefined) current.set(id, { revision, xp: value });
		xp += value;
	}
	headerDomainXp = current;
	return { xp, level: levelProgress(xp).level };
}

function readSavedModuleScores(domainId: string): Map<string, { score: number; passed: boolean; at: string }> {
	const scores = new Map<string, { score: number; passed: boolean; at: string }>();
	const file = path.join(learnerDir(PATHS.data, domainId), "module-exams.jsonl");
	let raw: string;
	try { raw = fs.readFileSync(file, "utf8"); } catch { return scores; }
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		try {
			const row = JSON.parse(line) as { targetId?: string; score10?: number; passed?: boolean; at?: string };
			if (typeof row.targetId === "string" && typeof row.score10 === "number" && typeof row.at === "string") {
				scores.set(row.targetId, { score: row.score10, passed: Boolean(row.passed), at: row.at });
			}
		} catch { /* ignore partial line */ }
	}
	return scores;
}

export function studyProfile(): StudyProfile {
	const store = studyDomains();
	const at = new Date().toISOString();
	const domains: StudyProfile["domains"] = [];
	let totalXp = 0;
	const listed = store.listDomains();
	for (const summary of listed) {
		const manifest = store.readManifest(summary.id);
		if (!manifest) continue;
		const cur = loadCurriculum(summary.id, manifest);
		const history = cur && readLearnerHistory(summary.id, cur.view, at);
		const xp = domainXp(history?.events ?? readStudyEvents(summary.id));
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
				domainId: summary.id,
				domainTitle: manifest.title.pt,
				snapshot: cur.snapshot,
				graph: cur.view,
				learner: snap,
				campaign,
				known,
				at,
				moduleScores: readSavedModuleScores(summary.id),
			});
		}
		domains.push({
			id: summary.id, title: manifest.title.pt, accent: manifest.accent, icon: manifest.icon,
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
		usage: profileUsage(stats, listed.map(d => chatsDir(PATHS.data, d.id)), until),
		days,
	};
}
