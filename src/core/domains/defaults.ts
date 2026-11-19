/**
 * Built-in domain manifests and profile defaults (docs/research/00-SINTESE.md
 * §2.2–2.3, P14 background budget; resource policy from r6 §0.2, §7.3–7.4).
 *
 *  - english:      prefix "en", accent coral, CEFR levels. Videos must keep
 *                  the ORIGINAL English audio (no dubbing: dubbed input
 *                  defeats listening practice, r6 §7.4); captions en/pt;
 *                  lessons explained in pt-BR; 5–15 min (extensive listening).
 *  - electronics:  prefix "ee", accent volt, EE bands. Portuguese audio first,
 *                  English accepted with pt captions or automatic pt dubbing
 *                  (r6 §7.4 "dublagem automática PT é aceitável");
 *                  6–12 min (conceptual atom, r6 §7.3).
 *
 * Both: strict prerequisite edges (r10), the app schedules reviews (FSRS),
 * 1000–1500 target hours, background spend enabled at 300k tokens/day, and no
 * role overrides (the global RoleSpec presets apply).
 *
 * Pure: timestamps are parameters, never read from the clock.
 */

import type { DomainId, DomainManifest, DomainProfile, LocalizedText } from "./types.ts";

export const DEFAULT_TARGET_HOURS = Object.freeze({ lo: 1000, hi: 1500 });
export const DEFAULT_BACKGROUND_BUDGET = Object.freeze({ enabled: true, tokensPerDay: 300_000 });
export const DEFAULT_DAILY_BUDGET_MIN = 180;

export const BUILTIN_DOMAIN_IDS = ["english", "electronics"] as const;
export type BuiltinDomainId = (typeof BUILTIN_DOMAIN_IDS)[number];

export function isBuiltinDomainId(value: unknown): value is BuiltinDomainId {
	return typeof value === "string" && (BUILTIN_DOMAIN_IDS as readonly string[]).includes(value);
}

export function englishManifest(createdAt: string): DomainManifest {
	return {
		schemaVersion: 1,
		id: "english",
		nodePrefix: "en",
		title: { pt: "Inglês", en: "English" },
		accent: "coral",
		icon: "domain-english",
		levelScheme: "cefr",
		targetHours: { ...DEFAULT_TARGET_HOURS },
		edgeMode: "strict",
		reviewClient: "app",
		backgroundBudget: { ...DEFAULT_BACKGROUND_BUDGET },
		resourcePolicy: {
			videoAudioLangs: ["en"],
			captionLangs: ["en", "pt"],
			allowAutoDub: false,
			requireOriginalAudio: "en",
			lessonLang: "pt-BR",
			videoMinutes: { lo: 5, hi: 15 },
		},
		createdAt,
	};
}

export function electronicsManifest(createdAt: string): DomainManifest {
	return {
		schemaVersion: 1,
		id: "electronics",
		nodePrefix: "ee",
		title: { pt: "Eletrônica", en: "Electronics" },
		accent: "volt",
		icon: "domain-electronics",
		levelScheme: "ee",
		targetHours: { ...DEFAULT_TARGET_HOURS },
		edgeMode: "strict",
		reviewClient: "app",
		backgroundBudget: { ...DEFAULT_BACKGROUND_BUDGET },
		resourcePolicy: {
			videoAudioLangs: ["pt", "en"],
			captionLangs: ["pt"],
			allowAutoDub: true,
			lessonLang: "pt-BR",
			videoMinutes: { lo: 6, hi: 12 },
		},
		createdAt,
	};
}

/** The built-in manifest for `id`, or undefined for a custom domain. */
export function builtinManifest(id: DomainId, createdAt: string): DomainManifest | undefined {
	if (id === "english") return englishManifest(createdAt);
	if (id === "electronics") return electronicsManifest(createdAt);
	return undefined;
}

/** Every built-in manifest, in display order. */
export function builtinManifests(createdAt: string): DomainManifest[] {
	return [englishManifest(createdAt), electronicsManifest(createdAt)];
}

export interface CustomDomainInput {
	id: DomainId;
	nodePrefix: string;
	title: LocalizedText;
	createdAt: string;
	accent?: string;
	icon?: string;
	lessonLang?: string;
}

/** A user-created domain with generic levels and Portuguese-first resources. */
export function customManifest(input: CustomDomainInput): DomainManifest {
	const lessonLang = input.lessonLang ?? "pt-BR";
	return {
		schemaVersion: 1,
		id: input.id,
		nodePrefix: input.nodePrefix,
		title: { ...input.title },
		accent: input.accent ?? "ink",
		icon: input.icon ?? "domain-generic",
		levelScheme: "generic",
		targetHours: { ...DEFAULT_TARGET_HOURS },
		edgeMode: "strict",
		reviewClient: "app",
		backgroundBudget: { ...DEFAULT_BACKGROUND_BUDGET },
		resourcePolicy: {
			videoAudioLangs: ["pt", "en"],
			captionLangs: ["pt"],
			allowAutoDub: true,
			lessonLang,
			videoMinutes: { lo: 6, hi: 12 },
		},
		createdAt: input.createdAt,
	};
}

/** Onboarding defaults: 3 h/day, no goal yet. */
export function defaultDomainProfile(domainId: DomainId, updatedAt: string): DomainProfile {
	return {
		domainId,
		dailyBudgetMin: DEFAULT_DAILY_BUDGET_MIN,
		goal: { text: "", targetNodeIds: [] },
		updatedAt,
	};
}
