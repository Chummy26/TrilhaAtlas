/**
 * Gradual batch problem sets + scientific-method lab scripts — pure & browser-safe.
 *
 * Delivers 4–6 exercises across three cognitive tiers (direct application,
 * diagnosis/contrast, synthesis) in one uninterrupted batch, plus an optional
 * 4-step lab script whenever the domain is electronics or a module contains
 * lab/design_project atoms. Grading evaluates the whole submission at once and
 * emits level-3 Evidence events ready for the learner fold.
 */

import type { CurriculumItem, CurriculumSnapshot } from "../curriculum/types.ts";
import { graphIndex, type LearnerGraphView } from "../learner/graph-view.ts";
import { fnv1a32 } from "../learner/math.ts";
import type { Evidence, Grade, LearnerEvent } from "../learner/types.ts";
import { isLessonExamAnswer } from "./lesson-conclusion.ts";

export type ProblemSetTier = 1 | 2 | 3;

export type ProblemSetTierLabel = "Aplicação direta" | "Diagnóstico e contraste" | "Síntese";

export interface ProblemSetItem {
	id: string;
	nodeId: string;
	nodeTitle: string;
	tier: ProblemSetTier;
	tierLabel: ProblemSetTierLabel;
	prompt: string;
	rubricCriteria: string[];
	expectedTerms: string[];
	minWords: number;
	hint?: string;
}

export type LabStepPhase =
	| "Hipótese"
	| "Montagem e Medição"
	| "Teórico vs. Simulado"
	| "Análise de Discrepância";

export type LabPreset = "divider" | "rc-filter" | "rlc" | "rectifier" | "circuit";

export interface LabStep {
	id: string;
	phase: LabStepPhase;
	prompt: string;
	required: boolean;
	minWords: number;
}

export interface LabScript {
	id: string;
	title: string;
	preset: LabPreset;
	objective: string;
	steps: LabStep[];
}

export interface ModuleProblemSet {
	id: string;
	domainId: string;
	moduleId: string;
	moduleTitle: string;
	seed: string;
	items: ProblemSetItem[];
	lab?: LabScript;
}

export interface ProblemSetItemResult {
	itemId: string;
	nodeId: string;
	tier: ProblemSetTier;
	grade: Grade;
	wordCount: number;
	matchedTerms: string[];
	passed: boolean;
	feedback: string;
}

export interface LabStepResult {
	stepId: string;
	phase: LabStepPhase;
	wordCount: number;
	passed: boolean;
	feedback: string;
}

export interface LabScriptResult {
	completedSteps: number;
	totalSteps: number;
	passed: boolean;
	stepResults: LabStepResult[];
	feedback: string;
}

export interface ProblemSetResult {
	problemSetId: string;
	moduleId: string;
	moduleTitle: string;
	score10: number;
	correctCount: number;
	totalCount: number;
	passed: boolean;
	byTier: Record<ProblemSetTier, { correct: number; total: number }>;
	itemResults: ProblemSetItemResult[];
	labResult?: LabScriptResult;
	summary: string;
}

const TIER_LABELS: Record<ProblemSetTier, ProblemSetTierLabel> = {
	1: "Aplicação direta",
	2: "Diagnóstico e contraste",
	3: "Síntese",
};

const TIER_MIN_WORDS: Record<ProblemSetTier, number> = {
	1: 8,
	2: 12,
	3: 15,
};

const STOPWORDS = new Set([
	"de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas", "um", "uma", "uns", "umas",
	"para", "por", "com", "sem", "sob", "sobre", "entre", "ate", "apos", "ante", "contra", "desde",
	"como", "que", "qual", "quais", "quando", "onde", "porque", "pois", "mas", "mais", "menos",
	"muito", "muita", "muitos", "muitas", "pouco", "pouca", "ser", "estar", "ter", "fazer", "usar",
	"pode", "podem", "deve", "devem", "seja", "sao", "foi", "sera", "isso", "isto", "este", "esta",
	"esse", "essa", "aquele", "aquela", "seu", "sua", "seus", "suas", "pelo", "pela", "pelos", "pelas",
	"cada", "todo", "toda", "todos", "todas", "outro", "outra", "outros", "outras", "mesmo", "mesma",
	"tambem", "apenas", "ainda", "entao", "assim", "logo", "caso", "modo", "forma", "tipo", "parte",
	"passo", "etapa", "item", "tema", "valor", "nivel", "exemplo", "exemplos", "dentro", "fora",
	"the", "and", "for", "with", "from", "that", "this", "into", "what", "when", "where", "which",
	"using", "within", "without", "about", "after", "before", "under", "over", "each", "some",
]);

