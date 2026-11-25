"use client";

import { useState } from "react";
import {
	AlertTriangleIcon,
	BotIcon,
	CheckCircle2Icon,
	ChevronDownIcon,
	ExternalLinkIcon,
	ShieldAlertIcon,
	WrenchIcon,
} from "lucide-react";
import type {
	IntensiveDashboardDTO,
	IntensivePortfolioProjectView,
	PortfolioProjectStatus,
} from "@/src/core";
import { useT } from "@/components/i18n";
import {
	INTENSIVE_BTN_COMPACT,
	INTENSIVE_BTN_PRIMARY,
	INTENSIVE_INPUT,
	INTENSIVE_SELECT_AUTO,
	intensiveArtSet,
	type IntensiveMutation,
} from "./tutor-launch.ts";

interface PortfolioBenchPanelProps {
	dashboard: IntensiveDashboardDTO;
	highlightedProjectId?: string;
	onMutate: (mutation: IntensiveMutation) => Promise<void>;
	onOpenCourse: (courseId: string) => void;
	onAskProjectTutor: (project: IntensivePortfolioProjectView) => void;
	onAskBenchTutor: () => void;
	busyKey: string | null;
}

const PROJECT_STATUSES: readonly PortfolioProjectStatus[] = [
	"not-started",
	"in-progress",
	"completed",
];

function projectStatusLabel(
	status: PortfolioProjectStatus,
	t: ReturnType<typeof useT>,
): string {
	switch (status) {
		case "in-progress":
			return t("intensive.portfolio.statusInProgress");
		case "completed":
			return t("intensive.portfolio.statusCompleted");
		default:
			return t("intensive.portfolio.statusNotStarted");
	}
}

