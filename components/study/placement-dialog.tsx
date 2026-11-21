"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/icon";
import { useT } from "@/components/i18n";
import type { PlacementQuestion, PlacementSummary, StudyNodeBrief } from "@/src/core";
import { SessionStarter, studyLessonRequest } from "../start-session.ts";
import { lessonStatement } from "./lesson-statement.ts";

interface PlacementApiPayload {
	active?: boolean;
	done?: boolean;
	finished?: boolean;
	question?: PlacementQuestion | null;
	summary?: PlacementSummary | null;
	lastSummary?: PlacementSummary | null;
	error?: string;
}

interface LessonLookupResponse {
	brief?: StudyNodeBrief;
	minutes?: number;
	activeSessionId?: string;
	sessionId?: string;
}

export interface PlacementDialogProps {
	domainId?: string;
	onCompleted?: (summary: PlacementSummary) => void;
}

function extractSummary(data: PlacementApiPayload | PlacementSummary | null): PlacementSummary | null {
	if (!data || typeof data !== "object") return null;
	if ("summary" in data && data.summary && typeof data.summary === "object") {
		return data.summary;
	}
	if ("active" in data && !data.active && data.lastSummary && typeof data.lastSummary === "object") {
		return data.lastSummary;
	}
	if ("placedCount" in data && "totalLeaves" in data && typeof data.placedCount === "number") {
		return data;
	}
	return null;
}

