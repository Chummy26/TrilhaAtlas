import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const testData = fs.mkdtempSync(path.join(os.tmpdir(), "lh-google-vertex-data-"));
process.env.LH_DATA_DIR = testData;
after(() => fs.rmSync(testData, { recursive: true, force: true }));

const {
	readAdcQuotaProject,
	readGcloudDefaultProject,
	resolveGoogleAdc,
	resolveGoogleVertexRuntime,
} = await import("../src/agent/google-vertex-auth.ts");
const { piEngineForSpec, piModels } = await import("../src/agent/models.ts");
const { GOOGLE_VERTEX_DEFAULT_LOCATION, GOOGLE_VERTEX_PROVIDER } = await import("../src/core/contracts/google-vertex.ts");
const { sanitizeUserSettings, providerKeyMissing, isProviderKeyRefusal } = await import("../src/core/settings.ts");
const { parseGoogleVertexSettingsBody } = await import("../src/server/settings-body.ts");
const { googleVertexAvailable, googleVertexStatus, googleVertexStatusResponse } = await import("../src/server/google-vertex.ts");
const {
	parseModelsDevPayload,
	refreshModelsDevCatalog,
	resetModelsDevCatalogCacheForTest,
} = await import("../src/server/google-vertex-catalog.ts");
const { compareModelsByRecency } = await import("../src/core/models/recency.ts");
const { providerKeyPresent } = await import("../src/server/keys.ts");
const { catalogProviders, modelCatalog, validateChatSettings } = await import("../src/server/model-catalog.ts");
const { readSettings, writeSettings } = await import("../src/store/settings.ts");
const { SETTINGS_FILE } = await import("../config.ts");
const { PUT } = await import("../app/api/settings/[section]/route.ts");

function withFakeGcloud(
	fn: (dir: string) => void | Promise<void>,
	opts: { adc?: boolean; gcloudProject?: string; adcQuotaProject?: string; enabled?: boolean; project?: string; location?: string } = {},
) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-gcloud-home-"));
	const gcloudDir = path.join(dir, "gcloud");
	const configDir = path.join(gcloudDir, "configurations");
	fs.mkdirSync(configDir, { recursive: true });
	if (opts.adc !== false) {
		const payload: Record<string, string> = { type: "authorized_user" };
		if (opts.adcQuotaProject) payload.quota_project_id = opts.adcQuotaProject;
		fs.writeFileSync(path.join(gcloudDir, "application_default_credentials.json"), JSON.stringify(payload));
	}
	if (opts.gcloudProject) {
		fs.writeFileSync(path.join(gcloudDir, "active_config"), "default\n");
		fs.writeFileSync(path.join(configDir, "config_default"), `[core]\nproject = ${opts.gcloudProject}\n`);
	}

	const saved = {
		CLOUDSDK_CONFIG: process.env.CLOUDSDK_CONFIG,
		GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
		GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
		GCLOUD_PROJECT: process.env.GCLOUD_PROJECT,
		GOOGLE_CLOUD_LOCATION: process.env.GOOGLE_CLOUD_LOCATION,
		GOOGLE_CLOUD_API_KEY: process.env.GOOGLE_CLOUD_API_KEY,
	};
	const previousSettings = readSettings();

	process.env.CLOUDSDK_CONFIG = gcloudDir;
	delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
	delete process.env.GOOGLE_CLOUD_PROJECT;
	delete process.env.GCLOUD_PROJECT;
	delete process.env.GOOGLE_CLOUD_LOCATION;
	delete process.env.GOOGLE_CLOUD_API_KEY;
	if (opts.enabled !== undefined) {
		writeSettings({
			...(previousSettings ?? { version: 1 }),
			googleVertex: {
				enabled: opts.enabled,
				...(opts.project ? { project: opts.project } : {}),
				...(opts.location ? { location: opts.location } : {}),
			},
		});
	}

	const restore = () => {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		if (previousSettings) writeSettings(previousSettings);
		else fs.rmSync(SETTINGS_FILE, { force: true });
		fs.rmSync(dir, { recursive: true, force: true });
	};

	try {
		const res = fn(gcloudDir);
		if (res && typeof (res as Promise<void>).then === "function") {
			return (res as Promise<void>).finally(restore);
		}
		restore();
	} catch (error) {
		restore();
		throw error;
	}
}

