/**
 * Prompt templates and the server-side prompt requests (docs/impl/lesson.md;
 * SÍNTESE §2.4(b)(c); P7): every template placeholder is provided by its
 * builder, headers never reach the model, the answer-leak guard works.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
	describeItem,
	fillTemplate,
	formatAnswer,
	graderRequest,
	LESSON_PROMPTS,
	planRequest,
	renderRequest,
	revealsAnswer,
	templateBody,
	templateVariables,
	type LessonPromptName,
	type PromptRequest,
} from "../src/core/lesson/payloads.ts";
import { lessonItem, type LessonEffect } from "../src/core/lesson/orchestrator.ts";
import { compiledPlan, LessonDriver, NODE_ID, numericDraft, SECRET, seriesDraft, warmupItem } from "./lesson-fixtures.ts";

const PROMPT_DIR = new URL("../src/agent/prompts/lesson/", import.meta.url);
const template = (name: LessonPromptName) => readFileSync(new URL(`${name}.md`, PROMPT_DIR), "utf8");

function assertFills(req: PromptRequest): string {
	const filled = fillTemplate(template(req.template), req.variables);
	assert.ok(!/\{\{\s*\w+\s*\}\}/.test(filled), `${req.template}: unfilled placeholder`);
	assert.ok(!filled.includes("<!--"), `${req.template}: header comment leaked into the prompt`);
	return filled;
}

/** A finished lesson with renders of every kind (hint, feedback, solution, remediation, recap…). */
function richRun(): { d: LessonDriver; renders: Array<{ state: LessonDriver["state"]; effect: Extract<LessonEffect, { type: "render_phase" }> }> } {
	const d = new LessonDriver();
	const captured: Array<{ state: LessonDriver["state"]; effect: Extract<LessonEffect, { type: "render_phase" }> }> = [];
	const original = d.dispatch.bind(d);
	d.dispatch = (event) => {
		const effects = original(event);
		for (const e of effects) if (e.type === "render_phase") captured.push({ state: d.state, effect: e });
		return effects;
	};
	d.start();
	d.ready(compiledPlan(), [warmupItem()]);
	for (let guard = 0; guard < 80 && d.state.status === "active"; guard++) {
		const id = d.pump();
		if (!id) break;
		if (id === "kp1.i1") {
			d.dispatch({ type: "hint_requested", at: d.now, itemId: id });
			d.ack();
			d.answerWrong();
			d.pump();
			d.answerCorrect();
		} else if (id === "kp2.i1") {
			d.answerWrong({ misconceptionId: "m.current_consumed" });
			d.pump();
			d.answerWrong({ misconceptionId: "m.current_consumed" });
		} else {
			d.answerCorrect();
		}
	}
	return { d, renders: captured };
}

describe("prompt files", () => {
	for (const name of LESSON_PROMPTS) {
		test(`${name}.md has a maintainer header and is written for the model in English`, () => {
			const text = template(name);
			assert.match(text, /^<!--[\s\S]*?-->/);
			assert.match(text, /docs\/research\/00-SINTESE\.md/);
			assert.ok(templateVariables(text).includes(name === "grader" ? "context" : "lang"));
			assert.ok(templateBody(text).length > 500);
		});
	}
});

describe("fillTemplate", () => {
	test("throws on missing variables and strips the header", () => {
		assert.throws(() => fillTemplate("<!-- {{x}} -->\nHi {{name}} {{other}}", { name: "a" }), /other/);
		assert.equal(fillTemplate("<!-- {{x}} -->\nHi {{ name }}", { name: "Ana" }), "Hi Ana");
	});
});

