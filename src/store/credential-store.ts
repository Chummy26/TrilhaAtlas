/**
 * Encrypted credential vault: `<LH_DATA_DIR>/profile/credentials.enc`
 * (docs/research/00-SINTESE.md §2.2 "credentials.enc (Electron safeStorage →
 * DPAPI no Windows; substitui JSON em claro)", §2.9; r5 §2.2.5;
 * lh-agent-providers.md risk #2 "credenciais em texto puro, sem ACL").
 *
 * The cipher is INJECTED (CredentialCipher). In the desktop app the Electron
 * main process provides one backed by safeStorage (DPAPI on Windows,
 * Keychain on macOS, libsecret/kwallet on Linux):
 *
 *   { id: "electron-safe-storage",
 *     isAvailable: () => safeStorage.isEncryptionAvailable(),
 *     encrypt: (text) => safeStorage.encryptString(text),
 *     decrypt: (bytes) => safeStorage.decryptString(Buffer.from(bytes)) }
 *
 * (On Linux, check safeStorage.getSelectedStorageBackend() !== "basic_text"
 * before reporting it available.) createTestCipher below is an AES-256-GCM
 * cipher with an in-memory key, for tests and for callers that manage the
 * key themselves.
 *
 * Guarantees:
 *  - Never plaintext on disk. The whole entry map is serialized and
 *    encrypted as ONE blob (key names such as "chatgpt:<account>" are hidden
 *    too). Before writing, the store checks that the cipher is available,
 *    that decrypt(encrypt(x)) round-trips, and that neither the serialized
 *    vault nor any key or secret (≥ 8 bytes; raw or JSON-escaped, UTF-8 or
 *    UTF-16LE) appears verbatim in the ciphertext (the file holds only
 *    constants and base64 of the ciphertext): an identity or broken cipher is
 *    refused with code "plaintext-leak" and nothing is written. There is no
 *    plaintext fallback.
 *  - Atomic replacement (writeFileAtomicSync, mode 0o600; on Windows the
 *    profile ACL applies and DPAPI binds the bytes to the user).
 *  - A file that cannot be read back (other cipher, other machine/user,
 *    corruption) throws a CredentialStoreError instead of being silently
 *    overwritten; clear() is the explicit reset.
 *  - Stateless: every call reads the file, so two store instances never
 *    disagree. Secrets are opaque strings (callers serialize token records).
 *
 * File format (UTF-8 JSON): { format: "lh-credentials", version: 1,
 * cipher: <cipher id>, payload: base64(encrypt(JSON {entries}))}.
 */

import fs from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { removeLeftoverTemps, writeFileAtomicSync } from "./atomic-write.ts";

export interface CredentialCipher {
	/** Stable id stored in the file, e.g. "electron-safe-storage". */
	readonly id: string;
	/** False when the OS keystore is unavailable: the store then refuses to write. */
	isAvailable(): boolean;
	encrypt(plaintext: string): Uint8Array;
	decrypt(ciphertext: Uint8Array): string;
}

export type CredentialStoreErrorCode = "unavailable" | "plaintext-leak" | "corrupt" | "cipher-mismatch" | "undecryptable" | "invalid-key" | "invalid-secret";

export class CredentialStoreError extends Error {
	readonly code: CredentialStoreErrorCode;
	constructor(code: CredentialStoreErrorCode, message: string) {
		super(message);
		this.name = "CredentialStoreError";
		this.code = code;
	}
}

export interface CredentialStore {
	readonly file: string;
	/** True when the cipher can encrypt now. */
	isAvailable(): boolean;
	get(key: string): string | null;
	has(key: string): boolean;
	/** Stored keys, sorted. */
	keys(): string[];
	/** When the entry was last written (ISO), or null. */
	updatedAt(key: string): string | null;
	set(key: string, secret: string): void;
	/** True when something was removed. */
	delete(key: string): boolean;
	/** Remove the vault file (explicit reset, e.g. after an OS profile change). */
	clear(): void;
}

export interface CredentialStoreOptions {
	/** Usually credentialsFile(LH_DATA_DIR) from core/domains/paths.ts. */
	file: string;
	cipher: CredentialCipher;
	now?: () => Date;
}

interface VaultEntry {
	secret: string;
	updatedAt: string;
}

/** A Map, not an object: a key such as "__proto__" stays plain data. */
type Vault = Map<string, VaultEntry>;

interface Envelope {
	format: "lh-credentials";
	version: 1;
	cipher: string;
	payload: string;
}

