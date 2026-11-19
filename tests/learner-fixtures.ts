/**
 * Shared fixtures for the learner-model tests (tests/learner-*.test.ts):
 * graph builders, evidence builders and a random clause-system generator for
 * fast-check. Not a test file itself (no `.test.` suffix).
 */

import fc from "fast-check";
import { buildGraphView, type LearnerGraphNode, type LearnerGraphView } from "../src/core/learner/graph-view.ts";
import type { Evidence, Grade, ItemFormat, ItemLevel, LearnerEvent, NodeId } from "../src/core/learner/types.ts";

export const DOMAIN = "electronics";

export interface NodeSpec {
	clauses?: NodeId[][];
	encompasses?: { id: NodeId; w: number }[];
	goal?: number;
	hours?: number;
	leaf?: boolean;
	children?: NodeId[];
	version?: number;
	depth?: number;
}

export function node(id: NodeId, spec: NodeSpec = {}): { id: NodeId } & LearnerGraphNode {
	return {
		id,
		title: `Tópico ${id}`,
		version: spec.version ?? 1,
		isLeaf: spec.leaf ?? true,
		parentId: null,
		children: spec.children ?? [],
		clauses: spec.clauses ?? [],
		encompasses: spec.encompasses ?? [],
		hoursMid: spec.hours ?? 0.5,
		depth: spec.depth ?? 0,
		goalWeight: spec.goal ?? 0,
	};
}

export function graph(...entries: ({ id: NodeId } & LearnerGraphNode)[]): LearnerGraphView {
	return buildGraphView(entries);
}

/** a → b → c … chain of `n` leaves (`n0`, `n1`, …), depth = index. */
export function chain(n: number): LearnerGraphView {
	return graph(...Array.from({ length: n }, (_, i) => node(`n${i}`, { clauses: i === 0 ? [] : [[`n${i - 1}`]], depth: i })));
}

/** UTC 10:00 of 2026-01-01 + d days (fractional allowed). */
export function day(d: number): string {
	return new Date(Date.UTC(2026, 0, 1, 10) + d * 86_400_000).toISOString();
}

export interface EvidenceSpec {
	seq: number;
	at: string;
	nodeId: NodeId;
	grade: Grade;
	family?: string;
	format?: ItemFormat;
	level?: ItemLevel;
	confidence?: number;
	hints?: number;
	minutes?: number;
	extraNodes?: { nodeId: NodeId; q: number }[];
	attributions?: Evidence["attributions"];
	diagnoses?: Evidence["diagnoses"];
	summative?: boolean;
	weight?: number;
}

export function evidence(spec: EvidenceSpec): LearnerEvent {
	const ev: Evidence = {
		id: `ev${spec.seq}`,
		seq: spec.seq,
		at: spec.at,
		domainId: DOMAIN,
		sessionId: "s1",
		itemId: `item${spec.seq}`,
		itemFamily: spec.family ?? `${spec.nodeId}#L${spec.level ?? 3}#${spec.seq}`,
		nodes: [{ nodeId: spec.nodeId, q: 1, primary: true }, ...(spec.extraNodes ?? [])],
		format: spec.format ?? "short",
		level: spec.level ?? 3,
		grade: spec.grade,
		graderConfidence: spec.confidence ?? 1,
		hints: spec.hints ?? 0,
		minutesSinceExposure: spec.minutes ?? 3000,
	};
	if (spec.attributions) ev.attributions = spec.attributions;
	if (spec.diagnoses) ev.diagnoses = spec.diagnoses;
	if (spec.summative) ev.summative = true;
	if (spec.weight !== undefined) ev.weight = spec.weight;
	return { kind: "evidence", evidence: ev };
}

/**
 * Random ranked clause system: node i may only reference nodes < i (R2), at
 * most 2 OR-alternatives of ≤ 3 members. Ids are `x0…x{n-1}`.
 */
export function clauseSystemArb(minNodes = 2, maxNodes = 8): fc.Arbitrary<LearnerGraphView> {
	return fc.integer({ min: minNodes, max: maxNodes }).chain((n) =>
		fc
			.tuple(
				...Array.from({ length: n }, (_, i) =>
					i === 0
						? fc.constant([] as number[][])
						: fc.array(fc.uniqueArray(fc.integer({ min: 0, max: i - 1 }), { minLength: 1, maxLength: Math.min(3, i) }), { minLength: 0, maxLength: 2 }),
				),
			)
			.map((clausesPerNode) =>
				graph(...clausesPerNode.map((clauses, i) => node(`x${i}`, { clauses: clauses.map((c) => c.map((m) => `x${m}`)) }))),
			),
	);
}

/** Every subset of the view's ids (n ≤ 10). */
export function allSubsets(view: LearnerGraphView): Set<NodeId>[] {
	const ids = view.ids;
	const out: Set<NodeId>[] = [];
	for (let mask = 0; mask < 1 << ids.length; mask++) {
		const s = new Set<NodeId>();
		ids.forEach((id, i) => {
			if (mask & (1 << i)) s.add(id);
		});
		out.push(s);
	}
	return out;
}

export type PracticeStep = Omit<EvidenceSpec, "seq" | "at"> & { d: number };

/** Evidence events for `steps` (seq = index + 1, at = day(d)). */
export function practice(steps: readonly PracticeStep[], firstSeq = 1): LearnerEvent[] {
	return steps.map((s, i) => {
		const { d, ...rest } = s;
		return evidence({ ...rest, seq: firstSeq + i, at: day(d) });
	});
}

/** Three spaced, hint-free, distinct-family successes per node (mastery schedule). */
export function masterySteps(ids: readonly NodeId[], startDay = 0, gapDays = 2): PracticeStep[] {
	const steps: PracticeStep[] = [];
	let d = startDay;
	for (const id of ids) {
		for (let k = 0; k < 3; k++) {
			steps.push({ d, nodeId: id, grade: 3 });
			d += gapDays;
		}
	}
	return steps;
}

/** a → b → c where c encompasses b (0.8) and a (0.5); c also lists a weaker 3-hop path. */
export function encompassingChain(): LearnerGraphView {
	return graph(
		node("a"),
		node("b", { clauses: [["a"]], depth: 1 }),
		node("c", { clauses: [["b"]], encompasses: [{ id: "b", w: 0.8 }, { id: "a", w: 0.5 }], depth: 2 }),
	);
}

/** Narrow an optional value, failing the test when it is missing. */
export function must<T>(value: T | undefined | null, what = "valor"): T {
	if (value === undefined || value === null) throw new Error(`${what} ausente`);
	return value;
}
