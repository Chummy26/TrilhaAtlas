/**
 * Contingent pedagogy controller for campaign lessons (pure, browser-safe).
 *
 * Grounded in recent AI tutoring research & benchmarks:
 * - TutorBench (Scale AI): adaptive explanations, actionable feedback, active
 *   learning without premature answer revealing.
 * - MathTutorBench & MRBench (8 pedagogical dimensions): mistake identification,
 *   mistake location, guidance without spoiling, actionability, coherence, tone.
 * - LearnLM (Google DeepMind): pedagogical instruction following, cognitive load
 *   management, active learning, adaptivity, metacognition.
 * - Hou et al. (2026), "Adaptive Scaffolding Needs Contingency": escalate or fade
 *   support strictly from learner uptake while preserving metacognitive demand.
 * - Neagu et al. (ICML Workshop 2026), "Rethinking Scaffolding in LLM Tutors":
 *   respect learner agency/uptake instead of forcing rigid scripts.
 * - Mitton et al. (2026): explicit misconception diagnosis from dialogue turns.
 * - SAFETUTORS (2026): zero sycophancy / never reinforce a false premise.
 */

import type { CurriculumItem } from "../curriculum/types.ts";
import { regionExitTag } from "../curriculum/campaign.ts";
import type { QuestionAnswerData } from "../question-core.ts";
import type { LhViewMessage } from "../view.ts";
import { lessonExamPhase, type LessonExamPhase } from "./lesson-conclusion.ts";
import { gradeStudyQuiz } from "./quiz.ts";

export type LessonPedagogyStage =
	| "opening"
	| "scaffolding"
	| "repair"
	| "fading"
	| "exam-ready"
	| "exam-awaiting"
	| "exam-first-verdict"
	| "exam-final-verdict";

export type ScaffoldLevel = 0 | 1 | 2 | 3;

export interface MissionPedagogyObjective {
	title: string;
	objectives: readonly string[];
	assessment?: readonly string[];
	misconceptions?: readonly string[];
	/** Enables the advanced oral-defense / panel cross-examination protocol (Banca Examinadora). */
	isAdvancedDefense?: boolean;
	/** Mandates attaching and assigning a targeted reading from a high-reputation textbook/PDF (advanced nodes only). */
	requiresQualityReading?: boolean;
	/** Optional level label (e.g., "Graduação", "Avançado", "Pesquisa", "C1", "C2"). */
	levelLabel?: string;
}

const DEFENSE_KINDS = new Set(["design_project", "checkpoint"]);
const DEFENSE_TAGS = new Set([regionExitTag, "design_project", "checkpoint", "capstone", "defense"]);
const ADVANCED_READING_TAGS = new Set(["research", "capstone", "defense", "advanced", "design_project"]);

/**
 * Identify genuinely advanced/research nodes where assigning a mandatory reading
 * from a high-reputation textbook or academic PDF is pedagogically warranted
 * (never triggered on routine A1–B2 or foundational nodes to avoid bureaucracy).
 */
export function isAdvancedReadingRequiredNode(
	item: {
		level: CurriculumItem["level"];
		tags?: readonly string[];
		kind?: string;
		atomType?: CurriculumItem["atomType"];
	},
	isFinale?: boolean,
): boolean {
	if (isAdvancedDefenseNode(item, isFinale)) return true;
	if (item.tags?.some((tag) => ADVANCED_READING_TAGS.has(tag))) return true;
	if (item.level.scheme === "cefr") return item.level.cefr === "C1" || item.level.cefr === "C2";
	if (item.level.scheme === "ee") return item.level.band >= 3;
	return item.level.band >= 3;
}

/**
 * Identify advanced landmark/defense nodes where the formal exam runs as a
 * defense panel (Banca Examinadora / Arguição): Graduação/Avançado/Pesquisa
 * (`ee` band >= 2) or `C1`/`C2` (`cefr`), especially on `region-exit`, `finale`,
 * `design_project`, or `checkpoint` nodes.
 */
