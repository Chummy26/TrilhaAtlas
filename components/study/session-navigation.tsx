"use client";

import { useMemo } from "react";
import Link from "next/link";
import { DumbbellIcon } from "lucide-react";
import { Icon } from "@/components/icons/icon";
import { useI18n, useT } from "@/components/i18n";
import { DomainSwitcher } from "./domain-switcher.tsx";
import type { StudyDomainList } from "@/src/core";

export interface StudyNavigationProps {
	domains?: StudyDomainList;
	account?: { level: number; xp: number };
}

export function StudyNavigation({ domains, account }: StudyNavigationProps) {
	const { t, intl } = useI18n();
	const intFmt = useMemo(() => new Intl.NumberFormat(intl), [intl]);
	return (
		<>
			<div className="pointer-events-auto">
				<DomainSwitcher initialList={domains} />
			</div>
			<Link
				href="/profile"
				aria-label={t("pages.nav.profileAria")}
				className="cel-chip lh-no-drag pointer-events-auto h-9 gap-2 px-3 text-sm font-semibold hover:bg-accent"
				data-testid="profile-link"
			>
				<Icon name="profile" size={19} />
				<span>{t("pages.nav.profile")}</span>
				{account && (
					<span className="border-l border-border/60 pl-2 text-xs font-medium text-muted-foreground tabular-nums">
						{t("pages.nav.levelShort", {
							level: account.level,
							xp: intFmt.format(account.xp),
						})}
					</span>
				)}
			</Link>
		</>
	);
}

export function SessionModeSwitch({
	mode,
	onChange,
}: {
	mode: "teach" | "practice";
	onChange: (mode: "teach" | "practice") => void;
}) {
	const t = useT();
	return (
		<div
			className="ta-segmented"
			data-testid="home-mode-switch"
		>
			{(["teach", "practice"] as const).map((m) => (
				<button
					key={m}
					type="button"
					data-testid={`home-mode-${m}`}
					aria-pressed={mode === m}
					onClick={() => onChange(m)}
					className="ta-segmented-btn min-h-7 px-2.5 py-0.5 text-xs"
				>
					{m === "practice" ? <DumbbellIcon aria-hidden="true" className="size-3.5" /> : null}
					{m === "teach" ? t("pages.nav.modeTeach") : t("pages.nav.modePractice")}
				</button>
			))}
		</div>
	);
}
