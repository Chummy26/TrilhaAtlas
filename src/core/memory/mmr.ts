/**
 * Maximal Marginal Relevance (r4 §7.6.4 step 7: λ = 0.7, redundancy = cosine
 * between items; MemOS local plugin uses the same λ).
 *
 *   pick argmax_d  λ·rel(d) − (1−λ)·max_{s∈S} sim(d, s)
 *
 * rel = score / max score (∈ [0,1]). sim = cosine of vectors when both items
 * have one, else Jaccard of token sets, else 0. Ties break on higher relevance
 * then id, so the output is a deterministic function of the input set.
 */

import { cosine } from "./vector.ts";
import { jaccard } from "./lexical.ts";

export const MMR_LAMBDA = 0.7;

export interface MmrCandidate {
	id: string;
	score: number;
	vector?: Float32Array | null;
	tokens?: ReadonlySet<string> | null;
}

export interface MmrOptions {
	lambda?: number;
	limit?: number;
	similarity?: (a: MmrCandidate, b: MmrCandidate) => number;
}

export function defaultSimilarity(a: MmrCandidate, b: MmrCandidate): number {
	if (a.vector && b.vector) return cosine(a.vector, b.vector);
	if (a.tokens && b.tokens) return jaccard(a.tokens, b.tokens);
	return 0;
}

export function mmrRerank<T extends MmrCandidate>(candidates: readonly T[], options: MmrOptions = {}): T[] {
	const lambda = options.lambda ?? MMR_LAMBDA;
	if (!(lambda >= 0 && lambda <= 1)) throw new RangeError(`λ do MMR fora de [0,1]: ${lambda}`);
	const limit = Math.min(options.limit ?? candidates.length, candidates.length);
	const sim = options.similarity ?? defaultSimilarity;
	const maxScore = candidates.reduce((m, c) => Math.max(m, c.score), 0);
	const rel = (c: T) => (maxScore > 0 ? c.score / maxScore : 0);

	const remaining = [...candidates].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	const selected: T[] = [];
	// maxSim[i] = max similarity of remaining[i] to the selected set
	const maxSim = remaining.map(() => Number.NEGATIVE_INFINITY);

	while (selected.length < limit && remaining.length > 0) {
		let bestIndex = 0;
		let bestValue = Number.NEGATIVE_INFINITY;
		for (let i = 0; i < remaining.length; i++) {
			const c = remaining[i] as T;
			const redundancy = selected.length === 0 ? 0 : (maxSim[i] as number);
			const value = lambda * rel(c) - (1 - lambda) * redundancy;
			const best = remaining[bestIndex] as T;
			if (
				value > bestValue + 1e-12 ||
				(Math.abs(value - bestValue) <= 1e-12 && (rel(c) > rel(best) || (rel(c) === rel(best) && c.id < best.id)))
			) {
				bestValue = value;
				bestIndex = i;
			}
		}
		const [picked] = remaining.splice(bestIndex, 1) as [T];
		maxSim.splice(bestIndex, 1);
		selected.push(picked);
		for (let i = 0; i < remaining.length; i++) {
			const s = sim(remaining[i] as T, picked);
			if (s > (maxSim[i] as number)) maxSim[i] = s;
		}
	}
	return selected;
}
