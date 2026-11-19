/**
 * Offline .apkg export (plugins/flashcards/src/apkg-export.ts, anki-apkg-export@5.0.0),
 * SÍNTESE §2.4(d) item 5: generated when Anki is closed, with a stable note identity.
 * The package is unzipped and its collection.anki2 read with sql.js to check that two
 * exports carry the same GUID and LH_ID per cue and the LearnHarness note types/decks.
 * Regression: an empty/unclosed/out-of-range cloze or a control character in one cue
 * used to make anki-apkg-export throw for the whole package.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { APKG_MODEL_IDS, buildApkg, noteGuid, writeApkg } from "../plugins/flashcards/src/apkg-export.ts";
import { collectExportCards, type ExportSource } from "../plugins/flashcards/src/export-model.ts";

const pluginDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../plugins/flashcards");
const requirePlugin = createRequire(path.join(pluginDir, "package.json"));
// The WASM paired with the installed sql.js glue (what the backend ships next to backend.cjs).
const wasmPath = requirePlugin.resolve("sql.js/dist/sql-wasm.wasm");

interface ZipFile { async(type: "uint8array"): Promise<Uint8Array> }
interface Zip { file(name: string): ZipFile | null }
interface SqlDatabase { exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>; close(): void }
const JSZip = requirePlugin("jszip") as { loadAsync(data: Uint8Array): Promise<Zip> };
const initSqlJs = requirePlugin("sql.js") as (config: { locateFile(file: string): string }) => Promise<{ Database: new (data: Uint8Array) => SqlDatabase }>;

const DOMAIN = { id: "eletronica", title: "Eletrônica" };
const SOURCE: ExportSource = {
	decks: [{ id: "d1", name: "Lei de Ohm", propositionIds: ["p1", "p2"] }, { id: "d2", name: "Capacitores", propositionIds: ["p3"] }],
	propositions: {
		p1: { id: "p1", name: "Ohm", cues: [{ id: "cue-a", question: "V = ?", answer: "$V = RI$" }, { id: "cue-b", question: "Unidade de R?", answer: "ohm" }] },
		p2: { id: "p2", name: "Cloze", cues: [{ id: "cue-cloze", question: "V = {{c1::R}}·{{c2::I}}", answer: "" }] },
		p3: { id: "p3", name: "Capacitância", cues: [{ id: "cue-rev", question: "farad", answer: "F", kind: "reverse" }] },
	},
};
const cards = collectExportCards(SOURCE, DOMAIN, () => true);

async function readCollection(bytes: Uint8Array) {
	const zip = await JSZip.loadAsync(bytes);
	const collection = zip.file("collection.anki2");
	assert.ok(collection, "collection.anki2 present");
	const SQL = await initSqlJs({ locateFile: () => wasmPath });
	const db = new SQL.Database(await collection.async("uint8array"));
	try {
		const notes = db.exec("SELECT guid, mid, flds, tags FROM notes ORDER BY id")[0]?.values ?? [];
		const cardCount = Number(db.exec("SELECT count(*) FROM cards")[0]?.values[0]?.[0]);
		const [models, decks] = (db.exec("SELECT models, decks FROM col")[0]?.values[0] ?? []) as [string, string];
		return {
			notes: notes.map(([guid, mid, flds, tags]) => ({ guid: String(guid), modelId: Number(mid), fields: String(flds).split("\u001f"), tags: String(tags).trim().split(/\s+/) })),
			cardCount,
			models: Object.values(JSON.parse(models) as Record<string, { id: number; name: string; flds: Array<{ name: string }> }>),
			decks: Object.values(JSON.parse(decks) as Record<string, { name: string }>).map((deck) => deck.name),
		};
	} finally {
		db.close();
	}
}

const temporaryDirectories: string[] = [];
after(() => { for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

/** A fresh directory under the OS temp folder, removed after the suite (never the repo data/). */
function temporaryDirectory(prefix = "lh-apkg-"): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	temporaryDirectories.push(directory);
	return directory;
}

