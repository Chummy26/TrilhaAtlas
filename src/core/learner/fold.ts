/**
 * Event-sourced learner state: a PURE fold over the append-only LearnerEvent
 * log of one domain (r2 §9.1 "Event sourcing", §9.13 (7); SÍNTESE §2.6).
 *
 *   foldEvents(snapshot | null, events, graph, params) → LearnerSnapshot
 *
 * Events are applied in (seq, at, id) order; events with seq ≤ snapshot.seq
 * are already folded and skipped, so re-folding a tail is a no-op and
 * fold(fold(s, A), B) = fold(s, A ++ B). Inputs are never mutated.
 *
 * evidence (r2 §9.4–9.6):
 *   1. effective grade (hints ⇒ ≤ 2), emission regime + grader confusion;
 *      minutes since exposure = min(evidence field, last folded `exposure`
 *      of the primary); weight = explicit, else 0.3 for flashcards, else 1;
 *   2. DINA mean-field over the Q-vector (+ LLM attributions on failures),
 *      which reduces to the single-node BKT×FSRS update; transition
 *      T·q·weight; nEff += weight·q; verified for q ≥ 0.5;
 *   3. blame (14-day half-life) and misconception Beta updates;
 *   4. one REAL FSRS-7 review on the primary node (not for flashcards, which
 *      keep their own FSRS-6 schedule), retention by role (0.93/0.90/0.85)
 *      computed on the same structural set A as the signals; the primary is
 *      the DECLARED one (flag, else largest q over the whole Q-vector) — if
 *      the graph does not know it, no node gets the review (never a co-node);
 *      non-primary nodes that failed get due ← now + (1 − b)(due − now);
 *   5. Elo θ / b_{k,ℓ}; correct item families; delayed (≥ 24 h since the
 *      last exposure AND the last evidence) hint-free successes; summative
 *      pass ⇒ demonstratedAt;
 *   6. local consistency projection (h ≤ 3 ball, 3 sweeps);
 *   7. upward penalty on encompassing nodes after a failure;
 *   8. MONOTONIC flags — attainedAt: first pL ≥ 0.85 with direct evidence;
 *      masteredAt: pL ≥ 0.95 ∧ ≥ 2 correct families ∧ delayed independent production.
 *      Neither is ever cleared by failures (tutor-mcp hysteresis bug, §9.1).
 * exposure: lesson transition T_lesson (no evidence count); records
 *   lastExposureAt (restarts the delayed-retrieval clock).
 * implicit-credit: FSRS interpolation by the RECORDED w + ledger (propagate.ts).
 * diagnostic: unverified nodes take the estimate (inferred); estimate ≥ 0.85
 *   sets the monotonic placedAt (structural unlock, still probed).
 * node-version: a higher version RESETS the node (the only reset path).
 *   States are born at version 1 (the curriculum's seed version) and their
 *   version only moves through these events — never from the graph passed
 *   in — so a full replay against a NEWER graph still meets every bump. The
 *   integration must append a node-version event whenever a definition is
 *   bumped (even for nodes the learner never touched).
 *
 * FIRe credits are NOT derived during replay: `ingestEvent` derives them
 * after folding an evidence and returns them as `implicit-credit` events that
 * the store must append right after it (seq = previous seq + 1, …). Replaying
 * the persisted log then reproduces the same snapshot bit for bit.
 */

