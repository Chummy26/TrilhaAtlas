/**
 * Minimal ZIP reader for EPUB import (SÍNTESE §2.8 "T1: EPUB … com fflate +
 * linkedom + turndown" — engineering rule for this module: no fflate; a small
 * reader over node:zlib instead).
 *
 * Reads the central directory (End Of Central Directory record), supports the
 * two methods EPUBs use — 0 (stored) and 8 (deflate, via inflateRawSync) —
 * and refuses what it cannot handle safely: encrypted entries, ZIP64, other
 * methods. Zip-bomb guards: per-entry and total uncompressed caps, and the
 * inflated size must equal the declared size. Entry names are normalized to
 * forward slashes; names with ".." segments or absolute paths are skipped
 * (they are never written to disk anyway — the importer only reads them).
 */

import { inflateRawSync } from "node:zlib";

export interface ZipEntry {
	name: string;
	method: number;
	compressedSize: number;
	size: number;
	localHeaderOffset: number;
	encrypted: boolean;
}

export interface ZipLimits {
	maxEntrySize?: number;
	maxTotalSize?: number;
	maxEntries?: number;
}

const DEFAULT_LIMITS: Required<ZipLimits> = { maxEntrySize: 64 * 1024 * 1024, maxTotalSize: 512 * 1024 * 1024, maxEntries: 20_000 };

export class ZipError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ZipError";
	}
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

function view(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function findEocd(dv: DataView): number {
	const min = Math.max(0, dv.byteLength - (22 + 0xffff));
	for (let i = dv.byteLength - 22; i >= min; i--) if (dv.getUint32(i, true) === EOCD_SIG) return i;
	throw new ZipError("Arquivo ZIP inválido: diretório central não encontrado.");
}

function safeName(raw: string): string | undefined {
	const name = raw.replace(/\\/g, "/");
	if (name.startsWith("/") || /^[a-z]:/i.test(name) || name.split("/").includes("..")) return undefined;
	return name;
}

export class ZipReader {
	private readonly bytes: Uint8Array;
	private readonly limits: Required<ZipLimits>;
	readonly entries: ReadonlyMap<string, ZipEntry>;
	private totalRead = 0;

	constructor(bytes: Uint8Array, limits: ZipLimits = {}) {
		this.bytes = bytes;
		this.limits = { ...DEFAULT_LIMITS, ...limits };
		this.entries = this.readDirectory();
	}

	private readDirectory(): Map<string, ZipEntry> {
		const dv = view(this.bytes);
		if (dv.byteLength < 22) throw new ZipError("Arquivo ZIP inválido: curto demais.");
		const eocd = findEocd(dv);
		const count = dv.getUint16(eocd + 10, true);
		const cdSize = dv.getUint32(eocd + 12, true);
		const cdOffset = dv.getUint32(eocd + 16, true);
		if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) throw new ZipError("ZIP64 não é suportado.");
		if (count > this.limits.maxEntries) throw new ZipError(`ZIP com entradas demais (${count}).`);
		if (cdOffset + cdSize > dv.byteLength) throw new ZipError("Arquivo ZIP truncado.");
		const decoder = new TextDecoder();
		const out = new Map<string, ZipEntry>();
		let p = cdOffset;
		for (let i = 0; i < count; i++) {
			if (p + 46 > dv.byteLength || dv.getUint32(p, true) !== CEN_SIG) throw new ZipError("Diretório central do ZIP corrompido.");
			const flags = dv.getUint16(p + 8, true);
			const method = dv.getUint16(p + 10, true);
			const compressedSize = dv.getUint32(p + 20, true);
			const size = dv.getUint32(p + 24, true);
			const nameLen = dv.getUint16(p + 28, true);
			const extraLen = dv.getUint16(p + 30, true);
			const commentLen = dv.getUint16(p + 32, true);
			const localHeaderOffset = dv.getUint32(p + 42, true);
			const name = safeName(decoder.decode(this.bytes.subarray(p + 46, p + 46 + nameLen)));
			if (name && !name.endsWith("/")) out.set(name, { name, method, compressedSize, size, localHeaderOffset, encrypted: (flags & 1) === 1 });
			p += 46 + nameLen + extraLen + commentLen;
		}
		return out;
	}

	has(name: string): boolean {
		return this.entries.has(name);
	}

	/** Entry bytes (throws ZipError for unsupported or oversized entries). */
	read(name: string): Uint8Array {
		const e = this.entries.get(name);
		if (!e) throw new ZipError(`Entrada ausente no ZIP: ${name}.`);
		if (e.encrypted) throw new ZipError(`Entrada criptografada no ZIP: ${name}.`);
		if (e.size > this.limits.maxEntrySize) throw new ZipError(`Entrada grande demais no ZIP: ${name} (${e.size} bytes).`);
		if (this.totalRead + e.size > this.limits.maxTotalSize) throw new ZipError("Conteúdo descompactado grande demais (possível bomba ZIP).");
		const dv = view(this.bytes);
		const p = e.localHeaderOffset;
		if (p + 30 > dv.byteLength || dv.getUint32(p, true) !== LOC_SIG) throw new ZipError(`Cabeçalho local corrompido: ${name}.`);
		const start = p + 30 + dv.getUint16(p + 26, true) + dv.getUint16(p + 28, true);
		const end = start + e.compressedSize;
		if (end > dv.byteLength) throw new ZipError(`Entrada truncada no ZIP: ${name}.`);
		const raw = this.bytes.subarray(start, end);
		let data: Uint8Array;
		if (e.method === 0) data = raw;
		else if (e.method === 8) {
			try {
				data = new Uint8Array(inflateRawSync(raw, { maxOutputLength: Math.max(1, e.size) }));
			} catch (err) {
				throw new ZipError(`Falha ao descompactar ${name}: ${err instanceof Error ? err.message : String(err)}`);
			}
		} else throw new ZipError(`Método de compressão ${e.method} não suportado (${name}).`);
		if (data.byteLength !== e.size) throw new ZipError(`Tamanho descompactado inesperado em ${name}.`);
		this.totalRead += data.byteLength;
		return data;
	}

	readText(name: string): string {
		return new TextDecoder("utf-8").decode(this.read(name));
	}
}

/** Resolve `href` (percent-encoded, relative, maybe with #fragment) against a base entry path. */
export function resolveZipPath(baseEntry: string, href: string): string {
	const clean = decodeURIComponent(href.split("#")[0] ?? "");
	if (!clean) return baseEntry;
	const baseDir = baseEntry.includes("/") ? baseEntry.slice(0, baseEntry.lastIndexOf("/") + 1) : "";
	const parts = (clean.startsWith("/") ? clean.slice(1) : baseDir + clean).split("/");
	const out: string[] = [];
	for (const part of parts) {
		if (part === "" || part === ".") continue;
		if (part === "..") out.pop();
		else out.push(part);
	}
	return out.join("/");
}
