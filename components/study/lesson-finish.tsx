"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/icon";
import {
	levelProgress,
	type LessonCourseContext,
	type LessonCourseProgress,
	type StudyNodeBrief,
	type StudyToday,
} from "@/src/core";
import { SessionStarter, studyLessonRequest } from "../start-session.ts";
import { lessonStatement } from "./lesson-statement.ts";

export interface LessonRetryTarget {
	nodeId: string;
	brief: StudyNodeBrief;
	estMinutes: number;
	feedback: string;
}

export interface LessonFinishState {
	domainId: string;
	sessionId: string;
	nodeId: string;
	completed: boolean;
	reinforcement?: string;
	course?: LessonCourseContext | null;
	next?: StudyToday["next"];
	resume?: string | null;
	retry?: LessonRetryTarget | null;
}

export interface LessonReceipt {
	outcome?: "passed" | "reinforce";
	criteria?: { title?: string; met: boolean; reason: string }[];
	assessment: string;
	cards: number | null;
	before: number;
	after: number;
	alreadyCompleted: boolean;
	resume: string | null;
	next: StudyToday["next"];
	course?: LessonCourseProgress | null;
	retry?: LessonRetryTarget | null;
}

const KIND_LABEL: Record<string, string> = {
	new: "Próxima aula",
	review: "Revisão espaçada",
	vehicle: "Revisão integrada",
	remediate: "Reforço recomendado",
	probe: "Sondagem rápida",
};

type FlashcardExportMode = "obsidian" | "anki" | "apkg";

const EXPORT_MODES: readonly { mode: FlashcardExportMode; label: string }[] = [
	{ mode: "obsidian", label: "Obsidian" },
	{ mode: "anki", label: "Anki" },
	{ mode: "apkg", label: ".apkg" },
];

function formatExportStatus(mode: FlashcardExportMode, payload: Record<string, unknown> | null): string {
	if (payload) {
		if (typeof payload.message === "string" && payload.message.trim()) return payload.message.trim();
		if (typeof payload.status === "string" && payload.status.trim()) return payload.status.trim();
		if (mode === "obsidian") {
			const cards = typeof payload.cards === "number" ? ` (${payload.cards} cartões)` : "";
			return `Exportado para o Obsidian${cards}.`;
		}
		if (mode === "apkg" || payload.mode === "apkg") {
			const notes = typeof payload.notes === "number" ? ` · ${payload.notes} notas` : "";
			const target = typeof payload.path === "string" && payload.path ? ` em ${payload.path}` : "";
			return `Pacote .apkg pronto${notes}${target}.`;
		}
		if (mode === "anki") {
			const created = typeof payload.created === "number" ? payload.created : 0;
			const updated = typeof payload.updated === "number" ? payload.updated : 0;
			if (created || updated) return `Sincronizado com o Anki (${created} novos, ${updated} atualizados).`;
			return "Sincronizado com o Anki.";
		}
	}
	return "Exportação concluída.";
}

function chime(context: AudioContext) {
	const start = context.currentTime;
	for (const [index, pitch] of [523.25, 659.25, 783.99].entries()) {
		const tone = context.createOscillator();
		const volume = context.createGain();
		const t = start + index * 0.11;
		tone.frequency.value = pitch;
		volume.gain.setValueAtTime(0.001, t);
		volume.gain.exponentialRampToValueAtTime(0.075, t + 0.025);
		volume.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
		tone.connect(volume).connect(context.destination);
		tone.start(t);
		tone.stop(t + 0.33);
	}
}

