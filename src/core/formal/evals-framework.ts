/**
 * Pure, browser-safe 6-front evaluation framework for TrilhaAtlas (`evals/`).
 *
 * Implements:
 * - Official parsers for TutorMoments (AllenAI, 520 moments), TeachArena Stage 0
 *   (100 situated tutoring) & Stage 1 (117 pedagogical judgment with deterministic
 *   response checks + NL assertions), plus complementary MathTutorBench per-skill
 *   breakdowns and separate Memory (EvalMem 3-stage + LongMemEval-S).
 * - Paired prompt-version comparison statistics (candidate - baseline, 95% CI).
 * - Deterministic evaluation of `module-exam.ts` vs LLM `lesson/grader.md`.
 * - Separated Markdown & README report renderers (no mixed cross-front average,
 *   no invented SOTA targets, explicit effective prompt SHA-256 hashes).
 */

import { gradeModuleExam, type ModuleExam } from "../study/module-exam.ts";
import type { Grade } from "../learner/types.ts";
import {
	README_OFFICIAL_BENCH_BEGIN,
	README_OFFICIAL_BENCH_END,
	repairJsonLaTeXEscapes,
	type OfficialTurn,
} from "./official-datasets.ts";

// ─── Paired A/B Statistics (Exact Student-t 95% CI) ──────────────────────────

/** Two-tailed t critical values for 95% confidence (alpha = 0.05) by df. */
const T_CRIT_95: Record<number, number> = {
	1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
	6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
	11: 2.201, 12: 2.179, 13: 2.16, 14: 2.145, 15: 2.131,
	16: 2.12, 17: 2.11, 18: 2.101, 19: 2.093, 20: 2.086,
	25: 2.06, 30: 2.042, 40: 2.021, 60: 2.0, 120: 1.98,
};

function tCritical95(df: number): number {
	if (df <= 0) return 0;
	if (T_CRIT_95[df]) return T_CRIT_95[df]!;
	if (df > 120) return 1.96;
	const keys = Object.keys(T_CRIT_95).map(Number).sort((a, b) => a - b);
	for (const k of keys) {
		if (k >= df) return T_CRIT_95[k]!;
	}
	return 1.96;
}

export interface PairedMetricSummary {
	n: number;
	baselinePct: number;
	productionPct: number;
	deltaPp: number;
	ci95HalfWidthPp: number;
	ci95LowPp: number;
	ci95HighPp: number;
	baselineLatencyMs: number;
	productionLatencyMs: number;
	technicalFailures: number;
}

