/**
 * Curriculum core primitives (docs/research/00-SINTESE.md §2.13; r10 §3.1,
 * §6.1–6.3): the effective clause system (inherited entry requirements,
 * milestones, absorption), deterministic Kahn + cycle witnesses, forward
 * chaining, the certificate (canonical JSON, FNV-1a 64, independent checkers),
 * hours roll-up/bounds, granularity bands and transitive-edge detection.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import {
	absorb,
	allLeaves,
	ancestorsOf,
	andDnf,
	asIndex,
	atomHoursVerdict,
	buildEffectiveSystem,
	canonicalJson,
	checkCycleWitness,
	checkRankCertificate,
	checkSnapshotCertificate,
	checkTopoCertificate,
	childrenOf,
	computeCertificate,
	curriculumIndex,
	CurriculumError,
	descendantsOf,
	effectiveClausesOf,
	effectiveKahn,
	entryRequirementsOf,
	findRedundantPrereqs,
	fnv1a64Hex,
	formatMinutes,
	forwardChain,
	granularityFindings,
	hashSnapshot,
	hoursMid,
	isLeaf,
	kahnOrder,
	leafGranularityFinding,
	leavesOf,
	lowerBoundHmax,
	normalizeClauses,
	pathTo,
	prerequisiteDepth,
	reduceStoredClauses,
	refineCandidates,
	rollupHours,
	rootOf,
	sameClauses,
	sumHours,
	toContractClauses,
	totalHours,
	upperBoundAdditive,
	validateReport,
} from "../src/core/curriculum/index.ts";
import { item, sampleSnapshot, snapshot } from "./curriculum-fixtures.ts";

/** Reference FNV-1a 64 with BigInt over Node's UTF-8 encoder (independent of the limb implementation). */
function fnvReference(text: string): string {
	let h = 0xcbf29ce484222325n;
	for (const byte of Buffer.from(text, "utf8")) {
		h ^= BigInt(byte);
		h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
	}
	return h.toString(16).padStart(16, "0");
}

describe("certificate: canonical JSON and FNV-1a 64", () => {
	it("matches the published FNV-1a 64 vectors", () => {
		assert.equal(fnv1a64Hex(""), "cbf29ce484222325");
		assert.equal(fnv1a64Hex("a"), "af63dc4c8601ec8c");
		assert.equal(fnv1a64Hex("foobar"), "85944171f73967e8");
	});

	it("hashes the UTF-8 bytes (accents, CJK, astral code points) like a BigInt reference", () => {
		for (const s of ["Função de Transferência", "電子回路", "𝛑 ≈ 3,14 🎛️", "\u0000\u007f\u0080߿ࠀ￿"]) assert.equal(fnv1a64Hex(s), fnvReference(s));
		fc.assert(
			fc.property(
				fc.string({ unit: "binary", maxLength: 40 }).filter((s) => Buffer.from(s, "utf8").toString("utf8") === s),
				(s) => fnv1a64Hex(s) === fnvReference(s),
			),
			{ numRuns: 300 },
		);
	});

	it("canonicalJson sorts keys, drops undefined members and is insertion-order independent", () => {
		assert.equal(canonicalJson({ b: 1, a: [3, { d: undefined, c: "x" }], e: null }), '{"a":[3,{"c":"x"}],"b":1,"e":null}');
		assert.equal(canonicalJson([undefined, 1]), "[null,1]");
		assert.equal(canonicalJson(undefined), "null");
		fc.assert(
			fc.property(fc.dictionary(fc.string({ maxLength: 4 }), fc.jsonValue({ maxDepth: 2 })), (obj) => {
				const reversed = Object.fromEntries(Object.entries(obj).reverse());
				const text = canonicalJson(obj);
				return text === canonicalJson(reversed) && canonicalJson(JSON.parse(text)) === text;
			}),
			{ numRuns: 200 },
		);
	});

	it("hashSnapshot ignores certificate/updatedAt and key/edge order, but sees every item field", () => {
		const s = sampleSnapshot();
		const h = hashSnapshot(s);
		assert.equal(hashSnapshot({ ...s, certificate: { order: [], hash: "x" }, updatedAt: "outro" } as typeof s), h);
		const reordered = { ...s, items: Object.fromEntries(Object.entries(s.items).reverse()) };
		assert.equal(hashSnapshot(reordered), h);
		const e1 = { from: "ee.dc.ohm", to: "ee.dc.kvl", kind: "related" as const };
		const e2 = { from: "ee.math.algebra", to: "ee.math.calculus", kind: "related" as const };
		assert.equal(hashSnapshot({ ...s, edges: [e1, e2] }), hashSnapshot({ ...s, edges: [e2, e1] }));
		const touched = { ...s, items: { ...s.items, "ee.dc.ohm": { ...s.items["ee.dc.ohm"]!, summary: "novo" } } };
		assert.notEqual(hashSnapshot(touched), h);
		assert.notEqual(hashSnapshot({ ...s, version: s.version + 1 }), h);
		assert.match(h, /^[0-9a-f]{16}$/);
	});
});

