"use client";

import { ArrowRightIcon, ChevronRightIcon, InfoIcon, PlayIcon } from "lucide-react";
import {
	TEMPLATE_INTENSIVE_TRACK_ID,
	type CourseTier,
	type IntensiveDashboardDTO,
	type IntensiveRecommendedAction,
} from "@/src/core";
import { useT } from "@/components/i18n";
import {
	formatHoursCompact,
	formatMinutesAsClock,
	INTENSIVE_BTN_ON_DARK,
	INTENSIVE_BTN_PRIMARY,
	type IntensiveTab,
} from "./tutor-launch.ts";

interface DashboardHeaderProps {
	dashboard: IntensiveDashboardDTO;
	onRunAction: (action: IntensiveRecommendedAction) => void;
	onSelectTier?: (tier: CourseTier) => void;
	onNavigateTab?: (tab: IntensiveTab) => void;
}

export function DashboardHeader({
	dashboard,
	onRunAction,
	onSelectTier,
	onNavigateTab,
}: DashboardHeaderProps) {
	const t = useT();
	const { summary, tiers, pacingProjection, nextRecommendedActions, state } = dashboard;

	const primaryAction =
		nextRecommendedActions.find((a) => a.slot === "primary-course") ??
		nextRecommendedActions[0] ??
		null;
	const parallelAction =
		nextRecommendedActions.find((a) => a.slot === "daily-parallel") ?? null;

	const modeLabel =
		state.pacing.mode === "with-clt"
			? t("intensive.header.modeClt")
			: t("intensive.header.modeHome");

	const dailyFormatted = formatMinutesAsClock(pacingProjection.effectiveDailyDomainMinutes);
	const isPublicTemplate = dashboard.track.id === TEMPLATE_INTENSIVE_TRACK_ID;

	return (
		<section aria-label={t("intensive.header.coreProgress")} className="space-y-3.5">
			{/* Helpful customization hint shown ONLY on the public starter template */}
			{isPublicTemplate && (
				<div className="elec-surface flex items-start gap-3 border-l-4 border-l-[var(--elec-volt)] px-4 py-3 text-sm">
					<InfoIcon
						className="mt-0.5 size-4 shrink-0 text-[var(--elec-volt-text)]"
						aria-hidden="true"
					/>
					<div className="space-y-0.5">
						<p className="font-bold text-foreground">{t("intensive.template.bannerTitle")}</p>
						<p className="text-[13px] leading-relaxed text-muted-foreground">
							{t("intensive.template.bannerBody")}
						</p>
					</div>
				</div>
			)}

			{/* Compact Illustrated Workbench Stage (Nano Banana cel-shaded art, workspace-first height) */}
			<div className="elec-hero-stage">
				<div className="elec-banner-body">
					{/* Background art layer (right-aligned on desktop, crisp top frame on mobile) */}
					<div className="elec-hero-art-layer" aria-hidden="true">
						<img
							src="/intensive/electronics/hero-workbench.jpg"
							alt=""
							className="elec-hero-art-img"
						/>
						<div className="elec-hero-fade" />
					</div>

					{/* Left content column: crisp hierarchy, <=2 short lines + primary action */}
					<div className="relative z-10 flex flex-col justify-center gap-4 p-5 sm:p-6">
						<div className="max-w-[52ch] space-y-1.5">
							<h2 className="font-title text-xl leading-tight tracking-tight text-[var(--elec-banner-ink)] sm:text-2xl">
								{dashboard.track.subtitle}
							</h2>
							<p className="text-sm leading-relaxed text-[var(--elec-banner-muted)]">
								{dashboard.track.tagline}
							</p>
						</div>

						<div className="flex flex-wrap items-center gap-2.5">
							{primaryAction && (
								<button
									type="button"
									data-testid="intensive-primary-cta"
									onClick={() => onRunAction(primaryAction)}
									className={INTENSIVE_BTN_PRIMARY}
								>
									<PlayIcon className="size-4 shrink-0" aria-hidden="true" />
									<span className="truncate">{t("intensive.action.continueNext")}</span>
								</button>
							)}
							{parallelAction && (
								<button
									type="button"
									data-testid="intensive-parallel-cta"
									onClick={() => onRunAction(parallelAction)}
									className={INTENSIVE_BTN_ON_DARK}
								>
									<ArrowRightIcon className="size-4 shrink-0" aria-hidden="true" />
									<span className="truncate">{t("intensive.action.parallelDaily")}</span>
								</button>
							)}
						</div>
					</div>
				</div>

				{/* Quiet 1-line next-step proof bar */}
				{primaryAction && (
					<div className="relative z-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-white/12 bg-black/35 px-5 py-2.5 text-[13px] text-[var(--elec-banner-muted)] sm:px-6">
						<div className="flex min-w-0 items-center gap-2 truncate">
							<span className="shrink-0 font-semibold text-[var(--elec-volt)]">
								{t("intensive.header.nextUpLabel")}:
							</span>
							<span className="truncate font-semibold text-[var(--elec-banner-ink)]">
								{primaryAction.title}
							</span>
							{primaryAction.subtitle ? (
								<span className="hidden truncate text-[var(--elec-banner-muted)] md:inline">
									· {primaryAction.subtitle}
								</span>
							) : null}
						</div>
						{summary.mediaSummary.linkedCoursesCount > 0 && (
							<span className="shrink-0 tabular-nums text-[var(--elec-banner-muted)]">
								{t("intensive.header.localVideos", {
									watched: summary.mediaSummary.watchedVideosCount,
									total: Math.max(
										summary.mediaSummary.discoveredVideosCount,
										summary.mediaSummary.expectedVideosCount,
									),
									transcribed: summary.mediaSummary.transcribedVideosCount,
								})}
							</span>
						)}
					</div>
				)}
			</div>

			{/* Interactive Telemetry Bar — 4 clean hairline-divided columns, navigable by click */}
			<div className="elec-surface grid grid-cols-1 divide-y divide-border/55 overflow-hidden sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
				{/* 1. Core Progress + Interactive Tier 1–4 quick-filter bars */}
				<div className="space-y-2.5 p-4 sm:border-r sm:border-b sm:border-border/55 lg:border-r-0 lg:border-b-0">
					<div className="flex items-baseline justify-between gap-2">
						<span className="text-[13px] font-semibold text-muted-foreground">
							{t("intensive.header.coreProgress")}
						</span>
						<span className="text-xl font-bold tabular-nums text-foreground">
							{summary.coreCompletionPct}%
						</span>
					</div>
					<div
						className="elec-progress-track"
						role="progressbar"
						aria-valuenow={summary.coreCompletionPct}
						aria-valuemin={0}
						aria-valuemax={100}
						aria-label={t("intensive.header.coreProgress")}
					>
						<div
							className="elec-progress-fill bg-[var(--elec-volt)]"
							style={{
								width: `${Math.min(100, Math.max(0, summary.coreCompletionPct))}%`,
							}}
						/>
					</div>
					<p className="text-[13px] tabular-nums text-muted-foreground">
						{t("intensive.header.coreCourses", {
							completed: summary.coreCompletedCourses,
							total: summary.coreTotalCourses,
							hoursDone: formatHoursCompact(summary.coreCompletedHours),
							hoursTotal: formatHoursCompact(summary.coreTotalHours),
						})}
					</p>

					{/* Clickable Tier 1–4 quick jump micro-bars */}
					<div className="grid grid-cols-4 gap-2 pt-0.5">
						{tiers.map((tier) => {
							const isOnDemand = tier.spec.completionScope === "on-demand";
							return (
								<button
									key={tier.spec.id}
									type="button"
									onClick={() => onSelectTier?.(tier.spec.tier)}
									title={tier.spec.title}
									className="group space-y-1 rounded-md p-1 text-left transition-colors duration-150 hover:bg-accent/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--elec-volt)] cursor-pointer"
								>
									<div className="flex items-center justify-between text-[13px] tabular-nums">
										<span
											className={
												isOnDemand
													? "text-muted-foreground/75"
													: "font-semibold text-muted-foreground group-hover:text-foreground"
											}
										>
											T{tier.spec.tier}
										</span>
										<span
											className={
												isOnDemand
													? "text-muted-foreground/75"
													: "font-bold text-foreground"
											}
										>
											{Math.round(tier.metrics.percent)}%
										</span>
									</div>
									<div className="h-1 w-full overflow-hidden rounded-full bg-foreground/12">
										<div
											className={`h-full rounded-full ${
												isOnDemand ? "bg-muted-foreground/50" : "bg-[var(--elec-volt)]"
											}`}
											style={{
												width: `${Math.min(100, Math.max(0, tier.metrics.percent))}%`,
											}}
										/>
									</div>
								</button>
							);
						})}
					</div>
				</div>

				{/* 2. Certifications Core (click opens Certs tab) */}
				<button
					type="button"
					onClick={() => onNavigateTab?.("certs")}
					className="elec-telemetry-cell group flex flex-col justify-between space-y-2.5 p-4 text-left sm:border-b sm:border-border/55 lg:border-b-0 cursor-pointer"
				>
					<div className="space-y-2.5">
						<div className="flex items-baseline justify-between gap-2">
							<span className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground group-hover:text-foreground">
								{t("intensive.header.certsReadiness")}
								<ChevronRightIcon
									className="size-3.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
									aria-hidden="true"
								/>
							</span>
							<span className="text-xl font-bold tabular-nums text-foreground">
								{summary.certificationsCorePct}%
							</span>
						</div>
						<div
							className="elec-progress-track"
							role="progressbar"
							aria-valuenow={summary.certificationsCorePct}
							aria-valuemin={0}
							aria-valuemax={100}
							aria-label={t("intensive.header.certsReadiness")}
						>
							<div
								className="elec-progress-fill bg-[var(--elec-mint)]"
								style={{
									width: `${Math.min(100, Math.max(0, summary.certificationsCorePct))}%`,
								}}
							/>
						</div>
					</div>
					<p className="text-[13px] tabular-nums text-muted-foreground">
						{t("intensive.header.certsPassed", {
							passed: summary.certificationsCorePassedCount,
							total: summary.certificationsCoreTotalCount,
							weeks: pacingProjection.cetaEstimatedWeeks,
						})}
					</p>
				</button>

				{/* 3. Portfolio P1–P5 & Bench (click opens Portfolio tab) */}
				<button
					type="button"
					onClick={() => onNavigateTab?.("portfolio")}
					className="elec-telemetry-cell group flex flex-col justify-between space-y-2.5 p-4 text-left sm:border-r sm:border-border/55 lg:border-r-0 cursor-pointer"
				>
					<div className="space-y-2.5">
						<div className="flex items-baseline justify-between gap-2">
							<span className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground group-hover:text-foreground">
								{t("intensive.header.portfolioBench")}
								<ChevronRightIcon
									className="size-3.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
									aria-hidden="true"
								/>
							</span>
							<span className="text-xl font-bold tabular-nums text-foreground">
								{summary.portfolioPct}%
							</span>
						</div>
						<div
							className="elec-progress-track"
							role="progressbar"
							aria-valuenow={summary.portfolioPct}
							aria-valuemin={0}
							aria-valuemax={100}
							aria-label={t("intensive.header.portfolioBench")}
						>
							<div
								className="elec-progress-fill bg-[var(--elec-copper)]"
								style={{
									width: `${Math.min(100, Math.max(0, summary.portfolioPct))}%`,
								}}
							/>
						</div>
					</div>
					<p className="text-[13px] tabular-nums text-muted-foreground">
						{t("intensive.header.portfolioStats", {
							projects: summary.portfolioCompletedCount,
							total: summary.portfolioTotalCount,
							bench: summary.benchInterviewCheckedCount,
							benchTotal: summary.benchInterviewTotalCount,
						})}
					</p>
				</button>

				{/* 4. Active Pace & Realistic ETA (click opens Pacing tab) */}
				<button
					type="button"
					onClick={() => onNavigateTab?.("pacing")}
					className="elec-telemetry-cell group flex flex-col justify-between space-y-2 p-4 text-left cursor-pointer"
				>
					<div className="space-y-1.5">
						<div className="flex items-baseline justify-between gap-2">
							<span className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground group-hover:text-foreground">
								{t("intensive.header.pacingEta")}
								<ChevronRightIcon
									className="size-3.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
									aria-hidden="true"
								/>
							</span>
							<span className="text-[13px] font-bold text-[var(--elec-volt-text)]">
								{modeLabel}
							</span>
						</div>
						<p className="text-sm font-bold tabular-nums text-foreground">
							{t("intensive.header.pacingSummary", {
								daily: dailyFormatted,
								tier1Weeks: pacingProjection.tier1EstimatedWeeks,
								coreWeeks: pacingProjection.coreEstimatedWeeks,
							})}
						</p>
					</div>
					<p className="text-[13px] text-muted-foreground">
						{t("intensive.header.tier4Note")}
					</p>
				</button>
			</div>
		</section>
	);
}
