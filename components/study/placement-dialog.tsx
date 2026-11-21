"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/icon";
import { useT } from "@/components/i18n";
import type { PlacementQuestion, PlacementSummary } from "@/src/core";

interface PlacementApiPayload {
	active?: boolean;
	done?: boolean;
	finished?: boolean;
	question?: PlacementQuestion | null;
	summary?: PlacementSummary | null;
	lastSummary?: PlacementSummary | null;
	error?: string;
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
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [question, setQuestion] = useState<PlacementQuestion | null>(null);
	const [summary, setSummary] = useState<PlacementSummary | null>(null);

	const applyPayload = useCallback((raw: PlacementApiPayload | PlacementSummary | null, notify = false) => {
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
	}, [onCompleted]);

	useEffect(() => {
		const ctrl = new AbortController();
		setLoading(true);
		setError("");
		fetch("/api/study/placement", { signal: ctrl.signal })
			.then(async (res) => {
				const data = (await res.json().catch(() => null)) as PlacementApiPayload | null;
				if (!res.ok) throw new Error(data?.error ?? "Não foi possível carregar o nivelamento.");
				if (!ctrl.signal.aborted) applyPayload(data, false);
			})
			.catch((err: unknown) => {
				if (ctrl.signal.aborted) return;
				setError(err instanceof Error ? err.message : "Não foi possível carregar o nivelamento.");
			})
			.finally(() => {
				if (!ctrl.signal.aborted) setLoading(false);
			});
		return () => ctrl.abort();
	}, [applyPayload]);