describe("flashcards .apkg export", () => {
	it("builds a non-empty package whose notes keep the same GUID and LH_ID across exports", async () => {
		const first = await buildApkg(cards, { domain: DOMAIN, wasmPath });
		await new Promise((resolve) => setTimeout(resolve, 20));
		const second = await buildApkg(cards, { domain: DOMAIN, wasmPath });
		for (const bytes of [first, second]) {
			assert.ok(bytes.byteLength > 1000);
			assert.equal(String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0), "PK");
		}
		const a = await readCollection(first);
		const b = await readCollection(second);
		const identity = (collection: typeof a) => new Map(collection.notes.map((note) => [note.fields[0], note.guid]));
		assert.deepEqual(identity(a), identity(b), "same LH_ID → same GUID in both exports");
		assert.deepEqual([...identity(a).keys()].sort(), ["cue-a", "cue-b", "cue-cloze", "cue-rev"]);
		for (const card of cards) assert.equal(identity(a).get(card.lhId), noteGuid(DOMAIN.id, card.kind, card.lhId));
		assert.equal(a.cardCount, 2 + 2 + 2, "two basic cards, a two-deletion cloze and a two-way reverse note");
		const cloze = a.notes.find((note) => note.fields[0] === "cue-cloze");
		assert.equal(cloze?.modelId, APKG_MODEL_IDS.cloze);
		assert.equal(cloze?.fields[1], "V = {{c1::R}}·{{c2::I}}");
		assert.equal(a.notes.find((note) => note.fields[0] === "cue-a")?.fields[2], "\\(V = RI\\)");
		assert.ok(a.notes.every((note) => note.tags.includes("lh::dom::eletronica")));
		const models = new Map(a.models.map((model) => [model.name, model]));
		assert.equal(models.get("LearnHarness Basic v1")?.id, APKG_MODEL_IDS.basic);
		assert.equal(models.get("LearnHarness Reverse v1")?.id, APKG_MODEL_IDS.reverse);
		assert.deepEqual(models.get("LearnHarness Cloze v1")?.flds.map((field) => field.name), ["LH_ID", "Text", "Extra", "Source"]);
		assert.ok(a.decks.includes("LearnHarness::Eletrônica::Lei de Ohm"));
		assert.ok(a.decks.includes("LearnHarness::Eletrônica::Capacitores"));
	});

	it("writes the package atomically into the exports folder", async () => {
		const directory = temporaryDirectory();
		const written = await writeApkg(cards, { domain: DOMAIN, wasmPath, directory, now: new Date(Date.UTC(2026, 10, 18, 12, 30)) });
		assert.equal(path.basename(written.path), "learnharness-eletronica-20261118T123000Z.apkg");
		assert.equal(fs.statSync(written.path).size, written.bytes);
		assert.equal(written.notes, 4);
		assert.deepEqual(fs.readdirSync(directory), [path.basename(written.path)], "no temporary file is left behind");
	});

	it("packages malformed clozes and control characters instead of failing the whole export", async () => {
		const source: ExportSource = {
			decks: [{ id: "d1", name: "Lei\u001f de Ohm", propositionIds: ["p1"] }],
			propositions: { p1: { id: "p1", name: "Ohm\u0000", cues: [
				{ id: "empty-cloze", question: "Vazio {{c1::}}", answer: "x" },
				{ id: "open-cloze", question: "Aberto {{c1::R", answer: "y" },
				{ id: "big-cloze", question: "Grande {{c501::R}}", answer: "z" },
				{ id: "explicit-cloze", question: "Sem lacuna", answer: "w", kind: "cloze" },
				{ id: "control", question: "Campo\u001fquebrado\u0000?", answer: "ok\u0007" },
				{ id: "good-cloze", question: "V = {{c1::R}}·I e {{c2:: }}", answer: "" },
			] } },
		};
		const malformed = collectExportCards(source, DOMAIN, () => true);
		assert.deepEqual(malformed.map((card) => card.kind), ["basic", "basic", "basic", "basic", "basic", "cloze"]);
		for (const card of malformed) assert.equal(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(card.question + card.answer + card.region + card.propositionName), false);
		const collection = await readCollection(await buildApkg(malformed, { domain: DOMAIN, wasmPath }));
		assert.equal(collection.notes.length, 6);
		assert.ok(collection.notes.every((note) => note.fields.length === 4), "no stray field separator");
		assert.equal(collection.notes.find((note) => note.fields[0] === "control")?.fields[1], "Campoquebrado?");
		assert.ok(collection.decks.includes("LearnHarness::Eletrônica::Lei de Ohm"));
	});

	it("refuses to build an empty package or run without the sql.js WASM", async () => {
		await assert.rejects(buildApkg([], { domain: DOMAIN, wasmPath }), /Não há cartões/);
		await assert.rejects(buildApkg(cards, { domain: DOMAIN, wasmPath: path.join(os.tmpdir(), "missing-sql-wasm.wasm") }), /sql-wasm\.wasm/);
	});
});
