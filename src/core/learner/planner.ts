/**
 * "O que estudar agora": deterministic daily plan, no LLM (r2 §9.9;
 * SÍNTESE §2.4(a) and §2.6 policy; r10 §3.7 goal-directed progress).
 *
 * Candidates and values (c = expected minutes):
 *   review k   (R_k ≤ r_k or card due)    V = I_k(1 − R_k)/c_rev
 *   vehicle n  (mastered, encompasses due nodes)
 *              V = [Σ_{k∈Due} w*_{nk}·I_k(1 − R_k) + [n∈Due]·I_n(1 − R_n)]/c_veh
 *              with w* after the FIRe allocation cap (same rules as fold);
 *   new j      (frontier ∩ goal plan)     V = I_j·Ready_j·(1 + U_j)/c_j
 *   weak w     (verified; decayed blame ≥ 0.3 or active misconception)
 *              V = I_w(1 − p_w)·B_w·(1 + |desc_blocked(w)|)/c_rem
 *   probe k    (placed/implied without direct check, or unverified with
 *              blame ≥ 0.3)                V = H₂(p_k)(1 + |desc(k)|)/c_probe
 *
 * Daily algorithm (budget B):
 *   1. mandatory reviews: R < r − 0.10;
 *   2. greedy compression while Due ≠ ∅ and review time ≤ ρ_rev·B: best V among
 *      the single reviews and vehicles that still FIT (share and day); a
 *      vehicle's credit is SIMULATED with the real FSRS interpolation and Due
 *      is recomputed ((1 − 1/e) greedy);
 *   3. new nodes, n_new = min(n_max, max(1, ⌊B_new/c̄_new⌋)) with B_new the
 *      budget left (the "1" only when ≥ 10 min remain); suspended when the
 *      projected 30-day load L̂ (FSRS simulation sampling successes with R,
 *      seeded per domain/day) exceeds ρ_rev·B. A node longer than what is
 *      left gets a partial session (≥ 10 min). Each new node brings the
 *      at-risk prerequisites of its ROUTE (best expanded clause satisfied by
 *      A; containers looked through, untaken OR alternatives ignored) —
 *      R < r + 0.03, or p·R < 0.85 — as warm-up reviews, or as remediation
 *      when the prerequisite is weak — readiness never re-locks (SÍNTESE §2.6);
 *   4. remaining budget: weak and probes interleaved by value.
 * Item order: mandatory → warm-ups → new → compression → weak/probes.
 * The plan never exceeds B, new items are always frontier leaves (inside the
 * goal plan when it intersects the frontier), and `next` is ONE suggestion:
 * a weak prerequisite of today's new node, else the first new node, else
 * remediation, else review/vehicle, else probe.
 */

import { FSRS_STATE, retrievability, reviewMemory } from "./fsrs.ts";
import { expandedClauses, graphIndex, type LearnerGraphView } from "./graph-view.ts";
import { binaryEntropy, clamp, compareIds, DAY_MS, Rng, toIso, toMs } from "./math.ts";
import { LEARNER_CONSTANTS } from "./params.ts";
import { allocateCredit, applyCredit, encompassingWeights, encompassWeights, isCreditEligible } from "./propagate.ts";
import { blockedDescendants, computeSignals, descendantCounts, unlockValues, type NodeSignal, type SignalsResult } from "./signals.ts";
import type { LearnerParams, LearnerSnapshot, NodeId, NodeState, PlanItem, StudyPlan } from "./types.ts";

const PC = LEARNER_CONSTANTS.planner;

export interface PlanOptions {
	/** "Now" (ISO instant). */
	at: string;
	budgetMin: number;
	/** Goal plan P (default: goalPlanOf with the explicit goals, else every node). */
	goalPlan?: ReadonlySet<NodeId>;
	/** Seed of the load simulation (default: domain + date). */
	seed?: string;
	/** Precomputed signals at the same instant (avoids recomputation). */
	signals?: SignalsResult;
}

export class PlannerError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PlannerError";
	}
}

// ─── goal plan (r10 §3.6: a concrete feasible plan as UB) ────────────────────

/**
 * Nodes still needed to reach the explicit goals (goalWeight ≥ 1): from each
 * target, recursively the cheapest clause (Σ hoursMid of members not yet
 * known/needed). Without explicit goals every id is in the plan.
 */
