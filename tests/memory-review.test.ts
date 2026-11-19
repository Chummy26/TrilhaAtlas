/**
 * Regression tests from the adversarial review of the memory module
 * (docs/impl/memory.md "Revisão"; SÍNTESE §2.4(d), §2.5; r4 §7.6, §7.11).
 * Each test pins one bug that was found and fixed:
 *
 *   - endSession is best-effort: a failing extractor/consolidator no longer
 *     loses the diary hand-off ("Retomada") nor leaves the session open;
 *   - a failed embedding batch is re-queued instead of silently dropped;
 *   - recall survives a concurrent forget (no TypeError, no forgotten item);
 *   - hard forget leaves no trace of the forgotten text anywhere on disk
 *     (rejected-extraction audit, duplicate audit, surviving fact quotes, WAL);
 *   - soft forget of a session hides its diary and observation log;
 *   - session-scoped facts never surface in another session;
 *   - the extraction token counter is not wiped for turns ingested while an
 *     extraction was running;
 *   - the service routes endSession to the domain that owns the session;
 *   - "desde outubro" is an open interval up to now;
 *   - an accent-less query finds a FACT through FTS;
 *   - budget properties of the pure packers (fast-check).
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import fc from "fast-check";

import { CONTEXT_BUDGETS, assembleContext, packRecall, type RenderableItem } from "../src/core/memory/assemble.ts";
import { parseTimeRange, startOfDay } from "../src/core/memory/temporal.ts";
import { estimateTokens, fitLines, truncateToTokens } from "../src/core/memory/tokens.ts";
import {
	MemoryError,
	type ConsolidationInput,
	type ConsolidationOutput,
	type Embedder,
	type ExtractionInput,
	type ExtractionOutput,
	type Extractor,
	type FactCandidate,
	type JudgeInput,
	type JudgeOutput,
	type ObserveInput,
	type ObserveOutput,
} from "../src/core/memory/types.ts";
import { MEMORY_DB_FILE, MemoryDb, type MemoryDbOptions } from "../src/store/memory/memory-db.ts";
import { DomainMemoryService } from "../src/store/memory/service.ts";
import { HashEmbedder } from "../src/server/memory/hash-embedder.ts";

const T0 = new Date(2026, 10, 10, 14, 0, 0).getTime();
const DAY = 86_400_000;

function tmpDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "lh-memory-review-"));
}

class Clock {
	t = T0;
	readonly now = () => this.t;
	advance(ms: number): number {
		this.t += ms;
		return this.t;
	}
}

function gate(): { promise: Promise<void>; open: () => void } {
	let open = () => undefined as void;
	const promise = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { promise, open };
}

function open(dir: string, clock: Clock, extra: Partial<MemoryDbOptions> = {}): MemoryDb {
	return MemoryDb.open(dir, { domainId: "electronics", embedder: new HashEmbedder(), clock: clock.now, ...extra });
}

function turn(db: MemoryDb, clock: Clock, sessionId: string, role: "user" | "assistant", text: string, nodeIds: string[] = []): string {
	const id = db.ingestTurn({ sessionId, role, text, ts: clock.advance(60_000), nodeIds });
	assert.ok(id);
	return id;
}

function firstWords(text: string, n: number): string {
	return text.split(/\s+/).slice(0, n).join(" ");
}

const emptyExtraction = (): ExtractionOutput => ({ episodes: [], facts: [], evidence: [], flashcards: [] });

function cleanup(dir: string): void {
	fs.rmSync(dir, { recursive: true, force: true });
}

// ─── endSession resilience ──────────────────────────────────────────────────

test("endSession still writes the diary and closes the session when consolidation or extraction fails", async () => {
	const dir = tmpDir();
	const clock = new Clock();
	let mode: "bad-ops" | "extract-throws" = "bad-ops";
	const extractor: Extractor = {
		extract: async (input: ExtractionInput) => {
			if (mode === "extract-throws") throw new Error("modelo fora do ar");
			const m = input.messages.find((x) => x.role === "user");
			if (!m) return emptyExtraction();
			return { ...emptyExtraction(), facts: [{ kind: "goal", text: "O aluno quer passar em Circuitos I.", quote: firstWords(m.text, 4), sourceMsgIds: [m.id] }] };
		},
		consolidate: async (input: ConsolidationInput): Promise<ConsolidationOutput> => ({
			observations: [],
			mentalModelOps: [{ op: "edit", targetId: "m_00000000000000000000000000", newText: "x", newRefs: [`fact:${input.facts[0]?.id}`] }],
		}),
	};
	const db = open(dir, clock, { extractor });
	try {
		turn(db, clock, "s1", "user", "Quero passar em Circuitos I até dezembro.");
		await assert.rejects(db.endSession("s1"), (e: unknown) => e instanceof MemoryError && e.code === "ops-invalid");
		assert.ok(db.diary().some((d) => d.sessionId === "s1"), "the diary is written even though consolidation failed");
		assert.ok((await db.stablePrefix("s2")).text.includes("Retomada"));
		assert.equal(db.listFacts().length, 1, "extraction before the failing step is kept");

		mode = "extract-throws";
		turn(db, clock, "s3", "user", "Hoje revisei o teorema de Thévenin com calma.");
		await assert.rejects(db.endSession("s3"), /modelo fora do ar/);
		assert.ok(db.diary().some((d) => d.sessionId === "s3"), "the diary is written even though extraction failed");
		assert.ok(db.health().pendingExtractionTokens > 0, "the L0 log stays pending for a retry");
	} finally {
		await db.close();
		cleanup(dir);
	}
});

// ─── embeddings ─────────────────────────────────────────────────────────────

test("a failed embedding batch is re-queued and embedded on the next run", async () => {
	const dir = tmpDir();
	const clock = new Clock();
	const hash = new HashEmbedder();
	let failures = 1;
	const flaky: Embedder = {
		id: hash.id,
		dim: hash.dim,
		embed: async (texts, kind) => {
			if (kind === "passage" && failures > 0) {
				failures -= 1;
				throw new Error("onnx indisponível");
			}
			return hash.embed(texts, kind);
		},
	};
	const errors: string[] = [];
	const db = open(dir, clock, { embedder: flaky, onError: (_e, op) => errors.push(op) });
	try {
		turn(db, clock, "s1", "user", "O capacitor carrega pelo resistor em série.");
		await db.flush();
		assert.deepEqual(errors, ["embed"]);
		assert.equal(db.health().vectors, 0);
		turn(db, clock, "s1", "user", "A constante de tempo é R vezes C.");
		await db.flush();
		assert.equal(db.health().vectors, 2, "the first message is embedded on the next run, not lost until reopen");
	} finally {
		await db.close();
		cleanup(dir);
	}
});

// ─── recall vs concurrent forget ────────────────────────────────────────────

test("recall survives a forget that runs while it awaits a port, and never returns the forgotten item", async () => {
	for (const mode of ["soft", "hard"] as const) {
		const dir = tmpDir();
		const clock = new Clock();
		let hold: { promise: Promise<void>; open: () => void } | null = null;
		let entered: () => void = () => undefined;
		const db = open(dir, clock, {
			learner: {
				promptSnapshot: () => null,
				weakNodes: async () => {
					if (hold) {
						entered();
						await hold.promise;
					}
					return [];
				},
			},
		});
		try {
			const secret = turn(db, clock, "s1", "user", "Minha senha do laboratório é zebra-azul-77.");
			turn(db, clock, "s1", "user", "O laboratório abre às oito da manhã.");
			await db.flush();
			hold = gate();
			const reached = new Promise<void>((resolve) => {
				entered = resolve;
			});
			const pending = db.recall({ domainId: "electronics", sessionId: "s1", query: "senha do laboratório zebra", focusNodes: [], now: clock.t });
			await reached;
			await db.forget({ messageIds: [secret] }, mode);
			hold.open();
			const r = await pending;
			assert.ok(!r.items.some((i) => i.id === secret), `${mode}: forgotten message must not be returned`);
			assert.ok(!r.rendered.includes("zebra"), `${mode}: forgotten text must not be rendered`);
		} finally {
			hold?.open();
			await db.close();
			cleanup(dir);
		}
	}
});

// ─── hard forget leaves nothing on disk ─────────────────────────────────────

class ScriptedExtractor implements Extractor {
	judge?: (input: JudgeInput) => Promise<JudgeOutput>;
	constructor(private readonly plan: (input: ExtractionInput) => FactCandidate[], verdict?: "DUPLICATE") {
		if (verdict) this.judge = async (input) => ({ verdicts: input.pairs.map((p) => ({ pairId: p.pairId, verdict })) });
	}
	async extract(input: ExtractionInput): Promise<ExtractionOutput> {
		return { ...emptyExtraction(), facts: this.plan(input) };
	}
}

function diskContains(dir: string, needle: string): string[] {
	const hits: string[] = [];
	for (const name of fs.readdirSync(dir)) {
		const bytes = fs.readFileSync(path.join(dir, name));
		if (bytes.includes(Buffer.from(needle, "utf8"))) hits.push(name);
	}
	return hits;
}

const SECRET_TEXT = "A senha do armário é zebra-azul-77 e fica no laboratório.";
const PLAIN_TEXT = "O armário de osciloscópios do laboratório tem senha.";

/** The secret message yields a fact quoting it + an ungrounded fact whose TEXT carries the secret (→ audit). */
const secretPlan = (input: ExtractionInput): FactCandidate[] => {
	const m = input.messages.find((x) => x.role === "user");
	if (!m) return [];
	if (m.text.includes("zebra")) {
		return [
			{ kind: "world", text: "O armário do laboratório tem a senha zebra-azul-77.", quote: "senha do armário é zebra-azul-77", sourceMsgIds: [m.id] },
			{ kind: "world", text: "O aluno guarda a chave zebra-azul-77 consigo.", quote: "frase que não existe na conversa", sourceMsgIds: [m.id] },
		];
	}
	return [{ kind: "world", text: "O laboratório tem senha no armário de osciloscópios.", quote: firstWords(m.text, 5), sourceMsgIds: [m.id] }];
};

