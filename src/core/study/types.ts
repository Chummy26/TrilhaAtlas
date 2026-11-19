/**
 * Wire shapes of the study API (/api/domains, /api/study/*) — shared by the
 * server (src/server/study.ts) and the UI. Pure types: browser-safe.
 */

import type { DomainSummary } from "../domains/types.ts";
import type { PlanItem } from "../learner/types.ts";
import type { StudyNodeBrief } from "./projection.ts";

export interface StudyDomainList {
	domains: DomainSummary[];
	/** null = "Geral" (the original learnharness world). */
	active: string | null;
}

export interface StudyToday {
	domain: { id: string; title: string; accent: string; icon: string };
	/** False when the domain has no curriculum yet. */
	ready: boolean;
	next: (PlanItem & { brief: StudyNodeBrief }) | null;
	/** A lesson was started and not yet self-checked (≤ 3 days). */
	pendingCheck: { sessionId: string; exposureId: string; nodeId: string; title: string; at: string } | null;
	plan: { budgetMin: number; reviewMinutes: number; newMinutes: number; items: number };
	progress: { leaves: number; attained: number; mastered: number; totalHours: number; attainedHours: number };
}

/** GET /profile — light, honest numbers (estudos-sota §2.10–2.11). */
export interface StudyProfile {
	/** Account level from the XP of every domain. */
	account: { level: number; xp: number; xpIntoLevel: number; xpToNext: number; fraction: number };
	domains: {
		id: string;
		title: string;
		accent: string;
		icon: string;
		xp: number;
		lessons: number;
		tier: { label: string; pm: number; fractions: number[] };
		attained: number;
		mastered: number;
		leaves: number;
	}[];
	usage: {
		totalTokens: number;
		calls: number;
		byModel: { model: string; tokens: number; input: number; output: number; cached: number; calls: number }[];
	};
	/** Active minutes per day (last 14 days), measured from focused activity intervals. */
	days: { day: string; minutes: number }[];
}
