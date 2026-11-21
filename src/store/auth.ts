/**
 * The AuthStore adapter (auth-keys wave, 2026-09-19): the flat {VAR: value}
 * auth.json map at config.AUTH_FILE — the SAME file the Electron app has
 * always hand-edited (owner decision: option A — same file, env-located,
 * zero migration). 0600, atomic writes, hand-edits keep working (the file
 * is re-read from disk on every access).
 *
 * The server (src/server/keys.ts) is the only intended writer: it applies
 * shape validation before setAuthVar and env precedence on top of
 * authVars(). Ordinary reads never throw (absent/corrupt file = {} =
 * "no keys yet"); custom-only pair reads/writes below are deliberately
 * strict so an unreadable private record is never overwritten as {}.
 * Ordinary writes preserve unknown string vars verbatim
 * (forward-compat: future entries — e.g. a plans-login token — ride along
 * untouched until a catalog entry adopts them).
 */

import fs from "node:fs";
import path from "node:path";
import { AUTH_FILE } from "../../config.ts";
import type { AuthStore } from "../core/ports.ts";
import { CUSTOM_PROVIDER } from "../core/auth-keys.ts";
import { CUSTOM_AUTH_BINDING, parseCustomAuthBinding, type CustomAuthBinding } from "../core/custom-provider-auth.ts";
import { writeFileAtomicSync } from "./atomic-write.ts";

type CustomCacheResult =
	| { ok: true; map: Record<string, unknown>; binding: CustomAuthBinding | undefined }
	| { ok: false; error: string };

type AuthCacheEntry = {
	stamp: string;
	vars: Record<string, string>;
	custom: CustomCacheResult;
};

const AUTH_CACHE_KEY = Symbol.for("learnharness.store.auth");
const MAX_AUTH_CACHE_ENTRIES = 16;

function authCache(): Map<string, AuthCacheEntry> {
	const g = globalThis as typeof globalThis & { [AUTH_CACHE_KEY]?: Map<string, AuthCacheEntry> };
	return (g[AUTH_CACHE_KEY] ??= new Map());
}

function authStatStamp(stat: fs.BigIntStats): string {
	return `${stat.dev}|${stat.ino}|${stat.ctimeNs}|${stat.mtimeNs}|${stat.size}`;
}

function parseCustomRecord(raw: unknown): CustomCacheResult {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return { ok: false, error: "Custom authorization storage unavailable" };
	}
	const map = raw as Record<string, unknown>;
	const binding = parseCustomAuthBinding(map[CUSTOM_AUTH_BINDING]);
	if (Object.hasOwn(map, CUSTOM_AUTH_BINDING) && !binding) {
		return { ok: false, error: "Invalid custom authorization record" };
	}
	if (Object.hasOwn(map, CUSTOM_PROVIDER.envVar) && typeof map[CUSTOM_PROVIDER.envVar] !== "string") {
		return { ok: false, error: "Invalid custom credential record" };
	}
	return { ok: true, map, binding };
}

