/**
 * arXiv provider: METADATA of e-prints for level-5 nodes (SÍNTESE §2.8;
 * r6 §9.2 arXiv row: `export.arxiv.org/api/query?search_query=…&sortBy=
 * relevance`; metadata CC0, e-prints keep the author's rights (mostly the
 * arXiv non-exclusive license) → never re-serve PDFs, link the abstract;
 * limit 1 request / 3 s, one connection).
 *
 * The Atom feed is parsed with linkedom's XML parser (html.ts `parseXml`).
 * Query: every query word becomes `all:<word>` joined by AND (phrases would
 * be too strict for node titles), optionally restricted to categories
 * (OR'ed `cat:`), e.g. eess.SP, eess.SY, physics.app-ph, cs.AR for
 * Electronics and cs.CL for English linguistics (r6 §9.2).
 * Versions are stripped from ids ("2207.05872v2" → "2207.05872"); old-style
 * ids ("hep-th/9901001") are kept as they are.
 * Ids: "arxiv:<id>".
 */

import { makeResourceId } from "../../core/resources/ids.ts";
import { tokenize } from "../../core/resources/match.ts";
import { ResourceError, type ProviderStatus, type RateSpec, type Resource, type ResourceProvider, type ResourceQuery } from "../../core/resources/types.ts";
import { METADATA_TTL_MS } from "./cache.ts";
import { childrenByLocalName, elementsByLocalName, firstByLocalName, parseXml } from "./html.ts";
import { cachedText, idFor, isoNow, type ProviderDeps } from "./provider-kit.ts";

export const ARXIV_API = "https://export.arxiv.org/api/query";
export const ARXIV_RATE: RateSpec = Object.freeze({ minIntervalMs: 3000 });
const P = "arxiv";

/** arXiv categories per built-in domain (r6 §9.2). */
export const ARXIV_CATEGORIES_BY_DOMAIN: Readonly<Record<string, readonly string[]>> = Object.freeze({
	electronics: ["eess.SP", "eess.SY", "physics.app-ph", "cs.AR"],
	english: ["cs.CL"],
});

const ARXIV_LICENSE = Object.freeze({
	name: "Direitos do autor (licença do arXiv); metadados CC0",
	url: "https://info.arxiv.org/help/license/index.html",
});

/** "http://arxiv.org/abs/2207.05872v2" → "2207.05872"; old-style ids kept. */
export function arxivIdFromUrl(raw: string): string | undefined {
	const s = raw.trim();
	const id = (s.match(/arxiv\.org\/abs\/(.+)$/i)?.[1] ?? s).replace(/v\d+$/, "");
	if (/^\d{4}\.\d{4,5}$/.test(id) || /^[a-z-]+(?:\.[A-Z]{2})?\/\d{7}$/.test(id)) return id;
	return undefined;
}

export interface ArxivQueryOptions {
	maxResults: number;
	categories?: readonly string[];
}

export function arxivSearchUrl(text: string, o: ArxivQueryOptions): string {
	const words = [...new Set(tokenize(text))].slice(0, 8);
	if (words.length === 0) throw new ResourceError(P, "invalid-input", "Consulta vazia para o arXiv.");
	const terms = words.map((w) => `all:${w}`).join(" AND ");
	const cats = (o.categories ?? []).filter((c) => /^[a-z-]+(\.[A-Za-z-]+)?$/.test(c));
	const query = cats.length ? `(${terms}) AND (${cats.map((c) => `cat:${c}`).join(" OR ")})` : terms;
	const params = new URLSearchParams({
		search_query: query,
		start: "0",
		max_results: String(Math.min(Math.max(o.maxResults, 1), 50)),
		sortBy: "relevance",
		sortOrder: "descending",
	});
	return `${ARXIV_API}?${params.toString()}`;
}

function text(el: Element | undefined): string {
	return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Atom feed → article Resources. */
export function parseArxivFeed(xml: string, fetchedAt: string): Resource[] {
	const doc = parseXml(xml);
	const out: Resource[] = [];
	for (const entry of elementsByLocalName(doc, "entry")) {
		const id = arxivIdFromUrl(text(firstByLocalName(entry, "id")));
		const title = text(childrenByLocalName(entry, "title")[0]);
		if (!id || !title) continue;
		const authors = childrenByLocalName(entry, "author").map((a) => text(firstByLocalName(a, "name"))).filter(Boolean);
		const summary = text(childrenByLocalName(entry, "summary")[0]);
		const published = text(childrenByLocalName(entry, "published")[0]);
		const categories = childrenByLocalName(entry, "category").map((c) => c.getAttribute("term") ?? "").filter(Boolean);
		const url = `https://arxiv.org/abs/${id}`;
		const year = Number(published.slice(0, 4));
		const r: Resource = {
			id: makeResourceId(P, id),
			provider: P,
			kind: "article",
			title,
			lang: "en",
			license: { ...ARXIV_LICENSE },
			access: "open",
			tos: "metadata_only",
			locator: { kind: "arxiv", arxivId: id },
			url,
			level: 5,
			fetchedAt,
			ttlDays: 30,
		};
		if (authors.length) r.creators = authors.slice(0, 8);
		if (summary) r.description = summary;
		if (Number.isInteger(year) && year > 1990) r.year = year;
		if (categories.length) r.subjects = categories;
		out.push(r);
	}
	return out;
}

export class ArxivProvider implements ResourceProvider {
	readonly id = P;
	readonly label = "arXiv (artigos, só metadados)";
	readonly tos = "metadata_only" as const;
	readonly kinds: Resource["kind"][] = ["article"];
	readonly rate = ARXIV_RATE;

	constructor(private readonly deps: ProviderDeps & { categoriesByDomain?: Readonly<Record<string, readonly string[]>> }) {}

	async status(): Promise<ProviderStatus> {
		return { available: true, reason: "Metadados do arXiv (1 consulta a cada 3 s); o PDF é aberto na página do arXiv." };
	}

	async search(q: ResourceQuery): Promise<Resource[]> {
		if (q.kinds && !q.kinds.includes("article")) return [];
		const textQuery = q.text.en ?? q.aliases?.[0] ?? q.text.pt ?? "";
		const categories = (this.deps.categoriesByDomain ?? ARXIV_CATEGORIES_BY_DOMAIN)[q.domainId];
		const url = arxivSearchUrl(textQuery, { maxResults: q.maxResults, ...(categories ? { categories } : {}) });
		const xml = await cachedText(this.deps, url, P, METADATA_TTL_MS);
		return parseArxivFeed(xml, isoNow(this.deps)).slice(0, q.maxResults);
	}

	async resolve(id: string): Promise<Resource> {
		const { externalId } = idFor(P, P, id);
		// Normalize BEFORE matching: the feed's ids are version-less, so a
		// versioned id ("2207.05872v2") used to pass validation and then never
		// match its own entry (not-found).
		const arxivId = arxivIdFromUrl(externalId);
		if (!arxivId) throw new ResourceError(P, "invalid-input", `Id do arXiv inválido: "${externalId}".`);
		const xml = await cachedText(this.deps, `${ARXIV_API}?${new URLSearchParams({ id_list: arxivId }).toString()}`, P, METADATA_TTL_MS);
		const found = parseArxivFeed(xml, isoNow(this.deps)).find((r) => r.id === makeResourceId(P, arxivId));
		if (!found) throw new ResourceError(P, "not-found", "Artigo não encontrado no arXiv.");
		return found;
	}
}

export function createArxivProvider(deps: ProviderDeps & { categoriesByDomain?: Readonly<Record<string, readonly string[]>> }): ArxivProvider {
	return new ArxivProvider(deps);
}
