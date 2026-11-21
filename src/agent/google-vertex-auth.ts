import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Provider } from "@earendil-works/pi-ai";
import { lazyApi } from "@earendil-works/pi-ai/api/lazy";
import {
	GOOGLE_VERTEX_DEFAULT_LOCATION,
	isValidGcpLocation,
	isValidGcpProjectId,
	type GoogleVertexSettings,
	type GoogleVertexStatus,
} from "../core/contracts/google-vertex.ts";

export interface GoogleVertexProbeEnv {
	env?: Record<string, string | undefined>;
	platform?: NodeJS.Platform;
	homeDir?: string;
	fileExists?: (filePath: string) => boolean;
	readText?: (filePath: string) => string | null;
}

export interface ResolvedGoogleAdc {
	path: string;
	source: "env" | "gcloud";
}

export interface ResolvedGoogleVertexRuntime {
	status: GoogleVertexStatus;
	adc: ResolvedGoogleAdc | null;
}

function defaultFileExists(filePath: string): boolean {
	try {
		return fs.statSync(filePath).isFile();
	} catch {
		return false;
	}
}

function defaultReadText(filePath: string): string | null {
	try {
		return fs.readFileSync(filePath, "utf8");
	} catch {
		return null;
	}
}

/** Resolve gcloud's config directory on Windows (%APPDATA%\gcloud) and POSIX (~/.config/gcloud). */
export function resolveGcloudConfigDir(
	env: Record<string, string | undefined> = process.env,
	platform: NodeJS.Platform = process.platform,
	homeDir: string = os.homedir(),
): string {
	const custom = env.CLOUDSDK_CONFIG?.trim();
	if (custom) return custom;
	if (platform === "win32") {
		const appData = env.APPDATA?.trim() || path.win32.join(homeDir, "AppData", "Roaming");
		return path.win32.join(appData, "gcloud");
	}
	return path.posix.join(homeDir, ".config", "gcloud");
}

/** Locate Application Default Credentials (explicit env var, then gcloud CLI default paths). */
export function resolveGoogleAdc({
	env = process.env,
	platform = process.platform,
	homeDir = os.homedir(),
	fileExists = defaultFileExists,
}: GoogleVertexProbeEnv = {}): ResolvedGoogleAdc | null {
	const explicit = env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
	if (explicit && fileExists(explicit)) {
		return { path: explicit, source: "env" };
	}
	const pathApi = platform === "win32" ? path.win32 : path.posix;
	const gcloudDir = resolveGcloudConfigDir(env, platform, homeDir);
	const candidates = [pathApi.join(gcloudDir, "application_default_credentials.json")];
	if (platform === "win32") {
		candidates.push(path.win32.join(homeDir, ".config", "gcloud", "application_default_credentials.json"));
	}
	for (const candidate of candidates) {
		if (fileExists(candidate)) return { path: candidate, source: "gcloud" };
	}
	return null;
}

/** Read active gcloud CLI project without spawning a subprocess or reading credentials. */
export function readGcloudDefaultProject({
	env = process.env,
	platform = process.platform,
	homeDir = os.homedir(),
	readText = defaultReadText,
}: GoogleVertexProbeEnv = {}): string | null {
	const pathApi = platform === "win32" ? path.win32 : path.posix;
	const gcloudDir = resolveGcloudConfigDir(env, platform, homeDir);
	const rawActive = readText(pathApi.join(gcloudDir, "active_config"))?.trim();
	const activeName = rawActive && /^[A-Za-z0-9_-]+$/.test(rawActive) ? rawActive : "default";
	const configText = readText(pathApi.join(gcloudDir, "configurations", `config_${activeName}`));
	if (!configText) return null;

	let inCore = false;
	for (const rawLine of configText.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#") || line.startsWith(";")) continue;
		if (line.startsWith("[") && line.endsWith("]")) {
			inCore = line.slice(1, -1).trim().toLowerCase() === "core";
			continue;
		}
		if (!inCore) continue;
		const match = /^project\s*=\s*(.+)$/.exec(line);
		if (match?.[1]) {
			const project = match[1].trim();
			if (isValidGcpProjectId(project)) return project;
		}
	}
	return null;
}

/** Extract only the non-secret quota_project_id field from an ADC JSON file, if present. */
export function readAdcQuotaProject(
	adcPath: string,
	readText: (filePath: string) => string | null = defaultReadText,
): string | null {
	const text = readText(adcPath);
	if (!text) return null;
	try {
		const parsed = JSON.parse(text) as { quota_project_id?: unknown; project_id?: unknown };
		const candidate = typeof parsed.quota_project_id === "string"
			? parsed.quota_project_id.trim()
			: typeof parsed.project_id === "string"
				? parsed.project_id.trim()
				: "";
		return candidate && isValidGcpProjectId(candidate) ? candidate : null;
	} catch {
		return null;
	}
}

