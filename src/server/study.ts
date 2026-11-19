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
 *    graderConfidence 0.5, weight 0.5, its own item family — it can attain a
 *    node but never master it alone (mastery needs ≥2 distinct families).
 *  - "Já domino" is a diagnostic placement (p = 0.9): the node unlocks its
 *    dependents but stays `inferred` until a real check.
 */

import fs from "node:fs";
import path from "node:path";
import { activeDomainId, PATHS, setActiveDomainId } from "../../config.ts";
import { applySeedFiles } from "../core/curriculum/ledger.ts";
import { hoursMid } from "../core/curriculum/hours.ts";
import type { CurriculumSeedFile, CurriculumSnapshot } from "../core/curriculum/types.ts";
import { activeDomainFile, curriculumDir } from "../core/domains/paths.ts";
import type { DomainId, DomainManifest, DomainProfile } from "../core/domains/types.ts";
import { emit } from "../core/events.ts";
import type { LearnerGraphView } from "../core/learner/graph-view.ts";
import { emptySnapshot, foldEvents } from "../core/learner/fold.ts";
import { DEFAULT_LEARNER_PARAMS } from "../core/learner/params.ts";
import { planDay } from "../core/learner/planner.ts";
import { buildPromptSnapshot } from "../core/learner/snapshot.ts";
import { computeSignals } from "../core/learner/signals.ts";
import { structuralState } from "../core/learner/kst.ts";
import type { Evidence, Grade, LearnerEvent, LearnerSnapshot, PlanItem } from "../core/learner/types.ts";
import { learnerViewOf, nodeBrief, type StudyNodeBrief } from "../core/study/projection.ts";
import type { StudyDomainList, StudyProfile, StudyToday } from "../core/study/types.ts";
import { lessonCredit } from "../core/progress/xp.ts";
import { levelProgress } from "../core/progress/levels.ts";
import { tierStanding } from "../core/progress/tiers.ts";
import { retrievability } from "../core/learner/fsrs.ts";
import { aggregateActivity, aggregateUsage, denseDailySeries } from "../core/stats/aggregate.ts";
import { addDays, dayKey } from "../core/stats/dates.ts";
import { parseActivityEvent } from "../core/stats/schema.ts";
import { chatsDir, isUsableDomainId } from "../core/domains/paths.ts";
import { STUDY_HEARTBEAT_SEC, WORKSPACE_SCOPE } from "../core/stats/types.ts";
import { createStatsStore, type StatsStore } from "../store/stats-store.ts";
import { appendStudyEvent, nextStudySeq, persistChatEvent, readStudyEvents } from "./study-log.ts";
import { gradeStudyQuiz } from "../core/study/quiz.ts";
import { skillMap } from "../core/study/map.ts";
import { questionCallsOf, type LhMessage } from "../core/native-messages.ts";
import type { TurnUsage } from "../core/contracts/chat.ts";
import { writeFileAtomicSync } from "../store/atomic-write.ts";
import { createDomainsStore, type DomainsStore } from "../store/domains-store.ts";
import { electronicsCurriculumStamp, loadElectronicsCurriculum } from "./curriculum-migration.ts";
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
export function loadCurriculum(id: DomainId, manifest: DomainManifest, goals: readonly string[] = []): { snapshot: CurriculumSnapshot; view: LearnerGraphView } | null {
	const dir = curriculumDir(PATHS.data, id);
	const snapshotFile = path.join(dir, "snapshot.json");
	const cache = state().curricula;
	if (id === "electronics") {
		const stamp = electronicsCurriculumStamp(dir);
		const hit = cache.get(id);
		if (hit?.stamp === stamp) {
			return goals.length === 0 ? hit : { snapshot: hit.snapshot, view: learnerViewOf(hit.snapshot, goals) };
		}
		const loaded = loadElectronicsCurriculum(dir, manifest.edgeMode, () => seedFilesOf(id));
		if (!loaded) return null;
		const entry = { ...loaded, view: learnerViewOf(loaded.snapshot) };
		cache.set(id, entry);
		return goals.length === 0 ? entry : { snapshot: loaded.snapshot, view: learnerViewOf(loaded.snapshot, goals) };
	}
	let stat: fs.Stats | null = null;
	try {
		stat = fs.statSync(snapshotFile);
	} catch {
		stat = null;
	}
	if (stat) {
		const hit = cache.get(id);
		if (hit && hit.stamp === stat.mtimeMs && goals.length === 0) return hit;
		const snapshot = JSON.parse(fs.readFileSync(snapshotFile, "utf8")) as CurriculumSnapshot;
		const entry = { stamp: stat.mtimeMs, snapshot, view: learnerViewOf(snapshot, goals) };
		if (goals.length === 0) cache.set(id, entry);
		return entry;
	}
	const files = seedFilesOf(id);
	if (files.length === 0) return null;
	const res = applySeedFiles(files, { createdAt: new Date().toISOString(), edgeMode: manifest.edgeMode });
	if (!res.ok) throw new StudyError(500, `Seed do currículo inválido (${id}): ${res.errors.slice(0, 3).map((e) => e.message).join("; ")}`);
	fs.mkdirSync(dir, { recursive: true });
	writeFileAtomicSync(path.join(dir, "ledger.jsonl"), JSON.stringify(res.envelope) + "\n");
	writeFileAtomicSync(snapshotFile, JSON.stringify(res.snapshot));
	const written = fs.statSync(snapshotFile);
	const entry = { stamp: written.mtimeMs, snapshot: res.snapshot, view: learnerViewOf(res.snapshot, goals) };
	if (goals.length === 0) cache.set(id, entry);
	return entry;
}