test("hard forget leaves no byte of the forgotten text on disk (audit, merged sources, diary, WAL)", async () => {
	// Order 1: plain fact first, the secret one is merged into it as a DUPLICATE → the fact survives, pruned.
	// Order 2: secret fact first (its text and quote come from the secret), plain duplicate later → the
	//          fact loses the only message supporting its quote and is deleted with it.
	for (const order of ["plain-first", "secret-first"] as const) {
		const dir = tmpDir();
		const clock = new Clock();
		const db = open(dir, clock, { extractor: new ScriptedExtractor(secretPlan, "DUPLICATE"), settings: { supersedeMinCosine: 0.1 } });
		try {
			const texts = order === "plain-first" ? [PLAIN_TEXT, SECRET_TEXT] : [SECRET_TEXT, PLAIN_TEXT];
			const ids = texts.map((text, i) => {
				const id = turn(db, clock, `s${i + 1}`, "user", text);
				return id;
			});
			await db.endSession("s1");
			await db.endSession("s2");
			assert.equal(db.listFacts().length, 1, `${order}: the second fact was merged as a duplicate`);
			assert.ok(diskContains(dir, "zebra").length > 0, "sanity: the secret is on disk before forgetting");

			const secretId = order === "plain-first" ? ids[1] : ids[0];
			const plainId = order === "plain-first" ? ids[0] : ids[1];
			await db.forget({ messageIds: [secretId as string] }, "hard");
			const facts = db.listFacts();
			if (order === "plain-first") {
				assert.equal(facts.length, 1, "the fact survives through its other source");
				assert.deepEqual(facts[0]?.sourceMsgIds, [plainId], "dangling source ids are pruned");
			} else {
				assert.equal(facts.length, 0, "a fact whose quote only the forgotten message supported is forgotten too");
			}
			assert.equal(db.diary().filter((d) => d.sessionId === (order === "plain-first" ? "s2" : "s1")).length, 0, "the emptied session's diary is gone");
			assert.deepEqual(diskContains(dir, "zebra"), [], `${order}: no file (db, wal, shm) may still hold the forgotten text`);
		} finally {
			await db.close();
			cleanup(dir);
		}
	}
});

