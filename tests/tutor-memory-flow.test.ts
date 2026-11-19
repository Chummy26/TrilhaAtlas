import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxThinking } from "@earendil-works/pi-ai";
import { CONTEXT_BUDGETS } from "../src/core/memory/assemble.ts";
import { estimateTokens } from "../src/core/memory/tokens.ts";
import { newUserMessage } from "../src/core/native-messages.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-tutor-memory-flow-"));
process.env.LH_DATA_DIR = root;
process.env.LH_AUTH_FILE = path.join(root, "auth.json");
process.env.OPENROUTER_API_KEY = "offline-test";
const { POST: createChat } = await import("../app/api/chats/route.ts");
const { handleChatInput } = await import("../src/server/chat-handler.ts");
const { createTeacherAgent, createPracticeAgent } = await import("../src/agent/teacher-agent.ts");
const { createTutorMemoryService, tutorMemoryText } = await import("../src/server/memory/tutor.ts");
const { HashEmbedder } = await import("../src/server/memory/hash-embedder.ts");
const { extractJson } = await import("../src/server/memory/extractor.ts");
const { studyLearnerPrompt, studyToday, switchStudyDomain } = await import("../src/server/study.ts");
const { runningTurn } = await import("../src/server/turn-runs.ts");
const { chatStore } = await import("../src/store/chats.ts");

const original = "I prefer the saffron notebook for practising English prepositions.";
const corrected = original.replace("saffron", "indigo");
const lookup = "Which notebook did I prefer for practising English prepositions?";
const hidden = "INTERNAL THINKING SENTINEL";
const label = "[Study memory";
const calls: string[] = [];

interface Source {
	id: string;
	role: string;
	text: string;
	nodeIds: string[];
}

const service = createTutorMemoryService({
	embedder: new HashEmbedder(),
	callFor: domain => async request => {
		calls.push(domain + "/" + request.op);
		const payload = extractJson(request.messages[0]!.content) as { messages: Source[]; pairs: { pairId: string }[] };
		if (request.op === "extract") {
			const facts = payload.messages.filter(m => m.role === "user" && [original, corrected].includes(m.text)).map(m => ({
				kind: "preference", text: "Notebook preference: " + m.text, quote: m.text,
				nodeIds: m.nodeIds, sourceMsgIds: [m.id], confidence: 0.5,
			}));
			return { text: JSON.stringify({ facts }) };
		}
		if (request.op === "judge") return { text: JSON.stringify({ verdicts: payload.pairs.map(p => ({ pairId: p.pairId, verdict: "UPDATES" })) }) };
		assert.equal(request.op, "consolidate");
		return { text: JSON.stringify({ observations: [], mentalModelOps: [] }) };
	},
});

after(async () => {
	await service.close();
	fs.rmSync(root, { recursive: true, force: true });
});

const opens: string[] = [];
async function openMemory(domain: string) {
	opens.push(domain);
	await service.open(domain);
	return service.get(domain)!;
}

