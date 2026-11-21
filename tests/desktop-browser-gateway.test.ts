import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { startBrowserGateway } = require("../electron/browser-gateway.cjs");

test("the browser pairs once and uses the same private backend, including writes", async () => {
	const requests: Array<{ secret: string | string[] | undefined; path: string | undefined; body: string; cookie: string | undefined }> = [];
	const upstream = createServer(async (req, res) => {
		let body = "";
		for await (const chunk of req) body += chunk;
		requests.push({ secret: req.headers["x-learnharness-desktop"], path: req.url, body, cookie: req.headers.cookie });
		res.end("shared backend");
	});
	await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
	const address = upstream.address();
	assert(address && typeof address !== "string");
	const gateway = await startBrowserGateway({ upstreamPort: address.port, secret: "a".repeat(64), port: 0 });
	try {
		const send = (path: string, options: { method?: string; body?: string; headers?: Record<string, string> } = {}, host = gateway.host) =>
			new Promise<Response>((resolve, reject) => {
				const client = request({ hostname: "127.0.0.1", port: gateway.port, path, method: options.method, headers: { host, ...options.headers } }, async (reply) => {
					try {
						const chunks: Buffer[] = [];
						for await (const chunk of reply) chunks.push(chunk);
						resolve(new Response(Buffer.concat(chunks), { status: reply.statusCode, headers: reply.headers as Record<string, string> }));
					} catch (error) { reject(error); }
				});
				client.on("error", reject);
				client.end(options.body);
			});
		const pairing = new URL(gateway.pairingUrl());
		const path = pairing.pathname + pairing.search;
		assert.equal((await send("/api/chats")).status, 403);
		assert.equal((await send(path, {}, "other.localhost:" + gateway.port)).status, 403);
		const joined = await send(path);
		assert.equal(joined.status, 303);
		assert.equal(joined.headers.get("location"), "/");
		const setCookie = joined.headers.get("set-cookie")!;
		assert.match(setCookie, /HttpOnly; SameSite=Strict/);
		const cookie = setCookie.split(";")[0]!;
		assert.equal((await send(path)).status, 403);
		assert.equal(await (await send("/", { headers: { cookie } })).text(), "shared backend");
		assert.equal((await send("/api/chats", { headers: { cookie, "sec-fetch-site": "same-site" } })).status, 403);
		assert.equal((await send("/api/chats", { method: "POST", body: "blocked", headers: { cookie, origin: "http://other.localhost" } })).status, 403);
		const response = await send("/api/chats", { method: "POST", body: "saved", headers: {
			cookie, origin: pairing.origin, "sec-fetch-site": "same-origin", "x-learnharness-desktop": "forged",
		} });
		assert.equal(await response.text(), "shared backend");
		assert.deepEqual(requests, [
			{ secret: "a".repeat(64), path: "/", body: "", cookie: undefined },
			{ secret: "a".repeat(64), path: "/api/chats", body: "saved", cookie: undefined },
		]);
	} finally {
		gateway.close();
		upstream.closeAllConnections();
		upstream.close();
	}
});
