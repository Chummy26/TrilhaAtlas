"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/icon";
import { useI18n, useT } from "@/components/i18n";
import { useServerEvent } from "@/components/server-events";
import {
	buildCourseOutline,
	type CourseOutlineLesson,
	type CourseOutlineModule,
	type StudyNodeBrief,
	type StudySyllabus,
	type SyllabusLesson,
} from "@/src/core";
import { SessionStarter, studyLessonRequest } from "../start-session.ts";
import { lessonStatement } from "./lesson-statement.ts";

export interface LessonCourseDrawerProps {
	domainId: string;
	activeNodeId: string;
	open: boolean;
	onClose: () => void;
}

interface LessonLookupResponse {
	brief?: StudyNodeBrief;
	minutes?: number;
	sessionId?: string;
	activeSessionId?: string;
	explorationId?: string;
	error?: string;
}

interface StartLessonTarget {
	id: string;
	title: string;
	minutes: number;
	status: SyllabusLesson["status"];
}

const STATUS_MARKER: Record<SyllabusLesson["status"], string> = {
	done: "✓",
	"in-progress": "▶",
	available: "○",
	locked: "·",
};

function statusMarkerClass(status: SyllabusLesson["status"], isCurrent: boolean): string {
	if (status === "done") {
		return "border-[var(--cel-success,var(--lh-success))]/60 bg-[var(--cel-success,var(--lh-success))]/15 text-[var(--cel-success-text,var(--lh-success))]";
	}
	if (isCurrent || status === "in-progress") {
		return "border-[var(--cel-accent,var(--primary))]/70 bg-[var(--cel-accent,var(--primary))]/15 text-foreground";
	}
	if (status === "available") {
		return "border-border bg-background text-muted-foreground";
	}
	return "border-border/50 bg-background/50 text-muted-foreground/60";
}

function moduleSyllabusHref(domainId: string, moduleId: string, action?: "lista" | "prova"): string {
	const params = new URLSearchParams({ dominio: domainId, modulo: moduleId });
	if (action) params.set("acao", action);
	return `/ementa?${params.toString()}`;
}

