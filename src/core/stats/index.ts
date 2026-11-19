/**
 * Barrel of the pure stats layer (docs/research/00-SINTESE.md §2.3, §2.10):
 * UsageEvent/ActivityEvent contracts, validation, event builders (provider
 * hook + renderer heartbeat), date helpers and aggregations. Browser-safe.
 */

export * from "./types.ts";
export * from "./dates.ts";
export * from "./schema.ts";
export * from "./events.ts";
export * from "./aggregate.ts";
