/**
 * applyPatch — the ONLY way the curriculum graph changes (docs/research/
 * 00-SINTESE.md §2.4(e) passo 6, §2.13 "Pipeline applyPatch: zod → clone →
 * invariantes → certificado"; r10 §4 operator table + §4.1 refinamento-marco,
 * §6.3 pipeline transacional; Clew proposal validator/receipts,
 * docs/research/extra-miuuyy__Clew.md §5–6).
 *
 *   1. immutable keys (raw input) → zod (PatchEnvelopeSchema): readable
 *      `schema` / `immutable-id` errors for the agent;
 *   2. domain + base version (optimistic concurrency, Clew R1/§6 step 4);
 *   3. copy-on-write clone: the input snapshot is NEVER mutated (items are
 *      structuredClone'd the first time an op touches them);
 *   4. ops in order (op-local errors name `ops[i]` and the culprit ids; any
 *      op error aborts the patch before the global stage);
 *   5. ceilings (`budget`), then the full invariant suite (./invariants.ts,
 *      zod only on touched items);
 *   6. certificate {order, hash} re-checked by the independent checker;
 *   7. receipt. version + 1. Ids are never reused (retired ids stay as
 *      tombstones), never renamed and never re-parented.
 *
 * Op semantics:
 *   addItem        new item under a CONTAINER (or under the domain root, or
 *                  under an item created earlier in the same patch). Adding a
 *                  child to an existing leaf is refinement → use `refine`.
 *                  Note: a container is a milestone, so a new child tightens
 *                  it (its dependents now also wait for the new child).
 *   addAlternative relaxes: appends a NON-EMPTY OR route (an empty one is TRUE
 *                  and would erase every prerequisite). On an entry item (`[]`,
 *                  i.e. TRUE) it would be a no-op, so it is rejected (use
 *                  addPrereq).
 *   addPrereq      tightens alternative `clauseIndex` (an entry item's `[]` is
 *                  read as one empty alternative, so index 0 creates [[p]]).
 *   refine         milestone refinement (r10 §4.1): the leaf keeps its id,
 *                  becomes a container of `sub`; its stored clauses become
 *                  entry requirements inherited by the source children; hours
 *                  are conserved: |Σ mid(sub) − mid(x)| ≤ ε·mid(x), ε = 0.25
 *                  (`hours-conservation`). Atoms cannot be refined (kind is
 *                  immutable and atoms are leaves). A refined stub becomes
 *                  "provisional".
 *   addSubdomain   new container (kind = payload.kind ?? one level below the
 *                  parent; hours = payload.hours ?? Σ items; entry clauses =
 *                  payload.clauses ?? []) plus its items, which must all live
 *                  inside it (any order; parents are resolved first).
 *   retire         tombstones the item AND its live subtree (status
 *                  "deprecated"). Every live dependent whose stored clauses
 *                  mention a retired id MUST be rerouted (`retire-reroute`);
 *                  for a dependent with reroute clauses R₁…R_k every
 *                  alternative C touching the retired set becomes
 *                  (C ∖ retired) ∪ Rᵢ for each i (Rᵢ = [] explicitly drops
 *                  the retired members; an alternative left empty makes
 *                  the dependent an entry item). Soft prerequisites and
 *                  encompasses pointing into the retired set are dropped. A
 *                  container may not lose its last live child.
 *   setHours       re-estimate (no version bump).
 *   updateItem     non-structural fields; `id/domainId/parentId/kind/clauses`
 *                  → `immutable-id`; `status: "deprecated"` → use retire;
 *                  `version` is derived: base + 1 once per patch when a
 *                  DEFINITION field (title, scope, summary, objectives, bloom,
 *                  assess, level, atomType, lexicalItems, practice) ends up
 *                  different (key-order-insensitive comparison). Empty
 *                  `fields` → `schema`; fields equal to the current values are
 *                  a no-op, and an item whose edits leave it identical to the
 *                  input is not reported as changed.
 *   addEdge        non-gating relation between LIVE items (the `to` of
 *                  anchored_to/covered_by is external); an identical
 *                  (from,to,kind) — or the mirrored pair for symmetric kinds —
 *                  is replaced.
 * New items take rich fields from `itemPayloads[id]`; payload fields that
 * contradict the op (id, domainId, parentId, kind, title, hours, clauses) are
 * `schema` errors, and payloads for ids no op creates are rejected (except the
 * domain root inside the seed envelope applied to version 0, which must equal
 * the snapshot root because the replay rebuilds version 0 from it, see
 * ./seed.ts and ./ledger.ts).
 *
 * Pure and browser-safe.
 */