import type { DomainId } from "../domains/types.ts";
import {
	effectiveGrade,
	gradeToRating,
	isSuccessGrade,
	learningTransition,
	lessonTransition,
	medianLatency,
	practiceTransition,
	updateLatency,
} from "./bkt-fsrs.ts";
import { dinaUpdate, primaryNodeOf, type DinaNodeInput } from "./dina.ts";
import { resolveEmission } from "./emission.ts";
import { defaultLevelElo, guessFor, predictCorrect, updateElo } from "./elo.ts";
import { cardIdFor, retrievability, reviewMemory } from "./fsrs.ts";
import { expandedClauses, type LearnerGraphView } from "./graph-view.ts";
import { desiredRetentionFor, mandatoryMembers, structuralState, studyableDependents } from "./kst.ts";
import { clamp, clamp01, compareIds, MINUTE_MS, toMs } from "./math.ts";
import { observeMisconception, proposeMisconception, refuteMisconception } from "./misconceptions.ts";
import { LEARNER_CONSTANTS } from "./params.ts";
import {
	addBlame,
	applyCredit,
	deriveCredits,
	neighborhood,
	penalizeDue,
	projectConsistency,
	upwardPenalties,
	type CreditRecord,
	type ProjectionValue,
} from "./propagate.ts";
import type { Evidence, EvidenceNodeRef, LearnerEvent, LearnerParams, LearnerSnapshot, NodeId, NodeState } from "./types.ts";

export class LearnerFoldError extends Error {
	readonly eventId?: string;
	constructor(message: string, eventId?: string) {
		super(message);
		this.name = "LearnerFoldError";
		if (eventId !== undefined) this.eventId = eventId;
	}
}

const C = LEARNER_CONSTANTS;

// ─── construction ────────────────────────────────────────────────────────────

export function emptySnapshot(domainId: DomainId, at: string): LearnerSnapshot {
	toMs(at);
	return { schemaVersion: 1, domainId, seq: 0, nodes: {}, theta: 0, thetaN: 0, speed: 1, updatedAt: at };
}

/** State of a node never touched (prior p0, nEff 0.5). */
export function freshNodeState(nodeId: NodeId, version: number, params: LearnerParams, pL: number = C.priorP): NodeState {
	return {
		nodeId,
		nodeVersion: version,
		pL: clamp01(pL),
		nEff: C.priorNEff,
		verified: false,
		desiredRetention: params.desiredRetention.default,
		levelElo: defaultLevelElo(),
		blame: 0,
		misconceptions: {},
		correctFamilies: [],
		delayedSuccesses: 0,
	};
}

/** Total order of events: seq, then instant, then id (code units). */
export function compareEvents(a: LearnerEvent, b: LearnerEvent): number {
	return eventSeq(a) - eventSeq(b) || toMs(eventAt(a)) - toMs(eventAt(b)) || compareIds(eventId(a), eventId(b));
}

export function eventId(ev: LearnerEvent): string {
	return ev.kind === "evidence" ? ev.evidence.id : ev.id;
}

export function eventSeq(ev: LearnerEvent): number {
	return ev.kind === "evidence" ? ev.evidence.seq : ev.seq;
}

export function eventAt(ev: LearnerEvent): string {
	return ev.kind === "evidence" ? ev.evidence.at : ev.at;
}

function eventDomain(ev: LearnerEvent): DomainId {
	return ev.kind === "evidence" ? ev.evidence.domainId : ev.domainId;
}

// ─── working copy ────────────────────────────────────────────────────────────

interface Work {
	domainId: DomainId;
	seq: number;
	nodes: Record<NodeId, NodeState>;
	theta: number;
	thetaN: number;
	speed: number;
	updatedAt: string;
	/** Nodes whose state changed in the current event (flags recomputed). */
	touched: Set<NodeId>;
}

/**
 * Fréchet-bounded prior for a node materialized now (r2 §9.6d), looking
 * through containers: lower bound from studyable dependents, upper bound from
 * the mandatory members of the expanded clauses.
 */
function frechetPrior(work: Work, graph: LearnerGraphView, id: NodeId, eps: number): number {
	let lower = 0;
	for (const c of studyableDependents(graph, id)) {
		const s = work.nodes[c];
		if (s) lower = Math.max(lower, s.pL - eps);
	}
	let upper = 1;
	for (const a of mandatoryMembers(expandedClauses(graph, id))) {
		const s = work.nodes[a];
		if (s) upper = Math.min(upper, s.pL + eps);
	}
	return clamp(C.priorP, lower, Math.max(lower, upper));
}

