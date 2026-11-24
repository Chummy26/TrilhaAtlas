"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SparklesIcon } from "lucide-react";
import { Icon } from "@/components/icons/icon";
import { useServerEvent } from "@/components/server-events";
import { useSettingsSaved } from "@/components/settings-signal";
import { useI18n } from "@/components/i18n";
import type { RegionMaterials, SkillMap, SkillNode, StudyNodeBrief, Translator, TreeEnrichmentStatus } from "@/src/core";
import type { LessonStart } from "./today-card.tsx";
import { lessonStatement } from "./lesson-statement.ts";
import { SkillCanvas } from "./skill-canvas.tsx";
import { TreeAssistantPanel } from "./tree-assistant-panel.tsx";

type NodeDetail = {
	brief: StudyNodeBrief;
	minutes: number;
	sessionId?: string;
	activeSessionId?: string;
	completedSessionId?: string;
	explorationId?: string;
	missing: { id: string; title: string }[];
};

function nodeStateLabel(t: Translator, state: SkillNode["state"]): string {
	switch (state) {
		case "known":
			return t("map.tree.statusKnown");
		case "available":
			return t("map.tree.statusAvailable");
		case "locked":
			return t("map.tree.statusLocked");
		case "group":
			return t("map.tree.statusGroup");
	}
}

function statusPillClass(node: SkillNode): string {
	if (node.completed) return "study-pill study-pill-success";
	if (node.inProgress) return "study-pill study-pill-accent";
	if (node.state === "available") return "study-pill study-pill-info";
	if (node.state === "locked") return "study-pill study-pill-warning";
	return "study-pill";
}

