/**
 * YouTube Data API v3 provider — the DEFAULT, official path, with the
 * learner's own key (BYOK) (SÍNTESE §2.8 "Modo padrão: Data API v3 BYOK";
 * r6 §2.1–2.5, §11.3).
 *
 *  search.list   part=snippet, type=video, videoEmbeddable=true,
 *                relevanceLanguage (a hint, not a filter), regionCode,
 *                videoDuration, videoCaption, safeSearch=moderate, order=relevance,
 *                q + " -shorts"; optional channelId (curated channels first).
 *                Own bucket since 2026-06-01: 100 calls/day, 1 per call.
 *  videos.list   part=snippet,contentDetails,status in batches of 50 ids
 *                (1 unit per call out of 10 000/day): duration (ISO 8601),
 *                `contentDetails.caption` (human captions exist; languages
 *                unknown), `snippet.defaultAudioLanguage` (the ONLY audio
 *                language field), embeddable, license.
 *  channels.list forHandle=@handle → channel id (1 unit) for curated seeds
 *                whose id is unverified.
 *
 * Policy (r6 §2.5): API data is cached ≤ 30 days (TTL cache, purgeable);
 * statistics are never requested, stored or turned into derived metrics —
 * quality comes from our own rubric/trust/feedback (core score.ts).
 * Results drop non-embeddable videos, live/upcoming broadcasts and Shorts
 * (≤ 60 s). `lang` is `snippet.defaultAudioLanguage` or "und" — never the
 * title language; `snippet.defaultLanguage` goes to `titleLang`, a weak hint
 * that only dub-tolerant domains may use (English requires proven original
 * audio, P15). The enriched mode replaces both with the real audio tracks.
 * Quota is counted BEFORE each network call and only on cache misses.
 */

import { ResourceError, type ProviderStatus, type Resource, type ResourceProvider, type ResourceQuery, type RateSpec, type License } from "../../core/resources/types.ts";
import { parseIsoDuration, isYoutubeVideoId, videoIdOf, youtubeResourceId, youtubeWatchUrl } from "../../core/resources/youtube.ts";
import { primaryLang } from "../../core/resources/language-fit.ts";
import { YOUTUBE_TTL_MS, type TtlCache } from "./cache.ts";
import { DailyQuota } from "./rate-limit.ts";
import type { ResourceFetch } from "./safe-fetch.ts";

export const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
export const YOUTUBE_QUOTA_LIMITS = Object.freeze({ search: 100, units: 10_000 });
export const YOUTUBE_DATA_RATE: RateSpec = Object.freeze({ minIntervalMs: 200, dailyBudget: { bucket: "search", calls: 100 } });
/** Curated-channel searches per query (each costs one of the 100 daily calls). */
export const MAX_CHANNEL_SEARCHES = 3;
const SHORTS_MAX_SECONDS = 60;
const DESCRIPTION_MAX_CHARS = 5000;

interface ApiErrorBody {
	error?: { code?: number; message?: string; errors?: Array<{ reason?: string; message?: string }> };
}

export interface SearchListResponse {
	items?: Array<{ id?: { kind?: string; videoId?: string }; snippet?: { channelId?: string; title?: string } }>;
	nextPageToken?: string;
}

export interface VideoItem {
	id: string;
	snippet?: {
		title?: string;
		description?: string;
		channelId?: string;
		channelTitle?: string;
		publishedAt?: string;
		defaultLanguage?: string;
		defaultAudioLanguage?: string;
		liveBroadcastContent?: string;
	};
	contentDetails?: { duration?: string; caption?: string | boolean };
	status?: { embeddable?: boolean; license?: string; privacyStatus?: string };
}

export interface VideosListResponse {
	items?: VideoItem[];
}

export interface ChannelsListResponse {
	items?: Array<{ id?: string }>;
}

export interface YoutubeDataOptions {
	fetch: ResourceFetch;
	/** The learner's key (Configurações → Fontes). Never logged or cached. */
	apiKey: () => string | undefined | Promise<string | undefined>;
	quota?: DailyQuota;
	cache?: TtlCache;
	now?: () => number;
	/** `regionCode` for availability (default "BR"). */
	regionCode?: string;
}

const YOUTUBE_STANDARD_LICENSE: License = Object.freeze({ name: "Licença padrão do YouTube (assistir pelo player oficial)", proprietary: true });
const YOUTUBE_CC_LICENSE: License = Object.freeze({
	name: "CC BY 3.0 (YouTube Creative Commons)",
	spdx: "CC-BY-3.0",
	url: "https://creativecommons.org/licenses/by/3.0/",
	nonCommercial: false,
	shareAlike: false,
});

