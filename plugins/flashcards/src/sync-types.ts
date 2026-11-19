/**
 * Export/sync contracts for Flashcards (Obsidian mirror, AnkiConnect, .apkg).
 *
 * `ExternalLink`, `RevlogEntry` and `SyncCursor` are the canonical shapes of
 * docs/research/00-SINTESE.md §2.3 (plugins/flashcards/src/sync-types.ts — r7), kept
 * field-for-field. The rest is the plugin-local persistence around them, stored in
 * `<dataDirectory>/sync-cursor.json` next to `flashcards.json` (§2.2 layout), so a
 * sync never bumps the review store revision and never snapshots an API key into
 * review records.
 *
 * Anki ids (note, card, revlog) are millisecond-epoch integers: they fit a JS safe
 * integer, so the §2.3 `number` fields hold them exactly (validated on parse).
 */

export interface ExternalLink {
	cueId: string;
	propositionId: string;
	domainId: string;
	anki?: { noteId: number; cardIds: number[]; noteType: string; deck: string; contentHash: string; pushedAt: string; mtime: number };
	obsidian?: { path: string; anchor: string; contentHash: string; writtenAt: string };
}

export interface RevlogEntry {
	id: `app:${string}` | `anki:${number}`;
	propositionId: string;
	cueId: string;
	at: string;
	rating: 1 | 2 | 3 | 4;
	durationMs: number;
	origin: "app" | "anki";
}

export interface SyncCursor {
	ankiLatestRevlogId: number;
	ankiProfile: string;
	apiFlavor: "v1" | "v6";
}

export type ReviewClient = "app" | "anki";
export type AnkiApiFlavor = SyncCursor["apiFlavor"];

/** Anki reviews enter the learner model as weaker evidence (SÍNTESE §2.4(d), r7 §8.4). */
export const ANKI_REVLOG_EVIDENCE_WEIGHT = 0.3;
export const DEFAULT_ANKI_CONNECT_URL = "http://127.0.0.1:8765";

export interface SyncSettings {
	/** Absolute path of the Obsidian vault that receives the one-way mirror. */
	obsidianVaultPath: string | null;
	/** Who schedules reviews: the app (FSRS-7) or Anki (app queue skips Anki-linked cards). */
	reviewClient: ReviewClient;
	/** AnkiConnect base URL; loopback only. */
	ankiConnectUrl: string;
	/** Optional AnkiConnect API key (`apiKey` in AnkiConnect's config). */
	ankiApiKey: string | null;
	/** Domain id override; otherwise inferred from the plugin data path or "default". */
	domainId: string | null;
	/** Human title used for folders and decks; otherwise the domain manifest title or id. */
	domainTitle: string | null;
}

export interface ApkgRecord {
	path: string;
	at: string;
	notes: number;
}

export interface ObsidianFiles {
	/** Real path of the vault these hashes belong to. */
	vaultPath: string;
	/** Vault-relative note path → sha256 of the bytes this exporter last wrote. */
	files: Record<string, string>;
}

export interface SyncState {
	version: 1;
	settings: SyncSettings;
	cursor: SyncCursor | null;
	obsidian: ObsidianFiles | null;
	/** Keyed by cue id. */
	links: Record<string, ExternalLink>;
	/** Imported Anki reviews (app reviews stay in flashcards.json and are mapped on read). */
	revlog: RevlogEntry[];
	/** Anki card ids linked after the cursor was set: the next import reads their whole history. */
	revlogBackfill: number[];
	lastApkg: ApkgRecord | null;
}

export const DOMAIN_ID_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;

export function defaultSyncSettings(): SyncSettings {
	return { obsidianVaultPath: null, reviewClient: "app", ankiConnectUrl: DEFAULT_ANKI_CONNECT_URL, ankiApiKey: null, domainId: null, domainTitle: null };
}

