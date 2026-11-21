/**
 * File adapter for study domains (docs/research/00-SINTESE.md §2.2
 * "Persistência: workspace e domínios", §2.3 DomainManifest; M1).
 *
 *   <root>/profile/active-domain.json      { domainId, updatedAt }
 *   <root>/domains/<id>/domain.json        DomainManifest
 *   <root>/domains/<id>/profile.json       DomainProfile (learner choices)
 *   <root>/domains/<id>/{chats,jobs,…}/    tree created by ensureDomain
 *   <root>/domains/.trash/<id>-<stamp>/    removed domains (recoverable)
 *
 * Isolation: every operation takes ONE domain id and only builds paths
 * under `domains/<id>/` (core/domains/paths.ts rejects ids that could climb
 * out). The only reads that span domains are workspace-level: listDomains
 * reads each domain.json, and creating a domain checks that its nodePrefix
 * is not taken (node ids must stay unambiguous for external_ref). Nothing
 * here ever writes outside the domain it was called for.
 *
 * Validation: manifests and profiles go through the zod schemas on read and
 * write; a broken hand-edited file throws DomainManifestError with every
 * issue (listDomains reports it in `problems` instead of failing the list).
 *
 * Decisions (ambiguities in §2.2):
 *  - removeDomain MOVES the folder to `domains/.trash/` instead of deleting:
 *    a domain holds months of learner data and the move is one rename on
 *    the same volume. The active domain cannot be removed.
 *  - getActiveDomain returns null when the file is missing, malformed, or
 *    names a domain without a valid domain.json; the server decides the
 *    fallback (first listed domain).
 *  - Timestamps come from an injectable clock (tests are deterministic).
 *  - ensureDomain validates EVERYTHING it will write (manifest, profile,
 *    node prefix) before creating a folder: a refused creation leaves no
 *    half-made domain behind.
 *  - JSON files hand-edited on Windows may start with a UTF-8 BOM; it is
 *    stripped before parsing. Listings order custom domains by the instant
 *    of `createdAt` (offsets may differ), then by id.
 */

import fs from "node:fs";
import path from "node:path";
import { builtinManifest, BUILTIN_DOMAIN_IDS, defaultDomainProfile } from "../core/domains/defaults.ts";
import { checkDomainManifest, DomainManifestError, parseDomainManifest, parseDomainProfile } from "../core/domains/manifest-schema.ts";
import {
	activeDomainFile,
	domainDir,
	domainManifestFile,
	domainProfileFile,
	domainsDir,
	domainsTrashDir,
	domainTree,
	workspaceTree,
} from "../core/domains/paths.ts";
import { isDomainId, type DomainId, type DomainManifest, type DomainProfile, type DomainSummary } from "../core/domains/types.ts";
import { writeFileAtomicSync } from "./atomic-write.ts";

export type DomainStoreErrorCode = "not-found" | "exists" | "id-mismatch" | "prefix-taken" | "no-manifest" | "active";

export class DomainStoreError extends Error {
	readonly code: DomainStoreErrorCode;
	constructor(code: DomainStoreErrorCode, message: string) {
		super(message);
		this.name = "DomainStoreError";
		this.code = code;
	}
}

export interface DomainProblem {
	/** Folder name under domains/. */
	id: string;
	issues: string[];
}

export interface DomainScan {
	manifests: DomainManifest[];
	problems: DomainProblem[];
}

export interface EnsureDomainOptions {
	/** Manifest for a NEW custom domain; built-ins default to their manifest. Ignored when the domain exists. */
	manifest?: DomainManifest;
	/** Profile written when the domain has none yet (default: defaultDomainProfile). */
	profile?: DomainProfile;
}

