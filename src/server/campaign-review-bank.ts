import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { PATHS } from "../../config.ts";
import { curriculumDir } from "../core/domains/paths.ts";
import type { CampaignReview } from "../core/study/campaign-review.ts";
import { englishMissionReviews } from "./english-mission-reviews.ts";

const text = z.string().trim().min(10).max(500);
export const reviewPairSchema = z.array(z.strictObject({ prompt: text, answers: z.array(z.string().trim().min(1).max(100)).min(1).max(8), explanation: text }))
	.length(2).refine(pair => new Set(pair.map(t => t.prompt.toLowerCase())).size === 2, "Use dois casos diferentes.");
export function reviewBankFile(domain: string) {
	return path.join(curriculumDir(PATHS.data, domain), "review-bank.json");
}
export function storedReviews(domain: string): CampaignReview[] {
	const file = reviewBankFile(domain);
	return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
}
export function availableReviews(domain: string) {
	return [...(domain === "english" ? englishMissionReviews : []), ...storedReviews(domain)];
}
