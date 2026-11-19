/**
 * Pure YouTube helpers shared by the Data API and the opt-in enriched client
 * (SÍNTESE §2.8 "YouTube"; r6 §2, §4, §7.3; extra-LuanRT__YouTube.js §6.6).
 *
 *  - video ids, ISO-8601 durations (`contentDetails.duration` "PT15M33S");
 *  - the `videoDuration` search bucket for a node (r6 §7.3: atom 6–12 min →
 *    medium; lecture segments → long; quick review → short);
 *  - timedtext URL building (json3; `xosf` removed; `tlang` never equal to
 *    the track language — equal values return damaged captions; `pot/potc/c`
 *    only when a PO token is given) and PO-token detection (`exp=xpe|xpv`);
 *  - caption-track choice for a learner (manual in the wanted language → ASR
 *    in the wanted language → manual original + tlang → ASR original + tlang
 *    → original untranslated).
 *
 * Pure: browser-safe (URL and string handling only).
 */

import { primaryLang } from "./language-fit.ts";
import type { DurationSituation } from "./score.ts";

export const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function isYoutubeVideoId(id: string): boolean {
	return YOUTUBE_ID_PATTERN.test(id);
}

export function youtubeResourceId(videoId: string): string {
	if (!isYoutubeVideoId(videoId)) throw new Error(`Id de vídeo do YouTube inválido: "${videoId}".`);
	return `yt:${videoId}`;
}

/** "yt:<id>" → "<id>" (undefined for anything else). */
export function videoIdOf(resourceId: string): string | undefined {
	const m = resourceId.match(/^yt:([A-Za-z0-9_-]{11})(?:#.*)?$/);
	return m?.[1];
}

/** Extract a video id from watch/short/embed URLs or a bare id. */
export function videoIdFromUrl(input: string): string | undefined {
	const trimmed = input.trim();
	if (isYoutubeVideoId(trimmed)) return trimmed;
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return undefined;
	}
	const host = url.hostname.replace(/^www\.|^m\./, "");
	let candidate: string | null | undefined;
	if (host === "youtu.be") candidate = url.pathname.slice(1).split("/")[0];
	else if (host === "youtube.com" || host === "youtube-nocookie.com") {
		candidate = url.searchParams.get("v") ?? url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/)?.[1];
	}
	return candidate && isYoutubeVideoId(candidate) ? candidate : undefined;
}

