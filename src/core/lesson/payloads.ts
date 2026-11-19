/**
 * Prompt requests for the lesson roles (docs/research/00-SINTESE.md §2.4(b)(c)
 * "o orquestrador decide, o modelo só redige"; P7 commit-before-reveal; r1
 * §6.3, §7).
 *
 * The orchestrator's effects carry references only. This file is the single
 * place that turns state + effect into the variables of the templates in
 * src/agent/prompts/lesson/*.md — and the only place that reads answer keys
 * for a prompt. Everything here is SERVER-SIDE: the returned context may
 * contain keys and must never be sent to a client.
 *
 * Templates use `{{name}}` placeholders; fillTemplate() refuses a template
 * whose placeholders are not all provided (a renamed variable fails loudly
 * instead of shipping "{{context}}" to the model).
 *
 * revealsAnswer() is a deterministic guard for renders that must NOT give the
 * answer away (hints and first-attempt feedback): numbers with units equal to
 * the key, the correct option's text or id, or the reference sentence.
 *
 * Pure and browser-safe.
 */

import type { CurriculumItem } from "../curriculum/types.ts";
import { withinTolerance, type LearnerResponse } from "./grading.ts";
import { hintText } from "./hints.ts";
import { lessonItem, ROLE_RULES, type LessonEffect, type LessonState } from "./orchestrator.ts";
import { DEFAULT_PASS_RULE, PLAN_LIMITS, type AnswerKey, type LessonPlan, type PracticeItem } from "./protocol.ts";
import { foldText } from "./text.ts";
import { formatQuantity, parseQuantity, parseUnitExpression, scaleByPowerOfTen } from "./units.ts";

export const LESSON_PROMPTS = ["lesson-plan", "phase-render", "remediate", "recap", "grader"] as const;
export type LessonPromptName = (typeof LESSON_PROMPTS)[number];

export interface PromptRequest {
	template: LessonPromptName;
	/** Values for the template's `{{name}}` placeholders. */
	variables: Record<string, string>;
	/** Text the server may show as-is without a model call (authored hints). */
	verbatim?: string;
}

const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;
/** The maintainer header (`<!-- … -->` at the top of each .md) never reaches the model. */
const HEADER_COMMENT = /^\s*<!--[\s\S]*?-->\s*/;

/** Template text without its maintainer header comment. */
export function templateBody(template: string): string {
	return template.replace(HEADER_COMMENT, "");
}

/** Placeholder names used by a template body. */
export function templateVariables(template: string): string[] {
	return [...new Set([...templateBody(template).matchAll(PLACEHOLDER)].map((m) => m[1] ?? ""))].filter(Boolean);
}

/** Fill `{{name}}` placeholders of the template body; throws listing every missing variable. */
export function fillTemplate(template: string, variables: Readonly<Record<string, string>>): string {
	const missing = templateVariables(template).filter((name) => !(name in variables));
	if (missing.length > 0) throw new Error(`fillTemplate: variáveis ausentes: ${missing.join(", ")}`);
	return templateBody(template).replace(PLACEHOLDER, (_, name: string) => variables[name] ?? "");
}

