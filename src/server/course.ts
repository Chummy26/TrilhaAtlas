/**
 * Course-level study services: syllabus, academic transcript, study notebook,
 * integrative module/chapter exams with FIRe implicit credits, batch problem
 * sets + lab scripts, flipped-classroom prep guides, and domain flashcard sync.
 *
 * Domain-scoped persistence under `<data>/domains/<id>/learner/`:
 *   - module-exams.jsonl  append-only exam receipts
 *   - problem-sets.jsonl  append-only problem-set receipts
 *   - prep-notes.json     Record<nodeId, FlippedPrepNote>
 */

import fs from "node:fs";
import path from "node:path";
import { activeDomainId, PATHS } from "../../config.ts";
import sections from "../../content/resources/sections.json" with { type: "json" };
import type { CurriculumItem, CurriculumSnapshot } from "../core/curriculum/types.ts";
import { isUsableDomainId, learnerDir } from "../core/domains/paths.ts";
import { ingestEvent } from "../core/learner/fold.ts";
import type { LearnerGraphView } from "../core/learner/graph-view.ts";
import { structuralState } from "../core/learner/kst.ts";
import { DEFAULT_LEARNER_PARAMS } from "../core/learner/params.ts";
import type { LearnerEvent } from "../core/learner/types.ts";
import { booksForDomain } from "../core/resources/catalog.ts";
import { aggregateActivity } from "../core/stats/aggregate.ts";
import { STUDY_HEARTBEAT_SEC } from "../core/stats/types.ts";
import { studyCampaign } from "../core/study/campaign.ts";
import {
	buildFlippedGuide,
	formatFlippedPrepForLesson,
	type FlippedMaterialRef,
	type FlippedPrepNote,
	type FlippedReadingGuide,
} from "../core/study/flipped-reading.ts";
import {
	buildModuleExam,
	gradeModuleExam,
	type ModuleExam,
	type ModuleExamQuestion,
	type ModuleExamResult,
} from "../core/study/module-exam.ts";
import { buildDomainNotebook, type DomainNotebook } from "../core/study/notebook.ts";
import {
	buildProblemSet,
	gradeProblemSet,
	type ModuleProblemSet,
	type ProblemSetResult,
} from "../core/study/problem-set.ts";
import { nodeBrief } from "../core/study/projection.ts";
import {
	buildStudySyllabus,
	type StudySyllabus,
	type SyllabusMaterialRef,
} from "../core/study/syllabus.ts";
import { buildDomainTranscript, type DomainTranscript } from "../core/study/transcript.ts";
import { writeFileAtomicSync } from "../store/atomic-write.ts";
import { createStatsStore } from "../store/stats-store.ts";
import { englishMissionMaterials } from "./english-mission-materials.ts";
import { getPluginHost } from "./plugins.ts";
import { loadResourceSeeds } from "./resources/seeds.ts";
import { appendStudyEvent, nextStudySeq, readStudyEvents } from "./study-log.ts";
import {
	curriculumSources,
	learnerSnapshotOf,
	loadCurriculum,
	studyDomains,
	StudyError,
	studyToday,
} from "./study.ts";

export interface ModuleExamReceipt {
	at: string;
	scope: "module" | "chapter";
	targetId: string;
	score10: number;
	passed: boolean;
	weakNodeIds: string[];
}

export interface ProblemSetReceipt {
	at: string;
	moduleId: string;
	scorePct: number;
	passed: boolean;
}

export type PublicModuleExamQuestion = Omit<ModuleExamQuestion, "nodeId" | "expectedTerms">;

export interface PublicModuleExam extends Omit<ModuleExam, "questions"> {
	questions: PublicModuleExamQuestion[];
}

export interface ModuleExamDelivery {
	exam: PublicModuleExam;
	publicQuestions: PublicModuleExamQuestion[];
}

export interface ModuleExamSubmissionResult extends ModuleExamResult {
	fireCreditsCount: number;
}

export interface FlippedGuideResponse {
	guide: FlippedReadingGuide;
	note: FlippedPrepNote | null;
	formatted: string;
}

export type FlashcardExportMode = "obsidian" | "anki" | "apkg";

