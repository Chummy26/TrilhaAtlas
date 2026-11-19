/**
 * Shared fixtures for tests/lesson-*.test.ts (docs/impl/lesson.md): a valid
 * Electronics LessonPlanDraft (series resistors, pt-BR) whose answer-bearing
 * fields carry the "SEGREDO" marker, a warm-up item from another node, and a
 * LessonDriver that runs the pure orchestrator like the server would
 * (acknowledging renders, answering cards and grading with the real keys).
 */

import assert from "node:assert/strict";
import { countWords } from "../src/core/lesson/text.ts";
import { gradeResponse, type LearnerResponse } from "../src/core/lesson/grading.ts";
import { compileLessonPlan, type AnswerKey, type LessonPlan, type PracticeItem, type WarmupItem } from "../src/core/lesson/protocol.ts";
import { formatQuantity } from "../src/core/lesson/units.ts";
import {
	createLesson,
	lessonItem,
	reduce,
	type EvidenceAttribution,
	type LessonEffect,
	type LessonEvent,
	type LessonInit,
	type LessonState,
} from "../src/core/lesson/orchestrator.ts";

export const SECRET = "SEGREDO";
export const T0 = Date.UTC(2026, 10, 18, 12, 0, 0);
export const NODE_ID = "ee.dc.series-resistors";

/** Field names that only answer keys (or server-side item metadata) may carry. */
export const KEY_FIELDS = ["correct", "answer", "hints", "solution", "accepted", "reference", "rubric", "buggy", "distractors", "tolerance", "answerKeys", "correctOptionId", "misconceptionId", "verifiedBy", "difficulty", "family"];

/** Fails when a client-bound value carries a secret marker or any key field. */
export function assertNoKeyMaterial(value: unknown, where: string): void {
	const text = JSON.stringify(value);
	assert.ok(!text.includes(SECRET), `${where} leaks a secret marker: ${text.slice(0, 300)}`);
	for (const field of KEY_FIELDS) assert.ok(!text.includes(`"${field}":`), `${where} carries the field "${field}"`);
}

const hints = (tag: string): [string, string, string] => [
	`${SECRET}-PISTA ${tag}: observe quantos caminhos a corrente tem.`,
	`${SECRET}-PRINCIPIO ${tag}: em série existe um único caminho.`,
	`${SECRET}-PASSO ${tag}: some as resistências e só depois divida.`,
];
const solution = (tag: string) => [`${SECRET}-SOLUCAO ${tag}: aplique a regra e confira as unidades.`];

type Opt = [id: string, text: string, correct: boolean, misconceptionId?: string];

export function mcqDraft(id: string, stem: string, difficulty: 1 | 2 | 3, options: Opt[]) {
	return {
		id,
		kind: "mcq",
		stem,
		difficulty,
		options: options.map(([oid, text, correct, mis]) => ({ id: oid, text, correct, ...(mis ? { misconceptionId: mis } : {}) })),
		hints: hints(id),
		solution: solution(id),
	};
}

export function numericDraft(id: string, stem: string, difficulty: 1 | 2 | 3, value: number, unit: string, extra: Record<string, unknown> = {}) {
	return { id, kind: "numeric", stem, difficulty, answer: { value, unit }, hints: hints(id), solution: solution(id), verifiedBy: "solver", ...extra };
}

function shortDraft(id: string, stem: string, difficulty: 1 | 2 | 3, accepted: string[], reference: string) {
	return { id, kind: "short", stem, difficulty, answer: { accepted, reference, rubric: ["identifica a relação correta"] }, hints: hints(id), solution: solution(id) };
}

const SENTENCES = [
	"Imagine uma pilha ligada a dois resistores, um depois do outro, formando um único caminho fechado.",
	"Cada carga que sai de um terminal precisa atravessar os dois resistores antes de voltar ao outro.",
	"Não existe desvio possível, então o fluxo de carga é o mesmo em qualquer ponto do fio.",
	"O que muda de um resistor para o outro é quanta energia cada carga entrega ali.",
	"Por isso a tensão se divide entre os elementos, enquanto a corrente permanece a mesma.",
	"Um amperímetro colocado antes, entre ou depois dos resistores mostra exatamente o mesmo valor.",
	"Somar resistores em sequência é como alongar um tubo estreito: a oposição total cresce.",
	"Com a oposição maior e a mesma pilha, a corrente do circuito inteiro diminui.",
	"Essa é a observação que a lei de Ohm transforma em conta, como veremos com números.",
];

