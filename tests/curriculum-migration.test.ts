import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import releaseV2 from "../content/curriculum-revisions/electronics-v2.json";
import releaseV3 from "../content/curriculum-revisions/electronics-v3.json";
import { applySeedFiles, replayLedger } from "../src/core/curriculum/ledger.ts";
import { applyPatch } from "../src/core/curriculum/patch.ts";
import { electronicsManifest } from "../src/core/domains/defaults.ts";
import { foldEvents } from "../src/core/learner/fold.ts";
import { DEFAULT_LEARNER_PARAMS } from "../src/core/learner/params.ts";
import type { LearnerEvent } from "../src/core/learner/types.ts";
import { learnerViewOf } from "../src/core/study/projection.ts";
import { envelope, item, T0 } from "./curriculum-fixtures.ts";

test("replay applies the shipped revision after local patches without resetting node versions", () => {
	const a = "ee.a";
	const b = "ee.b";
	const seeded = applySeedFiles([{
		schemaVersion: 1,
		domainId: "electronics",
		areaId: "ee",
		sources: [],
		items: [
			item("ee", null, "domain"),
			item(a, "ee", "atom"),
			item(b, "ee", "atom", { clauses: [[a]], summary: "Original" }),
		].map(({ domainId, version, provenance, ...seedItem }) => seedItem),
	}], { createdAt: T0 });
	assert.ok(seeded.ok, JSON.stringify(seeded));
	const local = envelope(seeded.snapshot, [{ op: "updateItem", item: b, fields: { summary: "Anotação local" } }]);
	const changed = applyPatch(seeded.snapshot, local);
	assert.ok(changed.ok);
	const revision = {
		kind: "seed-revision",
		revision: "electronics-test-v2",
		domainId: "electronics",
		baseVersion: changed.next.version,
		createdAt: T0,
		items: { [b]: { clauses: [], summary: "Revisado" } },
	};
	const replay = replayLedger([seeded.envelope, local, revision]);
	assert.ok(replay.ok, JSON.stringify(replay));
	assert.deepEqual(replay.snapshot.items[b]?.clauses, []);
	assert.equal(replay.snapshot.items[b]?.summary, "Revisado");
	assert.equal(replay.snapshot.items[b]?.version, changed.next.items[b]?.version);
	assert.equal(replay.snapshot.version, 3);
});