export const LessonCourseDrawer = memo(function LessonCourseDrawer({
	domainId,
	activeNodeId,
	open,
	onClose,
}: LessonCourseDrawerProps) {
	const router = useRouter();
	const { t, intl } = useI18n();

	const [syllabus, setSyllabus] = useState<StudySyllabus | null>(null);
	const [loading, setLoading] = useState(false);
	const [loadError, setLoadError] = useState("");
	const [refreshSeq, setRefreshSeq] = useState(0);

	const [selectedChapterIdx, setSelectedChapterIdx] = useState(0);
	const [expandedModules, setExpandedModules] = useState<Set<string>>(() => new Set());
	const [startingNodeId, setStartingNodeId] = useState<string | null>(null);
	const [launchError, setLaunchError] = useState("");

	const startingNodeIdRef = useRef<string | null>(null);
	startingNodeIdRef.current = startingNodeId;
	const starterRef = useRef<SessionStarter | null>(null);
	const fetchedKeyRef = useRef<string | null>(null);

	const decFmt = useMemo(
		() => new Intl.NumberFormat(intl, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
		[intl],
	);

	// Reset in-flight launch indicator when navigating to a different lesson.
	useEffect(() => {
		setStartingNodeId(null);
		setLaunchError("");
	}, [activeNodeId, domainId]);

	// Lazy-load syllabus on first open, on domain change, or when explicitly refreshed.
	useEffect(() => {
		if (!open) return;
		const requestKey = `${domainId}#${refreshSeq}`;
		if (fetchedKeyRef.current === requestKey && syllabus?.domainId === domainId) return;

		const ctrl = new AbortController();
		setLoading(true);
		setLoadError("");
		fetch(`/api/study/syllabus?domain=${encodeURIComponent(domainId)}`, { signal: ctrl.signal })
			.then(async (res) => {
				const data = (await res.json().catch(() => null)) as (StudySyllabus & { error?: string }) | null;
				if (!res.ok || !data || !Array.isArray(data.chapters)) {
					throw new Error(data?.error ?? t("lesson.drawer.loadError"));
				}
				if (!ctrl.signal.aborted) {
					fetchedKeyRef.current = requestKey;
					setSyllabus(data);
				}
			})
			.catch((err: unknown) => {
				if (ctrl.signal.aborted) return;
				setLoadError(err instanceof Error && err.message ? err.message : t("lesson.drawer.loadError"));
			})
			.finally(() => {
				if (!ctrl.signal.aborted) setLoading(false);
			});

		return () => ctrl.abort();
	}, [open, domainId, refreshSeq, syllabus?.domainId, t]);

	// Refresh outline when the curriculum expands for this domain.
	useServerEvent("curriculum-expanded", (event) => {
		if (event.domainId !== domainId) return;
		fetchedKeyRef.current = null;
		if (open) {
			setRefreshSeq((n) => n + 1);
		}
	});

	// Close drawer on Escape when open.
	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onClose();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [open, onClose]);

	const outline = useMemo(
		() => (syllabus && syllabus.domainId === domainId ? buildCourseOutline(syllabus, activeNodeId) : null),
		[syllabus, domainId, activeNodeId],
	);

	// Sync selected chapter and auto-expand the active module whenever the outline or active lesson updates.
	useEffect(() => {
		if (!outline) return;
		setSelectedChapterIdx(outline.activeChapterIndex);
		if (outline.activeModuleId) {
			setExpandedModules((prev) => {
				if (prev.has(outline.activeModuleId!)) return prev;
				const next = new Set(prev);
				next.add(outline.activeModuleId!);
				return next;
			});
		}
	}, [outline?.activeChapterIndex, outline?.activeModuleId]);

	const toggleModule = useCallback((moduleId: string) => {
		setExpandedModules((prev) => {
			const next = new Set(prev);
			if (next.has(moduleId)) next.delete(moduleId);
			else next.add(moduleId);
			return next;
		});
	}, []);

	const selectChapter = useCallback(
		(chapterIdx: number) => {
			setSelectedChapterIdx(chapterIdx);
			const chapter = outline?.chapters[chapterIdx];
			if (!chapter) return;
			const targetMod = chapter.modules.find((m) => m.isActive) ?? chapter.modules[0];
			if (!targetMod) return;
			setExpandedModules((prev) => {
				if (chapter.modules.some((m) => prev.has(m.id))) return prev;
				const next = new Set(prev);
				next.add(targetMod.id);
				return next;
			});
		},
		[outline],
	);

	const retryLoad = useCallback(() => {
		fetchedKeyRef.current = null;
		setRefreshSeq((n) => n + 1);
	}, []);

	const startLesson = useCallback(
		async (lesson: StartLessonTarget) => {
			if (startingNodeIdRef.current || lesson.id === activeNodeId) return;
			setStartingNodeId(lesson.id);
			setLaunchError("");
			try {
				const endpoint =
					"/api/study/materials?" +
					new URLSearchParams({
						domain: domainId,
						node: lesson.id,
						lesson: "1",
					});
				const res = await fetch(endpoint);
				const detail = (await res.json().catch(() => null)) as LessonLookupResponse | null;
				if (!res.ok || !detail?.brief) {
					throw new Error(detail?.error ?? t("lesson.drawer.errStart"));
				}
				// Locked node: resume existing exploration session instead of spawning duplicates.
				if (lesson.status === "locked" && detail.explorationId) {
					router.push(`/chat/${encodeURIComponent(detail.explorationId)}`);
					return;
				}
				// Non-locked node: resume active in-progress session when one exists.
				const activeId = detail.activeSessionId ?? detail.sessionId;
				if (lesson.status !== "locked" && activeId) {
					router.push(`/chat/${encodeURIComponent(activeId)}`);
					return;
				}
				const minutes = Math.max(5, Math.round(detail.minutes ?? lesson.minutes));
				const statement = lessonStatement(detail.brief, minutes);
				starterRef.current ??= new SessionStarter();
				const target = await starterRef.current.start(
					studyLessonRequest({
						domainId,
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
					lesson.title,
				);
				router.push(target);
			} catch (err) {
				setLaunchError(err instanceof Error && err.message ? err.message : t("lesson.drawer.errStart"));
				setStartingNodeId(null);
			}
		},
		[activeNodeId, domainId, router, t],
	);

	if (!open) return null;

	const activeChapter = outline?.chapters[selectedChapterIdx] ?? outline?.chapters[0] ?? null;
	const fullSyllabusHref = `/ementa?dominio=${encodeURIComponent(domainId)}`;

	return (
		<aside
			aria-label={t("lesson.drawer.aria")}
			data-testid="lesson-course-drawer"
			className="lh-no-drag flex h-full w-80 shrink-0 flex-col border-l border-border bg-card text-foreground sm:w-[22rem]"
		>
			<header className="shrink-0 space-y-2 border-b border-border/70 px-3.5 py-3">
				<div className="flex items-center justify-between gap-2">
					<div className="flex min-w-0 items-center gap-2">
						<Icon name="list-tree" size={16} tone={false} className="shrink-0 text-muted-foreground" />
						<h2 className="cel-display truncate text-sm font-semibold">{t("lesson.drawer.title")}</h2>
					</div>
					<div className="flex shrink-0 items-center gap-1.5">
						<Link
							href={fullSyllabusHref}
							className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
						>
							{t("lesson.drawer.openSyllabus")}
						</Link>
						<button
							type="button"
							onClick={onClose}
							aria-label={t("lesson.drawer.closeAria")}
							className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						>
							<Icon name="close" size={15} tone={false} />
						</button>
					</div>
				</div>

				{outline && outline.chapters.length > 1 && (
					<div className="flex flex-wrap gap-1" role="tablist" aria-label={t("lesson.drawer.title")}>
						{outline.chapters.map((ch, cIdx) => {
							const selected = cIdx === selectedChapterIdx;
							return (
								<button
									key={`${ch.level}-${ch.index}`}
									type="button"
									role="tab"
									aria-selected={selected}
									onClick={() => selectChapter(cIdx)}
									className={`cursor-pointer rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
										selected
											? "border-[var(--cel-accent,var(--primary))]/60 bg-[var(--cel-accent,var(--primary))]/15 text-foreground"
											: "border-border/60 bg-background/60 text-muted-foreground hover:border-border hover:text-foreground"
									}`}
								>
									{t("lesson.drawer.chapterLabel", { index: ch.index, level: ch.level })}
								</button>
							);
						})}
					</div>
				)}
			</header>

			<div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
				{launchError && (
					<div
						role="alert"
						className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
					>
						{launchError}
					</div>
				)}

				{loading && !outline && (
					<div className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/50 px-3 py-4 text-xs text-muted-foreground">
						<Icon name="loader" size={15} tone={false} className="shrink-0" />
						<span>{t("lesson.drawer.loading")}</span>
					</div>
				)}

				{loadError && !outline && (
					<div className="space-y-2 rounded-lg border border-border/70 bg-background/60 p-3 text-xs">
						<p className="text-destructive">{loadError || t("lesson.drawer.loadError")}</p>
						<button type="button" onClick={retryLoad} className="cel-button px-2.5 py-1 text-xs">
							{t("lesson.drawer.retry")}
						</button>
					</div>
				)}

				{outline?.nextUp && (
					<div
						data-testid="drawer-next-up"
						className="rounded-xl border border-[var(--cel-accent,var(--primary))]/40 bg-[var(--cel-accent,var(--primary))]/8 p-2.5"
					>
						<div className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
							<span>{t("lesson.drawer.nextUpLabel")}</span>
							<span className="tabular-nums">
								{t("lesson.drawer.minutesShort", { min: outline.nextUp.minutes })}
							</span>
						</div>
						<button
							type="button"
							disabled={startingNodeId !== null}
							onClick={() =>
								void startLesson({
									id: outline.nextUp!.nodeId,
									title: outline.nextUp!.title,
									minutes: outline.nextUp!.minutes,
									status: outline.nextUp!.status,
								})
							}
							className="mt-1 flex w-full cursor-pointer items-center justify-between gap-2 text-left text-xs font-medium text-foreground hover:underline disabled:cursor-wait disabled:opacity-60"
						>
							<span className="min-w-0 flex-1 truncate">
								{startingNodeId === outline.nextUp.nodeId
									? t("lesson.drawer.starting")
									: outline.nextUp.title}
							</span>
							<Icon name="arrow-right" size={14} tone={false} className="shrink-0" />
						</button>
					</div>
				)}

				{activeChapter && (
					<div className="space-y-2">
						{activeChapter.modules.map((mod) => (
							<DrawerModuleSection
								key={mod.id}
								domainId={domainId}
								mod={mod}
								expanded={expandedModules.has(mod.id)}
								startingNodeId={startingNodeId}
								decFmt={decFmt}
								onToggle={() => toggleModule(mod.id)}
								onStartLesson={startLesson}
							/>
						))}
					</div>
				)}
			</div>
		</aside>
	);
});

interface DrawerModuleSectionProps {
	domainId: string;
	mod: CourseOutlineModule;
	expanded: boolean;
	startingNodeId: string | null;
	decFmt: Intl.NumberFormat;
	onToggle: () => void;
	onStartLesson: (lesson: StartLessonTarget) => Promise<void>;
}

const DrawerModuleSection = memo(function DrawerModuleSection({
	domainId,
	mod,
	expanded,
	startingNodeId,
	decFmt,
	onToggle,
	onStartLesson,
}: DrawerModuleSectionProps) {
	const t = useT();
	const modHref = moduleSyllabusHref(domainId, mod.id);
	const showRetentionAlert = mod.avgRetention !== null && mod.avgRetention < 0.85;

	return (
		<section
			data-testid={`drawer-module-${mod.id}`}
			className={`overflow-hidden rounded-xl border transition-colors ${
				mod.isActive ? "border-[var(--cel-accent,var(--primary))]/50 bg-background/70" : "border-border/65 bg-background/40"
			}`}
		>
			<button
				type="button"
				aria-expanded={expanded}
				onClick={onToggle}
				className="flex w-full cursor-pointer items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-accent/40"
			>
				<Icon
					name={expanded ? "chevron-down" : "chevron-right"}
					size={15}
					tone={false}
					className="mt-0.5 shrink-0 text-muted-foreground"
				/>
				<div className="min-w-0 flex-1 space-y-1">
					<div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
						<span className="font-medium">
							{t("lesson.drawer.moduleLabel", { index: mod.index })}
						</span>
						<span className="tabular-nums">
							{t("lesson.drawer.moduleProgress", { completed: mod.completed, total: mod.total })}
						</span>
					</div>
					<div className="text-xs font-semibold leading-snug text-foreground">{mod.title}</div>
					<div className="h-1 w-full overflow-hidden rounded-full bg-border/50" aria-hidden="true">
						<div
							className="h-full rounded-full bg-[var(--cel-accent,var(--primary))]"
							style={{ width: `${Math.min(100, Math.max(0, mod.percent))}%` }}
						/>
					</div>
					{showRetentionAlert && mod.avgRetention !== null && (
						<div className="pt-0.5">
							<span className="study-pill study-pill-warning tabular-nums text-[10px]">
								{t("lesson.drawer.retentionAlert", { pct: Math.round(mod.avgRetention * 100) })}
							</span>
						</div>
					)}
				</div>
			</button>

			{expanded && (
				<div className="border-t border-border/50 px-2 pb-2.5 pt-2">
					<div className="space-y-2.5">
						{mod.groups.map((group, groupIdx) => (
							<div
								key={group.id}
								className={groupIdx > 0 ? "border-t border-border/40 pt-2" : undefined}
							>
								{group.title && (
									<h3 className="px-1.5 pb-1 text-[11px] font-semibold tracking-tight text-foreground/90">
										{group.title}
									</h3>
								)}
								<ul className="space-y-1">
									{group.lessons.map((lesson) => (
										<DrawerLessonRow
											key={lesson.id}
											lesson={lesson}
											moduleHref={modHref}
											isStarting={startingNodeId === lesson.id}
											busy={startingNodeId !== null}
											onStart={() =>
												void onStartLesson({
													id: lesson.id,
													title: lesson.title,
													minutes: lesson.minutes,
													status: lesson.status,
												})
											}
										/>
									))}
								</ul>
							</div>
						))}
					</div>

					<p className="px-1.5 pt-2 text-[10px] leading-snug text-muted-foreground">
						{t("lesson.drawer.optionalNote")}
					</p>

					<div className="mt-2 space-y-1 border-t border-border/50 pt-2">
						{mod.milestones.map((milestone) => {
							const href = moduleSyllabusHref(domainId, mod.id, milestone.hrefAction);
							const label =
								milestone.kind === "problem-set"
									? t("lesson.drawer.stepProblemSet")
									: t("lesson.drawer.stepExam");
							const iconName = milestone.kind === "problem-set" ? "activity" : "exercise";
							const muted = !milestone.unlocked && milestone.score === undefined;

							return (
								<Link
									key={milestone.kind}
									href={href}
									className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-accent/55 ${
										muted ? "text-muted-foreground/75" : "text-foreground"
									}`}
								>
									<span className="flex min-w-0 items-center gap-2">
										<Icon name={iconName} size={13} tone={false} className="shrink-0 text-muted-foreground" />
										<span className="truncate font-medium">{label}</span>
										<span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
											· {t("lesson.drawer.minutesShort", { min: milestone.minutes })}
										</span>
									</span>
									{milestone.score !== undefined ? (
										<span
											className={
												milestone.passed
													? "study-pill study-pill-success shrink-0 tabular-nums text-[10px]"
													: "study-pill study-pill-warning shrink-0 tabular-nums text-[10px]"
											}
										>
											{decFmt.format(milestone.score)}/10
										</span>
									) : (
										<span aria-hidden="true" className="text-[11px] text-muted-foreground">
											{milestone.unlocked ? "›" : "·"}
										</span>
									)}
								</Link>
							);
						})}
					</div>
				</div>
			)}
		</section>
	);
});

interface DrawerLessonRowProps {
	lesson: CourseOutlineLesson;
	moduleHref: string;
	isStarting: boolean;
	busy: boolean;
	onStart: () => void;
}

const DrawerLessonRow = memo(function DrawerLessonRow({
	lesson,
	moduleHref,
	isStarting,
	busy,
	onStart,
}: DrawerLessonRowProps) {
	const t = useT();
	const stepLabel =
		lesson.kind === "lab" ? t("lesson.drawer.stepLab") : t("lesson.drawer.stepLesson");
	const marker = lesson.isCurrent && lesson.status !== "done" ? "▶" : STATUS_MARKER[lesson.status];

	return (
		<li
			data-testid={`drawer-lesson-${lesson.id}`}
			className={`group/row rounded-lg transition-colors ${
				lesson.isCurrent
					? "bg-[var(--cel-accent,var(--primary))]/12 ring-1 ring-[var(--cel-accent,var(--primary))]/40"
					: "hover:bg-accent/45"
			}`}
		>
			<button
				type="button"
				disabled={busy && !lesson.isCurrent}
				aria-current={lesson.isCurrent ? "page" : undefined}
				onClick={lesson.isCurrent ? undefined : onStart}
				className={`flex w-full items-start gap-2 px-2 py-1.5 text-left ${
					lesson.isCurrent ? "cursor-default" : "cursor-pointer disabled:cursor-wait disabled:opacity-60"
				}`}
			>
				<span
					aria-hidden="true"
					className={`mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold leading-none ${statusMarkerClass(
						lesson.status,
						lesson.isCurrent,
					)}`}
				>
					{marker}
				</span>

				<span className="min-w-0 flex-1 space-y-0.5">
					<span className="flex items-start justify-between gap-1.5">
						<span
							className={`text-xs leading-snug ${
								lesson.isCurrent
									? "font-semibold text-foreground"
									: lesson.status === "locked"
										? "text-muted-foreground"
										: "font-medium text-foreground"
							}`}
						>
							{lesson.title}
						</span>
						{lesson.isCurrent && (
							<span className="cel-chip shrink-0 px-1.5 py-0 text-[10px] font-semibold">
								{t("lesson.drawer.currentBadge")}
							</span>
						)}
					</span>

					<span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
						<span className="inline-flex items-center gap-1">
							<Icon
								name={lesson.kind === "lab" ? "activity" : "lesson"}
								size={11}
								tone={false}
							/>
							{stepLabel}
						</span>
						<span aria-hidden="true">·</span>
						<span className="tabular-nums">
							{t("lesson.drawer.minutesShort", { min: lesson.minutes })}
						</span>
						{isStarting && (
							<>
								<span aria-hidden="true">·</span>
								<span className="font-medium text-foreground">{t("lesson.drawer.starting")}</span>
							</>
						)}
					</span>

					{lesson.lowRetention && lesson.retention !== null && (
						<span className="inline-block pt-0.5">
							<span className="study-pill study-pill-warning tabular-nums text-[10px]">
								{t("lesson.drawer.retentionAlert", { pct: Math.round(lesson.retention * 100) })}
							</span>
						</span>
					)}
				</span>
			</button>

			{lesson.supportSteps.length > 0 && (
				<div
					className={`flex-wrap items-center gap-1.5 px-2 pb-1.5 pl-8 text-[11px] ${
						lesson.isCurrent ? "flex" : "hidden group-hover/row:flex group-focus-within/row:flex"
					}`}
				>
					{lesson.supportSteps.map((step, idx) => {
						const stepTitle = step.part ? `${step.title} · ${step.part}` : step.title;
						const label =
							step.kind === "reading"
								? t("lesson.drawer.stepReading")
								: t("lesson.drawer.stepVideo");
						const duration = t("lesson.drawer.minutesShort", { min: step.minutes });
						const chipClass =
							"inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/75 px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-border hover:text-foreground";

						if (step.kind === "video" && step.url) {
							return (
								<a
									key={`${step.kind}-${idx}`}
									href={step.url}
									target="_blank"
									rel="noreferrer"
									title={stepTitle}
									className={chipClass}
								>
									<Icon name="video" size={11} tone={false} />
									<span>{label}</span>
									<span aria-hidden="true">·</span>
									<span className="tabular-nums">{duration}</span>
								</a>
							);
						}

						return (
							<Link
								key={`${step.kind}-${idx}`}
								href={moduleHref}
								title={stepTitle}
								className={chipClass}
							>
								<Icon
									name={step.kind === "reading" ? "book" : "video"}
									size={11}
									tone={false}
								/>
								<span>{label}</span>
								<span aria-hidden="true">·</span>
								<span className="tabular-nums">{duration}</span>
							</Link>
						);
					})}
				</div>
			)}
		</li>
	);
});