export interface FlashcardExportResult {
	mode: FlashcardExportMode;
	domainId: string;
	domainTitle: string;
	result: unknown;
}

interface BookSectionSeed {
	part: string;
	url: string;
	nodes?: string[];
}

const BOOK_SECTIONS: Record<string, BookSectionSeed[]> = sections;

const CURATED_VIDEOS: readonly { title: string; part: string; url: string; nodes: readonly string[] }[] = [
	{
		title: "Khan Academy Brasil",
		part: "Introdução à notação científica",
		url: "https://www.youtube.com/watch?v=JExlrIMYIRE",
		nodes: ["ee.math.algebra.sci-notation.powers-of-ten"],
	},
	{
		title: "BBC Learning English",
		part: "Improve your pronunciation · Introduction",
		url: "https://www.youtube.com/watch?v=fdRmGvmeY1U",
		nodes: ["en.pron.foundations.ipa-intro"],
	},
	{
		title: "Física III · Univesp",
		part: "Aula 19 · Circuitos elétricos e leis de Kirchhoff",
		url: "https://www.youtube.com/watch?v=ALvobeJOrr4",
		nodes: ["ee.dc.laws.kcl", "ee.dc.laws.kvl"],
	},
	{
		title: "Let’s Learn English · VOA",
		part: "Lesson 1 · Welcome!",
		url: "https://www.youtube.com/watch?v=WR9_nsLyaEY",
		nodes: ["en.speaking.a1.greetings"],
	},
];

// ─── domain & persistence helpers ────────────────────────────────────────────

function moduleExamsFile(domainId: string): string {
	return path.join(learnerDir(PATHS.data, domainId), "module-exams.jsonl");
}

function problemSetsFile(domainId: string): string {
	return path.join(learnerDir(PATHS.data, domainId), "problem-sets.jsonl");
}

function prepNotesFile(domainId: string): string {
	return path.join(learnerDir(PATHS.data, domainId), "prep-notes.json");
}

function readOptionalText(file: string): string | null {
	try {
		return fs.readFileSync(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

function appendJsonlAtomic(file: string, record: unknown): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const current = readOptionalText(file) ?? "";
	const prefix = current === "" || current.endsWith("\n") ? current : `${current}\n`;
	writeFileAtomicSync(file, `${prefix}${JSON.stringify(record)}\n`, { allowInPlaceFallback: true });
}

function readPrepNotes(domainId: string): Record<string, FlippedPrepNote> {
	const raw = readOptionalText(prepNotesFile(domainId));
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, FlippedPrepNote>;
		}
	} catch {
		// Corrupted prep-notes file falls back to empty map.
	}
	return {};
}

function writePrepNotes(domainId: string, notes: Record<string, FlippedPrepNote>): void {
	const file = prepNotesFile(domainId);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	writeFileAtomicSync(file, JSON.stringify(notes, null, "\t"), { allowInPlaceFallback: true });
}

function resolveDomain(domainId?: string) {
	const id = domainId ?? activeDomainId();
	if (!id) throw new StudyError(409, "Nenhum domínio de estudo ativo.");
	if (!isUsableDomainId(id)) throw new StudyError(400, "Domínio de estudo inválido.");
	const store = studyDomains();
	const manifest = store.readManifest(id);
	if (!manifest) throw new StudyError(404, `Domínio sem manifesto: ${id}`);
	const profile = store.readProfile(id);
	const cur = loadCurriculum(id, manifest, profile?.goal.targetNodeIds);
	if (!cur) throw new StudyError(409, "Este domínio ainda não tem currículo.");
	return { id, manifest, profile, cur };
}

// ─── offline curated materials ───────────────────────────────────────────────

function unitIdOf(snapshot: CurriculumSnapshot, nodeId: string): string | null {
	const item = snapshot.items[nodeId];
	if (!item) return null;
	let parent: CurriculumItem = item;
	let area: CurriculumItem | undefined;
	const visited = new Set<string>([item.id]);
	while (parent.parentId && parent.kind !== "unit" && !visited.has(parent.parentId)) {
		if (parent.kind === "area") area = parent;
		const next = snapshot.items[parent.parentId];
		if (!next) break;
		visited.add(next.id);
		parent = next;
	}
	return (parent.kind === "unit" ? parent : area ?? parent).id;
}

