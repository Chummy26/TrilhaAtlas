/**
 * In-memory catalog of one domain's memory items (r4 §7.2 "BLOB float32 +
 * cosseno em JS até ~100k vetores por domínio"; §7.6.4 recall p50 ≤ 200 ms).
 *
 * The SQLite file is the source of truth; the catalog mirrors the small
 * per-item metadata the recall channels filter on (status, bitemporal state,
 * session, time, node links, importance) plus the normalised vectors. It is
 * rebuilt from the file at open and updated by the store after every commit,
 * so channel filtering never round-trips to SQL; full texts are loaded only
 * for the final ≤ 40 candidates.
 */

import { isCurrentFact, type FactStatus } from "../../core/memory/supersede.ts";
import { decodeVector, VectorIndex } from "../../core/memory/vector.ts";
import type { FactKind, FactScope, MemoryItemKind } from "../../core/memory/types.ts";
import { asBlob, itemKey, jsonList, rowNumber, rowString } from "./rows.ts";
import type { SqlDriver, SqlRow } from "./sql-driver.ts";

export interface ItemMeta {
	key: string;
	kind: MemoryItemKind;
	id: string;
	sessionId: string | null;
	/** Relevant time: message ts, episode start, fact valid_from ?? recorded_at, observation updated_at. */
	at: number;
	/** End of the item's event interval (episodes: t_end; facts: valid_to ?? at). */
	end: number;
	status: FactStatus;
	factKind?: FactKind;
	/** Facts: `session`-scoped facts only matter inside the session that produced them. */
	scope?: FactScope;
	validTo: number | null;
	expiredAt: number | null;
	/** Observations: ended_at. */
	endedAt: number | null;
	importance: number;
	confidence: number;
	nodeIds: string[];
	tokens: number;
}

export interface EligibilityOptions {
	lessonNodes?: ReadonlySet<string>;
	now: number;
	historical: boolean;
	sessionOnly: boolean;
	sessionId: string;
}

export class MemoryCatalog {
	readonly items = new Map<string, ItemMeta>();
	/** node id → keys of facts/episodes/observations linked to it (raw messages excluded). */
	private readonly byNode = new Map<string, Set<string>>();
	vectors: VectorIndex;

	constructor(dim: number) {
		this.vectors = new VectorIndex(dim);
	}

	upsert(meta: ItemMeta): void {
		const previous = this.items.get(meta.key);
		if (previous) this.unlinkNodes(previous);
		this.items.set(meta.key, meta);
		if (meta.kind !== "message") {
			for (const n of meta.nodeIds) {
				let set = this.byNode.get(n);
				if (!set) {
					set = new Set();
					this.byNode.set(n, set);
				}
				set.add(meta.key);
			}
		}
	}

	patch(key: string, fields: Partial<Omit<ItemMeta, "key" | "kind" | "id">>): void {
		const cur = this.items.get(key);
		if (cur) this.upsert({ ...cur, ...fields });
	}

	remove(key: string): void {
		const cur = this.items.get(key);
		if (cur) this.unlinkNodes(cur);
		this.items.delete(key);
		this.vectors.delete(key);
	}

	keysForNode(nodeId: string): ReadonlySet<string> {
		return this.byNode.get(nodeId) ?? new Set();
	}

	isEligible(meta: ItemMeta, o: EligibilityOptions): boolean {
		if (meta.status === "forgotten") return false;
		if (meta.status === "archived" && !o.historical) return false;
		if (o.sessionOnly && meta.sessionId !== o.sessionId) return false;
		const nodes = o.lessonNodes;
		if (nodes && meta.sessionId !== o.sessionId &&
			(meta.scope === "session" || !meta.nodeIds.some(id => nodes.has(id)))) return false;
		if (!o.historical) {
			if (meta.kind === "fact" && meta.scope === "session" && meta.sessionId !== o.sessionId) return false;
			if (meta.kind === "fact" && !isCurrentFact({ status: meta.status, expiredAt: meta.expiredAt, validTo: meta.validTo }, o.now)) return false;
			if (meta.kind === "observation" && meta.endedAt !== null) return false;
		}
		return true;
	}

	/** Superseded / ended in the bitemporal sense (labelled in historical recall). */
	isSuperseded(meta: ItemMeta, now: number): boolean {
		if (meta.kind === "fact") return meta.expiredAt !== null || (meta.validTo !== null && meta.validTo <= now);
		if (meta.kind === "observation") return meta.endedAt !== null;
		return false;
	}

	private unlinkNodes(meta: ItemMeta): void {
		for (const n of meta.nodeIds) {
			const set = this.byNode.get(n);
			if (!set) continue;
			set.delete(meta.key);
			if (set.size === 0) this.byNode.delete(n);
		}
	}
}

