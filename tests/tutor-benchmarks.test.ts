import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
	OFFICIAL_BENCHMARK_SUITES,
	README_OFFICIAL_BENCH_BEGIN,
	README_OFFICIAL_BENCH_END,
	aggregateOfficialReport,
	buildOfficialJudgePrompt,
	computeOfficialItemScore,
	computePairedSummary,
	evaluateDeterministicModuleExamGrader,
	evaluateTeachArenaResponseChecks,
	parseLoCoMoItems,
	parseLongMemEvalItems,
	parseMathDialItems,
	parseMathTutorBenchItems,
	parseMrBenchV3Items,
	parseOfficialJudgeOutput,
	parseTeachArenaStage0,
	parseTeachArenaStage1,
	parseTutorBenchRows,
	parseTutorMomentsRows,
	renderOfficialBenchmarkMarkdown,
	renderOfficialReadmeSection,
	repairJsonLaTeXEscapes,
	spliceOfficialReadmeSection,
	stratifiedSample,
	type GoldGradingCase,
} from "../src/core/formal/index.ts";

describe("Official Public AI-Tutor & Memory Benchmark Loaders & Scorers", () => {
	it("registers all 6 official public leaderboard datasets", () => {
		assert.equal(OFFICIAL_BENCHMARK_SUITES.length, 6);
		const ids = OFFICIAL_BENCHMARK_SUITES.map(s => s.id);
		assert.deepEqual(ids, ["tutorbench", "mathtutorbench", "mrbench_bea2025", "mathdial", "longmemeval", "locomo"]);
	});

	it("parses genuine rows from all 6 official dataset schemas cleanly", () => {
		const tb = parseTutorBenchRows([
			{
				TASK_ID: "tb-img",
				PROMPT: "Solve image",
				IMAGE_URL: "https://example.com/1.png",
				RUBRICS: JSON.stringify([{ criteria: "c", attributes: { severity: "critical" } }]),
			},
			{
				TASK_ID: "tb-txt-1",
				SUBJECT: "Statistics",
				PROMPT: "Compute conditional probability.",
				UC1_INITIAL_EXPLANATION: "Use Bayes theorem.",
				FOLLOW_UP_PROMPT: "Why do we divide by P(B)?",
				RUBRICS: JSON.stringify([
					{ criteria: "Explain conditioning on B.", attributes: { severity: "critical" } },
					{ criteria: "Give a concrete example.", attributes: { severity: "major" } },
				]),
			},
		]);
		assert.equal(tb.length, 1);
		assert.equal(tb[0]!.originalId, "tb-txt-1");
		assert.equal(tb[0]!.rubric[0]!.weight, 5);
		assert.equal(tb[0]!.rubric[1]!.weight, 3);

		const mtb = parseMathTutorBenchItems([{
			problem: "Ignatius owns 4 bicycles...",
			topic: "Math Word Problem",
			reference_solution: "10",
			dialog_history: [
				{ user: "Teacher", text: "Tell me your solution" },
				{ user: "Student", text: "I got 12." },
			],
		}]);
		assert.equal(mtb.length, 1);
		assert.equal(mtb[0]!.learnerTurn, "I got 12.");

		const bea = parseMrBenchV3Items([{
			conversation_id: "221-abc",
			conversation_history: "Tutor: Solve 2+2\nStudent: It is 5.",
		}]);
		assert.equal(bea.length, 1);
		assert.equal(bea[0]!.learnerTurn, "It is 5.");

		const md = parseMathDialItems([
			{
				qid: 6000025,
				scenario: 1,
				question: "Julia bought spoons...",
				ground_truth: "10",
				student_incorrect_solution: "I got 14.",
				student_profile: "Tends to add instead of subtract.",
			},
			{
				qid: 6000025,
				scenario: 1,
				question: "Julia bought spoons...",
				ground_truth: "10",
				student_incorrect_solution: "I got 8.",
				student_profile: "Forgets a step.",
			},
		]);
		assert.equal(md.length, 2);
		assert.notEqual(md[0]!.originalId, md[1]!.originalId);
		assert.equal(md[0]!.mathDialStudent?.maxTurns, 3);

		const lme = parseLongMemEvalItems([
			{
				question_id: "q1_abs",
				question_type: "single-session-user",
				question: "What was my TOEFL score?",
				answer: "N/A",
				haystack_dates: ["2025/01/01"],
				haystack_sessions: [[{ role: "user", content: "I like coffee." }]],
			},
		]);
		assert.equal(lme.length, 1);
		assert.equal(lme[0]!.category, "abstention");

		const loc = parseLoCoMoItems([{
			sample_id: "conv-0",
			conversation: {
				speaker_a: "Caroline",
				speaker_b: "Melanie",
				session_1_date_time: "8 May 2023",
				session_1: [{ speaker: "Caroline", dia_id: "D1:3", text: "I went to the support group yesterday.", blip_caption: "a group mural" }],
			},
			qa: [{ question: "When did Caroline go?", answer: "7 May 2023", evidence: ["D1:3"], category: 2 }],
		}]);
		assert.equal(loc.length, 1);
		assert.equal(loc[0]!.category, "temporal");
		assert.equal(loc[0]!.learnerTurn, "When did Caroline go?");
		assert.match(loc[0]!.contextMessages[0]!.content, /\[Photo: a group mural\]/);
		assert.match(loc[0]!.referenceAnswer ?? "", /Official Evidence Turns from Transcript[\s\S]*8 May 2023/);
	});

	it("repairs raw LaTeX backslashes in judge JSON and computes exact BEA/TutorBench scores", () => {
		const brokenJson = '{"criteria":[{"id":"r1","score":1,"note":"Explained \\frac{1}{2} and \\sqrt{2} clearly"},{"id":"r2","score":0,"note":"Missed \\theta"}]}';
		const repaired = repairJsonLaTeXEscapes(brokenJson);
		const parsedObj = JSON.parse(repaired) as { criteria: { id: string; score: number }[] };
		assert.equal(parsedObj.criteria.length, 2);

		const beaItem = parseMrBenchV3Items([{
			conversation_id: "c1",
			conversation_history: "Tutor: Q\nStudent: Wrong",
		}])[0]!;
		const judgePrompt = buildOfficialJudgePrompt(beaItem, [{ role: "user", content: "Wrong" }, { role: "assistant", content: "Hint" }]);
		assert.match(judgePrompt.system, /BEA 2025/);

		const beaOut = parseOfficialJudgeOutput(JSON.stringify({
			criteria: [
				{ id: "mistake_identification", label: "Yes", note: "ok" },
				{ id: "mistake_location", label: "Yes", note: "ok" },
				{ id: "providing_guidance", label: "To some extent", note: "partial" },
				{ id: "actionability", label: "Yes", note: "ok" },
				{ id: "no_answer_revealing", label: "Yes", note: "ok" },
			],
		}), beaItem);
		assert.equal(computeOfficialItemScore(beaOut), 90); // 4.5 / 5 = 90%

		// Stratified sampler balances categories deterministically
		const sampled = stratifiedSample(
			[{ c: "a", id: 1 }, { c: "a", id: 2 }, { c: "b", id: 3 }, { c: "b", id: 4 }, { c: "c", id: 5 }],
			x => x.c,
			3,
		);
		assert.deepEqual(sampled.map(x => x.c), ["a", "b", "c"]);

		// Report & idempotent README splice
		const rep = aggregateOfficialReport("chatgpt:gpt-6.2-sol", "chatgpt:gpt-6.2-astra", [{
			suite: "mrbench_bea2025",
			originalId: "c1",
			category: "BEA",
			modelSpec: "chatgpt:gpt-6.2-sol",
			judgeSpec: "chatgpt:gpt-6.2-astra",
			scorePct: 90,
			turnsCount: 1,
			latencyMs: 1200,
			criteria: beaOut,
			tutorReplyPreview: "Hint",
		}], { tutorbench: 180, mathtutorbench: 1150, mrbench_bea2025: 300, mathdial: 599, longmemeval: 500, locomo: 1986 });
		assert.match(renderOfficialBenchmarkMarkdown("2026-11-21", [rep], 8), /ScaleAI\/TutorBench/);
		const sec = renderOfficialReadmeSection("2026-11-21", [rep], 8);
		const md1 = spliceOfficialReadmeSection("# App\n\n## Research Behind the Design\n", sec);
		assert.ok(md1.includes(README_OFFICIAL_BENCH_BEGIN) && md1.includes(README_OFFICIAL_BENCH_END));
		assert.equal(spliceOfficialReadmeSection(md1, sec), md1);
	});

	it("validates 6-front evals/ framework: TutorMoments, TeachArena, paired 95% CI, deterministic module-exam grader, and evals JSON corpus", () => {
		// 1. TutorMoments parser cleans pure pauses and preserves alternating history
		const tm = parseTutorMomentsRows([{
			id: "m-1",
			dimension: "rigor",
			context: [
				{ turn_number: 1, role: "tutor", text: "[PAUSE: 10 seconds]" },
				{ turn_number: 1, role: "tutor", text: "What is 3/4 vs 3/8?" },
				{ turn_number: 2, role: "student", text: "3/4 is bigger." },
			],
			student: { trait: { persona: "Curious 6th grader" } },
			rubric: { gold: "rigor", hint: "Push student to justify why." },
		}]);
		assert.equal(tm.length, 1);
		assert.equal(tm[0]!.dimension, "rigor");
		assert.equal(tm[0]!.learnerTurn, "3/4 is bigger.");
		assert.equal(tm[0]!.contextMessages.length, 1);

		// 2. TeachArena Stage 0 & Stage 1 parsers + deterministic response checks
		const s0 = parseTeachArenaStage0([{
			id: "S0-01",
			user_scenario: { persona: "Undergrad", instructions: { reason_for_call: "Help with roots of unity", known_info: "Sum of all roots is 0" } },
			evaluation_criteria: { nl_assertions: ["Diagnoses subset misconception"] },
		}]);
		assert.equal(s0.length, 1);
		assert.equal(s0[0]!.nlAssertions.length, 1);

		const s1 = parseTeachArenaStage1([{
			id: "EI-01",
			user_scenario: { instructions: { reason_for_call: "Pick best next move", task_instructions: "Compare Maya and Leo." } },
			evaluation_criteria: {
				response_checks: [{ type: "contains_any", values: ["Maya"] }, { type: "contains_any", values: ["harder", "more challenge"] }],
				nl_assertions: ["Identifies Maya impasse"],
			},
		}]);
		assert.equal(s1.length, 1);
		const chk = evaluateTeachArenaResponseChecks("For Maya, resolve the impasse; give Leo harder tasks.", s1[0]!.responseChecks);
		assert.equal(chk.score01, 1);

		// 3. Exact paired delta & 95% CI calculation
		const paired = computePairedSummary([0.2, 0.4, 0.5, 0.5], [0.8, 0.9, 1.0, 0.9]);
		assert.equal(paired.n, 4);
		assert.equal(paired.baselinePct, 40);
		assert.equal(paired.productionPct, 90);
		assert.equal(paired.deltaPp, 50);
		assert.ok(paired.ci95HalfWidthPp > 0 && paired.ci95LowPp < paired.deltaPp && paired.ci95HighPp > paired.deltaPp);

		// 4. All curated evals/ JSON corpora parse cleanly & deterministic module-exam grader executes
		const files = [
			"evals/configs/default.json",
			"evals/tutoring/trilhaatlas-modes.json",
			"evals/planning/studentbench-trilhaatlas.json",
			"evals/grading/gold-rubric-cases.json",
			"evals/grounding-tools/sources-and-activities.json",
			"evals/memory/evalmem-cases.json",
			"evals/learning/retention-instruments.json",
		];
		for (const rel of files) {
			assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.resolve(rel), "utf8")), `Invalid JSON in ${rel}`);
		}
		const goldCases = (JSON.parse(fs.readFileSync(path.resolve("evals/grading/gold-rubric-cases.json"), "utf8")) as { cases: GoldGradingCase[] }).cases;
		assert.equal(goldCases.length, 14);
		const detRes = evaluateDeterministicModuleExamGrader(goldCases);
		assert.equal(detRes.summary.n, 14);
		assert.ok(detRes.summary.mae0to3 >= 0 && detRes.summary.mae0to3 <= 3);
	});
});
