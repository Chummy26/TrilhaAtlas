/**
 * Official Public AI-Tutor & Long-Term Memory Benchmark Runner (GPT via TrilhaAtlas).
 *
 * Downloads & caches (in `.cache/benchmarks/`, gitignored) the 6 official public
 * benchmark datasets and evaluates unmodified TrilhaAtlas production teacher prompts
 * with ZERO hint leakage and cross-model blind rubric judging:
 *   1. ScaleAI/TutorBench                  (HuggingFace, official weighted RUBRICS)
 *   2. eth-lre/mathtutorbench              (GitHub, datasets/mathdial_bridge.json)
 *   3. BEA 2025 Shared Task / MRBench v3   (GitHub, mrbench_v3_devset.json)
 *   4. eth-nlped/mathdial                  (HuggingFace, test.jsonl — 3-turn live student sim)
 *   5. xiaowu0162/longmemeval-cleaned      (HuggingFace ICLR 2025, longmemeval_oracle.json)
 *   6. snap-research/locomo                (GitHub, data/locomo10.json)
 *
 * Usage:
 *   node --import tsx scripts/benchmark-ai-tutor-sota.ts
 *   node --import tsx scripts/benchmark-ai-tutor-sota.ts --per-suite=10 --concurrency=5
 *   node --import tsx scripts/benchmark-ai-tutor-sota.ts --full --models=chatgpt:gpt-6.2-sol
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { normalizeContext, type Message } from "@earendil-works/pi-ai";
import {
	OFFICIAL_BENCHMARK_SUITES,
	aggregateOfficialReport,
	buildOfficialJudgePrompt,
	computeOfficialItemScore,
	parseLoCoMoItems,
	parseLongMemEvalItems,
	parseMathDialItems,
	parseMathTutorBenchItems,
	parseMrBenchV3Items,
	parseOfficialJudgeOutput,
	parseTutorBenchRows,
	renderOfficialBenchmarkMarkdown,
	renderOfficialReadmeSection,
	spliceOfficialReadmeSection,
	stratifiedSample,
	type OfficialBenchmarkItem,
	type OfficialCaseResult,
	type OfficialModelReport,
	type OfficialSuiteId,
	type OfficialTurn,
	type RawLoCoMoDialogue,
	type RawLongMemEvalItem,
	type RawMathDialItem,
	type RawMathTutorBenchItem,
	type RawMrBenchV3Item,
	type RawTutorBenchRow,
} from "../src/core/formal/official-datasets.ts";

if (!process.env.LH_DATA_DIR && process.env.APPDATA) {
	const desktopData = path.join(process.env.APPDATA, "TrilhaAtlas", "data");
	if (fs.existsSync(desktopData)) process.env.LH_DATA_DIR = desktopData;
}
if (!process.env.LH_AUTH_FILE && process.env.APPDATA) {
	const desktopAuth = path.join(process.env.APPDATA, "TrilhaAtlas", "auth.json");
	if (fs.existsSync(desktopAuth)) process.env.LH_AUTH_FILE = desktopAuth;
}

const DEFAULT_MODELS = ["chatgpt:gpt-6.2-sol", "chatgpt:gpt-6.2-astra"];
const CACHE_DIR = path.resolve(".cache", "benchmarks");

function argValue(prefix: string): string | undefined {
	const hit = process.argv.find(a => a.startsWith(prefix));
	return hit ? hit.slice(prefix.length) : undefined;
}

const noWrite = process.argv.includes("--no-write");
const runFull = process.argv.includes("--full");
const perSuite = runFull ? 0 : Math.max(1, Number(argValue("--per-suite=") ?? 8) || 8);
const thinkingLevel = (argValue("--thinking=") ?? "medium") as "off" | "minimal" | "low" | "medium" | "high";
const judgeThinkingLevel = (argValue("--judge-thinking=") ?? "low") as "off" | "minimal" | "low" | "medium" | "high";
const concurrency = Math.max(1, Math.min(8, Number(argValue("--concurrency=") ?? 2) || 2));
const resetCheckpoint = process.argv.includes("--reset");
const CHECKPOINT_FILE = path.join(CACHE_DIR, "checkpoint-official-v1.json");
const suiteFilter = argValue("--suite=") as OfficialSuiteId | undefined;
const modelSpecs = (argValue("--models=") ?? DEFAULT_MODELS.join(","))
	.split(",")
	.map(s => s.trim())
	.filter(Boolean);

function parseModelSpec(spec: string): { provider: string; id: string } {
	const idx = spec.indexOf(":");
	if (idx <= 0 || idx === spec.length - 1) throw new Error(`Invalid model spec "${spec}".`);
	return { provider: spec.slice(0, idx), id: spec.slice(idx + 1) };
}

function assertGptOnly(spec: string): void {
	const { provider, id } = parseModelSpec(spec);
	const isGpt = provider === "chatgpt" || provider === "openai" || (provider === "openrouter" && id.startsWith("openai/"));
	if (!isGpt) throw new Error(`Model "${spec}" is not a GPT/OpenAI model.`);
}

async function fetchCachedText(cacheFile: string, url: string): Promise<string> {
	const full = path.join(CACHE_DIR, cacheFile);
	if (fs.existsSync(full)) return fs.readFileSync(full, "utf8");
	fs.mkdirSync(path.dirname(full), { recursive: true });
	console.log(`Downloading official dataset -> ${cacheFile} ...`);
	try {
		const res = await fetch(url, { headers: { "User-Agent": "TrilhaAtlas-OfficialBench/1.0" } });
		if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
		const text = await res.text();
		fs.writeFileSync(full, text, "utf8");
		return text;
	} catch (err) {
		// On Windows, Node's bundled CA store can miss system/enterprise roots that
		// OS-native curl verifies cleanly against the Windows Certificate Store.
		const code = (err as { cause?: { code?: string } })?.cause?.code;
		if (code === "SELF_SIGNED_CERT_IN_CHAIN" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
			const curlBin = process.platform === "win32" ? "curl.exe" : "curl";
			execFileSync(curlBin, ["-fsSL", "-o", full, url], { stdio: "pipe" });
			return fs.readFileSync(full, "utf8");
		}
		throw err;
	}
}

async function loadTutorBenchOfficial(): Promise<OfficialBenchmarkItem[]> {
	const cacheFile = path.join(CACHE_DIR, "scaleai-tutorbench-textonly.json");
	let rows: RawTutorBenchRow[];
	if (fs.existsSync(cacheFile)) {
		rows = JSON.parse(fs.readFileSync(cacheFile, "utf8")) as RawTutorBenchRow[];
	} else {
		fs.mkdirSync(CACHE_DIR, { recursive: true });
		console.log("Downloading official ScaleAI/TutorBench text-only rows from HuggingFace...");
		rows = [];
		// Official text-only batches span offsets 300..599 and 900..1199 in ScaleAI/TutorBench.
		const offsets = runFull
			? Array.from({ length: 15 }, (_, i) => i * 100)
			: [300, 400, 900];
		for (const off of offsets) {
			const url = `https://datasets-server.huggingface.co/rows?dataset=ScaleAI/TutorBench&config=default&split=train&offset=${off}&length=100`;
			const res = await fetch(url, { headers: { "User-Agent": "TrilhaAtlas-OfficialBench/1.0" } });
			if (!res.ok) throw new Error(`TutorBench HF error at offset=${off}: HTTP ${res.status}`);
			const data = (await res.json()) as { rows?: { row: RawTutorBenchRow }[] };
			for (const entry of data.rows ?? []) {
				if (!entry.row.IMAGE_URL && !entry.row.Image) rows.push(entry.row);
			}
		}
		fs.writeFileSync(cacheFile, JSON.stringify(rows), "utf8");
	}
	return parseTutorBenchRows(rows);
}

async function loadAllOfficialDatasets(filter?: OfficialSuiteId): Promise<{
	items: OfficialBenchmarkItem[];
	splitTotals: Record<OfficialSuiteId, number>;
}> {
	const splitTotals: Record<OfficialSuiteId, number> = {
		tutorbench: 0,
		mathtutorbench: 0,
		mrbench_bea2025: 0,
		mathdial: 0,
		longmemeval: 0,
		locomo: 0,
	};
	const all: OfficialBenchmarkItem[] = [];
	const want = (id: OfficialSuiteId) => !filter || filter === id;

	if (want("tutorbench")) {
		const full = await loadTutorBenchOfficial();
		splitTotals.tutorbench = full.length;
		all.push(...stratifiedSample(full, x => x.category, perSuite));
	}
	if (want("mathtutorbench")) {
		const raw = JSON.parse(await fetchCachedText(
			"mathtutorbench-mathdial_bridge.json",
			"https://raw.githubusercontent.com/eth-lre/mathtutorbench/main/datasets/mathdial_bridge.json",
		)) as RawMathTutorBenchItem[];
		const full = parseMathTutorBenchItems(raw);
		splitTotals.mathtutorbench = full.length;
		all.push(...stratifiedSample(full, x => x.category, perSuite));
	}
	if (want("mrbench_bea2025")) {
		const raw = JSON.parse(await fetchCachedText(
			"bea2025-mrbench_v3_devset.json",
			"https://raw.githubusercontent.com/kaushal0494/UnifyingAITutorEvaluation/main/BEA_Shared_Task_2025_Datasets/mrbench_v3_devset.json",
		)) as RawMrBenchV3Item[];
		const full = parseMrBenchV3Items(raw);
		splitTotals.mrbench_bea2025 = full.length;
		all.push(...stratifiedSample(full, x => x.originalId.slice(0, 3), perSuite));
	}
	if (want("mathdial")) {
		const text = await fetchCachedText(
			"mathdial-test.jsonl",
			"https://huggingface.co/datasets/eth-nlped/mathdial/resolve/main/test.jsonl",
		);
		const raw = text.trim().split(/\r?\n/).map(line => JSON.parse(line) as RawMathDialItem);
		const full = parseMathDialItems(raw);
		splitTotals.mathdial = full.length;
		all.push(...stratifiedSample(full, x => x.category, perSuite));
	}
	if (want("longmemeval")) {
		const raw = JSON.parse(await fetchCachedText(
			"longmemeval_oracle.json",
			"https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_oracle.json",
		)) as RawLongMemEvalItem[];
		const full = parseLongMemEvalItems(raw);
		splitTotals.longmemeval = full.length;
		all.push(...stratifiedSample(full, x => x.category, perSuite));
	}
	if (want("locomo")) {
		const raw = JSON.parse(await fetchCachedText(
			"locomo10.json",
			"https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json",
		)) as RawLoCoMoDialogue[];
		const full = parseLoCoMoItems(raw);
		splitTotals.locomo = full.length;
		all.push(...stratifiedSample(full, x => x.category, perSuite));
	}

	return { items: all, splitTotals };
}

async function runWithConcurrency<T, R>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length);
	let cursor = 0;
	async function next(): Promise<void> {
		while (cursor < items.length) {
			const idx = cursor++;
			results[idx] = await worker(items[idx]!, idx);
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
	return results;
}

/** Transport-only note (no pedagogical hints, respects the learner's language natively). */
const TRANSPORT_NOTE = "Reply directly in prose (Markdown/LaTeX) in the same language the learner wrote in. No external tools are attached in this turn; do not emit JSON tool calls.";

