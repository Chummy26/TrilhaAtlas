import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { projectView } from "../src/core/view.ts";
import { pendingLessonExam } from "../src/core/study/lesson-conclusion.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-lesson-flow-sim-"));
process.env.LH_DATA_DIR = root;
process.env.LH_AUTH_FILE = path.join(root, "auth.json");
process.env.OPENROUTER_API_KEY = "offline-sim-key";

const { POST: createChat } = await import("../app/api/chats/route.ts");
const { handleChatInput } = await import("../src/server/chat-handler.ts");
const { createTeacherAgent } = await import("../src/agent/teacher-agent.ts");
const { createTeacherTools } = await import("../src/agent/tools.ts");
const { createTutorMemoryService } = await import("../src/server/memory/tutor.ts");
const { HashEmbedder } = await import("../src/server/memory/hash-embedder.ts");
const { runningTurn } = await import("../src/server/turn-runs.ts");
const { chatStore } = await import("../src/store/chats.ts");
const {
	finishStudyLesson,
	lessonCompletionState,
	lessonConclusionObjective,
	studyMap,
	studyProfile,
	studyToday,
	switchStudyDomain,
} = await import("../src/server/study.ts");
const { prepareLessonExam, validateExamVerdict, validateLessonConclusion } = await import("../src/core/study/lesson-conclusion.ts");

const memory = createTutorMemoryService({ embedder: new HashEmbedder() });

after(async () => {
	await memory.close();
	fs.rmSync(root, { recursive: true, force: true });
});

async function openMemory(domain: string) {
	await memory.open(domain);
	return memory.get(domain)!;
}

