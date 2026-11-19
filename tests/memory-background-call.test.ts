import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, type AssistantMessage } from "@earendil-works/pi-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { PiEngine } from "../src/agent/models.ts";
import type { MemoryLlmRequest } from "../src/server/memory/extractor.ts";
import { createDomainsStore } from "../src/store/domains-store.ts";
import { createStatsStore } from "../src/store/stats-store.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-memory-background-"));
process.env.LH_DATA_DIR = root;
process.env.LH_AUTH_FILE = path.join(root, "auth.json");
const { domainMemoryLlmCall } = await import("../src/server/memory/background-call.ts");
const { settingsStore } = await import("../src/store/settings.ts");
const { configureWorkerRequestAdmission } = await import("../src/agent/worker-request-admission.ts");
const { createLlmExtractor } = await import("../src/server/memory/extractor.ts");
const domains = createDomainsStore(root);
domains.seedBuiltinDomains();
const stats = createStatsStore(root);
after(() => fs.rmSync(root, { recursive: true, force: true }));

const request: MemoryLlmRequest = {
	role: "extractor", op: "extract", system: "Reply in JSON.", messages: [{ role: "user", content: "Teste." }], maxOutputTokens: 25, json: true,
};
const model = { ...createFauxCore({}).getModel(), provider: "faux", id: "memory-test" };
const settings = { version: 1, models: { cheap: { model: { provider: model.provider, id: model.id } } } };
function limit(tokensPerDay: number, enabled = true) {
	domains.updateManifest("english", manifest => ({ ...manifest, backgroundBudget: { enabled, tokensPerDay } }));
}
function rows() {
	return stats.readUsage({ from: new Date(Date.now() - 100_000).toISOString(), to: new Date(Date.now() + 1000).toISOString() }).events;
}
function answer(text: string): AssistantMessage {
	const message = fauxAssistantMessage(text);
	message.usage = { ...message.usage, input: 5, output: 7, cacheRead: 3, cacheWrite: 2, totalTokens: 17 };
	return message;
}
function emit(stream: AssistantMessageEventStream, message: AssistantMessage) {
	stream.push({ type: "done", reason: "stop", message });
	stream.end();
}

it("resolves configured slots, records the originating domain and preserves retry roles and usage buckets", async () => {
	settingsStore.writeSettings({ ...settings, agent: { models: { auditor: { model: { provider: "faux", id: "audit" } } } } });
	limit(300_000);
	const calls: string[] = [];
	const call = domainMemoryLlmCall("english", (spec, background) => {
		assert.equal(background, true);
		calls.push(spec.id);
		return { model: { ...model, id: spec.id }, streamFn: (_model, ctx, opts) => {
			assert.equal(opts?.maxRetries, 0);
			assert.equal(opts?.maxTokens, 25);
			assert.equal(opts?.sessionId, "memory-english");
			assert.deepEqual(ctx.messages.map(m => m.role), ["system", "user", "assistant", "user"]);
			const stream = new AssistantMessageEventStream();
			emit(stream, answer("{}"));
			return stream;
		} };
	});
	const retry = { ...request, messages: [...request.messages, { role: "assistant" as const, content: "bad" }, { role: "user" as const, content: "fix" }] };
	const before = rows().length;
	const result = await call(retry);
	await call({ ...retry, role: "judge", op: "judge" });
	assert.deepEqual(calls, ["memory-test", "audit"]);
	assert.deepEqual(result, { text: "{}", modelId: "faux:memory-test", inputTokens: 5, outputTokens: 7, cachedTokens: 5 });
	assert.deepEqual(rows().slice(before).map(e => [e.domain, e.op, e.background, e.inputTokens, e.outputTokens, e.cachedTokens, e.cacheWriteTokens]), [
		["english", "memory.extract", true, 5, 7, 3, 2], ["english", "memory.judge", true, 5, 7, 3, 2],
	]);
});

