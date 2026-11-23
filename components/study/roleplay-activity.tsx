"use client";

import { useContext, useId, useRef, useState } from "react";
import { Clock, ListChecks, MapPin, MessageSquare, Send, Sparkles, Target, UserCheck, UserRound } from "lucide-react";
import { ChatActionsContext } from "@/components/chat-actions-context";
import { useT } from "@/components/i18n";
import { formatRoleplayClosePrompt, formatRoleplayMovePrompt, type LessonActivity } from "@/src/core";

/**
 * Interactive situated micro-scenario and rubric-evaluated roleplay card.
 * Sends in-character learner moves and rubric closure requests directly into
 * the active lesson conversation through ChatActionsContext.askActivity.
 */
export function RoleplayActivity({ activity }: { activity: LessonActivity }) {
	const t = useT();
	const actions = useContext(ChatActionsContext);
	const inputId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const [move, setMove] = useState("");
	const [sending, setSending] = useState(false);
	const [sentNotice, setSentNotice] = useState(false);

	const rp = activity.roleplay;
	if (!rp) return null;

	const { persona, criteria } = rp;
	const title = activity.title?.trim() || t("lesson.roleplay.badge");
	const minutes = rp.minutes ?? 5;
	const canChat = Boolean(actions?.askActivity);

	async function sendMove(text: string) {
		const trimmed = text.trim();
		if (!trimmed || !actions?.askActivity || sending) return;
		setSending(true);
		setSentNotice(false);
		try {
			const sent = await actions.askActivity(formatRoleplayMovePrompt(title, trimmed, persona));
			if (sent) {
				setMove("");
				setSentNotice(true);
			}
		} finally {
			setSending(false);
		}
	}

	async function handleSubmit(event: React.FormEvent) {
		event.preventDefault();
		await sendMove(move);
	}

	async function handleRequestRubric() {
		if (!actions?.askActivity || sending) return;
		setSending(true);
		setSentNotice(false);
		try {
			const sent = await actions.askActivity(formatRoleplayClosePrompt(title, criteria));
			if (sent) setSentNotice(true);
		} finally {
			setSending(false);
		}
	}

	return (
		<section
			className="cel-card my-4 space-y-4 p-4 md:p-5"
			data-kind="roleplay"
			data-scene={rp.scene}
			aria-label={title}
			onKeyDown={(e) => {
				if (e.key === "Enter") e.stopPropagation();
			}}
		>
			<header className="space-y-2 border-b border-border/50 pb-3">
				<div className="flex flex-wrap items-center gap-2">
					<span className="study-pill study-pill-accent inline-flex items-center gap-1.5">
						<MessageSquare className="size-3.5" aria-hidden="true" />
						{t("lesson.roleplay.badge")}
					</span>
					<span className="study-pill inline-flex items-center gap-1 tabular-nums">
						<Clock className="size-3.5" aria-hidden="true" />
						{t("lesson.roleplay.minutes", { min: minutes })}
					</span>
					{rp.scene && (
						<span className="study-pill inline-flex items-center gap-1 capitalize">
							<MapPin className="size-3.5" aria-hidden="true" />
							{rp.scene}
						</span>
					)}
				</div>
				<h3 className="cel-display text-lg font-bold leading-snug text-foreground">{title}</h3>
			</header>

			<div className="grid gap-2.5 sm:grid-cols-3">
				<div className="rounded-xl border border-border/55 bg-background/60 px-3 py-2.5">
					<div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
						<UserRound className="size-3.5 shrink-0" aria-hidden="true" />
						<span>{t("lesson.roleplay.personaLabel")}</span>
					</div>
					<p className="mt-1 text-sm font-semibold text-foreground">{rp.persona}</p>
				</div>
				<div className="rounded-xl border border-border/55 bg-background/60 px-3 py-2.5">
					<div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
						<UserCheck className="size-3.5 shrink-0" aria-hidden="true" />
						<span>{t("lesson.roleplay.yourRoleLabel")}</span>
					</div>
					<p className="mt-1 text-sm font-semibold text-foreground">{rp.learnerRole}</p>
				</div>
				<div className="rounded-xl border border-border/55 bg-background/60 px-3 py-2.5">
					<div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
						<Target className="size-3.5 shrink-0" aria-hidden="true" />
						<span>{t("lesson.roleplay.goalLabel")}</span>
					</div>
					<p className="mt-1 text-sm font-medium text-foreground">{rp.goal}</p>
				</div>
			</div>

			<div className="space-y-3">
				<div className="rounded-xl border border-border/50 bg-background/45 px-3.5 py-3">
					<p className="tutor-prose max-w-[65ch] text-[var(--lh-prose-size)] leading-[var(--lh-prose-leading)] text-foreground">
						{rp.scenario}
					</p>
				</div>

				<blockquote className="rounded-2xl rounded-tl-sm border-2 border-[var(--cel-accent,var(--primary))]/45 bg-[var(--cel-surface-2,var(--muted))]/45 px-4 py-3">
					<div className="text-xs font-bold uppercase tracking-wider text-[var(--cel-accent-text,var(--primary))]">
						{rp.persona}
					</div>
					<p
						lang={activity.language}
						className="tutor-prose mt-1 max-w-[65ch] text-[var(--lh-prose-size)] leading-[var(--lh-prose-leading)] text-foreground"
					>
						“{rp.openingLine}”
					</p>
				</blockquote>
			</div>

			<div className="rounded-xl border border-border/50 bg-background/55 px-3.5 py-3">
				<div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
					<ListChecks className="size-3.5 shrink-0" aria-hidden="true" />
					<span>{t("lesson.roleplay.criteriaHeading")}</span>
				</div>
				<ol className="mt-2 space-y-1.5 text-sm text-foreground/95">
					{rp.criteria.map((criterion, index) => (
						<li key={index} className="flex items-start gap-2.5">
							<span
								aria-hidden="true"
								className="mt-0.5 inline-grid size-5 shrink-0 place-items-center rounded-full bg-[var(--cel-accent,var(--primary))] text-xs font-bold tabular-nums text-[var(--cel-on-fill,#07070b)]"
							>
								{index + 1}
							</span>
							<span className="leading-snug">{criterion}</span>
						</li>
					))}
				</ol>
			</div>

			{rp.suggestedMoves && rp.suggestedMoves.length > 0 && (
				<div className="space-y-2">
					<div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
						<Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
						<span>{t("lesson.roleplay.suggestedHeading")}</span>
					</div>
					<div className="flex flex-wrap gap-2">
						{rp.suggestedMoves.map((suggestion, index) => (
							<button
								key={index}
								type="button"
								className="cel-chip text-left text-xs leading-snug"
								onClick={() => {
									setMove(suggestion);
									setSentNotice(false);
									inputRef.current?.focus();
								}}
							>
								{suggestion}
							</button>
						))}
					</div>
				</div>
			)}

			<form className="space-y-2.5 border-t border-border/50 pt-3" onSubmit={(e) => void handleSubmit(e)}>
				<label htmlFor={inputId} className="sr-only">
					{t("lesson.roleplay.inputPlaceholder")}
				</label>
				<input
					ref={inputRef}
					id={inputId}
					type="text"
					className="cel-input lh-input w-full px-3 py-2 text-[15px]"
					placeholder={t("lesson.roleplay.inputPlaceholder")}
					value={move}
					maxLength={1200}
					disabled={sending}
					onChange={(e) => {
						setMove(e.target.value);
						if (sentNotice) setSentNotice(false);
					}}
				/>
				<div className="flex flex-wrap items-center gap-2">
					<button
						type="submit"
						className="cel-button cel-button-primary inline-flex items-center gap-1.5 px-4 py-1.5 text-sm"
						disabled={!canChat || sending || !move.trim()}
					>
						<Send className="size-3.5" aria-hidden="true" />
						<span>{t("lesson.roleplay.sendMove")}</span>
					</button>
					<button
						type="button"
						className="cel-button cel-button-ghost inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm"
						disabled={!canChat || sending}
						onClick={() => void handleRequestRubric()}
					>
						<ListChecks className="size-3.5" aria-hidden="true" />
						<span>{t("lesson.roleplay.requestRubric")}</span>
					</button>
					{sentNotice && (
						<span role="status" aria-live="polite" className="text-sm font-medium text-[var(--cel-success-text,var(--lh-success))]">
							{t("lesson.roleplay.moveSent")}
						</span>
					)}
				</div>
			</form>

			{activity.source && (
				<footer className="border-t border-border/50 pt-3 text-sm text-muted-foreground">
					<details>
						<summary className="cursor-pointer font-semibold">{t("lesson.activity.source")}</summary>
						{/^https:\/\/[^\s]+$/i.test(activity.source) ? (
							<a
								href={activity.source}
								target="_blank"
								rel="noreferrer"
								className="mt-1 inline-block break-all underline underline-offset-2"
							>
								{activity.source}
							</a>
						) : (
							<p className="mt-1 text-foreground/85">{activity.source}</p>
						)}
					</details>
				</footer>
			)}
		</section>
	);
}
