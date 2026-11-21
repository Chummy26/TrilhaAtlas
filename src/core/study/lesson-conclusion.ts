import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { LhViewMessage } from "../view.ts";
import type { QuestionAnswerData } from "../question-core.ts";
import { gradeStudyQuiz } from "./quiz.ts";

const field = (minLength: number, maxLength: number) => Type.String({ minLength, maxLength });
export const lessonExamSchema = Type.Object({ task: field(12, 3600), feedback: Type.Optional(field(12, 1600)) });
export type LessonExam = Static<typeof lessonExamSchema>;
const examLimit = 2;

export const lessonConclusionSchema = Type.Object({
	evidence: field(1, 600), assessment: field(12, 600), grade: Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2), Type.Literal(3)]),
	criteria: Type.Optional(Type.Array(Type.Object({
		objective: Type.Integer({ minimum: 1 }), met: Type.Boolean(), reason: field(8, 400),
		evidence: Type.Optional(field(1, 450)),
	}), { minItems: 1 })),


	cards: Type.Array(Type.Object({ question: field(8, 280), answer: field(1, 350), source: field(8, 500) }), { maxItems: 4 }),
});
export type LessonConclusion = Static<typeof lessonConclusionSchema>;
const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[*_`]/g, "").replace(/\s+/gu, " ").trim();
const stripOuterQuotes = (text: string) => text.replace(/^["'«]+|["'»]+$/gu, "").trim();
const trimEdgePunctuation = (text: string) => text.replace(/^[.,;:!?]+|[.,;:!?]+$/gu, "").trim();
function examHistory(messages: readonly LhViewMessage[]) {
	const attempts: { task: string; callId: string; answer?: string }[] = [];
	for (const message of messages) {
		if (message.role === "user") {
			const last = attempts.at(-1);
			const answer = message.parts.filter(part => part.type === "text").map(part => part.text ?? "").join("\n").trim();
			if (last && !last.answer && message.examCallId === last.callId && isLessonExamAnswer(answer)) last.answer = answer;
			continue;
		}
		for (const part of message.parts) {
			if (part.type === "tool-conclude_lesson" && part.state === "output-available") return [];
			if (part.type !== "tool-present_lesson_exam" || part.state !== "output-available") continue;
			const task = (part.output as LessonExam | undefined)?.task;
			if (typeof task === "string" && part.toolCallId) attempts.push({ task, callId: part.toolCallId });
		}
	}
	return attempts;
}

/** Short answers such as a number or a word can be legitimate. Conversational
 *  confirmations, vague acknowledgments, and skip requests are excluded. */
const NON_ANSWER_RE = /^(?:ok|okay|sim|s|(?:eu\s+|j[aá]\s+)?entendi(?:\s+tudo|\s+sim|\s+perfeitamente)?|entendido|beleza|certo|tudo\s+certo|pronto|yes|yeah|yep|understood|got\s+it|i\s+understand(?:\s+now)?|makes\s+sense|faz\s+sentido|pode\s+(?:seguir|continuar|passar|avan[cç]ar)|pr[oó]xima(?:\s+aula)?|pula(?:r)?|skip|next|obrigad[oa]|valeu|thanks)$/iu;

export function isLessonExamAnswer(text: string) {
	const answer = normalize(text).replace(/[.!?,\s]+$/u, "");
	return !!answer && !NON_ANSWER_RE.test(answer);
}

export function pendingLessonExam(messages: readonly LhViewMessage[]) {
	const last = examHistory(messages).at(-1);
	return last && !last.answer ? last.callId : undefined;
}

export type LessonExamPhase = "teaching" | "awaiting-answer" | "first-verdict" | "final-verdict";

export function lessonExamPhase(messages: readonly LhViewMessage[]): LessonExamPhase {
	const attempts = examHistory(messages);
	if (!attempts.length) return "teaching";
	if (!attempts.at(-1)?.answer) return "awaiting-answer";
	return attempts.length === examLimit ? "final-verdict" : "first-verdict";
}

const INTERACTIVE_TEACHING_PART = /^(?:tool-)?(?:study_activity|attach_study_materials|quiz|explain|present_lesson_exam|prepare_review)$/;

export function needsLessonExamContinuation(phase: LessonExamPhase, parts: readonly { type: string; text?: string; name?: string }[]) {
	if (phase === "awaiting-answer") return false;
	if (phase !== "teaching") return true;
	if (parts.some(part => INTERACTIVE_TEACHING_PART.test(part.type) || (part.name ? INTERACTIVE_TEACHING_PART.test(part.name) : false))) return false;
	const lastProse = parts.findLast(part => part.type === "text" && part.text?.trim())?.text?.trim();
	return !!lastProse && !/[?？][”"»]*$/.test(lastProse);
}

const DIRECT_EXAM_REQUEST_RE = /\b(aplicar? a prova|fazer a prova|ir (?:direto )?(?:pra|para) a prova|pode testar|j[aá] domino|j[aá] sei isso|quero a prova|take the exam|ready for the exam)\b/iu;

function tokenOverlap(a: string, b: string): number {
	const tokensA = new Set(normalize(a).split(/[^a-z0-9\p{L}]+/u).filter(t => t.length >= 2));
	const tokensB = new Set(normalize(b).split(/[^a-z0-9\p{L}]+/u).filter(t => t.length >= 2));
	if (!tokensA.size || !tokensB.size) return 0;
	let shared = 0;
	for (const t of tokensA) if (tokensB.has(t)) shared++;
	return shared / Math.max(tokensA.size, tokensB.size);
}

export function prepareLessonExam(messages: readonly LhViewMessage[], input: LessonExam) {
	const attempts = examHistory(messages);
	if (attempts.length >= examLimit) throw new Error("A prova já teve duas tentativas. Registre o resultado e encerre a aula.");
	const first = attempts[0];
	if (!first) {
		const hasInstruction = messages.some(m => m.role === "assistant" && m.parts.some(p =>
			(p.type === "text" && (p.text?.trim().length ?? 0) >= 20) ||
			(p.type === "tool-send_to_user" && p.state === "output-available"),
		));
		const learnerRequestedExam = messages.some(m => m.role === "user" && m.parts.some(p => p.type === "text" && DIRECT_EXAM_REQUEST_RE.test(p.text ?? "")));
		if (!hasInstruction && !learnerRequestedExam) {
			throw new Error("Ensine o conteúdo essencial do nó antes de apresentar a prova formal.");
		}
	}
	if (first && !first.answer) throw new Error("Aguarde a resposta à prova apresentada.");
	if (first && (!input.feedback?.trim() || input.feedback.trim().length < 20 || normalize(input.task) === normalize(first.task) || tokenOverlap(input.task, first.task) >= 0.88))
		throw new Error("Explique a lacuna e use um caso novo na segunda tentativa.");
	return { ...input, attempt: attempts.length + 1, total: examLimit };
}

function citesAnswer(text: string, answers: readonly string[]) {
	const evidence = normalize(text);
	const quoted = [...evidence.matchAll(/"([^"]+)"/g)].map(match => stripOuterQuotes(match[1]!));
	const excerpts = [evidence, stripOuterQuotes(evidence), ...quoted].map(trimEdgePunctuation).filter(Boolean);
	return excerpts.some((excerpt, index) => excerpt && isLessonExamAnswer(excerpt)
		&& answers.some(answer => {
			const a = normalize(answer);
			const aTrimmed = trimEdgePunctuation(a);
			if (a === excerpt || aTrimmed === excerpt) return true;
			const minLen = index >= 2 ? 2 : 8;
			return excerpt.length >= minLen && a.includes(excerpt);
		}));
}

const TRIVIAL_EVIDENCE_RE = /^(?:[a-z\p{L}]|de|da|do|em|no|na|um|uma|os|as|the|an|in|on|to|of|is|it)$/iu;

function isSubstantialCriterionEvidence(excerpt: string, submittedTrimmed: string): boolean {
	if (!excerpt) return false;
	if (excerpt === submittedTrimmed) return true;
	if (TRIVIAL_EVIDENCE_RE.test(excerpt)) return false;
	return excerpt.length >= 4 || /\d/.test(excerpt);
}

export function validateExamVerdict(messages: readonly LhViewMessage[], input: LessonConclusion, objectiveCount: number) {
	const attempts = examHistory(messages);
	if (!attempts.length) throw new Error("Apresente a prova do nó antes de registrar um resultado.");
	const answer = attempts.at(-1)?.answer;
	if (!answer) throw new Error("Aguarde a entrega da resposta no formulário da prova.");
	if (!citesAnswer(input.evidence, [answer])) throw new Error("Cite a resposta da última prova.");
	const criteria = input.criteria ?? [];
	const ids = new Set(criteria.map(item => item.objective));
	if (criteria.length !== objectiveCount || ids.size !== objectiveCount || criteria.some(item => item.objective < 1 || item.objective > objectiveCount))
		throw new Error("Avalie cada critério do nó uma vez, com sua justificativa.");
	if (input.grade === 3) {
		if (criteria.some(item => !item.met)) throw new Error("A aprovação exige desempenho independente em todos os objetivos.");
		const submitted = normalize(answer);
		const submittedTrimmed = trimEdgePunctuation(submitted);
		if (criteria.some(item => {
			const raw = stripOuterQuotes(normalize(item.evidence ?? ""));
			const excerpt = trimEdgePunctuation(raw);
			return !isSubstantialCriterionEvidence(excerpt, submittedTrimmed) || (!submitted.includes(raw) && !submitted.includes(excerpt));
		}))
			throw new Error("Cite em cada critério aprovado uma evidência literal da entrega, sem aspas externas.");
		return "passed";
	}
	if (attempts.length < examLimit) throw new Error("Dê uma devolutiva e apresente uma segunda tentativa em um caso novo.");
	return "reinforce";
}

export function validateLessonConclusion(messages: readonly LhViewMessage[], input: LessonConclusion) {
	if (!Value.Check(lessonConclusionSchema, input) || input.cards.length === 0) throw new Error("Inclua a avaliação do nó, a resposta observada e de um a quatro cartões.");
	const taught: string[] = [], answers: string[] = [];
	let instruction = false;
	for (const message of messages) for (const part of message.parts) {
		if (part.type === "text" && part.text?.trim()) {
			if (message.role === "assistant") { taught.push(normalize(part.text)); instruction = true; }
			else if (instruction) answers.push(normalize(part.text));
		}
		if (message.role === "assistant" && part.type === "tool-present_lesson_exam" && part.state === "output-available") {
			const examFeedback = (part.output as LessonExam | undefined)?.feedback;
			if (typeof examFeedback === "string" && examFeedback.trim()) { taught.push(normalize(examFeedback)); instruction = true; }
		}
		if (message.role === "assistant" && part.type === "tool-send_to_user" && part.state === "output-available") {
			const sent = (part.input as { message?: unknown } | undefined)?.message;
			if (typeof sent === "string" && sent.trim()) { taught.push(normalize(sent)); instruction = true; }
		}
		if (part.type !== "tool-explain" && part.type !== "tool-quiz") continue;
		const result = part.output as QuestionAnswerData | undefined;
		if (result?.questionText) instruction = true;
		if (!result || result.dismissed || result.dontKnow) continue;
		if (part.type === "tool-explain" && result.text) answers.push(normalize(result.text));
		if (part.type === "tool-quiz" && gradeStudyQuiz(part.input, part.toolCallId ?? "", result)?.grade === 3)
			for (const answer of result.answers) answers.push(normalize(answer.label ?? answer.value));
	}
	if (!citesAnswer(input.evidence, answers))
		throw new Error("Cite uma resposta real do aluno depois da explicação que demonstre o objetivo do nó.");
	const questions = new Set<string>();
	for (const card of input.cards) {
		const source = normalize(card.source);
		if (!source || !taught.some(p => p.includes(source))) throw new Error("Use em source um trecho literal da explicação já apresentada nesta sessão.");
		const q = normalize(card.question), a = normalize(card.answer).replace(/[.!?]+$/, "");
		if (!a || !q || (" " + q.replace(/[?!.,:;]/g, " ") + " ").includes(" " + a + " "))
			throw new Error("Reformule a pergunta para exigir recuperação da resposta.");
		if (questions.has(q)) throw new Error("Pergunta repetida. Selecione outro alvo ou remova o cartão.");
		questions.add(q);
	}
}
