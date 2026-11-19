/**
 * Canonical on-disk layout of the workspace and its study domains
 * (docs/research/00-SINTESE.md §2.2 "Persistência: workspace e domínios").
 *
 *   <root>/                              root = LH_DATA_DIR
 *     profile/ settings.json credentials.enc active-domain.json profile.db
 *              stats/usage-YYYY-MM.jsonl stats/activity-YYYY-MM.jsonl
 *              model-cache/
 *     library/<sha256>/                  shared user library (PDF/EPUB)
 *     domains/<domainId>/                one isolated study world
 *       domain.json profile.json chats/ jobs/ graph/ curriculum/ learner/
 *       memory/ resources/ progress/ plugins/flashcards/ prompts/
 *
 * Every function is pure and browser-safe: it only builds strings from the
 * root it receives (no node:path, no I/O). The separator follows the root:
 * a root containing "\" joins with "\", any other root joins with "/".
 * Domain ids are validated with DOMAIN_ID_PATTERN, so no id can climb out of
 * `domains/` ("..", separators and absolute paths are all rejected).
 *
 * Windows portability (the desktop app's main target): Windows device names
 * (con, prn, aux, nul, com0–9, lpt0–9) are refused as domain ids, and path
 * segments may not contain characters Windows forbids in file names
 * (`<>:"|?*`, control characters; ":" would address an NTFS alternate data
 * stream) nor end in "." or " " (Windows strips them, so "chats." would alias
 * "chats").
 *
 * Decision (ambiguity in §2.2): the learner-chosen DomainProfile lives in
 * `domains/<id>/profile.json`, beside domain.json; `learner/profile.json`
 * stays reserved for the learner model.
 */

import { isDomainId, type DomainId } from "./types.ts";

/** Folders created inside every domain by ensureDomain (relative, "/"-separated). */
export const DOMAIN_SUBDIRS = [
	"chats",
	"jobs",
	"graph",
	"curriculum",
	"learner",
	"memory",
	"resources",
	"progress",
	"plugins/flashcards",
	"prompts",
] as const;

export type DomainSubdir = (typeof DOMAIN_SUBDIRS)[number];

/** Workspace-level folders (relative to the root, "/"-separated). */
export const WORKSPACE_SUBDIRS = ["profile", "profile/stats", "profile/model-cache", "library", "domains"] as const;

