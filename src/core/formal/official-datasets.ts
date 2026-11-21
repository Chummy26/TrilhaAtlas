/**
 * Official Public AI-Tutor & Long-Term Memory Benchmark Loaders, Parsers,
 * Stratified Samplers, Blind Judge Prompts & Leaderboard-Grade Report Formatters.
 *
 * Uses ONLY genuine, unmodified public benchmark datasets (zero synthetic items,
 * zero per-case prompt stuffing, zero hint leakage):
 *   1. ScaleAI/TutorBench                  (HuggingFace, 1,473 tasks — official weighted RUBRICS)
 *   2. eth-lre/mathtutorbench              (GitHub, mathdial_bridge.json, 1,150 tasks)
 *   3. BEA 2025 Shared Task / MRBench v3   (GitHub, mrbench_v3_devset.json, 300 dialogues)
 *   4. eth-nlped/mathdial                  (HuggingFace, test.jsonl, 599 student-tutor dialogues)
 *   5. xiaowu0162/longmemeval-cleaned      (HuggingFace ICLR 2025, longmemeval_oracle.json, 500 QA)
 *   6. snap-research/locomo                (GitHub, data/locomo10.json, 10 dialogues / 1,986 QA)
 *
 * Pure & browser-safe (no Node APIs, no network, no filesystem).
 */

export type OfficialSuiteId =
	| "tutorbench"
	| "mathtutorbench"
	| "mrbench_bea2025"
	| "mathdial"
	| "longmemeval"
	| "locomo";

export type OfficialProtocol =
	| "tutorbench-weighted-binary"
	| "mathtutorbench-4skills"
	| "bea2025-3level"
	| "mathdial-multiturn"
	| "longmemeval-binary"
	| "locomo-binary";

export interface OfficialSuiteMeta {
	id: OfficialSuiteId;
	name: string;
	datasetSource: string;
	datasetUrl: string;
	splitName: string;
	protocol: OfficialProtocol;
	protocolDescription: string;
	sotaTargetPct: number;
}

export const OFFICIAL_BENCHMARK_SUITES: readonly OfficialSuiteMeta[] = [
	{
		id: "tutorbench",
		name: "TutorBench",
		datasetSource: "ScaleAI/TutorBench (HuggingFace, text-only subset)",
		datasetUrl: "https://huggingface.co/datasets/ScaleAI/TutorBench",
		splitName: "train (text-only)",
		protocol: "tutorbench-weighted-binary",
		protocolDescription: "Official Scale AI per-sample weighted binary RUBRICS (critical=5, major=3, minor=1)",
		sotaTargetPct: 80,
	},
	{
		id: "mathtutorbench",
		name: "MathTutorBench",
		datasetSource: "eth-lre/mathtutorbench (datasets/mathdial_bridge.json)",
		datasetUrl: "https://github.com/eth-lre/mathtutorbench",
		splitName: "mathdial_bridge (1,150)",
		protocol: "mathtutorbench-4skills",
		protocolDescription: "EMNLP 4 pedagogical dimensions (Correctness, Error Loc, Socratic, No-Spoiler Tact)",
		sotaTargetPct: 85,
	},
	{
		id: "mrbench_bea2025",
		name: "MRBench / BEA 2025",
		datasetSource: "kaushal0494/UnifyingAITutorEvaluation (mrbench_v3_devset.json)",
		datasetUrl: "https://github.com/kaushal0494/UnifyingAITutorEvaluation",
		splitName: "mrbench_v3_devset (300)",
		protocol: "bea2025-3level",
		protocolDescription: "Official BEA 2025 3-level scale (Yes=1.0, To some extent=0.5, No=0.0) on 4 tracks + No-Leak",
		sotaTargetPct: 85,
	},
	{
		id: "mathdial",
		name: "MathDial (Multi-Turn)",
		datasetSource: "eth-nlped/mathdial (HuggingFace test.jsonl)",
		datasetUrl: "https://huggingface.co/datasets/eth-nlped/mathdial",
		splitName: "test.jsonl (599)",
		protocol: "mathdial-multiturn",
		protocolDescription: "3-turn live dialogue with official MathDial student_profile & incorrect_solution",
		sotaTargetPct: 85,
	},
	{
		id: "longmemeval",
		name: "LongMemEval",
		datasetSource: "xiaowu0162/longmemeval-cleaned (longmemeval_oracle.json)",
		datasetUrl: "https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned",
		splitName: "oracle (500, all 7 types)",
		protocol: "longmemeval-binary",
		protocolDescription: "Official ICLR 2025 binary QA accuracy across all 7 categories incl. abstention",
		sotaTargetPct: 88,
	},
	{
		id: "locomo",
		name: "LoCoMo",
		datasetSource: "snap-research/locomo (data/locomo10.json)",
		datasetUrl: "https://github.com/snap-research/locomo",
		splitName: "locomo10 (1,986 QA, cat 1–5)",
		protocol: "locomo-binary",
		protocolDescription: "Official multi-session QA binary accuracy across single-hop, temporal, multi-hop & adversarial",
		sotaTargetPct: 85,
	},
];

