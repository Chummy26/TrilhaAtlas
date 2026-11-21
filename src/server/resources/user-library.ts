/**
 * The learner's own library: import of PDF/EPUB files the user already owns
 * (or open books downloaded from an allowlisted official source) into
 * `<library>/<sha256>/` — SÍNTESE §2.8 "Protegidos: … o PDF que o usuário já
 * possui (importado localmente, nunca redistribuído)", "Ingestão em camadas"
 * and "Sumário em cascata"; r6 §10–§12; extra-unjs__unpdf §5.2–5.5.
 *
 * Layout per item (content-addressed, so re-importing is a no-op):
 *   original.pdf | original.epub   the file, byte-for-byte
 *   toc.json                        TocEntry[] (+ source)
 *   chunks.jsonl                    ContentChunk per line (300–800 tokens)
 *   meta.json                       LibraryItemMeta — written LAST: an item
 *                                   without it is an interrupted import and
 *                                   is redone.
 *
 * PDF (pdfjs-dist legacy build, the engine the app already ships):
 *   - the bytes are COPIED into a plain Uint8Array before pdfjs (it detaches
 *     the buffer it gets and rejects Node Buffers);
 *   - outline → destinations: a string dest goes through getDestination, the
 *     page ref through getPageIndex(ref)+1 (a numeric ref is a 0-based
 *     index); an XYZ destination whose top is below the upper 10% of the page
 *     marks a mid-page start (shared page in core toc.ts);
 *   - /PageLabels fill `pageLabel` (printed numbers ≠ physical pages);
 *   - no outline → fixed 10-page windows (TocSource "page-window");
 *   - text: pdfjs text items per page → lines (a new line when the baseline
 *     moves, a blank line on a gap > 1.8× the font height), joined per TOC
 *     unit (core `tocUnits`, depth ≤ 2) and chunked with breadcrumb + span
 *     {pages, sectionId}. Own small extractor instead of the agent's
 *     pdf-markdown (that one needs ES2023 lib and lives in another module);
 *     pages without text (scans) are reported in `warnings` (no OCR here).
 * EPUB (own ZIP reader, linkedom + turndown — no fflate):
 *   container.xml → OPF (metadata, manifest, spine) → nav document
 *   (`properties="nav"`, epub:type="toc") or NCX → TOC; spine XHTML →
 *   Markdown. A spine document belongs to the first TOC entry that points
 *   into it; unreferenced documents continue the previous entry (split
 *   chapters) and front matter before any entry is book-level. Without nav
 *   and NCX the spine itself is the TOC (TocSource "spine").
 * Metadata: PDF Info (Title/Author) or OPF dc:*; ISBN by checksum-validated
 * regex over the first/last pages; language by core `guessLanguage`.
 * The provider ("user-library", ids "lib:<sha256>[#<tocId>]") serves these
 * items to the registry with tos/access "user_owned".
 */

import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { chunkSection } from "../../core/resources/chunking.ts";
import { makeResourceId, sectionResourceId } from "../../core/resources/ids.ts";
import { guessLanguage, rankByMatch } from "../../core/resources/match.ts";
import { buildToc, normalizeTocTitle, pageWindowToc, tocBreadcrumb, tocUnits, type RawTocNode } from "../../core/resources/toc.ts";
import { ResourceError, type ContentChunk, type License, type ProviderStatus, type RateSpec, type Resource, type ResourceProvider, type ResourceQuery, type Span, type TocEntry, type TocSource } from "../../core/resources/types.ts";
import { writeFileAtomicSync } from "../../store/atomic-write.ts";
import { createBookPageCache } from "./book-page-cache.ts";
import { firstByLocalName, elementsByLocalName, htmlToMarkdown, parseXml } from "./html.ts";
import { normalizeIsbn } from "./openlibrary.ts";
import { idFor } from "./provider-kit.ts";
import type { ResourceFetch } from "./safe-fetch.ts";
import { ZipError, ZipReader, resolveZipPath } from "./zip.ts";

const P = "user-library";
const PREFIX = "lib";
export const LIBRARY_RATE: RateSpec = Object.freeze({ minIntervalMs: 0 });
export const MAX_IMPORT_BYTES = 300 * 1024 * 1024;
export const PAGE_WINDOW_SIZE = 10;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type LibraryFormat = "pdf" | "epub";

export interface LibraryItemMeta {
	schemaVersion: 1;
	sha256: string;
	format: LibraryFormat;
	/** Original file name (local only, never sent anywhere). */
	fileName: string;
	/** Stored file inside the item directory. */
	file: string;
	bytes: number;
	title: string;
	creators: string[];
	lang: string;
	numPages?: number;
	isbn?: string;
	tocSource: TocSource;
	license: License;
	origin: { kind: "upload" } | { kind: "url"; href: string };
	importedAt: string;
	chunkCount: number;
	/** pt-BR notes about the import (scanned pages, missing TOC…). */
	warnings: string[];
}

export interface ImportedBook {
	meta: LibraryItemMeta;
	toc: TocEntry[];
	/** True when the same bytes were already in the library. */
	deduplicated: boolean;
}

export interface ImportBookInput {
	bytes: Uint8Array;
	fileName: string;
	libraryRoot: string;
	/** Overrides the title read from the file. */
	title?: string;
	/** Defaults to "the user's personal copy" (protected). */
	license?: License;
	origin?: LibraryItemMeta["origin"];
	now?: () => number;
	signal?: AbortSignal;
}

const PERSONAL_COPY: License = Object.freeze({ name: "Cópia pessoal do usuário (uso privado, não redistribuir)", proprietary: true });

// ---------------------------------------------------------------- helpers

export function sha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/** `<root>/<sha256>` (validated: never escapes the root). */
export function libraryItemDir(root: string, sha256: string): string {
	if (!SHA256_PATTERN.test(sha256)) throw new ResourceError(P, "invalid-input", `Identificador de arquivo inválido: "${sha256}".`);
	return path.join(root, sha256);
}

/** "%PDF-" → pdf; ZIP with `mimetype` = application/epub+zip → epub. */
export function detectFormat(bytes: Uint8Array): LibraryFormat | undefined {
	const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
	if (head.includes("%PDF-")) return "pdf";
	if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04 && head.includes("application/epub+zip")) return "epub";
	return undefined;
}

