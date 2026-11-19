/**
 * AnkiConnect client and push/revlog sync, called from the plugin's Node backend
 * (SÍNTESE §2.4(d) item 5; r7 §8.3–8.4).
 *
 * Transport: AnkiConnect 26.11.15.0 API v1 first — JSON-RPC 2.0 at
 * `POST <base>/api/v1`, batches of at most 100 calls, `Authorization: Bearer <key>`,
 * operation-completion results polled through `operations.get`. When the server does
 * not answer JSON-RPC there (older add-on), the legacy v6 protocol is used at
 * `POST <base>/` (`{action, version: 6, params, key}`), with `multi` for batches.
 * The v1 call shapes follow the method list in r7 §6.2 (the full schema was not
 * vendored), so a v1 "method not found"/"invalid params"/unsupportedCapability/
 * compatibilityError reruns the whole task on v6 (`withV6Fallback`), which the same
 * add-on keeps serving (r7 §10 item 5: "mantenha o fallback v6").
 * Only loopback URLs are accepted (sync-types.normalizeAnkiConnectUrl).
 *
 * Sync rules:
 * - own note types whose FIRST field is `LH_ID` (v1 has no GUID access, and Anki's
 *   duplicate check uses the first field), decks `LearnHarness::<Domínio>::<Região>`,
 *   tags `lh::dom::<id>`;
 * - notes are matched by LH_ID across all LearnHarness note types, so a re-push updates
 *   in place and never duplicates (creation also sets `duplicates.allow = false`);
 * - the app is the source of card content: changed fields are overwritten, user tags
 *   outside `lh::` are preserved, notes whose cue disappeared are reported, never deleted;
 * - revlog import maps Anki reviews to `RevlogEntry` (origin "anki") after the cursor,
 *   skipping manual/rescheduled/filtered entries that are not memory evidence; answer
 *   time is capped at 60 s (r7 §8.4). Cards of notes that already existed when a push
 *   linked them (`adoptedCardIds`, e.g. from an imported .apkg) are read from the start
 *   of their history once, since their reviews may predate the cursor.
 */

import { ankiDeckName, ankiNoteContent, NOTE_TEMPLATES, NOTE_TYPE_CSS, NOTE_TYPES, type CardKind, type ExportCard } from "./export-model.ts";
import { normalizeAnkiConnectUrl, type AnkiApiFlavor, type ExternalLink, type RevlogEntry, type SyncCursor } from "./sync-types.ts";

export const ANKI_BATCH_LIMIT = 100;
const DEFAULT_TIMEOUT_MS = 15_000;
const OPERATION_POLL_MS = 100;

export class AnkiUnavailableError extends Error {
	constructor(url: string, cause?: unknown) {
		super(`O Anki não está aberto ou o AnkiConnect não respondeu em ${url}.`, { cause });
		this.name = "AnkiUnavailableError";
	}
}

export class AnkiConnectError extends Error {
	readonly type: string | undefined;
	/** JSON-RPC error code (API v1 only). */
	readonly code: number | undefined;
	constructor(message: string, type?: string, code?: number) {
		super(`AnkiConnect: ${message}`);
		this.name = "AnkiConnectError";
		this.type = type;
		this.code = code;
	}
}

export interface AnkiConnectOptions {
	url: string;
	apiKey?: string | null;
	timeoutMs?: number;
	fetch?: typeof fetch;
}

export interface AnkiNote {
	noteId: number;
	noteType: string;
	fields: Record<string, string>;
	tags: string[];
	cardIds: number[];
	mtime: number;
}

export interface AnkiNoteInput {
	noteType: string;
	deck: string;
	fields: Record<string, string>;
	tags: string[];
}

export type AnkiReviewKind = "learning" | "review" | "relearning" | "filtered" | "manual" | "rescheduled";

export interface AnkiReview {
	id: number;
	cardId: number;
	at: number;
	rating: 1 | 2 | 3 | 4 | null;
	kind: AnkiReviewKind;
	durationMs: number;
}

export interface NoteTypeDefinition {
	name: string;
	fields: readonly string[];
	kind: "normal" | "cloze";
	sortField: string;
	css: string;
	templates: ReadonlyArray<{ name: string; question: string; answer: string }>;
}

export type CreateResult = { noteId: number; cardIds: number[] } | { error: string };

