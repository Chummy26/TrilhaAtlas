/**
 * End-to-end store & API route tests for TrilhaAtlas INTENSIVA:
 * - Strict temporary LH_DATA_DIR isolation (never touches repo data/)
 * - GET /api/intensive & all 17 PATCH /api/intensive mutations + disk persistence + unsafe URL rejection
 * - POST/GET/DELETE /api/intensive/sources & GET /api/intensive/courses/[courseId]
 *   (pre-manifest direct folder scan AND post-manifest auto-discovery with dead-PID status normalization)
 * - Secure local media streaming (/api/intensive/media/[courseId]/[lessonId]):
 *   HEAD, 200 OK, Range 206, suffix range, 416, ?kind=vtt, ?kind=thumb, ../ traversal -> 404
 * - Transcript (/transcript?format=json|vtt|txt) & full-text BM25 search (/api/intensive/search)
 * - AI Tutor context builders & POST /api/chats with intensiveContext (video lesson, external module, certification),
 *   bounded buildIntensiveTurnMemory (<= 4000 chars + cross-lesson retrieval), searchIntensiveForTutor, getIntensiveTranscriptForTutor
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import type {
	CourseMaterialDoc,
	CourseMaterialSummary,
	CourseMediaSource,
	CourseTranscriptionStatus,
	CurriculumNodeMatch,
	IntensiveCourseView,
	IntensiveDashboardDTO,
	IntensiveMaterialSearchHit,
	IntensiveSearchHit,
	LessonTranscriptDoc,
	LhMessage,
	MediaLessonSummary,
} from "../src/core/index.ts";

// ── Isolated temp seam BEFORE any config-loading import ──────────────────────
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-intensive-data-"));
const TMP_MEDIA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-intensive-media-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { PATHS } = await import("../config.ts");
const {
	TEMPLATE_INTENSIVE_TRACK,
	getCertificationCheckpointKey,
	intensiveContextOf,
	projectView,
	toLlmMessages,
} = await import("../src/core/index.ts");
const {
	intensiveCourseMaterialsDir,
	intensiveCourseMaterialsExtractedDir,
	intensiveCourseMaterialsFilesDir,
	intensiveCourseMediaDir,
	intensiveCourseTranscriptsDir,
	isProcessAlive,
	makeDeterministicLessonId,
} = await import("../src/store/intensive-store.ts");
const { chatStore } = await import("../src/store/chats.ts");
const {
	buildDomainIntensiveMemory,
	buildIntensiveTurnMemory,
	buildIntensiveTutorContext,
	getIntensiveTranscriptForTutor,
	hasIntensiveKnowledgeForDomain,
	searchIntensiveForTutor,
} = await import("../src/server/intensive.ts");

const intensiveRoute = await import("../app/api/intensive/route.ts");
const sourcesRoute = await import("../app/api/intensive/sources/route.ts");
const courseDetailRoute = await import("../app/api/intensive/courses/[courseId]/route.ts");
const courseMaterialsRoute = await import(
	"../app/api/intensive/courses/[courseId]/materials/route.ts"
);
const materialFileRoute = await import(
	"../app/api/intensive/materials/[courseId]/[materialId]/route.ts"
);
const transcriptRoute = await import(
	"../app/api/intensive/courses/[courseId]/lessons/[lessonId]/transcript/route.ts"
);
const mediaRoute = await import("../app/api/intensive/media/[courseId]/[lessonId]/route.ts");
const searchRoute = await import("../app/api/intensive/search/route.ts");
const chatsRoute = await import("../app/api/chats/route.ts");

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
	fs.rmSync(TMP_MEDIA, { recursive: true, force: true });
});

function jsonRequest(url: string, method: string, body?: unknown): Request {
	return new Request(url, {
		method,
		headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
}

async function patchIntensive(body: Record<string, unknown>): Promise<{
	status: number;
	data: IntensiveDashboardDTO & { error?: string };
}> {
	const res = await intensiveRoute.PATCH(jsonRequest("http://test/api/intensive", "PATCH", body));
	const data = (await res.json()) as IntensiveDashboardDTO & { error?: string };
	return { status: res.status, data };
}

async function getIntensive(): Promise<IntensiveDashboardDTO> {
	const res = await intensiveRoute.GET(new Request("http://test/api/intensive"));
	assert.equal(res.status, 200);
	return (await res.json()) as IntensiveDashboardDTO;
}

function findGuaranteedDeadPid(): number {
	for (let pid = 999_999; pid > 500_000; pid -= 1) {
		if (!isProcessAlive(pid)) return pid;
	}
	throw new Error("Could not find an unused PID for dead-PID normalization test");
}

function writeJson(filePath: string, payload: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(payload, null, "\t")}\n`, "utf8");
}

// ── Shared synthetic fixture paths for manifest, media, transcript, search, and tutor suites ──
const CTA_COURSE_ID = "template-parallel-deep-dive";
const CTA_MEDIA_DIR = path.join(TMP_MEDIA, "cta-pack");
const CTA_VIDEO1_NAME = "001_Aula_1_Analise_Malhas_Tensao.mp4";
const CTA_VIDEO2_NAME = "002_Aula_2_Fontes_Chaveadas_TL431.mp4";
const CTA_LESSON1_ID = makeDeterministicLessonId(CTA_VIDEO1_NAME);
const CTA_LESSON2_ID = makeDeterministicLessonId(CTA_VIDEO2_NAME);

// Deterministic 16 KiB video payload for exact byte-range checks.
const CTA_VIDEO1_BYTES = Buffer.alloc(16_384);
for (let i = 0; i < CTA_VIDEO1_BYTES.length; i += 1) {
	CTA_VIDEO1_BYTES[i] = (i * 31 + 7) & 0xff;
}
const CTA_THUMB1_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

function seedCtaManifestAndTranscripts(): { deadPid: number } {
	fs.mkdirSync(CTA_MEDIA_DIR, { recursive: true });
	const video1Path = path.join(CTA_MEDIA_DIR, CTA_VIDEO1_NAME);
	const video2Path = path.join(CTA_MEDIA_DIR, CTA_VIDEO2_NAME);
	const thumb1Path = `${video1Path}_thumb.jpg`;

	fs.writeFileSync(video1Path, CTA_VIDEO1_BYTES);
	fs.writeFileSync(video2Path, Buffer.alloc(14_000, 0x42));
	fs.writeFileSync(thumb1Path, CTA_THUMB1_BYTES);

	const mediaDir = intensiveCourseMediaDir(CTA_COURSE_ID);
	const transcriptsDir = intensiveCourseTranscriptsDir(CTA_COURSE_ID);
	fs.mkdirSync(transcriptsDir, { recursive: true });

	const deadPid = findGuaranteedDeadPid();

	writeJson(path.join(mediaDir, "manifest.json"), {
		schemaVersion: 1,
		courseId: CTA_COURSE_ID,
		courseName: "CTA Eletrônica (Auto-Descoberto)",
		sourceDir: CTA_MEDIA_DIR,
		language: "pt",
		updatedAt: "2026-11-24T10:00:00.000Z",
		lessons: [
			{
				lessonId: CTA_LESSON1_ID,
				fileName: CTA_VIDEO1_NAME,
				relativePath: CTA_VIDEO1_NAME,
				filePath: video1Path,
				thumbnailPath: thumb1Path,
				title: "Aula 1 - Análise de Malhas e Tensão Nodal",
				order: 1,
				durationSec: 1200,
				fileSize: CTA_VIDEO1_BYTES.length,
				fileMtimeMs: 1_700_000_001_000,
				telegramCaption: "Aula inicial de previsão dedutiva de tensões nodais em resistores.",
				status: "completed",
				wordCount: 95,
				chunkCount: 2,
				transcribedAt: "2026-11-24T10:05:00.000Z",
			},
			{
				lessonId: CTA_LESSON2_ID,
				fileName: CTA_VIDEO2_NAME,
				relativePath: CTA_VIDEO2_NAME,
				filePath: video2Path,
				title: "Aula 2 - Fontes Chaveadas SMPS com TL431 e Optoacoplador",
				order: 2,
				durationSec: 1500,
				fileSize: 14_000,
				fileMtimeMs: 1_700_000_002_000,
				telegramCaption: "Malha de feedback isolada com TL431, optoacoplador PC817 e capacitor de filtro.",
				status: "completed",
				wordCount: 110,
				chunkCount: 2,
				transcribedAt: "2026-11-24T10:15:00.000Z",
			},
		],
	});

	writeJson(path.join(mediaDir, "status.json"), {
		schemaVersion: 1,
		courseId: CTA_COURSE_ID,
		state: "transcribing",
		pid: deadPid,
		model: "large-v3-turbo",
		device: "cuda",
		totalDiscovered: 2,
		completed: 1,
		pending: 1,
		downloading: 0,
		failed: 0,
		currentFileName: CTA_VIDEO2_NAME,
		avgRealtimeSpeedup: 14.5,
		startedAt: "2026-11-24T10:00:00.000Z",
		lastUpdatedAt: "2026-11-24T10:06:00.000Z",
	});

	// Lesson 1: JSON + explicit VTT + explicit TXT on disk
	const lesson1Doc: LessonTranscriptDoc = {
		schemaVersion: 1,
		courseId: CTA_COURSE_ID,
		lessonId: CTA_LESSON1_ID,
		fileName: CTA_VIDEO1_NAME,
		filePath: video1Path,
		fileSize: CTA_VIDEO1_BYTES.length,
		fileMtimeMs: 1_700_000_001_000,
		title: "Aula 1 - Análise de Malhas e Tensão Nodal",
		order: 1,
		durationSec: 1200,
		language: "pt",
		model: "large-v3-turbo",
		transcribedAt: "2026-11-24T10:05:00.000Z",
		telegramCaption: "Aula inicial de previsão dedutiva de tensões nodais em resistores.",
		wordCount: 95,
		fullText:
			"Bem-vindos à aula de malhas resistivas. Antes de medir com o multímetro, calcule a tensão nodal esperada no divisor resistivo. Quando R2 abre, a tensão no nó sobe para Vcc de 12 volts. Se R1 alterar o valor para dez vezes maior, a queda de tensão muda imediatamente.",
		segments: [
			{
				id: 0,
				start: 0,
				end: 25,
				text: "Bem-vindos à aula de malhas resistivas e previsão dedutiva.",
			},
			{
				id: 1,
				start: 140,
				end: 175,
				text: "Antes de medir com o multímetro, calcule a tensão nodal esperada no divisor resistivo.",
			},
			{
				id: 2,
				start: 180,
				end: 215,
				text: "Quando R2 abre, a tensão no nó sobe diretamente para Vcc de 12 volts sem corrente de malha.",
			},
			{
				id: 3,
				start: 225,
				end: 255,
				text: "Se R1 alterar o valor para dez vezes maior, a queda de tensão muda imediatamente no divisor.",
			},
			{
				id: 4,
				start: 600,
				end: 630,
				text: "Na segunda metade, revisamos potência dissipada e escolha segura de resistores na bancada.",
			},
		],
		chunks: [
			{
				index: 0,
				start: 140,
				end: 255,
				text: "Antes de medir com o multímetro, calcule a tensão nodal esperada no divisor resistivo. Quando R2 abre, a tensão no nó sobe diretamente para Vcc de 12 volts.",
			},
			{
				index: 1,
				start: 600,
				end: 630,
				text: "Na segunda metade, revisamos potência dissipada e escolha segura de resistores na bancada.",
			},
		],
	};
	writeJson(path.join(transcriptsDir, `${CTA_LESSON1_ID}.json`), lesson1Doc);
	fs.writeFileSync(
		path.join(transcriptsDir, `${CTA_LESSON1_ID}.vtt`),
		[
			"WEBVTT",
			"",
			"1",
			"00:00:00.000 --> 00:00:25.000",
			"Bem-vindos à aula de malhas resistivas e previsão dedutiva.",
			"",
			"2",
			"00:03:00.000 --> 00:03:35.000",
			"Quando R2 abre, a tensão no nó sobe diretamente para Vcc de 12 volts sem corrente de malha.",
			"",
		].join("\n"),
		"utf8",
	);
	fs.writeFileSync(
		path.join(transcriptsDir, `${CTA_LESSON1_ID}.txt`),
		[
			"[00:00] Bem-vindos à aula de malhas resistivas e previsão dedutiva.",
			"[03:00] Quando R2 abre, a tensão no nó sobe diretamente para Vcc de 12 volts sem corrente de malha.",
		].join("\n") + "\n",
		"utf8",
	);

	// Lesson 2: JSON ONLY (no .vtt or .txt on disk — exercises live synthesis fallback & cross-lesson BM25 retrieval!)
	const lesson2Doc: LessonTranscriptDoc = {
		schemaVersion: 1,
		courseId: CTA_COURSE_ID,
		lessonId: CTA_LESSON2_ID,
		fileName: CTA_VIDEO2_NAME,
		filePath: video2Path,
		fileSize: 14_000,
		fileMtimeMs: 1_700_000_002_000,
		title: "Aula 2 - Fontes Chaveadas SMPS com TL431 e Optoacoplador",
		order: 2,
		durationSec: 1500,
		language: "pt",
		model: "large-v3-turbo",
		transcribedAt: "2026-11-24T10:15:00.000Z",
		telegramCaption: "Malha de feedback isolada com TL431, optoacoplador PC817 e capacitor de filtro.",
		wordCount: 110,
		fullText:
			"Na fonte chaveada SMPS, o TL431 compara a tensão de saída com a referência interna de 2,5 volts e controla a corrente no LED do optoacoplador PC817. Se o optoacoplador abrir ou o divisor do TL431 falhar, a fonte dispara em sobretensão ou entra em proteção.",
		segments: [
			{
				id: 0,
				start: 90,
				end: 130,
				text: "Na fonte chaveada SMPS, o TL431 compara a tensão de saída com a referência interna de 2,5 volts.",
			},
			{
				id: 1,
				start: 130,
				end: 175,
				text: "O TL431 controla a corrente no LED do optoacoplador PC817 para regular o ciclo de trabalho PWM.",
			},
			{
				id: 2,
				start: 330,
				end: 375,
				text: "Se o optoacoplador abrir ou o divisor do TL431 falhar, a fonte dispara em sobretensão ou entra em proteção.",
			},
		],
		chunks: [
			{
				index: 0,
				start: 90,
				end: 175,
				text: "Na fonte chaveada SMPS, o TL431 compara a tensão de saída com a referência interna de 2,5 volts e controla a corrente no LED do optoacoplador PC817 para regular o PWM.",
			},
			{
				index: 1,
				start: 330,
				end: 375,
				text: "Se o optoacoplador abrir ou o divisor do TL431 falhar, a fonte chaveada SMPS dispara em sobretensão ou entra em proteção.",
			},
		],
	};
	writeJson(path.join(transcriptsDir, `${CTA_LESSON2_ID}.json`), lesson2Doc);

	return { deadPid };
}

describe("INTENSIVA test isolation", () => {
	it("points PATHS.data strictly to the temporary LH_DATA_DIR", () => {
		assert.equal(PATHS.data, path.resolve(TMP_DATA));
	});
});

describe("GET & PATCH /api/intensive — all 17 mutations, persistence, and URL security", () => {
	it("executes and persists all 17 mutation types across reads", async () => {
		const initial = await getIntensive();
		assert.equal(initial.track.id, TEMPLATE_INTENSIVE_TRACK.id);
		assert.equal(initial.state.pacing.mode, "full-time-home");
		assert.equal(initial.summary.coreCompletionPct, 0);

		// 1. set-pacing
		const r1 = await patchIntensive({
			type: "set-pacing",
			mode: "with-clt",
			dailyElectronicsMinutes: 135,
			dailyLanguageMinutes: 55,
			dailyCtaMinutes: 50,
			passiveVideoCapMinutes: 85,
			startDate: "2026-11-24",
		});
		assert.equal(r1.status, 200);
		assert.equal(r1.data.state.pacing.mode, "with-clt");
		assert.equal(r1.data.state.pacing.dailyElectronicsMinutes, 135);
		assert.equal(r1.data.state.pacing.dailyLanguageMinutes, 55);
		assert.equal(r1.data.state.pacing.dailyCtaMinutes, 50);
		assert.equal(r1.data.state.pacing.passiveVideoCapMinutes, 85);

		// 2. toggle-module
		const r2 = await patchIntensive({
			type: "toggle-module",
			courseId: "template-foundations-core",
			moduleId: "tpl-m1-setup",
			completed: true,
		});
		assert.equal(r2.status, 200);
		assert.equal(r2.data.state.courses["template-foundations-core"]!.modules["tpl-m1-setup"]!.completed, true);
		assert.equal(r2.data.coursesById["template-foundations-core"]!.metrics.percent, 33.3);

		// 3. update-module
		const r3 = await patchIntensive({
			type: "update-module",
			courseId: "template-foundations-core",
			moduleId: "tpl-m1-setup",
			addMinutes: 45,
			notes: "Checklist ESD revisado e pulseira medida (1 MOhm).",
			customLinks: [
				{
					id: "lnk-esd",
					label: "Guia ESD",
					url: "https://example.com/esd-guide",
					addedAt: "2026-11-24T11:00:00.000Z",
				},
			],
		});
		assert.equal(r3.status, 200);
		const m1State = r3.data.state.courses["template-foundations-core"]!.modules["tpl-m1-setup"]!;
		assert.equal(m1State.loggedMinutes, 45);
		assert.match(m1State.notes, /pulseira medida/);
		assert.equal(m1State.customLinks.length, 1);

		// 4. toggle-video-watched
		const r4 = await patchIntensive({
			type: "toggle-video-watched",
			courseId: CTA_COURSE_ID,
			lessonId: CTA_LESSON1_ID,
			watched: true,
			durationSec: 1200,
		});
		assert.equal(r4.status, 200);
		assert.equal(r4.data.state.courses[CTA_COURSE_ID]!.videos[CTA_LESSON1_ID]!.watched, true);
		assert.equal(r4.data.state.courses[CTA_COURSE_ID]!.videos[CTA_LESSON1_ID]!.durationSec, 1200);

		// 5. update-video-progress (position + notes + auto-complete threshold at >= 92%)
		const r5a = await patchIntensive({
			type: "update-video-progress",
			courseId: CTA_COURSE_ID,
			lessonId: CTA_LESSON2_ID,
			positionSec: 185.4,
			durationSec: 1500,
			notes: "Anotação sobre malha TL431 + PC817.",
		});
		assert.equal(r5a.status, 200);
		const v2Mid = r5a.data.state.courses[CTA_COURSE_ID]!.videos[CTA_LESSON2_ID]!;
		assert.equal(v2Mid.positionSec, 185.4);
		assert.equal(v2Mid.watched, false);
		assert.match(v2Mid.notes, /TL431/);

		const r5b = await patchIntensive({
			type: "update-video-progress",
			courseId: CTA_COURSE_ID,
			lessonId: CTA_LESSON2_ID,
			positionSec: 1410,
			durationSec: 1500,
		});
		assert.equal(r5b.status, 200);
		assert.equal(
			r5b.data.state.courses[CTA_COURSE_ID]!.videos[CTA_LESSON2_ID]!.watched,
			true,
			"watching >= 92% of a >= 30s video auto-marks watched",
		);

		// 6. add-video-bookmark (two bookmarks inserted out of chronological order -> sorted)
		const r6a = await patchIntensive({
			type: "add-video-bookmark",
			courseId: CTA_COURSE_ID,
			lessonId: CTA_LESSON1_ID,
			timeSec: 210,
			label: "R2 aberto sobe para 12V",
			note: "Prever antes de medir",
		});
		assert.equal(r6a.status, 200);
		const r6b = await patchIntensive({
			type: "add-video-bookmark",
			courseId: CTA_COURSE_ID,
			lessonId: CTA_LESSON1_ID,
			timeSec: 45,
			label: "Introdução ao divisor",
		});
		assert.equal(r6b.status, 200);
		const bookmarks = r6b.data.state.courses[CTA_COURSE_ID]!.videos[CTA_LESSON1_ID]!.bookmarks;
		assert.equal(bookmarks.length, 2);
		assert.equal(bookmarks[0]!.timeSec, 45);
		assert.equal(bookmarks[1]!.timeSec, 210);

		// 7. remove-video-bookmark
		const r7 = await patchIntensive({
			type: "remove-video-bookmark",
			courseId: CTA_COURSE_ID,
			lessonId: CTA_LESSON1_ID,
			bookmarkId: bookmarks[0]!.id,
		});
		assert.equal(r7.status, 200);
		const remainingBookmarks =
			r7.data.state.courses[CTA_COURSE_ID]!.videos[CTA_LESSON1_ID]!.bookmarks;
		assert.equal(remainingBookmarks.length, 1);
		assert.equal(remainingBookmarks[0]!.timeSec, 210);

		// 8. update-course (Tier 4 opt-in + course notes + manualStatus)
		const tier4Course = TEMPLATE_INTENSIVE_TRACK.courses.find((c) => c.tier === 4)!;
		const r8 = await patchIntensive({
			type: "update-course",
			courseId: tier4Course.id,
			optedIn: true,
			manualStatus: "in-progress",
			courseNotes: "Consulta pontual de circuitos RL/RC.",
		});
		assert.equal(r8.status, 200);
		assert.equal(r8.data.summary.optedInOnDemandCount, 1);
		assert.equal(r8.data.state.courses[tier4Course.id]!.optedIn, true);
		assert.equal(r8.data.state.courses[tier4Course.id]!.manualStatus, "in-progress");

		// 9. add-course-link (both course-level and module-level)
		const r9a = await patchIntensive({
			type: "add-course-link",
			courseId: "template-foundations-core",
			label: "Certificado PDF",
			url: "https://example.com/senai-cert",
		});
		assert.equal(r9a.status, 200);
		const courseLinkId = r9a.data.state.courses["template-foundations-core"]!.customLinks[0]!.id;

		const r9b = await patchIntensive({
			type: "add-course-link",
			courseId: "template-foundations-core",
			moduleId: "tpl-m2-core-concepts",
			label: "Calculadora Lei de Ohm",
			url: "https://example.com/ohm",
		});
		assert.equal(r9b.status, 200);
		const modLinkId =
			r9b.data.state.courses["template-foundations-core"]!.modules["tpl-m2-core-concepts"]!.customLinks[0]!.id;

		// 10. remove-course-link (both course-level and module-level)
		const r10a = await patchIntensive({
			type: "remove-course-link",
			courseId: "template-foundations-core",
			linkId: courseLinkId,
		});
		assert.equal(r10a.status, 200);
		assert.equal(r10a.data.state.courses["template-foundations-core"]!.customLinks.length, 0);

		const r10b = await patchIntensive({
			type: "remove-course-link",
			courseId: "template-foundations-core",
			moduleId: "tpl-m2-core-concepts",
			linkId: modLinkId,
		});
		assert.equal(r10b.status, 200);
		assert.equal(
			r10b.data.state.courses["template-foundations-core"]!.modules["tpl-m2-core-concepts"]!.customLinks.length,
			0,
		);

		// 11. update-certification
		const r11 = await patchIntensive({
			type: "update-certification",
			certId: "cert-core-exam",
			status: "preparing",
			targetDate: "2027-03-15",
			credentialId: "ETA-2027-001",
			credentialUrl: "https://www.etai.org/verify/ETA-2027-001",
			mockScorePct: 86.5,
			notes: "Revisar SWR e transformadores CA.",
		});
		assert.equal(r11.status, 200);
		const cetaState = r11.data.state.certifications["cert-core-exam"]!;
		assert.equal(cetaState.status, "preparing");
		assert.equal(cetaState.targetDate, "2027-03-15");
		assert.equal(cetaState.mockScorePct, 86.5);
		assert.equal(cetaState.credentialUrl, "https://www.etai.org/verify/ETA-2027-001");

		// 12. toggle-cert-checkpoint
		const r12 = await patchIntensive({
			type: "toggle-cert-checkpoint",
			certId: "cert-core-exam",
			checkpointIndex: 0,
			completed: true,
		});
		assert.equal(r12.status, 200);
		const cp0Key = getCertificationCheckpointKey("cert-core-exam", 0);
		assert.equal(r12.data.state.certifications["cert-core-exam"]!.completedCheckpoints[cp0Key], true);
		const cetaView = r12.data.certifications.find((c) => c.spec.id === "cert-core-exam")!;
		assert.equal(cetaView.metrics.checkedCheckpointsCount, 1);
		assert.ok(cetaView.metrics.readinessPct > 0);

		// 13. update-portfolio
		const r13 = await patchIntensive({
			type: "update-portfolio",
			projectId: "project-p1",
			status: "in-progress",
			repoUrl: "https://github.com/example/p1-rca-repairs",
			notes: "3 de 5 placas diagnosticadas.",
		});
		assert.equal(r13.status, 200);
		assert.equal(r13.data.state.portfolio["project-p1"]!.status, "in-progress");
		assert.equal(
			r13.data.state.portfolio["project-p1"]!.repoUrl,
			"https://github.com/example/p1-rca-repairs",
		);

		// 14. toggle-portfolio-deliverable
		const r14 = await patchIntensive({
			type: "toggle-portfolio-deliverable",
			projectId: "project-p1",
			deliverableId: "p1-d1",
			completed: true,
		});
		assert.equal(r14.status, 200);
		assert.equal(r14.data.state.portfolio["project-p1"]!.completedDeliverables["p1-d1"], true);
		assert.equal(r14.data.portfolioMetrics.byProject["project-p1"]!.completedDeliverablesCount, 1);

		// 15. toggle-bench-interview
		const r15 = await patchIntensive({
			type: "toggle-bench-interview",
			itemId: "bench-1",
			checked: true,
		});
		assert.equal(r15.status, 200);
		assert.equal(r15.data.state.benchInterviewChecked["bench-1"], true);
		assert.equal(r15.data.summary.benchInterviewCheckedCount, 1);

		// 16. toggle-bench-kit
		const r16 = await patchIntensive({
			type: "toggle-bench-kit",
			itemId: "kit-starter-core",
			owned: true,
		});
		assert.equal(r16.status, 200);
		assert.equal(r16.data.state.benchKitOwned["kit-starter-core"], true);

		// 17. log-study
		const r17 = await patchIntensive({
			type: "log-study",
			minutes: 60,
			category: "bench",
			date: "2026-11-24",
			courseId: "template-foundations-core",
			moduleId: "tpl-m1-setup",
			note: "Medição de malhas na bancada com Minipa True RMS.",
		});
		assert.equal(r17.status, 200);
		assert.equal(r17.data.state.studyLog.length, 1);
		assert.equal(r17.data.state.studyLog[0]!.minutes, 60);
		assert.equal(r17.data.state.courses["template-foundations-core"]!.modules["tpl-m1-setup"]!.loggedMinutes, 105); // 45 + 60
		assert.ok(r17.data.summary.totalLoggedMinutes >= 105);

		// Verify persistence across a fresh GET /api/intensive read from disk.
		const persisted = await getIntensive();
		assert.equal(persisted.state.pacing.mode, "with-clt");
		assert.equal(persisted.state.courses["template-foundations-core"]!.modules["tpl-m1-setup"]!.completed, true);
		assert.equal(persisted.state.courses[CTA_COURSE_ID]!.videos[CTA_LESSON1_ID]!.watched, true);
		assert.equal(persisted.state.courses[CTA_COURSE_ID]!.videos[CTA_LESSON1_ID]!.bookmarks.length, 1);
		assert.equal(persisted.state.certifications["cert-core-exam"]!.completedCheckpoints[cp0Key], true);
		assert.equal(persisted.state.portfolio["project-p1"]!.completedDeliverables["p1-d1"], true);
		assert.equal(persisted.state.benchInterviewChecked["bench-1"], true);
		assert.equal(persisted.state.benchKitOwned["kit-starter-core"], true);
		assert.equal(persisted.state.studyLog.length, 1);
	});

	it("rejects unsafe javascript: URLs and invalid mutations with 400", async () => {
		const badCourseLink = await patchIntensive({
			type: "add-course-link",
			courseId: "template-foundations-core",
			label: "XSS",
			url: "javascript:alert(1)",
		});
		assert.equal(badCourseLink.status, 400);

		const badModuleLinks = await patchIntensive({
			type: "update-module",
			courseId: "template-foundations-core",
			moduleId: "tpl-m1-setup",
			customLinks: [
				{
					id: "xss-mod",
					label: "XSS",
					url: "javascript:alert(document.cookie)",
					addedAt: "2026-11-24T11:00:00.000Z",
				},
			],
		});
		assert.equal(badModuleLinks.status, 400);

		const badCertUrl = await patchIntensive({
			type: "update-certification",
			certId: "cert-core-exam",
			credentialUrl: "javascript:alert(1)",
		});
		assert.equal(badCertUrl.status, 400);

		const badPortfolioUrl = await patchIntensive({
			type: "update-portfolio",
			projectId: "project-p1",
			repoUrl: "javascript:void(0)",
		});
		assert.equal(badPortfolioUrl.status, 400);

		const badType = await patchIntensive({ type: "nonexistent-mutation" });
		assert.equal(badType.status, 400);
	});
});

describe("INTENSIVA media sources, direct scan, manifest auto-discovery, and dead-PID normalization", () => {
	it("supports POST/GET/DELETE /api/intensive/sources and pre-manifest direct folder scan", async () => {
		const lyseDir = path.join(TMP_MEDIA, "lyse-direct");
		fs.mkdirSync(lyseDir, { recursive: true });

		// Two complete videos (> 10 KiB) + one partial file (< 10 KiB -> "downloading"), out of lexical order to test natural sort.
		fs.writeFileSync(path.join(lyseDir, "10_Aula_10_Retrabalho_SMD.mp4"), Buffer.alloc(12_000, 0x10));
		fs.writeFileSync(path.join(lyseDir, "2_Aula_2_Fontes_SMPS.mp4"), Buffer.alloc(12_000, 0x02));
		fs.writeFileSync(path.join(lyseDir, "1_Aula_1_Multimetro.mp4"), Buffer.alloc(12_000, 0x01));
		fs.writeFileSync(path.join(lyseDir, "11_Baixando_Agora.mp4"), Buffer.alloc(512, 0x00));

		const linkRes = await sourcesRoute.POST(
			jsonRequest("http://test/api/intensive/sources", "POST", {
				courseId: "template-practical-toolchain",
				sourceDir: lyseDir,
				label: "Lyse Bancada",
				language: "pt",
			}),
		);
		assert.equal(linkRes.status, 200);
		const linkJson = (await linkRes.json()) as {
			ok: boolean;
			source: CourseMediaSource;
			sources: Record<string, CourseMediaSource>;
		};
		assert.equal(linkJson.ok, true);
		assert.equal(linkJson.source.courseId, "template-practical-toolchain");
		assert.equal(linkJson.source.sourceDir, path.resolve(lyseDir));

		// Pre-manifest GET /api/intensive/courses/[courseId] discovers all 4 videos in natural order.
		const detailRes = await courseDetailRoute.GET(
			new Request("http://test/api/intensive/courses/template-practical-toolchain"),
			{ params: Promise.resolve({ courseId: "template-practical-toolchain" }) },
		);
		assert.equal(detailRes.status, 200);
		const detail = (await detailRes.json()) as {
			course: IntensiveCourseView;
			lessons: MediaLessonSummary[];
			trackId: string;
		};
		assert.equal(detail.lessons.length, 4);
		assert.deepEqual(
			detail.lessons.map((l) => l.fileName),
			[
				"1_Aula_1_Multimetro.mp4",
				"2_Aula_2_Fontes_SMPS.mp4",
				"10_Aula_10_Retrabalho_SMD.mp4",
				"11_Baixando_Agora.mp4",
			],
		);
		assert.equal(detail.lessons[0]!.transcriptStatus, "pending");
		assert.equal(detail.lessons[3]!.transcriptStatus, "downloading");
		assert.equal(detail.course.transcriptionStatus?.discoveredCount, 4);
		assert.equal(detail.course.transcriptionStatus?.downloadingCount, 1);
		assert.equal(detail.course.transcriptionStatus?.pendingCount, 3);

		// Unlink via DELETE /api/intensive/sources
		const delRes = await sourcesRoute.DELETE(
			new Request("http://test/api/intensive/sources?courseId=template-practical-toolchain", {
				method: "DELETE",
			}),
		);
		assert.equal(delRes.status, 200);
		const delJson = (await delRes.json()) as {
			ok: boolean;
			removed: boolean;
			sources: Record<string, CourseMediaSource>;
		};
		assert.equal(delJson.ok, true);
		assert.equal(delJson.removed, true);
		assert.equal(delJson.sources["template-practical-toolchain"], undefined);
	});

	it("auto-discovers post-manifest courses and normalizes dead-PID status cleanly", async () => {
		const { deadPid } = seedCtaManifestAndTranscripts();
		assert.equal(isProcessAlive(deadPid), false);

		// GET /api/intensive/sources auto-discovers CTA from manifest.json without manual sources.json entry.
		const srcRes = await sourcesRoute.GET();
		assert.equal(srcRes.status, 200);
		const srcJson = (await srcRes.json()) as { sources: Record<string, CourseMediaSource> };
		assert.ok(srcJson.sources[CTA_COURSE_ID], "CTA should be auto-discovered from manifest.json");
		assert.equal(srcJson.sources[CTA_COURSE_ID]!.sourceDir, CTA_MEDIA_DIR);

		// GET /api/intensive/courses/[courseId] normalizes dead PID from "transcribing" -> "idle" (pending=1).
		const detailRes = await courseDetailRoute.GET(
			new Request(`http://test/api/intensive/courses/${CTA_COURSE_ID}`),
			{ params: Promise.resolve({ courseId: CTA_COURSE_ID }) },
		);
		assert.equal(detailRes.status, 200);
		const detail = (await detailRes.json()) as {
			course: IntensiveCourseView;
			lessons: MediaLessonSummary[];
		};
		assert.equal(detail.lessons.length, 2);
		assert.equal(detail.lessons[0]!.lessonId, CTA_LESSON1_ID);
		assert.equal(detail.lessons[1]!.lessonId, CTA_LESSON2_ID);
		const status: CourseTranscriptionStatus | null = detail.course.transcriptionStatus;
		assert.ok(status);
		assert.equal(status.state, "idle", "dead PID with pending > 0 must normalize to idle");
		assert.equal(status.pid, undefined, "dead PID must be cleared");
		assert.equal(status.currentFile, null, "stale currentFile must be cleared on dead PID");
		assert.equal(status.avgRealtimeFactor, 14.5);

		// When pending=0 and downloading=0 and completed>0, a dead PID normalizes to "completed".
		const statusPath = path.join(intensiveCourseMediaDir(CTA_COURSE_ID), "status.json");
		writeJson(statusPath, {
			schemaVersion: 1,
			courseId: CTA_COURSE_ID,
			state: "watching",
			pid: deadPid,
			totalDiscovered: 2,
			completed: 2,
			pending: 0,
			downloading: 0,
			failed: 0,
			currentFileName: CTA_VIDEO2_NAME,
		});
		const doneRes = await courseDetailRoute.GET(
			new Request(`http://test/api/intensive/courses/${CTA_COURSE_ID}`),
			{ params: Promise.resolve({ courseId: CTA_COURSE_ID }) },
		);
		const doneDetail = (await doneRes.json()) as { course: IntensiveCourseView };
		assert.equal(doneDetail.course.transcriptionStatus?.state, "completed");
		assert.equal(doneDetail.course.transcriptionStatus?.pid, undefined);
		assert.equal(doneDetail.course.transcriptionStatus?.currentFile, null);
	});
});

describe("INTENSIVA secure media streaming (/api/intensive/media/[courseId]/[lessonId])", () => {
	it("serves HEAD, 200 OK, byte ranges (206), suffix range, 416, vtt, thumb, and blocks ../ traversal", async () => {
		const baseUrl = `http://test/api/intensive/media/${CTA_COURSE_ID}/${CTA_LESSON1_ID}`;
		const params = () => Promise.resolve({ courseId: CTA_COURSE_ID, lessonId: CTA_LESSON1_ID });

		// HEAD
		const headRes = await mediaRoute.HEAD(new Request(baseUrl, { method: "HEAD" }), {
			params: params(),
		});
		assert.equal(headRes.status, 200);
		assert.equal(headRes.headers.get("content-type"), "video/mp4");
		assert.equal(headRes.headers.get("accept-ranges"), "bytes");
		assert.equal(headRes.headers.get("content-length"), String(CTA_VIDEO1_BYTES.length));
		assert.equal((await headRes.arrayBuffer()).byteLength, 0);

		// Full GET -> 200 OK
		const fullRes = await mediaRoute.GET(new Request(baseUrl), { params: params() });
		assert.equal(fullRes.status, 200);
		assert.equal(fullRes.headers.get("content-length"), String(CTA_VIDEO1_BYTES.length));
		const fullBuf = Buffer.from(await fullRes.arrayBuffer());
		assert.ok(fullBuf.equals(CTA_VIDEO1_BYTES), "full GET body must match video bytes exactly");

		// Explicit Range: bytes=0-15 -> 206 Partial Content
		const rangeRes = await mediaRoute.GET(
			new Request(baseUrl, { headers: { Range: "bytes=0-15" } }),
			{ params: params() },
		);
		assert.equal(rangeRes.status, 206);
		assert.equal(
			rangeRes.headers.get("content-range"),
			`bytes 0-15/${CTA_VIDEO1_BYTES.length}`,
		);
		assert.equal(rangeRes.headers.get("content-length"), "16");
		const rangeBuf = Buffer.from(await rangeRes.arrayBuffer());
		assert.ok(rangeBuf.equals(CTA_VIDEO1_BYTES.subarray(0, 16)));

		// Suffix Range: bytes=-10 -> 206 Partial Content
		const suffixRes = await mediaRoute.GET(
			new Request(baseUrl, { headers: { Range: "bytes=-10" } }),
			{ params: params() },
		);
		assert.equal(suffixRes.status, 206);
		assert.equal(
			suffixRes.headers.get("content-range"),
			`bytes ${CTA_VIDEO1_BYTES.length - 10}-${CTA_VIDEO1_BYTES.length - 1}/${CTA_VIDEO1_BYTES.length}`,
		);
		assert.equal(suffixRes.headers.get("content-length"), "10");
		const suffixBuf = Buffer.from(await suffixRes.arrayBuffer());
		assert.ok(suffixBuf.equals(CTA_VIDEO1_BYTES.subarray(CTA_VIDEO1_BYTES.length - 10)));

		// Invalid Range: bytes=999999- -> 416 Range Not Satisfiable
		const badRangeRes = await mediaRoute.GET(
			new Request(baseUrl, { headers: { Range: "bytes=999999-" } }),
			{ params: params() },
		);
		assert.equal(badRangeRes.status, 416);
		assert.equal(
			badRangeRes.headers.get("content-range"),
			`bytes */${CTA_VIDEO1_BYTES.length}`,
		);

		// ?kind=vtt
		const vttRes = await mediaRoute.GET(new Request(`${baseUrl}?kind=vtt`), { params: params() });
		assert.equal(vttRes.status, 200);
		assert.match(vttRes.headers.get("content-type") ?? "", /text\/vtt/i);
		const vttText = await vttRes.text();
		assert.ok(vttText.startsWith("WEBVTT"));
		assert.ok(vttText.includes("Quando R2 abre"));

		// ?kind=thumb
		const thumbRes = await mediaRoute.GET(new Request(`${baseUrl}?kind=thumb`), {
			params: params(),
		});
		assert.equal(thumbRes.status, 200);
		assert.equal(thumbRes.headers.get("content-type"), "image/jpeg");
		const thumbBuf = Buffer.from(await thumbRes.arrayBuffer());
		assert.ok(thumbBuf.equals(CTA_THUMB1_BYTES));

		// Path traversal attempts -> 404 across video, vtt, and thumb
		for (const attempt of [
			{ courseId: "../etc", lessonId: CTA_LESSON1_ID, qs: "" },
			{ courseId: CTA_COURSE_ID, lessonId: "../../state.json", qs: "" },
			{ courseId: CTA_COURSE_ID, lessonId: "../secret", qs: "?kind=vtt" },
			{ courseId: CTA_COURSE_ID, lessonId: "../secret", qs: "?kind=thumb" },
		]) {
			const res = await mediaRoute.GET(
				new Request(`http://test/api/intensive/media/x/y${attempt.qs}`),
				{ params: Promise.resolve({ courseId: attempt.courseId, lessonId: attempt.lessonId }) },
			);
			assert.equal(res.status, 404, `traversal (${attempt.courseId}/${attempt.lessonId}${attempt.qs}) must 404`);
		}
	});
});