function isbn13Valid(s: string): boolean {
	const sum = [...s].reduce((acc, ch, i) => acc + Number(ch) * (i % 2 === 0 ? 1 : 3), 0);
	return sum % 10 === 0;
}

function isbn10Valid(s: string): boolean {
	const sum = [...s].reduce((acc, ch, i) => acc + (ch === "X" ? 10 : Number(ch)) * (10 - i), 0);
	return sum % 11 === 0;
}

/** First checksum-valid ISBN-13/10 after an "ISBN" marker. */
export function extractIsbn(text: string): string | undefined {
	for (const m of text.matchAll(/ISBN(?:-1[03])?\s*[:：]?\s*((?:97[89][\s-]?)?[0-9][0-9\s-]{7,14}[0-9Xx])/g)) {
		const isbn = normalizeIsbn(m[1] ?? "");
		if (!isbn) continue;
		if (isbn.length === 13 ? isbn13Valid(isbn) : isbn10Valid(isbn)) return isbn;
	}
	return undefined;
}

function baseTitle(fileName: string): string {
	return normalizeTocTitle(path.basename(fileName).replace(/\.(pdf|epub)$/i, "").replace(/[_]+/g, " ")) || "Documento sem título";
}

function splitCreators(raw: string | undefined): string[] {
	return (raw ?? "").split(/\s*(?:;|&|\band\b|\be\b)\s*/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
}

/** Sleep without spinning (the rename retry below is synchronous). */
function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Write a binary file atomically (temp + rename). Content-addressed: when the
 * target already holds these exact bytes (an interrupted import being redone)
 * nothing is written, so a viewer holding the original open cannot make the
 * re-import fail. The temp name is unique (UUID, "wx"); on Windows the rename
 * is retried for ~100 ms while a scanner/indexer holds the fresh temp or the
 * target (EPERM/EACCES/EBUSY), like src/store/atomic-write.ts. Cleanup uses
 * unlinkSync: fs.rmSync silently skips non-ASCII paths on Windows.
 */
export function writeBinaryAtomic(file: string, bytes: Uint8Array): void {
	const existing = fs.statSync(file, { throwIfNoEntry: false });
	if (existing?.isFile() && existing.size === bytes.byteLength && sha256Hex(fs.readFileSync(file)) === sha256Hex(bytes)) return;
	const tmp = `${file}.tmp-${randomUUID()}`;
	try {
		const fd = fs.openSync(tmp, "wx");
		try {
			fs.writeFileSync(fd, bytes);
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
		const deadline = Date.now() + 100;
		for (let delay = 5; ; delay = Math.min(delay * 2, 40)) {
			try {
				fs.renameSync(tmp, file);
				return;
			} catch (err) {
				const code = (err as NodeJS.ErrnoException).code;
				const retriable = process.platform === "win32" && (code === "EPERM" || code === "EACCES" || code === "EBUSY");
				if (!retriable || Date.now() >= deadline) throw err;
				sleepSync(delay);
			}
		}
	} catch (err) {
		try {
			fs.unlinkSync(tmp);
		} catch {
			// Already gone (or never created): nothing to clean.
		}
		throw err;
	}
}

/** Recursive delete that also works for non-ASCII paths on Windows (fs.rmSync skips them silently). */
function removeTreeSync(target: string): void {
	const stat = fs.lstatSync(target, { throwIfNoEntry: false });
	if (!stat) return;
	if (stat.isDirectory()) {
		for (const name of fs.readdirSync(target)) removeTreeSync(path.join(target, name));
		fs.rmdirSync(target);
	} else {
		fs.unlinkSync(target);
	}
}

interface Extracted {
	physicalPages?: Map<number, string>;
	title?: string;
	creators: string[];
	lang: string;
	numPages?: number;
	isbn?: string;
	toc: TocEntry[];
	tocSource: TocSource;
	/** Markdown per TOC unit (sectionId undefined = book-level). */
	sections: Array<{ entry?: TocEntry; text: string; span?: Span }>;
	warnings: string[];
}

// ---------------------------------------------------------------- PDF

interface OutlineNode {
	title: string;
	dest: string | unknown[] | null;
	items: OutlineNode[];
}

async function destinationOf(doc: PDFDocumentProxy, dest: OutlineNode["dest"]): Promise<{ page: number | null; mid: boolean }> {
	let explicit: unknown[] | null = null;
	try {
		explicit = typeof dest === "string" ? ((await doc.getDestination(dest)) as unknown[] | null) : dest;
	} catch {
		return { page: null, mid: false };
	}
	if (!Array.isArray(explicit) || explicit.length === 0) return { page: null, mid: false };
	const ref = explicit[0];
	let page: number | null = null;
	try {
		if (typeof ref === "number" && Number.isInteger(ref)) page = ref + 1;
		else if (ref && typeof ref === "object") page = (await doc.getPageIndex(ref as Parameters<PDFDocumentProxy["getPageIndex"]>[0])) + 1;
	} catch {
		page = null;
	}
	if (page === null || page < 1 || page > doc.numPages) return { page: null, mid: false };
	const kind = (explicit[1] as { name?: string } | undefined)?.name;
	const top = explicit[3];
	let mid = false;
	if (kind === "XYZ" && typeof top === "number") {
		const view = (await doc.getPage(page)).view;
		const [, y0, , y1] = view as [number, number, number, number];
		mid = top < y1 - 0.1 * (y1 - y0);
	}
	return { page, mid };
}

async function outlineToRaw(doc: PDFDocumentProxy, nodes: readonly OutlineNode[]): Promise<RawTocNode[]> {
	const out: RawTocNode[] = [];
	for (const n of nodes) {
		const { page, mid } = await destinationOf(doc, n.dest);
		const children = await outlineToRaw(doc, n.items ?? []);
		out.push({ title: n.title, page, ...(mid ? { startsMidPage: true } : {}), ...(children.length ? { children } : {}) });
	}
	return out;
}

/** pdfjs standard-font directory. pdfjs checks `endsWith("/")` even on
 *  Windows, so the separator is a literal "/" (same rule as the app's
 *  pdf-reader). */
export function pdfStandardFontsDir(): string {
	return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "node_modules", "pdfjs-dist", "standard_fonts") + "/";
}

interface TextItemLike {
	str?: string;
	hasEOL?: boolean;
	height?: number;
	transform?: number[];
}

const NL = "\n";

/** Text items of one page → plain text lines and paragraphs. */
export function textFromItems(items: readonly TextItemLike[]): string {
	let out = "";
	let lastY: number | undefined;
	let lastH = 0;
	for (const item of items) {
		if (typeof item.str !== "string") continue;
		const y = item.transform?.[5] ?? lastY ?? 0;
		const h = Math.abs(item.transform?.[3] ?? 0) || item.height || 10;
		if (lastY !== undefined && out) {
			const dy = Math.abs(lastY - y);
			if (dy > Math.max(h, lastH) * 0.5 && !out.endsWith(NL)) out += NL;
			if (dy > Math.max(h, lastH) * 1.8 && !out.endsWith(NL + NL)) out += NL;
		}
		out += item.str;
		if (item.hasEOL && !out.endsWith(NL)) out += NL;
		lastY = y;
		lastH = h;
	}
	return out.replace(/[ \t]+\n/g, NL).replace(/\n{3,}/g, NL + NL).trim();
}

async function pageTexts(doc: PDFDocumentProxy, signal?: AbortSignal): Promise<Map<number, string>> {
	const out = new Map<number, string>();
	for (let n = 1; n <= doc.numPages; n++) {
		signal?.throwIfAborted();
		const page = await doc.getPage(n);
		const content = await page.getTextContent();
		const text = textFromItems(content.items as TextItemLike[]);
		if (text) out.set(n, text);
		page.cleanup();
	}
	return out;
}

async function extractPdf(bytes: Uint8Array, signal?: AbortSignal): Promise<Extracted> {
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	// pdfjs takes ownership of (detaches) the buffer it receives: give it a
	// COPY that is a plain Uint8Array. `bytes.slice()` was wrong for a Node
	// Buffer (the Electron/IPC path): Buffer#slice is a VIEW of the same — often
	// pooled — memory, and pdfjs rejects Buffer data outright.
	const task = pdfjs.getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: pdfStandardFontsDir(), verbosity: 0 });
	try {
		const doc = await task.promise;
		signal?.throwIfAborted();
		const numPages = doc.numPages;
		const info = ((await doc.getMetadata().catch(() => ({ info: {} }))).info ?? {}) as Record<string, unknown>;
		const outline = ((await doc.getOutline().catch(() => null)) ?? []) as unknown as OutlineNode[];
		const labels = await doc.getPageLabels().catch(() => null);
		const warnings: string[] = [];

		const raw = outline.length ? await outlineToRaw(doc, outline) : [];
		let toc = raw.length ? buildToc(raw, numPages) : [];
		let tocSource: TocSource = "pdf-outline";
		if (!toc.some((e) => e.pageFrom !== undefined)) {
			if (raw.length) warnings.push("O sumário do PDF não aponta para páginas; usei janelas de 10 páginas.");
			else warnings.push("O PDF não tem sumário (outline); usei janelas de 10 páginas. Você pode corrigir o sumário depois.");
			toc = pageWindowToc(numPages, PAGE_WINDOW_SIZE);
			tocSource = "page-window";
		}
		if (labels) {
			for (const e of toc) {
				const label = e.pageFrom !== undefined ? labels[e.pageFrom - 1] : undefined;
				if (label && !e.pageLabel) e.pageLabel = label;
			}
		}

		const textOf = await pageTexts(doc, signal);
		const blank = numPages - textOf.size;
		if (blank > 0 && textOf.size > 0) warnings.push(`${blank} página(s) sem camada de texto (figuras ou digitalizadas): o texto delas não foi extraído.`);

		const sections: Extracted["sections"] = [];
		const units = tocUnits(toc).filter((e) => e.pageFrom !== undefined && e.pageTo !== undefined);
		const covered = new Set<number>();
		for (const e of units) {
			const parts: string[] = [];
			for (let n = e.pageFrom!; n <= e.pageTo!; n++) {
				covered.add(n);
				const t = textOf.get(n);
				if (t) parts.push(t);
			}
			sections.push({ entry: e, text: parts.join("\n\n"), span: { pages: e.pageFrom === e.pageTo ? `${e.pageFrom}` : `${e.pageFrom}-${e.pageTo}`, sectionId: e.id } });
		}
		// Pages outside every unit (front/back matter): book-level text, one section per contiguous run.
		const loose = [...textOf.keys()].filter((n) => !covered.has(n)).sort((a, b) => a - b);
		const runs: number[][] = [];
		for (const n of loose) {
			const run = runs[runs.length - 1];
			if (run && run[run.length - 1] === n - 1) run.push(n);
			else runs.push([n]);
		}
		for (const run of runs.reverse()) {
			const from = run[0]!;
			const to = run[run.length - 1]!;
			sections.unshift({ text: run.map((n) => textOf.get(n) ?? "").join("\n\n"), span: { pages: from === to ? `${from}` : `${from}-${to}` } });
		}

		const edgeText = [...textOf.entries()].filter(([n]) => n <= 6 || n > numPages - 4).map(([, t]) => t).join("\n");
		const allText = [...textOf.values()].slice(0, 30).join("\n");
		const isbn = extractIsbn(edgeText);
		const title = typeof info.Title === "string" ? normalizeTocTitle(info.Title) : undefined;
		return {
			...(title ? { title } : {}),
			creators: splitCreators(typeof info.Author === "string" ? info.Author : undefined),
			lang: guessLanguage(allText),
			physicalPages: textOf,
			numPages,
			...(isbn ? { isbn } : {}),
			toc,
			tocSource,
			sections,
			warnings,
		};
	} finally {
		await task.destroy();
	}
}

