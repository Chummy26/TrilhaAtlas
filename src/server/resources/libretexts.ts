/**
 * LibreTexts provider: Commons catalog (SÍNTESE §2.8 "LibreTexts"; r6 §9.2
 * LibreTexts row: `GET commons.libretexts.org/api/v1/commons/catalog?limit=
 * 1000&page=N`, `numTotal` ≈ 4,145, per-book `license`, `library`,
 * `subject`, `links.{online,pdf,zip,files}`; downloads at
 * `downloads.libretexts.org/api/v1/download/<bookID>/pdf`).
 *
 * The catalog is paged in full (≤ MAX_PAGES pages of 1,000) and cached for a
 * week; search is a local lexical pre-filter (core match.ts) optionally
 * restricted to libraries ("eng", "phys", "human", …). The response shape is
 * parsed defensively (books under `books`, `data` or `results`) because the
 * Commons API is not versioned. No TOC here: LibreTexts books are offered as
 * PDF/ZIP downloads that the learner can import into the library
 * (user-library.ts), which builds the structured TOC from the file itself.
 * Licenses are per book (r6: ~22% came empty → "não informada", treated as
 * protected by core license.ts).
 * Ids: "libretexts:<bookID>".
 */

import { makeResourceId } from "../../core/resources/ids.ts";
import { parseLicense } from "../../core/resources/license.ts";
import { rankByMatch } from "../../core/resources/match.ts";
import { ResourceError, type ProviderStatus, type RateSpec, type Resource, type ResourceDownload, type ResourceProvider, type ResourceQuery } from "../../core/resources/types.ts";
import { CATALOG_TTL_MS } from "./cache.ts";
import { cachedJson, firstText, idFor, isoNow, stringList, type ProviderDeps } from "./provider-kit.ts";

export const LIBRETEXTS_CATALOG_BASE = "https://commons.libretexts.org/api/v1/commons/catalog";
export const LIBRETEXTS_DOWNLOAD_BASE = "https://downloads.libretexts.org/api/v1/download";
export const LIBRETEXTS_RATE: RateSpec = Object.freeze({ minIntervalMs: 1000 });
export const LIBRETEXTS_PAGE_SIZE = 1000;
export const LIBRETEXTS_MAX_PAGES = 8;
const P = "libretexts";

/** Libraries most relevant per built-in domain (local filter; unknown domains search all). */
export const LIBRETEXTS_LIBRARIES_BY_DOMAIN: Readonly<Record<string, readonly string[]>> = Object.freeze({
	electronics: ["eng", "phys", "workforce", "math"],
	english: ["human", "socialsci"],
});

export interface LibretextsBook {
	bookID?: string;
	title?: string;
	author?: string;
	affiliation?: string;
	library?: string;
	subject?: string;
	course?: string;
	license?: string;
	summary?: string;
	thumbnail?: string;
	links?: { online?: string; pdf?: string; zip?: string; files?: string; buy?: string };
}

export interface LibretextsCatalogPage {
	numFound?: number;
	numTotal?: number;
	books?: LibretextsBook[];
	data?: LibretextsBook[];
	results?: LibretextsBook[];
}

export function catalogPageUrl(page: number, limit = LIBRETEXTS_PAGE_SIZE): string {
	return `${LIBRETEXTS_CATALOG_BASE}?limit=${limit}&page=${page}`;
}

export function booksOfPage(page: LibretextsCatalogPage): LibretextsBook[] {
	return page.books ?? page.data ?? page.results ?? [];
}

const LANG_BY_LIBRARY: Readonly<Record<string, string>> = { espanol: "es" };

function isHttps(url: string | undefined): url is string {
	return typeof url === "string" && /^https:\/\//i.test(url);
}

