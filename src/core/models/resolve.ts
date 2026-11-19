/**
 * Role → model resolution without model ids in code (docs/research/00-SINTESE.md
 * §2.9 "Papéis"; r5 §5.3 principle 4, §5.4 "Papéis sem ID").
 *
 * resolveRole(spec, entries, metadata) picks ONE entitled model for a RoleSpec:
 *
 *  pinned  → the entry with that provider + id (or whose alias resolves to it).
 *            When it vanished: migrate to its server-declared successor
 *            (`upgradeTo`), else to the newest selectable model of the same
 *            `line`; else resolve `options.fallback` (the role's auto preset);
 *            else throw ModelResolveError("pinned-unavailable").
 *  auto    → filter selectable entries by `require` (reasoning, input
 *            modalities, minContext, billing), then narrow by the preferred
 *            `connection` / away from `avoidConnection` when that leaves
 *            someone (both are preferences, not requirements), then rank:
 *
 *    strongest: two stages, because a server's own order is only comparable
 *               inside its connection (r5 §5.3 principle 3, §5.4 "strongest"):
 *      1. inside each connection: listed line rank (editable config,
 *         options.lineRank) → newer within a ranked line → server order
 *         (`priority`) → then the metadata keys below;
 *      2. across connections, each connection's champion by METADATA only:
 *         reasoning → higher output price (tier proxy; unknown price, i.e.
 *         estimated metadata, ranks last) → newer → larger context.
 *      The ranking lists connections by their champion, each connection's
 *      models in its stage-1 order.
 *    cheapest:  lower input+output price (unknown last) → non-reasoning →
 *               server order → newer.
 *    fastest:   higher throughput (observed/reported tokens/s) → non-reasoning
 *               → lower output price → server order → newer.
 *    balanced:  the upper median of the metadata-strength order (stage 2
 *               keys), among priced models when any is priced (r5 "médio"),
 *               and among active ones when any is active.
 *
 *  Every prefer ranks deprecated models after active ones, and ends with a
 *  connection/provider/id tie-break, so the result never depends on the input
 *  order (deterministic). Every key list is a function of one candidate, so
 *  each stage is a strict lexicographic total order. Numbers read from
 *  metadata or entries (prices, context, throughput, order) count only when
 *  finite: a NaN from a broken cache would make the comparator inconsistent
 *  and the choice depend on the input order, so it is treated as unknown.
 *
 *  Pin migration (r5 §5.4 "Depreciação e migração") follows the server's
 *  `upgradeTo` chain (A → B → C, cycle-safe) to the first selectable model,
 *  else picks the newest ACTIVE (non-deprecated) model of the same `line`.
 *
 *  Presets are returned as copies: DEFAULT_ROLE_SPECS is frozen only at the
 *  top level, so handing out its nested objects would let a caller mutate
 *  the global defaults.
 *
 * Pure and browser-safe. Messages are pt-BR (shown in the model picker).
 */

import { DEFAULT_ROLE_SPECS, type BillingKind, type ModelRole, type RolePreference, type RoleSpec } from "./role-spec.ts";
import { estimatedLayer, mergeLayers, nativeLayer } from "./merge.ts";
import { entryKey, isSelectable, type EntitlementEntry, type ModelMetadata } from "./registry-types.ts";

export type AutoRoleSpec = Extract<RoleSpec, { kind: "auto" }>;
export type PinnedRoleSpec = Extract<RoleSpec, { kind: "pinned" }>;

export type MetadataLookup = ReadonlyMap<string, ModelMetadata> | ((entry: EntitlementEntry) => ModelMetadata | undefined);

export interface ResolveOptions {
	/** Product lines strongest first, from editable config (never hardcoded). */
	lineRank?: readonly string[];
	/** Auto spec used when a pin can no longer be resolved (usually the role preset). */
	fallback?: AutoRoleSpec;
	/** For error messages only. */
	role?: ModelRole;
}