// ---------------------------------------------------------------- EPUB

interface ManifestItem {
	id: string;
	href: string;
	mediaType: string;
	properties: string;
}

function attr(el: Element, name: string): string {
	return el.getAttribute(name) ?? "";
}

/** nav document (XHTML) → raw TOC (hrefs resolved to zip paths, fragments kept). */
export function epubNavToRaw(xhtml: string, navPath: string): RawTocNode[] {
	const { document } = parseHTML(xhtml);
	const navs = [...document.querySelectorAll("nav")];
	const nav = navs.find((n) => /\btoc\b/.test(n.getAttribute("epub:type") ?? n.getAttribute("role") ?? "")) ?? navs[0];
	const ol = nav?.querySelector("ol");
	if (!ol) return [];
	const walk = (list: Element): RawTocNode[] =>
		[...list.children]
			.filter((li) => li.tagName.toLowerCase() === "li")
			.map((li) => {
				const label = [...li.children].find((c) => /^(a|span)$/i.test(c.tagName));
				const href = label?.getAttribute("href") ?? "";
				const sub = [...li.children].find((c) => c.tagName.toLowerCase() === "ol");
				const children = sub ? walk(sub) : [];
				const fragment = href.includes("#") ? `#${href.split("#")[1]}` : "";
				return {
					title: (label?.textContent ?? "").replace(/\s+/g, " ").trim(),
					...(href ? { href: `${resolveZipPath(navPath, href)}${fragment}` } : {}),
					...(children.length ? { children } : {}),
				};
			})
			.filter((n) => n.title || n.children);
	return walk(ol);
}

