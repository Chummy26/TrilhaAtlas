import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatActionsContext } from "../components/chat.tsx";
import { I18nProvider } from "../components/i18n.tsx";
import { LessonExamCard } from "../components/study/lesson-exam-card.tsx";
import { PronunciationPractice } from "../components/study/pronunciation-practice.tsx";
import { AgentSection, composeLessonVoicePractice } from "../components/settings/agent-section.tsx";
import { InteractionLayersProvider } from "../components/interaction-layers.tsx";
import { composeExamPartsAnswer, extractExamFormParts } from "../src/core/study/lesson-conclusion.ts";
import { sanitizeUserSettings } from "../src/core/settings.ts";
import { parseAgentSettingsBody } from "../src/server/settings-body.ts";

const THREE_PART_TASK = `Entregue no formulário:

1. Em português, as três informações que o colega quer saber, na ordem em que ele pergunta. Inclua os detalhes específicos que ouvir. Não responda às perguntas com seus dados pessoais.

2. O ditado da **primeira pergunta**, em inglês. Maiúsculas e pontuação não contam na correção.

3. Uma frase em português resumindo o que o colega está tentando descobrir sobre você.

O critério é entender o que cada pergunta pede sem trocar os assuntos ou os detalhes mencionados.`;

describe("structured multi-part exam submission form", () => {
	it("extracts numbered exam deliverables automatically and stops before closing criteria paragraphs", () => {
		const parts = extractExamFormParts(THREE_PART_TASK);
		assert.equal(parts.length, 3);
		assert.match(parts[0]!.label, /^Em português, as três informações/);
		assert.match(parts[1]!.label, /^O ditado da primeira pergunta, em inglês/);
		assert.ok(!parts[1]!.label.includes("**"), "strips markdown markers from field labels");
		assert.match(parts[2]!.label, /^Uma frase em português resumindo/);
		assert.ok(!parts[2]!.label.includes("O critério é"), "does not absorb closing paragraph into last part");
		assert.equal(parts[1]!.multiline, false, "short dictation field uses compact height");
		assert.equal(parts[0]!.multiline, true);

		assert.deepEqual(extractExamFormParts("Explique com suas palavras por que a corrente cai pela metade."), []);
	});

	it("validates every part individually and formats a clean numbered submission", () => {
		const parts = extractExamFormParts(THREE_PART_TASK);
		const missing = composeExamPartsAnswer(parts, ["Origem, irmãos e nome", "ok", ""]);
		assert.equal(missing.ok, false);
		if (!missing.ok) assert.deepEqual(missing.missing, [1, 2]);

		const complete = composeExamPartsAnswer(parts, [
			"1) origem (de onde sou), 2) se tenho irmãos, 3) meu nome.",
			"Where are you from?",
			"O colega quer saber meus dados básicos de apresentação.",
		]);
		assert.equal(complete.ok, true);
		if (complete.ok) {
			assert.match(complete.text, /^1\. /);
			assert.match(complete.text, /Where are you from\?/);
			assert.match(complete.text, /\n\n3\. /);
		}
	});

	it("renders separate structured fields in LessonExamCard for multi-part exams and a single textarea otherwise", () => {
		const actions = {
			chatId: "chat-1",
			syncFromServer: async () => {},
			sendText: () => {},
			openSetup: () => {},
			activeExamId: "exam-1",
			submitExam: async () => true,
		};
		const structuredHtml = renderToStaticMarkup(
			<I18nProvider initialLocale="pt-BR">
				<ChatActionsContext.Provider value={actions}>
					<LessonExamCard
						part={{
							type: "tool-present_lesson_exam",
							toolCallId: "exam-1",
							state: "output-available",
							output: { task: THREE_PART_TASK, attempt: 1, total: 2, objectives: ["Entender perguntas pessoais simples."] },
						}}
					/>
				</ChatActionsContext.Provider>
			</I18nProvider>,
		);
		assert.match(structuredHtml, /data-exam-form="structured"/);
		assert.match(structuredHtml, /Sua resposta à prova · por partes/);
		assert.match(structuredHtml, /0 de 3 preenchidas/);
		assert.match(structuredHtml, /data-testid="exam-part-1"/);
		assert.match(structuredHtml, /data-testid="exam-part-2"/);
		assert.match(structuredHtml, /data-testid="exam-part-3"/);
		assert.match(structuredHtml, /Usar campo único/);

		const structuredEnHtml = renderToStaticMarkup(
			<ChatActionsContext.Provider value={actions}>
				<LessonExamCard
					part={{
						type: "tool-present_lesson_exam",
						toolCallId: "exam-1",
						state: "output-available",
						output: { task: THREE_PART_TASK, attempt: 1, total: 2 },
					}}
				/>
			</ChatActionsContext.Provider>,
		);
		assert.match(structuredEnHtml, /data-exam-form="structured"/);
		assert.match(structuredEnHtml, /0 of 3/);

		const singleHtml = renderToStaticMarkup(
			<ChatActionsContext.Provider value={actions}>
				<LessonExamCard
					part={{
						type: "tool-present_lesson_exam",
						toolCallId: "exam-1",
						state: "output-available",
						output: { task: "Calcule a corrente em um resistor de 5 kΩ com fonte de 10 V.", attempt: 1, total: 2 },
					}}
				/>
			</ChatActionsContext.Provider>,
		);
		assert.match(singleHtml, /data-exam-form="free"/);
		assert.ok(!singleHtml.includes('data-testid="exam-part-1"'));
	});
});