import { canonicalJson, checkRankCertificate, computeCertificate, effectiveClauseMap } from "./certificate.ts";
import { normalizeClauses, sameClauses, NEXT_KIND } from "./effective.ts";
import { hoursMid } from "./hours.ts";
import { validateReport, type CurriculumLimits } from "./invariants.ts";
import { IMMUTABLE_ITEM_KEYS, PatchEnvelopeSchema, zodIssuesToErrors } from "./schema.ts";
import type {
	ApplyPatchResult,
	CurriculumEdge,
	CurriculumItem,
	CurriculumSnapshot,
	ExpansionOp,
	Hours,
	NewItemSpec,
	NodeKind,
	NodeStatus,
	PatchEnvelope,
	PatchReceipt,
	ValidationError,
	ValidationErrorCode,
} from "./types.ts";

export interface ApplyPatchOptions {
	/** Domain edge mode (DomainManifest.edgeMode); default "strict". */
	edgeMode?: "strict" | "relaxed";
	strictMaxAlternatives?: number;
	limits?: CurriculumLimits;
	/** Hours-conservation tolerance of `refine` (default 0.25). */
	refineEpsilon?: number;
	/** Apply time for the receipt and `updatedAt` (default: envelope.createdAt, which keeps replays deterministic). */
	now?: string;
	/** Recorded on the receipt: applied without user review (default false). */
	autoApplied?: boolean;
}

export const REFINE_EPSILON = 0.25;

/** Fields whose change alters the node DEFINITION (version bump resets learner evidence). */
export const DEFINITION_FIELDS = ["title", "scope", "summary", "objectives", "bloom", "assess", "level", "atomType", "lexicalItems", "practice"] as const;

const SYMMETRIC_EDGE_KINDS = new Set(["related", "confusable_with"]);
/** Edge kinds whose `to` is an item of the domain (anchored_to / covered_by point outside). */
const ITEM_EDGE_KINDS = new Set(["also_in", "related", "confusable_with"]);

// ─── Draft (copy-on-write) ──────────────────────────────────────────────────

class Draft {
	readonly items: Record<string, CurriculumItem>;
	/** The untouched input items (never mutated). */
	readonly base: Readonly<Record<string, CurriculumItem>>;
	edges: CurriculumEdge[];
	readonly added: string[] = [];
	private readonly addedSet = new Set<string>();
	readonly changed = new Set<string>();
	private readonly owned = new Set<string>();
	private readonly kids = new Map<string, string[]>();

	constructor(base: CurriculumSnapshot) {
		this.base = base.items;
		this.items = { ...base.items };
		this.edges = [...base.edges];
		for (const item of Object.values(base.items)) if (item.parentId !== null) this.link(item.parentId, item.id);
	}

	private link(parentId: string, id: string): void {
		const list = this.kids.get(parentId);
		if (list) list.push(id);
		else this.kids.set(parentId, [id]);
	}

	get(id: string): CurriculumItem | undefined {
		return this.items[id];
	}

	isLive(id: string): boolean {
		const it = this.items[id];
		return it !== undefined && it.status !== "deprecated";
	}

	wasAdded(id: string): boolean {
		return this.addedSet.has(id);
	}

	/** Mutable copy of an existing item (cloned once per patch). */
	edit(id: string): CurriculumItem {
		if (!this.owned.has(id)) {
			this.items[id] = structuredClone(this.items[id]!);
			this.owned.add(id);
		}
		if (!this.addedSet.has(id)) this.changed.add(id);
		return this.items[id]!;
	}

	create(item: CurriculumItem): void {
		this.items[item.id] = item;
		this.owned.add(item.id);
		this.added.push(item.id);
		this.addedSet.add(item.id);
		if (item.parentId !== null) this.link(item.parentId, item.id);
	}

	allChildren(id: string): string[] {
		return this.kids.get(id) ?? [];
	}

	liveChildren(id: string): string[] {
		return this.allChildren(id).filter((c) => this.isLive(c));
	}

	/** The item and its live descendants. */
	liveSubtree(id: string): string[] {
		const out = [id];
		for (let h = 0; h < out.length; h++) out.push(...this.liveChildren(out[h]!));
		return out;
	}

	nextOrder(parentId: string): number {
		let max = -1;
		for (const c of this.allChildren(parentId)) max = Math.max(max, this.items[c]!.order);
		return max + 1;
	}

