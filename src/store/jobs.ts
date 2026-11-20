/**
 * JobStore — the fs JSON adapter: one file per background sub-agent job in
 * data/jobs/ (contracts.ts "THE ASYNC PROTOCOL"). Keyed by toolCallId for
 * dedup: the chat-handler spawn hook never creates two jobs for the same
 * tool part. Implements core/ports.ts JobStore. Idioms: sync fs, id-guarded
 * filenames, JSON with tab indentation. Writes are small and rare (activity
 * line updates); read-modify-write sections contain no awaits. Plugin-linked
 * jobs require atomic replacement before linkage is acknowledged. Native jobs
 * retain the Windows held-file compatibility fallback (owner integration q22).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { emit } from "../core/events.ts";
import type { JobStore } from "../core/ports.ts";
import type { CreateJobInit, JobPatch } from "../core/ports.ts";
import type { JobRecord } from "../core/contracts.ts";
import { removeLeftoverTemps, writeFileAtomicSync } from "./atomic-write.ts";

/** Background jobs (<active domain>/jobs — config.ts PATHS.jobs, resolved per call). */
function jobsDir(): string {
	return PATHS.jobs;
}

function jobFile(id: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid job id: ${id}`);
	return path.join(/* turbopackIgnore: true */ jobsDir(), `${id}.json`);
}

/** Use the shared retry/cleanup law, but never truncate a plugin-linked job.
 * Metadata also makes a builtin job strict: accepted plugin linkage must stay
 * readable even when its worker is native. A malformed/missing plugin identity
 * cannot grant plugin-kind jobs permission to fall back in place. */
function writeJob(record: JobRecord): void {
	const strict = record.kind === "plugin" || record.plugin !== undefined;
	jobIndex.delete(record.id + ".json");
	writeFileAtomicSync(jobFile(record.id), JSON.stringify(record, null, "\t"), {
		allowInPlaceFallback: !strict,
		...(strict ? { mode: 0o600 } : {}),
	});
	if (strict && process.platform !== "win32") {
		const directory = fs.openSync(jobsDir(), "r");
		try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
	}
}

/** Writes announce on the events channel AFTER the write lands (the
 *  notify-after-write law, beginTurn precedent) — jobs-changed is what
 *  retires the view's interval poll (push S4, 2026-10-02): dispatch cards,
 *  progress lines, settles, and aborts all surface as one fetch. */
function createJob(init: CreateJobInit): JobRecord {
	const now = new Date().toISOString();
	const record: JobRecord = {
		id: `job_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
		kind: init.kind,
		chatId: init.chatId,
		toolCallId: init.toolCallId,
		...(init.input !== undefined ? { input: init.input } : {}),
		status: "running",
		activity: init.activity ?? "starting",
		createdAt: now,
		updatedAt: now,
		...(init.plugin ? { plugin: init.plugin } : {}),
	};
	fs.mkdirSync(jobsDir(), { recursive: true });
	writeJob(record);
	emit("jobs-changed", { chatId: init.chatId });
	return record;
}

function getJob(id: string): JobRecord | null {
	try {
		return JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ jobFile(id), "utf-8")) as JobRecord;
	} catch {
		return null;
	}
}

/** Merge a partial patch into the record (identity fields are immutable).
 *  An explicit patch.updatedAt is honored (tests pin deterministic order);
 *  otherwise the merge bumps it to now. */
function updateJob(id: string, patch: JobPatch): JobRecord | null {
	const record = getJob(id);
	if (!record) return null;
	const next: JobRecord = { ...record, ...patch, updatedAt: patch.updatedAt ?? new Date().toISOString() };
	writeJob(next);
	// EVERY write, not just status flips: progress-line updates must reach
	// the dispatch cards (the view debounces the fetch bursts). A missing id
	// wrote nothing and stays silent.
	emit("jobs-changed", { chatId: next.chatId });
	return next;
}

// Keep only routing metadata across requests. Results may contain entire PDFs,
// drawings or generated HTML. Matching records are always read fresh.
type JobIndexEntry = { stamp: string; chatId: string; unsettled: boolean };
let indexDirectory = "";
let jobIndex = new Map<string, JobIndexEntry>();

function selectJobs(matches: (entry: JobIndexEntry) => boolean): JobRecord[] {
	const directory = jobsDir();
	if (indexDirectory !== directory) {
		jobIndex.clear();
		indexDirectory = directory;
	}
	try {
		fs.mkdirSync(directory, { recursive: true });
		const next = new Map<string, JobIndexEntry>();
		const jobs: JobRecord[] = [];
		for (const name of fs.readdirSync(/* turbopackIgnore: true */ directory)) {
			if (!/^[A-Za-z0-9_-]+\.json$/.test(name)) continue;
			const file = path.join(directory, name);
			try {
				const stat = fs.statSync(/* turbopackIgnore: true */ file, { bigint: true });
				const stamp = [stat.dev, stat.ino, stat.ctimeNs, stat.mtimeNs, stat.size].join("/");
				const cached = jobIndex.get(name);
				if (cached?.stamp === stamp && !matches(cached)) {
					next.set(name, cached);
					continue;
				}
				const record = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ file, "utf8")) as JobRecord;
				const entry = { stamp, chatId: record.chatId, unsettled: record.status === "running" || record.delivery?.status === "pending" };
				next.set(name, entry);
				if (matches(entry)) jobs.push(record);
			} catch { /* Missing or unreadable files are isolated and retried on the next scan. */ }
		}
		jobIndex = next;
		return jobs;
	} catch {
		return [];
	}
}

function newestJobsFirst(jobs: JobRecord[]): JobRecord[] {
	try { return jobs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
	catch { return []; } // A malformed timestamp must not break another chat's listing.
}

/** All jobs for one chat, newest activity first. */
function listJobs(chatId: string): JobRecord[] {
	return newestJobsFirst(selectJobs(entry => entry.chatId === chatId));
}

/** One scan serves every chat in the activity feed and crash-recovery sweep. */
export function unsettledJobsByChat(): Map<string, JobRecord[]> {
	const byChat = new Map<string, JobRecord[]>();
	for (const job of selectJobs(entry => entry.unsettled)) {
		const group = byChat.get(job.chatId);
		if (group) group.push(job);
		else byChat.set(job.chatId, [job]);
	}
	for (const [id, group] of byChat) byChat.set(id, newestJobsFirst(group));
	return byChat;
}

/** The job fulfilling a given tool part, if any (spawn-hook dedup). */
function findJobByToolCallId(chatId: string, toolCallId: string): JobRecord | null {
	return listJobs(chatId).find((j) => j.toolCallId === toolCallId) ?? null;
}

/** Delete every job record file for a chat (session-deletion wave 6) —
 *  running or finished, they are the chat's records and die with it.
 *  Returns how many files were removed. The deletion route refuses while
 *  jobs are still running, so every record here is terminal. */
function deleteJobsForChat(chatId: string): number {
	let removed = 0;
	for (const job of listJobs(chatId)) {
		try {
			fs.unlinkSync(jobFile(job.id));
			removeLeftoverTemps(jobFile(job.id));
			removed++;
		} catch {
			/* already gone — the count is best-effort truth */
		}
	}
	// Only when something actually died — a zero-file delete wrote nothing
	// (the endTurn present-entry law).
	if (removed > 0) emit("jobs-changed", { chatId });
	return removed;
}

export const jobStore: JobStore = {
	createJob,
	getJob,
	updateJob,
	listJobs,
	findJobByToolCallId,
	deleteJobsForChat,
};
