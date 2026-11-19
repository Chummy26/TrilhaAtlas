/**
 * Per-domain memory database schema (r4 §7.4, adapted; SÍNTESE §2.5 layers).
 * One file per domain: `<LH_DATA_DIR>/domains/<id>/memory/memory.db` (WAL).
 *
 *   L0  messages            raw turns, the source of truth (sync write)
 *   L1  episodes            dated narrative segments
 *   L2  facts               BITEMPORAL (valid_from/valid_to × recorded_at/expired_at),
 *                           never overwritten; about_node + node_ids link to the curriculum
 *       entities, edges     heterogeneous graph (fact/entity/episode/node/observation)
 *   L3  observations        consolidated beliefs with proof_count + history
 *       mental_models       DeepTutor entries (m_ULID, ≤ 240 chars, refs) in 4 sections
 *   WM  observation_log     per-session working memory (Mastra OM generations)
 *       diary               Mission / Last session / next_focus hand-off
 *   —   evidence            grounded dialogue evidence sent to the learner model (R2)
 *       flashcard_candidates end-of-session card proposals
 *       embeddings          float32 BLOBs (little-endian), one row per item, model id + dim
 *       fts                 FTS5 unicode61 remove_diacritics 2 ("tensao" ≡ "tensão")
 *       audit, llm_usage    recoverability and token accounting
 *
 * Differences from r4 §7.4 (documented in docs/impl/memory.md):
 *   - embeddings live in their own table (re-embedding after a model change
 *     is one DELETE + backfill; loading the vector index is one scan);
 *   - FTS rows are written explicitly by the store and mapped by `fts_rowid`
 *     on each source row (O(1) delete on forget, no full-table triggers);
 *   - no persistent `jobs` table: pending work is derivable from state
 *     (`messages.extracted = 0`, `observation_log.covers_until_seq`,
 *     `facts.consolidated = 0`), so a crash loses nothing;
 *   - `mental_models` stores entries (DeepTutor ops) instead of one markdown
 *     blob per question; `diary` and `flashcard_candidates` are new.
 */

import type { SqlDriver } from "./sql-driver.ts";

export const MEMORY_SCHEMA_VERSION = 2;

export const MEMORY_PRAGMAS = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA temp_store = MEMORY;
PRAGMA busy_timeout = 5000;
`;

export const MEMORY_DDL = `
CREATE TABLE IF NOT EXISTS meta(
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS sessions(
	id TEXT PRIMARY KEY,
	started_at INTEGER NOT NULL,
	ended_at INTEGER,
	focus_nodes_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(focus_nodes_json))
) STRICT;

CREATE TABLE IF NOT EXISTS messages(
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
	seq INTEGER NOT NULL,
	ts INTEGER NOT NULL,
	role TEXT NOT NULL CHECK(role IN ('user','assistant','tool')),
	text TEXT NOT NULL,
	node_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(node_ids_json)),
	tokens INTEGER NOT NULL,
	extracted INTEGER NOT NULL DEFAULT 0 CHECK(extracted IN (0,1)),
	status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived','forgotten')),
	fts_rowid INTEGER,
	UNIQUE(session_id, seq)
) STRICT;
CREATE INDEX IF NOT EXISTS ix_msg_pending ON messages(session_id, extracted, seq);
CREATE INDEX IF NOT EXISTS ix_msg_ts ON messages(ts);

