/**
 * Spreading activation for the recall `graph` channel (r4 §7.6.4 step 2:
 * "A(v,0)=1 p/ nós/ents, =cos p/ fatos; A(u,t+1)=max A(v,t)·w(v,u)·δ·µ(rel),
 * δ=0.5, 2 hops"; §7.8: curriculum edges with µ = 1.0 and 1 hop).
 *
 * Keys are typed strings: `node:<id>`, `entity:<id>`, `fact:<id>`,
 * `episode:<id>`, `observation:<id>`. Raw messages are not part of the
 * memory graph (r4 §7.4 edges connect fact/entity/episode/node only): they
 * are reached by the vec/fts/time channels.
 *
 * µ(rel) < 1/δ for every relation, so activation strictly decreases with
 * each hop and the result is bounded by the strongest seed.
 */

export type EdgeRel =
	| "mentions"
	| "about"
	| "evidence_for"
	| "evidence_against"
	| "temporal"
	| "semantic"
	| "causes"
	| "enables"
	| "prevents"
	| "refines"
	| "supersedes"
	| "same_as"
	| "part_of"
	| "curriculum";

export const ACTIVATION_DECAY = 0.5;
export const GRAPH_HOPS = 2;

export const REL_MU: Readonly<Record<EdgeRel, number>> = {
	about: 1.5,
	evidence_for: 1.5,
	evidence_against: 1.5,
	causes: 1.3,
	enables: 1.3,
	prevents: 1.3,
	mentions: 1.2,
	refines: 1.0,
	supersedes: 1.0,
	same_as: 1.0,
	part_of: 1.0,
	curriculum: 1.0,
	temporal: 0.8,
	semantic: 0.7,
};

export interface GraphEdge {
	to: string;
	rel: EdgeRel;
	/** Edge weight in [0,1]. */
	weight: number;
}

export interface SpreadOptions {
	hops?: number;
	decay?: number;
	/** Activations below this are not propagated further. */
	minActivation?: number;
}

/** Max-product spreading activation from `seeds`; returns every activated key (seeds included). */
export function spreadActivation(
	seeds: ReadonlyMap<string, number>,
	neighbors: (key: string) => readonly GraphEdge[],
	options: SpreadOptions = {},
): Map<string, number> {
	const hops = options.hops ?? GRAPH_HOPS;
	const decay = options.decay ?? ACTIVATION_DECAY;
	const floor = options.minActivation ?? 0.01;
	const activation = new Map<string, number>();
	for (const [k, a] of seeds) if (a > 0) activation.set(k, Math.max(a, activation.get(k) ?? 0));
	let frontier = new Map(activation);
	for (let hop = 0; hop < hops && frontier.size > 0; hop++) {
		const next = new Map<string, number>();
		for (const [key, a] of frontier) {
			if (a < floor) continue;
			for (const edge of neighbors(key)) {
				const w = Math.min(1, Math.max(0, edge.weight));
				const value = a * w * decay * (REL_MU[edge.rel] ?? 1);
				if (value <= (activation.get(edge.to) ?? 0) || value <= (next.get(edge.to) ?? 0)) continue;
				next.set(edge.to, value);
			}
		}
		for (const [k, v] of next) activation.set(k, v);
		frontier = next;
	}
	return activation;
}

/** Temporal edge weight between facts of one session: exp(−Δt/σ), σ = 1 day (r4 §7.6.2-3). */
export function temporalEdgeWeight(deltaMs: number, sigmaMs = 86_400_000): number {
	return Math.exp(-Math.abs(deltaMs) / sigmaMs);
}
