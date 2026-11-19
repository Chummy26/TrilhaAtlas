/**
 * Seed files → initial patch (docs/research/00-SINTESE.md §2.4(e) "Seed (fase
 * 1)": cheap skeleton from anchors, atoms only in the first areas; r3 §4.6
 * "patches.jsonl é a fonte da verdade", §6).
 *
 * A seed is NOT written to the snapshot directly: it becomes the FIRST ledger
 * entry, a PatchEnvelope with trigger.kind "seed" whose ops add every
 * non-root item (parents first) and every seed edge, and whose itemPayloads
 * carry the full normalised items — including the domain ROOT, which no op
 * can create (addItem needs a parent). The ledger is therefore self-contained:
 *
 *     snapshot₀ = initialSnapshot(rootFromSeedEnvelope(env₀))   (version 0)
 *     snapshot₁ = applyPatch(snapshot₀, env₀)                     (version 1) …
 *
 * (./ledger.ts replayLedger does exactly this.)
 *
 * normalizeSeedItem fills the defaults documented on `SeedItem` (types.ts):
 * aliases [], scope "" → summary, objectives [], assess [], clauses [],
 * softPrereqs [], encompasses [], anchors [], status "stub" for non-atoms
 * without children / "stable" for atoms and seeded containers, version 1,
 * provenance {createdBy: "seed"}, order = index in its file.
 *
 * Pure and browser-safe.
 */

import { computeCertificate } from "./certificate.ts";
import { normalizeClauses } from "./effective.ts";
import { CurriculumItemSchema, CurriculumSeedFileSchema, parseWith } from "./schema.ts";
import {
	CurriculumError,
	type CurriculumEdge,
	type CurriculumItem,
	type CurriculumSeedFile,
	type CurriculumSnapshot,
	type ExpansionOp,
	type PatchEnvelope,
	type SeedItem,
	type ValidationError,
} from "./types.ts";

export interface SeedNormalizeContext {
	domainId: string;
	/** Position of the item in its seed file (default order). */
	index: number;
	createdAt: string;
	/** Does any seed item name this one as parent? */
	hasChildren: boolean;
}

/** Full CurriculumItem from its compact seed form (defaults documented on SeedItem). */
export function normalizeSeedItem(seed: SeedItem, ctx: SeedNormalizeContext): CurriculumItem {
	const status = seed.status ?? (seed.kind === "atom" || ctx.hasChildren ? "stable" : "stub");
	const item: CurriculumItem = {
		id: seed.id,
		domainId: ctx.domainId,
		kind: seed.kind,
		...(seed.atomType !== undefined ? { atomType: seed.atomType } : {}),
		parentId: seed.parentId,
		order: seed.order ?? ctx.index,
		title: { pt: seed.title.pt, en: seed.title.en },
		aliases: [...(seed.aliases ?? [])],
		scope: seed.scope !== undefined && seed.scope !== "" ? seed.scope : seed.summary,
		summary: seed.summary,
		objectives: [...(seed.objectives ?? [])],
		...(seed.bloom !== undefined ? { bloom: seed.bloom } : {}),
		assess: [...(seed.assess ?? [])],
		...(seed.misconceptions !== undefined ? { misconceptions: [...seed.misconceptions] } : {}),
		level: structuredClone(seed.level),
		clauses: normalizeClauses(seed.clauses ?? []),
		softPrereqs: [...new Set(seed.softPrereqs ?? [])],
		encompasses: (seed.encompasses ?? []).map((e) => ({ id: e.id, w: e.w })),
		hours: { lo: seed.hours.lo, hi: seed.hours.hi },
		anchors: (seed.anchors ?? []).map((a) => ({ ...a })),
		status,
		version: 1,
		...(seed.lexicalItems !== undefined ? { lexicalItems: seed.lexicalItems.map((l) => ({ ...l })) } : {}),
		...(seed.practice !== undefined ? { practice: { ...seed.practice } } : {}),
		provenance: { createdBy: "seed", createdAt: ctx.createdAt },
		...(seed.tags !== undefined ? { tags: [...seed.tags] } : {}),
	};
	return item;
}

/** Parse one seed file (zod); errors carry readable paths. */
export function parseSeedFile(raw: unknown, label = "seed"): { ok: true; file: CurriculumSeedFile } | { ok: false; errors: ValidationError[] } {
	const res = parseWith(CurriculumSeedFileSchema, raw, `${label}.`);
	return res.ok ? { ok: true, file: res.value } : { ok: false, errors: res.errors };
}

