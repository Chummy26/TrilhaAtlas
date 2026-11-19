/**
 * Resources — scoring, gates, language fit per domain, MMR and spine set
 * cover (SÍNTESE §2.8 "Ranking", "Idioma por domínio", "Livro-guia"; r6 §7,
 * §12.3). Pure core functions; fast-check for the invariants.
 */
import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";

import { electronicsManifest, englishManifest } from "../src/core/domains/defaults.ts";
import {
	CURATED_PRIOR,
	DEFAULT_WEIGHTS,
	REL_GATE,
	betaPosterior,
	captionQuality,
	channelAwareSimilarity,
	channelTrust,
	durationFit,
	greedySetCover,
	kendallTau,
	kendallTauByRank,
	languageFit,
	levelFit,
	mmr,
	planRegionReading,
	relevance,
	scoreParts,
	scoreResource,
	seededRng,
	targetSeconds,
	thompsonSample,
	type BookCandidate,
	type CoverSet,
	type RegionNode,
	type Resource,
	type ScoreParts,
} from "../src/core/resources/index.ts";

const ELECTRONICS = electronicsManifest("2026-11-18T00:00:00.000Z").resourcePolicy;
const ENGLISH = englishManifest("2026-11-18T00:00:00.000Z").resourcePolicy;

function video(extra: Partial<Resource>): Resource {
	return {
		id: "yt:abcdefghijk",
		provider: "youtube-data",
		kind: "video",
		title: "Lei de Ohm",
		lang: "en",
		license: { name: "YouTube" },
		access: "stream_only",
		tos: "official_api",
		locator: { kind: "youtube", videoId: "abcdefghijk" },
		fetchedAt: "2026-11-18T00:00:00.000Z",
		...extra,
	};
}

const part = fc.double({ min: 0, max: 1, noNaN: true });
const partsArb = fc.record({ rel: part, qual: part, lang: part, lvl: part, dur: part, pref: part });

// ─── score ───────────────────────────────────────────────────────────────────

test("score: weighted sum with the SÍNTESE weights (0,35/0,25/0,15/0,10/0,07/0,08)", () => {
	const parts: ScoreParts = { rel: 1, qual: 0, lang: 0.5, lvl: 1, dur: 0, pref: 1 };
	const r = scoreResource(parts);
	assert.ok(Math.abs(r.score - (0.35 + 0.15 * 0.5 + 0.1 + 0.08)) < 1e-12);
	assert.equal(r.passed, true);
	assert.deepEqual(DEFAULT_WEIGHTS, { rel: 0.35, qual: 0.25, lang: 0.15, lvl: 0.1, dur: 0.07, pref: 0.08 });
});

test("score: gates — rel < 0,35 rejects with 'rel', lang = 0 rejects with 'lang'", () => {
	const ok: ScoreParts = { rel: 0.9, qual: 0.9, lang: 0.9, lvl: 0.9, dur: 0.9, pref: 0.9 };
	assert.equal(scoreResource({ ...ok, rel: REL_GATE - 0.01 }).gate, "rel");
	assert.equal(scoreResource({ ...ok, rel: REL_GATE }).passed, true);
	assert.equal(scoreResource({ ...ok, lang: 0 }).gate, "lang");
	assert.equal(scoreResource({ ...ok, rel: 0.1, lang: 0 }).gate, "rel", "rel is checked first");
});

test("score (property): in [0,1], monotone in every part, gates exactly as specified", () => {
	fc.assert(
		fc.property(partsArb, fc.constantFrom("rel", "qual", "lang", "lvl", "dur", "pref"), part, (parts, key, bump) => {
			const a = scoreResource(parts);
			assert.ok(a.score >= 0 && a.score <= 1);
			assert.equal(a.passed, parts.rel >= REL_GATE && parts.lang > 0);
			const higher = { ...parts, [key]: Math.max(parts[key as keyof ScoreParts], bump) };
			assert.ok(scoreResource(higher).score >= a.score - 1e-12);
		}),
	);
});

test("relevance: 0,5·llm + 0,3·cos + 0,2·bm25, renormalized without the LLM", () => {
	assert.equal(relevance({ llmCoverage: "full", cos: 1, bm25: 1 }), 1);
	assert.equal(relevance({ llmCoverage: "none", cos: 1, bm25: 1 }), 0.5, "an LLM 'none' halves the lexical/semantic evidence");
	assert.ok(Math.abs(relevance({ cos: 0.8, bm25: 0.6 }) - 0.72) < 1e-12, "without the LLM check cos/BM25 are renormalized");
});