describe("certificate: independent checkers", () => {
	it("checkTopoCertificate accepts a topological order and names each failure", () => {
		const nodes = ["a", "b", "c"];
		const edges: [string, string][] = [
			["a", "b"],
			["b", "c"],
		];
		assert.deepEqual(checkTopoCertificate(nodes, edges, ["a", "b", "c"]), { ok: true });
		assert.match((checkTopoCertificate(nodes, edges, ["a", "b"]) as { reason: string }).reason, /2 entradas/);
		assert.match((checkTopoCertificate(nodes, edges, ["a", "a", "c"]) as { reason: string }).reason, /repete/);
		assert.match((checkTopoCertificate(nodes, edges, ["a", "b", "z"]) as { reason: string }).reason, /não está na ordem/);
		assert.match((checkTopoCertificate(nodes, edges, ["b", "a", "c"]) as { reason: string }).reason, /para trás/);
		assert.match((checkTopoCertificate(nodes, [["a", "q"]], ["a", "b", "c"]) as { reason: string }).reason, /desconhecida/);
	});

	it("checkRankCertificate enforces R1 (some alternative), R2 (members first) and R3 (known ids)", () => {
		const ok = new Map([
			["a", [[]]],
			["b", [["a"]]],
			["c", [["a", "b"], ["a"]]],
		]);
		assert.deepEqual(checkRankCertificate(ok, ["a", "b", "c"]), { ok: true });
		assert.match((checkRankCertificate(ok, ["b", "a", "c"]) as { reason: string }).reason, /R2/);
		assert.match((checkRankCertificate(new Map([...ok, ["d", []]]), ["a", "b", "c", "d"]) as { reason: string }).reason, /R1/);
		assert.match((checkRankCertificate(new Map([["a", [["zz"]]]]), ["a"]) as { reason: string }).reason, /R3/);
		assert.equal(checkRankCertificate(ok, ["a", "b"]).ok, false);
		assert.equal(checkRankCertificate(ok, ["a", "a", "c"]).ok, false);
	});

	it("checkCycleWitness verifies closed walks edge by edge", () => {
		const edges = new Set(["a>b", "b>c", "c>a"]);
		const hasEdge = (u: string, v: string) => edges.has(`${u}>${v}`);
		assert.deepEqual(checkCycleWitness(hasEdge, ["a", "b", "c", "a"]), { ok: true });
		assert.equal(checkCycleWitness(hasEdge, ["a", "b", "c"]).ok, false);
		assert.match((checkCycleWitness(hasEdge, ["a", "c", "b", "a"]) as { reason: string }).reason, /falta a aresta a → c/);
	});

	it("checkSnapshotCertificate accepts the stored certificate and rejects tampering", () => {
		const s = sampleSnapshot();
		assert.deepEqual(checkSnapshotCertificate(s), { ok: true });
		const order = [...s.certificate.order];
		[order[0], order[1]] = [order[1]!, order[0]!];
		assert.equal(checkSnapshotCertificate({ ...s, certificate: { ...s.certificate, order } }).ok, false);
		assert.match((checkSnapshotCertificate({ ...s, certificate: { ...s.certificate, hash: "0".repeat(16) } }) as { reason: string }).reason, /hash divergente/);
		const edited = { ...s, items: { ...s.items, "ee.ac": { ...s.items["ee.ac"]!, summary: "editado sem patch" } } };
		assert.equal(checkSnapshotCertificate(edited).ok, false);
	});

	it("computeCertificate refuses a cyclic system with a CurriculumError carrying the witness", () => {
		const s = snapshot([
			item("ee", null, "domain"),
			item("ee.a", "ee", "atom", { clauses: [["ee.b"]] }),
			item("ee.b", "ee", "atom", { clauses: [["ee.a"]] }),
		]);
		assert.throws(
			() => computeCertificate(s),
			(err: unknown) => err instanceof CurriculumError && err.errors[0]!.code === "cycle" && err.errors[0]!.witness!.length === 3,
		);
	});
});

