/**
 * Resources — pacing, the provider registry and the curated seeds
 * (SÍNTESE §2.8 "Fontes", "Canais curados (seed)"; r6 §11.1 registry,
 * §11.3 per-provider `rate`, §13 order of preference by legal class,
 * §7.8 channel lists, §9.3 open-book ladder). Fetch is MOCKED and the
 * clock is fake: no real network, no real waiting; state goes to a temp dir.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import fc from "fast-check";

import { booksForDomain, channelsForDomain, trustedChannelIds } from "../src/core/resources/catalog.ts";
import { ResourceError, type ContentChunk, type ProviderStatus, type Resource, type ResourceKind, type ResourceProvider, type ResourceQuery, type TocEntry, type TosClass } from "../src/core/resources/types.ts";
import { gatedFetch, RateGate, type Clock } from "../src/server/resources/rate-limit.ts";
import { createDefaultRegistry, ResourceRegistry, TOS_ORDER } from "../src/server/resources/registry.ts";
import { createResourceFetch, GENERIC_USER_AGENT, isAllowedHost, isBlockedHost, type FetchLike, type ResourceFetch } from "../src/server/resources/safe-fetch.ts";
import { defaultSeedsDir, loadResourceSeeds } from "../src/server/resources/seeds.ts";

interface FakeClock extends Clock {
	t: number;
	sleeps: number[];
	advance(ms: number): void;
}

/** Time only moves when someone sleeps (or the test advances it). */
function fakeClock(start = 0): FakeClock {
	const c: FakeClock = {
		t: start,
		sleeps: [],
		now: () => c.t,
		sleep: async (ms) => {
			c.sleeps.push(ms);
			c.t += ms;
		},
		advance: (ms) => {
			c.t += ms;
		},
	};
	return c;
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function tmpDir(label: string): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), `resources-${label}-`));
}

function resource(id: string, provider: string, kind: ResourceKind = "book"): Resource {
	return {
		id,
		provider,
		kind,
		title: id,
		lang: "en",
		license: { name: "CC BY 4.0", spdx: "CC-BY-4.0" },
		access: "open",
		tos: "open_license",
		locator: { kind: "url", href: "https://openstax.org/details/books/x" },
		fetchedAt: "2026-11-18T00:00:00.000Z",
	};
}

interface FakeOptions {
	id: string;
	tos: TosClass;
	kinds?: ResourceKind[];
	available?: boolean;
	statusThrows?: boolean;
	results?: Resource[];
	searchError?: Error;
	resolveError?: Error;
	withToc?: boolean;
	minIntervalMs?: number;
}

interface FakeProvider extends ResourceProvider {
	calls: string[];
}

function fakeProvider(o: FakeOptions): FakeProvider {
	const calls: string[] = [];
	const p: FakeProvider = {
		id: o.id,
		label: `Fonte ${o.id}`,
		tos: o.tos,
		kinds: o.kinds ?? ["book"],
		rate: { minIntervalMs: o.minIntervalMs ?? 0 },
		calls,
		async status(): Promise<ProviderStatus> {
			if (o.statusThrows) throw new Error(`status de ${o.id} quebrou`);
			return { available: o.available ?? true, reason: o.available === false ? "desligado" : "ok" };
		},
		async search(): Promise<Resource[]> {
			calls.push("search");
			if (o.searchError) throw o.searchError;
			return o.results ?? [];
		},
		async resolve(id: string): Promise<Resource> {
			calls.push(`resolve:${id}`);
			if (o.resolveError) throw o.resolveError;
			return resource(id, o.id);
		},
	};
	if (o.withToc) {
		p.toc = async (id: string): Promise<TocEntry[]> => {
			calls.push(`toc:${id}`);
			return [{ id: "1", title: `Sumário de ${o.id}`, depth: 0, parentId: null, order: 0 }];
		};
	}
	return p;
}

function query(extra: Partial<ResourceQuery> = {}): ResourceQuery {
	return { domainId: "electronics", text: { en: "Ohm's law series and parallel circuits" }, level: 1, maxResults: 5, ...extra };
}

// ---------------------------------------------------------------- pacing

