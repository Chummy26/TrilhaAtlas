/**
 * Pure unit tests for TrilhaAtlas INTENSIVA (`src/core/intensive/**`):
 * - Public template catalog completeness & structural invariants (6 courses, 4 tiers, 2 certs, 2 anti-goals, 3 projects, 4 bench checks, 5 pacing rules)
 * - Deterministic progress, Tier 4 core-isolation, local video pack denominator, certification readiness, pacing guardrails, and recommendations
 * - Technical PT-BR/EN search normalization, BM25 ranking, timestamp formatting, and bounded AI-Tutor window extraction
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	DEFAULT_INTENSIVE_TRACK_ID,
	TEMPLATE_INTENSIVE_TRACK,
	TEMPLATE_INTENSIVE_TRACK_ID,
	computeCertificationProgress,
	computeCourseProgress,
	computePortfolioProgress,
	computeTierProgress,
	computeTrackDashboard,
	createDefaultIntensiveState,
	extractWindowAroundTimestamp,
	formatTimestamp,
	getCertificationCheckpointKey,
	getDefaultPacingSettings,
	getIntensiveTrack,
	listIntensiveTracks,
	normalizeSearchText,
	scoreTextMatch,
	searchTranscriptChunks,
	tokenizeSearchText,
	type CourseMediaBundle,
	type CourseProgressMetrics,
	type MediaLessonSummary,
	type SearchableTranscriptDoc,
	type TranscriptSegment,
} from "../src/core/index.ts";

function makeLesson(
	index: number,
	overrides: Partial<MediaLessonSummary> = {},
): MediaLessonSummary {
	return {
		lessonId: `lesson-${String(index).padStart(3, "0")}`,
		fileName: `${String(index).padStart(3, "0")}_Aula_${index}.mp4`,
		title: `Aula ${index}`,
		order: index,
		durationSec: 1800,
		fileSize: 50_000_000,
		fileMtimeMs: 1_700_000_000_000 + index * 1000,
		transcriptStatus: "ready",
		wordCount: 2500,
		chunkCount: 12,
		...overrides,
	};
}

describe("INTENSIVA public template catalog completeness", () => {
	it("registers the default generic Intensive template track", () => {
		assert.equal(DEFAULT_INTENSIVE_TRACK_ID, TEMPLATE_INTENSIVE_TRACK_ID);
		const track = getIntensiveTrack(DEFAULT_INTENSIVE_TRACK_ID);
		assert.ok(track, "default intensive track should resolve");
		assert.equal(track.id, TEMPLATE_INTENSIVE_TRACK.id);
		assert.ok(listIntensiveTracks().some((t) => t.id === track.id));
		assert.equal(getIntensiveTrack("non-existent-track"), null);
	});

	it("defines 4 tiers (tier-1..tier-4) with Core vs On-Demand scopes", () => {
		const track = TEMPLATE_INTENSIVE_TRACK;
		assert.equal(track.tiers.length, 4);
		assert.deepEqual(
			track.tiers.map((t) => t.id),
			["tier-1", "tier-2", "tier-3", "tier-4"],
		);
		assert.deepEqual(
			track.tiers.map((t) => t.tier),
			[1, 2, 3, 4],
		);
		for (const t of track.tiers.slice(0, 3)) {
			assert.equal(t.completionScope, "core", `${t.id} must be core`);
		}
		assert.equal(track.tiers[3]!.completionScope, "on-demand", "tier-4 must be on-demand");
	});

	it("defines structured Core (Tiers 1–3) and On-Demand (Tier 4) courses with unique ranks and IDs", () => {
		const track = TEMPLATE_INTENSIVE_TRACK;
		assert.equal(track.courses.length, 6);

		const ranks = track.courses.map((c) => c.rank).sort((a, b) => a - b);
		assert.deepEqual(
			ranks,
			Array.from({ length: track.courses.length }, (_, idx) => idx + 1),
		);

		const uniqueIds = new Set(track.courses.map((c) => c.id));
		assert.equal(uniqueIds.size, track.courses.length, "all course IDs must be unique");

		const coreCourses = track.courses.filter((c) => c.completionScope === "core");
		const onDemandCourses = track.courses.filter((c) => c.completionScope === "on-demand");
		assert.equal(coreCourses.length, 5);
		assert.equal(onDemandCourses.length, 1);

		for (const c of coreCourses) {
			assert.ok(c.tier >= 1 && c.tier <= 3, `core course ${c.id} must be in Tiers 1–3`);
		}
		for (const c of onDemandCourses) {
			assert.equal(c.tier, 4, `on-demand course ${c.id} must be in Tier 4`);
		}
	});

	it("configures a local-video-pack parallel course with expected videos and parallel cadence", () => {
		const track = TEMPLATE_INTENSIVE_TRACK;
		const parallel = track.courses.find((c) => c.id === track.parallelCourseId);
		assert.ok(parallel, "parallel course must exist");
		assert.equal(parallel.id, "template-parallel-deep-dive");
		assert.equal(parallel.tier, 1);
		assert.equal(parallel.deliveryMode, "local-video-pack");
		assert.equal(parallel.expectedTotalVideos, 100);
		assert.ok(parallel.parallelCadence, "parallel course must define parallelCadence");
		assert.equal(parallel.parallelCadence.recommendedDailyMinutesMin, 45);
		assert.equal(parallel.parallelCadence.recommendedDailyMinutesMax, 60);
		assert.ok(parallel.parallelCadence.label.trim().length > 0);
		assert.ok(parallel.parallelCadence.rationale.trim().length > 0);
	});

	it("ensures every course has non-empty tutorSyllabusContext and structured modules", () => {
		for (const course of TEMPLATE_INTENSIVE_TRACK.courses) {
			assert.ok(
				course.tutorSyllabusContext.trim().length >= 40,
				`course ${course.id} must have substantive tutorSyllabusContext`,
			);
			assert.ok(course.modules.length > 0, `course ${course.id} must have at least 1 module`);
			const modIds = new Set<string>();
			for (const mod of course.modules) {
				assert.ok(mod.id.trim().length > 0, `${course.id} module must have id`);
				assert.ok(!modIds.has(mod.id), `duplicate module id ${mod.id} in ${course.id}`);
				modIds.add(mod.id);
				assert.ok(mod.title.trim().length > 0, `${mod.id} must have title`);
				assert.ok(mod.estimatedHours > 0, `${mod.id} must have positive estimatedHours`);
				assert.ok(mod.topics.length > 0, `${mod.id} must have topics`);
			}
		}
	});

	it("defines verified certifications, anti-goals, portfolio projects (P1–P3), bench checks, and 5 pacing rules", () => {
		const track = TEMPLATE_INTENSIVE_TRACK;
		const courseIdSet = new Set(track.courses.map((c) => c.id));

		assert.equal(track.certifications.length, 2);
		for (const cert of track.certifications) {
			assert.match(cert.verifiedAt, /^\d{4}-\d{2}-\d{2}$/, `${cert.id} must have YYYY-MM-DD verifiedAt`);
			assert.ok(cert.studyCheckpoints.length > 0, `${cert.id} must have non-empty studyCheckpoints`);
			for (const cp of cert.studyCheckpoints) {
				assert.ok(cp.trim().length > 0, `${cert.id} checkpoint must be non-empty`);
			}
			for (const cid of cert.linkedCourseIds) {
				assert.ok(courseIdSet.has(cid), `${cert.id} links unknown courseId ${cid}`);
			}
		}

		assert.equal(track.certificationAntiGoals.length, 2);
		assert.ok(track.certificationAntiGoals.some((ag) => ag.severity === "reject"));

		assert.equal(track.portfolioProjects.length, 3);
		assert.deepEqual(
			track.portfolioProjects.map((p) => p.code),
			["P1", "P2", "P3"],
		);
		for (const proj of track.portfolioProjects) {
			assert.ok(proj.deliverables.length > 0, `${proj.id} must have deliverables`);
		}

		assert.equal(track.benchInterviewChecklist.length, 4);
		assert.deepEqual(
			track.benchInterviewChecklist.map((item) => item.order),
			[1, 2, 3, 4],
		);

		assert.equal(track.pacingRules.length, 5);
		assert.deepEqual(
			track.pacingRules.map((rule) => rule.order),
			[1, 2, 3, 4, 5],
		);
		assert.ok(track.pacingProfiles["full-time-home"]);
		assert.ok(track.pacingProfiles["with-clt"]);
	});
});

describe("INTENSIVA progress math, readiness, pacing, and recommendations", () => {
	it("completing course #1 moves Tier 1 % and Core % immediately", () => {
		const track = TEMPLATE_INTENSIVE_TRACK;
		const state = createDefaultIntensiveState(track.id, "2026-11-24T10:00:00.000Z");

		const initial = computeTrackDashboard(track, state);
		const initialTier1 = initial.tiers.find((t) => t.spec.tier === 1)!;
		assert.equal(initialTier1.spec.id, "tier-1");
		assert.equal(initialTier1.courses.length, 2);
		assert.equal(initialTier1.metrics.percent, 0);
		assert.equal(initial.summary.coreCompletionPct, 0);

		const firstCourse = track.courses.find((c) => c.id === "template-foundations-core")!;
		for (const mod of firstCourse.modules) {
			state.courses[firstCourse.id]!.modules[mod.id] = {
				completed: true,
				completedAt: "2026-11-24T12:00:00.000Z",
				loggedMinutes: 120,
				notes: "",
				customLinks: [],
			};
		}

		const afterFirst = computeTrackDashboard(track, state);
		const tier1 = afterFirst.tiers.find((t) => t.spec.tier === 1)!;
		assert.equal(afterFirst.coursesById[firstCourse.id]!.metrics.percent, 100);
		assert.equal(afterFirst.coursesById[firstCourse.id]!.metrics.status, "completed");
		assert.equal(tier1.metrics.percent, 50, "1 of 2 Tier 1 courses = +50% immediately");
		assert.equal(tier1.metrics.completedCourseCount, 1);
		assert.equal(afterFirst.summary.coreCompletedCourses, 1);
		assert.equal(afterFirst.summary.coreCompletionPct, 20); // 100 / 5 = 20
	});

	it("Tier 4 on-demand courses never penalize coreCompletionPct and track opt-in cleanly", () => {
		const track = TEMPLATE_INTENSIVE_TRACK;
		const state = createDefaultIntensiveState(track.id, "2026-11-24T10:00:00.000Z");

		// Complete ALL 5 Core courses while leaving Tier 4 at 0%.
		for (const course of track.courses) {
			if (course.completionScope === "core") {
				state.courses[course.id]!.manualStatus = "completed";
			}
		}

		const coreDone = computeTrackDashboard(track, state);
		assert.equal(coreDone.summary.coreCompletedCourses, 5);
		assert.equal(coreDone.summary.coreTotalCourses, 5);
		assert.equal(coreDone.summary.coreCompletionPct, 100);
		assert.equal(coreDone.summary.optedInOnDemandCount, 0);
		assert.ok(
			coreDone.summary.totalWithOnDemandPct < 100,
			"totalWithOnDemandPct reflects all 6 courses separately from Core",
		);
		assert.equal(coreDone.summary.totalWithOnDemandPct, 83.3); // 500 / 6

		// Opt into Tier 4 course without finishing it -> coreCompletionPct stays 100%.
		const tier4Courses = track.courses.filter((c) => c.tier === 4);
		state.courses[tier4Courses[0]!.id]!.optedIn = true;

		const afterOptIn = computeTrackDashboard(track, state);
		assert.equal(afterOptIn.summary.coreCompletionPct, 100);
		assert.equal(afterOptIn.summary.optedInOnDemandCount, 1);
		assert.equal(afterOptIn.tiers.find((t) => t.spec.tier === 4)!.metrics.optedInCourseCount, 1);

		// Conversely, completing a Tier 4 course when Core is 0% never inflates coreCompletionPct.
		const fresh = createDefaultIntensiveState(track.id, "2026-11-24T10:00:00.000Z");
		fresh.courses[tier4Courses[0]!.id]!.optedIn = true;
		fresh.courses[tier4Courses[0]!.id]!.manualStatus = "completed";
		const freshDash = computeTrackDashboard(track, fresh);
		assert.equal(freshDash.summary.coreCompletionPct, 0);
		assert.equal(freshDash.summary.optedInOnDemandCount, 1);
		assert.ok(freshDash.summary.totalWithOnDemandPct > 0);
	});

	it("local video pack uses max(discovered, expectedTotalVideos) and falls back to modules before linking", () => {
		const track = TEMPLATE_INTENSIVE_TRACK;
		const parallel = track.courses.find((c) => c.id === "template-parallel-deep-dive")!;
		const state = createDefaultIntensiveState(track.id, "2026-11-24T10:00:00.000Z");

		// Parallel pack with 20 discovered videos (10 watched) while 100 are expected.
		const lessons20 = Array.from({ length: 20 }, (_, i) =>
			makeLesson(i + 1, { transcriptStatus: i < 15 ? "ready" : "downloading" }),
		);
		for (let i = 0; i < 10; i += 1) {
			const lid = lessons20[i]!.lessonId;
			state.courses[parallel.id]!.videos[lid] = {
				watched: true,
				watchedAt: "2026-11-24T12:00:00.000Z",
				positionSec: 1800,
				durationSec: 1800,
				notes: "",
				bookmarks: [],
			};
		}

		const metrics20 = computeCourseProgress(parallel, state.courses[parallel.id], lessons20, {
			courseId: parallel.id,
			sourceDir: "C:\\fake\\course",
			language: "pt",
			configuredAt: "2026-11-24T10:00:00.000Z",
			expectedTotalVideos: 100,
		});
		assert.equal(metrics20.basis, "videos");
		assert.equal(metrics20.videoProgress.discoveredCount, 20);
		assert.equal(metrics20.videoProgress.expectedTotalCount, 100);
		assert.equal(metrics20.videoProgress.denominatorCount, 100);
		assert.equal(metrics20.videoProgress.watchedCount, 10);
		assert.equal(metrics20.videoProgress.transcribedCount, 15);
		assert.equal(metrics20.videoProgress.downloadingCount, 5);
		assert.equal(metrics20.percent, 10); // 10 / 100 = 10%

		// If discovered videos exceed 100 (e.g. 125 lessons), denominator rises to 125.
		const lessons125 = Array.from({ length: 125 }, (_, i) => makeLesson(i + 1));
		const metrics125 = computeCourseProgress(parallel, state.courses[parallel.id], lessons125);
		assert.equal(metrics125.videoProgress.denominatorCount, 125);
		assert.equal(metrics125.percent, 8); // 10 / 125 = 8%

		// A course BEFORE any local folder is linked falls back to module completion.
		const toolCourse = track.courses.find((c) => c.id === "template-practical-toolchain")!;
		state.courses[toolCourse.id]!.modules[toolCourse.modules[0]!.id] = {
			completed: true,
			completedAt: "2026-11-24T12:00:00.000Z",
			loggedMinutes: 90,
			notes: "",
			customLinks: [],
		};
		const beforeLink = computeCourseProgress(toolCourse, state.courses[toolCourse.id], [], null);
		assert.equal(beforeLink.basis, "modules");
		assert.equal(beforeLink.percent, 50); // 1 of 2 modules
		assert.equal(beforeLink.status, "in-progress");
		assert.equal(beforeLink.videoProgress.hasLinkedMedia, false);
	});

	it("computes certification readiness as 70% checkpoints + 30% linked courses, and 100% when passed", () => {
		const coreCert = TEMPLATE_INTENSIVE_TRACK.certifications.find((c) => c.id === "cert-core-exam")!;
		assert.ok(coreCert.linkedCourseIds.length > 0);
		assert.ok(coreCert.studyCheckpoints.length >= 2);

		const totalCps = coreCert.studyCheckpoints.length;
		const checkedCps = Math.floor(totalCps / 2);
		const completedCheckpoints: Record<string, boolean> = {};
		for (let i = 0; i < checkedCps; i += 1) {
			completedCheckpoints[getCertificationCheckpointKey(coreCert.id, i)] = true;
		}

		const linkedMap: Record<string, CourseProgressMetrics> = {};
		for (const cid of coreCert.linkedCourseIds) {
			const spec = TEMPLATE_INTENSIVE_TRACK.courses.find((c) => c.id === cid)!;
			linkedMap[cid] = computeCourseProgress(spec, {
				courseId: cid,
				manualStatus: "completed",
				courseNotes: "",
				customLinks: [],
				modules: {},
				videos: {},
			});
		}

		const preparing = computeCertificationProgress(
			coreCert,
			{
				certId: coreCert.id,
				status: "preparing",
				completedCheckpoints,
				notes: "",
			},
			linkedMap,
		);
		const expectedCpPct = Math.round(((checkedCps / totalCps) * 100) * 10) / 10;
		const expectedReadiness = Math.round((expectedCpPct * 0.7 + 100 * 0.3) * 10) / 10;
		assert.equal(preparing.checkpointsPct, expectedCpPct);
		assert.equal(preparing.linkedCoursesPct, 100);
		assert.equal(preparing.readinessPct, expectedReadiness);
		assert.equal(preparing.isCore, true);

		const passed = computeCertificationProgress(
			coreCert,
			{
				certId: coreCert.id,
				status: "passed",
				completedCheckpoints: {},
				notes: "Passed exam!",
			},
			{},
		);
		assert.equal(passed.readinessPct, 100);
		assert.equal(passed.status, "passed");
	});

	it("updates pacing projections for full-time-home vs with-clt and emits guardrail warnings", () => {
		const track = TEMPLATE_INTENSIVE_TRACK;
		const homeState = createDefaultIntensiveState(track.id, "2026-11-24T10:00:00.000Z");
		homeState.pacing = getDefaultPacingSettings("full-time-home", track);

		const workState = createDefaultIntensiveState(track.id, "2026-11-24T10:00:00.000Z");
		workState.pacing = getDefaultPacingSettings("with-clt", track);

		const homeDash = computeTrackDashboard(track, homeState);
		const workDash = computeTrackDashboard(track, workState);

		assert.equal(homeDash.pacingProjection.mode, "full-time-home");
		assert.equal(workDash.pacingProjection.mode, "with-clt");
		assert.equal(homeDash.pacingProjection.guardrailWarnings.length, 0);
		assert.equal(workDash.pacingProjection.guardrailWarnings.length, 0);
		assert.ok(homeDash.pacingProjection.activeGuardrails.length >= 4);

		// Lower daily study minutes in with-clt must produce strictly longer estimates.
		assert.ok(workDash.pacingProjection.tier1EstimatedDays > homeDash.pacingProjection.tier1EstimatedDays);
		assert.ok(workDash.pacingProjection.tier1EstimatedWeeks > homeDash.pacingProjection.tier1EstimatedWeeks);
		assert.ok(workDash.pacingProjection.cetaEstimatedDays > homeDash.pacingProjection.cetaEstimatedDays);
		assert.ok(workDash.pacingProjection.coreEstimatedDays > homeDash.pacingProjection.coreEstimatedDays);
		assert.ok(workDash.pacingProjection.coreEstimatedWeeks > homeDash.pacingProjection.coreEstimatedWeeks);

		// Unsafe settings trigger comprehension-first guardrail warnings.
		const unsafeState = createDefaultIntensiveState(track.id, "2026-11-24T10:00:00.000Z");
		unsafeState.pacing = {
			mode: "full-time-home",
			dailyElectronicsMinutes: 360, // > 300 + 30
			dailyLanguageMinutes: 60,
			dailyCtaMinutes: 95, // > 75
			passiveVideoCapMinutes: 160, // > 120
		};
		const unsafeDash = computeTrackDashboard(track, unsafeState);
		assert.equal(unsafeDash.pacingProjection.effectivePassiveVideoCapMinutes, 120);
		assert.equal(unsafeDash.pacingProjection.guardrailWarnings.length, 3);
		assert.ok(
			unsafeDash.pacingProjection.guardrailWarnings.some((w) => w.includes("120 min")),
			"must warn on excessive passive video cap",
		);
		assert.ok(
			unsafeDash.pacingProjection.guardrailWarnings.some((w) => w.toLowerCase().includes("paralel")),
			"must warn on excessive parallel cadence",
		);
		assert.ok(
			unsafeDash.pacingProjection.guardrailWarnings.some((w) => w.includes("fadiga")),
			"must warn on unsustainable daily load",
		);
	});

	it("returns primary course, parallel track, and certification/portfolio nextRecommendedActions", () => {
		const track = TEMPLATE_INTENSIVE_TRACK;
		const state = createDefaultIntensiveState(track.id, "2026-11-24T10:00:00.000Z");
		const media: Record<string, CourseMediaBundle> = {
			"template-parallel-deep-dive": {
				lessons: [makeLesson(1, { title: "Aula 1 - Introdução Prática" })],
				status: null,
				source: null,
			},
		};

		const dash = computeTrackDashboard(track, state, media);
		assert.equal(dash.nextRecommendedActions.length, 3);

		const primary = dash.nextRecommendedActions.find((a) => a.slot === "primary-course");
		const parallel = dash.nextRecommendedActions.find((a) => a.slot === "daily-parallel");
		const certOrBench = dash.nextRecommendedActions.find((a) => a.slot === "certification-or-bench");

		assert.ok(primary && primary.courseId === "template-foundations-core");
		assert.ok(primary.title.length > 0 && primary.subtitle.length > 0 && primary.reason.length > 0);
		assert.ok(parallel && parallel.courseId === "template-parallel-deep-dive");
		assert.equal(parallel.lessonId, "lesson-001");
		assert.ok(certOrBench && certOrBench.certId);

		// When all Core certifications are passed, slot 3 shifts to the next portfolio project (P1).
		for (const cert of track.certifications) {
			if (cert.priorityTier === "core-free" || cert.priorityTier === "core-paid") {
				state.certifications[cert.id]!.status = "passed";
			}
		}
		const afterCerts = computeTrackDashboard(track, state, media);
		const benchSlot = afterCerts.nextRecommendedActions.find((a) => a.slot === "certification-or-bench");
		assert.ok(benchSlot);
		assert.equal(benchSlot.projectId, "project-p1");

		const portfolioMetrics = computePortfolioProgress(track.portfolioProjects, state.portfolio);
		assert.equal(portfolioMetrics.totalProjectsCount, 3);
		assert.equal(portfolioMetrics.percent, 0);

		const tier1View = dash.tiers.find((t) => t.spec.tier === 1)!;
		assert.deepEqual(computeTierProgress(tier1View.spec, tier1View.courses), tier1View.metrics);
	});
});

describe("INTENSIVA search & transcript helpers", () => {
	it("preserves hyphenated technical tokens and normalizes PT-BR accents", () => {
		const raw =
			"Tensão na entrada 4–20mA, op-amp TL072, barramento RS-485, conector USB-C, STM32, MOSFET, BGA, SMPS, KiCad, eletrônica e solda.";
		const normalized = normalizeSearchText(raw);
		const tokens = tokenizeSearchText(raw);

		for (const expected of [
			"tensao",
			"4-20ma",
			"op-amp",
			"rs-485",
			"usb-c",
			"stm32",
			"mosfet",
			"bga",
			"smps",
			"kicad",
			"eletronica",
			"solda",
		]) {
			assert.ok(normalized.includes(expected), `normalized text should include "${expected}": ${normalized}`);
			assert.ok(tokens.includes(expected), `tokens should include "${expected}": ${tokens.join(", ")}`);
		}

		assert.equal(normalizeSearchText("   ---  "), "");
		assert.deepEqual(tokenizeSearchText(""), []);
	});

	it("ranks exact multi-token hits highest and includes timestamp labels", () => {
		const docs: SearchableTranscriptDoc[] = [
			{
				courseId: "template-parallel-deep-dive",
				courseTitle: "Curso Paralelo",
				lessonId: "les-01",
				lessonTitle: "Aula 1 - Resistores e Malhas",
				order: 1,
				chunks: [
					{
						index: 0,
						start: 45,
						end: 105,
						text: "Aqui falamos de fonte linear simples e medição de tensão no resistor.",
					},
				],
			},
			{
				courseId: "template-parallel-deep-dive",
				courseTitle: "Curso Paralelo",
				lessonId: "les-42",
				lessonTitle: "Aula 42 - Fonte Chaveada SMPS com TL431 e Optoacoplador",
				order: 42,
				telegramCaption: "Análise completa da malha de feedback em fonte chaveada",
				chunks: [
					{
						index: 0,
						start: 330,
						end: 390,
						text: "Nesta fonte chaveada SMPS, o regulador TL431 aciona o optoacoplador para manter a tensão de saída estável.",
					},
					{
						index: 1,
						start: 3725,
						end: 3785,
						text: "Também revisamos rapidamente capacitores eletrolíticos na saída da fonte.",
					},
				],
			},
			{
				courseId: "template-advanced-capstone",
				courseTitle: "Especialização",
				lessonId: "plc-05",
				lessonTitle: "Entradas Analógicas 4-20mA e RS-485",
				order: 5,
				chunks: [
					{
						index: 0,
						start: 615,
						end: 675,
						text: "Um laço 4-20mA usa um op-amp de instrumentação e interface RS-485 para telemetria industrial.",
					},
				],
			},
		];

		const smpsHits = searchTranscriptChunks("fonte chaveada TL431 optoacoplador", docs, 10);
		assert.ok(smpsHits.length >= 2);
		assert.equal(smpsHits[0]!.lessonId, "les-42");
		assert.equal(smpsHits[0]!.chunkIndex, 0);
		assert.equal(smpsHits[0]!.timestampLabel, "05:30");
		assert.ok(smpsHits[0]!.score > smpsHits[1]!.score);
		assert.ok(smpsHits[0]!.matchedTokens.includes("tl431"));
		assert.ok(smpsHits[0]!.matchedTokens.includes("optoacoplador"));
		assert.ok(smpsHits[0]!.snippet.length > 0);

		const industrialHits = searchTranscriptChunks("4-20mA op amp RS-485", docs, 5);
		assert.equal(industrialHits.length, 1);
		assert.equal(industrialHits[0]!.lessonId, "plc-05");
		assert.equal(industrialHits[0]!.timestampLabel, "10:15");

		const exactScore = scoreTextMatch(["fonte", "chaveada", "tl431"], "Defeito na fonte chaveada com TL431 aberto");
		const partialScore = scoreTextMatch(["fonte", "chaveada", "tl431"], "Defeito na fonte linear simples");
		assert.ok(exactScore > partialScore && partialScore > 0);
	});

	it("formats timestamps accurately and extracts bounded chronological windows", () => {
		assert.equal(formatTimestamp(0), "00:00");
		assert.equal(formatTimestamp(-10), "00:00");
		assert.equal(formatTimestamp(Number.NaN), "00:00");
		assert.equal(formatTimestamp(330), "05:30");
		assert.equal(formatTimestamp(3725), "01:02:05");

		const segments: TranscriptSegment[] = [
			{ id: 4, start: 210, end: 225, text: "Quarto trecho: validando o sinal PWM no osciloscópio com ponta 10x." },
			{ id: 1, start: 100, end: 115, text: "Primeiro trecho: inspeção visual antes de energizar a fonte chaveada." },
			{ id: 3, start: 180, end: 195, text: "Terceiro trecho central: medindo 2,5V de referência no pino do TL431." },
			{ id: 2, start: 145, end: 160, text: "Segundo trecho: checando impedância a frio nos rails secundários." },
			{ id: 5, start: 600, end: 620, text: "Trecho distante fora da janela de noventa segundos." },
		];

		const fullWindow = extractWindowAroundTimestamp(segments, 185, 90, 2000);
		assert.ok(fullWindow.length <= 2000);
		assert.ok(fullWindow.includes("[01:40] Primeiro trecho"));
		assert.ok(fullWindow.includes("[02:25] Segundo trecho"));
		assert.ok(fullWindow.includes("[03:00] Terceiro trecho central"));
		assert.ok(fullWindow.includes("[03:30] Quarto trecho"));
		assert.ok(!fullWindow.includes("Trecho distante"), "segment outside ±90s window must be excluded");

		const idx1 = fullWindow.indexOf("[01:40]");
		const idx2 = fullWindow.indexOf("[02:25]");
		const idx3 = fullWindow.indexOf("[03:00]");
		const idx4 = fullWindow.indexOf("[03:30]");
		assert.ok(idx1 < idx2 && idx2 < idx3 && idx3 < idx4, "output must be in strict chronological order");

		const tight = extractWindowAroundTimestamp(segments, 185, 90, 120);
		assert.ok(tight.length <= 120, `expected <= 120 chars, got ${tight.length}`);
		assert.ok(tight.includes("[03:00] Terceiro trecho central"), "closest paused segment must be preserved");

		const gapFallback = extractWindowAroundTimestamp(segments, 900, 30, 200);
		assert.ok(gapFallback.length > 0 && gapFallback.length <= 200);
		assert.ok(gapFallback.includes("[10:00] Trecho distante"));
	});
});
