/**
 * Platform · credential store (docs/research/00-SINTESE.md §2.2
 * "credentials.enc", §2.9; lh-agent-providers.md risk #2):
 *
 *  - round trip through an injected cipher (AES-256-GCM test cipher);
 *  - the token NEVER appears in clear: not in credentials.enc, not in any
 *    file left in the folder, not even key names;
 *  - an unavailable, identity (plaintext) or broken cipher is refused and
 *    nothing is written;
 *  - another cipher/key or a corrupt file throws a clear error instead of
 *    being overwritten; clear() is the explicit reset.
 */

import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import fc from "fast-check";
import { credentialsFile } from "../src/core/domains/paths.ts";
import { createCredentialStore, createTestCipher, CredentialStoreError, type CredentialCipher } from "../src/store/credential-store.ts";

const tmpRoots: string[] = [];
function tmpRoot(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-platform-cred-"));
	tmpRoots.push(dir);
	return dir;
}
after(() => {
	for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true });
});

const TOKEN = "sk-test-0123456789abcdefTOKEN-very-secret";
const REFRESH = "rt_test_ZYXWVUTSRQPONMLKJIHGFEDCBA_refresh";

/** Every byte under `dir`, concatenated (catches temp leftovers too). */
function allBytes(dir: string): Buffer {
	const chunks: Buffer[] = [];
	const walk = (current: string) => {
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) walk(full);
			else chunks.push(fs.readFileSync(full));
		}
	};
	walk(dir);
	return Buffer.concat(chunks);
}

function codeOf(code: string) {
	return (error: unknown) => error instanceof CredentialStoreError && error.code === code;
}

