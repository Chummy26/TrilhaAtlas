import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";
import { createFauxCore, createAssistantMessageEventStream, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { outline, lessons } from "./helpers/domain-generation.ts";
import type { PiEngine } from "../src/agent/models.ts";
import { applySeedFiles, replayLedger } from "../src/core/curriculum/ledger.ts";
import { learnerViewOf } from "../src/core/study/projection.ts";
import { validate } from "../src/core/curriculum/invariants.ts";
import { applyPatch } from "../src/core/curriculum/patch.ts";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "trilha-authoring-"));
process.env.LH_DATA_DIR = sandbox;
process.env.LH_AUTH_FILE = path.join(sandbox, "auth.json");
const { generateDomainCurriculum } = await import("../src/server/domain-generation.ts");
after(() => fs.rmSync(sandbox, { force: true, recursive: true }));

const input = { topic: "Interpretar relevo em mapas", prefix: "to", domainId: "topography" };

function scripted(outputs: unknown[]) {
	const calls: string[] = [];
	const model = createFauxCore({}).getModel();
	const engine: PiEngine = {
		model, streamFn: (_model, context) => {
			calls.push(JSON.stringify(context.messages));
			assert.ok(outputs.length, "unexpected extra model call");
			const reply = createAssistantMessageEventStream();
			reply.end(fauxAssistantMessage(JSON.stringify(outputs.shift())));
			return reply;
		},
	};
	return { engine, calls };
}

it("builds a connected staged graph, passes real validation/replay and requests both resources in every unit", async () => {
	const invalid = lessons(1);
	invalid.skills[0]!.requires = [2];
	const { calls, engine } = scripted([outline, lessons(0), invalid, lessons(1), lessons(2)]);
	const progress: number[][] = [];
	const result = await generateDomainCurriculum({ ...input, model: { provider: "faux", id: "selected" },
		onProgress: (done, total) => progress.push([done, total]) }, async (domain, model) => {
		assert.equal(domain, input.domainId);
		assert.equal(model?.id, "selected");
		return engine;
	});
	assert.equal(result.regions.length, 3);
	for (const r of result.regions) {
		assert.ok(r.bookQuery.includes(r.title) && r.videoQuery.includes(r.title));
		assert.ok(result.seed.items.some(i => i.kind === "unit" && i.id === r.id));
	}
	assert.deepEqual(progress, [[0, 3], [1, 3], [2, 3], [3, 3]]);
	assert.ok(calls[3]!.includes("correction"));
	assert.equal(result.seed.sources.length, 0, "only verified catalog hits become links");
	const applied = applySeedFiles([result.seed], { createdAt: "2026-11-19", edgeMode: "strict" });
	assert.ok(applied.ok);
	const replay = replayLedger([applied.envelope]);
	assert.ok(replay.ok);
	assert.deepEqual(replay.snapshot.certificate, applied.snapshot.certificate);
	const view = learnerViewOf(applied.snapshot);
	assert.deepEqual(view.nodes.get("to.a1.r1.s1")?.clauses, []);
	assert.deepEqual(view.nodes.get("to.a2.r2.s1")?.clauses, [["to.a1.r1.s3"]]);
	assert.deepEqual(view.nodes.get("to.a3.r3.s3")?.clauses, [["to.a3.r3.s2"]]);
	assert.equal(view.nodes.get("to.a3.r3.s3")?.depth, 8);
	const capstone = applied.snapshot.items["to.a3.r3.s3"]!;
	assert.equal(capstone.practice?.targetHours, 12);
	assert.match(capstone.scope, /três cartas desconhecidas/);
});

it("rejects unresolved region dependencies after a single repair and cancels before paying for the next region", async () => {
	const broken = structuredClone(outline);
	broken.areas[1]!.regions[0]!.requires = [3];
	const rejected = scripted([broken, broken]);
	await assert.rejects(generateDomainCurriculum(input, async () => rejected.engine), /currículo/);
	assert.equal(rejected.calls.length, 2);
	const controller = new AbortController();
	const cancelled = scripted([outline, lessons(0)]);
	await assert.rejects(generateDomainCurriculum({ ...input, signal: controller.signal,
		onProgress: done => { if (done === 1) controller.abort(); } }, async () => cancelled.engine), /abort/i);
	assert.equal(cancelled.calls.length, 2);
});