/** Resolve effective Google Vertex AI ADC readiness, project, and location. */
export function resolveGoogleVertexRuntime(
	settings: GoogleVertexSettings | undefined,
	probe: GoogleVertexProbeEnv = {},
): ResolvedGoogleVertexRuntime {
	const env = probe.env ?? process.env;
	const enabled = settings?.enabled === true;
	const adc = resolveGoogleAdc({ ...probe, env });

	let project: string | null = null;
	let projectSource: GoogleVertexStatus["projectSource"] = "none";
	const settingsProject = settings?.project?.trim();
	const envProject = (env.GOOGLE_CLOUD_PROJECT ?? env.GCLOUD_PROJECT)?.trim();
	if (settingsProject && isValidGcpProjectId(settingsProject)) {
		project = settingsProject;
		projectSource = "settings";
	} else if (envProject && isValidGcpProjectId(envProject)) {
		project = envProject;
		projectSource = "env";
	} else {
		const gcloudProject = readGcloudDefaultProject({ ...probe, env });
		if (gcloudProject) {
			project = gcloudProject;
			projectSource = "gcloud";
		} else if (adc) {
			const adcProject = readAdcQuotaProject(adc.path, probe.readText);
			if (adcProject) {
				project = adcProject;
				projectSource = "adc";
			}
		}
	}

	let location = GOOGLE_VERTEX_DEFAULT_LOCATION;
	let locationSource: GoogleVertexStatus["locationSource"] = "default";
	const settingsLocation = settings?.location?.trim();
	const envLocation = env.GOOGLE_CLOUD_LOCATION?.trim();
	if (settingsLocation && isValidGcpLocation(settingsLocation)) {
		location = settingsLocation;
		locationSource = "settings";
	} else if (envLocation && isValidGcpLocation(envLocation)) {
		location = envLocation;
		locationSource = "env";
	}

	return {
		adc,
		status: {
			enabled,
			adcPresent: adc !== null,
			adcSource: adc?.source ?? "none",
			project,
			projectSource,
			location,
			locationSource,
			ready: Boolean(enabled && adc && project && location),
		},
	};
}

/**
 * Patch pi-ai's builtin google-vertex provider so:
 *  1. Standalone Next builds keep the lazy google-vertex API reachable.
 *  2. Windows gcloud ADC (%APPDATA%\gcloud\application_default_credentials.json)
 *     is detected in addition to ~/.config/gcloud (which pi-ai checks alone).
 *  3. Project/location configured in TrilhaAtlas settings or gcloud config
 *     flow into the request env without requiring an API key.
 */
export function patchGoogleVertexProvider(
	provider: Provider,
	getSettings: () => GoogleVertexSettings | undefined,
): Provider {
	const baseApiKeyAuth = provider.auth?.apiKey;
	return {
		...provider,
		...lazyApi(() => import("@earendil-works/pi-ai/api/google-vertex")),
		auth: {
			...provider.auth,
			apiKey: {
				name: baseApiKeyAuth?.name ?? "Google Cloud credentials",
				...(baseApiKeyAuth?.login ? { login: baseApiKeyAuth.login } : {}),
				resolve: async ({ ctx, credential, signal }) => {
					const env = async (name: string) => {
						signal.throwIfAborted();
						const value = await ctx.env(name);
						signal.throwIfAborted();
						return value;
					};
					const key = credential?.key ?? (await env("GOOGLE_CLOUD_API_KEY"));
					if (key) {
						return { auth: { apiKey: key }, source: credential?.key ? "stored credential" : "GOOGLE_CLOUD_API_KEY" };
					}
					const runtime = resolveGoogleVertexRuntime(getSettings(), {
						env: {
							...process.env,
							GOOGLE_APPLICATION_CREDENTIALS: credential?.env?.GOOGLE_APPLICATION_CREDENTIALS ?? (await env("GOOGLE_APPLICATION_CREDENTIALS")),
							GOOGLE_CLOUD_PROJECT: credential?.env?.GOOGLE_CLOUD_PROJECT ?? (await env("GOOGLE_CLOUD_PROJECT")),
							GCLOUD_PROJECT: credential?.env?.GCLOUD_PROJECT ?? (await env("GCLOUD_PROJECT")),
							GOOGLE_CLOUD_LOCATION: credential?.env?.GOOGLE_CLOUD_LOCATION ?? (await env("GOOGLE_CLOUD_LOCATION")),
						},
					});
					if (runtime.adc && runtime.status.project && runtime.status.location) {
						return {
							auth: {},
							env: {
								...(credential?.env ?? {}),
								GOOGLE_CLOUD_PROJECT: runtime.status.project,
								GOOGLE_CLOUD_LOCATION: runtime.status.location,
								...(runtime.adc.source === "env" ? { GOOGLE_APPLICATION_CREDENTIALS: runtime.adc.path } : {}),
							},
							source: credential ? "stored credential" : "gcloud application default credentials",
						};
					}
					return undefined;
				},
			},
		},
	};
}
