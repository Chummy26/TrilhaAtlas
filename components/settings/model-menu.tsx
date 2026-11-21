"use client";
/**
 * The model menu (extracted 2026-09-20 from model-picker.tsx, owner ask:
 * the agent settings' role selects use the EXACT same dropdown as the
 * chat model selector — same look, same machine). The fuzzy search +
 * arrow-walk + Enter pick machine lives here once; each mount owns only
 * the popover shell (positioning, outside-click, Esc — the chat control
 * opens UP from the bottom bar, the settings rows open DOWN inside the
 * dialog).
 *
 * The appearance wave (2026-09-26) added the reading-font picker over the
 * same machine: FontMenuList (families instead of models, plus the
 * always-offerable DEFAULT row and a custom-family escape input).
 *
 * Keyboard machine (owner polish, 2026-09-17): focus STAYS in the search
 * field — ↑/↓ walk the filtered results (clamped, no wrap), Enter picks
 * the walked row (or the first result when nothing is walked).
 * stopPropagation keeps these keys out of every other listener while the
 * menu is open.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ModelCatalogEntry, ModelVendorId } from "@/src/core";
import {
	CLAUDE_CODE_PROVIDER,
	CUSTOM_PROVIDER,
	cleanModelDisplayName,
	compareModelsByRecency,
	fuzzyScore,
	inferModelVendor,
	subscriptionLabel,
	summarizeModelVendors,
} from "@/src/core";
import { useT } from "@/components/i18n";
import { formatTokens } from "@/components/usage-format";

function priceLabel(cost: ModelCatalogEntry["cost"], freeLabel: string): string {
	if (!cost) return "Unpriced";
	if (cost.input === 0 && cost.output === 0) return freeLabel;
	const fmt = (n: number) => `$${n < 1 ? n.toFixed(2).replace(/0$/, "") : n.toFixed(2)}`;
	return `${fmt(cost.input)}/${fmt(cost.output)}`;
}

/** The model dropdown body — instant fuzzy search, company/vendor filter tabs,
 *  and grouped sections to keep large catalogs (like OpenRouter) clean and scannable. */
