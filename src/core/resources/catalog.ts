/**
 * Curated seed catalogs shipped in content/resources/ (SÍNTESE §2.8
 * "Canais-semente", "Livros: abertos"; r6 §7.8, §9.2–9.3).
 *
 *   channels.json    curated YouTube channels per domain. A curated channel
 *                    starts with channelTrust prior Beta(4,1) (r6 §7.6).
 *                    `channelId` may be null or marked `unverified`: the
 *                    server then resolves the `handle` through the Data API
 *                    (channels.list forHandle, 1 unit) before trusting it.
 *   open-books.json  open (CC/PD) books per domain with license, official URL,
 *                    level band and the areas they cover. Only legal sources:
 *                    official publishers/repositories, never mirrors.
 *
 * zod 4 schemas with pt-BR messages (the files are hand-edited data).
 *
 * Pure: browser-safe (zod only).
 */

import { z } from "zod";
import { parseLicense } from "./license.ts";
import type { License } from "./types.ts";

const level = z.number().int().min(0).max(5);
const levelRange = z
	.tuple([level, level])
	.refine(([lo, hi]) => lo <= hi, { message: "faixa de nível invertida (mínimo > máximo)" });

const httpsUrl = z.url({ protocol: /^https$/, message: "URL precisa ser https" });

export const channelSeedSchema = z.object({
	key: z.string().regex(/^[a-z0-9-]+$/, "chave em kebab-case"),
	title: z.string().min(1),
	handle: z.string().regex(/^@[A-Za-z0-9._-]+$/, "handle do YouTube começa com @"),
	channelId: z
		.string()
		.regex(/^UC[A-Za-z0-9_-]{22}$/, "channelId do YouTube tem 24 caracteres e começa com UC")
		.nullable(),
	/** True when the id was not confirmed against the official channel page. */
	unverified: z.boolean(),
	domains: z.array(z.string().min(1)).min(1),
	/** Primary spoken language of the channel. */
	lang: z.string().min(2),
	levels: levelRange,
	tags: z.array(z.string()).default([]),
	notes: z.string().optional(),
});

export const channelCatalogSchema = z.object({
	schemaVersion: z.literal(1),
	updatedAt: z.string(),
	channels: z.array(channelSeedSchema),
});

export const openBookSeedSchema = z.object({
	key: z.string().regex(/^[a-z0-9-]+$/, "chave em kebab-case"),
	domain: z.string().min(1),
	title: z.string().min(1),
	authors: z.array(z.string().min(1)).min(1),
	/** Human license name, e.g. "CC BY 4.0", "Domínio público". */
	license: z.string().min(2),
	/** Official landing page (publisher or repository). */
	url: httpsUrl,
	/** True when the exact landing URL was not confirmed (the host is official). */
	urlUnverified: z.boolean().default(false),
	provider: z.enum(["openstax", "libretexts", "otl", "kuphaldt", "wikibooks", "mitocw", "internet-archive", "voa", "other"]),
	/** Provider-specific id (OpenStax slug, Kuphaldt volume key, Wikibooks title…). */
	providerRef: z.string().optional(),
	lang: z.string().min(2),
	levels: levelRange,
	areas: z.array(z.string().min(1)).min(1),
	/** "link-only": read on the official site (e.g. MIT OCW NC course pages). */
	use: z.enum(["fetch-runtime", "link-only"]).default("fetch-runtime"),
	notes: z.string().optional(),
});

export const openBookCatalogSchema = z.object({
	schemaVersion: z.literal(1),
	updatedAt: z.string(),
	books: z.array(openBookSeedSchema),
});

export type ChannelSeed = z.infer<typeof channelSeedSchema>;
export type ChannelCatalog = z.infer<typeof channelCatalogSchema>;
export type OpenBookSeed = z.infer<typeof openBookSeedSchema>;
export type OpenBookCatalog = z.infer<typeof openBookCatalogSchema>;

export class CatalogError extends Error {
	readonly issues: string[];
	constructor(message: string, issues: string[]) {
		super(message);
		this.name = "CatalogError";
		this.issues = issues;
	}
}

function issuesOf(error: z.ZodError): string[] {
	return error.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`);
}

function assertUniqueKeys(items: ReadonlyArray<{ key: string }>, label: string): void {
	const seen = new Set<string>();
	const dup = items.filter((i) => (seen.has(i.key) ? true : (seen.add(i.key), false))).map((i) => i.key);
	if (dup.length) throw new CatalogError(`${label}: chaves repetidas.`, dup.map((k) => `chave repetida: ${k}`));
}

export function parseChannelCatalog(json: unknown): ChannelCatalog {
	const r = channelCatalogSchema.safeParse(json);
	if (!r.success) throw new CatalogError("Catálogo de canais inválido.", issuesOf(r.error));
	assertUniqueKeys(r.data.channels, "Catálogo de canais");
	return r.data;
}

export function parseOpenBookCatalog(json: unknown): OpenBookCatalog {
	const r = openBookCatalogSchema.safeParse(json);
	if (!r.success) throw new CatalogError("Catálogo de livros abertos inválido.", issuesOf(r.error));
	assertUniqueKeys(r.data.books, "Catálogo de livros abertos");
	return r.data;
}

export function channelsForDomain(catalog: ChannelCatalog, domainId: string): ChannelSeed[] {
	return catalog.channels.filter((c) => c.domains.includes(domainId));
}

/** Channel ids usable directly (verified ids only; unverified ones need a handle lookup). */
export function trustedChannelIds(catalog: ChannelCatalog, domainId: string): string[] {
	return channelsForDomain(catalog, domainId)
		.filter((c) => c.channelId !== null && !c.unverified)
		.map((c) => c.channelId!);
}

export function booksForDomain(catalog: OpenBookCatalog, domainId: string, level?: number): OpenBookSeed[] {
	return catalog.books.filter((b) => b.domain === domainId && (level === undefined || (b.levels[0] <= level && level <= b.levels[1])));
}

/** Normalized License of a seed book. */
export function seedLicense(book: OpenBookSeed): License {
	return parseLicense(book.license);
}
