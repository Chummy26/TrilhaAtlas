/**
 * TurnBudget: the cadence rules that keep the tutor from "explaining fast and
 * dumping questions" (docs/research/00-SINTESE.md §1.2 P2/P12, §1.3
 * "Orçamento de palavras por fase" and "Validação de cadência", §1.4; r1 §0.8,
 * §5 defects #1/#3/#4/#8, §6.4, §6.12, §6.13).
 *
 *   • ≤1 question per tutor message;
 *   • ≤2 consecutive tutor turns ending in a question (practice turns break
 *     the streak — "fora da prática", r1 §6.4);
 *   • ≤3 conversational questions per node (prose questions + check cards);
 *   • Socratic ≤2 rounds at the same point;
 *   • a question, when allowed, is the LAST sentence (no question in the
 *     middle of the prose, §1.4) and only in phases that may ask at all
 *     (explain, remediate, recap, variation);
 *   • banned phrases: filler comprehension checks ("faz sentido?",
 *     "entendeu?", "does that make sense?"…), performative praise ("ótima
 *     pergunta", "great question", "Parabéns!", "Isso mesmo!") and
 *     meta-narration of the lesson machinery ("nesta seção", "a seguir
 *     veremos", "knowledge point", "XP") or visible self-correction
 *     ("Espera, …");
 *   • word budgets: orient 90 · explain 250 · feedback 50 · hint 35 ·
 *     recap 60 (SÍNTESE), plus the documented extensions below.
 *
 * violatesBudget(text, phase, history) is deterministic and returns EVERY
 * violation; the server does ONE cheap rewrite (rewriteInstructions) when the
 * list is non-empty. Question detection is punctuation-based on the
 * learner-directed prose (./text.ts): quoted/italic/blockquoted
 * target-language examples ("Does that make sense?" taught as English) are
 * content and never count — the prompts require examples to be quoted.
 *
 * Word budgets not fixed by the SÍNTESE (chosen as the simplest values that
 * respect r1 §6.3's per-phase limits): predict 60 (card lead-in), warmup 40,
 * worked 200, faded 80, practice 50 (= feedback), variation 120, cards 40,
 * exit 40, remediate 150 ("segmento curto"), feedback_elaborate 80 (wrong with
 * high confidence, r1 §6.7), solution 120 (rung 4: the worked solution),
 * prepare 0 (no learner-facing text).
 *
 * Pure and browser-safe.
 */

import type { Phase } from "./protocol.ts";
import { countQuestions, countWords, endsWithQuestion, foldText, hasMidProseQuestion, learnerDirectedText } from "./text.ts";

/** Phases plus the message kinds that have their own budget. */
export type BudgetPhase = Phase | "feedback" | "feedback_elaborate" | "hint" | "solution";

export const WORD_BUDGETS: Readonly<Record<BudgetPhase, number>> = Object.freeze({
	prepare: 0,
	orient: 90,
	predict: 60,
	warmup: 40,
	explain: 250,
	worked: 200,
	faded: 80,
	practice: 50,
	variation: 120,
	recap: 60,
	cards: 40,
	exit: 40,
	remediate: 150,
	feedback: 50,
	feedback_elaborate: 80,
	hint: 35,
	solution: 120,
});

/** Phases whose prose may end with ONE question (everything else asks only through cards). */
export const QUESTION_PHASES: ReadonlySet<BudgetPhase> = new Set<BudgetPhase>(["explain", "remediate", "recap", "variation"]);

export interface BannedPhrase {
	id: string;
	kind: "filler_check" | "performative_praise" | "meta_narration";
	/** Tested against foldText(learner-directed prose): lowercase, no diacritics. */
	pattern: RegExp;
}

