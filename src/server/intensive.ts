/**
 * Server orchestration for TrilhaAtlas INTENSIVA:
 * - Dashboard DTO assembly & progress mutations
 * - Local media source linking & auto-discovery
 * - Full-text BM25 transcript + syllabus catalog search
 * - Local RTX GPU faster-whisper transcription job launcher/monitor
 * - Bounded AI-Tutor context, per-turn BM25 memory, and tool formatters
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PATHS } from "../../config.ts";
import type { CurriculumItem, CurriculumSnapshot } from "../core/curriculum/types.ts";
import { DEFAULT_INTENSIVE_TRACK_ID } from "../core/intensive/catalog-template.ts";
import {
	computeTrackDashboard,
	createDefaultCertificationState,
	createDefaultCourseState,
	createDefaultPortfolioState,
	getCertificationCheckpointKey,
	getDefaultPacingSettings,
} from "../core/intensive/progress.ts";
import {
	extractWindowAroundTimestamp,
	formatTimestamp,
	normalizeSearchText,
	scoreTextMatch,
	searchTranscriptChunks,
	tokenizeSearchText,
	type SearchableTranscriptDoc,
} from "../core/intensive/search.ts";
import type {
	CertStatus,
	CourseManualStatus,
	CourseMaterialDoc,
	CourseMaterialSummary,
	CourseMediaSource,
	CourseTranscriptionStatus,
	CurriculumNodeMatch,
	CustomResourceLink,
	IntensiveCourseView,
	IntensiveDashboardDTO,
	IntensiveMaterialSearchHit,
	IntensiveSearchHit,
	IntensiveTrackSpec,
	IntensiveTutorContextPayload,
	LessonTranscriptDoc,
	MaterialCategory,
	MediaLessonSummary,
	PacingMode,
	PortfolioProjectStatus,
	StudyLogCategory,
	StudyLogEntry,
	TimestampNote,
	VideoLessonProgressState,
} from "../core/intensive/types.ts";
import {
	courseHasIndexedMaterials,
	courseHasTranscribedVideos,
	intensiveCourseMediaDir,
	isProcessAlive,
	isSafeIntensiveId,
	listEffectiveIntensiveTracks,
	listEffectiveMediaSources,
	listKnownMaterialCourseIds,
	listKnownMediaCourseIds,
	loadAllCourseMaterialDocs,
	loadAllCourseMediaBundles,
	loadAllCourseTranscripts,
	loadCourseMaterialsIndex,
	loadCourseMediaIndex,
	normalizeRawCourseStatus,
	readCourseMaterialDoc,
	readCustomIntensiveTrack,
	readExplicitMediaSources,
	readIntensiveState,
	readLessonTranscript,
	readLessonTranscriptFile,
	readRawCourseStatus,
	resolveCourseLessonMedia,
	resolveCourseMaterialFile,
	resolveEffectiveIntensiveTrack,
	writeExplicitMediaSources,
	writeIntensiveState,
	writeRawCourseStatus,
} from "../store/intensive-store.ts";
import { loadCurriculum, studyDomains } from "./study.ts";

export class IntensiveValidationError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "IntensiveValidationError";
		this.status = status;
	}
}

// ─── Mutation Contract ───────────────────────────────────────────────────────

export type IntensiveMutation =
	| {
			type: "set-pacing";
			mode?: PacingMode;
			dailyElectronicsMinutes?: number;
			dailyLanguageMinutes?: number;
			dailyCtaMinutes?: number;
			passiveVideoCapMinutes?: number;
			startDate?: string;
	  }
	| {
			type: "toggle-module";
			courseId: string;
			moduleId: string;
			completed?: boolean;
	  }
	| {
			type: "update-module";
			courseId: string;
			moduleId: string;
			completed?: boolean;
			loggedMinutes?: number;
			addMinutes?: number;
			notes?: string;
			customLinks?: CustomResourceLink[];
	  }
	| {
			type: "toggle-video-watched";
			courseId: string;
			lessonId: string;
			watched?: boolean;
			durationSec?: number;
	  }
	| {
			type: "update-video-progress";
			courseId: string;
			lessonId: string;
			positionSec?: number;
			durationSec?: number;
			watched?: boolean;
			notes?: string;
	  }
	| {
			type: "add-video-bookmark";
			courseId: string;
			lessonId: string;
			timeSec: number;
			label: string;
			note?: string;
	  }
	| {
			type: "remove-video-bookmark";
			courseId: string;
			lessonId: string;
			bookmarkId: string;
	  }
	| {
			type: "update-course";
			courseId: string;
			optedIn?: boolean;
			manualStatus?: CourseManualStatus;
			courseNotes?: string;
	  }
	| {
			type: "add-course-link";
			courseId: string;
			moduleId?: string;
			label: string;
			url: string;
	  }
	| {
			type: "remove-course-link";
			courseId: string;
			moduleId?: string;
			linkId: string;
	  }
	| {
			type: "update-certification";
			certId: string;
			status?: CertStatus;
			targetDate?: string | null;
			scheduledAt?: string | null;
			passedAt?: string | null;
			credentialId?: string | null;
			credentialUrl?: string | null;
			mockScorePct?: number | null;
			notes?: string;
	  }
	| {
			type: "toggle-cert-checkpoint";
			certId: string;
			checkpointKey?: string;
			checkpointIndex?: number;
			completed?: boolean;
	  }
	| {
			type: "update-portfolio";
			projectId: string;
			status?: PortfolioProjectStatus;
			repoUrl?: string | null;
			notes?: string;
	  }
	| {
			type: "toggle-portfolio-deliverable";
			projectId: string;
			deliverableId: string;
			completed?: boolean;
	  }
	| {
			type: "toggle-bench-interview";
			itemId: string;
			checked?: boolean;
	  }
	| {
			type: "toggle-bench-kit";
			itemId: string;
			owned?: boolean;
	  }
	| {
			type: "log-study";
			minutes: number;
			category: StudyLogCategory;
			date?: string;
			courseId?: string;
			lessonId?: string;
			moduleId?: string;
			certId?: string;
			projectId?: string;
			note?: string;
	  };

const VALID_CERT_STATUSES = new Set<CertStatus>([
	"locked",
	"preparing",
	"ready-to-book",
	"scheduled",
	"passed",
	"skipped",
]);

const VALID_MANUAL_STATUSES = new Set<CourseManualStatus>([
	"auto",
	"in-progress",
	"completed",
	"paused",
]);

const VALID_PORTFOLIO_STATUSES = new Set<PortfolioProjectStatus>([
	"not-started",
	"in-progress",
	"completed",
]);

const VALID_STUDY_CATEGORIES = new Set<StudyLogCategory>([
	"course",
	"video",
	"bench",
	"certification",
	"portfolio",
	"review",
]);

const SAFE_MODEL_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/;
const SAFE_LANG_RE = /^[a-zA-Z]{2,12}(?:-[a-zA-Z0-9]{1,8})?$/;

const MAX_STUDY_LOG_ENTRIES = 5000;
const MAX_TURN_MEMORY_CHARS = 4000;
const MAX_TUTOR_TRANSCRIPT_CHARS = 5000;
const MAX_TUTOR_SEARCH_CHARS = 5000;

function resolveTrack(trackId?: string): IntensiveTrackSpec {
	const found = resolveEffectiveIntensiveTrack(trackId);
	if (!found) {
		throw new IntensiveValidationError(500, "Default intensive track catalog is unavailable.");
	}
	return found;
}

function assertNonEmptyString(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new IntensiveValidationError(400, `${field} must be a non-empty string.`);
	}
	return value.trim();
}

function assertSafeHttpUrl(url: string, field = "url"): string {
	let parsed: URL;
	try {
		parsed = new URL(url.trim());
	} catch {
		throw new IntensiveValidationError(400, `${field} must be a valid http(s) URL.`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new IntensiveValidationError(400, `${field} must use http:// or https://.`);
	}
	return parsed.toString();
}

function clampNonNeg(value: number, max = 1_000_000): number {
	if (!Number.isFinite(value) || value < 0) return 0;
	return Math.min(max, value);
}

function defaultVideoState(): VideoLessonProgressState {
	return {
		watched: false,
		positionSec: 0,
		notes: "",
		bookmarks: [],
	};
}

function truncateText(text: string, maxChars: number): string {
	if (maxChars <= 0) return "";
	const cleaned = text.replace(/\r\n/g, "\n").trim();
	if (cleaned.length <= maxChars) return cleaned;
	return `${cleaned.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

// ─── Dashboard, Detail & State Mutations ─────────────────────────────────────

export function getIntensiveDashboard(trackId?: string): IntensiveDashboardDTO {
	const track = resolveTrack(trackId);
	const state = readIntensiveState(track.id);
	const mediaByCourse = loadAllCourseMediaBundles();
	return computeTrackDashboard(track, state, mediaByCourse);
}

export function getIntensiveCourseDetail(
	courseId: string,
	trackId?: string,
): {
	course: IntensiveCourseView;
	lessons: MediaLessonSummary[];
	materials: CourseMaterialSummary[];
	relatedCurriculumNodes: CurriculumNodeMatch[];
	trackId: string;
} | null {
	if (!isSafeIntensiveId(courseId)) return null;
	const dashboard = getIntensiveDashboard(trackId);
	const course = dashboard.coursesById[courseId];
	if (!course) return null;

	const mediaIdx = loadCourseMediaIndex(courseId);
	const materialsIdx = loadCourseMaterialsIndex(courseId);
	const relatedCurriculumNodes = matchCurriculumNodesForIntensive({
		courseId,
		trackId: dashboard.track.id,
		domainId: dashboard.track.domainId,
		limit: 8,
	});

	return {
		course,
		lessons: mediaIdx.lessons,
		materials: materialsIdx.materials,
		relatedCurriculumNodes,
		trackId: dashboard.track.id,
	};
}

export function parseIntensiveMutation(raw: unknown): IntensiveMutation {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new IntensiveValidationError(400, "Request body must be a JSON object.");
	}
	const body = raw as Record<string, unknown>;
	const type = body.type;
	if (typeof type !== "string" || !type.trim()) {
		throw new IntensiveValidationError(400, "Missing mutation 'type'.");
	}

	switch (type) {
		case "set-pacing":
			return {
				type,
				mode:
					body.mode === "full-time-home" || body.mode === "with-clt" ? body.mode : undefined,
				dailyElectronicsMinutes:
					typeof body.dailyElectronicsMinutes === "number"
						? body.dailyElectronicsMinutes
						: undefined,
				dailyLanguageMinutes:
					typeof body.dailyLanguageMinutes === "number" ? body.dailyLanguageMinutes : undefined,
				dailyCtaMinutes:
					typeof body.dailyCtaMinutes === "number" ? body.dailyCtaMinutes : undefined,
				passiveVideoCapMinutes:
					typeof body.passiveVideoCapMinutes === "number"
						? body.passiveVideoCapMinutes
						: undefined,
				startDate: typeof body.startDate === "string" ? body.startDate : undefined,
			};

		case "toggle-module":
			return {
				type,
				courseId: assertNonEmptyString(body.courseId, "courseId"),
				moduleId: assertNonEmptyString(body.moduleId, "moduleId"),
				completed: typeof body.completed === "boolean" ? body.completed : undefined,
			};

		case "update-module":
			return {
				type,
				courseId: assertNonEmptyString(body.courseId, "courseId"),
				moduleId: assertNonEmptyString(body.moduleId, "moduleId"),
				completed: typeof body.completed === "boolean" ? body.completed : undefined,
				loggedMinutes: typeof body.loggedMinutes === "number" ? body.loggedMinutes : undefined,
				addMinutes: typeof body.addMinutes === "number" ? body.addMinutes : undefined,
				notes: typeof body.notes === "string" ? body.notes : undefined,
				customLinks: Array.isArray(body.customLinks)
					? (body.customLinks as CustomResourceLink[])
					: undefined,
			};

		case "toggle-video-watched":
			return {
				type,
				courseId: assertNonEmptyString(body.courseId, "courseId"),
				lessonId: assertNonEmptyString(body.lessonId, "lessonId"),
				watched: typeof body.watched === "boolean" ? body.watched : undefined,
				durationSec: typeof body.durationSec === "number" ? body.durationSec : undefined,
			};

		case "update-video-progress":
			return {
				type,
				courseId: assertNonEmptyString(body.courseId, "courseId"),
				lessonId: assertNonEmptyString(body.lessonId, "lessonId"),
				positionSec: typeof body.positionSec === "number" ? body.positionSec : undefined,
				durationSec: typeof body.durationSec === "number" ? body.durationSec : undefined,
				watched: typeof body.watched === "boolean" ? body.watched : undefined,
				notes: typeof body.notes === "string" ? body.notes : undefined,
			};

		case "add-video-bookmark":
			if (typeof body.timeSec !== "number" || !Number.isFinite(body.timeSec) || body.timeSec < 0) {
				throw new IntensiveValidationError(400, "timeSec must be a non-negative number.");
			}
			return {
				type,
				courseId: assertNonEmptyString(body.courseId, "courseId"),
				lessonId: assertNonEmptyString(body.lessonId, "lessonId"),
				timeSec: body.timeSec,
				label: assertNonEmptyString(body.label, "label"),
				note: typeof body.note === "string" ? body.note : undefined,
			};

		case "remove-video-bookmark":
			return {
				type,
				courseId: assertNonEmptyString(body.courseId, "courseId"),
				lessonId: assertNonEmptyString(body.lessonId, "lessonId"),
				bookmarkId: assertNonEmptyString(body.bookmarkId, "bookmarkId"),
			};

		case "update-course":
			return {
				type,
				courseId: assertNonEmptyString(body.courseId, "courseId"),
				optedIn: typeof body.optedIn === "boolean" ? body.optedIn : undefined,
				manualStatus:
					typeof body.manualStatus === "string" &&
					VALID_MANUAL_STATUSES.has(body.manualStatus as CourseManualStatus)
						? (body.manualStatus as CourseManualStatus)
						: undefined,
				courseNotes: typeof body.courseNotes === "string" ? body.courseNotes : undefined,
			};

		case "add-course-link":
			return {
				type,
				courseId: assertNonEmptyString(body.courseId, "courseId"),
				moduleId:
					typeof body.moduleId === "string" && body.moduleId.trim()
						? body.moduleId.trim()
						: undefined,
				label: assertNonEmptyString(body.label, "label"),
				url: assertSafeHttpUrl(assertNonEmptyString(body.url, "url")),
			};

		case "remove-course-link":
			return {
				type,
				courseId: assertNonEmptyString(body.courseId, "courseId"),
				moduleId:
					typeof body.moduleId === "string" && body.moduleId.trim()
						? body.moduleId.trim()
						: undefined,
				linkId: assertNonEmptyString(body.linkId, "linkId"),
			};

		case "update-certification":
			if (
				body.status !== undefined &&
				(typeof body.status !== "string" || !VALID_CERT_STATUSES.has(body.status as CertStatus))
			) {
				throw new IntensiveValidationError(400, "Invalid certification status.");
			}
			return {
				type,
				certId: assertNonEmptyString(body.certId, "certId"),
				status: body.status as CertStatus | undefined,
				targetDate:
					body.targetDate === null || typeof body.targetDate === "string"
						? body.targetDate
						: undefined,
				scheduledAt:
					body.scheduledAt === null || typeof body.scheduledAt === "string"
						? body.scheduledAt
						: undefined,
				passedAt:
					body.passedAt === null || typeof body.passedAt === "string"
						? body.passedAt
						: undefined,
				credentialId:
					body.credentialId === null || typeof body.credentialId === "string"
						? body.credentialId
						: undefined,
				credentialUrl:
					body.credentialUrl === null || typeof body.credentialUrl === "string"
						? body.credentialUrl
						: undefined,
				mockScorePct:
					body.mockScorePct === null || typeof body.mockScorePct === "number"
						? body.mockScorePct
						: undefined,
				notes: typeof body.notes === "string" ? body.notes : undefined,
			};

		case "toggle-cert-checkpoint":
			return {
				type,
				certId: assertNonEmptyString(body.certId, "certId"),
				checkpointKey:
					typeof body.checkpointKey === "string" && body.checkpointKey.trim()
						? body.checkpointKey.trim()
						: undefined,
				checkpointIndex:
					typeof body.checkpointIndex === "number" && Number.isInteger(body.checkpointIndex)
						? body.checkpointIndex
						: undefined,
				completed: typeof body.completed === "boolean" ? body.completed : undefined,
			};

		case "update-portfolio":
			if (
				body.status !== undefined &&
				(typeof body.status !== "string" ||
					!VALID_PORTFOLIO_STATUSES.has(body.status as PortfolioProjectStatus))
			) {
				throw new IntensiveValidationError(400, "Invalid portfolio project status.");
			}
			return {
				type,
				projectId: assertNonEmptyString(body.projectId, "projectId"),
				status: body.status as PortfolioProjectStatus | undefined,
				repoUrl:
					body.repoUrl === null || typeof body.repoUrl === "string" ? body.repoUrl : undefined,
				notes: typeof body.notes === "string" ? body.notes : undefined,
			};

		case "toggle-portfolio-deliverable":
			return {
				type,
				projectId: assertNonEmptyString(body.projectId, "projectId"),
				deliverableId: assertNonEmptyString(body.deliverableId, "deliverableId"),
				completed: typeof body.completed === "boolean" ? body.completed : undefined,
			};

		case "toggle-bench-interview":
			return {
				type,
				itemId: assertNonEmptyString(body.itemId, "itemId"),
				checked: typeof body.checked === "boolean" ? body.checked : undefined,
			};

		case "toggle-bench-kit":
			return {
				type,
				itemId: assertNonEmptyString(body.itemId, "itemId"),
				owned: typeof body.owned === "boolean" ? body.owned : undefined,
			};

		case "log-study":
			if (typeof body.minutes !== "number" || !Number.isFinite(body.minutes) || body.minutes <= 0) {
				throw new IntensiveValidationError(400, "minutes must be a positive number.");
			}
			if (
				typeof body.category !== "string" ||
				!VALID_STUDY_CATEGORIES.has(body.category as StudyLogCategory)
			) {
				throw new IntensiveValidationError(400, "Invalid study log category.");
			}
			return {
				type,
				minutes: Math.min(1440, Math.round(body.minutes)),
				category: body.category as StudyLogCategory,
				date: typeof body.date === "string" && body.date.trim() ? body.date.trim() : undefined,
				courseId:
					typeof body.courseId === "string" && body.courseId.trim()
						? body.courseId.trim()
						: undefined,
				lessonId:
					typeof body.lessonId === "string" && body.lessonId.trim()
						? body.lessonId.trim()
						: undefined,
				moduleId:
					typeof body.moduleId === "string" && body.moduleId.trim()
						? body.moduleId.trim()
						: undefined,
				certId:
					typeof body.certId === "string" && body.certId.trim() ? body.certId.trim() : undefined,
				projectId:
					typeof body.projectId === "string" && body.projectId.trim()
						? body.projectId.trim()
						: undefined,
				note: typeof body.note === "string" ? body.note.trim() : undefined,
			};

		default:
			throw new IntensiveValidationError(400, `Unsupported intensive mutation type: ${type}`);
	}
}

export function mutateIntensiveState(
	patch: IntensiveMutation,
	trackId?: string,
): IntensiveDashboardDTO {
	const track = resolveTrack(trackId);
	const state = readIntensiveState(track.id);
	const nowIso = new Date().toISOString();

	const ensureCourse = (courseId: string) => {
		if (!isSafeIntensiveId(courseId)) {
			throw new IntensiveValidationError(400, `Invalid courseId: ${courseId}`);
		}
		if (!state.courses[courseId]) {
			state.courses[courseId] = createDefaultCourseState(courseId);
		}
		return state.courses[courseId]!;
	};

	const ensureModule = (courseId: string, moduleId: string) => {
		const course = ensureCourse(courseId);
		if (!course.modules[moduleId]) {
			course.modules[moduleId] = {
				completed: false,
				loggedMinutes: 0,
				notes: "",
				customLinks: [],
			};
		}
		return { course, mod: course.modules[moduleId]! };
	};

	const ensureVideo = (courseId: string, lessonId: string) => {
		if (!isSafeIntensiveId(lessonId)) {
			throw new IntensiveValidationError(400, `Invalid lessonId: ${lessonId}`);
		}
		const course = ensureCourse(courseId);
		if (!course.videos[lessonId]) {
			course.videos[lessonId] = defaultVideoState();
		}
		return { course, video: course.videos[lessonId]! };
	};

	switch (patch.type) {
		case "set-pacing": {
			const modeChanged = patch.mode !== undefined && patch.mode !== state.pacing.mode;
			const nextMode: PacingMode = patch.mode ?? state.pacing.mode;
			const defaults = getDefaultPacingSettings(nextMode, track);

			state.pacing = {
				mode: nextMode,
				dailyElectronicsMinutes:
					patch.dailyElectronicsMinutes !== undefined
						? Math.max(30, Math.min(720, Math.round(patch.dailyElectronicsMinutes)))
						: modeChanged
							? defaults.dailyElectronicsMinutes
							: state.pacing.dailyElectronicsMinutes,
				dailyLanguageMinutes:
					patch.dailyLanguageMinutes !== undefined
						? Math.max(0, Math.min(360, Math.round(patch.dailyLanguageMinutes)))
						: modeChanged
							? defaults.dailyLanguageMinutes
							: state.pacing.dailyLanguageMinutes,
				dailyCtaMinutes:
					patch.dailyCtaMinutes !== undefined
						? Math.max(0, Math.min(240, Math.round(patch.dailyCtaMinutes)))
						: modeChanged
							? defaults.dailyCtaMinutes
							: state.pacing.dailyCtaMinutes,
				passiveVideoCapMinutes:
					patch.passiveVideoCapMinutes !== undefined
						? Math.max(30, Math.min(240, Math.round(patch.passiveVideoCapMinutes)))
						: modeChanged
							? defaults.passiveVideoCapMinutes
							: state.pacing.passiveVideoCapMinutes,
				startDate:
					patch.startDate !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(patch.startDate)
						? patch.startDate
						: state.pacing.startDate,
			};
			break;
		}

		case "toggle-module": {
			const { course, mod } = ensureModule(patch.courseId, patch.moduleId);
			const nextCompleted = patch.completed !== undefined ? patch.completed : !mod.completed;
			mod.completed = nextCompleted;
			mod.completedAt = nextCompleted ? nowIso : undefined;
			course.lastStudiedAt = nowIso;
			break;
		}

		case "update-module": {
			const { course, mod } = ensureModule(patch.courseId, patch.moduleId);
			if (patch.completed !== undefined) {
				mod.completed = patch.completed;
				mod.completedAt = patch.completed ? (mod.completedAt ?? nowIso) : undefined;
			}
			if (patch.loggedMinutes !== undefined) {
				mod.loggedMinutes = Math.round(clampNonNeg(patch.loggedMinutes, 100_000));
			}
			if (patch.addMinutes !== undefined && Number.isFinite(patch.addMinutes)) {
				mod.loggedMinutes = Math.round(
					clampNonNeg(mod.loggedMinutes + patch.addMinutes, 100_000),
				);
			}
			if (patch.notes !== undefined) {
				mod.notes = patch.notes;
			}
			if (patch.customLinks !== undefined) {
				mod.customLinks = patch.customLinks
					.filter((l) => l && typeof l.label === "string" && typeof l.url === "string")
					.map((l) => ({
						id: l.id || randomUUID(),
						label: l.label.trim(),
						url: assertSafeHttpUrl(l.url),
						addedAt: l.addedAt || nowIso,
					}));
			}
			course.lastStudiedAt = nowIso;
			break;
		}

		case "toggle-video-watched": {
			const { course, video } = ensureVideo(patch.courseId, patch.lessonId);
			const nextWatched = patch.watched !== undefined ? patch.watched : !video.watched;
			video.watched = nextWatched;
			video.watchedAt = nextWatched ? nowIso : undefined;
			if (patch.durationSec !== undefined && Number.isFinite(patch.durationSec) && patch.durationSec > 0) {
				video.durationSec = Math.round(patch.durationSec);
			}
			course.lastStudiedAt = nowIso;
			break;
		}

		case "update-video-progress": {
			const { course, video } = ensureVideo(patch.courseId, patch.lessonId);
			if (patch.positionSec !== undefined) {
				video.positionSec = Math.round(clampNonNeg(patch.positionSec, 86_400) * 10) / 10;
			}
			if (patch.durationSec !== undefined && Number.isFinite(patch.durationSec) && patch.durationSec > 0) {
				video.durationSec = Math.round(patch.durationSec * 10) / 10;
			}
			if (patch.notes !== undefined) {
				video.notes = patch.notes;
			}
			if (patch.watched !== undefined) {
				video.watched = patch.watched;
				video.watchedAt = patch.watched ? (video.watchedAt ?? nowIso) : undefined;
			} else if (
				!video.watched &&
				video.durationSec &&
				video.durationSec >= 30 &&
				video.positionSec >= video.durationSec * 0.92
			) {
				video.watched = true;
				video.watchedAt = nowIso;
			}
			course.lastStudiedAt = nowIso;
			break;
		}

		case "add-video-bookmark": {
			const { course, video } = ensureVideo(patch.courseId, patch.lessonId);
			const bookmark: TimestampNote = {
				id: randomUUID(),
				timeSec: Math.round(clampNonNeg(patch.timeSec, 86_400) * 10) / 10,
				label: patch.label.trim(),
				note: patch.note?.trim() || undefined,
				createdAt: nowIso,
			};
			video.bookmarks = [...video.bookmarks, bookmark].sort((a, b) => a.timeSec - b.timeSec);
			course.lastStudiedAt = nowIso;
			break;
		}

		case "remove-video-bookmark": {
			const { video } = ensureVideo(patch.courseId, patch.lessonId);
			video.bookmarks = video.bookmarks.filter((b) => b.id !== patch.bookmarkId);
			break;
		}

		case "update-course": {
			const course = ensureCourse(patch.courseId);
			if (patch.optedIn !== undefined) course.optedIn = patch.optedIn;
			if (patch.manualStatus !== undefined) course.manualStatus = patch.manualStatus;
			if (patch.courseNotes !== undefined) course.courseNotes = patch.courseNotes;
			course.lastStudiedAt = nowIso;
			break;
		}

		case "add-course-link": {
			const link: CustomResourceLink = {
				id: randomUUID(),
				label: assertNonEmptyString(patch.label, "label"),
				url: assertSafeHttpUrl(patch.url),
				addedAt: nowIso,
			};
			if (patch.moduleId) {
				const { course, mod } = ensureModule(patch.courseId, patch.moduleId);
				mod.customLinks = [...mod.customLinks, link];
				course.lastStudiedAt = nowIso;
			} else {
				const course = ensureCourse(patch.courseId);
				course.customLinks = [...course.customLinks, link];
				course.lastStudiedAt = nowIso;
			}
			break;
		}

		case "remove-course-link": {
			if (patch.moduleId) {
				const { mod } = ensureModule(patch.courseId, patch.moduleId);
				mod.customLinks = mod.customLinks.filter((l) => l.id !== patch.linkId);
			} else {
				const course = ensureCourse(patch.courseId);
				course.customLinks = course.customLinks.filter((l) => l.id !== patch.linkId);
			}
			break;
		}

		case "update-certification": {
			const spec = track.certifications.find((c) => c.id === patch.certId);
			if (!state.certifications[patch.certId]) {
				state.certifications[patch.certId] = spec
					? createDefaultCertificationState(spec)
					: {
							certId: patch.certId,
							status: "locked",
							completedCheckpoints: {},
							notes: "",
						};
			}
			const cert = state.certifications[patch.certId]!;
			if (patch.status !== undefined) {
				cert.status = patch.status;
				if (patch.status === "passed" && !cert.passedAt && patch.passedAt === undefined) {
					cert.passedAt = nowIso;
				}
			}
			if (patch.targetDate !== undefined) cert.targetDate = patch.targetDate ?? undefined;
			if (patch.scheduledAt !== undefined) cert.scheduledAt = patch.scheduledAt ?? undefined;
			if (patch.passedAt !== undefined) cert.passedAt = patch.passedAt ?? undefined;
			if (patch.credentialId !== undefined) cert.credentialId = patch.credentialId ?? undefined;
			if (patch.credentialUrl !== undefined) {
				cert.credentialUrl =
					patch.credentialUrl && patch.credentialUrl.trim()
						? assertSafeHttpUrl(patch.credentialUrl, "credentialUrl")
						: undefined;
			}
			if (patch.mockScorePct !== undefined) {
				cert.mockScorePct =
					patch.mockScorePct === null
						? undefined
						: Math.max(0, Math.min(100, Math.round(patch.mockScorePct * 10) / 10));
			}
			if (patch.notes !== undefined) cert.notes = patch.notes;
			break;
		}

		case "toggle-cert-checkpoint": {
			const spec = track.certifications.find((c) => c.id === patch.certId);
			if (!state.certifications[patch.certId]) {
				state.certifications[patch.certId] = spec
					? createDefaultCertificationState(spec)
					: {
							certId: patch.certId,
							status: "preparing",
							completedCheckpoints: {},
							notes: "",
						};
			}
			const cert = state.certifications[patch.certId]!;
			const key =
				patch.checkpointKey ??
				(patch.checkpointIndex !== undefined && patch.checkpointIndex >= 0
					? getCertificationCheckpointKey(patch.certId, patch.checkpointIndex)
					: null);
			if (!key) {
				throw new IntensiveValidationError(
					400,
					"Either checkpointKey or non-negative checkpointIndex is required.",
				);
			}
			const current = Boolean(cert.completedCheckpoints[key]);
			const nextVal = patch.completed !== undefined ? patch.completed : !current;
			cert.completedCheckpoints[key] = nextVal;
			if (nextVal && cert.status === "locked") {
				cert.status = "preparing";
			}
			break;
		}

		case "update-portfolio": {
			if (!state.portfolio[patch.projectId]) {
				state.portfolio[patch.projectId] = createDefaultPortfolioState(patch.projectId);
			}
			const proj = state.portfolio[patch.projectId]!;
			if (patch.status !== undefined) proj.status = patch.status;
			if (patch.repoUrl !== undefined) {
				proj.repoUrl =
					patch.repoUrl && patch.repoUrl.trim()
						? assertSafeHttpUrl(patch.repoUrl, "repoUrl")
						: undefined;
			}
			if (patch.notes !== undefined) proj.notes = patch.notes;
			break;
		}

		case "toggle-portfolio-deliverable": {
			if (!state.portfolio[patch.projectId]) {
				state.portfolio[patch.projectId] = createDefaultPortfolioState(patch.projectId);
			}
			const proj = state.portfolio[patch.projectId]!;
			const current = Boolean(proj.completedDeliverables[patch.deliverableId]);
			const nextVal = patch.completed !== undefined ? patch.completed : !current;
			proj.completedDeliverables[patch.deliverableId] = nextVal;
			if (nextVal && proj.status === "not-started") {
				proj.status = "in-progress";
			}
			break;
		}

		case "toggle-bench-interview": {
			const current = Boolean(state.benchInterviewChecked[patch.itemId]);
			state.benchInterviewChecked[patch.itemId] =
				patch.checked !== undefined ? patch.checked : !current;
			break;
		}

		case "toggle-bench-kit": {
			const current = Boolean(state.benchKitOwned[patch.itemId]);
			state.benchKitOwned[patch.itemId] = patch.owned !== undefined ? patch.owned : !current;
			break;
		}

		case "log-study": {
			const minutes = Math.max(1, Math.min(1440, Math.round(patch.minutes)));
			const date =
				patch.date && /^\d{4}-\d{2}-\d{2}$/.test(patch.date)
					? patch.date
					: nowIso.slice(0, 10);
			const entry: StudyLogEntry = {
				id: randomUUID(),
				date,
				minutes,
				category: patch.category,
				courseId: patch.courseId,
				lessonId: patch.lessonId,
				moduleId: patch.moduleId,
				certId: patch.certId,
				projectId: patch.projectId,
				note: patch.note || undefined,
				createdAt: nowIso,
			};
			state.studyLog = [...state.studyLog, entry].slice(-MAX_STUDY_LOG_ENTRIES);
			if (patch.courseId && isSafeIntensiveId(patch.courseId)) {
				const course = ensureCourse(patch.courseId);
				course.lastStudiedAt = nowIso;
				if (patch.moduleId) {
					const { mod } = ensureModule(patch.courseId, patch.moduleId);
					mod.loggedMinutes += minutes;
				}
			}
			break;
		}
	}

	writeIntensiveState(state);
	return getIntensiveDashboard(track.id);
}

// ─── Media Sources Management ────────────────────────────────────────────────

export function listIntensiveMediaSources(): Record<string, CourseMediaSource> {
	return listEffectiveMediaSources();
}

export function linkIntensiveMediaSource(input: {
	courseId: string;
	sourceDir: string;
	label?: string;
	language?: string;
	expectedTotalVideos?: number;
}): CourseMediaSource {
	const courseId = input.courseId?.trim() ?? "";
	if (!isSafeIntensiveId(courseId)) {
		throw new IntensiveValidationError(400, `Invalid courseId: ${courseId}`);
	}

	const rawDir = input.sourceDir?.trim() ?? "";
	if (!rawDir) {
		throw new IntensiveValidationError(400, "sourceDir is required.");
	}
	const resolvedDir = path.resolve(/* turbopackIgnore: true */ rawDir);
	let stat: fs.Stats | undefined;
	try {
		stat = fs.statSync(/* turbopackIgnore: true */ resolvedDir, { throwIfNoEntry: false });
	} catch {
		stat = undefined;
	}
	if (!stat || !stat.isDirectory()) {
		throw new IntensiveValidationError(
			400,
			`Directory does not exist or is not accessible: ${resolvedDir}`,
		);
	}

	const language = input.language?.trim() || "pt";
	if (!SAFE_LANG_RE.test(language)) {
		throw new IntensiveValidationError(400, `Invalid language code: ${language}`);
	}

	const expectedTotalVideos =
		typeof input.expectedTotalVideos === "number" &&
		Number.isFinite(input.expectedTotalVideos) &&
		input.expectedTotalVideos > 0
			? Math.floor(input.expectedTotalVideos)
			: undefined;

	const source: CourseMediaSource = {
		courseId,
		sourceDir: resolvedDir,
		label: input.label?.trim() || undefined,
		language,
		configuredAt: new Date().toISOString(),
		expectedTotalVideos,
	};

	const existing = readExplicitMediaSources();
	existing[courseId] = source;
	writeExplicitMediaSources(existing);
	return source;
}

