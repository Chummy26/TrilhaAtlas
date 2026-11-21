import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { subscribe } from "../src/core/events.ts";
import { buildModuleExam } from "../src/core/study/module-exam.ts";
import { buildProblemSet } from "../src/core/study/problem-set.ts";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "lh-campaign-continuity-e2e-"));
process.env.LH_DATA_DIR = sandbox;
process.env.LH_AUTH_FILE = path.join(sandbox, "auth.json");
delete process.env.YOUTUBE_API_KEY;

const { POST: createChatRoute } = await import("../app/api/chats/route.ts");
const { POST: flippedRoute } = await import("../app/api/study/flipped/route.ts");
const { POST: placementRoute } = await import("../app/api/study/placement/route.ts");
const { POST: problemSetRoute } = await import("../app/api/study/problem-set/route.ts");
const { POST: moduleExamRoute } = await import("../app/api/study/module-exam/route.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { appendStudyEvent, nextStudySeq, readStudyEvents } = await import("../src/server/study-log.ts");
const {
	readModuleScoreMap,
	readProblemSetScoreMap,
	studySyllabus,
} = await import("../src/server/course.ts");
const { studyMapLesson } = await import("../src/server/study-materials.ts");
const {
	finishStudyLesson,
	lessonCompletionState,
	loadCurriculum,
	studyDomains,
	studyToday,
	switchStudyDomain,
} = await import("../src/server/study.ts");

after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

async function openLessonViaApi(domainId: string, nodeId: string, statement = "Campaign lesson.", minutes = 20) {
	const res = await createChatRoute(new Request("http://local/api/chats", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			title: `Lesson ${nodeId}`,
			studyLesson: { domainId, minutes },
			graphContext: { propositions: [{ id: nodeId, name: nodeId, statement }] },
		}),
	}));
	assert.equal(res.status, 200);
	return (await res.json()) as { id: string; title: string };
}

