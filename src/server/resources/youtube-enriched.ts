/**
 * Enriched YouTube mode via youtubei.js (InnerTube) — OPT-IN, off by default
 * (SÍNTESE §2.8 "Modo enriquecido (opt-in, desligado): youtubei.js@18.3.0
 * (MIT) para lista de legendas, is_auto_dubbed e transcrição"; r6 §3.1, §5.2,
 * §8; extra-LuanRT__YouTube.js §6.6, §8.2).
 *
 * Why opt-in: the YouTube ToS forbid automated access outside the official
 * API/player; the learner turns this on knowingly, it runs locally on their
 * machine at ≤ 1 req/s with a 30-day cache, and media is NEVER downloaded.
 * It provides what the official API cannot give third parties:
 *   - caption tracks (manual vs ASR, translatable) → `Resource.captions`;
 *   - audio tracks with `is_auto_dubbed` / `is_dubbed` / `is_original`
 *     (from the format xtags `acont`) → `Resource.audioTracks`;
 *   - transcripts: `get_transcript` answers 400 since Dec/2025, so the path
 *     is player `captionTracks[].baseUrl` + `fmt=json3` (timedtext), fetched
 *     through the same allowlisted safe fetch; parsed and cut into 20–90 s
 *     segments (core segments.ts). Tracks that demand a PO token
 *     (`exp=xpe|xpv`) are skipped with an honest error.
 * Client order per video: ANDROID → ANDROID_VR (no PO token for captions).
 * The InnerTube client is injectable (tests use a fake); the default one is
 * created lazily with `retrieve_player: false` and our fetch.
 */

import { segmentsInRange, buildSegments, parseTimedText, type TranscriptSegment } from "../../core/resources/segments.ts";
import {
	ResourceError,
	type AudioTrackInfo,
	type CaptionInfo,
	type ContentChunk,
	type ProviderStatus,
	type RateSpec,
	type Resource,
	type ResourceProvider,
	type ResourceQuery,
	type Span,
} from "../../core/resources/types.ts";
import {
	buildTimedTextUrl,
	isYoutubeVideoId,
	needsPoToken,
	selectCaptionTrack,
	selectOriginalTrack,
	videoIdOf,
	youtubeResourceId,
	youtubeWatchUrl,
	type CaptionTrackRef,
} from "../../core/resources/youtube.ts";
import { estimateTokens } from "../../core/resources/chunking.ts";
import { primaryLang } from "../../core/resources/language-fit.ts";
import { YOUTUBE_TTL_MS, type TtlCache } from "./cache.ts";
import type { ResourceFetch } from "./safe-fetch.ts";

export const YOUTUBE_ENRICHED_RATE: RateSpec = Object.freeze({ minIntervalMs: 1000 });
const CLIENTS = ["ANDROID", "ANDROID_VR"] as const;

// ─── structural view of the youtubei.js objects we read ─────────────────────

interface TextLike {
	text?: string;
	toString(): string;
}

export interface CaptionTrackLike {
	base_url: string;
	language_code: string;
	vss_id?: string;
	kind?: string;
	is_translatable?: boolean;
	name?: TextLike | string;
}

export interface FormatLike {
	has_audio?: boolean;
	has_video?: boolean;
	language?: string | null;
	is_auto_dubbed?: boolean;
	is_dubbed?: boolean;
	is_original?: boolean;
	is_descriptive?: boolean;
	is_secondary?: boolean;
	audio_track?: { id?: string; display_name?: string; audio_is_default?: boolean };
}

export interface BasicInfoLike {
	basic_info?: { id?: string; title?: string; duration?: number; channel_id?: string; author?: string; short_description?: string; is_live?: boolean };
	playability_status?: { status?: string; reason?: string };
	captions?: { caption_tracks?: CaptionTrackLike[] };
	streaming_data?: { adaptive_formats?: FormatLike[] };
}

export interface SearchVideoLike {
	id?: string;
	video_id?: string;
	title?: TextLike | string;
	author?: { id?: string; name?: string };
	duration?: { seconds?: number };
	is_live?: boolean;
}

export interface InnertubeLike {
	getBasicInfo(videoId: string, options?: { client?: string }): Promise<BasicInfoLike>;
	search?(query: string, filters?: Record<string, unknown>): Promise<{ videos?: ArrayLike<unknown> }>;
}