	/**
	 * Close the edits of pre-existing items: `version` is the base version + 1
	 * exactly when a DEFINITION field ends up different from the base (once per
	 * patch, whatever the number of ops), and an item that ends up identical
	 * to its base (a no-op edit, or A → B → A) gets its base object back and
	 * leaves `changed` — so receipts list only real changes and untouched
	 * objects stay shared.
	 */
	settleChanged(): void {
		for (const id of [...this.changed]) {
			const before = this.base[id]!;
			const cur = this.items[id]!;
			const redefined = DEFINITION_FIELDS.some((k) => canonicalJson(cur[k]) !== canonicalJson(before[k]));
			cur.version = before.version + (redefined ? 1 : 0);
			if (canonicalJson(cur) === canonicalJson(before)) {
				this.items[id] = before;
				this.owned.delete(id);
				this.changed.delete(id);
			}
		}
	}
}

// ─── Helpers ────────────────────────────────────────────────────────────────

type Report = (code: ValidationErrorCode, message: string, witness?: string[]) => void;

function sameHours(a: Hours, b: Hours): boolean {
	return a.lo === b.lo && a.hi === b.hi;
}

/** Structural equality independent of object key order (plain JSON.stringify would see {pt,en} ≠ {en,pt}). */
function sameJson(a: unknown, b: unknown): boolean {
	return canonicalJson(a) === canonicalJson(b);
}

function describeOp(op: ExpansionOp): string {
	switch (op.op) {
		case "addItem":
		case "addSubdomain":
			return `${op.op} ${op.id}`;
		case "addEdge":
			return `addEdge ${op.edge.from} → ${op.edge.to}`;
		default:
			return `${op.op} ${op.item}`;
	}
}

/** Errors for structural keys an `updateItem` must never carry (checked on the RAW input, before zod strips them). */
function rawUpdateItemErrors(raw: unknown): ValidationError[] {
	if (typeof raw !== "object" || raw === null) return [];
	const ops = (raw as { ops?: unknown }).ops;
	if (!Array.isArray(ops)) return [];
	const errors: ValidationError[] = [];
	ops.forEach((op: unknown, i) => {
		if (typeof op !== "object" || op === null || (op as { op?: unknown }).op !== "updateItem") return;
		const fields = (op as { fields?: unknown }).fields;
		const item = String((op as { item?: unknown }).item ?? "?");
		if (typeof fields !== "object" || fields === null) return;
		for (const key of [...IMMUTABLE_ITEM_KEYS, "clauses"])
			if (key in fields)
				errors.push({
					code: "immutable-id",
					message:
						key === "clauses"
							? `ops[${i}] updateItem ${item}: cláusulas mudam só por addPrereq/addAlternative/retire`
							: `ops[${i}] updateItem ${item}: "${key}" é imutável (ids nunca são renomeados nem re-parentados)`,
					witness: [item],
				});
		if ("version" in fields)
			errors.push({ code: "schema", message: `ops[${i}] updateItem ${item}: "version" é derivada pelo núcleo (não envie)`, witness: [item] });
	});
	return errors;
}

interface NewItemInput {
	id: string;
	parentId: string;
	kind: NodeKind;
	title: CurriculumItem["title"];
	hours: Hours;
	clauses: string[][];
}

