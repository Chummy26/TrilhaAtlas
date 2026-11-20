import assert from "node:assert/strict";
import { it } from "node:test";
import { eligibleReview, matchesReviewAnswer, type CampaignReview } from "../src/core/study/campaign-review.ts";
import { dividerLab } from "../src/core/divider-lab.ts";
import { day, evidence } from "./learner-fixtures.ts";
import type { LearnerEvent } from "../src/core/learner/types.ts";

const review: CampaignReview = { id: "x:1", nodeId: "x", prompt: "Qual é a tensão em volts?", answers: ["2,5", "2.5"], explanation: "A saída equivale à metade da entrada." };
const exposure: LearnerEvent = { kind: "exposure", nodeId: "x", seq: 1, sessionId: "s", domainId: "test", id: "e", source: "ai_lesson", minutes: 25, at: day(0) };

it("requires a real lesson, a full interval after the last check and an unused task", () => {
	assert.equal(eligibleReview([review], [], day(9)), undefined);
	assert.equal(eligibleReview([review], [{ ...exposure, exploratory: true }], day(2)), undefined);
	assert.equal(eligibleReview([review], [exposure], day(0.99)), undefined);
	assert.equal(eligibleReview([review], [exposure], day(1))?.id, review.id);
	const check = evidence({ nodeId: "x", seq: 2, at: day(0.5), grade: 0 });
	assert.equal(eligibleReview([review], [exposure, check], day(1)), undefined);
	assert.ok(check.kind === "evidence");
	check.evidence.itemId = review.id;
	assert.equal(eligibleReview([review], [exposure, check], day(3)), undefined);
	assert.ok(matchesReviewAnswer(review, "  2.5 "));
	assert.ok(!matchesReviewAnswer(review, "25"));
});

it("exports the calculated divider topology and SI values to both simulator formats", () => {
	const result = dividerLab(12, 1000, 2000);
	assert.equal(result.voltsOut, 8);
	assert.equal(result.milliamps, 4);
	assert.match(result.netlist, /R1 in out 1000\nR2 out 0 2000/);
	assert.match(new URL(result.falstad).searchParams.get("cct")!, /r 240 208 240 368 0 2000/);
	assert.throws(() => dividerLab(12, 0, 1000));
});
