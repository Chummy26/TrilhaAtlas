/**
 * Zod 4 schemas for the curriculum contracts (./types.ts).
 *
 * First stage of the applyPatch pipeline "zod → clone → invariantes →
 * certificado" (docs/research/00-SINTESE.md §2.4(e), §2.13; r10 §6.3 [1]).
 * Shapes the MODEL writes (ops, envelopes) are strict objects, so a typo or an
 * extra key comes back to the agent as a readable `schema` error (Clew pattern,
 * docs/research/extra-miuuyy__Clew.md §4.2) — this includes the item payloads
 * and the `updateItem` fields, where a dropped typo would turn the op into a
 * silent no-op. Stored items are parsed with
 * plain objects (unknown keys are stripped, never rejected) so other modules
 * can later ADD optional fields to `CurriculumItem` without breaking loads.
 *
 * Fast shape guards (`isCurriculumItemShape`, `isCurriculumEdgeShape`,
 * `isCurriculumSnapshotShape`): hand-written predicates that mirror the
 * stored-data schemas field by field and are SOUND with respect to them
 * (guard true ⇒ zod accepts). ./invariants.ts runs them first and calls zod
 * only when a guard fails, to produce zod's readable messages: a valid
 * 20 000-item snapshot is then checked in a few ms instead of ~80 ms of zod
 * (SÍNTESE §2.13 "validação completa em milissegundos"). A guard may be
 * stricter than zod (it only costs the zod fallback), never laxer; the tests
 * pin the field list to the schema shape and cross-check both with fast-check.
 *
 * Pure and browser-safe.
 */

import { z } from "zod";
import {
	CURRICULUM_ID_PATTERN,
	type CurriculumEdge,
	type CurriculumItem,
	type CurriculumSeedFile,
	type CurriculumSnapshot,
	type ExpansionOp,
	type PatchEnvelope,
	type SeedItem,
	type ValidationError,
} from "./types.ts";

// ─── Atoms ──────────────────────────────────────────────────────────────────

export const CurriculumIdSchema = z
	.string()
	.regex(CURRICULUM_ID_PATTERN, "id inválido: use `<prefixo>.<segmentos>` em minúsculas (ex.: \"ee.analog.opamp\")");

export const LocalizedTextSchema = z.object({ pt: z.string(), en: z.string() });

export const HoursSchema = z
	.object({ lo: z.number().min(0), hi: z.number().min(0) })
	.refine((h) => h.lo <= h.hi, { message: "horas: `lo` deve ser ≤ `hi`" });

export const NodeKindSchema = z.enum(["domain", "area", "unit", "topic", "atom"]);

export const AtomTypeSchema = z.enum([
	"concept",
	"procedure",
	"lexical_set",
	"phoneme_contrast",
	"can_do",
	"practice_regime",
	"lab",
	"design_project",
	"checkpoint",
]);

export const NodeStatusSchema = z.enum(["stub", "proposed", "provisional", "stable", "deprecated"]);

export const BloomLevelSchema = z.enum(["remember", "understand", "apply", "analyze", "evaluate", "create"]);

export const AnchorRefSchema = z.object({
	source: z.string().min(1),
	ref: z.string().min(1),
	span: z.string().optional(),
	embeddable: z.boolean(),
	evidence: z.string().optional(),
});

export const NodeLevelSchema = z.discriminatedUnion("scheme", [
	z.object({
		scheme: z.literal("ee"),
		band: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
	}),
	z.object({
		scheme: z.literal("cefr"),
		cefr: z.enum(["pre-A1", "A1", "A2", "B1", "B2", "C1", "C2"]),
		gse: z.number().optional(),
	}),
	z.object({ scheme: z.literal("generic"), band: z.number() }),
]);

export const LexicalItemSchema = z.object({
	lemma: z.string().min(1),
	pos: z.string().optional(),
	cefr: z.string().optional(),
	ngslRank: z.number().optional(),
});

