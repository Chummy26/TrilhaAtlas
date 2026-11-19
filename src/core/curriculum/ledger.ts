/**
 * Ledger replay and seed application (docs/research/00-SINTESE.md §2.13
 * "Replay do ledger ⇒ mesmo hash"; r3 §4.6 "patches.jsonl é a fonte da
 * verdade"; r10 §6.3 passo [6]).
 *
 *   replayLedger(envelopes) — rebuilds a domain from its patch ledger: the
 *       first envelope must be the seed (it carries the domain root, see
 *       ./seed.ts); each envelope is applied with its own `createdAt` as the
 *       apply time, so the result — certificate hash included — is a pure
 *       function of the ledger.
 *   applySeedFiles(files) — seed files → seed envelope → version-1 snapshot.
 *       With `reduceTransitive` the seed's stored clauses are first reduced
 *       (r3 I5: implied edges are not stored, ./transitive.ts) and the
 *       envelope is regenerated, so the ledger keeps the reduced form.
 *
 * The I/O (patches.jsonl, rejected.jsonl) lives in src/store; this module is
 * pure and browser-safe.
 */

import { applyPatch, type ApplyPatchOptions } from "./patch.ts";
import { PatchEnvelopeSchema, zodIssuesToErrors } from "./schema.ts";
import { initialSnapshot, rootFromSeedEnvelope, seedFilesToPatch, type SeedPatchOptions } from "./seed.ts";
import { findRedundantPrereqs, reduceStoredClauses, type RedundantPrereq } from "./transitive.ts";
import type { CurriculumSnapshot, PatchEnvelope, PatchReceipt, ValidationError } from "./types.ts";

export type ReplayResult =
	| { ok: true; snapshot: CurriculumSnapshot; receipts: PatchReceipt[] }
	| { ok: false; errors: ValidationError[]; /** Index of the envelope that failed. */ failedAt: number };

/** Rebuild a snapshot from its full ledger (seed envelope first). */
export function replayLedger(envelopes: readonly unknown[], opts: Omit<ApplyPatchOptions, "now"> = {}): ReplayResult {
	if (envelopes.length === 0) return { ok: false, errors: [{ code: "schema", message: "ledger vazio: o primeiro patch deve ser o seed" }], failedAt: 0 };
	const first = PatchEnvelopeSchema.safeParse(envelopes[0]);
	if (!first.success) return { ok: false, errors: zodIssuesToErrors(first.error, "ledger[0]."), failedAt: 0 };
	const rootRes = rootFromSeedEnvelope(first.data as PatchEnvelope);
	if (!rootRes.ok) return { ok: false, errors: rootRes.errors, failedAt: 0 };
	let snapshot = initialSnapshot(rootRes.root, { now: first.data.createdAt });
	const receipts: PatchReceipt[] = [];
	for (let i = 0; i < envelopes.length; i++) {
		const res = applyPatch(snapshot, envelopes[i], opts);
		if (!res.ok) return { ok: false, errors: res.errors, failedAt: i };
		snapshot = res.next;
		receipts.push(res.receipt);
	}
	return { ok: true, snapshot, receipts };
}

export interface ApplySeedOptions extends SeedPatchOptions, Omit<ApplyPatchOptions, "now"> {
	/** Drop transitively implied clause members before the seed enters the ledger (default false). */
	reduceTransitive?: boolean;
}

export type ApplySeedResult =
	| { ok: true; snapshot: CurriculumSnapshot; envelope: PatchEnvelope; receipt: PatchReceipt; removed: RedundantPrereq[] }
	| { ok: false; errors: ValidationError[] };

/** Seed files → validated version-1 snapshot (+ the seed envelope to store as ledger entry 0). */
export function applySeedFiles(files: readonly unknown[], opts: ApplySeedOptions): ApplySeedResult {
	const build = (overrides?: ReadonlyMap<string, string[][]>) => {
		const seed = seedFilesToPatch(files, { ...opts, ...(overrides ? { clauseOverrides: overrides } : {}) });
		if (!seed.ok) return seed;
		const res = applyPatch(initialSnapshot(seed.root, { now: opts.createdAt }), seed.envelope, opts);
		return res.ok ? { ok: true as const, envelope: seed.envelope, snapshot: res.next, receipt: res.receipt } : res;
	};
	const first = build();
	if (!first.ok) return first;
	if (!opts.reduceTransitive) return { ...first, removed: [] };
	const removed = findRedundantPrereqs(first.snapshot);
	if (removed.length === 0) return { ...first, removed };
	const overrides = new Map<string, string[][]>();
	for (const id of new Set(removed.map((r) => r.item))) overrides.set(id, reduceStoredClauses(first.snapshot.items[id]!, removed));
	const second = build(overrides);
	return second.ok ? { ...second, removed } : second;
}
