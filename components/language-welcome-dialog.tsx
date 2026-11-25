"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, GlobeIcon } from "lucide-react";
import { LOCALES, matchLocale, type Locale, type UserSettings } from "@/src/core";
import { HostDialog } from "@/components/host-dialog";
import { useI18n } from "@/components/i18n";
import { TrilhaAtlasMark } from "@/components/lh-mark";
import { notifySettingsSaved } from "@/components/settings-signal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** First-launch check: show when server-booted settings have no saved language yet. */
export function shouldShowLanguageWelcome(initialSettings: UserSettings | null | undefined): boolean {
	return initialSettings !== undefined && !initialSettings?.general?.language;
}

/** Detect the best matching supported locale from browser/OS preferences. */
export function detectPreferredLocale(languages?: readonly string[] | null): Locale | null {
	if (!languages?.length) return null;
	for (const tag of languages) {
		const matched = matchLocale(tag);
		if (matched) return matched;
	}
	return null;
}

export function LanguageWelcomeBody({
	selected,
	saving,
	error,
	titleId,
	descriptionId,
	onSelect,
	onConfirm,
}: {
	selected: Locale;
	saving: boolean;
	error: string | null;
	titleId: string;
	descriptionId: string;
	onSelect: (locale: Locale) => void;
	onConfirm: () => void;
}) {
	const { t } = useI18n();
	return (
		<div className="flex flex-col gap-5 p-6">
			<div className="flex items-start gap-3">
				<div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/60 text-foreground">
					<TrilhaAtlasMark className="size-5" />
				</div>
				<div className="min-w-0 flex-1 space-y-1">
					<div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
						<GlobeIcon className="size-3.5" aria-hidden="true" />
						<span>TrilhaAtlas</span>
					</div>
					<h2 id={titleId} className="text-xl font-semibold tracking-tight text-foreground">
						{t("common.language.welcome.title")}
					</h2>
					<p id={descriptionId} className="text-sm leading-relaxed text-muted-foreground">
						{t("common.language.welcome.subtitle")}
					</p>
				</div>
			</div>

			<div
				role="radiogroup"
				aria-labelledby={titleId}
				className="grid grid-cols-1 gap-2 sm:grid-cols-2"
				data-testid="language-welcome-options"
			>
				{LOCALES.map((item) => {
					const active = item.code === selected;
					return (
						<button
							key={item.code}
							type="button"
							role="radio"
							aria-checked={active}
							lang={item.code}
							disabled={saving}
							data-testid={`language-welcome-option-${item.code}`}
							onClick={() => onSelect(item.code)}
							className={cn(
								"flex items-center justify-between gap-2 rounded-lg border px-3.5 py-2.5 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
								active
									? "border-primary bg-primary/10 text-foreground"
									: "border-border bg-background/70 text-foreground hover:border-foreground/30 hover:bg-accent/60",
							)}
						>
							<span className="truncate">{item.label}</span>
							<span
								aria-hidden="true"
								className={cn(
									"flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
									active
										? "border-primary bg-primary text-primary-foreground"
										: "border-muted-foreground/40",
								)}
							>
								{active && <CheckIcon className="size-3" strokeWidth={2.5} />}
							</span>
						</button>
					);
				})}
			</div>

			{error && (
				<p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="language-welcome-error">
					{error}
				</p>
			)}

			<div className="flex flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
				<p className="text-xs text-muted-foreground">
					{t("common.language.welcome.note")}
				</p>
				<Button
					type="button"
					disabled={saving}
					data-testid="language-welcome-confirm"
					onClick={onConfirm}
					className="shrink-0"
				>
					{saving ? t("common.language.welcome.saving") : t("common.action.continue")}
				</Button>
			</div>
		</div>
	);
}

/**
 * First-launch language picker. Appears once when `general.language` has not
 * been saved yet, pre-selecting the OS/browser locale when supported and
 * previewing each choice live before persisting to `PUT /api/settings/general`.
 */
export function LanguageWelcomeDialog({
	initialSettings,
}: {
	initialSettings?: UserSettings | null;
}) {
	const router = useRouter();
	const { locale, setLocale, t } = useI18n();
	const [dismissed, setDismissed] = useState(false);
	const [selected, setSelected] = useState<Locale>(locale);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const userPickedRef = useRef(false);
	const titleId = useId();
	const descriptionId = useId();

	const open = !dismissed && shouldShowLanguageWelcome(initialSettings);

	// Pre-select the browser/OS language on first launch if supported.
	useEffect(() => {
		if (!open || userPickedRef.current || typeof navigator === "undefined") return;
		const tags = navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : [];
		const detected = detectPreferredLocale(tags);
		if (detected && detected !== locale) {
			setSelected(detected);
			setLocale(detected);
		}
	}, [open, locale, setLocale]);

	const handleSelect = (next: Locale) => {
		userPickedRef.current = true;
		setSelected(next);
		setError(null);
		setLocale(next);
	};

	const handleConfirm = async () => {
		if (saving) return;
		setSaving(true);
		setError(null);
		try {
			const res = await fetch("/api/settings/general", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ...initialSettings?.general, language: selected }),
			});
			if (!res.ok) {
				setError(t("common.language.welcome.error"));
				setSaving(false);
				return;
			}
			setLocale(selected);
			notifySettingsSaved("general");
			setDismissed(true);
			router.refresh();
		} catch {
			setError(t("common.language.welcome.error"));
			setSaving(false);
		}
	};

	const handleClose = () => {
		if (saving) return;
		setDismissed(true);
	};

	return (
		<HostDialog
			open={open}
			onClose={handleClose}
			aria-labelledby={titleId}
			aria-describedby={descriptionId}
			backdropProps={{
				"data-testid": "language-welcome-backdrop",
				className: "fixed inset-0 flex items-center justify-center bg-background/75 p-4 backdrop-blur-xs",
			}}
			frame={
				<div
					data-testid="language-welcome-dialog"
					className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xl"
				/>
			}
		>
			<LanguageWelcomeBody
				selected={selected}
				saving={saving}
				error={error}
				titleId={titleId}
				descriptionId={descriptionId}
				onSelect={handleSelect}
				onConfirm={() => void handleConfirm()}
			/>
		</HostDialog>
	);
}
