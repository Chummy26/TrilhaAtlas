/**
 * Runtime invariants of a curriculum snapshot (docs/research/00-SINTESE.md
 * §2.13 "invariantes de runtime"; r10 §3.1 R1–R3, §3.6, §6.3 passo [3],
 * §11.1 modo estrito; r3 §4.4 I1–I10; open-mastery §5.4).
 *
 * `validate(snapshot, opts) → ValidationError[]` (empty = valid). Codes:
 *   schema            zod shape (all items, none, or only the touched ones;
 *                     the sound fast guards of ./schema.ts settle valid
 *                     items, zod only explains rejected ones),
 *                     record key ≠ id, foreign domainId, atomType on a
 *                     non-atom, empty alternative (use [] for entry items),
 *                     encompasses self-reference, self-loop edge.
 *   duplicate-id      the same id stored under two keys.
 *   unknown-id   (R3) parent, clause member, soft prerequisite, encompasses,
 *                     aliasOf/supersededBy target or edge endpoint missing;
 *                     clause members must also be LIVE (a retired id is a
 *                     dangling reference for the effective system).
 *   hierarchy         part_of is a forest with ONE live root of kind
 *                     "domain"; kinds grow strictly downwards (skips allowed:
 *                     domain>area>unit>topic>atom); atoms are leaves; a live
 *                     item never hangs from a retired parent; ids live under
 *                     the root prefix; stored clauses never mention an
 *                     ancestor or a descendant (the root therefore has none).
 *   strict-alternatives in edgeMode "strict" at most 2 alternatives per item,
 *                     both stored and EFFECTIVE (inherited entry requirements
 *                     multiply alternatives); any mode: effective DNF overflow.
 *   budget            atom hours outside the hard KC band [8, 60] min
 *                     (./granularity.ts); optional item / hour ceilings.
 *   cycle        (R2) Kahn over effective ∪ soft edges; the witness is a
 *                     closed walk and the message names each step (clause,
 *                     inherited entry, milestone containment, soft edge).
 *   no-route     (R1) items outside the largest reachable state (forward
 *                     chaining); only reported when there is no cycle (a cycle
 *                     already explains every dead item downstream of it).
 * Patch-only codes (hours-conservation, immutable-id, retire-reroute) are
 * produced by ./patch.ts, which needs the before/after pair.
 *
 * `validateReport` adds lint WARNINGS (never block): granularity (stub > 4 h,
 * atom outside 10–45 min but inside the hard band), transitive-edge
 * (./transitive.ts), fan-in > 5 (r3 I7), level monotonicity (r3 I6),
 * encompasses on a non-ancestor (open-mastery I7), references to retired
 * items in non-gating fields.
 *
 * Edge mode decision: "relaxed" only lifts the 2-alternative limit. Cycles
 * stay forbidden in both modes because the certificate and the learner view
 * (src/core/learner/graph-view.ts) require a topological order; r10 §11.1
 * "modo estrito" is therefore the only acyclicity regime implemented.
 *
 * Pure and browser-safe.
 */

import { buildEffectiveSystem, isProperAncestor, KIND_RANK, type EffectiveSystem } from "./effective.ts";
import { atomHoursVerdict, formatMinutes, leafGranularityFinding, ATOM_HARD_MAX_HOURS, ATOM_HARD_MIN_HOURS, ATOM_MAX_FAN_IN } from "./granularity.ts";
import { hoursMid } from "./hours.ts";
import { campaignErrors } from "./campaign.ts";
import { effectiveKahn, forwardChain } from "./rank.ts";
import {
	CurriculumEdgeSchema,
	CurriculumItemSchema,
	CurriculumSnapshotSchema,
	isCurriculumEdgeShape,
	isCurriculumItemShape,
	isCurriculumSnapshotShape,
	zodIssuesToErrors,
} from "./schema.ts";
import { redundantPrereqsOf } from "./transitive.ts";
import type { CurriculumItem, CurriculumSnapshot, ValidationError, ValidationErrorCode } from "./types.ts";

export interface CurriculumLimits {
	/** Max LIVE items in the domain. */
	maxItems?: number;
	/** Max total study hours (Σ mid over live leaves). */
	maxTotalHours?: number;
	/** Max items a single patch may add (checked by ./patch.ts). */
	maxAddedPerPatch?: number;
}

