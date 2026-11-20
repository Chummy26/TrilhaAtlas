/**
 * Memory core tests (pure functions of src/core/memory; r4 §7.6, §7.11
 * invariants; SÍNTESE §2.4(b)(d)).
 *
 * Covers: RRF/RSF and MMR determinism (fast-check properties: same input in
 * any list order → same output), bitemporal supersession (close never
 * overwrites, invariants), mental-model op batches (atomic, ≤ 240 chars,
 * refs required), extraction grounding (a quote absent from its source is
 * discarded; learner-voice kinds must quote the learner; dialogue evidence
 * capped at 0.6), context assembly budgets (stable → boundary → recall,
 * ≤ 12k) and pt/en time expressions.
 */
import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";

import {
	CACHE_BOUNDARY,
	CONTEXT_BUDGETS,
	assembleContext,
	packRecall,
	type RenderableItem,
} from "../src/core/memory/assemble.ts";
import { lifePrior, relativeCut } from "../src/core/memory/decay.ts";
import { MAX_DIALOGUE_CONFIDENCE, quoteOccursIn, validateExtraction } from "../src/core/memory/extract.ts";
import { spreadActivation } from "../src/core/memory/graph.ts";
import { MENTAL_MODEL_ID_PATTERN, newId } from "../src/core/memory/ids.ts";
import { buildFtsQuery, foldText } from "../src/core/memory/lexical.ts";
import { mmrRerank, type MmrCandidate } from "../src/core/memory/mmr.ts";
import { applyMentalModelOps, MAX_ENTRY_CHARS } from "../src/core/memory/ops.ts";
import { RRF_K, reciprocalRankFusion, relativeScoreFusion, type RankedList } from "../src/core/memory/rrf.ts";
import { parseConsolidationOutput, parseExtractionOutput, parseJudgeOutput } from "../src/core/memory/schemas.ts";
import { resolveMemorySettings } from "../src/core/memory/settings.ts";
import {
	checkSupersessionInvariants,
	isCurrentFact,
	mergeDuplicateFacts,
	resolveSupersession,
	type BitemporalFact,
} from "../src/core/memory/supersede.ts";
import { addDays, parseTimeRange, startOfDay } from "../src/core/memory/temporal.ts";
import { estimateTokens } from "../src/core/memory/tokens.ts";
import type { MentalModelEntry, SourceMessage } from "../src/core/memory/types.ts";
import { l2Normalize } from "../src/core/memory/vector.ts";

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 18, 15, 0, 0).getTime(); // Wed 2026-11-18 15:00 local

// ─── RRF / RSF ──────────────────────────────────────────────────────────────

const idArb = fc.constantFrom("a", "b", "c", "d", "e", "f", "g", "h");
const channelArb = fc.constantFrom("vec", "fts", "graph", "time", "learner");
const listsArb = fc
	.uniqueArray(fc.record({ channel: channelArb, ids: fc.uniqueArray(idArb, { maxLength: 8 }), weight: fc.double({ min: 0.1, max: 2, noNaN: true }) }), {
		selector: (l) => l.channel,
		maxLength: 5,
	})
	.map((lists) => lists.map((l) => ({ ...l, scores: l.ids.map((_, i) => 1 / (i + 1)) })));

test("RRF: k = 60 formula, weights, channel provenance", () => {
	const fused = reciprocalRankFusion([
		{ channel: "fts", ids: ["x", "y"] },
		{ channel: "vec", ids: ["y"], weight: 2 },
	]);
	assert.equal(RRF_K, 60);
	const y = fused.find((f) => f.id === "y");
	const x = fused.find((f) => f.id === "x");
	assert.ok(x && y);
	assert.ok(Math.abs(y.score - (2 / 61 + 1 / 62)) < 1e-12);
	assert.ok(Math.abs(x.score - 1 / 61) < 1e-12);
	assert.deepEqual(y.channels, ["vec", "fts"]);
	assert.equal(fused[0]?.id, "y");
});

