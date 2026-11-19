/** Retrieval-only LongMemEval-S check. Input is a local copy of the public dataset. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemoryDb } from "../src/store/memory/memory-db.ts";
import { HashEmbedder, TransformersEmbedder } from "../src/server/memory/index.ts";

type Case = { question_id: string; question_type: string; question: string; question_date: string; answer_session_ids: string[];
	haystack_sessions: { role: "assistant" | "user"; content: string; has_answer?: boolean }[][];
	haystack_session_ids: string[]; haystack_dates: string[] };

function timestamp(date: string) {
	const parts = /^(\d{4})\/(\d\d)\/(\d\d) \(\w+\) (\d\d):(\d\d)/.exec(date);
	if (!parts) throw new Error("Unexpected dataset timestamp");
	return Date.UTC(+parts[1]!, +parts[2]! - 1, +parts[3]!, +parts[4]!, +parts[5]!);
}

const [, , file, backend = "e5", perType = "1"] = process.argv;
if (!file || !["hash", "e5"].includes(backend) || !/^[1-9]\d*$/.test(perType))
	throw new Error("Usage: node --import tsx scripts/evaluate-study-memory.ts <longmemeval_s_cleaned.json> [e5|hash] [cases-per-type]");
const data: Case[] = JSON.parse(fs.readFileSync(file, "utf8"));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "trilha-memory-evaluation-"));
const embedder = backend === "hash" ? new HashEmbedder() : new TransformersEmbedder({ cacheDir: path.join(path.dirname(path.resolve(file)), "e5"), batchSize: 4 });
const counts = new Map<string, number>();
let sessionHits = 0, completeEvidence = 0, evidenceHits = 0, evidenceTurns = 0, cases = 0;
try {
	await embedder.embed(["Retrieval evaluation"], "query");
	for (const example of data) {
		const count = counts.get(example.question_type) ?? 0;
		if (count >= Number(perType) || example.question_id.endsWith("_abs")) continue;
		counts.set(example.question_type, count + 1);
		const domainId = "evaluation-" + cases++;
		const errors: unknown[] = [];
		const db = MemoryDb.open(path.join(root, domainId), { domainId, embedder, onError: error => errors.push(error) });
		try {
			const evidence = new Set<string>();
			for (const [index, session] of example.haystack_sessions.entries()) {
				const sessionId = example.haystack_session_ids[index]!;
				const start = timestamp(example.haystack_dates[index]!);
				for (const [seq, turn] of session.entries()) {
					const id = db.ingestTurn({ sessionId, role: turn.role, text: turn.content, nodeIds: [], ts: start + seq });
					if (id && turn.has_answer) evidence.add(id);
				}
			}
			await db.flush();
			const recall = await db.recall({ domainId, sessionId: "new-session", query: example.question, focusNodes: [], now: timestamp(example.question_date) });
			if (errors.length) throw errors[0];
			const sessions = new Set(recall.items.map(item => item.sessionId));
			const hits = recall.items.filter(item => evidence.has(item.id)).length;
			const found = example.answer_session_ids.some(id => sessions.has(id));
			sessionHits += Number(found);
			completeEvidence += Number(evidence.size > 0 && hits === evidence.size);
			evidenceHits += hits;
			evidenceTurns += evidence.size;
			console.log(JSON.stringify({ case: example.question_id, type: example.question_type, sessions: example.haystack_sessions.length,
				sessionHit: found, evidenceHits: hits, evidenceTurns: evidence.size, contextTokens: recall.tokens }));
		} finally { await db.close(); }
	}
	console.log(JSON.stringify({ backend, cases, sessionHits, completeEvidence, evidenceHits, evidenceTurns }));
} finally {
	if (embedder instanceof TransformersEmbedder) await embedder.dispose();
	fs.rmSync(root, { recursive: true, force: true });
}