export function ModelMenuList({
	models,
	effectiveId,
	effectiveProvider,
	onPick,
	footer,
	vision,
}: {
	/** The full catalog — undefined while it loads. */
	models: ModelCatalogEntry[] | undefined;
	/** Currently effective id (the row gets the quiet highlight). */
	effectiveId: string | undefined;
	/** The effective id's provider (model-slots wave: the catalog
	 *  federates multiple providers and ids can collide across them —
	 *  the highlight must match BOTH coordinates or it lands on the
	 *  wrong row). */
	effectiveProvider?: string;
	/** Receives the chosen entry. */
	onPick: (entry: ModelCatalogEntry) => void;
	/** Quiet footer note under the list (context-specific). */
	footer?: string;
	/** Vision slot: only image-capable models are selectable — plus every
	 *  custom-endpoint model, whose capability the endpoint may not report.
	 *  Image-capable ones float to the top. */
	vision?: boolean;
}) {
	const t = useT();
	const [query, setQuery] = useState("");
	const [selectedVendor, setSelectedVendor] = useState<"all" | ModelVendorId>("all");
	const [menuIdx, setMenuIdx] = useState<number | null>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLUListElement>(null);
	const tabsRef = useRef<HTMLDivElement>(null);

	// Vision slot: built-ins must report image input; custom-endpoint models
	// stay selectable (the endpoint may not report a modality). Image-capable
	// ones float to the top of the list.
	const visionItems = useMemo(
		() => (vision ? models?.filter((m) => m.input.includes("image") || m.provider === CUSTOM_PROVIDER.id) : models),
		[models, vision],
	);

	const vendorSummaries = useMemo(
		() => summarizeModelVendors(visionItems ?? []),
		[visionItems],
	);
	const showVendors = vendorSummaries.length > 1;
	const activeVendor: "all" | ModelVendorId =
		selectedVendor !== "all" && vendorSummaries.some((v) => v.vendor.id === selectedVendor)
			? selectedVendor
			: "all";

	const trimmedQuery = query.trim();
	const groupedMode = showVendors && activeVendor === "all" && trimmedQuery.length === 0;

	const results = useMemo(() => {
		const source = (visionItems ?? []).filter((m) =>
			activeVendor === "all" ? true : inferModelVendor(m).id === activeVendor,
		);
		const scored = source
			.map((item) => {
				const vendor = inferModelVendor(item);
				const score = fuzzyScore(
					query,
					item.provider,
					item.id,
					item.name,
					vendor.label,
					...vendor.aliases,
				);
				return { item, vendor, score };
			})
			.filter((entry) => entry.score !== null);

		scored.sort((a, b) => {
			if (vision) {
				const visionDelta = Number(b.item.input.includes("image")) - Number(a.item.input.includes("image"));
				if (visionDelta !== 0) return visionDelta;
			}
			if (groupedMode) {
				const vendorDelta = a.vendor.order - b.vendor.order;
				if (vendorDelta !== 0) return vendorDelta;
				// Direct / subscription providers surface ahead of OpenRouter within the same company.
				const aRouter = a.item.provider === "openrouter" ? 1 : 0;
				const bRouter = b.item.provider === "openrouter" ? 1 : 0;
				if (aRouter !== bRouter) return aRouter - bRouter;
			}
			return b.score! - a.score! || compareModelsByRecency(a.item, b.item);
		});
		return scored;
	}, [visionItems, activeVendor, query, vision, groupedMode]);

	useEffect(() => {
		searchRef.current?.focus();
	}, []);

	useEffect(() => {
		if (menuIdx === null) return;
		listRef.current?.querySelector(`[data-idx="${menuIdx}"]`)?.scrollIntoView({ block: "nearest" });
	}, [menuIdx]);

	const vendorLabel = (id: ModelVendorId, fallback: string) =>
		id === "other" ? t("settings.models.otherVendor") : fallback;

	const selectVendor = (vendor: "all" | ModelVendorId) => {
		setSelectedVendor(vendor);
		setMenuIdx(null);
		listRef.current?.scrollTo({ top: 0 });
		searchRef.current?.focus();
	};

	const renderRow = (entry: (typeof results)[number], index: number) => {
		const { item: m, vendor } = entry;
		const isSelected = m.id === effectiveId && m.provider === (effectiveProvider ?? m.provider);
		const isWalked = index === menuIdx;
		const subLabel = subscriptionLabel(`${m.provider}:${m.id}`);
		const isFree = !subLabel && m.provider !== CLAUDE_CODE_PROVIDER && m.cost?.input === 0 && m.cost?.output === 0;
		const displayName = showVendors ? cleanModelDisplayName(m, vendor) : m.name;
		const priceText = m.provider === CLAUDE_CODE_PROVIDER
			? "CLI billing"
			: subLabel ?? priceLabel(m.cost, t("settings.models.free"));
		const priceTitle = m.provider === CLAUDE_CODE_PROVIDER
			? "Billing is determined by your Claude Code configuration; LearnHarness does not estimate it."
			: subLabel
				? "Subscription connection"
				: m.cost
					? "USD per 1M tokens in/out"
					: "Price unavailable";

		return (
			<li key={`${m.provider}/${m.id}`}>
				<button
					type="button"
					data-testid={`model-option-${m.id.replace(/[^a-z0-9-]/gi, "_")}`}
					data-idx={index}
					onClick={() => onPick(m)}
					className={`group flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-muted/80 ${
						isWalked ? "bg-accent/45 ring-1 ring-inset ring-border" : ""
					}${isSelected && !isWalked ? " bg-muted/60" : ""}`}
				>
					<span className="flex items-center justify-between gap-2">
						<span className="flex min-w-0 items-center gap-1.5">
							{showVendors && !groupedMode && (
								<span
									className="size-1.5 shrink-0 rounded-full"
									style={{ backgroundColor: vendor.accent }}
									aria-hidden
								/>
							)}
							<span className="truncate font-medium text-card-foreground">{displayName}</span>
							{isSelected && (
								<span className="shrink-0 text-[11px] font-semibold text-foreground" aria-hidden>✓</span>
							)}
						</span>
						<span
							className={`shrink-0 tabular-nums ${
								isFree
									? "rounded-full bg-[color-mix(in_srgb,var(--lh-success,#22c55e)_15%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--cel-success-text,var(--lh-success,#22c55e))]"
									: subLabel
										? "rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground/85"
										: "text-muted-foreground"
							}`}
							title={priceTitle}
						>
							{priceText}
						</span>
					</span>
					<span className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
						<span className="flex min-w-0 items-center gap-1.5">
							<span className="truncate">
								{subLabel ? `${subLabel} (subscription)` : m.provider} · {m.id}
							</span>
						</span>
						<span className="flex shrink-0 items-center gap-1.5 tabular-nums">
							{m.input.includes("image") && (
								<span className="rounded bg-muted/80 px-1 py-px text-[10px] text-muted-foreground" title={t("settings.models.visionBadge")}>
									{t("settings.models.visionBadge")}
								</span>
							)}
							{m.reasoning && (
								<span className="rounded bg-muted/80 px-1 py-px text-[10px] text-muted-foreground" title={t("settings.models.reasoningBadge")}>
									{t("settings.models.reasoningBadge")}
								</span>
							)}
							<span>{m.contextWindow === null ? "—" : formatTokens(m.contextWindow)}</span>
						</span>
					</span>
				</button>
			</li>
		);
	};

	const groupedCounts = useMemo(() => {
		if (!groupedMode) return new Map<ModelVendorId, number>();
		const counts = new Map<ModelVendorId, number>();
		for (const entry of results) {
			counts.set(entry.vendor.id, (counts.get(entry.vendor.id) ?? 0) + 1);
		}
		return counts;
	}, [groupedMode, results]);

	return (
		<>
			<div className="relative mb-1.5 flex items-center">
				<svg
					viewBox="0 0 16 16"
					fill="none"
					aria-hidden
					className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground"
				>
					<circle cx="7" cy="7" r="4.75" stroke="currentColor" strokeWidth="1.5" />
					<path d="m10.75 10.75 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
				</svg>
				<input
					type="text"
					ref={searchRef}
					data-testid="model-search"
					value={query}
					onChange={(event) => {
						setQuery(event.target.value);
						setMenuIdx(null);
					}}
					onKeyDown={(event) => {
						if (event.key === "ArrowDown" || event.key === "ArrowUp") {
							event.preventDefault();
							event.stopPropagation();
							if (results.length === 0) return;
							setMenuIdx((i) =>
								event.key === "ArrowDown"
									? Math.min((i ?? -1) + 1, results.length - 1)
									: Math.max((i ?? results.length) - 1, 0),
							);
						} else if (event.key === "Enter") {
							const chosen = results[menuIdx ?? 0];
							if (chosen !== undefined) {
								event.preventDefault();
								event.stopPropagation();
								onPick(chosen.item);
							}
						}
					}}
					placeholder={t("settings.models.searchPlaceholder")}
					className="lh-input w-full rounded-lg border bg-background py-1.5 pl-8 pr-14 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
				/>
				<div className="absolute right-2 flex items-center gap-1">
					{query.length > 0 && (
						<button
							type="button"
							aria-label={t("settings.models.clearSearch")}
							onClick={() => {
								setQuery("");
								setMenuIdx(null);
								searchRef.current?.focus();
							}}
							className="flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						>
							×
						</button>
					)}
					{visionItems && visionItems.length > 0 && (
						<span className="rounded bg-muted/80 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
							{results.length}
						</span>
					)}
				</div>
			</div>

			{showVendors && (
				<div
					ref={tabsRef}
					role="tablist"
					aria-label="Model companies"
					data-testid="model-vendor-tabs"
					onWheel={(event) => {
						if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && tabsRef.current) {
							tabsRef.current.scrollLeft += event.deltaY;
						}
					}}
					className="mb-1.5 flex items-center gap-1 overflow-x-auto pb-1"
				>
					<button
						type="button"
						role="tab"
						aria-selected={activeVendor === "all"}
						data-testid="model-vendor-all"
						onClick={() => selectVendor("all")}
						className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
							activeVendor === "all"
								? "border-foreground/25 bg-foreground text-background shadow-2xs"
								: "border-border/60 bg-background/60 text-muted-foreground hover:border-foreground/30 hover:bg-muted/70 hover:text-foreground"
						}`}
					>
						<span>{t("settings.models.allVendors")}</span>
						<span className={`tabular-nums text-[10px] ${activeVendor === "all" ? "opacity-80" : "opacity-65"}`}>
							{visionItems?.length ?? 0}
						</span>
					</button>
					{vendorSummaries.map(({ vendor, count }) => {
						const active = activeVendor === vendor.id;
						return (
							<button
								key={vendor.id}
								type="button"
								role="tab"
								aria-selected={active}
								data-testid={`model-vendor-${vendor.id}`}
								onClick={() => selectVendor(active ? "all" : vendor.id)}
								className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
									active
										? "border-foreground/25 bg-foreground text-background shadow-2xs"
										: "border-border/60 bg-background/60 text-muted-foreground hover:border-foreground/30 hover:bg-muted/70 hover:text-foreground"
								}`}
							>
								<span
									className="size-1.5 shrink-0 rounded-full"
									style={{ backgroundColor: vendor.accent }}
									aria-hidden
								/>
								<span>{vendorLabel(vendor.id, vendor.label)}</span>
								<span className={`tabular-nums text-[10px] ${active ? "opacity-80" : "opacity-65"}`}>
									{count}
								</span>
							</button>
						);
					})}
				</div>
			)}

			{!visionItems && (
				<div className="px-2 py-4 text-center text-muted-foreground">{t("settings.models.loading")}</div>
			)}
			{visionItems && results.length === 0 && (
				<div className="flex flex-col items-center gap-2 px-2 py-4 text-center text-muted-foreground">
					<span>{t("settings.models.empty")}</span>
					{activeVendor !== "all" && trimmedQuery.length > 0 && (
						<button
							type="button"
							onClick={() => selectVendor("all")}
							className="cursor-pointer rounded-full border border-border/70 bg-background px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
						>
							{t("settings.models.searchAllVendors")}
						</button>
					)}
				</div>
			)}

			<ul ref={listRef} data-testid="model-list" className="flex max-h-80 flex-col gap-0.5 overflow-y-auto px-0.5">
				{results.map((entry, index) => {
					const showHeader = groupedMode && (index === 0 || results[index - 1]!.vendor.id !== entry.vendor.id);
					if (!showHeader) return renderRow(entry, index);
					return (
						<Fragment key={`group-${entry.vendor.id}`}>
							<li
								role="presentation"
								data-testid={`model-group-${entry.vendor.id}`}
								className={`sticky top-0 z-10 flex items-center justify-between gap-2 bg-card/95 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur-xs ${
									index > 0 ? "mt-1.5 border-t border-border/50 pt-2" : ""
								}`}
							>
								<span className="flex items-center gap-1.5">
									<span
										className="size-1.5 rounded-full"
										style={{ backgroundColor: entry.vendor.accent }}
										aria-hidden
									/>
									<span>{vendorLabel(entry.vendor.id, entry.vendor.label)}</span>
								</span>
								<span className="tabular-nums opacity-70">{groupedCounts.get(entry.vendor.id) ?? 0}</span>
							</li>
							{renderRow(entry, index)}
						</Fragment>
					);
				})}
			</ul>
			{footer && (
				<div className="mt-1.5 border-t border-border/60 px-2 pt-1.5 text-[11px] text-muted-foreground">{footer}</div>
			)}
		</>
	);
}