/** Rebuild the catalog from the database (open time). Vectors of another model id are ignored. */
export function loadCatalog(db: SqlDriver, dim: number, modelId: string): MemoryCatalog {
	const cat = new MemoryCatalog(dim);
	for (const r of db.prepare("SELECT id, session_id, ts, node_ids_json, tokens, status FROM messages").all()) {
		const id = rowString(r, "id") as string;
		const ts = rowNumber(r, "ts") as number;
		cat.upsert({
			key: itemKey("message", id),
			kind: "message",
			id,
			sessionId: rowString(r, "session_id"),
			at: ts,
			end: ts,
			status: rowString(r, "status") as FactStatus,
			validTo: null,
			expiredAt: null,
			endedAt: null,
			importance: 0.5,
			confidence: 1,
			nodeIds: jsonList(r, "messages", "node_ids_json"),
			tokens: rowNumber(r, "tokens") ?? 0,
		});
	}
	for (const r of db.prepare("SELECT id, session_id, t_start, t_end, node_ids_json, importance, status FROM episodes").all()) {
		const id = rowString(r, "id") as string;
		cat.upsert({
			key: itemKey("episode", id),
			kind: "episode",
			id,
			sessionId: rowString(r, "session_id"),
			at: rowNumber(r, "t_start") as number,
			end: rowNumber(r, "t_end") as number,
			status: rowString(r, "status") as FactStatus,
			validTo: null,
			expiredAt: null,
			endedAt: null,
			importance: rowNumber(r, "importance") ?? 0.5,
			confidence: 1,
			nodeIds: jsonList(r, "episodes", "node_ids_json"),
			tokens: 0,
		});
	}
	const factSql =
		"SELECT id, session_id, kind, scope, node_ids_json, valid_from, valid_to, recorded_at, expired_at, confidence, importance, status FROM facts";
	for (const r of db.prepare(factSql).all()) cat.upsert(factMetaFromRow(r));
	const obsSql = "SELECT id, subject_type, subject_id, updated_at, ended_at, confidence, status FROM observations";
	for (const r of db.prepare(obsSql).all()) cat.upsert(observationMeta(r));
	for (const r of db.prepare("SELECT item_kind, item_id, model_id, dim, vec FROM embeddings").all()) {
		if (rowString(r, "model_id") !== modelId || rowNumber(r, "dim") !== dim) continue;
		const key = itemKey(rowString(r, "item_kind") as MemoryItemKind, rowString(r, "item_id") as string);
		const blob = asBlob(r.vec);
		const meta = cat.items.get(key);
		// A forgotten item never gets its vector back (soft forget deletes the row; older files may keep one).
		if (blob && meta && meta.status !== "forgotten") cat.vectors.set(key, decodeVector(blob));
	}
	return cat;
}

export function factMetaFromRow(row: SqlRow): ItemMeta {
	const id = rowString(row, "id") as string;
	const validFrom = rowNumber(row, "valid_from");
	const recordedAt = rowNumber(row, "recorded_at") as number;
	const validTo = rowNumber(row, "valid_to");
	const at = validFrom ?? recordedAt;
	return {
		key: itemKey("fact", id),
		kind: "fact",
		id,
		sessionId: rowString(row, "session_id"),
		at,
		end: validTo ?? at,
		status: rowString(row, "status") as FactStatus,
		factKind: rowString(row, "kind") as FactKind,
		scope: (rowString(row, "scope") ?? "domain") as FactScope,
		validTo,
		expiredAt: rowNumber(row, "expired_at"),
		endedAt: null,
		importance: rowNumber(row, "importance") ?? 0.5,
		confidence: rowNumber(row, "confidence") ?? 0.7,
		nodeIds: jsonList(row, "facts", "node_ids_json"),
		tokens: 0,
	};
}

export function observationMeta(row: SqlRow): ItemMeta {
	const id = rowString(row, "id") as string;
	const updatedAt = rowNumber(row, "updated_at") as number;
	const subjectType = rowString(row, "subject_type");
	return {
		key: itemKey("observation", id),
		kind: "observation",
		id,
		sessionId: null,
		at: updatedAt,
		end: updatedAt,
		status: rowString(row, "status") as FactStatus,
		validTo: null,
		expiredAt: null,
		endedAt: rowNumber(row, "ended_at"),
		importance: 0.6,
		confidence: rowNumber(row, "confidence") ?? 0.6,
		nodeIds: subjectType === "node" ? [rowString(row, "subject_id") as string] : [],
		tokens: 0,
	};
}