/** The operations sync needs, implemented once per protocol flavor. */
export interface AnkiApi {
	readonly flavor: AnkiApiFlavor;
	profile(): Promise<string>;
	noteTypeNames(): Promise<string[]>;
	createNoteType(definition: NoteTypeDefinition): Promise<void>;
	deckNames(): Promise<string[]>;
	createDeck(name: string): Promise<void>;
	findNotes(query: string): Promise<number[]>;
	notes(ids: readonly number[]): Promise<AnkiNote[]>;
	createNotes(notes: readonly AnkiNoteInput[]): Promise<CreateResult[]>;
	updateNotes(updates: ReadonlyArray<{ noteId: number; fields: Record<string, string>; tags: string[] }>): Promise<Array<string | null>>;
	moveCards(cardIds: readonly number[], deck: string): Promise<void>;
	reviews(cardIds: readonly number[], afterId: number): Promise<AnkiReview[]>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function chunks<T>(items: readonly T[], size = ANKI_BATCH_LIMIT): T[][] {
	const result: T[][] = [];
	for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
	return result;
}

/** Anki ids are positive int64 values; the ones Anki mints (epoch ms) are JS-safe. */
export function toAnkiId(value: unknown): number {
	const id = typeof value === "string" && /^[1-9]\d*$/.test(value) ? Number(value) : value;
	if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) throw new AnkiConnectError(`id inválido recebido do Anki: ${String(value)}`, "invalidId");
	return id;
}

/** Search term for one field value (Anki search escaping inside double quotes). */
export function fieldQuery(field: string, value: string): string {
	return `"${field}:${value.replace(/[\\"*_]/g, (character) => `\\${character}`)}"`;
}

async function postJson(url: string, body: unknown, options: AnkiConnectOptions, headers: Record<string, string> = {}): Promise<{ status: number; json: unknown }> {
	const fetchImpl = options.fetch ?? fetch;
	let response: Response;
	try {
		response = await fetchImpl(url, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...headers },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
		});
	} catch (error) {
		throw new AnkiUnavailableError(options.url, error);
	}
	const text = await response.text();
	try { return { status: response.status, json: JSON.parse(text) as unknown }; } catch { return { status: response.status, json: undefined }; }
}

// ---------------------------------------------------------------- API v1 (JSON-RPC)

interface RpcCall { method: string; params: Record<string, unknown> }
type RpcOutcome = { ok: true; result: unknown } | { ok: false; error: AnkiConnectError };

function rpcError(value: unknown): AnkiConnectError {
	if (!isRecord(value)) return new AnkiConnectError("erro desconhecido");
	const data = isRecord(value.data) ? value.data : {};
	return new AnkiConnectError(
		String(value.message ?? "erro desconhecido"),
		typeof data.type === "string" ? data.type : undefined,
		typeof value.code === "number" ? value.code : undefined,
	);
}

/** JSON-RPC "method not found"/"invalid params" and AnkiConnect's unsupportedCapability/compatibilityError. */
const V1_CONTRACT_CODES = new Set([-32601, -32602, 1006, 1016]);
const V1_CONTRACT_TYPES = new Set(["methodNotFound", "invalidParams", "unsupportedCapability", "compatibilityError"]);

/**
 * True when API v1 rejected the shape of a call rather than its content: the add-on
 * speaks another revision of the v1 contract, so the legacy v6 protocol (which the
 * same add-on still serves at `/`) is the reliable path.
 */
export function isV1ContractError(error: unknown): boolean {
	return error instanceof AnkiConnectError && ((error.code !== undefined && V1_CONTRACT_CODES.has(error.code)) || (error.type !== undefined && V1_CONTRACT_TYPES.has(error.type)));
}

function isOperation(value: unknown): value is { operationId: string } {
	return isRecord(value) && typeof value.operationId === "string" && typeof value.method === "string" && "session" in value;
}

class V1Transport {
	private nextId = 1;
	private readonly options: AnkiConnectOptions;
	constructor(options: AnkiConnectOptions) {
		this.options = options;
	}

