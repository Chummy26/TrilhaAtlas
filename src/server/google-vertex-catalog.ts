import * as fs from "node:fs";
import * as path from "node:path";
import type { Api, Model, ThinkingLevelMap } from "@earendil-works/pi-ai";
import { PATHS } from "../../config.ts";
import bundledSnapshot from "../../config/models-dev-snapshot.json" with { type: "json" };
import { configureGoogleModelsOverlay } from "../agent/models.ts";
import { GOOGLE_VERTEX_PROVIDER } from "../core/contracts/google-vertex.ts";
import { writeFileAtomicSync } from "../store/atomic-write.ts";

const MODELS_DEV_URL = "https://models.dev/api.json";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours fresh
const FETCH_TIMEOUT_MS = 10_000;

const TRACKED_RELEASE_DATE_PROVIDERS = new Set([
	"google-vertex",
	"google",
	"openai",
	"anthropic",
	"openrouter",
	"xai",
	"deepseek",
	"github-copilot",
	"mistral",
	"groq",
	"moonshotai",
	"zai",
	"minimax",
	"together",
	"fireworks",
	"nvidia",
	"cerebras",
	"qwen",
]);

const RELEASE_DATE_PROVIDER_ALIASES: Record<string, string> = {
	chatgpt: "openai",
	"github-copilot-subscription": "github-copilot",
	"xai-subscription": "xai",
};