/** Map one videos.list item to a Resource; undefined when it must not be offered. */
export function mapVideoItem(item: VideoItem, fetchedAt: string): Resource | undefined {
	if (!item.id || !isYoutubeVideoId(item.id)) return undefined;
	const sn = item.snippet ?? {};
	const status = item.status ?? {};
	if (status.embeddable === false) return undefined;
	if (status.privacyStatus && status.privacyStatus !== "public" && status.privacyStatus !== "unlisted") return undefined;
	if (sn.liveBroadcastContent && sn.liveBroadcastContent !== "none") return undefined;
	const durationSec = parseIsoDuration(item.contentDetails?.duration);
	if (durationSec !== undefined && durationSec <= SHORTS_MAX_SECONDS) return undefined;
	const audioLang = sn.defaultAudioLanguage?.trim() || undefined;
	const caption = item.contentDetails?.caption;
	const resource: Resource = {
		id: youtubeResourceId(item.id),
		provider: "youtube-data",
		kind: "video",
		title: sn.title?.trim() || "(sem título)",
		// `lang` is the SPOKEN language: only defaultAudioLanguage proves it. The
		// title language goes to `titleLang` (a hint the core may use only for
		// dub-tolerant domains) — putting it in `lang` let a PT-dubbed or
		// PT-titled video pass as original-audio English.
		lang: audioLang ?? "und",
		license: status.license === "creativeCommon" ? { ...YOUTUBE_CC_LICENSE, attribution: sn.channelTitle ? `${sn.channelTitle} (YouTube)` : undefined } : { ...YOUTUBE_STANDARD_LICENSE },
		access: "stream_only",
		tos: "official_api",
		locator: { kind: "youtube", videoId: item.id },
		url: youtubeWatchUrl(item.id),
		embeddable: true,
		hasManualCaptions: caption === true || caption === "true",
		fetchedAt,
		ttlDays: 30,
	};
	if (audioLang) resource.audioLang = audioLang;
	const titleLang = sn.defaultLanguage?.trim();
	if (titleLang) resource.titleLang = titleLang;
	if (durationSec !== undefined) resource.durationSec = durationSec;
	if (sn.channelId) resource.channelId = sn.channelId;
	if (sn.channelTitle) resource.channelTitle = sn.channelTitle;
	if (sn.channelTitle) resource.creators = [sn.channelTitle];
	if (sn.description) resource.description = sn.description.slice(0, DESCRIPTION_MAX_CHARS);
	if (sn.publishedAt) {
		const year = Number(sn.publishedAt.slice(0, 4));
		if (Number.isInteger(year)) resource.year = year;
	}
	return resource;
}

export interface SearchParams {
	q: string;
	maxResults: number;
	relevanceLanguage?: string;
	regionCode?: string;
	videoDuration?: "any" | "short" | "medium" | "long";
	videoCaption?: "any" | "closedCaption";
	channelId?: string;
}

/** search.list URL WITHOUT the key (cache-safe); the key is appended at fetch time. */
export function buildSearchUrl(p: SearchParams): string {
	const url = new URL(`${YOUTUBE_API_BASE}/search`);
	const s = url.searchParams;
	s.set("part", "snippet");
	s.set("type", "video");
	s.set("videoEmbeddable", "true");
	s.set("safeSearch", "moderate");
	s.set("order", "relevance");
	s.set("maxResults", String(Math.min(50, Math.max(1, Math.floor(p.maxResults)))));
	s.set("q", /(^|\s)-shorts\b/.test(p.q) ? p.q : `${p.q} -shorts`);
	if (p.relevanceLanguage) s.set("relevanceLanguage", primaryLang(p.relevanceLanguage));
	if (p.regionCode) s.set("regionCode", p.regionCode);
	if (p.videoDuration && p.videoDuration !== "any") s.set("videoDuration", p.videoDuration);
	if (p.videoCaption && p.videoCaption !== "any") s.set("videoCaption", p.videoCaption);
	if (p.channelId) s.set("channelId", p.channelId);
	return url.toString();
}

/** videos.list URL (without key) for up to 50 ids. */
export function buildVideosUrl(ids: readonly string[]): string {
	if (ids.length === 0 || ids.length > 50) throw new Error(`videos.list aceita de 1 a 50 ids (recebido ${ids.length}).`);
	const url = new URL(`${YOUTUBE_API_BASE}/videos`);
	url.searchParams.set("part", "snippet,contentDetails,status");
	url.searchParams.set("id", ids.join(","));
	url.searchParams.set("maxResults", "50");
	return url.toString();
}

