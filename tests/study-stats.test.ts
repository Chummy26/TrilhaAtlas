import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { createFauxCore, fauxAssistantMessage, fauxToolCall, normalizeContext } from "@earendil-works/pi-ai";
import { createStatsStore } from "../src/store/stats-store.ts";
import { usageEventFromCall } from "../src/core/stats/events.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-study-stats-"));
process.env.LH_DATA_DIR = root;
const { studyProfile, switchStudyDomain } = await import("../src/server/study.ts");
const { chatStore } = await import("../src/store/chats.ts");
after(() => fs.rmSync(root, { recursive: true, force: true }));

it("reads measured seconds and per-call tokens, preserves historical counters and never counts a step twice", () => {
	switchStudyDomain("english");
	const stats = createStatsStore(root);
	const at = new Date();
	at.setDate(at.getDate() - 1);
	at.setHours(12, 0, 0, 0);
	const instant = at.toISOString();
	const chat = chatStore.createChat("Lesson");
	const step = { inputTokens: 10, outputTokens: 4, cacheReadTokens: 3, cacheWriteTokens: 2, reasoningTokens: 1 };
	chatStore.appendTurnUsage(chat.id, { id: "turn", messageId: "m", at: instant, model: "test:tutor",
		steps: [step, { ...step, recordedInStats: true }] });
	stats.appendUsage(usageEventFromCall(step, { at: instant, domain: "english", op: "teacher",
		connection: "test", provider: "test", model: "tutor", billing: "api", durationMs: 12 }));
	stats.appendUsage(usageEventFromCall({ inputTokens: 10, outputTokens: 2 }, { at: instant, domain: "english",
		op: "extractor", connection: "test", provider: "test", model: "background", billing: "api", durationMs: 8 }));
	for (let i = 0; i < 2; i++) stats.appendActivity({ at: instant, domain: "english", activeSec: 60, kind: "lesson" });
	const profile = studyProfile();
	assert.equal(profile.usage.totalTokens, 50);
	assert.equal(profile.usage.calls, 3);
	assert.equal(profile.days.reduce((sum, d) => sum + d.minutes, 0), 1);
	assert.equal(profile.usage.byModel.find(row => row.model === "test:tutor")?.tokens, 38);
});

it("observes a real provider stream once, using the domain at dispatch even after a switch", async () => {
	const { observeEngineUsage, chatStepUsage } = await import("../src/server/study-usage.ts");
	switchStudyDomain("english");
	const faux = createFauxCore({});
	const source = new AssistantMessageEventStream();
	const engine = observeEngineUsage({ model: faux.getModel(), streamFn: () => source }, "teacher");
	const stream = engine.streamFn(engine.model, normalizeContext({ messages: [] }));
	assert.equal(stream, source);
	switchStudyDomain("electronics");
	const message = fauxAssistantMessage("ok");
	message.usage.input = 23;
	message.usage.output = 7;
	source.push({ type: "done", reason: "stop", message });
	source.end();
	await stream.result();
	assert.equal(chatStepUsage(message.usage).recordedInStats, true);
	const rows = createStatsStore(root).readUsage({ from: new Date(Date.now() - 60_000).toISOString(), to: new Date(Date.now() + 1000).toISOString() }).events.filter(e => e.inputTokens === 23);
	assert.equal(rows.length, 1);
	assert.equal(rows[0]?.domain, "english");
	assert.equal(rows[0]?.op, "teacher");
});

