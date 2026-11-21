/**
 * Academic transcript and retention-cooling report for a study domain.
 * Strictly separates attained skills, durable spaced recall, and full mastery,
 * computes honest letter/status grades from FSRS retrievability + durability,
 * and surfaces cooling-module alerts ordered by urgency.
 *
 * Pure and browser-safe: no Node APIs, no I/O, no wall clock.
 */

import type { CurriculumSnapshot } from "../curriculum/types.ts";
import { FSRS_STATE, retrievability } from "../learner/fsrs.ts";
import type { LearnerGraphView } from "../learner/graph-view.ts";
import { DEFAULT_LEARNER_PARAMS } from "../learner/params.ts";
import type { LearnerSnapshot } from "../learner/types.ts";
import { chapterUnitsOf, type StudyCampaign } from "./campaign.ts";

export type TranscriptGradeLabel = "A" | "B" | "C" | "Reforço" | "Em curso";

export interface TranscriptModuleRow {
	moduleId: string;
	moduleTitle: string;
	chapterLevel: string;
	chapterTitle: string;
	index: number;
	total: number;
	attained: number;
	durable: number;
	mastered: number;
	reviewedCount: number;
	avgRetention: number | null;
	durableRatio: number;
	gradeLabel: TranscriptGradeLabel;
	examScore?: number;
	examPassed?: boolean;
	examAt?: string;
}

export interface TranscriptChapterRow {
	level: string;
	title: string;
	index: number;
	total: number;
	attained: number;
	durable: number;
	mastered: number;
	reviewedCount: number;
	avgRetention: number | null;
	durableRatio: number;
	gradeLabel: TranscriptGradeLabel;
	modules: TranscriptModuleRow[];
}

export interface CoolingAlert {
	moduleId: string;
	moduleTitle: string;
	chapterLevel: string;
	avgRetention: number;
	affectedCount: number;
	topNodeId: string;
	topNodeTitle: string;
}

export interface DomainTranscript {
	domainId: string;
	domainTitle: string;
	at: string;
	total: number;
	attained: number;
	durable: number;
	mastered: number;
	reviewedCount: number;
	avgRetention: number | null;
	durableRatio: number;
	gradeLabel: TranscriptGradeLabel;
	chapters: TranscriptChapterRow[];
	coolingAlerts: CoolingAlert[];
}

export interface BuildDomainTranscriptInput {
	domainId: string;
	domainTitle: string;
	snapshot: CurriculumSnapshot;
	graph: LearnerGraphView;
	learner: LearnerSnapshot;
	campaign: StudyCampaign;
	known: ReadonlySet<string>;
	at: string;
	moduleScores?: ReadonlyMap<string, { score: number; passed: boolean; at: string }>;
}

const COOLING_THRESHOLD = 0.85;

function round4(value: number): number {
	return Math.round(value * 10_000) / 10_000;
}

function gradeFor(avgRetention: number | null, durableRatio: number): TranscriptGradeLabel {
	if (avgRetention === null) return "Em curso";
	if (avgRetention >= 0.9 && durableRatio >= 0.5) return "A";
	if (avgRetention >= 0.82) return "B";
	if (avgRetention >= 0.72) return "C";
	return "Reforço";
}

function durableRatioFor(durable: number, attained: number, reviewedCount: number): number {
	const denom = attained > 0 ? attained : reviewedCount;
	return denom > 0 ? round4(Math.min(1, durable / denom)) : 0;
}

