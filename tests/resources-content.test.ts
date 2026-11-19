/**
 * Resources — transcript segments, TOC page ranges, chunking, the node
 * playlist (ONE suggestion at a time), embed URL and YouTube helpers
 * (SÍNTESE §2.8 "Segmentos 20–90 s", "Sumário em cascata", "Playlist do
 * nó", "Embed"; r6 §4, §6, §8, §10; ref-deeptutor-core build_segments).
 */
import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";

import { electronicsManifest, englishManifest } from "../src/core/domains/defaults.ts";
import {
	MAX_SEGMENT_SECONDS,
	MIN_SEGMENT_SECONDS,
	buildNodePlaylist,
	buildSegments,
	buildTimedTextUrl,
	buildToc,
	chunkSection,
	chunkText,
	embedLanguageFor,
	entryKey,
	makeResourceId,
	needsPoToken,
	nextSuggestion,
	pageWindowToc,
	parseDescriptionChapters,
	parseIsoDuration,
	parseResourceId,
	parseTimedText,
	rankCandidates,
	remainingAfterNext,
	sectionResourceId,
	segmentAt,
	selectCaptionTrack,
	tocBreadcrumb,
	tocUnits,
	validateToc,
	videoIdFromUrl,
	youtubeEmbedUrl,
	type Candidate,
	type Cue,
	type RawTocNode,
	type Resource,
} from "../src/core/resources/index.ts";

const ELECTRONICS = electronicsManifest("2026-11-18T00:00:00.000Z").resourcePolicy;
const ENGLISH = englishManifest("2026-11-18T00:00:00.000Z").resourcePolicy;

// ─── segments ────────────────────────────────────────────────────────────────

test("segments: cues merge into 20–90 s windows that end on a sentence; a gap > 4 s cuts", () => {
	const cues: Cue[] = [];
	for (let i = 0; i < 30; i++) cues.push({ start: i * 5, end: i * 5 + 5, text: i % 6 === 5 ? `frase ${i}.` : `palavra ${i}` });
	cues.push({ start: 200, end: 230, text: "depois de uma pausa longa." });
	const segs = buildSegments(cues);
	assert.ok(segs.length >= 3);
	for (const s of segs.slice(0, -1)) assert.ok(s.end - s.start >= MIN_SEGMENT_SECONDS && s.end - s.start <= MAX_SEGMENT_SECONDS, `${s.start}–${s.end}`);
	assert.equal(segs.at(-1)!.start, 200, "the long pause starts a new segment");
	assert.deepEqual(
		segs.map((s) => s.locator),
		segs.map((_, i) => i + 1),
	);
	assert.equal(segmentAt(segs, 0)?.locator, 1);
	assert.equal(segmentAt(segs, 199), null);
});

test("segments (property): ordered, non-overlapping, never longer than 90 s, text preserved", () => {
	const cueArb = fc.array(fc.record({ len: fc.integer({ min: 1, max: 8 }), gap: fc.integer({ min: 0, max: 6 }), word: fc.constantFrom("a", "b.", "c", "d!") }), { minLength: 1, maxLength: 80 });
	fc.assert(
		fc.property(cueArb, (rows) => {
			let t = 0;
			const cues = rows.map((r) => {
				const cue = { start: t + r.gap, end: t + r.gap + r.len, text: r.word };
				t = cue.end;
				return cue;
			});
			const segs = buildSegments(cues);
			for (let i = 0; i < segs.length; i++) {
				assert.ok(segs[i]!.end - segs[i]!.start <= MAX_SEGMENT_SECONDS + 8, "a single cue can overshoot by at most its own length");
				if (i > 0) assert.ok(segs[i]!.start >= segs[i - 1]!.end);
			}
			assert.equal(segs.map((s) => s.text).join(" ").split(" ").length, cues.length);
		}),
	);
});

