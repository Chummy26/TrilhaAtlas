/**
 * OpenStax provider: catalog + structured TOC + section HTML (SÍNTESE §2.8
 * "OpenStax: JSON tree via rex/release.json; 70 títulos CC BY-NC-SA e 4 CC
 * BY"; r6 §9.2 OpenStax row, §10.1 T1 HTML).
 *
 *  catalog  CMS  /apps/cms/api/v2/pages/?type=books.Book&fields=…  (weekly cache)
 *  toc      /rex/release.json → archiveUrl + books[uuid].defaultVersion →
 *           {archiveUrl}/contents/{uuid}@{ver}.json → `tree` (titles carry
 *           os-number/os-text HTML: stripped) → TocEntry[] (href = page uuid)
 *  content  {archiveUrl}/contents/{uuid}@{ver}:{pageUuid}.json → `content`
 *           HTML → Markdown → 300–800-token chunks.
 * The license comes from the catalog (or the archive JSON) PER BOOK: most
 * live books are CC BY-NC-SA now, so their text is fetched at runtime for
 * personal study and never bundled (core license.ts `isBundleable`).
 * Ids: "openstax:<bookUuid>" and "openstax:<bookUuid>#<tocId>".
 */

import { makeResourceId, sectionResourceId } from "../../core/resources/ids.ts";
import { parseLicense } from "../../core/resources/license.ts";
import { rankByMatch } from "../../core/resources/match.ts";
import { buildToc, normalizeTocTitle, type RawTocNode } from "../../core/resources/toc.ts";
import { ResourceError, type ContentChunk, type ProviderStatus, type RateSpec, type Resource, type ResourceProvider, type ResourceQuery, type Span, type TocEntry } from "../../core/resources/types.ts";
import { CATALOG_TTL_MS } from "./cache.ts";
import { htmlToMarkdown } from "./html.ts";
import { cachedJson, firstText, idFor, isoNow, sectionChunks, tocSection, type ProviderDeps } from "./provider-kit.ts";

export const OPENSTAX_ORIGIN = "https://openstax.org";
export const OPENSTAX_CMS_URL = `${OPENSTAX_ORIGIN}/apps/cms/api/v2/pages/?type=books.Book&fields=title,book_state,license_name,license_url,cnx_id,webview_rex_link,high_resolution_pdf_url,low_resolution_pdf_url&limit=250`;
export const OPENSTAX_RELEASE_URL = `${OPENSTAX_ORIGIN}/rex/release.json`;
export const OPENSTAX_RATE: RateSpec = Object.freeze({ minIntervalMs: 500 });
const P = "openstax";

export interface OpenstaxCmsItem {
	id?: number;
	meta?: { slug?: string; html_url?: string };
	title?: string;
	book_state?: string;
	license_name?: string;
	license_url?: string;
	cnx_id?: string;
	webview_rex_link?: string;
	high_resolution_pdf_url?: string | null;
	low_resolution_pdf_url?: string | null;
}

export interface OpenstaxCmsResponse {
	items?: OpenstaxCmsItem[];
}

export interface OpenstaxRelease {
	archiveUrl?: string;
	books?: Record<string, { defaultVersion?: string; retired?: boolean }>;
}

export interface OpenstaxTreeNode {
	id?: string;
	title?: string;
	slug?: string;
	contents?: OpenstaxTreeNode[];
}

export interface OpenstaxArchiveBook {
	id?: string;
	title?: string;
	version?: string;
	license?: { name?: string; url?: string; version?: string };
	tree?: OpenstaxTreeNode;
}

const OFFERED_STATES = new Set(["live", "new_edition_available", "coming_soon"]);

/** CMS item → book Resource (undefined for retired/unknown books). */
export function mapCmsBook(item: OpenstaxCmsItem, fetchedAt: string): Resource | undefined {
	const uuid = item.cnx_id?.trim();
	if (!uuid || !/^[0-9a-f-]{36}$/i.test(uuid)) return undefined;
	if (item.book_state && !OFFERED_STATES.has(item.book_state)) return undefined;
	const title = normalizeTocTitle(item.title ?? "") || "(sem título)";
	const landing = firstText(item.webview_rex_link, item.meta?.html_url, item.meta?.slug ? `${OPENSTAX_ORIGIN}/details/books/${item.meta.slug}` : undefined);
	const license = { ...parseLicense(item.license_name, item.license_url ?? undefined), attribution: `${title} — OpenStax (Rice University), ${item.license_name ?? "licença na fonte"}` };
	const pdf = firstText(item.high_resolution_pdf_url, item.low_resolution_pdf_url);
	const r: Resource = {
		id: makeResourceId(P, uuid.toLowerCase()),
		provider: P,
		kind: "book",
		title,
		lang: "en",
		license,
		access: "open",
		tos: "open_license",
		locator: landing ? { kind: "url", href: landing } : { kind: "url", href: `${OPENSTAX_ORIGIN}/subjects` },
		creators: ["OpenStax"],
		fetchedAt,
	};
	if (landing) r.url = landing;
	if (pdf) r.downloads = [{ format: "pdf", href: pdf }];
	return r;
}