/**
 * Existing state, or a fresh one at the INITIAL version. The version of a
 * state only moves through `node-version` events — never from the graph's
 * current version — so replaying the whole log against a newer graph still
 * meets the bump event and resets exactly as the incremental fold did.
 */
function stateOf(work: Work, graph: LearnerGraphView, params: LearnerParams, id: NodeId): NodeState {
	const existing = work.nodes[id];
	if (existing) return existing;
	const created = freshNodeState(id, C.initialNodeVersion, params, frechetPrior(work, graph, id, params.consistencyEps));
	work.nodes[id] = created;
	return created;
}

function put(work: Work, state: NodeState): void {
	work.nodes[state.nodeId] = state;
	work.touched.add(state.nodeId);
}

/** Monotonic attainment/mastery flags (never cleared here). */
export function withMonotoneFlags(s: NodeState, at: string, params: LearnerParams): NodeState {
	let { attainedAt, masteredAt } = s;
	if (!masteredAt && s.verified && s.independentRecallAt && s.pL >= params.masteryThreshold && s.correctFamilies.length >= C.masteryFamilies && s.delayedSuccesses >= C.masteryDelayed) {
		masteredAt = at;
	}
	if (!attainedAt && s.verified && (s.pL >= params.attainThreshold || masteredAt)) attainedAt = at;
	if (attainedAt === s.attainedAt && masteredAt === s.masteredAt) return s;
	const next = { ...s };
	if (attainedAt) next.attainedAt = attainedAt;
	if (masteredAt) next.masteredAt = masteredAt;
	return next;
}

/** Evidence weight: explicit `weight` (clamped to 1), else 0.3 for flashcards (r2 §9.3), else 1. */
export function evidenceWeight(ev: Evidence): number {
	return Math.min(1, ev.weight ?? (ev.format === "flashcard" ? C.flashcardWeight : 1));
}

/**
 * The node the item targets: the flagged primary, else the largest q (r2
 * §9.5) — over the WHOLE Q-vector. Null when the graph does not know it: the
 * real FSRS review, Elo, families and FIRe never fall back to a co-node.
 */
export function primaryIdOf(ev: Evidence, graph: LearnerGraphView): NodeId | null {
	const declared = primaryNodeOf(ev.nodes);
	return declared && graph.nodes.has(declared.nodeId) ? declared.nodeId : null;
}

/**
 * Minutes since the last exposure of the primary: the evidence's own
 * `minutesSinceExposure`, shortened by a lesson folded in the log after it
 * (exposure events earlier in time only; a later-dated one is clock skew).
 */
export function effectiveMinutesSinceExposure(ev: Evidence, primary: NodeState | undefined): number {
	if (!primary?.lastExposureAt) return ev.minutesSinceExposure;
	const folded = (toMs(ev.at) - toMs(primary.lastExposureAt)) / MINUTE_MS;
	return folded >= 0 ? Math.min(ev.minutesSinceExposure, folded) : ev.minutesSinceExposure;
}

// ─── validation ──────────────────────────────────────────────────────────────

