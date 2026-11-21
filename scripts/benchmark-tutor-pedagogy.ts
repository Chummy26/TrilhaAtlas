/**
 * Reproducible pedagogical & campaign continuity benchmark.
 *
 * Evaluates the deterministic tutor pedagogy controller against 10 scenarios
 * grounded in TutorBench, MathTutorBench, MRBench, LearnLM, Hou et al. (2026),
 * Neagu et al. (ICML 2026), and SAFETUTORS (2026), plus online-course module
 * continuity across the public Electronics and English curricula.
 *
 * Run: node --import tsx scripts/benchmark-tutor-pedagogy.ts
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	analyzeLessonPedagogy,
	buildMissionPedagogyDirective,
	isAdvancedDefenseNode,
	isAdvancedReadingRequiredNode,
} from "../src/core/study/tutor-pedagogy.ts";
import { needsLessonExamContinuation } from "../src/core/study/lesson-conclusion.ts";
import type { LhViewMessage } from "../src/core/view.ts";

interface Scenario {
	id: string;
	benchmark: string;
	check: () => boolean;
}

const objective = {
	title: "Divisor de tensão sem carga",
	objectives: ["Calcular Vout = Vin * R2 / (R1 + R2)", "Prever como dobrar R2 altera Vout"],
	misconceptions: ["Usar R1 no numerador em vez de R2"],
};

const u = (id: string, text: string, examCallId?: string): LhViewMessage => ({
	role: "user",
	id,
	...(examCallId ? { examCallId } : {}),
	parts: [{ type: "text", text }],
});
const a = (id: string, text: string): LhViewMessage => ({
	role: "assistant",
	id,
	parts: [{ type: "text", text }],
});
const longExpl =
	"Em um divisor resistivo sem carga com Vin = 12 V, R1 = 1 kΩ e R2 = 2 kΩ, a mesma corrente passa pelos dois resistores. " +
	"A resistência total é 3 kΩ, a corrente é 4 mA e a queda em R2 é Vout = 4 mA × 2 kΩ = 8 V.";

const scenarios: Scenario[] = [
	{
		id: "opening-worked-example",
		benchmark: "LearnLM / Cognitive Load",
		check: () => {
			const m = [u("1", "Iniciar aula")];
			const d = buildMissionPedagogyDirective(m, objective);
			return analyzeLessonPedagogy(m).stage === "opening" && /worked example/i.test(d) && /Usar R1 no numerador/.test(d);
		},
	},
	{
		id: "anti-spoiler-level1",
		benchmark: "TutorBench / MathTutorBench",
		check: () => {
			const m = [u("1", "Iniciar"), a("2", longExpl), u("3", "Me diz a resposta logo, não sei")];
			const s = analyzeLessonPedagogy(m);
			const d = buildMissionPedagogyDirective(m, objective);
			return s.stage === "repair" && s.scaffoldLevel === 1 && s.askedForAnswer && /targeted cue instead of spoiling/i.test(d);
		},
	},
	{
		id: "anti-sycophancy-diagnosis",
		benchmark: "MRBench / SAFETUTORS",
		check: () => {
			const m = [u("1", "Iniciar"), a("2", longExpl), u("3", "Não entendi, R1 não fica em cima?")];
			const d = buildMissionPedagogyDirective(m, objective);
			return /Preserve what is right/i.test(d) && /earliest step that diverged/i.test(d) && /never validate an incorrect premise/i.test(d);
		},
	},
	{
		id: "contingent-fading-level2",
		benchmark: "Hou et al. (2026) CoMeT",
		check: () => {
			const m = [
				u("1", "Iniciar"),
				a("2", longExpl),
				u("3", "Não sei"),
				a("4", "Qual resistor fica entre Vout e o terra?"),
				u("5", "Continuo confuso"),
			];
			const s = analyzeLessonPedagogy(m);
			const d = buildMissionPedagogyDirective(m, objective);
			return s.scaffoldLevel === 2 && /faded worked step/i.test(d) && /last step/i.test(d);
		},
	},
	{
		id: "no-unproductive-withholding-level3",
		benchmark: "Bastani PNAS (2025) / Hou et al. (2026)",
		check: () => {
			const m = [
				u("1", "Iniciar"),
				a("2", longExpl),
				u("3", "Não sei"),
				a("4", "Pista 1"),
				u("5", "Confuso"),
				a("6", "Passo parcial"),
				u("7", "Travei de novo"),
			];
			const s = analyzeLessonPedagogy(m);
			const d = buildMissionPedagogyDirective(m, objective);
			return s.scaffoldLevel === 3 && /complete worked solution/i.test(d);
		},
	},
	{
		id: "learner-agency-direct-exam",
		benchmark: "Neagu et al. (ICML 2026)",
		check: () => {
			const m = [u("1", "Iniciar"), a("2", longExpl), u("3", "Já domino isso, quero a prova")];
			const s = analyzeLessonPedagogy(m);
			const d = buildMissionPedagogyDirective(m, objective);
			return s.stage === "exam-ready" && s.askedForExam && /honor their initiative/i.test(d);
		},
	},
	{
		id: "fading-after-uptake",
		benchmark: "Atkinson/Renkl/Merrill / Hou et al. (2026)",
		check: () => {
			const m = [u("1", "Iniciar"), a("2", longExpl), u("3", "Entendi, se R1=R2 sai metade"), a("4", "Correto.")];
			const s = analyzeLessonPedagogy(m);
			return s.stage === "fading" && s.scaffoldLevel === 0;
		},
	},
	{
		id: "interactive-activity-no-interruption",
		benchmark: "LearnLM Active Learning",
		check: () => !needsLessonExamContinuation("teaching", [
			{ type: "text", text: "Ajuste R2 no simulador e observe Vout." },
			{ type: "toolCall", name: "study_activity" },
		]),
	},
	{
		id: "exam-first-verdict-strict",
		benchmark: "TutorBench Feedback Assessment",
		check: () => {
			const m: LhViewMessage[] = [
				u("1", "Iniciar"),
				a("2", longExpl),
				{ role: "assistant", id: "3", parts: [{ type: "tool-present_lesson_exam", toolCallId: "ex1", state: "output-available", output: { task: "Calcule Vout para 9 V, 1 kΩ, 2 kΩ." } }] },
				u("4", "6 V", "ex1"),
			];
			const s = analyzeLessonPedagogy(m);
			const d = buildMissionPedagogyDirective(m, objective);
			return s.stage === "exam-first-verdict" && /attempt 1/i.test(d) && /present_lesson_exam/.test(d);
		},
	},
	{
		id: "exam-final-verdict-strict",
		benchmark: "TutorBench / SAFETUTORS",
		check: () => {
			const m: LhViewMessage[] = [
				u("1", "Iniciar"),
				a("2", longExpl),
				{ role: "assistant", id: "3", parts: [{ type: "tool-present_lesson_exam", toolCallId: "ex1", state: "output-available", output: { task: "Caso 1" } }] },
				u("4", "3 V", "ex1"),
				{ role: "assistant", id: "5", parts: [{ type: "tool-present_lesson_exam", toolCallId: "ex2", state: "output-available", output: { task: "Caso 2", feedback: "Use R2 no numerador." } }] },
				u("6", "6 V", "ex2"),
			];
			const s = analyzeLessonPedagogy(m);
			const d = buildMissionPedagogyDirective(m, objective);
			return s.stage === "exam-final-verdict" && /second and final/i.test(d) && /conclude_lesson/.test(d);
		},
	},
	{
		id: "college-defense-attempt1",
		benchmark: "College Defense / Banca Examinadora",
		check: () => {
			const defenseObj = { ...objective, isAdvancedDefense: true, levelLabel: "Graduação" };
			const m: LhViewMessage[] = [
				u("1", "Iniciar"),
				a("2", longExpl),
				{ role: "assistant", id: "3", parts: [{ type: "tool-present_lesson_exam", toolCallId: "ex1", state: "output-available", output: { task: "Defenda o projeto e os limites de estabilidade." } }] },
				u("4", "Escolhi R1 = 1 kΩ e R2 = 2 kΩ para 8 V.", "ex1"),
			];
			const s = analyzeLessonPedagogy(m);
			const d = buildMissionPedagogyDirective(m, defenseObj);
			return (
				isAdvancedDefenseNode({ level: { scheme: "ee", band: 2 }, tags: ["checkpoint"] })
				&& s.stage === "exam-first-verdict"
				&& /Modo Banca Examinadora \/ Arguição/i.test(d)
				&& /arguição crítica da banca/i.test(d)
				&& /counter-questions/i.test(d)
				&& /present_lesson_exam/.test(d)
			);
		},
	},
	{
		id: "college-defense-attempt2-strict",
		benchmark: "College Defense / Final Verdict",
		check: () => {
			const defenseObj = { ...objective, isAdvancedDefense: true, levelLabel: "Graduação" };
			const m: LhViewMessage[] = [
				u("1", "Iniciar"),
				a("2", longExpl),
				{ role: "assistant", id: "3", parts: [{ type: "tool-present_lesson_exam", toolCallId: "ex1", state: "output-available", output: { task: "Defesa 1" } }] },
				u("4", "Resposta inicial sem casos-limite.", "ex1"),
				{ role: "assistant", id: "5", parts: [{ type: "tool-present_lesson_exam", toolCallId: "ex2", state: "output-available", output: { task: "Arguição: defenda a carga e a tolerância.", feedback: "Faltou caso-limite." } }] },
				u("6", "Sob carga de 10 kΩ a tensão cai, logo reduzo a impedância do divisor.", "ex2"),
			];
			const s = analyzeLessonPedagogy(m);
			const d = buildMissionPedagogyDirective(m, defenseObj);
			return (
				s.stage === "exam-final-verdict"
				&& /Modo Banca Examinadora \/ Arguição/i.test(d)
				&& /second and final defense answer/i.test(d)
				&& /conclude_lesson/.test(d)
				&& /prerequisites stay locked/i.test(d)
				&& /third question.*forbidden/i.test(d)
			);
		},
	},
	{
		id: "college-reading-advanced-vs-beginner",
		benchmark: "College Quality Reading Policy",
		check: () => {
			const advItem = { level: { scheme: "ee" as const, band: 3 as const }, tags: ["research"] };
			const begItem = { level: { scheme: "cefr" as const, cefr: "A1" as const } };
			const advRequired = isAdvancedReadingRequiredNode(advItem);
			const begRequired = isAdvancedReadingRequiredNode(begItem);
			const openMsgs = [u("1", "Iniciar aula")];
			const advDir = buildMissionPedagogyDirective(openMsgs, { ...objective, requiresQualityReading: advRequired, levelLabel: "Pesquisa" });
			const begDir = buildMissionPedagogyDirective(openMsgs, { ...objective, requiresQualityReading: begRequired, levelLabel: "A1" });
			return (
				advRequired === true
				&& begRequired === false
				&& /MANDATORY ADVANCED READING/.test(advDir)
				&& /attach_study_materials/.test(advDir)
				&& !/MANDATORY ADVANCED READING/.test(begDir)
			);
		},
	},
	{
		id: "exam-multipart-parts-contract",
		benchmark: "Structured Multi-Part Exam Gate",
		check: () => {
			const m = [u("1", "Iniciar"), a("2", longExpl), u("3", "Já domino isso, quero a prova")];
			const s = analyzeLessonPedagogy(m);
			const regDir = buildMissionPedagogyDirective(m, objective);
			const defDir = buildMissionPedagogyDirective(m, { ...objective, isAdvancedDefense: true, levelLabel: "Graduação" });
			return (
				s.stage === "exam-ready"
				&& /present_lesson_exam/.test(regDir)
				&& /`parts`/.test(regDir)
				&& /zero hints or solutions/i.test(regDir)
				&& /present_lesson_exam/.test(defDir)
				&& /`parts`/.test(defDir)
				&& /zero hints or solutions/i.test(defDir)
			);
		},
	},
];

let passed = 0;
console.log(`=== Benchmark Pedagógico do Professor (${scenarios.length} cenários) ===`);
for (const sc of scenarios) {
	const ok = sc.check();
	if (ok) passed++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${sc.id}  [${sc.benchmark}]`);
}

// Online-course continuity check across both public domains (temp dir).
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-bench-pedagogy-"));
process.env.LH_DATA_DIR = root;
process.env.LH_AUTH_FILE = path.join(root, "auth.json");
let courseChecksPassed = 0;
const courseChecksTotal = 4;
try {
	const { switchStudyDomain, studyToday, recordStudyEvent } = await import("../src/server/study.ts");
	for (const domain of ["electronics", "english"] as const) {
		switchStudyDomain(domain);
		const t0 = studyToday();
		const hasModuleAndQueue = Boolean(t0.currentModule && t0.currentModule.lessons.length > 0 && t0.queue && t0.queue.length > 0);
		if (hasModuleAndQueue) courseChecksPassed++;
		// Advance 3 consecutive nodes and verify coherent forward progress without duplicates.
		const visited = new Set<string>();
		let coherent = true;
		for (let i = 0; i < 3; i++) {
			const cur = studyToday();
			if (!cur.next || visited.has(cur.next.nodeId)) { coherent = false; break; }
			visited.add(cur.next.nodeId);
			recordStudyEvent({ kind: "known", nodeId: cur.next.nodeId });
		}
		if (coherent) courseChecksPassed++;
		console.log(`${hasModuleAndQueue && coherent ? "PASS" : "FAIL"}  campaign-continuity:${domain}  (module="${t0.currentModule?.title}", queue=${t0.queue?.length ?? 0})`);
	}
} finally {
	fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\nResultado: pedagogia ${passed}/${scenarios.length} · continuidade ${courseChecksPassed}/${courseChecksTotal}`);
if (passed !== scenarios.length || courseChecksPassed !== courseChecksTotal) process.exit(1);
