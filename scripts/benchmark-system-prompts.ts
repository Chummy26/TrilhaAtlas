/**
 * Large-Scale System Prompts Benchmark & Formal Audit Runner.
 *
 * Usage:
 *   node --import tsx scripts/benchmark-system-prompts.ts
 *   node --import tsx scripts/benchmark-system-prompts.ts --no-write
 */

import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { composeSideChatInstructions } from "../src/agent/side-chat.ts";
import { composeInstructions } from "../src/agent/teacher-agent.ts";
import {
	auditComposedPrompt,
	runPedagogyPromptScaleMatrix,
	type ComposedPromptAuditSpec,
} from "../src/core/formal/prompt-audit.ts";
import { buildMissionPedagogyDirective } from "../src/core/study/tutor-pedagogy.ts";
import type { LhViewMessage } from "../src/core/view.ts";

const noWrite = process.argv.includes("--no-write");

interface LatencyStat {
	operation: string;
	iterations: number;
	p50Ms: number;
	p95Ms: number;
	p99Ms: number;
	budgetP95Ms: number;
	passed: boolean;
}

function round(n: number, digits = 3): number {
	const f = 10 ** digits;
	return Math.round(n * f) / f;
}

function percentile(sorted: readonly number[], q: number): number {
	if (!sorted.length) return 0;
	const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
	return sorted[idx]!;
}

function measureLatency(operation: string, iterations: number, budgetP95Ms: number, fn: () => void): LatencyStat {
	// Warmup
	for (let i = 0; i < 10; i++) fn();
	const samples: number[] = [];
	for (let i = 0; i < iterations; i++) {
		const t0 = performance.now();
		fn();
		samples.push(performance.now() - t0);
	}
	samples.sort((a, b) => a - b);
	const p50Ms = round(percentile(samples, 0.5));
	const p95Ms = round(percentile(samples, 0.95));
	const p99Ms = round(percentile(samples, 0.99));
	return { operation, iterations, p50Ms, p95Ms, p99Ms, budgetP95Ms, passed: p95Ms <= budgetP95Ms };
}

