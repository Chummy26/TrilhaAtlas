/**
 * Domain-scoped course persistence helpers shared across study.ts, course.ts,
 * and placement.ts without circular imports.
 *
 * Files under `<data>/domains/<id>/learner/`:
 *   - module-exams.jsonl       append-only module & chapter integrative exam receipts
 *   - problem-sets.jsonl       append-only gradual problem-set receipts
 *   - prep-notes.json          Record<nodeId, FlippedPrepNote>
 *   - notebook-notes.jsonl     saved academic notebook notes (tutor/pdf/video/manual)
 *   - notebook-artifacts.jsonl saved module deliverables / artifacts
 */

import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";
import { learnerDir } from "../core/domains/paths.ts";
import { aggregateActivity } from "../core/stats/aggregate.ts";
import { STUDY_HEARTBEAT_SEC } from "../core/stats/types.ts";
import type { FlippedPrepNote } from "../core/study/flipped-reading.ts";
import type { NotebookModuleArtifact, NotebookNoteSource, NotebookSavedNote } from "../core/study/notebook.ts";
import { writeFileAtomicSync } from "../store/atomic-write.ts";
import { createStatsStore } from "../store/stats-store.ts";

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
	score10?: number;
	passed: boolean;
}

export interface ScoreRecord {
	score: number;
	passed: boolean;
	at: string;
}

export interface ProblemSetScoreRecord extends ScoreRecord {
	scorePct: number;
}

export function moduleExamsFile(domainId: string): string {
	return path.join(learnerDir(PATHS.data, domainId), "module-exams.jsonl");
}

export function problemSetsFile(domainId: string): string {
	return path.join(learnerDir(PATHS.data, domainId), "problem-sets.jsonl");
}

export function prepNotesFile(domainId: string): string {
	return path.join(learnerDir(PATHS.data, domainId), "prep-notes.json");
}

export function notebookNotesFile(domainId: string): string {
	return path.join(learnerDir(PATHS.data, domainId), "notebook-notes.jsonl");
}

export function notebookArtifactsFile(domainId: string): string {
	return path.join(learnerDir(PATHS.data, domainId), "notebook-artifacts.jsonl");
}

