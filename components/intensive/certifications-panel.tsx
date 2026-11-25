"use client";

import { useMemo, useState } from "react";
import {
	AlertTriangleIcon,
	AwardIcon,
	BotIcon,
	CheckCircle2Icon,
	ChevronDownIcon,
	ExternalLinkIcon,
} from "lucide-react";
import {
	getCertificationCheckpointKey,
	type CertPhase,
	type CertStatus,
	type IntensiveCertificationView,
	type IntensiveDashboardDTO,
} from "@/src/core";
import { useT } from "@/components/i18n";
import {
	formatVerifiedDate,
	INTENSIVE_BTN_COMPACT,
	INTENSIVE_BTN_COMPACT_PRIMARY,
	INTENSIVE_INPUT,
	INTENSIVE_SELECT_AUTO,
	intensiveArtSet,
	type IntensiveMutation,
} from "./tutor-launch.ts";

interface CertificationsPanelProps {
	dashboard: IntensiveDashboardDTO;
	highlightedCertId?: string;
	onMutate: (mutation: IntensiveMutation) => Promise<void>;
	onOpenCourse: (courseId: string) => void;
	onAskCertTutor: (cert: IntensiveCertificationView) => void;
	busyKey: string | null;
}

const PHASE_ORDER: readonly CertPhase[] = [
	"Mês 1",
	"Meses 2–4",
	"Meses 4–6",
	"Bônus Brasil",
	"Opcional (Nicho)",
];

const CERT_STATUSES: readonly CertStatus[] = [
	"locked",
	"preparing",
	"ready-to-book",
	"scheduled",
	"passed",
	"skipped",
];

function certStatusLabel(status: CertStatus, t: ReturnType<typeof useT>): string {
	switch (status) {
		case "locked":
			return t("intensive.certs.statusLocked");
		case "preparing":
			return t("intensive.certs.statusPreparing");
		case "ready-to-book":
			return t("intensive.certs.statusReady");
		case "scheduled":
			return t("intensive.certs.statusScheduled");
		case "passed":
			return t("intensive.certs.statusPassed");
		case "skipped":
			return t("intensive.certs.statusSkipped");
	}
}