// ─── soft forget hides session-derived text ─────────────────────────────────

test("soft forget of a session hides its diary hand-off and its observation log", async () => {
	const dir = tmpDir();
	const clock = new Clock();
	const extractor: Extractor = {
		extract: async () => emptyExtraction(),
		observe: async (input: ObserveInput): Promise<ObserveOutput> => ({ log: `### dia\n- 🔴 ${input.messages.map((m) => m.text).join(" | ")}` }),
	};
	const db = open(dir, clock, { extractor });
	try {
		turn(db, clock, "s1", "user", "Tenho vergonha de dizer que reprovei em Circuitos I.");
		await db.endSession("s1");
		assert.ok((await db.stablePrefix("s2")).text.includes("Retomada"));
		assert.ok(db.observationLog("s1").includes("reprovei"));

		await db.forget({ sessionId: "s1" }, "soft");
		const prefix = await db.stablePrefix("s2");
		assert.ok(!prefix.text.includes("Retomada"), "the forgotten session's diary no longer opens the next session");
		assert.equal(db.observationLog("s1"), "", "the forgotten session's working memory is hidden");
		assert.ok(!(await db.stablePrefix("s1")).text.includes("reprovei"));
	} finally {
		await db.close();
		cleanup(dir);
	}
});

// ─── session scope ──────────────────────────────────────────────────────────

