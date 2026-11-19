/**
 * Server side of the resources module (SÍNTESE §2.8; r6 §11): legal
 * adapters for YouTube (Data API v3 BYOK + opt-in enriched InnerTube) and
 * open/metadata book sources, the learner's local library, the allowlisted
 * fetch, pacing/quota/cache plumbing and the registry that composes them.
 * Pure pieces (types, scoring, playlist, embed URL, TOC, chunking) live in
 * src/core/resources and are re-exported by their own barrel.
 */

export * from "./safe-fetch.ts";
export * from "./rate-limit.ts";
export * from "./cache.ts";
export * from "./html.ts";
export * from "./zip.ts";
export * from "./provider-kit.ts";
export * from "./embed.ts";
export * from "./youtube-data.ts";
export * from "./youtube-enriched.ts";
export * from "./openstax.ts";
export * from "./libretexts.ts";
export * from "./otl.ts";
export * from "./openlibrary.ts";
export * from "./crossref.ts";
export * from "./arxiv.ts";
export * from "./wikibooks.ts";
export * from "./kuphaldt.ts";
export * from "./user-library.ts";
export * from "./registry.ts";
export * from "./seeds.ts";