describe("effective system", () => {
	const s = sampleSnapshot();
	const sys = buildEffectiveSystem(s.items);

	it("inherits entry requirements per alternative and turns containers into milestones", () => {
		const expected: Record<string, string[][]> = {
			ee: [["ee.ac", "ee.dc", "ee.math"]],
			"ee.math": [["ee.math.algebra", "ee.math.calculus"]],
			"ee.math.algebra": [],
			"ee.math.calculus": [["ee.math.algebra"]],
			"ee.dc": [["ee.dc.kvl", "ee.dc.nodal", "ee.dc.ohm"]],
			"ee.dc.ohm": [["ee.math"]],
			"ee.dc.kvl": [["ee.dc.ohm"]],
			"ee.dc.nodal": [["ee.dc.kvl"], ["ee.math", "ee.math.calculus"]],
			"ee.ac": [["ee.dc"]],
		};
		for (const [id, cl] of Object.entries(expected)) assert.deepEqual(effectiveClausesOf(sys, id), cl, id);
		assert.deepEqual(entryRequirementsOf(sys, "ee.dc"), [["ee.math"]]);
		assert.deepEqual(entryRequirementsOf(sys, "ee"), []);
	});

	it("exposes tree helpers over live items", () => {
		assert.deepEqual(childrenOf(sys, "ee.dc"), ["ee.dc.ohm", "ee.dc.kvl", "ee.dc.nodal"]);
		assert.equal(isLeaf(sys, "ee.ac"), true);
		assert.equal(isLeaf(sys, "ee.dc"), false);
		assert.deepEqual(ancestorsOf(s.items, "ee.dc.kvl"), ["ee.dc", "ee"]);
		assert.deepEqual(pathTo(s.items, "ee.dc.kvl"), ["ee", "ee.dc", "ee.dc.kvl"]);
		assert.deepEqual(new Set(descendantsOf(sys, "ee.math")), new Set(["ee.math.algebra", "ee.math.calculus"]));
		assert.deepEqual(new Set(leavesOf(sys, "ee")), new Set(allLeaves(sys)));
		assert.equal(allLeaves(sys).length, 6);
		assert.equal(rootOf(sys), "ee");
	});

	it("drops retired items and dangling references, and cuts parent cycles", () => {
		const items = {
			...s.items,
			"ee.dc.kvl": { ...s.items["ee.dc.kvl"]!, status: "deprecated" as const },
			"ee.x": item("ee.x", "ee.y", "unit"),
			"ee.y": item("ee.y", "ee.x", "unit"),
		};
		const e = buildEffectiveSystem(items);
		assert.equal(e.index.has("ee.dc.kvl"), false);
		// nodal's first alternative cited the retired kvl: only the external one survives.
		assert.deepEqual(effectiveClausesOf(e, "ee.dc.nodal"), [["ee.math", "ee.math.calculus"]]);
		assert.ok(e.diagnostics.deadRefs.some((d) => d.item === "ee.dc.nodal" && d.ref === "ee.dc.kvl"));
		assert.equal(e.diagnostics.parentCycles.length, 1);
		assert.deepEqual(new Set(e.diagnostics.parentCycles[0]), new Set(["ee.x", "ee.y"]));
	});

	it("normalizes clauses: dedupe (authoring order kept), absorption, empty alternative = entry", () => {
		assert.deepEqual(normalizeClauses([["b", "a", "a"], ["a", "b", "c"], ["c"]]), [["b", "a"], ["c"]]);
		assert.deepEqual(normalizeClauses([["a"], ["a"]]), [["a"]]);
		assert.deepEqual(normalizeClauses([["a"], []]), []);
		assert.equal(sameClauses([["b", "a"]], [["a", "b"]]), true);
		assert.equal(sameClauses([["a"]], [["a"], ["b"]]), false);
		assert.deepEqual(absorb([[0, 1], [0], [2, 3]]), [[0], [2, 3]]);
		const big = andDnf(
			Array.from({ length: 9 }, (_, i) => [i]),
			Array.from({ length: 9 }, (_, i) => [10 + i]),
		);
		assert.equal(big.overflow, true);
		assert.equal(big.alts.length, 64);
		assert.deepEqual(andDnf([[0], [1]], [[2]]).alts, [
			[0, 2],
			[1, 2],
		]);
		assert.deepEqual(toContractClauses(sys, [[]]), []);
	});
});

