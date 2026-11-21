import assert from "node:assert/strict";
import { it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { activityForSkill, coversLessonActivity, currentReadings, parseLessonActivity } from "../src/core/lesson-activity.ts";
import { createTeacherTools, type TeacherToolContext } from "../src/agent/tools.ts";
import { ActivityArtifact } from "../components/study/lesson-activity.tsx";
import { hasTeachingContext, newGraphContextMessage } from "../src/core/native-messages.ts";
import { phaseAt3, phaseAt3Lh } from "../src/core/phases.ts";
import { Value } from "typebox/value";
import { lessonSourceLines, type StudyMaterial } from "../src/core/study/map.ts";

it("opens a selected curriculum mission in teaching on the server and in the transcript", () => {
	const marker = newGraphContextMessage([{ id: "mp.a", name: "Mapa", statement: "Comparar escalas" }], []);
	assert.equal(hasTeachingContext([marker]), false);
	marker.details = { campaignLesson: true };
	assert.equal(hasTeachingContext([marker]), true);
	assert.equal(phaseAt3Lh([marker]), "teach");
	assert.equal(phaseAt3([{ parts: [{ type: "data-graph-context", data: marker.details }] }]), "teach");
});

it("keeps both media formats and the supplied YouTube timestamp in a crowded lesson", () => {
	const books: StudyMaterial[] = Array.from({ length: 9 }, (_, i) => ({
		kind: "book", title: "Livro " + i, part: "Capítulo 1", url: "https://example.org/" + i, lang: "pt", nodes: ["n"],
	}));
	const video: StudyMaterial = { ...books[0]!, kind: "video", title: "Experimento", part: "Medição", suggested: true, url: "https://www.youtube.com/watch?v=example&t=80" };
	const lines = lessonSourceLines([...books, video]);
	assert.equal(lines.length, 6);
	assert.match(lines.join("\n"), /Sugestão.*[Vv]ídeo.*Experimento.*Medição.*&t=80/);
	assert.match(lines[0]!, /Livro 0/);
});

it("renders a compact interactive example in the text with the source available on demand", async () => {
	const input = { kind: "comparison", presentation: "inline", title: "Sentido de since", source: "Grammar notes · §2",
		steps: [{ label: "Tempo", detail: "Since Monday indica o início." }, { label: "Causa", detail: "Since it rains introduz o motivo." }] };
	const tool = createTeacherTools({} as TeacherToolContext).study_activity!;
	const out = await tool.execute("inline", input);
	const html = renderToStaticMarkup(<ActivityArtifact part={{ type: "tool-study_activity", toolCallId: "inline", state: "output-available", input, output: out.details }} />);
	assert.match(html, /data-presentation="inline"/);
	assert.match(html, /aria-pressed="true"/);
	assert.match(html, /Grammar notes/);
});

it("starts a book lesson in teaching and gives the tutor the original page image by default", async () => {
	const marker = newGraphContextMessage([], []);
	assert.equal(hasTeachingContext([marker]), false);
	marker.details = { readingSource: { book: "a".repeat(64), unit: 2, region: "figures" } };
	assert.equal(hasTeachingContext([marker]), true);
	assert.equal(phaseAt3Lh([marker]), "teach");
	assert.equal(phaseAt3([{ parts: [{ type: "data-graph-context", data: marker.details }] }]), "teach");
	const requests: Array<[number, boolean]> = [];
	const tutor = createTeacherTools({ readBookPage: async (unit: number, image: boolean) => {
		requests.push([unit, image]);
		return { text: "Página " + unit };
	} } as TeacherToolContext);
	await tutor.read_book_page!.execute("page-3", { unit: 3 });
	await tutor.read_book_page!.execute("page-4", { unit: 4, image: false });
	assert.deepEqual(requests, [[3, true], [4, false]]);
	assert.equal(Value.Check(tutor.study_activity!.parameters, { kind: "circuit" }), false);
	assert.equal(createTeacherTools({} as TeacherToolContext).read_book_page, undefined);
});

it("projects the same measurement in three units and responds to circuit changes", () => {
	assert.deepEqual(currentReadings(10, 5, true), { si: "2 mA", decimal: "0,002 A", scientific: "2 × 10⁻³ A" });
	assert.equal(currentReadings(10, 10, true).si, "1 mA");
	assert.equal(currentReadings(20, 1, true).scientific, "2 × 10⁻² A");
	assert.equal(currentReadings(10, 5, false).si, "0 mA");
	assert.deepEqual(currentReadings(0, 5, true), currentReadings(10, 5, false));
});

it("binds only relevant curriculum activities", () => {
	assert.equal(activityForSkill("ee.math.algebra.sci-notation.powers-of-ten")?.kind, "notation");
	assert.equal(activityForSkill("ee.dc.basics.ohms-law")?.kind, "circuit");
	assert.deepEqual(activityForSkill("ee.dc.laws.dividers"), { kind: "divider" });
	assert.deepEqual(activityForSkill("ee.ac.transients2.rlc-series-natural"), { kind: "falstad", experiment: "rlc" });
	assert.deepEqual(activityForSkill("ee.analog.diodes.rectifiers"), { kind: "falstad", experiment: "rectifier" });
	assert.equal(activityForSkill("en.grammar.a2.past-continuous.interrupted")?.kind, "timeline");
	assert.equal(activityForSkill("unrelated"), undefined);
});

it("a free conversation's teacher tool delivers a sourced, renderable comparison", async () => {
	const args = { kind: "comparison", title: "Dois materiais", source: "Apostila · seção 1", steps: [
		{ label: "Cobre", detail: "Conduz corrente." }, { label: "Vidro", detail: "Isola nas condições estudadas." },
	] };
	const tool = createTeacherTools({} as TeacherToolContext).study_activity!;
	const result = await tool.execute("lab-1", args);
	assert.deepEqual(result.details, args);
	const markup = renderToStaticMarkup(<ActivityArtifact part={{ type: "tool-study_activity", toolCallId: "lab-1", input: args, state: "output-available", output: result.details }} />);
	for (const text of ["Dois materiais", "Apostila · seção 1", "Cobre", "Vidro"]) assert.ok(markup.includes(text));
	assert.equal(parseLessonActivity({ ...args, steps: [] }), undefined);
	const withConclusion = { ...args, steps: [...args.steps, { label: "Conferência", detail: "Compare as duas medições." }] };
	assert.deepEqual(parseLessonActivity(withConclusion), withConclusion);
	assert.equal(parseLessonActivity({ ...args, source: " " }), undefined);
	assert.equal(parseLessonActivity({ ...args, steps: [...args.steps, args.steps[0]] }), undefined);
});

it("opens the teacher's selected Falstad laboratory from the rendered answer", async () => {
	const tool = createTeacherTools({} as TeacherToolContext).study_activity!;
	const input = { kind: "falstad", experiment: "rc-filter" };
	const out = await tool.execute("rc", input);
	const html = renderToStaticMarkup(<ActivityArtifact part={{ type: "tool-study_activity", toolCallId: "rc", state: "output-available", input, output: out.details }} />);
	assert.match(html, /startCircuit=filt-lopass\.txt/);
	assert.match(html, /frequência/);
});

it("provides a human spelling model and local rehearsal without a transcription service", async () => {
	const exercise = activityForSkill("en.listening.a1.personal-info")!;
	const tool = createTeacherTools({} as TeacherToolContext).study_activity!;
	assert.ok(parseLessonActivity(exercise));
	assert.ok(coversLessonActivity(exercise, exercise));
	assert.ok(coversLessonActivity({ ...exercise, voice: { ...exercise.voice, sample: "A, N, N, A." } }, exercise));
	assert.equal(coversLessonActivity({ ...exercise, voice: { ...exercise.voice, sample: "Sam" } }, exercise), false);
	assert.equal(parseLessonActivity({ kind: "pronunciation" }), undefined);
	assert.equal(parseLessonActivity({ ...exercise, voice: { ...exercise.voice, sample: "!!!" } }), undefined);
	const result = await tool.execute("voice", exercise);
	const html = renderToStaticMarkup(<ActivityArtifact part={{ type: "tool-study_activity", toolCallId: "voice", state: "output-available", output: result.details }} />);
	assert.match(html, /<audio[^>]+voa-audio/);
	assert.ok(!html.includes("Gravar minha voz"), "lesson voice recording is OFF by default");
	assert.match(html, /separadas por hífens/);
});