/** Assemble a new item from the op spec + its payload; contradictions are reported and yield null. */
function buildNewItem(d: Draft, env: PatchEnvelope, spec: NewItemInput, outerReport: Report, defaulted: Set<string>): CurriculumItem | null {
	const payload = env.itemPayloads[spec.id] ?? {};
	let problems = 0;
	const report: Report = (code, message, witness) => {
		problems++;
		outerReport(code, message, witness);
	};
	const expect = { id: spec.id, domainId: env.domainId, parentId: spec.parentId, kind: spec.kind } as const;
	for (const key of ["id", "domainId", "parentId", "kind"] as const)
		if (payload[key] !== undefined && payload[key] !== expect[key])
			report("schema", `itemPayloads["${spec.id}"].${key} = ${JSON.stringify(payload[key])} contradiz a operação (${JSON.stringify(expect[key])})`, [spec.id]);
	if (payload.title !== undefined && !sameJson(payload.title, spec.title))
		report("schema", `itemPayloads["${spec.id}"].title contradiz o título da operação`, [spec.id]);
	if (payload.hours !== undefined && !sameHours(payload.hours, spec.hours))
		report("schema", `itemPayloads["${spec.id}"].hours contradiz as horas da operação`, [spec.id]);
	if (payload.clauses !== undefined && !sameClauses(payload.clauses, spec.clauses))
		report("schema", `itemPayloads["${spec.id}"].clauses contradiz as cláusulas da operação`, [spec.id]);
	if (payload.status === "deprecated") report("schema", `itemPayloads["${spec.id}"]: item novo não pode nascer aposentado`, [spec.id]);
	if (payload.version !== undefined && payload.version !== 1)
		report("schema", `itemPayloads["${spec.id}"].version deve ser 1 (item novo)`, [spec.id]);
	if (problems > 0) return null;

	const parent = d.get(spec.parentId)!;
	const status: NodeStatus = payload.status ?? (spec.kind === "atom" ? "provisional" : "stub");
	if (payload.status === undefined) defaulted.add(spec.id);
	const triggerTag = `${env.trigger.kind}:${env.patchId}`;
	const item: CurriculumItem = {
		...structuredClone(payload),
		id: spec.id,
		domainId: env.domainId,
		kind: spec.kind,
		parentId: spec.parentId,
		order: payload.order ?? d.nextOrder(spec.parentId),
		title: { ...spec.title },
		aliases: [...(payload.aliases ?? [])],
		scope: payload.scope ?? payload.summary ?? "",
		summary: payload.summary ?? "",
		objectives: [...(payload.objectives ?? [])],
		assess: [...(payload.assess ?? [])],
		level: structuredClone(payload.level ?? parent.level),
		clauses: normalizeClauses(spec.clauses),
		softPrereqs: [...new Set(payload.softPrereqs ?? [])],
		encompasses: (payload.encompasses ?? []).map((e) => ({ ...e })),
		hours: { ...spec.hours },
		anchors: (payload.anchors ?? []).map((a) => ({ ...a })),
		status,
		version: 1,
		provenance: payload.provenance
			? structuredClone(payload.provenance)
			: {
					createdBy: env.trigger.kind === "seed" ? "seed" : "expansion",
					trigger: triggerTag,
					model: env.provenance.model,
					promptVersion: env.provenance.promptVersion,
					createdAt: env.createdAt,
				},
	};
	return item;
}

function specClauses(c: NewItemSpec["clauses"]): string[][] {
	return c === "entry" ? [] : c.map((alt) => [...alt]);
}

// ─── Op handlers ────────────────────────────────────────────────────────────

interface Ctx {
	d: Draft;
	env: PatchEnvelope;
	report: Report;
	epsilon: number;
	defaulted: Set<string>;
	createdIds: Set<string>;
}

function requireLive(ctx: Ctx, id: string, role: string): CurriculumItem | null {
	const it = ctx.d.get(id);
	if (it === undefined) {
		ctx.report("unknown-id", `${role} "${id}" não existe`, [id]);
		return null;
	}
	if (it.status === "deprecated") {
		ctx.report("hierarchy", `${role} "${id}" está aposentado`, [id]);
		return null;
	}
	return it;
}

function requireFreshId(ctx: Ctx, id: string): boolean {
	if (ctx.d.get(id) !== undefined) {
		const retired = ctx.d.get(id)!.status === "deprecated";
		ctx.report("duplicate-id", `id "${id}" já existe${retired ? " (aposentado; ids nunca são reutilizados)" : ""}`, [id]);
		return false;
	}
	return true;
}

/** Parent accepts a NEW child directly (not a leaf being silently refined). */
function acceptsNewChild(ctx: Ctx, parent: CurriculumItem): boolean {
	if (parent.kind === "domain" || ctx.createdIds.has(parent.id) || ctx.d.liveChildren(parent.id).length > 0) return true;
	ctx.report("hierarchy", `${parent.id} é uma folha; para detalhá-la use refine (conserva horas e mantém o id como marco)`, [parent.id]);
	return false;
}

function createItem(ctx: Ctx, spec: NewItemInput): boolean {
	if (!requireFreshId(ctx, spec.id)) return false;
	const item = buildNewItem(ctx.d, ctx.env, spec, ctx.report, ctx.defaulted);
	if (!item) return false;
	ctx.d.create(item);
	ctx.createdIds.add(item.id);
	return true;
}

function opAddItem(ctx: Ctx, op: Extract<ExpansionOp, { op: "addItem" }>): void {
	const parent = requireLive(ctx, op.parentId, "pai");
	if (!parent || !acceptsNewChild(ctx, parent)) return;
	createItem(ctx, { id: op.id, parentId: op.parentId, kind: op.kind, title: op.title, hours: op.hours, clauses: specClauses(op.clauses) });
}

function opAddAlternative(ctx: Ctx, op: Extract<ExpansionOp, { op: "addAlternative" }>): void {
	const item = requireLive(ctx, op.item, "item");
	if (!item) return;
	if (item.clauses.length === 0) {
		ctx.report("schema", `${op.item} é item de entrada (não exige nada): uma alternativa não teria efeito; para exigir algo use addPrereq`, [op.item]);
		return;
	}
	const it = ctx.d.edit(op.item);
	it.clauses = normalizeClauses([...it.clauses, [...op.clause]]);
}