describe("rank: Kahn, witnesses, forward chaining", () => {
	it("is deterministic (smallest ready node first)", () => {
		const res = kahnOrder(4, [[], [], [0, 1], [0]]);
		assert.deepEqual(res, { ok: true, order: [0, 1, 2, 3] });
		assert.deepEqual(kahnOrder(3, [[2], [], []]), { ok: true, order: [1, 2, 0] });
		assert.deepEqual(kahnOrder(2, [[], []], [[1], []]), { ok: true, order: [1, 0] });
	});

	it("returns a closed-walk witness along real edges", () => {
		const preds = [[3], [0], [1], [2], []];
		const res = kahnOrder(5, preds);
		assert.equal(res.ok, false);
		if (res.ok) return;
		const hasEdge = (u: string, v: string) => preds[Number(v)]!.includes(Number(u));
		assert.deepEqual(checkCycleWitness(hasEdge, res.cycle.map(String)), { ok: true });
		const self = kahnOrder(2, [[0], []]);
		assert.equal(self.ok, false);
		if (!self.ok) assert.deepEqual(self.cycle, [0, 0]);
	});

	it("random DAGs get a valid order; random graphs get an order or a verified cycle", () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 12 }).chain((n) => fc.tuple(fc.constant(n), fc.array(fc.tuple(fc.nat({ max: n - 1 }), fc.nat({ max: n - 1 })), { maxLength: 30 }))),
				([n, pairs]) => {
					const preds: number[][] = Array.from({ length: n }, () => []);
					for (const [u, v] of pairs) if (!preds[v]!.includes(u)) preds[v]!.push(u);
					for (const p of preds) p.sort((a, b) => a - b);
					const res = kahnOrder(n, preds);
					if (res.ok) {
						const pos = new Map(res.order.map((x, i) => [x, i]));
						return res.order.length === n && preds.every((ps, v) => ps.every((u) => pos.get(u)! < pos.get(v)!));
					}
					const hasEdge = (u: string, v: string) => preds[Number(v)]!.includes(Number(u));
					return checkCycleWitness(hasEdge, res.cycle.map(String)).ok;
				},
			),
			{ numRuns: 300 },
		);
	});

	it("forward chaining finds the largest reachable state and a learning word", () => {
		const clauses = [[[]], [[0]], [[1], [3]], [[4]], []];
		const { known, word } = forwardChain(5, clauses);
		assert.deepEqual([...known], [1, 1, 1, 0, 0]);
		assert.deepEqual(word, [0, 1, 2]);
		const restricted = forwardChain(5, clauses, (x) => x !== 1);
		assert.deepEqual([...restricted.known], [1, 0, 0, 0, 0]);
	});

	it("prerequisite depth and the cached index", () => {
		const s = sampleSnapshot();
		const idx = curriculumIndex(s);
		assert.equal(curriculumIndex(s), idx, "cached per snapshot object");
		assert.equal(asIndex(idx), idx);
		assert.deepEqual(
			idx.order.map((x) => idx.sys.ids[x]),
			s.certificate.order,
		);
		const depth = prerequisiteDepth(idx.sys, idx.order);
		assert.equal(depth[idx.sys.index.get("ee.math.algebra")!], 0);
		assert.equal(depth[idx.sys.index.get("ee.math.calculus")!], 1);
		assert.equal(depth[idx.sys.index.get("ee.dc.ohm")!], 3);
		assert.equal(effectiveKahn(idx.sys).ok, true);
		const cyclic = snapshot([
			item("ee", null, "domain"),
			item("ee.a", "ee", "atom", { clauses: [["ee.b"]] }),
			item("ee.b", "ee", "atom", { clauses: [["ee.a"]] }),
		]);
		assert.throws(() => curriculumIndex(cyclic), CurriculumError);
	});
});

describe("hours", () => {
	const s = sampleSnapshot();

	it("rolls leaf hours up the tree; containers carry no hours of their own", () => {
		assert.equal(hoursMid({ lo: 1, hi: 3 }), 2);
		assert.deepEqual(sumHours([{ lo: 1, hi: 2 }, { lo: 0.5, hi: 1 }]), { lo: 1.5, hi: 3 });
		const roll = rollupHours(s);
		assert.deepEqual(roll.get("ee.dc"), { lo: 2.5, hi: 4 });
		assert.deepEqual(roll.get("ee"), { lo: 23, hi: 35 });
		assert.deepEqual(totalHours(s), { lo: 23, hi: 35 });
	});

	it("h_max lower bound ≤ additive upper bound for every item", () => {
		const idx = curriculumIndex(s);
		const known = new Uint8Array(idx.sys.ids.length);
		const lb = lowerBoundHmax(idx, known);
		const ub = upperBoundAdditive(idx, known);
		for (let x = 0; x < idx.sys.ids.length; x++) assert.ok(lb[x]! <= ub[x]! + 1e-9, idx.sys.ids[x]);
		assert.equal(lb[idx.sys.index.get("ee.math.calculus")!], 0.5);
		assert.equal(ub[idx.sys.index.get("ee.math.calculus")!], 1);
	});
});