export function unlinkIntensiveMediaSource(courseId: string): boolean {
	if (!isSafeIntensiveId(courseId)) return false;
	const existing = readExplicitMediaSources();
	if (!(courseId in existing)) return false;
	delete existing[courseId];
	writeExplicitMediaSources(existing);
	return true;
}

// ─── Transcripts & Secure Media Resolution ───────────────────────────────────

export function getIntensiveLessonTranscript(
	courseId: string,
	lessonId: string,
): LessonTranscriptDoc | null {
	return readLessonTranscript(courseId, lessonId);
}

export function getIntensiveLessonTranscriptFile(
	courseId: string,
	lessonId: string,
	format: "vtt" | "txt",
): { content: string; contentType: string } | null {
	return readLessonTranscriptFile(courseId, lessonId, format);
}

export function resolveIntensiveLessonMediaPath(
	courseId: string,
	lessonId: string,
	kind: "video" | "thumb",
): { absPath: string; contentType: string; size: number; fileName: string } | null {
	return resolveCourseLessonMedia(courseId, lessonId, kind);
}

// ─── Course Materials (PDFs, Apostilas, Exercises, Schematics) ───────────────

export function listIntensiveCourseMaterials(courseId: string): {
	courseId: string;
	sourceDir?: string;
	updatedAt?: string;
	totalFiles: number;
	indexedTextFiles: number;
	totalPages: number;
	totalWordCount: number;
	materials: CourseMaterialSummary[];
} | null {
	if (!isSafeIntensiveId(courseId)) return null;
	const idx = loadCourseMaterialsIndex(courseId);
	return {
		courseId: idx.courseId,
		...(idx.sourceDir ? { sourceDir: idx.sourceDir } : {}),
		...(idx.updatedAt ? { updatedAt: idx.updatedAt } : {}),
		totalFiles: idx.totalFiles,
		indexedTextFiles: idx.indexedTextFiles,
		totalPages: idx.totalPages,
		totalWordCount: idx.totalWordCount,
		materials: idx.materials,
	};
}

