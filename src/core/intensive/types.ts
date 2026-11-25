/**
 * Pure, browser-safe domain types for TrilhaAtlas Intensive Study Quests
 * (seeded with "Intensiva · Eletrônica" and extensible to any personal track).
 *
 * ZERO Node builtins, ZERO filesystem/process/I/O dependencies.
 */

export type CourseTier = 1 | 2 | 3 | 4;

export type CourseOrigin =
	| "Repo"
	| "Sua lista"
	| "Referência"
	| "Repo + Ref."
	| "Custom";

export type CoursePriority =
	| "essential-now"
	| "essential-next"
	| "industry-advancement"
	| "on-demand";

export type CompletionScope = "core" | "on-demand";

export type DeliveryMode =
	| "online-self-paced"
	| "youtube-playlist"
	| "open-textbook"
	| "local-video-pack";

export type LocalPackStatus =
	| "downloading"
	| "planned-download"
	| "ready-local"
	| "not-applicable";

export type CertPhase =
	| "Mês 1"
	| "Meses 2–4"
	| "Meses 4–6"
	| "Bônus Brasil"
	| "Opcional (Nicho)";

export type CertPriorityTier =
	| "core-free"
	| "core-paid"
	| "optional-bonus"
	| "optional-niche";

export type CertStatus =
	| "locked"
	| "preparing"
	| "ready-to-book"
	| "scheduled"
	| "passed"
	| "skipped";

export type PacingMode = "full-time-home" | "with-clt";

export interface CourseUrlLink {
	label: string;
	url: string;
}

export interface CourseModuleSpec {
	id: string;
	order: number;
	title: string;
	estimatedHours: number;
	topics: string[];
	benchExercise?: string;
}

export interface ParallelCadenceSpec {
	recommendedDailyMinutesMin: number;
	recommendedDailyMinutesMax: number;
	label: string;
	rationale: string;
}

export interface IntensiveCourseSpec {
	id: string;
	rank: number;
	tier: CourseTier;
	timeframe: string;
	title: string;
	provider: string;
	origin: CourseOrigin;
	language: string;
	estimatedHours: number;
	durationLabel: string;
	priority: CoursePriority;
	completionScope: CompletionScope;
	deliveryMode: DeliveryMode;
	localPackStatus: LocalPackStatus;
	/** Expected total video count for local packs (e.g., 207 for CTA Eletrônica while downloading). */
	expectedTotalVideos?: number;
	/** Optional parallel daily pacing contract (e.g., CTA 45–60 min/day alongside Tier 1–2). */
	parallelCadence?: ParallelCadenceSpec;
	officialUrls: CourseUrlLink[];
	nocCodesUnlocked: string[];
	europeGlobalAlignment: string[];
	portfolioDeliverables: string[];
	linkedCertIds: string[];
	whyThisPosition: string;
	modules: CourseModuleSpec[];
	tutorSyllabusContext: string;
}

export interface IntensiveTierSpec {
	tier: CourseTier;
	id: string;
	title: string;
	subtitle: string;
	timeframe: string;
	completionScope: CompletionScope;
	priority: CoursePriority;
	description: string;
	uiGuidance?: string;
}

export interface CertificationSpec {
	id: string;
	phase: CertPhase;
	priorityTier: CertPriorityTier;
	title: string;
	issuer: string;
	costUSD: number;
	costBRL: number;
	studentCostUSD?: number;
	studentCostBRL?: number;
	costDisplay: string;
	examFormat: string;
	passingScore: string;
	officialUrl: string;
	secondaryUrls?: CourseUrlLink[];
	linkedCourseIds: string[];
	targetNOCs: string[];
	globalWeight: string;
	studyCheckpoints: string[];
	retakeAndDiscountNotes: string;
	verifiedAt: string;
	defaultStatus: CertStatus;
}

export interface CertificationAntiGoal {
	id: string;
	title: string;
	costOrRisk: string;
	reason: string;
	alternative: string;
	severity: "avoid" | "defer" | "reject";
}

export interface PortfolioDeliverableSpec {
	id: string;
	label: string;
	required: boolean;
}

export interface PortfolioProjectSpec {
	id: string;
	code: string;
	monthTarget: string;
	title: string;
	budgetBRLMin: number;
	budgetBRLMax: number;
	budgetDisplay: string;
	summary: string;
	deliverables: PortfolioDeliverableSpec[];
	unlocks: string[];
	linkedCourseIds: string[];
	linkedCertIds: string[];
}