/** NCX → raw TOC. */
export function epubNcxToRaw(xml: string, ncxPath: string): RawTocNode[] {
	const doc = parseXml(xml);
	const navMap = firstByLocalName(doc, "navMap");
	if (!navMap) return [];
	const walk = (el: Element): RawTocNode[] =>
		[...el.children]
			.filter((c) => (c.localName ?? c.tagName).toLowerCase().replace(/^.*:/, "") === "navpoint")
			.map((np) => {
				const label = firstByLocalName(np, "text")?.textContent ?? "";
				const src = firstByLocalName(np, "content")?.getAttribute("src") ?? "";
				const fragment = src.includes("#") ? `#${src.split("#")[1]}` : "";
				const children = walk(np);
				return {
					title: label.replace(/\s+/g, " ").trim(),
					...(src ? { href: `${resolveZipPath(ncxPath, src)}${fragment}` } : {}),
					...(children.length ? { children } : {}),
				};
			});
	return walk(navMap);
}

function extractEpub(bytes: Uint8Array): Extracted {
	let zip: ZipReader;
	try {
		zip = new ZipReader(bytes);
	} catch (err) {
		throw new ResourceError(P, "invalid-input", `EPUB ilegível: ${err instanceof Error ? err.message : String(err)}`);
	}
	const warnings: string[] = [];
	try {
		const container = parseXml(zip.readText("META-INF/container.xml"));
		const opfPath = firstByLocalName(container, "rootfile")?.getAttribute("full-path") ?? "";
		if (!opfPath || !zip.has(opfPath)) throw new ResourceError(P, "invalid-input", "EPUB sem pacote OPF.");
		const opf = parseXml(zip.readText(opfPath));
		const title = normalizeTocTitle(firstByLocalName(opf, "title")?.textContent ?? "");
		const creators = elementsByLocalName(opf, "creator").map((c) => (c.textContent ?? "").trim()).filter(Boolean);
		const declaredLang = (firstByLocalName(opf, "language")?.textContent ?? "").trim().slice(0, 2).toLowerCase();
		const isbn = elementsByLocalName(opf, "identifier").map((i) => normalizeIsbn((i.textContent ?? "").replace(/^urn:isbn:/i, ""))).find((x): x is string => Boolean(x));

		const manifest = new Map<string, ManifestItem>();
		for (const item of elementsByLocalName(opf, "item")) {
			const id = attr(item, "id");
			if (!id) continue;
			manifest.set(id, { id, href: resolveZipPath(opfPath, attr(item, "href")), mediaType: attr(item, "media-type"), properties: attr(item, "properties") });
		}
		const spineEl = firstByLocalName(opf, "spine");
		const spine = elementsByLocalName(opf, "itemref")
			.filter((r) => attr(r, "linear") !== "no")
			.map((r) => manifest.get(attr(r, "idref")))
			.filter((m): m is ManifestItem => Boolean(m && zip.has(m.href) && /html|xml/.test(m.mediaType)));
		if (spine.length === 0) throw new ResourceError(P, "invalid-input", "EPUB sem documentos no spine.");

		let raw: RawTocNode[] = [];
		let tocSource: TocSource = "spine";
		const nav = [...manifest.values()].find((m) => /\bnav\b/.test(m.properties));
		if (nav && zip.has(nav.href)) {
			raw = epubNavToRaw(zip.readText(nav.href), nav.href);
			if (raw.length) tocSource = "epub-nav";
		}
		if (!raw.length) {
			const ncxId = spineEl?.getAttribute("toc") ?? "";
			const ncx = manifest.get(ncxId) ?? [...manifest.values()].find((m) => m.mediaType === "application/x-dtbncx+xml");
			if (ncx && zip.has(ncx.href)) {
				raw = epubNcxToRaw(zip.readText(ncx.href), ncx.href);
				if (raw.length) tocSource = "epub-ncx";
			}
		}
		const markdownOf = new Map<string, string>();
		for (const doc of spine) markdownOf.set(doc.href, htmlToMarkdown(zip.readText(doc.href)));
		if (!raw.length) {
			warnings.push("O EPUB não tem sumário (nav/NCX); usei a ordem dos capítulos.");
			raw = spine.map((doc, i) => {
				const heading = (markdownOf.get(doc.href) ?? "").match(/^#{1,3}\s+(.+)$/m)?.[1];
				return { title: heading ? normalizeTocTitle(heading) : `Parte ${i + 1}`, href: doc.href };
			});
		}
		const toc = buildToc(raw);

		// Spine document → first TOC entry pointing into it (pre-order).
		const ownerOf = new Map<string, TocEntry>();
		for (const e of toc) {
			const file = e.href?.split("#")[0];
			if (file && !ownerOf.has(file)) ownerOf.set(file, e);
		}
		const grouped = new Map<string | undefined, { entry?: TocEntry; parts: string[] }>();
		let current: TocEntry | undefined;
		for (const doc of spine) {
			current = ownerOf.get(doc.href) ?? current;
			const key = current?.id;
			const group = grouped.get(key) ?? { ...(current ? { entry: current } : {}), parts: [] };
			group.parts.push(markdownOf.get(doc.href) ?? "");
			grouped.set(key, group);
		}
		const sections = [...grouped.values()].map((g) => ({ ...(g.entry ? { entry: g.entry, span: { sectionId: g.entry.id } } : {}), text: g.parts.filter(Boolean).join("\n\n") }));
		const lang = /^[a-z]{2}$/.test(declaredLang) ? declaredLang : guessLanguage([...markdownOf.values()].slice(0, 5).join("\n"));
		return { ...(title ? { title } : {}), creators, lang, ...(isbn ? { isbn } : {}), toc, tocSource, sections, warnings };
	} catch (err) {
		if (err instanceof ResourceError) throw err;
		if (err instanceof ZipError) throw new ResourceError(P, "invalid-input", `EPUB ilegível: ${err.message}`);
		throw err;
	}
}

/** Older library items have the original but no page-level search text. */
export async function physicalPdfPages(root: string, sha: string): Promise<[number, string][]> {
	const dir = libraryItemDir(root, sha);
	const file = path.join(dir, "physical-pages.json");
	if (fs.existsSync(file)) return JSON.parse(await fs.promises.readFile(file, "utf8"));
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	const bytes = await fs.promises.readFile(path.join(dir, "original.pdf"));
	const task = pdfjs.getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: pdfStandardFontsDir(), verbosity: 0 });
	try {
		const pages = [...await pageTexts(await task.promise)];
		writeFileAtomicSync(file, JSON.stringify(pages));
		return pages;
	} finally { await task.destroy(); }
}

