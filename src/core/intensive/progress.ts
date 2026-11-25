/**
 * Pure, deterministic progress, readiness, pacing projection, and recommendation
 * calculations for TrilhaAtlas Intensive Study Quests.
 *
 * ZERO Node builtins, ZERO filesystem/network I/O.
 */

import { DEFAULT_INTENSIVE_TRACK_ID, getIntensiveTrack } from "./catalog-template.ts";
import type {
	CertificationProgressMetrics,
	CertificationProgressState,
	CertificationSpec,
	CourseDerivedStatus,
	CourseMediaBundle,
	CourseMediaSource,
	CourseModuleProgressMetrics,
	CourseModuleSpec,
	CourseProgressMetrics,
	CourseProgressState,
	CourseVideoProgressMetrics,
	IntensiveCertificationView,
	IntensiveCourseSpec,
	IntensiveCourseView,
	IntensiveDashboardDTO,
	IntensivePortfolioProjectView,
	IntensiveRecommendedAction,
	IntensiveState,
	IntensiveTierSpec,
	IntensiveTierView,
	IntensiveTrackSpec,
	MediaLessonSummary,
	PacingMode,
	PacingProjection,
	PacingSettings,
	PortfolioProgressMetrics,
	PortfolioProgressState,
	PortfolioProjectMetrics,
	PortfolioProjectSpec,
	PortfolioProjectStatus,
	TierProgressMetrics,
} from "./types.ts";

const ACTIVE_STUDY_DAYS_PER_WEEK = 6; // Reserves 1 day/week for rest + weekly consolidation (Pacing Rule #5).

function roundPct(value: number): number {
	if (!Number.isFinite(value)) return 0;
	const clamped = Math.max(0, Math.min(100, value));
	return Math.round(clamped * 10) / 10;
}

function roundHours(value: number): number {
	if (!Number.isFinite(value)) return 0;
	const clamped = Math.max(0, value);
	return Math.round(clamped * 10) / 10;
}

function weeksFromStudyDays(days: number): number {
	if (days <= 0) return 0;
	return Math.round((days / ACTIVE_STUDY_DAYS_PER_WEEK) * 10) / 10;
}

export function getCertificationCheckpointKey(certId: string, index: number): string {
	return `${certId}:cp-${index + 1}`;
}

export function getDefaultPacingSettings(
	mode: PacingMode = "full-time-home",
	track?: IntensiveTrackSpec | null,
): PacingSettings {
	const profile = track?.pacingProfiles[mode];
	if (profile) {
		return {
			mode,
			dailyElectronicsMinutes: profile.defaultDailyDomainMinutes,
			dailyLanguageMinutes: profile.defaultDailyLanguageMinutes,
			dailyCtaMinutes: profile.defaultDailyParallelCourseMinutes,
			passiveVideoCapMinutes: profile.defaultPassiveVideoCapMinutes,
		};
	}

	if (mode === "with-clt") {
		return {
			mode: "with-clt",
			dailyElectronicsMinutes: 120,
			dailyLanguageMinutes: 50,
			dailyCtaMinutes: 45,
			passiveVideoCapMinutes: 75,
		};
	}

	return {
		mode: "full-time-home",
		dailyElectronicsMinutes: 240,
		dailyLanguageMinutes: 75,
		dailyCtaMinutes: 55,
		passiveVideoCapMinutes: 105,
	};
}

export function createDefaultCourseState(courseId: string): CourseProgressState {
	return {
		courseId,
		courseNotes: "",
		customLinks: [],
		modules: {},
		videos: {},
	};
}

export function createDefaultCertificationState(
	cert: CertificationSpec,
): CertificationProgressState {
	return {
		certId: cert.id,
		status: cert.defaultStatus,
		completedCheckpoints: {},
		notes: "",
	};
}

export function createDefaultPortfolioState(projectId: string): PortfolioProgressState {
	return {
		projectId,
		status: "not-started",
		completedDeliverables: {},
		notes: "",
	};
}

export function createDefaultIntensiveState(
	trackId: string = DEFAULT_INTENSIVE_TRACK_ID,
	nowIso: string = new Date().toISOString(),
): IntensiveState {
	const track = getIntensiveTrack(trackId);
	const courses: Record<string, CourseProgressState> = {};
	const certifications: Record<string, CertificationProgressState> = {};
	const portfolio: Record<string, PortfolioProgressState> = {};

	if (track) {
		for (const course of track.courses) {
			courses[course.id] = createDefaultCourseState(course.id);
		}
		for (const cert of track.certifications) {
			certifications[cert.id] = createDefaultCertificationState(cert);
		}
		for (const project of track.portfolioProjects) {
			portfolio[project.id] = createDefaultPortfolioState(project.id);
		}
	}

	return {
		schemaVersion: 1,
		trackId,
		createdAt: nowIso,
		updatedAt: nowIso,
		pacing: {
			...getDefaultPacingSettings("full-time-home", track),
			startDate: nowIso.slice(0, 10),
		},
		courses,
		certifications,
		portfolio,
		benchInterviewChecked: {},
		benchKitOwned: {},
		studyLog: [],
	};
}

