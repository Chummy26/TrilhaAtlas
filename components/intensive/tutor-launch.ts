"use client";

import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import {
	formatTimestamp,
	type CertStatus,
	type CourseDerivedStatus,
	type CourseManualStatus,
	type IntensiveDashboardDTO,
	type IntensiveMaterialSearchHit,
	type IntensiveSearchHit,
	type PacingSettings,
	type PortfolioProjectStatus,
	type StudyLogEntry,
	type Translator,
} from "@/src/core";
import {
	SessionStarter,
	type IntensiveSessionContextInput,
	type SessionCreation,
} from "../start-session.ts";

export type IntensiveTab = "quests" | "watch" | "certs" | "portfolio" | "pacing";

export type IntensiveTutorLaunchContext = IntensiveSessionContextInput;

export interface ModuleSearchHit {
	courseId: string;
	courseTitle: string;
	moduleId: string;
	moduleTitle: string;
	score: number;
	snippet: string;
}

export interface IntensiveSearchResponse {
	transcriptHits: IntensiveSearchHit[];
	moduleHits: ModuleSearchHit[];
	materialHits?: IntensiveMaterialSearchHit[];
}

export type IntensiveMutation =
	| { kind: "set-pacing"; pacing: Partial<PacingSettings> }
	| { kind: "toggle-module"; courseId: string; moduleId: string; completed: boolean }
	| { kind: "update-module"; courseId: string; moduleId: string; completed?: boolean; loggedMinutes?: number; notes?: string }
	| { kind: "toggle-video-watched"; courseId: string; lessonId: string; watched: boolean; durationSec?: number }
	| { kind: "update-video-progress"; courseId: string; lessonId: string; positionSec: number; durationSec?: number; watched?: boolean; notes?: string }
	| { kind: "add-video-bookmark"; courseId: string; lessonId: string; timeSec: number; label: string; note?: string }
	| { kind: "remove-video-bookmark"; courseId: string; lessonId: string; bookmarkId: string }
	| { kind: "update-course"; courseId: string; optedIn?: boolean; manualStatus?: CourseManualStatus; courseNotes?: string }
	| { kind: "add-course-link"; courseId: string; moduleId?: string; label: string; url: string }
	| { kind: "remove-course-link"; courseId: string; moduleId?: string; linkId: string }
	| {
		kind: "update-certification";
		certId: string;
		status?: CertStatus;
		targetDate?: string;
		scheduledAt?: string;
		passedAt?: string;
		credentialId?: string;
		credentialUrl?: string;
		mockScorePct?: number;
		notes?: string;
	}
	| { kind: "toggle-cert-checkpoint"; certId: string; checkpointIndex: number; completed: boolean }
	| { kind: "update-portfolio"; projectId: string; status?: PortfolioProjectStatus; repoUrl?: string; notes?: string }
	| { kind: "toggle-portfolio-deliverable"; projectId: string; deliverableId: string; completed: boolean }
	| { kind: "toggle-bench-interview"; itemId: string; checked: boolean }
	| { kind: "toggle-bench-kit"; itemId: string; owned: boolean }
	| { kind: "log-study"; entry: Omit<StudyLogEntry, "id" | "createdAt"> };

/** Translates client mutations into the exact wire shape parsed by `PATCH /api/intensive`. */
function serializeIntensiveMutation(mutation: IntensiveMutation): Record<string, unknown> {
	if (mutation.kind === "set-pacing") {
		return { type: "set-pacing", ...mutation.pacing };
	}
	if (mutation.kind === "log-study") {
		return { type: "log-study", ...mutation.entry };
	}
	const { kind, ...rest } = mutation;
	return { type: kind, ...rest };
}

export async function mutateIntensive(mutation: IntensiveMutation): Promise<IntensiveDashboardDTO> {
	const res = await fetch("/api/intensive", {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(serializeIntensiveMutation(mutation)),
	});
	if (!res.ok) {
		const payload = (await res.json().catch(() => null)) as { error?: string } | null;
		throw new Error(payload?.error || `HTTP ${res.status}`);
	}
	return (await res.json()) as IntensiveDashboardDTO;
}

export async function launchIntensiveTutor(
	starter: SessionStarter,
	router: AppRouterInstance,
	params: {
		title: string;
		openingPrompt: string;
		intensiveContext: IntensiveTutorLaunchContext;
		materialId?: string;
		kind?: "practice";
	},
): Promise<void> {
	const intensiveContext: IntensiveTutorLaunchContext = {
		...params.intensiveContext,
		...(params.materialId && !params.intensiveContext.materialId
			? { materialId: params.materialId }
			: {}),
	};
	const body: SessionCreation = {
		title: params.title,
		...(params.kind ? { kind: params.kind } : {}),
		intensiveContext,
	};
	const destination = await starter.start(body, fetch, undefined, params.openingPrompt);
	router.push(destination);
}