type PdfPageExtract = {
	text: string;
	total: number;
	layout: {
		width: number;
		height: number;
		lines: Array<{ text: string; transform: string; width: number }>;
	};
};

type CachedEpubSections = {
	sections: Array<{ heading: string; text: string }>;
};

type PooledPdfHandle = {
	key: string;
	file: string;
	promise: Promise<{ doc: PDFDocumentProxy; destroy: () => Promise<void> }>;
	timer: ReturnType<typeof setTimeout>;
	activeUsers: number;
	pendingDestroy: boolean;
	destroyed: boolean;
};

type UserLibraryGlobalState = {
	metaCache: Map<string, { stamp: string; meta: LibraryItemMeta }>;
	tocCache: Map<string, { stamp: string; toc: TocEntry[] }>;
	pdfTextCache: ReturnType<typeof createBookPageCache<PdfPageExtract>>;
	epubCache: ReturnType<typeof createBookPageCache<CachedEpubSections>>;
	pdfPool: Map<string, PooledPdfHandle>;
};

const USER_LIBRARY_STATE_KEY = Symbol.for("learnharness.resources.userLibrary");
const MAX_LIBRARY_META_CACHE = 512;
const MAX_LIBRARY_TOC_CACHE = 256;
const MAX_OPEN_PDF_HANDLES = 2;
const PDF_HANDLE_IDLE_TTL_MS = 30_000;

function libraryState(): UserLibraryGlobalState {
	const g = globalThis as typeof globalThis & { [USER_LIBRARY_STATE_KEY]?: UserLibraryGlobalState };
	if (!g[USER_LIBRARY_STATE_KEY]) {
		g[USER_LIBRARY_STATE_KEY] = {
			metaCache: new Map(),
			tocCache: new Map(),
			pdfTextCache: createBookPageCache<PdfPageExtract>(4 * 1024 * 1024, page =>
				2 * page.text.length + page.layout.lines.reduce((bytes, line) => bytes + 96 + 2 * (line.text.length + line.transform.length), 0)),
			epubCache: createBookPageCache<CachedEpubSections>(16 * 1024 * 1024, book =>
				book.sections.reduce((bytes, sec) => bytes + 64 + 2 * (sec.heading.length + sec.text.length), 0)),
			pdfPool: new Map(),
		};
	}
	return g[USER_LIBRARY_STATE_KEY];
}

function libStatStamp(file: string): string | null {
	const stat = fs.statSync(/* turbopackIgnore: true */ file, { bigint: true, throwIfNoEntry: false });
	if (!stat || !stat.isFile()) return null;
	return `${stat.dev}|${stat.ino}|${stat.ctimeNs}|${stat.mtimeNs}|${stat.size}`;
}

function destroyPooledPdf(entry: PooledPdfHandle): void {
	if (entry.destroyed) return;
	entry.destroyed = true;
	clearTimeout(entry.timer);
	void entry.promise.then((opened) => opened.destroy()).catch(() => {});
}

function evictPooledPdf(pool: Map<string, PooledPdfHandle>, key: string): void {
	const entry = pool.get(key);
	if (!entry) return;
	pool.delete(key);
	clearTimeout(entry.timer);
	entry.pendingDestroy = true;
	if (entry.activeUsers <= 0) destroyPooledPdf(entry);
}

function evictPooledPdfByFile(file: string): void {
	const resolved = path.resolve(file);
	const pool = libraryState().pdfPool;
	for (const [key, entry] of [...pool.entries()]) {
		if (entry.file === resolved) evictPooledPdf(pool, key);
	}
}

function resetPoolTimer(pool: Map<string, PooledPdfHandle>, entry: PooledPdfHandle): void {
	clearTimeout(entry.timer);
	entry.timer = setTimeout(() => {
		evictPooledPdf(pool, entry.key);
	}, PDF_HANDLE_IDLE_TTL_MS);
	entry.timer.unref();
}