test("a session-scoped fact is recalled in its own session only", async () => {
	const dir = tmpDir();
	const clock = new Clock();
	const extractor = new ScriptedExtractor((input) => {
		const m = input.messages.find((x) => x.role === "user");
		return m ? [{ kind: "affect", text: "O aluno está cansado hoje e quer exercícios curtos de Thévenin.", quote: firstWords(m.text, 5), sourceMsgIds: [m.id], scope: "session" }] : [];
	});
	const db = open(dir, clock, { extractor });
	try {
		turn(db, clock, "s1", "user", "Estou muito cansado hoje, só exercícios curtos de Thévenin.");
		await db.endSession("s1");
		const factId = db.listFacts()[0]?.id;
		assert.ok(factId);
		const q = (sessionId: string) => db.recall({ domainId: "electronics", sessionId, query: "aluno cansado exercícios curtos Thévenin", focusNodes: [], now: clock.t });
		assert.ok((await q("s1")).items.some((i) => i.id === factId), "visible in its own session");
		assert.ok(!(await q("s2")).items.some((i) => i.id === factId), "never leaks into another session");
	} finally {
		await db.close();
		cleanup(dir);
	}
});

// ─── extraction thresholds ──────────────────────────────────────────────────

test("turns ingested while an extraction runs still count toward the next extraction", async () => {
	const dir = tmpDir();
	const clock = new Clock();
	const hold = gate();
	let entered: () => void = () => undefined;
	const reached = new Promise<void>((resolve) => {
		entered = resolve;
	});
	let calls = 0;
	const extractor: Extractor = {
		extract: async () => {
			calls += 1;
			if (calls === 1) {
				entered();
				await hold.promise;
			}
			return emptyExtraction();
		},
	};
	const db = open(dir, clock, { extractor, settings: { extractBatchTokens: 100 } });
	const words = (n: number) => Array.from({ length: n }, (_, i) => `palavra${i % 10}`).join(" ");
	try {
		// "palavraN" costs 2 tokens: 60 words = 120 tokens (≥ 100: extraction #1 starts and blocks).
		turn(db, clock, "s1", "user", words(60));
		await reached;
		turn(db, clock, "s1", "user", words(30)); // 60 tokens, ingested while #1 runs
		hold.open();
		await db.flush();
		assert.equal(calls, 1, "60 pending tokens alone stay below the batch threshold");
		turn(db, clock, "s1", "user", words(20)); // + 40 tokens = 100 pending (one batch of ≤ 100)
		await db.flush();
		assert.equal(calls, 2, "60 + 40 pending tokens ≥ 100 trigger a second extraction");
		assert.equal(db.health().pendingExtractionTokens, 0);
	} finally {
		hold.open();
		await db.close();
		cleanup(dir);
	}
});