export interface SeedPatchOptions {
	/** Timestamp stamped on the envelope and every seeded item's provenance (replay-stable). */
	createdAt: string;
	patchId?: string;
	model?: string;
	promptVersion?: string;
	/** Override clauses of specific items (used by transitive reduction in ./ledger.ts). */
	clauseOverrides?: ReadonlyMap<string, string[][]>;
}

export type SeedPatchResult = { ok: true; root: CurriculumItem; envelope: PatchEnvelope } | { ok: false; errors: ValidationError[] };

function edgeIdentity(e: CurriculumEdge): string {
	return `${e.from}\u0001${e.to}\u0001${e.kind}`;
}

/** Validate seed files and turn them into the initial patch (see header). */
export function seedFilesToPatch(rawFiles: readonly unknown[], opts: SeedPatchOptions): SeedPatchResult {
	const errors: ValidationError[] = [];
	const files: CurriculumSeedFile[] = [];
	rawFiles.forEach((raw, i) => {
		const res = parseSeedFile(raw, `files[${i}]`);
		if (res.ok) files.push(res.file);
		else errors.push(...res.errors);
	});
	if (errors.length > 0) return { ok: false, errors };
	if (files.length === 0) return { ok: false, errors: [{ code: "schema", message: "nenhum arquivo de seed" }] };
	const domainId = files[0]!.domainId;
	for (const f of files)
		if (f.domainId !== domainId) errors.push({ code: "schema", message: `arquivo da área "${f.areaId}" é do domínio "${f.domainId}", esperado "${domainId}"` });

	const entries: { seed: SeedItem; index: number }[] = [];
	const byId = new Map<string, SeedItem>();
	for (const f of files)
		f.items.forEach((seed, index) => {
			if (byId.has(seed.id)) errors.push({ code: "duplicate-id", message: `id "${seed.id}" aparece mais de uma vez no seed`, witness: [seed.id] });
			else {
				byId.set(seed.id, seed);
				entries.push({ seed, index });
			}
		});
	const roots = entries.filter((e) => e.seed.parentId === null);
	if (roots.length !== 1)
		errors.push({ code: "hierarchy", message: `o seed deve ter exatamente uma raiz (parentId null); tem ${roots.length}`, witness: roots.map((r) => r.seed.id) });
	else if (roots[0]!.seed.kind !== "domain")
		errors.push({ code: "hierarchy", message: `a raiz ${roots[0]!.seed.id} deve ter kind "domain"`, witness: [roots[0]!.seed.id] });
	if (errors.length > 0) return { ok: false, errors };

	const rootSeed = roots[0]!.seed;
	const childrenOf = new Map<string, { seed: SeedItem; index: number }[]>();
	for (const e of entries) {
		if (e.seed.parentId === null) continue;
		if (!byId.has(e.seed.parentId)) {
			errors.push({ code: "unknown-id", message: `${e.seed.id}: pai "${e.seed.parentId}" não está no seed`, witness: [e.seed.id, e.seed.parentId] });
			continue;
		}
		const list = childrenOf.get(e.seed.parentId) ?? [];
		list.push(e);
		childrenOf.set(e.seed.parentId, list);
	}
	// Parents first (BFS from the root); whatever is not reached hangs in a parent cycle.
	const ordered: { seed: SeedItem; index: number }[] = [roots[0]!];
	for (let h = 0; h < ordered.length; h++) ordered.push(...(childrenOf.get(ordered[h]!.seed.id) ?? []));
	if (ordered.length !== entries.length && errors.length === 0) {
		const reached = new Set(ordered.map((e) => e.seed.id));
		const lost = entries.filter((e) => !reached.has(e.seed.id)).map((e) => e.seed.id);
		errors.push({ code: "hierarchy", message: `itens fora da árvore da raiz (ciclo em parentId): ${lost.join(", ")}`, witness: lost });
	}
	if (errors.length > 0) return { ok: false, errors };

	const ops: ExpansionOp[] = [];
	const itemPayloads: Record<string, Partial<CurriculumItem>> = {};
	let root: CurriculumItem | null = null;
	for (const { seed, index } of ordered) {
		const item = normalizeSeedItem(seed, { domainId, index, createdAt: opts.createdAt, hasChildren: childrenOf.has(seed.id) });
		const override = opts.clauseOverrides?.get(item.id);
		if (override) item.clauses = normalizeClauses(override);
		itemPayloads[item.id] = item;
		if (seed.id === rootSeed.id) {
			const problems = domainRootProblems(item);
			if (problems.length > 0) return { ok: false, errors: problems };
			root = item;
			continue;
		}
		ops.push({
			op: "addItem",
			id: item.id,
			parentId: item.parentId!,
			kind: item.kind,
			title: item.title,
			hours: item.hours,
			clauses: item.clauses.length > 0 ? item.clauses : "entry",
		});
	}
	const seenEdges = new Set<string>();
	for (const f of files)
		for (const edge of f.edges ?? []) {
			const key = edgeIdentity(edge);
			if (seenEdges.has(key)) continue;
			seenEdges.add(key);
			ops.push({ op: "addEdge", edge: { ...edge } });
		}
	if (ops.length === 0) ops.push({ op: "setHours", item: rootSeed.id, hours: { ...rootSeed.hours } });

	const envelope: PatchEnvelope = {
		patchId: opts.patchId ?? `seed-${domainId}`,
		domainId,
		baseVersion: 0,
		trigger: { kind: "seed", nodeId: rootSeed.id, reason: "seed inicial do domínio", priority: 0 },
		ops,
		itemPayloads,
		risk: "structural",
		provenance: { model: opts.model ?? "seed", promptVersion: opts.promptVersion ?? "seed-v1", samples: 1 },
		createdAt: opts.createdAt,
	};
	return { ok: true, root: root!, envelope };
}