it("accounts for both provider calls when a teacher turn uses a tool", async () => {
	const { createTeacherAgent } = await import("../src/agent/teacher-agent.ts");
	const { readTool } = await import("../src/agent/tools/read.ts");
	const { observeEngineUsage, chatStepUsage } = await import("../src/server/study-usage.ts");
	const file = path.join(root, "lesson.txt");
	fs.writeFileSync(file, "Study notes");
	const faux = createFauxCore({});
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall("read", { path: file }), { stopReason: "toolUse" }),
		fauxAssistantMessage("Finished reading."),
	]);
	const engine = observeEngineUsage({ model: faux.getModel(), streamFn: faux.streamSimple }, "tool-round-test");
	const steps: ReturnType<typeof chatStepUsage>[] = [];
	const since = new Date().toISOString();
	const agent = createTeacherAgent(undefined, { engine, tools: { read: readTool }, onUsage: usage => steps.push(chatStepUsage(usage)) });
	await agent.prompt("Read the study notes.");
	const rows = createStatsStore(root).readUsage({ from: since, to: new Date(Date.now() + 1).toISOString() }).events.filter(e => e.op === "tool-round-test");
	assert.equal(rows.length, 2);
	assert.deepEqual(steps.map(step => step.recordedInStats), [true, true]);
});

it("credits only focused spans, flushes short visits and stops at the idle limit", async () => {
	const { startStudyHeartbeat } = await import("../components/study/heartbeat.ts");
	const win = new EventTarget();
	const doc = Object.assign(new EventTarget(), { visibilityState: "visible", hasFocus: () => focused, querySelectorAll: () => [] });
	let focused = true;
	let now = 0;
	let tick = () => {};
	const beats: { at: string; activeSec: number; kind: string }[] = [];
	const close = startStudyHeartbeat({ window: win, document: doc, now: () => now,
		schedule: fn => { tick = fn; return () => {}; } }, "english", "practice", e => beats.push(e));
	now = 60_000; tick();
	now = 90_000; focused = false; win.dispatchEvent(new Event("blur"));
	now = 250_000; tick();
	focused = true; win.dispatchEvent(new Event("focus"));
	now = 450_000; tick();
	now = 451_000; doc.dispatchEvent(new Event("keydown"));
	now = 460_500; close();
	assert.deepEqual(beats.map(b => b.activeSec), [60, 30, 60, 60, 9.5]);
	assert.deepEqual(beats.map(b => Date.parse(b.at)), [60000, 90000, 310000, 370000, 460500]);
});

it("counts focused video playback beyond the input timeout and stops when paused", async () => {
	const { startStudyHeartbeat } = await import("../components/study/heartbeat.ts");
	const video = { paused: true, ended: false, readyState: 4, seeking: false };
	const doc = Object.assign(new EventTarget(), { visibilityState: "visible", hasFocus: () => true, querySelectorAll: () => [video] });
	const beats: { activeSec: number; kind: string }[] = [];
	let now = 0;
	const close = startStudyHeartbeat({ window: new EventTarget(), document: doc, now: () => now,
		schedule: () => () => {} }, "english", "lesson", e => beats.push(e));
	now = 10_000;
	video.paused = false;
	doc.dispatchEvent(new Event("playing"));
	now = 220_000;
	video.paused = true;
	doc.dispatchEvent(new Event("pause"));
	now = 300_000;
	close();
	assert.equal(beats.filter(e => e.kind === "media").reduce((n, e) => n + e.activeSec, 0), 210);
	assert.equal(beats.filter(e => e.kind === "lesson").reduce((n, e) => n + e.activeSec, 0), 10);
});

it("accepts partial beats for their original domain and rejects out-of-window payloads", async () => {
	const { POST } = await import("../app/api/stats/activity/route.ts");
	const post = (body: unknown) => POST(new Request("http://local/api/stats/activity", {
		method: "POST", body: JSON.stringify(body),
	}));
	const at = new Date().toISOString();
	const beat = { at, activeSec: 60, kind: "lesson", domain: "english" };
	assert.equal((await post(beat)).status, 204);
	assert.equal((await post({ ...beat, activeSec: 61 })).status, 400);
	assert.equal((await post({ ...beat, domain: "../x" })).status, 400);
	assert.equal((await post({ ...beat, domain: "missing" })).status, 400);
});
