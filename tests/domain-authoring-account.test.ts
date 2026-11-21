import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { normalizeContext } from "@earendil-works/pi-ai";

test("domain authoring uses the selected account and fresh model, and charges the new domain as foreground", async t => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "trilha-domain-account-"));
	process.env.LH_DATA_DIR = root;
	process.env.LH_AUTH_FILE = path.join(root, "auth.json");
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const { domainAuthoringEngine } = await import("../src/server/domain-authoring-engine.ts");
	const { writeSettings } = await import("../src/store/settings.ts");
	const { createStatsStore } = await import("../src/store/stats-store.ts");
	const { configureWebSubscriptionRuntime } = await import("../src/agent/subscription-runtime.ts");
	const stamp = { epoch: 1, authorityRevision: 1, revision: 1 };
	const status = {
		available: true, pending: false, activeId: "local", allowBackgroundUse: false, error: null,
		accounts: [{ id: "local", connected: true, planEnabled: true }],
	};
	const models = ["alpha", "beta"].map(id => ({ id, name: id, contextWindow: 64000, maxOutput: 16000, input: ["text", "image"], efforts: ["low", "high"] }));
	let leaseModel;
	configureWebSubscriptionRuntime(async <T>(channel: string, op: string, fields: Record<string, unknown>) => {
		assert.equal(channel, "lh:chatgpt");
		if (op === "models") return { ...stamp, status, accountId: "local", models } as T;
		assert.equal(op, "lease");
		assert.equal(fields.background, false);
		leaseModel = fields.selectedModelId;
		return { ...stamp, accountId: "local", accessToken: "scratch-subscription-token" } as T;
	});
	const select = (id: string) => writeSettings({ models: { strong: { model: { provider: "chatgpt", id }, thinkingLevel: "high" } } });
	select("alpha");
	assert.equal((await domainAuthoringEngine("geologia")).model.id, "alpha");
	select("beta");
	const engine = await domainAuthoringEngine("geologia");
	assert.equal(engine.level, "high");
	const message = await engine.streamFn(engine.model, normalizeContext({
		messages: [{ role: "user", content: "Ensine a ler rochas", timestamp: 1 }],
	}), {
		fetch: async (input, init) => {
			const req = new Request(input, init);
			assert.equal(req.url, "https://api.openai.com/v1/responses");
			assert.equal(req.headers.get("authorization"), "Bearer scratch-subscription-token");
			assert.equal((await req.json()).model, "beta");
			const event = { type: "response.completed", response: { id: "resp_fake", status: "completed", output: [], usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 } } };
			return new Response("data: " + JSON.stringify(event) + "\n\n", { headers: { "content-type": "text/event-stream" } });
		},
	}).result();
	assert.equal(message.stopReason, "stop", message.errorMessage);
	assert.equal(leaseModel, "beta");
	const usage = createStatsStore(root).readUsage({ from: new Date(Date.now() - 60000).toISOString(), to: new Date(Date.now() + 60000).toISOString() }, { domain: "geologia" }).events;
	assert.deepEqual(usage.map(e => [e.model, e.op, e.billing, e.background]), [["beta", "curriculum.generate", "subscription", false]]);
	// Concurrent catalog refreshes (e.g. /api/models + domain authoring) must coalesce cleanly instead of dropping models.
	const [concurrentA, concurrentB] = await Promise.all([
		domainAuthoringEngine("geologia", { provider: "chatgpt", id: "alpha" }),
		domainAuthoringEngine("geologia", { provider: "chatgpt", id: "beta" }),
	]);
	assert.equal(concurrentA.model.id, "alpha");
	assert.equal(concurrentB.model.id, "beta");
	await assert.rejects(domainAuthoringEngine("geologia", { provider: "chatgpt", id: "removed" }), /não está disponível no catálogo atual/i);
});
