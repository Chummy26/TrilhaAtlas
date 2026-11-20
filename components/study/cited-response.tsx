"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MessageResponse, streamdownRehypePlugins } from "@/components/ai-elements/message";
import { linkPdfCitations } from "./citation-markup.ts";
import type { PdfCitationBook } from "@/src/core";

type Shelf = { domain: string; books: PdfCitationBook[] };
const CitationContext = createContext<Shelf | null>(null);

export function CitationShelf({ domain, books, children }: Shelf & { children: ReactNode }) {
	return <CitationContext.Provider value={{ domain, books }}>{children}</CitationContext.Provider>;
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
		<header><div><small>Página física {page} de {source.pages}</small><h2>{source.title}</h2></div>
			<button type="button" className="cel-button px-3 py-1" autoFocus onClick={onClose}>Fechar</button></header>
		{failed ? <p role="alert">Não foi possível exibir a página original.</p> :
			/* eslint-disable-next-line @next/next/no-img-element -- The authenticated local PNG must render directly without an optimizer cache. */
			<img src={url + "&image=1"} alt={source.title + ", página física " + page} onError={() => setFailed(true)} />}
		{text && <details open={failed || undefined}><summary>Texto da página</summary><p className="whitespace-pre-wrap">{text}</p></details>}
	</dialog>;
}

export function CitedResponse({ text }: { text: string }) {
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
		<MessageResponse className="tutor-prose" rehypePlugins={plugins}>{text}</MessageResponse>
		{preview && shelf && <PagePreview {...preview} domain={shelf.domain} onClose={() => { setPreview(undefined); requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true })); }} />}
	</div>;
}
