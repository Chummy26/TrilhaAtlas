import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Value } from "typebox/value";
import {
	bookActivitySchema,
	coversLessonActivity,
	formatRoleplayClosePrompt,
	formatRoleplayMovePrompt,
	parseLessonActivity,
	type LessonActivity,
} from "../src/core/lesson-activity.ts";
import { createTeacherTools, type TeacherToolContext } from "../src/agent/tools.ts";
import { ActivityArtifact } from "../components/study/lesson-activity.tsx";

function makeValidRoleplay(overrides?: Partial<LessonActivity>) {
	return {
		kind: "roleplay" as const,
		title: "Triagem de falha em fonte linear",
		source: "Horowitz & Hill · The Art of Electronics, Cap. 9",
		roleplay: {
			persona: "Engenheira Sênior de Bancada (Carla)",
			learnerRole: "Técnico de eletrônica em diagnóstico",
			scenario: "A saída regulada de 5 V caiu para 1,8 V sob carga nominal de 300 mA e o regulador aqueceu rapidamente.",
			openingLine: "A placa voltou do teste com 1,8 V na linha de 5 V. Qual medição você faz primeiro antes de trocar o regulador?",
			goal: "Propor uma sequência segura de medições que isole curto na carga vs. queda na entrada.",
			criteria: [
				"Mede tensão na entrada do regulador antes de concluir defeito no CI",
				"Verifica corrente de carga ou isola a carga para descartar curto",
				"Justifica a decisão usando queda de tensão e dissipação térmica",
			],
			minutes: 6,
			scene: "lab" as const,
			suggestedMoves: [
				"Vou medir Vin e Vout com o multímetro sob carga antes de desconectar qualquer estágio.",
				"Vou desligar a alimentação e checar resistência entre 5 V e GND para descartar curto.",
			],
		},
		...overrides,
	};
}

describe("Roleplay activity schema & parser", () => {
	it("parses, trims, and normalizes a valid roleplay activity", () => {
		const raw = {
			kind: "roleplay",
			title: "  Check-in com reserva alterada  ",
			source: "  British Council · Hotel Check-in Dialogue  ",
			language: "en-US",
			roleplay: {
				persona: "  Hotel Receptionist (Maya)  ",
				learnerRole: "  Guest arriving late  ",
				scenario: "  Your flight was delayed and the hotel moved your room to a quieter wing.  ",
				openingLine: "  Good evening! Welcome to Harbor Hotel. How can I help you tonight?  ",
				goal: "  Confirm your booking details and ask politely about breakfast hours.  ",
				criteria: [
					"  Gives full name clearly  ",
					"  Confirms check-out date  ",
					"  Gives full name clearly  ",
					"  Uses polite question form  ",
				],
				suggestedMoves: [
					"  Good evening, I have a reservation under Lucas Silva.  ",
					"  Hi! My flight was delayed, could you check my booking?  ",
				],
			},
		};

		const parsed = parseLessonActivity(raw);
		assert.ok(parsed);
		assert.equal(parsed.kind, "roleplay");
		assert.equal(parsed.title, "Check-in com reserva alterada");
		assert.equal(parsed.source, "British Council · Hotel Check-in Dialogue");
		assert.ok(parsed.roleplay);
		assert.equal(parsed.roleplay.persona, "Hotel Receptionist (Maya)");
		assert.equal(parsed.roleplay.learnerRole, "Guest arriving late");
		assert.equal(parsed.roleplay.minutes, 5);
		assert.deepEqual(parsed.roleplay.criteria, [
			"Gives full name clearly",
			"Confirms check-out date",
			"Uses polite question form",
		]);
		assert.deepEqual(parsed.roleplay.suggestedMoves, [
			"Good evening, I have a reservation under Lucas Silva.",
			"Hi! My flight was delayed, could you check my booking?",
		]);
	});

	it("preserves explicit valid minutes and optional scene", () => {
		const parsed = parseLessonActivity(makeValidRoleplay());
		assert.ok(parsed?.roleplay);
		assert.equal(parsed.roleplay.minutes, 6);
		assert.equal(parsed.roleplay.scene, "lab");
	});

	it("rejects missing required fields or whitespace-only text", () => {
		const base = makeValidRoleplay();
		assert.equal(parseLessonActivity({ kind: "roleplay", title: "T", source: "S" }), undefined);
		assert.equal(parseLessonActivity({ ...base, title: "   " }), undefined);
		assert.equal(parseLessonActivity({ ...base, source: "   " }), undefined);
		assert.equal(parseLessonActivity({ ...base, roleplay: { ...base.roleplay, persona: "  " } }), undefined);
		assert.equal(parseLessonActivity({ ...base, roleplay: { ...base.roleplay, learnerRole: "" } }), undefined);
		assert.equal(parseLessonActivity({ ...base, roleplay: { ...base.roleplay, scenario: "  " } }), undefined);
		assert.equal(parseLessonActivity({ ...base, roleplay: { ...base.roleplay, openingLine: "" } }), undefined);
		assert.equal(parseLessonActivity({ ...base, roleplay: { ...base.roleplay, goal: "\t" } }), undefined);
	});

	it("rejects invalid criteria counts, duplicates collapsing below 2, out-of-range minutes, and bad suggestedMoves", () => {
		const base = makeValidRoleplay();
		// Fewer than 2 criteria
		assert.equal(parseLessonActivity({ ...base, roleplay: { ...base.roleplay, criteria: ["Apenas um"] } }), undefined);
		// Duplicates collapsing to 1
		assert.equal(
			parseLessonActivity({ ...base, roleplay: { ...base.roleplay, criteria: ["Critério A", "  critério a "] } }),
			undefined,
		);
		// Whitespace entry leaving only 1 valid criterion
		assert.equal(
			parseLessonActivity({ ...base, roleplay: { ...base.roleplay, criteria: ["Critério A", "   "] } }),
			undefined,
		);
		// More than 4 criteria
		assert.equal(
			parseLessonActivity({ ...base, roleplay: { ...base.roleplay, criteria: ["C1", "C2", "C3", "C4", "C5"] } }),
			undefined,
		);
		// Out-of-range or non-finite minutes
		assert.equal(parseLessonActivity({ ...base, roleplay: { ...base.roleplay, minutes: 1 } }), undefined);
		assert.equal(parseLessonActivity({ ...base, roleplay: { ...base.roleplay, minutes: 16 } }), undefined);
		assert.equal(parseLessonActivity({ ...base, roleplay: { ...base.roleplay, minutes: Number.NaN } }), undefined);
		assert.equal(parseLessonActivity({ ...base, roleplay: { ...base.roleplay, minutes: Number.POSITIVE_INFINITY } }), undefined);
		// Invalid suggestedMoves (<2, >3, or duplicates collapsing to 1)
		assert.equal(parseLessonActivity({ ...base, roleplay: { ...base.roleplay, suggestedMoves: ["Só uma"] } }), undefined);
		assert.equal(
			parseLessonActivity({ ...base, roleplay: { ...base.roleplay, suggestedMoves: ["A", "B", "C", "D"] } }),
			undefined,
		);
		assert.equal(
			parseLessonActivity({ ...base, roleplay: { ...base.roleplay, suggestedMoves: ["Mesmo passo", "mesmo passo"] } }),
			undefined,
		);
		// Invalid scene
		assert.equal(
			parseLessonActivity({ ...base, roleplay: { ...base.roleplay, scene: "spaceship" as never } }),
			undefined,
		);
	});

	it("supports bookActivitySchema and coversLessonActivity", () => {
		const valid = makeValidRoleplay();
		assert.equal(Value.Check(bookActivitySchema, valid), true);

		const preset = parseLessonActivity(valid)!;
		assert.equal(coversLessonActivity(valid, preset), true);
		assert.equal(coversLessonActivity({ kind: "roleplay", title: "X", source: "Y" }, preset), false);
		assert.equal(coversLessonActivity({ kind: "circuit" }, preset), false);
	});

	it("formats structured learner move and rubric closure prompts", () => {
		const movePrompt = formatRoleplayMovePrompt("  Triagem de falha  ", "  Meço Vin primeiro.  ", "Carla");
		assert.match(movePrompt, /Triagem de falha/);
		assert.match(movePrompt, /Meço Vin primeiro\./);
		assert.match(movePrompt, /Carla/);

		const closePrompt = formatRoleplayClosePrompt("Triagem de falha", ["Mede Vin", "Isola carga"]);
		assert.match(closePrompt, /Triagem de falha/);
		assert.match(closePrompt, /1\. Mede Vin/);
		assert.match(closePrompt, /2\. Isola carga/);
	});
});

