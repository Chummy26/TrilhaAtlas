/**
 * Resources — YouTube adapters with MOCKED network (SÍNTESE §2.8 "YouTube
 * Data API v3 com chave BYOK", "youtubei.js opt-in", "Embed"; r6 §2–§6).
 * Data API: search.list/videos.list parsing, quota buckets and the 30-day
 * cache; enriched mode: caption/audio-track mapping and json3 transcripts
 * through a fake InnerTube client; desktop embed Referer helpers.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { ELECTRONICS_RESOURCE_POLICY, ENGLISH_RESOURCE_POLICY, languageFit, type AudioTrackInfo, type Resource } from "../src/core/resources/index.ts";
import { ResourceError } from "../src/core/resources/types.ts";
import { MemoryTtlCache } from "../src/server/resources/cache.ts";
import { allowEmbedFullscreen, embedReferer, withEmbedReferer } from "../src/server/resources/embed.ts";
import { DailyQuota } from "../src/server/resources/rate-limit.ts";
import { createResourceFetch, type FetchLike } from "../src/server/resources/safe-fetch.ts";
import { YOUTUBE_QUOTA_LIMITS, buildSearchUrl, createYoutubeDataProvider, dataApiError, mapVideoItem, type VideoItem } from "../src/server/resources/youtube-data.ts";
import { applyEnrichment, createYoutubeEnrichedProvider, enrichmentOf, spokenLanguage, type BasicInfoLike, type InnertubeLike } from "../src/server/resources/youtube-enriched.ts";

const NOW = Date.parse("2026-11-18T15:00:00Z");
const KEY = "test-key-not-real";

const SEARCH_FIXTURE = {
	items: [
		{ id: { kind: "youtube#video", videoId: "AAAAAAAAAAA" }, snippet: { channelId: "UCaaaaaaaaaaaaaaaaaaaaaa", title: "Lei de Ohm" } },
		{ id: { kind: "youtube#video", videoId: "BBBBBBBBBBB" }, snippet: { channelId: "UCbbbbbbbbbbbbbbbbbbbbbb", title: "Ohm's law" } },
		{ id: { kind: "youtube#channel" } },
	],
};

const VIDEOS_FIXTURE: { items: VideoItem[] } = {
	items: [
		{
			id: "AAAAAAAAAAA",
			snippet: { title: "Lei de Ohm explicada", channelId: "UCaaaaaaaaaaaaaaaaaaaaaa", channelTitle: "Canal PT", defaultAudioLanguage: "pt-BR", publishedAt: "2024-03-01T00:00:00Z", liveBroadcastContent: "none", description: "0:00 Intro\n1:00 Lei\n2:00 Exemplo" },
			contentDetails: { duration: "PT8M30S", caption: "true" },
			status: { embeddable: true, license: "youtube", privacyStatus: "public" },
		},
		{
			id: "BBBBBBBBBBB",
			snippet: { title: "Ohm's Law", channelId: "UCbbbbbbbbbbbbbbbbbbbbbb", channelTitle: "EN Channel", defaultAudioLanguage: "en", liveBroadcastContent: "none" },
			contentDetails: { duration: "PT11M", caption: "false" },
			status: { embeddable: true, license: "creativeCommon", privacyStatus: "public" },
		},
	],
};

function router(routes: Record<string, (url: URL) => Response>): { fetch: FetchLike; urls: string[] } {
	const urls: string[] = [];
	return {
		urls,
		fetch: async (raw) => {
			urls.push(raw);
			const url = new URL(raw);
			for (const [prefix, handler] of Object.entries(routes)) if (raw.startsWith(prefix)) return handler(url);
			return new Response("not mocked", { status: 404 });
		},
	};
}

const query = { domainId: "electronics", text: { pt: "lei de Ohm", en: "Ohm's law" }, langs: ["pt", "en"], maxResults: 5 };

test("Data API mapping: language, captions flag, CC license, embeddable/public only, Shorts and lives dropped", () => {
	const at = new Date(NOW).toISOString();
	const pt = mapVideoItem(VIDEOS_FIXTURE.items[0]!, at)!;
	assert.equal(pt.id, "yt:AAAAAAAAAAA");
	assert.equal(pt.lang, "pt-BR");
	assert.equal(pt.durationSec, 510);
	assert.equal(pt.hasManualCaptions, true);
	assert.equal(pt.tos, "official_api");
	assert.equal(pt.access, "stream_only");
	assert.equal(pt.ttlDays, 30);
	assert.equal(mapVideoItem(VIDEOS_FIXTURE.items[1]!, at)!.license.spdx, "CC-BY-3.0");
	const base = VIDEOS_FIXTURE.items[0]!;
	assert.equal(mapVideoItem({ ...base, status: { ...base.status, embeddable: false } }, at), undefined);
	assert.equal(mapVideoItem({ ...base, status: { ...base.status, privacyStatus: "private" } }, at), undefined);
	assert.equal(mapVideoItem({ ...base, contentDetails: { duration: "PT45S" } }, at), undefined, "Shorts are not lessons");
	assert.equal(mapVideoItem({ ...base, snippet: { ...base.snippet, liveBroadcastContent: "live" } }, at), undefined);
});

test("Data API search URL: relevanceLanguage/regionCode/videoDuration/videoCaption, no key inside", () => {
	const url = new URL(buildSearchUrl({ q: "lei de Ohm", maxResults: 10, relevanceLanguage: "pt-BR", regionCode: "BR", videoDuration: "medium", videoCaption: "closedCaption" }));
	const p = url.searchParams;
	assert.equal(p.get("relevanceLanguage"), "pt");
	assert.equal(p.get("regionCode"), "BR");
	assert.equal(p.get("videoDuration"), "medium");
	assert.equal(p.get("videoCaption"), "closedCaption");
	assert.equal(p.get("type"), "video");
	assert.equal(p.get("videoEmbeddable"), "true");
	assert.equal(p.get("q"), "lei de Ohm -shorts");
	assert.equal(p.has("key"), false);
});

test("Data API provider: search → videos with the key at fetch time, quota buckets, 30-day cache", async () => {
	const net = router({
		"https://www.googleapis.com/youtube/v3/search": () => Response.json(SEARCH_FIXTURE),
		"https://www.googleapis.com/youtube/v3/videos": () => Response.json(VIDEOS_FIXTURE),
	});
	const quota = new DailyQuota({ ...YOUTUBE_QUOTA_LIMITS }, { now: () => NOW });
	const cache = new MemoryTtlCache(() => NOW);
	const yt = createYoutubeDataProvider({ fetch: createResourceFetch({ baseFetch: net.fetch }), apiKey: () => KEY, quota, cache, now: () => NOW });
	assert.deepEqual(await yt.status(), { available: true, reason: "API oficial com a sua chave.", budgetLeft: 100 });
	const found = await yt.search(query);
	assert.deepEqual(
		found.map((r) => r.id),
		["yt:AAAAAAAAAAA", "yt:BBBBBBBBBBB"],
	);
	assert.ok(net.urls.every((u) => new URL(u).searchParams.get("key") === KEY));
	const searches = net.urls.filter((u) => u.includes("/search")).length;
	assert.equal(quota.left("search"), 100 - searches);
	assert.equal(quota.left("units"), YOUTUBE_QUOTA_LIMITS.units - 1, "one videos.list call for both ids");
	const before = net.urls.length;
	await yt.search(query);
	assert.equal(net.urls.length, before, "second identical search is served by the cache");
	assert.equal(quota.left("search"), 100 - searches, "cache hits cost no quota");
});

test("Data API provider: no key → unavailable; exhausted bucket → quota error; API errors in pt-BR", async () => {
	const net = router({});
	const noKey = createYoutubeDataProvider({ fetch: createResourceFetch({ baseFetch: net.fetch }), apiKey: () => undefined, now: () => NOW });
	assert.equal((await noKey.status()).available, false);
	await assert.rejects(noKey.search(query), (e: unknown) => e instanceof ResourceError && e.code === "unavailable");
	const quota = new DailyQuota({ ...YOUTUBE_QUOTA_LIMITS }, { now: () => NOW });
	assert.ok(quota.tryConsume("search", 100));
	const spent = createYoutubeDataProvider({ fetch: createResourceFetch({ baseFetch: net.fetch }), apiKey: () => KEY, quota, now: () => NOW });
	assert.equal((await spent.status()).budgetLeft, 0);
	await assert.rejects(spent.search(query), (e: unknown) => e instanceof ResourceError && e.code === "quota");
	assert.equal(net.urls.length, 0, "no request once the bucket is empty");
	const quotaBody = JSON.stringify({ error: { code: 403, errors: [{ reason: "quotaExceeded" }] } });
	assert.equal(dataApiError(403, quotaBody).code, "quota");
	assert.match(dataApiError(400, JSON.stringify({ error: { errors: [{ reason: "keyInvalid" }] } })).message, /chave/);
});

test("quota resets at midnight Pacific time", () => {
	let now = Date.parse("2026-11-18T07:59:00Z"); // 23:59 PST
	const quota = new DailyQuota({ search: 2 }, { now: () => now });
	assert.ok(quota.tryConsume("search", 2));
	assert.equal(quota.tryConsume("search"), false);
	now = Date.parse("2026-11-18T08:01:00Z"); // 00:01 PST
	assert.equal(quota.left("search"), 2);
});

// ─── enriched ────────────────────────────────────────────────────────────────

const INFO: BasicInfoLike = {
	basic_info: { id: "BBBBBBBBBBB", title: "Ohm's Law", duration: 660, channel_id: "UCbbbbbbbbbbbbbbbbbbbbbb", author: "EN Channel" },
	playability_status: { status: "OK" },
	captions: {
		caption_tracks: [
			{ base_url: "https://www.youtube.com/api/timedtext?v=BBBBBBBBBBB&lang=en&kind=asr", language_code: "en", vss_id: "a.en", kind: "asr", is_translatable: true },
			{ base_url: "https://www.youtube.com/api/timedtext?v=BBBBBBBBBBB&lang=pt", language_code: "pt", vss_id: ".pt", is_translatable: true },
		],
	},
	streaming_data: {
		adaptive_formats: [
			{ has_audio: true, has_video: false, language: "en", is_original: true, audio_track: { audio_is_default: true, display_name: "English original" } },
			{ has_audio: true, has_video: false, language: "pt", is_auto_dubbed: true, audio_track: { audio_is_default: false } },
			{ has_audio: true, has_video: true },
		],
	},
};

test("enriched mapping: ASR vs manual captions, original vs auto-dubbed audio, spoken language", () => {
	const e = enrichmentOf(INFO);
	assert.deepEqual(e.captions, [
		{ lang: "en", kind: "asr", translatable: true },
		{ lang: "pt", kind: "manual", translatable: true },
	]);
	assert.deepEqual(
		e.audioTracks.map((t) => [t.lang, t.kind, t.isDefault]),
		[
			["en", "original", true],
			["pt", "dubbed-auto", false],
		],
	);
	assert.equal(e.audioLang, "en");
	const r: Resource = { id: "yt:BBBBBBBBBBB", provider: "youtube-enriched", kind: "video", title: "x", lang: "en", captions: e.captions, audioTracks: e.audioTracks, license: { name: "x" }, access: "stream_only", tos: "opt_in_gray", locator: { kind: "youtube", videoId: "BBBBBBBBBBB" }, fetchedAt: "" };
	assert.ok(languageFit(r, ENGLISH_RESOURCE_POLICY, { englishCefr: "B1" }) > 0, "EN original audio is fine for English even with a PT auto-dub nearby");
});

test("enriched provider: opt-in required; ANDROID → ANDROID_VR fallback; json3 transcript → 20–90 s segments", async () => {
	let optIn = false;
	const clients: string[] = [];
	const fake: InnertubeLike = {
		async getBasicInfo(_id, options) {
			clients.push(options?.client ?? "");
			if (options?.client === "ANDROID") return { playability_status: { status: "LOGIN_REQUIRED", reason: "bot check" } };
			return INFO;
		},
	};
	const events = Array.from({ length: 20 }, (_, i) => ({ tStartMs: i * 5000, dDurationMs: 5000, segs: [{ utf8: i % 5 === 4 ? `frase ${i}.` : `palavra ${i}` }] }));
	const net = router({ "https://www.youtube.com/api/timedtext": (url) => (url.searchParams.get("fmt") === "json3" ? Response.json({ events }) : new Response("", { status: 400 })) });
	const yt = createYoutubeEnrichedProvider({ fetch: createResourceFetch({ baseFetch: net.fetch }), optIn: () => optIn, client: async () => fake, cache: new MemoryTtlCache(() => NOW), now: () => NOW });
	assert.deepEqual((await yt.status()).available, false);
	await assert.rejects(yt.transcript("BBBBBBBBBBB"), (e: unknown) => e instanceof ResourceError && e.code === "unavailable");
	optIn = true;
	const t = await yt.transcript("BBBBBBBBBBB");
	assert.deepEqual(clients, ["ANDROID", "ANDROID_VR"]);
	assert.equal(t.lang, "en", "RAG reads the original-language track");
	assert.equal(t.kind, "asr");
	assert.equal(t.source, "android_vr");
	assert.ok(t.segments.length >= 3);
	for (const s of t.segments) assert.ok(s.end - s.start >= 20 && s.end - s.start <= 90);
	const chunks = await yt.content("yt:BBBBBBBBBBB", { startSec: 0, endSec: 30 });
	assert.ok(chunks.length >= 1 && chunks.every((c) => c.span?.startSec !== undefined && c.span.startSec < 30));
	const resolved = await yt.resolve("yt:BBBBBBBBBBB");
	assert.equal(resolved.tos, "opt_in_gray");
	assert.equal(resolved.audioLang, "en");
});

test("enriched provider: a caption that demands a PO token is refused without a request", async () => {
	const info: BasicInfoLike = { ...INFO, captions: { caption_tracks: [{ base_url: "https://www.youtube.com/api/timedtext?v=BBBBBBBBBBB&lang=en&exp=xpe", language_code: "en", kind: "asr" }] } };
	const net = router({});
	const yt = createYoutubeEnrichedProvider({ fetch: createResourceFetch({ baseFetch: net.fetch }), optIn: () => true, client: async () => ({ getBasicInfo: async () => info }), now: () => NOW });
	await assert.rejects(yt.transcript("BBBBBBBBBBB"), (e: unknown) => e instanceof ResourceError && /PO token/.test(e.message));
	assert.equal(net.urls.length, 0);
});

// ─── embed (desktop) ─────────────────────────────────────────────────────────

test("embed Referer: injected only for the embed iframe; fullscreen only for the YouTube origins", () => {
	assert.equal(embedReferer("com.Example.Estudos"), "https://com.example.estudos");
	assert.throws(() => embedReferer("not an id"));
	const embedHeaders = withEmbedReferer({ url: "https://www.youtube-nocookie.com/embed/AAAAAAAAAAA?enablejsapi=1", resourceType: "subFrame", requestHeaders: { referer: "x", Accept: "*/*" } }, "com.example.estudos");
	assert.deepEqual(embedHeaders, { Accept: "*/*", Referer: "https://com.example.estudos" });
	const other = { url: "https://openstax.org/x", resourceType: "xhr", requestHeaders: { A: "1" } };
	assert.equal(withEmbedReferer(other, "com.example.estudos"), other.requestHeaders);
	assert.equal(allowEmbedFullscreen("fullscreen", "https://www.youtube-nocookie.com/embed/x"), true);
	assert.equal(allowEmbedFullscreen("fullscreen", "https://evil.example/embed"), false);
	assert.equal(allowEmbedFullscreen("media", "https://www.youtube-nocookie.com/embed/x"), false);
});