describe("end-to-end college campaign continuity flow", () => {
	it("places an advanced English learner above A1 and preserves completed nodes on re-placement", async () => {
		switchStudyDomain("english");
		const manifest = studyDomains().readManifest("english")!;
		const cur = loadCurriculum("english", manifest)!;
		const cefrOrder = ["pre-A1", "A1", "A2", "B1", "B2", "C1", "C2"];

		const emitted: { type: string; domainId?: string | null }[] = [];
		const unsub = subscribe((ev) => {
			if (ev.type === "curriculum-expanded") {
				emitted.push({ type: ev.type, domainId: ev.domainId });
			}
		});

		try {
			const startRes = await placementRoute(new Request("http://local/api/study/placement", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "start", seed: "e2e-english-adv-seed" }),
			}));
			assert.equal(startRes.status, 200);
			let status = (await startRes.json()) as {
				active: boolean;
				question: { nodeId: string } | null;
			};
			assert.equal(status.active, true);
			assert.ok(status.question);

			let summary: {
				placedCount: number;
				totalLeaves: number;
				recommendedChapter?: { level: string; title: string };
				recommendedNodeId?: string;
			} | undefined;

			// Simulate a B2-level learner: knows all A1..B2 skills, misses C1..C2.
			for (let step = 0; step < 15 && status.question; step++) {
				const item = cur.snapshot.items[status.question.nodeId]!;
				const knows = item.level.scheme === "cefr" && cefrOrder.indexOf(item.level.cefr) <= cefrOrder.indexOf("B2");
				const ansRes = await placementRoute(new Request("http://local/api/study/placement", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ action: "answer", nodeId: status.question.nodeId, correct: knows }),
				}));
				assert.equal(ansRes.status, 200);
				const payload = (await ansRes.json()) as
					| { finished: true; summary: typeof summary }
					| { finished: false; question: { nodeId: string } };
				if (payload.finished) {
					summary = payload.summary;
					break;
				}
				status = { active: true, question: payload.question };
			}

			assert.ok(summary, "placement should finish within 15 questions");
			assert.ok(summary!.placedCount > 100, `expected >100 placed skills, got ${summary!.placedCount}`);
			assert.notEqual(
				summary!.recommendedChapter?.level,
				"A1",
				`advanced English learner must NOT be placed back in A1 (got ${summary!.recommendedChapter?.level})`,
			);
			assert.ok(
				emitted.some((e) => e.domainId === "english"),
				"finalizing placement emits live refresh event",
			);

			// Complete the recommended node explicitly, then re-run placement answering false everywhere:
			// existing verified progress MUST be preserved and never recommended again.
			const completedNodeId = summary!.recommendedNodeId!;
			const chat = await openLessonViaApi("english", completedNodeId);
			finishStudyLesson("english", chat.id, 3);

			const restartRes = await placementRoute(new Request("http://local/api/study/placement", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "start", seed: "e2e-english-rerun-seed" }),
			}));
			let rerunStatus = (await restartRes.json()) as { question: { nodeId: string } | null };
			for (let i = 0; i < 4 && rerunStatus.question; i++) {
				const ansRes = await placementRoute(new Request("http://local/api/study/placement", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ action: "answer", nodeId: rerunStatus.question.nodeId, correct: false }),
				}));
				const payload = (await ansRes.json()) as { finished: boolean; question?: { nodeId: string } };
				if (payload.finished) break;
				rerunStatus = { question: payload.question ?? null };
			}
			const finishRes = await placementRoute(new Request("http://local/api/study/placement", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "finish" }),
			}));
			assert.equal(finishRes.status, 200);
			const rerunResult = (await finishRes.json()) as {
				finished: true;
				summary: { recommendedNodeId?: string; frontierNodeIds: string[] };
			};
			assert.notEqual(
				rerunResult.summary.recommendedNodeId,
				completedNodeId,
				"re-running placement must never recommend an already-completed node",
			);
			assert.ok(
				!rerunResult.summary.frontierNodeIds.includes(completedNodeId),
				"already-completed node stays excluded from post-placement frontier",
			);
		} finally {
			unsub();
		}
	});

	it("runs pre-reading auto-attach, lesson completion receipts, session routing, problem-set FIRe ingestion, module/chapter exams, and FSRS pacing alerts", async () => {
		switchStudyDomain("electronics");
		const manifest = studyDomains().readManifest("electronics")!;
		const cur = loadCurriculum("electronics", manifest)!;

		const liveEvents: { domainId: string; nodeId: string }[] = [];
		const unsub = subscribe((ev) => {
			if (ev.type === "curriculum-expanded") {
				liveEvents.push({ domainId: ev.domainId, nodeId: ev.nodeId });
			}
		});

		try {
			const initialToday = studyToday();
			const initialSyllabus = studySyllabus("electronics");
			assert.equal(initialToday.ready, true);
			assert.ok(initialToday.next, "fresh domain has a next campaign lesson");
			assert.ok(initialToday.pacing, "StudyToday exposes college pacing");
			assert.ok(initialToday.pacing!.plannedWeeklyHours > 0);
			assert.ok(initialToday.pacing!.effectiveWeeklyHours > 0);
			assert.equal(initialToday.dueReviewsCount, 0);
			assert.equal(initialToday.urgentReview, null);
			assert.equal(initialToday.coolingAlert, null);
			assert.equal(initialToday.next!.hasPrepNote, false);
			assert.ok(initialToday.next!.prepHref?.startsWith("/ementa?dominio=electronics&modulo="));
			assert.ok(initialToday.moduleAssessment, "StudyToday exposes active module assessment state");
			assert.equal(initialToday.moduleAssessment!.examPassed, false);
			assert.equal(initialToday.moduleAssessment!.problemSetPassed, false);
			assert.equal(
				initialToday.progress.totalHours,
				Math.round(initialSyllabus.totalHours * 10) / 10,
				"StudyToday progress hours align with studySyllabus guided-session estimates",
			);

			const firstModule = initialSyllabus.chapters[0]!.modules[0]!;
			const firstNodeId = initialToday.next!.nodeId;

			// 1. Save Flipped Pre-reading note via API route.
			const prepRes = await flippedRoute(new Request("http://local/api/study/flipped", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					nodeId: firstNodeId,
					note: {
						answers: {
							mechanism: "Expoentes negativos representam potências inversas de dez.",
							example: "1 mA corresponde a 10^-3 A no circuito.",
						},
						doubt: "Quando prefiro notação de engenharia em vez de científica?",
						completedMaterials: ["book"],
					},
				}),
			}));
			assert.equal(prepRes.status, 200);
			assert.equal(studyToday().next?.hasPrepNote, true, "StudyToday reflects saved pre-reading note");

			// 2. Create lesson chat via POST /api/chats WITHOUT passing the note manually -> auto-attached!
			const firstChat = await openLessonViaApi("electronics", firstNodeId, "Lesson opening context.");
			const savedChat = chatStore.getChat(firstChat.id);
			assert.ok(savedChat, "chat persisted on disk");
			const marker = savedChat!.messages[0]!;
			assert.equal(marker.role, "custom");
			const statement = ((marker.details as { propositions?: { statement?: string }[] })?.propositions?.[0]?.statement) ?? "";
			assert.ok(statement.includes("[Flipped pre-reading notes]"), "POST /api/chats auto-attaches saved pre-reading notes");
			assert.ok(statement.includes("notação de engenharia"), "saved doubt appears inside lesson context");
			assert.ok(!statement.includes("; ensine em pt-BR."), "POST /api/chats stays language-neutral");

			// 3. Before completing the lesson, studyMapLesson points sessionId/activeSessionId to the open chat.
			const mapBeforeFinish = await studyMapLesson("electronics", firstNodeId);
			assert.equal(mapBeforeFinish.sessionId, firstChat.id);
			assert.equal(mapBeforeFinish.activeSessionId, firstChat.id);
			assert.equal(mapBeforeFinish.completedSessionId, undefined);

			// 4. Complete the lesson and verify enriched LessonReceipt + LessonFinishState + session routing separation.
			const firstReceipt = finishStudyLesson("electronics", firstChat.id, 3);
			assert.ok(firstReceipt.after > firstReceipt.before);
			assert.equal(firstReceipt.chapterId, initialSyllabus.chapters[0]!.level);
			assert.equal(typeof firstReceipt.moduleExamUnlocked, "boolean");
			assert.equal(typeof firstReceipt.chapterExamUnlocked, "boolean");
			assert.equal(firstReceipt.problemSetPassed, false);
			assert.equal(firstReceipt.dueReviewCount, 0);
			assert.ok(firstReceipt.prepHref?.startsWith("/ementa?dominio=electronics&modulo="));
			assert.ok(
				liveEvents.some((e) => e.domainId === "electronics" && e.nodeId === firstNodeId),
				"finishStudyLesson emits live update event",
			);

			const reloadState = lessonCompletionState("electronics", firstChat.id);
			assert.equal(reloadState?.completed, true);
			assert.equal(reloadState?.chapterId, initialSyllabus.chapters[0]!.level);
			assert.equal(reloadState?.problemSetPassed, false);
			assert.ok(reloadState?.prepHref?.startsWith("/ementa?dominio=electronics&modulo="));

			// Clicking a completed lesson MUST NOT trap the learner in the closed chat.
			const mapAfterFinish = await studyMapLesson("electronics", firstNodeId);
			assert.equal(mapAfterFinish.sessionId, undefined, "completed lesson clears active sessionId");
			assert.equal(mapAfterFinish.activeSessionId, undefined);
			assert.equal(mapAfterFinish.completedSessionId, firstChat.id, "completed lesson remains reachable via completedSessionId");

			// 5. Complete remaining lessons in the first module so the module exam unlocks.
			let lastModuleChatId = firstChat.id;
			for (const lesson of firstModule.lessons) {
				if (lesson.id === firstNodeId) continue;
				const chat = await openLessonViaApi("electronics", lesson.id, "Module lesson.", lesson.minutes);
				lastModuleChatId = chat.id;
				finishStudyLesson("electronics", chat.id, 3);
			}
			const afterModuleReceiptState = lessonCompletionState("electronics", lastModuleChatId);
			assert.equal(afterModuleReceiptState?.moduleExamUnlocked, true);

			// 6. Submit Module Problem Set (+ 4-step lab notes) via POST /api/study/problem-set.
			const psSeed = "e2e-pset-seed";
			const psLeafIds = firstModule.lessons.map((l) => l.id);
			const expectedPs = buildProblemSet({
				domainId: "electronics",
				snapshot: cur.snapshot,
				graph: cur.view,
				moduleId: firstModule.id,
				moduleTitle: firstModule.title,
				leafIds: psLeafIds,
				seed: psSeed,
			});
			const psAnswers: Record<string, string> = {};
			for (const item of expectedPs.items) {
				psAnswers[item.id] = `Resolvo aplicando ${item.expectedTerms.join(", ")} com verificação de unidades, ordem de grandeza e caso-limite completo.`;
			}
			const labNotes: Record<string, string> = {};
			for (const step of expectedPs.lab?.steps ?? []) {
				labNotes[step.id] = "Hipótese calculada pela lei física, medição feita no simulador e discrepância percentual verificada abaixo do limite.";
			}
			const eventsBeforePs = readStudyEvents("electronics").length;
			const psRes = await problemSetRoute(new Request("http://local/api/study/problem-set", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ moduleId: firstModule.id, answers: psAnswers, labNotes, seed: psSeed }),
			}));
			assert.equal(psRes.status, 200);
			const psPayload = (await psRes.json()) as { passed: boolean; score10: number; fireCreditsCount: number };
			assert.equal(psPayload.passed, true);
			assert.equal(typeof psPayload.fireCreditsCount, "number");
			assert.ok(readStudyEvents("electronics").length > eventsBeforePs, "problem set ingested evidence events");

			const psMap = readProblemSetScoreMap("electronics");
			assert.equal(psMap.get(firstModule.id)?.passed, true);
			assert.ok((psMap.get(firstModule.id)?.score ?? 0) >= 7);

			const sylAfterPs = studySyllabus("electronics");
			const modAfterPs = sylAfterPs.chapters[0]!.modules[0]!;
			assert.equal(modAfterPs.problemSetPassed, true);
			assert.ok((modAfterPs.problemSetScore ?? 0) >= 7);
			assert.ok(modAfterPs.problemSetAt);
			assert.equal(lessonCompletionState("electronics", lastModuleChatId)?.problemSetPassed, true);

			// 7. Submit Module Integrative Exam via POST /api/study/module-exam (scope: "module").
			const modExamSeed = "e2e-mod-exam-seed";
			const expectedModExam = buildModuleExam({
				domainId: "electronics",
				snapshot: cur.snapshot,
				graph: cur.view,
				scope: "module",
				targetId: firstModule.id,
				targetTitle: firstModule.title,
				leafIds: psLeafIds,
				seed: modExamSeed,
			});
			const modExamAnswers: Record<string, string> = {};
			for (const q of expectedModExam.questions) {
				modExamAnswers[q.id] = `Demonstro de forma independente usando ${q.expectedTerms.join(", ")} com verificação física, unidades e justificativa completa.`;
			}
			const modExamRes = await moduleExamRoute(new Request("http://local/api/study/module-exam", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ scope: "module", targetId: firstModule.id, answers: modExamAnswers, seed: modExamSeed }),
			}));
			assert.equal(modExamRes.status, 200);
			const modExamPayload = (await modExamRes.json()) as { passed: boolean; score10: number };
			assert.equal(modExamPayload.passed, true);

			const sylAfterModExam = studySyllabus("electronics");
			assert.equal(sylAfterModExam.chapters[0]!.modules[0]!.examPassed, true);
			assert.equal(sylAfterModExam.chapters[0]!.modules[0]!.examScore, modExamPayload.score10);
			assert.equal(lessonCompletionState("electronics", lastModuleChatId)?.moduleExamPassed, true);
			assert.equal(lessonCompletionState("electronics", lastModuleChatId)?.moduleExamScore, modExamPayload.score10);

			// 8. Unlock & Submit Chapter Integrative Exam (scope: "chapter") and verify SyllabusChapter updates.
			const firstChapter = sylAfterModExam.chapters[0]!;
			const chapterLeafIds = firstChapter.modules.flatMap((m) => m.lessons.map((l) => l.id));
			const unlockCount = Math.ceil(chapterLeafIds.length * 0.75);
			const existingEvs = readStudyEvents("electronics");
			let seq = nextStudySeq(existingEvs);
			// Mark >=75% of chapter skills placed/attained so chapter exam unlocks cleanly.
			appendStudyEvent("electronics", {
				kind: "diagnostic",
				id: "e2e-chapter-unlock",
				seq: seq++,
				at: new Date().toISOString(),
				domainId: "electronics",
				estimates: chapterLeafIds.slice(0, unlockCount).map((nodeId) => ({ nodeId, p: 0.95 })),
			});
			const sylUnlockedChapter = studySyllabus("electronics");
			assert.equal(sylUnlockedChapter.chapters[0]!.examUnlocked, true, "chapter exam unlocks at >=70% chapter progress");

			const chExamSeed = "e2e-chapter-exam-seed";
			const expectedChExam = buildModuleExam({
				domainId: "electronics",
				snapshot: cur.snapshot,
				graph: cur.view,
				scope: "chapter",
				targetId: firstChapter.level,
				targetTitle: firstChapter.title,
				leafIds: chapterLeafIds,
				seed: chExamSeed,
			});
			const chExamAnswers: Record<string, string> = {};
			for (const q of expectedChExam.questions) {
				chExamAnswers[q.id] = `Resolvo integrando ${q.expectedTerms.join(", ")} com análise dimensional, justificativa causal e validação dos limites.`;
			}
			const chExamRes = await moduleExamRoute(new Request("http://local/api/study/module-exam", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ scope: "chapter", targetId: firstChapter.level, answers: chExamAnswers, seed: chExamSeed }),
			}));
			assert.equal(chExamRes.status, 200);
			const chExamPayload = (await chExamRes.json()) as { passed: boolean; score10: number };
			assert.equal(chExamPayload.passed, true);

			assert.equal(readModuleScoreMap("electronics").get(firstChapter.level)?.passed, true);
			const sylAfterChExam = studySyllabus("electronics");
			assert.equal(sylAfterChExam.chapters[0]!.examPassed, true);
			assert.equal(sylAfterChExam.chapters[0]!.examScore, chExamPayload.score10);
			assert.ok(sylAfterChExam.chapters[0]!.examAt);
			assert.equal(lessonCompletionState("electronics", lastModuleChatId)?.chapterExamPassed, true);
			assert.equal(lessonCompletionState("electronics", lastModuleChatId)?.chapterExamScore, chExamPayload.score10);

			// 9. Seed an aged FSRS card (45 days old) on a leaf to verify dueReviewsCount, urgentReview & coolingAlert in studyToday().
			const coolingNodeId = chapterLeafIds[chapterLeafIds.length - 1]!;
			const agedAt = new Date(Date.now() - 45 * 86_400_000).toISOString();
			const freshSeq = nextStudySeq(readStudyEvents("electronics"));
			appendStudyEvent("electronics", {
				kind: "evidence",
				evidence: {
					id: "e2e-aged-fsrs",
					seq: freshSeq,
					at: agedAt,
					domainId: "electronics",
					sessionId: "e2e-aged",
					itemId: "aged-item",
					itemFamily: `${coolingNodeId}#teacher`,
					nodes: [{ nodeId: coolingNodeId, q: 1, primary: true }],
					format: "explain",
					level: 3,
					grade: 2,
					graderConfidence: 0.9,
					hints: 0,
					minutesSinceExposure: 20,
				},
			});

			const todayWithDecay = studyToday();
			assert.ok((todayWithDecay.dueReviewsCount ?? 0) >= 1, "studyToday surfaces overdue FSRS review count");
			assert.ok(todayWithDecay.urgentReview, "studyToday surfaces most urgent overdue review");
			assert.ok(todayWithDecay.urgentReview!.retrievability < 0.85);
			assert.ok(todayWithDecay.coolingAlert, "studyToday surfaces coolingAlert for decayed skill");
			assert.equal(todayWithDecay.coolingAlert!.nodeId, coolingNodeId);
			assert.ok(todayWithDecay.coolingAlert!.retrievability < 0.85);
		} finally {
			unsub();
		}
	});
});
