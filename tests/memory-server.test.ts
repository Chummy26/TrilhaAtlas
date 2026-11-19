/**
 * Memory server-side tests (src/server/memory; r4 §7.2 local embeddings,
 * §7.6.2 extraction prompts and zod validation, §7.9 roles).
 *
 * The transformers.js embedder is NEVER loaded here: construction must not
 * import it, and its batching/prefix/dimension logic runs against an
 * injected fake module. The LLM is a scripted `call` function.
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { cosine } from "../src/core/memory/vector.ts";
import { MemoryError, type ConsolidationInput, type ExtractionInput } from "../src/core/memory/types.ts";
import { TransformersEmbedder, type TransformersModule } from "../src/server/memory/embedder.ts";
import {
	MEMORY_OP_ROLES,
	MEMORY_PROMPT_FILES,
	MEMORY_PROMPTS_DIR,
	createLlmExtractor,
	extractJson,
	type MemoryLlmRequest,
	type MemoryLlmResponse,
} from "../src/server/memory/extractor.ts";
import { HashEmbedder, hashEmbed } from "../src/server/memory/hash-embedder.ts";
import { createMemoryService } from "../src/server/memory/index.ts";

const NOW = new Date(2026, 10, 18, 10, 0, 0).getTime();

test("hash-embedder: deterministic, unit length, accent-insensitive, lexically discriminative", async () => {
	const e = new HashEmbedder();
	const [a, b, c, d] = await e.embed(["A tensão no resistor", "a TENSAO no resistor", "tensão no capacitor", "receita de bolo de cenoura"], "passage");
	assert.ok(a && b && c && d);
	assert.equal(a.length, 384);
	assert.deepEqual(Array.from(a), Array.from(hashEmbed("A tensão no resistor")));
	assert.ok(Math.abs(cosine(a, a) - 1) < 1e-6);
	assert.ok(cosine(a, b) > 0.999, "folding makes accents and case irrelevant");
	assert.ok(cosine(a, c) > cosine(a, d));
	assert.equal(e.id, "hash-ngram-v1/384");
	assert.deepEqual(Array.from(hashEmbed("...")), Array.from(new Float32Array(384)));
});

test("transformers embedder is lazy: nothing is imported at construction; E5 prefixes, batching and dimension checks", async () => {
	let loads = 0;
	const seen: string[][] = [];
	const fake: TransformersModule = {
		env: { cacheDir: null, allowRemoteModels: true },
		pipeline: async (task, model, options) => {
			assert.equal(task, "feature-extraction");
			assert.equal(model, "Xenova/multilingual-e5-small");
			assert.equal(options.dtype, "q8");
			return async (texts: string[]) => {
				seen.push(texts);
				const data = new Float32Array(texts.length * 4).map((_, i) => (i % 4) + 1);
				return { data, dims: [texts.length, 4] };
			};
		},
	};
	const cacheDir = path.join(os.tmpdir(), "lh-memory-model-cache");
	const e = new TransformersEmbedder({ dim: 4, batchSize: 2, cacheDir, loader: async () => {
		loads += 1;
		return fake;
	} });
	assert.equal(loads, 0);
	assert.equal(e.loaded, false);
	assert.equal(e.id, "transformers:Xenova/multilingual-e5-small:q8");
	const out = await e.embed(["um", "dois", "três"], "query");
	assert.equal(loads, 1);
	assert.equal(fake.env.cacheDir, cacheDir);
	assert.deepEqual(seen, [["query: um", "query: dois"], ["query: três"]]);
	assert.deepEqual(Array.from(out[2] as Float32Array), [1, 2, 3, 4]);
	await e.embed(["x"], "passage");
	assert.equal(loads, 1, "the pipeline is loaded once");
	assert.deepEqual(seen[2], ["passage: x"]);

	const wrong = new TransformersEmbedder({ dim: 8, loader: async () => fake });
	await assert.rejects(wrong.embed(["a"], "query"), (err: unknown) => err instanceof MemoryError && err.code === "embedder");

	let attempts = 0;
	const flaky = new TransformersEmbedder({ dim: 4, loader: async () => {
		attempts += 1;
		if (attempts === 1) throw new Error("offline");
		return fake;
	} });
	await assert.rejects(flaky.embed(["a"], "query"), /offline/);
	assert.equal((await flaky.embed(["a"], "query")).length, 1, "a failed load is retried on the next call");
});

test("extractJson recovers fenced or prose-wrapped JSON and rejects garbage", () => {
	assert.deepEqual(extractJson('```json\n{"a": 1}\n```'), { a: 1 });
	assert.deepEqual(extractJson('Claro! Aqui está: {"verdicts": []} Espero ter ajudado.'), { verdicts: [] });
	assert.deepEqual(extractJson("[1,2]"), [1, 2]);
	assert.throws(() => extractJson("sem json aqui"), (e: unknown) => e instanceof MemoryError && e.code === "llm-output-invalid");
});

test("prompt files exist, are non-empty and their header comment never reaches the model", async () => {
	for (const file of Object.values(MEMORY_PROMPT_FILES)) {
		const text = fs.readFileSync(path.join(MEMORY_PROMPTS_DIR, file), "utf8");
		assert.ok(text.trimStart().startsWith("<!--"), `${file} documents itself`);
	}
	const requests: MemoryLlmRequest[] = [];
	const ex = createLlmExtractor({
		call: async (req) => {
			requests.push(req);
			return { text: '{"episodes":[],"facts":[],"evidence":[],"flashcards":[]}', modelId: "fake-1", inputTokens: 10, outputTokens: 5 };
		},
	});
	const out = await ex.extract({ domainId: "electronics", sessionId: "s1", now: NOW, sessionStartedAt: NOW, focusNodes: [], messages: [] });
	assert.deepEqual(out.facts, []);
	assert.equal(out.usage?.modelId, "fake-1");
	const req = requests[0] as MemoryLlmRequest;
	assert.equal(req.role, "extractor");
	assert.equal(req.json, true);
	assert.ok(!req.system.includes("<!--"));
	assert.ok(req.system.includes("VERBATIM"));
	assert.equal(MEMORY_OP_ROLES.diary, "consolidator");
});

const extractionInput: ExtractionInput = {
	domainId: "electronics",
	sessionId: "s1",
	now: NOW,
	sessionStartedAt: NOW - 3_600_000,
	focusNodes: ["divisor"],
	messages: [{ id: "msg_1", seq: 1, role: "user", ts: NOW - 60_000, text: "Eu confundo tensão com corrente.", nodeIds: ["divisor"] }],
};

test("extractor retries once with a correction when the answer is not JSON, then succeeds", async () => {
	const answers = ["Desculpe, não consigo.", '```json\n{"facts":[{"kind":"misconception","text":"t","quote":"confundo tensão","sourceMsgIds":["msg_1"]}]}\n```'];
	const requests: MemoryLlmRequest[] = [];
	const ex = createLlmExtractor({
		call: async (req): Promise<MemoryLlmResponse> => {
			requests.push(req);
			return { text: answers[requests.length - 1] ?? "", inputTokens: 100, outputTokens: 20 };
		},
	});
	const out = await ex.extract(extractionInput);
	assert.equal(requests.length, 2);
	assert.equal(out.facts.length, 1);
	assert.equal(out.usage?.inputTokens, 200, "usage sums both attempts");
	const retry = requests[1] as MemoryLlmRequest;
	assert.equal(retry.messages.length, 3);
	assert.equal(retry.messages[1]?.role, "assistant");
	assert.match(retry.messages[2]?.content ?? "", /rejeitada/);
	assert.ok((requests[0] as MemoryLlmRequest).messages[0]?.content.includes('"msg_1"'));
});

test("extractor retries when > 20 % of elements are malformed, and fails loudly after a second bad answer", async () => {
	let calls = 0;
	const half = createLlmExtractor({
		call: async () => {
			calls += 1;
			return { text: JSON.stringify({ facts: [{ kind: "goal", text: "a", quote: "quote", sourceMsgIds: ["msg_1"] }, { kind: 1 }] }) };
		},
	});
	const kept = await half.extract(extractionInput);
	assert.equal(calls, 2, "50 % dropped triggers one retry");
	assert.equal(kept.facts.length, 1, "after the retry the valid elements are kept");

	const never = createLlmExtractor({ call: async () => ({ text: "nada" }) });
	await assert.rejects(never.extract(extractionInput), (e: unknown) => e instanceof MemoryError && e.code === "llm-output-invalid");
});

test("consolidation with an invalid mental-model op batch is retried, then rejected as ops-invalid", async () => {
	const input: ConsolidationInput = { domainId: "electronics", now: NOW, facts: [], observations: [], mentalModel: [], sections: [], learner: null };
	const bad = JSON.stringify({ observations: [], mentalModelOps: [{ op: "add", section: "Estado atual" }] });
	const good = JSON.stringify({ observations: [], mentalModelOps: [{ op: "add", section: "Estado atual", text: "Domina a lei de Ohm.", refs: ["fact:f1"] }] });
	let n = 0;
	const fixes = createLlmExtractor({ call: async () => ({ text: n++ === 0 ? bad : good }) });
	const out = await fixes.consolidate?.(input);
	assert.equal(out?.mentalModelOps.length, 1);

	const stubborn = createLlmExtractor({ call: async () => ({ text: bad }) });
	await assert.rejects(stubborn.consolidate?.(input) ?? Promise.resolve(), (e: unknown) => e instanceof MemoryError && e.code === "ops-invalid");

	const judgeOnly = createLlmExtractor({ call: async () => ({ text: "{}" }), ops: ["extract", "judge"] });
	assert.equal(judgeOnly.consolidate, undefined);
	assert.equal(typeof judgeOnly.judge, "function");
	assert.throws(() => createLlmExtractor({ call: async () => ({ text: "{}" }), ops: ["judge"] }));
});

test("createMemoryService composes the per-domain layout without loading any model", async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-memory-server-"));
	const service = createMemoryService({ dataRoot: root, embedder: new HashEmbedder() });
	try {
		await service.open("electronics");
		service.ingestTurn({ sessionId: "s1", role: "user", text: "Quero revisar o divisor de tensão amanhã.", ts: NOW, nodeIds: [] });
		await service.active().flush();
		assert.ok(fs.existsSync(path.join(root, "domains", "electronics", "memory", "memory.db")));
		const r = await service.recall({ domainId: "electronics", sessionId: "s1", query: "divisor de tensao", focusNodes: [], now: NOW });
		assert.equal(r.items.length, 1);
		await service.endSession("s1");
		const prefix = await service.stablePrefix("electronics", "s2");
		assert.ok(prefix.text.includes("Retomada"), "the deterministic diary is written without an LLM");
	} finally {
		await service.close();
		fs.rmSync(root, { recursive: true, force: true });
	}
	const lazy = createMemoryService({ dataRoot: root });
	await lazy.close();
});