export function goalPlanOf(graph: LearnerGraphView, known: ReadonlySet<NodeId>): Set<NodeId> {
	const targets = graph.ids.filter((id) => (graph.nodes.get(id)?.goalWeight ?? 0) >= 1);
	if (targets.length === 0) return new Set(graph.ids);
	const need = new Set<NodeId>();
	const stack = [...targets].reverse();
	while (stack.length > 0) {
		const v = stack.pop() as NodeId;
		if (need.has(v) || known.has(v)) continue;
		need.add(v);
		const node = graph.nodes.get(v);
		if (!node || node.clauses.length === 0) continue;
		let best: readonly NodeId[] | null = null;
		let bestCost = Infinity;
		for (const clause of node.clauses) {
			let cost = 0;
			for (const m of clause) if (!known.has(m) && !need.has(m)) cost += graph.nodes.get(m)?.hoursMid ?? 0;
			if (cost < bestCost) {
				bestCost = cost;
				best = clause;
			}
		}
		for (const m of [...(best ?? [])].reverse()) stack.push(m);
	}
	return need;
}

// ─── load projection (r2 §9.9 step 3) ────────────────────────────────────────

/**
 * Average daily review minutes over the next `days`, simulating every
 * reviewed card with FSRS-7: at each due instant success ~ Bernoulli(R)
 * (Good / Again). Deterministic for a given seed.
 */