/** The thinking-level dropdown body — the levels this model actually
 *  supports, ✓ on the effective one. Same shape as the chat selector's. */
export function ThinkingMenuList({
	levels,
	effectiveLevel,
	onPick,
	empty,
	footer,
}: {
	levels: string[];
	effectiveLevel: string | undefined;
	onPick: (level: string) => void;
	/** Shown instead of the list when there are no levels. */
	empty?: string;
	footer?: string;
}) {
	return (
		<>
			{levels.length === 0 ? (
				<div className="px-2 py-3 text-center text-muted-foreground">{empty ?? "No thinking levels."}</div>
			) : (
				levels.map((level) => (
					<button
						key={level}
						type="button"
						data-testid={`thinking-option-${level}`}
						onClick={() => onPick(level)}
						className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted ${
							level === effectiveLevel ? "bg-muted/60 text-card-foreground" : "text-card-foreground"
						}`}
					>
						<span>{level}</span>
						{level === effectiveLevel && <span aria-hidden>✓</span>}
					</button>
				))
			)}
			{footer && (
				<div className="mt-1 border-t px-2 pt-1.5 text-xs text-muted-foreground">{footer}</div>
			)}
		</>
	);
}

/** The provider-picker dropdown body (keys wave-5 polish, 2026-09-21:
 *  the owner wanted the Add-provider control to match the app's dropdown
 *  language) — the same fuzzy-search + arrow-walk + Enter machine over
 *  the pi-ai provider table. Rows read: provider label, its env var in
 *  quiet mono on the right. */
export function ProviderMenuList({
	providers,
	onPick,
}: {
	providers: { id: string; envVar: string; label: string }[];
	onPick: (provider: { id: string; envVar: string; label: string }) => void;
}) {
	const [query, setQuery] = useState("");
	const [menuIdx, setMenuIdx] = useState<number | null>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLUListElement>(null);

	useEffect(() => {
		searchRef.current?.focus();
	}, []);

	useEffect(() => {
		if (menuIdx === null) return;
		listRef.current?.querySelector(`[data-idx="${menuIdx}"]`)?.scrollIntoView({ block: "nearest" });
	}, [menuIdx]);

	const results = providers
		.map((p) => ({ p, s: fuzzyScore(query, p.id, p.envVar, p.label) }))
		.filter((r) => r.s !== null)
		.sort((a, b) => b.s! - a.s! || a.p.id.localeCompare(b.p.id))
		.map((r) => r.p);

	return (
		<>
			<input
				ref={searchRef}
				data-testid="provider-search"
				value={query}
				onChange={(e) => {
					setQuery(e.target.value);
					setMenuIdx(null);
				}}
				onKeyDown={(e) => {
					if (e.key === "ArrowDown" || e.key === "ArrowUp") {
						e.preventDefault();
						e.stopPropagation();
						if (results.length === 0) return;
						setMenuIdx((i) =>
							e.key === "ArrowDown"
								? Math.min((i ?? -1) + 1, results.length - 1)
								: Math.max((i ?? results.length) - 1, 0),
						);
					} else if (e.key === "Enter") {
						const chosen = results[menuIdx ?? 0];
						if (chosen) {
							e.preventDefault();
							e.stopPropagation();
							onPick(chosen);
						}
					}
				}}
				placeholder="Search providers…"
				className="lh-input mb-1.5 w-full rounded-lg border bg-background px-2 py-1.5 text-foreground outline-none focus:ring-1 focus:ring-ring"
			/>
			{results.length === 0 && (
				<div className="px-2 py-3 text-center text-muted-foreground">No providers match.</div>
			)}
			<ul ref={listRef} data-testid="provider-list" className="flex max-h-72 flex-col overflow-y-auto px-1">
				{results.map((p, i) => (
					<li key={p.id}>
						<button
							type="button"
							data-testid={`provider-option-${p.id.replace(/[^a-z0-9-]/gi, "_")}`}
							data-idx={i}
							onClick={() => onPick(p)}
							className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted ${
								i === menuIdx ? "bg-accent/40 ring-1 ring-inset ring-border" : ""
							}`}
						>
							<span className="truncate text-card-foreground">{p.label}</span>
							<span className="shrink-0 font-mono text-xs text-muted-foreground">{p.envVar}</span>
						</button>
					</li>
				))}
			</ul>
		</>
	);
}