function validateEvidence(ev: Evidence): void {
	const fail = (msg: string) => {
		throw new LearnerFoldError(`Evidência ${ev.id} inválida: ${msg}`, ev.id);
	};
	if (![0, 1, 2, 3].includes(ev.grade)) fail(`nota fora de 0–3 (${ev.grade}).`);
	if (![1, 2, 3, 4, 5].includes(ev.level)) fail(`nível fora de 1–5 (${ev.level}).`);
	if (!Array.isArray(ev.nodes) || ev.nodes.length === 0) fail("vetor Q vazio.");
	for (const ref of ev.nodes) if (!(ref.q > 0 && ref.q <= 1)) fail(`q fora de (0,1] em ${ref.nodeId} (${ref.q}).`);
	if (!(ev.graderConfidence >= 0 && ev.graderConfidence <= 1)) fail(`graderConfidence fora de [0,1] (${ev.graderConfidence}).`);
	if (!(Number.isInteger(ev.hints) && ev.hints >= 0)) fail(`hints inválido (${ev.hints}).`);
	if (!(ev.minutesSinceExposure >= 0)) fail(`minutesSinceExposure negativo ou ausente (${ev.minutesSinceExposure}).`);
	if (ev.weight !== undefined && !(ev.weight > 0 && Number.isFinite(ev.weight))) fail(`weight deve ser finito e > 0 (${ev.weight}).`);
	for (const a of ev.attributions ?? []) if (!(a.blame >= 0 && a.blame <= 1)) fail(`culpa de atribuição fora de [0,1] em ${a.nodeId}.`);
	try {
		toMs(ev.at, "at");
	} catch (err) {
		fail((err as Error).message);
	}
}

/** Graph-known Q refs, deduplicated (max q, primary OR-ed). */
function knownRefs(ev: Evidence, graph: LearnerGraphView): EvidenceNodeRef[] {
	const byId = new Map<NodeId, EvidenceNodeRef>();
	for (const ref of ev.nodes) {
		if (!graph.nodes.has(ref.nodeId)) continue;
		const prev = byId.get(ref.nodeId);
		const primary = ref.primary === true || prev?.primary === true;
		byId.set(ref.nodeId, { nodeId: ref.nodeId, q: Math.max(ref.q, prev?.q ?? 0), ...(primary ? { primary: true } : {}) });
	}
	return [...byId.values()];
}

// ─── event handlers ──────────────────────────────────────────────────────────

function applyEvidence(work: Work, ev: Evidence, graph: LearnerGraphView, params: LearnerParams): void {
	validateEvidence(ev);
	const refs = knownRefs(ev, graph);
	if (refs.length === 0) return;
	const primaryId = primaryIdOf(ev, graph);
	const at = ev.at;
	const grade = effectiveGrade(ev.grade, ev.hints);
	const success = isSuccessGrade(grade);
	const weight = evidenceWeight(ev);
	const minutesSinceExposure = effectiveMinutesSinceExposure(ev, primaryId ? work.nodes[primaryId] : undefined);
	const em = resolveEmission(params.emission, {
		format: ev.format,
		minutesSinceExposure,
		graderConfidence: ev.graderConfidence,
		...(ev.options !== undefined ? { options: ev.options } : {}),
	});
	const y = em.index(grade);
	const e1y = em.e1[y] as number;
	const e0y = em.e0[y] as number;

	// Q-vector + attribution-only nodes (q = 0).
	const attributionOf = new Map<NodeId, number>();
	for (const a of ev.attributions ?? []) {
		if (graph.nodes.has(a.nodeId)) attributionOf.set(a.nodeId, Math.max(attributionOf.get(a.nodeId) ?? 0, a.blame));
	}
	const qOf = new Map<NodeId, number>(refs.map((r) => [r.nodeId, r.q]));
	if (!success) for (const id of attributionOf.keys()) if (!qOf.has(id)) qOf.set(id, 0);

	const before = new Map<NodeId, { state: NodeState; R: number }>();
	for (const id of qOf.keys()) {
		const state = stateOf(work, graph, params, id);
		before.set(id, { state, R: retrievability(state.fsrs, at, params) });
	}
	const inputs: DinaNodeInput[] = [...qOf].map(([nodeId, q]) => {
		const b = before.get(nodeId) as { state: NodeState; R: number };
		const attribution = attributionOf.get(nodeId);
		return { nodeId, q, pL: b.state.pL, R: b.R, ...(attribution !== undefined ? { attribution } : {}) };
	});
	const results = dinaUpdate(inputs, e1y, e0y, { lambda: params.llmAttributionLambda, weight, failure: !success });
	const T = practiceTransition(params, work.speed);

	for (const r of results) {
		const q = qOf.get(r.nodeId) ?? 0;
		let s = (before.get(r.nodeId) as { state: NodeState }).state;
		s = { ...s, pL: learningTransition(r.posterior, T * q * weight), nEff: s.nEff + weight * q };
		if (q > 0) s.lastEvidenceAt = at;
		if (q >= C.verifyMinQ) s = { ...s, verified: true, inferred: false };
		if (r.blame > 0) s = addBlame(s, r.blame, at, params.blameHalfLifeDays);
		if (!success && r.nodeId !== primaryId && r.blame > 0) s = penalizeDue(s, 1 - r.blame, at);
		put(work, s);
	}

	applyMisconceptionEvidence(work, ev, graph, params, success);
	const primaryBefore = primaryId ? before.get(primaryId) : undefined;
	if (primaryId && primaryBefore) applyPrimaryReview(work, ev, graph, params, primaryId, primaryBefore, grade, success, minutesSinceExposure);

	// Local consistency projection (h ≤ 3).
	const seeds = [...qOf].filter(([, q]) => q > 0).map(([id]) => id);
	projectAround(work, graph, params, seeds);

	// Upward penalty on encompassing nodes after a failure of the primary.
	const primaryBlame = results.find((r) => r.nodeId === primaryId)?.blame ?? 0;
	if (!success && primaryId) {
		for (const p of upwardPenalties(graph, primaryId, primaryBlame, params)) {
			const s = work.nodes[p.nodeId];
			if (!s) continue;
			const next = penalizeDue(s, p.factor, at);
			if (next !== s) put(work, next);
		}
	}
}

