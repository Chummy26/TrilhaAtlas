/**
 * DomainMemoryService — the app-facing `MemoryService` (docs/research/
 * 00-SINTESE.md §2.3) over one `MemoryDb` per study domain (§2.2 "um
 * memory.db por domínio"; r4 §7.3 isolation: "nenhuma busca cruza domínio").
 *
 * Routing rule (the isolation witness): `recall` and `stablePrefix` name
 * their domain explicitly and go to that domain's handle only; the write side
 * (`ingestTurn`, `endSession`, `consolidate`, `forget`, `exportMarkdown`)
 * acts on the ACTIVE domain, i.e. the one most recently passed to `open`.
 * A recall for a domain that is not open fails with `not-open` instead of
 * silently opening (or, worse, answering from) another file.
 *
 * Handles are kept in a small LRU (default 2: the active domain plus the
 * previous one, so switching back is instant); evicted handles are flushed
 * and closed. Ports (embedder, extractor, curriculum, learner, profile) are
 * built per domain by injected factories, so the store never decides which
 * model or curriculum a domain uses.
 */

import {
	MemoryError,
	type CurriculumNeighbors,
	type Embedder,
	type Extractor,
	type ForgetMode,
	type ForgetSelector,
	type LearnerPort,
	type MemoryService,
	type ProfilePort,
	type RecallContext,
	type RecallResult,
	type TurnInput,
} from "../../core/memory/types.ts";
import type { MemorySettings } from "../../core/memory/settings.ts";
import { MemoryDb } from "./memory-db.ts";

export interface DomainMemoryServiceOptions {
	/** Folder holding `memory.db` for a domain (normally `memoryDir(root, domainId)`). */
	dirFor: (domainId: string) => string;
	/** One embedder may be shared by every domain (it is stateless per call). */
	embedder: Embedder | ((domainId: string) => Embedder);
	extractorFor?: (domainId: string) => Extractor | undefined;
	curriculumFor?: (domainId: string) => CurriculumNeighbors | undefined;
	learnerFor?: (domainId: string) => LearnerPort | undefined;
	profile?: ProfilePort;
	titleFor?: (domainId: string) => string;
	settings?: Partial<MemorySettings>;
	clock?: () => number;
	onError?: (error: unknown, op: string, domainId: string) => void;
	/** Open handles kept at once (≥ 1; default 2). */
	maxOpen?: number;
}

export class DomainMemoryService implements MemoryService {
	private readonly options: DomainMemoryServiceOptions;
	private readonly maxOpen: number;
	/** Insertion order = recency order (most recent last). */
	private readonly handles = new Map<string, MemoryDb>();
	private activeId: string | null = null;
	private closed = false;

	constructor(options: DomainMemoryServiceOptions) {
		if (typeof options?.dirFor !== "function") throw new MemoryError("invalid-input", "dirFor é obrigatório");
		if (!options.embedder) throw new MemoryError("invalid-input", "embedder é obrigatório");
		const maxOpen = options.maxOpen ?? 2;
		if (!Number.isInteger(maxOpen) || maxOpen < 1) throw new MemoryError("invalid-input", `maxOpen inválido: ${maxOpen}`);
		this.options = options;
		this.maxOpen = maxOpen;
	}

	/** The active domain's id, or null before the first `open`. */
	get activeDomainId(): string | null {
		return this.activeId;
	}

	/** Open (or reuse) a domain's memory and make it the active one. */
	async open(domainId: string): Promise<void> {
		this.handle(domainId);
		this.activeId = domainId;
		await this.evict();
	}

	/** The open handle of a domain, if any (viewer, tests, integration). */
	get(domainId: string): MemoryDb | undefined {
		return this.handles.get(domainId);
	}

	/** The active domain's handle; throws `not-open` before `open`. */
	active(): MemoryDb {
		if (this.closed) throw new MemoryError("closed", "serviço de memória já fechado");
		const db = this.activeId === null ? undefined : this.handles.get(this.activeId);
		if (!db) throw new MemoryError("not-open", "nenhum domínio aberto na memória");
		return db;
	}

	ingestTurn(t: TurnInput): void {
		this.active().ingestTurn(t);
	}

	async recall(ctx: RecallContext): Promise<RecallResult> {
		return this.require(ctx?.domainId).recall(ctx);
	}

	async stablePrefix(domainId: string, sessionId: string): Promise<{ text: string; tokens: number }> {
		return this.require(domainId).stablePrefix(sessionId);
	}

	/**
	 * Ends a session in the open domain that owns it (the active one first). A
	 * session is often closed right AFTER the learner switched domains; sending
	 * it blindly to the new active domain would fail and lose its diary.
	 */
	async endSession(sessionId: string): Promise<void> {
		const active = this.active();
		if (active.hasSession(sessionId)) return active.endSession(sessionId);
		for (const db of this.handles.values()) {
			if (db !== active && db.hasSession(sessionId)) return db.endSession(sessionId);
		}
		return active.endSession(sessionId); // rejects with invalid-input: unknown session
	}

	async consolidate(opts?: { budgetTokens?: number }): Promise<void> {
		return this.active().consolidate(opts);
	}

	async forget(sel: ForgetSelector, mode: ForgetMode): Promise<{ affected: number }> {
		return this.active().forget(sel, mode);
	}

	async exportMarkdown(dir: string): Promise<void> {
		return this.active().exportMarkdown(dir);
	}

	/** Flush and close every open handle. */
	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		const all = [...this.handles.values()];
		this.handles.clear();
		this.activeId = null;
		await Promise.all(all.map((db) => db.close()));
	}

	private require(domainId: string | undefined): MemoryDb {
		if (this.closed) throw new MemoryError("closed", "serviço de memória já fechado");
		const db = typeof domainId === "string" ? this.handles.get(domainId) : undefined;
		if (!db) throw new MemoryError("not-open", `memória do domínio "${String(domainId)}" não está aberta`);
		return db;
	}

	private handle(domainId: string): MemoryDb {
		if (this.closed) throw new MemoryError("closed", "serviço de memória já fechado");
		const existing = this.handles.get(domainId);
		if (existing) {
			this.handles.delete(domainId);
			this.handles.set(domainId, existing);
			return existing;
		}
		const o = this.options;
		const embedder = typeof o.embedder === "function" ? o.embedder(domainId) : o.embedder;
		const extractor = o.extractorFor?.(domainId);
		const curriculum = o.curriculumFor?.(domainId);
		const learner = o.learnerFor?.(domainId);
		const title = o.titleFor?.(domainId);
		const db = MemoryDb.open(o.dirFor(domainId), {
			domainId,
			embedder,
			...(extractor ? { extractor } : {}),
			...(curriculum ? { curriculum } : {}),
			...(learner ? { learner } : {}),
			...(o.profile ? { profile: o.profile } : {}),
			...(o.settings ? { settings: o.settings } : {}),
			...(o.clock ? { clock: o.clock } : {}),
			...(title ? { title } : {}),
			...(o.onError ? { onError: (error: unknown, op: string) => o.onError?.(error, op, domainId) } : {}),
		});
		this.handles.set(domainId, db);
		return db;
	}

	private async evict(): Promise<void> {
		const victims: MemoryDb[] = [];
		for (const [id, db] of this.handles) {
			if (this.handles.size - victims.length <= this.maxOpen) break;
			if (id === this.activeId) continue;
			victims.push(db);
		}
		for (const db of victims) this.handles.delete(db.domainId);
		await Promise.all(victims.map((db) => db.close()));
	}
}