export function readOptionalText(file: string): string | null {
	try {
		return fs.readFileSync(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

type CourseStoreCache = {
	moduleScores: Map<string, { stamp: string; map: Map<string, ScoreRecord> }>;
	problemSetScores: Map<string, { stamp: string; map: Map<string, ProblemSetScoreRecord> }>;
	prepNotes: Map<string, { stamp: string; notes: Record<string, FlippedPrepNote> }>;
	notebookNotes?: Map<string, { stamp: string; items: NotebookSavedNote[] }>;
	notebookArtifacts?: Map<string, { stamp: string; items: NotebookModuleArtifact[] }>;
};

const COURSE_STORE_CACHE_KEY = Symbol.for("learnharness.server.courseStore");
const MAX_COURSE_CACHE_ENTRIES = 64;

function courseStoreCache(): CourseStoreCache {
	const g = globalThis as typeof globalThis & { [COURSE_STORE_CACHE_KEY]?: CourseStoreCache };
	const cache = (g[COURSE_STORE_CACHE_KEY] ??= {
		moduleScores: new Map(),
		problemSetScores: new Map(),
		prepNotes: new Map(),
		notebookNotes: new Map(),
		notebookArtifacts: new Map(),
	});
	cache.notebookNotes ??= new Map();
	cache.notebookArtifacts ??= new Map();
	return cache;
}

function fileStatStamp(file: string): string | null {
	const stat = fs.statSync(/* turbopackIgnore: true */ file, { bigint: true, throwIfNoEntry: false });
	if (!stat || !stat.isFile()) return null;
	return `${stat.dev}|${stat.ino}|${stat.ctimeNs}|${stat.mtimeNs}|${stat.size}`;
}

function setBounded<K, V>(map: Map<K, V>, key: K, value: V): void {
	if (map.size >= MAX_COURSE_CACHE_ENTRIES && !map.has(key)) {
		const oldest = map.keys().next().value;
		if (oldest !== undefined) map.delete(oldest);
	}
	map.set(key, value);
}

export function appendJsonlAtomic(file: string, record: unknown): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const current = readOptionalText(file) ?? "";
	const prefix = current === "" || current.endsWith("\n") ? current : `${current}\n`;
	writeFileAtomicSync(file, `${prefix}${JSON.stringify(record)}\n`, { allowInPlaceFallback: true });
	const resolved = path.resolve(file);
	const cache = courseStoreCache();
	cache.moduleScores.delete(resolved);
	cache.problemSetScores.delete(resolved);
	cache.notebookNotes?.delete(resolved);
	cache.notebookArtifacts?.delete(resolved);
}

/** Read the latest integrative exam score per targetId (moduleId or chapter level) from module-exams.jsonl. */
export function readModuleScoreMap(domainId: string): Map<string, ScoreRecord> {
	const file = path.resolve(moduleExamsFile(domainId));
	const cache = courseStoreCache().moduleScores;
	const stamp = fileStatStamp(file);
	if (!stamp) {
		cache.delete(file);
		return new Map();
	}
	const cached = cache.get(file);
	if (cached && cached.stamp === stamp) return new Map(cached.map);
	const map = new Map<string, ScoreRecord>();
	const raw = readOptionalText(file);
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
	setBounded(cache, file, { stamp, map });
	return new Map(map);
}

/** Read the latest problem-set score per moduleId from problem-sets.jsonl (backward-compatible if missing). */
export function readProblemSetScoreMap(domainId: string): Map<string, ProblemSetScoreRecord> {
	const file = path.resolve(problemSetsFile(domainId));
	const cache = courseStoreCache().problemSetScores;
	const stamp = fileStatStamp(file);
	if (!stamp) {
		cache.delete(file);
		return new Map();
	}
	const cached = cache.get(file);
	if (cached && cached.stamp === stamp) return new Map(cached.map);
	const map = new Map<string, ProblemSetScoreRecord>();
	const raw = readOptionalText(file);
	if (!raw) return map;
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const rec = JSON.parse(trimmed) as Partial<ProblemSetReceipt>;
			const hasScorePct = typeof rec.scorePct === "number" && Number.isFinite(rec.scorePct);
			const hasScore10 = typeof rec.score10 === "number" && Number.isFinite(rec.score10);
			if (
				typeof rec.moduleId === "string"
				&& (hasScorePct || hasScore10)
				&& typeof rec.passed === "boolean"
				&& typeof rec.at === "string"
			) {
				const score10 = hasScore10
					? Math.round(rec.score10! * 10) / 10
					: Math.round(rec.scorePct!) / 10;
				const scorePct = hasScorePct
					? Math.round(rec.scorePct!)
					: Math.round(score10 * 10);
				map.set(rec.moduleId, {
					score: score10,
					scorePct,
					passed: rec.passed,
					at: rec.at,
				});
			}
		} catch {
			// Skip malformed lines so one bad entry never blocks reads.
		}
	}
	setBounded(cache, file, { stamp, map });
	return new Map(map);
}

export function readPrepNotes(domainId: string): Record<string, FlippedPrepNote> {
	const file = path.resolve(prepNotesFile(domainId));
	const cache = courseStoreCache().prepNotes;
	const stamp = fileStatStamp(file);
	if (!stamp) {
		cache.delete(file);
		return {};
	}
	const cached = cache.get(file);
	if (cached && cached.stamp === stamp) return structuredClone(cached.notes);
	const raw = readOptionalText(file);
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			const notes = parsed as Record<string, FlippedPrepNote>;
			setBounded(cache, file, { stamp, notes });
			return structuredClone(notes);
		}
	} catch {
		// Corrupted prep-notes file falls back to empty map.
	}
	return {};
}

/** Read a single node's saved flipped pre-reading note, or null when none exists. */
export function readPrepNote(domainId: string, nodeId: string): FlippedPrepNote | null {
	const file = path.resolve(prepNotesFile(domainId));
	const cache = courseStoreCache().prepNotes;
	const stamp = fileStatStamp(file);
	if (!stamp) {
		cache.delete(file);
		return null;
	}
	const cached = cache.get(file);
	if (cached && cached.stamp === stamp) {
		const note = cached.notes[nodeId];
		return note ? structuredClone(note) : null;
	}
	const notes = readPrepNotes(domainId);
	return notes[nodeId] ?? null;
}

