/**
 * LessonPlan compiler and client projections (docs/impl/lesson.md; SÍNTESE
 * §1.3, §2.4(b); P7 "o gabarito fica congelado no servidor"): validation,
 * key split, deterministic shuffle, pass rule, and no key leakage.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fc from "fast-check";
import {
	compileLessonPlan,
	DEFAULT_PASS_RULE,
	formatPlanIssues,
	kpExhausted,
	passRuleSatisfied,
	planItems,
	kpCanStillPass,
	optionLabel,
	stableShuffle,
	toClientItem,
	toClientLessonOutline,
} from "../src/core/lesson/protocol.ts";
import { assertNoKeyMaterial, compiledPlan, mcqDraft, NODE_ID, numericDraft, SECRET, seriesDraft } from "./lesson-fixtures.ts";

function issuesOf(draft: unknown): string[] {
	const r = compileLessonPlan(draft, { nodeId: NODE_ID });
	assert.equal(r.ok, false, "expected the draft to be rejected");
	return r.ok ? [] : r.issues.map((i) => `${i.path}: ${i.message}`);
}

describe("compileLessonPlan", () => {
	test("the fixture compiles and every item has a key", () => {
		const plan = compiledPlan();
		assert.equal(plan.schemaVersion, 1);
		assert.equal(plan.domainId, "electronics");
		const refs = planItems(plan);
		assert.equal(refs.length, Object.keys(plan.answerKeys).length);
		for (const ref of refs) assert.equal(plan.answerKeys[ref.item.id]?.itemId, ref.item.id);
		assert.deepEqual(plan.knowledgePoints[0]?.passRule, DEFAULT_PASS_RULE);
	});

	test("numeric answers are normalized to SI base units; requireUnit defaults", () => {
		const plan = compiledPlan();
		const faded = plan.answerKeys["kp1.faded"];
		assert.equal(faded?.answer.kind === "numeric" && faded.answer.value, 6900);
		assert.equal(faded?.answer.kind === "numeric" && faded.answer.unit, "Ω");
		const bug = plan.answerKeys["kp1.i2"];
		assert.deepEqual(bug?.answer.kind === "numeric" && bug.answer.buggy, [{ value: 500, misconceptionId: "m.parallel_sum" }]);
		const kp1Blank = plan.knowledgePoints[0]?.fadedSteps.blank;
		assert.equal(kp1Blank?.kind === "numeric" && kp1Blank.requireUnit, true);
		const kp2Blank = plan.knowledgePoints[1]?.fadedSteps.blank;
		assert.equal(kp2Blank?.kind === "numeric" && kp2Blank.requireUnit, false);
	});

	test("choice options lose the correct flag, are shuffled deterministically, and keys keep distractors", () => {
		const a = compiledPlan();
		const b = compiledPlan();
		const item = a.knowledgePoints[0]?.items[2];
		assert.ok(item?.kind === "mcq");
		assert.deepEqual(item, b.knowledgePoints[0]?.items[2]);
		const servedId = (text: string) => item.options.find((o) => o.text === text)?.id;
		const key = a.answerKeys["kp1.i3"];
		assert.ok(key?.answer.kind === "choice");
		assert.equal(key.answer.correctOptionId, servedId("aumentar"));
		assert.deepEqual(key.answer.distractors, { [servedId("diminuir") ?? "?"]: "m.parallel_sum" });
	});

	test("served option ids are display labels a, b, c…: authored ids never reach the client", () => {
		const draft = seriesDraft();
		draft.knowledgePoints[0].items[2] = mcqDraft("kp1.i3", "Em série, acrescentar mais um resistor faz R_eq:", 2, [
			["certa", "aumentar", true],
			["errada1", "diminuir", false, "m.parallel_sum"],
			["errada2", "ficar igual", false],
		]);
		const plan = compiledPlan(draft);
		for (const ref of planItems(plan)) {
			if (ref.item.kind !== "mcq" && ref.item.kind !== "minimal_pair") continue;
			assert.deepEqual(
				ref.item.options.map((o) => o.id),
				ref.item.options.map((_, i) => optionLabel(i)),
				`${ref.item.id}: ids are positional labels`,
			);
		}
		const client = JSON.stringify(planItems(plan).map((r) => toClientItem(r.item)));
		for (const authored of ["certa", "errada1", "errada2", '"up"', '"down"']) assert.ok(!client.includes(authored), `authored id ${authored} leaked`);
		const spec = plan.answerKeys["kp1.i3"]?.answer;
		assert.ok(spec?.kind === "choice");
		const item = plan.knowledgePoints[0]?.items[2];
		assert.ok(item?.kind === "mcq");
		assert.equal(item.options.find((o) => o.id === spec.correctOptionId)?.text, "aumentar");
		assert.equal(item.options.find((o) => spec.distractors[o.id] === "m.parallel_sum")?.text, "diminuir");
	});

	test("the shuffle seed is not computable from public fields: the correct option lands on every position", () => {
		// The model habitually writes the correct option first. With a seed made
		// of public data (the id) anyone could undo the permutation; the seed
		// includes the server-only hints/solution, and over many items the
		// correct option is spread over all positions.
		const positions = new Set<string>();
		for (let n = 0; n < 60; n++) {
			const draft = seriesDraft();
			const authored = mcqDraft("kp1.i3", "Em série, acrescentar mais um resistor faz R_eq:", 2, [
				["a", "aumentar", true],
				["b", "diminuir", false],
				["c", "ficar igual", false],
			]);
			authored.solution = [`Some as resistências (variante ${n}).`];
			draft.knowledgePoints[0].items[2] = authored;
			const key = compiledPlan(draft).answerKeys["kp1.i3"];
			if (key?.answer.kind === "choice") positions.add(key.answer.correctOptionId);
		}
		assert.deepEqual([...positions].sort(), ["a", "b", "c"]);
	});

	test("the first segment resolves the prediction when none does (warning)", () => {
		const draft = seriesDraft();
		draft.segments[0].resolvesPrediction = false;
		const r = compileLessonPlan(draft);
		assert.ok(r.ok);
		assert.equal(r.plan.segments[0]?.resolvesPrediction, true);
		assert.equal(r.warnings.length, 1);
	});

	const broken: Array<[string, (d: Record<string, any>) => void, RegExp]> = [
		["wrong node", (d) => (d.nodeId = "ee.other"), /expected "ee\.dc\.series-resistors"/],
		["duplicate item ids", (d) => (d.knowledgePoints[0].items[1].id = "kp1.i1"), /duplicate item id/],
		["two correct options", (d) => (d.knowledgePoints[0].items[2].options[1].correct = true), /exactly one option/],
		["undeclared misconception", (d) => (d.knowledgePoints[0].items[2].options[1].misconceptionId = "m.ghost"), /not declared/],
		["unknown unit", (d) => (d.knowledgePoints[0].items[0].answer.unit = "kX"), /unrecognized unit/],
		["answerUnit of another quantity", (d) => (d.knowledgePoints[1].items[1].answerUnit = "mV"), /answerUnit/],
		["zero target without abs tolerance", (d) => (d.knowledgePoints[0].items[0].answer.value = 0), /absolute tolerance/],
		["hint above 35 words", (d) => (d.knowledgePoints[0].items[0].hints[0] = Array.from({ length: 45 }, () => "palavra").join(" ")), /hint has 45 words/],
		["segment too short", (d) => (d.segments[1].body = "Curto demais."), /write at least 120/],
		["two socratic segments", (d) => (d.segments[1].socratic = { item: mcqDraft("soc2", "?", 1, [["a", "A", true], ["b", "B", false]]), maxRounds: 1 }), /at most one segment/],
		["prediction that is not a choice", (d) => (d.prediction = numericDraft("pred", "Quanto?", 1, 1, "V")), /one-tap choice/],
		["selfExplanation on an unknown KP", (d) => (d.selfExplanation.kpId = "kp9"), /unknown knowledge point/],
		["selfExplanation step outside the example", (d) => (d.selfExplanation.stepIndex = 7), /outside the worked example/],
		["only one KP", (d) => d.knowledgePoints.pop(), /2–4 knowledge points/],
		["one item in a KP", (d) => d.knowledgePoints[0].items.splice(1), /2–5 items/],
		["recap above 60 words", (d) => (d.recap.bullets = [Array.from({ length: 70 }, () => "palavra").join(" "), "outra"]), /the recap has/],
		["unknown keys are rejected", (d) => (d.surprise = true), /surprise|Unrecognized/i],
		["passRule larger than the pool", (d) => (d.knowledgePoints[0].passRule = { lastNCorrect: 5, window: 5, minInWindow: 5, maxItems: 5 }), /pool/],
		["passRule whose minInWindow exceeds the pool", (d) => (d.knowledgePoints[0].passRule = { lastNCorrect: 1, window: 5, minInWindow: 5, maxItems: 5 }), /pool \(4\) is smaller than the 5 items/],
		["passRule whose minInWindow exceeds maxItems", (d) => (d.knowledgePoints[0].passRule = { lastNCorrect: 1, window: 4, minInWindow: 4, maxItems: 3 }), /maxItems must allow 4 items/],
		[
			"prediction with more than 4 options",
			(d) =>
				(d.prediction = mcqDraft("pred", "O que acontece?", 1, [
					["a", "A", true],
					["b", "B", false],
					["c", "C", false],
					["d", "D", false],
					["e", "E", false],
				])),
			/at most 4 options/,
		],
	];
	for (const [name, mutate, pattern] of broken) {
		test(`rejects: ${name}`, () => {
			const draft = seriesDraft();
			mutate(draft);
			const issues = issuesOf(draft);
			assert.ok(issues.some((i) => pattern.test(i)), issues.join("\n"));
		});
	}

	test("formatPlanIssues produces one line per issue", () => {
		const draft = seriesDraft();
		draft.knowledgePoints[0].items[0].answer.unit = "kX";
		draft.knowledgePoints[0].items[1].id = "kp1.i1";
		const r = compileLessonPlan(draft);
		assert.ok(!r.ok);
		assert.equal(formatPlanIssues(r.issues).split("\n").length, r.issues.length);
	});
});

describe("pass rule (MA-like)", () => {
	test("order matters: ✗✗✓✓ passes, ✓✓✗✗ does not", () => {
		assert.equal(passRuleSatisfied([false, false, true, true], DEFAULT_PASS_RULE), true);
		assert.equal(passRuleSatisfied([true, true, false, false], DEFAULT_PASS_RULE), false);
		assert.equal(passRuleSatisfied([true, true], DEFAULT_PASS_RULE), true);
		assert.equal(passRuleSatisfied([true], DEFAULT_PASS_RULE), false);
		assert.equal(passRuleSatisfied([true, false, true], DEFAULT_PASS_RULE), false);
	});

	test("property: passing ⇔ last two correct (default rule)", () => {
		fc.assert(
			fc.property(fc.array(fc.boolean(), { maxLength: 8 }), (results) => {
				const lastTwo = results.length >= 2 && results.slice(-2).every(Boolean);
				assert.equal(passRuleSatisfied(results, DEFAULT_PASS_RULE), lastTwo);
			}),
		);
	});

	test("kpExhausted: item budget or pool", () => {
		assert.equal(kpExhausted(5, 9, DEFAULT_PASS_RULE), true);
		assert.equal(kpExhausted(4, 4, DEFAULT_PASS_RULE), true);
		assert.equal(kpExhausted(3, 4, DEFAULT_PASS_RULE), false);
	});

	test("kpExhausted: a KP that can no longer pass is exhausted before its budget runs out", () => {
		// ✗✗✗ with one item left: even a correct answer leaves ✗✗✗✓ (not two in a row).
		assert.equal(kpExhausted(3, 4, DEFAULT_PASS_RULE, [false, false, false]), true);
		// ✓✗✓ with one item left: ✓✗✓✓ passes, so the item is still worth posing.
		assert.equal(kpExhausted(3, 4, DEFAULT_PASS_RULE, [true, false, true]), false);
		assert.equal(kpExhausted(4, 9, DEFAULT_PASS_RULE, [false, false, false, false]), true, "maxItems 5: one item left cannot make two in a row");
		assert.equal(kpExhausted(3, 9, DEFAULT_PASS_RULE, [false, false, false]), false, "two items left can still end ✓✓");
	});

	test("property: kpCanStillPass ⇔ some completion of the remaining items passes", () => {
		fc.assert(
			fc.property(fc.array(fc.boolean(), { maxLength: 5 }), fc.integer({ min: 0, max: 4 }), (results, remaining) => {
				let any = passRuleSatisfied(results, DEFAULT_PASS_RULE);
				for (let mask = 0; mask < 1 << remaining && !any; mask++) {
					const tail = Array.from({ length: remaining }, (_, i) => ((mask >> i) & 1) === 1);
					for (let k = 0; k <= remaining && !any; k++) any = passRuleSatisfied([...results, ...tail.slice(0, k)], DEFAULT_PASS_RULE);
				}
				assert.equal(kpCanStillPass(results, remaining, DEFAULT_PASS_RULE), any);
			}),
		);
	});

	test("minInWindow is not relaxed by a short history", () => {
		const rule = { lastNCorrect: 1, window: 3, minInWindow: 2, maxItems: 5 };
		assert.equal(passRuleSatisfied([true], rule), false, "one correct answer is not ≥2 of the last 3");
		assert.equal(passRuleSatisfied([true, true], rule), true);
		assert.equal(passRuleSatisfied([false, true], rule), false);
	});
});

describe("no key leakage in client projections", () => {
	test("every item projection and the outline are key-free", () => {
		const plan = compiledPlan();
		for (const ref of planItems(plan)) assertNoKeyMaterial(toClientItem(ref.item), ref.item.id);
		assertNoKeyMaterial(toClientLessonOutline(plan), "outline");
	});

	test("property: secrets injected anywhere in answer fields never reach toClientItem", () => {
		fc.assert(
			fc.property(fc.string({ minLength: 1, maxLength: 12 }).filter((s) => /\S/.test(s)), (noise) => {
				const marker = `${SECRET}${noise.replace(/\s/g, "_")}`;
				const draft = seriesDraft();
				for (const kp of draft.knowledgePoints) {
					for (const item of [...kp.items, kp.fadedSteps.blank]) {
						item.hints = [marker, marker, marker];
						item.solution = [marker];
						if (item.answer && "reference" in item.answer) item.answer.reference = marker;
					}
				}
				const r = compileLessonPlan(draft);
				assert.ok(r.ok, !r.ok ? formatPlanIssues(r.issues) : "");
				for (const ref of planItems(r.plan)) assert.ok(!JSON.stringify(toClientItem(ref.item)).includes(SECRET));
			}),
			{ numRuns: 40 },
		);
	});

	test("stableShuffle is a deterministic permutation", () => {
		fc.assert(
			fc.property(fc.uniqueArray(fc.integer(), { maxLength: 10 }), fc.string(), (values, seed) => {
				const out = stableShuffle(values, seed);
				assert.deepEqual([...out].sort((a, b) => a - b), [...values].sort((a, b) => a - b));
				assert.deepEqual(stableShuffle(values, seed), out);
			}),
		);
	});
});
