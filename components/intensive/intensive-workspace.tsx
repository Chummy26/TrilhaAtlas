"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
	AwardIcon,
	ClockIcon,
	ExternalLinkIcon,
	FilmIcon,
	FolderOpenIcon,
	LayoutListIcon,
	SearchIcon,
	WrenchIcon,
	XIcon,
} from "lucide-react";
import type {
	CourseTier,
	IntensiveCertificationView,
	IntensiveCourseView,
	IntensiveDashboardDTO,
	IntensivePortfolioProjectView,
	IntensiveRecommendedAction,
} from "@/src/core";
import { TopBar } from "@/components/top-bar";
import { Icon } from "@/components/icons/icon";
import { useT } from "@/components/i18n";
import { SessionStarter } from "../start-session.ts";
import { DashboardHeader } from "./dashboard-header.tsx";
import { TierQuestBoard } from "./tier-quest-board.tsx";
import { CourseWorkspace, type CoursePanelTab } from "./course-workspace.tsx";
import { CertificationsPanel } from "./certifications-panel.tsx";
import { PortfolioBenchPanel } from "./portfolio-bench-panel.tsx";
import { PacingPanel } from "./pacing-panel.tsx";
import { MediaSourceModal } from "./media-source-modal.tsx";
import {
	formatVerifiedDate,
	INTENSIVE_BTN_COMPACT,
	INTENSIVE_INPUT,
	launchIntensiveTutor,
	mutateIntensive,
	type IntensiveMutation,
	type IntensiveSearchResponse,
	type IntensiveTab,
} from "./tutor-launch.ts";

export interface IntensiveWorkspaceProps {
	initialDashboard: IntensiveDashboardDTO;
	initialTab?: IntensiveTab;
	initialCourseId?: string;
	initialLessonId?: string;
	initialTimeSec?: number;
	initialCertId?: string;
	initialProjectId?: string;
}