function computeModuleMetrics(
	course: IntensiveCourseSpec,
	courseState: CourseProgressState | undefined,
): CourseModuleProgressMetrics {
	const totalCount = course.modules.length;
	const modulesMap = courseState?.modules ?? {};
	let completedCount = 0;
	let completedHours = 0;
	let totalHours = 0;
	let loggedMinutes = 0;

	for (const mod of course.modules) {
		totalHours += mod.estimatedHours;
		const modState = modulesMap[mod.id];
		if (modState?.completed) {
			completedCount += 1;
			completedHours += mod.estimatedHours;
		}
	}

	for (const modState of Object.values(modulesMap)) {
		if (Number.isFinite(modState.loggedMinutes) && modState.loggedMinutes > 0) {
			loggedMinutes += modState.loggedMinutes;
		}
	}

	const percent = totalCount > 0 ? roundPct((completedCount / totalCount) * 100) : 0;

	return {
		completedCount,
		totalCount,
		completedHours: roundHours(completedHours),
		totalHours: roundHours(totalHours > 0 ? totalHours : course.estimatedHours),
		loggedMinutes: Math.round(loggedMinutes),
		percent,
	};
}

function computeVideoMetrics(
	course: IntensiveCourseSpec,
	courseState: CourseProgressState | undefined,
	mediaLessons: MediaLessonSummary[] = [],
	mediaSource?: CourseMediaSource | null,
): CourseVideoProgressMetrics {
	const videosMap = courseState?.videos ?? {};
	const discoveredCount = mediaLessons.length;
	const expectedTotalCount = Math.max(
		course.expectedTotalVideos ?? 0,
		mediaSource?.expectedTotalVideos ?? 0,
	);
	const hasLinkedMedia = discoveredCount > 0 || Boolean(mediaSource);

	let watchedCount = 0;
	let transcribedCount = 0;
	let downloadingCount = 0;
	let pendingCount = 0;
	let errorCount = 0;
	let totalDurationSec = 0;
	let watchedDurationSec = 0;

	if (discoveredCount > 0) {
		for (const lesson of mediaLessons) {
			const dur = Math.max(0, lesson.durationSec || 0);
			totalDurationSec += dur;

			if (lesson.transcriptStatus === "ready") transcribedCount += 1;
			else if (lesson.transcriptStatus === "downloading") downloadingCount += 1;
			else if (lesson.transcriptStatus === "error") errorCount += 1;
			else pendingCount += 1;

			const vState = videosMap[lesson.lessonId];
			if (vState?.watched) {
				watchedCount += 1;
				watchedDurationSec += dur > 0 ? dur : Math.max(0, vState.durationSec ?? 0);
			} else if (vState && vState.positionSec > 0) {
				watchedDurationSec += Math.min(dur > 0 ? dur : vState.positionSec, vState.positionSec);
			}
		}
	} else {
		for (const vState of Object.values(videosMap)) {
			if (vState.watched) {
				watchedCount += 1;
				watchedDurationSec += Math.max(0, vState.durationSec ?? vState.positionSec ?? 0);
			} else if (vState.positionSec > 0) {
				watchedDurationSec += Math.max(0, vState.positionSec);
			}
		}
	}

	const denominatorCount = Math.max(discoveredCount, expectedTotalCount);
	const percent =
		denominatorCount > 0
			? roundPct((Math.min(watchedCount, denominatorCount) / denominatorCount) * 100)
			: 0;

	return {
		hasLinkedMedia,
		discoveredCount,
		expectedTotalCount,
		denominatorCount,
		watchedCount,
		transcribedCount,
		downloadingCount,
		pendingCount,
		errorCount,
		totalDurationSec: Math.round(totalDurationSec),
		watchedDurationSec: Math.round(watchedDurationSec),
		percent,
	};
}

