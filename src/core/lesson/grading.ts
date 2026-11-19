/**
 * Deterministic grading (docs/research/00-SINTESE.md §2.4(c): "determinística
 * para mcq e numeric (tolerância rel/abs, unidade) … rubrica LLM para short,
 * free, explain, speak"; P7 "soluções verificadas"; r1 §6.7, §9.1 buggy rules,
 * §8.3 dictation/minimal pairs).
 *
 *   mcq / minimal_pair  exact option; a distractor names its misconception.
 *   numeric / sim       ./units.ts parser (pt-BR decimal comma, SI prefixes,
 *                       RKM); |x − v| ≤ max(abs, rel·|v|) (default rel 1%).
 *                       Diagnosis without dialogue: a value off by 10^±3k is
 *                       `prefix_error` (grade 1: the method was right, the
 *                       scale wrong); a value matching a buggy-rule answer
 *                       names that misconception (grade 0).
 *   short               normalized match against accepted answers → 3;
 *                       otherwise the `grader` role decides (needs_llm).
 *   explain             always the `grader` role (rubric 0–3).
 *   dictation / speak   word-level edit distance after English normalization
 *                       (contractions expanded, 0–20 spelled out, punctuation
 *                       dropped). Dictation: WER 0 → 3, ≤10% → 2, ≤25% → 1.
 *                       Speech (ASR transcript, noisier): ≤5% → 3, ≤15% → 2,
 *                       ≤35% → 1, confidence 0.7. Correct ⇔ grade ≥ 2.
 *
 * validateResponse() uses only PUBLIC item fields, so the server can reject a
 * malformed answer ("inclua a unidade") before it costs an attempt.
 * Learner-facing messages are pt-BR; `detail` strings are for the feedback
 * prompt (they may reveal the answer: feedback happens after grading).
 *
 * Pure and browser-safe.
 */

import { z } from "zod";
import type { Grade } from "../learner/types.ts";
import { PLAN_LIMITS, type AnswerKey, type AnswerSpec, type PracticeItem, type Tolerance } from "./protocol.ts";
import { foldText } from "./text.ts";
import { formatQuantity, parseQuantity, parseUnitExpression, scaleByPowerOfTen, type SiUnit } from "./units.ts";

export type LearnerResponse =
	| { kind: "choice"; optionId: string }
	| { kind: "text"; text: string }
	| { kind: "speech"; transcript: string }
	| { kind: "dont_know" };

export type GradingMethod = "deterministic" | "llm" | "deterministic_then_llm";

export interface GradedOutcome {
	status: "graded";
	grade: Grade;
	correct: boolean;
	/** 1 = deterministic; ASR-based speech 0.7. */
	confidence: number;
	misconceptionId?: string;
	detail: string;
}

export interface NeedsLlmOutcome {
	status: "needs_llm";
	reason: string;
}

export type InvalidReason = "unreadable" | "missing_unit" | "wrong_response_kind" | "unknown_option" | "empty";

export interface InvalidOutcome {
	status: "invalid";
	reason: InvalidReason;
	/** pt-BR, shown to the learner; the attempt is not consumed. */
	message: string;
}

export type GradeOutcome = GradedOutcome | NeedsLlmOutcome | InvalidOutcome;

/** Misconception id reported for SI-prefix slips (r1 §9.1 `prefix_error`). */
export const PREFIX_ERROR_MISCONCEPTION = "prefix_error";

const PREFIX_SHIFTS = [3, -3, 6, -6, 9, -9, 12, -12] as const;

export const TRANSCRIPT_THRESHOLDS = Object.freeze({
	dictation: [
		{ maxWer: 0, grade: 3 },
		{ maxWer: 0.1, grade: 2 },
		{ maxWer: 0.25, grade: 1 },
	],
	speech: [
		{ maxWer: 0.05, grade: 3 },
		{ maxWer: 0.15, grade: 2 },
		{ maxWer: 0.35, grade: 1 },
	],
} as const);

export const SPEECH_CONFIDENCE = 0.7;

// ─── Method + validation ────────────────────────────────────────────────────

export function gradingMethodFor(item: PracticeItem, response?: LearnerResponse): GradingMethod {
	if (response?.kind === "dont_know") return "deterministic";
	switch (item.kind) {
		case "mcq":
		case "minimal_pair":
		case "numeric":
		case "sim":
		case "dictation":
			return "deterministic";
		case "short":
			return "deterministic_then_llm";
		case "explain":
			return "llm";
		case "speak":
			return response && (response.kind === "speech" || response.kind === "text") ? "deterministic" : "llm";
	}
}

function invalid(reason: InvalidReason, message: string): InvalidOutcome {
	return { status: "invalid", reason, message };
}

function responseText(response: LearnerResponse): string | null {
	if (response.kind === "text") return response.text;
	if (response.kind === "speech") return response.transcript;
	return null;
}

