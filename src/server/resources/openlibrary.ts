/**
 * Open Library provider: METADATA and printed TOC only (SÍNTESE §2.8
 * "Protegidos: só metadados (título, ISBN, sumário)"; r6 §9.2/§11.3 "Open
 * Library 1 req/s"; §12.1 TOC recovery chain: PDF outline → Crossref →
 * `table_of_contents` do Open Library → foto → LLM provisório).
 *
 *  search   /search.json?q=…&fields=…&limit=N&lang=…   (works)
 *  resolve  /works/OL…W.json (+ ≤ 3 cached /authors/OL…A.json)
 *           /books/OL…M.json   /isbn/<isbn>.json (redirects to /books/)
 *  toc      edition `table_of_contents` ({level,label,title,pagenum} items or
 *           legacy strings); for a work, the first of its editions that has
 *           one. Page numbers there are PRINTED labels, never physical pages:
 *           they go to `pageLabel` and no physical range is invented.
 * Access: `ebook_access` "public" → open scan on archive.org ("open"),
 * "borrowable" → controlled lending link ("borrow_link"), else metadata only.
 * The app never downloads borrowed books; it only links to them.
 * Ids: "ol:OL…W" (work), "ol:OL…M" (edition), "ol:isbn:<isbn>".
 */

import { makeResourceId } from "../../core/resources/ids.ts";
import { buildToc, normalizeTocTitle, type RawTocNode } from "../../core/resources/toc.ts";
import { ResourceError, type ProviderStatus, type RateSpec, type Resource, type ResourceAccess, type ResourceProvider, type ResourceQuery, type TocEntry } from "../../core/resources/types.ts";
import { METADATA_TTL_MS } from "./cache.ts";
import { cachedJson, firstText, idFor, isoNow, stringList, type ProviderDeps } from "./provider-kit.ts";

export const OPENLIBRARY_ORIGIN = "https://openlibrary.org";
export const OPENLIBRARY_RATE: RateSpec = Object.freeze({ minIntervalMs: 1000 });
const P = "openlibrary";
const PREFIX = "ol";
const SEARCH_FIELDS = "key,title,subtitle,author_name,first_publish_year,isbn,language,ebook_access,edition_key,cover_i,subject,number_of_pages_median";

export interface OpenLibraryDoc {
	key?: string;
	title?: string;
	subtitle?: string;
	author_name?: string[];
	first_publish_year?: number;
	isbn?: string[];
	language?: string[];
	ebook_access?: string;
	edition_key?: string[];
	cover_i?: number;
	subject?: string[];
	number_of_pages_median?: number;
}

export interface OpenLibrarySearchResponse {
	numFound?: number;
	docs?: OpenLibraryDoc[];
}

export interface OpenLibraryTocItem {
	level?: number;
	label?: string;
	title?: string;
	pagenum?: string;
}

export interface OpenLibraryEdition {
	key?: string;
	title?: string;
	subtitle?: string;
	works?: Array<{ key?: string }>;
	authors?: Array<{ key?: string }>;
	isbn_13?: string[];
	isbn_10?: string[];
	languages?: Array<{ key?: string }>;
	number_of_pages?: number;
	publish_date?: string;
	table_of_contents?: Array<OpenLibraryTocItem | string>;
}

export interface OpenLibraryWork {
	key?: string;
	title?: string;
	subtitle?: string;
	description?: string | { value?: string };
	authors?: Array<{ author?: { key?: string } }>;
	subjects?: string[];
	first_publish_date?: string;
}

/** MARC 3-letter language codes → BCP-47 primary tags (common ones). */
const MARC_LANG: Readonly<Record<string, string>> = { eng: "en", por: "pt", spa: "es", fre: "fr", ger: "de", ita: "it", rus: "ru", jpn: "ja", chi: "zh" };