export function computeCourseProgress(
	course: IntensiveCourseSpec,
	courseState: CourseProgressState | undefined,
	mediaLessons: MediaLessonSummary[] = [],
	mediaSource?: CourseMediaSource | null,
): CourseProgressMetrics {
	const moduleProgress = computeModuleMetrics(course, courseState);
	const videoProgress = computeVideoMetrics(course, courseState, mediaLessons, mediaSource);

	const videosMap = courseState?.videos ?? {};
	const hasAnyVideoPosition = Object.values(videosMap).some(
		(v) => v.watched || v.positionSec > 0,
	);
	const manualStatus = courseState?.manualStatus ?? "auto";

	let basis: CourseProgressMetrics["basis"] = "modules";
	let percent = moduleProgress.percent;

	if (manualStatus === "completed") {
		basis = "manual";
		percent = 100;
	} else if (
		course.deliveryMode === "local-video-pack" &&
		(videoProgress.discoveredCount > 0 || videoProgress.watchedCount > 0)
	) {
		// Local video pack with discovered/watched videos uses watched / max(discovered, expectedTotalVideos).
		// Before videos are downloaded/linked (e.g., Lyse 2022), cleanly falls back to module progress!
		basis = "videos";
		percent = videoProgress.percent;
	} else if (videoProgress.discoveredCount > 0) {
		if (moduleProgress.totalCount === 0) {
			basis = "videos";
			percent = videoProgress.percent;
		} else if (videoProgress.watchedCount === 0) {
			basis = "modules";
			percent = moduleProgress.percent;
		} else if (moduleProgress.completedCount === 0) {
			basis = "videos";
			percent = videoProgress.percent;
		} else {
			basis = "hybrid";
			percent = roundPct(videoProgress.percent * 0.6 + moduleProgress.percent * 0.4);
		}
	}

	let completedHours: number;
	if (basis === "manual" && percent >= 100) {
		completedHours = course.estimatedHours;
	} else if (basis === "modules" && moduleProgress.totalHours > 0) {
		completedHours = Math.min(
			course.estimatedHours,
			roundHours((moduleProgress.completedHours / moduleProgress.totalHours) * course.estimatedHours),
		);
	} else {
		completedHours = roundHours((percent / 100) * course.estimatedHours);
	}

	const remainingHours = roundHours(Math.max(0, course.estimatedHours - completedHours));

	let status: CourseDerivedStatus;
	if (manualStatus === "completed" || percent >= 100) {
		status = "completed";
	} else if (manualStatus === "paused") {
		status = "paused";
	} else if (
		manualStatus === "in-progress" ||
		percent > 0 ||
		moduleProgress.loggedMinutes > 0 ||
		hasAnyVideoPosition
	) {
		status = "in-progress";
	} else {
		status = "not-started";
	}

	const optedIn =
		course.completionScope === "core" ? true : Boolean(courseState?.optedIn);

	return {
		courseId: course.id,
		status,
		percent,
		basis,
		completedHours,
		estimatedHours: course.estimatedHours,
		remainingHours,
		loggedMinutes: moduleProgress.loggedMinutes,
		moduleProgress,
		videoProgress,
		optedIn,
		countsInCore: course.completionScope === "core",
		lastStudiedAt: courseState?.lastStudiedAt,
	};
}

export function computeTierProgress(
	tier: IntensiveTierSpec,
	courses: IntensiveCourseView[],
): TierProgressMetrics {
	const courseCount = courses.length;
	let completedCourseCount = 0;
	let inProgressCourseCount = 0;
	let optedInCourseCount = 0;
	let pctSum = 0;
	let completedHours = 0;
	let totalHours = 0;

	for (const course of courses) {
		pctSum += course.metrics.percent;
		completedHours += course.metrics.completedHours;
		totalHours += course.metrics.estimatedHours;
		if (course.metrics.status === "completed") completedCourseCount += 1;
		else if (course.metrics.status === "in-progress") inProgressCourseCount += 1;
		if (course.metrics.optedIn) optedInCourseCount += 1;
	}

	return {
		tier: tier.tier,
		courseCount,
		completedCourseCount,
		inProgressCourseCount,
		optedInCourseCount,
		percent: courseCount > 0 ? roundPct(pctSum / courseCount) : 0,
		hoursWeightedPct: totalHours > 0 ? roundPct((completedHours / totalHours) * 100) : 0,
		completedHours: roundHours(completedHours),
		totalHours: roundHours(totalHours),
	};
}

export function computeCertificationProgress(
	cert: CertificationSpec,
	certState: CertificationProgressState | undefined,
	courseMap: Record<string, CourseProgressMetrics>,
): CertificationProgressMetrics {
	const status = certState?.status ?? cert.defaultStatus;
	const checkedMap = certState?.completedCheckpoints ?? {};
	const totalCheckpointsCount = cert.studyCheckpoints.length;

	let checkedCheckpointsCount = 0;
	for (let i = 0; i < totalCheckpointsCount; i += 1) {
		const cpText = cert.studyCheckpoints[i];
		const cpKey = getCertificationCheckpointKey(cert.id, i);
		if (
			Boolean(checkedMap[cpKey]) ||
			Boolean(checkedMap[String(i)]) ||
			(cpText !== undefined && Boolean(checkedMap[cpText]))
		) {
			checkedCheckpointsCount += 1;
		}
	}

	const checkpointsPct =
		totalCheckpointsCount > 0
			? roundPct((checkedCheckpointsCount / totalCheckpointsCount) * 100)
			: 0;

	let linkedCoursesPct = 0;
	if (cert.linkedCourseIds.length > 0) {
		let sum = 0;
		for (const courseId of cert.linkedCourseIds) {
			sum += courseMap[courseId]?.percent ?? 0;
		}
		linkedCoursesPct = roundPct(sum / cert.linkedCourseIds.length);
	} else {
		linkedCoursesPct = checkpointsPct;
	}

	let readinessPct: number;
	if (status === "passed") {
		readinessPct = 100;
	} else if (cert.linkedCourseIds.length > 0) {
		readinessPct = roundPct(checkpointsPct * 0.7 + linkedCoursesPct * 0.3);
	} else {
		readinessPct = checkpointsPct;
	}

	const isCore = cert.priorityTier === "core-free" || cert.priorityTier === "core-paid";

	return {
		certId: cert.id,
		status,
		checkedCheckpointsCount,
		totalCheckpointsCount,
		checkpointsPct,
		linkedCoursesPct,
		readinessPct,
		isCore,
	};
}