// ─── service routing ────────────────────────────────────────────────────────

test("service.endSession goes to the open domain that owns the session, not blindly to the active one", async () => {
	const root = tmpDir();
	const clock = new Clock();
	const service = new DomainMemoryService({ dirFor: (id) => path.join(root, id), embedder: new HashEmbedder(), clock: clock.now });
	try {
		await service.open("electronics");
		service.ingestTurn({ sessionId: "s-el", role: "user", text: "Revisei o divisor de tensão com carga.", ts: clock.advance(1000), nodeIds: [] });
		await service.open("english");
		await service.endSession("s-el");
		assert.ok(service.get("electronics")?.diary().some((d) => d.sessionId === "s-el"));
		assert.equal(service.get("english")?.diary().length, 0, "nothing is written into the other domain");
		await assert.rejects(service.endSession("s-unknown"), (e: unknown) => e instanceof MemoryError && e.code === "invalid-input");
	} finally {
		await service.close();
		cleanup(root);
	}
});

// ─── time ───────────────────────────────────────────────────────────────────

test("\"desde outubro\" is an interval from October 1st up to now", () => {
	const now = new Date(2026, 10, 18, 15, 0, 0).getTime();
	const r = parseTimeRange("o que estudei desde outubro?", now);
	assert.ok(r);
	assert.equal(r.from, new Date(2026, 9, 1).getTime());
	assert.ok(r.to > now, "open up to now");
	const plain = parseTimeRange("o que estudei em outubro?", now);
	assert.equal(plain?.to, startOfDay(new Date(2026, 10, 1).getTime()));
});

// ─── FTS on facts ───────────────────────────────────────────────────────────

test("an accent-less paraphrase finds a FACT through the FTS channel (\"tensao\" → \"tensão\")", async () => {
	const dir = tmpDir();
	const clock = new Clock();
	const flat: Embedder = { id: "flat/8", dim: 8, embed: async (texts) => texts.map(() => Float32Array.from([1, 0, 0, 0, 0, 0, 0, 0])) };
	const extractor = new ScriptedExtractor((input) =>
		input.messages
			.filter((m) => m.text.includes("Thévenin"))
			.map((m) => ({ kind: "misconception" as const, text: "O aluno acha que a tensão de Thévenin depende da carga; na verdade não depende.", quote: firstWords(m.text, 6), sourceMsgIds: [m.id] })),
	);
	const db = MemoryDb.open(dir, { domainId: "electronics", embedder: flat, clock: clock.now, extractor });
	try {
		turn(db, clock, "s1", "user", "Eu acho que a tensão de Thévenin muda quando troco a carga.");
		for (let i = 0; i < 15; i++) turn(db, clock, "s1", "assistant", `Comentário ${i} sobre resistores e LEDs.`);
		await db.endSession("s1");
		const fact = db.listFacts()[0];
		assert.ok(fact);
		const r = await db.recall({ domainId: "electronics", sessionId: "s2", query: "tensao thevenin carga", focusNodes: [], now: clock.t });
		const hit = r.items.find((i) => i.id === fact.id);
		assert.ok(hit, "the fact is recalled by an accent-less query");
		assert.ok(hit.channels.includes("fts"));
	} finally {
		await db.close();
		cleanup(dir);
	}
});

