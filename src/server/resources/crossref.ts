/**
 * Crossref provider: book metadata and CHAPTER-LEVEL TOC with DOIs (SÍNTESE
 * §2.8 "Sumário em cascata"; r6 §12.1 table: `works?filter=isbn:<isbn>,
 * type:book-chapter&select=DOI,title,page&rows=100` → chapters with page
 * ranges, e.g. Springer 978-3-032-30677-7 → 4 chapters "1–91", "93–175"…;
 * public pool limit 1 req/s and 1 concurrent request).
 *
 *  search   /works?query.bibliographic=…&filter=type:book,type:monograph,
 *           type:edited-book,type:reference-book&select=…&rows=N
 *  resolve  /works/<DOI>
 *  toc      ISBN of the book → /works?filter=isbn:<isbn>,type:book-chapter …
 *           → chapters sorted by first printed page (pageLabel only:
 *           printed numbers are not physical PDF pages) → TocEntry[] with the
 *           chapter DOI URL as href.
 * Privacy: no `mailto` (the "polite pool" would need the user's e-mail; the
 * generic User-Agent of safe-fetch is used instead).
 * Access: "open" only when Crossref lists a Creative Commons license (OA
 * books); otherwise metadata only. Content is never fetched from here.
 * Ids: "crossref:<DOI>" (DOIs with "#" are skipped: they cannot be ids).
 */

import { makeResourceId } from "../../core/resources/ids.ts";
import { isOpenLicense, parseLicense } from "../../core/resources/license.ts";
import { buildToc, normalizeTocTitle, type RawTocNode } from "../../core/resources/toc.ts";
import { ResourceError, type License, type ProviderStatus, type RateSpec, type Resource, type ResourceProvider, type ResourceQuery, type TocEntry } from "../../core/resources/types.ts";
import { METADATA_TTL_MS } from "./cache.ts";
import { cachedJson, idFor, isoNow, type ProviderDeps } from "./provider-kit.ts";
import { normalizeIsbn } from "./openlibrary.ts";

export const CROSSREF_API = "https://api.crossref.org";
export const CROSSREF_RATE: RateSpec = Object.freeze({ minIntervalMs: 1000 });
const P = "crossref";
const BOOK_TYPES = ["book", "monograph", "edited-book", "reference-book"] as const;
const SELECT = "DOI,title,subtitle,author,editor,ISBN,isbn-type,published,publisher,license,type,URL,language,page";

export interface CrossrefPerson {
	given?: string;
	family?: string;
	name?: string;
}

export interface CrossrefWork {
	DOI?: string;
	title?: string[];
	subtitle?: string[];
	author?: CrossrefPerson[];
	editor?: CrossrefPerson[];
	ISBN?: string[];
	"isbn-type"?: Array<{ value?: string; type?: string }>;
	published?: { "date-parts"?: number[][] };
	publisher?: string;
	license?: Array<{ URL?: string; "content-version"?: string }>;
	type?: string;
	URL?: string;
	language?: string;
	page?: string;
}

export interface CrossrefListResponse {
	status?: string;
	message?: { "total-results"?: number; items?: CrossrefWork[] };
}

export interface CrossrefWorkResponse {
	status?: string;
	message?: CrossrefWork;
}

function personName(p: CrossrefPerson): string | undefined {
	const s = p.name ?? [p.given, p.family].filter(Boolean).join(" ");
	return s.trim() || undefined;
}

function licenseOf(w: CrossrefWork): License {
	const urls = (w.license ?? []).map((l) => l.URL).filter((u): u is string => Boolean(u));
	const cc = urls.find((u) => /creativecommons\.org/i.test(u));
	if (cc) return parseLicense(cc, cc);
	return { name: "Direitos da editora (só metadados)", ...(urls[0] ? { url: urls[0] } : {}), proprietary: true };
}

/** Preferred ISBN of a work: print/electronic ISBN-13 first. */
export function isbnOf(w: CrossrefWork): string | undefined {
	const all = [...(w["isbn-type"] ?? []).map((x) => x.value ?? ""), ...(w.ISBN ?? [])].map(normalizeIsbn).filter((x): x is string => Boolean(x));
	return all.find((x) => x.length === 13) ?? all[0];
}

/** Crossref work → Resource (books and chapters). */
export function mapCrossrefWork(w: CrossrefWork, fetchedAt: string): Resource | undefined {
	const doi = w.DOI?.trim().toLowerCase();
	const title = normalizeTocTitle([w.title?.[0], w.subtitle?.[0]].filter(Boolean).join(": "));
	if (!doi || !title || doi.includes("#")) return undefined;
	const license = licenseOf(w);
	const open = isOpenLicense(license);
	const url = `https://doi.org/${doi}`;
	const people = [...(w.author ?? []), ...(w.editor ?? [])].map(personName).filter((s): s is string => Boolean(s));
	const year = w.published?.["date-parts"]?.[0]?.[0];
	const isbn = isbnOf(w);
	const r: Resource = {
		id: makeResourceId(P, doi),
		provider: P,
		kind: w.type === "book-chapter" ? "book_section" : "book",
		title,
		lang: w.language?.slice(0, 2).toLowerCase() || "en",
		license,
		access: open ? "open" : "metadata_only",
		tos: "metadata_only",
		locator: { kind: "doi", doi },
		url,
		doi,
		fetchedAt,
		ttlDays: 30,
	};
	if (people.length) r.creators = people.slice(0, 8);
	if (typeof year === "number") r.year = year;
	if (isbn) r.isbn = [isbn];
	return r;
}

