/**
 * Memory contracts — the per-domain long-term context memory
 * (docs/research/00-SINTESE.md §2.3 "src/core/memory/types.ts", §2.5;
 * r4-memoria-contexto-sota.md §7.1–§7.6; Hindsight retain/recall/reflect
 * [extra-vectorize-io__hindsight.md §5]; DeepTutor MemoryOp/journal
 * [ref-deeptutor-core.md §3.2, §3.4]).
 *
 * Layers (r4 §7.1): L0 raw `messages` (sync write) · L1 `episodes` ·
 * L2 bitemporal `facts` + entities + edges (about → curriculum node) ·
 * L3 `observations` (proof_count) + mental models (DeepTutor entries ≤240
 * chars) · WM per-session `observation_log` · diary (Mission / Last session /
 * next_focus). Bank = domain: one SQLite file per domain, zero cross-domain
 * reads.
 *
 * Everything that calls a model or touches I/O arrives through PORTS declared
 * here (Embedder, Extractor, CurriculumNeighbors, LearnerPort, ProfilePort):
 * the core stays pure and browser-safe, the store implements the database and
 * the server composes the real embedder / LLM extractor.
 */

import type { DomainId } from "../domains/types.ts";
import type { LearnerPromptSnapshot } from "../learner/types.ts";

// ─── Vocabulary ─────────────────────────────────────────────────────────────

export const FACT_KINDS = ["world", "experience", "learner", "preference", "misconception", "goal", "affect", "plan"] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export type FactScope = "domain" | "global" | "session";

export type MemoryItemKind = "message" | "episode" | "fact" | "observation";

/** Canonical channel order (also the RRF/RSF summation order). */
export const RECALL_CHANNELS = ["vec", "fts", "graph", "time", "learner"] as const;
export type RecallChannel = (typeof RECALL_CHANNELS)[number];

export type MessageRole = "user" | "assistant" | "tool";

export type RecallMode = "auto" | "skip" | "deep" | "historical";

export type MaybePromise<T> = T | Promise<T>;

export function isFactKind(value: unknown): value is FactKind {
	return typeof value === "string" && (FACT_KINDS as readonly string[]).includes(value);
}

// ─── Recall ─────────────────────────────────────────────────────────────────

export interface RecallContext {
	domainId: string;
	sessionId: string;
	/** Last learner utterance (optionally + the tutor's question). */
	query: string;
	/** Current curriculum node(s). */
	focusNodes: string[];
	now: number;
	/** Default 2000 ("deep": 4000). */
	budgetTokens?: number;
	/** historical = superseded facts included (labelled). */
	mode?: RecallMode;
	sessionOnly?: boolean;
}

export interface MemoryItem {
	kind: MemoryItemKind;
	id: string;
	/** Isolation witness: always the domain of the database that produced it. */
	domainId: string;
	sessionId?: string;
	text: string;
	/** Relevant time: fact valid_from (or recorded_at), message ts, episode start, observation update. */
	at: number;
	validTo?: number;
	superseded?: boolean;
	/** When the system learned it was superseded (expired_at). */
	supersededAt?: number;
	factKind?: FactKind;
	role?: MessageRole;
	confidence?: number;
	importance?: number;
	nodeIds: string[];
	score: number;
	channels: RecallChannel[];
	sourceMsgIds: string[];
}

export interface RecallResult {
	items: MemoryItem[];
	/** Chronological, budgeted rendering (goes AFTER the cache boundary). */
	rendered: string;
	tokens: number;
	ms: number;
	/** Why the recall was skipped (intent gate, mode="skip"). */
	skipped?: string;
}

export interface TurnInput {
	sessionId: string;
	/** Stable id of the durable transcript entry. A replay does not re-ingest it. */
	sourceId?: string;
	role: MessageRole;
	text: string;
	ts: number;
	nodeIds: string[];
}

export type ForgetSelector =
	| { factIds: string[] }
	| { messageIds: string[] }
	| { query: string; confirmIds: string[] }
	| { sessionId: string }
	| { before: number }
	| { all: true };

export type ForgetMode = "soft" | "hard";

/** SÍNTESE §2.3 — the multi-domain service (one active domain at a time). */
export interface MemoryService {
	open(domainId: string): Promise<void>;
	ingestTurn(t: TurnInput): void;
	recall(ctx: RecallContext): Promise<RecallResult>;
	stablePrefix(domainId: string, sessionId: string): Promise<{ text: string; tokens: number }>;
	/** Final extraction + supersession + consolidation + diary + flashcard candidates. */
	endSession(sessionId: string): Promise<void>;
	consolidate(opts?: { budgetTokens?: number }): Promise<void>;
	forget(sel: ForgetSelector, mode: ForgetMode): Promise<{ affected: number }>;
	/** Mental models, observations and diary → Obsidian vault folder. */
	exportMarkdown(dir: string): Promise<void>;
}

