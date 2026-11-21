"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/icon";
import { useI18n } from "@/components/i18n";
import {
	levelProgress,
	type LessonContinuityMeta,
	type LessonCourseContext,
	type LessonCourseProgress,
	type StudyNodeBrief,
	type StudyToday,
	type Translator,
} from "@/src/core";
import { SessionStarter, studyLessonRequest } from "../start-session.ts";
import { lessonStatement } from "./lesson-statement.ts";

export interface LessonRetryTarget {
	nodeId: string;
	brief: StudyNodeBrief;
	estMinutes: number;
	feedback: string;
}

export interface LessonFinishState extends LessonContinuityMeta {
	domainId: string;
	sessionId: string;
	nodeId: string;
	completed: boolean;
	reinforcement?: string;
	course?: LessonCourseContext | null;
	next?: StudyToday["next"];
	resume?: string | null;
	retry?: LessonRetryTarget | null;
}

export interface LessonReceipt extends LessonContinuityMeta {
	outcome?: "passed" | "reinforce";
	criteria?: { title?: string; met: boolean; reason: string }[];
	assessment: string;
	cards: number | null;
	before: number;
	after: number;
	alreadyCompleted: boolean;
	resume: string | null;
	next: StudyToday["next"];
	course?: LessonCourseProgress | null;
	retry?: LessonRetryTarget | null;
}

type FlashcardExportMode = "obsidian" | "anki" | "apkg";

const EXPORT_MODES: readonly { mode: FlashcardExportMode; label: string }[] = [
	{ mode: "obsidian", label: "Obsidian" },
	{ mode: "anki", label: "Anki" },
	{ mode: "apkg", label: ".apkg" },
];

function kindLabel(t: Translator, kind: string): string {
	switch (kind) {
		case "new":
			return t("lesson.finish.kindNew");
		case "review":
			return t("lesson.finish.kindReview");
		case "vehicle":
			return t("lesson.finish.kindVehicle");
		case "remediate":
			return t("lesson.finish.kindRemediate");
		case "probe":
			return t("lesson.finish.kindProbe");
		default:
			return t("lesson.finish.upNext");
	}
}

function formatExportStatus(
	t: Translator,
	mode: FlashcardExportMode,
	payload: Record<string, unknown> | null,
): string {
	if (payload) {
		if (typeof payload.message === "string" && payload.message.trim()) return payload.message.trim();
		if (typeof payload.status === "string" && payload.status.trim()) return payload.status.trim();
		if (mode === "obsidian") {
			if (typeof payload.cards === "number") {
				return t("lesson.finish.exportObsidianCards", { count: payload.cards });
			}
			return t("lesson.finish.exportObsidian");
		}
		if (mode === "apkg" || payload.mode === "apkg") {
			const notes = typeof payload.notes === "number" ? payload.notes : null;
			const target = typeof payload.path === "string" && payload.path ? payload.path : null;
			if (notes !== null && target) return t("lesson.finish.exportApkgNotesPath", { count: notes, path: target });
			if (notes !== null) return t("lesson.finish.exportApkgNotes", { count: notes });
			if (target) return t("lesson.finish.exportApkgPath", { path: target });
			return t("lesson.finish.exportApkg");
		}
		if (mode === "anki") {
			const created = typeof payload.created === "number" ? payload.created : 0;
			const updated = typeof payload.updated === "number" ? payload.updated : 0;
			if (created || updated) return t("lesson.finish.exportAnkiCounts", { created, updated });
			return t("lesson.finish.exportAnki");
		}
	}
	return t("lesson.finish.exportDone");
}

function chime(context: AudioContext) {
	const start = context.currentTime;
	for (const [index, pitch] of [523.25, 659.25, 783.99].entries()) {
		const tone = context.createOscillator();
		const volume = context.createGain();
		const t = start + index * 0.11;
		tone.frequency.value = pitch;
		volume.gain.setValueAtTime(0.001, t);
		volume.gain.exponentialRampToValueAtTime(0.075, t + 0.025);
		volume.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
		tone.connect(volume).connect(context.destination);
		tone.start(t);
		tone.stop(t + 0.33);
	}
}