async function lesson(domain: string | null, kind: "teach" | "practice" = "teach") {
	switchStudyDomain(domain);
	const nodeId = domain ? studyToday().next!.nodeId : undefined;
	const graphContext = nodeId ? { propositions: [{ id: nodeId, name: "Lesson", statement: "Session focus." }] } : undefined;
	const response = await createChat(new Request("http://local/api/chats", { method: "POST", body: JSON.stringify({
		title: "Study", kind, graphContext, studyLesson: domain && kind === "teach" ? { domainId: domain, minutes: 15 } : undefined,
	}) }));
	assert.equal(response.status, 200);
	const { id } = await response.json() as { id: string };
	chatStore.saveSettings(id, { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" } });
	return { id, kind };
}

async function ask(chat: Awaited<ReturnType<typeof lesson>>, text: string) {
	const faux = createFauxCore({});
	const wire: string[][] = [];
	faux.setResponses([ctx => {
		assert.equal(ctx.messages[0]?.role, "system", "the tutor prompt and tool declarations must stay first");
		wire.push(ctx.messages.filter(m => m.role === "user").map(m => typeof m.content === "string" ? m.content :
			m.content.flatMap(block => block.type === "text" ? [block.text] : []).join("\n")));
		return fauxAssistantMessage([fauxThinking(hidden), fauxText("Let us practise together.")]);
	}]);
	const response = await handleChatInput(chat.id, { type: "text", text }, opts => {
		const build = { ...opts, engine: { model: faux.getModel(), streamFn: faux.streamSimple }, tools: {} };
		return chat.kind === "practice" ? createPracticeAgent({ chatId: chat.id, chatStore }, build) : createTeacherAgent(undefined, build);
	}, undefined, openMemory);
	assert.equal(response.status, 200, await response.text());
	const turn = runningTurn(chat.id);
	if (turn) await new Response(turn.subscribe()).text();
	assert.equal(wire.length, 1);
	const userTurns = wire[0]!;
	assert.equal(userTurns.at(-1), text);
	assert.ok(!JSON.stringify(chatStore.getChat(chat.id)!.messages).includes(label));
	return userTurns.filter(m => m.startsWith(label)).join("\n");
}

it("passes grounded memory and the learner snapshot on the real model wire, scoped to the study domain", async () => {
	const first = await lesson("english");
	const firstContext = await ask(first, original);
	const frontier = studyLearnerPrompt("english")!.prompt.frontier[0]!.title;
	assert.ok(firstContext.includes(frontier));
	assert.ok(!firstContext.includes(original));
	const english = service.get("english")!;
	await english.flush();
	assert.deepEqual(english.sessionMessages(first.id).map(m => m.text), [original, "Let us practise together."]);
	const fact = english.allFacts()[0]!;
	assert.equal(fact.quote, original);
	assert.deepEqual(fact.sourceMsgIds, [english.sessionMessages(first.id)[0]!.id]);
	assert.deepEqual(calls, ["english/extract", "english/consolidate"]);

	const second = await lesson("english");
	const secondContext = await ask(second, lookup);
	assert.match(secondContext, /Fronteira:/);
	assert.ok(secondContext.includes(`[aluno disse] ${original}`) || secondContext.includes(`fonte: “${original}”`),
		"the next lesson must receive an attributed learner quotation from the previous lesson");
	assert.ok(!secondContext.includes(hidden));
	assert.ok(estimateTokens(secondContext) <= CONTEXT_BUDGETS.total);
	await english.flush();
	const bounded = await tutorMemoryText(english, second.id, [newUserMessage(lookup)], 80);
	assert.ok(bounded.length > 0 && estimateTokens(bounded) <= 80);
	assert.equal(await tutorMemoryText(english, second.id, [newUserMessage(lookup)], 1), "");

	// Keep the same curriculum focus when updating a previously grounded preference.
	await ask(first, corrected);
	await english.flush();
	const updated = english.allFacts().find(f => f.quote === corrected)!;
	assert.equal(english.allFacts().find(f => f.id === fact.id)?.supersededBy, updated.id);
	assert.equal(english.sessionMessages(first.id).length, 4);
	const practice = await lesson("english", "practice");
	const beforePractice = calls.length;
	assert.ok((await ask(practice, lookup)).includes(corrected));
	await english.flush();
	assert.equal(english.hasSession(practice.id), false);
	assert.equal(calls.length, beforePractice);

	const electronics = await lesson("electronics");
	const otherContext = await ask(electronics, lookup);
	assert.match(otherContext, /Fronteira:/);
	assert.doesNotMatch(otherContext, /saffron|indigo|notebook preference/i);
	await service.get("electronics")!.flush();

	const general = await lesson(null);
	const previousOpens = opens.length;
	assert.equal(await ask(general, lookup), "");
	assert.equal(opens.length, previousOpens);
});