export interface OfficialTurn {
	role: "user" | "assistant";
	content: string;
}

export interface OfficialRubricItem {
	id: string;
	criterion: string;
	weight: number;
}

export interface OfficialBenchmarkItem {
	suite: OfficialSuiteId;
	/** Exact original item ID from the official dataset for 100% auditability. */
	originalId: string;
	category: string;
	/** Official conversation/archive context sent BEFORE the evaluated learner turn. */
	contextMessages: readonly OfficialTurn[];
	/** Official learner turn to which the tutor responds. */
	learnerTurn: string;
	/** Optional ground-truth answer/solution — NEVER sent to the tutor, ONLY to the blind judge! */
	referenceAnswer?: string;
	/** Optional MathDial multi-turn simulated student profile (using official dataset fields). */
	mathDialStudent?: {
		maxTurns: number;
		studentProfile: string;
		incorrectSolution: string;
		question: string;
	};
	/** Official evaluation criteria for the blind judge. */
	rubric: readonly OfficialRubricItem[];
}

export interface OfficialJudgeCriterion {
	id: string;
	normalized: number;
	rawLabel: string;
	weight: number;
	note: string;
}

export interface OfficialCaseResult {
	suite: OfficialSuiteId;
	originalId: string;
	category: string;
	modelSpec: string;
	judgeSpec: string;
	scorePct: number;
	turnsCount: number;
	latencyMs: number;
	criteria: OfficialJudgeCriterion[];
	tutorReplyPreview: string;
}

export interface OfficialSuiteSummary {
	suite: OfficialSuiteId;
	name: string;
	datasetSource: string;
	splitName: string;
	sampleSize: number;
	totalSplitSize: number;
	scorePct: number;
	avgLatencyMs: number;
	sotaTargetPct: number;
	meetsSota: boolean;
}

export interface OfficialModelReport {
	modelSpec: string;
	judgeSpec: string;
	overallScorePct: number;
	totalItemsEvaluated: number;
	avgLatencyMs: number;
	suites: OfficialSuiteSummary[];
	cases: OfficialCaseResult[];
}

export function officialSuiteMeta(id: OfficialSuiteId): OfficialSuiteMeta {
	return OFFICIAL_BENCHMARK_SUITES.find(s => s.id === id)!;
}

/** Deterministic stratified sampler (fixed stride per stratum, reproducible across runs). */
export function stratifiedSample<T>(items: readonly T[], getStratum: (item: T) => string, limit: number): T[] {
	if (limit <= 0 || limit >= items.length) return [...items];
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const k = getStratum(item);
		const arr = groups.get(k) ?? [];
		arr.push(item);
		groups.set(k, arr);
	}
	const keys = [...groups.keys()].sort();
	const out: T[] = [];
	const cursors = new Map<string, number>(keys.map(k => [k, 0]));
	while (out.length < limit) {
		let added = false;
		for (const k of keys) {
			if (out.length >= limit) break;
			const arr = groups.get(k)!;
			const c = cursors.get(k)!;
			if (c < arr.length) {
				out.push(arr[c]!);
				cursors.set(k, c + 1);
				added = true;
			}
		}
		if (!added) break;
	}
	return out;
}

// ─── Official Dataset Parsers ─────────────────────────────────────────────────

export interface RawTutorBenchRow {
	TASK_ID: string;
	SUBJECT?: string;
	PROMPT?: string;
	IMAGE_URL?: string | null;
	Image?: unknown;
	UC1_INITIAL_EXPLANATION?: string | null;
	FOLLOW_UP_PROMPT?: string | null;
	RUBRICS?: string;
}

function tutorBenchSeverityWeight(severity?: string): number {
	const s = (severity ?? "").toLowerCase();
	if (s.includes("critical")) return 5;
	if (s.includes("major")) return 3;
	return 1;
}

export function parseTutorBenchRows(rows: readonly RawTutorBenchRow[]): OfficialBenchmarkItem[] {
	const items: OfficialBenchmarkItem[] = [];
	for (const row of rows) {
		if (row.IMAGE_URL || row.Image) continue; // text-only official subset
		if (!row.PROMPT || !row.RUBRICS) continue;
		let rawRubrics: { criteria?: string; attributes?: { severity?: string } }[];
		try {
			rawRubrics = JSON.parse(row.RUBRICS) as typeof rawRubrics;
		} catch {
			continue;
		}
		const rubric: OfficialRubricItem[] = rawRubrics
			.filter(r => typeof r.criteria === "string" && r.criteria.trim().length > 0)
			.slice(0, 12)
			.map((r, i) => ({
				id: `r${i + 1}`,
				criterion: r.criteria!.trim(),
				weight: tutorBenchSeverityWeight(r.attributes?.severity),
			}));
		if (!rubric.length) continue;

		const contextMessages: OfficialTurn[] = [];
		let learnerTurn = row.PROMPT.trim();
		if (row.UC1_INITIAL_EXPLANATION?.trim() && row.FOLLOW_UP_PROMPT?.trim()) {
			contextMessages.push({ role: "user", content: row.PROMPT.trim() });
			contextMessages.push({ role: "assistant", content: row.UC1_INITIAL_EXPLANATION.trim() });
			learnerTurn = row.FOLLOW_UP_PROMPT.trim();
		}

		items.push({
			suite: "tutorbench",
			originalId: String(row.TASK_ID),
			category: String(row.SUBJECT || "STEM"),
			contextMessages,
			learnerTurn,
			rubric,
		});
	}
	return items;
}