test("segments (regression): a sentence end closes a segment only once the CURRENT segment is ≥ 20 s", () => {
	// 5-s cues, a sentence every 15 s. Checking the MERGED length instead cut
	// 15-s segments (merged 20 s at the next cue) that the fold pass then glued
	// into a single 60-s block.
	const cues: Cue[] = [];
	for (let i = 0; i < 12; i++) cues.push({ start: i * 5, end: i * 5 + 5, text: i % 3 === 2 ? `fim ${i}.` : `palavra ${i}` });
	const segs = buildSegments(cues);
	assert.deepEqual(
		segs.map((s) => [s.start, s.end]),
		[
			[0, 30],
			[30, 60],
		],
	);
	for (const s of segs) assert.match(s.text, /[.]$/, "every segment ends on a sentence");
});

test("segments (property): with contiguous cues every segment but the last is ≥ 20 s", () => {
	const rowsArb = fc.array(fc.record({ len: fc.integer({ min: 1, max: 8 }), word: fc.constantFrom("a", "b.", "c", "d!") }), { minLength: 1, maxLength: 80 });
	fc.assert(
		fc.property(rowsArb, (rows) => {
			let t = 0;
			const cues = rows.map((r) => {
				const cue = { start: t, end: t + r.len, text: r.word };
				t = cue.end;
				return cue;
			});
			const segs = buildSegments(cues);
			for (const s of segs.slice(0, -1)) assert.ok(s.end - s.start >= MIN_SEGMENT_SECONDS, `${s.start}–${s.end}`);
		}),
	);
});

test("timedtext: json3 parsing drops line-break events and decodes entities; srv3 also parsed", () => {
	const json3 = JSON.stringify({
		events: [
			{ tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: "Tom &amp; Jerry" }] },
			{ tStartMs: 2000, aAppend: 1, segs: [{ utf8: "\n" }] },
			{ tStartMs: 2500, dDurationMs: 1500, segs: [{ utf8: "explicam " }, { utf8: "a lei de Ohm." }] },
		],
	});
	const cues = parseTimedText(json3);
	assert.deepEqual(
		cues.map((c) => c.text),
		["Tom & Jerry", "explicam a lei de Ohm."],
	);
	assert.equal(cues[1]!.end, 4);
	const srv3 = '<timedtext format="3"><body><p t="1000" d="2000">olá <s>mundo</s></p></body></timedtext>';
	assert.deepEqual(parseTimedText(srv3), [{ start: 1, end: 3, text: "olá mundo" }]);
});

test("timedtext URL: fmt=json3, xosf removed, tlang only when different, PO-token detection", () => {
	const base = "https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en&xosf=1&exp=xpe&kind=asr";
	const url = new URL(buildTimedTextUrl(base, { tlang: "pt" }));
	assert.equal(url.searchParams.get("fmt"), "json3");
	assert.equal(url.searchParams.has("xosf"), false);
	assert.equal(url.searchParams.get("tlang"), "pt");
	assert.equal(new URL(buildTimedTextUrl(base, { tlang: "en-US" })).searchParams.has("tlang"), false, "tlang never equals lang");
	assert.equal(needsPoToken(base), true);
	assert.equal(needsPoToken("https://www.youtube.com/api/timedtext?v=x&lang=en"), false);
});

test("caption choice: manual in the wanted language, else ASR, else a translatable track", () => {
	const tracks = [
		{ baseUrl: "u1", lang: "en", kind: "asr" as const, translatable: true },
		{ baseUrl: "u2", lang: "en", kind: "manual" as const, translatable: true },
	];
	assert.equal(selectCaptionTrack(tracks, "en")?.track.baseUrl, "u2");
	const pt = selectCaptionTrack(tracks, "pt");
	assert.equal(pt?.track.baseUrl, "u2");
	assert.equal(pt?.translateTo, "pt");
	assert.equal(selectCaptionTrack([], "pt"), undefined);
});

test("chapters from the description need 0:00 and ≥ 3 ascending stamps", () => {
	assert.deepEqual(parseDescriptionChapters("0:00 Intro\n1:30 Lei de Ohm\n12:05 Exemplos"), [
		{ startSec: 0, title: "Intro" },
		{ startSec: 90, title: "Lei de Ohm" },
		{ startSec: 725, title: "Exemplos" },
	]);
	assert.deepEqual(parseDescriptionChapters("1:00 a\n2:00 b\n3:00 c"), []);
});

