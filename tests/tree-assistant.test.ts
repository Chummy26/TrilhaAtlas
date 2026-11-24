import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";
import { createAssistantMessageEventStream, createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { PiEngine } from "../src/agent/models.ts";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "lh-tree-assistant-"));
process.env.LH_DATA_DIR = sandbox;
process.env.LH_AUTH_FILE = path.join(sandbox, "auth.json");

const { switchStudyDomain, studyMap, readRegionMaterials, runTreeAssistant } = await import("../src/server/index.ts");
after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

function fakeEngine(payload: unknown): PiEngine {
	const model = createFauxCore({}).getModel();
	return {
		model,
		streamFn: () => {
			const stream = createAssistantMessageEventStream();
			stream.end(fauxAssistantMessage(JSON.stringify(payload)));
			return stream;
		},
	};
}

it("executes update_node, add_skill, and add_material safely via versioned ledger patches", async () => {
	switchStudyDomain("electronics");
	const initial = studyMap();
	const unit = initial.nodes.find(n => n.kind === "unit")!;
	const leaf = initial.nodes.find(n => n.region === unit.id && n.leaf)!;

	const result = await runTreeAssistant(
		{
			domain: "electronics",
			selectedNodeId: leaf.id,
			prompt: "Melhore este nó, crie uma habilidade prática na mesma região e adicione o PDF https://ocw.mit.edu/circuits-lab.pdf",
		},
		async () =>
			fakeEngine({
				reply: "Atualizei o nó, criei a nova habilidade prática e vinculei o PDF indicado.",
				actions: [
					{
						type: "update_node",
						nodeId: leaf.id,
						summary: "Resolva três exercícios práticos de bancada medindo tensão e corrente com multímetro.",
						objectives: ["Aplicar notação científica e prefixos métricos em leituras reais de bancada."],
					},
					{
						type: "add_skill",
						regionId: unit.id,
						titlePt: "Leitura prática de prefixos no osciloscópio",
						titleEn: "Oscilloscope Metric Prefix Reading",
						summary: "Converter escalas em mV/div e µs/div em medidas reais de amplitude e período.",
						objective: "Ler e converter escalas métricas diretamente na grade do osciloscópio.",
						assessment: "Converter corretamente 4 leituras consecutivas sem erro de ordem de grandeza.",
						bloom: "apply",
						minutes: 25,
						requires: [leaf.id],
					},
					{
						type: "add_material",
						nodeId: leaf.id,
						kind: "book",
						title: "MIT Circuits Lab Notes",
						part: "Lab 1 · Measurement and Units",
						url: "https://ocw.mit.edu/circuits-lab.pdf",
						lang: "en",
					},
				],
			}),
	);

	assert.equal(result.refreshedMap, true);
	assert.equal(result.refreshedMaterials, true);
	assert.equal(result.applied.length, 3);
	assert.ok(result.applied.every(a => a.ok), JSON.stringify(result.applied));

	const updatedMap = studyMap();
	assert.equal(updatedMap.nodes.length, initial.nodes.length + 1);
	assert.ok(updatedMap.nodes.some(n => n.title === "Leitura prática de prefixos no osciloscópio"));

	const shelf = await readRegionMaterials("electronics", leaf.id);
	assert.ok(shelf.materials.some(m => m.url === "https://ocw.mit.edu/circuits-lab.pdf" && m.manual));
});
