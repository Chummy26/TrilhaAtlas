/**
 * Lightweight lexical matching for LOCAL catalog filtering (OpenStax CMS
 * list, LibreTexts/OTL catalog pages, Kuphaldt volumes, the learner's
 * library). Catalog search is a pre-filter only: the node↔section mapping of
 * SÍNTESE §2.8 (embeddings + BM25 + RRF + LLM check) runs later on the
 * ingested text. Here: accent-folded tokens, PT/EN stop words removed,
 * score = matched query tokens / query tokens (title matches count double).
 *
 * Also a coarse EN/PT language guess for imported books.
 *
 * Pure: browser-safe.
 */

import type { ResourceQuery } from "./types.ts";

const STOP = new Set(
	"a o as os de da do das dos e em no na nos nas um uma uns umas para por com sem que como the of and in on to for with an at by from is are or its into".split(" "),
);

/** Lowercase, accents folded, split on non-alphanumerics, stop words and 1-char tokens dropped. */
export function tokenize(text: string): string[] {
	return text
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length > 1 && !STOP.has(t));
}

/** Share of query tokens found in `title` (×2) or `body`, in [0,1]. */
export function textMatchScore(query: string, title: string, body = ""): number {
	const q = [...new Set(tokenize(query))];
	if (q.length === 0) return 0;
	const t = new Set(tokenize(title));
	const b = new Set(tokenize(body));
	let acc = 0;
	for (const tok of q) {
		if (t.has(tok) || [...t].some((x) => x.startsWith(tok) && tok.length >= 4)) acc += 2;
		else if (b.has(tok)) acc += 1;
	}
	return Math.min(1, acc / (2 * q.length));
}

/** Query strings of a ResourceQuery (both languages + aliases). */
export function queryTexts(q: Pick<ResourceQuery, "text" | "aliases">): string[] {
	return [q.text.en, q.text.pt, ...(q.aliases ?? [])].filter((s): s is string => Boolean(s?.trim()));
}

/** Best match of any query text. */
export function bestMatch(q: Pick<ResourceQuery, "text" | "aliases">, title: string, body = ""): number {
	return Math.max(0, ...queryTexts(q).map((text) => textMatchScore(text, title, body)));
}

/** Filter + sort items by match (≥ minScore), stable for ties. */
export function rankByMatch<T>(items: readonly T[], q: Pick<ResourceQuery, "text" | "aliases">, fields: (item: T) => { title: string; body?: string }, minScore = 0.34): T[] {
	return items
		.map((item, index) => {
			const f = fields(item);
			return { item, index, score: bestMatch(q, f.title, f.body ?? "") };
		})
		.filter((x) => x.score >= minScore)
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.map((x) => x.item);
}

const EN_MARKERS = new Set("the and of to is that with for this are be which".split(" "));
const PT_MARKERS = new Set("de que não para com uma os as do da em são pelo pela".split(" "));

/**
 * Coarse EN/PT guess for imported books (stop-word counts over the first
 * 5,000 words); "und" when the evidence is thin or mixed. Only used to label
 * the learner's own files; never to filter videos.
 */
export function guessLanguage(text: string): "en" | "pt" | "und" {
	const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
	let en = 0;
	let pt = 0;
	for (const w of words.slice(0, 5000)) {
		if (EN_MARKERS.has(w)) en++;
		if (PT_MARKERS.has(w)) pt++;
	}
	if (en + pt < 5) return "und";
	if (en >= pt * 1.5) return "en";
	if (pt >= en * 1.5) return "pt";
	return "und";
}