/** One domain's memory (one database file). The store's MemoryDb implements it. */
export interface DomainMemory {
	readonly domainId: string;
	ingestTurn(t: TurnInput): string | null;
	recall(ctx: RecallContext): Promise<RecallResult>;
	stablePrefix(sessionId: string): Promise<{ text: string; tokens: number }>;
	endSession(sessionId: string): Promise<void>;
	consolidate(opts?: { budgetTokens?: number }): Promise<void>;
	forget(sel: ForgetSelector, mode: ForgetMode): Promise<{ affected: number }>;
	exportMarkdown(dir: string): Promise<void>;
	close(): Promise<void>;
}

// ─── Mental models (DeepTutor MemoryOp) ─────────────────────────────────────

/** The 4 canonical mental-model sections (SÍNTESE §2.4(d)). */
export const MENTAL_MODEL_SECTIONS = ["Estado atual", "Pontos fracos", "Próximos passos", "Preferências"] as const;

export type MentalModelDeleteReason = "contradicted" | "superseded" | "stale" | "low-signal";

export type MentalModelOp =
	| { op: "add"; section: string; text: string; refs: string[] }
	| { op: "edit"; targetId: string; newText: string; newRefs: string[] }
	| { op: "delete"; targetId: string; reason: MentalModelDeleteReason };

export interface MentalModelEntry {
	/** `m_<ULID>` */
	id: string;
	section: string;
	/** ≤240 chars, single line. */
	text: string;
	/** Non-empty; `fact:<id>` | `obs:<id>` | `msg:<id>` | `episode:<id>` | `node:<nodeId>`. */
	refs: string[];
	position: number;
	updatedAt: number;
}

// ─── Diary (DeepTutor learning_journal) ─────────────────────────────────────

export interface DiaryEntry {
	sessionId: string;
	/** Mission: why the learner studies this domain (carried forward). */
	mission: string | null;
	/** Last session summary. */
	summary: string;
	nextFocus: string;
	createdAt: number;
}

// ─── Ports ──────────────────────────────────────────────────────────────────

/** Local embedding model. Vectors are L2-normalised by the implementation. */
export interface Embedder {
	/** Stable model id stored in meta; a change triggers re-embedding. */
	readonly id: string;
	readonly dim: number;
	embed(texts: readonly string[], kind: "query" | "passage"): Promise<Float32Array[]>;
}

/** Curriculum adjacency for the graph channel (1 hop, µ = 1.0; r4 §7.8). */
export interface CurriculumNeighbors {
	/** Prerequisites, dependents, encompassed and parent of the given nodes (no duplicates required). */
	neighbors(nodeIds: readonly string[]): MaybePromise<readonly string[]>;
	/** Node ids whose title/alias occurs in the text (entity → node linking). */
	matchNodes?(text: string): MaybePromise<readonly string[]>;
}

/** Bridge to the learner model (R2): read-only snapshot + dialogue evidence sink. */
export interface LearnerPort {
	promptSnapshot(focusNodes: readonly string[]): MaybePromise<LearnerPromptSnapshot | null>;
	/** Nodes with high blame / low pL among (or near) the focus; weakness ∈ (0,1]. */
	weakNodes(focusNodes: readonly string[]): MaybePromise<readonly { nodeId: string; weakness: number }[]>;
	/** Grounded dialogue evidence (graderConfidence ≤ 0.6) for the learner fold. */
	appendEvidence?(candidates: readonly DialogueEvidence[]): MaybePromise<void>;
}

/** Learner profile for the requesting domain (≤300 tokens, read-only). */
export interface ProfilePort {
	text(domainId: string): MaybePromise<string>;
}

// ─── Extractor port (LLM; implemented in src/server/memory/extractor.ts) ────

export interface LlmUsage {
	op: string;
	modelId: string;
	inputTokens: number;
	outputTokens: number;
	cachedTokens?: number;
	ms: number;
}

export interface SourceMessage {
	id: string;
	seq: number;
	role: MessageRole;
	ts: number;
	text: string;
	nodeIds: string[];
}

export interface ExtractionInput {
	domainId: DomainId;
	sessionId: string;
	now: number;
	sessionStartedAt: number;
	focusNodes: string[];
	messages: SourceMessage[];
}

export interface EpisodeCandidate {
	firstMsgId: string;
	lastMsgId: string;
	title: string;
	narrative: string;
	nodeIds?: string[];
	importance?: number;
}

export interface EntityRef {
	name: string;
	type?: "concept" | "person" | "resource" | "tool" | "place" | "org" | "other";
}

export interface FactCandidate {
	kind: string;
	text: string;
	/** Literal excerpt of a source message that supports the fact (HaluMem/ThreadAtlas grounding). */
	quote: string;
	sourceMsgIds: string[];
	nodeIds?: string[];
	aboutNode?: string | null;
	entities?: EntityRef[];
	/** ISO-8601 */
	validFrom?: string | null;
	validTo?: string | null;
	confidence?: number;
	importance?: number;
	scope?: string;
	/** Short text of an older fact this one revises (supersession hint). */
	maybeSupersedes?: string | null;
}