test("RRF and RSF are deterministic: list order never changes the result (property)", () => {
	fc.assert(
		fc.property(listsArb, fc.integer({ min: 0, max: 1000 }), (lists, seed) => {
			const shuffled = [...lists].sort((a, b) => ((a.channel.charCodeAt(0) * 31 + seed) % 7) - ((b.channel.charCodeAt(0) * 31 + seed) % 7));
			assert.deepEqual(reciprocalRankFusion(shuffled as RankedList[]), reciprocalRankFusion(lists as RankedList[]));
			assert.deepEqual(relativeScoreFusion(shuffled as RankedList[]), relativeScoreFusion(lists as RankedList[]));
			const fused = reciprocalRankFusion(lists as RankedList[]);
			for (let i = 1; i < fused.length; i++) assert.ok((fused[i - 1]?.score ?? 0) >= (fused[i]?.score ?? 0));
		}),
		{ numRuns: 200 },
	);
});

// ─── MMR ────────────────────────────────────────────────────────────────────

const vecArb = fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: 4, maxLength: 4 }).map((xs) => l2Normalize(Float32Array.from(xs)));
const candidatesArb = fc.uniqueArray(fc.record({ id: idArb, score: fc.double({ min: 0, max: 1, noNaN: true }), vector: vecArb }), {
	selector: (c) => c.id,
	maxLength: 8,
});

test("MMR λ = 0.7 is deterministic and a permutation of its input (property)", () => {
	fc.assert(
		fc.property(candidatesArb, (cands: MmrCandidate[]) => {
			const a = mmrRerank(cands).map((c) => c.id);
			const b = mmrRerank([...cands].reverse()).map((c) => c.id);
			assert.deepEqual(a, b);
			assert.deepEqual([...a].sort(), cands.map((c) => c.id).sort());
		}),
		{ numRuns: 200 },
	);
});

test("MMR demotes a near-duplicate below a diverse item", () => {
	const v = (xs: number[]) => l2Normalize(Float32Array.from(xs));
	const out = mmrRerank([
		{ id: "a", score: 1, vector: v([1, 0, 0]) },
		{ id: "a2", score: 0.95, vector: v([1, 0.01, 0]) },
		{ id: "b", score: 0.8, vector: v([0, 1, 0]) },
	]);
	assert.deepEqual(out.map((c) => c.id), ["a", "b", "a2"]);
});

// ─── decay / cut / graph ────────────────────────────────────────────────────

test("life prior: superseded ×0.3, same session ×1.15, episodic half-life 30 days", () => {
	const base = { kind: "fact" as const, factKind: "experience" as const, importance: 0.5, at: NOW, now: NOW, sameSession: false, superseded: false };
	const p = lifePrior(base);
	assert.ok(Math.abs(lifePrior({ ...base, superseded: true }) / p - 0.3) < 1e-9);
	assert.ok(Math.abs(lifePrior({ ...base, sameSession: true }) / p - 1.15) < 1e-9);
	assert.ok(Math.abs(lifePrior({ ...base, at: NOW - 30 * DAY }) / p - 0.5) < 1e-6);
	const cut = relativeCut([{ score: 1 }, { score: 0.5 }, { score: 0.39 }], 0.4, 40);
	assert.equal(cut.length, 2);
});

test("spreading activation decays by δ = 0.5 per hop and stops after 2 hops", () => {
	const graph: Record<string, { to: string; rel: "about"; weight: number }[]> = {
		a: [{ to: "b", rel: "about", weight: 1 }],
		b: [{ to: "c", rel: "about", weight: 1 }],
		c: [{ to: "d", rel: "about", weight: 1 }],
	};
	const act = spreadActivation(new Map([["a", 1]]), (k) => graph[k] ?? []);
	assert.ok((act.get("b") ?? 0) > (act.get("c") ?? 0));
	assert.equal(act.has("d"), false);
});

// ─── supersession ───────────────────────────────────────────────────────────

function fact(over: Partial<BitemporalFact> & { id: string }): BitemporalFact {
	return {
		kind: "learner",
		validFrom: NOW - 10 * DAY,
		validTo: null,
		recordedAt: NOW - 10 * DAY,
		expiredAt: null,
		supersededBy: null,
		proofCount: 1,
		sourceMsgIds: ["msg_1"],
		status: "active",
		...over,
	};
}

