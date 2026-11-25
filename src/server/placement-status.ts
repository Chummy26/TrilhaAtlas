import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";
import { learnerDir } from "../core/domains/paths.ts";
import {
	isPlacementHint,
	type PlacementHint,
	type PlacementSummary,
	type SerializedDiagnostic,
} from "../core/study/placement.ts";
import type { StudyTodayOnboarding } from "../core/study/types.ts";

export const MAX_PLACEMENT_QUESTIONS = 15;

export interface StoredPlacement {
	version: 1;
	domainId: string;
	curriculumHash: string;
	seed?: string;
	hint?: PlacementHint;
	startingLevel?: PlacementHint;
	startedAt?: string;
	diagnostic: SerializedDiagnostic | null;
	lastSummary?: PlacementSummary;
	finishedAt?: string;
}

export function placementFile(domainId: string): string {
	return path.join(learnerDir(PATHS.data, domainId), "placement.json");
}

export function readStoredPlacement(domainId: string): StoredPlacement | null {
	const file = placementFile(domainId);
	let raw: string;
	try {
		raw = fs.readFileSync(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	try {
		const parsed = JSON.parse(raw) as Partial<StoredPlacement>;
		if (parsed.version !== 1 || parsed.domainId !== domainId) return null;
		const seed = typeof parsed.seed === "string" && parsed.seed.trim()
			? parsed.seed.trim()
			: typeof parsed.diagnostic?.seed === "string" && parsed.diagnostic.seed.trim()
				? parsed.diagnostic.seed.trim()
				: undefined;
		const hint = isPlacementHint(parsed.hint)
			? parsed.hint
			: isPlacementHint(parsed.diagnostic?.hint)
				? parsed.diagnostic.hint
				: undefined;
		const startingLevel = isPlacementHint(parsed.startingLevel) ? parsed.startingLevel : undefined;
		return {
			version: 1,
			domainId,
			curriculumHash: typeof parsed.curriculumHash === "string" ? parsed.curriculumHash : "",
			...(seed ? { seed } : {}),
			...(hint ? { hint } : {}),
			...(startingLevel ? { startingLevel } : {}),
			...(typeof parsed.startedAt === "string" ? { startedAt: parsed.startedAt } : {}),
			diagnostic: parsed.diagnostic ?? null,
			...(parsed.lastSummary ? { lastSummary: parsed.lastSummary } : {}),
			...(typeof parsed.finishedAt === "string" ? { finishedAt: parsed.finishedAt } : {}),
		};
	} catch {
		return null;
	}
}

/** Lightweight onboarding/placement summary for TodayCard and lesson opening calibration. */
export function readDomainOnboardingStatus(domainId: string, hasProgress: boolean): StudyTodayOnboarding {
	const stored = readStoredPlacement(domainId);
	if (stored?.diagnostic) {
		const asked = stored.diagnostic.answers.length;
		return {
			needsPlacement: false,
			placementStatus: "in-progress",
			...(stored.hint ? { startingLevel: stored.hint } : {}),
			asked,
			maxQuestions: MAX_PLACEMENT_QUESTIONS,
		};
	}
	if (stored?.startingLevel === "beginner" && (!stored.lastSummary || stored.lastSummary.asked === 0)) {
		return {
			needsPlacement: false,
			placementStatus: "beginner",
			startingLevel: "beginner",
			placedCount: 0,
			placedPct: 0,
		};
	}
	if (stored?.lastSummary || stored?.finishedAt) {
		const placedCount = stored.lastSummary?.placedCount ?? 0;
		const placedPct = stored.lastSummary?.placedPct ?? 0;
		const inferredLevel: PlacementHint = stored.startingLevel
			?? (placedPct >= 45 ? "advanced" : placedPct >= 10 ? "intermediate" : "beginner");
		return {
			needsPlacement: false,
			placementStatus: "completed",
			startingLevel: inferredLevel,
			placedCount,
			placedPct,
		};
	}
	return {
		needsPlacement: !hasProgress,
		placementStatus: "unassessed",
	};
}