-- Opaque source ids survive forgetting the content, so replay cannot restore it.
CREATE TABLE IF NOT EXISTS ingest_receipts(
	session_id TEXT NOT NULL,
	source_id TEXT NOT NULL,
	PRIMARY KEY(session_id, source_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS episodes(
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
	first_msg_id TEXT NOT NULL,
	last_msg_id TEXT NOT NULL,
	t_start INTEGER NOT NULL,
	t_end INTEGER NOT NULL,
	title TEXT NOT NULL,
	narrative TEXT NOT NULL,
	node_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(node_ids_json)),
	importance REAL NOT NULL DEFAULT 0.5 CHECK(importance BETWEEN 0 AND 1),
	access_count INTEGER NOT NULL DEFAULT 0,
	last_accessed_at INTEGER,
	status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived','forgotten')),
	fts_rowid INTEGER,
	created_at INTEGER NOT NULL,
	CHECK(t_start <= t_end)
) STRICT;
CREATE INDEX IF NOT EXISTS ix_episode_session ON episodes(session_id);

CREATE TABLE IF NOT EXISTS facts(
	id TEXT PRIMARY KEY,
	session_id TEXT,
	kind TEXT NOT NULL CHECK(kind IN ('world','experience','learner','preference','misconception','goal','affect','plan')),
	scope TEXT NOT NULL DEFAULT 'domain' CHECK(scope IN ('domain','global','session')),
	text TEXT NOT NULL,
	about_node TEXT,
	node_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(node_ids_json)),
	valid_from INTEGER,
	valid_to INTEGER,
	recorded_at INTEGER NOT NULL,
	expired_at INTEGER,
	confidence REAL NOT NULL DEFAULT 0.7 CHECK(confidence BETWEEN 0 AND 1),
	polarity INTEGER NOT NULL DEFAULT 1 CHECK(polarity IN (-1,0,1)),
	superseded_by TEXT REFERENCES facts(id) ON DELETE SET NULL,
	source_episode_id TEXT REFERENCES episodes(id) ON DELETE SET NULL,
	source_msg_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(source_msg_ids_json)),
	quote TEXT,
	grounded INTEGER NOT NULL DEFAULT 0 CHECK(grounded IN (0,1)),
	importance REAL NOT NULL DEFAULT 0.5 CHECK(importance BETWEEN 0 AND 1),
	proof_count INTEGER NOT NULL DEFAULT 1 CHECK(proof_count >= 1),
	access_count INTEGER NOT NULL DEFAULT 0,
	last_accessed_at INTEGER,
	status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived','forgotten')),
	consolidated INTEGER NOT NULL DEFAULT 0 CHECK(consolidated IN (0,1)),
	fts_rowid INTEGER,
	CHECK(valid_to IS NULL OR valid_from IS NULL OR valid_from <= valid_to),
	CHECK(expired_at IS NULL OR recorded_at <= expired_at),
	CHECK(superseded_by IS NULL OR superseded_by <> id)
) STRICT;
CREATE INDEX IF NOT EXISTS ix_fact_current ON facts(kind, expired_at, status);
CREATE INDEX IF NOT EXISTS ix_fact_recorded ON facts(recorded_at);
CREATE INDEX IF NOT EXISTS ix_fact_session ON facts(session_id);
CREATE INDEX IF NOT EXISTS ix_fact_pending ON facts(consolidated, status);

CREATE TABLE IF NOT EXISTS entities(
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	canonical TEXT NOT NULL,
	type TEXT NOT NULL CHECK(type IN ('concept','person','resource','tool','place','org','other')),
	aliases_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(aliases_json)),
	node_id TEXT,
	updated_at INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_entity_canon ON entities(canonical, type);

CREATE TABLE IF NOT EXISTS edges(
	src_type TEXT NOT NULL CHECK(src_type IN ('fact','entity','episode','node','observation')),
	src_id TEXT NOT NULL,
	dst_type TEXT NOT NULL CHECK(dst_type IN ('fact','entity','episode','node','observation')),
	dst_id TEXT NOT NULL,
	rel TEXT NOT NULL CHECK(rel IN ('mentions','about','evidence_for','evidence_against','temporal','semantic',
		'causes','enables','prevents','refines','supersedes','same_as','part_of')),
	weight REAL NOT NULL DEFAULT 1.0 CHECK(weight BETWEEN 0 AND 1),
	recorded_at INTEGER NOT NULL,
	PRIMARY KEY(src_type, src_id, rel, dst_type, dst_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_edge_dst ON edges(dst_type, dst_id, rel);

CREATE TABLE IF NOT EXISTS observations(
	id TEXT PRIMARY KEY,
	subject_type TEXT NOT NULL CHECK(subject_type IN ('entity','node','learner')),
	subject_id TEXT NOT NULL,
	text TEXT NOT NULL,
	evidence_fact_ids_json TEXT NOT NULL CHECK(json_valid(evidence_fact_ids_json)),
	quotes_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(quotes_json)),
	history_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(history_json)),
	proof_count INTEGER NOT NULL DEFAULT 1 CHECK(proof_count >= 1),
	confidence REAL NOT NULL DEFAULT 0.6 CHECK(confidence BETWEEN 0 AND 1),
	version INTEGER NOT NULL DEFAULT 1,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	ended_at INTEGER,
	stale INTEGER NOT NULL DEFAULT 0 CHECK(stale IN (0,1)),
	status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived','forgotten')),
	fts_rowid INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS ix_obs_subject ON observations(subject_type, subject_id);

CREATE TABLE IF NOT EXISTS mental_models(
	id TEXT PRIMARY KEY CHECK(id GLOB 'm_*'),
	section TEXT NOT NULL CHECK(length(section) BETWEEN 1 AND 80),
	text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 240),
	refs_json TEXT NOT NULL CHECK(json_valid(refs_json) AND json_array_length(refs_json) > 0),
	position INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	deleted_at INTEGER,
	delete_reason TEXT CHECK(delete_reason IS NULL OR delete_reason IN ('contradicted','superseded','stale','low-signal','forgotten'))
) STRICT;

CREATE TABLE IF NOT EXISTS observation_log(
	session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
	generation INTEGER NOT NULL,
	text TEXT NOT NULL,
	tokens INTEGER NOT NULL,
	covers_until_seq INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	PRIMARY KEY(session_id, generation)
) STRICT;

