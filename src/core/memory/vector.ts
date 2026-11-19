/**
 * Vector math + in-memory brute-force index (r4 §7.2: "BLOB float32 + cosseno
 * em JS até ~100k vetores por domínio"; §7.2.1: vectors are L2-normalised so
 * cosine = dot product).
 *
 * BLOB layout: little-endian float32, explicitly encoded so a database file
 * moves between machines safely.
 */

export function l2Normalize(v: Float32Array): Float32Array {
	let sum = 0;
	for (let i = 0; i < v.length; i++) sum += (v[i] as number) * (v[i] as number);
	if (sum === 0) return v;
	const inv = 1 / Math.sqrt(sum);
	for (let i = 0; i < v.length; i++) v[i] = (v[i] as number) * inv;
	return v;
}

export function dot(a: Float32Array, b: Float32Array): number {
	const n = Math.min(a.length, b.length);
	let s = 0;
	for (let i = 0; i < n; i++) s += (a[i] as number) * (b[i] as number);
	return s;
}

export function cosine(a: Float32Array, b: Float32Array): number {
	let ab = 0;
	let aa = 0;
	let bb = 0;
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i++) {
		const x = a[i] as number;
		const y = b[i] as number;
		ab += x * y;
		aa += x * x;
		bb += y * y;
	}
	if (aa === 0 || bb === 0) return 0;
	return ab / Math.sqrt(aa * bb);
}

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

export function encodeVector(v: Float32Array): Uint8Array {
	if (LITTLE_ENDIAN) return new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
	const out = new Uint8Array(v.length * 4);
	const view = new DataView(out.buffer);
	for (let i = 0; i < v.length; i++) view.setFloat32(i * 4, v[i] as number, true);
	return out;
}

export function decodeVector(bytes: Uint8Array): Float32Array {
	if (bytes.byteLength % 4 !== 0) throw new Error(`vetor corrompido: ${bytes.byteLength} bytes não é múltiplo de 4`);
	if (LITTLE_ENDIAN) return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
	const out = new Float32Array(bytes.byteLength / 4);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
	return out;
}

export interface Scored<T> {
	item: T;
	score: number;
}

/** Top-k by descending score; ties keep input order (stable, deterministic). */
export function topK<T>(items: Iterable<T>, k: number, score: (item: T) => number): Scored<T>[] {
	if (k <= 0) return [];
	const best: Scored<T>[] = [];
	for (const item of items) {
		const s = score(item);
		if (!Number.isFinite(s)) continue;
		if (best.length === k && s <= (best[best.length - 1] as Scored<T>).score) continue;
		// binary insertion after equal scores (stability)
		let lo = 0;
		let hi = best.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if ((best[mid] as Scored<T>).score >= s) lo = mid + 1;
			else hi = mid;
		}
		best.splice(lo, 0, { item, score: s });
		if (best.length > k) best.pop();
	}
	return best;
}

export interface IndexedVector {
	key: string;
	vec: Float32Array;
}

/** Brute-force cosine index keyed by `${kind}:${id}` (vectors stored normalised). */
export class VectorIndex {
	readonly dim: number;
	private readonly entries = new Map<string, Float32Array>();

	constructor(dim: number) {
		this.dim = dim;
	}

	get size(): number {
		return this.entries.size;
	}

	set(key: string, vec: Float32Array): void {
		if (vec.length !== this.dim) throw new Error(`dimensão ${vec.length} ≠ ${this.dim} no índice vetorial`);
		this.entries.set(key, l2Normalize(new Float32Array(vec)));
	}

	get(key: string): Float32Array | undefined {
		return this.entries.get(key);
	}

	has(key: string): boolean {
		return this.entries.has(key);
	}

	delete(key: string): void {
		this.entries.delete(key);
	}

	clear(): void {
		this.entries.clear();
	}

	/** Top-k keys by cosine to `query` (normalised internally). */
	search(query: Float32Array, k: number, filter?: (key: string) => boolean): Scored<string>[] {
		if (query.length !== this.dim) throw new Error(`consulta com dimensão ${query.length} ≠ ${this.dim}`);
		const q = l2Normalize(new Float32Array(query));
		const it = filter ? [...this.entries].filter(([key]) => filter(key)) : this.entries;
		return topK(it, k, ([, vec]) => dot(q, vec)).map(({ item, score }) => ({ item: item[0], score }));
	}
}
