"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { captureFile, PdfSheet, type PdfLayout } from "./pdf-sheet.tsx";
import { SessionStarter } from "../start-session.ts";

interface BookPage {
	format: "pdf" | "epub";
	title: string;
	heading: string;
	unit: number;
	total: number;
	text: string;
	layout?: PdfLayout;
}

export function BookReader({ domain, region, node, book, page }: {
	domain: string; region: string; node: string; book: string; page: BookPage;
}) {
	const router = useRouter();
	const article = useRef<HTMLDivElement>(null);
	const starter = useRef(new SessionStarter());
	const [selection, setSelection] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const [original, setOriginal] = useState(page.format === "pdf");
	const [imageFailed, setImageFailed] = useState(false);
	const [instruction, setInstruction] = useState("");
	const [capture, setCapture] = useState("");
	const [cropping, setCropping] = useState(false);
	function acceptCapture(src: string) { setCapture(src); setCropping(false); setSelection(""); setError(""); }
	async function attach(file: File) {
		try { acceptCapture(await captureFile(file)); }
		catch (e) { setError(e instanceof Error ? e.message : "Não foi possível ler o print."); }
	}
	const label = page.format === "pdf" ? "Página" : "Seção";
	const locator = label + " " + page.unit;
	const openingHeading = page.format === "epub" ? page.text.match(/^#{1,6}\s+([^\n]+)/)?.[1]?.trim() : undefined;
	const query = new URLSearchParams({ domain, region, node });
	const href = (unit: number) => "/ler/" + book + "?" + query + "&unit=" + unit;
	const imageUrl = "/api/study/reading?" + query + "&book=" + book + "&unit=" + page.unit + "&image=1";

	useEffect(() => {
		function capture() {
			const range = window.getSelection();
			if (range && article.current?.contains(range.anchorNode) && article.current.contains(range.focusNode))
				setSelection(range.toString().trim());
		}
		capture();
		document.addEventListener("selectionchange", capture);
		return () => document.removeEventListener("selectionchange", capture);
	}, []);

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
	return <main className="book-reader" onPaste={e => {
		const file = Array.from(e.clipboardData.items).find(item => item.kind === "file" && item.type.startsWith("image/"))?.getAsFile();
		if (file && !pending) { e.preventDefault(); void attach(file); }
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
				setOriginal(!original); setCropping(false); setSelection(""); setImageFailed(false);
			}}>{original ? "Exibir texto selecionável" : "Ver página original"}</button>}
		</nav>
		<div className="reader-layout">
			<article aria-label={locator} className="reader-paper">
				{original ? <div ref={article}>
					<PdfSheet src={imageUrl} label={locator + " de " + page.title} layout={page.layout} cropping={cropping} onCapture={acceptCapture} onError={() => setImageFailed(true)} />
					{imageFailed && <p role="alert">Não foi possível exibir a página original.</p>}
				</div> : <div className="reader-text lh-prose" ref={article} tabIndex={0}>
					{page.format === "epub" ? <Streamdown mode="static" controls={false} components={{
						img: ({ alt }) => alt ? <span>{alt}</span> : null,
						a: ({ children }) => <span>{children}</span>,
					}}>{page.text}</Streamdown> : page.text}
				</div>}
			</article>
			<aside id="estudar-leitura" className="reader-actions" aria-label="Atividade de leitura">
				<h2>Estudar com o tutor</h2>
				<label htmlFor="reading-request">O que você quer entender?</label>
				<textarea id="reading-request" rows={3} value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="Explique este gráfico com um exemplo…" />
				<p>Selecione texto, cole um print ou peça uma aula sobre a {label.toLowerCase()} inteira.</p>
				{original && <button type="button" className="cel-button" aria-pressed={cropping} disabled={pending || imageFailed} onClick={() => setCropping(!cropping)}>{cropping ? "Cancelar recorte" : "Recortar área da página"}</button>}
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
				{capture && <button className="cel-button cel-button-primary" disabled={pending} onClick={() => void interact("print")}>Criar aula com print</button>}
				{selection && <button className="reader-selection-action cel-button cel-button-primary" disabled={pending} onClick={() => void interact("trecho")}>Criar aula com trecho</button>}
				<button className={"cel-button" + (selection || capture ? "" : " cel-button-primary")} disabled={pending || (original && imageFailed) || (!original && !page.text)} onClick={() => void interact("página")}>Criar aula com {label.toLowerCase()} {page.unit}</button>
				{pending && <p role="status">Abrindo atividade…</p>}
				{error && <p role="alert">{error}</p>}
			</aside>
		</div>
	</main>;
}