// ─── review regressions ──────────────────────────────────────────────────────

test("Data API (regression): the title language is NOT the spoken language — titleLang hint, lang 'und'", () => {
	const at = new Date(NOW).toISOString();
	const base = VIDEOS_FIXTURE.items[1]!;
	// A video with an English TITLE and no declared audio language (dubbed or
	// PT-spoken videos often look like this): it used to be mapped as lang "en"
	// and pass the English original-audio requirement.
	const r = mapVideoItem({ ...base, snippet: { ...base.snippet, defaultAudioLanguage: undefined, defaultLanguage: "en" } }, at)!;
	assert.equal(r.lang, "und");
	assert.equal(r.audioLang, undefined);
	assert.equal(r.titleLang, "en");
	assert.equal(languageFit(r, ENGLISH_RESOURCE_POLICY, { englishCefr: "B2" }), 0, "English never accepts unproven original audio");
	assert.ok(languageFit(r, ELECTRONICS_RESOURCE_POLICY) >= 0.5, "dub-tolerant Electronics may use the title hint (EN → ASR, translatable)");
	// With the audio language declared, the title language is irrelevant.
	const declared = mapVideoItem({ ...base, snippet: { ...base.snippet, defaultAudioLanguage: "en", defaultLanguage: "pt" } }, at)!;
	assert.equal(declared.lang, "en");
	assert.equal(declared.titleLang, "pt");
	assert.ok(languageFit(declared, ENGLISH_RESOURCE_POLICY, { englishCefr: "B2" }) > 0);
});