function readCuratedMaterialsByUnit(
	domainId: string,
	snapshot: CurriculumSnapshot,
	graph: LearnerGraphView,
): Map<string, { books: SyllabusMaterialRef[]; videos: SyllabusMaterialRef[] }> {
	const byUnit = new Map<string, { books: SyllabusMaterialRef[]; videos: SyllabusMaterialRef[] }>();
	const seenUrl = new Map<string, Set<string>>();

	const push = (unitId: string | null, kind: "book" | "video", ref: SyllabusMaterialRef): void => {
		if (!unitId) return;
		const seen = seenUrl.get(unitId) ?? new Set<string>();
		const key = `${kind}:${ref.url}`;
		if (seen.has(key)) return;
		seen.add(key);
		seenUrl.set(unitId, seen);
		const bucket = byUnit.get(unitId) ?? { books: [], videos: [] };
		const target = kind === "book" ? bucket.books : bucket.videos;
		if (target.length < 6) target.push(ref);
		byUnit.set(unitId, bucket);
	};

	const unitCache = new Map<string, string | null>();
	const unitFor = (nodeId: string): string | null => {
		if (unitCache.has(nodeId)) return unitCache.get(nodeId) ?? null;
		const unitId = unitIdOf(snapshot, nodeId);
		unitCache.set(nodeId, unitId);
		return unitId;
	};

	// 1. Domain-specific curated mission materials for English.
	if (domainId === "english") {
		for (const mat of englishMissionMaterials) {
			for (const nodeId of mat.nodes) {
				push(unitFor(nodeId), mat.kind, { title: mat.title, part: mat.part, url: mat.url });
			}
		}
	}

	// 2. Seeded open-book sections (local JSON only, zero network).
	try {
		const seeds = loadResourceSeeds(path.join(/* turbopackIgnore: true */ PATHS.root, "content", "resources"));
		for (const book of booksForDomain(seeds.books, domainId)) {
			for (const sec of BOOK_SECTIONS[book.key] ?? []) {
				if (!sec.nodes?.length) continue;
				for (const nodeId of sec.nodes) {
					push(unitFor(nodeId), "book", { title: book.title, part: sec.part, url: sec.url });
				}
			}
		}
	} catch {
		// Missing or malformed seed files must never break syllabus rendering.
	}

	// 3. Built-in curated videos.
	for (const video of CURATED_VIDEOS) {
		for (const nodeId of video.nodes) {
			push(unitFor(nodeId), "video", { title: video.title, part: video.part, url: video.url });
		}
	}

	// 4. Curriculum-authored source anchors.
	const sources = curriculumSources(domainId);
	for (const id of graph.ids) {
		const item = snapshot.items[id];
		if (!item?.anchors.length) continue;
		const unitId = unitFor(id);
		if (!unitId) continue;
		for (const anchor of item.anchors) {
			const source = sources.get(anchor.source);
			if (!source?.kind || !source.url || !/^https:\/\//i.test(source.url)) continue;
			if (source.kind !== "book" && source.kind !== "video") continue;
			push(unitId, source.kind, { title: source.title, part: anchor.ref, url: source.url });
		}
	}

	return byUnit;
}

function curatedMaterialsForNode(
	domainId: string,
	snapshot: CurriculumSnapshot,
	graph: LearnerGraphView,
	nodeId: string,
): FlippedMaterialRef[] {
	const direct: FlippedMaterialRef[] = [];
	const seen = new Set<string>();
	const addDirect = (mat: FlippedMaterialRef): void => {
		const key = `${mat.kind}:${mat.url}`;
		if (seen.has(key)) return;
		seen.add(key);
		direct.push(mat);
	};

	if (domainId === "english") {
		for (const mat of englishMissionMaterials) {
			if (mat.nodes.includes(nodeId)) {
				addDirect({ kind: mat.kind, title: mat.title, part: mat.part, url: mat.url });
			}
		}
	}

	try {
		const seeds = loadResourceSeeds(path.join(/* turbopackIgnore: true */ PATHS.root, "content", "resources"));
		for (const book of booksForDomain(seeds.books, domainId)) {
			for (const sec of BOOK_SECTIONS[book.key] ?? []) {
				if (sec.nodes?.includes(nodeId)) {
					addDirect({ kind: "book", title: book.title, part: sec.part, url: sec.url });
				}
			}
		}
	} catch {
		// Seed errors are non-fatal for pre-reading guides.
	}

	for (const video of CURATED_VIDEOS) {
		if (video.nodes.includes(nodeId)) {
			addDirect({ kind: "video", title: video.title, part: video.part, url: video.url });
		}
	}

	const item = snapshot.items[nodeId];
	if (item?.anchors.length) {
		const sources = curriculumSources(domainId);
		for (const anchor of item.anchors) {
			const source = sources.get(anchor.source);
			if (!source?.kind || !source.url || !/^https:\/\//i.test(source.url)) continue;
			if (source.kind !== "book" && source.kind !== "video") continue;
			addDirect({ kind: source.kind, title: source.title, part: anchor.ref, url: source.url });
		}
	}

	// Fall back to unit-level materials when the node has no direct book or video.
	const unitId = unitIdOf(snapshot, nodeId);
	if (unitId) {
		const unitMats = readCuratedMaterialsByUnit(domainId, snapshot, graph).get(unitId);
		if (unitMats) {
			for (const b of unitMats.books) addDirect({ kind: "book", ...b });
			for (const v of unitMats.videos) addDirect({ kind: "video", ...v });
		}
	}

	return direct;
}

function recentMinutes14d(domainId: string, at: string): number {
	const stats = createStatsStore(PATHS.data);
	const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const endMs = Date.parse(at);
	const start = new Date(endMs);
	start.setDate(start.getDate() - 13);
	start.setHours(0, 0, 0, 0);
	const range = { from: start.toISOString(), to: new Date(endMs + 1).toISOString() };
	const events = stats.readActivity(range, { domain: domainId }).events;
	const daily = aggregateActivity(events, { range, timeZone, windowSec: STUDY_HEARTBEAT_SEC, domain: domainId });
	const totalSec = daily.reduce((sum, day) => sum + day.activeSec, 0);
	return totalSec / 60;
}

// ─── public reads: scores, syllabus, transcript, notebook ────────────────────

/** Read the latest integrative exam score per targetId from module-exams.jsonl. */
export function readModuleScoreMap(domainId: string): Map<string, { score: number; passed: boolean; at: string }> {
	const map = new Map<string, { score: number; passed: boolean; at: string }>();
	const raw = readOptionalText(moduleExamsFile(domainId));
	if (!raw) return map;
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const rec = JSON.parse(trimmed) as Partial<ModuleExamReceipt>;
			if (
				typeof rec.targetId === "string"
				&& typeof rec.score10 === "number"
				&& Number.isFinite(rec.score10)
				&& typeof rec.passed === "boolean"
				&& typeof rec.at === "string"
			) {
				map.set(rec.targetId, { score: rec.score10, passed: rec.passed, at: rec.at });
			}
		} catch {
			// Skip malformed lines so one bad entry never blocks reads.
		}
	}
	return map;
}

