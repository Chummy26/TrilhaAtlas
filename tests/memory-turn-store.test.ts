import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import type { Extractor, TurnInput } from "../src/core/memory/types.ts";
import { HashEmbedder } from "../src/server/memory/hash-embedder.ts";
import { MEMORY_DB_FILE, MemoryDb } from "../src/store/memory/memory-db.ts";
import { openSqlDriver } from "../src/store/memory/sql-driver.ts";

function fixture(t: TestContext, extractor?: Extractor) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-memory-turn-"));
	const open = () => MemoryDb.open(dir, {
		domainId: "english", embedder: new HashEmbedder(), extractor, settings: { autoExtract: false },
	});
	let db = open();
	t.after(async () => {
		await db.close();
		fs.rmSync(dir, { recursive: true, force: true });
	});
	return {
		get db() { return db; },
		async reopen(edit?: (file: string) => void) {
			await db.close();
			edit?.(path.join(dir, MEMORY_DB_FILE));
			db = open();
		},
	};
}

const turn: TurnInput = { sessionId: "s1", sourceId: "native-1", role: "user", text: "I want to practise my English.", ts: 1234, nodeIds: [] };

test("a durable transcript entry is ingested once per session, including after forget and reopen", async t => {
	const f = fixture(t);
	assert.ok(f.db.ingestTurn(turn));
	assert.equal(f.db.ingestTurn(turn), null);
	assert.ok(f.db.ingestTurn({ ...turn, sessionId: "s2" }));
	await f.db.forget({ sessionId: "s1" }, "soft");
	await f.db.forget({ sessionId: "s2" }, "hard");
	await f.reopen();
	for (const sessionId of ["s1", "s2"]) {
		assert.equal(f.db.ingestTurn({ ...turn, sessionId }), null);
		assert.deepEqual(f.db.sessionMessages(sessionId), []);
	}
});

test("upgrades a v1 database, preserves old rows and retries an interrupted receipt write", async t => {
	const f = fixture(t);
	const legacy = { ...turn, sourceId: undefined };
	const id = f.db.ingestTurn(legacy);
	await f.reopen(file => {
		const sql = openSqlDriver(file);
		try {
			sql.exec("DROP TABLE IF EXISTS ingest_receipts");
			sql.exec("UPDATE meta SET value = '1' WHERE key = 'schema_version'");
			sql.exec("CREATE TRIGGER interrupt_insert BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT, 'interrupted'); END");
		} finally { sql.close(); }
	});
	assert.equal(f.db.sessionMessages("s1")[0]?.id, id);
	assert.throws(() => f.db.ingestTurn(turn), /interrupted/);
	await f.reopen(file => {
		const sql = openSqlDriver(file);
		try {
			assert.equal(sql.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value, "2");
			sql.exec("DROP TRIGGER interrupt_insert");
		} finally { sql.close(); }
	});
	assert.ok(f.db.ingestTurn(turn));
	assert.equal(f.db.ingestTurn(turn), null);
	assert.equal(f.db.sessionMessages("s1").length, 2);
});

test("finishing a turn retries pending extraction and consolidation independently, without closing the session", async t => {
	let extracts = 0;
	let consolidations = 0;
	const f = fixture(t, {
		async extract({ messages }) {
			extracts++;
			if (extracts === 1) throw new Error("budget unavailable");
			const m = messages[0]!;
			return { facts: [{ kind: "goal", text: m.text, quote: m.text, sourceMsgIds: [m.id] }], episodes: [], evidence: [], flashcards: [] };
		},
		async consolidate() {
			consolidations++;
			if (consolidations === 1) throw new Error("provider unavailable");
			return { observations: [], mentalModelOps: [] };
		},
	});
	assert.ok(f.db.ingestTurn(turn));
	await assert.rejects(f.db.finishTurn("s1"), /budget unavailable/);
	assert.ok(f.db.health().pendingExtractionTokens > 0);
	await assert.rejects(f.db.finishTurn("s1"), /provider unavailable/);
	assert.equal(f.db.health().pendingExtractionTokens, 0);
	await f.reopen();
	await Promise.all([f.db.finishTurn("s1"), f.db.finishTurn("s1")]);
	assert.equal(extracts, 2);
	assert.equal(consolidations, 2);
	assert.equal(f.db.allFacts().length, 1);
	assert.deepEqual(f.db.diary(), []);
	await f.reopen(file => {
		const sql = openSqlDriver(file);
		try { assert.equal(sql.prepare("SELECT ended_at FROM sessions WHERE id = ?").get("s1")?.ended_at, null); }
		finally { sql.close(); }
	});
});

test("a deferred supersession decision leaves its sources pending for the next turn", async t => {
	let judges = 0;
	const f = fixture(t, {
		async extract({ messages }) {
			const m = messages[0]!;
			const fact = { kind: "goal", text: m.text, quote: m.text, sourceMsgIds: [m.id], nodeIds: ["en"] };
			return { facts: [fact], episodes: [], evidence: [], flashcards: [] };
		},
		async judge(input) {
			if (++judges === 1) throw new Error("budget unavailable");
			return { verdicts: input.pairs.map(pair => ({ pairId: pair.pairId, verdict: "DUPLICATE" })) };
		},
	});
	f.db.ingestTurn(turn);
	await f.db.finishTurn("s1");
	f.db.ingestTurn({ ...turn, sourceId: "native-2" });
	await assert.rejects(f.db.finishTurn("s1"), /budget unavailable/);
	assert.equal(f.db.allFacts().length, 1);
	assert.ok(f.db.health().pendingExtractionTokens > 0);
	await f.db.finishTurn("s1");
	assert.equal(f.db.allFacts()[0]?.proofCount, 2);
	assert.equal(f.db.health().pendingExtractionTokens, 0);
});
