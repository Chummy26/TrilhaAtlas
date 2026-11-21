"use client";

/**
 * "Hoje" — ONE suggestion at a time (docs/research/00-SINTESE.md §2.6
 * planner): the planner's next item for the active study domain, or the
 * post-lesson self-check when a lesson was started and not yet rated.
 * Minimal text by design: kind · minutes, title, trail, one reason line.
 * Hidden in "Geral" (no study domain → /api/study/today answers 409).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/icon";
import { useServerEvent } from "@/components/server-events";
import { lessonStatement } from "./lesson-statement.ts";
import type { StudyToday } from "@/src/core";

export interface LessonStart {
	domainId: string;
	exploratory?: boolean;
	minutes: number;
	title: string;
	/** Rides the chat creation as graphContext (the curriculum node as session context). */
	context: { id: string; name: string; statement: string };
}

const KIND_LABEL: Record<string, string> = {
	new: "Novo",
	review: "Revisão",
	vehicle: "Revisão integrada",
	remediate: "Reforço",
	probe: "Sondagem",
};

const KIND_PILL: Record<string, string> = {
	new: "study-pill study-pill-accent",
	review: "study-pill study-pill-info",
	vehicle: "study-pill study-pill-info",
	remediate: "study-pill study-pill-warning",
	probe: "study-pill",
};

const CHECK_GRADES = [
	{ grade: 0, label: "Não entendi" },
	{ grade: 1, label: "Parcial" },
	{ grade: 2, label: "Com ajuda" },
	{ grade: 3, label: "Entendi sem ajuda" },
] as const;

