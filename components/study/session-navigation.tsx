"use client";

import Link from "next/link";
import { DumbbellIcon } from "lucide-react";
import { Icon } from "@/components/icons/icon";
import { DomainSwitcher } from "./domain-switcher.tsx";
import type { StudyDomainList } from "@/src/core";

export interface StudyNavigationProps {
	domains?: StudyDomainList;
	account?: { level: number; xp: number };
}

export function StudyNavigation({ domains, account }: StudyNavigationProps) {
	return <>
		<div className="pointer-events-auto">
			<DomainSwitcher initialList={domains} />
		</div>
		<Link
			href="/profile"
			aria-label="Perfil e experiência"
			className="cel-chip lh-no-drag pointer-events-auto h-9 gap-2 px-3 text-sm font-semibold hover:bg-accent"
			data-testid="profile-link"
		>
			<Icon name="profile" size={19} />
			<span>Perfil</span>
			{account && (
				<span className="border-l border-border/60 pl-2 text-xs font-medium text-muted-foreground tabular-nums">
					Nv. {account.level} · {account.xp.toLocaleString("pt-BR")} XP
				</span>
			)}
		</Link>
	</>;
}

export function SessionModeSwitch({ mode, onChange }: { mode: "teach" | "practice"; onChange: (mode: "teach" | "practice") => void }) {
	return (
		<div className="flex items-center gap-0.5 rounded-lg border border-border/60 bg-background p-0.5" data-testid="home-mode-switch">
			{(["teach", "practice"] as const).map((m) => (
				<button
					key={m}
					type="button"
					data-testid={`home-mode-${m}`}
					aria-pressed={mode === m}
					onClick={() => onChange(m)}
					className={
						"flex items-center gap-1 rounded-md px-2.5 py-0.5 text-xs font-medium uppercase tracking-wider transition-colors " +
						(mode === m
							? "bg-accent text-foreground shadow-2xs"
							: "text-muted-foreground hover:text-foreground")
					}
				>
					{m === "practice" ? <DumbbellIcon aria-hidden="true" className="size-3" /> : null}
					{m === "teach" ? "Teach" : "Practice"}
				</button>
			))}
		</div>
	);
}