/** Shape check using public item fields only (null = acceptable). */
export function validateResponse(item: PracticeItem, response: LearnerResponse): InvalidOutcome | null {
	if (response.kind === "dont_know") return null;
	switch (item.kind) {
		case "mcq":
		case "minimal_pair": {
			if (response.kind !== "choice") return invalid("wrong_response_kind", "Escolha uma das opções.");
			if (!item.options.some((o) => o.id === response.optionId)) return invalid("unknown_option", "Essa opção não existe neste item.");
			return null;
		}
		case "numeric":
		case "sim": {
			if (response.kind !== "text") return invalid("wrong_response_kind", "Digite um valor numérico.");
			const quantity = parseQuantity(response.text);
			if (!quantity) return invalid("unreadable", `Não consegui ler um valor em "${response.text.trim()}". Exemplos: 4,7 kΩ · 2,2 mA · 4k7.`);
			if (quantity.unit === null && item.requireUnit) return invalid("missing_unit", "Inclua a unidade (por exemplo: kΩ, mA, V).");
			return null;
		}
		case "short":
		case "explain":
		case "dictation": {
			const text = responseText(response);
			if (text === null) return invalid("wrong_response_kind", "Escreva a sua resposta.");
			return text.trim() ? null : invalid("empty", "A resposta está vazia.");
		}
		case "speak": {
			const text = responseText(response);
			if (text === null) return invalid("wrong_response_kind", "Grave ou escreva a frase.");
			return text.trim() ? null : invalid("empty", "Não captei nada; tente de novo.");
		}
	}
}

// ─── Numeric ────────────────────────────────────────────────────────────────

export function withinTolerance(actual: number, expected: number, tolerance: Tolerance): boolean {
	const rel = tolerance.rel ?? (tolerance.abs === undefined ? PLAN_LIMITS.defaultRelTolerance : 0);
	const allowed = Math.max(tolerance.abs ?? 0, rel * Math.abs(expected));
	// Float slack: 4.7·10³ is 4700.000000000001.
	return Math.abs(actual - expected) <= allowed + 1e-12 * Math.max(Math.abs(expected), Math.abs(actual));
}

type NumericSpec = Extract<AnswerSpec, { kind: "numeric" }>;

function graded(grade: Grade, detail: string, misconceptionId?: string, confidence = 1): GradedOutcome {
	return { status: "graded", grade, correct: grade >= 2, confidence, detail, ...(misconceptionId ? { misconceptionId } : {}) };
}

/** Value of a learner's answer in SI base units, reading bare numbers in the displayed unit. */
function learnerValueSI(raw: string, spec: NumericSpec, answerUnit: string | undefined): { value: number; unit: SiUnit | null } | null {
	const quantity = parseQuantity(raw);
	if (!quantity) return null;
	if (quantity.unit !== null) return { value: quantity.value, unit: quantity.unit };
	if (!quantity.prefixed && answerUnit) {
		const display = parseUnitExpression(answerUnit);
		if (display) return { value: scaleByPowerOfTen(quantity.value, display.exponent), unit: spec.unit };
	}
	return { value: quantity.value, unit: spec.unit };
}

export function gradeNumeric(raw: string, spec: NumericSpec, options: { answerUnit?: string } = {}): GradedOutcome {
	const answer = learnerValueSI(raw, spec, options.answerUnit);
	if (!answer) return graded(0, "valor ilegível");
	if (answer.unit !== spec.unit) {
		return graded(0, `unidade incompatível: recebi ${answer.unit ?? "um número sem unidade"}, a grandeza pede ${spec.unit ?? "um número adimensional"}`);
	}
	if (withinTolerance(answer.value, spec.value, spec.tolerance)) return graded(3, "dentro da tolerância");
	const bug = spec.buggy.find((b) => withinTolerance(answer.value, b.value, spec.tolerance));
	if (bug) return graded(0, `coincide com o erro típico "${bug.misconceptionId}"`, bug.misconceptionId);
	for (const shift of PREFIX_SHIFTS) {
		if (withinTolerance(answer.value, scaleByPowerOfTen(spec.value, shift), spec.tolerance)) {
			return graded(1, `erro de prefixo SI (fator 10^${shift}); esperado ${formatQuantity(spec.value, spec.unit)}`, PREFIX_ERROR_MISCONCEPTION);
		}
	}
	const deviation = spec.value === 0 ? null : Math.abs(answer.value - spec.value) / Math.abs(spec.value);
	return graded(0, deviation === null ? "fora da tolerância" : `fora da tolerância (desvio relativo de ${Math.round(deviation * 100)}%)`);
}

// ─── Text answers ───────────────────────────────────────────────────────────