	private headers(): Record<string, string> {
		return this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}` } : {};
	}

	private async send(calls: readonly RpcCall[]): Promise<RpcOutcome[]> {
		const envelopes = calls.map((call) => ({ jsonrpc: "2.0", id: this.nextId++, method: call.method, params: call.params }));
		const single = envelopes.length === 1;
		const { status, json } = await postJson(`${this.options.url}/api/v1`, single ? envelopes[0] : envelopes, this.options, this.headers());
		const replies = Array.isArray(json) ? json : [json];
		const byId = new Map<unknown, Record<string, unknown>>();
		for (const reply of replies) if (isRecord(reply)) byId.set(reply.id, reply);
		return envelopes.map((envelope) => {
			const reply = byId.get(envelope.id) ?? (single && isRecord(json) && json.id === null ? json : undefined);
			if (!reply || reply.jsonrpc !== "2.0") return { ok: false, error: new AnkiConnectError(`resposta inválida da API v1 (HTTP ${status})`) };
			if ("error" in reply && reply.error != null) return { ok: false, error: rpcError(reply.error) };
			return { ok: true, result: reply.result };
		});
	}

	private async settle(result: unknown): Promise<unknown> {
		if (!isOperation(result)) return result;
		const deadline = Date.now() + (this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS) * 4;
		for (;;) {
			const record = await this.call("operations.get", { operationId: result.operationId }, false);
			if (isRecord(record) && record.state === "succeeded") return record.result;
			if (isRecord(record) && (record.state === "failed" || record.state === "cancelled")) throw rpcError(record.error ?? { message: `operação ${String(record.state)}` });
			if (Date.now() > deadline) throw new AnkiConnectError("a operação do Anki não terminou a tempo", "timeout");
			await new Promise((resolve) => setTimeout(resolve, OPERATION_POLL_MS));
		}
	}

	async call(method: string, params: Record<string, unknown> = {}, settle = true): Promise<unknown> {
		const [outcome] = await this.send([{ method, params }]);
		if (!outcome) throw new AnkiConnectError("resposta vazia da API v1");
		if (!outcome.ok) throw outcome.error;
		return settle ? this.settle(outcome.result) : outcome.result;
	}

	async batch(calls: readonly RpcCall[]): Promise<RpcOutcome[]> {
		const outcomes: RpcOutcome[] = [];
		for (const group of chunks(calls)) {
			for (const outcome of await this.send(group)) {
				if (!outcome.ok) { outcomes.push(outcome); continue; }
				try { outcomes.push({ ok: true, result: await this.settle(outcome.result) }); } catch (error) {
					outcomes.push({ ok: false, error: error instanceof AnkiConnectError ? error : new AnkiConnectError(String(error)) });
				}
			}
		}
		return outcomes;
	}
}

const listOf = (value: unknown): unknown[] => Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.items) ? value.items : [];
const nameOf = (value: unknown): string | null => isRecord(value) && typeof value.name === "string" ? value.name : typeof value === "string" ? value : null;
const RATINGS: Record<string, 1 | 2 | 3 | 4> = { again: 1, hard: 2, good: 3, easy: 4 };
const V6_KINDS: AnkiReviewKind[] = ["learning", "review", "relearning", "filtered", "manual", "rescheduled"];

function fieldValue(value: unknown): string {
	if (typeof value === "string") return value;
	if (isRecord(value) && typeof value.value === "string") return value.value;
	return "";
}

function timeOf(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value)) return value < 1e11 ? value * 1000 : value;
	if (typeof value === "string") { const parsed = Date.parse(value); if (Number.isFinite(parsed)) return parsed; }
	return 0;
}

function v1Note(value: unknown): AnkiNote | null {
	if (!isRecord(value)) return null;
	const fields: Record<string, string> = {};
	for (const [name, field] of Object.entries(isRecord(value.fields) ? value.fields : {})) fields[name] = fieldValue(field);
	return {
		noteId: toAnkiId(value.id),
		noteType: nameOf(value.noteType) ?? "",
		fields,
		tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === "string") : [],
		cardIds: (Array.isArray(value.cardIds) ? value.cardIds : []).map(toAnkiId),
		mtime: timeOf(value.modifiedAt),
	};
}

/** A rating as a name ("good") or as Anki's ease number (1–4); anything else is not a grade. */
function ratingOf(value: unknown): AnkiReview["rating"] {
	if (typeof value === "string") return RATINGS[value.toLowerCase()] ?? null;
	return value === 1 || value === 2 || value === 3 || value === 4 ? value : null;
}

/** A review kind as a name or as the revlog `type` number (0 learning … 5 rescheduled). */
function kindOf(value: unknown): AnkiReviewKind {
	if (typeof value === "number") return V6_KINDS[value] ?? "manual";
	return V6_KINDS.includes(value as AnkiReviewKind) ? value as AnkiReviewKind : "manual";
}

function v1Review(value: unknown): AnkiReview | null {
	if (!isRecord(value)) return null;
	const id = toAnkiId(value.id);
	return {
		id,
		cardId: toAnkiId(value.cardId),
		// A revlog id is the answer time in epoch milliseconds.
		at: timeOf(value.answeredAt) || id,
		rating: ratingOf(value.rating),
		kind: kindOf(value.kind),
		durationMs: typeof value.elapsedMs === "number" ? value.elapsedMs : 0,
	};
}

export function createV1Api(options: AnkiConnectOptions): AnkiApi {
	const rpc = new V1Transport(options);
	const failures = (outcomes: RpcOutcome[]): Array<string | null> => outcomes.map((outcome) => outcome.ok ? null : outcome.error.message);
	return {
		flavor: "v1",
		async profile() {
			const collection = await rpc.call("collection.get");
			const profile = isRecord(collection) ? nameOf(collection.profile) ?? (typeof collection.profile === "string" ? collection.profile : null) : null;
			if (!profile) throw new AnkiConnectError("nenhum perfil do Anki está aberto", "noCollection");
			return profile;
		},
		async noteTypeNames() { return listOf(await rpc.call("noteTypes.list")).map(nameOf).filter((name): name is string => !!name); },
		async createNoteType(definition) {
			await rpc.call("noteTypes.create", {
				name: definition.name,
				fields: definition.fields.map((name) => ({ name })),
				templates: definition.templates.map((template) => ({ name: template.name, questionHtml: template.question, answerHtml: template.answer })),
				kind: definition.kind,
				css: definition.css,
				sortField: definition.sortField,
			});
		},
		async deckNames() { return listOf(await rpc.call("decks.list")).map(nameOf).filter((name): name is string => !!name); },
		async createDeck(name) { await rpc.call("decks.create", { name }); },
		async findNotes(query) {
			const ids: number[] = [];
			let cursor: unknown = null;
			do {
				const page = await rpc.call("notes.search", { query, limit: ANKI_BATCH_LIMIT, ...(cursor ? { cursor } : {}) });
				if (!isRecord(page)) throw new AnkiConnectError("resposta inválida de notes.search");
				ids.push(...(Array.isArray(page.ids) ? page.ids : []).map(toAnkiId));
				cursor = page.nextCursor ?? null;
			} while (cursor);
			return ids;
		},
		async notes(ids) {
			const notes: AnkiNote[] = [];
			for (const group of chunks(ids)) {
				const reply = await rpc.call("notes.getMany", { ids: group.map(String) });
				for (const item of listOf(reply)) {
					const note = v1Note(isRecord(item) && "result" in item ? item.result : null);
					if (note) notes.push(note);
				}
			}
			return notes;
		},
		async createNotes(notes) {
			const results: CreateResult[] = [];
			for (const group of chunks(notes)) {
				const reply = await rpc.call("notes.createMany", {
					notes: group.map((note) => ({
						noteType: { name: note.noteType },
						deck: { name: note.deck },
						fields: note.fields,
						tags: note.tags,
						duplicates: { allow: false, scope: "collection" },
					})),
					atomic: false,
				});
				const items = listOf(reply);
				group.forEach((_, index) => {
					const item = items.find((candidate) => isRecord(candidate) && candidate.index === index) ?? items[index];
					if (isRecord(item) && isRecord(item.result)) results.push({ noteId: toAnkiId(item.result.noteId), cardIds: (Array.isArray(item.result.cardIds) ? item.result.cardIds : []).map(toAnkiId) });
					else results.push({ error: isRecord(item) && item.error ? rpcError(item.error).message : "AnkiConnect: nota não criada" });
				});
			}
			return results;
		},
		async updateNotes(updates) {
			const outcomes = await rpc.batch(updates.map((update) => ({ method: "notes.update", params: { id: String(update.noteId), patch: { fields: update.fields, tags: update.tags } } })));
			// A contract mismatch is not a per-note failure: surface it so the caller can fall back to v6.
			const mismatch = outcomes.find((outcome) => !outcome.ok && isV1ContractError(outcome.error));
			if (mismatch && !mismatch.ok) throw mismatch.error;
			return failures(outcomes);
		},
		async moveCards(cardIds, deck) {
			for (const group of chunks(cardIds)) await rpc.call("cards.move", { ids: group.map(String), deck: { name: deck } });
		},
		async reviews(cardIds, afterId) {
			const reviews: AnkiReview[] = [];
			for (const group of chunks(cardIds)) {
				let cursor: unknown = null;
				do {
					const page = await rpc.call("reviews.list", { cardIds: group.map(String), ...(afterId > 0 ? { afterId: String(afterId) } : {}), includeManual: false, limit: ANKI_BATCH_LIMIT, ...(cursor ? { cursor } : {}) });
					for (const item of listOf(page)) { const review = v1Review(item); if (review) reviews.push(review); }
					cursor = isRecord(page) ? page.nextCursor ?? null : null;
				} while (cursor);
			}
			return reviews;
		},
	};
}

// ---------------------------------------------------------------- API v6 (legacy)

class V6Transport {
	private readonly options: AnkiConnectOptions;
	constructor(options: AnkiConnectOptions) {
		this.options = options;
	}

	async call(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
		const body = { action, version: 6, params, ...(this.options.apiKey ? { key: this.options.apiKey } : {}) };
		const { status, json } = await postJson(`${this.options.url}/`, body, this.options);
		if (!isRecord(json) || !("result" in json) || !("error" in json)) throw new AnkiConnectError(`resposta inválida da API v6 (HTTP ${status})`);
		if (json.error != null) throw new AnkiConnectError(String(json.error));
		return json.result;
	}

	/** `multi`: one HTTP request, one {result, error} per action. */
	async multi(actions: ReadonlyArray<{ action: string; params: Record<string, unknown> }>): Promise<Array<{ result: unknown; error: string | null }>> {
		const outcomes: Array<{ result: unknown; error: string | null }> = [];
		for (const group of chunks(actions)) {
			const reply = await this.call("multi", { actions: group.map((action) => ({ ...action, version: 6 })) });
			const items = Array.isArray(reply) ? reply : [];
			group.forEach((_, index) => {
				const item = items[index];
				if (isRecord(item) && "error" in item) outcomes.push({ result: item.result, error: item.error == null ? null : String(item.error) });
				else outcomes.push({ result: item, error: null });
			});
		}
		return outcomes;
	}
}

function v6Note(value: unknown): AnkiNote | null {
	if (!isRecord(value) || value.noteId === undefined) return null;
	const fields: Record<string, string> = {};
	for (const [name, field] of Object.entries(isRecord(value.fields) ? value.fields : {})) fields[name] = fieldValue(field);
	return {
		noteId: toAnkiId(value.noteId),
		noteType: typeof value.modelName === "string" ? value.modelName : "",
		fields,
		tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === "string") : [],
		cardIds: (Array.isArray(value.cards) ? value.cards : []).map(toAnkiId),
		mtime: timeOf(value.mod),
	};
}

export function createV6Api(options: AnkiConnectOptions): AnkiApi {
	const api = new V6Transport(options);
	const client: AnkiApi = {
		flavor: "v6",
		async profile() {
			const profile = await api.call("getActiveProfile");
			if (typeof profile !== "string" || !profile) throw new AnkiConnectError("nenhum perfil do Anki está aberto", "noCollection");
			return profile;
		},
		async noteTypeNames() { const names = await api.call("modelNames"); return Array.isArray(names) ? names.filter((name): name is string => typeof name === "string") : []; },
		async createNoteType(definition) {
			await api.call("createModel", {
				modelName: definition.name,
				inOrderFields: [...definition.fields],
				css: definition.css,
				isCloze: definition.kind === "cloze",
				cardTemplates: definition.templates.map((template) => ({ Name: template.name, Front: template.question, Back: template.answer })),
			});
		},
		async deckNames() { const names = await api.call("deckNames"); return Array.isArray(names) ? names.filter((name): name is string => typeof name === "string") : []; },
		async createDeck(name) { await api.call("createDeck", { deck: name }); },
		async findNotes(query) { const ids = await api.call("findNotes", { query }); return (Array.isArray(ids) ? ids : []).map(toAnkiId); },
		async notes(ids) {
			const notes: AnkiNote[] = [];
			for (const group of chunks(ids)) {
				const reply = await api.call("notesInfo", { notes: group });
				for (const item of Array.isArray(reply) ? reply : []) { const note = v6Note(item); if (note) notes.push(note); }
			}
			return notes;
		},
		async createNotes(notes) {
			const outcomes = await api.multi(notes.map((note) => ({
				action: "addNote",
				params: { note: { deckName: note.deck, modelName: note.noteType, fields: note.fields, tags: note.tags, options: { allowDuplicate: false, duplicateScope: "collection" } } },
			})));
			const created = outcomes.map((outcome) => outcome.error ? null : outcome.result).map((id) => id == null ? null : toAnkiId(id));
			const info = new Map((await client.notes(created.filter((id): id is number => id !== null))).map((note) => [note.noteId, note]));
			return outcomes.map((outcome, index): CreateResult => {
				const noteId = created[index];
				if (noteId == null) return { error: `AnkiConnect: ${outcome.error ?? "nota não criada"}` };
				return { noteId, cardIds: info.get(noteId)?.cardIds ?? [] };
			});
		},
		async updateNotes(updates) {
			const outcomes = await api.multi(updates.map((update) => ({ action: "updateNote", params: { note: { id: update.noteId, fields: update.fields, tags: update.tags } } })));
			return outcomes.map((outcome) => outcome.error ? `AnkiConnect: ${outcome.error}` : null);
		},
		async moveCards(cardIds, deck) {
			for (const group of chunks(cardIds)) await api.call("changeDeck", { cards: group, deck });
		},
		async reviews(cardIds, afterId) {
			const reviews: AnkiReview[] = [];
			for (const group of chunks(cardIds)) {
				const reply = await api.call("getReviewsOfCards", { cards: group.map(String) });
				for (const [cardId, entries] of Object.entries(isRecord(reply) ? reply : {})) {
					for (const entry of Array.isArray(entries) ? entries : []) {
						if (!isRecord(entry)) continue;
						const id = toAnkiId(entry.id);
						if (id <= afterId) continue;
						const ease = typeof entry.ease === "number" ? entry.ease : 0;
						reviews.push({
							id,
							cardId: toAnkiId(cardId),
							at: id,
							rating: ease >= 1 && ease <= 4 ? ease as 1 | 2 | 3 | 4 : null,
							kind: V6_KINDS[typeof entry.type === "number" ? entry.type : 4] ?? "manual",
							durationMs: typeof entry.time === "number" ? entry.time : 0,
						});
					}
				}
			}
			return reviews;
		},
	};
	return client;
}

/**
 * Connects to AnkiConnect: API v1 when `/api/v1` answers JSON-RPC, otherwise v6 at `/`.
 * Throws AnkiUnavailableError when nothing listens (Anki closed).
 */
export async function connectAnki(options: AnkiConnectOptions): Promise<AnkiApi> {
	const url = normalizeAnkiConnectUrl(options.url);
	const resolved = { ...options, url };
	const probe = await postJson(`${url}/api/v1`, { jsonrpc: "2.0", id: 0, method: "api.describe", params: {} }, resolved, resolved.apiKey ? { Authorization: `Bearer ${resolved.apiKey}` } : {});
	if (isRecord(probe.json) && probe.json.jsonrpc === "2.0") {
		if (probe.json.error != null) {
			const error = rpcError(probe.json.error);
			if (/auth|key|permission/i.test(`${error.type ?? ""} ${error.message}`)) throw error;
		}
		return createV1Api(resolved);
	}
	return connectV6(resolved);
}

async function connectV6(options: AnkiConnectOptions): Promise<AnkiApi> {
	const version = await new V6Transport(options).call("version");
	if (typeof version !== "number" || version < 6) throw new AnkiConnectError(`versão do AnkiConnect não suportada: ${String(version)}`);
	return createV6Api(options);
}

/**
 * Runs `task` on the connected API and, when API v1 rejects the shape of a call
 * (isV1ContractError), reruns it once on the legacy v6 protocol of the same add-on.
 * Rerunning is safe: push and revlog import are idempotent by LH_ID and revlog id, so
 * notes created before the failure are found again instead of duplicated.
 */
export async function withV6Fallback<T>(api: AnkiApi, options: AnkiConnectOptions, task: (api: AnkiApi) => Promise<T>): Promise<T> {
	try {
		return await task(api);
	} catch (error) {
		if (api.flavor !== "v1" || !isV1ContractError(error)) throw error;
		let legacy: AnkiApi;
		try {
			legacy = await connectV6({ ...options, url: normalizeAnkiConnectUrl(options.url) });
		} catch {
			throw error;
		}
		return task(legacy);
	}
}

// ---------------------------------------------------------------- push

export const LH_TAG_PREFIX = "lh::";

export function noteTypeDefinition(kind: CardKind): NoteTypeDefinition {
	const type = NOTE_TYPES[kind];
	return { name: type.name, fields: type.fields, kind: type.kind, sortField: type.sortField, css: NOTE_TYPE_CSS, templates: NOTE_TEMPLATES[kind] };
}

/** Our tags replace previous `lh::` tags; tags the user added in Anki are kept. */
export function mergeTags(current: readonly string[], ours: readonly string[]): string[] {
	const kept = current.filter((tag) => !tag.toLowerCase().startsWith(LH_TAG_PREFIX));
	return [...new Set([...kept, ...ours])];
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
	const left = new Set(a.map((tag) => tag.toLowerCase()));
	const right = new Set(b.map((tag) => tag.toLowerCase()));
	return left.size === right.size && [...left].every((tag) => right.has(tag));
}

function sameFields(current: Record<string, string>, desired: Record<string, string>): boolean {
	return Object.entries(desired).every(([name, value]) => current[name] === value);
}

export interface AnkiPushResult {
	flavor: AnkiApiFlavor;
	profile: string;
	created: number;
	updated: number;
	unchanged: number;
	moved: number;
	failed: Array<{ lhId: string; error: string }>;
	/** LearnHarness notes of this domain whose cue no longer exists (left untouched). */
	orphans: number;
	/** Extra notes sharing an LH_ID (left untouched; the oldest is the one kept in sync). */
	duplicates: number;
	links: Record<string, NonNullable<ExternalLink["anki"]>>;
	/**
	 * Cards of notes that already existed in Anki and are linked by this push (an
	 * imported .apkg, a lost link): their reviews may predate the revlog cursor.
	 */
	adoptedCardIds: number[];
}

/** Finds every LearnHarness note (any of our note types) and indexes it by LH_ID. */
async function indexNotes(api: AnkiApi): Promise<{ byLhId: Map<string, AnkiNote>; duplicates: number; all: AnkiNote[] }> {
	const query = Object.values(NOTE_TYPES).map((type) => fieldQuery("note", type.name)).join(" OR ");
	const ids = await api.findNotes(`(${query})`);
	const all = (await api.notes(ids)).sort((a, b) => a.noteId - b.noteId);
	const byLhId = new Map<string, AnkiNote>();
	let duplicates = 0;
	for (const note of all) {
		const lhId = note.fields.LH_ID?.trim();
		if (!lhId) continue;
		if (byLhId.has(lhId)) duplicates++;
		else byLhId.set(lhId, note);
	}
	return { byLhId, duplicates, all };
}

export async function pushToAnki(api: AnkiApi, cards: readonly ExportCard[], previous: Readonly<Record<string, ExternalLink["anki"] | undefined>>, now: Date = new Date()): Promise<AnkiPushResult> {
	const profile = await api.profile();
	const kinds = [...new Set(cards.map((card) => card.kind))];
	const noteTypes = new Set(await api.noteTypeNames());
	for (const kind of kinds) if (!noteTypes.has(NOTE_TYPES[kind].name)) await api.createNoteType(noteTypeDefinition(kind));
	const decks = new Set(await api.deckNames());
	for (const deck of [...new Set(cards.map(ankiDeckName))]) if (!decks.has(deck)) await api.createDeck(deck);

	const { byLhId, duplicates, all } = await indexNotes(api);
	const result: AnkiPushResult = { flavor: api.flavor, profile, created: 0, updated: 0, unchanged: 0, moved: 0, failed: [], orphans: 0, duplicates, links: {}, adoptedCardIds: [] };
	const pushedAt = now.toISOString();
	const toCreate: Array<{ card: ExportCard; input: AnkiNoteInput }> = [];
	const toUpdate: Array<{ card: ExportCard; note: AnkiNote; fields: Record<string, string>; tags: string[] }> = [];
	const moves = new Map<string, number[]>();

	for (const card of cards) {
		const content = ankiNoteContent(card);
		const noteType = NOTE_TYPES[content.noteType].name;
		const deck = ankiDeckName(card);
		const note = byLhId.get(card.lhId);
		if (!note || note.noteType !== noteType) {
			if (note) result.failed.push({ lhId: card.lhId, error: `A nota ${note.noteId} usa o tipo "${note.noteType}"; mude o tipo no Anki ou apague a nota.` });
			else toCreate.push({ card, input: { noteType, deck, fields: content.fields, tags: card.tags } });
			continue;
		}
		const tags = mergeTags(note.tags, card.tags);
		const link = previous[card.cueId];
		if (sameFields(note.fields, content.fields) && sameTags(note.tags, tags)) result.unchanged++;
		else toUpdate.push({ card, note, fields: content.fields, tags });
		if (link?.noteId !== note.noteId || link.deck !== deck) moves.set(deck, [...moves.get(deck) ?? [], ...note.cardIds]);
		if (link?.noteId !== note.noteId) result.adoptedCardIds.push(...note.cardIds);
		result.links[card.cueId] = { noteId: note.noteId, cardIds: note.cardIds, noteType, deck, contentHash: card.contentHash, pushedAt: link?.contentHash === card.contentHash && link.noteId === note.noteId ? link.pushedAt : pushedAt, mtime: note.mtime };
	}

	const updateErrors = await api.updateNotes(toUpdate.map(({ note, fields, tags }) => ({ noteId: note.noteId, fields, tags })));
	toUpdate.forEach(({ card }, index) => {
		const error = updateErrors[index];
		if (error) { result.failed.push({ lhId: card.lhId, error }); delete result.links[card.cueId]; }
		else { result.updated++; const link = result.links[card.cueId]; if (link) link.pushedAt = pushedAt; }
	});
	for (const [deck, cardIds] of moves) {
		if (!cardIds.length) continue;
		await api.moveCards(cardIds, deck);
		result.moved += cardIds.length;
	}

	const created = await api.createNotes(toCreate.map(({ input }) => input));
	toCreate.forEach(({ card, input }, index) => {
		const outcome = created[index];
		if (!outcome || "error" in outcome) { result.failed.push({ lhId: card.lhId, error: outcome?.error ?? "nota não criada" }); return; }
		result.created++;
		result.links[card.cueId] = { noteId: outcome.noteId, cardIds: outcome.cardIds, noteType: input.noteType, deck: input.deck, contentHash: card.contentHash, pushedAt, mtime: now.getTime() };
	});

	const exported = new Set(cards.map((card) => card.lhId));
	const domainTags = new Set(cards.flatMap((card) => card.tags.filter((tag) => tag.startsWith("lh::dom::"))).map((tag) => tag.toLowerCase()));
	result.orphans = all.filter((note) => {
		const lhId = note.fields.LH_ID?.trim();
		return lhId && !exported.has(lhId) && note.tags.some((tag) => domainTags.has(tag.toLowerCase()));
	}).length;
	return result;
}

// ---------------------------------------------------------------- revlog

export interface RevlogImport {
	entries: RevlogEntry[];
	skipped: number;
	latestId: number;
}

/** Answer times above Anki's default cap are idle time, not effort (r7 §8.4: `Math.min(r.time, 60_000)`). */
export const MAX_REVIEW_DURATION_MS = 60_000;

/** Ratings with a memory effect only: manual/rescheduled/filtered entries are skipped. */
export function toRevlogEntry(review: AnkiReview, link: Pick<ExternalLink, "cueId" | "propositionId">): RevlogEntry | null {
	if (review.rating === null || review.kind === "manual" || review.kind === "rescheduled" || review.kind === "filtered" || !Number.isFinite(review.at) || review.at <= 0) return null;
	return {
		id: `anki:${review.id}`,
		propositionId: link.propositionId,
		cueId: link.cueId,
		at: new Date(review.at).toISOString(),
		rating: review.rating,
		durationMs: Math.min(Math.max(0, Math.round(review.durationMs)), MAX_REVIEW_DURATION_MS),
		origin: "anki",
	};
}

/**
 * Reviews of the linked cards after the cursor. `backfill` cards (adopted after the
 * cursor was set) are read from the start of their history, so reviews made before
 * they were linked are not lost; ids already imported are deduplicated by the caller.
 */
export async function importAnkiRevlog(api: AnkiApi, links: Readonly<Record<string, ExternalLink>>, cursor: SyncCursor | null, profile: string, backfill: readonly number[] = []): Promise<RevlogImport> {
	const byCard = new Map<number, ExternalLink>();
	for (const link of Object.values(links)) for (const cardId of link.anki?.cardIds ?? []) byCard.set(cardId, link);
	const afterId = cursor && cursor.ankiProfile === profile ? cursor.ankiLatestRevlogId : 0;
	const result: RevlogImport = { entries: [], skipped: 0, latestId: afterId };
	if (!byCard.size) return result;
	const full = new Set(afterId > 0 ? backfill.filter((cardId) => byCard.has(cardId)) : []);
	const sorted = (ids: Iterable<number>): number[] => [...ids].sort((a, b) => a - b);
	const regular = sorted([...byCard.keys()].filter((cardId) => !full.has(cardId)));
	const reviews = [
		...regular.length ? await api.reviews(regular, afterId) : [],
		...full.size ? await api.reviews(sorted(full), 0) : [],
	];
	const seen = new Set<number>();
	for (const review of reviews) {
		if ((review.id <= afterId && !full.has(review.cardId)) || seen.has(review.id)) continue;
		seen.add(review.id);
		result.latestId = Math.max(result.latestId, review.id);
		const link = byCard.get(review.cardId);
		const entry = link ? toRevlogEntry(review, link) : null;
		if (entry) result.entries.push(entry);
		else result.skipped++;
	}
	result.entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
	return result;
}