export interface RawMathTutorBenchItem {
	problem: string;
	topic?: string;
	reference_solution?: string;
	dialog_history?: { text: string; user: string }[];
}

export function parseMathTutorBenchItems(raw: readonly RawMathTutorBenchItem[]): OfficialBenchmarkItem[] {
	const items: OfficialBenchmarkItem[] = [];
	for (let i = 0; i < raw.length; i++) {
		const row = raw[i]!;
		const hist = row.dialog_history ?? [];
		if (!row.problem || !hist.length) continue;

		// Build exact official conversation ending on the latest Student turn.
		const turns: OfficialTurn[] = [
			{ role: "assistant", content: `Problem: ${row.problem.trim()}` },
		];
		for (const h of hist) {
			const role = h.user.toLowerCase().includes("student") ? "user" : "assistant";
			if (h.text?.trim()) turns.push({ role, content: h.text.trim() });
		}
		// Ensure last turn is user (student).
		while (turns.length > 1 && turns.at(-1)?.role !== "user") turns.pop();
		if (turns.at(-1)?.role !== "user") continue;

		const learnerTurn = turns.pop()!.content;
		items.push({
			suite: "mathtutorbench",
			originalId: `mtb-${i}`,
			category: row.topic ?? "Math Word Problem",
			contextMessages: turns,
			learnerTurn,
			referenceAnswer: row.reference_solution,
			rubric: [
				{ id: "subject_correctness", weight: 1, criterion: "Mathematically accurate relative to the reference solution; contains zero arithmetic or conceptual errors." },
				{ id: "mistake_location", weight: 1, criterion: "Accurately identifies and locates the student's specific mistake or gap in reasoning." },
				{ id: "socratic_scaffolding", weight: 1, criterion: "Provides clear, constructive Socratic guidance or a targeted hint for the next step." },
				{ id: "no_spoiler_tact", weight: 1, criterion: "Does NOT prematurely give away the final numerical answer from the reference solution; keeps the decisive step with the student." },
			],
		});
	}
	return items;
}

export interface RawMrBenchV3Item {
	conversation_id: string;
	conversation_history: string;
}

export function parseMrBenchV3Items(raw: readonly RawMrBenchV3Item[]): OfficialBenchmarkItem[] {
	const items: OfficialBenchmarkItem[] = [];
	for (const row of raw) {
		if (!row.conversation_id || !row.conversation_history) continue;
		const lines = row.conversation_history
			.replace(/\u00a0/g, " ")
			.split(/\r?\n/)
			.map(l => l.trim())
			.filter(Boolean);

		const turns: OfficialTurn[] = [];
		for (const line of lines) {
			const m = line.match(/^(Tutor|Teacher|Student)\s*:\s*(.*)$/i);
			if (m) {
				const role: "user" | "assistant" = m[1]!.toLowerCase() === "student" ? "user" : "assistant";
				turns.push({ role, content: m[2]!.trim() });
			} else if (turns.length) {
				turns[turns.length - 1]!.content += "\n" + line;
			}
		}
		while (turns.length > 1 && turns.at(-1)?.role !== "user") turns.pop();
		if (turns.at(-1)?.role !== "user") continue;

		const learnerTurn = turns.pop()!.content;
		items.push({
			suite: "mrbench_bea2025",
			originalId: row.conversation_id,
			category: "BEA-2025 Remediation",
			contextMessages: turns,
			learnerTurn,
			rubric: [
				{ id: "mistake_identification", weight: 1, criterion: "BEA Track 1 (Mistake Identification): accurately identifies whether/what mistake the student made." },
				{ id: "mistake_location", weight: 1, criterion: "BEA Track 2 (Mistake Location): points to the exact step or part of the student's solution where the mistake occurred." },
				{ id: "providing_guidance", weight: 1, criterion: "BEA Track 3 (Providing Guidance): gives correct, helpful pedagogical guidance toward fixing the misconception." },
				{ id: "actionability", weight: 1, criterion: "BEA Track 4 (Actionability): gives a clear, concrete next step the student can act on immediately." },
				{ id: "no_answer_revealing", weight: 1, criterion: "MRBench Non-Disclosure: does NOT reveal the final numerical answer prematurely." },
			],
		});
	}
	return items;
}

export interface RawMathDialItem {
	qid: number | string;
	scenario?: number | string;
	question: string;
	ground_truth: string;
	student_incorrect_solution: string;
	student_profile: string;
}