export const BANNED_PHRASES: readonly BannedPhrase[] = Object.freeze([
	// Filler comprehension checks — PT-BR.
	{ id: "faz-sentido", kind: "filler_check", pattern: /\bf[ae]z sentido\b[^?.!\n]{0,20}\?/ },
	{ id: "entendeu", kind: "filler_check", pattern: /\b(entendeu|entendido|compreendeu|compreendido|captou|sacou)\b[^?.!\n]{0,15}\?/ },
	{ id: "ficou-claro", kind: "filler_check", pattern: /\b(ficou|esta|ta|tudo|isso) (bem |mais )?clar[oa]\b[^?.!\n]{0,15}\?/ },
	{ id: "alguma-duvida", kind: "filler_check", pattern: /\b(alguma|ficou alguma|tem alguma|mais alguma) duvida\b[^?.!\n]{0,15}\?/ },
	{ id: "acompanhando", kind: "filler_check", pattern: /\b(consegu\w* acompanhar|esta acompanhando|ta acompanhando)\b[^?.!\n]{0,15}\?/ },
	{ id: "continuar", kind: "filler_check", pattern: /\b(podemos|posso|vamos|quer|bora) (continuar|seguir|prosseguir|avancar)\b[^.!\n]{0,20}\?/ },
	{ id: "tag-pt", kind: "filler_check", pattern: /,\s*(certo|ne|beleza|ok|ta bom|combinado)\s*\?/ },
	// Filler comprehension checks — EN.
	{ id: "make-sense", kind: "filler_check", pattern: /\b(does|did) (that|this|it) (make|makes) sense\b|\bmakes? sense\s*\?/ },
	{ id: "got-it", kind: "filler_check", pattern: /\b(got|get) (it|that)\s*\?/ },
	{ id: "understand", kind: "filler_check", pattern: /\b(do you|did you) understand\b|\bunderstood\s*\?/ },
	{ id: "clear", kind: "filler_check", pattern: /\b(is|was) (that|this|it|everything) clear\b/ },
	{ id: "any-questions", kind: "filler_check", pattern: /\bany (other |more |further )?questions\b[^.!\n]{0,15}\?/ },
	{ id: "move-on", kind: "filler_check", pattern: /\b(ready to|shall we|can we|should we) (move on|continue|proceed)\b/ },
	{ id: "tag-en", kind: "filler_check", pattern: /,\s*(right|ok|okay)\s*\?/ },
	// Performative praise.
	{ id: "otima-pergunta", kind: "performative_praise", pattern: /\b(otima|boa|excelente|bela|grande|incrivel|maravilhosa) pergunta\b|\bpergunta (incrivel|excelente|otima|maravilhosa)\b/ },
	{ id: "great-question", kind: "performative_praise", pattern: /\b(great|good|excellent|awesome|fantastic|wonderful) question\b/ },
	{
		id: "praise-pt",
		kind: "performative_praise",
		pattern: /\b(parabens|excelente|incrivel|fantastico|maravilhoso|sensacional|muito bem|mandou bem|arrasou|otimo|otimo trabalho|bom trabalho|perfeito|isso mesmo|isso ai|boa)\s*!/,
	},
	{ id: "praise-en", kind: "performative_praise", pattern: /\b(great job|well done|awesome|excellent|amazing|fantastic|perfect|good job|nice work)\s*!/ },
	{ id: "praise-emoji", kind: "performative_praise", pattern: /[🎉👏🌟✨🥳🙌💯]/u },
	// Meta-narration of the lesson machinery (r1 §7.1 rule 9; BloomTutor rule 17).
	// "parte"/"fase" alone are physics words ("nesta fase do ciclo"); only the lesson's own parts count.
	{ id: "meta-section", kind: "meta_narration", pattern: /\b(nest[ae]|na proxima|da proxima) (secao|etapa)\b|\b(nest[ae]|na proxima) (parte|fase) da (aula|licao)\b/ },
	{ id: "meta-machinery", kind: "meta_narration", pattern: /\b(knowledge point|ponto de conhecimento|modelo do aluno|learner model|fase de (explicacao|pratica|orientacao))\b|\bxp\b/ },
	{ id: "meta-en", kind: "meta_narration", pattern: /\bin (this|the next) (section|phase|segment|lesson)\b|\b(next|now) we (will|are going to) (see|learn|look at|cover)\b/ },
	{
		id: "meta-lesson",
		kind: "meta_narration",
		pattern: /\b(nest[ae]|na proxima) (aula|licao)\b|\ba seguir,? (veremos|vamos ver|voce vai ver)\b|\b(agora|em seguida) vamos (ver|aprender|estudar)\b/,
	},
	// Visible self-correction (BloomTutor `has_self_correction`): a wrong draft is rewritten, never patched aloud.
	{ id: "self-correction", kind: "meta_narration", pattern: /(?:^|[.!?]\s+|\n\s*)(?:wait|espera|epa|ops|opa|hmm+)[,.!]|\b(?:correcao|correction|deixa eu corrigir|let me correct)\s*:/ },
	{ id: "meta-ai", kind: "meta_narration", pattern: /\b(como (uma )?ia|como modelo de linguagem|as an ai|as a language model)\b/ },
]);

