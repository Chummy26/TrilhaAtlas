/** Paired retrieval ablation. All messages, sessions and answers are synthetic. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { seededRandom } from "../src/core/question-core.ts";
import { estimateTokens } from "../src/core/memory/tokens.ts";
import { HashEmbedder } from "../src/server/memory/hash-embedder.ts";
import { MemoryDb } from "../src/store/memory/memory-db.ts";

const topics = ["pressão no sensor", "queda de tensão", "corrente de fuga", "período da onda",
	"ganho do filtro", "carga inicial", "tempo de resposta", "frequência de corte",
	"potência média", "resistência do cabo", "tensão de referência", "erro de fase"];
const epoch = Date.UTC(2025, 0, 1);
const day = 86_400_000;
const rounds = [48, 384];
const seeds = ["jade", "ocre", "anil", "cobalto"];
const budgets = [240, 600, 1000];
type Arm = "domain" | "lesson";
type Trial = { arm: Arm; sessions: number; holdout: boolean; position: number; budget: number; hit: boolean; leak: boolean; tokens: number; ms: number };
const trials: Trial[] = [];
let abstentions = 0;

function percentile(xs: number[], p: number) {
	return +xs.sort((a, b) => a - b)[Math.ceil(xs.length * p) - 1]!.toFixed(2);
}

for (const sessions of rounds) for (const seed of seeds) {
	const dir = mkdtempSync(path.join(tmpdir(), "lh-memory-stress-"));
	const db = MemoryDb.open(dir, { domainId: "bench", embedder: new HashEmbedder(), settings: { autoExtract: false } });
	try {
		const random = seededRandom(seed);
		const gold = topics.map((topic, i) => {
			const position = (i + seeds.indexOf(seed)) % 3;
			return { session: Math.floor(sessions * [0.06, 0.5, 0.94][position]!) + Math.floor(random() * 2),
				slot: i, position, branch: "aula-" + i, answer: "amostra-" + Math.floor(random() * 1e9), topic };
		});
		for (let s = 0; s < sessions; s++) {
			for (let j = 0; j < 16; j++) {
				const target = gold.find(g => g.session === s && g.slot === j);
				const topic = target?.topic ?? topics[Math.floor(random() * topics.length)]!;
				const branch = target?.branch ?? (random() < .2 ? "aula-" + Math.floor(random() * topics.length) : "outra-região");
				const answer = target?.answer ?? "controle-" + Math.floor(random() * 1e9);
				// A foil can use the same words even inside the target unit. Only the target
				// describes a calibrated sample. Outside the unit, hard negatives do too.
				const calibrated = target || branch === "outra-região";
				const text = calibrated ? `Na calibração de ${topic} registrei ${answer} no caderno.`
					: `A estimativa preliminar de ${topic} foi ${answer} antes da medição.`;
				db.ingestTurn({ sessionId: `s${s}-${branch}`, role: "user", nodeIds: [branch], text, ts: epoch + s * day + j * 60000 });
			}
		}
		await db.flush();
		assert.equal(db.health().vectors, sessions * 16);
		const now = epoch + sessions * day;
		for (const g of gold) for (const budget of budgets) {
			const holdout = seed === "cobalto";
			const query = holdout ? `Ao aferir ${g.topic}, que identificação anotei no caderno?` : `Qual amostra registrei ao calibrar a ${g.topic}?`;
			const base = { domainId: "bench", focusNodes: [g.branch], sessionId: "retomada", query, now, budgetTokens: budget };
			const arms: Arm[] = random() < .5 ? ["domain", "lesson"] : ["lesson", "domain"];
			for (const arm of arms) {
				const start = performance.now();
				const { context, recall } = await db.buildContext({ ...base, lessonNodes: arm === "lesson" ? new Set([g.branch]) : undefined }, budget + 100);
				const ms = performance.now() - start;
				const tokens = estimateTokens(context.text);
				assert.ok(tokens <= budget + 100);
				trials.push({ arm, sessions, budget, holdout, position: g.position, hit: context.text.includes(g.answer),
					leak: recall.items.some(item => !item.nodeIds.includes(g.branch)), tokens, ms });
			}
		}
		const novel = await db.buildContext({ domainId: "bench", sessionId: "nova", focusNodes: ["nova"], lessonNodes: new Set(["nova"]),
			query: "Qual foi a calibração da corrente de fuga?", now });
		assert.equal(novel.context.dynamic, "");
		abstentions++;
	} finally {
		await db.close();
		rmSync(dir, { recursive: true, force: true });
	}
}

// Report per-load, per-budget and position results. Resampling these correlated
// queries as independent learners would give spurious confidence intervals.
for (const sessions of rounds) for (const arm of ["domain", "lesson"] as const) for (const holdout of [false, true]) {
	const rows = trials.filter(r => r.arm === arm && r.sessions === sessions && r.holdout === holdout);
	const hits = (rs: Trial[]) => `${rs.filter(r => r.hit).length}/${rs.length}`;
	console.log(JSON.stringify({ simulatedDays: sessions, messages: sessions * 16, holdout, arm, hits: hits(rows),
		byBudget: budgets.map(b => hits(rows.filter(r => r.budget === b))), byPosition: [0, 1, 2].map(i => hits(rows.filter(r => r.position === i))),
		queriesWithForeignEvidence: rows.filter(r => r.leak).length, medianTokens: percentile(rows.map(r => r.tokens), .5),
		p50ms: percentile(rows.map(r => r.ms), .5), p95ms: percentile(rows.map(r => r.ms), .95) }));
	if (arm === "lesson") for (const position of [0, 1, 2]) {
		const stratum = rows.filter(r => r.position === position);
		assert.ok(stratum.filter(r => r.hit).length >= .8 * stratum.length, "retrieval regression at position " + position);
	}
}
assert.ok(trials.every(t => t.arm !== "lesson" || !t.leak));
assert.ok(trials.some(t => t.arm === "domain" && t.leak), "positive control must expose the collision");
console.log(JSON.stringify({ emptyBranchAbstentions: abstentions }));