export interface TenSecondRuleCriterion {
	id: string;
	order: number;
	title: string;
	description: string;
}

export interface BenchKitItemSpec {
	id: string;
	phase: "kit-enxuto" | "upgrade-lab" | "anti-goal";
	name: string;
	costBRLMin?: number;
	costBRLMax?: number;
	costDisplay: string;
	notes: string;
}

export interface BenchKitRoadmapSpec {
	legalNote: string;
	enxutoSummary: string;
	upgradeSummary: string;
	paybackNote: string;
	items: BenchKitItemSpec[];
}

export interface BenchInterviewItem {
	id: string;
	order: number;
	title: string;
	requirement: string;
	eliminatory: boolean;
}

export interface FormalWindowSpec {
	id: string;
	dateLabel: string;
	title: string;
	details: string;
	verifiedAt: string;
}

export interface CareerGuidanceSpec {
	cboToNocAvoid: string;
	cboToNocTarget: string;
	formalWindows: FormalWindowSpec[];
	targetCompanies: string[];
	internationalCvOrder: string[];
}

export interface IntensivePacingProfile {
	mode: PacingMode;
	label: string;
	dailyDomainMinutesMin: number;
	dailyDomainMinutesMax: number;
	defaultDailyDomainMinutes: number;
	dailyLanguageMinutesMin: number;
	dailyLanguageMinutesMax: number;
	defaultDailyLanguageMinutes: number;
	dailyParallelCourseMinutesMin: number;
	dailyParallelCourseMinutesMax: number;
	defaultDailyParallelCourseMinutes: number;
	passiveVideoCapMinutesMin: number;
	passiveVideoCapMinutesMax: number;
	defaultPassiveVideoCapMinutes: number;
	theoryToPracticeRatio: string;
	summary: string;
}

export interface IntensivePacingRule {
	id: string;
	order: number;
	title: string;
	summary: string;
	guardrails: string[];
}

export interface IntensiveTrackSpec {
	id: string;
	domainId: string;
	title: string;
	subtitle: string;
	tagline: string;
	verifiedAt: string;
	revalidationNotice: string;
	/** Optional long-running foundational course studied in daily parallel cadence (e.g., CTA Eletrônica #5). */
	parallelCourseId?: string;
	tiers: IntensiveTierSpec[];
	courses: IntensiveCourseSpec[];
	certifications: CertificationSpec[];
	certificationAntiGoals: CertificationAntiGoal[];
	tenSecondRule: {
		ignoredByManagers: string[];
		criteria: TenSecondRuleCriterion[];
	};
	portfolioProjects: PortfolioProjectSpec[];
	benchKit: BenchKitRoadmapSpec;
	benchInterviewChecklist: BenchInterviewItem[];
	careerGuidance: CareerGuidanceSpec;
	pacingProfiles: Record<PacingMode, IntensivePacingProfile>;
	pacingRules: IntensivePacingRule[];
}

// ─── Local Media & GPU Transcriber Manifest Schema ───────────────────────────

export interface TranscriptSegment {
	id: number;
	start: number;
	end: number;
	text: string;
}

export interface TranscriptChunk {
	index: number;
	start: number;
	end: number;
	text: string;
}

export interface LessonTranscriptDoc {
	schemaVersion: 1;
	courseId: string;
	lessonId: string;
	fileName: string;
	filePath?: string;
	fileSize: number;
	fileMtimeMs: number;
	title: string;
	order: number;
	durationSec: number;
	language: string;
	model: string;
	transcribedAt: string;
	telegramCaption?: string;
	wordCount: number;
	fullText: string;
	segments: TranscriptSegment[];
	chunks: TranscriptChunk[];
}

export type MediaTranscriptStatus =
	| "ready"
	| "transcribing"
	| "pending"
	| "downloading"
	| "error";

export interface MediaLessonSummary {
	lessonId: string;
	fileName: string;
	title: string;
	order: number;
	durationSec: number;
	fileSize: number;
	fileMtimeMs: number;
	section?: string;
	telegramCaption?: string;
	transcriptStatus: MediaTranscriptStatus;
	wordCount?: number;
	chunkCount?: number;
	transcribedAt?: string;
	error?: string;
}

export interface CourseMediaSource {
	courseId: string;
	sourceDir: string;
	label?: string;
	language: string;
	configuredAt: string;
	expectedTotalVideos?: number;
}

export type TranscriptionJobState =
	| "idle"
	| "running"
	| "watching"
	| "completed"
	| "error";

