/**
 * Tiers, region badges and standing (docs/research/00-SINTESE.md §2.11;
 * r7 §4.2, §4.5): the tier depends ONLY on retention of the frozen core, the
 * peak is never demoted (I4), badges follow the region thresholds and the
 * "Enferrujada" overlay.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import {
	computeStanding,
	DEFAULT_PROGRESSION_CONFIG,
	DEFAULT_TIER_THRESHOLDS,
	divisionFor,
	masteryPoints,
	PM_MAX,
	regionBadge,
	replayXpLedger,
	restoreTargets,
	stageFractions,
	structuralStage,
	tierFromPm,
	tierLabel,
	tierStanding,
	TierError,
	updateTierPeak,
	validateTierThresholds,
	type RegionSignals,
	type TierCore,
	type TierIndex,
} from "../src/core/progress/index.ts";

/** 7 stages with 3, 4, 5, 6, 5, 4, 3 nodes. */
const CORE: TierCore = {
	coreVersion: "core-v1",
	stages: [3, 4, 5, 6, 5, 4, 3].map((size, s) => Array.from({ length: size }, (_, i) => `s${s + 1}.n${i}`)),
};
const ALL_NODES = CORE.stages.flat();

const retentionArb = fc
	.array(fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }), { minLength: ALL_NODES.length, maxLength: ALL_NODES.length })
	.map((values) => {
		const snapshot = new Map<string, number>();
		values.forEach((R, i) => {
			if (R !== undefined) snapshot.set(ALL_NODES[i] as string, R);
		});
		return snapshot;
	});

describe("tiers", () => {
	it("PM is Σ s·f_s with maximum 28, and full retention reaches Doutor I", () => {
		const full = new Map(ALL_NODES.map((id) => [id, 0.95]));
		const standing = tierStanding(CORE, full);
		assert.equal(standing.pm, PM_MAX);
		assert.equal(standing.tier, 7);
		assert.equal(standing.label, "Doutor I");
		assert.equal(standing.form, 1);
		assert.equal(standing.nextThreshold, null);
	});

	it("nothing learned is Novato with form 1 (no retention to lose)", () => {
		const standing = tierStanding(CORE, new Map());
		assert.equal(standing.tier, 0);
		assert.equal(standing.label, "Novato");
		assert.equal(standing.division, null);
		assert.equal(standing.form, 1);
		assert.equal(standing.nextThreshold, DEFAULT_TIER_THRESHOLDS[0]);
	});

	it("a node counts only when attained AND R ≥ 0.7", () => {
		const retention = new Map([
			["s1.n0", 0.7],
			["s1.n1", 0.69],
		]);
		assert.deepEqual(stageFractions(CORE, retention).slice(0, 1), [1 / 3]);
		assert.equal(tierStanding(CORE, retention).form, 0.5);
	});

	it("depends only on the retention snapshot (same snapshot ⇒ same standing; R up ⇒ tier never down)", () => {
		fc.assert(
			fc.property(retentionArb, fc.integer({ min: 0, max: ALL_NODES.length - 1 }), (retention, index) => {
				const a = tierStanding(CORE, retention);
				const b = tierStanding(CORE, new Map([...retention.entries()].reverse()));
				assert.deepEqual(a, b);
				const boosted = new Map(retention);
				boosted.set(ALL_NODES[index] as string, 1);
				const c = tierStanding(CORE, boosted);
				assert.ok(c.pm >= a.pm - 1e-12);
				assert.ok(c.tier >= a.tier);
			}),
		);
	});

	it("divisions III → II → I split each band in thirds; Doutor uses [τ₇, 28]", () => {
		const [t1, t2] = DEFAULT_TIER_THRESHOLDS as [number, number];
		assert.equal(divisionFor(t1, 1), "III");
		assert.equal(divisionFor(t1 + (t2 - t1) * 0.4, 1), "II");
		assert.equal(divisionFor(t1 + (t2 - t1) * 0.9, 1), "I");
		assert.equal(divisionFor(27.9, 7), "I");
		assert.equal(tierLabel(3, "II"), "Ouro II");
		assert.equal(tierFromPm(0), 0);
		assert.equal(tierFromPm(PM_MAX), 7);
	});

	it("validates thresholds and core", () => {
		assert.throws(() => validateTierThresholds([1, 2, 3]), TierError);
		assert.throws(() => validateTierThresholds([1, 2, 3, 3, 5, 6, 7]), TierError);
		assert.throws(() => validateTierThresholds([1, 2, 3, 4, 5, 6, 29]), TierError);
		assert.throws(() => tierStanding({ coreVersion: "x", stages: [["a"], ["a"], [], [], [], [], []] }, new Map()), TierError);
	});

	it("structural criterion: stages complete in order at q = 0.8", () => {
		assert.equal(structuralStage([1, 0.8, 0.79, 1, 1, 1, 1]), 2);
		assert.equal(structuralStage([0.5, 1, 1, 1, 1, 1, 1]), 0);
		assert.equal(structuralStage([1, 1, 1, 1, 1, 1, 1]), 7);
		assert.equal(masteryPoints([1, 1, 1, 1, 1, 1, 1]), 28);
	});

	it("I4: the peak tier is monotonic", () => {
		fc.assert(
			fc.property(fc.array(fc.integer({ min: 0, max: 7 }), { maxLength: 30 }), (tiers) => {
				let peak: TierIndex = 0;
				for (const tier of tiers) {
					const next = updateTierPeak(peak, tier as TierIndex);
					assert.ok(next >= peak && next >= tier);
					peak = next;
				}
			}),
		);
	});
});