type CurriculumSource = CurriculumSeedFile["sources"][number];
const sourceCatalogs = new Map<string, Map<string, CurriculumSource>>();

export function curriculumSources(id: DomainId) {
	let sources = sourceCatalogs.get(id);
	if (!sources) {
		sources = new Map(seedFilesOf(id).flatMap(file => file.sources.map(source => [source.id, source] as const)));
		sourceCatalogs.set(id, sources);
	}
	return sources;
}

// ─── learner log ─────────────────────────────────────────────────────────────

type Exposure = Extract<LearnerEvent, { kind: "exposure" }>;
type StudyLesson = { domainId: string; nodeId: string; minutes: number };

export function validateStudyLesson(raw: unknown, nodeId: string | undefined): StudyLesson {
	const { id, manifest } = requireActive();
	const lesson = raw as { domainId?: unknown; minutes?: unknown } | null;
	if (lesson?.domainId !== id) throw new StudyError(409, "O domínio da aula mudou.");
	if (!nodeId || !loadCurriculum(id, manifest)?.view.nodes.get(nodeId)?.isLeaf) throw new StudyError(400, "Nó de aula inválido.");
	const minutes = lesson.minutes;
	if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1) throw new StudyError(400, "Duração da aula inválida.");
	return { domainId: id, nodeId, minutes: Math.min(240, minutes) };
}

export function saveStudyLesson(lesson: StudyLesson, chatId: string, marker: LhMessage, save: () => void) {
	const { domainId, nodeId, minutes } = lesson;
	const seq = nextStudySeq(readStudyEvents(domainId));
	const event: Exposure = { kind: "exposure", id: "lesson-" + chatId, seq, at: new Date(marker.timestamp).toISOString(),
		domainId, sessionId: chatId, nodeId, source: "ai_lesson", minutes };
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
		case "node-version":
			return [ev.nodeId];
		case "implicit-credit":
			return [ev.fromNodeId, ev.toNodeId];
		case "diagnostic":
			return ev.estimates.map((e) => e.nodeId);
	}
}

