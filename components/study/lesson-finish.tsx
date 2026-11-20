"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { levelProgress, type StudyToday } from "@/src/core";
import { SessionStarter, studyLessonRequest } from "../start-session.ts";
import { lessonStatement } from "./lesson-statement.ts";

export interface LessonFinishState { domainId: string; sessionId: string; nodeId: string; completed: boolean }
interface Receipt { before: number; after: number; alreadyCompleted: boolean; resume: string | null; next: StudyToday["next"] }
const grades = ["Ainda não entendi", "Entendi em parte", "Consegui com ajuda", "Consegui sem ajuda"];

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

export function LessonFinish({ state, disabled }: { state: LessonFinishState; disabled: boolean }) {
	const router = useRouter();
	const [expanded, setExpanded] = useState(false);
	const [sound, setSound] = useState(true);
	const [saving, setSaving] = useState(false);
	const [receipt, setReceipt] = useState<Receipt | null>(null);
	const [error, setError] = useState("");
	const [celebrating, setCelebrating] = useState(false);
	const [xp, setXp] = useState(0);
	const dialog = useRef<HTMLDialogElement>(null);
	const lock = useRef(false);
	const active = useRef(true);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const audio = useRef<AudioContext | null>(null);
	const starter = useRef(new SessionStarter());
	useEffect(() => {
		active.current = true;
		try { setSound(localStorage.getItem("lh:lesson-chime") !== "off"); } catch { /* optional preference */ }
		return () => { active.current = false; clearTimeout(timer.current); void audio.current?.close().catch(() => {}); };
	}, []);

	const advance = async (result: Receipt) => {
		if (lock.current || !active.current) return;
		lock.current = true;
		setSaving(true);
		setError("");
		try {
			let href = "/";
			if (result.resume) href = "/chat/" + encodeURIComponent(result.resume);
			else if (result.next) {
				const { brief, nodeId, estMinutes } = result.next;
				const minutes = Math.round(estMinutes);
				href = await starter.current.start(studyLessonRequest({ domainId: state.domainId, minutes, title: brief.title,
					context: { id: nodeId, name: brief.title, statement: lessonStatement(brief, minutes) } }), fetch);
			}
			if (active.current) router.push(href);
		} catch {
			setError("A conclusão está salva. Tente abrir a próxima missão novamente.");
		} finally {
			lock.current = false;
			if (active.current) setSaving(false);
		}
	};
	const finish = async (grade: number) => {
		if (lock.current || disabled) return;
		lock.current = true;
		setSaving(true);
		setError("");
		if (sound && window.AudioContext) {
			try { audio.current ??= new AudioContext(); void audio.current.resume().catch(() => {}); } catch { /* sound is optional */ }
		}
		try {
			const r = await fetch("/api/study/finish", { method: "POST", headers: { "content-type": "application/json" },
				body: JSON.stringify({ domainId: state.domainId, sessionId: state.sessionId, grade }) });
			const result = await r.json();
			if (!r.ok) throw new Error(result.error || "Não foi possível concluir a aula.");
			if (!active.current) return;
			setReceipt(result);
			if (!result.alreadyCompleted) {
				setXp(result.before);
				setCelebrating(true);
				if (result.resume || result.next) timer.current = setTimeout(() => { setCelebrating(false); void advance(result); }, 4500);
				else timer.current = setTimeout(() => setCelebrating(false), 4500);
				if (sound && audio.current?.state === "running") chime(audio.current);
			}
		} catch (e) { setError(e instanceof Error ? e.message : "Verifique a conexão e tente novamente."); }
		finally { lock.current = false; if (active.current) setSaving(false); }
	};

	useEffect(() => {
		if (!celebrating || !receipt) return;
		dialog.current?.showModal();
		const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const start = performance.now();
		let frame = 0;
		function tick(t: number) {
			if (!receipt) return;
			const fraction = reduced ? 1 : Math.min(1, (t - start) / 900);
			setXp(Math.round(receipt.before + (receipt.after - receipt.before) * fraction));
			if (fraction < 1) frame = requestAnimationFrame(tick);
		}
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [celebrating, receipt]);
	const stay = () => { clearTimeout(timer.current); setCelebrating(false); };
	const progress = levelProgress(xp);
	return <section aria-label="Conclusão da missão" className="my-3">
		{receipt || state.completed ? <div className="flex flex-wrap items-center gap-3">
			<strong>Aula concluída</strong>
			{receipt && (receipt.next || receipt.resume) ? <button className="cel-button px-3" disabled={saving} onClick={() => void advance(receipt)}>Continuar campanha</button>
				: <Link className="underline" href="/">Voltar à campanha</Link>}
		</div> : <>
			<button className="cel-button px-3 py-1" disabled={disabled || saving} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>Concluir aula</button>
			{expanded && <fieldset disabled={disabled || saving} className="cel-card mt-2 p-3"><legend>Como você se saiu nesta missão?</legend>
				<div className="flex flex-wrap gap-2">{grades.map((label, grade) => <button key={label} className="cel-button px-2 py-1" onClick={() => void finish(grade)}>{label}</button>)}</div>
				<label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={sound} onChange={e => {
					setSound(e.target.checked); try { localStorage.setItem("lh:lesson-chime", e.target.checked ? "on" : "off"); } catch { /* optional */ }
				}}/> Som de conclusão</label>
			</fieldset>}
		</>}
		{error && <p role="alert">{error}</p>}
		{celebrating && receipt && <dialog ref={dialog} aria-label="Aula concluída" onCancel={stay}
			className="cel-card fixed inset-0 m-auto w-[min(90vw,25rem)] p-6 text-center text-foreground backdrop:bg-black/65">
			<div aria-hidden="true" className="lesson-star text-4xl text-amber-500">✦</div>
			<h2 className="cel-display text-2xl">Aula concluída!</h2>
			<p>{receipt.after > receipt.before ? "+" + (receipt.after - receipt.before) + " XP" : "O XP desta atividade já foi contabilizado."}</p>
			<progress className="my-2 w-full" aria-label="Progresso no nível" value={progress.fraction} max={1}/>
			<p>Nível {progress.level} · {xp} XP no total</p>
			<p className="my-3">{receipt.resume ? "Retomando a próxima aula em andamento…" : receipt.next ? "A seguir · " + receipt.next.brief.title : "Nenhuma próxima missão indicada por agora. Seu progresso está salvo."}</p>
			<button className="cel-button px-3" onClick={stay}>Ficar nesta aula</button>
		</dialog>}
	</section>;
}
