import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
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
import { buildMissionPedagogyDirective, isAdvancedDefenseNode } from "../src/core/study/tutor-pedagogy.ts";
import type { LhViewMessage } from "../src/core/view.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-college-core-"));
process.env.LH_DATA_DIR = root;
process.env.LH_AUTH_FILE = path.join(root, "auth.json");

const { loadCurriculum, studyDomains, switchStudyDomain } = await import("../src/server/study.ts");

after(() => fs.rmSync(root, { recursive: true, force: true }));

describe("college-level pure core modules", () => {
	it("builds syllabus with 33% FSRS review reserve & p50–p80 schedule, plus transcript with durable vs immediate separation and cooling alerts", () => {
		switchStudyDomain("electronics");
		const manifest = studyDomains().readManifest("electronics")!;
		const cur = loadCurriculum("electronics", manifest)!;
		const day0 = "2026-09-01T12:00:00.000Z";
		const day2 = "2026-09-03T12:00:00.000Z";
		const day45 = "2026-10-16T12:00:00.000Z";

		const firstLeaf = cur.view.ids.find(id => cur.view.nodes.get(id)?.isLeaf && !cur.snapshot.items[id]?.reinforcementFor)!;
		const secondLeaf = cur.view.ids.find(id => id !== firstLeaf && cur.view.nodes.get(id)?.isLeaf && !cur.snapshot.items[id]?.reinforcementFor)!;

		const events: LearnerEvent[] = [
			{ kind: "exposure", id: "e1", seq: 1, at: day0, domainId: "electronics", sessionId: "s1", nodeId: firstLeaf, source: "ai_lesson", minutes: 25 },
			{
				kind: "evidence",
				evidence: {
					id: "ev1", seq: 2, at: day0, domainId: "electronics", sessionId: "s1",
					itemId: "i1", itemFamily: firstLeaf + "#teacher",
					nodes: [{ nodeId: firstLeaf, q: 1, primary: true }],
					format: "explain", level: 3, grade: 3, graderConfidence: 0.9, hints: 0, minutesSinceExposure: 15,
				},
			},
			// Delayed independent recall >= 24h later -> durable!
			{
				kind: "evidence",
				evidence: {
					id: "ev2", seq: 3, at: day2, domainId: "electronics", sessionId: "s2",
					itemId: "i2", itemFamily: firstLeaf + "#application",
					nodes: [{ nodeId: firstLeaf, q: 1, primary: true }],
					format: "short", level: 3, grade: 3, graderConfidence: 1, hints: 0, minutesSinceExposure: 2880,
				},
			},
			// Second leaf only has immediate exposure/check -> attained, NOT durable; decays by day 45 -> cooling alert!
			{ kind: "exposure", id: "e2", seq: 4, at: day0, domainId: "electronics", sessionId: "s3", nodeId: secondLeaf, source: "ai_lesson", minutes: 20 },
			{
				kind: "evidence",
				evidence: {
					id: "ev3", seq: 5, at: day0, domainId: "electronics", sessionId: "s3",
					itemId: "i3", itemFamily: secondLeaf + "#teacher",
					nodes: [{ nodeId: secondLeaf, q: 1, primary: true }],
					format: "explain", level: 3, grade: 2, graderConfidence: 0.8, hints: 1, minutesSinceExposure: 10,
				},
			},
		];

		const snap = foldEvents(null, events, cur.view, DEFAULT_LEARNER_PARAMS);
		const st = structuralState(snap, cur.view);
		const campaign = studyCampaign(cur.snapshot, cur.view, st.known);

		const syllabus = buildStudySyllabus({
			snapshot: cur.snapshot,
			graph: cur.view,
			learner: snap,
			campaign,
			known: st.known,
			available: new Set(st.frontier),
			at: day45,
			recentMinutes14d: 1200, // 10 h/week observed
			dailyBudgetMin: 120,
		});

		assert.ok(syllabus.chapters.length >= 4);
		assert.equal(syllabus.schedule.paceSource, "observed");
		assert.equal(syllabus.schedule.reviewReserveShare, 0.33);
		assert.ok(syllabus.schedule.weeksToFinishP80 > syllabus.schedule.weeksToFinish, "p80 horizon must exceed p50");
		assert.ok(syllabus.schedule.estimatedCompletionDateP80 >= syllabus.schedule.estimatedCompletionDate);

		const transcript = buildDomainTranscript({
			domainId: "electronics",
			domainTitle: manifest.title.pt,
			snapshot: cur.snapshot,
			graph: cur.view,
			learner: snap,
			campaign,
			known: st.known,
			at: day45,
		});
		assert.ok(transcript.attained >= 2);
		assert.ok(transcript.durable >= 1 && transcript.durable < transcript.attained, "durable learning (>=24h) stays strictly below raw immediate attainment");
		assert.ok(transcript.coolingAlerts.length >= 1, "decayed FSRS module triggers cooling alert by day 45");
	});

	it("runs interleaved module exams (no node leaks + FIRe credits) and gradual batch problem sets with 4-step lab script", () => {
		switchStudyDomain("electronics");
		const manifest = studyDomains().readManifest("electronics")!;
		const cur = loadCurriculum("electronics", manifest)!;
		const st = structuralState({ nodes: {} }, cur.view);
		const campaign = studyCampaign(cur.snapshot, cur.view, st.known);
		const syllabus = buildStudySyllabus({
			snapshot: cur.snapshot,
			graph: cur.view,
			learner: { schemaVersion: 1, domainId: "electronics", seq: 0, nodes: {}, theta: 0, thetaN: 0, speed: 1, updatedAt: "2026-10-01T00:00:00Z" },
			campaign,
			known: st.known,
			available: new Set(st.frontier),
			at: "2026-10-01T00:00:00Z",
			recentMinutes14d: 0,
			dailyBudgetMin: 120,
		});

		const mod = syllabus.chapters[0]!.modules[0]!;
		const leafIds = mod.lessons.map(l => l.id);
		const exam = buildModuleExam({
			domainId: "electronics",
			snapshot: cur.snapshot,
			graph: cur.view,
			scope: "module",
			targetId: mod.id,
			targetTitle: mod.title,
			leafIds,
			seed: "stress-seed-1",
		});

		assert.ok(exam.questions.length >= 3 && exam.questions.length <= 5);
		for (const q of exam.questions) {
			assert.ok(!q.prompt.includes(q.nodeId), "exam prompt must never leak internal nodeId");
			const title = cur.snapshot.items[q.nodeId]!.title.pt;
			assert.ok(!q.prompt.toLowerCase().includes(title.toLowerCase()), "interleaved exam prompt must hide topic title");
		}

		// Evasive answers must fail strictly.
		const badAnswers: Record<string, string> = {};
		for (const q of exam.questions) badAnswers[q.id] = "Já entendi tudo!";
		const badGrade = gradeModuleExam(exam, badAnswers, { domainId: "electronics", at: "2026-10-02T12:00:00Z", startSeq: 1, sessionId: "exam-bad" });
		assert.equal(badGrade.result.passed, false);
		assert.equal(badGrade.result.hasZeroQuestion, true);

		// Thorough answers covering expected terms pass and fold cleanly via ingestEvent.
		const goodAnswers: Record<string, string> = {};
		for (const q of exam.questions) {
			goodAnswers[q.id] = `Ao analisar o circuito neste caso, aplico os princípios de ${q.expectedTerms.join(", ")} verificando todas as unidades, sinais e condições físicas para justificar o resultado completo.`;
		}
		const goodGrade = gradeModuleExam(exam, goodAnswers, { domainId: "electronics", at: "2026-10-02T12:00:00Z", startSeq: 1, sessionId: "exam-good" });
		assert.equal(goodGrade.result.passed, true);
		assert.ok(goodGrade.result.score10 >= 7.5);
		assert.equal(goodGrade.events.length, exam.questions.length);

		let snap: LearnerSnapshot | null = null;
		for (const ev of goodGrade.events) {
			const ingested = ingestEvent(snap, ev, cur.view, DEFAULT_LEARNER_PARAMS);
			snap = ingested.snapshot;
		}
		assert.ok(snap !== null && snap.seq >= exam.questions.length);

		// Problem set + 4-step lab script for electronics.
		const set = buildProblemSet({
			domainId: "electronics",
			snapshot: cur.snapshot,
			graph: cur.view,
			moduleId: mod.id,
			moduleTitle: mod.title,
			leafIds,
			seed: "pset-1",
		});
		assert.ok(set.items.length >= 4 && set.items.length <= 6);
		assert.ok(set.lab && set.lab.steps.length === 4, "electronics module gets 4-step scientific lab script");
		const psAnswers: Record<string, string> = {};
		for (const itm of set.items) {
			psAnswers[itm.id] = `Resolvo aplicando ${itm.expectedTerms.join(", ")} passo a passo com verificação de unidade, ordem de grandeza e caso-limite físico.`;
		}
		const labNotes: Record<string, string> = {};
		for (const step of set.lab!.steps) {
			labNotes[step.id] = "Hipótese calculada com base na lei física, montagem verificada no simulador com medições consistentes e análise de erro relativo abaixo de dois por cento.";
		}
		const gradedSet = gradeProblemSet(set, psAnswers, labNotes, { domainId: "electronics", at: "2026-10-03T12:00:00Z", startSeq: 20 });
		assert.equal(gradedSet.result.passed, true);
		assert.equal(gradedSet.result.labResult?.passed, true);
	});

	it("runs adaptive KST placement with lossless serialization, notebook aggregation, flipped guides, and advanced defense mode", () => {
		switchStudyDomain("english");
		const manifest = studyDomains().readManifest("english")!;
		const cur = loadCurriculum("english", manifest)!;

		// Adaptive KST placement round-trip.
		let state = startPlacement(cur.view, "placement-seed-en");
		for (let i = 0; i < 9; i++) {
			const q = currentPlacementQuestion(cur.snapshot, cur.view, state);
			if (!q) break;
			// Simulate B1-level learner: knows first half of curriculum, misses upper half.
			const pos = cur.view.ids.indexOf(q.nodeId) / cur.view.ids.length;
			state = recordPlacementAnswer(state, cur.view, q.nodeId, pos < 0.45);
			state = deserializeDiagnostic(serializeDiagnostic(state));
		}
		const { summary, event } = summarizePlacement(cur.snapshot, cur.view, state, {
			id: "diag-1", seq: 1, at: "2026-10-05T12:00:00Z", domainId: "english",
		});
		assert.equal(event.kind, "diagnostic");
		assert.ok(summary.placedCount > 0 && summary.placedCount < summary.totalLeaves);
		assert.ok(summary.recommendedChapter);

		// Flipped classroom guide + compact prep formatting.
		const c1Finale = "en.academic.paper-critique.referee-review";
		const brief = nodeBrief(cur.snapshot, c1Finale)!;
		const guide = buildFlippedGuide(brief, [
			{ kind: "book", title: "Academic Writing Handbook", part: "Cap. 5", url: "https://example.org/book" },
			{ kind: "video", title: "Writing a Referee Report", part: "0:00–9:30", url: "https://youtube.com/watch?v=abc" },
		]);
		assert.equal(guide.questions.length, 3);
		const prep = formatFlippedPrepForLesson(guide, {
			answers: { mechanism: "Separar evidência empírica de afirmação especulativa." },
			doubt: "Como calibrar o tom crítico sem parecer agressivo?",
			completedMaterials: ["book"],
		});
		assert.ok(prep.length > 0 && prep.length <= 450);

		// Notebook captures mistakes + misconceptions + mastered concepts.
		const nbEvents: LearnerEvent[] = [
			event,
			{ kind: "lesson-finished", id: "fin-1", seq: 2, at: "2026-10-05T13:00:00Z", domainId: "english", nodeId: c1Finale, exposureId: "exp-1", assessedBy: "teacher", outcome: "reinforce", feedback: "Faltou justificar a limitação metodológica com evidência do resumo." },
		];
		const snap = foldEvents(null, nbEvents, cur.view, DEFAULT_LEARNER_PARAMS);
		const notebook = buildDomainNotebook({ domainId: "english", snapshot: cur.snapshot, graph: cur.view, learner: snap, events: nbEvents, at: "2026-10-05T14:00:00Z" });
		assert.ok(notebook.totalMistakes >= 1);

		// Advanced Defense Panel (Pilar 7) activates on C1/C2 and stays off on A1.
		assert.equal(isAdvancedDefenseNode(cur.snapshot.items[c1Finale]!, true), true);
		assert.equal(isAdvancedDefenseNode(cur.snapshot.items["en.speaking.a1.greetings"]!, false), false);
		const defenseMsgs: LhViewMessage[] = [
			{ role: "user", id: "u1", parts: [{ type: "text", text: "Iniciar." }] },
			{ role: "assistant", id: "a1", parts: [{ type: "text", text: "X".repeat(200) }] },
			{ role: "assistant", id: "e1", parts: [{ type: "tool-present_lesson_exam", toolCallId: "ex1", state: "output-available", output: { task: "Redija o parecer crítico." } }] },
			{ role: "user", id: "u2", examCallId: "ex1", parts: [{ type: "text", text: "The study claims causality from observational data without controlling confounders." }] },
		];
		const dir = buildMissionPedagogyDirective(defenseMsgs, {
			title: brief.title,
			objectives: brief.objectives,
			isAdvancedDefense: true,
			levelLabel: "C1",
		});
		assert.match(dir, /Banca Examinadora/i);
		assert.match(dir, /arguição crítica da banca/i);
	});
});
