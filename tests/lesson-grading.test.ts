/**
 * Deterministic grading (docs/impl/lesson.md; SÍNTESE P7, §2.4(c) item 4;
 * r1 §6.7, §8.3 dictation, §9.1 buggy rules / prefix errors) and the LLM
 * grade parser.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fc from "fast-check";
import {
	compareTranscripts,
	gradeNumeric,
	gradeResponse,
	gradeTranscript,
	gradingMethodFor,
	matchesAccepted,
	parseLlmGrade,
	PREFIX_ERROR_MISCONCEPTION,
	SPEECH_CONFIDENCE,
	transcriptTokens,
	validateResponse,
	withinTolerance,
} from "../src/core/lesson/grading.ts";
import type { AnswerKey, AnswerSpec, PracticeItem } from "../src/core/lesson/protocol.ts";
import { formatQuantity } from "../src/core/lesson/units.ts";

type NumericSpec = Extract<AnswerSpec, { kind: "numeric" }>;
const ohms = (value: number, extra: Partial<NumericSpec> = {}): NumericSpec => ({ kind: "numeric", value, unit: "Ω", tolerance: { rel: 0.01 }, buggy: [], ...extra });
const amps = (value: number): NumericSpec => ({ kind: "numeric", value, unit: "A", tolerance: { rel: 0.01 }, buggy: [] });
const hints: [string, string, string] = ["pista", "princípio", "passo"];
const key = (itemId: string, answer: AnswerSpec): AnswerKey => ({ itemId, answer, hints, solution: ["s"], verifiedBy: "key" });

describe("numeric grading with SI units", () => {
	test('"4.7 kΩ" against 4700 Ω is correct', () => {
		const r = gradeNumeric("4.7 kΩ", ohms(4700));
		assert.equal(r.grade, 3);
		assert.equal(r.correct, true);
		assert.equal(r.confidence, 1);
	});

	test('"4700 ohm", "4,7 kΩ" and "4k7 Ω" are all correct', () => {
		for (const text of ["4700 ohm", "4,7 kΩ", "4k7 Ω", "4,7 quilo-ohms"]) assert.equal(gradeNumeric(text, ohms(4700)).grade, 3, text);
	});

	test('"2,2mA" (pt-BR comma, no space) against 0.0022 A', () => {
		assert.equal(gradeNumeric("2,2mA", amps(0.0022)).grade, 3);
		assert.equal(gradeNumeric("2.2 mA", amps(0.0022)).grade, 3);
	});

	test("a bare number is read in the displayed unit (answerUnit)", () => {
		assert.equal(gradeNumeric("2,2", amps(0.0022), { answerUnit: "mA" }).grade, 3);
		// Without a displayed unit, "2,2" means 2,2 A: a prefix slip.
		assert.equal(gradeNumeric("2,2", amps(0.0022)).misconceptionId, PREFIX_ERROR_MISCONCEPTION);
	});

	test("unit mismatch scores 0", () => {
		const r = gradeNumeric("4,7 kV", ohms(4700));
		assert.equal(r.grade, 0);
		assert.match(r.detail, /unidade incompatível/);
	});

	test("SI prefix slip earns partial credit and the prefix_error misconception", () => {
		const r = gradeNumeric("4,7 Ω", ohms(4700));
		assert.equal(r.grade, 1);
		assert.equal(r.correct, false);
		assert.equal(r.misconceptionId, PREFIX_ERROR_MISCONCEPTION);
		assert.equal(gradeNumeric("4,7 MΩ", ohms(4700)).misconceptionId, PREFIX_ERROR_MISCONCEPTION);
	});

	test("buggy-rule answers map to their misconception", () => {
		const r = gradeNumeric("500 Ω", ohms(4500, { buggy: [{ value: 500, misconceptionId: "m.parallel_sum" }] }));
		assert.equal(r.grade, 0);
		assert.equal(r.misconceptionId, "m.parallel_sum");
	});

	test("tolerance: relative 1% by default, absolute when given", () => {
		assert.equal(gradeNumeric("4,74 kΩ", ohms(4700)).grade, 3);
		assert.equal(gradeNumeric("4,8 kΩ", ohms(4700)).grade, 0);
		assert.ok(withinTolerance(0.004, 0, { abs: 0.005 }));
		assert.ok(!withinTolerance(0.006, 0, { abs: 0.005 }));
	});

	test("property: prefixed (both locales) and plain SI spellings of the target are accepted", () => {
		fc.assert(
			fc.property(fc.integer({ min: 1, max: 9999 }), fc.constantFrom(-1, 0, 2, 3, 5), fc.constantFrom("pt-BR" as const, "en" as const), (n, e, locale) => {
				const value = n * 10 ** e;
				for (const spelled of [formatQuantity(value, "Ω", { locale, digits: 6 }), `${value} ohm`]) {
					assert.equal(gradeNumeric(spelled, ohms(value)).grade, 3, spelled);
				}
			}),
			{ numRuns: 200 },
		);
	});
});

describe("validateResponse (public fields only)", () => {
	const numeric: PracticeItem = { id: "n", kind: "numeric", stem: "R?", difficulty: 1, requireUnit: true };
	test("missing unit when the item requires it does not consume the attempt", () => {
		const r = validateResponse(numeric, { kind: "text", text: "4700" });
		assert.equal(r?.status, "invalid");
		assert.equal(r?.reason, "missing_unit");
	});
	test("unreadable values and wrong response kinds", () => {
		assert.equal(validateResponse(numeric, { kind: "text", text: "quatro mil" })?.reason, "unreadable");
		assert.equal(validateResponse(numeric, { kind: "choice", optionId: "a" })?.reason, "wrong_response_kind");
		assert.equal(validateResponse(numeric, { kind: "dont_know" }), null);
	});
	test("unknown option", () => {
		const mcq: PracticeItem = { id: "m", kind: "mcq", stem: "?", difficulty: 1, options: [{ id: "a", text: "A" }] };
		assert.equal(validateResponse(mcq, { kind: "choice", optionId: "z" })?.reason, "unknown_option");
	});
});

describe("gradeResponse", () => {
	const mcq: PracticeItem = { id: "m", kind: "mcq", stem: "?", difficulty: 1, options: [{ id: "a", text: "A" }, { id: "b", text: "B" }, { id: "c", text: "C" }] };
	const mcqKey = key("m", { kind: "choice", correctOptionId: "b", distractors: { a: "m.x" } });

	test("mcq: correct, distractor with misconception, plain wrong", () => {
		assert.equal((gradeResponse(mcq, mcqKey, { kind: "choice", optionId: "b" }) as { grade: number }).grade, 3);
		const wrong = gradeResponse(mcq, mcqKey, { kind: "choice", optionId: "a" });
		assert.equal(wrong.status, "graded");
		assert.equal(wrong.status === "graded" && wrong.misconceptionId, "m.x");
		const plain = gradeResponse(mcq, mcqKey, { kind: "choice", optionId: "c" });
		assert.equal(plain.status === "graded" && plain.misconceptionId, undefined);
	});

	test("don't know is a deterministic 0", () => {
		const r = gradeResponse(mcq, mcqKey, { kind: "dont_know" });
		assert.equal(r.status === "graded" && r.grade, 0);
	});

	test("a key for another item is a programming error", () => {
		assert.throws(() => gradeResponse(mcq, key("other", mcqKey.answer), { kind: "choice", optionId: "b" }), /não pertence/);
	});

	test("short: accepted forms match after folding; otherwise the LLM grader decides", () => {
		const short: PracticeItem = { id: "s", kind: "short", stem: "?", difficulty: 1, maxWords: 10 };
		const k = key("s", { kind: "text", accepted: ["São iguais"], reference: "as correntes são iguais", rubric: ["igual"] });
		assert.equal(gradeResponse(short, k, { kind: "text", text: "sao IGUAIS!" }).status, "graded");
		assert.equal(gradeResponse(short, k, { kind: "text", text: "a mesma corrente" }).status, "needs_llm");
		assert.ok(matchesAccepted("  Série. ", ["serie"]));
		assert.equal(gradingMethodFor(short), "deterministic_then_llm");
	});

	test("explain always goes to the LLM grader", () => {
		const explain: PracticeItem = { id: "e", kind: "explain", stem: "?", difficulty: 2, maxWords: 60 };
		const k = key("e", { kind: "text", accepted: [], reference: "ref", rubric: ["r"] });
		assert.equal(gradeResponse(explain, k, { kind: "text", text: "porque sim" }).status, "needs_llm");
		assert.equal(gradingMethodFor(explain), "llm");
	});

	test("numeric through gradeResponse uses the item's answerUnit", () => {
		const item: PracticeItem = { id: "n", kind: "numeric", stem: "I?", difficulty: 1, answerUnit: "mA", requireUnit: false };
		const r = gradeResponse(item, key("n", amps(0.003)), { kind: "text", text: "3" });
		assert.equal(r.status === "graded" && r.grade, 3);
	});
});

describe("dictation and speech", () => {
	const dictation: PracticeItem = { id: "d", kind: "dictation", stem: "Escreva o que ouvir.", difficulty: 1, audioId: "tts:d", lang: "en" };
	const dictKey = key("d", { kind: "transcript", text: "I can't go there today.", accepted: [] });

	test("normalization: case, punctuation, contractions, numbers", () => {
		assert.deepEqual(transcriptTokens("I can't go there, TODAY!"), ["i", "can", "not", "go", "there", "today"]);
		assert.deepEqual(transcriptTokens("I have 3 cats"), ["i", "have", "three", "cats"]);
		const r = gradeResponse(dictation, dictKey, { kind: "text", text: "i cannot go there today" });
		assert.equal(r.status === "graded" && r.grade, 3);
	});

	test("WER thresholds", () => {
		const ref = "the quick brown fox jumps over the lazy dog today";
		assert.equal(gradeTranscript("the quick brown fox jumps over the lazy dog", [ref], "dictation").grade, 2);
		assert.equal(gradeTranscript("the quick brown box jumps over the lazy dog", [ref], "dictation").grade, 1);
		assert.equal(gradeTranscript("a slow cat", [ref], "dictation").grade, 0);
		const c = compareTranscripts("ship", "sheep");
		assert.equal(c.wer, 1);
		assert.deepEqual(c.ops, [{ op: "sub", ref: "ship", hyp: "sheep" }]);
	});

	test("speech: ASR confidence and accepted variants", () => {
		const speak: PracticeItem = { id: "sp", kind: "speak", stem: "Diga a frase.", difficulty: 1, lang: "en" };
		const k = key("sp", { kind: "transcript", text: "I would like a coffee", accepted: ["I'd like a coffee"] });
		const r = gradeResponse(speak, k, { kind: "speech", transcript: "I'd like a coffee" });
		assert.equal(r.status === "graded" && r.grade, 3);
		assert.equal(r.status === "graded" && r.confidence, SPEECH_CONFIDENCE);
	});
});

describe("parseLlmGrade", () => {
	const ctx = { misconceptionIds: ["m.known"] };
	test("valid output passes through", () => {
		const r = parseLlmGrade({ grade: 3, confidence: 0.9, correct: true, misconceptionId: null, newMisconception: null, attributions: [], rationale: "ok" }, ctx);
		assert.equal(r.ok, true);
	});
	test("correct is forced to follow grade >= 2", () => {
		const r = parseLlmGrade({ grade: 1, confidence: 0.6, correct: true }, ctx);
		assert.ok(r.ok);
		assert.equal(r.grade.correct, false);
		assert.equal(r.warnings.length, 1);
	});
	test("unknown misconception ids become proposals", () => {
		const r = parseLlmGrade({ grade: 0, confidence: 0.7, correct: false, misconceptionId: "m.invented" }, ctx);
		assert.ok(r.ok);
		assert.equal(r.grade.misconceptionId, null);
		assert.equal(r.grade.newMisconception, "m.invented");
	});
	test("a correct answer cannot carry a misconception", () => {
		const r = parseLlmGrade({ grade: 3, confidence: 0.9, correct: true, misconceptionId: "m.known" }, ctx);
		assert.ok(r.ok);
		assert.equal(r.grade.misconceptionId, null);
	});
	test("schema violations are reported, not thrown", () => {
		const r = parseLlmGrade({ grade: 5, confidence: 2, correct: "yes", extra: 1 }, ctx);
		assert.equal(r.ok, false);
		assert.ok(!r.ok && r.issues.length >= 3);
	});
});
