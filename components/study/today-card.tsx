"use client";

/**
 * "Hoje" — ONE suggestion at a time (docs/research/00-SINTESE.md §2.6
 * planner): the planner's next item for the active study domain, or the
 * post-lesson self-check when a lesson was started and not yet rated.
 * Minimal text by design: kind · minutes, title, trail, one reason line.
 * Hidden in "Geral" (no study domain → /api/study/today answers 409).
 */

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { useServerEvent } from "@/components/server-events";
import type { StudyNodeBrief, StudyToday } from "@/src/core";

export interface LessonStart {
	domainId: string;
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
	{ grade: 3, label: "Domino" },
] as const;

function lessonStatement(brief: StudyNodeBrief, minutes: number): string {
	const parts = [
		brief.path.length > 0 ? `Trilha: ${brief.path.join(" › ")}.` : "",
		brief.summary ? `Resumo: ${brief.summary}` : "",
		brief.objectives.length > 0 ? `Objetivos: ${brief.objectives.join("; ")}.` : "",
		brief.misconceptions.length > 0 ? `Confusões comuns: ${brief.misconceptions.join("; ")}.` : "",
		`Aula de ~${minutes} min do currículo do domínio; ensine em pt-BR.`,
	];
	return parts.filter(Boolean).join(" ");
}

export function TodayCard({ onStart, disabled = false }: { onStart: (lesson: LessonStart) => void; disabled?: boolean }) {
	const [today, setToday] = useState<StudyToday | null>(null);
	const [pending, setPending] = useState(false);

	const read = useCallback(() => {
		fetch("/api/study/today")
			.then((r) => (r.ok ? (r.json() as Promise<StudyToday>) : null))
			.then(setToday)
			.catch(() => setToday(null));
	}, []);
	useEffect(read, [read]);
	useServerEvent("domain-changed", read);

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
	const pct = progress.leaves > 0 ? Math.round((100 * progress.attained) / progress.leaves) : 0;

	return (
		<section data-domain={today.domain.id} data-testid="today-card" className="cel-card mb-2 px-3.5 py-3">
			<div className="mb-1.5 flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
				<Icon name={pendingCheck ? "check" : "play"} size={14} />
				<span className="cel-display">Hoje</span>
				{next && !pendingCheck && (
					<span>
						· {KIND_LABEL[next.kind] ?? next.kind} · ~{Math.round(next.estMinutes)} min
					</span>
				)}
				<span className="ml-auto normal-case tracking-normal" title={`${progress.attained} de ${progress.leaves} tópicos`}>
					{pct}% · {progress.attainedHours}/{progress.totalHours} h
				</span>
			</div>

			{pendingCheck ? (
				<div>
					<p className="cel-display text-base">Como foi «{pendingCheck.title}»?</p>
					<div className="mt-2 flex flex-wrap gap-1.5">
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
							<Icon name="book" size={16} />
							Começar aula
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
				</div>
			) : (
				<p className="cel-display text-base">Por hoje é isso. Volte amanhã para as revisões.</p>
			)}
		</section>
	);
}