export function PlacementDialog({ domainId, onCompleted }: PlacementDialogProps) {
	const t = useT();
	const router = useRouter();
	const starterRef = useRef(new SessionStarter());
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [startingRecommended, setStartingRecommended] = useState(false);
	const [error, setError] = useState("");
	const [question, setQuestion] = useState<PlacementQuestion | null>(null);
	const [summary, setSummary] = useState<PlacementSummary | null>(null);

	const applyPayload = useCallback(
		(raw: PlacementApiPayload | PlacementSummary | null, notify = false) => {
			const nextSummary = extractSummary(raw);
			if (nextSummary) {
				setSummary(nextSummary);
				setQuestion(null);
				if (notify) onCompleted?.(nextSummary);
				return;
			}
			if (raw && typeof raw === "object" && "question" in raw) {
				setQuestion(raw.question ?? null);
				if (raw.question) setSummary(null);
			}
		},
		[onCompleted],
	);

	useEffect(() => {
		const ctrl = new AbortController();
		setLoading(true);
		setError("");
		fetch("/api/study/placement", { signal: ctrl.signal })
			.then(async (res) => {
				const data = (await res.json().catch(() => null)) as PlacementApiPayload | null;
				if (!res.ok) throw new Error(data?.error ?? t("course.placement.errLoad"));
				if (!ctrl.signal.aborted) applyPayload(data, false);
			})
			.catch((err: unknown) => {
				if (ctrl.signal.aborted) return;
				setError(err instanceof Error ? err.message : t("course.placement.errLoad"));
			})
			.finally(() => {
				if (!ctrl.signal.aborted) setLoading(false);
			});
		return () => ctrl.abort();
	}, [applyPayload, t]);

	const runAction = useCallback(
		async (body: { action: "start" | "answer" | "finish"; nodeId?: string; correct?: boolean }) => {
			setBusy(true);
			setError("");
			try {
				const res = await fetch("/api/study/placement", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				});
				const data = (await res.json().catch(() => null)) as PlacementApiPayload | PlacementSummary | null;
				if (!res.ok) {
					const message =
						data && "error" in data && typeof data.error === "string"
							? data.error
							: t("course.placement.errUpdate");
					throw new Error(message);
				}
				const nextSummary = extractSummary(data);
				if (nextSummary) {
					applyPayload(data, true);
					return;
				}
				const nextQuestion = data && "question" in data ? (data.question ?? null) : null;
				if (body.action === "answer" && !nextQuestion) {
					// Filter converged or hit the question cap: finalize immediately.
					const finRes = await fetch("/api/study/placement", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ action: "finish" }),
					});
					const finData = (await finRes.json().catch(() => null)) as PlacementApiPayload | PlacementSummary | null;
					if (!finRes.ok) {
						const message =
							finData && "error" in finData && typeof finData.error === "string"
								? finData.error
								: t("course.placement.errFinish");
						throw new Error(message);
					}
					applyPayload(finData, true);
					return;
				}
				applyPayload(data, body.action === "finish");
			} catch (err) {
				setError(err instanceof Error ? err.message : t("course.placement.errServer"));
			} finally {
				setBusy(false);
			}
		},
		[applyPayload, t],
	);

	const cancelPlacement = useCallback(async () => {
		setBusy(true);
		setError("");
		try {
			const res = await fetch("/api/study/placement", { method: "DELETE" });
			if (!res.ok) {
				const data = (await res.json().catch(() => null)) as { error?: string } | null;
				throw new Error(data?.error ?? t("course.placement.errCancel"));
			}
			setQuestion(null);
			setSummary(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : t("course.placement.errCancel"));
		} finally {
			setBusy(false);
		}
	}, [t]);

	const startRecommendedLesson = useCallback(async () => {
		if (!summary?.recommendedNodeId || startingRecommended) return;
		const nodeId = summary.recommendedNodeId;
		const title = summary.recommendedNodeTitle ?? nodeId;
		setStartingRecommended(true);
		setError("");
		try {
			let resolvedDomainId = domainId;
			if (!resolvedDomainId) {
				const todayRes = await fetch("/api/study/today");
				const todayJson = (await todayRes.json().catch(() => null)) as { domain?: { id?: string } } | null;
				resolvedDomainId = todayJson?.domain?.id;
			}
			if (!resolvedDomainId) throw new Error(t("course.placement.errStartLesson"));

			const lookupRes = await fetch(
				"/api/study/materials?" +
					new URLSearchParams({ domain: resolvedDomainId, node: nodeId, lesson: "1" }),
			);
			const detail = (await lookupRes.json().catch(() => null)) as LessonLookupResponse | null;
			const activeId = detail?.activeSessionId ?? detail?.sessionId;
			if (activeId) {
				router.push(`/chat/${encodeURIComponent(activeId)}`);
				return;
			}
			const minutes = Math.max(5, Math.round(detail?.minutes ?? 25));
			const brief: StudyNodeBrief = detail?.brief ?? {
				id: nodeId,
				title,
				path: [
					...(summary.recommendedChapter ? [`${summary.recommendedChapter.level} · ${summary.recommendedChapter.title}`] : []),
					...(summary.recommendedModule ? [summary.recommendedModule.title] : []),
				],
				summary: summary.message,
				scope: summary.message,
				objectives: [],
				misconceptions: [],
				hours: { lo: minutes / 60, hi: minutes / 60 },
				kind: "atom",
			};
			const href = await starterRef.current.start(
				studyLessonRequest({
					domainId: resolvedDomainId,
					minutes,
					title: brief.title,
					context: {
						id: nodeId,
						name: brief.title,
						statement: lessonStatement(brief, minutes),
					},
				}),
				fetch,
			);
			router.push(href);
		} catch (err) {
			setError(err instanceof Error ? err.message : t("course.placement.errStartLesson"));
			setStartingRecommended(false);
		}
	}, [domainId, router, startingRecommended, summary, t]);

	const mapHref = (nodeId: string) =>
		domainId
			? `/mapa?dominio=${encodeURIComponent(domainId)}&no=${encodeURIComponent(nodeId)}`
			: `/mapa?no=${encodeURIComponent(nodeId)}`;

	if (loading) {
		return (
			<section className="cel-card p-5" aria-busy="true">
				<p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
					<Icon name="loader" size={16} live />
					{t("course.placement.loading")}
				</p>
			</section>
		);
	}

	if (summary) {
		return (
			<section
				aria-label={t("course.placement.resultAria")}
				data-testid="placement-summary"
				className="cel-card space-y-4 p-5"
			>
				<div className="flex flex-wrap items-center gap-2.5 border-b border-border/50 pb-3">
					<Icon name="check" size={22} />
					<div className="min-w-0 flex-1">
						<h2 className="cel-display text-xl leading-tight">{t("course.placement.doneTitle")}</h2>
						<p className="mt-0.5 text-sm text-muted-foreground">{summary.message}</p>
					</div>
					<span className="study-pill study-pill-success tabular-nums">
						{t("course.placement.confidenceBadge", { pct: summary.confidencePct })}
					</span>
				</div>

				<dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
					<div className="rounded-xl border border-border/50 bg-background/60 p-3">
						<dt className="text-xs text-muted-foreground">{t("course.placement.positionedSkills")}</dt>
						<dd className="cel-display mt-1 text-xl tabular-nums">
							{summary.placedCount}/{summary.totalLeaves}
							<span className="ml-1.5 text-xs font-semibold text-muted-foreground">
								({summary.placedPct}%)
							</span>
						</dd>
					</div>
					<div className="rounded-xl border border-border/50 bg-background/60 p-3">
						<dt className="text-xs text-muted-foreground">{t("course.placement.answeredQuestions")}</dt>
						<dd className="cel-display mt-1 text-xl tabular-nums">{summary.asked}</dd>
					</div>
					<div className="col-span-2 rounded-xl border border-border/50 bg-background/60 p-3 sm:col-span-1">
						<dt className="text-xs text-muted-foreground">{t("course.placement.initialFrontier")}</dt>
						<dd className="cel-display mt-1 text-xl tabular-nums">
							{t("course.placement.frontierTopics", { count: summary.frontierNodeIds.length })}
						</dd>
					</div>
				</dl>

				{(summary.recommendedChapter || summary.recommendedModule || summary.recommendedNodeTitle) && (
					<div className="space-y-1.5 rounded-xl border border-border/55 bg-background/70 p-3.5 text-sm">
						<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
							{t("course.placement.recommendedStart")}
						</p>
						{summary.recommendedChapter && (
							<p className="font-semibold text-foreground">
								{t("course.placement.chapterLine", {
									level: summary.recommendedChapter.level,
									title: summary.recommendedChapter.title,
								})}
							</p>
						)}
						{summary.recommendedModule && (
							<p className="text-foreground/90">
								{t("course.placement.moduleLine", { title: summary.recommendedModule.title })}
							</p>
						)}
						{summary.recommendedNodeTitle && summary.recommendedNodeId && (
							<p className="text-xs text-muted-foreground">
								{t("course.placement.suggestedLesson")}{" "}
								<Link
									href={mapHref(summary.recommendedNodeId)}
									className="font-semibold text-[var(--cel-link,var(--lh-accent))] underline underline-offset-2"
								>
									{summary.recommendedNodeTitle}
								</Link>
							</p>
						)}
					</div>
				)}

				{error && <p role="alert" className="text-sm text-destructive">{error}</p>}

				<div className="flex flex-wrap items-center gap-2.5 pt-1">
					{summary.recommendedNodeId && (
						<button
							type="button"
							data-testid="placement-start-recommended"
							className="cel-button cel-button-primary min-h-10 px-4 py-2 text-sm"
							disabled={busy || startingRecommended}
							onClick={() => void startRecommendedLesson()}
						>
							<Icon name="play" size={15} />
							{startingRecommended
								? t("course.placement.startingLesson")
								: t("course.placement.startRecommended")}
						</button>
					)}
					<Link
						href="/"
						className={`cel-button min-h-10 px-4 py-2 text-sm ${summary.recommendedNodeId ? "" : "cel-button-primary"}`}
					>
						<Icon name="play" size={15} tone={!summary.recommendedNodeId} />
						{t("course.placement.goToCampaign")}
					</Link>
					<button
						type="button"
						className="cel-button cel-button-ghost min-h-10 px-3.5 py-2 text-sm"
						disabled={busy || startingRecommended}
						onClick={() => void runAction({ action: "start" })}
					>
						{t("course.placement.retake")}
					</button>
				</div>
			</section>
		);
	}

	if (!question) {
		return (
			<section
				aria-label={t("course.placement.introAria")}
				data-testid="placement-intro"
				className="cel-card space-y-4 p-5"
			>
				<div className="flex items-start gap-3">
					<Icon name="frontier" size={24} className="mt-0.5 shrink-0" />
					<div className="min-w-0 space-y-1">
						<h2 className="cel-display text-xl leading-tight">{t("course.placement.title")}</h2>
						<p className="max-w-[65ch] text-sm leading-relaxed text-muted-foreground">
							{t("course.placement.introDesc")}
						</p>
					</div>
				</div>

				<ul className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
					<li className="rounded-xl border border-border/45 bg-background/60 p-3">
						<strong className="block text-sm text-foreground">{t("course.placement.featRealtime")}</strong>
						{t("course.placement.featRealtimeDesc")}
					</li>
					<li className="rounded-xl border border-border/45 bg-background/60 p-3">
						<strong className="block text-sm text-foreground">{t("course.placement.featNoPenalty")}</strong>
						{t("course.placement.featNoPenaltyDesc")}
					</li>
					<li className="rounded-xl border border-border/45 bg-background/60 p-3">
						<strong className="block text-sm text-foreground">{t("course.placement.featFlexible")}</strong>
						{t("course.placement.featFlexibleDesc")}
					</li>
				</ul>

				{error && <p role="alert" className="text-sm text-destructive">{error}</p>}

				<div className="flex flex-wrap items-center gap-2.5">
					<button
						type="button"
						data-testid="placement-start-button"
						className="cel-button cel-button-primary min-h-10 px-4 py-2 text-sm"
						disabled={busy}
						onClick={() => void runAction({ action: "start" })}
					>
						<Icon name="play" size={15} />
						{busy ? t("course.placement.starting") : t("course.placement.startButton")}
					</button>
				</div>
			</section>
		);
	}

	const currentNumber = Math.min(question.maxQuestions, question.asked + 1);
	const canFinishEarly = question.asked >= 4;

	return (
		<section
			aria-label={t("course.placement.questionAria")}
			data-testid="placement-question"
			className="cel-card space-y-4 p-5"
		>
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
				<div className="flex items-center gap-2">
					<Icon name="frontier" size={18} />
					<h2 className="cel-display text-base leading-tight tabular-nums">
						{t("course.placement.questionCounter", {
							current: currentNumber,
							max: question.maxQuestions,
						})}
					</h2>
				</div>
				<span className="study-pill study-pill-info tabular-nums">
					{t("course.placement.confidenceLabel", { pct: question.confidencePct })}
				</span>
			</div>

			<div className="space-y-1.5">
				<div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
					<span>{t("course.placement.convergence")}</span>
					<span>{question.confidencePct}%</span>
				</div>
				<progress
					className="study-progress block w-full"
					max={100}
					value={question.confidencePct}
					aria-label={t("course.placement.confidenceAria", { pct: question.confidencePct })}
				/>
			</div>

			<div className="space-y-2.5 rounded-xl border border-border/55 bg-background/65 p-4">
				{question.path.length > 0 && (
					<p className="text-xs font-medium text-muted-foreground">{question.path.join(" › ")}</p>
				)}
				<h3 className="cel-display text-lg leading-snug text-foreground">{question.title}</h3>
				<p className="max-w-[65ch] text-[17px] leading-relaxed text-foreground">{question.prompt}</p>

				{question.objectives.length > 0 && (
					<div className="border-t border-border/45 pt-2.5">
						<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
							{t("course.placement.verifiedObjectives")}
						</p>
						<ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm leading-relaxed text-foreground/90">
							{question.objectives.map((objective, idx) => (
								<li key={idx}>{objective}</li>
							))}
						</ul>
					</div>
				)}
			</div>

			{error && <p role="alert" className="text-sm text-destructive">{error}</p>}

			<div className="grid gap-2.5 sm:grid-cols-2">
				<button
					type="button"
					data-testid="placement-yes-button"
					className="cel-button cel-button-primary min-h-11 justify-center px-4 py-2.5 text-sm"
					disabled={busy}
					onClick={() => void runAction({ action: "answer", nodeId: question.nodeId, correct: true })}
				>
					<Icon name="check" size={16} />
					{t("course.placement.canDo")}
				</button>
				<button
					type="button"
					data-testid="placement-no-button"
					className="cel-button min-h-11 justify-center px-4 py-2.5 text-sm"
					disabled={busy}
					onClick={() => void runAction({ action: "answer", nodeId: question.nodeId, correct: false })}
				>
					<Icon name="review" size={16} tone={false} />
					{t("course.placement.needToLearn")}
				</button>
			</div>

			<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/45 pt-3">
				<button
					type="button"
					data-testid="placement-finish-button"
					className="cel-button min-h-9 px-3.5 py-1.5 text-xs"
					disabled={busy || !canFinishEarly}
					title={
						canFinishEarly
							? t("course.placement.finishReadyTitle")
							: t("course.placement.finishLockedTitle")
					}
					onClick={() => void runAction({ action: "finish" })}
				>
					{canFinishEarly
						? t("course.placement.finishNow")
						: t("course.placement.finishNowCount", { asked: question.asked })}
				</button>
				<button
					type="button"
					data-testid="placement-cancel-button"
					className="cel-button cel-button-ghost min-h-9 px-3 py-1.5 text-xs"
					disabled={busy}
					onClick={() => void cancelPlacement()}
				>
					{t("common.action.cancel")}
				</button>
			</div>
		</section>
	);
}
