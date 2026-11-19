/**
 * Field-by-field metadata cascade (docs/research/00-SINTESE.md §2.9; r5 §5.4
 * "Resolução de metadados"):
 *
 *   native → models.dev → litellm → openrouter → pi → estimated
 *
 * The first source that has a VALID value for a field wins that field. A
 * malformed value (NaN, ≤ 0 limits, empty modality list, negative price) is
 * treated as absent, so a broken catalog never overrides a later good one.
 *
 * Decisions:
 *  - `cost` is atomic: input/output/cache prices come from ONE source; mixing
 *    two catalogs' prices would invent a price nobody charges.
 *  - Estimated layer (r5 step 7): contextWindow = min(known windows of the
 *    same family, from non-estimated sources) ?? 128 000; maxOutput = 8 192;
 *    reasoning = the entry listed reasoning levels. It never sets a price
 *    (unknown price stays unknown).
 *  - `estimated` flags a guessed contextWindow/maxOutput, for the UI badge.
 *
 * Pure and browser-safe. Catalog lookups (how a models.dev key is derived from
 * an entry) live in src/server/model-registry; this file only merges layers.
 */

import {
	METADATA_FIELDS,
	METADATA_SOURCES,
	entryKey,
	type CatalogModel,
	type EntitlementEntry,
	type ExternalMetadataSource,
	type MetadataField,
	type MetadataLayer,
	type MetadataSource,
	type ModelCost,
	type ModelMetadata,
	type ResolvedModelMetadata,
} from "./registry-types.ts";

export const ESTIMATED_CONTEXT_WINDOW = 128_000;
export const ESTIMATED_MAX_OUTPUT = 8_192;

/** External catalog layers for one entry, keyed by source. */
export type MetadataLayers = Partial<Record<ExternalMetadataSource, MetadataLayer | undefined>>;

// ─── field validity ──────────────────────────────────────────────────────────

const isPositiveFinite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const isNonNegativeFinite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

function isValidCost(value: unknown): value is ModelCost {
	if (typeof value !== "object" || value === null) return false;
	const cost = value as Partial<ModelCost>;
	return (
		isNonNegativeFinite(cost.input) &&
		isNonNegativeFinite(cost.output) &&
		(cost.cacheRead === undefined || isNonNegativeFinite(cost.cacheRead)) &&
		(cost.cacheWrite === undefined || isNonNegativeFinite(cost.cacheWrite))
	);
}

function isValidField(field: MetadataField, value: unknown): boolean {
	switch (field) {
		case "contextWindow":
		case "maxOutput":
		case "throughputTps":
			return isPositiveFinite(value);
		case "reasoning":
		case "toolCall":
			return typeof value === "boolean";
		case "input":
			return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
		case "cost":
			return isValidCost(value);
		case "knowledge":
		case "releaseDate":
		case "family":
			return isNonEmptyString(value);
	}
}

function copyField(field: MetadataField, value: unknown): unknown {
	if (field === "input") return [...(value as string[])];
	if (field === "cost") return { ...(value as ModelCost) };
	return value;
}

// ─── derived layers ──────────────────────────────────────────────────────────

/** What the entitlement source itself reported, as a metadata layer. */
export function nativeLayer(entry: EntitlementEntry): MetadataLayer {
	const native = entry.native;
	if (!native) return {};
	const layer: MetadataLayer = {};
	if (native.contextWindow !== undefined) layer.contextWindow = native.contextWindow;
	if (native.maxOutput !== undefined) layer.maxOutput = native.maxOutput;
	if (native.input !== undefined) layer.input = [...native.input];
	if (native.reasoningLevels && native.reasoningLevels.length > 0) layer.reasoning = true;
	if (native.createdAt !== undefined) layer.releaseDate = native.createdAt;
	return layer;
}

/** Conservative guesses for limits nobody reported (r5 step 7). */
export function estimatedLayer(entry: EntitlementEntry, familyContextWindows: readonly number[] = []): MetadataLayer {
	const known = familyContextWindows.filter(isPositiveFinite);
	return {
		contextWindow: known.length > 0 ? Math.min(...known) : ESTIMATED_CONTEXT_WINDOW,
		maxOutput: ESTIMATED_MAX_OUTPUT,
		reasoning: (entry.native?.reasoningLevels?.length ?? 0) > 0,
	};
}

