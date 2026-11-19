/**
 * Level curve (docs/research/00-SINTESE.md §2.11; r7 §3): XP(L) = 20.10·L^1.696,
 * levelFromXp / xpForLevel are exact inverses and the level is monotonic in XP
 * (invariant I3).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import { DEFAULT_LEVEL_CURVE, fitLevelCurve, LevelCurveError, levelFromXp, levelProgress, validateLevelCurve, xpForLevel, xpToAdvance } from "../src/core/progress/index.ts";

const curveArb = fc.record({ a: fc.double({ min: 1, max: 100, noNaN: true }), p: fc.double({ min: 1, max: 2.5, noNaN: true }) });

describe("levelFromXp / xpForLevel", () => {
	it("are exact inverses at every level boundary (default curve, L = 1…1000)", () => {
		for (let level = 1; level <= 1000; level++) {
			const start = xpForLevel(level);
			assert.equal(levelFromXp(start), level, `L${level} começa em ${start}`);
			if (level > 1) assert.equal(levelFromXp(start - 1e-9 * Math.max(1, start)), level - 1);
		}
	});

	it("are inverses for arbitrary valid curves", () => {
		fc.assert(
			fc.property(curveArb, fc.integer({ min: 1, max: 400 }), (curve, level) => {
				assert.equal(levelFromXp(xpForLevel(level, curve), curve), level);
				assert.ok(levelFromXp(xpForLevel(level + 1, curve) * (1 - 1e-12), curve) <= level);
			}),
		);
	});

	it("I3: the level is monotonic (non-decreasing) in XP", () => {
		fc.assert(
			fc.property(curveArb, fc.double({ min: 0, max: 1e6, noNaN: true }), fc.double({ min: 0, max: 1e6, noNaN: true }), (curve, x, y) => {
				const [lo, hi] = x <= y ? [x, y] : [y, x];
				assert.ok(levelFromXp(lo, curve) <= levelFromXp(hi, curve));
			}),
		);
	});

	it("starts at level 1 with 0 XP and treats negative or invalid XP as 0", () => {
		assert.equal(xpForLevel(1), 0);
		assert.equal(levelFromXp(0), 1);
		assert.equal(levelFromXp(-50), 1);
		assert.equal(levelFromXp(Number.NaN), 1);
		assert.throws(() => xpForLevel(0), LevelCurveError);
		assert.throws(() => xpForLevel(2.5), LevelCurveError);
	});

	it("reproduces the r7 table of XP per level (45 · 175 · 522 · 843 · 1116, ±2 from r7's unrounded a, p)", () => {
		// r7 measures L1→2 from a·1^p; here level 1 starts at 0 XP, so the first level costs a·2^p.
		const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) <= 2, `${actual} ≉ ${expected}`);
		near(xpForLevel(2) - DEFAULT_LEVEL_CURVE.a, 45);
		near(xpToAdvance(10), 175);
		near(xpToAdvance(50), 522);
		near(xpToAdvance(100), 843);
		near(xpToAdvance(150), 1116);
	});
});

describe("levelProgress and fitting", () => {
	it("keeps the short-range bar inside [0, 1] and consistent with the boundaries", () => {
		fc.assert(
			fc.property(fc.double({ min: 0, max: 2e5, noNaN: true }), (xp) => {
				const progress = levelProgress(xp);
				assert.ok(progress.fraction >= 0 && progress.fraction <= 1);
				assert.ok(progress.levelStartXp <= xp && xp < progress.nextLevelXp);
				assert.ok(Math.abs(progress.xpIntoLevel + progress.xpToNext - (progress.nextLevelXp - progress.levelStartXp)) < 1e-6);
			}),
		);
	});

	it("fits a·L^p through the two calibration anchors (L10, L100)", () => {
		const curve = fitLevelCurve({ level: 10, xp: xpForLevel(10) }, { level: 100, xp: xpForLevel(100) });
		assert.ok(Math.abs(curve.a - DEFAULT_LEVEL_CURVE.a) < 1e-9);
		assert.ok(Math.abs(curve.p - DEFAULT_LEVEL_CURVE.p) < 1e-12);
		assert.throws(() => fitLevelCurve({ level: 10, xp: 500 }, { level: 100, xp: 400 }), LevelCurveError);
		assert.throws(() => validateLevelCurve({ a: 0, p: 1.7 }), LevelCurveError);
	});
});