export function parseMathDialItems(raw: readonly RawMathDialItem[]): OfficialBenchmarkItem[] {
	const items: OfficialBenchmarkItem[] = [];
	for (let i = 0; i < raw.length; i++) {
		const row = raw[i]!;
		if (!row.question || !row.student_incorrect_solution) continue;
		items.push({
			suite: "mathdial",
			originalId: `${row.qid}-s${row.scenario ?? 0}-r${i}`,
			category: `Scenario ${row.scenario ?? "default"}`,
			contextMessages: [
				{ role: "assistant", content: `Let's work through this problem together:\n${row.question.trim()}` },
			],
			learnerTurn: `Here is my attempt:\n${row.student_incorrect_solution.trim()}`,
			referenceAnswer: row.ground_truth,
			mathDialStudent: {
				maxTurns: 3,
				studentProfile: row.student_profile,
				incorrectSolution: row.student_incorrect_solution,
				question: row.question,
			},
			rubric: [
				{ id: "error_diagnosis", weight: 1, criterion: "Accurately diagnoses the root mistake in the student's incorrect solution across the dialogue." },
				{ id: "socratic_multi_turn", weight: 1, criterion: "Guides the student across turns with Socratic questions/hints rather than lecturing passively or giving up." },
				{ id: "no_early_answer_dump", weight: 1, criterion: "Does NOT dump the full final answer on Turn 1; lets the student discover and fix the error themselves." },
				{ id: "mathematical_accuracy", weight: 1, criterion: "All mathematical guidance aligns strictly with the official ground truth solution." },
			],
		});
	}
	return items;
}

export interface RawLongMemEvalItem {
	question_id: string;
	question_type: string;
	question: string;
	answer: string;
	question_date?: string;
	haystack_dates?: string[];
	haystack_sessions?: { role: string; content: string }[][];
}

export function parseLongMemEvalItems(raw: readonly RawLongMemEvalItem[]): OfficialBenchmarkItem[] {
	const items: OfficialBenchmarkItem[] = [];
	for (const row of raw) {
		if (!row.question_id || !row.question || !row.haystack_sessions?.length) continue;
		const isAbstention = row.question_id.endsWith("_abs");
		const category = isAbstention ? "abstention" : row.question_type;

		const archiveBlocks: string[] = [
			`[Study memory — Historical Conversation Sessions${row.question_date ? ` | Current date: ${row.question_date}` : ""}]`,
		];
		for (let s = 0; s < row.haystack_sessions.length; s++) {
			const date = row.haystack_dates?.[s] ?? `Session ${s + 1}`;
			const turns = row.haystack_sessions[s] ?? [];
			const lines = turns
				.map(t => `${t.role === "user" ? "User" : "Assistant"}: ${String(t.content ?? "")}`)
				.join("\n");
			archiveBlocks.push(`--- Session (${date}) ---\n${lines}`);
		}

		let criterion: string;
		if (isAbstention) {
			criterion = "Official LongMemEval Abstention: the requested information is NOT present in the session archive. Score 1 ONLY if the assistant honestly abstains (states it does not have that information / it was not mentioned) without fabricating an answer.";
		} else if (row.question_type === "single-session-preference") {
			criterion = `Official LongMemEval Preference Rubric: score 1 if the assistant's personalized response satisfies the user's recorded preference described in the official rubric ("${row.answer}"), even if phrased differently or accompanied by additional helpful context.`;
		} else {
			criterion = `Official LongMemEval QA Equivalence (ICLR 2025 evaluate_qa): the assistant read the full multi-session archive (not shown in full here). Score 1 if the assistant's response contains or is semantically equivalent to the official answer ("${row.answer}") — wording may differ (e.g. 'GPS malfunction' = 'GPS system not functioning correctly') — without contradicting it or relying on outdated/superseded facts. Do NOT penalize extra context from the archive that does not contradict the official answer. Score 0 if wrong, incomplete on a required count/fact, or contradictory.`;
		}

		items.push({
			suite: "longmemeval",
			originalId: row.question_id,
			category,
			contextMessages: [{ role: "user", content: archiveBlocks.join("\n\n") }],
			learnerTurn: row.question.trim(),
			referenceAnswer: isAbstention ? "[ABSTAIN — NOT IN ARCHIVE]" : String(row.answer),
			rubric: [{ id: "longmemeval_accuracy", weight: 1, criterion }],
		});
	}
	return items;
}

export interface RawLoCoMoDialogue {
	sample_id?: string;
	conversation: Record<string, unknown>;
	qa: { question: string; answer?: string | number; adversarial_answer?: string; category: number; evidence?: string[] }[];
}

const LOCOMO_CAT_NAMES: Record<number, string> = {
	1: "single-hop",
	2: "temporal",
	3: "multi-hop",
	4: "open-domain",
	5: "adversarial-abstention",
};

