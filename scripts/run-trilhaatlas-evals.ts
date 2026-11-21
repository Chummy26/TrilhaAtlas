/**
 * Official 6-Front Paired Evaluation Runner for TrilhaAtlas (`evals/`).
 *
 * Evaluates production composed prompts vs. minimal-contract baselines on the
 * exact same models (`chatgpt:gpt-6.2-sol`, `chatgpt:gpt-6.2-astra`), frozen
 * contexts, blind cross-model judges (hidden prompt identity, alternating A/B
 * order), and paired 95% confidence intervals across all 6 fronts:
 *   1. Tutoring & Diagnosis: TutorMoments (AllenAI, 3 separate dims), TeachArena
 *      Stage 0 (Tutoring) & Stage 1 (Judgment, individual), TrilhaAtlas own
 *      mode-specific cases (teaching/practice/exam/side-chat + PT-BR adaptation),
 *      and MathTutorBench (complementary per-skill breakdown).
 *   2. Planning & Exercises: StudentBench-inspired TrilhaAtlas adaptation
 *      (`teacher/10-planning.md` + `lesson/lesson-plan.md`).
 *   3. Grading & Feedback: `module-exam.ts` (deterministic) vs `lesson/grader.md`
 *      (LLM 0–3) over 14 specialist-labeled gold cases.
 *   4. Grounding, PDFs & Interactive Activities (`shared/15-accuracy.md`,
 *      `teacher/23-interactive-lessons.md`).
 *   5. Memory & Personalization (SEPARATE SCOREBOARD): EvalMem 3-stage diagnostic
 *      (Stage 1 Record / Stage 2 Real Retrieval / Stage 3 Tutor Use) + LongMemEval-S
 *      (+ optional `--include-locomo`).
 *   6. Learning & Retention: Empirical pre/post/7d/28d instruments documented in
 *      `evals/learning/retention-instruments.json`.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { normalizeContext, type Message } from "@earendil-works/pi-ai";
import {
	computePairedSummary,
	evaluateDeterministicModuleExamGrader,
	evaluateTeachArenaResponseChecks,
	MINIMAL_CONTRACT_PROMPTS,
	parseJudgeJsonObject,
	parseLoCoMoItems,
	parseLongMemEvalItems,
	parseMathTutorBenchItems,
	parseTeachArenaStage0,
	parseTeachArenaStage1,
	parseTutorMomentsRows,
	renderSixFrontMarkdown,
	renderSixFrontReadmeBlock,
	spliceOfficialReadmeSection,
	stratifiedSample,
	summarizeGraderPredictions,
	type EvalModelSixFrontReport,
	type GoldGradingCase,
	type GraderPrediction,
	type OfficialTurn,
	type PairedMetricSummary,
	type PromptHashRecord,
	type RawLoCoMoDialogue,
	type RawLongMemEvalItem,
	type RawMathTutorBenchItem,
	type RawTeachArenaTask,
	type RawTutorMomentRow,
	type SixFrontEvalBundle,
} from "../src/core/formal/index.ts";
import type { Grade } from "../src/core/learner/types.ts";

// ─── CLI Args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const argVal = (prefix: string) => args.find(a => a.startsWith(prefix))?.slice(prefix.length);

const modelsArg = argVal("--models=");
const modelSpecs = (modelsArg ?? "chatgpt:gpt-6.2-sol,chatgpt:gpt-6.2-astra")
	.split(",")
	.map(s => s.trim())
	.filter(Boolean);
const explicitJudge = argVal("--judge=");

const scale = Math.max(1, Number(argVal("--per-suite=") ?? "6"));
const thinkingLevel = (argVal("--thinking=") ?? "medium") as "off" | "minimal" | "low" | "medium" | "high";
const judgeThinking = (argVal("--judge-thinking=") ?? "low") as "off" | "minimal" | "low" | "medium" | "high";
const concurrency = Math.max(1, Math.min(4, Number(argVal("--concurrency=") ?? "2")));
const includeLoCoMo = args.includes("--include-locomo");
const resetCheckpoint = args.includes("--reset");
const noWrite = args.includes("--no-write");

const CACHE_DIR = path.resolve(".cache", "benchmarks");
const CHECKPOINT_FILE = path.join(CACHE_DIR, "checkpoint-evals-v2.json");

// Bind read-only to %APPDATA%\TrilhaAtlas auth when available
const defaultAppData = process.env.APPDATA
	? path.join(process.env.APPDATA, "TrilhaAtlas")
	: path.join(os.homedir(), ".trilhaatlas");
if (!process.env.LH_DATA_DIR && fs.existsSync(path.join(defaultAppData, "data"))) {
	process.env.LH_DATA_DIR = path.join(defaultAppData, "data");
}
if (!process.env.LH_AUTH_FILE && fs.existsSync(path.join(defaultAppData, "auth.json"))) {
	process.env.LH_AUTH_FILE = path.join(defaultAppData, "auth.json");
}

function assertGptOnly(spec: string): void {
	if (!/gpt/i.test(spec)) {
		throw new Error(`GPT-only evaluation policy active; refusing non-GPT model: ${spec}`);
	}
}

function parseModelSpec(spec: string): { provider: string; id: string } {
	const idx = spec.indexOf(":");
	return idx > 0
		? { provider: spec.slice(0, idx), id: spec.slice(idx + 1) }
		: { provider: "chatgpt", id: spec };
}

function sha256(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

async function fetchCachedText(filename: string, url: string): Promise<string> {
	fs.mkdirSync(CACHE_DIR, { recursive: true });
	const fp = path.join(CACHE_DIR, filename);
	if (fs.existsSync(fp) && fs.statSync(fp).size > 256) {
		return fs.readFileSync(fp, "utf8");
	}
	console.log(`Downloading official dataset: ${filename} ...`);
	let text: string;
	try {
		const res = await fetch(url, { headers: { "User-Agent": "TrilhaAtlas-Official-Eval/2.0" } });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		text = await res.text();
	} catch {
		const curlBin = process.platform === "win32" ? "curl.exe" : "curl";
		const tmpFp = `${fp}.tmp`;
		execFileSync(curlBin, ["-fsSL", "--retry", "3", "-A", "TrilhaAtlas-Official-Eval/2.0", "-o", tmpFp, url], { stdio: "pipe" });
		text = fs.readFileSync(tmpFp, "utf8");
		fs.unlinkSync(tmpFp);
	}
	fs.writeFileSync(fp, text, "utf8");
	return text;
}

async function runPool<T, R>(items: readonly T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
	const out = new Array<R>(items.length);
	let cursor = 0;
	const worker = async () => {
		while (cursor < items.length) {
			const i = cursor++;
			out[i] = await fn(items[i]!, i);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
	return out;
}

// ─── EvalMem Stage 2: Real Deterministic Retrieval & Domain Isolation ────────

async function evaluateEvalMemStage2Retrieval(cases: readonly {
	id: string;
	domain: string;
	sessions: { date: string; domain: string; turns: { role: string; content: string }[] }[];
	query: string;
	expectedRecordContains: string[];
	isAbstention?: boolean;
}[]): Promise<{ pct: number; n: number; details: { id: string; passed: boolean; note: string }[] }> {
	// Run inside an isolated temporary directory so user data is never touched.
	const prevDataDir = process.env.LH_DATA_DIR;
	const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lh-evalmem-stage2-"));
	const details: { id: string; passed: boolean; note: string }[] = [];
	try {
		const { MemoryDb } = await import("../src/store/memory/memory-db.ts");
		const { HashEmbedder } = await import("../src/server/memory/hash-embedder.ts");
		const embedder = new HashEmbedder();

		for (const c of cases) {
			const dbDir = path.join(tmpRoot, c.id);
			fs.mkdirSync(dbDir, { recursive: true });
			// Separate MemoryDb directory per domain (exactly how TrilhaAtlas isolates domains!)
			const dbs = new Map<string, ReturnType<typeof MemoryDb.open>>();
			const getDb = (dom: string) => {
				let d = dbs.get(dom);
				if (!d) {
					const domDir = path.join(dbDir, dom);
					fs.mkdirSync(domDir, { recursive: true });
					d = MemoryDb.open(domDir, { domainId: dom, embedder, settings: { autoExtract: false } });
					dbs.set(dom, d);
				}
				return d;
			};

			let turnSeq = 0;
			for (const s of c.sessions) {
				const db = getDb(s.domain);
				const sessId = `${c.id}-${s.date}-${s.domain}`;
				const baseTs = Date.parse(`${s.date}T12:00:00Z`) || Date.now();
				for (const t of s.turns) {
					const role: "user" | "assistant" = t.role === "user" ? "user" : "assistant";
					db.ingestTurn({
						sessionId: sessId,
						role,
						nodeIds: [],
						text: t.content,
						ts: baseTs + (++turnSeq) * 1000,
					});
				}
			}
			for (const d of dbs.values()) await d.flush();

			const targetDb = getDb(c.domain);
			const recalled = await targetDb.recall({
				domainId: c.domain,
				focusNodes: [],
				sessionId: `${c.id}-eval`,
				query: c.query,
				now: Date.parse("2026-11-21T12:00:00Z"),
				budgetTokens: 800,
			});
			const joined = recalled.items.map(it => it.text).join("\n").toLowerCase();

			let passed = true;
			let note = "ok";
			if (c.isAbstention) {
				passed = !joined.includes("toefl");
				note = passed ? "zero false retrieval on abstention query" : "unexpected match on abstention";
			} else if (c.id === "mem-cross-domain-isolation") {
				passed = joined.includes("fonte linear") && !joined.includes("ielts");
				note = passed ? "strict domain isolation (electronics only, zero IELTS leak)" : "domain leak or missing target";
			} else {
				const hits = c.expectedRecordContains.filter(tok => joined.includes(tok.toLowerCase()));
				passed = hits.length >= Math.max(1, Math.ceil(c.expectedRecordContains.length * 0.5));
				note = `matched ${hits.length}/${c.expectedRecordContains.length} expected tokens`;
			}
			details.push({ id: c.id, passed, note });
			for (const d of dbs.values()) d.close();
		}
	} finally {
		if (prevDataDir !== undefined) process.env.LH_DATA_DIR = prevDataDir;
		try {
			fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
		} catch { /* ignore Windows SQLite WAL handle lag on temp cleanup */ }
	}
	const passCount = details.filter(d => d.passed).length;
	return {
		pct: details.length ? Math.round((passCount / details.length) * 1000) / 10 : 0,
		n: details.length,
		details,
	};
}

