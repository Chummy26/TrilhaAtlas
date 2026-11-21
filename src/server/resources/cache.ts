/**
 * TTL cache for adapter responses (SÍNTESE §2.8 "Dados da API guardados por
 * no máximo 30 dias", transcripts "TTL 30 d"; r6 §2.5, §8.2, §11.5).
 *
 *  - `MemoryTtlCache`  process-local (tests, short-lived catalogs);
 *  - `FileTtlCache`    one JSON file per key under a directory
 *                      (`<dir>/<sha1(key)>.json` = {key, storedAt, value}),
 *                      written atomically; `purge()` deletes expired entries
 *                      and `clear()` everything — the "apagar dados de
 *                      recursos" button required by the YouTube policies;
 *  - `cached()`        read-through helper.
 * Expired entries are never returned. YouTube API data uses ≤ 30 days.
 *
 * Also: a JSON file QuotaStore for DailyQuota persistence.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { writeFileAtomicSync } from "../../store/atomic-write.ts";
import type { QuotaState, QuotaStore } from "./rate-limit.ts";

export const DAY_MS = 86_400_000;
/** YouTube API data and transcripts: 30 calendar days at most. */
export const YOUTUBE_TTL_MS = 30 * DAY_MS;
/** Open catalogs (OpenStax, LibreTexts, OTL): refreshed weekly. */
export const CATALOG_TTL_MS = 7 * DAY_MS;
/** Bibliographic metadata (Open Library, Crossref, arXiv). */
export const METADATA_TTL_MS = 30 * DAY_MS;

export interface CacheEntry<T> {
	value: T;
	storedAt: number;
}

export interface TtlCache {
	get<T>(key: string, maxAgeMs: number): Promise<T | undefined>;
	set<T>(key: string, value: T): Promise<void>;
	delete(key: string): Promise<void>;
}

export class MemoryTtlCache implements TtlCache {
	private readonly entries = new Map<string, CacheEntry<unknown>>();
	constructor(private readonly now: () => number = Date.now) {}

	async get<T>(key: string, maxAgeMs: number): Promise<T | undefined> {
		const e = this.entries.get(key);
		if (!e) return undefined;
		if (this.now() - e.storedAt > maxAgeMs) {
			this.entries.delete(key);
			return undefined;
		}
		return e.value as T;
	}

	async set<T>(key: string, value: T): Promise<void> {
		this.entries.set(key, { value, storedAt: this.now() });
	}

	async delete(key: string): Promise<void> {
		this.entries.delete(key);
	}

	get size(): number {
		return this.entries.size;
	}
}

function fileNameOf(key: string): string {
	return `${createHash("sha1").update(key).digest("hex")}.json`;
}

export class FileTtlCache implements TtlCache {
	constructor(
		readonly dir: string,
		private readonly now: () => number = Date.now,
	) {}

	private fileOf(key: string): string {
		return path.join(this.dir, fileNameOf(key));
	}

	async get<T>(key: string, maxAgeMs: number): Promise<T | undefined> {
		const file = this.fileOf(key);
		let raw: string;
		try {
			raw = await fs.promises.readFile(file, "utf8");
		} catch {
			return undefined;
		}
		try {
			const parsed = JSON.parse(raw) as { key?: string; storedAt?: number; value?: T };
			if (parsed.key !== key || typeof parsed.storedAt !== "number") return undefined;
			if (this.now() - parsed.storedAt > maxAgeMs) {
				await fs.promises.rm(file, { force: true });
				return undefined;
			}
			return parsed.value;
		} catch {
			await fs.promises.rm(file, { force: true });
			return undefined;
		}
	}

	async set<T>(key: string, value: T): Promise<void> {
		fs.mkdirSync(this.dir, { recursive: true });
		writeFileAtomicSync(this.fileOf(key), JSON.stringify({ key, storedAt: this.now(), value }));
	}

	async delete(key: string): Promise<void> {
		await fs.promises.rm(this.fileOf(key), { force: true });
	}

	/** Cached discoveries are shared by all matching nodes in a domain. */
	async valuesWithPrefix<T>(prefix: string, maxAgeMs: number, accept?: (key: string) => boolean): Promise<T[]> {
		let files: string[];
		try { files = await fs.promises.readdir(this.dir); }
		catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
		const jsonFiles = files.filter((f) => f.endsWith(".json"));
		if (jsonFiles.length === 0) return [];
		const nowMs = this.now();
		const loaded = await Promise.all(jsonFiles.map(async (file): Promise<{ hit: true; value: T } | { hit: false }> => {
			try {
				const entry = JSON.parse(await fs.promises.readFile(path.join(this.dir, file), "utf8")) as { key: string; storedAt: number; value: T };
				if (nowMs - entry.storedAt <= maxAgeMs && entry.key.startsWith(prefix) && (!accept || accept(entry.key))) {
					return { hit: true, value: entry.value };
				}
			} catch { /* unreadable/corrupt cache entry skipped */ }
			return { hit: false };
		}));
		const result: T[] = [];
		for (const item of loaded) {
			if (item.hit) result.push(item.value);
		}
		return result;
	}

	/** Delete entries older than `maxAgeMs`; returns how many were removed. */
	async purge(maxAgeMs: number): Promise<number> {
		let names: string[];
		try {
			names = await fs.promises.readdir(this.dir);
		} catch {
			return 0;
		}
		let removed = 0;
		for (const name of names.filter((n) => n.endsWith(".json"))) {
			const file = path.join(this.dir, name);
			try {
				const parsed = JSON.parse(await fs.promises.readFile(file, "utf8")) as { storedAt?: number };
				if (typeof parsed.storedAt === "number" && this.now() - parsed.storedAt <= maxAgeMs) continue;
			} catch {
				// Unreadable entries are dropped too.
			}
			await fs.promises.rm(file, { force: true });
			removed++;
		}
		return removed;
	}

	/** Remove every cached entry (user-requested data deletion). */
	async clear(): Promise<void> {
		await fs.promises.rm(this.dir, { recursive: true, force: true });
	}
}

/** Read-through: return the cached value or produce, store and return it. */
export async function cached<T>(cache: TtlCache | undefined, key: string, maxAgeMs: number, produce: () => Promise<T>): Promise<T> {
	if (cache) {
		const hit = await cache.get<T>(key, maxAgeMs);
		if (hit !== undefined) return hit;
	}
	const value = await produce();
	if (cache) await cache.set(key, value);
	return value;
}

/** DailyQuota persistence in one JSON file. */
export function jsonFileQuotaStore(file: string): QuotaStore {
	return {
		load() {
			try {
				const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as QuotaState;
				if (typeof parsed.day === "string" && parsed.used && typeof parsed.used === "object") return parsed;
			} catch {
				// Missing or corrupt: start fresh.
			}
			return undefined;
		},
		save(state) {
			fs.mkdirSync(path.dirname(file), { recursive: true });
			writeFileAtomicSync(file, JSON.stringify(state));
		},
	};
}
