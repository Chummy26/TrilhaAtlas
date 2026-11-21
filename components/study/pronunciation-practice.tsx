"use client";

import { useEffect, useRef, useState } from "react";
import { Ear, Mic, PencilLine } from "lucide-react";
import type { LessonActivity } from "@/src/core";

const conversation = "https://voa-audio.voanews.eu/vle/2016/02/08/49485bf8-4277-47f6-9abe-617ee2473f8c.mp3";
const video = "https://learningenglish.voanews.com/a/lets-learn-english-lesson-one/3111026.html";

export function PronunciationPractice({ voice, title }: { voice: NonNullable<LessonActivity["voice"]>; title?: string }) {
	const [heard, setHeard] = useState<string>();
	const [status, setStatus] = useState("");
	const [recording, setRecording] = useState(false);
	const [requesting, setRequesting] = useState(false);
	const [clip, setClip] = useState("");
	const [letter, setLetter] = useState(-1);
	const recorder = useRef<MediaRecorder | null>(null);
	const mounted = useRef(false);
	const run = useRef(0);
	const waiting = useRef(false);
	const limit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const speaking = useRef(false);
	const sourceAudio = useRef<HTMLAudioElement>(null);
	const spelling = voice.mode === "spelling";
	const letters = Array.from(voice.sample.toUpperCase());
	const anna = spelling && voice.language.startsWith("en") && voice.sample.toLowerCase() === "anna";
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			run.current++;
			if (speaking.current) window.speechSynthesis?.cancel();
			clearTimeout(limit.current);
			if (recorder.current?.state === "recording") recorder.current.stop();
			recorder.current?.stream.getTracks().forEach(track => track.stop());
		};
	}, []);
	useEffect(() => () => { if (clip) URL.revokeObjectURL(clip); }, [clip]);

	function listen() {
		sourceAudio.current?.pause();
		const synth = window.speechSynthesis;
		if (!synth) { setStatus("A voz sintetizada está indisponível neste navegador."); return; }
		const id = ++run.current;
		synth.cancel();
		const available = synth.getVoices();
		const matching = available.find(v => v.lang === voice.language) ?? available.find(v => v.lang.split("-")[0] === voice.language.split("-")[0]);
		if (available.length && !matching) { setStatus("O navegador não tem voz instalada neste idioma."); return; }
		setStatus("");
		const parts = spelling ? letters : [voice.sample];
		const play = (i: number) => {
			if (id !== run.current || !mounted.current) return;
			speaking.current = i < parts.length;
			setLetter(spelling && speaking.current ? i : -1);
			if (!speaking.current) return;
			const utterance = new SpeechSynthesisUtterance(parts[i]);
			utterance.lang = voice.language;
			if (matching) utterance.voice = matching;
			utterance.rate = 0.78;
			utterance.onend = () => play(i + 1);
			utterance.onerror = () => { if (id === run.current && mounted.current) { speaking.current = false; setLetter(-1); setStatus("Não foi possível reproduzir a voz do navegador."); } };
			synth.speak(utterance);
		};
		play(0);
	}

	async function record() {
		if (recorder.current?.state === "recording") { recorder.current.stop(); return; }
		if (waiting.current) return;
		waiting.current = true;
		setRequesting(true);
		setStatus("");
		sourceAudio.current?.pause();
		run.current++;
		window.speechSynthesis?.cancel();
		setLetter(-1);
		let stream: MediaStream | undefined;
		try {
			if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error();
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			if (!mounted.current) { stream.getTracks().forEach(track => track.stop()); return; }
			const device = new MediaRecorder(stream);
			recorder.current = device;
			const chunks: Blob[] = [];
			device.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
			device.onstop = () => {
				clearTimeout(limit.current);
				device.stream.getTracks().forEach(track => track.stop());
				if (!mounted.current) return;
				setRecording(false);
				if (chunks.length) setClip(URL.createObjectURL(new Blob(chunks, { type: device.mimeType })));
				else setStatus("Nenhum áudio capturado. Tente novamente.");
			};
			device.start();
			setRecording(true);
			limit.current = setTimeout(() => { if (device.state === "recording") device.stop(); }, 30000);
		} catch {
			stream?.getTracks().forEach(track => track.stop());
			if (mounted.current) setStatus("Microfone indisponível. Você pode responder no chat pelo teclado.");
		} finally { waiting.current = false; if (mounted.current) setRequesting(false); }
	}

	return <section className="study-lab" aria-label="Prática de pronúncia">
		<header><h2>{title ?? "Prática de pronúncia"}</h2></header>
		<div className="lab-body">
		{anna && <div className="space-y-3"><p><Ear size={18} className="mr-1 inline" /> Ouça como Pete entende o nome e como Anna corrige a letra repetida.</p>
			<audio ref={sourceAudio} className="w-full" controls preload="none" src={conversation} aria-label="Diálogo original de Anna e Pete" />
			<fieldset className="space-y-2"><legend className="text-sm font-semibold">Que nome Pete entende na primeira tentativa?</legend>
				<div className="flex gap-2">{["Ana", "Anna"].map(name => <button type="button" key={name} aria-pressed={heard === name} className="cel-button px-3" onClick={() => setHeard(name)}>{name}</button>)}</div>
				{heard && <div aria-live="polite" className="mt-2 space-y-2">
					<svg aria-hidden="true" viewBox="0 0 280 82" className="mx-auto w-full max-w-72" fill="none" stroke="currentColor" strokeWidth="2">
						<path d="M8 72q1-18 21-18t22 18M236 72q1-18 21-18t20 18" />
						<circle cx="30" cy="41" r="12" /><path d="M18 40q5-22 24-4" />
						<circle cx="256" cy="41" r="12" /><path d="M242 51q-6-28 13-26 17-2 17 27" />
						<path d="M49 9h66v34H65l-13 9 3-9h-6zM162 9h68v34h-5l3 9-14-9h-52z" fill="currentColor" fillOpacity=".06" />
						<path d="M120 27h34m-6-5 6 5-6 5" strokeDasharray="3 2" />
						<g textAnchor="middle" stroke="none" fill="currentColor" fontSize="16"><text x="82" y="32">A N A?</text><text x="196" y="32">A N N A</text></g>
					</svg>
					<p>{heard === "Ana" ? "Isso. Pete ouviu um N." : "Essa é a correção de Anna. Na primeira tentativa, Pete entendeu só um N."} Ouça de novo onde ela repete o nome da letra.</p>
				</div>}
			</fieldset>
			<a href={video} target="_blank" rel="noreferrer" className="inline-block text-sm underline underline-offset-2">Ver vídeo e transcrição na VOA</a></div>}
		<div lang={voice.language} className="flex flex-wrap gap-1.5 text-lg font-semibold">{spelling ? letters.map((l, i) =>
			<span key={i} className={"rounded-lg border px-2.5 py-1 font-mono text-base transition-colors " + (letter === i ? "border-foreground bg-foreground text-background" : "border-border bg-background")}>{l}</span>) : voice.sample}</div>
		<div className="flex flex-wrap gap-2">
			<button type="button" className="cel-button px-3.5" disabled={recording || requesting} onClick={listen}>{spelling ? "Ouvir letra por letra" : "Ouvir o exemplo"} · voz sintetizada</button>
			<button type="button" className="cel-button px-3.5" disabled={requesting} onClick={() => void record()}>{recording ? "Parar gravação" : requesting ? "Abrindo microfone…" : "Gravar minha voz"}</button>
		</div>
		<p className="text-sm"><Mic size={16} className="mr-1 inline" /> Para comparar sua fala com o exemplo, grave até 30 segundos e ouça. A gravação fica neste aparelho.</p>
		{clip && <audio aria-label="Ouvir minha gravação" controls className="w-full" src={clip} />}
		{status && <p role="status" className="text-sm">{status}</p>}
		</div>
		<footer>
			<p className="text-sm"><PencilLine size={16} className="mr-1 inline" /> {spelling ? "Na sua vez, digite as letras na ordem pedida, separadas por hífens. O professor confere a ordem." : "Para responder no chat, digite a sua frase."} Se usar o ditado, confira o texto antes de enviar. A transcrição não mede pronúncia.</p>
		</footer>
	</section>;
}
