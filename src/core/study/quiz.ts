import { isCorrect, normalizeOptions, normalizeQuizType, resolveCorrect, seededRandom, shuffleOptions, type QuestionAnswerData } from "../question-core.ts";
import { parseQuizInput } from "../tool-parts.ts";

/** Reconstruct the dock's option identities from the saved call. Only the selection
 * and the optional display timer come from the submission. */
export function gradeStudyQuiz(input: unknown, callId: string, details: unknown) {
	const quiz = parseQuizInput(input);
	const answer = details as Partial<QuestionAnswerData> | null;
	if (!quiz || normalizeQuizType(quiz.type) !== "check" || answer?.kind !== "quiz" || answer.dismissed || !Array.isArray(answer.answers)) return null;
	const options = shuffleOptions(normalizeOptions(quiz.options), seededRandom(callId));
	const key = resolveCorrect(quiz.correctAnswer, options);
	if (key.error) return null;
	const indices: number[] = [];
	for (const choice of answer.answers) {
		if (!choice || !Number.isInteger(choice.index) || options[choice.index - 1]?.value !== choice.value || typeof choice.value !== "string") return null;
		indices.push(choice.index);
	}
	if (answer.dontKnow ? indices.length !== 0 : indices.length === 0) return null;
	if (new Set(indices).size !== indices.length || (!quiz.multiSelect && indices.length > 1)) return null;
	const grade: 0 | 3 = !answer.dontKnow && isCorrect(indices, key.indices) ? 3 : 0;
	const ms = answer.latencyMs;
	const labels = (choices: readonly number[]) => choices.map(i => options[i - 1]!.label).join(", ").slice(0, 400);
	return { grade, options: options.length,
		...(grade === 0 && { quizContext: { question: quiz.question.slice(0, 600), answer: answer.dontKnow ? "Não sei" : labels(indices), expected: labels(key.indices) } }),
		...(typeof ms === "number" && Number.isSafeInteger(ms) && ms >= 0 ? { latencyMs: ms } : {}) };
}
