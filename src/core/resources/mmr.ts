/**
 * Maximal Marginal Relevance re-ranking (SÍNTESE §2.8 "seguido de MMR λ=0,7";
 * r6 §7.5 step 2).
 *
 *   next = argmax_{r ∉ S}  λ·score(r) − (1−λ)·max_{s ∈ S} sim(r, s)
 *
 * `sim` is the cosine between transcript-summary embeddings plus a 0,3 penalty
 * when two videos come from the same channel (clamped to [0,1]); without
 * embeddings only the channel term applies. Greedy, O(k·n) similarity calls.
 * Ties keep the input order (stable), so λ = 1 reproduces a stable sort by score.
 *
 * Pure: browser-safe.
 */

export const DEFAULT_MMR_LAMBDA = 0.7;
export const SAME_CHANNEL_PENALTY = 0.3;

export interface MmrCandidate<T> {
	item: T;
	score: number;
}

export interface MmrPick<T> extends MmrCandidate<T> {
	/** λ·score − (1−λ)·maxSim at the moment it was picked. */
	marginal: number;
}

/** Greedy MMR selection of up to `k` items (default: all). */
export function mmr<T>(candidates: readonly MmrCandidate<T>[], sim: (a: T, b: T) => number, lambda = DEFAULT_MMR_LAMBDA, k = candidates.length): MmrPick<T>[] {
	if (!(lambda >= 0 && lambda <= 1)) throw new Error(`mmr: λ precisa estar em [0,1] (recebido ${lambda})`);
	const remaining = candidates.map((c, index) => ({ ...c, index }));
	const chosen: MmrPick<T>[] = [];
	const limit = Math.max(0, Math.min(k, candidates.length));
	// maxSim[i] = max similarity of remaining[i] to anything chosen so far.
	const maxSim = new Map<number, number>();
	while (chosen.length < limit && remaining.length > 0) {
		let bestPos = 0;
		let bestValue = -Infinity;
		for (let pos = 0; pos < remaining.length; pos++) {
			const cand = remaining[pos]!;
			const penalty = chosen.length === 0 ? 0 : (maxSim.get(cand.index) ?? 0);
			const value = lambda * cand.score - (1 - lambda) * penalty;
			if (value > bestValue) {
				bestValue = value;
				bestPos = pos;
			}
		}
		const [picked] = remaining.splice(bestPos, 1);
		if (!picked) break;
		chosen.push({ item: picked.item, score: picked.score, marginal: bestValue });
		for (const cand of remaining) {
			const s = sim(cand.item, picked.item);
			const prev = maxSim.get(cand.index) ?? 0;
			if (s > prev) maxSim.set(cand.index, s);
		}
	}
	return chosen;
}

/** Cosine similarity of two equal-length vectors (0 for empty/zero vectors). */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
	if (a.length !== b.length) throw new Error(`cosine: dimensões diferentes (${a.length} ≠ ${b.length})`);
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < a.length; i++) {
		const x = a[i]!;
		const y = b[i]!;
		dot += x * y;
		na += x * x;
		nb += y * y;
	}
	if (na === 0 || nb === 0) return 0;
	return dot / Math.sqrt(na * nb);
}

export interface SimilarityFeatures {
	channelId?: string;
	embedding?: ArrayLike<number>;
}

/** r6 §7.5: max(cos, 0) + 0,3 if same channel, clamped to [0,1]. */
export function channelAwareSimilarity(a: SimilarityFeatures, b: SimilarityFeatures): number {
	const cos = a.embedding && b.embedding && a.embedding.length === b.embedding.length ? Math.max(0, cosine(a.embedding, b.embedding)) : 0;
	const same = a.channelId !== undefined && a.channelId === b.channelId ? SAME_CHANNEL_PENALTY : 0;
	return Math.min(1, cos + same);
}
