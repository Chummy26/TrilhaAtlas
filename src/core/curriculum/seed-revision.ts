/** Internal ledger entry for shipped curriculum revisions. Local patches keep their own schema. */
import { z } from "zod";
import { checkRankCertificate, computeCertificate, effectiveClauseMap } from "./certificate.ts";
import { validateReport } from "./invariants.ts";
import type { ApplyPatchOptions } from "./patch.ts";
import { CurriculumIdSchema, CurriculumItemSchema, zodIssuesToErrors } from "./schema.ts";
import type { ApplyPatchResult, CurriculumSnapshot } from "./types.ts";

export const revisableItemFields = CurriculumItemSchema.omit({
	id: true,
	domainId: true,
	kind: true,
	parentId: true,
	provenance: true,
	version: true,
	status: true,
	estMinutesObserved: true,
	aliasOf: true,
	supersededBy: true,
}).shape;

const ItemRevisionSchema = z.strictObject(revisableItemFields).partial();
const SeedRevisionSchema = z.strictObject({
	kind: z.literal("seed-revision"),
	revision: z.string().min(1),
	domainId: z.string().min(1),
	baseVersion: z.number().int().positive(),
	createdAt: z.string().min(1),
	items: z.record(CurriculumIdSchema, ItemRevisionSchema),
});

export type SeedRevision = z.infer<typeof SeedRevisionSchema>;

export function isSeedRevision(entry: unknown): entry is SeedRevision {
	return typeof entry === "object" && entry !== null && "kind" in entry && entry.kind === "seed-revision";
}

export function applySeedRevision(snapshot: CurriculumSnapshot, raw: unknown, opts: ApplyPatchOptions): ApplyPatchResult {
	const parsed = SeedRevisionSchema.safeParse(raw);
	if (!parsed.success) return { ok: false, errors: zodIssuesToErrors(parsed.error, "seedRevision.") };
	const revision = parsed.data;
	if (revision.domainId !== snapshot.domainId || revision.baseVersion !== snapshot.version) {
		return { ok: false, errors: [{ code: "schema", message: "O domínio ou a versão base da revisão do seed diverge do currículo." }] };
	}

	const items = { ...snapshot.items };
	const changedIds = Object.keys(revision.items).sort();
	for (const id of changedIds) {
		const original = snapshot.items[id];
		if (!original || original.status === "deprecated") {
			return { ok: false, errors: [{ code: "unknown-id", message: `Nó indisponível na revisão do seed: ${id}` }] };
		}
		// Published corrections preserve the learner's evidence version.
		items[id] = { ...original, ...revision.items[id] };
	}
	const draft = { ...snapshot, items, version: snapshot.version + 1, updatedAt: revision.createdAt };
	const report = validateReport(draft, { ...opts, lint: false, schema: new Set(changedIds) });
	if (report.errors.length) return { ok: false, errors: report.errors };
	const certificate = computeCertificate(draft, report.sys!, report.order!);
	const check = checkRankCertificate(effectiveClauseMap(report.sys!), certificate.order);
	if (!check.ok) throw new Error(`curriculum: certificado de revisão recusado (${check.reason})`);
	return {
		ok: true,
		next: { ...draft, certificate },
		receipt: {
			patchId: revision.revision,
			appliedAt: revision.createdAt,
			fromVersion: snapshot.version,
			toVersion: draft.version,
			certificateHash: certificate.hash,
			addedIds: [],
			changedIds,
			autoApplied: true,
			undoable: false,
		},
	};
}