/** Full domain course syllabus with observed pace, FSRS retention, exam scores, and curated materials. */
export function studySyllabus(domainId?: string): StudySyllabus {
	const { id, profile, cur } = resolveDomain(domainId);
	const at = new Date().toISOString();
	const events = readStudyEvents(id);
	const snap = learnerSnapshotOf(id, cur.view, events, at);
	const struct = structuralState(snap, cur.view);
	const campaign = studyCampaign(cur.snapshot, cur.view, struct.known);
	const materialsByUnit = readCuratedMaterialsByUnit(id, cur.snapshot, cur.view);
	const moduleScores = readModuleScoreMap(id);
	const minutes14d = recentMinutes14d(id, at);

	let focusNodeId: string | undefined;
	if (id === activeDomainId()) {
		try {
			const today = studyToday();
			focusNodeId = today.pendingCheck?.nodeId ?? today.next?.nodeId;
		} catch {
			// Focus highlight is optional.
		}
	}

	return buildStudySyllabus({
		snapshot: cur.snapshot,
		graph: cur.view,
		learner: snap,
		campaign,
		known: struct.known,
		available: new Set(struct.frontier),
		at,
		recentMinutes14d: minutes14d,
		dailyBudgetMin: profile?.dailyBudgetMin ?? 180,
		moduleScores,
		materialsByUnit,
		...(focusNodeId ? { focusNodeId } : {}),
	});
}