test("RateGate: one task in flight, ≥ interval between starts, failures do not jam the queue", async () => {
	const clock = fakeClock(1000);
	const gate = new RateGate(1000, clock);
	const starts: number[] = [];
	let release: () => void = () => {
		throw new Error("first task never started");
	};
	const first = gate.schedule(async () => {
		starts.push(clock.now());
		await new Promise<void>((resolve) => (release = resolve));
		return "a";
	});
	const second = gate.schedule(async () => {
		starts.push(clock.now());
		return "b";
	});
	await flush();
	assert.deepEqual(starts, [1000], "the second task waits while the first is in flight");
	release();
	assert.equal(await first, "a");
	assert.equal(await second, "b");
	assert.deepEqual(starts, [1000, 2000]);
	assert.deepEqual(clock.sleeps, [1000]);

	const failing = gate.schedule(async () => {
		starts.push(clock.now());
		throw new ResourceError("teste", "unavailable", "falhou");
	});
	await assert.rejects(failing, (e: unknown) => e instanceof ResourceError && e.code === "unavailable");
	clock.advance(5000);
	assert.equal(await gate.schedule(async () => (starts.push(clock.now()), "c")), "c");
	assert.deepEqual(starts, [1000, 2000, 3000, 8000], "after a long idle gap there is no extra wait");
	assert.deepEqual(clock.sleeps, [1000, 1000]);
	assert.throws(() => new RateGate(-1, clock), /intervalo inválido/);
});

test("gatedFetch: parallel callers are serialized and spaced by the provider interval", async () => {
	const clock = fakeClock(0);
	const seen: Array<{ url: string; at: number }> = [];
	const base: ResourceFetch = async (url) => {
		seen.push({ url, at: clock.now() });
		return new Response("{}", { status: 200 });
	};
	const f = gatedFetch(base, new RateGate(3000, clock));
	await Promise.all([f("https://export.arxiv.org/api/query?a"), f("https://export.arxiv.org/api/query?b"), f("https://export.arxiv.org/api/query?c")]);
	assert.deepEqual(
		seen.map((s) => s.url.slice(-1)),
		["a", "b", "c"],
		"FIFO order",
	);
	assert.deepEqual(
		seen.map((s) => s.at),
		[0, 3000, 6000],
	);
});

// ---------------------------------------------------------------- registry

test("registry: register wires a per-provider gate; ids are unique; prefixes route", async () => {
	const clock = fakeClock(0);
	const reg = new ResourceRegistry({ clock });
	const seen: number[] = [];
	const base: ResourceFetch = async () => {
		seen.push(clock.now());
		return new Response("ok", { status: 200 });
	};
	let gatedOut: ResourceFetch | undefined;
	const p = reg.register(
		base,
		(gated) => {
			gatedOut = gated;
			return fakeProvider({ id: "lenta", tos: "metadata_only", minIntervalMs: 2000 });
		},
		["lenta"],
	);
	assert.ok(gatedOut);
	await Promise.all([gatedOut("https://openlibrary.org/a"), gatedOut("https://openlibrary.org/b")]);
	assert.deepEqual(seen, [0, 2000], "the gate uses the provider's own rate");
	assert.equal(reg.get("lenta"), p);
	assert.throws(() => reg.add(fakeProvider({ id: "lenta", tos: "open_license" }), ["outra"]), /Provedor duplicado/);
	const q = reg.add(fakeProvider({ id: "rapida", tos: "open_license" }), ["rapida", "lenta"]);
	assert.deepEqual(
		reg.all().map((x) => x.id),
		["lenta", "rapida"],
	);
	assert.deepEqual(reg.providersFor("lenta:123#2.1"), [p, q], "registration order within a prefix");
	assert.deepEqual(reg.providersFor("rapida:9"), [q]);
	assert.deepEqual(reg.providersFor("desconhecido:9"), []);
	assert.deepEqual(reg.providersFor("sem prefixo"), []);
});