/** Ordered, de-duplicated video ids of a search.list page. */
export function videoIdsOfSearch(res: SearchListResponse): string[] {
	const out: string[] = [];
	for (const item of res.items ?? []) {
		const id = item.id?.videoId;
		if (id && isYoutubeVideoId(id) && !out.includes(id)) out.push(id);
	}
	return out;
}

/** Map a Data API error body + status to a pt-BR ResourceError. */
export function dataApiError(status: number, body: string): ResourceError {
	let reason = "";
	let message = "";
	try {
		const parsed = JSON.parse(body) as ApiErrorBody;
		reason = parsed.error?.errors?.[0]?.reason ?? "";
		message = parsed.error?.message ?? "";
	} catch {
		// Non-JSON error body: fall back to the status.
	}
	if (reason === "quotaExceeded" || reason === "dailyLimitExceeded" || reason === "rateLimitExceeded") {
		return new ResourceError("youtube-data", "quota", "Cota diária da YouTube Data API esgotada. Ela renova à meia-noite (horário do Pacífico).");
	}
	if (reason === "keyInvalid" || /api key not valid/i.test(message)) {
		return new ResourceError("youtube-data", "unavailable", "A chave da YouTube Data API é inválida. Confira em Configurações → Fontes.");
	}
	if (reason === "accessNotConfigured" || reason === "forbidden" || status === 403) {
		return new ResourceError("youtube-data", "unavailable", "A YouTube Data API v3 não está ativada para esta chave (ative-a no projeto do Google Cloud).");
	}
	if (status === 404) return new ResourceError("youtube-data", "not-found", "Vídeo ou canal não encontrado no YouTube.");
	return new ResourceError("youtube-data", status >= 500 ? "unavailable" : "bad-response", `A YouTube Data API recusou a requisição (HTTP ${status}).`);
}

export class YoutubeDataProvider implements ResourceProvider {
	readonly id = "youtube-data";
	readonly label = "YouTube (API oficial, sua chave)";
	readonly tos = "official_api" as const;
	readonly kinds: Resource["kind"][] = ["video"];
	readonly rate: RateSpec = YOUTUBE_DATA_RATE;
	readonly quota: DailyQuota;
	private readonly options: YoutubeDataOptions;
	private readonly now: () => number;

	constructor(options: YoutubeDataOptions) {
		this.options = options;
		this.now = options.now ?? Date.now;
		this.quota = options.quota ?? new DailyQuota({ ...YOUTUBE_QUOTA_LIMITS }, { now: this.now });
	}

	private async key(): Promise<string | undefined> {
		const k = (await this.options.apiKey())?.trim();
		return k ? k : undefined;
	}

	private async requireKey(): Promise<string> {
		const k = await this.key();
		if (!k) throw new ResourceError(this.id, "unavailable", "Configure sua chave da YouTube Data API em Configurações → Fontes para buscar vídeos.");
		return k;
	}

	async status(): Promise<ProviderStatus> {
		if (!(await this.key())) return { available: false, reason: "Sem chave da YouTube Data API (BYOK). Adicione em Configurações → Fontes." };
		const left = this.quota.left("search");
		if (left === 0) return { available: false, reason: "Cota de buscas do dia esgotada (100/dia). Renova à meia-noite do Pacífico.", budgetLeft: 0 };
		return { available: true, reason: "API oficial com a sua chave.", budgetLeft: left };
	}

	private async call<T>(urlWithoutKey: string, key: string, bucket: "search" | "units", cost: number): Promise<T> {
		const cacheKey = `youtube-data:${urlWithoutKey}`;
		const hit = await this.options.cache?.get<T>(cacheKey, YOUTUBE_TTL_MS);
		if (hit !== undefined) return hit;
		if (!this.quota.tryConsume(bucket, cost)) {
			throw new ResourceError(this.id, "quota", bucket === "search" ? "Cota de buscas do YouTube esgotada por hoje (100/dia)." : "Cota diária de unidades da YouTube Data API esgotada.");
		}
		const url = new URL(urlWithoutKey);
		url.searchParams.set("key", key);
		const res = await this.options.fetch(url.toString(), { headers: { accept: "application/json" } });
		const body = await res.text();
		if (!res.ok) throw dataApiError(res.status, body);
		let parsed: T;
		try {
			parsed = JSON.parse(body) as T;
		} catch {
			throw new ResourceError(this.id, "bad-response", "Resposta inválida da YouTube Data API.");
		}
		await this.options.cache?.set(cacheKey, parsed);
		return parsed;
	}

