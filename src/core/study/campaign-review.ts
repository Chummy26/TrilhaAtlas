import type { LearnerEvent } from "../learner/types.ts";
import { LEARNER_CONSTANTS } from "../learner/params.ts";

export interface CampaignReview {
	id: string;
	nodeId: string;
	nodeVersion?: number;
	level?: 1 | 2 | 3;
	format?: "mcq" | "short";
	prompt: string;
	answers: string[];
	explanation: string;
}

/** Preserve signs, accents, decimal separators and meaningful case (e.g. SI units). */
export function matchesReviewAnswer(review: CampaignReview, input: string) {
	const normalize = (s: string) => s.normalize("NFC").trim().replace(/\s+/gu, " ");
	return review.answers.some(answer => normalize(answer) === normalize(input));
}

/** The oldest due lesson wins. Keys stay on the server until submission. */
export function eligibleReview(bank: readonly CampaignReview[], events: readonly LearnerEvent[], now: string) {
	if (!bank.length) return;
	const learned = new Set<string>();
	const last = new Map<string, number>();
	const used = new Set<string>();
	for (const event of events) {
		if (event.kind === "node-version") {
			learned.delete(event.nodeId);
		} else if (event.kind === "exposure") {
			if (!event.exploratory) learned.add(event.nodeId);
			last.set(event.nodeId, Math.max(last.get(event.nodeId) ?? 0, Date.parse(event.at)));
		} else if (event.kind === "evidence") {
			const e = event.evidence;
			used.add(e.itemId);
			for (const ref of e.nodes) last.set(ref.nodeId, Math.max(last.get(ref.nodeId) ?? 0, Date.parse(e.at)));
		}
	}
	const cutoff = Date.parse(now) - LEARNER_CONSTANTS.delayedMinutes * 60_000;
	let oldest = Infinity;
	let chosen: CampaignReview | undefined;
	for (const task of bank) {
		const at = last.get(task.nodeId);
		if (at !== undefined && at <= cutoff && at < oldest && learned.has(task.nodeId) && !used.has(task.id)) {
			oldest = at;
			chosen = task;
		}
	}
	return chosen;
}
