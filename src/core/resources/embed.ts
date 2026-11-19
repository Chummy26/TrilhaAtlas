/**
 * YouTube embed URL for the lesson rail (SÍNTESE §2.8 "Embed"; r6 §6.1–6.2).
 *
 *   https://www.youtube-nocookie.com/embed/<id>?enablejsapi=1&origin=…
 *     &hl=pt-BR&cc_lang_pref=pt&cc_load_policy=1&rel=0&iv_load_policy=3
 *     &playsinline=1[&start=…&end=…]
 *
 * Rules carried here:
 *  - privacy-enhanced host (youtube-nocookie) and the IFrame API (enablejsapi +
 *    the page origin, required for getCurrentTime/seekTo of the synced
 *    transcript panel);
 *  - `hl`/`cc_lang_pref`/`cc_load_policy` follow the domain policy: Electronics
 *    → hl=pt-BR, PT captions forced on; English → hl=en and EN captions (the
 *    original audio is the input, P15) — forced on below C1, optional at C1+;
 *  - `start` floors and `end` ceils to whole seconds (the player only takes
 *    integers); `end` counts from the video start;
 *  - no `autoplay`, no deprecated `modestbranding`;
 *  - nothing overlays the player (policy) — the transcript panel goes BELOW;
 *  - the Referer header is mandatory (error 153): the desktop shell injects it
 *    (server/resources/embed.ts holds the matcher and value for that hook).
 *
 * Pure: browser-safe — the lesson UI imports it through the core barrel.
 */

import type { DomainResourcePolicy } from "../domains/types.ts";
import { cefrBand, primaryLang } from "./language-fit.ts";
import { isYoutubeVideoId } from "./youtube.ts";

export const YOUTUBE_EMBED_ORIGIN = "https://www.youtube-nocookie.com";

export interface EmbedOptions {
	/** Origin of the page hosting the iframe (window.location.origin). */
	origin: string;
	/** Player UI language (`hl`), e.g. "pt-BR". */
	uiLang?: string;
	/** Preferred caption language (`cc_lang_pref`). */
	ccLang?: string;
	/** Force captions on (`cc_load_policy=1`). */
	forceCaptions?: boolean;
	startSec?: number;
	endSec?: number;
}

function assertOrigin(origin: string): string {
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		throw new Error(`Origem inválida para o player do YouTube: "${origin}".`);
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`Origem inválida para o player do YouTube: "${origin}".`);
	return url.origin;
}

/** Build the privacy-enhanced embed URL for one video. */
export function youtubeEmbedUrl(videoId: string, o: EmbedOptions): string {
	if (!isYoutubeVideoId(videoId)) throw new Error(`Id de vídeo do YouTube inválido: "${videoId}".`);
	const url = new URL(`${YOUTUBE_EMBED_ORIGIN}/embed/${videoId}`);
	const p = url.searchParams;
	p.set("enablejsapi", "1");
	p.set("origin", assertOrigin(o.origin));
	p.set("rel", "0");
	p.set("iv_load_policy", "3");
	p.set("playsinline", "1");
	if (o.uiLang) p.set("hl", o.uiLang);
	if (o.ccLang) p.set("cc_lang_pref", o.ccLang);
	if (o.forceCaptions) p.set("cc_load_policy", "1");
	const start = o.startSec !== undefined && Number.isFinite(o.startSec) && o.startSec > 0 ? Math.floor(o.startSec) : undefined;
	const end = o.endSec !== undefined && Number.isFinite(o.endSec) && o.endSec > 0 ? Math.ceil(o.endSec) : undefined;
	if (start !== undefined) p.set("start", String(start));
	if (end !== undefined && (start === undefined || end > start)) p.set("end", String(end));
	return url.toString();
}

/** Embed language options for a domain policy (and the learner's English level). */
export function embedLanguageFor(policy: DomainResourcePolicy, englishCefr?: string): Pick<EmbedOptions, "uiLang" | "ccLang" | "forceCaptions"> {
	if (policy.requireOriginalAudio) {
		const target = primaryLang(policy.requireOriginalAudio);
		return { uiLang: target, ccLang: target, forceCaptions: cefrBand(englishCefr) !== "C" };
	}
	return { uiLang: policy.lessonLang, ccLang: primaryLang(policy.lessonLang), forceCaptions: true };
}

/** iframe attributes the UI must use with the embed (r6 §6.1 snippet). */
export const EMBED_IFRAME_ATTRIBUTES = Object.freeze({
	referrerPolicy: "strict-origin-when-cross-origin",
	allow: "encrypted-media; picture-in-picture; fullscreen",
	allowFullScreen: true,
	/** Minimum viewport 200×200; 16:9 recommended ≥ 480×270. */
	minWidth: 480,
	minHeight: 270,
});