export function PortfolioBenchPanel({
	dashboard,
	highlightedProjectId,
	onMutate,
	onOpenCourse,
	onAskProjectTutor,
	onAskBenchTutor,
	busyKey,
}: PortfolioBenchPanelProps) {
	const t = useT();
	const [projectDrafts, setProjectDrafts] = useState<
		Record<string, { repoUrl: string; notes: string }>
	>({});
	const [savedProjectId, setSavedProjectId] = useState<string | null>(null);
	const [expandedRepo, setExpandedRepo] = useState<Record<string, boolean>>({});

	const getProjectDraft = (project: IntensivePortfolioProjectView) => {
		return (
			projectDrafts[project.spec.id] ?? {
				repoUrl: project.state.repoUrl ?? "",
				notes: project.state.notes ?? "",
			}
		);
	};

	const patchProjectDraft = (
		project: IntensivePortfolioProjectView,
		patch: Partial<{ repoUrl: string; notes: string }>,
	) => {
		const current = getProjectDraft(project);
		setProjectDrafts((prev) => ({
			...prev,
			[project.spec.id]: { ...current, ...patch },
		}));
		if (savedProjectId === project.spec.id) setSavedProjectId(null);
	};

	const benchKitAcquireItems = dashboard.track.benchKit.items.filter(
		(i) => i.phase !== "anti-goal",
	);
	const benchKitAntiGoals = dashboard.track.benchKit.items.filter(
		(i) => i.phase === "anti-goal",
	);
	const ownedCount = benchKitAcquireItems.filter((i) =>
		Boolean(dashboard.state.benchKitOwned[i.id]),
	).length;

	return (
		<div className="space-y-8">
			{/* 1. Illustrated Bench Banner + The 10-Second Rule */}
			<section aria-labelledby="rule-10s-heading" className="space-y-4">
				<div className="elec-editorial-banner">
					<div className="elec-banner-body-compact">
						<div className="elec-hero-art-layer" aria-hidden="true">
							<img
								src={intensiveArtSet(dashboard.track.domainId).portfolio}
								alt=""
								className="elec-hero-art-img"
							/>
							<div className="elec-hero-fade" />
						</div>

						<div className="relative z-10 flex flex-col justify-center gap-3 p-5 sm:p-6">
							<div className="max-w-[54ch] space-y-1.5">
								<h2
									id="rule-10s-heading"
									className="font-title text-xl tracking-tight text-[var(--elec-banner-ink)] sm:text-2xl"
								>
									{t("intensive.portfolio.rule10sTitle")}
								</h2>
								<p className="text-sm leading-relaxed text-[var(--elec-banner-muted)]">
									{t("intensive.portfolio.rule10sSubtitle")}
								</p>
							</div>
							<div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[13px] tabular-nums text-[var(--elec-banner-muted)]">
								<span>
									<strong className="text-base text-[var(--elec-volt)]">
										{dashboard.portfolioMetrics.completedProjectsCount}/
										{dashboard.portfolioMetrics.totalProjectsCount}
									</strong>{" "}
									{t("intensive.portfolio.projectsTitle")}
								</span>
								<span>
									<strong className="text-base text-[var(--elec-mint)]">
										{dashboard.summary.benchInterviewCheckedCount}/
										{dashboard.summary.benchInterviewTotalCount}
									</strong>{" "}
									{t("intensive.portfolio.interviewTitle")}
								</span>
							</div>
						</div>
					</div>
				</div>

				<div className="elec-surface grid grid-cols-1 divide-y divide-border/55 overflow-hidden lg:grid-cols-[minmax(0,1.6fr)_minmax(260px,1fr)] lg:divide-x lg:divide-y-0">
					<ol className="divide-y divide-border/45 p-5">
						{dashboard.track.tenSecondRule.criteria.map((criterion) => (
							<li
								key={criterion.id}
								className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0"
							>
								<span className="mt-0.5 shrink-0 text-sm font-bold tabular-nums text-[var(--elec-volt-text)]">
									{criterion.order}.
								</span>
								<div className="min-w-0 space-y-0.5">
									<p className="text-sm font-bold text-foreground">{criterion.title}</p>
									<p className="text-sm text-muted-foreground">{criterion.description}</p>
								</div>
							</li>
						))}
					</ol>

					<div className="space-y-2.5 bg-background/40 p-5">
						<h3 className="text-sm font-bold text-[var(--cel-warning-text,var(--lh-warning))]">
							{t("intensive.portfolio.ignoredTitle")}
						</h3>
						<ul className="space-y-2 text-sm text-muted-foreground">
							{dashboard.track.tenSecondRule.ignoredByManagers.map((item) => (
								<li key={item} className="flex items-start gap-2">
									<span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--cel-warning,var(--lh-warning))]" />
									<span>{item}</span>
								</li>
							))}
						</ul>
					</div>
				</div>
			</section>

			{/* 2. Physical Portfolio Projects (P1–P5) */}
			<section aria-labelledby="portfolio-projects-heading" className="space-y-4">
				<div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-2.5">
					<h2
						id="portfolio-projects-heading"
						className="font-title text-lg tracking-tight text-foreground sm:text-xl"
					>
						{t("intensive.portfolio.projectsTitle")}
					</h2>
					<span className="text-sm font-bold tabular-nums text-muted-foreground">
						{dashboard.portfolioMetrics.completedProjectsCount}/
						{dashboard.portfolioMetrics.totalProjectsCount} ({dashboard.portfolioMetrics.percent}%)
					</span>
				</div>

				<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
					{dashboard.portfolioProjects.map((project) => {
						const draft = getProjectDraft(project);
						const isHighlighted = highlightedProjectId === project.spec.id;
						const isDone = project.state.status === "completed";
						const hasRepoRecord = Boolean(
							project.state.repoUrl?.trim() || project.state.notes?.trim(),
						);
						const repoOpen =
							expandedRepo[project.spec.id] ?? (isHighlighted || hasRepoRecord);

						return (
							<article
								key={project.spec.id}
								id={`project-${project.spec.id}`}
								data-testid={`portfolio-card-${project.spec.id}`}
								className={`elec-surface flex flex-col justify-between overflow-hidden ${
									isHighlighted ? "elec-course-recommended" : ""
								}`}
							>
								<div className="space-y-4 p-4 sm:p-5">
									{/* Header: clean typographic hierarchy */}
									<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
										<div className="min-w-0 space-y-1">
											<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] tabular-nums">
												<span className="font-bold text-[var(--elec-volt-text)]">
													{project.spec.code}
												</span>
												<span className="text-border" aria-hidden="true">
													·
												</span>
												<span className="font-medium text-muted-foreground">
													{project.spec.monthTarget}
												</span>
												<span className="text-border" aria-hidden="true">
													·
												</span>
												<span className="font-medium text-muted-foreground">
													{project.spec.budgetDisplay}
												</span>
											</div>
											<h3 className="text-base font-bold leading-snug text-foreground">
												{project.spec.title}
											</h3>
										</div>

										<select
											aria-label={project.spec.code}
											value={project.state.status}
											onChange={(e) => {
												void onMutate({
													kind: "update-portfolio",
													projectId: project.spec.id,
													status: e.target.value as PortfolioProjectStatus,
												});
											}}
											className={`${INTENSIVE_SELECT_AUTO} min-h-9 shrink-0 text-[13px] font-semibold`}
										>
											{PROJECT_STATUSES.map((st) => (
												<option key={st} value={st}>
													{projectStatusLabel(st, t)}
												</option>
											))}
										</select>
									</div>

									<p className="text-sm leading-relaxed text-muted-foreground">
										{project.spec.summary}
									</p>

									{/* Progress bar */}
									<div className="space-y-1.5">
										<div className="flex items-center justify-between text-[13px] tabular-nums">
											<span className="font-semibold text-foreground">
												{t("intensive.portfolio.deliverables", {
													done: project.metrics.completedDeliverablesCount,
													total: project.metrics.totalDeliverablesCount,
												})}
											</span>
											<span className="font-bold text-foreground">
												{project.metrics.percent}%
											</span>
										</div>
										<div className="elec-progress-track">
											<div
												className={`elec-progress-fill ${
													isDone ? "bg-[var(--elec-mint)]" : "bg-[var(--elec-copper)]"
												}`}
												style={{
													width: `${Math.min(100, Math.max(0, project.metrics.percent))}%`,
												}}
											/>
										</div>
									</div>

									{/* Deliverables checklist */}
									<ul className="space-y-1.5">
										{project.spec.deliverables.map((del) => {
											const checked = Boolean(project.state.completedDeliverables[del.id]);
											return (
												<li key={del.id}>
													<label className="flex cursor-pointer items-start gap-2.5 text-sm leading-snug">
														<input
															type="checkbox"
															checked={checked}
															onChange={(e) => {
																void onMutate({
																	kind: "toggle-portfolio-deliverable",
																	projectId: project.spec.id,
																	deliverableId: del.id,
																	completed: e.target.checked,
																});
															}}
															className="mt-0.5 size-4 shrink-0 accent-[var(--elec-volt)]"
														/>
														<span
															className={
																checked ? "text-muted-foreground line-through" : "text-foreground"
															}
														>
															{del.label}
														</span>
													</label>
												</li>
											);
										})}
									</ul>

									{/* Outcomes */}
									{project.spec.unlocks.length > 0 && (
										<div className="border-t border-border/45 pt-3 text-[13px]">
											<span className="font-semibold text-foreground">
												{t("intensive.portfolio.outcomesLabel")}:{" "}
											</span>
											<span className="text-muted-foreground">
												{project.spec.unlocks.join(" · ")}
											</span>
										</div>
									)}

									{/* Progressive Disclosure: Repo URL & Bring-Up Notes */}
									<div className="border-t border-border/45 pt-2.5">
										<button
											type="button"
											aria-expanded={repoOpen}
											onClick={() =>
												setExpandedRepo((prev) => ({
													...prev,
													[project.spec.id]: !repoOpen,
												}))
											}
											className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground transition-colors duration-150 hover:text-foreground cursor-pointer"
										>
											<ChevronDownIcon
												className={`size-4 transition-transform duration-150 ${
													repoOpen ? "rotate-180" : ""
												}`}
												aria-hidden="true"
											/>
											{repoOpen
												? t("intensive.portfolio.hideRepoNotes")
												: t("intensive.portfolio.toggleRepoNotes")}
										</button>

										{repoOpen && (
											<div className="mt-3 space-y-2.5">
												<div className="space-y-1">
													<label
														htmlFor={`repo-${project.spec.id}`}
														className="block text-[13px] font-medium text-muted-foreground"
													>
														{t("intensive.portfolio.repoUrlLabel")}
													</label>
													<div className="flex gap-2">
														<input
															id={`repo-${project.spec.id}`}
															type="url"
															value={draft.repoUrl}
															onChange={(e) =>
																patchProjectDraft(project, { repoUrl: e.target.value })
															}
															placeholder={t("intensive.portfolio.repoUrlPlaceholder")}
															className={`${INTENSIVE_INPUT} min-h-9`}
														/>
														{draft.repoUrl.trim() && (
															<a
																href={draft.repoUrl.trim()}
																target="_blank"
																rel="noopener noreferrer"
																className={`${INTENSIVE_BTN_COMPACT} shrink-0`}
																aria-label={t("intensive.portfolio.repoUrlLabel")}
															>
																<ExternalLinkIcon className="size-3.5" aria-hidden="true" />
															</a>
														)}
													</div>
												</div>

												<textarea
													rows={2}
													value={draft.notes}
													onChange={(e) =>
														patchProjectDraft(project, { notes: e.target.value })
													}
													placeholder={t("intensive.portfolio.notesPlaceholder")}
													className={INTENSIVE_INPUT}
												/>

												<div className="flex items-center gap-2.5">
													<button
														type="button"
														onClick={async () => {
															await onMutate({
																kind: "update-portfolio",
																projectId: project.spec.id,
																repoUrl: draft.repoUrl.trim() || undefined,
																notes: draft.notes,
															});
															setSavedProjectId(project.spec.id);
														}}
														className={INTENSIVE_BTN_COMPACT}
													>
														{t("intensive.action.save")}
													</button>
													{savedProjectId === project.spec.id && (
														<span className="text-[13px] font-semibold text-[var(--elec-mint-text)]">
															{t("intensive.action.saved")}
														</span>
													)}
												</div>
											</div>
										)}
									</div>
								</div>

								{/* Footer */}
								<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 bg-background/40 px-4 py-3 sm:px-5">
									<button
										type="button"
										disabled={busyKey === `tutor:project:${project.spec.id}`}
										onClick={() => onAskProjectTutor(project)}
										className={INTENSIVE_BTN_COMPACT}
									>
										<BotIcon className="size-3.5 shrink-0" aria-hidden="true" />
										{t("intensive.portfolio.reviewTutor")}
									</button>

									<div className="flex flex-wrap items-center gap-1.5">
										{project.spec.linkedCourseIds.map((cid) => {
											const c = dashboard.coursesById[cid];
											if (!c) return null;
											return (
												<button
													key={cid}
													type="button"
													onClick={() => onOpenCourse(cid)}
													className="rounded-md px-2 py-0.5 text-[13px] font-bold tabular-nums text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground cursor-pointer"
													title={c.spec.title}
												>
													#{c.spec.rank}
												</button>
											);
										})}
									</div>
								</div>
							</article>
						);
					})}
				</div>
			</section>

			{/* 3. Physical Bench Kit Roadmap + FNIRSI 1014D Anti-Goal */}
			<section aria-labelledby="bench-kit-heading" className="elec-surface overflow-hidden">
				<div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/55 px-5 py-4">
					<div className="flex items-center gap-2">
						<WrenchIcon
							className="size-5 shrink-0 text-[var(--elec-volt-text)]"
							aria-hidden="true"
						/>
						<h2 id="bench-kit-heading" className="font-title text-lg text-foreground">
							{t("intensive.portfolio.benchKitTitle")}
						</h2>
					</div>
					<span className="text-sm font-bold tabular-nums text-muted-foreground">
						{t("intensive.portfolio.benchKitOwned", {
							owned: ownedCount,
							total: benchKitAcquireItems.length,
						})}
					</span>
				</div>

				<div className="space-y-4 p-5">
					<div className="grid grid-cols-1 gap-3 border-b border-border/50 pb-4 text-sm md:grid-cols-3">
						<p className="text-foreground">{dashboard.track.benchKit.enxutoSummary}</p>
						<p className="text-foreground">{dashboard.track.benchKit.upgradeSummary}</p>
						<p className="text-muted-foreground">{dashboard.track.benchKit.legalNote}</p>
					</div>

					{/* Owned checklist for kit-enxuto + upgrade-lab */}
					<div className="divide-y divide-border/45">
						{benchKitAcquireItems.map((item) => {
							const owned = Boolean(dashboard.state.benchKitOwned[item.id]);
							const phaseLabel =
								item.phase === "kit-enxuto"
									? t("intensive.portfolio.phaseEnxuto")
									: t("intensive.portfolio.phaseUpgrade");
							return (
								<label
									key={item.id}
									className="flex cursor-pointer flex-col gap-1.5 py-3 first:pt-0 sm:flex-row sm:items-start sm:justify-between"
								>
									<div className="flex items-start gap-3">
										<input
											type="checkbox"
											checked={owned}
											onChange={(e) => {
												void onMutate({
													kind: "toggle-bench-kit",
													itemId: item.id,
													owned: e.target.checked,
												});
											}}
											className="mt-1 size-4 shrink-0 accent-[var(--elec-volt)]"
										/>
										<div className="space-y-0.5">
											<div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
												<span
													className={`text-sm font-bold ${
														owned ? "text-muted-foreground line-through" : "text-foreground"
													}`}
												>
													{item.name}
												</span>
												<span className="text-[13px] font-medium text-muted-foreground">
													· {phaseLabel}
												</span>
											</div>
											<p className="text-[13px] text-muted-foreground">{item.notes}</p>
										</div>
									</div>
									<span className="shrink-0 pl-7 text-[13px] font-bold tabular-nums text-foreground sm:pl-0">
										{item.costDisplay}
									</span>
								</label>
							);
						})}
					</div>

					{/* Anti-goal callout (FNIRSI 1014D) */}
					{benchKitAntiGoals.map((anti) => (
						<div
							key={anti.id}
							className="flex items-start gap-3 rounded-xl border-l-4 border-error bg-error/8 p-4"
						>
							<AlertTriangleIcon
								className="mt-0.5 size-5 shrink-0 text-error"
								aria-hidden="true"
							/>
							<div className="space-y-0.5 text-sm">
								<p className="font-bold text-foreground">
									<span className="text-error">{t("intensive.portfolio.phaseAntiGoal")} · </span>
									{anti.name}
								</p>
								<p className="text-muted-foreground">{anti.notes}</p>
							</div>
						</div>
					))}

					<p className="border-t border-border/45 pt-3 text-[13px] leading-relaxed text-muted-foreground">
						{dashboard.track.benchKit.paybackNote}
					</p>
				</div>
			</section>

			{/* 4. 6-Item Eliminatory Interview Bench Test Checklist */}
			<section aria-labelledby="bench-interview-heading" className="elec-surface overflow-hidden">
				<div className="flex flex-col gap-3 border-b border-border/55 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
					<div className="flex items-center gap-2.5">
						<ShieldAlertIcon
							className="size-5 shrink-0 text-[var(--elec-volt-text)]"
							aria-hidden="true"
						/>
						<div>
							<h2 id="bench-interview-heading" className="font-title text-lg text-foreground">
								{t("intensive.portfolio.interviewTitle")}
							</h2>
							<p className="text-[13px] tabular-nums text-muted-foreground">
								{t("intensive.portfolio.interviewStats", {
									checked: dashboard.summary.benchInterviewCheckedCount,
									total: dashboard.summary.benchInterviewTotalCount,
								})}{" "}
								({dashboard.summary.benchInterviewPct}%)
							</p>
						</div>
					</div>

					<button
						type="button"
						disabled={busyKey === "tutor:bench-interview"}
						onClick={onAskBenchTutor}
						className={INTENSIVE_BTN_PRIMARY}
					>
						<BotIcon className="size-4 shrink-0" aria-hidden="true" />
						{t("intensive.portfolio.simulateBenchTutor")}
					</button>
				</div>

				<div className="divide-y divide-border/45 px-5 py-2">
					{dashboard.track.benchInterviewChecklist.map((item) => {
						const checked = Boolean(dashboard.state.benchInterviewChecked[item.id]);
						return (
							<label
								key={item.id}
								className="flex cursor-pointer items-start gap-3 py-3.5"
							>
								<input
									type="checkbox"
									checked={checked}
									onChange={(e) => {
										void onMutate({
											kind: "toggle-bench-interview",
											itemId: item.id,
											checked: e.target.checked,
										});
									}}
									className="mt-1 size-4 shrink-0 accent-[var(--elec-volt)]"
								/>
								<div className="min-w-0 flex-1 space-y-1">
									<div className="flex flex-wrap items-center gap-2">
										<span className="text-[13px] font-bold tabular-nums text-[var(--elec-volt-text)]">
											#{item.order}
										</span>
										<span
											className={`text-sm font-bold ${
												checked ? "text-muted-foreground line-through" : "text-foreground"
											}`}
										>
											{item.title}
										</span>
										{item.eliminatory && (
											<span className="text-[13px] font-bold text-error">
												· {t("intensive.portfolio.eliminatory")}
											</span>
										)}
										{checked && (
											<CheckCircle2Icon
												className="size-4 text-[var(--elec-mint-text)]"
												aria-hidden="true"
											/>
										)}
									</div>
									<p className="max-w-[65ch] text-sm text-muted-foreground">
										{item.requirement}
									</p>
								</div>
							</label>
						);
					})}
				</div>
			</section>
		</div>
	);
}
