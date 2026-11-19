/**
 * Small numeric/time helpers shared by the learner model (r2 §9). Pure and
 * browser-safe: no Node APIs, no wall clock — every function receives the
 * instant it needs.
 *
 * The PRNG (mulberry32 seeded through FNV-1a) is the deterministic random
 * source of the particle-filter diagnostic (r2 §9.7) and of the planner's
 * load simulation (r2 §9.9): the same seed always yields the same stream.
 */

export const DAY_MS = 86_400_000;
export const MINUTE_MS = 60_000;

export function clamp(value: number, lo: number, hi: number): number {
	return value < lo ? lo : value > hi ? hi : value;
}

export function clamp01(value: number): number {
	if (Number.isNaN(value)) return 0;
	return clamp(value, 0, 1);
}

export function logit(p: number): number {
	const q = clamp(p, 1e-9, 1 - 1e-9);
	return Math.log(q / (1 - q));
}

export function sigmoid(x: number): number {
	return 1 / (1 + Math.exp(-x));
}

/** Binary entropy in bits (H₂(0) = H₂(1) = 0, H₂(½) = 1). */
export function binaryEntropy(p: number): number {
	if (p <= 0 || p >= 1) return 0;
	return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
}

/** Exponential decay factor after `elapsedDays` with the given half-life. */
export function halfLifeFactor(elapsedDays: number, halfLifeDays: number): number {
	if (elapsedDays <= 0) return 1;
	return Math.pow(2, -elapsedDays / halfLifeDays);
}

/** Parse an ISO instant; throws a clear error when it is not a valid date. */
export function toMs(iso: string, what = "instant"): number {
	const ms = Date.parse(iso);
	if (!Number.isFinite(ms)) throw new RangeError(`Invalid ${what}: "${iso}" is not an ISO date.`);
	return ms;
}

export function toIso(ms: number): string {
	return new Date(Math.round(ms)).toISOString();
}

/** Non-negative days from `fromIso` to `toIsoStr` (0 if reversed or missing). */
export function daysBetween(fromIso: string | undefined, to: string): number {
	if (!fromIso) return 0;
	return Math.max(0, (toMs(to) - toMs(fromIso)) / DAY_MS);
}

/** Round to 8 decimals (ts-fsrs stores memory state with this precision). */
export function round8(value: number): number {
	return Math.round(value * 1e8) / 1e8;
}

/** FNV-1a 32-bit hash of a string (deterministic seeds and ids). */
export function fnv1a32(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/** One mulberry32 step: returns the next state and a uniform in [0, 1). */
export function mulberry32Next(state: number): { state: number; value: number } {
	const next = (state + 0x6d2b79f5) >>> 0;
	let t = next;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return { state: next, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

/** Mutable PRNG wrapper for local loops (the state can be read back for persistence). */
export class Rng {
	state: number;
	constructor(seed: number | string) {
		this.state = typeof seed === "number" ? seed >>> 0 : fnv1a32(seed);
	}
	next(): number {
		const step = mulberry32Next(this.state);
		this.state = step.state;
		return step.value;
	}
	/** Standard normal via Box–Muller. */
	normal(): number {
		const u1 = Math.max(this.next(), 1e-12);
		const u2 = this.next();
		return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
	}
	int(maxExclusive: number): number {
		return Math.floor(this.next() * maxExclusive);
	}
}

/** Stable string compare by code units (never localeCompare: locale-independent order). */
export function compareIds(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
