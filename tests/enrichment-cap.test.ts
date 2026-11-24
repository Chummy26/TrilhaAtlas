import assert from "node:assert/strict";
import { it } from "node:test";
import type { StudyMaterial } from "../src/core/study/map.ts";
import {
	MAX_MATERIALS_PER_NODE,
	QUALITY_UPGRADE_THRESHOLD,
	mergeEnrichedMaterialsWithCap,
} from "../src/server/study-materials.ts";

function mat(id: number, url: string, title: string, extra: Partial<StudyMaterial> = {}): StudyMaterial {
	return {
		kind: "book",
		title,
		part: "Sugestão para região",
		url,
		lang: "en",
		nodes: ["node.1"],
		suggested: true,
		linkOnly: true,
		...extra,
	};
}

it("enforces MAX_MATERIALS_PER_NODE=10 and upgrades weaker entries once >= 70% full", () => {
	assert.equal(MAX_MATERIALS_PER_NODE, 10);
	assert.equal(QUALITY_UPGRADE_THRESHOLD, 0.7);

	// 2 fixed curriculum/manual entries + 8 low-reputation enriched suggestions = 10 (at cap)
	const fixed: StudyMaterial[] = [
		mat(1, "https://example.org/manual-1", "Manual PDF 1", { manual: true, suggested: false }),
		mat(2, "https://example.org/manual-2", "Manual PDF 2", { manual: true, suggested: false }),
	];
	const existing: StudyMaterial[] = Array.from({ length: 8 }, (_, i) =>
		mat(i + 10, `https://random-blog-${i}.example/post`, `Blog post ${i}`, { suggested: true }),
	);

	// Candidate 1: another weak blog post -> must be rejected (no bloat beyond 10)
	// Candidate 2: MIT OpenCourseWare textbook -> higher reputation, must replace a weak blog post!
	const candidates: StudyMaterial[] = [
		mat(90, "https://another-weak-blog.example/x", "Weak blog", { suggested: true }),
		mat(91, "https://ocw.mit.edu/courses/circuits-electronics", "MIT OCW Circuits and Electronics", {
			part: "Chapter 1 · Complete lecture notes",
			suggested: false,
		}),
	];

	const result = mergeEnrichedMaterialsWithCap(fixed, existing, candidates);
	assert.equal(result.atCap, true);
	assert.equal(result.upgraded, 1);
	assert.equal(fixed.length + result.merged.length, MAX_MATERIALS_PER_NODE);
	assert.ok(result.merged.some(m => m.url === "https://ocw.mit.edu/courses/circuits-electronics"));
	assert.ok(!result.merged.some(m => m.url === "https://another-weak-blog.example/x"));
});

it("never drops fixed/manual items even when fixed count reaches cap", () => {
	const fixed: StudyMaterial[] = Array.from({ length: 10 }, (_, i) =>
		mat(i, `https://local.example/m${i}`, `Manual ${i}`, { manual: true, suggested: false }),
	);
	const candidates: StudyMaterial[] = [
		mat(99, "https://ocw.mit.edu/courses/test", "MIT Course", { suggested: false }),
	];
	const result = mergeEnrichedMaterialsWithCap(fixed, [], candidates);
	assert.equal(result.atCap, true);
	assert.equal(result.merged.length, 0);
	assert.equal(result.upgraded, 0);
});