export interface ResolvedRole {
	entry: EntitlementEntry;
	meta: ModelMetadata;
	/** How the choice was made, for "Automático → X (resolvido)" in the UI. */
	via: "pinned" | "pinned-migrated" | `auto:${RolePreference}` | `fallback:${RolePreference}`;
	thinkingLevel?: string;
	/** Present when a pin was migrated or replaced by the fallback. */
	replacedPin?: { provider: string; id: string };
	/** Candidates that satisfied the spec (1 for pins). */
	candidates: number;
}

export type ModelResolveErrorCode = "no-entitlements" | "pinned-unavailable" | "no-match";

export class ModelResolveError extends Error {
	readonly code: ModelResolveErrorCode;
	readonly details: string[];
	constructor(code: ModelResolveErrorCode, message: string, details: string[] = []) {
		super(message);
		this.name = "ModelResolveError";
		this.code = code;
		this.details = details;
	}
}

// ─── metadata lookup ─────────────────────────────────────────────────────────

function metadataFor(entry: EntitlementEntry, lookup: MetadataLookup): ModelMetadata {
	const found = typeof lookup === "function" ? lookup(entry) : lookup.get(entryKey(entry));
	if (found) return found;
	// No catalog data: the entry stays usable with native + estimated metadata (r5 principle 5).
	return mergeLayers([
		{ source: "native", layer: nativeLayer(entry) },
		{ source: "estimated", layer: estimatedLayer(entry) },
	]);
}

/** An entitled model together with its merged metadata. */
export interface Candidate {
	entry: EntitlementEntry;
	meta: ModelMetadata;
}

// ─── requirements ────────────────────────────────────────────────────────────

function inputsOf(meta: ModelMetadata): readonly string[] {
	return meta.input && meta.input.length > 0 ? meta.input : ["text"];
}

function connectionMatches(entry: EntitlementEntry, wanted: string): boolean {
	return entry.connection === wanted || entry.connection.startsWith(`${wanted}:`) || entry.provider === wanted;
}

type Requirement = { label: string; test: (candidate: Candidate) => boolean };

function requirementsOf(spec: AutoRoleSpec): Requirement[] {
	const req = spec.require;
	if (!req) return [];
	const list: Requirement[] = [];
	if (req.reasoning) list.push({ label: "raciocínio (reasoning)", test: (c) => c.meta.reasoning === true });
	for (const modality of req.input ?? []) {
		list.push({ label: `entrada "${modality}"`, test: (c) => inputsOf(c.meta).includes(modality) });
	}
	if (req.minContext !== undefined) {
		const min = req.minContext;
		list.push({ label: `contexto ≥ ${min} tokens`, test: (c) => contextWindow(c) >= min });
	}
	if (req.billing && req.billing.length > 0) {
		const allowed: readonly BillingKind[] = req.billing;
		list.push({ label: `cobrança ${allowed.join("/")}`, test: (c) => allowed.includes(c.entry.billing) });
	}
	return list;
}

// ─── ranking ─────────────────────────────────────────────────────────────────

/** A string compared in descending order (newer ISO dates first). */
interface Descending {
	readonly desc: string;
}
/** Ascending keys; numbers are negated and strings wrapped for "higher is better". */
type Key = number | string | Descending;
type KeyFn = (candidate: Candidate) => Key[];

const UNKNOWN_HIGH = Number.POSITIVE_INFINITY;

