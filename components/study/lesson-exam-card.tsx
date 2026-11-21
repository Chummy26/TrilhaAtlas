"use client";

import { useContext, useId, useMemo, useState } from "react";
import { ChatActionsContext } from "@/components/chat";
import { Icon } from "@/components/icons/icon";
import {
	composeExamPartsAnswer,
	extractExamFormParts,
	isLessonExamAnswer,
	type ArtifactPartProps,
	type LessonExamPart,
} from "@/src/core";
import { CitedResponse } from "./cited-response.tsx";
import { useT } from "@/components/i18n";

export function LessonExamCard({ part }: ArtifactPartProps) {
	const t = useT();
	const actions = useContext(ChatActionsContext);
	const exam = part.output as
		| {
			task?: string;
			feedback?: string;
			attempt?: number;
			total?: number;
			objectives?: string[];
			parts?: LessonExamPart[];
		}
		| undefined;
	const parts = useMemo(
		() => (exam?.task ? extractExamFormParts(exam.task, exam.parts) : []),
		[exam?.task, exam?.parts],
	);
	const [answer, setAnswer] = useState("");
	const [partAnswers, setPartAnswers] = useState<string[]>([]);
	const [missingParts, setMissingParts] = useState<number[]>([]);
	const [freeMode, setFreeMode] = useState(false);
	const [delivering, setDelivering] = useState(false);
	const [error, setError] = useState("");
	const label = useId();
	if (part.state !== "output-available" || !exam?.task) return null;
	const open = actions?.activeExamId === part.toolCallId && !!actions?.submitExam;
	const structured = parts.length >= 2 && !freeMode;
	const filledCount = structured
		? parts.reduce((acc, _, idx) => acc + (isLessonExamAnswer(partAnswers[idx] ?? "") ? 1 : 0), 0)
		: 0;
	const canSubmit = structured
		? partAnswers.some((v) => v.trim().length > 0)
		: answer.trim().length > 0;

	function switchToFree() {
		if (!answer.trim() && partAnswers.some((v) => v.trim())) {
			const draft = parts
				.map((_, idx) => {
					const val = (partAnswers[idx] ?? "").trim();
					return val ? `${idx + 1}. ${val}` : "";
				})
				.filter(Boolean)
				.join("\n\n");
			if (draft) setAnswer(draft);
		}
		setMissingParts([]);
		setError("");
		setFreeMode(true);
	}

	async function handleSubmit(event: React.FormEvent) {
		event.preventDefault();
		if (structured) {
			const composed = composeExamPartsAnswer(parts, partAnswers);
			if (!composed.ok) {
				setMissingParts(composed.missing);
				const nums = composed.missing.map((i) => i + 1).join(", ");
				setError(
					composed.missing.length === 1
						? t("lesson.examCard.errMissingOne", { parts: nums })
						: t("lesson.examCard.errMissingMany", { parts: nums }),
				);
				return;
			}
			setMissingParts([]);
			setError("");
			setDelivering(true);
			try {
				await actions?.submitExam?.(part.toolCallId, composed.text, () => {
					setPartAnswers([]);
					setAnswer("");
				});
			} finally {
				setDelivering(false);
			}
			return;
		}
		if (!isLessonExamAnswer(answer)) {
			setError(t("lesson.examCard.errEmpty"));
			return;
		}
		setError("");
		setDelivering(true);
		try {
			await actions?.submitExam?.(part.toolCallId, answer.trim(), () => setAnswer(""));
		} finally {
			setDelivering(false);
		}
	}

	return (
		<section aria-label={t("lesson.examCard.aria")} className="cel-card my-4 space-y-3 p-4 md:p-5">
			{exam.feedback && (
				<div className="rounded-xl border border-border/55 bg-background/60 px-3.5 py-2.5">
					<CitedResponse text={exam.feedback} />
				</div>
			)}
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2.5">
				<div className="flex items-center gap-2">
					<Icon name="exercise" size={18} />
					<h3 className="cel-display text-lg">{t("lesson.examCard.title")}</h3>
				</div>
				{exam.attempt != null && exam.total != null && (
					<span className="study-pill study-pill-accent tabular-nums">
						{t("lesson.examCard.attempt", { attempt: exam.attempt, total: exam.total })}
					</span>
				)}
			</div>
			<CitedResponse text={exam.task} />
			{!!exam.objectives?.length && (
				<div className="rounded-xl border border-border/50 bg-background/55 px-3.5 py-2.5 text-sm">
					<strong className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
						{t("lesson.examCard.rubric")}
					</strong>
					<ul className="mt-1.5 list-disc space-y-1 pl-5 text-foreground/90">
						{exam.objectives.map((objective, index) => (
							<li key={index}>{objective}</li>
						))}
					</ul>
				</div>
			)}
			{open && (
				<form
					className="grid gap-3 border-t border-border/50 pt-3"
					data-exam-form={structured ? "structured" : "free"}
					onSubmit={(event) => void handleSubmit(event)}
				>
					{structured ? (
						<>
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div className="flex flex-wrap items-center gap-2">
									<span className="text-sm font-semibold">{t("lesson.examCard.answerByParts")}</span>
									<span
										className={
											filledCount === parts.length
												? "study-pill study-pill-success tabular-nums"
												: "study-pill tabular-nums"
										}
									>
										{t("lesson.examCard.partsFilled", { filled: filledCount, total: parts.length })}
									</span>
								</div>
								<button
									type="button"
									className="text-xs font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground"
									onClick={switchToFree}
								>
									{t("lesson.examCard.useSingleField")}
								</button>
							</div>
							<div className="space-y-3">
								{parts.map((item, idx) => {
									const fieldId = `${label}-part-${idx}`;
									const value = partAnswers[idx] ?? "";
									const filled = isLessonExamAnswer(value);
									const missing = missingParts.includes(idx);
									return (
										<div
											key={idx}
											className={
												"space-y-2 rounded-xl border p-3 transition-colors " +
												(missing
													? "border-destructive bg-destructive/5"
													: filled
														? "border-[var(--cel-success,var(--lh-success))]/55 bg-background/60"
														: "border-border/60 bg-background/50")
											}
										>
											<label htmlFor={fieldId} className="flex items-start gap-2.5 text-sm leading-snug">
												<span
													aria-hidden="true"
													className={
														"mt-0.5 inline-grid size-5 shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums " +
														(filled
															? "bg-[var(--cel-success,var(--lh-success))] text-[var(--cel-on-fill,#07070b)]"
															: "bg-[var(--cel-accent,var(--primary))] text-[var(--cel-on-fill,#07070b)]")
													}
												>
													{idx + 1}
												</span>
												<span className="font-medium text-foreground">{item.label}</span>
											</label>
											<textarea
												id={fieldId}
												data-testid={`exam-part-${idx + 1}`}
												className={
													"cel-input lh-input w-full resize-y p-2.5 text-[15px] " +
													(item.multiline === false ? "min-h-14" : "min-h-20")
												}
												value={value}
												placeholder={item.placeholder ?? t("lesson.examCard.partPlaceholder", { index: idx + 1 })}
												maxLength={4000}
												aria-invalid={missing || undefined}
												onChange={(event) => {
													const nextVal = event.target.value;
													setPartAnswers((prev) => {
														const copy = [...prev];
														copy[idx] = nextVal;
														return copy;
													});
													setMissingParts((prev) => prev.filter((m) => m !== idx));
													setError("");
												}}
											/>
										</div>
									);
								})}
							</div>
						</>
					) : (
						<>
							<div className="flex flex-wrap items-center justify-between gap-2">
								<label htmlFor={label} className="text-sm font-semibold">
									{t("lesson.examCard.answer")}
								</label>
								{parts.length >= 2 && (
									<button
										type="button"
										className="text-xs font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground"
										onClick={() => {
											setFreeMode(false);
											setError("");
										}}
									>
										{t("lesson.examCard.backToParts", { count: parts.length })}
									</button>
								)}
							</div>
							<textarea
								id={label}
								className="cel-input lh-input min-h-28 w-full resize-y p-3"
								value={answer}
								maxLength={12000}
								onChange={(event) => {
									setAnswer(event.target.value);
									setError("");
								}}
							/>
						</>
					)}
					<div className="flex flex-wrap items-center justify-between gap-2">
						<p className="text-xs text-muted-foreground">{t("lesson.examCard.submitNote")}</p>
						<button
							className="cel-button cel-button-primary px-4 py-2 text-sm"
							disabled={actions.examBusy || delivering || !canSubmit}
						>
							{t("lesson.examCard.submit")}
						</button>
					</div>
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}
				</form>
			)}
		</section>
	);
}
