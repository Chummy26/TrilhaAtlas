"use client";

import { useMemo, useState } from "react";
import {
	BookOpenIcon,
	BotIcon,
	CheckCircle2Icon,
	ChevronDownIcon,
	ClockIcon,
	FilmIcon,
	FolderIcon,
	PlayIcon,
	SearchIcon,
	SparklesIcon,
	XIcon,
} from "lucide-react";
import type {
	CourseTier,
	DeliveryMode,
	IntensiveCourseView,
	IntensiveDashboardDTO,
} from "@/src/core";
import { useT } from "@/components/i18n";
import {
	courseStatusLabel,
	formatHoursCompact,
	INTENSIVE_BTN_COMPACT,
	INTENSIVE_BTN_COMPACT_PRIMARY,
	INTENSIVE_INPUT,
	type IntensiveMutation,
} from "./tutor-launch.ts";

interface TierQuestBoardProps {
	dashboard: IntensiveDashboardDTO;
	tierFilter?: CourseTier | "all";
	onTierFilterChange?: (tier: CourseTier | "all") => void;
	recommendedCourseId?: string;
	onOpenCourse: (courseId: string, lessonId?: string) => void;
	onAskCourseTutor: (course: IntensiveCourseView) => void;
	onMutate: (mutation: IntensiveMutation) => Promise<void>;
	onOpenLinkModal: (courseId: string) => void;
	busyKey: string | null;
}

type FormatFilter = "all" | "local" | "external";

const TIER_ART: Record<CourseTier, string> = {
	1: "/intensive/electronics/tier-1-bench.jpg",
	2: "/intensive/electronics/tier-2-pcb.jpg",
	3: "/intensive/electronics/tier-3-embedded.jpg",
	4: "/intensive/electronics/tier-4-library.jpg",
};

function deliveryLabel(mode: DeliveryMode, t: ReturnType<typeof useT>): string {
	switch (mode) {
		case "local-video-pack":
			return t("intensive.quests.deliveryLocal");
		case "youtube-playlist":
			return t("intensive.quests.deliveryYoutube");
		case "open-textbook":
			return t("intensive.quests.deliveryTextbook");
		default:
			return t("intensive.quests.deliveryOnline");
	}
}