/** The reading-font dropdown's row set — the SAME fuzzy + arrow-walk +
 *  Enter machine over font families (appearance wave, 2026-09-26). The
 *  DEFAULT row (null) is a candidate like any family: it matches empty
 *  and "source"/"sans"/"default" queries, so an unfiltered list opens
 *  with the default first and a searched list drops it honestly — Enter
 *  can never pick a row that isn't on screen. Pure — exported for
 *  tests. */
export function fontMenuResults(query: string, families: string[]): Array<string | null> {
	const scored = families
		.map((f) => ({ f, s: fuzzyScore(query, f) }))
		.filter((r) => r.s !== null)
		.sort((a, b) => b.s! - a.s! || a.f.localeCompare(b.f))
		.map((r) => r.f);
	// The default row's searchable identity: the factory family + the
	// word "default" (the suffix it renders with).
	const defaultScore = fuzzyScore(query, "Source Sans 3", "default");
	if (query.trim() === "" || defaultScore !== null) return [null, ...scored];
	return scored;
}

/** The custom-family action row's decision (pure, 2026-09-26): a typed
 *  query that matches NO family becomes the "Use '<query>'" custom pick —
 *  a matching family is the better pick, so the action row only exists
 *  when there is nothing else to pick. Exported for tests. */
export function customFamilyFor(query: string, families: string[]): string | null {
	const trimmed = query.trim();
	if (trimmed === "") return null;
	return fontMenuResults(query, families).length === 0 ? trimmed : null;
}

