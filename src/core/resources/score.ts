/**
 * Per-node resource score (SÍNTESE §2.8 "Ranking"; r6 §7.2–7.6, §12.1).
 *
 *   score = 0,35·rel + 0,25·qual + 0,15·lang + 0,10·lvl + 0,07·dur + 0,08·pref
 *   gates: rel ≥ 0,35  and  lang > 0   (otherwise the resource is not offered)
 *
 * Components (all in [0,1]):
 *   rel   0,5·llmCoverage + 0,3·cos + 0,2·bm25 (r6 §7.2). Cold start without
 *         the LLM check (r6 §12.4): the embedding/BM25 terms renormalized.
 *         Books: coverage × confidence of the CoverageLink (r6 §12.1).
 *   qual  0,55·rubric + 0,25·channelTrust + 0,20·captionQ; missing parts are
 *         renormalized away (cold start = trust + captions only). NEVER views
 *         or likes (r6 §7.1: weak signal; YouTube policy forbids derived metrics).
 *   lang  language-fit.ts (domain policy).
 *   lvl   exp(−Δ²/(2·0,75²)), Δ = resource level − (node level + mastery adj).
 *   dur   exp(−(ln(d/T*))²/(2·0,5²)), T* = target minutes; unknown d → 0,5.
 *   pref  Thompson sample of Beta(α,β) per (channel, format) (r6 §7.6).
 *
 * Weights are normalized by their sum, so domain overrides (English: lang 0,20,
 * lvl 0,15 — r6 §7.2) keep the score in [0,1]. Gates use the raw components.
 *
 * Pure: browser-safe. Randomness is injected (Thompson sampling).
 */

export interface ScoreParts {
	rel: number;
	qual: number;
	lang: number;
	lvl: number;
	dur: number;
	pref: number;
}

export type ScoreWeights = ScoreParts;

export const DEFAULT_WEIGHTS: Readonly<ScoreWeights> = Object.freeze({ rel: 0.35, qual: 0.25, lang: 0.15, lvl: 0.1, dur: 0.07, pref: 0.08 });

/** English (r6 §7.2): language and level weigh more; normalized at scoring time. */
export const ENGLISH_WEIGHTS: Readonly<ScoreWeights> = Object.freeze({ rel: 0.35, qual: 0.25, lang: 0.2, lvl: 0.15, dur: 0.07, pref: 0.08 });

export const REL_GATE = 0.35;

export type GateFailure = "rel" | "lang";

export interface ScoreResult {
	score: number;
	parts: ScoreParts;
	passed: boolean;
	/** Which gate rejected the resource (first failing one). */
	gate?: GateFailure;
}

const PART_KEYS = ["rel", "qual", "lang", "lvl", "dur", "pref"] as const satisfies readonly (keyof ScoreParts)[];