test("levelFit and durationFit peak at the target and fall off symmetrically", () => {
	assert.equal(levelFit(2, 2), 1);
	assert.ok(Math.abs(levelFit(3, 2) - levelFit(1, 2)) < 1e-12);
	assert.ok(Math.abs(levelFit(2.75, 2) - Math.exp(-0.5)) < 1e-12, "σ = 0,75");
	assert.equal(levelFit(undefined, 2), 0.5);
	const t = targetSeconds({ lo: 6, hi: 12 });
	assert.ok(Math.abs(durationFit(t, t) - 1) < 1e-12);
	assert.ok(Math.abs(durationFit(t * 2, t) - durationFit(t / 2, t)) < 1e-12, "log-normal is symmetric in ln d");
	assert.equal(durationFit(undefined, t), 0.5);
});

test("trust: curated Beta(4,1) prior, decayed feedback, seeded Thompson sample in [0,1]", () => {
	const now = Date.parse("2026-11-18T00:00:00Z");
	assert.equal(channelTrust(CURATED_PRIOR, [], now), 0.8);
	const old = betaPosterior(CURATED_PRIOR, [{ useful: false, at: now - 90 * 86_400_000 }], now);
	const fresh = betaPosterior(CURATED_PRIOR, [{ useful: false, at: now }], now);
	assert.ok(Math.abs(old.b - 1.5) < 1e-9, "a 90-day-old event weighs half");
	assert.ok(Math.abs(fresh.b - 2) < 1e-9);
	const rng = seededRng(7);
	for (let i = 0; i < 50; i++) {
		const x = thompsonSample({ a: 4, b: 1 }, rng);
		assert.ok(x >= 0 && x <= 1);
	}
});

// ─── language fit ────────────────────────────────────────────────────────────

test("languageFit (Electronics): PT original = 1; EN with PT caption or auto-dub accepted; other languages ≈ 0", () => {
	assert.equal(languageFit(video({ lang: "pt-BR" }), ELECTRONICS), 1);
	const enManualPt = languageFit(video({ captions: [{ lang: "pt", kind: "manual" }] }), ELECTRONICS);
	const enAutoDub = languageFit(video({ captions: [], audioTracks: [{ lang: "en", kind: "original", isDefault: true }, { lang: "pt", kind: "dubbed-auto", isDefault: false }] }), ELECTRONICS);
	const enAsrOnly = languageFit(video({ captions: [{ lang: "en", kind: "asr", translatable: true }] }), ELECTRONICS);
	assert.equal(enManualPt, 0.85);
	assert.equal(enAutoDub, 0.75);
	assert.ok(enAsrOnly > 0 && enAsrOnly < enAutoDub, "EN with only ASR captions (auto-translated) is accepted, ranked below dubbing");
	assert.ok(languageFit(video({ lang: "de", captions: [] }), ELECTRONICS) < 0.1);
	assert.ok(scoreResource({ rel: 0.9, qual: 0.8, lang: enManualPt, lvl: 1, dur: 1, pref: 0.5 }).passed);
});

test("languageFit (English): dubbing excluded, EN original audio required, PT only as explanation", () => {
	const original = video({ lang: "en", captions: [{ lang: "en", kind: "manual" }] });
	assert.ok(languageFit(original, ENGLISH, { englishCefr: "B1" }) > 0.9);
	const dubbedToPt = video({ lang: "pt", audioTracks: [{ lang: "pt", kind: "dubbed-auto", isDefault: true }, { lang: "es", kind: "original", isDefault: false }] });
	assert.equal(languageFit(dubbedToPt, ENGLISH), 0, "a dubbed/foreign video is never English input");
	const ptTeacher = video({ lang: "pt", captions: [] });
	assert.equal(languageFit(ptTeacher, ENGLISH, { englishCefr: "A2" }), 0, "PT audio is not input");
	assert.ok(languageFit(ptTeacher, ENGLISH, { englishCefr: "A2", purpose: "explanation" }) > 0.5, "…but may explain at A level");
	assert.equal(languageFit(video({ lang: "und" }), ENGLISH), 0, "unknown language fails the English gate");
	const withPtDub = video({ lang: "en", captions: [{ lang: "en", kind: "manual" }], audioTracks: [{ lang: "en", kind: "original", isDefault: true }, { lang: "pt", kind: "dubbed-auto", isDefault: false }] });
	assert.ok(languageFit(withPtDub, ENGLISH, { englishCefr: "B1" }) < languageFit(original, ENGLISH, { englishCefr: "B1" }), "a PT dub available nearby costs ×0,9");
});