test("enriched (regression): a single-track video (no xtags → language null) takes the ASR language, not 'und'", () => {
	const info: BasicInfoLike = {
		...INFO,
		captions: { caption_tracks: [{ base_url: "https://www.youtube.com/api/timedtext?v=BBBBBBBBBBB&lang=en&kind=asr", language_code: "en", vss_id: "a.en", kind: "asr", is_translatable: true }] },
		// youtubei.js 18.3.0: without xtags `language` is null and is_original is true.
		streaming_data: { adaptive_formats: [{ has_audio: true, has_video: false, language: null, is_original: true, audio_track: undefined }] },
	};
	const e = enrichmentOf(info);
	assert.deepEqual(
		e.audioTracks.map((t) => [t.lang, t.kind]),
		[["und", "original"]],
	);
	assert.equal(e.audioLang, "en", "the 'und' original track must fall through to the ASR caption language");
	const tracks: AudioTrackInfo[] = [{ lang: "und", kind: "original", isDefault: true }];
	assert.equal(spokenLanguage(tracks, []), undefined, "nothing known → undefined, never 'und'");
	// Even a resource that still carries an 'und' original track (old cache) is judged by its known language.
	const r: Resource = { id: "yt:BBBBBBBBBBB", provider: "youtube-enriched", kind: "video", title: "x", lang: "en", audioLang: "en", captions: e.captions, audioTracks: tracks, license: { name: "x" }, access: "stream_only", tos: "opt_in_gray", locator: { kind: "youtube", videoId: "BBBBBBBBBBB" }, fetchedAt: "" };
	assert.ok(languageFit(r, ENGLISH_RESOURCE_POLICY, { englishCefr: "B1" }) > 0);
	assert.equal(applyEnrichment(r, e).lang, "en");
});
