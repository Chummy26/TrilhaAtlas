/**
 * AnkiConnect client + sync (plugins/flashcards/src/anki-connect.ts), SÍNTESE §2.4(d)
 * item 5 and M4 ("re-export idempotente: 0 duplicatas por LH_ID"; revlog → evidence).
 *
 * A fake AnkiConnect HTTP server holds an in-memory collection and speaks both
 * protocols: API v1 (JSON-RPC 2.0 at /api/v1, ≤100 items per batch, Bearer key,
 * operation polling) and legacy v6 at / (with /api/v1 answering like an old add-on).
 * Regressions: numeric v1 ratings, the 60 s answer-time cap (r7 §8.4), reviews of notes
 * adopted after the revlog cursor, review-only-in-Anki New cards, deck due counts in
 * review mode "anki", and the Anki-closed .apkg duplicating notes Anki already holds.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as http from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	AnkiConnectError,
	AnkiUnavailableError,
	MAX_REVIEW_DURATION_MS,
	connectAnki,
	fieldQuery,
	importAnkiRevlog,
	pushToAnki,
	withV6Fallback,
	type AnkiPushResult,
} from "../plugins/flashcards/src/anki-connect.ts";
import { collectExportCards, type ExportCard, type ExportSource } from "../plugins/flashcards/src/export-model.ts";
import { replayMemory } from "../plugins/flashcards/src/fsrs7.ts";
import type { ExternalLink } from "../plugins/flashcards/src/sync-types.ts";

type Json = Record<string, unknown>;

interface FakeNote { id: number; model: string; deck: string; fields: Record<string, string>; tags: string[]; cards: number[]; mod: number }
interface FakeReview { id: number; cardId: number; ease: number; time: number; type: number }

const RATING_NAMES = ["again", "hard", "good", "easy"];
const KINDS = ["learning", "review", "relearning", "filtered", "manual", "rescheduled"];
const BATCH_LIMIT = 100;

/** In-memory Anki collection behind a fake AnkiConnect. */
class FakeAnki {
	profile = "Usuário 1";
	models = new Map<string, { id: number; fields: string[]; cloze: boolean; templates: number }>();
	decks = new Map<string, number>([["Default", 1]]);
	notes = new Map<number, FakeNote>();
	reviewLog: FakeReview[] = [];
	authorization: string[] = [];
	/** v1 methods this add-on revision rejects, with the JSON-RPC error code it answers. */
	v1Rejects = new Map<string, number>();
	largestBatch = 0;
	/** v1 add-on revision that answers ratings/kinds as revlog numbers and omits answeredAt. */
	numericReviews = false;
	operationPolls = 0;
	private nextId = 1_700_000_000_000;
	private operations = new Map<string, { result: unknown; polls: number }>();
	private cursors = new Map<string, number[]>();

	constructor(readonly mode: "v1" | "v6", readonly apiKey: string | null = null) {}

	id(): number { return this.nextId++; }

	track(size: number): void {
		this.largestBatch = Math.max(this.largestBatch, size);
		if (size > BATCH_LIMIT) throw Object.assign(new Error(`batch too large: ${size}`), { type: "limitExceeded" });
	}

	search(query: string): number[] {
		const names = [...query.matchAll(/"note:([^"]+)"/g)].map((match) => match[1]);
		return [...this.notes.values()].filter((note) => names.includes(note.model)).map((note) => note.id).sort((a, b) => a - b);
	}

