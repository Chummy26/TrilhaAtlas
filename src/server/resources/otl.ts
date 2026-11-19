/**
 * Open Textbook Library (University of Minnesota) provider (SÍNTESE §2.8
 * "OTL"; r6 §9.2 OTL row: `GET open.umn.edu/opentextbooks/textbooks.json?
 * page=N` (2,044 books), `/subjects/<id>.json?page=N` with 54 = Electrical
 * Engineering, 31 = Languages, 32 = Linguistics; per-book `license` and
 * `formats` with URLs (PDF, Online, eBook)).
 *
 * Search reads only the subjects mapped to the query's domain (a few pages
 * each, weekly cache) and pre-filters lexically (core match.ts); domains
 * without a mapping are not searched here (paging 205 pages per query would
 * be abusive). The JSON is parsed defensively: books under `data`,
 * `textbooks` or `data.textbooks`; contributors as objects or strings.
 * Paging stops on an empty page, a page with no new ids (server ignored
 * `page`) or MAX_PAGES. OTL has no TOC API: like LibreTexts, its PDFs are
 * imported into the learner's library for structure.
 * Ids: "otl:<numeric id>".
 */

import { makeResourceId } from "../../core/resources/ids.ts";
import { parseLicense } from "../../core/resources/license.ts";
import { rankByMatch } from "../../core/resources/match.ts";
import { ResourceError, type ProviderStatus, type RateSpec, type Resource, type ResourceDownload, type ResourceProvider, type ResourceQuery } from "../../core/resources/types.ts";
import { CATALOG_TTL_MS } from "./cache.ts";
import { cachedJson, firstText, idFor, isoNow, type ProviderDeps } from "./provider-kit.ts";

export const OTL_BASE = "https://open.umn.edu/opentextbooks";
export const OTL_RATE: RateSpec = Object.freeze({ minIntervalMs: 1000 });
export const OTL_MAX_PAGES = 6;
const P = "otl";

/** OTL subject ids per built-in domain (r6 §9.2). */
export const OTL_SUBJECTS_BY_DOMAIN: Readonly<Record<string, readonly number[]>> = Object.freeze({
	electronics: [54],
	english: [31, 32],
});

export interface OtlContributor {
	first_name?: string;
	middle_name?: string;
	last_name?: string;
	name?: string;
	contribution?: string;
}

export interface OtlFormat {
	format?: string;
	type?: string;
	url?: string;
}

export interface OtlBook {
	id?: number | string;
	title?: string;
	description?: string;
	url?: string;
	license?: string;
	language?: string;
	copyright_year?: number | string;
	ISBN13?: string;
	isbn13?: string;
	contributors?: Array<OtlContributor | string>;
	subjects?: Array<{ id?: number; name?: string } | string>;
	formats?: OtlFormat[];
}

export interface OtlPage {
	data?: OtlBook[] | { textbooks?: OtlBook[] };
	textbooks?: OtlBook[];
}

export function otlSubjectUrl(subjectId: number, page: number): string {
	return `${OTL_BASE}/subjects/${subjectId}.json?page=${page}`;
}

export function otlBookUrl(id: string): string {
	return `${OTL_BASE}/textbooks/${encodeURIComponent(id)}.json`;
}

export function booksOfOtlPage(page: OtlPage): OtlBook[] {
	if (Array.isArray(page.data)) return page.data;
	return page.data?.textbooks ?? page.textbooks ?? [];
}

function contributorName(c: OtlContributor | string): string | undefined {
	if (typeof c === "string") return c.trim() || undefined;
	return firstText(c.name, [c.first_name, c.middle_name, c.last_name].filter(Boolean).join(" "));
}

const LANG_NAMES: Readonly<Record<string, string>> = { eng: "en", english: "en", en: "en", spa: "es", spanish: "es", por: "pt", portuguese: "pt", fre: "fr", fra: "fr", french: "fr" };

function langOf(raw: string | undefined): string {
	return LANG_NAMES[(raw ?? "").trim().toLowerCase()] ?? "en";
}