function opAddPrereq(ctx: Ctx, op: Extract<ExpansionOp, { op: "addPrereq" }>): void {
	const item = requireLive(ctx, op.item, "item");
	if (!item) return;
	const alts = item.clauses.length > 0 ? item.clauses.map((a) => [...a]) : [[]];
	if (op.clauseIndex >= alts.length) {
		ctx.report("schema", `${op.item}: clauseIndex ${op.clauseIndex} fora do intervalo (o item tem ${alts.length} alternativa(s))`, [op.item]);
		return;
	}
	alts[op.clauseIndex]!.push(op.prereq);
	ctx.d.edit(op.item).clauses = normalizeClauses(alts);
}

function opRefine(ctx: Ctx, op: Extract<ExpansionOp, { op: "refine" }>): void {
	const x = requireLive(ctx, op.item, "item");
	if (!x) return;
	if (x.kind === "atom") {
		ctx.report("hierarchy", `${x.id} é átomo: átomos não podem ser refinados (kind é imutável); ajuste horas ou aposente e recrie`, [x.id]);
		return;
	}
	const live = ctx.d.liveChildren(x.id);
	if (live.length > 0) {
		ctx.report("hierarchy", `${x.id} já é contêiner (${live.length} filho(s)); refine só detalha folhas — use addItem`, [x.id]);
		return;
	}
	const ids = op.sub.map((s) => s.id);
	const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
	if (dup.length > 0) {
		ctx.report("duplicate-id", `ids repetidos em sub: ${[...new Set(dup)].join(", ")}`, [...new Set(dup)]);
		return;
	}
	const sum = op.sub.reduce((acc, s) => acc + hoursMid(s.hours), 0);
	const mid = hoursMid(x.hours);
	if (Math.abs(sum - mid) > ctx.epsilon * mid + 1e-9) {
		ctx.report(
			"hours-conservation",
			`os filhos somam ${sum.toFixed(2)} h (média), o item tinha ${mid.toFixed(2)} h; a diferença passa de ${Math.round(ctx.epsilon * 100)}% — reestime (setHours) ou ajuste os filhos`,
			[x.id, ...ids],
		);
		return;
	}
	for (const s of op.sub) createItem(ctx, { id: s.id, parentId: x.id, kind: s.kind, title: s.title, hours: s.hours, clauses: specClauses(s.clauses) });
	if (x.status === "stub") ctx.d.edit(x.id).status = "provisional";
}

function opAddSubdomain(ctx: Ctx, op: Extract<ExpansionOp, { op: "addSubdomain" }>): void {
	const parent = requireLive(ctx, op.parentId, "pai");
	if (!parent || !acceptsNewChild(ctx, parent)) return;
	const payload = ctx.env.itemPayloads[op.id] ?? {};
	const kind = payload.kind ?? NEXT_KIND[parent.kind];
	if (kind === "atom") {
		ctx.report("hierarchy", `subdomínio ${op.id} precisa ser contêiner, mas ficaria como átomo sob ${parent.id} (${parent.kind})`, [op.id, parent.id]);
		return;
	}
	const hours = payload.hours ?? {
		lo: op.items.reduce((a, it) => a + it.hours.lo, 0),
		hi: op.items.reduce((a, it) => a + it.hours.hi, 0),
	};
	if (!createItem(ctx, { id: op.id, parentId: op.parentId, kind, title: op.title, hours, clauses: payload.clauses?.map((a) => [...a]) ?? [] })) return;
	const memberIds = new Set([op.id, ...op.items.map((it) => it.id)]);
	const outside = op.items.filter((it) => !memberIds.has(it.parentId));
	if (outside.length > 0) {
		ctx.report("hierarchy", `itens fora do subdomínio (pai fora dele): ${outside.map((it) => it.id).join(", ")}`, outside.map((it) => it.id));
		return;
	}
	let pending = [...op.items];
	while (pending.length > 0) {
		const ready = pending.filter((it) => ctx.createdIds.has(it.parentId));
		if (ready.length === 0) {
			ctx.report("hierarchy", `parentId em ciclo ou pai não criado: ${pending.map((it) => it.id).join(", ")}`, pending.map((it) => it.id));
			return;
		}
		for (const it of ready)
			if (!createItem(ctx, { id: it.id, parentId: it.parentId, kind: it.kind, title: it.title, hours: it.hours, clauses: specClauses(it.clauses) })) return;
		const done = new Set(ready);
		pending = pending.filter((it) => !done.has(it));
	}
}

