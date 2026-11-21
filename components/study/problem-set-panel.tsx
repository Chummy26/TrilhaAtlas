"use client";

import { memo, useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/icon";
import { useI18n } from "@/components/i18n";
import type {
	LabPreset,
	ModuleProblemSet,
	ProblemSetItem,
	ProblemSetResult,
	ProblemSetTier,
	Translator,
} from "@/src/core";

export interface ProblemSetPanelProps {
	domainId: string;
	moduleId: string;
	moduleTitle: string;
	onClose?: () => void;
	onGraded?: (result: ProblemSetResult) => void;
}

interface ProblemSetGetPayload {
	problemSet?: ModuleProblemSet;
	set?: ModuleProblemSet;
	error?: string;
}

interface ProblemSetPostPayload {
	result?: ProblemSetResult;
	error?: string;
}

const FALSTAD_URL = "https://www.falstad.com/circuit/circuitjs.html";
const CIRCUIT_PRESETS = new Set<LabPreset>(["divider", "rc-filter", "rlc", "rectifier", "circuit"]);

function tierMeta(t: Translator, tier: ProblemSetTier): { label: string; pill: string; description: string } {
	if (tier === 1) {
		return {
			label: t("course.problemSet.tier1Label"),
			pill: "study-pill study-pill-info",
			description: t("course.problemSet.tier1Desc"),
		};
	}
	if (tier === 2) {
		return {
			label: t("course.problemSet.tier2Label"),
			pill: "study-pill study-pill-warning",
			description: t("course.problemSet.tier2Desc"),
		};
	}
	return {
		label: t("course.problemSet.tier3Label"),
		pill: "study-pill study-pill-accent",
		description: t("course.problemSet.tier3Desc"),
	};
}

function countWords(text: string): number {
	const trimmed = text.trim();
	if (!trimmed) return 0;
	return trimmed.split(/\s+/u).filter(Boolean).length;
}

const ProblemSetItemRow = memo(function ProblemSetItemRow({
	item,
	idx,
	fieldId,
	value,
	disabled,
	onAnswerChange,
	t,
}: {
	item: ProblemSetItem;
	idx: number;
	fieldId: string;
	value: string;
	disabled: boolean;
	onAnswerChange: (itemId: string, next: string) => void;
	t: Translator;
}) {
	const words = countWords(value);
	const metMin = words >= item.minWords;
	return (
		<li className="space-y-2 rounded-xl border border-border/55 bg-background/60 p-3.5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<label htmlFor={fieldId} className="text-sm font-semibold text-foreground">
					{idx + 1}. {item.nodeTitle}
				</label>
				<span className={`text-xs tabular-nums ${metMin ? "text-[var(--cel-success-text,var(--lh-success))]" : "text-muted-foreground"}`}>
					{t("course.problemSet.minWords", { words, min: item.minWords })}
				</span>
			</div>
			<p className="max-w-[65ch] text-[15px] leading-relaxed text-foreground/95">
				{item.prompt}
			</p>
			{item.hint && (
				<details className="study-disclosure text-xs">
					<summary>{t("course.problemSet.hintSummary")}</summary>
					<div className="study-disclosure-body text-muted-foreground">
						{item.hint}
					</div>
				</details>
			)}
			<textarea
				id={fieldId}
				name={item.id}
				className="cel-input min-h-24 w-full resize-y p-3 text-sm leading-relaxed"
				placeholder={t("course.problemSet.answerPlaceholder")}
				maxLength={10000}
				disabled={disabled}
				value={value}
				onChange={(e) => onAnswerChange(item.id, e.target.value)}
			/>
		</li>
	);
});

type ProblemSetLabStep = NonNullable<ModuleProblemSet["lab"]>["steps"][number];

const ProblemSetLabStepRow = memo(function ProblemSetLabStepRow({
	step,
	idx,
	stepFieldId,
	note,
	disabled,
	onNoteChange,
	t,
}: {
	step: ProblemSetLabStep;
	idx: number;
	stepFieldId: string;
	note: string;
	disabled: boolean;
	onNoteChange: (stepId: string, next: string) => void;
	t: Translator;
}) {
	const words = countWords(note);
	const metMin = words >= step.minWords;
	return (
		<li className="flex flex-col gap-2 rounded-xl border border-border/55 bg-background/65 p-3.5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<label htmlFor={stepFieldId} className="text-sm font-semibold text-foreground">
					{idx + 1}/4 · {step.phase}
				</label>
				<span className={`text-xs tabular-nums ${metMin ? "text-[var(--cel-success-text,var(--lh-success))]" : "text-muted-foreground"}`}>
					{t("course.problemSet.wordsCount", { words, min: step.minWords })}
				</span>
			</div>
			<p className="text-xs leading-relaxed text-muted-foreground">
				{step.prompt}
			</p>
			<textarea
				id={stepFieldId}
				name={`lab:${step.id}`}
				className="cel-input mt-auto min-h-24 w-full resize-y p-2.5 text-sm leading-relaxed"
				placeholder={t("course.problemSet.labStepPlaceholder", { phase: step.phase })}
				maxLength={6000}
				disabled={disabled}
				value={note}
				onChange={(e) => onNoteChange(step.id, e.target.value)}
			/>
		</li>
	);
});

export function ProblemSetPanel({
	domainId,
	moduleId,
	moduleTitle,
	onClose,
	onGraded,
}: ProblemSetPanelProps) {
	const { t, intl } = useI18n();
	const formId = useId();
	const [loading, setLoading] = useState(true);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState("");
	const [problemSet, setProblemSet] = useState<ModuleProblemSet | null>(null);
	const [answers, setAnswers] = useState<Record<string, string>>({});
	const [labNotes, setLabNotes] = useState<Record<string, string>>({});
	const [result, setResult] = useState<ProblemSetResult | null>(null);
	const [attemptKey, setAttemptKey] = useState(0);

	const scoreFmt = useMemo(
		() => new Intl.NumberFormat(intl, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
		[intl],
	);

	const loadSet = useCallback(
		(seedOverride?: string, signal?: AbortSignal) => {
			setLoading(true);
			setError("");
			const params = new URLSearchParams({ module: moduleId });
			if (seedOverride) params.set("seed", seedOverride);
			fetch(`/api/study/problem-set?${params.toString()}`, { signal })
				.then(async (res) => {
					const data = (await res.json().catch(() => null)) as (ProblemSetGetPayload & Partial<ModuleProblemSet>) | null;
					if (!res.ok) throw new Error(data?.error ?? t("course.problemSet.errLoad"));
					const loaded =
						data?.problemSet ?? data?.set ?? (Array.isArray(data?.items) ? (data as ModuleProblemSet) : null);
					if (!loaded) throw new Error(t("course.problemSet.errFormat"));
					if (signal?.aborted) return;
					setProblemSet(loaded);
					setAnswers({});
					setLabNotes({});
					setResult(null);
				})
				.catch((err: unknown) => {
					if (signal?.aborted) return;
					setError(err instanceof Error ? err.message : t("course.problemSet.errLoad"));
				})
				.finally(() => {
					if (!signal?.aborted) setLoading(false);
				});
		},
		[moduleId, t],
	);

	useEffect(() => {
		const ctrl = new AbortController();
		loadSet(attemptKey > 0 ? `retry-${attemptKey}-${Date.now()}` : undefined, ctrl.signal);
		return () => ctrl.abort();
	}, [loadSet, attemptKey]);

	const groupedItems = useMemo(() => {
		const groups: { tier: ProblemSetTier; items: ProblemSetItem[] }[] = [
			{ tier: 1, items: [] },
			{ tier: 2, items: [] },
			{ tier: 3, items: [] },
		];
		if (!problemSet) return groups;
		for (const item of problemSet.items) {
			groups[item.tier - 1]?.items.push(item);
		}
		return groups.filter((g) => g.items.length > 0);
	}, [problemSet]);

	const itemTitleById = useMemo(() => {
		const map = new Map<string, string>();
		for (const item of problemSet?.items ?? []) {
			map.set(item.id, item.nodeTitle);
		}
		return map;
	}, [problemSet]);

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!problemSet || submitting) return;
		const hasAnyExercise = problemSet.items.some((item) => Boolean((answers[item.id] ?? "").trim()));
		const hasAnyLab = problemSet.lab?.steps.some((step) => Boolean((labNotes[step.id] ?? "").trim())) ?? false;
		if (!hasAnyExercise && !hasAnyLab) {
			setError(t("course.problemSet.errEmpty"));
			return;
		}
		setSubmitting(true);
		setError("");
		try {
			const res = await fetch("/api/study/problem-set", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					moduleId: problemSet.moduleId,
					answers,
					seed: problemSet.seed,
					...(problemSet.lab ? { labNotes } : {}),
				}),
			});
			const data = (await res.json().catch(() => null)) as (ProblemSetPostPayload & Partial<ProblemSetResult>) | null;
			if (!res.ok) throw new Error(data?.error ?? t("course.problemSet.errGrade"));
			const graded = data?.result ?? (typeof data?.score10 === "number" ? (data as ProblemSetResult) : null);
			if (!graded) throw new Error(t("course.problemSet.errGradeResponse"));
			setResult(graded);
			onGraded?.(graded);
		} catch (err) {
			setError(err instanceof Error ? err.message : t("course.problemSet.errSubmit"));
		} finally {
			setSubmitting(false);
		}
	};

	const handleAnswerChange = useCallback((itemId: string, next: string) => {
		setAnswers((prev) => ({ ...prev, [itemId]: next }));
		setError((prev) => (prev ? "" : prev));
	}, []);

	const handleLabNoteChange = useCallback((stepId: string, next: string) => {
		setLabNotes((prev) => ({ ...prev, [stepId]: next }));
		setError((prev) => (prev ? "" : prev));
	}, []);

	const mapHref = (nodeId: string) =>
		`/mapa?dominio=${encodeURIComponent(domainId)}&no=${encodeURIComponent(nodeId)}`;

	const showFalstad = Boolean(
		problemSet?.lab && (problemSet.domainId === "electronics" || CIRCUIT_PRESETS.has(problemSet.lab.preset)),
	);

	return (
		<section
			aria-label={t("course.problemSet.aria", { title: moduleTitle })}
			data-testid="problem-set-panel"
			className="cel-card space-y-4 p-4 md:p-5"
		>
			<div className="flex flex-wrap items-start justify-between gap-2 border-b border-border/50 pb-3">
				<div className="min-w-0 flex-1 space-y-0.5">
					<div className="flex flex-wrap items-center gap-2">
						<Icon name="activity" size={18} />
						<h3 className="cel-display text-lg leading-tight">
							{problemSet?.lab ? t("course.problemSet.titleWithLab") : t("course.problemSet.title")}
						</h3>
						<span className="study-pill">{t("course.problemSet.tiersBadge")}</span>
						{problemSet?.lab && <span className="study-pill study-pill-info">{t("course.problemSet.labBadge")}</span>}
					</div>
					<p className="text-xs text-muted-foreground">
						{t("course.problemSet.subtitle", { title: moduleTitle })}
					</p>
				</div>
				{onClose && (
					<button
						type="button"
						aria-label={t("course.problemSet.closeAria")}
						className="cel-button cel-button-ghost min-h-8 px-2 py-1 text-xs"
						onClick={onClose}
					>
						<Icon name="close" size={14} tone={false} />
						{t("common.action.close")}
					</button>
				)}
			</div>

			{loading && (
				<p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
					<Icon name="loader" size={16} live />
					{t("course.problemSet.loading")}
				</p>
			)}

			{!loading && error && !problemSet && (
				<div className="space-y-2.5">
					<p role="alert" className="text-sm text-destructive">{error}</p>
					<button
						type="button"
						className="cel-button min-h-9 px-3.5 py-1.5 text-xs"
						onClick={() => setAttemptKey((k) => k + 1)}
					>
						{t("common.action.retry")}
					</button>
				</div>
			)}

			{!loading && problemSet && !result && (
				<form className="space-y-5" onSubmit={handleSubmit}>
					{groupedItems.map((group) => {
						const meta = tierMeta(t, group.tier);
						return (
							<div key={group.tier} className="space-y-3">
								<div className="flex flex-wrap items-center gap-2">
									<span className={meta.pill}>
										{t("course.problemSet.tierHeading", { tier: group.tier, label: meta.label })}
									</span>
									<span className="text-xs text-muted-foreground">{meta.description}</span>
								</div>
								<ol className="space-y-3">
									{group.items.map((item, idx) => (
										<ProblemSetItemRow
											key={item.id}
											item={item}
											idx={idx}
											fieldId={`${formId}-item-${item.id}`}
											value={answers[item.id] ?? ""}
											disabled={submitting}
											onAnswerChange={handleAnswerChange}
											t={t}
										/>
									))}
								</ol>
							</div>
						);
					})}

					{problemSet.lab && (
						<div className="space-y-3 border-t border-border/55 pt-4" data-testid="problem-set-lab">
							<div className="flex flex-wrap items-start justify-between gap-2">
								<div className="min-w-0 flex-1 space-y-1">
									<div className="flex flex-wrap items-center gap-2">
										<Icon name="resistor" size={18} />
										<h4 className="cel-display text-base leading-tight">{t("course.problemSet.labTitle")}</h4>
										<span className="study-pill study-pill-info">{problemSet.lab.preset}</span>
									</div>
									<p className="max-w-[65ch] text-xs leading-relaxed text-muted-foreground">
										{problemSet.lab.objective}
									</p>
								</div>
								{showFalstad && (
									<a
										href={FALSTAD_URL}
										target="_blank"
										rel="noreferrer"
										className="cel-button min-h-8 shrink-0 px-3 py-1 text-xs"
									>
										<Icon name="arrow-up-right" size={13} tone={false} />
										{t("course.problemSet.openFalstad")}
									</a>
								)}
							</div>

							<ol className="grid gap-3 md:grid-cols-2">
								{problemSet.lab.steps.map((step, idx) => (
									<ProblemSetLabStepRow
										key={step.id}
										step={step}
										idx={idx}
										stepFieldId={`${formId}-lab-${step.id}`}
										note={labNotes[step.id] ?? ""}
										disabled={submitting}
										onNoteChange={handleLabNoteChange}
										t={t}
									/>
								))}
							</ol>
						</div>
					)}

					{error && <p role="alert" className="text-sm text-destructive">{error}</p>}

					<div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-3">
						<p className="text-xs text-muted-foreground">
							{problemSet.lab
								? t("course.problemSet.batchSummaryWithLab", { count: problemSet.items.length })
								: t("course.problemSet.batchSummary", { count: problemSet.items.length })}
						</p>
						<button
							type="submit"
							data-testid="problem-set-submit"
							className="cel-button cel-button-primary min-h-10 px-4 py-2 text-sm"
							disabled={submitting}
						>
							<Icon name="check" size={15} />
							{submitting
								? t("course.problemSet.submitting")
								: problemSet.lab
									? t("course.problemSet.submitWithLab")
									: t("course.problemSet.submit")}
						</button>
					</div>
				</form>
			)}

			{result && (
				<div data-testid="problem-set-result" className="space-y-4">
					<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/75 p-4">
						<div className="space-y-1">
							<div className="flex flex-wrap items-center gap-2">
								<span className="cel-display text-2xl tabular-nums">{scoreFmt.format(result.score10)}/10</span>
								<span className={result.passed ? "study-pill study-pill-success" : "study-pill study-pill-warning"}>
									{result.passed ? t("course.problemSet.passed") : t("course.problemSet.reviewItems")}
								</span>
								<span className="text-xs text-muted-foreground tabular-nums">
									{t("course.problemSet.correctCount", {
										correct: result.correctCount,
										total: result.totalCount,
									})}
								</span>
							</div>
							<p className="max-w-[65ch] text-sm leading-relaxed text-foreground/90">{result.summary}</p>
						</div>
					</div>

					<dl className="grid gap-2.5 sm:grid-cols-3">
						{([1, 2, 3] as const).map((tier) => {
							const stats = result.byTier[tier];
							const meta = tierMeta(t, tier);
							return (
								<div key={tier} className="rounded-xl border border-border/50 bg-background/60 p-3">
									<dt className="text-xs text-muted-foreground">{meta.label}</dt>
									<dd className="cel-display mt-1 text-lg tabular-nums">
										{stats.correct}/{stats.total}
										<span className="ml-1.5 text-xs font-normal text-muted-foreground">
											{t("course.problemSet.correctLabel")}
										</span>
									</dd>
								</div>
							);
						})}
					</dl>

					{result.labResult && (
						<div className="space-y-2.5 rounded-xl border border-border/55 bg-background/65 p-3.5">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div className="flex items-center gap-2">
									<Icon name="resistor" size={16} />
									<strong className="cel-display text-sm">{t("course.problemSet.labEvaluation")}</strong>
								</div>
								<span className={result.labResult.passed ? "study-pill study-pill-success tabular-nums" : "study-pill study-pill-warning tabular-nums"}>
									{t("course.problemSet.labValidSteps", {
										completed: result.labResult.completedSteps,
										total: result.labResult.totalSteps,
									})}
								</span>
							</div>
							<p className="text-xs leading-relaxed text-foreground/90">{result.labResult.feedback}</p>
							<ul className="grid gap-2 sm:grid-cols-2">
								{result.labResult.stepResults.map((step) => (
									<li key={step.stepId} className="rounded-lg border border-border/45 bg-card/70 p-2.5 text-xs">
										<div className="flex items-center justify-between gap-2">
											<strong className="font-semibold text-foreground">{step.phase}</strong>
											<span className={step.passed ? "text-[var(--cel-success-text,var(--lh-success))]" : "text-[var(--cel-warning-text,var(--lh-warning))]"}>
												{step.passed ? t("course.problemSet.labStepValid") : t("course.problemSet.labStepPending")}
											</span>
										</div>
										<p className="mt-1 leading-relaxed text-muted-foreground">{step.feedback}</p>
									</li>
								))}
							</ul>
						</div>
					)}

					<ol className="space-y-2.5">
						{result.itemResults.map((item, idx) => {
							const meta = tierMeta(t, item.tier);
							const title = itemTitleById.get(item.itemId) ?? t("course.problemSet.exerciseFallback", { index: idx + 1 });
							return (
								<li
									key={item.itemId}
									className="space-y-1.5 rounded-xl border border-border/50 bg-background/60 p-3.5 text-sm"
								>
									<div className="flex flex-wrap items-center justify-between gap-2">
										<div className="flex flex-wrap items-center gap-2">
											<strong className="font-semibold">{idx + 1}. {title}</strong>
											<span className={meta.pill}>{meta.label}</span>
											<span className={item.passed ? "study-pill study-pill-success tabular-nums" : "study-pill study-pill-warning tabular-nums"}>
												{t("course.exam.gradeOutOf3", { grade: item.grade })}
											</span>
										</div>
										{!item.passed && (
											<Link
												href={mapHref(item.nodeId)}
												className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--cel-link,var(--lh-accent))] underline underline-offset-2"
											>
												<Icon name="map" size={13} tone={false} />
												{t("course.exam.reviewOnMap")}
											</Link>
										)}
									</div>
									<p className="text-xs leading-relaxed text-muted-foreground">{item.feedback}</p>
								</li>
							);
						})}
					</ol>

					<div className="flex flex-wrap items-center gap-2.5 pt-1">
						<button
							type="button"
							className="cel-button min-h-9 px-3.5 py-1.5 text-xs"
							onClick={() => setAttemptKey((k) => k + 1)}
						>
							{t("course.problemSet.newSet")}
						</button>
						{onClose && (
							<button
								type="button"
								className="cel-button cel-button-ghost min-h-9 px-3 py-1.5 text-xs"
								onClick={onClose}
							>
								{t("course.exam.backToSyllabus")}
							</button>
						)}
					</div>
				</div>
			)}
		</section>
	);
}
