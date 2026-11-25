"use client";

/**
 * Profile — level, XP, tier per domain and light usage stats (estudos-sota
 * §2.10–2.11). Client-rendered so i18n locale switching stays reactive.
 */

import { useMemo } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/icon";
import { useI18n } from "@/components/i18n";
import type { IconName } from "@/components/icons/generated";
import type { StudyProfile, TranscriptChapterRow, TranscriptGradeLabel, Translator } from "@/src/core";

function hours(minutes: number): string {
	const min = Math.round(minutes);
	if (min < 60) return `${min} min`;
	return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}

function gradePillClass(grade: TranscriptGradeLabel): string {
	if (grade === "A") return "study-pill study-pill-success";
	if (grade === "B" || grade === "C") return "study-pill study-pill-info";
	if (grade === "Reforço") return "study-pill study-pill-warning";
	return "study-pill";
}

function chapterAvgExamScore(chapter: TranscriptChapterRow, scoreFmt: Intl.NumberFormat): string {
	const scores = chapter.modules
		.map((m) => m.examScore)
		.filter((s): s is number => typeof s === "number");
	if (scores.length === 0) return "—";
	const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length;
	return scoreFmt.format(avg);
}

function computeStudyStreak(days: readonly { minutes: number }[]): number {
	if (days.length === 0) return 0;
	let streak = 0;
	let i = days.length - 1;
	if ((days[i]?.minutes ?? 0) <= 0) i--;
	for (; i >= 0; i--) {
		if ((days[i]?.minutes ?? 0) > 0) streak++;
		else break;
	}
	return streak;
}

function formatCompact(
	n: number,
	t: Translator,
	intFmt: Intl.NumberFormat,
	decFmt: Intl.NumberFormat,
): string {
	if (n >= 1_000_000) return t("pages.profile.compactMillion", { value: decFmt.format(n / 1_000_000) });
	if (n >= 10_000) return t("pages.profile.compactThousand", { value: intFmt.format(Math.round(n / 1000)) });
	return intFmt.format(n);
}