export interface CourseTranscriptionStatus {
	courseId: string;
	state: TranscriptionJobState;
	pid?: number;
	model?: string;
	device?: string;
	discoveredCount: number;
	readyCount: number;
	pendingCount: number;
	downloadingCount: number;
	errorCount: number;
	currentFile?: string | null;
	avgRealtimeFactor?: number | null;
	startedAt?: string;
	lastUpdatedAt?: string;
	lastError?: string | null;
}

// ─── User State & Persistence Types ──────────────────────────────────────────

export interface CustomResourceLink {
	id: string;
	label: string;
	url: string;
	addedAt: string;
}

export interface TimestampNote {
	id: string;
	timeSec: number;
	label: string;
	note?: string;
	createdAt: string;
}

export interface VideoLessonProgressState {
	watched: boolean;
	watchedAt?: string;
	positionSec: number;
	durationSec?: number;
	notes: string;
	bookmarks: TimestampNote[];
}

export interface ModuleProgressState {
	completed: boolean;
	completedAt?: string;
	loggedMinutes: number;
	notes: string;
	customLinks: CustomResourceLink[];
}

export type CourseManualStatus = "auto" | "in-progress" | "completed" | "paused";

export interface CourseProgressState {
	courseId: string;
	/** For Tier 4 on-demand courses explicitly activated by the learner. */
	optedIn?: boolean;
	manualStatus?: CourseManualStatus;
	courseNotes: string;
	customLinks: CustomResourceLink[];
	modules: Record<string, ModuleProgressState>;
	videos: Record<string, VideoLessonProgressState>;
	lastStudiedAt?: string;
}

export interface CertificationProgressState {
	certId: string;
	status: CertStatus;
	completedCheckpoints: Record<string, boolean>;
	targetDate?: string;
	scheduledAt?: string;
	passedAt?: string;
	credentialId?: string;
	credentialUrl?: string;
	mockScorePct?: number;
	notes: string;
}

export type PortfolioProjectStatus = "not-started" | "in-progress" | "completed";

export interface PortfolioProgressState {
	projectId: string;
	status: PortfolioProjectStatus;
	completedDeliverables: Record<string, boolean>;
	repoUrl?: string;
	notes: string;
}

export interface PacingSettings {
	mode: PacingMode;
	/** Daily electronics study budget in minutes (default 240 full-time-home, 120 with-clt). */
	dailyElectronicsMinutes: number;
	/** Daily main target language study budget in minutes (default 75). */
	dailyLanguageMinutes: number;
	/** Daily parallel CTA video/analysis budget in minutes (default 55). */
	dailyCtaMinutes: number;
	/** Passive video guardrail cap in minutes (default 105). */
	passiveVideoCapMinutes: number;
	startDate?: string;
}

export type StudyLogCategory =
	| "course"
	| "video"
	| "bench"
	| "certification"
	| "portfolio"
	| "review";

export interface StudyLogEntry {
	id: string;
	date: string;
	minutes: number;
	category: StudyLogCategory;
	courseId?: string;
	lessonId?: string;
	moduleId?: string;
	certId?: string;
	projectId?: string;
	note?: string;
	createdAt: string;
}

export interface IntensiveState {
	schemaVersion: 1;
	trackId: string;
	createdAt: string;
	updatedAt: string;
	pacing: PacingSettings;
	courses: Record<string, CourseProgressState>;
	certifications: Record<string, CertificationProgressState>;
	portfolio: Record<string, PortfolioProgressState>;
	benchInterviewChecked: Record<string, boolean>;
	benchKitOwned: Record<string, boolean>;
	studyLog: StudyLogEntry[];
}

// ─── Derived Metrics & API / UI DTO Types ────────────────────────────────────

export type CourseDerivedStatus =
	| "not-started"
	| "in-progress"
	| "completed"
	| "paused";

export interface CourseVideoProgressMetrics {
	hasLinkedMedia: boolean;
	discoveredCount: number;
	expectedTotalCount: number;
	/** Denominator used for progress: Math.max(discoveredCount, expectedTotalCount). */
	denominatorCount: number;
	watchedCount: number;
	transcribedCount: number;
	downloadingCount: number;
	pendingCount: number;
	errorCount: number;
	totalDurationSec: number;
	watchedDurationSec: number;
	percent: number;
}

export interface CourseModuleProgressMetrics {
	completedCount: number;
	totalCount: number;
	completedHours: number;
	totalHours: number;
	loggedMinutes: number;
	percent: number;
}