export function IntensiveWorkspace({
	initialDashboard,
	initialTab = "quests",
	initialCourseId,
	initialLessonId,
	initialTimeSec,
	initialCertId,
	initialProjectId,
}: IntensiveWorkspaceProps) {
	const t = useT();
	const router = useRouter();
	const starterRef = useRef<SessionStarter | null>(null);

	const [dashboard, setDashboard] = useState<IntensiveDashboardDTO>(initialDashboard);
	const [activeTab, setActiveTab] = useState<IntensiveTab>(initialTab);
	const [selectedCourseId, setSelectedCourseId] = useState<string>(
		initialCourseId && initialDashboard.coursesById[initialCourseId]
			? initialCourseId
			: initialDashboard.track.parallelCourseId ||
					initialDashboard.track.courses[0]?.id ||
					"",
	);
	const [selectedLessonId, setSelectedLessonId] = useState<string | undefined>(initialLessonId);
	const [selectedTimeSec, setSelectedTimeSec] = useState<number | undefined>(initialTimeSec);
	const [selectedPanelTab, setSelectedPanelTab] = useState<CoursePanelTab | undefined>(undefined);
	const [selectedMaterialId, setSelectedMaterialId] = useState<string | undefined>(undefined);
	const [selectedMaterialQuery, setSelectedMaterialQuery] = useState<string | undefined>(undefined);
	const [materialNavNonce, setMaterialNavNonce] = useState(0);
	const [highlightedCertId, setHighlightedCertId] = useState<string | undefined>(initialCertId);
	const [highlightedProjectId, setHighlightedProjectId] = useState<string | undefined>(
		initialProjectId,
	);
	const [tierFilter, setTierFilter] = useState<CourseTier | "all">("all");

	const [linkModalOpen, setLinkModalOpen] = useState(false);
	const [linkModalCourseId, setLinkModalCourseId] = useState<string | undefined>(undefined);
	const [mediaRevision, setMediaRevision] = useState(0);

	const [busyKey, setBusyKey] = useState<string | null>(null);
	const [bannerError, setBannerError] = useState<string | null>(null);

	// Global top-bar search across transcripts + syllabus modules
	const [globalQuery, setGlobalQuery] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const [searchLoading, setSearchLoading] = useState(false);
	const [searchResults, setSearchResults] = useState<IntensiveSearchResponse | null>(null);
	const searchWrapRef = useRef<HTMLDivElement | null>(null);

	// Softly keep URL query parameters synced with active view
	useEffect(() => {
		if (typeof window === "undefined") return;
		const params = new URLSearchParams();
		if (activeTab !== "quests") params.set("tab", activeTab);
		if (activeTab === "watch" && selectedCourseId) {
			params.set("course", selectedCourseId);
			if (selectedLessonId) params.set("lesson", selectedLessonId);
			if (typeof selectedTimeSec === "number" && selectedTimeSec > 0) {
				params.set("t", String(Math.floor(selectedTimeSec)));
			}
		}
		if (activeTab === "certs" && highlightedCertId) params.set("cert", highlightedCertId);
		if (activeTab === "portfolio" && highlightedProjectId) {
			params.set("project", highlightedProjectId);
		}
		const qs = params.toString();
		const target = qs ? `/intensiva?${qs}` : "/intensiva";
		window.history.replaceState(null, "", target);
	}, [
		activeTab,
		selectedCourseId,
		selectedLessonId,
		selectedTimeSec,
		highlightedCertId,
		highlightedProjectId,
	]);

	// Debounced global search
	useEffect(() => {
		const q = globalQuery.trim();
		if (q.length < 2) {
			setSearchResults(null);
			setSearchLoading(false);
			return;
		}
		const ctrl = new AbortController();
		const timer = window.setTimeout(async () => {
			setSearchLoading(true);
			try {
				const res = await fetch(
					`/api/intensive/search?q=${encodeURIComponent(q)}&limit=12`,
					{ signal: ctrl.signal },
				);
				if (!res.ok) return;
				const data = (await res.json()) as IntensiveSearchResponse;
				if (!ctrl.signal.aborted) {
					setSearchResults({
						transcriptHits: Array.isArray(data.transcriptHits) ? data.transcriptHits : [],
						moduleHits: Array.isArray(data.moduleHits) ? data.moduleHits : [],
						materialHits: Array.isArray(data.materialHits) ? data.materialHits : [],
					});
					setSearchOpen(true);
				}
			} catch {
				// Aborted or unavailable
			} finally {
				if (!ctrl.signal.aborted) setSearchLoading(false);
			}
		}, 240);
		return () => {
			window.clearTimeout(timer);
			ctrl.abort();
		};
	}, [globalQuery]);

	// Close search popover on outside click or Escape
	useEffect(() => {
		if (!searchOpen) return;
		const onDown = (e: MouseEvent) => {
			if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
				setSearchOpen(false);
			}
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setSearchOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		window.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			window.removeEventListener("keydown", onKey);
		};
	}, [searchOpen]);

	const handleMutate = useCallback(
		async (mutation: IntensiveMutation) => {
			const key =
				mutation.kind === "set-pacing"
					? "set-pacing"
					: "courseId" in mutation
						? `course:${mutation.courseId}`
						: mutation.kind;
			setBusyKey(key);
			setBannerError(null);
			try {
				const next = await mutateIntensive(mutation);
				setDashboard(next);
			} catch (err) {
				setBannerError(
					err instanceof Error ? err.message : t("intensive.error.mutationFailed"),
				);
			} finally {
				setBusyKey((prev) => (prev === key ? null : prev));
			}
		},
		[t],
	);

	const openCourse = useCallback(
		(courseId: string, lessonId?: string, timeSec?: number) => {
			setSelectedCourseId(courseId);
			setSelectedLessonId(lessonId);
			setSelectedTimeSec(timeSec);
			setSelectedPanelTab(undefined);
			setSelectedMaterialId(undefined);
			setSelectedMaterialQuery(undefined);
			setActiveTab("watch");
			setSearchOpen(false);
		},
		[],
	);

	const openCourseMaterial = useCallback(
		(courseId: string, materialId: string, materialTitle: string) => {
			setSelectedCourseId(courseId);
			setSelectedLessonId(undefined);
			setSelectedTimeSec(undefined);
			setSelectedPanelTab("materials");
			setSelectedMaterialId(materialId);
			setSelectedMaterialQuery(materialTitle);
			setMaterialNavNonce((n) => n + 1);
			setActiveTab("watch");
			setSearchOpen(false);
		},
		[],
	);

	const openCert = useCallback((certId: string) => {
		setHighlightedCertId(certId);
		setActiveTab("certs");
	}, []);

	const openProject = useCallback((projectId: string) => {
		setHighlightedProjectId(projectId);
		setActiveTab("portfolio");
	}, []);

	const handleRunRecommended = useCallback(
		(action: IntensiveRecommendedAction) => {
			if (action.courseId) {
				openCourse(action.courseId, action.lessonId);
				return;
			}
			if (action.certId) {
				openCert(action.certId);
				return;
			}
			if (action.projectId) {
				openProject(action.projectId);
				return;
			}
			setActiveTab("watch");
		},
		[openCourse, openCert, openProject],
	);

	const startTutor = useCallback(
		async (
			key: string,
			params: {
				title: string;
				openingPrompt: string;
				courseId?: string;
				moduleId?: string;
				lessonId?: string;
				materialId?: string;
				currentTimeSec?: number;
				certId?: string;
				projectId?: string;
				kind?: "practice";
			},
		) => {
			setBusyKey(key);
			setBannerError(null);
			try {
				starterRef.current ??= new SessionStarter();
				await launchIntensiveTutor(starterRef.current, router, {
					title: params.title,
					openingPrompt: params.openingPrompt,
					kind: params.kind,
					...(params.materialId ? { materialId: params.materialId } : {}),
					intensiveContext: {
						trackId: dashboard.track.id,
						...(params.courseId ? { courseId: params.courseId } : {}),
						...(params.moduleId ? { moduleId: params.moduleId } : {}),
						...(params.lessonId ? { lessonId: params.lessonId } : {}),
						...(params.materialId ? { materialId: params.materialId } : {}),
						...(typeof params.currentTimeSec === "number"
							? { currentTimeSec: params.currentTimeSec }
							: {}),
						...(params.certId ? { certId: params.certId } : {}),
						...(params.projectId ? { projectId: params.projectId } : {}),
					},
				});
			} catch {
				setBannerError(t("intensive.error.tutorLaunchFailed"));
				setBusyKey(null);
			}
		},
		[dashboard.track.id, router, t],
	);

	const handleAskCourseTutor = useCallback(
		(course: IntensiveCourseView) => {
			void startTutor(`tutor:${course.spec.id}`, {
				title: `Intensiva · #${course.spec.rank} ${course.spec.title}`,
				openingPrompt: `Quero estudar o curso "${course.spec.title}" (${course.spec.provider}) na trilha "${dashboard.track.title}". Me dê um diagnóstico inicial e proponha o próximo passo prático.`,
				courseId: course.spec.id,
			});
		},
		[dashboard.track.title, startTutor],
	);

	const handleAskCertTutor = useCallback(
		(cert: IntensiveCertificationView) => {
			void startTutor(`tutor:cert:${cert.spec.id}`, {
				title: `Simulado · ${cert.spec.title}`,
				openingPrompt: `Quero treinar para a certificação "${cert.spec.title}" (${cert.spec.issuer}, formato: ${cert.spec.examFormat}, aprovação: ${cert.spec.passingScore}). Faça um simulado diagnóstico passo a passo, uma questão por vez, focando nos checkpoints da prova.`,
				certId: cert.spec.id,
				kind: "practice",
			});
		},
		[startTutor],
	);

	const handleAskProjectTutor = useCallback(
		(project: IntensivePortfolioProjectView) => {
			void startTutor(`tutor:project:${project.spec.id}`, {
				title: `Portfólio ${project.spec.code} · ${project.spec.title}`,
				openingPrompt: `Quero revisar o projeto de portfólio ${project.spec.code} ("${project.spec.title}") sob a Regra dos 10 Segundos. Me ajude a validar arquitetura, riscos práticos, medições/evidências e entregáveis do repositório.`,
				projectId: project.spec.id,
			});
		},
		[startTutor],
	);

	const handleAskBenchTutor = useCallback(() => {
		const topics = dashboard.track.benchInterviewChecklist
			.map((item) => item.title)
			.slice(0, 6)
			.join(", ");
		void startTutor("tutor:bench-interview", {
			title: "Simulação · Teste Prático de Entrevista",
			openingPrompt: `Simule um teste prático eliminatório de entrevista para a trilha "${dashboard.track.title}" cobrindo: ${topics || "segurança, diagnóstico passo a passo e leitura técnica"}. Avalie uma etapa por vez.`,
			kind: "practice",
		});
	}, [dashboard.track.benchInterviewChecklist, dashboard.track.title, startTutor]);

	const openLinkModal = useCallback((courseId?: string) => {
		setLinkModalCourseId(courseId);
		setLinkModalOpen(true);
	}, []);

	const handleSelectTierFromHeader = useCallback((tier: CourseTier) => {
		setTierFilter((prev) => (prev === tier ? "all" : tier));
		setActiveTab("quests");
	}, []);

	const primaryRecommendedCourseId =
		dashboard.nextRecommendedActions.find((a) => a.slot === "primary-course")?.courseId ??
		dashboard.nextRecommendedActions[0]?.courseId;

	const tabs: readonly {
		id: IntensiveTab;
		label: string;
		badge?: string;
		icon: typeof LayoutListIcon;
	}[] = [
		{
			id: "quests",
			label: t("intensive.tabs.quests"),
			badge: `${dashboard.summary.coreCompletedCourses}/${dashboard.summary.coreTotalCourses}`,
			icon: LayoutListIcon,
		},
		{
			id: "watch",
			label: t("intensive.tabs.watch"),
			badge: dashboard.coursesById[selectedCourseId]
				? `#${dashboard.coursesById[selectedCourseId]!.spec.rank}`
				: undefined,
			icon: FilmIcon,
		},
		{
			id: "certs",
			label: t("intensive.tabs.certs"),
			badge: `${dashboard.summary.certificationsCorePassedCount}/${dashboard.summary.certificationsCoreTotalCount}`,
			icon: AwardIcon,
		},
		{
			id: "portfolio",
			label: t("intensive.tabs.portfolio"),
			badge: `${dashboard.summary.portfolioCompletedCount}/${dashboard.summary.portfolioTotalCount}`,
			icon: WrenchIcon,
		},
		{
			id: "pacing",
			label: t("intensive.tabs.pacing"),
			badge:
				dashboard.state.pacing.mode === "with-clt"
					? t("intensive.header.modeClt")
					: t("intensive.header.modeHome"),
			icon: ClockIcon,
		},
	];

	return (
		<div
			data-domain="electronics"
			className="elec-workspace flex h-dvh flex-col overflow-hidden bg-background text-foreground"
		>
			<TopBar>
				<div className="flex min-w-0 items-center gap-2">
					<Icon name="domain-electronics" size={22} className="shrink-0" />
					<h1 className="font-title truncate text-base tracking-tight sm:text-2xl md:text-3xl">
						{dashboard.track.title}
					</h1>
				</div>

				<div className="min-w-2 flex-1" aria-hidden="true" />

				{/* Global transcript + syllabus search bar */}
				<div ref={searchWrapRef} className="relative w-32 shrink-0 sm:w-64 md:w-80">
					<SearchIcon
						className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
						aria-hidden="true"
					/>
					<input
						type="search"
						data-testid="intensive-global-search"
						value={globalQuery}
						onFocus={() => {
							if (globalQuery.trim().length >= 2) setSearchOpen(true);
						}}
						onChange={(e) => setGlobalQuery(e.target.value)}
						placeholder={t("intensive.search.placeholder")}
						aria-label={t("intensive.search.ariaLabel")}
						className={`${INTENSIVE_INPUT} min-h-9 pr-7 pl-9 text-[13px]`}
					/>
					{globalQuery && (
						<button
							type="button"
							aria-label={t("intensive.search.clear")}
							onClick={() => {
								setGlobalQuery("");
								setSearchResults(null);
								setSearchOpen(false);
							}}
							className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
						>
							<XIcon className="size-3.5" aria-hidden="true" />
						</button>
					)}

					{searchOpen && globalQuery.trim().length >= 2 && (
						<div className="elec-surface absolute top-full right-0 z-40 mt-2 max-h-[70vh] w-[min(92vw,32rem)] overflow-y-auto shadow-xl">
							{searchLoading ? (
								<p className="p-4 text-sm text-muted-foreground">
									{t("intensive.search.searching")}
								</p>
							) : !searchResults ||
							  (searchResults.transcriptHits.length === 0 &&
									searchResults.moduleHits.length === 0 &&
									(searchResults.materialHits?.length ?? 0) === 0) ? (
								<p className="p-4 text-sm text-muted-foreground">
									{t("intensive.search.noResults", { query: globalQuery.trim() })}
								</p>
							) : (
								<div className="divide-y divide-border/55">
									{searchResults.transcriptHits.length > 0 && (
										<div className="p-3">
											<p className="mb-2 text-[13px] font-bold tabular-nums text-muted-foreground">
												{t("intensive.search.transcriptHits", {
													count: searchResults.transcriptHits.length,
												})}
											</p>
											<ul className="space-y-1">
												{searchResults.transcriptHits.map((hit) => (
													<li key={`${hit.courseId}:${hit.lessonId}:${hit.chunkIndex}`}>
														<button
															type="button"
															onClick={() =>
																openCourse(hit.courseId, hit.lessonId, hit.startSec)
															}
															className="w-full space-y-0.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 hover:bg-accent/65 cursor-pointer"
														>
															<div className="flex items-center justify-between gap-2 text-[13px]">
																<span className="truncate font-semibold text-foreground">
																	{hit.courseTitle} · #{hit.order} {hit.lessonTitle}
																</span>
																<span className="shrink-0 font-mono tabular-nums text-[var(--elec-volt-text)]">
																	{hit.timestampLabel}
																</span>
															</div>
															<p className="line-clamp-2 text-[13px] text-muted-foreground">
																{hit.snippet}
															</p>
														</button>
													</li>
												))}
											</ul>
										</div>
									)}

									{searchResults.materialHits && searchResults.materialHits.length > 0 && (
										<div className="p-3" data-testid="search-material-hits">
											<p className="mb-2 text-[13px] font-bold tabular-nums text-muted-foreground">
												{t("intensive.search.materialHits", {
													count: searchResults.materialHits.length,
												})}
											</p>
											<ul className="space-y-1">
												{searchResults.materialHits.map((hit) => (
													<li
														key={`${hit.courseId}:${hit.materialId}:${hit.chunkIndex}`}
														className="flex items-start gap-1.5 rounded-lg transition-colors duration-150 hover:bg-accent/65"
													>
														<button
															type="button"
															onClick={() =>
																openCourseMaterial(
																	hit.courseId,
																	hit.materialId,
																	hit.materialTitle,
																)
															}
															className="min-w-0 flex-1 space-y-0.5 px-2.5 py-2 text-left cursor-pointer"
														>
															<div className="flex items-center justify-between gap-2 text-[13px]">
																<span className="truncate font-semibold text-foreground">
																	{hit.materialTitle}
																</span>
																{typeof hit.page === "number" && (
																	<span className="shrink-0 font-mono tabular-nums text-[var(--elec-volt-text)]">
																		{t("intensive.search.pageBadge", {
																			page: hit.page,
																		})}
																	</span>
																)}
															</div>
															<p className="truncate text-[12px] text-muted-foreground">
																{hit.courseTitle}
																{hit.section ? ` · ${hit.section}` : ""}
															</p>
															{hit.snippet && (
																<p className="line-clamp-2 text-[13px] text-muted-foreground">
																	{hit.snippet}
																</p>
															)}
														</button>
														<a
															href={`/api/intensive/materials/${encodeURIComponent(hit.courseId)}/${encodeURIComponent(hit.materialId)}`}
															target="_blank"
															rel="noreferrer"
															title={t("intensive.search.openPdf")}
															aria-label={`${t("intensive.search.openPdf")}: ${hit.materialTitle}`}
															className="mt-2 mr-2 inline-flex min-h-8 shrink-0 items-center gap-1 rounded border border-border/70 bg-background px-2 py-1 text-[12px] font-semibold text-foreground hover:border-[var(--elec-volt)]"
														>
															<ExternalLinkIcon
																className="size-3 shrink-0"
																aria-hidden="true"
															/>
															<span>{t("intensive.search.openPdf")}</span>
														</a>
													</li>
												))}
											</ul>
										</div>
									)}

									{searchResults.moduleHits.length > 0 && (
										<div className="p-3">
											<p className="mb-2 text-[13px] font-bold tabular-nums text-muted-foreground">
												{t("intensive.search.moduleHits", {
													count: searchResults.moduleHits.length,
												})}
											</p>
											<ul className="space-y-1">
												{searchResults.moduleHits.map((mod) => (
													<li key={`${mod.courseId}:${mod.moduleId}`}>
														<button
															type="button"
															onClick={() => openCourse(mod.courseId)}
															className="w-full space-y-0.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 hover:bg-accent/65 cursor-pointer"
														>
															<p className="text-[13px] font-semibold text-foreground">
																{mod.courseTitle} · {mod.moduleTitle}
															</p>
															{mod.snippet && (
																<p className="line-clamp-2 text-[13px] text-muted-foreground">
																	{mod.snippet}
																</p>
															)}
														</button>
													</li>
												))}
											</ul>
										</div>
									)}
								</div>
							)}
						</div>
					)}
				</div>

				<div className="hidden shrink-0 sm:flex">
					<button
						type="button"
						onClick={() => openLinkModal(selectedCourseId)}
						className={INTENSIVE_BTN_COMPACT}
					>
						<FolderOpenIcon className="size-3.5 shrink-0" aria-hidden="true" />
						<span>{t("intensive.action.linkFolder")}</span>
					</button>
				</div>
			</TopBar>

			{/* Main Scrollable Viewport */}
			<main className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-[1360px] space-y-6 px-4 py-5 pb-14 sm:px-6 lg:px-8">
					{/* Non-blocking error notice */}
					{bannerError && (
						<div
							role="alert"
							className="flex items-center justify-between gap-3 rounded-xl border border-error/50 bg-error/10 px-4 py-2.5 text-sm text-error"
						>
							<span>{bannerError}</span>
							<button
								type="button"
								onClick={() => setBannerError(null)}
								className="font-semibold underline cursor-pointer"
							>
								{t("intensive.action.dismiss")}
							</button>
						</div>
					)}

					{/* Illustrated Workbench Stage & Interactive Telemetry (collapsed in video cockpit) */}
					{activeTab !== "watch" && (
						<DashboardHeader
							dashboard={dashboard}
							onRunAction={handleRunRecommended}
							onSelectTier={handleSelectTierFromHeader}
							onNavigateTab={setActiveTab}
						/>
					)}

					{/* Primary Section Tabs — crisp underline navigation without decorative boxes */}
					<nav
						aria-label={t("intensive.tabs.ariaLabel")}
						role="tablist"
						className="elec-tab-bar flex items-center gap-1 overflow-x-auto"
					>
						{tabs.map((tab) => {
							const active = activeTab === tab.id;
							const TabIcon = tab.icon;
							return (
								<button
									key={tab.id}
									type="button"
									role="tab"
									aria-selected={active}
									data-testid={`intensive-tab-${tab.id}`}
									onClick={() => setActiveTab(tab.id)}
									className={`inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-semibold transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--elec-volt)] cursor-pointer ${
										active
											? "border-[var(--elec-volt)] text-foreground"
											: "border-transparent text-muted-foreground hover:text-foreground"
									}`}
								>
									<TabIcon
										className={`size-4 shrink-0 ${
											active ? "text-[var(--elec-volt-text)]" : ""
										}`}
										aria-hidden="true"
									/>
									<span>{tab.label}</span>
									{tab.badge && (
										<span
											className={`text-[13px] tabular-nums ${
												active
													? "font-bold text-[var(--elec-volt-text)]"
													: "font-medium text-muted-foreground/80"
											}`}
										>
											{tab.badge}
										</span>
									)}
								</button>
							);
						})}
					</nav>

					{/* Active View Panel */}
					<div>
						{activeTab === "quests" && (
							<TierQuestBoard
								dashboard={dashboard}
								tierFilter={tierFilter}
								onTierFilterChange={setTierFilter}
								recommendedCourseId={primaryRecommendedCourseId}
								onOpenCourse={(cid, lid) => openCourse(cid, lid)}
								onAskCourseTutor={handleAskCourseTutor}
								onMutate={handleMutate}
								onOpenLinkModal={(cid) => openLinkModal(cid)}
								busyKey={busyKey}
							/>
						)}

						{activeTab === "watch" && (
							<CourseWorkspace
								dashboard={dashboard}
								courseId={selectedCourseId}
								initialLessonId={selectedLessonId}
								initialTimeSec={selectedTimeSec}
								initialPanelTab={selectedPanelTab}
								initialMaterialQuery={selectedMaterialQuery}
								initialMaterialId={selectedMaterialId}
								materialNavNonce={materialNavNonce}
								onSelectCourse={(cid) => {
									setSelectedCourseId(cid);
									setSelectedLessonId(undefined);
									setSelectedTimeSec(undefined);
									setSelectedPanelTab(undefined);
									setSelectedMaterialId(undefined);
									setSelectedMaterialQuery(undefined);
								}}
								onBackToQuests={() => setActiveTab("quests")}
								onOpenLinkModal={(cid) => openLinkModal(cid)}
								onOpenCert={openCert}
								onMutate={handleMutate}
								onAskTutor={(params) =>
									startTutor(
										`tutor:${params.courseId}${
											params.materialId
												? `:mat:${params.materialId}`
												: params.moduleId
													? `:${params.moduleId}`
													: params.lessonId
														? `:${params.lessonId}`
														: ""
										}`,
										params,
									)
								}
								busyKey={busyKey}
								mediaRevision={mediaRevision}
							/>
						)}

						{activeTab === "certs" && (
							<CertificationsPanel
								dashboard={dashboard}
								highlightedCertId={highlightedCertId}
								onMutate={handleMutate}
								onOpenCourse={(cid) => openCourse(cid)}
								onAskCertTutor={handleAskCertTutor}
								busyKey={busyKey}
							/>
						)}

						{activeTab === "portfolio" && (
							<PortfolioBenchPanel
								dashboard={dashboard}
								highlightedProjectId={highlightedProjectId}
								onMutate={handleMutate}
								onOpenCourse={(cid) => openCourse(cid)}
								onAskProjectTutor={handleAskProjectTutor}
								onAskBenchTutor={handleAskBenchTutor}
								busyKey={busyKey}
							/>
						)}

						{activeTab === "pacing" && (
							<PacingPanel
								dashboard={dashboard}
								onMutate={handleMutate}
								busyKey={busyKey}
							/>
						)}
					</div>

					{/* Revalidation notice footer with clean verification date */}
					<footer className="flex flex-col gap-1 border-t border-border/55 pt-4 text-[13px] leading-relaxed text-muted-foreground sm:flex-row sm:items-baseline sm:justify-between">
						<p className="max-w-[65ch]">{dashboard.track.revalidationNotice}</p>
						<span className="shrink-0 tabular-nums text-muted-foreground/85">
							{t("intensive.badge.verified", {
								date: formatVerifiedDate(dashboard.track.verifiedAt),
							})}
						</span>
					</footer>
				</div>
			</main>

			<MediaSourceModal
				open={linkModalOpen}
				dashboard={dashboard}
				initialCourseId={linkModalCourseId}
				onClose={() => setLinkModalOpen(false)}
				onUpdated={({ dashboard: nextDashboard, courseId: linkedCourseId }) => {
					setDashboard(nextDashboard);
					setSelectedCourseId(linkedCourseId);
					setMediaRevision((n) => n + 1);
					setActiveTab("watch");
				}}
			/>
		</div>
	);
}