/** ISO-8601 duration ("PT1H2M3S", "P1DT2M") → seconds; undefined when malformed. */
export function parseIsoDuration(iso: string | undefined | null): number | undefined {
	if (!iso) return undefined;
	const m = iso.trim().match(/^P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
	if (!m || iso.trim() === "P" || iso.trim().endsWith("T")) return undefined;
	const [w, d, h, min, s] = m.slice(1).map((x) => (x ? Number(x) : 0)) as [number, number, number, number, number];
	return Math.round(w * 604_800 + d * 86_400 + h * 3_600 + min * 60 + s);
}

export type VideoDurationBucket = "any" | "short" | "medium" | "long";

/** `videoDuration` filter for a duration situation (r6 §7.3 table). */
export function videoDurationFor(situation: DurationSituation): VideoDurationBucket {
	switch (situation) {
		case "review":
			return "short";
		case "lecture-segment":
			return "long";
		default:
			return "medium";
	}
}

/** Data API bucket of a known duration (short < 4 min, medium 4–20, long > 20). */
export function bucketOfDuration(seconds: number): Exclude<VideoDurationBucket, "any"> {
	if (seconds < 240) return "short";
	if (seconds <= 1200) return "medium";
	return "long";
}

// ─── timedtext ───────────────────────────────────────────────────────────────

/** True when a caption baseUrl demands a PO token (`exp` contains xpe/xpv). */
export function needsPoToken(baseUrl: string): boolean {
	let url: URL;
	try {
		url = new URL(baseUrl, "https://www.youtube.com");
	} catch {
		return false;
	}
	const exp = url.searchParams.getAll("exp").join(",");
	return /\bxp[ev]\b/.test(exp);
}

export interface TimedTextOptions {
	fmt?: "json3" | "srv3" | "vtt";
	/** Machine-translate into this language (ignored when equal to the track language). */
	tlang?: string;
	/** PO token bound to the video (WEB client only). */
	pot?: string;
	/** Client name sent with the PO token ("WEB"). */
	client?: string;
}

/** Caption baseUrl → download URL (json3, no xosf, safe tlang, optional pot). */
export function buildTimedTextUrl(baseUrl: string, o: TimedTextOptions = {}): string {
	const url = new URL(baseUrl, "https://www.youtube.com");
	url.searchParams.delete("xosf");
	url.searchParams.set("fmt", o.fmt ?? "json3");
	const original = url.searchParams.get("lang");
	if (o.tlang && primaryLang(o.tlang) !== primaryLang(original)) url.searchParams.set("tlang", o.tlang);
	else url.searchParams.delete("tlang");
	if (o.pot) {
		url.searchParams.set("pot", o.pot);
		url.searchParams.set("potc", "1");
		if (o.client) url.searchParams.set("c", o.client);
	}
	return url.toString();
}

export interface CaptionTrackRef {
	baseUrl: string;
	lang: string;
	kind: "manual" | "asr";
	translatable: boolean;
	name?: string;
}

export interface CaptionChoice {
	track: CaptionTrackRef;
	/** Set when the track must be machine-translated to reach the wanted language. */
	translateTo?: string;
}

/**
 * Pick the caption track for a wanted language. `originalLang` (spoken
 * language; the ASR track's language reveals it) ranks original tracks first
 * among the fallbacks. Returns undefined when there are no tracks.
 */
export function selectCaptionTrack(tracks: readonly CaptionTrackRef[], want: string, originalLang?: string): CaptionChoice | undefined {
	if (tracks.length === 0) return undefined;
	const w = primaryLang(want);
	const orig = primaryLang(originalLang ?? tracks.find((t) => t.kind === "asr")?.lang);
	const find = (pred: (t: CaptionTrackRef) => boolean) => tracks.find(pred);
	const manualWanted = find((t) => t.kind === "manual" && primaryLang(t.lang) === w);
	if (manualWanted) return { track: manualWanted };
	const asrWanted = find((t) => t.kind === "asr" && primaryLang(t.lang) === w);
	if (asrWanted) return { track: asrWanted };
	const byPreference = [
		find((t) => t.kind === "manual" && primaryLang(t.lang) === orig && t.translatable),
		find((t) => t.kind === "manual" && t.translatable),
		find((t) => t.kind === "asr" && primaryLang(t.lang) === orig && t.translatable),
		find((t) => t.translatable),
	].find((t) => t !== undefined);
	if (byPreference) return { track: byPreference, translateTo: want };
	const originalTrack = find((t) => primaryLang(t.lang) === orig) ?? tracks[0]!;
	return { track: originalTrack };
}

/** For RAG: the track in the ORIGINAL audio language (most faithful), manual first (r6 §4.3 item 2). */
export function selectOriginalTrack(tracks: readonly CaptionTrackRef[], originalLang?: string): CaptionTrackRef | undefined {
	const orig = primaryLang(originalLang ?? tracks.find((t) => t.kind === "asr")?.lang);
	return (
		tracks.find((t) => t.kind === "manual" && primaryLang(t.lang) === orig) ??
		tracks.find((t) => t.kind === "asr" && primaryLang(t.lang) === orig) ??
		tracks.find((t) => t.kind === "manual") ??
		tracks[0]
	);
}

/** Static thumbnail for the "lite" embed (only loads the iframe on click). */
export function youtubeThumbnailUrl(videoId: string, quality: "hqdefault" | "mqdefault" | "maxresdefault" = "hqdefault"): string {
	if (!isYoutubeVideoId(videoId)) throw new Error(`Id de vídeo do YouTube inválido: "${videoId}".`);
	return `https://i.ytimg.com/vi/${videoId}/${quality}.jpg`;
}

export function youtubeWatchUrl(videoId: string, startSec?: number): string {
	if (!isYoutubeVideoId(videoId)) throw new Error(`Id de vídeo do YouTube inválido: "${videoId}".`);
	return `https://www.youtube.com/watch?v=${videoId}${startSec && startSec > 0 ? `&t=${Math.floor(startSec)}s` : ""}`;
}