export function isAdvancedDefenseNode(
	item: {
		level: CurriculumItem["level"];
		tags?: readonly string[];
		kind?: string;
		atomType?: CurriculumItem["atomType"];
	},
	isFinale?: boolean,
): boolean {
	const isLandmark = Boolean(isFinale)
		|| Boolean(item.atomType && DEFENSE_KINDS.has(item.atomType))
		|| Boolean(item.kind && DEFENSE_KINDS.has(item.kind))
		|| Boolean(item.tags?.some((tag) => DEFENSE_TAGS.has(tag)));

	if (item.level.scheme === "ee") {
		if (item.level.band < 2) return false;
		return item.level.band >= 3 || isLandmark;
	}
	if (item.level.scheme === "cefr") {
		if (item.level.cefr === "C2") return true;
		if (item.level.cefr === "C1") return isLandmark;
		return false;
	}
	return item.level.band >= 2 && isLandmark;
}

export interface LessonPedagogyState {
	stage: LessonPedagogyStage;
	examPhase: LessonExamPhase;
	/** 0 = fade/independent, 1 = focused cue, 2 = faded step, 3 = full worked model + fresh check. */
	scaffoldLevel: ScaffoldLevel;
	impasseCount: number;
	learnerTurns: number;
	assistantTurns: number;
	hasWorkedExplanation: boolean;
	hasInteractiveActivity: boolean;
	hasAttachedMaterials: boolean;
	askedForAnswer: boolean;
	askedForExam: boolean;
	askedForMaterials: boolean;
	askedWhyOrSimpler: boolean;
	lastQuizOutcome: "none" | "correct" | "wrong" | "dont-know";
}

const CONFUSION_RE = /\b(n[aã]o entendi|n[aã]o saquei|n[aã]o sei|n[aã]o consigo|confus[oa]|perdid[oa]|me perdi|travei|buguei|boiando|deu branco|dif[ií]cil|ainda errei|n[aã]o fechou|i don't know|don't understand|confused|stuck)\b/iu;
const WHY_SIMPLER_RE = /(\bpor\s*qu[eê]\b|\bcomo assim\b|\bmais simples\b|\bpasso a passo\b|\bexplica melhor\b|\bdetalha\b|\bwhy\b|\bsimpler\b)/iu;
const ASK_ANSWER_RE = /\b(d[aá] a resposta|qual [eé] a resposta|me diz a resposta|resolve (?:pra|para) mim|faz (?:pra|para) mim|just tell me|give me the answer|solve it for me)\b/iu;
const ASK_EXAM_RE = /\b(aplicar? a prova|fazer a prova|ir (?:direto )?(?:pra|para) a prova|pode testar|j[aá] domino|j[aá] sei isso|quero a prova|take the exam|ready for the exam)\b/iu;
const ASK_MATERIALS_RE = /\b(?:(?:indica|sugere|recomenda|manda|passa|mostra|quero|preciso|tem|onde|qual|quais|buscar?|ver|ler|estudar|aprofundar)[^.?!\n]{0,40}(?:livro|leitura|cap[ií]tulo|v[ií]deo|youtube|material|materiais|apostila|refer[eê]ncia|pdf|book|video|reading)|(?:livro|leitura|v[ií]deo|youtube|material|materiais|apostila|refer[eê]ncia|pdf)\s+(?:para|pra|sobre|de\s+estudo|recomendad[oa]|bom|boa))\b/iu;
const READY_RE = /\b(entendi|ficou claro|agora quero tentar|entendido|faz sentido|got it|makes sense)\b/iu;
const NON_TEACHING_GREETING_RE = /^(?:ol[aá]|oi|bom dia|boa tarde|boa noite|vamos l[aá]|vamos come[cç]ar|plano da aula|confirm[ae]\s+o\s+plano)(?![a-z\p{L}])/iu;

