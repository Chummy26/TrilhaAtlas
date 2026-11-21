"use client";

/**
 * Domain switcher — the study-world pill in the home header (estudos-sota).
 * Lists "Geral" (the original world) plus every study domain; picking one
 * POSTs /api/domains and reloads, since chats, graph and jobs all follow
 * the active world. A 409 (a turn or job still running) is shown inline.
 * Other windows follow through the "domain-changed" server event.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/icon";
import type { IconName } from "@/components/icons/generated";
import { useServerEvent } from "@/components/server-events";
import { useT } from "@/components/i18n";
import type { StudyDomainList } from "@/src/core";

export function DomainSwitcher({ initialList }: { initialList?: StudyDomainList } = {}) {
	const t = useT();
	const generalDomain = { id: null, title: t("shell.domain.general"), icon: "domain-generic" } as const;
	const [list, setList] = useState<StudyDomainList | null>(initialList ?? null);
	const [open, setOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);

	const read = useCallback(() => {
		fetch("/api/domains")
			.then((r) => (r.ok ? (r.json() as Promise<StudyDomainList>) : null))
			.then((body) => body && setList(body))
			.catch(() => {});
	}, []);
	useEffect(() => { if (initialList) setList(initialList); else read(); }, [initialList, read]);

	useServerEvent("domain-changed", (payload) => {
		if (list && payload.domainId !== list.active) window.location.assign("/");
	});

	useEffect(() => {
		if (!open) return;
		const close = (e: MouseEvent) => {
			if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		window.addEventListener("mousedown", close);
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("mousedown", close);
			window.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const choose = async (id: string | null) => {
		if (!list || id === list.active) {
			setOpen(false);
			return;
		}
		setBusy(true);
		setError(null);
		const res = await fetch("/api/domains", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ active: id }),
		}).catch(() => null);
		if (res?.ok) {
			window.location.assign("/");
			return;
		}
		const body = (await res?.json().catch(() => null)) as { error?: string } | null;
		setError(body?.error ?? t("shell.domain.switchError"));
		setBusy(false);
	};

	if (!list) return null;
	const current = list.domains.find((d) => d.id === list.active);
	const label = current ? current.title.pt : generalDomain.title;
	const icon = (current?.icon ?? generalDomain.icon) as IconName;

	return (
		<div ref={rootRef} className="lh-no-drag relative" data-testid="domain-switcher">
			<button
				type="button"
				aria-haspopup="listbox"
				aria-expanded={open}
				title={label}
				disabled={busy}
				onClick={() => setOpen((v) => !v)}
				className="cel-chip h-9 cursor-pointer gap-2 px-3 text-sm"
			>
				<Icon name={icon} size={18} />
				<span className="min-w-0 truncate">{label}</span>
				<Icon name="domain-switch" size={14} tone={false} />
			</button>
			{open && (
				<div className="cel-card absolute left-0 top-11 z-30 min-w-56 p-1.5">
					<ul role="listbox" aria-label={t("shell.domain.switcherLabel")} className="max-h-[50dvh] space-y-0.5 overflow-y-auto">
						{[...list.domains.map((d) => ({ id: d.id as string | null, title: d.title.pt, icon: d.icon })), generalDomain].map((d) => {
							const active = d.id === list.active;
							return (
								<li key={d.id ?? "geral"}>
									<button
										type="button"
										role="option"
										aria-selected={active}
										onClick={() => void choose(d.id)}
										className={
											"flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors " +
											(active ? "bg-accent font-semibold text-foreground" : "hover:bg-accent/70")
										}
									>
										<Icon name={d.icon as IconName} size={20} />
										<span className="min-w-0 flex-1 truncate">{d.title}</span>
										{active && <Icon name="check" size={15} tone={false} />}
									</button>
								</li>
							);
						})}
					</ul>
					<div className="mt-1.5 border-t border-border/55 pt-1.5">
						<Link
							href="/dominios/novo"
							onClick={() => setOpen(false)}
							className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold text-[var(--cel-accent-text,var(--foreground))] transition-colors hover:bg-accent"
						>
							<Icon name="plus" size={16} tone={false} />
							{t("shell.domain.create")}
						</Link>
					</div>
				</div>
			)}
			{error && (
				<p role="alert" className="cel-card absolute left-0 top-11 z-30 w-72 p-2.5 text-xs text-destructive">
					{error}
				</p>
			)}
		</div>
	);
}