export function createSyncState(settings: Partial<SyncSettings> = {}): SyncState {
	return { version: 1, settings: { ...defaultSyncSettings(), ...settings }, cursor: null, obsidian: null, links: {}, revlog: [], revlogBackfill: [], lastApkg: null };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isAnkiId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const nullableString = (value: unknown): value is string | null => value === null || typeof value === "string";

function invalid(what: string): never {
	throw new Error(`Dados de sincronização inválidos (${what}). Nenhum dado foi alterado.`);
}

function parseSettings(value: unknown): SyncSettings {
	const defaults = defaultSyncSettings();
	if (value === undefined) return defaults;
	if (!isRecord(value)) invalid("settings");
	const merged = { ...defaults, ...value } as Record<string, unknown>;
	if (!nullableString(merged.obsidianVaultPath) || !nullableString(merged.ankiApiKey) || !nullableString(merged.domainId) || !nullableString(merged.domainTitle)) invalid("settings");
	if (merged.reviewClient !== "app" && merged.reviewClient !== "anki") invalid("settings.reviewClient");
	if (!isString(merged.ankiConnectUrl)) invalid("settings.ankiConnectUrl");
	return {
		obsidianVaultPath: merged.obsidianVaultPath,
		reviewClient: merged.reviewClient,
		ankiConnectUrl: merged.ankiConnectUrl,
		ankiApiKey: merged.ankiApiKey,
		domainId: merged.domainId,
		domainTitle: merged.domainTitle,
	};
}

function parseCursor(value: unknown): SyncCursor | null {
	if (value === null || value === undefined) return null;
	if (!isRecord(value) || !(value.ankiLatestRevlogId === 0 || isAnkiId(value.ankiLatestRevlogId)) || !isString(value.ankiProfile) || (value.apiFlavor !== "v1" && value.apiFlavor !== "v6")) invalid("cursor");
	return { ankiLatestRevlogId: value.ankiLatestRevlogId as number, ankiProfile: value.ankiProfile, apiFlavor: value.apiFlavor };
}

function parseLink(key: string, value: unknown): ExternalLink {
	if (!isRecord(value) || value.cueId !== key || !isString(value.propositionId) || !isString(value.domainId)) invalid(`links.${key}`);
	const link: ExternalLink = { cueId: key, propositionId: value.propositionId, domainId: value.domainId };
	const anki = value.anki;
	if (anki !== undefined) {
		if (!isRecord(anki) || !isAnkiId(anki.noteId) || !Array.isArray(anki.cardIds) || !anki.cardIds.every(isAnkiId) || !isString(anki.noteType) || !isString(anki.deck)
			|| !isString(anki.contentHash) || !isString(anki.pushedAt) || typeof anki.mtime !== "number") invalid(`links.${key}.anki`);
		link.anki = { noteId: anki.noteId, cardIds: [...anki.cardIds as number[]], noteType: anki.noteType, deck: anki.deck, contentHash: anki.contentHash, pushedAt: anki.pushedAt, mtime: anki.mtime };
	}
	const obsidian = value.obsidian;
	if (obsidian !== undefined) {
		if (!isRecord(obsidian) || !isString(obsidian.path) || !isString(obsidian.anchor) || !isString(obsidian.contentHash) || !isString(obsidian.writtenAt)) invalid(`links.${key}.obsidian`);
		link.obsidian = { path: obsidian.path, anchor: obsidian.anchor, contentHash: obsidian.contentHash, writtenAt: obsidian.writtenAt };
	}
	return link;
}

function parseRevlog(value: unknown): RevlogEntry {
	if (!isRecord(value) || !isString(value.id) || !/^(app:.+|anki:[1-9]\d*)$/.test(value.id) || !isString(value.propositionId) || !isString(value.cueId)
		|| !isString(value.at) || Number.isNaN(Date.parse(value.at)) || ![1, 2, 3, 4].includes(value.rating as number)
		|| typeof value.durationMs !== "number" || value.durationMs < 0 || (value.origin !== "app" && value.origin !== "anki")) invalid("revlog");
	return {
		id: value.id as RevlogEntry["id"],
		propositionId: value.propositionId,
		cueId: value.cueId,
		at: value.at,
		rating: value.rating as RevlogEntry["rating"],
		durationMs: value.durationMs,
		origin: value.origin,
	};
}

function parseObsidianFiles(value: unknown): ObsidianFiles | null {
	if (value === null || value === undefined) return null;
	if (!isRecord(value) || !isString(value.vaultPath) || !isRecord(value.files) || !Object.values(value.files).every(isString)) invalid("obsidian");
	return { vaultPath: value.vaultPath, files: { ...value.files as Record<string, string> } };
}

/** Validates a persisted sync state; throws a pt-BR error instead of guessing. */
export function parseSyncState(value: unknown): SyncState {
	if (!isRecord(value) || value.version !== 1) invalid("versão");
	if (!isRecord(value.links ?? {}) || !Array.isArray(value.revlog ?? [])) invalid("estrutura");
	const links: Record<string, ExternalLink> = {};
	for (const [key, link] of Object.entries((value.links ?? {}) as Record<string, unknown>)) links[key] = parseLink(key, link);
	const apkg = value.lastApkg;
	if (apkg !== undefined && apkg !== null && (!isRecord(apkg) || !isString(apkg.path) || !isString(apkg.at) || typeof apkg.notes !== "number")) invalid("lastApkg");
	const backfill = value.revlogBackfill ?? [];
	if (!Array.isArray(backfill) || !backfill.every(isAnkiId)) invalid("revlogBackfill");
	return {
		version: 1,
		settings: parseSettings(value.settings),
		cursor: parseCursor(value.cursor),
		obsidian: parseObsidianFiles(value.obsidian),
		links,
		revlog: ((value.revlog ?? []) as unknown[]).map(parseRevlog),
		revlogBackfill: [...backfill as number[]],
		lastApkg: apkg ? { path: apkg.path as string, at: apkg.at as string, notes: apkg.notes as number } : null,
	};
}

/** Accepts only literal loopback hosts: AnkiConnect must never be reached over the network. */
export function normalizeAnkiConnectUrl(value: string): string {
	let url: URL;
	try { url = new URL(value); } catch { throw new Error("URL do AnkiConnect inválida."); }
	if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
		throw new Error("O AnkiConnect precisa estar em http://127.0.0.1, http://localhost ou http://[::1].");
	}
	if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
		throw new Error("Informe só o endereço base do AnkiConnect (ex.: http://127.0.0.1:8765).");
	}
	return url.origin;
}

