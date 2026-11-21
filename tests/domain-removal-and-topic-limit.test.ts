import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("removeStudyDomain removes inactive and active domains, persists built-in removal, and topic accepts up to 12,000 chars", async (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "trilha-domain-remove-"));
	process.env.LH_DATA_DIR = root;
	process.env.LH_AUTH_FILE = path.join(root, "auth.json");
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));

	const { listStudyDomains, removeStudyDomain, StudyError, studyDomains, switchStudyDomain } = await import("../src/server/study.ts");
	const { startDomainCreation } = await import("../src/server/create-study-domain.ts");

	const initial = listStudyDomains();
	assert.deepEqual(initial.domains.map((d) => d.id), ["english", "electronics"]);

	// Switch to english, then remove inactive electronics.
	switchStudyDomain("english");
	const afterInactive = removeStudyDomain("electronics");
	assert.equal(afterInactive.removed, "electronics");
	assert.equal(afterInactive.activeChanged, false);
	assert.equal(afterInactive.active, "english");
	assert.deepEqual(afterInactive.domains.map((d) => d.id), ["english"]);

	// Re-seeding built-ins must NOT resurrect a domain the learner removed.
	studyDomains().seedBuiltinDomains();
	assert.deepEqual(listStudyDomains().domains.map((d) => d.id), ["english"]);

	// Removing the active (and last) domain cleanly falls back to Geral (null).
	const afterActive = removeStudyDomain("english");
	assert.equal(afterActive.removed, "english");
	assert.equal(afterActive.activeChanged, true);
	assert.equal(afterActive.active, null);
	assert.deepEqual(afterActive.domains, []);

	// Invalid / missing IDs return 400 / 404.
	assert.throws(() => removeStudyDomain("invalid id!"), (err: unknown) => err instanceof StudyError && err.status === 400);
	assert.throws(() => removeStudyDomain("electronics"), (err: unknown) => err instanceof StudyError && err.status === 404);

	// Create-domain topic accepts 12,000 chars and rejects 12,001 chars.
	const scheduled: Array<() => Promise<void>> = [];
	const longTopic = "A".repeat(12_000);
	const ok = startDomainCreation(
		{ requestId: "00000000-0000-4000-8000-000000000011", topic: longTopic },
		(fn) => { scheduled.push(fn); },
	);
	assert.equal(ok.state, "planning");
	assert.equal(scheduled.length, 1);

	assert.throws(
		() => startDomainCreation({ requestId: "00000000-0000-4000-8000-000000000012", topic: "B".repeat(12_001) }, () => {}),
		(err: unknown) => err instanceof StudyError && err.status === 400 && err.message.includes("12.000"),
	);
});