/** Archive `tree` → raw TOC nodes (leaves carry the page uuid in href). */
export function openstaxTreeToRaw(tree: OpenstaxTreeNode | undefined): RawTocNode[] {
	const convert = (n: OpenstaxTreeNode): RawTocNode => {
		const children = (n.contents ?? []).map(convert);
		const pageId = n.id?.split("@")[0];
		return { title: n.title ?? "", ...(children.length === 0 && pageId ? { href: pageId } : {}), ...(children.length ? { children } : {}) };
	};
	return (tree?.contents ?? []).map(convert);
}

export class OpenstaxProvider implements ResourceProvider {
	readonly id = P;
	readonly label = "OpenStax (livros abertos)";
	readonly tos = "open_license" as const;
	readonly kinds: Resource["kind"][] = ["book", "book_section"];
	readonly rate = OPENSTAX_RATE;

	constructor(private readonly deps: ProviderDeps) {}

	async status(): Promise<ProviderStatus> {
		return { available: true, reason: "Livros abertos da OpenStax (licença por livro; conteúdo NC só para estudo pessoal)." };
	}

	async catalog(): Promise<Resource[]> {
		const res = await cachedJson<OpenstaxCmsResponse>(this.deps, OPENSTAX_CMS_URL, P, CATALOG_TTL_MS);
		const at = isoNow(this.deps);
		return (res.items ?? []).flatMap((item) => {
			const r = mapCmsBook(item, at);
			return r ? [r] : [];
		});
	}

	async search(q: ResourceQuery): Promise<Resource[]> {
		if (q.kinds && !q.kinds.some((k) => k === "book" || k === "book_section")) return [];
		const books = await this.catalog();
		return rankByMatch(books, q, (b) => ({ title: b.title })).slice(0, q.maxResults);
	}

	async resolve(id: string): Promise<Resource> {
		const parsed = idFor(P, P, id);
		const book = (await this.catalog()).find((b) => b.id === parsed.baseId);
		if (!book) throw new ResourceError(P, "not-found", "Livro não encontrado no catálogo da OpenStax.");
		if (!parsed.sectionId) return book;
		const toc = await this.toc(parsed.baseId);
		const entry = tocSection(P, toc, parsed.sectionId);
		return { ...book, id: sectionResourceId(book.id, entry.id), kind: "book_section", title: `${book.title} — ${entry.title}`, parentId: book.id, sectionId: entry.id };
	}

	private async archive(uuid: string): Promise<{ base: string; version: string; book: OpenstaxArchiveBook }> {
		const release = await cachedJson<OpenstaxRelease>(this.deps, OPENSTAX_RELEASE_URL, P, CATALOG_TTL_MS);
		const archiveUrl = release.archiveUrl;
		const version = release.books?.[uuid]?.defaultVersion;
		if (!archiveUrl || !archiveUrl.startsWith("/apps/archive/")) throw new ResourceError(P, "bad-response", "release.json da OpenStax sem archiveUrl válido.");
		if (!version) throw new ResourceError(P, "not-found", "Livro sem versão publicada no release.json da OpenStax.");
		const base = `${OPENSTAX_ORIGIN}${archiveUrl}/contents/${uuid}@${version}`;
		const book = await cachedJson<OpenstaxArchiveBook>(this.deps, `${base}.json`, P, CATALOG_TTL_MS, { maxBytes: 16 * 1024 * 1024 });
		return { base, version, book };
	}

	async toc(id: string): Promise<TocEntry[]> {
		const uuid = idFor(P, P, id).externalId;
		const { book } = await this.archive(uuid);
		return buildToc(openstaxTreeToRaw(book.tree));
	}

	async content(id: string, span?: Span): Promise<ContentChunk[]> {
		const parsed = idFor(P, P, id);
		const sectionId = parsed.sectionId ?? span?.sectionId;
		if (!sectionId) throw new ResourceError(P, "invalid-input", "Informe a seção (sectionId) para ler conteúdo da OpenStax.");
		const { base, book } = await this.archive(parsed.externalId);
		const toc = buildToc(openstaxTreeToRaw(book.tree));
		const entry = tocSection(P, toc, sectionId);
		if (!entry.href) throw new ResourceError(P, "invalid-input", `A seção "${entry.title}" é um capítulo; escolha uma das páginas dele.`);
		const page = await cachedJson<{ content?: string }>(this.deps, `${base}:${entry.href}.json`, P, CATALOG_TTL_MS);
		const markdown = htmlToMarkdown(page.content ?? "");
		return sectionChunks(sectionResourceId(parsed.baseId, entry.id), toc, entry, markdown, { sectionId: entry.id });
	}
}

export function createOpenstaxProvider(deps: ProviderDeps): OpenstaxProvider {
	return new OpenstaxProvider(deps);
}