/** Prose of at least `minWords` words built from the sentence bank. */
export function prose(minWords: number, offset = 0): string {
	const out: string[] = [];
	let i = offset;
	while (countWords(out.join(" ")) < minWords) {
		out.push(SENTENCES[i % SENTENCES.length] as string);
		i++;
	}
	return out.join(" ");
}

/** A complete, valid LessonPlanDraft (fresh object each call). */
export function seriesDraft(): Record<string, any> {
	return {
		nodeId: NODE_ID,
		lang: "pt-BR",
		goal: "Calcular a resistência equivalente e a corrente de resistores ligados em série.",
		estimatedMinutes: 20,
		hook: { kind: "puzzle", text: "Duas lâmpadas iguais estão em série com uma pilha. Você troca uma delas por um pedaço de fio." },
		prediction: mcqDraft("pred", "Depois da troca, o que acontece com a lâmpada que sobrou?", 1, [
			["a", "Brilha mais", true],
			["b", "Brilha igual", false],
			["c", "Apaga", false],
		]),
		segments: [
			{
				id: "s1",
				idea: "Em série há um único caminho para a carga.",
				body: prose(140),
				analogy: {
					source: "uma fila única num corredor com portas estreitas",
					mapping: "pessoas são cargas; portas estreitas são resistores",
					breaksWhere: "pessoas param e se acumulam; num fio as cargas não se acumulam",
				},
				socratic: {
					item: mcqDraft("soc1", "Se a corrente fosse gasta, o que um amperímetro mostraria depois do segundo resistor?", 1, [
						["a", "O mesmo valor de antes", true],
						["b", "Um valor menor", false, "m.current_consumed"],
					]),
					maxRounds: 2,
				},
				resolvesPrediction: true,
			},
			{ id: "s2", idea: "As resistências se somam.", body: prose(150, 3) },
		],
		knowledgePoints: [
			{
				id: "kp1",
				title: "Resistência equivalente em série",
				statement: "Em série, R_eq = R1 + R2 + …",
				workedExample: {
					problem: "R1 = 1 kΩ e R2 = 2 kΩ em série. Qual é R_eq?",
					steps: [
						{ subgoal: "Identificar a ligação", text: "Há um único caminho: série." },
						{ subgoal: "Somar", text: "R_eq = 1 kΩ + 2 kΩ = 3 kΩ." },
					],
				},
				fadedSteps: {
					problem: "R1 = 2,2 kΩ e R2 = 4,7 kΩ em série.",
					given: [{ subgoal: "Identificar a ligação", text: "Um único caminho: série." }],
					blankSubgoal: "Somar as resistências",
					blank: numericDraft("kp1.faded", "Quanto vale R_eq?", 1, 6.9, "kΩ"),
				},
				items: [
					numericDraft("kp1.i1", "R1 = 1 kΩ e R2 = 3,3 kΩ em série. Calcule R_eq.", 1, 4.3, "kΩ"),
					numericDraft("kp1.i2", "Três resistores de 1,5 kΩ em série. Quanto vale R_eq?", 2, 4.5, "kΩ", {
						buggy: [{ value: 0.5, unit: "kΩ", misconceptionId: "m.parallel_sum" }],
					}),
					mcqDraft("kp1.i3", "Em série, acrescentar mais um resistor faz R_eq:", 2, [
						["up", "aumentar", true],
						["down", "diminuir", false, "m.parallel_sum"],
						["same", "ficar igual", false],
					]),
					numericDraft("kp1.i4", "R1 = 470 Ω, R2 = 1 kΩ e R3 = 2,2 kΩ em série. Quanto vale R_eq?", 3, 3670, "Ω"),
				],
			},
			{
				id: "kp2",
				title: "Corrente em série",
				statement: "A corrente é a mesma em todos os elementos em série: I = V / R_eq.",
				workedExample: {
					problem: "9 V aplicados a 1 kΩ + 2 kΩ em série. Qual é a corrente?",
					steps: [
						{ subgoal: "Achar R_eq", text: "R_eq = 3 kΩ." },
						{ subgoal: "Aplicar a lei de Ohm", text: "I = 9 V / 3 kΩ = 3 mA." },
					],
				},
				fadedSteps: {
					problem: "12 V aplicados a 1 kΩ + 3 kΩ em série.",
					given: [{ subgoal: "Achar R_eq", text: "R_eq = 4 kΩ." }],
					blankSubgoal: "Aplicar a lei de Ohm",
					blank: numericDraft("kp2.faded", "Qual é a corrente?", 1, 3, "mA", { answerUnit: "mA" }),
				},
				items: [
					mcqDraft("kp2.i1", "Em série, a corrente no segundo resistor é:", 1, [
						["eq", "igual à do primeiro", true],
						["less", "menor que a do primeiro", false, "m.current_consumed"],
						["more", "maior que a do primeiro", false],
					]),
					numericDraft("kp2.i2", "5 V aplicados a 1 kΩ + 1,5 kΩ em série. Qual é a corrente?", 2, 2, "mA", { answerUnit: "mA" }),
					shortDraft("kp2.i3", "Como se comparam as correntes em R1 e em R2 numa ligação série?", 2, ["iguais", "são iguais"], `${SECRET}-REFERENCIA as correntes são iguais`),
					numericDraft("kp2.i4", "24 V aplicados a 2,2 kΩ + 4,7 kΩ + 5,1 kΩ. Qual é a corrente?", 3, 2, "mA", { answerUnit: "mA" }),
				],
			},
		],
		selfExplanation: {
			kpId: "kp2",
			stepIndex: 1,
			item: {
				id: "se1",
				kind: "explain",
				stem: "Por que o passo 2 pode usar uma única corrente para R1 e R2?",
				difficulty: 2,
				answer: { reference: `${SECRET}-REFERENCIA há um único caminho, então a corrente é a mesma`, rubric: ["menciona caminho único", "conclui corrente igual"] },
				hints: hints("se1"),
				solution: solution("se1"),
				verifiedBy: "judge",
			},
		},
		variation: {
			format: "find_the_error",
			intro: "Um colega calculou R_eq de dois resistores em série e chegou a um valor menor que o menor deles.",
			item: mcqDraft("var1", "Qual foi o erro do colega?", 2, [
				["par", "Usou a fórmula do paralelo", true, undefined],
				["sum", "Somou as resistências", false],
			]),
		},
		recap: { bullets: ["Em série, as resistências se somam.", "A corrente é a mesma em todos os elementos em série."], unlocks: ["Divisor de tensão"] },
		closing: shortDraft("close1", "Qual é a regra para R_eq em série?", 1, ["soma", "somar"], `${SECRET}-REFERENCIA soma das resistências`),
		misconceptions: [
			{
				id: "m.current_consumed",
				statement: "A corrente diminui a cada resistor porque é consumida.",
				diagnosticSignal: "Escolhe corrente menor depois do primeiro resistor.",
				repair: "A carga não é consumida; o que se converte em calor é energia.",
				bridgeItem: mcqDraft("bridge1", "Um amperímetro antes e outro depois de um resistor marcam:", 1, [
					["same", "o mesmo valor", true],
					["less", "o segundo marca menos", false, "m.current_consumed"],
				]),
			},
			{
				id: "m.parallel_sum",
				statement: "Resistências em série se combinam como em paralelo.",
				diagnosticSignal: "Usa R1·R2/(R1+R2) numa ligação série.",
				repair: "Em série as resistências se somam; a fórmula do produto pela soma é do paralelo.",
			},
		],
		flashcardCandidates: [
			{ proposition: "Em série, R_eq = R1 + R2 + …", cues: ["R_eq em série"], kpId: "kp1" },
			{ proposition: "Em série a corrente é a mesma em todos os elementos.", cues: ["corrente em série"], kpId: "kp2" },
			{ proposition: "A carga não é consumida num resistor; a energia é convertida.", cues: ["a corrente é gasta?"], misconceptionId: "m.current_consumed" },
		],
		encompasses: [{ nodeId: "ee.dc.ohm", weight: 0.5 }],
	};
}