export function computePortfolioProgress(
	projects: PortfolioProjectSpec[],
	state: Record<string, PortfolioProgressState>,
): PortfolioProgressMetrics {
	const byProject: Record<string, PortfolioProjectMetrics> = {};
	let completedProjectsCount = 0;
	let inProgressProjectsCount = 0;
	let completedDeliverablesCount = 0;
	let totalDeliverablesCount = 0;
	let projectPctSum = 0;

	for (const project of projects) {
		const pState = state[project.id];
		const checkedMap = pState?.completedDeliverables ?? {};
		const totalDeliv = project.deliverables.length;
		let doneDeliv = 0;

		for (let i = 0; i < totalDeliv; i += 1) {
			const deliv = project.deliverables[i];
			if (!deliv) continue;
			if (Boolean(checkedMap[deliv.id]) || Boolean(checkedMap[String(i)])) {
				doneDeliv += 1;
			}
		}

		let status: PortfolioProjectStatus = pState?.status ?? "not-started";
		let pct = totalDeliv > 0 ? roundPct((doneDeliv / totalDeliv) * 100) : 0;

		if (status === "completed") {
			pct = 100;
			doneDeliv = Math.max(doneDeliv, totalDeliv);
		} else if (doneDeliv > 0 && doneDeliv === totalDeliv && totalDeliv > 0) {
			status = "completed";
			pct = 100;
		} else if (doneDeliv > 0 && status === "not-started") {
			status = "in-progress";
		}

		if (status === "completed") completedProjectsCount += 1;
		else if (status === "in-progress") inProgressProjectsCount += 1;

		completedDeliverablesCount += doneDeliv;
		totalDeliverablesCount += totalDeliv;
		projectPctSum += pct;

		byProject[project.id] = {
			projectId: project.id,
			status,
			completedDeliverablesCount: doneDeliv,
			totalDeliverablesCount: totalDeliv,
			percent: pct,
		};
	}

	const totalProjectsCount = projects.length;
	const percent =
		totalProjectsCount > 0 ? roundPct(projectPctSum / totalProjectsCount) : 0;

	return {
		completedProjectsCount,
		inProgressProjectsCount,
		totalProjectsCount,
		completedDeliverablesCount,
		totalDeliverablesCount,
		percent,
		byProject,
	};
}

function findNextModule(
	course: IntensiveCourseSpec,
	courseState: CourseProgressState,
): CourseModuleSpec | null {
	const sorted = [...course.modules].sort((a, b) => a.order - b.order);
	for (const mod of sorted) {
		if (!courseState.modules[mod.id]?.completed) {
			return mod;
		}
	}
	return null;
}

function findNextLesson(
	lessons: MediaLessonSummary[],
	courseState: CourseProgressState,
): MediaLessonSummary | null {
	if (lessons.length === 0) return null;
	const sorted = [...lessons].sort((a, b) =>
		a.order !== b.order ? a.order - b.order : a.fileName.localeCompare(b.fileName),
	);
	// Prefer an unwatched lesson that is already finished downloading.
	const readyOrPending = sorted.find(
		(l) => !courseState.videos[l.lessonId]?.watched && l.transcriptStatus !== "downloading",
	);
	if (readyOrPending) return readyOrPending;
	return sorted.find((l) => !courseState.videos[l.lessonId]?.watched) ?? null;
}