// ─── YouTube ids, durations, embed ───────────────────────────────────────────

test("YouTube helpers: ids from URLs, ISO-8601 durations", () => {
	assert.equal(videoIdFromUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10"), "dQw4w9WgXcQ");
	assert.equal(videoIdFromUrl("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
	assert.equal(videoIdFromUrl("https://example.com/watch?v=dQw4w9WgXcQ"), undefined);
	assert.equal(parseIsoDuration("PT1H2M3S"), 3723);
	assert.equal(parseIsoDuration("PT45S"), 45);
	assert.equal(parseIsoDuration("garbage"), undefined);
});

test("embed: youtube-nocookie with enablejsapi, origin, hl=pt-BR, cc_lang_pref and cc_load_policy", () => {
	const lang = embedLanguageFor(ELECTRONICS);
	const url = new URL(youtubeEmbedUrl("dQw4w9WgXcQ", { origin: "http://localhost:3000", ...lang, startSec: 12.7, endSec: 80.2 }));
	assert.equal(url.origin, "https://www.youtube-nocookie.com");
	assert.equal(url.pathname, "/embed/dQw4w9WgXcQ");
	assert.equal(url.searchParams.get("enablejsapi"), "1");
	assert.equal(url.searchParams.get("origin"), "http://localhost:3000");
	assert.equal(url.searchParams.get("hl"), "pt-BR");
	assert.equal(url.searchParams.get("cc_lang_pref"), "pt");
	assert.equal(url.searchParams.get("cc_load_policy"), "1");
	assert.equal(url.searchParams.get("start"), "12");
	assert.equal(url.searchParams.get("end"), "81");
	assert.deepEqual(embedLanguageFor(ENGLISH, "C1"), { uiLang: "en", ccLang: "en", forceCaptions: false });
	assert.throws(() => youtubeEmbedUrl("bad", { origin: "http://localhost:3000" }));
});

// ─── ids ─────────────────────────────────────────────────────────────────────

test("resource ids: <prefix>:<external>[#<section>] round-trip", () => {
	const id = sectionResourceId(makeResourceId("wikibooks", "en:Electronics"), "2.1");
	assert.equal(id, "wikibooks:en:Electronics#2.1");
	assert.deepEqual(parseResourceId(id), { prefix: "wikibooks", externalId: "en:Electronics", sectionId: "2.1", baseId: "wikibooks:en:Electronics" });
	assert.throws(() => makeResourceId("ol", "a#b"));
	assert.throws(() => parseResourceId("semprefixo"));
});

// ─── TOC ─────────────────────────────────────────────────────────────────────

test("TOC: containers inherit the first child page, ranges end before the next entry, mid-page starts share", () => {
	const raw: RawTocNode[] = [
		{ title: "<span class='os-number'>1</span> Circuitos DC", children: [{ title: "1.1 Lei de Ohm", page: 3 }, { title: "1.2 Kirchhoff", page: 9, startsMidPage: true }] },
		{ title: "2 Corrente alternada", page: 20 },
	];
	const toc = buildToc(raw, 30);
	assert.deepEqual(
		toc.map((e) => [e.id, e.title, e.pageFrom, e.pageTo]),
		[
			["1", "1 Circuitos DC", 3, 19],
			["1.1", "1.1 Lei de Ohm", 3, 9],
			["1.2", "1.2 Kirchhoff", 9, 19],
			["2", "2 Corrente alternada", 20, 30],
		],
	);
	assert.deepEqual(validateToc(toc, 30), []);
	assert.deepEqual(tocBreadcrumb(toc, "1.2"), ["1 Circuitos DC", "1.2 Kirchhoff"]);
	assert.deepEqual(
		tocUnits(toc).map((e) => e.id),
		["1.1", "1.2", "2"],
	);
	assert.equal(pageWindowToc(25, 10).length, 3);
	assert.equal(pageWindowToc(25, 10).at(-1)?.pageTo, 25);
});

const rawTreeArb: fc.Arbitrary<RawTocNode[]> = fc.letrec((tie) => ({
	node: fc.record({
		title: fc.string({ minLength: 1, maxLength: 8 }),
		page: fc.option(fc.integer({ min: 1, max: 60 }), { nil: undefined }),
		startsMidPage: fc.boolean(),
		children: fc.oneof({ depthSize: "small", withCrossShrink: true }, fc.constant([]), fc.array(tie("node"), { maxLength: 3 })),
	}),
	tree: fc.array(tie("node"), { minLength: 1, maxLength: 5 }),
})).tree as fc.Arbitrary<RawTocNode[]>;

test("TOC (property): any outline — even out of page order — satisfies I1 (from ≤ to), I2 (child ⊆ parent), I3 (siblings overlap ≤ 1 page)", () => {
	fc.assert(
		fc.property(rawTreeArb, fc.integer({ min: 60, max: 80 }), (tree, numPages) => {
			const toc = buildToc(tree, numPages);
			assert.deepEqual(validateToc(toc, numPages), []);
		}),
		{ numRuns: 300 },
	);
});

// ─── chunking ────────────────────────────────────────────────────────────────

test("chunking: 300–800 tokens with ~12% overlap and breadcrumb context header", () => {
	const paragraph = "A lei de Ohm relaciona tensão, corrente e resistência em um condutor ôhmico. ".repeat(20);
	const text = Array.from({ length: 6 }, () => paragraph).join("\n\n");
	const chunks = chunkSection({ resourceId: "openstax:x#1.2", sectionId: "1.2", breadcrumb: ["1 Circuitos", "1.2 Ohm"], text, span: { sectionId: "1.2" } });
	assert.ok(chunks.length >= 2);
	for (const c of chunks) {
		assert.ok(c.tokens <= 800);
		assert.equal(c.contextHeader, "1 Circuitos › 1.2 Ohm");
		assert.equal(c.sectionId, "1.2");
	}
	const firstTail = chunks[0]!.text.slice(-60);
	assert.ok(chunks[1]!.text.includes(firstTail.slice(firstTail.indexOf(" ") + 1, firstTail.indexOf(" ") + 30)), "consecutive chunks overlap");
	assert.ok(chunks.at(-1)!.tokens >= 300 || chunks.length === 1, "a small tail is merged into the previous chunk when it fits");
});

test("chunking (property): no chunk exceeds maxTokens and every word survives", () => {
	const word = fc.stringMatching(/^[a-z]{1,12}$/);
	const para = fc.array(word, { minLength: 1, maxLength: 120 }).map((w) => `${w.join(" ")}.`);
	fc.assert(
		fc.property(fc.array(para, { minLength: 1, maxLength: 12 }), fc.integer({ min: 40, max: 200 }), (paras, maxTokens) => {
			const text = paras.join("\n\n");
			const chunks = chunkText(text, { minTokens: Math.floor(maxTokens / 3), maxTokens, overlapRatio: 0.12 });
			for (const c of chunks) assert.ok(c.length <= maxTokens * 4, `${c.length} > ${maxTokens * 4}`);
			const out = new Set(chunks.join(" ").split(/[\s.]+/).filter(Boolean));
			for (const w of text.split(/[\s.]+/).filter(Boolean)) assert.ok(out.has(w), w);
		}),
		{ numRuns: 150 },
	);
});

// ─── playlist ────────────────────────────────────────────────────────────────

function res(id: string, extra: Partial<Resource>): Resource {
	return {
		id,
		provider: "youtube-data",
		kind: "video",
		title: id,
		lang: "pt",
		license: { name: "x" },
		access: "stream_only",
		tos: "official_api",
		locator: { kind: "url", href: "https://example.org" },
		fetchedAt: "2026-11-18T00:00:00.000Z",
		...extra,
	};
}

function cand(r: Resource, score: number, extra: Partial<Candidate["link"]> = {}, signals: Candidate["signals"] = {}): Candidate {
	return { resource: r, link: { resourceId: r.id, nodeId: "ee.ohm", score, method: "toc", provisional: false, ...extra }, signals };
}

test("playlist (Electronics): AI explanation → intuition video ≤ 12 min → book section → deep-dive; one suggestion at a time", () => {
	const shortVideo = res("yt:aaaaaaaaaaa", { durationSec: 480, channelId: "UC1", hasManualCaptions: true });
	const lecture = res("yt:bbbbbbbbbbb", { durationSec: 3000, channelId: "UC2", level: 3 });
	const book = res("kuphaldt:liec-dc#1.2", { provider: "kuphaldt", kind: "book_section", lang: "en", tos: "open_license", access: "open", pages: 6 });
	const offTopic = res("yt:ccccccccccc", { durationSec: 400 });
	const { ranked, rejected } = rankCandidates(
		[
			cand(shortVideo, 0.9, {}, { llmCoverage: "full", cos: 0.8, bm25: 0.7, channelTrust: 0.8 }),
			cand(lecture, 0.7, { depth: "advanced" }, { llmCoverage: "partial", cos: 0.6, bm25: 0.5 }),
			cand(book, 0.85, { role: "primary", span: { sectionId: "1.2", pages: "12-17" } }),
			cand(offTopic, 0.1, {}, { llmCoverage: "none", cos: 0.1, bm25: 0 }),
		],
		{ policy: ELECTRONICS, nodeLevel: 1 },
	);
	assert.deepEqual(rejected, [{ resourceId: "yt:ccccccccccc", reason: "rel", parts: rejected[0]!.parts }]);
	const playlist = buildNodePlaylist({ nodeId: "ee.ohm", ranked, policy: ELECTRONICS, nodeLevel: 1 });
	assert.equal(playlist.order, "explain-first");
	assert.deepEqual(
		playlist.entries.map((e) => [e.slot, e.resourceId]),
		[
			["ai-explanation", "ai:ee.ohm"],
			["intuition-video", "yt:aaaaaaaaaaa"],
			["primary-reading", "kuphaldt:liec-dc#1.2"],
			["deep-dive", "yt:bbbbbbbbbbb"],
		],
	);
	assert.equal(playlist.entries[2]!.estMinutes, 18, "6 pages × 3 min");
	const first = nextSuggestion(playlist);
	assert.equal(first?.slot, "ai-explanation");
	assert.equal(remainingAfterNext(playlist), 3);
	const second = nextSuggestion(playlist, { done: new Set([entryKey(first!)]) });
	assert.equal(second?.slot, "intuition-video");
	const tight = buildNodePlaylist({ nodeId: "ee.ohm", ranked, policy: ELECTRONICS, nodeLevel: 1, budgetMinutes: 30 });
	assert.deepEqual(
		tight.entries.map((e) => e.slot),
		["ai-explanation", "primary-reading"],
		"optional entries drop out when the day's budget is short",
	);
});

test("playlist (English): input-first, and a PT-audio video never enters as input", () => {
	const enVideo = res("yt:ddddddddddd", { lang: "en", durationSec: 600, captions: [{ lang: "en", kind: "manual" }] });
	const ptVideo = res("yt:eeeeeeeeeee", { lang: "pt", durationSec: 600, captions: [] });
	const { ranked, rejected } = rankCandidates(
		[cand(enVideo, 0.9, {}, { llmCoverage: "full", cos: 0.9, bm25: 0.9 }), cand(ptVideo, 0.95, {}, { llmCoverage: "full", cos: 0.9, bm25: 0.9 })],
		{ policy: ENGLISH, nodeLevel: 2, langFit: { englishCefr: "B1" } },
	);
	assert.deepEqual(
		rejected.map((r) => [r.resourceId, r.reason]),
		[["yt:eeeeeeeeeee", "lang"]],
	);
	const playlist = buildNodePlaylist({ nodeId: "en.past-simple", ranked, policy: ENGLISH, nodeLevel: 2 });
	assert.equal(playlist.order, "input-first");
	assert.deepEqual(
		playlist.entries.map((e) => e.slot),
		["intuition-video", "ai-explanation"],
	);
});