export function CertificationsPanel({
	dashboard,
	highlightedCertId,
	onMutate,
	onOpenCourse,
	onAskCertTutor,
	busyKey,
}: CertificationsPanelProps) {
	const t = useT();
	const [drafts, setDrafts] = useState<
		Record<
			string,
			{
				mockScorePct: string;
				targetDate: string;
				credentialId: string;
				credentialUrl: string;
				notes: string;
			}
		>
	>({});
	const [savedCertId, setSavedCertId] = useState<string | null>(null);
	const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});

	const grouped = useMemo(() => {
		const map = new Map<CertPhase, IntensiveCertificationView[]>();
		for (const phase of PHASE_ORDER) map.set(phase, []);
		for (const cert of dashboard.certifications) {
			const bucket = map.get(cert.spec.phase);
			if (bucket) bucket.push(cert);
		}
		return PHASE_ORDER.map((phase) => ({
			phase,
			items: map.get(phase) ?? [],
		})).filter((g) => g.items.length > 0);
	}, [dashboard.certifications]);

	const coreBudget = useMemo(() => {
		let usd = 0;
		let studentUsd = 0;
		for (const cert of dashboard.certifications) {
			if (cert.metrics.isCore) {
				usd += cert.spec.costUSD;
				studentUsd += cert.spec.studentCostUSD ?? cert.spec.costUSD;
			}
		}
		return { usd, studentUsd };
	}, [dashboard.certifications]);

	const getDraft = (cert: IntensiveCertificationView) => {
		return (
			drafts[cert.spec.id] ?? {
				mockScorePct:
					typeof cert.state.mockScorePct === "number" ? String(cert.state.mockScorePct) : "",
				targetDate: cert.state.targetDate ?? "",
				credentialId: cert.state.credentialId ?? "",
				credentialUrl: cert.state.credentialUrl ?? "",
				notes: cert.state.notes ?? "",
			}
		);
	};

	const patchDraft = (
		cert: IntensiveCertificationView,
		patch: Partial<ReturnType<typeof getDraft>>,
	) => {
		const current = getDraft(cert);
		setDrafts((prev) => ({
			...prev,
			[cert.spec.id]: { ...current, ...patch },
		}));
		if (savedCertId === cert.spec.id) setSavedCertId(null);
	};

	const handleSaveCertMeta = async (cert: IntensiveCertificationView) => {
		const d = getDraft(cert);
		const parsedScore = d.mockScorePct.trim() === "" ? undefined : Number(d.mockScorePct);
		await onMutate({
			kind: "update-certification",
			certId: cert.spec.id,
			targetDate: d.targetDate.trim() || undefined,
			credentialId: d.credentialId.trim() || undefined,
			credentialUrl: d.credentialUrl.trim() || undefined,
			...(parsedScore !== undefined && Number.isFinite(parsedScore)
				? { mockScorePct: Math.max(0, Math.min(100, Math.round(parsedScore))) }
				: {}),
			notes: d.notes,
		});
		setSavedCertId(cert.spec.id);
	};

	return (
		<div className="space-y-8">
			{/* Editorial Illustrated Summary Banner (Nano Banana cert-emblem.jpg) */}
			<section className="elec-editorial-banner">
				<div className="elec-banner-body-compact">
					<div className="elec-hero-art-layer" aria-hidden="true">
						<img
							src={intensiveArtSet(dashboard.track.domainId).certs}
							alt=""
							className="elec-hero-art-img"
						/>
						<div className="elec-hero-fade" />
					</div>

					<div className="relative z-10 flex flex-col justify-center gap-4 p-5 sm:p-6">
						<div className="space-y-1">
							<h2 className="font-title text-xl tracking-tight text-[var(--elec-banner-ink)] sm:text-2xl">
								{t("intensive.certs.title")}
							</h2>
							<p className="text-sm tabular-nums text-[var(--elec-banner-muted)]">
								{t("intensive.badge.verified", {
									date: formatVerifiedDate(dashboard.track.verifiedAt),
								})}
							</p>
						</div>

						<div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
							<div>
								<span className="block text-[13px] font-medium text-[var(--elec-banner-muted)]">
									{t("intensive.certs.summaryReadiness")}
								</span>
								<div className="flex items-baseline gap-2">
									<span className="text-2xl font-bold tabular-nums text-[var(--elec-volt)]">
										{dashboard.summary.certificationsCorePct}%
									</span>
									<span className="text-[13px] tabular-nums text-[var(--elec-banner-muted)]">
										{t("intensive.certs.summaryPassed", {
											passed: dashboard.summary.certificationsCorePassedCount,
											total: dashboard.summary.certificationsCoreTotalCount,
										})}
									</span>
								</div>
							</div>

							<div>
								<span className="block text-[13px] font-medium text-[var(--elec-banner-muted)]">
									{t("intensive.certs.summaryBudget")}
								</span>
								<p className="text-lg font-bold tabular-nums text-[var(--elec-banner-ink)]">
									US$ {coreBudget.usd}
									{coreBudget.studentUsd < coreBudget.usd && (
										<span className="ml-2 text-sm font-semibold text-[var(--elec-mint)]">
											(
											{t("intensive.certs.studentBudgetShort", {
												cost: coreBudget.studentUsd,
											})}
											)
										</span>
									)}
								</p>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Phase-grouped certifications */}
			{grouped.map(({ phase, items }) => (
				<section key={phase} className="space-y-4" aria-label={phase}>
					<div className="flex items-baseline justify-between border-b border-border/60 pb-2.5">
						<h2 className="font-title text-lg tracking-tight text-foreground sm:text-xl">
							{phase}
						</h2>
						<span className="text-[13px] font-semibold tabular-nums text-muted-foreground">
							{items.filter((i) => i.state.status === "passed").length}/{items.length}
						</span>
					</div>

					<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
						{items.map((cert) => {
							const draft = getDraft(cert);
							const isHighlighted = highlightedCertId === cert.spec.id;
							const isPassed = cert.state.status === "passed";
							const hasSavedRecord = Boolean(
								cert.state.mockScorePct !== undefined ||
									cert.state.targetDate ||
									cert.state.credentialId ||
									cert.state.credentialUrl ||
									cert.state.notes?.trim(),
							);
							const detailsOpen =
								expandedDetails[cert.spec.id] ?? (isHighlighted || hasSavedRecord);

							return (
								<article
									key={cert.spec.id}
									id={`cert-${cert.spec.id}`}
									data-testid={`cert-card-${cert.spec.id}`}
									className={`elec-surface flex flex-col justify-between overflow-hidden ${
										isHighlighted ? "elec-course-recommended" : ""
									}`}
								>
									<div className="space-y-4 p-4 sm:p-5">
										{/* Header: title, issuer, cost in clean typography */}
										<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
											<div className="min-w-0 space-y-1">
												<div className="flex items-start gap-2">
													<AwardIcon
														className={`mt-0.5 size-4 shrink-0 ${
															isPassed
																? "text-[var(--elec-mint-text)]"
																: "text-[var(--elec-volt-text)]"
														}`}
														aria-hidden="true"
													/>
													<h3 className="text-base font-bold leading-snug text-foreground">
														{cert.spec.title}
													</h3>
												</div>
												<p className="text-[13px] text-muted-foreground">
													{cert.spec.issuer} ·{" "}
													<span className="tabular-nums">
														{t("intensive.badge.verified", {
															date: formatVerifiedDate(cert.spec.verifiedAt),
														})}
													</span>
												</p>
											</div>

											<div className="shrink-0 text-left sm:text-right">
												<p className="text-sm font-bold tabular-nums text-foreground">
													{cert.spec.costDisplay}
												</p>
												{cert.spec.studentCostUSD !== undefined && (
													<p className="text-[13px] font-semibold tabular-nums text-[var(--elec-mint-text)]">
														{t("intensive.certs.studentFee", {
															cost: `US$ ${cert.spec.studentCostUSD}`,
														})}
													</p>
												)}
											</div>
										</div>

										{/* Readiness bar + status selector */}
										<div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
											<div className="min-w-0 flex-1 space-y-1.5">
												<div className="flex items-center justify-between text-[13px] tabular-nums">
													<span className="font-semibold text-foreground">
														{t("intensive.certs.readiness", {
															pct: cert.metrics.readinessPct,
														})}
													</span>
													{isPassed && (
														<span className="inline-flex items-center gap-1 font-semibold text-[var(--elec-mint-text)]">
															<CheckCircle2Icon className="size-3.5" aria-hidden="true" />
															{t("intensive.certs.statusPassed")}
														</span>
													)}
												</div>
												<div className="elec-progress-track">
													<div
														className={`elec-progress-fill ${
															isPassed ? "bg-[var(--elec-mint)]" : "bg-[var(--elec-volt)]"
														}`}
														style={{
															width: `${Math.min(100, Math.max(0, cert.metrics.readinessPct))}%`,
														}}
													/>
												</div>
											</div>

											<div className="shrink-0">
												<label htmlFor={`cert-status-${cert.spec.id}`} className="sr-only">
													{t("intensive.certs.statusLabel")}
												</label>
												<select
													id={`cert-status-${cert.spec.id}`}
													value={cert.state.status}
													onChange={(e) => {
														const nextStatus = e.target.value as CertStatus;
														void onMutate({
															kind: "update-certification",
															certId: cert.spec.id,
															status: nextStatus,
															...(nextStatus === "passed" && !cert.state.passedAt
																? { passedAt: new Date().toISOString().slice(0, 10) }
																: {}),
														});
													}}
													className={`${INTENSIVE_SELECT_AUTO} min-h-9 text-[13px] font-semibold`}
												>
													{CERT_STATUSES.map((s) => (
														<option key={s} value={s}>
															{certStatusLabel(s, t)}
														</option>
													))}
												</select>
											</div>
										</div>

										{/* Concise exam headline facts */}
										<p className="text-[13px] leading-relaxed text-muted-foreground">
											<span className="font-semibold text-foreground">
												{cert.spec.examFormat}
											</span>{" "}
											· {cert.spec.passingScore}
										</p>

										{/* Interactive Study Checkpoints */}
										<div className="space-y-2 border-t border-border/45 pt-3">
											<p className="text-[13px] font-bold tabular-nums text-foreground">
												{t("intensive.certs.checkpointsTitle", {
													done: cert.metrics.checkedCheckpointsCount,
													total: cert.metrics.totalCheckpointsCount,
												})}
											</p>
											<ul className="space-y-1.5">
												{cert.spec.studyCheckpoints.map((checkpoint, idx) => {
													const key = getCertificationCheckpointKey(cert.spec.id, idx);
													const checked = Boolean(cert.state.completedCheckpoints[key]);
													return (
														<li key={key}>
															<label className="flex cursor-pointer items-start gap-2.5 text-sm leading-snug">
																<input
																	type="checkbox"
																	checked={checked}
																	onChange={(e) => {
																		void onMutate({
																			kind: "toggle-cert-checkpoint",
																			certId: cert.spec.id,
																			checkpointIndex: idx,
																			completed: e.target.checked,
																		});
																	}}
																	className="mt-0.5 size-4 shrink-0 accent-[var(--elec-volt)]"
																/>
																<span
																	className={
																		checked
																			? "text-muted-foreground line-through"
																			: "text-foreground"
																	}
																>
																	{checkpoint}
																</span>
															</label>
														</li>
													);
												})}
											</ul>
										</div>

										{/* Progressive disclosure: full exam specs + personal score/credential record */}
										<div className="border-t border-border/45 pt-2.5">
											<button
												type="button"
												aria-expanded={detailsOpen}
												onClick={() =>
													setExpandedDetails((prev) => ({
														...prev,
														[cert.spec.id]: !detailsOpen,
													}))
												}
												className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground transition-colors duration-150 hover:text-foreground cursor-pointer"
											>
												<ChevronDownIcon
													className={`size-4 transition-transform duration-150 ${
														detailsOpen ? "rotate-180" : ""
													}`}
													aria-hidden="true"
												/>
												{detailsOpen
													? t("intensive.certs.hideDetails")
													: t("intensive.certs.toggleDetails")}
											</button>

											{detailsOpen && (
												<div className="mt-3 space-y-4">
													<dl className="space-y-2 text-[13px]">
														<div>
															<dt className="font-semibold text-foreground">
																{t("intensive.certs.globalWeight")}
															</dt>
															<dd className="text-muted-foreground">
																{cert.spec.globalWeight}
															</dd>
														</div>
														<div>
															<dt className="font-semibold text-foreground">
																{t("intensive.certs.retakeNotes")}
															</dt>
															<dd className="text-muted-foreground">
																{cert.spec.retakeAndDiscountNotes}
															</dd>
														</div>
													</dl>

													<div className="space-y-2.5 border-t border-border/45 pt-3">
														<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
															<div className="space-y-1">
																<label
																	htmlFor={`cert-mock-${cert.spec.id}`}
																	className="block text-[13px] font-medium text-muted-foreground"
																>
																	{t("intensive.certs.mockScore")}
																</label>
																<input
																	id={`cert-mock-${cert.spec.id}`}
																	type="number"
																	min={0}
																	max={100}
																	value={draft.mockScorePct}
																	onChange={(e) =>
																		patchDraft(cert, { mockScorePct: e.target.value })
																	}
																	placeholder="82"
																	className={`${INTENSIVE_INPUT} min-h-9 tabular-nums`}
																/>
															</div>
															<div className="space-y-1">
																<label
																	htmlFor={`cert-date-${cert.spec.id}`}
																	className="block text-[13px] font-medium text-muted-foreground"
																>
																	{t("intensive.certs.targetDate")}
																</label>
																<input
																	id={`cert-date-${cert.spec.id}`}
																	type="date"
																	value={draft.targetDate}
																	onChange={(e) =>
																		patchDraft(cert, { targetDate: e.target.value })
																	}
																	className={`${INTENSIVE_INPUT} min-h-9 tabular-nums`}
																/>
															</div>
															<div className="space-y-1">
																<label
																	htmlFor={`cert-cred-id-${cert.spec.id}`}
																	className="block text-[13px] font-medium text-muted-foreground"
																>
																	{t("intensive.certs.credentialId")}
																</label>
																<input
																	id={`cert-cred-id-${cert.spec.id}`}
																	type="text"
																	value={draft.credentialId}
																	onChange={(e) =>
																		patchDraft(cert, { credentialId: e.target.value })
																	}
																	className={`${INTENSIVE_INPUT} min-h-9 font-mono text-[13px]`}
																/>
															</div>
															<div className="space-y-1">
																<label
																	htmlFor={`cert-cred-url-${cert.spec.id}`}
																	className="block text-[13px] font-medium text-muted-foreground"
																>
																	{t("intensive.certs.credentialUrl")}
																</label>
																<input
																	id={`cert-cred-url-${cert.spec.id}`}
																	type="url"
																	value={draft.credentialUrl}
																	onChange={(e) =>
																		patchDraft(cert, { credentialUrl: e.target.value })
																	}
																	placeholder="https://…"
																	className={`${INTENSIVE_INPUT} min-h-9`}
																/>
															</div>
														</div>

														<textarea
															rows={2}
															value={draft.notes}
															onChange={(e) => patchDraft(cert, { notes: e.target.value })}
															placeholder={t("intensive.certs.notesPlaceholder")}
															className={INTENSIVE_INPUT}
														/>

														<div className="flex items-center gap-2.5">
															<button
																type="button"
																onClick={() => void handleSaveCertMeta(cert)}
																className={INTENSIVE_BTN_COMPACT}
															>
																{t("intensive.action.save")}
															</button>
															{savedCertId === cert.spec.id && (
																<span className="text-[13px] font-semibold text-[var(--elec-mint-text)]">
																	{t("intensive.action.saved")}
																</span>
															)}
														</div>
													</div>
												</div>
											)}
										</div>
									</div>

									{/* Footer actions: 1 primary CTA + clean portal link + linked course shortcuts */}
									<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 bg-background/40 px-4 py-3 sm:px-5">
										<div className="flex flex-wrap items-center gap-2.5">
											<button
												type="button"
												disabled={busyKey === `tutor:cert:${cert.spec.id}`}
												onClick={() => onAskCertTutor(cert)}
												className={
													cert.metrics.isCore
														? INTENSIVE_BTN_COMPACT_PRIMARY
														: INTENSIVE_BTN_COMPACT
												}
											>
												<BotIcon className="size-4 shrink-0" aria-hidden="true" />
												{t("intensive.certs.trainMockTutor")}
											</button>

											<a
												href={cert.spec.officialUrl}
												target="_blank"
												rel="noopener noreferrer"
												className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-muted-foreground transition-colors duration-150 hover:bg-accent/70 hover:text-foreground"
											>
												<ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden="true" />
												{t("intensive.certs.officialPortal")}
											</a>
										</div>

										{cert.spec.linkedCourseIds.length > 0 && (
											<div className="flex flex-wrap items-center gap-1.5">
												{cert.spec.linkedCourseIds.map((cid) => {
													const linkedCourse = dashboard.coursesById[cid];
													if (!linkedCourse) return null;
													return (
														<button
															key={cid}
															type="button"
															onClick={() => onOpenCourse(cid)}
															className="rounded-md px-2 py-0.5 text-[13px] font-bold tabular-nums text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground cursor-pointer"
															title={linkedCourse.spec.title}
														>
															#{linkedCourse.spec.rank}
														</button>
													);
												})}
											</div>
										)}
									</div>
								</article>
							);
						})}
					</div>
				</section>
			))}

			{/* Anti-Goals ("O que NÃO comprar agora") */}
			<section
				aria-labelledby="cert-antigoals-heading"
				className="elec-surface overflow-hidden border-[var(--cel-warning,var(--lh-warning))]/45"
			>
				<div className="border-b border-border/55 px-5 py-4">
					<div className="flex items-center gap-2">
						<AlertTriangleIcon
							className="size-5 shrink-0 text-[var(--cel-warning-text,var(--lh-warning))]"
							aria-hidden="true"
						/>
						<h2 id="cert-antigoals-heading" className="font-title text-lg text-foreground">
							{t("intensive.certs.antiGoalsTitle")}
						</h2>
					</div>
					<p className="mt-1 text-sm text-muted-foreground">
						{t("intensive.certs.antiGoalsSubtitle")}
					</p>
				</div>

				<div className="divide-y divide-border/50">
					{dashboard.track.certificationAntiGoals.map((item) => {
						const severityLabel =
							item.severity === "reject"
								? t("intensive.certs.severityReject")
								: item.severity === "avoid"
									? t("intensive.certs.severityAvoid")
									: t("intensive.certs.severityDefer");
						return (
							<div
								key={item.id}
								className="flex flex-col gap-1.5 px-5 py-4"
							>
								<div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
									<span
										className={`text-[13px] font-bold ${
											item.severity === "reject"
												? "text-error"
												: "text-[var(--cel-warning-text,var(--lh-warning))]"
										}`}
									>
										{severityLabel}
									</span>
									<span className="text-border" aria-hidden="true">
										·
									</span>
									<h3 className="text-base font-bold text-foreground">{item.title}</h3>
									<span className="text-[13px] font-semibold tabular-nums text-muted-foreground">
										{item.costOrRisk}
									</span>
								</div>
								<p className="max-w-[65ch] text-sm text-muted-foreground">{item.reason}</p>
								<p className="max-w-[65ch] text-sm text-foreground">
									<span className="font-semibold">
										{t("intensive.certs.antiGoalAlternative")}{" "}
									</span>
									{item.alternative}
								</p>
							</div>
						);
					})}
				</div>
			</section>
		</div>
	);
}
