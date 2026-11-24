"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { useT } from "@/components/i18n";
import { useServerEvent, useServerResync } from "@/components/server-events";
import type { DomainCreationStatus, TreeEnrichmentStatus } from "@/src/core";

function formatElapsed(startedAt: number | undefined, now: number): string {
	if (!startedAt) return "";
	const sec = Math.max(0, Math.floor((now - startedAt) / 1000));
	const m = Math.floor(sec / 60);
	const s = sec % 60;
	return `${m}:${String(s).padStart(2, "0")}`;
}

export function BackgroundTasksPill() {
	const t = useT();
	const [creation, setCreation] = useState<DomainCreationStatus | null>(null);
	const [enrichments, setEnrichments] = useState<TreeEnrichmentStatus[]>([]);
	const [dismissed, setDismissed] = useState<Record<string, boolean>>({});
	const [now, setNow] = useState(() => Date.now());
	const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	const refresh = useCallback(async () => {
		try {
			const [cRes, eRes] = await Promise.all([
				fetch("/api/domains/create", { cache: "no-store" }).catch(() => null),
				fetch("/api/study/enrich", { cache: "no-store" }).catch(() => null),
			]);
			if (cRes?.ok) {
				const data = (await cRes.json()) as { active?: DomainCreationStatus | null };
				setCreation(data.active ?? null);
			}
			if (eRes?.ok) {
				const data = (await eRes.json()) as { active?: TreeEnrichmentStatus[] };
				setEnrichments(Array.isArray(data.active) ? data.active : []);
			}
		} catch {
			// Keep previous state on transient network hiccup.
		}
	}, []);

	const scheduleRefresh = useCallback(() => {
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => {
			debounceRef.current = undefined;
			void refresh();
		}, 200);
	}, [refresh]);

	useEffect(() => {
		void refresh();
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [refresh]);

	useServerEvent("activity-changed", scheduleRefresh);
	useServerResync(() => void refresh());

	const creationRunning = creation?.state === "planning" || creation?.state === "materials";
	const anyRunning = creationRunning || enrichments.some((e) => e.state === "running");

	useEffect(() => {
		if (!anyRunning) return;
		setNow(Date.now());
		const tick = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(tick);
	}, [anyRunning]);

	const creationFinishedAt = creation && (creation.state === "ready" || creation.state === "failed") ? (creation.finishedAt ?? 0) : 0;
	const creationKey = creation ? `c:${creation.requestId ?? "active"}:${creation.state}:${creationFinishedAt}` : "";
	const showCreation = Boolean(creation && (creationRunning || !dismissed[creationKey]));
	const visibleEnrichments = enrichments.filter((e) => {
		const key = `e:${e.domain}:${e.state}:${e.finishedAt ?? 0}`;
		return e.state === "running" || !dismissed[key];
	});

	if (!showCreation && !visibleEnrichments.length) return null;

	return (
		<aside
			aria-live="polite"
			aria-label={t("map.bg.creatingDomain")}
			className="pointer-events-none fixed right-4 bottom-4 z-40 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
		>
			{showCreation && creation && (
				<div className="pointer-events-auto cel-card border-border/80 bg-card/95 p-3 shadow-lg backdrop-blur-sm">
					<div className="flex items-start justify-between gap-2">
						<div className="flex min-w-0 items-center gap-2">
							{creationRunning ? (
								<span aria-hidden="true" className="size-2.5 shrink-0 animate-pulse rounded-full bg-[var(--c-teal,#2ec4b6)]" />
							) : creation.state === "ready" ? (
								<Icon name="check" size={16} />
							) : (
								<span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-destructive" />
							)}
							<span className="truncate text-xs font-bold text-foreground">
								{creationRunning
									? t("map.bg.creatingDomain")
									: creation.state === "ready"
										? t("map.bg.domainReady")
										: t("map.bg.domainFailed")}
							</span>
						</div>
						<div className="flex shrink-0 items-center gap-1.5">
							{creationRunning && creation.startedAt && (
								<span className="font-mono text-[11px] text-muted-foreground tabular-nums">
									{formatElapsed(creation.startedAt, now)}
								</span>
							)}
							{!creationRunning && (
								<button
									type="button"
									aria-label={t("map.tree.enrichDismiss")}
									onClick={() => setDismissed((prev) => ({ ...prev, [creationKey]: true }))}
									className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
								>
									<Icon name="close" size={13} tone={false} />
								</button>
							)}
						</div>
					</div>

					{(creation.topic || (creation.state === "ready" && creation.title)) && (
						<p className="mt-1 truncate text-xs font-medium text-foreground/90">
							{creation.state === "ready" ? creation.title : creation.topic}
						</p>
					)}

					{creationRunning && (
						<>
							<div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
								<span className="truncate">
									{creation.state === "materials" ? t("pages.creator.findingMaterials") : t("pages.creator.organizingTree")}
									{creation.currentLabel ? ` · ${creation.currentLabel}` : ""}
								</span>
								{creation.total > 0 && (
									<span className="shrink-0 font-mono tabular-nums">
										{creation.done}/{creation.total}
									</span>
								)}
							</div>
							<progress
								className="study-progress mt-1.5 block w-full"
								value={creation.total > 0 ? creation.done : undefined}
								max={creation.total > 0 ? creation.total : undefined}
							/>
						</>
					)}

					{creation.state === "failed" && (
						<p className="mt-1 line-clamp-2 text-[11px] text-destructive">{creation.error}</p>
					)}

					<div className="mt-2 flex items-center justify-between gap-2 text-xs">
						{creation.state === "ready" ? (
							<Link
								href={`/mapa?dominio=${encodeURIComponent(creation.domainId)}`}
								onClick={() => setDismissed((prev) => ({ ...prev, [creationKey]: true }))}
								className="font-semibold text-[var(--cel-accent,var(--primary))] hover:underline"
							>
								{t("map.bg.openMap")} →
							</Link>
						) : (
							<Link href="/dominios/novo" className="font-semibold text-foreground/85 hover:underline">
								{t("map.bg.viewProgress")} →
							</Link>
						)}
					</div>
				</div>
			)}

			{visibleEnrichments.map((job) => {
				const key = `e:${job.domain}:${job.state}:${job.finishedAt ?? 0}`;
				const pct = job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;
				return (
					<div key={job.domain} className="pointer-events-auto cel-card border-border/80 bg-card/95 p-3 shadow-lg backdrop-blur-sm">
						<div className="flex items-start justify-between gap-2">
							<div className="flex min-w-0 items-center gap-2">
								{job.state === "running" ? (
									<span aria-hidden="true" className="size-2.5 shrink-0 animate-pulse rounded-full bg-[var(--c-teal,#2ec4b6)]" />
								) : job.state === "done" ? (
									<Icon name="check" size={16} />
								) : (
									<span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-muted-foreground" />
								)}
								<span className="truncate text-xs font-bold text-foreground">
									{job.state === "running" ? t("map.bg.enrichingTree") : t("map.bg.enrichmentDone")} · {job.domainTitle}
								</span>
							</div>
							<div className="flex shrink-0 items-center gap-1.5">
								{job.state === "running" && (
									<span className="font-mono text-[11px] text-muted-foreground tabular-nums">
										{formatElapsed(job.startedAt, now)}
									</span>
								)}
								{job.state !== "running" && (
									<button
										type="button"
										aria-label={t("map.tree.enrichDismiss")}
										onClick={() => setDismissed((prev) => ({ ...prev, [key]: true }))}
										className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
									>
										<Icon name="close" size={13} tone={false} />
									</button>
								)}
							</div>
						</div>

						{job.state === "running" && (
							<>
								<div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
									<span className="truncate">
										{job.currentRegionTitle ? t("map.tree.enrichCurrentRegion", { region: job.currentRegionTitle }) : t("map.tree.enrichingTree")}
									</span>
									<span className="shrink-0 font-mono tabular-nums">
										{job.done}/{job.total} ({pct}%)
									</span>
								</div>
								<progress className="study-progress mt-1.5 block w-full" value={job.done} max={Math.max(1, job.total)} />
							</>
						)}

						<p className="mt-1.5 text-[11px] text-muted-foreground tabular-nums">
							{t("map.tree.enrichStats", { books: job.addedBooks, videos: job.addedVideos, upgraded: job.upgraded })}
						</p>

						<div className="mt-2 flex items-center justify-between gap-2 text-xs">
							<Link
								href={`/mapa?dominio=${encodeURIComponent(job.domain)}`}
								className="font-semibold text-[var(--cel-accent,var(--primary))] hover:underline"
							>
								{t("map.bg.openMap")} →
							</Link>
							{job.state === "running" && (
								<button
									type="button"
									onClick={() => void fetch(`/api/study/enrich?domain=${encodeURIComponent(job.domain)}`, { method: "DELETE" })}
									className="text-[11px] font-semibold text-muted-foreground underline hover:text-foreground"
								>
									{t("map.tree.enrichCancel")}
								</button>
							)}
						</div>
					</div>
				);
			})}
		</aside>
	);
}