// ─── merge ───────────────────────────────────────────────────────────────────

/** Merge ordered layers: for each field, the first valid value wins. */
export function mergeLayers(ordered: readonly { source: MetadataSource; layer: MetadataLayer | undefined }[]): ResolvedModelMetadata {
	const merged: Record<string, unknown> = {};
	const fieldSources: Partial<Record<MetadataField, MetadataSource>> = {};
	let best: MetadataSource | undefined;
	for (const { source, layer } of ordered) {
		if (!layer) continue;
		for (const field of METADATA_FIELDS) {
			if (field in fieldSources) continue;
			const value = layer[field];
			if (value === undefined || !isValidField(field, value)) continue;
			merged[field] = copyField(field, value);
			fieldSources[field] = source;
			if (best === undefined || METADATA_SOURCES.indexOf(source) < METADATA_SOURCES.indexOf(best)) best = source;
		}
	}
	const contextWindow = merged.contextWindow;
	const maxOutput = merged.maxOutput;
	if (!isPositiveFinite(contextWindow) || !isPositiveFinite(maxOutput)) {
		throw new Error("mergeLayers: nenhuma camada definiu contextWindow/maxOutput; inclua a camada \"estimated\" no fim da cascata.");
	}
	return {
		...(merged as Omit<ModelMetadata, "source">),
		contextWindow,
		maxOutput,
		source: best ?? "estimated",
		fieldSources,
		estimated: fieldSources.contextWindow === "estimated" || fieldSources.maxOutput === "estimated",
	};
}

/** The full cascade for one entry. */
export function mergeMetadata(
	entry: EntitlementEntry,
	layers: MetadataLayers,
	options: { familyContextWindows?: readonly number[] } = {},
): ResolvedModelMetadata {
	return mergeLayers([
		{ source: "native", layer: nativeLayer(entry) },
		{ source: "models.dev", layer: layers["models.dev"] },
		{ source: "litellm", layer: layers.litellm },
		{ source: "openrouter", layer: layers.openrouter },
		{ source: "pi", layer: layers.pi },
		{ source: "estimated", layer: estimatedLayer(entry, options.familyContextWindows) },
	]);
}

/**
 * Enrich every entry (entitlement decides WHICH models exist; this only adds
 * metadata). Two passes: first the real sources, then the estimate, so an
 * unknown model borrows the smallest context window known for its family.
 */
export function buildCatalog(entries: readonly EntitlementEntry[], layersFor: (entry: EntitlementEntry) => MetadataLayers): CatalogModel[] {
	const firstPass = entries.map((entry) => {
		const layers = layersFor(entry);
		const real = mergeLayers([
			{ source: "native", layer: nativeLayer(entry) },
			{ source: "models.dev", layer: layers["models.dev"] },
			{ source: "litellm", layer: layers.litellm },
			{ source: "openrouter", layer: layers.openrouter },
			{ source: "pi", layer: layers.pi },
			// placeholder so the probe merge never throws; ignored below
			{ source: "estimated", layer: { contextWindow: ESTIMATED_CONTEXT_WINDOW, maxOutput: ESTIMATED_MAX_OUTPUT } },
		]);
		return { entry, layers, real };
	});
	const windowsByFamily = new Map<string, number[]>();
	for (const { real } of firstPass) {
		if (!real.family || real.fieldSources.contextWindow === "estimated") continue;
		const list = windowsByFamily.get(real.family) ?? [];
		list.push(real.contextWindow);
		windowsByFamily.set(real.family, list);
	}
	return firstPass.map(({ entry, layers, real }) => ({
		entry,
		meta: mergeMetadata(entry, layers, { familyContextWindows: real.family ? windowsByFamily.get(real.family) ?? [] : [] }),
	}));
}

/** Index a catalog by entryKey for resolveRole. */
export function metadataIndex(catalog: readonly CatalogModel[]): Map<string, ResolvedModelMetadata> {
	return new Map(catalog.map((model) => [entryKey(model.entry), model.meta]));
}
