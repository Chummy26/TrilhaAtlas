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
	const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null);
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
		if (!open) {
			setConfirmDelete(null);
			return;
		}
		const close = (e: MouseEvent) => {
			if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (confirmDelete) setConfirmDelete(null);
				else setOpen(false);
			}
		};
		window.addEventListener("mousedown", close);
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("mousedown", close);
			window.removeEventListener("keydown", onKey);
		};
	}, [open, confirmDelete]);

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

	const remove = async (target: { id: string; title: string }) => {
		if (busy) return;
		setBusy(true);
		setError(null);
		const res = await fetch("/api/domains", {
			method: "DELETE",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ id: target.id }),
		}).catch(() => null);
		if (res?.ok) {
			const body = (await res.json().catch(() => null)) as (StudyDomainList & { activeChanged?: boolean }) | null;
			setConfirmDelete(null);
			if (body?.activeChanged) {
				window.location.assign("/");
				return;
			}
			if (body) setList({ domains: body.domains, active: body.active });
			else read();
			setBusy(false);
			return;
		}
		const body = (await res?.json().catch(() => null)) as { error?: string } | null;
		setError(body?.error ?? t("shell.domain.removeError"));
		setConfirmDelete(null);
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
				onClick={() => {
					setError(null);
					setOpen((v) => !v);
				}}
				className="cel-chip h-9 cursor-pointer gap-2 px-3 text-sm"
			>
				<Icon name={icon} size={18} />
				<span className="min-w-0 truncate">{label}</span>
				<Icon name="domain-switch" size={14} tone={false} />
			</button>
			{open && (
				<div className="cel-card absolute left-0 top-11 z-30 min-w-64 max-w-80 p-1.5">
					{confirmDelete ? (
						<div className="space-y-3 p-2" role="alertdialog" aria-label={t("shell.domain.removeTitle", { title: confirmDelete.title })}>
							<div className="space-y-1">
								<p className="text-sm font-semibold text-foreground">
									{t("shell.domain.removeTitle", { title: confirmDelete.title })}
								</p>
								<p className="text-xs leading-relaxed text-muted-foreground">
									{t("shell.domain.removeHint")}
								</p>
							</div>
							<div className="flex items-center justify-end gap-2">
								<button
									type="button"
									disabled={busy}
									onClick={() => setConfirmDelete(null)}
									className="cursor-pointer rounded-lg border border-border/60 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
								>
									{t("shell.domain.removeCancel")}
								</button>
								<button
									type="button"
									data-testid={`domain-remove-confirm-${confirmDelete.id}`}
									disabled={busy}
									onClick={() => void remove(confirmDelete)}
									className="cursor-pointer rounded-lg border border-destructive/50 bg-destructive/15 px-2.5 py-1.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/25 disabled:opacity-50"
								>
									{t("shell.domain.removeConfirm")}
								</button>
							</div>
						</div>
					) : (
						<>
							<ul role="listbox" aria-label={t("shell.domain.switcherLabel")} className="max-h-[50dvh] space-y-0.5 overflow-y-auto">
								{[...list.domains.map((d) => ({ id: d.id as string | null, title: d.title.pt, icon: d.icon })), generalDomain].map((d) => {
									const active = d.id === list.active;
									return (
										<li key={d.id ?? "geral"} className="group flex items-center gap-0.5">
											<button
												type="button"
												role="option"
												aria-selected={active}
												disabled={busy}
												onClick={() => void choose(d.id)}
												className={
													"flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors " +
													(active ? "bg-accent font-semibold text-foreground" : "hover:bg-accent/70")
												}
											>
												<Icon name={d.icon as IconName} size={20} />
												<span className="min-w-0 flex-1 truncate">{d.title}</span>
												{active && <Icon name="check" size={15} tone={false} />}
											</button>
											{d.id !== null && (
												<button
													type="button"
													data-testid={`domain-remove-${d.id}`}
													aria-label={t("shell.domain.removeAria", { title: d.title })}
													title={t("shell.domain.removeAria", { title: d.title })}
													disabled={busy}
													onClick={(e) => {
														e.stopPropagation();
														setError(null);
														setConfirmDelete({ id: d.id!, title: d.title });
													}}
													className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-45 transition-all hover:bg-destructive/15 hover:text-destructive hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-90"
												>
													<Icon name="trash" size={14} tone={false} />
												</button>
											)}
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
						</>
					)}
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
