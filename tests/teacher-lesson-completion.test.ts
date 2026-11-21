import assert from "node:assert/strict";
import { it } from "node:test";
import { pendingLessonExam, needsLessonExamContinuation, prepareLessonExam, validateExamVerdict, validateLessonConclusion } from "../src/core/study/lesson-conclusion.ts";
import type { LhViewMessage } from "../src/core/view.ts";

const messages: LhViewMessage[] = [
	{ role: "user", id: "1", parts: [{ type: "text", text: "Quero aprender a comparar frações." }] },
	{ role: "assistant", id: "2", parts: [{ type: "text", text: "Com o mesmo numerador positivo, um denominador maior produz partes menores." }] },
	{ role: "user", id: "3", parts: [{ type: "text", text: "Um quinto é menor que um terço porque o inteiro foi dividido em mais partes iguais." }] },
];
const card = { question: "Com numerador positivo fixo, como muda a fração quando o denominador aumenta?", answer: "A fração diminui.", source: "um denominador maior produz partes menores" };
const verdict = { evidence: messages[2]!.parts[0]!.text!, assessment: "Comparou as duas frações e justificou a escolha pelo tamanho das partes.", grade: 3 as const, cards: [card] };
it("requires a learner performance after instruction and grounded, non-leaking cards", () => {
	assert.doesNotThrow(() => validateLessonConclusion(messages, verdict));
	assert.doesNotThrow(() => validateLessonConclusion(messages, { ...verdict, evidence: "Produção independente: “" + verdict.evidence + "”" }));
	assert.throws(() => validateLessonConclusion(messages.slice(0, 2), verdict), /resposta/);
	assert.throws(() => validateLessonConclusion(messages, { ...verdict, evidence: "Quero aprender" }), /resposta/);
	assert.throws(() => validateLessonConclusion(messages, { ...verdict, cards: [{ ...card, source: "Uma citação inventada" }] }), /trecho/);
	assert.throws(() => validateLessonConclusion(messages, { ...verdict, cards: [{ ...card, answer: "denominador" }] }), /resposta/);
	assert.throws(() => validateLessonConclusion(messages, { ...verdict, cards: [card,card] }), /repetida/);
});

const task = "Compare um quinto com um terço e explique o papel do denominador.";
const exam = (prompt: string, id: string): LhViewMessage => ({
	role: "assistant", id, parts: [{ type: "tool-present_lesson_exam", toolCallId: id, state: "output-available", output: { task: prompt } }],
});
const response = (text: string, id: string, examCallId?: string): LhViewMessage => ({ role: "user", id, examCallId, parts: [{ type: "text", text }] });
const rubric = [{ objective: 1, met: true, reason: "Comparou as partes corretamente.", evidence: "Um quinto é menor que um terço" }];
const wrong = response("Um quinto é maior que um terço.", "wrong", "first");
const learning = messages.slice(0, 2);

it("requires a bounded exam with one new attempt and a complete independent pass", () => {
	assert.equal(prepareLessonExam(learning, { task }).attempt, 1);
	assert.throws(() => validateExamVerdict(messages, { ...verdict, criteria: rubric }, 1), /prova/);
	const first = [...learning, exam(task, "first")];
	assert.throws(() => prepareLessonExam(first, { task: "Compare 2/7 e 2/9." }), /resposta/);
	assert.throws(() => validateExamVerdict([...first, wrong], { ...verdict, criteria: rubric }, 1), /resposta/);
	const correction = { task: "Compare 2/7 e 2/9.", feedback: "O denominador indica quantas partes iguais compõem o inteiro." };
	assert.equal(prepareLessonExam([...first, wrong], correction).attempt, 2);
	assert.throws(() => prepareLessonExam([...first, wrong], { ...correction, task }), /novo/);
	const second = [...first, wrong, exam(correction.task, "second"), response(verdict.evidence, "right", "second")];
	assert.throws(() => prepareLessonExam(second, correction), /duas/);
	assert.throws(() => validateExamVerdict(second, { ...verdict, criteria: rubric }, 2), /critério/);
	assert.throws(() => validateExamVerdict(second, { ...verdict, grade: 3, criteria: [{ ...rubric[0]!, met: false }] }, 1), /independente/);
	assert.throws(() => validateExamVerdict(second, { ...verdict,
		criteria: [{ ...rubric[0]!, evidence: "Repetiu uma fórmula que só apareceu na explicação" }],
	}, 1), /evidência/);
	assert.equal(validateExamVerdict(second, { ...verdict, criteria: rubric }, 1), "passed");
	assert.throws(() => validateExamVerdict(second, { ...verdict, evidence: wrong.parts[0]!.text!, criteria: rubric }, 1), /última/);
	assert.throws(() => validateExamVerdict(second, { ...verdict, criteria: [rubric[0]!, rubric[0]!] }, 2), /critério/);
	assert.equal(validateExamVerdict(second, { ...verdict, grade: 2, criteria: rubric }, 1), "reinforce");
	const incomplete = [...second.slice(0, -1), response("Entendi.", "ack", "second")];
	const insufficient = { ...verdict, evidence: "Entendi.", grade: 1 as const, criteria: [{ ...rubric[0]!, met: false }] };
	assert.throws(() => validateExamVerdict(incomplete, insufficient, 1), /entrega/);
	assert.equal(pendingLessonExam(incomplete), "second");
	assert.equal(pendingLessonExam([...first, response("Entendi.", "chat"), response(verdict.evidence, "ordinary")]), "first");
	assert.equal(pendingLessonExam([...first, response(verdict.evidence, "stale", "previous")]), "first");
	assert.equal(pendingLessonExam(second), undefined);
	assert.throws(() => validateExamVerdict(incomplete, { ...insufficient, criteria: rubric, grade: 3 }, 1), /entrega/);
});

it("detects a teaching turn that ended without a task or a resolved verdict", () => {
	assert.equal(needsLessonExamContinuation("teaching", [{ type: "text", text: "Um denominador maior divide o inteiro em partes menores." }]), true);
	assert.equal(needsLessonExamContinuation("teaching", [{ type: "text", text: "Como você compararia um quinto e um terço?" }]), false);
	assert.equal(needsLessonExamContinuation("first-verdict", [{ type: "text", text: "Sua resposta precisa de correção." }]), true);
	assert.equal(needsLessonExamContinuation("awaiting-answer", []), false);
});
