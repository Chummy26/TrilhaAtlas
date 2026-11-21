import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { safeFetch } from "../agent/tools/safe-fetch.ts";
import { isYoutubeVideoId, videoIdFromUrl, youtubeThumbnailUrl, youtubeWatchUrl } from "../core/resources/youtube.ts";
import {
	classifyStudyBrowserTarget,
	type StudyBrowserLinkItem,
	type StudyBrowserMediaItem,
	type StudyBrowserReaderPayload,
	type StudyBrowserVideoHit,
} from "../core/study/browser.ts";
import { isBlockedHost } from "./resources/safe-fetch.ts";

const BROWSER_USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const MAX_HTML_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BYTES = 32 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 15_000;

export class StudyBrowserError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

export function assertSafeBrowserUrl(rawUrl: string): URL {
	let parsed: URL;
	try {
		parsed = new URL(rawUrl.trim());
	} catch {
		throw new StudyBrowserError(400, "URL inválida para o navegador de estudo.");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new StudyBrowserError(400, "Apenas endereços http e https podem ser abertos no navegador de estudo.");
	}
	if (parsed.username || parsed.password) {
		throw new StudyBrowserError(400, "URLs com credenciais embutidas não são permitidas.");
	}
	const host = parsed.hostname.toLowerCase();
	if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".local")) {
		throw new StudyBrowserError(403, "Endereços locais não podem ser abertos no navegador externo embutido.");
	}
	if (isBlockedHost(host)) {
		throw new StudyBrowserError(
			403,
			`Fonte bloqueada (${host}): o TrilhaAtlas acessa apenas fontes educacionais e abertas legais.`,
		);
	}
	return parsed;
}

async function readBoundedBytes(res: Response, maxBytes: number): Promise<Uint8Array> {
	const declared = Number(res.headers.get("content-length") ?? Number.NaN);
	if (Number.isFinite(declared) && declared > maxBytes) {
		await res.body?.cancel().catch(() => {});
		throw new StudyBrowserError(413, "A página externa excede o limite de tamanho do navegador embutido.");
	}
	if (!res.body) return new Uint8Array(await res.arrayBuffer());
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel().catch(() => {});
			throw new StudyBrowserError(413, "A página externa excede o limite de tamanho do navegador embutido.");
		}
		chunks.push(value);
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

async function fetchExternalPage(
	rawUrl: string,
	callerSignal?: AbortSignal,
): Promise<{ finalUrl: string; contentType: string; bytes: Uint8Array }> {
	let current = assertSafeBrowserUrl(rawUrl);
	const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
	const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;

	for (let hop = 0; ; hop++) {
		let res: Response;
		try {
			res = await safeFetch(current.toString(), {
				method: "GET",
				redirect: "manual",
				signal,
				headers: {
					"user-agent": BROWSER_USER_AGENT,
					accept: "text/html,application/xhtml+xml,application/pdf,application/xml;q=0.9,*/*;q=0.8",
					"accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
				},
			});
		} catch (err) {
			if (err instanceof StudyBrowserError) throw err;
			const msg = err instanceof Error ? err.message : String(err);
			if (/private or local address/i.test(msg)) {
				throw new StudyBrowserError(403, "Conexão recusada para endereço de rede privada ou local.");
			}
			throw new StudyBrowserError(502, `Não foi possível carregar ${current.hostname}.`);
		}

		const location = res.headers.get("location");
		if (res.status >= 300 && res.status < 400 && location) {
			await res.body?.cancel().catch(() => {});
			if (hop >= MAX_REDIRECTS) {
				throw new StudyBrowserError(502, "A página externa realizou redirecionamentos demais.");
			}
			current = assertSafeBrowserUrl(new URL(location, current).toString());
			continue;
		}

		if (!res.ok) {
			await res.body?.cancel().catch(() => {});
			throw new StudyBrowserError(
				res.status >= 500 ? 502 : res.status,
				`${current.hostname} retornou HTTP ${res.status}.`,
			);
		}

		const contentType = (res.headers.get("content-type") ?? "text/html").toLowerCase();
		const isPdf = contentType.includes("application/pdf") || /\.pdf$/i.test(current.pathname);
		const bytes = await readBoundedBytes(res, isPdf ? MAX_PDF_BYTES : MAX_HTML_BYTES);
		return { finalUrl: current.toString(), contentType, bytes };
	}
}

