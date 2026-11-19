/**
 * Learner model — event-sourced fold (SÍNTESE §2.6 monotonic states; r2 §9.4,
 * §9.13 (1)(7)): monotonic attainedAt/masteredAt, hysteresis regression,
 * deterministic replay, version resets, diagnostic placement, validation.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import { retrievability } from "../src/core/learner/fsrs.ts";
import { emptySnapshot, foldEvents, ingestEvent, ingestEvents, LearnerFoldError } from "../src/core/learner/fold.ts";
import type { LearnerGraphView } from "../src/core/learner/graph-view.ts";
import { misconceptionIdFor, misconceptionMean } from "../src/core/learner/misconceptions.ts";
import { DEFAULT_LEARNER_PARAMS, LEARNER_CONSTANTS } from "../src/core/learner/params.ts";
import { computeSignals } from "../src/core/learner/signals.ts";
import type { Grade, LearnerEvent, LearnerSnapshot, NodeId } from "../src/core/learner/types.ts";
import { chain, day, DOMAIN, evidence, masterySteps, must, practice } from "./learner-fixtures.ts";

const P = DEFAULT_LEARNER_PARAMS;
const close = (actual: number, expected: number, tol: number, msg?: string) =>
	assert.ok(Math.abs(actual - expected) <= tol, `${msg ?? ""} expected ${expected} ± ${tol}, got ${actual}`);

function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const v of Object.values(value)) deepFreeze(v);
	}
	return value;
}

/** n0 → n1 → n2 with n0, n1 mastered by day 10 (n2 untouched). */
function masteredPrefix(): { view: LearnerGraphView; snapshot: LearnerSnapshot; log: LearnerEvent[] } {
	const view = chain(3);
	const { snapshot, log } = ingestEvents(null, practice(masterySteps(["n0", "n1"])), view, P);
	return { view, snapshot, log };
}

interface RandomStep {
	node: number;
	grade: Grade;
	gap: number;
	hints: number;
	kind: "evidence" | "exposure" | "attributed";
}

const stepArb = (nodes: number): fc.Arbitrary<RandomStep> =>
	fc.record({
		node: fc.integer({ min: 0, max: nodes - 1 }),
		grade: fc.constantFrom<Grade>(0, 1, 2, 3),
		gap: fc.double({ min: 0.001, max: 40, noNaN: true }),
		hints: fc.integer({ min: 0, max: 2 }),
		kind: fc.constantFrom<RandomStep["kind"]>("evidence", "evidence", "evidence", "exposure", "attributed"),
	});

/** Materialize random steps as events (seq from `firstSeq`, time from `startDay`). */
function toEvents(steps: readonly RandomStep[], ids: readonly NodeId[], firstSeq: number, startDay: number): LearnerEvent[] {
	let d = startDay;
	return steps.map((s, i) => {
		d += s.gap;
		const seq = firstSeq + i;
		const nodeId = ids[s.node] as NodeId;
		if (s.kind === "exposure") {
			return { kind: "exposure", id: `x${seq}`, seq, at: day(d), domainId: DOMAIN, sessionId: "s1", nodeId, source: "ai_lesson", minutes: 15 };
		}
		const prev = ids[Math.max(0, s.node - 1)] as NodeId;
		return evidence({
			seq,
			at: day(d),
			nodeId,
			grade: s.grade,
			hints: s.hints,
			minutes: s.gap * 1440,
			...(s.kind === "attributed" ? { attributions: [{ nodeId: prev, blame: 0.7, newMisconception: "Confunde tensão com corrente" }] } : {}),
		});
	});
}