describe("render requests cover every template variable", () => {
	const { d, renders } = richRun();
	const kinds = new Set(renders.map((r) => r.effect.inputs.kind));

	test("the run exercised every render kind", () => {
		for (const kind of ["orient", "segment", "worked", "feedback", "hint", "solution", "remediation", "variation", "recap"]) assert.ok(kinds.has(kind as never), kind);
		assert.equal(d.state.status, "ended");
	});

	test("each render request fills its template", () => {
		for (const { state, effect } of renders) {
			const req = renderRequest(state, effect);
			const expected = effect.inputs.kind === "remediation" ? "remediate" : effect.inputs.kind === "recap" ? "recap" : "phase-render";
			assert.equal(req.template, expected);
			const filled = assertFills(req);
			assert.ok(filled.includes(`**${effect.maxWords} words**`), `${effect.inputs.kind}: word limit missing`);
		}
	});

	test("hints are served verbatim from the key; feedback marks the answer as tutor-only", () => {
		const hint = renders.find((r) => r.effect.inputs.kind === "hint");
		assert.ok(hint);
		const req = renderRequest(hint.state, hint.effect);
		assert.equal(req.verbatim, lessonItem(hint.state, "kp1.i1")?.key.hints[0]);
		// kp1.i1 got a cue before its first error, so its feedback carries no new pointer.
		const afterCue = renders.find((r) => r.effect.inputs.kind === "feedback" && r.effect.inputs.itemId === "kp1.i1");
		assert.ok(afterCue);
		const cueCtx = JSON.parse(renderRequest(afterCue.state, afterCue.effect).variables.context ?? "{}");
		assert.equal(cueCtx.pointer, null);
		assert.equal(cueCtx.answerForTutorOnly, "4,3 kΩ");
		const fb = renders.find((r) => r.effect.inputs.kind === "feedback" && r.effect.inputs.pointer);
		assert.ok(fb && fb.effect.inputs.kind === "feedback");
		const ctx = JSON.parse(renderRequest(fb.state, fb.effect).variables.context ?? "{}");
		assert.equal(ctx.final, false);
		const found = lessonItem(fb.state, fb.effect.inputs.itemId);
		assert.ok(found);
		assert.equal(ctx.answerForTutorOnly, formatAnswer(found.item, found.key, "pt-BR"));
		assert.equal(ctx.pointer, found.key.hints[0], "the pointer is the authored cue");
	});

	test("the segment that resolves the prediction carries the learner's choice", () => {
		const seg = renders.find((r) => r.effect.inputs.kind === "segment" && r.effect.inputs.resolvesPrediction);
		assert.ok(seg);
		const ctx = JSON.parse(renderRequest(seg.state, seg.effect).variables.context ?? "{}");
		const prediction = seg.state.plan?.prediction;
		assert.ok(prediction?.kind === "mcq");
		const label = prediction.options.find((o) => o.text === "Brilha mais")?.id;
		assert.equal(ctx.prediction.learnerChoice, `${label}) Brilha mais`);
		assert.equal(ctx.prediction.correct, `${label}) Brilha mais`);
	});

	test("remediation lists the representations already used and the misconception", () => {
		const rem = renders.find((r) => r.effect.inputs.kind === "remediation");
		assert.ok(rem);
		const ctx = JSON.parse(renderRequest(rem.state, rem.effect).variables.context ?? "{}");
		assert.equal(ctx.misconception.id, "m.current_consumed");
		assert.equal(ctx.representationsUsed.length, 2);
	});
});

describe("grader and plan requests", () => {
	test("grader request fills grader.md with rubric, reference and misconceptions", () => {
		const d = new LessonDriver();
		d.start();
		d.ready(compiledPlan());
		const req = graderRequest(d.state, "se1", { kind: "text", text: "porque o caminho é único" });
		const filled = assertFills(req);
		const ctx = JSON.parse(req.variables.context ?? "{}");
		assert.deepEqual(ctx.rubric, ["menciona caminho único", "conclui corrente igual"]);
		assert.deepEqual(ctx.misconceptions.map((m: { id: string }) => m.id), ["m.current_consumed", "m.parallel_sum"]);
		assert.deepEqual(ctx.relatedNodes, [NODE_ID, "ee.dc.ohm"]);
		assert.ok(filled.includes('"grade"'));
		assert.throws(() => graderRequest(d.state, "nope", { kind: "dont_know" }), /não existe/);
	});

	test("a warm-up from another node is graded without this plan's misconceptions or encompassed nodes", () => {
		const d = new LessonDriver();
		d.start();
		d.ready(compiledPlan(), [warmupItem()]);
		const req = graderRequest(d.state, "w1", { kind: "text", text: "2 mA" });
		const ctx = JSON.parse(req.variables.context ?? "{}");
		assert.equal(ctx.nodeId, "ee.dc.ohm");
		assert.deepEqual(ctx.misconceptions, [], "this node's misconceptions say nothing about the warm-up's node");
		assert.deepEqual(ctx.relatedNodes, ["ee.dc.ohm"], "blame cannot leak to this lesson's node");
	});

	test("plan request fills lesson-plan.md, including the corrective re-ask", () => {
		const req = planRequest({
			node: {
				id: NODE_ID,
				title: { pt: "Resistores em série", en: "Series resistors" },
				summary: "R_eq e corrente em série.",
				scope: "Somente circuitos série de corrente contínua.",
				objectives: ["Calcular R_eq", "Calcular I"],
				domainId: "electronics",
			},
			knownPrerequisites: ["Lei de Ohm"],
			previousIssues: "- segments.0.body: segment body has 90 words; write at least 120",
		});
		const filled = assertFills(req);
		assert.ok(filled.includes("Resistores em série"));
		assert.ok(filled.includes("write at least 120"));
		assert.equal(req.variables.domainId, "electronics");
	});
});

