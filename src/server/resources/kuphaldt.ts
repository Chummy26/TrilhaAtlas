/**
 * Tony R. Kuphaldt's open electronics texts (SÍNTESE §2.8; r6 §9.2 rows
 * "Kuphaldt: Lessons in Electric Circuits (6 vol.) — HTML and PDF at
 * ibiblio.org/kuphaldt/electricCircuits/ (e.g. DC/index.html = TOC),
 * CC BY 4.0 (Appendix 3, revisions 2021–2023)" and "ModEL — ibiblio.org/
 * kuphaldt/socratic/model/, CC BY 4.0"; "use the ibiblio source", never the
 * Cloudflare-protected derivative site).
 *
 * The volumes are a small static catalog (search = local lexical match on
 * title + topic keywords). TOC = the volume index page's links to files in
 * the SAME directory (chapter HTML files, or module PDFs for ModEL), in
 * document order, de-duplicated, fragments dropped. Content is read for
 * HTML chapters only (→ Markdown → chunks); a PDF unit is offered as a
 * download for the learner's library (user-library.ts `importFromUrl`).
 * Levels: LIEC 0–2, ModEL 1–3 (r6 §9.3 ladder).
 * Ids: "kuphaldt:<volume key>" and "…#<tocId>".
 */

import { makeResourceId, sectionResourceId } from "../../core/resources/ids.ts";
import { rankByMatch } from "../../core/resources/match.ts";
import { buildToc, normalizeTocTitle, type RawTocNode } from "../../core/resources/toc.ts";
import { ResourceError, type ContentChunk, type ProviderStatus, type RateSpec, type Resource, type ResourceProvider, type ResourceQuery, type Span, type TocEntry } from "../../core/resources/types.ts";
import { CATALOG_TTL_MS } from "./cache.ts";
import { extractLinks, htmlToMarkdown } from "./html.ts";
import { cachedText, idFor, isoNow, sectionChunks, tocSection, type ProviderDeps } from "./provider-kit.ts";

export const KUPHALDT_RATE: RateSpec = Object.freeze({ minIntervalMs: 1000 });
const P = "kuphaldt";
const LIEC_BASE = "https://www.ibiblio.org/kuphaldt/electricCircuits";

export interface KuphaldtVolume {
	key: string;
	title: string;
	indexUrl: string;
	level: [number, number];
	keywords: string;
	pdf?: string;
}

export const KUPHALDT_VOLUMES: readonly KuphaldtVolume[] = Object.freeze([
	{ key: "liec-dc", title: "Lessons In Electric Circuits, Volume I — DC", indexUrl: `${LIEC_BASE}/DC/index.html`, level: [0, 1], keywords: "dc circuits ohm law voltage current resistance series parallel kirchhoff network analysis batteries capacitors inductors magnetism" },
	{ key: "liec-ac", title: "Lessons In Electric Circuits, Volume II — AC", indexUrl: `${LIEC_BASE}/AC/index.html`, level: [1, 2], keywords: "ac circuits alternating current reactance impedance resonance filters transformers phasors power factor polyphase" },
	{ key: "liec-semi", title: "Lessons In Electric Circuits, Volume III — Semiconductors", indexUrl: `${LIEC_BASE}/Semi/index.html`, level: [1, 2], keywords: "semiconductors diodes rectifiers transistors bjt fet mosfet amplifiers operational amplifiers thyristors" },
	{ key: "liec-digital", title: "Lessons In Electric Circuits, Volume IV — Digital", indexUrl: `${LIEC_BASE}/Digital/index.html`, level: [1, 2], keywords: "digital logic gates boolean algebra karnaugh flip-flops counters registers adc dac microprocessors" },
	{ key: "liec-ref", title: "Lessons In Electric Circuits, Volume V — Reference", indexUrl: `${LIEC_BASE}/Ref/index.html`, level: [0, 2], keywords: "reference formulas units resistor color codes wire tables" },
	{ key: "liec-exper", title: "Lessons In Electric Circuits, Volume VI — Experiments", indexUrl: `${LIEC_BASE}/Exper/index.html`, level: [0, 2], keywords: "experiments laboratory multimeter breadboard projects measurements" },
	{ key: "model", title: "Modular Electronics Learning (ModEL) Project", indexUrl: "https://www.ibiblio.org/kuphaldt/socratic/model/", level: [1, 3], keywords: "modular electronics learning socratic tutorials questions experiments circuits semiconductors instrumentation" },
]);

const KUPHALDT_LICENSE = Object.freeze({
	name: "CC BY 4.0",
	spdx: "CC-BY-4.0",
	url: "https://creativecommons.org/licenses/by/4.0/",
});

export function volumeResource(v: KuphaldtVolume, fetchedAt: string): Resource {
	return {
		id: makeResourceId(P, v.key),
		provider: P,
		kind: "book",
		title: v.title,
		lang: "en",
		license: { ...KUPHALDT_LICENSE, attribution: `${v.title} — Tony R. Kuphaldt, CC BY 4.0, ${v.indexUrl}` },
		access: "open",
		tos: "open_license",
		locator: { kind: "url", href: v.indexUrl },
		url: v.indexUrl,
		creators: ["Tony R. Kuphaldt"],
		level: (v.level[0] + v.level[1]) / 2,
		description: `Texto aberto de eletrônica de Tony R. Kuphaldt (níveis ${v.level[0]}–${v.level[1]}).`,
		subjects: ["electronics", ...v.keywords.split(" ")],
		fetchedAt,
	};
}