describe("learner fold — monotonic states (SÍNTESE §2.6)", () => {
	it("mastery needs pL ≥ 0.95, two item families and a delayed hint-free success", () => {
		const { snapshot } = masteredPrefix();
		for (const id of ["n0", "n1"]) {
			const s = must(snapshot.nodes[id]);
			assert.ok(s.attainedAt && s.masteredAt && s.verified, id);
			assert.ok(s.pL >= P.masteryThreshold);
			assert.ok(s.correctFamilies.length >= 2 && s.delayedSuccesses >= 1);
		}
		const view = chain(1);
		const sameFamily = ingestEvents(
			null,
			practice([0, 2, 4, 6].map((d) => ({ d, nodeId: "n0", grade: 3 as Grade, family: "n0#same" }))),
			view,
			P,
		).snapshot;
		assert.ok(must(sameFamily.nodes.n0).pL >= P.masteryThreshold);
		assert.equal(must(sameFamily.nodes.n0).masteredAt, undefined, "one family is not mastery");
		const crammed = ingestEvents(
			null,
			practice([0, 0.001, 0.002, 0.003, 0.004].map((d) => ({ d, nodeId: "n0", grade: 3 as Grade, minutes: 5 }))),
			view,
			P,
		).snapshot;
		assert.equal(must(crammed.nodes.n0).masteredAt, undefined, "no delayed retrieval, no mastery");
	});

	it("attainedAt and masteredAt never change under any later failures (property)", () => {
		const { view, snapshot } = masteredPrefix();
		const flags = (s: LearnerSnapshot) => ["n0", "n1"].map((id) => [s.nodes[id]?.attainedAt, s.nodes[id]?.masteredAt]);
		const base = flags(snapshot);
		fc.assert(
			fc.property(fc.array(stepArb(3), { minLength: 1, maxLength: 12 }), (steps) => {
				let current = snapshot;
				for (const ev of toEvents(steps, view.ids, snapshot.seq + 1, 12)) {
					current = ingestEvent(current, ev, view, P).snapshot;
					assert.deepEqual(flags(current), base);
					for (const s of Object.values(current.nodes)) {
						assert.ok(s.pL >= 0 && s.pL <= 1, `${s.nodeId} pL ${s.pL}`);
						const R = retrievability(s.fsrs, current.updatedAt, P);
						assert.ok(R >= 0 && R <= 1);
						if (s.attainedAt === undefined) assert.equal(s.masteredAt, undefined);
					}
				}
			}),
			{ numRuns: 40 },
		);
	});

	it("REGRESSION: one failure after pL 0.9385 neither re-locks nor clears masteredAt", () => {
		const { view, snapshot } = masteredPrefix();
		const n1 = must(snapshot.nodes.n1);
		const patched: LearnerSnapshot = { ...snapshot, nodes: { ...snapshot.nodes, n1: { ...n1, pL: 0.9385 } } };
		const at = day(14);
		const after = foldEvents(patched, [evidence({ seq: snapshot.seq + 1, at, nodeId: "n1", grade: 0 })], view, P);
		const s = must(after.nodes.n1);
		assert.ok(s.pL < 0.9385, "the failure is real evidence");
		assert.equal(s.attainedAt, n1.attainedAt);
		assert.equal(s.masteredAt, n1.masteredAt);
		const sig = computeSignals(after, view, P, at);
		const status = must(sig.signals.get("n1")).status;
		assert.ok(!["locked", "frontier", "learning"].includes(status), `status ${status}`);
		assert.ok(sig.structure.frontier.includes("n2"), "the dependent stays unlocked");
		assert.ok(must(sig.signals.get("n1")).mastered, "the UI keeps the mastered badge");
		assert.equal(must(sig.signals.get("n1")).estimated, s.pL >= P.attainThreshold, "only the estimate axis moves");
	});

	it("summative success sets demonstratedAt once; hints never count as delayed retrieval", () => {
		const view = chain(1);
		const s = foldEvents(
			null,
			[
				evidence({ seq: 1, at: day(0), nodeId: "n0", grade: 3, hints: 1 }),
				evidence({ seq: 2, at: day(3), nodeId: "n0", grade: 3, summative: true }),
				evidence({ seq: 3, at: day(6), nodeId: "n0", grade: 3, summative: true }),
			],
			view,
			P,
		);
		const n0 = must(s.nodes.n0);
		assert.equal(n0.demonstratedAt, day(3));
		assert.equal(n0.delayedSuccesses, 2, "the hinted attempt does not count");
	});
});