CREATE TABLE IF NOT EXISTS diary(
	session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
	mission TEXT,
	summary TEXT NOT NULL,
	next_focus TEXT NOT NULL,
	created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS evidence(
	id TEXT PRIMARY KEY,
	seq INTEGER NOT NULL UNIQUE,
	at INTEGER NOT NULL,
	session_id TEXT NOT NULL,
	payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
	source TEXT NOT NULL CHECK(source IN ('grader','dialogue_extractor','flashcard','self_report')),
	source_fact_id TEXT REFERENCES facts(id) ON DELETE SET NULL,
	source_msg_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(source_msg_ids_json))
) STRICT;

CREATE TABLE IF NOT EXISTS flashcard_candidates(
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	node_id TEXT,
	front TEXT NOT NULL,
	back TEXT NOT NULL,
	source_msg_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(source_msg_ids_json)),
	status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','discarded')),
	created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS ix_card_session ON flashcard_candidates(session_id, status);

CREATE TABLE IF NOT EXISTS embeddings(
	item_kind TEXT NOT NULL CHECK(item_kind IN ('message','episode','fact','observation')),
	item_id TEXT NOT NULL,
	model_id TEXT NOT NULL,
	dim INTEGER NOT NULL,
	vec BLOB NOT NULL CHECK(length(vec) = dim * 4),
	PRIMARY KEY(item_kind, item_id)
) STRICT;

CREATE TABLE IF NOT EXISTS external_refs(
	domain_id TEXT NOT NULL,
	node_id TEXT NOT NULL,
	reason TEXT,
	PRIMARY KEY(domain_id, node_id)
) STRICT;

CREATE TABLE IF NOT EXISTS audit(
	id INTEGER PRIMARY KEY,
	ts INTEGER NOT NULL,
	op TEXT NOT NULL,
	target_type TEXT NOT NULL,
	target_id TEXT NOT NULL,
	before_json TEXT,
	after_json TEXT,
	actor TEXT NOT NULL CHECK(actor IN ('extractor','consolidator','judge','observer','user','system'))
) STRICT;
CREATE INDEX IF NOT EXISTS ix_audit_target ON audit(target_type, target_id);

CREATE TABLE IF NOT EXISTS llm_usage(
	id INTEGER PRIMARY KEY,
	ts INTEGER NOT NULL,
	op TEXT NOT NULL,
	model_id TEXT NOT NULL,
	tokens_in INTEGER NOT NULL,
	tokens_out INTEGER NOT NULL,
	cached_in INTEGER NOT NULL DEFAULT 0,
	ms INTEGER NOT NULL
) STRICT;

CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(
	kind UNINDEXED,
	ref_id UNINDEXED,
	text,
	tokenize = 'unicode61 remove_diacritics 2'
);
`;

export class MemorySchemaError extends Error {
	constructor(message: string) {
		super(`[memória:schema] ${message}`);
		this.name = "MemorySchemaError";
	}
}

/**
 * Apply pragmas + DDL (idempotent) and stamp/verify `meta`. A database that
 * belongs to another domain, or comes from a newer schema, is refused.
 */
export function applyMemorySchema(db: SqlDriver, domainId: string, now: number): void {
	db.exec(MEMORY_PRAGMAS);
	db.transaction(() => {
		db.exec(MEMORY_DDL);
		const get = db.prepare("SELECT value FROM meta WHERE key = ?");
		const put = db.prepare("INSERT INTO meta(key, value) VALUES (?, ?)");
		const version = get.get("schema_version")?.value;
		if (version === undefined) {
			put.run("schema_version", String(MEMORY_SCHEMA_VERSION));
			put.run("domain_id", domainId);
			put.run("created_at", String(now));
			return;
		}
		if (Number(version) > MEMORY_SCHEMA_VERSION) {
			throw new MemorySchemaError(`banco com schema ${version}, mais novo que o suportado (${MEMORY_SCHEMA_VERSION})`);
		}
		const owner = get.get("domain_id")?.value;
		if (owner !== domainId) {
			throw new MemorySchemaError(`o banco ${db.path} pertence ao domínio "${String(owner)}", não a "${domainId}"`);
		}
		// v1 messages have no native source id. Keep them intact; only new
		// imports can provide the identity needed for a receipt.
		if (version === "1") writeMeta(db, "schema_version", String(MEMORY_SCHEMA_VERSION));
	});
}

export function readMeta(db: SqlDriver, key: string): string | null {
	const v = db.prepare("SELECT value FROM meta WHERE key = ?").get(key)?.value;
	return typeof v === "string" ? v : null;
}

export function writeMeta(db: SqlDriver, key: string, value: string): void {
	db.prepare("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
