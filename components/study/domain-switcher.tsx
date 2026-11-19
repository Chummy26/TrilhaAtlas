"use client";

/**
 * Domain switcher — the study-world pill in the home header (estudos-sota).
 * Lists "Geral" (the original world) plus every study domain; picking one
 * POSTs /api/domains and reloads, since chats, graph and jobs all follow
 * the active world. A 409 (a turn or job still running) is shown inline.
 * Other windows follow through the "domain-changed" server event.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
import type { IconName } from "@/components/icons/generated";
import { useServerEvent } from "@/components/server-events";
import type { StudyDomainList } from "@/src/core";

const GENERAL = { id: null, title: "Geral", icon: "domain-generic" } as const;

export function DomainSwitcher() {
	const [list, setList] = useState<StudyDomainList | null>(null);
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
	useEffect(read, [read]);

	useServerEvent("domain-changed", (payload) => {
		if (list && payload.domainId !== list.active) window.location.assign("/");
	});

	useEffect(() => {
		if (!open) return;
		const close = (e: MouseEvent) => {
			if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
		};
		window.addEventListener("mousedown", close);
		return () => window.removeEventListener("mousedown", close);
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
		setError(body?.error ?? "Não foi possível trocar de domínio.");
		setBusy(false);
	};

	if (!list) return null;
	const current = list.domains.find((d) => d.id === list.active);
	const label = current ? current.title.pt : GENERAL.title;
	const icon = (current?.icon ?? GENERAL.icon) as IconName;

	return (
		<div ref={rootRef} className="lh-no-drag relative" data-testid="domain-switcher">
			<button
				type="button"
				aria-haspopup="listbox"
				aria-expanded={open}
				disabled={busy}
				onClick={() => setOpen((v) => !v)}
				className="cel-chip h-8 cursor-pointer text-sm"
			>
				<Icon name={icon} size={18} />
				{label}
				<Icon name="domain-switch" size={14} tone={false} />
			</button>
			{open && (
				<ul role="listbox" aria-label="Domínio de estudo" className="cel-card absolute left-0 top-10 z-30 min-w-52 p-1.5">
					{[...list.domains.map((d) => ({ id: d.id as string | null, title: d.title.pt, icon: d.icon })), GENERAL].map((d) => (
						<li key={d.id ?? "geral"}>
							<button
								type="button"
								role="option"
								aria-selected={d.id === list.active}
								onClick={() => void choose(d.id)}
								className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent aria-selected:font-semibold"
							>
								<Icon name={d.icon as IconName} size={20} />
								{d.title}
							</button>
						</li>
					))}
				</ul>
			)}
			{error && (
				<p role="alert" className="cel-card absolute left-0 top-10 z-30 w-72 p-2.5 text-xs text-destructive">
					{error}
				</p>
			)}
		</div>
	);
}