/** Catalog entry → book Resource (undefined without id/title). */
export function mapLibretextsBook(b: LibretextsBook, fetchedAt: string): Resource | undefined {
	const bookId = b.bookID?.trim();
	const title = b.title?.trim();
	if (!bookId || !title || bookId.includes("#")) return undefined;
	const license = parseLicense(b.license);
	const author = firstText(b.author);
	const online = isHttps(b.links?.online) ? b.links.online : undefined;
	const downloads: ResourceDownload[] = [
		{ format: "pdf", href: isHttps(b.links?.pdf) ? b.links.pdf : `${LIBRETEXTS_DOWNLOAD_BASE}/${encodeURIComponent(bookId)}/pdf` },
		...(isHttps(b.links?.zip) ? [{ format: "zip" as const, href: b.links.zip }] : []),
	];
	const r: Resource = {
		id: makeResourceId(P, bookId),
		provider: P,
		kind: "book",
		title,
		lang: LANG_BY_LIBRARY[b.library ?? ""] ?? "en",
		license: { ...license, attribution: `${title}${author ? ` — ${author}` : ""} (LibreTexts), ${license.name}` },
		access: "open",
		tos: "open_license",
		locator: { kind: "url", href: online ?? downloads[0]!.href },
		downloads,
		subjects: [b.library, b.subject, b.course].filter((s): s is string => Boolean(s?.trim())),
		fetchedAt,
	};
	if (online) r.url = online;
	if (author) r.creators = stringList(author.split(/\s*;\s*/));
	if (b.summary?.trim()) r.description = b.summary.trim();
	return r;
}

export interface LibretextsOptions extends ProviderDeps {
	maxPages?: number;
}

export class LibretextsProvider implements ResourceProvider {
	readonly id = P;
	readonly label = "LibreTexts (livros abertos)";
	readonly tos = "open_license" as const;
	readonly kinds: Resource["kind"][] = ["book"];
	readonly rate = LIBRETEXTS_RATE;

	constructor(private readonly deps: LibretextsOptions) {}

	async status(): Promise<ProviderStatus> {
		return { available: true, reason: "Catálogo aberto da LibreTexts (licença por livro; PDF/ZIP para importar na biblioteca)." };
	}

	/** Every catalog page until a short/empty page, `numTotal`, or MAX_PAGES. */
	async catalog(): Promise<Resource[]> {
		const at = isoNow(this.deps);
		const out: Resource[] = [];
		const seen = new Set<string>();
		const maxPages = this.deps.maxPages ?? LIBRETEXTS_MAX_PAGES;
		for (let page = 1; page <= maxPages; page++) {
			const res = await cachedJson<LibretextsCatalogPage>(this.deps, catalogPageUrl(page), P, CATALOG_TTL_MS, { maxBytes: 32 * 1024 * 1024 });
			const books = booksOfPage(res);
			let fresh = 0;
			for (const b of books) {
				const r = mapLibretextsBook(b, at);
				if (!r || seen.has(r.id)) continue;
				seen.add(r.id);
				out.push(r);
				fresh++;
			}
			const total = res.numTotal ?? res.numFound;
			if (books.length < LIBRETEXTS_PAGE_SIZE || fresh === 0 || (total !== undefined && out.length >= total)) break;
		}
		return out;
	}

	async search(q: ResourceQuery): Promise<Resource[]> {
		if (q.kinds && !q.kinds.includes("book")) return [];
		const libraries = LIBRETEXTS_LIBRARIES_BY_DOMAIN[q.domainId];
		const books = (await this.catalog()).filter((b) => !libraries || (b.subjects ?? []).some((s) => libraries.includes(s)));
		return rankByMatch(books, q, (b) => ({ title: b.title, body: [...(b.subjects ?? []), b.description ?? ""].join(" ") })).slice(0, q.maxResults);
	}

	async resolve(id: string): Promise<Resource> {
		const parsed = idFor(P, P, id);
		const book = (await this.catalog()).find((b) => b.id === parsed.baseId);
		if (!book) throw new ResourceError(P, "not-found", "Livro não encontrado no catálogo da LibreTexts.");
		return book;
	}
}

export function createLibretextsProvider(deps: LibretextsOptions): LibretextsProvider {
	return new LibretextsProvider(deps);
}
