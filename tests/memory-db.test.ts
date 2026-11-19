/**
 * Memory store tests (src/store/memory; SÍNTESE §2.3 MemoryService; r4 §7.3
 * isolation, §7.6 operations, §7.11 invariants).
 *
 * Every database lives in a fresh temp dir (never the repo's data/). The LLM
 * side is a scripted fake `Extractor`, the embedder is the deterministic
 * hash-embedder, and the clock is controlled so dates are reproducible.
 *
 * Covers: domain isolation (two DBs, zero leakage, explicit routing), FTS
 * accent folding ("tensao" finds "tensão"), bitemporal supersession through
 * the judge (old fact gets valid_to, nothing overwritten), discarding of
 * ungrounded quotes, recall and context budgets, soft/hard forget, markdown
 * export, idempotent consolidation with atomic mental-model ops, diary
 * "Retomada" in the next session's stable prefix and reopen persistence.
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { CONTEXT_BUDGETS, CACHE_BOUNDARY } from "../src/core/memory/assemble.ts";
import { checkSupersessionInvariants } from "../src/core/memory/supersede.ts";
import { estimateTokens } from "../src/core/memory/tokens.ts";
import {
	MemoryError,
	type ConsolidationInput,
	type ConsolidationOutput,
	type ExtractionInput,
	type ExtractionOutput,
	type Extractor,
	type FactCandidate,
	type JudgeInput,
	type JudgeOutput,
	type SupersedeVerdict,
} from "../src/core/memory/types.ts";
import { EXPORT_FILES, GENERATED_NOTICE } from "../src/store/memory/export-md.ts";
import { MEMORY_DB_FILE, MemoryDb, type MemoryDbOptions } from "../src/store/memory/memory-db.ts";
import { DomainMemoryService } from "../src/store/memory/service.ts";
import { openSqlDriver } from "../src/store/memory/sql-driver.ts";
import { HashEmbedder } from "../src/server/memory/hash-embedder.ts";

const T0 = new Date(2026, 10, 10, 14, 0, 0).getTime();
const DAY = 86_400_000;

function tmpDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "lh-memory-db-"));
}

class Clock {
	t = T0;
	readonly now = () => this.t;
	advance(ms: number): number {
		this.t += ms;
		return this.t;
	}
}

type FactPlan = (input: ExtractionInput) => FactCandidate[];

interface FakeScript {
	facts?: FactPlan;
	verdict?: SupersedeVerdict;
	consolidate?: (input: ConsolidationInput) => ConsolidationOutput;
	log?: (current: string) => string;
}

class FakeExtractor implements Extractor {
	extractCalls = 0;
	judgeCalls: JudgeInput[] = [];
	consolidateCalls: ConsolidationInput[] = [];
	judge?: (input: JudgeInput) => Promise<JudgeOutput>;
	consolidate?: (input: ConsolidationInput) => Promise<ConsolidationOutput>;
	observe?: Extractor["observe"];

	constructor(private readonly script: FakeScript) {
		if (script.verdict) {
			const verdict = script.verdict;
			this.judge = async (input) => {
				this.judgeCalls.push(input);
				return { verdicts: input.pairs.map((p) => ({ pairId: p.pairId, verdict })) };
			};
		}
		if (script.consolidate) {
			const fn = script.consolidate;
			this.consolidate = async (input) => {
				this.consolidateCalls.push(input);
				return fn(input);
			};
		}
		if (script.log) {
			const fn = script.log;
			this.observe = async (input) => ({ log: fn(input.currentLog) });
		}
	}

	async extract(input: ExtractionInput): Promise<ExtractionOutput> {
		this.extractCalls += 1;
		return { episodes: [], facts: this.script.facts?.(input) ?? [], evidence: [], flashcards: [] };
	}
}

function open(dir: string, clock: Clock, extra: Partial<MemoryDbOptions> = {}): MemoryDb {
	return MemoryDb.open(dir, { domainId: "electronics", embedder: new HashEmbedder(), clock: clock.now, ...extra });
}

function turn(db: MemoryDb, clock: Clock, sessionId: string, role: "user" | "assistant", text: string, nodeIds: string[] = []): string {
	const id = db.ingestTurn({ sessionId, role, text, ts: clock.advance(60_000), nodeIds });
	assert.ok(id);
	return id;
}

function ctx(domainId: string, query: string, now: number, extra: Record<string, unknown> = {}) {
	return { domainId, sessionId: "s-recall", query, focusNodes: [] as string[], now, ...extra };
}

// ─── isolation ──────────────────────────────────────────────────────────────

test("isolation: two domains are two files and recall never crosses them", async () => {
	const root = tmpDir();
	const clock = new Clock();
	const service = new DomainMemoryService({ dirFor: (id) => path.join(root, id), embedder: new HashEmbedder(), clock: clock.now });
	try {
		await service.open("electronics");
		service.ingestTurn({ sessionId: "s1", role: "user", text: "A tensão no resistor R2 deu 5 volts no divisor resistivo.", ts: clock.advance(1000), nodeIds: [] });
		await service.open("english");
		service.ingestTurn({ sessionId: "s2", role: "user", text: "I keep mixing up the present perfect and the simple past tense.", ts: clock.advance(1000), nodeIds: [] });
		await service.get("electronics")?.flush();
		await service.get("english")?.flush();

		assert.ok(fs.existsSync(path.join(root, "electronics", MEMORY_DB_FILE)));
		assert.ok(fs.existsSync(path.join(root, "english", MEMORY_DB_FILE)));

		const fromEnglish = await service.recall(ctx("english", "tensão no resistor divisor volts", clock.t));
		assert.ok(fromEnglish.items.every((i) => i.domainId === "english"));
		assert.ok(!fromEnglish.rendered.includes("resistor"), "english recall must not see electronics memory");
		const fromElectronics = await service.recall(ctx("electronics", "present perfect simple past tense", clock.t));
		assert.ok(fromElectronics.items.every((i) => i.domainId === "electronics"));
		assert.ok(!fromElectronics.rendered.includes("present perfect"));
		const own = await service.recall(ctx("electronics", "tensão no resistor", clock.t));
		assert.ok(own.items.some((i) => i.text.includes("resistor R2")));

		await assert.rejects(service.recall(ctx("history", "qualquer coisa", clock.t)), (e: unknown) => e instanceof MemoryError && e.code === "not-open");
		const english = service.get("english") as MemoryDb;
		await assert.rejects(english.recall(ctx("electronics", "tensão", clock.t)), (e: unknown) => e instanceof MemoryError && e.code === "domain-mismatch");
		assert.equal(service.activeDomainId, "english");

		await service.open("history");
		assert.equal(service.get("electronics"), undefined, "LRU of 2 evicts the least recent domain");
		assert.ok(service.get("english") && service.get("history"));
	} finally {
		await service.close();
		fs.rmSync(root, { recursive: true, force: true });
	}
});

// ─── FTS accent folding ─────────────────────────────────────────────────────

test("recall finds a fact by an accent-less paraphrase through FTS (\"tensao\" → \"tensão\")", async () => {
	const dir = tmpDir();
	const clock = new Clock();
	// A zero-dimension-signal embedder isolates the lexical channel: vectors are all identical.
	const flat = { id: "flat/8", dim: 8, embed: async (texts: readonly string[]) => texts.map(() => Float32Array.from([1, 0, 0, 0, 0, 0, 0, 0])) };
	const db = MemoryDb.open(dir, { domainId: "electronics", embedder: flat, clock: clock.now });
	try {
		turn(db, clock, "s1", "user", "Hoje medi a tensão elétrica no capacitor de 10 µF.");
		turn(db, clock, "s1", "assistant", "Ótimo, e qual foi a corrente no indutor?");
		for (let i = 0; i < 20; i++) turn(db, clock, "s1", "user", `Mensagem de enchimento número ${i} sobre resistores e LEDs.`);
		await db.flush();
		const r = await db.recall(ctx("electronics", "tensao eletrica capacitor", clock.t));
		const hit = r.items.find((i) => i.text.includes("tensão elétrica"));
		assert.ok(hit, "accent-less query must find the accented message");
		assert.ok(hit.channels.includes("fts"));
		assert.equal(r.items[0]?.text.includes("tensão elétrica") || r.items.indexOf(hit) < 3, true);
	} finally {
		await db.close();
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

// ─── supersession ───────────────────────────────────────────────────────────

/**
 * The first `n` whole words of a message. Grounding accepts only whole-word
 * quotes, so a fixture that cuts a message mid-word (`text.slice(0, 24)`)
 * produces an ungrounded fact that is (correctly) discarded.
 */
