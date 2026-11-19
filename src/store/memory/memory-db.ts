/**
 * MemoryDb — one domain's long-term context memory in one SQLite file
 * (docs/research/00-SINTESE.md §2.5, §2.4(b)(d); r4-memoria-contexto-sota.md
 * §7.6 operations; Hindsight retain/recall/reflect + observations with
 * proof_count [extra-vectorize-io__hindsight.md §5]; DeepTutor mental-model
 * ops and learning journal [ref-deeptutor-core.md §3.2, §3.4]).
 *
 *   ingestTurn   sync (< 5 ms): INSERT message + FTS row in one transaction;
 *                embedding, extraction and observation are queued in background.
 *   recall       channels vec (cosine in JS) · fts (bm25) · graph (spreading
 *                activation over memory edges + curriculum neighbours, 1 hop) ·
 *                time (pt/en expressions) · learner (weak nodes) → RRF k=60
 *                (or RSF) → life prior → relative cut → MMR λ=0.7 → token
 *                budget → chronological rendering.
 *   stablePrefix profile ≤ 300 · mental models + diary ≤ 1000 · learner ≤ 300 ·
 *                observation log ≤ 8000 (cacheable, before the cache boundary).
 *   endSession   extraction (Extractor port, grounded quotes only) → supersession
 *                judge (bitemporal close, never overwrite) → observation log →
 *                consolidation (observations + mental-model ops) → diary.
 *   consolidate  deterministic dedup + archiving, then observations/mental
 *                models from facts not yet consolidated (idempotent).
 *   forget       soft (status + FTS/vector removal, audit keeps the row for
 *                rollback) or hard (DELETE cascade, audit scrubbed, VACUUM).
 *
 * Concurrency: single writer per file (this object). Every asynchronous step
 * runs on one promise chain, so background work never interleaves with
 * endSession/consolidate/forget; `flush()` waits for the chain to drain.
 * No model is called from here: LLM work goes through the injected Extractor.
 */

import fs from "node:fs";
import path from "node:path";
import { CONTEXT_BUDGETS, assembleContext, composeMentalModelSection, packRecall, renderLearnerSnapshot, type AssembledContext, type RenderableItem } from "../../core/memory/assemble.ts";
import { lifePrior, relativeCut, shouldArchive, temporalProximity } from "../../core/memory/decay.ts";
import { DEFAULT_IMPORTANCE, quoteOccursIn, validateExtraction, type GroundedFact } from "../../core/memory/extract.ts";
import { spreadActivation, temporalEdgeWeight, type GraphEdge, type EdgeRel } from "../../core/memory/graph.ts";
import { newId } from "../../core/memory/ids.ts";
import { buildFtsQuery, canonicalEntity, contentTokens, foldText, isTrivialUtterance, jaccard } from "../../core/memory/lexical.ts";
import { mmrRerank } from "../../core/memory/mmr.ts";
import { applyMentalModelOps, REF_PATTERN } from "../../core/memory/ops.ts";
import { reciprocalRankFusion, relativeScoreFusion, type RankedList } from "../../core/memory/rrf.ts";
import { resolveMemorySettings, type MemorySettings } from "../../core/memory/settings.ts";
import {
	compareForWinner,
	isCurrentFact,
	mergeDuplicateFacts,
	pickSupersessionCandidates,
	resolveSupersession,
	type SupersessionCandidate,
} from "../../core/memory/supersede.ts";
import { formatDay, parseTimeRange } from "../../core/memory/temporal.ts";
import { estimateTokens } from "../../core/memory/tokens.ts";
import {
	MENTAL_MODEL_SECTIONS,
	MemoryError,
	RECALL_CHANNELS,
	type ConsolidationInput,
	type CurriculumNeighbors,
	type DiaryEntry,
	type DomainMemory,
	type Embedder,
	type Extractor,
	type FactKind,
	type ForgetMode,
	type ForgetSelector,
	type LearnerPort,
	type LlmUsage,
	type MemoryItem,
	type MemoryItemKind,
	type MentalModelEntry,
	type ObservationAction,
	type ProfilePort,
	type RecallChannel,
	type RecallContext,
	type RecallResult,
	type SourceMessage,
	type TurnInput,
} from "../../core/memory/types.ts";
import { cosine, encodeVector, type Scored } from "../../core/memory/vector.ts";
import { writeFileAtomicSync } from "../atomic-write.ts";
import { MemoryCatalog, factMetaFromRow, loadCatalog, observationMeta, type EligibilityOptions, type ItemMeta } from "./catalog.ts";
import { EXPORT_FILES, diaryMarkdown, mentalModelMarkdown, observationsMarkdown } from "./export-md.ts";
import { itemKey, jsonList, parseItemKey, rowNumber, rowString, toEpisode, toFact, toMessage, toObservation, type FactRecord, type MessageRecord, type ObservationRecord } from "./rows.ts";
import { applyMemorySchema, readMeta, writeMeta } from "./schema.ts";
import { openSqlDriver, type SqlDriver, type SqlRow, type SqlValue } from "./sql-driver.ts";

export const MEMORY_DB_FILE = "memory.db";

export interface MemoryDbOptions {
	domainId: string;
	embedder: Embedder;
	extractor?: Extractor;
	curriculum?: CurriculumNeighbors;
	learner?: LearnerPort;
	profile?: ProfilePort;
	settings?: Partial<MemorySettings>;
	clock?: () => number;
	/** Background failures (embedding, extraction, judge…). The L0 log is never affected. */
	onError?: (error: unknown, op: string) => void;
	/** Human title used in exported markdown (default: the domain id). */
	title?: string;
}

export interface MemoryHealth {
	domainId: string;
	messages: number;
	facts: number;
	currentFacts: number;
	observations: number;
	mentalModelEntries: number;
	pendingExtractionTokens: number;
	vectors: number;
	lastError: string | null;
}

export interface FlashcardCandidateRecord {
	id: string;
	sessionId: string;
	nodeId: string | null;
	front: string;
	back: string;
	sourceMsgIds: string[];
	status: "pending" | "accepted" | "discarded";
	createdAt: number;
}

interface LoadedItem extends RenderableItem {
	key: string;
	sessionId: string | null;
	nodeIds: string[];
	sourceMsgIds: string[];
	importance: number;
}

interface ForgetTargets {
	messages: Set<string>;
	facts: Set<string>;
	episodes: Set<string>;
	observations: Set<string>;
	sessions: Set<string>;
}

interface SupersessionPlan {
	duplicateOf: { id: string; proofCount: number; sourceMsgIds: string[] } | null;
	closes: { closeId: string; validTo: number; expiredAt: number; before: FactRecord }[];
	refines: string[];
	semantic: { id: string; cos: number }[];
}

const LEARNER_CHANNEL_KINDS: ReadonlySet<FactKind> = new Set<FactKind>(["misconception", "goal", "preference"]);
const EMBED_BATCH = 64;
const NODE_FANOUT = 300;
const MAX_OBSERVATION_CHARS = 400;
const MAX_DIARY_SUMMARY_CHARS = 800;
const MAX_DIARY_LINE_CHARS = 240;

function placeholders(n: number): string {
	return Array.from({ length: n }, () => "?").join(",");
}

