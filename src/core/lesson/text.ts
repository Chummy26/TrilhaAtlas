/**
 * Text measurement for the lesson cadence rules (docs/research/00-SINTESE.md
 * §1.2 P2, §1.3 "Orçamento de palavras por fase"; r1 §6.4, §6.12, §6.13).
 *
 * Deterministic, dependency-free helpers shared by the TurnBudget validator
 * (./budget.ts) and the LessonPlan schema (./protocol.ts):
 *
 *   • proseOnly          — drops what is not prose the learner reads as words
 *                          (fenced blocks, inline code, URLs); math spans count
 *                          as ONE word each.
 *   • learnerDirectedText — additionally drops quoted material (double quotes,
 *                          curly quotes, «», *italic*, _italic_, blockquote
 *                          lines). English lessons quote target-language
 *                          examples ("Have you ever been there?"); those are
 *                          content, not questions to the learner. The prompts
 *                          (src/agent/prompts/lesson/phase-render.md) require
 *                          examples to be quoted, italicized or blockquoted.
 *   • countWords / countQuestions / endsWithQuestion / hasMidProseQuestion.
 *   • foldText            — NFKD + diacritics stripped + lowercase, the
 *                          comparison form used by the banned-phrase
 *                          detector (./budget.ts) and the graders
 *                          (./grading.ts): "Ótima pergunta" ≡ "otima pergunta".
 *
 * A "question" is a run of "?" (optionally mixed with "!"), e.g. "?", "??",
 * "?!". This is the r1 §6.13 simplification (punctuation, not a classifier):
 * predictable, cheap and testable. Pure and browser-safe.
 */

const FENCED_BLOCK = /(```|~~~)[\s\S]*?\1/g;
const DISPLAY_MATH = /\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]/g;
const INLINE_MATH = /\\\([\s\S]*?\\\)|(?<!\\)\$[^$\n]+?\$/g;
const INLINE_CODE = /`[^`\n]*`/g;
const URL = /https?:\/\/\S+/g;

const DOUBLE_QUOTED = /"[^"\n]*"/g;
const CURLY_QUOTED = /“[^”\n]*”/g;
const GUILLEMETS = /«[^»\n]*»/g;
const STAR_ITALIC = /(?<![*\p{L}\p{N}])\*(?!\*)[^*\n]+?\*(?!\*)/gu;
const UNDERSCORE_ITALIC = /(?<![_\p{L}\p{N}])_(?!_)[^_\n]+?_(?![_\p{L}\p{N}])/gu;

const WORD = /[\p{L}\p{N}]+(?:['’.,\-][\p{L}\p{N}]+)*/gu;
const QUESTION_RUN = /\?[?!]*|![?!]*\?[?!]*/g;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const TRAILING_QUESTION = /\?[?!]*[\s)\]*_"”’»]*$/u;

/** Text without code, URLs; math collapsed to a single token. */
export function proseOnly(text: string): string {
	return text
		.replace(FENCED_BLOCK, " ")
		.replace(DISPLAY_MATH, " MATH ")
		.replace(INLINE_MATH, " MATH ")
		.replace(INLINE_CODE, " CODE ")
		.replace(URL, " URL ");
}

/** Prose that addresses the learner: quoted examples and blockquotes removed. */
export function learnerDirectedText(text: string): string {
	return proseOnly(text)
		.split("\n")
		.filter((line) => !/^\s*>/.test(line))
		.join("\n")
		.replace(DOUBLE_QUOTED, " QUOTE ")
		.replace(CURLY_QUOTED, " QUOTE ")
		.replace(GUILLEMETS, " QUOTE ")
		.replace(STAR_ITALIC, " QUOTE ")
		.replace(UNDERSCORE_ITALIC, " QUOTE ");
}

/** Words of prose ("4,7", "kΩ", "R1", "don't" count as one word each). */
export function countWords(text: string): number {
	return proseOnly(text).match(WORD)?.length ?? 0;
}

/** Questions addressed to the learner (runs of "?" outside quotes/code/math). */
export function countQuestions(text: string): number {
	return learnerDirectedText(text).match(QUESTION_RUN)?.length ?? 0;
}

/** Whether the learner-directed prose ends with a question. */
export function endsWithQuestion(text: string): boolean {
	return TRAILING_QUESTION.test(learnerDirectedText(text).trimEnd());
}

/** Whether some question is followed by more prose (a question in the middle of the text). */
export function hasMidProseQuestion(text: string): boolean {
	const directed = learnerDirectedText(text);
	const runs = [...directed.matchAll(QUESTION_RUN)];
	const last = runs.at(-1);
	if (!last || last.index === undefined) return false;
	if (runs.length > 1) return true;
	const after = directed.slice(last.index + last[0].length);
	return LETTER_OR_DIGIT.test(after.replace(/\b(?:QUOTE|MATH|CODE|URL)\b/g, ""));
}

const COMBINING_MARKS = /\p{M}+/gu;

/** Comparison form: compatibility-decomposed, diacritics removed, lowercase. */
export function foldText(text: string): string {
	return text.normalize("NFKD").replace(COMBINING_MARKS, "").toLowerCase();
}
