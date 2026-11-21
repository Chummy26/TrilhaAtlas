"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { captureFile, PdfSheet, type PdfLayout } from "./pdf-sheet.tsx";
import { SessionStarter } from "../start-session.ts";

const Streamdown = dynamic(() => import("streamdown").then((m) => m.Streamdown));

interface BookPage {
	format: "pdf" | "epub";
	title: string;
	heading: string;
	unit: number;
	total: number;
	text: string;
	layout?: PdfLayout;
}

const EPUB_COMPONENTS = {
	img: ({ alt }: { alt?: string }) => (alt ? <span>{alt}</span> : null),
	a: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
};

/** Isolated tutor-interaction panel holding instruction, selection, and capture state
 *  so typing, text selection, or screenshot pasting never re-renders PdfSheet's SVG text layer. */
const ReadingActionsPanel = memo(function ReadingActionsPanel({
	domain,
	node,
	book,
	page,
	label,
	locator,
	original,
	imageFailed,
	cropping,
	onToggleCropping,
	articleRef,
	captureHandlerRef,
	pasteFileRef,
	clearSelectionSignal,
}: {
	domain: string;
	node: string;
	book: string;
	page: BookPage;
	label: string;
	locator: string;
	original: boolean;
	imageFailed: boolean;
	cropping: boolean;
	onToggleCropping: () => void;
	articleRef: RefObject<HTMLDivElement | null>;
	captureHandlerRef: RefObject<((src: string) => void) | null>;
	pasteFileRef: RefObject<((file: File) => void) | null>;
	clearSelectionSignal: number;
}) {
	const router = useRouter();
	const starter = useRef<SessionStarter | null>(null);
	const [selection, setSelection] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const [instruction, setInstruction] = useState("");
	const [capture, setCapture] = useState("");

	const acceptCapture = useCallback((src: string) => {
		setCapture(src);
		setSelection("");
		setError("");
	}, []);

	const attach = useCallback(async (file: File) => {
		if (pending) return;
		try { acceptCapture(await captureFile(file)); }
		catch (e) { setError(e instanceof Error ? e.message : "Não foi possível ler o print."); }
	}, [acceptCapture, pending]);

	useEffect(() => {
		captureHandlerRef.current = acceptCapture;
		pasteFileRef.current = (file: File) => { void attach(file); };
		return () => {
			if (captureHandlerRef.current === acceptCapture) captureHandlerRef.current = null;
			pasteFileRef.current = null;
		};
	}, [acceptCapture, attach, captureHandlerRef, pasteFileRef]);

	useEffect(() => {
		if (clearSelectionSignal > 0) setSelection("");
	}, [clearSelectionSignal]);

	useEffect(() => {
		function readSelection() {
			const range = window.getSelection();
			if (range && articleRef.current?.contains(range.anchorNode) && articleRef.current.contains(range.focusNode))
				setSelection(range.toString().trim());
		}
		readSelection();
		document.addEventListener("selectionchange", readSelection);
		return () => document.removeEventListener("selectionchange", readSelection);
	}, [articleRef]);

	async function interact(focus: "trecho" | "print" | "página") {
		if (pending) return;
		setPending(true);
		setError("");
		const source = focus === "trecho" ? selection : focus === "print" ? "" : page.text;
		const title = page.title + " · " + locator;
		const chosen = focus === "trecho" ? "o trecho selecionado" : focus === "print" ? "o print selecionado" : "esta " + label.toLowerCase();
		const opening = [
			"Crie uma atividade interativa sobre " + chosen + " de «" + page.title + "», " + locator.toLowerCase() + ".",
			instruction.trim(),
			"Apresente a aula agora com a ferramenta study_activity. Baseie os controles e exemplos no conteúdo escolhido e cite a localização. Consulte read_book_page quando precisar verificar o livro.",
			page.heading, source,
		].filter(Boolean).join("\n\n");
		try {
			starter.current ??= new SessionStarter();
			const destination = await starter.current.start({
				title, studyLesson: { domainId: domain, minutes: 10, exploratory: true },
				graphContext: { propositions: [{ id: node, name: title, statement: "Leitura de " + title }] },
				readingSource: { book, unit: page.unit, original: focus !== "print" && page.format === "pdf", ...(focus === "print" && { screenshot: capture }) },
			}, fetch, undefined, opening);
			router.push(destination);
		} catch {
			setError("Não foi possível abrir a atividade. Sua leitura continua aqui. Tente novamente.");
			setPending(false);
		}
	}

	return (
		<aside id="estudar-leitura" className="cel-card reader-actions" aria-label="Atividade de leitura">
			<h2 className="cel-display">Estudar com o tutor</h2>
			<label htmlFor="reading-request" className="text-sm font-semibold">O que você quer entender?</label>
			<textarea id="reading-request" className="cel-input text-sm" rows={3} value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="Explique este gráfico com um exemplo…" />
			<p>Selecione texto, cole um print ou peça uma aula sobre a {label.toLowerCase()} inteira.</p>
			{original && <button type="button" className="cel-button text-sm" aria-pressed={cropping} disabled={pending || imageFailed} onClick={onToggleCropping}>{cropping ? "Cancelar recorte" : "Recortar área da página"}</button>}
			{cropping && <p role="status">Arraste sobre a página para selecionar a área do print.</p>}
			<label className="reader-attachment">Anexar print<input type="file" accept="image/png,image/jpeg,image/webp" disabled={pending} onChange={e => {
				const file = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (file) void attach(file);
			}} /></label>
			{capture && <div className="reader-capture">
				{/* eslint-disable-next-line @next/next/no-img-element */}
				<img src={capture} alt="Print escolhido para a aula" />
				<button type="button" onClick={() => setCapture("")}>Remover print</button>
			</div>}
			{selection && <blockquote>{selection}</blockquote>}
			{capture && <button className="cel-button cel-button-primary text-sm" disabled={pending} onClick={() => void interact("print")}>Criar aula com print</button>}
			{selection && <button className="reader-selection-action cel-button cel-button-primary text-sm" disabled={pending} onClick={() => void interact("trecho")}>Criar aula com trecho</button>}
			<button className={"cel-button text-sm" + (selection || capture ? "" : " cel-button-primary")} disabled={pending || (original && imageFailed) || (!original && !page.text)} onClick={() => void interact("página")}>Criar aula com {label.toLowerCase()} {page.unit}</button>
			{pending && <p role="status">Abrindo atividade…</p>}
			{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
		</aside>
	);
});

export function BookReader({ domain, region, node, book, page }: {
	domain: string; region: string; node: string; book: string; page: BookPage;
}) {
	const router = useRouter();
	const article = useRef<HTMLDivElement>(null);
	const captureHandlerRef = useRef<((src: string) => void) | null>(null);
	const pasteFileRef = useRef<((file: File) => void) | null>(null);
	const [original, setOriginal] = useState(page.format === "pdf");
	const [imageFailed, setImageFailed] = useState(false);
	const [cropping, setCropping] = useState(false);
	const [clearSelectionSignal, setClearSelectionSignal] = useState(0);

	const handleCapture = useCallback((src: string) => {
		setCropping(false);
		captureHandlerRef.current?.(src);
	}, []);
	const handleImageError = useCallback(() => setImageFailed(true), []);
	const toggleCropping = useCallback(() => setCropping((v) => !v), []);

	const label = page.format === "pdf" ? "Página" : "Seção";
	const locator = label + " " + page.unit;
	const openingHeading = useMemo(
		() => (page.format === "epub" ? page.text.match(/^#{1,6}\s+([^\n]+)/)?.[1]?.trim() : undefined),
		[page.format, page.text],
	);
	const queryString = useMemo(
		() => new URLSearchParams({ domain, region, node }).toString(),
		[domain, region, node],
	);
	const href = (unit: number) => "/ler/" + book + "?" + queryString + "&unit=" + unit;
	const imageUrl = "/api/study/reading?" + queryString + "&book=" + book + "&unit=" + page.unit + "&image=1";

	// Idle-prefetch the next PDF page image so turning pages feels instantaneous.
	useEffect(() => {
		if (!original || page.format !== "pdf" || page.unit >= page.total) return;
		const nextUrl = "/api/study/reading?" + queryString + "&book=" + book + "&unit=" + (page.unit + 1) + "&image=1";
		const prefetch = () => {
			const img = new Image();
			img.src = nextUrl;
		};
		if (typeof window.requestIdleCallback === "function") {
			const id = window.requestIdleCallback(prefetch);
			return () => window.cancelIdleCallback(id);
		}
		const timer = setTimeout(prefetch, 200);
		return () => clearTimeout(timer);
	}, [original, page.format, page.unit, page.total, queryString, book]);

	return <main className="book-reader" onPaste={e => {
		const file = Array.from(e.clipboardData.items).find(item => item.kind === "file" && item.type.startsWith("image/"))?.getAsFile();
		if (file && pasteFileRef.current) { e.preventDefault(); pasteFileRef.current(file); }
	}}>
		<Link className="reader-back" href={"/mapa?" + new URLSearchParams({ dominio: domain, no: node })}>← Voltar ao mapa</Link>
		<header>
			<p className="reader-meta">{page.format.toUpperCase()} · {locator} de {page.total}</p>
			<h1>{page.title}</h1>
			{page.heading && page.heading !== openingHeading && <p>{page.heading}</p>}
		</header>
		<nav aria-label="Navegação do livro" className="reader-nav">
			{page.unit > 1 && <Link className="cel-button" href={href(page.unit - 1)}>← Anterior</Link>}
			<form onSubmit={event => {
				event.preventDefault();
				const unit = Number(new FormData(event.currentTarget).get("unit"));
				if (Number.isSafeInteger(unit) && unit > 0 && unit <= page.total) router.push(href(unit));
			}}>
				<label>{label} <input type="number" name="unit" min={1} max={page.total} required defaultValue={page.unit} /></label>
				<button className="cel-button" type="submit">Ir</button>
			</form>
			{page.unit < page.total && <Link className="cel-button" href={href(page.unit + 1)}>Próxima →</Link>}
			<a className="reader-study-jump" href="#estudar-leitura">Estudar {label.toLowerCase()}</a>
			{page.format === "pdf" && page.text && <button className="reader-mode" type="button" aria-pressed={original} onClick={() => {
				setOriginal(!original); setCropping(false); setClearSelectionSignal((n) => n + 1); setImageFailed(false);
			}}>{original ? "Exibir texto selecionável" : "Ver página original"}</button>}
		</nav>
		<div className="reader-layout">
			<article aria-label={locator} className="reader-paper">
				{original ? <div ref={article}>
					<PdfSheet src={imageUrl} label={locator + " de " + page.title} layout={page.layout} cropping={cropping} onCapture={handleCapture} onError={handleImageError} />
					{imageFailed && <p role="alert">Não foi possível exibir a página original.</p>}
				</div> : <div className="reader-text lh-prose" ref={article} tabIndex={0}>
					{page.format === "epub" ? <Streamdown mode="static" controls={false} components={EPUB_COMPONENTS}>{page.text}</Streamdown> : page.text}
				</div>}
			</article>
			<ReadingActionsPanel
				domain={domain}
				node={node}
				book={book}
				page={page}
				label={label}
				locator={locator}
				original={original}
				imageFailed={imageFailed}
				cropping={cropping}
				onToggleCropping={toggleCropping}
				articleRef={article}
				captureHandlerRef={captureHandlerRef}
				pasteFileRef={pasteFileRef}
				clearSelectionSignal={clearSelectionSignal}
			/>
		</div>
	</main>;
}
