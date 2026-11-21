"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/icon";
import type {
	LabPreset,
	ModuleProblemSet,
	ProblemSetItem,
	ProblemSetResult,
	ProblemSetTier,
	ProblemSetTierLabel,
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

const TIER_META: Record<ProblemSetTier, { label: ProblemSetTierLabel; pill: string; description: string }> = {
	1: {
		label: "Aplicação direta",
		pill: "study-pill study-pill-info",
		description: "Execução guiada dos procedimentos e conceitos fundamentais do módulo.",
	},
	2: {
		label: "Diagnóstico e contraste",
		pill: "study-pill study-pill-warning",
		description: "Identificação de erros comuns, comparação de cenários e correção fundamentada.",
	},
	3: {
		label: "Síntese",
		pill: "study-pill study-pill-accent",
		description: "Integração de múltiplos tópicos, trade-offs e condições-limite.",
	},
};

const CIRCUIT_PRESETS = new Set<LabPreset>(["divider", "rc-filter", "rlc", "rectifier", "circuit"]);

function countWords(text: string): number {
	const trimmed = text.trim();
	if (!trimmed) return 0;
	return trimmed.split(/\s+/u).filter(Boolean).length;
}

function formatScore(score: number): string {
	return score.toFixed(1).replace(".", ",");
}

export function ProblemSetPanel({
	domainId,
	moduleId,
	moduleTitle,
	onClose,
	onGraded,
}: ProblemSetPanelProps) {
	const formId = useId();
	const [loading, setLoading] = useState(true);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState("");
	const [problemSet, setProblemSet] = useState<ModuleProblemSet | null>(null);
	const [answers, setAnswers] = useState<Record<string, string>>({});
	const [labNotes, setLabNotes] = useState<Record<string, string>>({});
	const [result, setResult] = useState<ProblemSetResult | null>(null);
	const [attemptKey, setAttemptKey] = useState(0);

	const loadSet = useCallback((seedOverride?: string, signal?: AbortSignal) => {
		setLoading(true);
		setError("");
		const params = new URLSearchParams({ module: moduleId });
		if (seedOverride) params.set("seed", seedOverride);
		fetch(`/api/study/problem-set?${params.toString()}`, { signal })
			.then(async (res) => {
				const data = (await res.json().catch(() => null)) as (ProblemSetGetPayload & Partial<ModuleProblemSet>) | null;
				if (!res.ok) throw new Error(data?.error ?? "Não foi possível carregar a lista de exercícios.");
				const loaded = data?.problemSet ?? data?.set ?? (Array.isArray(data?.items) ? (data as ModuleProblemSet) : null);
				if (!loaded) throw new Error("Formato inválido de lista retornado pelo servidor.");
				if (signal?.aborted) return;
				setProblemSet(loaded);
				setAnswers({});
				setLabNotes({});
				setResult(null);
			})
			.catch((err: unknown) => {
				if (signal?.aborted) return;
				setError(err instanceof Error ? err.message : "Não foi possível carregar a lista de exercícios.");
			})
			.finally(() => {
				if (!signal?.aborted) setLoading(false);
			});
	}, [moduleId]);

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
			setError("Preencha pelo menos uma resposta antes de entregar a lista.");
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
			if (!res.ok) throw new Error(data?.error ?? "Não foi possível corrigir a lista de exercícios.");
			const graded = data?.result ?? (typeof data?.score10 === "number" ? (data as ProblemSetResult) : null);
			if (!graded) throw new Error("Resposta de correção inválida.");
			setResult(graded);
			onGraded?.(graded);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Falha ao entregar a lista de exercícios.");
		} finally {
			setSubmitting(false);
		}
	};

	const mapHref = (nodeId: string) =>
		`/mapa?dominio=${encodeURIComponent(domainId)}&no=${encodeURIComponent(nodeId)}`;

	const showFalstad = Boolean(
		problemSet?.lab && (problemSet.domainId === "electronics" || CIRCUIT_PRESETS.has(problemSet.lab.preset)),
	);

	return (
		<section
			aria-label={`Lista de exercícios · ${moduleTitle}`}
			data-testid="problem-set-panel"
			className="cel-card space-y-4 p-4 md:p-5"
		>
			<div className="flex flex-wrap items-start justify-between gap-2 border-b border-border/50 pb-3">
				<div className="min-w-0 flex-1 space-y-0.5">
					<div className="flex flex-wrap items-center gap-2">
						<Icon name="activity" size={18} />
						<h3 className="cel-display text-lg leading-tight">Lista de Exercícios{problemSet?.lab ? " & Laboratório" : ""}</h3>
						<span className="study-pill">3 níveis</span>
						{problemSet?.lab && <span className="study-pill study-pill-info">Lab 4 etapas</span>}
					</div>
					<p className="text-xs text-muted-foreground">
						{moduleTitle} · Resolva tudo em lote sem interrupções e receba correção detalhada por nível.
					</p>
				</div>
				{onClose && (
					<button
						type="button"
						aria-label="Fechar lista de exercícios"
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
					Preparando lista gradual de exercícios…
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
						Tentar novamente
					</button>
				</div>
			)}

			{!loading && problemSet && !result && (
				<form className="space-y-5" onSubmit={handleSubmit}>
					{groupedItems.map((group) => {
						const meta = TIER_META[group.tier];
						return (
							<div key={group.tier} className="space-y-3">
								<div className="flex flex-wrap items-center gap-2">
									<span className={meta.pill}>Nível {group.tier} · {meta.label}</span>
									<span className="text-xs text-muted-foreground">{meta.description}</span>
								</div>
								<ol className="space-y-3">
									{group.items.map((item, idx) => {
										const fieldId = `${formId}-item-${item.id}`;
										const value = answers[item.id] ?? "";
										const words = countWords(value);
										const metMin = words >= item.minWords;
										return (
											<li
												key={item.id}
												className="space-y-2 rounded-xl border border-border/55 bg-background/60 p-3.5"
											>
												<div className="flex flex-wrap items-center justify-between gap-2">
													<label htmlFor={fieldId} className="text-sm font-semibold text-foreground">
														{idx + 1}. {item.nodeTitle}
													</label>
													<span className={`text-xs tabular-nums ${metMin ? "text-[var(--cel-success-text,var(--lh-success))]" : "text-muted-foreground"}`}>
														{words}/{item.minWords} palavras mín.
													</span>
												</div>
												<p className="max-w-[65ch] text-[15px] leading-relaxed text-foreground/95">
													{item.prompt}
												</p>
												{item.hint && (
													<details className="study-disclosure text-xs">
														<summary>Dica de atenção</summary>
														<div className="study-disclosure-body text-muted-foreground">
															{item.hint}
														</div>
													</details>
												)}
												<textarea
													id={fieldId}
													name={item.id}
													className="cel-input min-h-24 w-full resize-y p-3 text-sm leading-relaxed"
													placeholder="Desenvolva sua resolução e justificativa…"
													maxLength={10000}
													disabled={submitting}
													value={value}
													onChange={(e) => {
														const next = e.target.value;
														setAnswers((prev) => ({ ...prev, [item.id]: next }));
														if (error) setError("");
													}}
												/>
											</li>
										);
									})}
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
										<h4 className="cel-display text-base leading-tight">Roteiro de Laboratório</h4>
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
										Abrir simulador Falstad
									</a>
								)}
							</div>

							<ol className="grid gap-3 md:grid-cols-2">
								{problemSet.lab.steps.map((step, idx) => {
									const stepFieldId = `${formId}-lab-${step.id}`;
									const note = labNotes[step.id] ?? "";
									const words = countWords(note);
									const metMin = words >= step.minWords;
									return (
										<li
											key={step.id}
											className="flex flex-col gap-2 rounded-xl border border-border/55 bg-background/65 p-3.5"
										>
											<div className="flex flex-wrap items-center justify-between gap-2">
												<label htmlFor={stepFieldId} className="text-sm font-semibold text-foreground">
													{idx + 1}/4 · {step.phase}
												</label>
												<span className={`text-xs tabular-nums ${metMin ? "text-[var(--cel-success-text,var(--lh-success))]" : "text-muted-foreground"}`}>
													{words}/{step.minWords} palavras
												</span>
											</div>
											<p className="text-xs leading-relaxed text-muted-foreground">
												{step.prompt}
											</p>
											<textarea
												id={stepFieldId}
												name={`lab:${step.id}`}
												className="cel-input mt-auto min-h-24 w-full resize-y p-2.5 text-sm leading-relaxed"
												placeholder={`Registre a etapa "${step.phase}"…`}
												maxLength={6000}
												disabled={submitting}
												value={note}
												onChange={(e) => {
													const next = e.target.value;
													setLabNotes((prev) => ({ ...prev, [step.id]: next }));
													if (error) setError("");
												}}
											/>
										</li>
									);
								})}
							</ol>
						</div>
					)}

					{error && <p role="alert" className="text-sm text-destructive">{error}</p>}

					<div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-3">
						<p className="text-xs text-muted-foreground">
							{problemSet.items.length} exercícios{problemSet.lab ? " + 4 etapas de laboratório" : ""} enviados em lote.
						</p>
						<button
							type="submit"
							data-testid="problem-set-submit"
							className="cel-button cel-button-primary min-h-10 px-4 py-2 text-sm"
							disabled={submitting}
						>
							<Icon name="check" size={15} />
							{submitting ? "Corrigindo lista…" : problemSet.lab ? "Entregar lista e laboratório" : "Entregar lista de exercícios"}
						</button>
					</div>
				</form>
			)}

			{result && (
				<div data-testid="problem-set-result" className="space-y-4">
					<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/75 p-4">
						<div className="space-y-1">
							<div className="flex flex-wrap items-center gap-2">
								<span className="cel-display text-2xl tabular-nums">{formatScore(result.score10)}/10</span>
								<span className={result.passed ? "study-pill study-pill-success" : "study-pill study-pill-warning"}>
									{result.passed ? "Lista concluída" : "Revisar itens"}
								</span>
								<span className="text-xs text-muted-foreground tabular-nums">
									{result.correctCount}/{result.totalCount} acertos
								</span>
							</div>
							<p className="max-w-[65ch] text-sm leading-relaxed text-foreground/90">{result.summary}</p>
						</div>
					</div>

					<dl className="grid gap-2.5 sm:grid-cols-3">
						{([1, 2, 3] as const).map((tier) => {
							const stats = result.byTier[tier];
							const meta = TIER_META[tier];
							return (
								<div key={tier} className="rounded-xl border border-border/50 bg-background/60 p-3">
									<dt className="text-xs text-muted-foreground">{meta.label}</dt>
									<dd className="cel-display mt-1 text-lg tabular-nums">
										{stats.correct}/{stats.total}
										<span className="ml-1.5 text-xs font-normal text-muted-foreground">acertos</span>
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
									<strong className="cel-display text-sm">Avaliação do Laboratório</strong>
								</div>
								<span className={result.labResult.passed ? "study-pill study-pill-success tabular-nums" : "study-pill study-pill-warning tabular-nums"}>
									{result.labResult.completedSteps}/{result.labResult.totalSteps} etapas válidas
								</span>
							</div>
							<p className="text-xs leading-relaxed text-foreground/90">{result.labResult.feedback}</p>
							<ul className="grid gap-2 sm:grid-cols-2">
								{result.labResult.stepResults.map((step) => (
									<li key={step.stepId} className="rounded-lg border border-border/45 bg-card/70 p-2.5 text-xs">
										<div className="flex items-center justify-between gap-2">
											<strong className="font-semibold text-foreground">{step.phase}</strong>
											<span className={step.passed ? "text-[var(--cel-success-text,var(--lh-success))]" : "text-[var(--cel-warning-text,var(--lh-warning))]"}>
												{step.passed ? "✓ Válida" : "Pendente"}
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
							const meta = TIER_META[item.tier];
							const title = itemTitleById.get(item.itemId) ?? `Exercício ${idx + 1}`;
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
												Nota {item.grade}/3
											</span>
										</div>
										{!item.passed && (
											<Link
												href={mapHref(item.nodeId)}
												className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--cel-link,var(--lh-accent))] underline underline-offset-2"
											>
												<Icon name="map" size={13} tone={false} />
												Revisar no mapa
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
							Nova lista de exercícios
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