describe("INTENSIVA transcript & full-text search routes", () => {
	it("serves json, vtt, and txt transcripts (both on-disk and synthesized from json)", async () => {
		const url1 = `http://test/api/intensive/courses/${CTA_COURSE_ID}/lessons/${CTA_LESSON1_ID}/transcript`;
		const params1 = () => Promise.resolve({ courseId: CTA_COURSE_ID, lessonId: CTA_LESSON1_ID });

		const jsonRes = await transcriptRoute.GET(new Request(url1), { params: params1() });
		assert.equal(jsonRes.status, 200);
		const doc = (await jsonRes.json()) as LessonTranscriptDoc;
		assert.equal(doc.lessonId, CTA_LESSON1_ID);
		assert.equal(doc.segments.length, 5);

		const vttRes = await transcriptRoute.GET(new Request(`${url1}?format=vtt`), {
			params: params1(),
		});
		assert.equal(vttRes.status, 200);
		assert.match(vttRes.headers.get("content-type") ?? "", /text\/vtt/i);
		assert.ok((await vttRes.text()).startsWith("WEBVTT"));

		const txtRes = await transcriptRoute.GET(new Request(`${url1}?format=txt`), {
			params: params1(),
		});
		assert.equal(txtRes.status, 200);
		assert.match(txtRes.headers.get("content-type") ?? "", /text\/plain/i);
		assert.ok((await txtRes.text()).includes("[03:00] Quando R2 abre"));

		// Lesson 2 has JSON only -> verifies VTT and TXT live synthesis fallback
		const url2 = `http://test/api/intensive/courses/${CTA_COURSE_ID}/lessons/${CTA_LESSON2_ID}/transcript`;
		const params2 = () => Promise.resolve({ courseId: CTA_COURSE_ID, lessonId: CTA_LESSON2_ID });

		const synthVtt = await transcriptRoute.GET(new Request(`${url2}?format=vtt`), {
			params: params2(),
		});
		assert.equal(synthVtt.status, 200);
		const synthVttText = await synthVtt.text();
		assert.ok(synthVttText.startsWith("WEBVTT"));
		assert.ok(synthVttText.includes("TL431"));

		const synthTxt = await transcriptRoute.GET(new Request(`${url2}?format=txt`), {
			params: params2(),
		});
		assert.equal(synthTxt.status, 200);
		const synthTxtText = await synthTxt.text();
		assert.ok(synthTxtText.includes("[01:30]") && synthTxtText.includes("TL431"));

		// Invalid format -> 400
		const badFmt = await transcriptRoute.GET(new Request(`${url1}?format=xml`), {
			params: params1(),
		});
		assert.equal(badFmt.status, 400);
	});

	it("searches transcripts and catalog modules via GET /api/intensive/search", async () => {
		const res = await searchRoute.GET(
			new Request("http://test/api/intensive/search?q=TL431+optoacoplador+PC817"),
		);
		assert.equal(res.status, 200);
		const data = (await res.json()) as {
			query: string;
			transcriptHits: IntensiveSearchHit[];
			moduleHits: Array<{ courseId: string; moduleId: string; score: number }>;
		};
		assert.equal(data.query, "TL431 optoacoplador PC817");
		assert.ok(data.transcriptHits.length >= 1);
		assert.equal(data.transcriptHits[0]!.lessonId, CTA_LESSON2_ID);
		assert.equal(data.transcriptHits[0]!.timestampLabel, "01:30");

		// Catalog module search against the generic template syllabus
		const moduleRes = await searchRoute.GET(
			new Request("http://test/api/intensive/search?q=simulados&limit=5"),
		);
		assert.equal(moduleRes.status, 200);
		const moduleData = (await moduleRes.json()) as {
			moduleHits: Array<{ courseId: string; moduleId: string }>;
		};
		assert.ok(moduleData.moduleHits.length >= 1);
	});
});