function learnerSnapshotOf(id: DomainId, view: LearnerGraphView, events: readonly LearnerEvent[], at: string): LearnerSnapshot {
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
export function lessonRoute(id: DomainId, view: LearnerGraphView, events: LearnerEvent[], nodeId: string): string[] {
	const clauses = view.nodes.get(nodeId)?.clauses ?? [];
	if (!clauses.length) return [];
	const learner = learnerSnapshotOf(id, view, events, new Date().toISOString());
	const { known } = structuralState(learner, view);
	const accessible = clauses.filter(clause => clause.every(key => known.has(key)));
	const route = accessible.sort((a,b) => a.length-b.length)[0] ?? [];
	return route.map(key => view.nodes.get(key)!.title);
}

export function studyLearnerPrompt(domainId: string) {
	const store = studyDomains();
	const manifest = store.readManifest(domainId);
	const profile = store.readProfile(domainId);
	const cur = manifest && loadCurriculum(domainId, manifest, profile?.goal.targetNodeIds);
	if (!cur) return null;
	const at = new Date().toISOString();
	const snap = learnerSnapshotOf(domainId, cur.view, readStudyEvents(domainId), at);
	const budgetMin = profile?.dailyBudgetMin ?? 180;
	const signals = computeSignals(snap, cur.view, DEFAULT_LEARNER_PARAMS, at);
	const plan = planDay(snap, cur.view, DEFAULT_LEARNER_PARAMS, { at, budgetMin, signals });
	const prompt = buildPromptSnapshot(snap, cur.view, DEFAULT_LEARNER_PARAMS, { at, plan, signals });
	return { prompt, weak: prompt.weak.map(w => ({ nodeId: w.nodeId, weakness: signals.signals.get(w.nodeId)!.weakScore })) };
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
			.find((ev): ev is Extract<LearnerEvent, { kind: "exposure" }> => ev.kind === "exposure" && ev.nodeId === input.nodeId && (!input.exposureId || ev.id === input.exposureId) && (!input.sessionId || ev.sessionId === input.sessionId));
		if ((input.exposureId || input.sessionId) && !lastExposure) throw new StudyError(409, "Esta aula não está pendente.");
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

export function studyMap() {
	const { id, manifest } = requireActive();
	const cur = loadCurriculum(id, manifest);
	if (!cur) throw new StudyError(404, "Currículo indisponível.");
	const learner = learnerSnapshotOf(id, cur.view, readStudyEvents(id), new Date().toISOString());
	const map = skillMap(cur.snapshot, cur.view, learner, manifest.title.pt);
	map.next = studyToday().next?.nodeId;
	return map;
}

export function studyToday(): StudyToday {
	const { id, manifest, profile } = requireActive();
	const domain = { id, title: manifest.title.pt, accent: manifest.accent, icon: manifest.icon };
	const budgetMin = profile?.dailyBudgetMin ?? 180;
	const cur = loadCurriculum(id, manifest);
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
	const events = readStudyEvents(id);
	const snap = learnerSnapshotOf(id, cur.view, events, at);
	const plan = planDay(snap, cur.view, DEFAULT_LEARNER_PARAMS, { at, budgetMin });
	// Spacing rule: a node TAUGHT in the last 20 h is not re-taught as "new" —
	// its consolidation comes from tomorrow's delayed check (an immediate
	// self-check is weak evidence by design), so "Hoje" moves on.
	const recent = new Set<string>();
	for (const ev of events) if (ev.kind === "exposure" && Date.parse(at) - Date.parse(ev.at) < 20 * 3_600_000) recent.add(ev.nodeId);
	const pick = [plan.next, ...plan.items].find((it): it is PlanItem => !!it && !(it.kind === "new" && recent.has(it.nodeId))) ?? null;
	const next = pick ? { ...pick, brief: nodeBrief(cur.snapshot, pick.nodeId) as StudyNodeBrief } : null;

	let pendingCheck: StudyToday["pendingCheck"] = null;
	const lessons = [...ratedLessons(events).values()];
	const pending = lessons.reverse().find(({ exposure, rating }) => !rating &&
		Date.parse(at) - Date.parse(exposure.at) <= 3 * 86_400_000 && cur.view.nodes.has(exposure.nodeId));
	if (pending) {
		const { id: exposureId, nodeId, sessionId, at } = pending.exposure;
		pendingCheck = { exposureId, nodeId, sessionId, title: cur.view.nodes.get(nodeId)?.title ?? nodeId, at };
	}

	let leaves = 0;
	let attained = 0;
	let mastered = 0;
	let totalHours = 0;
	let attainedHours = 0;
	for (const nodeId of cur.view.ids) {
		const node = cur.view.nodes.get(nodeId);
		if (!node?.isLeaf) continue;
		leaves++;
		const h = hoursMid(cur.snapshot.items[nodeId]?.hours ?? { lo: 0, hi: 0 });
		totalHours += h;
		const st = snap.nodes[nodeId];
		if (st?.attainedAt || st?.placedAt) {
			attained++;
			attainedHours += h;
		}
		if (st?.masteredAt) mastered++;
	}
	return {
		domain,
		ready: true,
		next,
		pendingCheck,
		plan: { budgetMin, reviewMinutes: plan.reviewMinutes, newMinutes: plan.newMinutes, items: plan.items.length },
		progress: { leaves, attained, mastered, totalHours: Math.round(totalHours), attainedHours: Math.round(attainedHours) },
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
	const leaves = view.ids.filter((id) => view.nodes.get(id)?.isLeaf);
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
	const turns: TurnUsage[] = [];
	for (const dir of dirs) {
		let names: string[];
		try {
			names = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
		} catch {
			continue;
		}
		for (const name of names) {
			try {
				const record = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as { turns?: TurnUsage[] };
				if (Array.isArray(record.turns)) turns.push(...record.turns);
			} catch {
				/* unreadable record: skipped */
			}
		}
	}
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
		const events = readStudyEvents(summary.id);
		const xp = domainXp(events);
		totalXp += xp.xp;
		let tier = { label: "Novato", pm: 0, fractions: [0, 0, 0, 0, 0, 0, 0] };
		let attained = 0;
		let mastered = 0;
		let leaves = 0;
		if (cur) {
			const snap = learnerSnapshotOf(summary.id, cur.view, events, at);
			const retention = new Map<string, number>();
			for (const id of cur.view.ids) {
				if (!cur.view.nodes.get(id)?.isLeaf) continue;
				leaves++;
				const st = snap.nodes[id];
				if (st?.masteredAt) mastered++;
				if (!st || (!st.attainedAt && !st.placedAt)) continue;
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
		}
		domains.push({ id: summary.id, title: manifest.title.pt, accent: manifest.accent, icon: manifest.icon, xp: xp.xp, lessons: xp.lessons, tier, attained, mastered, leaves });
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
