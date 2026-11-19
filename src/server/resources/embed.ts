/**
 * Server/desktop side of the YouTube embed (SÍNTESE §2.8 "Embed": the
 * `Referer` is MANDATORY — error 153 without it — and is injected in the
 * SINGLE `onBeforeSendHeaders` listener of electron/main.cjs; r6 §6.2).
 *
 * The URL builder itself is pure and lives in core (src/core/resources/
 * embed.ts) so the lesson UI can use it; this module re-exports it and adds
 * the pieces the desktop shell needs, written as pure functions so the
 * (CommonJS) shell can mirror them and tests pin the behaviour:
 *   - `isYoutubeEmbedRequest`  subFrame requests to youtube(-nocookie)/embed/;
 *   - `embedReferer`           "https://<appId lowercased>" (API Client
 *                              Identity: the registered app id, reverse DNS);
 *   - `withEmbedReferer`       returns the request headers with Referer set
 *                              (only for embed requests; others untouched);
 *   - `allowEmbedFullscreen`   the one extra permission: fullscreen requested
 *                              by the embed origin.
 */

export { EMBED_IFRAME_ATTRIBUTES, YOUTUBE_EMBED_ORIGIN, embedLanguageFor, youtubeEmbedUrl, type EmbedOptions } from "../../core/resources/embed.ts";

export const YOUTUBE_EMBED_URL_PATTERN = /^https:\/\/www\.youtube(?:-nocookie)?\.com\/embed\//;

export interface HeaderRequestDetails {
	url: string;
	resourceType?: string;
	requestHeaders: Record<string, string>;
}

/** True for the iframe document request of a YouTube embed. */
export function isYoutubeEmbedRequest(details: Pick<HeaderRequestDetails, "url" | "resourceType">): boolean {
	return (details.resourceType === undefined || details.resourceType === "subFrame") && YOUTUBE_EMBED_URL_PATTERN.test(details.url);
}

/** Referer identifying the API client: "https://" + app id (reverse DNS, lowercased). */
export function embedReferer(appId: string): string {
	const id = appId.trim().toLowerCase();
	if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(id)) throw new Error(`appId inválido para o Referer do embed: "${appId}".`);
	return `https://${id}`;
}

/** Headers with the embed Referer injected (copy; non-embed requests are returned unchanged). */
export function withEmbedReferer(details: HeaderRequestDetails, appId: string): Record<string, string> {
	if (!isYoutubeEmbedRequest(details)) return details.requestHeaders;
	const headers = { ...details.requestHeaders };
	for (const k of Object.keys(headers)) if (k.toLowerCase() === "referer") delete headers[k];
	headers.Referer = embedReferer(appId);
	return headers;
}

/** Only `fullscreen` from the embed origin is granted on top of the app's own permissions. */
export function allowEmbedFullscreen(permission: string, requestingUrl: string): boolean {
	if (permission !== "fullscreen") return false;
	try {
		const origin = new URL(requestingUrl).origin;
		return origin === "https://www.youtube-nocookie.com" || origin === "https://www.youtube.com";
	} catch {
		return false;
	}
}
