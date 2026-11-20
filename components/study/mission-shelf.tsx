"use client";

import Link from "next/link";
import type { LessonResource } from "@/src/core";

export function MissionShelf({ aids, mapHref }: { aids: LessonResource[]; mapHref: string }) {
	return <details className="mission-shelf lh-no-drag absolute right-4 top-14 z-20 text-sm" onKeyDown={event => {
		// Keep native disclosure/link activation when the chat's quiz is also waiting for Enter.
		if (event.key === "Enter" || event.key === " ") event.stopPropagation();
	}}>
		<summary className="cel-button ml-auto w-fit cursor-pointer px-3 py-1 text-xs">Materiais da aula</summary>
		<div className="mt-1 space-y-3 rounded-lg border bg-card p-3 shadow-lg">
			{aids.map(m => <a key={m.kind} href={m.url} target="_blank" rel="noreferrer" className="block underline">
				<strong>{m.kind === "book" ? "Leitura" : "Vídeo"} · {m.title}</strong>
				<span className="block text-xs">{m.suggested && "Sugestão · "}{m.part}</span></a>)}
			<Link className="block text-xs underline" href={mapHref}>Abrir região no mapa</Link>
		</div>
	</details>;
}