export function getIntensiveMaterialDoc(
	courseId: string,
	materialId: string,
): CourseMaterialDoc | null {
	return readCourseMaterialDoc(courseId, materialId);
}

export function resolveIntensiveMaterialFilePath(
	courseId: string,
	materialId: string,
): { absPath: string; contentType: string; size: number; fileName: string } | null {
	return resolveCourseMaterialFile(courseId, materialId);
}

// ─── Full-Text BM25 Transcript + Materials + Syllabus Search ─────────────────

const SEARCH_NOISE_STOPWORDS = new Set([
	"a",
	"o",
	"e",
	"de",
	"da",
	"do",
	"das",
	"dos",
	"em",
	"no",
	"na",
	"nos",
	"nas",
	"um",
	"uma",
	"para",
	"por",
	"com",
	"sem",
	"que",
	"se",
	"ao",
	"os",
	"as",
	"ou",
	"como",
	"mais",
	"mas",
	"foi",
	"sao",
	"ser",
	"esta",
	"esse",
	"essa",
	"isso",
	"aqui",
	"entao",
	"voce",
	"the",
	"and",
	"for",
	"with",
	"that",
	"this",
	"from",
	"are",
	"was",
	"were",
	"have",
	"has",
	"not",
	"but",
	"into",
	"about",
	"can",
	"will",
]);

const CURRICULUM_BRIDGE_NOISE = new Set([
	...SEARCH_NOISE_STOPWORDS,
	"aula",
	"aulas",
	"curso",
	"cursos",
	"modulo",
	"modulos",
	"video",
	"videos",
	"parte",
	"partes",
	"introducao",
	"capitulo",
	"pdf",
	"doc",
	"docx",
	"zip",
	"cta",
	"eletronica",
	"electronics",
	"gratis",
	"gratuito",
	"trilha",
	"tier",
	"exercicio",
	"exercicios",
	"apostila",
	"apostilas",
	"material",
	"materiais",
	"completo",
	"completa",
	"basico",
	"basica",
	"pratica",
	"pratico",
	"teoria",
	"revisao",
	"resumo",
	"estudo",
	"prof",
	"mario",
	"pinheiro",
]);

const SHORT_TECHNICAL_TOKENS = new Set([
	"ac",
	"dc",
	"cc",
	"ca",
	"rf",
	"ic",
	"rc",
	"rl",
	"lc",
	"op",
	"io",
	"hv",
	"lv",
	"em",
	"si",
	"v",
	"hz",
]);

function buildCourseTitleMap(track: IntensiveTrackSpec): Map<string, string> {
	const courseTitleMap = new Map<string, string>();
	for (const c of track.courses) {
		courseTitleMap.set(c.id, c.title);
	}
	const sources = listEffectiveMediaSources();
	for (const [cid, src] of Object.entries(sources)) {
		if (!courseTitleMap.has(cid)) {
			courseTitleMap.set(cid, src.label || cid);
		}
	}
	return courseTitleMap;
}

function effectiveQueryTokens(query: string): string[] {
	const raw = tokenizeSearchText(query);
	if (raw.length === 0) return [];
	const nonStop = raw.filter((t) => !SEARCH_NOISE_STOPWORDS.has(t) || t.length >= 4);
	return nonStop.length > 0 ? nonStop : raw;
}

