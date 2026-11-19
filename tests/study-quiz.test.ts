import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { dismissedAnswer, normalizeOptions, seededRandom, shuffleOptions } from "../src/core/question-core.ts";
import type { LearnerEvent } from "../src/core/learner/types.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-quiz-"));
process.env.LH_DATA_DIR = root;
process.env.OPENROUTER_API_KEY = "test-key";
const { POST: create } = await import("../app/api/chats/route.ts");
const { POST: dismiss } = await import("../app/api/chats/[id]/dismiss/route.ts");
const { runningTurn } = await import("../src/server/turn-runs.ts");
const { createTeacherAgent } = await import("../src/agent/teacher-agent.ts");
const { handleChatRequest } = await import("../src/server/chat-handler.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { switchStudyDomain, studyToday, studyProfile, recordStudyEvent } = await import("../src/server/study.ts");
after(() => fs.rmSync(root, { recursive: true, force: true }));

function log(domain: string): LearnerEvent[] {
	const file = path.join(root, "domains", domain, "learner", "events.jsonl");
	return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [];
}

async function lesson(domainId: string, nodeId: string, minutes: number) {
	return create(new Request("http://local/api/chats", { method: "POST", body: JSON.stringify({
		title: "Aula", studyLesson: { domainId, minutes },
		graphContext: { propositions: [{ id: nodeId, name: "Tema", statement: "Aula" }] },
	}) }));
}

it("binds checks to their own lesson, recovers an interrupted append and credits the first check once", async (t) => {
	switchStudyDomain("electronics");
	const nodeId = studyToday().next!.nodeId;
	const first = await (await lesson("electronics", nodeId, 20)).json();
	const second = await (await lesson("electronics", nodeId, 40)).json();
	assert.deepEqual(log("electronics").map(e => e.kind === "exposure" && e.sessionId), [first.id, second.id]);
	chatStore.saveSettings(first.id, { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" } });
	const options = [{ label: "A" }, { label: "B" }, { label: "C" }];
	const quiz = { type: "check", nodeId: "local-step", question: "Q?", options, correctAnswer: "B", explanation: "B." };
	const questions = [
		{ ...quiz, type: "predict" }, quiz, { ...quiz, multiSelect: true, correctAnswer: ["A", "C"] },
		{ ...quiz, multiSelect: true, correctAnswer: ["A", "C"] }, quiz, quiz, quiz,
	];
	const call = fauxAssistantMessage(questions.map((q, i) => fauxToolCall("quiz", q, { id: "q" + i })), { stopReason: "toolUse" });
	chatStore.saveMessages(first.id, [...chatStore.getChat(first.id)!.messages, { ...call, id: "ask" }]);
	function answer(i: number, values: string[], factory?: Parameters<typeof handleChatRequest>[1]) {
		const order = shuffleOptions(normalizeOptions(options), seededRandom("q" + i));
		const answers = values.map(value => ({ value, label: value, index: order.findIndex(o => o.value === value) + 1 }));
		return handleChatRequest(new Request("http://local/api/chat", { method: "POST", body: JSON.stringify({
			chatId: first.id, input: { type: "answer", toolCallId: "q" + i,
				answer: { kind: "quiz", dontKnow: !values.length, answers, correct: false, latencyMs: 1234 } },
		}) }), factory);
	}
	assert.equal((await answer(0, ["B"])).status, 200);
	assert.equal(log("electronics").length, 2);
	const append = fs.appendFileSync;
	const fault = t.mock.method(fs, "appendFileSync", (...args: Parameters<typeof append>) => {
		if (String(args[0]).endsWith("events.jsonl")) {
			append(args[0], String(args[1]).slice(0, 15));
			throw new Error("simulated disk failure");
		}
		return append(...args);
	});
	try { assert.equal((await answer(1, ["B"])).status, 200); } finally { fault.mock.restore(); }
	assert.equal(studyToday().pendingCheck?.sessionId, second.id);
	assert.equal(log("electronics").length, 3);
	assert.equal((await answer(1, ["B"])).ok, false);
	const logFile = path.join(root, "domains", "electronics", "learner", "events.jsonl");
	// A complete last JSON row can survive a crash without its trailing newline.
	fs.truncateSync(logFile, fs.statSync(logFile).size - 1);
	assert.equal((await answer(2, ["A"])).status, 200);
	assert.equal((await answer(3, ["C", "A"])).status, 200);
	assert.equal((await answer(4, [])).status, 200);
	const skipped = await dismiss(new Request("http://local/dismiss", { method: "POST", body: JSON.stringify({
		input: { type: "dismiss", toolCallId: "q5", answer: dismissedAnswer("quiz", quiz.question) },
	}) }), { params: Promise.resolve({ id: first.id }) });
	assert.equal(skipped.status, 200);
	const faux = createFauxCore({});
	faux.setResponses([fauxAssistantMessage("Feedback.")]);
	const response = await answer(6, ["A"], opts => createTeacherAgent(undefined, {
		messages: opts.messages, engine: { model: faux.getModel(), streamFn: faux.streamSimple },
	}));
	assert.equal(response.status, 200);
	const turn = runningTurn(first.id);
	if (turn) await new Response(turn.subscribe()).text();
	const evidence = log("electronics").flatMap(e => e.kind === "evidence" ? [e.evidence] : []);
	assert.deepEqual(evidence.map(e => e.grade), [3, 0, 3, 0, 0]);
	for (const e of evidence) {
		assert.deepEqual(e.nodes, [{ nodeId, q: 1, primary: true }]);
		assert.equal(e.domainId, "electronics");
		assert.equal(e.sessionId, first.id);
		assert.equal(e.latencyMs, 1234);
		assert.equal(e.hints, 0);
		assert.equal(e.options, 3);
		assert.ok(e.minutesSinceExposure >= 0 && e.minutesSinceExposure < 1);
	}
	assert.equal(new Set(evidence.map(e => e.itemFamily)).size, 1);
	assert.equal(studyProfile().account.xp, 20);
	recordStudyEvent({ kind: "self-check", nodeId, sessionId: second.id, grade: 3 });
	assert.equal(studyToday().pendingCheck, null);
	assert.equal(studyProfile().account.xp, 60);
	switchStudyDomain("english");
	assert.equal((await lesson("electronics", nodeId, 20)).ok, false);
	assert.deepEqual(log("english"), []);
	switchStudyDomain(null);
	assert.equal((await lesson("electronics", nodeId, 20)).ok, false);
	assert.equal(fs.existsSync(path.join(root, "learner")), false);
});
