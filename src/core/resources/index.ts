/**
 * Resources core barrel: pure, browser-safe pieces of the per-node resource
 * system — YouTube videos and legal books (SÍNTESE §2.8, §2.3; r6).
 *
 * The server adapters (src/server/resources/**) implement `ResourceProvider`
 * on top of these types; the UI reads playlists, embeds and segments from
 * here through the core barrel.
 */

export * from "./types.ts";
export * from "./ids.ts";
export * from "./license.ts";
export * from "./score.ts";
export * from "./language-fit.ts";
export * from "./mmr.ts";
export * from "./setcover.ts";
export * from "./segments.ts";
export * from "./playlist.ts";
export * from "./youtube.ts";
export * from "./embed.ts";
export * from "./toc.ts";
export * from "./chunking.ts";
export * from "./catalog.ts";
export * from "./match.ts";
