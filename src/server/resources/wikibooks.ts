/**
 * Wikibooks provider (SÍNTESE §2.8 "Livros abertos"; r6 §9.2 Wikibooks row:
 * MediaWiki API, content via `action=parse`, CC BY-SA 4.0, irregular
 * quality → used as a complement; books such as *Electronics*, *Circuit
 * Theory*, *Semiconductors*, *English Grammar*, *English in Use*).
 *
 *  search   /w/api.php?action=query&list=search&srsearch=…&srnamespace=0
 *           → results grouped by BOOK (the part before the first "/");
 *  toc      action=parse&page=<Book>&prop=text → links to "/wiki/<Book>/…"
 *           in document order (de-duplicated, fragments dropped); a subpage
 *           "<Book>/A/B" nests under "<Book>/A" when that page is listed;
 *  content  action=parse&page=<Book>/<Sub>&prop=text (edit links and TOC
 *           disabled) → Markdown → chunks.
 * Languages: "en" and "pt" Wikibooks (query `langs`, default en).
 * Attribution required by CC BY-SA: "Wikibooks contributors", page URL.
 * Ids: "wikibooks:<lang>:<Book title with underscores>" and "…#<tocId>".
 */

import { makeResourceId, sectionResourceId } from "../../core/resources/ids.ts";
import { buildToc, normalizeTocTitle, type RawTocNode } from "../../core/resources/toc.ts";
import { ResourceError, type ContentChunk, type ProviderStatus, type RateSpec, type Resource, type ResourceProvider, type ResourceQuery, type Span, type TocEntry } from "../../core/resources/types.ts";
import { CATALOG_TTL_MS } from "./cache.ts";
import { extractLinks, htmlText, htmlToMarkdown } from "./html.ts";
import { cachedJson, idFor, isoNow, sectionChunks, tocSection, type ProviderDeps } from "./provider-kit.ts";

export const WIKIBOOKS_RATE: RateSpec = Object.freeze({ minIntervalMs: 500 });
export const WIKIBOOKS_LANGS = ["en", "pt"] as const;
const P = "wikibooks";

const WIKIBOOKS_LICENSE = Object.freeze({
	name: "CC BY-SA 4.0",
	spdx: "CC-BY-SA-4.0",
	url: "https://creativecommons.org/licenses/by-sa/4.0/",
	shareAlike: true,
});

export interface WikibooksSearchResponse {
	query?: { search?: Array<{ title?: string; snippet?: string; pageid?: number }> };
	error?: { code?: string; info?: string };
}

export interface WikibooksParseResponse {
	parse?: { title?: string; pageid?: number; text?: string | { "*"?: string } };
	error?: { code?: string; info?: string };
}

export function wikibooksApi(lang: string): string {
	if (!(WIKIBOOKS_LANGS as readonly string[]).includes(lang)) throw new ResourceError(P, "invalid-input", `Wikibooks em "${lang}" não é suportado.`);
	return `https://${lang}.wikibooks.org/w/api.php`;
}

export function wikibooksPageUrl(lang: string, title: string): string {
	return `https://${lang}.wikibooks.org/wiki/${title.replace(/ /g, "_").split("/").map(encodeURIComponent).join("/")}`;
}

/** "Electronics/Resistors" → "Electronics". */
export function bookOfTitle(title: string): string {
	return title.split("/")[0]!.trim();
}

function pageKey(title: string): string {
	return title.replace(/ /g, "_");
}

function searchUrl(lang: string, text: string, limit: number): string {
	const params = new URLSearchParams({ action: "query", list: "search", srsearch: text, srnamespace: "0", srlimit: String(Math.min(Math.max(limit, 1), 50)), format: "json", formatversion: "2" });
	return `${wikibooksApi(lang)}?${params.toString()}`;
}

function parseUrl(lang: string, page: string): string {
	const params = new URLSearchParams({ action: "parse", page, prop: "text", disableeditsection: "1", disabletoc: "1", redirects: "1", format: "json", formatversion: "2" });
	return `${wikibooksApi(lang)}?${params.toString()}`;
}

function parseHtml(res: WikibooksParseResponse): string {
	if (res.error) throw new ResourceError(P, res.error.code === "missingtitle" ? "not-found" : "bad-response", `Wikibooks: ${res.error.info ?? res.error.code ?? "erro"}`);
	const t = res.parse?.text;
	return typeof t === "string" ? t : t?.["*"] ?? "";
}

export function wikibookResource(lang: string, book: string, fetchedAt: string, description?: string): Resource {
	const key = pageKey(book);
	const url = wikibooksPageUrl(lang, book);
	const r: Resource = {
		id: makeResourceId(P, `${lang}:${key}`),
		provider: P,
		kind: "book",
		title: book.replace(/_/g, " "),
		lang,
		license: { ...WIKIBOOKS_LICENSE, attribution: `"${book.replace(/_/g, " ")}" — colaboradores do Wikibooks, ${url}, CC BY-SA 4.0` },
		access: "open",
		tos: "open_license",
		locator: { kind: "url", href: url },
		url,
		creators: ["Colaboradores do Wikibooks"],
		fetchedAt,
	};
	if (description) r.description = description;
	return r;
}

/** Search hits → one Resource per book (first hit's snippet as description). */
export function booksOfSearch(lang: string, res: WikibooksSearchResponse, fetchedAt: string): Resource[] {
	if (res.error) throw new ResourceError(P, "bad-response", `Wikibooks: ${res.error.info ?? res.error.code ?? "erro"}`);
	const seen = new Map<string, Resource>();
	for (const hit of res.query?.search ?? []) {
		if (!hit.title) continue;
		const book = bookOfTitle(hit.title);
		if (!book || seen.has(book)) continue;
		const snippet = hit.snippet ? htmlText(hit.snippet) : undefined;
		seen.set(book, wikibookResource(lang, book, fetchedAt, snippet));
	}
	return [...seen.values()];
}

