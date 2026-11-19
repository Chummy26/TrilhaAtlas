/**
 * ResourceRegistry: aggregates the providers, their status and per-provider
 * pacing (SÍNTESE §2.8 "Fontes"; r6 §11.1 `ResourceProvider` registry and
 * §11.3 "cada um com `rate` próprio"; §13 order of preference by legal
 * class).
 *
 *  register(build, prefixes)  builds a provider around a fetch that passes
 *                             through ITS OWN RateGate (one request in
 *                             flight, ≥ rate.minIntervalMs between starts);
 *  add(provider, prefixes)    providers that do no network I/O (library);
 *  statusAll()                every provider's ProviderStatus (failures →
 *                             unavailable with the error message);
 *  live(kind?)                available providers, ordered by legal class:
 *                             official_api > open_license > user_owned >
 *                             metadata_only > embed_only > opt_in_gray;
 *  search(q)                  fan-out to live providers that serve the
 *                             requested kinds (in parallel: gates are per
 *                             provider), merged without duplicates, plus
 *                             the per-provider errors (never thrown: one
 *                             failing source must not hide the others);
 *  resolve/toc/content(id)    dispatched by id prefix (ids.ts) to the first
 *                             AVAILABLE provider registered for it that
 *                             implements the method ("yt:" → Data API first,
 *                             then the opt-in enriched provider).
 * `createDefaultRegistry` wires every adapter of this module with the
 * allowlisted fetch, a cache and the YouTube quota.
 */

import * as path from "node:path";
import { tryParseResourceId } from "../../core/resources/ids.ts";
import { ResourceError, type ContentChunk, type ProviderStatus, type Resource, type ResourceKind, type ResourceProvider, type ResourceQuery, type Span, type TocEntry, type TosClass } from "../../core/resources/types.ts";
import { createArxivProvider } from "./arxiv.ts";
import { FileTtlCache, jsonFileQuotaStore, MemoryTtlCache, type TtlCache } from "./cache.ts";
import { createCrossrefProvider } from "./crossref.ts";
import { createKuphaldtProvider } from "./kuphaldt.ts";
import { createLibretextsProvider } from "./libretexts.ts";
import { createOpenLibraryProvider } from "./openlibrary.ts";
import { createOpenstaxProvider } from "./openstax.ts";
import { createOtlProvider } from "./otl.ts";
import { DailyQuota, gatedFetch, RateGate, SYSTEM_CLOCK, type Clock } from "./rate-limit.ts";
import { createResourceFetch, type ResourceFetch } from "./safe-fetch.ts";
import { createUserLibraryProvider } from "./user-library.ts";
import { createWikibooksProvider } from "./wikibooks.ts";
import { createYoutubeDataProvider, YOUTUBE_QUOTA_LIMITS } from "./youtube-data.ts";
import { createYoutubeEnrichedProvider } from "./youtube-enriched.ts";

export const TOS_ORDER: readonly TosClass[] = Object.freeze(["official_api", "open_license", "user_owned", "metadata_only", "embed_only", "opt_in_gray"]);

export interface ProviderError {
	provider: string;
	code: ResourceError["code"] | "error";
	message: string;
}

export interface SearchOutcome {
	results: Resource[];
	errors: ProviderError[];
	/** Providers asked (after kind/availability filtering), in order. */
	asked: string[];
}

export interface ProviderReport extends ProviderStatus {
	id: string;
	label: string;
	tos: TosClass;
	kinds: ResourceKind[];
	minIntervalMs: number;
}

interface Entry {
	provider: ResourceProvider;
	prefixes: readonly string[];
	gate?: RateGate;
}

function toProviderError(provider: string, err: unknown): ProviderError {
	if (err instanceof ResourceError) return { provider, code: err.code, message: err.message };
	return { provider, code: "error", message: err instanceof Error ? err.message : String(err) };
}

export class ResourceRegistry {
	private readonly entries: Entry[] = [];
	private readonly clock: Clock;

	constructor(options: { clock?: Clock } = {}) {
		this.clock = options.clock ?? SYSTEM_CLOCK;
	}