test("languageFit (English, property): any resource whose original audio is not EN scores 0 as input", () => {
	fc.assert(
		fc.property(fc.constantFrom("pt", "es", "fr", "de", "ja"), fc.constantFrom("A1", "B2", "C1"), (lang, cefr) => {
			assert.equal(languageFit(video({ lang, captions: [{ lang: "en", kind: "manual" }] }), ENGLISH, { englishCefr: cefr }), 0);
		}),
	);
});

test("languageFit: AI lessons always fit; books use their text language", () => {
	assert.equal(languageFit(video({ kind: "ai_lesson", lang: "pt" }), ENGLISH), 1);
	const book = video({ kind: "book", lang: "en", provider: "openstax" });
	assert.ok(languageFit(book, ELECTRONICS) > 0);
});

// ─── MMR ─────────────────────────────────────────────────────────────────────

test("MMR (λ = 0,7): a near-duplicate from the same channel yields to a diverse item", () => {
	const a = { id: "a", channelId: "UC1", embedding: [1, 0] };
	const b = { id: "b", channelId: "UC1", embedding: [0.99, 0.01] };
	const c = { id: "c", channelId: "UC2", embedding: [0, 1] };
	const picks = mmr(
		[
			{ item: a, score: 0.9 },
			{ item: b, score: 0.88 },
			{ item: c, score: 0.7 },
		],
		channelAwareSimilarity,
	);
	assert.deepEqual(
		picks.map((p) => p.item.id),
		["a", "c", "b"],
	);
	assert.equal(channelAwareSimilarity({ channelId: "X" }, { channelId: "X" }), 0.3);
});

test("MMR (property): returns a permutation; λ = 1 is plain score order", () => {
	fc.assert(
		fc.property(fc.array(part, { minLength: 1, maxLength: 12 }), (scores) => {
			const cands = scores.map((score, i) => ({ item: i, score }));
			const picked = mmr(cands, () => 0.5);
			assert.deepEqual([...picked.map((p) => p.item)].sort((x, y) => x - y), cands.map((c) => c.item));
			const plain = mmr(cands, () => 1, 1).map((p) => p.score);
			assert.deepEqual(plain, [...plain].sort((x, y) => y - x));
		}),
	);
});

// ─── set cover / spine ───────────────────────────────────────────────────────

test("set cover: greedy picks by covered weight / cost and stops at 90% of W", () => {
	const nodes: RegionNode[] = [
		{ nodeId: "n1", weight: 5 },
		{ nodeId: "n2", weight: 3 },
		{ nodeId: "n3", weight: 1 },
	];
	const sets: CoverSet[] = [
		{ id: "big", resourceId: "b1", cost: 10, coverage: { n1: 0.9, n2: 0.9, n3: 0.9 } },
		{ id: "cheap", resourceId: "b2", cost: 2, coverage: { n1: 0.8 } },
		{ id: "mid", resourceId: "b3", cost: 3, coverage: { n2: 0.7 } },
	];
	const r = greedySetCover(nodes, sets);
	assert.deepEqual(
		r.chosen.map((s) => s.id),
		["cheap", "mid", "big"],
	);
	assert.equal(r.coveredWeight, 9);
	const partial = greedySetCover(nodes, sets, { targetFraction: 0.5 });
	assert.deepEqual(
		partial.chosen.map((s) => s.id),
		["cheap"],
	);
});

