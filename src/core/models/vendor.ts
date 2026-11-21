import type { ModelCatalogEntry } from "../contracts/models.ts";

export type ModelVendorId =
	| "openai"
	| "anthropic"
	| "google"
	| "xai"
	| "deepseek"
	| "meta"
	| "mistral"
	| "qwen"
	| "zai"
	| "moonshot"
	| "nvidia"
	| "minimax"
	| "amazon"
	| "cohere"
	| "perplexity"
	| "other";

export interface ModelVendorInfo {
	id: ModelVendorId;
	label: string;
	accent: string;
	aliases: readonly string[];
	order: number;
}

export const MODEL_VENDORS: Record<ModelVendorId, ModelVendorInfo> = {
	openai: { id: "openai", label: "OpenAI", accent: "#10a37f", aliases: ["openai", "chatgpt", "gpt"], order: 0 },
	anthropic: { id: "anthropic", label: "Anthropic", accent: "#d97757", aliases: ["anthropic", "claude"], order: 1 },
	google: { id: "google", label: "Google", accent: "#4285f4", aliases: ["google", "gemini", "gemma"], order: 2 },
	xai: { id: "xai", label: "xAI", accent: "#a1a1aa", aliases: ["xai", "x-ai", "grok"], order: 3 },
	deepseek: { id: "deepseek", label: "DeepSeek", accent: "#4d6bfe", aliases: ["deepseek"], order: 4 },
	meta: { id: "meta", label: "Meta", accent: "#0668e1", aliases: ["meta", "llama"], order: 5 },
	mistral: { id: "mistral", label: "Mistral", accent: "#f97316", aliases: ["mistral", "mistralai", "mixtral", "codestral", "devstral"], order: 6 },
	qwen: { id: "qwen", label: "Qwen", accent: "#7c3aed", aliases: ["qwen", "alibaba"], order: 7 },
	zai: { id: "zai", label: "Z.ai", accent: "#14b8a6", aliases: ["z-ai", "zai", "zhipu", "glm"], order: 8 },
	moonshot: { id: "moonshot", label: "Moonshot", accent: "#38bdf8", aliases: ["moonshot", "moonshotai", "kimi"], order: 9 },
	nvidia: { id: "nvidia", label: "NVIDIA", accent: "#76b900", aliases: ["nvidia", "nemotron"], order: 10 },
	minimax: { id: "minimax", label: "MiniMax", accent: "#ec4899", aliases: ["minimax"], order: 11 },
	amazon: { id: "amazon", label: "Amazon", accent: "#f59e0b", aliases: ["amazon", "nova"], order: 12 },
	cohere: { id: "cohere", label: "Cohere", accent: "#a855f7", aliases: ["cohere", "command"], order: 13 },
	perplexity: { id: "perplexity", label: "Perplexity", accent: "#20b2aa", aliases: ["perplexity", "sonar"], order: 14 },
	other: { id: "other", label: "Other", accent: "#71717a", aliases: [], order: 99 },
};

const SLASH_VENDOR_MAP: Record<string, ModelVendorId> = {
	openai: "openai",
	anthropic: "anthropic",
	google: "google",
	"x-ai": "xai",
	xai: "xai",
	deepseek: "deepseek",
	meta: "meta",
	"meta-llama": "meta",
	mistralai: "mistral",
	mistral: "mistral",
	qwen: "qwen",
	alibaba: "qwen",
	"z-ai": "zai",
	zai: "zai",
	thudm: "zai",
	zhipu: "zai",
	moonshotai: "moonshot",
	moonshot: "moonshot",
	nvidia: "nvidia",
	minimax: "minimax",
	amazon: "amazon",
	cohere: "cohere",
	perplexity: "perplexity",
};

const PROVIDER_VENDOR_MAP: Record<string, ModelVendorId> = {
	openai: "openai",
	chatgpt: "openai",
	"openai-codex": "openai",
	"azure-openai-responses": "openai",
	anthropic: "anthropic",
	"claude-code": "anthropic",
	google: "google",
	"google-vertex": "google",
	"google-gemini-cli": "google",
	"google-antigravity": "google",
	xai: "xai",
	"xai-subscription": "xai",
	deepseek: "deepseek",
	mistral: "mistral",
	cohere: "cohere",
	perplexity: "perplexity",
	minimax: "minimax",
	"minimax-cn": "minimax",
	moonshot: "moonshot",
	kimi: "moonshot",
	"kimi-coding": "moonshot",
	zai: "zai",
};