describe("credential store", () => {
	it("round-trips secrets and lists keys", () => {
		const root = tmpRoot();
		const store = createCredentialStore({ file: credentialsFile(root), cipher: createTestCipher(), now: () => new Date("2026-11-18T12:00:00Z") });
		assert.equal(store.get("openrouter"), null);
		assert.deepEqual(store.keys(), []);
		store.set("openrouter", TOKEN);
		store.set("chatgpt:account-1", JSON.stringify({ access_token: TOKEN, refresh_token: REFRESH }));
		assert.equal(store.get("openrouter"), TOKEN);
		assert.equal(JSON.parse(store.get("chatgpt:account-1") ?? "{}").refresh_token, REFRESH);
		assert.deepEqual(store.keys(), ["chatgpt:account-1", "openrouter"]);
		assert.equal(store.updatedAt("openrouter"), "2026-11-18T12:00:00.000Z");
		assert.equal(store.has("openrouter"), true);
		assert.equal(store.delete("openrouter"), true);
		assert.equal(store.delete("openrouter"), false);
		assert.equal(store.has("openrouter"), false);
		store.set("__proto__", "prototype-key-is-plain-data");
		assert.equal(store.get("__proto__"), "prototype-key-is-plain-data");
		assert.equal(({} as Record<string, unknown>).secret, undefined);
	});

	it("never writes a token, a refresh token or a key name in clear", () => {
		const root = tmpRoot();
		const file = credentialsFile(root);
		const store = createCredentialStore({ file, cipher: createTestCipher() });
		store.set("chatgpt:person@example.com", JSON.stringify({ access_token: TOKEN, refresh_token: REFRESH }));
		store.set("anthropic-api", TOKEN);
		store.delete("anthropic-api");
		const bytes = allBytes(root);
		for (const needle of [TOKEN, REFRESH, "person@example.com", "access_token", "anthropic-api"]) {
			assert.equal(bytes.includes(Buffer.from(needle, "utf-8")), false, `"${needle}" found in clear`);
			assert.equal(bytes.includes(Buffer.from(needle, "utf16le")), false, `"${needle}" found as UTF-16`);
		}
		const envelope = JSON.parse(fs.readFileSync(file, "utf-8"));
		assert.equal(envelope.format, "lh-credentials");
		assert.equal(envelope.cipher, "test-aes-256-gcm");
		assert.deepEqual(
			fs.readdirSync(path.dirname(file)),
			["credentials.enc"],
			"no temp files left beside the vault",
		);
		if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
	});

	it("property: no stored secret ever appears in the file bytes", () => {
		const root = tmpRoot();
		const store = createCredentialStore({ file: credentialsFile(root), cipher: createTestCipher() });
		fc.assert(
			fc.property(fc.string({ minLength: 8, maxLength: 80 }), fc.stringMatching(/^[a-z][a-z0-9:-]{0,20}$/), (secret, key) => {
				store.set(key, secret);
				assert.equal(store.get(key), secret);
				assert.equal(allBytes(root).includes(Buffer.from(secret, "utf-8")), false);
			}),
			{ numRuns: 60 },
		);
	});

	it("refuses to write when encryption is unavailable (no plaintext fallback)", () => {
		const root = tmpRoot();
		const store = createCredentialStore({ file: credentialsFile(root), cipher: createTestCipher({ available: false }) });
		assert.equal(store.isAvailable(), false);
		assert.throws(() => store.set("openrouter", TOKEN), codeOf("unavailable"));
		assert.equal(fs.existsSync(credentialsFile(root)), false);
	});

	it("refuses an identity cipher that would leave the token readable", () => {
		const root = tmpRoot();
		const identity: CredentialCipher = {
			id: "identity",
			isAvailable: () => true,
			encrypt: (text) => Buffer.from(text, "utf-8"),
			decrypt: (bytes) => Buffer.from(bytes).toString("utf-8"),
		};
		const store = createCredentialStore({ file: credentialsFile(root), cipher: identity });
		assert.throws(() => store.set("openrouter", TOKEN), codeOf("plaintext-leak"));
		assert.equal(fs.existsSync(credentialsFile(root)), false);
		assert.equal(allBytes(root).includes(Buffer.from(TOKEN)), false);
	});

	it("refuses an identity cipher for token RECORDS and short secrets too (escaped/short forms)", () => {
		const identityUtf8: CredentialCipher = {
			id: "identity",
			isAvailable: () => true,
			encrypt: (text) => Buffer.from(text, "utf-8"),
			decrypt: (bytes) => Buffer.from(bytes).toString("utf-8"),
		};
		const identityUtf16: CredentialCipher = {
			id: "identity-utf16",
			isAvailable: () => true,
			encrypt: (text) => Buffer.from(text, "utf16le"),
			decrypt: (bytes) => Buffer.from(bytes).toString("utf16le"),
		};
		const record = JSON.stringify({ access_token: TOKEN, refresh_token: REFRESH }); // its quotes are escaped inside the vault JSON
		for (const cipher of [identityUtf8, identityUtf16]) {
			for (const [key, secret] of [
				["chatgpt", record],
				["pin", "1234"],
				["k", 'quote"and\\backslash-secret'],
			] as const) {
				const root = tmpRoot();
				const store = createCredentialStore({ file: credentialsFile(root), cipher });
				assert.throws(() => store.set(key, secret), codeOf("plaintext-leak"), `${cipher.id} wrote ${key} in clear`);
				assert.equal(fs.existsSync(credentialsFile(root)), false);
			}
		}
	});

	it("refuses a cipher that cannot decrypt what it encrypted", () => {
		const root = tmpRoot();
		const lossy: CredentialCipher = {
			id: "lossy",
			isAvailable: () => true,
			encrypt: () => crypto.randomBytes(64),
			decrypt: () => "garbage",
		};
		const store = createCredentialStore({ file: credentialsFile(root), cipher: lossy });
		assert.throws(() => store.set("openrouter", TOKEN), codeOf("undecryptable"));
		assert.equal(fs.existsSync(credentialsFile(root)), false);
	});

	it("does not silently overwrite a vault it cannot open", () => {
		const root = tmpRoot();
		const file = credentialsFile(root);
		const key = crypto.randomBytes(32);
		createCredentialStore({ file, cipher: createTestCipher({ key }) }).set("openrouter", TOKEN);
		const original = fs.readFileSync(file);

		const otherKey = createCredentialStore({ file, cipher: createTestCipher() });
		assert.throws(() => otherKey.get("openrouter"), codeOf("undecryptable"));
		assert.throws(() => otherKey.set("openrouter", "replacement-secret"), codeOf("undecryptable"));
		const otherCipher = createCredentialStore({ file, cipher: createTestCipher({ id: "other-cipher" }) });
		assert.throws(() => otherCipher.keys(), codeOf("cipher-mismatch"));
		assert.deepEqual(fs.readFileSync(file), original);

		const sameKey = createCredentialStore({ file, cipher: createTestCipher({ key }) });
		assert.equal(sameKey.get("openrouter"), TOKEN, "the right key still opens it");

		fs.writeFileSync(file, "{ not json");
		assert.throws(() => sameKey.get("openrouter"), codeOf("corrupt"));
		sameKey.clear();
		assert.equal(fs.existsSync(file), false);
		assert.equal(sameKey.get("openrouter"), null);
		sameKey.clear(); // idempotent
	});

	it("validates keys and secrets", () => {
		const store = createCredentialStore({ file: credentialsFile(tmpRoot()), cipher: createTestCipher() });
		assert.throws(() => store.set("", TOKEN), codeOf("invalid-key"));
		assert.throws(() => store.set("bad\nkey", TOKEN), codeOf("invalid-key"));
		assert.throws(() => store.set("ok", ""), codeOf("invalid-secret"));
		assert.throws(() => createTestCipher({ key: new Uint8Array(16) }), /32 bytes/);
	});
});
