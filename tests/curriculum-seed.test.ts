/**
 * Seed loading and the patch ledger (docs/research/00-SINTESE.md §2.4(e)
 * "seed entra como patch inicial", §2.13 ledger/replay; r10 §6.3; r3 §4.4
 * I1 ids imutáveis): normalizeSeedItem defaults, seedFilesToPatch errors,
 * applySeedFiles (+ transitive reduction) and replayLedger ⇒ same hash.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	applyPatch,
	applySeedFiles,
	checkSnapshotCertificate,
	CurriculumError,
	initialSnapshot,
	normalizeSeedItem,
	parseSeedFile,
	replayLedger,
	rootFromSeedEnvelope,
	seedFilesToPatch,
	validate,
	type CurriculumSeedFile,
	type CurriculumSnapshot,
	type PatchEnvelope,
	type SeedItem,
} from "../src/core/curriculum/index.ts";
import { envelope } from "./curriculum-fixtures.ts";

const CREATED = "2026-11-18T08:00:00.000Z";
const lvl = { scheme: "ee" as const, band: 1 as const };

function seed(id: string, parentId: string | null, kind: SeedItem["kind"], extra: Partial<SeedItem> = {}): SeedItem {
	return { id, kind, parentId, title: { pt: id, en: id }, summary: `resumo ${id}`, level: lvl, hours: kind === "atom" ? { lo: 0.25, hi: 0.5 } : { lo: 2, hi: 3 }, ...extra };
}

function file(areaId: string, items: SeedItem[], extra: Partial<CurriculumSeedFile> = {}): CurriculumSeedFile {
	return { schemaVersion: 1, domainId: "electronics", areaId, items, sources: [], ...extra };
}

/** Root + areas file, and one file per area (the content/curricula layout). */
function seedFiles(): CurriculumSeedFile[] {
	return [
		file("ee", [seed("ee", null, "domain", { hours: { lo: 100, hi: 200 } }), seed("ee.math", "ee", "area"), seed("ee.dc", "ee", "area", { clauses: [["ee.math"]] })]),
		file(
			"ee.math",
			[seed("ee.math.algebra", "ee.math", "atom"), seed("ee.math.calculus", "ee.math", "atom", { clauses: [["ee.math.algebra"]] })],
			{ edges: [{ from: "ee.math.algebra", to: "ee.math.calculus", kind: "related" }] },
		),
		file(
			"ee.dc",
			[
				seed("ee.dc.ohm", "ee.dc", "atom", { aliases: ["resistência"] }),
				seed("ee.dc.kvl", "ee.dc", "atom", { clauses: [["ee.dc.ohm"]] }),
				seed("ee.dc.nodal", "ee.dc", "topic", { clauses: [["ee.dc.kvl"], ["ee.math.calculus"]] }),
			],
			{ edges: [{ from: "ee.math.algebra", to: "ee.math.calculus", kind: "related" }] },
		),
	];
}

describe("normalizeSeedItem", () => {
	it("fills the documented defaults", () => {
		const it0 = normalizeSeedItem(seed("ee.dc.nodal", "ee.dc", "topic", { clauses: [["ee.dc.kvl", "ee.dc.kvl"], ["ee.dc.kvl", "ee.math"]] }), {
			domainId: "electronics",
			index: 4,
			createdAt: CREATED,
			hasChildren: false,
		});
		assert.equal(it0.status, "stub");
		assert.equal(it0.order, 4);
		assert.equal(it0.scope, "resumo ee.dc.nodal");
		assert.deepEqual(it0.clauses, [["ee.dc.kvl"]]);
		assert.deepEqual([it0.aliases, it0.objectives, it0.assess, it0.softPrereqs, it0.encompasses, it0.anchors], [[], [], [], [], [], []]);
		assert.equal(it0.version, 1);
		assert.deepEqual(it0.provenance, { createdBy: "seed", createdAt: CREATED });
		const container = normalizeSeedItem(seed("ee.dc", "ee", "area", { order: 7, scope: "escopo" }), { domainId: "electronics", index: 0, createdAt: CREATED, hasChildren: true });
		assert.equal(container.status, "stable");
		assert.equal(container.order, 7);
		assert.equal(container.scope, "escopo");
		const atom = normalizeSeedItem(seed("ee.dc.ohm", "ee.dc", "atom", { atomType: "concept", bloom: "apply", tags: ["base"] }), {
			domainId: "electronics",
			index: 0,
			createdAt: CREATED,
			hasChildren: false,
		});
		assert.equal(atom.status, "stable");
		assert.equal(atom.atomType, "concept");
		assert.equal(atom.bloom, "apply");
		assert.deepEqual(atom.tags, ["base"]);
		assert.equal("lexicalItems" in atom, false, "absent optional fields stay absent");
	});

	it("parseSeedFile reports zod paths", () => {
		const res = parseSeedFile({ schemaVersion: 1, domainId: "electronics", areaId: "ee", items: [{ id: "ee" }], sources: [] }, "ee.json");
		assert.equal(res.ok, false);
		if (!res.ok) assert.ok(res.errors.every((e) => e.code === "schema" && e.message.startsWith("ee.json.")));
	});
});