export function marcToLang(code: string | undefined): string | undefined {
	if (!code) return undefined;
	const c = code.replace(/^\/languages\//, "").toLowerCase();
	return MARC_LANG[c];
}

/** Normalize an ISBN-10/13 (digits + X); undefined when malformed. */
export function normalizeIsbn(raw: string): string | undefined {
	const s = raw.replace(/[^0-9Xx]/g, "").toUpperCase();
	return /^(\d{9}[\dX]|\d{13})$/.test(s) ? s : undefined;
}

function accessOf(ebookAccess: string | undefined): ResourceAccess {
	if (ebookAccess === "public") return "open";
	if (ebookAccess === "borrowable") return "borrow_link";
	return "metadata_only";
}

const METADATA_LICENSE = { name: "Metadados do Open Library (CC0); o livro tem direitos próprios", url: "https://openlibrary.org/developers/licensing" };

function olKey(key: string | undefined, kind: "works" | "books" | "authors"): string | undefined {
	const m = key?.match(new RegExp(`^/${kind}/(OL\\d+[WMA])$`));
	return m?.[1];
}

/** search.json doc → work Resource. */
export function mapOpenLibraryDoc(doc: OpenLibraryDoc, fetchedAt: string): Resource | undefined {
	const workId = olKey(doc.key, "works");
	const title = normalizeTocTitle([doc.title, doc.subtitle].filter(Boolean).join(": "));
	if (!workId || !title) return undefined;
	const url = `${OPENLIBRARY_ORIGIN}/works/${workId}`;
	const isbn = (doc.isbn ?? []).map(normalizeIsbn).find((x): x is string => Boolean(x && x.length === 13)) ?? (doc.isbn ?? []).map(normalizeIsbn).find(Boolean);
	const r: Resource = {
		id: makeResourceId(PREFIX, workId),
		provider: P,
		kind: "book",
		title,
		lang: marcToLang(doc.language?.[0]) ?? "und",
		license: { ...METADATA_LICENSE },
		access: accessOf(doc.ebook_access),
		tos: "metadata_only",
		locator: isbn ? { kind: "isbn", isbn, href: url } : { kind: "url", href: url },
		url,
		fetchedAt,
		ttlDays: 30,
	};
	if (doc.author_name?.length) r.creators = doc.author_name.slice(0, 6);
	if (isbn) r.isbn = [isbn];
	if (doc.first_publish_year) r.year = doc.first_publish_year;
	if (doc.number_of_pages_median) r.pages = doc.number_of_pages_median;
	if (doc.subject?.length) r.subjects = doc.subject.slice(0, 12);
	return r;
}

/** Edition JSON → edition Resource. */
export function mapOpenLibraryEdition(e: OpenLibraryEdition, fetchedAt: string, creators: readonly string[] = []): Resource | undefined {
	const editionId = olKey(e.key, "books");
	const title = normalizeTocTitle([e.title, e.subtitle].filter(Boolean).join(": "));
	if (!editionId || !title) return undefined;
	const url = `${OPENLIBRARY_ORIGIN}/books/${editionId}`;
	const isbn = [...(e.isbn_13 ?? []), ...(e.isbn_10 ?? [])].map(normalizeIsbn).find(Boolean);
	const year = Number(e.publish_date?.match(/\b(1[5-9]\d\d|20\d\d)\b/)?.[1]);
	const r: Resource = {
		id: makeResourceId(PREFIX, editionId),
		provider: P,
		kind: "book",
		title,
		lang: marcToLang(e.languages?.[0]?.key) ?? "und",
		license: { ...METADATA_LICENSE },
		access: "metadata_only",
		tos: "metadata_only",
		locator: isbn ? { kind: "isbn", isbn, href: url } : { kind: "url", href: url },
		url,
		fetchedAt,
		ttlDays: 30,
	};
	if (creators.length) r.creators = [...creators];
	if (isbn) r.isbn = [isbn];
	if (e.number_of_pages) r.pages = e.number_of_pages;
	if (Number.isInteger(year)) r.year = year;
	return r;
}

/**
 * `table_of_contents` → raw TOC tree. Structured items nest by `level`
 * (0-based; a jump deeper than +1 attaches to the nearest shallower item);
 * legacy string items are flat. `pagenum` → printed `pageLabel` only.
 */
export function openLibraryTocToRaw(items: ReadonlyArray<OpenLibraryTocItem | string>): RawTocNode[] {
	const roots: RawTocNode[] = [];
	const stack: Array<{ level: number; node: RawTocNode }> = [];
	for (const item of items) {
		const it: OpenLibraryTocItem = typeof item === "string" ? { title: item } : item;
		const label = it.label?.trim();
		const titleText = normalizeTocTitle(it.title ?? "");
		const title = label && titleText && !titleText.startsWith(label) ? `${label} ${titleText}` : titleText || label || "";
		if (!title) continue;
		const node: RawTocNode = { title, ...(it.pagenum?.trim() ? { pageLabel: it.pagenum.trim() } : {}) };
		const level = Math.max(0, Math.floor(it.level ?? 0));
		while (stack.length && stack[stack.length - 1]!.level >= level) stack.pop();
		const parent = stack[stack.length - 1];
		if (parent) (parent.node.children ??= []).push(node);
		else roots.push(node);
		stack.push({ level, node });
	}
	return roots;
}

export function openLibrarySearchUrl(q: ResourceQuery): string {
	const text = q.text.en ?? q.text.pt ?? q.aliases?.[0] ?? "";
	const params = new URLSearchParams({ q: text, fields: SEARCH_FIELDS, limit: String(Math.min(Math.max(q.maxResults, 1), 50)) });
	const lang = q.langs?.[0];
	if (lang) params.set("lang", lang);
	return `${OPENLIBRARY_ORIGIN}/search.json?${params.toString()}`;
}

export class OpenLibraryProvider implements ResourceProvider {
	readonly id = P;
	readonly label = "Open Library (metadados e sumários)";
	readonly tos = "metadata_only" as const;
	readonly kinds: Resource["kind"][] = ["book"];
	readonly rate = OPENLIBRARY_RATE;

	constructor(private readonly deps: ProviderDeps) {}

	async status(): Promise<ProviderStatus> {
		return { available: true, reason: "Só metadados, ISBN e sumário impresso; o livro em si não é baixado." };
	}

	async search(q: ResourceQuery): Promise<Resource[]> {
		if (q.kinds && !q.kinds.includes("book")) return [];
		if (!q.text.en?.trim() && !q.text.pt?.trim() && !q.aliases?.length) throw new ResourceError(P, "invalid-input", "Consulta vazia.");
		const res = await cachedJson<OpenLibrarySearchResponse>(this.deps, openLibrarySearchUrl(q), P, METADATA_TTL_MS);
		const at = isoNow(this.deps);
		return (res.docs ?? []).flatMap((d) => {
			const r = mapOpenLibraryDoc(d, at);
			return r ? [r] : [];
		}).slice(0, q.maxResults);
	}

	private async authors(keys: ReadonlyArray<string | undefined>): Promise<string[]> {
		const names: string[] = [];
		for (const key of keys.slice(0, 3)) {
			const id = olKey(key, "authors");
			if (!id) continue;
			const a = await cachedJson<{ name?: string; personal_name?: string }>(this.deps, `${OPENLIBRARY_ORIGIN}/authors/${id}.json`, P, METADATA_TTL_MS);
			const name = firstText(a.name, a.personal_name);
			if (name) names.push(name);
		}
		return names;
	}

	private async edition(externalId: string): Promise<OpenLibraryEdition> {
		if (externalId.startsWith("isbn:")) {
			const isbn = normalizeIsbn(externalId.slice(5));
			if (!isbn) throw new ResourceError(P, "invalid-input", `ISBN inválido: "${externalId.slice(5)}".`);
			return cachedJson<OpenLibraryEdition>(this.deps, `${OPENLIBRARY_ORIGIN}/isbn/${isbn}.json`, P, METADATA_TTL_MS);
		}
		if (/^OL\d+M$/.test(externalId)) return cachedJson<OpenLibraryEdition>(this.deps, `${OPENLIBRARY_ORIGIN}/books/${externalId}.json`, P, METADATA_TTL_MS);
		throw new ResourceError(P, "invalid-input", `Id de edição do Open Library inválido: "${externalId}".`);
	}

	async resolve(id: string): Promise<Resource> {
		const { externalId } = idFor(P, PREFIX, id);
		const at = isoNow(this.deps);
		if (/^OL\d+W$/.test(externalId)) {
			const w = await cachedJson<OpenLibraryWork>(this.deps, `${OPENLIBRARY_ORIGIN}/works/${externalId}.json`, P, METADATA_TTL_MS);
			const creators = await this.authors((w.authors ?? []).map((a) => a.author?.key));
			const title = normalizeTocTitle([w.title, w.subtitle].filter(Boolean).join(": "));
			if (!title) throw new ResourceError(P, "not-found", "Obra sem título no Open Library.");
			const url = `${OPENLIBRARY_ORIGIN}/works/${externalId}`;
			const description = typeof w.description === "string" ? w.description : w.description?.value;
			const r: Resource = {
				id: makeResourceId(PREFIX, externalId),
				provider: P,
				kind: "book",
				title,
				lang: "und",
				license: { ...METADATA_LICENSE },
				access: "metadata_only",
				tos: "metadata_only",
				locator: { kind: "url", href: url },
				url,
				fetchedAt: at,
				ttlDays: 30,
			};
			if (creators.length) r.creators = creators;
			if (description?.trim()) r.description = description.trim();
			if (w.subjects?.length) r.subjects = stringList(w.subjects).slice(0, 12);
			return r;
		}
		const e = await this.edition(externalId);
		const r = mapOpenLibraryEdition(e, at, await this.authors((e.authors ?? []).map((a) => a.key)));
		if (!r) throw new ResourceError(P, "not-found", "Edição não encontrada no Open Library.");
		return r;
	}

	async toc(id: string): Promise<TocEntry[]> {
		const { externalId } = idFor(P, PREFIX, id);
		let items: ReadonlyArray<OpenLibraryTocItem | string> | undefined;
		if (/^OL\d+W$/.test(externalId)) {
			const eds = await cachedJson<{ entries?: OpenLibraryEdition[] }>(this.deps, `${OPENLIBRARY_ORIGIN}/works/${externalId}/editions.json?limit=50`, P, METADATA_TTL_MS);
			items = (eds.entries ?? []).find((e) => (e.table_of_contents?.length ?? 0) > 0)?.table_of_contents;
		} else {
			items = (await this.edition(externalId)).table_of_contents;
		}
		if (!items?.length) throw new ResourceError(P, "not-found", "O Open Library não tem sumário para este livro.");
		return buildToc(openLibraryTocToRaw(items));
	}
}

export function createOpenLibraryProvider(deps: ProviderDeps): OpenLibraryProvider {
	return new OpenLibraryProvider(deps);
}