describe("Google Vertex AI (gcloud ADC) resolution", () => {
	it("resolves Windows %APPDATA%\\gcloud ADC and POSIX ~/.config/gcloud ADC", () => {
		const winAdc = "C:\\Users\\demo\\AppData\\Roaming\\gcloud\\application_default_credentials.json";
		const win = resolveGoogleAdc({
			platform: "win32",
			homeDir: "C:\\Users\\demo",
			env: { APPDATA: "C:\\Users\\demo\\AppData\\Roaming" },
			fileExists: (p) => p === winAdc,
		});
		assert.deepEqual(win, { path: winAdc, source: "gcloud" });

		const posixAdc = "/home/demo/.config/gcloud/application_default_credentials.json";
		const posix = resolveGoogleAdc({
			platform: "linux",
			homeDir: "/home/demo",
			env: {},
			fileExists: (p) => p === posixAdc,
		});
		assert.deepEqual(posix, { path: posixAdc, source: "gcloud" });

		const explicit = resolveGoogleAdc({
			platform: "linux",
			homeDir: "/home/demo",
			env: { GOOGLE_APPLICATION_CREDENTIALS: "/tmp/sa.json" },
			fileExists: (p) => p === "/tmp/sa.json",
		});
		assert.deepEqual(explicit, { path: "/tmp/sa.json", source: "env" });
	});

	it("parses gcloud active_config project and falls back to ADC quota_project_id", () => {
		const gcloudProject = readGcloudDefaultProject({
			platform: "linux",
			homeDir: "/home/demo",
			env: {},
			readText: (p) => {
				if (p.endsWith("/active_config")) return "study\n";
				if (p.endsWith("/configurations/config_study")) return "[core]\naccount = user@example.com\nproject = my-study-proj\n";
				return null;
			},
		});
		assert.equal(gcloudProject, "my-study-proj");

		const quota = readAdcQuotaProject("/adc.json", () => JSON.stringify({ type: "authorized_user", quota_project_id: "quota-proj-1" }));
		assert.equal(quota, "quota-proj-1");
	});

	it("applies precedence settings > env > gcloud > adc and defaults location to global", () => {
		const files = new Map<string, string>([
			["/home/u/.config/gcloud/application_default_credentials.json", JSON.stringify({ quota_project_id: "adc-proj" })],
			["/home/u/.config/gcloud/configurations/config_default", "[core]\nproject = gcloud-proj\n"],
		]);
		const probe = {
			platform: "linux" as const,
			homeDir: "/home/u",
			fileExists: (p: string) => files.has(p),
			readText: (p: string) => files.get(p) ?? null,
		};

		const fromGcloud = resolveGoogleVertexRuntime({ enabled: true }, { ...probe, env: {} });
		assert.equal(fromGcloud.status.ready, true);
		assert.equal(fromGcloud.status.project, "gcloud-proj");
		assert.equal(fromGcloud.status.projectSource, "gcloud");
		assert.equal(fromGcloud.status.location, GOOGLE_VERTEX_DEFAULT_LOCATION);
		assert.equal(fromGcloud.status.locationSource, "default");

		const fromSettings = resolveGoogleVertexRuntime(
			{ enabled: true, project: "custom-proj", location: "us-central1" },
			{ ...probe, env: { GOOGLE_CLOUD_PROJECT: "env-proj", GOOGLE_CLOUD_LOCATION: "europe-west4" } },
		);
		assert.equal(fromSettings.status.project, "custom-proj");
		assert.equal(fromSettings.status.projectSource, "settings");
		assert.equal(fromSettings.status.location, "us-central1");
		assert.equal(fromSettings.status.locationSource, "settings");
	});
});