function computePacingProjection(
	track: IntensiveTrackSpec,
	state: IntensiveState,
	coursesById: Record<string, IntensiveCourseView>,
): PacingProjection {
	const pacing = state.pacing;
	const mode = pacing.mode;
	const profile = track.pacingProfiles[mode];

	const effectiveDailyDomainMinutes = Math.max(30, Math.round(pacing.dailyElectronicsMinutes));
	const parallelCourseView = track.parallelCourseId
		? coursesById[track.parallelCourseId]
		: undefined;
	const parallelCourseRemainingHours = parallelCourseView?.metrics.remainingHours ?? 0;

	// Never allocate more parallel CTA time than leaves at least 30 min/day for non-parallel Tier 1/2 work.
	const requestedParallelMinutes = Math.max(15, Math.round(pacing.dailyCtaMinutes));
	const effectiveDailyParallelMinutes =
		parallelCourseRemainingHours > 0
			? Math.min(requestedParallelMinutes, Math.max(15, effectiveDailyDomainMinutes - 30))
			: 0;
	const effectiveDailyNonParallelMinutes = Math.max(
		30,
		effectiveDailyDomainMinutes - effectiveDailyParallelMinutes,
	);
	const effectivePassiveVideoCapMinutes = Math.min(
		120,
		Math.max(30, Math.round(pacing.passiveVideoCapMinutes)),
	);

	let tier1RemainingHours = 0;
	let tier1NonParallelRemainingHours = 0;
	let coreRemainingHours = 0;
	let coreNonParallelRemainingHours = 0;

	for (const course of track.courses) {
		const view = coursesById[course.id];
		if (!view) continue;
		const rem = view.metrics.remainingHours;
		if (course.tier === 1) {
			tier1RemainingHours += rem;
			if (course.id !== track.parallelCourseId) {
				tier1NonParallelRemainingHours += rem;
			}
		}
		if (course.completionScope === "core") {
			coreRemainingHours += rem;
			if (course.id !== track.parallelCourseId) {
				coreNonParallelRemainingHours += rem;
			}
		}
	}

	// Primary milestone certification readiness combines remaining non-parallel Tier 1 hours + linked courses.
	const milestoneCert =
		track.certifications.find((c) => c.id === "cert-etai-ceta") ??
		track.certifications.find((c) => c.priorityTier === "core-paid") ??
		track.certifications.find((c) => c.priorityTier === "core-free");
	let cetaReadinessRemainingHours = tier1NonParallelRemainingHours;
	if (milestoneCert) {
		for (const cid of milestoneCert.linkedCourseIds) {
			if (cid === track.parallelCourseId) continue;
			const cv = coursesById[cid];
			if (cv && cv.spec.tier !== 1) {
				cetaReadinessRemainingHours += cv.metrics.remainingHours;
			}
		}
	}

	const tier1EstimatedDays =
		tier1NonParallelRemainingHours > 0
			? Math.ceil((tier1NonParallelRemainingHours * 60) / effectiveDailyNonParallelMinutes)
			: 0;

	const cetaEstimatedDays =
		cetaReadinessRemainingHours > 0
			? Math.ceil((cetaReadinessRemainingHours * 60) / effectiveDailyNonParallelMinutes)
			: 0;

	const parallelCourseEstimatedDays =
		parallelCourseRemainingHours > 0
			? Math.ceil((parallelCourseRemainingHours * 60) / Math.max(15, effectiveDailyParallelMinutes))
			: 0;

	const coreNonParallelDays =
		coreNonParallelRemainingHours > 0
			? Math.ceil((coreNonParallelRemainingHours * 60) / effectiveDailyNonParallelMinutes)
			: 0;
	const coreEstimatedDays = Math.max(coreNonParallelDays, parallelCourseEstimatedDays);

	const parallelTitle = parallelCourseView?.spec.title ?? "trilha paralela";
	const guardrailWarnings: string[] = [];
	if (pacing.passiveVideoCapMinutes > 120) {
		guardrailWarnings.push(
			"Teto de vídeo passivo acima de 120 min/dia: limite vídeos contínuos a 90–120 min e preserve 50% do tempo para prática ativa e exercícios.",
		);
	}
	if (pacing.dailyCtaMinutes > 75) {
		guardrailWarnings.push(
			`Cadência paralela acima de 60–75 min/dia pode travar Tier 1/2, projetos e certificações: mantenha 45–60 min/dia fixos em paralelo.`,
		);
	}
	if (profile && pacing.dailyElectronicsMinutes > profile.dailyDomainMinutesMax + 30) {
		guardrailWarnings.push(
			`Carga diária (${pacing.dailyElectronicsMinutes} min) acima da faixa sustentável para ${profile.label} (${profile.dailyDomainMinutesMin}–${profile.dailyDomainMinutesMax} min): risco de fadiga cognitiva.`,
		);
	}

	const activeGuardrails: string[] = [
		"Evite velocidade 2× em aulas densas: pause antes da resposta e preveja a solução com o Tutor IA.",
		`Regra 50/50 ativa: máximo de ${effectivePassiveVideoCapMinutes} min de vídeo passivo/dia + metade do tempo em prática ativa.`,
		`Trilha paralela (${parallelTitle}) roda em blocos fixos de 45–60 min/dia sem bloquear Tier 1/2, projetos nem certificações.`,
		"Projeção semanal baseada em 6 dias ativos/semana, reservando 1 dia para revisão semanal e descanso real.",
	];

	return {
		mode,
		effectiveDailyDomainMinutes,
		effectiveDailyParallelMinutes,
		effectiveDailyNonParallelMinutes,
		effectivePassiveVideoCapMinutes,
		tier1RemainingHours: roundHours(tier1RemainingHours),
		tier1NonParallelRemainingHours: roundHours(tier1NonParallelRemainingHours),
		tier1EstimatedDays,
		tier1EstimatedWeeks: weeksFromStudyDays(tier1EstimatedDays),
		cetaReadinessRemainingHours: roundHours(cetaReadinessRemainingHours),
		cetaEstimatedDays,
		cetaEstimatedWeeks: weeksFromStudyDays(cetaEstimatedDays),
		parallelCourseRemainingHours: roundHours(parallelCourseRemainingHours),
		parallelCourseEstimatedDays,
		parallelCourseEstimatedWeeks: weeksFromStudyDays(parallelCourseEstimatedDays),
		coreRemainingHours: roundHours(coreRemainingHours),
		coreEstimatedDays,
		coreEstimatedWeeks: weeksFromStudyDays(coreEstimatedDays),
		guardrailWarnings,
		activeGuardrails,
	};
}