/** Honest academic transcript separating attained, durable, and mastered skills + cooling alerts. */
export function studyTranscript(domainId?: string): DomainTranscript {
	const { id, manifest, cur } = resolveDomain(domainId);
	const at = new Date().toISOString();
	const events = readStudyEvents(id);
	const snap = learnerSnapshotOf(id, cur.view, events, at);
	const struct = structuralState(snap, cur.view);
	const campaign = studyCampaign(cur.snapshot, cur.view, struct.known);
	const moduleScores = readModuleScoreMap(id);

	return buildDomainTranscript({
		domainId: id,
		domainTitle: manifest.title.pt,
		snapshot: cur.snapshot,
		graph: cur.view,
		learner: snap,
		campaign,
		known: struct.known,
		at,
		moduleScores,
	});
}

/** Domain study notebook grouping mistakes, misconception beliefs, and completed concept notes by module. */
export function studyNotebook(domainId?: string): DomainNotebook {
	const { id, cur } = resolveDomain(domainId);
	const at = new Date().toISOString();
	const events = readStudyEvents(id);
	const snap = learnerSnapshotOf(id, cur.view, events, at);

	return buildDomainNotebook({
		domainId: id,
		snapshot: cur.snapshot,
		graph: cur.view,
		learner: snap,
		events,
		at,
	});
}

// ─── integrative module / chapter exams ──────────────────────────────────────

function resolveExamSpec(scope: "module" | "chapter", targetId: string, seed?: string) {
	const resolved = resolveDomain();
	const syllabus = studySyllabus(resolved.id);
	let matchedTargetId = targetId;
	let targetTitle = "";
	let leafIds: string[] = [];

	if (scope === "module") {
		const mod = syllabus.chapters.flatMap((ch) => ch.modules).find((m) => m.id === targetId);
		if (!mod) throw new StudyError(404, "Módulo não encontrado na ementa.");
		matchedTargetId = mod.id;
		targetTitle = mod.title;
		leafIds = mod.lessons.map((l) => l.id);
	} else {
		const chapter = syllabus.chapters.find((ch) => ch.level === targetId || String(ch.index) === targetId);
		if (!chapter) throw new StudyError(404, "Capítulo não encontrado na ementa.");
		matchedTargetId = chapter.level;
		targetTitle = chapter.level && chapter.level !== chapter.title ? `${chapter.level} · ${chapter.title}` : chapter.title;
		leafIds = chapter.modules.flatMap((m) => m.lessons.map((l) => l.id));
	}

	if (leafIds.length === 0) throw new StudyError(400, "Nenhuma habilidade avaliável encontrada neste bloco.");

	const effectiveSeed = seed && seed.trim() ? seed.trim() : `${resolved.id}:${scope}:${matchedTargetId}:v1`;
	const exam = buildModuleExam({
		domainId: resolved.id,
		snapshot: resolved.cur.snapshot,
		graph: resolved.cur.view,
		scope,
		targetId: matchedTargetId,
		targetTitle,
		leafIds,
		seed: effectiveSeed,
	});
	return { ...resolved, exam };
}

function toPublicQuestion(q: ModuleExamQuestion): PublicModuleExamQuestion {
	return {
		id: q.id,
		prompt: q.prompt,
		rubricCriteria: [...q.rubricCriteria],
		minWords: q.minWords,
		...(q.misconceptionTrap ? { misconceptionTrap: q.misconceptionTrap } : {}),
	};
}

/** Build an interleaved integrative exam for a module or chapter without leaking grading keys. */
export function getModuleExam(scope: "module" | "chapter", targetId: string, seed?: string): ModuleExamDelivery {
	const { exam } = resolveExamSpec(scope, targetId, seed);
	const publicQuestions = exam.questions.map(toPublicQuestion);
	const publicExam: PublicModuleExam = {
		id: exam.id,
		domainId: exam.domainId,
		scope: exam.scope,
		targetId: exam.targetId,
		targetTitle: exam.targetTitle,
		seed: exam.seed,
		passingScore10: exam.passingScore10,
		questions: publicQuestions,
	};
	return { exam: publicExam, publicQuestions };
}