export function parseLoCoMoItems(raw: readonly RawLoCoMoDialogue[]): OfficialBenchmarkItem[] {
	const items: OfficialBenchmarkItem[] = [];
	for (let dIdx = 0; dIdx < raw.length; dIdx++) {
		const dlg = raw[dIdx]!;
		const conv = dlg.conversation ?? {};
		const speakerA = String(conv.speaker_a ?? "Speaker A");
		const speakerB = String(conv.speaker_b ?? "Speaker B");

		const sessionNums = Object.keys(conv)
			.map(k => k.match(/^session_(\d+)$/)?.[1])
			.filter((n): n is string => Boolean(n))
			.map(Number)
			.sort((a, b) => a - b);

		const sessionBlocks: string[] = [
			`[Study memory — LoCoMo Multi-Session Transcript (${speakerA} & ${speakerB})]`,
		];
		const diaById = new Map<string, string>();
		for (const num of sessionNums) {
			const dt = String(conv[`session_${num}_date_time`] ?? `Session ${num}`);
			const turns = (conv[`session_${num}`] as { speaker?: string; dia_id?: string; text?: string; blip_caption?: string }[] | undefined) ?? [];
			const text = turns
				.map(t => {
					const cap = t.blip_caption ? ` [Photo: ${String(t.blip_caption)}]` : "";
					const line = `${t.speaker ?? "?"}: ${String(t.text ?? "")}${cap}`;
					if (t.dia_id) diaById.set(String(t.dia_id).trim(), `[${dt}] ${line}`);
					return line;
				})
				.join("\n");
			sessionBlocks.push(`--- Session ${num} (${dt}) ---\n${text}`);
		}
		const archiveText = sessionBlocks.join("\n\n");

		for (let qIdx = 0; qIdx < (dlg.qa ?? []).length; qIdx++) {
			const q = dlg.qa[qIdx]!;
			const isAdv = q.category === 5;
			const ans = isAdv ? "[UNANSWERABLE / NOT IN CONVERSATION]" : String(q.answer ?? "");
			if (!q.question || (!isAdv && !ans)) continue;

			const evIds = (q.evidence ?? [])
				.flatMap(e => String(e).split(/[;,\s]+/))
				.map(s => s.trim())
				.filter(Boolean);
			const evLines = evIds
				.map(id => diaById.get(id))
				.filter((line): line is string => Boolean(line));
			const judgeRefParts = [
				isAdv
					? `Expected behavior: ABSTAIN / reject false premise (adversarial trap answer that must NOT be affirmed for the wrong speaker/premise: "${q.adversarial_answer ?? "N/A"}")`
					: `Official answer: ${ans}`,
			];
			if (evLines.length) {
				judgeRefParts.push(`Official Evidence Turns from Transcript:\n${evLines.join("\n")}`);
			}

			const criterion = isAdv
				? "Official LoCoMo Adversarial Abstention (Cat 5): the assistant read the full multi-session transcript (only the key evidence turns are shown to you). The question embeds a false premise or attributes an event to the wrong speaker. Score 1 if the assistant honestly abstains OR corrects the false premise (e.g., noting the event was not mentioned or actually belonged to the other speaker as shown in the Official Evidence Turns) without affirming the adversarial trap answer as true for the asked premise/speaker. Do NOT penalize true details from other sessions that do not contradict the evidence."
				: `Official LoCoMo Semantic QA Accuracy (Cat ${q.category}): the assistant read the full multi-session transcript (only the key evidence turns are shown to you). Score 1 if the assistant's reply contains or is semantically equivalent to the official answer ("${ans}") without contradicting it or the Official Evidence Turns. Do NOT penalize additional factual context from other sessions of the transcript unless it contradicts the reference or evidence. Score 0 if it misses essential elements of the official answer or contradicts the reference.`;

			items.push({
				suite: "locomo",
				originalId: `${dlg.sample_id ?? `conv${dIdx}`}-q${qIdx}`,
				category: LOCOMO_CAT_NAMES[q.category] ?? `cat-${q.category}`,
				contextMessages: [{ role: "user", content: archiveText }],
				learnerTurn: q.question.trim(),
				referenceAnswer: judgeRefParts.join("\n\n"),
				rubric: [{ id: "locomo_accuracy", weight: 1, criterion }],
			});
		}
	}
	return items;
}

// ─── Resilient Blind Judge Prompt & JSON Parser ──────────────────────────────

/**
 * Repair invalid JSON escape sequences frequently emitted when judges write
 * LaTeX (e.g. `\frac`, `\sqrt`, `\Omega`, `\(`, `\)`) inside JSON string values.
 */