export function formatMaterialSize(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return "";
	if (bytes < 1024) return `${Math.round(bytes)} B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${Math.round(kb)} KB`;
	const mb = kb / 1024;
	return mb >= 10 ? `${mb.toFixed(0)} MB` : `${mb.toFixed(1)} MB`;
}

export function formatMinutesAsClock(minutes: number): string {
	const safe = Math.max(0, Math.round(minutes));
	const h = Math.floor(safe / 60);
	const m = safe % 60;
	if (h === 0) return `${m} min`;
	if (m === 0) return `${h}h`;
	return `${h}h${String(m).padStart(2, "0")}`;
}

export function formatHoursCompact(hours: number): string {
	if (!Number.isFinite(hours) || hours <= 0) return "0";
	return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

export function formatVerifiedDate(isoDate: string): string {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
	if (!m) return isoDate;
	return `${m[3]}/${m[2]}/${m[1]}`;
}

export function courseStatusLabel(t: Translator, status: CourseDerivedStatus): string {
	switch (status) {
		case "completed":
			return t("intensive.quests.statusCompleted");
		case "in-progress":
			return t("intensive.quests.statusInProgress");
		case "paused":
			return t("intensive.quests.statusPaused");
		default:
			return t("intensive.quests.statusNotStarted");
	}
}

export function formatVideoMoment(sec: number): string {
	return formatTimestamp(sec);
}

export interface IntensiveArtSet {
	hero: string;
	certs: string;
	portfolio: string;
	tiers: Record<1 | 2 | 3 | 4, string>;
}

const ELECTRONICS_ART_SET: IntensiveArtSet = {
	hero: "/intensive/electronics/hero-workbench.jpg",
	certs: "/intensive/electronics/cert-emblem.jpg",
	portfolio: "/intensive/electronics/bench-portfolio.jpg",
	tiers: {
		1: "/intensive/electronics/tier-1-bench.jpg",
		2: "/intensive/electronics/tier-2-pcb.jpg",
		3: "/intensive/electronics/tier-3-embedded.jpg",
		4: "/intensive/electronics/tier-4-library.jpg",
	},
};

const GENERIC_ART_SET: IntensiveArtSet = {
	hero: "/art/hero-syllabus.jpg",
	certs: "/art/hero-profile.jpg",
	portfolio: "/art/hero-practice.jpg",
	tiers: {
		1: "/art/hero-syllabus.jpg",
		2: "/art/hero-tree.jpg",
		3: "/art/hero-practice.jpg",
		4: "/art/hero-flashcards.jpg",
	},
};

/** Selects domain-appropriate cel-shaded illustrations so Electronics art never leaks into other domains. */
export function intensiveArtSet(domainId?: string | null): IntensiveArtSet {
	return domainId === "electronics" ? ELECTRONICS_ART_SET : GENERIC_ART_SET;
}

/** Shared cel-shaded tactile interactive control classes for Intensiva · Eletrônica. */
export const INTENSIVE_BTN_PRIMARY =
	"elec-btn-primary inline-flex min-h-11 items-center justify-center gap-2 px-4 py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--elec-volt)] disabled:pointer-events-none disabled:opacity-45 cursor-pointer";

export const INTENSIVE_BTN_SECONDARY =
	"elec-btn-secondary inline-flex min-h-11 items-center justify-center gap-2 px-3.5 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--elec-volt)] disabled:pointer-events-none disabled:opacity-45 cursor-pointer";

export const INTENSIVE_BTN_ON_DARK =
	"elec-btn-on-dark inline-flex min-h-11 items-center justify-center gap-2 px-3.5 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--elec-volt)] disabled:pointer-events-none disabled:opacity-45 cursor-pointer";

export const INTENSIVE_BTN_COMPACT =
	"elec-btn-secondary inline-flex min-h-9 items-center justify-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--elec-volt)] disabled:pointer-events-none disabled:opacity-45 cursor-pointer";

export const INTENSIVE_BTN_COMPACT_PRIMARY =
	"elec-btn-primary inline-flex min-h-9 items-center justify-center gap-1.5 px-3 py-1.5 text-[13px] font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--elec-volt)] disabled:pointer-events-none disabled:opacity-45 cursor-pointer";

export const INTENSIVE_INPUT =
	"w-full rounded-[10px] border-[1.5px] border-border/75 bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-[border-color,box-shadow] duration-150 focus-visible:border-[var(--elec-volt)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--elec-volt)]";

export const INTENSIVE_SELECT_AUTO =
	"w-auto rounded-[10px] border-[1.5px] border-border/75 bg-background px-3 py-2 text-sm text-foreground transition-[border-color,box-shadow] duration-150 focus-visible:border-[var(--elec-volt)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--elec-volt)]";
