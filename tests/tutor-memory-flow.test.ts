import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";
import { CONTEXT_BUDGETS } from "../src/core/memory/assemble.ts";
import { estimateTokens } from "../src/core/memory/tokens.ts";
import { newAnswerResult, newGraphContextMessage, newUserMessage } from "../src/core/native-messages.ts";
import { normalizeOptions, seededRandom, shuffleOptions } from "../src/core/question-core.ts";
import { tinyPdf } from "./helpers/tiny-pdf.ts";

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

async function lesson(domain: string | null, kind: "teach" | "practice" = "teach", selectedNode?: string) {
	switchStudyDomain(domain);
	const nodeId = selectedNode ?? (domain ? studyToday().next!.nodeId : undefined);
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
	const focus = "en.speaking.a1.greetings";
	const first = await lesson("english", "teach", focus);
	const { studyDomains } = await import("../src/server/study.ts");
	studyDomains().updateProfile("english", p => ({ ...p, goal: { ...p.goal, text: "Present a field report" }, dailyBudgetMin: 200 }));
	const firstContext = await ask(first, original);
	assert.ok(firstContext.includes("Present a field report") && firstContext.includes("200 min"));
	const frontier = studyLearnerPrompt("english", [focus])!.prompt.frontier[0]!.title;
	assert.ok(firstContext.includes(frontier));
	assert.ok(!firstContext.includes(original));
	const english = service.get("english")!;
	await english.flush();
	assert.deepEqual(english.sessionMessages(first.id).map(m => m.text), [original, "Let us practise together."]);
	const fact = english.allFacts()[0]!;
	assert.equal(fact.quote, original);
	assert.deepEqual(fact.sourceMsgIds, [english.sessionMessages(first.id)[0]!.id]);
	assert.deepEqual(calls, ["english/extract", "english/consolidate"]);

	const { POST: upload, DELETE: unlink } = await import("../app/api/study/materials/route.ts");
	const nodeId = english.sessionMessages(first.id)[0]!.nodeIds[0]!;
	const uploadUrl = "http://local/api/study/materials?" + new URLSearchParams({ domain: "english", node: nodeId, pdf: "" });
	const quote = "The saffron notebook illustrates how prepositions express location.";
	const pdf = tinyPdf([{ runs: [{ text: "A different introductory page.", x: 72, y: 700 }] }, { runs: [{ text: quote, x: 72, y: 700 }] }]);
	const form = new FormData();
	form.set("file", new File([Uint8Array.from(pdf)], "Grammar field notes.pdf", { type: "application/pdf" }));
	const uploaded = await upload(new Request(uploadUrl, { method: "POST", body: form }));
	assert.equal(uploaded.status, 200);
	const linked = (await uploaded.json()).localReadings[0];
	assert.ok(linked.readable);

	const second = await lesson("english", "teach", focus);
	const secondContext = await ask(second, lookup);
	assert.ok(secondContext.includes("## Leitura da região"));
	assert.ok(secondContext.includes("Grammar field notes") && secondContext.includes("página física 2") && !secondContext.includes("página física 1-2"));
	assert.ok(secondContext.includes(quote), "the model actually receives the searchable text extracted from the regional PDF");
	const unrelatedNode = "en.listening.a1.personal-info";
	assert.notEqual(unrelatedNode, nodeId);
	const unrelated = newGraphContextMessage([{ id: unrelatedNode, name: "Personal information", statement: "" }], []);
	assert.ok(!(await tutorMemoryText(english, second.id, [unrelated, newUserMessage(lookup)], 2500)).includes(quote),
		"searching identical words in another region does not include the book");
	assert.match(secondContext, /Fronteira:/);
	assert.ok(secondContext.includes(`[aluno disse] ${original}`) || secondContext.includes(`fonte: “${original}”`),
		"the next lesson must receive an attributed learner quotation from the previous lesson");
	assert.ok(!secondContext.includes(hidden));
	assert.ok(estimateTokens(secondContext) <= CONTEXT_BUDGETS.total);
	await english.flush();
	assert.ok(!JSON.stringify(english.sessionMessages(second.id)).includes(quote), "derived textbook excerpts never become learner statements");
	const bounded = await tutorMemoryText(english, second.id, [newUserMessage(lookup)], 80);
	assert.ok(bounded.length > 0 && estimateTokens(bounded) <= 80);
	assert.equal(await tutorMemoryText(english, second.id, [newUserMessage(lookup)], 1), "");

	// Keep the same curriculum focus when updating a previously grounded preference.
	await ask(first, corrected);
	await english.flush();
	const updated = english.allFacts().find(f => f.quote === corrected)!;
	assert.equal(english.allFacts().find(f => f.id === fact.id)?.supersededBy, updated.id);
	assert.equal(english.sessionMessages(first.id).length, 4);
	const practice = await lesson("english", "practice", focus);
	const beforePractice = calls.length;
	assert.ok((await ask(practice, lookup)).includes(corrected));
	await english.flush();
	assert.equal(english.hasSession(practice.id), false);
	assert.equal(calls.length, beforePractice);

	const electronics = await lesson("electronics");
	const otherContext = await ask(electronics, lookup);
	assert.match(otherContext, /Fronteira:/);
	assert.ok(!otherContext.includes(quote));
	assert.ok(!otherContext.includes("Present a field report"));
	assert.doesNotMatch(otherContext, /saffron|indigo|notebook preference/i);
	await service.get("electronics")!.flush();

	const general = await lesson(null);
	const previousOpens = opens.length;
	assert.equal(await ask(general, lookup), "");
	assert.equal(opens.length, previousOpens);
	switchStudyDomain("english");
	const removed = await unlink(new Request(uploadUrl + linked.id, { method: "DELETE" }));
	assert.equal(removed.status, 200);
	const afterRemoval = await tutorMemoryText(english, second.id, [newUserMessage(lookup)], 2500);
	assert.ok(!afterRemoval.includes(quote) && !afterRemoval.includes("Leitura da região"));
});