function tokenPresentInNormalized(token: string, normText: string, tokenSet: Set<string>): boolean {
	if (!normText) return false;
	if (tokenSet.has(token)) return true;
	if (token.includes("-")) {
		if (tokenSet.has(token.replace(/-/g, ""))) return true;
		if (normText.includes(token.replace(/-/g, " "))) return true;
	}
	if (token.length >= 4) {
		for (const candidate of tokenSet) {
			if (candidate.startsWith(token) || (token.length >= 5 && candidate.includes(token))) {
				return true;
			}
		}
	}
	return false;
}

function buildTokenSet(normText: string): { set: Set<string>; count: number } {
	const set = new Set<string>();
	if (!normText) return { set, count: 0 };
	const parts = normText.split(" ").filter(Boolean);
	for (const token of parts) {
		set.add(token);
		if (token.includes("-")) {
			const collapsed = token.replace(/-/g, "");
			if (collapsed) set.add(collapsed);
			for (const sub of token.split("-")) {
				if (sub) set.add(sub);
			}
		}
	}
	return { set, count: parts.length };
}

function buildFocusedSnippet(rawText: string, queryTokens: string[], maxLen = 240): string {
	const cleaned = rawText.replace(/\s+/g, " ").trim();
	if (cleaned.length <= maxLen) return cleaned;

	const normLower = normalizeSearchText(cleaned);
	let bestIdx = -1;
	for (const token of queryTokens) {
		const pos = normLower.indexOf(token);
		if (pos !== -1 && (bestIdx === -1 || pos < bestIdx)) {
			bestIdx = pos;
		}
	}

	if (bestIdx < 0) {
		return `${cleaned.slice(0, maxLen - 1).trimEnd()}…`;
	}

	const approxOrigin = Math.min(cleaned.length - 1, bestIdx);
	const start = Math.max(0, approxOrigin - Math.floor(maxLen * 0.35));
	const end = Math.min(cleaned.length, start + maxLen);

	const prefix = start > 0 ? "…" : "";
	const suffix = end < cleaned.length ? "…" : "";
	return `${prefix}${cleaned.slice(start, end).trim()}${suffix}`;
}

function toSearchableTranscriptDoc(
	doc: LessonTranscriptDoc,
	courseTitle: string,
): SearchableTranscriptDoc {
	const chunks =
		doc.chunks.length > 0
			? doc.chunks
			: doc.fullText
				? [{ index: 0, start: 0, end: doc.durationSec, text: doc.fullText }]
				: [];
	return {
		courseId: doc.courseId,
		courseTitle,
		lessonId: doc.lessonId,
		lessonTitle: doc.title,
		order: doc.order,
		chunks,
		telegramCaption: doc.telegramCaption,
	};
}

export function searchIntensiveMaterials(input: {
	query: string;
	courseId?: string;
	courseIds?: string[];
	trackId?: string;
	limit?: number;
	snippetMaxLen?: number;
}): IntensiveMaterialSearchHit[] {
	const query = input.query.trim();
	const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 20)));
	const snippetMaxLen = Math.max(80, Math.min(600, Math.floor(input.snippetMaxLen ?? 240)));
	if (!query) return [];

	const tokens = effectiveQueryTokens(query);
	if (tokens.length === 0) return [];
	const uniqueTokens = Array.from(new Set(tokens));

	const track = resolveTrack(input.trackId);
	const courseTitleMap = buildCourseTitleMap(track);

	let targetCourseIds: string[];
	if (input.courseIds && input.courseIds.length > 0) {
		targetCourseIds = input.courseIds.filter((id) => isSafeIntensiveId(id));
	} else if (input.courseId?.trim()) {
		targetCourseIds = isSafeIntensiveId(input.courseId.trim()) ? [input.courseId.trim()] : [];
	} else {
		targetCourseIds = listKnownMaterialCourseIds();
	}

	if (targetCourseIds.length === 0) return [];

	interface PreparedMaterialChunk {
		courseId: string;
		courseTitle: string;
		materialId: string;
		materialTitle: string;
		fileName: string;
		section: string;
		category: MaterialCategory;
		page?: number;
		chunkIndex: number;
		text: string;
		titleBoost: string;
		normBody: string;
		normTitle: string;
		bodySet: Set<string>;
		titleSet: Set<string>;
		metadataOnly: boolean;
	}

	const prepared: PreparedMaterialChunk[] = [];
	const df = new Map<string, number>();
	let totalTokenLen = 0;

	for (const cid of targetCourseIds) {
		const courseTitle = courseTitleMap.get(cid) ?? cid;
		const matIdx = loadCourseMaterialsIndex(cid);
		const matDocs = loadAllCourseMaterialDocs(cid);
		const docsWithChunks = new Set<string>();

		for (const doc of matDocs) {
			if (doc.chunks.length === 0) continue;
			docsWithChunks.add(doc.materialId);
			const titleBoost = [doc.title, doc.section, doc.fileName].filter(Boolean).join(" ");
			const normTitle = normalizeSearchText(titleBoost);
			const titleStats = buildTokenSet(normTitle);

			for (const chunk of doc.chunks) {
				const normBody = normalizeSearchText(chunk.text);
				const bodyStats = buildTokenSet(normBody);
				totalTokenLen += bodyStats.count;

				for (const token of uniqueTokens) {
					if (
						tokenPresentInNormalized(token, normBody, bodyStats.set) ||
						tokenPresentInNormalized(token, normTitle, titleStats.set)
					) {
						df.set(token, (df.get(token) ?? 0) + 1);
					}
				}

				prepared.push({
					courseId: cid,
					courseTitle,
					materialId: doc.materialId,
					materialTitle: doc.title,
					fileName: doc.fileName,
					section: doc.section,
					category: doc.category,
					...(chunk.page !== undefined ? { page: chunk.page } : {}),
					chunkIndex: chunk.index,
					text: chunk.text,
					titleBoost,
					normBody,
					normTitle,
					bodySet: bodyStats.set,
					titleSet: titleStats.set,
					metadataOnly: false,
				});
			}
		}

		// Also allow title/section discovery for non-text files (schematics, images, archives).
		for (const summary of matIdx.materials) {
			if (docsWithChunks.has(summary.materialId)) continue;
			const metaText = [summary.title, summary.section, summary.fileName].filter(Boolean).join(" — ");
			const titleBoost = [summary.title, summary.section].filter(Boolean).join(" ");
			const normBody = normalizeSearchText(metaText);
			const normTitle = normalizeSearchText(titleBoost);
			const bodyStats = buildTokenSet(normBody);
			const titleStats = buildTokenSet(normTitle);
			totalTokenLen += bodyStats.count;

			for (const token of uniqueTokens) {
				if (
					tokenPresentInNormalized(token, normBody, bodyStats.set) ||
					tokenPresentInNormalized(token, normTitle, titleStats.set)
				) {
					df.set(token, (df.get(token) ?? 0) + 1);
				}
			}

			prepared.push({
				courseId: cid,
				courseTitle,
				materialId: summary.materialId,
				materialTitle: summary.title,
				fileName: summary.fileName,
				section: summary.section,
				category: summary.category,
				chunkIndex: 0,
				text: metaText,
				titleBoost,
				normBody,
				normTitle,
				bodySet: bodyStats.set,
				titleSet: titleStats.set,
				metadataOnly: true,
			});
		}
	}

	if (prepared.length === 0) return [];

	const totalChunks = prepared.length;
	const avgDocTokens = Math.max(10, totalTokenLen / totalChunks);
	const idfMap = new Map<string, number>();
	for (const token of uniqueTokens) {
		const docFreq = df.get(token) ?? 0;
		const idf = Math.log(1 + (totalChunks - docFreq + 0.5) / (docFreq + 0.5));
		idfMap.set(token, Math.max(0.25, idf));
	}

	const rawHits: IntensiveMaterialSearchHit[] = [];
	for (const item of prepared) {
		const baseScore = scoreTextMatch(tokens, item.text, item.titleBoost, idfMap, avgDocTokens);
		if (baseScore <= 0) continue;
		const score = item.metadataOnly ? Math.round(baseScore * 0.55 * 1000) / 1000 : baseScore;

		const matchedTokens = uniqueTokens.filter(
			(token) =>
				tokenPresentInNormalized(token, item.normBody, item.bodySet) ||
				tokenPresentInNormalized(token, item.normTitle, item.titleSet),
		);
		if (matchedTokens.length === 0) continue;

		rawHits.push({
			courseId: item.courseId,
			courseTitle: item.courseTitle,
			materialId: item.materialId,
			materialTitle: item.materialTitle,
			fileName: item.fileName,
			section: item.section,
			category: item.category,
			...(item.page !== undefined ? { page: item.page } : {}),
			chunkIndex: item.chunkIndex,
			snippet: buildFocusedSnippet(item.text, matchedTokens, snippetMaxLen),
			score,
			matchedTokens,
		});
	}

	rawHits.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		if (a.materialTitle !== b.materialTitle) return a.materialTitle.localeCompare(b.materialTitle);
		if ((a.page ?? 0) !== (b.page ?? 0)) return (a.page ?? 0) - (b.page ?? 0);
		return a.chunkIndex - b.chunkIndex;
	});

	// Keep diversity across multi-page PDFs (up to 3 top chunks per material when limit <= 20).
	const maxPerMaterial = limit <= 20 ? 3 : 6;
	const perMaterialCount = new Map<string, number>();
	const results: IntensiveMaterialSearchHit[] = [];
	for (const hit of rawHits) {
		const key = `${hit.courseId}:${hit.materialId}`;
		const count = perMaterialCount.get(key) ?? 0;
		if (count >= maxPerMaterial) continue;
		perMaterialCount.set(key, count + 1);
		results.push(hit);
		if (results.length >= limit) break;
	}

	return results;
}

export function searchIntensiveCatalog(input: {
	query: string;
	courseId?: string;
	trackId?: string;
	limit?: number;
}): {
	transcriptHits: IntensiveSearchHit[];
	moduleHits: Array<{
		courseId: string;
		courseTitle: string;
		moduleId: string;
		moduleTitle: string;
		score: number;
		snippet: string;
	}>;
	materialHits: IntensiveMaterialSearchHit[];
} {
	const query = input.query.trim();
	const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 20)));
	if (!query) {
		return { transcriptHits: [], moduleHits: [], materialHits: [] };
	}

	const track = resolveTrack(input.trackId);
	const courseTitleMap = buildCourseTitleMap(track);

	// 1. Transcript chunk BM25 search
	const targetCourseIds = input.courseId?.trim()
		? isSafeIntensiveId(input.courseId.trim())
			? [input.courseId.trim()]
			: []
		: listKnownMediaCourseIds();

	const searchableDocs: SearchableTranscriptDoc[] = [];
	for (const cid of targetCourseIds) {
		const courseTitle = courseTitleMap.get(cid) ?? cid;
		const docs = loadAllCourseTranscripts(cid);
		for (const doc of docs) {
			searchableDocs.push(toSearchableTranscriptDoc(doc, courseTitle));
		}
	}

	const transcriptHits = searchTranscriptChunks(query, searchableDocs, limit);

	// 2. Extracted materials BM25 search
	const materialHits = searchIntensiveMaterials({
		query,
		courseId: input.courseId,
		trackId: track.id,
		limit,
	});

	// 3. Syllabus module search
	const queryTokens = tokenizeSearchText(query);
	const moduleHits: Array<{
		courseId: string;
		courseTitle: string;
		moduleId: string;
		moduleTitle: string;
		score: number;
		snippet: string;
	}> = [];

	if (queryTokens.length > 0) {
		const coursesToScan = input.courseId?.trim()
			? track.courses.filter((c) => c.id === input.courseId?.trim())
			: track.courses;

		for (const course of coursesToScan) {
			for (const mod of course.modules) {
				const bodyText = [
					mod.topics.join(" · "),
					mod.benchExercise ?? "",
					course.tutorSyllabusContext,
				]
					.filter(Boolean)
					.join(" ");
				const score = scoreTextMatch(queryTokens, bodyText, `${course.title} ${mod.title}`);
				if (score <= 0) continue;

				const rawSnippet = [
					mod.topics.slice(0, 4).join(" · "),
					mod.benchExercise ? `Bancada: ${mod.benchExercise}` : "",
				]
					.filter(Boolean)
					.join(" — ");

				moduleHits.push({
					courseId: course.id,
					courseTitle: course.title,
					moduleId: mod.id,
					moduleTitle: mod.title,
					score,
					snippet: truncateText(rawSnippet || course.whyThisPosition, 240),
				});
			}
		}

		moduleHits.sort((a, b) => b.score - a.score);
	}

	return {
		transcriptHits,
		moduleHits: moduleHits.slice(0, limit),
		materialHits,
	};
}

// ─── Curriculum Node Bridge & Domain-Wide Knowledge Hooks ────────────────────

interface PreparedCurriculumNode {
	nodeId: string;
	kind: CurriculumItem["kind"];
	title: string;
	regionId: string;
	regionTitle?: string;
	titleText: string;
	bodyText: string;
	normTitle: string;
	normBody: string;
	titleSet: Set<string>;
	bodySet: Set<string>;
}

const preparedCurriculumCache = new WeakMap<CurriculumSnapshot, PreparedCurriculumNode[]>();

function safeLoadCurriculumSnapshot(domainId: string): CurriculumSnapshot | null {
	if (!domainId) return null;
	try {
		const store = studyDomains();
		const manifest = store.readManifest(domainId);
		if (!manifest) return null;
		const loaded = loadCurriculum(domainId, manifest);
		return loaded?.snapshot ?? null;
	} catch {
		return null;
	}
}