it("refuses disabled domains and Claude CLI before resolving an engine", async () => {
	settingsStore.writeSettings(settings);
	limit(300_000, false);
	const call = domainMemoryLlmCall("english", () => { throw new Error("unexpected engine"); });
	await assert.rejects(call(request), /desativada/);
	limit(300_000);
	settingsStore.writeSettings({ version: 1, models: { cheap: { model: { provider: "claude-code", id: "local" } } } });
	await assert.rejects(call(request), /não permite/);
});

it("rechecks allowance after admission, reserves concurrent calls and charges missing usage against the day", async () => {
	settingsStore.writeSettings(settings);
	configureWorkerRequestAdmission(() => 2);
	limit(300_000);
	let dispatch!: () => void;
	const started = new Promise<void>(resolve => { dispatch = resolve; });
	const source = new AssistantMessageEventStream();
	let upstream = 0;
	let firstReservation = 0;
	const engine: PiEngine = { model, streamFn: (_model, ctx, opts) => {
		upstream++;
		firstReservation = Buffer.byteLength(JSON.stringify(ctx.messages)) + opts!.maxTokens!;
		dispatch();
		return source;
	} };
	const call = domainMemoryLlmCall("english", () => engine);
	const knownSpent = rows().filter(e => e.domain === "english" && e.background).reduce((n, e) => n + e.inputTokens + e.outputTokens + e.cachedTokens + (e.cacheWriteTokens ?? 0), 0);
	const active = call(request);
	await started;
	// Enough for the single in-flight call, but insufficient for two. Capture
	// the native context size instead of relying on a tokenizer or delay.
	limit(knownSpent + firstReservation);
	await assert.rejects(call(request), /Orçamento/);
	assert.equal(upstream, 1);
	const noUsage = answer("{}");
	noUsage.usage = { ...noUsage.usage, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
	emit(source, noUsage);
	await active;
	const row = rows().at(-1)!;
	assert.equal(row.usageIncomplete, true);
	assert.ok(row.budgetEstimateTokens && row.budgetEstimateTokens > 0);
	limit(knownSpent + row.budgetEstimateTokens);
	await assert.rejects(call(request), /Orçamento/);
	assert.equal(upstream, 1);
});

it("charges every corrective extractor request while keeping transport retries disabled", async () => {
	settingsStore.writeSettings(settings);
	limit(300_000);
	let count = 0;
	const call = domainMemoryLlmCall("english", () => ({ model, streamFn: (_model, _ctx, opts) => {
		assert.equal(opts?.maxRetries, 0);
		const stream = new AssistantMessageEventStream();
		emit(stream, answer(count++ === 0 ? "malformed" : '{"facts":[],"entities":[],"episodes":[],"evidence":[],"flashcardCandidates":[]}'));
		return stream;
	} }));
	const before = rows().length;
	const extraction = await createLlmExtractor({ call }).extract({ domainId: "english", sessionId: "test", focusNodes: [], messages: [], sessionStartedAt: 0, now: Date.now() });
	assert.equal(count, 2);
	assert.equal(extraction.usage?.inputTokens, 10);
	assert.equal(extraction.usage?.cachedTokens, 10);
	assert.equal(rows().length - before, 2);
});

it("checks domain consent again when a queued worker gets its permit", async () => {
	settingsStore.writeSettings(settings);
	limit(300_000);
	configureWorkerRequestAdmission(() => 1);
	const source = new AssistantMessageEventStream();
	let dispatch!: () => void;
	const started = new Promise<void>(resolve => { dispatch = resolve; });
	let upstream = 0;
	const call = domainMemoryLlmCall("english", () => ({ model, streamFn: () => {
		upstream++;
		dispatch();
		return source;
	} }));
	const active = call(request);
	await started;
	const waiting = call(request);
	limit(300_000, false);
	emit(source, answer("{}"));
	await active;
	await assert.rejects(waiting, /desativada/);
	assert.equal(upstream, 1);
});
