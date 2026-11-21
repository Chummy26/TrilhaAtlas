"use client";

import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type PointerEvent as ReactPointerEvent,
} from "react";
import dynamic from "next/dynamic";
import { Icon } from "@/components/icons/icon";
import { cn } from "@/lib/utils";
import {
	STUDY_BROWSER_NEWTAB_URL,
	buildSearchQueryUrl,
	classifyStudyBrowserTarget,
	normalizeBrowserAddressInput,
	studyBrowserProxyUrl,
	type StudyBrowserReaderPayload,
	type StudyBrowserSearchEngine,
	type StudyBrowserViewMode,
} from "@/src/core";
import {
	activeEntryOf,
	formatDisplayHost,
	type BrowserHistoryEntry,
	type BrowserTab,
} from "./embedded-browser";

// Lazy-load Streamdown/Shiki/KaTeX markdown only when the learner activates reader mode.
const MessageResponse = dynamic(() =>
	import("@/components/ai-elements/message").then((m) => m.MessageResponse),
);

const WIDTH_STORAGE_KEY = "lh:study-browser-width";
const DEFAULT_WIDTH = 540;
const WIDE_WIDTH = 780;
const MIN_WIDTH = 360;
const MAX_WIDTH = 980;

const QUICK_STUDY_SITES: readonly { title: string; subtitle: string; url: string; icon: "video" | "book" | "resistor" | "domain-generic" }[] = [
	{
		title: "YouTube Educação",
		subtitle: "Aulas e tutoriais em vídeo",
		url: "https://www.youtube.com/results?search_query=aula+tutorial",
		icon: "video",
	},
	{
		title: "OpenStax",
		subtitle: "Livros universitários abertos",
		url: "https://openstax.org/subjects",
		icon: "book",
	},
	{
		title: "Wikipedia",
		subtitle: "Enciclopédia livre",
		url: "https://pt.wikipedia.org/wiki/Wikip%C3%A9dia:P%C3%A1gina_principal",
		icon: "book",
	},
	{
		title: "Wikibooks",
		subtitle: "Manuais e livros didáticos",
		url: "https://pt.wikibooks.org/wiki/Wikilivros:P%C3%A1gina_principal",
		icon: "book",
	},
	{
		title: "VOA Learning English",
		subtitle: "Diálogos, áudio e leitura em inglês",
		url: "https://learningenglish.voanews.com",
		icon: "domain-generic",
	},
	{
		title: "British Council",
		subtitle: "Gramática, escuta e escrita",
		url: "https://learnenglish.britishcouncil.org",
		icon: "domain-generic",
	},
	{
		title: "Open Library",
		subtitle: "Catálogo aberto de livros",
		url: "https://openlibrary.org",
		icon: "book",
	},
	{
		title: "Falstad CircuitJS",
		subtitle: "Simulador interativo de circuitos",
		url: "https://www.falstad.com/circuit/circuitjs.html",
		icon: "resistor",
	},
];

function clampWidth(width: number): number {
	if (!Number.isFinite(width)) return DEFAULT_WIDTH;
	const viewportCap = typeof window !== "undefined" ? Math.max(MIN_WIDTH, Math.floor(window.innerWidth * 0.68)) : MAX_WIDTH;
	return Math.min(Math.min(MAX_WIDTH, viewportCap), Math.max(MIN_WIDTH, Math.round(width)));
}

function tabIconFor(url: string): "plus" | "video" | "book" | "resistor" | "domain-generic" {
	const t = classifyStudyBrowserTarget(url);
	if (t.kind === "new-tab") return "plus";
	if (t.kind === "youtube-video" || t.kind === "youtube-search") return "video";
	if (t.kind === "pdf") return "book";
	if (t.kind === "direct-embed") return "resistor";
	return "domain-generic";
}

function tabLabelFor(entry: BrowserHistoryEntry): string {
	if (entry.url === STUDY_BROWSER_NEWTAB_URL) return "Nova aba";
	return entry.title?.trim() || formatDisplayHost(entry.url);
}

