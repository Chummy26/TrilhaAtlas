"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Sparkles, Volume2 } from "lucide-react";
import type { ComicPanel } from "@/src/core";
import { ComicPanelArt, inferComicScene } from "./comic-art.tsx";

export function ComicStrip({
	panels,
	selected,
	onSelect,
	language,
}: {
	panels: readonly ComicPanel[];
	selected: number;
	onSelect: (index: number) => void;
	language?: string;
}) {
	const [canSpeak, setCanSpeak] = useState(false);
	useEffect(() => {
		setCanSpeak(typeof window !== "undefined" && "speechSynthesis" in window);
	}, []);

	const speakLine = useCallback((text: string) => {
		if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
		try {
			window.speechSynthesis.cancel();
			const utterance = new SpeechSynthesisUtterance(text);
			if (language) utterance.lang = language;
			utterance.rate = 0.94;
			window.speechSynthesis.speak(utterance);
		} catch {
			// Browser speech synthesis is optional enhancement only.
		}
	}, [language]);

	const activeIndex = Math.min(Math.max(selected, 0), Math.max(panels.length - 1, 0));
	const active = panels[activeIndex];
	if (!active) return null;

	return (
		<div
			className="comic-strip"
			onKeyDown={(e) => {
				if (e.key === "ArrowRight") {
					e.preventDefault();
					onSelect((activeIndex + 1) % panels.length);
				} else if (e.key === "ArrowLeft") {
					e.preventDefault();
					onSelect((activeIndex - 1 + panels.length) % panels.length);
				}
			}}
		>
			<div className="comic-toolbar">
				<span className="comic-badge-pill">
					<Sparkles aria-hidden="true" className="size-3.5" />
					Tirinha ilustrada · Quadrinho {activeIndex + 1} de {panels.length}
				</span>
				<div className="comic-nav-buttons" role="group" aria-label="Navegar pelos quadrinhos">
					<button
						type="button"
						className="comic-nav-btn"
						disabled={activeIndex === 0}
						aria-label="Quadrinho anterior"
						onClick={() => onSelect(Math.max(0, activeIndex - 1))}
					>
						<ChevronLeft aria-hidden="true" className="size-4" />
						<span>Anterior</span>
					</button>
					<button
						type="button"
						className="comic-nav-btn"
						disabled={activeIndex >= panels.length - 1}
						aria-label="Próximo quadrinho"
						onClick={() => onSelect(Math.min(panels.length - 1, activeIndex + 1))}
					>
						<span>Próximo</span>
						<ChevronRight aria-hidden="true" className="size-4" />
					</button>
				</div>
			</div>

			<ol className="comic-grid" aria-label="Quadrinhos da história">
				{panels.map((panel, i) => {
					const isSelected = i === activeIndex;
					const scene = panel.scene ?? inferComicScene(`${panel.speaker} ${panel.speech} ${panel.caption}`);
					const mood = panel.mood ?? "friendly";
					const hasReply = Boolean(panel.reply?.trim());
					return (
						<li key={i} className="comic-cell" data-active={isSelected ? "true" : "false"}>
							<div className="comic-panel-frame">
								<button
									type="button"
									className="comic-panel-trigger"
									aria-pressed={isSelected}
									onClick={() => onSelect(i)}
								>
									<span className="comic-panel-num" aria-hidden="true">{i + 1}</span>
									<div className="comic-bubbles" data-dual={hasReply ? "true" : "false"}>
										<div className="comic-bubble comic-bubble-primary">
											<span className="comic-speaker">{panel.speaker}</span>
											<span className="comic-speech-text" lang={language}>{panel.speech}</span>
										</div>
										{hasReply && (
											<div className="comic-bubble comic-bubble-reply">
												<span className="comic-speaker">{panel.replySpeaker?.trim() || "Você"}</span>
												<span className="comic-speech-text" lang={language}>{panel.reply}</span>
											</div>
										)}
									</div>
									<div className="comic-stage">
										<ComicPanelArt
											scene={scene}
											mood={mood}
											speaker={panel.speaker}
											hasReply={hasReply}
										/>
									</div>
									{panel.cue && (
										<div className="comic-cue-sticker">
											<span>{panel.cue}</span>
										</div>
									)}
									<div className="comic-caption-box">
										<span>{panel.caption}</span>
									</div>
								</button>
								{canSpeak && (
									<button
										type="button"
										className="comic-speak-btn"
										aria-label={`Ouvir fala do quadrinho ${i + 1}`}
										title="Ouvir fala"
										onClick={() => speakLine(hasReply ? `${panel.speech} ${panel.reply}` : panel.speech)}
									>
										<Volume2 aria-hidden="true" className="size-3.5" />
									</button>
								)}
							</div>
						</li>
					);
				})}
			</ol>

			<div className="comic-spotlight" aria-live="polite">
				<div className="comic-spotlight-head">
					<strong>Quadrinho {activeIndex + 1} · {active.speaker}</strong>
					{active.cue && <span className="comic-spotlight-cue">{active.cue}</span>}
				</div>
				<p>{active.caption}</p>
			</div>
		</div>
	);
}