async function withPooledPdfDoc<T>(file: string, fn: (doc: PDFDocumentProxy) => Promise<T>): Promise<T> {
	const resolved = path.resolve(file);
	const stat = await fs.promises.stat(resolved, { bigint: true });
	const key = `${resolved}|${stat.dev}|${stat.ino}|${stat.size}|${stat.mtimeNs}|${stat.ctimeNs}`;
	const pool = libraryState().pdfPool;
	let entry = pool.get(key);
	if (entry) {
		// Refresh LRU position.
		pool.delete(key);
		pool.set(key, entry);
		resetPoolTimer(pool, entry);
	} else {
		// Evict stale revisions of the same file first.
		for (const [existingKey, existing] of [...pool.entries()]) {
			if (existing.file === resolved) evictPooledPdf(pool, existingKey);
		}
		while (pool.size >= MAX_OPEN_PDF_HANDLES) {
			const oldestKey = pool.keys().next().value;
			if (oldestKey === undefined) break;
			evictPooledPdf(pool, oldestKey);
		}
		const promise = (async () => {
			const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
			const bytes = await fs.promises.readFile(resolved);
			const task = pdfjs.getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: pdfStandardFontsDir(), verbosity: 0 });
			try {
				const doc = await task.promise;
				return { doc, destroy: () => task.destroy().catch(() => {}) };
			} catch (err) {
				await task.destroy().catch(() => {});
				throw err;
			}
		})();
		entry = {
			key,
			file: resolved,
			promise,
			timer: setTimeout(() => {}, PDF_HANDLE_IDLE_TTL_MS),
			activeUsers: 0,
			pendingDestroy: false,
			destroyed: false,
		};
		resetPoolTimer(pool, entry);
		pool.set(key, entry);
		promise.catch(() => {
			if (pool.get(key) === entry) pool.delete(key);
			clearTimeout(entry!.timer);
		});
	}
	entry.activeUsers++;
	try {
		const { doc } = await entry.promise;
		return await fn(doc);
	} finally {
		entry.activeUsers--;
		if (entry.pendingDestroy && entry.activeUsers <= 0) {
			destroyPooledPdf(entry);
		} else if (!entry.pendingDestroy && pool.get(key) === entry) {
			resetPoolTimer(pool, entry);
		}
	}
}

/** Read from the original, since retrieval chunks can overlap and span pages. */
export async function readBookUnit(root: string, sha: string, unit: number, withLayout = false) {
	const item = readLibraryItem(root, sha);
	if (!item || !Number.isSafeInteger(unit) || unit < 1) return;
	const dir = libraryItemDir(root, sha);
	const { meta, toc } = item;
	if (meta.format === "epub") {
		const epubFile = path.join(dir, "original.epub");
		const book = await libraryState().epubCache(epubFile, 0, async () => {
			const extracted = extractEpub(await fs.promises.readFile(epubFile));
			return {
				sections: extracted.sections.map((s) => ({
					heading: s.entry?.title ?? "Abertura",
					text: s.text,
				})),
			};
		});
		const section = book.sections[unit - 1];
		if (!section) return;
		return { title: meta.title, format: meta.format, unit, total: book.sections.length,
			heading: section.heading, text: section.text };
	}
	if (unit > (meta.numPages ?? 0)) return;
	const file = path.join(dir, "original.pdf");
	const page = await libraryState().pdfTextCache(file, unit, () => extractPdfPage(file, unit));
	const section = toc.findLast(e => (e.pageFrom ?? Infinity) <= unit && (e.pageTo ?? Infinity) >= unit);
	return { title: meta.title, format: meta.format, unit, total: page.total, heading: section?.title ?? "",
		text: page.text, layout: withLayout ? structuredClone(page.layout) : undefined };
}

async function extractPdfPage(file: string, unit: number): Promise<PdfPageExtract> {
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	return withPooledPdfDoc(file, async (doc) => {
		const page = await doc.getPage(unit);
		try {
			const content = await page.getTextContent();
			const text = textFromItems(content.items as TextItemLike[]);
			const viewport = page.getViewport({ scale: 1 });
			const layout = { width: viewport.width, height: viewport.height,
				lines: content.items.flatMap(item => {
					if (!("str" in item) || !item.str.trim()) return [];
					const [a, b, c, d, x, y] = pdfjs.Util.transform(viewport.transform, item.transform) as [number, number, number, number, number, number];
					const advance = Math.hypot(a, b);
					if (!advance) return [];
					return [{ text: item.str, transform: `matrix(${a} ${b} ${-c} ${-d} ${x} ${y})`, width: item.width / advance }];
				}),
			};
			return { text, total: doc.numPages, layout };
		} finally {
			page.cleanup();
		}
	});
}

// ---------------------------------------------------------------- store

function readJson<T>(file: string): T | undefined {
	try {
		return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
	} catch {
		return undefined;
	}
}

function readLibraryMeta(root: string, sha256: string): LibraryItemMeta | undefined {
	const dir = libraryItemDir(root, sha256);
	const file = path.resolve(dir, "meta.json");
	const cache = libraryState().metaCache;
	const stamp = libStatStamp(file);
	if (!stamp) {
		cache.delete(file);
		return undefined;
	}
	const cached = cache.get(file);
	if (cached && cached.stamp === stamp) return structuredClone(cached.meta);
	const meta = readJson<LibraryItemMeta>(file);
	if (!meta || meta.schemaVersion !== 1) return undefined;
	if (cache.size >= MAX_LIBRARY_META_CACHE && !cache.has(file)) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	cache.set(file, { stamp, meta });
	return structuredClone(meta);
}

function readLibraryToc(dir: string): TocEntry[] {
	const file = path.resolve(dir, "toc.json");
	const cache = libraryState().tocCache;
	const stamp = libStatStamp(file);
	if (!stamp) {
		cache.delete(file);
		return [];
	}
	const cached = cache.get(file);
	if (cached && cached.stamp === stamp) return structuredClone(cached.toc);
	const toc = readJson<{ entries?: TocEntry[] }>(file)?.entries ?? [];
	if (cache.size >= MAX_LIBRARY_TOC_CACHE && !cache.has(file)) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	cache.set(file, { stamp, toc });
	return structuredClone(toc);
}

/** Meta + TOC of an imported item (undefined when absent or incomplete). */
export function readLibraryItem(root: string, sha256: string): { meta: LibraryItemMeta; toc: TocEntry[] } | undefined {
	const meta = readLibraryMeta(root, sha256);
	if (!meta) return undefined;
	const dir = libraryItemDir(root, sha256);
	const toc = readLibraryToc(dir);
	return { meta, toc };
}