function getPreparedCurriculumNodes(snapshot: CurriculumSnapshot): PreparedCurriculumNode[] {
	const cached = preparedCurriculumCache.get(snapshot);
	if (cached) return cached;

	const nodes: PreparedCurriculumNode[] = [];
	const items = snapshot.items;

	const resolveRegion = (item: CurriculumItem): { regionId: string; regionTitle?: string } => {
		if (item.kind === "unit") {
			const parent = item.parentId ? items[item.parentId] : undefined;
			const parentTitle = parent ? parent.title.pt || parent.title.en : undefined;
			return { regionId: item.id, regionTitle: parentTitle };
		}
		let curr: CurriculumItem | undefined = item;
		let guard = 0;
		while (curr && curr.parentId && guard < 12) {
			const parent: CurriculumItem | undefined = items[curr.parentId];
			if (!parent) break;
			if (parent.kind === "unit") {
				return { regionId: parent.id, regionTitle: parent.title.pt || parent.title.en };
			}
			curr = parent;
			guard += 1;
		}
		return { regionId: item.parentId ?? item.id };
	};

	for (const item of Object.values(items)) {
		if (item.status === "deprecated") continue;
		if (item.kind !== "unit" && item.kind !== "topic" && item.kind !== "atom") continue;

		const title = item.title.pt || item.title.en || item.id;
		const { regionId, regionTitle } = resolveRegion(item);
		const titleText = [item.title.pt, item.title.en, ...(item.aliases ?? [])]
			.filter(Boolean)
			.join(" ");
		const bodyText = [
			item.summary,
			item.scope,
			...(item.objectives ?? []),
			...(item.tags ?? []),
		]
			.filter(Boolean)
			.join(" ");
		const normTitle = normalizeSearchText(titleText);
		const normBody = normalizeSearchText(bodyText);
		const titleStats = buildTokenSet(normTitle);
		const bodyStats = buildTokenSet(normBody);

		nodes.push({
			nodeId: item.id,
			kind: item.kind,
			title,
			regionId,
			...(regionTitle ? { regionTitle } : {}),
			titleText,
			bodyText,
			normTitle,
			normBody,
			titleSet: titleStats.set,
			bodySet: bodyStats.set,
		});
	}

	preparedCurriculumCache.set(snapshot, nodes);
	return nodes;
}

/**
 * Safely scores `electronics` (or specified domain) curriculum units/topics/atoms
 * against an intensive course's title, modules, transcribed lesson titles, and
 * indexed material titles. Never throws even if the curriculum/data dir is empty.
 */
export function matchCurriculumNodesForIntensive(input: {
	courseId?: string;
	trackId?: string;
	domainId?: string;
	extraTerms?: string[];
	limit?: number;
}): CurriculumNodeMatch[] {
	const limit = Math.max(1, Math.min(20, Math.floor(input.limit ?? 8)));
	const track = resolveTrack(input.trackId);
	const domainId = input.domainId?.trim() || track.domainId || "electronics";

	const snapshot = safeLoadCurriculumSnapshot(domainId);
	if (!snapshot) return [];

	const nodes = getPreparedCurriculumNodes(snapshot);
	if (nodes.length === 0) return [];

	const courseSpec = input.courseId ? track.courses.find((c) => c.id === input.courseId) : undefined;
	const weightedTextParts: Array<{ text: string; weight: number }> = [];

	if (input.extraTerms && input.extraTerms.length > 0) {
		for (const term of input.extraTerms) {
			if (term.trim()) weightedTextParts.push({ text: term, weight: 3 });
		}
	}

	if (courseSpec) {
		weightedTextParts.push({ text: courseSpec.title, weight: 3 });
		for (const mod of courseSpec.modules) {
			weightedTextParts.push({ text: mod.title, weight: 2 });
			if (mod.topics.length > 0) {
				weightedTextParts.push({ text: mod.topics.join(" "), weight: 1.5 });
			}
		}
	} else if (!input.extraTerms?.length) {
		weightedTextParts.push({ text: `${track.title} ${track.subtitle}`, weight: 2 });
	}

	if (input.courseId && isSafeIntensiveId(input.courseId)) {
		const mediaIdx = loadCourseMediaIndex(input.courseId);
		const transcribed = mediaIdx.lessons.filter((l) => l.transcriptStatus === "ready");
		const sampleLessons = (transcribed.length > 0 ? transcribed : mediaIdx.lessons).slice(0, 40);
		for (const lesson of sampleLessons) {
			weightedTextParts.push({ text: lesson.title, weight: 1.5 });
			if (lesson.telegramCaption) {
				weightedTextParts.push({ text: lesson.telegramCaption, weight: 1 });
			}
		}

		const matIdx = loadCourseMaterialsIndex(input.courseId);
		for (const mat of matIdx.materials.slice(0, 30)) {
			weightedTextParts.push({ text: `${mat.title} ${mat.section}`, weight: 1 });
		}
	}

	// Build a ranked, deduplicated technical query vocabulary (max 42 terms).
	const tokenWeights = new Map<string, number>();
	for (const part of weightedTextParts) {
		for (const tok of tokenizeSearchText(part.text)) {
			if (CURRICULUM_BRIDGE_NOISE.has(tok)) continue;
			if (/^\d+$/.test(tok)) continue;
			if (tok.length < 3 && !SHORT_TECHNICAL_TOKENS.has(tok)) continue;
			tokenWeights.set(tok, (tokenWeights.get(tok) ?? 0) + part.weight);
		}
	}

	const queryTokens = Array.from(tokenWeights.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, 42)
		.map(([tok]) => tok);

	if (queryTokens.length === 0) return [];

	// Compute IDF across the curriculum graph so rare technical terms (e.g. mosfet, smps, kicad,
	// osciloscopio, thevenin) outrank broad words appearing in every node.
	const df = new Map<string, number>();
	for (const node of nodes) {
		for (const tok of queryTokens) {
			if (
				tokenPresentInNormalized(tok, node.normTitle, node.titleSet) ||
				tokenPresentInNormalized(tok, node.normBody, node.bodySet)
			) {
				df.set(tok, (df.get(tok) ?? 0) + 1);
			}
		}
	}
	const idfMap = new Map<string, number>();
	for (const tok of queryTokens) {
		const docFreq = df.get(tok) ?? 0;
		const idf = Math.log(1 + (nodes.length - docFreq + 0.5) / (docFreq + 0.5));
		idfMap.set(tok, Math.max(0.25, idf));
	}

	const scored: Array<CurriculumNodeMatch & { regionId: string }> = [];
	for (const node of nodes) {
		const matchedTerms = queryTokens.filter(
			(tok) =>
				tokenPresentInNormalized(tok, node.normTitle, node.titleSet) ||
				tokenPresentInNormalized(tok, node.normBody, node.bodySet),
		);
		if (matchedTerms.length === 0) continue;

		const rawScore = scoreTextMatch(matchedTerms, node.bodyText, node.titleText, idfMap, 45);
		if (rawScore <= 0) continue;

		// Prefer units/topics slightly so links give strong navigational anchors on the map.
		const kindBoost = node.kind === "unit" ? 1.15 : node.kind === "topic" ? 1.08 : 1.0;
		const termRichnessBoost = 1 + Math.min(0.6, (matchedTerms.length - 1) * 0.15);
		const score = Math.round(rawScore * kindBoost * termRichnessBoost * 1000) / 1000;

		scored.push({
			nodeId: node.nodeId,
			title: node.title,
			...(node.regionTitle ? { regionTitle: node.regionTitle } : {}),
			score,
			matchedTerms: matchedTerms.slice(0, 6),
			regionId: node.regionId,
		});
	}

	scored.sort((a, b) =>
		b.score !== a.score ? b.score - a.score : a.nodeId.localeCompare(b.nodeId),
	);

	// Cap at 2 matches per enclosing unit so results span multiple relevant regions.
	const regionCounts = new Map<string, number>();
	const selected: CurriculumNodeMatch[] = [];
	for (const entry of scored) {
		const count = regionCounts.get(entry.regionId) ?? 0;
		if (count >= 2) continue;
		regionCounts.set(entry.regionId, count + 1);
		selected.push({
			nodeId: entry.nodeId,
			title: entry.title,
			...(entry.regionTitle ? { regionTitle: entry.regionTitle } : {}),
			score: entry.score,
			matchedTerms: entry.matchedTerms,
		});
		if (selected.length >= limit) break;
	}

	return selected;
}

function resolveDomainIntensiveCourses(domainId: string | null): {
	tracks: IntensiveTrackSpec[];
	courseIds: string[];
	courseTitleMap: Map<string, string>;
} | null {
	if (!domainId) return null;
	const allTracks = listEffectiveIntensiveTracks();
	const primaryTrackId = readCustomIntensiveTrack()?.id ?? DEFAULT_INTENSIVE_TRACK_ID;
	const tracks = allTracks.filter((t) => t.domainId === domainId);
	if (tracks.length === 0) return null;

	const otherDomainCourseIds = new Set<string>();
	for (const other of allTracks) {
		if (other.domainId !== domainId) {
			for (const c of other.courses) otherDomainCourseIds.add(c.id);
		}
	}

	const courseIds = new Set<string>();
	const courseTitleMap = new Map<string, string>();
	for (const track of tracks) {
		for (const c of track.courses) {
			courseIds.add(c.id);
			courseTitleMap.set(c.id, c.title);
		}
	}

	// Include auto-discovered media/material courses for the active default track domain
	// (unless explicitly claimed by a track belonging to a different domain).
	if (tracks.some((t) => t.id === primaryTrackId)) {
		const sources = listEffectiveMediaSources();
		for (const cid of [...listKnownMediaCourseIds(), ...listKnownMaterialCourseIds()]) {
			if (otherDomainCourseIds.has(cid)) continue;
			courseIds.add(cid);
			if (!courseTitleMap.has(cid)) {
				courseTitleMap.set(cid, sources[cid]?.label || cid);
			}
		}
	}

	return {
		tracks,
		courseIds: Array.from(courseIds),
		courseTitleMap,
	};
}

/**
 * Returns true if any intensive track targets `domainId` AND has at least 1
 * transcribed video lesson OR 1 indexed course material on disk.
 */
export function hasIntensiveKnowledgeForDomain(domainId: string | null): boolean {
	const resolved = resolveDomainIntensiveCourses(domainId);
	if (!resolved) return false;
	for (const cid of resolved.courseIds) {
		if (courseHasTranscribedVideos(cid) || courseHasIndexedMaterials(cid)) {
			return true;
		}
	}
	return false;
}

/**
 * Builds a tightly bounded ephemeral memory snippet from transcribed Intensive
 * video lessons (with `[MM:SS]` timestamps) and extracted CTA PDF/apostila
 * passages (with page numbers) for regular domain chats & curriculum lessons.
 */
export function buildDomainIntensiveMemory(input: {
	domainId: string;
	query: string;
	focusNodeTitles?: string[];
	maxChars?: number;
}): string {
	const maxChars = Math.max(240, Math.min(4000, Math.floor(input.maxChars ?? 1600)));
	const resolved = resolveDomainIntensiveCourses(input.domainId);
	if (!resolved) return "";

	const focusParts = (input.focusNodeTitles ?? [])
		.map((s) => s.trim())
		.filter(Boolean)
		.slice(0, 4);
	const combinedQuery = [...focusParts, input.query.trim()].filter(Boolean).join(" ").trim();
	if (!combinedQuery) return "";

	// 1. Transcribed video lessons across the domain's intensive courses
	const searchableDocs: SearchableTranscriptDoc[] = [];
	for (const cid of resolved.courseIds) {
		const courseTitle = resolved.courseTitleMap.get(cid) ?? cid;
		const docs = loadAllCourseTranscripts(cid);
		for (const doc of docs) {
			searchableDocs.push(toSearchableTranscriptDoc(doc, courseTitle));
		}
	}
	const transcriptHits =
		searchableDocs.length > 0 ? searchTranscriptChunks(combinedQuery, searchableDocs, 3) : [];

	// 2. Extracted PDFs / apostilas / schematics across the domain's intensive courses
	const materialHits = searchIntensiveMaterials({
		query: combinedQuery,
		courseIds: resolved.courseIds,
		trackId: resolved.tracks[0]?.id,
		limit: 3,
		snippetMaxLen: 200,
	});

	if (transcriptHits.length === 0 && materialHits.length === 0) return "";

	const lines: string[] = [
		"### Referências dos Cursos Intensivos & Materiais Locais (Transcrições + PDFs)",
	];

	if (transcriptHits.length > 0) {
		lines.push("**Vídeo-aulas transcritas relacionadas:**");
		for (const hit of transcriptHits.slice(0, 3)) {
			lines.push(
				`- [${hit.courseTitle} · #${hit.order} ${hit.lessonTitle} @ [${hit.timestampLabel}]] (courseId=${hit.courseId}, lessonId=${hit.lessonId}): ${truncateText(hit.snippet, 190)}`,
			);
		}
	}

	if (materialHits.length > 0) {
		lines.push("**Apostilas e materiais (PDFs/esquemas):**");
		for (const hit of materialHits.slice(0, 3)) {
			const pageTag = hit.page !== undefined ? `, pág. ${hit.page}` : "";
			lines.push(
				`- [${hit.courseTitle} · ${hit.materialTitle}${pageTag}] (courseId=${hit.courseId}, materialId=${hit.materialId}): ${truncateText(hit.snippet, 190)}`,
			);
		}
	}

	lines.push(
		"Ferramentas disponíveis sob demanda: search_intensive_course, get_intensive_transcript e search_intensive_materials.",
	);

	// Strictly enforce maxChars on line boundaries.
	const bounded: string[] = [];
	let totalLen = 0;
	for (const line of lines) {
		const added = bounded.length === 0 ? line.length : line.length + 1;
		if (totalLen + added > maxChars) {
			if (bounded.length === 0) {
				bounded.push(truncateText(line, maxChars));
			}
			break;
		}
		bounded.push(line);
		totalLen += added;
	}

	return bounded.join("\n");
}

