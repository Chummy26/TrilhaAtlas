"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { useServerEvent } from "@/components/server-events";
import { useSettingsSaved } from "@/components/settings-signal";
import type { RegionMaterials, SkillMap, SkillNode, StudyNodeBrief } from "@/src/core";
import type { LessonStart } from "./today-card.tsx";
import { lessonStatement } from "./lesson-statement.ts";
import { SkillCanvas } from "./skill-canvas.tsx";

const STATUS = { known: "Conhecimento inferido", available: "Disponível", locked: "Pré-requisitos pendentes", group: "Grupo" };
type NodeDetail = { brief: StudyNodeBrief; minutes: number; sessionId?: string; explorationId?: string; missing: { id: string; title: string }[] };

function statusPillClass(node: SkillNode): string {
	if (node.completed) return "study-pill study-pill-success";
	if (node.inProgress) return "study-pill study-pill-accent";
	if (node.state === "available") return "study-pill study-pill-info";
	if (node.state === "locked") return "study-pill study-pill-warning";
	return "study-pill";
}

function Materials({ domain, node, onStart, busy }: { domain: string; node: SkillNode; onStart: (l: LessonStart) => void; busy: boolean }) {
	const [data, setData] = useState<RegionMaterials>();
	const [revision, setRevision] = useState(0);
	useSettingsSaved(section => { if (section === "keys") setRevision(r => r + 1); });
	const [detail, setDetail] = useState<NodeDetail>();
	const [error, setError] = useState("");
	const [searching, setSearching] = useState(false);
	const endpoint = "/api/study/materials?" + new URLSearchParams({ domain, node: node.id });
	useEffect(() => {
		const ctrl = new AbortController();
		async function read() {
			const res = await fetch(endpoint + "&lesson=1", { signal: ctrl.signal });
			if (!res.ok) throw new Error("Não foi possível carregar a região.");
			const json = await res.json();
			if (ctrl.signal.aborted) return;
			setDetail(json);
			setData(json.regionMaterials);
		}
		void read().catch((e: Error) => { if (!ctrl.signal.aborted) setError(e.message); });
		return () => ctrl.abort();
	}, [endpoint, revision]);

	async function discover(kind: "video" | "book", download?: string) {
		setSearching(true); setError("");
		try {
			const action = download ? "&download=" + encodeURIComponent(download) : "&kind=" + kind;
			const res = await fetch(endpoint + action, { method: "POST" });
			const result = await res.json();
			if (!res.ok) throw new Error(result.error ?? "Não foi possível carregar os materiais.");
			setData(result);
		} catch (e) { setError(e instanceof Error ? e.message : "Não foi possível buscar materiais."); }
		finally { setSearching(false); }
	}
	async function updateBook(file?: File, removeId = "") {
		setSearching(true); setError("");
		try {
			const form = new FormData();
			if (file) form.set("file", file);
			const res = await fetch(endpoint + "&pdf=" + encodeURIComponent(removeId), { method: file ? "POST" : "DELETE", body: file ? form : undefined });
			const result = await res.json();
			if (!res.ok) throw new Error(result.error ?? "Não foi possível atualizar o livro.");
			setData(result);
		} catch (e) { setError(e instanceof Error ? e.message : "Não foi possível atualizar o livro."); }
		finally { setSearching(false); }
	}
	function start(exploratory: boolean) {
		if (detail) onStart({
			domainId: domain, minutes: detail.minutes, title: node.title, exploratory,
			context: { id: node.id, name: node.title, statement: lessonStatement(detail.brief, detail.minutes) },
		});
	}
	const materials = data?.materials.filter(m => node.kind === "unit" || m.nodes.includes(node.id) || m.nodes.includes(data.region)) ?? [];
	const groups = new Map<string, typeof materials>();
	for (const m of materials) {
		const key = m.kind + ":" + m.title;
		const group = groups.get(key);
		if (group) group.push(m);
		else groups.set(key, [m]);
	}
	const otherParts = node.kind === "unit" ? [] : data?.materials.filter(m => !materials.some(own => own.url === m.url)) ?? [];
	return <div className="space-y-4">
		{detail && <div className="space-y-3">
			<p className="text-[15px] leading-relaxed text-foreground/90">{detail.brief.summary}</p>
			<div className="flex flex-wrap items-center gap-2">
				{detail.sessionId ? (
					<Link className="cel-button cel-button-primary px-4 py-2 text-sm" href={"/chat/" + encodeURIComponent(detail.sessionId)}>
						<Icon name="play" size={15} />
						Continuar aula
					</Link>
				) : node.leaf && !node.reinforcementFor && node.state !== "locked" && (
					<button type="button" className="cel-button cel-button-primary px-4 py-2 text-sm" disabled={busy} onClick={() => start(false)}>
						<Icon name="play" size={15} />
						Começar aula
					</button>
				)}
				{detail.explorationId ? (
					<Link href={"/chat/" + encodeURIComponent(detail.explorationId)} className="cel-button px-3 py-1.5 text-sm">Retomar exploração</Link>
				) : (
					<button type="button" className="cel-button px-3 py-1.5 text-sm" disabled={busy} onClick={() => start(true)}>
						{node.reinforcementFor ? "Estudar reforço" : node.leaf ? "Explorar em aula avulsa" : "Explorar em uma aula panorâmica"}
					</button>
				)}
			</div>
			{node.state === "locked" && (
				<p className="rounded-lg border border-border/50 bg-background/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
					{detail.missing.length ? "Para acompanhar, ajuda conhecer " + detail.missing.map(m => m.title).join(" · ") + "." : "Há pré-requisitos pendentes."} Você pode explorar mesmo assim.
				</p>
			)}
		</div>}

		{node.region && <div className="space-y-3 border-t border-border/50 pt-3.5">
			<div className="flex items-center gap-2">
				<Icon name="book" size={18} />
				<h3 className="cel-display text-base">{node.kind === "unit" ? "Materiais da região" : "Materiais do nó"}</h3>
			</div>
			{data?.localReadings?.map(book => <div key={book.id} className="reader-shelf">
				<Link href={"/ler/" + book.id + "?" + new URLSearchParams({ domain, region: data.region, node: node.id })}>
					<Icon name="book" size={20} />
					<span className="min-w-0 truncate">
						<strong className="block truncate text-sm">{book.title}</strong>
						<small>Ler no aplicativo</small>
					</span>
				</Link>
				<button type="button" aria-label={"Desvincular " + book.title + " da região"} disabled={searching} onClick={() => void updateBook(undefined, book.id)}>Desvincular</button>
			</div>)}
			{data && <details className="study-disclosure text-sm">
				<summary>Livros da região{data.localReadings?.length ? " (" + data.localReadings.length + ")" : ""}</summary>
				<div className="study-disclosure-body space-y-2">
					<p className="text-xs leading-relaxed text-muted-foreground">O tutor pode enviar trechos relevantes destes livros ao modelo escolhido durante a aula.</p>
					<label className="block text-xs font-semibold">Adicionar PDF ou EPUB de até 64 MiB
						<input type="file" accept="application/pdf,application/epub+zip,.pdf,.epub" disabled={searching} className="mt-1.5 block w-full text-xs font-normal text-muted-foreground" onChange={e => {
							const file = e.currentTarget.files?.[0]; e.currentTarget.value = "";
							if (file) void updateBook(file);
						}} />
					</label>
				</div>
			</details>}
			{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
			{!data && !error && <p role="status" className="text-sm text-muted-foreground">Carregando…</p>}
			{data && !materials.length && !data.localReadings?.length && <p className="text-sm text-muted-foreground">Ainda sem material vinculado.</p>}
			{[...groups].map(([key, group]) => {
				const first = group[0]!;
				return <section key={key} className="space-y-2 rounded-xl border border-border/55 bg-background/55 p-3">
					<h4 className="flex items-start gap-2 text-sm font-semibold leading-snug">
						<Icon name={first.kind === "book" ? "book" : "video"} size={17} />
						<span className="min-w-0 flex-1">{first.kind === "book" ? "Leitura" : "Vídeo"} · {first.title}</span>
					</h4>
					<div className="space-y-1.5 pl-6">
						{group.map(m => <a key={m.url + !!m.suggested} href={m.url} target="_blank" rel="noreferrer" className="block text-sm leading-snug underline decoration-border underline-offset-2 hover:decoration-foreground">
							{m.part} <span className="text-xs text-muted-foreground">{m.lang}{m.suggested ? " · Sugestão" : ""}</span>
						</a>)}
					</div>
					{first.bookKey && <button type="button" className="cel-button cel-button-ghost min-h-7 px-2 py-1 text-xs font-semibold" disabled={searching || first.saved} onClick={() => discover("book", first.bookKey)}>
						{first.saved ? "✓ Na biblioteca" : "↓ Salvar livro na biblioteca"}
					</button>}
				</section>;
			})}
			{data && <div className="flex flex-wrap items-center gap-2 pt-1">
				<button type="button" className="cel-button min-h-8 px-3 py-1 text-xs" disabled={searching} onClick={() => discover("book")}>
					<Icon name="search" size={14} tone={false} />
					{searching ? "Buscando…" : "Buscar livros"}
				</button>
				{data.videoSearch ? (
					<button type="button" className="cel-button min-h-8 px-3 py-1 text-xs" disabled={searching} onClick={() => discover("video")}>
						<Icon name="video" size={14} tone={false} />
						Buscar vídeos
					</button>
				) : (
					<a className="cel-button cel-button-ghost min-h-8 px-2.5 py-1 text-xs underline underline-offset-2" href={"https://www.youtube.com/results?" + new URLSearchParams({ search_query: node.title + " " + (detail?.brief.summary ?? "").slice(0, 90) })} target="_blank" rel="noreferrer">
						Pesquisar no YouTube
					</a>
				)}
			</div>}
			{otherParts.length > 0 && <details className="study-disclosure text-sm">
				<summary>Outros trechos da região ({otherParts.length})</summary>
				<div className="study-disclosure-body space-y-1.5">
					{otherParts.map(m => <a key={m.url + !!m.suggested} href={m.url} target="_blank" rel="noreferrer" className="block text-xs leading-snug underline underline-offset-2">{m.title} · {m.part}{m.suggested && " · Sugestão"}</a>)}
				</div>
			</details>}
			{!!data?.references.length && <details className="study-disclosure text-sm">
				<summary>Bibliografia da região ({data.references.length})</summary>
				<ul className="study-disclosure-body space-y-2">{data.references.map(ref => <li key={ref.title} className="text-xs leading-snug">
					{ref.url ? <a href={ref.url} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">{ref.title}</a> : <span className="font-semibold">{ref.title}</span>}
					{ref.parts.length > 0 && <p className="mt-0.5 text-muted-foreground">{ref.parts.join(" · ")}</p>}
				</li>)}</ul>
			</details>}
			{data?.message && <p role="status" className="text-xs text-muted-foreground">{data.message}</p>}
		</div>}
		{!node.region && error && <p role="alert" className="text-sm text-destructive">{error}</p>}
	</div>;
}

export function SkillTree({ map, initialNode, onStart, busy }: { map: SkillMap; initialNode?: string; onStart: (l: LessonStart) => void; busy: boolean }) {
	const router = useRouter();
	useServerEvent("domain-changed", () => router.replace("/"));
	useServerEvent("curriculum-expanded", event => { if (event.domainId === map.domain) router.refresh(); });
	const byId = useMemo(() => new Map(map.nodes.map(n => [n.id, n])), [map.nodes]);
	const root = map.nodes.find(n => !n.parent)!;
	const [id, setId] = useState(initialNode && byId.has(initialNode) ? initialNode : map.position ?? map.next ?? root.id);
	const selected = byId.get(id) ?? root;
	const scope = selected.leaf ? byId.get(selected.region ?? selected.parent ?? root.id)! : selected;
	const [query, setQuery] = useState("");
	const q = query.trim().toLocaleLowerCase("pt-BR");
	const rows = q ? map.nodes.filter(n => n.title.toLocaleLowerCase("pt-BR").includes(q)).slice(0, 60) :
		map.nodes.filter(n => n.parent === scope.id || (selected.leaf && n.region === scope.id && n.leaf)).sort((a, b) => a.order - b.order);
	const anchor = byId.get(map.position ?? map.next ?? "");
	const leaves = useMemo(() => map.nodes.filter(n => n.leaf && !n.reinforcementFor), [map.nodes]);
	const completed = leaves.filter(n => n.completed).length;
	const pct = leaves.length > 0 ? Math.round((100 * completed) / leaves.length) : 0;
	const [locate, setLocate] = useState(0);
	const trail: SkillNode[] = [selected];
	while (trail[0]?.parent && byId.has(trail[0].parent)) trail.unshift(byId.get(trail[0].parent)!);
	const progress = selected.completed ? "Concluída" : selected.inProgress ? "Em andamento" : undefined;
	const category = selected.leaf ? selected.level : selected.kind === "domain" ? "Jornada de estudo" : selected.kind === "unit" ? "Região" : "Área de estudo";
	function pick(key: string) { setId(key); setQuery(""); }
	return <main className="h-dvh overflow-y-auto px-4 py-5 md:px-8">
		<header className="mb-4 flex flex-wrap items-end justify-between gap-3">
			<div className="space-y-1">
				<Link href="/" className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground hover:underline">
					<Icon name="chevron-left" size={16} tone={false} />
					Hoje
				</Link>
				<h1 className="cel-display text-3xl leading-tight">Árvore de {map.title}</h1>
			</div>
			<div className="relative flex w-full max-w-xs items-center">
				<span className="pointer-events-none absolute left-3 text-muted-foreground" aria-hidden="true">
					<Icon name="search" size={15} tone={false} />
				</span>
				<input
					type="search"
					aria-label="Buscar habilidade"
					placeholder="Buscar habilidade ou região…"
					className="cel-input w-full py-2 pl-9 pr-8 text-sm"
					value={query}
					onChange={e => setQuery(e.target.value)}
				/>
				{query && (
					<button type="button" aria-label="Limpar busca" onClick={() => setQuery("")}
						className="absolute right-2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
						<Icon name="close" size={14} tone={false} />
					</button>
				)}
			</div>
		</header>

		<div className="cel-card mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5 px-4 py-3">
			<div className="min-w-52 flex-1 max-w-sm space-y-1.5">
				<div className="flex items-baseline justify-between gap-2 text-sm">
					<span className="font-semibold tabular-nums">{completed} de {leaves.length} habilidades concluídas</span>
					<span className="font-mono text-xs text-muted-foreground tabular-nums">{completed > 0 && pct === 0 ? "<1%" : `${pct}%`}</span>
				</div>
				<progress aria-label="Progresso do domínio" value={completed} max={leaves.length} className="study-progress study-progress-success block w-full" />
			</div>
			{anchor && (
				<button type="button" className="cel-chip cursor-pointer py-1 text-left text-xs" onClick={() => { pick(anchor.id); setLocate(n => n + 1); }}>
					<span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-[var(--c-teal,#2ec4b6)] ring-2 ring-[var(--c-teal,#2ec4b6)]/40" />
					<span className="text-muted-foreground">{map.position ? "Onde parei" : "Ponto de partida"}:</span>
					<span className="max-w-64 truncate font-semibold text-foreground">{anchor.title}</span>
				</button>
			)}
		</div>

		<nav aria-label="Caminho no currículo" className="mb-3.5 flex flex-wrap items-center gap-1.5 text-sm">
			{trail.map((n, i) => (
				<span key={n.id} className="inline-flex items-center gap-1.5">
					{i > 0 && <span aria-hidden="true" className="text-muted-foreground/60">›</span>}
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
					{(progress ?? (selected.leaf ? STATUS[selected.state] : undefined)) && (
						<span className={statusPillClass(selected)}>
							{progress ?? STATUS[selected.state]}
						</span>
					)}
				</div>
				{selected.independentRecallAt && (
					<p className="rounded-lg border border-border/50 bg-background/60 px-2.5 py-1.5 text-xs text-muted-foreground">
						Resposta independente em revisão posterior · {new Date(selected.independentRecallAt).toLocaleDateString("pt-BR")}
					</p>
				)}
				<h2 className="cel-display text-xl leading-snug">{selected.title}</h2>
				{selected.reinforcementFor && (
					<button type="button" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--cel-link,var(--lh-accent))] underline underline-offset-2" onClick={() => pick(selected.reinforcementFor!)}>
						Reforço opcional de {byId.get(selected.reinforcementFor)?.title}
					</button>
				)}
				{map.nodes.filter(n => n.reinforcementFor === id).map(n => (
					<button key={n.id} type="button" className="cel-button w-full justify-start px-3 py-2 text-sm" onClick={() => { pick(n.id); setLocate(v => v + 1); }}>
						<Icon name="review" size={16} />
						Estudar reforço · {n.title}
					</button>
				))}
				{selected.kind === "domain" && <div className="space-y-3">
					<p className="text-sm text-muted-foreground tabular-nums">{map.nodes.filter(n => n.kind === "unit").length} regiões · {map.nodes.filter(n => n.leaf).length} habilidades</p>
					{map.next && (
						<button type="button" onClick={() => pick(map.next!)} className="cel-button cel-button-primary px-4 py-2 text-sm">
							<Icon name="arrow-right" size={16} tone={false} />
							{map.reinforcement ? "Abrir reforço" : "Próxima habilidade"}
						</button>
					)}
					{map.reinforcement && <p className="text-sm text-muted-foreground">{map.reinforcement}</p>}
				</div>}
				{selected.requires.length > 0 && (
					<details className="study-disclosure text-sm">
						<summary>Pré-requisitos</summary>
						<div className="study-disclosure-body space-y-2">
							{selected.requires.map((group, i) => (
								<div key={i} className="flex flex-wrap items-center gap-1.5 text-xs">
									{i > 0 && <b className="text-muted-foreground">ou</b>}
									{group.map((key, j) => (
										<span key={key} className="inline-flex items-center gap-1.5">
											{j > 0 && <span className="text-muted-foreground">+</span>}
											<button type="button" className="rounded-md border border-border/60 bg-card px-2 py-0.5 text-left font-medium hover:border-foreground hover:bg-accent" onClick={() => pick(key)}>
												{byId.get(key)?.title ?? key}
											</button>
										</span>
									))}
								</div>
							))}
						</div>
					</details>
				)}
				<Materials key={map.domain + id} domain={map.domain} node={selected} busy={busy} onStart={onStart} />
			</aside>

			<section aria-label="Habilidades" className="order-3 space-y-2.5 xl:col-start-1">
				<div className="flex items-center justify-between gap-2 px-0.5">
					<h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
						{q ? `Resultados para “${query.trim()}” (${rows.length})` : `${scope.title} · ${rows.length} ${rows.length === 1 ? "item" : "itens"}`}
					</h2>
				</div>
				<div className="grid gap-2 sm:grid-cols-2">
					{rows.map(n => {
						const isCurrent = id === n.id;
						const iconName = n.completed ? "check" : n.inProgress ? "node-learning" : n.state === "known" ? "check" : n.state === "locked" ? "node-locked" : n.leaf ? "book" : "graph";
						return (
							<button
								key={n.id}
								type="button"
								onClick={() => pick(n.id)}
								aria-pressed={isCurrent}
								className={
									"flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm transition-all " +
									(isCurrent
										? "border-[var(--cel-accent,var(--foreground))] bg-[color-mix(in_srgb,var(--cel-accent,var(--primary))_10%,var(--card))] font-semibold shadow-xs"
										: "border-border/55 bg-card hover:border-foreground/40 hover:bg-accent/70")
								}
							>
								<Icon name={iconName} size={17} />
								<span className="min-w-0 flex-1 leading-snug">{n.title}</span>
								{n.completed && <span className="shrink-0 text-[11px] font-semibold text-[var(--cel-success-text,var(--lh-success))]">Feito</span>}
								{!n.completed && n.inProgress && <span className="shrink-0 text-[11px] font-semibold text-[var(--cel-accent-text,var(--lh-accent))]">Em curso</span>}
							</button>
						);
					})}
				</div>
				{q && !rows.length && <p className="rounded-xl border border-border/50 bg-card px-4 py-3 text-sm text-muted-foreground">Nenhuma habilidade encontrada.</p>}
			</section>
		</div>
	</main>;
}