describe("seedFilesToPatch", () => {
	it("builds the initial envelope: parents first, root in the payloads, edges deduplicated", () => {
		const res = seedFilesToPatch(seedFiles(), { createdAt: CREATED });
		assert.ok(res.ok);
		if (!res.ok) return;
		const env = res.envelope;
		assert.equal(env.baseVersion, 0);
		assert.equal(env.trigger.kind, "seed");
		assert.equal(env.risk, "structural");
		assert.equal(env.patchId, "seed-electronics");
		const addIds = env.ops.flatMap((op) => (op.op === "addItem" ? [op.id] : []));
		assert.ok(addIds.indexOf("ee.math") < addIds.indexOf("ee.math.algebra"));
		assert.ok(!addIds.includes("ee"));
		assert.equal(env.ops.filter((op) => op.op === "addEdge").length, 1);
		assert.equal(res.root.id, "ee");
		assert.ok(env.itemPayloads.ee);
		const ohm = env.ops.find((op) => op.op === "addItem" && op.id === "ee.dc.ohm");
		assert.deepEqual(ohm && ohm.op === "addItem" ? ohm.clauses : null, "entry");
		assert.equal(rootFromSeedEnvelope(env).ok, true);
	});

	it("rejects empty input, mixed domains, duplicate ids, bad roots, unknown parents and parent cycles", () => {
		const fail = (files: unknown[], code: string, pattern?: RegExp) => {
			const res = seedFilesToPatch(files, { createdAt: CREATED });
			assert.ok(!res.ok, "esperado erro");
			if (!res.ok) assert.ok(res.errors.some((e) => e.code === code && (!pattern || pattern.test(e.message))), JSON.stringify(res.errors));
		};
		fail([], "schema", /nenhum arquivo/);
		fail([{ nope: true }], "schema");
		const [root, ...rest] = seedFiles();
		fail([root!, ...rest, file("x", [], { domainId: "outro" })], "schema", /domínio/);
		fail([root!, root!], "duplicate-id");
		fail([file("ee", [seed("ee.math", "ee", "area")])], "hierarchy", /exatamente uma raiz/);
		fail([file("ee", [seed("ee", null, "area")])], "hierarchy", /kind "domain"/);
		fail([file("ee", [seed("ee", null, "domain"), seed("ee.x", "ee.y", "atom")])], "unknown-id", /pai "ee\.y"/);
		fail([file("ee", [seed("ee", null, "domain"), seed("ee.x", "ee.y", "unit"), seed("ee.y", "ee.x", "unit")])], "hierarchy", /ciclo em parentId/);
	});

	it("a root-only seed still produces a valid patch", () => {
		const res = applySeedFiles([file("ee", [seed("ee", null, "domain")])], { createdAt: CREATED });
		assert.ok(res.ok, JSON.stringify(!res.ok && res.errors));
		if (res.ok) {
			assert.equal(res.snapshot.version, 1);
			assert.deepEqual(Object.keys(res.snapshot.items), ["ee"]);
		}
	});
});

describe("applySeedFiles", () => {
	it("yields a certified version-1 snapshot plus the envelope to store as ledger entry 0", () => {
		const res = applySeedFiles(seedFiles(), { createdAt: CREATED });
		assert.ok(res.ok, JSON.stringify(!res.ok && res.errors));
		if (!res.ok) return;
		const s = res.snapshot;
		assert.equal(s.version, 1);
		assert.equal(s.updatedAt, CREATED);
		assert.deepEqual(validate(s), []);
		assert.deepEqual(checkSnapshotCertificate(s), { ok: true });
		assert.equal(Object.keys(s.items).length, 8);
		assert.equal(s.items["ee.dc"]!.status, "stable");
		assert.equal(s.items["ee.dc.nodal"]!.status, "stub");
		assert.equal(s.items["ee.dc.ohm"]!.provenance.createdBy, "seed");
		assert.equal(s.edges.length, 1);
		assert.deepEqual(res.removed, []);
		assert.equal(res.receipt.fromVersion, 0);
	});

	it("invalid graphs are refused with the invariant errors", () => {
		const [root, math, dc] = seedFiles();
		const cyclic = file("ee.math", [seed("ee.math.algebra", "ee.math", "atom", { clauses: [["ee.math.calculus"]] }), seed("ee.math.calculus", "ee.math", "atom", { clauses: [["ee.math.algebra"]] })]);
		const res = applySeedFiles([root!, cyclic, dc!], { createdAt: CREATED });
		assert.ok(!res.ok && res.errors.some((e) => e.code === "cycle"));
		void math;
	});

	it("reduceTransitive drops implied members before the seed enters the ledger", () => {
		const files = [
			file("ee", [
				seed("ee", null, "domain"),
				seed("ee.a", "ee", "atom"),
				seed("ee.b", "ee", "atom", { clauses: [["ee.a"]] }),
				seed("ee.c", "ee", "atom", { clauses: [["ee.a", "ee.b"]] }),
			]),
		];
		const plain = applySeedFiles(files, { createdAt: CREATED });
		const reduced = applySeedFiles(files, { createdAt: CREATED, reduceTransitive: true });
		assert.ok(plain.ok && reduced.ok);
		if (!plain.ok || !reduced.ok) return;
		assert.deepEqual(plain.snapshot.items["ee.c"]!.clauses, [["ee.a", "ee.b"]]);
		assert.deepEqual(reduced.snapshot.items["ee.c"]!.clauses, [["ee.b"]]);
		assert.deepEqual(reduced.removed, [{ item: "ee.c", clauseIndex: 0, prereq: "ee.a", impliedBy: "ee.b" }]);
		assert.deepEqual(plain.snapshot.certificate.order, reduced.snapshot.certificate.order);
	});
});