// ─── pure mappers (exported for tests) ───────────────────────────────────────

function textOf(t: TextLike | string | undefined): string {
	if (t === undefined) return "";
	if (typeof t === "string") return t;
	return t.text ?? t.toString();
}

/** InnerTube caption tracks → our refs (vss_id "a.xx" or kind "asr" = ASR). */
export function captionRefs(tracks: readonly CaptionTrackLike[] | undefined): CaptionTrackRef[] {
	return (tracks ?? [])
		.filter((t) => typeof t.base_url === "string" && t.base_url && t.language_code)
		.map((t) => ({
			baseUrl: t.base_url,
			lang: t.language_code,
			kind: t.kind === "asr" || t.vss_id?.startsWith("a.") ? ("asr" as const) : ("manual" as const),
			translatable: Boolean(t.is_translatable),
			...(t.name !== undefined ? { name: textOf(t.name) } : {}),
		}));
}

export function captionInfos(refs: readonly CaptionTrackRef[]): CaptionInfo[] {
	return refs.map((r) => ({ lang: r.lang, kind: r.kind, translatable: r.translatable }));
}

/** Audio-only formats → distinct (lang, kind) tracks (r6 §5.2 `audioTracksOf`). */
export function audioTracksOf(formats: readonly FormatLike[] | undefined): AudioTrackInfo[] {
	const seen = new Map<string, AudioTrackInfo>();
	for (const f of formats ?? []) {
		if (!f.has_audio || f.has_video) continue;
		const lang = f.language ?? f.audio_track?.id?.split(".")[0] ?? "und";
		const kind: AudioTrackInfo["kind"] = f.is_auto_dubbed
			? "dubbed-auto"
			: f.is_dubbed
				? "dubbed"
				: f.is_descriptive
					? "descriptive"
					: f.is_secondary
						? "secondary"
						: f.is_original
							? "original"
							: "unknown";
		const key = `${lang}|${kind}`;
		if (!seen.has(key)) {
			const track: AudioTrackInfo = { lang, kind, isDefault: Boolean(f.audio_track?.audio_is_default) };
			if (f.audio_track?.display_name) track.displayName = f.audio_track.display_name;
			seen.set(key, track);
		}
	}
	return [...seen.values()];
}

/** A language tag that names a language ("und"/empty = unknown). */
function knownLang(lang: string | undefined): lang is string {
	const p = primaryLang(lang);
	return p !== "" && p !== "und";
}

/**
 * Spoken language: the original audio track, else the ASR track language,
 * else the default audio track — each only when its language is KNOWN.
 * Single-track videos carry no xtags, so youtubei.js reports
 * `language: null, is_original: true` and the track is tagged "und"; that
 * must fall through to the ASR caption language instead of hiding it.
 */
export function spokenLanguage(audio: readonly AudioTrackInfo[], refs: readonly CaptionTrackRef[]): string | undefined {
	return (
		audio.find((t) => t.kind === "original" && knownLang(t.lang))?.lang ??
		refs.find((r) => r.kind === "asr" && knownLang(r.lang))?.lang ??
		audio.find((t) => t.isDefault && t.kind !== "dubbed" && t.kind !== "dubbed-auto" && knownLang(t.lang))?.lang
	);
}

/** Enriched fields to merge into a Resource. */
export interface Enrichment {
	captions: CaptionInfo[];
	audioTracks: AudioTrackInfo[];
	audioLang?: string;
	durationSec?: number;
	title?: string;
	channelId?: string;
	channelTitle?: string;
	description?: string;
}

export function enrichmentOf(info: BasicInfoLike): Enrichment {
	const refs = captionRefs(info.captions?.caption_tracks);
	const audioTracks = audioTracksOf(info.streaming_data?.adaptive_formats);
	const audioLang = spokenLanguage(audioTracks, refs);
	const b = info.basic_info ?? {};
	return {
		captions: captionInfos(refs),
		audioTracks,
		...(audioLang ? { audioLang } : {}),
		...(typeof b.duration === "number" && b.duration > 0 ? { durationSec: b.duration } : {}),
		...(b.title ? { title: b.title } : {}),
		...(b.channel_id ? { channelId: b.channel_id } : {}),
		...(b.author ? { channelTitle: b.author } : {}),
		...(b.short_description ? { description: b.short_description.slice(0, 5000) } : {}),
	};
}

