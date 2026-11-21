/**
 * Interleaved integrative module/chapter exams (P1/P2) — pure & browser-safe.
 *
 * Selects 3–5 distinct skills from a module or chapter deterministically by seed,
 * shuffles them for genuine interleaving, and hides node ids and topic titles
 * from the visible prompts so the learner must identify the governing concept
 * independently. Grading produces deterministic 0–3 rubric verdicts and summative
 * Evidence events (level 4, delayed retrieval credit) ready for `ingestEvent`.
 */

import type { CurriculumItem, CurriculumSnapshot } from "../curriculum/types.ts";
import type { LearnerGraphView } from "../learner/graph-view.ts";
import { fnv1a32, Rng } from "../learner/math.ts";
import type { Evidence, Grade, LearnerEvent } from "../learner/types.ts";
import { isLessonExamAnswer } from "./lesson-conclusion.ts";

export interface ModuleExamQuestion {
	id: string;
	/** Internal skill identifier kept on the server key — never shown in `prompt`. */
	nodeId: string;
	prompt: string;
	rubricCriteria: string[];
	expectedTerms: string[];
	minWords: number;
	misconceptionTrap?: string;
}

export interface ModuleExam {
	id: string;
	domainId: string;
	scope: "module" | "chapter";
	targetId: string;
	targetTitle: string;
	seed: string;
	passingScore10: number;
	questions: ModuleExamQuestion[];
}

export interface ModuleExamSubmission {
	examId: string;
	answers: Record<string, string>;
	submittedAt?: string;
}

export interface ModuleExamQuestionResult {
	questionId: string;
	nodeId: string;
	grade: Grade;
	wordCount: number;
	matchedTerms: string[];
	matchedCriteria: number;
	totalCriteria: number;
	passed: boolean;
	feedback: string;
}

export interface ModuleExamResult {
	examId: string;
	scope: "module" | "chapter";
	targetId: string;
	targetTitle: string;
	score10: number;
	passed: boolean;
	hasZeroQuestion: boolean;
	questionResults: ModuleExamQuestionResult[];
	weakNodeIds: string[];
	summary: string;
}

const PASSING_SCORE_10 = 7.5;
const DEFAULT_MIN_WORDS = 12;

const STOPWORDS = new Set([
	"de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas", "um", "uma", "uns", "umas",
	"para", "por", "com", "sem", "sob", "sobre", "entre", "ate", "apos", "ante", "contra", "desde",
	"como", "que", "qual", "quais", "quando", "onde", "porque", "pois", "mas", "mais", "menos",
	"muito", "muita", "muitos", "muitas", "pouco", "pouca", "ser", "estar", "ter", "fazer", "usar",
	"pode", "podem", "deve", "devem", "seja", "sao", "foi", "sera", "isso", "isto", "este", "esta",
	"esse", "essa", "aquele", "aquela", "seu", "sua", "seus", "suas", "pelo", "pela", "pelos", "pelas",
	"cada", "todo", "toda", "todos", "todas", "outro", "outra", "outros", "outras", "mesmo", "mesma",
	"tambem", "apenas", "ainda", "aqui", "ali", "entao", "assim", "logo", "caso", "modo", "forma",
	"tipo", "parte", "passo", "etapa", "item", "tema", "valor", "nivel", "exemplo", "exemplos",
	"dentro", "fora", "atraves", "partir", "partindo", "usando", "dado", "dada", "dados", "dadas",
	"the", "and", "for", "with", "from", "that", "this", "into", "onto", "what", "when", "where",
	"which", "using", "within", "without", "about", "after", "before", "under", "over", "each",
	"some", "such", "than", "then", "them", "they", "their", "have", "been", "being", "will",
]);

