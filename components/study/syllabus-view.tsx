"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/icon";
import { useServerEvent } from "@/components/server-events";
import { useI18n } from "@/components/i18n";
import {
	formatFlippedPrepForLesson,
	formatJobAidMarkdown,
	type DomainNotebook,
	type FlippedPrepNote,
	type FlippedReadingGuide,
	type NotebookModuleEntry,
	type NotebookNoteSource,
	type StudyNodeBrief,
	type StudySyllabus,
	type SyllabusChapter,
	type SyllabusLesson,
	type SyllabusModule,
	type Translator,
} from "@/src/core";
import { SessionStarter, studyLessonRequest } from "../start-session.ts";
import { lessonStatement } from "./lesson-statement.ts";

const ModuleExamPanel = dynamic(() => import("./module-exam-panel.tsx").then((m) => m.ModuleExamPanel));
const PlacementDialog = dynamic(() => import("./placement-dialog.tsx").then((m) => m.PlacementDialog));
const ProblemSetPanel = dynamic(() => import("./problem-set-panel.tsx").then((m) => m.ProblemSetPanel));

export type SyllabusTab = "ementa" | "caderno" | "nivelamento";
type SyllabusFilter = "all" | "pending" | "lab" | "exams";
type FlashcardExportMode = "obsidian" | "anki" | "apkg";

type InlinePanelState =
	| { scope: "module"; moduleId: string; kind: "prova" | "lista" }
	| { scope: "chapter"; chapterLevel: string }
	| null;

export interface SyllabusViewProps {
	initialSyllabus: StudySyllabus;
	initialNotebook?: DomainNotebook | null;
	domainTitle: string;
	initialTab?: SyllabusTab;
	initialModule?: string;
	initialChapterId?: string;
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
	activeSessionId?: string;
	completedSessionId?: string;
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

const TAB_DEFS: readonly { id: SyllabusTab; icon: "chapter" | "flashcard" | "frontier" }[] = [
	{ id: "ementa", icon: "chapter" },
	{ id: "caderno", icon: "flashcard" },
	{ id: "nivelamento", icon: "frontier" },
];

const FILTER_IDS: readonly SyllabusFilter[] = ["all", "pending", "lab", "exams"];

const STATUS_MARKER: Record<SyllabusLesson["status"], string> = {
	done: "✓",
	"in-progress": "▶",
	available: "○",
	locked: "·",
};

function statusLabel(t: Translator, status: SyllabusLesson["status"]): string {
	switch (status) {
		case "done":
			return t("course.syllabus.statusDone");
		case "in-progress":
			return t("course.syllabus.statusInProgress");
		case "available":
			return t("course.syllabus.statusAvailable");
		case "locked":
			return t("course.syllabus.statusLocked");
	}
}

function tabLabel(t: Translator, tab: SyllabusTab): string {
	switch (tab) {
		case "ementa":
			return t("course.syllabus.tabSyllabus");
		case "caderno":
			return t("course.syllabus.tabNotebook");
		case "nivelamento":
			return t("course.syllabus.tabPlacement");
	}
}

function filterLabel(t: Translator, filter: SyllabusFilter): string {
	switch (filter) {
		case "all":
			return t("course.syllabus.filterAll");
		case "pending":
			return t("course.syllabus.filterPending");
		case "lab":
			return t("course.syllabus.filterLab");
		case "exams":
			return t("course.syllabus.filterExams");
	}
}

function formatIsoDate(iso: string, dateFmt: Intl.DateTimeFormat): string {
	const parsed = new Date(iso);
	if (Number.isNaN(parsed.getTime())) return iso;
	return dateFmt.format(parsed);
}

function formatExportMessage(
	t: Translator,
	mode: FlashcardExportMode,
	data: FlashcardExportApiResponse,
): string {
	const modeLabel = mode === "obsidian" ? "Obsidian" : mode === "anki" ? "Anki" : ".apkg";
	const inner = data.result;
	if (inner && typeof inner === "object") {
		const obj = inner as Record<string, unknown>;
		if (typeof obj.message === "string" && obj.message.trim()) return obj.message.trim();
		const count =
			typeof obj.count === "number"
				? obj.count
				: typeof obj.exported === "number"
					? obj.exported
					: typeof obj.cards === "number"
						? obj.cards
						: null;
		const targetPath =
			typeof obj.path === "string"
				? obj.path
				: typeof obj.file === "string"
					? obj.file
					: typeof obj.outputPath === "string"
						? obj.outputPath
						: null;
		if (count !== null && targetPath) {
			return t("course.syllabus.exportCountPath", { mode: modeLabel, count, path: targetPath });
		}
		if (count !== null) {
			return t("course.syllabus.exportCount", { mode: modeLabel, count });
		}
		if (targetPath) {
			return t("course.syllabus.exportPath", { mode: modeLabel, path: targetPath });
		}
	}
	return t("course.syllabus.exportDone", { mode: modeLabel });
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
	const { t } = useI18n();
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
					throw new Error(data?.error ?? t("course.syllabus.flippedErrLoad"));
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
				setError(err instanceof Error ? err.message : t("course.syllabus.flippedErrLoad"));
			})
			.finally(() => {
				if (!ctrl.signal.aborted) setLoading(false);
			});
		return () => ctrl.abort();
	}, [lesson.id, t]);

	const buildNote = useCallback(
		(): FlippedPrepNote => ({
			answers,
			doubt,
			completedMaterials,
		}),
		[answers, doubt, completedMaterials],
	);

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
			if (!res.ok) throw new Error(data?.error ?? t("course.syllabus.flippedErrSave"));
			const formatted =
				typeof data?.formatted === "string" ? data.formatted : formatFlippedPrepForLesson(guide, note);
			setStatus(t("course.syllabus.flippedSaved"));
			return formatted;
		} catch (err) {
			setError(err instanceof Error ? err.message : t("course.syllabus.flippedErrSave"));
			return null;
		} finally {
			setSaving(false);
		}
	}, [buildNote, guide, lesson.id, t]);

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
					<strong className="cel-display text-sm">
						{t("course.syllabus.flippedTitle", { title: lesson.title })}
					</strong>
				</div>
				<button
					type="button"
					aria-label={t("course.syllabus.flippedCloseAria")}
					className="cel-button cel-button-ghost min-h-7 px-2 py-0.5 text-xs"
					onClick={onClose}
				>
					<Icon name="close" size={13} tone={false} />
					{t("common.action.close")}
				</button>
			</div>

			{loading && (
				<p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
					<Icon name="loader" size={14} live />
					{t("course.syllabus.flippedLoading")}
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
									<label htmlFor={`prep-book-${lesson.id}`} className="sr-only">
										{t("course.syllabus.markBookDone")}
									</label>
									<Icon name="book" size={14} tone={false} />
									<a
										href={guide.primaryBook.url}
										target="_blank"
										rel="noreferrer"
										className="font-medium underline underline-offset-2 hover:text-foreground"
									>
										{guide.primaryBook.title}
										{guide.primaryBook.part ? ` · ${guide.primaryBook.part}` : ""}
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
									<label htmlFor={`prep-video-${lesson.id}`} className="sr-only">
										{t("course.syllabus.markVideoDone")}
									</label>
									<Icon name="video" size={14} tone={false} />
									<a
										href={guide.primaryVideo.url}
										target="_blank"
										rel="noreferrer"
										className="font-medium underline underline-offset-2 hover:text-foreground"
									>
										{guide.primaryVideo.title}
										{guide.primaryVideo.part ? ` · ${guide.primaryVideo.part}` : ""}
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
										placeholder={t("course.syllabus.flippedAnswerPlaceholder")}
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
							{t("course.syllabus.flippedDoubtLabel")}
						</label>
						<input
							id={`prep-doubt-${lesson.id}`}
							type="text"
							className="cel-input w-full px-2.5 py-2 text-xs"
							placeholder={t("course.syllabus.flippedDoubtPlaceholder")}
							maxLength={400}
							value={doubt}
							onChange={(e) => {
								setDoubt(e.target.value);
								if (status) setStatus("");
							}}
						/>
					</div>

					{error && <p role="alert" className="text-xs text-destructive">{error}</p>}
					{status && (
						<p role="status" className="text-xs text-[var(--cel-success-text,var(--lh-success))]">
							{status}
						</p>
					)}

					<div className="flex flex-wrap items-center gap-2 pt-1">
						<button
							type="button"
							className="cel-button cel-button-primary min-h-9 px-3.5 py-1.5 text-xs"
							disabled={saving || starting}
							onClick={() => void handleGoToLesson()}
						>
							<Icon name="play" size={14} />
							{starting ? t("course.syllabus.flippedOpening") : t("course.syllabus.flippedGoLesson")}
						</button>
						<button
							type="button"
							className="cel-button min-h-9 px-3 py-1.5 text-xs"
							disabled={saving || starting}
							onClick={() => void saveNote()}
						>
							{saving ? t("course.syllabus.flippedSaving") : t("course.syllabus.flippedSave")}
						</button>
						<Link
							href={`/mapa?dominio=${encodeURIComponent(domainId)}&no=${encodeURIComponent(lesson.id)}`}
							className="cel-button cel-button-ghost ml-auto min-h-8 px-2.5 py-1 text-xs"
						>
							{t("course.syllabus.viewOnMap")}
						</Link>
					</div>
				</div>
			)}
		</div>
	);
}