it("sends two distinct graded mistakes on the current prerequisite and clears the suggestion after a correct check", async () => {
	const { saveStudyAnswer, studyDomains } = await import("../src/server/study.ts");
	const domain = "electronics";
	const prerequisite = "ee.math.algebra.sci-notation.powers-of-ten";
	const skill = "ee.math.algebra.sci-notation.si-prefixes";
	const source = await lesson(domain, "teach", prerequisite);
	const practice = await lesson(domain, "practice", skill);
	studyDomains().updateManifest(domain, manifest => ({ ...manifest, backgroundBudget: { ...manifest.backgroundBudget, enabled: false } }));
	const reader = () => ask(practice, "Quero aplicar potências de dez aos prefixos.");
	const heading = "Erros recentes em questões distintas";
	function check(id: string, question: string, correctAnswer: string, wrongAnswer: string, correct = false) {
		const options = [{ label: correctAnswer }, { label: wrongAnswer }];
		const input = { type: "check", nodeId: "powers", question, options, correctAnswer, explanation: "Gabarito interno." };
		const call = fauxAssistantMessage([fauxToolCall("quiz", input, { id })], { stopReason: "toolUse" });
		const previous = [...chatStore.getChat(source.id)!.messages, { ...call, id: "ask-" + id }];
		const selected = correct ? correctAnswer : wrongAnswer;
		const order = shuffleOptions(normalizeOptions(options), seededRandom(id));
		const submission = newAnswerResult(id, "quiz", { kind: "quiz", answers: [
			{ label: selected, value: selected, index: order.findIndex(o => o.value === selected) + 1 },
		] });
		saveStudyAnswer(source.id, previous, submission, () => chatStore.saveMessages(source.id, [...previous, submission]));
	}
	const first = "Qual a forma decimal de 10⁻³?";
	const second = "Como escrever 2 × 10⁻⁴ em decimal?";
	check("one", first, "0,001", "1000");
	check("duplicate", first, "0,001", "1000");
	assert.ok(!(await reader()).includes(heading), "repeating the same question is one observation");
	check("two", second, "0,0002", "20000");
	const beforeRepair = await reader();
	assert.ok(beforeRepair.includes(heading) && beforeRepair.includes(first) && beforeRepair.includes(second));
	assert.ok(beforeRepair.includes("1000") && beforeRepair.includes("20000"));
	assert.ok(beforeRepair.includes("/chat/" + source.id));
	assert.doesNotMatch(beforeRepair, /0,0002|Gabarito interno/);
	const teacher = await lesson(domain, "teach", skill);
	assert.ok((await ask(teacher, "Retomar a aula de prefixos.")).includes(heading));
	const other = await lesson(domain, "practice", "ee.digital.boolean.boolean-algebra");
	assert.ok(!(await ask(other, "Retomar a habilidade selecionada.")).includes(heading));

	check("success", "Qual a forma decimal de 3 × 10⁻²?", "0,03", "300", true);
	assert.ok(!(await reader()).includes(heading));
	check("again-one", first, "0,001", "1000");
	check("again-two", second, "0,0002", "20000");
	assert.ok((await reader()).includes(heading));
	assert.ok(chatStore.deleteChat(source.id));
	assert.ok(!(await reader()).includes(heading), "deleted source conversations must not return through the learner ledger");
});

it("puts the prior unit on the teaching wire and keeps an identical query in another branch local", async () => {
	const source = await lesson("electronics", "teach", "ee.math.algebra.sci-notation.powers-of-ten");
	const prior = "Na calibração dos expoentes marquei a amostra violeta.";
	await ask(source, prior);
	await service.get("electronics")!.flush();
	const query = "Que amostra marquei na calibração dos expoentes?";
	const resumed = await lesson("electronics", "teach", "ee.math.algebra.sci-notation.si-prefixes");
	const scoped = await ask(resumed, query);
	assert.ok(scoped.includes(prior));
	assert.ok(estimateTokens(scoped) <= 2400);
	const unrelated = await lesson("electronics", "teach", "ee.digital.boolean.boolean-algebra");
	assert.ok(!(await ask(unrelated, query)).includes(prior));
	const noNode = await tutorMemoryText(service.get("electronics")!, "free", [newUserMessage(query)], 2400);
	assert.ok(!noNode.includes(prior));
});
