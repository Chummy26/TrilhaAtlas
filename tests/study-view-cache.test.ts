import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-projected-history-"));
process.env.LH_DATA_DIR = root;
process.env.LH_AUTH_FILE = path.join(root, "auth.json");
const { switchStudyDomain, studyMap, studyToday, studyProfile } = await import("../src/server/study.ts");
after(() => fs.rmSync(root, { recursive: true, force: true }));

it("updates planning windows on a warm history and sees disk replacements in both map and profile", t => {
	const now = Date.UTC(2026, 0, 1, 12);
	t.mock.timers.enable({ apis: ["Date"], now });
	switchStudyDomain("english");
	const node = studyToday().next!.nodeId;
	const domain = path.join(root, "domains", "english");
	const log = path.join(domain, "learner", "events.jsonl");
	fs.mkdirSync(path.dirname(log), { recursive: true });
	const lesson = { kind: "exposure", seq: 1, id: "l", sessionId: "c", domainId: "english",
		nodeId: node, source: "ai_lesson", minutes: 25, at: new Date(now).toISOString() };
	fs.writeFileSync(log, JSON.stringify(lesson) + "\n");
	assert.equal(studyMap().position, node);
	assert.equal(studyToday().pendingCheck?.exposureId, "l");
	t.mock.timers.setTime(now + 4 * 86_400_000);
	assert.equal(studyToday().pendingCheck, null);
	fs.writeFileSync(log + ".next", JSON.stringify({ ...lesson, exploratory: true }) + "\n");
	fs.renameSync(log + ".next", log);
	assert.equal(studyMap().position, undefined);

	const chat = path.join(domain, "chats", "c.json");
	fs.mkdirSync(path.dirname(chat), { recursive: true });
	const record = (tokens: number) => JSON.stringify({ turns: [{ model: "test", steps: [{ inputTokens: tokens }] }] });
	fs.writeFileSync(chat, record(20));
	assert.equal(studyProfile().usage.totalTokens, 20);
	const reads = t.mock.method(fs, "readFileSync");
	assert.equal(studyProfile().usage.totalTokens, 20);
	assert.equal(reads.mock.calls.filter(call => String(call.arguments[0]) === chat).length, 0);
	fs.writeFileSync(chat + ".next", record(30));
	fs.renameSync(chat + ".next", chat);
	assert.equal(studyProfile().usage.totalTokens, 30);
	fs.unlinkSync(chat);
	assert.equal(studyProfile().usage.totalTokens, 0);
});