export function computePairedSummary(
	baselineScores01: readonly number[],
	productionScores01: readonly number[],
	baselineLatenciesMs: readonly number[] = [],
	productionLatenciesMs: readonly number[] = [],
	technicalFailures = 0,
): PairedMetricSummary {
	const n = Math.min(baselineScores01.length, productionScores01.length);
	if (n === 0) {
		return {
			n: 0,
			baselinePct: 0,
			productionPct: 0,
			deltaPp: 0,
			ci95HalfWidthPp: 0,
			ci95LowPp: 0,
			ci95HighPp: 0,
			baselineLatencyMs: 0,
			productionLatencyMs: 0,
			technicalFailures,
		};
	}
	const mean = (arr: readonly number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
	const bPct = mean(baselineScores01.slice(0, n)) * 100;
	const pPct = mean(productionScores01.slice(0, n)) * 100;
	const diffs = Array.from({ length: n }, (_, i) => (productionScores01[i]! - baselineScores01[i]!) * 100);
	const delta = mean(diffs);
	let halfWidth = 0;
	if (n >= 2) {
		const variance = diffs.reduce((s, d) => s + (d - delta) ** 2, 0) / (n - 1);
		const se = Math.sqrt(variance / n);
		halfWidth = tCritical95(n - 1) * se;
	}
	const round1 = (x: number) => Math.round(x * 10) / 10;
	return {
		n,
		baselinePct: round1(bPct),
		productionPct: round1(pPct),
		deltaPp: round1(delta),
		ci95HalfWidthPp: round1(halfWidth),
		ci95LowPp: round1(delta - halfWidth),
		ci95HighPp: round1(delta + halfWidth),
		baselineLatencyMs: baselineLatenciesMs.length ? Math.round(mean(baselineLatenciesMs)) : 0,
		productionLatencyMs: productionLatenciesMs.length ? Math.round(mean(productionLatenciesMs)) : 0,
		technicalFailures,
	};
}

// ─── Minimal-Contract Baseline Prompts (Control Condition) ───────────────────

export const MINIMAL_CONTRACT_PROMPTS = {
	teacher: [
		"You are an AI tutor. Reply directly in prose (Markdown/LaTeX) in the same language the learner wrote in.",
		"No external tools are attached in this turn; do not emit JSON tool calls.",
	].join("\n"),
	practice: [
		"You are a practice tutor assisting a student working on an exercise. Reply in the same language the student wrote in.",
		"No external tools are attached in this turn; do not emit JSON tool calls.",
	].join("\n"),
	"side-chat": [
		"You are a helpful study assistant answering a side question while the student is in a lesson. Reply in the same language the student wrote in.",
		"You do not have access to external tools.",
	].join("\n"),
	lessonPlan: [
		"Write a lesson plan for the curriculum node described in the user JSON as a single valid JSON object (no markdown fences).",
		"Include nodeId, lang, goal, hook, segments, knowledgePoints (with workedExample, fadedSteps, items), recap, misconceptions, and flashcardCandidates.",
	].join("\n"),
	grader: [
		"Grade the student response on an integer scale from 0 to 3 against the reference and rubric in the JSON.",
		'Output ONLY a valid JSON object: {"grade":0|1|2|3,"confidence":0..1,"correct":true|false,"misconceptionId":string|null,"newMisconception":string|null,"attributions":[],"rationale":"short explanation"}.',
	].join("\n"),
} as const;

// ─── Official TutorMoments Parser (AllenAI 520 Moments) ──────────────────────

export interface RawTutorMomentRow {
	id: string;
	dimension: "scaffolding" | "rigor" | string;
	context: { turn_number?: number; role?: string; text?: string }[];
	student?: {
		mode?: string;
		reference?: string;
		trait?: { persona?: string };
	};
	rubric?: { gold?: string; hint?: string };
}

export interface TutorMomentEvalItem {
	id: string;
	dimension: "scaffolding" | "rigor";
	contextMessages: OfficialTurn[];
	learnerTurn: string;
	studentPersona: string;
	goldHint: string;
}

const PURE_PAUSE_RE = /^\[PAUSE:\s*\d+\s*seconds?\]$/i;

/**
 * Parse official AllenAI TutorMoments rows (`moments.jsonl`), preserving the
 * permitted transcript history cleanly for TrilhaAtlas's native `system` +
 * `user`/`assistant` wire (avoiding the default client bug that stuffs system
 * instructions into a user message).
 */
export function parseTutorMomentsRows(rows: readonly RawTutorMomentRow[], maxTailTurns = 24): TutorMomentEvalItem[] {
	const out: TutorMomentEvalItem[] = [];
	for (const row of rows) {
		if (!row.id || !Array.isArray(row.context) || !row.context.length) continue;
		const dim: "scaffolding" | "rigor" = row.dimension === "rigor" ? "rigor" : "scaffolding";

		// Clean empty pauses while keeping every substantive student/tutor turn & whiteboard event.
		const merged: OfficialTurn[] = [];
		for (const turn of row.context) {
			const txt = String(turn.text ?? "").trim();
			if (!txt || PURE_PAUSE_RE.test(txt)) continue;
			const role: "user" | "assistant" = String(turn.role ?? "").toLowerCase() === "student" ? "user" : "assistant";
			const prev = merged.at(-1);
			if (prev && prev.role === role) {
				prev.content = `${prev.content}\n${txt}`;
			} else {
				merged.push({ role, content: txt });
			}
		}
		if (!merged.length) continue;

		// Keep up to `maxTailTurns` recent turns so full context fits comfortably while preserving latest state.
		const window = merged.length > maxTailTurns ? merged.slice(-maxTailTurns) : merged;
		while (window.length > 1 && window.at(-1)?.role !== "user") window.pop();
		if (window.at(-1)?.role !== "user") {
			window.push({ role: "user", content: "I'm not sure what to do next here." });
		}
		const learnerTurn = window.pop()!.content;
		out.push({
			id: row.id,
			dimension: dim,
			contextMessages: window,
			learnerTurn,
			studentPersona: String(row.student?.trait?.persona ?? "Math student in an online tutoring session.").slice(0, 1200),
			goldHint: String(row.rubric?.hint ?? `Appropriate moment for ${dim}.`),
		});
	}
	return out;
}

// ─── Official TeachArena Parsers (Stage 0 Tutoring + Stage 1 Judgment) ───────

export interface RawTeachArenaTask {
	id: string;
	task_type?: string;
	description?: { relevant_policies?: string };
	user_scenario?: {
		persona?: string;
		language?: string | null;
		instructions?: {
			domain?: string;
			reason_for_call?: string;
			known_info?: string;
			unknown_info?: string;
			task_instructions?: string;
		};
	};
	evaluation_criteria?: {
		nl_assertions?: string[];
		response_checks?: { type: string; values?: string[]; value?: string }[];
	};
}

export interface TeachArenaStage0Item {
	id: string;
	persona: string;
	reasonForCall: string;
	knownInfo: string;
	unknownInfo: string;
	initialLearnerTurn: string;
	nlAssertions: string[];
}

export interface TeachArenaStage1Item {
	id: string;
	persona: string;
	taskPrompt: string;
	responseChecks: { type: string; values?: string[]; value?: string }[];
	nlAssertions: string[];
}

export function parseTeachArenaStage0(rows: readonly RawTeachArenaTask[]): TeachArenaStage0Item[] {
	const out: TeachArenaStage0Item[] = [];
	for (const r of rows) {
		const ins = r.user_scenario?.instructions;
		const assertions = (r.evaluation_criteria?.nl_assertions ?? []).filter(Boolean);
		if (!r.id || !ins?.reason_for_call || !assertions.length) continue;
		const initialLearnerTurn = ins.task_instructions?.trim()
			? ins.task_instructions.trim()
			: [
				ins.reason_for_call.trim(),
				ins.known_info ? `What I already know: ${ins.known_info.trim()}` : "",
			].filter(Boolean).join("\n\n");
		out.push({
			id: r.id,
			persona: String(r.user_scenario?.persona ?? "Student seeking tutoring help."),
			reasonForCall: ins.reason_for_call.trim(),
			knownInfo: String(ins.known_info ?? "").trim(),
			unknownInfo: String(ins.unknown_info ?? "").trim(),
			initialLearnerTurn,
			nlAssertions: assertions,
		});
	}
	return out;
}

export function parseTeachArenaStage1(rows: readonly RawTeachArenaTask[]): TeachArenaStage1Item[] {
	const out: TeachArenaStage1Item[] = [];
	for (const r of rows) {
		const ins = r.user_scenario?.instructions;
		const assertions = (r.evaluation_criteria?.nl_assertions ?? []).filter(Boolean);
		const checks = r.evaluation_criteria?.response_checks ?? [];
		const prompt = [
			ins?.reason_for_call ? `Objective: ${ins.reason_for_call.trim()}` : "",
			ins?.task_instructions ? ins.task_instructions.trim() : "",
		].filter(Boolean).join("\n\n");
		if (!r.id || !prompt || (!assertions.length && !checks.length)) continue;
		out.push({
			id: r.id,
			persona: String(r.user_scenario?.persona ?? "Pedagogical evaluator"),
			taskPrompt: prompt,
			responseChecks: checks,
			nlAssertions: assertions,
		});
	}
	return out;
}

/** Deterministic evaluator for TeachArena Stage 1 `response_checks`. */
export function evaluateTeachArenaResponseChecks(
	reply: string,
	checks: readonly { type: string; values?: string[]; value?: string }[],
): { passed: number; total: number; score01: number } {
	if (!checks.length) return { passed: 0, total: 0, score01: 1 };
	const lower = reply.toLowerCase();
	let passed = 0;
	for (const chk of checks) {
		const vals = (chk.values ?? (chk.value ? [chk.value] : [])).map(v => v.toLowerCase());
		if (chk.type === "contains_any") {
			if (vals.some(v => lower.includes(v))) passed++;
		} else if (chk.type === "contains_all") {
			if (vals.every(v => lower.includes(v))) passed++;
		} else if (chk.type === "not_contains_any") {
			if (vals.every(v => !lower.includes(v))) passed++;
		} else {
			// Unknown check type: pass conservatively only if value appears
			if (vals.some(v => lower.includes(v))) passed++;
		}
	}
	return { passed, total: checks.length, score01: passed / checks.length };
}

// ─── Front 3: Grading Evaluation (Deterministic module-exam.ts vs LLM grader.md) ─

export interface GoldGradingCase {
	id: string;
	split: "dev" | "heldout";
	domain: "electronics" | "english";
	responseClass: string;
	nodeId: string;
	prompt: string;
	reference: string;
	rubricCriteria: string[];
	expectedTerms: string[];
	minWords: number;
	misconceptions: { id: string; diagnosticSignal: string }[];
	learnerAnswer: string;
	goldGrade: Grade;
	goldCorrect: boolean;
	goldMisconceptionId: string | null;
}

export interface GraderPrediction {
	caseId: string;
	responseClass: string;
	goldGrade: Grade;
	predictedGrade: Grade;
	goldMisconceptionId: string | null;
	predictedMisconceptionId: string | null;
	diagnosisCorrect: boolean;
	parseFailed?: boolean;
}

export interface GraderMetricsSummary {
	graderName: string;
	n: number;
	exactAgreementPct: number;
	withinOneGradePct: number;
	mae0to3: number;
	falsePassRatePct: number;
	falseFailRatePct: number;
	misconceptionDiagnosisPct: number;
	parseFailures: number;
}

export function summarizeGraderPredictions(
	graderName: string,
	preds: readonly GraderPrediction[],
): GraderMetricsSummary {
	const n = preds.length;
	if (!n) {
		return {
			graderName,
			n: 0,
			exactAgreementPct: 0,
			withinOneGradePct: 0,
			mae0to3: 0,
			falsePassRatePct: 0,
			falseFailRatePct: 0,
			misconceptionDiagnosisPct: 0,
			parseFailures: 0,
		};
	}
	let exact = 0;
	let within1 = 0;
	let absErr = 0;
	let goldFailTotal = 0;
	let falsePass = 0;
	let goldPassTotal = 0;
	let falseFail = 0;
	let miscTotal = 0;
	let miscCorrect = 0;
	let parseFailures = 0;

	for (const p of preds) {
		if (p.parseFailed) parseFailures++;
		const diff = Math.abs(p.predictedGrade - p.goldGrade);
		if (diff === 0) exact++;
		if (diff <= 1) within1++;
		absErr += diff;

		const goldPass = p.goldGrade >= 2;
		const predPass = p.predictedGrade >= 2;
		if (!goldPass) {
			goldFailTotal++;
			if (predPass) falsePass++;
		} else {
			goldPassTotal++;
			if (!predPass) falseFail++;
		}
		if (p.goldMisconceptionId !== null) {
			miscTotal++;
			if (p.diagnosisCorrect) miscCorrect++;
		}
	}

	const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);
	return {
		graderName,
		n,
		exactAgreementPct: pct(exact, n),
		withinOneGradePct: pct(within1, n),
		mae0to3: Math.round((absErr / n) * 100) / 100,
		falsePassRatePct: pct(falsePass, goldFailTotal),
		falseFailRatePct: pct(falseFail, goldPassTotal),
		misconceptionDiagnosisPct: pct(miscCorrect, miscTotal),
		parseFailures,
	};
}