// ─── GPU Transcription Worker Launcher & Monitor ─────────────────────────────

function resolveTranscriberPython(): { ok: true; pythonPath: string } | { ok: false; error: string } {
	const envOverride = process.env.LH_TRANSCRIBER_PYTHON?.trim();
	if (envOverride) {
		if (fs.existsSync(/* turbopackIgnore: true */ envOverride)) {
			return { ok: true, pythonPath: envOverride };
		}
		return {
			ok: false,
			error: `LH_TRANSCRIBER_PYTHON points to a missing executable: ${envOverride}`,
		};
	}

	const localAppData = process.env.LOCALAPPDATA?.trim();
	if (localAppData) {
		const winVenvPython = path.join(
			/* turbopackIgnore: true */ localAppData,
			"TrilhaAtlas",
			"transcriber-venv",
			"Scripts",
			"python.exe",
		);
		if (fs.existsSync(/* turbopackIgnore: true */ winVenvPython)) {
			return { ok: true, pythonPath: winVenvPython };
		}
	}

	const posixVenvPython = path.join(
		/* turbopackIgnore: true */ os.homedir(),
		".local",
		"share",
		"TrilhaAtlas",
		"transcriber-venv",
		"bin",
		"python",
	);
	if (fs.existsSync(/* turbopackIgnore: true */ posixVenvPython)) {
		return { ok: true, pythonPath: posixVenvPython };
	}

	return {
		ok: false,
		error:
			"Transcriber Python virtualenv not found. Set LH_TRANSCRIBER_PYTHON or create %LOCALAPPDATA%\\TrilhaAtlas\\transcriber-venv.",
	};
}

function resolveTranscriberScript(): string | null {
	const cwdCandidate = path.join(
		/* turbopackIgnore: true */ process.cwd(),
		"scripts",
		"intensive-transcribe.py",
	);
	if (fs.existsSync(/* turbopackIgnore: true */ cwdCandidate)) {
		return cwdCandidate;
	}
	const rootCandidate = path.join(
		/* turbopackIgnore: true */ PATHS.root,
		"scripts",
		"intensive-transcribe.py",
	);
	if (fs.existsSync(/* turbopackIgnore: true */ rootCandidate)) {
		return rootCandidate;
	}
	return null;
}

export function getIntensiveTranscriptionStatuses(): Record<string, CourseTranscriptionStatus> {
	const statuses: Record<string, CourseTranscriptionStatus> = {};
	for (const courseId of listKnownMediaCourseIds()) {
		const idx = loadCourseMediaIndex(courseId);
		if (idx.status) {
			statuses[courseId] = idx.status;
		}
	}
	return statuses;
}

export function startIntensiveTranscription(input: {
	courseId: string;
	sourceDir?: string;
	mode?: "watch" | "once";
	language?: string;
	model?: string;
}): { ok: boolean; status?: CourseTranscriptionStatus; error?: string } {
	const courseId = input.courseId?.trim() ?? "";
	if (!isSafeIntensiveId(courseId)) {
		return { ok: false, error: `Invalid courseId: ${courseId}` };
	}

	// Prevent duplicate workers when an existing PID in status.json is still alive.
	const existingRawStatus = readRawCourseStatus(courseId);
	if (existingRawStatus) {
		const normalized = normalizeRawCourseStatus(courseId, existingRawStatus);
		if (
			(normalized.state === "running" || normalized.state === "watching") &&
			isProcessAlive(normalized.pid)
		) {
			return { ok: true, status: normalized };
		}
	}

	const effectiveSources = listEffectiveMediaSources();
	const existingSource = effectiveSources[courseId];
	const resolvedSourceDirRaw = input.sourceDir?.trim() || existingSource?.sourceDir || "";
	if (!resolvedSourceDirRaw) {
		return {
			ok: false,
			error: `No media sourceDir linked for course '${courseId}'. Link a folder first.`,
		};
	}

	const resolvedSourceDir = path.resolve(/* turbopackIgnore: true */ resolvedSourceDirRaw);
	let dirStat: fs.Stats | undefined;
	try {
		dirStat = fs.statSync(/* turbopackIgnore: true */ resolvedSourceDir, { throwIfNoEntry: false });
	} catch {
		dirStat = undefined;
	}
	if (!dirStat || !dirStat.isDirectory()) {
		return {
			ok: false,
			error: `Source directory does not exist: ${resolvedSourceDir}`,
		};
	}

	const track = resolveTrack();
	const courseSpec = track.courses.find((c) => c.id === courseId);
	const defaultLang = existingSource?.language || (courseSpec?.language?.startsWith("en") ? "en" : "pt");
	const language = input.language?.trim() || defaultLang;
	if (!SAFE_LANG_RE.test(language)) {
		return { ok: false, error: `Invalid language code: ${language}` };
	}

	const model = input.model?.trim() || "large-v3-turbo";
	if (!SAFE_MODEL_RE.test(model)) {
		return { ok: false, error: `Invalid Whisper model identifier: ${model}` };
	}

	const pythonResolution = resolveTranscriberPython();
	if (!pythonResolution.ok) {
		return { ok: false, error: pythonResolution.error };
	}

	const scriptPath = resolveTranscriberScript();
	if (!scriptPath) {
		return {
			ok: false,
			error: "Transcription script scripts/intensive-transcribe.py was not found.",
		};
	}

	// Ensure explicit source linkage if caller supplied sourceDir for an unlinked course.
	if (input.sourceDir?.trim() && !existingSource) {
		try {
			linkIntensiveMediaSource({
				courseId,
				sourceDir: resolvedSourceDir,
				language,
				expectedTotalVideos: courseSpec?.expectedTotalVideos,
			});
		} catch {
			// Non-fatal: continue with resolvedSourceDir.
		}
	}

	const outputDir = intensiveCourseMediaDir(courseId);
	fs.mkdirSync(/* turbopackIgnore: true */ outputDir, { recursive: true });
	const logPath = path.join(/* turbopackIgnore: true */ outputDir, "worker.log");

	const mode: "watch" | "once" = input.mode === "once" ? "once" : "watch";
	const args: string[] = [
		scriptPath,
		"--course-id",
		courseId,
		"--source-dir",
		resolvedSourceDir,
		"--output-dir",
		outputDir,
		"--language",
		language,
		"--model",
		model,
		"--device",
		"cuda",
		"--compute-type",
		"float16",
	];

	if (mode === "watch") {
		args.push("--watch", "--poll-seconds", "15", "--min-stable-seconds", "5");
	} else {
		args.push("--once");
	}

	let logFd: number | null = null;
	try {
		logFd = fs.openSync(/* turbopackIgnore: true */ logPath, "a");
		const child = spawn(pythonResolution.pythonPath, args, {
			detached: true,
			windowsHide: true,
			stdio: ["ignore", logFd, logFd],
			env: {
				...process.env,
				PYTHONUTF8: "1",
				PYTHONUNBUFFERED: "1",
			},
		});
		child.unref();

		const pid = child.pid;
		if (!pid) {
			return { ok: false, error: "Failed to spawn GPU transcription worker process." };
		}

		const nowIso = new Date().toISOString();
		const priorIdx = loadCourseMediaIndex(courseId);
		const initialPayload: Record<string, unknown> = {
			...(existingRawStatus ?? {}),
			schemaVersion: 1,
			courseId,
			state: "starting",
			mode,
			pid,
			startedAt: nowIso,
			lastUpdatedAt: nowIso,
			sourceDir: resolvedSourceDir,
			outputDir,
			model,
			device: "cuda",
			computeType: "float16",
			language,
			totalDiscovered: priorIdx.lessons.length,
			completed: priorIdx.lessons.filter((l) => l.transcriptStatus === "ready").length,
			pending: priorIdx.lessons.filter(
				(l) => l.transcriptStatus === "pending" || l.transcriptStatus === "transcribing",
			).length,
			downloading: priorIdx.lessons.filter((l) => l.transcriptStatus === "downloading").length,
			failed: priorIdx.lessons.filter((l) => l.transcriptStatus === "error").length,
			currentLessonId: null,
			currentFileName: null,
			currentTitle: null,
		};

		writeRawCourseStatus(courseId, initialPayload);
		const status = normalizeRawCourseStatus(courseId, initialPayload, priorIdx.lessons);
		return { ok: true, status };
	} catch (error) {
		return {
			ok: false,
			error: `Failed to start transcription worker: ${error instanceof Error ? error.message : String(error)}`,
		};
	} finally {
		if (logFd !== null) {
			try {
				fs.closeSync(logFd);
			} catch {
				// ignore
			}
		}
	}
}

export function stopIntensiveTranscription(courseId: string): { ok: boolean; stopped: boolean } {
	if (!isSafeIntensiveId(courseId)) {
		return { ok: false, stopped: false };
	}

	const raw = readRawCourseStatus(courseId);
	if (!raw) {
		return { ok: true, stopped: false };
	}

	const pid =
		typeof raw.pid === "number" && Number.isInteger(raw.pid) && raw.pid > 0 ? raw.pid : undefined;
	let stopped = false;

	if (pid && isProcessAlive(pid)) {
		try {
			process.kill(pid, "SIGTERM");
			stopped = true;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "ESRCH") {
				return { ok: false, stopped: false };
			}
		}
	}

	const rawState = typeof raw.state === "string" ? raw.state.toLowerCase() : "";
	if (
		stopped ||
		rawState === "starting" ||
		rawState === "scanning" ||
		rawState === "transcribing" ||
		rawState === "watching" ||
		rawState === "running"
	) {
		writeRawCourseStatus(courseId, {
			...raw,
			state: "stopped",
			pid: null,
			currentLessonId: null,
			currentFileName: null,
			currentTitle: null,
			lastUpdatedAt: new Date().toISOString(),
		});
	}

	return { ok: true, stopped };
}

// ─── Locked AI-Tutor Context & Retrieval Exports ─────────────────────────────

function extractMaterialExcerpt(
	doc: CourseMaterialDoc,
	query?: string,
	maxChars = 1600,
): string | undefined {
	if (doc.chunks.length === 0 || maxChars <= 0) return undefined;

	let orderedChunks = doc.chunks;
	const qTokens = query?.trim() ? effectiveQueryTokens(query) : [];
	if (qTokens.length > 0) {
		const scored = doc.chunks
			.map((chunk) => ({
				chunk,
				score: scoreTextMatch(qTokens, chunk.text, doc.title),
			}))
			.filter((entry) => entry.score > 0)
			.sort((a, b) => b.score - a.score || a.chunk.index - b.chunk.index);
		if (scored.length > 0) {
			const picked = scored.slice(0, 4).map((s) => s.chunk);
			picked.sort((a, b) => a.index - b.index);
			orderedChunks = picked;
		}
	}

	const parts: string[] = [];
	let used = 0;
	for (const chunk of orderedChunks) {
		const prefix = chunk.page !== undefined ? `[Pág. ${chunk.page}] ` : "";
		const cleaned = chunk.text.replace(/\s+/g, " ").trim();
		if (!cleaned) continue;
		const line = `${prefix}${cleaned}`;
		const sepLen = parts.length === 0 ? 0 : 2;
		const remaining = maxChars - used - sepLen;
		if (remaining <= 40) break;
		if (line.length <= remaining) {
			parts.push(line);
			used += sepLen + line.length;
		} else {
			parts.push(truncateText(line, remaining));
			used = maxChars;
			break;
		}
	}

	return parts.length > 0 ? parts.join("\n\n") : undefined;
}