	/** Videos by id (cached per video; missing ones fetched in batches of 50). */
	async videos(ids: readonly string[]): Promise<Resource[]> {
		const key = await this.requireKey();
		const unique = [...new Set(ids.filter(isYoutubeVideoId))];
		const found = new Map<string, VideoItem>();
		const missing: string[] = [];
		for (const id of unique) {
			const hit = await this.options.cache?.get<VideoItem>(`youtube-data:video:${id}`, YOUTUBE_TTL_MS);
			if (hit) found.set(id, hit);
			else missing.push(id);
		}
		for (let i = 0; i < missing.length; i += 50) {
			const batch = missing.slice(i, i + 50);
			const res = await this.call<VideosListResponse>(buildVideosUrl(batch), key, "units", 1);
			for (const item of res.items ?? []) {
				found.set(item.id, item);
				await this.options.cache?.set(`youtube-data:video:${item.id}`, item);
			}
		}
		const fetchedAt = new Date(this.now()).toISOString();
		return unique.map((id) => found.get(id)).flatMap((item) => (item ? [mapVideoItem(item, fetchedAt)].filter((r): r is Resource => r !== undefined) : []));
	}

	async search(q: ResourceQuery): Promise<Resource[]> {
		if (q.kinds && !q.kinds.includes("video")) return [];
		const key = await this.requireKey();
		const want = Math.min(50, Math.max(1, q.maxResults));
		const langs = (q.langs?.length ? q.langs : ["pt", "en"]).map(primaryLang).filter((l, i, a) => l && a.indexOf(l) === i).slice(0, 2);
		const textFor = (lang: string) => (lang === "en" ? (q.text.en ?? q.text.pt) : (q.text.pt ?? q.text.en)) ?? "";
		const base = { maxResults: want, regionCode: this.options.regionCode ?? "BR", videoDuration: q.videoDuration ?? "any", videoCaption: q.captionsRequired ? ("closedCaption" as const) : ("any" as const) };
		const plans: SearchParams[] = [];
		for (const channelId of (q.channelIds ?? []).slice(0, MAX_CHANNEL_SEARCHES)) plans.push({ ...base, q: textFor(langs[0] ?? "pt"), relevanceLanguage: langs[0], channelId });
		for (const lang of langs) plans.push({ ...base, q: textFor(lang), relevanceLanguage: lang });
		const ids: string[] = [];
		for (const plan of plans) {
			if (!plan.q.trim()) continue;
			if (ids.length >= want) break;
			q.signal?.throwIfAborted();
			let res: SearchListResponse;
			try {
				res = await this.call<SearchListResponse>(buildSearchUrl(plan), key, "search", 1);
			} catch (err) {
				// Out of search budget mid-way: return what we already have.
				if (err instanceof ResourceError && err.code === "quota" && ids.length > 0) break;
				throw err;
			}
			for (const id of videoIdsOfSearch(res)) if (!ids.includes(id)) ids.push(id);
		}
		if (ids.length === 0) return [];
		return (await this.videos(ids)).slice(0, want);
	}

	async resolve(id: string): Promise<Resource> {
		const videoId = videoIdOf(id) ?? (isYoutubeVideoId(id) ? id : undefined);
		if (!videoId) throw new ResourceError(this.id, "invalid-input", `Id de vídeo inválido: "${id}".`);
		const [resource] = await this.videos([videoId]);
		if (!resource) throw new ResourceError(this.id, "not-found", "Vídeo indisponível, privado ou sem permissão de incorporação.");
		return resource;
	}

	/** Curated seed with an unverified id: resolve "@handle" → channel id (1 unit, cached 30 d). */
	async channelIdForHandle(handle: string): Promise<string | undefined> {
		if (!/^@[A-Za-z0-9._-]+$/.test(handle)) throw new ResourceError(this.id, "invalid-input", `Handle de canal inválido: "${handle}".`);
		const key = await this.requireKey();
		const url = new URL(`${YOUTUBE_API_BASE}/channels`);
		url.searchParams.set("part", "id");
		url.searchParams.set("forHandle", handle);
		const res = await this.call<ChannelsListResponse>(url.toString(), key, "units", 1);
		const id = res.items?.[0]?.id;
		return id && /^UC[A-Za-z0-9_-]{22}$/.test(id) ? id : undefined;
	}
}

export function createYoutubeDataProvider(options: YoutubeDataOptions): YoutubeDataProvider {
	return new YoutubeDataProvider(options);
}
