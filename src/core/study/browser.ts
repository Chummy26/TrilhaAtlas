import { isYoutubeVideoId, videoIdFromUrl, youtubeThumbnailUrl, youtubeWatchUrl } from "../resources/youtube.ts";

export const STUDY_BROWSER_NEWTAB_URL = "about:newtab";

export type StudyBrowserViewMode = "site" | "reader";
export type StudyBrowserSearchEngine = "duckduckgo" | "wikipedia" | "youtube" | "google";

export type StudyBrowserTarget =
	| {
			kind: "new-tab";
			url: typeof STUDY_BROWSER_NEWTAB_URL;
			host: "nova-aba";
	  }
	| {
			kind: "youtube-video";
			url: string;
			host: string;
			videoId: string;
			startSec?: number;
			embedUrl: string;
			thumbnailUrl: string;
	  }
	| {
			kind: "youtube-search";
			url: string;
			host: string;
			query: string;
	  }
	| {
			kind: "pdf";
			url: string;
			host: string;
			hash: string;
	  }
	| {
			kind: "direct-embed";
			url: string;
			host: string;
	  }
	| {
			kind: "web-page";
			url: string;
			host: string;
	  };

export interface StudyBrowserMediaItem {
	kind: "audio" | "video" | "youtube";
	url: string;
	label: string;
	videoId?: string;
}

export interface StudyBrowserLinkItem {
	url: string;
	text: string;
}

export interface StudyBrowserVideoHit {
	videoId: string;
	title: string;
	url: string;
	thumbnailUrl: string;
	channel?: string;
	duration?: string;
}

export interface StudyBrowserReaderPayload {
	url: string;
	host: string;
	title: string;
	description?: string;
	markdown: string;
	media: StudyBrowserMediaItem[];
	links: StudyBrowserLinkItem[];
	youtubeResults?: StudyBrowserVideoHit[];
}

/** Parse a YouTube timestamp parameter ("90", "90s", "1m30s", "1h2m3s") into whole seconds. */
export function parseYoutubeStartSeconds(raw: string | null | undefined): number | undefined {
	if (!raw) return undefined;
	const trimmed = raw.trim().toLowerCase();
	if (!trimmed) return undefined;
	if (/^\d+$/.test(trimmed)) {
		const n = Number.parseInt(trimmed, 10);
		return n > 0 ? n : undefined;
	}
	const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(trimmed);
	if (!match || (!match[1] && !match[2] && !match[3])) return undefined;
	const hours = match[1] ? Number.parseInt(match[1], 10) : 0;
	const minutes = match[2] ? Number.parseInt(match[2], 10) : 0;
	const seconds = match[3] ? Number.parseInt(match[3], 10) : 0;
	const total = hours * 3600 + minutes * 60 + seconds;
	return total > 0 ? total : undefined;
}

/** Resolve whether an anchor href is an external http/https destination that should open in the side browser. */
export function parseExternalStudyUrl(rawHref: string | null | undefined, currentOrigin?: string): string | null {
	if (!rawHref) return null;
	const trimmed = rawHref.trim();
	if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("mailto:") || trimmed.startsWith("tel:") || trimmed.startsWith("javascript:") || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
		return null;
	}
	let parsed: URL;
	try {
		parsed = currentOrigin ? new URL(trimmed, currentOrigin) : new URL(trimmed);
	} catch {
		return null;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
	if (currentOrigin) {
		try {
			const originUrl = new URL(currentOrigin);
			if (parsed.origin === originUrl.origin) return null;
		} catch {
			// Ignore malformed currentOrigin fallback.
		}
	}
	if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]") {
		return null;
	}
	return parsed.toString();
}

export function buildSearchQueryUrl(query: string, engine: StudyBrowserSearchEngine = "wikipedia"): string {
	const q = query.trim();
	if (engine === "youtube") {
		return `https://www.youtube.com/results?${new URLSearchParams({ search_query: q }).toString()}`;
	}
	if (engine === "duckduckgo") {
		return `https://duckduckgo.com/?${new URLSearchParams({ q }).toString()}`;
	}
	if (engine === "google") {
		return `https://www.google.com/search?${new URLSearchParams({ q, igu: "1" }).toString()}`;
	}
	return `https://en.wikipedia.org/w/index.php?${new URLSearchParams({ search: q }).toString()}`;
}

