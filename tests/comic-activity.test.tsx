import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { activityForSkill, parseLessonActivity } from "../src/core/lesson-activity.ts";
import { createTeacherTools, type TeacherToolContext } from "../src/agent/tools.ts";
import { ActivityArtifact } from "../components/study/lesson-activity.tsx";
import { inferComicScene, pickStoryMotif } from "../components/study/comic-art.tsx";

describe("comic strip lesson activity", () => {
	it("validates well-formed comic strips and rejects incomplete inputs", () => {
		const valid = {
			kind: "comic" as const,
			title: "Na recepção do curso",
			language: "en-US",
			source: "VOA · Let's Learn English, lição 1",
			panels: [
				{
					scene: "reception" as const,
					speaker: "Atendente",
					mood: "friendly" as const,
					speech: "What's your name?",
					reply: "I'm Ana.",
					replySpeaker: "Você",
					cue: "name → pedido de nome",
					caption: "A pista «name» mostra que ela pediu o seu nome.",
				},
				{
					scene: "street" as const,
					speaker: "Atendente",
					mood: "curious" as const,
					speech: "Where are you from?",
					cue: "Where … from → origem",
					caption: "«Where» combinado com «from» pergunta de onde você é.",
				},
			],
		};

		assert.deepEqual(parseLessonActivity(valid), valid);
		assert.equal(parseLessonActivity({ ...valid, panels: [valid.panels[0]] }), undefined, "needs at least 2 panels");
		assert.equal(parseLessonActivity({ ...valid, title: "   " }), undefined, "rejects blank title");
		assert.equal(parseLessonActivity({ ...valid, source: "" }), undefined, "rejects blank source");
		assert.equal(
			parseLessonActivity({ ...valid, panels: [{ ...valid.panels[0], speech: "  " }, valid.panels[1]] }),
			undefined,
			"rejects blank speech bubble",
		);
		assert.equal(
			parseLessonActivity({ ...valid, panels: [{ ...valid.panels[0], scene: "spaceship" }, valid.panels[1]] }),
			undefined,
			"rejects unknown scene",
		);
	});

	it("provides playful comic strip presets for beginner English dialogue skills", () => {
		const greetings = activityForSkill("en.speaking.a1.greetings");
		assert.equal(greetings?.kind, "comic");
		assert.ok(parseLessonActivity(greetings));
		assert.equal(greetings?.panels?.length, 3);

		const personal = activityForSkill("en.speaking.a1.personal-questions");
		assert.equal(personal?.kind, "comic");
		assert.ok(parseLessonActivity(personal));
		assert.equal(personal?.panels?.length, 4);

		const forms = activityForSkill("en.writing.a1.forms");
		assert.equal(forms?.kind, "comic");
		assert.ok(parseLessonActivity(forms));
		assert.equal(forms?.panels?.length, 3);
	});

	it("executes through study_activity and renders illustrated comic panels, bubbles, cues and controls", async () => {
		const preset = activityForSkill("en.speaking.a1.personal-questions")!;
		const tool = createTeacherTools({} as TeacherToolContext).study_activity!;
		const result = await tool.execute("comic-1", preset);
		assert.deepEqual(result.details, preset);

		const html = renderToStaticMarkup(
			<ActivityArtifact
				part={{
					type: "tool-study_activity",
					toolCallId: "comic-1",
					state: "output-available",
					input: preset,
					output: result.details,
				}}
			/>,
		);
		assert.match(html, /data-kind="comic"/);
		assert.match(html, /Tirinha ilustrada/);
		assert.match(html, /Quadrinho 1 de 4/);
		assert.match(html, /What&#x27;s your name\?|What's your name\?/);
		assert.match(html, /Where are you from\?/);
		assert.match(html, /comic-cue-sticker/);
		assert.match(html, /comic-scene-svg/);
		assert.match(html, /lang="en-US"/);
		assert.match(html, /Quadrinho anterior/);
		assert.match(html, /Próximo quadrinho/);
		assert.match(html, /Fonte da aula/);

		await assert.rejects(
			() => tool.execute("comic-bad", { kind: "comic", title: "Vazio", source: "Guia", panels: [] }),
			/2–6|minItems|panels|comic/i,
		);
	});

	it("assigns distinct playful storybook motifs for the reception roadmap nodes and infers comic scenes", () => {
		assert.equal(pickStoryMotif("Pista na pergunta", 0, true), "listen");
		assert.equal(pickStoryMotif("Reconhecer pedido de nome", 1, true), "name");
		assert.equal(pickStoryMotif("Reconhecer pedido de origem", 1, true), "origin");
		assert.equal(pickStoryMotif("Reconhecer pergunta sobre trabalho", 1, true), "work");
		assert.equal(pickStoryMotif("Reconhecer pergunta sobre família", 1, true), "family");
		assert.equal(pickStoryMotif("Entender perguntas numa conversa", 4, false), "say");

		assert.equal(inferComicScene("Na recepção preenchendo a ficha"), "reception");
		assert.equal(inferComicScene("No café pedindo croissant"), "cafe");
		assert.equal(inferComicScene("Circuito com pilha e lâmpada"), "lab");
	});

	it("renders diagram activities with playful numbered storybook badges", async () => {
		const args = {
			kind: "diagram" as const,
			title: "Pistas na conversa",
			source: "VOA · Lição 1",
			steps: [
				{ label: "Ouvir a pista", detail: "Escute a palavra principal da pergunta.", illustration: "listen" as const },
				{ label: "Responder seu nome", detail: "Use I'm seguido do seu nome.", illustration: "say" as const },
			],
		};
		const tool = createTeacherTools({} as TeacherToolContext).study_activity!;
		const out = await tool.execute("diag-1", args);
		const html = renderToStaticMarkup(
			<ActivityArtifact
				part={{ type: "tool-study_activity", toolCallId: "diag-1", state: "output-available", input: args, output: out.details }}
			/>,
		);
		assert.match(html, /lab-story-cards/);
		assert.match(html, /lab-story-num/);
		assert.match(html, /Ouvir a pista/);
		assert.match(html, /Responder seu nome/);
	});
});
