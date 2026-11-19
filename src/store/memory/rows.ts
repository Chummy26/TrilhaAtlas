/**
 * Typed row mappers for the memory database (schema.ts; r4 §7.4). SQLite
 * returns loosely typed records; every read goes through these functions so
 * the rest of the store works with plain typed objects and a corrupted row
 * fails loudly with the table and column named.
 */

import { isFactKind, type FactKind, type MemoryItemKind, type MessageRole } from "../../core/memory/types.ts";
import type { BitemporalFact, FactStatus } from "../../core/memory/supersede.ts";
import type { SqlRow, SqlValue } from "./sql-driver.ts";

export class MemoryRowError extends Error {
	constructor(table: string, column: string, value: unknown) {
		super(`[memória:schema] valor inválido em ${table}.${column}: ${JSON.stringify(value)}`);
		this.name = "MemoryRowError";
	}
}

function str(row: SqlRow, table: string, col: string): string {
	const v = row[col];
	if (typeof v !== "string") throw new MemoryRowError(table, col, v);
	return v;
}

function optStr(row: SqlRow, col: string): string | null {
	const v = row[col];
	return typeof v === "string" ? v : null;
}

function num(row: SqlRow, table: string, col: string): number {
	const v = row[col];
	if (typeof v === "number") return v;
	if (typeof v === "bigint") return Number(v);
	throw new MemoryRowError(table, col, v);
}

function optNum(row: SqlRow, col: string): number | null {
	const v = row[col];
	if (typeof v === "number") return v;
	if (typeof v === "bigint") return Number(v);
	return null;
}

export function jsonList(row: SqlRow, table: string, col: string): string[] {
	const raw = str(row, table, col);
	const parsed: unknown = JSON.parse(raw);
	if (!Array.isArray(parsed)) throw new MemoryRowError(table, col, raw);
	return parsed.filter((x): x is string => typeof x === "string");
}

function status(row: SqlRow, table: string): FactStatus {
	const v = row.status;
	if (v === "active" || v === "archived" || v === "forgotten") return v;
	throw new MemoryRowError(table, "status", v);
}

export function asBlob(v: SqlValue | undefined): Uint8Array | null {
	return v instanceof Uint8Array ? v : null;
}

// ─── messages ───────────────────────────────────────────────────────────────

export interface MessageRecord {
	id: string;
	sessionId: string;
	seq: number;
	ts: number;
	role: MessageRole;
	text: string;
	nodeIds: string[];
	tokens: number;
	extracted: boolean;
	status: FactStatus;
	ftsRowid: number | null;
}

export function toMessage(row: SqlRow): MessageRecord {
	const role = row.role;
	if (role !== "user" && role !== "assistant" && role !== "tool") throw new MemoryRowError("messages", "role", role);
	return {
		id: str(row, "messages", "id"),
		sessionId: str(row, "messages", "session_id"),
		seq: num(row, "messages", "seq"),
		ts: num(row, "messages", "ts"),
		role,
		text: str(row, "messages", "text"),
		nodeIds: jsonList(row, "messages", "node_ids_json"),
		tokens: num(row, "messages", "tokens"),
		extracted: num(row, "messages", "extracted") === 1,
		status: status(row, "messages"),
		ftsRowid: optNum(row, "fts_rowid"),
	};
}

// ─── episodes ───────────────────────────────────────────────────────────────

export interface EpisodeRecord {
	id: string;
	sessionId: string;
	firstMsgId: string;
	lastMsgId: string;
	tStart: number;
	tEnd: number;
	title: string;
	narrative: string;
	nodeIds: string[];
	importance: number;
	accessCount: number;
	status: FactStatus;
	ftsRowid: number | null;
	createdAt: number;
}

export function toEpisode(row: SqlRow): EpisodeRecord {
	return {
		id: str(row, "episodes", "id"),
		sessionId: str(row, "episodes", "session_id"),
		firstMsgId: str(row, "episodes", "first_msg_id"),
		lastMsgId: str(row, "episodes", "last_msg_id"),
		tStart: num(row, "episodes", "t_start"),
		tEnd: num(row, "episodes", "t_end"),
		title: str(row, "episodes", "title"),
		narrative: str(row, "episodes", "narrative"),
		nodeIds: jsonList(row, "episodes", "node_ids_json"),
		importance: num(row, "episodes", "importance"),
		accessCount: num(row, "episodes", "access_count"),
		status: status(row, "episodes"),
		ftsRowid: optNum(row, "fts_rowid"),
		createdAt: num(row, "episodes", "created_at"),
	};
}

// ─── facts ──────────────────────────────────────────────────────────────────

