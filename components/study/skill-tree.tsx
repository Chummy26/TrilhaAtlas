"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { useServerEvent } from "@/components/server-events";
import { useSettingsDialog } from "@/components/settings/settings-dialog";
import { useSettingsSaved } from "@/components/settings-signal";
import type { RegionMaterials, SkillMap, SkillNode, StudyNodeBrief } from "@/src/core";
import { lessonStatement, type LessonStart } from "./today-card.tsx";
import { SkillCanvas } from "./skill-canvas.tsx";

const STATUS = { known: "Conhecimento inferido", available: "Disponível", locked: "Pré-requisitos pendentes", group: "Grupo" };
type NodeDetail = { brief: StudyNodeBrief; minutes: number; sessionId?: string; explorationId?: string; missing: { id: string; title: string }[] };

function Materials({ domain, node, onStart, busy }: { domain: string; node: SkillNode; onStart: (l: LessonStart) => void; busy: boolean }) {
	const [data, setData] = useState<RegionMaterials>();
	const { open: openSettings } = useSettingsDialog();
	const [revision, setRevision] = useState(0);
	useSettingsSaved(section => { if (section === "keys") setRevision(r => r + 1); });
	const [detail, setDetail] = useState<NodeDetail>();
	const [error,setError] = useState("");
	const [searching,setSearching] = useState(false);
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
	},[endpoint,revision]);
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
	function start(exploratory: boolean) {
		if (detail) onStart({ domainId: domain, minutes: detail.minutes, title: node.title, exploratory,
			context: { id: node.id, name: node.title, statement: lessonStatement(detail.brief, detail.minutes) } });
	}
	const materials = data?.materials.filter(m => node.kind === "unit" || m.nodes.includes(node.id)) ?? [];
	const titles = [...new Set(materials.map(m => m.title))];
	const otherParts = node.kind === "unit" ? [] : data?.materials.filter(m => !materials.some(own => own.url === m.url)) ?? [];
	return <div className="space-y-4">
		{detail && <>
			<p className="text-sm leading-relaxed">{detail.brief.summary}</p>
			{detail.sessionId ? <Link className="cel-button cel-button-primary px-4 py-2" href={"/chat/" + encodeURIComponent(detail.sessionId)}>Continuar aula</Link> :
				node.leaf && node.state !== "locked" && <button type="button" className="cel-button cel-button-primary px-4 py-2" disabled={busy} onClick={() => start(false)}>Começar aula</button>}
			{node.state === "locked" && <p className="text-sm text-muted-foreground">{detail.missing.length ? "Para acompanhar, ajuda conhecer " + detail.missing.map(m => m.title).join(" · ") + "." : "Há pré-requisitos pendentes."} Você pode explorar mesmo assim.</p>}
			<div>{detail.explorationId ? <Link href={"/chat/" + encodeURIComponent(detail.explorationId)} className="cel-button px-3 py-1.5">Retomar exploração</Link> :
				<button type="button" className="cel-button px-3 py-1.5" disabled={busy} onClick={() => start(true)}>{node.leaf ? "Explorar em aula avulsa" : "Explorar em uma aula panorâmica"}</button>}</div>
		</>}
		{node.region && <>
		<h3 className="cel-display text-base">{node.kind === "unit" ? "Materiais da região" : "Materiais do nó"}</h3>
		{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
		{!data && !error && <p role="status" className="text-sm">Carregando…</p>}
		{data && !materials.length && <p className="text-sm text-muted-foreground">Ainda sem material vinculado.</p>}
		{titles.map(title => {
			const group = materials.filter(m => m.title === title);
			const first = group[0]!;
			return <section key={title} className="space-y-2 rounded-lg border p-2.5">
				<h4 className="flex items-start gap-2 text-sm font-semibold"><Icon name={first.kind === "book" ? "book" : "play"} size={18} />{title}</h4>
				{group.map(m => <a key={m.url + !!m.suggested} href={m.url} target="_blank" rel="noreferrer" className="block text-sm underline underline-offset-2">
					{m.part} <span className="text-xs text-muted-foreground">{m.lang}{m.suggested ? " · Sugestão" : ""}</span>
				</a>)}
				{first.bookKey && <button className="text-xs font-semibold" disabled={searching || first.saved} onClick={() => discover("book", first.bookKey)}>
					{first.saved ? "✓ Na biblioteca" : "↓ Salvar livro na biblioteca"}
				</button>}
			</section>;
		})}
		{data && <button type="button" className="cel-button mr-2 px-3 py-1 text-sm" disabled={searching} onClick={() => discover("book")}>{searching ? "Buscando…" : "Buscar livros"}</button>}
		{data?.videoSearch ? <button type="button" className="cel-button px-3 py-1 text-sm" disabled={searching} onClick={() => discover("video")}>Buscar vídeos</button>
			: data && <button className="text-xs underline" onClick={() => openSettings("keys","YOUTUBE_API_KEY")}>Configurar YouTube</button>}
		{otherParts.length > 0 && <details className="text-sm">
			<summary className="cursor-pointer">Outros trechos da região</summary>
			{otherParts.map(m => <a key={m.url + !!m.suggested} href={m.url} target="_blank" rel="noreferrer" className="my-2 block underline">{m.title} · {m.part}{m.suggested && " · Sugestão"}</a>)}
		</details>}
		{!!data?.references.length && <details className="text-sm">
			<summary className="cursor-pointer">Bibliografia da região</summary>
			<ul className="space-y-2 pt-2">{data.references.map(ref => <li key={ref.title}>
				{ref.url ? <a href={ref.url} target="_blank" rel="noreferrer" className="underline">{ref.title}</a> : ref.title}
				{ref.parts.length > 0 && <p className="text-xs text-muted-foreground">{ref.parts.join(" · ")}</p>}
			</li>)}</ul>
		</details>}
		{data?.message && <p role="status" className="text-sm">{data.message}</p>}
		</>}
		{!node.region && error && <p role="alert">{error}</p>}
	</div>;
}