function chunk<T>(xs: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
	return out;
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function clip(text: string, max: number): string {
	const t = text.replace(/\s+/g, " ").trim();
	return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

function toSource(m: MessageRecord): SourceMessage {
	return { id: m.id, seq: m.seq, role: m.role, ts: m.ts, text: m.text, nodeIds: m.nodeIds };
}

function factPassage(text: string, at: number): string {
	return `${text} (${formatDay(at)})`;
}

/** Audit target id of a rejected extraction element: `<sessionId>#<firstSeq>-<lastSeq>#<index>`. */
function rejectAuditId(sessionId: string, batch: readonly MessageRecord[], index: number): string {
	return `${sessionId}#${batch[0]?.seq ?? 0}-${batch[batch.length - 1]?.seq ?? 0}#${index}`;
}

function rowJson(row: SqlRow | undefined): string | null {
	if (!row) return null;
	const plain: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(row)) plain[k] = v instanceof Uint8Array ? `<blob ${v.byteLength}B>` : typeof v === "bigint" ? Number(v) : v;
	return JSON.stringify(plain);
}

export class MemoryDb implements DomainMemory {
	readonly domainId: string;
	readonly path: string;
	readonly settings: MemorySettings;
	private readonly db: SqlDriver;
	private readonly embedder: Embedder;
	private readonly extractor: Extractor | undefined;
	private readonly curriculum: CurriculumNeighbors | undefined;
	private readonly learner: LearnerPort | undefined;
	private readonly profile: ProfilePort | undefined;
	private readonly clock: () => number;
	private readonly onError: ((error: unknown, op: string) => void) | undefined;
	private readonly title: string;
	private catalog: MemoryCatalog;
	private chain: Promise<unknown> = Promise.resolve();
	private queuedWrites = 0;
	private closed = false;
	private lastError: string | null = null;
	private readonly pendingEmbed = new Set<string>();
	private embedScheduled = false;
	private readonly sessionSeq = new Map<string, number>();
	private readonly sessionFocus = new Map<string, string[]>();
	private readonly pendingTokens = new Map<string, number>();
	private readonly unobservedTokens = new Map<string, number>();
	private readonly extractScheduled = new Set<string>();
	private readonly observeScheduled = new Set<string>();

	private constructor(dir: string, options: MemoryDbOptions, deletionOnly = false) {
		if (!options.domainId) throw new MemoryError("invalid-input", "domainId é obrigatório");
		if (!options.embedder || !(options.embedder.dim > 0)) throw new MemoryError("embedder", "embedder ausente ou com dimensão inválida");
		this.domainId = options.domainId;
		this.settings = resolveMemorySettings(options.settings);
		this.embedder = options.embedder;
		this.extractor = options.extractor;
		this.curriculum = options.curriculum;
		this.learner = options.learner;
		this.profile = options.profile;
		this.clock = options.clock ?? Date.now;
		this.onError = options.onError;
		this.title = options.title ?? options.domainId;
		fs.mkdirSync(dir, { recursive: true });
		this.path = path.join(dir, MEMORY_DB_FILE);
		this.db = openSqlDriver(this.path);
		try {
			applyMemorySchema(this.db, this.domainId, this.clock());
			if (deletionOnly) {
				// Session forget resolves targets in SQL. A cold deletion should
				// neither change embedding metadata nor schedule model work.
				this.catalog = new MemoryCatalog(this.embedder.dim);
				return;
			}
			const modelChanged = this.syncEmbeddingModel();
			this.catalog = loadCatalog(this.db, this.embedder.dim, this.embedder.id);
			for (const meta of this.catalog.items.values()) {
				if (meta.status !== "forgotten" && (modelChanged || !this.catalog.vectors.has(meta.key))) this.pendingEmbed.add(meta.key);
			}
		} catch (error) {
			this.db.close();
			throw error;
		}
		this.scheduleEmbedding();
	}

	/** Open (creating if needed) `<dir>/memory.db` for one domain. */
	static open(dir: string, options: MemoryDbOptions): MemoryDb {
		return new MemoryDb(dir, options);
	}

	static forgetStoredSessions(dir: string, options: MemoryDbOptions, ids: readonly string[]): void {
		if (!fs.statSync(path.join(dir, MEMORY_DB_FILE), { throwIfNoEntry: false })) return;
		const db = new MemoryDb(dir, options, true);
		try { db.forgetSessionsIfIdle(ids); }
		finally { db.closed = true; db.db.close(); }
	}

	/** Refuse before touching any selected session when a queued write could
	 * restore its contents. No awaits interleave the checks and the purge. */
	forgetSessionsIfIdle(ids: readonly string[]): boolean {
		const existing = ids.filter(id => this.hasSession(id));
		if (existing.length && this.queuedWrites) return false;
		for (const sessionId of existing) this.forgetNow({ sessionId }, "hard");
		return true;
	}

	// ─── plumbing ────────────────────────────────────────────────────────────

	private now(): number {
		return this.clock();
	}

	private assertOpen(): void {
		if (this.closed) throw new MemoryError("closed", `memória do domínio "${this.domainId}" já fechada`);
	}

	private report(op: string, error: unknown): void {
		this.lastError = `${op}: ${errorText(error)}`;
		try {
			this.onError?.(error, op);
		} catch {
			// a failing error sink must not break the chain
		}
	}

	/** Run `fn` after every previously scheduled step; failures are reported and re-thrown to the caller. */
	private schedule<T>(op: string, fn: () => Promise<T> | T): Promise<T> {
		this.queuedWrites++;
		const run = this.chain.then(() => {
			this.assertOpen();
			return fn();
		}).finally(() => { this.queuedWrites--; });
		this.chain = run.then(
			() => undefined,
			(error: unknown) => this.report(op, error),
		);
		return run;
	}

	private background(op: string, fn: () => Promise<void> | void): void {
		this.schedule(op, fn).catch(() => undefined);
	}

	/** Wait until every queued background step (embedding, extraction, observation) has finished. */
	async flush(): Promise<void> {
		let current: Promise<unknown>;
		do {
			current = this.chain;
			await current;
		} while (current !== this.chain);
	}

	private audit(op: string, targetType: string, targetId: string, before: string | null, after: string | null, actor: string): void {
		this.db
			.prepare("INSERT INTO audit(ts, op, target_type, target_id, before_json, after_json, actor) VALUES (?,?,?,?,?,?,?)")
			.run(this.now(), op, targetType, targetId, before, after, actor);
	}

	private recordUsage(usage: LlmUsage | undefined): void {
		if (!usage) return;
		this.db
			.prepare("INSERT INTO llm_usage(ts, op, model_id, tokens_in, tokens_out, cached_in, ms) VALUES (?,?,?,?,?,?,?)")
			.run(this.now(), usage.op, usage.modelId, usage.inputTokens, usage.outputTokens, usage.cachedTokens ?? 0, Math.round(usage.ms));
	}

	private syncEmbeddingModel(): boolean {
		const id = readMeta(this.db, "embedding_model_id");
		const dim = readMeta(this.db, "embedding_dim");
		if (id === this.embedder.id && dim === String(this.embedder.dim)) return false;
		this.db.transaction(() => {
			if (id !== null) this.db.prepare("DELETE FROM embeddings").run();
			writeMeta(this.db, "embedding_model_id", this.embedder.id);
			writeMeta(this.db, "embedding_dim", String(this.embedder.dim));
		});
		return id !== null;
	}

	// ─── embeddings ──────────────────────────────────────────────────────────

	private scheduleEmbedding(): void {
		if (this.embedScheduled || this.pendingEmbed.size === 0 || this.closed) return;
		this.embedScheduled = true;
		this.background("embed", async () => {
			this.embedScheduled = false;
			await this.drainEmbeddings();
		});
	}

	private async drainEmbeddings(): Promise<void> {
		while (this.pendingEmbed.size > 0) {
			const keys = [...this.pendingEmbed].slice(0, EMBED_BATCH);
			for (const k of keys) this.pendingEmbed.delete(k);
			const texts = this.passageTexts(keys);
			if (texts.length === 0) continue;
			let vectors: Float32Array[];
			try {
				vectors = await this.embedChecked(texts.map((t) => t.text), "passage");
			} catch (error) {
				// Keep the batch queued: the next scheduling (next turn, endSession) retries it
				// instead of leaving these items without a vector until the file is reopened.
				for (const t of texts) this.pendingEmbed.add(t.key);
				throw error;
			}
			this.db.transaction(() => {
				texts.forEach((t, i) => this.storeVector(t.key, vectors[i] as Float32Array));
			});
		}
	}

	private storeVector(key: string, vec: Float32Array): void {
		// The item may have been forgotten while the embedder was running.
		const meta = this.catalog.items.get(key);
		if (!meta || meta.status === "forgotten") return;
		const { kind, id } = parseItemKey(key);
		this.db
			.prepare("INSERT OR REPLACE INTO embeddings(item_kind, item_id, model_id, dim, vec) VALUES (?,?,?,?,?)")
			.run(kind, id, this.embedder.id, this.embedder.dim, encodeVector(vec));
		this.catalog.vectors.set(key, vec);
	}

	private async embedChecked(texts: string[], kind: "query" | "passage"): Promise<Float32Array[]> {
		const vectors = await this.embedder.embed(texts, kind);
		if (vectors.length !== texts.length) throw new MemoryError("embedder", `embedder devolveu ${vectors.length} vetores para ${texts.length} textos`);
		for (const v of vectors) {
			if (v.length !== this.embedder.dim) throw new MemoryError("embedder", `vetor com dimensão ${v.length}, esperado ${this.embedder.dim}`);
		}
		return vectors;
	}

	private async tryEmbed(texts: string[], kind: "query" | "passage"): Promise<Float32Array[] | null> {
		if (texts.length === 0) return [];
		try {
			return await this.embedChecked(texts, kind);
		} catch (error) {
			this.report("embed", error);
			return null;
		}
	}

	private passageTexts(keys: readonly string[]): { key: string; text: string }[] {
		const out: { key: string; text: string }[] = [];
		const byKind = new Map<MemoryItemKind, string[]>();
		for (const key of keys) {
			const { kind, id } = parseItemKey(key);
			byKind.set(kind, [...(byKind.get(kind) ?? []), id]);
		}
		for (const [kind, ids] of byKind) {
			const table = kind === "message" ? "messages" : kind === "episode" ? "episodes" : kind === "fact" ? "facts" : "observations";
			for (const row of this.db.prepare(`SELECT * FROM ${table} WHERE id IN (${placeholders(ids.length)}) AND status <> 'forgotten'`).all(...ids)) {
				const id = rowString(row, "id") as string;
				let text: string;
				if (kind === "message") text = rowString(row, "text") ?? "";
				else if (kind === "episode") text = `${rowString(row, "title") ?? ""}. ${rowString(row, "narrative") ?? ""}`;
				else if (kind === "fact") text = factPassage(rowString(row, "text") ?? "", rowNumber(row, "valid_from") ?? (rowNumber(row, "recorded_at") as number));
				else text = rowString(row, "text") ?? "";
				if (text.trim()) out.push({ key: itemKey(kind, id), text });
			}
		}
		return out;
	}

	// ─── L0: ingest ──────────────────────────────────────────────────────────

	ingestTurn(t: TurnInput): string | null {
		this.assertOpen();
		if (!t || typeof t.sessionId !== "string" || t.sessionId.trim() === "") throw new MemoryError("invalid-input", "sessionId vazio");
		if (t.sourceId !== undefined && (typeof t.sourceId !== "string" || !t.sourceId.trim())) throw new MemoryError("invalid-input", "sourceId vazio");
		if (t.role !== "user" && t.role !== "assistant" && t.role !== "tool") throw new MemoryError("invalid-input", `papel inválido: ${String(t.role)}`);
		if (typeof t.text !== "string") throw new MemoryError("invalid-input", "texto da fala ausente");
		if (!Number.isFinite(t.ts)) throw new MemoryError("invalid-input", `instante inválido: ${t.ts}`);
		const text = t.text.trim();
		if (!text) return null;
		const nodeIds = [...new Set((Array.isArray(t.nodeIds) ? t.nodeIds : []).filter((n): n is string => typeof n === "string" && n.length > 0))];
		const sessionId = t.sessionId;
		const sourceId = t.sourceId;
		// Most entries on recovery have already been imported. Avoid an
		// unnecessary write transaction, embedding and extraction for them.
		if (sourceId !== undefined && this.db.prepare("SELECT 1 FROM ingest_receipts WHERE session_id = ? AND source_id = ?").get(sessionId, sourceId)) return null;
		const tokens = estimateTokens(text);
		const seq = this.nextSeq(sessionId);
		const id = newId("msg", t.ts);
		const focus = this.focusOf(sessionId);
		const newFocus = nodeIds.filter((n) => !focus.includes(n));

		const inserted = this.db.transaction(() => {
			if (sourceId !== undefined) {
				const receipt = this.db.prepare("INSERT INTO ingest_receipts(session_id, source_id) VALUES (?, ?) ON CONFLICT DO NOTHING").run(sessionId, sourceId);
				if (!receipt.changes) return false;
			}
			this.db.prepare("INSERT OR IGNORE INTO sessions(id, started_at) VALUES (?, ?)").run(sessionId, t.ts);
			const fts = this.db.prepare("INSERT INTO fts(kind, ref_id, text) VALUES ('message', ?, ?)").run(id, text);
			this.db
				.prepare("INSERT INTO messages(id, session_id, seq, ts, role, text, node_ids_json, tokens, fts_rowid) VALUES (?,?,?,?,?,?,?,?,?)")
				.run(id, sessionId, seq, t.ts, t.role, text, JSON.stringify(nodeIds), tokens, fts.lastInsertRowid);
			if (newFocus.length > 0) {
				this.db.prepare("UPDATE sessions SET focus_nodes_json = ? WHERE id = ?").run(JSON.stringify([...focus, ...newFocus]), sessionId);
			}
			return true;
		});
		if (!inserted) return null;
		this.sessionSeq.set(sessionId, seq);
		if (newFocus.length > 0) this.sessionFocus.set(sessionId, [...focus, ...newFocus]);
		const key = itemKey("message", id);
		this.catalog.upsert({
			key,
			kind: "message",
			id,
			sessionId,
			at: t.ts,
			end: t.ts,
			status: "active",
			validTo: null,
			expiredAt: null,
			endedAt: null,
			importance: DEFAULT_IMPORTANCE,
			confidence: 1,
			nodeIds,
			tokens,
		});
		this.pendingEmbed.add(key);
		this.scheduleEmbedding();
		this.bumpThresholds(sessionId, tokens);
		return id;
	}

	private nextSeq(sessionId: string): number {
		let last = this.sessionSeq.get(sessionId);
		if (last === undefined) {
			last = rowNumber(this.db.prepare("SELECT MAX(seq) AS s FROM messages WHERE session_id = ?").get(sessionId), "s") ?? 0;
		}
		return last + 1;
	}

	private focusOf(sessionId: string): string[] {
		let focus = this.sessionFocus.get(sessionId);
		if (!focus) {
			const row = this.db.prepare("SELECT focus_nodes_json FROM sessions WHERE id = ?").get(sessionId);
			focus = row ? jsonList(row, "sessions", "focus_nodes_json") : [];
			this.sessionFocus.set(sessionId, focus);
		}
		return focus;
	}

	private bumpThresholds(sessionId: string, tokens: number): void {
		if (!this.extractor || !this.settings.autoExtract) return;
		if (!this.pendingTokens.has(sessionId)) {
			const row = this.db.prepare("SELECT COALESCE(SUM(tokens), 0) AS t FROM messages WHERE session_id = ? AND extracted = 0 AND status = 'active'").get(sessionId);
			this.pendingTokens.set(sessionId, rowNumber(row, "t") ?? 0);
		} else {
			this.pendingTokens.set(sessionId, (this.pendingTokens.get(sessionId) ?? 0) + tokens);
		}
		if ((this.pendingTokens.get(sessionId) ?? 0) >= this.settings.extractBatchTokens && !this.extractScheduled.has(sessionId)) {
			this.extractScheduled.add(sessionId);
			this.background("extract", async () => {
				this.extractScheduled.delete(sessionId);
				await this.extractPending(sessionId, false);
			});
		}
		if (!this.extractor.observe) return;
		if (!this.unobservedTokens.has(sessionId)) {
			const covers = this.latestLog(sessionId)?.coversUntilSeq ?? 0;
			const row = this.db.prepare("SELECT COALESCE(SUM(tokens), 0) AS t FROM messages WHERE session_id = ? AND seq > ? AND status = 'active'").get(sessionId, covers);
			this.unobservedTokens.set(sessionId, rowNumber(row, "t") ?? 0);
		} else {
			this.unobservedTokens.set(sessionId, (this.unobservedTokens.get(sessionId) ?? 0) + tokens);
		}
		if ((this.unobservedTokens.get(sessionId) ?? 0) >= this.settings.observeTokens && !this.observeScheduled.has(sessionId)) {
			this.observeScheduled.add(sessionId);
			this.background("observe", async () => {
				this.observeScheduled.delete(sessionId);
				await this.observeSession(sessionId, false);
			});
		}
	}

	// ─── recall ──────────────────────────────────────────────────────────────

	async recall(ctx: RecallContext): Promise<RecallResult> {
		this.assertOpen();
		const t0 = performance.now();
		if (!ctx || ctx.domainId !== this.domainId) {
			throw new MemoryError("domain-mismatch", `recall pedido para "${String(ctx?.domainId)}" na memória de "${this.domainId}"`);
		}
		if (typeof ctx.query !== "string") throw new MemoryError("invalid-input", "query ausente");
		const done = (skipped: string): RecallResult => ({ items: [], rendered: "", tokens: 0, ms: performance.now() - t0, skipped });
		const mode = ctx.mode ?? "auto";
		if (mode === "skip") return done("mode=skip");
		if (isTrivialUtterance(ctx.query)) return done("fala sem conteúdo para recuperar");
		const now = Number.isFinite(ctx.now) ? ctx.now : this.now();
		const budget = ctx.budgetTokens ?? (mode === "deep" ? this.settings.deepBudgetTokens : this.settings.recallBudgetTokens);
		const elig: EligibilityOptions = { now, historical: mode === "historical", sessionOnly: ctx.sessionOnly === true, sessionId: ctx.sessionId };
		const focus = Array.isArray(ctx.focusNodes) ? ctx.focusNodes.filter((n) => typeof n === "string") : [];

		const lists: RankedList[] = [];
		const weights = this.settings.channelWeights;
		const push = (channel: RecallChannel, ranked: readonly Scored<string>[]) => {
			if (ranked.length > 0) lists.push({ channel, ids: ranked.map((r) => r.item), scores: ranked.map((r) => r.score), weight: weights[channel] });
		};

		const vec = await this.vecChannel(ctx.query, elig);
		push("vec", vec);
		push("fts", this.ftsChannel(ctx.query, elig));
		push("graph", await this.graphChannel(ctx.query, focus, vec, elig));
		push("time", this.timeChannel(ctx.query, now, elig));
		push("learner", await this.learnerChannel(focus, elig));
		if (lists.length === 0) return { items: [], rendered: "", tokens: 0, ms: performance.now() - t0 };

		// Channels awaited ports (embedder, curriculum, learner); a forget/consolidation on the
		// chain may have run meanwhile. Everything below is synchronous, so re-checking
		// eligibility here is final: no removed or forgotten item can reach the result.
		const fused = (this.settings.fusion === "rsf" ? relativeScoreFusion(lists) : reciprocalRankFusion(lists, this.settings.rrfK)).filter((f) =>
			this.eligibleKey(f.id, elig),
		);
		const prioritized = fused
			.slice(0, Math.max(this.settings.maxCandidates * 3, 60))
			.map((f) => {
				const meta = this.catalog.items.get(f.id) as ItemMeta;
				const base = {
					kind: meta.kind,
					...(meta.factKind ? { factKind: meta.factKind } : {}),
					importance: meta.importance,
					at: meta.at,
					now,
					sameSession: meta.sessionId === ctx.sessionId,
				};
				const superseded = this.catalog.isSuperseded(meta, now);
				// ×0.3 orders a superseded item below its successor; the relative cut is
				// judged before that penalty, otherwise historical mode could never show it.
				const cutScore = f.score * lifePrior({ ...base, superseded: false });
				const score = superseded ? f.score * lifePrior({ ...base, superseded: true }) : cutScore;
				return { key: f.id, score, cutScore, channels: f.channels as RecallChannel[] };
			})
			.sort((a, b) => b.cutScore - a.cutScore || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
		const kept = new Set(relativeCut(prioritized.map((p) => ({ key: p.key, score: p.cutScore })), this.settings.relativeCut, this.settings.maxCandidates).map((p) => p.key));
		const candidates = prioritized
			.filter((p) => kept.has(p.key))
			.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
		const loaded = this.loadItems(candidates.map((c) => c.key), now);
		const channelsOf = new Map(candidates.map((c) => [c.key, c]));
		const ordered = mmrRerank(
			candidates
				.filter((c) => loaded.has(c.key))
				.map((c) => ({
					id: c.key,
					score: c.score,
					vector: this.catalog.vectors.get(c.key) ?? null,
					tokens: new Set(contentTokens((loaded.get(c.key) as LoadedItem).text)),
				})),
			{ lambda: this.settings.mmrLambda },
		);
		const packed = packRecall(
			ordered.map((o) => loaded.get(o.id) as LoadedItem),
			budget,
			now,
		);
		const items: MemoryItem[] = packed.items.map((it) => {
			const c = channelsOf.get(it.key) as { score: number; channels: RecallChannel[] };
			return {
				kind: it.kind,
				id: it.id,
				domainId: this.domainId,
				...(it.sessionId ? { sessionId: it.sessionId } : {}),
				text: it.text,
				at: it.at,
				...(it.validTo !== undefined ? { validTo: it.validTo } : {}),
				...(it.superseded ? { superseded: true } : {}),
				...(it.supersededAt !== undefined ? { supersededAt: it.supersededAt } : {}),
				...(it.factKind ? { factKind: it.factKind } : {}),
				...(it.role ? { role: it.role } : {}),
				...(it.confidence !== undefined ? { confidence: it.confidence } : {}),
				importance: it.importance,
				nodeIds: it.nodeIds,
				score: c.score,
				channels: RECALL_CHANNELS.filter((ch) => c.channels.includes(ch)),
				sourceMsgIds: it.sourceMsgIds,
			};
		});
		const touched = items.filter((i) => i.kind === "fact" || i.kind === "episode");
		if (touched.length > 0) {
			this.background("access", () => {
				this.db.transaction(() => {
					for (const i of touched) {
						const table = i.kind === "fact" ? "facts" : "episodes";
						this.db.prepare(`UPDATE ${table} SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?`).run(now, i.id);
					}
				});
			});
		}
		return { items, rendered: packed.rendered, tokens: packed.tokens, ms: performance.now() - t0 };
	}

	private eligibleKey(key: string, elig: EligibilityOptions): boolean {
		const meta = this.catalog.items.get(key);
		return !!meta && this.catalog.isEligible(meta, elig);
	}

	private async vecChannel(query: string, elig: EligibilityOptions): Promise<Scored<string>[]> {
		if (this.catalog.vectors.size === 0) return [];
		const q = await this.tryEmbed([query], "query");
		const qv = q?.[0];
		if (!qv) return [];
		return this.catalog.vectors.search(qv, this.settings.channelTopK, (key) => this.eligibleKey(key, elig)).filter((s) => s.score > 0);
	}

	private ftsChannel(query: string, elig: EligibilityOptions): Scored<string>[] {
		const match = buildFtsQuery(query);
		if (!match) return [];
		const rows = this.db
			.prepare("SELECT kind, ref_id, bm25(fts) AS score FROM fts WHERE fts MATCH ? ORDER BY score LIMIT ?")
			.all(match, this.settings.channelTopK * 4);
		const out: Scored<string>[] = [];
		for (const r of rows) {
			const key = itemKey(rowString(r, "kind") as MemoryItemKind, rowString(r, "ref_id") as string);
			if (!this.eligibleKey(key, elig)) continue;
			out.push({ item: key, score: -(rowNumber(r, "score") ?? 0) });
			if (out.length >= this.settings.channelTopK) break;
		}
		return out;
	}

	private timeChannel(query: string, now: number, elig: EligibilityOptions): Scored<string>[] {
		const range = parseTimeRange(query, now);
		if (!range) return [];
		const scored: { key: string; score: number; at: number }[] = [];
		for (const meta of this.catalog.items.values()) {
			if (!this.catalog.isEligible(meta, elig)) continue;
			const p = temporalProximity(meta.at, meta.end, range.from, range.to);
			if (p !== null) scored.push({ key: meta.key, score: p, at: meta.at });
		}
		scored.sort((a, b) => b.score - a.score || b.at - a.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
		return scored.slice(0, this.settings.channelTopK).map((s) => ({ item: s.key, score: s.score }));
	}

	private async learnerChannel(focus: readonly string[], elig: EligibilityOptions): Promise<Scored<string>[]> {
		if (!this.learner) return [];
		let weak: readonly { nodeId: string; weakness: number }[];
		try {
			weak = await this.learner.weakNodes(focus);
		} catch (error) {
			this.report("learner", error);
			return [];
		}
		const best = new Map<string, number>();
		for (const w of weak) {
			for (const key of this.catalog.keysForNode(w.nodeId)) {
				const meta = this.catalog.items.get(key);
				if (!meta || meta.kind !== "fact" || !meta.factKind || !LEARNER_CHANNEL_KINDS.has(meta.factKind)) continue;
				if (!this.catalog.isEligible(meta, elig)) continue;
				const s = Math.max(0, Math.min(1, w.weakness)) * meta.confidence;
				if (s > (best.get(key) ?? 0)) best.set(key, s);
			}
		}
		return [...best]
			.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
			.slice(0, this.settings.channelTopK)
			.map(([item, score]) => ({ item, score }));
	}

	private matchEntityIds(query: string): string[] {
		const tokens = contentTokens(query);
		const grams = new Set<string>();
		tokens.forEach((t, i) => {
			grams.add(canonicalEntity(t));
			if (i + 1 < tokens.length) grams.add(canonicalEntity(`${t} ${tokens[i + 1] as string}`));
		});
		const keys = [...grams].filter(Boolean);
		if (keys.length === 0) return [];
		return this.db
			.prepare(`SELECT id FROM entities WHERE canonical IN (${placeholders(keys.length)})`)
			.all(...keys)
			.map((r) => rowString(r, "id") as string);
	}

	private async graphChannel(query: string, focus: readonly string[], vecTop: readonly Scored<string>[], elig: EligibilityOptions): Promise<Scored<string>[]> {
		const seeds = new Map<string, number>();
		for (const n of focus) seeds.set(`node:${n}`, 1);
		let curriculumNeighbors: readonly string[] = [];
		try {
			if (this.curriculum?.matchNodes) for (const n of await this.curriculum.matchNodes(query)) seeds.set(`node:${n}`, 1);
			if (this.curriculum && focus.length > 0) curriculumNeighbors = await this.curriculum.neighbors(focus);
		} catch (error) {
			this.report("curriculum", error);
		}
		for (const e of this.matchEntityIds(query)) seeds.set(`entity:${e}`, 1);
		for (const s of vecTop.slice(0, 5)) if (s.score > 0) seeds.set(s.item, Math.max(seeds.get(s.item) ?? 0, s.score));
		if (seeds.size === 0) return [];
		const focusSet = new Set(focus);
		const activation = spreadActivation(seeds, (key) => this.graphNeighbors(key, focusSet, curriculumNeighbors));
		const out: { key: string; score: number; at: number }[] = [];
		for (const [key, score] of activation) {
			if (key.startsWith("node:") || key.startsWith("entity:")) continue;
			const meta = this.catalog.items.get(key);
			if (!meta || !this.catalog.isEligible(meta, elig)) continue;
			out.push({ key, score, at: meta.at });
		}
		out.sort((a, b) => b.score - a.score || b.at - a.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
		return out.slice(0, this.settings.channelTopK).map((o) => ({ item: o.key, score: o.score }));
	}

	private graphNeighbors(key: string, focus: ReadonlySet<string>, curriculumNeighbors: readonly string[]): GraphEdge[] {
		const sep = key.indexOf(":");
		const type = key.slice(0, sep);
		const id = key.slice(sep + 1);
		const edges: GraphEdge[] = [];
		if (type === "node") {
			if (focus.has(id)) for (const n of curriculumNeighbors) if (n !== id) edges.push({ to: `node:${n}`, rel: "curriculum", weight: 1 });
			const linked = [...this.catalog.keysForNode(id)]
				.map((k) => this.catalog.items.get(k) as ItemMeta)
				.sort((a, b) => b.at - a.at)
				.slice(0, NODE_FANOUT);
			for (const m of linked) edges.push({ to: m.key, rel: "about", weight: 1 });
			return edges;
		}
		if (type === "entity") {
			for (const r of this.db.prepare("SELECT src_id, weight FROM edges WHERE dst_type = 'entity' AND dst_id = ? AND rel = 'mentions' AND src_type = 'fact'").all(id)) {
				edges.push({ to: `fact:${rowString(r, "src_id") as string}`, rel: "mentions", weight: rowNumber(r, "weight") ?? 1 });
			}
			const node = rowString(this.db.prepare("SELECT node_id FROM entities WHERE id = ?").get(id), "node_id");
			if (node) edges.push({ to: `node:${node}`, rel: "about", weight: 1 });
			return edges;
		}
		const meta = this.catalog.items.get(key);
		if (meta) for (const n of meta.nodeIds) edges.push({ to: `node:${n}`, rel: "about", weight: 1 });
		if (type === "fact" || type === "episode" || type === "observation") {
			for (const r of this.db.prepare("SELECT dst_type, dst_id, rel, weight FROM edges WHERE src_type = ? AND src_id = ? AND rel <> 'about'").all(type, id)) {
				edges.push({ to: `${rowString(r, "dst_type") as string}:${rowString(r, "dst_id") as string}`, rel: rowString(r, "rel") as EdgeRel, weight: rowNumber(r, "weight") ?? 1 });
			}
			for (const r of this.db
				.prepare("SELECT src_type, src_id, rel, weight FROM edges WHERE dst_type = ? AND dst_id = ? AND src_type IN ('fact','episode','observation')")
				.all(type, id)) {
				edges.push({ to: `${rowString(r, "src_type") as string}:${rowString(r, "src_id") as string}`, rel: rowString(r, "rel") as EdgeRel, weight: rowNumber(r, "weight") ?? 1 });
			}
		}
		return edges;
	}

	private loadItems(keys: readonly string[], now: number): Map<string, LoadedItem> {
		const out = new Map<string, LoadedItem>();
		const byKind = new Map<MemoryItemKind, string[]>();
		for (const key of keys) {
			const { kind, id } = parseItemKey(key);
			byKind.set(kind, [...(byKind.get(kind) ?? []), id]);
		}
		const select = (table: string, ids: string[]) => this.db.prepare(`SELECT * FROM ${table} WHERE id IN (${placeholders(ids.length)})`).all(...ids);
		for (const [kind, ids] of byKind) {
			if (kind === "message") {
				for (const m of select("messages", ids).map(toMessage)) {
					out.set(itemKey("message", m.id), { key: itemKey("message", m.id), kind, id: m.id, text: m.text, at: m.ts, role: m.role, sessionId: m.sessionId, nodeIds: m.nodeIds, sourceMsgIds: [m.id], importance: DEFAULT_IMPORTANCE });
				}
			} else if (kind === "episode") {
				for (const e of select("episodes", ids).map(toEpisode)) {
					out.set(itemKey("episode", e.id), {
						key: itemKey("episode", e.id),
						kind,
						id: e.id,
						text: `${e.title}: ${e.narrative}`,
						at: e.tStart,
						sessionId: e.sessionId,
						nodeIds: e.nodeIds,
						sourceMsgIds: [...new Set([e.firstMsgId, e.lastMsgId])],
						importance: e.importance,
					});
				}
			} else if (kind === "fact") {
				for (const f of select("facts", ids).map(toFact)) {
					const superseded = !isCurrentFact(f, now);
					out.set(itemKey("fact", f.id), {
						key: itemKey("fact", f.id),
						kind,
						id: f.id,
						text: f.text,
						at: f.validFrom ?? f.recordedAt,
						factKind: f.kind,
						...(f.validTo !== null ? { validTo: f.validTo } : {}),
						...(superseded ? { superseded: true } : {}),
						...(superseded && (f.expiredAt ?? f.validTo) !== null ? { supersededAt: (f.expiredAt ?? f.validTo) as number } : {}),
						confidence: f.confidence,
						...(f.quote ? { quote: f.quote } : {}),
						sessionId: f.sessionId,
						nodeIds: f.nodeIds,
						sourceMsgIds: f.sourceMsgIds,
						importance: f.importance,
					});
				}
			} else {
				for (const o of select("observations", ids).map(toObservation)) {
					out.set(itemKey("observation", o.id), {
						key: itemKey("observation", o.id),
						kind,
						id: o.id,
						text: o.text,
						at: o.updatedAt,
						...(o.endedAt !== null ? { superseded: true, supersededAt: o.endedAt } : {}),
						confidence: o.confidence,
						sessionId: null,
						nodeIds: o.subjectType === "node" ? [o.subjectId] : [],
						sourceMsgIds: [],
						importance: 0.6,
					});
				}
			}
		}
		return out;
	}

	// ─── stable prefix ───────────────────────────────────────────────────────

	private async stableParts(sessionId: string, focusOverride?: readonly string[]): Promise<{ profile: string; mentalModels: string; learner: string; observationLog: string }> {
		const now = this.now();
		let profile = "";
		try {
			profile = this.profile ? await this.profile.text(this.domainId) : "";
		} catch (error) {
			this.report("profile", error);
		}
		const diary = this.latestDiary(sessionId);
		const titleTokens = estimateTokens("## Modelo do aluno neste domínio");
		const mentalModels = composeMentalModelSection(diary, this.mentalModel(), now, CONTEXT_BUDGETS.mentalModels - titleTokens);
		const focus = focusOverride && focusOverride.length > 0 ? [...focusOverride] : this.focusOf(sessionId);
		let learner = "";
		if (this.learner) {
			try {
				learner = renderLearnerSnapshot(await this.learner.promptSnapshot(focus));
			} catch (error) {
				this.report("learner", error);
			}
		}
		return { profile, mentalModels, learner, observationLog: this.latestLog(sessionId)?.text ?? "" };
	}

	async stablePrefix(sessionId: string): Promise<{ text: string; tokens: number }> {
		this.assertOpen();
		const ctx = assembleContext(await this.stableParts(sessionId));
		return { text: ctx.stable, tokens: ctx.stableTokens };
	}

	/** Full per-turn memory context: stable prefix + cache boundary + recall (≤ 12k tokens). */
	async buildContext(ctx: RecallContext): Promise<{ context: AssembledContext; recall: RecallResult }> {
		this.assertOpen();
		const parts = await this.stableParts(ctx.sessionId, ctx.focusNodes);
		const recall = await this.recall(ctx);
		const budgets = { ...CONTEXT_BUDGETS, recall: Math.max(CONTEXT_BUDGETS.recall, recall.tokens) };
		return { context: assembleContext({ ...parts, recall: recall.rendered }, budgets), recall };
	}

	// ─── session end: extraction → observe → consolidate → diary ────────────

	/** True when this domain's file has a session with that id (the service routes endSession by it). */
	hasSession(sessionId: string): boolean {
		this.assertOpen();
		return !!this.db.prepare("SELECT 1 AS x FROM sessions WHERE id = ?").get(sessionId);
	}

	/** Process durable pending work after a turn; diary and closure belong to endSession. */
	finishTurn(sessionId: string): Promise<void> {
		return this.schedule("finishTurn", async () => {
			if (!this.hasSession(sessionId)) return;
			await this.extractPending(sessionId, true);
			await this.consolidateNow({});
		});
	}

	/**
	 * Best-effort pipeline: a failing step (embedder offline, extractor or
	 * consolidator returning garbage) never prevents the later steps, so the
	 * diary hand-off ("Retomada") and `ended_at` are always written. The first
	 * failure is re-thrown afterwards (the L0 log and pending facts stay intact
	 * for the next attempt); further failures go to `onError`.
	 */
	endSession(sessionId: string): Promise<void> {
		return this.schedule("endSession", async () => {
			if (!this.hasSession(sessionId)) throw new MemoryError("invalid-input", `sessão desconhecida: ${sessionId}`);
			const failures: unknown[] = [];
			const step = async (op: string, fn: () => Promise<void>) => {
				try {
					await fn();
				} catch (error) {
					if (failures.length > 0) this.report(op, error);
					failures.push(error);
				}
			};
			await step("embed", () => this.drainEmbeddings());
			await step("extract", () => this.extractPending(sessionId, true));
			await step("observe", () => this.observeSession(sessionId, true));
			await step("consolidate", () => this.consolidateNow({}));
			await step("diary", () => this.writeDiary(sessionId));
			this.db.prepare("UPDATE sessions SET ended_at = ? WHERE id = ?").run(this.now(), sessionId);
			if (failures.length > 0) throw failures[0];
		});
	}

	private async extractPending(sessionId: string, force: boolean): Promise<void> {
		if (!this.extractor) return;
		const rows = this.db
			.prepare("SELECT * FROM messages WHERE session_id = ? AND extracted = 0 AND status = 'active' ORDER BY seq")
			.all(sessionId)
			.map(toMessage);
		const total = rows.reduce((n, m) => n + m.tokens, 0);
		if (rows.length === 0 || (!force && total < this.settings.extractBatchTokens)) {
			this.pendingTokens.delete(sessionId); // the in-memory counter overshot (stale); recount on the next turn
			return;
		}
		const batches: MessageRecord[][] = [];
		let current: MessageRecord[] = [];
		let used = 0;
		for (const m of rows) {
			if (current.length > 0 && used + m.tokens > this.settings.extractBatchTokens) {
				batches.push(current);
				current = [];
				used = 0;
			}
			current.push(m);
			used += m.tokens;
		}
		if (current.length > 0) batches.push(current);
		for (const batch of batches) await this.extractBatch(sessionId, batch);
		// Not `set(0)`: turns ingested while the extractor was awaited are still pending.
		// Dropping the counter makes the next ingest recount them from the file.
		this.pendingTokens.delete(sessionId);
	}

	private sessionStart(sessionId: string): number {
		return rowNumber(this.db.prepare("SELECT started_at FROM sessions WHERE id = ?").get(sessionId), "started_at") ?? this.now();
	}

	private async extractBatch(sessionId: string, batch: MessageRecord[]): Promise<void> {
		const extractor = this.extractor as Extractor;
		const now = this.now();
		const messages = batch.map(toSource);
		const out = await extractor.extract({
			domainId: this.domainId,
			sessionId,
			now,
			sessionStartedAt: this.sessionStart(sessionId),
			focusNodes: this.focusOf(sessionId),
			messages,
		});
		this.recordUsage(out.usage);
		const v = validateExtraction(out, { domainId: this.domainId, sessionId, messages });
		const factIds = v.facts.map(() => newId("fact", now));
		const vectors = await this.tryEmbed(v.facts.map((f) => factPassage(f.text, f.validFrom)), "passage");
		const entityNodes = await this.resolveEntityNodes(v.facts);
		const plans = await this.planSupersession(v.facts, factIds, vectors, now);
		const seqOf = new Map(batch.map((m) => [m.id, m.seq]));
		const newEpisodeKeys: string[] = [];
		const insertedFacts: string[] = [];
		const closed: { id: string; validTo: number; expiredAt: number }[] = [];

		this.db.transaction(() => {
			const episodeRanges: { id: string; lo: number; hi: number }[] = [];
			for (const ep of v.episodes) {
				const id = newId("ep", now);
				const text = `${ep.title}. ${ep.narrative}`;
				const fts = this.db.prepare("INSERT INTO fts(kind, ref_id, text) VALUES ('episode', ?, ?)").run(id, text);
				this.db
					.prepare(
						"INSERT INTO episodes(id, session_id, first_msg_id, last_msg_id, t_start, t_end, title, narrative, node_ids_json, importance, fts_rowid, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
					)
					.run(id, sessionId, ep.firstMsgId, ep.lastMsgId, ep.tStart, ep.tEnd, ep.title, ep.narrative, JSON.stringify(ep.nodeIds), ep.importance, fts.lastInsertRowid, now);
				episodeRanges.push({ id, lo: seqOf.get(ep.firstMsgId) ?? 0, hi: seqOf.get(ep.lastMsgId) ?? 0 });
				newEpisodeKeys.push(itemKey("episode", id));
				this.audit("insert", "episode", id, null, JSON.stringify({ title: ep.title }), "extractor");
			}

			v.facts.forEach((f, i) => {
				const plan = plans[i] as SupersessionPlan;
				if (plan.duplicateOf) {
					const before = rowJson(this.db.prepare("SELECT proof_count, source_msg_ids_json FROM facts WHERE id = ?").get(plan.duplicateOf.id));
					this.db
						.prepare("UPDATE facts SET proof_count = ?, source_msg_ids_json = ? WHERE id = ?")
						.run(plan.duplicateOf.proofCount, JSON.stringify(plan.duplicateOf.sourceMsgIds), plan.duplicateOf.id);
					// No new-fact text here: it derives from the new messages, which a later hard
					// forget may delete while this (older) fact survives.
					this.audit("duplicate", "fact", plan.duplicateOf.id, before, JSON.stringify({ proofCount: plan.duplicateOf.proofCount, sourceMsgIds: f.sourceMsgIds }), "judge");
					return;
				}
				const id = factIds[i] as string;
				const firstSeq = Math.min(...f.sourceMsgIds.map((m) => seqOf.get(m) ?? Number.POSITIVE_INFINITY));
				const episode = episodeRanges.find((r) => firstSeq >= r.lo && firstSeq <= r.hi)?.id ?? null;
				const fts = this.db.prepare("INSERT INTO fts(kind, ref_id, text) VALUES ('fact', ?, ?)").run(id, f.text);
				this.db
					.prepare(
						`INSERT INTO facts(id, session_id, kind, scope, text, about_node, node_ids_json, valid_from, valid_to, recorded_at, confidence,
							source_episode_id, source_msg_ids_json, quote, grounded, importance, fts_rowid) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
					)
					.run(
						id,
						sessionId,
						f.kind,
						f.scope,
						f.text,
						f.aboutNode,
						JSON.stringify(f.nodeIds),
						f.validFrom,
						f.validTo,
						now,
						f.confidence,
						episode,
						JSON.stringify(f.sourceMsgIds),
						f.quote,
						f.importance,
						fts.lastInsertRowid,
					);
				insertedFacts.push(id);
				const vec = vectors?.[i];
				if (vec) {
					this.db
						.prepare("INSERT OR REPLACE INTO embeddings(item_kind, item_id, model_id, dim, vec) VALUES ('fact', ?, ?, ?, ?)")
						.run(id, this.embedder.id, this.embedder.dim, encodeVector(vec));
				}
				const edge = this.db.prepare(
					"INSERT OR IGNORE INTO edges(src_type, src_id, dst_type, dst_id, rel, weight, recorded_at) VALUES (?,?,?,?,?,?,?)",
				);
				for (const n of f.nodeIds) edge.run("fact", id, "node", n, "about", 1, now);
				for (const e of f.entities) {
					const entityId = this.upsertEntity(e.name, e.canonical, e.type, entityNodes.get(`${e.canonical}|${e.type}`) ?? null, now);
					edge.run("fact", id, "entity", entityId, "mentions", 1, now);
				}
				if (episode) edge.run("episode", episode, "fact", id, "evidence_for", 1, now);
				for (let j = Math.max(0, insertedFacts.length - 4); j < insertedFacts.length - 1; j++) {
					const prevIndex = factIds.indexOf(insertedFacts[j] as string);
					const prev = v.facts[prevIndex] as GroundedFact;
					edge.run("fact", id, "fact", insertedFacts[j] as string, "temporal", temporalEdgeWeight(f.validFrom - prev.validFrom), now);
				}
				for (const s of plan.semantic) edge.run("fact", id, "fact", s.id, "semantic", Math.max(0, Math.min(1, s.cos)), now);
				for (const c of plan.closes) {
					const res = this.db
						.prepare("UPDATE facts SET valid_to = ?, expired_at = ?, superseded_by = ? WHERE id = ? AND expired_at IS NULL")
						.run(c.validTo, c.expiredAt, id, c.closeId);
					if (res.changes === 0) continue;
					edge.run("fact", id, "fact", c.closeId, "supersedes", 1, now);
					this.audit(
						"supersede",
						"fact",
						c.closeId,
						JSON.stringify({ validTo: c.before.validTo, expiredAt: c.before.expiredAt, supersededBy: c.before.supersededBy }),
						JSON.stringify({ validTo: c.validTo, expiredAt: c.expiredAt, supersededBy: id }),
						"judge",
					);
					closed.push({ id: c.closeId, validTo: c.validTo, expiredAt: c.expiredAt });
				}
				for (const old of plan.refines) edge.run("fact", id, "fact", old, "refines", 1, now);
			});

			if (v.evidence.length > 0) {
				let seq = rowNumber(this.db.prepare("SELECT COALESCE(MAX(seq), 0) AS s FROM evidence").get(), "s") ?? 0;
				for (const ev of v.evidence) {
					seq += 1;
					this.db
						.prepare("INSERT INTO evidence(id, seq, at, session_id, payload_json, source, source_msg_ids_json) VALUES (?,?,?,?,?,'dialogue_extractor',?)")
						.run(newId("ev", now), seq, ev.at, sessionId, JSON.stringify(ev), JSON.stringify(ev.sourceMsgIds));
				}
			}
			for (const c of v.flashcards) {
				this.db
					.prepare("INSERT INTO flashcard_candidates(id, session_id, node_id, front, back, source_msg_ids_json, created_at) VALUES (?,?,?,?,?,?,?)")
					.run(newId("card", now), sessionId, c.nodeId, c.front, c.back, JSON.stringify(c.sourceMsgIds), now);
			}
			for (const r of v.rejected) {
				// Keyed by session (`<sessionId>#…`): a hard forget touching the session scrubs the text.
				this.audit("reject", r.kind, rejectAuditId(sessionId, batch, r.index), null, JSON.stringify({ reason: r.reason, text: r.text }), "extractor");
			}
			const ids = batch.map((m) => m.id);
			for (const part of chunk(ids, 500)) this.db.prepare(`UPDATE messages SET extracted = 1 WHERE id IN (${placeholders(part.length)})`).run(...part);
		});

		for (const key of newEpisodeKeys) {
			const { id } = parseItemKey(key);
			const e = toEpisode(this.db.prepare("SELECT * FROM episodes WHERE id = ?").get(id) as SqlRow);
			this.catalog.upsert({ key, kind: "episode", id, sessionId, at: e.tStart, end: e.tEnd, status: "active", validTo: null, expiredAt: null, endedAt: null, importance: e.importance, confidence: 1, nodeIds: e.nodeIds, tokens: 0 });
			this.pendingEmbed.add(key);
		}
		for (const id of insertedFacts) {
			const row = this.db.prepare("SELECT * FROM facts WHERE id = ?").get(id) as SqlRow;
			this.catalog.upsert(factMetaFromRow(row));
			const vec = vectors?.[factIds.indexOf(id)];
			if (vec) this.catalog.vectors.set(itemKey("fact", id), vec);
			else this.pendingEmbed.add(itemKey("fact", id));
		}
		for (const c of closed) this.catalog.patch(itemKey("fact", c.id), { validTo: c.validTo, expiredAt: c.expiredAt });
		this.scheduleEmbedding();
		if (v.evidence.length > 0 && this.learner?.appendEvidence) {
			try {
				await this.learner.appendEvidence(v.evidence);
			} catch (error) {
				this.report("learner-evidence", error);
			}
		}
	}

	private upsertEntity(name: string, canonical: string, type: string, nodeId: string | null, now: number): string {
		const existing = this.db.prepare("SELECT id, node_id FROM entities WHERE canonical = ? AND type = ?").get(canonical, type);
		if (existing) {
			const id = rowString(existing, "id") as string;
			this.db.prepare("UPDATE entities SET updated_at = ?, node_id = COALESCE(node_id, ?) WHERE id = ?").run(now, nodeId, id);
			return id;
		}
		const id = newId("ent", now);
		this.db.prepare("INSERT INTO entities(id, name, canonical, type, node_id, updated_at) VALUES (?,?,?,?,?,?)").run(id, name, canonical, type, nodeId, now);
		return id;
	}

	private async resolveEntityNodes(facts: readonly GroundedFact[]): Promise<Map<string, string | null>> {
		const out = new Map<string, string | null>();
		if (!this.curriculum?.matchNodes) return out;
		for (const f of facts) {
			for (const e of f.entities) {
				const key = `${e.canonical}|${e.type}`;
				if (out.has(key)) continue;
				try {
					const nodes = await this.curriculum.matchNodes(e.name);
					out.set(key, nodes[0] ?? null);
				} catch (error) {
					this.report("curriculum", error);
					out.set(key, null);
				}
			}
		}
		return out;
	}

	private entityKeysOfFact(factId: string): string[] {
		return this.db
			.prepare("SELECT e.canonical AS c FROM edges ed JOIN entities e ON e.id = ed.dst_id WHERE ed.src_type = 'fact' AND ed.src_id = ? AND ed.rel = 'mentions' AND ed.dst_type = 'entity'")
			.all(factId)
			.map((r) => rowString(r, "c") as string);
	}

	/**
	 * Candidate search (cos ≥ 0.75, same kind, shared node/entity, top 8) and
	 * one batched judge call (r4 §7.6.2-4). Without vectors or a judge the
	 * batch is ADD-only (r4 fallback; consolidation dedups later).
	 */
	private async planSupersession(facts: readonly GroundedFact[], ids: readonly string[], vectors: Float32Array[] | null, now: number): Promise<SupersessionPlan[]> {
		const plans: SupersessionPlan[] = facts.map(() => ({ duplicateOf: null, closes: [], refines: [], semantic: [] }));
		if (!vectors || facts.length === 0) return plans;
		const currentFacts = [...this.catalog.items.values()].filter(
			(m) => m.kind === "fact" && isCurrentFact({ status: m.status, expiredAt: m.expiredAt, validTo: m.validTo }, now) && this.catalog.vectors.has(m.key),
		);
		const records = new Map<string, FactRecord>();
		const recordOf = (id: string) => {
			let r = records.get(id);
			if (!r) {
				r = toFact(this.db.prepare("SELECT * FROM facts WHERE id = ?").get(id) as SqlRow);
				records.set(id, r);
			}
			return r;
		};
		const pairs: { pairId: string; i: number; old: FactRecord }[] = [];
		facts.forEach((f, i) => {
			const vec = vectors[i] as Float32Array;
			const sims = currentFacts.map((m) => ({ meta: m, cos: cosine(vec, this.catalog.vectors.get(m.key) as Float32Array) }));
			const plan = plans[i] as SupersessionPlan;
			plan.semantic = sims
				.filter((s) => s.cos >= this.settings.semanticEdgeMinCosine)
				.sort((a, b) => b.cos - a.cos)
				.slice(0, 5)
				.map((s) => ({ id: s.meta.id, cos: s.cos }));
			const close = sims.filter((s) => s.meta.factKind === f.kind && s.cos >= this.settings.supersedeMinCosine);
			const candidates: SupersessionCandidate[] = close.map((s) => ({
				fact: recordOf(s.meta.id),
				cosine: s.cos,
				nodeIds: s.meta.nodeIds,
				entityKeys: this.entityKeysOfFact(s.meta.id),
			}));
			const picked = pickSupersessionCandidates(
				{ id: ids[i] as string, kind: f.kind, nodeIds: f.nodeIds, entityKeys: f.entities.map((e) => e.canonical) },
				candidates,
				{ minCosine: this.settings.supersedeMinCosine, topK: this.settings.supersedeTopK, now },
			);
			picked.forEach((c, j) => pairs.push({ pairId: `p${i}.${j}`, i, old: recordOf(c.fact.id) }));
		});
		if (pairs.length === 0 || !this.extractor?.judge) return plans;
		// A configured judge can be deferred by its model budget. Let the
		// failure propagate before the extraction transaction marks the source done.
		const out = await this.extractor.judge({
			now,
			pairs: pairs.map((p) => {
				const f = facts[p.i] as GroundedFact;
				return {
					pairId: p.pairId,
					newFact: { id: ids[p.i] as string, kind: f.kind, text: f.text, validFrom: f.validFrom, recordedAt: now },
					oldFact: { id: p.old.id, kind: p.old.kind, text: p.old.text, validFrom: p.old.validFrom, recordedAt: p.old.recordedAt },
				};
			}),
		});
		this.recordUsage(out.usage);
		const verdicts = new Map(out.verdicts.map((v) => [v.pairId, v.verdict]));
		const closedIds = new Set<string>();
		facts.forEach((f, i) => {
			const plan = plans[i] as SupersessionPlan;
			const mine = pairs.filter((p) => p.i === i);
			const newFact = { id: ids[i] as string, validFrom: f.validFrom, proofCount: 1, sourceMsgIds: f.sourceMsgIds };
			const dup = mine.find((p) => verdicts.get(p.pairId) === "DUPLICATE");
			if (dup) {
				const effect = resolveSupersession(dup.old, newFact, "DUPLICATE", now);
				if (effect.type === "duplicate") {
					plan.duplicateOf = { id: effect.keepId, proofCount: effect.proofCount, sourceMsgIds: effect.sourceMsgIds };
					dup.old.proofCount = effect.proofCount;
					dup.old.sourceMsgIds = effect.sourceMsgIds;
					return;
				}
			}
			for (const p of mine) {
				const effect = resolveSupersession(p.old, newFact, verdicts.get(p.pairId) ?? "INDEPENDENT", now);
				if (effect.type === "close" && !closedIds.has(effect.closeId)) {
					closedIds.add(effect.closeId);
					plan.closes.push({ closeId: effect.closeId, validTo: effect.validTo, expiredAt: effect.expiredAt, before: p.old });
				} else if (effect.type === "refine") {
					plan.refines.push(effect.dstId);
				}
			}
			plan.semantic = plan.semantic.filter((s) => !closedIds.has(s.id));
		});
		return plans;
	}

	// ─── working memory (observation log) ───────────────────────────────────

	private latestLog(sessionId: string): { generation: number; text: string; coversUntilSeq: number } | null {
		const row = this.db.prepare("SELECT generation, text, covers_until_seq FROM observation_log WHERE session_id = ? ORDER BY generation DESC LIMIT 1").get(sessionId);
		if (!row) return null;
		return { generation: rowNumber(row, "generation") as number, text: rowString(row, "text") as string, coversUntilSeq: rowNumber(row, "covers_until_seq") as number };
	}

	/** The session's working-memory log (latest generation), or "" when none. */
	observationLog(sessionId: string): string {
		this.assertOpen();
		return this.latestLog(sessionId)?.text ?? "";
	}

	private async observeSession(sessionId: string, final: boolean): Promise<void> {
		if (!this.extractor?.observe) return;
		const latest = this.latestLog(sessionId);
		const msgs = this.db
			.prepare("SELECT * FROM messages WHERE session_id = ? AND seq > ? AND status = 'active' ORDER BY seq")
			.all(sessionId, latest?.coversUntilSeq ?? 0)
			.map(toMessage);
		const tokens = msgs.reduce((n, m) => n + m.tokens, 0);
		if (msgs.length === 0 || (!final && tokens < this.settings.observeTokens)) {
			this.unobservedTokens.delete(sessionId);
			return;
		}
		const now = this.now();
		const currentLog = latest?.text ?? "";
		const out = await this.extractor.observe({
			sessionId,
			now,
			currentLog,
			messages: msgs.map(toSource),
			reflect: estimateTokens(currentLog) > this.settings.reflectTokens,
		});
		this.recordUsage(out.usage);
		const text = out.log.trim();
		if (!text) throw new MemoryError("llm-output-invalid", "observador devolveu log vazio");
		this.db
			.prepare("INSERT INTO observation_log(session_id, generation, text, tokens, covers_until_seq, created_at) VALUES (?,?,?,?,?,?)")
			.run(sessionId, (latest?.generation ?? 0) + 1, text, estimateTokens(text), (msgs[msgs.length - 1] as MessageRecord).seq, now);
		this.unobservedTokens.delete(sessionId); // recounted from covers_until_seq (turns may have arrived meanwhile)
	}

	// ─── consolidation ───────────────────────────────────────────────────────

	consolidate(opts: { budgetTokens?: number } = {}): Promise<void> {
		return this.schedule("consolidate", () => this.consolidateNow(opts));
	}

	private async consolidateNow(opts: { budgetTokens?: number }): Promise<void> {
		const now = this.now();
		this.dedupFacts(now);
		this.archiveStale(now);
		const extractor = this.extractor;
		if (!extractor?.consolidate) return;
		const pending = this.db
			.prepare("SELECT * FROM facts WHERE consolidated = 0 AND status = 'active' AND expired_at IS NULL ORDER BY recorded_at, id")
			.all()
			.map(toFact)
			.filter((f) => isCurrentFact(f, now));
		if (pending.length === 0) return;
		const budget = opts.budgetTokens ?? this.settings.consolidateBudgetTokens;
		const selected: FactRecord[] = [];
		let used = 0;
		for (const f of pending) {
			const cost = estimateTokens(f.text) + 24;
			if (selected.length > 0 && used + cost > budget) break;
			selected.push(f);
			used += cost;
		}
		const nodes = [...new Set(selected.flatMap((f) => f.nodeIds))];
		const obsRows = this.db
			.prepare(
				`SELECT * FROM observations WHERE status = 'active' AND ended_at IS NULL AND (subject_type = 'learner'${
					nodes.length > 0 ? ` OR (subject_type = 'node' AND subject_id IN (${placeholders(nodes.length)}))` : ""
				}) ORDER BY updated_at DESC LIMIT 80`,
			)
			.all(...nodes)
			.map(toObservation);
		let learnerSnapshot = null;
		if (this.learner) {
			try {
				learnerSnapshot = await this.learner.promptSnapshot(nodes);
			} catch (error) {
				this.report("learner", error);
			}
		}
		const entries = this.mentalModel();
		const input: ConsolidationInput = {
			domainId: this.domainId,
			now,
			facts: selected.map((f) => ({
				id: f.id,
				kind: f.kind,
				text: f.text,
				nodeIds: f.nodeIds,
				validFrom: f.validFrom,
				recordedAt: f.recordedAt,
				confidence: f.confidence,
				proofCount: f.proofCount,
			})),
			observations: obsRows.map((o) => ({ id: o.id, subjectType: o.subjectType, subjectId: o.subjectId, text: o.text, proofCount: o.proofCount, updatedAt: o.updatedAt })),
			mentalModel: entries,
			sections: MENTAL_MODEL_SECTIONS,
			learner: learnerSnapshot,
		};
		const out = await extractor.consolidate(input);
		this.recordUsage(out.usage);

		const factById = new Map(selected.map((f) => [f.id, f]));
		const obsById = new Map(obsRows.map((o) => [o.id, o]));
		const actions: { action: ObservationAction; evidence: string[]; newId?: string }[] = [];
		const dropped: string[] = [];
		for (const action of out.observations) {
			const evidence = [...new Set(action.evidenceFactIds.filter((id) => factById.has(id)))];
			if (evidence.length === 0) {
				dropped.push(`${action.op}: sem evidência válida`);
				continue;
			}
			if (action.op === "create") {
				const text = action.text?.trim() ?? "";
				if (!text || text.length > MAX_OBSERVATION_CHARS || !action.subjectId?.trim()) {
					dropped.push("create: texto ou sujeito inválido");
					continue;
				}
				actions.push({ action: { ...action, text }, evidence, newId: newId("obs", now) });
				continue;
			}
			if (!obsById.has(action.observationId)) {
				dropped.push(`${action.op}: observação desconhecida ${action.observationId}`);
				continue;
			}
			if (action.op === "change" && (!action.text?.trim() || action.text.trim().length > MAX_OBSERVATION_CHARS)) {
				dropped.push("change: texto inválido");
				continue;
			}
			actions.push({ action, evidence });
		}
		const createdObs = new Set(actions.map((a) => a.newId).filter((id): id is string => !!id));
		const applied = applyMentalModelOps(entries, out.mentalModelOps, {
			now,
			allowedSections: MENTAL_MODEL_SECTIONS,
			isValidRef: (ref) => this.refExists(ref, createdObs),
		});
		if (!applied.ok) {
			this.audit("ops-rejected", "mental_model", this.domainId, null, JSON.stringify(applied.errors), "consolidator");
			throw new MemoryError("ops-invalid", `lote de ops do modelo mental rejeitado: ${applied.errors.map((e) => `#${e.index} ${e.message}`).join("; ")}`);
		}

		const touchedObs: string[] = [];
		this.db.transaction(() => {
			for (const d of dropped) this.audit("drop-action", "observation", this.domainId, null, JSON.stringify({ reason: d }), "consolidator");
			const edge = this.db.prepare("INSERT OR IGNORE INTO edges(src_type, src_id, dst_type, dst_id, rel, weight, recorded_at) VALUES ('fact',?,'observation',?,'evidence_for',1,?)");
			for (const { action, evidence, newId: createdId } of actions) {
				if (action.op === "create") {
					const id = createdId as string;
					const quotes = evidence.map((fid) => factById.get(fid)?.quote).filter((q): q is string => !!q);
					const fts = this.db.prepare("INSERT INTO fts(kind, ref_id, text) VALUES ('observation', ?, ?)").run(id, action.text);
					this.db
						.prepare(
							"INSERT INTO observations(id, subject_type, subject_id, text, evidence_fact_ids_json, quotes_json, proof_count, created_at, updated_at, fts_rowid) VALUES (?,?,?,?,?,?,?,?,?,?)",
						)
						.run(id, action.subjectType, action.subjectId.trim(), action.text, JSON.stringify(evidence), JSON.stringify(quotes), evidence.length, now, now, fts.lastInsertRowid);
					for (const fid of evidence) edge.run(fid, id, now);
					this.audit("create", "observation", id, null, JSON.stringify({ text: action.text }), "consolidator");
					touchedObs.push(id);
					continue;
				}
				const cur = obsById.get(action.observationId) as ObservationRecord;
				const fresh = toObservation(this.db.prepare("SELECT * FROM observations WHERE id = ?").get(cur.id) as SqlRow);
				const allEvidence = [...new Set([...fresh.evidenceFactIds, ...evidence])];
				const proof = fresh.proofCount + evidence.filter((e) => !fresh.evidenceFactIds.includes(e)).length;
				if (action.op === "repeat") {
					this.db
						.prepare("UPDATE observations SET proof_count = ?, evidence_fact_ids_json = ?, updated_at = ? WHERE id = ?")
						.run(Math.max(fresh.proofCount, proof), JSON.stringify(allEvidence), now, cur.id);
				} else if (action.op === "change") {
					const text = action.text.trim();
					const history = [...fresh.history, { at: fresh.updatedAt, text: fresh.text }];
					if (fresh.ftsRowid !== null) this.db.prepare("DELETE FROM fts WHERE rowid = ?").run(fresh.ftsRowid);
					const fts = this.db.prepare("INSERT INTO fts(kind, ref_id, text) VALUES ('observation', ?, ?)").run(cur.id, text);
					this.db
						.prepare(
							"UPDATE observations SET text = ?, history_json = ?, version = version + 1, proof_count = ?, evidence_fact_ids_json = ?, updated_at = ?, fts_rowid = ? WHERE id = ?",
						)
						.run(text, JSON.stringify(history), Math.max(fresh.proofCount, proof), JSON.stringify(allEvidence), now, fts.lastInsertRowid, cur.id);
				} else {
					this.db
						.prepare("UPDATE observations SET ended_at = ?, version = version + 1, evidence_fact_ids_json = ?, updated_at = ? WHERE id = ?")
						.run(now, JSON.stringify(allEvidence), now, cur.id);
				}
				for (const fid of evidence) edge.run(fid, cur.id, now);
				this.audit(action.op, "observation", cur.id, JSON.stringify({ text: fresh.text, proofCount: fresh.proofCount }), JSON.stringify({ op: action.op }), "consolidator");
				touchedObs.push(cur.id);
			}
			for (const d of applied.deleted) {
				this.db.prepare("UPDATE mental_models SET deleted_at = ?, delete_reason = ? WHERE id = ?").run(now, d.reason, d.id);
				this.audit("delete", "mental_model", d.id, null, JSON.stringify({ reason: d.reason }), "consolidator");
			}
			const upsert = this.db.prepare(
				`INSERT INTO mental_models(id, section, text, refs_json, position, created_at, updated_at) VALUES (?,?,?,?,?,?,?)
				 ON CONFLICT(id) DO UPDATE SET section = excluded.section, text = excluded.text, refs_json = excluded.refs_json,
				 position = excluded.position, updated_at = excluded.updated_at`,
			);
			for (const id of applied.changedIds) {
				const e = applied.entries.find((x) => x.id === id) as MentalModelEntry;
				upsert.run(e.id, e.section, e.text, JSON.stringify(e.refs), e.position, now, e.updatedAt);
				this.audit("upsert", "mental_model", e.id, null, JSON.stringify({ section: e.section, text: e.text }), "consolidator");
			}
			const ids = selected.map((f) => f.id);
			for (const part of chunk(ids, 500)) this.db.prepare(`UPDATE facts SET consolidated = 1 WHERE id IN (${placeholders(part.length)})`).run(...part);
		});
		for (const id of touchedObs) {
			const row = this.db.prepare("SELECT * FROM observations WHERE id = ?").get(id) as SqlRow;
			this.catalog.upsert(observationMeta(row));
			this.pendingEmbed.add(itemKey("observation", id));
		}
		this.scheduleEmbedding();
	}

	private refExists(ref: string, createdObs: ReadonlySet<string>): boolean {
		if (!REF_PATTERN.test(ref)) return false;
		const sep = ref.indexOf(":");
		const type = ref.slice(0, sep);
		const id = ref.slice(sep + 1);
		const has = (table: string) => !!this.db.prepare(`SELECT 1 AS x FROM ${table} WHERE id = ? AND status <> 'forgotten'`).get(id);
		switch (type) {
			case "fact":
				return has("facts");
			case "obs":
				return createdObs.has(id) || has("observations");
			case "msg":
				return has("messages");
			case "episode":
				return has("episodes");
			case "session":
				return !!this.db.prepare("SELECT 1 AS x FROM sessions WHERE id = ?").get(id);
			case "node":
				return id.length > 0;
			default:
				return false;
		}
	}

	/** r4 §7.6.5-2: exact (folded) duplicates, and near duplicates (cos ≥ 0.92 ∧ token Jaccard ≥ 0.8) of new facts. */
	private dedupFacts(now: number): void {
		const current = this.db
			.prepare("SELECT * FROM facts WHERE status = 'active' AND expired_at IS NULL")
			.all()
			.map(toFact)
			.filter((f) => isCurrentFact(f, now))
			.sort(compareForWinner);
		if (current.length < 2) return;
		const state = new Map(current.map((f) => [f.id, f]));
		const merges: { winner: string; loser: string }[] = [];
		const merged = new Set<string>();
		const byKey = new Map<string, string>();
		for (const f of current) {
			const key = `${f.kind}|${foldText(f.text)}`;
			const w = byKey.get(key);
			if (w) {
				merges.push({ winner: w, loser: f.id });
				merged.add(f.id);
			} else byKey.set(key, f.id);
		}
		const tokensOf = new Map<string, Set<string>>();
		const toks = (f: FactRecord) => {
			let t = tokensOf.get(f.id);
			if (!t) {
				t = new Set(contentTokens(f.text));
				tokensOf.set(f.id, t);
			}
			return t;
		};
		for (const f of current) {
			if (f.consolidated || merged.has(f.id)) continue;
			const vf = this.catalog.vectors.get(itemKey("fact", f.id));
			if (!vf) continue;
			for (const g of current) {
				if (g.id === f.id || g.kind !== f.kind || merged.has(g.id) || compareForWinner(g, f) >= 0) continue;
				const vg = this.catalog.vectors.get(itemKey("fact", g.id));
				if (!vg || cosine(vf, vg) < this.settings.dedupMinCosine || jaccard(toks(f), toks(g)) < 0.8) continue;
				merges.push({ winner: g.id, loser: f.id });
				merged.add(f.id);
				break;
			}
		}
		if (merges.length === 0) return;
		const retired: { id: string; expiredAt: number }[] = [];
		this.db.transaction(() => {
			for (const m of merges) {
				const winner = state.get(m.winner) as FactRecord;
				const loser = state.get(m.loser) as FactRecord;
				const r = mergeDuplicateFacts(winner, loser, now);
				this.db.prepare("UPDATE facts SET proof_count = ?, source_msg_ids_json = ? WHERE id = ?").run(r.winner.proofCount, JSON.stringify(r.winner.sourceMsgIds), winner.id);
				this.db.prepare("UPDATE facts SET expired_at = ?, superseded_by = ? WHERE id = ? AND expired_at IS NULL").run(r.loser.expiredAt, winner.id, loser.id);
				this.db
					.prepare("INSERT OR IGNORE INTO edges(src_type, src_id, dst_type, dst_id, rel, weight, recorded_at) VALUES ('fact',?,'fact',?,'same_as',1,?)")
					.run(loser.id, winner.id, now);
				this.audit("dedup", "fact", loser.id, JSON.stringify({ text: loser.text }), JSON.stringify({ mergedInto: winner.id, proofCount: r.winner.proofCount }), "consolidator");
				state.set(winner.id, { ...winner, proofCount: r.winner.proofCount, sourceMsgIds: r.winner.sourceMsgIds });
				retired.push({ id: loser.id, expiredAt: r.loser.expiredAt });
			}
		});
		for (const r of retired) this.catalog.patch(itemKey("fact", r.id), { expiredAt: r.expiredAt });
	}

	/** r4 §7.6.5-5: low-importance, never-accessed episodes older than 180 days leave the default channels. */
	private archiveStale(now: number): void {
		const rows = this.db.prepare("SELECT id, importance, access_count, t_end FROM episodes WHERE status = 'active' AND importance < 0.3 AND access_count = 0").all();
		const ids = rows
			.filter((r) => shouldArchive({ importance: rowNumber(r, "importance") ?? 1, accessCount: rowNumber(r, "access_count") ?? 1, ageMs: now - (rowNumber(r, "t_end") ?? now) }))
			.map((r) => rowString(r, "id") as string);
		if (ids.length === 0) return;
		this.db.transaction(() => {
			for (const id of ids) {
				this.db.prepare("UPDATE episodes SET status = 'archived' WHERE id = ?").run(id);
				this.audit("archive", "episode", id, null, null, "system");
			}
		});
		for (const id of ids) this.catalog.patch(itemKey("episode", id), { status: "archived" });
	}

	// ─── diary ───────────────────────────────────────────────────────────────

	private latestDiary(excludeSessionId?: string): DiaryEntry | null {
		const row = this.db
			.prepare("SELECT * FROM diary WHERE session_id <> ? ORDER BY created_at DESC LIMIT 1")
			.get(excludeSessionId ?? "");
		return row ? this.toDiary(row) : null;
	}

	private toDiary(row: SqlRow): DiaryEntry {
		return {
			sessionId: rowString(row, "session_id") as string,
			mission: rowString(row, "mission"),
			summary: rowString(row, "summary") as string,
			nextFocus: rowString(row, "next_focus") as string,
			createdAt: rowNumber(row, "created_at") as number,
		};
	}

	/** Diary entries, newest first. */
	diary(limit = 50): DiaryEntry[] {
		this.assertOpen();
		return this.db.prepare("SELECT * FROM diary ORDER BY created_at DESC LIMIT ?").all(limit).map((r) => this.toDiary(r));
	}

	private async writeDiary(sessionId: string): Promise<void> {
		const now = this.now();
		const previous = this.latestDiary(sessionId);
		const messages = this.db.prepare("SELECT * FROM messages WHERE session_id = ? AND status = 'active' ORDER BY seq").all(sessionId).map(toMessage);
		if (messages.length === 0) return;
		const facts = this.db
			.prepare("SELECT * FROM facts WHERE session_id = ? AND status = 'active' AND expired_at IS NULL ORDER BY recorded_at")
			.all(sessionId)
			.map(toFact);
		const tail: MessageRecord[] = [];
		let used = 0;
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i] as MessageRecord;
			if (tail.length > 0 && used + m.tokens > 6000) break;
			tail.unshift(m);
			used += m.tokens;
		}
		const focus = this.focusOf(sessionId);
		let entry = this.fallbackDiary(sessionId, previous, messages, facts, focus);
		if (this.extractor?.diary) {
			try {
				const out = await this.extractor.diary({
					domainId: this.domainId,
					sessionId,
					now,
					previous,
					focusNodes: focus,
					messages: tail.map(toSource),
					facts: facts.map((f) => ({ kind: f.kind, text: f.text })),
					observationLog: this.latestLog(sessionId)?.text ?? "",
				});
				this.recordUsage(out.usage);
				if (out.summary.trim() && out.nextFocus.trim()) {
					entry = {
						mission: out.mission?.trim() ? clip(out.mission, MAX_DIARY_LINE_CHARS) : entry.mission,
						summary: clip(out.summary, MAX_DIARY_SUMMARY_CHARS),
						nextFocus: clip(out.nextFocus, MAX_DIARY_LINE_CHARS),
					};
				}
			} catch (error) {
				this.report("diary", error);
			}
		}
		this.db
			.prepare(
				"INSERT INTO diary(session_id, mission, summary, next_focus, created_at) VALUES (?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET mission = excluded.mission, summary = excluded.summary, next_focus = excluded.next_focus, created_at = excluded.created_at",
			)
			.run(sessionId, entry.mission, entry.summary, entry.nextFocus, now);
	}

	private fallbackDiary(
		sessionId: string,
		previous: DiaryEntry | null,
		messages: readonly MessageRecord[],
		facts: readonly FactRecord[],
		focus: readonly string[],
	): { mission: string | null; summary: string; nextFocus: string } {
		const goal = rowString(
			this.db.prepare("SELECT text FROM facts WHERE kind = 'goal' AND status = 'active' AND expired_at IS NULL ORDER BY recorded_at DESC LIMIT 1").get(),
			"text",
		);
		const started = this.sessionStart(sessionId);
		const learnerTurns = messages.filter((m) => m.role === "user").length;
		const about = focus.length > 0 ? ` sobre ${focus.slice(0, 5).join(", ")}` : "";
		const highlights = facts.slice(0, 3).map((f) => f.text).join(" ");
		const plan = [...facts].reverse().find((f) => f.kind === "plan")?.text;
		const lastNode = focus[focus.length - 1];
		return {
			mission: previous?.mission ?? (goal ? clip(goal, MAX_DIARY_LINE_CHARS) : null),
			summary: clip(`Sessão de ${formatDay(started)}${about}: ${messages.length} falas (${learnerTurns} do aluno).${highlights ? ` ${highlights}` : ""}`, MAX_DIARY_SUMMARY_CHARS),
			nextFocus: clip(plan ?? (lastNode ? `Retomar ${lastNode}.` : "Retomar de onde a última sessão parou."), MAX_DIARY_LINE_CHARS),
		};
	}

	// ─── forget ──────────────────────────────────────────────────────────────

	forget(sel: ForgetSelector, mode: ForgetMode): Promise<{ affected: number }> {
		if (mode !== "soft" && mode !== "hard") return Promise.reject(new MemoryError("invalid-input", `modo de esquecimento inválido: ${String(mode)}`));
		return this.schedule("forget", () => this.forgetNow(sel, mode));
	}

	private resolveForgetTargets(sel: ForgetSelector): ForgetTargets {
		const t: ForgetTargets = { messages: new Set(), facts: new Set(), episodes: new Set(), observations: new Set(), sessions: new Set() };
		const ids = (sql: string, ...params: SqlValue[]) => this.db.prepare(sql).all(...params).map((r) => rowString(r, "id") as string);
		const strings = (xs: unknown): string[] => {
			if (!Array.isArray(xs)) throw new MemoryError("invalid-input", "seletor de esquecimento com lista inválida");
			return xs.filter((x): x is string => typeof x === "string");
		};
		if (!sel || typeof sel !== "object") throw new MemoryError("invalid-input", "seletor de esquecimento ausente");
		if ("factIds" in sel) for (const id of strings(sel.factIds)) t.facts.add(id);
		else if ("messageIds" in sel) for (const id of strings(sel.messageIds)) t.messages.add(id);
		else if ("confirmIds" in sel) {
			for (const id of strings(sel.confirmIds)) {
				if (this.catalog.items.has(itemKey("message", id))) t.messages.add(id);
				else if (this.catalog.items.has(itemKey("fact", id))) t.facts.add(id);
				else if (this.catalog.items.has(itemKey("episode", id))) t.episodes.add(id);
				else if (this.catalog.items.has(itemKey("observation", id))) t.observations.add(id);
			}
		} else if ("sessionId" in sel) {
			t.sessions.add(sel.sessionId);
			for (const id of ids("SELECT id FROM messages WHERE session_id = ?", sel.sessionId)) t.messages.add(id);
			for (const id of ids("SELECT id FROM facts WHERE session_id = ?", sel.sessionId)) t.facts.add(id);
			for (const id of ids("SELECT id FROM episodes WHERE session_id = ?", sel.sessionId)) t.episodes.add(id);
		} else if ("before" in sel) {
			if (!Number.isFinite(sel.before)) throw new MemoryError("invalid-input", `instante inválido em 'before': ${sel.before}`);
			for (const id of ids("SELECT id FROM messages WHERE ts < ?", sel.before)) t.messages.add(id);
			for (const id of ids("SELECT id FROM facts WHERE recorded_at < ?", sel.before)) t.facts.add(id);
			for (const id of ids("SELECT id FROM episodes WHERE t_end < ?", sel.before)) t.episodes.add(id);
		} else if ("all" in sel && sel.all === true) {
			for (const id of ids("SELECT id FROM sessions")) t.sessions.add(id);
			for (const id of ids("SELECT id FROM messages")) t.messages.add(id);
			for (const id of ids("SELECT id FROM facts")) t.facts.add(id);
			for (const id of ids("SELECT id FROM episodes")) t.episodes.add(id);
			for (const id of ids("SELECT id FROM observations")) t.observations.add(id);
		} else {
			throw new MemoryError("invalid-input", "seletor de esquecimento desconhecido");
		}
		if (t.messages.size > 0) {
			const gone = new Set([...t.messages, ...ids("SELECT id FROM messages WHERE status = 'forgotten'")]);
			const messageText = (id: string) => rowString(this.db.prepare("SELECT text FROM messages WHERE id = ?").get(id), "text") ?? "";
			// Derived facts: every source gone, or the quote (copied verbatim from a source, so the
			// fact's wording derives from it) is no longer supported by any surviving source.
			for (const r of this.db.prepare("SELECT id, source_msg_ids_json, quote FROM facts").all()) {
				const sources = jsonList(r, "facts", "source_msg_ids_json");
				if (!sources.some((s) => gone.has(s))) continue;
				const surviving = sources.filter((s) => !gone.has(s));
				const quote = rowString(r, "quote");
				if (surviving.length === 0 || (quote !== null && !surviving.some((s) => quoteOccursIn(quote, messageText(s))))) {
					t.facts.add(rowString(r, "id") as string);
				}
			}
			for (const r of this.db.prepare("SELECT e.id AS id, e.session_id AS sid, f.seq AS lo, l.seq AS hi FROM episodes e JOIN messages f ON f.id = e.first_msg_id JOIN messages l ON l.id = e.last_msg_id").all()) {
				const range = ids("SELECT id FROM messages WHERE session_id = ? AND seq BETWEEN ? AND ?", rowString(r, "sid") as string, rowNumber(r, "lo") as number, rowNumber(r, "hi") as number);
				if (range.length > 0 && range.every((m) => gone.has(m))) t.episodes.add(rowString(r, "id") as string);
			}
			// Sessions left without any message: their diary and working-memory log derive only from
			// forgotten turns. All their message ids join the targets (hard mode deletes the rows
			// a previous soft forget kept, together with their audit copies).
			const touched = new Set<string>();
			for (const part of chunk([...t.messages], 500)) {
				for (const r of this.db.prepare(`SELECT DISTINCT session_id AS sid FROM messages WHERE id IN (${placeholders(part.length)})`).all(...part)) touched.add(rowString(r, "sid") as string);
			}
			for (const sid of touched) {
				const all = ids("SELECT id FROM messages WHERE session_id = ?", sid);
				if (all.every((m) => gone.has(m))) {
					t.sessions.add(sid);
					for (const m of all) t.messages.add(m);
				}
			}
		}
		// Observations whose whole evidence is gone.
		const goneFacts = new Set([...t.facts, ...ids("SELECT id FROM facts WHERE status = 'forgotten'")]);
		if (t.facts.size > 0) {
			for (const r of this.db.prepare("SELECT id, evidence_fact_ids_json FROM observations").all()) {
				const ev = jsonList(r, "observations", "evidence_fact_ids_json");
				if (ev.length > 0 && ev.every((f) => goneFacts.has(f))) t.observations.add(rowString(r, "id") as string);
			}
		}
		return t;
	}

	private forgetNow(sel: ForgetSelector, mode: ForgetMode): { affected: number } {
		const t = this.resolveForgetTargets(sel);
		const now = this.now();
		let affected = 0;
		const tables: [MemoryItemKind, string, Set<string>][] = [
			["observation", "observations", t.observations],
			["fact", "facts", t.facts],
			["episode", "episodes", t.episodes],
			["message", "messages", t.messages],
		];
		const removedRefs = new Set<string>();
		const touchedSessions = new Set<string>(t.sessions);
		const refPrefix: Record<MemoryItemKind, string> = { message: "msg", fact: "fact", episode: "episode", observation: "obs" };
		const scrubAudit = (targetType: string, targetId: string) =>
			this.db.prepare("UPDATE audit SET before_json = NULL, after_json = NULL WHERE target_type = ? AND target_id = ?").run(targetType, targetId);
		this.db.transaction(() => {
			for (const [kind, table, set] of tables) {
				for (const id of set) {
					const row = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
					if (!row) continue;
					const ftsRowid = rowNumber(row, "fts_rowid");
					const key = itemKey(kind, id);
					const sid = rowString(row, "session_id");
					if (sid) touchedSessions.add(sid);
					if (mode === "soft") {
						if (rowString(row, "status") === "forgotten") continue;
						if (ftsRowid !== null) this.db.prepare("DELETE FROM fts WHERE rowid = ?").run(ftsRowid);
						this.db.prepare("DELETE FROM embeddings WHERE item_kind = ? AND item_id = ?").run(kind, id);
						this.db.prepare(`UPDATE ${table} SET status = 'forgotten', fts_rowid = NULL WHERE id = ?`).run(id);
						this.audit("forget-soft", kind, id, rowJson(row), null, "user");
						this.catalog.patch(key, { status: "forgotten" });
						this.catalog.vectors.delete(key);
					} else {
						if (ftsRowid !== null) this.db.prepare("DELETE FROM fts WHERE rowid = ?").run(ftsRowid);
						this.db.prepare("DELETE FROM embeddings WHERE item_kind = ? AND item_id = ?").run(kind, id);
						if (kind !== "message") {
							this.db.prepare("DELETE FROM edges WHERE (src_type = ? AND src_id = ?) OR (dst_type = ? AND dst_id = ?)").run(kind, id, kind, id);
						}
						this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
						scrubAudit(kind, id);
						this.catalog.remove(key);
					}
					removedRefs.add(`${refPrefix[kind]}:${id}`);
					affected += 1;
				}
			}
			// Session-level derived text (diary hand-off, working-memory log).
			for (const sid of t.sessions) {
				if (mode === "soft") {
					for (const r of this.db.prepare("SELECT * FROM diary WHERE session_id = ?").all(sid)) this.audit("forget-soft", "diary", sid, rowJson(r), null, "user");
					for (const r of this.db.prepare("SELECT * FROM observation_log WHERE session_id = ?").all(sid)) this.audit("forget-soft", "observation_log", sid, rowJson(r), null, "user");
					this.db.prepare("DELETE FROM diary WHERE session_id = ?").run(sid);
					this.db.prepare("DELETE FROM observation_log WHERE session_id = ?").run(sid);
				} else {
					this.db.prepare("DELETE FROM observation_log WHERE session_id = ?").run(sid);
					this.db.prepare("DELETE FROM diary WHERE session_id = ?").run(sid);
					this.db.prepare("DELETE FROM sessions WHERE id = ?").run(sid);
					scrubAudit("diary", sid);
					scrubAudit("observation_log", sid);
					this.sessionSeq.delete(sid);
					this.sessionFocus.delete(sid);
				}
				this.pendingTokens.delete(sid);
				this.unobservedTokens.delete(sid);
			}
			if (mode === "hard") {
				const goneMsgs = t.messages;
				for (const r of this.db.prepare("SELECT id, source, source_msg_ids_json FROM evidence WHERE source = 'dialogue_extractor'").all()) {
					const src = jsonList(r, "evidence", "source_msg_ids_json");
					if (src.length > 0 && src.every((m) => goneMsgs.has(m))) this.db.prepare("DELETE FROM evidence WHERE id = ?").run(rowString(r, "id") as string);
				}
				for (const r of this.db.prepare("SELECT id, session_id, source_msg_ids_json FROM flashcard_candidates").all()) {
					const src = jsonList(r, "flashcard_candidates", "source_msg_ids_json");
					const fromSession = t.sessions.has(rowString(r, "session_id") as string);
					if (fromSession || (src.length > 0 && src.every((m) => goneMsgs.has(m)))) this.db.prepare("DELETE FROM flashcard_candidates WHERE id = ?").run(rowString(r, "id") as string);
				}
				// Surviving facts keep only surviving source ids (their quote is still supported:
				// resolveForgetTargets forgot every fact whose quote was not).
				if (goneMsgs.size > 0) {
					for (const r of this.db.prepare("SELECT id, source_msg_ids_json FROM facts").all()) {
						const src = jsonList(r, "facts", "source_msg_ids_json");
						const kept = src.filter((m) => !goneMsgs.has(m));
						if (kept.length !== src.length) this.db.prepare("UPDATE facts SET source_msg_ids_json = ? WHERE id = ?").run(JSON.stringify(kept), rowString(r, "id") as string);
					}
				}
				// Rejected extraction elements keep their text in the audit, keyed `<sessionId>#…`.
				for (const sid of touchedSessions) {
					this.db.prepare("UPDATE audit SET before_json = NULL, after_json = NULL WHERE op = 'reject' AND substr(target_id, 1, ?) = ?").run(sid.length + 1, `${sid}#`);
				}
				if ("all" in sel) {
					this.db.exec("DELETE FROM mental_models; DELETE FROM entities; DELETE FROM edges; DELETE FROM external_refs; UPDATE audit SET before_json = NULL, after_json = NULL;");
				}
			}
			// Mental-model entries left without any surviving source.
			for (const e of this.mentalModel()) {
				const surviving = e.refs.filter((r) => !removedRefs.has(r) && (r.startsWith("node:") || r.startsWith("session:") || this.refExists(r, new Set())));
				if (surviving.length > 0) {
					if (mode === "hard" && surviving.length !== e.refs.length) {
						this.db.prepare("UPDATE mental_models SET refs_json = ? WHERE id = ?").run(JSON.stringify(surviving), e.id);
					}
					continue;
				}
				if (mode === "soft") this.db.prepare("UPDATE mental_models SET deleted_at = ?, delete_reason = 'forgotten' WHERE id = ?").run(now, e.id);
				else {
					this.db.prepare("DELETE FROM mental_models WHERE id = ?").run(e.id);
					scrubAudit("mental_model", e.id);
				}
			}
			if (mode === "hard") {
				this.audit("forget-hard", "selector", Object.keys(sel)[0] ?? "?", null, JSON.stringify({ affected }), "user");
			}
		});
		if (mode === "hard") {
			// Irreversible: merge FTS segments (drops tombstoned terms), rebuild the file without
			// free pages, then checkpoint and truncate the WAL, which still holds the old pages.
			this.db.exec("INSERT INTO fts(fts) VALUES('optimize')");
			this.db.exec("VACUUM");
			this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
		}
		return { affected };
	}

	// ─── read APIs (memory viewer, flashcards, export) ──────────────────────

	/** Active mental-model entries in canonical order. */
	mentalModel(): MentalModelEntry[] {
		return this.db
			.prepare("SELECT * FROM mental_models WHERE deleted_at IS NULL ORDER BY section, position, id")
			.all()
			.map((r) => ({
				id: rowString(r, "id") as string,
				section: rowString(r, "section") as string,
				text: rowString(r, "text") as string,
				refs: jsonList(r, "mental_models", "refs_json"),
				position: rowNumber(r, "position") as number,
				updatedAt: rowNumber(r, "updated_at") as number,
			}));
	}

	/** Facts for inspection; superseded/expired ones only with `includeSuperseded`. Forgotten facts never. */
	listFacts(opts: { includeSuperseded?: boolean; sessionId?: string; limit?: number } = {}): FactRecord[] {
		this.assertOpen();
		const now = this.now();
		const rows = opts.sessionId
			? this.db.prepare("SELECT * FROM facts WHERE status <> 'forgotten' AND session_id = ? ORDER BY recorded_at DESC LIMIT ?").all(opts.sessionId, opts.limit ?? 500)
			: this.db.prepare("SELECT * FROM facts WHERE status <> 'forgotten' ORDER BY recorded_at DESC LIMIT ?").all(opts.limit ?? 500);
		return rows.map(toFact).filter((f) => opts.includeSuperseded === true || isCurrentFact(f, now));
	}

	/** Every fact row including forgotten ones (audit/invariant checks). */
	allFacts(): FactRecord[] {
		this.assertOpen();
		return this.db.prepare("SELECT * FROM facts ORDER BY recorded_at, id").all().map(toFact);
	}

	observations(opts: { includeEnded?: boolean } = {}): ObservationRecord[] {
		this.assertOpen();
		return this.db
			.prepare("SELECT * FROM observations WHERE status = 'active' ORDER BY updated_at DESC")
			.all()
			.map(toObservation)
			.filter((o) => opts.includeEnded === true || o.endedAt === null);
	}

	flashcardCandidates(sessionId?: string): FlashcardCandidateRecord[] {
		this.assertOpen();
		const rows = sessionId
			? this.db.prepare("SELECT * FROM flashcard_candidates WHERE session_id = ? ORDER BY created_at, id").all(sessionId)
			: this.db.prepare("SELECT * FROM flashcard_candidates WHERE status = 'pending' ORDER BY created_at, id").all();
		return rows.map((r) => ({
			id: rowString(r, "id") as string,
			sessionId: rowString(r, "session_id") as string,
			nodeId: rowString(r, "node_id"),
			front: rowString(r, "front") as string,
			back: rowString(r, "back") as string,
			sourceMsgIds: jsonList(r, "flashcard_candidates", "source_msg_ids_json"),
			status: rowString(r, "status") as FlashcardCandidateRecord["status"],
			createdAt: rowNumber(r, "created_at") as number,
		}));
	}

	setFlashcardStatus(ids: readonly string[], status: "accepted" | "discarded"): number {
		this.assertOpen();
		if (status !== "accepted" && status !== "discarded") throw new MemoryError("invalid-input", `status de cartão inválido: ${String(status)}`);
		let n = 0;
		this.db.transaction(() => {
			for (const id of ids) n += this.db.prepare("UPDATE flashcard_candidates SET status = ? WHERE id = ? AND status = 'pending'").run(status, id).changes;
		});
		return n;
	}

	/** Raw L0 messages of a session (chronological; forgotten excluded). */
	sessionMessages(sessionId: string): MessageRecord[] {
		this.assertOpen();
		return this.db.prepare("SELECT * FROM messages WHERE session_id = ? AND status <> 'forgotten' ORDER BY seq").all(sessionId).map(toMessage);
	}

	health(): MemoryHealth {
		this.assertOpen();
		const count = (sql: string) => rowNumber(this.db.prepare(sql).get(), "n") ?? 0;
		return {
			domainId: this.domainId,
			messages: count("SELECT COUNT(*) AS n FROM messages WHERE status = 'active'"),
			facts: count("SELECT COUNT(*) AS n FROM facts WHERE status <> 'forgotten'"),
			currentFacts: count("SELECT COUNT(*) AS n FROM facts WHERE status = 'active' AND expired_at IS NULL"),
			observations: count("SELECT COUNT(*) AS n FROM observations WHERE status = 'active' AND ended_at IS NULL"),
			mentalModelEntries: count("SELECT COUNT(*) AS n FROM mental_models WHERE deleted_at IS NULL"),
			pendingExtractionTokens: count("SELECT COALESCE(SUM(tokens), 0) AS n FROM messages WHERE extracted = 0 AND status = 'active'"),
			vectors: this.catalog.vectors.size,
			lastError: this.lastError,
		};
	}

	async exportMarkdown(dir: string): Promise<void> {
		return this.schedule("export", () => {
			fs.mkdirSync(dir, { recursive: true });
			writeFileAtomicSync(path.join(dir, EXPORT_FILES.mentalModel), mentalModelMarkdown(this.mentalModel(), this.title));
			writeFileAtomicSync(path.join(dir, EXPORT_FILES.observations), observationsMarkdown(this.observations({ includeEnded: true }), this.title));
			writeFileAtomicSync(path.join(dir, EXPORT_FILES.diary), diaryMarkdown(this.diary(1000), this.title));
		});
	}

	async close(): Promise<void> {
		if (this.closed) return;
		await this.flush();
		this.closed = true;
		this.db.close();
	}
}

/** Convenience: open `<dir>/memory.db` for a domain. */
export function openMemoryDb(dir: string, options: MemoryDbOptions): MemoryDb {
	return MemoryDb.open(dir, options);
}