/** All complete items, most recently imported first. Reads ONLY meta.json (stat-cached), never toc.json. */
export function listLibrary(root: string): LibraryItemMeta[] {
	let names: string[];
	try {
		names = fs.readdirSync(root);
	} catch {
		return [];
	}
	return names
		.filter((n) => SHA256_PATTERN.test(n))
		.map((n) => readLibraryMeta(root, n))
		.filter((m): m is LibraryItemMeta => Boolean(m))
		.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
}

/** Every chunk of an item. */
export function readLibraryChunks(root: string, sha256: string): ContentChunk[] {
	let text: string;
	try {
		text = fs.readFileSync(path.join(libraryItemDir(root, sha256), "chunks.jsonl"), "utf-8");
	} catch {
		return [];
	}
	return text
		.split("\n")
		.filter((l) => l.trim())
		.map((l) => JSON.parse(l) as ContentChunk);
}

/** Delete one item directory (user action: "remover da biblioteca"). */
export function removeLibraryItem(root: string, sha256: string): boolean {
	const dir = libraryItemDir(root, sha256);
	evictPooledPdfByFile(path.join(dir, "original.pdf"));
	const state = libraryState();
	state.metaCache.delete(path.resolve(dir, "meta.json"));
	state.tocCache.delete(path.resolve(dir, "toc.json"));
	if (!fs.existsSync(dir)) return false;
	removeTreeSync(dir);
	return !fs.existsSync(dir);
}

// ---------------------------------------------------------------- import

/** Import a PDF/EPUB into the library (idempotent by SHA-256). */
export async function importBookFile(input: ImportBookInput): Promise<ImportedBook> {
	const { bytes } = input;
	if (bytes.byteLength === 0) throw new ResourceError(P, "invalid-input", "Arquivo vazio.");
	if (bytes.byteLength > MAX_IMPORT_BYTES) throw new ResourceError(P, "too-large", `Arquivo maior que ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)} MiB.`);
	const format = detectFormat(bytes);
	if (!format) throw new ResourceError(P, "invalid-input", "Formato não suportado: importe um PDF ou EPUB.");
	const sha = sha256Hex(bytes);
	const dir = libraryItemDir(input.libraryRoot, sha);
	const existing = readLibraryItem(input.libraryRoot, sha);
	if (existing) return { ...existing, deduplicated: true };

	input.signal?.throwIfAborted();
	const extracted = format === "pdf" ? await extractPdf(bytes, input.signal) : extractEpub(bytes);
	input.signal?.throwIfAborted();

	const resourceId = makeResourceId(PREFIX, sha);
	const chunks: ContentChunk[] = [];
	for (const s of extracted.sections) {
		if (!s.text.trim()) continue;
		const id = s.entry ? sectionResourceId(resourceId, s.entry.id) : resourceId;
		chunks.push(
			...chunkSection({
				resourceId: id,
				...(s.entry ? { sectionId: s.entry.id } : {}),
				breadcrumb: s.entry ? tocBreadcrumb(extracted.toc, s.entry.id) : [],
				text: s.text,
				...(s.span ? { span: s.span } : {}),
			}),
		);
	}
	if (chunks.length === 0) extracted.warnings.push("Nenhum texto extraído: o arquivo pode ser só imagens (digitalizado).");

	const file = `original.${format}`;
	const meta: LibraryItemMeta = {
		schemaVersion: 1,
		sha256: sha,
		format,
		fileName: path.basename(input.fileName),
		file,
		bytes: bytes.byteLength,
		title: input.title?.trim() || extracted.title || baseTitle(input.fileName),
		creators: extracted.creators,
		lang: extracted.lang,
		...(extracted.numPages !== undefined ? { numPages: extracted.numPages } : {}),
		...(extracted.isbn ? { isbn: extracted.isbn } : {}),
		tocSource: extracted.tocSource,
		license: input.license ?? { ...PERSONAL_COPY },
		origin: input.origin ?? { kind: "upload" },
		importedAt: new Date((input.now ?? Date.now)()).toISOString(),
		chunkCount: chunks.length,
		warnings: extracted.warnings,
	};

	fs.mkdirSync(dir, { recursive: true });
	writeBinaryAtomic(path.join(dir, file), bytes);
	if (extracted.physicalPages) writeFileAtomicSync(path.join(dir, "physical-pages.json"), JSON.stringify([...extracted.physicalPages]));
	writeFileAtomicSync(path.join(dir, "toc.json"), JSON.stringify({ source: extracted.tocSource, entries: extracted.toc }, null, "\t"));
	writeFileAtomicSync(path.join(dir, "chunks.jsonl"), chunks.map((c) => JSON.stringify(c)).join("\n") + (chunks.length ? "\n" : ""));
	writeFileAtomicSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, "\t"));
	const state = libraryState();
	state.metaCache.delete(path.resolve(dir, "meta.json"));
	state.tocCache.delete(path.resolve(dir, "toc.json"));
	return { meta, toc: extracted.toc, deduplicated: false };
}

export interface ImportFromUrlInput extends Omit<ImportBookInput, "bytes" | "fileName" | "origin"> {
	url: string;
	/** Allowlisted resource fetch (safe-fetch): shadow libraries are blocked there. */
	fetch: ResourceFetch;
	fileName?: string;
}

/** Download an OPEN book from an allowlisted official source and import it. */
export async function importFromUrl(input: ImportFromUrlInput): Promise<ImportedBook> {
	const res = await input.fetch(input.url, { maxBytes: MAX_IMPORT_BYTES, timeoutMs: 180_000, ...(input.signal ? { signal: input.signal } : {}) });
	if (!res.ok) throw new ResourceError(P, "unavailable", `Download falhou (HTTP ${res.status}).`);
	const bytes = new Uint8Array(await res.arrayBuffer());
	const fileName = input.fileName ?? decodeURIComponent(new URL(input.url).pathname.split("/").pop() || "livro");
	const { url: _url, fetch: _fetch, fileName: _name, ...rest } = input;
	return importBookFile({ ...rest, bytes, fileName, origin: { kind: "url", href: input.url } });
}

// ---------------------------------------------------------------- provider

