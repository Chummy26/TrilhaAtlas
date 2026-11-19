/**
 * Runtime validation of domain.json (DomainManifest) and profile.json
 * (DomainProfile) with zod 4 (docs/research/00-SINTESE.md §2.2–2.3; role
 * overrides from §2.9 / r5 §5.4).
 *
 * The TypeScript contracts live in ./types.ts and ../models/role-spec.ts;
 * these schemas are checked against them with `satisfies`, so a drift between
 * the type and the schema is a compile error. Objects are LOOSE: unknown keys
 * written by a newer build survive a read → write round trip instead of being
 * stripped. `schemaVersion` is a literal 1, so a future manifest version is
 * rejected with a clear message rather than misread.
 *
 * Domain ids must also be usable as a Windows folder name (no device names
 * such as "con"/"nul"; see paths.ts), the same rule paths.ts enforces.
 *
 * Pure and browser-safe (zod only). Messages are in pt-BR because they reach
 * the user when a hand-edited file is broken.
 */

import { z } from "zod";
import { MODEL_ROLES, type RoleSpec } from "../models/role-spec.ts";
import { isWindowsDeviceName } from "./paths.ts";
import { DOMAIN_ID_PATTERN, type DomainManifest, type DomainProfile } from "./types.ts";

export const NODE_PREFIX_PATTERN = /^[a-z][a-z0-9]{0,7}$/;

export class DomainManifestError extends Error {
	readonly issues: string[];
	constructor(message: string, issues: string[]) {
		super(message);
		this.name = "DomainManifestError";
		this.issues = issues;
	}
}

const billingSchema = z.enum(["subscription", "api", "local"]);

export const roleSpecSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("pinned"),
		provider: z.string().min(1),
		id: z.string().min(1),
		thinkingLevel: z.string().min(1).optional(),
	}),
	z.object({
		kind: z.literal("auto"),
		prefer: z.enum(["strongest", "cheapest", "fastest", "balanced"]),
		connection: z.string().min(1).optional(),
		avoidConnection: z.string().min(1).optional(),
		require: z
			.object({
				reasoning: z.literal(true).optional(),
				input: z.array(z.string().min(1)).optional(),
				minContext: z.number().int().positive().optional(),
				billing: z.array(billingSchema).optional(),
			})
			.optional(),
	}),
]) satisfies z.ZodType<RoleSpec>;

const domainIdSchema = (message: string) =>
	z
		.string()
		.regex(DOMAIN_ID_PATTERN, message)
		.refine((id) => !isWindowsDeviceName(id), "Id de domínio reservado pelo Windows (con, nul, aux, prn, com1…, lpt1…).");

const localizedTextSchema = z.object({ pt: z.string().min(1), en: z.string().min(1) });

const bandSchema = (what: string, opts: { int: boolean }) =>
	z
		.object({ lo: opts.int ? z.number().int().positive() : z.number().positive(), hi: opts.int ? z.number().int().positive() : z.number().positive() })
		.refine((band) => band.lo <= band.hi, { message: `${what}: "lo" deve ser ≤ "hi".` });

const langTagSchema = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, "Use uma tag BCP-47 (ex.: \"en\", \"pt-BR\").");

export const resourcePolicySchema = z.looseObject({
	videoAudioLangs: z.array(langTagSchema).min(1),
	captionLangs: z.array(langTagSchema),
	allowAutoDub: z.boolean(),
	requireOriginalAudio: langTagSchema.optional(),
	lessonLang: langTagSchema,
	videoMinutes: bandSchema("videoMinutes", { int: false }),
});

export const domainManifestSchema = z
	.looseObject({
		schemaVersion: z.literal(1, { error: "schemaVersion não suportado (esta versão lê apenas 1)." }),
		id: domainIdSchema("Id de domínio inválido (letras minúsculas, dígitos e hífen; 2–40 caracteres)."),
		nodePrefix: z.string().regex(NODE_PREFIX_PATTERN, "nodePrefix inválido (1–8 caracteres minúsculos, começando por letra)."),
		title: localizedTextSchema,
		accent: z.string().min(1),
		icon: z.string().min(1),
		levelScheme: z.enum(["cefr", "ee", "generic"]),
		targetHours: bandSchema("targetHours", { int: false }),
		edgeMode: z.enum(["strict", "relaxed"]),
		reviewClient: z.enum(["app", "anki"]),
		roles: z.partialRecord(z.enum(MODEL_ROLES), roleSpecSchema).optional(),
		backgroundBudget: z.object({ enabled: z.boolean(), tokensPerDay: z.number().int().nonnegative() }),
		resourcePolicy: resourcePolicySchema,
		createdAt: z.iso.datetime({ offset: true }),
	}) satisfies z.ZodType<DomainManifest>;

export const domainProfileSchema = z.looseObject({
	domainId: domainIdSchema("Id de domínio inválido."),
	dailyBudgetMin: z.number().int().min(1).max(1440),
	goal: z.object({ text: z.string(), targetNodeIds: z.array(z.string().min(1)) }),
	specialization: z.string().min(1).optional(),
	startingLevel: z.string().min(1).optional(),
	updatedAt: z.iso.datetime({ offset: true }),
}) satisfies z.ZodType<DomainProfile>;

function issuesOf(error: z.ZodError): string[] {
	return error.issues.map((issue) => `${issue.path.length ? issue.path.join(".") : "(raiz)"}: ${issue.message}`);
}

/** Validate an unknown value as a DomainManifest; throws DomainManifestError listing every issue. */
export function parseDomainManifest(value: unknown, source = "domain.json"): DomainManifest {
	const parsed = domainManifestSchema.safeParse(value);
	if (parsed.success) return parsed.data;
	const issues = issuesOf(parsed.error);
	throw new DomainManifestError(`${source} inválido: ${issues.join("; ")}`, issues);
}

/** Validate an unknown value as a DomainProfile; throws DomainManifestError listing every issue. */
export function parseDomainProfile(value: unknown, source = "profile.json"): DomainProfile {
	const parsed = domainProfileSchema.safeParse(value);
	if (parsed.success) return parsed.data;
	const issues = issuesOf(parsed.error);
	throw new DomainManifestError(`${source} inválido: ${issues.join("; ")}`, issues);
}

/** Non-throwing variant for listings: the manifest or the list of issues. */
export function checkDomainManifest(value: unknown): { ok: true; manifest: DomainManifest } | { ok: false; issues: string[] } {
	const parsed = domainManifestSchema.safeParse(value);
	return parsed.success ? { ok: true, manifest: parsed.data } : { ok: false, issues: issuesOf(parsed.error) };
}