const ID_PATTERNS: ReadonlyArray<[RegExp, ModelVendorId]> = [
	[/(^|[/._-])(gpt[-_0-9]|o[134]($|[-_])|chatgpt|codex)/i, "openai"],
	[/(^|[/._-])claude/i, "anthropic"],
	[/(^|[/._-])(gemini|gemma)/i, "google"],
	[/(^|[/._-])grok/i, "xai"],
	[/(^|[/._-])deepseek/i, "deepseek"],
	[/(^|[/._-])llama/i, "meta"],
	[/(^|[/._-])(mistral|mixtral|codestral|devstral|pixtral|ministral|magistral)/i, "mistral"],
	[/(^|[/._-])(qwen|qwq)/i, "qwen"],
	[/(^|[/._-])glm[-_0-9]/i, "zai"],
	[/(^|[/._-])kimi/i, "moonshot"],
	[/(^|[/._-])nemotron/i, "nvidia"],
	[/(^|[/._-])minimax/i, "minimax"],
	[/(^|[/._-])nova[-_]/i, "amazon"],
	[/(^|[/._-])command[-_]/i, "cohere"],
	[/(^|[/._-])sonar/i, "perplexity"],
];

/** Infer the canonical model maker (OpenAI, Anthropic, Google, etc.) from a
 *  catalog entry, normalizing OpenRouter's `vendor/model` and `~vendor/model`
 *  slugs as well as direct and aggregator providers. */
export function inferModelVendor(entry: Pick<ModelCatalogEntry, "provider" | "id" | "name">): ModelVendorInfo {
	const rawId = entry.id.trim();
	const slashIndex = rawId.indexOf("/");
	if (slashIndex > 0) {
		const org = rawId.slice(0, slashIndex).replace(/^~+/, "").toLowerCase();
		const mapped = SLASH_VENDOR_MAP[org];
		if (mapped) return MODEL_VENDORS[mapped];
	}

	const direct = PROVIDER_VENDOR_MAP[entry.provider.toLowerCase()];
	if (direct) return MODEL_VENDORS[direct];

	for (const [pattern, vendorId] of ID_PATTERNS) {
		if (pattern.test(rawId) || pattern.test(entry.name)) {
			return MODEL_VENDORS[vendorId];
		}
	}

	return MODEL_VENDORS.other;
}

const REDUNDANT_PREFIX: Partial<Record<ModelVendorId, RegExp>> = {
	openai: /^OpenAI:\s*/i,
	anthropic: /^Anthropic:\s*/i,
	google: /^Google:\s*/i,
	xai: /^xAI:\s*/i,
	deepseek: /^DeepSeek:\s*/i,
	meta: /^Meta:\s*/i,
	mistral: /^Mistral(?:\s*AI)?:\s*/i,
	qwen: /^Qwen:\s*/i,
	zai: /^(?:Z\.ai|Zhipu(?:\s*AI)?):\s*/i,
	moonshot: /^Moonshot(?:\s*AI)?:\s*/i,
	nvidia: /^NVIDIA:\s*/i,
	minimax: /^MiniMax:\s*/i,
	amazon: /^Amazon:\s*/i,
	cohere: /^Cohere:\s*/i,
	perplexity: /^Perplexity:\s*/i,
};

/** Trim redundant `"OpenAI: "` / `"Anthropic: "` prefixes when the company is
 *  already displayed in the section header or vendor badge. */
export function cleanModelDisplayName(
	entry: Pick<ModelCatalogEntry, "name" | "id">,
	vendor: ModelVendorInfo,
): string {
	const pattern = REDUNDANT_PREFIX[vendor.id];
	if (!pattern) return entry.name;
	const trimmed = entry.name.replace(pattern, "").trim();
	return trimmed.length > 0 ? trimmed : entry.name;
}

export interface VendorCount {
	vendor: ModelVendorInfo;
	count: number;
}

/** Summarize distinct model vendors in curated flagship order. */
export function summarizeModelVendors(
	models: readonly Pick<ModelCatalogEntry, "provider" | "id" | "name">[],
): VendorCount[] {
	const counts = new Map<ModelVendorId, number>();
	for (const model of models) {
		const vendor = inferModelVendor(model);
		counts.set(vendor.id, (counts.get(vendor.id) ?? 0) + 1);
	}
	return [...counts.entries()]
		.map(([id, count]) => ({ vendor: MODEL_VENDORS[id], count }))
		.sort((a, b) => a.vendor.order - b.vendor.order || b.count - a.count);
}
