/**
 * Study domains (docs/research/00-SINTESE.md §2.2–2.3).
 *
 * A domain is an isolated study world (English, Electronics, …): its own
 * curriculum graph, learner model, memory, chats, resources, progress and
 * flashcards, stored under `<LH_DATA_DIR>/domains/<domainId>/`. Nothing reads
 * across domains except explicit `external_ref` numeric snapshots.
 *
 * Pure types: browser-safe.
 */

import type { ModelRole, RoleSpec } from "../models/role-spec.ts";

/** Readable folder/URL-safe id. Node ids inside the domain use `nodePrefix`. */
export type DomainId = "english" | "electronics" | (string & {});

export interface LocalizedText {
	pt: string;
	en: string;
}

export type DomainLevelScheme = "cefr" | "ee" | "generic";

export interface DomainResourcePolicy {
	/** Spoken-audio languages acceptable for videos, best first (BCP-47 primary tags). */
	videoAudioLangs: string[];
	/** Caption languages that make a foreign-audio video acceptable. */
	captionLangs: string[];
	/** YouTube auto-dubbed audio tracks allowed (Electronics: yes; English: no). */
	allowAutoDub: boolean;
	/** Require original audio in this language (English: "en"). */
	requireOriginalAudio?: string;
	/** Preferred UI/explanation language for AI lessons. */
	lessonLang: string;
	/** Target video length band in minutes for an atom-level node. */
	videoMinutes: { lo: number; hi: number };
}

export interface DomainManifest {
	schemaVersion: 1;
	id: DomainId;
	/** Short prefix for node ids, e.g. "en" | "ee". */
	nodePrefix: string;
	title: LocalizedText;
	/** Accent token name or hex: "coral" (English), "volt" (Electronics). */
	accent: string;
	/** Icon name from the hand-drawn icon set. */
	icon: string;
	levelScheme: DomainLevelScheme;
	/** Target study hours for the full track (≈1000–1500 for 1y+ at 2–4 h/day). */
	targetHours: { lo: number; hi: number };
	/** Prerequisite semantics (r10): strict = AND/OR with ≤2 alternatives. */
	edgeMode: "strict" | "relaxed";
	/** Who schedules flashcard reviews: the app (FSRS-7) or Anki. */
	reviewClient: "app" | "anki";
	/** Per-domain model role overrides. */
	roles?: Partial<Record<ModelRole, RoleSpec>>;
	/** Consent for background model spend (memory consolidation, expansion, curation). */
	backgroundBudget: { enabled: boolean; tokensPerDay: number };
	resourcePolicy: DomainResourcePolicy;
	createdAt: string;
}

/** Learner-chosen settings for a domain (onboarding; editable). */
export interface DomainProfile {
	domainId: DomainId;
	/** Daily study budget in minutes (default 180). */
	dailyBudgetMin: number;
	/** Free-text goal and optional target node ids. */
	goal: { text: string; targetNodeIds: string[] };
	/** Electronics specialization (rf | analog-ic | power | embedded | general), English focus, etc. */
	specialization?: string;
	/** Self-reported or diagnosed starting level (e.g. "B1", "ee-band-1"). */
	startingLevel?: string;
	updatedAt: string;
}

export interface DomainSummary {
	id: DomainId;
	title: LocalizedText;
	accent: string;
	icon: string;
	active: boolean;
}

export const DOMAIN_ID_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;

export function isDomainId(value: unknown): value is DomainId {
	return typeof value === "string" && DOMAIN_ID_PATTERN.test(value);
}
