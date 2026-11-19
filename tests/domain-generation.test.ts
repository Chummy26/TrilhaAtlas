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
