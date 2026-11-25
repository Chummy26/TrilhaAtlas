"use client";

/**
 * "Hoje" — ONE suggestion at a time (docs/research/00-SINTESE.md §2.6
 * planner): the planner's next item for the active study domain, or the
 * post-lesson self-check when a lesson was started and not yet rated.
 * Minimal text by design: kind · minutes, title, trail, one reason line.
 * Hidden in "Geral" (no study domain → /api/study/today answers 409).
 */

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/icon";
import { useServerEvent } from "@/components/server-events";
import { useI18n } from "@/components/i18n";
import { lessonStatement } from "./lesson-statement.ts";
import type { StudyNodeBrief, StudyToday, Translator } from "@/src/core";

export interface LessonStart {
	domainId: string;
	exploratory?: boolean;
	minutes: number;
	title: string;
	/** Rides the chat creation as graphContext (the curriculum node as session context). */
	context: { id: string; name: string; statement: string };
}

const KIND_PILL: Record<string, string> = {
	new: "study-pill study-pill-accent",
	review: "study-pill study-pill-info",
	vehicle: "study-pill study-pill-info",
	remediate: "study-pill study-pill-warning",
	probe: "study-pill",
};

function kindLabel(t: Translator, kind: string): string {
	switch (kind) {
		case "new":
			return t("pages.today.kindNew");
		case "review":
			return t("pages.today.kindReview");
		case "vehicle":
			return t("pages.today.kindVehicle");
		case "remediate":
			return t("pages.today.kindRemediate");
		case "probe":
			return t("pages.today.kindProbe");
		default:
			return kind;
	}
}

