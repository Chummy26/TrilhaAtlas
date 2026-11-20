/**
 * Integration seam curriculum → learner (docs/research/00-SINTESE.md §2.3,
 * §2.6): projects a CurriculumSnapshot into the LearnerGraphView the learner
 * model reads (EFFECTIVE clauses only), plus the small node brief the UI and
 * the lesson opener show.
 *
 * Pure and browser-safe.
 */

import { childrenOf, effectiveClausesOf, effectiveSystemOf } from "../curriculum/effective.ts";
import { hoursMid } from "../curriculum/hours.ts";
import type { CurriculumItem, CurriculumSnapshot, Hours } from "../curriculum/types.ts";
import { assertGraphView, buildGraphView, type LearnerGraphNode, type LearnerGraphView } from "../learner/graph-view.ts";

/** LearnerGraphView of the live items of `snapshot`; `goalIds` get goalWeight 1. */
export function learnerViewOf(snapshot: CurriculumSnapshot, goalIds: readonly string[] = []): LearnerGraphView {
	const sys = effectiveSystemOf(snapshot);
	const goals = new Set(goalIds);
	const live = new Set(sys.ids);
	// Input order = teaching order (preorder DFS over children sorted by
	// `order`): buildGraphView breaks topological ties by input order, so the
	// planner's ties follow the curriculum's own sequence, not id spelling.
	const teaching: string[] = [];
	const stack = [...sys.roots].reverse().map((r) => sys.ids[r] as string);
	while (stack.length > 0) {
		const id = stack.pop() as string;
		teaching.push(id);
		const kids = childrenOf(sys, id);
		for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i] as string);
	}
	for (const id of sys.ids) if (!teaching.includes(id)) teaching.push(id);
	const entries: ({ id: string } & LearnerGraphNode)[] = [];
	for (const id of teaching) {
		const item = snapshot.items[id] as CurriculumItem;
		const children = childrenOf(sys, id);
		entries.push({
			id,
			title: item.title.pt,
			version: item.version,
			isLeaf: children.length === 0,
			reinforcementFor: item.reinforcementFor,
			parentId: item.parentId !== null && live.has(item.parentId) ? item.parentId : null,
			children,
			clauses: effectiveClausesOf(sys, id),
			encompasses: item.encompasses.filter((e) => live.has(e.id) && e.id !== id && e.w > 0 && e.w <= 1),
			hoursMid: Math.max(0, hoursMid(item.hours)),
			depth: 0,
			goalWeight: goals.has(id) ? 1 : 0,
		});
	}
	const view = buildGraphView(entries);
	// depth = longest effective-prerequisite chain below the node, taking the
	// cheapest alternative of an OR (r2 §9.7 diagnostic seed).
	const depth = new Map<string, number>();
	const nodes = new Map<string, LearnerGraphNode>();
	for (const id of view.ids) {
		const node = view.nodes.get(id) as LearnerGraphNode;
		let d = 0;
		if (node.clauses.length > 0) {
			let best = Infinity;
			for (const clause of node.clauses) {
				let worst = 0;
				for (const m of clause) worst = Math.max(worst, depth.get(m) ?? 0);
				best = Math.min(best, worst);
			}
			d = 1 + (Number.isFinite(best) ? best : 0);
		}
		depth.set(id, d);
		nodes.set(id, { ...node, depth: d });
	}
	const projected: LearnerGraphView = { ids: view.ids, nodes };
	assertGraphView(projected);
	return projected;
}

/** Nodes in the selected units, or in the selected area for a panoramic lesson. */
export function lessonBranchNodes(snapshot: CurriculumSnapshot, view: LearnerGraphView, focus: readonly string[]): Set<string> {
	const nodes = new Set<string>();
	for (const id of focus) {
		let item = snapshot.items[id];
		if (!item || !view.nodes.has(id)) {
			nodes.add(id);
			continue;
		}
		while (item.parentId && item.kind !== "unit" && item.kind !== "area" && item.kind !== "domain") item = snapshot.items[item.parentId]!;
		const pending = [item.id];
		while (pending.length) {
			const next = pending.pop()!;
			if (nodes.has(next)) continue;
			nodes.add(next);
			for (const child of view.nodes.get(next)?.children ?? []) pending.push(child);
		}
	}
	return nodes;
}

/** What the "Hoje" card and the lesson opener need to know about one node. */
export interface StudyNodeBrief {
	id: string;
	title: string;
	/** Ancestor titles below the domain root, outermost first (e.g. ["Análise CA", "Fasores"]). */
	path: string[];
	summary: string;
	scope: string;
	objectives: string[];
	misconceptions: string[];
	assessment?: string[];
	regionExit?: boolean;
	hours: Hours;
	kind: CurriculumItem["kind"];
}

export function nodeBrief(snapshot: CurriculumSnapshot, id: string): StudyNodeBrief | null {
	const item = snapshot.items[id];
	if (!item) return null;
	const path: string[] = [];
	const seen = new Set<string>([id]);
	let p = item.parentId;
	while (p !== null && !seen.has(p)) {
		const parent = snapshot.items[p];
		if (!parent) break;
		if (parent.parentId !== null) path.unshift(parent.title.pt);
		seen.add(p);
		p = parent.parentId;
	}
	return {
		id,
		title: item.title.pt,
		path,
		summary: item.summary,
		scope: item.scope,
		objectives: [...item.objectives],
		assessment: item.assess,
		regionExit: item.tags?.includes("region-exit"),
		misconceptions: [...(item.misconceptions ?? [])],
		hours: { ...item.hours },
		kind: item.kind,
	};
}