function buildRecommendedActions(
	track: IntensiveTrackSpec,
	state: IntensiveState,
	coursesById: Record<string, IntensiveCourseView>,
	certifications: IntensiveCertificationView[],
	portfolioProjects: IntensivePortfolioProjectView[],
): IntensiveRecommendedAction[] {
	const actions: IntensiveRecommendedAction[] = [];

	// Slot 1: Primary non-parallel Core course (Tier 1 -> Tier 2 -> Tier 3, ordered by rank).
	const coreNonParallel = track.courses
		.filter((c) => c.completionScope === "core" && c.id !== track.parallelCourseId)
		.sort((a, b) => (a.tier !== b.tier ? a.tier - b.tier : a.rank - b.rank));

	const primaryView = coreNonParallel
		.map((c) => coursesById[c.id])
		.find(
			(v): v is IntensiveCourseView =>
				v !== undefined &&
				v.metrics.status !== "completed" &&
				v.metrics.status !== "paused",
		);

	if (primaryView) {
		const targetMod = primaryView.nextModule;
		const targetLesson = primaryView.nextLesson;
		const subtitle =
			primaryView.metrics.basis === "videos" && targetLesson
				? `Aula ${targetLesson.order}: ${targetLesson.title}`
				: targetMod
					? `Módulo ${targetMod.order}: ${targetMod.title}`
					: primaryView.spec.durationLabel;

		actions.push({
			slot: "primary-course",
			title: `#${primaryView.spec.rank} ${primaryView.spec.title}`,
			subtitle,
			reason: `Ação principal do Tier ${primaryView.spec.tier} (${primaryView.metrics.percent}% concluído) — mantém o ritmo Core e destrava portfólio/certificações.`,
			estimatedMinutes: Math.max(
				45,
				Math.min(120, state.pacing.dailyElectronicsMinutes - state.pacing.dailyCtaMinutes),
			),
			courseId: primaryView.spec.id,
			moduleId: targetMod?.id,
			lessonId: targetLesson?.lessonId,
		});
	}

	// Slot 2: Daily Parallel continuous track (CTA Eletrônica #5).
	if (track.parallelCourseId) {
		const parallelView = coursesById[track.parallelCourseId];
		if (parallelView && parallelView.metrics.status !== "completed") {
			const nextLesson = parallelView.nextLesson;
			const nextMod = parallelView.nextModule;
			const subtitle = nextLesson
				? `Vídeo #${nextLesson.order}: ${nextLesson.title}`
				: nextMod
					? `${nextMod.title} (${parallelView.metrics.videoProgress.discoveredCount}/${parallelView.metrics.videoProgress.denominatorCount || parallelView.spec.expectedTotalVideos || 0} vídeos locais)`
					: parallelView.spec.durationLabel;

			actions.push({
				slot: "daily-parallel",
				title: `#${parallelView.spec.rank} ${parallelView.spec.title}`,
				subtitle,
				reason:
					"Cadência paralela recomendada (45–60 min/dia, velocidade 1×, pausar e prever a solução antes da resposta).",
				estimatedMinutes: Math.max(45, Math.min(60, state.pacing.dailyCtaMinutes)),
				courseId: parallelView.spec.id,
				moduleId: nextMod?.id,
				lessonId: nextLesson?.lessonId,
			});
		}
	}

	// Slot 3: Active Core Certification checkpoint or next Physical Portfolio Project (P1–P5).
	const activeCoreCert =
		certifications.find(
			(c) =>
				c.metrics.isCore &&
				c.metrics.status !== "passed" &&
				c.metrics.status !== "skipped" &&
				c.spec.priorityTier === "core-free",
		) ??
		certifications.find(
			(c) =>
				c.metrics.isCore &&
				c.metrics.status !== "passed" &&
				c.metrics.status !== "skipped",
		);

	if (activeCoreCert) {
		const checkedMap = activeCoreCert.state.completedCheckpoints;
		const nextCheckpointIndex = activeCoreCert.spec.studyCheckpoints.findIndex((text, i) => {
			const key = getCertificationCheckpointKey(activeCoreCert.spec.id, i);
			return !checkedMap[key] && !checkedMap[String(i)] && !checkedMap[text];
		});
		const nextCheckpointText =
			nextCheckpointIndex >= 0
				? activeCoreCert.spec.studyCheckpoints[nextCheckpointIndex]
				: "Revisar simulado cronometrado e agendar exame no portal oficial";

		actions.push({
			slot: "certification-or-bench",
			title: `${activeCoreCert.spec.title} (${activeCoreCert.spec.phase})`,
			subtitle: nextCheckpointText ?? activeCoreCert.spec.costDisplay,
			reason: `Prontidão atual: ${activeCoreCert.metrics.readinessPct}% · ${activeCoreCert.spec.costDisplay}.`,
			estimatedMinutes: 45,
			certId: activeCoreCert.spec.id,
		});
	} else {
		const nextProject = portfolioProjects.find((p) => p.metrics.status !== "completed");
		if (nextProject) {
			const nextDeliverable = nextProject.spec.deliverables.find(
				(d, idx) =>
					!nextProject.state.completedDeliverables[d.id] &&
					!nextProject.state.completedDeliverables[String(idx)],
			);
			actions.push({
				slot: "certification-or-bench",
				title: nextProject.spec.title,
				subtitle: nextDeliverable?.label ?? nextProject.spec.summary,
				reason: `Portfólio físico (${nextProject.metrics.percent}% concluído · ${nextProject.spec.budgetDisplay}) — Regra dos 10 Segundos.`,
				estimatedMinutes: 60,
				projectId: nextProject.spec.id,
			});
		}
	}

	return actions;
}