interface SyllabusLessonRowProps {
	domainId: string;
	lesson: SyllabusLesson;
	index: number;
	flippedOpen: boolean;
	isStarting: boolean;
	isOpeningPast: boolean;
	anyStarting: boolean;
	t: Translator;
	onToggleFlipped: (lessonId: string) => void;
	onCloseFlipped: () => void;
	onOpenPast: (lesson: SyllabusLesson) => Promise<void>;
	onStartLesson: (lesson: SyllabusLesson, preReadingNote?: string) => Promise<void>;
}

const SyllabusLessonRow = memo(function SyllabusLessonRow({
	domainId,
	lesson,
	index,
	flippedOpen,
	isStarting,
	isOpeningPast,
	anyStarting,
	t,
	onToggleFlipped,
	onCloseFlipped,
	onOpenPast,
	onStartLesson,
}: SyllabusLessonRowProps) {
	const lessonStatusText = statusLabel(t, lesson.status);
	const studyActionLabel =
		lesson.status === "done"
			? t("course.syllabus.practiceReview")
			: lesson.status === "in-progress"
				? t("course.syllabus.continue")
				: lesson.status === "locked"
					? t("course.syllabus.explore")
					: t("course.syllabus.study");
	const nodeHref = `/mapa?dominio=${encodeURIComponent(domainId)}&no=${encodeURIComponent(lesson.id)}`;

	return (
		<li
			data-reached={lesson.status === "done"}
			className="flex-col items-stretch gap-1.5 py-1.5"
		>
			<div className="flex flex-wrap items-center gap-2">
				<span
					className="study-mission-marker"
					title={lessonStatusText}
					aria-label={lessonStatusText}
				>
					{STATUS_MARKER[lesson.status]}
				</span>
				<Link
					href={nodeHref}
					className={`min-w-0 text-sm underline decoration-border underline-offset-2 hover:decoration-foreground ${lesson.status === "in-progress" ? "font-semibold text-foreground" : "font-medium"}`}
				>
					{index + 1}. {lesson.title}
				</Link>
				{lesson.hasLab && (
					<span className="study-pill study-pill-info">
						{t("course.syllabus.pillLab")}
					</span>
				)}
				{lesson.durable && (
					<span className="study-pill study-pill-success">
						{t("course.syllabus.pillDurable")}
					</span>
				)}
				{lesson.isFinale && (
					<span className="study-pill study-pill-accent">
						{t("course.syllabus.pillFinale")}
					</span>
				)}
				<span className="text-xs tabular-nums text-muted-foreground">
					~{lesson.minutes} min
				</span>
				<div className="ml-auto flex flex-wrap items-center gap-1.5">
					<button
						type="button"
						aria-expanded={flippedOpen}
						className="cel-button cel-button-ghost min-h-7 px-2.5 py-0.5 text-xs"
						onClick={() => onToggleFlipped(lesson.id)}
					>
						<Icon name="book" size={13} tone={false} />
						{t("course.syllabus.preReading")}
					</button>
					{lesson.status === "done" && (
						<button
							type="button"
							className="cel-button cel-button-ghost min-h-7 px-2.5 py-0.5 text-xs"
							disabled={anyStarting}
							onClick={() => void onOpenPast(lesson)}
						>
							{isOpeningPast
								? t("course.syllabus.opening")
								: t("course.syllabus.viewPastLesson")}
						</button>
					)}
					<button
						type="button"
						className={`cel-button min-h-7 px-2.5 py-0.5 text-xs ${lesson.status === "in-progress" || lesson.status === "available" ? "cel-button-primary" : ""}`}
						disabled={anyStarting}
						onClick={() => void onStartLesson(lesson)}
					>
						<Icon name="play" size={12} tone={false} />
						{isStarting ? t("course.syllabus.opening") : studyActionLabel}
					</button>
				</div>
			</div>

			{flippedOpen && (
				<FlippedPrepDrawer
					domainId={domainId}
					lesson={lesson}
					starting={isStarting}
					onClose={onCloseFlipped}
					onStartWithPrep={onStartLesson}
				/>
			)}
		</li>
	);
});

interface SyllabusModuleCardProps {
	domainId: string;
	mod: SyllabusModule;
	filter: SyllabusFilter;
	isCurrentModule: boolean;
	activePanelKind: "prova" | "lista" | null;
	activeFlippedNodeId: string | null;
	activeStartingNodeId: string | null;
	anyStarting: boolean;
	decFmt: Intl.NumberFormat;
	dateFmt: Intl.DateTimeFormat;
	t: Translator;
	onToggleModulePanel: (moduleId: string, kind: "prova" | "lista") => void;
	onCloseInlinePanel: () => void;
	onRefresh: () => void;
	onToggleFlipped: (lessonId: string) => void;
	onCloseFlipped: () => void;
	onOpenPast: (lesson: SyllabusLesson) => Promise<void>;
	onStartLesson: (lesson: SyllabusLesson, preReadingNote?: string) => Promise<void>;
}

