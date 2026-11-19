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
import type { CurriculumSnapshot } from "../core/curriculum/types.ts";
import { activeDomainFile, curriculumDir, learnerDir } from "../core/domains/paths.ts";
import type { DomainId, DomainManifest, DomainProfile } from "../core/domains/types.ts";
import { emit } from "../core/events.ts";
import type { LearnerGraphView } from "../core/learner/graph-view.ts";
import { emptySnapshot, foldEvents } from "../core/learner/fold.ts";
import { DEFAULT_LEARNER_PARAMS } from "../core/learner/params.ts";
import { planDay } from "../core/learner/planner.ts";
import type { Evidence, Grade, LearnerEvent, LearnerSnapshot, PlanItem } from "../core/learner/types.ts";
import { learnerViewOf, nodeBrief, type StudyNodeBrief } from "../core/study/projection.ts";
import type { StudyDomainList, StudyProfile, StudyToday } from "../core/study/types.ts";
import { lessonCredit } from "../core/progress/xp.ts";
import { levelProgress } from "../core/progress/levels.ts";
import { tierStanding } from "../core/progress/tiers.ts";
import { retrievability } from "../core/learner/fsrs.ts";
import { chatsDir } from "../core/domains/paths.ts";
import type { TurnUsage } from "../core/contracts/chat.ts";
import { writeFileAtomicSync } from "../store/atomic-write.ts";
import { createDomainsStore, type DomainsStore } from "../store/domains-store.ts";
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
	__lhStudy?: { root: string; store: DomainsStore; seeded: boolean; curricula: Map<string, { mtimeMs: number; snapshot: CurriculumSnapshot; view: LearnerGraphView }> };
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

function seedFilesOf(id: DomainId): unknown[] {
	const dir = path.join(/* turbopackIgnore: true */ PATHS.root, "content", "curricula", id);
	let names: string[];
	try {
		names = fs.readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
	} catch {
		return [];
	}
	return names.map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), "utf8").replace(/^﻿/, "")) as unknown);
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
	let stat: fs.Stats | null = null;
	try {
		stat = fs.statSync(snapshotFile);
	} catch {
		stat = null;
	}
	if (stat) {
		const hit = cache.get(id);
		if (hit && hit.mtimeMs === stat.mtimeMs && goals.length === 0) return hit;
		const snapshot = JSON.parse(fs.readFileSync(snapshotFile, "utf8")) as CurriculumSnapshot;
		const entry = { mtimeMs: stat.mtimeMs, snapshot, view: learnerViewOf(snapshot, goals) };
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
	const entry = { mtimeMs: written.mtimeMs, snapshot: res.snapshot, view: learnerViewOf(res.snapshot, goals) };
	if (goals.length === 0) cache.set(id, entry);
	return entry;
}

// ─── learner log ─────────────────────────────────────────────────────────────

function eventsFile(id: DomainId): string {
	return path.join(learnerDir(PATHS.data, id), "events.jsonl");
}

function readEvents(id: DomainId): LearnerEvent[] {
	let text: string;
	try {
		text = fs.readFileSync(eventsFile(id), "utf8");
	} catch {
		return [];
	}
	const out: LearnerEvent[] = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		try {
			out.push(JSON.parse(line) as LearnerEvent);
		} catch {
			/* a torn tail line (crash mid-append) is skipped */
		}
	}
	return out;
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

type NewEvent =
	| { kind: "exposure"; nodeId: string; minutes: number }
	| { kind: "self-check"; nodeId: string; grade: Grade }
	| { kind: "known"; nodeId: string };

