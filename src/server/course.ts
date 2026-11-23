/**
 * Course-level study services: syllabus, academic transcript, study notebook,
 * integrative module/chapter exams with FIRe implicit credits, batch problem
 * sets + lab scripts, flipped-classroom prep guides, and domain flashcard sync.
 *
 * Domain-scoped persistence under `<data>/domains/<id>/learner/`:
 *   - module-exams.jsonl       append-only exam receipts
 *   - problem-sets.jsonl       append-only problem-set receipts
 *   - prep-notes.json          Record<nodeId, FlippedPrepNote>
 *   - notebook-notes.jsonl     saved academic notebook notes
 *   - notebook-artifacts.jsonl saved module deliverables / artifacts
 */

import crypto from "node:crypto";
import path from "node:path";
import { activeDomainId, PATHS } from "../../config.ts";
import sections from "../../content/resources/sections.json" with { type: "json" };
import type { CurriculumItem, CurriculumSnapshot } from "../core/curriculum/types.ts";
import { isUsableDomainId } from "../core/domains/paths.ts";
import { emit } from "../core/events.ts";
import { ingestEvent } from "../core/learner/fold.ts";
import type { LearnerGraphView } from "../core/learner/graph-view.ts";
import { structuralState } from "../core/learner/kst.ts";
import { DEFAULT_LEARNER_PARAMS } from "../core/learner/params.ts";
import type { LearnerEvent } from "../core/learner/types.ts";
import { booksForDomain } from "../core/resources/catalog.ts";
import { chapterUnitsOf, studyCampaign } from "../core/study/campaign.ts";
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
import {
	buildDomainNotebook,
	sanitizeModuleArtifactInput,
	sanitizeSavedNoteInput,
	type DomainNotebook,
	type NotebookModuleArtifact,
	type NotebookSavedNote,
} from "../core/study/notebook.ts";
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
import {
	appendJsonlAtomic,
	appendModuleArtifact,
	appendNotebookNote,
	deleteModuleArtifact,
	deleteNotebookNote,
	hasSavedPrepNote,
	moduleExamsFile,
	problemSetsFile,
	readModuleArtifacts,
	readModuleScoreMap,
	readNotebookNotes,
	readPrepNote,
	readPrepNotes,
	readProblemSetScoreMap,
	studyActivitySummary,
	writePrepNotes,
	type ModuleExamReceipt,
	type ProblemSetReceipt,
} from "./course-store.ts";
import { englishMissionMaterials } from "./english-mission-materials.ts";
import { getPluginHost } from "./plugins.ts";
import { readManualMaterials } from "./resources/manual-materials.ts";
import { loadResourceSeeds } from "./resources/seeds.ts";
import { appendStudyEvent, nextStudySeq } from "./study-log.ts";
import {
	computeTodayPlan,
	curriculumSources,
	loadCurriculum,
	readLearnerHistory,
	studyDomains,
	StudyError,
} from "./study.ts";

export { readModuleScoreMap, readProblemSetScoreMap, readPrepNote, type ModuleExamReceipt, type ProblemSetReceipt };

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

export interface ProblemSetSubmissionResult extends ProblemSetResult {
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

// ─── domain resolution ───────────────────────────────────────────────────────

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

	// 0. User-curated manual node/section materials take highest priority.
	for (const entry of readManualMaterials(domainId)) {
		const targetUnits = new Set<string>();
		for (const nodeId of entry.nodes) {
			const unitId = unitFor(nodeId);
			if (unitId) targetUnits.add(unitId);
		}
		if (!targetUnits.size && entry.regionId) targetUnits.add(entry.regionId);
		for (const unitId of targetUnits) {
			push(unitId, entry.kind, { title: entry.title, part: entry.part, url: entry.url });
		}
	}

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

	const manualEntries = readManualMaterials(domainId);
	for (const entry of manualEntries) {
		if (entry.nodes.includes(nodeId)) {
			addDirect({ kind: entry.kind, title: entry.title, part: entry.part, url: entry.url });
		}
	}

	if (domainId === "english") {
		for (const mat of englishMissionMaterials) {
			if (mat.nodes.includes(nodeId)) {
				addDirect({ kind: mat.kind, title: mat.title, part: mat.part, url: mat.url });
			}
		}
	}