export interface EvidenceCandidate {
	nodes: { nodeId: string; q: number; primary?: boolean }[];
	grade: number;
	graderConfidence: number;
	level?: number;
	quote: string;
	sourceMsgIds: string[];
	attributions?: { nodeId: string; blame: number; misconceptionId?: string }[];
}

export interface FlashcardCandidate {
	front: string;
	back: string;
	nodeId?: string | null;
	sourceMsgIds?: string[];
}

export interface ExtractionOutput {
	episodes: EpisodeCandidate[];
	facts: FactCandidate[];
	evidence: EvidenceCandidate[];
	flashcards: FlashcardCandidate[];
	usage?: LlmUsage;
}

/** Grounded evidence handed to the learner model (it builds the full `Evidence`). */
export interface DialogueEvidence {
	domainId: string;
	sessionId: string;
	at: number;
	nodes: { nodeId: string; q: number; primary?: boolean }[];
	grade: 0 | 1 | 2 | 3;
	graderConfidence: number;
	level: 1 | 2 | 3 | 4 | 5;
	quote: string;
	sourceMsgIds: string[];
	attributions?: { nodeId: string; blame: number; misconceptionId?: string }[];
}

export type SupersedeVerdict = "DUPLICATE" | "UPDATES" | "CONTRADICTS" | "REFINES" | "INDEPENDENT";

export interface JudgeFact {
	id: string;
	kind: FactKind;
	text: string;
	validFrom: number | null;
	recordedAt: number;
}

export interface JudgeInput {
	now: number;
	pairs: { pairId: string; newFact: JudgeFact; oldFact: JudgeFact }[];
}

export interface JudgeOutput {
	verdicts: { pairId: string; verdict: SupersedeVerdict }[];
	usage?: LlmUsage;
}

export interface ObserveInput {
	sessionId: string;
	now: number;
	currentLog: string;
	messages: SourceMessage[];
	/** The log exceeded the reflect threshold: reorganise (merge, drop superseded). */
	reflect: boolean;
}

export interface ObserveOutput {
	/** The full new log (dated bullets with 🔴🟡🟢 priority). */
	log: string;
	usage?: LlmUsage;
}

export interface ConsolidationFact {
	id: string;
	kind: FactKind;
	text: string;
	nodeIds: string[];
	validFrom: number | null;
	recordedAt: number;
	confidence: number;
	proofCount: number;
}

export interface ConsolidationObservation {
	id: string;
	subjectType: ObservationSubjectType;
	subjectId: string;
	text: string;
	proofCount: number;
	updatedAt: number;
}

export type ObservationSubjectType = "node" | "learner" | "entity";

/** Hindsight consolidation effects: new / repeats / changes / ends. */
export type ObservationAction =
	| { op: "create"; subjectType: ObservationSubjectType; subjectId: string; text: string; evidenceFactIds: string[] }
	| { op: "repeat"; observationId: string; evidenceFactIds: string[] }
	| { op: "change"; observationId: string; text: string; evidenceFactIds: string[] }
	| { op: "end"; observationId: string; evidenceFactIds: string[] };

export interface ConsolidationInput {
	domainId: DomainId;
	now: number;
	facts: ConsolidationFact[];
	observations: ConsolidationObservation[];
	mentalModel: MentalModelEntry[];
	sections: readonly string[];
	learner: LearnerPromptSnapshot | null;
}

export interface ConsolidationOutput {
	observations: ObservationAction[];
	mentalModelOps: MentalModelOp[];
	usage?: LlmUsage;
}

export interface DiaryInput {
	domainId: DomainId;
	sessionId: string;
	now: number;
	previous: DiaryEntry | null;
	focusNodes: string[];
	/** Session transcript excerpt (budgeted, chronological). */
	messages: SourceMessage[];
	facts: { kind: FactKind; text: string }[];
	observationLog: string;
}

export interface DiaryOutput {
	mission?: string | null;
	summary: string;
	nextFocus: string;
	usage?: LlmUsage;
}

/**
 * The LLM side of memory. Only `extract` is mandatory: without `judge` the
 * store writes ADD-only (r4 §7.6.2-4 fallback), without `observe` there is no
 * working-memory log, without `consolidate` no observations / mental models,
 * without `diary` a deterministic diary is written.
 */
export interface Extractor {
	extract(input: ExtractionInput): Promise<ExtractionOutput>;
	judge?(input: JudgeInput): Promise<JudgeOutput>;
	observe?(input: ObserveInput): Promise<ObserveOutput>;
	consolidate?(input: ConsolidationInput): Promise<ConsolidationOutput>;
	diary?(input: DiaryInput): Promise<DiaryOutput>;
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export type MemoryErrorCode =
	| "invalid-input"
	| "domain-mismatch"
	| "not-open"
	| "closed"
	| "embedder"
	| "llm-output-invalid"
	| "ops-invalid"
	| "schema";

export class MemoryError extends Error {
	readonly code: MemoryErrorCode;
	constructor(code: MemoryErrorCode, message: string) {
		super(`[memória:${code}] ${message}`);
		this.name = "MemoryError";
		this.code = code;
	}
}
