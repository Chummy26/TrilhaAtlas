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
const { switchStudyDomain, studyToday, studyProfile, studyMap, finishStudyLesson, lessonCompletionState } = await import("../src/server/study.ts");
const { lessonNodeOfChat, studyMapLesson } = await import("../src/server/study-materials.ts");
const { createMemoryService, HashEmbedder } = await import("../src/server/memory/index.ts");
const memory = createMemoryService({ dataRoot: root, embedder: new HashEmbedder() });
after(async () => {
	await memory.close();
	fs.rmSync(root, { recursive: true, force: true });
});

function log(domain: string): LearnerEvent[] {
	const file = path.join(root, "domains", domain, "learner", "events.jsonl");
	return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [];
}

it("keeps the first lesson for each session and refreshes the navigation index after external writes", () => {
	const domain = "navigation-test";
	const dir = path.join(root, "domains", domain, "learner");
	const file = path.join(dir, "events.jsonl");
	const line = (sessionId: string, nodeId: string) => JSON.stringify({ kind: "exposure", source: "ai_lesson", sessionId, nodeId }) + "\n";
	assert.equal(lessonNodeOfChat(domain, "a"), null);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(file, line("a", "first") + line("a", "later"));
	assert.equal(lessonNodeOfChat(domain, "a"), "first");
	assert.equal(lessonNodeOfChat(domain, "b"), null);
	fs.appendFileSync(file, line("b", "new"));
	assert.equal(lessonNodeOfChat(domain, "b"), "new");
	fs.unlinkSync(file);
	assert.equal(lessonNodeOfChat(domain, "a"), null);
});

async function lesson(domainId: string, nodeId: string, minutes: number, exploratory = false) {
	return create(new Request("http://local/api/chats", { method: "POST", body: JSON.stringify({
		title: "Aula", studyLesson: { domainId, minutes, exploratory },
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
		}) }), factory, undefined, async domain => {
			await memory.open(domain);
			return memory.get(domain)!;
		});
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
	assert.equal(lessonCompletionState("electronics", first.id)?.completed, false);
	const fromQuiz = finishStudyLesson("electronics", first.id, 3);
	assert.equal(fromQuiz.after, fromQuiz.before);
	assert.equal(fromQuiz.resume, null); // An older attempt on this same skill is not the next mission.
	assert.equal(lessonCompletionState("electronics", first.id)?.completed, true);
	assert.equal(finishStudyLesson("electronics", first.id, 1).alreadyCompleted, true);
	assert.equal(log("electronics").filter(e => e.kind === "lesson-finished").length, 1);
	const fromSelfCheck = finishStudyLesson("electronics", second.id, 3);
	assert.equal(fromSelfCheck.after - fromSelfCheck.before, 40);
	assert.notEqual(fromSelfCheck.next?.nodeId, nodeId);
	assert.equal(finishStudyLesson("electronics", second.id, 3).alreadyCompleted, true);
	assert.throws(() => finishStudyLesson("english", second.id, 3), /domínio/);
	assert.equal(studyToday().pendingCheck, null);
	assert.equal(studyProfile().account.xp, 60);
	switchStudyDomain("english");
	assert.equal((await lesson("electronics", nodeId, 20)).ok, false);
	assert.deepEqual(log("english"), []);
	switchStudyDomain(null);
	assert.equal((await lesson("electronics", nodeId, 20)).ok, false);
	assert.equal(fs.existsSync(path.join(root, "learner")), false);
});

it("keeps exploratory chats separate and accepts evidence only from an answered skill quiz", async () => {
	switchStudyDomain("electronics");
	const before = studyToday();
	const position = studyMap().position;
	const node = "ee.digital.boolean.boolean-algebra";
	const region = "ee.digital.boolean";
	const domain = "electronics";
	const side = await (await lesson(domain,node,15,true)).json();
	const tour = await (await lesson(domain,region,15,true)).json();
	assert.ok(side.id && tour.id);
	assert.equal((await studyMapLesson(domain,node)).explorationId,side.id);
	assert.equal((await studyMapLesson(domain,region)).explorationId,tour.id);
	assert.ok((await studyMapLesson(domain,node)).missing.some(m => m.id.endsWith("number-systems")));
	assert.equal(studyMap().position,position);
	assert.deepEqual(studyToday().next,before.next);
	assert.deepEqual(studyToday().pendingCheck,before.pendingCheck);
	assert.deepEqual(studyToday().progress,before.progress);
	const evidenceCount = () => log(domain).filter(e => e.kind === "evidence").length;
	const initial = evidenceCount();
	for (const [id,expected] of [[tour.id,initial],[side.id,initial+1]] as const) {
		chatStore.saveSettings(id, {model:{provider:"openrouter",id:"z-ai/glm-5.3-flash"}});
		const chat = chatStore.getChat(id)!;
		const input = { type: "check", nodeId: "local", question: "Q?", options: [{ label: "A" }, { label: "B" }], correctAnswer: "B", explanation: "B." };
		const call = fauxAssistantMessage([fauxToolCall("quiz",input,{id:"q-side"})], {stopReason:"toolUse"});
		chatStore.saveMessages(id,[...chat.messages,{...call,id:"test-side"}]);
		const faux = createFauxCore({});
		faux.setResponses([fauxAssistantMessage("Feedback.")]);
		const result = await handleChatRequest(new Request("http://local/api/chat", {method:"POST",body:JSON.stringify({
			chatId:id,input:{type:"answer",toolCallId:"q-side",answer:{kind:"quiz",dontKnow:true,answers:[]}},
		})}), opts => createTeacherAgent(undefined, {messages:opts.messages,engine:{model:faux.getModel(),streamFn:faux.streamSimple}}),
		undefined, async domainId => { await memory.open(domainId); return memory.get(domainId)!; });
		assert.equal(result.status,200);
		const turn = runningTurn(id);
		if (turn) await new Response(turn.subscribe()).text();
		assert.equal(evidenceCount(),expected);
	}
});
