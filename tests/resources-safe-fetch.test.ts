/**
 * Resources — the allowlisted fetch (SÍNTESE §2.8 "Uma allowlist de hosts em
 * safe-fetch.ts é testada"; "NUNCA hosts de bibliotecas-sombra"; r6 §9.1,
 * §14). Fetch is MOCKED: no real network.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { ResourceError } from "../src/core/resources/types.ts";
import { GENERIC_USER_AGENT, RESOURCE_HOST_ALLOWLIST, assertAllowedUrl, createResourceFetch, fetchJson, isAllowedHost, isBlockedHost, type FetchLike } from "../src/server/resources/safe-fetch.ts";

interface Seen {
	url: string;
	init: RequestInit | undefined;
}

function mockBase(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): { fetch: FetchLike; seen: Seen[] } {
	const seen: Seen[] = [];
	return {
		seen,
		fetch: async (url, init) => {
			seen.push({ url, init });
			return handler(url, init);
		},
	};
}

const SHADOW_HOSTS = [
	"libgen.is",
	"libgen.rs",
	"libgen.li",
	"www.libgen.st",
	"gen.lib.rus.ec",
	"library.lol",
	"annas-archive.org",
	"annas-archive.se",
	"www.annasarchive.org",
	"z-library.sk",
	"z-lib.io",
	"zlibrary-global.se",
	"1lib.sk",
	"b-ok.cc",
	"singlelogin.re",
	"sci-hub.se",
	"sci-hub.ru",
	"scihub.wikicn.top",
	"pdfdrive.com",
	"www.pdfdrive.com",
	"dokumen.pub",
	"vdoc.pub",
	"libstc.cc",
];

const OFFICIAL_HOSTS = [
	"www.googleapis.com",
	"openstax.org",
	"assets.openstax.org",
	"commons.libretexts.org",
	"eng.libretexts.org",
	"open.umn.edu",
	"openlibrary.org",
	"api.crossref.org",
	"export.arxiv.org",
	"en.wikibooks.org",
	"pt.wikibooks.org",
	"www.ibiblio.org",
	"ocw.mit.edu",
	"learningenglish.voanews.com",
];

test("shadow libraries are blocked by host label — any mirror/TLD of the family", () => {
	for (const h of SHADOW_HOSTS) {
		assert.equal(isBlockedHost(h), true, h);
		assert.equal(isAllowedHost(h, [...RESOURCE_HOST_ALLOWLIST, h]), false, `${h} stays blocked even if allowlisted`);
		assert.throws(
			() => assertAllowedUrl(`https://${h}/book/123`, [h]),
			(err: unknown) => err instanceof ResourceError && err.code === "blocked" && /biblioteca-sombra/.test(err.message),
		);
	}
});

test("official open/metadata hosts are allowed; similar-looking or unknown hosts are not", () => {
	for (const h of OFFICIAL_HOSTS) assert.equal(isAllowedHost(h), true, h);
	for (const h of ["example.com", "openstax.org.evil.com", "evil-openstax.org", "libretexts.org.attacker.net", "googleapis.com"]) assert.equal(isAllowedHost(h), false, h);
	assert.equal(isBlockedHost("generation.example.org"), false, "no false positive on 'gen'");
	assert.equal(isBlockedHost("openlibrary.org"), false);
	assert.equal(isBlockedHost("library.oapen.org"), false);
});

test("only https without credentials", () => {
	assert.throws(() => assertAllowedUrl("http://openstax.org/x"), (e: unknown) => e instanceof ResourceError && e.code === "blocked");
	assert.throws(() => assertAllowedUrl("https://user:pw@openstax.org/x"), (e: unknown) => e instanceof ResourceError && e.code === "blocked");
	assert.throws(() => assertAllowedUrl("nota url"), (e: unknown) => e instanceof ResourceError && e.code === "invalid-input");
});

test("fetch: generic User-Agent (caller UA kept), no request reaches a blocked host", async () => {
	const base = mockBase(() => new Response("{}", { status: 200 }));
	const f = createResourceFetch({ baseFetch: base.fetch });
	await f("https://openlibrary.org/search.json?q=ohm");
	assert.equal(new Headers(base.seen[0]!.init?.headers).get("user-agent"), GENERIC_USER_AGENT);
	assert.doesNotMatch(GENERIC_USER_AGENT, /@|mailto|\d{3,}/, "nothing identifies the learner");
	await f("https://openlibrary.org/x", { headers: { "user-agent": "Custom/1.0" } });
	assert.equal(new Headers(base.seen[1]!.init?.headers).get("user-agent"), "Custom/1.0");
	await assert.rejects(f("https://libgen.is/search.php?req=ohm"), (e: unknown) => e instanceof ResourceError && e.code === "blocked");
	assert.equal(base.seen.length, 2, "the blocked request never left");
});

test("fetch: redirects are followed manually and re-checked on every hop", async () => {
	const base = mockBase((url) => {
		if (url.startsWith("https://openlibrary.org/isbn/")) return new Response(null, { status: 302, headers: { location: "/books/OL1M.json" } });
		if (url === "https://openlibrary.org/books/OL1M.json") return new Response('{"ok":true}', { status: 200 });
		if (url.startsWith("https://openstax.org/evil")) return new Response(null, { status: 301, headers: { location: "https://annas-archive.org/md5/abc" } });
		return new Response("nope", { status: 404 });
	});
	const f = createResourceFetch({ baseFetch: base.fetch });
	const res = await f("https://openlibrary.org/isbn/9780521809269.json");
	assert.equal(res.url, "https://openlibrary.org/books/OL1M.json");
	assert.deepEqual(await res.json(), { ok: true });
	assert.equal(base.seen[0]!.init?.redirect, "manual");
	await assert.rejects(f("https://openstax.org/evil"), (e: unknown) => e instanceof ResourceError && e.code === "blocked");
	assert.ok(!base.seen.some((s) => s.url.includes("annas-archive")));
});

test("fetch: response size is capped (declared and streamed)", async () => {
	const big = "x".repeat(2000);
	const declared = mockBase(() => new Response(big, { status: 200, headers: { "content-length": "2000" } }));
	await assert.rejects(createResourceFetch({ baseFetch: declared.fetch, maxBytes: 1000 })("https://openstax.org/a"), (e: unknown) => e instanceof ResourceError && e.code === "too-large");
	const streamed = mockBase(
		() =>
			new Response(
				new ReadableStream({
					start(c) {
						for (let i = 0; i < 5; i++) c.enqueue(new TextEncoder().encode(big));
						c.close();
					},
				}),
				{ status: 200 },
			),
	);
	await assert.rejects(createResourceFetch({ baseFetch: streamed.fetch })("https://openstax.org/a", { maxBytes: 5000 }), (e: unknown) => e instanceof ResourceError && e.code === "too-large");
});

test("fetch: timeout becomes a pt-BR 'unavailable' error", async () => {
	const hang = mockBase(
		(_url, init) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
			}),
	);
	await assert.rejects(createResourceFetch({ baseFetch: hang.fetch })("https://openstax.org/slow", { timeoutMs: 30 }), (e: unknown) => e instanceof ResourceError && e.code === "unavailable" && /Tempo esgotado/.test(e.message));
});

test("fetchJson: HTTP errors map to codes; malformed JSON is a bad-response", async () => {
	const base = mockBase((url) => (url.endsWith("/429") ? new Response("", { status: 429 }) : url.endsWith("/404") ? new Response("", { status: 404 }) : new Response("{oops", { status: 200 })));
	const f = createResourceFetch({ baseFetch: base.fetch });
	await assert.rejects(fetchJson(f, "https://openstax.org/429", "openstax"), (e: unknown) => e instanceof ResourceError && e.code === "quota");
	await assert.rejects(fetchJson(f, "https://openstax.org/404", "openstax"), (e: unknown) => e instanceof ResourceError && e.code === "not-found");
	await assert.rejects(fetchJson(f, "https://openstax.org/bad", "openstax"), (e: unknown) => e instanceof ResourceError && e.code === "bad-response");
});

test("fetch (regression): credentials never follow a redirect to ANOTHER origin; same-origin hops keep them", async () => {
	// Snapshot the headers at call time (the hop loop reuses one Headers object).
	const sent: Headers[] = [];
	const { fetch: base } = mockBase((url, init) => {
		sent.push(new Headers(init?.headers));
		if (url === "https://openstax.org/a") return new Response(null, { status: 302, headers: { location: "/b" } });
		if (url === "https://openstax.org/b") return new Response(null, { status: 302, headers: { location: "https://assets.openstax.org/c" } });
		return new Response("ok");
	});
	const f = createResourceFetch({ baseFetch: base });
	const res = await f("https://openstax.org/a", { headers: { authorization: "Bearer test-token-not-real", cookie: "s=1", "x-keep": "yes" } });
	assert.equal(await res.text(), "ok");
	const headersAt = (i: number) => sent[i]!;
	assert.equal(headersAt(1).get("authorization"), "Bearer test-token-not-real", "same origin: kept");
	assert.equal(headersAt(2).get("authorization"), null, "cross-origin hop: dropped");
	assert.equal(headersAt(2).get("cookie"), null);
	assert.equal(headersAt(2).get("x-keep"), "yes", "other headers survive");
});

test("fetchJson (regression): caller headers given as a Headers instance or a list are kept", async () => {
	const { fetch: base, seen } = mockBase(() => Response.json({ ok: true }));
	const f = createResourceFetch({ baseFetch: base });
	await fetchJson(f, "https://api.crossref.org/works", "crossref", { headers: new Headers({ "x-api-mode": "polite" }) });
	await fetchJson(f, "https://api.crossref.org/works", "crossref", { headers: [["x-api-mode", "list"]] });
	await fetchJson(f, "https://api.crossref.org/works", "crossref", { headers: { accept: "application/vnd.citationstyles.csl+json" } });
	assert.equal(new Headers(seen[0]!.init?.headers).get("x-api-mode"), "polite");
	assert.equal(new Headers(seen[0]!.init?.headers).get("accept"), "application/json");
	assert.equal(new Headers(seen[1]!.init?.headers).get("x-api-mode"), "list");
	assert.equal(new Headers(seen[2]!.init?.headers).get("accept"), "application/vnd.citationstyles.csl+json", "a caller accept wins");
});
