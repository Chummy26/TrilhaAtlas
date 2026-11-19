/**
 * Curriculum core barrel (docs/research/00-SINTESE.md §2.1 "src/core/
 * curriculum", §2.3, §2.4(e), §2.7, §2.13). Pure and browser-safe: contracts,
 * zod schemas, the effective clause system, certificates, invariants, the
 * patch pipeline, learner-state geometry (fringes, hours, goal plan),
 * expansion triggers/budget and read-side queries.
 */

export * from "./types.ts";
export * from "./schema.ts";
export * from "./effective.ts";
export * from "./rank.ts";
export * from "./certificate.ts";
export * from "./incremental.ts";
export * from "./invariants.ts";
export * from "./patch.ts";
export * from "./seed.ts";
export * from "./ledger.ts";
export * from "./hours.ts";
export * from "./frontier.ts";
export * from "./transitive.ts";
export * from "./granularity.ts";
export * from "./triggers.ts";
export * from "./budget.ts";
export * from "./query.ts";