function opRetire(ctx: Ctx, op: Extract<ExpansionOp, { op: "retire" }>): void {
	const x = ctx.d.get(op.item);
	if (x === undefined) {
		ctx.report("unknown-id", `item "${op.item}" não existe`, [op.item]);
		return;
	}
	if (x.status === "deprecated") {
		ctx.report("retire-reroute", `${op.item} já está aposentado`, [op.item]);
		return;
	}
	if (x.parentId === null) {
		ctx.report("hierarchy", `a raiz ${op.item} não pode ser aposentada`, [op.item]);
		return;
	}
	if (ctx.d.isLive(x.parentId) && ctx.d.liveChildren(x.parentId).length === 1) {
		ctx.report("hierarchy", `aposentar ${op.item} deixaria o contêiner ${x.parentId} sem filhos vivos; aposente o contêiner`, [op.item, x.parentId]);
		return;
	}
	const retired = new Set(ctx.d.liveSubtree(op.item));
	const dependents = new Set<string>();
	for (const [id, it] of Object.entries(ctx.d.items)) {
		if (it.status === "deprecated" || retired.has(id)) continue;
		if (it.clauses.some((alt) => alt.some((r) => retired.has(r)))) dependents.add(id);
	}
	const reroute = new Map<string, string[][]>();
	let bad = false;
	for (const r of op.reroute) {
		if (!dependents.has(r.item)) {
			ctx.report("retire-reroute", `reroute para ${r.item}, que não depende de ${op.item} (nem da sua subárvore)`, [r.item, op.item]);
			bad = true;
			continue;
		}
		const inside = r.clause.filter((c) => retired.has(c));
		if (inside.length > 0) {
			ctx.report("retire-reroute", `reroute de ${r.item} cita itens que estão sendo aposentados: ${inside.join(", ")}`, [r.item, ...inside]);
			bad = true;
			continue;
		}
		const list = reroute.get(r.item) ?? [];
		list.push([...r.clause]);
		reroute.set(r.item, list);
	}
	const missing = [...dependents].filter((d) => !reroute.has(d)).sort();
	if (missing.length > 0) {
		ctx.report("retire-reroute", `aposentar ${op.item} exige reroute para os dependentes: ${missing.join(", ")}`, [op.item, ...missing]);
		bad = true;
	}
	if (bad) return;
	for (const id of retired) ctx.d.edit(id).status = "deprecated";
	for (const [id, routes] of reroute) {
		const it = ctx.d.edit(id);
		const next: string[][] = [];
		for (const alt of it.clauses) {
			if (!alt.some((r) => retired.has(r))) next.push([...alt]);
			else for (const route of routes) next.push([...alt.filter((r) => !retired.has(r)), ...route]);
		}
		it.clauses = normalizeClauses(next);
	}
	for (const [id, it] of Object.entries(ctx.d.items)) {
		if (it.status === "deprecated") continue;
		const softHit = it.softPrereqs.some((s) => retired.has(s));
		const encHit = it.encompasses.some((e) => retired.has(e.id));
		if (!softHit && !encHit) continue;
		const m = ctx.d.edit(id);
		m.softPrereqs = m.softPrereqs.filter((s) => !retired.has(s));
		m.encompasses = m.encompasses.filter((e) => !retired.has(e.id));
	}
}

function opSetHours(ctx: Ctx, op: Extract<ExpansionOp, { op: "setHours" }>): void {
	if (!requireLive(ctx, op.item, "item")) return;
	ctx.d.edit(op.item).hours = { ...op.hours };
}

function opUpdateItem(ctx: Ctx, op: Extract<ExpansionOp, { op: "updateItem" }>): void {
	const item = requireLive(ctx, op.item, "item");
	if (!item) return;
	if (op.fields.status === "deprecated") {
		ctx.report("retire-reroute", `${op.item}: para aposentar use a operação retire (com reroute dos dependentes)`, [op.item]);
		return;
	}
	const fields = Object.entries(op.fields).filter(([, value]) => value !== undefined);
	if (fields.length === 0) {
		ctx.report("schema", `${op.item}: fields vazio — nada para atualizar`, [op.item]);
		return;
	}
	const current = item as unknown as Record<string, unknown>;
	const changes = fields.filter(([key, value]) => !sameJson(value, current[key]));
	if (changes.length === 0) return; // same values: a no-op, not a change (the version is settled by Draft.settleChanged)
	const it = ctx.d.edit(op.item) as unknown as Record<string, unknown>;
	for (const [key, value] of changes) it[key] = structuredClone(value);
}

