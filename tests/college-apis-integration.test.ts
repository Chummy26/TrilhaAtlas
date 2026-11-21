import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-college-apis-"));
process.env.LH_DATA_DIR = root;
process.env.LH_AUTH_FILE = path.join(root, "auth.json");

const { GET: getSyllabus } = await import("../app/api/study/syllabus/route.ts");
const { GET: getTranscript } = await import("../app/api/study/transcript/route.ts");
const { GET: getNotebook } = await import("../app/api/study/notebook/route.ts");
const { GET: getExam, POST: postExam } = await import("../app/api/study/module-exam/route.ts");
const { GET: getPset, POST: postPset } = await import("../app/api/study/problem-set/route.ts");
const { GET: getPlacement, POST: postPlacement, DELETE: deletePlacement } = await import("../app/api/study/placement/route.ts");
const { GET: getFlipped, POST: postFlipped } = await import("../app/api/study/flipped/route.ts");
const { studyProfile, switchStudyDomain } = await import("../src/server/study.ts");

after(() => fs.rmSync(root, { recursive: true, force: true }));

it("serves syllabus, transcript, notebook, module-exam, problem-set, flipped-reading, and adaptive placement end-to-end via API routes", async () => {
	// 1. In "Geral" (no active domain), study routes cleanly return 409.
	switchStudyDomain(null);
	assert.equal((await getSyllabus(new Request("http://local/api/study/syllabus"))).status, 409);

	// 2. Switch to Electronics -> Syllabus, Transcript, Notebook return 200.
	switchStudyDomain("electronics");
	const sylRes = await getSyllabus(new Request("http://local/api/study/syllabus"));
	assert.equal(sylRes.status, 200);
	const syllabus = (await sylRes.json()) as {
		chapters: { level: string; modules: { id: string; title: string; lessons: { id: string }[] }[] }[];
		schedule: { reviewReserveShare: number; weeksToFinish: number; weeksToFinishP80: number };
	};
	assert.ok(syllabus.chapters.length >= 4);
	assert.equal(syllabus.schedule.reviewReserveShare, 0.33);
	assert.ok(syllabus.schedule.weeksToFinishP80 > syllabus.schedule.weeksToFinish);

	const mod = syllabus.chapters[0]!.modules[0]!;
	const firstLesson = mod.lessons[0]!;

	// 3. Flipped reading guide GET + POST note persistence.
	const flRes = await getFlipped(new Request(`http://local/api/study/flipped?node=${encodeURIComponent(firstLesson.id)}`));
	assert.equal(flRes.status, 200);
	const flData = (await flRes.json()) as { guide: { questions: { id: string }[] }; note: unknown };
	assert.equal(flData.guide.questions.length, 3);
	const flSave = await postFlipped(new Request("http://local/api/study/flipped", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			nodeId: firstLesson.id,
			note: { answers: { mechanism: "Deslocar a vírgula ajusta o expoente de 10." }, doubt: "Quando preferir prefixo de engenharia?", completedMaterials: ["book"] },
		}),
	}));
	assert.equal(flSave.status, 200);
	const flSaved = (await flSave.json()) as { ok: boolean; formatted: string };
	assert.equal(flSaved.ok, true);
	assert.ok(flSaved.formatted.length > 0 && flSaved.formatted.length <= 450);

	// 4. Module integrative exam GET (no key leak!) + POST submission -> updates transcript & profile.
	const exRes = await getExam(new Request(`http://local/api/study/module-exam?scope=module&target=${encodeURIComponent(mod.id)}&seed=api-seed`));
	assert.equal(exRes.status, 200);
	const exPayload = (await exRes.json()) as {
		exam: { id: string; seed: string; questions: { id: string; prompt: string; rubricCriteria: string[]; nodeId?: string; expectedTerms?: string[] }[] };
	};
	assert.ok(exPayload.exam.questions.length >= 3);
	for (const q of exPayload.exam.questions) {
		assert.equal(q.nodeId, undefined, "public exam payload must strip internal nodeId");
		assert.equal(q.expectedTerms, undefined, "public exam payload must strip internal expectedTerms");
	}
	const answers: Record<string, string> = {};
	for (const q of exPayload.exam.questions) {
		answers[q.id] = `Resolução fundamentada cobrindo ${q.rubricCriteria.join(" ")} com unidades SI, verificação de grandeza e justificativa física completa.`;
	}
	const exSubmit = await postExam(new Request("http://local/api/study/module-exam", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ scope: "module", targetId: mod.id, answers, seed: exPayload.exam.seed }),
	}));
	assert.equal(exSubmit.status, 200);
	const exResult = (await exSubmit.json()) as { score10: number; questionResults: unknown[]; fireCreditsCount: number };
	assert.equal(exResult.questionResults.length, exPayload.exam.questions.length);
	assert.equal(typeof exResult.fireCreditsCount, "number");

	// 5. Problem set + 4-step lab script GET + POST.
	const psRes = await getPset(new Request(`http://local/api/study/problem-set?module=${encodeURIComponent(mod.id)}&seed=ps-api`));
	assert.equal(psRes.status, 200);
	const psData = (await psRes.json()) as {
		seed: string;
		items: { id: string; prompt: string; rubricCriteria: string[] }[];
		lab?: { steps: { id: string }[] };
	};
	assert.ok(psData.items.length >= 4);
	assert.equal(psData.lab?.steps.length, 4);
	const psAnswers: Record<string, string> = {};
	for (const item of psData.items) psAnswers[item.id] = `Desenvolvimento passo a passo para ${item.rubricCriteria.join(" ")} com unidades corretas e conferência do resultado.`;
	const labNotes: Record<string, string> = {};
	for (const step of psData.lab!.steps) labNotes[step.id] = "Hipótese formulada pela relação teórica, circuito simulado medido e erro percentual analisado com justificativa física.";
	const psSubmit = await postPset(new Request("http://local/api/study/problem-set", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ moduleId: mod.id, answers: psAnswers, labNotes, seed: psData.seed }),
	}));
	assert.equal(psSubmit.status, 200);
	const psResult = (await psSubmit.json()) as { itemResults: unknown[]; labResult?: { passed: boolean } };
	assert.equal(psResult.itemResults.length, psData.items.length);
	assert.equal(psResult.labResult?.passed, true);

	// 6. Transcript API, Notebook API, and Profile integration.
	const trRes = await getTranscript(new Request("http://local/api/study/transcript"));
	assert.equal(trRes.status, 200);
	const tr = (await trRes.json()) as { chapters: { modules: { moduleId: string; examScore?: number }[] }[] };
	assert.ok(tr.chapters[0]!.modules.some(m => m.moduleId === mod.id && typeof m.examScore === "number"));

	const nbRes = await getNotebook(new Request("http://local/api/study/notebook"));
	assert.equal(nbRes.status, 200);
	const profile = studyProfile();
	const elecProfile = profile.domains.find(d => d.id === "electronics");
	assert.ok(elecProfile?.transcript, "studyProfile must include DomainTranscript for /profile");

	// 7. Adaptive KST Placement lifecycle: start -> answer 5x -> finish -> persists diagnostic event.
	const plStart = await postPlacement(new Request("http://local/api/study/placement", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ action: "start", seed: "place-api" }),
	}));
	assert.equal(plStart.status, 200);
	let current = (await plStart.json()) as { active: boolean; question: { nodeId: string } | null };
	assert.equal(current.active, true);
	assert.ok(current.question);

	for (let i = 0; i < 5 && current.question; i++) {
		const ansRes = await postPlacement(new Request("http://local/api/study/placement", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "answer", nodeId: current.question.nodeId, correct: i % 2 === 0 }),
		}));
		assert.equal(ansRes.status, 200);
		const ans = (await ansRes.json()) as { finished: boolean; question?: { nodeId: string } | null };
		if (ans.finished) { current = { active: false, question: null }; break; }
		current = { active: true, question: ans.question ?? null };
	}

	if (current.active) {
		const finRes = await postPlacement(new Request("http://local/api/study/placement", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "finish" }),
		}));
		assert.equal(finRes.status, 200);
		const fin = (await finRes.json()) as { finished: boolean; summary: { asked: number; totalLeaves: number } };
		assert.equal(fin.finished, true);
		assert.ok(fin.summary.asked >= 5);
	}

	const plAfter = await (await getPlacement()).json() as { active: boolean; lastSummary?: { totalLeaves: number } };
	assert.equal(plAfter.active, false);
	assert.ok(plAfter.lastSummary && plAfter.lastSummary.totalLeaves > 500);
	assert.equal((await deletePlacement()).status, 200);
});