export interface EmbeddedBrowserSidebarProps {
	tabs: BrowserTab[];
	activeTab: BrowserTab;
	entry: BrowserHistoryEntry;
	recent: { url: string; title: string }[];
	canGoBack: boolean;
	canGoForward: boolean;
	onBack: () => void;
	onForward: () => void;
	onNavigate: (url: string, title?: string, preferredMode?: StudyBrowserViewMode) => void;
	onNewTab: (url?: string, title?: string) => void;
	onSelectTab: (tabId: string) => void;
	onCloseTab: (tabId: string) => void;
	onUpdateTabTitle: (tabId: string, title: string) => void;
	onClose: () => void;
}

export function EmbeddedBrowserSidebar({
	tabs,
	activeTab,
	entry,
	recent,
	canGoBack,
	canGoForward,
	onBack,
	onForward,
	onNavigate,
	onNewTab,
	onSelectTab,
	onCloseTab,
	onUpdateTabTitle,
	onClose,
}: EmbeddedBrowserSidebarProps) {
	const target = useMemo(() => classifyStudyBrowserTarget(entry.url), [entry.url]);
	const [viewMode, setViewMode] = useState<StudyBrowserViewMode>(entry.mode ?? "site");
	const [addressInput, setAddressInput] = useState(entry.url === STUDY_BROWSER_NEWTAB_URL ? "" : entry.url);
	const [searchEngine, setSearchEngine] = useState<StudyBrowserSearchEngine>("duckduckgo");
	const [newTabQuery, setNewTabQuery] = useState("");
	const [frameLoading, setFrameLoading] = useState(target.kind !== "new-tab" && target.kind !== "youtube-search");
	const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
	const [reloadTick, setReloadTick] = useState(0);
	const [copied, setCopied] = useState(false);
	const [readerData, setReaderData] = useState<StudyBrowserReaderPayload | null>(null);
	const [readerLoading, setReaderLoading] = useState(false);
	const [readerError, setReaderError] = useState("");
	const [mediaDrawerOpen, setMediaDrawerOpen] = useState(false);
	const [width, setWidth] = useState(DEFAULT_WIDTH);
	const [resizing, setResizing] = useState(false);
	const resizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);

	useEffect(() => {
		try {
			const saved = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
			if (Number.isFinite(saved) && saved >= MIN_WIDTH) {
				setWidth(clampWidth(saved));
			}
		} catch {
			// Ignore storage restrictions.
		}
	}, []);

	useEffect(() => {
		setAddressInput(entry.url === STUDY_BROWSER_NEWTAB_URL ? "" : entry.url);
		setFrameLoading(target.kind !== "new-tab" && target.kind !== "youtube-search");
		if (entry.mode) setViewMode(entry.mode);
		else if (target.kind === "youtube-search") setViewMode("reader");
		else setViewMode("site");
	}, [entry.url, entry.mode, target.kind]);

	// For direct PDF links, fetch as an inline PDF blob so servers with Content-Disposition: attachment still render inside the panel
	useEffect(() => {
		if (target.kind !== "pdf") {
			setPdfBlobUrl(null);
			return;
		}
		const ctrl = new AbortController();
		let objectUrl: string | null = null;
		setFrameLoading(true);
		setPdfBlobUrl(null);

		void fetch(studyBrowserProxyUrl(target.url, "frame"), { signal: ctrl.signal })
			.then(async (res) => {
				if (!res.ok) throw new Error();
				const blob = await res.blob();
				if (ctrl.signal.aborted) return;
				objectUrl = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
				setPdfBlobUrl(`${objectUrl}${target.hash}`);
				setFrameLoading(false);
			})
			.catch(() => {
				if (ctrl.signal.aborted) return;
				// Fall back to direct URL if proxy fails
				setPdfBlobUrl(target.url);
				setFrameLoading(false);
			});

		return () => {
			ctrl.abort();
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	}, [target, reloadTick]);

	// Fetch reader metadata + playable audio/video in the background for real URLs
	useEffect(() => {
		if (target.kind === "new-tab") {
			setReaderData(null);
			setReaderError("");
			setReaderLoading(false);
			setMediaDrawerOpen(false);
			return;
		}

		const ctrl = new AbortController();
		setReaderData(null);
		setReaderError("");
		setReaderLoading(true);
		setMediaDrawerOpen(false);

		const endpoint = studyBrowserProxyUrl(entry.url, "reader");
		void fetch(endpoint, { signal: ctrl.signal })
			.then(async (res) => {
				const json = (await res.json()) as StudyBrowserReaderPayload & { error?: string };
				if (!res.ok) throw new Error(json.error || "Não foi possível extrair o modo leitura.");
				if (ctrl.signal.aborted) return;
				setReaderData(json);
				if (json.title && !entry.title) {
					onUpdateTabTitle(activeTab.id, json.title);
				}
				if (json.media && json.media.length > 0) setMediaDrawerOpen(true);
			})
			.catch((err: unknown) => {
				if (ctrl.signal.aborted) return;
				setReaderError(err instanceof Error ? err.message : "Modo leitura indisponível para esta página.");
			})
			.finally(() => {
				if (!ctrl.signal.aborted) setReaderLoading(false);
			});

		return () => ctrl.abort();
	}, [entry.url, entry.title, activeTab.id, target.kind, reloadTick, onUpdateTabTitle]);

	function handleResizePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
		if (e.button !== 0) return;
		e.preventDefault();
		e.currentTarget.setPointerCapture(e.pointerId);
		resizeStartRef.current = { startX: e.clientX, startWidth: width };
		setResizing(true);
	}

	function handleResizePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
		if (!resizeStartRef.current) return;
		const delta = resizeStartRef.current.startX - e.clientX;
		const next = clampWidth(resizeStartRef.current.startWidth + delta);
		setWidth(next);
	}

	function handleResizePointerUp() {
		if (!resizeStartRef.current) return;
		resizeStartRef.current = null;
		setResizing(false);
		try {
			localStorage.setItem(WIDTH_STORAGE_KEY, String(width));
		} catch {
			// Ignore storage errors.
		}
	}

	function toggleWide() {
		const next = width < WIDE_WIDTH - 40 ? clampWidth(WIDE_WIDTH) : DEFAULT_WIDTH;
		setWidth(next);
		try {
			localStorage.setItem(WIDTH_STORAGE_KEY, String(next));
		} catch {
			// Ignore storage errors.
		}
	}

	async function copyCurrentUrl() {
		if (entry.url === STUDY_BROWSER_NEWTAB_URL) return;
		try {
			await navigator.clipboard.writeText(entry.url);
			setCopied(true);
			setTimeout(() => setCopied(false), 1600);
		} catch {
			// Ignore clipboard failures.
		}
	}

	const hostLabel = formatDisplayHost(entry.url);
	const displayTitle =
		entry.url === STUDY_BROWSER_NEWTAB_URL
			? "Nova aba de estudo"
			: entry.title || readerData?.title || hostLabel;
	const hasToggleableReader = target.kind === "web-page" || target.kind === "pdf";
	const audioItems = readerData?.media.filter((m) => m.kind === "audio") ?? [];
	const videoItems = readerData?.media.filter((m) => m.kind === "video") ?? [];

	return (
		<aside
			aria-label="Navegador de estudo embutido"
			data-testid="study-embedded-browser"
			style={{ width: `${width}px` }}
			className={cn(
				"study-browser-sidebar relative z-30 flex h-full shrink-0 flex-col border-l border-border bg-card text-foreground shadow-2xl",
				"max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:w-[min(100vw,36rem)]!",
			)}
		>
			{/* Drag handle on the left edge for smooth resizing */}
			<div
				role="separator"
				aria-orientation="vertical"
				aria-label="Redimensionar barra lateral do navegador"
				onPointerDown={handleResizePointerDown}
				onPointerMove={handleResizePointerMove}
				onPointerUp={handleResizePointerUp}
				onPointerCancel={handleResizePointerUp}
				className="group absolute inset-y-0 -left-1.5 z-40 w-3 cursor-col-resize select-none max-lg:hidden"
			>
				<div className="mx-auto h-full w-0.5 bg-transparent transition-colors group-hover:bg-[var(--cel-accent,var(--primary))] group-active:bg-[var(--cel-accent,var(--primary))]" />
			</div>

			{/* Top header: Tab strip + Navigation controls + Sub-bar */}
			<header className="lh-no-drag flex flex-col gap-1.5 border-b border-border/80 bg-background/95 px-2.5 py-2">
				{/* Row 1: Browser Tab Strip + "+ Nova aba" + Close Panel (clears Windows native caption buttons via lh-wco-gutter) */}
				<div className="lh-wco-gutter flex min-h-8 items-center gap-1.5">
					<div
						role="tablist"
						aria-label="Abas do navegador de estudo"
						className="lh-plugin-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-0.5"
					>
						{tabs.map((tab) => {
							const tabEntry = activeEntryOf(tab);
							const isSelected = tab.id === activeTab.id;
							const label = tabLabelFor(tabEntry);
							return (
								<div
									key={tab.id}
									role="tab"
									aria-selected={isSelected}
									onMouseDown={(e) => {
										if (e.button === 1) {
											e.preventDefault();
											onCloseTab(tab.id);
										}
									}}
									className={cn(
										"group/tab inline-flex max-w-44 min-w-24 shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-colors",
										isSelected
											? "border-[var(--cel-accent,var(--foreground))] bg-[color-mix(in_srgb,var(--cel-accent,var(--primary))_14%,var(--card))] font-semibold text-foreground shadow-2xs"
											: "border-border/60 bg-card/70 text-muted-foreground hover:border-border hover:bg-accent/60 hover:text-foreground",
									)}
								>
									<button
										type="button"
										onClick={() => onSelectTab(tab.id)}
										className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
										title={label}
									>
										<Icon name={tabIconFor(tabEntry.url)} size={13} tone={false} className="shrink-0" />
										<span className="truncate">{label}</span>
									</button>
									<button
										type="button"
										aria-label={`Fechar aba ${label}`}
										onClick={(e) => {
											e.stopPropagation();
											onCloseTab(tab.id);
										}}
										className="rounded p-0.5 text-muted-foreground/80 hover:bg-background/80 hover:text-foreground"
										title="Fechar aba"
									>
										<Icon name="close" size={11} tone={false} />
									</button>
								</div>
							);
						})}

						<button
							type="button"
							data-testid="study-browser-new-tab"
							aria-label="Nova aba"
							onClick={() => onNewTab()}
							className="cel-button study-browser-icon-btn"
							title="Nova aba"
						>
							<Icon name="plus" size={15} tone={false} />
						</button>
					</div>

					<button
						type="button"
						aria-label="Fechar navegador embutido"
						onClick={onClose}
						className="cel-button study-browser-icon-btn"
						title="Fechar barra lateral"
					>
						<Icon name="close" size={16} tone={false} />
					</button>
				</div>

				{/* Row 2: Full-width Navigation Controls (Back, Forward, Reload, URL Address Bar, Copy, Width, External) */}
				<div className="flex items-center gap-1.5">
					<button
						type="button"
						aria-label="Voltar página"
						disabled={!canGoBack}
						onClick={onBack}
						className="cel-button study-browser-icon-btn"
						title="Voltar"
					>
						<Icon name="chevron-left" size={16} tone={false} />
					</button>
					<button
						type="button"
						aria-label="Avançar página"
						disabled={!canGoForward}
						onClick={onForward}
						className="cel-button study-browser-icon-btn"
						title="Avançar"
					>
						<Icon name="chevron-right" size={16} tone={false} />
					</button>
					<button
						type="button"
						aria-label="Recarregar página"
						disabled={target.kind === "new-tab"}
						onClick={() => {
							setFrameLoading(true);
							setReloadTick((t) => t + 1);
						}}
						className="cel-button study-browser-icon-btn"
						title="Recarregar"
					>
						<Icon
							name="sync"
							size={16}
							tone={false}
							className={cn((frameLoading || readerLoading) && target.kind !== "new-tab" && "animate-spin")}
						/>
					</button>

					<form
						className="relative flex min-w-28 flex-1 items-center"
						onSubmit={(e) => {
							e.preventDefault();
							const next = normalizeBrowserAddressInput(addressInput, searchEngine);
							if (next) onNavigate(next);
						}}
					>
						<span className="pointer-events-none absolute left-2.5 flex items-center text-muted-foreground">
							<Icon name="domain-generic" size={14} tone={false} />
						</span>
						<input
							type="text"
							aria-label="Endereço do navegador embutido"
							value={addressInput}
							onChange={(e) => setAddressInput(e.target.value)}
							onFocus={(e) => e.currentTarget.select()}
							placeholder="Digite uma URL ou pesquise (ex: openlibrary.org, yt: tema)…"
							className="cel-input h-8 w-full truncate pl-8 pr-2.5 font-mono text-xs"
						/>
					</form>

					<button
						type="button"
						aria-label="Copiar endereço"
						disabled={target.kind === "new-tab"}
						onClick={() => void copyCurrentUrl()}
						className="cel-button study-browser-icon-btn"
						title="Copiar link"
					>
						<Icon name={copied ? "check" : "copy"} size={16} tone={copied ? "mint" : false} />
					</button>

					<button
						type="button"
						aria-label={width >= WIDE_WIDTH - 40 ? "Restaurar largura padrão" : "Expandir largura da barra lateral"}
						onClick={toggleWide}
						className="cel-button study-browser-icon-btn max-lg:hidden"
						title={width >= WIDE_WIDTH - 40 ? "Compactar painel" : "Expandir painel"}
					>
						<Icon name="maximize" size={16} tone={false} />
					</button>

					{target.kind !== "new-tab" && (
						<a
							href={entry.url}
							target="_blank"
							rel="noreferrer"
							data-browser-external="true"
							aria-label="Abrir no navegador externo do sistema"
							title="Abrir no navegador externo"
							className="cel-button study-browser-icon-btn"
						>
							<Icon name="arrow-up-right" size={16} tone={false} />
						</a>
					)}
				</div>

				{/* Row 3: Active Domain Badge, Title, Detected Audio/Video Strip Toggle, and Site / Reader Mode Switch */}
				{target.kind !== "new-tab" && (
					<div className="flex flex-wrap items-center justify-between gap-2 px-0.5 pt-0.5">
						<div className="flex min-w-0 flex-1 items-center gap-2">
							<span className="study-pill shrink-0 font-mono text-[11px]">{hostLabel}</span>
							<span className="truncate text-xs font-semibold text-foreground/90" title={displayTitle}>
								{displayTitle}
							</span>
						</div>

						<div className="flex shrink-0 items-center gap-1.5">
							{(audioItems.length > 0 || videoItems.length > 0) && (
								<button
									type="button"
									aria-pressed={mediaDrawerOpen}
									onClick={() => setMediaDrawerOpen((v) => !v)}
									className={cn(
										"inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
										mediaDrawerOpen
											? "border-[var(--cel-accent,var(--primary))] bg-[color-mix(in_srgb,var(--cel-accent,var(--primary))_18%,var(--card))] text-foreground"
											: "border-border/70 bg-card text-muted-foreground hover:text-foreground",
									)}
								>
									<Icon name="file-audio" size={13} tone={false} />
									Mídia ({audioItems.length + videoItems.length})
								</button>
							)}

							{hasToggleableReader && (
								<div
									role="group"
									aria-label="Modo de exibição"
									className="inline-flex rounded-lg border border-border/80 bg-card p-0.5 text-xs"
								>
									<button
										type="button"
										aria-pressed={viewMode === "site"}
										onClick={() => setViewMode("site")}
										className={cn(
											"inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-semibold transition-colors",
											viewMode === "site"
												? "bg-accent text-foreground shadow-2xs"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										<Icon name="domain-generic" size={13} tone={false} />
										{target.kind === "pdf" ? "PDF" : "Site"}
									</button>
									<button
										type="button"
										aria-pressed={viewMode === "reader"}
										onClick={() => setViewMode("reader")}
										className={cn(
											"inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-semibold transition-colors",
											viewMode === "reader"
												? "bg-accent text-foreground shadow-2xs"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										<Icon name="book" size={13} tone={false} />
										Leitura
									</button>
								</div>
							)}
						</div>
					</div>
				)}

				{/* Quick playable media strip when the lesson page contains MP3/MP4 files (e.g. VOA Learning English) */}
				{target.kind !== "new-tab" && mediaDrawerOpen && (audioItems.length > 0 || videoItems.length > 0) && (
					<div className="space-y-2 rounded-xl border border-border/70 bg-card/90 p-2.5">
						<div className="flex items-center justify-between gap-2">
							<span className="flex items-center gap-1.5 text-xs font-semibold">
								<Icon name="file-audio" size={15} />
								Áudio e vídeo detectados nesta aula
							</span>
							<button
								type="button"
								onClick={() => setMediaDrawerOpen(false)}
								className="text-[11px] text-muted-foreground underline hover:text-foreground"
							>
								Ocultar
							</button>
						</div>
						<div className="max-h-44 space-y-2 overflow-y-auto pr-1">
							{audioItems.slice(0, 3).map((item) => (
								<div key={item.url} className="space-y-1">
									<div className="truncate text-[11px] font-medium text-muted-foreground">{item.label}</div>
									<audio controls preload="none" src={item.url} className="h-8 w-full" />
								</div>
							))}
							{videoItems.slice(0, 2).map((item) => (
								<div key={item.url} className="space-y-1">
									<div className="truncate text-[11px] font-medium text-muted-foreground">{item.label}</div>
									<video controls preload="metadata" src={item.url} className="max-h-40 w-full rounded-lg bg-black" />
								</div>
							))}
						</div>
					</div>
				)}
			</header>

			{/* Main content viewport */}
			<div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
				{/* Prevent iframe from swallowing pointer events while dragging the resize handle */}
				{resizing && <div className="absolute inset-0 z-50 cursor-col-resize" />}

				{target.kind === "new-tab" ? (
					<div className="h-full overflow-y-auto p-5">
						<div className="mx-auto max-w-md space-y-5">
							<div className="space-y-1.5">
								<span className="study-pill study-pill-accent">
									<Icon name="domain-generic" size={13} tone={false} />
									Navegador de Estudo
								</span>
								<h2 className="cel-display text-2xl">Nova aba</h2>
								<p className="text-xs leading-relaxed text-muted-foreground">
									Pesquise conceitos, vídeos, enciclopédias ou abra qualquer endereço web ao lado da sua aula.
								</p>
							</div>

							<form
								className="space-y-2.5 rounded-2xl border border-border/75 bg-card p-3.5 shadow-xs"
								onSubmit={(e) => {
									e.preventDefault();
									const destination = normalizeBrowserAddressInput(newTabQuery, searchEngine);
									if (destination) {
										setNewTabQuery("");
										onNavigate(destination);
									}
								}}
							>
								<div className="flex flex-wrap items-center gap-1.5">
									{(
										[
											["duckduckgo", "DuckDuckGo"],
											["wikipedia", "Wikipedia"],
											["youtube", "YouTube"],
											["google", "Google"],
										] as const
									).map(([engineKey, label]) => (
										<button
											key={engineKey}
											type="button"
											aria-pressed={searchEngine === engineKey}
											onClick={() => setSearchEngine(engineKey)}
											className={cn(
												"rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
												searchEngine === engineKey
													? "border-[var(--cel-accent,var(--foreground))] bg-[color-mix(in_srgb,var(--cel-accent,var(--primary))_18%,var(--card))] text-foreground"
													: "border-border/60 bg-background/60 text-muted-foreground hover:text-foreground",
											)}
										>
											{label}
										</button>
									))}
								</div>
								<div className="flex gap-2">
									<input
										type="search"
										aria-label="Pesquisar ou digitar endereço na nova aba"
										value={newTabQuery}
										onChange={(e) => setNewTabQuery(e.target.value)}
										placeholder="Digite um tema de pesquisa ou URL (ex: openlibrary.org)…"
										className="cel-input h-9 min-w-0 flex-1 px-3 text-sm"
										autoFocus
									/>
									<button type="submit" className="cel-button cel-button-primary min-h-9 px-3.5 text-xs">
										<Icon name="search" size={14} tone={false} />
										Ir
									</button>
								</div>
							</form>

							<section className="space-y-2.5">
								<h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
									Fontes rápidas de estudo
								</h3>
								<div className="grid grid-cols-2 gap-2">
									{QUICK_STUDY_SITES.map((site) => (
										<button
											key={site.url}
											type="button"
											onClick={() => onNavigate(site.url, site.title)}
											className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-card p-2.5 text-left transition-colors hover:border-foreground/40 hover:bg-accent"
										>
											<Icon name={site.icon} size={18} className="mt-0.5 shrink-0" />
											<span className="min-w-0 flex-1">
												<strong className="block truncate text-xs font-semibold">{site.title}</strong>
												<span className="mt-0.5 block line-clamp-1 text-[11px] text-muted-foreground">
													{site.subtitle}
												</span>
											</span>
										</button>
									))}
								</div>
							</section>

							{recent.length > 0 && (
								<section className="space-y-2">
									<h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
										Visitados recentemente
									</h3>
									<div className="space-y-1.5">
										{recent.map((item) => (
											<button
												key={item.url}
												type="button"
												onClick={() => onNavigate(item.url, item.title)}
												className="flex w-full items-center justify-between gap-2 rounded-lg border border-border/50 bg-card/80 px-3 py-2 text-left text-xs transition-colors hover:bg-accent"
											>
												<span className="truncate font-semibold">{item.title}</span>
												<span className="shrink-0 font-mono text-[11px] text-muted-foreground">
													{formatDisplayHost(item.url)}
												</span>
											</button>
										))}
									</div>
								</section>
							)}
						</div>
					</div>
				) : target.kind === "youtube-video" ? (
					<div className="flex h-full flex-col overflow-y-auto">
						<div className="aspect-video w-full shrink-0 bg-black shadow-md">
							<iframe
								key={`${target.embedUrl}-${reloadTick}`}
								src={target.embedUrl}
								title={displayTitle}
								className="size-full border-0"
								allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
								allowFullScreen
								referrerPolicy="strict-origin-when-cross-origin"
								onLoad={() => setFrameLoading(false)}
							/>
						</div>
						<div className="space-y-3 p-4">
							<div className="space-y-1">
								<span className="study-pill study-pill-accent">
									<Icon name="video" size={14} tone={false} />
									Vídeo da aula
								</span>
								<h2 className="cel-display text-lg leading-snug">{displayTitle}</h2>
								{readerData?.description && <p className="text-xs text-muted-foreground">{readerData.description}</p>}
							</div>
							<form
								className="flex gap-2 pt-2"
								onSubmit={(e) => {
									e.preventDefault();
									const q = new FormData(e.currentTarget).get("q");
									if (typeof q === "string" && q.trim()) {
										onNavigate(buildSearchQueryUrl(q.trim(), "youtube"));
									}
								}}
							>
								<input
									type="search"
									name="q"
									placeholder="Buscar outro vídeo no YouTube…"
									className="cel-input h-8 min-w-0 flex-1 px-2.5 text-xs"
								/>
								<button type="submit" className="cel-button min-h-8 px-3 py-1 text-xs">
									<Icon name="search" size={14} tone={false} />
									Buscar
								</button>
							</form>
						</div>
					</div>
				) : target.kind === "youtube-search" ? (
					<div className="h-full overflow-y-auto p-4">
						<div className="mb-3 space-y-1">
							<span className="study-pill study-pill-info">
								<Icon name="video" size={14} tone={false} />
								Resultados do YouTube
							</span>
							<h2 className="cel-display text-lg">“{target.query}”</h2>
						</div>
						{readerLoading && <p className="text-sm text-muted-foreground">Buscando vídeos no YouTube…</p>}
						{readerError && <p className="text-sm text-destructive">{readerError}</p>}
						{!readerLoading && readerData?.youtubeResults && (
							<div className="space-y-2.5">
								{readerData.youtubeResults.map((hit) => (
									<button
										key={hit.videoId}
										type="button"
										onClick={() => onNavigate(hit.url, hit.title)}
										className="flex w-full items-start gap-3 rounded-xl border border-border/60 bg-card p-2.5 text-left transition-colors hover:border-foreground/40 hover:bg-accent"
									>
										<div className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-lg bg-black">
											{/* eslint-disable-next-line @next/next/no-img-element */}
											<img src={hit.thumbnailUrl} alt={hit.title} className="size-full object-cover" />
											{hit.duration && (
												<span className="absolute right-1 bottom-1 rounded bg-black/80 px-1 py-0.5 font-mono text-[10px] font-semibold text-white">
													{hit.duration}
												</span>
											)}
										</div>
										<div className="min-w-0 flex-1 space-y-1">
											<div className="line-clamp-2 text-sm font-semibold leading-snug">{hit.title}</div>
											{hit.channel && <div className="truncate text-xs text-muted-foreground">{hit.channel}</div>}
											<span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--cel-link,var(--lh-accent))]">
												<Icon name="play" size={13} tone={false} />
												Assistir aqui
											</span>
										</div>
									</button>
								))}
								{readerData.youtubeResults.length === 0 && (
									<p className="text-sm text-muted-foreground">Nenhum vídeo encontrado para esta busca.</p>
								)}
							</div>
						)}
					</div>
				) : (
					<>
						{/* Direct Chromium embedded Site / PDF view — loads the real origin with real cookies and TLS fingerprint */}
						<div className={cn("relative flex-1", viewMode !== "site" && "hidden")}>
							{frameLoading && (
								<div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center gap-2 border-b border-border/50 bg-background/90 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-xs">
									<Icon name="sync" size={13} tone={false} className="animate-spin" />
									<span>Carregando {hostLabel}…</span>
								</div>
							)}
							{target.kind === "pdf" ? (
								pdfBlobUrl ? (
									<iframe
										key={`${pdfBlobUrl}-${reloadTick}`}
										src={pdfBlobUrl}
										title={displayTitle}
										className="size-full border-0 bg-white"
										onLoad={() => setFrameLoading(false)}
									/>
								) : null
							) : (
								<iframe
									key={`${target.url}-${reloadTick}`}
									src={target.url}
									title={displayTitle}
									className="size-full border-0 bg-white"
									allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
									allowFullScreen
									referrerPolicy="strict-origin-when-cross-origin"
									onLoad={() => setFrameLoading(false)}
								/>
							)}
						</div>

						{/* Optimized Reader View */}
						{viewMode === "reader" && (
							<div className="h-full overflow-y-auto px-5 py-4">
								{readerLoading && (
									<p role="status" className="text-sm text-muted-foreground">
										Preparando leitura otimizada de {hostLabel}…
									</p>
								)}
								{readerError && (
									<div className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3.5 text-sm">
										<p className="font-semibold text-destructive">{readerError}</p>
										<button
											type="button"
											onClick={() => setViewMode("site")}
											className="cel-button min-h-8 px-3 py-1 text-xs"
										>
											Voltar para o modo Site
										</button>
									</div>
								)}
								{!readerLoading && readerData && (
									<article className="space-y-4">
										<header className="space-y-1.5 border-b border-border/60 pb-3">
											<h1 className="cel-display text-xl leading-snug">{readerData.title}</h1>
											{readerData.description && (
												<p className="text-xs leading-relaxed text-muted-foreground">{readerData.description}</p>
											)}
										</header>

										{readerData.media.filter((m) => m.kind === "youtube").map((yt) => (
											<div key={yt.url} className="space-y-1.5 rounded-xl border border-border/60 bg-card p-3">
												<div className="flex items-center justify-between gap-2">
													<span className="text-xs font-semibold">{yt.label}</span>
													<button
														type="button"
														onClick={() => onNavigate(yt.url, yt.label)}
														className="cel-button cel-button-primary min-h-7 px-2.5 py-1 text-xs"
													>
														<Icon name="play" size={13} tone={false} />
														Abrir vídeo
													</button>
												</div>
											</div>
										))}

										<div className="tutor-prose text-sm leading-relaxed">
											<MessageResponse mode="static">{readerData.markdown}</MessageResponse>
										</div>

										{readerData.links.length > 0 && (
											<details className="study-disclosure mt-4 text-sm">
												<summary>Links e seções da página ({readerData.links.length})</summary>
												<div className="study-disclosure-body space-y-1.5">
													{readerData.links.map((link) => (
														<button
															key={link.url}
															type="button"
															onClick={() => onNavigate(link.url, link.text)}
															className="block w-full truncate text-left text-xs text-[var(--cel-link,var(--lh-accent))] underline underline-offset-2 hover:text-foreground"
														>
															{link.text}
														</button>
													))}
												</div>
											</details>
										)}
									</article>
								)}
							</div>
						)}
					</>
				)}
			</div>
		</aside>
	);
}