test("set cover (property): every chosen set adds weight; covered ⊆ nodes with some cov ≥ threshold", () => {
	const nodeIds = ["a", "b", "c", "d", "e"];
	const coverage = fc.dictionary(fc.constantFrom(...nodeIds), part);
	fc.assert(
		fc.property(
			fc.array(fc.record({ cost: fc.double({ min: 0.5, max: 20, noNaN: true }), coverage }), { maxLength: 8 }),
			fc.array(fc.double({ min: 0, max: 10, noNaN: true }), { minLength: 5, maxLength: 5 }),
			(raw, weights) => {
				const nodes = nodeIds.map((nodeId, i) => ({ nodeId, weight: weights[i]! }));
				const sets = raw.map((s, i) => ({ id: `s${i}`, resourceId: `r${i}`, ...s }));
				const r = greedySetCover(nodes, sets);
				assert.ok(r.coveredWeight <= r.totalWeight + 1e-9);
				for (const id of r.covered) assert.ok(sets.some((s) => (s.coverage[id] ?? 0) >= 0.6));
				assert.equal(new Set(r.chosen.map((s) => s.id)).size, r.chosen.length);
			},
		),
	);
});

test("spine: the book covering the region best becomes the spine; τ < 0,5 warns and the graph order wins", () => {
	const nodes: RegionNode[] = [
		{ nodeId: "ohm", weight: 2 },
		{ nodeId: "kirchhoff", weight: 2 },
		{ nodeId: "thevenin", weight: 2 },
	];
	const spineBook: BookCandidate = {
		bookId: "kuphaldt:liec-dc",
		level: 1,
		sections: [
			{ sectionId: "1", order: 0, pages: 10, coverage: { thevenin: 0.9 } },
			{ sectionId: "2", order: 1, pages: 10, coverage: { kirchhoff: 0.9 } },
			{ sectionId: "3", order: 2, pages: 10, coverage: { ohm: 0.9 } },
		],
	};
	const weak: BookCandidate = { bookId: "openstax:x", level: 2, sections: [{ sectionId: "9", order: 0, pages: 5, coverage: { ohm: 0.7 } }] };
	const plan = planRegionReading(nodes, [weak, spineBook], [], { topoOrder: ["ohm", "kirchhoff", "thevenin"], regionLevel: 1 });
	assert.equal(plan.spine?.bookId, "kuphaldt:liec-dc");
	assert.deepEqual(
		plan.assignments.map((a) => a.nodeId),
		["ohm", "kirchhoff", "thevenin"],
		"assignments follow the graph",
	);
	assert.equal(plan.orderAgreement, -1);
	assert.equal(plan.warnings.length, 1);
	assert.equal(plan.coveredFraction, 1);
	assert.equal(kendallTau(["a", "b", "c"], ["a", "b", "c"]), 1);
});

// ─── review regressions ──────────────────────────────────────────────────────

test("Kendall τ (regression): nodes taught in the SAME spine section are ties — no false 'other order' warning", () => {
	const sameSection: BookCandidate = { bookId: "kuphaldt:liec-dc", level: 1, sections: [{ sectionId: "1", order: 0, pages: 10, coverage: { b: 0.9, a: 0.9 } }] };
	const two = planRegionReading(
		[
			{ nodeId: "a", weight: 1 },
			{ nodeId: "b", weight: 1 },
		],
		[sameSection],
		[],
		{ topoOrder: ["a", "b"], regionLevel: 1 },
	);
	assert.equal(two.orderAgreement, 1, "all pairs tied → no disagreement (was −1)");
	assert.deepEqual(two.warnings, []);
	const book: BookCandidate = {
		bookId: "kuphaldt:liec-dc",
		level: 1,
		sections: [
			{ sectionId: "1", order: 0, pages: 10, coverage: { b: 0.9, a: 0.9 } },
			{ sectionId: "2", order: 1, pages: 10, coverage: { c: 0.9 } },
		],
	};
	const three = planRegionReading(
		[
			{ nodeId: "a", weight: 1 },
			{ nodeId: "b", weight: 1 },
			{ nodeId: "c", weight: 1 },
		],
		[book],
		[],
		{ topoOrder: ["b", "a", "c"], regionLevel: 1 },
	);
	assert.equal(three.orderAgreement, 1);
	assert.deepEqual(three.warnings, []);
	// Sections teaching many nodes: τ-a/τ-b would stay below 0,5 here even in perfect agreement.
	const nine = ["n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9"];
	assert.equal(kendallTauByRank([...nine, "n10"], new Map([...nine.map((id) => [id, 0] as const), ["n10", 1]])), 1);
	assert.equal(kendallTauByRank(["c", "a"], new Map([["a", 0], ["c", 1]])), -1, "a real inversion still counts");
	assert.equal(kendallTauByRank(["a", "b", "c"], new Map([["a", 1], ["b", 0], ["c", 0]])), -1);
});