describe("standing", () => {
	it("combines domain XP, level, tier and never-lowered peaks", () => {
		const entries = replayXpLedger([
			{ kind: "diagnostic", eventId: "d1", at: "2026-11-02T12:00:00Z", domainId: "electronics", items: 30 },
			{ kind: "diagnostic", eventId: "d2", at: "2026-11-02T13:00:00Z", domainId: "english", items: 50 },
		]);
		const standing = computeStanding({
			domainId: "electronics",
			entries,
			core: CORE,
			retention: new Map(),
			peaks: { levelPeak: 9, tierPeak: 3 },
			config: DEFAULT_PROGRESSION_CONFIG,
		});
		assert.equal(standing.xp, 30);
		assert.equal(standing.level.level, 1);
		assert.equal(standing.levelPeak, 9);
		assert.equal(standing.tier.tier, 0);
		assert.equal(standing.tierPeak, 3);
		assert.equal(standing.tierPeakLabel, "Ouro");
		assert.equal(standing.rulesVersion, "2026-11-r1");
	});
});

describe("region badges", () => {
	const region = (nodes: RegionSignals["nodes"], bossPassed = false): RegionSignals => ({ regionId: "ee.dc", nodes, bossPassed });
	const nodes = (learned: number, retained: number, total = 10) =>
		Array.from({ length: total }, (_, i) => ({ nodeId: `n${i}`, attained: i < learned, R: i < retained ? 0.9 : i < learned ? 0.5 : undefined }));

	it("climbs Explorada → Familiar → Proficiente → Dominada (boss required)", () => {
		assert.equal(regionBadge(region(nodes(0, 0))).current, "none");
		assert.equal(regionBadge(region(nodes(1, 0))).current, "explored");
		assert.equal(regionBadge(region(nodes(5, 0))).current, "familiar");
		assert.equal(regionBadge(region(nodes(8, 8))).current, "proficient");
		assert.equal(regionBadge(region(nodes(10, 9))).current, "proficient");
		assert.equal(regionBadge(region(nodes(10, 9), true)).label, "Dominada");
	});

	it("keeps the peak and shows Enferrujada when retention falls below 70 %", () => {
		const rusty = regionBadge(region(nodes(10, 6), true), "mastered");
		assert.equal(rusty.peak, "mastered");
		assert.equal(rusty.current, "familiar");
		assert.equal(rusty.rusty, true);
		assert.equal(rusty.label, "Dominada · Enferrujada");
		assert.deepEqual(restoreTargets(region(nodes(10, 6))), ["n6", "n7", "n8", "n9"]);
		assert.equal(regionBadge(region(nodes(10, 6)), "familiar").rusty, false);
	});

	it("weights nodes by w_n", () => {
		const weighted = region([
			{ nodeId: "core", attained: true, R: 0.95, weight: 9 },
			{ nodeId: "extra", attained: false, weight: 1 },
		]);
		assert.equal(regionBadge(weighted).current, "proficient");
	});
});