export class DomainPathError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DomainPathError";
	}
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
/** Windows device names: a folder named like this is unusable on Windows. */
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
/** Characters Windows forbids in a file name (plus "\", our separator guard). */
const WINDOWS_FORBIDDEN_CHARS = /[<>:"|?*\\\u0000-\u001f]/;

/** True for names Windows reserves for devices ("con", "nul", "com1", …), with or without an extension. */
export function isWindowsDeviceName(name: string): boolean {
	return WINDOWS_DEVICE_NAME.test(name.split(".")[0] ?? "");
}

// ─── joining ─────────────────────────────────────────────────────────────────

function separatorOf(root: string): "\\" | "/" {
	return root.includes("\\") ? "\\" : "/";
}

function isUnsafeSegment(part: string): boolean {
	return (
		part === "" ||
		part === "." ||
		part === ".." ||
		WINDOWS_FORBIDDEN_CHARS.test(part) ||
		part.endsWith(".") ||
		part.endsWith(" ") ||
		isWindowsDeviceName(part)
	);
}

/** Join `root` with relative "/"-separated segments using the root's separator. */
export function joinUnder(root: string, ...segments: string[]): string {
	if (typeof root !== "string" || root.trim() === "") throw new DomainPathError("A raiz de dados (LH_DATA_DIR) não pode ser vazia.");
	const sep = separatorOf(root);
	const parts = segments.flatMap((s) => s.split("/"));
	for (const part of parts) {
		if (isUnsafeSegment(part)) {
			throw new DomainPathError(`Segmento de caminho inválido: "${describeSegment(part)}".`);
		}
	}
	const base = root.replace(/[\\/]+$/, "");
	return parts.length === 0 ? root : `${base}${sep}${parts.join(sep)}`;
}

function describeSegment(part: string): string {
	return part === "" ? "(vazio)" : part;
}

/** isDomainId plus the Windows device-name rule: the ids a domain folder may use. */
export function isUsableDomainId(value: unknown): value is DomainId {
	return isDomainId(value) && !isWindowsDeviceName(value);
}

function assertDomainId(id: DomainId): void {
	if (!isDomainId(id)) {
		throw new DomainPathError(`Id de domínio inválido: "${String(id)}". Use letras minúsculas, dígitos e hífen (2–40 caracteres, começando por letra).`);
	}
	if (isWindowsDeviceName(id)) {
		throw new DomainPathError(`Id de domínio reservado pelo Windows: "${id}". Escolha outro nome.`);
	}
}

// ─── workspace ───────────────────────────────────────────────────────────────

export function profileDir(root: string): string {
	return joinUnder(root, "profile");
}

export function settingsFile(root: string): string {
	return joinUnder(root, "profile", "settings.json");
}

export function credentialsFile(root: string): string {
	return joinUnder(root, "profile", "credentials.enc");
}

export function activeDomainFile(root: string): string {
	return joinUnder(root, "profile", "active-domain.json");
}

export function profileDbFile(root: string): string {
	return joinUnder(root, "profile", "profile.db");
}

export function statsDir(root: string): string {
	return joinUnder(root, "profile", "stats");
}

export function modelCacheDir(root: string): string {
	return joinUnder(root, "profile", "model-cache");
}

function assertMonth(month: string): void {
	if (!MONTH_PATTERN.test(month)) throw new DomainPathError(`Mês inválido: "${month}" (esperado AAAA-MM).`);
}

/** `profile/stats/usage-YYYY-MM.jsonl` (one UsageEvent per line). */
export function usageLogFile(root: string, month: string): string {
	assertMonth(month);
	return joinUnder(root, "profile", "stats", `usage-${month}.jsonl`);
}

/** `profile/stats/activity-YYYY-MM.jsonl` (one heartbeat ActivityEvent per line). */
export function activityLogFile(root: string, month: string): string {
	assertMonth(month);
	return joinUnder(root, "profile", "stats", `activity-${month}.jsonl`);
}

export function libraryDir(root: string): string {
	return joinUnder(root, "library");
}

/** `library/<sha256>/`: one user-owned book, shared by every domain. */
export function libraryItemDir(root: string, sha256: string): string {
	if (!SHA256_PATTERN.test(sha256)) throw new DomainPathError(`Hash de biblioteca inválido: "${sha256}" (esperado sha256 hexadecimal minúsculo).`);
	return joinUnder(root, "library", sha256);
}

export function domainsDir(root: string): string {
	return joinUnder(root, "domains");
}

/** `domains/.trash/`: removed domains, recoverable by hand. Never listed (".trash" is not a DomainId). */
export function domainsTrashDir(root: string): string {
	return joinUnder(root, "domains", ".trash");
}

// ─── one domain ──────────────────────────────────────────────────────────────

export function domainDir(root: string, id: DomainId): string {
	assertDomainId(id);
	return joinUnder(root, "domains", id);
}

/** Any path inside one domain; `relative` is "/"-separated and may not climb out. */
export function domainPath(root: string, id: DomainId, relative: string): string {
	assertDomainId(id);
	return joinUnder(root, "domains", id, relative);
}

export function domainManifestFile(root: string, id: DomainId): string {
	return domainPath(root, id, "domain.json");
}

export function domainProfileFile(root: string, id: DomainId): string {
	return domainPath(root, id, "profile.json");
}

export function chatsDir(root: string, id: DomainId): string {
	return domainPath(root, id, "chats");
}

export function jobsDir(root: string, id: DomainId): string {
	return domainPath(root, id, "jobs");
}

export function graphDir(root: string, id: DomainId): string {
	return domainPath(root, id, "graph");
}

export function curriculumDir(root: string, id: DomainId): string {
	return domainPath(root, id, "curriculum");
}

export function learnerDir(root: string, id: DomainId): string {
	return domainPath(root, id, "learner");
}

export function memoryDir(root: string, id: DomainId): string {
	return domainPath(root, id, "memory");
}

export function memoryDbFile(root: string, id: DomainId): string {
	return domainPath(root, id, "memory/memory.db");
}

export function resourcesDir(root: string, id: DomainId): string {
	return domainPath(root, id, "resources");
}

export function progressDir(root: string, id: DomainId): string {
	return domainPath(root, id, "progress");
}

export function pluginsDir(root: string, id: DomainId): string {
	return domainPath(root, id, "plugins");
}

export function flashcardsDir(root: string, id: DomainId): string {
	return domainPath(root, id, "plugins/flashcards");
}

export function promptsDir(root: string, id: DomainId): string {
	return domainPath(root, id, "prompts");
}

/** Absolute paths of every folder ensureDomain creates for `id`. */
export function domainTree(root: string, id: DomainId): string[] {
	return [domainDir(root, id), ...DOMAIN_SUBDIRS.map((sub) => domainPath(root, id, sub))];
}

/** Absolute paths of the workspace-level folders. */
export function workspaceTree(root: string): string[] {
	return WORKSPACE_SUBDIRS.map((sub) => joinUnder(root, sub));
}