test("Kendall τ (property): in [−1, 1]; an order that follows the ranks scores 1 even with ties; without ties it is plain τ", () => {
	const ids = ["a", "b", "c", "d", "e", "f"];
	fc.assert(
		fc.property(fc.uniqueArray(fc.constantFrom(...ids), { minLength: 2, maxLength: 6 }), fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 6, maxLength: 6 }), (order, ranks) => {
			const rank = new Map(order.map((id, i) => [id, ranks[i]!]));
			const tau = kendallTauByRank(order, rank);
			assert.ok(tau >= -1 && tau <= 1);
			const sorted = [...order].sort((x, y) => rank.get(x)! - rank.get(y)!);
			assert.equal(kendallTauByRank(sorted, rank), 1);
			// Without ties it is the textbook τ-a = (C − D) / (n(n−1)/2).
			const strict = new Map(sorted.map((id, i) => [id, i]));
			let cd = 0;
			for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) cd += Math.sign(strict.get(order[j]!)! - strict.get(order[i]!)!);
			assert.ok(Math.abs(kendallTauByRank(order, strict) - cd / ((order.length * (order.length - 1)) / 2)) < 1e-12);
		}),
	);
});

test("language fit (regression): an 'und' original track never hides the known spoken language", () => {
	const r = video({ lang: "en", audioLang: "en", audioTracks: [{ lang: "und", kind: "original", isDefault: true }] });
	assert.ok(languageFit(r, ENGLISH, { englishCefr: "B1" }) > 0, "was 0: the 'und' track won over audioLang");
	assert.equal(languageFit(video({ lang: "und", titleLang: "en" }), ENGLISH, { englishCefr: "C1" }), 0, "a title language is never proof of original EN audio");
	assert.equal(languageFit(video({ lang: "und", titleLang: "pt-BR" }), ELECTRONICS), 1, "dub-tolerant domains may use the title hint");
	assert.equal(languageFit(video({ lang: "und" }), ELECTRONICS), 0.3, "nothing known → neutral 0,3");
});

test("language fit (regression): '≥ B2' accepts CEFR sub-levels (B2.1) like cefrBand does", () => {
	const r = video({ lang: "en", captions: [{ lang: "en", kind: "manual", translatable: true }] });
	assert.equal(languageFit(r, ELECTRONICS, { englishCefr: "B1" }), 0.65);
	assert.equal(languageFit(r, ELECTRONICS, { englishCefr: "B2" }), 0.85);
	assert.equal(languageFit(r, ELECTRONICS, { englishCefr: "B2.1" }), 0.85);
	assert.equal(languageFit(r, ELECTRONICS, { englishCefr: "C1" }), 0.85);
});

test("caption quality (regression): UNKNOWN captions (Data API) assume ASR in the spoken language; only a known empty list is 0", () => {
	assert.equal(captionQuality(undefined, false, "en"), 0.7);
	assert.equal(captionQuality(undefined, false, "pt-BR"), 0.6);
	assert.equal(captionQuality(undefined), 0.5);
	assert.equal(captionQuality(undefined, true, "en"), 1);
	assert.equal(captionQuality([], false, "en"), 0, "known: no captions at all");
	assert.equal(captionQuality([{ lang: "pt_BR", kind: "asr" }]), 0.6);
	const ctx = { policy: ELECTRONICS, nodeLevel: 1 };
	const link = { resourceId: "yt:abcdefghijk", nodeId: "n", score: 0.8, method: "manual" as const, provisional: false };
	const parts = scoreParts({ resource: video({ lang: "en", audioLang: "en" }), link }, ctx);
	assert.ok(Math.abs(parts.qual - 0.7) < 1e-12, "a Data API video without human captions no longer gets caption quality 0");
});

test("book relevance (regression): CoverageLink.score already is coverage × confidence — used as is", () => {
	const book: Resource = { ...video({}), id: "openstax:x#2.1", provider: "openstax", kind: "book_section", lang: "en", locator: { kind: "url", href: "https://openstax.org/x" } };
	const link = { resourceId: book.id, nodeId: "n", score: 0.5, method: "toc" as const, provisional: false };
	assert.equal(scoreParts({ resource: book, link }, { policy: ELECTRONICS, nodeLevel: 1 }).rel, 0.5);
});