const FORMAT = "lh-credentials";
const KEY_PATTERN = /^[^\u0000-\u001f\u007f]{1,256}$/;
/** Shorter secrets could match random ciphertext by chance; they are still encrypted. */
const LEAK_CHECK_MIN_BYTES = 8;
const MAX_SECRET_CHARS = 1_000_000;

// ─── validation ──────────────────────────────────────────────────────────────

function assertKey(key: string): void {
	if (typeof key !== "string" || !KEY_PATTERN.test(key)) {
		throw new CredentialStoreError("invalid-key", "Chave de credencial inválida (1–256 caracteres, sem caracteres de controle).");
	}
}

function assertSecret(secret: string): void {
	if (typeof secret !== "string" || secret.length === 0 || secret.length > MAX_SECRET_CHARS) {
		throw new CredentialStoreError("invalid-secret", "Credencial inválida: use um texto não vazio de até 1 MB.");
	}
}

function isVaultRecord(value: unknown): value is Record<string, VaultEntry> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	return Object.entries(value).every(
		([key, entry]) =>
			KEY_PATTERN.test(key) &&
			typeof entry === "object" &&
			entry !== null &&
			typeof (entry as VaultEntry).secret === "string" &&
			typeof (entry as VaultEntry).updatedAt === "string",
	);
}

function isEnvelope(value: unknown): value is Envelope {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Partial<Envelope>;
	return v.format === FORMAT && v.version === 1 && typeof v.cipher === "string" && typeof v.payload === "string";
}

// ─── encoding ────────────────────────────────────────────────────────────────

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
	return Buffer.from(haystack.buffer, haystack.byteOffset, haystack.byteLength).includes(Buffer.from(needle.buffer, needle.byteOffset, needle.byteLength));
}

/**
 * Every readable form a weak cipher could leave in the ciphertext: the whole
 * serialized vault (an identity cipher, whatever the secrets' lengths), and
 * each key and secret both raw and JSON-escaped — a token RECORD such as
 * {"access_token":"…"} appears escaped (\") inside the serialized vault, so
 * checking only the raw secret would miss it. UTF-8 and UTF-16LE.
 */
function readableForms(vault: Vault, plaintext: string): Buffer[] {
	const texts = [plaintext];
	for (const [key, entry] of vault) texts.push(key, JSON.stringify(key).slice(1, -1), entry.secret, JSON.stringify(entry.secret).slice(1, -1));
	return texts.flatMap((text) => [Buffer.from(text, "utf-8"), Buffer.from(text, "utf16le")]).filter((bytes) => bytes.length >= LEAK_CHECK_MIN_BYTES);
}

/** The file is constants + base64(ciphertext), so checking the ciphertext bytes covers it. */
function assertNoPlaintext(vault: Vault, plaintext: string, ciphertext: Uint8Array, cipherId: string): void {
	for (const bytes of readableForms(vault, plaintext)) {
		if (containsBytes(ciphertext, bytes)) {
			throw new CredentialStoreError("plaintext-leak", `A cifra "${cipherId}" deixaria uma credencial legível no disco; nada foi gravado.`);
		}
	}
}

function seal(vault: Vault, cipher: CredentialCipher): string {
	if (!cipher.isAvailable()) {
		throw new CredentialStoreError("unavailable", "A criptografia do sistema não está disponível; a credencial não foi salva (nunca gravamos credenciais em claro).");
	}
	const plaintext = JSON.stringify({ entries: Object.fromEntries(vault) });
	const ciphertext = cipher.encrypt(plaintext);
	let roundTrip: string | undefined;
	try {
		roundTrip = cipher.decrypt(ciphertext);
	} catch {
		roundTrip = undefined;
	}
	if (roundTrip !== plaintext) {
		throw new CredentialStoreError("undecryptable", `A cifra "${cipher.id}" não recupera o que cifrou; nada foi gravado.`);
	}
	assertNoPlaintext(vault, plaintext, ciphertext, cipher.id);
	const envelope: Envelope = { format: FORMAT, version: 1, cipher: cipher.id, payload: Buffer.from(ciphertext).toString("base64") };
	return `${JSON.stringify(envelope, null, "\t")}\n`;
}