const SYNC_SETTING_KEYS = new Set<keyof SyncSettings>(["obsidianVaultPath", "reviewClient", "ankiConnectUrl", "ankiApiKey", "domainId", "domainTitle"]);

/**
 * Validates a settings patch (pure: the vault path is only checked for shape here;
 * the backend checks that the directory exists).
 */
export function applySyncSettingsPatch(current: SyncSettings, patch: Record<string, unknown>): SyncSettings {
	for (const key of Object.keys(patch)) if (!SYNC_SETTING_KEYS.has(key as keyof SyncSettings)) throw new Error(`Configuração não suportada: ${key}`);
	const next: SyncSettings = { ...current };
	const text = (key: string, value: unknown): string | null => {
		if (value === null) return null;
		if (typeof value !== "string") throw new Error(`Valor inválido para ${key}.`);
		const trimmed = value.trim();
		return trimmed ? trimmed : null;
	};
	if ("obsidianVaultPath" in patch) next.obsidianVaultPath = text("obsidianVaultPath", patch.obsidianVaultPath);
	if ("reviewClient" in patch) {
		if (patch.reviewClient !== "app" && patch.reviewClient !== "anki") throw new Error('O modo de revisão deve ser "app" ou "anki".');
		next.reviewClient = patch.reviewClient;
	}
	if ("ankiConnectUrl" in patch) next.ankiConnectUrl = normalizeAnkiConnectUrl(text("ankiConnectUrl", patch.ankiConnectUrl) ?? DEFAULT_ANKI_CONNECT_URL);
	if ("ankiApiKey" in patch) next.ankiApiKey = text("ankiApiKey", patch.ankiApiKey);
	if ("domainId" in patch) {
		const id = text("domainId", patch.domainId);
		if (id !== null && !DOMAIN_ID_PATTERN.test(id)) throw new Error("Id de domínio inválido (use letras minúsculas, dígitos e hífen; 2–40 caracteres).");
		next.domainId = id;
	}
	if ("domainTitle" in patch) {
		const title = text("domainTitle", patch.domainTitle);
		if (title !== null && title.length > 120) throw new Error("O título do domínio deve ter no máximo 120 caracteres.");
		next.domainTitle = title;
	}
	return next;
}