export function compiledPlan(draft: unknown = seriesDraft()): LessonPlan {
	const result = compileLessonPlan(draft, { nodeId: NODE_ID, nodeVersion: 1, domainId: "electronics" });
	if (!result.ok) throw new Error(`fixture plan does not compile:\n${result.issues.map((i) => `${i.path}: ${i.message}`).join("\n")}`);
	return result.plan;
}

export function warmupItem(): WarmupItem {
	const item: PracticeItem = { id: "w1", kind: "numeric", stem: "Um resistor de 1 kΩ recebe 2 V. Qual é a corrente?", difficulty: 1, answerUnit: "mA", requireUnit: false };
	const key: AnswerKey = {
		itemId: "w1",
		answer: { kind: "numeric", value: 0.002, unit: "A", tolerance: { rel: 0.01 }, buggy: [] },
		hints: hints("w1"),
		solution: solution("w1"),
		verifiedBy: "solver",
	};
	return { nodeId: "ee.dc.ohm", item, key, minutesSinceExposure: 2880 };
}

export function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
	}
	return value;
}

/** A response the key accepts (grade 3). */
export function correctResponse(item: PracticeItem, key: AnswerKey): LearnerResponse {
	const spec = key.answer;
	switch (spec.kind) {
		case "choice":
			return { kind: "choice", optionId: spec.correctOptionId };
		case "numeric":
			return { kind: "text", text: formatQuantity(spec.value, spec.unit, { digits: 4 }) };
		case "text":
			return { kind: "text", text: spec.accepted[0] ?? "uma explicação escrita pelo aluno" };
		case "transcript":
			return item.kind === "speak" ? { kind: "speech", transcript: spec.text } : { kind: "text", text: spec.text };
	}
}