/** Comparison form of a short answer: folded, punctuation → space, collapsed. */
export function normalizeAnswerText(text: string): string {
	return foldText(text)
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

export function matchesAccepted(text: string, accepted: readonly string[]): boolean {
	const normalized = normalizeAnswerText(text);
	return normalized !== "" && accepted.some((a) => normalizeAnswerText(a) === normalized);
}

// ─── Transcripts (dictation / speech) ───────────────────────────────────────

const SMALL_NUMBERS = [
	"zero",
	"one",
	"two",
	"three",
	"four",
	"five",
	"six",
	"seven",
	"eight",
	"nine",
	"ten",
	"eleven",
	"twelve",
	"thirteen",
	"fourteen",
	"fifteen",
	"sixteen",
	"seventeen",
	"eighteen",
	"nineteen",
	"twenty",
];

const CONTRACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
	[/\bcan't\b/g, "can not"],
	[/\bcannot\b/g, "can not"],
	[/\bwon't\b/g, "will not"],
	[/\bshan't\b/g, "shall not"],
	[/\blet's\b/g, "let us"],
	[/n't\b/g, " not"],
	[/'re\b/g, " are"],
	[/'m\b/g, " am"],
	[/'ll\b/g, " will"],
	[/'ve\b/g, " have"],
	[/'d\b/g, " would"],
	[/\b(it|that|what|there|here|he|she|who|where|how)'s\b/g, "$1 is"],
];

/** Tokens of an English transcript in comparison form. */
export function transcriptTokens(text: string, lang = "en"): string[] {
	let s = foldText(text).replace(/[’‘`´]/g, "'");
	if (lang.startsWith("en")) {
		for (const [pattern, replacement] of CONTRACTIONS) s = s.replace(pattern, replacement);
		s = s.replace(/\b\d+\b/g, (d) => SMALL_NUMBERS[Number(d)] ?? d);
	}
	return s
		.replace(/[^\p{L}\p{N}' ]+/gu, " ")
		.split(/\s+/)
		.map((t) => t.replace(/^'+|'+$/g, ""))
		.filter(Boolean);
}

export type TranscriptOp = { op: "sub"; ref: string; hyp: string } | { op: "del"; ref: string } | { op: "ins"; hyp: string };

export interface TranscriptComparison {
	/** Word error rate: edits / reference length. */
	wer: number;
	edits: number;
	referenceLength: number;
	/** Non-matching operations, in reading order. */
	ops: TranscriptOp[];
}

/** Word-level Levenshtein with backtrace. */
export function compareTranscripts(reference: string, hypothesis: string, lang = "en"): TranscriptComparison {
	const ref = transcriptTokens(reference, lang);
	const hyp = transcriptTokens(hypothesis, lang);
	const rows = ref.length + 1;
	const cols = hyp.length + 1;
	const d: number[] = new Array<number>(rows * cols).fill(0);
	const at = (i: number, j: number): number => d[i * cols + j] ?? 0;
	for (let i = 0; i < rows; i++) d[i * cols] = i;
	for (let j = 0; j < cols; j++) d[j] = j;
	for (let i = 1; i < rows; i++) {
		for (let j = 1; j < cols; j++) {
			const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
			d[i * cols + j] = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
		}
	}
	const ops: TranscriptOp[] = [];
	let i = ref.length;
	let j = hyp.length;
	while (i > 0 || j > 0) {
		const r = ref[i - 1] ?? "";
		const h = hyp[j - 1] ?? "";
		if (i > 0 && j > 0 && at(i, j) === at(i - 1, j - 1) + (r === h ? 0 : 1)) {
			if (r !== h) ops.push({ op: "sub", ref: r, hyp: h });
			i--;
			j--;
		} else if (i > 0 && at(i, j) === at(i - 1, j) + 1) {
			ops.push({ op: "del", ref: r });
			i--;
		} else {
			ops.push({ op: "ins", hyp: h });
			j--;
		}
	}
	ops.reverse();
	const edits = at(ref.length, hyp.length);
	return { wer: ref.length === 0 ? (hyp.length === 0 ? 0 : 1) : edits / ref.length, edits, referenceLength: ref.length, ops };
}

function describeOps(ops: readonly TranscriptOp[]): string {
	if (ops.length === 0) return "transcrição idêntica";
	const shown = ops.slice(0, 3).map((op) => (op.op === "sub" ? `"${op.hyp}" no lugar de "${op.ref}"` : op.op === "del" ? `faltou "${op.ref}"` : `sobrou "${op.hyp}"`));
	return shown.join("; ") + (ops.length > 3 ? `; e mais ${ops.length - 3}` : "");
}

function gradeByWer(wer: number, scale: ReadonlyArray<{ maxWer: number; grade: number }>): Grade {
	for (const step of scale) if (wer <= step.maxWer + 1e-9) return step.grade as Grade;
	return 0;
}

export function gradeTranscript(
	hypothesis: string,
	references: readonly string[],
	mode: "dictation" | "speech",
	lang = "en",
): GradedOutcome {
	const best = references
		.map((ref) => compareTranscripts(ref, hypothesis, lang))
		.reduce<TranscriptComparison | null>((a, b) => (a === null || b.wer < a.wer ? b : a), null);
	if (!best) return graded(0, "sem referência");
	const grade = gradeByWer(best.wer, TRANSCRIPT_THRESHOLDS[mode]);
	const confidence = mode === "speech" ? SPEECH_CONFIDENCE : 1;
	return graded(grade, `${describeOps(best.ops)} (WER ${Math.round(best.wer * 100)}%)`, undefined, confidence);
}

// ─── Entry point ────────────────────────────────────────────────────────────

/** Grade a response against the server-side key. `needs_llm` hands the item to the `grader` role. */
export function gradeResponse(item: PracticeItem, key: AnswerKey, response: LearnerResponse): GradeOutcome {
	if (key.itemId !== item.id) throw new Error(`gradeResponse: a chave "${key.itemId}" não pertence ao item "${item.id}".`);
	const problem = validateResponse(item, response);
	if (problem) return problem;
	if (response.kind === "dont_know") return graded(0, "o aluno marcou \"não sei\"");
	const spec = key.answer;
	switch (spec.kind) {
		case "choice": {
			if (response.kind !== "choice") return invalid("wrong_response_kind", "Escolha uma das opções.");
			if (response.optionId === spec.correctOptionId) return graded(3, "opção correta");
			const misconceptionId = spec.distractors[response.optionId];
			return graded(0, misconceptionId ? `distrator ligado a "${misconceptionId}"` : "opção incorreta", misconceptionId);
		}
		case "numeric": {
			const text = responseText(response) ?? "";
			const answerUnit = item.kind === "numeric" || item.kind === "sim" ? item.answerUnit : undefined;
			return gradeNumeric(text, spec, answerUnit ? { answerUnit } : {});
		}
		case "text": {
			const text = responseText(response) ?? "";
			if (item.kind === "short" && matchesAccepted(text, spec.accepted)) return graded(3, "coincide com uma resposta aceita");
			return { status: "needs_llm", reason: item.kind === "explain" ? "explicação avaliada por rubrica" : "resposta curta fora das formas aceitas" };
		}
		case "transcript": {
			const text = responseText(response) ?? "";
			const lang = item.kind === "dictation" || item.kind === "speak" ? item.lang : "en";
			return gradeTranscript(text, [spec.text, ...spec.accepted], item.kind === "speak" ? "speech" : "dictation", lang);
		}
	}
}

// ─── LLM grader output (src/agent/prompts/lesson/grader.md) ─────────────────

const GradeSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const LlmGradeSchema = z.strictObject({
	grade: GradeSchema,
	confidence: z.number().min(0).max(1),
	correct: z.boolean(),
	misconceptionId: z.string().trim().min(1).nullable().default(null),
	newMisconception: z.string().trim().min(1).max(200).nullable().default(null),
	attributions: z
		.array(
			z.strictObject({
				nodeId: z.string().trim().min(1),
				blame: z.number().min(0).max(1),
				misconceptionId: z.string().trim().min(1).nullable().optional(),
			}),
		)
		.max(6)
		.default([]),
	rationale: z.string().trim().max(600).default(""),
});
export type LlmGrade = z.infer<typeof LlmGradeSchema>;

export type ParsedLlmGrade = { ok: true; grade: LlmGrade; warnings: string[] } | { ok: false; issues: string[] };

/**
 * Validate the grader's JSON and make it consistent: `correct` follows the
 * rubric (grade ≥ 2); an undeclared misconception id becomes a
 * `newMisconception` proposal instead of a dangling reference.
 */
export function parseLlmGrade(raw: unknown, context: { misconceptionIds: readonly string[] }): ParsedLlmGrade {
	const parsed = LlmGradeSchema.safeParse(raw);
	if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`) };
	const grade = { ...parsed.data, attributions: parsed.data.attributions.map((a) => ({ ...a })) };
	const warnings: string[] = [];
	const correct = grade.grade >= 2;
	if (grade.correct !== correct) {
		warnings.push(`"correct" contradicted grade ${grade.grade}; fixed to ${correct}`);
		grade.correct = correct;
	}
	if (grade.misconceptionId && !context.misconceptionIds.includes(grade.misconceptionId)) {
		warnings.push(`unknown misconception "${grade.misconceptionId}" moved to newMisconception`);
		grade.newMisconception = grade.newMisconception ?? grade.misconceptionId;
		grade.misconceptionId = null;
	}
	if (grade.correct && grade.misconceptionId) {
		warnings.push("a correct answer cannot carry a misconception; dropped");
		grade.misconceptionId = null;
	}
	return { ok: true, grade, warnings };
}