it("gives the repair call the rejected draft and the location of an invalid assessment", async () => {
	const bad = lessons(0);
	const skill = { ...bad.skills[1], assessment: ["unique rejected assessment"] };
	const draft = { skills: [bad.skills[0], skill, bad.skills[2]] };
	const { engine, calls } = scripted([outline, draft, lessons(0), lessons(1), lessons(2)]);
	await generateDomainCurriculum(input, async () => engine);
	assert.match(calls[2]!, /skills\.1\.assessment/);
	assert.match(calls[2]!, /unique rejected assessment/);
});

it("rejects a reachable final that bypasses a foundation and a later region that skips a stage", async () => {
	const skipped = lessons(0);
	skipped.skills[2]!.requires = [1];
	const region = scripted([outline, skipped, skipped]);
	await assert.rejects(generateDomainCurriculum(input, async () => region.engine), /habilidade 2/i);
	const jump = structuredClone(outline);
	jump.areas[2]!.regions.push({ ...jump.areas[2]!.regions[0]!, title: { pt: "Projeto paralelo", en: "Parallel project" }, requires: [1] });
	const stages = scripted([jump, jump]);
	await assert.rejects(generateDomainCurriculum(input, async () => stages.engine), /Projeto paralelo/);
});

it("rejects a miniature outline when an extended campaign was requested", async () => {
	const mock = scripted([outline, outline]);
	await assert.rejects(generateDomainCurriculum({ ...input, pace: "extended" }, async () => mock.engine), /regiões/);
	assert.equal(mock.calls.length, 2);
});

it("checks every alternative after authoring, including an acyclic shortcut and an orphaned local ingredient", async () => {
	const mock = scripted([outline, lessons(0), lessons(1), lessons(2)]);
	const { seed } = await generateDomainCurriculum(input, async () => mock.engine);
	const result = applySeedFiles([seed], { createdAt: "2026-11-19" });
	assert.ok(result.ok);
	const snapshot = structuredClone(result.snapshot);
	snapshot.items["to.a3.r3"]!.clauses.push(["to.a1.r1.s3"]);
	snapshot.items["to.a2.r2.s3"]!.clauses = [["to.a2.r2.s1"]];
	const errors = validate(snapshot);
	assert.ok(errors.some(e => e.witness?.includes("to.a3.r3.s1") && e.message.includes("etapa")));
	assert.ok(errors.some(e => e.witness?.includes("to.a2.r2.s2") && e.message.includes("saída")));
	const removeContract = applyPatch(result.snapshot, { ...result.envelope, patchId: "strip-campaign", baseVersion: result.snapshot.version,
		ops: [{ op: "updateItem", item: "to", fields: { tags: [] } }], itemPayloads: {} });
	assert.ok(!removeContract.ok && removeContract.errors.some(e => e.message.includes("contrato")));
	const extraExit = structuredClone(result.snapshot);
	extraExit.items["to.a1.r1.s1"]!.tags = ["region-exit"];
	assert.ok(validate(extraExit).some(e => e.message.includes("uma única saída")));
	const localBypass = structuredClone(result.snapshot);
	localBypass.items["to.a2.r2.s2"]!.clauses.push(["to.a1.r1.s3"]);
	assert.ok(validate(localBypass).some(e => e.witness?.includes("to.a2.r2.s1") && e.message.includes("fundamento")));
});

it("sends a structurally valid but pedagogically rejected region back for repair and stops on a repeated gap", async () => {
	const four = structuredClone(outline);
	four.areas[0]!.regions.push({ ...four.areas[0]!.regions[0]!, title: { pt: "Ler a escala", en: "Read scale" } });
	four.areas[1]!.regions[0]!.requires = [1, 2];
	four.areas[2]!.regions[0]!.requires = [3];
	const skills = lessons(0).skills;
	const region = { skills: [...skills, { ...skills[2], title: { pt: "Comparar trajetos", en: "Compare routes" }, requires: [3],
		practice: { targetHours: 8, sessions: 16, minutesPerSession: 30, variation: "Mude a escala em cada carta.", exitCriterion: "Explicar a escala de cada carta." } }],
		reviews: [1, 2].map(i => ({ prompt: "Qual o desnível no novo trajeto " + i + "?", answers: ["15"], explanation: "A diferença entre as cotas é 15 m." })) };
	const issue = { issues: [{ skill: 1, reason: "A primeira tarefa usa declividade sem ensinar escala.", fix: "Introduza a leitura da escala antes do cálculo." }] };
	const mock = scripted([four, region, issue, region, issue]);
	await assert.rejects(generateDomainCurriculum({ ...input, pace: "focused" }, async () => mock.engine), /declividade/);
	assert.equal(mock.calls.length, 5);
	assert.ok(mock.calls[3]!.includes("Introduza a leitura da escala"));
});