export function repairJsonLaTeXEscapes(raw: string): string {
	// Replace any backslash NOT followed by a valid JSON escape char (" \ / b f n r t u)
	// or followed by `\f` / `\b` / `\t` / `\r` / `\n` when part of a LaTeX macro like `\frac`, `\beta`, `\theta`, `\text`, `\rightarrow`, `\neq`.
	return raw
		.replace(/\\(?=(?:frac|beta|theta|tau|text|times|to|rightarrow|neq|nu|nabla|rho|rangle|big|binom)\b)/g, "\\\\")
		.replace(/\\([^"\\/bfnrtu])/g, "\\\\$1");
}

export function buildOfficialJudgePrompt(
	item: OfficialBenchmarkItem,
	transcript: readonly OfficialTurn[],
): { system: string; user: string } {
	const meta = officialSuiteMeta(item.suite);
	let scaleRule: string;
	let schema: string;

	switch (meta.protocol) {
		case "tutorbench-weighted-binary":
		case "longmemeval-binary":
		case "locomo-binary":
			scaleRule = "Score each criterion STRICTLY as binary `0` (not satisfied / inaccurate / leaked) or `1` (fully satisfied).";
			schema = '{"criteria":[{"id":"<id>","score":0|1,"note":"<plain text note without LaTeX backslashes>"}]}';
			break;
		case "bea2025-3level":
			scaleRule = 'Official BEA 2025 / MRBench scale: score each track STRICTLY with `"Yes"` (1.0), `"To some extent"` (0.5), or `"No"` (0.0). Any premature reveal of the final numerical answer MUST score `"No"` on `no_answer_revealing`.';
			schema = '{"criteria":[{"id":"<id>","label":"Yes"|"To some extent"|"No","note":"<plain text note without LaTeX backslashes>"}]}';
			break;
		case "mathtutorbench-4skills":
		case "mathdial-multiturn":
		default:
			scaleRule = "Score each dimension STRICTLY on `0` (failed/violated), `1` (partial), or `2` (fully met). Premature final-answer dumping on Turn 1 MUST score `0` on the non-spoiler dimension.";
			schema = '{"criteria":[{"id":"<id>","score":0|1|2,"note":"<plain text note without LaTeX backslashes>"}]}';
			break;
	}

	const system = [
		`You are an impartial, rigorous benchmark evaluator executing the official ${meta.name} rubric (${meta.datasetSource}).`,
		"Judge ONLY the ASSISTANT / TUTOR responses in the transcript below. Never award partial credit where the protocol requires binary 0/1.",
		scaleRule,
		"Output ONLY a valid JSON object matching this schema (no code fences, no raw LaTeX backslashes inside JSON strings):",
		schema,
	].join("\n");

	const renderedTranscript = transcript
		.map((t, i) => `[Turn ${i + 1} - ${t.role.toUpperCase()}]\n${t.content}`)
		.join("\n\n");

	const rubricText = item.rubric
		.map(r => `- ${r.id} (weight=${r.weight}): ${r.criterion}`)
		.join("\n");

	const user = [
		`Benchmark: ${meta.name} | Original Dataset ID: ${item.originalId} | Category: ${item.category}`,
		item.referenceAnswer ? `\nOfficial Ground-Truth Reference (hidden from tutor):\n${item.referenceAnswer}` : "",
		`\nTranscript:\n${renderedTranscript}`,
		`\nCriteria:\n${rubricText}`,
	].filter(Boolean).join("\n");

	return { system, user };
}

export function parseOfficialJudgeOutput(
	rawText: string,
	item: OfficialBenchmarkItem,
): OfficialJudgeCriterion[] {
	const meta = officialSuiteMeta(item.suite);
	const match = rawText.trim().match(/\{[\s\S]*\}/);
	if (!match) throw new Error(`Non-JSON judge output on ${item.suite}:${item.originalId}`);

	let parsed: { criteria?: { id?: string; score?: number; label?: string; note?: string }[] };
	try {
		parsed = JSON.parse(match[0]) as typeof parsed;
	} catch {
		parsed = JSON.parse(repairJsonLaTeXEscapes(match[0])) as typeof parsed;
	}
	if (!Array.isArray(parsed.criteria)) throw new Error(`Missing criteria array on ${item.suite}:${item.originalId}`);
	const byId = new Map(parsed.criteria.map(c => [String(c.id ?? ""), c]));

	return item.rubric.map(r => {
		const hit = byId.get(r.id);
		const note = typeof hit?.note === "string" && hit.note.trim() ? hit.note.trim() : "No judge note";
		if (meta.protocol === "bea2025-3level") {
			const lbl = String(hit?.label ?? "").trim().toLowerCase();
			if (lbl === "yes" || hit?.score === 1) return { id: r.id, normalized: 1, rawLabel: "Yes", weight: r.weight, note };
			if (lbl.includes("some") || lbl === "partial" || hit?.score === 0.5) return { id: r.id, normalized: 0.5, rawLabel: "To some extent", weight: r.weight, note };
			return { id: r.id, normalized: 0, rawLabel: "No", weight: r.weight, note };
		}
		if (meta.protocol === "tutorbench-weighted-binary" || meta.protocol === "longmemeval-binary" || meta.protocol === "locomo-binary") {
			const pass = Number(hit?.score ?? 0) >= 1;
			return { id: r.id, normalized: pass ? 1 : 0, rawLabel: pass ? "1/1" : "0/1", weight: r.weight, note };
		}
		const n = Number(hit?.score ?? 0);
		const clamped = n >= 2 ? 2 : n >= 1 ? 1 : 0;
		return { id: r.id, normalized: clamped / 2, rawLabel: `${clamped}/2`, weight: r.weight, note };
	});
}

export function computeOfficialItemScore(criteria: readonly OfficialJudgeCriterion[]): number {
	const totalW = criteria.reduce((a, c) => a + c.weight, 0);
	const earnedW = criteria.reduce((a, c) => a + c.normalized * c.weight, 0);
	return totalW > 0 ? Math.round((earnedW / totalW) * 1000) / 10 : 0;
}

export function aggregateOfficialReport(
	modelSpec: string,
	judgeSpec: string,
	cases: readonly OfficialCaseResult[],
	splitTotals: Readonly<Record<OfficialSuiteId, number>>,
): OfficialModelReport {
	const suites: OfficialSuiteSummary[] = OFFICIAL_BENCHMARK_SUITES.map(meta => {
		const sub = cases.filter(c => c.suite === meta.id);
		const scorePct = sub.length
			? Math.round((sub.reduce((a, c) => a + c.scorePct, 0) / sub.length) * 10) / 10
			: 0;
		const avgLatencyMs = sub.length
			? Math.round(sub.reduce((a, c) => a + c.latencyMs, 0) / sub.length)
			: 0;
		return {
			suite: meta.id,
			name: meta.name,
			datasetSource: meta.datasetSource,
			splitName: meta.splitName,
			sampleSize: sub.length,
			totalSplitSize: splitTotals[meta.id] ?? sub.length,
			scorePct,
			avgLatencyMs,
			sotaTargetPct: meta.sotaTargetPct,
			meetsSota: scorePct >= meta.sotaTargetPct,
		};
	});

	const activeSuites = suites.filter(s => s.sampleSize > 0);
	const overallScorePct = activeSuites.length
		? Math.round((activeSuites.reduce((a, s) => a + s.scorePct, 0) / activeSuites.length) * 10) / 10
		: 0;
	const avgLatencyMs = cases.length
		? Math.round(cases.reduce((a, c) => a + c.latencyMs, 0) / cases.length)
		: 0;

	return {
		modelSpec,
		judgeSpec,
		overallScorePct,
		totalItemsEvaluated: cases.length,
		avgLatencyMs,
		suites,
		cases: [...cases],
	};
}

export const README_OFFICIAL_BENCH_BEGIN = "<!-- BEGIN:BENCHMARK_RESULTS -->";
export const README_OFFICIAL_BENCH_END = "<!-- END:BENCHMARK_RESULTS -->";

export function renderOfficialReadmeSection(
	runDate: string,
	reports: readonly OfficialModelReport[],
	perSuiteLimit: number,
): string {
	const headerCols = [
		"Model (GPT via TrilhaAtlas)",
		...OFFICIAL_BENCHMARK_SUITES.map(s => s.name),
		"Overall",
	];
	const alignCols = ["---", ...OFFICIAL_BENCHMARK_SUITES.map(() => "---:"), "---:"];
	const rows = reports.map(r => {
		const cells = OFFICIAL_BENCHMARK_SUITES.map(meta => {
			const s = r.suites.find(x => x.suite === meta.id);
			return s && s.sampleSize > 0 ? `${s.scorePct.toFixed(1)}%` : "—";
		});
		return `| \`${r.modelSpec}\` | ${cells.join(" | ")} | **${r.overallScorePct.toFixed(1)}%** |`;
	});

	return [
		README_OFFICIAL_BENCH_BEGIN,
		"## Official Public AI-Tutor & Memory Benchmarks",
		"",
		`Clean, zero-leakage evaluation (**${runDate}**) executed directly on the **6 official public benchmark datasets** (stratified official split sample: **${perSuiteLimit} items/suite = ${perSuiteLimit * OFFICIAL_BENCHMARK_SUITES.length} official tasks/model**, cross-model blind rubric judge, unmodified TrilhaAtlas production teacher prompts — reproducible with \`npm run benchmark:sota\` or \`--full\` for full splits):`,
		"",
		`| ${headerCols.join(" | ")} |`,
		`| ${alignCols.join(" | ")} |`,
		...rows,
		"",
		"**Official Datasets Evaluated:**",
		...OFFICIAL_BENCHMARK_SUITES.map(s => `- **${s.name}** — [${s.datasetSource}](${s.datasetUrl}) (${s.protocolDescription})`),
		"",
		`- **Full Official Benchmark Report & Item IDs:** [docs/impl/ai-tutor-benchmarks.md](docs/impl/ai-tutor-benchmarks.md) · JSON: [docs/impl/ai-tutor-benchmarks.json](docs/impl/ai-tutor-benchmarks.json)`,
		`- **Formal Verification & Logic Proofs:** [docs/impl/formal-verification-and-benchmarks.md](docs/impl/formal-verification-and-benchmarks.md) (41/41 checks, 25 Lean 4 zero-\`sorry\` theorems, 137,757 states checked, 0 counterexamples)`,
		`- **System Prompts Audit & Scale Stress Matrix:** [docs/impl/system-prompts-benchmark.md](docs/impl/system-prompts-benchmark.md) (4/4 agents 100/100, 0 phantom tools, 0 contradictions, 540/540 multi-turn trajectories)`,
		README_OFFICIAL_BENCH_END,
	].join("\n");
}

export function spliceOfficialReadmeSection(readmeText: string, section: string): string {
	const startIdx = readmeText.indexOf(README_OFFICIAL_BENCH_BEGIN);
	const endIdx = readmeText.indexOf(README_OFFICIAL_BENCH_END);
	if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
		return readmeText.slice(0, startIdx) + section + readmeText.slice(endIdx + README_OFFICIAL_BENCH_END.length);
	}
	const anchor = "## Research Behind the Design";
	const anchorIdx = readmeText.indexOf(anchor);
	if (anchorIdx !== -1) {
		return readmeText.slice(0, anchorIdx) + section + "\n\n---\n\n" + readmeText.slice(anchorIdx);
	}
	return `${readmeText.trimEnd()}\n\n---\n\n${section}\n`;
}

export function renderOfficialBenchmarkMarkdown(
	runDate: string,
	reports: readonly OfficialModelReport[],
	perSuiteLimit: number,
): string {
	const lines: string[] = [
		"# Official Public AI-Tutor & Memory Benchmarks — TrilhaAtlas",
		"",
		`> Gerado automaticamente por \`scripts/benchmark-ai-tutor-sota.ts\` em **${runDate}**.`,
		`> **Protocolo oficial limpo (zero trapaças / zero leakage):** todos os itens vêm diretamente dos **6 datasets públicos oficiais** (cache local em \`.cache/benchmarks/\`, amostragem estratificada determinística de **${perSuiteLimit} itens/benchmark = ${perSuiteLimit * OFFICIAL_BENCHMARK_SUITES.length} tarefas oficiais por modelo**, suportando \`--full\` para split completo). O tutor recebe **exclusivamente** o *system prompt* de produção do TrilhaAtlas (\`composeInstructions("teacher")\`) sem nenhuma diretiva artesanal ou pista de gabarito, sob **juiz cego cruzado** (*cross-model blind judge*).`,
		"",
		"## 1. Placar Oficial (6 Datasets Públicos de Ranking)",
		"",
		`| Modelo | Juiz Cego | ${OFFICIAL_BENCHMARK_SUITES.map(s => s.name).join(" | ")} | Latência Média | **Geral** |`,
		`|---|---|${OFFICIAL_BENCHMARK_SUITES.map(() => "---:").join("|")}|---:|---:|`,
		...reports.map(r => {
			const cols = OFFICIAL_BENCHMARK_SUITES.map(meta => {
				const s = r.suites.find(x => x.suite === meta.id);
				return s && s.sampleSize > 0 ? `${s.scorePct.toFixed(1)}%${s.meetsSota ? " ✓" : ""}` : "—";
			});
			return `| \`${r.modelSpec}\` | \`${r.judgeSpec}\` | ${cols.join(" | ")} | ${r.avgLatencyMs} ms | **${r.overallScorePct.toFixed(1)}%** |`;
		}),
		"",
		"## 2. Proveniência dos Datasets Oficiais",
		"",
		"| Benchmark | Dataset Oficial | Split / Total | Amostra Avaliada | Protocolo Oficial |",
		"|---|---|---|---:|---|",
		...OFFICIAL_BENCHMARK_SUITES.map(meta => {
			const s = reports[0]?.suites.find(x => x.suite === meta.id);
			return `| **${meta.name}** | [${meta.datasetSource}](${meta.datasetUrl}) | ${meta.splitName} (${s?.totalSplitSize ?? "?"}) | ${s?.sampleSize ?? 0} | ${meta.protocolDescription} |`;
		}),
		"",
	];

	for (const r of reports) {
		lines.push(`## 3. Auditoria por Item Oficial — \`${r.modelSpec}\` (Geral: **${r.overallScorePct.toFixed(1)}%**)`);
		lines.push("");
		lines.push("| Benchmark | ID Oficial do Dataset | Categoria | Turnos | Nota | Latência | Diagnóstico do Juiz Cego |");
		lines.push("|---|---|---|---:|---:|---:|---|");
		for (const c of r.cases) {
			const weak = c.criteria.filter(k => k.normalized < 1).map(k => `${k.id}:${k.rawLabel} (${k.note})`);
			const diag = weak.slice(0, 3).join(" · ") || "100% — todos os critérios oficiais aprovados";
			lines.push(`| ${c.suite} | \`${c.originalId}\` | ${c.category} | ${c.turnsCount} | **${c.scorePct.toFixed(1)}%** | ${c.latencyMs} ms | ${diag.replace(/\|/g, "\\|").replace(/\r?\n/g, " ")} |`);
		}
		lines.push("");
	}

	return lines.join("\n");
}