export function projectedDailyLoad(
	snapshot: LearnerSnapshot,
	graph: LearnerGraphView,
	params: LearnerParams,
	at: string,
	days: number = PC.loadHorizonDays,
	seed = `${snapshot.domainId}|${at.slice(0, 10)}`,
): number {
	const rng = new Rng(seed);
	const start = toMs(at);
	const end = start + days * DAY_MS;
	let minutes = 0;
	for (const id of graph.ids) {
		const state = snapshot.nodes[id];
		let mem = state?.fsrs;
		if (!state || !mem || mem.state === FSRS_STATE.new) continue;
		for (let i = 0; i < 64; i++) {
			const t = Math.max(toMs(mem.dueAt), start);
			if (t >= end) break;
			const tIso = toIso(t);
			minutes += PC.reviewMinutes;
			const ok = rng.next() < retrievability(mem, tIso, params);
			mem = reviewMemory(mem, mem.cardId, ok ? 3 : 1, tIso, state.desiredRetention, params);
		}
	}
	return minutes / Math.max(1, days);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function pct(x: number): string {
	return `${Math.round(clamp(x, 0, 1) * 100)}%`;
}

function titleOf(graph: LearnerGraphView, id: NodeId): string {
	const t = graph.nodes.get(id)?.title ?? id;
	return t.length > 48 ? `${t.slice(0, 47)}…` : t;
}

function newCost(graph: LearnerGraphView, id: NodeId): number {
	return Math.round(clamp((graph.nodes.get(id)?.hoursMid ?? 0.5) * 60, PC.minNewMinutes, PC.maxNewMinutes));
}

interface Budget {
	total: number;
	used: number;
	review: number;
	fresh: number;
}

function fits(b: Budget, minutes: number): boolean {
	return b.used + minutes <= b.total + 1e-9;
}

function take(b: Budget, item: PlanItem, items: PlanItem[], planned: Set<NodeId>): void {
	items.push(item);
	planned.add(item.nodeId);
	b.used += item.estMinutes;
	if (item.kind === "review" || item.kind === "vehicle") b.review += item.estMinutes;
	if (item.kind === "new") b.fresh += item.estMinutes;
}

function reviewItem(sig: NodeSignal, importance: number, reason: string): PlanItem {
	return { kind: "review", nodeId: sig.nodeId, estMinutes: PC.reviewMinutes, value: (importance * (1 - sig.R)) / PC.reviewMinutes, reason };
}

// ─── vehicles (simulated FIRe) ───────────────────────────────────────────────

interface VehicleOption {
	nodeId: NodeId;
	value: number;
	covers: NodeId[];
	/** Simulated post-credit states of the covered nodes. */
	credited: Map<NodeId, NodeState>;
}

function vehicleOption(
	n: NodeId,
	due: ReadonlySet<NodeId>,
	states: ReadonlyMap<NodeId, NodeState>,
	sig: SignalsResult,
	graph: LearnerGraphView,
	params: LearnerParams,
	at: string,
): VehicleOption | null {
	const f = LEARNER_CONSTANTS.fire;
	const weights = encompassWeights(graph, n, params.propagationHops, params.fireMinWeight);
	const candidates: { nodeId: NodeId; rawUnits: number }[] = [];
	for (const [k, w] of weights) {
		if (!due.has(k) || !isCreditEligible(states.get(k), at)) continue;
		const rawUnits = Math.round(f.micro * w);
		if (rawUnits > 0) candidates.push({ nodeId: k, rawUnits });
	}
	if (candidates.length === 0) return null;
	let gain = 0;
	const covers: NodeId[] = [];
	const credited = new Map<NodeId, NodeState>();
	for (const a of allocateCredit(candidates, f.attemptCapReps * f.micro)) {
		const s = states.get(a.nodeId) as NodeState;
		const kSig = sig.signals.get(a.nodeId) as NodeSignal;
		const w = a.units / f.micro;
		gain += w * kSig.importance * (1 - kSig.R);
		const after = applyCredit(s, w, at, params);
		credited.set(a.nodeId, after);
		const R = retrievability(after.fsrs, at, params);
		if (after.fsrs && toMs(after.fsrs.dueAt) > toMs(at) && R >= kSig.retention) covers.push(a.nodeId);
	}
	const self = sig.signals.get(n) as NodeSignal;
	if (due.has(n)) gain += self.importance * (1 - self.R);
	if (covers.length === 0) return null;
	return { nodeId: n, value: gain / PC.vehicleMinutes, covers: covers.sort(compareIds), credited };
}

// ─── the plan ────────────────────────────────────────────────────────────────

/** Verified node with fresh blame or an active misconception (r2 §9.10). */
function isWeak(state: NodeState | undefined, s: NodeSignal): boolean {
	return !!state?.verified && (s.blame >= LEARNER_CONSTANTS.probeBlame || s.misconceptionMass > 0);
}

function weakReason(s: NodeSignal): string {
	return s.misconception ? `Ponto fraco: ${s.misconception.slice(0, 60)}` : "Ponto fraco: erros recentes neste tópico";
}

function remediateItem(graph: LearnerGraphView, s: NodeSignal, known: ReadonlySet<NodeId>, reason: string): PlanItem {
	const blameMass = s.blame + s.misconceptionMass;
	const value = (s.importance * (1 - s.pL) * blameMass * (1 + blockedDescendants(graph, s.nodeId, known))) / PC.remediateMinutes;
	return { kind: "remediate", nodeId: s.nodeId, estMinutes: PC.remediateMinutes, value, reason };
}

/**
 * The prerequisites a new node is actually reached through: the expanded
 * clause (containers looked through) satisfied by A with the best Π p·R
 * (readiness), else — defensively — the best clause overall. With OR
 * clauses the members of the alternatives NOT taken are not prerequisites
 * of today's lesson and must not trigger warm-ups or remediation.
 */
export function routeTo(id: NodeId, graph: LearnerGraphView, sig: SignalsResult): readonly NodeId[] {
	const known = sig.structure.known;
	const pr = (m: NodeId) => sig.signals.get(m)?.pKnowsNow ?? 0;
	let best: { members: readonly NodeId[]; satisfied: boolean; product: number } | null = null;
	for (const clause of expandedClauses(graph, id)) {
		const satisfied = clause.every((m) => known.has(m));
		const product = clause.reduce((p, m) => p * pr(m), 1);
		if (!best || (satisfied && !best.satisfied) || (satisfied === best.satisfied && product > best.product)) best = { members: clause, satisfied, product };
	}
	return best?.members ?? [];
}

/**
 * Warm-ups of a new node: at-risk prerequisites on its route (R < r + 0.03
 * or p·R < 0.85) get a review; a WEAK prerequisite gets remediation instead.
 * Never re-locks.
 */
function warmupsFor(
	id: NodeId,
	graph: LearnerGraphView,
	snapshot: LearnerSnapshot,
	sig: SignalsResult,
	params: LearnerParams,
	planned: ReadonlySet<NodeId>,
): PlanItem[] {
	const out: PlanItem[] = [];
	const title = titleOf(graph, id);
	for (const a of routeTo(id, graph, sig)) {
		if (planned.has(a)) continue;
		const state = snapshot.nodes[a];
		const s = sig.signals.get(a);
		if (!s || !state?.fsrs || state.fsrs.state === FSRS_STATE.new) continue;
		if (isWeak(state, s)) out.push(remediateItem(graph, s, sig.structure.known, `${weakReason(s)} (pré-requisito de "${title}")`));
		else if (s.R < s.retention + PC.atRiskMargin || s.pKnowsNow < params.readinessThreshold) {
			out.push(reviewItem(s, s.importance, `Aquecimento: pré-requisito de "${title}"`));
		}
	}
	return out;
}

export function planDay(snapshot: LearnerSnapshot, graph: LearnerGraphView, params: LearnerParams, opts: PlanOptions): StudyPlan {
	if (!(opts.budgetMin >= 0 && Number.isFinite(opts.budgetMin))) throw new PlannerError(`Orçamento inválido: ${opts.budgetMin}`);
	const at = opts.at;
	toMs(at);
	const sig = opts.signals ?? computeSignals(snapshot, graph, params, at);
	const known = sig.structure.known;
	const budget: Budget = { total: opts.budgetMin, used: 0, review: 0, fresh: 0 };
	const reviewCap = params.planner.reviewShare * opts.budgetMin;
	const planned = new Set<NodeId>();
	const get = (id: NodeId) => sig.signals.get(id) as NodeSignal;
	const pos = graphIndex(graph).pos;

	// Due set (leaves with a reviewed card that is due or below its role retention).
	const due = new Set<NodeId>();
	for (const [id, s] of sig.signals) if (s.reviewDue && graph.nodes.get(id)?.isLeaf !== false) due.add(id);

	// 1. mandatory reviews: R < r − 0.10.
	const mandatory: PlanItem[] = [];
	const urgent = [...due]
		.map((id) => get(id))
		.filter((s) => s.R < s.retention - PC.mandatoryMargin)
		.map((s) => reviewItem(s, s.importance, `Revisão urgente — retenção caiu para ${pct(s.R)}`))
		.sort((x, y) => y.value - x.value || compareIds(x.nodeId, y.nodeId));
	for (const item of urgent) if (fits(budget, item.estMinutes)) take(budget, item, mandatory, planned);

	// 2. greedy compression over the remaining Due (review time ≤ ρ_rev·B).
	const states = new Map<NodeId, NodeState>(Object.entries(snapshot.nodes));
	const remaining = new Set([...due].filter((id) => !planned.has(id)));
	const vehicleIds = new Set<NodeId>();
	for (const k of remaining) {
		for (const n of encompassingWeights(graph, k, params.propagationHops, params.fireMinWeight).keys()) {
			const s = snapshot.nodes[n];
			if (s?.masteredAt && s.fsrs && s.pL >= LEARNER_CONSTANTS.fire.minSourceP) vehicleIds.add(n);
		}
	}
	const compression: PlanItem[] = [];
	// A candidate competes only if it still fits the review share AND the day (a 6-min vehicle
	// that does not fit must not hide a 5-min review that does).
	const affordable = (minutes: number) => budget.review + minutes <= reviewCap + 1e-9 && fits(budget, minutes);
	while (remaining.size > 0) {
		let best: { item: PlanItem; option?: VehicleOption } | null = null;
		if (affordable(PC.reviewMinutes)) {
			for (const id of remaining) {
				const s = get(id);
				const item = reviewItem(s, s.importance, `Revisão vencida — retenção estimada ${pct(s.R)}`);
				if (!best || item.value > best.item.value || (item.value === best.item.value && compareIds(id, best.item.nodeId) < 0)) best = { item };
			}
		}
		if (affordable(PC.vehicleMinutes)) {
			for (const n of vehicleIds) {
				if (planned.has(n)) continue;
				const option = vehicleOption(n, remaining, states, sig, graph, params, at);
				if (!option) continue;
				const k = option.covers.length;
				const item: PlanItem = {
					kind: "vehicle",
					nodeId: n,
					estMinutes: PC.vehicleMinutes,
					value: option.value,
					reason: `Revisa ${k} ${k === 1 ? "tópico" : "tópicos"} de uma vez`,
					covers: option.covers,
				};
				if (!best || item.value > best.item.value) best = { item, option };
			}
		}
		if (!best || !(best.item.value > 0)) break;
		take(budget, best.item, compression, planned);
		remaining.delete(best.item.nodeId);
		if (best.option) {
			for (const [k, s] of best.option.credited) states.set(k, s);
			for (const k of best.option.covers) remaining.delete(k);
		}
	}

	// 3. new nodes ∈ frontier ∩ goal plan, each with its warm-ups (load controller).
	const plan = opts.goalPlan ?? goalPlanOf(graph, known);
	const frontier = sig.structure.frontier;
	const inPlan = frontier.filter((id) => plan.has(id));
	const pool = inPlan.length > 0 ? inPlan : frontier;
	const U = unlockValues(graph, params.planner.gamma);
	const newCandidates = pool
		.map((id) => {
			const s = get(id);
			const cost = newCost(graph, id);
			return { id, cost, value: (s.importance * s.readiness * (1 + (U.get(id) ?? 0))) / cost };
		})
		.sort((a, b) => b.value - a.value || (pos.get(a.id) as number) - (pos.get(b.id) as number));
	const load = projectedDailyLoad(snapshot, graph, params, at, PC.loadHorizonDays, opts.seed);
	const suspended = load > reviewCap;
	const left = Math.max(0, budget.total - budget.used);
	const nNew = suspended
		? 0
		: Math.min(params.planner.maxNewPerDay, Math.max(left >= PC.minNewMinutes ? 1 : 0, Math.floor(left / params.planner.avgNewMinutes)));
	const warmups: PlanItem[] = [];
	const freshItems: PlanItem[] = [];
	for (const cand of newCandidates) {
		if (freshItems.length >= nNew) break;
		if (planned.has(cand.id)) continue;
		const needed = warmupsFor(cand.id, graph, snapshot, sig, params, planned);
		const warmMinutes = needed.reduce((s, i) => s + i.estMinutes, 0);
		// A node longer than what is left gets a partial session (≥ 10 min); the lesson resumes next day.
		const session = Math.min(cand.cost, Math.floor(budget.total - budget.used - warmMinutes + 1e-9));
		if (session < Math.min(cand.cost, PC.minNewMinutes)) continue;
		for (const item of needed) take(budget, item, warmups, planned);
		const unlocks = blockedDescendants(graph, cand.id, known, 999);
		const goal = (graph.nodes.get(cand.id)?.goalWeight ?? 0) > 0;
		const reason = goal
			? "Próximo passo rumo à sua meta"
			: unlocks > 0
				? `Pronto para aprender — abre caminho para ${unlocks} ${unlocks === 1 ? "tópico" : "tópicos"}`
				: "Pronto para aprender";
		take(budget, { kind: "new", nodeId: cand.id, estMinutes: session, value: cand.value, reason }, freshItems, planned);
	}

	// 4. weak and probes, interleaved by value.
	const desc = descendantCounts(graph);
	const weak: PlanItem[] = [];
	const probes: PlanItem[] = [];
	for (const [id, s] of sig.signals) {
		if (planned.has(id) || graph.nodes.get(id)?.isLeaf === false) continue;
		const state = snapshot.nodes[id];
		if (isWeak(state, s)) {
			weak.push(remediateItem(graph, s, known, weakReason(s)));
			continue;
		}
		const inferredKnown = known.has(id) && !state?.attainedAt && !state?.verified;
		const blamedUnverified = !!state && !state.verified && s.blame >= LEARNER_CONSTANTS.probeBlame;
		if (inferredKnown || blamedUnverified) {
			const p = state?.pL ?? params.attainThreshold;
			const value = (binaryEntropy(p) * (1 + (desc.get(id) ?? 0))) / PC.probeMinutes;
			const reason = blamedUnverified ? "Sonda rápida: pode ser a origem de erros recentes" : "Sonda rápida: confirmar se você já domina";
			probes.push({ kind: "probe", nodeId: id, estMinutes: PC.probeMinutes, value, reason });
		}
	}
	const byValue = (x: PlanItem, y: PlanItem) => y.value - x.value || compareIds(x.nodeId, y.nodeId);
	weak.sort(byValue);
	probes.sort(byValue);
	const tail: PlanItem[] = [];
	for (let i = 0; i < Math.max(weak.length, probes.length); i++) {
		for (const item of [weak[i], probes[i]]) {
			if (item && item.value > 0 && fits(budget, item.estMinutes)) take(budget, item, tail, planned);
		}
	}

	// A due review already occupies budget. If the next lesson depends on that
	// weak skill, bring its existing slot forward just as for a fresh warm-up.
	const firstLesson = freshItems[0];
	const prerequisites = firstLesson ? routeTo(firstLesson.nodeId, graph, sig) : [];
	const duePrerequisite = mandatory.find(item => item.kind === "review" && prerequisites.includes(item.nodeId)
		&& isWeak(snapshot.nodes[item.nodeId], get(item.nodeId)));
	if (duePrerequisite && firstLesson) {
		duePrerequisite.kind = "remediate";
		duePrerequisite.reason = weakReason(get(duePrerequisite.nodeId)) + ` (pré-requisito de "${titleOf(graph, firstLesson.nodeId)}")`;
	}
	const items = [...mandatory, ...warmups, ...freshItems, ...compression, ...tail];
	const next =
		warmups.find((i) => i.kind === "remediate") ??
		duePrerequisite ??
		freshItems[0] ??
		tail.find((i) => i.kind === "remediate") ??
		mandatory[0] ??
		compression[0] ??
		warmups[0] ??
		tail.find((i) => i.kind === "probe") ??
		null;
	return {
		domainId: snapshot.domainId,
		date: at.slice(0, 10),
		budgetMin: opts.budgetMin,
		items,
		next,
		reviewMinutes: budget.review,
		newMinutes: budget.fresh,
	};
}