export function buildIntensiveTutorContext(input: {
	trackId?: string;
	courseId?: string;
	moduleId?: string;
	lessonId?: string;
	materialId?: string;
	currentTimeSec?: number;
	certId?: string;
	projectId?: string;
	query?: string;
}): { payload: IntensiveTutorContextPayload; promptText: string } {
	const dashboard = getIntensiveDashboard(input.trackId);
	const track = dashboard.track;

	const courseView = input.courseId ? dashboard.coursesById[input.courseId] : undefined;
	const courseSpec = courseView?.spec;
	const courseState = courseView?.state;

	const moduleSpec =
		courseSpec && input.moduleId
			? courseSpec.modules.find((m) => m.id === input.moduleId)
			: undefined;

	const certView = input.certId
		? dashboard.certifications.find((c) => c.spec.id === input.certId)
		: undefined;
	const projectView = input.projectId
		? dashboard.portfolioProjects.find((p) => p.spec.id === input.projectId)
		: undefined;

	const mediaIdx = courseSpec ? loadCourseMediaIndex(courseSpec.id) : null;
	const lessons = mediaIdx?.lessons ?? [];

	let activeLessonSummary: MediaLessonSummary | undefined;
	let activeTranscript: LessonTranscriptDoc | null = null;
	let currentTimeSec: number | undefined;
	let currentTimestampLabel: string | undefined;
	let transcriptExcerpt: string | undefined;
	let telegramCaption: string | undefined;
	let surroundingLessonLines: string[] = [];

	if (courseSpec && input.lessonId && isSafeIntensiveId(input.lessonId)) {
		const lessonIdx = lessons.findIndex((l) => l.lessonId === input.lessonId);
		activeLessonSummary = lessonIdx >= 0 ? lessons[lessonIdx] : undefined;
		activeTranscript = readLessonTranscript(courseSpec.id, input.lessonId);

		const savedVideo = courseState?.videos[input.lessonId];
		if (
			typeof input.currentTimeSec === "number" &&
			Number.isFinite(input.currentTimeSec) &&
			input.currentTimeSec >= 0
		) {
			currentTimeSec = Math.floor(input.currentTimeSec);
		} else if (savedVideo && savedVideo.positionSec > 0) {
			currentTimeSec = Math.floor(savedVideo.positionSec);
		} else {
			currentTimeSec = 0;
		}
		currentTimestampLabel = formatTimestamp(currentTimeSec);
		telegramCaption =
			activeTranscript?.telegramCaption || activeLessonSummary?.telegramCaption || undefined;

		if (activeTranscript) {
			if (activeTranscript.segments.length > 0) {
				transcriptExcerpt =
					currentTimeSec > 0
						? extractWindowAroundTimestamp(activeTranscript.segments, currentTimeSec, 90, 1700)
						: extractWindowAroundTimestamp(activeTranscript.segments, 0, 180, 1700);
			} else if (activeTranscript.fullText) {
				transcriptExcerpt = truncateText(activeTranscript.fullText, 1700);
			}
		}

		// Include surrounding lesson sequence in the same course so the AI sees progression.
		if (lessonIdx >= 0) {
			const startIdx = Math.max(0, lessonIdx - 2);
			const endIdx = Math.min(lessons.length - 1, lessonIdx + 3);
			surroundingLessonLines = lessons.slice(startIdx, endIdx + 1).map((l, idx) => {
				const absIdx = startIdx + idx;
				const marker = absIdx === lessonIdx ? "→ [ATUAL]" : absIdx < lessonIdx ? "  [Anterior]" : "  [Próxima]";
				const dur = l.durationSec > 0 ? ` (${formatTimestamp(l.durationSec)})` : "";
				return `${marker} #${l.order} ${l.title}${dur}`;
			});
		}
	}

	// Active PDF/apostila/material when launching tutor from a course document.
	let activeMaterialSummary: CourseMaterialSummary | undefined;
	let activeMaterialDoc: CourseMaterialDoc | null = null;
	let materialId: string | undefined;
	let materialTitle: string | undefined;
	let materialExcerpt: string | undefined;

	if (courseSpec && input.materialId && isSafeIntensiveId(input.materialId)) {
		const matIdx = loadCourseMaterialsIndex(courseSpec.id);
		activeMaterialSummary = matIdx.recordsById.get(input.materialId)?.summary;
		activeMaterialDoc = readCourseMaterialDoc(courseSpec.id, input.materialId);
		if (activeMaterialSummary || activeMaterialDoc) {
			materialId = activeMaterialDoc?.materialId ?? activeMaterialSummary?.materialId ?? input.materialId;
			materialTitle = activeMaterialDoc?.title ?? activeMaterialSummary?.title;
			if (activeMaterialDoc) {
				materialExcerpt = extractMaterialExcerpt(activeMaterialDoc, input.query, 1600);
			}
		}
	}

	// Collect learner's personal notes & video bookmarks (bounded).
	const notesParts: string[] = [];
	if (courseState?.courseNotes?.trim()) {
		notesParts.push(`Curso: ${truncateText(courseState.courseNotes, 220)}`);
	}
	if (moduleSpec && courseState?.modules[moduleSpec.id]?.notes?.trim()) {
		notesParts.push(`Módulo: ${truncateText(courseState.modules[moduleSpec.id]!.notes, 220)}`);
	}
	if (input.lessonId && courseState?.videos[input.lessonId]) {
		const vState = courseState.videos[input.lessonId]!;
		if (vState.notes?.trim()) {
			notesParts.push(`Aula: ${truncateText(vState.notes, 220)}`);
		}
		if (vState.bookmarks.length > 0) {
			const bmLines = vState.bookmarks
				.slice(0, 6)
				.map(
					(b) =>
						`[${formatTimestamp(b.timeSec)}] ${b.label}${b.note ? ` — ${truncateText(b.note, 80)}` : ""}`,
				);
			notesParts.push(`Marcadores:\n${bmLines.join("\n")}`);
		}
	}
	const learnerNotes = notesParts.length > 0 ? truncateText(notesParts.join("\n"), 600) : undefined;

	// Cross-lesson relevant transcript snippets & matching companion materials.
	let relevantSnippets: IntensiveSearchHit[] = [];
	let relatedMaterialHits: IntensiveMaterialSearchHit[] = [];
	if (courseSpec) {
		const searchSeed =
			input.query?.trim() ||
			materialTitle ||
			activeTranscript?.title ||
			activeLessonSummary?.title ||
			(moduleSpec ? `${moduleSpec.title} ${moduleSpec.topics.slice(0, 3).join(" ")}` : "");

		if (searchSeed) {
			const otherDocs = loadAllCourseTranscripts(courseSpec.id)
				.filter((d) => d.lessonId !== input.lessonId)
				.map((d) => toSearchableTranscriptDoc(d, courseSpec.title));
			if (otherDocs.length > 0) {
				relevantSnippets = searchTranscriptChunks(searchSeed, otherDocs, 3);
			}

			relatedMaterialHits = searchIntensiveMaterials({
				query: searchSeed,
				courseId: courseSpec.id,
				trackId: track.id,
				limit: 4,
				snippetMaxLen: 180,
			})
				.filter((hit) => hit.materialId !== materialId)
				.slice(0, 3);
		}
	}

	// Bridge to related nodes in the main Electronics (or track domain) curriculum tree.
	const extraBridgeTerms = [
		activeTranscript?.title ?? activeLessonSummary?.title ?? "",
		materialTitle ?? "",
		moduleSpec ? `${moduleSpec.title} ${moduleSpec.topics.slice(0, 3).join(" ")}` : "",
		certView?.spec.title ?? "",
		projectView?.spec.title ?? "",
	].filter(Boolean);
	const relatedCurriculumNodes = matchCurriculumNodesForIntensive({
		courseId: courseSpec?.id,
		trackId: track.id,
		domainId: track.domainId,
		extraTerms: extraBridgeTerms,
		limit: 6,
	});

	const payload: IntensiveTutorContextPayload = {
		trackId: track.id,
		trackTitle: track.title,
		courseId: courseSpec?.id,
		courseTitle: courseSpec?.title,
		courseRank: courseSpec?.rank,
		courseTier: courseSpec?.tier,
		tutorSyllabusContext: courseSpec?.tutorSyllabusContext,
		moduleId: moduleSpec?.id,
		moduleTitle: moduleSpec?.title,
		moduleTopics: moduleSpec?.topics,
		benchExercise: moduleSpec?.benchExercise,
		lessonId: activeLessonSummary?.lessonId ?? activeTranscript?.lessonId ?? input.lessonId,
		lessonTitle: activeTranscript?.title ?? activeLessonSummary?.title,
		lessonOrder: activeTranscript?.order ?? activeLessonSummary?.order,
		currentTimeSec,
		currentTimestampLabel,
		transcriptExcerpt,
		telegramCaption,
		...(materialId ? { materialId } : {}),
		...(materialTitle ? { materialTitle } : {}),
		...(materialExcerpt ? { materialExcerpt } : {}),
		...(relatedCurriculumNodes.length > 0 ? { relatedCurriculumNodes } : {}),
		relevantSnippets: relevantSnippets.length > 0 ? relevantSnippets : undefined,
		certId: certView?.spec.id,
		certTitle: certView?.spec.title,
		projectId: projectView?.spec.id,
		projectTitle: projectView?.spec.title,
		learnerNotes,
	};

	// Compose strictly bounded structured prompt block.
	const sections: string[] = [];
	sections.push(
		`## Contexto INTENSIVA — ${track.title} (Progresso Core: ${dashboard.summary.coreCompletionPct}%)`,
	);

	if (courseSpec && courseView) {
		sections.push(
			[
				`### Curso Ativo: #${courseSpec.rank} ${courseSpec.title} (Tier ${courseSpec.tier} · ${courseSpec.provider})`,
				`- Progresso: ${courseView.metrics.percent}% (${courseView.metrics.status}) · Idioma: ${courseSpec.language}`,
				`- Diretriz do Tutor: ${truncateText(courseSpec.tutorSyllabusContext, 420)}`,
			].join("\n"),
		);
	}

	if (moduleSpec) {
		const modLines = [
			`### Módulo Ativo: M${moduleSpec.order} — ${moduleSpec.title} (~${moduleSpec.estimatedHours}h)`,
			`- Tópicos: ${moduleSpec.topics.join(" · ")}`,
		];
		if (moduleSpec.benchExercise) {
			modLines.push(`- Exercício de Bancada: ${moduleSpec.benchExercise}`);
		}
		sections.push(modLines.join("\n"));
	}

	if (payload.lessonTitle) {
		const durSec = activeTranscript?.durationSec ?? activeLessonSummary?.durationSec ?? 0;
		const headerParts = [
			`### Vídeo-Aula Ativa: #${payload.lessonOrder ?? "?"} ${payload.lessonTitle}`,
			`- Posição atual: [${currentTimestampLabel ?? "00:00"}]${durSec > 0 ? ` / ${formatTimestamp(durSec)}` : ""}`,
		];
		if (telegramCaption) {
			headerParts.push(`- Legenda/Descrição original: ${truncateText(telegramCaption, 260)}`);
		}
		if (transcriptExcerpt) {
			headerParts.push(
				`- Trecho da transcrição (${currentTimeSec && currentTimeSec > 0 ? `±90s de ${currentTimestampLabel}` : "início da aula"}):\n${transcriptExcerpt}`,
			);
		}
		sections.push(headerParts.join("\n"));
	}

	if (materialTitle) {
		const metaFile = activeMaterialDoc?.fileName ?? activeMaterialSummary?.fileName ?? "";
		const metaSection = activeMaterialDoc?.section ?? activeMaterialSummary?.section ?? "";
		const metaCat = activeMaterialDoc?.category ?? activeMaterialSummary?.category ?? "other";
		const metaPages = activeMaterialDoc?.pageCount ?? activeMaterialSummary?.pageCount;
		const matLines = [
			`### Material / Apostila Ativa: ${materialTitle}${metaFile ? ` (${metaFile})` : ""}`,
			`- Categoria: ${metaCat}${metaSection ? ` · Seção: ${metaSection}` : ""}${metaPages ? ` · Páginas: ${metaPages}` : ""}`,
		];
		if (materialExcerpt) {
			matLines.push(`- Trecho extraído:\n${materialExcerpt}`);
		}
		sections.push(matLines.join("\n"));
	}

	if (surroundingLessonLines.length > 0) {
		sections.push(`### Sequência no Curso\n${surroundingLessonLines.join("\n")}`);
	}

	if (learnerNotes) {
		sections.push(`### Notas e Marcadores do Aluno\n${learnerNotes}`);
	}

	if (relevantSnippets.length > 0) {
		const snipLines = relevantSnippets.map(
			(h) =>
				`- #${h.order} ${h.lessonTitle} [${h.timestampLabel}]: ${truncateText(h.snippet, 190)}`,
		);
		sections.push(`### Conexões em Outras Aulas Transcritas\n${snipLines.join("\n")}`);
	}

	if (relatedMaterialHits.length > 0) {
		const matSnipLines = relatedMaterialHits.map((m) => {
			const pageTag = m.page !== undefined ? ` (pág. ${m.page})` : "";
			const secTag = m.section ? ` [${m.section}]` : "";
			return `- ${m.materialTitle}${pageTag}${secTag}: ${truncateText(m.snippet, 180)}`;
		});
		sections.push(`### Apostilas e Materiais Complementares Relacionados\n${matSnipLines.join("\n")}`);
	}

	if (relatedCurriculumNodes.length > 0) {
		const nodeLines = relatedCurriculumNodes.map(
			(n) => `- \`${n.nodeId}\` — ${n.title}${n.regionTitle ? ` (${n.regionTitle})` : ""}`,
		);
		sections.push(`### Nós Relacionados na Árvore Principal (${track.domainId})\n${nodeLines.join("\n")}`);
	}

	// Linked certifications readiness + next checkpoints.
	const linkedCerts = new Map<string, (typeof dashboard.certifications)[number]>();
	if (certView) linkedCerts.set(certView.spec.id, certView);
	if (courseSpec) {
		for (const cid of courseSpec.linkedCertIds) {
			const found = dashboard.certifications.find((c) => c.spec.id === cid);
			if (found) linkedCerts.set(found.spec.id, found);
		}
	}
	if (linkedCerts.size > 0) {
		const certLines: string[] = [];
		for (const cv of Array.from(linkedCerts.values()).slice(0, 2)) {
			const nextUnchecked = cv.spec.studyCheckpoints
				.filter((text, i) => {
					const key = getCertificationCheckpointKey(cv.spec.id, i);
					return (
						!cv.state.completedCheckpoints[key] &&
						!cv.state.completedCheckpoints[String(i)] &&
						!cv.state.completedCheckpoints[text]
					);
				})
				.slice(0, 3);
			certLines.push(
				`- ${cv.spec.title} (${cv.spec.phase}): prontidão ${cv.metrics.readinessPct}% (${cv.metrics.status})${nextUnchecked.length > 0 ? ` · Próximos checkpoints: ${nextUnchecked.join("; ")}` : ""}`,
			);
		}
		sections.push(`### Certificações Vinculadas\n${certLines.join("\n")}`);
	}

	if (projectView) {
		const pendingDeliv = projectView.spec.deliverables
			.filter((d) => !projectView.state.completedDeliverables[d.id])
			.slice(0, 4)
			.map((d) => d.label);
		sections.push(
			[
				`### Projeto de Portfólio: ${projectView.spec.title} (${projectView.metrics.percent}%)`,
				`- Resumo: ${truncateText(projectView.spec.summary, 220)}`,
				pendingDeliv.length > 0 ? `- Entregáveis pendentes: ${pendingDeliv.join("; ")}` : "",
			]
				.filter(Boolean)
				.join("\n"),
		);
	}

	return {
		payload,
		promptText: sections.join("\n\n"),
	};
}