function leadingWords(text: string, n: number): string {
	return text.split(/\s+/).slice(0, n).join(" ").replace(/[^\p{L}\p{N}]+$/u, "");
}

const userFacts: FactPlan = (input) =>
	input.messages
		.filter((m) => m.role === "user")
		.map((m) => ({ kind: "learner", text: `O aluno disse: ${m.text}`, quote: leadingWords(m.text, 4), sourceMsgIds: [m.id] }));

test("bitemporal supersession: the judge's UPDATES closes the old fact with valid_to; nothing is overwritten", async () => {
	const dir = tmpDir();
	const clock = new Clock();
	const extractor = new FakeExtractor({ facts: userFacts, verdict: "UPDATES" });
	const db = open(dir, clock, { extractor, settings: { supersedeMinCosine: 0.1 } });
	try {
		turn(db, clock, "s1", "user", "Eu estudo sempre à noite, depois do trabalho.");
		await db.endSession("s1");
		const [old] = db.listFacts();
		assert.ok(old);
		assert.equal(old.validTo, null);

		clock.advance(DAY);
		turn(db, clock, "s2", "user", "Eu estudo agora de manhã, antes do trabalho.");
		await db.endSession("s2");

		assert.equal(extractor.judgeCalls.length, 1);
		const all = db.allFacts();
		const before = all.find((f) => f.id === old.id);
		const after = all.find((f) => f.id !== old.id);
		assert.ok(before && after);
		assert.ok(before.validTo !== null && before.validTo <= (after.validFrom ?? Infinity), "old fact gets valid_to = successor's start");
		assert.ok(before.expiredAt !== null);
		assert.equal(before.supersededBy, after.id);
		assert.equal(before.text, old.text, "text never overwritten");
		assert.deepEqual(checkSupersessionInvariants(all), []);
		assert.deepEqual(db.listFacts().map((f) => f.id), [after.id], "only the current fact is listed by default");
		assert.equal(db.listFacts({ includeSuperseded: true }).length, 2);

		const current = await db.recall(ctx("electronics", "quando o aluno estuda, de manhã ou à noite?", clock.t));
		assert.ok(!current.items.some((i) => i.id === old.id), "default recall excludes superseded facts");
		const historical = await db.recall(ctx("electronics", "quando o aluno estuda, de manhã ou à noite?", clock.t, { mode: "historical" }));
		const labelled = historical.items.find((i) => i.id === old.id);
		assert.ok(labelled?.superseded, "historical recall shows the old fact, labelled");
	} finally {
		await db.close();
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

// ─── grounding ──────────────────────────────────────────────────────────────

test("extraction with a quote that does not exist in the source is discarded", async () => {
	const dir = tmpDir();
	const clock = new Clock();
	const extractor = new FakeExtractor({
		facts: (input) => {
			const m = input.messages[0];
			if (!m) return [];
			return [
				{ kind: "goal", text: "O aluno quer passar em Circuitos I.", quote: "quero passar em Circuitos I", sourceMsgIds: [m.id] },
				{ kind: "learner", text: "O aluno é engenheiro.", quote: "sou engenheiro formado", sourceMsgIds: [m.id] },
			];
		},
	});
	const db = open(dir, clock, { extractor });
	try {
		turn(db, clock, "s1", "user", "Eu quero passar em Circuitos I até dezembro.");
		await db.endSession("s1");
		const facts = db.listFacts();
		assert.deepEqual(facts.map((f) => f.kind), ["goal"]);
		assert.equal(facts[0]?.grounded, true);
		assert.equal(facts[0]?.quote, "quero passar em Circuitos I");
		assert.equal(db.health().pendingExtractionTokens, 0, "the batch is marked extracted");
	} finally {
		await db.close();
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

// ─── budgets ────────────────────────────────────────────────────────────────

test("recall and full context respect their token budgets (recall ≤ budget, total ≤ 12k)", async () => {
	const dir = tmpDir();
	const clock = new Clock();
	const hugeLog = Array.from({ length: 3000 }, (_, i) => `- 🟡 14:${String(i % 60).padStart(2, "0")} observação ${i} sobre divisores de tensão e corrente`).join("\n");
	const extractor = new FakeExtractor({ log: () => hugeLog });
	const db = open(dir, clock, { extractor, profile: { text: () => "Engenheiro de software, estuda à noite. ".repeat(100) } });
	try {
		for (let i = 0; i < 300; i++) {
			turn(db, clock, "s1", i % 2 ? "assistant" : "user", `Falamos sobre divisor de tensão, corrente e resistores, exercício ${i}: ${"detalhe técnico ".repeat(10)}`);
		}
		await db.endSession("s1");
		const small = await db.recall(ctx("electronics", "divisor de tensão e corrente nos resistores", clock.t, { budgetTokens: 400 }));
		assert.ok(small.items.length > 0);
		assert.ok(small.tokens <= 400, `recall ${small.tokens} > 400`);
		assert.ok(estimateTokens(small.rendered) <= 400);
		const def = await db.recall(ctx("electronics", "divisor de tensão e corrente nos resistores", clock.t));
		assert.ok(def.tokens <= CONTEXT_BUDGETS.recall);

		const prefix = await db.stablePrefix("s1");
		assert.ok(prefix.tokens <= CONTEXT_BUDGETS.profile + CONTEXT_BUDGETS.mentalModels + CONTEXT_BUDGETS.learner + CONTEXT_BUDGETS.observationLog);
		assert.ok(prefix.text.includes("observação 2999"), "the log keeps its newest tail");
		const { context } = await db.buildContext({ ...ctx("electronics", "divisor de tensão", clock.t), sessionId: "s1" });
		assert.ok(context.tokens <= CONTEXT_BUDGETS.total, `context ${context.tokens}`);
		assert.ok(context.text.indexOf(CACHE_BOUNDARY) > context.text.indexOf("## Registro desta sessão"));
	} finally {
		await db.close();
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

// ─── forget ─────────────────────────────────────────────────────────────────

function countRows(file: string, sql: string, ...params: string[]): number {
	const reader = openSqlDriver(file);
	try {
		return Number(reader.prepare(sql).get(...params)?.n ?? 0);
	} finally {
		reader.close();
	}
}

test("forget soft hides from recall but keeps the row for rollback; hard deletes rows, FTS, vectors and derived facts", async () => {
	const dir = tmpDir();
	const clock = new Clock();
	const extractor = new FakeExtractor({ facts: userFacts });
	const db = open(dir, clock, { extractor });
	const file = path.join(dir, MEMORY_DB_FILE);
	try {
		const secret = turn(db, clock, "s1", "user", "Minha senha do laboratório é zebra-azul-77, não esquece.");
		turn(db, clock, "s1", "user", "O osciloscópio do laboratório tem dois canais.");
		await db.endSession("s1");
		const q = ctx("electronics", "senha do laboratório zebra", clock.t);
		assert.ok((await db.recall(q)).items.some((i) => i.text.includes("zebra")));

		const soft = await db.forget({ messageIds: [secret] }, "soft");
		assert.ok(soft.affected >= 2, "the message and the fact derived only from it");
		assert.ok(!(await db.recall(q)).items.some((i) => i.text.includes("zebra")));
		assert.equal(countRows(file, "SELECT COUNT(*) AS n FROM messages WHERE id = ? AND status = 'forgotten'", secret), 1, "soft keeps the row");
		assert.equal(countRows(file, "SELECT COUNT(*) AS n FROM fts WHERE fts MATCH 'zebra'"), 0);
		assert.ok(countRows(file, "SELECT COUNT(*) AS n FROM audit WHERE op = 'forget-soft' AND target_id = ?", secret) === 1);
		assert.ok(db.listFacts().every((f) => !f.text.includes("zebra")));

		const hard = await db.forget({ sessionId: "s1" }, "hard");
		assert.ok(hard.affected >= 2);
		assert.equal(countRows(file, "SELECT COUNT(*) AS n FROM messages"), 0);
		assert.equal(countRows(file, "SELECT COUNT(*) AS n FROM facts"), 0);
		assert.equal(countRows(file, "SELECT COUNT(*) AS n FROM embeddings"), 0);
		assert.equal(countRows(file, "SELECT COUNT(*) AS n FROM fts"), 0);
		assert.equal(countRows(file, "SELECT COUNT(*) AS n FROM sessions"), 0);
		assert.equal(countRows(file, "SELECT COUNT(*) AS n FROM audit WHERE before_json LIKE '%zebra%' OR after_json LIKE '%zebra%'"), 0, "audit scrubbed");
		assert.equal(db.health().vectors, 0);
		assert.equal((await db.recall(q)).items.length, 0);
		await assert.rejects(db.forget({ messageIds: [] }, "nuke" as "soft"), (e: unknown) => e instanceof MemoryError && e.code === "invalid-input");
	} finally {
		await db.close();
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

// ─── consolidation, diary, export, reopen ───────────────────────────────────

test("consolidation is idempotent, mental-model batches are atomic, diary resumes the next session, export mirrors to markdown", async () => {
	const dir = tmpDir();
	const vault = tmpDir();
	const clock = new Clock();
	let invalidOps = false;
	const extractor = new FakeExtractor({
		facts: (input) =>
			input.messages
				.filter((m) => m.role === "user")
				.map((m) => ({ kind: "misconception", text: `O aluno confunde tensão com corrente: "${m.text}"`, quote: leadingWords(m.text, 5), sourceMsgIds: [m.id], nodeIds: ["divisor"] })),
		consolidate: (input) => {
			const ids = input.facts.map((f) => f.id);
			if (invalidOps) return { observations: [], mentalModelOps: [{ op: "edit", targetId: "m_00000000000000000000000000", newText: "x", newRefs: [`fact:${ids[0]}`] }] };
			return {
				observations: [{ op: "create", subjectType: "node", subjectId: "divisor", text: "Dificuldade recorrente em separar tensão de corrente no divisor.", evidenceFactIds: ids }],
				mentalModelOps: [{ op: "add", section: "Pontos fracos", text: "Confunde tensão com corrente em divisores resistivos.", refs: ids.map((id) => `fact:${id}`) }],
			};
		},
	});
	const db = open(dir, clock, { extractor });
	try {
		turn(db, clock, "s1", "user", "Achei que a corrente se dividia igual à tensão no divisor.", ["divisor"]);
		turn(db, clock, "s1", "assistant", "Não: no divisor em série a corrente é a mesma; a tensão se divide.", ["divisor"]);
		await db.endSession("s1");
		assert.equal(extractor.consolidateCalls.length, 1);
		assert.equal(db.mentalModel().length, 1);
		assert.equal(db.observations().length, 1);
		assert.equal(db.observations()[0]?.proofCount, 1);

		await db.consolidate();
		assert.equal(extractor.consolidateCalls.length, 1, "no new facts → the consolidator is not called again");
		assert.equal(db.mentalModel().length, 1);

		clock.advance(DAY);
		invalidOps = true;
		turn(db, clock, "s2", "user", "Pensei outra vez que no divisor resistivo a corrente muda em cada resistor.", ["divisor"]);
		await assert.rejects(db.endSession("s2"), (e: unknown) => e instanceof MemoryError && e.code === "ops-invalid");
		assert.equal(db.mentalModel().length, 1, "an invalid batch applies nothing");
		assert.equal(db.listFacts().filter((f) => !f.consolidated).length, 1, "facts stay pending for the next consolidation");
		assert.ok(db.diary().some((d) => d.sessionId === "s2"), "a failed consolidation does not cost the session its diary");
		invalidOps = false;
		await db.consolidate();
		assert.equal(db.listFacts().filter((f) => !f.consolidated).length, 0);

		const diary = db.diary();
		assert.ok(diary.length >= 1 && diary.some((d) => d.sessionId === "s1"));
		const prefix = await db.stablePrefix("s3");
		assert.ok(prefix.text.includes("Retomada"), "a new session opens with the last diary entry");
		assert.ok(prefix.text.includes("Confunde tensão com corrente"));

		await db.exportMarkdown(vault);
		for (const name of Object.values(EXPORT_FILES)) {
			const text = fs.readFileSync(path.join(vault, name), "utf8");
			assert.ok(text.startsWith(GENERATED_NOTICE));
		}
		assert.match(fs.readFileSync(path.join(vault, EXPORT_FILES.mentalModel), "utf8"), /Confunde tensão com corrente[\s\S]*<!--m_[0-9A-Z]{26}-->/);
		assert.match(fs.readFileSync(path.join(vault, EXPORT_FILES.observations), "utf8"), /Dificuldade recorrente/);

		const vectors = db.health().vectors;
		await db.close();
		const reopened = open(dir, clock, { extractor });
		try {
			assert.equal(reopened.health().vectors, vectors, "vectors are rebuilt from the file at open");
			assert.equal(reopened.mentalModel().length, 1);
			const again = await reopened.recall(ctx("electronics", "corrente se divide no divisor", clock.t));
			assert.ok(again.items.length > 0);
		} finally {
			await reopened.close();
		}
	} finally {
		await db.close();
		fs.rmSync(dir, { recursive: true, force: true });
		fs.rmSync(vault, { recursive: true, force: true });
	}
});

test("a different embedding model re-embeds everything at open; a foreign domain file is refused", async () => {
	const dir = tmpDir();
	const clock = new Clock();
	const db = open(dir, clock);
	turn(db, clock, "s1", "user", "Capacitores armazenam energia no campo elétrico.");
	await db.close();
	const other = MemoryDb.open(dir, { domainId: "electronics", embedder: new HashEmbedder(128), clock: clock.now });
	try {
		await other.flush();
		assert.equal(other.health().vectors, 1);
		assert.equal(countRows(path.join(dir, MEMORY_DB_FILE), "SELECT COUNT(*) AS n FROM embeddings WHERE dim = 128"), 1);
	} finally {
		await other.close();
	}
	assert.throws(() => MemoryDb.open(dir, { domainId: "english", embedder: new HashEmbedder(), clock: clock.now }));
	fs.rmSync(dir, { recursive: true, force: true });
});