export function clamp01(x: number): number {
	if (!Number.isFinite(x)) return 0;
	return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Weighted score with gates. Parts are clamped to [0,1]; weights normalized. */
export function scoreResource(parts: ScoreParts, weights: ScoreWeights = DEFAULT_WEIGHTS): ScoreResult {
	const clean = Object.fromEntries(PART_KEYS.map((k) => [k, clamp01(parts[k])])) as unknown as ScoreParts;
	let wSum = 0;
	let acc = 0;
	for (const k of PART_KEYS) {
		const w = Math.max(0, weights[k]);
		wSum += w;
		acc += w * clean[k];
	}
	if (wSum <= 0) throw new Error("scoreResource: a soma dos pesos precisa ser positiva");
	const score = acc / wSum;
	const gate: GateFailure | undefined = clean.rel < REL_GATE ? "rel" : clean.lang <= 0 ? "lang" : undefined;
	return gate ? { score, parts: clean, passed: false, gate } : { score, parts: clean, passed: true };
}

// ─── relevance ───────────────────────────────────────────────────────────────

export type LlmCoverage = "none" | "mentions" | "partial" | "full";

export const LLM_COVERAGE_VALUE: Readonly<Record<LlmCoverage, number>> = Object.freeze({ none: 0, mentions: 0.25, partial: 0.6, full: 1 });

/** rel = 0,5·llm + 0,3·cos + 0,2·bm25; without the LLM check the other two are renormalized. */
export function relevance(input: { llmCoverage?: LlmCoverage; cos?: number; bm25?: number }): number {
	const cos = clamp01(input.cos ?? 0);
	const bm25 = clamp01(input.bm25 ?? 0);
	if (input.llmCoverage === undefined) return clamp01((0.3 * cos + 0.2 * bm25) / 0.5);
	return clamp01(0.5 * LLM_COVERAGE_VALUE[input.llmCoverage] + 0.3 * cos + 0.2 * bm25);
}

/** Book relevance = coverage × confidence of its CoverageLink (r6 §12.1). */
export function bookRelevance(coverage: number, confidence = 1): number {
	return clamp01(coverage) * clamp01(confidence);
}

// ─── quality ─────────────────────────────────────────────────────────────────

export interface Rubric {
	accuracy: number;
	structure: number;
	examples: number;
	principles: number;
	pacing: number;
}

/** Mean of the 0–4 rubric criteria mapped to [0,1]. */
export function rubricScore(r: Rubric): number {
	const vals = [r.accuracy, r.structure, r.examples, r.principles, r.pacing];
	return clamp01(vals.reduce((a, b) => a + clamp01(b / 4), 0) / vals.length);
}

/** qual = 0,55·rubric + 0,25·trust + 0,20·captionQ; absent parts drop out (renormalized). */
export function quality(input: { rubric?: number; channelTrust?: number; captionQ?: number }): number {
	const terms: Array<[number, number | undefined]> = [
		[0.55, input.rubric],
		[0.25, input.channelTrust],
		[0.2, input.captionQ],
	];
	let w = 0;
	let acc = 0;
	for (const [weight, value] of terms) {
		if (value === undefined) continue;
		w += weight;
		acc += weight * clamp01(value);
	}
	return w === 0 ? 0.5 : acc / w;
}

function asrCaptionValue(lang: string | undefined): number {
	const l = (lang ?? "").trim().toLowerCase().split(/[-_]/)[0];
	return l === "en" ? 0.7 : l === "pt" ? 0.6 : 0.5;
}

/**
 * Caption quality signal (r6 §4.3): manual 1,0; ASR EN 0,7; ASR PT 0,6; other
 * ASR 0,5; none 0. `captions === undefined` means UNKNOWN (Data API mode), not
 * "none": like language-fit.ts, the spoken language is then assumed to have
 * YouTube's ASR captions (`spokenLang`; unknown → 0,5). Only a KNOWN empty
 * list scores 0 — otherwise every Data API video without human captions lost
 * the whole 0,20 caption share of `qual` against enriched ones.
 */
export function captionQuality(captions: ReadonlyArray<{ lang: string; kind: string }> | undefined, hasManualCaptions?: boolean, spokenLang?: string): number {
	if (hasManualCaptions) return 1;
	if (captions === undefined) return asrCaptionValue(spokenLang);
	let best = 0;
	for (const c of captions) {
		if (c.kind === "manual") return 1;
		if (c.kind === "asr") best = Math.max(best, asrCaptionValue(c.lang));
	}
	return best;
}

/** Prior quality of a book source (r6 §12.1): reviewed open textbooks 0,8; wikis 0,5; learner's own file 0,9. */
export function bookSourcePrior(provider: string): number {
	switch (provider) {
		case "user-library":
			return 0.9;
		case "openstax":
		case "otl":
		case "libretexts":
		case "kuphaldt":
			return 0.8;
		case "wikibooks":
			return 0.5;
		case "crossref":
		case "openlibrary":
			return 0.7;
		case "arxiv":
			return 0.6;
		default:
			return 0.6;
	}
}

// ─── level & duration ────────────────────────────────────────────────────────

/** lvl = exp(−Δ²/(2·0,75²)), Δ = resourceLevel − (nodeLevel + masteryAdj). Unknown level → 0,5. */
export function levelFit(resourceLevel: number | undefined, nodeLevel: number, masteryAdj = 0): number {
	if (resourceLevel === undefined || !Number.isFinite(resourceLevel)) return 0.5;
	const delta = resourceLevel - (nodeLevel + masteryAdj);
	return Math.exp(-(delta * delta) / (2 * 0.75 * 0.75));
}

/** dur = exp(−(ln(d/T*))²/(2·0,5²)); d and T* in the same unit. Unknown d → 0,5. */
export function durationFit(durationSec: number | undefined, targetSec: number): number {
	if (durationSec === undefined || !(durationSec > 0) || !(targetSec > 0)) return 0.5;
	const l = Math.log(durationSec / targetSec);
	return Math.exp(-(l * l) / (2 * 0.5 * 0.5));
}

export type DurationSituation = "atom" | "topic" | "lecture-segment" | "listening" | "review";

/** Target-duration bands T* in minutes (SÍNTESE §2.8; r6 §7.3). */
export const TARGET_MINUTES: Readonly<Record<DurationSituation, { lo: number; hi: number }>> = Object.freeze({
	atom: { lo: 6, hi: 12 },
	topic: { lo: 10, hi: 20 },
	"lecture-segment": { lo: 8, hi: 25 },
	listening: { lo: 5, hi: 15 },
	review: { lo: 2, hi: 5 },
});

/** T* = geometric centre of the band (the log-normal fit is symmetric in ln d). */
export function targetSeconds(band: { lo: number; hi: number }): number {
	return Math.sqrt(band.lo * band.hi) * 60;
}

/** Book reading time: pages × ~3 min/page of technical text (r6 §12.1). */
export function readingSeconds(pages: number, minutesPerPage = 3): number {
	return Math.max(0, pages) * minutesPerPage * 60;
}

// ─── trust & preference (Beta posteriors with 90-day half-life) ──────────────

export interface FeedbackEvent {
	useful: boolean;
	/** ISO date or epoch ms. */
	at: string | number;
}

export interface BetaPrior {
	a: number;
	b: number;
}

/** Curated channel prior Beta(4,1); unknown Beta(1,1) (r6 §7.6). */
export const CURATED_PRIOR: Readonly<BetaPrior> = Object.freeze({ a: 4, b: 1 });
export const UNKNOWN_PRIOR: Readonly<BetaPrior> = Object.freeze({ a: 1, b: 1 });
export const FEEDBACK_HALF_LIFE_DAYS = 90;

const DAY_MS = 86_400_000;

/** Posterior Beta(α0 + Σ useful·decay, β0 + Σ notUseful·decay), decay = 2^(−age/90 d). */
export function betaPosterior(prior: BetaPrior, events: readonly FeedbackEvent[], now: number, halfLifeDays = FEEDBACK_HALF_LIFE_DAYS): BetaPrior {
	let a = prior.a;
	let b = prior.b;
	for (const e of events) {
		const at = typeof e.at === "number" ? e.at : Date.parse(e.at);
		if (!Number.isFinite(at)) continue;
		const ageDays = Math.max(0, now - at) / DAY_MS;
		const w = Math.pow(2, -ageDays / halfLifeDays);
		if (e.useful) a += w;
		else b += w;
	}
	return { a, b };
}

/** channelTrust = posterior mean. */
export function channelTrust(prior: BetaPrior, events: readonly FeedbackEvent[], now: number): number {
	const p = betaPosterior(prior, events, now);
	return p.a / (p.a + p.b);
}

/** Standard normal via Box–Muller (rng returns [0,1)). */
function normal(rng: () => number): number {
	let u = 0;
	while (u <= Number.EPSILON) u = rng();
	const v = rng();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Gamma(shape, 1) — Marsaglia–Tsang; shape < 1 via the boost trick. */
function gammaSample(shape: number, rng: () => number): number {
	if (shape < 1) {
		let u = 0;
		while (u <= Number.EPSILON) u = rng();
		return gammaSample(shape + 1, rng) * Math.pow(u, 1 / shape);
	}
	const d = shape - 1 / 3;
	const c = 1 / Math.sqrt(9 * d);
	for (;;) {
		let x = 0;
		let v = 0;
		do {
			x = normal(rng);
			v = 1 + c * x;
		} while (v <= 0);
		v = v * v * v;
		const u = rng();
		if (u < 1 - 0.0331 * x * x * x * x) return d * v;
		if (u > 0 && Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
	}
}

/** One Thompson sample of Beta(a,b) — the `pref` component (r6 §7.6). */
export function thompsonSample(p: BetaPrior, rng: () => number = Math.random): number {
	if (!(p.a > 0) || !(p.b > 0)) throw new Error("thompsonSample: parâmetros Beta precisam ser positivos");
	const x = gammaSample(p.a, rng);
	const y = gammaSample(p.b, rng);
	return clamp01(x / (x + y));
}

/** Deterministic PRNG (mulberry32) for reproducible ranking in tests/replays. */
export function seededRng(seed: number): () => number {
	let t = seed >>> 0;
	return () => {
		t = (t + 0x6d2b79f5) >>> 0;
		let r = Math.imul(t ^ (t >>> 15), 1 | t);
		r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
		return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
	};
}
