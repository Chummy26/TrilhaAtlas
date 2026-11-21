/**
 * Server-side persistence for THE user settings record (settings-storage
 * wave, 2026-09-19): data/settings.json (config.SETTINGS_FILE), under the
 * LH_DATA_DIR seam — read-modify-write, NOT a ledger. Non-secret product
 * preferences only; secrets stay in auth.json / .env.local.
 *
 * This adapter OWNS the lazy migrations:
 *  1. schema-version bumps (CURRENT_SETTINGS_VERSION) slot in here — the
 *     chain is empty today (v1 is the first shape); pure additions never
 *     bump, so an up-to-date file is always a no-op pass-through.
 *    (The legacy default-settings.json fold died with the chat section —
 *     per-session models, owner 2026-09-28.)
 *
 * Everything off disk is sanitized (core/settings.ts) before it reaches a
 * caller; everything written was already validated by the routes
 * (settings-body.ts) and is sanitized here again — the file can never hold
 * a value that would silently shift a knob.
 */

import fs from "node:fs";
import path from "node:path";
import { SETTINGS_FILE } from "../../config.ts";
import {
	sanitizeUserSettings,
	type UserSettings,
} from "../core/settings.ts";
import type { SettingsStore } from "../core/ports.ts";
import { writeFileAtomicSync } from "./atomic-write.ts";
import { parseFileAccessSettings, type FileAccessSettingsResult } from "../core/file-access.ts";

const FILE_ACCESS_ERROR = "File-access configuration cannot be read reliably. Learner-file access is blocked. Repair File access in Settings → Agent → Tools.";

type SettingsCacheEntry = {
	stamp: string;
	settings: UserSettings | null;
	fileAccess: FileAccessSettingsResult;
};

const SETTINGS_CACHE_KEY = Symbol.for("learnharness.store.settings");
const MAX_SETTINGS_CACHE_ENTRIES = 16;

function settingsCache(): Map<string, SettingsCacheEntry> {
	const g = globalThis as typeof globalThis & { [SETTINGS_CACHE_KEY]?: Map<string, SettingsCacheEntry> };
	return (g[SETTINGS_CACHE_KEY] ??= new Map());
}

function statStamp(stat: fs.BigIntStats): string {
	return `${stat.dev}|${stat.ino}|${stat.ctimeNs}|${stat.mtimeNs}|${stat.size}`;
}

function readCachedEntry(): { ok: true; entry: SettingsCacheEntry } | { ok: false; missing: boolean } {
	const file = path.resolve(SETTINGS_FILE);
	const stat = fs.statSync(/* turbopackIgnore: true */ file, { bigint: true, throwIfNoEntry: false });
	const cache = settingsCache();
	if (!stat) {
		cache.delete(file);
		return { ok: false, missing: true };
	}
	if (!stat.isFile()) {
		cache.delete(file);
		return { ok: false, missing: false };
	}
	const stamp = statStamp(stat);
	const cached = cache.get(file);
	if (cached && cached.stamp === stamp) {
		return { ok: true, entry: cached };
	}
	let raw: string;
	try {
		raw = fs.readFileSync(/* turbopackIgnore: true */ SETTINGS_FILE, "utf-8");
	} catch (error) {
		// Never cache transient/unreadable I/O errors so callers fail closed honestly.
		cache.delete(file);
		return { ok: false, missing: (error as NodeJS.ErrnoException).code === "ENOENT" };
	}
	let parsed: unknown;
	let fileAccess: FileAccessSettingsResult;
	let settings: UserSettings | null = null;
	try {
		parsed = JSON.parse(raw);
		fileAccess = fileAccessFromRecord(parsed);
		const record = sanitizeUserSettings(parsed);
		if (record) {
			if (!fileAccess.ok) {
				// Unrelated section writes carry this safe placeholder, not a dropped
				// malformed policy that would silently restore unrestricted reads.
				record.agent = { ...record.agent, fileAccess: { restricted: true, folders: [] } };
			}
			settings = record;
		}
	} catch {
		fileAccess = { ok: false, error: FILE_ACCESS_ERROR };
		settings = null;
	}
	const entry: SettingsCacheEntry = { stamp, settings, fileAccess };
	if (cache.size >= MAX_SETTINGS_CACHE_ENTRIES && !cache.has(file)) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	cache.set(file, entry);
	return { ok: true, entry };
}