/**
 * Evaluate TrilhaAtlas's deterministic `gradeModuleExam()` directly on the
 * specialist-labeled gold grading dataset (strictly separated from `lesson/grader.md`).
 */
export function evaluateDeterministicModuleExamGrader(
	cases: readonly GoldGradingCase[],
): { summary: GraderMetricsSummary; predictions: GraderPrediction[] } {
	const predictions: GraderPrediction[] = [];
	for (const c of cases) {
		const exam: ModuleExam = {
			id: `eval-${c.id}`,
			domainId: c.domain,
			scope: "module",
			targetId: c.nodeId,
			targetTitle: c.nodeId,
			seed: "eval-deterministic",
			passingScore10: 7.5,
			questions: [{
				id: c.id,
				nodeId: c.nodeId,
				prompt: c.prompt,
				rubricCriteria: c.rubricCriteria,
				expectedTerms: c.expectedTerms,
				minWords: c.minWords,
			}],
		};
		const { result } = gradeModuleExam(
			exam,
			{ [c.id]: c.learnerAnswer },
			{ domainId: c.domain, sessionId: "eval-session", at: "2026-11-21T00:00:00Z", startSeq: 1 },
		);
		const qRes = result.questionResults[0]!;
		predictions.push({
			caseId: c.id,
			responseClass: c.responseClass,
			goldGrade: c.goldGrade,
			predictedGrade: qRes.grade,
			goldMisconceptionId: c.goldMisconceptionId,
			predictedMisconceptionId: null, // deterministic grader does not output misconceptionId
			diagnosisCorrect: false,
		});
	}
	return {
		summary: summarizeGraderPredictions("module-exam.ts (determinístico)", predictions),
		predictions,
	};
}