export function TodayCard({ onStart, disabled = false, setupHint }: { setupHint?: string; onStart: (lesson: LessonStart) => void; disabled?: boolean }) {
	const [today, setToday] = useState<StudyToday | null>(null);
	const [pending, setPending] = useState(false);
	const [reviewFeedback, setReviewFeedback] = useState<{ domain: string; ok: boolean; text: string }>();

	const read = useCallback(() => {
		fetch("/api/study/today")
			.then((r) => (r.ok ? (r.json() as Promise<StudyToday>) : null))
			.then(setToday)
			.catch(() => setToday(null));
	}, []);
	useEffect(read, [read]);
	useServerEvent("domain-changed", read);
	useServerEvent("curriculum-expanded", read);

	const post = async (body: Record<string, unknown>): Promise<boolean> => {
		setPending(true);
		const res = await fetch("/api/study/events", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}).catch(() => null);
		if (res?.ok) setToday((await res.json()) as StudyToday);
		setPending(false);
		return !!res?.ok;
	};

	if (!today || !today.ready) return null;
	const { next, pendingCheck, progress } = today;
	const chapter = today.chapters?.find(c => c.known < c.total);
	const started = today.chapters?.some(c => c.known > 0) || next?.kind !== "new";
	const mapLink = (node: string) => `/mapa?dominio=${encodeURIComponent(today.domain.id)}&no=${encodeURIComponent(node)}`;
	const pct = progress.leaves > 0 ? Math.round((100 * progress.attained) / progress.leaves) : 0;

	return (
		<section data-domain={today.domain.id} data-testid="today-card" className="cel-card mb-2.5 px-4 py-3.5">
			<div className="mb-2.5 flex flex-wrap items-center gap-2">
				<div className="flex items-center gap-2">
					<Icon name={pendingCheck ? "check" : "play"} size={16} />
					<h2 className="cel-display text-base leading-tight">
						{today.chapters?.length ? `Campanha de ${today.domain.title}` : "Hoje"}
					</h2>
				</div>
				<Link href={`/mapa?dominio=${encodeURIComponent(today.domain.id)}`} className="cel-button cel-button-ghost min-h-7 px-2 py-0.5 text-xs">
					<Icon name="map" size={14} tone={false} />
					Explorar árvore
				</Link>
				<Link href={`/ementa?dominio=${encodeURIComponent(today.domain.id)}`} className="cel-button cel-button-ghost min-h-7 px-2 py-0.5 text-xs">
					<Icon name="book" size={14} tone={false} />
					Ementa
				</Link>
				<Link href={`/ementa?dominio=${encodeURIComponent(today.domain.id)}&aba=nivelamento`} className="cel-button cel-button-ghost min-h-7 px-2 py-0.5 text-xs">
					<Icon name="exercise" size={14} tone={false} />
					Nivelamento
				</Link>
				<span className="ml-auto text-xs text-muted-foreground tabular-nums" title={`${progress.attained} de ${progress.leaves} tópicos · carga estimada das habilidades alcançadas`}>
					<strong className="font-semibold text-foreground">{progress.attained > 0 && pct === 0 ? "<1" : pct}%</strong> · {progress.attainedHours}/{progress.totalHours} h previstas
				</span>
			</div>

			{today.chapters && (
				<div className="mb-3 rounded-xl border border-border/45 bg-background/55 px-3 py-2">
					<p className="cel-display text-sm leading-snug">
						{today.campaignGoal ? `Sua meta · ${today.campaignGoal}` : chapter ? `${chapter.level} · ${chapter.title}` : "Percurso concluído · continue praticando pelo mapa"}
					</p>
					{chapter && (
						<p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
							{today.campaignGoal && `Percurso principal · ${chapter.level} · ${chapter.title}. `}{chapter.mission}
						</p>
					)}
				</div>
			)}

			{pendingCheck ? (
				<div className="space-y-2">
					<p className="cel-display text-base leading-snug">
						{pendingCheck.sessionId === "hoje" ? "Como foi a aula?" : "Aula em andamento"} · {pendingCheck.title}
					</p>
					{pendingCheck.sessionId !== "hoje" && (
						<div className="flex flex-wrap items-center gap-2">
							<Link className="cel-button cel-button-primary min-h-9 px-4 py-1.5 text-sm" href={`/chat/${encodeURIComponent(pendingCheck.sessionId)}`}>
								<Icon name="play" size={15} />
								Retomar aula
							</Link>
							<Link className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground" href={mapLink(pendingCheck.nodeId)}>
								Ver na árvore
							</Link>
						</div>
					)}
					{pendingCheck.sessionId === "hoje" && (
						<div className="flex flex-wrap gap-1.5">
							{CHECK_GRADES.map((g) => (
								<button
									key={g.grade}
									type="button"
									disabled={pending}
									onClick={() => void post({ kind: "self-check", nodeId: pendingCheck.nodeId, sessionId: pendingCheck.sessionId, exposureId: pendingCheck.exposureId, grade: g.grade })}
									className={`cel-button ${g.grade === 3 ? "cel-button-success" : ""} min-h-8 px-3 text-sm`}
								>
									{g.label}
								</button>
							))}
						</div>
					)}
				</div>
			) : next ? (
				<div className="space-y-1.5">
					<div className="flex flex-wrap items-center gap-1.5">
						<span className={KIND_PILL[next.kind] ?? "study-pill"}>{KIND_LABEL[next.kind] ?? next.kind}</span>
						<span className="inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
							<Icon name="clock" size={13} tone={false} />
							~{Math.round(next.estMinutes)} min
						</span>
					</div>
					<p className="cel-display text-[17px] leading-snug">{next.brief.title}</p>
					{next.brief.path.length > 0 && (
						<p className="truncate text-xs text-muted-foreground">{next.brief.path.join(" › ")}</p>
					)}
					<p className="text-xs leading-relaxed text-muted-foreground">{next.reason}</p>
					<div className="flex flex-wrap items-center gap-2 pt-1.5">
						<button
							type="button"
							disabled={pending || disabled}
							data-testid="today-start"
							onClick={() => {
								const minutes = Math.round(next.estMinutes);
								const priorGap = today.reinforceHint?.nodeId === next.nodeId ? today.reinforceHint.feedback : undefined;
								onStart({
									domainId: today.domain.id, minutes, title: next.brief.title,
									context: { id: next.nodeId, name: next.brief.title, statement: lessonStatement(next.brief, minutes, priorGap) },
								});
							}}
							className="cel-button cel-button-primary min-h-9 px-4 text-sm"
						>
							<Icon name="play" size={16} />
							{today.reinforceHint?.nodeId === next.nodeId
								? "Praticar reforço"
								: chapter ? (started ? "Continuar campanha" : "Iniciar campanha") : "Começar aula"}
						</button>
						{next.kind === "new" && (
							<button
								type="button"
								disabled={pending}
								onClick={() => void post({ kind: "known", nodeId: next.nodeId })}
								className="cel-button cel-button-ghost min-h-9 px-3 text-sm"
							>
								Já domino
							</button>
						)}
					</div>
					{setupHint && <p className="pt-1 text-xs text-muted-foreground">{setupHint}</p>}
				</div>
			) : (
				<p className="cel-display text-base">Por hoje é isso. Volte amanhã para as revisões.</p>
			)}

			{today.currentModule && (
				<div className="mt-3 rounded-xl border border-border/50 bg-background/55 px-3 py-2.5 text-xs">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<span className="font-semibold text-foreground">
							Módulo {today.currentModule.index}/{today.currentModule.totalModules} · {today.currentModule.title}
						</span>
						<span className="tabular-nums text-muted-foreground">
							<strong className="font-semibold text-foreground">{today.currentModule.completed}/{today.currentModule.total}</strong> aulas
						</span>
					</div>
					<progress
						max={Math.max(1, today.currentModule.total)}
						value={today.currentModule.completed}
						aria-label={`Progresso do módulo ${today.currentModule.title}`}
						className="study-progress mt-1.5 w-full"
					/>
					<details className="study-disclosure mt-2 text-xs">
						<summary>Aulas deste módulo</summary>
						<div className="study-disclosure-body">
							<ol className="study-missions">
								{today.currentModule.lessons.map((lesson, idx) => (
									<li key={lesson.id} data-reached={lesson.status === "done"}>
										<span className="study-mission-marker" aria-hidden="true">
											{lesson.status === "done" ? "✓" : lesson.status === "current" ? "▶" : lesson.status === "available" ? "○" : "·"}
										</span>
										<Link
											className={`underline decoration-border underline-offset-2 hover:decoration-foreground ${lesson.status === "current" ? "font-semibold text-foreground" : "font-medium"}`}
											href={mapLink(lesson.id)}
										>
											{idx + 1}. {lesson.title}
										</Link>
										{lesson.isFinale && <span className="study-pill study-pill-accent">missão final</span>}
										<span className="ml-auto tabular-nums text-muted-foreground">~{lesson.minutes} min</span>
									</li>
								))}
							</ol>
						</div>
					</details>
				</div>
			)}

			{today.queue && today.queue.length > 0 && (
				<details className="study-disclosure mt-2.5 text-xs">
					<summary>A seguir na trilha ({today.queue.length})</summary>
					<div className="study-disclosure-body">
						<ol className="study-missions">
							{today.queue.map(item => (
								<li key={item.nodeId}>
									<span className="study-pill">{KIND_LABEL[item.kind] ?? item.kind}</span>
									<Link className="font-medium underline decoration-border underline-offset-2 hover:decoration-foreground" href={mapLink(item.nodeId)}>
										{item.title}
									</Link>
									<span className="text-muted-foreground">· {item.moduleTitle}</span>
									<span className="ml-auto tabular-nums text-muted-foreground">~{item.estMinutes} min</span>
								</li>
							))}
						</ol>
					</div>
				</details>
			)}

			{today.review && (
				<details key={today.domain.id + today.review.id} className="study-disclosure mt-3 text-sm">
					<summary>
						<Icon name="review-due" size={15} />
						Revisão sem consulta · {today.review.title}
					</summary>
					<form onSubmit={async event => {
						event.preventDefault();
						const answer = new FormData(event.currentTarget).get("answer");
						setPending(true);
						try {
							const res = await fetch("/api/study/review", {
								method: "POST",
								headers: { "Content-Type": "application/json" },
								body: JSON.stringify({ domain: today.domain.id, id: today.review!.id, answer }),
							});
							const result = await res.json();
							if (!res.ok) throw new Error(result.error);
							setReviewFeedback({ domain: today.domain.id, ok: Boolean(result.correct), text: (result.correct ? "Correto. " : "Confira a resolução. ") + result.explanation });
							read();
						} catch (error) {
							setReviewFeedback({ domain: today.domain.id, ok: false, text: error instanceof Error ? error.message : "Falha ao registrar resposta." });
						} finally {
							setPending(false);
						}
					}} className="study-disclosure-body space-y-2.5">
						<label className="block space-y-1.5 text-sm">
							<span className="leading-relaxed">{today.review.prompt}</span>
							<input name="answer" className="cel-input block w-full px-3 py-2 text-sm" maxLength={150} required autoComplete="off" />
						</label>
						<button type="submit" disabled={pending} className="cel-button min-h-8 px-3.5 py-1 text-xs">Conferir resposta</button>
					</form>
				</details>
			)}

			{reviewFeedback?.domain === today.domain.id && (
				<p role="status" className={"mt-2 rounded-lg border px-3 py-2 text-xs leading-relaxed " + (reviewFeedback.ok ? "border-[var(--cel-success,var(--lh-success))]/45 bg-[var(--cel-success,var(--lh-success))]/10" : "border-border bg-background/70")}>
					{reviewFeedback.text}
				</p>
			)}

			{today.chapters && (
				<div className="study-campaign" aria-label="Percurso da campanha">
					<nav aria-label="Capítulos da campanha">
						{today.chapters.map(c => (
							<Link
								key={c.level}
								href={mapLink(c.entry)}
								data-reached={c.known === c.total && c.total > 0}
								aria-current={c === chapter ? "step" : undefined}
								aria-label={`${c.level}, ${c.title}. ${c.known} de ${c.total} habilidades no percurso. Explorar capítulo.`}
								title={`${c.title} · ${c.known}/${c.total}`}
							>
								{c.total > 0 && c.known === c.total ? "✓ " : ""}{c.level.replace(/^Etapa /, "")}
							</Link>
						))}
					</nav>
					{chapter && (
						<div className="flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground">
							<progress max={chapter.total} value={chapter.known} aria-label={`Progresso em ${chapter.level}`} className="study-progress w-28" />
							<span className="tabular-nums" title="Inclui nós concluídos pelo professor, habilidades alcançadas, colocação por nivelamento e pré-requisitos inferidos.">
								<strong className="font-semibold text-foreground">{chapter.known}/{chapter.total}</strong> habilidades no percurso
							</span>
						</div>
					)}
					{chapter && (
						<details className="study-disclosure mt-2.5 text-xs">
							<summary>Percurso e missão final de {chapter.level}</summary>
							<div className="study-disclosure-body">
								<ol className="study-missions">
									{chapter.landmarks.map(step => (
										<li key={step.id} data-reached={step.known}>
											<span className="study-mission-marker" aria-hidden="true">{step.known ? "✓" : step.id === chapter.finale ? "⚑" : "•"}</span>
											<Link className="font-medium underline decoration-border underline-offset-2 hover:decoration-foreground" href={mapLink(step.id)}>{step.title}</Link>
											{step.id === chapter.finale && <span className="study-pill study-pill-accent">missão final</span>}
											{step.known && <span className="text-xs text-[var(--cel-success-text,var(--lh-success))]">alcançada</span>}
										</li>
									))}
								</ol>
								<p className="mt-2 text-xs text-muted-foreground">Entre essas missões, o plano inclui habilidades do capítulo e revisões conforme sua prática.</p>
							</div>
						</details>
					)}
				</div>
			)}

			{today.optionalPractice && (
				<Link className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--cel-link,var(--lh-accent))] underline underline-offset-2" href={`/mapa?dominio=${encodeURIComponent(today.domain.id)}&no=${encodeURIComponent(today.optionalPractice.id)}`}>
					<Icon name="review" size={14} tone={false} />
					Reforço opcional · {today.optionalPractice.title}
				</Link>
			)}
			{Boolean(progress.plannedPracticeHours) && (
				<p className="mt-2 text-xs text-muted-foreground tabular-nums">Prática distribuída prevista no domínio · {progress.plannedPracticeHours} h</p>
			)}
		</section>
	);
}