describe("initialSnapshot / ledger replay", () => {
	it("initialSnapshot refuses a root that is not a parentless domain without clauses", () => {
		const seeded = seedFilesToPatch(seedFiles(), { createdAt: CREATED });
		assert.ok(seeded.ok);
		if (!seeded.ok) return;
		const root = seeded.root;
		assert.equal(initialSnapshot(root).version, 0);
		assert.throws(() => initialSnapshot({ ...root, kind: "area" }), CurriculumError);
		assert.throws(() => initialSnapshot({ ...root, parentId: "ee.x" }), CurriculumError);
		assert.throws(() => initialSnapshot({ ...root, clauses: [["ee.math"]] }), CurriculumError);
		assert.equal(rootFromSeedEnvelope({ ...seeded.envelope, trigger: { kind: "frontier", reason: "x", priority: 1 } }).ok, false);
	});

	function history(): { ledger: PatchEnvelope[]; final: CurriculumSnapshot } {
		const res = applySeedFiles(seedFiles(), { createdAt: CREATED });
		assert.ok(res.ok);
		if (!res.ok) throw new Error("seed");
		const ledger: PatchEnvelope[] = [res.envelope];
		let s = res.snapshot;
		const steps = [
			[{ op: "setHours", item: "ee.dc.nodal", hours: { lo: 1, hi: 1.5 } }, { op: "refine", item: "ee.dc.nodal", sub: [{ id: "ee.dc.nodal.kcl", kind: "atom", title: { pt: "KCL", en: "KCL" }, hours: { lo: 0.5, hi: 0.75 }, clauses: "entry" }, { id: "ee.dc.nodal.method", kind: "atom", title: { pt: "Método", en: "Method" }, hours: { lo: 0.5, hi: 0.75 }, clauses: [["ee.dc.nodal.kcl"]] }] }],
			[{ op: "addAlternative", item: "ee.dc.kvl", clause: ["ee.math.calculus"] }, { op: "updateItem", item: "ee.dc.ohm", fields: { summary: "V = R·I" } }],
			[{ op: "retire", item: "ee.dc.kvl", reroute: [{ item: "ee.dc.nodal", clause: ["ee.dc.ohm"] }] }],
		] as const;
		for (const ops of steps) {
			const env = envelope(s, ops as unknown as PatchEnvelope["ops"], { createdAt: `2026-11-1${8 + ledger.length}T09:00:00.000Z` });
			const r = applyPatch(s, env);
			assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
			if (!r.ok) throw new Error("patch");
			ledger.push(env);
			s = r.next;
		}
		return { ledger, final: s };
	}

	it("replaying the ledger (also after a JSON round trip) reproduces the same snapshot hash", () => {
		const { ledger, final } = history();
		const replay = replayLedger(ledger);
		assert.ok(replay.ok, JSON.stringify(!replay.ok && replay.errors));
		if (!replay.ok) return;
		assert.equal(replay.snapshot.certificate.hash, final.certificate.hash);
		assert.deepEqual(replay.snapshot, final);
		assert.equal(replay.receipts.length, ledger.length);
		const persisted = JSON.parse(JSON.stringify(ledger)) as unknown[];
		const again = replayLedger(persisted);
		assert.ok(again.ok && again.snapshot.certificate.hash === final.certificate.hash);
	});

	it("reports where a ledger breaks", () => {
		const { ledger } = history();
		assert.deepEqual(replayLedger([]), { ok: false, errors: [{ code: "schema", message: "ledger vazio: o primeiro patch deve ser o seed" }], failedAt: 0 });
		const notSeed = replayLedger(ledger.slice(1));
		assert.ok(!notSeed.ok && notSeed.failedAt === 0);
		const swapped = replayLedger([ledger[0]!, ledger[2]!, ledger[1]!]);
		assert.ok(!swapped.ok && swapped.failedAt === 1 && swapped.errors[0]!.message.includes("conflito de versão"));
	});
});