export function parseStudyEvent(body: unknown): NewEvent | null {
	if (typeof body !== "object" || body === null) return null;
	const b = body as Record<string, unknown>;
	if (typeof b.nodeId !== "string" || b.nodeId.length === 0 || b.nodeId.length > 600) return null;
	if (b.kind === "exposure") {
		const minutes = typeof b.minutes === "number" && Number.isFinite(b.minutes) ? Math.min(240, Math.max(1, Math.round(b.minutes))) : 20;
		return { kind: "exposure", nodeId: b.nodeId, minutes };
	}
	if (b.kind === "self-check" && (b.grade === 0 || b.grade === 1 || b.grade === 2 || b.grade === 3)) return { kind: "self-check", nodeId: b.nodeId, grade: b.grade };
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
	const events = readEvents(id);
	const seq = events.reduce((m, ev) => Math.max(m, ev.kind === "evidence" ? ev.evidence.seq : ev.seq), 0) + 1;
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
			.find((ev): ev is Extract<LearnerEvent, { kind: "exposure" }> => ev.kind === "exposure" && ev.nodeId === input.nodeId);
		const minutesSinceExposure = lastExposure ? Math.max(0, (Date.parse(at) - Date.parse(lastExposure.at)) / 60_000) : 100_000;
		const evidence: Evidence = {
			id: uid,
			seq,
			at,
			domainId: id,
			sessionId: "hoje",
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
	const file = eventsFile(id);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.appendFileSync(file, JSON.stringify(event) + "\n");
	return studyToday();
}

// ─── "Hoje" ──────────────────────────────────────────────────────────────────

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
	const events = readEvents(id);
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
	for (let i = events.length - 1; i >= 0; i--) {
		const ev = events[i] as LearnerEvent;
		if (ev.kind === "evidence" || ev.kind === "diagnostic") break;
		if (ev.kind === "exposure") {
			if (Date.parse(at) - Date.parse(ev.at) <= 3 * 86_400_000 && cur.view.nodes.has(ev.nodeId)) {
				pendingCheck = { nodeId: ev.nodeId, title: cur.view.nodes.get(ev.nodeId)?.title ?? ev.nodeId, at: ev.at };
			}
			break;
		}
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

/** Local calendar day (YYYY-MM-DD) of an instant. */
function localDay(at: string | number): string {
	const d = new Date(at);
	return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}

/**
 * XP = credited lesson minutes (progress/xp.ts lessonCredit): a lesson earns
 * XP only once rated by its self-check — passed (grade >= 2) = full credit,
 * otherwise effort credit. Minutes are the lesson's planned minutes until the
 * focus heartbeat lands (next step).
 */
function domainXp(events: readonly LearnerEvent[]): { xp: number; lessons: number; minutesByDay: Map<string, number> } {
	let xp = 0;
	let lessons = 0;
	const minutesByDay = new Map<string, number>();
	const open = new Map<string, number>();
	for (const ev of events) {
		if (ev.kind === "exposure") open.set(ev.nodeId, ev.minutes);
		else if (ev.kind === "evidence") {
			const nodeId = ev.evidence.nodes.find((n) => n.primary)?.nodeId ?? ev.evidence.nodes[0]?.nodeId;
			const planned = nodeId ? open.get(nodeId) : undefined;
			if (!nodeId || planned === undefined) continue;
			open.delete(nodeId);
			const minutes = Math.min(planned, 1440);
			const credit = lessonCredit(minutes, minutes, ev.evidence.grade >= 2);
			xp += credit.minutes * credit.multiplier;
			lessons++;
			const day = localDay(ev.evidence.at);
			minutesByDay.set(day, (minutesByDay.get(day) ?? 0) + minutes);
		}
	}
	return { xp: Math.round(xp), lessons, minutesByDay };
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

export function studyProfile(): StudyProfile {
	const store = studyDomains();
	const at = new Date().toISOString();
	const domains: StudyProfile["domains"] = [];
	const lessonMinutes = new Map<string, number>();
	let totalXp = 0;
	const listed = store.listDomains();
	for (const summary of listed) {
		const manifest = store.readManifest(summary.id);
		if (!manifest) continue;
		const cur = loadCurriculum(summary.id, manifest);
		const events = readEvents(summary.id);
		const xp = domainXp(events);
		totalXp += xp.xp;
		for (const [day, m] of xp.minutesByDay) lessonMinutes.set(day, (lessonMinutes.get(day) ?? 0) + m);
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

	const turns = chatTurns([path.join(PATHS.data, "chats"), ...listed.map((d) => chatsDir(PATHS.data, d.id))]);
	const byModel = new Map<string, { model: string; tokens: number; input: number; output: number; cached: number; turns: number }>();
	const turnTimes: number[] = [];
	for (const turn of turns) {
		const row = byModel.get(turn.model) ?? { model: turn.model, tokens: 0, input: 0, output: 0, cached: 0, turns: 0 };
		for (const step of turn.steps ?? []) {
			const input = step.inputTokens ?? 0;
			const output = step.outputTokens ?? 0;
			const cached = (step.cacheReadTokens ?? 0) + (step.cacheWriteTokens ?? 0);
			row.input += input;
			row.output += output;
			row.cached += cached;
			row.tokens += input + output + cached;
		}
		row.turns++;
		byModel.set(turn.model, row);
		const t = Date.parse(turn.at);
		if (Number.isFinite(t)) turnTimes.push(t);
	}
	let totalTokens = 0;
	for (const row of byModel.values()) totalTokens += row.tokens;

	// Active time from turn timestamps: consecutive turns <= 10 min apart count
	// their gap, every turn counts 2 min of reading. Days without chat activity
	// fall back to the rated lessons' minutes (never both: no double count).
	turnTimes.sort((a, b) => a - b);
	const chatMinutes = new Map<string, number>();
	for (let i = 0; i < turnTimes.length; i++) {
		const t = turnTimes[i] as number;
		const gap = i > 0 ? (t - (turnTimes[i - 1] as number)) / 60_000 : Infinity;
		const day = localDay(t);
		chatMinutes.set(day, (chatMinutes.get(day) ?? 0) + 2 + (gap <= 10 ? gap : 0));
	}
	const days: StudyProfile["days"] = [];
	for (let k = 13; k >= 0; k--) {
		const day = localDay(Date.now() - k * 86_400_000);
		days.push({ day, minutes: Math.round(chatMinutes.get(day) ?? lessonMinutes.get(day) ?? 0) });
	}

	const lp = levelProgress(totalXp);
	return {
		account: { level: lp.level, xp: totalXp, xpIntoLevel: Math.round(lp.xpIntoLevel), xpToNext: Math.round(lp.xpToNext), fraction: lp.fraction },
		domains,
		usage: { totalTokens, turns: turns.length, byModel: [...byModel.values()].sort((a, b) => b.tokens - a.tokens) },
		days,
	};
}