describe("INTENSIVA AI Tutor context, POST /api/chats, bounded turn memory, and tutor tools", () => {
	it("creates chats with intensive-context as message[0] for video lesson, external module, and certification", async () => {
		// 1. Video lesson with paused timestamp (03:05 = 185s)
		const videoChatRes = await chatsRoute.POST(
			jsonRequest("http://test/api/chats", "POST", {
				intensiveContext: {
					courseId: CTA_COURSE_ID,
					lessonId: CTA_LESSON1_ID,
					currentTimeSec: 185,
				},
			}),
		);
		assert.equal(videoChatRes.status, 200);
		const videoChatBody = (await videoChatRes.json()) as { id: string; title: string };
		assert.ok(videoChatBody.title.includes("Aprofundamento"));

		const videoRecord = chatStore.getChat(videoChatBody.id)!;
		assert.equal(videoRecord.messages.length, 1);
		const m0 = videoRecord.messages[0] as {
			role: string;
			customType: string;
			content: string;
			details: {
				courseId?: string;
				lessonId?: string;
				currentTimeSec?: number;
				currentTimestampLabel?: string;
				transcriptExcerpt?: string;
			};
		};
		assert.equal(m0.role, "custom");
		assert.equal(m0.customType, "intensive-context");
		assert.equal(m0.details.courseId, CTA_COURSE_ID);
		assert.equal(m0.details.lessonId, CTA_LESSON1_ID);
		assert.equal(m0.details.currentTimeSec, 185);
		assert.equal(m0.details.currentTimestampLabel, "03:05");
		assert.ok(m0.details.transcriptExcerpt?.includes("Quando R2 abre"));
		assert.ok(m0.content.includes("[03:05]"));
		assert.ok(m0.content.includes("Quando R2 abre"));

		// Verify wire projection & client view projection
		const extractedCtx = intensiveContextOf(videoRecord.messages);
		assert.ok(extractedCtx && extractedCtx.lessonId === CTA_LESSON1_ID);

		const wire = toLlmMessages(videoRecord.messages as unknown as LhMessage[] as never);
		assert.equal(wire.length, 1);
		assert.equal(wire[0]!.role, "user");

		const view = projectView(videoRecord.messages as unknown as LhMessage[] as never);
		assert.equal(view.length, 1);
		const part = view[0]!.parts[0] as { type: string; data: unknown };
		assert.equal(part.type, "data-intensive-context");
		assert.deepEqual(part.data, m0.details);

		// 2. External non-downloadable module (SENAI #1 / senai-m2)
		const modChatRes = await chatsRoute.POST(
			jsonRequest("http://test/api/chats", "POST", {
				intensiveContext: {
					courseId: "template-foundations-core",
					moduleId: "tpl-m2-core-concepts",
				},
			}),
		);
		assert.equal(modChatRes.status, 200);
		const modChatBody = (await modChatRes.json()) as { id: string };
		const modRecord = chatStore.getChat(modChatBody.id)!;
		assert.equal(modRecord.messages.length, 1);
		const modMsg = modRecord.messages[0] as {
			role: string;
			customType: string;
			content: string;
			details: { courseId?: string; moduleId?: string; lessonId?: string; benchExercise?: string };
		};
		assert.equal(modMsg.role, "custom");
		assert.equal(modMsg.customType, "intensive-context");
		assert.equal(modMsg.details.courseId, "template-foundations-core");
		assert.equal(modMsg.details.moduleId, "tpl-m2-core-concepts");
		assert.equal(modMsg.details.lessonId, undefined);
		assert.ok(modMsg.details.benchExercise && modMsg.details.benchExercise.length > 0);
		assert.ok(modMsg.content.includes("Princípios Fundamentais"));

		// 3. Certification (Core exam)
		const certChatRes = await chatsRoute.POST(
			jsonRequest("http://test/api/chats", "POST", {
				intensiveContext: {
					certId: "cert-core-exam",
				},
			}),
		);
		assert.equal(certChatRes.status, 200);
		const certChatBody = (await certChatRes.json()) as { id: string };
		const certRecord = chatStore.getChat(certChatBody.id)!;
		assert.equal(certRecord.messages.length, 1);
		const certMsg = certRecord.messages[0] as {
			role: string;
			customType: string;
			content: string;
			details: { certId?: string; certTitle?: string };
		};
		assert.equal(certMsg.role, "custom");
		assert.equal(certMsg.customType, "intensive-context");
		assert.equal(certMsg.details.certId, "cert-core-exam");
		assert.ok(certMsg.details.certTitle?.includes("Certificação Técnica Principal"));
		assert.ok(certMsg.content.includes("Certificações Vinculadas"));
	});

	it("bounds buildIntensiveTurnMemory to <= 4000 chars and retrieves cross-lesson transcript hits", () => {
		const { payload } = buildIntensiveTutorContext({
			courseId: CTA_COURSE_ID,
			lessonId: CTA_LESSON1_ID,
			currentTimeSec: 185,
		});

		const memory = buildIntensiveTurnMemory(
			payload,
			"Como o TL431 e o optoacoplador PC817 regulam a tensão na fonte chaveada SMPS?",
		);
		assert.ok(memory.length > 0, "turn memory should retrieve relevant context");
		assert.ok(memory.length <= 4000, `turn memory must be <= 4000 chars, got ${memory.length}`);
		assert.ok(
			memory.includes(CTA_LESSON2_ID),
			"turn memory while watching Lesson 1 must retrieve cross-lesson hit from Lesson 2",
		);
		assert.ok(memory.includes("TL431"));
		assert.ok(memory.includes("PC817") || memory.includes("optoacoplador"));

		// Empty query yields empty string cleanly.
		assert.equal(buildIntensiveTurnMemory(payload, "   "), "");

		// Stress test: add several large matching lessons to verify the hard <= 4000 char bound.
		const transcriptsDir = intensiveCourseTranscriptsDir(CTA_COURSE_ID);
		const longSentence =
			"Análise detalhada da malha fechada com TL431, optoacoplador PC817 e fonte chaveada SMPS medindo tensão nodal no secundário. ".repeat(
				12,
			);
		for (let i = 3; i <= 8; i += 1) {
			const lid = `stress-lesson-${i}`;
			writeJson(path.join(transcriptsDir, `${lid}.json`), {
				schemaVersion: 1,
				courseId: CTA_COURSE_ID,
				lessonId: lid,
				fileName: `00${i}_Stress_SMPS_TL431.mp4`,
				fileSize: 20_000,
				fileMtimeMs: 1_700_000_000_000 + i,
				title: `Aula ${i} - Stress Fonte Chaveada SMPS TL431 PC817 ${"X".repeat(120)}`,
				order: i,
				durationSec: 2400,
				language: "pt",
				model: "large-v3-turbo",
				transcribedAt: "2026-11-24T12:00:00.000Z",
				wordCount: 500,
				fullText: longSentence,
				segments: Array.from({ length: 80 }, (_, idx) => ({
					id: idx,
					start: idx * 20,
					end: (idx + 1) * 20,
					text: `Segmento ${idx}: regulador TL431 e optoacoplador PC817 controlando PWM na fonte chaveada SMPS com medição segura de ripple.`,
				})),
				chunks: Array.from({ length: 5 }, (_, idx) => ({
					index: idx,
					start: idx * 300,
					end: (idx + 1) * 300,
					text: longSentence,
				})),
			});
		}

		const stressedMemory = buildIntensiveTurnMemory(
			payload,
			"TL431 optoacoplador PC817 fonte chaveada SMPS tensão nodal",
		);
		assert.ok(stressedMemory.length > 0);
		assert.ok(
			stressedMemory.length <= 4000,
			`stressed turn memory must stay <= 4000 chars, got ${stressedMemory.length}`,
		);
	});

	it("runs searchIntensiveForTutor and getIntensiveTranscriptForTutor cleanly within bounds", () => {
		const searchOut = searchIntensiveForTutor({
			query: "TL431 optoacoplador PC817",
			courseId: CTA_COURSE_ID,
			limit: 5,
		});
		assert.ok(searchOut.length > 0 && searchOut.length <= 5000);
		assert.ok(searchOut.includes(CTA_LESSON2_ID) || searchOut.includes("stress-lesson-"));
		assert.ok(searchOut.includes("TL431"));

		const transcriptOut = getIntensiveTranscriptForTutor({
			courseId: CTA_COURSE_ID,
			lessonId: CTA_LESSON1_ID,
			startSec: 135,
			endSec: 230,
		});
		assert.ok(transcriptOut.length > 0 && transcriptOut.length <= 5000);
		assert.ok(transcriptOut.includes("[02:20]"));
		assert.ok(transcriptOut.includes("Quando R2 abre"));
		assert.ok(!transcriptOut.includes("Na segunda metade"), "segments after endSec must be excluded");

		// Long transcript truncates cleanly <= 5000 chars with continuation startSec hint.
		const longOut = getIntensiveTranscriptForTutor({
			courseId: CTA_COURSE_ID,
			lessonId: "stress-lesson-3",
		});
		assert.ok(longOut.length <= 5000, `long transcript must stay <= 5000 chars, got ${longOut.length}`);
		assert.ok(longOut.includes("startSec="), "truncated transcript should include continuation hint");

		// Missing lesson returns graceful Portuguese explanation rather than throwing.
		const missingOut = getIntensiveTranscriptForTutor({
			courseId: CTA_COURSE_ID,
			lessonId: "does-not-exist",
		});
		assert.ok(missingOut.includes("Transcrição indisponível"));
	});
});