describe("granularity", () => {
	const atom = (minutes: number, extra = {}) => item("ee.a.x", "ee.a", "atom", { hours: { lo: minutes / 60, hi: minutes / 60 }, ...extra });

	it("classifies atom hours against the 10–45 min band and the 8–60 min hard band", () => {
		assert.equal(atomHoursVerdict(atom(5)), "error-small");
		assert.equal(atomHoursVerdict(atom(9)), "warn-small");
		assert.equal(atomHoursVerdict(atom(10)), "ok");
		assert.equal(atomHoursVerdict(atom(45)), "ok");
		assert.equal(atomHoursVerdict(atom(50)), "warn-large");
		assert.equal(atomHoursVerdict(atom(70)), "error-large");
		assert.equal(atomHoursVerdict(atom(600, { atomType: "practice_regime" })), "exempt");
		assert.equal(atomHoursVerdict(item("ee.t", "ee", "topic")), "exempt");
		assert.equal(formatMinutes(0.75), "45 min");
	});

	it("leaf findings: split, merge, refine (stub > 4 h), regime atoms", () => {
		assert.equal(leafGranularityFinding(atom(50))!.action, "split");
		assert.equal(leafGranularityFinding(atom(9))!.action, "merge");
		assert.equal(leafGranularityFinding(atom(30)), null);
		assert.equal(leafGranularityFinding(item("ee.t", "ee", "topic", { hours: { lo: 3, hi: 4 } })), null);
		assert.equal(leafGranularityFinding(item("ee.t", "ee", "topic", { hours: { lo: 3, hi: 6 } }))!.action, "refine");
		assert.equal(leafGranularityFinding(atom(0, { atomType: "lab", hours: { lo: 3, hi: 6 } }))!.action, "split");
		assert.equal(leafGranularityFinding(atom(0, { atomType: "practice_regime", hours: { lo: 30, hi: 60 } })), null);
	});

	it("domain-level findings include cardinality and fan-in; refine candidates are the big stubs", () => {
		const s = sampleSnapshot();
		const f = granularityFindings(s);
		assert.equal(f[0]!.id, "ee.ac");
		assert.ok(f.some((x) => x.action === "cardinality" && x.id === "ee"));
		assert.deepEqual(refineCandidates(s), ["ee.ac"]);
		const fan = snapshot([
			item("ee", null, "domain"),
			...Array.from({ length: 6 }, (_, i) => item(`ee.p${i}`, "ee", "atom")),
			item("ee.z", "ee", "atom", { clauses: [Array.from({ length: 6 }, (_, i) => `ee.p${i}`)] }),
		]);
		assert.ok(granularityFindings(fan).some((x) => x.action === "fan-in" && x.id === "ee.z"));
	});
});

describe("transitive edges", () => {
	const s = snapshot([
		item("ee", null, "domain"),
		item("ee.a", "ee", "atom"),
		item("ee.b", "ee", "atom", { clauses: [["ee.a"]] }),
		item("ee.c", "ee", "atom", { clauses: [["ee.a", "ee.b"]] }),
		item("ee.d", "ee", "atom", { clauses: [["ee.a"], ["ee.b"]] }),
	]);

	it("finds members implied by another member of the same alternative (only hard links)", () => {
		assert.deepEqual(findRedundantPrereqs(s), [{ item: "ee.c", clauseIndex: 0, prereq: "ee.a", impliedBy: "ee.b" }]);
		assert.deepEqual(reduceStoredClauses(s.items["ee.c"]!, findRedundantPrereqs(s)), [["ee.b"]]);
		assert.deepEqual(reduceStoredClauses(s.items["ee.d"]!, findRedundantPrereqs(s)), [["ee.a"], ["ee.b"]]);
		assert.ok(validateReport(s).warnings.some((w) => w.code === "transitive-edge" && w.witness![0] === "ee.c"));
	});

	it("does not treat an OR route as implied", () => {
		const or = snapshot([
			item("ee", null, "domain"),
			item("ee.a", "ee", "atom"),
			item("ee.k", "ee", "atom"),
			item("ee.b", "ee", "atom", { clauses: [["ee.a"], ["ee.k"]] }),
			item("ee.c", "ee", "atom", { clauses: [["ee.a", "ee.b"]] }),
		]);
		assert.deepEqual(findRedundantPrereqs(or), []);
	});
});
