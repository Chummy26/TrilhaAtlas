/**
 * Domain-scoped course persistence helpers shared across study.ts, course.ts,
 * and placement.ts without circular imports.
 *
 * Files under `<data>/domains/<id>/learner/`:
 *   - module-exams.jsonl  append-only module & chapter integrative exam receipts
 *   - problem-sets.jsonl  append-only gradual problem-set receipts
 *   - prep-notes.json     Record<nodeId, FlippedPrepNote>
 */

import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";
import { learnerDir } from "../core/domains/paths.ts";
import { aggregateActivity } from "../core/stats/aggregate.ts";
import { STUDY_HEARTBEAT_SEC } from "../core/stats/types.ts";
import type { FlippedPrepNote } from "../core/study/flipped-reading.ts";
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

export function readOptionalText(file: string): string | null {
	try {
		return fs.readFileSync(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

export function appendJsonlAtomic(file: string, record: unknown): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const current = readOptionalText(file) ?? "";
	const prefix = current === "" || current.endsWith("\n") ? current : `${current}\n`;
	writeFileAtomicSync(file, `${prefix}${JSON.stringify(record)}\n`, { allowInPlaceFallback: true });
}

/** Read the latest integrative exam score per targetId (moduleId or chapter level) from module-exams.jsonl. */
export function readModuleScoreMap(domainId: string): Map<string, ScoreRecord> {
	const map = new Map<string, ScoreRecord>();
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

/** Read the latest problem-set score per moduleId from problem-sets.jsonl (backward-compatible if missing). */
export function readProblemSetScoreMap(domainId: string): Map<string, ProblemSetScoreRecord> {
	const map = new Map<string, ProblemSetScoreRecord>();
	const raw = readOptionalText(problemSetsFile(domainId));
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
	return map;
}

export function readPrepNotes(domainId: string): Record<string, FlippedPrepNote> {
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

/** Read a single node's saved flipped pre-reading note, or null when none exists. */
export function readPrepNote(domainId: string, nodeId: string): FlippedPrepNote | null {
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
}

export function studyActivitySummary(domainId: string, at: string): { minutes14d: number; activeDays14d: number; totalStudiedMinutes: number } {
	const stats = createStatsStore(PATHS.data);
	const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	const endMs = Date.parse(at);
	const safeEnd = Number.isFinite(endMs) ? endMs : Date.now();
	const start = new Date(safeEnd);
	start.setDate(start.getDate() - 13);
	start.setHours(0, 0, 0, 0);
	const range14d = { from: start.toISOString(), to: new Date(safeEnd + 1).toISOString() };
	const events14d = stats.readActivity(range14d, { domain: domainId }).events;
	const daily14d = aggregateActivity(events14d, { range: range14d, timeZone, windowSec: STUDY_HEARTBEAT_SEC, domain: domainId });
	const sec14d = daily14d.reduce((sum, day) => sum + day.activeSec, 0);
	const activeDays14d = daily14d.filter((day) => day.activeSec >= 60).length;

	const allTimeRange = { from: "2020-01-01T00:00:00.000Z", to: new Date(safeEnd + 1).toISOString() };
	const allEvents = stats.readActivity(allTimeRange, { domain: domainId }).events;
	const allDaily = aggregateActivity(allEvents, { range: allTimeRange, timeZone, windowSec: STUDY_HEARTBEAT_SEC, domain: domainId });
	const totalSec = allDaily.reduce((sum, day) => sum + day.activeSec, 0);
	return {
		minutes14d: sec14d / 60,
		activeDays14d,
		totalStudiedMinutes: Math.max(sec14d, totalSec) / 60,
	};
}