describe("INTENSIVA materials APIs, materialHits search, and domain intensive memory", () => {
	const MAT_PDF_ID = "mat-apostila-malhas";
	const MAT_IMG_ID = "mat-esquema-tl431";
	const MAT_TRAVERSAL_ID = "mat-bad-traversal";
	const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n", "utf8");
	const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

	function seedCtaMaterials(): void {
		const matDir = intensiveCourseMaterialsDir(CTA_COURSE_ID);
		const filesDir = intensiveCourseMaterialsFilesDir(CTA_COURSE_ID);
		const extractedDir = intensiveCourseMaterialsExtractedDir(CTA_COURSE_ID);

		const pdfRel = "Modulo 1 - Eletrica Basica/Apostila_Malhas_Kirchhoff.pdf";
		const imgRel = "Esquemas/Diagrama_SMPS_TL431.png";
		const pdfAbs = path.join(filesDir, pdfRel);
		const imgAbs = path.join(filesDir, imgRel);
		fs.mkdirSync(path.dirname(pdfAbs), { recursive: true });
		fs.mkdirSync(path.dirname(imgAbs), { recursive: true });
		fs.mkdirSync(extractedDir, { recursive: true });

		fs.writeFileSync(pdfAbs, PDF_BYTES);
		fs.writeFileSync(imgAbs, PNG_BYTES);
		// File placed outside filesDir to verify manifest relativePath traversal cannot escape.
		fs.writeFileSync(path.join(TMP_DATA, "outside-secret.txt"), "top-secret-data", "utf8");

		const matDoc: CourseMaterialDoc = {
			schemaVersion: 1,
			courseId: CTA_COURSE_ID,
			materialId: MAT_PDF_ID,
			title: "Apostila de Malhas e Lei de Kirchhoff",
			fileName: "Apostila_Malhas_Kirchhoff.pdf",
			relativePath: pdfRel,
			section: "Módulo 1 – Elétrica Básica",
			category: "pdf",
			sizeBytes: PDF_BYTES.length,
			pageCount: 2,
			wordCount: 58,
			extractedAt: "2026-11-24T12:30:00.000Z",
			chunks: [
				{
					index: 0,
					page: 1,
					text: "Na análise dedutiva de malhas resistivas, a Lei de Kirchhoff das tensões permite prever quedas em cada resistor antes de encostar a ponta do multímetro.",
				},
				{
					index: 1,
					page: 2,
					text: "O capacitor de desacoplamento cerâmico de 100nF próximo ao regulador TL431 reduz ruído de alta frequência e estabiliza a malha de realimentação.",
				},
			],
		};
		writeJson(path.join(extractedDir, `${MAT_PDF_ID}.json`), matDoc);

		writeJson(path.join(matDir, "manifest.json"), {
			schemaVersion: 1,
			courseId: CTA_COURSE_ID,
			updatedAt: "2026-11-24T12:30:00.000Z",
			totalFiles: 3,
			indexedTextFiles: 1,
			totalPages: 2,
			totalWordCount: 58,
			materials: [
				{
					materialId: MAT_PDF_ID,
					title: matDoc.title,
					fileName: matDoc.fileName,
					relativePath: pdfRel,
					section: matDoc.section,
					category: "pdf",
					sizeBytes: PDF_BYTES.length,
					mtimeMs: 1_700_000_010_000,
					pageCount: 2,
					wordCount: 58,
					chunkCount: 2,
					hasText: true,
				},
				{
					materialId: MAT_IMG_ID,
					title: "Diagrama SMPS TL431",
					fileName: "Diagrama_SMPS_TL431.png",
					relativePath: imgRel,
					section: "Esquemas",
					category: "image",
					sizeBytes: PNG_BYTES.length,
					mtimeMs: 1_700_000_011_000,
					hasText: false,
				},
				{
					materialId: MAT_TRAVERSAL_ID,
					title: "Escaping Path",
					fileName: "outside-secret.txt",
					relativePath: "../../../../outside-secret.txt",
					section: "Malicious",
					category: "text",
					sizeBytes: 15,
					mtimeMs: 1_700_000_012_000,
					hasText: false,
				},
			],
		});
	}

	it("lists materials via /api/intensive/courses/[courseId]/materials and includes materials + relatedCurriculumNodes in course detail", async () => {
		seedCtaMaterials();

		const listRes = await courseMaterialsRoute.GET(
			new Request(`http://test/api/intensive/courses/${CTA_COURSE_ID}/materials`),
			{ params: Promise.resolve({ courseId: CTA_COURSE_ID }) },
		);
		assert.equal(listRes.status, 200);
		const listJson = (await listRes.json()) as {
			courseId: string;
			totalFiles: number;
			indexedTextFiles: number;
			materials: CourseMaterialSummary[];
		};
		assert.equal(listJson.courseId, CTA_COURSE_ID);
		assert.equal(listJson.materials.length, 3);
		assert.equal(listJson.indexedTextFiles, 1);

		// Category filter (?category=pdf)
		const pdfOnlyRes = await courseMaterialsRoute.GET(
			new Request(`http://test/api/intensive/courses/${CTA_COURSE_ID}/materials?category=pdf`),
			{ params: Promise.resolve({ courseId: CTA_COURSE_ID }) },
		);
		assert.equal(pdfOnlyRes.status, 200);
		const pdfOnly = (await pdfOnlyRes.json()) as { materials: CourseMaterialSummary[] };
		assert.equal(pdfOnly.materials.length, 1);
		assert.equal(pdfOnly.materials[0]!.materialId, MAT_PDF_ID);

		// Invalid courseId -> 404
		const badCourseRes = await courseMaterialsRoute.GET(
			new Request("http://test/api/intensive/courses/../etc/materials"),
			{ params: Promise.resolve({ courseId: "../etc" }) },
		);
		assert.equal(badCourseRes.status, 404);

		// Course detail includes materials and relatedCurriculumNodes array
		const detailRes = await courseDetailRoute.GET(
			new Request(`http://test/api/intensive/courses/${CTA_COURSE_ID}`),
			{ params: Promise.resolve({ courseId: CTA_COURSE_ID }) },
		);
		assert.equal(detailRes.status, 200);
		const detail = (await detailRes.json()) as {
			materials: CourseMaterialSummary[];
			relatedCurriculumNodes: CurriculumNodeMatch[];
		};
		assert.equal(detail.materials.length, 3);
		assert.ok(Array.isArray(detail.relatedCurriculumNodes));
	});

	it("serves inline files, byte ranges, ?format=text JSON chunks, and blocks traversal with 404", async () => {
		const baseUrl = `http://test/api/intensive/materials/${CTA_COURSE_ID}/${MAT_PDF_ID}`;
		const params = () => Promise.resolve({ courseId: CTA_COURSE_ID, materialId: MAT_PDF_ID });

		// HEAD
		const headRes = await materialFileRoute.HEAD(new Request(baseUrl, { method: "HEAD" }), {
			params: params(),
		});
		assert.equal(headRes.status, 200);
		assert.equal(headRes.headers.get("content-type"), "application/pdf");
		assert.match(headRes.headers.get("content-disposition") ?? "", /^inline;/);
		assert.equal((await headRes.arrayBuffer()).byteLength, 0);

		// Full inline file GET -> 200
		const fileRes = await materialFileRoute.GET(new Request(baseUrl), { params: params() });
		assert.equal(fileRes.status, 200);
		assert.equal(fileRes.headers.get("content-type"), "application/pdf");
		assert.match(fileRes.headers.get("content-disposition") ?? "", /^inline;/);
		const fileBuf = Buffer.from(await fileRes.arrayBuffer());
		assert.ok(fileBuf.equals(PDF_BYTES), "inline PDF body must match bytes on disk");

		// Range GET -> 206
		const rangeRes = await materialFileRoute.GET(
			new Request(baseUrl, { headers: { Range: "bytes=0-7" } }),
			{ params: params() },
		);
		assert.equal(rangeRes.status, 206);
		assert.equal(rangeRes.headers.get("content-range"), `bytes 0-7/${PDF_BYTES.length}`);
		assert.ok(Buffer.from(await rangeRes.arrayBuffer()).equals(PDF_BYTES.subarray(0, 8)));

		// ?format=text -> JSON CourseMaterialDoc with chunks
		const textRes = await materialFileRoute.GET(new Request(`${baseUrl}?format=text`), {
			params: params(),
		});
		assert.equal(textRes.status, 200);
		const doc = (await textRes.json()) as CourseMaterialDoc;
		assert.equal(doc.materialId, MAT_PDF_ID);
		assert.equal(doc.chunks.length, 2);
		assert.equal(doc.chunks[0]!.page, 1);
		assert.equal(doc.chunks[1]!.page, 2);
		assert.ok(doc.chunks[1]!.text.includes("desacoplamento"));

		// Invalid format -> 400
		const badFormatRes = await materialFileRoute.GET(new Request(`${baseUrl}?format=xml`), {
			params: params(),
		});
		assert.equal(badFormatRes.status, 400);

		// Path traversal attempts -> 404 (both ID traversal and manifest relativePath escape)
		for (const attempt of [
			{ courseId: "../etc", materialId: MAT_PDF_ID, qs: "" },
			{ courseId: CTA_COURSE_ID, materialId: "../../state.json", qs: "" },
			{ courseId: CTA_COURSE_ID, materialId: "../secret", qs: "?format=text" },
			{ courseId: CTA_COURSE_ID, materialId: MAT_TRAVERSAL_ID, qs: "" },
		]) {
			const res = await materialFileRoute.GET(
				new Request(`http://test/api/intensive/materials/x/y${attempt.qs}`),
				{
					params: Promise.resolve({
						courseId: attempt.courseId,
						materialId: attempt.materialId,
					}),
				},
			);
			assert.equal(
				res.status,
				404,
				`material traversal (${attempt.courseId}/${attempt.materialId}${attempt.qs}) must 404`,
			);
		}
	});

	it("returns materialHits from GET /api/intensive/search and builds material tutor context in POST /api/chats", async () => {
		const res = await searchRoute.GET(
			new Request(
				"http://test/api/intensive/search?q=capacitor+desacoplamento+Kirchhoff&limit=10",
			),
		);
		assert.equal(res.status, 200);
		const data = (await res.json()) as {
			materialHits: IntensiveMaterialSearchHit[];
		};
		assert.ok(Array.isArray(data.materialHits));
		assert.ok(data.materialHits.length >= 1, "search must return matching PDF materialHits");
		const topHit = data.materialHits[0]!;
		assert.equal(topHit.courseId, CTA_COURSE_ID);
		assert.equal(topHit.materialId, MAT_PDF_ID);
		assert.equal(topHit.section, "Módulo 1 – Elétrica Básica");
		assert.ok(topHit.page === 1 || topHit.page === 2);

		// POST /api/chats with materialId populates materialTitle + materialExcerpt
		const matChatRes = await chatsRoute.POST(
			jsonRequest("http://test/api/chats", "POST", {
				intensiveContext: {
					courseId: CTA_COURSE_ID,
					materialId: MAT_PDF_ID,
				},
			}),
		);
		assert.equal(matChatRes.status, 200);
		const matChatBody = (await matChatRes.json()) as { id: string };
		const matRecord = chatStore.getChat(matChatBody.id)!;
		const m0 = matRecord.messages[0] as {
			details: { materialId?: string; materialTitle?: string; materialExcerpt?: string };
		};
		assert.equal(m0.details.materialId, MAT_PDF_ID);
		assert.equal(m0.details.materialTitle, "Apostila de Malhas e Lei de Kirchhoff");
		assert.ok(m0.details.materialExcerpt?.includes("Lei de Kirchhoff"));
	});

	it("exposes hasIntensiveKnowledgeForDomain and bounded buildDomainIntensiveMemory across transcripts and PDFs", () => {
		assert.equal(hasIntensiveKnowledgeForDomain(TEMPLATE_INTENSIVE_TRACK.domainId), true);
		assert.equal(hasIntensiveKnowledgeForDomain("nonexistent-domain"), false);
		assert.equal(hasIntensiveKnowledgeForDomain(null), false);

		const memory = buildDomainIntensiveMemory({
			domainId: TEMPLATE_INTENSIVE_TRACK.domainId,
			query: "malhas resistivas multímetro Kirchhoff capacitor desacoplamento",
			focusNodeTitles: ["Divisor de Tensão"],
			maxChars: 1600,
		});
		assert.ok(memory.length > 0, "domain intensive memory must return relevant snippets");
		assert.ok(
			memory.length <= 1600,
			`domain intensive memory must respect maxChars=1600, got ${memory.length}`,
		);
		assert.ok(
			memory.includes("Kirchhoff") || memory.includes("desacoplamento"),
			"memory should include PDF material match",
		);
		assert.ok(
			memory.includes("pág."),
			"memory should include PDF material page reference",
		);
		assert.ok(
			/\[\d{2}:\d{2}\]/.test(memory),
			"memory should include transcribed video timestamp reference",
		);

		const tight = buildDomainIntensiveMemory({
			domainId: TEMPLATE_INTENSIVE_TRACK.domainId,
			query: "TL431 optoacoplador capacitor desacoplamento",
			maxChars: 420,
		});
		assert.ok(tight.length > 0 && tight.length <= 420);

		assert.equal(
			buildDomainIntensiveMemory({ domainId: "nonexistent-domain", query: "TL431" }),
			"",
		);
		assert.equal(
			buildDomainIntensiveMemory({ domainId: TEMPLATE_INTENSIVE_TRACK.domainId, query: "   " }),
			"",
		);
	});
});