function json(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

function localeOf(lang: string): "pt-BR" | "en" {
	return lang.toLowerCase().startsWith("pt") ? "pt-BR" : "en";
}

// ─── Item description helpers ───────────────────────────────────────────────

/** Public description of an item for prompts (what the learner saw). */
export function describeItem(item: PracticeItem): Record<string, unknown> {
	const base: Record<string, unknown> = { id: item.id, kind: item.kind, stem: item.stem, difficulty: item.difficulty };
	if (item.media) base.media = { kind: item.media.kind, alt: item.media.alt };
	switch (item.kind) {
		case "mcq":
		case "minimal_pair":
			base.options = item.options.map((o) => `${o.id}) ${o.text}`);
			break;
		case "numeric":
			if (item.answerUnit) base.answerUnit = item.answerUnit;
			break;
		case "sim":
			base.circuit = item.circuit;
			base.probe = item.probe;
			if (item.answerUnit) base.answerUnit = item.answerUnit;
			break;
		case "short":
		case "explain":
			base.maxWords = item.maxWords;
			break;
		case "dictation":
			base.lang = item.lang;
			break;
		case "speak":
			base.lang = item.lang;
			if (item.display) base.display = item.display;
			break;
	}
	return base;
}

/** The learner's response as plain text. */
export function formatResponse(item: PracticeItem, response: LearnerResponse | undefined): string {
	if (!response) return "(sem resposta)";
	switch (response.kind) {
		case "choice": {
			const option = item.kind === "mcq" || item.kind === "minimal_pair" ? item.options.find((o) => o.id === response.optionId) : undefined;
			return option ? `${option.id}) ${option.text}` : response.optionId;
		}
		case "text":
			return response.text;
		case "speech":
			return response.transcript;
		case "dont_know":
			return "(não sei)";
	}
}

/** The correct answer as text (SERVER-ONLY). */
export function formatAnswer(item: PracticeItem, key: AnswerKey, lang: string): string {
	const spec = key.answer;
	switch (spec.kind) {
		case "choice": {
			const option = item.kind === "mcq" || item.kind === "minimal_pair" ? item.options.find((o) => o.id === spec.correctOptionId) : undefined;
			return option ? `${option.id}) ${option.text}` : spec.correctOptionId;
		}
		case "numeric":
			return formatQuantity(spec.value, spec.unit, { locale: localeOf(lang), digits: 4 });
		case "text":
			return spec.reference;
		case "transcript":
			return spec.text;
	}
}

// ─── Answer-leak guard ──────────────────────────────────────────────────────

const UNIT_WORD = "(?:Ω|ohms?|Hz|V|A|F|H|W|s)";
const PREFIX_CHAR = "[pnuµμmkKMG]";
/**
 * Every number-like token of the prose: RKM ("4k7", "2R2"), a number with a
 * unit ("4,3 kΩ", "4300 ohm"), with a prefix only ("4,3k") or bare ("4300").
 * Not glued to a preceding letter/digit, so "R1" is not the number 1.
 */
const NUMBER_TOKEN = new RegExp(
	`(?<![\\p{L}\\p{N}_])(?:[+-]?\\d+[pnuµμmkKMGR]\\d+(?:\\s?${UNIT_WORD})?(?![\\p{L}\\p{N}])` +
		`|[+-]?\\d+(?:[.,]\\d+)*(?:\\s?${PREFIX_CHAR}?${UNIT_WORD}(?![\\p{L}])|\\s?${PREFIX_CHAR}(?![\\p{L}]))?)`,
	"gu",
);

/**
 * Does the prose state the numeric key in any form the learner could copy?
 * A token with a unit must be the same quantity; a token without one (bare or
 * prefix-only, "4300" / "4,3k") is compared in SI base units and, when the
 * card shows a unit next to the box (answerUnit "kΩ"), also as a number typed
 * in that unit ("4,3"). Dimensionless answers are caught the same way.
 */
function revealsNumeric(text: string, item: PracticeItem, spec: Extract<AnswerKey["answer"], { kind: "numeric" }>): boolean {
	const answerUnit = item.kind === "numeric" || item.kind === "sim" ? item.answerUnit : undefined;
	const displayExponent = answerUnit ? (parseUnitExpression(answerUnit)?.exponent ?? 0) : null;
	const matches = (value: number) => withinTolerance(value, spec.value, spec.tolerance);
	// NFKC: the Ohm sign (U+2126) and the micro sign (U+00B5) become Ω / μ.
	for (const match of text.normalize("NFKC").matchAll(NUMBER_TOKEN)) {
		const q = parseQuantity(match[0]);
		if (!q) continue;
		if (q.unit !== null) {
			if (q.unit === spec.unit && matches(q.value)) return true;
			continue;
		}
		if (matches(q.value)) return true;
		if (!q.prefixed && displayExponent !== null && matches(scaleByPowerOfTen(q.value, displayExponent))) return true;
	}
	return false;
}

function containsFolded(haystack: string, needle: string): boolean {
	const h = ` ${foldText(haystack).replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
	const n = foldText(needle).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
	return n.length > 0 && h.includes(` ${n} `);
}

function wordCount(text: string): number {
	return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Does `text` give away the answer? Conservative heuristics, used on hints and
 * first-attempt feedback (a positive means: regenerate or fall back to the
 * authored hint).
 */
export function revealsAnswer(text: string, item: PracticeItem, key: AnswerKey): boolean {
	const spec = key.answer;
	switch (spec.kind) {
		case "numeric":
			return revealsNumeric(text, item, spec);
		case "choice": {
			const option = item.kind === "mcq" || item.kind === "minimal_pair" ? item.options.find((o) => o.id === spec.correctOptionId) : undefined;
			const idPattern = new RegExp(`\\b(opcao|alternativa|letra|option|answer)\\s*\\(?${foldText(spec.correctOptionId).replace(/[^a-z0-9]/g, "")}\\)?(?![a-z0-9])`);
			if (idPattern.test(foldText(text))) return true;
			return !!option && (wordCount(option.text) >= 2 || option.text.length >= 8) && containsFolded(text, option.text);
		}
		case "text":
			return wordCount(spec.reference) >= 3 && containsFolded(text, spec.reference);
		case "transcript":
			return wordCount(spec.text) >= 2 && containsFolded(text, spec.text);
	}
}

// ─── Render requests ────────────────────────────────────────────────────────

type RenderEffect = Extract<LessonEffect, { type: "render_phase" }>;

function planOrThrow(state: LessonState): LessonPlan {
	if (!state.plan) throw new Error("renderRequest: a aula ainda não tem plano.");
	return state.plan;
}

/**
 * Misconception description for a prompt. `plan` is null for an item of
 * ANOTHER node (a warm-up): the lesson plan's misconceptions describe this
 * node only, and a shared id ("m.current_consumed" exists in many electronics
 * nodes) must not borrow this node's statement for another node's item.
 */
function misconceptionContext(plan: LessonPlan | null, id: string | undefined): Record<string, string> | null {
	if (!id) return null;
	const m = plan?.misconceptions.find((x) => x.id === id);
	if (m) return { id: m.id, statement: m.statement, diagnosticSignal: m.diagnosticSignal, repair: m.repair };
	if (id === "prefix_error") return { id, statement: "Confusão de prefixo SI (fator de 1000).", diagnosticSignal: "Resultado certo a menos de 10^±3, 10^±6…", repair: "Reescrever a grandeza em notação de engenharia antes de responder." };
	return { id, statement: id, diagnosticSignal: "", repair: "" };
}

/** Variables + context for a `render_phase` effect (SERVER-ONLY: may contain keys). */
export function renderRequest(state: LessonState, effect: RenderEffect): PromptRequest {
	const plan = planOrThrow(state);
	const inputs = effect.inputs;
	const lang = plan.lang;
	const base = {
		lang,
		targetLang: plan.targetLang ?? "",
		domainId: plan.domainId,
		nodeId: plan.nodeId,
		goal: plan.goal,
		phase: effect.phase,
		step: effect.budgetPhase,
		maxWords: effect.maxWords,
	};
	let template: LessonPromptName = "phase-render";
	let context: Record<string, unknown>;
	let verbatim: string | undefined;

	switch (inputs.kind) {
		case "orient":
			context = {
				...base,
				hook: plan.hook,
				estimatedMinutes: plan.estimatedMinutes,
				segments: plan.segments.map((s) => s.idea),
				preQuestions: plan.sources.flatMap((s) => s.preQuestions).slice(0, 2),
			};
			break;
		case "segment": {
			const segment = plan.segments.find((s) => s.id === inputs.segmentId);
			if (!segment) throw new Error(`renderRequest: segmento "${inputs.segmentId}" não existe.`);
			const prediction =
				inputs.resolvesPrediction && plan.prediction && state.prediction
					? {
							stem: plan.prediction.stem,
							learnerChoice: formatResponse(plan.prediction, state.prediction.optionId ? { kind: "choice", optionId: state.prediction.optionId } : { kind: "dont_know" }),
							correct: (() => {
								const key = plan.answerKeys[plan.prediction.id];
								return key ? formatAnswer(plan.prediction, key, lang) : "";
							})(),
						}
					: null;
			context = {
				...base,
				position: `${inputs.index + 1}/${inputs.total}`,
				previousIdeas: plan.segments.slice(0, inputs.index).map((s) => s.idea),
				segment: {
					idea: segment.idea,
					body: segment.body,
					analogy: segment.analogy ?? null,
					visual: segment.visual ? { kind: segment.visual.kind, alt: segment.visual.alt } : null,
				},
				prediction,
			};
			break;
		}
		case "worked": {
			const kp = plan.knowledgePoints.find((k) => k.id === inputs.kpId);
			if (!kp) throw new Error(`renderRequest: ponto "${inputs.kpId}" não existe.`);
			context = { ...base, knowledgePoint: { title: kp.title, statement: kp.statement }, workedExample: kp.workedExample };
			break;
		}
		case "feedback":
		case "solution": {
			const found = lessonItem(state, inputs.itemId);
			if (!found) throw new Error(`renderRequest: item "${inputs.itemId}" não existe.`);
			const final = inputs.kind === "solution";
			context = {
				...base,
				role: inputs.role,
				item: describeItem(found.item),
				learnerResponse: formatResponse(found.item, inputs.response),
				misconception: misconceptionContext(found.nodeId === plan.nodeId ? plan : null, inputs.misconceptionId),
				elaborate: inputs.elaborate,
				// The answer goes to the model so it can diagnose; the prompt forbids
				// stating it unless `final` is true (checked with revealsAnswer()).
				answerForTutorOnly: formatAnswer(found.item, found.key, lang),
				final,
				...(inputs.kind === "feedback"
					? {
							correct: inputs.correct,
							grade: inputs.grade,
							attempt: inputs.attempt,
							attemptsLeft: Math.max(0, ROLE_RULES[inputs.role].maxAttempts - inputs.attempt),
							pointer: inputs.pointer ? found.key.hints[0] : null,
						}
					: { reason: inputs.reason, solutionSteps: found.key.solution }),
			};
			break;
		}
		case "hint": {
			const found = lessonItem(state, inputs.itemId);
			if (!found) throw new Error(`renderRequest: item "${inputs.itemId}" não existe.`);
			verbatim = hintText(found.key, inputs.level);
			context = { ...base, item: describeItem(found.item), level: inputs.level, rung: ["cue", "principle", "next_step"][inputs.level - 1], hint: verbatim };
			break;
		}
		case "remediation": {
			template = "remediate";
			const kp = plan.knowledgePoints.find((k) => k.id === inputs.kpId);
			if (!kp) throw new Error(`renderRequest: ponto "${inputs.kpId}" não existe.`);
			context = {
				...base,
				knowledgePoint: { title: kp.title, statement: kp.statement },
				workedExample: kp.workedExample,
				misconception: misconceptionContext(plan, inputs.misconceptionId),
				// Remediation must change representation (r1 §6.5): list what was already used.
				representationsUsed: plan.segments.map((s) => ({ idea: s.idea, analogy: s.analogy?.source ?? null, visual: s.visual?.kind ?? null })),
			};
			break;
		}
		case "variation":
			context = { ...base, format: inputs.format, intro: plan.variation?.intro ?? "", itemStem: plan.variation?.item?.stem ?? null };
			break;
		case "recap": {
			template = "recap";
			const title = (id: string) => plan.knowledgePoints.find((k) => k.id === id)?.title ?? id;
			context = {
				...base,
				bullets: plan.recap.bullets,
				unlocks: plan.recap.unlocks,
				passed: inputs.passedKpIds.map(title),
				pending: inputs.pendingKpIds.map(title),
				misconceptionsSeen: state.observedMisconceptions.map((id) => misconceptionContext(plan, id)?.statement ?? id),
			};
			break;
		}
	}
	return {
		template,
		variables: { lang, targetLang: plan.targetLang ?? "", phase: effect.phase, step: effect.budgetPhase, maxWords: String(effect.maxWords), context: json(context) },
		...(verbatim !== undefined ? { verbatim } : {}),
	};
}

// ─── Grader request ─────────────────────────────────────────────────────────

/** Variables for src/agent/prompts/lesson/grader.md (SERVER-ONLY: carries the rubric and reference). */
export function graderRequest(state: LessonState, itemId: string, response: LearnerResponse): PromptRequest {
	const plan = state.plan;
	const found = lessonItem(state, itemId);
	if (!plan || !found) throw new Error(`graderRequest: item "${itemId}" não existe nesta aula.`);
	const spec = found.key.answer;
	// A warm-up item belongs to another node: this plan's misconceptions and
	// encompassed nodes say nothing about it, and offering them would let the
	// grader blame the wrong node (cross-node attribution).
	const ownNode = found.nodeId === plan.nodeId;
	const context = {
		nodeId: found.nodeId,
		role: found.role,
		item: describeItem(found.item),
		learnerResponse: formatResponse(found.item, response),
		reference: formatAnswer(found.item, found.key, plan.lang),
		rubric: spec.kind === "text" ? spec.rubric : [],
		accepted: spec.kind === "text" || spec.kind === "transcript" ? spec.accepted : [],
		misconceptions: ownNode ? plan.misconceptions.map((m) => ({ id: m.id, statement: m.statement, diagnosticSignal: m.diagnosticSignal })) : [],
		relatedNodes: ownNode ? [found.nodeId, ...plan.encompasses.map((e) => e.nodeId)] : [found.nodeId],
	};
	return { template: "grader", variables: { lang: plan.lang, context: json(context) } };
}

// ─── Plan request ───────────────────────────────────────────────────────────

export type PlanNodeInput = Pick<CurriculumItem, "id" | "title" | "summary" | "scope" | "objectives"> &
	Partial<Pick<CurriculumItem, "misconceptions" | "assess" | "level" | "lexicalItems" | "encompasses" | "version" | "domainId">>;

export interface PlanRequestInput {
	node: PlanNodeInput;
	/** Explanation language (BCP-47, default "pt-BR"). */
	lang?: string;
	/** Target language for a language domain ("en" for English). */
	targetLang?: string;
	/** Titles of prerequisites the learner already holds (vocabulary the lesson may assume). */
	knownPrerequisites?: string[];
	/** Misconceptions observed earlier for this learner (statements). */
	pastMisconceptions?: string[];
	/** Kinds/formats of the last two nodes of the domain, to pick a different variation (F7). */
	recentVariationFormats?: string[];
	/** Validation issues of a rejected draft, for the single corrective re-ask. */
	previousIssues?: string;
}

/** Variables for src/agent/prompts/lesson/lesson-plan.md. */
export function planRequest(input: PlanRequestInput): PromptRequest {
	const lang = input.lang ?? "pt-BR";
	const node = input.node;
	const context = {
		node: {
			id: node.id,
			title: localeOf(lang) === "pt-BR" ? node.title.pt : node.title.en,
			summary: node.summary,
			scope: node.scope,
			objectives: node.objectives,
			misconceptions: node.misconceptions ?? [],
			assess: node.assess ?? [],
			level: node.level ?? null,
			lexicalItems: node.lexicalItems ?? [],
			encompasses: (node.encompasses ?? []).map((e) => ({ nodeId: e.id, weight: e.w })),
		},
		learner: {
			knownPrerequisites: input.knownPrerequisites ?? [],
			pastMisconceptions: input.pastMisconceptions ?? [],
			recentVariationFormats: input.recentVariationFormats ?? [],
		},
		limits: { ...PLAN_LIMITS, defaultPassRule: DEFAULT_PASS_RULE },
	};
	return {
		template: "lesson-plan",
		variables: {
			lang,
			targetLang: input.targetLang ?? "",
			domainId: node.domainId ?? "",
			context: json(context),
			previousIssues: input.previousIssues ?? "",
		},
	};
}