const EMBEDDED_BRIDGE_STYLE = `
html, body {
	max-width: 100% !important;
	overflow-x: hidden !important;
}
img, video, audio, figure, table, pre {
	max-width: 100% !important;
}
#onetrust-consent-sdk, .onetrust-pc-dark-filter, #CybotCookiebotDialog,
.fc-consent-root, .cc-window, #cookie-notice, .cookie-banner,
[id*="cookie-consent"], [class*="cookie-banner"] {
	display: none !important;
}
`;

function buildEmbeddedBridgeScript(baseUrl: string): string {
	return `(function(){
	var BASE = ${JSON.stringify(baseUrl)};
	function notifyReady() {
		try {
			window.parent.postMessage({
				type: "lh:embedded-browser-ready",
				url: BASE,
				title: document.title || ""
			}, "*");
		} catch (_e) {}
	}
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", notifyReady, { once: true });
	} else {
		notifyReady();
	}
	window.addEventListener("load", notifyReady, { once: true });
	document.addEventListener("click", function(e) {
		if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		var el = e.target;
		while (el && el.tagName !== "A") el = el.parentElement;
		if (!el) return;
		var rawHref = el.getAttribute("href");
		if (!rawHref || rawHref.startsWith("javascript:") || rawHref.startsWith("mailto:") || rawHref.startsWith("tel:")) return;
		if (rawHref.startsWith("#")) {
			var id = rawHref.slice(1);
			var target = id ? (document.getElementById(id) || document.querySelector('[name="' + id.replace(/"/g, "") + '"]')) : null;
			if (target && target.scrollIntoView) {
				e.preventDefault();
				target.scrollIntoView({ behavior: "smooth", block: "start" });
			}
			return;
		}
		var resolved;
		try { resolved = new URL(rawHref, BASE).toString(); } catch (_err) { return; }
		if (!/^https?:\\/\\//i.test(resolved)) return;
		e.preventDefault();
		e.stopPropagation();
		try {
			window.parent.postMessage({
				type: "lh:embedded-browser-navigate",
				url: resolved,
				title: (el.textContent || el.getAttribute("title") || "").replace(/\\s+/g, " ").trim()
			}, "*");
		} catch (_err) {}
	}, true);
})();`;
}