describe("revealsAnswer guard", () => {
	const plan = compiledPlan();
	const ref = (id: string) => {
		const r = lessonItem({ plan, warmups: [] }, id);
		assert.ok(r);
		return r;
	};

	test("numeric: any spelling of the target with units", () => {
		const { item, key } = ref("kp1.i1");
		assert.equal(revealsAnswer("O resultado é 4,3 kΩ.", item, key), true);
		assert.equal(revealsAnswer("Dá 4300 ohm no total.", item, key), true);
		assert.equal(revealsAnswer("Some as duas resistências: 1 kΩ e a outra.", item, key), false);
		assert.equal(formatAnswer(item, key, "pt-BR"), "4,3 kΩ");
	});

	test("choice: the option id or its text", () => {
		const { item, key } = ref("kp1.i3");
		assert.ok(key.answer.kind === "choice");
		const wrong = item.kind === "mcq" ? item.options.find((o) => o.id !== (key.answer.kind === "choice" ? key.answer.correctOptionId : ""))?.id : undefined;
		assert.equal(revealsAnswer(`A alternativa ${key.answer.correctOptionId} está certa.`, item, key), true);
		assert.equal(revealsAnswer(`Compare com a alternativa ${wrong}.`, item, key), false);
		assert.equal(revealsAnswer("Ela vai aumentar, claro.", item, key), true);
		assert.equal(revealsAnswer("Pense no que acontece com o caminho.", item, key), false);
	});

	test("numeric: prefix-only, bare SI and bare-in-the-displayed-unit spellings are caught", () => {
		const { item, key } = ref("kp1.i1"); // 4,3 kΩ, no answerUnit
		assert.equal(revealsAnswer("Fica em 4,3k no total.", item, key), true, "prefix without unit");
		assert.equal(revealsAnswer("O total é 4k3.", item, key), true, "RKM");
		assert.equal(revealsAnswer("O total chega a 4300.", item, key), true, "bare SI value");
		assert.equal(revealsAnswer(`Dá 4,3 k${String.fromCharCode(0x2126)} no total.`, item, key), true, "Ohm sign U+2126");
		assert.equal(revealsAnswer("R1 e R2 estão em série; some R1 com R2.", item, key), false, "labels are not numbers");
		const mA = ref("kp2.i2"); // 2 mA, answerUnit "mA": the learner types "2"
		assert.equal(revealsAnswer("A resposta a digitar é 2.", mA.item, mA.key), true, "bare number in the displayed unit");
		assert.equal(revealsAnswer("Divida 5 V por 2,5 kΩ.", mA.item, mA.key), false);
	});

	test("numeric: dimensionless answers are guarded too", () => {
		const draft = seriesDraft();
		draft.knowledgePoints[0].items[0] = numericDraft("kp1.i1", "Quantos resistores há em série no circuito da figura?", 1, 3, "", { answer: { value: 3, unit: null, tolerance: { abs: 0.1 } } });
		const p = compiledPlan(draft);
		const r = lessonItem({ plan: p, warmups: [] }, "kp1.i1");
		assert.ok(r);
		assert.equal(revealsAnswer("São 3 no total.", r.item, r.key), true);
		assert.equal(revealsAnswer("Conte os caminhos.", r.item, r.key), false);
	});

	test("text: the reference sentence", () => {
		const { item, key } = ref("kp2.i3");
		assert.equal(revealsAnswer(`Note que ${SECRET}-REFERENCIA as correntes são iguais.`, item, key), true);
		assert.equal(revealsAnswer("Compare o caminho da carga.", item, key), false);
	});

	test("describeItem exposes only public fields", () => {
		const { item } = ref("kp1.i3");
		const text = JSON.stringify(describeItem(item));
		assert.ok(!text.includes('"correct"') && !text.includes(SECRET));
	});
});