export interface CourseProgressMetrics {
	courseId: string;
	status: CourseDerivedStatus;
	percent: number;
	basis: "videos" | "modules" | "hybrid" | "manual";
	completedHours: number;
	estimatedHours: number;
	remainingHours: number;
	loggedMinutes: number;
	moduleProgress: CourseModuleProgressMetrics;
	videoProgress: CourseVideoProgressMetrics;
	optedIn: boolean;
	countsInCore: boolean;
	lastStudiedAt?: string;
}

export interface CourseMediaBundle {
	lessons: MediaLessonSummary[];
	status: CourseTranscriptionStatus | null;
	source: CourseMediaSource | null;
}

export interface IntensiveCourseView {
	spec: IntensiveCourseSpec;
	state: CourseProgressState;
	metrics: CourseProgressMetrics;
	mediaSource: CourseMediaSource | null;
	transcriptionStatus: CourseTranscriptionStatus | null;
	mediaLessonsCount: number;
	nextModule: CourseModuleSpec | null;
	nextLesson: MediaLessonSummary | null;
}

export interface TierProgressMetrics {
	tier: CourseTier;
	courseCount: number;
	completedCourseCount: number;
	inProgressCourseCount: number;
	optedInCourseCount: number;
	/** Balanced course-average % (finishing 1 of 5 Tier-1 courses immediately moves Tier 1 by +20%). */
	percent: number;
	hoursWeightedPct: number;
	completedHours: number;
	totalHours: number;
}

export interface IntensiveTierView {
	spec: IntensiveTierSpec;
	metrics: TierProgressMetrics;
	courses: IntensiveCourseView[];
}

export interface CertificationProgressMetrics {
	certId: string;
	status: CertStatus;
	checkedCheckpointsCount: number;
	totalCheckpointsCount: number;
	checkpointsPct: number;
	linkedCoursesPct: number;
	/** 70% checked studyCheckpoints + 30% linked course completion, or 100% if passed. */
	readinessPct: number;
	isCore: boolean;
}

export interface IntensiveCertificationView {
	spec: CertificationSpec;
	state: CertificationProgressState;
	metrics: CertificationProgressMetrics;
}

export interface PortfolioProjectMetrics {
	projectId: string;
	status: PortfolioProjectStatus;
	completedDeliverablesCount: number;
	totalDeliverablesCount: number;
	percent: number;
}

export interface PortfolioProgressMetrics {
	completedProjectsCount: number;
	inProgressProjectsCount: number;
	totalProjectsCount: number;
	completedDeliverablesCount: number;
	totalDeliverablesCount: number;
	percent: number;
	byProject: Record<string, PortfolioProjectMetrics>;
}

export interface IntensivePortfolioProjectView {
	spec: PortfolioProjectSpec;
	state: PortfolioProgressState;
	metrics: PortfolioProjectMetrics;
}

export interface PacingProjection {
	mode: PacingMode;
	effectiveDailyDomainMinutes: number;
	effectiveDailyParallelMinutes: number;
	effectiveDailyNonParallelMinutes: number;
	effectivePassiveVideoCapMinutes: number;
	tier1RemainingHours: number;
	tier1NonParallelRemainingHours: number;
	tier1EstimatedDays: number;
	tier1EstimatedWeeks: number;
	cetaReadinessRemainingHours: number;
	cetaEstimatedDays: number;
	cetaEstimatedWeeks: number;
	parallelCourseRemainingHours: number;
	parallelCourseEstimatedDays: number;
	parallelCourseEstimatedWeeks: number;
	coreRemainingHours: number;
	coreEstimatedDays: number;
	coreEstimatedWeeks: number;
	guardrailWarnings: string[];
	activeGuardrails: string[];
}

export interface IntensiveRecommendedAction {
	slot: "primary-course" | "daily-parallel" | "certification-or-bench";
	title: string;
	subtitle: string;
	reason: string;
	estimatedMinutes: number;
	courseId?: string;
	moduleId?: string;
	lessonId?: string;
	certId?: string;
	projectId?: string;
}

