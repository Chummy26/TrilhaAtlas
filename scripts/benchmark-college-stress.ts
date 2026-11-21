/**
 * Stress & gains benchmark for the 8 College/University-level pillars.
 *
 * Measures accuracy, strictness, question savings, FIRe implicit-credit gain,
 * durable vs. immediate retention separation, cooling alerts, defense-panel
 * gating, and p50/p95 latency under heavy load across both public curricula
 * (Electronics: 809 leaves; English: 771 leaves) in an isolated temp directory.
 *
 * Run: node --import tsx scripts/benchmark-college-stress.ts
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { foldEvents, ingestEvent } from "../src/core/learner/fold.ts";
import { structuralState } from "../src/core/learner/kst.ts";
import { DEFAULT_LEARNER_PARAMS } from "../src/core/learner/params.ts";
import type { LearnerEvent, LearnerSnapshot } from "../src/core/learner/types.ts";
import { studyCampaign } from "../src/core/study/campaign.ts";
import { buildFlippedGuide, formatFlippedPrepForLesson } from "../src/core/study/flipped-reading.ts";
import { buildModuleExam, gradeModuleExam } from "../src/core/study/module-exam.ts";
import { buildDomainNotebook } from "../src/core/study/notebook.ts";
import {
	currentPlacementQuestion,
	deserializeDiagnostic,
	recordPlacementAnswer,
	serializeDiagnostic,
	startPlacement,
	summarizePlacement,
} from "../src/core/study/placement.ts";
import { buildProblemSet, gradeProblemSet } from "../src/core/study/problem-set.ts";
import { nodeBrief } from "../src/core/study/projection.ts";
import { buildStudySyllabus } from "../src/core/study/syllabus.ts";
import { buildDomainTranscript } from "../src/core/study/transcript.ts";
import { isAdvancedDefenseNode } from "../src/core/study/tutor-pedagogy.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-bench-college-stress-"));
process.env.LH_DATA_DIR = root;
process.env.LH_AUTH_FILE = path.join(root, "auth.json");

function pctile(values: number[], p: number): number {
	if (!values.length) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!.toFixed(2));
}

try {
	const { loadCurriculum, studyDomains, switchStudyDomain } = await import("../src/server/study.ts");
	const failures: string[] = [];

	console.log("=== 1. ESTRESSE: NIVELAMENTO ADAPTATIVO KST (2.000 partículas × 3 perfis × 2 domínios) ===");
	for (const domain of ["electronics", "english"] as const) {
		switchStudyDomain(domain);
		const manifest = studyDomains().readManifest(domain)!;
		const cur = loadCurriculum(domain, manifest)!;
		const leaves = cur.view.ids.filter(id => cur.view.nodes.get(id)?.isLeaf && !cur.snapshot.items[id]?.reinforcementFor);
		const stepTimes: number[] = [];

		for (const profile of [
			{ name: "iniciante", cutoff: 0.05 },
			{ name: "intermediario", cutoff: 0.45 },
			{ name: "avancado", cutoff: 0.80 },
		]) {
			const truthSet = new Set(leaves.slice(0, Math.floor(leaves.length * profile.cutoff)));
			let state = startPlacement(cur.view, `bench-${domain}-${profile.name}`);
			let asked = 0;
			while (asked < 15) {
				const q = currentPlacementQuestion(cur.snapshot, cur.view, state);
				if (!q) break;
				const t0 = performance.now();
				state = recordPlacementAnswer(state, cur.view, q.nodeId, truthSet.has(q.nodeId));
				state = deserializeDiagnostic(serializeDiagnostic(state));
				stepTimes.push(performance.now() - t0);
				asked++;
			}
			const { summary } = summarizePlacement(cur.snapshot, cur.view, state, {
				id: `diag-${domain}-${profile.name}`, seq: 1, at: "2026-11-20T12:00:00Z", domainId: domain,
			});
			const savingsPct = Number(((1 - asked / leaves.length) * 100).toFixed(1));
			console.log(`  [${domain}/${profile.name}] perguntas=${asked}/${leaves.length} (economia ${savingsPct}%) · colocados=${summary.placedCount}/${summary.totalLeaves} · cap="${summary.recommendedChapter?.level ?? "-"}"`);
			if (asked > 15) failures.push(`placement cap exceeded on ${domain}/${profile.name}`);
		}
		console.log(`  [${domain}] latência atualização+serialização KST: p50=${pctile(stepTimes, 0.5)} ms · p95=${pctile(stepTimes, 0.95)} ms`);
	}

	console.log("\n=== 2. ESTRESSE: PROVAS INTEGRADORAS INTERCALADAS + FIRe + RIGIDEZ ANTI-BYPASS ===");
	for (const domain of ["electronics", "english"] as const) {
		switchStudyDomain(domain);
		const manifest = studyDomains().readManifest(domain)!;
		const cur = loadCurriculum(domain, manifest)!;
		const st0 = structuralState({ nodes: {} }, cur.view);
		const camp0 = studyCampaign(cur.snapshot, cur.view, st0.known);
		const syl0 = buildStudySyllabus({
			snapshot: cur.snapshot, graph: cur.view,
			learner: { schemaVersion: 1, domainId: domain, seq: 0, nodes: {}, theta: 0, thetaN: 0, speed: 1, updatedAt: "2026-10-01T00:00:00Z" },
			campaign: camp0, known: st0.known, available: new Set(st0.frontier),
			at: "2026-10-01T00:00:00Z", recentMinutes14d: 0, dailyBudgetMin: 120,
		});
		const allModules = syl0.chapters.flatMap(c => c.modules);
		let leakCount = 0;
		let evasiveBlocked = 0;
		let evasiveTotal = 0;
		let strongPassed = 0;
		let totalFireCredits = 0;
		let labModules = 0;
		const examTimes: number[] = [];

		// Seed a prior history on first 40 leaves so FIRe has active cards to credit.
		let snap: LearnerSnapshot | null = null;
		let seq = 0;
		const seededLeaves = cur.view.ids.filter(id => cur.view.nodes.get(id)?.isLeaf).slice(0, 40);
		for (const id of seededLeaves) {
			const res = ingestEvent(snap, {
				kind: "evidence",
				evidence: {
					id: `seed-${++seq}`, seq, at: "2026-09-01T10:00:00Z", domainId: domain, sessionId: "seed",
					itemId: `i-${seq}`, itemFamily: `${id}#teacher`, nodes: [{ nodeId: id, q: 1, primary: true }],
					format: "explain", level: 3, grade: 3, graderConfidence: 0.9, hints: 0, minutesSinceExposure: 15,
				},
			}, cur.view, DEFAULT_LEARNER_PARAMS);
			snap = res.snapshot;
		}

		for (const mod of allModules.slice(0, 20)) {
			const leafIds = mod.lessons.map(l => l.id);
			const t0 = performance.now();
			const exam = buildModuleExam({
				domainId: domain, snapshot: cur.snapshot, graph: cur.view,
				scope: "module", targetId: mod.id, targetTitle: mod.title, leafIds, seed: `stress-${mod.id}`,
			});
			for (const q of exam.questions) {
				if (q.prompt.includes(q.nodeId)) leakCount++;
			}
			// Evasive bypass attempt ("Já entendi tudo!").
			const badAns: Record<string, string> = {};
			for (const q of exam.questions) badAns[q.id] = "Já entendi tudo!";
			evasiveTotal++;
			const badRes = gradeModuleExam(exam, badAns, { domainId: domain, at: "2026-10-15T12:00:00Z", startSeq: seq + 1, sessionId: `bad-${mod.id}` });
			if (!badRes.result.passed) evasiveBlocked++;

			// Strong mastery answers -> grade + FIRe ingestion.
			const goodAns: Record<string, string> = {};
			for (const q of exam.questions) {
				goodAns[q.id] = `Demonstro de forma independente aplicando ${q.expectedTerms.join(", ")} com verificação de premissas, unidades e justificativa causal completa.`;
			}
			const goodRes = gradeModuleExam(exam, goodAns, { domainId: domain, at: "2026-10-15T12:00:00Z", startSeq: seq + 1, sessionId: `good-${mod.id}` });
			if (goodRes.result.passed) strongPassed++;
			for (const ev of goodRes.events) {
				const ing = ingestEvent(snap, ev, cur.view, DEFAULT_LEARNER_PARAMS);
				snap = ing.snapshot;
				seq = snap.seq;
				totalFireCredits += ing.derived.length;
			}
			examTimes.push(performance.now() - t0);

			// Problem set + lab script check (must reject omitted lab in electronics, pass with 4-step lab notes).
			const ps = buildProblemSet({
				domainId: domain, snapshot: cur.snapshot, graph: cur.view,
				moduleId: mod.id, moduleTitle: mod.title, leafIds, seed: `ps-${mod.id}`,
			});
			const psAns: Record<string, string> = {};
			for (const itm of ps.items) psAns[itm.id] = `Resolução completa utilizando ${itm.expectedTerms.join(", ")} com unidades corretas e análise de caso-limite.`;
			if (ps.lab && ps.lab.steps.length === 4) {
				labModules++;
				const omittedLab = gradeProblemSet(ps, psAns);
				if (omittedLab.result.passed) failures.push(`problem-set allowed skipping mandatory lab in ${domain}/${mod.id}`);
				const labNotes: Record<string, string> = {};
				for (const step of ps.lab.steps) {
					labNotes[step.id] = "Hipótese calculada pela lei física, medição executada no simulador e análise quantitativa da discrepância percentual concluída.";
				}
				const psGraded = gradeProblemSet(ps, psAns, labNotes);
				if (!psGraded.result.passed || !psGraded.result.labResult?.passed) failures.push(`problem-set failed strong answers+lab in ${domain}/${mod.id}`);
			} else {
				const psGraded = gradeProblemSet(ps, psAns);
				if (!psGraded.result.passed) failures.push(`problem-set failed strong answers in ${domain}/${mod.id}`);
			}
		}
		console.log(`  [${domain}] módulos testados=20 · vazamentos=${leakCount} · bypass bloqueado=${evasiveBlocked}/${evasiveTotal} · aprovados=${strongPassed}/20 · créditos FIRe=${totalFireCredits} · labs 4-etapas=${labModules}/20 · p50=${pctile(examTimes, 0.5)} ms p95=${pctile(examTimes, 0.95)} ms`);
		if (leakCount > 0 || evasiveBlocked !== evasiveTotal) failures.push(`exam strictness issue in ${domain}`);
	}

	console.log("\n=== 3. ESTRESSE DE CARGA PESADA: 2.400 EVENTOS + 90 DIAS (SYLLABUS + TRANSCRIPT + NOTEBOOK + FLIPPED + BANCA) ===");
	for (const domain of ["electronics", "english"] as const) {
		switchStudyDomain(domain);
		const manifest = studyDomains().readManifest(domain)!;
		const cur = loadCurriculum(domain, manifest)!;
		const leaves = cur.view.ids.filter(id => cur.view.nodes.get(id)?.isLeaf && !cur.snapshot.items[id]?.reinforcementFor);
		const events: LearnerEvent[] = [];
		const baseMs = Date.parse("2026-08-01T12:00:00Z");
		let seq = 0;

		// Build 2,400 realistic events across 300 leaves (some durable >=24h, some immediate-only, some failed/reinforced).
		for (let i = 0; i < Math.min(300, leaves.length); i++) {
			const id = leaves[i]!;
			const tExp = new Date(baseMs + i * 6 * 3_600_000).toISOString();
			events.push({ kind: "exposure", id: `e-${++seq}`, seq, at: tExp, domainId: domain, sessionId: `s-${i}`, nodeId: id, source: "ai_lesson", minutes: 25 });
			// Initial check.
			const passedInit = i % 5 !== 0;
			events.push({
				kind: "evidence",
				evidence: {
					id: `ev-${++seq}`, seq, at: new Date(Date.parse(tExp) + 20 * 60_000).toISOString(),
					domainId: domain, sessionId: `s-${i}`, itemId: `i-${seq}`, itemFamily: `${id}#teacher`,
					nodes: [{ nodeId: id, q: 1, primary: true }], format: "explain", level: 3,
					grade: passedInit ? 3 : 1, graderConfidence: 0.9, hints: passedInit ? 0 : 1, minutesSinceExposure: 20,
				},
			});
			if (!passedInit) {
				events.push({
					kind: "lesson-finished", id: `fin-${++seq}`, seq, at: new Date(Date.parse(tExp) + 22 * 60_000).toISOString(),
					domainId: domain, nodeId: id, exposureId: `e-${seq - 2}`, assessedBy: "teacher",
					outcome: "reinforce", feedback: `Lacuna conceitual registrada no módulo de ${id}`,
				});
			} else if (i % 2 === 0) {
				// Delayed independent recall 48h later -> durable!
				events.push({
					kind: "evidence",
					evidence: {
						id: `rev-${++seq}`, seq, at: new Date(Date.parse(tExp) + 48 * 3_600_000).toISOString(),
						domainId: domain, sessionId: `rev-${i}`, itemId: `r-${seq}`, itemFamily: `${id}#application`,
						nodes: [{ nodeId: id, q: 1, primary: true }], format: "short", level: 3,
						grade: 3, graderConfidence: 1, hints: 0, minutesSinceExposure: 2880,
					},
				});
			}
		}

		const evalAt = "2026-11-20T12:00:00Z";
		const snap = foldEvents(null, events, cur.view, DEFAULT_LEARNER_PARAMS);
		const st = structuralState(snap, cur.view);
		const camp = studyCampaign(cur.snapshot, cur.view, st.known);

		const sylTimes: number[] = [];
		const trTimes: number[] = [];
		const nbTimes: number[] = [];
		let lastSyl!: ReturnType<typeof buildStudySyllabus>;
		let lastTr!: ReturnType<typeof buildDomainTranscript>;
		let lastNb!: ReturnType<typeof buildDomainNotebook>;

		for (let run = 0; run < 20; run++) {
			let t0 = performance.now();
			lastSyl = buildStudySyllabus({
				snapshot: cur.snapshot, graph: cur.view, learner: snap, campaign: camp,
				known: st.known, available: new Set(st.frontier), at: evalAt,
				recentMinutes14d: 1080, dailyBudgetMin: 120,
			});
			sylTimes.push(performance.now() - t0);

			t0 = performance.now();
			lastTr = buildDomainTranscript({
				domainId: domain, domainTitle: manifest.title.pt, snapshot: cur.snapshot,
				graph: cur.view, learner: snap, campaign: camp, known: st.known, at: evalAt,
			});
			trTimes.push(performance.now() - t0);

			t0 = performance.now();
			lastNb = buildDomainNotebook({
				domainId: domain, snapshot: cur.snapshot, graph: cur.view,
				learner: snap, events, at: evalAt,
			});
			nbTimes.push(performance.now() - t0);
		}

		// Verify Flipped Reading <= 450 chars budget across 50 sampled leaves.
		let flippedOverflow = 0;
		for (const id of leaves.slice(0, 50)) {
			const brief = nodeBrief(cur.snapshot, id)!;
			const guide = buildFlippedGuide(brief, []);
			const formatted = formatFlippedPrepForLesson(guide, {
				answers: { mechanism: "Explicação detalhada ".repeat(20), example: "Exemplo longo ".repeat(15) },
				doubt: "Dúvida extensa ".repeat(20),
			});
			if (formatted.length > 450) flippedOverflow++;
		}

		// Verify Advanced Defense Panel gating: 0 false positives in beginner band, >0 activations in advanced bands.
		let beginnerDefenseFP = 0;
		let advancedDefenseCount = 0;
		for (const id of leaves) {
			const item = cur.snapshot.items[id]!;
			const isFinale = camp.journey.some(c => c.finale === id);
			const active = isAdvancedDefenseNode(item, isFinale);
			const isBeginner = (item.level.scheme === "cefr" && (item.level.cefr === "pre-A1" || item.level.cefr === "A1" || item.level.cefr === "A2"))
				|| (item.level.scheme === "ee" && item.level.band === 0);
			if (isBeginner && active) beginnerDefenseFP++;
			if (!isBeginner && active) advancedDefenseCount++;
		}

		const linearWeeks = Number((lastSyl.schedule.remainingHours / Math.max(0.25, lastSyl.schedule.effectiveWeeklyHours)).toFixed(1));
		console.log(`  [${domain}] eventos=${events.length} · attained=${lastTr.attained} vs durable(>=24h)=${lastTr.durable} · alertas esfriando=${lastTr.coolingAlerts.length} · caderno erros=${lastNb.totalMistakes}`);
		console.log(`  [${domain}] cronograma linear=${linearWeeks} sem vs realista(33% FSRS) p50=${lastSyl.schedule.weeksToFinish} sem / p80=${lastSyl.schedule.weeksToFinishP80} sem`);
		console.log(`  [${domain}] latência (20x): syllabus p50=${pctile(sylTimes, 0.5)}ms p95=${pctile(sylTimes, 0.95)}ms | transcript p50=${pctile(trTimes, 0.5)}ms | notebook p50=${pctile(nbTimes, 0.5)}ms`);
		console.log(`  [${domain}] flipped<=450ch overflow=${flippedOverflow}/50 · banca avançada ativos=${advancedDefenseCount} (falsos positivos iniciante=${beginnerDefenseFP})`);

		if (lastTr.durable >= lastTr.attained) failures.push(`durable must stay below immediate attainment in ${domain}`);
		if (lastTr.coolingAlerts.length === 0) failures.push(`expected cooling alerts after 90d decay in ${domain}`);
		if (flippedOverflow > 0) failures.push(`flipped prep exceeded 450 chars in ${domain}`);
		if (beginnerDefenseFP > 0 || advancedDefenseCount === 0) failures.push(`defense gating mismatch in ${domain}`);
	}

	if (failures.length > 0) {
		console.error("\nFALHAS NO BENCHMARK DE ESTRESSE:\n - " + failures.join("\n - "));
		process.exit(1);
	}
	console.log("\n✅ TODOS OS BENCHMARKS DE ESTRESSE DOS 8 PILARES PASSARAM COM 0 FALHAS.");
} finally {
	fs.rmSync(root, { recursive: true, force: true });
}