/** True when a saved pre-reading note contains at least one answer, doubt, or checked material. */
export function hasSavedPrepNote(note: FlippedPrepNote | null): boolean {
	if (!note) return false;
	const hasAnswer = Boolean(note.answers && Object.values(note.answers).some((v) => typeof v === "string" && v.trim().length > 0));
	const hasDoubt = Boolean(typeof note.doubt === "string" && note.doubt.trim().length > 0);
	const hasMaterials = Boolean(note.completedMaterials && note.completedMaterials.length > 0);
	return hasAnswer || hasDoubt || hasMaterials;
}

export function writePrepNotes(domainId: string, notes: Record<string, FlippedPrepNote>): void {
	const file = prepNotesFile(domainId);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	writeFileAtomicSync(file, JSON.stringify(notes, null, "\t"), { allowInPlaceFallback: true });
	courseStoreCache().prepNotes.delete(path.resolve(file));
}

const VALID_NOTE_SOURCES: ReadonlySet<string> = new Set<NotebookNoteSource>(["tutor", "pdf", "video", "manual"]);

/** Read all saved notebook notes for a domain from notebook-notes.jsonl. */
export function readNotebookNotes(domainId: string): NotebookSavedNote[] {
	const file = path.resolve(notebookNotesFile(domainId));
	const cache = courseStoreCache().notebookNotes!;
	const stamp = fileStatStamp(file);
	if (!stamp) {
		cache.delete(file);
		return [];
	}
	const cached = cache.get(file);
	if (cached && cached.stamp === stamp) return structuredClone(cached.items);
	const raw = readOptionalText(file);
	if (!raw) return [];

	const byId = new Map<string, NotebookSavedNote>();
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const rec = JSON.parse(trimmed) as Partial<NotebookSavedNote>;
			if (
				typeof rec.id === "string"
				&& typeof rec.domainId === "string"
				&& typeof rec.moduleId === "string"
				&& typeof rec.source === "string"
				&& VALID_NOTE_SOURCES.has(rec.source)
				&& typeof rec.excerpt === "string"
				&& typeof rec.createdAt === "string"
			) {
				byId.set(rec.id, {
					id: rec.id,
					domainId: rec.domainId,
					moduleId: rec.moduleId,
					...(typeof rec.nodeId === "string" ? { nodeId: rec.nodeId } : {}),
					...(typeof rec.nodeTitle === "string" ? { nodeTitle: rec.nodeTitle } : {}),
					source: rec.source as NotebookNoteSource,
					excerpt: rec.excerpt,
					...(typeof rec.comment === "string" ? { comment: rec.comment } : {}),
					...(typeof rec.locator === "string" ? { locator: rec.locator } : {}),
					...(typeof rec.sourceUrl === "string" ? { sourceUrl: rec.sourceUrl } : {}),
					...(typeof rec.sourceTitle === "string" ? { sourceTitle: rec.sourceTitle } : {}),
					createdAt: rec.createdAt,
				});
			}
		} catch {
			// Skip malformed lines so one corrupted entry never blocks reads.
		}
	}
	const items = [...byId.values()];
	setBounded(cache, file, { stamp, items });
	return structuredClone(items);
}

/** Append a saved notebook note atomically to notebook-notes.jsonl. */
export function appendNotebookNote(domainId: string, note: NotebookSavedNote): void {
	appendJsonlAtomic(notebookNotesFile(domainId), note);
}

/** Atomically delete a saved notebook note by ID. Returns true when an entry was removed. */
export function deleteNotebookNote(domainId: string, noteId: string): boolean {
	const existing = readNotebookNotes(domainId);
	const remaining = existing.filter((item) => item.id !== noteId);
	if (remaining.length === existing.length) return false;
	const file = notebookNotesFile(domainId);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const body = remaining.length > 0 ? `${remaining.map((item) => JSON.stringify(item)).join("\n")}\n` : "";
	writeFileAtomicSync(file, body, { allowInPlaceFallback: true });
	courseStoreCache().notebookNotes!.delete(path.resolve(file));
	return true;
}