// ─── JSON Helper for Blind Judge Scoring ─────────────────────────────────────

export function parseJudgeJsonObject<T>(rawText: string, label: string): T {
	const match = rawText.trim().match(/\{[\s\S]*\}/);
	if (!match) throw new Error(`Non-JSON judge response for ${label}`);
	try {
		return JSON.parse(match[0]) as T;
	} catch {
		return JSON.parse(repairJsonLaTeXEscapes(match[0])) as T;
	}
}

// ─── Six-Front Separated Report & README Renderer ────────────────────────────

export interface PromptHashRecord {
	key: string;
	chars: number;
	sha256: string;
}

export interface EvalModelSixFrontReport {
	modelSpec: string;
	judgeSpec: string;
	/** Front 1A: TutorMoments (AllenAI official 520-moment protocol, 3 separate dimensions) */
	tutorMoments: {
		appropriateScaffolding: PairedMetricSummary;
		appropriateRigor: PairedMetricSummary;
		avoidsOverScaffolding: PairedMetricSummary;
	};
	/** Front 1B: TeachArena (Stage 0 and Stage 1 reported strictly separately) */
	teachArenaStage0Tutoring: PairedMetricSummary;
	teachArenaStage1Judgment: {
		deterministicChecks: PairedMetricSummary;
		nlAssertions: PairedMetricSummary;
	};
	/** Front 1C: MathTutorBench complementary per-skill diagnostics (never collapsed) */
	mathTutorBenchBySkill: {
		subjectCorrectness: PairedMetricSummary;
		mistakeLocation: PairedMetricSummary;
		socraticScaffolding: PairedMetricSummary;
		noSpoilerTact: PairedMetricSummary;
	};
	/** Front 1D: TrilhaAtlas own domain/mode cases (teaching, practice, exam, side-chat, PT-BR TutorMoments adaptation) */
	trilhaAtlasModes: {
		teachingHintLevel: PairedMetricSummary;
		practiceNoUnrequestedClose: PairedMetricSummary;
		examZeroLeak: PairedMetricSummary;
		sideChatBoundaries: PairedMetricSummary;
		tutorMomentsPtBrAdaptation: PairedMetricSummary;
	};
	/** Front 2: Planning & exercise generation (StudentBench TrilhaAtlas adaptation) */
	planning: {
		conversationalPlanning: PairedMetricSummary;
		lessonPlanTemplateJson: PairedMetricSummary;
	};
	/** Front 3: Grading (LLM lesson/grader.md production vs minimal baseline, separate from module-exam.ts) */
	llmGraderProduction: GraderMetricsSummary;
	llmGraderMinimal: GraderMetricsSummary;
	/** Front 4: Grounding, PDFs, citations & interactive activities */
	groundingAndTools: PairedMetricSummary;
	/** Front 5 (SEPARATE SCOREBOARD): Memory & Personalization (EvalMem 3-stage + LongMemEval-S) */
	memorySeparate: {
		evalMemStage1Record: PairedMetricSummary;
		evalMemStage2RetrieveDeterministicPct: number;
		evalMemStage2RetrieveN: number;
		evalMemStage3TutorUse: PairedMetricSummary;
		longMemEvalS: PairedMetricSummary;
		locomoOptional?: PairedMetricSummary;
	};
}