export interface TurnBudget {
	maxQuestionsPerMessage: 1;
	maxQuestionStreak: 2;
	maxConversationalQuestionsPerNode: 3;
	maxSocraticRounds: 2;
	maxWords: Readonly<Record<BudgetPhase, number>>;
	bannedPhrases: readonly BannedPhrase[];
}

export const TURN_BUDGET: Readonly<TurnBudget> = Object.freeze({
	maxQuestionsPerMessage: 1,
	maxQuestionStreak: 2,
	maxConversationalQuestionsPerNode: 3,
	maxSocraticRounds: 2,
	maxWords: WORD_BUDGETS,
	bannedPhrases: BANNED_PHRASES,
});

// ─── History ────────────────────────────────────────────────────────────────

/** One earlier tutor turn of the CURRENT node. */
export interface PriorTurn {
	phase: BudgetPhase;
	/** prose = narration/feedback; check = conversational card; practice = practice/warm-up item card. */
	kind: "prose" | "check" | "practice";
	/** Questions addressed to the learner in that turn. */
	questions: number;
	endedWithQuestion: boolean;
	/** A Socratic round (question at the same point). */
	socratic?: boolean;
}

export interface BudgetHistory {
	turns: readonly PriorTurn[];
	/**
	 * Conversational questions of turns already evicted by HISTORY_CAP. The
	 * per-node budget must survive the cap: a long lesson (many practice
	 * cards, feedback and hints) would otherwise "forget" the prediction asked
	 * 60 turns ago and allow a 4th check. Absent = 0.
	 */
	evictedQuestions?: number;
}

export const EMPTY_HISTORY: BudgetHistory = Object.freeze({ turns: Object.freeze([]) as readonly PriorTurn[] });

/** History keeps the last turns only (streak and Socratic rounds look at the tail); evicted questions are carried in `evictedQuestions`. */
export const HISTORY_CAP = 64;

export function describeProseTurn(text: string, phase: BudgetPhase): PriorTurn {
	return { phase, kind: "prose", questions: countQuestions(text), endedWithQuestion: endsWithQuestion(text) };
}

function conversationalQuestionsOf(turns: readonly PriorTurn[]): number {
	return turns.reduce((sum, t) => sum + (t.kind === "practice" ? 0 : t.questions), 0);
}

export function appendTurn(history: BudgetHistory, turn: PriorTurn): BudgetHistory {
	const turns = [...history.turns, turn];
	const evictedBefore = history.evictedQuestions ?? 0;
	if (turns.length <= HISTORY_CAP) return evictedBefore > 0 ? { turns, evictedQuestions: evictedBefore } : { turns };
	const evicted = turns.slice(0, turns.length - HISTORY_CAP);
	const evictedQuestions = evictedBefore + conversationalQuestionsOf(evicted);
	return { turns: turns.slice(-HISTORY_CAP), ...(evictedQuestions > 0 ? { evictedQuestions } : {}) };
}