/** Grade a submitted module/chapter exam, persist Evidence + FIRe implicit credits, and save receipt. */
export function submitModuleExam(
	scope: "module" | "chapter",
	targetId: string,
	answers: Record<string, string>,
	seed?: string,
): ModuleExamSubmissionResult {
	const { id, cur, exam } = resolveExamSpec(scope, targetId, seed);
	const existingEvents = readStudyEvents(id);
	const at = new Date().toISOString();
	const startSeq = nextStudySeq(existingEvents);
	const { result, events: rawEvents } = gradeModuleExam(exam, answers, {
		domainId: id,
		at,
		startSeq,
		sessionId: exam.id,
	});

	let snap = learnerSnapshotOf(id, cur.view, existingEvents, at);
	let seq = Math.max(startSeq, snap.seq + 1);
	let fireCreditsCount = 0;

	for (const rawEvent of rawEvents) {
		const ev: LearnerEvent = rawEvent.kind === "evidence"
			? { kind: "evidence", evidence: { ...rawEvent.evidence, seq } }
			: ({ ...rawEvent, seq } as LearnerEvent);
		const ingested = ingestEvent(snap, ev, cur.view, DEFAULT_LEARNER_PARAMS);
		appendStudyEvent(id, ev);
		for (const derived of ingested.derived) {
			appendStudyEvent(id, derived);
			fireCreditsCount++;
		}
		snap = ingested.snapshot;
		seq = Math.max(seq + 1, snap.seq + 1);
	}

	appendJsonlAtomic(moduleExamsFile(id), {
		at,
		scope: exam.scope,
		targetId: exam.targetId,
		score10: result.score10,
		passed: result.passed,
		weakNodeIds: result.weakNodeIds,
	} satisfies ModuleExamReceipt);

	return { ...result, fireCreditsCount };
}

// ─── gradual problem sets & lab scripts ──────────────────────────────────────

function resolveProblemSetSpec(moduleId: string, seed?: string) {
	const resolved = resolveDomain();
	const syllabus = studySyllabus(resolved.id);
	const mod = syllabus.chapters.flatMap((ch) => ch.modules).find((m) => m.id === moduleId);
	if (!mod) throw new StudyError(404, "Módulo não encontrado na ementa.");
	const leafIds = mod.lessons.map((l) => l.id);
	if (leafIds.length === 0) throw new StudyError(400, "Nenhuma habilidade avaliável encontrada neste módulo.");
	const effectiveSeed = seed && seed.trim() ? seed.trim() : `${resolved.id}:${mod.id}:pset:v1`;
	const set = buildProblemSet({
		domainId: resolved.id,
		snapshot: resolved.cur.snapshot,
		graph: resolved.cur.view,
		moduleId: mod.id,
		moduleTitle: mod.title,
		leafIds,
		seed: effectiveSeed,
	});
	return { ...resolved, set };
}

/** Build a deterministic gradual problem set (plus optional 4-step lab script) for a module. */
export function getModuleProblemSet(moduleId: string, seed?: string): ModuleProblemSet {
	return resolveProblemSetSpec(moduleId, seed).set;
}

/** Grade a submitted problem set and lab notes, persist Evidence events, and save receipt. */
export function submitModuleProblemSet(
	moduleId: string,
	answers: Record<string, string>,
	labNotes?: Record<string, string>,
	seed?: string,
): ProblemSetResult {
	const { id, set } = resolveProblemSetSpec(moduleId, seed);
	const existingEvents = readStudyEvents(id);
	const at = new Date().toISOString();
	const startSeq = nextStudySeq(existingEvents);
	const { result, events: gradedEvents } = gradeProblemSet(set, answers, labNotes, {
		domainId: id,
		at,
		startSeq,
	});

	for (const ev of gradedEvents) {
		appendStudyEvent(id, ev);
	}

	appendJsonlAtomic(problemSetsFile(id), {
		at,
		moduleId: set.moduleId,
		scorePct: Math.round(result.score10 * 10),
		passed: result.passed,
	} satisfies ProblemSetReceipt);

	return result;
}