	let domainBooks: ReturnType<typeof booksForDomain> | undefined;
	const getDomainBooks = () => {
		if (domainBooks) return domainBooks;
		try {
			const seeds = loadResourceSeeds(path.join(/* turbopackIgnore: true */ PATHS.root, "content", "resources"));
			domainBooks = booksForDomain(seeds.books, domainId);
		} catch {
			domainBooks = [];
		}
		return domainBooks;
	};

	for (const book of getDomainBooks()) {
		for (const sec of BOOK_SECTIONS[book.key] ?? []) {
			if (sec.nodes?.includes(nodeId)) {
				addDirect({ kind: "book", title: book.title, part: sec.part, url: sec.url });
			}
		}
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

	// Fall back to unit-level materials ONLY when the node has no direct book or video,
	// scanning only members of this unit instead of all curriculum items.
	const hasBook = direct.some((m) => m.kind === "book");
	const hasVideo = direct.some((m) => m.kind === "video");
	if (!hasBook || !hasVideo) {
		const unitId = unitIdOf(snapshot, nodeId);
		if (unitId) {
			const unitNodes = new Set<string>();
			const stack = [unitId];
			while (stack.length > 0) {
				const curr = stack.pop()!;
				if (unitNodes.has(curr)) continue;
				unitNodes.add(curr);
				const children = graph.nodes.get(curr)?.children;
				if (children) {
					for (const child of children) stack.push(child);
				}
			}
			const wantBook = !hasBook;
			const wantVideo = !hasVideo;
			const wantKind = (kind: "book" | "video") => (kind === "book" ? wantBook : wantVideo);

			for (const entry of manualEntries) {
				if (!wantKind(entry.kind)) continue;
				if (entry.regionId === unitId || entry.nodes.some((n) => unitNodes.has(n))) {
					addDirect({ kind: entry.kind, title: entry.title, part: entry.part, url: entry.url });
				}
			}
			if (domainId === "english") {
				for (const mat of englishMissionMaterials) {
					if (!wantKind(mat.kind)) continue;
					if (mat.nodes.some((n) => unitNodes.has(n))) {
						addDirect({ kind: mat.kind, title: mat.title, part: mat.part, url: mat.url });
					}
				}
			}
			if (wantBook) {
				for (const book of getDomainBooks()) {
					for (const sec of BOOK_SECTIONS[book.key] ?? []) {
						if (sec.nodes?.some((n) => unitNodes.has(n))) {
							addDirect({ kind: "book", title: book.title, part: sec.part, url: sec.url });
						}
					}
				}
			}
			if (wantVideo) {
				for (const video of CURATED_VIDEOS) {
					if (video.nodes.some((n) => unitNodes.has(n))) {
						addDirect({ kind: "video", title: video.title, part: video.part, url: video.url });
					}
				}
			}
			const sources = curriculumSources(domainId);
			for (const memberId of unitNodes) {
				const member = snapshot.items[memberId];
				if (!member?.anchors.length) continue;
				for (const anchor of member.anchors) {
					const source = sources.get(anchor.source);
					if (!source?.kind || !source.url || !/^https:\/\//i.test(source.url)) continue;
					if (source.kind !== "book" && source.kind !== "video") continue;
					if (!wantKind(source.kind)) continue;
					addDirect({ kind: source.kind, title: source.title, part: anchor.ref, url: source.url });
				}
			}
		}
	}

	return direct;
}

// ─── public reads: syllabus, transcript, notebook ────────────────────────────

function buildSyllabusAndState(domainId?: string) {
	const { id, manifest, profile, cur } = resolveDomain(domainId);
	const at = new Date().toISOString();
	let events: LearnerEvent[];
	let snap: ReturnType<typeof readLearnerHistory>["snap"];
	let known: ReadonlySet<string>;
	let available: ReadonlySet<string>;
	let campaign: ReturnType<typeof studyCampaign>;
	let focusNodeId: string | undefined;

	if (id === activeDomainId()) {
		const todayPlan = computeTodayPlan({ id, manifest, profile, cur, at, runReinforcementQueue: false });
		events = todayPlan.events;
		snap = todayPlan.snap;
		known = todayPlan.known;
		available = todayPlan.available;
		campaign = todayPlan.campaign;
		focusNodeId = todayPlan.focusNodeId;
	} else {
		const history = readLearnerHistory(id, cur.snapshot, cur.view, at);
		events = history.events;
		snap = history.snap;
		const struct = structuralState(snap, cur.view);
		known = struct.known;
		available = new Set(struct.frontier);
		campaign = studyCampaign(cur.snapshot, cur.view, known);
	}

	const materialsByUnit = readCuratedMaterialsByUnit(id, cur.snapshot, cur.view);
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
		dailyBudgetMin: profile?.dailyBudgetMin ?? 180,
		moduleScores,
		problemSetScores,
		materialsByUnit,
		...(focusNodeId ? { focusNodeId } : {}),
	});