/** Rewrite fetched HTML so relative assets resolve against the origin and internal links drive the side browser. */
export function rewriteHtmlForEmbeddedFrame(rawHtml: string, finalUrl: string): string {
	// Strip framing-blocking meta tags from the raw HTML before injection
	const cleaned = rawHtml
		.replace(/<meta[^>]+http-equiv\s*=\s*["']?(?:content-security-policy|x-frame-options)["']?[^>]*>/gi, "")
		.replace(/<base\b[^>]*>/gi, "");

	const safeBase = finalUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
	const injection = [
		`<base href="${safeBase}">`,
		`<meta name="referrer" content="no-referrer">`,
		`<style data-lh-embedded-style>${EMBEDDED_BRIDGE_STYLE}</style>`,
		`<script data-lh-embedded-bridge>${buildEmbeddedBridgeScript(finalUrl)}</script>`,
	].join("");

	if (/<head[\s>]/i.test(cleaned)) {
		return cleaned.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${injection}`);
	}
	if (/<html[\s>]/i.test(cleaned)) {
		return cleaned.replace(/<html(\s[^>]*)?>/i, (match) => `${match}<head>${injection}</head>`);
	}
	return `<!doctype html><html><head><meta charset="utf-8">${injection}</head><body>${cleaned}</body></html>`;
}

const readerTurndown = new TurndownService({
	headingStyle: "atx",
	codeBlockStyle: "fenced",
	bulletListMarker: "-",
});
readerTurndown.remove([
	"script",
	"style",
	"noscript",
	"iframe",
	"object",
	"embed",
	"form",
	"button",
	"nav",
	"footer",
	"canvas",
	"svg",
] as never);

const READER_STRIP_SELECTORS = [
	"script",
	"style",
	"noscript",
	"nav",
	"footer",
	"aside",
	"form",
	".mw-editsection",
	".navbox",
	".noprint",
	"#toc",
	".toc",
	"[role='navigation']",
	"[aria-label='breadcrumb']",
	".breadcrumb",
	".breadcrumbs",
	".share",
	".social-share",
	".comments",
	"#comments",
	"#onetrust-consent-sdk",
	".cookie-banner",
];

const CONTENT_CONTAINER_SELECTORS = [
	"article",
	"[role='main']",
	"main",
	"#article-content",
	".article-content",
	".wsw",
	".entry-content",
	".post-content",
	".chapter",
	"[data-type='page']",
	"#mw-content-text .mw-parser-output",
	"#bodyContent",
	"#content",
];

function resolveUrlSafe(raw: string | null | undefined, baseUrl: string): string | null {
	if (!raw) return null;
	const trimmed = raw.trim();
	if (!trimmed || trimmed.startsWith("javascript:") || trimmed.startsWith("data:") || trimmed.startsWith("mailto:")) {
		return null;
	}
	try {
		const u = new URL(trimmed, baseUrl);
		return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
	} catch {
		return null;
	}
}

/** Extract clean reader Markdown, playable audio/video media, and section links from an HTML document. */
export function extractStudyBrowserReader(rawHtml: string, finalUrl: string): StudyBrowserReaderPayload {
	const wrapped = /<html[\s>]/i.test(rawHtml) ? rawHtml : `<!doctype html><html><body>${rawHtml}</body></html>`;
	const { document } = parseHTML(wrapped);
	const host = new URL(finalUrl).hostname.replace(/^www\./i, "");

	const ogTitle = document.querySelector("meta[property='og:title'], meta[name='twitter:title']")?.getAttribute("content")?.trim();
	const h1Title = document.querySelector("article h1, main h1, h1")?.textContent?.replace(/\s+/g, " ").trim();
	const docTitle = document.title?.replace(/\s+/g, " ").trim();
	const title = h1Title || ogTitle || docTitle || host;

	const description =
		document
			.querySelector("meta[property='og:description'], meta[name='description']")
			?.getAttribute("content")
			?.replace(/\s+/g, " ")
			.trim() || undefined;

	// 1. Collect playable audio, video, and embedded YouTube videos before stripping nodes
	const media: StudyBrowserMediaItem[] = [];
	const seenMedia = new Set<string>();
	const pushMedia = (item: StudyBrowserMediaItem) => {
		if (seenMedia.has(item.url) || media.length >= 12) return;
		seenMedia.add(item.url);
		media.push(item);
	};

	for (const audioEl of [...document.querySelectorAll("audio, audio source")]) {
		const src = resolveUrlSafe(audioEl.getAttribute("src") ?? audioEl.getAttribute("data-src"), finalUrl);
		if (src) {
			const label =
				audioEl.getAttribute("title")?.trim() ||
				audioEl.getAttribute("aria-label")?.trim() ||
				audioEl.closest("figure")?.querySelector("figcaption")?.textContent?.replace(/\s+/g, " ").trim() ||
				"Áudio da página";
			pushMedia({ kind: "audio", url: src, label });
		}
	}

	for (const videoEl of [...document.querySelectorAll("video, video source")]) {
		const src = resolveUrlSafe(videoEl.getAttribute("src") ?? videoEl.getAttribute("data-src"), finalUrl);
		if (src && !/\.m3u8(\?|$)/i.test(src)) {
			const label =
				videoEl.getAttribute("title")?.trim() ||
				videoEl.getAttribute("aria-label")?.trim() ||
				"Vídeo da página";
			pushMedia({ kind: "video", url: src, label });
		}
	}

	for (const a of [...document.querySelectorAll("a[href]")]) {
		const href = resolveUrlSafe(a.getAttribute("href"), finalUrl);
		if (!href) continue;
		const pathLower = new URL(href).pathname.toLowerCase();
		if (pathLower.endsWith(".mp3") || pathLower.endsWith(".m4a") || pathLower.endsWith(".ogg") || pathLower.endsWith(".wav")) {
			const text = a.textContent?.replace(/\s+/g, " ").trim() || a.getAttribute("title")?.trim() || "Áudio MP3";
			pushMedia({ kind: "audio", url: href, label: text });
		} else if (pathLower.endsWith(".mp4") || pathLower.endsWith(".webm")) {
			const text = a.textContent?.replace(/\s+/g, " ").trim() || a.getAttribute("title")?.trim() || "Vídeo MP4";
			pushMedia({ kind: "video", url: href, label: text });
		}
	}

	for (const iframe of [...document.querySelectorAll("iframe[src]")]) {
		const src = resolveUrlSafe(iframe.getAttribute("src"), finalUrl);
		if (!src) continue;
		const ytId = videoIdFromUrl(src);
		if (ytId && isYoutubeVideoId(ytId)) {
			pushMedia({
				kind: "youtube",
				url: youtubeWatchUrl(ytId),
				videoId: ytId,
				label: iframe.getAttribute("title")?.trim() || "Vídeo do YouTube",
			});
		}
	}

	// Also scan raw HTML for VOA / British Council direct mp3 urls when players hydrate via JS
	const rawMp3Matches = rawHtml.match(/https:\/\/[a-z0-9.-]+\/[^\s"'<>]+?\.(?:mp3|m4a)(?:\?[^\s"'<>]*)?/gi) ?? [];
	for (const rawMp3 of rawMp3Matches.slice(0, 6)) {
		const resolved = resolveUrlSafe(rawMp3, finalUrl);
		if (resolved) pushMedia({ kind: "audio", url: resolved, label: "Áudio da lição" });
	}

	// 2. Clean DOM and resolve relative links before extracting main article
	for (const sel of READER_STRIP_SELECTORS) {
		for (const el of [...document.querySelectorAll(sel)]) el.remove();
	}

	for (const a of [...document.querySelectorAll("a[href]")]) {
		const resolved = resolveUrlSafe(a.getAttribute("href"), finalUrl);
		if (resolved) a.setAttribute("href", resolved);
		else a.removeAttribute("href");
	}
	for (const img of [...document.querySelectorAll("img")]) {
		img.remove();
	}
	for (const math of [...document.querySelectorAll("math")]) {
		const text = document.createTextNode(` ${math.textContent?.replace(/\s+/g, " ").trim() ?? ""} `);
		math.replaceWith(text);
	}

	let container: Element | null = null;
	for (const selector of CONTENT_CONTAINER_SELECTORS) {
		const candidates = [...document.querySelectorAll(selector)];
		let best: Element | null = null;
		let bestLen = 0;
		for (const c of candidates) {
			const len = (c.textContent ?? "").replace(/\s+/g, " ").trim().length;
			if (len > bestLen) {
				best = c;
				bestLen = len;
			}
		}
		if (best && bestLen >= 180) {
			container = best;
			break;
		}
	}
	const root = container ?? document.body ?? document.documentElement;

	// 3. Collect clean navigation links from the article
	const links: StudyBrowserLinkItem[] = [];
	const seenLinks = new Set<string>();
	for (const a of [...root.querySelectorAll("a[href]")]) {
		const href = a.getAttribute("href");
		const text = (a.textContent ?? "").replace(/\s+/g, " ").trim();
		if (!href || !text || text.length < 3 || text.length > 110) continue;
		if (href === finalUrl || seenLinks.has(href)) continue;
		seenLinks.add(href);
		links.push({ url: href, text });
		if (links.length >= 18) break;
	}

	const rawMarkdown = readerTurndown.turndown(root as unknown as HTMLElement);
	const markdown = rawMarkdown.replace(/\n{3,}/g, "\n\n").trim();

	return {
		url: finalUrl,
		host,
		title,
		...(description ? { description } : {}),
		markdown: markdown || (description ?? "Conteúdo carregado. Use a aba Site para interagir com a página original."),
		media,
		links,
	};
}

/** Extract YouTube search results from the YouTube results HTML page. */
export function extractYoutubeSearchHits(rawHtml: string): StudyBrowserVideoHit[] {
	const dataMatch = /(?:var ytInitialData|window\["ytInitialData"\])\s*=\s*(\{[^\n]*?\});\s*<\/script>/u.exec(rawHtml)?.[1];
	if (!dataMatch) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(dataMatch);
	} catch {
		return [];
	}
	const hits: StudyBrowserVideoHit[] = [];
	const seen = new Set<string>();
	function walk(node: unknown) {
		if (!node || typeof node !== "object" || hits.length >= 12) return;
		if (Array.isArray(node)) {
			for (const item of node) walk(item);
			return;
		}
		const row = node as Record<string, unknown>;
		if (row.videoRenderer && typeof row.videoRenderer === "object") {
			const v = row.videoRenderer as {
				videoId?: string;
				title?: { runs?: { text: string }[]; simpleText?: string };
				ownerText?: { runs?: { text: string }[]; simpleText?: string };
				lengthText?: { simpleText?: string };
			};
			const videoId = v.videoId;
			const title = v.title?.runs?.map((r) => r.text).join("") || v.title?.simpleText;
			if (videoId && isYoutubeVideoId(videoId) && title && !seen.has(videoId)) {
				seen.add(videoId);
				const channel = v.ownerText?.runs?.map((r) => r.text).join("") || v.ownerText?.simpleText;
				const duration = v.lengthText?.simpleText;
				hits.push({
					videoId,
					title,
					url: youtubeWatchUrl(videoId),
					thumbnailUrl: youtubeThumbnailUrl(videoId, "mqdefault"),
					...(channel ? { channel } : {}),
					...(duration ? { duration } : {}),
				});
			}
			return;
		}
		for (const key of [
			"contents",
			"twoColumnSearchResultsRenderer",
			"primaryContents",
			"sectionListRenderer",
			"itemSectionRenderer",
		]) {
			if (row[key]) walk(row[key]);
		}
	}
	walk(parsed);
	return hits;
}

export async function readStudyBrowserFrame(
	rawUrl: string,
	signal?: AbortSignal,
): Promise<{ kind: "html"; html: string; finalUrl: string } | { kind: "pdf"; bytes: Uint8Array; finalUrl: string }> {
	const { finalUrl, contentType, bytes } = await fetchExternalPage(rawUrl, signal);
	const isPdf =
		contentType.includes("application/pdf") ||
		(bytes.byteLength >= 5 &&
			bytes[0] === 0x25 &&
			bytes[1] === 0x50 &&
			bytes[2] === 0x44 &&
			bytes[3] === 0x46 &&
			bytes[4] === 0x2d);
	if (isPdf) {
		return { kind: "pdf", bytes, finalUrl };
	}
	const html = new TextDecoder("utf-8").decode(bytes);
	return {
		kind: "html",
		html: rewriteHtmlForEmbeddedFrame(html, finalUrl),
		finalUrl,
	};
}

export async function readStudyBrowserReader(rawUrl: string, signal?: AbortSignal): Promise<StudyBrowserReaderPayload> {
	const validUrl = assertSafeBrowserUrl(rawUrl);
	const target = classifyStudyBrowserTarget(validUrl.toString());

	if (target.kind === "youtube-video") {
		const oembedUrl = `https://www.youtube.com/oembed?${new URLSearchParams({ url: target.url, format: "json" }).toString()}`;
		try {
			const { bytes } = await fetchExternalPage(oembedUrl, signal);
			const data = JSON.parse(new TextDecoder("utf-8").decode(bytes)) as { title?: string; author_name?: string };
			const title = typeof data.title === "string" && data.title.trim() ? data.title.trim() : "Vídeo do YouTube";
			const author = typeof data.author_name === "string" ? data.author_name.trim() : undefined;
			return {
				url: target.url,
				host: "youtube.com",
				title,
				...(author ? { description: `Canal: ${author}` } : {}),
				markdown: `Assista ao vídeo **${title}**${author ? ` (${author})` : ""} no player acima.`,
				media: [{ kind: "youtube", url: target.url, videoId: target.videoId, label: title }],
				links: [],
			};
		} catch {
			return {
				url: target.url,
				host: "youtube.com",
				title: "Vídeo do YouTube",
				markdown: "Assista ao vídeo no player embutido acima.",
				media: [{ kind: "youtube", url: target.url, videoId: target.videoId, label: "Vídeo do YouTube" }],
				links: [],
			};
		}
	}

	if (target.kind === "youtube-search") {
		const { bytes, finalUrl } = await fetchExternalPage(target.url, signal);
		const html = new TextDecoder("utf-8").decode(bytes);
		const hits = extractYoutubeSearchHits(html);
		return {
			url: finalUrl,
			host: "youtube.com",
			title: `YouTube: ${target.query}`,
			description: `${hits.length} vídeo(s) encontrado(s) para estudo.`,
			markdown: hits.length
				? "Escolha um vídeo abaixo para abrir o player diretamente nesta barra lateral."
				: "Nenhum vídeo foi encontrado para esta consulta.",
			media: [],
			links: [],
			youtubeResults: hits,
		};
	}

	const { finalUrl, contentType, bytes } = await fetchExternalPage(validUrl.toString(), signal);
	const isPdf =
		contentType.includes("application/pdf") ||
		(bytes.byteLength >= 5 &&
			bytes[0] === 0x25 &&
			bytes[1] === 0x50 &&
			bytes[2] === 0x44 &&
			bytes[3] === 0x46 &&
			bytes[4] === 0x2d);
	if (isPdf) {
		const host = new URL(finalUrl).hostname.replace(/^www\./i, "");
		const fileName = decodeURIComponent(new URL(finalUrl).pathname.split("/").pop() || "Documento.pdf");
		return {
			url: finalUrl,
			host,
			title: fileName,
			description: "Documento PDF",
			markdown: "Este material é um arquivo PDF. Utilize a visualização **PDF / Site** acima para ler as páginas originais com zoom e navegação.",
			media: [],
			links: [],
		};
	}

	const html = new TextDecoder("utf-8").decode(bytes);
	return extractStudyBrowserReader(html, finalUrl);
}