/** Read all saved module deliverables / artifacts for a domain from notebook-artifacts.jsonl. */
export function readModuleArtifacts(domainId: string): NotebookModuleArtifact[] {
	const file = path.resolve(notebookArtifactsFile(domainId));
	const cache = courseStoreCache().notebookArtifacts!;
	const stamp = fileStatStamp(file);
	if (!stamp) {
		cache.delete(file);
		return [];
	}
	const cached = cache.get(file);
	if (cached && cached.stamp === stamp) return structuredClone(cached.items);
	const raw = readOptionalText(file);
	if (!raw) return [];

	const byId = new Map<string, NotebookModuleArtifact>();
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const rec = JSON.parse(trimmed) as Partial<NotebookModuleArtifact>;
			if (
				typeof rec.id === "string"
				&& typeof rec.domainId === "string"
				&& typeof rec.moduleId === "string"
				&& typeof rec.title === "string"
				&& typeof rec.content === "string"
				&& typeof rec.createdAt === "string"
				&& typeof rec.updatedAt === "string"
			) {
				byId.set(rec.id, {
					id: rec.id,
					domainId: rec.domainId,
					moduleId: rec.moduleId,
					title: rec.title,
					summary: typeof rec.summary === "string" ? rec.summary : "",
					content: rec.content,
					...(typeof rec.nodeId === "string" ? { nodeId: rec.nodeId } : {}),
					createdAt: rec.createdAt,
					updatedAt: rec.updatedAt,
				});
			}
		} catch {
			// Skip malformed lines so one corrupted entry never blocks reads.
		}
	}
	const items = [...byId.values()];
	setBounded(cache, file, { stamp, items });
	return structuredClone(items);
}

/** Append a saved module artifact atomically to notebook-artifacts.jsonl. */
export function appendModuleArtifact(domainId: string, artifact: NotebookModuleArtifact): void {
	appendJsonlAtomic(notebookArtifactsFile(domainId), artifact);
}

/** Atomically delete a saved module artifact by ID. Returns true when an entry was removed. */
export function deleteModuleArtifact(domainId: string, artifactId: string): boolean {
	const existing = readModuleArtifacts(domainId);
	const remaining = existing.filter((item) => item.id !== artifactId);
	if (remaining.length === existing.length) return false;
	const file = notebookArtifactsFile(domainId);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const body = remaining.length > 0 ? `${remaining.map((item) => JSON.stringify(item)).join("\n")}\n` : "";
	writeFileAtomicSync(file, body, { allowInPlaceFallback: true });
	courseStoreCache().notebookArtifacts!.delete(path.resolve(file));
	return true;
}

export function studyActivitySummary(domainId: string, at: string): { minutes14d: number; activeDays14d: number; totalStudiedMinutes: number } {
	const stats = createStatsStore(PATHS.data);
	const months = stats.listMonths("activity");
	if (months.length === 0) {
		return { minutes14d: 0, activeDays14d: 0, totalStudiedMinutes: 0 };
	}
	const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	const endMs = Date.parse(at);
	const safeEnd = Number.isFinite(endMs) ? endMs : Date.now();
	const toIso = new Date(safeEnd + 1).toISOString();
	const start = new Date(safeEnd);
	start.setDate(start.getDate() - 13);
	start.setHours(0, 0, 0, 0);
	const startMs = start.getTime();
	const range14d = { from: start.toISOString(), to: toIso };
	const earliestFrom = `${months[0]}-01T00:00:00.000Z`;
	const allFromMs = Math.min(Date.parse(earliestFrom), startMs);
	const allTimeRange = { from: new Date(allFromMs).toISOString(), to: toIso };

	// Single read pass over existing activity months computes both 14d and all-time totals.
	const allEvents = stats.readActivity(allTimeRange, { domain: domainId }).events;
	if (allEvents.length === 0) {
		return { minutes14d: 0, activeDays14d: 0, totalStudiedMinutes: 0 };
	}
	const events14d = allEvents.filter((event) => Date.parse(event.at) >= startMs);
	const daily14d = events14d.length > 0
		? aggregateActivity(events14d, { range: range14d, timeZone, windowSec: STUDY_HEARTBEAT_SEC, domain: domainId })
		: [];
	const sec14d = daily14d.reduce((sum, day) => sum + day.activeSec, 0);
	const activeDays14d = daily14d.filter((day) => day.activeSec >= 60).length;

	const allDaily = aggregateActivity(allEvents, { range: allTimeRange, timeZone, windowSec: STUDY_HEARTBEAT_SEC, domain: domainId });
	const totalSec = allDaily.reduce((sum, day) => sum + day.activeSec, 0);
	return {
		minutes14d: sec14d / 60,
		activeDays14d,
		totalStudiedMinutes: Math.max(sec14d, totalSec) / 60,
	};
}
