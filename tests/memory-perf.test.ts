/**
 * Memory performance gates (r4 §7.6.4 "recall p50 ≤ 200 ms"; task gates:
 * ingestTurn synchronous < 5 ms, recall p50 < 200 ms with 5k messages using
 * the hash-embedder). Temp dir only; deterministic pseudo-random corpus.
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { MemoryDb } from "../src/store/memory/memory-db.ts";
import { HashEmbedder } from "../src/server/memory/hash-embedder.ts";

const T0 = new Date(2026, 8, 1, 9, 0, 0).getTime();

function prng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 2 ** 32;
	};
}

const SUBJECTS = ["a tensão", "a corrente", "o resistor", "o capacitor", "o indutor", "o divisor resistivo", "a lei de Ohm", "o transistor", "o diodo", "a potência", "o osciloscópio", "a impedância"];
const VERBS = ["confundi", "calculei", "medi", "entendi", "errei", "revisei", "simulei", "anotei", "comparei", "derivei"];
const DETAILS = ["no exercício", "na prova", "no laboratório", "no circuito RC", "na protoboard", "com o multímetro", "em série", "em paralelo", "na malha 2", "no nó A"];

function median(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)] as number;
}

test("ingestTurn < 5 ms and recall p50 < 200 ms over 5k messages (hash-embedder)", { timeout: 300_000 }, async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-memory-perf-"));
	let now = T0;
	const db = MemoryDb.open(dir, { domainId: "electronics", embedder: new HashEmbedder(), clock: () => now });
	try {
		const rand = prng(42);
		const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)] as T;
		const ingestMs: number[] = [];
		for (let i = 0; i < 5000; i++) {
			now += 45_000 + Math.floor(rand() * 60_000);
			const session = `s${Math.floor(i / 100)}`;
			const text = `Hoje ${pick(VERBS)} ${pick(SUBJECTS)} ${pick(DETAILS)} e depois ${pick(VERBS)} ${pick(SUBJECTS)} ${pick(DETAILS)} (passo ${i}).`;
			const t0 = performance.now();
			db.ingestTurn({ sessionId: session, role: i % 2 ? "assistant" : "user", text, ts: now, nodeIds: [`n${i % 40}`] });
			ingestMs.push(performance.now() - t0);
		}
		await db.flush();
		assert.equal(db.health().messages, 5000);
		assert.equal(db.health().vectors, 5000);
		const ingestP50 = median(ingestMs);
		assert.ok(ingestP50 < 5, `ingestTurn p50 ${ingestP50.toFixed(2)} ms`);

		const queries = [
			"o que eu errei sobre a tensão no divisor resistivo?",
			"quando medi a corrente com o multímetro",
			"capacitor no circuito RC",
			"o que fizemos na semana passada com o transistor",
			"revisei a lei de Ohm em paralelo",
			"impedancia do indutor",
			"diodo na protoboard ontem",
			"potência na malha 2",
		];
		await db.recall({ domainId: "electronics", sessionId: "s49", query: queries[0] as string, focusNodes: ["n1"], now });
		const recallMs: number[] = [];
		for (let round = 0; round < 4; round++) {
			for (const q of queries) {
				const r = await db.recall({ domainId: "electronics", sessionId: "s49", query: q, focusNodes: [`n${round}`], now });
				assert.ok(r.items.length > 0, q);
				assert.ok(r.tokens <= 2000);
				recallMs.push(r.ms);
			}
		}
		const p50 = median(recallMs);
		t.diagnostic(`ingestTurn p50 ${ingestP50.toFixed(3)} ms · recall p50 ${p50.toFixed(1)} ms · max ${Math.max(...recallMs).toFixed(1)} ms`);
		assert.ok(p50 < 200, `recall p50 ${p50.toFixed(1)} ms`);
	} finally {
		await db.close();
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