export interface ValidateOptions {
	/** Domain edge mode (DomainManifest.edgeMode); default "strict". */
	edgeMode?: "strict" | "relaxed";
	/** Alternatives allowed per item in strict mode (default 2). */
	strictMaxAlternatives?: number;
	/** Zod scope: every item ("all", default), none, or only these ids (patch pipeline). */
	schema?: "all" | "none" | ReadonlySet<string>;
	limits?: CurriculumLimits;
	/** validateReport only: compute lint warnings (default true). */
	lint?: boolean;
}

export type CurriculumWarningCode =
	| "granularity"
	| "transitive-edge"
	| "fan-in"
	| "level-monotonicity"
	| "encompasses-non-ancestor"
	| "stale-reference";

export interface CurriculumWarning {
	code: CurriculumWarningCode;
	message: string;
	witness?: string[];
}

export interface ValidationReport {
	errors: ValidationError[];
	warnings: CurriculumWarning[];
	/** Effective system (built even for invalid snapshots). */
	sys: EffectiveSystem | null;
	/** Dense Kahn order when the effective ∪ soft graph is acyclic. */
	order: number[] | null;
	stats: { items: number; live: number; leaves: number; ms: number };
}

export const STRICT_MAX_ALTERNATIVES = 2;
/** Messages kept per error code (the rest are summarised). */
const MAX_ERRORS_PER_CODE = 50;
const MAX_WITNESS = 50;

const CEFR_RANK: Readonly<Record<string, number>> = { "pre-A1": 0, A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };

function now(): number {
	return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function capErrors(errors: ValidationError[]): ValidationError[] {
	const counts = new Map<ValidationErrorCode, number>();
	const out: ValidationError[] = [];
	for (const e of errors) {
		const c = (counts.get(e.code) ?? 0) + 1;
		counts.set(e.code, c);
		if (c <= MAX_ERRORS_PER_CODE) out.push(e);
	}
	for (const [code, c] of counts)
		if (c > MAX_ERRORS_PER_CODE) out.push({ code, message: `… e mais ${c - MAX_ERRORS_PER_CODE} erros do tipo "${code}"` });
	return out;
}

// ─── Schema stage ───────────────────────────────────────────────────────────

/**
 * Zod stage. The sound fast guards of ./schema.ts decide the common (valid)
 * case; zod runs only on what a guard rejects, so messages stay zod's.
 */
function schemaErrors(snapshot: CurriculumSnapshot, scope: ValidateOptions["schema"]): ValidationError[] {
	if (scope === "none") return [];
	if (scope === undefined || scope === "all") {
		if (isCurriculumSnapshotShape(snapshot)) return [];
		const res = CurriculumSnapshotSchema.safeParse(snapshot);
		return res.success ? [] : zodIssuesToErrors(res.error, "snapshot.");
	}
	const errors: ValidationError[] = [];
	if (typeof snapshot !== "object" || snapshot === null || typeof snapshot.items !== "object" || snapshot.items === null || !Array.isArray(snapshot.edges))
		return [{ code: "schema", message: "snapshot: forma inválida (esperado {items, edges, …})" }];
	for (const id of [...scope].sort()) {
		const item = snapshot.items[id];
		if (item === undefined || isCurriculumItemShape(item)) continue;
		const res = CurriculumItemSchema.safeParse(item);
		if (!res.success) errors.push(...zodIssuesToErrors(res.error, `items["${id}"].`));
	}
	snapshot.edges.forEach((edge, i) => {
		if (isCurriculumEdgeShape(edge)) return;
		const res = CurriculumEdgeSchema.safeParse(edge);
		if (!res.success) errors.push(...zodIssuesToErrors(res.error, `edges[${i}].`));
	});
	return errors;
}

/** Distinct members of stored clauses, first occurrence order (no allocation beyond the result for the usual 1-alternative case). */
function distinctRefs(clauses: readonly (readonly string[])[]): readonly string[] {
	if (clauses.length === 0) return [];
	if (clauses.length === 1) {
		const only = clauses[0]!;
		if (only.length < 2) return only;
		if (only.length <= 8) {
			for (let i = 1; i < only.length; i++) if (only.lastIndexOf(only[i]!, i - 1) >= 0) return [...new Set(only)];
			return only;
		}
	}
	return [...new Set(clauses.flat())];
}

// ─── Cycle message ──────────────────────────────────────────────────────────

/** Human/agent-readable reason why u precedes v in the joint graph. */
function describeStep(sys: EffectiveSystem, u: number, v: number): string {
	const U = sys.ids[u]!;
	const V = sys.ids[v]!;
	if (sys.parent[u] === v) return `${U} é filho do marco ${V}`;
	const vItem = sys.items[v]!;
	if (vItem.clauses.some((alt) => alt.includes(U))) return `${V} exige ${U}`;
	if (sys.prereqs[v]!.includes(u)) return `${V} herda ${U} como requisito de entrada de um ancestral`;
	if (vItem.softPrereqs.includes(U)) return `${U} é pré-requisito suave de ${V}`;
	return `${U} precede ${V}`;
}

// ─── Main ───────────────────────────────────────────────────────────────────

/** Errors only (fast path; no lint). Empty array = valid. */
export function validate(snapshot: CurriculumSnapshot, opts: ValidateOptions = {}): ValidationError[] {
	return validateReport(snapshot, { ...opts, lint: false }).errors;
}

/** Errors + lint warnings + the effective system and its Kahn order (reused by applyPatch). */
export function validateReport(snapshot: CurriculumSnapshot, opts: ValidateOptions = {}): ValidationReport {
	const t0 = now();
	const finish = (errors: ValidationError[], warnings: CurriculumWarning[], sys: EffectiveSystem | null, order: number[] | null): ValidationReport => {
		const live = sys ? sys.ids.length : 0;
		let leaves = 0;
		if (sys) for (const kids of sys.children) if (kids.length === 0) leaves++;
		const items = snapshot && typeof snapshot.items === "object" && snapshot.items !== null ? Object.keys(snapshot.items).length : 0;
		return { errors: capErrors(errors), warnings, sys, order, stats: { items, live, leaves, ms: now() - t0 } };
	};

	const schema = schemaErrors(snapshot, opts.schema);
	if (schema.length > 0) return finish(schema, [], null, null);

	const errors: ValidationError[] = [];
	const warnings: CurriculumWarning[] = [];
	const items = snapshot.items;
	// The builder is total (it degrades gracefully on broken input), so it runs first and its sorted keys are reused.
	const sys = buildEffectiveSystem(items);
	const keys = sys.keys;

	// Identity + cheap schema-level rules.
	let misKeyed = false;
	for (const key of keys) {
		const item = items[key]!;
		if (item.id !== key) {
			misKeyed = true;
			errors.push({ code: "schema", message: `items["${key}"] guarda o id "${item.id}": a chave deve ser o próprio id`, witness: [key, item.id] });
		}
		if (item.domainId !== snapshot.domainId)
			errors.push({ code: "schema", message: `${item.id}: domainId "${item.domainId}" ≠ domínio do snapshot "${snapshot.domainId}"`, witness: [item.id] });
		if (item.atomType !== undefined && item.kind !== "atom")
			errors.push({ code: "schema", message: `${item.id}: atomType só vale para kind "atom" (é "${item.kind}")`, witness: [item.id] });
		const cs = item.clauses;
		for (let i = 0; i < cs.length; i++)
			if (cs[i]!.length === 0) errors.push({ code: "schema", message: `${item.id}: alternativa ${i} vazia; para item de entrada use clauses: []`, witness: [item.id] });
		for (const e of item.encompasses)
			if (e.id === item.id) errors.push({ code: "schema", message: `${item.id}: encompasses não pode citar o próprio item`, witness: [item.id] });
	}
	// Two keys can only share an id when some key differs from its item's id.
	if (misKeyed) {
		const firstKeyOfId = new Map<string, string>();
		for (const key of keys) {
			const id = items[key]!.id;
			const prev = firstKeyOfId.get(id);
			if (prev !== undefined) errors.push({ code: "duplicate-id", message: `id "${id}" repetido (chaves "${prev}" e "${key}")`, witness: [id] });
			else firstKeyOfId.set(id, key);
		}
	}
	snapshot.edges.forEach((edge, i) => {
		if (edge.from === edge.to) errors.push({ code: "schema", message: `edges[${i}]: aresta ${edge.kind} de ${edge.from} para si mesmo`, witness: [edge.from] });
	});

	const statusOf = (id: string): "missing" | "retired" | "live" => {
		const it = items[id];
		return it === undefined ? "missing" : it.status === "deprecated" ? "retired" : "live";
	};

	// Hierarchy: roots, parents, kinds, prefix.
	const liveRoots = sys.items.filter((it) => it.parentId === null).map((it) => it.id);
	if (liveRoots.length === 0) errors.push({ code: "hierarchy", message: "o domínio não tem raiz viva (item com parentId null)" });
	if (liveRoots.length > 1) errors.push({ code: "hierarchy", message: `o domínio tem ${liveRoots.length} raízes; deve ter uma só`, witness: liveRoots });
	const rootId = liveRoots.length === 1 ? liveRoots[0]! : null;
	for (const cycle of sys.diagnostics.parentCycles)
		errors.push({ code: "hierarchy", message: `part_of tem ciclo: ${[...cycle, cycle[0]].join(" → ")}`, witness: cycle });

	for (let x = 0; x < sys.ids.length; x++) {
		const item = sys.items[x]!;
		const id = item.id;
		if (item.parentId === null) {
			if (item.kind !== "domain") errors.push({ code: "hierarchy", message: `raiz ${id} deve ter kind "domain" (é "${item.kind}")`, witness: [id] });
			if (item.clauses.length > 0) errors.push({ code: "hierarchy", message: `raiz ${id} não pode ter cláusulas (todo item descende dela)`, witness: [id] });
		} else {
			const ps = statusOf(item.parentId);
			if (ps === "missing") errors.push({ code: "unknown-id", message: `${id}: pai "${item.parentId}" não existe`, witness: [id, item.parentId] });
			else if (ps === "retired")
				errors.push({ code: "hierarchy", message: `${id} está vivo mas o pai ${item.parentId} foi aposentado`, witness: [id, item.parentId] });
			else {
				const parent = items[item.parentId]!;
				if (item.kind === "domain") errors.push({ code: "hierarchy", message: `${id}: só a raiz pode ter kind "domain"`, witness: [id] });
				else if (KIND_RANK[item.kind] <= KIND_RANK[parent.kind])
					errors.push({
						code: "hierarchy",
						message: `${id} (${item.kind}) não pode ficar sob ${parent.id} (${parent.kind}): o kind deve descer (domain > area > unit > topic > atom)`,
						witness: [id, parent.id],
					});
			}
		}
		if (item.reinforcementFor) {
			const target = sys.index.get(item.reinforcementFor);
			if (item.kind !== "atom" || target === undefined || target === x || sys.children[target]!.length ||
				sys.items[target]!.reinforcementFor || sys.parent[target] !== sys.parent[x])
				errors.push({ code: "hierarchy", message: `Reforço ${id} precisa de uma habilidade irmã da trilha.`, witness: [id, item.reinforcementFor] });
		}
		if (item.kind === "atom" && sys.children[x]!.length > 0)
			errors.push({ code: "hierarchy", message: `átomo ${id} tem filhos; átomos são folhas`, witness: [id, ...sys.children[x]!.map((c) => sys.ids[c]!)] });
		if (rootId !== null && id !== rootId && !id.startsWith(`${rootId}.`))
			errors.push({ code: "hierarchy", message: `id ${id} fora do prefixo do domínio "${rootId}."`, witness: [id] });
	}

	// Stored clause references (R3 + hierarchy rule + self-loop) and alternative counts.
	const strict = (opts.edgeMode ?? "strict") === "strict";
	const maxAlts = opts.strictMaxAlternatives ?? STRICT_MAX_ALTERNATIVES;
	for (let x = 0; x < sys.ids.length; x++) {
		const item = sys.items[x]!;
		const id = item.id;
		for (const ref of distinctRefs(item.clauses)) {
			if (ref === id) {
				errors.push({ code: "cycle", message: `${id} exige a si mesmo`, witness: [id, id] });
				continue;
			}
			const r = sys.index.get(ref);
			if (r !== undefined) {
				if (isProperAncestor(sys.parent, r, x))
					errors.push({ code: "hierarchy", message: `${id} não pode exigir o ancestral ${ref} (pré-requisitos ligam só nós fora da linhagem)`, witness: [id, ref] });
				else if (isProperAncestor(sys.parent, x, r))
					errors.push({ code: "hierarchy", message: `${id} não pode exigir o descendente ${ref} (o contêiner já exige todos os filhos)`, witness: [id, ref] });
			} else if (statusOf(ref) === "retired")
				errors.push({ code: "unknown-id", message: `${id}: pré-requisito "${ref}" foi aposentado (use retire com reroute)`, witness: [id, ref] });
			else errors.push({ code: "unknown-id", message: `${id}: pré-requisito "${ref}" não existe`, witness: [id, ref] });
		}
		if (strict && item.clauses.length > maxAlts)
			errors.push({ code: "strict-alternatives", message: `${id} tem ${item.clauses.length} alternativas; o modo estrito permite ${maxAlts}`, witness: [id] });
		else if (strict && sys.clauses[x]!.length > maxAlts)
			errors.push({
				code: "strict-alternatives",
				message: `${id} fica com ${sys.clauses[x]!.length} alternativas efetivas (as próprias × as herdadas do contêiner); o modo estrito permite ${maxAlts}`,
				witness: [id],
			});
	}
	for (const id of sys.diagnostics.overflow)
		errors.push({ code: "strict-alternatives", message: `${id}: combinação de alternativas herdadas explodiu (> 64); simplifique as cláusulas`, witness: [id] });

	// Non-gating references.
	for (let x = 0; x < sys.ids.length; x++) {
		const item = sys.items[x]!;
		const id = item.id;
		for (const s of item.softPrereqs) {
			const st = statusOf(s);
			if (st === "missing") errors.push({ code: "unknown-id", message: `${id}: pré-requisito suave "${s}" não existe`, witness: [id, s] });
			else if (st === "retired") warnings.push({ code: "stale-reference", message: `${id}: pré-requisito suave ${s} está aposentado`, witness: [id, s] });
		}
		for (const e of item.encompasses) {
			const st = statusOf(e.id);
			if (st === "missing") errors.push({ code: "unknown-id", message: `${id}: encompasses cita "${e.id}", que não existe`, witness: [id, e.id] });
			else if (st === "retired") warnings.push({ code: "stale-reference", message: `${id}: encompasses cita ${e.id}, aposentado`, witness: [id, e.id] });
		}
	}
	for (const key of keys) {
		const item = items[key]!;
		if (item.aliasOf !== undefined) {
			const st = statusOf(item.aliasOf);
			if (st === "missing") errors.push({ code: "unknown-id", message: `${item.id}: aliasOf "${item.aliasOf}" não existe`, witness: [item.id, item.aliasOf] });
			else if (st === "retired") warnings.push({ code: "stale-reference", message: `${item.id}: aliasOf aponta para ${item.aliasOf}, aposentado`, witness: [item.id, item.aliasOf] });
		}
		for (const s of item.supersededBy ?? [])
			if (statusOf(s) === "missing") errors.push({ code: "unknown-id", message: `${item.id}: supersededBy cita "${s}", que não existe`, witness: [item.id, s] });
	}
	const ITEM_EDGE_KINDS = new Set(["also_in", "related", "confusable_with"]);
	snapshot.edges.forEach((edge, i) => {
		if (statusOf(edge.from) === "missing") errors.push({ code: "unknown-id", message: `edges[${i}]: origem "${edge.from}" não existe`, witness: [edge.from] });
		if (ITEM_EDGE_KINDS.has(edge.kind) && statusOf(edge.to) === "missing")
			errors.push({ code: "unknown-id", message: `edges[${i}]: destino "${edge.to}" não existe (${edge.kind} liga dois itens)`, witness: [edge.to] });
	});

	// Hours (budget family) and limits.
	let totalMid = 0;
	for (let x = 0; x < sys.ids.length; x++) {
		const item = sys.items[x]!;
		if (sys.children[x]!.length === 0) totalMid += hoursMid(item.hours);
		const verdict = atomHoursVerdict(item);
		if (verdict === "error-small" || verdict === "error-large")
			errors.push({
				code: "budget",
				message: `átomo ${item.id} estimado em ${formatMinutes(hoursMid(item.hours))}: fora da faixa ${formatMinutes(ATOM_HARD_MIN_HOURS)}–${formatMinutes(ATOM_HARD_MAX_HOURS)} (alvo 10–45 min); ${verdict === "error-large" ? "divida o átomo" : "funda com um irmão"}`,
				witness: [item.id],
			});
	}
	const limits = opts.limits ?? {};
	if (limits.maxItems !== undefined && sys.ids.length > limits.maxItems)
		errors.push({ code: "budget", message: `o domínio tem ${sys.ids.length} itens vivos; o teto é ${limits.maxItems}` });
	if (limits.maxTotalHours !== undefined && totalMid > limits.maxTotalHours + 1e-9)
		errors.push({ code: "budget", message: `o domínio soma ${totalMid.toFixed(1)} h de estudo; o teto é ${limits.maxTotalHours} h` });

	// R2: cycle (effective ∪ soft) with a typed witness.
	const kahn = effectiveKahn(sys);
	let order: number[] | null = null;
	if (!kahn.ok) {
		const cyc = kahn.cycle;
		const witness = cyc.map((c) => sys.ids[c]!);
		const steps: string[] = [];
		for (let i = 0; i + 1 < cyc.length; i++) steps.push(describeStep(sys, cyc[i]!, cyc[i + 1]!));
		errors.push({ code: "cycle", message: `ciclo de pré-requisitos ${witness.join(" → ")} (${steps.join("; ")})`, witness });
	} else {
		order = kahn.order;
		errors.push(...campaignErrors(sys, order));
		// R1: every live item reachable (forward chaining over the effective system).
		const { known } = forwardChain(sys.ids.length, sys.clauses);
		const dead: string[] = [];
		for (let x = 0; x < sys.ids.length; x++) if (known[x] !== 1) dead.push(sys.ids[x]!);
		if (dead.length > 0)
			errors.push({
				code: "no-route",
				message: `${dead.length} item(ns) sem rota a partir dos itens de entrada: ${dead.slice(0, 8).join(", ")}${dead.length > 8 ? ", …" : ""}`,
				witness: dead.slice(0, MAX_WITNESS),
			});
	}

	if (opts.lint !== false) lint(sys, order, warnings);
	return finish(errors, warnings, sys, order);
}

// ─── Lint ───────────────────────────────────────────────────────────────────

function levelRank(item: CurriculumItem): { scheme: string; rank: number } {
	const l = item.level;
	if (l.scheme === "cefr") return { scheme: "cefr", rank: CEFR_RANK[l.cefr] ?? 0 };
	return { scheme: l.scheme, rank: l.band };
}

/** Is `target` reachable backwards from `x` through effective prerequisites? null = search truncated. */
function isPrereqAncestor(sys: EffectiveSystem, x: number, target: number, maxVisits: number): boolean | null {
	const seen = new Set<number>([x]);
	const stack = [x];
	while (stack.length > 0) {
		const v = stack.pop()!;
		for (const p of sys.prereqs[v]!) {
			if (p === target) return true;
			if (seen.has(p)) continue;
			if (seen.size >= maxVisits) return null;
			seen.add(p);
			stack.push(p);
		}
	}
	return false;
}

function lint(sys: EffectiveSystem, order: number[] | null, warnings: CurriculumWarning[]): void {
	for (let x = 0; x < sys.ids.length; x++) {
		const item = sys.items[x]!;
		if (sys.children[x]!.length === 0) {
			const verdict = atomHoursVerdict(item);
			const f = verdict === "error-small" || verdict === "error-large" ? null : leafGranularityFinding(item);
			if (f) warnings.push({ code: "granularity", message: f.message, witness: [item.id] });
		}
		if (item.kind === "atom") {
			const fanIn = new Set(item.clauses.flat()).size;
			if (fanIn > ATOM_MAX_FAN_IN)
				warnings.push({ code: "fan-in", message: `átomo ${item.id} depende de ${fanIn} itens (máx. ${ATOM_MAX_FAN_IN})`, witness: [item.id] });
		}
		const own = levelRank(item);
		for (const ref of new Set(item.clauses.flat())) {
			const r = sys.index.get(ref);
			if (r === undefined) continue;
			const lv = levelRank(sys.items[r]!);
			if (lv.scheme === own.scheme && lv.rank > own.rank)
				warnings.push({ code: "level-monotonicity", message: `${item.id} exige ${ref}, de nível mais alto`, witness: [item.id, ref] });
		}
		if (order !== null)
			for (const e of item.encompasses) {
				const t = sys.index.get(e.id);
				if (t === undefined) continue;
				if (isPrereqAncestor(sys, x, t, 2048) === false)
					warnings.push({ code: "encompasses-non-ancestor", message: `${item.id} engloba ${e.id}, que não é pré-requisito (direto ou indireto)`, witness: [item.id, e.id] });
			}
	}
	if (order !== null)
		for (const r of redundantPrereqsOf(sys, { order }))
			warnings.push({
				code: "transitive-edge",
				message: `${r.item}: o pré-requisito ${r.prereq} (alternativa ${r.clauseIndex}) já é exigido por ${r.impliedBy}; aresta transitiva redundante`,
				witness: [r.item, r.prereq, r.impliedBy],
			});
}