export interface DomainsStore {
	readonly root: string;
	/** Create the workspace folders (profile/, profile/stats, library/, domains/…). */
	ensureWorkspace(): void;
	/** Idempotent: create the folder tree, domain.json and profile.json when missing; returns the manifest on disk. */
	ensureDomain(id: DomainId, options?: EnsureDomainOptions): DomainManifest;
	/** ensureDomain for every built-in domain (english, electronics). */
	seedBuiltinDomains(): DomainManifest[];
	/** True when domains/<id>/domain.json exists. */
	hasDomain(id: DomainId): boolean;
	/** The manifest, or null when the domain does not exist. Throws DomainManifestError when it is invalid. */
	readManifest(id: DomainId): DomainManifest | null;
	/** Replace an existing domain's manifest (validated; the id cannot change). */
	writeManifest(manifest: DomainManifest): DomainManifest;
	updateManifest(id: DomainId, update: (current: DomainManifest) => DomainManifest): DomainManifest;
	/** The profile, or null when none was written. Throws DomainManifestError when it is invalid. */
	readProfile(id: DomainId): DomainProfile | null;
	writeProfile(profile: DomainProfile): DomainProfile;
	updateProfile(id: DomainId, update: (current: DomainProfile) => DomainProfile): DomainProfile;
	/** Valid domains, built-ins first, then by creation time and id. */
	listDomains(): DomainSummary[];
	/** Every domain folder: valid manifests and the problems of invalid ones. */
	scanDomains(): DomainScan;
	getActiveDomain(): DomainId | null;
	setActiveDomain(id: DomainId): void;
	/** Move domains/<id> to domains/.trash/; returns the new folder. Refuses the active domain. */
	removeDomain(id: DomainId): string;
}

export interface DomainsStoreOptions {
	/** Clock for createdAt/updatedAt stamps (default: system clock). */
	now?: () => Date;
}

// ─── file helpers ────────────────────────────────────────────────────────────

