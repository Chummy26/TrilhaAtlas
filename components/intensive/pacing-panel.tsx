"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
	AlertTriangleIcon,
	BriefcaseIcon,
	CalendarIcon,
	CheckCircle2Icon,
	ClockIcon,
	ShieldCheckIcon,
} from "lucide-react";
import {
	getDefaultPacingSettings,
	type IntensiveDashboardDTO,
	type PacingMode,
} from "@/src/core";
import { useT } from "@/components/i18n";
import {
	formatHoursCompact,
	formatMinutesAsClock,
	formatVerifiedDate,
	INTENSIVE_BTN_PRIMARY,
	INTENSIVE_INPUT,
	type IntensiveMutation,
} from "./tutor-launch.ts";

interface PacingPanelProps {
	dashboard: IntensiveDashboardDTO;
	onMutate: (mutation: IntensiveMutation) => Promise<void>;
	busyKey: string | null;
}

export function PacingPanel({ dashboard, onMutate, busyKey }: PacingPanelProps) {
	const t = useT();
	const { state, track, pacingProjection } = dashboard;
	const [mode, setMode] = useState<PacingMode>(state.pacing.mode);
	const [dailyElectronics, setDailyElectronics] = useState(state.pacing.dailyElectronicsMinutes);
	const [dailyLanguage, setDailyLanguage] = useState(state.pacing.dailyLanguageMinutes);
	const [dailyCta, setDailyCta] = useState(state.pacing.dailyCtaMinutes);
	const [passiveCap, setPassiveCap] = useState(state.pacing.passiveVideoCapMinutes);
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		setMode(state.pacing.mode);
		setDailyElectronics(state.pacing.dailyElectronicsMinutes);
		setDailyLanguage(state.pacing.dailyLanguageMinutes);
		setDailyCta(state.pacing.dailyCtaMinutes);
		setPassiveCap(state.pacing.passiveVideoCapMinutes);
	}, [state.pacing]);

	const handleSelectMode = async (nextMode: PacingMode) => {
		const defaults = getDefaultPacingSettings(nextMode, track);
		setMode(nextMode);
		setDailyElectronics(defaults.dailyElectronicsMinutes);
		setDailyLanguage(defaults.dailyLanguageMinutes);
		setDailyCta(defaults.dailyCtaMinutes);
		setPassiveCap(defaults.passiveVideoCapMinutes);
		setSaved(false);
		await onMutate({
			kind: "set-pacing",
			pacing: defaults,
		});
		setSaved(true);
	};

	const handleSaveBudgets = async (e: FormEvent) => {
		e.preventDefault();
		await onMutate({
			kind: "set-pacing",
			pacing: {
				mode,
				dailyElectronicsMinutes: dailyElectronics,
				dailyLanguageMinutes: dailyLanguage,
				dailyCtaMinutes: dailyCta,
				passiveVideoCapMinutes: passiveCap,
			},
		});
		setSaved(true);
	};

	const profiles = [track.pacingProfiles["full-time-home"], track.pacingProfiles["with-clt"]];

	// Live visual breakdown of daily minutes (Core electronics excluding CTA, CTA parallel, Language)
	const safeElec = Math.max(0, Number.isFinite(dailyElectronics) ? dailyElectronics : 0);
	const safeCta = Math.min(safeElec, Math.max(0, Number.isFinite(dailyCta) ? dailyCta : 0));
	const coreElecOnly = Math.max(0, safeElec - safeCta);
	const safeLang = Math.max(0, Number.isFinite(dailyLanguage) ? dailyLanguage : 0);
	const totalDailyMinutes = Math.max(1, coreElecOnly + safeCta + safeLang);
	const corePct = Math.round((coreElecOnly / totalDailyMinutes) * 100);
	const ctaPct = Math.round((safeCta / totalDailyMinutes) * 100);
	const langPct = Math.max(0, 100 - corePct - ctaPct);

	return (
		<div className="space-y-8">
			{/* 1. Mode Switcher (Em casa vs Com CLT) */}
			<section aria-labelledby="pacing-mode-heading" className="space-y-3.5">
				<div>
					<h2 id="pacing-mode-heading" className="font-title text-lg text-foreground sm:text-xl">
						{t("intensive.pacing.modeTitle")}
					</h2>
					<p className="text-sm text-muted-foreground">{t("intensive.pacing.modeSubtitle")}</p>
				</div>

				<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
					{profiles.map((profile) => {
						const active = mode === profile.mode;
						return (
							<button
								key={profile.mode}
								type="button"
								aria-pressed={active}
								disabled={busyKey === "set-pacing"}
								onClick={() => void handleSelectMode(profile.mode)}
								className={`elec-surface elec-surface-interactive flex flex-col gap-2 p-5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--elec-volt)] cursor-pointer ${
									active ? "elec-course-recommended" : ""
								}`}
							>
								<div className="flex items-baseline justify-between gap-2">
									<span className="text-base font-bold text-foreground">{profile.label}</span>
									<span className="text-[13px] font-bold tabular-nums text-[var(--elec-volt-text)]">
										{formatMinutesAsClock(profile.dailyDomainMinutesMin)}–
										{formatMinutesAsClock(profile.dailyDomainMinutesMax)}/dia
									</span>
								</div>
								<p className="text-sm leading-relaxed text-muted-foreground">
									{profile.summary}
								</p>
								<p className="text-[13px] font-semibold text-foreground">
									{profile.theoryToPracticeRatio}
								</p>
							</button>
						);
					})}
				</div>
			</section>

			{/* 2. Daily Budget Controls + Live Breakdown Bar + Realistic ETA Projections */}
			<div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
				<form
					onSubmit={handleSaveBudgets}
					className="elec-surface space-y-5 p-5"
				>
					<div className="flex items-center justify-between gap-2">
						<div className="flex items-center gap-2">
							<ClockIcon
								className="size-4 shrink-0 text-[var(--elec-volt-text)]"
								aria-hidden="true"
							/>
							<h3 className="text-base font-bold text-foreground">
								{t("intensive.pacing.budgetsTitle")}
							</h3>
						</div>
						<span className="text-[13px] font-bold tabular-nums text-[var(--elec-volt-text)]">
							{t("intensive.pacing.totalDay", {
								total: formatMinutesAsClock(safeElec + safeLang),
							})}
						</span>
					</div>

					{/* Visual live daily focus split */}
					<div className="space-y-2">
						<div className="flex items-center justify-between text-[13px] text-muted-foreground">
							<span className="font-semibold text-foreground">
								{t("intensive.pacing.dailyBreakdown")}
							</span>
							<span className="tabular-nums">
								{formatMinutesAsClock(coreElecOnly)} · {formatMinutesAsClock(safeCta)}{" "}
								{t("intensive.pacing.parallelShort")} · {formatMinutesAsClock(safeLang)}
							</span>
						</div>
						<div className="flex h-3 w-full overflow-hidden rounded-full border border-border/50 bg-foreground/10">
							<div
								className="h-full bg-[var(--elec-volt)] transition-[width] duration-200 ease-out"
								style={{ width: `${corePct}%` }}
								title={`${t("intensive.pacing.dailyElectronics")}: ${formatMinutesAsClock(coreElecOnly)}`}
							/>
							<div
								className="h-full bg-[var(--elec-copper)] transition-[width] duration-200 ease-out"
								style={{ width: `${ctaPct}%` }}
								title={`${t("intensive.pacing.dailyCta")}: ${formatMinutesAsClock(safeCta)}`}
							/>
							<div
								className="h-full bg-[var(--elec-mint)] transition-[width] duration-200 ease-out"
								style={{ width: `${langPct}%` }}
								title={`${t("intensive.pacing.dailyLanguage")}: ${formatMinutesAsClock(safeLang)}`}
							/>
						</div>
						<div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
							<span className="inline-flex items-center gap-1.5">
								<span className="size-2.5 rounded-full bg-[var(--elec-volt)]" />
								Core ({corePct}%)
							</span>
							<span className="inline-flex items-center gap-1.5">
								<span className="size-2.5 rounded-full bg-[var(--elec-copper)]" />
								{t("intensive.pacing.parallelShort")} ({ctaPct}%)
							</span>
							<span className="inline-flex items-center gap-1.5">
								<span className="size-2.5 rounded-full bg-[var(--elec-mint)]" />
								{t("intensive.pacing.dailyLanguage").replace(/\s*\(.*?\)\s*/g, "")} ({langPct}%)
							</span>
						</div>
					</div>

					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div className="space-y-1.5">
							<label
								htmlFor="pacing-electronics"
								className="flex items-center justify-between text-[13px] font-semibold text-foreground"
							>
								<span>{t("intensive.pacing.dailyElectronics")}</span>
								<span className="tabular-nums text-muted-foreground">
									{formatMinutesAsClock(dailyElectronics)}
								</span>
							</label>
							<input
								id="pacing-electronics"
								type="number"
								min={45}
								max={480}
								step={15}
								value={dailyElectronics}
								onChange={(e) => {
									setDailyElectronics(Number(e.target.value));
									setSaved(false);
								}}
								className={`${INTENSIVE_INPUT} tabular-nums`}
							/>
						</div>

						<div className="space-y-1.5">
							<label
								htmlFor="pacing-language"
								className="flex items-center justify-between text-[13px] font-semibold text-foreground"
							>
								<span>{t("intensive.pacing.dailyLanguage")}</span>
								<span className="tabular-nums text-muted-foreground">
									{formatMinutesAsClock(dailyLanguage)}
								</span>
							</label>
							<input
								id="pacing-language"
								type="number"
								min={15}
								max={180}
								step={5}
								value={dailyLanguage}
								onChange={(e) => {
									setDailyLanguage(Number(e.target.value));
									setSaved(false);
								}}
								className={`${INTENSIVE_INPUT} tabular-nums`}
							/>
						</div>

						<div className="space-y-1.5">
							<label
								htmlFor="pacing-cta"
								className="flex items-center justify-between text-[13px] font-semibold text-foreground"
							>
								<span>{t("intensive.pacing.dailyCta")}</span>
								<span className="tabular-nums text-muted-foreground">
									{formatMinutesAsClock(dailyCta)}
								</span>
							</label>
							<input
								id="pacing-cta"
								type="number"
								min={20}
								max={150}
								step={5}
								value={dailyCta}
								onChange={(e) => {
									setDailyCta(Number(e.target.value));
									setSaved(false);
								}}
								className={`${INTENSIVE_INPUT} tabular-nums`}
							/>
						</div>

						<div className="space-y-1.5">
							<label
								htmlFor="pacing-passive"
								className="flex items-center justify-between text-[13px] font-semibold text-foreground"
							>
								<span>{t("intensive.pacing.passiveCap")}</span>
								<span className="tabular-nums text-muted-foreground">
									{formatMinutesAsClock(passiveCap)}
								</span>
							</label>
							<input
								id="pacing-passive"
								type="number"
								min={30}
								max={240}
								step={15}
								value={passiveCap}
								onChange={(e) => {
									setPassiveCap(Number(e.target.value));
									setSaved(false);
								}}
								className={`${INTENSIVE_INPUT} tabular-nums`}
							/>
						</div>
					</div>

					<div className="flex items-center gap-3 pt-1">
						<button
							type="submit"
							disabled={busyKey === "set-pacing"}
							className={INTENSIVE_BTN_PRIMARY}
						>
							{t("intensive.pacing.savePacing")}
						</button>
						{saved && (
							<span className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--elec-mint-text)]">
								<CheckCircle2Icon className="size-4" aria-hidden="true" />
								{t("intensive.action.saved")}
							</span>
						)}
					</div>
				</form>

				{/* Realistic ETA Projections */}
				<div className="elec-surface space-y-4 p-5">
					<div>
						<h3 className="text-base font-bold text-foreground">
							{t("intensive.pacing.etaTitle")}
						</h3>
						<p className="text-[13px] text-muted-foreground">
							{t("intensive.pacing.etaSubtitle")}
						</p>
					</div>

					<dl className="divide-y divide-border/45">
						{[
							{
								label: t("intensive.pacing.etaTier1"),
								weeks: pacingProjection.tier1EstimatedWeeks,
								days: pacingProjection.tier1EstimatedDays,
								hours: pacingProjection.tier1NonParallelRemainingHours,
							},
							{
								label: t("intensive.pacing.etaCeta"),
								weeks: pacingProjection.cetaEstimatedWeeks,
								days: pacingProjection.cetaEstimatedDays,
								hours: pacingProjection.cetaReadinessRemainingHours,
							},
							{
								label: t("intensive.pacing.etaParallel"),
								weeks: pacingProjection.parallelCourseEstimatedWeeks,
								days: pacingProjection.parallelCourseEstimatedDays,
								hours: pacingProjection.parallelCourseRemainingHours,
							},
							{
								label: t("intensive.pacing.etaCore"),
								weeks: pacingProjection.coreEstimatedWeeks,
								days: pacingProjection.coreEstimatedDays,
								hours: pacingProjection.coreRemainingHours,
							},
						].map((row) => (
							<div
								key={row.label}
								className="flex flex-col gap-0.5 py-3 sm:flex-row sm:items-baseline sm:justify-between"
							>
								<dt className="text-sm font-bold text-foreground">{row.label}</dt>
								<dd className="text-[13px] font-semibold tabular-nums text-muted-foreground">
									{t("intensive.pacing.etaFormat", {
										weeks: row.weeks,
										days: row.days,
										hours: formatHoursCompact(row.hours),
									})}
								</dd>
							</div>
						))}
					</dl>
				</div>
			</div>

			{/* 3. Guardrail Warnings + Active Comprehension-First Rules */}
			<section className="space-y-4">
				{pacingProjection.guardrailWarnings.length > 0 && (
					<div
						role="alert"
						className="space-y-2 rounded-xl border-l-4 border-[var(--cel-warning,var(--lh-warning))] bg-[var(--cel-warning,var(--lh-warning))]/10 p-4"
					>
						<div className="flex items-center gap-2 text-sm font-bold text-[var(--cel-warning-text,var(--lh-warning))]">
							<AlertTriangleIcon className="size-4 shrink-0" aria-hidden="true" />
							<h3>{t("intensive.pacing.warningsTitle")}</h3>
						</div>
						<ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
							{pacingProjection.guardrailWarnings.map((warn) => (
								<li key={warn}>{warn}</li>
							))}
						</ul>
					</div>
				)}

				<div className="elec-surface overflow-hidden">
					<div className="flex items-center gap-2 border-b border-border/55 px-5 py-4">
						<ShieldCheckIcon
							className="size-5 shrink-0 text-[var(--elec-volt-text)]"
							aria-hidden="true"
						/>
						<h2 className="font-title text-lg text-foreground">
							{t("intensive.pacing.guardrailsTitle")}
						</h2>
					</div>
					<div className="divide-y divide-border/50 px-5">
						{track.pacingRules.map((rule) => (
							<div key={rule.id} className="space-y-2 py-4">
								<div className="flex items-baseline gap-2">
									<span className="text-[13px] font-bold tabular-nums text-[var(--elec-volt-text)]">
										{rule.order}.
									</span>
									<h3 className="text-base font-bold text-foreground">{rule.title}</h3>
								</div>
								<p className="max-w-[65ch] text-sm text-muted-foreground">{rule.summary}</p>
								<ul className="list-disc space-y-1 pl-5 text-sm text-foreground/90">
									{rule.guardrails.map((g) => (
										<li key={g}>{g}</li>
									))}
								</ul>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* 4. Career Guidance (CBO → NOC + Formal Windows + CV Order + Target Companies) */}
			<section
				aria-labelledby="career-guidance-heading"
				className="elec-surface space-y-5 p-5"
			>
				<div className="flex items-center gap-2 border-b border-border/55 pb-3">
					<BriefcaseIcon
						className="size-5 shrink-0 text-[var(--elec-volt-text)]"
						aria-hidden="true"
					/>
					<h2 id="career-guidance-heading" className="font-title text-lg text-foreground">
						{t("intensive.pacing.careerTitle")}
					</h2>
				</div>

				<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
					<div className="space-y-1 border-l-4 border-error bg-background/55 py-3 pl-4 pr-3">
						<h3 className="text-sm font-bold text-error">{t("intensive.pacing.cboAvoid")}</h3>
						<p className="text-sm leading-relaxed text-foreground">
							{track.careerGuidance.cboToNocAvoid}
						</p>
					</div>
					<div className="space-y-1 border-l-4 border-[var(--elec-mint)] bg-background/55 py-3 pl-4 pr-3">
						<h3 className="text-sm font-bold text-[var(--elec-mint-text)]">
							{t("intensive.pacing.cboTarget")}
						</h3>
						<p className="text-sm leading-relaxed text-foreground">
							{track.careerGuidance.cboToNocTarget}
						</p>
					</div>
				</div>

				{/* Formal Windows */}
				<div className="space-y-3 border-t border-border/50 pt-4">
					<h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
						<CalendarIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						{t("intensive.pacing.formalWindows")}
					</h3>
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						{track.careerGuidance.formalWindows.map((win) => (
							<div
								key={win.id}
								className="space-y-1.5 border-l-2 border-[var(--elec-volt)] pl-3.5"
							>
								<div className="flex flex-wrap items-baseline justify-between gap-2">
									<span className="text-[13px] font-bold tabular-nums text-[var(--elec-volt-text)]">
										{win.dateLabel}
									</span>
									<span className="text-[13px] tabular-nums text-muted-foreground">
										{t("intensive.badge.verified", {
											date: formatVerifiedDate(win.verifiedAt),
										})}
									</span>
								</div>
								<p className="text-sm font-bold text-foreground">{win.title}</p>
								<p className="text-[13px] leading-relaxed text-muted-foreground">
									{win.details}
								</p>
							</div>
						))}
					</div>
				</div>

				{/* International CV Order + Target Companies */}
				<div className="grid grid-cols-1 gap-5 border-t border-border/50 pt-4 lg:grid-cols-2">
					<div className="space-y-2">
						<h3 className="text-sm font-bold text-foreground">
							{t("intensive.pacing.cvOrder")}
						</h3>
						<ul className="space-y-1.5 text-sm text-muted-foreground">
							{track.careerGuidance.internationalCvOrder.map((line) => (
								<li key={line} className="text-foreground/90">
									{line}
								</li>
							))}
						</ul>
					</div>

					<div className="space-y-2">
						<h3 className="text-sm font-bold text-foreground">
							{t("intensive.pacing.targetCompanies")}
						</h3>
						<p className="text-sm leading-relaxed text-muted-foreground">
							{track.careerGuidance.targetCompanies.join(" · ")}
						</p>
					</div>
				</div>
			</section>
		</div>
	);
}