export const CurriculumProvenanceSchema = z.object({
	createdBy: z.enum(["seed", "expansion", "user", "import"]),
	trigger: z.string().optional(),
	model: z.string().optional(),
	promptVersion: z.string().optional(),
	createdAt: z.string().min(1),
	validation: z
		.object({
			dedupMaxSim: z.number(),
			consensus: z.number(),
			critic: z.string().optional(),
			anchorCoverage: z.number(),
		})
		.optional(),
});

/** Stored prerequisite clauses: OR of ANDs over node ids. */
export const ClausesSchema = z.array(z.array(CurriculumIdSchema));

export const EncompassesSchema = z.array(z.object({ id: CurriculumIdSchema, w: z.number().gt(0).max(1) }));

export const PracticeSchema = z.object({ targetHours: z.number().min(0), exitCriterion: z.string().min(1) });

export const CurriculumItemSchema = z.object({
	id: CurriculumIdSchema,
	domainId: z.string().min(1),
	kind: NodeKindSchema,
	atomType: AtomTypeSchema.optional(),
	parentId: CurriculumIdSchema.nullable(),
	order: z.number(),
	title: LocalizedTextSchema,
	aliases: z.array(z.string()),
	scope: z.string(),
	summary: z.string(),
	objectives: z.array(z.string()),
	bloom: BloomLevelSchema.optional(),
	assess: z.array(z.string()),
	misconceptions: z.array(z.string()).optional(),
	level: NodeLevelSchema,
	clauses: ClausesSchema,
	softPrereqs: z.array(CurriculumIdSchema),
	encompasses: EncompassesSchema,
	hours: HoursSchema,
	anchors: z.array(AnchorRefSchema),
	status: NodeStatusSchema,
	version: z.number().int().min(1),
	estMinutesObserved: z.object({ mean: z.number().min(0), n: z.number().int().min(0) }).optional(),
	lexicalItems: z.array(LexicalItemSchema).optional(),
	practice: PracticeSchema.optional(),
	provenance: CurriculumProvenanceSchema,
	aliasOf: CurriculumIdSchema.optional(),
	supersededBy: z.array(CurriculumIdSchema).optional(),
	tags: z.array(z.string()).optional(),
	reinforcementFor: CurriculumIdSchema.optional(),
});

export const EdgeKindSchema = z.enum(["also_in", "related", "confusable_with", "anchored_to", "covered_by"]);

export const CurriculumEdgeSchema = z.object({
	from: CurriculumIdSchema,
	/** Item id for item↔item kinds; external reference for anchored_to / covered_by. */
	to: z.string().min(1),
	kind: EdgeKindSchema,
	w: z.number().min(0).max(1).optional(),
});

export const CurriculumCertificateSchema = z.object({ order: z.array(z.string()), hash: z.string() });

export const CurriculumSnapshotSchema = z.object({
	schemaVersion: z.literal(1),
	domainId: z.string().min(1),
	version: z.number().int().min(0),
	items: z.record(z.string(), CurriculumItemSchema),
	edges: z.array(CurriculumEdgeSchema),
	certificate: CurriculumCertificateSchema,
	updatedAt: z.string(),
});

// ─── Patches ────────────────────────────────────────────────────────────────

const ItemClausesOrEntrySchema = z.union([ClausesSchema, z.literal("entry")]);

export const NewItemSpecSchema = z.strictObject({
	id: CurriculumIdSchema,
	parentId: CurriculumIdSchema,
	kind: NodeKindSchema,
	title: LocalizedTextSchema,
	hours: HoursSchema,
	clauses: ItemClausesOrEntrySchema,
});

const SubItemSpecSchema = z.strictObject({
	id: CurriculumIdSchema,
	kind: NodeKindSchema,
	title: LocalizedTextSchema,
	hours: HoursSchema,
	clauses: ItemClausesOrEntrySchema,
});

/**
 * Fields `updateItem` may touch (structure and identity are off limits).
 * STRICT: an unknown key (a typo such as "sumary") is a `schema` error, never
 * a silently dropped field that would make the op a no-op reported as applied.
 */
