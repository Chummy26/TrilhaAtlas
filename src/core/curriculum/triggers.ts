/**
 * Deterministic expansion triggers (docs/research/00-SINTESE.md §2.4(e)
 * "gatilho determinístico (src/core/curriculum/triggers.ts)"; r10 §4.2
 * gatilhos 1–4; r3 §7.1 tabela de gatilhos + "raio de materialização").
 *
 * Pure functions of (snapshot, learner state, signals) — never of the LLM:
 *
 *   frontier     lookahead: every unrefined stub leaf within R = 2 forward
 *                hops (requires ∪ builds_towards, r3 §7.1) of the
 *                (goal-restricted) outer fringe is a refine target (keep the materialisation radius filled so a lesson never
 *                waits); when fewer than k = 3 READY atoms are on the fringe
 *                and no stub is in range, an "extend" trigger on the goal (or
 *                the root) asks for the next topics — unless everything it
 *                could extend towards (the goals; without goals, the whole
 *                domain) is already attained: growing a finished domain is a
 *                learner request or a coverage gap, never automatic.
 *   granularity  unrefined leaves above 4 h and atoms outside 10–45 min in the
 *                reachable region (≤ 2R hops or inside the goal plan); also a
 *                stub that keeps failing.
 *   weakness     a leaf failed ≥ 2 times (or diagnosed "missing concept")
 *                while one of its alternatives is attained ⇒ a missing
 *                prerequisite is likely (remediate, r3 §7.3).
 *   request      explicit learner request (graft).
 *   coverage-gap anchor items / book sections without a node.
 *
 * Every trigger has an idempotency key `${kind}:${nodeId ?? "*"}` (plus
 * `#anchor` for coverage gaps and `#text` for node-less requests); keys
 * already queued/recent are filtered, duplicates keep the highest priority.
 * Output order = the budget order (./budget.ts): priority DESC, depth ASC.
 *
 * Pure and browser-safe.
 */

import { leafGranularityFinding } from "./granularity.ts";
import { attainedClosure, goalPlan } from "./frontier.ts";
import { asIndex, type CurriculumIndex } from "./rank.ts";
import type { CurriculumSnapshot, TriggerKind, TriggerRef } from "./types.ts";

export const TRIGGER_PRIORITY: Readonly<Record<TriggerKind, number>> = {
	seed: 100,
	request: 90,
	weakness: 80,
	frontier: 60,
	granularity: 50,
	"coverage-gap": 20,
};

/** Depth assigned to triggers with no position relative to the learner. */
export const FAR_DEPTH = 99;

export interface LearnerSignal {
	nodeId: string;
	/** Recent failed attempts without progress. */
	failures: number;
	/** Diagnosis classified the error as "concept missing". */
	missingConcept?: boolean;
}

export interface LearnerRequest {
	text: string;
	nodeId?: string;
}

export interface CoverageGap {
	source: string;
	ref: string;
	/** Closest existing node (where the expansion should graft). */
	nearNodeId?: string;
}

export interface TriggerOptions {
	/** Minimum READY atoms on the (goal) fringe before an extend trigger (default 3). */
	lookaheadK?: number;
	/** Materialisation radius in forward hops (default 2). */
	stubRadius?: number;
	/** Failures that make a weakness trigger (default 2). */
	weaknessFailures?: number;
}

export interface TriggerInput {
	attained: Iterable<string>;
	goals?: readonly string[];
	signals?: readonly LearnerSignal[];
	requests?: readonly LearnerRequest[];
	coverageGaps?: readonly CoverageGap[];
	/** Keys of expansions already queued, running or recently done. */
	recentKeys?: Iterable<string>;
	options?: TriggerOptions;
}

export interface DetectedTrigger {
	trigger: TriggerRef;
	/** Hops from the learner frontier (FAR_DEPTH when unrelated). */
	depth: number;
	key: string;
}

export function triggerKey(t: Pick<TriggerRef, "kind" | "nodeId">): string {
	return `${t.kind}:${t.nodeId ?? "*"}`;
}