export function computeTrackDashboard(
	track: IntensiveTrackSpec,
	state: IntensiveState,
	mediaByCourse: Record<string, CourseMediaBundle> = {},
): IntensiveDashboardDTO {
	const coursesById: Record<string, IntensiveCourseView> = {};
	const courseMetricsMap: Record<string, CourseProgressMetrics> = {};

	let linkedCoursesCount = 0;
	let discoveredVideosCount = 0;
	let expectedVideosCount = 0;
	let transcribedVideosCount = 0;
	let watchedVideosCount = 0;
	let downloadingVideosCount = 0;

	for (const spec of track.courses) {
		const courseState = state.courses[spec.id] ?? createDefaultCourseState(spec.id);
		const mediaBundle = mediaByCourse[spec.id];
		const lessons = mediaBundle?.lessons ?? [];
		const mediaSource = mediaBundle?.source ?? null;
		const transcriptionStatus = mediaBundle?.status ?? null;

		const metrics = computeCourseProgress(spec, courseState, lessons, mediaSource);
		courseMetricsMap[spec.id] = metrics;

		if (metrics.videoProgress.hasLinkedMedia) {
			linkedCoursesCount += 1;
		}
		discoveredVideosCount += metrics.videoProgress.discoveredCount;
		expectedVideosCount += metrics.videoProgress.denominatorCount;
		transcribedVideosCount += metrics.videoProgress.transcribedCount;
		watchedVideosCount += metrics.videoProgress.watchedCount;
		downloadingVideosCount += metrics.videoProgress.downloadingCount;

		coursesById[spec.id] = {
			spec,
			state: courseState,
			metrics,
			mediaSource,
			transcriptionStatus,
			mediaLessonsCount: lessons.length,
			nextModule: findNextModule(spec, courseState),
			nextLesson: findNextLesson(lessons, courseState),
		};
	}

	const sortedTiers = [...track.tiers].sort((a, b) => a.tier - b.tier);
	const tiers: IntensiveTierView[] = sortedTiers.map((tierSpec) => {
		const tierCourses = track.courses
			.filter((c) => c.tier === tierSpec.tier)
			.sort((a, b) => a.rank - b.rank)
			.map((c) => coursesById[c.id])
			.filter((v): v is IntensiveCourseView => Boolean(v));

		return {
			spec: tierSpec,
			metrics: computeTierProgress(tierSpec, tierCourses),
			courses: tierCourses,
		};
	});

	const certifications: IntensiveCertificationView[] = track.certifications.map((certSpec) => {
		const certState = state.certifications[certSpec.id] ?? createDefaultCertificationState(certSpec);
		const metrics = computeCertificationProgress(certSpec, certState, courseMetricsMap);
		return {
			spec: certSpec,
			state: certState,
			metrics,
		};
	});

	const portfolioMetrics = computePortfolioProgress(track.portfolioProjects, state.portfolio);
	const portfolioProjects: IntensivePortfolioProjectView[] = track.portfolioProjects.map(
		(projectSpec) => {
			const pState = state.portfolio[projectSpec.id] ?? createDefaultPortfolioState(projectSpec.id);
			const metrics = portfolioMetrics.byProject[projectSpec.id] ?? {
				projectId: projectSpec.id,
				status: "not-started",
				completedDeliverablesCount: 0,
				totalDeliverablesCount: projectSpec.deliverables.length,
				percent: 0,
			};
			return {
				spec: projectSpec,
				state: pState,
				metrics,
			};
		},
	);

	// Core vs On-Demand course KPIs (Tier 4 NEVER pulls Core % down).
	const allCourseViews = Object.values(coursesById);
	const coreCourseViews = allCourseViews.filter((c) => c.spec.completionScope === "core");
	const optedInOnDemandCount = allCourseViews.filter(
		(c) => c.spec.completionScope === "on-demand" && c.metrics.optedIn,
	).length;

	let corePctSum = 0;
	let coreCompletedHours = 0;
	let coreTotalHours = 0;
	let coreCompletedCourses = 0;
	for (const c of coreCourseViews) {
		corePctSum += c.metrics.percent;
		coreCompletedHours += c.metrics.completedHours;
		coreTotalHours += c.metrics.estimatedHours;
		if (c.metrics.status === "completed") coreCompletedCourses += 1;
	}

	let totalPctSum = 0;
	let totalCompletedHours = 0;
	let totalEstimatedHours = 0;
	let totalCourseLoggedMinutes = 0;
	for (const c of allCourseViews) {
		totalPctSum += c.metrics.percent;
		totalCompletedHours += c.metrics.completedHours;
		totalEstimatedHours += c.metrics.estimatedHours;
		totalCourseLoggedMinutes += c.metrics.loggedMinutes;
	}

	const studyLogMinutes = state.studyLog.reduce(
		(acc, entry) => acc + (Number.isFinite(entry.minutes) && entry.minutes > 0 ? entry.minutes : 0),
		0,
	);
	const totalLoggedMinutes = Math.round(Math.max(totalCourseLoggedMinutes, studyLogMinutes));

	const coreCertViews = certifications.filter((c) => c.metrics.isCore);
	const certReadinessSum = coreCertViews.reduce((acc, c) => acc + c.metrics.readinessPct, 0);
	const certificationsCorePct =
		coreCertViews.length > 0 ? roundPct(certReadinessSum / coreCertViews.length) : 0;
	const certificationsCorePassedCount = coreCertViews.filter(
		(c) => c.metrics.status === "passed",
	).length;

	const coreCompletionPct =
		coreCourseViews.length > 0 ? roundPct(corePctSum / coreCourseViews.length) : 0;
	const coreHoursWeightedPct =
		coreTotalHours > 0 ? roundPct((coreCompletedHours / coreTotalHours) * 100) : 0;

	const totalMilestonesCount = coreCourseViews.length + coreCertViews.length;
	const coreMilestonePct =
		totalMilestonesCount > 0
			? roundPct((corePctSum + certReadinessSum) / totalMilestonesCount)
			: 0;

	const totalWithOnDemandPct =
		allCourseViews.length > 0 ? roundPct(totalPctSum / allCourseViews.length) : 0;
	const totalWithOnDemandHoursWeightedPct =
		totalEstimatedHours > 0
			? roundPct((totalCompletedHours / totalEstimatedHours) * 100)
			: 0;

	const benchInterviewTotalCount = track.benchInterviewChecklist.length;
	const benchInterviewCheckedCount = track.benchInterviewChecklist.filter(
		(item) => Boolean(state.benchInterviewChecked[item.id]),
	).length;
	const benchInterviewPct =
		benchInterviewTotalCount > 0
			? roundPct((benchInterviewCheckedCount / benchInterviewTotalCount) * 100)
			: 0;

	const pacingProjection = computePacingProjection(track, state, coursesById);
	const nextRecommendedActions = buildRecommendedActions(
		track,
		state,
		coursesById,
		certifications,
		portfolioProjects,
	);

	return {
		track,
		state,
		tiers,
		coursesById,
		certifications,
		portfolioProjects,
		summary: {
			coreCompletionPct,
			coreMilestonePct,
			coreHoursWeightedPct,
			coreCompletedHours: roundHours(coreCompletedHours),
			coreTotalHours: roundHours(coreTotalHours),
			coreCompletedCourses,
			coreTotalCourses: coreCourseViews.length,
			totalWithOnDemandPct,
			totalWithOnDemandHoursWeightedPct,
			totalCompletedHours: roundHours(totalCompletedHours),
			totalEstimatedHours: roundHours(totalEstimatedHours),
			optedInOnDemandCount,
			certificationsCorePct,
			certificationsCorePassedCount,
			certificationsCoreTotalCount: coreCertViews.length,
			portfolioPct: portfolioMetrics.percent,
			portfolioCompletedCount: portfolioMetrics.completedProjectsCount,
			portfolioTotalCount: portfolioMetrics.totalProjectsCount,
			benchInterviewPct,
			benchInterviewCheckedCount,
			benchInterviewTotalCount,
			totalLoggedMinutes,
			mediaSummary: {
				linkedCoursesCount,
				discoveredVideosCount,
				expectedVideosCount,
				transcribedVideosCount,
				watchedVideosCount,
				downloadingVideosCount,
			},
		},
		portfolioMetrics,
		pacingProjection,
		nextRecommendedActions,
	};
}