	/** Build a provider around `fetch` gated by its own RateGate (interval = provider.rate). */
	register<T extends ResourceProvider>(fetch: ResourceFetch, build: (gated: ResourceFetch) => T, prefixes: readonly string[]): T {
		let gate: RateGate | undefined;
		const gated: ResourceFetch = (url, init) => {
			if (!gate) throw new ResourceError("registry", "unavailable", "Provedor ainda não registrado.");
			return gatedFetch(fetch, gate)(url, init);
		};
		const provider = build(gated);
		gate = new RateGate(provider.rate.minIntervalMs, this.clock);
		this.push({ provider, prefixes, gate });
		return provider;
	}

	/** Add a provider that does its own I/O (or none). */
	add<T extends ResourceProvider>(provider: T, prefixes: readonly string[]): T {
		this.push({ provider, prefixes });
		return provider;
	}

	private push(entry: Entry): void {
		if (this.entries.some((e) => e.provider.id === entry.provider.id)) throw new Error(`Provedor duplicado: "${entry.provider.id}".`);
		this.entries.push(entry);
	}

	get(id: string): ResourceProvider | undefined {
		return this.entries.find((e) => e.provider.id === id)?.provider;
	}

	all(): ResourceProvider[] {
		return this.entries.map((e) => e.provider);
	}

	/** Providers registered for the prefix of `resourceId`, registration order. */
	providersFor(resourceId: string): ResourceProvider[] {
		const parsed = tryParseResourceId(resourceId);
		if (!parsed) return [];
		return this.entries.filter((e) => e.prefixes.includes(parsed.prefix)).map((e) => e.provider);
	}

	private async statusOf(p: ResourceProvider): Promise<ProviderStatus> {
		try {
			return await p.status();
		} catch (err) {
			return { available: false, reason: err instanceof Error ? err.message : String(err) };
		}
	}

	async statusAll(): Promise<ProviderReport[]> {
		return Promise.all(
			this.entries.map(async ({ provider: p }) => ({
				id: p.id,
				label: p.label,
				tos: p.tos,
				kinds: [...p.kinds],
				minIntervalMs: p.rate.minIntervalMs,
				...(await this.statusOf(p)),
			})),
		);
	}

	/** Available providers (optionally serving `kind`), ordered by legal class then registration. */
	async live(kind?: ResourceKind): Promise<ResourceProvider[]> {
		const candidates = this.entries.map((e, index) => ({ p: e.provider, index })).filter(({ p }) => !kind || p.kinds.includes(kind));
		const statuses = await Promise.all(candidates.map(({ p }) => this.statusOf(p)));
		return candidates
			.filter((_, i) => statuses[i]!.available)
			.sort((a, b) => TOS_ORDER.indexOf(a.p.tos) - TOS_ORDER.indexOf(b.p.tos) || a.index - b.index)
			.map(({ p }) => p);
	}

	/** Fan-out search; errors are reported per provider, never thrown. */
	async search(q: ResourceQuery, options: { providers?: readonly string[] } = {}): Promise<SearchOutcome> {
		const live = (await this.live()).filter((p) => (!options.providers || options.providers.includes(p.id)) && (!q.kinds || q.kinds.some((k) => p.kinds.includes(k))));
		const settled = await Promise.allSettled(live.map((p) => p.search(q)));
		const results: Resource[] = [];
		const seen = new Set<string>();
		const errors: ProviderError[] = [];
		settled.forEach((s, i) => {
			const id = live[i]!.id;
			if (s.status === "rejected") {
				errors.push(toProviderError(id, s.reason));
				return;
			}
			for (const r of s.value) {
				if (seen.has(r.id)) continue;
				seen.add(r.id);
				results.push(r);
			}
		});
		return { results, errors, asked: live.map((p) => p.id) };
	}