export function TierQuestBoard({
	dashboard,
	tierFilter: controlledTierFilter,
	onTierFilterChange,
	recommendedCourseId,
	onOpenCourse,
	onAskCourseTutor,
	onMutate,
	onOpenLinkModal,
	busyKey,
}: TierQuestBoardProps) {
	const t = useT();
	const [internalTierFilter, setInternalTierFilter] = useState<CourseTier | "all">("all");
	const [formatFilter, setFormatFilter] = useState<FormatFilter>("all");
	const [query, setQuery] = useState("");
	const [expandedRationale, setExpandedRationale] = useState<Record<string, boolean>>({});

	const tierFilter = controlledTierFilter ?? internalTierFilter;
	const setTierFilter = (next: CourseTier | "all") => {
		setInternalTierFilter(next);
		onTierFilterChange?.(next);
	};

	const normalizedQuery = query.trim().toLowerCase();
	const hasActiveFilters = tierFilter !== "all" || formatFilter !== "all" || normalizedQuery !== "";

	const filteredTiers = useMemo(() => {
		return dashboard.tiers
			.filter((tier) => tierFilter === "all" || tier.spec.tier === tierFilter)
			.map((tier) => {
				const courses = tier.courses.filter((course) => {
					const isLocal =
						course.spec.deliveryMode === "local-video-pack" ||
						Boolean(course.mediaSource);
					if (formatFilter === "local" && !isLocal) return false;
					if (formatFilter === "external" && isLocal) return false;
					if (!normalizedQuery) return true;
					const haystack = [
						`#${course.spec.rank}`,
						course.spec.title,
						course.spec.provider,
						course.spec.origin,
						course.spec.language,
						...course.spec.nocCodesUnlocked,
						...course.spec.europeGlobalAlignment,
					]
						.join(" ")
						.toLowerCase();
					return haystack.includes(normalizedQuery);
				});
				return { ...tier, courses };
			})
			.filter((tier) => tier.courses.length > 0);
	}, [dashboard.tiers, tierFilter, formatFilter, normalizedQuery]);

	const toggleRationale = (courseId: string) => {
		setExpandedRationale((prev) => ({ ...prev, [courseId]: !prev[courseId] }));
	};

	const resetFilters = () => {
		setTierFilter("all");
		setFormatFilter("all");
		setQuery("");
	};

	return (
		<div className="space-y-8">
			{/* Connected Segmented Filter Bar */}
			<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
				<div className="flex flex-wrap items-center gap-2.5">
					<div
						role="group"
						aria-label={t("intensive.quests.filterAllTiers")}
						className="elec-segmented"
					>
						{(["all", 1, 2, 3, 4] as const).map((tierVal) => {
							const active = tierFilter === tierVal;
							return (
								<button
									key={String(tierVal)}
									type="button"
									aria-pressed={active}
									onClick={() => setTierFilter(tierVal)}
									className={`elec-segmented-item min-h-8 px-3 py-1 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--elec-volt)] cursor-pointer ${
										active ? "" : "text-muted-foreground hover:text-foreground"
									}`}
								>
									{tierVal === "all"
										? t("intensive.quests.filterAllTiers")
										: t("intensive.quests.filterTier", { tier: tierVal })}
								</button>
							);
						})}
					</div>

					<div
						role="group"
						aria-label={t("intensive.quests.filterAllModes")}
						className="elec-segmented elec-segmented-subtle"
					>
						{(
							[
								["all", t("intensive.quests.filterAllModes")],
								["local", t("intensive.quests.filterLocal")],
								["external", t("intensive.quests.filterExternal")],
							] as const
						).map(([val, label]) => {
							const active = formatFilter === val;
							return (
								<button
									key={val}
									type="button"
									aria-pressed={active}
									onClick={() => setFormatFilter(val)}
									className={`elec-segmented-item min-h-8 px-2.5 py-1 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--elec-volt)] cursor-pointer ${
										active ? "font-semibold" : "text-muted-foreground hover:text-foreground"
									}`}
								>
									{label}
								</button>
							);
						})}
					</div>

					{hasActiveFilters && (
						<button
							type="button"
							onClick={resetFilters}
							className="inline-flex min-h-9 items-center gap-1 px-2 text-[13px] font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline cursor-pointer"
						>
							<XIcon className="size-3.5" aria-hidden="true" />
							{t("intensive.quests.clearFilters")}
						</button>
					)}
				</div>

				<div className="relative w-full md:w-72">
					<SearchIcon
						className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
						aria-hidden="true"
					/>
					<input
						type="search"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder={t("intensive.quests.filterPlaceholder")}
						aria-label={t("intensive.quests.filterPlaceholder")}
						className={`${INTENSIVE_INPUT} min-h-10 pl-9`}
					/>
				</div>
			</div>

			{filteredTiers.length === 0 ? (
				<div className="elec-surface space-y-3 p-10 text-center">
					<p className="text-sm text-muted-foreground">{t("intensive.quests.emptyFilter")}</p>
					{hasActiveFilters && (
						<button
							type="button"
							onClick={resetFilters}
							className={INTENSIVE_BTN_COMPACT}
						>
							{t("intensive.quests.clearFilters")}
						</button>
					)}
				</div>
			) : (
				filteredTiers.map((tier) => {
					const isTier4 = tier.spec.completionScope === "on-demand";
					const artSrc = TIER_ART[tier.spec.tier];

					return (
						<section
							key={tier.spec.id}
							className="space-y-4"
							aria-labelledby={`tier-heading-${tier.spec.tier}`}
						>
							{/* Illustrated Tier Header Row (Nano Banana 3:2 cel-shaded art) */}
							<div className="elec-tier-header grid grid-cols-1 items-center gap-4 border-b border-border/65 pb-4 md:grid-cols-[168px_minmax(0,1fr)_220px]">
								<div className="elec-tier-art w-full max-w-[220px] md:max-w-none">
									<img
										src={artSrc}
										alt=""
										aria-hidden="true"
									/>
								</div>

								<div className="min-w-0 max-w-[65ch] space-y-1.5">
									<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
										<h2
											id={`tier-heading-${tier.spec.tier}`}
											className="font-title text-lg tracking-tight text-foreground sm:text-xl"
										>
											{tier.spec.title}
										</h2>
										<span className="text-[13px] font-semibold tabular-nums text-[var(--elec-volt-text)]">
											{tier.spec.timeframe}
										</span>
									</div>
									<p className="text-sm leading-relaxed text-muted-foreground">
										{tier.spec.description}
									</p>
									{isTier4 && tier.spec.uiGuidance && (
										<p className="text-[13px] font-medium text-[var(--cel-warning-text,var(--lh-warning))]">
											{tier.spec.uiGuidance}
										</p>
									)}
								</div>

								{/* Honest per-tier % telemetry */}
								<div className="w-full space-y-1.5">
									<div className="flex items-baseline justify-between text-[13px] tabular-nums">
										<span className="text-muted-foreground">
											{t("intensive.quests.tierStats", {
												completed: tier.metrics.completedCourseCount,
												total: tier.metrics.courseCount,
												hoursDone: formatHoursCompact(tier.metrics.completedHours),
												hoursTotal: formatHoursCompact(tier.metrics.totalHours),
											})}
										</span>
										<span className="text-base font-bold text-foreground">
											{tier.metrics.percent}%
										</span>
									</div>
									<div className="elec-progress-track">
										<div
											className={`elec-progress-fill ${
												isTier4 ? "bg-muted-foreground/60" : "bg-[var(--elec-volt)]"
											}`}
											style={{
												width: `${Math.min(100, Math.max(0, tier.metrics.percent))}%`,
											}}
										/>
									</div>
								</div>
							</div>

							{/* Course cards grid (#1–#21) */}
							<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
								{tier.courses.map((course) => {
									const isLocalPack =
										course.spec.deliveryMode === "local-video-pack" ||
										Boolean(course.mediaSource);
									const isExpanded = Boolean(expandedRationale[course.spec.id]);
									const isCompleted = course.metrics.status === "completed";
									const isRecommended =
										!isCompleted && recommendedCourseId === course.spec.id;
									const videoMetrics = course.metrics.videoProgress;
									const modMetrics = course.metrics.moduleProgress;
									const isTranscribing =
										course.transcriptionStatus?.state === "running" ||
										course.transcriptionStatus?.state === "watching";

									return (
										<article
											key={course.spec.id}
											data-testid={`course-card-${course.spec.id}`}
											className={`elec-surface elec-surface-interactive flex flex-col justify-between overflow-hidden ${
												isRecommended ? "elec-course-recommended" : ""
											}`}
										>
											<div className="space-y-3.5 p-4 sm:p-5">
												{/* Top metadata line — clean typographic hierarchy, zero decorative chips */}
												<div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
													<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
														<span className="font-bold tabular-nums text-[var(--elec-volt-text)]">
															#{course.spec.rank}
														</span>
														<span className="text-border" aria-hidden="true">
															·
														</span>
														<span
															className={`inline-flex items-center gap-1 font-medium ${
																isLocalPack
																	? "text-foreground"
																	: "text-muted-foreground"
															}`}
														>
															{isLocalPack ? (
																<FilmIcon
																	className="size-3.5 shrink-0 text-[var(--elec-volt-text)]"
																	aria-hidden="true"
																/>
															) : (
																<BookOpenIcon
																	className="size-3.5 shrink-0"
																	aria-hidden="true"
																/>
															)}
															{deliveryLabel(course.spec.deliveryMode, t)}
														</span>
														{isTranscribing && (
															<>
																<span className="text-border" aria-hidden="true">
																	·
																</span>
																<span className="font-semibold text-[var(--elec-mint-text)]">
																	GPU
																</span>
															</>
														)}
													</div>

													<span
														className={`inline-flex items-center gap-1 font-semibold ${
															isCompleted
																? "text-[var(--elec-mint-text)]"
																: isRecommended
																	? "text-[var(--elec-volt-text)]"
																	: "text-muted-foreground"
														}`}
													>
														{isCompleted && (
															<CheckCircle2Icon className="size-3.5 shrink-0" aria-hidden="true" />
														)}
														{isRecommended && (
															<SparklesIcon className="size-3.5 shrink-0" aria-hidden="true" />
														)}
														{isRecommended
															? t("intensive.quests.recommendedNext")
															: courseStatusLabel(t, course.metrics.status)}
													</span>
												</div>

												{/* Course Title & Provider/Hours/Language */}
												<div className="space-y-1">
													<h3 className="text-base font-bold leading-snug text-foreground">
														<button
															type="button"
															onClick={() =>
																onOpenCourse(course.spec.id, course.nextLesson?.lessonId)
															}
															className="text-left transition-colors duration-150 hover:text-[var(--elec-volt-text)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--elec-volt)] cursor-pointer"
														>
															{course.spec.title}
														</button>
													</h3>
													<div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[13px] text-muted-foreground">
														<span>{course.spec.provider}</span>
														<span aria-hidden="true">·</span>
														<span className="inline-flex items-center gap-1 tabular-nums">
															<ClockIcon className="size-3.5 shrink-0" aria-hidden="true" />
															{formatHoursCompact(course.spec.estimatedHours)} h ({course.spec.durationLabel})
														</span>
														<span aria-hidden="true">·</span>
														<span>{course.spec.language}</span>
													</div>
												</div>

												{/* Parallel daily cadence callout (e.g., CTA Eletrônica #5) */}
												{course.spec.parallelCadence && (
													<div className="border-l-2 border-[var(--elec-volt)] bg-background/55 py-1.5 pl-3 pr-2 text-[13px] text-foreground">
														<span className="font-bold tabular-nums text-[var(--elec-volt-text)]">
															{t("intensive.quests.parallelBadge", {
																min: course.spec.parallelCadence.recommendedDailyMinutesMin,
																max: course.spec.parallelCadence.recommendedDailyMinutesMax,
															})}
														</span>
														<span className="ml-1.5 text-muted-foreground">
															· {course.spec.parallelCadence.label}
														</span>
													</div>
												)}

												{/* Progress bar + concrete counts */}
												<div className="space-y-1.5">
													<div className="flex items-center justify-between text-[13px] tabular-nums">
														<div className="flex flex-wrap items-center gap-2 text-muted-foreground">
															{videoMetrics.denominatorCount > 0 ? (
																<>
																	<span>
																		{t("intensive.quests.videosCount", {
																			watched: videoMetrics.watchedCount,
																			total: videoMetrics.denominatorCount,
																		})}
																	</span>
																	{videoMetrics.transcribedCount > 0 && (
																		<span>
																			·{" "}
																			{t("intensive.quests.transcribedCount", {
																				count: videoMetrics.transcribedCount,
																			})}
																		</span>
																	)}
																</>
															) : (
																<span>
																	{t("intensive.quests.modulesCount", {
																		done: modMetrics.completedCount,
																		total: modMetrics.totalCount,
																	})}
																</span>
															)}
														</div>
														<span className="font-bold text-foreground">
															{course.metrics.percent}%
														</span>
													</div>
													<div className="elec-progress-track">
														<div
															className={`elec-progress-fill ${
																isCompleted
																	? "bg-[var(--elec-mint)]"
																	: "bg-[var(--elec-volt)]"
															}`}
															style={{
																width: `${Math.min(100, Math.max(0, course.metrics.percent))}%`,
															}}
														/>
													</div>
												</div>

												{/* Clean typographic NOC alignment line + Rationale disclosure */}
												<div className="space-y-2 pt-0.5">
													{course.spec.nocCodesUnlocked.length > 0 && (
														<p className="text-[13px] leading-snug text-muted-foreground/90">
															{course.spec.nocCodesUnlocked.slice(0, 2).join(" · ")}
														</p>
													)}

													<button
														type="button"
														aria-expanded={isExpanded}
														onClick={() => toggleRationale(course.spec.id)}
														className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--elec-volt)] cursor-pointer"
													>
														<ChevronDownIcon
															className={`size-3.5 transition-transform duration-150 ${
																isExpanded ? "rotate-180" : ""
															}`}
															aria-hidden="true"
														/>
														{t("intensive.quests.whyPosition")}
													</button>

													{isExpanded && (
														<div className="space-y-2 border-t border-border/45 pt-2.5 text-sm leading-relaxed text-muted-foreground">
															<p className="text-foreground/90">{course.spec.whyThisPosition}</p>
															{course.spec.portfolioDeliverables.length > 0 && (
																<div>
																	<span className="font-semibold text-foreground">
																		{t("intensive.quests.deliverablesLabel")}:{" "}
																	</span>
																	<span>{course.spec.portfolioDeliverables.join(" · ")}</span>
																</div>
															)}
															{course.spec.europeGlobalAlignment.length > 0 && (
																<div>
																	<span className="font-semibold text-foreground">
																		{t("intensive.quests.globalAlignmentLabel")}:{" "}
																	</span>
																	<span>{course.spec.europeGlobalAlignment.join(" · ")}</span>
																</div>
															)}
														</div>
													)}
												</div>
											</div>

											{/* Card bottom action bar — 1 clear primary action + quiet secondary link */}
											<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 bg-background/40 px-4 py-3 sm:px-5">
												<div className="flex flex-wrap items-center gap-2.5">
													<button
														type="button"
														onClick={() =>
															onOpenCourse(course.spec.id, course.nextLesson?.lessonId)
														}
														className={
															isRecommended
																? INTENSIVE_BTN_COMPACT_PRIMARY
																: INTENSIVE_BTN_COMPACT
														}
													>
														{course.nextLesson ? (
															<>
																<PlayIcon className="size-3.5 shrink-0" aria-hidden="true" />
																{t("intensive.action.watchNext")}
															</>
														) : (
															<>
																<BookOpenIcon className="size-3.5 shrink-0" aria-hidden="true" />
																{t("intensive.action.openCourse")}
															</>
														)}
													</button>

													<button
														type="button"
														onClick={() => onAskCourseTutor(course)}
														disabled={busyKey === `tutor:${course.spec.id}`}
														className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-muted-foreground transition-colors duration-150 hover:bg-accent/70 hover:text-foreground disabled:opacity-45 cursor-pointer"
													>
														<BotIcon className="size-3.5 shrink-0" aria-hidden="true" />
														{t("intensive.action.askTutor")}
													</button>

													{course.spec.deliveryMode === "local-video-pack" &&
														!course.mediaSource && (
															<button
																type="button"
																onClick={() => onOpenLinkModal(course.spec.id)}
																className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-[var(--elec-volt-text)] transition-colors duration-150 hover:bg-accent/70 cursor-pointer"
															>
																<FolderIcon className="size-3.5 shrink-0" aria-hidden="true" />
																{t("intensive.action.linkFolder")}
															</button>
														)}
												</div>

												{isTier4 && (
													<button
														type="button"
														aria-pressed={Boolean(course.state.optedIn)}
														disabled={busyKey === `course:${course.spec.id}`}
														onClick={() => {
															void onMutate({
																kind: "update-course",
																courseId: course.spec.id,
																optedIn: !course.state.optedIn,
															});
														}}
														className={`min-h-8 rounded-lg border px-2.5 py-1 text-[13px] font-semibold transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--elec-volt)] cursor-pointer ${
															course.state.optedIn
																? "border-[var(--elec-volt)] bg-[var(--elec-volt)]/15 text-[var(--elec-volt-text)]"
																: "border-border/70 bg-background text-muted-foreground hover:text-foreground"
														}`}
													>
														{course.state.optedIn
															? t("intensive.quests.optedIn")
															: t("intensive.quests.optIn")}
													</button>
												)}
											</div>
										</article>
									);
								})}
							</div>
						</section>
					);
				})
			)}
		</div>
	);
}
