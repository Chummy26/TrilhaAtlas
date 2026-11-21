import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	analyzeLessonPedagogy,
	buildMissionPedagogyDirective,
} from "../src/core/study/tutor-pedagogy.ts";
import {
	needsLessonExamContinuation,
	validateExamVerdict,
	validateLessonConclusion,
} from "../src/core/study/lesson-conclusion.ts";
import type { LhViewMessage } from "../src/core/view.ts";

const objective = {
	title: "Lei de Ohm em circuitos série simples",
	objectives: [
		"Relacionar tensão, resistência e corrente em um resistor ideal",
		"Calcular a corrente resultante ao alterar a resistência mantendo a tensão fixa",
	],
	misconceptions: [
		"Achar que aumentar a resistência aumenta a corrente",
		"Usar mA como amperes sem converter",
	],
};

const userMsg = (id: string, text: string, examCallId?: string): LhViewMessage => ({
	role: "user",
	id,
	...(examCallId ? { examCallId } : {}),
	parts: [{ type: "text", text }],
});

const assistantMsg = (id: string, text: string): LhViewMessage => ({
	role: "assistant",
	id,
	parts: [{ type: "text", text }],
});

const longExplanation =
	"Em um circuito simples com uma fonte de 10 V e um resistor de 5 kΩ, a resistência limita o fluxo de carga. " +
	"Pela Lei de Ohm, I = V / R, logo I = 10 V / 5000 Ω = 2 mA. Se dobrarmos a resistência para 10 kΩ mantendo 10 V fixos, a corrente cai pela metade para 1 mA.";

describe("contingent tutor pedagogy controller (TutorBench / MRBench / Hou et al. 2026 / SAFETUTORS)", () => {
	it("opens a campaign lesson without bureaucracy and injects known misconceptions and prior reinforcement", () => {
		const messages: LhViewMessage[] = [userMsg("u1", "Começar aula sobre Lei de Ohm.")];
		const state = analyzeLessonPedagogy(messages);
		assert.equal(state.stage, "opening");
		assert.equal(state.scaffoldLevel, 1);
		const directive = buildMissionPedagogyDirective(messages, objective, {
			priorReinforcement: "Converteu 5 kΩ como 5 Ω na tentativa anterior.",
		});
		assert.match(directive, /complete worked example/i);
		assert.match(directive, /Achar que aumentar a resistência aumenta a corrente/);
		assert.match(directive, /Converteu 5 kΩ como 5 Ω/);
	});

	it("escalates scaffolding contingently across 1st, 2nd, and 3rd impasses while avoiding premature spoilers", () => {
		const base = [userMsg("u1", "Iniciar."), assistantMsg("a1", longExplanation)];

		// Impasse 1 + asking for the direct answer -> level 1 focused cue + anti-spoiler.
		const m1 = [...base, userMsg("u2", "Não sei, me diz a resposta logo.")];
		const s1 = analyzeLessonPedagogy(m1);
		assert.equal(s1.stage, "repair");
		assert.equal(s1.scaffoldLevel, 1);
		assert.equal(s1.askedForAnswer, true);
		const d1 = buildMissionPedagogyDirective(m1, objective);
		assert.match(d1, /Scaffold level 1/i);
		assert.match(d1, /never validate an incorrect premise/i);
		assert.match(d1, /targeted cue instead of spoiling/i);

		// Impasse 2 -> level 2 faded worked step.
		const m2 = [...m1, assistantMsg("a2", "Qual unidade está no denominador?"), userMsg("u3", "Ainda estou confuso, não entendi.")];
		const s2 = analyzeLessonPedagogy(m2);
		assert.equal(s2.stage, "repair");
		assert.equal(s2.scaffoldLevel, 2);
		const d2 = buildMissionPedagogyDirective(m2, objective);
		assert.match(d2, /Scaffold level 2/i);
		assert.match(d2, /last step/i);

		// Impasse 3 -> level 3 full worked solution (never withhold unproductively).
		const m3 = [...m2, assistantMsg("a3", "Passo 1: 5 kΩ = 5000 Ω. Agora divida 10 por 5000."), userMsg("u4", "Travei de novo, não consigo.")];
		const s3 = analyzeLessonPedagogy(m3);
		assert.equal(s3.stage, "repair");
		assert.equal(s3.scaffoldLevel, 3);
		const d3 = buildMissionPedagogyDirective(m3, objective);
		assert.match(d3, /Scaffold level 3/i);
		assert.match(d3, /complete worked solution/i);
	});

	it("honors learner initiative to take the formal exam directly (Neagu et al. 2026)", () => {
		const messages = [
			userMsg("u1", "Iniciar."),
			assistantMsg("a1", longExplanation),
			userMsg("u2", "Já sei isso, pode aplicar a prova."),
		];
		const state = analyzeLessonPedagogy(messages);
		assert.equal(state.stage, "exam-ready");
		assert.equal(state.askedForExam, true);
		const directive = buildMissionPedagogyDirective(messages, objective);
		assert.match(directive, /honor their initiative/i);
		assert.match(directive, /present_lesson_exam/);
	});

	it("fades scaffolding after uptake and transitions cleanly through formal exam phases", () => {
		const messages = [
			userMsg("u1", "Iniciar."),
			assistantMsg("a1", longExplanation),
			userMsg("u2", "Entendi, com 20 kΩ daria 0,5 mA."),
			assistantMsg("a2", "Certo: dobrar de 10 kΩ para 20 kΩ reduz a corrente de 1 mA para 0,5 mA."),
		];
		assert.equal(analyzeLessonPedagogy(messages).stage, "fading");

		const withExam: LhViewMessage[] = [
			...messages,
			{
				role: "assistant",
				id: "e1",
				parts: [{ type: "tool-present_lesson_exam", toolCallId: "exam-1", state: "output-available", output: { task: "Com 12 V e 6 kΩ, encontre a corrente." } }],
			},
		];
		assert.equal(analyzeLessonPedagogy(withExam).stage, "exam-awaiting");

		const withFirstAnswer = [...withExam, userMsg("u3", "2 mA", "exam-1")];
		assert.equal(analyzeLessonPedagogy(withFirstAnswer).stage, "exam-first-verdict");
		assert.match(buildMissionPedagogyDirective(withFirstAnswer, objective), /attempt 1/i);
	});
});

