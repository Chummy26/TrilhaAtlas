import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { applySeedFiles } from "../src/core/curriculum/ledger.ts";
import type { CurriculumSeedFile } from "../src/core/curriculum/types.ts";
import { campaignFinale, studyCampaign } from "../src/core/study/campaign.ts";
import { learnerViewOf } from "../src/core/study/projection.ts";

it("reopens the relevant chapter when an installed tree grows after the original route was completed", () => {
	const file: CurriculumSeedFile = JSON.parse(readFileSync(new URL("../examples/study-domain/map-reading/00-map.json", import.meta.url), "utf8"));
	const load = () => {
		const result = applySeedFiles([file], { createdAt: "2026-01-01T00:00:00Z", edgeMode: "strict" });
		assert.ok(result.ok);
		return { snapshot: result.snapshot, graph: learnerViewOf(result.snapshot) };
	};
	const original = load();
	const known = new Set(original.graph.ids.filter(id => original.graph.nodes.get(id)!.isLeaf));
	assert.ok(studyCampaign(original.snapshot, original.graph, known).journey.every(c => c.known === c.total));
	const lesson = file.items.find(i => i.kind === "atom")!;
	const addition = { ...lesson, id: lesson.id + "-practice", order: 10, clauses: [[lesson.id]] };
	file.items.push(addition);
	const next = load();
	const campaign = studyCampaign(next.snapshot, next.graph, known);
	assert.equal(campaign.journey[0]!.known, known.size);
	assert.equal(campaign.journey[0]!.total, known.size + 1);
	assert.ok(campaign.priority(addition.id) > 0);
});

it("orders legacy stages by feasible routes, including alternative and whole-unit prerequisites", () => {
	const file: CurriculumSeedFile = JSON.parse(readFileSync(new URL("../examples/study-domain/map-reading/00-map.json", import.meta.url), "utf8"));
	const unit = file.items.find(i => i.kind === "unit")!;
	const atom = file.items.find(i => i.kind === "atom")!;
	const add = (suffix: string, level: number, clauses: string[][], parentId = unit.id) => {
		const id = parentId + "." + suffix;
		file.items.push({ ...atom, id, parentId, order: file.items.length, level: { scheme: "generic", band: level }, clauses });
		return id;
	};
	const advanced = add("instrument", 2, []);
	const misplaced = add("calibration", 0, [[advanced]]);
	const alternative = add("measure", 0, [[advanced], [atom.id]]);
	const nextUnit = unit.id + "-field";
	file.items.push({ ...unit, id: nextUnit, order: 1 });
	const field = add("fieldwork", 0, [[unit.id]], nextUnit);
	const result = applySeedFiles([file], { createdAt: "2026-01-01T00:00:00Z", edgeMode: "strict" });
	assert.ok(result.ok, JSON.stringify(result.ok ? [] : result.errors));
	const view = learnerViewOf(result.snapshot);
	const known = new Set<string>();
	const campaign = () => studyCampaign(result.snapshot, view, known);
	const first = campaign();
	assert.deepEqual(first.journey.map(c => c.total), [3, 3]);
	assert.ok(first.priority(alternative));
	assert.equal(first.priority(misplaced), 0);
	assert.equal(first.priority(field), 0);
	for (const id of view.ids) if (first.priority(id)) known.add(id);
	const last = campaign();
	assert.ok([advanced, misplaced, field].every(id => last.priority(id) > 0));
	assert.equal(last.journey[1]!.finale, field);
	assert.equal(campaignFinale(result.snapshot, last, field), result.snapshot.items[field]!.objectives[0]);
	for (const id of [advanced, misplaced, field]) known.add(id);
	assert.ok(campaign().journey.every(c => c.total === c.known));
});