/** Merge enrichment into an existing (e.g. Data API) resource. */
export function applyEnrichment(resource: Resource, e: Enrichment): Resource {
	return {
		...resource,
		captions: e.captions,
		audioTracks: e.audioTracks,
		...(e.audioLang ? { audioLang: e.audioLang, lang: e.audioLang } : {}),
		...(resource.durationSec === undefined && e.durationSec !== undefined ? { durationSec: e.durationSec } : {}),
	};
}

export interface Transcript {
	videoId: string;
	lang: string;
	kind: "manual" | "asr";
	translatedTo?: string;
	source: "android" | "android_vr";
	fetchedAt: string;
	segments: TranscriptSegment[];
}

export interface YoutubeEnrichedOptions {
	fetch: ResourceFetch;
	/** The learner's explicit opt-in (Configurações → Fontes). */
	optIn: () => boolean;
	/** InnerTube client factory; default: youtubei.js with our fetch. */
	client?: () => Promise<InnertubeLike>;
	cache?: TtlCache;
	now?: () => number;
}

/** Adapt our ResourceFetch to the (Request, init) calls youtubei.js makes. */
export function innertubeFetch(fetch: ResourceFetch): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
	return async (input, init = {}) => {
		const req = input instanceof Request ? input : undefined;
		const url = req ? req.url : input instanceof URL ? input.toString() : String(input);
		const headers = new Headers(req?.headers);
		new Headers(init.headers).forEach((value, key) => headers.set(key, value));
		const method = init.method ?? req?.method ?? "GET";
		let body = init.body ?? undefined;
		if (body === undefined && req && method !== "GET" && method !== "HEAD") body = await req.text();
		return fetch(url, { method, headers, body, ...(init.signal ? { signal: init.signal } : {}) });
	};
}

function defaultClient(fetch: ResourceFetch): () => Promise<InnertubeLike> {
	let pending: Promise<InnertubeLike> | undefined;
	return () => {
		pending ??= import("youtubei.js")
			.then(async (mod) => {
				mod.Log.setLevel(mod.Log.Level.ERROR);
				const yt = await mod.Innertube.create({
					fetch: innertubeFetch(fetch) as typeof globalThis.fetch,
					retrieve_player: false,
					generate_session_locally: true,
					retrieve_innertube_config: false,
					lang: "en",
					location: "US",
				});
				return yt as unknown as InnertubeLike;
			})
			.catch((err: unknown) => {
				pending = undefined;
				throw new ResourceError("youtube-enriched", "unavailable", `Não foi possível iniciar o cliente do modo enriquecido: ${err instanceof Error ? err.message : String(err)}`);
			});
		return pending;
	};
}

export class YoutubeEnrichedProvider implements ResourceProvider {
	readonly id = "youtube-enriched";
	readonly label = "YouTube — modo enriquecido (opcional, cliente não oficial)";
	readonly tos = "opt_in_gray" as const;
	readonly kinds: Resource["kind"][] = ["video"];
	readonly rate: RateSpec = YOUTUBE_ENRICHED_RATE;
	private readonly options: YoutubeEnrichedOptions;
	private readonly client: () => Promise<InnertubeLike>;
	private readonly now: () => number;

	constructor(options: YoutubeEnrichedOptions) {
		this.options = options;
		this.client = options.client ?? defaultClient(options.fetch);
		this.now = options.now ?? Date.now;
	}

	async status(): Promise<ProviderStatus> {
		if (!this.options.optIn()) {
			return {
				available: false,
				optIn: true,
				reason: "Modo enriquecido desligado. Ele usa um cliente não oficial do YouTube para ler legendas, dublagem e transcrições; ative em Configurações → Fontes se quiser.",
			};
		}
		return { available: true, optIn: true, reason: "Modo enriquecido ativo (legendas, dublagem e transcrição; cache de 30 dias)." };
	}

	private assertOptIn(): void {
		if (!this.options.optIn()) throw new ResourceError(this.id, "unavailable", "Modo enriquecido desligado (opt-in em Configurações → Fontes).");
	}