	private async dispatch<T>(resourceId: string, method: "resolve" | "toc" | "content", call: (p: ResourceProvider) => Promise<T> | undefined): Promise<T> {
		const providers = this.providersFor(resourceId);
		if (providers.length === 0) throw new ResourceError("registry", "invalid-input", `Nenhuma fonte reconhece o id "${resourceId}".`);
		let last: unknown;
		for (const p of providers) {
			if (method !== "resolve" && !p[method]) continue;
			if (!(await this.statusOf(p)).available) continue;
			try {
				const out = call(p);
				if (out) return await out;
			} catch (err) {
				last = err;
				if (err instanceof ResourceError && err.code === "unavailable") continue;
				throw err;
			}
		}
		if (last) throw last;
		const what = method === "resolve" ? "abrir" : method === "toc" ? "mostrar o sumário de" : "ler o conteúdo de";
		throw new ResourceError(providers[0]!.id, "unavailable", `Nenhuma fonte disponível consegue ${what} "${resourceId}".`);
	}

	resolve(id: string): Promise<Resource> {
		return this.dispatch(id, "resolve", (p) => p.resolve(id));
	}

	toc(id: string): Promise<TocEntry[]> {
		return this.dispatch(id, "toc", (p) => p.toc?.(id));
	}

	content(id: string, span?: Span): Promise<ContentChunk[]> {
		return this.dispatch(id, "content", (p) => p.content?.(id, span));
	}
}

export interface DefaultRegistryOptions {
	/** Directory of the learner's library (`<library>/<sha256>/`). */
	libraryRoot: string;
	/** Data dir for caches and the YouTube quota file (omitted → in-memory cache, unpersisted quota). */
	stateDir?: string;
	/** The learner's YouTube Data API key (BYOK). */
	youtubeApiKey: () => string | undefined | Promise<string | undefined>;
	/** Explicit opt-in for the enriched (InnerTube) YouTube provider. */
	youtubeEnrichedOptIn: () => boolean;
	/** Base fetch (default: allowlisted public fetch). */
	fetch?: ResourceFetch;
	cache?: TtlCache;
	clock?: Clock;
	now?: () => number;
	regionCode?: string;
}

/** Every adapter of the module, wired with pacing, cache and quota. */
export function createDefaultRegistry(o: DefaultRegistryOptions): ResourceRegistry {
	const now = o.now ?? Date.now;
	const fetch = o.fetch ?? createResourceFetch();
	const cache = o.cache ?? (o.stateDir ? new FileTtlCache(path.join(o.stateDir, "cache"), now) : new MemoryTtlCache(now));
	const quota = new DailyQuota({ ...YOUTUBE_QUOTA_LIMITS }, { now, ...(o.stateDir ? { store: jsonFileQuotaStore(path.join(o.stateDir, "youtube-quota.json")) } : {}) });
	const deps = (gated: ResourceFetch) => ({ fetch: gated, cache, now });
	const reg = new ResourceRegistry(o.clock ? { clock: o.clock } : {});
	reg.register(fetch, (f) => createYoutubeDataProvider({ fetch: f, apiKey: o.youtubeApiKey, quota, cache, now, ...(o.regionCode ? { regionCode: o.regionCode } : {}) }), ["yt"]);
	reg.register(fetch, (f) => createYoutubeEnrichedProvider({ fetch: f, optIn: o.youtubeEnrichedOptIn, cache, now }), ["yt"]);
	reg.register(fetch, (f) => createOpenstaxProvider(deps(f)), ["openstax"]);
	reg.register(fetch, (f) => createKuphaldtProvider(deps(f)), ["kuphaldt"]);
	reg.register(fetch, (f) => createLibretextsProvider(deps(f)), ["libretexts"]);
	reg.register(fetch, (f) => createOtlProvider(deps(f)), ["otl"]);
	reg.register(fetch, (f) => createWikibooksProvider(deps(f)), ["wikibooks"]);
	reg.add(createUserLibraryProvider({ libraryRoot: o.libraryRoot }), ["lib"]);
	reg.register(fetch, (f) => createOpenLibraryProvider(deps(f)), ["ol"]);
	reg.register(fetch, (f) => createCrossrefProvider(deps(f)), ["crossref"]);
	reg.register(fetch, (f) => createArxivProvider(deps(f)), ["arxiv"]);
	return reg;
}
