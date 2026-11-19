/**
 * Curriculum graph contracts (docs/research/00-SINTESE.md §2.3, §2.7, §2.13;
 * r3 schema, r10 clause-system model).
 *
 * ─── The model ──────────────────────────────────────────────────────────────
 * Per domain, a forest of nodes  Domain → Area → Unit → Topic → Atom
 * (`parentId` = part_of) carrying an AND/OR prerequisite system:
 *
 *   clauses: string[][]   — CNF read as OR-of-ANDs: the node is reachable when
 *                           ALL ids of ANY one inner array are attained.
 *                           `[]` (no stored clauses) = no own requirement.
 *   strict mode           — at most 2 alternatives (inner arrays) per node.
 *
 * Hierarchy semantics (refinement-as-milestone, r10 §4.1). Learners study
 * LEAVES (atoms, or not-yet-refined stubs). For the clause system every node
 * is an item, with EFFECTIVE clauses derived as follows:
 *   • container (has children): effective = [[...childIds]] — a milestone,
 *     attained exactly when every child is attained (derived, never taught).
 *   • a container's own stored `clauses` are ENTRY requirements: inherited
 *     (AND-combined) by each child that is a SOURCE among its siblings, i.e.
 *     whose stored clauses reference no sibling. Recursive down the tree.
 *   • stored clauses NEVER reference an ancestor or a descendant (hierarchy
 *     rule); they may reference any other node of the same domain, including
 *     a container (= "that whole unit").
 * Invariants R1 (every item has a route from entry items), R2 (a rank
 * certificate: every effective clause points to strictly lower rank) and R3
 * (no dangling ids) are checked on the EFFECTIVE system. The learner model,
 * frontier and planner consume the effective system only.
 *
 * "Attained" is monotonic (learner/types.ts); retention is a separate layer.
 *
 * Pure types: browser-safe. Validation lives in ./schema.ts + ./invariants.ts.
 */

import type { DomainId, LocalizedText } from "../domains/types.ts";

export type Hours = { lo: number; hi: number };

export type NodeKind = "domain" | "area" | "unit" | "topic" | "atom";

export type AtomType =
	| "concept"
	| "procedure"
	| "lexical_set"
	| "phoneme_contrast"
	| "can_do"
	| "practice_regime"
	| "lab"
	| "design_project"
	| "checkpoint";

/** stub = placeholder leaf awaiting refinement; provisional = generated, not yet confirmed. */
export type NodeStatus = "stub" | "proposed" | "provisional" | "stable" | "deprecated";

export type BloomLevel = "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create";

export interface AnchorRef {
	/** Anchor source id, e.g. "cefr-j-vp", "ngsl", "model-kuphaldt", "ncees-fe", "mit-ocw". */
	source: string;
	/** Reference inside the source (section id, word list rank, module number…). */
	ref: string;
	span?: string;
	/** May the referenced content itself be embedded (license allows)? Otherwise reference only. */
	embeddable: boolean;
	evidence?: string;
}

export type NodeLevel =
	| { scheme: "ee"; band: 0 | 1 | 2 | 3 | 4 } // 0 foundations · 1 technician · 2 undergrad · 3 advanced undergrad · 4 graduate/PhD
	| { scheme: "cefr"; cefr: "pre-A1" | "A1" | "A2" | "B1" | "B2" | "C1" | "C2"; gse?: number }
	| { scheme: "generic"; band: number };

export interface LexicalItem {
	lemma: string;
	pos?: string;
	cefr?: string;
	ngslRank?: number;
}

export interface CurriculumProvenance {
	createdBy: "seed" | "expansion" | "user" | "import";
	trigger?: string;
	model?: string;
	promptVersion?: string;
	createdAt: string;
	validation?: { dedupMaxSim: number; consensus: number; critic?: string; anchorCoverage: number };
}

export interface CurriculumItem {
	/** Immutable id: `<prefix>.<path…>`, lowercase slug segments, e.g. "ee.analog.opamp.inverting". */
	id: string;
	domainId: DomainId;
	kind: NodeKind;
	atomType?: AtomType;
	/** part_of forest; null only for the domain root. */
	parentId: string | null;
	/** Sibling order inside the parent (stable display/teaching order). */
	order: number;
	title: LocalizedText;
	aliases: string[];
	/** Scope contract: what is inside / outside this node. */
	scope: string;
	summary: string;
	/** 1–3 assessable objectives for atoms; broader for containers. */
	objectives: string[];
	bloom?: BloomLevel;
	/** How mastery is assessed (open vocabulary: "numeric", "derivation", "explain", "dictation"…). */
	assess: string[];
	misconceptions?: string[];
	level: NodeLevel;
	/** Stored prerequisite clauses (see header). [] = none of its own. */
	clauses: string[][];
	/** Soft ordering hints (builds_towards); never gate. */
	softPrereqs: string[];
	/** FIRe encompassing edges: practicing this node implicitly reviews `id` with weight w ∈ (0,1]. */
	encompasses: { id: string; w: number }[];
	/** Estimated study hours. Atoms: 10–45 min. Unrefined stubs: hi ≤ 4 h preferred (else refine). */
	hours: Hours;
	anchors: AnchorRef[];
	status: NodeStatus;
	/** Bumped when the node DEFINITION changes (resets evidence); edge-only changes do not bump it. */
	version: number;
	estMinutesObserved?: { mean: number; n: number };
	lexicalItems?: LexicalItem[];
	practice?: { targetHours: number; exitCriterion: string };
	provenance: CurriculumProvenance;
	aliasOf?: string;
	supersededBy?: string[];
	/** Free tags (e.g. "core", "lab", "math-tool", "pronunciation"). */
	tags?: string[];
}

