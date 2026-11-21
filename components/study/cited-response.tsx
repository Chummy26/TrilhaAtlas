"use client";

import { createContext, memo, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MessageResponse, streamdownRehypePlugins } from "@/components/ai-elements/message";
import { linkPdfCitations } from "./citation-markup.ts";
import type { PdfCitationBook } from "@/src/core";

type Shelf = { domain: string; books: PdfCitationBook[] };
const CitationContext = createContext<Shelf | null>(null);

export function CitationShelf({ domain, books, children }: Shelf & { children: ReactNode }) {
	const value = useMemo(() => ({ domain, books }), [domain, books]);
	return <CitationContext.Provider value={value}>{children}</CitationContext.Provider>;
}

function PagePreview({ domain, source, page, onClose }: { domain: string; source: PdfCitationBook; page: number; onClose: () => void }) {
	const dialog = useRef<HTMLDialogElement>(null);
	const [failed, setFailed] = useState(false);
	const [text, setText] = useState("");
	const url = "/api/study/reading?" + new URLSearchParams({ domain, region: source.region, book: source.book, unit: String(page) });
	useEffect(() => {
		const el = dialog.current!;
		el.showModal();
		const controller = new AbortController();
		void fetch(url, { signal: controller.signal }).then(async r => {
			if (r.ok) setText((await r.json()).text);
		}).catch(() => {});
		return () => { controller.abort(); el.close(); };
	}, [url]);
	return <dialog className="pdf-citation-panel" ref={dialog} aria-label={source.title + " · página " + page}
		onCancel={onClose} onClick={e => { if (e.target === dialog.current && e.clientX < e.currentTarget.getBoundingClientRect().left) onClose(); }}>
		<header>
			<div>
				<small className="text-xs font-semibold uppercase tracking-wider text-muted-foreground tabular-nums">Página física {page} de {source.pages}</small>
				<h2 className="cel-display mt-0.5">{source.title}</h2>
			</div>
			<button type="button" className="cel-button min-h-8 px-3 py-1 text-xs" autoFocus onClick={onClose}>Fechar</button>
		</header>
		{failed ? <p role="alert" className="text-sm text-destructive">Não foi possível exibir a página original.</p> :
			/* eslint-disable-next-line @next/next/no-img-element -- The authenticated local PNG must render directly without an optimizer cache. */
			<img src={url + "&image=1"} alt={source.title + ", página física " + page} onError={() => setFailed(true)} />}
		{text && <details className="study-disclosure mt-4 text-sm" open={failed || undefined}>
			<summary>Texto da página</summary>
			<div className="study-disclosure-body"><p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{text}</p></div>
		</details>}
	</dialog>;
}

export const CitedResponse = memo(function CitedResponse({ text, streaming = false }: { text: string; streaming?: boolean }) {
	const shelf = useContext(CitationContext);
	const trigger = useRef<HTMLButtonElement | null>(null);
	const [preview, setPreview] = useState<{ source: PdfCitationBook; page: number }>();
	const plugins = useMemo(() => shelf?.books.length ? [...streamdownRehypePlugins, () => linkPdfCitations(shelf.books)] : streamdownRehypePlugins, [shelf]);
	return <div onClick={e => {
		const target = e.target instanceof Element && e.target.closest<HTMLButtonElement>("button[data-pdf-book]");
		if (!target || !shelf) return;
		const source = shelf.books.find(b => b.book === target.dataset.pdfBook);
		const page = Number(target.dataset.pdfPage);
		if (source && Number.isSafeInteger(page) && page >= 1 && page <= source.pages) {
			trigger.current = target;
			setPreview({ source, page });
		}
	}}>
		<MessageResponse className="tutor-prose" rehypePlugins={plugins} streaming={streaming}>{text}</MessageResponse>
		{preview && shelf && <PagePreview {...preview} domain={shelf.domain} onClose={() => { setPreview(undefined); requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true })); }} />}
	</div>;
});