	createNote(input: { model: string; deck: string; fields: Record<string, string>; tags: string[] }): FakeNote {
		const model = this.models.get(input.model);
		if (!model) throw Object.assign(new Error(`note type not found: ${input.model}`), { type: "notFound" });
		if (!this.decks.has(input.deck)) throw Object.assign(new Error(`deck not found: ${input.deck}`), { type: "notFound" });
		if (Object.keys(input.fields).join() !== model.fields.join()) throw Object.assign(new Error("fields do not match"), { type: "invalidParams" });
		const first = model.fields[0] ?? "";
		if ([...this.notes.values()].some((note) => note.model === input.model && note.fields[first] === input.fields[first])) throw Object.assign(new Error("cannot create note because it is a duplicate"), { type: "duplicate" });
		const cardCount = model.cloze ? new Set([...(input.fields.Text ?? "").matchAll(/\{\{c(\d+)::/g)].map((match) => match[1])).size : model.templates;
		const note: FakeNote = { id: this.id(), model: input.model, deck: input.deck, fields: { ...input.fields }, tags: [...input.tags], cards: Array.from({ length: cardCount }, () => this.id()), mod: Date.now() };
		this.notes.set(note.id, note);
		return note;
	}

	update(id: number, fields: Record<string, string> | undefined, tags: string[] | undefined): void {
		const note = this.notes.get(id);
		if (!note) throw Object.assign(new Error(`note not found: ${id}`), { type: "notFound" });
		if (fields) Object.assign(note.fields, fields);
		if (tags) note.tags = [...tags];
		note.mod = Date.now();
	}

	move(cardIds: number[], deck: string): void {
		if (!this.decks.has(deck)) this.decks.set(deck, this.id());
		for (const note of this.notes.values()) if (note.cards.some((card) => cardIds.includes(card))) note.deck = deck;
	}

	page(key: string, ids: number[], limit: number, cursor: unknown): { ids: number[]; nextCursor: string | null } {
		const rest = typeof cursor === "string" ? this.cursors.get(cursor) : ids;
		if (!rest) throw Object.assign(new Error("cursor expired"), { type: "invalidCursor" });
		if (typeof cursor === "string") this.cursors.delete(cursor);
		const page = rest.slice(0, limit);
		const remaining = rest.slice(limit);
		let nextCursor: string | null = null;
		if (remaining.length) { nextCursor = `${key}-${this.id()}`; this.cursors.set(nextCursor, remaining); }
		return { ids: page, nextCursor };
	}

	v1Note(note: FakeNote): Json {
		return { id: String(note.id), noteType: { id: String(this.models.get(note.model)?.id), name: note.model }, fields: note.fields, tags: note.tags, cardIds: note.cards.map(String), modifiedAt: new Date(note.mod).toISOString() };
	}

	operation(method: string, result: unknown): Json {
		const operationId = `op-${this.id()}`;
		this.operations.set(operationId, { result, polls: 0 });
		return { operationId, method, session: "s1" };
	}

	v1(method: string, params: Json): unknown {
		switch (method) {
			case "api.describe": return { apiMajor: 1, ankiVersion: "26.11" };
			case "collection.get": return { profile: this.profile, session: "s1", scheduler: "fsrs" };
			case "operations.get": {
				const operation = this.operations.get(String(params.operationId));
				if (!operation) throw Object.assign(new Error("unknown operation"), { type: "notFound" });
				this.operationPolls++;
				return ++operation.polls < 2 ? { state: "running" } : { state: "succeeded", result: operation.result };
			}
			case "noteTypes.list": return [...this.models].map(([name, model]) => ({ id: String(model.id), name }));
			case "noteTypes.create": {
				const fields = (params.fields as Array<{ name: string }>).map((field) => field.name);
				const id = this.id();
				this.models.set(String(params.name), { id, fields, cloze: params.kind === "cloze", templates: (params.templates as unknown[]).length });
				return this.operation("noteTypes.create", { id: String(id) });
			}
			case "decks.list": return [...this.decks].map(([name, id]) => ({ id: String(id), name, kind: "normal", presetId: "1" }));
			case "decks.create": { const id = this.id(); this.decks.set(String(params.name), id); return { id: String(id) }; }
			case "notes.search": return this.page("notes", this.search(String(params.query)), Math.min(Number(params.limit ?? 100), BATCH_LIMIT), params.cursor);
			case "notes.getMany": {
				const ids = params.ids as string[];
				this.track(ids.length);
				return { items: ids.map((id, index) => { const note = this.notes.get(Number(id)); return note ? { index, result: this.v1Note(note) } : { index, error: { code: -32004, message: "not found", data: { type: "notFound" } } }; }) };
			}
			case "notes.createMany": {
				const notes = params.notes as Array<{ noteType: { name: string }; deck: { name: string }; fields: Record<string, string>; tags: string[]; duplicates: { allow: boolean } }>;
				this.track(notes.length);
				return { items: notes.map((note, index) => {
					assert.equal(note.duplicates.allow, false);
					try {
						const created = this.createNote({ model: note.noteType.name, deck: note.deck.name, fields: note.fields, tags: note.tags });
						return { index, result: { noteId: String(created.id), cardIds: created.cards.map(String) } };
					} catch (error) {
						return { index, error: { code: -32010, message: (error as Error).message, data: { type: (error as { type?: string }).type } } };
					}
				}) };
			}
			case "notes.update": {
				const patch = params.patch as { fields?: Record<string, string>; tags?: string[] };
				this.update(Number(params.id), patch.fields, patch.tags);
				return { id: String(params.id) };
			}
			case "cards.move": { const ids = (params.ids as string[]).map(Number); this.track(ids.length); this.move(ids, String((params.deck as { name: string }).name)); return { moved: ids.length }; }
			case "reviews.list": {
				const cardIds = (params.cardIds as string[]).map(Number);
				this.track(cardIds.length);
				const afterId = Number(params.afterId ?? 0);
				const matching = this.reviewLog.filter((review) => cardIds.includes(review.cardId) && review.id > afterId && (params.includeManual || review.type !== 4));
				const { ids, nextCursor } = this.page("reviews", matching.map((review) => review.id), Number(params.limit ?? 100), params.cursor);
				return { items: ids.map((id) => {
					const review = matching.find((candidate) => candidate.id === id) as FakeReview;
					if (this.numericReviews) return { id: review.id, cardId: review.cardId, rating: review.ease || null, elapsedMs: review.time, kind: review.type };
					return { id: String(review.id), cardId: String(review.cardId), answeredAt: new Date(review.id).toISOString(), rating: review.ease ? RATING_NAMES[review.ease - 1] : null, interval: { value: 1, unit: "days" }, previousInterval: { value: 0, unit: "days" }, factor: 2500, elapsedMs: review.time, kind: KINDS[review.type], syncSequence: 1 };
				}), nextCursor };
			}
			default: throw Object.assign(new Error(`method not found: ${method}`), { type: "methodNotFound" });
		}
	}

	v1Envelope(envelope: unknown, authorization: string | undefined): Json {
		const request = envelope as Json;
		const id = request?.id ?? null;
		const fail = (code: number, message: string, type: string): Json => ({ jsonrpc: "2.0", id, error: { code, message, data: { type } } });
		if (typeof request !== "object" || request === null || request.jsonrpc !== "2.0" || Object.keys(request).some((key) => !["jsonrpc", "id", "method", "params"].includes(key))) return fail(-32600, "invalid request", "invalidRequest");
		if (this.apiKey && authorization !== `Bearer ${this.apiKey}`) return fail(-32001, "unauthorized", "unauthorized");
		const rejected = this.v1Rejects.get(String(request.method));
		if (rejected !== undefined) return fail(rejected, rejected === -32601 ? "Method not found" : "Invalid params", rejected === -32601 ? "methodNotFound" : "invalidParams");
		try { return { jsonrpc: "2.0", id, result: this.v1(String(request.method), (request.params ?? {}) as Json) }; } catch (error) {
			return fail(-32000, (error as Error).message, (error as { type?: string }).type ?? "error");
		}
	}

	v6(action: string, params: Json): unknown {
		switch (action) {
			case "version": return 6;
			case "getActiveProfile": return this.profile;
			case "modelNames": return [...this.models.keys()];
			case "createModel": {
				const id = this.id();
				this.models.set(String(params.modelName), { id, fields: params.inOrderFields as string[], cloze: params.isCloze === true, templates: (params.cardTemplates as unknown[]).length });
				return { id };
			}
			case "deckNames": return [...this.decks.keys()];
			case "createDeck": { const id = this.id(); this.decks.set(String(params.deck), id); return id; }
			case "findNotes": return this.search(String(params.query));
			case "notesInfo": return (params.notes as number[]).map((id) => {
				const note = this.notes.get(id);
				if (!note) return {};
				const fields = Object.fromEntries(Object.entries(note.fields).map(([name, value], order) => [name, { value, order }]));
				return { noteId: note.id, modelName: note.model, tags: note.tags, fields, cards: note.cards, mod: Math.floor(note.mod / 1000) };
			});
			case "multi": {
				const actions = params.actions as Array<{ action: string; params: Json; version: number }>;
				this.track(actions.length);
				return actions.map((item) => { try { return { result: this.v6(item.action, item.params), error: null }; } catch (error) { return { result: null, error: (error as Error).message }; } });
			}
			case "addNote": {
				const note = params.note as { deckName: string; modelName: string; fields: Record<string, string>; tags: string[]; options: { allowDuplicate: boolean } };
				assert.equal(note.options.allowDuplicate, false);
				return this.createNote({ model: note.modelName, deck: note.deckName, fields: note.fields, tags: note.tags }).id;
			}
			case "updateNote": { const note = params.note as { id: number; fields: Record<string, string>; tags: string[] }; this.update(note.id, note.fields, note.tags); return null; }
			case "changeDeck": this.move(params.cards as number[], String(params.deck)); return null;
			case "getReviewsOfCards": {
				const cards = (params.cards as string[]).map(Number);
				return Object.fromEntries(cards.map((card) => [String(card), this.reviewLog.filter((review) => review.cardId === card).map((review) => ({ id: review.id, usn: -1, ease: review.ease, ivl: 1, lastIvl: 0, factor: 2500, time: review.time, type: review.type }))]));
			}
			default: throw new Error(`unsupported action: ${action}`);
		}
	}

	handle(url: string, body: unknown, authorization: string | undefined): unknown {
		if (authorization) this.authorization.push(authorization);
		if (url === "/api/v1") {
			// An older add-on ignores the path and parses the body as a v6 request.
			if (this.mode === "v6") return { result: null, error: "unsupported action" };
			if (Array.isArray(body)) {
				if (body.length > BATCH_LIMIT) return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "batch too large", data: { type: "limitExceeded" } } };
				this.track(body.length);
				return body.map((envelope) => this.v1Envelope(envelope, authorization));
			}
			return this.v1Envelope(body, authorization);
		}
		const request = body as Json;
		if (this.apiKey && request.key !== this.apiKey) return { result: null, error: "valid api key must be provided" };
		try { return { result: this.v6(String(request.action), (request.params ?? {}) as Json), error: null }; } catch (error) {
			return { result: null, error: (error as Error).message };
		}
	}
}

