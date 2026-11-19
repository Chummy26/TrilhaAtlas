import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import type { Evidence } from "../src/core/learner/types.ts";

it("turns distinct failed checks into one optional sibling and replays it without changing any existing route", async t => {
	const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lh-expansion-"));
	process.env.LH_DATA_DIR = temp;
	process.env.LH_AUTH_FILE = path.join(temp, "auth.json");
	t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
	const { expandStudyWeakness, failedChecks } = await import("../src/server/study-expansion.ts");
	const { switchStudyDomain, studyDomains, loadCurriculum, studyMap, studyToday, validateStudyLesson } = await import("../src/server/study.ts");
	const { appendStudyEvent } = await import("../src/server/study-log.ts");
	const { studyMapLesson } = await import("../src/server/study-materials.ts");
	const { replayLedger } = await import("../src/core/curriculum/ledger.ts");
	const domain = "electronics";
	switchStudyDomain(domain);
	const manifest = studyDomains().readManifest(domain)!;
	const start = studyToday();
	const target = start.next!.nodeId;
	const initial = loadCurriculum(domain, manifest)!;
	const prior = "ee.digital.numbers.number-systems";
	const goal = studyDomains().readProfile(domain)!.goal;
	appendStudyEvent(domain, { kind: "diagnostic", id: "previous", seq: 1, at: new Date().toISOString(), domainId: domain,
		estimates: [{ nodeId: prior, p: 0.9 }] });
	const before = studyToday().progress;
	const checks: Evidence[] = [];
	for (const [index, question] of ["Quanto vale dez elevado a menos dois?", "Como escrever um milésimo como potência?"].entries()) {
		const e: Evidence = { id: "q" + index, seq: index + 2, at: new Date().toISOString(), domainId: domain,
			sessionId: "lesson", lessonExposureId: "lesson", itemId: "item" + index, itemFamily: target + "#mcq",
			nodes: [{ nodeId: target, primary: true, q: 1 }], format: "mcq", level: 2, grade: 0,
			hints: 0, graderConfidence: 1, minutesSinceExposure: 4, quizContext: { question, answer: "Não sei" } };
		checks.unshift(e);
		appendStudyEvent(domain, { kind: "evidence", evidence: e });
	}
	let calls = 0;
	const generate: NonNullable<Parameters<typeof expandStudyWeakness>[2]> = async request => {
		calls++;
		assert.ok(request.messages[0]!.content.includes(checks[0]!.quizContext!.question));
		return { text: JSON.stringify({ action: "add", title: { pt: "Converter milésimos em potências negativas", en: "Write thousandths as negative powers" },
			summary: "Represente um milésimo usando divisões sucessivas por dez.", objective: "Converter frações decimais em potências com expoente negativo." }),
			inputTokens: 95, outputTokens: 40, cachedTokens: 0, modelId: "fixture" };
	};
	const events = [...checks].reverse().map(evidence => ({ kind: "evidence" as const, evidence }));
	assert.deepEqual(failedChecks([events[0]!, events[0]!]), []);
	assert.deepEqual(failedChecks([...events, { kind: "evidence", evidence: { ...checks[0]!, grade: 3 } }]), []);
	const candidate = { target, checks };
	await Promise.all([expandStudyWeakness(domain, candidate, generate), expandStudyWeakness(domain, candidate, generate)]);
	assert.equal(calls, 1);
	const updated = loadCurriculum(domain, manifest)!;
	const added = Object.values(updated.snapshot.items).filter(i => i.reinforcementFor);
	assert.equal(added.length, 1);
	const node = added[0]!;
	assert.equal(node.parentId, initial.snapshot.items[target]!.parentId);
	for (const old of initial.view.ids) {
		assert.equal(updated.view.nodes.get(old)!.version, initial.view.nodes.get(old)!.version);
		assert.deepEqual(updated.view.nodes.get(old)!.clauses, initial.view.nodes.get(old)!.clauses);
	}
	assert.deepEqual(updated.view.nodes.get(node.id)!.clauses, initial.view.nodes.get(target)!.clauses);
	assert.deepEqual(studyToday().progress, before);
	assert.deepEqual(studyDomains().readProfile(domain)!.goal, goal);
	assert.equal(validateStudyLesson({ domainId: domain, minutes: 20 }, node.id).exploratory, true);
	assert.equal(studyToday().optionalPractice?.id, node.id);
	const map = studyMap();
	assert.equal(map.nodes.find(n => n.id === target)!.region, map.nodes.find(n => n.id === node.id)!.region);
	assert.equal((await studyMapLesson(domain, node.id)).brief.objectives[0], node.objectives[0]);
	const ledger = fs.readFileSync(path.join(temp, "domains", domain, "curriculum", "ledger.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l));
	const replay = replayLedger(ledger, { edgeMode: manifest.edgeMode });
	assert.ok(replay.ok);
	assert.equal(replay.snapshot.certificate.hash, updated.snapshot.certificate.hash);
	switchStudyDomain("english");
	assert.ok(studyMap().nodes.every(n => !n.reinforcementFor));
	const englishTarget = studyToday().next!.nodeId;
	const englishChecks = checks.map(e => ({ ...e, domainId: "english", nodes: [{ nodeId: englishTarget, primary: true, q: 1 }] }));
	for (const evidence of [...englishChecks].reverse()) appendStudyEvent("english", { kind: "evidence", evidence });
	let skipped = 0;
	const skip: typeof generate = async () => { skipped++; return { text: '{"action":"skip"}', modelId: "fixture", inputTokens: 4, outputTokens: 4, cachedTokens: 0 }; };
	await expandStudyWeakness("english", { target: englishTarget, checks: englishChecks }, skip);
	await expandStudyWeakness("english", { target: englishTarget, checks: englishChecks }, skip);
	assert.equal(skipped, 1);
	assert.ok(studyMap().nodes.every(n => !n.reinforcementFor));
});