test("registry: live() keeps available providers ordered by legal class; statusAll reports why", async () => {
	const reg = new ResourceRegistry();
	reg.add(fakeProvider({ id: "cinza", tos: "opt_in_gray", kinds: ["video"] }), ["c"]);
	reg.add(fakeProvider({ id: "meta", tos: "metadata_only" }), ["m"]);
	reg.add(fakeProvider({ id: "oficial", tos: "official_api", kinds: ["video"] }), ["o"]);
	reg.add(fakeProvider({ id: "aberto-off", tos: "open_license", available: false }), ["a"]);
	reg.add(fakeProvider({ id: "aberto", tos: "open_license" }), ["b"]);
	reg.add(fakeProvider({ id: "minha", tos: "user_owned" }), ["l"]);
	reg.add(fakeProvider({ id: "quebrada", tos: "open_license", statusThrows: true }), ["q"]);
	assert.deepEqual(
		(await reg.live()).map((p) => p.id),
		["oficial", "aberto", "minha", "meta", "cinza"],
	);
	assert.deepEqual(
		(await reg.live("video")).map((p) => p.id),
		["oficial", "cinza"],
	);
	const reports = await reg.statusAll();
	assert.equal(reports.length, 7);
	const broken = reports.find((r) => r.id === "quebrada")!;
	assert.equal(broken.available, false);
	assert.match(broken.reason, /quebrou/);
	assert.deepEqual(reports.find((r) => r.id === "aberto-off"), { id: "aberto-off", label: "Fonte aberto-off", tos: "open_license", kinds: ["book"], minIntervalMs: 0, available: false, reason: "desligado" });
});

test("registry: live() order is a stable sort by TOS_ORDER over the available providers (property)", async () => {
	const tosArb = fc.constantFrom<TosClass>(...TOS_ORDER);
	await fc.assert(
		fc.asyncProperty(fc.array(fc.record({ tos: tosArb, available: fc.boolean() }), { maxLength: 12 }), async (specs) => {
			const reg = new ResourceRegistry();
			specs.forEach((s, i) => reg.add(fakeProvider({ id: `p${i}`, tos: s.tos, available: s.available }), [`p${i}`]));
			const got = (await reg.live()).map((p) => p.id);
			const expected = specs
				.map((s, i) => ({ ...s, id: `p${i}`, i }))
				.filter((s) => s.available)
				.sort((a, b) => TOS_ORDER.indexOf(a.tos) - TOS_ORDER.indexOf(b.tos) || a.i - b.i)
				.map((s) => s.id);
			assert.deepEqual(got, expected);
		}),
		{ numRuns: 60 },
	);
});

test("registry: search fans out, merges without duplicates and reports failing sources instead of throwing", async () => {
	const reg = new ResourceRegistry();
	const shared = resource("openstax:abc", "openstax");
	reg.add(fakeProvider({ id: "um", tos: "open_license", results: [shared, resource("um:1", "um")] }), ["um"]);
	reg.add(fakeProvider({ id: "dois", tos: "open_license", results: [resource("dois:1", "dois"), shared] }), ["dois"]);
	reg.add(fakeProvider({ id: "cota", tos: "official_api", kinds: ["video", "book"], searchError: new ResourceError("cota", "quota", "Cota de buscas do YouTube esgotada por hoje (100/dia).") }), ["cota"]);
	reg.add(fakeProvider({ id: "bug", tos: "metadata_only", searchError: new Error("resposta estranha") }), ["bug"]);
	const off = reg.add(fakeProvider({ id: "off", tos: "open_license", available: false, results: [resource("off:1", "off")] }), ["off"]);
	const video = reg.add(fakeProvider({ id: "so-video", tos: "embed_only", kinds: ["video"], results: [resource("v:1", "so-video", "video")] }), ["v"]);

	const out = await reg.search(query({ kinds: ["book"] }));
	assert.deepEqual(out.asked, ["cota", "um", "dois", "bug"]);
	assert.deepEqual(
		out.results.map((r) => r.id),
		["openstax:abc", "um:1", "dois:1"],
	);
	assert.deepEqual(out.errors, [
		{ provider: "cota", code: "quota", message: "Cota de buscas do YouTube esgotada por hoje (100/dia)." },
		{ provider: "bug", code: "error", message: "resposta estranha" },
	]);
	assert.deepEqual(off.calls, [], "unavailable providers are never asked");
	assert.deepEqual((video as FakeProvider).calls, [], "providers that cannot serve the kind are skipped");

	const only = await reg.search(query(), { providers: ["dois", "so-video"] });
	assert.deepEqual(only.asked, ["dois", "so-video"]);
	assert.deepEqual(
		only.results.map((r) => r.id),
		["dois:1", "openstax:abc", "v:1"],
	);
	assert.deepEqual(only.errors, []);
});

