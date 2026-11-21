"use client";

import { memo, useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/icon";
import { useI18n } from "@/components/i18n";
import type { ModuleExamResult, Translator } from "@/src/core";

export interface ModuleExamPanelProps {
	domainId: string;
	scope: "module" | "chapter";
	targetId: string;
	targetTitle: string;
	onClose?: () => void;
	onGraded?: (result: ModuleExamResult) => void;
}

interface PublicExamQuestion {
	id: string;
	prompt: string;
	rubricCriteria: string[];
	minWords: number;
	misconceptionTrap?: string;
}

interface PublicExamView {
	id: string;
	domainId: string;
	scope: "module" | "chapter";
	targetId: string;
	targetTitle: string;
	seed: string;
	passingScore10: number;
	questions: PublicExamQuestion[];
}

interface ModuleExamGetPayload {
	exam?: PublicExamView;
	publicQuestions?: PublicExamQuestion[];
	error?: string;
}

interface ModuleExamPostPayload {
	result?: ModuleExamResult;
	fireCreditsCount?: number;
	implicitCredits?: number | readonly unknown[];
	fireCredits?: number | readonly unknown[];
	encompassedCredits?: number | readonly unknown[];
	creditsApplied?: number | readonly unknown[];
	error?: string;
}

function countWords(text: string): number {
	const trimmed = text.trim();
	if (!trimmed) return 0;
	return trimmed.split(/\s+/u).filter(Boolean).length;
}

const ExamQuestionRow = memo(function ExamQuestionRow({
	question,
	idx,
	total,
	fieldId,
	value,
	disabled,
	onAnswerChange,
	t,
}: {
	question: PublicExamQuestion;
	idx: number;
	total: number;
	fieldId: string;
	value: string;
	disabled: boolean;
	onAnswerChange: (questionId: string, next: string) => void;
	t: Translator;
}) {
	const words = countWords(value);
	const metMin = words >= question.minWords;
	return (
		<li className="space-y-2 rounded-xl border border-border/55 bg-background/60 p-3.5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<label htmlFor={fieldId} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
					{t("course.exam.itemOf", { index: idx + 1, total })}
				</label>
				<span className={`text-xs tabular-nums ${metMin ? "text-[var(--cel-success-text,var(--lh-success))]" : "text-muted-foreground"}`}>
					{t("course.exam.minWords", { words, min: question.minWords })}
				</span>
			</div>
			<p className="max-w-[65ch] text-[16px] leading-relaxed text-foreground">
				{question.prompt}
			</p>
			<textarea
				id={fieldId}
				name={question.id}
				className="cel-input min-h-28 w-full resize-y p-3 text-sm leading-relaxed"
				placeholder={t("course.exam.answerPlaceholder")}
				maxLength={12000}
				disabled={disabled}
				value={value}
				onChange={(e) => onAnswerChange(question.id, e.target.value)}
			/>
		</li>
	);
});

function extractCreditCount(data: ModuleExamPostPayload | null): number {
	if (!data || typeof data !== "object") return 0;
	const candidates = [
		data.fireCreditsCount,
		data.implicitCredits,
		data.fireCredits,
		data.encompassedCredits,
		data.creditsApplied,
	];
	for (const value of candidates) {
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (Array.isArray(value)) return value.length;
	}
	return 0;
}

export function ModuleExamPanel({
	domainId,
	scope,
	targetId,
	targetTitle,
	onClose,
	onGraded,
}: ModuleExamPanelProps) {
	const { t, intl } = useI18n();
	const formId = useId();
	const [loading, setLoading] = useState(true);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState("");
	const [exam, setExam] = useState<PublicExamView | null>(null);
	const [answers, setAnswers] = useState<Record<string, string>>({});
	const [result, setResult] = useState<ModuleExamResult | null>(null);
	const [fireCredits, setFireCredits] = useState(0);
	const [attemptKey, setAttemptKey] = useState(0);

	const scoreFmt = useMemo(
		() => new Intl.NumberFormat(intl, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
		[intl],
	);

	const loadExam = useCallback(
		(seedOverride?: string, signal?: AbortSignal) => {
			setLoading(true);
			setError("");
			const params = new URLSearchParams({ scope, target: targetId });
			if (seedOverride) params.set("seed", seedOverride);
			fetch(`/api/study/module-exam?${params.toString()}`, { signal })
				.then(async (res) => {
					const data = (await res.json().catch(() => null)) as (ModuleExamGetPayload & Partial<PublicExamView>) | null;
					if (!res.ok) throw new Error(data?.error ?? t("course.exam.errLoad"));
					const loaded = data?.exam ?? (Array.isArray(data?.questions) ? (data as PublicExamView) : null);
					if (!loaded) throw new Error(t("course.exam.errFormat"));
					if (signal?.aborted) return;
					setExam(loaded);
					setAnswers({});
					setResult(null);
					setFireCredits(0);
				})
				.catch((err: unknown) => {
					if (signal?.aborted) return;
					setError(err instanceof Error ? err.message : t("course.exam.errLoad"));
				})
				.finally(() => {
					if (!signal?.aborted) setLoading(false);
				});
		},
		[scope, targetId, t],
	);

	useEffect(() => {
		const ctrl = new AbortController();
		loadExam(attemptKey > 0 ? `retry-${attemptKey}-${Date.now()}` : undefined, ctrl.signal);
		return () => ctrl.abort();
	}, [loadExam, attemptKey]);

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!exam || submitting) return;
		const unanswered = exam.questions.filter((q) => !(answers[q.id] ?? "").trim());
		if (unanswered.length === exam.questions.length) {
			setError(t("course.exam.errEmpty"));
			return;
		}
		setSubmitting(true);
		setError("");
		try {
			const res = await fetch("/api/study/module-exam", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					scope,
					targetId,
					answers,
					seed: exam.seed,
				}),
			});
			const data = (await res.json().catch(() => null)) as (ModuleExamPostPayload & Partial<ModuleExamResult>) | null;
			if (!res.ok) {
				throw new Error(data?.error ?? t("course.exam.errGrade"));
			}
			const graded = data?.result ?? (typeof data?.score10 === "number" ? (data as ModuleExamResult) : null);
			if (!graded) throw new Error(t("course.exam.errGradeResponse"));
			setResult(graded);
			setFireCredits(extractCreditCount(data));
			onGraded?.(graded);
		} catch (err) {
			setError(err instanceof Error ? err.message : t("course.exam.errSubmit"));
		} finally {
			setSubmitting(false);
		}
	};

	const handleAnswerChange = useCallback((questionId: string, next: string) => {
		setAnswers((prev) => ({ ...prev, [questionId]: next }));
		setError((prev) => (prev ? "" : prev));
	}, []);

	const mapHref = (nodeId: string) =>
		`/mapa?dominio=${encodeURIComponent(domainId)}&no=${encodeURIComponent(nodeId)}`;

	const scopeLabel = scope === "chapter" ? t("course.exam.chapterTitle") : t("course.exam.moduleTitle");

	return (
		<section
			aria-label={`${scopeLabel} · ${targetTitle}`}
			data-testid="module-exam-panel"
			data-exam-scope={scope}
			className="cel-card space-y-4 p-4 md:p-5"
		>
			<div className="flex flex-wrap items-start justify-between gap-2 border-b border-border/50 pb-3">
				<div className="min-w-0 flex-1 space-y-0.5">
					<div className="flex flex-wrap items-center gap-2">
						<Icon name="exercise" size={18} />
						<h3 className="cel-display text-lg leading-tight">{scopeLabel}</h3>
						<span className="study-pill study-pill-accent">{t("course.exam.interleaved")}</span>
					</div>
					<p className="text-xs text-muted-foreground">
						{t("course.exam.subtitle", {
							title: targetTitle,
							passing: scoreFmt.format(exam ? exam.passingScore10 : 7.5),
						})}
					</p>
				</div>
				{onClose && (
					<button
						type="button"
						aria-label={t("course.exam.closeAria")}
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
					{t("course.exam.loading")}
				</p>
			)}

			{!loading && error && !exam && (
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

			{!loading && exam && !result && (
				exam.questions.length === 0 ? (
					<p className="text-sm text-muted-foreground">{t("course.exam.noEligibleQuestions")}</p>
				) : (
					<form className="space-y-4" onSubmit={handleSubmit}>
						<ol className="space-y-4">
							{exam.questions.map((question, idx) => (
								<ExamQuestionRow
									key={question.id}
									question={question}
									idx={idx}
									total={exam.questions.length}
									fieldId={`${formId}-q-${idx + 1}`}
									value={answers[question.id] ?? ""}
									disabled={submitting}
									onAnswerChange={handleAnswerChange}
									t={t}
								/>
							))}
						</ol>

						{error && <p role="alert" className="text-sm text-destructive">{error}</p>}

						<div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-3">
							<p className="text-xs text-muted-foreground">
								{t("course.exam.batchHint")}
							</p>
							<button
								type="submit"
								data-testid="module-exam-submit"
								className="cel-button cel-button-primary min-h-10 px-4 py-2 text-sm"
								disabled={submitting}
							>
								<Icon name="check" size={15} />
								{submitting ? t("course.exam.submitting") : t("course.exam.submit")}
							</button>
						</div>
					</form>
				)
			)}

			{result && (
				<div data-testid="module-exam-result" className="space-y-4">
					<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/75 p-4">
						<div className="space-y-1">
							<div className="flex flex-wrap items-center gap-2">
								<span className="cel-display text-2xl tabular-nums">{scoreFmt.format(result.score10)}/10</span>
								<span className={result.passed ? "study-pill study-pill-success" : "study-pill study-pill-warning"}>
									{result.passed ? t("course.exam.passed") : t("course.exam.reinforce")}
								</span>
								{result.hasZeroQuestion && (
									<span className="study-pill study-pill-warning">{t("course.exam.zeroedQuestion")}</span>
								)}
							</div>
							<p className="max-w-[65ch] text-sm leading-relaxed text-foreground/90">{result.summary}</p>
						</div>
						<div className="rounded-xl border border-border/50 bg-card/80 px-3 py-2 text-right">
							<p className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("course.exam.fireCredits")}</p>
							<p className="cel-display text-lg tabular-nums">{fireCredits}</p>
						</div>
					</div>

					<ol className="space-y-2.5">
						{result.questionResults.map((qr, idx) => (
							<li
								key={qr.questionId}
								className="space-y-1.5 rounded-xl border border-border/50 bg-background/60 p-3.5 text-sm"
							>
								<div className="flex flex-wrap items-center justify-between gap-2">
									<div className="flex flex-wrap items-center gap-2">
										<strong className="font-semibold">{t("course.exam.questionNumber", { index: idx + 1 })}</strong>
										<span className={qr.grade >= 2 ? "study-pill study-pill-success tabular-nums" : "study-pill study-pill-warning tabular-nums"}>
											{t("course.exam.gradeOutOf3", { grade: qr.grade })}
										</span>
										<span className="text-xs text-muted-foreground tabular-nums">
											{t("course.exam.criteriaWords", {
												matched: qr.matchedCriteria,
												total: qr.totalCriteria,
												words: qr.wordCount,
											})}
										</span>
									</div>
									{qr.grade <= 1 && (
										<Link
											href={mapHref(qr.nodeId)}
											className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--cel-link,var(--lh-accent))] underline underline-offset-2"
										>
											<Icon name="map" size={13} tone={false} />
											{t("course.exam.reviewOnMap")}
										</Link>
									)}
								</div>
								<p className="text-xs leading-relaxed text-muted-foreground">{qr.feedback}</p>
							</li>
						))}
					</ol>

					{result.weakNodeIds.length > 0 && (
						<div className="space-y-2 rounded-xl border border-border/55 bg-background/70 p-3.5">
							<p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								<Icon name="weak-spot" size={14} />
								{t("course.exam.weakTopics", { count: result.weakNodeIds.length })}
							</p>
							<div className="flex flex-wrap gap-2">
								{[...new Set(result.weakNodeIds)].map((nodeId, idx) => (
									<Link
										key={nodeId}
										href={mapHref(nodeId)}
										className="cel-button min-h-8 px-3 py-1 text-xs"
									>
										<Icon name="map" size={13} tone={false} />
										{t("course.exam.reviewTopicOnMap", { index: idx + 1 })}
									</Link>
								))}
							</div>
						</div>
					)}

					<div className="flex flex-wrap items-center gap-2.5 pt-1">
						<button
							type="button"
							className="cel-button min-h-9 px-3.5 py-1.5 text-xs"
							onClick={() => setAttemptKey((k) => k + 1)}
						>
							{t("course.exam.newVersion")}
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
