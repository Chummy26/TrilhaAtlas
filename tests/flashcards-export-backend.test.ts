/**
 * Flashcards backend export/sync operations (plugins/flashcards/src/backend.cjs +
 * export-service.ts): settings for vault path / review mode, Obsidian export,
 * .apkg export, AnkiConnect fallback to .apkg when Anki is closed, revlog read,
 * domain inference from the per-domain plugin data path (SÍNTESE §2.2) and FSRS-7
 * grading after a legacy store migration. Regressions: the domain folder is derived
 * with `path.dirname` (UNC shares), and the revlog backfill list survives restarts.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import legacy from "../plugins/flashcards/src/scheduler.cjs";
import { domainDirectory, inferDomainId } from "../plugins/flashcards/src/export-service.ts";
import { createSyncState, parseSyncState } from "../plugins/flashcards/src/sync-types.ts";

const pluginDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../plugins/flashcards");
const requirePlugin = createRequire(path.join(pluginDir, "package.json"));
type Handler = (input: Record<string, unknown>) => unknown;
const { activate } = requirePlugin("./src/backend.cjs") as { activate(ctx: Record<string, unknown>): void };

interface Backend {
	call<T = Record<string, unknown>>(name: string, input?: Record<string, unknown>): Promise<T>;
	dispose(): void;
}

function startBackend(dataDirectory: string): Backend {
	const handlers = new Map<string, Handler>();
	const controller = new AbortController();
	const cleanups: Array<() => void> = [];
	activate({
		dataDirectory,
		signal: controller.signal,
		workers: { register: () => () => {}, list: () => [], get: () => { throw new Error("no tasks"); }, subscribe: () => () => {}, wait: async () => {}, cancel: () => {} },
		learning: { graph: () => ({ propositions: [], chains: [], sessions: {}, fileSources: {} }) },
		inference: { catalog: async () => ({ slots: {}, models: [] }) },
		events: { emit: () => {} },
		handle: (name: string, handler: Handler) => handlers.set(name, handler),
		cleanup: (fn: () => void) => cleanups.push(fn),
	});
	return {
		async call<T>(name: string, input: Record<string, unknown> = {}) {
			const handler = handlers.get(name);
			assert.ok(handler, `missing operation ${name}`);
			return await handler(input) as T;
		},
		dispose() { for (const fn of cleanups.splice(0).reverse()) fn(); controller.abort(); },
	};
}

const temporaryDirectories: string[] = [];
after(() => { for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

/** A fresh directory under the OS temp folder, removed after the suite (never the repo data/). */
function temporaryDirectory(prefix = "lh-flashcards-backend-"): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	temporaryDirectories.push(directory);
	return directory;
}

/** `<tmp>/domains/ingles/plugins/flashcards` with a domain manifest, as in SÍNTESE §2.2. */
function domainDataDirectory(reviewClient: "app" | "anki" = "app"): string {
	const root = temporaryDirectory();
	const domain = path.join(root, "domains", "ingles");
	fs.mkdirSync(path.join(domain, "plugins", "flashcards"), { recursive: true });
	fs.writeFileSync(path.join(domain, "domain.json"), JSON.stringify({ schemaVersion: 1, id: "ingles", title: { pt: "Inglês", en: "English" }, reviewClient }));
	return path.join(domain, "plugins", "flashcards");
}

async function seed(backend: Backend) {
	const state = await backend.call<{ decks: Array<{ id: string }> }>("create-deck", { name: "Verbos" });
	const deckId = state.decks[0]?.id as string;
	const first = await backend.call<{ propositionId: string; cueId: string }>("create-card", { requestId: "r1", deckId, name: "Go", question: "Passado de *go*?", answer: "went" });
	const second = await backend.call<{ propositionId: string; cueId: string }>("create-card", { requestId: "r2", deckId, name: "Be", question: "Passado de *be*?", answer: "was/were" });
	return { deckId, first, second };
}

async function review(backend: Backend, rating: number, requestId: string) {
	const { ticket } = await backend.call<{ ticket: { id: string; propositionId: string } | null }>("next-review", {});
	assert.ok(ticket);
	await backend.call("reveal-review", { ticketId: ticket.id });
	await backend.call("rate-review", { ticketId: ticket.id, rating, requestId });
	return ticket;
}

async function closedPort(): Promise<number> {
	const server = http.createServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as AddressInfo).port;
	await new Promise<void>((resolve) => server.close(() => resolve()));
	return port;
}

