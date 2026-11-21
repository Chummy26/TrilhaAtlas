import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import fc from "fast-check";
import { checkTopoCertificate } from "../src/core/curriculum/certificate.ts";
import { buildEffectiveSystem } from "../src/core/curriculum/effective.ts";
import type { CurriculumItem } from "../src/core/curriculum/types.ts";
import {
	verifyCurriculumFormalContract,
	verifyKstAxiomsExhaustive,
	verifyLessonExamAutomaton,
	verifyXpAlgebraInvariants,
} from "../src/core/formal/index.ts";
import type { LearnerGraphNode, LearnerGraphView } from "../src/core/learner/graph-view.ts";
import { DEFAULT_LEVEL_CURVE, levelFromXp, xpForLevel } from "../src/core/progress/levels.ts";
import { MAX_MULTIPLIER, RULES, deriveRules } from "../src/core/progress/rules.ts";
import { parseProgressEvent } from "../src/core/progress/schema.ts";
import { fsrs7Memory } from "../src/core/progress/simulate.ts";
import {
	MemoryLedgerIndex,
	creditEvent,
	diagnosticCredit,
	gReview,
	itemCredit,
	lessonCredit,
	mDif,
	mediaCredit,
	reviewCredit,
	softCapped,
} from "../src/core/progress/xp.ts";
import { scoreEducationalReputation } from "../src/core/resources/reputation.ts";
import { composeExamPartsAnswer, extractExamFormParts } from "../src/core/study/lesson-conclusion.ts";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "trilha-formal-proofs-"));
process.env.LH_DATA_DIR = sandbox;
process.env.LH_AUTH_FILE = path.join(sandbox, "auth.json");
after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

/** Build a valid acyclic AND/OR LearnerGraphView from generated clause indices (strictly < i). */
function buildRandomDagView(clausesByNode: readonly (readonly (readonly number[])[])[]): LearnerGraphView {
	const ids = clausesByNode.map((_, i) => `n${i}`);
	const nodes = new Map<string, LearnerGraphNode>();

	for (let i = 0; i < clausesByNode.length; i++) {
		const id = ids[i]!;
		const rawClauses = clausesByNode[i] ?? [];
		const clauses: string[][] = [];
		for (const raw of rawClauses) {
			const uniq = [...new Set(raw.filter(idx => idx >= 0 && idx < i))].map(idx => ids[idx]!);
			if (uniq.length > 0) clauses.push(uniq);
		}
		nodes.set(id, {
			title: id,
			version: 1,
			parentId: null,
			isLeaf: true,
			children: [],
			clauses,
			encompasses: [],
			hoursMid: 0.4,
			depth: clauses.length ? 1 : 0,
			goalWeight: 0,
		});
	}

	return { ids, nodes };
}

/** Arbitrary generator for random acyclic AND/OR graphs of 1..8 nodes. */
const arbAndOrDag = fc
	.integer({ min: 1, max: 8 })
	.chain(size => {
		const nodeArbs = Array.from({ length: size }, (_, i) => {
			if (i === 0) return fc.constant([] as number[][]);
			const clauseArb = fc.array(fc.integer({ min: 0, max: i - 1 }), { minLength: 1, maxLength: Math.min(3, i) });
			return fc.array(clauseArb, { minLength: 0, maxLength: 3 });
		});
		return fc.tuple(...nodeArbs);
	})
	.map(clausesByNode => buildRandomDagView(clausesByNode));

function stripLeanCommentsAndStrings(src: string): string {
	return src
		.replace(/\/-[\s\S]*?-\//g, "")
		.replace(/--[^\r\n]*/g, "")
		.replace(/"(?:\\.|[^"\\])*"/g, '""');
}