describe("optional lesson voice recording setting (OFF by default)", () => {
	it("sanitizes and parses agent.lessonVoicePractice cleanly", () => {
		assert.equal(sanitizeUserSettings({ version: 1, agent: { lessonVoicePractice: true } })?.agent?.lessonVoicePractice, true);
		assert.equal(sanitizeUserSettings({ version: 1, agent: { lessonVoicePractice: "yes" } })?.agent?.lessonVoicePractice, undefined);

		const ok = parseAgentSettingsBody({ lessonVoicePractice: true });
		assert.equal(ok.ok, true);
		if (ok.ok) assert.equal(ok.settings.lessonVoicePractice, true);

		const bad = parseAgentSettingsBody({ lessonVoicePractice: "true" });
		assert.equal(bad.ok, false);

		assert.equal(composeLessonVoicePractice(undefined, true).lessonVoicePractice, true);
		assert.equal(composeLessonVoicePractice({ lessonVoicePractice: true }, false).lessonVoicePractice, false);
	});

	it("renders the setting OFF by default in AgentSection and toggles voice recording in PronunciationPractice", () => {
		const offSettingsHtml = renderToStaticMarkup(
			<I18nProvider initialLocale="pt-BR">
				<InteractionLayersProvider>
					<AgentSection agent={undefined} models={undefined} graph={undefined} compaction={undefined} onSectionChange={() => true} onModelsChange={() => {}} onCompactionChange={() => true} />
				</InteractionLayersProvider>
			</I18nProvider>,
		);
		const rowOff = offSettingsHtml.split('data-testid="lesson-voice-practice-row"')[1] ?? "";
		assert.ok(rowOff.includes("Gravação de voz nas aulas"));
		assert.ok(rowOff.includes('aria-checked="false"'), "defaults OFF");

		const onSettingsHtml = renderToStaticMarkup(
			<I18nProvider initialLocale="pt-BR">
				<InteractionLayersProvider>
					<AgentSection agent={{ lessonVoicePractice: true }} models={undefined} graph={undefined} compaction={undefined} onSectionChange={() => true} onModelsChange={() => {}} onCompactionChange={() => true} />
				</InteractionLayersProvider>
			</I18nProvider>,
		);
		const rowOn = onSettingsHtml.split('data-testid="lesson-voice-practice-row"')[1] ?? "";
		assert.ok(rowOn.includes('aria-checked="true"'), "reflects opt-in ON");

		const defaultCard = renderToStaticMarkup(
			<I18nProvider initialLocale="pt-BR">
				<PronunciationPractice voice={{ language: "en-US", sample: "Nice to meet you!", mode: "phrase" }} />
			</I18nProvider>,
		);
		assert.ok(!defaultCard.includes("Gravar minha voz"), "hides voice recording button by default");
		assert.ok(!defaultCard.includes("transcrição não mede pronúncia"), "hides transcription note by default");

		const enabledCard = renderToStaticMarkup(
			<I18nProvider initialLocale="pt-BR">
				<PronunciationPractice voice={{ language: "en-US", sample: "Nice to meet you!", mode: "phrase" }} voicePracticeEnabled />
			</I18nProvider>,
		);
		assert.ok(enabledCard.includes("Gravar minha voz"), "shows recording button when explicitly enabled");
		assert.ok(enabledCard.includes("grave até 30 segundos"));
	});
});