describe("flashcards backend export operations", () => {
	it("finds the domain folder only in the per-domain layout, also on UNC shares", () => {
		const root = temporaryDirectory();
		assert.equal(domainDirectory(path.join(root, "domains", "ingles", "plugins", "flashcards")), path.join(root, "domains", "ingles"));
		assert.equal(domainDirectory(path.join(root, "plugins", "flashcards")), null);
		assert.equal(domainDirectory(path.join(root, "domains", "ingles", "extra", "plugins", "flashcards")), null);
		assert.equal(inferDomainId(path.join(root, "domains", "Ingles", "plugins", "flashcards")), null, "not a valid domain id");
		if (process.platform === "win32") {
			const unc = "\\\\servidor\\dados\\LearnHarness\\domains\\ingles\\plugins\\flashcards";
			assert.equal(domainDirectory(unc), "\\\\servidor\\dados\\LearnHarness\\domains\\ingles");
			assert.equal(inferDomainId(unc), "ingles");
		}
	});

	it("persists the revlog backfill list and rejects a corrupted one", () => {
		const legacyFile = { ...createSyncState() } as Record<string, unknown>;
		delete legacyFile.revlogBackfill;
		assert.deepEqual(parseSyncState(legacyFile).revlogBackfill, [], "files written before the field parse");
		assert.deepEqual(parseSyncState({ ...createSyncState(), revlogBackfill: [1_700_000_000_001] }).revlogBackfill, [1_700_000_000_001]);
		assert.throws(() => parseSyncState({ ...createSyncState(), revlogBackfill: ["1"] }), /revlogBackfill/);
	});

	it("infers the domain, validates settings and never exposes the AnkiConnect key", async () => {
		const backend = startBackend(domainDataDirectory("anki"));
		try {
			const view = await backend.call<{ settings: Record<string, unknown>; domain: { id: string; title: string } }>("get-sync");
			assert.deepEqual(view.domain, { id: "ingles", title: "Inglês" });
			assert.equal(view.settings.reviewClient, "anki", "seeded from domain.json");
			await assert.rejects(backend.call("save-sync-settings", { obsidianVaultPath: "cofre/relativo" }), /absoluto/);
			await assert.rejects(backend.call("save-sync-settings", { obsidianVaultPath: path.join(os.tmpdir(), "lh-missing-vault-xyz") }), /não encontrado/);
			await assert.rejects(backend.call("save-sync-settings", { ankiConnectUrl: "http://example.com:8765" }), /127\.0\.0\.1/);
			await assert.rejects(backend.call("save-sync-settings", { reviewClient: "mobile" }), /"app" ou "anki"/);
			await assert.rejects(backend.call("save-sync-settings", { retention: 0.8 }), /não suportada/);
			const saved = await backend.call<{ settings: Record<string, unknown> }>("save-sync-settings", { ankiApiKey: "segredo", reviewClient: "app", domainTitle: "Inglês técnico" });
			assert.equal(saved.settings.ankiApiKey, undefined);
			assert.equal(saved.settings.ankiApiKeySet, true);
			assert.equal(saved.settings.reviewClient, "app");
			await assert.rejects(backend.call("export-obsidian"), /cofre do Obsidian/);
		} finally { backend.dispose(); }
	});

	it("exports to Obsidian idempotently, writes .apkg and falls back to .apkg when Anki is closed", async () => {
		const dataDirectory = domainDataDirectory();
		const backend = startBackend(dataDirectory);
		try {
			await seed(backend);
			const vault = temporaryDirectory("lh-backend-vault-");
			await backend.call("save-sync-settings", { obsidianVaultPath: vault, ankiConnectUrl: `http://127.0.0.1:${await closedPort()}` });
			const first = await backend.call<{ written: string[]; cards: number }>("export-obsidian");
			assert.deepEqual(first.written, ["LearnHarness/Inglês/Verbos.md"]);
			assert.equal(first.cards, 2);
			const note = fs.readFileSync(path.join(vault, "LearnHarness", "Inglês", "Verbos.md"), "utf8");
			assert.equal(note.includes("<!--SR:"), false);
			const second = await backend.call<{ written: string[]; unchanged: string[] }>("export-obsidian");
			assert.deepEqual([second.written, second.unchanged], [[], ["LearnHarness/Inglês/Verbos.md"]]);
			assert.equal(fs.readFileSync(path.join(vault, "LearnHarness", "Inglês", "Verbos.md"), "utf8"), note);

			const apkg = await backend.call<{ mode: string; path: string; notes: number }>("export-apkg");
			assert.equal(apkg.mode, "apkg");
			assert.equal(path.dirname(apkg.path), path.join(dataDirectory, "exports"));
			assert.ok(fs.statSync(apkg.path).size > 0);
			const fallback = await backend.call<{ mode: string; reason: string; notes: number }>("export-anki");
			assert.equal(fallback.mode, "apkg");
			assert.match(fallback.reason, /Anki não está aberto/);
			assert.equal(fallback.notes, 2);
			const status = await backend.call<{ available: boolean }>("anki-status");
			assert.equal(status.available, false);
			await assert.rejects(backend.call("anki-push"), /Anki não está aberto/);

			const sync = JSON.parse(fs.readFileSync(path.join(dataDirectory, "sync-cursor.json"), "utf8")) as { links: Record<string, { obsidian?: unknown }>; lastApkg: unknown };
			assert.equal(Object.values(sync.links).filter((link) => link.obsidian).length, 2);
			assert.ok(sync.lastApkg);
		} finally { backend.dispose(); }
	});

	it("maps app reviews to RevlogEntry and grades with FSRS-7", async () => {
		const backend = startBackend(domainDataDirectory());
		try {
			const { first } = await seed(backend);
			const ticket = await review(backend, 3, "rate-1");
			const { entries, evidenceWeight } = await backend.call<{ entries: Array<{ id: string; origin: string; rating: number; propositionId: string }>; evidenceWeight: number }>("get-revlog");
			assert.equal(evidenceWeight, 0.3);
			assert.equal(entries.length, 1);
			assert.deepEqual([entries[0]?.origin, entries[0]?.rating, entries[0]?.propositionId], ["app", 3, ticket.propositionId]);
			assert.match(entries[0]?.id ?? "", /^app:/);
			const state = await backend.call<{ propositions: Array<{ id: string; schedule: { model?: string; reps: number } }> }>("get-state");
			const graded = state.propositions.find((proposition) => proposition.id === ticket.propositionId);
			assert.equal(graded?.schedule.model, "fsrs-7");
			assert.equal(graded?.schedule.reps, 1);
			assert.deepEqual((await backend.call<{ entries: unknown[] }>("get-revlog", { propositionId: first.propositionId === ticket.propositionId ? "none" : first.propositionId })).entries, []);
			await assert.rejects(backend.call("get-revlog", { origin: "web" }), /origin/);
		} finally { backend.dispose(); }
	});

	it("activates on a legacy FSRS-6 store, migrates it and keeps grading", async () => {
		const dataDirectory = domainDataDirectory();
		const start = Date.now() - 30 * 86_400_000;
		let schedule = legacy.createSchedule(start);
		const reviews = [];
		for (const [index, [rating, at]] of ([[3, start], [3, start + 11 * 60_000], [3, start + 3 * 86_400_000]] as const).entries()) {
			const before = schedule;
			schedule = legacy.rate(before, rating, at, {});
			reviews.push({ id: `r${index}`, requestId: `q${index}`, ticketId: `t${index}`, propositionId: "manual:old", cueId: "cue-old", rating, at, before, after: schedule, introduced: index === 0, deckIds: index === 0 ? ["d1"] : [], settings: {} });
		}
		fs.writeFileSync(path.join(dataDirectory, "flashcards.json"), JSON.stringify({
			version: 1, revision: 4, settings: { retention: 0.9, learningSteps: [1, 10], relearningSteps: [10], dayStart: 4, fuzz: false, chunkBudget: 4000, modelOverride: null },
			decks: [{ id: "d1", name: "Antigo", newLimit: 20, propositionIds: ["manual:old"] }],
			propositions: { "manual:old": { id: "manual:old", origin: "manual", name: "Old", statement: "", cues: [{ id: "cue-old", question: "Q?", answer: "A", latestRating: 3 }], schedule, firstReviewedAt: start, learningCueId: null, version: 2 } },
			reviews, batches: [],
		}));
		const backend = startBackend(dataDirectory);
		try {
			const state = await backend.call<{ propositions: Array<{ schedule: { model?: string; reps: number; due: number } }> }>("get-state");
			assert.equal(state.propositions[0]?.schedule.model, "fsrs-7");
			assert.equal(state.propositions[0]?.schedule.reps, 3);
			assert.equal(state.propositions[0]?.schedule.due, schedule.due);
			await review(backend, 3, "after-migration");
			const after = await backend.call<{ propositions: Array<{ schedule: { model?: string; reps: number } }> }>("get-state");
			assert.equal(after.propositions[0]?.schedule.reps, 4);
			assert.equal((await backend.call<{ entries: unknown[] }>("get-revlog")).entries.length, 4);
		} finally { backend.dispose(); }
	});
});
