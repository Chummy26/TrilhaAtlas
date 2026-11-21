"use client";

import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/icon";
import { useT } from "@/components/i18n";
import type { ModuleExamResult } from "@/src/core";

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

function extractCreditCount(data: ModuleExamPostPayload | null): number {
	if (!data || typeof data !== "object") return 0;
	const candidates = [data.fireCreditsCount, data.implicitCredits, data.fireCredits, data.encompassedCredits, data.creditsApplied];
	for (const value of candidates) {
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (Array.isArray(value)) return value.length;
	}
	return 0;
}

function formatScore(score: number): string {
	return score.toFixed(1).replace(".", ",");
}

export function ModuleExamPanel({
	domainId,
	scope,
	targetId,
	targetTitle,
	onClose,
	onGraded,
}: ModuleExamPanelProps) {
	const t = useT();
	const formId = useId();
	const [loading, setLoading] = useState(true);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState("");
	const [exam, setExam] = useState<PublicExamView | null>(null);
	const [answers, setAnswers] = useState<Record<string, string>>({});
	const [result, setResult] = useState<ModuleExamResult | null>(null);
	const [fireCredits, setFireCredits] = useState(0);
	const [attemptKey, setAttemptKey] = useState(0);

	const loadExam = useCallback((seedOverride?: string, signal?: AbortSignal) => {
		setLoading(true);
		setError("");
		const params = new URLSearchParams({ scope, target: targetId });
		if (seedOverride) params.set("seed", seedOverride);
		fetch(`/api/study/module-exam?${params.toString()}`, { signal })
			.then(async (res) => {
				const data = (await res.json().catch(() => null)) as (ModuleExamGetPayload & Partial<PublicExamView>) | null;
				if (!res.ok) throw new Error(data?.error ?? "Não foi possível carregar a prova integradora.");
				const loaded = data?.exam ?? (Array.isArray(data?.questions) ? (data as PublicExamView) : null);
				if (!loaded) throw new Error("Formato inválido de prova retornado pelo servidor.");
				if (signal?.aborted) return;
				setExam(loaded);
				setAnswers({});
				setResult(null);
				setFireCredits(0);
			})
			.catch((err: unknown) => {
				if (signal?.aborted) return;
				setError(err instanceof Error ? err.message : "Não foi possível carregar a prova integradora.");
			})
			.finally(() => {
				if (!signal?.aborted) setLoading(false);
			});
	}, [scope, targetId]);

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
			setError("Responda às questões antes de entregar a prova integradora.");
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
				throw new Error(data?.error ?? "Não foi possível corrigir a prova integradora.");
			}
			const graded = data?.result ?? (typeof data?.score10 === "number" ? (data as ModuleExamResult) : null);
			if (!graded) throw new Error("Resposta de correção inválida.");
			setResult(graded);
			setFireCredits(extractCreditCount(data));
			onGraded?.(graded);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Falha ao entregar a prova integradora.");
		} finally {
			setSubmitting(false);
		}
	};

	const mapHref = (nodeId: string) =>
		`/mapa?dominio=${encodeURIComponent(domainId)}&no=${encodeURIComponent(nodeId)}`;

	const scopeLabel = scope === "chapter" ? "Prova Integradora do Capítulo" : "Prova Integradora do Módulo";

	return (
		<section
			aria-label={`${scopeLabel} · ${targetTitle}`}
			data-testid="module-exam-panel"
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
						{targetTitle} · Questões embaralhadas sem identificação de tópico (nota mínima {exam ? formatScore(exam.passingScore10) : "7,5"}/10, sem zerar questão).
					</p>
				</div>
				{onClose && (
					<button
						type="button"
						aria-label="Fechar prova integradora"
						className="cel-button cel-button-ghost min-h-8 px-2 py-1 text-xs"
						onClick={onClose}
					>
						<Icon name="close" size={14} tone={false} />
						Fechar
					</button>
				)}
			</div>

			{loading && (
				<p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
					<Icon name="loader" size={16} live />
					Montando questões intercaladas…
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
						Tentar novamente
					</button>
				</div>
			)}

			{!loading && exam && !result && (
				exam.questions.length === 0 ? (
					<p className="text-sm text-muted-foreground">{t("course.exam.noEligibleQuestions")}</p>
				) : (
					<form className="space-y-4" onSubmit={handleSubmit}>
						<ol className="space-y-4">
							{exam.questions.map((question, idx) => {
								const fieldId = `${formId}-q-${idx + 1}`;
								const value = answers[question.id] ?? "";
								const words = countWords(value);
								const metMin = words >= question.minWords;
								return (
									<li
										key={question.id}
										className="space-y-2 rounded-xl border border-border/55 bg-background/60 p-3.5"
									>
										<div className="flex flex-wrap items-center justify-between gap-2">
											<label htmlFor={fieldId} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
												Item {idx + 1} de {exam.questions.length}
											</label>
											<span className={`text-xs tabular-nums ${metMin ? "text-[var(--cel-success-text,var(--lh-success))]" : "text-muted-foreground"}`}>
												{words}/{question.minWords} palavras mín.
											</span>
										</div>
										<p className="max-w-[65ch] text-[16px] leading-relaxed text-foreground">
											{question.prompt}
										</p>
										<textarea
											id={fieldId}
											name={question.id}
											className="cel-input min-h-28 w-full resize-y p-3 text-sm leading-relaxed"
											placeholder="Identifique o princípio que governa a situação e desenvolva a solução com justificativa completa…"
											maxLength={12000}
											disabled={submitting}
											value={value}
											onChange={(e) => {
												const next = e.target.value;
												setAnswers((prev) => ({ ...prev, [question.id]: next }));
												if (error) setError("");
											}}
										/>
									</li>
								);
							})}
						</ol>

						{error && <p role="alert" className="text-sm text-destructive">{error}</p>}

						<div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-3">
							<p className="text-xs text-muted-foreground">
								Todas as questões são corrigidas em lote ao enviar.
							</p>
							<button
								type="submit"
								data-testid="module-exam-submit"
								className="cel-button cel-button-primary min-h-10 px-4 py-2 text-sm"
								disabled={submitting}
							>
								<Icon name="check" size={15} />
								{submitting ? "Corrigindo prova…" : "Entregar prova integradora"}
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
								<span className="cel-display text-2xl tabular-nums">{formatScore(result.score10)}/10</span>
								<span className={result.passed ? "study-pill study-pill-success" : "study-pill study-pill-warning"}>
									{result.passed ? "Aprovado" : "Reforço indicado"}
								</span>
								{result.hasZeroQuestion && (
									<span className="study-pill study-pill-warning">Questão zerada</span>
								)}
							</div>
							<p className="max-w-[65ch] text-sm leading-relaxed text-foreground/90">{result.summary}</p>
						</div>
						<div className="rounded-xl border border-border/50 bg-card/80 px-3 py-2 text-right">
							<p className="text-[11px] uppercase tracking-wider text-muted-foreground">Créditos implícitos FIRe</p>
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
										<strong className="font-semibold">Questão {idx + 1}</strong>
										<span className={qr.grade >= 2 ? "study-pill study-pill-success tabular-nums" : "study-pill study-pill-warning tabular-nums"}>
											Nota {qr.grade}/3
										</span>
										<span className="text-xs text-muted-foreground tabular-nums">
											{qr.matchedCriteria}/{qr.totalCriteria} critérios · {qr.wordCount} palavras
										</span>
									</div>
									{qr.grade <= 1 && (
										<Link
											href={mapHref(qr.nodeId)}
											className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--cel-link,var(--lh-accent))] underline underline-offset-2"
										>
											<Icon name="map" size={13} tone={false} />
											Revisar no mapa
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
								Tópicos para revisar no mapa ({result.weakNodeIds.length})
							</p>
							<div className="flex flex-wrap gap-2">
								{[...new Set(result.weakNodeIds)].map((nodeId, idx) => (
									<Link
										key={nodeId}
										href={mapHref(nodeId)}
										className="cel-button min-h-8 px-3 py-1 text-xs"
									>
										<Icon name="map" size={13} tone={false} />
										Revisar tópico {idx + 1} no mapa
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
							Gerar nova versão da prova
						</button>
						{onClose && (
							<button
								type="button"
								className="cel-button cel-button-ghost min-h-9 px-3 py-1.5 text-xs"
								onClick={onClose}
							>
								Voltar à ementa
							</button>
						)}
					</div>
				</div>
			)}
		</section>
	);
}