export const UpdatableFieldsSchema = z.strictObject(
	CurriculumItemSchema.omit({
		id: true,
		domainId: true,
		parentId: true,
		clauses: true,
		kind: true,
		reinforcementFor: true,
	}).partial().shape,
);

/** Rich fields of an item created by the patch (`itemPayloads[id]`). Strict for the same reason as UpdatableFieldsSchema. */
export const ItemPayloadSchema = z.strictObject(CurriculumItemSchema.partial().shape);

/** Keys an `updateItem` must never carry (identity/structure — r3 I1 ids imutáveis). */
export const IMMUTABLE_ITEM_KEYS = ["id", "domainId", "parentId", "kind", "reinforcementFor"] as const;

export const ExpansionOpSchema = z.discriminatedUnion("op", [
	z.strictObject({
		op: z.literal("addItem"),
		id: CurriculumIdSchema,
		parentId: CurriculumIdSchema,
		kind: NodeKindSchema,
		title: LocalizedTextSchema,
		hours: HoursSchema,
		clauses: ItemClausesOrEntrySchema,
	}),
	z.strictObject({
		op: z.literal("addAlternative"),
		item: CurriculumIdSchema,
		// An empty route would be TRUE and silently erase every prerequisite of the item (TRUE ∨ … = TRUE).
		clause: z.array(CurriculumIdSchema).min(1, "a alternativa precisa citar ao menos um pré-requisito (uma rota vazia apagaria todos os pré-requisitos do item)"),
	}),
	z.strictObject({
		op: z.literal("addPrereq"),
		item: CurriculumIdSchema,
		clauseIndex: z.number().int().min(0),
		prereq: CurriculumIdSchema,
	}),
	z.strictObject({ op: z.literal("refine"), item: CurriculumIdSchema, sub: z.array(SubItemSpecSchema).min(1) }),
	z.strictObject({
		op: z.literal("addSubdomain"),
		id: CurriculumIdSchema,
		parentId: CurriculumIdSchema,
		title: LocalizedTextSchema,
		// Without items the "subdomain" would be a 0-hour stub leaf: that is addItem.
		items: z.array(NewItemSpecSchema).min(1, "um subdomínio precisa de ao menos um item (para um único nó use addItem)"),
	}),
	z.strictObject({
		op: z.literal("retire"),
		item: CurriculumIdSchema,
		reroute: z.array(z.strictObject({ item: CurriculumIdSchema, clause: z.array(CurriculumIdSchema) })),
	}),
	z.strictObject({ op: z.literal("setHours"), item: CurriculumIdSchema, hours: HoursSchema }),
	z.strictObject({ op: z.literal("updateItem"), item: CurriculumIdSchema, fields: UpdatableFieldsSchema }),
	z.strictObject({ op: z.literal("addEdge"), edge: CurriculumEdgeSchema }),
]);

export const TriggerRefSchema = z.strictObject({
	kind: z.enum(["frontier", "weakness", "request", "coverage-gap", "granularity", "seed"]),
	nodeId: z.string().optional(),
	reason: z.string(),
	priority: z.number(),
});

export const PatchEnvelopeSchema = z.strictObject({
	patchId: z.string().min(1),
	domainId: z.string().min(1),
	baseVersion: z.number().int().min(0),
	trigger: TriggerRefSchema,
	ops: z.array(ExpansionOpSchema).min(1, "um patch precisa de ao menos uma operação"),
	itemPayloads: z.record(z.string(), ItemPayloadSchema),
	risk: z.enum(["low", "structural"]),
	provenance: z.strictObject({ model: z.string(), promptVersion: z.string(), samples: z.number().int().min(1) }),
	createdAt: z.string().min(1),
});

// ─── Seeds ──────────────────────────────────────────────────────────────────

