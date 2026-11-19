/**
 * Per-provider request pacing and daily quotas (SÍNTESE §2.8: Open Library
 * 1 req/s, arXiv 1 req/3 s, YouTube search bucket 100/day + 10 000 units/day;
 * r6 §2.3, §9.2, §11.3 "rate.ts: token bucket por host + fila de 1 conexão").
 *
 *  RateGate    a serial queue: ONE request in flight per provider and at
 *              least `minIntervalMs` between consecutive request starts
 *              (arXiv/Crossref demand a single connection; the others are
 *              just polite). Clock and sleep are injectable for tests.
 *  gatedFetch  wraps a ResourceFetch so every call waits for the gate.
 *  DailyQuota  named buckets that reset at midnight in a time zone (YouTube
 *              quotas reset at midnight Pacific Time); optional persistence
 *              through a tiny load/save store so restarts keep the count.
 */

import type { ResourceFetch } from "./safe-fetch.ts";

export interface Clock {
	now(): number;
	sleep(ms: number): Promise<void>;
}

export const SYSTEM_CLOCK: Clock = {
	now: () => Date.now(),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class RateGate {
	readonly minIntervalMs: number;
	private readonly clock: Clock;
	private tail: Promise<void> = Promise.resolve();
	private lastStart = Number.NEGATIVE_INFINITY;

	constructor(minIntervalMs: number, clock: Clock = SYSTEM_CLOCK) {
		if (!(minIntervalMs >= 0)) throw new Error(`RateGate: intervalo inválido (${minIntervalMs}).`);
		this.minIntervalMs = minIntervalMs;
		this.clock = clock;
	}

	/** Run `task` after every earlier task finished and the interval elapsed. */
	schedule<T>(task: () => Promise<T>): Promise<T> {
		const run = this.tail.then(async () => {
			const wait = this.lastStart + this.minIntervalMs - this.clock.now();
			if (wait > 0) await this.clock.sleep(wait);
			this.lastStart = this.clock.now();
			return task();
		});
		this.tail = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}
}

/** A fetch whose every request goes through `gate`. */
export function gatedFetch(fetch: ResourceFetch, gate: RateGate): ResourceFetch {
	return (url, init) => gate.schedule(() => fetch(url, init));
}

export interface QuotaState {
	day: string;
	used: Record<string, number>;
}

export interface QuotaStore {
	load(): QuotaState | undefined;
	save(state: QuotaState): void;
}

/** Calendar day "YYYY-MM-DD" of `epochMs` in `timeZone`. */
export function dayKey(epochMs: number, timeZone: string): string {
	const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(epochMs));
	const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
	return `${get("year")}-${get("month")}-${get("day")}`;
}

export class DailyQuota {
	readonly limits: Readonly<Record<string, number>>;
	private readonly now: () => number;
	private readonly timeZone: string;
	private readonly store?: QuotaStore;
	private state: QuotaState;

	constructor(limits: Record<string, number>, options: { now?: () => number; timeZone?: string; store?: QuotaStore } = {}) {
		this.limits = Object.freeze({ ...limits });
		this.now = options.now ?? Date.now;
		this.timeZone = options.timeZone ?? "America/Los_Angeles";
		this.store = options.store;
		const today = dayKey(this.now(), this.timeZone);
		const loaded = this.store?.load();
		this.state = loaded && loaded.day === today ? { day: today, used: { ...loaded.used } } : { day: today, used: {} };
	}

	private roll(): void {
		const today = dayKey(this.now(), this.timeZone);
		if (this.state.day !== today) this.state = { day: today, used: {} };
	}

	left(bucket: string): number {
		this.roll();
		const limit = this.limits[bucket];
		if (limit === undefined) throw new Error(`DailyQuota: balde desconhecido "${bucket}".`);
		return Math.max(0, limit - (this.state.used[bucket] ?? 0));
	}

	/** Reserve `n` units; false (and nothing consumed) when the bucket cannot afford it. */
	tryConsume(bucket: string, n = 1): boolean {
		if (this.left(bucket) < n) return false;
		this.state.used[bucket] = (this.state.used[bucket] ?? 0) + n;
		this.store?.save({ day: this.state.day, used: { ...this.state.used } });
		return true;
	}

	snapshot(): QuotaState {
		this.roll();
		return { day: this.state.day, used: { ...this.state.used } };
	}
}