export function libraryResource(meta: LibraryItemMeta): Resource {
	const r: Resource = {
		id: makeResourceId(PREFIX, meta.sha256),
		provider: P,
		kind: "book",
		title: meta.title,
		lang: meta.lang,
		license: meta.license,
		access: "user_owned",
		tos: "user_owned",
		locator: { kind: "library", sha256: meta.sha256, format: meta.format },
		fetchedAt: meta.importedAt,
	};
	if (meta.creators.length) r.creators = meta.creators;
	if (meta.numPages !== undefined) r.pages = meta.numPages;
	if (meta.isbn) r.isbn = [meta.isbn];
	if (meta.origin.kind === "url") r.url = meta.origin.href;
	return r;
}

/** Chunk pages `a` vs requested pages `b`: no request keeps all; a chunk without pages never matches a page request. */
function pagesOverlap(a: string | undefined, b: string | undefined): boolean {
	if (!b) return true;
	if (!a) return false;
	const range = (s: string): [number, number] => {
		const [x, y] = s.split("-").map(Number);
		return [x ?? 0, y ?? x ?? 0];
	};
	const [a0, a1] = range(a);
	const [b0, b1] = range(b);
	return a0 <= b1 && b0 <= a1;
}

export class UserLibraryProvider implements ResourceProvider {
	readonly id = P;
	readonly label = "Minha biblioteca (arquivos do usuário)";
	readonly tos = "user_owned" as const;
	readonly kinds: Resource["kind"][] = ["book", "book_section"];
	readonly rate = LIBRARY_RATE;

	constructor(private readonly options: { libraryRoot: string }) {}

	async status(): Promise<ProviderStatus> {
		const n = listLibrary(this.options.libraryRoot).length;
		return { available: true, reason: n ? `${n} livro(s) importado(s) na sua biblioteca local.` : "Biblioteca vazia: importe um PDF ou EPUB que você possui." };
	}

	async search(q: ResourceQuery): Promise<Resource[]> {
		if (q.kinds && !q.kinds.some((k) => k === "book" || k === "book_section")) return [];
		const items = listLibrary(this.options.libraryRoot).map((meta) => ({ meta, toc: readLibraryItem(this.options.libraryRoot, meta.sha256)?.toc ?? [] }));
		return rankByMatch(items, q, (i) => ({ title: i.meta.title, body: i.toc.map((e) => e.title).join(" ") }), 0.25)
			.slice(0, q.maxResults)
			.map((i) => libraryResource(i.meta));
	}

	private item(id: string): { meta: LibraryItemMeta; toc: TocEntry[]; sectionId?: string } {
		const parsed = idFor(P, PREFIX, id);
		if (!SHA256_PATTERN.test(parsed.externalId)) throw new ResourceError(P, "invalid-input", `Id da biblioteca inválido: "${id}".`);
		const found = readLibraryItem(this.options.libraryRoot, parsed.externalId);
		if (!found) throw new ResourceError(P, "not-found", "Livro não está na sua biblioteca.");
		return { ...found, ...(parsed.sectionId ? { sectionId: parsed.sectionId } : {}) };
	}

	async resolve(id: string): Promise<Resource> {
		const { meta, toc, sectionId } = this.item(id);
		const book = libraryResource(meta);
		if (!sectionId) return book;
		const entry = toc.find((e) => e.id === sectionId);
		if (!entry) throw new ResourceError(P, "not-found", `Seção "${sectionId}" não existe no sumário.`);
		const r: Resource = { ...book, id: sectionResourceId(book.id, entry.id), kind: "book_section", title: `${book.title} — ${entry.title}`, parentId: book.id, sectionId: entry.id };
		if (entry.pageFrom !== undefined && entry.pageTo !== undefined) r.pages = entry.pageTo - entry.pageFrom + 1;
		return r;
	}

	async toc(id: string): Promise<TocEntry[]> {
		return this.item(id).toc;
	}

	/**
	 * Chunks of the item, of one section (and its descendants) and/or a page
	 * range. Chunks exist only per TOC UNIT (tocUnits: depth ≤ 2; EPUB: the
	 * first entry pointing into a spine document), so a deeper section (PDF
	 * "2.1.3") or an EPUB entry sharing its document with an earlier one has
	 * no chunk of its own: it is served from the unit that holds its text —
	 * the nearest ancestor with chunks, else the earlier entry owning the same
	 * document — narrowed to the section's pages when known.
	 */
	async content(id: string, span?: Span): Promise<ContentChunk[]> {
		const { meta, toc, sectionId: fromId } = this.item(id);
		const sectionId = fromId ?? span?.sectionId;
		const all = readLibraryChunks(this.options.libraryRoot, meta.sha256);
		const within = (sid: string) => (c: ContentChunk) => c.sectionId === sid || c.sectionId?.startsWith(`${sid}.`) === true;
		if (!sectionId) return all.filter((c) => pagesOverlap(c.span?.pages, span?.pages));
		if (all.some(within(sectionId))) return all.filter((c) => within(sectionId)(c) && pagesOverlap(c.span?.pages, span?.pages));
		const entry = toc.find((e) => e.id === sectionId);
		if (!entry) return [];
		const hasChunks = (sid: string) => all.some((c) => c.sectionId === sid);
		const byId = new Map(toc.map((e) => [e.id, e]));
		let holder: string | undefined;
		for (let cur = entry.parentId ? byId.get(entry.parentId) : undefined; cur && !holder; cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
			if (hasChunks(cur.id)) holder = cur.id;
		}
		const file = entry.href?.split("#")[0];
		if (!holder && file) holder = toc.find((e) => e.order < entry.order && e.href?.split("#")[0] === file && hasChunks(e.id))?.id;
		if (!holder) return [];
		const pages = span?.pages ?? (entry.pageFrom !== undefined && entry.pageTo !== undefined ? (entry.pageFrom === entry.pageTo ? `${entry.pageFrom}` : `${entry.pageFrom}-${entry.pageTo}`) : undefined);
		return all.filter((c) => c.sectionId === holder && pagesOverlap(c.span?.pages, pages));
	}
}

export function createUserLibraryProvider(options: { libraryRoot: string }): UserLibraryProvider {
	return new UserLibraryProvider(options);
}
