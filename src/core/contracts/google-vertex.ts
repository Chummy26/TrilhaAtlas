export const GOOGLE_VERTEX_PROVIDER = "google-vertex";

export const GOOGLE_VERTEX_DEFAULT_LOCATION = "global";

export const GOOGLE_VERTEX_COMMON_LOCATIONS = [
	"global",
	"us-central1",
	"us-east5",
	"europe-west4",
	"southamerica-east1",
] as const;

export interface GoogleVertexSettings {
	enabled?: boolean;
	/** Optional GCP project ID override. When absent, resolves from env or local gcloud config. */
	project?: string;
	/** Optional Vertex AI location (e.g. "global", "us-central1"). Defaults to "global". */
	location?: string;
}

/** Local ADC + project/location readiness only. Never exposes tokens or filesystem paths. */
export interface GoogleVertexStatus {
	enabled: boolean;
	adcPresent: boolean;
	adcSource: "env" | "gcloud" | "none";
	project: string | null;
	projectSource: "settings" | "env" | "gcloud" | "adc" | "none";
	location: string;
	locationSource: "settings" | "env" | "default";
	ready: boolean;
}

/** Valid GCP project ID (standard lowercase slug or org-scoped domain:project). */
export function isValidGcpProjectId(value: string): boolean {
	const trimmed = value.trim();
	return trimmed.length >= 2 && trimmed.length <= 128 && /^[a-zA-Z0-9._:/-]+$/.test(trimmed);
}

/** Valid Vertex AI location slug ("global" or regional id like "us-central1"). */
export function isValidGcpLocation(value: string): boolean {
	const trimmed = value.trim();
	return trimmed.length >= 2 && trimmed.length <= 64 && /^[a-z0-9-]+$/.test(trimmed);
}