const servers: http.Server[] = [];
after(() => { for (const server of servers) server.close(); });

async function serve(anki: FakeAnki): Promise<string> {
	const server = http.createServer((request, response) => {
		let raw = "";
		request.on("data", (chunk) => { raw += chunk; });
		request.on("end", () => {
			const reply = anki.handle(request.url ?? "/", JSON.parse(raw), request.headers.authorization);
			response.writeHead(200, { "Content-Type": "application/json" });
			response.end(JSON.stringify(reply));
		});
	});
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** A loopback port nothing listens on (Anki closed). */
async function closedPort(): Promise<number> {
	const server = http.createServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as AddressInfo).port;
	await new Promise<void>((resolve) => server.close(() => resolve()));
	return port;
}

const DAY = 86_400_000;
const temporaryDirectories: string[] = [];
after(() => { for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

/** A fresh directory under the OS temp folder, removed after the suite (never the repo data/). */
function temporaryDirectory(prefix = "lh-flashcards-anki-"): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	temporaryDirectories.push(directory);
	return directory;
}

const DOMAIN = { id: "eletronica", title: "Eletrônica" };

const pluginDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../plugins/flashcards");
type Handler = (input: Json) => unknown;
const { activate } = createRequire(path.join(pluginDir, "package.json"))("./src/backend.cjs") as { activate(ctx: Json): void };

/** Plugin backend with the host services Flashcards needs (no generation workers). */
function startBackend(dataDirectory = temporaryDirectory()) {
	const handlers = new Map<string, Handler>();
	const controller = new AbortController();
	activate({
		dataDirectory,
		signal: controller.signal,
		workers: { register: () => () => {}, list: () => [], get: () => { throw new Error("no tasks"); }, subscribe: () => () => {}, wait: async () => {}, cancel: () => {} },
		learning: { graph: () => ({ propositions: [], chains: [], sessions: {}, fileSources: {} }) },
		inference: { catalog: async () => ({ slots: {}, models: [] }) },
		events: { emit: () => {} },
		handle: (name: string, handler: Handler) => handlers.set(name, handler),
		cleanup: () => {},
	});
	after(() => controller.abort());
	return async <T = Json>(name: string, input: Json = {}): Promise<T> => {
		const handler = handlers.get(name);
		assert.ok(handler, `missing operation ${name}`);
		return await handler(input) as T;
	};
}

function library(basicCount: number): ExportSource {
	const cues = Array.from({ length: basicCount }, (_, index) => ({ id: `cue-${index}`, question: `Pergunta ${index}?`, answer: `Resposta **${index}**` }));
	return {
		decks: [{ id: "d1", name: "Lei de Ohm", propositionIds: ["p1", "p2"] }, { id: "d2", name: "Capacitores", propositionIds: ["p3"] }],
		propositions: {
			p1: { id: "p1", name: "Ohm", cues: cues.slice(0, Math.ceil(basicCount / 2)) },
			p2: { id: "p2", name: "Cloze", cues: [{ id: "cue-cloze", question: "V = {{c1::R}}·{{c2::I}}", answer: "Lei de Ohm" }, { id: "cue-rev", question: "farad", answer: "F", kind: "reverse" }] },
			p3: { id: "p3", name: "Capacitância", cues: cues.slice(Math.ceil(basicCount / 2)) },
		},
	};
}

const cardsFor = (source: ExportSource): ExportCard[] => collectExportCards(source, DOMAIN, () => true);
const ankiLinks = (result: AnkiPushResult): Record<string, ExternalLink["anki"]> => result.links;

function fullLinks(cards: readonly ExportCard[], result: AnkiPushResult): Record<string, ExternalLink> {
	return Object.fromEntries(cards.flatMap((card) => {
		const anki = result.links[card.cueId];
		return anki ? [[card.cueId, { cueId: card.cueId, propositionId: card.propositionId, domainId: DOMAIN.id, anki }]] : [];
	}));
}

describe("flashcards AnkiConnect sync", () => {
	it("escapes LH_ID searches and rejects non-loopback endpoints", async () => {
		assert.equal(fieldQuery("LH_ID", 'a_b*c"d\\e'), '"LH_ID:a\\_b\\*c\\"d\\\\e"');
		await assert.rejects(connectAnki({ url: "http://192.168.0.10:8765" }), /127\.0\.0\.1/);
		await assert.rejects(connectAnki({ url: "https://127.0.0.1:8765" }), /127\.0\.0\.1/);
	});

	it("reports Anki as unavailable when nothing listens", async () => {
		const server = http.createServer();
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as AddressInfo).port;
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await assert.rejects(connectAnki({ url: `http://127.0.0.1:${port}`, timeoutMs: 2000 }), AnkiUnavailableError);
	});

	it("API v1: pushes in batches of at most 100, then re-pushes and updates without duplicating", async () => {
		const anki = new FakeAnki("v1", "segredo");
		const api = await connectAnki({ url: await serve(anki), apiKey: "segredo" });
		assert.equal(api.flavor, "v1");
		const source = library(150);
		const cards = cardsFor(source);
		const first = await pushToAnki(api, cards, {});
		assert.equal(first.flavor, "v1");
		assert.equal(first.profile, "Usuário 1");
		assert.equal(first.created, 152);
		assert.deepEqual(first.failed, []);
		assert.equal(anki.notes.size, 152);
		assert.ok(anki.largestBatch <= 100, `largest batch ${anki.largestBatch}`);
		assert.ok(anki.operationPolls >= 2, "operation-completion results are polled");
		assert.ok(anki.authorization.length > 0 && anki.authorization.every((value) => value === "Bearer segredo"));
		const byLhId = new Map([...anki.notes.values()].map((note) => [note.fields.LH_ID, note]));
		const cloze = byLhId.get("cue-cloze");
		assert.equal(cloze?.model, "LearnHarness Cloze v1");
		assert.equal(cloze?.cards.length, 2);
		assert.equal(byLhId.get("cue-rev")?.cards.length, 2, "reverse note type yields two cards");
		const basic = byLhId.get("cue-0");
		assert.equal(Object.keys(basic?.fields ?? {})[0], "LH_ID");
		assert.equal(basic?.fields.Back, "Resposta <b>0</b>");
		assert.equal(basic?.deck, "LearnHarness::Eletrônica::Lei de Ohm");
		assert.ok(basic?.tags.includes("lh::dom::eletronica"));
		assert.equal(byLhId.get("cue-149")?.deck, "LearnHarness::Eletrônica::Capacitores");

		const second = await pushToAnki(api, cards, ankiLinks(first));
		assert.deepEqual([second.created, second.updated, second.unchanged, second.moved], [0, 0, 152, 0]);
		assert.equal(anki.notes.size, 152);

		basic?.tags.push("meu-rotulo");
		(source.propositions.p1?.cues[0] as { answer: string }).answer = "Resposta nova";
		const third = await pushToAnki(api, cardsFor(source), {});
		assert.equal(third.created, 0, "lost links are rediscovered by LH_ID");
		assert.equal(third.updated, 1);
		assert.equal(anki.notes.size, 152);
		assert.equal(byLhId.get("cue-0")?.fields.Back, "Resposta nova");
		assert.ok(byLhId.get("cue-0")?.tags.includes("meu-rotulo"), "user tags survive");

		source.decks = [{ id: "d1", name: "Lei de Ohm", propositionIds: ["p1", "p2", "p3"] }];
		const moved = await pushToAnki(api, cardsFor(source), ankiLinks(third));
		assert.equal(byLhId.get("cue-149")?.deck, "LearnHarness::Eletrônica::Lei de Ohm");
		assert.ok(moved.moved > 0);
		assert.equal(anki.notes.size, 152);
	});

	it("API v1: imports the revlog after the cursor as RevlogEntry, skipping non-memory entries", async () => {
		const anki = new FakeAnki("v1");
		const api = await connectAnki({ url: await serve(anki) });
		const cards = cardsFor(library(2));
		const pushed = await pushToAnki(api, cards, {});
		const links = fullLinks(cards, pushed);
		const card = pushed.links["cue-0"]?.cardIds[0] as number;
		const other = pushed.links["cue-cloze"]?.cardIds[1] as number;
		const base = Date.UTC(2026, 10, 1, 12);
		anki.reviewLog.push(
			{ id: base, cardId: card, ease: 3, time: 8000, type: 0 },
			{ id: base + 86_400_000, cardId: card, ease: 1, time: 90_000, type: 1 },
			{ id: base + 2 * 86_400_000, cardId: other, ease: 4, time: 3000, type: 2 },
			{ id: base + 3 * 86_400_000, cardId: card, ease: 0, time: 0, type: 5 },
			{ id: base + 4 * 86_400_000, cardId: card, ease: 0, time: 0, type: 4 },
		);
		const imported = await importAnkiRevlog(api, links, null, "Usuário 1");
		assert.deepEqual(imported.entries.map((entry) => [entry.id, entry.rating, entry.origin, entry.cueId, entry.propositionId]), [
			[`anki:${base}`, 3, "anki", "cue-0", "p1"],
			[`anki:${base + 86_400_000}`, 1, "anki", "cue-0", "p1"],
			[`anki:${base + 2 * 86_400_000}`, 4, "anki", "cue-cloze", "p2"],
		]);
		assert.equal(imported.entries[0]?.at, new Date(base).toISOString());
		assert.equal(imported.entries[1]?.durationMs, MAX_REVIEW_DURATION_MS);
		assert.equal(imported.skipped, 1, "rescheduled entry skipped (manual ones are filtered by the server)");
		assert.equal(imported.latestId, base + 3 * 86_400_000);
		const again = await importAnkiRevlog(api, links, { ankiLatestRevlogId: imported.latestId, ankiProfile: "Usuário 1", apiFlavor: "v1" }, "Usuário 1");
		assert.deepEqual(again.entries, []);
		const otherProfile = await importAnkiRevlog(api, links, { ankiLatestRevlogId: imported.latestId, ankiProfile: "Outro", apiFlavor: "v1" }, "Usuário 1");
		assert.equal(otherProfile.entries.length, 3, "a cursor from another profile is not trusted");
	});

	it("API v6 fallback: same push/update/revlog semantics through the legacy protocol", async () => {
		const anki = new FakeAnki("v6", "chave");
		const api = await connectAnki({ url: await serve(anki), apiKey: "chave" });
		assert.equal(api.flavor, "v6");
		const source = library(3);
		const cards = cardsFor(source);
		const first = await pushToAnki(api, cards, {});
		assert.equal(first.flavor, "v6");
		assert.equal(first.created, 5);
		assert.deepEqual(first.failed, []);
		assert.equal(anki.notes.size, 5);
		const again = await pushToAnki(api, cards, ankiLinks(first));
		assert.deepEqual([again.created, again.unchanged], [0, 5]);
		(source.propositions.p3?.cues[0] as { question: string }).question = "Pergunta alterada?";
		const updated = await pushToAnki(api, cardsFor(source), ankiLinks(again));
		assert.deepEqual([updated.created, updated.updated], [0, 1]);
		assert.equal(anki.notes.size, 5);
		assert.ok([...anki.notes.values()].some((note) => note.fields.Front === "Pergunta alterada?"));

		const card = first.links["cue-1"]?.cardIds[0] as number;
		const base = Date.UTC(2026, 10, 2, 9);
		anki.reviewLog.push({ id: base, cardId: card, ease: 2, time: 4000, type: 1 }, { id: base + 1000, cardId: card, ease: 0, time: 0, type: 4 });
		const imported = await importAnkiRevlog(api, fullLinks(cards, first), null, "Usuário 1");
		assert.deepEqual(imported.entries.map((entry) => [entry.id, entry.rating, entry.durationMs]), [[`anki:${base}`, 2, 4000]]);
		assert.equal(imported.skipped, 1);
		assert.equal(imported.latestId, base + 1000);
	});

	it("API v1 contract mismatch: reruns the task on v6 without duplicating notes", async () => {
		const anki = new FakeAnki("v1");
		const options = { url: await serve(anki) };
		const api = await connectAnki(options);
		assert.equal(api.flavor, "v1");
		const source = library(3);
		anki.v1Rejects.set("notes.createMany", -32601);
		const created = await withV6Fallback(api, options, (client) => pushToAnki(client, cardsFor(source), {}));
		assert.deepEqual([created.flavor, created.created, created.failed.length], ["v6", 5, 0]);
		assert.equal(anki.notes.size, 5);
		assert.equal(anki.models.size, 3, "note types created through v1 before the mismatch are reused, not recreated");

		anki.v1Rejects.clear();
		anki.v1Rejects.set("notes.update", -32602);
		(source.propositions.p1?.cues[0] as { answer: string }).answer = "Resposta revista";
		const updated = await withV6Fallback(api, options, (client) => pushToAnki(client, cardsFor(source), created.links));
		assert.deepEqual([updated.flavor, updated.created, updated.updated, updated.failed.length], ["v6", 0, 1, 0], "invalid params is a contract mismatch, not a per-note failure");
		assert.equal(anki.notes.size, 5);
		assert.ok([...anki.notes.values()].some((note) => note.fields.Back === "Resposta revista"));

		anki.v1Rejects.clear();
		const busy = new AnkiConnectError("busy", "busy", 1010);
		await assert.rejects(withV6Fallback(api, options, async () => { throw busy; }), (error) => error === busy, "other errors are not retried on v6");
	});

	it("review mode anki: the app queue skips Anki-held cards and imported reviews replay FSRS-7 memory", async () => {
		const anki = new FakeAnki("v1");
		const call = startBackend();
		const deckId = (await call<{ decks: Array<{ id: string }> }>("create-deck", { name: "Verbos" })).decks[0]?.id;
		const first = await call<{ propositionId: string; cueId: string }>("create-card", { requestId: "a", deckId, name: "Go", question: "Passado de go?", answer: "went" });
		await call("create-card", { requestId: "b", deckId, name: "Be", question: "Passado de be?", answer: "was" });
		const { ticket } = await call<{ ticket: { id: string; propositionId: string } }>("next-review");
		assert.equal(ticket.propositionId, first.propositionId);
		await call("reveal-review", { ticketId: ticket.id });
		await call("rate-review", { ticketId: ticket.id, rating: 3, requestId: "app-1" });

		await call("save-sync-settings", { ankiConnectUrl: await serve(anki) });
		assert.deepEqual(await call("anki-status"), { available: true, flavor: "v1", profile: "Usuário 1" });
		const pushed = await call<{ mode: string; created: number }>("export-anki");
		assert.deepEqual([pushed.mode, pushed.created], ["ankiconnect", 2]);
		assert.equal((await call<{ created: number }>("anki-push")).created, 0, "re-push never duplicates");
		assert.equal(anki.notes.size, 2);

		await call("save-sync-settings", { reviewClient: "anki" });
		assert.equal((await call<{ ticket: unknown }>("next-review")).ticket, null, "Anki schedules linked cards");

		const note = [...anki.notes.values()].find((candidate) => candidate.fields.LH_ID === first.cueId);
		const appAt = Date.parse((await call<{ entries: Array<{ at: string }> }>("get-revlog")).entries[0]?.at ?? "");
		anki.reviewLog.push({ id: appAt + 3_600_000, cardId: note?.cards[0] as number, ease: 3, time: 5000, type: 1 }, { id: appAt + 2 * 86_400_000, cardId: note?.cards[0] as number, ease: 4, time: 4000, type: 1 });
		const imported = await call<{ imported: number; replayed: number; evidenceWeight: number }>("anki-import-reviews");
		assert.deepEqual([imported.imported, imported.replayed, imported.evidenceWeight], [2, 1, 0.3]);
		assert.equal((await call<{ imported: number }>("anki-import-reviews")).imported, 0, "the cursor prevents re-importing");

		const state = await call<{ propositions: Array<{ id: string; schedule: { reps: number; stability: number; stabilityFast: number; difficulty: number } }> }>("get-state");
		const schedule = state.propositions.find((proposition) => proposition.id === first.propositionId)?.schedule;
		assert.equal(schedule?.reps, 3);
		const expected = replayMemory([{ rating: 3, at: appAt }, { rating: 3, at: appAt + 3_600_000 }, { rating: 4, at: appAt + 2 * 86_400_000 }]);
		assert.deepEqual({ stability: schedule?.stability, stabilityFast: schedule?.stabilityFast, difficulty: schedule?.difficulty }, expected);
		const revlog = await call<{ entries: Array<{ origin: string }> }>("get-revlog", { propositionId: first.propositionId });
		assert.deepEqual(revlog.entries.map((entry) => entry.origin), ["app", "anki", "anki"]);
	});

	it("refuses to push or import while another Anki profile is open until a push confirms the switch", async () => {
		const anki = new FakeAnki("v1");
		const call = startBackend();
		const deckId = (await call<{ decks: Array<{ id: string }> }>("create-deck", { name: "Verbos" })).decks[0]?.id;
		await call("create-card", { requestId: "a", deckId, name: "Go", question: "Passado de go?", answer: "went" });
		await call("save-sync-settings", { ankiConnectUrl: await serve(anki) });
		assert.equal((await call<{ created: number }>("export-anki")).created, 1);

		// The other profile is another collection: no LearnHarness notes yet.
		const firstCollection = anki.notes;
		anki.profile = "Outro";
		anki.notes = new Map();
		const refused = await call<{ mode: string; active: string; expected: string; message: string }>("export-anki");
		assert.deepEqual([refused.mode, refused.active, refused.expected], ["profile-mismatch", "Outro", "Usuário 1"]);
		assert.match(refused.message, /“Outro”.*“Usuário 1”/);
		assert.equal((await call<{ mode: string }>("anki-push")).mode, "profile-mismatch");
		assert.equal((await call<{ mode: string }>("anki-import-reviews")).mode, "profile-mismatch");
		assert.equal(anki.notes.size, 0, "nothing is written to the other profile");
		assert.equal((await call<{ cursor: { ankiProfile: string } }>("get-sync")).cursor.ankiProfile, "Usuário 1");
		await assert.rejects(call("export-anki", { switchProfile: "sim" }), /switchProfile/);

		const switched = await call<{ mode: string; profile: string; created: number }>("export-anki", { switchProfile: true });
		assert.deepEqual([switched.mode, switched.profile, switched.created], ["ankiconnect", "Outro", 1]);
		const view = await call<{ cursor: { ankiProfile: string; ankiLatestRevlogId: number }; linked: { anki: number } }>("get-sync");
		assert.deepEqual([view.cursor.ankiProfile, view.cursor.ankiLatestRevlogId, view.linked.anki], ["Outro", 0, 1]);
		assert.notDeepEqual([...anki.notes.keys()], [...firstCollection.keys()], "links now point at the new profile's notes");
		assert.equal((await call<{ created: number }>("anki-push")).created, 0, "the switched profile syncs normally");
	});

	it("does not create a second note when a note with the same LH_ID already exists", async () => {
		const anki = new FakeAnki("v1");
		const api = await connectAnki({ url: await serve(anki) });
		const cards = cardsFor(library(4));
		await pushToAnki(api, cards, {});
		const before = anki.notes.size;
		await Promise.all([pushToAnki(api, cards, {}), pushToAnki(api, cards, {})]);
		assert.equal(anki.notes.size, before);
	});

	it("API v1: accepts numeric ratings and kinds and a review without answeredAt", async () => {
		const anki = new FakeAnki("v1");
		anki.numericReviews = true;
		const api = await connectAnki({ url: await serve(anki) });
		const cards = cardsFor(library(2));
		const pushed = await pushToAnki(api, cards, {});
		const card = pushed.links["cue-0"]?.cardIds[0] as number;
		const base = Date.UTC(2026, 10, 3, 8);
		anki.reviewLog.push({ id: base, cardId: card, ease: 2, time: 3000, type: 1 }, { id: base + 1000, cardId: card, ease: 0, time: 0, type: 5 });
		const imported = await importAnkiRevlog(api, fullLinks(cards, pushed), null, "Usuário 1");
		assert.deepEqual(imported.entries.map((entry) => [entry.id, entry.rating, entry.at, entry.durationMs]), [[`anki:${base}`, 2, new Date(base).toISOString(), 3000]]);
		assert.equal(imported.skipped, 1, "rescheduled (type 5) has no memory effect");
		assert.equal(imported.latestId, base + 1000);
	});

	it("imports, once, the older reviews of a note adopted after the revlog cursor", async () => {
		const anki = new FakeAnki("v1");
		const dataDirectory = temporaryDirectory();
		const call = startBackend(dataDirectory);
		const deckId = (await call<{ decks: Array<{ id: string }> }>("create-deck", { name: "Verbos" })).decks[0]?.id;
		const first = await call<{ cueId: string }>("create-card", { requestId: "a", deckId, name: "Go", question: "Passado de go?", answer: "went" });
		await call("save-sync-settings", { ankiConnectUrl: await serve(anki) });
		assert.equal((await call<{ created: number }>("export-anki")).created, 1);
		const linked = [...anki.notes.values()][0] as FakeNote;
		const base = Date.now() - 10 * DAY;
		anki.reviewLog.push({ id: base, cardId: linked.cards[0] as number, ease: 3, time: 4000, type: 0 });
		assert.equal((await call<{ imported: number }>("anki-import-reviews")).imported, 1);

		// The note of a new cue already sits in Anki (an imported .apkg) with a review older than the cursor.
		const second = await call<{ cueId: string }>("create-card", { requestId: "b", deckId, name: "Be", question: "Passado de be?", answer: "was" });
		const adopted = anki.createNote({ model: linked.model, deck: linked.deck, fields: { LH_ID: second.cueId, Front: "Passado de be?", Back: "was", Source: "" }, tags: [] });
		anki.reviewLog.push({ id: base - DAY, cardId: adopted.cards[0] as number, ease: 4, time: 2000, type: 0 });
		assert.equal((await call<{ created: number }>("anki-push")).created, 0, "the existing note is adopted, not duplicated");
		const backfill = (): number[] => (JSON.parse(fs.readFileSync(path.join(dataDirectory, "sync-cursor.json"), "utf8")) as { revlogBackfill: number[] }).revlogBackfill;
		assert.deepEqual(backfill(), adopted.cards);
		assert.equal((await call<{ imported: number }>("anki-import-reviews")).imported, 1, "the adopted note's older review is read");
		const revlog = await call<{ entries: Array<{ id: string; cueId: string }> }>("get-revlog", { origin: "anki" });
		assert.deepEqual(revlog.entries.map((entry) => [entry.id, entry.cueId]), [[`anki:${base - DAY}`, second.cueId], [`anki:${base}`, first.cueId]]);
		assert.deepEqual(backfill(), []);
		assert.equal((await call<{ imported: number }>("anki-import-reviews")).imported, 0);
	});

	it("review mode anki: a card reviewed only in Anki leaves New and is not counted due by the app", async () => {
		type View = { decks: Array<{ id: string; due: number }>; propositions: Array<{ id: string; schedule: { model?: string; state: number; reps: number; last_review: number | null; due: number; stability: number; stabilityFast: number; difficulty: number } }> };
		const anki = new FakeAnki("v1");
		const call = startBackend();
		const deckId = (await call<{ decks: Array<{ id: string }> }>("create-deck", { name: "Verbos" })).decks[0]?.id;
		const card = await call<{ propositionId: string }>("create-card", { requestId: "a", deckId, name: "Go", question: "Passado de go?", answer: "went" });
		await call("save-sync-settings", { ankiConnectUrl: await serve(anki), reviewClient: "anki" });
		assert.equal((await call<{ created: number }>("export-anki")).created, 1);
		const note = [...anki.notes.values()][0] as FakeNote;
		const start = Date.now() - 200 * DAY;
		anki.reviewLog.push({ id: start, cardId: note.cards[0] as number, ease: 3, time: 4000, type: 0 }, { id: start + DAY, cardId: note.cards[0] as number, ease: 4, time: 3000, type: 1 });
		assert.equal((await call<{ replayed: number }>("anki-import-reviews")).replayed, 1);

		const state = await call<View>("get-state");
		const schedule = state.propositions.find((proposition) => proposition.id === card.propositionId)?.schedule;
		assert.equal(schedule?.model, "fsrs-7");
		assert.notEqual(schedule?.state, 0, "a reviewed card is no longer New");
		assert.equal(schedule?.reps, 2);
		assert.equal(schedule?.last_review, start + DAY);
		assert.deepEqual({ stability: schedule?.stability, stabilityFast: schedule?.stabilityFast, difficulty: schedule?.difficulty }, replayMemory([{ rating: 3, at: start }, { rating: 4, at: start + DAY }]));
		assert.ok((schedule?.due ?? Infinity) < Date.now(), "overdue by now");
		assert.equal(state.decks.find((deck) => deck.id === deckId)?.due, 0, "Anki schedules it: the app deck shows nothing due");
		assert.equal((await call<{ ticket: unknown }>("next-review")).ticket, null);
		await call("save-sync-settings", { reviewClient: "app" });
		assert.equal((await call<View>("get-state")).decks.find((deck) => deck.id === deckId)?.due, 1, "in app mode the same card is due");
	});

	it("Anki closed: the fallback .apkg carries only the cards Anki does not hold yet", async () => {
		const anki = new FakeAnki("v1");
		const dataDirectory = temporaryDirectory();
		const call = startBackend(dataDirectory);
		const deckId = (await call<{ decks: Array<{ id: string }> }>("create-deck", { name: "Verbos" })).decks[0]?.id;
		await call("create-card", { requestId: "a", deckId, name: "Go", question: "Passado de go?", answer: "went" });
		await call("create-card", { requestId: "b", deckId, name: "Be", question: "Passado de be?", answer: "was" });
		await call("save-sync-settings", { ankiConnectUrl: await serve(anki) });
		assert.equal((await call<{ created: number }>("export-anki")).created, 2);

		await call("save-sync-settings", { ankiConnectUrl: `http://127.0.0.1:${await closedPort()}` });
		const nothing = await call<{ mode: string; path: string | null; notes: number; alreadyInAnki: number }>("export-anki");
		assert.deepEqual([nothing.mode, nothing.path, nothing.notes, nothing.alreadyInAnki], ["apkg", null, 0, 2]);
		assert.equal(fs.existsSync(path.join(dataDirectory, "exports")), false, "no package re-adding notes Anki already has");
		await call("create-card", { requestId: "c", deckId, name: "Do", question: "Passado de do?", answer: "did" });
		const fresh = await call<{ mode: string; path: string; notes: number; alreadyInAnki: number }>("export-anki");
		assert.deepEqual([fresh.mode, fresh.notes, fresh.alreadyInAnki], ["apkg", 1, 2]);
		assert.ok(fs.statSync(fresh.path).size > 0);
		assert.equal((await call<{ notes: number }>("export-apkg")).notes, 3, "an explicit export still packages every card");
	});
});
