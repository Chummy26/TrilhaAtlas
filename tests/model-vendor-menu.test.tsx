import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { parseHTML } from "linkedom";
import { act } from "react";
import type { Root } from "react-dom/client";
import {
	cleanModelDisplayName,
	inferModelVendor,
	summarizeModelVendors,
	type ModelCatalogEntry,
} from "../src/core/index.ts";
import { ModelMenuList } from "../components/settings/model-menu.tsx";

const model = (
	id: string,
	provider: string,
	name: string,
	extra: Partial<ModelCatalogEntry> = {},
): ModelCatalogEntry => ({
	id,
	provider,
	name,
	contextWindow: 128_000,
	maxTokens: 16_384,
	cost: { input: 2.5, output: 10, cacheRead: 0, cacheWrite: 0 },
	input: ["text"],
	reasoning: false,
	supportedLevels: [],
	...extra,
});

describe("model vendor classification", () => {
	it("maps direct providers, OpenRouter org slugs (including ~ prefixes), and aggregator models to canonical companies", () => {
		assert.equal(inferModelVendor({ provider: "chatgpt", id: "gpt-5.4", name: "GPT-5.4" }).id, "openai");
		assert.equal(inferModelVendor({ provider: "openrouter", id: "openai/gpt-5", name: "OpenAI: GPT-5" }).id, "openai");
		assert.equal(inferModelVendor({ provider: "openrouter", id: "~openai/gpt-5-mini", name: "GPT-5 Mini" }).id, "openai");
		assert.equal(inferModelVendor({ provider: "openrouter", id: "anthropic/claude-sonnet-4.5", name: "Anthropic: Claude Sonnet 4.5" }).id, "anthropic");
		assert.equal(inferModelVendor({ provider: "openrouter", id: "~anthropic/claude-opus-4.6", name: "Claude Opus 4.6" }).id, "anthropic");
		assert.equal(inferModelVendor({ provider: "openrouter", id: "google/gemini-2.5-pro", name: "Google: Gemini 2.5 Pro" }).id, "google");
		assert.equal(inferModelVendor({ provider: "google-vertex", id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" }).id, "google");
		assert.equal(inferModelVendor({ provider: "openrouter", id: "x-ai/grok-4", name: "xAI: Grok 4" }).id, "xai");
		assert.equal(inferModelVendor({ provider: "openrouter", id: "deepseek/deepseek-r1", name: "DeepSeek: R1" }).id, "deepseek");
		assert.equal(inferModelVendor({ provider: "openrouter", id: "meta-llama/llama-4-maverick", name: "Meta: Llama 4 Maverick" }).id, "meta");
		assert.equal(inferModelVendor({ provider: "openrouter", id: "mistralai/mistral-large", name: "Mistral: Large" }).id, "mistral");
		assert.equal(inferModelVendor({ provider: "openrouter", id: "qwen/qwen3-235b", name: "Qwen: Qwen3 235B" }).id, "qwen");
		assert.equal(inferModelVendor({ provider: "openrouter", id: "z-ai/glm-4.5", name: "Z.ai: GLM 4.5" }).id, "zai");
		assert.equal(inferModelVendor({ provider: "openrouter", id: "moonshotai/kimi-k2", name: "MoonshotAI: Kimi K2" }).id, "moonshot");
		assert.equal(inferModelVendor({ provider: "github-copilot", id: "claude-sonnet-4", name: "Claude Sonnet 4" }).id, "anthropic");
		assert.equal(inferModelVendor({ provider: "openrouter", id: "openrouter/free", name: "Free Router" }).id, "other");
	});

	it("cleans redundant vendor prefixes and orders vendor summaries in flagship order", () => {
		const openai = inferModelVendor({ provider: "openrouter", id: "openai/gpt-5", name: "OpenAI: GPT-5" });
		assert.equal(cleanModelDisplayName({ id: "openai/gpt-5", name: "OpenAI: GPT-5" }, openai), "GPT-5");
		const summary = summarizeModelVendors([
			{ provider: "openrouter", id: "qwen/qwen3", name: "Qwen3" },
			{ provider: "openrouter", id: "google/gemini-2.5-pro", name: "Google: Gemini 2.5 Pro" },
			{ provider: "openrouter", id: "anthropic/claude-sonnet-4.5", name: "Anthropic: Claude Sonnet 4.5" },
			{ provider: "chatgpt", id: "gpt-5.4", name: "GPT-5.4" },
		]);
		assert.deepEqual(summary.map((s) => s.vendor.id), ["openai", "anthropic", "google", "qwen"]);
	});
});

describe("ModelMenuList company grouping and search", () => {
	let root: Root | undefined;

	afterEach(async () => {
		if (root) {
			await act(async () => { root!.unmount(); });
			root = undefined;
		}
	});

	async function setupDom() {
		const dom = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
		Object.assign(dom.document, { oninput: null });
		Object.assign(globalThis, {
			window: dom.window,
			document: dom.document,
			HTMLElement: dom.HTMLElement,
			HTMLInputElement: dom.HTMLInputElement,
			HTMLButtonElement: dom.HTMLButtonElement,
			Node: dom.Node,
			Event: dom.Event,
			IS_REACT_ACT_ENVIRONMENT: true,
		});
		const proto = dom.HTMLElement.prototype as HTMLElement & { scrollTo?: () => void };
		proto.scrollIntoView = () => {};
		proto.scrollTo = () => {};
		const { createRoot } = await import("react-dom/client");
		const container = dom.document.getElementById("root")!;
		root = createRoot(container);
		return { dom, document: dom.document };
	}

	it("separates OpenRouter + direct models by company, filters by company tab, and searches by company alias", async () => {
		const { dom, document } = await setupDom();
		const models: ModelCatalogEntry[] = [
			model("google/gemini-2.5-pro", "openrouter", "Google: Gemini 2.5 Pro", { input: ["text", "image"], reasoning: true }),
			model("anthropic/claude-sonnet-4.5", "openrouter", "Anthropic: Claude Sonnet 4.5", { input: ["text", "image"] }),
			model("openai/gpt-5", "openrouter", "OpenAI: GPT-5", { input: ["text", "image"] }),
			model("gpt-5.4", "chatgpt", "GPT-5.4", { cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }),
			model("deepseek/deepseek-r1:free", "openrouter", "DeepSeek: R1 (free)", { cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, reasoning: true }),
		];
		const picked: ModelCatalogEntry[] = [];
		await act(async () => {
			root!.render(<ModelMenuList models={models} effectiveId="gpt-5.4" effectiveProvider="chatgpt" onPick={(m) => picked.push(m)} />);
		});

		// Company tabs appear in curated flagship order
		const tabs = [...document.querySelectorAll('[data-testid="model-vendor-tabs"] button')];
		assert.deepEqual(
			tabs.map((el) => el.getAttribute("data-testid")),
			["model-vendor-all", "model-vendor-openai", "model-vendor-anthropic", "model-vendor-google", "model-vendor-deepseek"],
		);

		// Grouped headers appear when unfiltered and direct/subscription models appear ahead of OpenRouter within OpenAI
		const options = () => [...document.querySelectorAll<HTMLButtonElement>('[data-testid="model-list"] button')];
		assert.equal(options().length, 5);
		assert.equal(options()[0]!.getAttribute("data-testid"), "model-option-gpt-5_4");
		assert.equal(options()[1]!.getAttribute("data-testid"), "model-option-openai_gpt-5");
		assert.ok(document.querySelector('[data-testid="model-group-openai"]'));
		assert.ok(document.querySelector('[data-testid="model-group-anthropic"]'));
		assert.ok(document.querySelector('[data-testid="model-group-google"]'));

		// Clicking Anthropic filters cleanly to Anthropic only
		await act(async () => {
			document.querySelector<HTMLButtonElement>('[data-testid="model-vendor-anthropic"]')!.click();
		});
		assert.equal(options().length, 1);
		assert.equal(options()[0]!.getAttribute("data-testid"), "model-option-anthropic_claude-sonnet-4_5");

		// Clicking All restores all companies, then searching "gemini" finds Google's Gemini immediately
		await act(async () => {
			document.querySelector<HTMLButtonElement>('[data-testid="model-vendor-all"]')!.click();
		});
		const input = document.querySelector<HTMLInputElement>('[data-testid="model-search"]')!;
		const setter = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!;
		await act(async () => {
			setter.call(input, "gemini");
			input.dispatchEvent(new dom.Event("input", { bubbles: true }));
		});
		assert.equal(options().length, 1);
		assert.equal(options()[0]!.getAttribute("data-testid"), "model-option-google_gemini-2_5-pro");

		await act(async () => {
			const enter = new dom.Event("keydown", { bubbles: true, cancelable: true });
			Object.assign(enter, { key: "Enter" });
			input.dispatchEvent(enter);
		});
		assert.equal(picked[0]?.id, "google/gemini-2.5-pro");
	});
});