const EVASIVE_RE = /^(?:n[aã]o\s+sei(?:\s+responder|\s+fazer|\s+dizer)?|sei\s+l[aá]|chutei|chute|pulei|pular|nada|em\s+branco|desisto|tanto\s+faz|qualquer\s+coisa|nenhuma|n\/a|idk|i\s+don'?t\s+know|pass|skip|none)$/iu;

const REASONING_RE = /\b(porque|pois|portanto|logo|ent[aã]o|quando|enquanto|embora|caso|limite|condi[cç][aã]o|premissa|hip[oó]tese|aumenta|diminui|proporcional|inversamente|depende|resulta|implica|contraste|diferen[cç]a|because|therefore|since|however|depends|increases|decreases)\b|[=/*±<>]|(?:\d+(?:[.,]\d+)?\s*(?:v|mv|kv|a|ma|ua|ohm|kohm|hz|khz|mhz|w|mw|db|%|s|ms|us|f|uf|nf|pf|h|mh|uh)\b)/iu;

function stripAccents(text: string): string {
	return text.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function normalizeTokens(text: string): string[] {
	return stripAccents(text.normalize("NFKC").toLowerCase())
		.split(/[^a-z0-9]+/u)
		.filter((token) => token.length > 0);
}

function contentTokens(text: string): string[] {
	return normalizeTokens(text).filter((token) => token.length >= 3 && !STOPWORDS.has(token) && !/^\d+$/.test(token));
}

function tokenMatches(answerTokens: readonly string[], target: string): boolean {
	if (answerTokens.includes(target)) return true;
	if (target.length < 5) return false;
	const stem = target.slice(0, 5);
	return answerTokens.some((tok) => tok.length >= 5 && tok.startsWith(stem));
}

function escapeRegExp(literal: string): string {
	return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function accentInsensitivePattern(literal: string): RegExp {
	const map: Record<string, string> = {
		a: "[aáàâãä]",
		e: "[eéèêë]",
		i: "[iíìîï]",
		o: "[oóòôõö]",
		u: "[uúùûü]",
		c: "[cç]",
		n: "[nñ]",
	};
	const chars = [...stripAccents(literal.toLowerCase())].map((ch) => map[ch] ?? escapeRegExp(ch));
	return new RegExp(chars.join(""), "giu");
}

function maskForbiddenLabels(text: string, forbidden: readonly string[]): string {
	let cleaned = text.trim();
	const sorted = [...new Set(forbidden.map((s) => s.trim()).filter((s) => s.length >= 3))]
		.sort((a, b) => b.length - a.length);
	for (const label of sorted) {
		cleaned = cleaned.replace(accentInsensitivePattern(label), "o princípio em questão");
	}
	return cleaned.replace(/\s+/gu, " ").trim();
}

function containsLabel(text: string, label: string): boolean {
	const needle = stripAccents(label.trim().toLowerCase());
	if (needle.length < 3) return false;
	return stripAccents(text.toLowerCase()).includes(needle);
}

function extractScopeInside(scope: string): string {
	const match = scope.match(/dentro\s*:\s*([^.;]+(?:[;,][^.;]+)?)/iu);
	return match?.[1]?.trim() ?? scope.trim();
}

function extractExpectedTerms(item: CurriculumItem): string[] {
	const sources = [
		item.title.pt,
		item.title.en ?? "",
		...item.objectives,
		item.practice?.exitCriterion ?? "",
		item.summary,
		extractScopeInside(item.scope),
		...item.aliases,
		...(item.lexicalItems?.map((lex) => lex.lemma) ?? []),
	];
	const terms: string[] = [];
	const seen = new Set<string>();
	for (const source of sources) {
		for (const token of contentTokens(source)) {
			if (seen.has(token)) continue;
			seen.add(token);
			terms.push(token);
			if (terms.length >= 14) return terms;
		}
	}
	return terms;
}

function buildRubricCriteria(item: CurriculumItem): string[] {
	const criteria: string[] = [];
	for (const obj of item.objectives) {
		const trimmed = obj.trim();
		if (trimmed && !criteria.includes(trimmed)) criteria.push(trimmed);
		if (criteria.length >= 3) break;
	}
	const exitCriterion = item.practice?.exitCriterion?.trim();
	if (exitCriterion && !criteria.includes(exitCriterion) && criteria.length < 4) {
		criteria.push(exitCriterion);
	}
	if (criteria.length === 0 && item.summary.trim()) {
		criteria.push(item.summary.trim());
	}
	const assessModes = item.assess.map((mode) => mode.toLowerCase());
	if (assessModes.includes("numeric") || assessModes.includes("derivation")) {
		criteria.push("Apresentar relações quantitativas, unidades corretas e hipóteses de validade.");
	} else if (assessModes.includes("dialogue") || assessModes.includes("speak")) {
		criteria.push("Produzir formulação adequada ao contexto e justificar a escolha linguística.");
	} else if (criteria.length < 2) {
		criteria.push("Explicar causa, efeito observável e condição-limite sem ambiguidade.");
	}
	return criteria;
}

function buildBlindPrompt(item: CurriculumItem, index: number): string {
	const forbidden = [item.id, item.title.pt, item.title.en ?? "", ...item.aliases];
	const rawTask = item.practice?.exitCriterion?.trim()
		|| item.objectives[0]?.trim()
		|| extractScopeInside(item.scope)
		|| item.summary.trim();
	let maskedTask = maskForbiddenLabels(rawTask, forbidden);
	if (maskedTask.length < 18) {
		const fallback = maskForbiddenLabels(item.objectives.join("; ") || item.summary, forbidden);
		maskedTask = fallback.length >= 18
			? fallback
			: "analise a situação proposta, identifique o modelo adequado e demonstre o resultado passo a passo";
	}
	const normalizedTask = maskedTask.replace(/^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]/u, (ch) => ch.toLowerCase()).replace(/[.!?]+$/u, "");
	const assessModes = new Set(item.assess.map((a) => a.toLowerCase()));
	let deliverable: string;
	if (assessModes.has("numeric") || assessModes.has("derivation")) {
		deliverable = "Identifique qual relação governa o problema, desenvolva o raciocínio passo a passo com unidades e indique o que ocorre em um caso-limite.";
	} else if (
		assessModes.has("dialogue") ||
		assessModes.has("speak") ||
		assessModes.has("dictation") ||
		item.atomType === "can_do" ||
		item.atomType === "lexical_set"
	) {
		deliverable = "Produza uma resposta autônoma completa em contexto, justifique a escolha estrutural e contraste com um desvio comum.";
	} else {
		deliverable = "Explique o mecanismo em jogo, explicite as premissas usadas e aponte o que mudaria na conclusão se um parâmetro crítico fosse alterado.";
	}

	let prompt = `Questão ${index + 1}: Sem consultar anotações, resolva e justifique como ${normalizedTask}. ${deliverable}`;
	if (
		containsLabel(prompt, item.id) ||
		containsLabel(prompt, item.title.pt) ||
		(item.title.en ? containsLabel(prompt, item.title.en) : false)
	) {
		prompt = maskForbiddenLabels(prompt, [item.id, item.title.pt, item.title.en ?? ""]);
	}
	return prompt;
}

function countWords(text: string): number {
	return normalizeTokens(text).length;
}

function isLowSignalAnswer(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed) return true;
	if (!isLessonExamAnswer(trimmed)) return true;
	if (EVASIVE_RE.test(trimmed.replace(/[.!?,\s]+$/gu, ""))) return true;
	const tokens = normalizeTokens(trimmed);
	if (tokens.length === 0) return true;
	const unique = new Set(tokens);
	if (tokens.length >= 6 && unique.size < Math.min(4, Math.ceil(tokens.length * 0.35))) return true;
	return false;
}

export function buildModuleExam(input: {
	domainId: string;
	snapshot: CurriculumSnapshot;
	graph: LearnerGraphView;
	scope: "module" | "chapter";
	targetId: string;
	targetTitle: string;
	leafIds: readonly string[];
	seed: string;
}): ModuleExam {
	const seen = new Set<string>();
	const candidates: CurriculumItem[] = [];
	for (const id of input.leafIds) {
		if (seen.has(id)) continue;
		const item = input.snapshot.items[id];
		if (!item || item.status === "deprecated" || item.reinforcementFor) continue;
		const graphNode = input.graph.nodes.get(id);
		if (graphNode && !graphNode.isLeaf) continue;
		seen.add(id);
		candidates.push(item);
	}

	const rng = new Rng(`${input.seed}:${input.domainId}:${input.scope}:${input.targetId}`);
	const shuffled = [...candidates];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = rng.int(i + 1);
		const tmp = shuffled[i]!;
		shuffled[i] = shuffled[j]!;
		shuffled[j] = tmp;
	}

	const desiredCount = input.scope === "chapter" ? 5 : 4;
	const targetCount = shuffled.length <= 3
		? shuffled.length
		: Math.min(5, Math.max(3, Math.min(desiredCount, shuffled.length)));
	const picked = shuffled.slice(0, targetCount);

	const examHash = fnv1a32(`${input.domainId}:${input.scope}:${input.targetId}:${input.seed}`).toString(36);
	const examId = `mexam:${input.scope}:${input.targetId}:${examHash}`;

	const questions: ModuleExamQuestion[] = picked.map((item, idx) => ({
		id: `${examId}:q${idx + 1}`,
		nodeId: item.id,
		prompt: buildBlindPrompt(item, idx),
		rubricCriteria: buildRubricCriteria(item),
		expectedTerms: extractExpectedTerms(item),
		minWords: DEFAULT_MIN_WORDS,
		...(item.misconceptions?.[0] ? { misconceptionTrap: item.misconceptions[0] } : {}),
	}));

	return {
		id: examId,
		domainId: input.domainId,
		scope: input.scope,
		targetId: input.targetId,
		targetTitle: input.targetTitle,
		seed: input.seed,
		passingScore10: PASSING_SCORE_10,
		questions,
	};
}

export function gradeModuleExam(
	exam: ModuleExam,
	answers: Readonly<Record<string, string>>,
	meta: { domainId: string; at: string; startSeq: number; sessionId: string },
): { result: ModuleExamResult; events: LearnerEvent[] } {
	const questionResults: ModuleExamQuestionResult[] = [];
	const events: LearnerEvent[] = [];

	exam.questions.forEach((question, index) => {
		const raw = (answers[question.id] ?? "").trim();
		const wordCount = countWords(raw);
		const answerTokens = normalizeTokens(raw);
		const matchedTerms = question.expectedTerms.filter((term) => tokenMatches(answerTokens, term));

		let matchedCriteria = 0;
		for (const criterion of question.rubricCriteria) {
			const critTokens = contentTokens(criterion);
			if (critTokens.length === 0) continue;
			const hits = critTokens.filter((tok) => tokenMatches(answerTokens, tok)).length;
			const needed = Math.max(1, Math.min(2, Math.ceil(critTokens.length * 0.3)));
			if (hits >= needed) matchedCriteria++;
		}

		const totalCriteria = question.rubricCriteria.length;
		const hasReasoning = REASONING_RE.test(raw);

		let grade: Grade = 0;
		let feedback: string;

		if (isLowSignalAnswer(raw)) {
			grade = 0;
			feedback = "Resposta ausente ou evasiva. Desenvolva o raciocínio completo com termos e justificativa próprios.";
		} else if (matchedTerms.length === 0 && matchedCriteria === 0) {
			grade = 0;
			feedback = "A resposta não mobilizou os conceitos exigidos pela rubrica desta questão.";
		} else if (wordCount < Math.ceil(question.minWords * 0.5)) {
			grade = 0;
			feedback = `Resposta muito curta (${wordCount} palavras; mínimo ${question.minWords}). Explicite premissas e passos.`;
		} else if (wordCount < question.minWords) {
			if (matchedTerms.length >= 2 || matchedCriteria >= 1) {
				grade = 1;
				feedback = `Há indícios conceituais, mas faltou desenvolvimento (${wordCount}/${question.minWords} palavras). Justifique passo a passo.`;
			} else {
				grade = 0;
				feedback = `Desenvolvimento insuficiente (${wordCount}/${question.minWords} palavras) e baixa aderência conceitual.`;
			}
		} else {
			const termDenom = Math.min(question.expectedTerms.length, 5);
			const termRatio = termDenom > 0 ? Math.min(1, matchedTerms.length / termDenom) : 0;
			const criteriaRatio = totalCriteria > 0 ? matchedCriteria / totalCriteria : termRatio;
			const conceptScore = termDenom > 0 ? 0.55 * termRatio + 0.45 * criteriaRatio : criteriaRatio;

			if (conceptScore >= 0.65 && (matchedTerms.length >= 2 || matchedCriteria >= 2) && (hasReasoning || wordCount >= question.minWords + 6)) {
				grade = 3;
				feedback = "Domínio consistente: conceitos centrais mobilizados com justificativa clara.";
			} else if (conceptScore >= 0.38 && (matchedTerms.length >= 1 || matchedCriteria >= 1)) {
				grade = 2;
				feedback = "Resposta parcialmente sólida; aprofunde as condições-limite e cubra todos os critérios da rubrica.";
			} else {
				grade = 1;
				feedback = "Cobertura conceitual incompleta. Revise os fundamentos do bloco e conecte causa e efeito na justificativa.";
			}
		}

		questionResults.push({
			questionId: question.id,
			nodeId: question.nodeId,
			grade,
			wordCount,
			matchedTerms,
			matchedCriteria,
			totalCriteria,
			passed: grade >= 2,
			feedback,
		});

		const seq = meta.startSeq + index;
		const evidence: Evidence = {
			id: `${exam.id}:${question.id}:${seq}`,
			seq,
			at: meta.at,
			domainId: meta.domainId,
			sessionId: meta.sessionId,
			itemId: `${exam.id}:${question.id}`,
			itemFamily: `${question.nodeId}#module-exam`,
			nodes: [{ nodeId: question.nodeId, q: 1, primary: true }],
			format: "explain",
			level: 4,
			grade,
			graderConfidence: 0.85,
			hints: 0,
			minutesSinceExposure: 1500,
			summative: true,
			quizContext: {
				question: question.prompt.slice(0, 400),
				answer: raw.slice(0, 400),
				...(question.rubricCriteria.length > 0 ? { expected: question.rubricCriteria.join(" | ").slice(0, 400) } : {}),
			},
		};
		events.push({ kind: "evidence", evidence });
	});

	const maxPoints = exam.questions.length * 3;
	const earnedPoints = questionResults.reduce((sum, r) => sum + r.grade, 0);
	const score10 = maxPoints > 0 ? Math.round((earnedPoints / maxPoints) * 100) / 10 : 0;
	const hasZeroQuestion = questionResults.some((r) => r.grade === 0);
	const passed = exam.questions.length > 0 && score10 >= exam.passingScore10 && !hasZeroQuestion;
	const weakNodeIds = questionResults.filter((r) => r.grade <= 1).map((r) => r.nodeId);

	let summary: string;
	if (exam.questions.length === 0) {
		summary = "Nenhuma questão elegível encontrada para esta prova.";
	} else if (passed) {
		summary = `Aprovado com nota ${score10.toFixed(1)}/10 sem questões zeradas.`;
	} else if (hasZeroQuestion) {
		summary = `Reprovado (${score10.toFixed(1)}/10): houve questão zerada. Reforce os tópicos pendentes antes de refazer.`;
	} else {
		summary = `Nota ${score10.toFixed(1)}/10 abaixo do mínimo exigido (${exam.passingScore10.toFixed(1)}). Revise as lacunas apontadas.`;
	}

	return {
		result: {
			examId: exam.id,
			scope: exam.scope,
			targetId: exam.targetId,
			targetTitle: exam.targetTitle,
			score10,
			passed,
			hasZeroQuestion,
			questionResults,
			weakNodeIds,
			summary,
		},
		events,
	};
}
