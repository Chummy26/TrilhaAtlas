/**
 * Durable file primitives for the export/sync modules (SÍNTESE §2.4(d) item 5:
 * "escrita atômica com staging + rename no-replace" [clew ADR-0008]).
 *
 * - `writeFileAtomic`: temp file (exclusive, 0600) + fsync + rename, the same recipe
 *   as store.cjs, for files only this plugin writes (sync-cursor.json, .apkg).
 * - `commitNew`: publishes a staged file without ever replacing an existing one
 *   (hard link = atomic no-replace; exclusive copy when the volume has no links).
 * - `commitReplace`: atomic rename over an existing file, retrying the transient
 *   EPERM/EBUSY/EACCES that Windows reports while another program holds the file.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";

const RETRYABLE = new Set(["EPERM", "EBUSY", "EACCES"]);
const LINK_UNSUPPORTED = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV", "EINVAL"]);

function code(error: unknown): string | undefined {
	return typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : undefined;
}

export function sleepSync(milliseconds: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function writeDurably(file: string, content: string | Uint8Array, flag: "wx" | "w" = "wx"): void {
	const fd = fs.openSync(file, flag, 0o600);
	try {
		fs.writeFileSync(fd, content);
		fs.fsyncSync(fd);
	} finally {
		fs.closeSync(fd);
	}
}

export function renameWithRetry(from: string, to: string, attempts = 6): void {
	for (let attempt = 1; ; attempt++) {
		try {
			fs.renameSync(from, to);
			return;
		} catch (error) {
			if (attempt >= attempts || !RETRYABLE.has(code(error) ?? "")) throw error;
			sleepSync(25 * attempt);
		}
	}
}

export function writeFileAtomic(file: string, content: string | Uint8Array): void {
	const temporary = `${file}.${randomUUID()}.tmp`;
	try {
		writeDurably(temporary, content);
		renameWithRetry(temporary, file);
	} finally {
		try { fs.unlinkSync(temporary); } catch (error) { if (code(error) !== "ENOENT") throw error; }
	}
}

/** Publishes `staged` at `target` only if `target` does not exist (EEXIST otherwise). */
export function commitNew(staged: string, target: string): void {
	try {
		fs.linkSync(staged, target);
	} catch (error) {
		if (code(error) === "EEXIST" || !LINK_UNSUPPORTED.has(code(error) ?? "")) throw error;
		fs.copyFileSync(staged, target, fs.constants.COPYFILE_EXCL);
	}
	fs.unlinkSync(staged);
}

/** Replaces `target` with `staged` only if `target` still holds `expected`. */
export function commitReplace(staged: string, target: string, expected: string): void {
	let current: string;
	try { current = fs.readFileSync(target, "utf8"); } catch (error) {
		if (code(error) === "ENOENT") throw new Error(`O arquivo ${target} foi removido durante a exportação. Exporte de novo.`);
		throw error;
	}
	if (current !== expected) throw new Error(`O arquivo ${target} mudou durante a exportação. Exporte de novo.`);
	renameWithRetry(staged, target);
}
