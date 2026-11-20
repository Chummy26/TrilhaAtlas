import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-tutor-memory-delete-"));
process.env.LH_DATA_DIR = root;
process.env.LH_AUTH_FILE = path.join(root, "auth.json");
const { DELETE } = await import("../app/api/graph/sources/route.ts");
const { deleteChatSession } = await import("../src/server/chats.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { createTutorMemoryService } = await import("../src/server/memory/tutor.ts");
const { switchStudyDomain } = await import("../src/server/study.ts");
const { HashEmbedder } = await import("../src/server/memory/hash-embedder.ts");
const { openSqlDriver } = await import("../src/store/memory/sql-driver.ts");
const { memoryDbFile } = await import("../src/core/domains/paths.ts");
const { MemoryDb } = await import("../src/store/memory/memory-db.ts");

let started!: () => void;
let release!: () => void;
const extracting = new Promise<void>(resolve => { started = resolve; });
const gate = new Promise<void>(resolve => { release = resolve; });
const service = createTutorMemoryService({
	embedder: new HashEmbedder(),
	callFor: () => async () => {
		started();
		await gate;
		return { text: "{}" };
	},
});
const key = Symbol.for("learnharness.tutorMemory");
const state = globalThis as typeof globalThis & { [key]?: typeof service };
state[key] = service;
after(async () => {
	release();
	await service.close();
	delete state[key];
	fs.rmSync(root, { recursive: true, force: true, maxRetries: 4 });
});

const bulk = (sourceIds: string[], deleteSessions: boolean) => DELETE(new Request("http://local/api/graph/sources", {
	method: "DELETE", body: JSON.stringify({ sourceIds, folderIds: [], deleteSessions }),
}));
const input = (sessionId: string) => ({ sessionId, sourceId: "n1", role: "user" as const, text: "Only this session remembers this example.", ts: Date.now(), nodeIds: [] });

test("deleting a never-remembered chat does not create memory, and a cold disk purge keeps other sessions", async () => {
	switchStudyDomain("electronics");
	const file = memoryDbFile(root, "electronics");
	const fresh = chatStore.createChat("Fresh");
	assert.equal((await deleteChatSession(fresh.id, "preserve-graph")).ok, true);
	assert.equal(fs.existsSync(file), false);
	const chat = chatStore.createChat("Persistent");
	const keep = chatStore.createChat("Keep");
	const db = MemoryDb.open(path.dirname(file), { domainId: "electronics", embedder: new HashEmbedder() });
	db.ingestTurn(input(chat.id));
	db.ingestTurn(input(keep.id));
	await db.close();
	assert.equal((await deleteChatSession(chat.id, "delete-nodes")).ok, true);
	const sql = openSqlDriver(file);
	try {
		assert.deepEqual(sql.prepare("SELECT session_id FROM messages").all().map(r => r.session_id), [keep.id]);
		assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM embeddings").get()?.n, 1);
	} finally { sql.close(); }
});

test("an active extraction refuses the entire batch; retry forgets deleted chats and preserves retained ones", async () => {
	switchStudyDomain("english");
	const a = chatStore.createChat("Remove A");
	const b = chatStore.createChat("Remove B");
	const c = chatStore.createChat("Keep C");
	await service.open("english");
	const db = service.get("english")!;
	for (const chat of [a, b, c]) db.ingestTurn(input(chat.id));
	const settling = db.finishTurn(b.id);
	await extracting;
	try {
		const response = await bulk([a.id, b.id], true);
		assert.equal(response.status, 503);
		assert.ok(chatStore.getChat(a.id) && chatStore.getChat(b.id));
		assert.ok(db.hasSession(a.id) && db.hasSession(b.id));
		assert.equal((await deleteChatSession(b.id, "preserve-graph")).ok, false);
	} finally { release(); }
	await settling;
	await db.flush();
	assert.equal((await bulk([c.id], false)).status, 200);
	assert.ok(db.hasSession(c.id));
	assert.equal((await bulk([a.id, b.id], true)).status, 200);
	assert.ok(!db.hasSession(a.id) && !db.hasSession(b.id) && db.hasSession(c.id));
	assert.ok(!chatStore.getChat(a.id) && !chatStore.getChat(b.id) && chatStore.getChat(c.id));
});

test("unreadable memory refuses deletion and keeps the canonical conversation available for retry", async () => {
	switchStudyDomain("electronics");
	const chat = chatStore.createChat("Still recoverable");
	const file = memoryDbFile(root, "electronics");
	const db = MemoryDb.open(path.dirname(file), { domainId: "electronics", embedder: new HashEmbedder() });
	db.ingestTurn(input(chat.id));
	await db.close();
	const saved = fs.readFileSync(file);
	fs.writeFileSync(file, "broken sqlite file");
	try {
		const outcome = await deleteChatSession(chat.id, "preserve-graph");
		assert.ok(!outcome.ok && outcome.status === 503);
		assert.ok(chatStore.getChat(chat.id));
		assert.equal((await bulk([chat.id], true)).status, 503);
		assert.ok(chatStore.getChat(chat.id));
	} finally { fs.writeFileSync(file, saved); }
	assert.ok((await deleteChatSession(chat.id, "preserve-graph")).ok);
});