export function LessonFinish({
	state,
	busy,
	receipt,
}: {
	state: LessonFinishState;
	busy: boolean;
	receipt?: LessonReceipt;
}) {
	const { t, intl } = useI18n();
	const router = useRouter();
	const [sound, setSound] = useState(true);
	const [saving, setSaving] = useState(false);
	const [exportingMode, setExportingMode] = useState<FlashcardExportMode | null>(null);
	const [exportStatus, setExportStatus] = useState<{ ok: boolean; text: string } | null>(null);
	const played = useRef(state.completed);
	const [error, setError] = useState("");
	const [xp, setXp] = useState(receipt?.after ?? 0);
	const lock = useRef(false);
	const active = useRef(true);
	const audio = useRef<AudioContext | null>(null);
	const starter = useRef(new SessionStarter());

	const intFmt = useMemo(() => new Intl.NumberFormat(intl), [intl]);
	const scoreFmt = useMemo(
		() => new Intl.NumberFormat(intl, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
		[intl],
	);

	useEffect(() => {
		active.current = true;
		try {
			setSound(localStorage.getItem("lh:lesson-chime") !== "off");
		} catch {
			/* optional preference */
		}
		return () => {
			active.current = false;
			void audio.current?.close().catch(() => {});
			audio.current = null;
		};
	}, []);

	useEffect(() => {
		if (!sound || state.completed) return;
		const unlock = () => {
			try {
				audio.current ??= new AudioContext();
				void audio.current.resume().catch(() => {});
			} catch {
				/* optional audio */
			}
		};
		window.addEventListener("pointerdown", unlock, { once: true });
		window.addEventListener("keydown", unlock, { once: true });
		return () => {
			window.removeEventListener("pointerdown", unlock);
			window.removeEventListener("keydown", unlock);
		};
	}, [sound, state.completed]);

	useEffect(() => {
		if (!receipt || busy || receipt.outcome === "reinforce" || receipt.alreadyCompleted || played.current) {
			if (receipt) setXp(receipt.after);
			return;
		}
		played.current = true;
		if (sound && audio.current?.state === "running") chime(audio.current);
		const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		if (reduced || receipt.after <= receipt.before) {
			setXp(receipt.after);
			return;
		}
		const start = performance.now();
		let frame = 0;
		function tick(now: number) {
			if (!receipt) return;
			const fraction = Math.min(1, (now - start) / 850);
			setXp(Math.round(receipt.before + (receipt.after - receipt.before) * fraction));
			if (fraction < 1) frame = requestAnimationFrame(tick);
		}
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [receipt, busy, sound]);

	const openNext = useCallback(
		async (resumeId: string | null | undefined, nextItem: StudyToday["next"] | undefined) => {
			if (lock.current || !active.current) return;
			lock.current = true;
			setSaving(true);
			setError("");
			try {
				let href = "/";
				if (resumeId) href = "/chat/" + encodeURIComponent(resumeId);
				else if (nextItem) {
					const { brief, nodeId, estMinutes } = nextItem;
					const minutes = Math.round(estMinutes);
					href = await starter.current.start(
						studyLessonRequest({
							domainId: state.domainId,
							minutes,
							title: brief.title,
							context: { id: nodeId, name: brief.title, statement: lessonStatement(brief, minutes) },
						}),
						fetch,
					);
				}
				if (active.current) router.push(href);
			} catch {
				setError(t("lesson.finish.errOpenNext"));
			} finally {
				lock.current = false;
				if (active.current) setSaving(false);
			}
		},
		[router, state.domainId, t],
	);

	const startRetry = useCallback(
		async (target: LessonRetryTarget) => {
			if (lock.current || !active.current) return;
			lock.current = true;
			setSaving(true);
			setError("");
			try {
				const minutes = Math.round(target.estMinutes);
				const href = await starter.current.start(
					studyLessonRequest({
						domainId: state.domainId,
						minutes,
						title: target.brief.title,
						context: {
							id: target.nodeId,
							name: target.brief.title,
							statement: lessonStatement(target.brief, minutes, target.feedback),
						},
					}),
					fetch,
				);
				if (active.current) router.push(href);
			} catch {
				setError(t("lesson.finish.errRetry"));
			} finally {
				lock.current = false;
				if (active.current) setSaving(false);
			}
		},
		[router, state.domainId, t],
	);

	const exportFlashcards = useCallback(
		async (mode: FlashcardExportMode) => {
			setExportingMode(mode);
			setExportStatus(null);
			try {
				const res = await fetch("/api/study/flashcards/export", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ mode }),
				});
				const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
				if (!active.current) return;
				if (!res.ok) {
					const reason =
						typeof payload?.error === "string" && payload.error.trim()
							? payload.error.trim()
							: typeof payload?.message === "string" && payload.message.trim()
								? payload.message.trim()
								: t("lesson.finish.exportFailed");
					setExportStatus({ ok: false, text: reason });
					return;
				}
				setExportStatus({ ok: true, text: formatExportStatus(t, mode, payload) });
			} catch {
				if (active.current) setExportStatus({ ok: false, text: t("lesson.finish.exportNetworkError") });
			} finally {
				if (active.current) setExportingMode(null);
			}
		},
		[t],
	);

	const finished = Boolean(receipt || state.completed);
	const needsReinforcement = receipt?.outcome === "reinforce" || Boolean(state.reinforcement);
	const course = receipt?.course ?? state.course ?? null;
	const courseProgress = receipt?.course ?? null;
	const nextLesson = receipt ? receipt.next : state.next ?? null;
	const resumeSession = receipt ? receipt.resume : state.resume ?? null;
	const retryTarget = receipt?.retry ?? state.retry ?? null;

	const moduleExamUnlocked = receipt?.moduleExamUnlocked ?? state.moduleExamUnlocked;
	const moduleExamPassed = Boolean(receipt?.moduleExamPassed ?? state.moduleExamPassed);
	const moduleExamScore = receipt?.moduleExamScore ?? state.moduleExamScore;
	const chapterId = receipt?.chapterId ?? state.chapterId ?? course?.chapterLevel;
	const chapterExamUnlocked = Boolean(receipt?.chapterExamUnlocked ?? state.chapterExamUnlocked);
	const chapterExamPassed = Boolean(receipt?.chapterExamPassed ?? state.chapterExamPassed);
	const chapterExamScore = receipt?.chapterExamScore ?? state.chapterExamScore;
	const problemSetPassed = Boolean(receipt?.problemSetPassed ?? state.problemSetPassed);
	const problemSetScore = receipt?.problemSetScore ?? state.problemSetScore;
	const dueReviewCount = receipt?.dueReviewCount ?? state.dueReviewCount ?? 0;
	const optionalPractice = receipt?.optionalPractice !== undefined ? receipt.optionalPractice : state.optionalPractice ?? null;
	const prepHref = receipt?.prepHref ?? state.prepHref;

	const mapHref = "/mapa?" + new URLSearchParams({ dominio: state.domainId, no: state.nodeId });
	const fallbackModuleUnlocked = Boolean(
		course && (courseProgress?.moduleJustCompleted || (course.moduleTotal > 0 && course.moduleCompleted >= course.moduleTotal)),
	);
	const effectiveModuleExamUnlocked = moduleExamUnlocked ?? fallbackModuleUnlocked;
	const showModuleExam = Boolean(course && !needsReinforcement && effectiveModuleExamUnlocked && !moduleExamPassed);
	const showChapterExam = Boolean(!needsReinforcement && chapterExamUnlocked && !chapterExamPassed && chapterId);
	const showProblemSet = Boolean(course && !problemSetPassed);

	const moduleExamHref = course
		? `/ementa?dominio=${encodeURIComponent(state.domainId)}&modulo=${encodeURIComponent(course.moduleId)}&acao=prova`
		: null;
	const problemSetHref = course
		? `/ementa?dominio=${encodeURIComponent(state.domainId)}&modulo=${encodeURIComponent(course.moduleId)}&acao=lista`
		: null;
	const chapterExamHref = chapterId
		? `/ementa?dominio=${encodeURIComponent(state.domainId)}&capitulo=${encodeURIComponent(chapterId)}&acao=prova`
		: null;
	const optionalPracticeHref = optionalPractice
		? `/mapa?dominio=${encodeURIComponent(optionalPractice.domain)}&no=${encodeURIComponent(optionalPractice.nodeId)}`
		: null;

	const progress = receipt ? levelProgress(xp) : null;

	const headline = needsReinforcement
		? t("lesson.finish.headlineReinforce")
		: courseProgress?.chapterJustCompleted
			? t("lesson.finish.headlineChapterDone", { level: courseProgress.chapterLevel })
			: courseProgress?.moduleJustCompleted
				? t("lesson.finish.headlineModuleDone", { title: courseProgress.moduleTitle })
				: receipt
					? t("lesson.finish.headlineTeacherDone")
					: t("lesson.finish.headlineDone");

	return (
		<section aria-label={t("lesson.finish.sectionAria")} data-testid="lesson-finish-card" className="my-4">
			{finished ? (
				<div className="cel-card space-y-3 p-4">
					<div className="flex flex-wrap items-center gap-2">
						<Icon name={needsReinforcement ? "review" : "check"} size={20} />
						<strong className="cel-display text-base">{headline}</strong>
						<div className="ml-auto flex flex-wrap items-center gap-1.5">
							{dueReviewCount > 0 && (
								<Link
									href="/"
									data-testid="lesson-due-reviews-link"
									className="study-pill study-pill-warning underline-offset-2 hover:underline"
								>
									<Icon name="review-due" size={13} tone={false} />
									{t("lesson.finish.dueReviewsLink", { count: dueReviewCount })}
								</Link>
							)}
							{receipt?.cards != null && (
								<span className="study-pill">
									<Icon name="flashcard" size={13} tone={false} />
									{receipt.cards
										? t("lesson.finish.flashcardsCount", { count: receipt.cards })
										: t("lesson.finish.cardsReady")}
								</span>
							)}
						</div>
					</div>

					{receipt && !needsReinforcement && progress && (
						<div className="space-y-1">
							<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums">
								<span className="font-semibold text-foreground">
									{receipt.after > receipt.before
										? t("lesson.finish.xpGained", { xp: intFmt.format(receipt.after - receipt.before) })
										: t("lesson.finish.xpAlreadyCounted")}
								</span>
								<span>
									{t("lesson.finish.levelTotalXp", {
										level: progress.level,
										xp: intFmt.format(xp),
									})}
								</span>
							</div>
							<progress
								className="study-progress study-progress-xp block w-full"
								aria-label={t("lesson.finish.levelProgressAria")}
								value={progress.fraction}
								max={1}
							/>
						</div>
					)}

					{(receipt?.assessment || state.reinforcement) && (
						<p className="text-sm leading-relaxed text-foreground/90">{receipt?.assessment ?? state.reinforcement}</p>
					)}

					{receipt?.criteria && receipt.criteria.length > 0 && (
						<ul className="space-y-2">
							{receipt.criteria.map((criterion, index) => (
								<li key={index} className="rounded-xl border border-border/50 bg-background/60 px-3 py-2 text-sm">
									<div className="flex items-center gap-2">
										<span className={criterion.met ? "study-pill study-pill-success" : "study-pill study-pill-warning"}>
											{criterion.met ? t("lesson.finish.criterionMet") : t("lesson.finish.criterionReinforce")}
										</span>
										{criterion.title && <strong className="text-sm">{criterion.title}</strong>}
									</div>
									<p className="mt-1 text-xs leading-relaxed text-muted-foreground">{criterion.reason}</p>
								</li>
							))}
						</ul>
					)}

					{course && (
						<div className="space-y-2 rounded-xl border border-border/50 bg-background/60 px-3 py-2.5 text-xs">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<span className="font-semibold text-foreground">
									{t("lesson.finish.moduleHeader", {
										index: course.moduleIndex,
										total: course.totalModules,
										title: course.moduleTitle,
									})}
								</span>
								<span className="tabular-nums text-muted-foreground">
									{t("lesson.finish.moduleLessonsCount", {
										completed: course.moduleCompleted,
										total: course.moduleTotal,
										level: course.chapterLevel,
										known: course.chapterKnown,
										chapterTotal: course.chapterTotal,
									})}
								</span>
							</div>
							<progress
								className="study-progress block w-full"
								max={Math.max(1, course.moduleTotal)}
								value={course.moduleCompleted}
								aria-label={t("lesson.finish.moduleProgressAria", { title: course.moduleTitle })}
							/>
							{courseProgress?.chapterJustCompleted && courseProgress.nextChapterTitle && (
								<p className="font-medium text-foreground">
									{t("lesson.finish.nextChapterUnlocked", { title: courseProgress.nextChapterTitle })}
								</p>
							)}
							{!courseProgress?.chapterJustCompleted &&
								courseProgress?.moduleJustCompleted &&
								courseProgress.nextModuleTitle && (
									<p className="font-medium text-foreground">
										{t("lesson.finish.nextModuleUnlocked", { title: courseProgress.nextModuleTitle })}
									</p>
								)}
							{(problemSetPassed || moduleExamPassed || chapterExamPassed) && (
								<div className="flex flex-wrap items-center gap-1.5">
									{problemSetPassed && problemSetScore !== undefined && (
										<span className="study-pill study-pill-success tabular-nums">
											{t("lesson.finish.problemSetPassed", { score: scoreFmt.format(problemSetScore) })}
										</span>
									)}
									{moduleExamPassed && moduleExamScore !== undefined && (
										<span className="study-pill study-pill-success tabular-nums">
											{t("lesson.finish.moduleExamPassed", { score: scoreFmt.format(moduleExamScore) })}
										</span>
									)}
									{chapterExamPassed && chapterExamScore !== undefined && (
										<span className="study-pill study-pill-success tabular-nums">
											{t("lesson.finish.chapterExamPassed", { score: scoreFmt.format(chapterExamScore) })}
										</span>
									)}
								</div>
							)}
							{!needsReinforcement && (showChapterExam || showModuleExam || showProblemSet) && (
								<div className="flex flex-wrap items-center gap-2 pt-0.5">
									{showChapterExam && chapterExamHref && chapterId && (
										<Link
											href={chapterExamHref}
											data-testid="lesson-chapter-exam-link"
											className="cel-button cel-button-primary min-h-8 px-3 py-1 text-xs"
										>
											<Icon name="trophy" size={14} tone={false} />
											{t("lesson.finish.chapterExamCta", { level: chapterId })}
										</Link>
									)}
									{showModuleExam && moduleExamHref && (
										<Link
											href={moduleExamHref}
											data-testid="lesson-module-exam-link"
											className={`cel-button min-h-8 px-3 py-1 text-xs ${showChapterExam ? "" : "cel-button-primary"}`}
										>
											<Icon name="exercise" size={14} tone={false} />
											{t("lesson.finish.moduleExamCta")}
										</Link>
									)}
									{showProblemSet && problemSetHref && (
										<Link
											href={problemSetHref}
											data-testid="lesson-problem-set-link"
											className="cel-button min-h-8 px-3 py-1 text-xs"
										>
											<Icon name="activity" size={14} tone={false} />
											{t("lesson.finish.problemSetCta")}
										</Link>
									)}
								</div>
							)}
						</div>
					)}

					{!needsReinforcement && receipt?.cards != null && (
						<div className="space-y-1.5 rounded-xl border border-border/50 bg-background/60 px-3 py-2.5 text-xs">
							<div className="flex flex-wrap items-center gap-2">
								<span className="inline-flex items-center gap-1.5 font-medium text-foreground">
									<Icon name="export-cards" size={14} tone={false} />
									{t("lesson.finish.quickExportTitle")}
								</span>
								<div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
									{EXPORT_MODES.map(({ mode, label }) => (
										<button
											key={mode}
											type="button"
											disabled={exportingMode !== null}
											onClick={() => void exportFlashcards(mode)}
											className="cel-button cel-button-ghost min-h-7 px-2.5 py-0.5 text-xs"
										>
											{exportingMode === mode ? t("lesson.finish.exporting") : label}
										</button>
									))}
								</div>
							</div>
							{exportStatus && (
								<p
									role="status"
									className={exportStatus.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}
								>
									{exportStatus.text}
								</p>
							)}
						</div>
					)}

					{!needsReinforcement && (nextLesson || resumeSession) && (
						<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/80 px-3.5 py-3">
							<div className="min-w-0 flex-1">
								<p className="text-xs uppercase tracking-wider text-muted-foreground">
									{resumeSession
										? t("lesson.finish.resumeNext")
										: kindLabel(t, nextLesson!.kind)}
									{nextLesson ? ` · ~${Math.round(nextLesson.estMinutes)} min` : ""}
								</p>
								{nextLesson && <p className="cel-display truncate text-base">{nextLesson.brief.title}</p>}
								{nextLesson && nextLesson.brief.path.length > 0 && (
									<p className="truncate text-xs text-muted-foreground">{nextLesson.brief.path.join(" › ")}</p>
								)}
							</div>
							<button
								type="button"
								data-testid="lesson-next-button"
								className="cel-button cel-button-primary min-h-9 shrink-0 px-4 py-1.5 text-sm"
								disabled={saving || busy}
								onClick={() => void openNext(resumeSession, nextLesson)}
							>
								<Icon name="play" size={15} />
								{saving
									? t("lesson.finish.opening")
									: resumeSession
										? t("lesson.finish.resumeLesson")
										: t("lesson.finish.nextLesson")}
							</button>
						</div>
					)}

					<div className="flex flex-wrap items-center gap-2.5 pt-1 text-sm">
						{needsReinforcement && retryTarget && (
							<button
								type="button"
								data-testid="lesson-retry-button"
								className="cel-button cel-button-primary min-h-9 px-4 py-1.5 text-sm"
								disabled={saving || busy}
								onClick={() => void startRetry(retryTarget)}
							>
								<Icon name="play" size={15} />
								{saving ? t("lesson.finish.opening") : t("lesson.finish.retryTopic")}
							</button>
						)}
						{needsReinforcement && prepHref && (
							<Link
								href={prepHref}
								data-testid="lesson-prep-link"
								className="cel-button min-h-9 px-3 py-1.5 text-xs"
							>
								<Icon name="book" size={14} tone={false} />
								{t("lesson.finish.prepLink")}
							</Link>
						)}
						{needsReinforcement && problemSetHref && (
							<Link
								href={problemSetHref}
								data-testid="lesson-problem-set-link"
								className="cel-button min-h-9 px-3 py-1.5 text-xs"
							>
								<Icon name="activity" size={14} tone={false} />
								{t("lesson.finish.problemSetCta")}
							</Link>
						)}
						{needsReinforcement && optionalPractice && optionalPracticeHref && (
							<Link
								href={optionalPracticeHref}
								data-testid="lesson-optional-practice-link"
								className="cel-button min-h-9 px-3 py-1.5 text-xs"
							>
								<Icon name="review" size={14} tone={false} />
								{t("lesson.finish.optionalPracticeLink", { title: optionalPractice.title })}
							</Link>
						)}
						<Link className="cel-button cel-button-ghost px-3 py-1.5 text-xs" href={mapHref}>
							<Icon name="map" size={14} tone={false} />
							{needsReinforcement
								? t("lesson.finish.treeResourcesReinforce")
								: t("lesson.finish.viewOnTree")}
						</Link>
						<Link
							className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
							href="/"
						>
							{t("lesson.finish.backToCampaign")}
						</Link>
					</div>
				</div>
			) : (
				<label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
					<input
						type="checkbox"
						className="accent-[var(--cel-accent,var(--primary))]"
						checked={sound}
						onChange={(e) => {
							setSound(e.target.checked);
							try {
								localStorage.setItem("lh:lesson-chime", e.target.checked ? "on" : "off");
							} catch {
								/* optional preference */
							}
						}}
					/>
					{t("lesson.finish.chimeToggle")}
				</label>
			)}
			{error && (
				<p role="alert" className="mt-2 text-sm text-destructive">
					{error}
				</p>
			)}
		</section>
	);
}