/** A finite number, or undefined (NaN/±Infinity/non-numbers are "unknown"). */
function finite(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function recency(c: Candidate): string {
	const date = c.meta.releaseDate ?? c.entry.native?.createdAt;
	return typeof date === "string" ? date : "";
}

function deprecatedRank(c: Candidate): number {
	return c.entry.native?.lifecycle === "deprecated" ? 1 : 0;
}

function outputPrice(c: Candidate): number | undefined {
	return finite(c.meta.cost?.output);
}

function blendedPrice(c: Candidate): number | undefined {
	const input = finite(c.meta.cost?.input);
	const output = finite(c.meta.cost?.output);
	return input !== undefined && output !== undefined ? input + output : undefined;
}

function isPriced(c: Candidate): boolean {
	return blendedPrice(c) !== undefined;
}

function contextWindow(c: Candidate): number {
	return finite(c.meta.contextWindow) ?? 0;
}

function throughput(c: Candidate): number {
	return finite(c.meta.throughputTps) ?? 0;
}

function order(c: Candidate): number {
	return finite(c.entry.order) ?? UNKNOWN_HIGH;
}

function tieBreak(c: Candidate): Key[] {
	return [c.entry.connection, c.entry.provider, c.entry.id];
}

function descending(value: string): Descending {
	return { desc: value };
}

/** Strength from merged metadata alone: comparable across connections. */
const metadataStrengthKeys: KeyFn = (c) => [
	deprecatedRank(c),
	c.meta.reasoning ? 0 : 1,
	-(outputPrice(c) ?? -1),
	descending(recency(c)),
	-contextWindow(c),
	...tieBreak(c),
];

/** Strength inside one connection: the provider's own signals first. */
function connectionStrengthKeys(lineRank: readonly string[]): KeyFn {
	return (c) => {
		const lineIndex = c.entry.native?.line !== undefined ? lineRank.indexOf(c.entry.native.line) : -1;
		const ranked = lineIndex >= 0;
		return [
			deprecatedRank(c),
			ranked ? lineIndex : UNKNOWN_HIGH,
			descending(ranked ? recency(c) : ""),
			order(c),
			...metadataStrengthKeys(c).slice(1),
		];
	};
}

function rankStrongest(candidates: readonly Candidate[], lineRank: readonly string[]): Candidate[] {
	const byConnection = new Map<string, Candidate[]>();
	for (const candidate of candidates) {
		const group = byConnection.get(candidate.entry.connection) ?? [];
		group.push(candidate);
		byConnection.set(candidate.entry.connection, group);
	}
	const groups = [...byConnection.values()].map((group) => rank(group, connectionStrengthKeys(lineRank)));
	const champions = rank(
		groups.map((group) => group[0] as Candidate),
		metadataStrengthKeys,
	);
	const groupOf = new Map(groups.map((group) => [group[0] as Candidate, group]));
	return champions.flatMap((champion) => groupOf.get(champion) ?? []);
}

const cheapestKeys: KeyFn = (c) => [
	deprecatedRank(c),
	blendedPrice(c) ?? UNKNOWN_HIGH,
	c.meta.reasoning ? 1 : 0,
	order(c),
	descending(recency(c)),
	...tieBreak(c),
];

const fastestKeys: KeyFn = (c) => [
	deprecatedRank(c),
	-throughput(c),
	c.meta.reasoning ? 1 : 0,
	outputPrice(c) ?? UNKNOWN_HIGH,
	order(c),
	descending(recency(c)),
	...tieBreak(c),
];

function compareAscending<T extends number | string>(a: T, b: T): number {
	return a === b ? 0 : a < b ? -1 : 1;
}

/** Each key position holds the same kind for every candidate (KeyFn contract). */
function compareKey(a: Key, b: Key): number {
	if (typeof a === "object" && typeof b === "object") return compareAscending(b.desc, a.desc);
	if (typeof a === "number" && typeof b === "number") return compareAscending(a, b);
	return compareAscending(String(a), String(b));
}

function compareKeys(a: Key[], b: Key[]): number {
	const length = Math.min(a.length, b.length);
	for (let i = 0; i < length; i++) {
		const result = compareKey(a[i] as Key, b[i] as Key);
		if (result !== 0) return result;
	}
	return a.length - b.length;
}

function rank(candidates: readonly Candidate[], keys: KeyFn): Candidate[] {
	return candidates
		.map((candidate) => ({ candidate, keys: keys(candidate) }))
		.sort((a, b) => compareKeys(a.keys, b.keys))
		.map((ranked) => ranked.candidate);
}

/** Rank candidates for a preference, best first. Exported for pickers that show the order. */
export function rankForPreference(candidates: readonly Candidate[], prefer: RolePreference, options: ResolveOptions = {}): Candidate[] {
	const lineRank = options.lineRank ?? [];
	switch (prefer) {
		case "strongest":
			return rankStrongest(candidates, lineRank);
		case "cheapest":
			return rank(candidates, cheapestKeys);
		case "fastest":
			return rank(candidates, fastestKeys);
		case "balanced": {
			const priced = candidates.filter(isPriced);
			const base = priced.length > 0 ? priced : candidates;
			// The median of the ACTIVE models: deprecated ones only when nothing else is left.
			const active = base.filter((c) => deprecatedRank(c) === 0);
			const pool = rank(active.length > 0 ? active : base, metadataStrengthKeys);
			const median = pool[Math.floor((pool.length - 1) / 2)];
			if (!median) return [];
			// The upper median first, then everyone else by strength.
			return [median, ...rank(candidates.filter((c) => c !== median), metadataStrengthKeys)];
		}
	}
}

// ─── resolution ──────────────────────────────────────────────────────────────

function roleLabel(options: ResolveOptions): string {
	return options.role ? `o papel "${options.role}"` : "o papel";
}

function resolveAuto(spec: AutoRoleSpec, pool: readonly Candidate[], options: ResolveOptions): { chosen: Candidate; candidates: number } {
	let candidates = [...pool];
	const eliminated: string[] = [];
	for (const requirement of requirementsOf(spec)) {
		const kept = candidates.filter(requirement.test);
		if (kept.length < candidates.length) eliminated.push(`${requirement.label} eliminou ${candidates.length - kept.length}`);
		candidates = kept;
	}
	if (candidates.length === 0) {
		throw new ModelResolveError(
			"no-match",
			`Nenhum modelo disponível satisfaz ${roleLabel(options)}: ${eliminated.join("; ")}. Conecte um modelo compatível ou fixe um modelo manualmente.`,
			eliminated,
		);
	}
	if (spec.connection) {
		const wanted = spec.connection;
		const preferred = candidates.filter((c) => connectionMatches(c.entry, wanted));
		if (preferred.length > 0) candidates = preferred;
	}
	if (spec.avoidConnection) {
		const avoided = spec.avoidConnection;
		const others = candidates.filter((c) => !connectionMatches(c.entry, avoided));
		if (others.length > 0) candidates = others;
	}
	const ranked = rankForPreference(candidates, spec.prefer, options);
	const chosen = ranked[0];
	if (!chosen) throw new ModelResolveError("no-match", `Nenhum modelo disponível para ${roleLabel(options)}.`);
	return { chosen, candidates: candidates.length };
}

function pinMatches(entry: EntitlementEntry, spec: PinnedRoleSpec): boolean {
	return entry.provider === spec.provider && (entry.id === spec.id || entry.native?.resolvedModel === spec.id);
}

function byConnectionThenId(a: Candidate, b: Candidate): number {
	return compareKeys(tieBreak(a), tieBreak(b));
}

function findPinned(spec: PinnedRoleSpec, pool: readonly Candidate[]): Candidate | undefined {
	const exact = pool.filter((c) => c.entry.provider === spec.provider && c.entry.id === spec.id).sort(byConnectionThenId);
	if (exact[0]) return exact[0];
	return pool.filter((c) => pinMatches(c.entry, spec)).sort(byConnectionThenId)[0];
}

/** Follow `upgradeTo` from the stale pin to the first selectable successor (A → B → C; cycle-safe). */
function followUpgrades(spec: PinnedRoleSpec, all: readonly EntitlementEntry[], pool: readonly Candidate[]): Candidate | undefined {
	const sameProvider = (entry: EntitlementEntry) => entry.provider === spec.provider;
	const visited = new Set<string>([spec.id]);
	let frontier = all.filter((entry) => pinMatches(entry, spec));
	while (frontier.length > 0) {
		const successors = [...new Set(frontier.flatMap((entry) => (entry.native?.upgradeTo ? [entry.native.upgradeTo] : [])))]
			.filter((id) => !visited.has(id))
			.sort();
		if (successors.length === 0) return undefined;
		for (const id of successors) {
			visited.add(id);
			const found = pool.filter((c) => sameProvider(c.entry) && c.entry.id === id).sort(byConnectionThenId)[0];
			if (found) return found;
		}
		// Successors that are listed but not selectable (hidden, retired) may point further.
		frontier = all.filter((entry) => sameProvider(entry) && successors.includes(entry.id));
	}
	return undefined;
}

function migratePin(spec: PinnedRoleSpec, all: readonly EntitlementEntry[], pool: readonly Candidate[]): Candidate | undefined {
	const upgraded = followUpgrades(spec, all, pool);
	if (upgraded) return upgraded;
	const stale = all.filter((entry) => pinMatches(entry, spec));
	const lines = new Set(stale.flatMap((entry) => (entry.native?.line ? [entry.native.line] : [])));
	if (lines.size === 0) return undefined;
	// r5: migrate only to an ACTIVE model of the same line; otherwise the role's auto fallback decides.
	const sameLine = pool.filter(
		(c) => c.entry.provider === spec.provider && deprecatedRank(c) === 0 && c.entry.native?.line !== undefined && lines.has(c.entry.native.line),
	);
	return rank(sameLine, (c) => [descending(recency(c)), order(c), ...tieBreak(c)])[0];
}

/**
 * Resolve a RoleSpec against the live entitlements. Deterministic: the same
 * entries + metadata (in any order) always give the same model.
 */
export function resolveRole(spec: RoleSpec, entries: readonly EntitlementEntry[], metadata: MetadataLookup, options: ResolveOptions = {}): ResolvedRole {
	const pool: Candidate[] = entries.filter(isSelectable).map((entry) => ({ entry, meta: metadataFor(entry, metadata) }));
	if (spec.kind === "pinned") {
		const pinned = findPinned(spec, pool);
		if (pinned) {
			return { entry: pinned.entry, meta: pinned.meta, via: "pinned", ...(spec.thinkingLevel ? { thinkingLevel: spec.thinkingLevel } : {}), candidates: 1 };
		}
		const migrated = migratePin(spec, entries, pool);
		if (migrated) {
			return { entry: migrated.entry, meta: migrated.meta, via: "pinned-migrated", replacedPin: { provider: spec.provider, id: spec.id }, candidates: 1 };
		}
		if (options.fallback && pool.length > 0) {
			const { chosen, candidates } = resolveAuto(options.fallback, pool, options);
			return { entry: chosen.entry, meta: chosen.meta, via: `fallback:${options.fallback.prefer}`, replacedPin: { provider: spec.provider, id: spec.id }, candidates };
		}
		throw new ModelResolveError(
			"pinned-unavailable",
			`O modelo fixado ${spec.provider}:${spec.id} não está mais disponível nas suas conexões e não há substituto. Escolha outro modelo para ${roleLabel(options)}.`,
		);
	}
	if (pool.length === 0) {
		throw new ModelResolveError("no-entitlements", `Nenhum modelo disponível para ${roleLabel(options)}: conecte uma conta ou chave de API.`);
	}
	const { chosen, candidates } = resolveAuto(spec, pool, options);
	return { entry: chosen.entry, meta: chosen.meta, via: `auto:${spec.prefer}`, candidates };
}

/**
 * The spec in force for a role: domain override → global override → preset
 * (§2.9 "Override por domínio em DomainManifest.roles").
 */
export function effectiveRoleSpec(
	role: ModelRole,
	layers: { domain?: Partial<Record<ModelRole, RoleSpec>>; global?: Partial<Record<ModelRole, RoleSpec>> } = {},
): RoleSpec {
	return layers.domain?.[role] ?? layers.global?.[role] ?? structuredClone(DEFAULT_ROLE_SPECS[role]);
}

/** The role preset as an auto spec (the fallback for a broken pin). */
export function presetFallback(role: ModelRole): AutoRoleSpec {
	const preset = DEFAULT_ROLE_SPECS[role];
	return preset.kind === "auto" ? structuredClone(preset) : { kind: "auto", prefer: "balanced" };
}