async function main() {
	for (const spec of modelSpecs) assertGptOnly(spec);

	const { items, splitTotals } = await loadAllOfficialDatasets(suiteFilter);
	console.log(`Loaded ${items.length} official benchmark items across ${suiteFilter ?? "all 6 official datasets"} (per-suite=${runFull ? "FULL" : perSuite}).`);

	const { initAuthEnv } = await import("../src/server/keys.ts");
	const { modelCatalog, refreshConnectionCatalog } = await import("../src/server/model-catalog.ts");
	const { piEngineForSpec } = await import("../src/agent/models.ts");
	const { composeInstructions } = await import("../src/agent/teacher-agent.ts");
	await import("../src/server/index.ts");

	initAuthEnv();
	modelCatalog();

	async function ensureCatalogReady(maxAttempts = 6): Promise<void> {
		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			await refreshConnectionCatalog();
			const ready = modelSpecs.every(spec => {
				try {
					const p = parseModelSpec(spec);
					piEngineForSpec({ provider: p.provider, id: p.id, thinkingLevel: "low" }, false);
					return true;
				} catch {
					return false;
				}
			});
			if (ready) return;
			const waitMs = 4000 * (attempt + 1);
			console.log(`Waiting ${waitMs / 1000}s for provider catalog (${attempt + 1}/${maxAttempts})...`);
			await new Promise(r => setTimeout(r, waitMs));
		}
		throw new Error(`Provider catalog did not become ready for: ${modelSpecs.join(", ")}`);
	}
	await ensureCatalogReady();

	const teacherSystemPrompt = `${composeInstructions("teacher")}\n\n---\n\n${TRANSPORT_NOTE}`;

	// Incremental checkpoint store so long official runs survive transient rate-limits.
	const checkpointMap = new Map<string, OfficialCaseResult>();
	if (!resetCheckpoint && fs.existsSync(CHECKPOINT_FILE)) {
		try {
			const saved = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf8")) as Record<string, OfficialCaseResult>;
			for (const [k, v] of Object.entries(saved)) checkpointMap.set(k, v);
			console.log(`Resuming from checkpoint (${checkpointMap.size} completed items cached).`);
		} catch { /* ignore corrupt checkpoint */ }
	}
	const saveCheckpoint = () => {
		fs.mkdirSync(CACHE_DIR, { recursive: true });
		fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(Object.fromEntries(checkpointMap), null, 2), "utf8");
	};

	async function callModel(
		spec: string,
		level: "off" | "minimal" | "low" | "medium" | "high",
		systemPrompt: string,
		messages: Message[],
		retries = 6,
	): Promise<{ text: string; ms: number }> {
		const parsed = parseModelSpec(spec);
		let lastErr: unknown;
		for (let attempt = 0; attempt <= retries; attempt++) {
			const t0 = performance.now();
			try {
				let eng;
				try {
					eng = piEngineForSpec({ provider: parsed.provider, id: parsed.id, thinkingLevel: level }, false);
				} catch {
					await refreshConnectionCatalog(parsed.provider);
					eng = piEngineForSpec({ provider: parsed.provider, id: parsed.id, thinkingLevel: level }, false);
				}
				const stream = eng.streamFn(eng.model, normalizeContext({ systemPrompt, messages, tools: [] }), {});
				const final = await stream.result();
				const text = final.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text" && typeof c.text === "string")
					.map(c => c.text)
					.join("")
					.trim();
				if (!text) throw new Error(`Empty response (stopReason=${final.stopReason}, err=${final.errorMessage ?? "none"})`);
				return { text, ms: Math.round(performance.now() - t0) };
			} catch (err) {
				lastErr = err;
				if (attempt < retries) {
					const waitMs = Math.min(30_000, 3000 * (attempt + 1) + Math.floor(Math.random() * 1500));
					await new Promise(r => setTimeout(r, waitMs));
				}
			}
		}
		throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
	}

	function makeAssistantMsg(spec: string, text: string, timestamp: number): Message {
		const parsed = parseModelSpec(spec);
		return {
			role: "assistant",
			content: [{ type: "text", text }],
			api: "openai-responses",
			provider: parsed.provider,
			model: parsed.id,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "stop",
			timestamp,
		};
	}

	async function evaluateItem(
		modelSpec: string,
		judgeSpec: string,
		item: OfficialBenchmarkItem,
	): Promise<OfficialCaseResult> {
		const wire: Message[] = [];
		const transcript: OfficialTurn[] = [];
		let ts = Date.now() - 120_000;

		for (const ctx of item.contextMessages) {
			if (item.suite !== "longmemeval" && item.suite !== "locomo") transcript.push(ctx);
			wire.push(
				ctx.role === "user"
					? { role: "user", content: ctx.content, timestamp: ts++ }
					: makeAssistantMsg(modelSpec, ctx.content, ts++),
			);
		}

		let totalLatencyMs = 0;
		const tutorReplies: string[] = [];

		const runTutor = async (studentMsg: string) => {
			transcript.push({ role: "user", content: studentMsg });
			wire.push({ role: "user", content: studentMsg, timestamp: ts++ });
			const reply = await callModel(modelSpec, thinkingLevel, teacherSystemPrompt, wire);
			totalLatencyMs += reply.ms;
			tutorReplies.push(reply.text);
			transcript.push({ role: "assistant", content: reply.text });
			wire.push(makeAssistantMsg(modelSpec, reply.text, ts++));
		};

		await runTutor(item.learnerTurn);

		if (item.mathDialStudent) {
			const sim = item.mathDialStudent;
			for (let turn = 2; turn <= sim.maxTurns; turn++) {
				const dialogue = transcript.map(t => `${t.role === "assistant" ? "Teacher" : "Student"}: ${t.content}`).join("\n\n");
				const studentSys = [
					"You are simulating the student in an official MathDial tutoring evaluation.",
					`Student profile: ${sim.studentProfile}`,
					`Original problem: ${sim.question}`,
					`Your initial incorrect solution: ${sim.incorrectSolution}`,
					`Turn ${turn}/${sim.maxTurns}: Respond naturally as the student in 1–2 concise English sentences based on the teacher's latest reply. Only fix your mistake if the teacher's guidance genuinely helped you see it.`,
				].join("\n");
				const stuResp = await callModel(judgeSpec, "low", studentSys, [
					{ role: "user", content: `Dialogue so far:\n\n${dialogue}\n\nStudent's next reply:`, timestamp: Date.now() },
				]);
				await runTutor(stuResp.text.replace(/^Student\s*:\s*/i, "").trim());
			}
		}

		const judgePrompt = buildOfficialJudgePrompt(item, transcript);
		const judgeResp = await callModel(
			judgeSpec,
			judgeThinkingLevel,
			judgePrompt.system,
			[{ role: "user", content: judgePrompt.user, timestamp: Date.now() }],
		);
		const criteria = parseOfficialJudgeOutput(judgeResp.text, item);
		const scorePct = computeOfficialItemScore(criteria);

		return {
			suite: item.suite,
			originalId: item.originalId,
			category: item.category,
			modelSpec,
			judgeSpec,
			scorePct,
			turnsCount: tutorReplies.length,
			latencyMs: totalLatencyMs,
			criteria,
			tutorReplyPreview: (tutorReplies[0] ?? "").slice(0, 220).replace(/\s+/g, " "),
		};
	}

	const reports: OfficialModelReport[] = [];
	const runDate = new Date().toISOString().slice(0, 10);

	for (let mIdx = 0; mIdx < modelSpecs.length; mIdx++) {
		const modelSpec = modelSpecs[mIdx]!;
		const judgeSpec = modelSpecs.length > 1
			? modelSpecs[(mIdx + 1) % modelSpecs.length]!
			: modelSpec;

		console.log(`\n=== Official Public Benchmarks: ${modelSpec} (blind cross-judge: ${judgeSpec}, ${items.length} official items, concurrency=${concurrency}) ===`);
		const results = await runWithConcurrency(items, concurrency, async (item, idx) => {
			const ckKey = `${modelSpec}::${judgeSpec}::${thinkingLevel}::${item.suite}::${item.originalId}`;
			const cached = checkpointMap.get(ckKey);
			if (cached) {
				console.log(`  [${idx + 1}/${items.length}] ${cached.suite}:${cached.originalId} (cached): ${cached.scorePct.toFixed(1)}%`);
				return cached;
			}
			const res = await evaluateItem(modelSpec, judgeSpec, item);
			checkpointMap.set(ckKey, res);
			saveCheckpoint();
			console.log(`  [${idx + 1}/${items.length}] ${res.suite}:${res.originalId} (${res.turnsCount}t): ${res.scorePct.toFixed(1)}% (${res.latencyMs}ms)`);
			return res;
		});

		const report = aggregateOfficialReport(modelSpec, judgeSpec, results, splitTotals);
		reports.push(report);
		console.log(`>>> ${modelSpec} OFFICIAL OVERALL: ${report.overallScorePct.toFixed(1)}% | Avg Latency: ${report.avgLatencyMs}ms`);
		for (const s of report.suites) {
			if (!s.sampleSize) continue;
			console.log(`    - ${s.name}: ${s.scorePct.toFixed(1)}% (n=${s.sampleSize}/${s.totalSplitSize}, SOTA target >=${s.sotaTargetPct}%)`);
		}
	}

	if (!noWrite && !suiteFilter) {
		const mdPath = path.resolve("docs", "impl", "ai-tutor-benchmarks.md");
		const jsonPath = path.resolve("docs", "impl", "ai-tutor-benchmarks.json");
		const readmePath = path.resolve("README.md");

		fs.writeFileSync(mdPath, renderOfficialBenchmarkMarkdown(runDate, reports, perSuite), "utf8");
		fs.writeFileSync(jsonPath, JSON.stringify({
			runDate,
			officialPublicDatasets: true,
			perSuiteSample: runFull ? "FULL" : perSuite,
			thinkingLevel,
			judgeThinkingLevel,
			datasets: OFFICIAL_BENCHMARK_SUITES,
			reports,
		}, null, 2) + "\n", "utf8");

		const currentReadme = fs.readFileSync(readmePath, "utf8");
		const section = renderOfficialReadmeSection(runDate, reports, perSuite);
		fs.writeFileSync(readmePath, spliceOfficialReadmeSection(currentReadme, section), "utf8");

		console.log(`\nResultados OFICIAIS gravados em:\n  - ${mdPath}\n  - ${jsonPath}\n  - ${readmePath} (seção de benchmarks atualizada)`);
	}
}

void main().catch(err => {
	console.error("Official benchmark failed:", err);
	process.exitCode = 1;
});