function downloadsOf(formats: readonly OtlFormat[] | undefined): ResourceDownload[] {
	const out: ResourceDownload[] = [];
	for (const f of formats ?? []) {
		const url = f.url?.trim();
		if (!url || !/^https:\/\//i.test(url)) continue;
		const label = `${f.format ?? ""} ${f.type ?? ""}`.toLowerCase();
		if (label.includes("pdf")) out.push({ format: "pdf", href: url });
		else if (label.includes("epub") || label.includes("ebook")) out.push({ format: "epub", href: url });
		else if (label.includes("online") || label.includes("html")) out.push({ format: "html", href: url });
	}
	return out;
}

/** OTL JSON book → Resource (undefined without id/title). */
export function mapOtlBook(b: OtlBook, fetchedAt: string): Resource | undefined {
	const id = b.id === undefined ? "" : String(b.id).trim();
	const title = b.title?.trim();
	if (!/^\d+$/.test(id) || !title) return undefined;
	const license = parseLicense(b.license);
	const creators = (b.contributors ?? []).map(contributorName).filter((s): s is string => Boolean(s));
	const landing = `${OTL_BASE}/textbooks/${id}`;
	const downloads = downloadsOf(b.formats);
	const year = Number(b.copyright_year);
	const isbn = firstText(b.ISBN13, b.isbn13);
	const r: Resource = {
		id: makeResourceId(P, id),
		provider: P,
		kind: "book",
		title,
		lang: langOf(b.language),
		license: { ...license, attribution: `${title}${creators.length ? ` — ${creators.join(", ")}` : ""} (Open Textbook Library), ${license.name}` },
		access: "open",
		tos: "open_license",
		locator: { kind: "url", href: landing },
		url: landing,
		subjects: (b.subjects ?? []).map((s) => (typeof s === "string" ? s : s.name ?? "")).filter(Boolean),
		fetchedAt,
	};
	if (creators.length) r.creators = creators;
	if (downloads.length) r.downloads = downloads;
	if (b.description?.trim()) r.description = b.description.trim();
	if (Number.isInteger(year) && year > 1900) r.year = year;
	if (isbn) r.isbn = [isbn];
	return r;
}

export interface OtlOptions extends ProviderDeps {
	maxPages?: number;
	subjectsByDomain?: Readonly<Record<string, readonly number[]>>;
}

export class OtlProvider implements ResourceProvider {
	readonly id = P;
	readonly label = "Open Textbook Library (livros abertos)";
	readonly tos = "open_license" as const;
	readonly kinds: Resource["kind"][] = ["book"];
	readonly rate = OTL_RATE;

	constructor(private readonly deps: OtlOptions) {}

	async status(): Promise<ProviderStatus> {
		return { available: true, reason: "Catálogo aberto da Open Textbook Library (licença por livro)." };
	}

	/** All books of one subject (paged, cached). */
	async subject(subjectId: number): Promise<Resource[]> {
		const at = isoNow(this.deps);
		const out: Resource[] = [];
		const seen = new Set<string>();
		const maxPages = this.deps.maxPages ?? OTL_MAX_PAGES;
		for (let page = 1; page <= maxPages; page++) {
			const books = booksOfOtlPage(await cachedJson<OtlPage>(this.deps, otlSubjectUrl(subjectId, page), P, CATALOG_TTL_MS));
			let fresh = 0;
			for (const b of books) {
				const r = mapOtlBook(b, at);
				if (!r || seen.has(r.id)) continue;
				seen.add(r.id);
				out.push(r);
				fresh++;
			}
			if (fresh === 0) break;
		}
		return out;
	}

	async search(q: ResourceQuery): Promise<Resource[]> {
		if (q.kinds && !q.kinds.includes("book")) return [];
		const subjects = (this.deps.subjectsByDomain ?? OTL_SUBJECTS_BY_DOMAIN)[q.domainId] ?? [];
		const books: Resource[] = [];
		const seen = new Set<string>();
		for (const s of subjects) {
			for (const b of await this.subject(s)) {
				if (seen.has(b.id)) continue;
				seen.add(b.id);
				books.push(b);
			}
		}
		return rankByMatch(books, q, (b) => ({ title: b.title, body: [...(b.subjects ?? []), b.description ?? ""].join(" ") })).slice(0, q.maxResults);
	}

	async resolve(id: string): Promise<Resource> {
		const parsed = idFor(P, P, id);
		const raw = await cachedJson<{ data?: OtlBook } & OtlBook>(this.deps, otlBookUrl(parsed.externalId), P, CATALOG_TTL_MS);
		const book = mapOtlBook(raw.data ?? raw, isoNow(this.deps));
		if (!book) throw new ResourceError(P, "not-found", "Livro não encontrado na Open Textbook Library.");
		return book;
	}
}

export function createOtlProvider(deps: OtlOptions): OtlProvider {
	return new OtlProvider(deps);
}