/** Non-gating relations stored alongside items. */
export type EdgeKind = "also_in" | "related" | "confusable_with" | "anchored_to" | "covered_by";

export interface CurriculumEdge {
	from: string;
	to: string;
	kind: EdgeKind;
	w?: number;
}

export interface CurriculumCertificate {
	/** Topological order of ALL items over the effective clause system. */
	order: string[];
	/** Stable hash of the canonical snapshot (sha-256 hex or FNV-1a 64 hex). */
	hash: string;
}

export interface CurriculumSnapshot {
	schemaVersion: 1;
	domainId: DomainId;
	/** Number of patches applied (ledger position). */
	version: number;
	items: Record<string, CurriculumItem>;
	edges: CurriculumEdge[];
	certificate: CurriculumCertificate;
	updatedAt: string;
}

// ─── Evolution (patches) ────────────────────────────────────────────────────

export interface NewItemSpec {
	id: string;
	parentId: string;
	kind: NodeKind;
	title: LocalizedText;
	hours: Hours;
	/** Stored clauses, or "entry" for none. */
	clauses: string[][] | "entry";
}

export type ExpansionOp =
	| ({ op: "addItem" } & NewItemSpec)
	| { op: "addAlternative"; item: string; clause: string[] }
	| { op: "addPrereq"; item: string; clauseIndex: number; prereq: string }
	/** Turn leaf `item` into a container (milestone) of new children `sub`. */
	| { op: "refine"; item: string; sub: Omit<NewItemSpec, "parentId">[] }
	| { op: "addSubdomain"; id: string; parentId: string; title: LocalizedText; items: NewItemSpec[] }
	| { op: "retire"; item: string; reroute: { item: string; clause: string[] }[] }
	| { op: "setHours"; item: string; hours: Hours }
	| { op: "updateItem"; item: string; fields: Partial<Omit<CurriculumItem, "id" | "domainId" | "parentId" | "clauses" | "kind">> }
	| { op: "addEdge"; edge: CurriculumEdge };

export type ValidationErrorCode =
	| "schema"
	| "cycle"
	| "unknown-id"
	| "duplicate-id"
	| "no-route"
	| "budget"
	| "hours-conservation"
	| "hierarchy"
	| "strict-alternatives"
	| "immutable-id"
	| "retire-reroute";

export interface ValidationError {
	code: ValidationErrorCode;
	message: string;
	/** Offending ids (e.g. the cycle, the dangling reference). */
	witness?: string[];
}

export type TriggerKind = "frontier" | "weakness" | "request" | "coverage-gap" | "granularity" | "seed";

export interface TriggerRef {
	kind: TriggerKind;
	nodeId?: string;
	reason: string;
	priority: number;
}

export interface PatchEnvelope {
	patchId: string;
	domainId: DomainId;
	/** Snapshot version this patch was computed against. */
	baseVersion: number;
	trigger: TriggerRef;
	ops: ExpansionOp[];
	/** Rich fields for items created by addItem/refine/addSubdomain, keyed by id. */
	itemPayloads: Record<string, Partial<CurriculumItem>>;
	risk: "low" | "structural";
	provenance: { model: string; promptVersion: string; samples: number };
	createdAt: string;
}

export interface PatchReceipt {
	patchId: string;
	appliedAt: string;
	fromVersion: number;
	toVersion: number;
	certificateHash: string;
	addedIds: string[];
	changedIds: string[];
	autoApplied: boolean;
	/** Inverse ops (or "snapshot") enabling a visible undo. */
	undoable: boolean;
}

export type ApplyPatchResult =
	| { ok: true; next: CurriculumSnapshot; receipt: PatchReceipt }
	| { ok: false; errors: ValidationError[] };

export class CurriculumError extends Error {
	readonly errors: ValidationError[];
	constructor(errors: ValidationError[]) {
		super(errors.map((e) => `[${e.code}] ${e.message}`).join("; "));
		this.name = "CurriculumError";
		this.errors = errors;
	}
}

/** Node id grammar: domain prefix (the domain root id itself) + 0..8 slug segments. */
export const CURRICULUM_ID_PATTERN = /^[a-z]{2,4}(\.[a-z0-9][a-z0-9-]{0,63}){0,8}$/;

/**
 * Compact authoring form of a CurriculumItem used in seed files. The loader
 * (./seed.ts normalizeSeedItem) fills defaults: aliases [], scope "" → summary,
 * objectives [], assess [], clauses [], softPrereqs [], encompasses [],
 * anchors [], status "stub" for non-atoms without children / "stable" for
 * atoms, version 1, provenance {createdBy:"seed"}, order = index in file.
 */
export interface SeedItem {
	id: string;
	kind: NodeKind;
	parentId: string | null;
	order?: number;
	title: LocalizedText;
	summary: string;
	scope?: string;
	objectives?: string[];
	atomType?: AtomType;
	bloom?: BloomLevel;
	assess?: string[];
	misconceptions?: string[];
	level: NodeLevel;
	clauses?: string[][];
	softPrereqs?: string[];
	encompasses?: { id: string; w: number }[];
	hours: Hours;
	anchors?: AnchorRef[];
	status?: NodeStatus;
	tags?: string[];
	aliases?: string[];
	lexicalItems?: LexicalItem[];
	practice?: { targetHours: number; exitCriterion: string };
}

/** Seed file format (content/curricula/<domain>/*.json) — validated then applied as one patch. */
export interface CurriculumSeedFile {
	schemaVersion: 1;
	domainId: DomainId;
	/** Which area this file covers ("<prefix>" for the root+areas file). One file per area keeps diffs readable. */
	areaId: string;
	items: SeedItem[];
	edges?: CurriculumEdge[];
	/** Anchor sources consulted, with license notes. */
	sources: { id: string; title: string; url?: string; license: string; usage: "reference" | "embedded" }[];
}