export const TodayCard = memo(function TodayCard({
	initialToday,
	onStart,
	disabled = false,
	setupHint,
}: {
	initialToday?: StudyToday | null;
	setupHint?: string;
	onStart: (lesson: LessonStart) => void;
	disabled?: boolean;
}) {
	const { t, intl } = useI18n();
	const [today, setToday] = useState<StudyToday | null>(initialToday ?? null);
	const [pending, setPending] = useState(false);
	const [startingReview, setStartingReview] = useState(false);
	const [reviewFeedback, setReviewFeedback] = useState<{ domain: string; ok: boolean; text: string }>();

	const decFmt = useMemo(() => new Intl.NumberFormat(intl, { maximumFractionDigits: 1 }), [intl]);
	const scoreFmt = useMemo(
		() => new Intl.NumberFormat(intl, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
		[intl],
	);

	useEffect(() => {
		if (initialToday !== undefined) setToday(initialToday);
	}, [initialToday]);

	const read = useCallback(() => {
		fetch("/api/study/today")
			.then((r) => (r.ok ? (r.json() as Promise<StudyToday>) : null))
			.then(setToday)
			.catch(() => setToday(null));
	}, []);
	useEffect(() => {
		if (initialToday === undefined) read();
	}, [initialToday, read]);
	useServerEvent("domain-changed", read);
	useServerEvent("curriculum-expanded", read);

	const post = async (body: Record<string, unknown>): Promise<boolean> => {
		setPending(true);
		const res = await fetch("/api/study/events", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}).catch(() => null);
		if (res?.ok) setToday((await res.json()) as StudyToday);
		setPending(false);
		return !!res?.ok;
	};

	const startUrgentReview = useCallback(async () => {
		if (!today || startingReview || disabled) return;
		const urgent = today.urgentReview;
		if (today.next && (!urgent || today.next.nodeId === urgent.nodeId) && (today.next.kind === "review" || today.next.kind === "vehicle")) {
			const minutes = Math.round(today.next.estMinutes);
			onStart({
				domainId: today.domain.id,
				minutes,
				title: today.next.brief.title,
				context: {
					id: today.next.nodeId,
					name: today.next.brief.title,
					statement: lessonStatement(today.next.brief, minutes),
				},
			});
			return;
		}
		if (!urgent) return;
		setStartingReview(true);
		try {
			const endpoint =
				"/api/study/materials?" +
				new URLSearchParams({ domain: today.domain.id, node: urgent.nodeId, lesson: "1" });
			const res = await fetch(endpoint);
			const detail = (await res.json().catch(() => null)) as { brief?: StudyNodeBrief; minutes?: number } | null;
			const minutes = Math.max(5, Math.round(detail?.minutes ?? 15));
			const brief: StudyNodeBrief = detail?.brief ?? {
				id: urgent.nodeId,
				title: urgent.title,
				path: [],
				summary: urgent.reason,
				scope: urgent.reason,
				objectives: [],
				misconceptions: [],
				hours: { lo: minutes / 60, hi: minutes / 60 },
				kind: "atom",
			};
			onStart({
				domainId: today.domain.id,
				minutes,
				title: urgent.title,
				context: {
					id: urgent.nodeId,
					name: urgent.title,
					statement: lessonStatement(brief, minutes),
				},
			});
		} finally {
			setStartingReview(false);
		}
	}, [disabled, onStart, startingReview, today]);

	if (!today || !today.ready) return null;
	const { next, pendingCheck, progress } = today;
	const chapter = today.chapters?.find((c) => c.known < c.total);
	const started = today.chapters?.some((c) => c.known > 0) || next?.kind !== "new";
	const mapLink = (node: string) =>
		`/mapa?dominio=${encodeURIComponent(today.domain.id)}&no=${encodeURIComponent(node)}`;
	const pct = progress.leaves > 0 ? Math.round((100 * progress.attained) / progress.leaves) : 0;

	const checkGrades = [
		{ grade: 0, label: t("pages.today.gradeAgain") },
		{ grade: 1, label: t("pages.today.gradePartial") },
		{ grade: 2, label: t("pages.today.gradeWithHelp") },
		{ grade: 3, label: t("pages.today.gradeIndependent") },
	] as const;

	const dueReviewsCount = today.dueReviewsCount ?? 0;
	const showUrgentBanner = Boolean(today.urgentReview || dueReviewsCount > 0);
	const moduleAssessment = today.moduleAssessment;
	const activeModId = moduleAssessment?.moduleId ?? today.currentModule?.id;
	const prepHref =
		next?.prepHref ??
		(activeModId
			? `/ementa?dominio=${encodeURIComponent(today.domain.id)}&modulo=${encodeURIComponent(activeModId)}`
			: `/ementa?dominio=${encodeURIComponent(today.domain.id)}`);
	const problemSetHref = activeModId
		? `/ementa?dominio=${encodeURIComponent(today.domain.id)}&modulo=${encodeURIComponent(activeModId)}&acao=lista`
		: null;
	const moduleExamHref = activeModId
		? `/ementa?dominio=${encodeURIComponent(today.domain.id)}&modulo=${encodeURIComponent(activeModId)}&acao=prova`
		: null;

	return (
		<section data-domain={today.domain.id} data-testid="today-card" className="cel-card ta-today-card mb-2.5 bg-card/95 px-4.5 py-3.5 backdrop-blur-xs">
			<div className="mb-2.5 flex flex-wrap items-center gap-2">
				<div className="flex items-center gap-2">
					<Icon name={pendingCheck ? "check" : "play"} size={16} />
					<h2 className="cel-display text-base leading-tight">
						{today.chapters?.length
							? t("pages.today.campaignTitle", { domain: today.domain.title })
							: t("pages.today.todayTitle")}
					</h2>
				</div>
				<Link
					href={`/mapa?dominio=${encodeURIComponent(today.domain.id)}`}
					className="cel-button cel-button-ghost min-h-7 px-2 py-0.5 text-xs"
				>
					<Icon name="map" size={14} tone={false} />
					{t("shell.sidebar.tree")}
				</Link>
				<Link
					href={`/ementa?dominio=${encodeURIComponent(today.domain.id)}`}
					className="cel-button cel-button-ghost min-h-7 px-2 py-0.5 text-xs"
				>
					<Icon name="book" size={14} tone={false} />
					{t("shell.sidebar.syllabus")}
				</Link>
				<Link
					href={`/ementa?dominio=${encodeURIComponent(today.domain.id)}&aba=nivelamento`}
					className="cel-button cel-button-ghost min-h-7 px-2 py-0.5 text-xs"
				>
					<Icon name="exercise" size={14} tone={false} />
					{t("pages.today.placement")}
				</Link>
				<span
					className="ml-auto text-xs text-muted-foreground tabular-nums"
					title={t("pages.today.progressSummaryTitle", {
						attained: progress.attained,
						leaves: progress.leaves,
					})}
				>
					<strong className="font-semibold text-foreground">
						{progress.attained > 0 && pct === 0 ? "<1" : pct}%
					</strong>{" "}
					·{" "}
					{t("pages.today.hoursPlanned", {
						attained: progress.attainedHours,
						total: progress.totalHours,
					})}
				</span>
			</div>

			{(today.pacing || today.coolingAlert) && (
				<div className="mb-2.5 flex flex-wrap items-center gap-2 text-xs">
					{today.pacing && (
						<div
							data-testid="today-pacing"
							className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-background/60 px-2.5 py-1 text-muted-foreground tabular-nums"
							title={
								today.pacing.realisticTotalWeeks != null
									? t("pages.today.pacingTotalEta", {
										weeks: decFmt.format(today.pacing.realisticTotalWeeks),
									})
									: undefined
							}
						>
							<Icon name="calendar" size={13} tone={false} />
							<span className="font-medium text-foreground">
								{t("pages.today.pacingWeekly", {
									effective: decFmt.format(today.pacing.effectiveWeeklyHours),
									planned: decFmt.format(today.pacing.plannedWeeklyHours),
								})}
							</span>
							{today.pacing.activeChapterWeeks != null && today.pacing.activeChapterWeeks > 0 && (
								<span>
									·{" "}
									{t("pages.today.pacingChapterEta", {
										weeks: decFmt.format(today.pacing.activeChapterWeeks),
									})}
								</span>
							)}
						</div>
					)}
					{today.coolingAlert && (
						<Link
							href={mapLink(today.coolingAlert.nodeId)}
							data-testid="today-cooling-alert"
							className="study-pill study-pill-warning tabular-nums underline-offset-2 hover:underline"
						>
							<Icon name="warning" size={12} tone={false} />
							{t("pages.today.coolingChip", {
								title: today.coolingAlert.title,
								pct: Math.round(today.coolingAlert.retrievability * 100),
							})}
						</Link>
					)}
				</div>
			)}

			{showUrgentBanner && (
				<div
					data-testid="today-urgent-review"
					className="mb-3 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-[var(--cel-warning,var(--border))]/55 bg-[color-mix(in_srgb,var(--cel-warning,var(--primary))_10%,var(--background))] px-3.5 py-2.5"
				>
					<div className="min-w-0 flex-1 space-y-0.5">
						<div className="flex flex-wrap items-center gap-2">
							<Icon name="review-due" size={15} />
							<strong className="text-xs font-semibold text-foreground">
								{t("pages.today.urgentReviewBanner", {
									count: Math.max(1, dueReviewsCount),
								})}
							</strong>
							{today.urgentReview && (
								<span className="study-pill study-pill-warning tabular-nums">
									{t("pages.today.urgentReviewRetain", {
										pct: Math.round(today.urgentReview.retrievability * 100),
									})}
								</span>
							)}
						</div>
						{today.urgentReview && (
							<p className="truncate text-xs text-muted-foreground">
								<Link
									href={mapLink(today.urgentReview.nodeId)}
									className="font-medium text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
								>
									{today.urgentReview.title}
								</Link>
								{today.urgentReview.reason ? ` · ${today.urgentReview.reason}` : ""}
							</p>
						)}
					</div>
					{today.urgentReview ? (
						<button
							type="button"
							data-testid="today-urgent-review-cta"
							disabled={pending || disabled || startingReview}
							onClick={() => void startUrgentReview()}
							className="cel-button cel-button-primary min-h-8 shrink-0 px-3 py-1 text-xs"
						>
							<Icon name="play" size={13} />
							{startingReview
								? t("pages.today.urgentReviewStarting")
								: t("pages.today.urgentReviewCta")}
						</button>
					) : (
						<Link
							href={`/mapa?dominio=${encodeURIComponent(today.domain.id)}`}
							data-testid="today-urgent-review-cta"
							className="cel-button min-h-8 shrink-0 px-3 py-1 text-xs"
						>
							{t("pages.today.urgentReviewCta")}
						</Link>
					)}
				</div>
			)}

			{today.chapters && (
				<div className="mb-3 rounded-xl border border-border/45 bg-background/55 px-3 py-2">
					<p className="cel-display text-sm leading-snug">
						{today.campaignGoal
							? t("pages.today.goalPrefix", { goal: today.campaignGoal })
							: chapter
								? `${chapter.level} · ${chapter.title}`
								: t("pages.today.courseCompleted")}
					</p>
					{chapter && (
						<p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
							{today.campaignGoal
								? t("pages.today.mainTrackPrefix", { level: chapter.level, title: chapter.title })
								: ""}
							{chapter.mission}
						</p>
					)}
				</div>
			)}

			{pendingCheck ? (
				<div className="space-y-2">
					<p className="cel-display text-base leading-snug">
						{pendingCheck.sessionId === "hoje"
							? t("pages.today.howWasLesson")
							: t("pages.today.lessonInProgress")}{" "}
						· {pendingCheck.title}
					</p>
					{pendingCheck.sessionId !== "hoje" && (
						<div className="flex flex-wrap items-center gap-2">
							<Link
								className="cel-button cel-button-primary min-h-9 px-4 py-1.5 text-sm"
								href={`/chat/${encodeURIComponent(pendingCheck.sessionId)}`}
							>
								<Icon name="play" size={15} />
								{t("pages.today.resumeLesson")}
							</Link>
							<Link
								className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
								href={mapLink(pendingCheck.nodeId)}
							>
								{t("pages.today.viewOnTree")}
							</Link>
						</div>
					)}
					{pendingCheck.sessionId === "hoje" && (
						<div className="flex flex-wrap gap-1.5">
							{checkGrades.map((g) => (
								<button
									key={g.grade}
									type="button"
									disabled={pending}
									onClick={() =>
										void post({
											kind: "self-check",
											nodeId: pendingCheck.nodeId,
											sessionId: pendingCheck.sessionId,
											exposureId: pendingCheck.exposureId,
											grade: g.grade,
										})
									}
									className={`cel-button ${g.grade === 3 ? "cel-button-success" : ""} min-h-8 px-3 text-sm`}
								>
									{g.label}
								</button>
							))}
						</div>
					)}
				</div>
			) : next ? (
				<div className="space-y-1.5">
					<div className="flex flex-wrap items-center gap-1.5">
						<span className={KIND_PILL[next.kind] ?? "study-pill"}>{kindLabel(t, next.kind)}</span>
						<span className="inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
							<Icon name="clock" size={13} tone={false} />
							~{Math.round(next.estMinutes)} min
						</span>
					</div>
					<p className="cel-display text-[17px] leading-snug">{next.brief.title}</p>
					{next.brief.path.length > 0 && (
						<p className="truncate text-xs text-muted-foreground">{next.brief.path.join(" › ")}</p>
					)}
					<p className="text-xs leading-relaxed text-muted-foreground">{next.reason}</p>
					<div className="flex flex-wrap items-center gap-2 pt-1.5">
						<button
							type="button"
							disabled={pending || disabled}
							data-testid="today-start"
							onClick={() => {
								const minutes = Math.round(next.estMinutes);
								const priorGap =
									today.reinforceHint?.nodeId === next.nodeId
										? today.reinforceHint.feedback
										: undefined;
								onStart({
									domainId: today.domain.id,
									minutes,
									title: next.brief.title,
									context: {
										id: next.nodeId,
										name: next.brief.title,
										statement: lessonStatement(next.brief, minutes, priorGap),
									},
								});
							}}
							className="cel-button cel-button-primary min-h-9 px-4 text-sm"
						>
							<Icon name="play" size={16} />
							{today.reinforceHint?.nodeId === next.nodeId
								? t("pages.today.practiceRemediation")
								: chapter
									? started
										? t("pages.today.continueCampaign")
										: t("pages.today.startCampaign")
									: t("pages.today.startLesson")}
						</button>
						{next.kind === "new" && (
							<button
								type="button"
								disabled={pending}
								onClick={() => void post({ kind: "known", nodeId: next.nodeId })}
								className="cel-button cel-button-ghost min-h-9 px-3 text-sm"
							>
								{t("pages.today.alreadyKnow")}
							</button>
						)}
					</div>
					{setupHint && <p className="pt-1 text-xs text-muted-foreground">{setupHint}</p>}
				</div>
			) : (
				<p className="cel-display text-base">{t("pages.today.doneForToday")}</p>
			)}

			{today.currentModule && (
				<div className="mt-3 rounded-xl border border-border/50 bg-background/55 px-3 py-2.5 text-xs">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<span className="font-semibold text-foreground">
							{t("pages.today.moduleHeader", {
								index: today.currentModule.index,
								total: today.currentModule.totalModules,
								title: today.currentModule.title,
							})}
						</span>
						<span className="tabular-nums text-muted-foreground">
							{t("pages.today.moduleLessonsCount", {
								completed: today.currentModule.completed,
								total: today.currentModule.total,
							})}
						</span>
					</div>
					<progress
						max={Math.max(1, today.currentModule.total)}
						value={today.currentModule.completed}
						aria-label={t("pages.today.moduleProgressAria", { title: today.currentModule.title })}
						className="study-progress mt-1.5 w-full"
					/>

					<ol
						aria-label={t("pages.today.arcAria")}
						data-testid="today-course-arc"
						className="mt-2 flex flex-wrap items-center gap-1 text-[11px]"
					>
						<li className="inline-flex items-center gap-1">
							<Link
								href={prepHref}
								className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-medium transition-colors hover:border-foreground/50 ${
									next?.hasPrepNote
										? "border-[var(--cel-success,var(--lh-success))]/45 bg-[var(--cel-success,var(--lh-success))]/10 text-foreground"
										: "border-border/55 bg-card/70 text-foreground"
								}`}
							>
								<span aria-hidden="true">{next?.hasPrepNote ? "✓" : "○"}</span>
								{t("pages.today.arcPrep")}
								{next?.hasPrepNote && (
									<span className="text-[10px] text-[var(--cel-success-text,var(--lh-success))]">
										· {t("pages.today.arcPrepReady")}
									</span>
								)}
							</Link>
						</li>
						<li aria-hidden="true" className="text-muted-foreground/60">→</li>
						<li className="inline-flex items-center gap-1">
							<span
								className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-medium tabular-nums ${
									today.currentModule.total > 0 &&
									today.currentModule.completed >= today.currentModule.total
										? "border-[var(--cel-success,var(--lh-success))]/45 bg-[var(--cel-success,var(--lh-success))]/10 text-foreground"
										: "border-[var(--cel-accent,var(--primary))]/45 bg-[var(--cel-accent,var(--primary))]/10 text-foreground"
								}`}
							>
								<span aria-hidden="true">
									{today.currentModule.total > 0 &&
									today.currentModule.completed >= today.currentModule.total
										? "✓"
										: "●"}
								</span>
								{t("pages.today.arcLesson")} {today.currentModule.completed}/{today.currentModule.total}
							</span>
						</li>
						<li aria-hidden="true" className="text-muted-foreground/60">→</li>
						<li className="inline-flex items-center gap-1">
							{problemSetHref ? (
								<Link
									href={problemSetHref}
									data-testid="today-arc-problem-set"
									className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-medium transition-colors hover:border-foreground/50 ${
										moduleAssessment?.problemSetPassed
											? "border-[var(--cel-success,var(--lh-success))]/45 bg-[var(--cel-success,var(--lh-success))]/10 text-foreground"
											: "border-border/55 bg-card/70 text-foreground"
									}`}
								>
									<span aria-hidden="true">{moduleAssessment?.problemSetPassed ? "✓" : "○"}</span>
									{t("pages.today.arcProblemSet")}
									{moduleAssessment?.problemSetScore !== undefined && (
										<span className="tabular-nums text-muted-foreground">
											· {scoreFmt.format(moduleAssessment.problemSetScore)}
										</span>
									)}
								</Link>
							) : (
								<span className="inline-flex items-center gap-1 rounded-md border border-border/50 px-2 py-0.5 text-muted-foreground">
									○ {t("pages.today.arcProblemSet")}
								</span>
							)}
						</li>
						<li aria-hidden="true" className="text-muted-foreground/60">→</li>
						<li className="inline-flex items-center gap-1">
							{moduleExamHref ? (
								<Link
									href={moduleExamHref}
									data-testid="today-arc-module-exam"
									className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-medium transition-colors hover:border-foreground/50 ${
										moduleAssessment?.examPassed
											? "border-[var(--cel-success,var(--lh-success))]/45 bg-[var(--cel-success,var(--lh-success))]/10 text-foreground"
											: moduleAssessment?.examUnlocked
												? "border-[var(--cel-accent,var(--primary))]/60 bg-[var(--cel-accent,var(--primary))]/15 text-foreground"
												: "border-border/50 bg-background/50 text-muted-foreground"
									}`}
								>
									<span aria-hidden="true">
										{moduleAssessment?.examPassed ? "✓" : moduleAssessment?.examUnlocked ? "●" : "○"}
									</span>
									{t("pages.today.arcExam")}
									{moduleAssessment?.examScore !== undefined && (
										<span className="tabular-nums text-muted-foreground">
											· {scoreFmt.format(moduleAssessment.examScore)}
										</span>
									)}
								</Link>
							) : (
								<span className="inline-flex items-center gap-1 rounded-md border border-border/50 px-2 py-0.5 text-muted-foreground">
									○ {t("pages.today.arcExam")}
								</span>
							)}
						</li>
						<li aria-hidden="true" className="text-muted-foreground/60">→</li>
						<li className="inline-flex items-center gap-1">
							<span
								className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-medium ${
									dueReviewsCount > 0
										? "border-[var(--cel-warning,var(--border))]/55 bg-[var(--cel-warning,var(--primary))]/10 text-foreground"
										: today.currentModule.completed > 0
											? "border-[var(--cel-success,var(--lh-success))]/45 bg-[var(--cel-success,var(--lh-success))]/10 text-foreground"
											: "border-border/50 bg-background/50 text-muted-foreground"
								}`}
							>
								<span aria-hidden="true">
									{dueReviewsCount > 0 ? "!" : today.currentModule.completed > 0 ? "✓" : "○"}
								</span>
								{t("pages.today.arcReview")}
								{dueReviewsCount > 0 ? (
									<span className="tabular-nums">· {t("pages.today.arcDueCount", { count: dueReviewsCount })}</span>
								) : today.currentModule.completed > 0 ? (
									<span>· {t("pages.today.arcReviewOk")}</span>
								) : null}
							</span>
						</li>
					</ol>

					<details className="study-disclosure mt-2 text-xs">
						<summary>{t("pages.today.moduleLessons")}</summary>
						<div className="study-disclosure-body">
							<ol className="study-missions">
								{today.currentModule.lessons.map((lesson, idx) => (
									<li key={lesson.id} data-reached={lesson.status === "done"}>
										<span className="study-mission-marker" aria-hidden="true">
											{lesson.status === "done"
												? "✓"
												: lesson.status === "current"
													? "▶"
													: lesson.status === "available"
														? "○"
														: "·"}
										</span>
										<Link
											className={`underline decoration-border underline-offset-2 hover:decoration-foreground ${lesson.status === "current" ? "font-semibold text-foreground" : "font-medium"}`}
											href={mapLink(lesson.id)}
										>
											{idx + 1}. {lesson.title}
										</Link>
										{lesson.isFinale && (
											<span className="study-pill study-pill-accent">{t("pages.today.finalePill")}</span>
										)}
										<span className="ml-auto tabular-nums text-muted-foreground">~{lesson.minutes} min</span>
									</li>
								))}
							</ol>
						</div>
					</details>
				</div>
			)}

			{today.queue && today.queue.length > 0 && (
				<details className="study-disclosure mt-2.5 text-xs">
					<summary>{t("pages.today.upNextQueue", { count: today.queue.length })}</summary>
					<div className="study-disclosure-body">
						<ol className="study-missions">
							{today.queue.map((item) => (
								<li key={item.nodeId}>
									<span className="study-pill">{kindLabel(t, item.kind)}</span>
									<Link
										className="font-medium underline decoration-border underline-offset-2 hover:decoration-foreground"
										href={mapLink(item.nodeId)}
									>
										{item.title}
									</Link>
									<span className="text-muted-foreground">· {item.moduleTitle}</span>
									<span className="ml-auto tabular-nums text-muted-foreground">~{item.estMinutes} min</span>
								</li>
							))}
						</ol>
					</div>
				</details>
			)}

			{today.review && (
				<details key={today.domain.id + today.review.id} className="study-disclosure mt-3 text-sm">
					<summary>
						<Icon name="review-due" size={15} />
						{t("pages.today.closedBookReview", { title: today.review.title })}
					</summary>
					<form
						onSubmit={async (event) => {
							event.preventDefault();
							const answer = new FormData(event.currentTarget).get("answer");
							setPending(true);
							try {
								const res = await fetch("/api/study/review", {
									method: "POST",
									headers: { "Content-Type": "application/json" },
									body: JSON.stringify({ domain: today.domain.id, id: today.review!.id, answer }),
								});
								const result = await res.json();
								if (!res.ok) throw new Error(result.error);
								setReviewFeedback({
									domain: today.domain.id,
									ok: Boolean(result.correct),
									text:
										(result.correct
											? t("pages.today.correctPrefix")
											: t("pages.today.reviewSolutionPrefix")) + result.explanation,
								});
								read();
							} catch (error) {
								setReviewFeedback({
									domain: today.domain.id,
									ok: false,
									text: error instanceof Error ? error.message : t("pages.today.reviewSubmitErr"),
								});
							} finally {
								setPending(false);
							}
						}}
						className="study-disclosure-body space-y-2.5"
					>
						<label className="block space-y-1.5 text-sm">
							<span className="leading-relaxed">{today.review.prompt}</span>
							<input
								name="answer"
								className="cel-input block w-full px-3 py-2 text-sm"
								maxLength={150}
								required
								autoComplete="off"
							/>
						</label>
						<button type="submit" disabled={pending} className="cel-button min-h-8 px-3.5 py-1 text-xs">
							{t("pages.today.checkAnswer")}
						</button>
					</form>
				</details>
			)}

			{reviewFeedback?.domain === today.domain.id && (
				<p
					role="status"
					className={
						"mt-2 rounded-lg border px-3 py-2 text-xs leading-relaxed " +
						(reviewFeedback.ok
							? "border-[var(--cel-success,var(--lh-success))]/45 bg-[var(--cel-success,var(--lh-success))]/10"
							: "border-border bg-background/70")
					}
				>
					{reviewFeedback.text}
				</p>
			)}

			{today.chapters && (
				<div className="study-campaign" aria-label={t("pages.today.campaignAria")}>
					<nav aria-label={t("pages.today.chaptersAria")}>
						{today.chapters.map((c) => (
							<Link
								key={c.level}
								href={mapLink(c.entry)}
								data-reached={c.known === c.total && c.total > 0}
								aria-current={c === chapter ? "step" : undefined}
								aria-label={t("pages.today.chapterAria", {
									level: c.level,
									title: c.title,
									known: c.known,
									total: c.total,
								})}
								title={`${c.title} · ${c.known}/${c.total}`}
							>
								{c.total > 0 && c.known === c.total ? "✓ " : ""}
								{c.level.replace(/^Etapa /, "")}
							</Link>
						))}
					</nav>
					{chapter && (
						<div className="flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground">
							<progress
								max={chapter.total}
								value={chapter.known}
								aria-label={t("pages.today.chapterProgressAria", { level: chapter.level })}
								className="study-progress w-28"
							/>
							<span className="tabular-nums" title={t("pages.today.progressTitle")}>
								{t("pages.today.chapterSkillsCount", {
									known: chapter.known,
									total: chapter.total,
								})}
							</span>
						</div>
					)}
					{chapter && (
						<details className="study-disclosure mt-2.5 text-xs">
							<summary>{t("pages.today.chapterLandmarks", { level: chapter.level })}</summary>
							<div className="study-disclosure-body">
								<ol className="study-missions">
									{chapter.landmarks.map((step) => (
										<li key={step.id} data-reached={step.known}>
											<span className="study-mission-marker" aria-hidden="true">
												{step.known ? "✓" : step.id === chapter.finale ? "⚑" : "•"}
											</span>
											<Link
												className="font-medium underline decoration-border underline-offset-2 hover:decoration-foreground"
												href={mapLink(step.id)}
											>
												{step.title}
											</Link>
											{step.id === chapter.finale && (
												<span className="study-pill study-pill-accent">{t("pages.today.finalePill")}</span>
											)}
											{step.known && (
												<span className="text-xs text-[var(--cel-success-text,var(--lh-success))]">
													{t("pages.today.known")}
												</span>
											)}
										</li>
									))}
								</ol>
								<p className="mt-2 text-xs text-muted-foreground">{t("pages.today.betweenMissions")}</p>
							</div>
						</details>
					)}
				</div>
			)}

			{today.optionalPractice && (
				<Link
					className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--cel-link,var(--lh-accent))] underline underline-offset-2"
					href={`/mapa?dominio=${encodeURIComponent(today.domain.id)}&no=${encodeURIComponent(today.optionalPractice.id)}`}
				>
					<Icon name="review" size={14} tone={false} />
					{t("pages.today.optionalPractice", { title: today.optionalPractice.title })}
				</Link>
			)}
			{Boolean(progress.plannedPracticeHours) && (
				<p className="mt-2 text-xs text-muted-foreground tabular-nums">
					{t("pages.today.distributedPractice", { hours: progress.plannedPracticeHours ?? 0 })}
				</p>
			)}
		</section>
	);
});
