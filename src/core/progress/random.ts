/**
 * Seeded randomness shared by the Monte Carlo (./simulate.ts) and the opt-in
 * simulated cohort (./cohort.ts) (docs/research/00-SINTESE.md §2.11; r7
 * Appendix A uses mulberry32; mathua §9.3 asks for "seed per week").
 *
 * mulberry32 is tiny, fast and good enough for simulation (not for secrets).
 * `deriveSeed` gives every learner / week its own independent stream, so
 * results never depend on evaluation order.
 *
 * Pure: browser-safe.
 */

/** mulberry32 uniform generator on [0, 1). */
export function mulberry32(seed: number): () => number {
	let state = seed | 0;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** FNV-1a mix of a base seed with labels/indices → a 32-bit stream seed. */
export function deriveSeed(base: number, ...parts: readonly (number | string)[]): number {
	let hash = 0x811c9dc5 ^ (base | 0);
	for (const part of parts) {
		const text = `|${part}`;
		for (let i = 0; i < text.length; i++) {
			hash ^= text.charCodeAt(i);
			hash = Math.imul(hash, 0x01000193);
		}
	}
	return hash >>> 0;
}

/** Distribution helpers over a uniform source. */
export class SimRng {
	constructor(private readonly uniform: () => number) {}
	static seeded(seed: number): SimRng {
		return new SimRng(mulberry32(seed));
	}
	next(): number {
		return this.uniform();
	}
	between(lo: number, hi: number): number {
		return lo + (hi - lo) * this.uniform();
	}
	/** Standard normal (Box–Muller). */
	normal(): number {
		let u = 0;
		let v = 0;
		while (u === 0) u = this.uniform();
		while (v === 0) v = this.uniform();
		return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
	}
	/** Log-normal with MEAN 1 and log-sd `sigma`. */
	lognormalMean1(sigma: number): number {
		return Math.exp(-(sigma * sigma) / 2 + sigma * this.normal());
	}
}