/** The reading-font dropdown body — ONE search field (owner ask
 *  2026-09-26: "why two?"): the fuzzy machine filters the families, and
 *  when nothing matches, a "Use '<query>'" action row commits the typed
 *  text as a custom family — the old separate custom input is gone, the
 *  search field absorbed its job. `families === undefined` is the
 *  enumerating state; the curated fallback arrives as plain families with
 *  a footer that says so honestly. */
export function FontMenuList({
	families,
	effectiveFamily,
	onPick,
	footer,
}: {
	/** Enumerated font families (already deduped/sorted by the caller);
	 *  undefined while the enumeration runs. */
	families: string[] | undefined;
	/** The stored override (null = the factory Source Sans 3). */
	effectiveFamily: string | null;
	/** Receives the pick: a family string, or null for the default. */
	onPick: (family: string | null) => void;
	/** Quiet footer note under the list. */
	footer?: string;
}) {
	const [query, setQuery] = useState("");
	const [menuIdx, setMenuIdx] = useState<number | null>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLUListElement>(null);

	useEffect(() => {
		searchRef.current?.focus();
	}, []);

	useEffect(() => {
		if (menuIdx === null) return;
		listRef.current?.querySelector(`[data-idx="${menuIdx}"]`)?.scrollIntoView({ block: "nearest" });
	}, [menuIdx]);

	const results = fontMenuResults(query, families ?? []);
	// The custom-family action row: only when a typed query matches
	// nothing (a matching family is the better pick). Enter picks it.
	const customFamily = customFamilyFor(query, families ?? []);
	const walkable: Array<string | null> = customFamily !== null ? ["__custom__"] : results;

	return (
		<>
			<input
				ref={searchRef}
				data-testid="font-search"
				value={query}
				onChange={(e) => {
					setQuery(e.target.value);
					setMenuIdx(null); // new query → the walk restarts on Enter/↓
				}}
				onKeyDown={(e) => {
					if (e.key === "ArrowDown" || e.key === "ArrowUp") {
						e.preventDefault();
						e.stopPropagation();
						if (walkable.length === 0) return;
						setMenuIdx((i) =>
							e.key === "ArrowDown"
								? Math.min((i ?? -1) + 1, walkable.length - 1)
								: Math.max((i ?? walkable.length) - 1, 0),
						);
					} else if (e.key === "Enter") {
						const chosen = walkable[menuIdx ?? 0];
						if (chosen !== undefined) {
							e.preventDefault();
							e.stopPropagation();
							onPick(chosen === "__custom__" ? customFamily : chosen);
						}
					}
				}}
				placeholder="Search fonts…"
				className="lh-input mb-1.5 w-full rounded-lg border bg-background px-2 py-1.5 text-foreground outline-none focus:ring-1 focus:ring-ring"
			/>
			{!families && <div className="px-2 py-3 text-center text-muted-foreground">Loading fonts…</div>}
			<ul ref={listRef} data-testid="font-list" className="flex max-h-72 flex-col overflow-y-auto px-1">
				{families &&
					results.map((family, i) => {
						const isDefault = family === null;
						const effective = isDefault ? effectiveFamily === null : family === effectiveFamily;
						return (
							<li key={family ?? "__default"}>
								<button
									type="button"
									data-testid={isDefault ? "font-option-default" : `font-option-${family.replace(/[^a-z0-9-]/gi, "_")}`}
									data-idx={i}
									onClick={() => onPick(family)}
									className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted ${
										i === menuIdx ? "bg-accent/40 ring-1 ring-inset ring-border" : ""
									}${effective && i !== menuIdx ? " bg-muted/60" : ""}`}
								>
									<span className="truncate text-card-foreground">{family ?? "Source Sans 3"}</span>
									<span className="shrink-0 text-muted-foreground">{isDefault ? "default" : effective && <span aria-hidden>✓</span>}</span>
								</button>
							</li>
						);
					})}
				{families && customFamily !== null && (
					<li>
						<button
							type="button"
							data-testid="font-option-custom"
							data-idx={0}
							onClick={() => onPick(customFamily)}
							className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted ${
								menuIdx === 0 ? "bg-accent/40 ring-1 ring-inset ring-border" : ""
							}`}
						>
							<span className="truncate text-card-foreground">Use “{customFamily}”</span>
							<span className="shrink-0 text-muted-foreground">custom</span>
						</button>
					</li>
				)}
			</ul>
			{footer && <div className="px-2 pt-1.5 text-xs text-muted-foreground">{footer}</div>}
		</>
	);
}
