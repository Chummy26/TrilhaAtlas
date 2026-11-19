/**
 * Model registry contracts (docs/research/00-SINTESE.md §2.9; r5 §5.3–5.4).
 *
 * Entitlement ≠ metadata:
 *  - An EntitlementEntry is what ONE connection (a ChatGPT plan account, an
 *    API key, a local runtime…) says the user may call. Only entitlement
 *    sources add selectable models; nothing else ever does.
 *  - ModelMetadata only ENRICHES an entry (context, price, capabilities),
 *    merged field by field from native → models.dev → litellm → openrouter →
 *    pi → estimated (./merge.ts).
 *
 * No model id appears in product code: ids arrive as data (network, CLI,
 * user pins, test fixtures). Pure types: browser-safe.
 *
 * Addition to r5's sketch: `billing` lives on each entry (the source knows
 * it), because RoleSpec.require.billing filters per entry.
 */

import type { BillingKind } from "./role-spec.ts";

export type ModelLifecycle = "active" | "deprecated" | "retired";

/** Modalities: "text" | "image" | "pdf" | "file" | "audio" | … (open set). */
export type ModelInput = "text" | "image" | "pdf" | "file" | "audio" | (string & {});

/** Everything the entitlement source itself reported; all optional. */
export interface EntitlementNative {
	contextWindow?: number;
	maxOutput?: number;
	input?: ModelInput[];
	reasoningLevels?: string[];
	defaultReasoning?: string;
	lifecycle?: ModelLifecycle;
	retiresAt?: string;
	shutdownDate?: string;
	/** Server-declared successor id (Codex `upgrade`). */
	upgradeTo?: string;
	/** Provider product line (Anthropic `line`); ranked by editable config, never by code. */
	line?: string;
	/** Alias → concrete id resolved by the account (CLI aliases). */
	resolvedModel?: string;
	supportedInApi?: boolean;
	/** Release/creation timestamp reported by the source (ISO). */
	createdAt?: string;
}

export interface EntitlementEntry {
	/** Connection instance, e.g. "chatgpt:<accountHash>" or "anthropic-api". */
	connection: string;
	/** Logical provider id in the app. */
	provider: string;
	/** What goes in the request (slug/alias). */
	id: string;
	displayName?: string;
	/**
	 * Server priority or meaningful list position (lower = listed first).
	 * Sources set it only when the order carries intent (SIWC `priority`,
	 * a newest-first listing); it ranks models inside ITS connection only.
	 */
	order?: number;
	/** visibility === "hide" upstream. */
	hidden?: boolean;
	billing: BillingKind;
	native?: EntitlementNative;
}

export const METADATA_SOURCES = ["native", "models.dev", "litellm", "openrouter", "pi", "estimated"] as const;
export type MetadataSource = (typeof METADATA_SOURCES)[number];

/** External catalogs, in cascade order (native and estimated are derived from the entry). */
export type ExternalMetadataSource = Exclude<MetadataSource, "native" | "estimated">;

/** USD per 1M tokens. */
export interface ModelCost {
	input: number;
	output: number;
	cacheRead?: number;
	cacheWrite?: number;
}

export interface ModelMetadata {
	contextWindow?: number;
	maxOutput?: number;
	reasoning?: boolean;
	toolCall?: boolean;
	input?: ModelInput[];
	cost?: ModelCost;
	knowledge?: string;
	/** ISO date (YYYY-MM-DD or full timestamp). */
	releaseDate?: string;
	/** Family used to estimate missing limits from siblings (models.dev `family`). */
	family?: string;
	/** Output tokens per second, reported or observed in our own stats. */
	throughputTps?: number;
	/** The best (earliest-in-cascade) source that contributed a field. */
	source: MetadataSource;
}

/** The fields the cascade merges (everything but `source`). */
export const METADATA_FIELDS = [
	"contextWindow",
	"maxOutput",
	"reasoning",
	"toolCall",
	"input",
	"cost",
	"knowledge",
	"releaseDate",
	"family",
	"throughputTps",
] as const satisfies readonly (keyof ModelMetadata)[];

export type MetadataField = (typeof METADATA_FIELDS)[number];

/** One source's partial view of a model. */
export type MetadataLayer = Partial<Omit<ModelMetadata, "source">>;

/** Merge result: always has contextWindow and maxOutput (estimated when unknown). */
export interface ResolvedModelMetadata extends ModelMetadata {
	contextWindow: number;
	maxOutput: number;
	fieldSources: Partial<Record<MetadataField, MetadataSource>>;
	/** True when contextWindow or maxOutput is a guess ("metadados estimados" badge). */
	estimated: boolean;
}

export interface CatalogModel {
	entry: EntitlementEntry;
	meta: ResolvedModelMetadata;
}

/** One connection's entitlement listing (implemented in src/server/model-registry). */
export interface EntitlementSource {
	connection: string;
	billing: BillingKind;
	list(signal: AbortSignal, prev?: { etag?: string }): Promise<{ entries: EntitlementEntry[]; etag?: string } | "not-modified">;
}

/** Stable map key of an entry: connection + provider + id. */
export function entryKey(entry: Pick<EntitlementEntry, "connection" | "provider" | "id">): string {
	return `${entry.connection}\u0000${entry.provider}\u0000${entry.id}`;
}

/** Entries a picker or a role may use: listed, callable, not retired. */
export function isSelectable(entry: EntitlementEntry): boolean {
	return entry.hidden !== true && entry.native?.supportedInApi !== false && entry.native?.lifecycle !== "retired";
}