export function SkillTree({ map, initialNode, onStart, busy }: { map: SkillMap; initialNode?: string; onStart: (l: LessonStart) => void; busy: boolean }) {
	const router = useRouter();
	useServerEvent("domain-changed", () => router.replace("/"));
	const byId = useMemo(() => new Map(map.nodes.map(n => [n.id,n])),[map.nodes]);
	const root = map.nodes.find(n => !n.parent)!;
	const [id,setId] = useState(initialNode && byId.has(initialNode) ? initialNode : root.id);
	const selected = byId.get(id) ?? root;
	const scope = selected.leaf ? byId.get(selected.region ?? selected.parent ?? root.id)! : selected;
	const [query,setQuery] = useState("");
	const q = query.trim().toLocaleLowerCase("pt-BR");
	const rows = q ? map.nodes.filter(n => n.title.toLocaleLowerCase("pt-BR").includes(q)).slice(0,60) :
		map.nodes.filter(n => n.parent === scope.id || (selected.leaf && n.region === scope.id && n.leaf)).sort((a,b) => a.order-b.order);
	const anchor = byId.get(map.position ?? map.next ?? "");
	const leaves = useMemo(() => map.nodes.filter(n => n.leaf), [map.nodes]);
	const completed = leaves.filter(n => n.completed).length;
	const [locate, setLocate] = useState(0);
	const trail: SkillNode[] = [selected];
	while (trail[0]?.parent && byId.has(trail[0].parent)) trail.unshift(byId.get(trail[0].parent)!);
	const progress = selected.completed ? "Concluída" : selected.inProgress ? "Em andamento" : undefined;
	const category = selected.leaf ? selected.level : selected.kind === "domain" ? "Jornada de estudo" : selected.kind === "unit" ? "Região" : "Área de estudo";
	function pick(key: string) { setId(key); setQuery(""); }
	return <main className="h-dvh overflow-y-auto px-4 py-6 md:px-8">
		<header className="mb-5 flex flex-wrap items-center justify-between gap-2">
			<div><Link href="/" className="text-sm underline">← Hoje</Link><h1 className="cel-display text-3xl">Árvore de {map.title}</h1></div>
			<input type="search" aria-label="Buscar habilidade" placeholder="Buscar habilidade" className="cel-input rounded-lg border px-3 py-2" value={query} onChange={e => setQuery(e.target.value)} />
		</header>
		<div className="cel-card mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
			<div className="min-w-40"><span className="text-sm font-semibold">{completed} de {leaves.length} habilidades concluídas</span>
				<progress aria-label="Progresso do domínio" value={completed} max={leaves.length} className="block h-1.5 w-full accent-emerald-700" /></div>
			{anchor && <button type="button" className="text-left text-sm underline underline-offset-2" onClick={() => { pick(anchor.id); setLocate(n => n + 1); }}>
				{map.position ? "Onde parei" : "Ponto de partida"} · {anchor.title}</button>}
		</div>
		<nav aria-label="Caminho no currículo" className="mb-4 flex flex-wrap items-center gap-2 text-sm">{trail.map((n,i) => <span key={n.id}>{i > 0 && " › "}<button type="button" aria-current={n.id === id ? "page" : undefined} className="hover:underline" onClick={() => pick(n.id)}>{n.title}</button></span>)}</nav>
		<div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
			<div className="min-w-0"><SkillCanvas map={map} selected={id} locate={locate} onPick={pick} /></div>

			<aside className="cel-card space-y-3 p-4 xl:col-start-2 xl:row-span-2" aria-live="polite">
				<p className="text-xs text-muted-foreground">{[category, progress ?? (selected.leaf ? STATUS[selected.state] : undefined)].filter(Boolean).join(" · ")}</p>
				<h2 className="cel-display text-xl">{selected.title}</h2>
				{selected.kind === "domain" && <>
					<p className="text-sm text-muted-foreground">{map.nodes.filter(n => n.kind === "unit").length} regiões · {map.nodes.filter(n => n.leaf).length} habilidades</p>
					{map.next && <button type="button" onClick={() => pick(map.next!)} className="cel-button cel-button-primary px-3 py-2">{map.reinforcement ? "Abrir reforço" : "Próxima habilidade"}</button>}
					{map.reinforcement && <p className="text-sm">{map.reinforcement}</p>}
				</>}
				{selected.requires.length > 0 && <details><summary className="cursor-pointer text-sm">Pré-requisitos</summary>{selected.requires.map((group,i) => <div key={i} className="text-sm">{i > 0 && <b>ou </b>}{group.map((key,j) => <span key={key}>{j > 0 && " + "}<button type="button" className="underline" onClick={() => pick(key)}>{byId.get(key)?.title ?? key}</button></span>)}</div>)}</details>}
				<Materials key={map.domain+id} domain={map.domain} node={selected} busy={busy} onStart={onStart} />
			</aside>
				<div aria-label="Habilidades" className="order-3 grid gap-1.5 sm:grid-cols-2 xl:col-start-1">{rows.map(n => <button key={n.id} type="button" onClick={() => pick(n.id)} className="flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent" aria-pressed={id === n.id}>
					<Icon name={n.state === "known" ? "check" : n.leaf ? "book" : "graph"} size={17} />{n.title}
				</button>)}</div>{q && !rows.length && <p>Nenhuma habilidade encontrada.</p>}
		</div>
	</main>;
}