describe("lesson conclusion & continuation robustness", () => {
	it("does not force auto-continuation when the assistant just displayed an interactive study_activity", () => {
		assert.equal(
			needsLessonExamContinuation("teaching", [
				{ type: "text", text: "Experimente dobrar a resistência no circuito acima e observe o amperímetro." },
				{ type: "toolCall", name: "study_activity" },
			]),
			false,
		);
		assert.equal(
			needsLessonExamContinuation("teaching", [
				{ type: "text", text: "Um denominador maior divide o inteiro em partes menores." },
			]),
			true,
		);
	});

	it("accepts concise literal exam evidence and flashcards sourced from corrective exam feedback", () => {
		const transcript: LhViewMessage[] = [
			userMsg("u1", "Iniciar aula."),
			assistantMsg("a1", "Pela Lei de Ohm, I = V / R."),
			{
				role: "assistant",
				id: "e1",
				parts: [{
					type: "tool-present_lesson_exam",
					toolCallId: "ex1",
					state: "output-available",
					output: { task: "Com 12 V e 6 kΩ, calcule a corrente." },
				}],
			},
			userMsg("u2", "2 A", "ex1"),
			{
				role: "assistant",
				id: "e2",
				parts: [{
					type: "tool-present_lesson_exam",
					toolCallId: "ex2",
					state: "output-available",
					output: {
						feedback: "Quilo-ohm vale mil ohms: 6 kΩ = 6000 Ω, então a corrente sai em miliamperes.",
						task: "Com 10 V e 5 kΩ, calcule a corrente com unidade.",
					},
				}],
			},
			userMsg("u3", "2 mA.", "ex2"),
		];

		const conclusion = {
			evidence: 'O aluno entregou "2 mA".',
			assessment: "Converteu 5 kΩ para 5000 Ω e obteve a corrente correta com unidade.",
			grade: 3 as const,
			criteria: [{ objective: 1, met: true, reason: "Cálculo e unidade corretos.", evidence: '"2 mA"' }],
			cards: [{
				question: "Ao dividir tensão em volts por resistência em quilo-ohms (kΩ), em que unidade sai a corrente?",
				answer: "Em miliamperes (mA).",
				source: "6 kΩ = 6000 Ω, então a corrente sai em miliamperes",
			}],
		};

		assert.equal(validateExamVerdict(transcript, conclusion, 1), "passed");
		assert.doesNotThrow(() => validateLessonConclusion(transcript, conclusion));
	});
});
