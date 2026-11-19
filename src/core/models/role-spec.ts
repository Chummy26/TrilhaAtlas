/**
 * Model roles and role specs (docs/research/00-SINTESE.md §2.9, r5).
 *
 * No model id is ever hardcoded in application code: every model call names a
 * ROLE, and a RoleSpec resolves that role against the live model registry
 * (entitlements discovered from the user's connections). `pinned` keeps an
 * explicit user choice; `auto` picks from whatever the registry currently
 * offers, so new models appear without a release.
 *
 * Pure types + tiny helpers: browser-safe.
 */

export type BillingKind = "subscription" | "api" | "local";

export const MODEL_ROLES = [
	"tutor",
	"grader",
	"planner",
	"curriculum",
	"critic",
	"extractor",
	"judge",
	"observer",
	"consolidator",
	"flashcards",
	"vision",
	"rubric",
] as const;

export type ModelRole = (typeof MODEL_ROLES)[number];

export type RolePreference = "strongest" | "cheapest" | "fastest" | "balanced";

export type RoleSpec =
	| { kind: "pinned"; provider: string; id: string; thinkingLevel?: string }
	| {
			kind: "auto";
			prefer: RolePreference;
			/** Prefer models from this connection (e.g. "chatgpt", "anthropic-api"). */
			connection?: string;
			/** Prefer a different connection than this one (critic diversity). */
			avoidConnection?: string;
			require?: {
				reasoning?: true;
				input?: string[];
				minContext?: number;
				billing?: BillingKind[];
			};
	  };

/** Default presets — the old strong/cheap/vision slots become these. */
export const DEFAULT_ROLE_SPECS: Readonly<Record<ModelRole, RoleSpec>> = Object.freeze({
	tutor: { kind: "auto", prefer: "strongest" },
	curriculum: { kind: "auto", prefer: "strongest" },
	planner: { kind: "auto", prefer: "strongest" },
	critic: { kind: "auto", prefer: "strongest" },
	grader: { kind: "auto", prefer: "cheapest" },
	extractor: { kind: "auto", prefer: "cheapest" },
	judge: { kind: "auto", prefer: "cheapest" },
	observer: { kind: "auto", prefer: "cheapest" },
	rubric: { kind: "auto", prefer: "cheapest" },
	consolidator: { kind: "auto", prefer: "balanced" },
	flashcards: { kind: "auto", prefer: "balanced" },
	vision: { kind: "auto", prefer: "balanced", require: { input: ["image"] } },
});

export function isModelRole(value: unknown): value is ModelRole {
	return typeof value === "string" && (MODEL_ROLES as readonly string[]).includes(value);
}