const EVASIVE_RE = /^(?:n[aã]o\s+sei(?:\s+responder|\s+fazer|\s+dizer)?|sei\s+l[aá]|chutei|chute|pulei|pular|nada|em\s+branco|desisto|tanto\s+faz|qualquer\s+coisa|nenhuma|n\/a|idk|i\s+don'?t\s+know|pass|skip|none)$/iu;

const REASONING_RE = /\b(porque|pois|portanto|logo|ent[aã]o|quando|enquanto|embora|caso|limite|condi[cç][aã]o|premissa|hip[oó]tese|aumenta|diminui|proporcional|inversamente|depende|resulta|implica|contraste|diferen[cç]a|erro|corrige|because|therefore|since|however)\b|[=/*±<>]|(?:\d+(?:[.,]\d+)?\s*(?:v|mv|kv|a|ma|ua|ohm|kohm|hz|khz|mhz|w|mw|db|%|s|ms|us|f|uf|nf|pf|h|mh|uh)\b)/iu;

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

function extractExpectedTerms(item: CurriculumItem): string[] {
	const sources = [
		item.title.pt,
		item.title.en ?? "",
		...item.objectives,
		item.practice?.exitCriterion ?? "",
		item.summary,
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
			if (terms.length >= 12) return terms;
		}
	}
	return terms;
}

function buildRubricCriteria(item: CurriculumItem, tier: ProblemSetTier): string[] {
	const base = item.objectives.map((o) => o.trim()).filter(Boolean).slice(0, 2);
	if (base.length === 0 && item.summary.trim()) base.push(item.summary.trim());
	if (tier === 1) {
		base.push("Aplicar diretamente o procedimento ou conceito com passos verificáveis.");
	} else if (tier === 2) {
		base.push("Identificar o ponto de erro ou contraste e justificar a correção.");
	} else {
		base.push("Integrar os requisitos do módulo, explicitar hipóteses e justificar compromissos.");
	}
	return base;
}

function tierSequence(count: number): ProblemSetTier[] {
	if (count <= 4) return [1, 1, 2, 3].slice(0, count) as ProblemSetTier[];
	if (count === 5) return [1, 1, 2, 2, 3];
	return [1, 1, 2, 2, 3, 3];
}

function buildTierPrompt(
	item: CurriculumItem,
	tier: ProblemSetTier,
	moduleTitle: string,
	companion?: CurriculumItem,
): string {
	const core = (item.objectives[0] || item.practice?.exitCriterion || item.summary || item.title.pt)
		.trim()
		.replace(/[.!?]+$/u, "");
	const lowerCore = core.replace(/^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]/u, (ch) => ch.toLowerCase());
	if (tier === 1) {
		return `[Aplicação direta · ${item.title.pt}] Resolva um exemplo concreto para ${lowerCore}. Mostre cada etapa, os valores ou escolhas finais e as unidades ou justificativas essenciais.`;
	}
	if (tier === 2) {
		const trap = item.misconceptions?.[0]?.trim().replace(/[.!?]+$/u, "");
		if (trap) {
			return `[Diagnóstico e contraste · ${item.title.pt}] Um colega cometeu o seguinte deslize: "${trap}". Explique exatamente por que essa premissa falha, corrija o raciocínio e contraste o resultado correto com o incorreto.`;
		}
		return `[Diagnóstico e contraste · ${item.title.pt}] Compare dois cenários opostos ao ${lowerCore}. Aponte qual erro de interpretação costuma ocorrer na transição entre eles e como evitá-lo.`;
	}
	const link = companion && companion.id !== item.id
		? ` conectando "${item.title.pt}" com "${companion.title.pt}"`
		: ` integrando "${item.title.pt}" ao objetivo de "${moduleTitle}"`;
	return `[Síntese · ${item.title.pt}] Elabore uma solução completa${link} para ${lowerCore}. Explicite suas hipóteses, justifique os compromissos de decisão (trade-offs) e indique em que condição-limite a solução deixa de valer.`;
}

function detectLabPreset(moduleTitle: string, items: readonly CurriculumItem[]): LabPreset {
	const corpus = stripAccents(
		[moduleTitle, ...items.flatMap((it) => [it.title.pt, it.title.en ?? "", it.summary, it.scope, ...(it.tags ?? [])])]
			.join(" ")
			.toLowerCase(),
	);
	if (/\b(retificador|rectifier|diodo|diode|ponte\s+retificadora|zener|ceifador|grampeador)\b/u.test(corpus)) {
		return "rectifier";
	}
	if (/\b(rlc|ressonancia|resonance|indutor|inductor|fator\s*q|oscilador|segunda\s+ordem)\b/u.test(corpus)) {
		return "rlc";
	}
	if (/\b(filtro|filter|rc|passa-baixas|passa-altas|frequencia\s+de\s+corte|bode|capacitor|constante\s+de\s+tempo)\b/u.test(corpus)) {
		return "rc-filter";
	}
	if (/\b(divisor|divider|ohm|kirchhoff|resistor|tensao|serie|paralelo|thevenin|norton)\b/u.test(corpus)) {
		return "divider";
	}
	return "circuit";
}

function presetDescription(preset: LabPreset): string {
	switch (preset) {
		case "divider":
			return "divisor resistivo com e sem carga";
		case "rc-filter":
			return "filtro RC (resposta temporal e frequência de corte)";
		case "rlc":
			return "circuito RLC (ressonância e amortecimento)";
		case "rectifier":
			return "retificador com diodos e filtragem";
		case "circuit":
		default:
			return "circuito representativo do módulo";
	}
}

function buildLabScript(moduleId: string, moduleTitle: string, items: readonly CurriculumItem[]): LabScript {
	const preset = detectLabPreset(moduleTitle, items);
	const setupName = presetDescription(preset);
	const focusTitle = items.at(-1)?.title.pt ?? moduleTitle;
	return {
		id: `${moduleId}:lab`,
		title: `Laboratório · ${moduleTitle}`,
		preset,
		objective: `Validar experimentalmente (em simulação ou bancada) os princípios de "${moduleTitle}" usando o arranjo de ${setupName}, com foco em "${focusTitle}".`,
		steps: [
			{
				id: "hypothesis",
				phase: "Hipótese",
				prompt: `Antes de simular ou medir no preset "${preset}", formule sua previsão quantitativa e qualitativa (valores esperados, unidades e comportamento ao variar o parâmetro principal).`,
				required: true,
				minWords: 8,
			},
			{
				id: "setup-measure",
				phase: "Montagem e Medição",
				prompt: "Registre os parâmetros configurados (valores de componentes, fonte, frequência ou carga), os pontos de medição escolhidos e as leituras obtidas.",
				required: true,
				minWords: 8,
			},
			{
				id: "theory-vs-sim",
				phase: "Teórico vs. Simulado",
				prompt: "Compare explicitamente o valor teórico calculado com o valor simulado/medido, incluindo unidades e o desvio absoluto ou percentual.",
				required: true,
				minWords: 8,
			},
			{
				id: "discrepancy",
				phase: "Análise de Discrepância",
				prompt: "Explique a origem das diferenças observadas (ou por que coincidem dentro da tolerância), citando hipóteses ideais, efeitos parasitas, carga ou limites do modelo.",
				required: true,
				minWords: 8,
			},
		],
	};
}

function selectModuleItems(candidates: readonly CurriculumItem[], targetCount: number, seed: string): CurriculumItem[] {
	if (candidates.length === 0) return [];
	if (candidates.length < targetCount) {
		const out: CurriculumItem[] = [];
		for (let i = 0; i < targetCount; i++) {
			out.push(candidates[i % candidates.length]!);
		}
		return out;
	}
	if (candidates.length === targetCount) return [...candidates];
	// Stratified selection along topological order with deterministic seed jitter within each bucket.
	const hash = fnv1a32(seed);
	const selected: CurriculumItem[] = [];
	const used = new Set<number>();
	for (let bucket = 0; bucket < targetCount; bucket++) {
		const start = Math.floor((bucket * candidates.length) / targetCount);
		const end = Math.max(start + 1, Math.floor(((bucket + 1) * candidates.length) / targetCount));
		const span = end - start;
		let pick = start + ((hash + bucket * 7) % span);
		while (used.has(pick) && pick < end - 1) pick++;
		used.add(pick);
		selected.push(candidates[pick]!);
	}
	return selected;
}

export function buildProblemSet(input: {
	domainId: string;
	snapshot: CurriculumSnapshot;
	graph: LearnerGraphView;
	moduleId: string;
	moduleTitle: string;
	leafIds: readonly string[];
	seed: string;
}): ModuleProblemSet {
	const pos = graphIndex(input.graph).pos;
	const seen = new Set<string>();
	const candidates: CurriculumItem[] = [];
	for (const id of input.leafIds) {
		if (seen.has(id)) continue;
		const item = input.snapshot.items[id];
		if (!item || item.status === "deprecated" || item.reinforcementFor) continue;
		seen.add(id);
		candidates.push(item);
	}
	candidates.sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));

	const setHash = fnv1a32(`${input.domainId}:${input.moduleId}:${input.seed}`).toString(36);
	const setId = `pset:${input.moduleId}:${setHash}`;

	const targetCount = candidates.length === 0 ? 0 : Math.min(6, Math.max(4, candidates.length));
	const chosen = selectModuleItems(candidates, targetCount, `${input.seed}:${input.moduleId}`);
	const tiers = tierSequence(chosen.length);

	const items: ProblemSetItem[] = chosen.map((item, idx) => {
		const tier = tiers[idx] ?? 1;
		const companion = idx > 0 ? chosen[idx - 1] : chosen[chosen.length - 1];
		const hint = item.misconceptions?.[0]
			? `Cuidado com a armadilha: ${item.misconceptions[0]}`
			: undefined;
		return {
			id: `${setId}:ex${idx + 1}`,
			nodeId: item.id,
			nodeTitle: item.title.pt,
			tier,
			tierLabel: TIER_LABELS[tier],
			prompt: buildTierPrompt(item, tier, input.moduleTitle, companion),
			rubricCriteria: buildRubricCriteria(item, tier),
			expectedTerms: extractExpectedTerms(item),
			minWords: TIER_MIN_WORDS[tier],
			...(hint ? { hint } : {}),
		};
	});

	const needsLab = input.domainId === "electronics"
		|| candidates.some((item) => item.atomType === "lab" || item.atomType === "design_project");
	const lab = needsLab ? buildLabScript(input.moduleId, input.moduleTitle, candidates) : undefined;

	return {
		id: setId,
		domainId: input.domainId,
		moduleId: input.moduleId,
		moduleTitle: input.moduleTitle,
		seed: input.seed,
		items,
		...(lab ? { lab } : {}),
	};
}

export function gradeProblemSet(
	set: ModuleProblemSet,
	answers: Readonly<Record<string, string>>,
	labNotes?: Readonly<Record<string, string>>,
	meta?: { domainId: string; at: string; startSeq: number },
): { result: ProblemSetResult; events: LearnerEvent[] } {
	const byTier: Record<ProblemSetTier, { correct: number; total: number }> = {
		1: { correct: 0, total: 0 },
		2: { correct: 0, total: 0 },
		3: { correct: 0, total: 0 },
	};
	const itemResults: ProblemSetItemResult[] = [];
	const events: LearnerEvent[] = [];

	set.items.forEach((item, index) => {
		byTier[item.tier].total++;
		const raw = (answers[item.id] ?? "").trim();
		const answerTokens = normalizeTokens(raw);
		const wordCount = answerTokens.length;
		const matchedTerms = item.expectedTerms.filter((term) => tokenMatches(answerTokens, term));
		const missingTerms = item.expectedTerms.filter((term) => !matchedTerms.includes(term)).slice(0, 3);

		let matchedCriteria = 0;
		for (const criterion of item.rubricCriteria) {
			const critTokens = contentTokens(criterion);
			if (critTokens.length === 0) continue;
			const hits = critTokens.filter((tok) => tokenMatches(answerTokens, tok)).length;
			const needed = Math.max(1, Math.min(2, Math.ceil(critTokens.length * 0.3)));
			if (hits >= needed) matchedCriteria++;
		}
		const hasReasoning = REASONING_RE.test(raw);

		let grade: Grade = 0;
		let feedback: string;

		if (isLowSignalAnswer(raw)) {
			grade = 0;
			feedback = "Resposta vazia ou evasiva. Escreva o desenvolvimento completo antes de enviar a lista.";
		} else if (matchedTerms.length === 0 && matchedCriteria === 0) {
			grade = 0;
			feedback = missingTerms.length > 0
				? `Resposta fora do alvo esperado. Retome os conceitos-chave (${missingTerms.join(", ")}) e refaça o raciocínio.`
				: "Resposta fora do alvo esperado. Revise o objetivo do item e refaça a justificativa.";
		} else if (wordCount < Math.ceil(item.minWords * 0.5)) {
			grade = 0;
			feedback = `Resposta muito curta (${wordCount}/${item.minWords} palavras). Mostre os passos e a justificativa.`;
		} else if (wordCount < item.minWords) {
			grade = matchedTerms.length >= 1 ? 1 : 0;
			feedback = `Faltou desenvolvimento (${wordCount}/${item.minWords} palavras). Explicite como chegou à conclusão.`;
		} else {
			const termDenom = Math.min(item.expectedTerms.length, 4);
			const termRatio = termDenom > 0 ? Math.min(1, matchedTerms.length / termDenom) : 0;
			const criteriaRatio = item.rubricCriteria.length > 0 ? matchedCriteria / item.rubricCriteria.length : termRatio;
			const score = termDenom > 0 ? 0.55 * termRatio + 0.45 * criteriaRatio : criteriaRatio;

			if (score >= 0.65 && (hasReasoning || wordCount >= item.minWords + 4)) {
				grade = 3;
				feedback = "Correto e bem fundamentado.";
			} else if (score >= 0.38) {
				grade = 2;
				feedback = missingTerms.length > 0
					? `Acertou a direção geral; para fechar com rigor, conecte também: ${missingTerms.slice(0, 2).join(", ")}.`
					: "Acertou a direção geral; aprofunde as condições de validade para nota máxima.";
			} else {
				grade = 1;
				feedback = missingTerms.length > 0
					? `Resposta parcial. Faltou mobilizar conceitos centrais (${missingTerms.join(", ")}) e justificar o passo decisivo.`
					: "Resposta parcial. Revise o mecanismo central e contraste o resultado esperado.";
			}
		}

		const passed = grade >= 2;
		if (passed) byTier[item.tier].correct++;

		itemResults.push({
			itemId: item.id,
			nodeId: item.nodeId,
			tier: item.tier,
			grade,
			wordCount,
			matchedTerms,
			passed,
			feedback,
		});

		if (meta) {
			const seq = meta.startSeq + index;
			const evidence: Evidence = {
				id: `${set.id}:${item.id}:${seq}`,
				seq,
				at: meta.at,
				domainId: meta.domainId,
				sessionId: set.id,
				itemId: item.id,
				itemFamily: `${item.nodeId}#problem-set`,
				nodes: [{ nodeId: item.nodeId, q: 1, primary: true }],
				format: "short",
				level: 3,
				grade,
				graderConfidence: 0.8,
				hints: 0,
				minutesSinceExposure: 60,
				quizContext: {
					question: item.prompt.slice(0, 400),
					answer: raw.slice(0, 400),
					...(item.rubricCriteria[0] ? { expected: item.rubricCriteria.join(" | ").slice(0, 400) } : {}),
				},
			};
			events.push({ kind: "evidence", evidence });
		}
	});

	let labResult: LabScriptResult | undefined;
	if (set.lab) {
		const stepResults: LabStepResult[] = set.lab.steps.map((step) => {
			const note = (labNotes?.[step.id] ?? "").trim();
			const wordCount = normalizeTokens(note).length;
			const valid = !isLowSignalAnswer(note) && wordCount >= step.minWords;
			return {
				stepId: step.id,
				phase: step.phase,
				wordCount,
				passed: valid,
				feedback: valid
					? `Etapa "${step.phase}" registrada com clareza.`
					: `Complete "${step.phase}" com pelo menos ${step.minWords} palavras objetivas (observado: ${wordCount}).`,
			};
		});
		const completedSteps = stepResults.filter((s) => s.passed).length;
		const totalSteps = stepResults.length;
		const labPassed = totalSteps > 0 && completedSteps === totalSteps;
		labResult = {
			completedSteps,
			totalSteps,
			passed: labPassed,
			stepResults,
			feedback: labPassed
				? "Roteiro de laboratório completo nas 4 etapas do método científico."
				: `Roteiro de laboratório incompleto (${completedSteps}/${totalSteps} etapas válidas). Preencha as etapas pendentes.`,
		};
	}

	const maxPoints = set.items.length * 3;
	const earnedPoints = itemResults.reduce((sum, r) => sum + r.grade, 0);
	const score10 = maxPoints > 0 ? Math.round((earnedPoints / maxPoints) * 100) / 10 : 0;
	const correctCount = itemResults.filter((r) => r.passed).length;
	const totalCount = itemResults.length;
	const passed = totalCount > 0 && score10 >= 7.0 && (!labResult || labResult.passed);

	const summary = totalCount === 0
		? "Nenhum exercício disponível nesta lista."
		: passed
			? `Lista concluída: ${correctCount}/${totalCount} acertos (nota ${score10.toFixed(1)}/10)${labResult ? " e laboratório aprovado" : ""}.`
			: `Resultado: ${correctCount}/${totalCount} acertos (nota ${score10.toFixed(1)}/10)${labResult && !labResult.passed ? " · laboratório pendente" : ""}. Revise os itens destacados.`;

	return {
		result: {
			problemSetId: set.id,
			moduleId: set.moduleId,
			moduleTitle: set.moduleTitle,
			score10,
			correctCount,
			totalCount,
			passed,
			byTier,
			itemResults,
			...(labResult ? { labResult } : {}),
			summary,
		},
		events,
	};
}