function opAddEdge(ctx: Ctx, op: Extract<ExpansionOp, { op: "addEdge" }>): void {
	const e = op.edge;
	if (e.from === e.to) {
		ctx.report("schema", `aresta ${e.kind} de ${e.from} para si mesmo`, [e.from]);
		return;
	}
	// A NEW relation must link live items (edges stored earlier may keep pointing at items retired since).
	if (!requireLive(ctx, e.from, "origem da aresta")) return;
	if (ITEM_EDGE_KINDS.has(e.kind) && !requireLive(ctx, e.to, "destino da aresta")) return;
	const same = (x: CurriculumEdge) =>
		x.kind === e.kind && ((x.from === e.from && x.to === e.to) || (SYMMETRIC_EDGE_KINDS.has(e.kind) && x.from === e.to && x.to === e.from));
	ctx.d.edges = [...ctx.d.edges.filter((x) => !same(x)), { ...e }];
}

function applyOp(ctx: Ctx, op: ExpansionOp): void {
	switch (op.op) {
		case "addItem":
			return opAddItem(ctx, op);
		case "addAlternative":
			return opAddAlternative(ctx, op);
		case "addPrereq":
			return opAddPrereq(ctx, op);
		case "refine":
			return opRefine(ctx, op);
		case "addSubdomain":
			return opAddSubdomain(ctx, op);
		case "retire":
			return opRetire(ctx, op);
		case "setHours":
			return opSetHours(ctx, op);
		case "updateItem":
			return opUpdateItem(ctx, op);
		case "addEdge":
			return opAddEdge(ctx, op);
	}
}

// ─── Risk ───────────────────────────────────────────────────────────────────

/** Re-estimate of more than 25% of the mid hours (any change from 0). */
function bigHoursChange(snapshot: CurriculumSnapshot, id: string, hours: Hours): boolean {
	const it = snapshot.items[id];
	const before = it ? hoursMid(it.hours) : 0;
	const after = hoursMid(hours);
	return before === 0 ? after > 0 : Math.abs(after - before) / before > 0.25;
}

/**
 * Risk class of a patch against a snapshot (SÍNTESE §2.4(e) passo 7):
 * "low" = addItem/refine/addPrereq/setHours/updateItem/addEdge that touch no
 * `stable` node and re-estimate hours by ≤ 25%; anything else (addSubdomain,
 * retire, alternatives or prerequisites on a stable node, a child under a
 * stable container, a definition change of a stable node, setHours — or
 * updateItem of `hours` — by > 25%) is "structural" and goes to a preview
 * card. The envelope's own `risk` is the model's claim: the caller decides
 * auto-apply with THIS function, never with `envelope.risk`.
 */
export function classifyRisk(snapshot: CurriculumSnapshot, env: Pick<PatchEnvelope, "ops"> & Partial<Pick<PatchEnvelope, "itemPayloads">>): { risk: "low" | "structural"; reasons: string[] } {
	const reasons: string[] = [];
	const stable = (id: string) => snapshot.items[id]?.status === "stable";
	for (const op of env.ops) {
		switch (op.op) {
			case "addSubdomain":
			case "retire":
				reasons.push(`${describeOp(op)} é estrutural`);
				break;
			case "addItem":
				if (stable(op.parentId) && !env.itemPayloads?.[op.id]?.reinforcementFor) reasons.push(`addItem ${op.id} altera o marco estável ${op.parentId}`);
				break;
			case "addAlternative":
			case "addPrereq":
			case "refine":
				if (stable(op.item)) reasons.push(`${describeOp(op)} toca nó estável`);
				break;
			case "setHours":
				if (bigHoursChange(snapshot, op.item, op.hours)) reasons.push(`setHours ${op.item} muda a estimativa em mais de 25%`);
				break;
			case "updateItem":
				if (stable(op.item) && DEFINITION_FIELDS.some((k) => k in op.fields)) reasons.push(`updateItem ${op.item} muda a definição de um nó estável`);
				// `hours` through updateItem must not dodge the setHours rule.
				if (op.fields.hours !== undefined && bigHoursChange(snapshot, op.item, op.fields.hours))
					reasons.push(`updateItem ${op.item} muda a estimativa de horas em mais de 25%`);
				break;
			case "addEdge":
				break;
		}
	}
	return { risk: reasons.length > 0 ? "structural" : "low", reasons };
}

// ─── applyPatch ─────────────────────────────────────────────────────────────