test("registry: resolve/toc/content dispatch by prefix, falling through only on 'unavailable'", async () => {
	const reg = new ResourceRegistry();
	const off = reg.add(fakeProvider({ id: "yt-off", tos: "official_api", kinds: ["video"], available: false }), ["yt"]);
	const busy = reg.add(fakeProvider({ id: "yt-a", tos: "official_api", kinds: ["video"], resolveError: new ResourceError("yt-a", "unavailable", "sem chave") }), ["yt"]);
	const ok = reg.add(fakeProvider({ id: "yt-b", tos: "opt_in_gray", kinds: ["video"], withToc: true }), ["yt"]);
	const missing = reg.add(fakeProvider({ id: "livro", tos: "open_license", resolveError: new ResourceError("livro", "not-found", "Livro não encontrado.") }), ["livro"]);
	reg.add(fakeProvider({ id: "livro-2", tos: "open_license" }), ["livro"]);

	const r = await reg.resolve("yt:dQw4w9WgXcQ");
	assert.equal(r.provider, "yt-b");
	assert.deepEqual(off.calls, [], "an unavailable provider is not called");
	assert.deepEqual(busy.calls, ["resolve:yt:dQw4w9WgXcQ"], "'unavailable' falls through to the next provider");
	assert.deepEqual(ok.calls, ["resolve:yt:dQw4w9WgXcQ"]);

	const toc = await reg.toc("yt:dQw4w9WgXcQ");
	assert.equal(toc[0]!.title, "Sumário de yt-b", "toc goes to the first provider that implements it");

	await assert.rejects(reg.resolve("livro:1"), (e: unknown) => e instanceof ResourceError && e.code === "not-found");
	assert.deepEqual(missing.calls, ["resolve:livro:1"], "other errors are final (no silent fallback)");

	await assert.rejects(reg.content("yt:dQw4w9WgXcQ"), (e: unknown) => e instanceof ResourceError && e.code === "unavailable" && /ler o conteúdo/.test(e.message));
	await assert.rejects(reg.resolve("zzz:1"), (e: unknown) => e instanceof ResourceError && e.code === "invalid-input" && /Nenhuma fonte reconhece/.test(e.message));

	const solo = new ResourceRegistry();
	solo.add(fakeProvider({ id: "a", tos: "official_api", resolveError: new ResourceError("a", "unavailable", "cota do dia esgotada") }), ["x"]);
	await assert.rejects(solo.resolve("x:1"), (e: unknown) => e instanceof ResourceError && /cota do dia esgotada/.test(e.message), "the last 'unavailable' reason reaches the learner");
});

// ---------------------------------------------------------------- default wiring

const LIEC_DC_INDEX = `<!doctype html><html><body><h1>Lessons In Electric Circuits, Volume I</h1><ul>
<li><a href="DC_1.html">Chapter 1: BASIC CONCEPTS OF ELECTRICITY</a></li>
<li><a href="DC_2.html">Chapter 2: OHM's LAW</a></li>
<li><a href="https://libgen.is/book">espelho proibido</a></li>
</ul></body></html>`;

const LIEC_DC_2 = `<!doctype html><html><body><h1>OHM's LAW</h1><h2>How voltage, current, and resistance relate</h2>
<p>An electric circuit is formed when a conductive path is created to allow electric charge to continuously move.</p>
<p>Ohm's Law: E = I R. Voltage equals current times resistance.</p></body></html>`;

interface Seen {
	url: string;
	at: number;
	ua: string | null;
}