test("supersession closes the old fact (valid_to, expired_at, superseded_by) and never edits its text", () => {
	const old = fact({ id: "f_old" });
	const effect = resolveSupersession(old, { id: "f_new", validFrom: NOW - DAY, proofCount: 1, sourceMsgIds: ["msg_2"] }, "UPDATES", NOW);
	assert.equal(effect.type, "close");
	if (effect.type !== "close") return;
	assert.equal(effect.validTo, NOW - DAY);
	assert.equal(effect.expiredAt, NOW);
	assert.equal(effect.supersededBy, "f_new");
	const closed = { ...old, validTo: effect.validTo, expiredAt: effect.expiredAt, supersededBy: "f_new" };
	assert.equal(isCurrentFact(closed, NOW), false);
	assert.deepEqual(checkSupersessionInvariants([closed, fact({ id: "f_new", validFrom: NOW - DAY, recordedAt: NOW })]), []);
});

test("supersession verdicts: DUPLICATE merges proof, REFINES links, INDEPENDENT is a no-op, closed facts are never re-closed", () => {
	const old = fact({ id: "f_old", proofCount: 2 });
	const dup = resolveSupersession(old, { id: "f_new", validFrom: null, proofCount: 1, sourceMsgIds: ["msg_9"] }, "DUPLICATE", NOW);
	assert.deepEqual(dup, { type: "duplicate", keepId: "f_old", proofCount: 3, sourceMsgIds: ["msg_1", "msg_9"] });
	assert.deepEqual(resolveSupersession(old, { id: "f_new", validFrom: null, proofCount: 1, sourceMsgIds: [] }, "REFINES", NOW), { type: "refine", srcId: "f_new", dstId: "f_old" });
	assert.deepEqual(resolveSupersession(old, { id: "f_new", validFrom: null, proofCount: 1, sourceMsgIds: [] }, "INDEPENDENT", NOW), { type: "independent" });
	const closed = fact({ id: "f_c", validTo: NOW - DAY, expiredAt: NOW - DAY, supersededBy: "f_x" });
	assert.deepEqual(resolveSupersession(closed, { id: "f_new", validFrom: null, proofCount: 1, sourceMsgIds: [] }, "UPDATES", NOW), { type: "independent" });
	const merged = mergeDuplicateFacts(old, fact({ id: "f_l", recordedAt: NOW }), NOW);
	assert.equal(merged.loser.supersededBy, "f_old");
	assert.equal(merged.winner.proofCount, 3);
});

test("invariant checker reports cycles and supersession without expired_at", () => {
	const issues = checkSupersessionInvariants([fact({ id: "a", supersededBy: "b", expiredAt: NOW }), fact({ id: "b", supersededBy: "a" })]);
	assert.ok(issues.some((i) => i.includes("ciclo")));
	assert.ok(issues.some((i) => i.includes("expired_at")));
});

// ─── mental-model ops ───────────────────────────────────────────────────────

test("mental-model ops: atomic batch, ≤ 240 chars, refs required, m_ULID ids", () => {
	const ok = applyMentalModelOps([], [{ op: "add", section: "Pontos fracos", text: "Confunde corrente com tensão.", refs: ["fact:fact_1"] }], { now: NOW });
	assert.equal(ok.ok, true);
	if (!ok.ok) return;
	const entry = ok.entries[0] as MentalModelEntry;
	assert.match(entry.id, MENTAL_MODEL_ID_PATTERN);

	const bad = applyMentalModelOps(ok.entries, [
		{ op: "edit", targetId: entry.id, newText: "Ainda confunde corrente com tensão em divisores.", newRefs: ["fact:fact_2"] },
		{ op: "add", section: "Estado atual", text: "x".repeat(MAX_ENTRY_CHARS + 1), refs: ["fact:fact_3"] },
	], { now: NOW });
	assert.equal(bad.ok, false, "one invalid op rejects the whole batch");

	const noRefs = applyMentalModelOps([], [{ op: "add", section: "Estado atual", text: "Sabe a lei de Ohm.", refs: [] }], { now: NOW });
	assert.equal(noRefs.ok, false);
	const unknown = applyMentalModelOps(ok.entries, [{ op: "delete", targetId: "m_00000000000000000000000000", reason: "stale" }], { now: NOW });
	assert.equal(unknown.ok, false);
	const dup = applyMentalModelOps(ok.entries, [{ op: "add", section: "Pontos fracos", text: "confunde corrente com TENSAO.", refs: ["fact:fact_9"] }], { now: NOW });
	assert.ok(dup.ok && dup.skipped.length === 1 && dup.entries.length === 1);
});