describe("learner fold — deterministic replay (r2 §9.13 (7))", () => {
	it("same events ⇒ same snapshot: ingest log replay, shuffled input and chunked folds agree (property)", () => {
		const view = chain(4);
		fc.assert(
			fc.property(fc.array(stepArb(4), { minLength: 1, maxLength: 25 }), fc.nat(), fc.nat(), (steps, cut, salt) => {
				const events = toEvents(steps, view.ids, 1, 0);
				const { snapshot, log } = ingestEvents(null, events, view, P);
				assert.deepEqual(foldEvents(null, log, view, P), snapshot, "replay of the persisted log");
				const shuffled = [...log].sort((a, b) => ((hash(a) ^ salt) >>> 0) - ((hash(b) ^ salt) >>> 0));
				assert.deepEqual(foldEvents(null, shuffled, view, P), snapshot, "input order is irrelevant");
				const k = 1 + (cut % log.length);
				const head = foldEvents(null, log.slice(0, k), view, P);
				assert.deepEqual(foldEvents(head, log.slice(k), view, P), snapshot, "incremental fold");
				assert.deepEqual(foldEvents(snapshot, log, view, P), snapshot, "already-folded events are skipped");
				assert.deepEqual(ingestEvents(null, events, view, P).snapshot, snapshot, "ingest is deterministic");
			}),
			{ numRuns: 60 },
		);
	});

	it("never mutates its inputs", () => {
		const { view, snapshot, log } = masteredPrefix();
		const frozen = deepFreeze(structuredClone(snapshot));
		const events = deepFreeze(toEvents([{ node: 1, grade: 0, gap: 1, hints: 0, kind: "attributed" }], view.ids, snapshot.seq + 1, 12));
		assert.doesNotThrow(() => foldEvents(frozen, events, view, P));
		assert.doesNotThrow(() => ingestEvents(frozen, events, view, P));
		assert.doesNotThrow(() => foldEvents(null, deepFreeze(structuredClone(log)), view, P));
	});
});

