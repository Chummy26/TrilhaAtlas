import fs from "node:fs";
import path from "node:path";
import changes from "../../content/curriculum-revisions/electronics-v2.json";
import { canonicalJson, fnv1a64Hex } from "../core/curriculum/certificate.ts";
import { applySeedFiles, replayLedger } from "../core/curriculum/ledger.ts";
import { applySeedRevision, isSeedRevision, type SeedRevision } from "../core/curriculum/seed-revision.ts";
import type { CurriculumSeedFile, CurriculumSnapshot, ValidationError } from "../core/curriculum/types.ts";
import type { DomainManifest } from "../core/domains/types.ts";
import { writeFileAtomicSync } from "../store/atomic-write.ts";

const REVISION = "electronics-v2";
const SEED_VERSION = "seed-electronics-v2";
type Rule = { before: string; after: unknown };
// Each fingerprint is taken from the normalized seed at aa7b5a97780c6a3d5f54f99eca6a7e4049bade64.
const release: Record<string, Record<string, Rule>> = changes;

function invalid(errors: readonly ValidationError[]): never {
	throw new Error(`Currículo de Eletrônica inválido: ${errors.slice(0, 3).map((error) => error.message).join("; ")}`);
}

function optionalText(file: string): string | undefined {
	try {
		return fs.readFileSync(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

/** The PID owner is published atomically inside a nonempty directory. */
function withCurriculumLock<T>(dir: string, action: () => T): T {
	fs.mkdirSync(dir, { recursive: true });
	const lock = path.join(dir, ".revision-lock");
	const pending = fs.mkdtempSync(path.join(dir, ".revision-lock-"));
	const owner = `${process.pid}-${path.basename(pending)}`;
	const pause = new Int32Array(new SharedArrayBuffer(4));
	const deadline = Date.now() + 10_000;
	try {
		fs.writeFileSync(path.join(pending, owner), "");
		for (;;) {
			try {
				fs.renameSync(pending, lock);
				break;
			} catch (error) {
				if (!["EEXIST", "ENOTEMPTY", "EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
				if (Date.now() >= deadline) throw error;
				try {
					for (const entry of fs.readdirSync(lock)) {
						const pid = /^([1-9]\d*)-\.revision-lock-/.exec(entry)?.[1];
						if (!pid) continue;
						try {
							process.kill(Number(pid), 0);
						} catch (probe) {
							if ((probe as NodeJS.ErrnoException).code !== "ESRCH") throw probe;
							fs.unlinkSync(path.join(lock, entry));
						}
					}
					// A live owner always leaves the directory nonempty.
					fs.rmdirSync(lock);
				} catch (cleanup) {
					if (!["ENOENT", "ENOTEMPTY", "EEXIST", "EPERM", "EACCES"].includes((cleanup as NodeJS.ErrnoException).code ?? "")) throw cleanup;
				}
				Atomics.wait(pause, 0, 0, 20);
			}
		}
		try {
			return action();
		} finally {
			fs.unlinkSync(path.join(lock, owner));
			// Another process may already have removed the empty lock directory.
			try {
				fs.rmdirSync(lock);
			} catch (error) {
				if (!["ENOENT", "ENOTEMPTY", "EEXIST", "EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
			}
		}
	} finally {
		try {
			fs.unlinkSync(path.join(pending, owner));
			fs.rmdirSync(pending);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
}

export function electronicsCurriculumStamp(dir: string): string {
	const files = ["ledger.jsonl", "snapshot.json"].map((name) => {
		const stat = fs.statSync(path.join(dir, name), { throwIfNoEntry: false, bigint: true });
		return stat ? `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}` : "-";
	});
	return [REVISION, ...files].join("/");
}

function revisionFor(snapshot: CurriculumSnapshot, baseline: CurriculumSnapshot): SeedRevision {
	const items = Object.fromEntries(Object.entries(release).flatMap(([id, fields]) => {
		const current = snapshot.items[id];
		const origin = baseline.items[id];
		if (!origin || !current || current.status === "deprecated") return [];
		const preserved = Object.entries(fields).filter(([field, rule]) => {
			const key = field as keyof typeof current;
			const before = canonicalJson(current[key]);
			return before === canonicalJson(origin[key]) && fnv1a64Hex(before) === rule.before;
		});
		return preserved.length ? [[id, Object.fromEntries(preserved.map(([field, rule]) => [field, rule.after]))]] : [];
	}));
	return {
		kind: "seed-revision", revision: REVISION, domainId: snapshot.domainId,
		baseVersion: snapshot.version, createdAt: new Date().toISOString(), items,
	};
}

export function loadElectronicsCurriculum(
	dir: string,
	edgeMode: DomainManifest["edgeMode"],
	readSeeds: () => CurriculumSeedFile[],
): { snapshot: CurriculumSnapshot; stamp: string } | null {
	return withCurriculumLock(dir, () => {
		const ledgerFile = path.join(dir, "ledger.jsonl");
		const snapshotFile = path.join(dir, "snapshot.json");
		let ledger = optionalText(ledgerFile);
		const stored = optionalText(snapshotFile);
		const opts = { edgeMode };
		let snapshot: CurriculumSnapshot;

		if (ledger === undefined) {
			if (stored !== undefined) {
				// Preserve snapshots that were already orphaned before this release.
				return { snapshot: JSON.parse(stored) as CurriculumSnapshot, stamp: electronicsCurriculumStamp(dir) };
			}
			const files = readSeeds();
			if (files.length === 0) return null;
			const seeded = applySeedFiles(files, { ...opts, createdAt: new Date().toISOString(), promptVersion: SEED_VERSION });
			if (!seeded.ok) invalid(seeded.errors);
			snapshot = seeded.snapshot;
			writeFileAtomicSync(ledgerFile, JSON.stringify(seeded.envelope) + "\n");
		} else {
			const entries = ledger.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
			const replay = replayLedger(entries, opts);
			if (!replay.ok) invalid(replay.errors);
			snapshot = replay.snapshot;
			if (stored !== undefined) {
				const current = JSON.parse(stored) as CurriculumSnapshot;
				const sameVersion = current.version === snapshot.version;
				const diverged = sameVersion && (
					current.certificate.hash !== snapshot.certificate.hash ||
					canonicalJson(current.items) !== canonicalJson(snapshot.items) ||
					canonicalJson(current.edges) !== canonicalJson(snapshot.edges)
				);
				if (current.version > snapshot.version || diverged) {
					throw new Error("O snapshot local de Eletrônica diverge do ledger e foi preservado.");
				}
			}

			if (entries[0].provenance.promptVersion === "seed-v1" && !entries.some((entry) => isSeedRevision(entry) && entry.revision === REVISION)) {
				const original = entries.length === 1 ? replay : replayLedger(entries.slice(0, 1), opts);
				if (!original.ok) invalid(original.errors);
				const revision = revisionFor(snapshot, original.snapshot);
				let migrated = applySeedRevision(snapshot, revision, opts);
				if (!migrated.ok) {
					// Independently valid local graph edits may conflict with the released graph.
					// Keep the installed prerequisites if the merged graph fails certification.
					const reasons = migrated.errors;
					for (const [id, fields] of Object.entries(revision.items)) {
						delete fields.clauses;
						delete fields.softPrereqs;
						if (Object.keys(fields).length === 0) delete revision.items[id];
					}
					migrated = applySeedRevision(snapshot, revision, opts);
					if (!migrated.ok) invalid(migrated.errors);
					console.warn("[curriculum] Eletrônica: pré-requisitos locais preservados após conflito na revisão", reasons.slice(0, 3));
				}
				if (!ledger.endsWith("\n")) ledger += "\n";
				writeFileAtomicSync(ledgerFile, ledger + JSON.stringify(revision) + "\n");
				snapshot = migrated.next;
			}
		}

		const serialized = JSON.stringify(snapshot);
		if (stored !== serialized) writeFileAtomicSync(snapshotFile, serialized);
		return { snapshot, stamp: electronicsCurriculumStamp(dir) };
	});
}