export const SeedItemSchema = z.strictObject({
	id: CurriculumIdSchema,
	kind: NodeKindSchema,
	parentId: CurriculumIdSchema.nullable(),
	order: z.number().optional(),
	title: LocalizedTextSchema,
	summary: z.string(),
	scope: z.string().optional(),
	objectives: z.array(z.string()).optional(),
	atomType: AtomTypeSchema.optional(),
	bloom: BloomLevelSchema.optional(),
	assess: z.array(z.string()).optional(),
	misconceptions: z.array(z.string()).optional(),
	level: NodeLevelSchema,
	clauses: ClausesSchema.optional(),
	softPrereqs: z.array(CurriculumIdSchema).optional(),
	encompasses: EncompassesSchema.optional(),
	hours: HoursSchema,
	anchors: z.array(AnchorRefSchema).optional(),
	status: NodeStatusSchema.optional(),
	tags: z.array(z.string()).optional(),
	aliases: z.array(z.string()).optional(),
	lexicalItems: z.array(LexicalItemSchema).optional(),
	practice: PracticeSchema.optional(),
});

export const CurriculumSeedFileSchema = z.strictObject({
	schemaVersion: z.literal(1),
	domainId: z.string().min(1),
	areaId: z.string().min(1),
	items: z.array(SeedItemSchema),
	edges: z.array(CurriculumEdgeSchema).optional(),
	sources: z.array(
		z.strictObject({
			id: z.string().min(1),
			title: z.string(),
			url: z.string().optional(),
			license: z.string(),
			usage: z.enum(["reference", "embedded"]),
			kind: z.enum(["book", "video"]).optional(),
			lang: z.string().min(2).max(35).optional(),
		}),
	),
});

// ─── Contract drift guards (compile-time only) ──────────────────────────────

type AssertAssignable<Target, Source extends Target> = Source;
export type _ItemSchemaMatchesContract = AssertAssignable<CurriculumItem, z.infer<typeof CurriculumItemSchema>>;
export type _EdgeSchemaMatchesContract = AssertAssignable<CurriculumEdge, z.infer<typeof CurriculumEdgeSchema>>;
export type _SnapshotSchemaMatchesContract = AssertAssignable<CurriculumSnapshot, z.infer<typeof CurriculumSnapshotSchema>>;
export type _OpSchemaMatchesContract = AssertAssignable<ExpansionOp, z.infer<typeof ExpansionOpSchema>>;
export type _EnvelopeSchemaMatchesContract = AssertAssignable<PatchEnvelope, z.infer<typeof PatchEnvelopeSchema>>;
export type _SeedItemSchemaMatchesContract = AssertAssignable<SeedItem, z.infer<typeof SeedItemSchema>>;
export type _SeedFileSchemaMatchesContract = AssertAssignable<CurriculumSeedFile, z.infer<typeof CurriculumSeedFileSchema>>;

// ─── Fast shape guards (sound w.r.t. the schemas above) ─────────────────────

const NODE_KINDS: ReadonlySet<unknown> = new Set(NodeKindSchema.options);
const ATOM_TYPES: ReadonlySet<unknown> = new Set(AtomTypeSchema.options);
const NODE_STATUSES: ReadonlySet<unknown> = new Set(NodeStatusSchema.options);
const BLOOM_LEVELS: ReadonlySet<unknown> = new Set(BloomLevelSchema.options);
const EDGE_KINDS: ReadonlySet<unknown> = new Set(EdgeKindSchema.options);
const CREATED_BY: ReadonlySet<unknown> = new Set(CurriculumProvenanceSchema.shape.createdBy.options);
const CEFR_LEVELS: ReadonlySet<unknown> = new Set(["pre-A1", "A1", "A2", "B1", "B2", "C1", "C2"]);
const EE_BANDS: ReadonlySet<unknown> = new Set([0, 1, 2, 3, 4]);