describe("INTENSIVA custom local track.json override", () => {
	it("loads <LH_DATA_DIR>/intensive/track.json over the public template without touching Git", async () => {
		const trackPath = path.join(TMP_DATA, "intensive", "track.json");
		fs.mkdirSync(path.dirname(trackPath), { recursive: true });
		const customTrack = {
			...TEMPLATE_INTENSIVE_TRACK,
			id: "personal-custom-track",
			domainId: "electronics",
			title: "Minha Trilha Pessoal",
		};
		fs.writeFileSync(trackPath, JSON.stringify(customTrack, null, "\t"), "utf8");
		try {
			const res = await intensiveRoute.GET(new Request("http://test/api/intensive"));
			assert.equal(res.status, 200);
			const dash = (await res.json()) as IntensiveDashboardDTO;
			assert.equal(dash.track.id, "personal-custom-track");
			assert.equal(dash.track.title, "Minha Trilha Pessoal");
			assert.equal(hasIntensiveKnowledgeForDomain("electronics"), true);
		} finally {
			fs.rmSync(trackPath, { force: true });
		}

		// Removing track.json cleanly restores the public starter template.
		const restoredRes = await intensiveRoute.GET(new Request("http://test/api/intensive"));
		const restored = (await restoredRes.json()) as IntensiveDashboardDTO;
		assert.equal(restored.track.id, TEMPLATE_INTENSIVE_TRACK.id);
	});
});