/** Normalize user input from the side browser address bar into a navigable URL. */
export function normalizeBrowserAddressInput(
	rawInput: string,
	defaultEngine: StudyBrowserSearchEngine = "wikipedia",
): string | null {
	const trimmed = rawInput.trim();
	if (!trimmed) return null;
	if (trimmed.toLowerCase() === STUDY_BROWSER_NEWTAB_URL) return STUDY_BROWSER_NEWTAB_URL;
	if (/^https?:\/\//i.test(trimmed)) {
		try {
			const u = new URL(trimmed);
			return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
		} catch {
			return null;
		}
	}
	// Bare domain or domain/path without spaces
	if (!/\s/.test(trimmed) && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/.*)?$/i.test(trimmed)) {
		try {
			return new URL(`https://${trimmed}`).toString();
		} catch {
			return null;
		}
	}
	// Prefixed search shortcuts
	const ytPrefix = /^(?:yt|youtube):\s*(.+)$/i.exec(trimmed);
	if (ytPrefix?.[1]) {
		return buildSearchQueryUrl(ytPrefix[1], "youtube");
	}
	const ddgPrefix = /^(?:ddg|duck|web):\s*(.+)$/i.exec(trimmed);
	if (ddgPrefix?.[1]) {
		return buildSearchQueryUrl(ddgPrefix[1], "duckduckgo");
	}
	const googlePrefix = /^(?:g|google):\s*(.+)$/i.exec(trimmed);
	if (googlePrefix?.[1]) {
		return buildSearchQueryUrl(googlePrefix[1], "google");
	}
	const wikiPrefix = /^(?:w|wiki|wikipedia):\s*(.+)$/i.exec(trimmed);
	if (wikiPrefix?.[1]) {
		return buildSearchQueryUrl(wikiPrefix[1], "wikipedia");
	}
	return buildSearchQueryUrl(trimmed, defaultEngine);
}

const DIRECT_EMBED_HOSTS = new Set([
	"www.falstad.com",
	"falstad.com",
	"phet.colorado.edu",
	"www.geogebra.org",
	"www.desmos.com",
	"desmos.com",
]);

/** Classify a validated external URL into the optimal embedded side-browser presentation. */
export function classifyStudyBrowserTarget(rawUrl: string): StudyBrowserTarget {
	if (rawUrl.trim().toLowerCase() === STUDY_BROWSER_NEWTAB_URL) {
		return {
			kind: "new-tab",
			url: STUDY_BROWSER_NEWTAB_URL,
			host: "nova-aba",
		};
	}
	const parsed = new URL(rawUrl);
	const host = parsed.hostname.replace(/^www\./i, "");

	const ytId = videoIdFromUrl(rawUrl);
	if (ytId && isYoutubeVideoId(ytId)) {
		const startSec =
			parseYoutubeStartSeconds(parsed.searchParams.get("t")) ??
			parseYoutubeStartSeconds(parsed.searchParams.get("start")) ??
			parseYoutubeStartSeconds(parsed.hash.replace(/^#t=/i, ""));
		const embed = new URL(`https://www.youtube-nocookie.com/embed/${ytId}`);
		embed.searchParams.set("rel", "0");
		embed.searchParams.set("iv_load_policy", "3");
		embed.searchParams.set("playsinline", "1");
		if (startSec && startSec > 0) embed.searchParams.set("start", String(startSec));
		return {
			kind: "youtube-video",
			url: youtubeWatchUrl(ytId, startSec),
			host: "youtube.com",
			videoId: ytId,
			...(startSec ? { startSec } : {}),
			embedUrl: embed.toString(),
			thumbnailUrl: youtubeThumbnailUrl(ytId, "hqdefault"),
		};
	}

	if ((host === "youtube.com" || host === "m.youtube.com") && parsed.pathname === "/results") {
		const query = parsed.searchParams.get("search_query")?.trim() ?? "";
		if (query) {
			return {
				kind: "youtube-search",
				url: parsed.toString(),
				host: "youtube.com",
				query,
			};
		}
	}

	if (/\.pdf$/i.test(parsed.pathname)) {
		return {
			kind: "pdf",
			url: parsed.toString(),
			host,
			hash: parsed.hash || "",
		};
	}

	if (DIRECT_EMBED_HOSTS.has(parsed.hostname.toLowerCase()) || DIRECT_EMBED_HOSTS.has(host.toLowerCase())) {
		return {
			kind: "direct-embed",
			url: parsed.toString(),
			host,
		};
	}

	return {
		kind: "web-page",
		url: parsed.toString(),
		host,
	};
}

/** Build the proxy endpoint URL for an embedded page or PDF. */
export function studyBrowserProxyUrl(targetUrl: string, mode: "frame" | "reader", hash = ""): string {
	const params = new URLSearchParams({ url: targetUrl, mode });
	return `/api/study/browser?${params.toString()}${hash}`;
}