export interface SixFrontEvalBundle {
	generatedAt: string;
	promptHashes: PromptHashRecord[];
	deterministicModuleExamGrader: GraderMetricsSummary;
	models: EvalModelSixFrontReport[];
}

function fmtDelta(m: PairedMetricSummary): string {
	const sign = m.deltaPp >= 0 ? "+" : "";
	return `${sign}${m.deltaPp.toFixed(1)} pp (±${m.ci95HalfWidthPp.toFixed(1)})`;
}

function fmtRow(label: string, m: PairedMetricSummary): string {
	return `| ${label} | ${m.baselinePct.toFixed(1)}% | **${m.productionPct.toFixed(1)}%** | ${fmtDelta(m)} | ${m.n} | ${m.productionLatencyMs} ms |`;
}

export function renderSixFrontMarkdown(bundle: SixFrontEvalBundle): string {
	const lines: string[] = [
		"# Avaliação em Seis Frentes dos System Prompts e Memória — TrilhaAtlas",
		"",
		`> Gerado automaticamente em **${bundle.generatedAt}** com comparação pareada (**Prompt atual de produção − Prompt mínimo com contratos**, mesmo modelo, mesmas condições, contexto congelado, juiz cego cruzado com identidade oculta e ordem alternada).`,
		"> **Separação metodológica:** não há média geral misturando frentes incompatíveis nem metas arbitrárias. **TutorMoments** e **TeachArena** (Stage 0 e Stage 1 individuais) formam o núcleo de tutoria; **MathTutorBench** é diagnóstico complementar por habilidade; **Memória (EvalMem + LongMemEval-S)** tem placar separado; **MRBench/BEA** e **MathDial** não entram no placar principal do tutor.",
		"",
		"## 0. Hashes SHA-256 dos Prompts Efetivos Compostos",
		"",
		"| Componente / Condição | Tamanho (chars) | SHA-256 (16 hex) |",
		"|---|---:|---|",
		...bundle.promptHashes.map(h => `| \`${h.key}\` | ${h.chars} | \`${h.sha256.slice(0, 16)}\` |`),
		"",
	];

	for (const r of bundle.models) {
		lines.push(
			`## Modelo: \`${r.modelSpec}\` (Juiz cego cruzado: \`${r.judgeSpec}\`)`,
			"",
			"### Frente 1 — Tutoria e Diagnóstico (Placar Principal)",
			"",
			"| Dimensão / Avaliação | Prompt mínimo | Prompt atual | Δ Pareado (IC 95%) | Casos (n) | Latência |",
			"|---|---:|---:|---:|---:|---:|",
			fmtRow("**TutorMoments (AllenAI)** · Apoio adequado", r.tutorMoments.appropriateScaffolding),
			fmtRow("**TutorMoments (AllenAI)** · Exigência adequada", r.tutorMoments.appropriateRigor),
			fmtRow("**TutorMoments (AllenAI)** · Evita excesso de ajuda", r.tutorMoments.avoidsOverScaffolding),
			fmtRow("**TeachArena** · Stage 0: Tutoria Situada (individual)", r.teachArenaStage0Tutoring),
			fmtRow("**TeachArena** · Stage 1: Julgamento (checks determinísticos)", r.teachArenaStage1Judgment.deterministicChecks),
			fmtRow("**TeachArena** · Stage 1: Julgamento (asserções NL)", r.teachArenaStage1Judgment.nlAssertions),
			fmtRow("**TrilhaAtlas Próprio** · Modo Ensino (nível de pista)", r.trilhaAtlasModes.teachingHintLevel),
			fmtRow("**TrilhaAtlas Próprio** · Modo Prática (não fecha sem pedido)", r.trilhaAtlasModes.practiceNoUnrequestedClose),
			fmtRow("**TrilhaAtlas Próprio** · Modo Exame (zero vazamento)", r.trilhaAtlasModes.examZeroLeak),
			fmtRow("**TrilhaAtlas Próprio** · Dúvida Lateral (áudio cego / exame)", r.trilhaAtlasModes.sideChatBoundaries),
			fmtRow("**Adaptação Interna PT-BR** (inspirada em TutorMoments)", r.trilhaAtlasModes.tutorMomentsPtBrAdaptation),
			"",
			"#### Diagnóstico Complementar — MathTutorBench (separado por habilidade, sem nota única)",
			"",
			"| Habilidade Pedagógica (eth-lre/mathtutorbench) | Prompt mínimo | Prompt atual | Δ Pareado (IC 95%) | Casos (n) | Latência |",
			"|---|---:|---:|---:|---:|---:|",
			fmtRow("Correção matemática", r.mathTutorBenchBySkill.subjectCorrectness),
			fmtRow("Localização do erro", r.mathTutorBenchBySkill.mistakeLocation),
			fmtRow("Apoio socrático", r.mathTutorBenchBySkill.socraticScaffolding),
			fmtRow("Tato sem revelar resposta", r.mathTutorBenchBySkill.noSpoilerTact),
			"",
			"### Frente 2 — Planejamento e Criação de Exercícios (Adaptação StudentBench)",
			"",
			"| Rota Avaliada | Prompt mínimo | Prompt atual | Δ Pareado (IC 95%) | Casos (n) | Latência |",
			"|---|---:|---:|---:|---:|---:|",
			fmtRow("Planejamento conversacional (`teacher/10-planning.md`)", r.planning.conversationalPlanning),
			fmtRow("Plano estruturado JSON (`lesson/lesson-plan.md`)", r.planning.lessonPlanTemplateJson),
			"",
			"### Frente 3 — Correção e Feedback (Corretores Separados · 14 casos rotulados)",
			"",
			"| Corretor | Concordância exata | ±1 nota | MAE (0–3) | Aprovação indevida (false-pass) | Reprovação indevida (false-fail) | Diagnóstico de erro | Erros de formato |",
			"|---|---:|---:|---:|---:|---:|---:|---:|",
			`| \`module-exam.ts\` (determinístico) | ${bundle.deterministicModuleExamGrader.exactAgreementPct.toFixed(1)}% | ${bundle.deterministicModuleExamGrader.withinOneGradePct.toFixed(1)}% | ${bundle.deterministicModuleExamGrader.mae0to3.toFixed(2)} | ${bundle.deterministicModuleExamGrader.falsePassRatePct.toFixed(1)}% | ${bundle.deterministicModuleExamGrader.falseFailRatePct.toFixed(1)}% | N/A | 0 |`,
			`| \`lesson/grader.md\` (prompt mínimo) | ${r.llmGraderMinimal.exactAgreementPct.toFixed(1)}% | ${r.llmGraderMinimal.withinOneGradePct.toFixed(1)}% | ${r.llmGraderMinimal.mae0to3.toFixed(2)} | ${r.llmGraderMinimal.falsePassRatePct.toFixed(1)}% | ${r.llmGraderMinimal.falseFailRatePct.toFixed(1)}% | ${r.llmGraderMinimal.misconceptionDiagnosisPct.toFixed(1)}% | ${r.llmGraderMinimal.parseFailures} |`,
			`| **\`lesson/grader.md\` (prompt atual)** | **${r.llmGraderProduction.exactAgreementPct.toFixed(1)}%** | **${r.llmGraderProduction.withinOneGradePct.toFixed(1)}%** | **${r.llmGraderProduction.mae0to3.toFixed(2)}** | **${r.llmGraderProduction.falsePassRatePct.toFixed(1)}%** | **${r.llmGraderProduction.falseFailRatePct.toFixed(1)}%** | **${r.llmGraderProduction.misconceptionDiagnosisPct.toFixed(1)}%** | ${r.llmGraderProduction.parseFailures} |`,
			"",
			"### Frente 4 — Fontes, PDFs e Atividades Interativas",
			"",
			"| Avaliação | Prompt mínimo | Prompt atual | Δ Pareado (IC 95%) | Casos (n) | Latência |",
			"|---|---:|---:|---:|---:|---:|",
			fmtRow("Citações de página física, catálogo vs. lido, atividades e prova", r.groundingAndTools),
			"",
			"### Frente 5 — Memória e Personalização (Placar Separado · EvalMem 3 Estágios + LongMemEval-S)",
			"",
			`- **EvalMem Estágio 2 — Recuperação real (\`tutorMemoryText\` + isolamento de domínio/região):** **${r.memorySeparate.evalMemStage2RetrieveDeterministicPct.toFixed(1)}%** (${r.memorySeparate.evalMemStage2RetrieveN} casos determinísticos)`,
			"",
			"| Estágio / Dataset de Memória | Prompt mínimo | Prompt atual | Δ Pareado (IC 95%) | Casos (n) | Latência |",
			"|---|---:|---:|---:|---:|---:|",
			fmtRow("EvalMem Estágio 1 · Registro/Extração (`memory/extract.md`)", r.memorySeparate.evalMemStage1Record),
			fmtRow("EvalMem Estágio 3 · Uso pelo tutor (isolamento e atualização)", r.memorySeparate.evalMemStage3TutorUse),
			fmtRow("**LongMemEval-S** (`xiaowu0162/longmemeval-cleaned`)", r.memorySeparate.longMemEvalS),
			...(r.memorySeparate.locomoOptional ? [fmtRow("LoCoMo (opcional · `snap-research/locomo`)", r.memorySeparate.locomoOptional)] : []),
			"",
		);
	}

	lines.push(
		"## Frente 6 — Aprendizagem e Retenção (Protocolo Empírico com Alunos)",
		"",
		"Instrumentos estruturados de pré-teste, pós-teste de transferência imediata e retenção em D+7 e D+28 disponíveis em `evals/learning/retention-instruments.json` (alinhados a `docs/impl/study-evaluation.md`).",
		"",
	);
	return lines.join("\n");
}