function firstPage(page: string | undefined): number {
	const n = Number(page?.match(/\d+/)?.[0]);
	return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

/** Chapters (book-chapter works) → flat raw TOC sorted by first printed page. */
export function crossrefChaptersToRaw(chapters: readonly CrossrefWork[]): RawTocNode[] {
	return chapters
		.filter((c) => c.title?.[0]?.trim())
		.map((c, i) => ({ c, i }))
		.sort((a, b) => firstPage(a.c.page) - firstPage(b.c.page) || a.i - b.i)
		.map(({ c }) => ({
			title: c.title![0]!,
			...(c.page?.trim() ? { pageLabel: c.page.trim().replace(/-/g, "–") } : {}),
			...(c.DOI ? { href: `https://doi.org/${c.DOI.toLowerCase()}` } : {}),
		}));
}

export function crossrefSearchUrl(q: ResourceQuery): string {
	const text = [q.text.en, q.text.pt].filter(Boolean).join(" ") || (q.aliases ?? []).join(" ");
	const params = new URLSearchParams({
		"query.bibliographic": text,
		filter: BOOK_TYPES.map((t) => `type:${t}`).join(","),
		select: SELECT,
		rows: String(Math.min(Math.max(q.maxResults, 1), 50)),
	});
	return `${CROSSREF_API}/works?${params.toString()}`;
}

export function crossrefChaptersUrl(isbn: string): string {
	const params = new URLSearchParams({ filter: `isbn:${isbn},type:book-chapter`, select: "DOI,title,page", rows: "100" });
	return `${CROSSREF_API}/works?${params.toString()}`;
}

export class CrossrefProvider implements ResourceProvider {
	readonly id = P;
	readonly label = "Crossref (metadados e capítulos com DOI)";
	readonly tos = "metadata_only" as const;
	readonly kinds: Resource["kind"][] = ["book", "book_section"];
	readonly rate = CROSSREF_RATE;

	constructor(private readonly deps: ProviderDeps) {}

	async status(): Promise<ProviderStatus> {
		return { available: true, reason: "Só metadados e capítulos de livros acadêmicos com DOI." };
	}

	async search(q: ResourceQuery): Promise<Resource[]> {
		if (q.kinds && !q.kinds.includes("book")) return [];
		const url = crossrefSearchUrl(q);
		if (!new URL(url).searchParams.get("query.bibliographic")?.trim()) throw new ResourceError(P, "invalid-input", "Consulta vazia.");
		const res = await cachedJson<CrossrefListResponse>(this.deps, url, P, METADATA_TTL_MS);
		const at = isoNow(this.deps);
		return (res.message?.items ?? []).flatMap((w) => {
			const r = mapCrossrefWork(w, at);
			return r ? [r] : [];
		});
	}

	private async work(doi: string): Promise<CrossrefWork> {
		const res = await cachedJson<CrossrefWorkResponse>(this.deps, `${CROSSREF_API}/works/${doi.split("/").map(encodeURIComponent).join("/")}`, P, METADATA_TTL_MS);
		if (!res.message) throw new ResourceError(P, "not-found", "DOI não encontrado no Crossref.");
		return res.message;
	}

	async resolve(id: string): Promise<Resource> {
		const { externalId } = idFor(P, P, id);
		const r = mapCrossrefWork(await this.work(externalId), isoNow(this.deps));
		if (!r) throw new ResourceError(P, "bad-response", "Registro do Crossref sem DOI ou título.");
		return r;
	}

	/** Chapter TOC of a book given by DOI ("crossref:<doi>") or ISBN ("crossref:isbn:<isbn>"). */
	async toc(id: string): Promise<TocEntry[]> {
		const { externalId } = idFor(P, P, id);
		const isbn = externalId.startsWith("isbn:") ? normalizeIsbn(externalId.slice(5)) : isbnOf(await this.work(externalId));
		if (!isbn) throw new ResourceError(P, "not-found", "Livro sem ISBN no Crossref: não há como listar capítulos.");
		const res = await cachedJson<CrossrefListResponse>(this.deps, crossrefChaptersUrl(isbn), P, METADATA_TTL_MS);
		const raw = crossrefChaptersToRaw(res.message?.items ?? []);
		if (raw.length === 0) throw new ResourceError(P, "not-found", "O Crossref não tem capítulos com DOI para este livro.");
		return buildToc(raw);
	}
}

export function createCrossrefProvider(deps: ProviderDeps): CrossrefProvider {
	return new CrossrefProvider(deps);
}