/**
 * Why `root` cannot be a domain root (empty = it can): zod shape, no parent,
 * kind "domain", no clauses (every item descends from it), not retired.
 * Shared by initialSnapshot (throws), seedFilesToPatch and the ledger replay
 * (both return the errors instead of throwing).
 */
export function domainRootProblems(root: unknown): ValidationError[] {
	const parsed = CurriculumItemSchema.safeParse(root);
	if (!parsed.success) return [{ code: "schema", message: `raiz inválida: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` }];
	const r = parsed.data;
	const problems: ValidationError[] = [];
	if (r.parentId !== null) problems.push({ code: "hierarchy", message: `a raiz ${r.id} não pode ter pai`, witness: [r.id] });
	if (r.kind !== "domain") problems.push({ code: "hierarchy", message: `a raiz ${r.id} deve ter kind "domain"`, witness: [r.id] });
	if (r.clauses.length > 0) problems.push({ code: "hierarchy", message: `a raiz ${r.id} não pode ter cláusulas (todo item descende dela)`, witness: [r.id] });
	if (r.status === "deprecated") problems.push({ code: "hierarchy", message: `a raiz ${r.id} não pode estar aposentada`, witness: [r.id] });
	return problems;
}

/** Version-0 snapshot holding only the domain root (the base of the seed patch). Throws a CurriculumError on a bad root. */
export function initialSnapshot(root: CurriculumItem, opts: { now?: string } = {}): CurriculumSnapshot {
	const problems = domainRootProblems(root);
	if (problems.length > 0) throw new CurriculumError(problems);
	const base = { schemaVersion: 1 as const, domainId: root.domainId, version: 0, items: { [root.id]: root }, edges: [] as CurriculumEdge[] };
	return { ...base, certificate: computeCertificate(base), updatedAt: opts.now ?? root.provenance.createdAt };
}

/** The domain root carried in a seed envelope's itemPayloads (the one payload no op creates). */
export function rootFromSeedEnvelope(env: PatchEnvelope): { ok: true; root: CurriculumItem } | { ok: false; errors: ValidationError[] } {
	if (env.trigger.kind !== "seed") return { ok: false, errors: [{ code: "schema", message: `o primeiro patch do ledger deve ser o seed (trigger "seed"), não "${env.trigger.kind}"` }] };
	const created = new Set<string>();
	for (const op of env.ops) if (op.op === "addItem") created.add(op.id);
	const candidates = Object.entries(env.itemPayloads).filter(([id, p]) => !created.has(id) && p.parentId === null);
	if (candidates.length !== 1)
		return { ok: false, errors: [{ code: "hierarchy", message: `o seed deve carregar exatamente uma raiz em itemPayloads; tem ${candidates.length}` }] };
	const [, payload] = candidates[0]!;
	const res = parseWith(CurriculumItemSchema, payload, "itemPayloads.raiz.");
	if (!res.ok) return { ok: false, errors: res.errors };
	const problems = domainRootProblems(res.value);
	return problems.length > 0 ? { ok: false, errors: problems } : { ok: true, root: res.value };
}