// ─── flipped-classroom pre-reading guides ────────────────────────────────────

function sanitizePrepNote(note: FlippedPrepNote): FlippedPrepNote {
	const answers: Record<string, string> = {};
	if (note.answers && typeof note.answers === "object") {
		for (const [k, v] of Object.entries(note.answers)) {
			if (typeof v === "string") {
				const trimmed = v.trim().slice(0, 1000);
				if (trimmed) answers[k] = trimmed;
			}
		}
	}
	const doubt = typeof note.doubt === "string" ? note.doubt.trim().slice(0, 600) : "";
	const completedMaterials = Array.isArray(note.completedMaterials)
		? [...new Set(note.completedMaterials.filter((m): m is "book" | "video" => m === "book" || m === "video"))]
		: [];

	return {
		...(Object.keys(answers).length > 0 ? { answers } : {}),
		...(doubt ? { doubt } : {}),
		...(completedMaterials.length > 0 ? { completedMaterials } : {}),
	};
}

/** Generate the 3-question flipped pre-reading guide for a node along with any saved prep note. */
export function getFlippedGuide(nodeId: string): FlippedGuideResponse {
	const { id, cur } = resolveDomain();
	const brief = nodeBrief(cur.snapshot, nodeId);
	if (!brief) throw new StudyError(404, `Nó desconhecido neste domínio: ${nodeId}`);
	const materials = curatedMaterialsForNode(id, cur.snapshot, cur.view, nodeId);
	const guide = buildFlippedGuide(brief, materials);
	const notes = readPrepNotes(id);
	const note = notes[nodeId] ?? null;
	const formatted = note ? formatFlippedPrepForLesson(guide, note) : "";
	return { guide, note, formatted };
}

/** Save a learner's pre-reading note for a node and return its compact tutor-opener summary. */
export function saveFlippedPrepNote(nodeId: string, note: FlippedPrepNote): { ok: true; formatted: string } {
	const { id, cur } = resolveDomain();
	const brief = nodeBrief(cur.snapshot, nodeId);
	if (!brief) throw new StudyError(404, `Nó desconhecido neste domínio: ${nodeId}`);
	const cleanNote = sanitizePrepNote(note);
	const notes = readPrepNotes(id);
	notes[nodeId] = cleanNote;
	writePrepNotes(id, notes);
	const materials = curatedMaterialsForNode(id, cur.snapshot, cur.view, nodeId);
	const guide = buildFlippedGuide(brief, materials);
	return { ok: true, formatted: formatFlippedPrepForLesson(guide, cleanNote) };
}

// ─── domain flashcards export (Obsidian / Anki / .apkg) ──────────────────────

/** Sync domain metadata to the flashcards core plugin and run Obsidian/Anki/APKG export. */
export async function exportDomainFlashcards(mode: FlashcardExportMode): Promise<FlashcardExportResult> {
	const domainId = activeDomainId();
	if (!domainId) throw new StudyError(409, "Nenhum domínio de estudo ativo.");
	const manifest = studyDomains().readManifest(domainId);
	if (!manifest) throw new StudyError(404, `Domínio sem manifesto: ${domainId}`);
	const domainTitle = manifest.title.pt.slice(0, 120);

	try {
		const host = await getPluginHost();
		await host.call("flashcards", "save-sync-settings", { domainId, domainTitle });
		let result: unknown;
		if (mode === "obsidian") {
			result = await host.call("flashcards", "export-obsidian");
		} else if (mode === "anki") {
			result = await host.call("flashcards", "export-anki", {});
		} else {
			result = await host.call("flashcards", "export-apkg");
		}
		return { mode, domainId, domainTitle, result };
	} catch (error) {
		if (error instanceof StudyError) throw error;
		const message = error instanceof Error ? error.message : String(error);
		if (/disabled|unavailable|not found|unknown plugin/i.test(message)) {
			throw new StudyError(503, "O plugin de flashcards está desativado ou indisponível no momento.");
		}
		throw new StudyError(503, message || "Não foi possível exportar os flashcards deste domínio.");
	}
}