export function LessonFinish({ state, busy, receipt }: { state: LessonFinishState; busy: boolean; receipt?: LessonReceipt }) {
	const router = useRouter();
	const [sound, setSound] = useState(true);
	const [saving, setSaving] = useState(false);
	const [exportingMode, setExportingMode] = useState<FlashcardExportMode | null>(null);
	const [exportStatus, setExportStatus] = useState<{ ok: boolean; text: string } | null>(null);
	const played = useRef(state.completed);
	const [error, setError] = useState("");
	const [xp, setXp] = useState(receipt?.after ?? 0);
	const lock = useRef(false);
	const active = useRef(true);
	const audio = useRef<AudioContext | null>(null);
	const starter = useRef(new SessionStarter());

	useEffect(() => {
		active.current = true;
		try { setSound(localStorage.getItem("lh:lesson-chime") !== "off"); } catch { /* optional preference */ }
		return () => { active.current = false; void audio.current?.close().catch(() => {}); audio.current = null; };
	}, []);

	useEffect(() => {
		if (!sound || state.completed) return;
		const unlock = () => {
			try { audio.current ??= new AudioContext(); void audio.current.resume().catch(() => {}); } catch { /* optional audio */ }
		};
		window.addEventListener("pointerdown", unlock, { once: true });
		window.addEventListener("keydown", unlock, { once: true });
		return () => { window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
	}, [sound, state.completed]);

	useEffect(() => {
		if (!receipt || busy || receipt.outcome === "reinforce" || receipt.alreadyCompleted || played.current) {
			if (receipt) setXp(receipt.after);
			return;
		}
		played.current = true;
		if (sound && audio.current?.state === "running") chime(audio.current);
		const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		if (reduced || receipt.after <= receipt.before) {
			setXp(receipt.after);
			return;
		}
		const start = performance.now();
		let frame = 0;
		function tick(t: number) {
			if (!receipt) return;
			const fraction = Math.min(1, (t - start) / 850);
			setXp(Math.round(receipt.before + (receipt.after - receipt.before) * fraction));
			if (fraction < 1) frame = requestAnimationFrame(tick);
		}
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [receipt, busy, sound]);

	const openNext = useCallback(async (resumeId: string | null | undefined, nextItem: StudyToday["next"] | undefined) => {
		if (lock.current || !active.current) return;
		lock.current = true;
		setSaving(true);
		setError("");
		try {
			let href = "/";
			if (resumeId) href = "/chat/" + encodeURIComponent(resumeId);
			else if (nextItem) {
				const { brief, nodeId, estMinutes } = nextItem;
				const minutes = Math.round(estMinutes);
				href = await starter.current.start(studyLessonRequest({
					domainId: state.domainId,
					minutes,
					title: brief.title,
					context: { id: nodeId, name: brief.title, statement: lessonStatement(brief, minutes) },
				}), fetch);
			}
			if (active.current) router.push(href);
		} catch {
			setError("A conclusão está salva. Tente abrir a próxima aula novamente.");
		} finally {
			lock.current = false;
			if (active.current) setSaving(false);
		}
	}, [router, state.domainId]);

	const startRetry = useCallback(async (target: LessonRetryTarget) => {
		if (lock.current || !active.current) return;
		lock.current = true;
		setSaving(true);
		setError("");
		try {
			const minutes = Math.round(target.estMinutes);
			const href = await starter.current.start(studyLessonRequest({
				domainId: state.domainId,
				minutes,
				title: target.brief.title,
				context: {
					id: target.nodeId,
					name: target.brief.title,
					statement: lessonStatement(target.brief, minutes, target.feedback),
				},
			}), fetch);
			if (active.current) router.push(href);
		} catch {
			setError("Não foi possível abrir a nova tentativa. Tente novamente ou abra pelo mapa.");
		} finally {
			lock.current = false;
			if (active.current) setSaving(false);
		}
	}, [router, state.domainId]);

	const exportFlashcards = useCallback(async (mode: FlashcardExportMode) => {
		setExportingMode(mode);
		setExportStatus(null);
		try {
			const res = await fetch("/api/study/flashcards/export", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ mode }),
			});
			const payload = await res.json().catch(() => null) as Record<string, unknown> | null;
			if (!active.current) return;
			if (!res.ok) {
				const reason = typeof payload?.error === "string" && payload.error.trim()
					? payload.error.trim()
					: typeof payload?.message === "string" && payload.message.trim()
						? payload.message.trim()
						: "Não foi possível exportar os flashcards agora.";
				setExportStatus({ ok: false, text: reason });
				return;
			}
			setExportStatus({ ok: true, text: formatExportStatus(mode, payload) });
		} catch {
			if (active.current) setExportStatus({ ok: false, text: "Falha de conexão ao exportar flashcards." });
		} finally {
			if (active.current) setExportingMode(null);
		}
	}, []);

	const finished = Boolean(receipt || state.completed);
	const needsReinforcement = receipt?.outcome === "reinforce" || Boolean(state.reinforcement);
	const course = receipt?.course ?? state.course ?? null;
	const courseProgress = receipt?.course ?? null;
	const nextLesson = receipt ? receipt.next : state.next ?? null;
	const resumeSession = receipt ? receipt.resume : state.resume ?? null;
	const retryTarget = receipt?.retry ?? state.retry ?? null;
	const mapHref = "/mapa?" + new URLSearchParams({ dominio: state.domainId, no: state.nodeId });
	const showModuleExam = Boolean(
		course && !needsReinforcement && (
			courseProgress?.moduleJustCompleted
			|| (course.moduleTotal > 0 && course.moduleCompleted === course.moduleTotal)
		),
	);
	const moduleExamHref = course
		? `/ementa?dominio=${encodeURIComponent(state.domainId)}&modulo=${encodeURIComponent(course.moduleId)}&acao=prova`
		: null;
	const progress = receipt ? levelProgress(xp) : null;

	const headline = needsReinforcement
		? "Aula encerrada · reforço indicado"
		: courseProgress?.chapterJustCompleted
			? `Capítulo concluído · ${courseProgress.chapterLevel}`
			: courseProgress?.moduleJustCompleted
				? `Módulo concluído · ${courseProgress.moduleTitle}`
				: receipt
					? "Aula concluída pelo professor"
					: "Aula concluída";

	return (
		<section aria-label="Conclusão da missão" data-testid="lesson-finish-card" className="my-4">
			{finished ? (
				<div className="cel-card space-y-3 p-4">
					<div className="flex flex-wrap items-center gap-2">
						<Icon name={needsReinforcement ? "review" : "check"} size={20} />
						<strong className="cel-display text-base">{headline}</strong>
						{receipt?.cards != null && (
							<span className="study-pill ml-auto">
								<Icon name="flashcard" size={13} tone={false} />
								{receipt.cards ? `${receipt.cards} flashcards` : "Cartões prontos"}
							</span>
						)}
					</div>

					{receipt && !needsReinforcement && progress && (
						<div className="space-y-1">
							<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums">
								<span className="font-semibold text-foreground">
									{receipt.after > receipt.before ? `+${receipt.after - receipt.before} XP` : "XP já contabilizado"}
								</span>
								<span>Nível {progress.level} · {xp.toLocaleString("pt-BR")} XP no total</span>
							</div>
							<progress className="study-progress study-progress-xp block w-full" aria-label="Progresso no nível" value={progress.fraction} max={1} />
						</div>
					)}

					{(receipt?.assessment || state.reinforcement) && (
						<p className="text-sm leading-relaxed text-foreground/90">{receipt?.assessment ?? state.reinforcement}</p>
					)}

					{receipt?.criteria && receipt.criteria.length > 0 && (
						<ul className="space-y-2">
							{receipt.criteria.map((criterion, index) => (
								<li key={index} className="rounded-xl border border-border/50 bg-background/60 px-3 py-2 text-sm">
									<div className="flex items-center gap-2">
										<span className={criterion.met ? "study-pill study-pill-success" : "study-pill study-pill-warning"}>
											{criterion.met ? "Atendido" : "A reforçar"}
										</span>
										{criterion.title && <strong className="text-sm">{criterion.title}</strong>}
									</div>
									<p className="mt-1 text-xs leading-relaxed text-muted-foreground">{criterion.reason}</p>
								</li>
							))}
						</ul>
					)}

					{course && (
						<div className="space-y-1.5 rounded-xl border border-border/50 bg-background/60 px-3 py-2.5 text-xs">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<span className="font-semibold text-foreground">
									Módulo {course.moduleIndex}/{course.totalModules} · {course.moduleTitle}
								</span>
								<span className="tabular-nums text-muted-foreground">
									{course.moduleCompleted}/{course.moduleTotal} aulas · {course.chapterLevel} ({course.chapterKnown}/{course.chapterTotal})
								</span>
							</div>
							<progress
								className="study-progress block w-full"
								max={Math.max(1, course.moduleTotal)}
								value={course.moduleCompleted}
								aria-label={`Progresso do módulo ${course.moduleTitle}`}
							/>
							{courseProgress?.chapterJustCompleted && courseProgress.nextChapterTitle && (
								<p className="font-medium text-foreground">Próximo capítulo desbloqueado: {courseProgress.nextChapterTitle}</p>
							)}
							{!courseProgress?.chapterJustCompleted && courseProgress?.moduleJustCompleted && courseProgress.nextModuleTitle && (
								<p className="font-medium text-foreground">Próximo módulo desbloqueado: {courseProgress.nextModuleTitle}</p>
							)}
							{showModuleExam && moduleExamHref && (
								<div className="pt-1">
									<Link
										href={moduleExamHref}
										data-testid="lesson-module-exam-link"
										className="cel-button min-h-8 px-3 py-1 text-xs"
									>
										<Icon name="exercise" size={14} tone={false} />
										Prova Integradora do Módulo
									</Link>
								</div>
							)}
						</div>
					)}

					{!needsReinforcement && receipt?.cards != null && (
						<div className="space-y-1.5 rounded-xl border border-border/50 bg-background/60 px-3 py-2.5 text-xs">
							<div className="flex flex-wrap items-center gap-2">
								<span className="inline-flex items-center gap-1.5 font-medium text-foreground">
									<Icon name="export-cards" size={14} tone={false} />
									Exportação rápida de flashcards
								</span>
								<div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
									{EXPORT_MODES.map(({ mode, label }) => (
										<button
											key={mode}
											type="button"
											disabled={exportingMode !== null}
											onClick={() => void exportFlashcards(mode)}
											className="cel-button cel-button-ghost min-h-7 px-2.5 py-0.5 text-xs"
										>
											{exportingMode === mode ? "Exportando…" : label}
										</button>
									))}
								</div>
							</div>
							{exportStatus && (
								<p
									role="status"
									className={exportStatus.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}
								>
									{exportStatus.text}
								</p>
							)}
						</div>
					)}

					{!needsReinforcement && (nextLesson || resumeSession) && (
						<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/80 px-3.5 py-3">
							<div className="min-w-0 flex-1">
								<p className="text-xs uppercase tracking-wider text-muted-foreground">
									{resumeSession ? "Retomar próxima aula" : KIND_LABEL[nextLesson!.kind] ?? "A seguir no curso"}
									{nextLesson ? ` · ~${Math.round(nextLesson.estMinutes)} min` : ""}
								</p>
								{nextLesson && <p className="cel-display truncate text-base">{nextLesson.brief.title}</p>}
								{nextLesson && nextLesson.brief.path.length > 0 && (
									<p className="truncate text-xs text-muted-foreground">{nextLesson.brief.path.join(" › ")}</p>
								)}
							</div>
							<button
								type="button"
								data-testid="lesson-next-button"
								className="cel-button cel-button-primary min-h-9 shrink-0 px-4 py-1.5 text-sm"
								disabled={saving || busy}
								onClick={() => void openNext(resumeSession, nextLesson)}
							>
								<Icon name="play" size={15} />
								{saving ? "Abrindo…" : resumeSession ? "Retomar aula" : "Próxima aula"}
							</button>
						</div>
					)}

					<div className="flex flex-wrap items-center gap-3 pt-1 text-sm">
						{needsReinforcement && retryTarget && (
							<button
								type="button"
								data-testid="lesson-retry-button"
								className="cel-button cel-button-primary min-h-9 px-4 py-1.5 text-sm"
								disabled={saving || busy}
								onClick={() => void startRetry(retryTarget)}
							>
								<Icon name="play" size={15} />
								{saving ? "Abrindo…" : "Praticar novamente este tópico"}
							</button>
						)}
						<Link className="cel-button cel-button-ghost px-3 py-1.5 text-xs" href={mapHref}>
							<Icon name="map" size={14} tone={false} />
							{needsReinforcement ? "Livros, vídeos e pré-requisitos na árvore" : "Ver na árvore"}
						</Link>
						<Link className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground" href="/">
							Voltar à campanha
						</Link>
					</div>
				</div>
			) : (
				<label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
					<input
						type="checkbox"
						className="accent-[var(--cel-accent,var(--primary))]"
						checked={sound}
						onChange={e => {
							setSound(e.target.checked);
							try { localStorage.setItem("lh:lesson-chime", e.target.checked ? "on" : "off"); } catch { /* optional preference */ }
						}}
					/>
					Som ao concluir a missão
				</label>
			)}
			{error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
		</section>
	);
}
