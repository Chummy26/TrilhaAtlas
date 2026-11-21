"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/icon";
import { useServerEvent } from "@/components/server-events";
import {
	formatFlippedPrepForLesson,
	type DomainNotebook,
	type FlippedPrepNote,
	type FlippedReadingGuide,
	type StudyNodeBrief,
	type StudySyllabus,
	type SyllabusLesson,
	type SyllabusModule,
} from "@/src/core";
import { SessionStarter, studyLessonRequest } from "../start-session.ts";
import { lessonStatement } from "./lesson-statement.ts";
import { ModuleExamPanel } from "./module-exam-panel.tsx";
import { PlacementDialog } from "./placement-dialog.tsx";
import { ProblemSetPanel } from "./problem-set-panel.tsx";

export type SyllabusTab = "ementa" | "caderno" | "nivelamento";
type SyllabusFilter = "all" | "pending" | "lab" | "exams";
type FlashcardExportMode = "obsidian" | "anki" | "apkg";

export interface SyllabusViewProps {
	initialSyllabus: StudySyllabus;
	initialNotebook: DomainNotebook;
	domainTitle: string;
	initialTab?: SyllabusTab;
	initialModule?: string;
	initialAction?: "prova" | "lista";
}

interface FlippedApiResponse {
	guide: FlippedReadingGuide;
	note: FlippedPrepNote | null;
	formatted?: string;
	error?: string;
}

interface LessonLookupResponse {
	brief?: StudyNodeBrief;
	minutes?: number;
	sessionId?: string;
	explorationId?: string;
	error?: string;
}

interface FlashcardExportApiResponse {
	mode?: FlashcardExportMode;
	domainId?: string;
	domainTitle?: string;
	result?: unknown;
	error?: string;
}

const TABS: readonly { id: SyllabusTab; label: string; icon: "chapter" | "flashcard" | "frontier" }[] = [
	{ id: "ementa", label: "Ementa & Cronograma", icon: "chapter" },
	{ id: "caderno", label: "Caderno & Flashcards", icon: "flashcard" },
	{ id: "nivelamento", label: "Nivelamento", icon: "frontier" },
];

const FILTERS: readonly { id: SyllabusFilter; label: string }[] = [
	{ id: "all", label: "Todos" },
	{ id: "pending", label: "Pendentes" },
	{ id: "lab", label: "Com laboratório" },
	{ id: "exams", label: "Provas destravadas" },
];

const STATUS_MARKER: Record<SyllabusLesson["status"], string> = {
	done: "✓",
	"in-progress": "▶",
	available: "○",
	locked: "·",
};

const STATUS_LABEL: Record<SyllabusLesson["status"], string> = {
	done: "Concluída",
	"in-progress": "Em andamento",
	available: "Disponível",
	locked: "Pré-requisitos pendentes",
};

function formatNumber(n: number, decimals = 1): string {
	return n.toFixed(decimals).replace(".", ",");
}

function formatDatePtBr(iso: string): string {
	const clean = iso.slice(0, 10);
	const parts = clean.split("-");
	if (parts.length !== 3) return iso;
	const [year, month, day] = parts;
	return `${day}/${month}/${year}`;
}

function formatExportMessage(mode: FlashcardExportMode, data: FlashcardExportApiResponse): string {
	const modeLabel = mode === "obsidian" ? "Obsidian" : mode === "anki" ? "Anki" : ".apkg";
	const inner = data.result;
	if (inner && typeof inner === "object") {
		const obj = inner as Record<string, unknown>;
		if (typeof obj.message === "string" && obj.message.trim()) return obj.message.trim();
		const count = typeof obj.count === "number"
			? obj.count
			: typeof obj.exported === "number"
				? obj.exported
				: typeof obj.cards === "number"
					? obj.cards
					: null;
		const targetPath = typeof obj.path === "string"
			? obj.path
			: typeof obj.file === "string"
				? obj.file
				: typeof obj.outputPath === "string"
					? obj.outputPath
					: null;
		if (count !== null && targetPath) {
			return `${modeLabel}: ${count} ${count === 1 ? "cartão exportado" : "cartões exportados"} em ${targetPath}.`;
		}
		if (count !== null) {
			return `${modeLabel}: ${count} ${count === 1 ? "cartão exportado" : "cartões exportados"} com sucesso.`;
		}
		if (targetPath) {
			return `${modeLabel}: exportação concluída em ${targetPath}.`;
		}
	}
	return `Exportação para ${modeLabel} concluída.`;
}

function moduleMatchesFilter(mod: SyllabusModule, filter: SyllabusFilter): boolean {
	if (filter === "all") return true;
	if (filter === "pending") return mod.completed < mod.total;
	if (filter === "lab") return mod.lessons.some((lesson) => lesson.hasLab);
	if (filter === "exams") return mod.examUnlocked;
	return true;
}

function lessonMatchesFilter(lesson: SyllabusLesson, filter: SyllabusFilter): boolean {
	if (filter === "pending") return lesson.status !== "done";
	if (filter === "lab") return lesson.hasLab;
	return true;
}

interface FlippedPrepDrawerProps {
	domainId: string;
	lesson: SyllabusLesson;
	starting: boolean;
	onClose: () => void;
	onStartWithPrep: (lesson: SyllabusLesson, formattedPrep: string) => Promise<void>;
}

