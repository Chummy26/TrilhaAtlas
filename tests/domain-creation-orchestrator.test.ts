import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { outline, lessons } from "./helpers/domain-generation.ts";

it("installs one generated curriculum, even after a resubmission, with the selected model and offline optional catalogs", async t => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "trilha-create-flow-"));
	process.env.LH_DATA_DIR = root;
	process.env.LH_AUTH_FILE = path.join(root, "auth.json");
	process.env.LH_IGNORE_ENV_KEYS = "1";
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const { startDomainCreation, domainCreationStatus } = await import("../src/server/create-study-domain.ts");
	const { studyToday, switchStudyDomain, listStudyDomains, studyMap } = await import("../src/server/study.ts");
	const { writeSettings } = await import("../src/store/settings.ts");
	const { authorizeFixture } = await import("./helpers/custom-provider-auth.ts");
	const { safeFetchOverride } = await import("../src/agent/tools/safe-fetch.ts");
	const pin = { provider: "custom", id: "test-local" };
	const baseUrl = "http://127.0.0.1:45678/v1";
	writeSettings({ version: 1, models: { strong: { model: pin } }, customProvider: authorizeFixture({
		baseUrl, authMode: "keyless", models: [{ id: pin.id, context: 65536, maxTokens: 8192 }],
	}) });
	const { installCustomProviderSource } = await import("../src/server/custom-provider.ts");
	installCustomProviderSource();
	const requestId = randomUUID();
	const input = { topic: "Interpretar o relevo", requestId };
	const progress: ReturnType<typeof domainCreationStatus>[] = [];
	let sent = 0;
	let planned: unknown[] | undefined;
	let catalogs = 0;
	const original = globalThis.fetch;
	t.after(() => { globalThis.fetch = original; safeFetchOverride.current = undefined; });
	safeFetchOverride.current = async () => { catalogs++; return new Response(null, { status: 503 }); };
	globalThis.fetch = async (url, options) => {
		assert.equal(String(url), baseUrl + "/chat/completions");
		assert.equal(JSON.parse(String(options?.body)).model, pin.id);
		progress.push(domainCreationStatus(requestId));
		const content = JSON.stringify(planned ? planned.shift() : sent ? lessons(sent - 1) : outline);
		sent++;
		const chunk = { choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] };
		const end = { choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 45 } };
		return new Response("data: " + JSON.stringify(chunk) + "\n\ndata: " + JSON.stringify(end) + "\n\ndata: [DONE]\n\n",
			{ headers: { "content-type": "text/event-stream" } });
	};
	let run!: () => Promise<void>;
	const schedule = (work: () => Promise<void>) => { run = work; };
	const prior = listStudyDomains().active;
	assert.equal(startDomainCreation(input, schedule).state, "planning");
	assert.equal(startDomainCreation(input, () => assert.fail("scheduled duplicate work")).state, "planning");
	await run();
	const status = domainCreationStatus(requestId);
	assert.ok(status.state === "ready", JSON.stringify(status));
	assert.equal(sent, 4);
	const lastProgress = progress.at(-1);
	assert.equal(lastProgress?.state, "planning");
	assert.ok(typeof lastProgress?.done === "number" && lastProgress.done >= 0 && lastProgress.done <= 3);
	assert.equal(lastProgress?.total, 3);
	assert.ok(catalogs >= 3);
	const replayed = startDomainCreation(input, () => assert.fail("replayed a completed job"));
	assert.equal(replayed.state, "ready");
	assert.equal(replayed.domainId, status.domainId);
	assert.equal(replayed.title, status.title);
	assert.throws(() => startDomainCreation({ ...input, topic: "Outro assunto" }, schedule), /outro domínio/);
	assert.equal(listStudyDomains().active, prior);
	switchStudyDomain(status.domainId);
	assert.equal(studyMap().nodes.length, 16);
	assert.equal(studyToday().next?.brief.title, "Identificar Curvas de nível");
	const curriculum = path.join(root, "domains", status.domainId, "curriculum");
	assert.deepEqual(JSON.parse(fs.readFileSync(path.join(curriculum, "sources.json"), "utf8")), []);
	const ledger = fs.readFileSync(path.join(curriculum, "ledger.jsonl"), "utf8").trim().split("\n");
	assert.equal(ledger.length, 1);
	assert.equal(JSON.parse(ledger[0]!).provenance.model, "custom:test-local");

	const focused = structuredClone(outline);
	focused.areas[0]!.regions.push({ ...focused.areas[0]!.regions[0]!, title: { pt: "Ler escala", en: "Read scale" } });
	focused.areas[1]!.regions[0]!.requires = [1, 2];
	focused.areas[2]!.regions[0]!.requires = [3];
	planned = [focused];
	for (let i = 0; i < 4; i++) {
		const base = lessons(0).skills;
		planned.push({ skills: [...base, { ...base[2], title: { pt: "Verificar o perfil", en: "Verify profile" }, requires: [3],
			practice: { targetHours: 8, sessions: 16, minutesPerSession: 30, variation: "Use uma carta diferente em cada semana.", exitCriterion: "Justificar uma rota em três cartas novas." } }],
		reviews: [1, 2].map(gain => ({ prompt: `De 50 a ${50 + gain} m, quanto se sobe? Escreva o número.`, answers: [String(gain)], explanation: "Subtraia a altura inicial da altura final." })) }, { issues: [] });
	}
	const timed = { ...input, requestId: randomUUID(), pace: "focused" };
	startDomainCreation(timed, schedule);
	await run();
	const ready = domainCreationStatus(timed.requestId);
	assert.ok(ready.state === "ready", JSON.stringify(ready));
	assert.deepEqual(ready.workload, { skills: 16, regions: 4, lessonHours: 5, practiceHours: 32 });
	assert.equal(planned.length, 0);
	assert.throws(() => startDomainCreation({ ...timed, pace: "extended" }, schedule), /outro domínio/);
	switchStudyDomain(ready.domainId);
	const { studyDomains } = await import("../src/server/study.ts");
	const profile = studyDomains().readProfile(ready.domainId)!;
	assert.equal(profile.dailyBudgetMin, 60);
	assert.equal(studyToday().progress.plannedPracticeHours, 32);
	assert.equal(profile.goal.targetNodeIds.length, 1);
	const today = studyToday();
	assert.equal(today.campaignGoal, undefined);
	assert.deepEqual(today.chapters?.map(c => c.total), [8, 4, 4]);
	assert.equal(today.next?.nodeId, today.chapters![0]!.entry);
	assert.ok(today.chapters!.every(c => c.landmarks.at(-1)!.id === c.finale));
	const bank = JSON.parse(fs.readFileSync(path.join(root, "domains", ready.domainId, "curriculum", "review-bank.json"), "utf8"));
	assert.equal(bank.length, 8);
	assert.ok(bank.some((task: { nodeId: string }) => task.nodeId === profile.goal.targetNodeIds[0]));
	studyDomains().updateProfile(ready.domainId, p => ({ ...p, goal: { text: "Minha próxima tarefa", targetNodeIds: [today.chapters![1]!.entry] } }));
	assert.equal(studyToday().campaignGoal, "Minha próxima tarefa");
});
