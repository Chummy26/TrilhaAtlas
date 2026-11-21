import { configureGoogleVertexRuntime } from "../agent/models.ts";
import { resolveGoogleVertexRuntime, type GoogleVertexProbeEnv } from "../agent/google-vertex-auth.ts";
import type { GoogleVertexSettings, GoogleVertexStatus } from "../core/contracts/google-vertex.ts";
import { settingsStore } from "../store/settings.ts";
import { installGoogleModelsCatalogOverlay } from "./google-vertex-catalog.ts";
import { subscriptionRequestOrigin } from "./web-subscription-http.ts";

export function googleVertexSettings(): GoogleVertexSettings | undefined {
	return settingsStore.readSettings()?.googleVertex;
}

export function googleVertexEnabled(): boolean {
	return googleVertexSettings()?.enabled === true;
}

/** Local ADC + project/location status. Never makes a network call or reads secrets. */
export function googleVertexStatus(probe?: GoogleVertexProbeEnv): GoogleVertexStatus {
	return resolveGoogleVertexRuntime(googleVertexSettings(), probe).status;
}

/** True when explicitly enabled AND local ADC + project + location are available. */
export function googleVertexAvailable(probe?: GoogleVertexProbeEnv): boolean {
	if (!googleVertexEnabled()) return false;
	return googleVertexStatus(probe).ready;
}

export function installGoogleVertexRuntime(): void {
	configureGoogleVertexRuntime(googleVertexSettings);
	installGoogleModelsCatalogOverlay();
}

/** Same-origin browser intent, matching claudeCodeInstallationResponse. */
export async function googleVertexStatusResponse(
	request: Request,
	inspect: () => GoogleVertexStatus = () => googleVertexStatus(),
): Promise<Response> {
	const origin = subscriptionRequestOrigin(request);
	const supplied = request.headers.get("origin");
	const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
	if (request.method !== "GET" || !origin
		|| request.headers.get("x-learnharness-google-vertex") !== "1"
		|| request.headers.get("sec-fetch-site") === "cross-site"
		|| (supplied !== null && supplied !== origin)) {
		return Response.json({ error: "Google Vertex checks require a same-origin TrilhaAtlas request." }, { status: 403, headers });
	}
	return Response.json(inspect(), { headers });
}