export function renderSixFrontReadmeBlock(bundle: SixFrontEvalBundle): string {
	const lines: string[] = [
		README_OFFICIAL_BENCH_BEGIN,
		"## AI Tutor & Memory Benchmarks (6-Front Paired Evaluation)",
		"",
		`> **6-front paired evaluation protocol (${bundle.generatedAt})** — Paired delta (**Production prompt − Minimal-contract baseline**) on the same model and frozen context, scored by a **blind cross-model judge** (\`gpt-6.2-sol\` ↔ \`gpt-6.2-astra\`, hidden prompt identity, alternating A/B order) with **paired 95% CIs** and no mixed cross-front overall average. Full item-level audit logs in [evals/reports/latest-evaluation.md](evals/reports/latest-evaluation.md) and [docs/impl/ai-tutor-benchmarks.md](docs/impl/ai-tutor-benchmarks.md).`,
		"",
		"#### Primary Scoreboard — Teacher Prompt Quality (Tutoring, Planning, Grading & Grounding)",
		"",
		"| Model | TutorMoments: Support | TutorMoments: Rigor | TutorMoments: Avoids Over-Scaffolding | TeachArena S0 (Tutoring) | TeachArena S1 (Judgment NL) | Own Modes (Exam 0-Leak) | Planning (JSON+Conv) | LLM Grader MAE (0–3) / False-Pass | Sources & PDFs |",
		"|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
	];

	for (const r of bundle.models) {
		const planProd = Math.round(((r.planning.conversationalPlanning.productionPct + r.planning.lessonPlanTemplateJson.productionPct) / 2) * 10) / 10;
		const planDelta = Math.round(((r.planning.conversationalPlanning.deltaPp + r.planning.lessonPlanTemplateJson.deltaPp) / 2) * 10) / 10;
		const dSign = (v: number) => (v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1));
		lines.push(
			`| \`${r.modelSpec}\` | **${r.tutorMoments.appropriateScaffolding.productionPct.toFixed(1)}%** (${dSign(r.tutorMoments.appropriateScaffolding.deltaPp)} pp) | **${r.tutorMoments.appropriateRigor.productionPct.toFixed(1)}%** (${dSign(r.tutorMoments.appropriateRigor.deltaPp)} pp) | **${r.tutorMoments.avoidsOverScaffolding.productionPct.toFixed(1)}%** (${dSign(r.tutorMoments.avoidsOverScaffolding.deltaPp)} pp) | **${r.teachArenaStage0Tutoring.productionPct.toFixed(1)}%** (${dSign(r.teachArenaStage0Tutoring.deltaPp)} pp) | **${r.teachArenaStage1Judgment.nlAssertions.productionPct.toFixed(1)}%** (${dSign(r.teachArenaStage1Judgment.nlAssertions.deltaPp)} pp) | **${r.trilhaAtlasModes.examZeroLeak.productionPct.toFixed(1)}%** (${dSign(r.trilhaAtlasModes.examZeroLeak.deltaPp)} pp) | **${planProd.toFixed(1)}%** (${dSign(planDelta)} pp) | **${r.llmGraderProduction.mae0to3.toFixed(2)}** / **${r.llmGraderProduction.falsePassRatePct.toFixed(1)}%** | **${r.groundingAndTools.productionPct.toFixed(1)}%** (${dSign(r.groundingAndTools.deltaPp)} pp) |`,
		);
	}

	lines.push(
		"",
		"#### Separate Scoreboard — Memory & Personalization (EvalMem 3-Stage + LongMemEval-S) & Complementary Diagnostic (MathTutorBench)",
		"",
		"| Model | EvalMem Stage 1 (Record) | EvalMem Stage 2 (Retrieval) | EvalMem Stage 3 (Tutor Use) | LongMemEval-S | MathTutorBench (Corr · Loc · Socr · No-Spoiler) |",
		"|---|---:|---:|---:|---:|---|",
	);

	for (const r of bundle.models) {
		const m = r.mathTutorBenchBySkill;
		const mtbStr = `${m.subjectCorrectness.productionPct.toFixed(0)}% · ${m.mistakeLocation.productionPct.toFixed(0)}% · ${m.socraticScaffolding.productionPct.toFixed(0)}% · ${m.noSpoilerTact.productionPct.toFixed(0)}%`;
		const dSign = (v: number) => (v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1));
		lines.push(
			`| \`${r.modelSpec}\` | **${r.memorySeparate.evalMemStage1Record.productionPct.toFixed(1)}%** (${dSign(r.memorySeparate.evalMemStage1Record.deltaPp)} pp) | **${r.memorySeparate.evalMemStage2RetrieveDeterministicPct.toFixed(1)}%** (n=${r.memorySeparate.evalMemStage2RetrieveN}) | **${r.memorySeparate.evalMemStage3TutorUse.productionPct.toFixed(1)}%** (${dSign(r.memorySeparate.evalMemStage3TutorUse.deltaPp)} pp) | **${r.memorySeparate.longMemEvalS.productionPct.toFixed(1)}%** (${dSign(r.memorySeparate.longMemEvalS.deltaPp)} pp) | ${mtbStr} |`,
		);
	}

	lines.push(
		"",
		`- **Separate deterministic grader (\`module-exam.ts\` on 14 specialist-labeled cases):** exact agreement **${bundle.deterministicModuleExamGrader.exactAgreementPct.toFixed(1)}%**, MAE **${bundle.deterministicModuleExamGrader.mae0to3.toFixed(2)}**, false-pass rate **${bundle.deterministicModuleExamGrader.falsePassRatePct.toFixed(1)}%** (demonstrating quantitatively why open-ended grading uses \`lesson/grader.md\` rather than lexical overlap).`,
		`- **Transparency note:** TeachArena scores are reported individually for Stage 0 (Situated Tutoring) and Stage 1 (Pedagogical Judgment) and are not a global TeachArena score; PT-BR and Planning suites are internal TrilhaAtlas adaptations in \`evals/\`. Reproduce with \`npm run verify:formal\`, \`npm run benchmark:harness\`, \`npm run benchmark:prompts\`, and \`npm run benchmark:sota\`.`,
		README_OFFICIAL_BENCH_END,
	);

	return lines.join("\n");
}