describe("Google Vertex AI settings, catalog, HTTP guard, and Pi engine", () => {
	it("sanitizes and validates googleVertex settings strictly", () => {
		assert.deepEqual(
			sanitizeUserSettings({ version: 1, googleVertex: { enabled: true, project: "my-proj-1", location: "us-central1" } })?.googleVertex,
			{ enabled: true, project: "my-proj-1", location: "us-central1" },
		);
		assert.deepEqual(
			sanitizeUserSettings({ version: 1, googleVertex: { enabled: "yes", project: "bad project!", location: "UPPER" } })?.googleVertex,
			{},
		);

		assert.equal(parseGoogleVertexSettingsBody({ enabled: true, project: "my-proj", location: "global" }).ok, true);
		assert.equal(parseGoogleVertexSettingsBody({ enabled: "true" }).ok, false);
		assert.equal(parseGoogleVertexSettingsBody({ project: "bad space" }).ok, false);
		assert.equal(parseGoogleVertexSettingsBody({ location: "US_CENTRAL" }).ok, false);
		assert.deepEqual(parseGoogleVertexSettingsBody({ enabled: true, project: "", location: "" }), {
			ok: true,
			settings: { enabled: true },
		});

		const refusal = providerKeyMissing(GOOGLE_VERTEX_PROVIDER, ["strong"]);
		assert.equal(isProviderKeyRefusal(refusal.error), true);
	});

	it("persists googleVertex via PUT /api/settings/googleVertex and guards GET /api/google-vertex", async () => {
		await withFakeGcloud(async () => {
			const res = await PUT(
				new Request("http://localhost:3000/api/settings/googleVertex", {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ enabled: true, project: "proj-alpha", location: "us-central1" }),
				}),
				{ params: Promise.resolve({ section: "googleVertex" }) },
			);
			assert.equal(res.status, 200);
			assert.deepEqual(readSettings()?.googleVertex, { enabled: true, project: "proj-alpha", location: "us-central1" });
			assert.equal(googleVertexAvailable(), true);
			assert.equal(googleVertexStatus().project, "proj-alpha");

			const forbidden = await googleVertexStatusResponse(new Request("http://localhost:3000/api/google-vertex"));
			assert.equal(forbidden.status, 403);

			const allowed = await googleVertexStatusResponse(
				new Request("http://localhost:3000/api/google-vertex", {
					headers: { "x-learnharness-google-vertex": "1", origin: "http://localhost:3000" },
				}),
			);
			assert.equal(allowed.status, 200);
			const body = (await allowed.json()) as { ready: boolean; project: string; location: string };
			assert.equal(body.ready, true);
			assert.equal(body.project, "proj-alpha");
			assert.equal(body.location, "us-central1");
		}, { adc: true, gcloudProject: "gcloud-default" });
	});

	it("federates google-vertex models in catalog and resolves Pi auth when enabled with ADC", async () => {
		await withFakeGcloud(async () => {
			assert.equal(providerKeyPresent(GOOGLE_VERTEX_PROVIDER), true);
			assert.equal(catalogProviders().find((p) => p.id === GOOGLE_VERTEX_PROVIDER)?.keyPresent, true);
			const vertexModels = modelCatalog().models.filter((m) => m.provider === GOOGLE_VERTEX_PROVIDER);
			assert.ok(vertexModels.some((m) => m.id === "gemini-2.5-flash"), "expected gemini-2.5-flash in Vertex catalog");
			assert.equal(validateChatSettings({ model: { provider: GOOGLE_VERTEX_PROVIDER, id: "gemini-2.5-flash" } }).ok, true);

			const engine = piEngineForSpec({ provider: GOOGLE_VERTEX_PROVIDER, id: "gemini-2.5-flash" });
			assert.equal(engine.model.provider, GOOGLE_VERTEX_PROVIDER);
			const auth = await piModels().getAuth(engine.model);
			assert.ok(auth, "expected patched google-vertex provider to resolve ADC auth");
			assert.equal(auth.env?.GOOGLE_CLOUD_PROJECT, "gcloud-default");
			assert.equal(auth.env?.GOOGLE_CLOUD_LOCATION, "global");
		}, { enabled: true, adc: true, gcloudProject: "gcloud-default" });

		await withFakeGcloud(() => {
			assert.equal(providerKeyPresent(GOOGLE_VERTEX_PROVIDER), false);
			assert.equal(catalogProviders().find((p) => p.id === GOOGLE_VERTEX_PROVIDER)?.keyPresent, false);
			assert.equal(modelCatalog().models.some((m) => m.provider === GOOGLE_VERTEX_PROVIDER), false);
		}, { enabled: false, adc: true, gcloudProject: "gcloud-default" });
	});

	it("discovers new Vertex AI Gemini models dynamically from models.dev and sorts most-recent first", async () => {
		const fakeCatalog = {
			"google-vertex": {
				models: {
					"gemini-4-neon": {
						id: "gemini-4-neon",
						name: "Gemini 4 Neon",
						reasoning: true,
						reasoning_options: [{ type: "effort", values: ["low", "medium", "high", "xhigh"] }],
						modalities: { input: ["text", "image", "pdf"], output: ["text"] },
						limit: { context: 1_048_576, output: 65_536 },
						cost: { input: 3, output: 15, cache_read: 0.15 },
						release_date: "2026-11-18",
					},
					"gemini-4-hydrogen": {
						id: "gemini-4-hydrogen",
						name: "Gemini 4 Hydrogen",
						reasoning: true,
						reasoning_options: [{ type: "effort", values: ["low", "medium", "high", "xhigh"] }],
						modalities: { input: ["text", "image"], output: ["text"] },
						limit: { context: 1_048_576, output: 65_536 },
						cost: { input: 1.5, output: 7.5, cache_read: 0.075 },
						release_date: "2026-11-12",
					},
					"gemini-4-carbon": {
						id: "gemini-4-carbon",
						name: "Gemini 4 Carbon",
						reasoning: true,
						reasoning_options: [{ type: "effort", values: ["low", "medium", "high"] }],
						modalities: { input: ["text", "image"], output: ["text"] },
						limit: { context: 1_048_576, output: 65_536 },
						cost: { input: 2, output: 10, cache_read: 0.1 },
						release_date: "2026-11-10",
					},
					"gemini-4-argon": {
						id: "gemini-4-argon",
						name: "Gemini 4 Argon",
						reasoning: true,
						modalities: { input: ["text", "image"], output: ["text"] },
						limit: { context: 1_048_576, output: 65_536 },
						cost: { input: 2, output: 10, cache_read: 0.1 },
						release_date: "2026-10-13",
					},
					"gemini-3.8-flash": {
						id: "gemini-3.8-flash",
						name: "Gemini 3.8 Flash",
						reasoning: true,
						modalities: { input: ["text", "image"], output: ["text"] },
						limit: { context: 1_048_576, output: 65_536 },
						cost: { input: 0.75, output: 3.75, cache_read: 0.075 },
						release_date: "2026-09-02",
					},
					"gemini-2.5-pro": {
						id: "gemini-2.5-pro",
						name: "Gemini 2.5 Pro",
						reasoning: true,
						modalities: { input: ["text", "image"], output: ["text"] },
						limit: { context: 1_048_576, output: 65_536 },
						cost: { input: 1.25, output: 10, cache_read: 0.125 },
						release_date: "2025-06-17",
					},
					"gemini-embedding-001": {
						id: "gemini-embedding-001",
						name: "Gemini Embedding 001",
						reasoning: false,
						modalities: { input: ["text"], output: ["text"] },
						release_date: "2025-05-20",
					},
					"gemini-2.5-pro-tts": {
						id: "gemini-2.5-pro-tts",
						name: "Gemini 2.5 Pro TTS",
						reasoning: false,
						modalities: { input: ["text"], output: ["audio"] },
						release_date: "2025-09-30",
					},
				},
			},
		};

		const parsed = parseModelsDevPayload(fakeCatalog);
		assert.ok(parsed.vertexModels.some((m) => m.id === "gemini-4-neon"));
		assert.equal(parsed.vertexModels.some((m) => m.id === "gemini-embedding-001"), false);
		assert.equal(parsed.vertexModels.some((m) => m.id === "gemini-2.5-pro-tts"), false);

		resetModelsDevCatalogCacheForTest();
		await refreshModelsDevCatalog({
			force: true,
			fetchImpl: async () => new Response(JSON.stringify(fakeCatalog), { status: 200, headers: { "content-type": "application/json" } }),
		});

		await withFakeGcloud(() => {
			const vertexModels = modelCatalog().models.filter((m) => m.provider === GOOGLE_VERTEX_PROVIDER);
			const ids = vertexModels.map((m) => m.id);
			assert.ok(ids.includes("gemini-4-neon"), "discovered gemini-4-neon must appear");
			assert.ok(ids.includes("gemini-4-hydrogen"), "discovered gemini-4-hydrogen must appear");
			assert.ok(ids.includes("gemini-4-carbon"), "discovered gemini-4-carbon must appear");
			// Most recent first by releaseDate
			assert.deepEqual(ids.slice(0, 4), ["gemini-4-neon", "gemini-4-hydrogen", "gemini-4-carbon", "gemini-4-argon"]);
			assert.ok(ids.indexOf("gemini-3.8-flash") < ids.indexOf("gemini-2.5-pro"));

			const neon = vertexModels.find((m) => m.id === "gemini-4-neon")!;
			assert.equal(neon.releaseDate, "2026-11-18");
			assert.deepEqual(neon.supportedLevels, ["low", "medium", "high"]);

			assert.equal(validateChatSettings({ model: { provider: GOOGLE_VERTEX_PROVIDER, id: "gemini-4-neon" } }).ok, true);
			const engine = piEngineForSpec({ provider: GOOGLE_VERTEX_PROVIDER, id: "gemini-4-neon", thinkingLevel: "high" });
			assert.equal(engine.model.id, "gemini-4-neon");
			assert.equal(engine.level, "high");
		}, { enabled: true, adc: true, gcloudProject: "gcloud-default" });
	});

	it("sorts models by version descending even when releaseDate is absent", () => {
		const sample = [
			{ id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
			{ id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
			{ id: "gemini-4-argon", name: "Gemini 4 Argon" },
			{ id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
		];
		assert.deepEqual(
			[...sample].sort(compareModelsByRecency).map((m) => m.id),
			["gemini-4-argon", "gemini-3.8-flash", "gemini-3.1-pro-preview", "gemini-2.5-flash"],
		);
	});
});