	return { id, manifest, cur, events, snap, at, syllabus, materialsByUnit };
}

/** Full domain course syllabus with observed pace, FSRS retention, exam & problem-set scores, and curated materials. */
export function studySyllabus(domainId?: string): StudySyllabus {
	return buildSyllabusAndState(domainId).syllabus;
}

/** Combined SSR loader for /ementa: resolves domain, learner history, syllabus and notebook in one pass. */
export function studyCoursePageData(domainId?: string): {
	domainId: string;
	domainTitle: string;
	syllabus: StudySyllabus;
	notebook: DomainNotebook;
} {
	const { id, manifest, cur, events, snap, at, syllabus, materialsByUnit } = buildSyllabusAndState(domainId);
	const notebook = buildDomainNotebook({
		domainId: id,
		snapshot: cur.snapshot,
		graph: cur.view,
		learner: snap,
		events,
		at,
		savedNotes: readNotebookNotes(id),
		artifacts: readModuleArtifacts(id),
		materialsByUnit,
	});
	return {
		domainId: id,
		domainTitle: manifest.title.pt,
		syllabus,
		notebook,
	};
}

/** Honest academic transcript separating attained, durable, and mastered skills + cooling alerts. */
export function studyTranscript(domainId?: string): DomainTranscript {
	const { id, manifest, cur } = resolveDomain(domainId);
	const at = new Date().toISOString();
	const { snap } = readLearnerHistory(id, cur.snapshot, cur.view, at);
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

/** Domain study notebook grouping mistakes, misconception beliefs, completed concept notes, saved notes, job aids, and module artifacts. */
export function studyNotebook(domainId?: string): DomainNotebook {
	const { id, cur } = resolveDomain(domainId);
	const at = new Date().toISOString();
	const { events, snap } = readLearnerHistory(id, cur.snapshot, cur.view, at);
	const savedNotes = readNotebookNotes(id);
	const artifacts = readModuleArtifacts(id);
	const materialsByUnit = readCuratedMaterialsByUnit(id, cur.snapshot, cur.view);

	return buildDomainNotebook({
		domainId: id,
		snapshot: cur.snapshot,
		graph: cur.view,
		learner: snap,
		events,
		at,
		savedNotes,
		artifacts,
		materialsByUnit,
	});
}

function firstCurriculumUnitId(snapshot: CurriculumSnapshot, graph: LearnerGraphView): string {
	for (const id of graph.ids) {
		if (!graph.nodes.get(id)?.isLeaf) continue;
		const unitId = unitIdOf(snapshot, id);
		if (unitId) return unitId;
	}
	for (const item of Object.values(snapshot.items)) {
		if (item.kind === "unit") return item.id;
	}
	return "general";
}

function resolveNotebookModuleId(
	snapshot: CurriculumSnapshot,
	graph: LearnerGraphView,
	moduleId?: string,
	nodeId?: string,
): string {
	if (moduleId) {
		if (snapshot.items[moduleId]) {
			return unitIdOf(snapshot, moduleId) ?? moduleId;
		}
		return moduleId;
	}
	if (nodeId) {
		const fromNode = unitIdOf(snapshot, nodeId);
		if (fromNode) return fromNode;
	}
	return firstCurriculumUnitId(snapshot, graph);
}

/** Save a quick note or 1-click excerpt (from tutor, PDF reader, video, or manual entry) into the domain notebook. */
export async function saveStudyNotebookNote(input: unknown, domainId?: string): Promise<NotebookSavedNote> {
	const sanitized = sanitizeSavedNoteInput(input);
	if (!sanitized.ok) throw new StudyError(400, sanitized.error);
	const { id, cur } = resolveDomain(domainId);
	const val = sanitized.value;
	const resolvedModuleId = resolveNotebookModuleId(cur.snapshot, cur.view, val.moduleId, val.nodeId);
	const nodeTitle = val.nodeId
		? (cur.view.nodes.get(val.nodeId)?.title ?? cur.snapshot.items[val.nodeId]?.title.pt)
		: undefined;
	const note: NotebookSavedNote = {
		id: `note_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
		domainId: id,
		moduleId: resolvedModuleId,
		...(val.nodeId ? { nodeId: val.nodeId } : {}),
		...(nodeTitle ? { nodeTitle } : {}),
		source: val.source,
		excerpt: val.excerpt,
		...(val.comment ? { comment: val.comment } : {}),
		...(val.locator ? { locator: val.locator } : {}),
		...(val.sourceUrl ? { sourceUrl: val.sourceUrl } : {}),
		...(val.sourceTitle ? { sourceTitle: val.sourceTitle } : {}),
		createdAt: new Date().toISOString(),
	};
	appendNotebookNote(id, note);
	emit("curriculum-expanded", { domainId: id, nodeId: note.nodeId ?? note.moduleId });
	return note;
}

/** Delete a saved notebook note by ID. */
export async function deleteStudyNotebookNote(noteId: string, domainId?: string): Promise<{ deleted: boolean }> {
	const trimmed = typeof noteId === "string" ? noteId.trim() : "";
	if (!trimmed) throw new StudyError(400, "Identificador da anotação ausente.");
	const { id } = resolveDomain(domainId);
	const deleted = deleteNotebookNote(id, trimmed);
	if (deleted) emit("curriculum-expanded", { domainId: id, nodeId: trimmed });
	return { deleted };
}

/** Save a learner deliverable / artifact under a module in the domain notebook. */
export async function saveStudyModuleArtifact(input: unknown, domainId?: string): Promise<NotebookModuleArtifact> {
	const sanitized = sanitizeModuleArtifactInput(input);
	if (!sanitized.ok) throw new StudyError(400, sanitized.error);
	const { id, cur } = resolveDomain(domainId);
	const val = sanitized.value;
	const resolvedModuleId = resolveNotebookModuleId(cur.snapshot, cur.view, val.moduleId, val.nodeId);
	const now = new Date().toISOString();
	const artifact: NotebookModuleArtifact = {
		id: `artifact_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
		domainId: id,
		moduleId: resolvedModuleId,
		title: val.title,
		summary: val.summary,
		content: val.content,
		...(val.nodeId ? { nodeId: val.nodeId } : {}),
		createdAt: now,
		updatedAt: now,
	};
	appendModuleArtifact(id, artifact);
	emit("curriculum-expanded", { domainId: id, nodeId: artifact.nodeId ?? artifact.moduleId });
	return artifact;
}

/** Delete a saved module artifact by ID. */
export async function deleteStudyModuleArtifact(artifactId: string, domainId?: string): Promise<{ deleted: boolean }> {
	const trimmed = typeof artifactId === "string" ? artifactId.trim() : "";
	if (!trimmed) throw new StudyError(400, "Identificador do artefato ausente.");
	const { id } = resolveDomain(domainId);
	const deleted = deleteModuleArtifact(id, trimmed);
	if (deleted) emit("curriculum-expanded", { domainId: id, nodeId: trimmed });
	return { deleted };
}

// ─── integrative module / chapter exams ──────────────────────────────────────

function resolveExamSpec(scope: "module" | "chapter", targetId: string, seed?: string) {
	const resolved = resolveDomain();
	const at = new Date().toISOString();
	const { events, snap } = readLearnerHistory(resolved.id, resolved.cur.snapshot, resolved.cur.view, at);
	const known = structuralState(snap, resolved.cur.view).known;
	const campaign = studyCampaign(resolved.cur.snapshot, resolved.cur.view, known);
	const structure = chapterUnitsOf(resolved.cur.snapshot, resolved.cur.view, campaign);

	let matchedTargetId = targetId;
	let targetTitle = "";
	let leafIds: string[] = [];

	if (scope === "module") {
		const mod = structure.flatMap((cu) => cu.modules).find((m) => m.id === targetId);
		if (!mod) throw new StudyError(404, "Módulo não encontrado na ementa.");
		matchedTargetId = mod.id;
		targetTitle = mod.title;
		leafIds = mod.leafIds;
	} else {
		const cu = structure.find((entry) => entry.chapter.level === targetId || String(entry.chapterIndex) === targetId);
		if (!cu) throw new StudyError(404, "Capítulo não encontrado na ementa.");
		matchedTargetId = cu.chapter.level;
		targetTitle = cu.chapter.level && cu.chapter.level !== cu.chapter.title
			? `${cu.chapter.level} · ${cu.chapter.title}`
			: cu.chapter.title;
		leafIds = cu.modules.flatMap((m) => m.leafIds);
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
	return { ...resolved, exam, events, snap, at };
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
	const { id, cur, exam, events: existingEvents, snap: initialSnap, at } = resolveExamSpec(scope, targetId, seed);
	const startSeq = nextStudySeq(existingEvents);
	const { result, events: rawEvents } = gradeModuleExam(exam, answers, {
		domainId: id,
		at,
		startSeq,
		sessionId: exam.id,
	});

	let snap = initialSnap;
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

	emit("curriculum-expanded", { domainId: id, nodeId: exam.targetId });
	return { ...result, fireCreditsCount };
}

// ─── gradual problem sets & lab scripts ──────────────────────────────────────

function resolveProblemSetSpec(moduleId: string, seed?: string) {
	const resolved = resolveDomain();
	const at = new Date().toISOString();
	const { events, snap } = readLearnerHistory(resolved.id, resolved.cur.snapshot, resolved.cur.view, at);
	const known = structuralState(snap, resolved.cur.view).known;
	const campaign = studyCampaign(resolved.cur.snapshot, resolved.cur.view, known);
	const structure = chapterUnitsOf(resolved.cur.snapshot, resolved.cur.view, campaign);
	const mod = structure.flatMap((cu) => cu.modules).find((m) => m.id === moduleId);
	if (!mod) throw new StudyError(404, "Módulo não encontrado na ementa.");
	const leafIds = mod.leafIds;
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
	return { ...resolved, set, events, snap, at };
}

/** Build a deterministic gradual problem set (plus optional 4-step lab script) for a module. */
export function getModuleProblemSet(moduleId: string, seed?: string): ModuleProblemSet {
	return resolveProblemSetSpec(moduleId, seed).set;
}

/** Grade a submitted problem set and lab notes, persist Evidence + FIRe implicit credits, and save receipt. */
export function submitModuleProblemSet(
	moduleId: string,
	answers: Record<string, string>,
	labNotes?: Record<string, string>,
	seed?: string,
): ProblemSetSubmissionResult {
	const { id, cur, set, events: existingEvents, snap: initialSnap, at } = resolveProblemSetSpec(moduleId, seed);
	const startSeq = nextStudySeq(existingEvents);
	const { result, events: gradedEvents } = gradeProblemSet(set, answers, labNotes, {
		domainId: id,
		at,
		startSeq,
	});

	let snap = initialSnap;
	let seq = Math.max(startSeq, snap.seq + 1);
	let fireCreditsCount = 0;

	for (const rawEvent of gradedEvents) {
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

	appendJsonlAtomic(problemSetsFile(id), {
		at,
		moduleId: set.moduleId,
		scorePct: Math.round(result.score10 * 10),
		score10: result.score10,
		passed: result.passed,
	} satisfies ProblemSetReceipt);

	emit("curriculum-expanded", { domainId: id, nodeId: set.moduleId });
	return { ...result, fireCreditsCount };
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

/** Format any saved flipped pre-reading note for a node so POST /api/chats can auto-attach it. */
export function readFormattedPrepNote(domainId: string, nodeId: string): string {
	const note = readPrepNote(domainId, nodeId);
	if (!hasSavedPrepNote(note)) return "";
	try {
		const { id, cur } = resolveDomain(domainId);
		const brief = nodeBrief(cur.snapshot, nodeId);
		if (!brief) return "";
		const materials = curatedMaterialsForNode(id, cur.snapshot, cur.view, nodeId);
		const guide = buildFlippedGuide(brief, materials);
		return formatFlippedPrepForLesson(guide, note!);
	} catch {
		return "";
	}
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