// ─── Main Runner ─────────────────────────────────────────────────────────────

async function main() {
	for (const spec of modelSpecs) assertGptOnly(spec);

	// 1. Load external official datasets (cached in .cache/benchmarks/)
	const tmText = await fetchCachedText(
		"tutormoments-moments-520.jsonl",
		"https://huggingface.co/datasets/allenai/tutormoments-preview/resolve/main/moments.jsonl",
	);
	const allTutorMoments = parseTutorMomentsRows(
		tmText.trim().split(/\r?\n/).map(l => JSON.parse(l) as RawTutorMomentRow),
	);
	const tmSample = stratifiedSample(allTutorMoments, x => x.dimension, Math.max(4, scale));

	const ta0Raw = JSON.parse(await fetchCachedText(
		"teacharena-stage0.json",
		"https://huggingface.co/datasets/CinderD/TeachArena/resolve/main/tasks/stage0_situated_tutoring.json",
	)) as RawTeachArenaTask[];
	const ta0Sample = parseTeachArenaStage0(ta0Raw).slice(0, Math.max(4, Math.min(scale, 6)));

	const ta1Raw = JSON.parse(await fetchCachedText(
		"teacharena-stage1.json",
		"https://huggingface.co/datasets/CinderD/TeachArena/resolve/main/tasks/stage1_pedagogical_judgment.json",
	)) as RawTeachArenaTask[];
	const ta1Sample = parseTeachArenaStage1(ta1Raw).slice(0, Math.max(4, scale));

	const mtbRaw = JSON.parse(await fetchCachedText(
		"mathtutorbench-mathdial_bridge.json",
		"https://raw.githubusercontent.com/eth-lre/mathtutorbench/main/datasets/mathdial_bridge.json",
	)) as RawMathTutorBenchItem[];
	const mtbSample = stratifiedSample(parseMathTutorBenchItems(mtbRaw), x => x.category, Math.max(4, scale));

	const lmeRaw = JSON.parse(await fetchCachedText(
		"longmemeval_oracle.json",
		"https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_oracle.json",
	)) as RawLongMemEvalItem[];
	const lmeSample = stratifiedSample(parseLongMemEvalItems(lmeRaw), x => x.category, Math.max(6, scale));

	const locomoSample = includeLoCoMo
		? stratifiedSample(
			parseLoCoMoItems(JSON.parse(await fetchCachedText(
				"locomo10.json",
				"https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json",
			)) as RawLoCoMoDialogue[]),
			x => x.category,
			Math.max(5, scale),
		)
		: [];

	// 2. Load TrilhaAtlas own curated evals/ datasets
	const modesData = JSON.parse(fs.readFileSync(path.resolve("evals/tutoring/trilhaatlas-modes.json"), "utf8")) as {
		cases: {
			id: string;
			split: string;
			domain: string;
			mode: "teacher" | "practice" | "exam" | "side-chat";
			metricTag: string;
			dimension?: string;
			contextMessages: OfficialTurn[];
			learnerTurn: string;
			rubric: { id: string; weight: number; criterion: string }[];
		}[];
	};
	const planningData = JSON.parse(fs.readFileSync(path.resolve("evals/planning/studentbench-trilhaatlas.json"), "utf8")) as {
		cases: {
			id: string;
			split: string;
			domain: string;
			route: "teacher_planning" | "lesson_plan_template";
			learnerPrompt?: string;
			lang?: string;
			targetLang?: string;
			domainId?: string;
			context?: Record<string, unknown>;
			rubric: { id: string; weight: number; criterion: string }[];
		}[];
	};
	const gradingData = JSON.parse(fs.readFileSync(path.resolve("evals/grading/gold-rubric-cases.json"), "utf8")) as {
		cases: GoldGradingCase[];
	};
	const groundingData = JSON.parse(fs.readFileSync(path.resolve("evals/grounding-tools/sources-and-activities.json"), "utf8")) as {
		cases: {
			id: string;
			split: string;
			domain: string;
			scenario: string;
			contextMessages: OfficialTurn[];
			learnerTurn: string;
			rubric: { id: string; weight: number; criterion: string }[];
		}[];
	};
	const memoryData = JSON.parse(fs.readFileSync(path.resolve("evals/memory/evalmem-cases.json"), "utf8")) as {
		cases: {
			id: string;
			split: string;
			domain: string;
			memoryCategory: string;
			sessions: { date: string; domain: string; turns: { role: string; content: string }[] }[];
			query: string;
			expectedRecordContains: string[];
			expectedAnswerContains: string[];
			isAbstention?: boolean;
			forbiddenStaleClaim: string;
			rubric: { id: string; weight: number; criterion: string }[];
		}[];
	};

	// 3. Deterministic Front 3 (module-exam.ts) & Front 5 Stage 2 (real retrieval)
	const detGrader = evaluateDeterministicModuleExamGrader(gradingData.cases);
	const stage2Retrieval = await evaluateEvalMemStage2Retrieval(memoryData.cases);
	console.log(`Deterministic module-exam.ts grader: exact=${detGrader.summary.exactAgreementPct}%, MAE=${detGrader.summary.mae0to3}, falsePass=${detGrader.summary.falsePassRatePct}%`);
	console.log(`EvalMem Stage 2 real retrieval & domain isolation: ${stage2Retrieval.pct}% (n=${stage2Retrieval.n})`);

	// 4. Initialize ChatGPT subscription provider & capture effective prompts + SHA-256 hashes
	const { initAuthEnv } = await import("../src/server/keys.ts");
	const { modelCatalog, refreshConnectionCatalog } = await import("../src/server/model-catalog.ts");
	const { piEngineForSpec } = await import("../src/agent/models.ts");
	const { composeInstructions } = await import("../src/agent/teacher-agent.ts");
	const { composeSideChatInstructions } = await import("../src/agent/side-chat.ts");
	await import("../src/server/index.ts");

	initAuthEnv();
	modelCatalog();

	let catalogReady = false;
	for (let attempt = 0; attempt < 6; attempt++) {
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
		if (ready) {
			catalogReady = true;
			break;
		}
		const waitMs = 3000 * (attempt + 1);
		console.log(`Waiting ${waitMs / 1000}s for provider catalog (${attempt + 1}/6)...`);
		await new Promise(r => setTimeout(r, waitMs));
	}
	if (!catalogReady) {
		throw new Error(
			`Modelos indisponíveis no catálogo (${modelSpecs.join(", ")}). `
			+ "Verifique se a assinatura ChatGPT está conectada em Configurações → Conexões do TrilhaAtlas e tente novamente.",
		);
	}

	const TRANSPORT_NOTE = "Reply directly in prose (Markdown/LaTeX) in the same language the learner wrote in. No external tools are attached in this turn; do not emit JSON tool calls.";
	const prodTeacher = `${composeInstructions("teacher")}\n\n---\n\n${TRANSPORT_NOTE}`;
	const prodPractice = `${composeInstructions("practice")}\n\n---\n\n${TRANSPORT_NOTE}`;
	const prodSideChat = composeSideChatInstructions();
	const prodLessonPlanTpl = fs.readFileSync(path.resolve("src/agent/prompts/lesson/lesson-plan.md"), "utf8");
	const prodGraderTpl = fs.readFileSync(path.resolve("src/agent/prompts/lesson/grader.md"), "utf8");
	const prodExtractTpl = fs.readFileSync(path.resolve("src/agent/prompts/memory/extract.md"), "utf8");

	const promptHashes: PromptHashRecord[] = [
		{ key: "production:teacher", chars: prodTeacher.length, sha256: sha256(prodTeacher) },
		{ key: "production:practice", chars: prodPractice.length, sha256: sha256(prodPractice) },
		{ key: "production:side-chat", chars: prodSideChat.length, sha256: sha256(prodSideChat) },
		{ key: "production:lesson/lesson-plan.md", chars: prodLessonPlanTpl.length, sha256: sha256(prodLessonPlanTpl) },
		{ key: "production:lesson/grader.md", chars: prodGraderTpl.length, sha256: sha256(prodGraderTpl) },
		{ key: "production:memory/extract.md", chars: prodExtractTpl.length, sha256: sha256(prodExtractTpl) },
		{ key: "minimal_contract:teacher", chars: MINIMAL_CONTRACT_PROMPTS.teacher.length, sha256: sha256(MINIMAL_CONTRACT_PROMPTS.teacher) },
		{ key: "minimal_contract:practice", chars: MINIMAL_CONTRACT_PROMPTS.practice.length, sha256: sha256(MINIMAL_CONTRACT_PROMPTS.practice) },
		{ key: "minimal_contract:side-chat", chars: MINIMAL_CONTRACT_PROMPTS["side-chat"].length, sha256: sha256(MINIMAL_CONTRACT_PROMPTS["side-chat"]) },
		{ key: "minimal_contract:grader", chars: MINIMAL_CONTRACT_PROMPTS.grader.length, sha256: sha256(MINIMAL_CONTRACT_PROMPTS.grader) },
	];

	// Incremental checkpoint store
	const checkpoint: Record<string, unknown> = (!resetCheckpoint && fs.existsSync(CHECKPOINT_FILE))
		? JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf8")) as Record<string, unknown>
		: {};
	const saveCkpt = () => {
		fs.mkdirSync(CACHE_DIR, { recursive: true });
		fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2), "utf8");
	};
	async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
		if (Object.prototype.hasOwnProperty.call(checkpoint, key)) {
			return checkpoint[key] as T;
		}
		const val = await fn();
		checkpoint[key] = val;
		saveCkpt();
		return val;
	}

	async function callModel(
		spec: string,
		level: "off" | "minimal" | "low" | "medium" | "high",
		systemPrompt: string,
		messages: Message[],
		retries = 6,
	): Promise<{ text: string; ms: number; failed?: boolean }> {
		const parsed = parseModelSpec(spec);
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
				if (!text) throw new Error(`Empty output (${final.stopReason})`);
				return { text, ms: Math.round(performance.now() - t0) };
			} catch {
				if (attempt < retries) {
					await new Promise(r => setTimeout(r, Math.min(25_000, 3000 * (attempt + 1))));
				}
			}
		}
		return { text: "", ms: 0, failed: true };
	}

	function makeAssistantMsg(spec: string, text: string, ts: number): Message {
		const p = parseModelSpec(spec);
		return {
			role: "assistant",
			content: [{ type: "text", text }],
			api: "openai-responses",
			provider: p.provider,
			model: p.id,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "stop",
			timestamp: ts,
		};
	}

	function buildWire(spec: string, ctx: readonly OfficialTurn[], learnerTurn: string): Message[] {
		let ts = Date.now() - 60_000;
		const wire: Message[] = ctx.map(c =>
			c.role === "user"
				? { role: "user", content: c.content, timestamp: ts++ }
				: makeAssistantMsg(spec, c.content, ts++),
		);
		wire.push({ role: "user", content: learnerTurn, timestamp: ts++ });
		return wire;
	}

	/**
	 * Blind paired A/B rubric judge: hides which candidate is baseline vs production
	 * and alternates presentation order by item index to eliminate order bias.
	 */
	async function judgePairedBinaryRubric(
		judgeSpec: string,
		itemIndex: number,
		taskContext: string,
		baselineReply: string,
		productionReply: string,
		rubric: readonly { id: string; weight: number; criterion: string }[],
	): Promise<{ baselineScores: Record<string, number>; productionScores: Record<string, number>; baselineAvg: number; productionAvg: number }> {
		const flip = itemIndex % 2 === 1;
		const respA = flip ? productionReply : baselineReply;
		const respB = flip ? baselineReply : productionReply;

		const sys = [
			"You are an impartial, blind pedagogical benchmark judge.",
			"You are given TWO anonymized responses (Response A and Response B) to the SAME frozen tutoring/evaluation scenario.",
			"Score EACH criterion independently for Response A and Response B on binary `0` (not met / violated) or `1` (clearly met).",
			'Output ONLY valid JSON (no code fences, no raw LaTeX backslashes): {"A":[{"id":"<id>","score":0|1}],"B":[{"id":"<id>","score":0|1}]}',
		].join("\n");

		const rubricText = rubric.map(r => `- ${r.id} (weight=${r.weight}): ${r.criterion}`).join("\n");
		const user = [
			taskContext,
			`\n--- RESPONSE A ---\n${respA || "[EMPTY RESPONSE]"}`,
			`\n--- RESPONSE B ---\n${respB || "[EMPTY RESPONSE]"}`,
			`\n--- CRITERIA ---\n${rubricText}`,
		].join("\n");

		const out = await callModel(judgeSpec, judgeThinking, sys, [{ role: "user", content: user, timestamp: Date.now() }]);
		let parsed: { A?: { id: string; score: number }[]; B?: { id: string; score: number }[] } = {};
		try {
			parsed = parseJudgeJsonObject<typeof parsed>(out.text, `paired-${itemIndex}`);
		} catch {
			parsed = { A: [], B: [] };
		}
		const mapScores = (arr?: { id: string; score: number }[]) => {
			const m: Record<string, number> = {};
			for (const r of rubric) {
				const hit = arr?.find(x => x.id === r.id);
				m[r.id] = Number(hit?.score ?? 0) >= 1 ? 1 : 0;
			}
			return m;
		};
		const aMap = mapScores(parsed.A);
		const bMap = mapScores(parsed.B);
		const baseMap = flip ? bMap : aMap;
		const prodMap = flip ? aMap : bMap;

		const weighted = (m: Record<string, number>) => {
			const wSum = rubric.reduce((s, r) => s + r.weight, 0) || 1;
			return rubric.reduce((s, r) => s + (m[r.id] ?? 0) * r.weight, 0) / wSum;
		};
		return {
			baselineScores: baseMap,
			productionScores: prodMap,
			baselineAvg: weighted(baseMap),
			productionAvg: weighted(prodMap),
		};
	}

	const modelReports: EvalModelSixFrontReport[] = [];
	const auditLog: Record<string, unknown> = {
		generatedAt: new Date().toISOString().slice(0, 10),
		promptHashes,
		deterministicModuleExamGrader: detGrader,
		evalMemStage2Retrieval: stage2Retrieval,
		runs: {},
	};

	for (let mIdx = 0; mIdx < modelSpecs.length; mIdx++) {
		const modelSpec = modelSpecs[mIdx]!;
		const judgeSpec = explicitJudge ?? (modelSpecs.length > 1 ? modelSpecs[(mIdx + 1) % modelSpecs.length]! : modelSpec);
		console.log(`\n==================== ${modelSpec} (blind judge: ${judgeSpec}) ====================`);

		// ── FRONT 1A: TutorMoments (AllenAI official, 3 separate dimensions) ──
		console.log(`[1A] TutorMoments (n=${tmSample.length}: scaffolding + rigor, paired production vs minimal)...`);
		const tmResults = await runPool(tmSample, concurrency, async (item, i) =>
			cached(`tm|${modelSpec}|${item.id}`, async () => {
				const runCont = async (sysPrompt: string) => {
					const wire = buildWire(modelSpec, item.contextMessages, item.learnerTurn);
					const r1 = await callModel(modelSpec, thinkingLevel, sysPrompt, wire);
					// 1 simulated student reply using official AllenAI persona + 2nd tutor turn
					const stuSys = `Simulate this real math tutoring student concisely (1-2 sentences) based on the tutor's latest message.\nStudent persona:\n${item.studentPersona}`;
					const stu = await callModel(judgeSpec, "low", stuSys, [{
						role: "user",
						content: `Recent context:\n${item.learnerTurn}\n\nTutor: ${r1.text}\n\nStudent reply:`,
						timestamp: Date.now(),
					}]);
					const wire2 = [...wire, makeAssistantMsg(modelSpec, r1.text, Date.now()), { role: "user" as const, content: stu.text, timestamp: Date.now() + 1 }];
					const r2 = await callModel(modelSpec, thinkingLevel, sysPrompt, wire2);
					return {
						text: `Tutor Turn 1: ${r1.text}\nStudent: ${stu.text}\nTutor Turn 2: ${r2.text}`,
						ms: r1.ms + r2.ms,
						failed: Boolean(r1.failed || r2.failed),
					};
				};
				const [base, prod] = await Promise.all([
					runCont(MINIMAL_CONTRACT_PROMPTS.teacher),
					runCont(prodTeacher),
				]);
				const rubric = [
					{
						id: item.dimension === "scaffolding" ? "appropriate_scaffolding" : "appropriate_rigor",
						weight: 1,
						criterion: item.dimension === "scaffolding"
							? `Appropriate Scaffolding (AllenAI TutorMoments): Expert teachers flagged this moment for scaffolding (${item.goldHint}). Score 1 if the tutor introduces helpful, accessible scaffolds that support the student's current struggle without taking over.`
							: `Appropriate Rigor (AllenAI TutorMoments): Expert teachers flagged this moment for pushing rigor (${item.goldHint}). Score 1 if the tutor increases cognitive demand by asking the student to justify, explain, or advance reasoning rather than passively confirming or simplifying away the challenge.`,
					},
					{
						id: "avoids_over_scaffolding",
						weight: 1,
						criterion: "Avoids Over-Scaffolding (AllenAI TutorMoments): Score 1 ONLY if the tutor avoids giving away answers, solving steps the student could do themselves, or overloading with unnecessary hints.",
					},
				];
				const tailText = item.contextMessages.slice(-4).map(t => `${t.role.toUpperCase()}: ${t.content}`).join("\n");
				const judged = await judgePairedBinaryRubric(
					judgeSpec, i,
					`Official AllenAI TutorMoments (${item.dimension} moment)\nPrior turns:\n${tailText}\nStudent latest: ${item.learnerTurn}`,
					base.text, prod.text, rubric,
				);
				return { id: item.id, dimension: item.dimension, base, prod, judged };
			}),
		);

		const scafItems = tmResults.filter(x => x.dimension === "scaffolding");
		const rigItems = tmResults.filter(x => x.dimension === "rigor");
		const tmScaf = computePairedSummary(
			scafItems.map(x => x.judged.baselineScores.appropriate_scaffolding ?? 0),
			scafItems.map(x => x.judged.productionScores.appropriate_scaffolding ?? 0),
			scafItems.map(x => x.base.ms), scafItems.map(x => x.prod.ms),
			scafItems.filter(x => x.prod.failed).length,
		);
		const tmRig = computePairedSummary(
			rigItems.map(x => x.judged.baselineScores.appropriate_rigor ?? 0),
			rigItems.map(x => x.judged.productionScores.appropriate_rigor ?? 0),
			rigItems.map(x => x.base.ms), rigItems.map(x => x.prod.ms),
			rigItems.filter(x => x.prod.failed).length,
		);
		const tmOver = computePairedSummary(
			tmResults.map(x => x.judged.baselineScores.avoids_over_scaffolding ?? 0),
			tmResults.map(x => x.judged.productionScores.avoids_over_scaffolding ?? 0),
			tmResults.map(x => x.base.ms), tmResults.map(x => x.prod.ms),
			tmResults.filter(x => x.prod.failed).length,
		);
		console.log(`  TutorMoments: Scaf=${tmScaf.productionPct}% (Δ${tmScaf.deltaPp}pp) | Rigor=${tmRig.productionPct}% (Δ${tmRig.deltaPp}pp) | AvoidsOverScaf=${tmOver.productionPct}% (Δ${tmOver.deltaPp}pp)`);

		// ── FRONT 1B: TeachArena Stage 0 (Tutoring) + Stage 1 (Judgment) separately ──
		console.log(`[1B] TeachArena Stage 0 (n=${ta0Sample.length}) & Stage 1 (n=${ta1Sample.length})...`);
		const ta0Results = await runPool(ta0Sample, concurrency, async (item, i) =>
			cached(`ta0|${modelSpec}|${item.id}`, async () => {
				const run2 = async (sysPrompt: string) => {
					const wire = buildWire(modelSpec, [], item.initialLearnerTurn);
					const r1 = await callModel(modelSpec, thinkingLevel, sysPrompt, wire);
					const stuSys = `Simulate this TeachArena student in 1-2 sentences.\nPersona: ${item.persona}\nKnown: ${item.knownInfo}\nUnknown/gap: ${item.unknownInfo}`;
					const stu = await callModel(judgeSpec, "low", stuSys, [{
						role: "user",
						content: `Your opening: ${item.initialLearnerTurn}\nTutor: ${r1.text}\nYour next reply:`,
						timestamp: Date.now(),
					}]);
					const wire2 = [...wire, makeAssistantMsg(modelSpec, r1.text, Date.now()), { role: "user" as const, content: stu.text, timestamp: Date.now() + 1 }];
					const r2 = await callModel(modelSpec, thinkingLevel, sysPrompt, wire2);
					return { text: `Tutor 1: ${r1.text}\nStudent: ${stu.text}\nTutor 2: ${r2.text}`, ms: r1.ms + r2.ms, failed: Boolean(r1.failed || r2.failed) };
				};
				const [base, prod] = await Promise.all([run2(MINIMAL_CONTRACT_PROMPTS.teacher), run2(prodTeacher)]);
				const rubric = item.nlAssertions.slice(0, 6).map((a, k) => ({ id: `a${k + 1}`, weight: 1, criterion: a }));
				const judged = await judgePairedBinaryRubric(
					judgeSpec, i,
					`TeachArena Stage 0 Situated Tutoring (${item.id})\nStudent persona: ${item.persona}\nStudent opening: ${item.initialLearnerTurn}`,
					base.text, prod.text, rubric,
				);
				return { id: item.id, base, prod, judged };
			}),
		);
		const ta0Summary = computePairedSummary(
			ta0Results.map(x => x.judged.baselineAvg),
			ta0Results.map(x => x.judged.productionAvg),
			ta0Results.map(x => x.base.ms), ta0Results.map(x => x.prod.ms),
			ta0Results.filter(x => x.prod.failed).length,
		);

		const ta1Results = await runPool(ta1Sample, concurrency, async (item, i) =>
			cached(`ta1|${modelSpec}|${item.id}`, async () => {
				const wire = buildWire(modelSpec, [], item.taskPrompt);
				const [base, prod] = await Promise.all([
					callModel(modelSpec, thinkingLevel, MINIMAL_CONTRACT_PROMPTS.teacher, wire),
					callModel(modelSpec, thinkingLevel, prodTeacher, wire),
				]);
				const detBase = evaluateTeachArenaResponseChecks(base.text, item.responseChecks);
				const detProd = evaluateTeachArenaResponseChecks(prod.text, item.responseChecks);
				const rubric = item.nlAssertions.slice(0, 6).map((a, k) => ({ id: `nl${k + 1}`, weight: 1, criterion: a }));
				const judged = rubric.length
					? await judgePairedBinaryRubric(judgeSpec, i, `TeachArena Stage 1 Pedagogical Judgment (${item.id})\n${item.taskPrompt}`, base.text, prod.text, rubric)
					: { baselineScores: {}, productionScores: {}, baselineAvg: detBase.score01, productionAvg: detProd.score01 };
				return { id: item.id, base, prod, detBase, detProd, judged };
			}),
		);
		const ta1DetSummary = computePairedSummary(
			ta1Results.map(x => x.detBase.score01),
			ta1Results.map(x => x.detProd.score01),
			ta1Results.map(x => x.base.ms), ta1Results.map(x => x.prod.ms),
		);
		const ta1NlSummary = computePairedSummary(
			ta1Results.map(x => x.judged.baselineAvg),
			ta1Results.map(x => x.judged.productionAvg),
			ta1Results.map(x => x.base.ms), ta1Results.map(x => x.prod.ms),
		);
		console.log(`  TeachArena S0=${ta0Summary.productionPct}% (Δ${ta0Summary.deltaPp}pp) | S1 Det=${ta1DetSummary.productionPct}% | S1 NL=${ta1NlSummary.productionPct}% (Δ${ta1NlSummary.deltaPp}pp)`);

		// ── FRONT 1C: MathTutorBench (complementary, separate per-skill metrics) ──
		console.log(`[1C] MathTutorBench complementary per-skill (n=${mtbSample.length})...`);
		const mtbResults = await runPool(mtbSample, concurrency, async (item, i) =>
			cached(`mtb|${modelSpec}|${item.originalId}`, async () => {
				const wire = buildWire(modelSpec, item.contextMessages, item.learnerTurn);
				const [base, prod] = await Promise.all([
					callModel(modelSpec, thinkingLevel, MINIMAL_CONTRACT_PROMPTS.teacher, wire),
					callModel(modelSpec, thinkingLevel, prodTeacher, wire),
				]);
				const ctx = item.contextMessages.map(t => `${t.role.toUpperCase()}: ${t.content}`).join("\n");
				const judged = await judgePairedBinaryRubric(
					judgeSpec, i,
					`MathTutorBench (${item.originalId})\nReference solution (hidden from tutor): ${item.referenceAnswer ?? ""}\nDialogue:\n${ctx}\nStudent: ${item.learnerTurn}`,
					base.text, prod.text, item.rubric,
				);
				return { id: item.originalId, base, prod, judged };
			}),
		);
		const mtbSkill = (skillId: string) => computePairedSummary(
			mtbResults.map(x => x.judged.baselineScores[skillId] ?? 0),
			mtbResults.map(x => x.judged.productionScores[skillId] ?? 0),
			mtbResults.map(x => x.base.ms), mtbResults.map(x => x.prod.ms),
		);
		const mathTutorBenchBySkill = {
			subjectCorrectness: mtbSkill("subject_correctness"),
			mistakeLocation: mtbSkill("mistake_location"),
			socraticScaffolding: mtbSkill("socratic_scaffolding"),
			noSpoilerTact: mtbSkill("no_spoiler_tact"),
		};

		// ── FRONT 1D: TrilhaAtlas Modes (teacher, practice, exam, side-chat, PT-BR TutorMoments) ──
		console.log(`[1D] TrilhaAtlas Modes (n=${modesData.cases.length})...`);
		const modeResults = await runPool(modesData.cases, concurrency, async (c, i) =>
			cached(`mode|${modelSpec}|${c.id}`, async () => {
				const prodSys = c.mode === "practice" ? prodPractice : c.mode === "side-chat" ? prodSideChat : prodTeacher;
				const baseSys = c.mode === "practice" ? MINIMAL_CONTRACT_PROMPTS.practice : c.mode === "side-chat" ? MINIMAL_CONTRACT_PROMPTS["side-chat"] : MINIMAL_CONTRACT_PROMPTS.teacher;
				const wire = buildWire(modelSpec, c.contextMessages, c.learnerTurn);
				const [base, prod] = await Promise.all([
					callModel(modelSpec, thinkingLevel, baseSys, wire),
					callModel(modelSpec, thinkingLevel, prodSys, wire),
				]);
				const ctx = c.contextMessages.map(t => `${t.role.toUpperCase()}: ${t.content}`).join("\n");
				const judged = await judgePairedBinaryRubric(
					judgeSpec, i,
					`TrilhaAtlas Mode Eval (${c.mode} | ${c.domain} | ${c.id})\nContext:\n${ctx}\nLearner: ${c.learnerTurn}`,
					base.text, prod.text, c.rubric,
				);
				return { id: c.id, mode: c.mode, metricTag: c.metricTag, base, prod, judged };
			}),
		);
		const sliceMode = (pred: (x: typeof modeResults[number]) => boolean) => {
			const sub = modeResults.filter(pred);
			return computePairedSummary(
				sub.map(x => x.judged.baselineAvg),
				sub.map(x => x.judged.productionAvg),
				sub.map(x => x.base.ms), sub.map(x => x.prod.ms),
			);
		};
		const trilhaAtlasModes = {
			teachingHintLevel: sliceMode(x => x.metricTag === "appropriate_hint_level"),
			practiceNoUnrequestedClose: sliceMode(x => x.mode === "practice"),
			examZeroLeak: sliceMode(x => x.mode === "exam"),
			sideChatBoundaries: sliceMode(x => x.mode === "side-chat"),
			tutorMomentsPtBrAdaptation: sliceMode(x => x.metricTag.startsWith("internal_adaptation_ptbr")),
		};
		console.log(`  Modes: Teach=${trilhaAtlasModes.teachingHintLevel.productionPct}% | Practice=${trilhaAtlasModes.practiceNoUnrequestedClose.productionPct}% | Exam0Leak=${trilhaAtlasModes.examZeroLeak.productionPct}% (Δ${trilhaAtlasModes.examZeroLeak.deltaPp}pp) | SideChat=${trilhaAtlasModes.sideChatBoundaries.productionPct}% (Δ${trilhaAtlasModes.sideChatBoundaries.deltaPp}pp)`);

		// ── FRONT 2: Planning & Exercise Quality (StudentBench TrilhaAtlas adaptation) ──
		console.log(`[2] Planning & Exercises (n=${planningData.cases.length})...`);
		const planResults = await runPool(planningData.cases, concurrency, async (c, i) =>
			cached(`plan|${modelSpec}|${c.id}`, async () => {
				if (c.route === "teacher_planning") {
					const wire = buildWire(modelSpec, [], c.learnerPrompt ?? "");
					const [base, prod] = await Promise.all([
						callModel(modelSpec, thinkingLevel, MINIMAL_CONTRACT_PROMPTS.teacher, wire),
						callModel(modelSpec, thinkingLevel, prodTeacher, wire),
					]);
					const judged = await judgePairedBinaryRubric(judgeSpec, i, `StudentBench Planning (${c.id})\n${c.learnerPrompt}`, base.text, prod.text, c.rubric);
					return { id: c.id, route: c.route, base, prod, judged };
				}
				const filledProd = prodLessonPlanTpl
					.replace(/\{\{lang\}\}/g, c.lang ?? "pt-BR")
					.replace(/\{\{targetLang\}\}/g, c.targetLang ?? "")
					.replace(/\{\{domainId\}\}/g, c.domainId ?? c.domain)
					.replace(/\{\{context\}\}/g, JSON.stringify(c.context ?? {}, null, 2))
					.replace(/\{\{previousIssues\}\}/g, "None");
				const userJson = JSON.stringify(c.context ?? {}, null, 2);
				const [base, prod] = await Promise.all([
					callModel(modelSpec, thinkingLevel, MINIMAL_CONTRACT_PROMPTS.lessonPlan, [{ role: "user", content: userJson, timestamp: Date.now() }]),
					callModel(modelSpec, thinkingLevel, "Follow the task specification strictly and emit ONLY one valid JSON object.", [{ role: "user", content: filledProd, timestamp: Date.now() }]),
				]);
				const judged = await judgePairedBinaryRubric(
					judgeSpec, i,
					`Lesson-Plan JSON Generation (${c.id})\nNode context:\n${userJson}`,
					base.text, prod.text, c.rubric,
				);
				return { id: c.id, route: c.route, base, prod, judged };
			}),
		);
		const planConv = planResults.filter(x => x.route === "teacher_planning");
		const planJson = planResults.filter(x => x.route === "lesson_plan_template");
		const planning = {
			conversationalPlanning: computePairedSummary(planConv.map(x => x.judged.baselineAvg), planConv.map(x => x.judged.productionAvg), planConv.map(x => x.base.ms), planConv.map(x => x.prod.ms)),
			lessonPlanTemplateJson: computePairedSummary(planJson.map(x => x.judged.baselineAvg), planJson.map(x => x.judged.productionAvg), planJson.map(x => x.base.ms), planJson.map(x => x.prod.ms)),
		};

		// ── FRONT 3: Grading (lesson/grader.md production vs minimal on 14 gold cases) ──
		console.log(`[3] Grading & Feedback (n=${gradingData.cases.length} gold cases, production vs minimal)...`);
		const gradeRuns = await runPool(gradingData.cases, concurrency, async (c) =>
			cached(`grade|${modelSpec}|${c.id}`, async () => {
				const ctxObj = {
					nodeId: c.nodeId,
					prompt: c.prompt,
					reference: c.reference,
					rubric: c.rubricCriteria,
					misconceptions: c.misconceptions,
					relatedNodes: [c.nodeId],
					learnerResponse: c.learnerAnswer,
				};
				const ctxStr = JSON.stringify(ctxObj, null, 2);
				const filledProd = prodGraderTpl
					.replace(/\{\{lang\}\}/g, "pt-BR")
					.replace(/\{\{context\}\}/g, ctxStr);

				const parsePred = (raw: string): GraderPrediction => {
					try {
						const obj = parseJudgeJsonObject<{ grade?: number; misconceptionId?: string | null; newMisconception?: string | null }>(raw, c.id);
						const g = Math.max(0, Math.min(3, Math.round(Number(obj.grade ?? 0)))) as Grade;
						const mId = typeof obj.misconceptionId === "string" && obj.misconceptionId.trim() ? obj.misconceptionId.trim() : null;
						const diagOk = c.goldMisconceptionId !== null
							? (mId === c.goldMisconceptionId || (typeof obj.newMisconception === "string" && obj.newMisconception.trim().length > 10))
							: true;
						return {
							caseId: c.id,
							responseClass: c.responseClass,
							goldGrade: c.goldGrade,
							predictedGrade: g,
							goldMisconceptionId: c.goldMisconceptionId,
							predictedMisconceptionId: mId,
							diagnosisCorrect: diagOk,
						};
					} catch {
						return {
							caseId: c.id,
							responseClass: c.responseClass,
							goldGrade: c.goldGrade,
							predictedGrade: 0,
							goldMisconceptionId: c.goldMisconceptionId,
							predictedMisconceptionId: null,
							diagnosisCorrect: false,
							parseFailed: true,
						};
					}
				};

				const [base, prod] = await Promise.all([
					callModel(modelSpec, "low", MINIMAL_CONTRACT_PROMPTS.grader, [{ role: "user", content: ctxStr, timestamp: Date.now() }]),
					callModel(modelSpec, "low", "Follow the grading specification strictly and output ONLY valid JSON.", [{ role: "user", content: filledProd, timestamp: Date.now() }]),
				]);
				return { id: c.id, basePred: parsePred(base.text), prodPred: parsePred(prod.text) };
			}),
		);
		const llmGraderMinimal = summarizeGraderPredictions(`lesson/grader.md minimal (${modelSpec})`, gradeRuns.map(x => x.basePred));
		const llmGraderProduction = summarizeGraderPredictions(`lesson/grader.md production (${modelSpec})`, gradeRuns.map(x => x.prodPred));
		console.log(`  Grader LLM Prod: exact=${llmGraderProduction.exactAgreementPct}%, MAE=${llmGraderProduction.mae0to3}, falsePass=${llmGraderProduction.falsePassRatePct}%, diag=${llmGraderProduction.misconceptionDiagnosisPct}% (min MAE=${llmGraderMinimal.mae0to3})`);

		// ── FRONT 4: Grounding, PDFs & Interactive Activities ──
		console.log(`[4] Grounding, PDFs & Interactive Activities (n=${groundingData.cases.length})...`);
		const groundResults = await runPool(groundingData.cases, concurrency, async (c, i) =>
			cached(`ground|${modelSpec}|${c.id}`, async () => {
				const wire = buildWire(modelSpec, c.contextMessages, c.learnerTurn);
				const [base, prod] = await Promise.all([
					callModel(modelSpec, thinkingLevel, MINIMAL_CONTRACT_PROMPTS.teacher, wire),
					callModel(modelSpec, thinkingLevel, prodTeacher, wire),
				]);
				const ctx = c.contextMessages.map(t => `${t.role.toUpperCase()}: ${t.content}`).join("\n");
				const judged = await judgePairedBinaryRubric(
					judgeSpec, i,
					`TrilhaAtlas Grounding & Tools (${c.scenario} | ${c.id})\nContext:\n${ctx}\nLearner: ${c.learnerTurn}`,
					base.text, prod.text, c.rubric,
				);
				return { id: c.id, base, prod, judged };
			}),
		);
		const groundingAndTools = computePairedSummary(
			groundResults.map(x => x.judged.baselineAvg),
			groundResults.map(x => x.judged.productionAvg),
			groundResults.map(x => x.base.ms), groundResults.map(x => x.prod.ms),
		);

		// ── FRONT 5 (SEPARATE): Memory & Personalization (EvalMem Stages 1 & 3 + LongMemEval-S) ──
		console.log(`[5] Memory Separate Scoreboard: EvalMem Stage 1 & 3 (n=${memoryData.cases.length}) + LongMemEval-S (n=${lmeSample.length})...`);
		const memStage1Results = await runPool(memoryData.cases, concurrency, async (c, i) =>
			cached(`mem1|${modelSpec}|${c.id}`, async () => {
				let seq = 0;
				const messages = c.sessions.flatMap(s =>
					s.turns.map(t => ({
						id: `msg_${++seq}`,
						seq,
						role: t.role === "user" ? "user" : "assistant",
						at: `${s.date}T12:00:00Z`,
						nodeIds: [c.domain],
						text: t.content,
					})),
				);
				const payloadJson = JSON.stringify({
					now: "2026-11-21T12:00:00Z",
					sessionStartedAt: `${c.sessions[0]?.date ?? "2026-11-01"}T12:00:00Z`,
					focusNodes: [c.domain],
					factKinds: ["world", "experience", "learner", "preference", "misconception", "goal", "affect", "plan"],
					messages,
				}, null, 2);
				const minimalExtract = 'Extract concise learner facts from the JSON `messages` array as JSON: {"facts":[{"text":"...","quote":"...","sourceMsgIds":["msg_..."]}]}. Only include facts stated by `role: "user"`.';
				const [base, prod] = await Promise.all([
					callModel(modelSpec, "low", minimalExtract, [{ role: "user", content: payloadJson, timestamp: Date.now() }]),
					callModel(modelSpec, "low", prodExtractTpl, [{ role: "user", content: payloadJson, timestamp: Date.now() }]),
				]);
				const rubric = [{
					id: "accurate_memory_recording",
					weight: 1,
					criterion: c.isAbstention
						? "Does NOT fabricate any TOEFL score fact."
						: `Accurately records the learner's latest relevant facts (${c.expectedRecordContains.join(", ")}) and NEVER contaminates them with: ${c.forbiddenStaleClaim}`,
				}];
				const judged = await judgePairedBinaryRubric(judgeSpec, i, `EvalMem Stage 1 Recording (${c.id})\n${payloadJson}`, base.text, prod.text, rubric);
				return { id: c.id, base, prod, judged };
			}),
		);
		const evalMemStage1Record = computePairedSummary(
			memStage1Results.map(x => x.judged.baselineAvg),
			memStage1Results.map(x => x.judged.productionAvg),
			memStage1Results.map(x => x.base.ms), memStage1Results.map(x => x.prod.ms),
		);

		const memStage3Results = await runPool(memoryData.cases, concurrency, async (c, i) =>
			cached(`mem3|${modelSpec}|${c.id}`, async () => {
				const archive = `[Study memory — historical sessions]\n\n` + c.sessions
					.map(s => `--- Session (${s.date}, domain=${s.domain}) ---\n` + s.turns.map(t => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`).join("\n"))
					.join("\n\n");
				const wire = buildWire(modelSpec, [{ role: "user", content: archive }], c.query);
				const [base, prod] = await Promise.all([
					callModel(modelSpec, thinkingLevel, MINIMAL_CONTRACT_PROMPTS.teacher, wire),
					callModel(modelSpec, thinkingLevel, prodTeacher, wire),
				]);
				const judged = await judgePairedBinaryRubric(
					judgeSpec, i,
					`EvalMem Stage 3 Tutor Use (${c.memoryCategory} | ${c.id})\nQuery: ${c.query}\nForbidden stale/leaked claim: ${c.forbiddenStaleClaim}`,
					base.text, prod.text, c.rubric,
				);
				return { id: c.id, base, prod, judged };
			}),
		);
		const evalMemStage3TutorUse = computePairedSummary(
			memStage3Results.map(x => x.judged.baselineAvg),
			memStage3Results.map(x => x.judged.productionAvg),
			memStage3Results.map(x => x.base.ms), memStage3Results.map(x => x.prod.ms),
		);

		const lmeResults = await runPool(lmeSample, concurrency, async (item, i) =>
			cached(`lme|${modelSpec}|${item.originalId}`, async () => {
				const wire = buildWire(modelSpec, item.contextMessages, item.learnerTurn);
				const [base, prod] = await Promise.all([
					callModel(modelSpec, thinkingLevel, MINIMAL_CONTRACT_PROMPTS.teacher, wire),
					callModel(modelSpec, thinkingLevel, prodTeacher, wire),
				]);
				const judged = await judgePairedBinaryRubric(
					judgeSpec, i,
					`LongMemEval-S (${item.category} | ${item.originalId})\nQuestion: ${item.learnerTurn}\nOfficial Ground Truth (hidden from tutor): ${item.referenceAnswer ?? ""}`,
					base.text, prod.text, item.rubric,
				);
				return { id: item.originalId, category: item.category, base, prod, judged };
			}),
		);
		const longMemEvalS = computePairedSummary(
			lmeResults.map(x => x.judged.baselineAvg),
			lmeResults.map(x => x.judged.productionAvg),
			lmeResults.map(x => x.base.ms), lmeResults.map(x => x.prod.ms),
		);

		let locomoOptional: PairedMetricSummary | undefined;
		if (locomoSample.length) {
			const locRes = await runPool(locomoSample, concurrency, async (item, i) =>
				cached(`loc|${modelSpec}|${item.originalId}`, async () => {
					const wire = buildWire(modelSpec, item.contextMessages, item.learnerTurn);
					const [base, prod] = await Promise.all([
						callModel(modelSpec, thinkingLevel, MINIMAL_CONTRACT_PROMPTS.teacher, wire),
						callModel(modelSpec, thinkingLevel, prodTeacher, wire),
					]);
					const judged = await judgePairedBinaryRubric(
						judgeSpec, i,
						`LoCoMo (${item.category} | ${item.originalId})\nQuestion: ${item.learnerTurn}\nReference & Evidence:\n${item.referenceAnswer ?? ""}`,
						base.text, prod.text, item.rubric,
					);
					return { id: item.originalId, base, prod, judged };
				}),
			);
			locomoOptional = computePairedSummary(
				locRes.map(x => x.judged.baselineAvg),
				locRes.map(x => x.judged.productionAvg),
				locRes.map(x => x.base.ms), locRes.map(x => x.prod.ms),
			);
		}
		console.log(`  Memory: EvalMem S1=${evalMemStage1Record.productionPct}% | S2=${stage2Retrieval.pct}% | S3=${evalMemStage3TutorUse.productionPct}% (Δ${evalMemStage3TutorUse.deltaPp}pp) | LongMemEval-S=${longMemEvalS.productionPct}% (Δ${longMemEvalS.deltaPp}pp)`);

		modelReports.push({
			modelSpec,
			judgeSpec,
			tutorMoments: {
				appropriateScaffolding: tmScaf,
				appropriateRigor: tmRig,
				avoidsOverScaffolding: tmOver,
			},
			teachArenaStage0Tutoring: ta0Summary,
			teachArenaStage1Judgment: {
				deterministicChecks: ta1DetSummary,
				nlAssertions: ta1NlSummary,
			},
			mathTutorBenchBySkill,
			trilhaAtlasModes,
			planning,
			llmGraderProduction,
			llmGraderMinimal,
			groundingAndTools,
			memorySeparate: {
				evalMemStage1Record,
				evalMemStage2RetrieveDeterministicPct: stage2Retrieval.pct,
				evalMemStage2RetrieveN: stage2Retrieval.n,
				evalMemStage3TutorUse,
				longMemEvalS,
				...(locomoOptional ? { locomoOptional } : {}),
			},
		});

		(auditLog.runs as Record<string, unknown>)[modelSpec] = {
			tutorMoments: tmResults.map(x => ({ id: x.id, dim: x.dimension, base: x.judged.baselineScores, prod: x.judged.productionScores })),
			teachArenaStage0: ta0Results.map(x => ({ id: x.id, base: x.judged.baselineAvg, prod: x.judged.productionAvg })),
			teachArenaStage1: ta1Results.map(x => ({ id: x.id, detBase: x.detBase.score01, detProd: x.detProd.score01, nlBase: x.judged.baselineAvg, nlProd: x.judged.productionAvg })),
			mathTutorBench: mtbResults.map(x => ({ id: x.id, base: x.judged.baselineScores, prod: x.judged.productionScores })),
			modes: modeResults.map(x => ({ id: x.id, mode: x.mode, base: x.judged.baselineAvg, prod: x.judged.productionAvg })),
			planning: planResults.map(x => ({ id: x.id, route: x.route, base: x.judged.baselineAvg, prod: x.judged.productionAvg })),
			grading: gradeRuns,
			grounding: groundResults.map(x => ({ id: x.id, base: x.judged.baselineAvg, prod: x.judged.productionAvg })),
			memoryStage1: memStage1Results.map(x => ({ id: x.id, base: x.judged.baselineAvg, prod: x.judged.productionAvg })),
			memoryStage3: memStage3Results.map(x => ({ id: x.id, base: x.judged.baselineAvg, prod: x.judged.productionAvg })),
			longMemEvalS: lmeResults.map(x => ({ id: x.id, cat: x.category, base: x.judged.baselineAvg, prod: x.judged.productionAvg })),
		};
	}

	const bundle: SixFrontEvalBundle = {
		generatedAt: new Date().toISOString().slice(0, 10),
		promptHashes,
		deterministicModuleExamGrader: detGrader.summary,
		models: modelReports,
	};

	if (!noWrite) {
		const md = renderSixFrontMarkdown(bundle);
		const jsonPayload = JSON.stringify({ bundle, audit: auditLog }, null, 2);

		fs.mkdirSync(path.resolve("evals/reports"), { recursive: true });
		fs.writeFileSync(path.resolve("evals/reports/latest-evaluation.md"), md, "utf8");
		fs.writeFileSync(path.resolve("evals/reports/latest-evaluation.json"), jsonPayload, "utf8");

		fs.writeFileSync(path.resolve("docs/impl/ai-tutor-benchmarks.md"), md, "utf8");
		fs.writeFileSync(path.resolve("docs/impl/ai-tutor-benchmarks.json"), jsonPayload, "utf8");

		const readmePath = path.resolve("README.md");
		const readmeNow = fs.readFileSync(readmePath, "utf8");
		const updatedReadme = spliceOfficialReadmeSection(readmeNow, renderSixFrontReadmeBlock(bundle));
		fs.writeFileSync(readmePath, updatedReadme, "utf8");

		console.log("\nRelatórios auditáveis das 6 frentes gravados em:");
		console.log("  - evals/reports/latest-evaluation.md & .json");
		console.log("  - docs/impl/ai-tutor-benchmarks.md & .json");
		console.log("  - README.md (placares separados atualizados)");
	}
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