/** Trailing tutor turns ending in a question; a practice turn breaks the streak. */
export function questionStreak(history: BudgetHistory): number {
	let streak = 0;
	for (let i = history.turns.length - 1; i >= 0; i--) {
		const turn = history.turns[i];
		if (!turn || turn.kind === "practice" || !turn.endedWithQuestion) break;
		streak++;
	}
	return streak;
}

/** Conversational questions already spent in this node (prose questions outside practice + check cards), evicted turns included. */
export function conversationalQuestions(history: BudgetHistory): number {
	return (history.evictedQuestions ?? 0) + conversationalQuestionsOf(history.turns);
}

/** Socratic rounds already spent at the current point (trailing socratic turns). */
export function socraticRounds(history: BudgetHistory): number {
	let rounds = 0;
	for (let i = history.turns.length - 1; i >= 0; i--) {
		const turn = history.turns[i];
		if (!turn) break;
		if (turn.socratic) rounds++;
		else if (turn.kind !== "prose" || turn.questions > 0) break;
	}
	return rounds;
}

export function questionsLeft(history: BudgetHistory, budget: TurnBudget = TURN_BUDGET): number {
	return Math.max(0, budget.maxConversationalQuestionsPerNode - conversationalQuestions(history));
}

// ─── Validator ──────────────────────────────────────────────────────────────

export type BudgetViolationCode =
	| "too_long"
	| "too_many_questions"
	| "mid_prose_question"
	| "question_forbidden"
	| "question_streak"
	| "node_question_budget"
	| "socratic_rounds"
	| "filler_check"
	| "performative_praise"
	| "meta_narration";

export interface BudgetViolation {
	code: BudgetViolationCode;
	/** pt-BR, for logs and telemetry (never shown mid-lesson). */
	message: string;
	limit?: number;
	actual?: number;
	/** The offending fragment, for banned phrases. */
	match?: string;
	phraseId?: string;
}

export interface BudgetOptions {
	/** The orchestrator's own permission for a prose question in this turn (default: the phase policy). */
	questionAllowed?: boolean;
	/** This turn is a Socratic round (counts against maxSocraticRounds). */
	socratic?: boolean;
	budget?: TurnBudget;
}

function bannedPhraseViolations(text: string, budget: TurnBudget): BudgetViolation[] {
	const folded = foldText(learnerDirectedText(text));
	const out: BudgetViolation[] = [];
	for (const phrase of budget.bannedPhrases) {
		const m = phrase.pattern.exec(folded);
		if (!m) continue;
		const label = phrase.kind === "filler_check" ? "checagem vazia de compreensão" : phrase.kind === "performative_praise" ? "elogio performático" : "meta-narração da aula";
		out.push({ code: phrase.kind, message: `${label}: "${m[0].trim()}"`, match: m[0].trim(), phraseId: phrase.id });
	}
	return out;
}

/**
 * Every budget rule the message breaks (empty = OK). `history` holds the
 * node's earlier tutor turns (not including this one).
 */