/** Build an honest academic transcript and FSRS cooling-alert list for a domain. */
export function buildDomainTranscript(input: BuildDomainTranscriptInput): DomainTranscript {
	const {
		domainId,
		domainTitle,
		snapshot,
		graph,
		learner,
		campaign,
		at,
		moduleScores,
	} = input;

	const structure = chapterUnitsOf(snapshot, graph, campaign);
	const coolingAlerts: CoolingAlert[] = [];

	let domainTotal = 0;
	let domainAttained = 0;
	let domainDurable = 0;
	let domainMastered = 0;
	let domainReviewed = 0;
	let domainRetentionSum = 0;

	const chapters: TranscriptChapterRow[] = structure.map((cu, chapterIdx) => {
		let chTotal = 0;
		let chAttained = 0;
		let chDurable = 0;
		let chMastered = 0;
		let chReviewed = 0;
		let chRetentionSum = 0;

		const modules: TranscriptModuleRow[] = cu.modules.map((mod, modIdx) => {
			let modAttained = 0;
			let modDurable = 0;
			let modMastered = 0;
			let modRetentionSum = 0;
			const fsrsNodes: { id: string; title: string; retention: number }[] = [];

			for (const id of mod.leafIds) {
				const st = learner.nodes[id];
				if (st?.lessonCompletedAt || st?.attainedAt || st?.placedAt) modAttained++;
				if (st?.independentRecallAt || (st?.delayedSuccesses ?? 0) >= 1) modDurable++;
				if (st?.masteredAt) modMastered++;

				if (st?.fsrs && st.fsrs.state !== FSRS_STATE.new && st.fsrs.lastReviewAt) {
					const r = retrievability(st.fsrs, at, DEFAULT_LEARNER_PARAMS);
					modRetentionSum += r;
					fsrsNodes.push({
						id,
						title: graph.nodes.get(id)?.title ?? snapshot.items[id]?.title.pt ?? id,
						retention: r,
					});
				}
			}

			const modTotal = mod.leafIds.length;
			const modReviewed = fsrsNodes.length;
			const modAvgRetention = modReviewed > 0 ? round4(modRetentionSum / modReviewed) : null;
			const modDurableRatio = durableRatioFor(modDurable, modAttained, modReviewed);
			const modGrade = gradeFor(modAvgRetention, modDurableRatio);
			const score = moduleScores?.get(mod.id);

			if (modReviewed >= 1 && modAvgRetention !== null && modAvgRetention < COOLING_THRESHOLD) {
				fsrsNodes.sort((a, b) => a.retention - b.retention || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
				const lowest = fsrsNodes[0]!;
				const affectedCount = fsrsNodes.filter((n) => n.retention < COOLING_THRESHOLD).length;
				coolingAlerts.push({
					moduleId: mod.id,
					moduleTitle: mod.title,
					chapterLevel: cu.chapter.level,
					avgRetention: modAvgRetention,
					affectedCount,
					topNodeId: lowest.id,
					topNodeTitle: lowest.title,
				});
			}

			chTotal += modTotal;
			chAttained += modAttained;
			chDurable += modDurable;
			chMastered += modMastered;
			chReviewed += modReviewed;
			chRetentionSum += modRetentionSum;

			return {
				moduleId: mod.id,
				moduleTitle: mod.title,
				chapterLevel: cu.chapter.level,
				chapterTitle: cu.chapter.title,
				index: modIdx + 1,
				total: modTotal,
				attained: modAttained,
				durable: modDurable,
				mastered: modMastered,
				reviewedCount: modReviewed,
				avgRetention: modAvgRetention,
				durableRatio: modDurableRatio,
				gradeLabel: modGrade,
				...(score !== undefined ? { examScore: score.score, examPassed: score.passed, examAt: score.at } : {}),
			};
		});

		const chAvgRetention = chReviewed > 0 ? round4(chRetentionSum / chReviewed) : null;
		const chDurableRatio = durableRatioFor(chDurable, chAttained, chReviewed);
		const chGrade = gradeFor(chAvgRetention, chDurableRatio);

		domainTotal += chTotal;
		domainAttained += chAttained;
		domainDurable += chDurable;
		domainMastered += chMastered;
		domainReviewed += chReviewed;
		domainRetentionSum += chRetentionSum;

		return {
			level: cu.chapter.level,
			title: cu.chapter.title,
			index: chapterIdx + 1,
			total: chTotal,
			attained: chAttained,
			durable: chDurable,
			mastered: chMastered,
			reviewedCount: chReviewed,
			avgRetention: chAvgRetention,
			durableRatio: chDurableRatio,
			gradeLabel: chGrade,
			modules,
		};
	});

	coolingAlerts.sort(
		(a, b) => a.avgRetention - b.avgRetention
			|| b.affectedCount - a.affectedCount
			|| (a.moduleId < b.moduleId ? -1 : a.moduleId > b.moduleId ? 1 : 0),
	);

	const domainAvgRetention = domainReviewed > 0 ? round4(domainRetentionSum / domainReviewed) : null;
	const domainDurableRatio = durableRatioFor(domainDurable, domainAttained, domainReviewed);
	const domainGrade = gradeFor(domainAvgRetention, domainDurableRatio);

	return {
		domainId,
		domainTitle,
		at,
		total: domainTotal,
		attained: domainAttained,
		durable: domainDurable,
		mastered: domainMastered,
		reviewedCount: domainReviewed,
		avgRetention: domainAvgRetention,
		durableRatio: domainDurableRatio,
		gradeLabel: domainGrade,
		chapters,
		coolingAlerts,
	};
}
