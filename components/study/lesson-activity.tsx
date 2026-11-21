"use client";

import { useContext, useState } from "react";
import { ChatActionsContext } from "@/components/chat";
import { PronunciationPractice } from "./pronunciation-practice.tsx";
import { ComicStrip } from "./comic-strip.tsx";
import { pickStoryMotif, StoryBadge } from "./comic-art.tsx";
import { CircuitFigure } from "@/components/study/circuit-figure";
import { currentReadings, dividerLab, falstadExperiments, parseLessonActivity, type ArtifactPartProps, type LessonActivity } from "@/src/core";

const presets = {
	circuit: { title: "Tensão, resistência e corrente", instruction: "Mantenha a tensão e dobre a resistência. Observe a corrente.", source: "OpenStax · College Physics 2e, §20.2", url: "https://openstax.org/books/college-physics-2e/pages/20-2-ohms-law-resistance-and-simple-circuits" },
	notation: { title: "Uma corrente, três escritas", instruction: "Alterne a unidade e o expoente para representar a mesma medida.", source: "BIPM · Prefixos do Sistema Internacional", url: "https://www.bipm.org/en/measurement-units/si-prefixes" },
	timeline: { title: "Quando o telefone tocou?", instruction: "Mova a ligação para antes, durante ou depois da leitura.", source: "British Council · Past continuous and past simple", url: "https://learnenglish.britishcouncil.org/free-resources/grammar/a1-a2/past-continuous-past-simple" },
};
const scenes = [
	{ time: "8h45", position: 15, phrase: "The phone rang before I started reading.", meaning: "A ligação veio antes do início da leitura." },
	{ time: "9h30", position: 50, phrase: "I was reading when the phone rang.", meaning: "A leitura estava em andamento quando o telefone tocou." },
	{ time: "10h15", position: 85, phrase: "The phone rang after I finished reading.", meaning: "A leitura já tinha terminado quando o telefone tocou." },
];
const formats = ["Prefixo SI", "Decimal", "Científica"];
const formatKeys = ["si", "decimal", "scientific"] as const;

function Choices({ label, items, selected, choose }: { label: string; items: string[]; selected: number; choose: (index: number) => void }) {
	return <div className="lab-choices" role="group" aria-label={label}>{items.map((item, i) =>
		<button type="button" key={i} aria-pressed={i === selected} onClick={() => choose(i)}>{item}</button>)}</div>;
}

export function ActivityArtifact({ part }: ArtifactPartProps) {
	if (part.state !== "output-available") return null;
	const activity = parseLessonActivity(part.output);
	return activity ? <ActivityPanel activity={activity} /> : null;
}

export function ActivityPanel({ activity }: { activity: LessonActivity }) {
	if (activity.kind === "pronunciation" && activity.voice) return <PronunciationPractice key={JSON.stringify(activity.voice)} voice={activity.voice} title={activity.title} />;
	if (activity.kind === "divider") return <DividerPanel key={JSON.stringify(activity.divider)} initial={activity.divider} />;
	if (activity.kind === "falstad" && activity.experiment) {
		const lab = falstadExperiments[activity.experiment];
		return <section className="study-lab" aria-label={lab.title}><header><h2>{lab.title}</h2><p>{lab.task}</p></header>
			<footer><a className="cel-button cel-button-primary w-fit px-4 py-1.5 text-sm no-underline" href={"https://www.falstad.com/circuit/circuitjs.html?startCircuit=" + lab.file} target="_blank" rel="noreferrer">Abrir experimento no Falstad</a></footer>
		</section>;
	}
	return <LessonPanel activity={activity} />;
}

