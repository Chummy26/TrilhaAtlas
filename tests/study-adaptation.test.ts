import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";

it("uses the saved goal and reinforces its overdue weak prerequisite before advancing", async t => {
	const temp = mkdtempSync(path.join(os.tmpdir(), "lh-study-adaptation-"));
	process.env.LH_DATA_DIR = temp;
	process.env.LH_AUTH_FILE = path.join(temp, "auth.json");
	t.after(() => rmSync(temp, { recursive: true, force: true }));
	const { switchStudyDomain, studyDomains, studyToday, studyMap } = await import("../src/server/study.ts");
	const { appendStudyEvent } = await import("../src/server/study-log.ts");
	const domain = "electronics";
	const prerequisite = "ee.digital.numbers.number-systems";
	const goal = "ee.digital.boolean.boolean-algebra";
	switchStudyDomain(domain);
	studyDomains().updateProfile(domain, profile => ({
		...profile, goal: { text: "Entender lógica booleana", targetNodeIds: [goal] },
	}));
	assert.equal(studyToday().next?.nodeId, prerequisite);
	const grades = [3, 3, 3, 0, 0] as const;
	for (const [index, grade] of grades.entries()) {
		const at = new Date(Date.now() - (grades.length - index) * 86_400_000).toISOString();
		appendStudyEvent(domain, { kind: "evidence", evidence: {
			id: "check-" + index, seq: index + 1, at, domainId: domain, sessionId: "fixture",
			itemId: "q" + index, itemFamily: "set" + index, nodes: [{ nodeId: prerequisite, q: 1, primary: true }],
			format: "numeric", level: 3, grade, graderConfidence: 1, hints: 0, minutesSinceExposure: 2000,
		} });
	}
	const next = studyToday().next;
	assert.equal(next?.nodeId, prerequisite);
	assert.equal(next?.kind, "remediate");
	assert.equal(studyMap().reinforcement, next.reason);
});
