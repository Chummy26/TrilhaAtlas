"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
	AlertTriangleIcon,
	ArrowLeftIcon,
	ArrowUpRightIcon,
	BookmarkIcon,
	BookOpenIcon,
	BotIcon,
	CheckCircle2Icon,
	CheckIcon,
	ClockIcon,
	CompassIcon,
	CpuIcon,
	ExternalLinkIcon,
	FileTextIcon,
	FilmIcon,
	FolderOpenIcon,
	Link2Icon,
	PlayIcon,
	PlusIcon,
	RefreshCwIcon,
	SearchIcon,
	SquareIcon,
	Trash2Icon,
} from "lucide-react";
import {
	formatTimestamp,
	type CourseManualStatus,
	type CourseMaterialDoc,
	type CourseMaterialSummary,
	type CourseModuleSpec,
	type CourseTranscriptionStatus,
	type CurriculumNodeMatch,
	type IntensiveCourseView,
	type IntensiveDashboardDTO,
	type IntensiveSearchHit,
	type LessonTranscriptDoc,
	type MaterialCategory,
	type MediaLessonSummary,
	type MediaTranscriptStatus,
} from "@/src/core";
import { useT } from "@/components/i18n";
import {
	formatHoursCompact,
	formatMaterialSize,
	INTENSIVE_BTN_COMPACT,
	INTENSIVE_BTN_PRIMARY,
	INTENSIVE_BTN_SECONDARY,
	INTENSIVE_INPUT,
	INTENSIVE_SELECT_AUTO,
	type IntensiveMutation,
	type IntensiveSearchResponse,
} from "./tutor-launch.ts";

export type CoursePanelTab = "transcript" | "playlist" | "materials" | "modules";

interface CourseWorkspaceProps {
	dashboard: IntensiveDashboardDTO;
	courseId: string;
	initialLessonId?: string;
	initialTimeSec?: number;
	initialPanelTab?: CoursePanelTab;
	initialMaterialQuery?: string;
	initialMaterialId?: string;
	materialNavNonce?: number;
	onSelectCourse: (courseId: string) => void;
	onBackToQuests: () => void;
	onOpenLinkModal: (courseId: string) => void;
	onOpenCert: (certId: string) => void;
	onMutate: (mutation: IntensiveMutation) => Promise<void>;
	onAskTutor: (params: {
		title: string;
		openingPrompt: string;
		courseId: string;
		moduleId?: string;
		lessonId?: string;
		materialId?: string;
		currentTimeSec?: number;
	}) => Promise<void>;
	busyKey: string | null;
	mediaRevision: number;
}

type RightPanelTab = CoursePanelTab;
type PlaylistFilter = "all" | "unwatched" | "transcribed" | "pending";
type MaterialCategoryFilter = "all" | "pdf" | "text" | "image";

const MATERIALS_PAGE_SIZE = 40;
const MATERIAL_PREVIEW_CHUNKS_STEP = 12;
const MATERIAL_GENERAL_SECTION_KEY = "__general__";

function matchesMaterialCategory(
	category: MaterialCategory,
	filter: MaterialCategoryFilter,
): boolean {
	if (filter === "all") return true;
	if (filter === "pdf") return category === "pdf";
	if (filter === "image") return category === "image";
	return category === "text" || category === "doc" || category === "spreadsheet";
}

function materialCategoryBadge(category: MaterialCategory): string {
	switch (category) {
		case "pdf":
			return "PDF";
		case "doc":
			return "DOC";
		case "text":
			return "TXT";
		case "image":
			return "IMG";
		case "spreadsheet":
			return "XLS";
		case "archive":
			return "ZIP";
		default:
			return "FILE";
	}
}

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

function transcriptDotClass(status: MediaTranscriptStatus): string {
	switch (status) {
		case "ready":
			return "bg-[var(--cel-success,var(--lh-success))]";
		case "transcribing":
			return "bg-[var(--cel-accent,var(--primary))]";
		case "downloading":
			return "bg-[var(--cel-warning,var(--lh-warning))]";
		case "error":
			return "bg-error";
		default:
			return "bg-muted-foreground/45";
	}
}

function transcriptStatusLabel(status: MediaTranscriptStatus, t: ReturnType<typeof useT>): string {
	switch (status) {
		case "ready":
			return t("intensive.course.tStatusReady");
		case "transcribing":
			return t("intensive.course.tStatusTranscribing");
		case "downloading":
			return t("intensive.course.tStatusDownloading");
		case "error":
			return t("intensive.course.tStatusError");
		default:
			return t("intensive.course.tStatusPending");
	}
}

function gpuStateLabel(
	state: CourseTranscriptionStatus["state"] | undefined,
	t: ReturnType<typeof useT>,
): string {
	switch (state) {
		case "running":
			return t("intensive.course.gpuStateRunning");
		case "watching":
			return t("intensive.course.gpuStateWatching");
		case "completed":
			return t("intensive.course.gpuStateCompleted");
		case "error":
			return t("intensive.course.gpuStateError");
		default:
			return t("intensive.course.gpuStateIdle");
	}
}