function DividerPanel({ initial }: { initial?: LessonActivity["divider"] }) {
	const actions = useContext(ChatActionsContext);
	const [volts, setVolts] = useState(initial?.volts ?? 10);
	const [upper, setUpper] = useState(initial?.upperOhms ?? 10000);
	const [lower, setLower] = useState(initial?.lowerOhms ?? 10000);
	const [notice, setNotice] = useState("");
	const valid = [upper, lower].every(n => Number.isInteger(n) && n >= 1 && n <= 1e7) && Number.isFinite(volts) && volts >= 0 && volts <= 24;
	const lab = valid ? dividerLab(volts, upper, lower) : undefined;
	const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumSignificantDigits: 5 });
	return <section className="study-lab" aria-label="Laboratório de divisor de tensão">
		<header><h2>Divisor de tensão sem carga</h2><p>Preveja a tensão entre R1 e R2. Depois, dobre R2 e compare as leituras.</p></header>
		<div className="lab-controls">
			<label>Fonte (V)<input type="number" min="0" max="24" step="any" value={Number.isNaN(volts) ? "" : volts} onChange={e => setVolts(e.target.valueAsNumber)} /></label>
			<label>R1 entre fonte e saída (Ω)<input type="number" min="1" max="10000000" value={Number.isNaN(upper) ? "" : upper} onChange={e => setUpper(e.target.valueAsNumber)} /></label>
			<label>R2 entre saída e terra (Ω)<input type="number" min="1" max="10000000" value={Number.isNaN(lower) ? "" : lower} onChange={e => setLower(e.target.valueAsNumber)} /></label>
			<output aria-live="polite" className="rounded-lg border-l-[3px] border-[var(--lab-accent)] bg-background/70 px-3 py-2 text-[var(--lh-prose-size)] font-bold tabular-nums">{lab ? `Saída: ${fmt(lab.voltsOut)} V · Corrente: ${fmt(lab.milliamps)} mA` : "Use uma fonte de 0 a 24 V e resistências inteiras de 1 a 10 milhões de ohms."}</output>
		</div>
		{lab && <footer className="flex flex-wrap gap-3">
			<a href={lab.falstad} target="_blank" rel="noreferrer" className="underline">Abrir circuito no Falstad</a>
			<a href={"data:text/plain;charset=utf-8," + encodeURIComponent(lab.netlist)} download="divisor.cir" className="underline">Baixar circuito para LTspice (.cir)</a>
			{actions?.askActivity && <button type="button" onClick={async () => {
				const sent = await actions.askActivity?.(`Por que a saída foi ${fmt(lab.voltsOut)} V no divisor sem carga? Fonte ${volts} V, R1 ${upper} Ω e R2 ${lower} Ω.`);
				setNotice(sent ? "" : "O chat está ocupado. Tente novamente.");
			}}>Discutir esta medição</button>}{notice && <span role="status">{notice}</span>}
		</footer>}
	</section>;
}

