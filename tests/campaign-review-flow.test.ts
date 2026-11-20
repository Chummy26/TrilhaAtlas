import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";

it("keeps the answer key server-side, grades once and refuses cross-domain and future submissions", async t => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-heldout-"));
	process.env.LH_DATA_DIR = root;
	process.env.LH_AUTH_FILE = path.join(root, "auth.json");
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const { studyToday, switchStudyDomain } = await import("../src/server/study.ts");
	const { POST } = await import("../app/api/study/review/route.ts");
	const { appendStudyEvent, readStudyEvents } = await import("../src/server/study-log.ts");
	switchStudyDomain("electronics");
	const nodeId = studyToday().next!.nodeId;
	const bank = [{ id: "region:review:1", nodeId, prompt: "Quanto valem seis grupos de sete?", answers: ["42"], explanation: "Seis grupos de sete dão 42." }];
	const dir = path.join(root, "domains", "electronics", "curriculum");
	fs.writeFileSync(path.join(dir, "review-bank.json"), JSON.stringify(bank));
	function post(domain: string, answer: string) {
		return POST(new Request("http://local/api/study/review", { method: "POST", body: JSON.stringify({ domain, id: bank[0]!.id, answer }) }));
	}
	assert.equal((await post("english", "42")).status, 409);
	assert.equal((await post("electronics", "42")).status, 409);
	appendStudyEvent("electronics", { kind: "exposure", seq: 1, id: "lesson", at: new Date(Date.now() - 90000000).toISOString(), domainId: "electronics", sessionId: "s1", source: "ai_lesson", minutes: 30, nodeId });
	const visible = studyToday().review;
	assert.equal(visible?.prompt, bank[0]!.prompt);
	assert.ok(!JSON.stringify(visible).includes("42"));
	const response = await post("electronics", "41");
	assert.equal(response.status, 200);
	assert.equal((await response.json()).correct, false);
	assert.equal((await (await post("electronics", "42")).json()).correct, false);
	assert.equal(readStudyEvents("electronics").filter(e => e.kind === "evidence").length, 1);
	assert.equal(studyToday().review, undefined);
	const { prepareStudyReview } = await import("../src/server/prepare-study-review.ts");
	const { studyMap } = await import("../src/server/study.ts");
	const other = studyMap().nodes.find(n => n.leaf && n.id !== nodeId)!;
	appendStudyEvent("electronics", { kind: "exposure", source: "ai_lesson", seq: 3, id: "next", at: new Date().toISOString(), domainId: "electronics", sessionId: "s2", minutes: 20, nodeId: other.id });
	let calls = 0;
	const generate = async () => {
		calls++;
		return { text: JSON.stringify({ reviews: [1, 2].map(i => ({ prompt: "Compare o valor medido no caso " + i + ".", answers: ["secret-key"], explanation: "Compare a leitura com a escala conhecida." })) }),
			modelId: "fixture", inputTokens: 10, outputTokens: 50, cachedTokens: 0 };
	};
	const acks = await Promise.all([prepareStudyReview("electronics", "s2", generate), prepareStudyReview("electronics", "s2", generate)]);
	assert.equal(calls, 1);
	assert.ok(!JSON.stringify(acks).includes("secret-key"));
	assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "review-bank.json"), "utf8")).length, 3);
});
