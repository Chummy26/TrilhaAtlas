/**
 * Shared plumbing of the book/metadata adapters (SÍNTESE §2.8 "Livros";
 * r6 §11.3): dependencies, cached JSON/text GETs through the allowlisted
 * fetch, id parsing with provider-specific errors, and section → chunk
 * conversion with breadcrumbs (core chunking.ts, 300–800 tokens).
 */

import { chunkSection } from "../../core/resources/chunking.ts";
import { parseResourceId, type ParsedResourceId } from "../../core/resources/ids.ts";
import { tocBreadcrumb } from "../../core/resources/toc.ts";
import { ResourceError, type ContentChunk, type Span, type TocEntry } from "../../core/resources/types.ts";
import { cached, type TtlCache } from "./cache.ts";
import { fetchJson, fetchText, type ResourceFetch, type ResourceRequestInit } from "./safe-fetch.ts";

export interface ProviderDeps {
	/** Allowlisted (and, in the registry, rate-gated) fetch. */
	fetch: ResourceFetch;
	cache?: TtlCache;
	now?: () => number;
}

export function isoNow(deps: Pick<ProviderDeps, "now">): string {
	return new Date((deps.now ?? Date.now)()).toISOString();
}

export function cachedJson<T>(deps: ProviderDeps, url: string, provider: string, ttlMs: number, init?: ResourceRequestInit): Promise<T> {
	return cached(deps.cache, `${provider}:json:${url}`, ttlMs, () => fetchJson<T>(deps.fetch, url, provider, init));
}

export function cachedText(deps: ProviderDeps, url: string, provider: string, ttlMs: number, init?: ResourceRequestInit): Promise<string> {
	return cached(deps.cache, `${provider}:text:${url}`, ttlMs, () => fetchText(deps.fetch, url, provider, init));
}

/** Parse an id and check its prefix; pt-BR error otherwise. */
export function idFor(provider: string, prefix: string, id: string): ParsedResourceId {
	let parsed: ParsedResourceId;
	try {
		parsed = parseResourceId(id);
	} catch (err) {
		throw new ResourceError(provider, "invalid-input", err instanceof Error ? err.message : String(err));
	}
	if (parsed.prefix !== prefix) throw new ResourceError(provider, "invalid-input", `O id "${id}" não pertence a ${provider}.`);
	return parsed;
}

/** Section of a TOC by id (or the whole book when undefined). */
export function tocSection(provider: string, toc: readonly TocEntry[], sectionId: string): TocEntry {
	const entry = toc.find((e) => e.id === sectionId);
	if (!entry) throw new ResourceError(provider, "not-found", `Seção "${sectionId}" não existe no sumário.`);
	return entry;
}

/** Markdown of one section → chunks with breadcrumb and span. */
export function sectionChunks(resourceId: string, toc: readonly TocEntry[], entry: TocEntry | undefined, markdown: string, span?: Span): ContentChunk[] {
	const breadcrumb = entry ? tocBreadcrumb(toc, entry.id) : [];
	return chunkSection({ resourceId, ...(entry ? { sectionId: entry.id } : {}), breadcrumb, text: markdown, ...(span ? { span } : {}) });
}

/** First defined, trimmed, non-empty string. */
export function firstText(...values: Array<unknown>): string | undefined {
	for (const v of values) if (typeof v === "string" && v.trim()) return v.trim();
	return undefined;
}

/** Array of strings from a string | string[] | undefined field. */
export function stringList(value: unknown): string[] {
	if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
	if (typeof value === "string" && value.trim()) return [value.trim()];
	return [];
}