export interface IntensiveDashboardSummary {
	/** Balanced milestone % across Core courses (Tiers 1–3, #1–#14). */
	coreCompletionPct: number;
	/** Combined milestone % across Core courses + Core certifications. */
	coreMilestonePct: number;
	/** Hours-weighted % across Core courses (completed core hours / total core hours). */
	coreHoursWeightedPct: number;
	coreCompletedHours: number;
	coreTotalHours: number;
	coreCompletedCourses: number;
	coreTotalCourses: number;
	/** Balanced course-average % across all courses including Tier 4 on-demand. */
	totalWithOnDemandPct: number;
	totalWithOnDemandHoursWeightedPct: number;
	totalCompletedHours: number;
	totalEstimatedHours: number;
	optedInOnDemandCount: number;
	/** Average readiness/completion % across Core certifications (Month 1 free + CETa + NI CLAD). */
	certificationsCorePct: number;
	certificationsCorePassedCount: number;
	certificationsCoreTotalCount: number;
	portfolioPct: number;
	portfolioCompletedCount: number;
	portfolioTotalCount: number;
	benchInterviewPct: number;
	benchInterviewCheckedCount: number;
	benchInterviewTotalCount: number;
	totalLoggedMinutes: number;
	mediaSummary: {
		linkedCoursesCount: number;
		discoveredVideosCount: number;
		expectedVideosCount: number;
		transcribedVideosCount: number;
		watchedVideosCount: number;
		downloadingVideosCount: number;
	};
}

export interface IntensiveDashboardDTO {
	track: IntensiveTrackSpec;
	state: IntensiveState;
	tiers: IntensiveTierView[];
	coursesById: Record<string, IntensiveCourseView>;
	certifications: IntensiveCertificationView[];
	portfolioProjects: IntensivePortfolioProjectView[];
	summary: IntensiveDashboardSummary;
	portfolioMetrics: PortfolioProgressMetrics;
	pacingProjection: PacingProjection;
	nextRecommendedActions: IntensiveRecommendedAction[];
}

export interface IntensiveSearchHit {
	courseId: string;
	courseTitle: string;
	lessonId: string;
	lessonTitle: string;
	order: number;
	chunkIndex: number;
	startSec: number;
	endSec: number;
	timestampLabel: string;
	snippet: string;
	matchedText: string;
	score: number;
	matchedTokens: string[];
	telegramCaption?: string;
}

// ─── Course Materials (PDFs, Apostilas, Exercises, Schematics) & Node Bridge ─

export type MaterialCategory =
	| "pdf"
	| "doc"
	| "text"
	| "image"
	| "spreadsheet"
	| "archive"
	| "other";

export interface CourseMaterialSummary {
	materialId: string;
	title: string;
	fileName: string;
	relativePath: string;
	section: string;
	category: MaterialCategory;
	sizeBytes: number;
	mtimeMs: number;
	pageCount?: number;
	wordCount?: number;
	chunkCount?: number;
	hasText: boolean;
}

export interface MaterialTextChunk {
	index: number;
	page?: number;
	text: string;
}

export interface CourseMaterialDoc {
	schemaVersion: 1;
	courseId: string;
	materialId: string;
	title: string;
	fileName: string;
	relativePath: string;
	section: string;
	category: MaterialCategory;
	sizeBytes: number;
	pageCount?: number;
	wordCount: number;
	extractedAt: string;
	chunks: MaterialTextChunk[];
}

export interface IntensiveMaterialSearchHit {
	courseId: string;
	courseTitle: string;
	materialId: string;
	materialTitle: string;
	fileName: string;
	section: string;
	category: MaterialCategory;
	page?: number;
	chunkIndex: number;
	snippet: string;
	score: number;
	matchedTokens: string[];
}

export interface CurriculumNodeMatch {
	nodeId: string;
	title: string;
	regionTitle?: string;
	score: number;
	matchedTerms: string[];
}

export interface IntensiveTutorContextPayload {
	trackId: string;
	trackTitle: string;
	courseId?: string;
	courseTitle?: string;
	courseRank?: number;
	courseTier?: CourseTier;
	tutorSyllabusContext?: string;
	moduleId?: string;
	moduleTitle?: string;
	moduleTopics?: string[];
	benchExercise?: string;
	lessonId?: string;
	lessonTitle?: string;
	lessonOrder?: number;
	currentTimeSec?: number;
	currentTimestampLabel?: string;
	transcriptExcerpt?: string;
	telegramCaption?: string;
	materialId?: string;
	materialTitle?: string;
	materialExcerpt?: string;
	relatedCurriculumNodes?: CurriculumNodeMatch[];
	relevantSnippets?: IntensiveSearchHit[];
	certId?: string;
	certTitle?: string;
	projectId?: string;
	projectTitle?: string;
	learnerNotes?: string;
}