export function ProfileView({ profile }: { profile: StudyProfile }) {
	const { t, intl } = useI18n();
	const intFmt = useMemo(() => new Intl.NumberFormat(intl), [intl]);
	const decFmt = useMemo(
		() => new Intl.NumberFormat(intl, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
		[intl],
	);

	const { account, domains, usage, days } = profile;
	const ringRadius = 33;
	const ringCircumference = 2 * Math.PI * ringRadius;
	const {
		maxDay,
		weekMin,
		periodMin,
		streakDays,
		levelPct,
		ringOffset,
		maxModelTokens,
		transcriptDomains,
	} = useMemo(() => {
		let maxD = 60;
		let totalPeriod = 0;
		let totalWeek = 0;
		const weekStart = Math.max(0, days.length - 7);
		for (let i = 0; i < days.length; i++) {
			const m = days[i]!.minutes;
			if (m > maxD) maxD = m;
			totalPeriod += m;
			if (i >= weekStart) totalWeek += m;
		}
		let maxTok = 1;
		for (const m of usage.byModel) {
			if (m.tokens > maxTok) maxTok = m.tokens;
		}
		return {
			maxDay: maxD,
			weekMin: totalWeek,
			periodMin: totalPeriod,
			streakDays: computeStudyStreak(days),
			levelPct: Math.round(account.fraction * 100),
			ringOffset: ringCircumference * (1 - Math.max(0, Math.min(1, account.fraction))),
			maxModelTokens: maxTok,
			transcriptDomains: domains.filter(
				(d): d is typeof d & { transcript: NonNullable<typeof d.transcript> } => Boolean(d.transcript),
			),
		};
	}, [days, usage.byModel, account.fraction, domains, ringCircumference]);

	return (
		<div className="mx-auto w-full max-w-4xl px-4 pb-16 pt-8 sm:pt-10">
			<header className="ta-hero mb-6">
				{/* eslint-disable-next-line @next/next/no-img-element */}
				<img src="/art/hero-profile.jpg" alt="" aria-hidden="true" className="ta-hero-img" />
				<div className="ta-hero-scrim" aria-hidden="true" />
				<div className="ta-hero-content space-y-5 px-5 pt-4 pb-5 sm:px-6 sm:pt-5">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<Link
							href="/"
							aria-label={t("pages.profile.back")}
							className="lh-no-drag inline-flex items-center gap-1 text-sm font-semibold text-[#b6c0cc] transition-colors hover:text-[#f4efe6] hover:underline"
						>
							<Icon name="chevron-left" size={18} tone={false} />
							{t("shell.sidebar.home")}
						</Link>
						<div className="flex flex-wrap items-center gap-2 text-xs tabular-nums">
							<span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-[#0d1117]/88 px-3 py-1 font-semibold text-[#f4efe6] backdrop-blur-xs">
								<span aria-hidden="true" className={`size-2 rounded-full ${streakDays > 0 ? "bg-[#ffb020]" : "bg-white/30"}`} />
								{t("pages.profile.streak", { days: String(streakDays) })}
							</span>
							<span className="rounded-full border border-white/20 bg-[#0d1117]/88 px-3 py-1 text-[#d2dae4] backdrop-blur-xs">
								{t("pages.profile.days7And14", { week: hours(weekMin), period: hours(periodMin) })}
							</span>
						</div>
					</div>

					<div className="flex flex-wrap items-center gap-5">
						<div className="relative flex size-22 shrink-0 items-center justify-center">
							<svg viewBox="0 0 76 76" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
								<circle
									cx="38"
									cy="38"
									r={ringRadius}
									fill="none"
									stroke="rgb(255 255 255 / 0.14)"
									strokeWidth="5.5"
								/>
								<circle
									cx="38"
									cy="38"
									r={ringRadius}
									fill="none"
									stroke="var(--cel-xp, #a98bff)"
									strokeWidth="5.5"
									strokeLinecap="round"
									strokeDasharray={ringCircumference}
									strokeDashoffset={ringOffset}
									className="profile-ring-progress"
								/>
							</svg>
							<div className="cel-display relative z-10 flex size-[62px] flex-col items-center justify-center rounded-full border border-white/12 bg-[#161c25] text-[#f4efe6]">
								<span className="text-[10px] font-semibold tracking-wider text-[#b6c0cc]">
									{t("pages.profile.level")}
								</span>
								<span className="text-2xl leading-none tabular-nums">{account.level}</span>
							</div>
						</div>

						<div className="min-w-52 max-w-lg flex-1 space-y-2.5">
							<h1 className="ta-hero-title text-2xl sm:text-3xl">{t("pages.profile.title")}</h1>
							<div className="flex flex-wrap items-baseline gap-2.5 text-sm">
								<span className="inline-flex items-center gap-1.5 text-[#f4efe6]">
									<Icon name="xp" size={18} />
									<span className="cel-display text-lg tabular-nums">{intFmt.format(account.xp)} XP</span>
								</span>
								<span className="text-xs text-[#b6c0cc] tabular-nums">
									{t("pages.profile.xpToNext", {
										pct: levelPct,
										xp: intFmt.format(account.xpToNext),
									})}
								</span>
							</div>
							<progress
								value={levelPct}
								max={100}
								aria-label={t("pages.profile.xpToNext", {
									pct: levelPct,
									xp: intFmt.format(account.xpToNext),
								})}
								className="ta-hero-progress ta-hero-progress-xp block w-full"
							/>
						</div>
					</div>
				</div>
			</header>

			<div className="mb-6 grid gap-4 sm:grid-cols-2">
				{domains.map((d) => {
					const pct = d.leaves > 0 ? Math.round((100 * d.attained) / d.leaves) : 0;
					return (
						<section key={d.id} data-domain={d.id} className="cel-card ta-domain-card flex flex-col justify-between overflow-hidden">
							<div className="space-y-3.5 p-4.5">
								<div className="flex items-center gap-3">
									<Icon name={d.icon as IconName} size={28} />
									<div className="min-w-0 flex-1">
										<h2 className="cel-display truncate text-lg leading-tight">{d.title}</h2>
										<p className="text-xs text-muted-foreground tabular-nums">
											{t("pages.profile.pathPct", {
												pct: d.attained > 0 && pct === 0 ? "<1" : String(pct),
											})}
										</p>
									</div>
									<span
										className="cel-chip shrink-0 text-xs"
										title={t("pages.profile.masteryPointsTitle", { pm: d.tier.pm })}
									>
										<Icon name="trophy" size={14} />
										{d.tier.label}
									</span>
								</div>
								<div>
									<div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
										<span>{t("pages.profile.retainedStages")}</span>
										<span className="font-semibold tabular-nums text-foreground/85">
											{t("pages.profile.masteryPointsShort", { pm: d.tier.pm })}
										</span>
									</div>
									<div className="flex gap-1.5" aria-label={t("pages.profile.retainedStages")}>
										{d.tier.fractions.map((f, i) => (
											<div
												key={i}
												className="h-2.5 flex-1 overflow-hidden rounded-full border border-border/55 bg-background/80"
												title={t("pages.profile.stageTooltip", {
													index: i + 1,
													pct: Math.round(f * 100),
												})}
											>
												<div
													className="h-full bg-[var(--cel-accent,var(--primary))] transition-[width] duration-200 ease-out"
													style={{ width: `${Math.round(f * 100)}%` }}
												/>
											</div>
										))}
									</div>
								</div>
							</div>
							<dl className="grid grid-cols-3 divide-x divide-border/50 border-t border-border/50 bg-background/45 py-2.5 text-center text-xs text-muted-foreground">
								<div className="px-1">
									<dt>{t("pages.profile.topics")}</dt>
									<dd className="cel-display mt-0.5 text-base text-foreground tabular-nums">
										{d.attained}/{d.leaves}
									</dd>
								</div>
								<div className="px-1">
									<dt>{t("pages.profile.domain")}</dt>
									<dd className="cel-display mt-0.5 text-base text-foreground tabular-nums">{d.mastered}</dd>
								</div>
								<div className="px-1">
									<dt>{t("pages.profile.xp")}</dt>
									<dd className="cel-display mt-0.5 text-base text-foreground tabular-nums">
										{intFmt.format(d.xp)}
									</dd>
								</div>
							</dl>
						</section>
					);
				})}
			</div>

			{transcriptDomains.length > 0 && (
				<section className="cel-card mb-5 p-5" aria-label={t("pages.profile.transcriptTitle")}>
					<div className="mb-4 flex flex-wrap items-center gap-2">
						<Icon name="stats" size={18} />
						<h2 className="cel-display text-lg">{t("pages.profile.transcriptTitle")}</h2>
					</div>
					<div className="space-y-6">
						{transcriptDomains.map((d) => {
							const { transcript } = d;
							const alerts = transcript.coolingAlerts.slice(0, 4);
							return (
								<div
									key={d.id}
									data-domain={d.id}
									className="study-cv-block space-y-3 border-t border-border/50 pt-4 first:border-t-0 first:pt-0"
								>
									<div className="flex flex-wrap items-center gap-2">
										<Icon name={d.icon as IconName} size={20} />
										<h3 className="cel-display text-base leading-tight">{d.title}</h3>
										<span className={gradePillClass(transcript.gradeLabel)}>{transcript.gradeLabel}</span>
										{transcript.avgRetention !== null && (
											<span className="text-xs text-muted-foreground tabular-nums">
												{t("pages.profile.retentionPct", {
													pct: Math.round(transcript.avgRetention * 100),
												})}
											</span>
										)}
										<Link
											href={`/ementa?dominio=${encodeURIComponent(d.id)}`}
											className="cel-button cel-button-ghost ml-auto min-h-7 px-2.5 py-0.5 text-xs"
										>
											<Icon name="book" size={13} tone={false} />
											{t("pages.profile.openSyllabus")}
										</Link>
									</div>

									{alerts.length > 0 && (
										<div className="rounded-xl border border-[var(--cel-warning,var(--border))]/45 bg-[color-mix(in_srgb,var(--cel-warning,var(--primary))_8%,var(--background))] px-3.5 py-2.5 text-xs">
											<div className="mb-1.5 flex items-center gap-1.5 font-semibold text-foreground">
												<Icon name="warning" size={14} />
												<span>{t("pages.profile.coolingModules")}</span>
											</div>
											<ul className="space-y-1.5">
												{alerts.map((alert) => (
													<li key={alert.moduleId} className="flex flex-wrap items-center gap-x-2 gap-y-1">
														<span className="study-pill study-pill-warning tabular-nums">
															{Math.round(alert.avgRetention * 100)}%
														</span>
														<span className="font-medium text-foreground">
															{alert.chapterLevel} · {alert.moduleTitle}
														</span>
														<Link
															href={`/mapa?dominio=${encodeURIComponent(d.id)}&no=${encodeURIComponent(alert.topNodeId)}`}
															className="ml-auto font-medium text-[var(--cel-link,var(--lh-accent))] underline underline-offset-2 hover:text-foreground"
														>
															{t("pages.profile.reviewNode", { title: alert.topNodeTitle })}
														</Link>
													</li>
												))}
											</ul>
										</div>
									)}

									<div className="overflow-x-auto">
										<table className="w-full text-sm tabular-nums">
											<thead className="text-left text-xs text-muted-foreground">
												<tr>
													<th className="pb-2 pr-3 font-semibold">{t("pages.profile.colChapter")}</th>
													<th className="px-2 pb-2 text-right font-semibold">{t("pages.profile.colReached")}</th>
													<th className="px-2 pb-2 text-right font-semibold">{t("pages.profile.colDurable")}</th>
													<th className="px-2 pb-2 text-right font-semibold">{t("pages.profile.colMastered")}</th>
													<th className="px-2 pb-2 text-right font-semibold">{t("pages.profile.colFsrs")}</th>
													<th className="px-2 pb-2 text-right font-semibold">{t("pages.profile.colExam")}</th>
													<th className="pb-2 pl-2 text-right font-semibold">{t("pages.profile.colGrade")}</th>
												</tr>
											</thead>
											<tbody>
												{transcript.chapters.map((ch) => (
													<tr
														key={`${ch.index}-${ch.level}`}
														className="border-t border-border/50 transition-colors hover:bg-accent/40"
													>
														<td className="min-w-40 py-2 pr-3">
															<span className="font-semibold text-foreground">{ch.level}</span>
															<span className="block text-xs text-muted-foreground">{ch.title}</span>
														</td>
														<td className="px-2 py-2 text-right text-muted-foreground">
															{ch.attained}/{ch.total}
														</td>
														<td className="px-2 py-2 text-right font-semibold text-foreground">{ch.durable}</td>
														<td className="px-2 py-2 text-right text-muted-foreground">{ch.mastered}</td>
														<td className="px-2 py-2 text-right text-muted-foreground">
															{ch.avgRetention !== null ? `${Math.round(ch.avgRetention * 100)}%` : "—"}
														</td>
														<td className="px-2 py-2 text-right text-muted-foreground">
															{chapterAvgExamScore(ch, decFmt)}
														</td>
														<td className="py-2 pl-2 text-right">
															<span className={gradePillClass(ch.gradeLabel)}>{ch.gradeLabel}</span>
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</div>
							);
						})}
					</div>
				</section>
			)}

			<section className="cel-card mb-5 p-5">
				<div className="mb-3.5 flex flex-wrap items-center gap-2">
					<div className="flex items-center gap-2">
						<Icon name="clock" size={18} />
						<h2 className="cel-display text-lg">{t("pages.profile.studyTime")}</h2>
					</div>
					<span className={`study-pill tabular-nums ${streakDays > 0 ? "study-pill-warning" : ""}`}>
						{t("pages.profile.streak", { days: String(streakDays) })}
					</span>
					<span className="ml-auto text-xs text-muted-foreground tabular-nums">
						{t("pages.profile.days7And14", { week: hours(weekMin), period: hours(periodMin) })}
					</span>
				</div>
				<div className="flex h-32 items-end gap-1.5 border-b border-dashed border-border/60 pb-2">
					{days.map((d, index) => {
						const isToday = index === days.length - 1;
						const barHeight = d.minutes > 0 ? Math.max(6, Math.round((d.minutes / maxDay) * 86)) : 3;
						return (
							<div
								key={d.day}
								className="group flex flex-1 flex-col items-center gap-1"
								title={`${d.day}: ${hours(d.minutes)}`}
							>
								<span className="text-[10px] font-semibold tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
									{d.minutes > 0 ? `${Math.round(d.minutes)}m` : ""}
								</span>
								<div
									className={`w-full rounded-t-md border border-b-0 border-black/15 transition-[opacity,filter,transform] duration-150 ease-out group-hover:-translate-y-0.5 group-hover:brightness-110 ${isToday ? "bg-[var(--cel-accent,var(--primary))] ring-2 ring-[var(--cel-accent,var(--primary))]/35" : "bg-[var(--cel-accent,var(--primary))]"}`}
									style={{ height: `${barHeight}px`, opacity: d.minutes > 0 ? (isToday ? 1 : 0.78) : 0.2 }}
								/>
								<span
									className={
										"text-[11px] tabular-nums " +
										(isToday ? "font-bold text-foreground" : "text-muted-foreground")
									}
								>
									{d.day.slice(8)}
								</span>
							</div>
						);
					})}
				</div>
			</section>

			<section className="cel-card p-5">
				<div className="mb-3 flex flex-wrap items-baseline gap-2">
					<div className="flex items-center gap-2">
						<Icon name="tokens" size={18} />
						<h2 className="cel-display text-lg">{t("pages.profile.tokens")}</h2>
					</div>
					<span className="ml-auto text-xs text-muted-foreground tabular-nums">
						{t("pages.profile.tokensSummary", {
							tokens: formatCompact(usage.totalTokens, t, intFmt, decFmt),
							count: usage.calls,
						})}
					</span>
				</div>
				{usage.byModel.length === 0 ? (
					<p className="text-sm text-muted-foreground">{t("pages.profile.noUsage")}</p>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-sm tabular-nums">
							<thead className="text-left text-xs text-muted-foreground">
								<tr>
									<th className="pb-2 pr-3 font-semibold">{t("pages.profile.colModel")}</th>
									<th className="px-2 pb-2 text-right font-semibold">{t("pages.profile.colInput")}</th>
									<th className="px-2 pb-2 text-right font-semibold">{t("pages.profile.colOutput")}</th>
									<th className="px-2 pb-2 text-right font-semibold">{t("pages.profile.colCache")}</th>
									<th className="pb-2 pl-2 text-right font-semibold">{t("pages.profile.colTotal")}</th>
								</tr>
							</thead>
							<tbody>
								{usage.byModel.map((m) => (
									<tr
										key={m.model}
										className="border-t border-border/50 transition-colors hover:bg-accent/40"
									>
										<td className="max-w-52 py-2 pr-3">
											<span className="block truncate font-mono text-xs">{m.model}</span>
											<span
												className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-border/35"
												aria-hidden="true"
											>
												<span
													className="block h-full rounded-full bg-[var(--cel-accent,var(--primary))]"
													style={{ width: `${Math.max(4, Math.round((m.tokens / maxModelTokens) * 100))}%` }}
												/>
											</span>
										</td>
										<td className="px-2 py-2 text-right text-muted-foreground">
											{formatCompact(m.input, t, intFmt, decFmt)}
										</td>
										<td className="px-2 py-2 text-right text-muted-foreground">
											{formatCompact(m.output, t, intFmt, decFmt)}
										</td>
										<td className="px-2 py-2 text-right text-muted-foreground">
											{formatCompact(m.cached, t, intFmt, decFmt)}
										</td>
										<td className="cel-display py-2 pl-2 text-right">
											{formatCompact(m.tokens, t, intFmt, decFmt)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</div>
	);
}