	const runAction = useCallback(async (body: { action: "start" | "answer" | "finish"; nodeId?: string; correct?: boolean }) => {
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
				const message = data && "error" in data && typeof data.error === "string"
					? data.error
					: "Não foi possível atualizar o teste de nivelamento.";
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
					const message = finData && "error" in finData && typeof finData.error === "string"
						? finData.error
						: "Não foi possível concluir o nivelamento.";
					throw new Error(message);
				}
				applyPayload(finData, true);
				return;
			}
			applyPayload(data, body.action === "finish");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Erro ao comunicar com o servidor.");
		} finally {
			setBusy(false);
		}
	}, [applyPayload]);

	const cancelPlacement = useCallback(async () => {
		setBusy(true);
		setError("");
		try {
			const res = await fetch("/api/study/placement", { method: "DELETE" });
			if (!res.ok) {
				const data = (await res.json().catch(() => null)) as { error?: string } | null;
				throw new Error(data?.error ?? "Não foi possível cancelar o nivelamento.");
			}
			setQuestion(null);
			setSummary(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Não foi possível cancelar o nivelamento.");
		} finally {
			setBusy(false);
		}
	}, []);

	const mapHref = (nodeId: string) =>
		domainId
			? `/mapa?dominio=${encodeURIComponent(domainId)}&no=${encodeURIComponent(nodeId)}`
			: `/mapa?no=${encodeURIComponent(nodeId)}`;

	if (loading) {
		return (
			<section className="cel-card p-5" aria-busy="true">
				<p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
					<Icon name="loader" size={16} live />
					Carregando nivelamento adaptativo…
				</p>
			</section>
		);
	}

	if (summary) {
		return (
			<section aria-label="Resultado do nivelamento" data-testid="placement-summary" className="cel-card space-y-4 p-5">
				<div className="flex flex-wrap items-center gap-2.5 border-b border-border/50 pb-3">
					<Icon name="check" size={22} />
					<div className="min-w-0 flex-1">
						<h2 className="cel-display text-xl leading-tight">Nivelamento concluído</h2>
						<p className="mt-0.5 text-sm text-muted-foreground">{summary.message}</p>
					</div>
					<span className="study-pill study-pill-success tabular-nums">
						Confiança {summary.confidencePct}%
					</span>
				</div>

				<dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
					<div className="rounded-xl border border-border/50 bg-background/60 p-3">
						<dt className="text-xs text-muted-foreground">Habilidades posicionadas</dt>
						<dd className="cel-display mt-1 text-xl tabular-nums">
							{summary.placedCount}/{summary.totalLeaves}
							<span className="ml-1.5 text-xs font-semibold text-muted-foreground">({summary.placedPct}%)</span>
						</dd>
					</div>
					<div className="rounded-xl border border-border/50 bg-background/60 p-3">
						<dt className="text-xs text-muted-foreground">Perguntas respondidas</dt>
						<dd className="cel-display mt-1 text-xl tabular-nums">{summary.asked}</dd>
					</div>
					<div className="col-span-2 rounded-xl border border-border/50 bg-background/60 p-3 sm:col-span-1">
						<dt className="text-xs text-muted-foreground">Fronteira inicial</dt>
						<dd className="cel-display mt-1 text-xl tabular-nums">
							{summary.frontierNodeIds.length} {summary.frontierNodeIds.length === 1 ? "tópico" : "tópicos"}
						</dd>
					</div>
				</dl>

				{(summary.recommendedChapter || summary.recommendedModule || summary.recommendedNodeTitle) && (
					<div className="space-y-1.5 rounded-xl border border-border/55 bg-background/70 p-3.5 text-sm">
						<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
							Ponto de partida recomendado
						</p>
						{summary.recommendedChapter && (
							<p className="font-semibold text-foreground">
								Capítulo: {summary.recommendedChapter.level} · {summary.recommendedChapter.title}
							</p>
						)}
						{summary.recommendedModule && (
							<p className="text-foreground/90">
								Módulo: {summary.recommendedModule.title}
							</p>
						)}
						{summary.recommendedNodeTitle && summary.recommendedNodeId && (
							<p className="text-xs text-muted-foreground">
								Próxima aula sugerida:{" "}
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
					<Link href="/" className="cel-button cel-button-primary min-h-10 px-4 py-2 text-sm">
						<Icon name="play" size={15} />
						Ir para a campanha
					</Link>
					<button
						type="button"
						className="cel-button min-h-10 px-3.5 py-2 text-sm"
						disabled={busy}
						onClick={() => void runAction({ action: "start" })}
					>
						Refazer nivelamento
					</button>
				</div>
			</section>
		);
	}

	if (!question) {
		return (
			<section aria-label="Teste de nivelamento adaptativo" data-testid="placement-intro" className="cel-card space-y-4 p-5">
				<div className="flex items-start gap-3">
					<Icon name="frontier" size={24} className="mt-0.5 shrink-0" />
					<div className="min-w-0 space-y-1">
						<h2 className="cel-display text-xl leading-tight">{t("course.placement.title")}</h2>
						<p className="max-w-[65ch] text-sm leading-relaxed text-muted-foreground">
							Em até 15 perguntas adaptativas, o sistema estima o que você já domina e posiciona sua fronteira exata na ementa, evitando repetir fundamentos que você já conhece com segurança.
						</p>
					</div>
				</div>

				<ul className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
					<li className="rounded-xl border border-border/45 bg-background/60 p-3">
						<strong className="block text-sm text-foreground">{t("course.placement.featRealtime")}</strong>
						Cada resposta refina toda a árvore de pré-requisitos via filtro de partículas KST.
					</li>
					<li className="rounded-xl border border-border/45 bg-background/60 p-3">
						<strong className="block text-sm text-foreground">{t("course.placement.featNoPenalty")}</strong>
						Marque com sinceridade: habilidades posicionadas permanecem verificáveis depois.
					</li>
					<li className="rounded-xl border border-border/45 bg-background/60 p-3">
						<strong className="block text-sm text-foreground">{t("course.placement.featFlexible")}</strong>
						Você pode finalizar a partir da 4ª pergunta ou seguir até convergir.
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
						{busy ? "Iniciando…" : "Iniciar nivelamento"}
					</button>
				</div>
			</section>
		);
	}

	const currentNumber = Math.min(question.maxQuestions, question.asked + 1);
	const canFinishEarly = question.asked >= 4;

	return (
		<section aria-label="Pergunta do nivelamento" data-testid="placement-question" className="cel-card space-y-4 p-5">
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
				<div className="flex items-center gap-2">
					<Icon name="frontier" size={18} />
					<h2 className="cel-display text-base leading-tight tabular-nums">
						Pergunta {currentNumber} de até {question.maxQuestions}
					</h2>
				</div>
				<span className="study-pill study-pill-info tabular-nums">
					Confiança: {question.confidencePct}%
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
					aria-label={`Confiança do nivelamento: ${question.confidencePct}%`}
				/>
			</div>

			<div className="space-y-2.5 rounded-xl border border-border/55 bg-background/65 p-4">
				{question.path.length > 0 && (
					<p className="text-xs font-medium text-muted-foreground">
						{question.path.join(" › ")}
					</p>
				)}
				<h3 className="cel-display text-lg leading-snug text-foreground">{question.title}</h3>
				<p className="max-w-[65ch] text-[17px] leading-relaxed text-foreground">
					{question.prompt}
				</p>

				{question.objectives.length > 0 && (
					<div className="border-t border-border/45 pt-2.5">
						<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
							Objetivos verificados
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
					Sei fazer com segurança
				</button>
				<button
					type="button"
					data-testid="placement-no-button"
					className="cel-button min-h-11 justify-center px-4 py-2.5 text-sm"
					disabled={busy}
					onClick={() => void runAction({ action: "answer", nodeId: question.nodeId, correct: false })}
				>
					<Icon name="review" size={16} tone={false} />
					Ainda preciso aprender
				</button>
			</div>

			<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/45 pt-3">
				<button
					type="button"
					data-testid="placement-finish-button"
					className="cel-button min-h-9 px-3.5 py-1.5 text-xs"
					disabled={busy || !canFinishEarly}
					title={canFinishEarly ? "Encerrar e aplicar o posicionamento atual" : "Responda pelo menos 4 perguntas para finalizar antes"}
					onClick={() => void runAction({ action: "finish" })}
				>
					Finalizar agora{!canFinishEarly ? ` (${question.asked}/4)` : ""}
				</button>
				<button
					type="button"
					data-testid="placement-cancel-button"
					className="cel-button cel-button-ghost min-h-9 px-3 py-1.5 text-xs"
					disabled={busy}
					onClick={() => void cancelPlacement()}
				>
					Cancelar
				</button>
			</div>
		</section>
	);
}