/** A wrong response (no misconception unless `misconceptionId` is asked for and available). */
export function wrongResponse(item: PracticeItem, key: AnswerKey, misconceptionId?: string): LearnerResponse {
	const spec = key.answer;
	switch (spec.kind) {
		case "choice": {
			const options = item.kind === "mcq" || item.kind === "minimal_pair" ? item.options : [];
			const pick = misconceptionId
				? options.find((o) => spec.distractors[o.id] === misconceptionId)
				: options.find((o) => o.id !== spec.correctOptionId && !spec.distractors[o.id]) ?? options.find((o) => o.id !== spec.correctOptionId);
			if (!pick) throw new Error(`no wrong option for ${item.id}`);
			return { kind: "choice", optionId: pick.id };
		}
		case "numeric": {
			const bug = misconceptionId ? spec.buggy.find((b) => b.misconceptionId === misconceptionId) : undefined;
			if (misconceptionId && !bug) throw new Error(`no buggy value for ${misconceptionId} in ${item.id}`);
			return { kind: "text", text: formatQuantity(bug ? bug.value : spec.value * 7.3, spec.unit, { digits: 4 }) };
		}
		case "text":
			return { kind: "text", text: "não tenho certeza" };
		case "transcript":
			return { kind: "text", text: "something else entirely" };
	}
}

export interface AnswerOptions {
	latencyMs?: number;
	selfConfidence?: 1 | 2 | 3;
	/** Grade used when the item needs the LLM grader (default: 3 for correct, 0 for wrong). */
	llmGrade?: 0 | 1 | 2 | 3;
	misconceptionId?: string;
	attributions?: EvidenceAttribution[];
}

/** Runs the reducer like the server: one event at a time, recording effects. */
export class LessonDriver {
	state: LessonState;
	now: number;
	log: LessonEffect[] = [];
	last: LessonEffect[] = [];
	events: LessonEvent[] = [];
	/** Effects grouped by the time of the event that produced them. */
	timeline: Array<{ at: number; effects: LessonEffect[] }> = [];
	/** Simulated reading time per render acknowledgment. */
	readMs = 150_000;
	answerMs = 20_000;
	freeze = true;