// ─── budget properties ──────────────────────────────────────────────────────

const textArb = fc.array(fc.stringMatching(/^[a-zçãéõ0-9 .,!?\n-]{0,80}$/), { maxLength: 60 }).map((xs) => xs.join("\n"));

test("truncateToTokens and fitLines never exceed their budget (property)", () => {
	fc.assert(
		fc.property(textArb, fc.integer({ min: 0, max: 120 }), (text, max) => {
			assert.ok(estimateTokens(truncateToTokens(text, max)) <= max);
			for (const keep of ["head", "tail"] as const) {
				const fitted = fitLines(text, max, keep);
				assert.ok(fitted.tokens <= max);
				assert.equal(estimateTokens(fitted.text), fitted.tokens);
			}
		}),
		{ numRuns: 300 },
	);
});

test("assembleContext and packRecall respect every budget (property)", () => {
	const budgetsArb = fc.record({
		profile: fc.integer({ min: 0, max: 400 }),
		mentalModels: fc.integer({ min: 0, max: 1200 }),
		learner: fc.integer({ min: 0, max: 400 }),
		observationLog: fc.integer({ min: 0, max: 3000 }),
		recall: fc.integer({ min: 0, max: 2000 }),
		total: fc.integer({ min: 20, max: 6000 }),
	});
	fc.assert(
		fc.property(textArb, textArb, textArb, textArb, budgetsArb, (a, b, c, d, budgets) => {
			const ctx = assembleContext({ profile: a, mentalModels: b, learner: c, observationLog: d, recall: a + b }, budgets);
			assert.ok(ctx.tokens <= budgets.total, `${ctx.tokens} > ${budgets.total}`);
			for (const s of ctx.sections) assert.ok(s.tokens <= budgets[s.id]);
			assert.equal(estimateTokens(ctx.text), ctx.tokens);
		}),
		{ numRuns: 200 },
	);
	const itemsArb = fc.array(
		fc.record({ text: fc.stringMatching(/^[a-zãé ]{1,300}$/), days: fc.integer({ min: 0, max: 60 }) }),
		{ maxLength: 30 },
	);
	const now = new Date(2026, 10, 18, 12, 0, 0).getTime();
	fc.assert(
		fc.property(itemsArb, fc.integer({ min: 0, max: 600 }), (raw, budget) => {
			const items: RenderableItem[] = raw.map((r, i) => ({ kind: "fact", id: `f${i}`, text: r.text, at: now - r.days * DAY, factKind: "world" }));
			const packed = packRecall(items, budget, now);
			assert.ok(packed.tokens <= Math.max(0, budget));
			assert.equal(estimateTokens(packed.rendered), packed.tokens);
		}),
		{ numRuns: 200 },
	);
	assert.equal(CONTEXT_BUDGETS.total, 12_000);
});

test("reopening a database does not resurrect vectors of soft-forgotten items", async () => {
	const dir = tmpDir();
	const clock = new Clock();
	const db = open(dir, clock);
	const secret = turn(db, clock, "s1", "user", "Minha senha é zebra-azul-77.");
	turn(db, clock, "s1", "user", "O multímetro mede tensão e corrente.");
	await db.flush();
	await db.forget({ messageIds: [secret] }, "soft");
	assert.equal(db.health().vectors, 1);
	await db.close();
	const again = open(dir, clock);
	try {
		await again.flush();
		assert.equal(again.health().vectors, 1, "a soft-forgotten item has no vector after reopen");
		assert.ok(fs.existsSync(path.join(dir, MEMORY_DB_FILE)));
	} finally {
		await again.close();
		cleanup(dir);
	}
});