export interface FactRecord extends BitemporalFact {
	sessionId: string | null;
	scope: "domain" | "global" | "session";
	text: string;
	aboutNode: string | null;
	nodeIds: string[];
	confidence: number;
	polarity: -1 | 0 | 1;
	sourceEpisodeId: string | null;
	sourceMsgIds: string[];
	quote: string | null;
	grounded: boolean;
	importance: number;
	accessCount: number;
	consolidated: boolean;
	ftsRowid: number | null;
}

export function toFact(row: SqlRow): FactRecord {
	const kind = row.kind;
	if (!isFactKind(kind)) throw new MemoryRowError("facts", "kind", kind);
	const scope = row.scope;
	if (scope !== "domain" && scope !== "global" && scope !== "session") throw new MemoryRowError("facts", "scope", scope);
	const polarity = num(row, "facts", "polarity");
	if (polarity !== -1 && polarity !== 0 && polarity !== 1) throw new MemoryRowError("facts", "polarity", polarity);
	return {
		id: str(row, "facts", "id"),
		sessionId: optStr(row, "session_id"),
		kind: kind as FactKind,
		scope,
		text: str(row, "facts", "text"),
		aboutNode: optStr(row, "about_node"),
		nodeIds: jsonList(row, "facts", "node_ids_json"),
		validFrom: optNum(row, "valid_from"),
		validTo: optNum(row, "valid_to"),
		recordedAt: num(row, "facts", "recorded_at"),
		expiredAt: optNum(row, "expired_at"),
		confidence: num(row, "facts", "confidence"),
		polarity,
		supersededBy: optStr(row, "superseded_by"),
		sourceEpisodeId: optStr(row, "source_episode_id"),
		sourceMsgIds: jsonList(row, "facts", "source_msg_ids_json"),
		quote: optStr(row, "quote"),
		grounded: num(row, "facts", "grounded") === 1,
		importance: num(row, "facts", "importance"),
		proofCount: num(row, "facts", "proof_count"),
		accessCount: num(row, "facts", "access_count"),
		consolidated: num(row, "facts", "consolidated") === 1,
		status: status(row, "facts"),
		ftsRowid: optNum(row, "fts_rowid"),
	};
}

// ─── observations ───────────────────────────────────────────────────────────

export interface ObservationRecord {
	id: string;
	subjectType: "entity" | "node" | "learner";
	subjectId: string;
	text: string;
	evidenceFactIds: string[];
	history: { at: number; text: string }[];
	proofCount: number;
	confidence: number;
	version: number;
	createdAt: number;
	updatedAt: number;
	endedAt: number | null;
	stale: boolean;
	status: FactStatus;
	ftsRowid: number | null;
}

export function toObservation(row: SqlRow): ObservationRecord {
	const subjectType = row.subject_type;
	if (subjectType !== "entity" && subjectType !== "node" && subjectType !== "learner") {
		throw new MemoryRowError("observations", "subject_type", subjectType);
	}
	const historyRaw: unknown = JSON.parse(str(row, "observations", "history_json"));
	const history = Array.isArray(historyRaw)
		? historyRaw.filter((h): h is { at: number; text: string } => !!h && typeof h.at === "number" && typeof h.text === "string")
		: [];
	return {
		id: str(row, "observations", "id"),
		subjectType,
		subjectId: str(row, "observations", "subject_id"),
		text: str(row, "observations", "text"),
		evidenceFactIds: jsonList(row, "observations", "evidence_fact_ids_json"),
		history,
		proofCount: num(row, "observations", "proof_count"),
		confidence: num(row, "observations", "confidence"),
		version: num(row, "observations", "version"),
		createdAt: num(row, "observations", "created_at"),
		updatedAt: num(row, "observations", "updated_at"),
		endedAt: optNum(row, "ended_at"),
		stale: num(row, "observations", "stale") === 1,
		status: status(row, "observations"),
		ftsRowid: optNum(row, "fts_rowid"),
	};
}

// ─── misc ───────────────────────────────────────────────────────────────────

export function itemKey(kind: MemoryItemKind, id: string): string {
	return `${kind}:${id}`;
}

export function parseItemKey(key: string): { kind: MemoryItemKind; id: string } {
	const i = key.indexOf(":");
	const kind = key.slice(0, i);
	if (kind !== "message" && kind !== "episode" && kind !== "fact" && kind !== "observation") {
		throw new Error(`chave de item inválida: ${key}`);
	}
	return { kind, id: key.slice(i + 1) };
}

export function rowNumber(row: SqlRow | undefined, col: string): number | null {
	return row ? optNum(row, col) : null;
}

export function rowString(row: SqlRow | undefined, col: string): string | null {
	return row ? optStr(row, col) : null;
}