	constructor(init: Partial<LessonInit> = {}, start = T0) {
		this.state = createLesson({ nodeId: NODE_ID, nodeVersion: 1, domainId: "electronics", ...init });
		this.now = start;
	}

	dispatch(event: LessonEvent): LessonEffect[] {
		if (this.freeze) deepFreeze(this.state);
		const t = reduce(this.state, event);
		this.state = t.state;
		this.events.push(event);
		this.last = t.effects;
		this.log.push(...t.effects);
		this.timeline.push({ at: event.at, effects: t.effects });
		return t.effects;
	}

	tick(ms: number): this {
		this.now += ms;
		return this;
	}

	start(): LessonEffect[] {
		return this.dispatch({ type: "learner_clicked_start", at: this.now });
	}

	ready(plan: LessonPlan = compiledPlan(), warmups: WarmupItem[] = []): LessonEffect[] {
		return this.dispatch({ type: "plan_ready", at: this.now, plan, warmups });
	}

	/** Acknowledge the pending render (after `readMs`). */
	ack(text?: string): LessonEffect[] {
		const pending = this.state.pendingRender;
		if (!pending) throw new Error("nothing to acknowledge");
		this.tick(this.readMs);
		return this.dispatch({ type: "phase_rendered", at: this.now, renderId: pending.renderId, ...(text !== undefined ? { text } : {}) });
	}

	/** Acknowledge renders until a card is open or the lesson ends; returns the open item id. */
	pump(): string | null {
		while (this.state.status === "active" && this.state.pendingRender) this.ack();
		return this.state.active?.posed ? this.state.active.itemId : null;
	}

	ref(itemId: string) {
		const found = lessonItem(this.state, itemId);
		if (!found) throw new Error(`unknown item ${itemId}`);
		return found;
	}

	/** Submit `response` to the open card and grade it (deterministically, or with the given LLM grade). */
	answer(response: LearnerResponse, opts: AnswerOptions = {}): LessonEffect[] {
		const a = this.state.active;
		if (!a) throw new Error("no open card");
		const { item, key } = this.ref(a.itemId);
		this.tick(this.answerMs);
		const effects = this.dispatch({
			type: "answer_submitted",
			at: this.now,
			itemId: a.itemId,
			response,
			latencyMs: opts.latencyMs ?? 8_000,
			...(opts.selfConfidence ? { selfConfidence: opts.selfConfidence } : {}),
		});
		if (!effects.some((e) => e.type === "grade_item")) return effects;
		const outcome = gradeResponse(item, key, response);
		if (outcome.status === "invalid") throw new Error(`fixture produced an invalid response: ${outcome.message}`);
		const graded =
			outcome.status === "graded"
				? { grade: outcome.grade, confidence: outcome.confidence, misconceptionId: outcome.misconceptionId ?? null }
				: { grade: opts.llmGrade ?? 3, confidence: 0.8, misconceptionId: opts.misconceptionId ?? null };
		return this.dispatch({
			type: "answer_graded",
			at: this.now,
			itemId: a.itemId,
			...graded,
			...(opts.attributions ? { attributions: opts.attributions } : {}),
		});
	}

	answerCorrect(opts: AnswerOptions = {}): LessonEffect[] {
		const a = this.state.active;
		if (!a) throw new Error("no open card");
		const { item, key } = this.ref(a.itemId);
		return this.answer(correctResponse(item, key), opts);
	}

	answerWrong(opts: AnswerOptions = {}): LessonEffect[] {
		const a = this.state.active;
		if (!a) throw new Error("no open card");
		const { item, key } = this.ref(a.itemId);
		return this.answer(wrongResponse(item, key, opts.misconceptionId), { llmGrade: 0, ...opts });
	}

	effectsOf<T extends LessonEffect["type"]>(type: T): Array<Extract<LessonEffect, { type: T }>> {
		return this.log.filter((e): e is Extract<LessonEffect, { type: T }> => e.type === type);
	}
}
