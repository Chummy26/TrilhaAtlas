/**
 * Barrel of the pure model-registry layer (docs/research/00-SINTESE.md §2.9;
 * r5 §5.3–5.4): roles, entitlement/metadata contracts, the metadata cascade
 * and role resolution. No model id lives here. Browser-safe.
 */

export * from "./role-spec.ts";
export * from "./registry-types.ts";
export * from "./merge.ts";
export * from "./resolve.ts";
