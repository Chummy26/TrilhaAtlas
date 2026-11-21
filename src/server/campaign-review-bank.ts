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
const REVIEW_BANK_CACHE_KEY = Symbol.for("learnharness.server.reviewBank");

function reviewBankCache(): Map<string, { stamp: string; reviews: CampaignReview[] }> {
	const g = globalThis as typeof globalThis & { [REVIEW_BANK_CACHE_KEY]?: Map<string, { stamp: string; reviews: CampaignReview[] }> };
	return (g[REVIEW_BANK_CACHE_KEY] ??= new Map());
}

export function reviewBankFile(domain: string) {
	return path.join(curriculumDir(PATHS.data, domain), "review-bank.json");
}
export function storedReviews(domain: string): CampaignReview[] {
	const file = path.resolve(reviewBankFile(domain));
	const cache = reviewBankCache();
	const stat = fs.statSync(/* turbopackIgnore: true */ file, { bigint: true, throwIfNoEntry: false });
	if (!stat || !stat.isFile()) {
		cache.delete(file);
		return [];
	}
	const stamp = `${stat.dev}|${stat.ino}|${stat.ctimeNs}|${stat.mtimeNs}|${stat.size}`;
	const cached = cache.get(file);
	if (cached && cached.stamp === stamp) return [...cached.reviews];
	const reviews = JSON.parse(fs.readFileSync(file, "utf8")) as CampaignReview[];
	if (cache.size >= 32 && !cache.has(file)) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	cache.set(file, { stamp, reviews });
	return [...reviews];
}
export function availableReviews(domain: string) {
	return [...(domain === "english" ? englishMissionReviews : []), ...storedReviews(domain)];
}