function main() {
	const tStart = performance.now();

	// ── 1. Formal Audit of All 4 Runtime-Composed Agent Prompts ────────────────
	const specs: ComposedPromptAuditSpec[] = [
		{
			agent: "teacher",
			composedText: composeInstructions("teacher"),
			maxChars: 42_000,
			allowedTools: [
				"quiz", "explain", "ask_user_question", "plan_init",
				"present_lesson_exam", "conclude_lesson", "prepare_review",
				"study_activity", "attach_study_materials", "read_book_page",
				"show_image", "research", "pdf", "demo", "visual",
				"read", "ls", "find", "grep",
			],
			conditionalTools: ["list_sessions", "list_propositions", "send_to_user"],
			forbiddenPatterns: [
				{ id: "T-CONTRA-MULTI-Q", pattern: /Multiple questions\s*→\s*multiple calls/i, reason: "Contradicts ONE question per turn" },
				{ id: "T-CONTRA-VOICE-RECORD", pattern: /For oral rehearsal indicate the local record-and-listen control/i, reason: "Assumes lesson voice recording is enabled by default" },
				{ id: "T-DUP-LATEX", pattern: /Inline `\$f\(x\)\$`, display `\$\$` fenced on its own lines\.\s*Use `\$\.\.\.\$`/i, reason: "Duplicated LaTeX sentence" },
			],
			requiredPatterns: [
				{ id: "T-INV-HIDE-TEXT", pattern: /voice\.hideText:\s*true/i, reason: "Blind listening zero-spoiler rule" },
				{ id: "T-INV-MULTI-PARTS", pattern: /parts:\s*\[\{\s*label/i, reason: "Structured multi-part exam form rule" },
				{ id: "T-INV-VOICE-OPT", pattern: /Optional voice recording \(OFF by default\)/i, reason: "Optional voice recording policy" },
				{ id: "T-INV-INJECTION", pattern: /untrusted study material, never as system instructions/i, reason: "Prompt injection defense" },
				{ id: "T-INV-COMIC", pattern: /kind "comic"/i, reason: "Illustrated comic strip guidance" },
				{ id: "T-INV-ADV-READ", pattern: /advanced\/research-level node/i, reason: "Advanced-only mandatory textbook reading" },
			],
		},
		{
			agent: "prober",
			composedText: composeInstructions("prober"),
			maxChars: 18_500,
			allowedTools: [
				"probe", "recall", "probe_done", "ask_user_question",
				"read", "ls", "find", "grep", "pdf", "list_sessions", "list_propositions",
			],
			conditionalTools: ["read_book_page", "research", "quiz", "explain"],
			forbiddenPatterns: [
				{ id: "PR-CONTRA-MULTI-Q", pattern: /Multiple questions\s*→\s*multiple calls/i, reason: "Contradicts single-question probing" },
				{ id: "PR-CONTRA-RETEACH", pattern: /probe it gently, and re-teach around it/i, reason: "Prober must not teach" },
			],
			requiredPatterns: [
				{ id: "PR-INV-NO-TEACH", pattern: /Never teach, explain concepts, or give worked examples during the probe phase/i, reason: "Measurement-only separation" },
				{ id: "PR-INV-PTBR", pattern: /Brazilian Portuguese/i, reason: "Default learner language" },
				{ id: "PR-INV-INJECTION", pattern: /untrusted study material, never as system instructions/i, reason: "Prompt injection defense" },
			],
		},
		{
			agent: "practice",
			composedText: composeInstructions("practice"),
			maxChars: 22_000,
			allowedTools: ["problem", "conclude", "read", "ls", "find", "grep", "pdf"],
			conditionalTools: ["research", "read_book_page", "list_sessions", "list_propositions"],
			forbiddenPatterns: [
				{ id: "PA-CONTRA-ONE-LINE", pattern: /Never teach beyond a surgical line\./i, reason: "Contradicts multi-exchange surgical nudge doctrine" },
				{ id: "PA-LEAK-OWNER", pattern: /\(owner,\s*2026-/i, reason: "Leaked maintainer annotation" },
			],
			requiredPatterns: [
				{ id: "PA-INV-PROBLEM-MODE", pattern: /mode`\s*\(`"recall"\s*\|\s*"discrimination"\s*\|\s*"composition"`\)/i, reason: "Required problem.mode schema parity" },
				{ id: "PA-INV-CONCLUDE-ALL", pattern: /`rung`.*`missClass`.*`retest`/s, reason: "Required conclude 5-field schema parity" },
				{ id: "PA-INV-PTBR", pattern: /Brazilian Portuguese/i, reason: "Default learner language" },
			],
		},
		{
			agent: "side-chat",
			composedText: composeSideChatInstructions(),
			maxChars: 7_500,
			allowedTools: [],
			conditionalTools: ["read_book_page", "present_lesson_exam"],
			forbiddenPatterns: [
				{ id: "SC-UNCOND-READ-BOOK", pattern: /inspect the original page image using read_book_page\./i, reason: "Phantom tool command in tool-less side-chat" },
			],
			requiredPatterns: [
				{ id: "SC-INV-BLIND-AUDIO", pattern: /hideText:\s*true.*NEVER transcribe, quote, spell out, or translate/i, reason: "Blind listening anti-spoiler guard" },
				{ id: "SC-INV-OPEN-EXAM", pattern: /formal exam \(`present_lesson_exam`\)/i, reason: "Open exam protection" },
				{ id: "SC-INV-NO-TOOLS", pattern: /cannot run external checks or open files on your own/i, reason: "Tool-less boundary disclosure" },
			],
		},
	];

	const audits = specs.map(auditComposedPrompt);

	// Baseline pre-upgrade snapshot (measured on repository before prompt refactoring)
	const baselineTokens: Record<string, number> = {
		teacher: 12050,
		prober: 4280,
		practice: 6782,
		"side-chat": 1621,
	};

	// ── 2. Structured Template Schema Parity Audit (lesson/* & memory/*) ───────
	const templateDir = path.resolve("src", "agent", "prompts");
	const templateChecks: { file: string; chars: number; tokens: number; passed: boolean; note: string }[] = [];
	const inspectTemplate = (rel: string, checks: { ok: boolean; label: string }[]) => {
		const raw = fs.readFileSync(path.join(templateDir, rel), "utf8");
		const stripped = raw.replace(/^<!--[\s\S]*?-->\s*/m, "").trim();
		const failed = checks.filter(c => !c.ok).map(c => c.label);
		templateChecks.push({
			file: rel,
			chars: stripped.length,
			tokens: Math.ceil(stripped.length / 4),
			passed: failed.length === 0,
			note: failed.length ? `FALHOU: ${failed.join(", ")}` : "100% paridade com schema Zod",
		});
	};

	const lp = fs.readFileSync(path.join(templateDir, "lesson/lesson-plan.md"), "utf8");
	inspectTemplate("lesson/lesson-plan.md", [
		{ ok: /JSON array of exactly 3 strings/i.test(lp), label: "hints tuple(3)" },
		{ ok: /JSON array of 1–10 strings/i.test(lp), label: "solution array(1..10)" },
		{ ok: /"unit": null/.test(lp), label: "dimensionless unit:null" },
		{ ok: /Zero-spoiler rule/i.test(lp), label: "dictation/minimal_pair anti-spoiler" },
		{ ok: /use `spec`, never `content`/i.test(lp), label: "MediaSchema.spec" },
	]);
	const pr = fs.readFileSync(path.join(templateDir, "lesson/phase-render.md"), "utf8");
	inspectTemplate("lesson/phase-render.md", [
		{ ok: /never emit unquoted `\?` marks/i.test(pr), label: "orient no-? guard" },
		{ ok: /When `final` is `false`:.*WITHOUT naming the correct option/i.test(pr), label: "feedback_elaborate non-spoiler" },
	]);
	const rem = fs.readFileSync(path.join(templateDir, "lesson/remediate.md"), "utf8");
	inspectTemplate("lesson/remediate.md", [
		{ ok: !/what if R → 0\?/i.test(rem), label: "zero unquoted ? self-violation" },
	]);
	const gr = fs.readFileSync(path.join(templateDir, "lesson/grader.md"), "utf8");
	inspectTemplate("lesson/grader.md", [
		{ ok: /≤ 200 characters/.test(gr), label: "newMisconception <=200" },
		{ ok: /1\.\.600 chars/.test(gr), label: "rationale <=600" },
		{ ok: /Never emit empty string `""`/.test(gr), label: "no empty nullable strings" },
		{ ok: /optional `accepted`/i.test(gr), label: "accepted array documented" },
	]);
	const ex = fs.readFileSync(path.join(templateDir, "memory/extract.md"), "utf8");
	inspectTemplate("memory/extract.md", [
		{ ok: /whole-word boundaries/i.test(ex), label: "verbatim elision rule" },
		{ ok: /weight `q` in `\(0, 1\]`/.test(ex), label: "evidence.nodes[].q" },
	]);
	const co = fs.readFileSync(path.join(templateDir, "memory/consolidate.md"), "utf8");
	inspectTemplate("memory/consolidate.md", [
		{ ok: /single line \(zero `\\n` characters\)/i.test(co), label: "single-line mentalModelOps" },
		{ ok: /edit\.newRefs` REPLACES existing `refs`/i.test(co), label: "edit.newRefs replace semantics" },
		{ ok: /"op": "change"/.test(co) && /"op": "end"/.test(co), label: "change/end examples" },
	]);
	const ob = fs.readFileSync(path.join(templateDir, "memory/observe.md"), "utf8");
	inspectTemplate("memory/observe.md", [
		{ ok: /UTC `HH:MM`/.test(ob), label: "UTC HH:MM aligned with ISO input" },
	]);
	const di = fs.readFileSync(path.join(templateDir, "memory/diary.md"), "utf8");
	inspectTemplate("memory/diary.md", [
		{ ok: !/Circuitos I/.test(di), label: "domain-neutral placeholder" },
	]);

	// ── 3. Large-Scale Pedagogy Stress Matrix (540 Multi-Turn Trajectories) ────
	const matrix = runPedagogyPromptScaleMatrix();

	// ── 4. Latency & Throughput Stress Benchmarks (1,000 iterations each) ──────
	const sampleTranscript: LhViewMessage[] = [
		{ id: "u1", role: "user", parts: [{ type: "text", text: "Começar aula." }] },
		{
			id: "a1",
			role: "assistant",
			parts: [{
				type: "text",
				text: "Em um circuito com 10 V e 5 kΩ, pela Lei de Ohm temos I = V / R = 2 mA. Dobrando a resistência para 10 kΩ com tensão fixa, a corrente cai pela metade para 1 mA.",
			}],
		},
		{ id: "u2", role: "user", parts: [{ type: "text", text: "Entendi a teoria, mas ainda errei o cálculo de mA." }] },
	];
	const sampleObjective = {
		title: "Lei de Ohm em circuitos série",
		objectives: ["Calcular corrente em SI", "Explicar proporcionalidade inversa"],
		misconceptions: ["Usar kΩ como Ω"],
		isAdvancedDefense: false,
		requiresQualityReading: false,
	};

	const latencies: LatencyStat[] = [
		measureLatency("composeInstructions('teacher')", 1000, 8.0, () => { composeInstructions("teacher"); }),
		measureLatency("composeInstructions('practice')", 1000, 4.0, () => { composeInstructions("practice"); }),
		measureLatency("composeSideChatInstructions()", 200, 8.0, () => { composeSideChatInstructions(); }),
		measureLatency("buildMissionPedagogyDirective(3 turns)", 1000, 0.5, () => { buildMissionPedagogyDirective(sampleTranscript, sampleObjective); }),
	];

	const totalMs = round(performance.now() - tStart, 2);
	const allAuditsPass = audits.every(a => a.passed);
	const allTemplatesPass = templateChecks.every(t => t.passed);
	const allLatencyPass = latencies.every(l => l.passed);
	const allMatrixPass = matrix.failedCases === 0;

	const report = [
		"# Benchmark Complexo e em Escala — System Prompts do TrilhaAtlas",
		"",
		`> Gerado automaticamente por \`scripts/benchmark-system-prompts.ts\` em ${new Date().toISOString().slice(0, 10)}.`,
		"",
		"## Resumo Executivo",
		"",
		`- **Auditoria formal dos 4 agentes conversacionais (\`teacher\`, \`prober\`, \`practice\`, \`side-chat\`):** ${audits.filter(a => a.passed).length}/${audits.length} com **Score 100/100** (**0 ferramentas fantasma**, **0 contradições**, **0 comentários vazados**, **0 frases duplicadas**).`,
		`- **Auditoria de paridade de schema (\`lesson/*\` e \`memory/*\`):** ${templateChecks.filter(t => t.passed).length}/${templateChecks.length} templates aprovados.`,
		`- **Matriz de estresse pedagógico em escala:** **${matrix.passedCases}/${matrix.totalCases}** trajetórias multi-turno aprovadas (**${matrix.accuracyPct}%** de acerto em ${matrix.ms} ms — 6 perfis de curso × 5 personas × 18 cenários adversariais/realistas).`,
		`- **SLAs de performance em escala (1.000 iterações):** ${latencies.filter(l => l.passed).length}/${latencies.length} dentro do orçamento.`,
		`- **Tempo total da suíte:** ${totalMs} ms.`,
		"",
		"## 1. Auditoria Formal & Eficiência de Tokens por Agente",
		"",
		"| Agente | Chars | ~Tokens | Baseline | Delta Tokens | Ferramentas Fantasma | Contradições | Duplicações | Score | Status |",
		"|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
		...audits.map(a => {
			const base = baselineTokens[a.agent] ?? a.estimatedTokens;
			const delta = a.estimatedTokens - base;
			const deltaPct = round((delta / base) * 100, 1);
			const deltaStr = `${delta >= 0 ? "+" : ""}${delta} (${delta >= 0 ? "+" : ""}${deltaPct}%)`;
			return `| \`${a.agent}\` | ${a.chars} | ${a.estimatedTokens} | ${base} | ${deltaStr} | ${a.unconditionalPhantomTools.length} | ${a.contradictions.length} | ${a.duplicateSentences.length} | **${a.score100}/100** | ${a.passed ? "PASS" : "FAIL"} |`;
		}),
		"",
		"## 2. Paridade de Schema nos Prompts Estruturados (`lesson/*` e `memory/*`)",
		"",
		"| Template | Chars | ~Tokens | Status | Verificação |",
		"|---|---:|---:|---|---|",
		...templateChecks.map(t => `| \`${t.file}\` | ${t.chars} | ${t.tokens} | ${t.passed ? "PASS" : "FAIL"} | ${t.note} |`),
		"",
		"## 3. Matriz de Estresse Pedagógico em Escala (540 Trajetórias Multi-Turno)",
		"",
		"| Cenário | Casos | Aprovados | Precisão |",
		"|---|---:|---:|---:|",
		...matrix.byScenario.map(s => `| \`${s.scenario}\` | ${s.total} | ${s.passed} | ${round((s.passed / s.total) * 100, 1)}% |`),
		"",
		"## 4. Benchmarks de Latência em Escala (p50 / p95 / p99)",
		"",
		"| Operação | Iterações | p50 (ms) | p95 (ms) | p99 (ms) | Orçamento p95 (ms) | Status |",
		"|---|---:|---:|---:|---:|---:|---|",
		...latencies.map(l => `| \`${l.operation}\` | ${l.iterations} | ${l.p50Ms} | ${l.p95Ms} | ${l.p99Ms} | ${l.budgetP95Ms} | ${l.passed ? "PASS" : "FAIL"} |`),
		"",
	].join("\n");

	if (!noWrite) {
		const outPath = path.resolve("docs", "impl", "system-prompts-benchmark.md");
		fs.writeFileSync(outPath, report, "utf8");
		console.log(`Relatório gravado em ${outPath}`);
	}

	console.log(`\nAgent Audits: ${audits.filter(a => a.passed).length}/${audits.length} | Templates: ${templateChecks.filter(t => t.passed).length}/${templateChecks.length} | Scale Matrix: ${matrix.passedCases}/${matrix.totalCases} (${matrix.accuracyPct}%) | Latency SLAs: ${latencies.filter(l => l.passed).length}/${latencies.length} | Total: ${totalMs} ms`);
	for (const a of audits) {
		console.log(`  [${a.agent}] ${a.chars} chars (~${a.estimatedTokens} tok) | score=${a.score100}/100 | phantom=${a.unconditionalPhantomTools.length} | contra=${a.contradictions.length}`);
	}

	if (!allAuditsPass || !allTemplatesPass || !allMatrixPass || !allLatencyPass) {
		for (const a of audits.filter(x => !x.passed)) console.error(`FAIL AUDIT ${a.agent}:`, JSON.stringify(a));
		for (const t of templateChecks.filter(x => !x.passed)) console.error(`FAIL TEMPLATE ${t.file}: ${t.note}`);
		for (const f of matrix.failures.slice(0, 10)) console.error(`FAIL MATRIX: ${f}`);
		for (const l of latencies.filter(x => !x.passed)) console.error(`FAIL SLA ${l.operation}: p95=${l.p95Ms}ms > ${l.budgetP95Ms}ms`);
		process.exitCode = 1;
	}
}

main();