function applyMisconceptionEvidence(work: Work, ev: Evidence, graph: LearnerGraphView, params: LearnerParams, success: boolean): void {
	if (!success) {
		for (const a of ev.attributions ?? []) {
			if (!graph.nodes.has(a.nodeId)) continue;
			let s = stateOf(work, graph, params, a.nodeId);
			if (a.misconceptionId) s = observeMisconception(s, a.misconceptionId, a.blame, ev.at);
			if (a.newMisconception) s = proposeMisconception(s, a.newMisconception, a.blame, ev.at).state;
			if (s !== work.nodes[a.nodeId]) put(work, s);
		}
		return;
	}
	for (const d of ev.diagnoses ?? []) {
		const s = work.nodes[d.nodeId];
		if (!s) continue;
		const next = refuteMisconception(s, d.misconceptionId, ev.at);
		if (next !== s) put(work, next);
	}
}

function applyPrimaryReview(
	work: Work,
	ev: Evidence,
	graph: LearnerGraphView,
	params: LearnerParams,
	id: NodeId,
	prior: { state: NodeState; R: number },
	grade: Evidence["grade"],
	success: boolean,
	minutesSinceExposure: number,
): void {
	let s = work.nodes[id] as NodeState;
	const at = ev.at;

	// Elo (prediction from the PRE-observation state).
	const expected = predictCorrect(prior.state.pL * prior.R, ev.level, prior.state.levelElo, work.theta, guessFor(ev.format, ev.options));
	const elo = updateElo(work.theta, work.thetaN, prior.state.levelElo, ev.level, prior.state.nEff, success ? 1 : 0, expected);
	work.theta = elo.theta;
	work.thetaN = elo.thetaN;
	s = { ...s, levelElo: elo.levelElo };

	// One real FSRS review (flashcards keep their own proposition-level schedule).
	if (ev.format !== "flashcard") {
		// Same structural set A as computeSignals (implied credit + milestones), so the card is
		// scheduled with the role retention the planner later checks it against.
		const known = structuralState(work, graph).known;
		const retention = desiredRetentionFor(graph, id, (x) => known.has(x), params);
		const rating = gradeToRating(grade, {
			level: ev.level,
			hints: ev.hints,
			...(ev.latencyMs !== undefined ? { latencyMs: ev.latencyMs } : {}),
			...(ev.selfConfidence !== undefined ? { selfConfidence: ev.selfConfidence } : {}),
			...(medianLatency(s.latency) !== undefined ? { medianLatencyMs: medianLatency(s.latency) as number } : {}),
		});
		s = { ...s, desiredRetention: retention, fsrs: reviewMemory(s.fsrs, cardIdFor(id, s.nodeVersion), rating, at, retention, params) };
		const latency = updateLatency(s.latency, ev.latencyMs);
		if (latency) s.latency = latency;
	}

	if (success && ev.itemFamily !== id + "#self") {
		if (!s.correctFamilies.includes(ev.itemFamily)) s = { ...s, correctFamilies: [...s.correctFamilies, ev.itemFamily] };
		const sinceLastEvidence = prior.state.lastEvidenceAt ? (toMs(at) - toMs(prior.state.lastEvidenceAt)) / MINUTE_MS : Infinity;
		if (ev.hints === 0 && minutesSinceExposure >= C.delayedMinutes && sinceLastEvidence >= C.delayedMinutes) {
			s = { ...s, delayedSuccesses: s.delayedSuccesses + 1 };
			if (!s.independentRecallAt && grade === 3 && ev.graderConfidence > 0.5 && ev.format !== "mcq" && ev.format !== "flashcard" &&
				(prior.state.lastEvidenceAt || prior.state.lastExposureAt)) s.independentRecallAt = at;
		}
		if (ev.summative && !s.demonstratedAt) s = { ...s, demonstratedAt: at };
	}
	put(work, s);
}

