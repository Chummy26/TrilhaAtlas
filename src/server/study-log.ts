import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";
import { chatsDir, learnerDir } from "../core/domains/paths.ts";
import type { LearnerEvent } from "../core/learner/types.ts";
import { writeFileAtomicSync } from "../store/atomic-write.ts";

function eventRecord(event: LearnerEvent) {
	return event.kind === "evidence" ? event.evidence : event;
}

export function nextStudySeq(events: readonly LearnerEvent[]): number {
	return events.reduce((max, ev) => Math.max(max, eventRecord(ev).seq), 0) + 1;
}

function readOptional(file: string): string | undefined {
	try {
		return fs.readFileSync(file, "utf8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
	}
}

function logPath(id: string) {
	return path.join(learnerDir(PATHS.data, id), "events.jsonl");
}

function pendingPath(id: string) {
	return path.join(learnerDir(PATHS.data, id), "pending-chat-event.json");
}

/** A pending intent needs reconciliation even when the event log itself has not changed. */
export function studyLogRevision(id: string): string | undefined {
	if (fs.statSync(pendingPath(id), { throwIfNoEntry: false })) return undefined;
	const file = logPath(id);
	const stat = fs.statSync(file, { bigint: true, throwIfNoEntry: false });
	return stat ? [file, stat.dev, stat.ino, stat.ctimeNs, stat.mtimeNs, stat.size].join("|") : file;
}

export function appendStudyEvent(id: string, event: LearnerEvent) {
	fs.mkdirSync(learnerDir(PATHS.data, id), { recursive: true });
	fs.appendFileSync(logPath(id), JSON.stringify(event) + "\n");
}

interface PendingChatEvent {
	chatId: string;
	messageId: string;
	event: LearnerEvent;
}

/** All learner writes drain the previous intent synchronously before allocating seq.
 * The durable chat message is the commit point across the two files. */
export function readStudyEvents(id: string): LearnerEvent[] {
	const file = pendingPath(id);
	const pending = readOptional(file);
	let committed: LearnerEvent | undefined;
	if (pending !== undefined) {
		const { chatId, messageId, event } = JSON.parse(pending) as PendingChatEvent;
		if (!/^[A-Za-z0-9_-]+$/.test(chatId) || eventRecord(event).domainId !== id) throw new Error("Invalid pending study event");
		const saved = readOptional(path.join(chatsDir(PATHS.data, id), chatId + ".json"));
		const chat: { messages: { id: string }[] } | undefined = saved ? JSON.parse(saved) : undefined;
		if (chat?.messages.some(message => message.id === messageId)) committed = event;
	}
	const log = logPath(id);
	let raw = readOptional(log) ?? "";
	if (raw && !raw.endsWith("\n")) {
		// Complete the exact pending row, even if the crash split a UTF-8 character.
		const bytes = fs.readFileSync(log);
		const tail = bytes.subarray(bytes.lastIndexOf(10) + 1);
		const row = committed && Buffer.from(JSON.stringify(committed) + "\n");
		const suffix = row && row.subarray(0, tail.length).equals(tail) ? row.subarray(tail.length) : Buffer.from("\n");
		fs.appendFileSync(log, suffix);
		raw = Buffer.concat([bytes, suffix]).toString("utf8");
	}
	const events: LearnerEvent[] = [];
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		try {
			events.push(JSON.parse(line) as LearnerEvent);
		} catch {
			// Keep reading old logs that already contained an incomplete row.
		}
	}
	if (committed && !events.some(ev => eventRecord(ev).id === eventRecord(committed!).id)) {
		appendStudyEvent(id, committed);
		events.push(committed);
	}
	if (pending !== undefined) fs.unlinkSync(file);
	return events;
}

export function persistChatEvent(id: string, intent: PendingChatEvent, saveMessages: () => void) {
	const file = pendingPath(id);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	writeFileAtomicSync(file, JSON.stringify(intent));
	saveMessages();
	try {
		appendStudyEvent(id, intent.event);
		fs.unlinkSync(file);
	} catch (err) {
		// The answer is already durable. The next learner read/write finishes the append.
		console.error("[study] pending learner event", err);
	}
}