describe("Lean 4 formal proof package static integrity", () => {
	it("ships complete Lean 4 proof modules with >= 15 named theorems and zero sorry/admit/axiom", () => {
		const root = path.resolve("formal");
		assert.ok(fs.existsSync(path.join(root, "lean-toolchain")), "formal/lean-toolchain must exist");
		assert.ok(fs.existsSync(path.join(root, "lakefile.lean")), "formal/lakefile.lean must exist");
		const requiredModules = ["Kst.lean", "Curriculum.lean", "XpInvariants.lean", "LessonExam.lean", "Check.lean"];
		let totalTheorems = 0;
		for (const file of requiredModules) {
			const full = path.join(root, "TrilhaAtlas", file);
			assert.ok(fs.existsSync(full), `Missing Lean module: ${file}`);
			const src = fs.readFileSync(full, "utf8");
			const code = stripLeanCommentsAndStrings(src);
			assert.doesNotMatch(code, /\bsorry\b/, `${file} must not contain 'sorry'`);
			assert.doesNotMatch(code, /\badmit\b/, `${file} must not contain 'admit'`);
			// Disallow custom axiom declarations (allow `#print axioms`).
			const lines = code.split(/\r?\n/);
			for (const line of lines) {
				assert.doesNotMatch(line, /^\s*axiom\b/, `${file} must not introduce custom axioms`);
			}
			const matches = code.match(/^\s*theorem\s+[A-Za-z0-9_']+/gm) ?? [];
			totalTheorems += matches.length;
		}
		assert.ok(totalTheorems >= 15, `Expected >= 15 mechanized Lean 4 theorems, found ${totalTheorems}`);
	});
});

describe("Exhaustive KST model checking across random AND/OR DAGs (fast-check)", () => {
	it("proves KST-1..KST-6 universally across 60 randomized AND/OR prerequisite graphs", () => {
		let totalStates = 0;
		fc.assert(
			fc.property(arbAndOrDag, graph => {
				const checks = verifyKstAxiomsExhaustive(graph);
				for (const check of checks) {
					totalStates += check.checkedStates;
					assert.equal(check.passed, true, `${check.id} failed: ${check.counterexample}`);
				}
			}),
			{ numRuns: 60, seed: 20261121 },
		);
		assert.ok(totalStates > 1000, `Expected >1000 exhaustive states checked, got ${totalStates}`);
	});
});

describe("Curriculum certificate soundness & full production domain verification", () => {
	it("accepts valid topological certificates and strictly rejects mutated/cyclic orders (fast-check)", () => {
		const baseItem = (id: string, parentId: string | null, kind: CurriculumItem["kind"], order: number, clauses: string[][]): CurriculumItem => ({
			id,
			domainId: "formal-test",
			kind,
			parentId,
			order,
			title: { pt: id, en: id },
			aliases: [],
			scope: "Formal scope",
			summary: "Formal summary",
			objectives: ["Obj"],
			assess: ["explain"],
			level: { scheme: "generic", band: 0 },
			clauses,
			softPrereqs: [],
			encompasses: [],
			hours: { lo: 0.3, hi: 0.5 },
			anchors: [],
			status: "stable",
			version: 1,
			provenance: { createdBy: "seed", createdAt: "2026-11-21T00:00:00Z" },
		});

		fc.assert(
			fc.property(
				fc.integer({ min: 2, max: 6 }),
				n => {
					const items: Record<string, CurriculumItem> = {
						"t.root": baseItem("t.root", null, "domain", 0, []),
					};
					for (let i = 0; i < n; i++) {
						const prev = i > 0 ? [[`t.a${i - 1}`]] : [];
						items[`t.a${i}`] = baseItem(`t.a${i}`, "t.root", "atom", i, prev);
					}
					const sys = buildEffectiveSystem(items);
					const edges: [string, string][] = [];
					for (let i = 0; i < sys.ids.length; i++) {
						const to = sys.ids[i]!;
						for (const clause of sys.clauses[i]!) {
							for (const fromIdx of clause) edges.push([sys.ids[fromIdx]!, to]);
						}
					}
					const validOrder = [...Array.from({ length: n }, (_, i) => `t.a${i}`), "t.root"];
					assert.equal(checkTopoCertificate(sys.ids, edges, validOrder).ok, true, "Valid topo order must pass");

					// Reversed order violates edge t.a0 -> t.a1 and container-after-children.
					const reversed = [...validOrder].reverse();
					assert.equal(checkTopoCertificate(sys.ids, edges, reversed).ok, false, "Reversed order must be rejected");

					// Missing node order must be rejected.
					assert.equal(checkTopoCertificate(sys.ids, edges, validOrder.slice(1)).ok, false, "Incomplete permutation must be rejected");
				},
			),
			{ numRuns: 30, seed: 20261122 },
		);
	});

	it("formally verifies 100% of shipped production curricula (english and electronics)", async () => {
		const { listStudyDomains, loadCurriculum, studyDomains } = await import("../src/server/study.ts");
		listStudyDomains();
		for (const domainId of ["english", "electronics"] as const) {
			const manifest = studyDomains().readManifest(domainId);
			assert.ok(manifest, `Expected shipped manifest for ${domainId}`);
			const loaded = loadCurriculum(domainId, manifest);
			assert.ok(loaded, `Expected curriculum snapshot for ${domainId}`);
			const checks = verifyCurriculumFormalContract(loaded.snapshot);
			for (const check of checks) {
				assert.equal(check.passed, true, `[${domainId}] ${check.id} failed: ${check.counterexample}`);
			}
		}
	});
});

describe("XP, Level Bijection & FSRS-7 algebraic invariants (fast-check)", () => {
	it("verifies deterministic XP algebraic grid for both 2026-11-r1 and candidate 2026-11-r2 rules", () => {
		const r2 = deriveRules(RULES, { lessonFailCredit: 0.1, lessonRushFraction: 0.65 }, "2026-11-r2-candidate");
		for (const ruleset of [RULES, r2]) {
			const checks = verifyXpAlgebraInvariants(ruleset);
			for (const check of checks) {
				assert.equal(check.passed, true, `[${ruleset.version}] ${check.id} failed: ${check.counterexample}`);
			}
		}
	});

	it("fuzzes XP credit formulas across 300 random inputs (I1, I2, I5, I6, I7, soft-cap contraction)", () => {
		fc.assert(
			fc.property(
				fc.double({ min: 0, max: 300, noNaN: true }),
				fc.double({ min: 1, max: 120, noNaN: true }),
				fc.double({ min: 0, max: 1, noNaN: true }),
				fc.double({ min: 0, max: 1, noNaN: true }),
				fc.double({ min: 0, max: 600, noNaN: true }),
				fc.integer({ min: 0, max: 5 }),
				fc.integer({ min: 1, max: 200 }),
				(focusedMin, expectedMin, r1, r2, priorMin, hints, level) => {
					const credits = [
						lessonCredit(focusedMin, expectedMin, true, RULES),
						lessonCredit(focusedMin, expectedMin, false, RULES),
						mediaCredit(focusedMin, expectedMin, true, RULES),
						itemCredit({ theta: 1200, b: 1400, correct: true, focusedMin, hints, medianMin: expectedMin }, RULES),
						reviewCredit({ R: r1, focusedMin }, RULES),
						diagnosticCredit(5, focusedMin, RULES),
					];
					for (const c of credits) {
						const xp = c.minutes * c.multiplier;
						assert.ok(xp >= 0 && Number.isFinite(xp), `I1 violated: ${xp}`);
						assert.ok(c.multiplier <= MAX_MULTIPLIER + 1e-12, `I5 multiplier violated: ${c.multiplier}`);
						const capped = softCapped(c.minutes, c.multiplier, priorMin, RULES);
						assert.ok(capped >= 0 && capped <= Math.round(xp * 10) / 10 + 1e-9, `SoftCap inflated XP: ${capped} > ${xp}`);
					}
					// I6 antitone monotonicity of gReview and mDif.
					const lo = Math.min(r1, r2);
					const hi = Math.max(r1, r2);
					assert.ok(gReview(hi, RULES.desiredRetention, RULES) <= gReview(lo, RULES.desiredRetention, RULES) + 1e-12);
					assert.ok(mDif(hi, RULES) <= mDif(lo, RULES) + 1e-12);

					// Exact level bijection.
					assert.equal(levelFromXp(xpForLevel(level, DEFAULT_LEVEL_CURVE), DEFAULT_LEVEL_CURVE), level);
				},
			),
			{ numRuns: 300, seed: 20261123 },
		);

		// I2 replay idempotence + I7 strict rating rejection.
		const index = new MemoryLedgerIndex();
		const ev = {
			eventId: "fc-idemp-001",
			domainId: "electronics",
			at: "2026-11-21T15:00:00Z",
			kind: "review" as const,
			nodeId: "ee.dc.ohms-law",
			R: 0.72,
			focusedMin: 6,
		};
		const d1 = creditEvent(ev, index);
		assert.equal(d1.status, "credited");
		index.add(d1.entry);
		const d2 = creditEvent(ev, index);
		assert.equal(d2.status, "duplicate");
		assert.throws(() => parseProgressEvent({ ...ev, rating: "Easy" }));
	});

	it("proves FSRS-7 retrievability is bounded in (0, 1] and monotonically non-increasing in elapsed time (100 runs)", () => {
		const mem = fsrs7Memory();
		fc.assert(
			fc.property(
				fc.constantFrom(1 as const, 2 as const, 3 as const, 4 as const),
				fc.double({ min: 0, max: 365, noNaN: true }),
				fc.double({ min: 0, max: 365, noNaN: true }),
				(grade, tA, tB) => {
					const s0 = mem.initial(grade);
					const t1 = Math.min(tA, tB);
					const t2 = Math.max(tA, tB);
					const r1 = mem.retrievability(t1, s0);
					const r2 = mem.retrievability(t2, s0);
					assert.ok(r1 > 0 && r1 <= 1 + 1e-12, `R(t1) out of (0,1]: ${r1}`);
					assert.ok(r2 > 0 && r2 <= 1 + 1e-12, `R(t2) out of (0,1]: ${r2}`);
					assert.ok(r2 <= r1 + 1e-12, `FSRS-7 retrievability increased with time: R(${t2})=${r2} > R(${t1})=${r1}`);
				},
			),
			{ numRuns: 100, seed: 20261124 },
		);
	});
});

describe("Lesson Exam FSM, multi-part form & educational reputation properties", () => {
	it("passes all exhaustive Lesson Exam FSM & pedagogy safety/liveness checks", () => {
		const checks = verifyLessonExamAutomaton();
		for (const check of checks) {
			assert.equal(check.passed, true, `${check.id} failed: ${check.counterexample}`);
		}
	});

	it("guarantees composeExamPartsAnswer rejects any missing or non-answer part (fast-check)", () => {
		const parts = extractExamFormParts("Entregue:\n\n1. Primeira parte.\n\n2. Segunda parte.\n\n3. Terceira parte.");
		assert.equal(parts.length, 3);
		const badTokens = ["", "   ", "ok", "sim", "entendi", "skip", "next", "beleza"];

		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 2 }),
				fc.constantFrom(...badTokens),
				(badIdx, badValue) => {
					const answers = [
						"A corrente é 3 mA pela Lei de Ohm.",
						"What is your name?",
						"A atendente quer preencher o cadastro inicial.",
					];
					answers[badIdx] = badValue;
					const result = composeExamPartsAnswer(parts, answers);
					assert.equal(result.ok, false, `Blank/non-answer "${badValue}" at part ${badIdx} must be rejected`);
					assert.ok(result.missing.includes(badIdx), `Missing list must contain ${badIdx}`);
				},
			),
			{ numRuns: 40, seed: 20261125 },
		);
	});

	it("ranks authoritative university/open textbooks strictly above generic web notes", () => {
		const openstax = scoreEducationalReputation({
			title: "OpenStax University Physics Volume 2",
			url: "https://openstax.org/books/university-physics-volume-2/pages/10-1-electromotive-force",
			fullBookUrl: "https://openstax.org/downloads/university-physics-volume-2.pdf",
		});
		const mit = scoreEducationalReputation({
			title: "MIT OpenCourseWare 6.002 Circuits and Electronics",
			url: "https://ocw.mit.edu/courses/6-002-circuits-and-electronics-spring-2007/",
		});
		const generic = scoreEducationalReputation({
			title: "Quick circuits cheat sheet blog",
			url: "https://example.com/circuits-notes",
		});
		assert.ok(openstax.score > generic.score + 20);
		assert.ok(mit.score > generic.score + 20);
	});
});
