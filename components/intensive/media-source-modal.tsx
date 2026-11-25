"use client";

import { useEffect, useState, type FormEvent } from "react";
import { FolderOpenIcon, Trash2Icon, XIcon } from "lucide-react";
import type { CourseTranscriptionStatus, IntensiveDashboardDTO } from "@/src/core";
import { useT } from "@/components/i18n";
import {
	INTENSIVE_BTN_COMPACT,
	INTENSIVE_BTN_PRIMARY,
	INTENSIVE_BTN_SECONDARY,
	INTENSIVE_INPUT,
} from "./tutor-launch.ts";

interface MediaSourceModalProps {
	open: boolean;
	dashboard: IntensiveDashboardDTO;
	initialCourseId?: string;
	onClose: () => void;
	onUpdated: (payload: {
		dashboard: IntensiveDashboardDTO;
		courseId: string;
		status?: CourseTranscriptionStatus | null;
	}) => void;
}

export function MediaSourceModal({
	open,
	dashboard,
	initialCourseId,
	onClose,
	onUpdated,
}: MediaSourceModalProps) {
	const t = useT();
	const defaultCourseId =
		initialCourseId ||
		dashboard.track.parallelCourseId ||
		dashboard.track.courses[0]?.id ||
		"";

	const [courseId, setCourseId] = useState(defaultCourseId);
	const [sourceDir, setSourceDir] = useState("");
	const [label, setLabel] = useState("");
	const [language, setLanguage] = useState("pt");
	const [expectedTotalVideos, setExpectedTotalVideos] = useState("");
	const [autoTranscribe, setAutoTranscribe] = useState(true);
	const [mode, setMode] = useState<"watch" | "once">("watch");
	const [saving, setSaving] = useState(false);
	const [unlinking, setUnlinking] = useState(false);
	const [error, setError] = useState("");

	const selectedCourse = dashboard.coursesById[courseId];
	const canPickNativeFolder =
		typeof window !== "undefined" && typeof window.lh?.chooseAttachmentFolder === "function";

	useEffect(() => {
		if (!open) return;
		const nextId =
			initialCourseId ||
			dashboard.track.parallelCourseId ||
			dashboard.track.courses[0]?.id ||
			"";
		setCourseId(nextId);
	}, [open, initialCourseId, dashboard.track.parallelCourseId, dashboard.track.courses]);

	useEffect(() => {
		if (!open) return;
		const course = dashboard.coursesById[courseId];
		if (!course) return;
		setSourceDir(course.mediaSource?.sourceDir ?? "");
		setLabel(course.mediaSource?.label ?? "");
		setLanguage(
			course.mediaSource?.language ??
				(course.spec.language.toLowerCase().startsWith("en") ? "en" : "pt"),
		);
		const expected =
			course.mediaSource?.expectedTotalVideos ?? course.spec.expectedTotalVideos;
		setExpectedTotalVideos(expected ? String(expected) : "");
		setError("");
	}, [open, courseId, dashboard.coursesById]);

	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	if (!open) return null;

	const handleBrowseFolder = async () => {
		try {
			const picked = await window.lh?.chooseAttachmentFolder?.();
			if (picked) {
				setSourceDir(picked);
				setError("");
			}
		} catch {
			// User can still paste path manually.
		}
	};

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		const trimmedDir = sourceDir.trim();
		if (!trimmedDir) {
			setError(t("intensive.modal.errorEmptyPath"));
			return;
		}
		setSaving(true);
		setError("");
		try {
			const parsedExpected = Number(expectedTotalVideos);
			const res = await fetch("/api/intensive/sources", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					courseId,
					sourceDir: trimmedDir,
					...(label.trim() ? { label: label.trim() } : {}),
					language: language.trim() || "pt",
					...(Number.isFinite(parsedExpected) && parsedExpected > 0
						? { expectedTotalVideos: Math.round(parsedExpected) }
						: {}),
				}),
			});
			const data = (await res.json().catch(() => null)) as {
				ok?: boolean;
				dashboard?: IntensiveDashboardDTO;
				status?: CourseTranscriptionStatus;
				error?: string;
			} | null;
			if (!res.ok || data?.ok === false) {
				throw new Error(data?.error || t("intensive.modal.errorSubmit"));
			}

			let nextStatus: CourseTranscriptionStatus | null = data?.status ?? null;
			if (autoTranscribe) {
				try {
					const tRes = await fetch("/api/intensive/transcribe", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							courseId,
							sourceDir: trimmedDir,
							mode,
							language: language.trim() || "pt",
						}),
					});
					const tData = (await tRes.json().catch(() => null)) as {
						status?: CourseTranscriptionStatus;
					} | null;
					if (tData?.status) nextStatus = tData.status;
				} catch {
					// Folder link succeeded; transcription can be started manually from the GPU bar.
				}
			}

			let nextDashboard = data?.dashboard;
			if (!nextDashboard) {
				const dRes = await fetch("/api/intensive");
				if (dRes.ok) {
					nextDashboard = (await dRes.json()) as IntensiveDashboardDTO;
				}
			}
			if (!nextDashboard) {
				throw new Error(t("intensive.modal.errorSubmit"));
			}

			onUpdated({
				dashboard: nextDashboard,
				courseId,
				status: nextStatus,
			});
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : t("intensive.modal.errorSubmit"));
		} finally {
			setSaving(false);
		}
	};

	const handleUnlink = async () => {
		setUnlinking(true);
		setError("");
		try {
			const res = await fetch(
				`/api/intensive/sources?courseId=${encodeURIComponent(courseId)}`,
				{ method: "DELETE" },
			);
			const data = (await res.json().catch(() => null)) as {
				ok?: boolean;
				dashboard?: IntensiveDashboardDTO;
				error?: string;
			} | null;
			if (!res.ok || data?.ok === false) {
				throw new Error(data?.error || t("intensive.error.mutationFailed"));
			}
			let nextDashboard = data?.dashboard;
			if (!nextDashboard) {
				const dRes = await fetch("/api/intensive");
				if (dRes.ok) {
					nextDashboard = (await dRes.json()) as IntensiveDashboardDTO;
				}
			}
			if (!nextDashboard) {
				throw new Error(t("intensive.error.mutationFailed"));
			}
			onUpdated({ dashboard: nextDashboard, courseId, status: null });
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : t("intensive.error.mutationFailed"));
		} finally {
			setUnlinking(false);
		}
	};

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="intensive-media-modal-title"
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div className="elec-surface w-full max-w-xl overflow-hidden text-foreground shadow-2xl">
				<div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
					<div className="space-y-1">
						<h2 id="intensive-media-modal-title" className="text-lg font-bold text-foreground">
							{t("intensive.modal.title")}
						</h2>
						<p className="text-sm text-muted-foreground">{t("intensive.modal.subtitle")}</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label={t("intensive.action.dismiss")}
						className="inline-flex size-9 shrink-0 items-center justify-center rounded border border-transparent text-muted-foreground hover:border-border/70 hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cel-focus,var(--ring))] cursor-pointer"
					>
						<XIcon className="size-4" aria-hidden="true" />
					</button>
				</div>

				<form onSubmit={handleSubmit} className="space-y-4 p-5">
					{/* Course selector */}
					<div className="space-y-1.5">
						<label htmlFor="media-source-course" className="block text-[13px] font-semibold text-foreground">
							{t("intensive.modal.courseLabel")}
						</label>
						<select
							id="media-source-course"
							value={courseId}
							onChange={(e) => setCourseId(e.target.value)}
							className={INTENSIVE_INPUT}
						>
							{dashboard.track.courses.map((course) => (
								<option key={course.id} value={course.id}>
									#{course.rank} · {course.title}
								</option>
							))}
						</select>
					</div>

					{/* Folder path */}
					<div className="space-y-1.5">
						<label htmlFor="media-source-dir" className="block text-[13px] font-semibold text-foreground">
							{t("intensive.modal.folderLabel")}
						</label>
						<div className="flex gap-2">
							<input
								id="media-source-dir"
								type="text"
								value={sourceDir}
								onChange={(e) => {
									setSourceDir(e.target.value);
									if (error) setError("");
								}}
								placeholder={t("intensive.modal.folderPlaceholder")}
								className={`${INTENSIVE_INPUT} font-mono text-[13px]`}
								autoFocus
							/>
							{canPickNativeFolder && (
								<button
									type="button"
									onClick={() => void handleBrowseFolder()}
									className={`${INTENSIVE_BTN_COMPACT} shrink-0`}
								>
									<FolderOpenIcon className="size-4 shrink-0" aria-hidden="true" />
									{t("intensive.modal.chooseFolder")}
								</button>
							)}
						</div>
					</div>

					{/* Optional label + language + expected videos */}
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
						<div className="space-y-1.5 sm:col-span-1">
							<label htmlFor="media-source-lang" className="block text-[13px] font-semibold text-foreground">
								{t("intensive.modal.languageField")}
							</label>
							<select
								id="media-source-lang"
								value={language}
								onChange={(e) => setLanguage(e.target.value)}
								className={INTENSIVE_INPUT}
							>
								<option value="pt">Português (pt)</option>
								<option value="en">English (en)</option>
								<option value="es">Español (es)</option>
								<option value="de">Deutsch (de)</option>
								<option value="fr">Français (fr)</option>
								<option value="auto">Auto</option>
							</select>
						</div>

						<div className="space-y-1.5 sm:col-span-1">
							<label htmlFor="media-source-expected" className="block text-[13px] font-semibold text-foreground">
								{t("intensive.modal.expectedField")}
							</label>
							<input
								id="media-source-expected"
								type="number"
								min={0}
								max={5000}
								value={expectedTotalVideos}
								onChange={(e) => setExpectedTotalVideos(e.target.value)}
								placeholder="207"
								className={`${INTENSIVE_INPUT} tabular-nums`}
							/>
						</div>

						<div className="space-y-1.5 sm:col-span-1">
							<label htmlFor="media-source-label" className="block text-[13px] font-semibold text-foreground">
								{t("intensive.modal.labelField")}
							</label>
							<input
								id="media-source-label"
								type="text"
								value={label}
								onChange={(e) => setLabel(e.target.value)}
								placeholder={t("intensive.modal.labelPlaceholder")}
								className={INTENSIVE_INPUT}
							/>
						</div>
					</div>

					{/* Auto GPU transcription toggle */}
					<div className="space-y-2.5 border-t border-border/50 pt-3.5">
						<label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-foreground">
							<input
								type="checkbox"
								checked={autoTranscribe}
								onChange={(e) => setAutoTranscribe(e.target.checked)}
								className="size-4 accent-[var(--cel-accent,var(--primary))]"
							/>
							<span>{t("intensive.modal.autoTranscribe")}</span>
						</label>

						{autoTranscribe && (
							<div className="space-y-1.5 pl-6 text-[13px]">
								<label className="flex cursor-pointer items-center gap-2 text-muted-foreground hover:text-foreground">
									<input
										type="radio"
										name="gpu-mode"
										value="watch"
										checked={mode === "watch"}
										onChange={() => setMode("watch")}
										className="accent-[var(--cel-accent,var(--primary))]"
									/>
									<span>{t("intensive.modal.modeWatch")}</span>
								</label>
								<label className="flex cursor-pointer items-center gap-2 text-muted-foreground hover:text-foreground">
									<input
										type="radio"
										name="gpu-mode"
										value="once"
										checked={mode === "once"}
										onChange={() => setMode("once")}
										className="accent-[var(--cel-accent,var(--primary))]"
									/>
									<span>{t("intensive.modal.modeOnce")}</span>
								</label>
							</div>
						)}
					</div>

					{error && (
						<p role="alert" className="rounded border border-error/45 bg-error/10 px-3 py-2 text-sm text-error">
							{error}
						</p>
					)}

					<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-4">
						<div>
							{selectedCourse?.mediaSource && (
								<button
									type="button"
									disabled={unlinking || saving}
									onClick={() => void handleUnlink()}
									className="inline-flex min-h-9 items-center gap-1.5 rounded border border-error/45 px-3 py-1.5 text-[13px] font-medium text-error hover:bg-error/10 disabled:opacity-45 cursor-pointer"
								>
									<Trash2Icon className="size-3.5 shrink-0" aria-hidden="true" />
									{t("intensive.modal.unlink")}
								</button>
							)}
						</div>

						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={onClose}
								disabled={saving || unlinking}
								className={INTENSIVE_BTN_SECONDARY}
							>
								{t("intensive.action.cancel")}
							</button>
							<button
								type="submit"
								disabled={saving || unlinking}
								className={INTENSIVE_BTN_PRIMARY}
							>
								{saving ? t("intensive.modal.saving") : t("intensive.modal.submit")}
							</button>
						</div>
					</div>
				</form>
			</div>
		</div>
	);
}