function projectAround(work: Work, graph: LearnerGraphView, params: LearnerParams, seeds: readonly NodeId[]): void {
	if (seeds.length === 0 || params.propagationHops === 0) return;
	const scope = neighborhood(graph, seeds, params.propagationHops);
	const values = new Map<NodeId, ProjectionValue>();
	for (const id of scope) {
		const s = work.nodes[id];
		if (s) values.set(id, { p: s.pL, n: s.nEff + 1 });
	}
	const fallback: ProjectionValue = { p: C.priorP, n: C.priorNEff + 1 };
	const result = projectConsistency(values, graph, {
		eps: params.consistencyEps,
		scope,
		maxPasses: C.localPasses,
		tolerance: C.globalTolerance,
		fallback,
	});
	for (const id of result.changed) {
		const v = values.get(id);
		if (!v) continue;
		const s = stateOf(work, graph, params, id);
		if (s.pL === v.p) continue;
		put(work, { ...s, pL: clamp01(v.p), ...(s.verified ? {} : { inferred: true }) });
	}
}

function applyExposure(work: Work, ev: Extract<LearnerEvent, { kind: "exposure" }>, graph: LearnerGraphView, params: LearnerParams): void {
	if (ev.exploratory || !graph.nodes.has(ev.nodeId)) return;
	const s = stateOf(work, graph, params, ev.nodeId);
	const lastExposureAt = s.lastExposureAt && toMs(s.lastExposureAt) > toMs(ev.at) ? s.lastExposureAt : ev.at;
	put(work, { ...s, pL: learningTransition(s.pL, lessonTransition(params, work.speed)), lastExposureAt });
	projectAround(work, graph, params, [ev.nodeId]);
}

function applyImplicitCredit(work: Work, ev: Extract<LearnerEvent, { kind: "implicit-credit" }>, params: LearnerParams): void {
	const s = work.nodes[ev.toNodeId];
	if (!s) return;
	const next = applyCredit(s, ev.w, ev.at, params);
	if (next !== s) put(work, next);
}

function applyDiagnostic(work: Work, ev: Extract<LearnerEvent, { kind: "diagnostic" }>, graph: LearnerGraphView, params: LearnerParams): void {
	for (const est of ev.estimates) {
		if (!graph.nodes.has(est.nodeId) || !Number.isFinite(est.p)) continue;
		const s = stateOf(work, graph, params, est.nodeId);
		if (s.verified) continue;
		const p = clamp01(est.p);
		const next: NodeState = { ...s, pL: p, nEff: Math.max(s.nEff, C.diagnosticNEff), inferred: true };
		if (p >= params.attainThreshold && !s.placedAt) next.placedAt = ev.at;
		put(work, next);
	}
}