	/** Player info with the ANDROID → ANDROID_VR fallback; never cached (holds short-lived URLs). */
	async basicInfo(videoId: string): Promise<{ info: BasicInfoLike; client: (typeof CLIENTS)[number] }> {
		this.assertOptIn();
		if (!isYoutubeVideoId(videoId)) throw new ResourceError(this.id, "invalid-input", `Id de vídeo inválido: "${videoId}".`);
		const yt = await this.client();
		const errors: string[] = [];
		for (const client of CLIENTS) {
			try {
				const info = await yt.getBasicInfo(videoId, { client });
				const status = info.playability_status?.status;
				if (status && status !== "OK") {
					errors.push(`${client}: ${status}${info.playability_status?.reason ? ` (${info.playability_status.reason})` : ""}`);
					continue;
				}
				return { info, client };
			} catch (err) {
				errors.push(`${client}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
		throw new ResourceError(this.id, "unavailable", `O YouTube não liberou os dados deste vídeo (${errors.join("; ")}). Pode ser verificação anti-robô; tente mais tarde.`);
	}

	/** Enrichment (captions + audio tracks), cached 30 days. */
	async enrich(videoId: string): Promise<Enrichment> {
		const key = `youtube-enriched:enrich:${videoId}`;
		const hit = await this.options.cache?.get<Enrichment>(key, YOUTUBE_TTL_MS);
		if (hit) return hit;
		const { info } = await this.basicInfo(videoId);
		const e = enrichmentOf(info);
		await this.options.cache?.set(key, e);
		return e;
	}

	async resolve(id: string): Promise<Resource> {
		const videoId = videoIdOf(id) ?? (isYoutubeVideoId(id) ? id : undefined);
		if (!videoId) throw new ResourceError(this.id, "invalid-input", `Id de vídeo inválido: "${id}".`);
		const e = await this.enrich(videoId);
		const resource: Resource = {
			id: youtubeResourceId(videoId),
			provider: this.id,
			kind: "video",
			title: e.title ?? "(sem título)",
			lang: e.audioLang ?? "und",
			captions: e.captions,
			audioTracks: e.audioTracks,
			license: { name: "Licença padrão do YouTube (assistir pelo player oficial)", proprietary: true },
			access: "stream_only",
			tos: this.tos,
			locator: { kind: "youtube", videoId },
			url: youtubeWatchUrl(videoId),
			fetchedAt: new Date(this.now()).toISOString(),
			ttlDays: 30,
		};
		if (e.audioLang) resource.audioLang = e.audioLang;
		if (e.durationSec !== undefined) resource.durationSec = e.durationSec;
		if (e.channelId) resource.channelId = e.channelId;
		if (e.channelTitle) {
			resource.channelTitle = e.channelTitle;
			resource.creators = [e.channelTitle];
		}
		if (e.description) resource.description = e.description;
		return resource;
	}

	async search(q: ResourceQuery): Promise<Resource[]> {
		this.assertOptIn();
		if (q.kinds && !q.kinds.includes("video")) return [];
		const yt = await this.client();
		if (!yt.search) return [];
		const text = (q.langs?.[0] && primaryLang(q.langs[0]) === "en" ? (q.text.en ?? q.text.pt) : (q.text.pt ?? q.text.en)) ?? "";
		if (!text.trim()) return [];
		const duration = q.videoDuration === "short" ? "under_three_mins" : q.videoDuration === "long" ? "over_twenty_mins" : q.videoDuration === "medium" ? "three_to_twenty_mins" : undefined;
		const result = await yt.search(text, { type: "video", prioritize: "relevance", ...(duration ? { duration } : {}), ...(q.captionsRequired ? { features: ["subtitles"] } : {}) });
		const out: Resource[] = [];
		const fetchedAt = new Date(this.now()).toISOString();
		for (const raw of Array.from(result.videos ?? []) as SearchVideoLike[]) {
			const videoId = raw.video_id ?? raw.id;
			if (!videoId || !isYoutubeVideoId(videoId) || raw.is_live) continue;
			const seconds = raw.duration?.seconds;
			if (seconds !== undefined && seconds <= 60) continue;
			const r: Resource = {
				id: youtubeResourceId(videoId),
				provider: this.id,
				kind: "video",
				title: textOf(raw.title) || "(sem título)",
				lang: "und",
				license: { name: "Licença padrão do YouTube (assistir pelo player oficial)", proprietary: true },
				access: "stream_only",
				tos: this.tos,
				locator: { kind: "youtube", videoId },
				url: youtubeWatchUrl(videoId),
				fetchedAt,
				ttlDays: 30,
			};
			if (seconds !== undefined) r.durationSec = seconds;
			if (raw.author?.id) r.channelId = raw.author.id;
			if (raw.author?.name) r.channelTitle = raw.author.name;
			out.push(r);
			if (out.length >= q.maxResults) break;
		}
		return out;
	}

	/**
	 * Transcript in `want` (or the original audio language when omitted —
	 * best for RAG, r6 §4.3), as 20–90 s segments; cached 30 days.
	 */
	async transcript(videoId: string, want?: string): Promise<Transcript> {
		const key = `youtube-enriched:transcript:${videoId}:${want ?? "orig"}`;
		const hit = await this.options.cache?.get<Transcript>(key, YOUTUBE_TTL_MS);
		if (hit) return hit;
		const { info, client } = await this.basicInfo(videoId);
		const refs = captionRefs(info.captions?.caption_tracks);
		if (refs.length === 0) throw new ResourceError(this.id, "not-found", "Este vídeo não tem legendas disponíveis.");
		const audio = audioTracksOf(info.streaming_data?.adaptive_formats);
		const spoken = spokenLanguage(audio, refs);
		const choice = want ? selectCaptionTrack(refs, want, spoken) : { track: selectOriginalTrack(refs, spoken)! };
		if (!choice?.track) throw new ResourceError(this.id, "not-found", "Nenhuma trilha de legenda utilizável.");
		if (needsPoToken(choice.track.baseUrl)) {
			throw new ResourceError(this.id, "unavailable", "Esta legenda exige um token de verificação (PO token) que o modo enriquecido não gera; sem transcrição para este vídeo.");
		}
		const url = buildTimedTextUrl(choice.track.baseUrl, { fmt: "json3", ...(choice.translateTo ? { tlang: choice.translateTo } : {}) });
		const res = await this.options.fetch(url, { maxBytes: 2 * 1024 * 1024 });
		if (!res.ok) throw new ResourceError(this.id, res.status === 429 ? "quota" : "unavailable", `Falha ao baixar a legenda (HTTP ${res.status}).`);
		const body = await res.text();
		if (!body.trim()) throw new ResourceError(this.id, "unavailable", "O YouTube devolveu uma legenda vazia (provável bloqueio anti-robô).");
		const segments = buildSegments(parseTimedText(body));
		const transcript: Transcript = {
			videoId,
			lang: choice.translateTo ?? choice.track.lang,
			kind: choice.track.kind,
			...(choice.translateTo ? { translatedTo: choice.translateTo } : {}),
			source: client === "ANDROID" ? "android" : "android_vr",
			fetchedAt: new Date(this.now()).toISOString(),
			segments,
		};
		await this.options.cache?.set(key, transcript);
		return transcript;
	}

	/** Transcript segments (optionally within a time span) as ContentChunks — DATA for the tutor. */
	async content(id: string, span?: Span): Promise<ContentChunk[]> {
		const videoId = videoIdOf(id) ?? (isYoutubeVideoId(id) ? id : undefined);
		if (!videoId) throw new ResourceError(this.id, "invalid-input", `Id de vídeo inválido: "${id}".`);
		const t = await this.transcript(videoId);
		const segs = span?.startSec !== undefined || span?.endSec !== undefined ? segmentsInRange(t.segments, span.startSec ?? 0, span.endSec ?? Number.POSITIVE_INFINITY) : t.segments;
		const resourceId = youtubeResourceId(videoId);
		return segs.map((s) => ({
			id: `${resourceId}|t|${s.locator}`,
			resourceId,
			breadcrumb: [],
			text: s.text,
			tokens: estimateTokens(s.text),
			span: { startSec: s.start, endSec: s.end },
		}));
	}
}

export function createYoutubeEnrichedProvider(options: YoutubeEnrichedOptions): YoutubeEnrichedProvider {
	return new YoutubeEnrichedProvider(options);
}
