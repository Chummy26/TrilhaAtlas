/**
 * HashEmbedder — deterministic, model-free embedder (feature hashing of
 * accent-folded words + character 3-grams, FNV-1a, signed buckets,
 * L2-normalised). Used by tests and benchmarks (task: "recall p50 < 200 ms
 * com 5k mensagens usando o hash-embedder") and as the offline fallback when
 * the local model cannot be loaded (r4 §7.2 risk: model download blocked).
 *
 * It is a lexical similarity, not a semantic one: paraphrases that share no
 * word stems will not meet. The id carries the dimension so switching to the
 * real model (or another dim) triggers re-embedding in MemoryDb.
 */

import { wordTokens } from "../../core/memory/lexical.ts";
import { l2Normalize } from "../../core/memory/vector.ts";
import type { Embedder } from "../../core/memory/types.ts";

export const HASH_EMBEDDER_DIM = 384;
const WORD_WEIGHT = 1;
const GRAM_WEIGHT = 0.5;

/** 32-bit FNV-1a over UTF-16 code units. */
export function fnv1a(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

function addFeature(vec: Float32Array, feature: string, weight: number): void {
	const h = fnv1a(feature);
	const index = h % vec.length;
	const sign = (h >>> 31) === 1 ? -1 : 1;
	vec[index] = (vec[index] as number) + sign * weight;
}

/** Hash one text into a unit vector (zero vector for text without words). */
export function hashEmbed(text: string, dim = HASH_EMBEDDER_DIM): Float32Array {
	const vec = new Float32Array(dim);
	for (const word of wordTokens(text)) {
		addFeature(vec, `w:${word}`, WORD_WEIGHT);
		const padded = `^${word}$`;
		for (let i = 0; i + 3 <= padded.length; i++) addFeature(vec, `g:${padded.slice(i, i + 3)}`, GRAM_WEIGHT);
	}
	return l2Normalize(vec);
}

export class HashEmbedder implements Embedder {
	readonly id: string;
	readonly dim: number;

	constructor(dim = HASH_EMBEDDER_DIM) {
		if (!Number.isInteger(dim) || dim < 8) throw new RangeError(`dimensão inválida para o hash-embedder: ${dim}`);
		this.dim = dim;
		this.id = `hash-ngram-v1/${dim}`;
	}

	/** Symmetric: queries and passages share one feature space, so `kind` does not change the vector. */
	async embed(texts: readonly string[], _kind: "query" | "passage" = "passage"): Promise<Float32Array[]> {
		return texts.map((t) => hashEmbed(t, this.dim));
	}
}
