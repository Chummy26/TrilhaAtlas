/**
 * Multi-node items: DINA mean-field blame attribution (r2 §9.5; SÍNTESE §2.6
 * "culpa para baixo (DINA mean-field)").
 *
 * Item with Q-vector {(k, q_k)}: q_k = P(k is really needed). Requirement k is
 * satisfied with π_k = q_k·p_k·R_k + (1 − q_k); η_{−k} = Π_{j≠k} π_j.
 *
 *   P(ŷ | K_k=1) = η_{−k}·ẽ1 + (1 − η_{−k})·ẽ0
 *   P(ŷ | K_k=0) = (1 − q_k)·[η_{−k}·ẽ1 + (1 − η_{−k})·ẽ0] + q_k·ẽ0
 *   P(L_k=1 | ŷ) = p_k·[R_k·P1 + (1 − R_k)·P0] / (p_k·R_k·P1 + (1 − p_k·R_k)·P0)
 *   blame b_k    = max(0, P(K_k=0 | ŷ) − P(K_k=0))  — the weakest link gets more.
 *
 * LLM attribution (only on failures, ŷ ≤ 1): the likelihood of K_k = 0 is
 * multiplied by (1 + λ·c_k), λ = 1.5 ⇒ likelihood ratio ≤ 2.5 (the grader is
 * noisy). A node attributed but absent from the Q-vector enters with q = 0, so
 * ONLY the attribution moves it.
 *
 * With a single node and q = 1, η_{−k} = 1 and everything reduces to §9.4.
 * Evidence weight w tempers the likelihoods (·)^w, like bkt-fsrs.ts.
 */

import { clamp01 } from "./math.ts";
import type { NodeId } from "./types.ts";

export interface DinaNodeInput {
	nodeId: NodeId;
	/** Q-vector entry in [0, 1] (0 = only attributed). */
	q: number;
	pL: number;
	R: number;
	/** LLM blame c ∈ [0, 1] (applied only when `failure`). */
	attribution?: number;
}

export interface DinaNodeResult {
	nodeId: NodeId;
	/** P(L_k = 1 | ŷ) before any learning transition. */
	posterior: number;
	/** P(K_k = 0) before observing. */
	pNotKnowPrior: number;
	/** P(K_k = 0 | ŷ). */
	pNotKnowPost: number;
	/** max(0, P(K_k=0 | ŷ) − P(K_k=0)). */
	blame: number;
}

export interface DinaOptions {
	/** λ of the LLM attribution factor (1 + λ·c). */
	lambda: number;
	/** Evidence weight (likelihood tempering). Default 1. */
	weight?: number;
	/** Observation is a failure (ŷ ≤ 1): attributions apply only then. */
	failure: boolean;
}

/** Products of π excluding each index, without division (prefix · suffix). */
export function leaveOneOutProducts(values: readonly number[]): number[] {
	const n = values.length;
	const prefix = new Array<number>(n + 1).fill(1);
	const suffix = new Array<number>(n + 1).fill(1);
	for (let i = 0; i < n; i++) prefix[i + 1] = (prefix[i] as number) * (values[i] as number);
	for (let i = n - 1; i >= 0; i--) suffix[i] = (suffix[i + 1] as number) * (values[i] as number);
	return values.map((_, i) => (prefix[i] as number) * (suffix[i + 1] as number));
}

/** Mean-field DINA update for every node of an item (r2 §9.5). */
export function dinaUpdate(nodes: readonly DinaNodeInput[], e1y: number, e0y: number, opts: DinaOptions): DinaNodeResult[] {
	const w = opts.weight === undefined ? 1 : Math.max(0, opts.weight);
	const pis = nodes.map((n) => {
		const q = clamp01(n.q);
		return q * clamp01(n.pL) * clamp01(n.R) + (1 - q);
	});
	const etaMinus = leaveOneOutProducts(pis);
	return nodes.map((node, i) => {
		const q = clamp01(node.q);
		const p = clamp01(node.pL);
		const R = clamp01(node.R);
		const eta = etaMinus[i] as number;
		const mix = eta * e1y + (1 - eta) * e0y;
		const pY1 = mix;
		let pY0 = (1 - q) * mix + q * e0y;
		const c = clamp01(node.attribution ?? 0);
		if (opts.failure && c > 0) pY0 *= 1 + Math.max(0, opts.lambda) * c;
		const l1 = Math.pow(Math.max(0, R * pY1 + (1 - R) * pY0), w);
		const l0 = Math.pow(Math.max(0, pY0), w);
		const pK = p * R;
		const den = p * l1 + (1 - p) * l0;
		const posterior = den > 0 ? clamp01((p * l1) / den) : p;
		const k1 = Math.pow(Math.max(0, pY1), w);
		const kDen = pK * k1 + (1 - pK) * l0;
		const pNotKnowPost = kDen > 0 ? clamp01(((1 - pK) * l0) / kDen) : 1 - pK;
		return {
			nodeId: node.nodeId,
			posterior,
			pNotKnowPrior: 1 - pK,
			pNotKnowPost,
			blame: Math.max(0, pNotKnowPost - (1 - pK)),
		};
	});
}

/** Primary node of a Q-vector: the one flagged `primary`, else the largest q (first on ties). */
export function primaryNodeOf<T extends { nodeId: NodeId; q: number; primary?: boolean }>(refs: readonly T[]): T | undefined {
	const flagged = refs.find((r) => r.primary === true);
	if (flagged) return flagged;
	let best: T | undefined;
	for (const r of refs) if (!best || r.q > best.q) best = r;
	return best;
}