/** Separate strict view: the ordinary settings API keeps its historical
 * null/default behavior, but source access must distinguish absent prefs
 * from existing corrupt/unreadable settings. Never expose raw JSON/errors. */
function fileAccessFromRecord(raw: unknown): FileAccessSettingsResult {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: FILE_ACCESS_ERROR };
	const agent = (raw as Record<string, unknown>).agent;
	if (agent === undefined) return { ok: true, settings: { restricted: false, folders: [] } };
	if (!agent || typeof agent !== "object" || Array.isArray(agent)) return { ok: false, error: FILE_ACCESS_ERROR };
	const value = (agent as Record<string, unknown>).fileAccess;
	if (value === undefined) return { ok: true, settings: { restricted: false, folders: [] } };
	const parsed = parseFileAccessSettings(value);
	if (!parsed.ok || parsed.settings.folders.some((folder) => folder !== "~" && !folder.startsWith("~/") && !path.isAbsolute(folder))) {
		return { ok: false, error: FILE_ACCESS_ERROR };
	}
	return parsed;
}

/** ENOENT from a dangling settings/ancestor symlink is NOT first boot.
 * Find the nearest existing entry and verify its directory is usable. */
function settingsAreAbsent(): boolean {
	let candidate = SETTINGS_FILE;
	for (;;) {
		try { fs.lstatSync(/* turbopackIgnore: true */ candidate); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
			const parent = path.dirname(candidate);
			if (parent === candidate) return false;
			candidate = parent;
			continue;
		}
		if (candidate === SETTINGS_FILE) return false;
		try {
			if (!fs.statSync(/* turbopackIgnore: true */ candidate).isDirectory()) return false;
			fs.accessSync(/* turbopackIgnore: true */ candidate, fs.constants.R_OK | fs.constants.X_OK);
			return true;
		} catch { return false; }
	}
}

export function readFileAccessSettings(): FileAccessSettingsResult {
	const result = readCachedEntry();
	if (!result.ok) {
		return result.missing && settingsAreAbsent()
			? { ok: true, settings: { restricted: false, folders: [] } }
			: { ok: false, error: FILE_ACCESS_ERROR };
	}
	return structuredClone(result.entry.fileAccess);
}

/** The persisted record, or null when none exists (first boot). Runs the
 *  migration chain on every read — cheap: a no-op file check when current. */
export function readSettings(): UserSettings | null {
	const result = readCachedEntry();
	if (!result.ok || !result.entry.settings) return null;
	// Version chain (empty today): a future v2 migration slots in here —
	// `if (record.version > CURRENT_SETTINGS_VERSION) …`. Unknown NEWER
	// versions pass through untouched (the sanitizer preserved unknowns).
	return structuredClone(result.entry.settings);
}

/** Persist the record (sanitized). Returns what was written. */
export function writeSettings(raw: unknown): UserSettings {
	const settings = sanitizeUserSettings(raw);
	if (!settings) throw new Error("settings record must be a JSON object");
	if (!readFileAccessSettings().ok && settings.agent?.fileAccess === undefined) {
		// A whole-file corruption cannot be carried by readSettings (null).
		// Saving another preference repairs it into a BLOCKED policy unless
		// the write explicitly supplies a valid file-access preference.
		settings.agent = { ...settings.agent, fileAccess: { restricted: true, folders: [] } };
	}
	fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
	writeFileAtomicSync(SETTINGS_FILE, JSON.stringify(settings, null, "\t"), { allowInPlaceFallback: true });
	settingsCache().delete(path.resolve(SETTINGS_FILE));
	return settings;
}

/** The typed adapter (core/ports.ts SettingsStore), for the composition root. */
export const settingsStore: SettingsStore = {
	readSettings,
	writeSettings,
};