function FlippedPrepDrawer({
	domainId,
	lesson,
	starting,
	onClose,
	onStartWithPrep,
}: FlippedPrepDrawerProps) {
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const [status, setStatus] = useState("");
	const [guide, setGuide] = useState<FlippedReadingGuide | null>(null);
	const [answers, setAnswers] = useState<Record<string, string>>({});
	const [doubt, setDoubt] = useState("");
	const [completedMaterials, setCompletedMaterials] = useState<("book" | "video")[]>([]);

	useEffect(() => {
		const ctrl = new AbortController();
		setLoading(true);
		setError("");
		setStatus("");
		fetch(`/api/study/flipped?node=${encodeURIComponent(lesson.id)}`, { signal: ctrl.signal })
			.then(async (res) => {
				const data = (await res.json().catch(() => null)) as FlippedApiResponse | null;
				if (!res.ok || !data?.guide) {
					throw new Error(data?.error ?? "Não foi possível carregar o guia de pré-leitura.");
				}
				if (ctrl.signal.aborted) return;
				setGuide(data.guide);
				const loadedAnswers: Record<string, string> = {};
				for (const [k, v] of Object.entries(data.note?.answers ?? {})) {
					if (typeof v === "string") loadedAnswers[k] = v;
				}
				setAnswers(loadedAnswers);
				setDoubt(data.note?.doubt ?? "");
				setCompletedMaterials([...(data.note?.completedMaterials ?? [])]);
			})
			.catch((err: unknown) => {
				if (ctrl.signal.aborted) return;
				setError(err instanceof Error ? err.message : "Erro ao carregar pré-leitura.");
			})
			.finally(() => {
				if (!ctrl.signal.aborted) setLoading(false);
			});
		return () => ctrl.abort();
	}, [lesson.id]);

	const buildNote = useCallback((): FlippedPrepNote => ({
		answers,
		doubt,
		completedMaterials,
	}), [answers, doubt, completedMaterials]);

	const toggleMaterial = (kind: "book" | "video") => {
		setCompletedMaterials((prev) =>
			prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
		);
		if (status) setStatus("");
	};

	const saveNote = useCallback(async (): Promise<string | null> => {
		if (!guide) return null;
		setSaving(true);
		setError("");
		setStatus("");
		const note = buildNote();
		try {
			const res = await fetch("/api/study/flipped", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ nodeId: lesson.id, note }),
			});
			const data = (await res.json().catch(() => null)) as FlippedApiResponse | null;
			if (!res.ok) throw new Error(data?.error ?? "Não foi possível salvar a pré-leitura.");
			const formatted = typeof data?.formatted === "string"
				? data.formatted
				: formatFlippedPrepForLesson(guide, note);
			setStatus("Anotações salvas para a abertura da aula.");
			return formatted;
		} catch (err) {
			setError(err instanceof Error ? err.message : "Falha ao salvar pré-leitura.");
			return null;
		} finally {
			setSaving(false);
		}
	}, [buildNote, guide, lesson.id]);

	const handleGoToLesson = async () => {
		if (!guide) return;
		const formatted = await saveNote();
		if (formatted === null) return;
		await onStartWithPrep(lesson, formatted || formatFlippedPrepForLesson(guide, buildNote()));
	};

	return (
		<div
			data-testid={`flipped-drawer-${lesson.id}`}
			className="mt-2 space-y-3 rounded-xl border border-border/60 bg-background/80 p-3.5 text-sm"
		>
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/45 pb-2">
				<div className="flex items-center gap-2">
					<Icon name="book" size={16} />
					<strong className="cel-display text-sm">Pré-leitura (Sala Invertida) · {lesson.title}</strong>
				</div>
				<button
					type="button"
					aria-label="Fechar pré-leitura"
					className="cel-button cel-button-ghost min-h-7 px-2 py-0.5 text-xs"
					onClick={onClose}
				>
					<Icon name="close" size={13} tone={false} />
					Fechar
				</button>
			</div>

			{loading && (
				<p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
					<Icon name="loader" size={14} live />
					Carregando perguntas-guia…
				</p>
			)}

			{!loading && error && !guide && (
				<p role="alert" className="text-xs text-destructive">{error}</p>
			)}

			{!loading && guide && (
				<div className="space-y-3">
					{(guide.primaryBook || guide.primaryVideo) && (
						<div className="flex flex-wrap gap-2">
							{guide.primaryBook && (
								<div className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/70 px-2.5 py-1.5 text-xs">
									<input
										type="checkbox"
										id={`prep-book-${lesson.id}`}
										className="accent-[var(--cel-accent,var(--primary))]"
										checked={completedMaterials.includes("book")}
										onChange={() => toggleMaterial("book")}
									/>
									<label htmlFor={`prep-book-${lesson.id}`} className="sr-only">Marcar leitura concluída</label>
									<Icon name="book" size={14} tone={false} />
									<a
										href={guide.primaryBook.url}
										target="_blank"
										rel="noreferrer"
										className="font-medium underline underline-offset-2 hover:text-foreground"
									>
										{guide.primaryBook.title}{guide.primaryBook.part ? ` · ${guide.primaryBook.part}` : ""}
									</a>
								</div>
							)}
							{guide.primaryVideo && (
								<div className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/70 px-2.5 py-1.5 text-xs">
									<input
										type="checkbox"
										id={`prep-video-${lesson.id}`}
										className="accent-[var(--cel-accent,var(--primary))]"
										checked={completedMaterials.includes("video")}
										onChange={() => toggleMaterial("video")}
									/>
									<label htmlFor={`prep-video-${lesson.id}`} className="sr-only">Marcar vídeo concluído</label>
									<Icon name="video" size={14} tone={false} />
									<a
										href={guide.primaryVideo.url}
										target="_blank"
										rel="noreferrer"
										className="font-medium underline underline-offset-2 hover:text-foreground"
									>
										{guide.primaryVideo.title}{guide.primaryVideo.part ? ` · ${guide.primaryVideo.part}` : ""}
									</a>
								</div>
							)}
						</div>
					)}

					<ol className="space-y-2.5">
						{guide.questions.map((q, idx) => {
							const fieldId = `prep-${lesson.id}-${q.id}`;
							return (
								<li key={q.id} className="space-y-1">
									<label htmlFor={fieldId} className="block text-xs font-semibold leading-snug text-foreground">
										{idx + 1}. [{q.focus}] {q.prompt}
									</label>
									<p className="text-[11px] text-muted-foreground">{q.hint}</p>
									<textarea
										id={fieldId}
										className="cel-input min-h-16 w-full resize-y px-2.5 py-2 text-xs leading-relaxed"
										placeholder="Anote sua síntese breve antes da aula…"
										maxLength={800}
										value={answers[q.id] ?? ""}
										onChange={(e) => {
											const next = e.target.value;
											setAnswers((prev) => ({ ...prev, [q.id]: next }));
											if (status) setStatus("");
										}}
									/>
								</li>
							);
						})}
					</ol>

					<div className="space-y-1">
						<label htmlFor={`prep-doubt-${lesson.id}`} className="block text-xs font-semibold text-foreground">
							Principal dúvida ou ponto de atrito para levar ao tutor
						</label>
						<input
							id={`prep-doubt-${lesson.id}`}
							type="text"
							className="cel-input w-full px-2.5 py-2 text-xs"
							placeholder="Ex.: não ficou claro quando a aproximação deixa de valer…"
							maxLength={400}
							value={doubt}
							onChange={(e) => {
								setDoubt(e.target.value);
								if (status) setStatus("");
							}}
						/>
					</div>

					{error && <p role="alert" className="text-xs text-destructive">{error}</p>}
					{status && <p role="status" className="text-xs text-[var(--cel-success-text,var(--lh-success))]">{status}</p>}

					<div className="flex flex-wrap items-center gap-2 pt-1">
						<button
							type="button"
							className="cel-button cel-button-primary min-h-9 px-3.5 py-1.5 text-xs"
							disabled={saving || starting}
							onClick={() => void handleGoToLesson()}
						>
							<Icon name="play" size={14} />
							{starting ? "Abrindo aula…" : "Ir para a aula com minhas dúvidas"}
						</button>
						<button
							type="button"
							className="cel-button min-h-9 px-3 py-1.5 text-xs"
							disabled={saving || starting}
							onClick={() => void saveNote()}
						>
							{saving ? "Salvando…" : "Salvar anotações"}
						</button>
						<Link
							href={`/mapa?dominio=${encodeURIComponent(domainId)}&no=${encodeURIComponent(lesson.id)}`}
							className="cel-button cel-button-ghost ml-auto min-h-8 px-2.5 py-1 text-xs"
						>
							Ver no mapa
						</Link>
					</div>
				</div>
			)}
		</div>
	);
}