// ─── extraction grounding ───────────────────────────────────────────────────

const msgs: SourceMessage[] = [
	{ id: "msg_1", seq: 1, role: "user", ts: NOW - 60_000, text: "Eu sempre confundo tensão com corrente no divisor resistivo.", nodeIds: ["divisor"] },
	{ id: "msg_2", seq: 2, role: "assistant", ts: NOW - 30_000, text: "A tensão se divide proporcionalmente às resistências; você prefere ver um desenho?", nodeIds: ["divisor"] },
];

test("a tiny assembly budget also bounds the internal cache separator", () => {
	for (const total of [0, 1, 4]) {
		const context = assembleContext({ profile: "Aluno iniciante", recall: "Exemplo anterior" }, { ...CONTEXT_BUDGETS, total });
		assert.ok(estimateTokens(context.text) <= total);
	}
});

test("extraction: a quote absent from the source is discarded; a verbatim quote (accent/case-insensitive) is kept", () => {
	const out = validateExtraction(
		{
			episodes: [],
			facts: [
				{ kind: "misconception", text: "O aluno confunde tensão com corrente no divisor.", quote: "confundo tensao com corrente", sourceMsgIds: ["msg_1"] },
				{ kind: "learner", text: "O aluno é engenheiro.", quote: "sou engenheiro eletricista", sourceMsgIds: ["msg_1"] },
				{ kind: "preference", text: "O aluno prefere desenhos.", quote: "você prefere ver um desenho", sourceMsgIds: ["msg_2"] },
			],
			evidence: [{ nodes: [{ nodeId: "divisor", q: 1 }], grade: 0, graderConfidence: 0.95, quote: "sempre confundo tensão", sourceMsgIds: ["msg_1"] }],
			flashcards: [],
		},
		{ domainId: "electronics", sessionId: "s1", messages: msgs },
	);
	assert.deepEqual(out.facts.map((f) => f.kind), ["misconception"]);
	assert.deepEqual(out.facts[0]?.nodeIds, ["divisor"], "a missing model tag inherits the grounded lesson");
	assert.equal(out.rejected.filter((r) => r.kind === "fact").length, 2, "invented quote and learner-voice fact quoting the tutor are both rejected");
	assert.equal(out.evidence.length, 1);
	assert.ok((out.evidence[0]?.graderConfidence ?? 1) <= MAX_DIALOGUE_CONFIDENCE);
	assert.equal(quoteOccursIn("sempre ... no divisor", msgs[0]?.text ?? ""), true);
	assert.equal(quoteOccursIn("nunca confundo", msgs[0]?.text ?? ""), false);
});

test("schemas: element-wise tolerance, aliases, atomic op rejection", () => {
	const ex = parseExtractionOutput({ facts: [{ kind: "goal", text: "t", quote: "qqqq", source_msg_ids: ["m"] }, { kind: 3 }], flashcard_candidates: [{ front: "f", back: "b" }] });
	assert.equal(ex.output.facts.length, 1);
	assert.equal(ex.dropped, 1);
	assert.equal(ex.output.flashcards.length, 1);
	assert.deepEqual(parseJudgeOutput({ verdicts: [{ pair_id: "p", verdict: "updates" }] }).output.verdicts, [{ pairId: "p", verdict: "UPDATES" }]);
	const cons = parseConsolidationOutput({ observations: [], mentalModelOps: [{ op: "add", section: "Estado atual" }] });
	assert.equal(cons.opsRejected, true);
	assert.deepEqual(cons.output.mentalModelOps, []);
});

// ─── context assembly ───────────────────────────────────────────────────────