test("concurrent loads migrate once and recover a stale snapshot without losing local curriculum or learner progress", async (t) => {
	const data = fs.mkdtempSync(path.join(os.tmpdir(), "learnharness-curriculum-migration-"));
	const previousData = process.env.LH_DATA_DIR;
	t.after(() => {
		if (previousData === undefined) delete process.env.LH_DATA_DIR;
		else process.env.LH_DATA_DIR = previousData;
		fs.rmSync(data, { recursive: true, force: true });
	});
	process.env.LH_DATA_DIR = data;
	const { loadCurriculum } = await import("../src/server/study.ts");
	const manifest = electronicsManifest(T0);
	const fresh = loadCurriculum("electronics", manifest);
	assert.ok(fresh);
	for (const [id, fields] of Object.entries(releaseV3)) {
		const current = fresh.snapshot.items[id] as unknown as Record<string, unknown>;
		for (const [field, { after }] of Object.entries(fields)) {
			assert.deepEqual(current[field], after, `O artefato de migração v3 diverge dos seeds em ${id}.${field}`);
		}
	}
	for (const [id, fields] of Object.entries(releaseV2)) {
		const current = fresh.snapshot.items[id] as unknown as Record<string, unknown>;
		const v3Overrides = (releaseV3 as Record<string, Record<string, unknown>>)[id];
		for (const [field, { after }] of Object.entries(fields)) {
			if (v3Overrides && field in v3Overrides) continue;
			assert.deepEqual(current[field], after, `O artefato de migração v2 diverge dos seeds em ${id}.${field}`);
		}
	}
	const dir = path.join(data, "domains", "electronics", "curriculum");
	const ledgerFile = path.join(dir, "ledger.jsonl");
	const snapshotFile = path.join(dir, "snapshot.json");
	const freshSeed = JSON.parse(fs.readFileSync(ledgerFile, "utf8"));
	assert.equal(freshSeed.provenance.promptVersion, "seed-electronics-v3");

	const nodeId = "ee.ac.threephase.mains-br";
	const upgradedId = "ee.ac.frequency.bode";
	const v3UpgradedId = "ee.math.algebra.sci-notation.powers-of-ten";
	const legacySeed = structuredClone({
		...freshSeed,
		provenance: { ...freshSeed.provenance, promptVersion: "seed-v1" },
	});
	legacySeed.itemPayloads[nodeId].scope = "Dentro: tensões de distribuição, tomadas, esquemas de aterramento, DR, DPS. Fora: projeto de instalações.";
	legacySeed.itemPayloads[upgradedId].scope = "Dentro: Bode assintótico de módulo e fase, polos e zeros reais e complexos. Fora: estabilidade de malha.";
	legacySeed.itemPayloads[v3UpgradedId].summary = "Escrever números muito grandes e muito pequenos como mantissa × 10ⁿ e operar com expoentes.";
	legacySeed.itemPayloads[v3UpgradedId].scope = "Escrever números muito grandes e muito pequenos como mantissa × 10ⁿ e operar com expoentes.";
	legacySeed.itemPayloads[v3UpgradedId].objectives = [
		"Converter números entre a forma decimal e a notação científica",
		"Multiplicar e dividir grandezas em notação científica aplicando as regras de expoentes",
	];
	const original = replayLedger([legacySeed], { edgeMode: "strict" });
	assert.ok(original.ok);
	const addedId = "ee.custom-test";
	const patch = envelope(original.snapshot, [
		{ op: "updateItem", item: nodeId, fields: { scope: "Nota local" } },
		{ op: "addItem", id: addedId, parentId: "ee", kind: "area",
			title: { pt: "Minha área", en: "My area" }, hours: { lo: 1, hi: 2 }, clauses: "entry" },
	]);
	const local = applyPatch(original.snapshot, patch, { edgeMode: "strict" });
	assert.ok(local.ok);
	const previousLedger = [legacySeed, patch].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
	fs.writeFileSync(ledgerFile, previousLedger);
	fs.writeFileSync(snapshotFile, JSON.stringify(local.next));
	const learnerId = Object.values(local.next.items).find((node) => node.kind === "atom")!.id;
	const events: LearnerEvent[] = [{ kind: "diagnostic", id: "known", seq: 1, at: T0, domainId: "electronics",
		estimates: [{ nodeId: learnerId, p: 0.9 }] }];
	const previousProgress = foldEvents(null, events, learnerViewOf(local.next), DEFAULT_LEARNER_PARAMS);

	const run = promisify(execFile);
	const code = `
		import { loadCurriculum } from "./src/server/study.ts";
		import { electronicsManifest } from "./src/core/domains/defaults.ts";
		const result = loadCurriculum("electronics", electronicsManifest(${JSON.stringify(T0)}));
		process.stdout.write(JSON.stringify({
			pid: process.pid,
			version: result?.snapshot.version,
			hash: result?.snapshot.certificate.hash,
		}));
	`;
	const readers = await Promise.all(Array.from({ length: 2 }, () =>
		run(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", code], {
			env: { ...process.env, LH_DATA_DIR: data },
		})));
	const migrated = loadCurriculum("electronics", manifest);
	assert.ok(migrated);
	assert.equal(migrated.snapshot.version, 4);
	const results = readers.map((reader) => JSON.parse(reader.stdout) as { pid: number; version: number; hash: string });
	for (const { version, hash } of results) {
		assert.equal(version, 4);
		assert.equal(hash, migrated.snapshot.certificate.hash);
	}
	assert.equal(migrated.snapshot.items[upgradedId]?.scope, fresh.snapshot.items[upgradedId]?.scope);
	assert.notEqual(original.snapshot.items[upgradedId]?.scope, migrated.snapshot.items[upgradedId]?.scope);
	assert.equal(migrated.snapshot.items[v3UpgradedId]?.summary, fresh.snapshot.items[v3UpgradedId]?.summary);
	assert.notEqual(original.snapshot.items[v3UpgradedId]?.summary, migrated.snapshot.items[v3UpgradedId]?.summary);
	assert.equal(migrated.snapshot.items[nodeId]?.scope, "Nota local");
	assert.equal(migrated.snapshot.items[nodeId]?.version, local.next.items[nodeId]?.version);
	assert.deepEqual(migrated.snapshot.items[addedId], local.next.items[addedId]);
	assert.deepEqual(foldEvents(null, events, migrated.view, DEFAULT_LEARNER_PARAMS), previousProgress);

	const completedLedger = fs.readFileSync(ledgerFile, "utf8");
	assert.ok(completedLedger.startsWith(previousLedger));
	const tokens = completedLedger.trimEnd().split("\n").map((line) => JSON.parse(line));
	assert.deepEqual(tokens.slice(0, 2), [legacySeed, patch]);
	assert.equal(tokens[2]?.revision, "electronics-v2");
	assert.equal(tokens[3]?.revision, "electronics-v3");
	const replay = replayLedger(tokens, { edgeMode: "strict" });
	assert.ok(replay.ok);
	assert.deepEqual(replay.snapshot, migrated.snapshot);

	fs.writeFileSync(snapshotFile, JSON.stringify(local.next)); // ledger replacement succeeded, snapshot replacement did not
	const lock = path.join(dir, ".revision-lock");
	fs.mkdirSync(lock);
	fs.writeFileSync(path.join(lock, `${results[0]!.pid}-.revision-lock-interrupted`), "");
	const recovered = loadCurriculum("electronics", manifest);
	assert.deepEqual(recovered?.snapshot, migrated.snapshot);
	assert.equal(fs.readFileSync(ledgerFile, "utf8"), completedLedger);
	assert.deepEqual(JSON.parse(fs.readFileSync(snapshotFile, "utf8")), migrated.snapshot);
	assert.equal(fs.existsSync(lock), false);

	const divergent = JSON.stringify({ ...migrated.snapshot, version: migrated.snapshot.version + 1 });
	fs.writeFileSync(snapshotFile, divergent);
	assert.throws(() => loadCurriculum("electronics", manifest), /snapshot local .* diverge/);
	assert.equal(fs.readFileSync(snapshotFile, "utf8"), divergent);
	assert.equal(fs.readFileSync(ledgerFile, "utf8"), completedLedger);
});