export function SyllabusView({
	initialSyllabus,
	initialNotebook,
	domainTitle,
	initialTab = "ementa",
	initialModule,
	initialAction,
}: SyllabusViewProps) {
	const router = useRouter();
	const starterRef = useRef(new SessionStarter());
	const [tab, setTab] = useState<SyllabusTab>(initialTab);
	const [filter, setFilter] = useState<SyllabusFilter>("all");
	const [syllabus, setSyllabus] = useState<StudySyllabus>(initialSyllabus);
	const [notebook, setNotebook] = useState<DomainNotebook>(initialNotebook);

	useEffect(() => {
		setSyllabus(initialSyllabus);
	}, [initialSyllabus]);

	useEffect(() => {
		setNotebook(initialNotebook);
	}, [initialNotebook]);

	useServerEvent("domain-changed", () => router.replace("/"));
	useServerEvent("curriculum-expanded", (event) => {
		if (event.domainId === syllabus.domainId) router.refresh();
	});

	const defaultOpenChapters = useMemo(() => {
		const open = new Set<number>();
		if (initialModule) {
			const owner = syllabus.chapters.find((c) => c.modules.some((m) => m.id === initialModule));
			if (owner) open.add(owner.index);
		}
		const activeChapter = syllabus.chapters.find((c) => c.active);
		if (activeChapter) open.add(activeChapter.index);
		if (open.size === 0 && syllabus.chapters[0]) open.add(syllabus.chapters[0].index);
		return open;
	}, [initialModule, syllabus.chapters]);

	const [openChapters, setOpenChapters] = useState<Set<number>>(defaultOpenChapters);
	const [inlinePanel, setInlinePanel] = useState<{ moduleId: string; kind: "prova" | "lista" } | null>(
		initialModule && initialAction ? { moduleId: initialModule, kind: initialAction } : null,
	);
	const [openFlippedNodeId, setOpenFlippedNodeId] = useState<string | null>(null);
	const [startingNodeId, setStartingNodeId] = useState<string | null>(null);
	const [launchError, setLaunchError] = useState("");

	const [exportBusy, setExportBusy] = useState<FlashcardExportMode | null>(null);
	const [exportStatus, setExportStatus] = useState<{ ok: boolean; text: string } | null>(null);

	const completedHours = Math.max(0, Math.round((syllabus.totalHours - syllabus.remainingHours) * 100) / 100);
	const overallPct = syllabus.totalLessons > 0
		? Math.round((100 * syllabus.completedLessons) / syllabus.totalLessons)
		: 0;
	const { schedule } = syllabus;
	const reviewReservePct = Math.round(schedule.reviewReserveShare * 100);

	const toggleChapter = (chapterIndex: number) => {
		setOpenChapters((prev) => {
			const next = new Set(prev);
			if (next.has(chapterIndex)) next.delete(chapterIndex);
			else next.add(chapterIndex);
			return next;
		});
	};

	const startLessonForNode = useCallback(async (lesson: SyllabusLesson, preReadingNote?: string) => {
		if (startingNodeId) return;
		setStartingNodeId(lesson.id);
		setLaunchError("");
		try {
			const endpoint = "/api/study/materials?" + new URLSearchParams({
				domain: syllabus.domainId,
				node: lesson.id,
				lesson: "1",
			});
			const res = await fetch(endpoint);
			const detail = (await res.json().catch(() => null)) as LessonLookupResponse | null;
			if (!res.ok || !detail?.brief) {
				throw new Error(detail?.error ?? "Não foi possível preparar esta aula.");
			}
			// If there is already an active lesson session and no fresh pre-reading note was appended, resume it.
			if (detail.sessionId && !preReadingNote) {
				router.push(`/chat/${encodeURIComponent(detail.sessionId)}`);
				return;
			}
			const minutes = Math.max(5, Math.round(detail.minutes ?? lesson.minutes));
			const baseStatement = lessonStatement(detail.brief, minutes);
			const statement = preReadingNote
				? `${baseStatement}\n\n${preReadingNote}`
				: baseStatement;
			const opening = preReadingNote
				? `${lesson.title}\n\n${preReadingNote}`
				: lesson.title;
			const target = await starterRef.current.start(
				studyLessonRequest({
					domainId: syllabus.domainId,
					minutes,
					title: lesson.title,
					exploratory: lesson.status === "locked",
					context: {
						id: lesson.id,
						name: lesson.title,
						statement,
					},
				}),
				fetch,
				undefined,
				opening,
			);
			router.push(target);
		} catch (err) {
			setLaunchError(
				err instanceof Error
					? err.message
					: "Não foi possível iniciar a aula. Verifique se os modelos de IA estão configurados.",
			);
			setStartingNodeId(null);
		}
	}, [router, startingNodeId, syllabus.domainId]);

	const handleExportFlashcards = async (mode: FlashcardExportMode) => {
		if (exportBusy) return;
		setExportBusy(mode);
		setExportStatus(null);
		try {
			const res = await fetch("/api/study/flashcards/export", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ mode }),
			});
			const data = (await res.json().catch(() => null)) as FlashcardExportApiResponse | null;
			if (!res.ok) {
				throw new Error(data?.error ?? "Falha ao exportar flashcards.");
			}
			setExportStatus({ ok: true, text: formatExportMessage(mode, data ?? {}) });
		} catch (err) {
			setExportStatus({
				ok: false,
				text: err instanceof Error ? err.message : "Não foi possível exportar os flashcards.",
			});
		} finally {
			setExportBusy(null);
		}
	};

	const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		const idx = TABS.findIndex((t) => t.id === tab);
		if (event.key === "ArrowRight") {
			event.preventDefault();
			const next = TABS[(idx + 1) % TABS.length]!;
			setTab(next.id);
		} else if (event.key === "ArrowLeft") {
			event.preventDefault();
			const prev = TABS[(idx - 1 + TABS.length) % TABS.length]!;
			setTab(prev.id);
		}
	};

	const filteredChapters = useMemo(() => {
		return syllabus.chapters
			.map((chapter) => ({
				...chapter,
				modules: chapter.modules.filter((mod) => moduleMatchesFilter(mod, filter)),
			}))
			.filter((chapter) => filter === "all" || chapter.modules.length > 0);
	}, [filter, syllabus.chapters]);

	const mapDomainHref = `/mapa?dominio=${encodeURIComponent(syllabus.domainId)}`;
	const mapNodeHref = (nodeId: string) =>
		`/mapa?dominio=${encodeURIComponent(syllabus.domainId)}&no=${encodeURIComponent(nodeId)}`;

	return (
		<main className="h-dvh overflow-y-auto px-4 pb-16 pt-6 md:px-8" data-domain={syllabus.domainId}>
			<div className="mx-auto w-full max-w-5xl space-y-5">
				<header className="space-y-3">
					<div className="flex flex-wrap items-center justify-between gap-2.5">
						<Link
							href="/"
							className="cel-button cel-button-ghost lh-no-drag min-h-9 px-2.5 text-sm"
						>
							<Icon name="chevron-left" size={16} tone={false} />
							Hoje
						</Link>
						<div className="flex flex-wrap items-center gap-2">
							<Link
								href={mapDomainHref}
								className="cel-button min-h-9 px-3 py-1.5 text-xs"
							>
								<Icon name="map" size={14} tone={false} />
								Explorar árvore
							</Link>
							<Link
								href="/profile"
								className="cel-button cel-button-ghost min-h-9 px-3 py-1.5 text-xs"
							>
								<Icon name="profile" size={14} tone={false} />
								Boletim no Perfil
							</Link>
						</div>
					</div>

					<div className="flex flex-wrap items-end justify-between gap-3">
						<div className="space-y-1">
							<h1 className="cel-display text-2xl leading-tight sm:text-3xl">
								Ementa · {domainTitle}
							</h1>
							<p className="text-xs text-muted-foreground tabular-nums">
								<strong className="font-semibold text-foreground">{syllabus.completedLessons}/{syllabus.totalLessons}</strong> aulas concluídas ({overallPct}%) ·{" "}
								<strong className="font-semibold text-foreground">{formatNumber(completedHours)}/{formatNumber(syllabus.totalHours)} h</strong>
							</p>
						</div>

						<div
							role="tablist"
							aria-label="Seções da ementa"
							onKeyDown={handleTabKeyDown}
							className="flex flex-wrap gap-1.5"
						>
							{TABS.map((item) => {
								const selected = tab === item.id;
								return (
									<button
										key={item.id}
										type="button"
										role="tab"
										id={`syllabus-tab-${item.id}`}
										aria-selected={selected}
										aria-controls={`syllabus-panel-${item.id}`}
										className={`cel-chip min-h-9 cursor-pointer px-3 py-1.5 text-xs ${selected ? "" : "opacity-85 hover:opacity-100"}`}
										onClick={() => setTab(item.id)}
									>
										<Icon name={item.icon} size={14} tone={false} />
										{item.label}
									</button>
								);
							})}
						</div>
					</div>
				</header>

				{launchError && (
					<div role="alert" className="cel-card flex items-center justify-between gap-3 border-destructive/40 px-4 py-3 text-sm text-destructive">
						<span>{launchError}</span>
						<button
							type="button"
							aria-label="Dispensar aviso"
							className="cel-button cel-button-ghost min-h-7 px-2 text-xs"
							onClick={() => setLaunchError("")}
						>
							<Icon name="close" size={13} tone={false} />
						</button>
					</div>
				)}

				{tab === "ementa" && (
					<div
						id="syllabus-panel-ementa"
						role="tabpanel"
						aria-labelledby="syllabus-tab-ementa"
						className="space-y-4"
					>
						<section aria-label="Cronograma realista" data-testid="syllabus-schedule-card" className="cel-card space-y-3.5 p-4 sm:p-5">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div className="flex items-center gap-2">
									<Icon name="calendar" size={18} />
									<h2 className="cel-display text-lg leading-tight">Cronograma Realista</h2>
								</div>
								<span className="study-pill study-pill-info tabular-nums">
									{schedule.paceSource === "observed" ? "Ritmo observado (14 dias)" : "Ritmo planejado"}
								</span>
							</div>

							<div className="space-y-1.5">
								<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums">
									<span>
										<strong className="font-semibold text-foreground">{formatNumber(completedHours)} h</strong> concluídas ·{" "}
										<strong className="font-semibold text-foreground">{formatNumber(syllabus.remainingHours)} h</strong> restantes
									</span>
									<span>{overallPct}% da carga total</span>
								</div>
								<progress
									className="study-progress block w-full"
									max={Math.max(1, syllabus.totalLessons)}
									value={syllabus.completedLessons}
									aria-label={`Progresso geral da ementa: ${overallPct}%`}
								/>
							</div>

							<dl className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
								<div className="rounded-xl border border-border/50 bg-background/60 p-3">
									<dt className="text-xs text-muted-foreground">Previsão p50–p80</dt>
									<dd className="cel-display mt-1 text-base tabular-nums">
										{syllabus.remainingHours <= 0
											? "Concluído"
											: `${formatNumber(schedule.weeksToFinish)}–${formatNumber(schedule.weeksToFinishP80)} sem`}
									</dd>
									{syllabus.remainingHours > 0 && (
										<p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
											{formatDatePtBr(schedule.estimatedCompletionDate)} a {formatDatePtBr(schedule.estimatedCompletionDateP80)}
										</p>
									)}
								</div>

								<div className="rounded-xl border border-border/50 bg-background/60 p-3">
									<dt className="text-xs text-muted-foreground">Ritmo semanal usado</dt>
									<dd className="cel-display mt-1 text-base tabular-nums">
										{formatNumber(schedule.effectiveWeeklyHours)} h/sem
									</dd>
									<p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
										Observado: {formatNumber(schedule.weeklyHoursObserved)} h · Planejado: {formatNumber(schedule.weeklyHoursPlanned)} h
									</p>
								</div>

								<div className="rounded-xl border border-border/50 bg-background/60 p-3">
									<dt className="text-xs text-muted-foreground">Reserva para revisões</dt>
									<dd className="cel-display mt-1 text-base tabular-nums">{reviewReservePct}% FSRS</dd>
									<p className="mt-0.5 text-[11px] text-muted-foreground">
										Revisões espaçadas e provas integradoras já descontadas
									</p>
								</div>

								<div className="rounded-xl border border-border/50 bg-background/60 p-3">
									<dt className="text-xs text-muted-foreground">Capítulo atual</dt>
									<dd className="cel-display mt-1 text-base tabular-nums">
										{schedule.activeChapterWeeks <= 0
											? "Concluído"
											: `~${formatNumber(schedule.activeChapterWeeks)} sem`}
									</dd>
									<p className="mt-0.5 text-[11px] text-muted-foreground">
										{syllabus.activeChapterIndex !== null
											? syllabus.chapters[syllabus.activeChapterIndex]?.level ?? "Em andamento"
											: "Todos os capítulos concluídos"}
									</p>
								</div>
							</dl>
						</section>

						<div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar ementa">
							{FILTERS.map((item) => (
								<button
									key={item.id}
									type="button"
									aria-pressed={filter === item.id}
									className="cel-chip min-h-8 cursor-pointer px-3 py-1 text-xs"
									onClick={() => setFilter(item.id)}
								>
									{item.label}
								</button>
							))}
						</div>

						{filteredChapters.length === 0 ? (
							<section className="cel-card p-5 text-sm text-muted-foreground">
								Nenhum módulo corresponde ao filtro selecionado.
							</section>
						) : (
							<div className="space-y-3.5">
								{filteredChapters.map((chapter) => {
									const isOpen = openChapters.has(chapter.index) || filter !== "all";
									const chapterPct = chapter.total > 0 ? Math.round((100 * chapter.completed) / chapter.total) : 0;
									return (
										<section
											key={`${chapter.level}-${chapter.index}`}
											data-testid={`syllabus-chapter-${chapter.index}`}
											className="cel-card overflow-hidden"
										>
											<button
												type="button"
												aria-expanded={isOpen}
												onClick={() => toggleChapter(chapter.index)}
												className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-accent/40 sm:px-5"
											>
												<div className="min-w-0 flex-1 space-y-1">
													<div className="flex flex-wrap items-center gap-2">
														<span className="study-pill study-pill-accent">{chapter.level}</span>
														<h2 className="cel-display text-base leading-snug sm:text-lg">{chapter.title}</h2>
														{chapter.active && <span className="study-pill study-pill-info">Atual</span>}
														{chapter.total > 0 && chapter.completed === chapter.total && (
															<span className="study-pill study-pill-success">Concluído</span>
														)}
													</div>
													{chapter.mission && (
														<p className="max-w-[65ch] text-xs leading-relaxed text-muted-foreground">
															{chapter.mission}
														</p>
													)}
												</div>
												<div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
													<div className="text-right">
														<p className="font-semibold text-foreground">{chapter.completed}/{chapter.total} aulas ({chapterPct}%)</p>
														<p>{formatNumber(chapter.hoursRemaining)} h restantes</p>
													</div>
													<Icon name={isOpen ? "chevron-up" : "chevron-down"} size={16} tone={false} />
												</div>
											</button>

											{isOpen && (
												<div className="space-y-3.5 border-t border-border/50 bg-background/35 p-3.5 sm:p-5">
													{chapter.modules.map((mod) => {
														const visibleLessons = mod.lessons.filter((l) => lessonMatchesFilter(l, filter));
														const modPct = mod.total > 0 ? Math.round((100 * mod.completed) / mod.total) : 0;
														const activePanelKind = inlinePanel?.moduleId === mod.id ? inlinePanel.kind : null;
														const isCurrentModule = syllabus.activeModuleId === mod.id;

														return (
															<article
																key={mod.id}
																id={`modulo-${mod.id}`}
																data-testid={`syllabus-module-${mod.id}`}
																className="space-y-3 rounded-xl border border-border/60 bg-card p-4"
															>
																<div className="flex flex-wrap items-start justify-between gap-3">
																	<div className="min-w-0 flex-1 space-y-1.5">
																		<div className="flex flex-wrap items-center gap-2">
																			<h3 className="cel-display text-base leading-snug">
																				Módulo {mod.index} · {mod.title}
																			</h3>
																			{isCurrentModule && <span className="study-pill study-pill-accent">Em foco</span>}
																			{mod.avgRetention !== null && (
																				<span className="study-pill study-pill-info tabular-nums" title="Retenção média estimada pelo FSRS">
																					Retenção {Math.round(mod.avgRetention * 100)}%
																				</span>
																			)}
																			{mod.examScore !== undefined && (
																				<span
																					className={mod.examPassed ? "study-pill study-pill-success tabular-nums" : "study-pill study-pill-warning tabular-nums"}
																					title={mod.examAt ? `Realizada em ${formatDatePtBr(mod.examAt)}` : undefined}
																				>
																					Prova: {formatNumber(mod.examScore)}/10 {mod.examPassed ? "· Aprovado" : "· Reforço"}
																				</span>
																			)}
																		</div>
																		<div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground tabular-nums">
																			<span>
																				<strong className="font-semibold text-foreground">{mod.completed}/{mod.total}</strong> aulas ({modPct}%)
																			</span>
																			<span>{formatNumber(mod.hoursRemaining)}/{formatNumber(mod.hoursTotal)} h restantes</span>
																			{mod.examUnlocked && mod.examScore === undefined && (
																				<span className="text-[var(--cel-success-text,var(--lh-success))]">Prova destravada</span>
																			)}
																		</div>
																		<progress
																			className="study-progress block w-full max-w-md"
																			max={Math.max(1, mod.total)}
																			value={mod.completed}
																			aria-label={`Progresso do módulo ${mod.title}`}
																		/>
																	</div>

																	<div className="flex flex-wrap items-center gap-2">
																		<button
																			type="button"
																			data-testid={`open-exam-${mod.id}`}
																			aria-expanded={activePanelKind === "prova"}
																			className={`cel-button min-h-9 px-3 py-1.5 text-xs ${mod.examUnlocked ? "cel-button-primary" : ""}`}
																			title={mod.examUnlocked ? "Abrir Prova Integradora intercalada" : "Recomendada após 70% do módulo concluído (você pode abrir mesmo assim)"}
																			onClick={() =>
																				setInlinePanel((curr) =>
																					curr?.moduleId === mod.id && curr.kind === "prova"
																						? null
																						: { moduleId: mod.id, kind: "prova" },
																				)
																			}
																		>
																			<Icon name="exercise" size={14} tone={false} />
																			Prova Integradora
																		</button>
																		<button
																			type="button"
																			data-testid={`open-pset-${mod.id}`}
																			aria-expanded={activePanelKind === "lista"}
																			className="cel-button min-h-9 px-3 py-1.5 text-xs"
																			onClick={() =>
																				setInlinePanel((curr) =>
																					curr?.moduleId === mod.id && curr.kind === "lista"
																						? null
																						: { moduleId: mod.id, kind: "lista" },
																				)
																			}
																		>
																			<Icon name="activity" size={14} tone={false} />
																			Lista &amp; Lab
																		</button>
																	</div>
																</div>

																{(mod.books.length > 0 || mod.videos.length > 0) && (
																	<div className="flex flex-wrap gap-2 border-t border-border/45 pt-2.5 text-xs">
																		{mod.books.map((book) => (
																			<a
																				key={`book-${book.url}-${book.part}`}
																				href={book.url}
																				target="_blank"
																				rel="noreferrer"
																				className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/60 px-2.5 py-1 hover:bg-accent"
																			>
																				<Icon name="book" size={13} tone={false} />
																				<span className="font-medium">{book.title}</span>
																				{book.part && <span className="text-muted-foreground">· {book.part}</span>}
																			</a>
																		))}
																		{mod.videos.map((video) => (
																			<a
																				key={`video-${video.url}-${video.part}`}
																				href={video.url}
																				target="_blank"
																				rel="noreferrer"
																				className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-background/60 px-2.5 py-1 hover:bg-accent"
																			>
																				<Icon name="video" size={13} tone={false} />
																				<span className="font-medium">{video.title}</span>
																				{video.part && <span className="text-muted-foreground">· {video.part}</span>}
																			</a>
																		))}
																	</div>
																)}

																{activePanelKind === "prova" && (
																	<div className="pt-1">
																		<ModuleExamPanel
																			domainId={syllabus.domainId}
																			scope="module"
																			targetId={mod.id}
																			targetTitle={mod.title}
																			onClose={() => setInlinePanel(null)}
																			onGraded={() => router.refresh()}
																		/>
																	</div>
																)}

																{activePanelKind === "lista" && (
																	<div className="pt-1">
																		<ProblemSetPanel
																			domainId={syllabus.domainId}
																			moduleId={mod.id}
																			moduleTitle={mod.title}
																			onClose={() => setInlinePanel(null)}
																			onGraded={() => router.refresh()}
																		/>
																	</div>
																)}

																<ol className="study-missions border-t border-border/45 pt-2.5">
																	{visibleLessons.map((lesson, idx) => {
																		const flippedOpen = openFlippedNodeId === lesson.id;
																		const isStarting = startingNodeId === lesson.id;
																		return (
																			<li
																				key={lesson.id}
																				data-reached={lesson.status === "done"}
																				className="flex-col items-stretch gap-1.5 py-1.5"
																			>
																				<div className="flex flex-wrap items-center gap-2">
																					<span
																						className="study-mission-marker"
																						title={STATUS_LABEL[lesson.status]}
																						aria-label={STATUS_LABEL[lesson.status]}
																					>
																						{STATUS_MARKER[lesson.status]}
																					</span>
																					<Link
																						href={mapNodeHref(lesson.id)}
																						className={`min-w-0 text-sm underline decoration-border underline-offset-2 hover:decoration-foreground ${lesson.status === "in-progress" ? "font-semibold text-foreground" : "font-medium"}`}
																					>
																						{idx + 1}. {lesson.title}
																					</Link>
																					{lesson.hasLab && (
																						<span className="study-pill study-pill-info">Lab</span>
																					)}
																					{lesson.durable && (
																						<span className="study-pill study-pill-success">Retida ≥24h</span>
																					)}
																					{lesson.isFinale && (
																						<span className="study-pill study-pill-accent">Missão final</span>
																					)}
																					<span className="text-xs tabular-nums text-muted-foreground">
																						~{lesson.minutes} min
																					</span>
																					<div className="ml-auto flex flex-wrap items-center gap-1.5">
																						<button
																							type="button"
																							aria-expanded={flippedOpen}
																							className="cel-button cel-button-ghost min-h-7 px-2.5 py-0.5 text-xs"
																							onClick={() =>
																								setOpenFlippedNodeId((curr) =>
																									curr === lesson.id ? null : lesson.id,
																								)
																							}
																						>
																							<Icon name="book" size={13} tone={false} />
																							Pré-leitura
																						</button>
																						<button
																							type="button"
																							className={`cel-button min-h-7 px-2.5 py-0.5 text-xs ${lesson.status === "in-progress" || lesson.status === "available" ? "cel-button-primary" : ""}`}
																							disabled={Boolean(startingNodeId)}
																							onClick={() => void startLessonForNode(lesson)}
																						>
																							<Icon name="play" size={12} tone={false} />
																							{isStarting ? "Abrindo…" : "Estudar"}
																						</button>
																					</div>
																				</div>

																				{flippedOpen && (
																					<FlippedPrepDrawer
																						domainId={syllabus.domainId}
																						lesson={lesson}
																						starting={isStarting}
																						onClose={() => setOpenFlippedNodeId(null)}
																						onStartWithPrep={startLessonForNode}
																					/>
																				)}
																			</li>
																		);
																	})}
																</ol>
															</article>
														);
													})}
												</div>
											)}
										</section>
									);
								})}
							</div>
						)}
					</div>
				)}

				{tab === "caderno" && (
					<div
						id="syllabus-panel-caderno"
						role="tabpanel"
						aria-labelledby="syllabus-tab-caderno"
						className="space-y-4"
					>
						<section aria-label="Exportação de flashcards" className="cel-card space-y-3 p-4 sm:p-5">
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div className="space-y-0.5">
									<div className="flex items-center gap-2">
										<Icon name="export-cards" size={18} />
										<h2 className="cel-display text-lg leading-tight">Exportar Flashcards do Domínio</h2>
									</div>
									<p className="text-xs text-muted-foreground">
										Exporte os cartões gerados nas suas aulas de {domainTitle} para revisão externa em Obsidian ou Anki.
									</p>
								</div>
								<div className="flex flex-wrap items-center gap-2">
									<button
										type="button"
										data-testid="export-obsidian"
										className="cel-button min-h-9 px-3 py-1.5 text-xs"
										disabled={Boolean(exportBusy)}
										onClick={() => void handleExportFlashcards("obsidian")}
									>
										<Icon name="export-notes" size={14} tone={false} />
										{exportBusy === "obsidian" ? "Exportando…" : "Obsidian"}
									</button>
									<button
										type="button"
										data-testid="export-anki"
										className="cel-button min-h-9 px-3 py-1.5 text-xs"
										disabled={Boolean(exportBusy)}
										onClick={() => void handleExportFlashcards("anki")}
									>
										<Icon name="flashcard" size={14} tone={false} />
										{exportBusy === "anki" ? "Exportando…" : "Anki"}
									</button>
									<button
										type="button"
										data-testid="export-apkg"
										className="cel-button cel-button-primary min-h-9 px-3 py-1.5 text-xs"
										disabled={Boolean(exportBusy)}
										onClick={() => void handleExportFlashcards("apkg")}
									>
										<Icon name="download" size={14} tone={false} />
										{exportBusy === "apkg" ? "Gerando…" : ".apkg"}
									</button>
								</div>
							</div>

							{exportStatus && (
								<p
									role="status"
									className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${
										exportStatus.ok
											? "border-[var(--cel-success,var(--lh-success))]/45 bg-[var(--cel-success,var(--lh-success))]/10 text-foreground"
											: "border-destructive/45 bg-destructive/10 text-destructive"
									}`}
								>
									{exportStatus.text}
								</p>
							)}

							<dl className="grid grid-cols-2 gap-2.5 border-t border-border/45 pt-3 sm:grid-cols-4">
								<div className="rounded-xl border border-border/45 bg-background/60 p-2.5">
									<dt className="text-[11px] text-muted-foreground">Erros registrados</dt>
									<dd className="cel-display mt-0.5 text-lg tabular-nums">{notebook.totalMistakes}</dd>
								</div>
								<div className="rounded-xl border border-border/45 bg-background/60 p-2.5">
									<dt className="text-[11px] text-muted-foreground">Misconceptions ativas</dt>
									<dd className="cel-display mt-0.5 text-lg tabular-nums">{notebook.activeMisconceptions}</dd>
								</div>
								<div className="rounded-xl border border-border/45 bg-background/60 p-2.5">
									<dt className="text-[11px] text-muted-foreground">Misconceptions superadas</dt>
									<dd className="cel-display mt-0.5 text-lg tabular-nums">{notebook.resolvedMisconceptions}</dd>
								</div>
								<div className="rounded-xl border border-border/45 bg-background/60 p-2.5">
									<dt className="text-[11px] text-muted-foreground">Conceitos consolidados</dt>
									<dd className="cel-display mt-0.5 text-lg tabular-nums">{notebook.totalMasteredConcepts}</dd>
								</div>
							</dl>
						</section>

						{notebook.modules.length === 0 ? (
							<section className="cel-card p-5 text-sm leading-relaxed text-muted-foreground">
								Seu caderno ainda está vazio neste domínio. Conforme você fizer aulas, listas e provas integradoras, seus erros recorrentes, misconceptions e conceitos dominados aparecerão organizados por módulo aqui.
							</section>
						) : (
							<div className="space-y-4">
								{notebook.modules.map((mod) => (
									<section key={mod.moduleId} className="cel-card space-y-4 p-4 sm:p-5">
										<div className="border-b border-border/50 pb-2.5">
											{mod.areaTitle && (
												<p className="text-xs font-medium text-muted-foreground">{mod.areaTitle}</p>
											)}
											<h3 className="cel-display text-lg leading-snug">{mod.moduleTitle}</h3>
										</div>

										{mod.mistakes.length > 0 && (
											<div className="space-y-2">
												<h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
													<Icon name="warning" size={14} />
													Erros recorrentes ({mod.mistakes.length})
												</h4>
												<ul className="space-y-2">
													{mod.mistakes.map((mistake) => (
														<li key={mistake.id} className="space-y-1 rounded-xl border border-border/50 bg-background/60 p-3 text-xs">
															<div className="flex flex-wrap items-center justify-between gap-2">
																<div className="flex flex-wrap items-center gap-2">
																	<Link
																		href={mapNodeHref(mistake.nodeId)}
																		className="font-semibold text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
																	>
																		{mistake.nodeTitle}
																	</Link>
																	<span className="study-pill study-pill-warning">
																		{mistake.kind === "reinforce" ? "Reforço" : `Nota ${mistake.grade ?? 0}/3`}
																	</span>
																</div>
																<span className="text-[11px] tabular-nums text-muted-foreground">
																	{formatDatePtBr(mistake.at)}
																</span>
															</div>
															{mistake.quizContext && (
																<div className="space-y-1 text-muted-foreground">
																	<p><strong className="text-foreground/90">Pergunta:</strong> {mistake.quizContext.question}</p>
																	<p><strong className="text-foreground/90">Sua resposta:</strong> {mistake.quizContext.answer}</p>
																	{mistake.quizContext.expected && (
																		<p><strong className="text-foreground/90">Esperado:</strong> {mistake.quizContext.expected}</p>
																	)}
																</div>
															)}
															{mistake.feedback && (
																<p className="leading-relaxed text-muted-foreground">{mistake.feedback}</p>
															)}
														</li>
													))}
												</ul>
											</div>
										)}

										{mod.misconceptions.length > 0 && (
											<div className="space-y-2">
												<h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
													<Icon name="weak-spot" size={14} />
													Misconceptions ({mod.misconceptions.length})
												</h4>
												<ul className="space-y-2">
													{mod.misconceptions.map((m) => {
														const pct = Math.round(m.probability * 100);
														return (
															<li key={`${m.nodeId}-${m.id}`} className="space-y-1.5 rounded-xl border border-border/50 bg-background/60 p-3 text-xs">
																<div className="flex flex-wrap items-center justify-between gap-2">
																	<div className="flex flex-wrap items-center gap-2">
																		<span className={m.status === "active" ? "study-pill study-pill-warning" : "study-pill study-pill-success"}>
																			{m.status === "active" ? "Ativa" : "Superada"}
																		</span>
																		<Link
																			href={mapNodeHref(m.nodeId)}
																			className="font-semibold text-foreground underline decoration-border underline-offset-2"
																		>
																			{m.nodeTitle}
																		</Link>
																	</div>
																	<span className="font-semibold tabular-nums text-foreground">{pct}% Beta</span>
																</div>
																<p className="leading-relaxed text-foreground/90">{m.text}</p>
																<progress
																	className="study-progress block w-full"
																	max={100}
																	value={pct}
																	aria-label={`Probabilidade Beta da misconception: ${pct}%`}
																/>
															</li>
														);
													})}
												</ul>
											</div>
										)}

										{mod.masteredConcepts.length > 0 && (
											<div className="space-y-2">
												<h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
													<Icon name="check" size={14} />
													Conceitos dominados ({mod.masteredConcepts.length})
												</h4>
												<ul className="grid gap-2.5 sm:grid-cols-2">
													{mod.masteredConcepts.map((concept) => (
														<li key={concept.nodeId} className="space-y-1.5 rounded-xl border border-border/50 bg-background/60 p-3 text-xs">
															<div className="flex flex-wrap items-center gap-1.5">
																<Link
																	href={mapNodeHref(concept.nodeId)}
																	className="font-semibold text-foreground underline decoration-border underline-offset-2"
																>
																	{concept.title}
																</Link>
																{concept.mastered && <span className="study-pill study-pill-success">Dominado</span>}
																{concept.durable && <span className="study-pill study-pill-info">Retida ≥24h</span>}
															</div>
															{concept.summary && (
																<p className="leading-relaxed text-muted-foreground">{concept.summary}</p>
															)}
															{concept.objectives.length > 0 && (
																<ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
																	{concept.objectives.slice(0, 3).map((obj, idx) => (
																		<li key={idx}>{obj}</li>
																	))}
																</ul>
															)}
														</li>
													))}
												</ul>
											</div>
										)}
									</section>
								))}
							</div>
						)}
					</div>
				)}

				{tab === "nivelamento" && (
					<div
						id="syllabus-panel-nivelamento"
						role="tabpanel"
						aria-labelledby="syllabus-tab-nivelamento"
					>
						<PlacementDialog
							domainId={syllabus.domainId}
							onCompleted={() => router.refresh()}
						/>
					</div>
				)}
			</div>
		</main>
	);
}