/** Keys of `CurriculumItem` known to `isCurriculumItemShape` (pinned to the schema shape by the tests). */
export const ITEM_SHAPE_KEYS = [
	"id",
	"domainId",
	"kind",
	"atomType",
	"parentId",
	"order",
	"title",
	"aliases",
	"scope",
	"summary",
	"objectives",
	"bloom",
	"assess",
	"misconceptions",
	"level",
	"clauses",
	"softPrereqs",
	"encompasses",
	"hours",
	"anchors",
	"status",
	"version",
	"estMinutesObserved",
	"lexicalItems",
	"practice",
	"provenance",
	"aliasOf",
	"supersededBy",
	"tags",
	"reinforcementFor",
] as const;

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** zod's `isPlainObject` (the record check), minus nothing. */
function isPlainRec(v: unknown): v is Rec {
	if (!isRec(v)) return false;
	const ctor = (v as { constructor?: unknown }).constructor;
	if (ctor === undefined || typeof ctor !== "function") return true;
	const proto = (ctor as { prototype?: unknown }).prototype;
	return isRec(proto) && Object.prototype.hasOwnProperty.call(proto, "isPrototypeOf");
}

const isStr = (v: unknown): v is string => typeof v === "string";
const isFilledStr = (v: unknown): boolean => typeof v === "string" && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isId = (v: unknown): boolean => typeof v === "string" && CURRICULUM_ID_PATTERN.test(v);
const optional = (v: unknown, pred: (x: unknown) => boolean): boolean => v === undefined || pred(v);

/** Dense array (no holes) whose every element passes `pred`. */
function isArrayOf(v: unknown, pred: (x: unknown) => boolean): boolean {
	if (!Array.isArray(v)) return false;
	for (let i = 0; i < v.length; i++) if (!pred(v[i])) return false;
	return true;
}

const isIdArray = (v: unknown): boolean => isArrayOf(v, isId);
const isStrArray = (v: unknown): boolean => isArrayOf(v, isStr);

function isTitle(v: unknown): boolean {
	return isRec(v) && isStr(v.pt) && isStr(v.en);
}

function isHours(v: unknown): boolean {
	return isRec(v) && isNum(v.lo) && isNum(v.hi) && v.lo >= 0 && v.hi >= 0 && v.lo <= v.hi;
}

function isLevel(v: unknown): boolean {
	if (!isRec(v)) return false;
	switch (v.scheme) {
		case "ee":
			return EE_BANDS.has(v.band);
		case "cefr":
			return CEFR_LEVELS.has(v.cefr) && optional(v.gse, isNum);
		case "generic":
			return isNum(v.band);
		default:
			return false;
	}
}

function isEncompass(v: unknown): boolean {
	return isRec(v) && isId(v.id) && isNum(v.w) && v.w > 0 && v.w <= 1;
}

function isAnchor(v: unknown): boolean {
	return isRec(v) && isFilledStr(v.source) && isFilledStr(v.ref) && optional(v.span, isStr) && typeof v.embeddable === "boolean" && optional(v.evidence, isStr);
}

function isLexicalItem(v: unknown): boolean {
	return isRec(v) && isFilledStr(v.lemma) && optional(v.pos, isStr) && optional(v.cefr, isStr) && optional(v.ngslRank, isNum);
}

function isProvenance(v: unknown): boolean {
	if (!isRec(v)) return false;
	if (!CREATED_BY.has(v.createdBy) || !isFilledStr(v.createdAt)) return false;
	if (!optional(v.trigger, isStr) || !optional(v.model, isStr) || !optional(v.promptVersion, isStr)) return false;
	const val = v.validation;
	return (
		val === undefined ||
		(isRec(val) && isNum(val.dedupMaxSim) && isNum(val.consensus) && optional(val.critic, isStr) && isNum(val.anchorCoverage))
	);
}

function isEstMinutes(v: unknown): boolean {
	return isRec(v) && isNum(v.mean) && v.mean >= 0 && Number.isSafeInteger(v.n) && (v.n as number) >= 0;
}

function isPractice(v: unknown): boolean {
	return isRec(v) && isNum(v.targetHours) && v.targetHours >= 0 && isFilledStr(v.exitCriterion);
}