/** Apply a patch envelope (unknown input) to a snapshot. Never mutates the input. */
export function applyPatch(snapshot: CurriculumSnapshot, envelope: unknown, opts: ApplyPatchOptions = {}): ApplyPatchResult {
	const immutable = rawUpdateItemErrors(envelope);
	if (immutable.length > 0) return { ok: false, errors: immutable };
	const parsed = PatchEnvelopeSchema.safeParse(envelope);
	if (!parsed.success) return { ok: false, errors: zodIssuesToErrors(parsed.error, "patch.") };
	const env = parsed.data as PatchEnvelope;

	if (env.domainId !== snapshot.domainId)
		return { ok: false, errors: [{ code: "schema", message: `patch do domínio "${env.domainId}" aplicado ao domínio "${snapshot.domainId}"` }] };
	if (env.baseVersion !== snapshot.version)
		return {
			ok: false,
			errors: [
				{
					code: "schema",
					message: `conflito de versão: o patch foi calculado contra a versão ${env.baseVersion}, mas o currículo está na versão ${snapshot.version}; releia o grafo e refaça a proposta`,
				},
			],
		};

	const created = new Set<string>();
	for (const op of env.ops) {
		if (op.op === "addItem" || op.op === "addSubdomain") created.add(op.id);
		if (op.op === "addSubdomain") for (const it of op.items) created.add(it.id);
		if (op.op === "refine") for (const s of op.sub) created.add(s.id);
	}
	const payloadErrors: ValidationError[] = [];
	for (const id of Object.keys(env.itemPayloads)) {
		if (created.has(id)) continue;
		const root = snapshot.items[id];
		const isSeedRoot = env.trigger.kind === "seed" && env.baseVersion === 0 && root !== undefined && root.parentId === null;
		if (!isSeedRoot)
			payloadErrors.push({ code: "schema", message: `itemPayloads["${id}"] não corresponde a nenhum item criado pelo patch (para editar um item existente use updateItem)`, witness: [id] });
		// The replay rebuilds version 0 from this payload (./ledger.ts): it must BE the root, or replay ≠ live state.
		else if (canonicalJson(env.itemPayloads[id]) !== canonicalJson(root))
			payloadErrors.push({ code: "schema", message: `itemPayloads["${id}"] (raiz do seed) difere da raiz do snapshot; o replay do ledger divergiria`, witness: [id] });
	}
	if (payloadErrors.length > 0) return { ok: false, errors: payloadErrors };

	const d = new Draft(snapshot);
	const errors: ValidationError[] = [];
	const ctx: Ctx = {
		d,
		env,
		report: () => undefined,
		epsilon: opts.refineEpsilon ?? REFINE_EPSILON,
		defaulted: new Set(),
		createdIds: new Set(),
	};
	env.ops.forEach((op, i) => {
		ctx.report = (code, message, witness) => {
			errors.push({ code, message: `ops[${i}] ${describeOp(op)}: ${message}`, ...(witness ? { witness } : {}) });
		};
		applyOp(ctx, op);
	});
	if (errors.length > 0) return { ok: false, errors };
	d.settleChanged();

	// New containers whose status was defaulted to "stub" are materialised now.
	for (const id of ctx.defaulted) {
		const it = d.items[id]!;
		if (it.kind !== "atom" && it.status === "stub" && d.liveChildren(id).length > 0) it.status = "provisional";
	}

	const limits = opts.limits ?? {};
	if (limits.maxAddedPerPatch !== undefined && d.added.length > limits.maxAddedPerPatch)
		return { ok: false, errors: [{ code: "budget", message: `o patch cria ${d.added.length} itens; o teto por patch é ${limits.maxAddedPerPatch}` }] };

	const draft = { schemaVersion: 1 as const, domainId: snapshot.domainId, version: snapshot.version + 1, items: d.items, edges: d.edges };
	const touched = new Set<string>([...d.added, ...d.changed]);
	const report = validateReport(
		{ ...draft, certificate: { order: [], hash: "" }, updatedAt: "" },
		{ edgeMode: opts.edgeMode, strictMaxAlternatives: opts.strictMaxAlternatives, limits, schema: touched, lint: false },
	);
	if (report.errors.length > 0) return { ok: false, errors: report.errors };

	const sys = report.sys!;
	const certificate = computeCertificate(draft, sys, report.order!);
	const check = checkRankCertificate(effectiveClauseMap(sys), certificate.order);
	if (!check.ok) throw new Error(`curriculum: certificado recusado pelo checador independente (${check.reason})`);

	const appliedAt = opts.now ?? env.createdAt;
	const next: CurriculumSnapshot = { ...draft, certificate, updatedAt: appliedAt };
	const receipt: PatchReceipt = {
		patchId: env.patchId,
		appliedAt,
		fromVersion: snapshot.version,
		toVersion: next.version,
		certificateHash: certificate.hash,
		addedIds: [...d.added],
		changedIds: [...d.changed].sort(),
		autoApplied: opts.autoApplied ?? false,
		undoable: true,
	};
	return { ok: true, next, receipt };
}