async function startCampaignLesson(domainId: string, nodeId: string, minutes = 20) {
	const res = await createChat(new Request("http://local/api/chats", {
		method: "POST",
		body: JSON.stringify({
			title: "Aula " + nodeId,
			studyLesson: { domainId, minutes },
			graphContext: { propositions: [{ id: nodeId, name: nodeId, statement: "Aula da campanha." }] },
		}),
	}));
	assert.equal(res.status, 200);
	const { id } = (await res.json()) as { id: string };
	chatStore.saveSettings(id, { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" } });
	return id;
}

function buildRealMissionTools(domainId: string, chatId: string, attachLog: { topic: string; useLesson: boolean }[]) {
	const objective = lessonConclusionObjective(domainId, chatId);
	const missionMessages = () => projectView(chatStore.getChat(chatId)!.messages);
	return createTeacherTools({
		chatId,
		chatStore,
		jobStore: { create: () => { throw new Error("unused"); }, get: () => null, list: () => [], update: () => { throw new Error("unused"); } } as never,
		spawn: () => {},
		attachMaterials: async (topic, useLesson) => {
			attachLog.push({ topic, useLesson });
			return {
				items: [
					{ kind: "book", title: "All About Circuits — Vol. I", part: "Cap. 2: Lei de Ohm e potências de dez", url: "https://www.allaboutcircuits.com/textbook/direct-current/chpt-2/", suggested: false },
					{ kind: "video", title: "Notação científica aplicada a circuitos", part: "0:00–8:40", url: "https://www.youtube.com/watch?v=example123", suggested: false },
				],
			};
		},
		...(objective && {
			missionObjective: objective,
			presentLessonExam: input => {
				if (lessonCompletionState(domainId, chatId)?.completed) throw new Error("Esta aula já foi encerrada.");
				return { ...prepareLessonExam(missionMessages(), input), objectives: objective.objectives };
			},
			concludeLesson: async input => {
				const state = lessonCompletionState(domainId, chatId);
				if (!state || state.completed) throw new Error("Esta aula já foi encerrada.");
				const messages = missionMessages();
				const outcome = validateExamVerdict(messages, input, objective.objectives.length);
				const criteria = input.criteria!.map(item => ({ ...item, title: objective.objectives[item.objective - 1] }));
				if (outcome === "reinforce") {
					const receipt = finishStudyLesson(domainId, chatId, input.grade, { feedback: input.assessment });
					return { ...receipt, outcome, criteria, assessment: input.assessment, cards: null };
				}
				validateLessonConclusion(messages, input);
				const receipt = finishStudyLesson(domainId, chatId, input.grade);
				return { ...receipt, outcome, criteria, assessment: input.assessment, cards: input.cards.length };
			},
		}),
	});
}

async function runTurn(
	domainId: string,
	chatId: string,
	text: string,
	responses: Parameters<ReturnType<typeof createFauxCore>["setResponses"]>[0],
	opts: { examCallId?: string; attachLog?: { topic: string; useLesson: boolean }[]; capturedPrompts?: string[] } = {},
) {
	const faux = createFauxCore({});
	const wrapped = responses.map(fn => (...args: Parameters<Extract<typeof fn, (...a: never[]) => unknown>>) => {
		const ctx = args[0];
		const sys = ctx.messages.find(m => m.role === "system");
		if (opts.capturedPrompts && sys) {
			const content = typeof sys.content === "string" ? sys.content : sys.content.map(b => b.type === "text" ? b.text : "").join("\n");
			opts.capturedPrompts.push(content);
		}
		return typeof fn === "function" ? fn(...args) : fn;
	});
	faux.setResponses(wrapped);
	const res = await handleChatInput(
		chatId,
		{ type: "text", text, ...(opts.examCallId ? { examCallId: opts.examCallId } : {}) },
		agentOpts => createTeacherAgent(undefined, {
			...agentOpts,
			engine: { model: faux.getModel(), streamFn: faux.streamSimple },
			tools: buildRealMissionTools(domainId, chatId, opts.attachLog ?? []),
		}),
		undefined,
		openMemory,
	);
	if (res.ok) {
		const turn = runningTurn(chatId);
		if (turn) await new Response(turn.subscribe()).text();
	}
	return res;
}

it("Simulation 1: strictly blocks premature exams, 'I understood' bypasses, trivial criterion evidence, and duplicate retests", async () => {
	switchStudyDomain("electronics");
	const nodeId = studyToday().next!.nodeId;
	const probeChatId = await startCampaignLesson("electronics", nodeId, 20);
	const objective = lessonConclusionObjective("electronics", probeChatId);
	assert.ok(objective && objective.objectives.length >= 1);
	assert.ok(chatStore.deleteChat(probeChatId));

	// 1a. Fresh session: trying to present an exam before any teaching fails validation.
	const chatId = await startCampaignLesson("electronics", nodeId, 20);
	const toolErrors: string[] = [];
	const r0 = await runTurn("electronics", chatId, "Começar aula.", [
		() => fauxAssistantMessage([fauxToolCall("present_lesson_exam", { task: "Converta 0,0047 A para notação científica." }, { id: "early-exam" })], { stopReason: "toolUse" }),
		ctx => {
			const err = ctx.messages.findLast(m => m.role === "toolResult");
			if (err && err.role === "toolResult") toolErrors.push(err.content.map(c => c.type === "text" ? c.text : "").join(""));
			return fauxAssistantMessage([fauxText("Para escrever números muito pequenos em eletrônica, deslocamos a vírgula para a direita e usamos expoente negativo de base 10. Por exemplo, 0,0047 A equivale a 4,7 × 10⁻³ A. Tente agora expressar 0,0025 A em potência de dez?")]);
		},
	]);
	assert.equal(r0.status, 200);
	assert.ok(toolErrors.some(msg => /Ensine o conteúdo essencial/i.test(msg)), "server must reject presenting exam before teaching");

	// 1b. Learner says "Eu entendi tudo" -> trying to conclude without a formal exam fails validation.
	const r1 = await runTurn("electronics", chatId, "Eu entendi tudo, pode concluir!", [
		() => fauxAssistantMessage([fauxToolCall("conclude_lesson", {
			evidence: "Eu entendi tudo, pode concluir!",
			assessment: "Aluno disse que entendeu.",
			grade: 3,
			criteria: objective.objectives.map((_, i) => ({ objective: i + 1, met: true, reason: "Confirmou.", evidence: "Eu entendi tudo" })),
			cards: [{ question: "Como representar milésimos em potência de 10?", answer: "10⁻³", source: "expoente negativo de base 10" }],
		}, { id: "fake-conclude" })], { stopReason: "toolUse" }),
		ctx => {
			const err = ctx.messages.findLast(m => m.role === "toolResult");
			if (err && err.role === "toolResult") toolErrors.push(err.content.map(c => c.type === "text" ? c.text : "").join(""));
			return fauxAssistantMessage([fauxToolCall("present_lesson_exam", { task: "Converta 0,00082 A e 47000 Ω para notação científica e explique o sinal do expoente em cada caso." }, { id: "exam-1" })], { stopReason: "toolUse" });
		},
	]);
	assert.equal(r1.status, 200);
	assert.ok(toolErrors.some(msg => /Apresente a prova do nó/i.test(msg)), "server must refuse concluding without a formal exam");
	assert.equal(studyMap().nodes.find(n => n.id === nodeId)?.completed, false);

	const openExamId = pendingLessonExam(projectView(chatStore.getChat(chatId)!.messages));
	assert.equal(openExamId, "exam-1");

	// 1c. Submitting "Já entendi tudo!" to the exam form is rejected with HTTP 400.
	const bogus = await runTurn("electronics", chatId, "Já entendi tudo!", [fauxAssistantMessage("ok")], { examCallId: openExamId });
	assert.equal(bogus.status, 400, "vague confirmation must be rejected as an exam submission");

	// 1d. Learner submits a partial answer -> trivial single-letter evidence ("a") is rejected on grade 3,
	//     and a near-duplicate retest task is rejected; only a genuinely new task succeeds.
	const r2 = await runTurn("electronics", chatId, "47000 Ω dá 4,7 × 10⁴ Ω, mas o outro valor eu acho que é 8,2 × 10³ A.", [
		// Attempt to rubber-stamp with trivial 1-char evidence "a" -> rejected.
		() => fauxAssistantMessage([fauxToolCall("conclude_lesson", {
			evidence: "47000 Ω dá 4,7 × 10⁴ Ω",
			assessment: "Tentativa indevida de aprovação com evidência trivial.",
			grade: 3,
			criteria: objective.objectives.map((_, i) => ({ objective: i + 1, met: true, reason: "Aprovado.", evidence: "a" })),
			cards: [{ question: "Qual o expoente de milésimos?", answer: "-3", source: "expoente negativo de base 10" }],
		}, { id: "weak-ev" })], { stopReason: "toolUse" }),
		// Attempt to retest with near-identical prompt -> rejected.
		ctx => {
			const err = ctx.messages.findLast(m => m.role === "toolResult");
			if (err && err.role === "toolResult") toolErrors.push(err.content.map(c => c.type === "text" ? c.text : "").join(""));
			return fauxAssistantMessage([fauxToolCall("present_lesson_exam", {
				feedback: "O expoente para valores menores que 1 precisa ser negativo.",
				task: "Converta 0,00082 A e 47000 Ω para notação científica e explique o sinal do expoente em cada caso!",
			}, { id: "dup-retest" })], { stopReason: "toolUse" });
		},
		// Valid genuinely new retest case.
		ctx => {
			const err = ctx.messages.findLast(m => m.role === "toolResult");
			if (err && err.role === "toolResult") toolErrors.push(err.content.map(c => c.type === "text" ? c.text : "").join(""));
			return fauxAssistantMessage([fauxToolCall("present_lesson_exam", {
				feedback: "Você acertou 47000 Ω = 4,7 × 10⁴ Ω, mas 0,00082 A é menor que 1 e exige expoente negativo (8,2 × 10⁻⁴ A).",
				task: "Escreva 0,00035 V e 620000 Hz em notação científica justificando o sinal de cada expoente.",
			}, { id: "exam-2" })], { stopReason: "toolUse" });
		},
	], { examCallId: openExamId });
	assert.equal(r2.status, 200);
	assert.ok(toolErrors.some(msg => /evidência literal/i.test(msg)), "trivial single-letter criterion evidence must be rejected");
	assert.ok(toolErrors.some(msg => /caso novo/i.test(msg)), "duplicate retest task must be rejected");
	assert.equal(pendingLessonExam(projectView(chatStore.getChat(chatId)!.messages)), "exam-2");
	// Remove the unfinished simulation-1 chat so Simulation 2 starts with a clean pending state.
	assert.ok(chatStore.deleteChat(chatId));
});

it("Simulation 2: struggling learner triggers book/extended-reading & video attachment and closes with reinforcement (no unlock, no XP)", async () => {
	switchStudyDomain("electronics");
	const nodeId = "ee.math.algebra.sci-notation.powers-of-ten";
	const xpBefore = studyProfile().account.xp;
	const chatId = await startCampaignLesson("electronics", nodeId, 20);
	const objective = lessonConclusionObjective("electronics", chatId)!;
	const attachLog: { topic: string; useLesson: boolean }[] = [];
	const capturedPrompts: string[] = [];

	// Opening explanation.
	await runTurn("electronics", chatId, "Começar aula.", [
		() => fauxAssistantMessage([fauxText("Para converter números muito pequenos em eletrônica, contamos quantas casas a vírgula anda para a direita até deixar um dígito de 1 a 9 e usamos esse número com sinal negativo no expoente de 10. Assim, 0,0047 A vira 4,7 × 10⁻³ A. Tente converter 0,002 A?")]),
	], { attachLog, capturedPrompts });

	// Impasse 1.
	await runTurn("electronics", chatId, "Não sei, fiquei confuso com o sinal.", [
		() => fauxAssistantMessage([fauxText("Olhe para o tamanho do número: 0,002 é menor ou maior que 1? Só ajuste o sinal do expoente.")]),
	], { attachLog, capturedPrompts });

	// Impasse 2 -> level 2 contingent repair must instruct attach_study_materials (book/extended reading + video)!
	await runTurn("electronics", chatId, "Ainda não entendi, está difícil demais.", [
		() => fauxAssistantMessage([fauxToolCall("attach_study_materials", { topic: "potências de dez notação científica", useLesson: true }, { id: "mat-1" })], { stopReason: "toolUse" }),
		() => fauxAssistantMessage([fauxText("Anexei o capítulo de All About Circuits para leitura aprofundada e um vídeo passo a passo. Veja o primeiro passo: 0,002 desloca 3 casas para a direita → 2 × 10⁻³. Agora complete só o sinal para 0,0005?")]),
	], { attachLog, capturedPrompts });

	assert.ok(capturedPrompts.at(-2)?.includes("attach_study_materials"), "level 2 difficulty must instruct tutor to attach books/extended reading and video");
	assert.ok(capturedPrompts.at(-2)?.includes("book/extended reading") && capturedPrompts.at(-2)?.includes("video"), "directive must explicitly suggest extended reading and video");
	assert.equal(attachLog.length, 1);
	assert.equal(attachLog[0]!.useLesson, true);

	// Present exam 1 -> learner fails -> present exam 2 -> learner fails again -> strict reinforce closure.
	await runTurn("electronics", chatId, "Quero tentar a prova agora.", [
		() => fauxAssistantMessage([fauxToolCall("present_lesson_exam", { task: "Converta 0,0005 A e 2500 Ω para notação científica explicando os expoentes." }, { id: "s2-ex1" })], { stopReason: "toolUse" }),
	], { attachLog, capturedPrompts });

	await runTurn("electronics", chatId, "5 × 10⁴ A e 2,5 × 10⁻³ Ω", [
		() => fauxAssistantMessage([fauxToolCall("present_lesson_exam", {
			feedback: "Os sinais ficaram invertidos: valores menores que 1 têm expoente negativo e maiores que 1 têm expoente positivo. Revise o capítulo anexado antes desta segunda tentativa.",
			task: "Converta 0,0031 V e 84000 Ω para notação científica explicando o sinal do expoente.",
		}, { id: "s2-ex2" })], { stopReason: "toolUse" }),
	], { examCallId: "s2-ex1", attachLog, capturedPrompts });

	await runTurn("electronics", chatId, "3,1 × 10³ V e 8,4 × 10⁻⁴ Ω", [
		() => fauxAssistantMessage([fauxToolCall("conclude_lesson", {
			evidence: "3,1 × 10³ V e 8,4 × 10⁻⁴ Ω",
			assessment: "Permaneceu invertendo o sinal do expoente positivo e negativo. Leia o capítulo 2 do livro anexado e reveja o vídeo antes de refazer o nó.",
			grade: 1,
			criteria: objective.objectives.map((_, i) => ({ objective: i + 1, met: false, reason: "Inverteu o sinal do expoente na segunda tentativa." })),
			cards: [],
		}, { id: "s2-close" })], { stopReason: "toolUse" }),
		() => fauxAssistantMessage([fauxText("Encerramos com reforço indicado para consolidar o sinal do expoente usando a leitura e o vídeo anexados.")]),
	], { examCallId: "s2-ex2", attachLog, capturedPrompts });

	assert.equal(studyProfile().account.xp, xpBefore, "reinforcement must NOT award completion XP");
	assert.equal(studyMap().nodes.find(n => n.id === nodeId)?.completed, false, "reinforcement must NOT mark the skill completed");
	const state = lessonCompletionState("electronics", chatId);
	assert.equal(state?.completed, true);
	assert.ok(state?.reinforcement?.includes("sinal do expoente"));
	assert.equal(state?.retry?.nodeId, nodeId);
	// Campaign stays actionable immediately for reinforcement (no 20h lockout).
	const today = studyToday();
	assert.equal(today.pendingCheck, null);
	assert.equal(today.next?.nodeId, nodeId);
	assert.equal(today.next?.kind, "remediate");
});

it("Simulation 3: learner genuinely masters the node -> strict exam pass finalizes node, awards XP, saves cards, and advances online course", async () => {
	switchStudyDomain("english");
	const firstNode = studyToday().next!.nodeId;
	assert.equal(firstNode, "en.speaking.a1.greetings");
	const xpBefore = studyProfile().account.xp;
	const chatId = await startCampaignLesson("english", firstNode, 15);
	const objective = lessonConclusionObjective("english", chatId)!;

	// Step 1: Opening explanation.
	await runTurn("english", chatId, "Começar aula de cumprimentos em inglês.", [
		() => fauxAssistantMessage([fauxText("Para se apresentar a alguém em inglês usamos 'Hi, I'm [nome]' em situações informais e 'Hello, my name is [nome]' em contextos mais formais. Para retribuir e perguntar o nome, dizemos 'Nice to meet you. What's your name?'. Tente responder a um colega chamado Sam em uma aula?")]),
	]);

	// Step 2: Learner practices -> tutor fades and presents formal exam.
	await runTurn("english", chatId, "Hi Sam, I'm Ana. Nice to meet you!", [
		() => fauxAssistantMessage([
			fauxText("Boa resposta natural para um colega."),
			fauxToolCall("present_lesson_exam", {
				task: "Você chegou a um curso presencial e a professora Clara disse 'Good morning! Welcome to class.' Cumprimente-a de forma adequada, apresente-se em inglês e pergunte o nome de um colega ao lado.",
			}, { id: "en-exam-1" }),
		], { stopReason: "toolUse" }),
	]);

	const openExam = pendingLessonExam(projectView(chatStore.getChat(chatId)!.messages));
	assert.equal(openExam, "en-exam-1");

	// Step 3: Learner delivers a complete independent answer via the exam form -> strict pass & node finalization.
	const learnerSubmission = "Good morning, Clara! My name is Lucas. Nice to meet you. Hi, I'm Lucas — what's your name?";
	const finishRes = await runTurn("english", chatId, learnerSubmission, [
		() => fauxAssistantMessage([fauxToolCall("conclude_lesson", {
			evidence: learnerSubmission,
			assessment: "Cumprimentou a professora adequadamente, apresentou-se com naturalidade e devolveu a pergunta de nome ao colega de forma independente.",
			grade: 3,
			criteria: objective.objectives.map((_, i) => ({
				objective: i + 1,
				met: true,
				reason: "Demonstrou o objetivo com formulação natural e adequada ao contexto.",
				evidence: i === 0 ? "Good morning, Clara! My name is Lucas." : "what's your name?",
			})),
			cards: [{
				question: "Como se apresentar formalmente em inglês ao encontrar um professor pela primeira vez?",
				answer: "Hello, my name is [nome].",
				source: "Hello, my name is [nome]",
			}],
		}, { id: "en-conclude" })], { stopReason: "toolUse" }),
		() => fauxAssistantMessage([fauxText("Você demonstrou cumprimento adequado ao contexto, apresentação pessoal e pergunta de retorno de forma independente. Nó concluído!")]),
	], { examCallId: "en-exam-1" });
	assert.equal(finishRes.status, 200);

	// Verify durable progression, XP, map status, and continuous handoff to the next lesson!
	assert.ok(studyProfile().account.xp > xpBefore, "passing the formal exam must credit lesson XP");
	assert.equal(studyMap().nodes.find(n => n.id === firstNode)?.completed, true, "passed node must be marked completed on the map");
	const completion = lessonCompletionState("english", chatId);
	assert.equal(completion?.completed, true);
	assert.equal(completion?.reinforcement, undefined);
	assert.ok(completion?.course && completion.course.moduleCompleted >= 1);
	assert.equal(completion?.next?.nodeId, "en.listening.a1.personal-info", "next lesson handoff advances to the next campaign mission");

	const todayAfter = studyToday();
	assert.equal(todayAfter.pendingCheck, null);
	assert.equal(todayAfter.next?.nodeId, "en.listening.a1.personal-info");
	assert.ok(todayAfter.chapters![0]!.known >= 1);
});