const NON_CHAT_ID_RE = /(?:embedding|imagen|veo|lyria|chirp|live-translate|live-preview|-tts(?:-|$)|-image(?:-|$)|nano-banana)/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface DiscoveredGoogleModel {
	id: string;
	name: string;
	reasoning: boolean;
	efforts?: string[];
	input: ("text" | "image")[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
	releaseDate?: string;
}

interface ModelsDevCacheFile {
	schemaVersion: 1;
	fetchedAt: number;
	etag?: string;
	vertexModels: DiscoveredGoogleModel[];
	googleModels: DiscoveredGoogleModel[];
	releaseDates: Record<string, string>;
}

interface RawModelsDevModel {
	id?: unknown;
	name?: unknown;
	reasoning?: unknown;
	reasoning_options?: unknown;
	modalities?: { input?: unknown; output?: unknown };
	limit?: { context?: unknown; output?: unknown };
	cost?: { input?: unknown; output?: unknown; cache_read?: unknown; cache_write?: unknown };
	release_date?: unknown;
}

interface RawModelsDevCatalog {
	[providerId: string]: { models?: Record<string, RawModelsDevModel> } | undefined;
}

let memoryCache: { dataDir: string; payload: ModelsDevCacheFile } | undefined;
let inflightRefresh: Promise<void> | undefined;

function cacheFilePath(): string {
	return path.join(PATHS.data, "profile", "model-cache", "models-dev-catalog.json");
}

function readCacheFromDisk(): ModelsDevCacheFile | null {
	const dataDir = PATHS.data;
	if (memoryCache?.dataDir === dataDir) return memoryCache.payload;
	try {
		const raw = fs.readFileSync(cacheFilePath(), "utf8");
		const parsed = JSON.parse(raw) as Partial<ModelsDevCacheFile>;
		if (
			parsed.schemaVersion === 1
			&& typeof parsed.fetchedAt === "number"
			&& Array.isArray(parsed.vertexModels)
			&& Array.isArray(parsed.googleModels)
			&& parsed.releaseDates
			&& typeof parsed.releaseDates === "object"
		) {
			const payload = parsed as ModelsDevCacheFile;
			memoryCache = { dataDir, payload };
			return payload;
		}
	} catch {
		// Cache missing or unreadable; fall back to built-ins until refreshed.
	}
	return null;
}

function writeCacheToDisk(payload: ModelsDevCacheFile): void {
	const file = cacheFilePath();
	fs.mkdirSync(path.dirname(file), { recursive: true });
	writeFileAtomicSync(file, JSON.stringify(payload), { allowInPlaceFallback: true });
	memoryCache = { dataDir: PATHS.data, payload };
}

function extractGoogleEfforts(rawOptions: unknown): string[] | undefined {
	if (!Array.isArray(rawOptions)) return undefined;
	for (const opt of rawOptions) {
		if (opt && typeof opt === "object" && (opt as { type?: unknown }).type === "effort") {
			const values = (opt as { values?: unknown }).values;
			if (Array.isArray(values)) {
				const allowed = values.filter((v): v is string => typeof v === "string");
				if (allowed.length > 0) return allowed;
			}
		}
	}
	return undefined;
}

function toGoogleThinkingLevelMap(efforts: readonly string[] | undefined): ThinkingLevelMap | undefined {
	if (!efforts?.length) return undefined;
	const set = new Set(efforts.map((v) => v.toLowerCase()));
	// pi-ai's Google wire mapper supports minimal | low | medium | high.
	const map: ThinkingLevelMap = {
		off: null,
		minimal: set.has("minimal") ? "minimal" : null,
		low: set.has("low") ? "low" : null,
		medium: set.has("medium") ? "medium" : null,
		high: set.has("high") || set.has("xhigh") || set.has("max") ? "high" : null,
		xhigh: null,
		max: null,
	};
	return map.minimal || map.low || map.medium || map.high ? map : undefined;
}

function toFiniteNonNeg(value: unknown, fallback = 0): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function toPositiveInt(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function parseGoogleChatModels(rawModels: Record<string, RawModelsDevModel> | undefined): DiscoveredGoogleModel[] {
	if (!rawModels || typeof rawModels !== "object") return [];
	const out: DiscoveredGoogleModel[] = [];
	for (const [key, entry] of Object.entries(rawModels)) {
		if (!entry || typeof entry !== "object") continue;
		const id = typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : key.trim();
		if (!id || !/^(?:gemini|gemma)/i.test(id) || NON_CHAT_ID_RE.test(id)) continue;

		const outputs = Array.isArray(entry.modalities?.output) ? entry.modalities.output : null;
		if (outputs && !outputs.includes("text")) continue;

		const inputs = Array.isArray(entry.modalities?.input) ? entry.modalities.input : ["text", "image"];
		const modalities: ("text" | "image")[] = inputs.includes("image") ? ["text", "image"] : ["text"];
		const releaseDate = typeof entry.release_date === "string" && ISO_DATE_RE.test(entry.release_date)
			? entry.release_date
			: undefined;

		out.push({
			id,
			name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : id,
			reasoning: Boolean(entry.reasoning),
			efforts: extractGoogleEfforts(entry.reasoning_options),
			input: modalities,
			cost: {
				input: toFiniteNonNeg(entry.cost?.input),
				output: toFiniteNonNeg(entry.cost?.output),
				cacheRead: toFiniteNonNeg(entry.cost?.cache_read),
				cacheWrite: toFiniteNonNeg(entry.cost?.cache_write),
			},
			contextWindow: toPositiveInt(entry.limit?.context, 1_048_576),
			maxTokens: toPositiveInt(entry.limit?.output, 65_536),
			...(releaseDate ? { releaseDate } : {}),
		});
	}
	return out;
}

/** Extract slimmed Google/Vertex chat models and cross-provider release dates from models.dev JSON. */
export function parseModelsDevPayload(raw: RawModelsDevCatalog, etag?: string, now = Date.now()): ModelsDevCacheFile {
	const releaseDates: Record<string, string> = {};
	for (const providerId of TRACKED_RELEASE_DATE_PROVIDERS) {
		const models = raw[providerId]?.models;
		if (!models || typeof models !== "object") continue;
		for (const [key, entry] of Object.entries(models)) {
			const id = typeof entry?.id === "string" && entry.id.trim() ? entry.id.trim() : key.trim();
			const date = entry?.release_date;
			if (id && typeof date === "string" && ISO_DATE_RE.test(date)) {
				releaseDates[`${providerId}:${id}`] = date;
			}
		}
	}
	return {
		schemaVersion: 1,
		fetchedAt: now,
		...(etag ? { etag } : {}),
		vertexModels: parseGoogleChatModels(raw["google-vertex"]?.models),
		googleModels: parseGoogleChatModels(raw.google?.models),
		releaseDates,
	};
}

function toPiModel(providerId: "google-vertex" | "google", entry: DiscoveredGoogleModel): Model<Api> {
	const thinkingLevelMap = entry.reasoning ? toGoogleThinkingLevelMap(entry.efforts) : undefined;
	return {
		id: entry.id,
		name: entry.name,
		api: providerId === GOOGLE_VERTEX_PROVIDER ? "google-vertex" : "google-generative-ai",
		provider: providerId,
		baseUrl: providerId === GOOGLE_VERTEX_PROVIDER
			? "https://{location}-aiplatform.googleapis.com"
			: "https://generativelanguage.googleapis.com/v1beta",
		reasoning: entry.reasoning,
		...(thinkingLevelMap ? { thinkingLevelMap } : {}),
		input: [...entry.input],
		cost: { ...entry.cost },
		contextWindow: entry.contextWindow,
		maxTokens: entry.maxTokens,
	};
}

const BUNDLED_CATALOG = bundledSnapshot as ModelsDevCacheFile;

function readEffectiveCatalog(): ModelsDevCacheFile {
	return readCacheFromDisk() ?? BUNDLED_CATALOG;
}

/** Cached newly discovered Google / Google Vertex models (with bundled offline fallback). */
export function discoveredGoogleModels(providerId: "google-vertex" | "google"): Model<Api>[] {
	const cache = readEffectiveCatalog();
	const list = providerId === GOOGLE_VERTEX_PROVIDER ? cache.vertexModels : cache.googleModels;
	return list.map((entry) => toPiModel(providerId, entry));
}

/** Look up ISO release date (YYYY-MM-DD) for any catalog model from the cached/bundled models.dev index. */
export function modelReleaseDate(provider: string, id: string): string | undefined {
	const cache = readEffectiveCatalog();
	const exact = cache.releaseDates[`${provider}:${id}`];
	if (exact) return exact;
	const alias = RELEASE_DATE_PROVIDER_ALIASES[provider];
	if (alias) {
		const aliased = cache.releaseDates[`${alias}:${id}`];
		if (aliased) return aliased;
	}
	if (provider === "openrouter" && id.startsWith("~")) {
		return cache.releaseDates[`openrouter:${id.slice(1)}`];
	}
	return undefined;
}

/** Refresh slimmed models.dev catalog with ETag + TTL. Silent no-op on network errors or offline tests. */
export async function refreshModelsDevCatalog(options?: {
	force?: boolean;
	fetchImpl?: typeof fetch;
}): Promise<void> {
	if (!options?.fetchImpl && process.env.NODE_ENV === "test") return;
	const existing = readCacheFromDisk();
	if (!options?.force && existing && Date.now() - existing.fetchedAt < CACHE_TTL_MS) return;

	if (inflightRefresh && !options?.fetchImpl) return inflightRefresh;

	const run = async () => {
		try {
			const fetcher = options?.fetchImpl ?? globalThis.fetch;
			const headers: Record<string, string> = { Accept: "application/json" };
			if (existing?.etag) headers["If-None-Match"] = existing.etag;
			const response = await fetcher(MODELS_DEV_URL, {
				headers,
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});
			if (response.status === 304 && existing) {
				writeCacheToDisk({ ...existing, fetchedAt: Date.now() });
				return;
			}
			if (!response.ok) return;
			const json = (await response.json()) as RawModelsDevCatalog;
			const parsed = parseModelsDevPayload(json, response.headers.get("etag") ?? undefined);
			if (parsed.vertexModels.length > 0 || parsed.googleModels.length > 0 || Object.keys(parsed.releaseDates).length > 0) {
				writeCacheToDisk(parsed);
			}
		} catch {
			// Offline or timeout: keep existing disk cache / pi-ai built-ins without blocking the picker.
		}
	};

	if (options?.fetchImpl) {
		await run();
		return;
	}
	inflightRefresh = run().finally(() => { inflightRefresh = undefined; });
	await inflightRefresh;
}

/** Wire the dynamic models overlay into piModels() at server boot. */
export function installGoogleModelsCatalogOverlay(): void {
	configureGoogleModelsOverlay(discoveredGoogleModels);
}

/** Reset in-memory cache (for tests switching LH_DATA_DIR). */
export function resetModelsDevCatalogCacheForTest(): void {
	memoryCache = undefined;
	inflightRefresh = undefined;
}
