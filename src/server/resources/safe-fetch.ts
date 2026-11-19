/**
 * The ONLY network door of the resource adapters (SÍNTESE §2.8 "Todos os
 * adapters passam por safeFetch com User-Agent genérico", "nunca Anna's
 * Archive, LibGen ou Z-Library. Uma allowlist de hosts em safe-fetch.ts é
 * testada"; r6 §9.1, §11.3, §14).
 *
 * Every request:
 *  1. must be https, without credentials in the URL;
 *  2. is refused when the host belongs to a shadow library (LibGen, Anna's
 *     Archive, Z-Library, Sci-Hub and their mirror families) — checked FIRST,
 *     by host label, so new TLDs/mirrors of the same family stay blocked even
 *     if someone adds them to the allowlist;
 *  3. must match the allowlist of official hosts (exact host, or "*.domain"
 *     for subdomains);
 *  4. follows redirects manually (≤ 5), re-checking 2–3 on every hop and
 *     dropping Authorization/Cookie when a hop changes origin;
 *  5. carries a generic User-Agent (privacy: nothing identifies the learner;
 *     a caller-supplied UA — e.g. the InnerTube client UA — is kept);
 *  6. is bounded in time (default 20 s, combined with the caller's signal)
 *     and in size (Content-Length checked first, then the stream is capped);
 *  7. goes through the base fetch that only reaches PUBLIC addresses
 *     (src/agent/tools/safe-fetch.ts: DNS-rebinding-safe private-IP block).
 * The body is fully read and returned as a fresh `Response`, so a caller can
 * never stream past the size limit.
 */

import { safeFetch as publicOnlyFetch } from "../../agent/tools/safe-fetch.ts";
import { ResourceError } from "../../core/resources/types.ts";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ResourceRequestInit extends RequestInit {
	/** Override the size cap for this request (e.g. a book PDF). */
	maxBytes?: number;
	/** Override the timeout for this request. */
	timeoutMs?: number;
}

export type ResourceFetch = (url: string, init?: ResourceRequestInit) => Promise<Response>;

/** Neutral UA: no app/user identity (r6 §11.3, Open Library anonymous tier). */
export const GENERIC_USER_AGENT = "Mozilla/5.0 (compatible; OpenStudyResources/1.0)";

export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
export const MAX_REDIRECTS = 5;

/**
 * Official hosts used by the adapters (r6 §9.2 table, §2, §3.1). "*.x" =
 * any subdomain of x (not x itself).
 */
export const RESOURCE_HOST_ALLOWLIST: readonly string[] = Object.freeze([
	// YouTube: Data API v3 (official), oEmbed, timedtext + InnerTube (opt-in), thumbnails.
	"www.googleapis.com",
	"youtube.googleapis.com",
	"www.youtube.com",
	"youtubei.googleapis.com",
	"i.ytimg.com",
	// OpenStax: CMS, rex release + archive, PDFs.
	"openstax.org",
	"assets.openstax.org",
	// LibreTexts: Commons catalog, downloads, library sites.
	"commons.libretexts.org",
	"downloads.libretexts.org",
	"*.libretexts.org",
	// Open Textbook Library (UMN).
	"open.umn.edu",
	// Metadata only.
	"openlibrary.org",
	"covers.openlibrary.org",
	"api.crossref.org",
	"export.arxiv.org",
	"arxiv.org",
	// Wikibooks (CC BY-SA).
	"*.wikibooks.org",
	// Kuphaldt LIEC / ModEL (CC BY 4.0) on ibiblio.
	"www.ibiblio.org",
	"ibiblio.org",
	// Other official open sources named in the research.
	"ocw.mit.edu",
	"learningenglish.voanews.com",
	"ecampusontario.pressbooks.pub",
	"directory.doabooks.org",
	"library.oapen.org",
	"archive.org",
	"educapes.capes.gov.br",
	"books.scielo.org",
]);

/**
 * Shadow-library families (never contacted, whatever the allowlist says).
 * Matched against each dot-separated label of the host and against the host
 * suffix, case-insensitively, so "libgen.rs", "libgen.is", "foo.libgen.li",
 * "annas-archive.org/.se/.li", "z-lib.io", "zlibrary-global.se", "1lib.sk",
 * "b-ok.cc", "sci-hub.se/.ru/.st", "library.lol" … are all refused.
 */