function textOf(message: LhViewMessage): string {
	return message.parts
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text!.trim())
		.filter(Boolean)
		.join("\n");
}

function quizOutcomeOf(messages: readonly LhViewMessage[]): { outcome: LessonPedagogyState["lastQuizOutcome"]; recentWrongStreak: number } {
	let outcome: LessonPedagogyState["lastQuizOutcome"] = "none";
	let recentWrongStreak = 0;
	for (const message of messages) {
		for (const part of message.parts) {
			if (part.type !== "tool-quiz" && part.type !== "tool-explain") continue;
			if (part.state !== "output-available") continue;
			const result = part.output as QuestionAnswerData | undefined;
			if (!result || result.dismissed) continue;
			if (result.dontKnow) {
				outcome = "dont-know";
				recentWrongStreak++;
				continue;
			}
			if (part.type === "tool-quiz") {
				const graded = gradeStudyQuiz(part.input, part.toolCallId ?? "", result);
				if (!graded) continue;
				if (graded.grade === 3) {
					outcome = "correct";
					recentWrongStreak = 0;
				} else {
					outcome = "wrong";
					recentWrongStreak++;
				}
			}
		}
	}
	return { outcome, recentWrongStreak };
}

/**
 * Derive the current pedagogical state purely from the lesson transcript.
 * Deterministic and cheap: runs on every teaching turn without extra LLM calls.
 */
export function analyzeLessonPedagogy(messages: readonly LhViewMessage[]): LessonPedagogyState {
	const examPhase = lessonExamPhase(messages);
	let learnerTurns = 0;
	let assistantTurns = 0;
	let hasWorkedExplanation = false;
	let hasInteractiveActivity = false;
	let hasAttachedMaterials = false;
	let impasseCount = 0;
	let lastUserText = "";

	for (const message of messages) {
		if (message.role === "assistant") {
			const prose = textOf(message);
			const hasActivity = message.parts.some((p) => p.type === "tool-study_activity");
			if (prose.length > 0) assistantTurns++;
			const looksLikeSubstantialTeaching = prose.length >= 160 && !(NON_TEACHING_GREETING_RE.test(prose) && prose.length < 220);
			if (looksLikeSubstantialTeaching || (hasActivity && prose.length >= 80)) hasWorkedExplanation = true;
			if (hasActivity) hasInteractiveActivity = true;
			if (message.parts.some((p) => p.type === "tool-attach_study_materials")) hasAttachedMaterials = true;
		} else if (message.role === "user") {
			const prose = textOf(message);
			if (!prose) continue;
			learnerTurns++;
			lastUserText = prose;
			const hasConfusion = CONFUSION_RE.test(prose) || ASK_ANSWER_RE.test(prose);
			const hasWhy = WHY_SIMPLER_RE.test(prose);
			if (hasConfusion) {
				impasseCount++;
			} else if (!hasWhy && (READY_RE.test(prose) || ASK_EXAM_RE.test(prose))) {
				impasseCount = 0;
			}
		}
	}

	const { outcome: lastQuizOutcome, recentWrongStreak } = quizOutcomeOf(messages);
	if (recentWrongStreak > 0) impasseCount = Math.max(impasseCount, recentWrongStreak);
	if (lastQuizOutcome === "correct" && !CONFUSION_RE.test(lastUserText)) impasseCount = 0;

	const askedForAnswer = ASK_ANSWER_RE.test(lastUserText);
	const askedForExam = ASK_EXAM_RE.test(lastUserText);
	const askedForMaterials = ASK_MATERIALS_RE.test(lastUserText);
	const askedWhyOrSimpler = WHY_SIMPLER_RE.test(lastUserText);
	const expressedConfusion = CONFUSION_RE.test(lastUserText);

	const common = {
		examPhase,
		impasseCount,
		learnerTurns,
		assistantTurns,
		hasWorkedExplanation,
		hasInteractiveActivity,
		hasAttachedMaterials,
		askedForAnswer,
		askedForExam,
		askedForMaterials,
		askedWhyOrSimpler,
		lastQuizOutcome,
	};

	if (examPhase === "awaiting-answer") return { ...common, stage: "exam-awaiting", scaffoldLevel: 0 };
	if (examPhase === "first-verdict") return { ...common, stage: "exam-first-verdict", scaffoldLevel: 1 };
	if (examPhase === "final-verdict") return { ...common, stage: "exam-final-verdict", scaffoldLevel: 0 };
	if (!hasWorkedExplanation) return { ...common, stage: "opening", scaffoldLevel: 1 };
	if (askedForExam) return { ...common, stage: "exam-ready", scaffoldLevel: 0, impasseCount: 0 };

	const needsRepair = expressedConfusion || askedForAnswer || askedWhyOrSimpler || lastQuizOutcome === "wrong" || lastQuizOutcome === "dont-know";
	if (needsRepair) {
		const effectiveImpasse = Math.max(1, impasseCount);
		const scaffoldLevel: ScaffoldLevel = effectiveImpasse >= 3 ? 3 : effectiveImpasse === 2 ? 2 : 1;
		return { ...common, stage: "repair", scaffoldLevel, impasseCount: effectiveImpasse };
	}

	if (lastQuizOutcome === "correct" || assistantTurns >= 2) {
		return { ...common, stage: assistantTurns >= 3 ? "exam-ready" : "fading", scaffoldLevel: 0, impasseCount: 0 };
	}

	return { ...common, stage: "scaffolding", scaffoldLevel: 1 };
}

