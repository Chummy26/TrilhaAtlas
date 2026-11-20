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
import { LessonFinish } from "./lesson-finish.tsx";
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

const CHECK_GRADES = [
	{ grade: 0, label: "Não entendi" },
	{ grade: 1, label: "Parcial" },
	{ grade: 2, label: "Com ajuda" },
	{ grade: 3, label: "Entendi sem ajuda" },
] as const;

export function TodayCard({ onStart, disabled = false, setupHint }: { setupHint?: string; onStart: (lesson: LessonStart) => void; disabled?: boolean }) {
	const [today, setToday] = useState<StudyToday | null>(null);
	const [pending, setPending] = useState(false);
	const [reviewFeedback, setReviewFeedback] = useState<{ domain: string; text: string }>();

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
		<section data-domain={today.domain.id} data-testid="today-card" className="cel-card mb-2 px-3.5 py-3">
			<div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
				<Icon name={pendingCheck ? "check" : "play"} size={14} />
				<h2 className="cel-display text-base normal-case tracking-normal">{today.chapters?.length ? `Campanha de ${today.domain.title}` : "Hoje"}</h2>
				<Link href={`/mapa?dominio=${encodeURIComponent(today.domain.id)}`} className="cel-button cel-button-ghost px-2 normal-case tracking-normal">Explorar árvore</Link>
				{next && !pendingCheck && (
					<span>
						· {KIND_LABEL[next.kind] ?? next.kind} · ~{Math.round(next.estMinutes)} min
					</span>
				)}
				<span className="ml-auto normal-case tracking-normal" title={`${progress.attained} de ${progress.leaves} tópicos · carga estimada das habilidades alcançadas`}>
					{progress.attained > 0 && pct === 0 ? "<1" : pct}% · {progress.attainedHours}/{progress.totalHours} h previstas
				</span>
			</div>

			{today.chapters && <div className="mb-3">
				<p className="cel-display">{today.campaignGoal ? "Sua meta · " + today.campaignGoal : chapter ? `${chapter.level} · ${chapter.title}` : "Percurso concluído · continue praticando pelo mapa"}</p>
				{chapter && <p>{today.campaignGoal && `Percurso principal · ${chapter.level} · ${chapter.title}. `}{chapter.mission}</p>}
			</div>}
			{pendingCheck ? (
				<div>
					<p className="cel-display text-base">Como foi «{pendingCheck.title}»?</p>
					<Link className="cel-button cel-button-primary my-2 px-3.5 py-1.5 text-sm" href={`/chat/${encodeURIComponent(pendingCheck.sessionId)}`}>Retomar aula</Link>
					{pendingCheck.sessionId !== "hoje" ? <LessonFinish key={pendingCheck.exposureId} state={{ ...pendingCheck, domainId: today.domain.id, completed: false }} disabled={pending} /> : <div className="mt-2 flex flex-wrap gap-1.5">
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
					</div>}
				</div>
			) : next ? (
				<div>
					<p className="cel-display text-base leading-snug">{next.brief.title}</p>
					{next.brief.path.length > 0 && <p className="truncate text-xs text-muted-foreground">{next.brief.path.join(" › ")}</p>}
					<p className="mt-1 text-xs text-muted-foreground">{next.reason}</p>
					<div className="mt-2.5 flex items-center gap-1.5">
						<button
							type="button"
							disabled={pending || disabled}
							data-testid="today-start"
							onClick={() => {
								const minutes = Math.round(next.estMinutes);
								onStart({
									domainId: today.domain.id, minutes, title: next.brief.title,
									context: { id: next.nodeId, name: next.brief.title, statement: lessonStatement(next.brief, minutes) },
								});
							}}
							className="cel-button cel-button-primary min-h-8 px-3.5 text-sm"
						>
							<Icon name="play" size={16} />
							{chapter ? (started ? "Continuar campanha" : "Iniciar campanha") : "Começar aula"}
						</button>
						{next.kind === "new" && (
							<button
								type="button"
								disabled={pending}
								onClick={() => void post({ kind: "known", nodeId: next.nodeId })}
								className="cel-button cel-button-ghost min-h-8 px-3 text-sm"
							>
								Já domino
							</button>
						)}
					</div>
					{setupHint && <p className="mt-1 text-sm text-muted-foreground">{setupHint}</p>}
				</div>
			) : (
				<p className="cel-display text-base">Por hoje é isso. Volte amanhã para as revisões.</p>
			)}
			{today.review && <details key={today.domain.id + today.review.id} className="my-3">
				<summary className="cursor-pointer">Revisão sem consulta · {today.review.title}</summary>
				<form onSubmit={async event => {
					event.preventDefault();
					const answer = new FormData(event.currentTarget).get("answer");
					setPending(true);
					try {
						const res = await fetch("/api/study/review", { method: "POST", headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ domain: today.domain.id, id: today.review!.id, answer }) });
						const result = await res.json();
						if (!res.ok) throw new Error(result.error);
						setReviewFeedback({ domain: today.domain.id, text: (result.correct ? "Correto. " : "Confira a resolução. ") + result.explanation });
						read();
					} catch (error) { setReviewFeedback({ domain: today.domain.id, text: error instanceof Error ? error.message : "Falha ao registrar resposta." }); }
					finally { setPending(false); }
				}} className="space-y-2 py-2">
					<label className="block">{today.review.prompt}<input name="answer" className="block w-full rounded border bg-background p-2" maxLength={150} required autoComplete="off" /></label>
					<button type="submit" disabled={pending} className="cel-button px-3 py-1">Conferir resposta</button>
				</form>
			</details>}
			{reviewFeedback?.domain === today.domain.id && <p role="status" className="text-sm">{reviewFeedback.text}</p>}
			{today.chapters && <div className="study-campaign" aria-label="Percurso da campanha">
				<nav aria-label="Capítulos da campanha">
					{today.chapters.map(c => <Link key={c.level} href={mapLink(c.entry)} data-reached={c.known === c.total && c.total > 0}
						aria-current={c === chapter ? "step" : undefined}
						aria-label={`${c.level}, ${c.title}. ${c.known} de ${c.total} habilidades no percurso. Explorar capítulo.`}
						title={`${c.title} · ${c.known}/${c.total}`}>{c.total > 0 && c.known === c.total ? "✓ " : ""}{c.level.replace(/^Etapa /, "")}</Link>)}
				</nav>
				{chapter && <div className="flex flex-wrap items-center gap-2 text-xs"><progress max={chapter.total} value={chapter.known} aria-label={`Progresso em ${chapter.level}`} />
					<span title="Inclui habilidades alcançadas, colocação por nivelamento e pré-requisitos inferidos.">{chapter.known}/{chapter.total} habilidades no percurso</span>
				</div>}
				{chapter && <details className="mt-2 text-sm">
					<summary className="cursor-pointer">Percurso e missão final de {chapter.level}</summary>
					<ol className="study-missions">{chapter.landmarks.map(step => <li key={step.id} data-reached={step.known}>
						<span className="study-mission-marker" aria-hidden="true">{step.known ? "✓" : step.id === chapter.finale ? "⚑" : "•"}</span>
						<Link className="underline" href={mapLink(step.id)}>{step.title}</Link>
						{step.id === chapter.finale && " · missão final"}{step.known && " · alcançada"}
					</li>)}</ol>
					<p className="mt-2 text-xs">Entre essas missões, o plano inclui habilidades do capítulo e revisões conforme sua prática.</p>
				</details>}
			</div>}
			{today.optionalPractice && <Link className="mt-2 block text-sm underline" href={`/mapa?dominio=${encodeURIComponent(today.domain.id)}&no=${encodeURIComponent(today.optionalPractice.id)}`}>
				Reforço opcional · {today.optionalPractice.title}
			</Link>}
			{Boolean(progress.plannedPracticeHours) && <p className="mt-2 text-xs text-muted-foreground">Prática distribuída prevista no domínio · {progress.plannedPracticeHours} h</p>}
		</section>
	);
}