test("assembleContext: stable → cache boundary → recall, per-section and total budgets respected", () => {
	const lines = (n: number, w: string) => Array.from({ length: n }, (_, i) => `- ${w} ${i} ${"palavra ".repeat(12)}`).join("\n");
	const ctx = assembleContext({
		profile: lines(80, "perfil"),
		mentalModels: lines(400, "modelo"),
		learner: lines(80, "aprendiz"),
		observationLog: lines(3000, "registro"),
		recall: lines(900, "lembranca"),
	});
	assert.ok(ctx.tokens <= CONTEXT_BUDGETS.total, `total ${ctx.tokens}`);
	const byId = new Map(ctx.sections.map((s) => [s.id, s]));
	assert.ok((byId.get("profile")?.tokens ?? 0) <= CONTEXT_BUDGETS.profile);
	assert.ok((byId.get("mentalModels")?.tokens ?? 0) <= CONTEXT_BUDGETS.mentalModels);
	assert.ok((byId.get("learner")?.tokens ?? 0) <= CONTEXT_BUDGETS.learner);
	assert.ok((byId.get("observationLog")?.tokens ?? 0) <= CONTEXT_BUDGETS.observationLog);
	assert.ok((byId.get("recall")?.tokens ?? 0) <= CONTEXT_BUDGETS.recall);
	const boundary = ctx.text.indexOf(CACHE_BOUNDARY);
	assert.ok(boundary > 0 && ctx.text.indexOf("## Perfil") < boundary && ctx.text.indexOf("lembranca") > boundary);
	assert.ok(ctx.text.indexOf("## Perfil") < ctx.text.indexOf("## Modelo") && ctx.text.indexOf("## Modelo") < ctx.text.indexOf("## Registro"));
	assert.ok(ctx.text.includes("registro 2999"), "the observation log keeps its most recent tail");
});

test("packRecall: within budget, rendered chronologically grouped by day", () => {
	const items: RenderableItem[] = Array.from({ length: 30 }, (_, i) => ({
		kind: "fact",
		id: `f${i}`,
		text: `Fato número ${i} ${"conteúdo ".repeat(20)}`,
		at: NOW - (30 - i) * DAY,
		factKind: "experience",
	}));
	const ranked = [...items].reverse();
	const packed = packRecall(ranked, 300, NOW);
	assert.ok(packed.tokens <= 300);
	assert.ok(packed.items.length > 0 && packed.items.length < items.length);
	const ats = packed.items.map((i) => i.at);
	assert.deepEqual(ats, [...ats].sort((a, b) => a - b));
	assert.equal(estimateTokens(packed.rendered), packed.tokens);
});

// ─── time, lexical, ids, settings ───────────────────────────────────────────

test("time expressions in pt and en", () => {
	const today = startOfDay(NOW);
	const ontem = parseTimeRange("o que eu errei ontem?", NOW);
	assert.ok(ontem && ontem.from === addDays(today, -1) && ontem.to === today);
	assert.deepEqual(parseTimeRange("what did I miss yesterday", NOW)?.from, ontem?.from);
	const week = parseTimeRange("na semana passada falamos de capacitores", NOW);
	assert.ok(week && week.granularity === "week");
	assert.equal(new Date(week.from).getDay(), 1, "previous week starts on Monday");
	assert.ok(week.to <= today && week.to - week.from === 7 * DAY);
	const last3 = parseTimeRange("nos últimos 3 dias", NOW);
	assert.ok(last3 && last3.granularity === "window" && last3.from === addDays(NOW, -3) && last3.to > NOW, "rolling window ending now");
	assert.equal(parseTimeRange("explique a lei de Ohm", NOW), null);
	assert.equal(parseTimeRange("resolva 3/20 + 1", NOW), null);
});

test("lexical folding and FTS query building", () => {
	assert.equal(foldText("Tensão ÉLÉTRICA"), "tensao eletrica");
	const q = buildFtsQuery("o que é tensão?");
	assert.ok(q && q.includes("tensao"));
	assert.equal(buildFtsQuery("o que é de"), null);
	assert.match(newId("fact", NOW), /^fact_[0-9A-HJKMNP-TV-Z]{26}$/);
	assert.throws(() => resolveMemorySettings({ mmrLambda: 2 }));
	assert.equal(resolveMemorySettings().rrfK, 60);
});