function directoryOf(url: string): string {
	const u = new URL(url);
	u.hash = "";
	u.search = "";
	u.pathname = u.pathname.endsWith("/") ? u.pathname : u.pathname.slice(0, u.pathname.lastIndexOf("/") + 1);
	return u.toString();
}

/** Index HTML → raw TOC: same-directory .html/.htm/.pdf files, in order, de-duplicated. */
export function kuphaldtTocFromHtml(html: string, indexUrl: string): RawTocNode[] {
	const dir = directoryOf(indexUrl);
	const self = new URL(indexUrl);
	self.hash = "";
	const seen = new Set<string>();
	const out: RawTocNode[] = [];
	for (const link of extractLinks(html, indexUrl)) {
		const u = new URL(link.href);
		u.hash = "";
		u.search = "";
		const href = u.toString();
		if (!href.startsWith(dir) || href === self.toString() || href === dir) continue;
		const file = href.slice(dir.length);
		if (file.includes("/") || !/\.(html?|pdf)$/i.test(file) || /^index\.html?$/i.test(file) || seen.has(file)) continue;
		seen.add(file);
		const title = normalizeTocTitle(link.text) || file;
		out.push({ title, href: file });
	}
	return out;
}

function volumeOf(key: string): KuphaldtVolume {
	const v = KUPHALDT_VOLUMES.find((x) => x.key === key);
	if (!v) throw new ResourceError(P, "not-found", `Volume de Kuphaldt desconhecido: "${key}".`);
	return v;
}

export class KuphaldtProvider implements ResourceProvider {
	readonly id = P;
	readonly label = "Kuphaldt — Lessons in Electric Circuits e ModEL (CC BY 4.0)";
	readonly tos = "open_license" as const;
	readonly kinds: Resource["kind"][] = ["book", "book_section"];
	readonly rate = KUPHALDT_RATE;

	constructor(private readonly deps: ProviderDeps) {}

	async status(): Promise<ProviderStatus> {
		return { available: true, reason: "Textos abertos de Tony R. Kuphaldt no ibiblio (CC BY 4.0)." };
	}

	async search(q: ResourceQuery): Promise<Resource[]> {
		if (q.domainId !== "electronics") return [];
		if (q.kinds && !q.kinds.some((k) => k === "book" || k === "book_section")) return [];
		const at = isoNow(this.deps);
		const level = q.level;
		const volumes = KUPHALDT_VOLUMES.filter((v) => level === undefined || (level >= v.level[0] - 1 && level <= v.level[1] + 1));
		const ranked = rankByMatch(volumes, q, (v) => ({ title: v.title, body: v.keywords }), 0.25);
		return ranked.slice(0, q.maxResults).map((v) => volumeResource(v, at));
	}

	async resolve(id: string): Promise<Resource> {
		const parsed = idFor(P, P, id);
		const v = volumeOf(parsed.externalId);
		const book = volumeResource(v, isoNow(this.deps));
		if (!parsed.sectionId) return book;
		const toc = await this.toc(parsed.baseId);
		const entry = tocSection(P, toc, parsed.sectionId);
		const url = new URL(entry.href ?? "", directoryOf(v.indexUrl)).toString();
		const isPdf = /\.pdf$/i.test(entry.href ?? "");
		return {
			...book,
			id: sectionResourceId(book.id, entry.id),
			kind: "book_section",
			title: `${book.title} — ${entry.title}`,
			parentId: book.id,
			sectionId: entry.id,
			url,
			locator: { kind: "url", href: url },
			...(isPdf ? { downloads: [{ format: "pdf" as const, href: url }] } : {}),
		};
	}

	async toc(id: string): Promise<TocEntry[]> {
		const v = volumeOf(idFor(P, P, id).externalId);
		const html = await cachedText(this.deps, v.indexUrl, P, CATALOG_TTL_MS);
		const raw = kuphaldtTocFromHtml(html, v.indexUrl);
		if (raw.length === 0) throw new ResourceError(P, "bad-response", "O índice do volume não tem capítulos reconhecíveis.");
		return buildToc(raw);
	}

	async content(id: string, span?: Span): Promise<ContentChunk[]> {
		const parsed = idFor(P, P, id);
		const v = volumeOf(parsed.externalId);
		const sectionId = parsed.sectionId ?? span?.sectionId;
		if (!sectionId) throw new ResourceError(P, "invalid-input", "Informe o capítulo (sectionId) para ler o texto.");
		const toc = await this.toc(parsed.baseId);
		const entry = tocSection(P, toc, sectionId);
		if (!entry.href || /\.pdf$/i.test(entry.href)) {
			throw new ResourceError(P, "invalid-input", `"${entry.title}" é um PDF: importe-o na sua biblioteca para ler por seções.`);
		}
		const url = new URL(entry.href, directoryOf(v.indexUrl)).toString();
		const html = await cachedText(this.deps, url, P, CATALOG_TTL_MS);
		return sectionChunks(sectionResourceId(parsed.baseId, entry.id), toc, entry, htmlToMarkdown(html), { sectionId: entry.id });
	}
}

export function createKuphaldtProvider(deps: ProviderDeps): KuphaldtProvider {
	return new KuphaldtProvider(deps);
}