/** Fast guard for `CurriculumItemSchema` (true ⇒ zod accepts; see header). */
export function isCurriculumItemShape(v: unknown): boolean {
	if (!isRec(v)) return false;
	return (
		isId(v.id) &&
		isFilledStr(v.domainId) &&
		NODE_KINDS.has(v.kind) &&
		(v.atomType === undefined || ATOM_TYPES.has(v.atomType)) &&
		(v.parentId === null || isId(v.parentId)) &&
		isNum(v.order) &&
		isTitle(v.title) &&
		isStrArray(v.aliases) &&
		isStr(v.scope) &&
		isStr(v.summary) &&
		isStrArray(v.objectives) &&
		(v.bloom === undefined || BLOOM_LEVELS.has(v.bloom)) &&
		isStrArray(v.assess) &&
		optional(v.misconceptions, isStrArray) &&
		isLevel(v.level) &&
		isArrayOf(v.clauses, isIdArray) &&
		isIdArray(v.softPrereqs) &&
		isArrayOf(v.encompasses, isEncompass) &&
		isHours(v.hours) &&
		isArrayOf(v.anchors, isAnchor) &&
		NODE_STATUSES.has(v.status) &&
		Number.isSafeInteger(v.version) &&
		(v.version as number) >= 1 &&
		optional(v.estMinutesObserved, isEstMinutes) &&
		optional(v.lexicalItems, (x) => isArrayOf(x, isLexicalItem)) &&
		optional(v.practice, isPractice) &&
		isProvenance(v.provenance) &&
		optional(v.aliasOf, isId) &&
		optional(v.supersededBy, isIdArray) &&
		optional(v.reinforcementFor, isId) &&
		optional(v.tags, isStrArray)
	);
}

/** Fast guard for `CurriculumEdgeSchema` (true ⇒ zod accepts). */
export function isCurriculumEdgeShape(v: unknown): boolean {
	return isRec(v) && isId(v.from) && isFilledStr(v.to) && EDGE_KINDS.has(v.kind) && optional(v.w, (w) => isNum(w) && w >= 0 && w <= 1);
}

/** Fast guard for `CurriculumSnapshotSchema` (true ⇒ zod accepts). */
export function isCurriculumSnapshotShape(v: unknown): boolean {
	if (!isRec(v)) return false;
	if (v.schemaVersion !== 1 || !isFilledStr(v.domainId) || !Number.isSafeInteger(v.version) || (v.version as number) < 0 || !isStr(v.updatedAt)) return false;
	const cert = v.certificate;
	if (!isRec(cert) || !isStrArray(cert.order) || !isStr(cert.hash)) return false;
	if (!isArrayOf(v.edges, isCurriculumEdgeShape)) return false;
	const items = v.items;
	if (!isPlainRec(items) || Object.getOwnPropertySymbols(items).length > 0) return false;
	for (const key of Object.keys(items)) if (!isCurriculumItemShape(items[key])) return false;
	return true;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatPath(path: readonly PropertyKey[]): string {
	if (path.length === 0) return "(raiz)";
	return path.map((p) => (typeof p === "number" ? `[${p}]` : String(p))).join(".").replace(/\.\[/g, "[");
}

/** Turn a zod error into `schema` ValidationErrors with readable paths. */
export function zodIssuesToErrors(error: z.ZodError, prefix = ""): ValidationError[] {
	return error.issues.map((issue) => ({
		code: "schema" as const,
		message: `${prefix}${formatPath(issue.path)}: ${issue.message}`,
	}));
}

/** Parse `value` with `schema`; on failure returns ValidationErrors instead of throwing. */
export function parseWith<T>(
	schema: z.ZodType<T>,
	value: unknown,
	prefix = "",
): { ok: true; value: T } | { ok: false; errors: ValidationError[] } {
	const res = schema.safeParse(value);
	return res.success ? { ok: true, value: res.data } : { ok: false, errors: zodIssuesToErrors(res.error, prefix) };
}

/** JSON Schema of the patch envelope (input side) for agent tool definitions. */
export function patchEnvelopeJsonSchema(): Record<string, unknown> {
	return z.toJSONSchema(PatchEnvelopeSchema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
}

/** JSON Schema of a single expansion op (input side). */
export function expansionOpJsonSchema(): Record<string, unknown> {
	return z.toJSONSchema(ExpansionOpSchema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
}