export function buildIntensiveTurnMemory(
	ctx: IntensiveTutorContextPayload,
	latestUserText: string,
): string {
	const query = latestUserText.trim();
	if (!query) return "";

	const track = resolveTrack(ctx.trackId);
	const state = readIntensiveState(track.id);

	// 1. Live BM25 retrieval in active course first; fall back to all intensive courses if 0 hits.
	let searchRes = searchIntensiveCatalog({
		query,
		courseId: ctx.courseId,
		trackId: track.id,
		limit: 5,
	});

	if (ctx.courseId && (searchRes.transcriptHits.length === 0 || searchRes.materialHits.length === 0)) {
		const globalRes = searchIntensiveCatalog({
			query,
			trackId: track.id,
			limit: 5,
		});
		searchRes = {
			transcriptHits:
				searchRes.transcriptHits.length > 0 ? searchRes.transcriptHits : globalRes.transcriptHits,
			moduleHits:
				searchRes.moduleHits.length > 0 ? searchRes.moduleHits : globalRes.moduleHits,
			materialHits:
				searchRes.materialHits.length > 0 ? searchRes.materialHits : globalRes.materialHits,
		};
	}

	// 2. Match learner personal notes & bookmarks across active course (or all courses).
	const queryTokens = tokenizeSearchText(query);
	const noteHits: Array<{ label: string; text: string; score: number }> = [];
	if (queryTokens.length > 0) {
		const candidateCourses = ctx.courseId
			? [state.courses[ctx.courseId]].filter((c): c is NonNullable<typeof c> => Boolean(c))
			: Object.values(state.courses);

		for (const cState of candidateCourses) {
			const cTitle = track.courses.find((c) => c.id === cState.courseId)?.title ?? cState.courseId;
			if (cState.courseNotes?.trim()) {
				const s = scoreTextMatch(queryTokens, cState.courseNotes, cTitle);
				if (s > 0) {
					noteHits.push({
						label: `Nota do curso (${cTitle})`,
						text: truncateText(cState.courseNotes, 200),
						score: s,
					});
				}
			}
			for (const [modId, modState] of Object.entries(cState.modules)) {
				if (!modState.notes?.trim()) continue;
				const s = scoreTextMatch(queryTokens, modState.notes, modId);
				if (s > 0) {
					noteHits.push({
						label: `Nota do módulo (${modId})`,
						text: truncateText(modState.notes, 200),
						score: s,
					});
				}
			}
			for (const [lessonId, vState] of Object.entries(cState.videos)) {
				if (vState.notes?.trim()) {
					const s = scoreTextMatch(queryTokens, vState.notes, lessonId);
					if (s > 0) {
						noteHits.push({
							label: `Nota do vídeo (${lessonId})`,
							text: truncateText(vState.notes, 200),
							score: s,
						});
					}
				}
				for (const bm of vState.bookmarks) {
					const bmText = `${bm.label} ${bm.note ?? ""}`.trim();
					const s = scoreTextMatch(queryTokens, bmText);
					if (s > 0) {
						noteHits.push({
							label: `Marcador [${formatTimestamp(bm.timeSec)}] (${lessonId})`,
							text: truncateText(bmText, 180),
							score: s,
						});
					}
				}
			}
		}
		noteHits.sort((a, b) => b.score - a.score);
	}

	if (
		searchRes.transcriptHits.length === 0 &&
		searchRes.materialHits.length === 0 &&
		searchRes.moduleHits.length === 0 &&
		noteHits.length === 0
	) {
		return "";
	}

	const lines: string[] = ["### Memória Recuperada dos Cursos Intensivos (BM25)"];

	if (searchRes.transcriptHits.length > 0) {
		lines.push("**Trechos de vídeo-aulas transcritas:**");
		for (const hit of searchRes.transcriptHits.slice(0, 4)) {
			lines.push(
				`- [${hit.courseTitle} · #${hit.order} ${hit.lessonTitle} @ ${hit.timestampLabel}] (${hit.lessonId}): ${truncateText(hit.snippet, 240)}`,
			);
		}
	}

	if (searchRes.materialHits.length > 0) {
		lines.push("**Apostilas e materiais relacionados (PDFs/esquemas):**");
		for (const mat of searchRes.materialHits.slice(0, 4)) {
			const pageTag = mat.page !== undefined ? ` · pág. ${mat.page}` : "";
			lines.push(
				`- [${mat.courseTitle} · ${mat.materialTitle}${pageTag}] (${mat.materialId}): ${truncateText(mat.snippet, 220)}`,
			);
		}
	}

	if (searchRes.moduleHits.length > 0) {
		lines.push("**Módulos da ementa relacionados:**");
		for (const mod of searchRes.moduleHits.slice(0, 3)) {
			lines.push(`- ${mod.courseTitle} · ${mod.moduleTitle}: ${truncateText(mod.snippet, 200)}`);
		}
	}

	if (noteHits.length > 0) {
		lines.push("**Anotações e marcadores do aluno:**");
		for (const nh of noteHits.slice(0, 3)) {
			lines.push(`- ${nh.label}: ${nh.text}`);
		}
	}

	// Enforce hard MAX_TURN_MEMORY_CHARS (4,000 chars) on line boundaries.
	const bounded: string[] = [];
	let totalLen = 0;
	for (const line of lines) {
		const added = bounded.length === 0 ? line.length : line.length + 1;
		if (totalLen + added > MAX_TURN_MEMORY_CHARS) break;
		bounded.push(line);
		totalLen += added;
	}

	return bounded.join("\n");
}

export function searchIntensiveForTutor(input: {
	query: string;
	courseId?: string;
	limit?: number;
}): string {
	const query = input.query.trim();
	if (!query) {
		return "Informe um termo técnico ou pergunta para pesquisar nos cursos intensivos.";
	}

	const limit = Math.max(1, Math.min(12, Math.floor(input.limit ?? 8)));
	const res = searchIntensiveCatalog({
		query,
		courseId: input.courseId,
		limit,
	});

	if (
		res.transcriptHits.length === 0 &&
		res.moduleHits.length === 0 &&
		res.materialHits.length === 0
	) {
		return `Nenhum trecho transcrito, material ou módulo encontrado para "${query}"${input.courseId ? ` no curso ${input.courseId}` : ""}.`;
	}

	const lines: string[] = [
		`Resultados para "${query}"${input.courseId ? ` (curso: ${input.courseId})` : " (todos os cursos intensivos)"}:`,
	];

	if (res.transcriptHits.length > 0) {
		lines.push("", "=== Transcrições de Vídeo-Aulas ===");
		for (const hit of res.transcriptHits) {
			const endLabel = formatTimestamp(hit.endSec);
			lines.push(
				`- [${hit.timestampLabel}–${endLabel}] #${hit.order} ${hit.lessonTitle} (courseId=${hit.courseId}, lessonId=${hit.lessonId}, score=${hit.score})`,
			);
			lines.push(`  Trecho: ${truncateText(hit.snippet, 300)}`);
			if (hit.telegramCaption) {
				lines.push(`  Legenda: ${truncateText(hit.telegramCaption, 140)}`);
			}
		}
	}

	if (res.materialHits.length > 0) {
		lines.push("", "=== Materiais e Apostilas (PDFs/Esquemas) ===");
		for (const mat of res.materialHits.slice(0, Math.min(4, limit))) {
			const pageTag = mat.page !== undefined ? `, page=${mat.page}` : "";
			lines.push(
				`- ${mat.materialTitle} (courseId=${mat.courseId}, materialId=${mat.materialId}${pageTag}, score=${mat.score})`,
			);
			lines.push(`  Trecho: ${truncateText(mat.snippet, 220)}`);
		}
	}

	if (res.moduleHits.length > 0) {
		lines.push("", "=== Módulos do Catálogo ===");
		for (const mod of res.moduleHits.slice(0, Math.min(5, limit))) {
			lines.push(
				`- ${mod.courseTitle} · ${mod.moduleTitle} (courseId=${mod.courseId}, moduleId=${mod.moduleId}, score=${mod.score})`,
			);
			lines.push(`  Conteúdo: ${truncateText(mod.snippet, 220)}`);
		}
	}

	return truncateText(lines.join("\n"), MAX_TUTOR_SEARCH_CHARS);
}

export function searchIntensiveMaterialsForTutor(input: {
	query: string;
	courseId?: string;
	limit?: number;
}): string {
	const query = input.query.trim();
	if (!query) {
		return "Informe um termo técnico, fórmula, exercício ou tema para pesquisar nas apostilas e PDFs do curso.";
	}

	const limit = Math.max(1, Math.min(12, Math.floor(input.limit ?? 6)));
	const hits = searchIntensiveMaterials({
		query,
		courseId: input.courseId,
		limit,
		snippetMaxLen: 420,
	});

	if (hits.length === 0) {
		return `Nenhum material (PDF, apostila, exercício ou esquema) encontrado para "${query}"${input.courseId ? ` no curso ${input.courseId}` : ""}.`;
	}

	const lines: string[] = [
		`Materiais encontrados para "${query}"${input.courseId ? ` (curso: ${input.courseId})` : " (todos os cursos intensivos)"}:`,
		"",
	];

	for (const hit of hits) {
		const pageTag = hit.page !== undefined ? `, pág. ${hit.page}` : "";
		const sectionTag = hit.section ? `, seção="${hit.section}"` : "";
		lines.push(
			`- ${hit.materialTitle} [${hit.category}] (courseId=${hit.courseId}, materialId=${hit.materialId}, arquivo="${hit.fileName}"${sectionTag}${pageTag}, score=${hit.score})`,
		);
		lines.push(`  Trecho: ${truncateText(hit.snippet, 420)}`);
	}

	return truncateText(lines.join("\n"), MAX_TUTOR_SEARCH_CHARS);
}

export function getIntensiveTranscriptForTutor(input: {
	courseId: string;
	lessonId: string;
	startSec?: number;
	endSec?: number;
}): string {
	const doc = readLessonTranscript(input.courseId, input.lessonId);
	if (!doc) {
		return `Transcrição indisponível para courseId="${input.courseId}", lessonId="${input.lessonId}". A aula pode ainda estar pendente ou em download.`;
	}

	const startSec =
		typeof input.startSec === "number" && Number.isFinite(input.startSec) && input.startSec > 0
			? input.startSec
			: 0;
	const endSec =
		typeof input.endSec === "number" && Number.isFinite(input.endSec) && input.endSec > startSec
			? input.endSec
			: Number.POSITIVE_INFINITY;

	const headerLines = [
		`Aula #${doc.order}: ${doc.title} (${doc.courseId} / ${doc.lessonId})`,
		`Duração: ${formatTimestamp(doc.durationSec)} · Idioma: ${doc.language} · Palavras: ${doc.wordCount}`,
	];
	if (doc.telegramCaption) {
		headerLines.push(`Descrição: ${truncateText(doc.telegramCaption, 220)}`);
	}
	headerLines.push("");

	const header = headerLines.join("\n");
	const footerReserve = 140;
	const budget = Math.max(400, MAX_TUTOR_TRANSCRIPT_CHARS - header.length - footerReserve);

	const filtered = doc.segments.filter((seg) => seg.end >= startSec && seg.start <= endSec);
	if (filtered.length === 0) {
		if (doc.segments.length === 0 && doc.fullText) {
			return truncateText(`${header}${doc.fullText}`, MAX_TUTOR_TRANSCRIPT_CHARS);
		}
		return `${header}Nenhum segmento encontrado no intervalo [${formatTimestamp(startSec)} – ${Number.isFinite(endSec) ? formatTimestamp(endSec) : formatTimestamp(doc.durationSec)}].`;
	}

	const bodyLines: string[] = [];
	let usedChars = 0;
	let truncatedAtSec: number | null = null;

	for (const seg of filtered) {
		const line = `[${formatTimestamp(seg.start)}] ${seg.text}`;
		const added = bodyLines.length === 0 ? line.length : line.length + 1;
		if (usedChars + added > budget) {
			truncatedAtSec = seg.start;
			break;
		}
		bodyLines.push(line);
		usedChars += added;
	}

	const resultParts = [header + bodyLines.join("\n")];
	if (truncatedAtSec !== null) {
		resultParts.push(
			`\n[Trecho limitado a ${MAX_TUTOR_TRANSCRIPT_CHARS} caracteres. Para continuar, chame novamente com startSec=${Math.floor(truncatedAtSec)}.]`,
		);
	}

	return resultParts.join("");
}