function applyNodeVersion(work: Work, ev: Extract<LearnerEvent, { kind: "node-version" }>, params: LearnerParams): void {
	if (!(Number.isInteger(ev.version) && ev.version >= 1)) throw new LearnerFoldError(`Versão de nó inválida em ${ev.id}: ${ev.version}`, ev.id);
	const s = work.nodes[ev.nodeId];
	if (s && ev.version <= s.nodeVersion) return;
	work.nodes[ev.nodeId] = freshNodeState(ev.nodeId, ev.version, params);
	work.touched.delete(ev.nodeId);
}

function applyEvent(work: Work, ev: LearnerEvent, graph: LearnerGraphView, params: LearnerParams): void {
	switch (ev.kind) {
		case "evidence":
			applyEvidence(work, ev.evidence, graph, params);
			break;
		case "lesson-finished":
			break; // Closing a lesson adds no evidence of mastery.
		case "exposure":
			applyExposure(work, ev, graph, params);
			break;
		case "implicit-credit":
			applyImplicitCredit(work, ev, params);
			break;
		case "diagnostic":
			applyDiagnostic(work, ev, graph, params);
			break;
		case "node-version":
			applyNodeVersion(work, ev, params);
			break;
		default: {
			const unknown: never = ev;
			throw new LearnerFoldError(`Evento desconhecido: ${JSON.stringify(unknown)}`);
		}
	}
}

// ─── public fold ─────────────────────────────────────────────────────────────

/** Envelope checks (seq, instant) before ordering, so a bad log fails with a LearnerFoldError. */
function assertEnvelope(ev: LearnerEvent): void {
	const id = eventId(ev);
	const seq = eventSeq(ev);
	if (!Number.isInteger(seq) || seq < 0) throw new LearnerFoldError(`seq inválido em ${id}: ${seq}`, id);
	const at = eventAt(ev);
	if (!Number.isFinite(Date.parse(at))) throw new LearnerFoldError(`Instante inválido em ${id}: "${at}"`, id);
}

/** Pure replay of `events` on top of `snapshot` (null = empty state of the events' domain). */
export function foldEvents(
	snapshot: LearnerSnapshot | null,
	events: readonly LearnerEvent[],
	graph: LearnerGraphView,
	params: LearnerParams,
): LearnerSnapshot {
	const first = events[0];
	if (!snapshot && !first) throw new LearnerFoldError("foldEvents sem snapshot e sem eventos: domínio indefinido.");
	for (const ev of events) assertEnvelope(ev);
	const base = snapshot ?? emptySnapshot(eventDomain(first as LearnerEvent), eventAt(first as LearnerEvent));
	if (base.schemaVersion !== 1) throw new LearnerFoldError(`schemaVersion não suportada: ${String(base.schemaVersion)}`);
	const work: Work = {
		domainId: base.domainId,
		seq: base.seq,
		nodes: { ...base.nodes },
		theta: base.theta,
		thetaN: base.thetaN,
		speed: base.speed,
		updatedAt: base.updatedAt,
		touched: new Set(),
	};
	const ordered = [...events].sort(compareEvents);
	for (const ev of ordered) {
		if (eventDomain(ev) !== work.domainId) {
			throw new LearnerFoldError(`Evento ${eventId(ev)} pertence a ${eventDomain(ev)}, não a ${work.domainId}.`, eventId(ev));
		}
		const seq = eventSeq(ev);
		const at = eventAt(ev);
		if (snapshot && seq <= snapshot.seq) continue;
		work.touched = new Set();
		applyEvent(work, ev, graph, params);
		for (const id of work.touched) {
			const s = work.nodes[id];
			if (s) work.nodes[id] = withMonotoneFlags(s, at, params);
		}
		work.seq = Math.max(work.seq, seq);
		if (toMs(at) > toMs(work.updatedAt)) work.updatedAt = at;
	}
	return {
		schemaVersion: 1,
		domainId: work.domainId,
		seq: work.seq,
		nodes: work.nodes,
		theta: work.theta,
		thetaN: work.thetaN,
		speed: work.speed,
		updatedAt: work.updatedAt,
	};
}

