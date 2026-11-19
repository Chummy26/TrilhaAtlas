/**
 * TurnBudget validator (docs/impl/lesson.md; SÍNTESE §1.2 P5, §1.3 word
 * budgets; r1 §6.4, §6.13, §7.1): each rule is caught, clean text passes,
 * quoted target-language examples are not questions to the learner.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fc from "fast-check";
import {
	appendTurn,
	BANNED_PHRASES,
	conversationalQuestions,
	describeProseTurn,
	EMPTY_HISTORY,
	HISTORY_CAP,
	questionsLeft,
	questionStreak,
	rewriteInstructions,
	socraticRounds,
	violatesBudget,
	WORD_BUDGETS,
	type BudgetHistory,
	type BudgetViolationCode,
	type PriorTurn,
} from "../src/core/lesson/budget.ts";

const codes = (text: string, ...args: Parameters<typeof violatesBudget> extends [string, ...infer R] ? R : never) =>
	violatesBudget(text, ...args).map((v) => v.code);

const history = (...turns: PriorTurn[]): BudgetHistory => turns.reduce(appendTurn, EMPTY_HISTORY);
const asked = (kind: PriorTurn["kind"] = "prose", extra: Partial<PriorTurn> = {}): PriorTurn => ({ phase: "explain", kind, questions: 1, endedWithQuestion: true, ...extra });
const words = (n: number) => Array.from({ length: n }, (_, i) => `palavra${i}`).join(" ") + ".";

describe("violatesBudget: one rule at a time", () => {
	test("clean prose passes", () => {
		assert.deepEqual(violatesBudget("Em série existe um único caminho para a carga. Por isso a corrente é a mesma.", "explain"), []);
	});

	test("too_long uses the phase word budget", () => {
		assert.deepEqual(codes(words(90), "orient"), []);
		const v = violatesBudget(words(91), "orient");
		assert.deepEqual(v.map((x) => x.code), ["too_long"]);
		assert.equal(v[0]?.limit, 90);
		assert.equal(v[0]?.actual, 91);
		assert.deepEqual(codes(words(36), "hint"), ["too_long"]);
		assert.deepEqual(codes(words(51), "feedback"), ["too_long"]);
		assert.deepEqual(codes(words(61), "recap"), ["too_long"]);
		assert.deepEqual(codes(words(251), "explain"), ["too_long"]);
		assert.equal(WORD_BUDGETS.orient, 90);
	});

	test("too_many_questions: at most one question per message", () => {
		assert.ok(codes("Qual é a corrente? E a tensão?", "explain").includes("too_many_questions"));
	});

	test("mid_prose_question: a question must close the message", () => {
		assert.deepEqual(codes("Por que isso acontece? Porque o caminho é único.", "explain"), ["mid_prose_question"]);
		assert.deepEqual(codes("O caminho é único. O que acontece com a corrente?", "explain"), []);
	});

	test("question_forbidden: phases that ask only through cards", () => {
		assert.deepEqual(codes("Some as resistências. Qual é o total?", "worked"), ["question_forbidden"]);
		assert.deepEqual(codes("O caminho é único. O que acontece?", "explain", EMPTY_HISTORY, { questionAllowed: false }), ["question_forbidden"]);
	});

	test("question_streak: ≤2 consecutive turns ending in a question", () => {
		const h = history(asked(), asked());
		assert.ok(codes("A carga segue. E agora?", "explain", h).includes("question_streak"));
		assert.equal(questionStreak(history(asked(), asked("practice"), asked())), 1, "a practice card breaks the streak");
	});

	test("node_question_budget: ≤3 conversational questions per node", () => {
		const h = history(asked("check", { endedWithQuestion: true }), describeProseTurn("Texto.", "explain"), asked("check"), describeProseTurn("Texto.", "explain"), asked("check"));
		assert.equal(conversationalQuestions(h), 3);
		assert.equal(questionsLeft(h), 0);
		assert.ok(codes("Uma explicação. Qual é a próxima?", "explain", h).includes("node_question_budget"));
		assert.equal(conversationalQuestions(history(asked("practice"), asked("practice"))), 0, "practice cards do not spend the budget");
	});

	test("socratic_rounds: ≤2 rounds at the same point", () => {
		const h = history(asked("check", { socratic: true }), { phase: "feedback", kind: "prose", questions: 0, endedWithQuestion: false }, asked("check", { socratic: true }));
		assert.equal(socraticRounds(h), 2);
		assert.ok(codes("Pense de novo: o que muda?", "explain", h, { socratic: true }).includes("socratic_rounds"));
	});

	const banned: Array<[string, BudgetViolationCode]> = [
		["O caminho é único. Faz sentido?", "filler_check"],
		["A corrente é a mesma. Entendeu?", "filler_check"],
		["Isso ficou claro?", "filler_check"],
		["Alguma dúvida?", "filler_check"],
		["Podemos continuar?", "filler_check"],
		["A corrente é a mesma, certo?", "filler_check"],
		["The path is unique. Does that make sense?", "filler_check"],
		["Got it?", "filler_check"],
		["Do you understand the rule", "filler_check"],
		["Is that clear to you", "filler_check"],
		["Any questions?", "filler_check"],
		["Ready to move on", "filler_check"],
		["Ótima pergunta! A corrente é a mesma.", "performative_praise"],
		["Boa pergunta: a corrente é a mesma.", "performative_praise"],
		["Great question. The current is the same.", "performative_praise"],
		["Parabéns! Está certo.", "performative_praise"],
		["Great job! That is right.", "performative_praise"],
		["Certo 🎉", "performative_praise"],
		["Nesta seção vamos ver a lei de Ohm.", "meta_narration"],
		["Na próxima etapa você pratica.", "meta_narration"],
		["Este ponto de conhecimento trata de série.", "meta_narration"],
		["In this section we look at Ohm's law.", "meta_narration"],
		["Como uma IA, eu calculei o valor.", "meta_narration"],
		["A seguir veremos a lei de Kirchhoff.", "meta_narration"],
		["Nesta aula o foco é a série.", "meta_narration"],
		["Now we will look at Kirchhoff's law.", "meta_narration"],
		["A corrente vale 2 mA. Espera, são 3 mA.", "meta_narration"],
		["Isso mesmo! A corrente é a mesma.", "performative_praise"],
	];
	for (const [text, code] of banned) {
		test(`${code}: ${JSON.stringify(text)}`, () => {
			const v = violatesBudget(text, "explain").filter((x) => x.code === code);
			assert.equal(v.length, 1, JSON.stringify(violatesBudget(text, "explain")));
			assert.ok(v[0]?.match && v[0].phraseId);
		});
	}

	test("physics words are not meta-narration", () => {
		assert.deepEqual(codes("Nesta fase do ciclo o capacitor descarrega.", "explain"), []);
		assert.deepEqual(codes("O circuito espera, sem pressa, a carga completa do capacitor.", "explain"), []);
		assert.deepEqual(codes("Isso mesmo vale para a corrente: ela é igual nos dois resistores.", "explain"), []);
	});

	test("quoted target-language examples are content, not questions", () => {
		const text = 'Em inglês, a pergunta "Have you ever been there?" usa o present perfect. A forma "Got it?" é informal.';
		assert.deepEqual(codes(text, "worked"), []);
		assert.deepEqual(codes("> Does that make sense?\n\nEssa frase é comum em reuniões.", "worked"), []);
	});

	test("math and code count as single words", () => {
		assert.deepEqual(codes("A relação é $V = R \\cdot I$ e vale sempre.", "hint"), []);
	});
});

describe("properties", () => {
	test("deterministic and every rule reported at most once", () => {
		fc.assert(
			fc.property(fc.string({ maxLength: 400 }), fc.constantFrom(...(Object.keys(WORD_BUDGETS) as Array<keyof typeof WORD_BUDGETS>)), (text, phase) => {
				const a = violatesBudget(text, phase);
				assert.deepEqual(violatesBudget(text, phase), a);
				const structural = a.filter((v) => !["filler_check", "performative_praise", "meta_narration"].includes(v.code)).map((v) => v.code);
				assert.equal(new Set(structural).size, structural.length);
			}),
			{ numRuns: 300 },
		);
	});

	test("questionless text within budget never violates the question rules", () => {
		fc.assert(
			fc.property(fc.array(fc.constantFrom("a", "corrente", "resistor", "série", "é", "mesma", "."), { maxLength: 40 }), (tokens) => {
				const v = violatesBudget(tokens.join(" "), "explain", history(asked(), asked()));
				assert.deepEqual(v, []);
			}),
		);
	});

	test("history is capped", () => {
		let h = EMPTY_HISTORY;
		for (let i = 0; i < HISTORY_CAP + 10; i++) h = appendTurn(h, describeProseTurn("Texto.", "explain"));
		assert.equal(h.turns.length, HISTORY_CAP);
	});

	test("the per-node question budget survives the history cap", () => {
		// Three checks early in a long lesson, then many practice cards and
		// feedback turns: the early checks leave the window but still count.
		let h = EMPTY_HISTORY;
		for (let i = 0; i < 3; i++) h = appendTurn(h, { phase: "predict", kind: "check", questions: 1, endedWithQuestion: true });
		for (let i = 0; i < HISTORY_CAP * 2; i++) {
			h = appendTurn(h, { phase: "practice", kind: "practice", questions: 1, endedWithQuestion: true });
			h = appendTurn(h, describeProseTurn("A soma das resistências dá o total.", "feedback"));
		}
		assert.equal(h.turns.length, HISTORY_CAP);
		assert.equal(conversationalQuestions(h), 3);
		const late = codes("Por que a corrente é a mesma nos dois resistores?", "recap", h);
		assert.ok(late.includes("node_question_budget"), late.join());
		assert.equal(questionsLeft(h), 0);
	});

	test("property: conversationalQuestions is invariant under the cap", () => {
		const turnArb = fc.record({
			phase: fc.constantFrom("explain" as const, "practice" as const, "feedback" as const),
			kind: fc.constantFrom("prose" as const, "check" as const, "practice" as const),
			questions: fc.integer({ min: 0, max: 2 }),
			endedWithQuestion: fc.boolean(),
		});
		fc.assert(
			fc.property(fc.array(turnArb, { maxLength: 200 }), (turns) => {
				const h = turns.reduce((acc, t) => appendTurn(acc, t), EMPTY_HISTORY);
				const expected = turns.reduce((sum, t) => sum + (t.kind === "practice" ? 0 : t.questions), 0);
				assert.equal(conversationalQuestions(h), expected);
				assert.ok(h.turns.length <= HISTORY_CAP);
			}),
		);
	});

	test("every banned phrase id is unique", () => {
		assert.equal(new Set(BANNED_PHRASES.map((p) => p.id)).size, BANNED_PHRASES.length);
	});
});

describe("rewriteInstructions", () => {
	test("one English line per violated rule, deduplicated", () => {
		const v = violatesBudget(`${words(100)} Faz sentido?`, "orient");
		const brief = rewriteInstructions([...v, ...v], "orient");
		assert.match(brief, /Rewrite the tutor message/);
		assert.match(brief, /at most 90 words/);
		assert.match(brief, /filler comprehension check/);
		assert.equal(brief.split("\n").filter((l) => l.startsWith("- ")).length, new Set(v.map((x) => x.code)).size);
	});
});