/** Lowercase, accent-free, single-spaced text (idempotency keys of free-text requests). */
function normalizeKeyText(text: string): string {
	return text
		.normalize("NFD")
		.replace(/\p{M}+/gu, "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 80);
}

function clip(text: string, max = 200): string {
	const t = text.replace(/\s+/g, " ").trim();
	return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/** Reverse of the soft-prerequisite lists: x → items listing x as builds_towards source. */
function reverseSoft(soft: readonly (readonly number[])[]): Map<number, number[]> {
	const out = new Map<number, number[]>();
	for (let x = 0; x < soft.length; x++)
		for (const s of soft[x]!) {
			const list = out.get(s);
			if (list) list.push(x);
			else out.set(s, [x]);
		}
	return out;
}

/** All deterministic triggers for the current state (see header). */
export function computeTriggers(source: CurriculumSnapshot | CurriculumIndex, input: TriggerInput): DetectedTrigger[] {
	const idx = asIndex(source);
	const { sys, order, dependents } = idx;
	const opts = { lookaheadK: 3, stubRadius: 2, weaknessFailures: 2, ...input.options };
	const attained = [...input.attained];
	const known = attainedClosure(idx, attained);
	const goals = input.goals?.filter((g) => sys.index.has(g)) ?? [];
	const plan = goals.length > 0 ? new Set(goalPlan(idx, attained, goals).items.map((id) => sys.index.get(id)!)) : null;
	const inScope = (x: number) => plan === null || plan.has(x);
	const isLeaf = (x: number) => sys.children[x]!.length === 0;
	const isStub = (x: number) => isLeaf(x) && sys.items[x]!.kind !== "atom";
	const out: DetectedTrigger[] = [];
	const emit = (kind: TriggerKind, nodeId: string | undefined, reason: string, depth: number, priority = TRIGGER_PRIORITY[kind], keyExtra?: string) => {
		const trigger: TriggerRef = { kind, ...(nodeId !== undefined ? { nodeId } : {}), reason, priority };
		out.push({ trigger, depth, key: keyExtra === undefined ? triggerKey(trigger) : `${triggerKey(trigger)}#${keyExtra}` });
	};

	// Outer fringe (dense) restricted to the goal plan.
	const fringe: number[] = [];
	for (const x of order) {
		if (known[x] === 1 || !isLeaf(x) || !inScope(x)) continue;
		if (sys.clauses[x]!.some((alt) => alt.every((y) => known[y] === 1))) fringe.push(x);
	}
	// Forward BFS distances from the fringe over requires ∪ builds_towards (r3 §7.1), radius 2R.
	const softDependents = reverseSoft(sys.soft);
	const dist = new Map<number, number>();
	const queue: number[] = [];
	for (const x of fringe) {
		dist.set(x, 0);
		queue.push(x);
	}
	const maxDepth = opts.stubRadius * 2;
	const reach = (w: number, d: number) => {
		if (dist.has(w) || known[w] === 1 || !inScope(w)) return;
		dist.set(w, d);
		queue.push(w);
	};
	for (let h = 0; h < queue.length; h++) {
		const v = queue[h]!;
		const d = dist.get(v)!;
		if (d >= maxDepth) continue;
		for (const w of dependents[v]!) reach(w, d + 1);
		for (const w of softDependents.get(v) ?? []) reach(w, d + 1);
	}

	// 1. Frontier lookahead.
	const ready = fringe.filter((x) => !isStub(x)).length;
	let stubsInRadius = 0;
	for (const [x, d] of dist) {
		if (d > opts.stubRadius || !isStub(x)) continue;
		stubsInRadius++;
		emit("frontier", sys.ids[x], `stub ${sys.ids[x]} a ${d} passo(s) da fronteira: materializar (refine)`, d, TRIGGER_PRIORITY.frontier - 5 * d);
	}
	if (ready < opts.lookaheadK && stubsInRadius === 0) {
		const anchor = goals[0] ?? (sys.roots.length === 1 ? sys.ids[sys.roots[0]!] : undefined);
		// Nothing left to reach (the goals, or with no goals the whole domain): growing the domain is a request/coverage decision.
		const done = goals.length > 0 ? goals.every((g) => known[sys.index.get(g)!] === 1) : sys.roots.every((r) => known[r] === 1);
		if (!done) emit("frontier", anchor, `fronteira com ${ready} átomo(s) pronto(s) (< ${opts.lookaheadK}): estender a região`, 0);
	}

	// 2. Granularity in the reachable region.
	for (const [x, d] of dist) {
		if (!isLeaf(x)) continue;
		const f = leafGranularityFinding(sys.items[x]!);
		if (f && (f.action === "refine" || f.action === "split"))
			emit("granularity", sys.ids[x], f.message, d, d <= opts.stubRadius ? TRIGGER_PRIORITY.granularity : TRIGGER_PRIORITY.granularity - 20);
	}

	// 3. Weakness (and big stubs that keep failing).
	for (const s of input.signals ?? []) {
		const x = sys.index.get(s.nodeId);
		if (x === undefined || !isLeaf(x) || known[x] === 1) continue;
		if (s.failures < opts.weaknessFailures && !s.missingConcept) continue;
		const enabled = sys.clauses[x]!.some((alt) => alt.every((y) => known[y] === 1));
		if (!enabled) continue;
		emit("weakness", s.nodeId, `${s.failures} falha(s) em ${s.nodeId} com pré-requisitos dominados: provável pré-requisito faltante (remediar)`, 0);
		if (isStub(x)) emit("granularity", s.nodeId, `${s.nodeId} segue falhando e ainda não foi refinado: detalhar em átomos`, 0, TRIGGER_PRIORITY.granularity + 5);
	}

	// 4. Explicit requests.
	for (const r of input.requests ?? []) {
		const nodeId = r.nodeId !== undefined && sys.index.has(r.nodeId) ? r.nodeId : undefined;
		emit("request", nodeId, `pedido do aluno: ${clip(r.text)}`, 0, TRIGGER_PRIORITY.request, nodeId === undefined ? normalizeKeyText(r.text) : undefined);
	}

	// 5. Coverage gaps.
	for (const g of input.coverageGaps ?? []) {
		const near = g.nearNodeId !== undefined && sys.index.has(g.nearNodeId) ? g.nearNodeId : undefined;
		const x = near !== undefined ? sys.index.get(near)! : undefined;
		emit(
			"coverage-gap",
			near,
			`âncora ${g.source}:${g.ref} sem nó correspondente`,
			x !== undefined ? (dist.get(x) ?? FAR_DEPTH) : FAR_DEPTH,
			TRIGGER_PRIORITY["coverage-gap"],
			`${g.source}:${g.ref}`,
		);
	}

	// Dedupe (highest priority wins), drop recent keys, budget order.
	const recent = new Set(input.recentKeys ?? []);
	const best = new Map<string, DetectedTrigger>();
	for (const t of out) {
		if (recent.has(t.key)) continue;
		const prev = best.get(t.key);
		if (!prev || t.trigger.priority > prev.trigger.priority || (t.trigger.priority === prev.trigger.priority && t.depth < prev.depth)) best.set(t.key, t);
	}
	return [...best.values()].sort(
		(a, b) => b.trigger.priority - a.trigger.priority || a.depth - b.depth || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
	);
}