const BLOCKED_LABEL_PATTERNS: readonly RegExp[] = Object.freeze([
	/libgen/, // Library Genesis and mirrors (libgen.rs/.is/.st/.li/.gs/.vg…)
	/annas-?archive/, // Anna's Archive
	/^z-?lib(rary)?(-[a-z0-9]+)?$/, // z-lib.org, zlibrary.to, z-library.se, zlibrary-global.se
	/^1lib$/,
	/^b-ok$/,
	/^booksc$/,
	/^bookfi$/,
	/^singlelogin$/, // Z-Library login domain
	/^sci-?hub/, // Sci-Hub
	/^sci-net$/, // Sci-Hub's Sci-Net
	/^scihub/,
	/^pdfdrive$/,
	/^libstc$/, // Nexus STC
	/^nexusstc$/,
	/^bookzz$/,
	/^ebookee$/,
	/^freebookspot$/,
	/^rutracker$/,
	/^thepiratebay$/,
	/^1337x$/,
]);

const BLOCKED_HOST_SUFFIXES: readonly string[] = Object.freeze([
	"lib.rus.ec",
	"library.lol",
	"vdoc.pub",
	"dokumen.pub",
	"ebin.pub",
	"epdf.pub",
	"pdfcoffee.com",
	"standard-template-construct.org",
]);

function normalizeHost(host: string): string {
	return host.trim().toLowerCase().replace(/\.$/, "");
}

/** True for hosts of shadow libraries (piracy). */
export function isBlockedHost(host: string): boolean {
	const h = normalizeHost(host);
	if (!h) return false;
	if (BLOCKED_HOST_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`))) return true;
	return h.split(".").some((label) => BLOCKED_LABEL_PATTERNS.some((re) => re.test(label)));
}

/** True when `host` matches an allowlist entry ("host" or "*.domain"). */
export function isAllowedHost(host: string, allowlist: readonly string[] = RESOURCE_HOST_ALLOWLIST): boolean {
	const h = normalizeHost(host);
	if (!h || isBlockedHost(h)) return false;
	return allowlist.some((entry) => {
		const e = normalizeHost(entry);
		if (e.startsWith("*.")) return h.endsWith(e.slice(1)) && h.length > e.length - 1;
		return h === e;
	});
}

/** Parse and vet a URL; throws ResourceError("blocked") with a pt-BR reason. */
export function assertAllowedUrl(raw: string, allowlist: readonly string[] = RESOURCE_HOST_ALLOWLIST): URL {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new ResourceError("safe-fetch", "invalid-input", `URL inválida: "${raw}".`);
	}
	if (isBlockedHost(url.hostname)) {
		throw new ResourceError("safe-fetch", "blocked", `Fonte bloqueada: ${url.hostname} é uma biblioteca-sombra. O app usa só fontes legais (livros abertos, metadados ou o arquivo do próprio usuário).`);
	}
	if (url.protocol !== "https:") throw new ResourceError("safe-fetch", "blocked", `Só conexões https são permitidas (recebido ${url.protocol}//${url.hostname}).`);
	if (url.username || url.password) throw new ResourceError("safe-fetch", "blocked", "URLs com credenciais embutidas não são permitidas.");
	if (!isAllowedHost(url.hostname, allowlist)) {
		throw new ResourceError("safe-fetch", "blocked", `Host fora da lista de fontes oficiais: ${url.hostname}.`);
	}
	return url;
}

export interface ResourceFetchOptions {
	allowlist?: readonly string[];
	/** Hosts added to the default allowlist (still subject to the blocklist). */
	extraAllowedHosts?: readonly string[];
	/** Underlying fetch (default: public-addresses-only fetch). Tests inject a mock. */
	baseFetch?: FetchLike;
	timeoutMs?: number;
	maxBytes?: number;
	maxRedirects?: number;
	userAgent?: string;
}

const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

/** Headers dropped when a redirect crosses origins. */
const CREDENTIAL_HEADERS: readonly string[] = Object.freeze(["authorization", "proxy-authorization", "cookie"]);

async function readCapped(res: Response, maxBytes: number, host: string): Promise<Uint8Array> {
	const declared = Number(res.headers.get("content-length") ?? Number.NaN);
	if (Number.isFinite(declared) && declared > maxBytes) {
		await res.body?.cancel().catch(() => {});
		throw new ResourceError("safe-fetch", "too-large", `Resposta grande demais de ${host} (${declared} bytes; limite ${maxBytes}).`);
	}
	if (!res.body) return new Uint8Array(await res.arrayBuffer());
	const reader = res.body.getReader();
	const parts: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel().catch(() => {});
			throw new ResourceError("safe-fetch", "too-large", `Resposta grande demais de ${host} (mais de ${maxBytes} bytes).`);
		}
		parts.push(value);
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const p of parts) {
		out.set(p, offset);
		offset += p.byteLength;
	}
	return out;
}

function withUserAgent(headers: HeadersInit | undefined, userAgent: string): Headers {
	const h = new Headers(headers);
	if (!h.has("user-agent")) h.set("user-agent", userAgent);
	return h;
}