export function violatesBudget(text: string, phase: BudgetPhase, history: BudgetHistory = EMPTY_HISTORY, options: BudgetOptions = {}): BudgetViolation[] {
	const budget = options.budget ?? TURN_BUDGET;
	const violations: BudgetViolation[] = [];

	const words = countWords(text);
	const maxWords = budget.maxWords[phase];
	if (words > maxWords) {
		violations.push({ code: "too_long", message: `${words} palavras; o limite da fase "${phase}" é ${maxWords}`, limit: maxWords, actual: words });
	}

	const questions = countQuestions(text);
	if (questions > budget.maxQuestionsPerMessage) {
		violations.push({ code: "too_many_questions", message: `${questions} perguntas numa só mensagem; o limite é ${budget.maxQuestionsPerMessage}`, limit: budget.maxQuestionsPerMessage, actual: questions });
	}
	if (questions > 0 && hasMidProseQuestion(text)) {
		violations.push({ code: "mid_prose_question", message: "pergunta no meio da prosa; se houver pergunta, ela fecha a mensagem" });
	}
	const allowed = options.questionAllowed ?? QUESTION_PHASES.has(phase);
	if (questions > 0 && !allowed) {
		violations.push({ code: "question_forbidden", message: `a fase "${phase}" não faz perguntas na prosa (perguntas chegam como cartões)`, limit: 0, actual: questions });
	}
	if (endsWithQuestion(text) && phase !== "practice") {
		const streak = questionStreak(history) + 1;
		if (streak > budget.maxQuestionStreak) {
			violations.push({ code: "question_streak", message: `${streak} turnos seguidos terminando em pergunta; o limite é ${budget.maxQuestionStreak}`, limit: budget.maxQuestionStreak, actual: streak });
		}
	}
	if (questions > 0 && phase !== "practice") {
		const total = conversationalQuestions(history) + questions;
		if (total > budget.maxConversationalQuestionsPerNode) {
			violations.push({
				code: "node_question_budget",
				message: `${total} perguntas conversacionais neste nó; o limite é ${budget.maxConversationalQuestionsPerNode}`,
				limit: budget.maxConversationalQuestionsPerNode,
				actual: total,
			});
		}
	}
	const socratic = options.socratic ?? false;
	if (socratic && questions > 0) {
		const rounds = socraticRounds(history) + 1;
		if (rounds > budget.maxSocraticRounds) {
			violations.push({ code: "socratic_rounds", message: `${rounds} rodadas socráticas no mesmo ponto; o limite é ${budget.maxSocraticRounds}`, limit: budget.maxSocraticRounds, actual: rounds });
		}
	}

	violations.push(...bannedPhraseViolations(text, budget));
	return violations;
}

const FIX_INSTRUCTIONS: Readonly<Record<BudgetViolationCode, (v: BudgetViolation) => string>> = Object.freeze({
	too_long: (v) => `Cut the message to at most ${v.limit} words (now ${v.actual}). Keep the substance, drop restatements and optional sentences.`,
	too_many_questions: () => "Keep at most ONE question addressed to the learner; turn the others into statements.",
	mid_prose_question: () => "Do not ask in the middle of the prose. Rephrase rhetorical questions as statements (\"The natural question is why…\"); a question, if any, is the final sentence.",
	question_forbidden: () => "This message must not ask the learner anything: questions arrive as separate UI cards. End with a statement.",
	question_streak: () => "The previous tutor turns already ended in questions. End this one with a statement.",
	node_question_budget: () => "The conversational-question budget of this lesson is spent. End with a statement and ask nothing.",
	socratic_rounds: () => "The Socratic rounds are spent. Explain the step directly instead of asking again.",
	filler_check: (v) => `Remove the filler comprehension check ("${v.match}"). Never ask whether it makes sense or was understood.`,
	performative_praise: (v) => `Remove the performative praise ("${v.match}"). At most one short clause of SPECIFIC acknowledgment is allowed.`,
	meta_narration: (v) => `Remove the meta-narration ("${v.match}"). Never describe the lesson's structure, phases, scoring or learner model.`,
});

/** English rewrite brief for the single cheap rewrite (role `cheap`/rubric), one line per violation. */
export function rewriteInstructions(violations: readonly BudgetViolation[], phase: BudgetPhase): string {
	const lines = [...new Set(violations.map((v) => `- ${FIX_INSTRUCTIONS[v.code](v)}`))];
	return [
		`Rewrite the tutor message below for the "${phase}" step. Fix ONLY these problems; keep the language, facts, numbers, LaTeX and Markdown unchanged:`,
		...lines,
		"Return only the rewritten message.",
	].join("\n");
}