function Materials({
	domain,
	node,
	onStart,
	busy,
	refreshNonce = 0,
}: {
	domain: string;
	node: SkillNode;
	onStart: (l: LessonStart) => void;
	busy: boolean;
	refreshNonce?: number;
}) {
	const { t } = useI18n();
	const [data, setData] = useState<RegionMaterials>();
	const [revision, setRevision] = useState(0);
	useSettingsSaved((section) => {
		if (section === "keys") setRevision((r) => r + 1);
	});
	const [detail, setDetail] = useState<NodeDetail>();
	const [error, setError] = useState("");
	const [searching, setSearching] = useState(false);
	const [manualMode, setManualMode] = useState<"link" | "library">("link");
	const [manualKind, setManualKind] = useState<"video" | "book">("video");
	const [manualTitle, setManualTitle] = useState("");
	const [manualPart, setManualPart] = useState("");
	const [manualUrl, setManualUrl] = useState("");
	const [manualLang, setManualLang] = useState("pt");
	const [selectedLibraryBook, setSelectedLibraryBook] = useState("");
	const [pdfSection, setPdfSection] = useState("");
	const [linkedNodes, setLinkedNodes] = useState<string[]>([node.id]);
	const endpoint = "/api/study/materials?" + new URLSearchParams({ domain, node: node.id });
	const nodeCacheRef = useRef(new Map<string, { detail: NodeDetail; regionMaterials?: RegionMaterials }>());
	const regionCacheRef = useRef(new Map<string, RegionMaterials>());
	const cacheVersionRef = useRef(`${domain}:${revision}:${refreshNonce}`);

	const updateRegionCache = useCallback(
		(next: RegionMaterials) => {
			setData(next);
			if (node.region) {
				const regionKey = `${domain}\0${node.region}`;
				regionCacheRef.current.set(regionKey, next);
			}
			const nodeKey = `${domain}\0${node.id}`;
			const cached = nodeCacheRef.current.get(nodeKey);
			if (cached) {
				nodeCacheRef.current.set(nodeKey, { ...cached, regionMaterials: next });
			}
			for (const [key, entry] of nodeCacheRef.current.entries()) {
				if (entry.regionMaterials?.region && entry.regionMaterials.region === next.region) {
					nodeCacheRef.current.set(key, { ...entry, regionMaterials: next });
				}
			}
		},
		[domain, node.id, node.region],
	);

	useEffect(() => {
		setLinkedNodes([node.id]);
		setManualTitle("");
		setManualPart("");
		setManualUrl("");
		setPdfSection("");
		setError("");
	}, [node.id]);

	useEffect(() => {
		const version = `${domain}:${revision}:${refreshNonce}`;
		if (cacheVersionRef.current !== version) {
			cacheVersionRef.current = version;
			nodeCacheRef.current.clear();
			regionCacheRef.current.clear();
		}
		const nodeKey = `${domain}\0${node.id}`;
		const cachedNode = nodeCacheRef.current.get(nodeKey);
		if (cachedNode) {
			setDetail(cachedNode.detail);
			setData(cachedNode.regionMaterials);
			setError("");
			return;
		}
		setDetail(undefined);
		const cachedRegion = node.region ? regionCacheRef.current.get(`${domain}\0${node.region}`) : undefined;
		setData(cachedRegion);

		const ctrl = new AbortController();
		async function read() {
			const res = await fetch(endpoint + "&lesson=1", { signal: ctrl.signal });
			if (!res.ok) throw new Error(t("map.tree.errLoadRegion"));
			const json = (await res.json()) as NodeDetail & { regionMaterials?: RegionMaterials };
			if (ctrl.signal.aborted) return;
			nodeCacheRef.current.set(nodeKey, { detail: json, regionMaterials: json.regionMaterials });
			if (node.region && json.regionMaterials) {
				regionCacheRef.current.set(`${domain}\0${node.region}`, json.regionMaterials);
			}
			setDetail(json);
			setData(json.regionMaterials);
		}
		void read().catch((e: Error) => {
			if (!ctrl.signal.aborted) setError(e.message);
		});
		return () => ctrl.abort();
	}, [domain, node.id, node.region, endpoint, revision, refreshNonce, t]);

	async function enrichNode() {
		setSearching(true);
		setError("");
		try {
			const res = await fetch(endpoint + "&enrich=1", { method: "POST" });
			const result = await res.json();
			if (!res.ok) throw new Error(result.error ?? t("map.tree.errEnrich"));
			updateRegionCache(result);
		} catch (e) {
			setError(e instanceof Error ? e.message : t("map.tree.errEnrich"));
		} finally {
			setSearching(false);
		}
	}

	async function discover(kind: "video" | "book", download?: string) {
		setSearching(true);
		setError("");
		try {
			const action = download ? "&download=" + encodeURIComponent(download) : "&kind=" + kind;
			const res = await fetch(endpoint + action, { method: "POST" });
			const result = await res.json();
			if (!res.ok) throw new Error(result.error ?? t("map.tree.errLoadMaterials"));
			updateRegionCache(result);
		} catch (e) {
			setError(e instanceof Error ? e.message : t("map.tree.errSearchMaterials"));
		} finally {
			setSearching(false);
		}
	}

	async function updateBook(file?: File, removeId = "") {
		setSearching(true);
		setError("");
		try {
			const form = new FormData();
			if (file) {
				form.set("file", file);
				if (pdfSection.trim()) form.set("part", pdfSection.trim());
				if (linkedNodes.length) form.set("nodes", JSON.stringify(linkedNodes));
			}
			const res = await fetch(endpoint + "&pdf=" + encodeURIComponent(removeId), {
				method: file ? "POST" : "DELETE",
				body: file ? form : undefined,
			});
			const result = await res.json();
			if (!res.ok) throw new Error(result.error ?? t("map.tree.errUpdateBook"));
			updateRegionCache(result);
			if (file) setPdfSection("");
		} catch (e) {
			setError(e instanceof Error ? e.message : t("map.tree.errUpdateBook"));
		} finally {
			setSearching(false);
		}
	}

	async function saveManualMaterial(e: React.FormEvent) {
		e.preventDefault();
		setSearching(true);
		setError("");
		try {
			const payload =
				manualMode === "library"
					? {
						kind: "book" as const,
						libraryBookId: selectedLibraryBook,
						title: manualTitle.trim(),
						part: manualPart.trim() || t("map.tree.linkedSectionDefault"),
						lang: manualLang,
						nodes: linkedNodes.length ? linkedNodes : [node.id],
					}
					: {
						kind: manualKind,
						title: manualTitle.trim(),
						part: manualPart.trim() || manualTitle.trim(),
						url: manualUrl.trim(),
						lang: manualLang,
						nodes: linkedNodes.length ? linkedNodes : [node.id],
					};
			const res = await fetch(endpoint + "&manual=1", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			const result = await res.json();
			if (!res.ok) throw new Error(result.error ?? t("map.tree.errAddMaterial"));
			updateRegionCache(result);
			setManualTitle("");
			setManualPart("");
			setManualUrl("");
		} catch (err) {
			setError(err instanceof Error ? err.message : t("map.tree.errAddMaterial"));
		} finally {
			setSearching(false);
		}
	}

	async function deleteManualMaterial(materialId: string) {
		setSearching(true);
		setError("");
		try {
			const res = await fetch(endpoint + "&manual=1&id=" + encodeURIComponent(materialId), {
				method: "DELETE",
			});
			const result = await res.json();
			if (!res.ok) throw new Error(result.error ?? t("map.tree.errRemoveMaterial"));
			updateRegionCache(result);
		} catch (err) {
			setError(err instanceof Error ? err.message : t("map.tree.errRemoveMaterial"));
		} finally {
			setSearching(false);
		}
	}

	function toggleLinkedNode(targetId: string) {
		setLinkedNodes((prev) =>
			prev.includes(targetId)
				? prev.length > 1
					? prev.filter((id) => id !== targetId)
					: prev
				: [...prev, targetId],
		);
	}

	function start(exploratory: boolean) {
		if (detail) {
			onStart({
				domainId: domain,
				minutes: detail.minutes,
				title: node.title,
				exploratory,
				context: {
					id: node.id,
					name: node.title,
					statement: lessonStatement(detail.brief, detail.minutes),
				},
			});
		}
	}

	const { materials, groups, otherParts } = useMemo(() => {
		const own =
			data?.materials.filter(
				(m) => node.kind === "unit" || m.nodes.includes(node.id) || m.nodes.includes(data.region),
			) ?? [];
		const grouped = new Map<string, typeof own>();
		const ownUrls = new Set<string>();
		for (const m of own) {
			ownUrls.add(m.url);
			const key = m.kind + ":" + m.title;
			const group = grouped.get(key);
			if (group) group.push(m);
			else grouped.set(key, [m]);
		}
		const others =
			node.kind === "unit"
				? []
				: data?.materials.filter((m) => !ownUrls.has(m.url)) ?? [];
		return { materials: own, groups: grouped, otherParts: others };
	}, [data, node.id, node.kind]);

	const activeSessionId = detail?.activeSessionId ?? detail?.sessionId;

	return (
		<div className="space-y-4">
			{detail && (
				<div className="space-y-3">
					<p className="text-[15px] leading-relaxed text-foreground/90">{detail.brief.summary}</p>
					<div className="flex flex-wrap items-center gap-2">
						{activeSessionId ? (
							<Link
								className="cel-button cel-button-primary px-4 py-2 text-sm"
								href={"/chat/" + encodeURIComponent(activeSessionId)}
							>
								<Icon name="play" size={15} />
								{t("map.tree.continueLesson")}
							</Link>
						) : (
							node.leaf &&
							!node.reinforcementFor &&
							node.state !== "locked" && (
								<button
									type="button"
									className="cel-button cel-button-primary px-4 py-2 text-sm"
									disabled={busy}
									onClick={() => start(false)}
								>
									<Icon name="play" size={15} />
									{node.completed ? t("map.tree.practiceReview") : t("map.tree.startLesson")}
								</button>
							)
						)}
						{detail.completedSessionId && (
							<Link
								data-testid="skill-tree-past-lesson"
								href={"/chat/" + encodeURIComponent(detail.completedSessionId)}
								className="cel-button cel-button-ghost px-3 py-1.5 text-sm"
							>
								{t("map.tree.viewPastLesson")}
							</Link>
						)}
						{detail.explorationId ? (
							<Link
								href={"/chat/" + encodeURIComponent(detail.explorationId)}
								className="cel-button px-3 py-1.5 text-sm"
							>
								{t("map.tree.resumeExploration")}
							</Link>
						) : (
							<button
								type="button"
								className="cel-button px-3 py-1.5 text-sm"
								disabled={busy}
								onClick={() => start(true)}
							>
								{node.reinforcementFor
									? t("map.tree.studyReinforcement")
									: node.leaf
										? t("map.tree.exploreSingle")
										: t("map.tree.exploreOverview")}
							</button>
						)}
					</div>
					{node.state === "locked" && (
						<p className="rounded-lg border border-border/50 bg-background/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
							{detail.missing.length
								? t("map.tree.lockedMissing", {
									missing: detail.missing.map((m) => m.title).join(" · "),
								})
								: t("map.tree.lockedGeneric")}
						</p>
					)}
				</div>
			)}

			{node.region && (
				<div className="space-y-3 border-t border-border/50 pt-3.5">
					<div className="flex items-center gap-2">
						<Icon name="book" size={18} />
						<h3 className="cel-display text-base">
							{node.kind === "unit" ? t("map.tree.regionMaterials") : t("map.tree.nodeMaterials")}
						</h3>
					</div>
					{data?.localReadings?.map((book) => (
						<div key={book.id} className="reader-shelf">
							<Link
								href={
									"/ler/" +
									book.id +
									"?" +
									new URLSearchParams({ domain, region: data.region, node: node.id })
								}
							>
								<Icon name="book" size={20} />
								<span className="min-w-0 truncate">
									<strong className="block truncate text-sm">{book.title}</strong>
									<small>{t("map.tree.readInApp")}</small>
								</span>
							</Link>
							<button
								type="button"
								aria-label={t("map.tree.unlinkAria", { title: book.title })}
								disabled={searching}
								onClick={() => void updateBook(undefined, book.id)}
							>
								{t("map.tree.unlink")}
							</button>
						</div>
					))}
					{data && (
						<details className="study-disclosure text-sm">
							<summary>
								{data.localReadings?.length
									? t("map.tree.regionBooksCount", { count: data.localReadings.length })
									: t("map.tree.regionBooks")}
							</summary>
							<div className="study-disclosure-body space-y-2.5">
								<p className="text-xs leading-relaxed text-muted-foreground">
									{t("map.tree.bookExcerptHint")}
								</p>
								<label className="block text-xs font-semibold">
									{t("map.tree.pdfSectionLabel")}
									<input
										type="text"
										value={pdfSection}
										disabled={searching}
										onChange={(e) => setPdfSection(e.target.value)}
										placeholder={t("map.tree.pdfSectionPlaceholder")}
										className="cel-input mt-1 block w-full px-2.5 py-1.5 text-xs font-normal"
									/>
								</label>
								<label className="block text-xs font-semibold">
									{t("map.tree.addPdfLabel")}
									<input
										type="file"
										accept="application/pdf,application/epub+zip,.pdf,.epub"
										disabled={searching}
										className="mt-1.5 block w-full text-xs font-normal text-muted-foreground"
										onChange={(e) => {
											const file = e.currentTarget.files?.[0];
											e.currentTarget.value = "";
											if (file) void updateBook(file);
										}}
									/>
								</label>
							</div>
						</details>
					)}
					{data && (
						<details className="study-disclosure text-sm">
							<summary>{t("map.tree.addManualMaterial")}</summary>
							<form
								className="study-disclosure-body space-y-2.5 pt-2"
								onSubmit={(e) => void saveManualMaterial(e)}
							>
								<p className="text-xs leading-relaxed text-muted-foreground">
									{t("map.tree.manualIntro")}
								</p>
								{!!data.libraryBooks?.length && (
									<div
										className="flex flex-wrap gap-1.5"
										role="group"
										aria-label={t("map.tree.manualOriginAria")}
									>
										<button
											type="button"
											className={
												manualMode === "link"
													? "cel-chip text-xs"
													: "cel-button cel-button-ghost min-h-7 px-2.5 py-1 text-xs"
											}
											aria-pressed={manualMode === "link"}
											onClick={() => setManualMode("link")}
										>
											{t("map.tree.manualModeLink")}
										</button>
										<button
											type="button"
											className={
												manualMode === "library"
													? "cel-chip text-xs"
													: "cel-button cel-button-ghost min-h-7 px-2.5 py-1 text-xs"
											}
											aria-pressed={manualMode === "library"}
											onClick={() => {
												setManualMode("library");
												if (!selectedLibraryBook && data.libraryBooks?.[0]) {
													setSelectedLibraryBook(data.libraryBooks[0].id);
												}
											}}
										>
											{t("map.tree.manualModeLibrary", { count: data.libraryBooks.length })}
										</button>
									</div>
								)}
								{manualMode === "library" && data.libraryBooks?.length ? (
									<div className="space-y-2">
										<label className="block text-xs font-semibold">
											{t("map.tree.libraryBookLabel")}
											<select
												className="cel-input mt-1 block w-full px-2.5 py-1.5 text-xs font-normal"
												value={selectedLibraryBook}
												disabled={searching}
												onChange={(e) => setSelectedLibraryBook(e.target.value)}
											>
												{data.libraryBooks.map((book) => (
													<option key={book.id} value={book.id}>
														{book.title}
														{book.pages ? ` (${t("map.tree.pagesShort", { pages: book.pages })})` : ""}
													</option>
												))}
											</select>
										</label>
										<label className="block text-xs font-semibold">
											{t("map.tree.sectionPagesLabel")}
											<input
												type="text"
												required
												className="cel-input mt-1 block w-full px-2.5 py-1.5 text-xs font-normal"
												value={manualPart}
												disabled={searching}
												onChange={(e) => setManualPart(e.target.value)}
												placeholder={t("map.tree.sectionPagesPlaceholder")}
											/>
										</label>
									</div>
								) : (
									<div className="space-y-2">
										<div className="grid grid-cols-2 gap-2">
											<label className="block text-xs font-semibold">
												{t("map.tree.typeLabel")}
												<select
													className="cel-input mt-1 block w-full px-2 py-1.5 text-xs font-normal"
													value={manualKind}
													disabled={searching}
													onChange={(e) => setManualKind(e.target.value === "book" ? "book" : "video")}
												>
													<option value="video">{t("map.tree.kindVideo")}</option>
													<option value="book">{t("map.tree.kindBook")}</option>
												</select>
											</label>
											<label className="block text-xs font-semibold">
												{t("map.tree.languageLabel")}
												<select
													className="cel-input mt-1 block w-full px-2 py-1.5 text-xs font-normal"
													value={manualLang}
													disabled={searching}
													onChange={(e) => setManualLang(e.target.value)}
												>
													<option value="pt">{t("map.tree.langPt")}</option>
													<option value="en">{t("map.tree.langEn")}</option>
												</select>
											</label>
										</div>
										<label className="block text-xs font-semibold">
											{t("map.tree.titleLabel")}
											<input
												type="text"
												required
												className="cel-input mt-1 block w-full px-2.5 py-1.5 text-xs font-normal"
												value={manualTitle}
												disabled={searching}
												onChange={(e) => setManualTitle(e.target.value)}
												placeholder={t("map.tree.titlePlaceholder")}
											/>
										</label>
										<label className="block text-xs font-semibold">
											{t("map.tree.partLabel")}
											<input
												type="text"
												required
												className="cel-input mt-1 block w-full px-2.5 py-1.5 text-xs font-normal"
												value={manualPart}
												disabled={searching}
												onChange={(e) => setManualPart(e.target.value)}
												placeholder={t("map.tree.partPlaceholder")}
											/>
										</label>
										<label className="block text-xs font-semibold">
											{t("map.tree.urlLabel")}
											<input
												type="url"
												required
												className="cel-input mt-1 block w-full px-2.5 py-1.5 text-xs font-normal"
												value={manualUrl}
												disabled={searching}
												onChange={(e) => setManualUrl(e.target.value)}
												placeholder={t("map.tree.urlPlaceholder")}
											/>
										</label>
									</div>
								)}
								{!!data.regionNodes?.length && (
									<fieldset className="space-y-1.5 rounded-lg border border-border/50 bg-background/60 p-2.5">
										<div className="flex flex-wrap items-center justify-between gap-1">
											<legend className="text-xs font-semibold">
												{t("map.tree.linkNodesLegend", { count: linkedNodes.length })}
											</legend>
											<div className="flex gap-2 text-[11px]">
												<button
													type="button"
													className="underline text-muted-foreground hover:text-foreground"
													onClick={() => setLinkedNodes(data.regionNodes!.map((n) => n.id))}
												>
													{t("map.tree.allInRegion")}
												</button>
												<button
													type="button"
													className="underline text-muted-foreground hover:text-foreground"
													onClick={() => setLinkedNodes([node.id])}
												>
													{t("map.tree.onlyThisNode")}
												</button>
											</div>
										</div>
										<div className="max-h-32 space-y-1 overflow-y-auto pr-1">
											{data.regionNodes.map((target) => (
												<label
													key={target.id}
													className="flex cursor-pointer items-start gap-2 text-xs leading-snug"
												>
													<input
														type="checkbox"
														className="mt-0.5"
														checked={linkedNodes.includes(target.id)}
														onChange={() => toggleLinkedNode(target.id)}
													/>
													<span>
														{target.kind === "unit"
															? t("map.tree.wholeRegion", { title: target.title })
															: target.title}
													</span>
												</label>
											))}
										</div>
									</fieldset>
								)}
								<button
									type="submit"
									className="cel-button cel-button-primary min-h-8 px-3.5 py-1 text-xs"
									disabled={searching}
								>
									<Icon name="plus" size={14} tone={false} />
									{searching ? t("map.tree.saving") : t("map.tree.linkMaterial")}
								</button>
							</form>
						</details>
					)}
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}
					{!data && !error && (
						<p role="status" className="text-sm text-muted-foreground">
							{t("common.state.loading")}
						</p>
					)}
					{data && !materials.length && !data.localReadings?.length && (
						<p className="text-sm text-muted-foreground">{t("map.tree.noMaterialsYet")}</p>
					)}
					{[...groups].map(([key, group]) => {
						const first = group[0]!;
						return (
							<section
								key={key}
								className="space-y-2 rounded-xl border border-border/55 bg-background/55 p-3"
							>
								<h4 className="flex flex-wrap items-start gap-1.5 text-sm font-semibold leading-snug">
									<Icon name={first.kind === "book" ? "book" : "video"} size={17} />
									<span className="min-w-0 flex-1">
										{first.kind === "book" ? t("map.tree.readingPrefix") : t("map.tree.videoPrefix")} ·{" "}
										{first.title}
									</span>
									{first.manual && (
										<span className="study-pill study-pill-accent text-[11px]">
											{t("map.tree.manualPill")}
										</span>
									)}
									{first.reputationBadge && (
										<span className="study-pill study-pill-success text-[11px]">
											{first.reputationBadge}
										</span>
									)}
								</h4>
								<div className="space-y-1.5 pl-6">
									{group.map((m) => (
										<div
											key={(m.manualId ?? m.url) + !!m.suggested}
											className="flex items-start justify-between gap-2"
										>
											{m.url.startsWith("/ler/") ? (
												<Link
													href={m.url}
													className="block text-sm leading-snug underline decoration-border underline-offset-2 hover:decoration-foreground"
												>
													{m.part}{" "}
													<span className="text-xs text-muted-foreground">
														{t("map.tree.inApp")}
														{m.nodes.length > 1 ? ` · ${t("map.tree.nodesCount", { count: m.nodes.length })}` : ""}
													</span>
												</Link>
											) : (
												<a
													href={m.url}
													target="_blank"
													rel="noreferrer"
													className="block text-sm leading-snug underline decoration-border underline-offset-2 hover:decoration-foreground"
												>
													{m.part}{" "}
													<span className="text-xs text-muted-foreground">
														{m.lang}
														{m.suggested ? ` · ${t("map.tree.suggestion")}` : ""}
														{m.nodes.length > 1 ? ` · ${t("map.tree.nodesCount", { count: m.nodes.length })}` : ""}
													</span>
												</a>
											)}
											{m.manualId && (
												<button
													type="button"
													className="shrink-0 text-xs font-semibold text-muted-foreground underline hover:text-foreground"
													disabled={searching}
													onClick={() => void deleteManualMaterial(m.manualId!)}
												>
													{t("map.tree.remove")}
												</button>
											)}
										</div>
									))}
								</div>
								{first.bookKey && (
									<button
										type="button"
										className="cel-button cel-button-ghost min-h-7 px-2 py-1 text-xs font-semibold"
										disabled={searching || first.saved}
										onClick={() => discover("book", first.bookKey)}
									>
										{first.saved ? t("map.tree.inLibrary") : t("map.tree.saveToLibrary")}
									</button>
								)}
							</section>
						);
					})}
					{data && (
						<div className="flex flex-wrap items-center gap-2 pt-1">
							<button
								type="button"
								className="cel-button cel-button-primary min-h-8 px-3 py-1 text-xs"
								disabled={searching}
								onClick={() => void enrichNode()}
							>
								<Icon name="book" size={14} tone={false} />
								{searching ? t("map.tree.searchingRefs") : t("map.tree.enrichMaterials")}
							</button>
							<button
								type="button"
								className="cel-button min-h-8 px-3 py-1 text-xs"
								disabled={searching}
								onClick={() => discover("book")}
							>
								<Icon name="search" size={14} tone={false} />
								{searching ? t("map.tree.searching") : t("map.tree.searchBooks")}
							</button>
							{data.videoSearch ? (
								<button
									type="button"
									className="cel-button min-h-8 px-3 py-1 text-xs"
									disabled={searching}
									onClick={() => discover("video")}
								>
									<Icon name="video" size={14} tone={false} />
									{t("map.tree.searchVideos")}
								</button>
							) : (
								<a
									className="cel-button cel-button-ghost min-h-8 px-2.5 py-1 text-xs underline underline-offset-2"
									href={
										"https://www.youtube.com/results?" +
										new URLSearchParams({
											search_query: node.title + " " + (detail?.brief.summary ?? "").slice(0, 90),
										})
									}
									target="_blank"
									rel="noreferrer"
								>
									{t("map.tree.searchYouTube")}
								</a>
							)}
						</div>
					)}
					{otherParts.length > 0 && (
						<details className="study-disclosure text-sm">
							<summary>{t("map.tree.otherExcerpts", { count: otherParts.length })}</summary>
							<div className="study-disclosure-body space-y-1.5">
								{otherParts.map((m) => (
									<a
										key={m.url + !!m.suggested}
										href={m.url}
										target="_blank"
										rel="noreferrer"
										className="block text-xs leading-snug underline underline-offset-2"
									>
										{m.title} · {m.part}
										{m.suggested ? ` · ${t("map.tree.suggestion")}` : ""}
									</a>
								))}
							</div>
						</details>
					)}
					{!!data?.references.length && (
						<details className="study-disclosure text-sm">
							<summary>{t("map.tree.bibliography", { count: data.references.length })}</summary>
							<ul className="study-disclosure-body space-y-2">
								{data.references.map((ref) => (
									<li key={ref.title} className="text-xs leading-snug">
										{ref.url ? (
											<a
												href={ref.url}
												target="_blank"
												rel="noreferrer"
												className="font-semibold underline underline-offset-2"
											>
												{ref.title}
											</a>
										) : (
											<span className="font-semibold">{ref.title}</span>
										)}
										{ref.parts.length > 0 && (
											<p className="mt-0.5 text-muted-foreground">{ref.parts.join(" · ")}</p>
										)}
									</li>
								))}
							</ul>
						</details>
					)}
					{data?.message && (
						<p role="status" className="text-xs text-muted-foreground">
							{data.message}
						</p>
					)}
				</div>
			)}
			{!node.region && error && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
		</div>
	);
}

export function SkillTree({
	map,
	initialNode,
	onStart,
	busy,
}: {
	map: SkillMap;
	initialNode?: string;
	onStart: (l: LessonStart) => void;
	busy: boolean;
}) {
	const { t, intl } = useI18n();
	const router = useRouter();
	useServerEvent("domain-changed", () => router.replace("/"));
	useServerEvent("curriculum-expanded", (event) => {
		if (event.domainId === map.domain) router.refresh();
	});

	const dateFmt = useMemo(
		() => new Intl.DateTimeFormat(intl, { year: "numeric", month: "2-digit", day: "2-digit" }),
		[intl],
	);

	const byId = useMemo(() => new Map(map.nodes.map((n) => [n.id, n])), [map.nodes]);
	const root = useMemo(() => map.nodes.find((n) => !n.parent)!, [map.nodes]);
	const normalizedTitles = useMemo(
		() => new Map(map.nodes.map((n) => [n.id, n.title.toLocaleLowerCase(intl)])),
		[map.nodes, intl],
	);
	const reinforcementsByTarget = useMemo(() => {
		const grouped = new Map<string, SkillNode[]>();
		for (const n of map.nodes) {
			if (!n.reinforcementFor) continue;
			const list = grouped.get(n.reinforcementFor);
			if (list) list.push(n);
			else grouped.set(n.reinforcementFor, [n]);
		}
		return grouped;
	}, [map.nodes]);
	const [id, setId] = useState(
		initialNode && byId.has(initialNode) ? initialNode : map.position ?? map.next ?? root.id,
	);
	const selected = byId.get(id) ?? root;
	const scope = selected.leaf ? byId.get(selected.region ?? selected.parent ?? root.id)! : selected;
	const [query, setQuery] = useState("");
	const q = query.trim().toLocaleLowerCase(intl);
	const rows = useMemo(() => {
		if (q) {
			const matches: SkillNode[] = [];
			for (const n of map.nodes) {
				if (normalizedTitles.get(n.id)?.includes(q)) {
					matches.push(n);
					if (matches.length >= 60) break;
				}
			}
			return matches;
		}
		return map.nodes
			.filter((n) => n.parent === scope.id || (selected.leaf && n.region === scope.id && n.leaf))
			.sort((a, b) => a.order - b.order);
	}, [q, map.nodes, normalizedTitles, scope.id, selected.leaf]);
	const anchor = byId.get(map.position ?? map.next ?? "");
	const leaves = useMemo(() => map.nodes.filter((n) => n.leaf && !n.reinforcementFor), [map.nodes]);
	const regionUnits = useMemo(() => map.nodes.filter((n) => n.kind === "unit"), [map.nodes]);
	const completed = useMemo(() => leaves.reduce((sum, n) => sum + (n.completed ? 1 : 0), 0), [leaves]);
	const pct = leaves.length > 0 ? Math.round((100 * completed) / leaves.length) : 0;
	const [locate, setLocate] = useState(0);
	const [assistantOpen, setAssistantOpen] = useState(false);
	const [enrichJob, setEnrichJob] = useState<TreeEnrichmentStatus | null>(null);
	const [enrichDismissedAt, setEnrichDismissedAt] = useState(0);
	const [materialsNonce, setMaterialsNonce] = useState(0);
	const lastFinishedEnrichRef = useRef(0);
	const enrichingTree = enrichJob?.state === "running";

	const trail = useMemo(() => {
		const path: SkillNode[] = [selected];
		while (path[0]?.parent && byId.has(path[0].parent)) path.unshift(byId.get(path[0].parent)!);
		return path;
	}, [selected, byId]);

	const progress = selected.completed
		? t("map.tree.statusCompleted")
		: selected.inProgress
			? t("map.tree.statusInProgress")
			: undefined;
	const category = selected.leaf
		? selected.level
		: selected.kind === "domain"
			? t("map.tree.categoryDomain")
			: selected.kind === "unit"
				? t("map.tree.categoryUnit")
				: t("map.tree.categoryArea");

	const pick = useCallback((key: string) => {
		setId(key);
		setQuery("");
	}, []);

	const refreshEnrichJob = useCallback(async () => {
		try {
			const res = await fetch("/api/study/enrich?" + new URLSearchParams({ domain: map.domain }), { cache: "no-store" });
			if (!res.ok) return;
			const data = (await res.json()) as { status?: TreeEnrichmentStatus | null };
			const next = data.status ?? null;
			setEnrichJob(next);
			if (next && next.state === "done" && next.finishedAt && next.finishedAt !== lastFinishedEnrichRef.current) {
				lastFinishedEnrichRef.current = next.finishedAt;
				setMaterialsNonce((n) => n + 1);
			}
		} catch {
			// Keep current enrichment state on transient error.
		}
	}, [map.domain]);

	useEffect(() => {
		void refreshEnrichJob();
	}, [refreshEnrichJob]);

	useServerEvent("activity-changed", () => {
		void refreshEnrichJob();
	});

	async function enrichWholeTree() {
		if (enrichingTree || !regionUnits.length) return;
		setEnrichDismissedAt(0);
		try {
			const res = await fetch("/api/study/enrich", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					domain: map.domain,
					...(selected.region ? { focusRegionId: selected.region } : {}),
					limit: 12,
				}),
			});
			if (res.ok) {
				const started = (await res.json()) as TreeEnrichmentStatus;
				setEnrichJob(started);
			}
		} catch {
			// Ignore transient error; user can retry.
		}
	}

	async function cancelEnrichTree() {
		try {
			const res = await fetch("/api/study/enrich?" + new URLSearchParams({ domain: map.domain }), { method: "DELETE" });
			if (res.ok) {
				const data = (await res.json()) as { status?: TreeEnrichmentStatus | null };
				if (data.status) setEnrichJob(data.status);
			}
		} catch {
			// Ignore transient error.
		}
	}

	return (
		<main className="h-dvh overflow-y-auto px-4 py-5 md:px-8">
			<header className="mb-4 flex flex-wrap items-end justify-between gap-3">
				<div className="space-y-1">
					<Link
						href="/"
						className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground hover:underline"
					>
						<Icon name="chevron-left" size={16} tone={false} />
						{t("map.tree.backToday")}
					</Link>
					<h1 className="cel-display text-3xl leading-tight">
						{t("map.tree.title", { domain: map.title })}
					</h1>
				</div>
				<div className="relative flex w-full max-w-xs items-center">
					<span className="pointer-events-none absolute left-3 text-muted-foreground" aria-hidden="true">
						<Icon name="search" size={15} tone={false} />
					</span>
					<input
						type="search"
						aria-label={t("map.tree.searchAria")}
						placeholder={t("map.tree.searchPlaceholder")}
						className="cel-input w-full py-2 pl-9 pr-8 text-sm"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
					/>
					{query && (
						<button
							type="button"
							aria-label={t("map.tree.clearSearchAria")}
							onClick={() => setQuery("")}
							className="absolute right-2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
						>
							<Icon name="close" size={14} tone={false} />
						</button>
					)}
				</div>
			</header>

			<div className="cel-card mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5 px-4 py-3">
				<div className="min-w-52 max-w-sm flex-1 space-y-1.5">
					<div className="flex items-baseline justify-between gap-2 text-sm">
						<span className="font-semibold tabular-nums">
							{t("map.tree.completedOf", { completed, total: leaves.length })}
						</span>
						<span className="font-mono text-xs text-muted-foreground tabular-nums">
							{completed > 0 && pct === 0 ? "<1%" : `${pct}%`}
						</span>
					</div>
					<progress
						aria-label={t("map.tree.domainProgressAria")}
						value={completed}
						max={leaves.length}
						className="study-progress study-progress-success block w-full"
					/>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<button
						type="button"
						aria-expanded={assistantOpen}
						className={
							"cel-button min-h-8 px-3 py-1 text-xs " +
							(assistantOpen ? "cel-button-primary" : "")
						}
						onClick={() => setAssistantOpen((open) => !open)}
					>
						<SparklesIcon aria-hidden="true" className="size-3.5 shrink-0" />
						{t("map.tree.assistantButton")}
					</button>
					{regionUnits.length > 0 && (
						<button
							type="button"
							className="cel-button min-h-8 px-3 py-1 text-xs"
							disabled={enrichingTree}
							onClick={() => void enrichWholeTree()}
						>
							<Icon name="book" size={14} tone={false} />
							{enrichingTree ? t("map.tree.enrichingTree") : t("map.tree.enrichTree")}
						</button>
					)}
					{anchor && (
						<button
							type="button"
							className="cel-chip cursor-pointer py-1 text-left text-xs"
							onClick={() => {
								pick(anchor.id);
								setLocate((n) => n + 1);
							}}
						>
							<span
								aria-hidden="true"
								className="size-2 shrink-0 rounded-full bg-[var(--c-teal,#2ec4b6)] ring-2 ring-[var(--c-teal,#2ec4b6)]/40"
							/>
							<span className="text-muted-foreground">
								{map.position ? t("map.tree.whereLeftOff") : t("map.tree.startingPoint")}:
							</span>
							<span className="max-w-64 truncate font-semibold text-foreground">{anchor.title}</span>
						</button>
					)}
				</div>
			</div>

			{assistantOpen && (
				<TreeAssistantPanel
					domain={map.domain}
					selectedNodeId={selected.id}
					selectedNodeTitle={selected.title}
					onClose={() => setAssistantOpen(false)}
					onMapUpdated={() => router.refresh()}
					onMaterialsUpdated={() => setMaterialsNonce((n) => n + 1)}
					onFocusNode={(nodeId) => {
						pick(nodeId);
						setLocate((n) => n + 1);
					}}
				/>
			)}

			{enrichJob && (enrichJob.state === "running" || (enrichJob.finishedAt ?? 0) > enrichDismissedAt) && (
				<div
					role="status"
					aria-live="polite"
					className="cel-card mb-3 space-y-2 border-border/70 bg-card/90 px-4 py-3 text-xs"
				>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="flex min-w-0 items-center gap-2 font-semibold text-foreground">
							{enrichJob.state === "running" ? (
								<span aria-hidden="true" className="size-2.5 shrink-0 animate-pulse rounded-full bg-[var(--c-teal,#2ec4b6)]" />
							) : enrichJob.state === "done" ? (
								<Icon name="check" size={16} />
							) : (
								<span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-muted-foreground" />
							)}
							<span className="truncate">
								{enrichJob.state === "running"
									? t("map.tree.enrichingBatch", { current: Math.min(enrichJob.done + 1, enrichJob.total), total: enrichJob.total })
									: enrichJob.state === "done"
										? t("map.tree.enrichedResult", { count: enrichJob.done })
										: enrichJob.state === "cancelled"
											? t("map.tree.enrichCancelled", { done: enrichJob.done, total: enrichJob.total })
											: enrichJob.error ?? t("map.tree.errEnrich")}
							</span>
						</div>
						<div className="flex shrink-0 items-center gap-2.5">
							{enrichJob.total > 0 && (
								<span className="font-mono text-[11px] text-muted-foreground tabular-nums">
									{enrichJob.done}/{enrichJob.total} ({Math.round((enrichJob.done / enrichJob.total) * 100)}%)
								</span>
							)}
							{enrichJob.state === "running" ? (
								<button
									type="button"
									onClick={() => void cancelEnrichTree()}
									className="font-semibold text-muted-foreground underline hover:text-foreground"
								>
									{t("map.tree.enrichCancel")}
								</button>
							) : (
								<button
									type="button"
									aria-label={t("map.tree.enrichDismiss")}
									onClick={() => setEnrichDismissedAt(enrichJob.finishedAt ?? Date.now())}
									className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
								>
									<Icon name="close" size={14} tone={false} />
								</button>
							)}
						</div>
					</div>
					{enrichJob.state === "running" && (
						<progress className="study-progress block w-full" value={enrichJob.done} max={Math.max(1, enrichJob.total)} />
					)}
					<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
						<span className="truncate">
							{enrichJob.state === "running" && enrichJob.currentRegionTitle
								? t("map.tree.enrichCurrentRegion", { region: enrichJob.currentRegionTitle })
								: t("map.tree.enrichStats", {
									books: enrichJob.addedBooks,
									videos: enrichJob.addedVideos,
									upgraded: enrichJob.upgraded,
								})}
						</span>
						{enrichJob.state === "running" && (
							<span className="tabular-nums">
								{t("map.tree.enrichBackgroundHint", { max: enrichJob.maxPerNode })}
							</span>
						)}
					</div>
				</div>
			)}

			<nav aria-label={t("map.tree.breadcrumbAria")} className="mb-3.5 flex flex-wrap items-center gap-1.5 text-sm">
				{trail.map((n, i) => (
					<span key={n.id} className="inline-flex items-center gap-1.5">
						{i > 0 && (
							<span aria-hidden="true" className="text-muted-foreground/60">
								›
							</span>
						)}
						<button
							type="button"
							aria-current={n.id === id ? "page" : undefined}
							className={
								"rounded-md px-2 py-0.5 transition-colors " +
								(n.id === id
									? "bg-accent font-semibold text-foreground"
									: "text-muted-foreground hover:bg-accent/60 hover:text-foreground")
							}
							onClick={() => pick(n.id)}
						>
							{n.title}
						</button>
					</span>
				))}
			</nav>

			<div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
				<div className="min-w-0">
					<SkillCanvas map={map} selected={id} locate={locate} onPick={pick} />
				</div>

				<aside className="cel-card space-y-3.5 p-4 xl:col-start-2 xl:row-span-2" aria-live="polite">
					<div className="flex flex-wrap items-center gap-1.5">
						{category && <span className="study-pill">{category}</span>}
						{(progress ?? (selected.leaf ? nodeStateLabel(t, selected.state) : undefined)) && (
							<span className={statusPillClass(selected)}>
								{progress ?? nodeStateLabel(t, selected.state)}
							</span>
						)}
					</div>
					{selected.independentRecallAt && (
						<p className="rounded-lg border border-border/50 bg-background/60 px-2.5 py-1.5 text-xs text-muted-foreground">
							{t("map.tree.independentRecall", {
								date: dateFmt.format(new Date(selected.independentRecallAt)),
							})}
						</p>
					)}
					<h2 className="cel-display text-xl leading-snug">{selected.title}</h2>
					{selected.reinforcementFor && (
						<button
							type="button"
							className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--cel-link,var(--lh-accent))] underline underline-offset-2"
							onClick={() => pick(selected.reinforcementFor!)}
						>
							{t("map.tree.optionalReinforcementOf", {
								title: byId.get(selected.reinforcementFor)?.title ?? selected.reinforcementFor,
							})}
						</button>
					)}
					{(reinforcementsByTarget.get(id) ?? []).map((n) => (
						<button
							key={n.id}
							type="button"
							className="cel-button w-full justify-start px-3 py-2 text-sm"
							onClick={() => {
								pick(n.id);
								setLocate((v) => v + 1);
							}}
						>
							<Icon name="review" size={16} />
							{t("map.tree.studyReinforcementItem", { title: n.title })}
						</button>
					))}
					{selected.kind === "domain" && (
						<div className="space-y-3">
							<p className="text-sm text-muted-foreground tabular-nums">
								{t("map.tree.domainCounts", {
									regions: regionUnits.length,
									skills: leaves.length,
								})}
							</p>
							{map.next && (
								<button
									type="button"
									onClick={() => pick(map.next!)}
									className="cel-button cel-button-primary px-4 py-2 text-sm"
								>
									<Icon name="arrow-right" size={16} tone={false} />
									{map.reinforcement ? t("map.tree.openReinforcement") : t("map.tree.nextSkill")}
								</button>
							)}
							{map.reinforcement && <p className="text-sm text-muted-foreground">{map.reinforcement}</p>}
						</div>
					)}
					{selected.requires.length > 0 && (
						<details className="study-disclosure text-sm">
							<summary>{t("map.tree.prerequisites")}</summary>
							<div className="study-disclosure-body space-y-2">
								{selected.requires.map((group, i) => (
									<div key={i} className="flex flex-wrap items-center gap-1.5 text-xs">
										{i > 0 && <b className="text-muted-foreground">{t("map.tree.or")}</b>}
										{group.map((key, j) => (
											<span key={key} className="inline-flex items-center gap-1.5">
												{j > 0 && <span className="text-muted-foreground">+</span>}
												<button
													type="button"
													className="rounded-md border border-border/60 bg-card px-2 py-0.5 text-left font-medium hover:border-foreground hover:bg-accent"
													onClick={() => pick(key)}
												>
													{byId.get(key)?.title ?? key}
												</button>
											</span>
										))}
									</div>
								))}
							</div>
						</details>
					)}
					<Materials
						key={map.domain}
						domain={map.domain}
						node={selected}
						busy={busy}
						onStart={onStart}
						refreshNonce={materialsNonce}
					/>
				</aside>

				<section aria-label={t("map.tree.skillsAria")} className="order-3 space-y-2.5 xl:col-start-1">
					<div className="flex items-center justify-between gap-2 px-0.5">
						<h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
							{q
								? t("map.tree.searchResults", { query: query.trim(), count: rows.length })
								: t("map.tree.scopeItems", { title: scope.title, count: rows.length })}
						</h2>
					</div>
					<div className="grid gap-2 sm:grid-cols-2">
						{rows.map((n) => {
							const isCurrent = id === n.id;
							const iconName = n.completed
								? "check"
								: n.inProgress
									? "node-learning"
									: n.state === "known"
										? "check"
										: n.state === "locked"
											? "node-locked"
											: n.leaf
												? "book"
												: "graph";
							return (
								<button
									key={n.id}
									type="button"
									onClick={() => pick(n.id)}
									aria-pressed={isCurrent}
									className={
										"study-cv-block flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm transition-all " +
										(isCurrent
											? "border-[var(--cel-accent,var(--foreground))] bg-[color-mix(in_srgb,var(--cel-accent,var(--primary))_10%,var(--card))] font-semibold shadow-xs"
											: "border-border/55 bg-card hover:border-foreground/40 hover:bg-accent/70")
									}
								>
									<Icon name={iconName} size={17} />
									<span className="min-w-0 flex-1 leading-snug">{n.title}</span>
									{n.completed && (
										<span className="shrink-0 text-[11px] font-semibold text-[var(--cel-success-text,var(--lh-success))]">
											{t("map.tree.done")}
										</span>
									)}
									{!n.completed && n.inProgress && (
										<span className="shrink-0 text-[11px] font-semibold text-[var(--cel-accent-text,var(--lh-accent))]">
											{t("map.tree.inProgress")}
										</span>
									)}
								</button>
							);
						})}
					</div>
					{q && !rows.length && (
						<p className="rounded-xl border border-border/50 bg-card px-4 py-3 text-sm text-muted-foreground">
							{t("map.tree.noSkillsFound")}
						</p>
					)}
				</section>
			</div>
		</main>
	);
}