function open(text: string, cipher: CredentialCipher, file: string): Vault {
	let envelope: unknown;
	try {
		envelope = JSON.parse(text);
	} catch {
		throw new CredentialStoreError("corrupt", `${path.basename(file)} está corrompido (JSON inválido). Use "limpar credenciais" e conecte de novo.`);
	}
	if (!isEnvelope(envelope)) {
		throw new CredentialStoreError("corrupt", `${path.basename(file)} não é um cofre de credenciais reconhecido.`);
	}
	if (envelope.cipher !== cipher.id) {
		throw new CredentialStoreError("cipher-mismatch", `${path.basename(file)} foi cifrado com "${envelope.cipher}", mas a cifra atual é "${cipher.id}".`);
	}
	let plaintext: string;
	try {
		plaintext = cipher.decrypt(Buffer.from(envelope.payload, "base64"));
	} catch {
		throw new CredentialStoreError("undecryptable", `Não foi possível decifrar ${path.basename(file)} (outro usuário ou outra máquina?). Use "limpar credenciais" e conecte de novo.`);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(plaintext);
	} catch {
		throw new CredentialStoreError("corrupt", `${path.basename(file)} decifrou para um conteúdo inválido.`);
	}
	const entries = (parsed as { entries?: unknown } | null)?.entries;
	if (!isVaultRecord(entries)) throw new CredentialStoreError("corrupt", `${path.basename(file)} tem entradas inválidas.`);
	return new Map(Object.entries(entries));
}

// ─── store ───────────────────────────────────────────────────────────────────

export function createCredentialStore(options: CredentialStoreOptions): CredentialStore {
	const { file, cipher } = options;
	const clock = options.now ?? (() => new Date());
	if (typeof file !== "string" || file.trim() === "") throw new Error("createCredentialStore: informe o caminho de credentials.enc.");

	function load(): Vault {
		let text: string;
		try {
			text = fs.readFileSync(file, "utf-8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
			throw error;
		}
		return open(text, cipher, file);
	}

	function save(vault: Vault): void {
		const text = seal(vault, cipher); // throws before touching the disk
		fs.mkdirSync(path.dirname(file), { recursive: true });
		writeFileAtomicSync(file, text, { mode: 0o600 });
	}

	return {
		file,
		isAvailable: () => cipher.isAvailable(),
		get(key) {
			assertKey(key);
			return load().get(key)?.secret ?? null;
		},
		has(key) {
			assertKey(key);
			return load().has(key);
		},
		keys() {
			return [...load().keys()].sort();
		},
		updatedAt(key) {
			assertKey(key);
			return load().get(key)?.updatedAt ?? null;
		},
		set(key, secret) {
			assertKey(key);
			assertSecret(secret);
			const vault = load();
			vault.set(key, { secret, updatedAt: clock().toISOString() });
			save(vault);
		},
		delete(key) {
			assertKey(key);
			const vault = load();
			if (!vault.delete(key)) return false;
			save(vault);
			return true;
		},
		clear() {
			try {
				fs.unlinkSync(file);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			removeLeftoverTemps(file);
		},
	};
}

// ─── test cipher ─────────────────────────────────────────────────────────────

const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

/**
 * AES-256-GCM cipher with a caller-held key (random when omitted, so it only
 * lives as long as the process). Output layout: iv(12) ‖ tag(16) ‖ data.
 * For tests and key-managing callers; the desktop app injects safeStorage.
 */
export function createTestCipher(options: { key?: Uint8Array; id?: string; available?: boolean } = {}): CredentialCipher {
	const key = options.key ?? randomBytes(32);
	if (key.byteLength !== 32) throw new Error("createTestCipher: a chave AES-256 deve ter 32 bytes.");
	const id = options.id ?? "test-aes-256-gcm";
	const available = options.available ?? true;
	return {
		id,
		isAvailable: () => available,
		encrypt(plaintext) {
			const iv = randomBytes(GCM_IV_BYTES);
			const aes = createCipheriv("aes-256-gcm", key, iv);
			const data = Buffer.concat([aes.update(plaintext, "utf-8"), aes.final()]);
			return Buffer.concat([iv, aes.getAuthTag(), data]);
		},
		decrypt(ciphertext) {
			const bytes = Buffer.from(ciphertext);
			if (bytes.length < GCM_IV_BYTES + GCM_TAG_BYTES) throw new Error("Texto cifrado curto demais.");
			const aes = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, GCM_IV_BYTES));
			aes.setAuthTag(bytes.subarray(GCM_IV_BYTES, GCM_IV_BYTES + GCM_TAG_BYTES));
			return Buffer.concat([aes.update(bytes.subarray(GCM_IV_BYTES + GCM_TAG_BYTES)), aes.final()]).toString("utf-8");
		},
	};
}