export function CourseWorkspace({
	dashboard,
	courseId,
	initialLessonId,
	initialTimeSec,
	initialPanelTab,
	initialMaterialQuery,
	initialMaterialId,
	materialNavNonce,
	onSelectCourse,
	onBackToQuests,
	onOpenLinkModal,
	onOpenCert,
	onMutate,
	onAskTutor,
	busyKey,
	mediaRevision,
}: CourseWorkspaceProps) {
	const t = useT();
	const course: IntensiveCourseView | undefined =
		dashboard.coursesById[courseId] ?? dashboard.tiers[0]?.courses[0];

	const [lessons, setLessons] = useState<MediaLessonSummary[]>([]);
	const [materials, setMaterials] = useState<CourseMaterialSummary[]>([]);
	const [relatedCurriculumNodes, setRelatedCurriculumNodes] = useState<CurriculumNodeMatch[]>([]);
	const [lessonsLoading, setLessonsLoading] = useState(false);
	const [activeLessonId, setActiveLessonId] = useState<string | undefined>(initialLessonId);
	const [gpuStatus, setGpuStatus] = useState<CourseTranscriptionStatus | null>(
		course?.transcriptionStatus ?? null,
	);
	const [gpuBusy, setGpuBusy] = useState(false);
	const [gpuError, setGpuError] = useState<string | null>(null);

	// Video player state
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
	const pendingSeekRef = useRef<number | null>(
		typeof initialTimeSec === "number" && initialTimeSec > 0 ? initialTimeSec : null,
	);
	const lastSavedPosAtRef = useRef<number>(0);
	const autoWatchedSentRef = useRef<string | null>(null);

	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const [playbackRate, setPlaybackRate] = useState<number>(1);
	const [bookmarkDraft, setBookmarkDraft] = useState("");
	const [bookmarkOpen, setBookmarkOpen] = useState(false);
	const [lessonNotesDraft, setLessonNotesDraft] = useState("");
	const [lessonNotesSaved, setLessonNotesSaved] = useState(false);

	// Right column / transcript / playlist / materials state
	const [rightTab, setRightTab] = useState<RightPanelTab>(initialPanelTab ?? "transcript");
	const [externalTab, setExternalTab] = useState<"modules" | "materials">(
		initialPanelTab === "materials" ? "materials" : "modules",
	);
	const [followVideo, setFollowVideo] = useState(true);
	const [transcriptDoc, setTranscriptDoc] = useState<LessonTranscriptDoc | null>(null);
	const [transcriptLoading, setTranscriptLoading] = useState(false);
	const [transcriptQuery, setTranscriptQuery] = useState("");
	const [transcriptScope, setTranscriptScope] = useState<"lesson" | "course">("lesson");
	const [courseSearchHits, setCourseSearchHits] = useState<IntensiveSearchHit[]>([]);
	const [courseSearchLoading, setCourseSearchLoading] = useState(false);

	const [playlistQuery, setPlaylistQuery] = useState("");
	const [playlistFilter, setPlaylistFilter] = useState<PlaylistFilter>("all");

	// Course materials & apostilas panel state
	const [materialsQuery, setMaterialsQuery] = useState(initialMaterialQuery ?? "");
	const [materialsSection, setMaterialsSection] = useState<string>("all");
	const [materialsCategory, setMaterialsCategory] = useState<MaterialCategoryFilter>("all");
	const [materialsVisibleCount, setMaterialsVisibleCount] = useState<number>(MATERIALS_PAGE_SIZE);
	const [expandedMaterialId, setExpandedMaterialId] = useState<string | null>(null);
	const [materialDocsCache, setMaterialDocsCache] = useState<
		Record<string, CourseMaterialDoc | null>
	>({});
	const [materialDocLoadingId, setMaterialDocLoadingId] = useState<string | null>(null);
	const [materialChunksLimit, setMaterialChunksLimit] = useState<Record<string, number>>({});

	// Course & module notes / links drafts
	const [courseNotesDraft, setCourseNotesDraft] = useState(course?.state.courseNotes ?? "");
	const [courseNotesSaved, setCourseNotesSaved] = useState(false);
	const [newCourseLinkLabel, setNewCourseLinkLabel] = useState("");
	const [newCourseLinkUrl, setNewCourseLinkUrl] = useState("");
	const [moduleNotesDrafts, setModuleNotesDrafts] = useState<Record<string, string>>({});
	const [moduleLinkDrafts, setModuleLinkDrafts] = useState<
		Record<string, { label: string; url: string }>
	>({});
	const [expandedModuleNotes, setExpandedModuleNotes] = useState<Record<string, boolean>>({});

	const resolvedCourseId = course?.spec.id ?? courseId;

	// Sync external course notes draft when switching course
	useEffect(() => {
		if (!course) return;
		setCourseNotesDraft(course.state.courseNotes ?? "");
		setCourseNotesSaved(false);
		setGpuStatus(course.transcriptionStatus ?? null);
		const drafts: Record<string, string> = {};
		for (const mod of course.spec.modules) {
			drafts[mod.id] = course.state.modules[mod.id]?.notes ?? "";
		}
		setModuleNotesDrafts(drafts);
	}, [resolvedCourseId, course?.state.courseNotes]);

	// Reset per-course material preview & filter state on course switch
	useEffect(() => {
		setMaterials([]);
		setRelatedCurriculumNodes([]);
		setMaterialsQuery("");
		setMaterialsSection("all");
		setMaterialsCategory("all");
		setMaterialsVisibleCount(MATERIALS_PAGE_SIZE);
		setExpandedMaterialId(null);
		setMaterialDocsCache({});
		setMaterialDocLoadingId(null);
		setMaterialChunksLimit({});
		setExternalTab("modules");
	}, [resolvedCourseId]);

	// Sync deep-link props when jumping from global search
	useEffect(() => {
		if (initialLessonId) {
			setActiveLessonId(initialLessonId);
			setRightTab("transcript");
		}
		if (typeof initialTimeSec === "number" && initialTimeSec >= 0) {
			pendingSeekRef.current = initialTimeSec;
			if (videoRef.current && videoRef.current.readyState >= 1) {
				videoRef.current.currentTime = initialTimeSec;
			}
		}
	}, [initialLessonId, initialTimeSec]);

	// Sync deep-link material search hit -> open Materials tab pre-filtered
	useEffect(() => {
		if (initialPanelTab !== "materials") return;
		setRightTab("materials");
		setExternalTab("materials");
		setMaterialsSection("all");
		setMaterialsCategory("all");
		setMaterialsVisibleCount(MATERIALS_PAGE_SIZE);
		setMaterialsQuery(initialMaterialQuery ?? "");
		if (initialMaterialId) {
			setExpandedMaterialId(null);
		}
	}, [initialPanelTab, initialMaterialQuery, initialMaterialId, materialNavNonce, resolvedCourseId]);

	// Reset material pagination whenever filter criteria change
	useEffect(() => {
		setMaterialsVisibleCount(MATERIALS_PAGE_SIZE);
	}, [materialsQuery, materialsSection, materialsCategory]);

	// Load course detail, local lessons, study materials, and curriculum node bridge
	const fetchCourseLessons = useCallback(
		async (signal?: AbortSignal) => {
			if (!resolvedCourseId) return;
			setLessonsLoading(true);
			try {
				const res = await fetch(
					`/api/intensive/courses/${encodeURIComponent(resolvedCourseId)}`,
					{ signal },
				);
				if (!res.ok) return;
				const data = (await res.json()) as {
					course?: IntensiveCourseView;
					lessons?: MediaLessonSummary[];
					materials?: CourseMaterialSummary[];
					relatedCurriculumNodes?: CurriculumNodeMatch[];
				};
				if (signal?.aborted) return;
				const nextLessons = Array.isArray(data.lessons) ? data.lessons : [];
				const nextMaterials = Array.isArray(data.materials) ? data.materials : [];
				const nextNodes = Array.isArray(data.relatedCurriculumNodes)
					? data.relatedCurriculumNodes
					: [];
				setLessons(nextLessons);
				setMaterials(nextMaterials);
				setRelatedCurriculumNodes(nextNodes);
				if (data.course?.transcriptionStatus) {
					setGpuStatus(data.course.transcriptionStatus);
				}
				setActiveLessonId((prev) => {
					if (prev && nextLessons.some((l) => l.lessonId === prev)) return prev;
					if (initialLessonId && nextLessons.some((l) => l.lessonId === initialLessonId)) {
						return initialLessonId;
					}
					const nextPreferred = data.course?.nextLesson?.lessonId;
					if (nextPreferred && nextLessons.some((l) => l.lessonId === nextPreferred)) {
						return nextPreferred;
					}
					return nextLessons[0]?.lessonId;
				});
			} catch {
				// Graceful fallback to dashboard summary
			} finally {
				if (!signal?.aborted) setLessonsLoading(false);
			}
		},
		[resolvedCourseId, initialLessonId],
	);

	useEffect(() => {
		const ctrl = new AbortController();
		void fetchCourseLessons(ctrl.signal);
		return () => ctrl.abort();
	}, [fetchCourseLessons, mediaRevision]);

	const activeLesson = useMemo(
		() => lessons.find((l) => l.lessonId === activeLessonId) ?? lessons[0] ?? null,
		[lessons, activeLessonId],
	);

	const activeVideoProgress = activeLesson
		? course?.state.videos[activeLesson.lessonId]
		: undefined;

	// Sync lesson notes when lesson changes
	useEffect(() => {
		setLessonNotesDraft(activeVideoProgress?.notes ?? "");
		setLessonNotesSaved(false);
		autoWatchedSentRef.current = null;
		setCurrentTime(activeVideoProgress?.positionSec ?? 0);
		setDuration(activeLesson?.durationSec ?? 0);
	}, [activeLesson?.lessonId]);

	// Fetch transcript JSON when active lesson is ready
	useEffect(() => {
		if (!activeLesson || activeLesson.transcriptStatus !== "ready") {
			setTranscriptDoc(null);
			setTranscriptLoading(false);
			return;
		}
		const ctrl = new AbortController();
		setTranscriptLoading(true);
		fetch(
			`/api/intensive/courses/${encodeURIComponent(resolvedCourseId)}/lessons/${encodeURIComponent(activeLesson.lessonId)}/transcript`,
			{ signal: ctrl.signal },
		)
			.then(async (res) => {
				if (!res.ok) return null;
				return (await res.json()) as LessonTranscriptDoc;
			})
			.then((doc) => {
				if (!ctrl.signal.aborted) setTranscriptDoc(doc);
			})
			.catch(() => {
				if (!ctrl.signal.aborted) setTranscriptDoc(null);
			})
			.finally(() => {
				if (!ctrl.signal.aborted) setTranscriptLoading(false);
			});
		return () => ctrl.abort();
	}, [resolvedCourseId, activeLesson?.lessonId, activeLesson?.transcriptStatus]);

	// Poll GPU transcription every 8s ONLY while running or watching
	const isGpuActive = gpuStatus?.state === "running" || gpuStatus?.state === "watching";
	const prevCountsRef = useRef<{ ready: number; discovered: number }>({
		ready: gpuStatus?.readyCount ?? 0,
		discovered: gpuStatus?.discoveredCount ?? 0,
	});

	useEffect(() => {
		if (!isGpuActive || !resolvedCourseId) return;
		const timer = window.setInterval(async () => {
			try {
				const res = await fetch("/api/intensive/transcribe");
				if (!res.ok) return;
				const data = (await res.json()) as {
					statuses?: Record<string, CourseTranscriptionStatus>;
				};
				const nextStatus = data.statuses?.[resolvedCourseId] ?? null;
				if (nextStatus) {
					setGpuStatus(nextStatus);
					if (
						nextStatus.readyCount !== prevCountsRef.current.ready ||
						nextStatus.discoveredCount !== prevCountsRef.current.discovered
					) {
						prevCountsRef.current = {
							ready: nextStatus.readyCount,
							discovered: nextStatus.discoveredCount,
						};
						void fetchCourseLessons();
					}
				}
			} catch {
				// Ignore transient network errors during poll
			}
		}, 8000);
		return () => window.clearInterval(timer);
	}, [isGpuActive, resolvedCourseId, fetchCourseLessons]);

	// Course-wide transcript search when scope === "course"
	useEffect(() => {
		if (transcriptScope !== "course") return;
		const q = transcriptQuery.trim();
		if (q.length < 2) {
			setCourseSearchHits([]);
			return;
		}
		const ctrl = new AbortController();
		const timer = window.setTimeout(async () => {
			setCourseSearchLoading(true);
			try {
				const res = await fetch(
					`/api/intensive/search?q=${encodeURIComponent(q)}&courseId=${encodeURIComponent(resolvedCourseId)}&limit=30`,
					{ signal: ctrl.signal },
				);
				if (!res.ok) return;
				const data = (await res.json()) as IntensiveSearchResponse;
				if (!ctrl.signal.aborted) {
					setCourseSearchHits(Array.isArray(data.transcriptHits) ? data.transcriptHits : []);
				}
			} catch {
				// Aborted or failed
			} finally {
				if (!ctrl.signal.aborted) setCourseSearchLoading(false);
			}
		}, 250);
		return () => {
			window.clearTimeout(timer);
			ctrl.abort();
		};
	}, [transcriptScope, transcriptQuery, resolvedCourseId]);

	// Active transcript segment + gentle auto-scroll inside transcript container only
	const activeSegmentId = useMemo(() => {
		if (!transcriptDoc?.segments?.length) return null;
		for (const seg of transcriptDoc.segments) {
			if (currentTime >= seg.start && currentTime < seg.end) return seg.id;
		}
		return null;
	}, [transcriptDoc, currentTime]);

	useEffect(() => {
		if (!followVideo || activeSegmentId === null || transcriptQuery.trim()) return;
		const container = transcriptScrollRef.current;
		if (!container) return;
		const el = container.querySelector<HTMLElement>(`[data-seg-id="${activeSegmentId}"]`);
		if (!el) return;
		const top = el.offsetTop - container.clientHeight * 0.32;
		const prefersReduced =
			typeof window !== "undefined" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		container.scrollTo({
			top: Math.max(0, top),
			behavior: prefersReduced ? "auto" : "smooth",
		});
	}, [activeSegmentId, followVideo, transcriptQuery]);

	const filteredSegments = useMemo(() => {
		const segments = transcriptDoc?.segments ?? [];
		const q = transcriptQuery.trim().toLowerCase();
		if (!q || transcriptScope !== "lesson") return segments;
		return segments.filter((seg) => seg.text.toLowerCase().includes(q));
	}, [transcriptDoc, transcriptQuery, transcriptScope]);

	const filteredLessons = useMemo(() => {
		const q = playlistQuery.trim().toLowerCase();
		return lessons.filter((lesson) => {
			const watched = Boolean(course?.state.videos[lesson.lessonId]?.watched);
			if (playlistFilter === "unwatched" && watched) return false;
			if (playlistFilter === "transcribed" && lesson.transcriptStatus !== "ready") return false;
			if (
				playlistFilter === "pending" &&
				lesson.transcriptStatus !== "pending" &&
				lesson.transcriptStatus !== "downloading"
			) {
				return false;
			}
			if (!q) return true;
			return (
				lesson.title.toLowerCase().includes(q) ||
				lesson.fileName.toLowerCase().includes(q) ||
				String(lesson.order).includes(q)
			);
		});
	}, [lessons, playlistQuery, playlistFilter, course?.state.videos]);

	const materialSections = useMemo(() => {
		const counts = new Map<string, number>();
		for (const mat of materials) {
			const key = mat.section.trim() || MATERIAL_GENERAL_SECTION_KEY;
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		return Array.from(counts.entries())
			.map(([key, count]) => ({
				key,
				label:
					key === MATERIAL_GENERAL_SECTION_KEY
						? t("intensive.course.materialGeneralSection")
						: key,
				count,
			}))
			.sort((a, b) => {
				if (a.key === MATERIAL_GENERAL_SECTION_KEY) return 1;
				if (b.key === MATERIAL_GENERAL_SECTION_KEY) return -1;
				return a.label.localeCompare(b.label, undefined, { numeric: true });
			});
	}, [materials, t]);

	const filteredMaterials = useMemo(() => {
		const q = materialsQuery.trim().toLowerCase();
		return materials.filter((mat) => {
			if (!matchesMaterialCategory(mat.category, materialsCategory)) return false;
			if (materialsSection !== "all") {
				const secKey = mat.section.trim() || MATERIAL_GENERAL_SECTION_KEY;
				if (secKey !== materialsSection) return false;
			}
			if (!q) return true;
			return (
				mat.title.toLowerCase().includes(q) ||
				mat.fileName.toLowerCase().includes(q) ||
				mat.section.toLowerCase().includes(q) ||
				mat.materialId.toLowerCase().includes(q)
			);
		});
	}, [materials, materialsQuery, materialsSection, materialsCategory]);

	const visibleMaterials = useMemo(
		() => filteredMaterials.slice(0, materialsVisibleCount),
		[filteredMaterials, materialsVisibleCount],
	);

	const handleToggleMaterialText = useCallback(
		async (materialId: string) => {
			if (expandedMaterialId === materialId) {
				setExpandedMaterialId(null);
				return;
			}
			setExpandedMaterialId(materialId);
			if (Object.prototype.hasOwnProperty.call(materialDocsCache, materialId)) {
				return;
			}
			setMaterialDocLoadingId(materialId);
			try {
				const res = await fetch(
					`/api/intensive/materials/${encodeURIComponent(resolvedCourseId)}/${encodeURIComponent(materialId)}?format=text`,
				);
				if (!res.ok) {
					setMaterialDocsCache((prev) => ({ ...prev, [materialId]: null }));
					return;
				}
				const doc = (await res.json()) as CourseMaterialDoc;
				setMaterialDocsCache((prev) => ({ ...prev, [materialId]: doc }));
			} catch {
				setMaterialDocsCache((prev) => ({ ...prev, [materialId]: null }));
			} finally {
				setMaterialDocLoadingId((prev) => (prev === materialId ? null : prev));
			}
		},
		[expandedMaterialId, materialDocsCache, resolvedCourseId],
	);

	if (!course) return null;

	const hasLocalMode =
		Boolean(course.mediaSource) ||
		lessons.length > 0 ||
		course.spec.deliveryMode === "local-video-pack";

	const persistVideoProgress = (
		posSec: number,
		durSec: number,
		forceWatched?: boolean,
	) => {
		if (!activeLesson) return;
		const safePos = Math.max(0, Math.floor(posSec));
		const safeDur = durSec > 0 ? Math.round(durSec) : activeLesson.durationSec || undefined;
		void onMutate({
			kind: "update-video-progress",
			courseId: resolvedCourseId,
			lessonId: activeLesson.lessonId,
			positionSec: safePos,
			...(safeDur ? { durationSec: safeDur } : {}),
			...(forceWatched !== undefined ? { watched: forceWatched } : {}),
		});
	};

	const handleLoadedMetadata = () => {
		const el = videoRef.current;
		if (!el) return;
		el.playbackRate = playbackRate;
		const dur = Number.isFinite(el.duration) ? el.duration : activeLesson?.durationSec ?? 0;
		setDuration(dur);
		if (pendingSeekRef.current !== null) {
			el.currentTime = Math.min(pendingSeekRef.current, dur || pendingSeekRef.current);
			pendingSeekRef.current = null;
			return;
		}
		const savedPos = activeVideoProgress?.positionSec ?? 0;
		if (savedPos > 5 && (!dur || savedPos < dur * 0.95)) {
			el.currentTime = savedPos;
			setCurrentTime(savedPos);
		}
	};

	const handleTimeUpdate = () => {
		const el = videoRef.current;
		if (!el || !activeLesson) return;
		const pos = el.currentTime;
		const dur = Number.isFinite(el.duration) ? el.duration : activeLesson.durationSec ?? 0;
		setCurrentTime(pos);
		if (dur > 0 && dur !== duration) setDuration(dur);

		// Auto-mark watched once at >= 90% played
		if (
			dur > 30 &&
			pos / dur >= 0.9 &&
			!activeVideoProgress?.watched &&
			autoWatchedSentRef.current !== activeLesson.lessonId
		) {
			autoWatchedSentRef.current = activeLesson.lessonId;
			lastSavedPosAtRef.current = Date.now();
			persistVideoProgress(pos, dur, true);
			return;
		}

		// Auto-save position every 10 seconds during playback
		const now = Date.now();
		if (now - lastSavedPosAtRef.current >= 10_000) {
			lastSavedPosAtRef.current = now;
			persistVideoProgress(pos, dur);
		}
	};

	const seekTo = (sec: number, autoPlay = true) => {
		const el = videoRef.current;
		if (!el) return;
		el.currentTime = Math.max(0, sec);
		setCurrentTime(Math.max(0, sec));
		if (autoPlay) {
			void el.play().catch(() => {});
		}
	};

	const jumpToLessonAt = (lessonId: string, sec: number) => {
		if (activeLesson?.lessonId === lessonId) {
			seekTo(sec, true);
			return;
		}
		pendingSeekRef.current = sec;
		setActiveLessonId(lessonId);
	};

	const handleChangePlaybackRate = (rate: number) => {
		setPlaybackRate(rate);
		if (videoRef.current) {
			videoRef.current.playbackRate = rate;
		}
	};

	const handleStartGpu = async (mode: "watch" | "once") => {
		setGpuBusy(true);
		setGpuError(null);
		try {
			const res = await fetch("/api/intensive/transcribe", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					courseId: resolvedCourseId,
					mode,
					language: course.mediaSource?.language || "pt",
				}),
			});
			const data = (await res.json().catch(() => null)) as {
				ok?: boolean;
				status?: CourseTranscriptionStatus;
				error?: string;
			} | null;
			if (!res.ok || data?.ok === false) {
				setGpuError(data?.error || t("intensive.course.gpuStateError"));
			}
			if (data?.status) setGpuStatus(data.status);
		} catch {
			setGpuError(t("intensive.course.gpuStateError"));
		} finally {
			setGpuBusy(false);
		}
	};

	const handleStopGpu = async () => {
		setGpuBusy(true);
		setGpuError(null);
		try {
			const res = await fetch(
				`/api/intensive/transcribe?courseId=${encodeURIComponent(resolvedCourseId)}`,
				{ method: "DELETE" },
			);
			const data = (await res.json().catch(() => null)) as {
				ok?: boolean;
				error?: string;
			} | null;
			if (!res.ok || data?.ok === false) {
				setGpuError(data?.error || t("intensive.course.gpuStateError"));
			} else {
				setGpuStatus((prev) => (prev ? { ...prev, state: "idle" } : prev));
			}
		} finally {
			setGpuBusy(false);
		}
	};

	const handleSaveBookmark = async () => {
		if (!activeLesson) return;
		const sec = Math.floor(currentTime);
		const label = bookmarkDraft.trim() || formatTimestamp(sec);
		await onMutate({
			kind: "add-video-bookmark",
			courseId: resolvedCourseId,
			lessonId: activeLesson.lessonId,
			timeSec: sec,
			label,
		});
		setBookmarkDraft("");
		setBookmarkOpen(false);
	};

	const handleSaveLessonNotes = async () => {
		if (!activeLesson) return;
		await onMutate({
			kind: "update-video-progress",
			courseId: resolvedCourseId,
			lessonId: activeLesson.lessonId,
			positionSec: Math.floor(currentTime),
			...(duration > 0 ? { durationSec: Math.round(duration) } : {}),
			notes: lessonNotesDraft,
		});
		setLessonNotesSaved(true);
	};

	const handleAddCourseLink = async () => {
		const url = newCourseLinkUrl.trim();
		const label = newCourseLinkLabel.trim() || url;
		if (!url) return;
		await onMutate({
			kind: "add-course-link",
			courseId: resolvedCourseId,
			label,
			url,
		});
		setNewCourseLinkLabel("");
		setNewCourseLinkUrl("");
	};

	const handleLogModuleMinutes = async (mod: CourseModuleSpec, deltaMin: number) => {
		const currentLogged = course.state.modules[mod.id]?.loggedMinutes ?? 0;
		await onMutate({
			kind: "update-module",
			courseId: resolvedCourseId,
			moduleId: mod.id,
			loggedMinutes: currentLogged + deltaMin,
		});
		await onMutate({
			kind: "log-study",
			entry: {
				date: new Date().toISOString().slice(0, 10),
				minutes: deltaMin,
				category: "course",
				courseId: resolvedCourseId,
				moduleId: mod.id,
				note: mod.title,
			},
		});
	};

	const renderModulesChecklist = () => (
		<div className="space-y-5">
			{/* Course overview + official links + tutor launch */}
			<div className="elec-surface p-4 sm:p-5">
				<div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
					<div className="min-w-0 max-w-[65ch] space-y-2">
						<p className="text-base leading-relaxed text-foreground">
							{course.spec.whyThisPosition}
						</p>
						{course.spec.nocCodesUnlocked.length > 0 && (
							<p className="text-[13px] font-medium text-muted-foreground">
								{course.spec.nocCodesUnlocked.join(" · ")}
							</p>
						)}
					</div>

					<div className="flex shrink-0 flex-wrap items-center gap-2">
						<button
							type="button"
							disabled={busyKey === `tutor:${resolvedCourseId}`}
							onClick={() => {
								void onAskTutor({
									title: `Curso #${course.spec.rank} · ${course.spec.title}`,
									openingPrompt: `Quero estudar o curso "${course.spec.title}" (${course.spec.provider}). Me ajude a revisar a estrutura, prioridades de bancada e próximos passos práticos.`,
									courseId: resolvedCourseId,
								});
							}}
							className={INTENSIVE_BTN_PRIMARY}
						>
							<BotIcon className="size-4 shrink-0" aria-hidden="true" />
							{t("intensive.course.studyCourseTutor")}
						</button>
					</div>
				</div>

				{/* Official external course URLs + linked certifications */}
				{(course.spec.officialUrls.length > 0 || course.spec.linkedCertIds.length > 0) && (
					<div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3.5">
						{course.spec.officialUrls.map((link) => (
							<a
								key={link.url}
								href={link.url}
								target="_blank"
								rel="noopener noreferrer"
								className={INTENSIVE_BTN_COMPACT}
							>
								<ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden="true" />
								<span>{link.label}</span>
							</a>
						))}

						{course.spec.linkedCertIds.map((certId) => {
							const cert = dashboard.certifications.find((c) => c.spec.id === certId);
							if (!cert) return null;
							return (
								<button
									key={certId}
									type="button"
									onClick={() => onOpenCert(certId)}
									className="inline-flex min-h-9 items-center gap-1.5 rounded border border-[var(--cel-accent,var(--primary))]/45 bg-[var(--cel-accent,var(--primary))]/10 px-2.5 py-1 text-[13px] font-medium text-[var(--cel-accent-text,var(--foreground))] hover:bg-[var(--cel-accent,var(--primary))]/20 cursor-pointer"
								>
									<span>{t("intensive.course.linkedCerts")}:</span>
									<span className="font-semibold">{cert.spec.title}</span>
								</button>
							);
						})}
					</div>
				)}
			</div>

			{/* Structured module checklist */}
			<section className="space-y-3" aria-label={t("intensive.course.modulesTitle")}>
				<div className="flex items-center justify-between gap-2">
					<h3 className="text-base font-bold text-foreground">
						{t("intensive.course.modulesTitle")}
					</h3>
					<span className="text-sm font-semibold tabular-nums text-muted-foreground">
						{course.metrics.moduleProgress.completedCount}/{course.metrics.moduleProgress.totalCount} (
						{course.metrics.moduleProgress.percent}%)
					</span>
				</div>

				<div className="elec-surface divide-y divide-border/55 overflow-hidden">
					{course.spec.modules.map((mod) => {
						const modState = course.state.modules[mod.id];
						const completed = Boolean(modState?.completed);
						const loggedMin = modState?.loggedMinutes ?? 0;
						const notesOpen = Boolean(expandedModuleNotes[mod.id]);
						const linkDraft = moduleLinkDrafts[mod.id] ?? { label: "", url: "" };

						return (
							<div key={mod.id} className="space-y-3 p-4">
								<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
									<label className="flex min-h-9 cursor-pointer items-start gap-3">
										<input
											type="checkbox"
											checked={completed}
											onChange={(e) => {
												void onMutate({
													kind: "toggle-module",
													courseId: resolvedCourseId,
													moduleId: mod.id,
													completed: e.target.checked,
												});
											}}
											className="mt-1 size-4 shrink-0 accent-[var(--cel-accent,var(--primary))]"
										/>
										<div className="min-w-0 space-y-1">
											<div className="flex flex-wrap items-center gap-2">
												<span className="font-mono text-[13px] font-semibold tabular-nums text-muted-foreground">
													M{mod.order}
												</span>
												<span
													className={`text-base font-semibold ${
														completed ? "text-muted-foreground line-through" : "text-foreground"
													}`}
												>
													{mod.title}
												</span>
											</div>
											<div className="flex flex-wrap items-center gap-3 text-[13px] tabular-nums text-muted-foreground">
												<span>
													{t("intensive.course.moduleHours", {
														hours: formatHoursCompact(mod.estimatedHours),
													})}
												</span>
												{loggedMin > 0 && (
													<span className="font-medium text-foreground">
														{t("intensive.course.moduleLogged", { minutes: loggedMin })}
													</span>
												)}
											</div>
										</div>
									</label>

									{/* Per-module AI Tutor CTA + quick study minutes logger */}
									<div className="flex shrink-0 flex-wrap items-center gap-1.5 pl-7 sm:pl-0">
										{([15, 30, 60] as const).map((min) => (
											<button
												key={min}
												type="button"
												onClick={() => void handleLogModuleMinutes(mod, min)}
												className="min-h-8 rounded border border-border/65 bg-background px-2 py-1 font-mono text-[12px] font-medium tabular-nums text-muted-foreground hover:border-foreground/40 hover:text-foreground cursor-pointer"
												title={t("intensive.course.logMinutes")}
											>
												+{min}m
											</button>
										))}

										<button
											type="button"
											disabled={busyKey === `tutor:${resolvedCourseId}:${mod.id}`}
											onClick={() => {
												void onAskTutor({
													title: `${course.spec.title} · M${mod.order}: ${mod.title}`,
													openingPrompt: `Quero estudar o módulo M${mod.order} ("${mod.title}") do curso "${course.spec.title}". Tópicos: ${mod.topics.join("; ")}.${mod.benchExercise ? ` Exercício de bancada: ${mod.benchExercise}` : ""} Comece verificando minha base e conduzindo a explicação com exemplos práticos.`,
													courseId: resolvedCourseId,
													moduleId: mod.id,
												});
											}}
											className={INTENSIVE_BTN_COMPACT}
										>
											<BotIcon className="size-3.5 shrink-0" aria-hidden="true" />
											{t("intensive.course.studyModuleTutor")}
										</button>
									</div>
								</div>

								{/* Topics & Bench Exercise */}
								<div className="space-y-2 pl-7">
									{mod.topics.length > 0 && (
										<ul className="list-disc space-y-1 pl-4 text-sm leading-relaxed text-muted-foreground">
											{mod.topics.map((topic) => (
												<li key={topic}>{topic}</li>
											))}
										</ul>
									)}

									{mod.benchExercise && (
										<div className="border-l-2 border-[var(--cel-accent,var(--primary))] bg-background/55 px-3 py-2 text-sm">
											<span className="font-semibold text-foreground">
												{t("intensive.course.benchExercise")}:{" "}
											</span>
											<span className="text-foreground/90">{mod.benchExercise}</span>
										</div>
									)}

									{/* Personal module notes & links toggle */}
									<div className="pt-1">
										<button
											type="button"
											onClick={() =>
												setExpandedModuleNotes((prev) => ({
													...prev,
													[mod.id]: !prev[mod.id],
												}))
											}
											className="text-[13px] font-medium text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
										>
											{t("intensive.course.lessonNotesTitle")} & {t("intensive.course.customLinksTitle")}
											{(modState?.notes?.trim() || (modState?.customLinks?.length ?? 0) > 0) && " · •"}
										</button>

										{notesOpen && (
											<div className="mt-2.5 space-y-3 border-t border-border/45 pt-3">
												<div className="space-y-2">
													<textarea
														rows={3}
														value={moduleNotesDrafts[mod.id] ?? modState?.notes ?? ""}
														onChange={(e) =>
															setModuleNotesDrafts((prev) => ({
																...prev,
																[mod.id]: e.target.value,
															}))
														}
														placeholder={t("intensive.course.moduleNotesPlaceholder")}
														className={INTENSIVE_INPUT}
													/>
													<button
														type="button"
														onClick={() => {
															void onMutate({
																kind: "update-module",
																courseId: resolvedCourseId,
																moduleId: mod.id,
																notes: moduleNotesDrafts[mod.id] ?? "",
															});
														}}
														className={INTENSIVE_BTN_COMPACT}
													>
														{t("intensive.action.save")}
													</button>
												</div>

												{/* Module custom links */}
												<div className="space-y-2">
													{(modState?.customLinks ?? []).length > 0 && (
														<div className="flex flex-wrap gap-1.5">
															{modState!.customLinks.map((lnk) => (
																<span
																	key={lnk.id}
																	className="inline-flex items-center gap-1.5 rounded border border-border/65 bg-background px-2 py-1 text-[13px]"
																>
																	<a
																		href={lnk.url}
																		target="_blank"
																		rel="noopener noreferrer"
																		className="inline-flex items-center gap-1 text-foreground hover:underline"
																	>
																		<Link2Icon className="size-3 shrink-0" aria-hidden="true" />
																		{lnk.label}
																	</a>
																	<button
																		type="button"
																		aria-label={t("intensive.course.removeLink")}
																		onClick={() => {
																			void onMutate({
																				kind: "remove-course-link",
																				courseId: resolvedCourseId,
																				moduleId: mod.id,
																				linkId: lnk.id,
																			});
																		}}
																		className="text-muted-foreground hover:text-error cursor-pointer"
																	>
																		<Trash2Icon className="size-3" aria-hidden="true" />
																	</button>
																</span>
															))}
														</div>
													)}
													<div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
														<input
															type="text"
															value={linkDraft.label}
															onChange={(e) =>
																setModuleLinkDrafts((prev) => ({
																	...prev,
																	[mod.id]: { ...linkDraft, label: e.target.value },
																}))
															}
															placeholder={t("intensive.course.linkLabelPlaceholder")}
															className={INTENSIVE_INPUT}
														/>
														<input
															type="url"
															value={linkDraft.url}
															onChange={(e) =>
																setModuleLinkDrafts((prev) => ({
																	...prev,
																	[mod.id]: { ...linkDraft, url: e.target.value },
																}))
															}
															placeholder={t("intensive.course.linkUrlPlaceholder")}
															className={INTENSIVE_INPUT}
														/>
														<button
															type="button"
															onClick={() => {
																if (!linkDraft.url.trim()) return;
																void onMutate({
																	kind: "add-course-link",
																	courseId: resolvedCourseId,
																	moduleId: mod.id,
																	label: linkDraft.label.trim() || linkDraft.url.trim(),
																	url: linkDraft.url.trim(),
																});
																setModuleLinkDrafts((prev) => ({
																	...prev,
																	[mod.id]: { label: "", url: "" },
																}));
															}}
															className={INTENSIVE_BTN_COMPACT}
														>
															<PlusIcon className="size-3.5 shrink-0" aria-hidden="true" />
															{t("intensive.course.addLink")}
														</button>
													</div>
												</div>
											</div>
										)}
									</div>
								</div>
							</div>
						);
					})}
				</div>
			</section>

			{/* Course-level personal notes & custom links */}
			<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
				<div className="elec-surface space-y-2.5 p-4">
					<div className="flex items-center justify-between">
						<h3 className="text-sm font-bold text-foreground">
							{t("intensive.course.courseNotesTitle")}
						</h3>
						{courseNotesSaved && (
							<span className="text-[12px] font-medium text-[var(--cel-success-text,var(--lh-success))]">
								{t("intensive.action.saved")}
							</span>
						)}
					</div>
					<textarea
						rows={4}
						value={courseNotesDraft}
						onChange={(e) => {
							setCourseNotesDraft(e.target.value);
							if (courseNotesSaved) setCourseNotesSaved(false);
						}}
						placeholder={t("intensive.course.courseNotesPlaceholder")}
						className={INTENSIVE_INPUT}
					/>
					<button
						type="button"
						onClick={async () => {
							await onMutate({
								kind: "update-course",
								courseId: resolvedCourseId,
								courseNotes: courseNotesDraft,
							});
							setCourseNotesSaved(true);
						}}
						className={INTENSIVE_BTN_COMPACT}
					>
						{t("intensive.action.save")}
					</button>
				</div>

				<div className="elec-surface space-y-3 p-4">
					<h3 className="text-sm font-bold text-foreground">
						{t("intensive.course.customLinksTitle")}
					</h3>
					{course.state.customLinks.length > 0 && (
						<ul className="divide-y divide-border/45 border-y border-border/45">
							{course.state.customLinks.map((lnk) => (
								<li key={lnk.id} className="flex items-center justify-between gap-2 py-2 text-sm">
									<a
										href={lnk.url}
										target="_blank"
										rel="noopener noreferrer"
										className="inline-flex min-w-0 items-center gap-1.5 truncate text-foreground hover:underline"
									>
										<ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
										<span className="truncate">{lnk.label}</span>
									</a>
									<button
										type="button"
										aria-label={t("intensive.course.removeLink")}
										onClick={() => {
											void onMutate({
												kind: "remove-course-link",
												courseId: resolvedCourseId,
												linkId: lnk.id,
											});
										}}
										className="shrink-0 p-1 text-muted-foreground hover:text-error cursor-pointer"
									>
										<Trash2Icon className="size-3.5" aria-hidden="true" />
									</button>
								</li>
							))}
						</ul>
					)}
					<div className="space-y-2">
						<input
							type="text"
							value={newCourseLinkLabel}
							onChange={(e) => setNewCourseLinkLabel(e.target.value)}
							placeholder={t("intensive.course.linkLabelPlaceholder")}
							className={INTENSIVE_INPUT}
						/>
						<div className="flex gap-2">
							<input
								type="url"
								value={newCourseLinkUrl}
								onChange={(e) => setNewCourseLinkUrl(e.target.value)}
								placeholder={t("intensive.course.linkUrlPlaceholder")}
								className={INTENSIVE_INPUT}
							/>
							<button
								type="button"
								onClick={() => void handleAddCourseLink()}
								className={`${INTENSIVE_BTN_COMPACT} shrink-0`}
							>
								<PlusIcon className="size-3.5 shrink-0" aria-hidden="true" />
								{t("intensive.course.addLink")}
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);

	const renderCurriculumBridge = () => {
		if (relatedCurriculumNodes.length === 0) return null;
		const mapHref = `/mapa?dominio=${encodeURIComponent(dashboard.track.domainId)}`;
		return (
			<section
				data-testid="curriculum-node-bridge"
				aria-label={t("intensive.course.bridgeTitle")}
				className="flex flex-col gap-2 border-b border-border/55 pb-3 sm:flex-row sm:items-center sm:justify-between"
			>
				<div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-0.5">
					<span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
						<CompassIcon
							className="size-3.5 shrink-0 text-[var(--elec-volt-text)]"
							aria-hidden="true"
						/>
						{t("intensive.course.bridgeTitle")}
					</span>

					<div className="flex shrink-0 items-center gap-1.5">
						{relatedCurriculumNodes.map((node) => (
							<Link
								key={node.nodeId}
								href={`${mapHref}&no=${encodeURIComponent(node.nodeId)}`}
								className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md border border-border/70 bg-card px-2.5 py-1 text-[13px] transition-colors hover:border-[var(--elec-volt)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--elec-volt)]"
							>
								<span className="font-semibold text-foreground">{node.title}</span>
								{node.regionTitle && (
									<span className="text-[12px] text-muted-foreground">
										· {node.regionTitle}
									</span>
								)}
							</Link>
						))}
					</div>
				</div>

				<Link
					href={mapHref}
					className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-[var(--elec-volt-text)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--elec-volt)]"
				>
					<span>{t("intensive.course.bridgeOpenMap")}</span>
					<ArrowUpRightIcon className="size-3.5 shrink-0" aria-hidden="true" />
				</Link>
			</section>
		);
	};

	const renderMaterialsPanel = (mode: "sidebar" | "full") => {
		const isSidebar = mode === "sidebar";
		const remaining = Math.max(0, filteredMaterials.length - visibleMaterials.length);
		const nextBatch = Math.min(MATERIALS_PAGE_SIZE, remaining);

		return (
			<div
				data-testid="course-materials-panel"
				className={
					isSidebar
						? "flex min-h-0 flex-1 flex-col"
						: "elec-surface overflow-hidden"
				}
			>
				{/* Filter bar */}
				<div
					className={`border-b border-border/55 ${isSidebar ? "space-y-2 p-3" : "space-y-3 p-4"}`}
				>
					<div
						className={
							isSidebar
								? "space-y-2"
								: "grid grid-cols-1 gap-2.5 md:grid-cols-[minmax(0,1fr)_minmax(220px,auto)]"
						}
					>
						<div className="relative">
							<SearchIcon
								className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
								aria-hidden="true"
							/>
							<input
								type="search"
								data-testid="materials-filter-input"
								value={materialsQuery}
								onChange={(e) => setMaterialsQuery(e.target.value)}
								placeholder={t("intensive.course.materialsSearchPlaceholder")}
								aria-label={t("intensive.course.materialsSearchPlaceholder")}
								className={`${INTENSIVE_INPUT} min-h-9 pl-8`}
							/>
						</div>

						{materialSections.length > 0 && (
							<div>
								<label htmlFor={`materials-section-select-${mode}`} className="sr-only">
									{t("intensive.course.materialsSectionLabel")}
								</label>
								<select
									id={`materials-section-select-${mode}`}
									data-testid="materials-section-select"
									value={materialsSection}
									onChange={(e) => setMaterialsSection(e.target.value)}
									className={`${INTENSIVE_INPUT} min-h-9 text-[13px]`}
								>
									<option value="all">
										{t("intensive.course.materialsAllSections")} ({materials.length})
									</option>
									{materialSections.map((sec) => (
										<option key={sec.key} value={sec.key}>
											{sec.label} ({sec.count})
										</option>
									))}
								</select>
							</div>
						)}
					</div>

					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="flex flex-wrap items-center gap-1">
							{(
								[
									["all", t("intensive.course.materialsFilterAll")],
									["pdf", t("intensive.course.materialsFilterPdf")],
									["text", t("intensive.course.materialsFilterText")],
									["image", t("intensive.course.materialsFilterImage")],
								] as const
							).map(([val, label]) => (
								<button
									key={val}
									type="button"
									aria-pressed={materialsCategory === val}
									onClick={() => setMaterialsCategory(val)}
									className={`rounded border px-2 py-0.5 text-[12px] font-medium cursor-pointer ${
										materialsCategory === val
											? "border-foreground/50 bg-accent text-foreground"
											: "border-border/60 bg-background text-muted-foreground hover:text-foreground"
									}`}
								>
									{label}
								</button>
							))}
						</div>

						{filteredMaterials.length > 0 && (
							<span className="text-[12px] tabular-nums text-muted-foreground">
								{t("intensive.course.materialsCountShown", {
									shown: visibleMaterials.length,
									total: filteredMaterials.length,
								})}
							</span>
						)}
					</div>
				</div>

				{/* Materials flat divider list */}
				<div
					className={
						isSidebar
							? "min-h-0 flex-1 overflow-y-auto divide-y divide-border/45"
							: "divide-y divide-border/45"
					}
				>
					{materials.length === 0 ? (
						<p className="p-4 text-sm text-muted-foreground">
							{t("intensive.course.materialsEmpty")}
						</p>
					) : filteredMaterials.length === 0 ? (
						<p className="p-4 text-sm text-muted-foreground">
							{t("intensive.course.materialsNoMatch")}
						</p>
					) : (
						<>
							{visibleMaterials.map((mat) => {
								const isExpanded = expandedMaterialId === mat.materialId;
								const isLoadingDoc = materialDocLoadingId === mat.materialId;
								const doc = materialDocsCache[mat.materialId];
								const sizeLabel = formatMaterialSize(mat.sizeBytes);
								const openHref = `/api/intensive/materials/${encodeURIComponent(resolvedCourseId)}/${encodeURIComponent(mat.materialId)}`;
								const tutorBusy = busyKey === `tutor:${resolvedCourseId}:mat:${mat.materialId}`;
								const shownChunksLimit =
									materialChunksLimit[mat.materialId] ?? MATERIAL_PREVIEW_CHUNKS_STEP;
								const visibleChunks = doc ? doc.chunks.slice(0, shownChunksLimit) : [];
								const remainingChunks = doc
									? Math.max(0, doc.chunks.length - visibleChunks.length)
									: 0;

								return (
									<div
										key={mat.materialId}
										data-testid="course-material-item"
										className={`space-y-2 ${isSidebar ? "px-3 py-3" : "px-4 py-3.5"}`}
									>
										<div className="flex items-start justify-between gap-2">
											<div className="min-w-0 space-y-0.5">
												<div className="flex flex-wrap items-center gap-1.5">
													<span className="rounded border border-border/70 bg-background px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">
														{materialCategoryBadge(mat.category)}
													</span>
													<p className="min-w-0 text-sm font-semibold leading-snug text-foreground">
														{mat.title}
													</p>
												</div>
												<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] tabular-nums text-muted-foreground">
													{mat.section && (
														<span className="font-medium text-foreground/75">
															{mat.section}
														</span>
													)}
													{typeof mat.pageCount === "number" && mat.pageCount > 0 && (
														<span>
															{t("intensive.course.materialPages", {
																pages: mat.pageCount,
															})}
														</span>
													)}
													{sizeLabel && <span>{sizeLabel}</span>}
												</div>
											</div>
										</div>

										<div className="flex flex-wrap items-center gap-1.5">
											<a
												href={openHref}
												target="_blank"
												rel="noreferrer"
												className={INTENSIVE_BTN_COMPACT}
											>
												<ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden="true" />
												<span>{t("intensive.course.materialOpenFile")}</span>
											</a>

											{mat.hasText && (
												<button
													type="button"
													aria-expanded={isExpanded}
													onClick={() => void handleToggleMaterialText(mat.materialId)}
													className={INTENSIVE_BTN_COMPACT}
												>
													<BookOpenIcon className="size-3.5 shrink-0" aria-hidden="true" />
													<span>
														{isExpanded
															? t("intensive.course.materialHideText")
															: t("intensive.course.materialReadText")}
													</span>
												</button>
											)}

											<button
												type="button"
												disabled={tutorBusy}
												onClick={() => {
													void onAskTutor({
														title: `${course.spec.title} · ${mat.title}`,
														openingPrompt: `Quero estudar o material "${mat.title}"${mat.section ? ` (${mat.section})` : ""} do curso "${course.spec.title}". Resuma os pontos principais, explique o raciocínio técnico e proponha um exercício prático baseado neste material.`,
														courseId: resolvedCourseId,
														materialId: mat.materialId,
													});
												}}
												className={INTENSIVE_BTN_COMPACT}
											>
												<BotIcon className="size-3.5 shrink-0" aria-hidden="true" />
												<span>{t("intensive.course.materialStudyTutor")}</span>
											</button>
										</div>

										{/* Inline extracted text preview */}
										{isExpanded && (
											<div
												data-testid="material-text-preview"
												className="mt-2 max-h-72 space-y-2.5 overflow-y-auto border-l-2 border-[var(--elec-volt)] bg-background/60 py-2 pl-3 pr-2"
											>
												{isLoadingDoc ? (
													<p className="text-[13px] text-muted-foreground">
														{t("intensive.course.materialTextLoading")}
													</p>
												) : !doc || doc.chunks.length === 0 ? (
													<p className="text-[13px] text-muted-foreground">
														{t("intensive.course.materialTextEmpty")}
													</p>
												) : (
													<>
														{visibleChunks.map((chunk) => (
															<div key={chunk.index} className="space-y-1">
																{typeof chunk.page === "number" && (
																	<span className="inline-block rounded border border-border/70 bg-card px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-[var(--elec-volt-text)]">
																		{t("intensive.search.pageBadge", {
																			page: chunk.page,
																		})}
																	</span>
																)}
																<p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
																	{chunk.text}
																</p>
															</div>
														))}
														{remainingChunks > 0 && (
															<button
																type="button"
																onClick={() =>
																	setMaterialChunksLimit((prev) => ({
																		...prev,
																		[mat.materialId]:
																			shownChunksLimit + MATERIAL_PREVIEW_CHUNKS_STEP,
																	}))
																}
																className={INTENSIVE_BTN_COMPACT}
															>
																{t("intensive.course.materialShowMore", {
																	count: Math.min(
																		MATERIAL_PREVIEW_CHUNKS_STEP,
																		remainingChunks,
																	),
																})}
															</button>
														)}
													</>
												)}
											</div>
										)}
									</div>
								);
							})}

							{remaining > 0 && (
								<div className="flex justify-center p-3">
									<button
										type="button"
										onClick={() =>
											setMaterialsVisibleCount((n) => n + MATERIALS_PAGE_SIZE)
										}
										className={INTENSIVE_BTN_COMPACT}
									>
										<FileTextIcon className="size-3.5 shrink-0" aria-hidden="true" />
										<span className="tabular-nums">
											{t("intensive.course.materialShowMore", { count: nextBatch })}
										</span>
									</button>
								</div>
							)}
						</>
					)}
				</div>
			</div>
		);
	};

	return (
		<div className="space-y-5">
			{/* Top Course Selector & Controls Bar */}
			<div className="elec-surface flex flex-col gap-3 p-3.5 lg:flex-row lg:items-center lg:justify-between">
				<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
					<button
						type="button"
						onClick={onBackToQuests}
						className={INTENSIVE_BTN_COMPACT}
					>
						<ArrowLeftIcon className="size-3.5 shrink-0" aria-hidden="true" />
						{t("intensive.action.backToQuests")}
					</button>

					<div className="min-w-0 flex-1 sm:max-w-md">
						<label htmlFor="workspace-course-select" className="sr-only">
							{t("intensive.course.selectCourse")}
						</label>
						<select
							id="workspace-course-select"
							value={resolvedCourseId}
							onChange={(e) => onSelectCourse(e.target.value)}
							className={`${INTENSIVE_INPUT} min-h-9 font-semibold`}
						>
							{dashboard.track.courses.map((c) => (
								<option key={c.id} value={c.id}>
									#{c.rank} · {c.title}
								</option>
							))}
						</select>
					</div>

					<span className="text-[13px] font-semibold tabular-nums text-foreground">
						{course.metrics.percent}%
					</span>
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<label htmlFor="workspace-manual-status" className="sr-only">
						{t("intensive.course.manualStatus")}
					</label>
					<select
						id="workspace-manual-status"
						value={course.state.manualStatus ?? "auto"}
						onChange={(e) => {
							void onMutate({
								kind: "update-course",
								courseId: resolvedCourseId,
								manualStatus: e.target.value as CourseManualStatus,
							});
						}}
						className={`${INTENSIVE_SELECT_AUTO} min-h-9 shrink-0 text-[13px]`}
					>
						<option value="auto">{t("intensive.course.statusAuto")}</option>
						<option value="in-progress">{t("intensive.quests.statusInProgress")}</option>
						<option value="completed">{t("intensive.quests.statusCompleted")}</option>
						<option value="paused">{t("intensive.quests.statusPaused")}</option>
					</select>

					<button
						type="button"
						onClick={() => onOpenLinkModal(resolvedCourseId)}
						className={INTENSIVE_BTN_COMPACT}
					>
						<FolderOpenIcon className="size-3.5 shrink-0" aria-hidden="true" />
						{course.mediaSource
							? t("intensive.course.changeFolder")
							: t("intensive.action.linkFolder")}
					</button>
				</div>
			</div>

			{/* Curriculum Node Bridge strip linking course topics to the Eletrônica Atlas skill tree */}
			{renderCurriculumBridge()}

			{/* MODE A: LOCAL VIDEO PACK COCKPIT */}
			{hasLocalMode && (
				<div className="space-y-4">
					{/* If expected local pack isn't linked yet */}
					{!course.mediaSource ? (
						<div className="elec-surface flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
							<div className="max-w-[65ch] space-y-1">
								<div className="flex items-center gap-2 text-base font-bold text-foreground">
									<FilmIcon className="size-4 shrink-0 text-[var(--elec-volt-text)]" aria-hidden="true" />
									<h3>{t("intensive.course.localPackUnlinkedTitle")}</h3>
								</div>
								<p className="text-sm text-muted-foreground">
									{t("intensive.course.localPackUnlinkedBody")}
								</p>
							</div>
							<button
								type="button"
								onClick={() => onOpenLinkModal(resolvedCourseId)}
								className={`${INTENSIVE_BTN_PRIMARY} shrink-0`}
							>
								<FolderOpenIcon className="size-4 shrink-0" aria-hidden="true" />
								{t("intensive.action.linkFolder")}
							</button>
						</div>
					) : (
						<>
							{/* Live GPU Transcription Status Bar */}
							<div
								data-testid="gpu-transcription-bar"
								className="elec-surface flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between"
							>
								<div className="min-w-0 space-y-1">
									<div className="flex flex-wrap items-center gap-2 text-[13px]">
										<span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
											<CpuIcon className="size-4 shrink-0 text-[var(--cel-accent-text,var(--primary))]" aria-hidden="true" />
											{t("intensive.course.gpuBarTitle")}
										</span>
										<span
											className={`rounded border px-2 py-0.5 text-[12px] font-semibold ${
												isGpuActive
													? "border-[var(--cel-accent,var(--primary))]/60 bg-[var(--cel-accent,var(--primary))]/15 text-[var(--cel-accent-text,var(--foreground))]"
													: gpuStatus?.state === "completed"
														? "border-[var(--cel-success,var(--lh-success))]/45 bg-[var(--cel-success,var(--lh-success))]/10 text-[var(--cel-success-text,var(--lh-success))]"
														: gpuStatus?.state === "error"
															? "border-error/45 bg-error/10 text-error"
															: "border-border/65 bg-background text-muted-foreground"
											}`}
										>
											{gpuStateLabel(gpuStatus?.state, t)}
										</span>
										<span className="tabular-nums text-muted-foreground">
											{t("intensive.course.gpuStats", {
												ready: gpuStatus?.readyCount ?? course.metrics.videoProgress.transcribedCount,
												discovered: gpuStatus?.discoveredCount ?? lessons.length,
												pending: gpuStatus?.pendingCount ?? course.metrics.videoProgress.pendingCount,
											})}
										</span>
										{(course.mediaSource.expectedTotalVideos ?? course.spec.expectedTotalVideos) ? (
											<span className="tabular-nums text-muted-foreground">
												·{" "}
												{t("intensive.course.gpuExpected", {
													expected:
														course.mediaSource.expectedTotalVideos ??
														course.spec.expectedTotalVideos ??
														0,
												})}
											</span>
										) : null}
										{(gpuStatus?.downloadingCount ?? 0) > 0 && (
											<span className="tabular-nums font-medium text-[var(--cel-warning-text,var(--lh-warning))]">
												·{" "}
												{t("intensive.course.gpuDownloading", {
													count: gpuStatus!.downloadingCount,
												})}
											</span>
										)}
										{gpuStatus?.avgRealtimeFactor ? (
											<span className="font-mono text-[12px] tabular-nums text-muted-foreground">
												·{" "}
												{t("intensive.course.gpuSpeed", {
													factor: gpuStatus.avgRealtimeFactor.toFixed(1),
												})}
											</span>
										) : null}
									</div>

									<div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
										<span
											className="max-w-md truncate font-mono"
											title={course.mediaSource.sourceDir}
										>
											{course.mediaSource.sourceDir}
										</span>
										{gpuStatus?.currentFile && isGpuActive && (
											<span className="truncate text-foreground">
												{t("intensive.course.gpuCurrentFile", {
													file: gpuStatus.currentFile,
												})}
											</span>
										)}
										{(gpuError || gpuStatus?.lastError) && (
											<span className="text-error">{gpuError ?? gpuStatus?.lastError}</span>
										)}
									</div>
								</div>

								<div className="flex shrink-0 flex-wrap items-center gap-2">
									{isGpuActive ? (
										<button
											type="button"
											disabled={gpuBusy}
											onClick={() => void handleStopGpu()}
											className={INTENSIVE_BTN_COMPACT}
										>
											<SquareIcon className="size-3.5 shrink-0" aria-hidden="true" />
											{t("intensive.course.stopGpu")}
										</button>
									) : (
										<>
											<button
												type="button"
												disabled={gpuBusy}
												onClick={() => void handleStartGpu("watch")}
												className={INTENSIVE_BTN_COMPACT}
											>
												<PlayIcon className="size-3.5 shrink-0" aria-hidden="true" />
												{t("intensive.course.startGpuWatch")}
											</button>
											<button
												type="button"
												disabled={gpuBusy}
												onClick={() => void handleStartGpu("once")}
												className={INTENSIVE_BTN_COMPACT}
											>
												{t("intensive.course.startGpuOnce")}
											</button>
										</>
									)}
									<button
										type="button"
										disabled={lessonsLoading}
										onClick={() => void fetchCourseLessons()}
										className={INTENSIVE_BTN_COMPACT}
										title={t("intensive.course.refreshLessons")}
									>
										<RefreshCwIcon
											className={`size-3.5 shrink-0 ${lessonsLoading ? "animate-spin" : ""}`}
											aria-hidden="true"
										/>
										{t("intensive.course.refreshLessons")}
									</button>
								</div>
							</div>

							{/* 2-Column Video Player + Synced Transcript / Playlist Cockpit */}
							<div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,1fr)]">
								{/* LEFT: HTML5 Video Player + Controls + Bookmarks + Notes */}
								<div className="space-y-4">
									{activeLesson ? (
										<div className="elec-surface overflow-hidden">
											<div className="aspect-video w-full bg-black">
												<video
													key={`${resolvedCourseId}:${activeLesson.lessonId}`}
													ref={videoRef}
													src={`/api/intensive/media/${encodeURIComponent(resolvedCourseId)}/${encodeURIComponent(activeLesson.lessonId)}`}
													controls
													playsInline
													preload="metadata"
													onLoadedMetadata={handleLoadedMetadata}
													onTimeUpdate={handleTimeUpdate}
													onPause={() => persistVideoProgress(currentTime, duration)}
													onEnded={() => persistVideoProgress(duration || currentTime, duration, true)}
													className="size-full bg-black"
												>
													{activeLesson.transcriptStatus === "ready" && (
														<track
															kind="subtitles"
															src={`/api/intensive/media/${encodeURIComponent(resolvedCourseId)}/${encodeURIComponent(activeLesson.lessonId)}?kind=vtt`}
															srcLang={course.mediaSource.language || "pt"}
															label={course.mediaSource.language || "PT"}
															default
														/>
													)}
												</video>
											</div>

											{/* Lesson Title + Playback Control Strip */}
											<div className="space-y-3 border-t border-border/60 p-4">
												<div className="flex flex-wrap items-start justify-between gap-2">
													<div className="min-w-0 space-y-0.5">
														<div className="flex flex-wrap items-center gap-2">
															<span className="rounded border border-border/70 bg-background px-1.5 py-0.5 font-mono text-[12px] font-semibold tabular-nums text-muted-foreground">
																#{activeLesson.order}
															</span>
															<h2 className="text-base font-bold text-foreground sm:text-lg">
																{activeLesson.title}
															</h2>
														</div>
														<p className="font-mono text-[13px] tabular-nums text-muted-foreground">
															{formatTimestamp(currentTime)} /{" "}
															{formatTimestamp(duration || activeLesson.durationSec)}
														</p>
													</div>

													{/* Speed selector */}
													<div className="flex items-center gap-1.5">
														<label
															htmlFor="video-speed-select"
															className="text-[13px] text-muted-foreground"
														>
															{t("intensive.course.playbackRate")}
														</label>
														<select
															id="video-speed-select"
															value={playbackRate}
															onChange={(e) => handleChangePlaybackRate(Number(e.target.value))}
															className="rounded border border-border/75 bg-background px-2 py-1 font-mono text-[13px] font-semibold tabular-nums text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cel-focus,var(--ring))]"
														>
															{PLAYBACK_RATES.map((rate) => (
																<option key={rate} value={rate}>
																	{rate}×
																</option>
															))}
														</select>
													</div>
												</div>

												{/* Comprehension-First speed guardrail warning */}
												{playbackRate >= 1.75 && (
													<div
														role="status"
														className="flex items-start gap-2 rounded border border-[var(--cel-warning,var(--lh-warning))]/45 bg-[var(--cel-warning,var(--lh-warning))]/10 px-3 py-2 text-[13px] text-[var(--cel-warning-text,var(--lh-warning))]"
													>
														<AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
														<span>{t("intensive.course.speedWarning")}</span>
													</div>
												)}

												{/* Action row */}
												<div className="flex flex-wrap items-center gap-2 pt-0.5">
													<button
														type="button"
														data-testid="ask-tutor-video-moment"
														disabled={busyKey === `tutor:${resolvedCourseId}:${activeLesson.lessonId}`}
														onClick={() => {
															const sec = Math.floor(currentTime);
															const stamp = formatTimestamp(sec);
															void onAskTutor({
																title: `${course.spec.title} · #${activeLesson.order} (${stamp})`,
																openingPrompt: `Estou assistindo à aula #${activeLesson.order} ("${activeLesson.title}") do curso "${course.spec.title}" no instante ${stamp}. Me explique o conceito ou análise de circuito deste trecho e faça 1 pergunta rápida para checar minha compreensão.`,
																courseId: resolvedCourseId,
																lessonId: activeLesson.lessonId,
																currentTimeSec: sec,
															});
														}}
														className={INTENSIVE_BTN_PRIMARY}
													>
														<BotIcon className="size-4 shrink-0" aria-hidden="true" />
														{t("intensive.course.askMomentTutor")}
													</button>

													<button
														type="button"
														aria-pressed={Boolean(activeVideoProgress?.watched)}
														onClick={() => {
															void onMutate({
																kind: "toggle-video-watched",
																courseId: resolvedCourseId,
																lessonId: activeLesson.lessonId,
																watched: !activeVideoProgress?.watched,
																...(duration > 0 ? { durationSec: Math.round(duration) } : {}),
															});
														}}
														className={
															activeVideoProgress?.watched
																? "inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--cel-success,var(--lh-success))]/55 bg-[var(--cel-success,var(--lh-success))]/12 px-3.5 py-2 text-sm font-semibold text-[var(--cel-success-text,var(--lh-success))] cursor-pointer"
																: INTENSIVE_BTN_SECONDARY
														}
													>
														<CheckCircle2Icon className="size-4 shrink-0" aria-hidden="true" />
														{activeVideoProgress?.watched
															? t("intensive.course.watchedDone")
															: t("intensive.course.markWatched")}
													</button>

													<button
														type="button"
														onClick={() => setBookmarkOpen((v) => !v)}
														className={INTENSIVE_BTN_SECONDARY}
													>
														<BookmarkIcon className="size-4 shrink-0" aria-hidden="true" />
														{t("intensive.course.bookmarkMoment")}
													</button>
												</div>

												{/* Inline bookmark composer */}
												{bookmarkOpen && (
													<div className="flex flex-wrap items-center gap-2 border-t border-border/45 pt-3">
														<input
															type="text"
															value={bookmarkDraft}
															onChange={(e) => setBookmarkDraft(e.target.value)}
															placeholder={t("intensive.course.bookmarkPlaceholder", {
																time: formatTimestamp(currentTime),
															})}
															onKeyDown={(e) => {
																if (e.key === "Enter") {
																	e.preventDefault();
																	void handleSaveBookmark();
																}
															}}
															className={`${INTENSIVE_INPUT} min-w-0 flex-1`}
														/>
														<button
															type="button"
															onClick={() => void handleSaveBookmark()}
															className={INTENSIVE_BTN_COMPACT}
														>
															{t("intensive.course.addBookmark")}
														</button>
													</div>
												)}

												{/* Telegram pack caption (if present) */}
												{(activeLesson.telegramCaption || transcriptDoc?.telegramCaption) && (
													<div className="border-t border-border/45 pt-3 text-sm text-muted-foreground">
														<span className="font-semibold text-foreground">
															{t("intensive.course.telegramCaption")}:{" "}
														</span>
														<span>
															{transcriptDoc?.telegramCaption ?? activeLesson.telegramCaption}
														</span>
													</div>
												)}
											</div>
										</div>
									) : (
										<div className="elec-surface p-8 text-center text-sm text-muted-foreground">
											{t("intensive.course.selectLessonPrompt")}
										</div>
									)}

									{/* Bookmarks + Lesson Notes */}
									{activeLesson && (
										<div className="elec-surface space-y-4 p-4">
											{(activeVideoProgress?.bookmarks?.length ?? 0) > 0 && (
												<div className="space-y-2 border-b border-border/50 pb-3.5">
													<h3 className="text-[13px] font-bold text-foreground">
														{t("intensive.course.bookmarksTitle")}
													</h3>
													<div className="flex flex-wrap gap-1.5">
														{activeVideoProgress!.bookmarks.map((bm) => (
															<span
																key={bm.id}
																className="inline-flex items-center gap-1.5 rounded border border-border/70 bg-background px-2.5 py-1 text-[13px]"
															>
																<button
																	type="button"
																	onClick={() => seekTo(bm.timeSec, true)}
																	className="inline-flex items-center gap-1.5 font-medium text-foreground hover:underline cursor-pointer"
																>
																	<span className="font-mono text-[12px] tabular-nums text-[var(--cel-accent-text,var(--primary))]">
																		{formatTimestamp(bm.timeSec)}
																	</span>
																	<span>{bm.label}</span>
																</button>
																<button
																	type="button"
																	aria-label={t("intensive.course.removeBookmark")}
																	onClick={() => {
																		void onMutate({
																			kind: "remove-video-bookmark",
																			courseId: resolvedCourseId,
																			lessonId: activeLesson.lessonId,
																			bookmarkId: bm.id,
																		});
																	}}
																	className="text-muted-foreground hover:text-error cursor-pointer"
																>
																	<Trash2Icon className="size-3" aria-hidden="true" />
																</button>
															</span>
														))}
													</div>
												</div>
											)}

											<div className="space-y-2">
												<div className="flex items-center justify-between">
													<h3 className="text-[13px] font-bold text-foreground">
														{t("intensive.course.lessonNotesTitle")}
													</h3>
													{lessonNotesSaved && (
														<span className="text-[12px] font-medium text-[var(--cel-success-text,var(--lh-success))]">
															{t("intensive.action.saved")}
														</span>
													)}
												</div>
												<textarea
													rows={3}
													value={lessonNotesDraft}
													onChange={(e) => {
														setLessonNotesDraft(e.target.value);
														if (lessonNotesSaved) setLessonNotesSaved(false);
													}}
													placeholder={t("intensive.course.lessonNotesPlaceholder")}
													className={INTENSIVE_INPUT}
												/>
												<button
													type="button"
													onClick={() => void handleSaveLessonNotes()}
													className={INTENSIVE_BTN_COMPACT}
												>
													{t("intensive.action.save")}
												</button>
											</div>
										</div>
									)}
								</div>

								{/* RIGHT: Synced Transcript | Lesson Playlist Queue | Materials | Modules Switcher */}
								<aside className="elec-surface flex h-[680px] flex-col overflow-hidden">
									{/* Right panel tabs */}
									<div
										role="tablist"
										className="flex overflow-x-auto border-b border-border/60 bg-background/40 text-[12px] font-semibold"
									>
										{(
											[
												["transcript", t("intensive.course.panelTranscript")],
												["playlist", t("intensive.course.panelPlaylist", { count: lessons.length })],
												[
													"materials",
													t("intensive.course.panelMaterials", {
														count: materials.length,
													}),
												],
												[
													"modules",
													t("intensive.course.panelModules", {
														count: course.spec.modules.length,
													}),
												],
											] as const
										).map(([id, label]) => {
											const active = rightTab === id;
											return (
												<button
													key={id}
													type="button"
													role="tab"
													data-testid={`course-panel-tab-${id}`}
													aria-selected={active}
													onClick={() => setRightTab(id)}
													className={`min-h-11 flex-1 shrink-0 whitespace-nowrap border-b-2 px-2.5 py-2 tabular-nums transition-colors cursor-pointer ${
														active
															? "border-[var(--cel-accent,var(--primary))] text-foreground"
															: "border-transparent text-muted-foreground hover:text-foreground"
													}`}
												>
													{label}
												</button>
											);
										})}
									</div>

									{/* PANEL 1: Synced Transcript */}
									{rightTab === "transcript" && (
										<div className="flex min-h-0 flex-1 flex-col">
											<div className="space-y-2 border-b border-border/55 p-3">
												<div className="relative">
													<SearchIcon
														className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
														aria-hidden="true"
													/>
													<input
														type="search"
														value={transcriptQuery}
														onChange={(e) => setTranscriptQuery(e.target.value)}
														placeholder={t("intensive.course.transcriptSearchPlaceholder")}
														aria-label={t("intensive.course.transcriptSearchPlaceholder")}
														className={`${INTENSIVE_INPUT} min-h-9 pl-8`}
													/>
												</div>

												<div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
													<div className="inline-flex overflow-hidden rounded border border-border/70">
														<button
															type="button"
															aria-pressed={transcriptScope === "lesson"}
															onClick={() => setTranscriptScope("lesson")}
															className={`px-2.5 py-1 font-medium cursor-pointer ${
																transcriptScope === "lesson"
																	? "bg-accent text-foreground"
																	: "bg-background text-muted-foreground hover:text-foreground"
															}`}
														>
															{t("intensive.course.scopeLesson")}
														</button>
														<button
															type="button"
															aria-pressed={transcriptScope === "course"}
															onClick={() => setTranscriptScope("course")}
															className={`border-l border-border/70 px-2.5 py-1 font-medium cursor-pointer ${
																transcriptScope === "course"
																	? "bg-accent text-foreground"
																	: "bg-background text-muted-foreground hover:text-foreground"
															}`}
														>
															{t("intensive.course.scopeCourse")}
														</button>
													</div>

													{transcriptScope === "lesson" && (
														<label className="flex cursor-pointer items-center gap-1.5 text-muted-foreground hover:text-foreground">
															<input
																type="checkbox"
																checked={followVideo}
																onChange={(e) => setFollowVideo(e.target.checked)}
																className="size-3.5 accent-[var(--cel-accent,var(--primary))]"
															/>
															<span>{t("intensive.course.transcriptFollow")}</span>
														</label>
													)}
												</div>
											</div>

											<div
												ref={transcriptScrollRef}
												className="min-h-0 flex-1 overflow-y-auto p-3"
											>
												{transcriptScope === "course" ? (
													courseSearchLoading ? (
														<p className="p-3 text-sm text-muted-foreground">
															{t("intensive.search.searching")}
														</p>
													) : transcriptQuery.trim().length < 2 ? (
														<p className="p-3 text-sm text-muted-foreground">
															{t("intensive.course.transcriptSearchPlaceholder")}
														</p>
													) : courseSearchHits.length === 0 ? (
														<p className="p-3 text-sm text-muted-foreground">
															{t("intensive.course.transcriptNoMatch", {
																query: transcriptQuery.trim(),
															})}
														</p>
													) : (
														<ul className="divide-y divide-border/45">
															{courseSearchHits.map((hit) => (
																<li key={`${hit.lessonId}:${hit.chunkIndex}`}>
																	<button
																		type="button"
																		onClick={() => jumpToLessonAt(hit.lessonId, hit.startSec)}
																		className="w-full space-y-1 rounded px-2 py-2.5 text-left transition-colors hover:bg-accent/55 cursor-pointer"
																	>
																		<div className="flex items-center justify-between gap-2 text-[12px]">
																			<span className="truncate font-semibold text-foreground">
																				#{hit.order} · {hit.lessonTitle}
																			</span>
																			<span className="shrink-0 font-mono tabular-nums text-[var(--cel-accent-text,var(--primary))]">
																				{hit.timestampLabel}
																			</span>
																		</div>
																		<p className="line-clamp-3 text-[15px] leading-relaxed text-muted-foreground">
																			{hit.snippet}
																		</p>
																	</button>
																</li>
															))}
														</ul>
													)
												) : transcriptLoading ? (
													<p className="p-3 text-sm text-muted-foreground">
														{t("intensive.course.transcriptLoading")}
													</p>
												) : !activeLesson || activeLesson.transcriptStatus !== "ready" ? (
													<div className="space-y-3 p-3 text-sm text-muted-foreground">
														<p>
															{activeLesson?.transcriptStatus === "downloading"
																? t("intensive.course.transcriptDownloading")
																: activeLesson?.transcriptStatus === "error"
																	? t("intensive.course.transcriptError")
																	: t("intensive.course.transcriptPending")}
														</p>
														{!isGpuActive && (
															<button
																type="button"
																onClick={() => void handleStartGpu("watch")}
																className={INTENSIVE_BTN_COMPACT}
															>
																<CpuIcon className="size-3.5 shrink-0" aria-hidden="true" />
																{t("intensive.course.startGpuWatch")}
															</button>
														)}
													</div>
												) : filteredSegments.length === 0 ? (
													<p className="p-3 text-sm text-muted-foreground">
														{t("intensive.course.transcriptNoMatch", {
															query: transcriptQuery.trim(),
														})}
													</p>
												) : (
													<div className="space-y-1">
														{filteredSegments.map((seg) => {
															const isCurrent = seg.id === activeSegmentId;
															return (
																<button
																	key={seg.id}
																	type="button"
																	data-seg-id={seg.id}
																	onClick={() => seekTo(seg.start, true)}
																	className={`lh-transcript-item flex w-full items-start gap-2.5 rounded border-l-2 px-2.5 py-2 text-left transition-colors cursor-pointer ${
																		isCurrent
																			? "border-[var(--cel-accent,var(--primary))] bg-[var(--cel-accent,var(--primary))]/10 text-foreground"
																			: "border-transparent text-foreground/85 hover:bg-accent/45"
																	}`}
																>
																	<span className="mt-0.5 shrink-0 font-mono text-[12px] font-semibold tabular-nums text-muted-foreground">
																		{formatTimestamp(seg.start)}
																	</span>
																	<span className="text-[16px] leading-[1.6]">{seg.text}</span>
																</button>
															);
														})}
													</div>
												)}
											</div>
										</div>
									)}

									{/* PANEL 2: Lesson Playlist Queue (1..207+) */}
									{rightTab === "playlist" && (
										<div className="flex min-h-0 flex-1 flex-col">
											<div className="space-y-2 border-b border-border/55 p-3">
												<div className="relative">
													<SearchIcon
														className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
														aria-hidden="true"
													/>
													<input
														type="search"
														value={playlistQuery}
														onChange={(e) => setPlaylistQuery(e.target.value)}
														placeholder={t("intensive.course.playlistSearchPlaceholder")}
														aria-label={t("intensive.course.playlistSearchPlaceholder")}
														className={`${INTENSIVE_INPUT} min-h-9 pl-8`}
													/>
												</div>
												<div className="flex flex-wrap gap-1">
													{(
														[
															["all", t("intensive.course.playlistAll")],
															["unwatched", t("intensive.course.playlistUnwatched")],
															["transcribed", t("intensive.course.playlistTranscribed")],
															["pending", t("intensive.course.playlistPending")],
														] as const
													).map(([val, label]) => (
														<button
															key={val}
															type="button"
															aria-pressed={playlistFilter === val}
															onClick={() => setPlaylistFilter(val)}
															className={`rounded border px-2 py-0.5 text-[12px] font-medium cursor-pointer ${
																playlistFilter === val
																	? "border-foreground/50 bg-accent text-foreground"
																	: "border-border/60 bg-background text-muted-foreground hover:text-foreground"
															}`}
														>
															{label}
														</button>
													))}
												</div>
											</div>

											<div className="min-h-0 flex-1 overflow-y-auto divide-y divide-border/40">
												{filteredLessons.length === 0 ? (
													<p className="p-4 text-sm text-muted-foreground">
														{t("intensive.course.playlistEmpty")}
													</p>
												) : (
													filteredLessons.map((lesson) => {
														const isSelected = lesson.lessonId === activeLesson?.lessonId;
														const watched = Boolean(course.state.videos[lesson.lessonId]?.watched);
														return (
															<div
																key={lesson.lessonId}
																className={`lh-transcript-item flex items-center gap-2 px-3 py-2.5 text-sm transition-colors ${
																	isSelected
																		? "bg-[var(--cel-accent,var(--primary))]/10"
																		: "hover:bg-accent/40"
																}`}
															>
																<button
																	type="button"
																	aria-label={t("intensive.course.markWatched")}
																	aria-pressed={watched}
																	onClick={() => {
																		void onMutate({
																			kind: "toggle-video-watched",
																			courseId: resolvedCourseId,
																			lessonId: lesson.lessonId,
																			watched: !watched,
																			...(lesson.durationSec > 0
																				? { durationSec: Math.round(lesson.durationSec) }
																				: {}),
																		});
																	}}
																	className={`flex size-5 shrink-0 items-center justify-center rounded border transition-colors cursor-pointer ${
																		watched
																			? "border-[var(--cel-success,var(--lh-success))] bg-[var(--cel-success,var(--lh-success))] text-black"
																			: "border-border bg-background hover:border-foreground/50"
																	}`}
																>
																	{watched && <CheckIcon className="size-3.5" aria-hidden="true" />}
																</button>

																<button
																	type="button"
																	onClick={() => {
																		setActiveLessonId(lesson.lessonId);
																		pendingSeekRef.current = null;
																	}}
																	className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left cursor-pointer"
																>
																	<div className="min-w-0">
																		<div className="flex items-center gap-1.5">
																			<span className="font-mono text-[12px] tabular-nums text-muted-foreground">
																				#{lesson.order}
																			</span>
																			<span
																				className={`truncate font-medium ${
																					isSelected ? "font-semibold text-foreground" : "text-foreground/90"
																				}`}
																			>
																				{lesson.title}
																			</span>
																		</div>
																	</div>

																	<div className="flex shrink-0 items-center gap-2">
																		{lesson.durationSec > 0 && (
																			<span className="font-mono text-[12px] tabular-nums text-muted-foreground">
																				{formatTimestamp(lesson.durationSec)}
																			</span>
																		)}
																		<span
																			className={`size-2 rounded-full ${transcriptDotClass(
																				lesson.transcriptStatus,
																			)}`}
																			title={transcriptStatusLabel(lesson.transcriptStatus, t)}
																		/>
																	</div>
																</button>
															</div>
														);
													})
												)}
											</div>
										</div>
									)}

									{/* PANEL 3: Course Materials & Apostilas (PDFs, Exercises, Schematics) */}
									{rightTab === "materials" && renderMaterialsPanel("sidebar")}

									{/* PANEL 4: Quick structured modules view inside local video cockpit */}
									{rightTab === "modules" && (
										<div className="min-h-0 flex-1 overflow-y-auto divide-y divide-border/45 p-3">
											{course.spec.modules.map((mod) => {
												const done = Boolean(course.state.modules[mod.id]?.completed);
												return (
													<div key={mod.id} className="space-y-2 py-3 first:pt-1">
														<label className="flex cursor-pointer items-start gap-2.5 text-sm">
															<input
																type="checkbox"
																checked={done}
																onChange={(e) => {
																	void onMutate({
																		kind: "toggle-module",
																		courseId: resolvedCourseId,
																		moduleId: mod.id,
																		completed: e.target.checked,
																	});
																}}
																className="mt-1 size-4 shrink-0 accent-[var(--cel-accent,var(--primary))]"
															/>
															<div className="min-w-0">
																<p className={`font-semibold ${done ? "text-muted-foreground line-through" : "text-foreground"}`}>
																	M{mod.order} · {mod.title}
																</p>
																<p className="text-[12px] tabular-nums text-muted-foreground">
																	<ClockIcon className="mr-1 inline size-3" aria-hidden="true" />
																	{t("intensive.course.moduleHours", {
																		hours: formatHoursCompact(mod.estimatedHours),
																	})}
																</p>
															</div>
														</label>
														<button
															type="button"
															onClick={() => {
																void onAskTutor({
																	title: `${course.spec.title} · M${mod.order}: ${mod.title}`,
																	openingPrompt: `Quero estudar o módulo M${mod.order} ("${mod.title}") do curso "${course.spec.title}". Tópicos: ${mod.topics.join("; ")}.`,
																	courseId: resolvedCourseId,
																	moduleId: mod.id,
																});
															}}
															className={`${INTENSIVE_BTN_COMPACT} ml-6`}
														>
															<BotIcon className="size-3.5 shrink-0" aria-hidden="true" />
															{t("intensive.action.askTutor")}
														</button>
													</div>
												);
											})}
										</div>
									)}
								</aside>
							</div>
						</>
					)}
				</div>
			)}

			{/* MODE B: Structured Modules Checklist & Materials Panel (always shown for external courses, and below unlinked local courses) */}
			{(!hasLocalMode || !course.mediaSource) && (
				<div className="space-y-4">
					{(materials.length > 0 || externalTab === "materials") && (
						<div
							role="tablist"
							className="elec-tab-bar flex items-center gap-1 overflow-x-auto"
						>
							{(
								[
									[
										"modules",
										t("intensive.course.panelModules", {
											count: course.spec.modules.length,
										}),
									],
									[
										"materials",
										t("intensive.course.panelMaterials", {
											count: materials.length,
										}),
									],
								] as const
							).map(([id, label]) => {
								const active = externalTab === id;
								return (
									<button
										key={id}
										type="button"
										role="tab"
										data-testid={`course-external-tab-${id}`}
										aria-selected={active}
										onClick={() => setExternalTab(id)}
										className={`inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3.5 py-2 text-sm font-semibold tabular-nums transition-colors cursor-pointer ${
											active
												? "border-[var(--elec-volt)] text-foreground"
												: "border-transparent text-muted-foreground hover:text-foreground"
										}`}
									>
										{label}
									</button>
								);
							})}
						</div>
					)}

					{externalTab === "materials"
						? renderMaterialsPanel("full")
						: renderModulesChecklist()}
				</div>
			)}
		</div>
	);
}