/** Hand edits on Windows (Notepad, PowerShell 5 `Out-File`) may prepend a UTF-8 BOM, which JSON.parse rejects. */
function stripBom(text: string): string {
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function readJsonIfExists(file: string): { found: false } | { found: true; value: unknown } {
	let text: string;
	try {
		text = fs.readFileSync(file, "utf-8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { found: false };
		throw error;
	}
	try {
		return { found: true, value: JSON.parse(stripBom(text)) };
	} catch (error) {
		const reason = `JSON malformado (${(error as Error).message})`;
		throw new DomainManifestError(`${path.basename(file)} inválido: ${reason}`, [reason]);
	}
}

function writeJson(file: string, value: unknown): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	writeFileAtomicSync(file, `${JSON.stringify(value, null, "\t")}\n`);
}

function exists(file: string): boolean {
	return fs.existsSync(file);
}

function compareStrings(a: string, b: string): number {
	return a === b ? 0 : a < b ? -1 : 1;
}

/** Chronological order of ISO stamps that may carry different offsets ("…-03:00" vs "…Z"). */
function compareInstants(a: string, b: string): number {
	const diff = Date.parse(a) - Date.parse(b);
	return Number.isFinite(diff) ? Math.sign(diff) : compareStrings(a, b);
}

function builtinIndex(id: string): number {
	const index = (BUILTIN_DOMAIN_IDS as readonly string[]).indexOf(id);
	return index >= 0 ? index : BUILTIN_DOMAIN_IDS.length;
}

function summaryOf(manifest: DomainManifest, activeId: DomainId | null): DomainSummary {
	return { id: manifest.id, title: { ...manifest.title }, accent: manifest.accent, icon: manifest.icon, active: manifest.id === activeId };
}

function trashStamp(now: Date): string {
	return now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

// ─── stat-backed global cache ────────────────────────────────────────────────

type DomainsCacheState = {
	manifests: Map<string, { stamp: string; id: DomainId; manifest: DomainManifest }>;
	profiles: Map<string, { stamp: string; id: DomainId; profile: DomainProfile }>;
};

const DOMAINS_CACHE_KEY = Symbol.for("learnharness.store.domains");
const MAX_DOMAINS_CACHE_ENTRIES = 256;

function domainsCache(): DomainsCacheState {
	const g = globalThis as typeof globalThis & { [DOMAINS_CACHE_KEY]?: DomainsCacheState };
	return (g[DOMAINS_CACHE_KEY] ??= { manifests: new Map(), profiles: new Map() });
}

function statStamp(file: string): { found: false } | { found: true; isFile: boolean; stamp: string } {
	const stat = fs.statSync(/* turbopackIgnore: true */ file, { bigint: true, throwIfNoEntry: false });
	if (!stat) return { found: false };
	return {
		found: true,
		isFile: stat.isFile(),
		stamp: `${stat.dev}|${stat.ino}|${stat.ctimeNs}|${stat.mtimeNs}|${stat.size}`,
	};
}

function setBounded<K, V>(map: Map<K, V>, key: K, value: V): void {
	if (map.size >= MAX_DOMAINS_CACHE_ENTRIES && !map.has(key)) {
		const oldest = map.keys().next().value;
		if (oldest !== undefined) map.delete(oldest);
	}
	map.set(key, value);
}

// ─── store ───────────────────────────────────────────────────────────────────

/** Domains store rooted at `root` (= LH_DATA_DIR). */
export function createDomainsStore(root: string, options: DomainsStoreOptions = {}): DomainsStore {
	const clock = options.now ?? (() => new Date());
	const nowIso = () => clock().toISOString();
	domainsDir(root); // validates the root eagerly

	function readManifest(id: DomainId): DomainManifest | null {
		const file = path.resolve(domainManifestFile(root, id));
		const cache = domainsCache().manifests;
		const st = statStamp(file);
		if (!st.found) {
			cache.delete(file);
			return null;
		}
		if (st.isFile) {
			const cached = cache.get(file);
			if (cached && cached.stamp === st.stamp && cached.id === id) {
				return structuredClone(cached.manifest);
			}
		}
		const read = readJsonIfExists(file);
		if (!read.found) {
			cache.delete(file);
			return null;
		}
		const manifest = parseDomainManifest(read.value, `domains/${id}/domain.json`);
		if (manifest.id !== id) {
			throw new DomainStoreError("id-mismatch", `domains/${id}/domain.json declara o id "${manifest.id}"; o id deve ser igual ao nome da pasta.`);
		}
		if (st.isFile) setBounded(cache, file, { stamp: st.stamp, id, manifest });
		return structuredClone(manifest);
	}

	function requireManifest(id: DomainId): DomainManifest {
		const manifest = readManifest(id);
		if (!manifest) throw new DomainStoreError("not-found", `O domínio "${id}" não existe.`);
		return manifest;
	}

	function readProfile(id: DomainId): DomainProfile | null {
		const file = path.resolve(domainProfileFile(root, id));
		const cache = domainsCache().profiles;
		const st = statStamp(file);
		if (!st.found) {
			cache.delete(file);
			return null;
		}
		if (st.isFile) {
			const cached = cache.get(file);
			if (cached && cached.stamp === st.stamp && cached.id === id) {
				return structuredClone(cached.profile);
			}
		}
		const read = readJsonIfExists(file);
		if (!read.found) {
			cache.delete(file);
			return null;
		}
		const profile = parseDomainProfile(read.value, `domains/${id}/profile.json`);
		if (profile.domainId !== id) {
			throw new DomainStoreError("id-mismatch", `domains/${id}/profile.json pertence ao domínio "${profile.domainId}".`);
		}
		if (st.isFile) setBounded(cache, file, { stamp: st.stamp, id, profile });
		return structuredClone(profile);
	}

	function scanDomains(): DomainScan {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(domainsDir(root), { withFileTypes: true });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return { manifests: [], problems: [] };
			throw error;
		}
		const cache = domainsCache().manifests;
		const manifests: DomainManifest[] = [];
		const problems: DomainProblem[] = [];
		for (const entry of entries) {
			if (!entry.isDirectory() || !isDomainId(entry.name)) continue;
			const id = entry.name;
			const file = path.resolve(domainManifestFile(root, id));
			const st = statStamp(file);
			if (!st.found) {
				cache.delete(file);
				problems.push({ id, issues: ["domain.json ausente"] });
				continue;
			}
			if (st.isFile) {
				const cached = cache.get(file);
				if (cached && cached.stamp === st.stamp && cached.id === id) {
					manifests.push(structuredClone(cached.manifest));
					continue;
				}
			}
			let read: ReturnType<typeof readJsonIfExists>;
			try {
				read = readJsonIfExists(file);
			} catch (error) {
				problems.push({ id, issues: error instanceof DomainManifestError ? error.issues : [(error as Error).message] });
				continue;
			}
			if (!read.found) {
				problems.push({ id, issues: ["domain.json ausente"] });
				continue;
			}
			const checked = checkDomainManifest(read.value);
			if (!checked.ok) problems.push({ id, issues: checked.issues });
			else if (checked.manifest.id !== id) problems.push({ id, issues: [`id "${checked.manifest.id}" difere do nome da pasta`] });
			else {
				if (st.isFile) setBounded(cache, file, { stamp: st.stamp, id, manifest: checked.manifest });
				manifests.push(structuredClone(checked.manifest));
			}
		}
		manifests.sort((a, b) => builtinIndex(a.id) - builtinIndex(b.id) || compareInstants(a.createdAt, b.createdAt) || compareStrings(a.id, b.id));
		problems.sort((a, b) => compareStrings(a.id, b.id));
		return { manifests, problems };
	}

	function assertPrefixFree(manifest: DomainManifest): void {
		const owner = scanDomains().manifests.find((other) => other.id !== manifest.id && other.nodePrefix === manifest.nodePrefix);
		if (owner) {
			throw new DomainStoreError("prefix-taken", `O prefixo de nós "${manifest.nodePrefix}" já pertence ao domínio "${owner.id}"; escolha outro.`);
		}
	}

	/** The profile ensureDomain would write, validated BEFORE anything is created. */
	function initialProfile(id: DomainId, given: DomainProfile | undefined): DomainProfile | null {
		if (exists(domainProfileFile(root, id))) return null;
		const profile = parseDomainProfile(given ?? defaultDomainProfile(id, nowIso()), `perfil de "${id}"`);
		if (profile.domainId !== id) throw new DomainStoreError("id-mismatch", `O perfil informado pertence a "${profile.domainId}", esperado "${id}".`);
		return profile;
	}

	const removedBuiltinsFile = path.join(root, "profile", "removed-builtins.json");
	function readRemovedBuiltins(): Set<DomainId> {
		let read: ReturnType<typeof readJsonIfExists>;
		try {
			read = readJsonIfExists(removedBuiltinsFile);
		} catch {
			return new Set();
		}
		if (!read.found || !Array.isArray(read.value)) return new Set();
		return new Set(read.value.filter((item): item is DomainId => isDomainId(item) && (BUILTIN_DOMAIN_IDS as readonly string[]).includes(item)));
	}
	function writeRemovedBuiltins(ids: Set<DomainId>): void {
		if (ids.size === 0) {
			fs.rmSync(removedBuiltinsFile, { force: true });
			return;
		}
		writeJson(removedBuiltinsFile, [...ids].sort(compareStrings));
	}

	function ensureDomain(id: DomainId, ensureOptions: EnsureDomainOptions = {}): DomainManifest {
		const tree = domainTree(root, id); // validates the id
		let manifest = readManifest(id);
		// A refused profile must not leave a half-created domain behind.
		const profile = initialProfile(id, ensureOptions.profile);
		if (!manifest) {
			const now = nowIso();
			const candidate = ensureOptions.manifest ?? builtinManifest(id, now);
			if (!candidate) {
				throw new DomainStoreError("no-manifest", `O domínio "${id}" não existe e não é embutido; informe um manifest para criá-lo.`);
			}
			manifest = parseDomainManifest(candidate, `manifest de "${id}"`);
			if (manifest.id !== id) throw new DomainStoreError("id-mismatch", `O manifest informado tem id "${manifest.id}", esperado "${id}".`);
			assertPrefixFree(manifest);
			for (const dir of tree) fs.mkdirSync(dir, { recursive: true });
			writeJson(domainManifestFile(root, id), manifest);
			domainsCache().manifests.delete(path.resolve(domainManifestFile(root, id)));
		} else {
			for (const dir of tree) fs.mkdirSync(dir, { recursive: true });
		}
		if (profile) {
			writeJson(domainProfileFile(root, id), profile);
			domainsCache().profiles.delete(path.resolve(domainProfileFile(root, id)));
		}
		const removed = readRemovedBuiltins();
		if (removed.delete(id)) writeRemovedBuiltins(removed);
		return manifest;
	}

	function writeManifest(manifest: DomainManifest): DomainManifest {
		const valid = parseDomainManifest(manifest, `manifest de "${String(manifest?.id)}"`);
		requireManifest(valid.id);
		assertPrefixFree(valid);
		const file = domainManifestFile(root, valid.id);
		writeJson(file, valid);
		domainsCache().manifests.delete(path.resolve(file));
		return valid;
	}

	function writeProfile(profile: DomainProfile): DomainProfile {
		const valid = parseDomainProfile(profile, `perfil de "${String(profile?.domainId)}"`);
		requireManifest(valid.domainId);
		const file = domainProfileFile(root, valid.domainId);
		writeJson(file, valid);
		domainsCache().profiles.delete(path.resolve(file));
		return valid;
	}

	function getActiveDomain(): DomainId | null {
		let read: ReturnType<typeof readJsonIfExists>;
		try {
			read = readJsonIfExists(activeDomainFile(root));
		} catch {
			return null; // malformed pointer: the server falls back
		}
		if (!read.found || typeof read.value !== "object" || read.value === null) return null;
		const id = (read.value as { domainId?: unknown }).domainId;
		if (!isDomainId(id)) return null;
		try {
			return readManifest(id) ? id : null;
		} catch {
			return null;
		}
	}

	return {
		root,
		ensureWorkspace() {
			for (const dir of workspaceTree(root)) fs.mkdirSync(dir, { recursive: true });
		},
		ensureDomain,
		seedBuiltinDomains() {
			const removed = readRemovedBuiltins();
			return BUILTIN_DOMAIN_IDS.filter((id) => !removed.has(id)).map((id) => ensureDomain(id));
		},
		hasDomain(id) {
			return exists(domainManifestFile(root, id));
		},
		readManifest,
		writeManifest,
		updateManifest(id, update) {
			const next = update(requireManifest(id));
			if (next.id !== id) throw new DomainStoreError("id-mismatch", `O id de um domínio não pode mudar ("${id}" → "${next.id}").`);
			return writeManifest(next);
		},
		readProfile,
		writeProfile,
		updateProfile(id, update) {
			requireManifest(id);
			const current = readProfile(id) ?? defaultDomainProfile(id, nowIso());
			const next = update(current);
			if (next.domainId !== id) throw new DomainStoreError("id-mismatch", `O perfil de "${id}" não pode passar a "${next.domainId}".`);
			return writeProfile({ ...next, updatedAt: nowIso() });
		},
		listDomains() {
			const active = getActiveDomain();
			return scanDomains().manifests.map((manifest) => summaryOf(manifest, active));
		},
		scanDomains,
		getActiveDomain,
		setActiveDomain(id) {
			requireManifest(id);
			writeJson(activeDomainFile(root), { domainId: id, updatedAt: nowIso() });
		},
		removeDomain(id) {
			const dir = domainDir(root, id);
			if (!fs.existsSync(dir)) throw new DomainStoreError("not-found", `O domínio "${id}" não existe.`);
			if (getActiveDomain() === id) {
				throw new DomainStoreError("active", `"${id}" é o domínio ativo; troque de domínio antes de removê-lo.`);
			}
			const trash = domainsTrashDir(root);
			fs.mkdirSync(trash, { recursive: true });
			const base = `${id}-${trashStamp(clock())}`;
			let target = path.join(trash, base);
			for (let n = 2; fs.existsSync(target); n++) target = path.join(trash, `${base}-${n}`);
			try {
				fs.renameSync(dir, target);
			} catch (error) {
				throw new Error(`Não foi possível mover o domínio "${id}" para a lixeira (arquivos em uso?): ${(error as Error).message}`, { cause: error });
			}
			domainsCache().manifests.delete(path.resolve(domainManifestFile(root, id)));
			domainsCache().profiles.delete(path.resolve(domainProfileFile(root, id)));
			if ((BUILTIN_DOMAIN_IDS as readonly string[]).includes(id)) {
				const removed = readRemovedBuiltins();
				removed.add(id);
				writeRemovedBuiltins(removed);
			}
			return target;
		},
	};
}