function loadCachedAuth(): { status: "hit"; entry: AuthCacheEntry } | { status: "missing" } | { status: "error" } {
	const file = path.resolve(AUTH_FILE);
	const cache = authCache();
	const stat = fs.statSync(/* turbopackIgnore: true */ file, { bigint: true, throwIfNoEntry: false });
	if (!stat) {
		cache.delete(file);
		return { status: "missing" };
	}
	if (!stat.isFile()) {
		cache.delete(file);
		return { status: "error" };
	}
	const stamp = authStatStamp(stat);
	const cached = cache.get(file);
	if (cached && cached.stamp === stamp) {
		return { status: "hit", entry: cached };
	}
	let text: string;
	try {
		text = fs.readFileSync(/* turbopackIgnore: true */ AUTH_FILE, "utf-8");
	} catch (error) {
		cache.delete(file);
		return { status: (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "error" };
	}
	let vars: Record<string, string> = {};
	let custom: CustomCacheResult;
	try {
		const raw: unknown = JSON.parse(text);
		if (raw && typeof raw === "object" && !Array.isArray(raw)) {
			vars = Object.fromEntries(
				Object.entries(raw).filter(([, v]) => typeof v === "string") as [string, string][],
			);
		}
		custom = parseCustomRecord(raw);
	} catch {
		vars = {};
		custom = { ok: false, error: "Custom authorization storage unavailable" };
	}
	const entry: AuthCacheEntry = { stamp, vars, custom };
	if (cache.size >= MAX_AUTH_CACHE_ENTRIES && !cache.has(file)) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	cache.set(file, entry);
	return { status: "hit", entry };
}

/** The flat string→string map, or {} for absent/corrupt/non-object. */
function readMap(): Record<string, string> {
	const loaded = loadCachedAuth();
	if (loaded.status !== "hit") return {};
	return { ...loaded.entry.vars };
}

/** Write the map atomically at mode 0600: a partial write must never
 *  leave a 0644 file (secrets) or a truncated JSON (looks like "no keys").
 *  atomic-write.ts sets the mode on the temp file before the rename, so
 *  the mode never exists relaxed on the final path. */
function writeMap(map: Record<string, unknown>): void {
	fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
	writeFileAtomicSync(AUTH_FILE, `${JSON.stringify(map, null, "\t")}\n`, { mode: 0o600 });
	authCache().delete(path.resolve(AUTH_FILE));
}

export const authStore: AuthStore = {
	authVars() {
		return readMap();
	},
	setAuthVar(name, value) {
		assertOrdinaryVar(name);
		const map = readMap();
		map[name] = value;
		writeMap(map);
	},
	deleteAuthVar(name) {
		assertOrdinaryVar(name);
		const map = readMap();
		if (!(name in map)) return; // absent = silent success, idempotent
		delete map[name];
		writeMap(map);
	},
};

/** Custom writes must never turn an unreadable/corrupt private file into {}.
 * Other providers retain their existing adapter semantics. Unknown JSON values
 * survive custom-only updates, not just the ordinary string projection. */
function readCustomMap(): Record<string, unknown> {
	const loaded = loadCachedAuth();
	if (loaded.status === "missing") {
		// Re-check with readFileSync to preserve exact error semantics for dangling symlinks.
		try { fs.readFileSync(/* turbopackIgnore: true */ AUTH_FILE, "utf8"); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
			throw new Error("Custom authorization storage unavailable");
		}
		return {};
	}
	if (loaded.status === "error") throw new Error("Custom authorization storage unavailable");
	if (!loaded.entry.custom.ok) throw new Error(loaded.entry.custom.error);
	return structuredClone(loaded.entry.custom.map);
}
function assertOrdinaryVar(name: string): void {
	if (name === CUSTOM_AUTH_BINDING || name === CUSTOM_PROVIDER.envVar) throw new Error("Use the custom endpoint editor");
}
/** One immutable file snapshot. Keyless callers never invoke fileKey(). */
export function readCustomAuth() {
	const loaded = loadCachedAuth();
	if (loaded.status === "missing") {
		try { fs.readFileSync(/* turbopackIgnore: true */ AUTH_FILE, "utf8"); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return { binding: undefined, fileKey: () => undefined };
			throw new Error("Custom authorization storage unavailable");
		}
		return { binding: undefined, fileKey: () => undefined };
	}
	if (loaded.status === "error") throw new Error("Custom authorization storage unavailable");
	if (!loaded.entry.custom.ok) throw new Error(loaded.entry.custom.error);
	const custom = loaded.entry.custom;
	const binding = custom.binding ? structuredClone(custom.binding) : undefined;
	const key = custom.map[CUSTOM_PROVIDER.envVar] as string | undefined;
	return { binding, fileKey: () => key };
}
/** Replace just the custom pair in ONE existing atomic record write. */
export function writeCustomAuth(binding: CustomAuthBinding | undefined, fileKey: string | undefined): void {
	const map = readCustomMap();
	if (binding && !parseCustomAuthBinding(JSON.stringify(binding))) throw new Error("Invalid custom authorization record");
	if (fileKey === undefined) delete map[CUSTOM_PROVIDER.envVar];
	else Object.defineProperty(map, CUSTOM_PROVIDER.envVar, { value: fileKey, enumerable: true, configurable: true, writable: true });
	if (binding === undefined) delete map[CUSTOM_AUTH_BINDING];
	else Object.defineProperty(map, CUSTOM_AUTH_BINDING, { value: JSON.stringify(binding), enumerable: true, configurable: true, writable: true });
	writeMap(map);
}