const SyllabusModuleCard = memo(function SyllabusModuleCard({
	domainId,
	mod,
	filter,
	isCurrentModule,
	activePanelKind,
	activeFlippedNodeId,
	activeStartingNodeId,
	anyStarting,
	decFmt,
	dateFmt,
	t,
	onToggleModulePanel,
	onCloseInlinePanel,
	onRefresh,
	onToggleFlipped,
	onCloseFlipped,
	onOpenPast,
	onStartLesson,
}: SyllabusModuleCardProps) {
	const visibleLessons = useMemo(
		() => (filter === "all" || filter === "exams" ? mod.lessons : mod.lessons.filter((l) => lessonMatchesFilter(l, filter))),
		[mod.lessons, filter],
	);
	const modPct = mod.total > 0 ? Math.round((100 * mod.completed) / mod.total) : 0;
	const firstPendingLesson =
		mod.lessons.find((l) => l.status === "in-progress" || l.status === "available") ??
		mod.lessons[0];
	const arcSteps = [
		{
			id: "prep",
			label: t("course.syllabus.arcPrep"),
			done: mod.completed > 0,
			active: mod.books.length > 0 || mod.videos.length > 0,
			onClick: firstPendingLesson ? () => onToggleFlipped(firstPendingLesson.id) : undefined,
		},
		{
			id: "lesson",
			label: `${t("course.syllabus.arcLesson")} ${mod.completed}/${mod.total}`,
			done: mod.total > 0 && mod.completed >= mod.total,
			active: mod.completed > 0 && mod.completed < mod.total,
		},
		{
			id: "pset",
			label: t("course.syllabus.arcProblemSet"),
			done: Boolean(mod.problemSetPassed),
			active: !mod.problemSetPassed && mod.completed > 0,
			onClick: () => onToggleModulePanel(mod.id, "lista"),
		},
		{
			id: "exam",
			label: t("course.syllabus.arcExam"),
			done: Boolean(mod.examPassed),
			active: Boolean(mod.examUnlocked && !mod.examPassed),
			onClick: () => onToggleModulePanel(mod.id, "prova"),
		},
		{
			id: "review",
			label: t("course.syllabus.arcReview"),
			done: mod.avgRetention !== null && mod.avgRetention >= 0.85,
			active: mod.avgRetention !== null && mod.avgRetention < 0.85,
		},
	];

	return (
		<article
			id={`modulo-${mod.id}`}
			data-testid={`syllabus-module-${mod.id}`}
			className="study-cv-block space-y-3 rounded-xl border border-border/60 bg-card p-4"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0 flex-1 space-y-1.5">
					<div className="flex flex-wrap items-center gap-2">
						<h3 className="cel-display text-base leading-snug">
							{t("course.syllabus.moduleTitle", { index: mod.index, title: mod.title })}
						</h3>
						{isCurrentModule && (
							<span className="study-pill study-pill-accent">{t("course.syllabus.inFocus")}</span>
						)}
						{mod.avgRetention !== null && (
							<span
								className="study-pill study-pill-info tabular-nums"
								title={t("course.syllabus.retentionTitle")}
							>
								{t("course.syllabus.retentionPill", { pct: Math.round(mod.avgRetention * 100) })}
							</span>
						)}
						{mod.problemSetScore !== undefined && (
							<span
								className={
									mod.problemSetPassed
										? "study-pill study-pill-success tabular-nums"
										: "study-pill study-pill-warning tabular-nums"
								}
								title={
									mod.problemSetAt
										? t("course.syllabus.takenOn", { date: formatIsoDate(mod.problemSetAt, dateFmt) })
										: undefined
								}
							>
								{t("course.syllabus.problemSetScoreBadge", {
									score: decFmt.format(mod.problemSetScore),
									status: mod.problemSetPassed
										? t("course.syllabus.statusPassed")
										: t("course.syllabus.statusReview"),
								})}
							</span>
						)}
						{mod.examScore !== undefined && (
							<span
								className={
									mod.examPassed
										? "study-pill study-pill-success tabular-nums"
										: "study-pill study-pill-warning tabular-nums"
								}
								title={
									mod.examAt
										? t("course.syllabus.takenOn", { date: formatIsoDate(mod.examAt, dateFmt) })
										: undefined
								}
							>
								{t("course.syllabus.examScoreBadge", {
									score: decFmt.format(mod.examScore),
									status: mod.examPassed
										? t("course.syllabus.statusPassed")
										: t("course.syllabus.statusReinforce"),
								})}
							</span>
						)}
					</div>
					<div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground tabular-nums">
						<span>
							{t("course.syllabus.chapterLessons", {
								completed: mod.completed,
								total: mod.total,
								pct: modPct,
							})}
						</span>
						<span>
							{t("course.syllabus.hoursRemainingOf", {
								remaining: decFmt.format(mod.hoursRemaining),
								total: decFmt.format(mod.hoursTotal),
							})}
						</span>
						{mod.examUnlocked && mod.examScore === undefined && (
							<span className="text-[var(--cel-success-text,var(--lh-success))]">
								{t("course.syllabus.examUnlocked")}
							</span>
						)}
					</div>
					<progress
						className="study-progress block w-full max-w-md"
						max={Math.max(1, mod.total)}
						value={mod.completed}
						aria-label={t("course.syllabus.moduleProgressAria", { title: mod.title })}
					/>
					<ol
						aria-label={t("course.syllabus.arcAria")}
						data-testid={`module-arc-${mod.id}`}
						className="flex flex-wrap items-center gap-1 pt-1 text-[11px]"
					>
						{arcSteps.map((step, stepIdx) => {
							const pillCls = step.done
								? "border-[var(--cel-success,var(--lh-success))]/45 bg-[var(--cel-success,var(--lh-success))]/10 text-foreground"
								: step.active
									? "border-[var(--cel-accent,var(--primary))]/50 bg-[var(--cel-accent,var(--primary))]/10 text-foreground"
									: "border-border/50 bg-background/50 text-muted-foreground";
							return (
								<li key={step.id} className="inline-flex items-center gap-1">
									{stepIdx > 0 && (
										<span aria-hidden="true" className="text-muted-foreground/60">
											→
										</span>
									)}
									{step.onClick ? (
										<button
											type="button"
											onClick={step.onClick}
											className={`inline-flex cursor-pointer items-center gap-1 rounded-md border px-1.5 py-0.5 font-medium transition-colors hover:border-foreground/50 ${pillCls}`}
										>
											<span aria-hidden="true">{step.done ? "✓" : step.active ? "●" : "○"}</span>
											{step.label}
										</button>
									) : (
										<span
											className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-medium ${pillCls}`}
										>
											<span aria-hidden="true">{step.done ? "✓" : step.active ? "●" : "○"}</span>
											{step.label}
										</span>
									)}
								</li>
							);
						})}
					</ol>
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<button
						type="button"
						data-testid={`open-exam-${mod.id}`}
						aria-expanded={activePanelKind === "prova"}
						className={`cel-button min-h-9 px-3 py-1.5 text-xs ${mod.examUnlocked && !mod.examPassed ? "cel-button-primary" : ""}`}
						title={
							mod.examUnlocked
								? t("course.syllabus.moduleExamTitleUnlocked")
								: t("course.syllabus.moduleExamTitleLocked")
						}
						onClick={() => onToggleModulePanel(mod.id, "prova")}
					>
						<Icon name="exercise" size={14} tone={false} />
						{t("course.syllabus.moduleExamButton")}
					</button>
					<button
						type="button"
						data-testid={`open-pset-${mod.id}`}
						aria-expanded={activePanelKind === "lista"}
						className="cel-button min-h-9 px-3 py-1.5 text-xs"
						onClick={() => onToggleModulePanel(mod.id, "lista")}
					>
						<Icon name="activity" size={14} tone={false} />
						{t("course.syllabus.problemSetButton")}
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
						domainId={domainId}
						scope="module"
						targetId={mod.id}
						targetTitle={mod.title}
						onClose={onCloseInlinePanel}
						onGraded={onRefresh}
					/>
				</div>
			)}

			{activePanelKind === "lista" && (
				<div className="pt-1">
					<ProblemSetPanel
						domainId={domainId}
						moduleId={mod.id}
						moduleTitle={mod.title}
						onClose={onCloseInlinePanel}
						onGraded={onRefresh}
					/>
				</div>
			)}

			<ol className="study-missions border-t border-border/45 pt-2.5">
				{visibleLessons.map((lesson, idx) => (
					<SyllabusLessonRow
						key={lesson.id}
						domainId={domainId}
						lesson={lesson}
						index={idx}
						flippedOpen={activeFlippedNodeId === lesson.id}
						isStarting={activeStartingNodeId === lesson.id}
						isOpeningPast={activeStartingNodeId === `past:${lesson.id}`}
						anyStarting={anyStarting}
						t={t}
						onToggleFlipped={onToggleFlipped}
						onCloseFlipped={onCloseFlipped}
						onOpenPast={onOpenPast}
						onStartLesson={onStartLesson}
					/>
				))}
			</ol>
		</article>
	);
});

interface SyllabusChapterCardProps {
	domainId: string;
	chapter: SyllabusChapter;
	isOpen: boolean;
	chapterExamOpen: boolean;
	activeModuleId: string | null;
	chapterInlineModulePanel: { moduleId: string; kind: "prova" | "lista" } | null;
	chapterFlippedNodeId: string | null;
	chapterStartingNodeId: string | null;
	anyStarting: boolean;
	filter: SyllabusFilter;
	decFmt: Intl.NumberFormat;
	dateFmt: Intl.DateTimeFormat;
	t: Translator;
	onToggleChapter: (chapterIndex: number) => void;
	onToggleChapterExam: (chapterLevel: string) => void;
	onToggleModulePanel: (moduleId: string, kind: "prova" | "lista") => void;
	onCloseInlinePanel: () => void;
	onRefresh: () => void;
	onToggleFlipped: (lessonId: string) => void;
	onCloseFlipped: () => void;
	onOpenPast: (lesson: SyllabusLesson) => Promise<void>;
	onStartLesson: (lesson: SyllabusLesson, preReadingNote?: string) => Promise<void>;
}

const SyllabusChapterCard = memo(function SyllabusChapterCard({
	domainId,
	chapter,
	isOpen,
	chapterExamOpen,
	activeModuleId,
	chapterInlineModulePanel,
	chapterFlippedNodeId,
	chapterStartingNodeId,
	anyStarting,
	filter,
	decFmt,
	dateFmt,
	t,
	onToggleChapter,
	onToggleChapterExam,
	onToggleModulePanel,
	onCloseInlinePanel,
	onRefresh,
	onToggleFlipped,
	onCloseFlipped,
	onOpenPast,
	onStartLesson,
}: SyllabusChapterCardProps) {
	const chapterPct = chapter.total > 0 ? Math.round((100 * chapter.completed) / chapter.total) : 0;

	return (
		<section
			data-testid={`syllabus-chapter-${chapter.index}`}
			className="study-cv-block cel-card overflow-hidden"
		>
			<div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5 sm:px-5">
				<button
					type="button"
					aria-expanded={isOpen}
					onClick={() => onToggleChapter(chapter.index)}
					className="flex min-w-0 flex-1 cursor-pointer flex-wrap items-center justify-between gap-3 rounded-lg text-left transition-colors hover:bg-accent/30"
				>
					<div className="min-w-0 flex-1 space-y-1">
						<div className="flex flex-wrap items-center gap-2">
							<span className="study-pill study-pill-accent">{chapter.level}</span>
							<h2 className="cel-display text-base leading-snug sm:text-lg">{chapter.title}</h2>
							{chapter.active && (
								<span className="study-pill study-pill-info">{t("course.syllabus.statusCurrent")}</span>
							)}
							{chapter.total > 0 && chapter.completed === chapter.total && (
								<span className="study-pill study-pill-success">{t("course.syllabus.statusCompleted")}</span>
							)}
							{chapter.examScore !== undefined && (
								<span
									className={
										chapter.examPassed
											? "study-pill study-pill-success tabular-nums"
											: "study-pill study-pill-warning tabular-nums"
									}
									title={
										chapter.examAt
											? t("course.syllabus.takenOn", { date: formatIsoDate(chapter.examAt, dateFmt) })
											: undefined
									}
								>
									{t("course.syllabus.chapterExamScore", {
										score: decFmt.format(chapter.examScore),
										status: chapter.examPassed
											? t("course.syllabus.statusPassed")
											: t("course.syllabus.statusReinforce"),
									})}
								</span>
							)}
							{chapter.examUnlocked && chapter.examScore === undefined && (
								<span className="study-pill study-pill-info">
									{t("course.syllabus.chapterExamUnlocked")}
								</span>
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
							<p className="font-semibold text-foreground">
								{t("course.syllabus.chapterLessons", {
									completed: chapter.completed,
									total: chapter.total,
									pct: chapterPct,
								})}
							</p>
							<p>
								{t("course.syllabus.hoursRemaining", {
									hours: decFmt.format(chapter.hoursRemaining),
								})}
							</p>
						</div>
						<Icon name={isOpen ? "chevron-up" : "chevron-down"} size={16} tone={false} />
					</div>
				</button>

				<button
					type="button"
					data-testid={`open-chapter-exam-${chapter.index}`}
					aria-expanded={chapterExamOpen}
					className={`cel-button min-h-9 shrink-0 px-3 py-1.5 text-xs ${chapter.examUnlocked && !chapter.examPassed ? "cel-button-primary" : ""}`}
					title={
						chapter.examUnlocked
							? t("course.syllabus.chapterExamTitleUnlocked")
							: t("course.syllabus.chapterExamTitleLocked")
					}
					onClick={() => onToggleChapterExam(chapter.level)}
				>
					<Icon name="trophy" size={14} tone={false} />
					{t("course.syllabus.chapterExamButton")}
				</button>
			</div>

			{chapterExamOpen && (
				<div className="border-t border-border/50 bg-background/45 p-3.5 sm:p-5">
					<ModuleExamPanel
						domainId={domainId}
						scope="chapter"
						targetId={chapter.level}
						targetTitle={`${chapter.level} · ${chapter.title}`}
						onClose={onCloseInlinePanel}
						onGraded={onRefresh}
					/>
				</div>
			)}

			{isOpen && (
				<div className="space-y-3.5 border-t border-border/50 bg-background/35 p-3.5 sm:p-5">
					{chapter.modules.map((mod) => {
						const modFlipped =
							chapterFlippedNodeId && mod.lessons.some((l) => l.id === chapterFlippedNodeId)
								? chapterFlippedNodeId
								: null;
						const modStarting =
							chapterStartingNodeId &&
							mod.lessons.some(
								(l) => chapterStartingNodeId === l.id || chapterStartingNodeId === `past:${l.id}`,
							)
								? chapterStartingNodeId
								: null;
						return (
							<SyllabusModuleCard
								key={mod.id}
								domainId={domainId}
								mod={mod}
								filter={filter}
								isCurrentModule={activeModuleId === mod.id}
								activePanelKind={
									chapterInlineModulePanel?.moduleId === mod.id
										? chapterInlineModulePanel.kind
										: null
								}
								activeFlippedNodeId={modFlipped}
								activeStartingNodeId={modStarting}
								anyStarting={anyStarting}
								decFmt={decFmt}
								dateFmt={dateFmt}
								t={t}
								onToggleModulePanel={onToggleModulePanel}
								onCloseInlinePanel={onCloseInlinePanel}
								onRefresh={onRefresh}
								onToggleFlipped={onToggleFlipped}
								onCloseFlipped={onCloseFlipped}
								onOpenPast={onOpenPast}
								onStartLesson={onStartLesson}
							/>
						);
					})}
				</div>
			)}
		</section>
	);
});

function noteSourceLabel(t: Translator, source: NotebookNoteSource): string {
	switch (source) {
		case "tutor":
			return t("course.syllabus.noteSourceTutor");
		case "pdf":
			return t("course.syllabus.noteSourcePdf");
		case "video":
			return t("course.syllabus.noteSourceVideo");
		case "manual":
			return t("course.syllabus.noteSourceManual");
	}
}

interface NotebookModuleCardProps {
	domainId: string;
	mod: NotebookModuleEntry;
	dateFmt: Intl.DateTimeFormat;
	t: Translator;
	mapNodeHref: (nodeId: string) => string;
	onNotebookChanged: () => Promise<void>;
}

const NotebookModuleCard = memo(function NotebookModuleCard({
	domainId,
	mod,
	dateFmt,
	t,
	mapNodeHref,
	onNotebookChanged,
}: NotebookModuleCardProps) {
	const [copiedAid, setCopiedAid] = useState(false);
	const [noteFormOpen, setNoteFormOpen] = useState(false);
	const [noteExcerpt, setNoteExcerpt] = useState("");
	const [noteComment, setNoteComment] = useState("");
	const [noteBusy, setNoteBusy] = useState(false);
	const [noteError, setNoteError] = useState("");

	const [artifactFormOpen, setArtifactFormOpen] = useState(false);
	const [artifactTitle, setArtifactTitle] = useState("");
	const [artifactSummary, setArtifactSummary] = useState("");
	const [artifactContent, setArtifactContent] = useState("");
	const [artifactBusy, setArtifactBusy] = useState(false);
	const [artifactError, setArtifactError] = useState("");

	const [deletingId, setDeletingId] = useState<string | null>(null);

	const handleCopyJobAid = async () => {
		if (!mod.jobAid) return;
		const md = formatJobAidMarkdown(mod.jobAid);
		try {
			await navigator.clipboard.writeText(md);
			setCopiedAid(true);
			window.setTimeout(() => setCopiedAid(false), 2000);
		} catch {
			// Clipboard API may be unavailable in restricted contexts.
		}
	};

	const handleCreateNote = async (event: React.FormEvent) => {
		event.preventDefault();
		const trimmedExcerpt = noteExcerpt.trim();
		if (!trimmedExcerpt || noteBusy) return;
		setNoteBusy(true);
		setNoteError("");
		try {
			const res = await fetch("/api/study/notebook", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					action: "save-note",
					domain: domainId,
					moduleId: mod.moduleId,
					source: "manual",
					excerpt: trimmedExcerpt,
					...(noteComment.trim() ? { comment: noteComment.trim() } : {}),
				}),
			});
			const data = (await res.json().catch(() => null)) as { error?: string } | null;
			if (!res.ok) throw new Error(data?.error ?? t("course.syllabus.deleteNote"));
			setNoteExcerpt("");
			setNoteComment("");
			setNoteFormOpen(false);
			await onNotebookChanged();
		} catch (err) {
			setNoteError(err instanceof Error ? err.message : "");
		} finally {
			setNoteBusy(false);
		}
	};

	const handleCreateArtifact = async (event: React.FormEvent) => {
		event.preventDefault();
		const trimmedTitle = artifactTitle.trim();
		const trimmedContent = artifactContent.trim();
		if (!trimmedTitle || !trimmedContent || artifactBusy) return;
		setArtifactBusy(true);
		setArtifactError("");
		try {
			const res = await fetch("/api/study/notebook", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					action: "save-artifact",
					domain: domainId,
					moduleId: mod.moduleId,
					title: trimmedTitle,
					summary: artifactSummary.trim(),
					content: trimmedContent,
				}),
			});
			const data = (await res.json().catch(() => null)) as { error?: string } | null;
			if (!res.ok) throw new Error(data?.error ?? "");
			setArtifactTitle("");
			setArtifactSummary("");
			setArtifactContent("");
			setArtifactFormOpen(false);
			await onNotebookChanged();
		} catch (err) {
			setArtifactError(err instanceof Error ? err.message : "");
		} finally {
			setArtifactBusy(false);
		}
	};

	const handleDeleteEntry = async (kind: "note" | "artifact", id: string) => {
		if (deletingId) return;
		setDeletingId(id);
		try {
			const params = new URLSearchParams({ domain: domainId, kind, id });
			const res = await fetch(`/api/study/notebook?${params.toString()}`, { method: "DELETE" });
			if (res.ok) await onNotebookChanged();
		} finally {
			setDeletingId(null);
		}
	};

	return (
		<section
			data-testid={`notebook-module-${mod.moduleId}`}
			className="study-cv-block cel-card space-y-4 p-4 sm:p-5"
		>
			<div className="border-b border-border/50 pb-2.5">
				{mod.areaTitle && (
					<p className="text-xs font-medium text-muted-foreground">{mod.areaTitle}</p>
				)}
				<h3 className="cel-display text-lg leading-snug">{mod.moduleTitle}</h3>
			</div>

			{mod.jobAid && (
				<details
					data-testid={`notebook-job-aid-${mod.moduleId}`}
					className="rounded-xl border border-border/55 bg-background/60 p-3 text-xs"
				>
					<summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 list-none font-semibold text-foreground">
						<span className="flex items-center gap-1.5">
							<Icon name="file-text" size={14} />
							{t("course.syllabus.jobAidHeading")}
						</span>
						<button
							type="button"
							data-testid={`copy-job-aid-${mod.moduleId}`}
							className="cel-button cel-button-ghost min-h-7 px-2 py-0.5 text-[11px]"
							onClick={(e) => {
								e.preventDefault();
								e.stopPropagation();
								void handleCopyJobAid();
							}}
						>
							<Icon name={copiedAid ? "check" : "copy"} size={12} tone={false} />
							{copiedAid ? t("course.syllabus.jobAidCopied") : t("course.syllabus.jobAidCopy")}
						</button>
					</summary>
					<div className="mt-3 space-y-3 border-t border-border/40 pt-2.5">
						{mod.jobAid.keyTakeaways.length > 0 && (
							<div className="space-y-1">
								<h5 className="font-semibold text-foreground">{t("course.syllabus.jobAidTakeaways")}</h5>
								<ul className="list-disc space-y-1 pl-4 leading-relaxed text-muted-foreground">
									{mod.jobAid.keyTakeaways.map((item, idx) => (
										<li key={idx}>{item}</li>
									))}
								</ul>
							</div>
						)}
						{mod.jobAid.watchOutFor.length > 0 && (
							<div className="space-y-1">
								<h5 className="font-semibold text-foreground">{t("course.syllabus.jobAidWatchOut")}</h5>
								<ul className="list-disc space-y-1 pl-4 leading-relaxed text-muted-foreground">
									{mod.jobAid.watchOutFor.map((item, idx) => (
										<li key={idx}>{item}</li>
									))}
								</ul>
							</div>
						)}
						{mod.jobAid.referenceLinks.length > 0 && (
							<div className="space-y-1.5">
								<h5 className="font-semibold text-foreground">{t("course.syllabus.jobAidReferences")}</h5>
								<div className="flex flex-wrap gap-1.5">
									{mod.jobAid.referenceLinks.map((ref) => (
										<a
											key={`${ref.kind}-${ref.url}-${ref.part}`}
											href={ref.url}
											target="_blank"
											rel="noreferrer"
											className="inline-flex items-center gap-1.5 rounded-lg border border-border/50 bg-card/70 px-2 py-1 hover:bg-accent"
										>
											<Icon name={ref.kind === "video" ? "video" : "book"} size={12} tone={false} />
											<span className="font-medium text-foreground">{ref.title}</span>
											{ref.part && <span className="text-muted-foreground">· {ref.part}</span>}
										</a>
									))}
								</div>
							</div>
						)}
					</div>
				</details>
			)}

			<div className="space-y-2">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
						<Icon name="pin" size={14} />
						{t("course.syllabus.savedNotesHeading", { count: mod.savedNotes.length })}
					</h4>
					<button
						type="button"
						data-testid={`toggle-add-note-${mod.moduleId}`}
						aria-expanded={noteFormOpen}
						className="cel-button cel-button-ghost min-h-7 px-2.5 py-0.5 text-xs"
						onClick={() => {
							setNoteFormOpen((open) => !open);
							setNoteError("");
						}}
					>
						<Icon name="plus" size={12} tone={false} />
						{t("course.syllabus.addNoteToggle")}
					</button>
				</div>

				{noteFormOpen && (
					<form
						onSubmit={(e) => void handleCreateNote(e)}
						className="space-y-2 rounded-xl border border-border/60 bg-background/75 p-3 text-xs"
					>
						<textarea
							className="cel-input min-h-16 w-full resize-y px-2.5 py-2 text-xs leading-relaxed"
							placeholder={t("course.syllabus.addNotePlaceholder")}
							maxLength={2000}
							required
							value={noteExcerpt}
							onChange={(e) => setNoteExcerpt(e.target.value)}
						/>
						<input
							type="text"
							className="cel-input w-full px-2.5 py-1.5 text-xs"
							placeholder={t("course.syllabus.addNoteCommentPlaceholder")}
							maxLength={1000}
							value={noteComment}
							onChange={(e) => setNoteComment(e.target.value)}
						/>
						{noteError && <p role="alert" className="text-xs text-destructive">{noteError}</p>}
						<div className="flex flex-wrap items-center gap-2">
							<button
								type="submit"
								className="cel-button cel-button-primary min-h-8 px-3 py-1 text-xs"
								disabled={noteBusy || !noteExcerpt.trim()}
							>
								{noteBusy ? t("course.syllabus.saving") : t("course.syllabus.addNoteSubmit")}
							</button>
							<button
								type="button"
								className="cel-button cel-button-ghost min-h-8 px-2.5 py-1 text-xs"
								disabled={noteBusy}
								onClick={() => {
									setNoteFormOpen(false);
									setNoteError("");
								}}
							>
								{t("course.syllabus.cancel")}
							</button>
						</div>
					</form>
				)}

				{mod.savedNotes.length > 0 && (
					<ul className="space-y-2">
						{mod.savedNotes.map((note) => {
							const isLocalUrl = Boolean(note.sourceUrl && note.sourceUrl.startsWith("/"));
							return (
								<li
									key={note.id}
									data-testid={`saved-note-${note.id}`}
									className="space-y-1.5 rounded-xl border border-border/50 bg-background/60 p-3 text-xs"
								>
									<div className="flex flex-wrap items-center justify-between gap-2">
										<div className="flex flex-wrap items-center gap-1.5">
											<span className="study-pill study-pill-info">{noteSourceLabel(t, note.source)}</span>
											{note.nodeId && (
												<Link
													href={mapNodeHref(note.nodeId)}
													className="font-semibold text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
												>
													{note.nodeTitle ?? note.nodeId}
												</Link>
											)}
											{note.sourceUrl ? (
												isLocalUrl ? (
													<Link
														href={note.sourceUrl}
														className="text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground"
													>
														{note.sourceTitle ?? note.locator ?? note.sourceUrl}
														{note.sourceTitle && note.locator ? ` · ${note.locator}` : ""}
													</Link>
												) : (
													<a
														href={note.sourceUrl}
														target="_blank"
														rel="noreferrer"
														className="text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground"
													>
														{note.sourceTitle ?? note.locator ?? note.sourceUrl}
														{note.sourceTitle && note.locator ? ` · ${note.locator}` : ""}
													</a>
												)
											) : (note.sourceTitle || note.locator) ? (
												<span className="text-muted-foreground">
													{[note.sourceTitle, note.locator].filter(Boolean).join(" · ")}
												</span>
											) : null}
										</div>
										<div className="flex items-center gap-2">
											<span className="text-[11px] tabular-nums text-muted-foreground">
												{formatIsoDate(note.createdAt, dateFmt)}
											</span>
											<button
												type="button"
												aria-label={t("course.syllabus.deleteNote")}
												title={t("course.syllabus.deleteNote")}
												disabled={deletingId === note.id}
												onClick={() => void handleDeleteEntry("note", note.id)}
												className="cel-button cel-button-ghost min-h-7 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-destructive"
											>
												<Icon name="trash" size={12} tone={false} />
												<span className="sr-only">{t("course.syllabus.deleteNote")}</span>
											</button>
										</div>
									</div>
									<p className="whitespace-pre-wrap leading-relaxed text-foreground/90">{note.excerpt}</p>
									{note.comment && (
										<p className="border-l-2 border-border pl-2.5 italic leading-relaxed text-muted-foreground">
											{note.comment}
										</p>
									)}
								</li>
							);
						})}
					</ul>
				)}
			</div>

			<div className="space-y-2">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
						<Icon name="file-text" size={14} />
						{t("course.syllabus.artifactsHeading", { count: mod.artifacts.length })}
					</h4>
					<button
						type="button"
						data-testid={`toggle-add-artifact-${mod.moduleId}`}
						aria-expanded={artifactFormOpen}
						className="cel-button cel-button-ghost min-h-7 px-2.5 py-0.5 text-xs"
						onClick={() => {
							setArtifactFormOpen((open) => !open);
							setArtifactError("");
						}}
					>
						<Icon name="plus" size={12} tone={false} />
						{t("course.syllabus.addArtifactToggle")}
					</button>
				</div>

				{artifactFormOpen && (
					<form
						onSubmit={(e) => void handleCreateArtifact(e)}
						className="space-y-2 rounded-xl border border-border/60 bg-background/75 p-3 text-xs"
					>
						<input
							type="text"
							className="cel-input w-full px-2.5 py-1.5 text-xs"
							placeholder={t("course.syllabus.artifactTitlePlaceholder")}
							maxLength={160}
							required
							value={artifactTitle}
							onChange={(e) => setArtifactTitle(e.target.value)}
						/>
						<input
							type="text"
							className="cel-input w-full px-2.5 py-1.5 text-xs"
							placeholder={t("course.syllabus.artifactSummaryPlaceholder")}
							maxLength={300}
							value={artifactSummary}
							onChange={(e) => setArtifactSummary(e.target.value)}
						/>
						<textarea
							className="cel-input min-h-24 w-full resize-y px-2.5 py-2 text-xs leading-relaxed"
							placeholder={t("course.syllabus.artifactContentPlaceholder")}
							maxLength={8000}
							required
							value={artifactContent}
							onChange={(e) => setArtifactContent(e.target.value)}
						/>
						{artifactError && <p role="alert" className="text-xs text-destructive">{artifactError}</p>}
						<div className="flex flex-wrap items-center gap-2">
							<button
								type="submit"
								className="cel-button cel-button-primary min-h-8 px-3 py-1 text-xs"
								disabled={artifactBusy || !artifactTitle.trim() || !artifactContent.trim()}
							>
								{artifactBusy ? t("course.syllabus.saving") : t("course.syllabus.artifactSubmit")}
							</button>
							<button
								type="button"
								className="cel-button cel-button-ghost min-h-8 px-2.5 py-1 text-xs"
								disabled={artifactBusy}
								onClick={() => {
									setArtifactFormOpen(false);
									setArtifactError("");
								}}
							>
								{t("course.syllabus.cancel")}
							</button>
						</div>
					</form>
				)}

				{mod.artifacts.length > 0 && (
					<ul className="space-y-2">
						{mod.artifacts.map((artifact) => (
							<li
								key={artifact.id}
								data-testid={`module-artifact-${artifact.id}`}
								className="rounded-xl border border-border/50 bg-background/60 p-3 text-xs"
							>
								<details>
									<summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 list-none">
										<div className="min-w-0 flex-1 space-y-0.5">
											<span className="font-semibold text-foreground">{artifact.title}</span>
											{artifact.summary && (
												<p className="text-muted-foreground">{artifact.summary}</p>
											)}
										</div>
										<div className="flex items-center gap-2">
											<span className="text-[11px] tabular-nums text-muted-foreground">
												{formatIsoDate(artifact.updatedAt || artifact.createdAt, dateFmt)}
											</span>
											<button
												type="button"
												aria-label={t("course.syllabus.deleteNote")}
												title={t("course.syllabus.deleteNote")}
												disabled={deletingId === artifact.id}
												onClick={(e) => {
													e.preventDefault();
													e.stopPropagation();
													void handleDeleteEntry("artifact", artifact.id);
												}}
												className="cel-button cel-button-ghost min-h-7 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-destructive"
											>
												<Icon name="trash" size={12} tone={false} />
												<span className="sr-only">{t("course.syllabus.deleteNote")}</span>
											</button>
										</div>
									</summary>
									<div className="mt-2.5 border-t border-border/40 pt-2.5 whitespace-pre-wrap leading-relaxed text-foreground/90">
										{artifact.content}
									</div>
								</details>
							</li>
						))}
					</ul>
				)}
			</div>

			{mod.mistakes.length > 0 && (
				<div className="space-y-2">
					<h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
						<Icon name="warning" size={14} />
						{t("course.syllabus.recurringMistakes", { count: mod.mistakes.length })}
					</h4>
					<ul className="space-y-2">
						{mod.mistakes.map((mistake) => (
							<li
								key={mistake.id}
								className="space-y-1 rounded-xl border border-border/50 bg-background/60 p-3 text-xs"
							>
								<div className="flex flex-wrap items-center justify-between gap-2">
									<div className="flex flex-wrap items-center gap-2">
										<Link
											href={mapNodeHref(mistake.nodeId)}
											className="font-semibold text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
										>
											{mistake.nodeTitle}
										</Link>
										<span className="study-pill study-pill-warning">
											{mistake.kind === "reinforce"
												? t("course.syllabus.statusReinforce")
												: t("course.syllabus.gradeOutOf3", { grade: mistake.grade ?? 0 })}
										</span>
									</div>
									<span className="text-[11px] tabular-nums text-muted-foreground">
										{formatIsoDate(mistake.at, dateFmt)}
									</span>
								</div>
								{mistake.quizContext && (
									<div className="space-y-1 text-muted-foreground">
										<p>
											<strong className="text-foreground/90">{t("course.syllabus.question")}</strong>{" "}
											{mistake.quizContext.question}
										</p>
										<p>
											<strong className="text-foreground/90">{t("course.syllabus.yourAnswer")}</strong>{" "}
											{mistake.quizContext.answer}
										</p>
										{mistake.quizContext.expected && (
											<p>
												<strong className="text-foreground/90">{t("course.syllabus.expected")}</strong>{" "}
												{mistake.quizContext.expected}
											</p>
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
						{t("course.syllabus.misconceptionsHeading", { count: mod.misconceptions.length })}
					</h4>
					<ul className="space-y-2">
						{mod.misconceptions.map((m) => {
							const pct = Math.round(m.probability * 100);
							return (
								<li
									key={`${m.nodeId}-${m.id}`}
									className="space-y-1.5 rounded-xl border border-border/50 bg-background/60 p-3 text-xs"
								>
									<div className="flex flex-wrap items-center justify-between gap-2">
										<div className="flex flex-wrap items-center gap-2">
											<span
												className={
													m.status === "active"
														? "study-pill study-pill-warning"
														: "study-pill study-pill-success"
												}
											>
												{m.status === "active"
													? t("course.syllabus.misconceptionActive")
													: t("course.syllabus.misconceptionResolved")}
											</span>
											<Link
												href={mapNodeHref(m.nodeId)}
												className="font-semibold text-foreground underline decoration-border underline-offset-2"
											>
												{m.nodeTitle}
											</Link>
										</div>
										<span className="font-semibold tabular-nums text-foreground">
											{t("course.syllabus.misconceptionBeta", { pct })}
										</span>
									</div>
									<p className="leading-relaxed text-foreground/90">{m.text}</p>
									<progress
										className="study-progress block w-full"
										max={100}
										value={pct}
										aria-label={t("course.syllabus.misconceptionBetaAria", { pct })}
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
						{t("course.syllabus.masteredConcepts", { count: mod.masteredConcepts.length })}
					</h4>
					<ul className="grid gap-2.5 sm:grid-cols-2">
						{mod.masteredConcepts.map((concept) => (
							<li
								key={concept.nodeId}
								className="space-y-1.5 rounded-xl border border-border/50 bg-background/60 p-3 text-xs"
							>
								<div className="flex flex-wrap items-center gap-1.5">
									<Link
										href={mapNodeHref(concept.nodeId)}
										className="font-semibold text-foreground underline decoration-border underline-offset-2"
									>
										{concept.title}
									</Link>
									{concept.mastered && (
										<span className="study-pill study-pill-success">
											{t("course.syllabus.mastered")}
										</span>
									)}
									{concept.durable && (
										<span className="study-pill study-pill-info">
											{t("course.syllabus.pillDurable")}
										</span>
									)}
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
	);
});

export function SyllabusView({
	initialSyllabus,
	initialNotebook,
	domainTitle,
	initialTab = "ementa",
	initialModule,
	initialChapterId,
	initialAction,
}: SyllabusViewProps) {
	const { t, intl } = useI18n();
	const router = useRouter();
	const starterRef = useRef<SessionStarter | null>(null);
	const [tab, setTab] = useState<SyllabusTab>(initialTab);
	const [filter, setFilter] = useState<SyllabusFilter>("all");
	const [syllabus, setSyllabus] = useState<StudySyllabus>(initialSyllabus);
	const [notebook, setNotebook] = useState<DomainNotebook | null>(initialNotebook ?? null);
	const [notebookLoading, setNotebookLoading] = useState(false);
	const [notebookError, setNotebookError] = useState("");

	const handleRefresh = useCallback(() => router.refresh(), [router]);

	const refreshNotebook = useCallback(async () => {
		try {
			const res = await fetch(`/api/study/notebook?domain=${encodeURIComponent(syllabus.domainId)}`);
			const data = (await res.json().catch(() => null)) as (DomainNotebook & { error?: string }) | null;
			if (res.ok && data) setNotebook(data);
		} catch {
			// Best-effort live sync; SSR refresh still runs below.
		}
		router.refresh();
	}, [router, syllabus.domainId]);

	const decFmt = useMemo(
		() => new Intl.NumberFormat(intl, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
		[intl],
	);
	const dateFmt = useMemo(
		() => new Intl.DateTimeFormat(intl, { year: "numeric", month: "2-digit", day: "2-digit" }),
		[intl],
	);

	useEffect(() => {
		setSyllabus(initialSyllabus);
	}, [initialSyllabus]);

	useEffect(() => {
		if (initialNotebook !== undefined) setNotebook(initialNotebook);
	}, [initialNotebook]);

	// Lazily fetch the domain notebook only when the user opens the "caderno" tab
	// and the server omitted it on initial render.
	useEffect(() => {
		if (tab !== "caderno" || notebook !== null) return;
		const ctrl = new AbortController();
		setNotebookLoading(true);
		setNotebookError("");
		fetch(`/api/study/notebook?domain=${encodeURIComponent(syllabus.domainId)}`, { signal: ctrl.signal })
			.then(async (res) => {
				const data = (await res.json().catch(() => null)) as (DomainNotebook & { error?: string }) | null;
				if (!res.ok || !data) throw new Error(data?.error ?? t("common.state.loading"));
				if (!ctrl.signal.aborted) setNotebook(data);
			})
			.catch((err: unknown) => {
				if (ctrl.signal.aborted) return;
				setNotebookError(err instanceof Error ? err.message : "");
			})
			.finally(() => {
				if (!ctrl.signal.aborted) setNotebookLoading(false);
			});
		return () => ctrl.abort();
	}, [tab, notebook, syllabus.domainId, t]);

	useServerEvent("domain-changed", () => router.replace("/"));
	useServerEvent("curriculum-expanded", (event) => {
		if (event.domainId !== syllabus.domainId) return;
		if (tab === "caderno") {
			void refreshNotebook();
		} else {
			handleRefresh();
		}
	});

	const matchedInitialChapter = useMemo(() => {
		if (!initialChapterId) return undefined;
		return syllabus.chapters.find(
			(c) => c.level === initialChapterId || String(c.index) === initialChapterId,
		);
	}, [initialChapterId, syllabus.chapters]);

	const defaultOpenChapters = useMemo(() => {
		const open = new Set<number>();
		if (initialModule) {
			const owner = syllabus.chapters.find((c) => c.modules.some((m) => m.id === initialModule));
			if (owner) open.add(owner.index);
		}
		if (matchedInitialChapter) {
			open.add(matchedInitialChapter.index);
		}
		const activeChapter = syllabus.chapters.find((c) => c.active);
		if (activeChapter) open.add(activeChapter.index);
		if (open.size === 0 && syllabus.chapters[0]) open.add(syllabus.chapters[0].index);
		return open;
	}, [initialModule, matchedInitialChapter, syllabus.chapters]);

	const [openChapters, setOpenChapters] = useState<Set<number>>(defaultOpenChapters);
	const [inlinePanel, setInlinePanel] = useState<InlinePanelState>(() => {
		if (initialModule && initialAction) {
			return { scope: "module", moduleId: initialModule, kind: initialAction };
		}
		if (matchedInitialChapter && initialAction === "prova") {
			return { scope: "chapter", chapterLevel: matchedInitialChapter.level };
		}
		return null;
	});
	const [openFlippedNodeId, setOpenFlippedNodeId] = useState<string | null>(null);
	const [startingNodeId, setStartingNodeId] = useState<string | null>(null);
	const startingNodeIdRef = useRef<string | null>(null);
	startingNodeIdRef.current = startingNodeId;
	const [launchError, setLaunchError] = useState("");

	const [exportBusy, setExportBusy] = useState<FlashcardExportMode | null>(null);
	const [exportStatus, setExportStatus] = useState<{ ok: boolean; text: string } | null>(null);

	const completedHours =
		syllabus.completedLessonHours ??
		Math.max(0, Math.round((syllabus.totalHours - syllabus.remainingHours) * 100) / 100);
	const studiedHours = syllabus.studiedHours ?? 0;
	const studiedLabel =
		studiedHours > 0
			? studiedHours < 1
				? `${Math.max(1, Math.round(studiedHours * 60))} min`
				: `${decFmt.format(studiedHours)} h`
			: null;
	const overallPct =
		syllabus.totalLessons > 0 ? Math.round((100 * syllabus.completedLessons) / syllabus.totalLessons) : 0;
	const { schedule } = syllabus;
	const reviewReservePct = Math.round(schedule.reviewReserveShare * 100);

	const toggleChapter = useCallback((chapterIndex: number) => {
		setOpenChapters((prev) => {
			const next = new Set(prev);
			if (next.has(chapterIndex)) next.delete(chapterIndex);
			else next.add(chapterIndex);
			return next;
		});
	}, []);

	const handleFilterChange = useCallback(
		(nextFilter: SyllabusFilter) => {
			setFilter(nextFilter);
			if (nextFilter === "all") return;
			const matching = syllabus.chapters.filter(
				(chapter) =>
					chapter.modules.some((mod) => moduleMatchesFilter(mod, nextFilter)) ||
					(nextFilter === "exams" && Boolean(chapter.examUnlocked)),
			);
			// Open the active chapter + first 2 matching chapters instead of forcing
			// every chapter open simultaneously; users can still expand any chapter.
			const nextOpen = new Set<number>();
			const activeMatch = matching.find((c) => c.active);
			if (activeMatch) nextOpen.add(activeMatch.index);
			for (const c of matching.slice(0, 2)) nextOpen.add(c.index);
			setOpenChapters(nextOpen);
		},
		[syllabus.chapters],
	);

	const toggleChapterExam = useCallback((chapterLevel: string) => {
		setInlinePanel((curr) =>
			curr?.scope === "chapter" && curr.chapterLevel === chapterLevel
				? null
				: { scope: "chapter", chapterLevel },
		);
	}, []);

	const toggleModulePanel = useCallback((moduleId: string, kind: "prova" | "lista") => {
		setInlinePanel((curr) =>
			curr?.scope === "module" && curr.moduleId === moduleId && curr.kind === kind
				? null
				: { scope: "module", moduleId, kind },
		);
	}, []);

	const closeInlinePanel = useCallback(() => setInlinePanel(null), []);
	const toggleFlippedNode = useCallback(
		(lessonId: string) => setOpenFlippedNodeId((curr) => (curr === lessonId ? null : lessonId)),
		[],
	);
	const closeFlippedNode = useCallback(() => setOpenFlippedNodeId(null), []);

	const startLessonForNode = useCallback(
		async (lesson: SyllabusLesson, preReadingNote?: string) => {
			if (startingNodeIdRef.current) return;
			setStartingNodeId(lesson.id);
			setLaunchError("");
			try {
				const endpoint =
					"/api/study/materials?" +
					new URLSearchParams({
						domain: syllabus.domainId,
						node: lesson.id,
						lesson: "1",
					});
				const res = await fetch(endpoint);
				const detail = (await res.json().catch(() => null)) as LessonLookupResponse | null;
				if (!res.ok || !detail?.brief) {
					throw new Error(detail?.error ?? t("course.syllabus.errPrepareLesson"));
				}
				// Locked node: resume existing exploration session instead of spawning duplicates.
				if (lesson.status === "locked" && detail.explorationId && !preReadingNote) {
					router.push(`/chat/${encodeURIComponent(detail.explorationId)}`);
					return;
				}
				// Non-locked node: resume active in-progress session (never a concluded chat) when no fresh pre-reading note was appended.
				const activeId = detail.activeSessionId ?? detail.sessionId;
				if (lesson.status !== "locked" && activeId && !preReadingNote) {
					router.push(`/chat/${encodeURIComponent(activeId)}`);
					return;
				}
				const minutes = Math.max(5, Math.round(detail.minutes ?? lesson.minutes));
				const baseStatement = lessonStatement(detail.brief, minutes);
				const statement = preReadingNote ? `${baseStatement}\n\n${preReadingNote}` : baseStatement;
				const opening = preReadingNote ? `${lesson.title}\n\n${preReadingNote}` : lesson.title;
				starterRef.current ??= new SessionStarter();
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
				setLaunchError(err instanceof Error ? err.message : t("course.syllabus.errStartLesson"));
				setStartingNodeId(null);
			}
		},
		[router, syllabus.domainId, t],
	);

	const openPastLessonForNode = useCallback(
		async (lesson: SyllabusLesson) => {
			if (startingNodeIdRef.current) return;
			setStartingNodeId(`past:${lesson.id}`);
			setLaunchError("");
			try {
				const endpoint =
					"/api/study/materials?" +
					new URLSearchParams({
						domain: syllabus.domainId,
						node: lesson.id,
						lesson: "1",
					});
				const res = await fetch(endpoint);
				const detail = (await res.json().catch(() => null)) as LessonLookupResponse | null;
				if (!res.ok) {
					throw new Error(detail?.error ?? t("course.syllabus.errPrepareLesson"));
				}
				if (detail?.completedSessionId) {
					router.push(`/chat/${encodeURIComponent(detail.completedSessionId)}`);
					return;
				}
				setLaunchError(t("course.syllabus.noPastLesson"));
				setStartingNodeId(null);
			} catch (err) {
				setLaunchError(err instanceof Error ? err.message : t("course.syllabus.errPrepareLesson"));
				setStartingNodeId(null);
			}
		},
		[router, syllabus.domainId, t],
	);

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
				throw new Error(data?.error ?? t("course.syllabus.exportErr"));
			}
			setExportStatus({ ok: true, text: formatExportMessage(t, mode, data ?? {}) });
		} catch (err) {
			setExportStatus({
				ok: false,
				text: err instanceof Error ? err.message : t("course.syllabus.exportErr"),
			});
		} finally {
			setExportBusy(null);
		}
	};

	const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		const idx = TAB_DEFS.findIndex((item) => item.id === tab);
		if (event.key === "ArrowRight") {
			event.preventDefault();
			const next = TAB_DEFS[(idx + 1) % TAB_DEFS.length]!;
			setTab(next.id);
		} else if (event.key === "ArrowLeft") {
			event.preventDefault();
			const prev = TAB_DEFS[(idx - 1 + TAB_DEFS.length) % TAB_DEFS.length]!;
			setTab(prev.id);
		}
	};

	const filteredChapters = useMemo(() => {
		return syllabus.chapters
			.map((chapter) => ({
				...chapter,
				modules: chapter.modules.filter((mod) => moduleMatchesFilter(mod, filter)),
			}))
			.filter((chapter) => filter === "all" || chapter.modules.length > 0 || (filter === "exams" && Boolean(chapter.examUnlocked)));
	}, [filter, syllabus.chapters]);

	const mapDomainHref = `/mapa?dominio=${encodeURIComponent(syllabus.domainId)}`;
	const mapNodeHref = useCallback(
		(nodeId: string) => `/mapa?dominio=${encodeURIComponent(syllabus.domainId)}&no=${encodeURIComponent(nodeId)}`,
		[syllabus.domainId],
	);

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
							{t("course.syllabus.backToday")}
						</Link>
						<div className="flex flex-wrap items-center gap-2">
							<Link href={mapDomainHref} className="cel-button min-h-9 px-3 py-1.5 text-xs">
								<Icon name="map" size={14} tone={false} />
								{t("course.syllabus.exploreTree")}
							</Link>
							<Link
								href="/profile"
								className="cel-button cel-button-ghost min-h-9 px-3 py-1.5 text-xs"
							>
								<Icon name="profile" size={14} tone={false} />
								{t("course.syllabus.profileTranscript")}
							</Link>
						</div>
					</div>

					<div className="flex flex-wrap items-end justify-between gap-3">
						<div className="space-y-1">
							<h1 className="cel-display text-2xl leading-tight sm:text-3xl">
								{t("course.syllabus.title", { domain: domainTitle })}
							</h1>
							<p className="text-xs text-muted-foreground tabular-nums">
								{t("course.syllabus.headerSummary", {
									completed: syllabus.completedLessons,
									total: syllabus.totalLessons,
									pct: overallPct,
									completedHours: decFmt.format(completedHours),
									totalHours: decFmt.format(syllabus.totalHours),
								})}
								{studiedLabel ? t("course.syllabus.headerStudied", { studied: studiedLabel }) : ""}
							</p>
						</div>

						<div
							role="tablist"
							aria-label={t("course.syllabus.sectionsAria")}
							onKeyDown={handleTabKeyDown}
							className="flex flex-wrap gap-1.5"
						>
							{TAB_DEFS.map((item) => {
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
										{tabLabel(t, item.id)}
									</button>
								);
							})}
						</div>
					</div>
				</header>

				{launchError && (
					<div
						role="alert"
						className="cel-card flex items-center justify-between gap-3 border-destructive/40 px-4 py-3 text-sm text-destructive"
					>
						<span>{launchError}</span>
						<button
							type="button"
							aria-label={t("course.syllabus.dismissAlert")}
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
						<section
							aria-label={t("course.syllabus.scheduleAria")}
							data-testid="syllabus-schedule-card"
							className="cel-card space-y-3.5 p-4 sm:p-5"
						>
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div className="flex items-center gap-2">
									<Icon name="calendar" size={18} />
									<h2 className="cel-display text-lg leading-tight">{t("course.syllabus.scheduleTitle")}</h2>
								</div>
								<span className="study-pill study-pill-info tabular-nums">
									{schedule.paceSource === "observed"
										? t("course.syllabus.paceObserved")
										: t("course.syllabus.pacePlanned")}
								</span>
							</div>

							<div className="space-y-1.5">
								<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums">
									<span>
										{t("course.syllabus.scheduleCompletedRemaining", {
											completedHours: decFmt.format(completedHours),
											remainingHours: decFmt.format(syllabus.remainingHours),
										})}
										{studiedLabel ? t("course.syllabus.scheduleStudied", { studied: studiedLabel }) : ""}
									</span>
									<span>{t("course.syllabus.lessonsPct", { pct: overallPct })}</span>
								</div>
								<progress
									className="study-progress block w-full"
									max={Math.max(1, syllabus.totalLessons)}
									value={syllabus.completedLessons}
									aria-label={t("course.syllabus.overallProgressAria", { pct: overallPct })}
								/>
							</div>

							<dl className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
								<div className="rounded-xl border border-border/50 bg-background/60 p-3">
									<dt className="text-xs text-muted-foreground">{t("course.syllabus.forecast")}</dt>
									<dd className="cel-display mt-1 text-base tabular-nums">
										{syllabus.remainingHours <= 0
											? t("course.syllabus.statusCompleted")
											: t("course.syllabus.weeksRange", {
												p50: decFmt.format(schedule.weeksToFinish),
												p80: decFmt.format(schedule.weeksToFinishP80),
											})}
									</dd>
									{syllabus.remainingHours > 0 && (
										<p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
											{t("course.syllabus.dateRange", {
												start: formatIsoDate(schedule.estimatedCompletionDate, dateFmt),
												end: formatIsoDate(schedule.estimatedCompletionDateP80, dateFmt),
											})}
										</p>
									)}
								</div>

								<div className="rounded-xl border border-border/50 bg-background/60 p-3">
									<dt className="text-xs text-muted-foreground">{t("course.syllabus.weeklyPace")}</dt>
									<dd className="cel-display mt-1 text-base tabular-nums">
										{t("course.syllabus.hoursPerWeek", { hours: decFmt.format(schedule.effectiveWeeklyHours) })}
									</dd>
									<p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
										{t("course.syllabus.paceBreakdown", {
											observed: decFmt.format(schedule.weeklyHoursObserved),
											planned: decFmt.format(schedule.weeklyHoursPlanned),
										})}
									</p>
								</div>

								<div className="rounded-xl border border-border/50 bg-background/60 p-3">
									<dt className="text-xs text-muted-foreground">{t("course.syllabus.reviewReserve")}</dt>
									<dd className="cel-display mt-1 text-base tabular-nums">{reviewReservePct}% FSRS</dd>
									<p className="mt-0.5 text-[11px] text-muted-foreground">
										{t("course.syllabus.reviewReserveDesc")}
									</p>
								</div>

								<div className="rounded-xl border border-border/50 bg-background/60 p-3">
									<dt className="text-xs text-muted-foreground">{t("course.syllabus.currentChapter")}</dt>
									<dd className="cel-display mt-1 text-base tabular-nums">
										{schedule.activeChapterWeeks <= 0
											? t("course.syllabus.statusCompleted")
											: t("course.syllabus.weeksApprox", { weeks: decFmt.format(schedule.activeChapterWeeks) })}
									</dd>
									<p className="mt-0.5 text-[11px] text-muted-foreground">
										{syllabus.activeChapterIndex !== null
											? syllabus.chapters[syllabus.activeChapterIndex]?.level ?? t("course.syllabus.inProgress")
											: t("course.syllabus.allChaptersDone")}
									</p>
								</div>
							</dl>
						</section>

						<div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("course.syllabus.filterAria")}>
							{FILTER_IDS.map((item) => (
								<button
									key={item}
									type="button"
									aria-pressed={filter === item}
									className="cel-chip min-h-8 cursor-pointer px-3 py-1 text-xs"
									onClick={() => handleFilterChange(item)}
								>
									{filterLabel(t, item)}
								</button>
							))}
						</div>

						{filteredChapters.length === 0 ? (
							<section className="cel-card p-5 text-sm text-muted-foreground">
								{t("course.syllabus.emptyFilter")}
							</section>
						) : (
							<div className="space-y-3.5">
								{filteredChapters.map((chapter) => {
									const isOpen = openChapters.has(chapter.index);
									const chapterExamOpen =
										inlinePanel?.scope === "chapter" && inlinePanel.chapterLevel === chapter.level;
									const chapterInlineModulePanel =
										inlinePanel?.scope === "module" && chapter.modules.some((m) => m.id === inlinePanel.moduleId)
											? { moduleId: inlinePanel.moduleId, kind: inlinePanel.kind }
											: null;
									const chapterFlippedNodeId =
										openFlippedNodeId &&
										chapter.modules.some((m) => m.lessons.some((l) => l.id === openFlippedNodeId))
											? openFlippedNodeId
											: null;
									const chapterStartingNodeId =
										startingNodeId &&
										chapter.modules.some((m) =>
											m.lessons.some((l) => startingNodeId === l.id || startingNodeId === `past:${l.id}`),
										)
											? startingNodeId
											: null;
									return (
										<SyllabusChapterCard
											key={`${chapter.level}-${chapter.index}`}
											domainId={syllabus.domainId}
											chapter={chapter}
											isOpen={isOpen}
											chapterExamOpen={chapterExamOpen}
											activeModuleId={syllabus.activeModuleId}
											chapterInlineModulePanel={chapterInlineModulePanel}
											chapterFlippedNodeId={chapterFlippedNodeId}
											chapterStartingNodeId={chapterStartingNodeId}
											anyStarting={Boolean(startingNodeId)}
											filter={filter}
											decFmt={decFmt}
											dateFmt={dateFmt}
											t={t}
											onToggleChapter={toggleChapter}
											onToggleChapterExam={toggleChapterExam}
											onToggleModulePanel={toggleModulePanel}
											onCloseInlinePanel={closeInlinePanel}
											onRefresh={handleRefresh}
											onToggleFlipped={toggleFlippedNode}
											onCloseFlipped={closeFlippedNode}
											onOpenPast={openPastLessonForNode}
											onStartLesson={startLessonForNode}
										/>
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
						{!notebook ? (
							<section className="cel-card p-5 text-sm text-muted-foreground" aria-busy={notebookLoading}>
								{notebookError ? (
									<p role="alert" className="text-destructive">{notebookError}</p>
								) : (
									<p role="status" className="flex items-center gap-2">
										<Icon name="loader" size={16} live />
										{t("common.state.loading")}
									</p>
								)}
							</section>
						) : (
							<>
								<section aria-label={t("course.syllabus.exportAria")} className="cel-card space-y-3 p-4 sm:p-5">
									<div className="flex flex-wrap items-start justify-between gap-3">
										<div className="space-y-0.5">
											<div className="flex items-center gap-2">
												<Icon name="export-cards" size={18} />
												<h2 className="cel-display text-lg leading-tight">
													{t("course.syllabus.exportFlashcards")}
												</h2>
											</div>
											<p className="text-xs text-muted-foreground">
												{t("course.syllabus.exportDesc", { domain: domainTitle })}
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
												{exportBusy === "obsidian" ? t("course.syllabus.exporting") : "Obsidian"}
											</button>
											<button
												type="button"
												data-testid="export-anki"
												className="cel-button min-h-9 px-3 py-1.5 text-xs"
												disabled={Boolean(exportBusy)}
												onClick={() => void handleExportFlashcards("anki")}
											>
												<Icon name="flashcard" size={14} tone={false} />
												{exportBusy === "anki" ? t("course.syllabus.exporting") : "Anki"}
											</button>
											<button
												type="button"
												data-testid="export-apkg"
												className="cel-button cel-button-primary min-h-9 px-3 py-1.5 text-xs"
												disabled={Boolean(exportBusy)}
												onClick={() => void handleExportFlashcards("apkg")}
											>
												<Icon name="download" size={14} tone={false} />
												{exportBusy === "apkg" ? t("course.syllabus.generating") : ".apkg"}
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

									<dl className="grid grid-cols-2 gap-2.5 border-t border-border/45 pt-3 sm:grid-cols-3 lg:grid-cols-6">
										<div className="rounded-xl border border-border/45 bg-background/60 p-2.5">
											<dt className="text-[11px] text-muted-foreground">
												{t("course.syllabus.recordedMistakes")}
											</dt>
											<dd className="cel-display mt-0.5 text-lg tabular-nums">{notebook.totalMistakes}</dd>
										</div>
										<div className="rounded-xl border border-border/45 bg-background/60 p-2.5">
											<dt className="text-[11px] text-muted-foreground">
												{t("course.syllabus.activeMisconceptions")}
											</dt>
											<dd className="cel-display mt-0.5 text-lg tabular-nums">{notebook.activeMisconceptions}</dd>
										</div>
										<div className="rounded-xl border border-border/45 bg-background/60 p-2.5">
											<dt className="text-[11px] text-muted-foreground">
												{t("course.syllabus.overcomeMisconceptions")}
											</dt>
											<dd className="cel-display mt-0.5 text-lg tabular-nums">
												{notebook.resolvedMisconceptions}
											</dd>
										</div>
										<div className="rounded-xl border border-border/45 bg-background/60 p-2.5">
											<dt className="text-[11px] text-muted-foreground">
												{t("course.syllabus.consolidatedConcepts")}
											</dt>
											<dd className="cel-display mt-0.5 text-lg tabular-nums">
												{notebook.totalMasteredConcepts}
											</dd>
										</div>
										<div className="rounded-xl border border-border/45 bg-background/60 p-2.5">
											<dt className="text-[11px] text-muted-foreground">
												{t("course.syllabus.savedNotesKpi")}
											</dt>
											<dd className="cel-display mt-0.5 text-lg tabular-nums">
												{notebook.totalSavedNotes}
											</dd>
										</div>
										<div className="rounded-xl border border-border/45 bg-background/60 p-2.5">
											<dt className="text-[11px] text-muted-foreground">
												{t("course.syllabus.artifactsKpi")}
											</dt>
											<dd className="cel-display mt-0.5 text-lg tabular-nums">
												{notebook.totalArtifacts}
											</dd>
										</div>
									</dl>
								</section>

								{notebook.modules.length === 0 ? (
									<section className="cel-card p-5 text-sm leading-relaxed text-muted-foreground">
										{t("course.syllabus.notebookEmpty")}
									</section>
								) : (
									<div className="space-y-4">
										{notebook.modules.map((mod) => (
											<NotebookModuleCard
												key={mod.moduleId}
												domainId={syllabus.domainId}
												mod={mod}
												dateFmt={dateFmt}
												t={t}
												mapNodeHref={mapNodeHref}
												onNotebookChanged={refreshNotebook}
											/>
										))}
									</div>
								)}
							</>
						)}
					</div>
				)}

				{tab === "nivelamento" && (
					<div
						id="syllabus-panel-nivelamento"
						role="tabpanel"
						aria-labelledby="syllabus-tab-nivelamento"
					>
						<PlacementDialog domainId={syllabus.domainId} onCompleted={handleRefresh} />
					</div>
				)}
			</div>
		</main>
	);
}