function mockInternet(clock: FakeClock): { base: FetchLike; seen: Seen[] } {
	const seen: Seen[] = [];
	const base: FetchLike = async (url, init) => {
		seen.push({ url, at: clock.now(), ua: new Headers(init?.headers).get("user-agent") });
		if (url === "https://www.ibiblio.org/kuphaldt/electricCircuits/DC/index.html") return new Response(LIEC_DC_INDEX, { status: 200, headers: { "content-type": "text/html" } });
		if (url === "https://www.ibiblio.org/kuphaldt/electricCircuits/DC/DC_2.html") return new Response(LIEC_DC_2, { status: 200, headers: { "content-type": "text/html" } });
		return new Response("não encontrado", { status: 404 });
	};
	return { base, seen };
}

test("createDefaultRegistry: all 11 sources with honest status; YouTube needs a key, enriched needs opt-in", async () => {
	const stateDir = tmpDir("state");
	const libraryRoot = tmpDir("library");
	const clock = fakeClock(Date.UTC(2026, 10, 18, 12));
	const net = mockInternet(clock);
	let key: string | undefined;
	let optIn = false;
	const reg = createDefaultRegistry({ libraryRoot, stateDir, youtubeApiKey: () => key, youtubeEnrichedOptIn: () => optIn, fetch: createResourceFetch({ baseFetch: net.base }), clock, now: () => clock.now() });

	const reports = await reg.statusAll();
	assert.deepEqual(
		reports.map((r) => r.id),
		["youtube-data", "youtube-enriched", "openstax", "kuphaldt", "libretexts", "otl", "wikibooks", "user-library", "openlibrary", "crossref", "arxiv"],
	);
	const byId = new Map(reports.map((r) => [r.id, r]));
	assert.equal(byId.get("youtube-data")!.available, false);
	assert.match(byId.get("youtube-data")!.reason, /chave/);
	assert.equal(byId.get("youtube-enriched")!.available, false);
	assert.equal(byId.get("youtube-enriched")!.optIn, true);
	assert.match(byId.get("user-library")!.reason, /Biblioteca vazia/);
	for (const r of reports.filter((x) => !x.id.startsWith("youtube"))) assert.equal(r.available, true, r.id);
	assert.equal(byId.get("arxiv")!.minIntervalMs, 3000);
	assert.equal(byId.get("openlibrary")!.minIntervalMs, 1000);
	assert.equal(byId.get("crossref")!.minIntervalMs, 1000);
	assert.equal(net.seen.length, 0, "status never touches the network");

	key = "chave-de-teste";
	optIn = true;
	const live = (await reg.live()).map((p) => p.id);
	assert.equal(live[0], "youtube-data", "official API first");
	assert.equal(live[live.length - 1], "youtube-enriched", "the gray opt-in source last");
	assert.deepEqual(live.slice(1, 6), ["openstax", "kuphaldt", "libretexts", "otl", "wikibooks"]);
	key = undefined;
	optIn = false;

	await assert.rejects(reg.resolve("yt:dQw4w9WgXcQ"), (e: unknown) => e instanceof ResourceError && e.code === "unavailable");
	assert.equal(net.seen.length, 0);
});

