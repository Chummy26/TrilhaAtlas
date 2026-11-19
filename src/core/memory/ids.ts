/**
 * Identifiers for memory rows (r4 §7.4: TEXT primary keys; DeepTutor
 * mental-model entries use `m_<ULID>` [ref-deeptutor-core.md §3.2]).
 *
 * ULID = 10 Crockford-base32 chars of milliseconds + 16 random chars (80
 * bits). Randomness comes from the Web Crypto API (`globalThis.crypto`),
 * available both in Node ≥ 19 and in browsers, so this stays browser-safe.
 * Ids are opaque: ordering is never derived from them (rows carry ts/seq).
 */

import { MemoryError } from "./types.ts";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const MENTAL_MODEL_ID_PATTERN = /^m_[0-9A-HJKMNP-TV-Z]{26}$/;

export type RandomFill = (bytes: Uint8Array) => Uint8Array;

function cryptoFill(bytes: Uint8Array): Uint8Array {
	const cryptoApi = (globalThis as { crypto?: { getRandomValues?: (b: Uint8Array) => Uint8Array } }).crypto;
	if (!cryptoApi?.getRandomValues) throw new MemoryError("invalid-input", "Web Crypto indisponível para gerar ids");
	cryptoApi.getRandomValues(bytes);
	return bytes;
}

export function ulid(now: number = Date.now(), random: RandomFill = cryptoFill): string {
	if (!Number.isFinite(now) || now < 0) throw new MemoryError("invalid-input", `instante inválido para ULID: ${now}`);
	let time = Math.floor(now);
	let timePart = "";
	for (let i = 0; i < 10; i++) {
		timePart = (CROCKFORD[time % 32] as string) + timePart;
		time = Math.floor(time / 32);
	}
	const bytes = random(new Uint8Array(16));
	let randomPart = "";
	for (let i = 0; i < 16; i++) randomPart += CROCKFORD[(bytes[i] as number) % 32] as string;
	return timePart + randomPart;
}

/** `${prefix}_${ULID}` — e.g. "msg_01JD…", "fact_01JD…", "m_01JD…". */
export function newId(prefix: string, now?: number, random?: RandomFill): string {
	if (!/^[a-z]{1,8}$/.test(prefix)) throw new MemoryError("invalid-input", `prefixo de id inválido: "${prefix}"`);
	return `${prefix}_${ulid(now, random)}`;
}