export interface IngestResult {
	snapshot: LearnerSnapshot;
	/** Derived `implicit-credit` events to append right after the ingested event. */
	derived: LearnerEvent[];
	/** Credits computed in FIRe "shadow" mode (audit only, never applied). */
	shadow: CreditRecord[];
}

/**
 * Fold one NEW event and derive its FIRe credits (r2 §9.6b). The store
 * persists `event` followed by `derived` (their seqs continue after the
 * event's), so a later replay of the log is identical to this result.
 */
export function ingestEvent(snapshot: LearnerSnapshot | null, event: LearnerEvent, graph: LearnerGraphView, params: LearnerParams): IngestResult {
	if (snapshot && eventSeq(event) <= snapshot.seq) return { snapshot, derived: [], shadow: [] };
	const after = foldEvents(snapshot, [event], graph, params);
	if (event.kind !== "evidence" || event.evidence.format === "flashcard") return { snapshot: after, derived: [], shadow: [] };
	const ev = event.evidence;
	const primaryId = primaryIdOf(ev, graph);
	if (!primaryId) return { snapshot: after, derived: [], shadow: [] };
	const refs = knownRefs(ev, graph);
	const derivation = deriveCredits(
		{
			nodeId: primaryId,
			pL: after.nodes[primaryId]?.pL ?? 0,
			coNodes: refs.filter((r) => r.nodeId !== primaryId).map((r) => ({ nodeId: r.nodeId, q: r.q })),
			success: isSuccessGrade(effectiveGrade(ev.grade, ev.hints)),
		},
		(id) => after.nodes[id],
		graph,
		params,
		ev.at,
	);
	const derived: LearnerEvent[] = derivation.credits.map((c, i) => ({
		kind: "implicit-credit",
		id: `${ev.id}:fire:${c.toNodeId}`,
		seq: after.seq + 1 + i,
		at: ev.at,
		domainId: ev.domainId,
		fromNodeId: c.fromNodeId,
		toNodeId: c.toNodeId,
		w: c.w,
	}));
	const final = derived.length > 0 ? foldEvents(after, derived, graph, params) : after;
	return { snapshot: final, derived, shadow: derivation.shadow };
}

/** Fold a batch of NEW events through `ingestEvent`, collecting the derived events. */
export function ingestEvents(
	snapshot: LearnerSnapshot | null,
	events: readonly LearnerEvent[],
	graph: LearnerGraphView,
	params: LearnerParams,
): { snapshot: LearnerSnapshot; log: LearnerEvent[] } {
	let current = snapshot;
	const log: LearnerEvent[] = [];
	let nextSeq = snapshot?.seq ?? 0;
	for (const original of [...events].sort(compareEvents)) {
		const ev = renumber(original, Math.max(eventSeq(original), nextSeq + 1));
		const result = ingestEvent(current, ev, graph, params);
		current = result.snapshot;
		log.push(ev, ...result.derived);
		nextSeq = current.seq;
	}
	if (!current) throw new LearnerFoldError("ingestEvents sem snapshot e sem eventos.");
	return { snapshot: current, log };
}

function renumber(ev: LearnerEvent, seq: number): LearnerEvent {
	if (eventSeq(ev) === seq) return ev;
	return ev.kind === "evidence" ? { kind: "evidence", evidence: { ...ev.evidence, seq } } : ({ ...ev, seq } as LearnerEvent);
}