describe("learner fold — other events", () => {
	it("an AI lesson applies the lesson transition (0.15 → 0.3625)", () => {
		const s = foldEvents(
			null,
			[{ kind: "exposure", id: "x1", seq: 1, at: day(0), domainId: DOMAIN, sessionId: "s1", nodeId: "n0", source: "ai_lesson", minutes: 20 }],
			chain(2),
			P,
		);
		close(must(s.nodes.n0).pL, LEARNER_CONSTANTS.priorP + (1 - LEARNER_CONSTANTS.priorP) * P.tLesson, 1e-12);
		assert.equal(must(s.nodes.n0).verified, false);
	});

	it("a node-version bump is the only reset; stale versions are ignored", () => {
		const { view, snapshot } = masteredPrefix();
		const bump = (seq: number, version: number): LearnerEvent => ({ kind: "node-version", id: `v${seq}`, seq, at: day(12), domainId: DOMAIN, nodeId: "n1", version });
		const same = foldEvents(snapshot, [bump(snapshot.seq + 1, 1)], view, P);
		assert.deepEqual(same.nodes.n1, snapshot.nodes.n1);
		const reset = foldEvents(snapshot, [bump(snapshot.seq + 1, 2)], view, P);
		const n1 = must(reset.nodes.n1);
		assert.equal(n1.nodeVersion, 2);
		assert.equal(n1.attainedAt, undefined);
		assert.equal(n1.masteredAt, undefined);
		assert.equal(n1.fsrs, undefined);
		assert.equal(n1.pL, LEARNER_CONSTANTS.priorP);
		const reviewed = foldEvents(reset, [evidence({ seq: reset.seq + 1, at: day(13), nodeId: "n1", grade: 3 })], view, P);
		assert.equal(must(reviewed.nodes.n1).fsrs?.cardId, "n1@v2", "a new FSRS card for the new definition");
		assert.throws(() => foldEvents(snapshot, [bump(snapshot.seq + 1, 0)], view, P), LearnerFoldError);
	});

	it("diagnostic placement: inferred, monotonic placedAt, never overrides direct evidence", () => {
		const view = chain(3);
		const diag = (seq: number, d: number, estimates: { nodeId: NodeId; p: number }[]): LearnerEvent => ({
			kind: "diagnostic",
			id: `d${seq}`,
			seq,
			at: day(d),
			domainId: DOMAIN,
			estimates,
		});
		const s1 = foldEvents(
			null,
			[
				diag(1, 0, [
					{ nodeId: "n0", p: 0.95 },
					{ nodeId: "n1", p: 0.9 },
					{ nodeId: "n2", p: 0.4 },
				]),
			],
			view,
			P,
		);
		assert.equal(must(s1.nodes.n1).placedAt, day(0));
		assert.equal(must(s1.nodes.n1).inferred, true);
		assert.equal(must(s1.nodes.n1).verified, false);
		assert.equal(must(s1.nodes.n1).attainedAt, undefined, "placement is not attainment");
		assert.equal(must(s1.nodes.n2).placedAt, undefined);
		const sig = computeSignals(s1, view, P, day(0));
		assert.deepEqual(sig.structure.frontier, ["n2"]);
		assert.equal(must(sig.signals.get("n1")).status, "inferred");

		const s2 = foldEvents(
			s1,
			[
				evidence({ seq: 2, at: day(1), nodeId: "n0", grade: 3 }),
				diag(3, 2, [
					{ nodeId: "n0", p: 0.05 },
					{ nodeId: "n1", p: 0.2 },
				]),
			],
			view,
			P,
		);
		assert.ok(must(s2.nodes.n0).pL > 0.5, "verified nodes ignore diagnostic estimates");
		assert.equal(must(s2.nodes.n1).pL, 0.2);
		assert.equal(must(s2.nodes.n1).placedAt, day(0), "placedAt is monotonic");
	});

	it("LLM attributions create misconception beliefs; correct diagnostic answers refute them", () => {
		const view = chain(2);
		const text = "Confunde tensão com corrente";
		const id = misconceptionIdFor(text);
		const failed = foldEvents(
			null,
			[
				evidence({ seq: 1, at: day(0), nodeId: "n1", grade: 0, attributions: [{ nodeId: "n0", blame: 0.9, newMisconception: text }] }),
				evidence({ seq: 2, at: day(1), nodeId: "n1", grade: 1, attributions: [{ nodeId: "n0", blame: 0.9, misconceptionId: id }] }),
				evidence({ seq: 3, at: day(2), nodeId: "n1", grade: 0, attributions: [{ nodeId: "n0", blame: 1, newMisconception: " confunde  TENSÃO com corrente " }] }),
				evidence({ seq: 4, at: day(3), nodeId: "n1", grade: 0, attributions: [{ nodeId: "n0", blame: 1, misconceptionId: id }] }),
				evidence({ seq: 5, at: day(4), nodeId: "n1", grade: 3, attributions: [{ nodeId: "n0", blame: 1, misconceptionId: id }] }),
			],
			view,
			P,
		);
		const belief = must(must(failed.nodes.n0).misconceptions[id]);
		assert.equal(Object.keys(must(failed.nodes.n0).misconceptions).length, 1, "exact-text dedup");
		close(belief.a, 1 + 0.9 + 0.9 + 1 + 1, 1e-12, "Beta(1,4) prior, a += c per failure; successes ignore attributions");
		assert.ok(misconceptionMean(belief) >= 0.5, "active");
		assert.ok(must(failed.nodes.n0).blame > 0, "attributed node is blamed");
		assert.equal(must(failed.nodes.n0).verified, false, "attribution alone is not direct evidence");
		const refuted = foldEvents(failed, [evidence({ seq: 6, at: day(5), nodeId: "n0", grade: 3, diagnoses: [{ nodeId: "n0", misconceptionId: id }] })], view, P);
		assert.equal(must(must(refuted.nodes.n0).misconceptions[id]).b, belief.b + 1);
	});

	it("evidence on unknown nodes is ignored; malformed events fail loudly", () => {
		const view = chain(2);
		const ghost = foldEvents(null, [evidence({ seq: 1, at: day(0), nodeId: "ghost", grade: 3 })], view, P);
		assert.deepEqual(ghost.nodes, {});
		const bad = (patch: Record<string, unknown>) => {
			const ev = evidence({ seq: 1, at: day(0), nodeId: "n0", grade: 3 });
			assert.equal(ev.kind, "evidence");
			return { kind: "evidence", evidence: { ...(ev.kind === "evidence" ? ev.evidence : {}), ...patch } } as LearnerEvent;
		};
		assert.throws(() => foldEvents(null, [bad({ grade: 4 })], view, P), LearnerFoldError);
		assert.throws(() => foldEvents(null, [bad({ nodes: [] })], view, P), /vetor Q vazio/);
		assert.throws(() => foldEvents(null, [bad({ nodes: [{ nodeId: "n0", q: 0 }] })], view, P), /q fora/);
		assert.throws(() => foldEvents(null, [bad({ at: "ontem" })], view, P), LearnerFoldError);
		assert.throws(() => foldEvents(null, [bad({ graderConfidence: 2 })], view, P), /graderConfidence/);
		assert.throws(() => foldEvents(emptySnapshot("music", day(0)), [bad({})], view, P), /pertence a/);
		assert.throws(() => foldEvents(null, [], view, P), LearnerFoldError);
	});
});

function hash(ev: LearnerEvent): number {
	const id = ev.kind === "evidence" ? ev.evidence.id : ev.id;
	let h = 2166136261;
	for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
	return h >>> 0;
}