/**
 * Build a compact, phase-specific pedagogical directive for a campaign lesson turn.
 * Replaces static catch-all prompts with contingent scaffolding (Hou et al. 2026)
 * and structured error diagnosis (MRBench / TutorBench / SAFETUTORS).
 */
export function buildMissionPedagogyDirective(
	messages: readonly LhViewMessage[],
	objective: MissionPedagogyObjective,
	opts: { priorReinforcement?: string } = {},
): string {
	const state = analyzeLessonPedagogy(messages);
	const misconceptions = objective.misconceptions?.length
		? ` Known traps to watch for: ${objective.misconceptions.slice(0, 3).join("; ")}.`
		: "";
	const priorGap = opts.priorReinforcement
		? ` Previous attempt gap to address directly: ${opts.priorReinforcement}`
		: "";

	const attachMaterialsHint = !state.hasAttachedMaterials
		? " Also call attach_study_materials (useLesson=true) if available and suggest both a book/extended reading section and a video lesson, specifying exactly which chapter/passage to read and what to watch for."
		: " Refer back to the attached book/extended reading and video materials, pointing to the exact chapter or segment that clarifies this bottleneck.";

	const defenseTag = objective.isAdvancedDefense
		? `Modo Banca Examinadora / Arguição${objective.levelLabel ? ` (${objective.levelLabel})` : ""}:`
		: "";

	const advancedReadingMandate = objective.requiresQualityReading
		? !state.hasAttachedMaterials
			? " MANDATORY ADVANCED READING: Because this is an advanced/research-level skill, you MUST call attach_study_materials (useLesson=true) in this turn and require the learner to read a specific section/chapter from a high-reputation textbook or academic PDF (naming work, chapter/section, and 1–2 critical reading checks) before moving to the formal exam/defense. (Do NOT skip this for advanced nodes; reserve mandatory textbook reading strictly for advanced nodes like this one.)"
			: " ADVANCED READING FOLLOW-UP: Verify that the learner engaged with the required high-reputation textbook/PDF section (asking them to justify one key claim, derivation, or limitation from the reading) before advancing to the formal exam/defense."
		: "";

	switch (state.stage) {
		case "exam-awaiting":
			return "A formal exam is already displayed. Only a response submitted in its form is an attempt. Ordinary chat is for logistics or clarifying the wording. If needed, point to the form. Do not grade messages from the chat, give a hint, reveal solutions, or replace this exam.";

		case "exam-first-verdict":
			if (objective.isAdvancedDefense) {
				return [
					defenseTag,
					"The learner has submitted attempt 1 of the advanced defense exam. Be strict: grade 3 requires complete, independent technical mastery AND explicit defense of hypotheses, boundary cases, and trade-offs—never pass on partial credit or unexamined assumptions.",
					"If the initial answer is technically solid on the main path but has NOT yet defended edge/boundary cases, hidden premises, or counterexamples, DO NOT approve yet: conduct round 2 as a critical panel cross-examination (arguição crítica da banca) by calling present_lesson_exam with concise feedback on what held up plus 2 sharp counter-questions targeting a boundary case, a hidden premise, or a counterexample.",
					"Call conclude_lesson on attempt 1 ONLY if the submission already independently proved every objective AND rigorously defended boundary cases, premises, and trade-offs with substantial verbatim evidence.",
					"If there is already a serious technical or conceptual flaw: (1) acknowledge what holds, (2) diagnose the earliest diverging step and underlying misconception without softening false premises," + attachMaterialsHint,
					"and (3) call present_lesson_exam with strict corrective feedback and a genuinely new rigorous case. Do not put the arguição or retest only in prose.",
				].join(" ");
			}
			return [
				"The learner has submitted attempt 1 of the formal exam. Be strict: grade 3 requires independent, complete mastery of EVERY objective (including required units, reasoning, assumptions, or language register)—never pass on partial credit, vague wording, or benefit of the doubt.",
				"Call conclude_lesson on this turn ONLY if every single objective passes independently with substantial verbatim evidence.",
				"If ANY criterion falls short: (1) acknowledge what is right, (2) pinpoint the first step that diverged and the underlying misconception without softening a wrong premise," + attachMaterialsHint,
				"and (3) call present_lesson_exam with that corrective feedback and one genuinely new case (never reuse the same problem). Do not put a retest only in prose.",
			].join(" ");

		case "exam-final-verdict":
			if (objective.isAdvancedDefense) {
				return [
					defenseTag,
					"The learner has submitted the second and final defense answer (arguição da banca). Be strict: call conclude_lesson this turn with a criterion-by-criterion verdict citing substantial verbatim submission excerpts.",
					"Pass (grade 3) ONLY when the complete defense demonstrates both full technical mastery of every objective AND rigorous defense (or disciplined revision) of premises, boundary cases, and trade-offs under challenge.",
					"If technical evidence or premise defense under contestation is still insufficient, you MUST close with reinforcement (grade 0–2, cards: []) so prerequisites stay locked, explain the exact unresolved gap, and point to a specific book/extended reading section and video to study before retrying.",
					"A third question, another activity, or asking the learner to self-grade is forbidden.",
				].join(" ");
			}
			return [
				"The learner has submitted the second and final exam answer. Be strict: call conclude_lesson this turn with the criterion-by-criterion verdict citing substantial verbatim submission excerpts.",
				"Pass (grade 3) ONLY when every objective is met independently without gaps or missing justifications.",
				"If independent evidence is still insufficient, you MUST close with reinforcement (grade 0–2, cards: []) so prerequisites stay locked, explain the exact remaining gap, and point to a specific book/extended reading section and video to study before retrying.",
				"A third question, another activity, or asking the learner to self-grade is forbidden.",
			].join(" ");

		case "opening":
			return [
				`Campaign lesson opening for "${objective.title}".`,
				"Do not spend this turn on a bureaucracy plan or confirmation loop. Start from a concrete situation, teach the essential principle with one complete worked example (naming the cause and observable consequence), and manage cognitive load (one core contrast at a time).",
				"Pre-empt the main confusion and end with ONE short faded step or interactive exploration for the learner to try before the formal exam.",
				advancedReadingMandate.trim(),
				misconceptions,
				priorGap,
			].filter(Boolean).join(" ");

		case "repair": {
			const ladder =
				state.scaffoldLevel === 1
					? "Scaffold level 1 (focused cue): keep the metacognitive decision with the learner. Point to the exact step or variable that broke and ask them to adjust only that move—do not give away the full solution."
					: state.scaffoldLevel === 2
						? "Scaffold level 2 (faded worked step): model the principle up to the decisive turn using a parallel mini-case, then leave only the last step for the learner to complete."
						: "Scaffold level 3 (worked solution + fresh check): never withhold unproductively after repeated impasses. Show the complete worked solution clearly explaining why each step holds, then invite one short analogous try to verify transfer.";
			const antiSpoiler = state.askedForAnswer && state.scaffoldLevel < 3
				? " The learner asked for the direct answer: briefly explain why trying the decisive step builds retention, give a targeted cue instead of spoiling, and offer the full worked step only if they still get stuck."
				: "";
			const unpack = state.askedWhyOrSimpler
				? " Unpack the missing intermediate step with a concrete contrast or simpler analogy (noting where the analogy stops holding) before posing any new task."
				: "";
			const studySupport = (state.scaffoldLevel >= 2 || state.askedForMaterials || state.askedWhyOrSimpler)
				? attachMaterialsHint
				: "";
			return [
				"Contingent repair turn (MRBench/SAFETUTORS):",
				"1) Preserve what is right in the learner's attempt; 2) locate the earliest step that diverged; 3) name the misconception plainly—never validate an incorrect premise.",
				ladder + antiSpoiler + unpack + studySupport,
				misconceptions,
			].filter(Boolean).join(" ");
		}

		case "fading":
			return [
				"Fading turn: the learner showed uptake. Reduce scaffolding—do not repeat an already-grasped example or add filler quizzes.",
				"Never conclude or treat the node as mastered merely because the learner said they understood: mastery must be proven in the formal exam.",
				state.askedForMaterials ? attachMaterialsHint.trim() : "",
				"If any essential objective remains untaught, teach it concisely with one contrast; otherwise move directly to present_lesson_exam in this turn with an independent transfer case.",
			].filter(Boolean).join(" ");

		case "exam-ready":
			if (objective.isAdvancedDefense) {
				return [
					defenseTag,
					state.askedForExam
						? "The learner explicitly requested the formal defense exam—honor their initiative."
						: "The essential objectives are covered; move directly to the advanced defense.",
					"Call present_lesson_exam in this turn with a substantiated defense task (using `parts` whenever there are 2–6 distinct deliverables) requiring explicit hypotheses/assumptions, justification of key trade-offs, and observable deliverables across every essential objective, with zero hints or solutions.",
				].join(" ");
			}
			return [
				state.askedForExam
					? "The learner explicitly requested the formal exam—honor their initiative."
					: "The essential objectives are covered; avoid extending the lesson with repetitive drills.",
				"Call present_lesson_exam in this turn with one compact, independent transfer task covering every essential objective (supplying `parts` whenever there are 2–6 deliverables, and never printing hidden blind-listening audio transcripts), with observable deliverables and zero hints or solutions.",
			].join(" ");

		case "scaffolding":
		default:
			return [
				"Active campaign teaching turn:",
				"Respond directly to the learner's latest move, diagnose any subtle slip without softening false premises, and fade support as soon as they apply the principle independently.",
				objective.requiresQualityReading && !state.hasAttachedMaterials ? advancedReadingMandate.trim() : "",
				state.askedForMaterials ? attachMaterialsHint.trim() : "",
				"Keep at most one focused task per turn; move to present_lesson_exam as soon as the essential objectives have been taught and tried.",
				misconceptions,
			].filter(Boolean).join(" ");
	}
}