/** Build the resource fetch (see header for the guarantees). */
export function createResourceFetch(options: ResourceFetchOptions = {}): ResourceFetch {
	const allowlist = [...(options.allowlist ?? RESOURCE_HOST_ALLOWLIST), ...(options.extraAllowedHosts ?? [])];
	const base: FetchLike = options.baseFetch ?? ((url, init) => publicOnlyFetch(url, init ?? {}));
	const defaultTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const defaultMax = options.maxBytes ?? DEFAULT_MAX_BYTES;
	const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
	const userAgent = options.userAgent ?? GENERIC_USER_AGENT;

	return async (rawUrl, init = {}) => {
		const { maxBytes = defaultMax, timeoutMs = defaultTimeout, signal: callerSignal, ...rest } = init;
		const timeout = AbortSignal.timeout(timeoutMs);
		const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
		let url = assertAllowedUrl(rawUrl, allowlist);
		let method = (rest.method ?? "GET").toUpperCase();
		let body = rest.body;
		const headers = withUserAgent(rest.headers, userAgent);
		for (let hop = 0; ; hop++) {
			let res: Response;
			try {
				res = await base(url.toString(), { ...rest, method, body, headers, redirect: "manual", signal });
			} catch (err) {
				if (err instanceof ResourceError) throw err;
				if (timeout.aborted) throw new ResourceError("safe-fetch", "unavailable", `Tempo esgotado ao acessar ${url.hostname} (${timeoutMs} ms).`);
				if (callerSignal?.aborted) throw err;
				throw new ResourceError("safe-fetch", "unavailable", `Falha de rede ao acessar ${url.hostname}: ${err instanceof Error ? err.message : String(err)}`);
			}
			const location = res.headers.get("location");
			if (res.status >= 300 && res.status < 400 && location) {
				await res.body?.cancel().catch(() => {});
				if (hop >= maxRedirects) throw new ResourceError("safe-fetch", "bad-response", `Redirecionamentos demais a partir de ${url.hostname}.`);
				const next = assertAllowedUrl(new URL(location, url).toString(), allowlist);
				// Like the fetch spec's own redirect handling: credentials never
				// follow a hop to ANOTHER origin (manual redirects skip that rule).
				if (next.origin !== url.origin) for (const h of CREDENTIAL_HEADERS) headers.delete(h);
				url = next;
				if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
					method = "GET";
					body = undefined;
					headers.delete("content-type");
				}
				continue;
			}
			let bytes: Uint8Array;
			try {
				bytes = await readCapped(res, maxBytes, url.hostname);
			} catch (err) {
				if (err instanceof ResourceError) throw err;
				if (timeout.aborted) throw new ResourceError("safe-fetch", "unavailable", `Tempo esgotado ao ler a resposta de ${url.hostname} (${timeoutMs} ms).`);
				throw err;
			}
			const outBody = NULL_BODY_STATUS.has(res.status) ? null : (bytes as Uint8Array<ArrayBuffer>);
			const out = new Response(outBody, { status: res.status, statusText: res.statusText, headers: res.headers });
			Object.defineProperty(out, "url", { value: url.toString() });
			return out;
		}
	};
}

/** GET + JSON with a clear error on non-2xx or malformed bodies. */
export async function fetchJson<T>(fetch: ResourceFetch, url: string, provider: string, init?: ResourceRequestInit): Promise<T> {
	// Merge through Headers: spreading a Headers instance (or a [k, v][] list)
	// as a plain object silently dropped every caller header.
	const headers = new Headers(init?.headers);
	if (!headers.has("accept")) headers.set("accept", "application/json");
	const res = await fetch(url, { ...init, headers });
	if (!res.ok) throw httpError(provider, res, url);
	const text = await res.text();
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new ResourceError(provider, "bad-response", `Resposta JSON inválida de ${hostOf(url)}.`);
	}
}

/** GET + text with a clear error on non-2xx. */
export async function fetchText(fetch: ResourceFetch, url: string, provider: string, init?: ResourceRequestInit): Promise<string> {
	const res = await fetch(url, init);
	if (!res.ok) throw httpError(provider, res, url);
	return res.text();
}

function hostOf(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return url;
	}
}

/** Map an HTTP failure to a ResourceError with a pt-BR message. */
export function httpError(provider: string, res: Response, url: string): ResourceError {
	const host = hostOf(url);
	if (res.status === 404 || res.status === 410) return new ResourceError(provider, "not-found", `Não encontrado em ${host} (HTTP ${res.status}).`);
	if (res.status === 429) return new ResourceError(provider, "quota", `${host} pediu para diminuir o ritmo (HTTP 429). Tente mais tarde.`);
	if (res.status >= 500) return new ResourceError(provider, "unavailable", `${host} está indisponível no momento (HTTP ${res.status}).`);
	return new ResourceError(provider, "bad-response", `${host} recusou a requisição (HTTP ${res.status}).`);
}
