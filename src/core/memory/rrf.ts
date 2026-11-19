/**
 * Rank fusion for the multichannel recall (r4 §7.6.4 step 3; L15; Hindsight
 * `fusion.py::reciprocal_rank_fusion` [extra-vectorize-io__hindsight.md §5.5]).
 *
 *   RRF: s(d) = Σ_c w_c / (k + rank_c(d)),  k = 60, rank 1-based.
 *   RSF: s(d) = Σ_c w_c · (x_c(d) − min_c) / (max_c − min_c)   (CPersona;
 *        preserves the magnitude of a very precise channel such as BM25).
 *
 * Determinism: contributions are summed in canonical channel order (not input
 * order), duplicate ids inside one list count once (first rank), and ties
 * break on best rank then id — so permuting the input lists never changes the
 * output. Channel names must be unique.
 */

import { MemoryError, RECALL_CHANNELS } from "./types.ts";

export const RRF_K = 60;

export interface RankedList {
	channel: string;
	/** Best first. */
	ids: readonly string[];
	weight?: number;
	/** Raw channel scores aligned with `ids` (higher = better); required for RSF. */
	scores?: readonly number[];
}

export interface FusedItem {
	id: string;
	score: number;
	/** Channels that retrieved the item, canonical order. */
	channels: string[];
	/** Best 1-based rank over all channels. */
	bestRank: number;
}

const CHANNEL_ORDER = new Map<string, number>(RECALL_CHANNELS.map((c, i) => [c, i]));

function compareChannels(a: string, b: string): number {
	const ia = CHANNEL_ORDER.get(a) ?? Number.MAX_SAFE_INTEGER;
	const ib = CHANNEL_ORDER.get(b) ?? Number.MAX_SAFE_INTEGER;
	if (ia !== ib) return ia - ib;
	return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalLists(lists: readonly RankedList[]): RankedList[] {
	const names = new Set<string>();
	for (const l of lists) {
		if (names.has(l.channel)) throw new MemoryError("invalid-input", `canal duplicado na fusão: ${l.channel}`);
		names.add(l.channel);
	}
	return [...lists].sort((a, b) => compareChannels(a.channel, b.channel));
}

function finish(acc: Map<string, { score: number; channels: string[]; bestRank: number }>): FusedItem[] {
	return [...acc]
		.map(([id, v]) => ({ id, score: v.score, channels: v.channels, bestRank: v.bestRank }))
		.sort((a, b) => b.score - a.score || a.bestRank - b.bestRank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function reciprocalRankFusion(lists: readonly RankedList[], k = RRF_K): FusedItem[] {
	if (!(k > 0)) throw new MemoryError("invalid-input", `k da RRF deve ser > 0 (recebido ${k})`);
	const acc = new Map<string, { score: number; channels: string[]; bestRank: number }>();
	for (const list of canonicalLists(lists)) {
		const w = list.weight ?? 1;
		const seen = new Set<string>();
		list.ids.forEach((id, index) => {
			if (seen.has(id)) return;
			seen.add(id);
			const rank = index + 1;
			const cur = acc.get(id) ?? { score: 0, channels: [], bestRank: Number.POSITIVE_INFINITY };
			cur.score += w / (k + rank);
			cur.channels.push(list.channel);
			cur.bestRank = Math.min(cur.bestRank, rank);
			acc.set(id, cur);
		});
	}
	return finish(acc);
}

export function relativeScoreFusion(lists: readonly RankedList[]): FusedItem[] {
	const acc = new Map<string, { score: number; channels: string[]; bestRank: number }>();
	for (const list of canonicalLists(lists)) {
		const scores = list.scores;
		if (!scores || scores.length !== list.ids.length) {
			throw new MemoryError("invalid-input", `RSF exige scores alinhados aos ids no canal ${list.channel}`);
		}
		const w = list.weight ?? 1;
		let min = Number.POSITIVE_INFINITY;
		let max = Number.NEGATIVE_INFINITY;
		for (const s of scores) {
			if (s < min) min = s;
			if (s > max) max = s;
		}
		const span = max - min;
		const seen = new Set<string>();
		list.ids.forEach((id, index) => {
			if (seen.has(id)) return;
			seen.add(id);
			const raw = scores[index] as number;
			const norm = span > 0 ? (raw - min) / span : 1;
			const cur = acc.get(id) ?? { score: 0, channels: [], bestRank: Number.POSITIVE_INFINITY };
			cur.score += w * norm;
			cur.channels.push(list.channel);
			cur.bestRank = Math.min(cur.bestRank, index + 1);
			acc.set(id, cur);
		});
	}
	return finish(acc);
}