function LessonPanel({ activity }: { activity: LessonActivity }) {
	const actions = useContext(ChatActionsContext);
	const [volts, setVolts] = useState(10);
	const [resistance, setResistance] = useState(5);
	const [closed, setClosed] = useState(true);
	const [board, setBoard] = useState(false);
	const [format, setFormat] = useState(0);
	const [prediction, setPrediction] = useState(-1);
	const [index, setIndex] = useState(activity.kind === "timeline" ? 1 : 0);
	const [question, setQuestion] = useState("");
	const [notice, setNotice] = useState("");
	const kind = activity.kind;
	const preset = kind === "circuit" || kind === "notation" || kind === "timeline" ? presets[kind] : undefined;
	const title = preset?.title ?? activity.title;
	const readings = currentReadings(volts, resistance, closed);
	const circuit = kind === "circuit" || kind === "notation";
	const scene = scenes[index] ?? scenes[1]!;
	const step = activity.steps?.[index];
	const comicPanel = activity.panels?.[index];
	const context = circuit ? `${volts} V, ${resistance} kΩ, chave ${closed ? "fechada" : "aberta"}, ${board ? "protoboard" : "esquema"}. Corrente: ${readings[formatKeys[format]!]}. `
		: kind === "timeline" ? `Ligação às ${scene.time}. ${scene.phrase}`
		: kind === "comic" && comicPanel
			? `Quadrinho ${index + 1} (${comicPanel.speaker}: "${comicPanel.speech}"${comicPanel.reply ? ` / ${comicPanel.replySpeaker ?? "Você"}: "${comicPanel.reply}"` : ""}).${comicPanel.cue ? ` Pista: ${comicPanel.cue}.` : ""} ${comicPanel.caption}`
		: `${step?.label} — ${step?.detail}`;
	const source = preset?.url ?? activity.source;
	const inline = !preset && activity.presentation === "inline";
	return <section className="study-lab" data-presentation={inline ? "inline" : "panel"} data-kind={kind} aria-label={title}
		onKeyDown={e => { if (e.key === "Enter") e.stopPropagation(); }}>
		<header><h2>{title}</h2>{preset && <p>{preset.instruction}</p>}</header>
		{circuit ? <div className="lab-grid">
			<div className="lab-drawing">
				<Choices label="Vista do circuito" items={["Esquema", "Protoboard"]} selected={Number(board)} choose={v => setBoard(Boolean(v))} />
				<CircuitFigure board={board} volts={volts} resistance={resistance} closed={closed} />
			</div>
			<div className="lab-controls">
				<label>Tensão <b>{volts} V</b><input aria-label="Tensão em volts" type="range" min="0" max="20" value={volts} onChange={e => setVolts(+e.target.value)} /></label>
				<label>Resistência <b>{resistance} kΩ</b><input aria-label="Resistência em quilohms" type="range" min="1" max="20" value={resistance} onChange={e => setResistance(+e.target.value)} /></label>
				<label className="lab-switch"><input type="checkbox" checked={closed} onChange={e => setClosed(e.target.checked)} /> Circuito fechado</label>
				<div className="lab-reading"><span>Corrente</span><output>{readings[formatKeys[format]!]}</output>
					<Choices label="Representação da corrente" items={formats} selected={format} choose={setFormat} />
				</div>
			</div>
		</div> : kind === "timeline" ? <div className="lab-body">
			<div className="lab-time"><div className="lab-duration">Leitura · 9h–10h</div><span className="lab-event" style={{ left: scene.position + "%" }}>☎ {scene.time}</span></div>
			<label className="lab-range-label">Momento da ligação<input type="range" min="0" max="2" value={index} aria-valuetext={scene.time} onChange={e => setIndex(+e.target.value)} /></label>
			<div aria-live="polite"><strong lang="en">{scene.phrase}</strong><p>{scene.meaning}</p></div>
		</div> : kind === "comic" && activity.panels?.length ? <div className="lab-body">
			<ComicStrip panels={activity.panels} selected={index} onSelect={setIndex} language={activity.language} />
		</div> : <div className="lab-body">
			{kind === "diagram" ? <ol className="lab-chain lab-story-cards" aria-label="Relações entre etapas">{activity.steps?.map((s, i, steps) => {
				const motif = pickStoryMotif(s.label, i, i < steps.length - 1, s.illustration);
				return <li key={i}><button type="button" className="lab-story-btn" aria-pressed={i === index} onClick={() => setIndex(i)}>
					<span className="lab-story-num" aria-hidden="true">{i + 1}</span>
					<StoryBadge motif={motif} width={44} height={30} className="mx-auto mb-1" />
					<span>{s.label}</span>
				</button></li>;
			})}</ol> : <div className="lab-choices lab-story-choices" role="group" aria-label={kind === "comparison" ? "Comparação" : "Etapas"}>{activity.steps?.map((s, i, steps) => {
				const motif = pickStoryMotif(s.label, i, i < steps.length - 1, s.illustration ?? (kind === "comparison" ? "compare" : undefined));
				return <button type="button" key={i} className="lab-story-chip" aria-pressed={i === index} onClick={() => setIndex(i)}>
					<StoryBadge motif={motif} width={32} height={22} />
					<span>{s.label}</span>
				</button>;
			})}</div>}
			<div aria-live="polite">{!inline && <strong>{step?.label}</strong>}<p>{step?.detail}</p></div>
		</div>}
		<footer>
			{circuit && <div className="lab-prediction">
				<h3>Com a chave fechada e a fonte em 10 V, o que acontece se a resistência passar de 5 para 10 kΩ?</h3>
				<Choices label="Previsão de corrente" items={["Dobra", "Cai pela metade", "Fica igual"]} selected={prediction} choose={setPrediction} />
				<div role="status">{prediction >= 0 && <p className={prediction === 1 ? "lab-confirmed" : undefined}>{prediction === 1
					? "Isso mesmo. A corrente passa de 2 mA para 1 mA. Experimente os dois valores no circuito."
					: "Use I = V/R. Compare 10 V ÷ 5 kΩ com 10 V ÷ 10 kΩ e tente de novo."}</p>}</div>
			</div>}
			{source && <details><summary>Fonte da aula</summary>{/^https:\/\/[^\s]+$/i.test(source) ? <a href={source} target="_blank" rel="noreferrer">{preset?.source ?? source}</a> : <p>{source}</p>}</details>}
			{actions?.askActivity && <form onSubmit={async e => {
				e.preventDefault();
				const sent = await actions.askActivity?.(`${question.trim() || "Como explico este resultado?"}\n\nAtividade «${title}». ${context}`);
				setNotice(sent ? "" : "Sua pergunta ficou aqui. Tente enviá-la quando o chat estiver disponível.");
				if (sent) setQuestion("");
			}}><input aria-label="Pergunta sobre a atividade" placeholder="Pergunte sobre o que observou…" value={question} onChange={e => setQuestion(e.target.value)} />
				<button type="submit">Perguntar</button></form>}
			{notice && <p role="status">{notice}</p>}
		</footer>
	</section>;
}