describe("Roleplay teacher tool & SSR rendering", () => {
	it("returns in-character rubric guidance from study_activity and renders RoleplayActivity cleanly", async () => {
		const input = makeValidRoleplay();
		const tool = createTeacherTools({} as TeacherToolContext).study_activity!;
		const out = await tool.execute("rp-1", input);

		const textBlock = out.content.find((c: { type: string }) => c.type === "text") as { text: string } | undefined;
		assert.ok(textBlock);
		assert.match(textBlock.text, /Engenheira Sênior de Bancada \(Carla\)/);
		assert.match(textBlock.text, /Técnico de eletrônica em diagnóstico/);
		assert.match(textBlock.text, /2–4 concise turns/);
		assert.match(textBlock.text, /criterion by criterion/);

		const html = renderToStaticMarkup(
			React.createElement(ActivityArtifact, {
				part: {
					type: "tool-study_activity",
					toolCallId: "rp-1",
					state: "output-available",
					input,
					output: out.details,
				},
			}),
		);

		assert.match(html, /data-kind="roleplay"/);
		assert.match(html, /data-scene="lab"/);
		assert.match(html, /Triagem de falha em fonte linear/);
		assert.match(html, /Engenheira Sênior de Bancada \(Carla\)/);
		assert.match(html, /Técnico de eletrônica em diagnóstico/);
		assert.match(html, /A placa voltou do teste com 1,8 V/);
		assert.match(html, /Mede tensão na entrada do regulador/);
		assert.match(html, /Horowitz &amp; Hill/);
		assert.doesNotMatch(html, /Pergunte sobre o que observou/);
	});

	it("also allows roleplay in book-reader teacher tools", async () => {
		const input = makeValidRoleplay();
		const tools = createTeacherTools({
			readBookPage: async () => ({ text: "page 1" }),
		} as unknown as TeacherToolContext);
		assert.equal(Value.Check(tools.study_activity!.parameters, input), true);
		const out = await tools.study_activity!.execute("rp-book", input);
		assert.ok(parseLessonActivity(out.details));
	});
});