test("createDefaultRegistry: offline search, then TOC and content through the allowlisted, paced fetch", async () => {
	const stateDir = tmpDir("state");
	const libraryRoot = tmpDir("library");
	const clock = fakeClock(Date.UTC(2026, 10, 18, 12));
	const net = mockInternet(clock);
	const reg = createDefaultRegistry({ libraryRoot, stateDir, youtubeApiKey: () => undefined, youtubeEnrichedOptIn: () => false, fetch: createResourceFetch({ baseFetch: net.base }), clock, now: () => clock.now() });

	const found = await reg.search(query({ maxResults: 3 }), { providers: ["kuphaldt"] });
	assert.deepEqual(found.errors, []);
	assert.equal(found.results[0]?.id, "kuphaldt:liec-dc");
	assert.equal(found.results[0]?.license.spdx, "CC-BY-4.0");
	assert.equal(net.seen.length, 0, "the Kuphaldt volume list is local");

	const toc = await reg.toc("kuphaldt:liec-dc");
	assert.deepEqual(
		toc.map((e) => [e.id, e.title, e.href]),
		[
			["1", "Chapter 1: BASIC CONCEPTS OF ELECTRICITY", "DC_1.html"],
			["2", "Chapter 2: OHM's LAW", "DC_2.html"],
		],
		"links outside the volume (and the shadow-library one) are ignored",
	);

	const chunks: ContentChunk[] = await reg.content("kuphaldt:liec-dc#2");
	assert.ok(chunks.length >= 1);
	assert.equal(chunks[0]!.resourceId, "kuphaldt:liec-dc#2");
	assert.match(chunks.map((c) => c.text).join("\n"), /E = I R/);

	const urls = net.seen.map((s) => s.url);
	assert.deepEqual(urls, ["https://www.ibiblio.org/kuphaldt/electricCircuits/DC/index.html", "https://www.ibiblio.org/kuphaldt/electricCircuits/DC/DC_2.html"], "the index is cached on disk, never fetched twice");
	assert.ok(!urls.some((u) => /libgen/.test(u)));
	assert.ok(net.seen.every((s) => s.ua === GENERIC_USER_AGENT), "generic User-Agent on every request");
	assert.ok(net.seen[1]!.at - net.seen[0]!.at >= 1000, "Kuphaldt requests are spaced by its rate");
	assert.ok(fs.readdirSync(path.join(stateDir, "cache")).length > 0, "cache lives in the state dir, not in the repo");

	await assert.rejects(reg.content("kuphaldt:liec-dc#9"), (e: unknown) => e instanceof ResourceError && e.code === "not-found");
});

// ---------------------------------------------------------------- seeds

test("seeds: both catalogs validate and cover the two domains", () => {
	const seeds = loadResourceSeeds();
	assert.equal(loadResourceSeeds(defaultSeedsDir()), seeds, "memoized per directory");
	for (const domain of ["electronics", "english"]) {
		assert.ok(channelsForDomain(seeds.channels, domain).length >= 5, `channels for ${domain}`);
		assert.ok(booksForDomain(seeds.books, domain).length >= 5, `books for ${domain}`);
	}
	assert.ok(booksForDomain(seeds.books, "electronics", 0).length > 0, "a level-0 entry point for electronics");
	for (const id of trustedChannelIds(seeds.channels, "electronics")) {
		const ch = seeds.channels.channels.find((c) => c.channelId === id)!;
		assert.equal(ch.unverified, false, "only verified ids are used directly");
	}
	for (const ch of seeds.channels.channels) {
		if (ch.unverified) continue;
		assert.match(ch.channelId ?? "", /^UC[A-Za-z0-9_-]{22}$/, ch.key);
	}
});

test("seeds: every book points to an official allowlisted host — never a shadow library", () => {
	const { books } = loadResourceSeeds();
	for (const b of books.books) {
		const host = new URL(b.url).host;
		assert.equal(isBlockedHost(host), false, `${b.key}: ${host}`);
		assert.equal(isAllowedHost(host), true, `${b.key}: ${host} is not in the allowlist`);
		assert.ok(b.license.length >= 2, `${b.key} has a license`);
		if (b.provider === "mitocw") assert.equal(b.use, "link-only", "MIT OCW (NC) is read on the official site");
	}
	const text = JSON.stringify(loadResourceSeeds());
	for (const banned of ["libgen", "annas-archive", "z-lib", "zlibrary", "sci-hub", "pdfdrive", "library.lol"]) assert.ok(!text.toLowerCase().includes(banned), banned);
});

test("seeds: a malformed catalog fails loudly with the directory in the message", () => {
	const dir = tmpDir("seeds");
	fs.writeFileSync(path.join(dir, "channels.json"), JSON.stringify({ schemaVersion: 1, updatedAt: "2026-11-18", channels: [{ key: "Canal Ruim", title: "x" }] }));
	fs.writeFileSync(path.join(dir, "open-books.json"), JSON.stringify({ schemaVersion: 1, updatedAt: "2026-11-18", books: [] }));
	assert.throws(() => loadResourceSeeds(dir), (e: unknown) => e instanceof Error && e.message.includes(dir) && /Sementes de recursos inválidas/.test(e.message));
	const missing = path.join(dir, "nao-existe");
	assert.throws(() => loadResourceSeeds(missing), /Não consegui ler/);
});
