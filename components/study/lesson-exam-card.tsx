"use client";

import { useContext, useId, useState } from "react";
import { ChatActionsContext } from "@/components/chat";
import { Icon } from "@/components/icons/icon";
import { isLessonExamAnswer, type ArtifactPartProps } from "@/src/core";
import { CitedResponse } from "./cited-response.tsx";

export function LessonExamCard({ part }: ArtifactPartProps) {
	const actions = useContext(ChatActionsContext);
	const [answer, setAnswer] = useState("");
	const [delivering, setDelivering] = useState(false);
	const [error, setError] = useState("");
	const label = useId();
	const exam = part.output as { task?: string; feedback?: string; attempt?: number; total?: number; objectives?: string[] } | undefined;
	if (part.state !== "output-available" || !exam?.task) return null;
	const open = actions?.activeExamId === part.toolCallId && !!actions?.submitExam;
	return <section aria-label="Prova do nó" className="cel-card my-4 space-y-3 p-4 md:p-5">
		{exam.feedback && <div className="rounded-xl border border-border/55 bg-background/60 px-3.5 py-2.5"><CitedResponse text={exam.feedback} /></div>}
		<div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2.5">
			<div className="flex items-center gap-2">
				<Icon name="exercise" size={18} />
				<h3 className="cel-display text-lg">Prova do nó</h3>
			</div>
			{exam.attempt != null && exam.total != null && (
				<span className="study-pill study-pill-accent tabular-nums">Tentativa {exam.attempt} de {exam.total}</span>
			)}
		</div>
		<CitedResponse text={exam.task} />
		{!!exam.objectives?.length && (
			<div className="rounded-xl border border-border/50 bg-background/55 px-3.5 py-2.5 text-sm">
				<strong className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Critérios de correção</strong>
				<ul className="mt-1.5 list-disc space-y-1 pl-5 text-foreground/90">
					{exam.objectives.map((objective, index) => <li key={index}>{objective}</li>)}
				</ul>
			</div>
		)}
		{open && <form className="grid gap-2.5 border-t border-border/50 pt-3" onSubmit={async event => {
			event.preventDefault();
			if (!isLessonExamAnswer(answer)) {
				setError("Escreva a solução pedida no enunciado antes de entregar.");
				return;
			}
			setError("");
			setDelivering(true);
			try { await actions.submitExam?.(part.toolCallId, answer.trim(), () => setAnswer("")); }
			finally { setDelivering(false); }
		}}>
			<label htmlFor={label} className="text-sm font-semibold">Sua resposta à prova</label>
			<textarea id={label} className="cel-input lh-input min-h-28 w-full resize-y p-3" value={answer}
				maxLength={12000} onChange={event => { setAnswer(event.target.value); setError(""); }} />
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-xs text-muted-foreground">A tentativa é registrada ao entregar neste formulário.</p>
				<button className="cel-button cel-button-primary px-4 py-2 text-sm" disabled={actions.examBusy || delivering || !answer.trim()}>Entregar prova</button>
			</div>
			{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
		</form>}
	</section>;
}