/** Book main-page HTML → raw TOC (subpage links in order, nested by path). */
export function wikibooksTocFromHtml(html: string, lang: string, book: string): RawTocNode[] {
	const base = `https://${lang}.wikibooks.org/wiki/`;
	const prefix = `${pageKey(book)}/`;
	const pages: Array<{ path: string; title: string }> = [];
	const seen = new Set<string>();
	for (const link of extractLinks(html, base)) {
		if (!link.href.startsWith(base)) continue;
		let path: string;
		try {
			path = decodeURIComponent(new URL(link.href).pathname.slice("/wiki/".length));
		} catch {
			continue;
		}
		path = pageKey(path);
		if (!path.startsWith(prefix) || path.length === prefix.length || path.includes(":") || seen.has(path)) continue;
		seen.add(path);
		const fallback = path.slice(prefix.length).split("/").pop()!.replace(/_/g, " ");
		pages.push({ path, title: normalizeTocTitle(link.text) || fallback });
	}
	const nodes = new Map<string, RawTocNode>();
	const roots: RawTocNode[] = [];
	for (const p of pages) {
		const node: RawTocNode = { title: p.title, href: p.path };
		nodes.set(p.path, node);
		const parentPath = p.path.slice(0, p.path.lastIndexOf("/"));
		const parent = parentPath.length > prefix.length - 1 ? nodes.get(parentPath) : undefined;
		if (parent) (parent.children ??= []).push(node);
		else roots.push(node);
	}
	return roots;
}

function splitExternal(externalId: string): { lang: string; book: string } {
	const colon = externalId.indexOf(":");
	const lang = externalId.slice(0, colon);
	const book = externalId.slice(colon + 1);
	if (colon <= 0 || !book) throw new ResourceError(P, "invalid-input", `Id do Wikibooks inválido: "${externalId}".`);
	wikibooksApi(lang);
	return { lang, book };
}

export class WikibooksProvider implements ResourceProvider {
	readonly id = P;
	readonly label = "Wikibooks (CC BY-SA)";
	readonly tos = "open_license" as const;
	readonly kinds: Resource["kind"][] = ["book", "book_section"];
	readonly rate = WIKIBOOKS_RATE;

	constructor(private readonly deps: ProviderDeps) {}

	async status(): Promise<ProviderStatus> {
		return { available: true, reason: "Livros colaborativos do Wikibooks (CC BY-SA 4.0; qualidade variável, usar como complemento)." };
	}

	async search(q: ResourceQuery): Promise<Resource[]> {
		if (q.kinds && !q.kinds.some((k) => k === "book" || k === "book_section")) return [];
		const langs = (q.langs ?? ["en"]).filter((l): l is (typeof WIKIBOOKS_LANGS)[number] => (WIKIBOOKS_LANGS as readonly string[]).includes(l));
		const at = isoNow(this.deps);
		const out: Resource[] = [];
		for (const lang of langs.length ? langs : ["en" as const]) {
			const text = (lang === "pt" ? q.text.pt ?? q.text.en : q.text.en ?? q.text.pt) ?? q.aliases?.[0];
			if (!text?.trim()) continue;
			const res = await cachedJson<WikibooksSearchResponse>(this.deps, searchUrl(lang, text, q.maxResults * 2), P, CATALOG_TTL_MS);
			out.push(...booksOfSearch(lang, res, at));
		}
		return out.slice(0, q.maxResults);
	}

	async resolve(id: string): Promise<Resource> {
		const parsed = idFor(P, P, id);
		const { lang, book } = splitExternal(parsed.externalId);
		const r = wikibookResource(lang, book, isoNow(this.deps));
		if (!parsed.sectionId) return r;
		const toc = await this.toc(parsed.baseId);
		const entry = tocSection(P, toc, parsed.sectionId);
		const url = wikibooksPageUrl(lang, entry.href ?? book);
		return { ...r, id: sectionResourceId(r.id, entry.id), kind: "book_section", title: `${r.title} — ${entry.title}`, parentId: r.id, sectionId: entry.id, url, locator: { kind: "url", href: url } };
	}

	async toc(id: string): Promise<TocEntry[]> {
		const { lang, book } = splitExternal(idFor(P, P, id).externalId);
		const html = parseHtml(await cachedJson<WikibooksParseResponse>(this.deps, parseUrl(lang, book), P, CATALOG_TTL_MS));
		const raw = wikibooksTocFromHtml(html, lang, book);
		if (raw.length === 0) throw new ResourceError(P, "not-found", "Este livro do Wikibooks não lista subpáginas no índice.");
		return buildToc(raw);
	}

	async content(id: string, span?: Span): Promise<ContentChunk[]> {
		const parsed = idFor(P, P, id);
		const { lang, book } = splitExternal(parsed.externalId);
		const sectionId = parsed.sectionId ?? span?.sectionId;
		let page = book;
		let toc: TocEntry[] = [];
		let entry: TocEntry | undefined;
		if (sectionId) {
			toc = await this.toc(parsed.baseId);
			entry = tocSection(P, toc, sectionId);
			page = entry.href ?? book;
		}
		const html = parseHtml(await cachedJson<WikibooksParseResponse>(this.deps, parseUrl(lang, page), P, CATALOG_TTL_MS));
		const resourceId = entry ? sectionResourceId(parsed.baseId, entry.id) : parsed.baseId;
		return sectionChunks(resourceId, toc, entry, htmlToMarkdown(html), entry ? { sectionId: entry.id } : undefined);
	}
}

export function createWikibooksProvider(deps: ProviderDeps): WikibooksProvider {
	return new WikibooksProvider(deps);
}
