"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useModelCatalog } from "@/components/model-catalog";
import { useSettingsDialog } from "@/components/settings/settings-dialog";
import { campaignHours, campaignPaces, type CampaignPace, type DomainCreationStatus, type PluginModelValue } from "@/src/core";

const endpoint = "/api/domains/create";
const lastRequest = "trilhaatlas.domain-creation";

export function DomainCreator() {
	const { catalog, failed, refresh } = useModelCatalog();
	const { open } = useSettingsDialog();
	const [topic, setTopic] = useState("");
	const [pace, setPace] = useState<CampaignPace>("extended");
	const workload = campaignPaces[pace];
	const [chosen, setChosen] = useState<PluginModelValue>();
	const [requestId, setRequestId] = useState("");
	const [status, setStatus] = useState<DomainCreationStatus>();
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const submitting = useRef(false);
	const model = chosen ?? catalog?.defaults?.model;
	const models = catalog?.models ?? [];
	const selection = models.findIndex(entry => entry.provider === model?.provider && entry.id === model.id);
	const working = status?.state === "planning" || status?.state === "materials";

	useEffect(() => {
		const id = sessionStorage.getItem(lastRequest);
		if (id) setRequestId(id);
	}, []);

	useEffect(() => {
		if (!requestId) return;
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout>;
		async function poll() {
			try {
				const response = await fetch(endpoint + "?id=" + encodeURIComponent(requestId), { signal: controller.signal, cache: "no-store" });
				const body = await response.json();
				if (controller.signal.aborted) return;
				if (!response.ok) {
					if (response.status >= 500) throw new Error();
					setStatus({ state: "failed", error: body.error ?? "Pedido indisponível." });
					sessionStorage.removeItem(lastRequest);
					return;
				}
				setStatus(body);
				setError("");
				if (body.state === "ready" || body.state === "failed") return;
			} catch {
				if (controller.signal.aborted) return;
				setError("Reconectando ao servidor…");
			}
			timer = setTimeout(() => void poll(), 1500);
		}
		void poll();
		return () => { controller.abort(); clearTimeout(timer); };
	}, [requestId]);

	async function create() {
		if (submitting.current || working || selection < 0) return;
		submitting.current = true;
		setBusy(true);
		setError("");
		const id = crypto.randomUUID();
		// A refresh or a lost POST response can still find the original job.
		sessionStorage.setItem(lastRequest, id);
		let refused = false;
		try {
			const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ topic, model, pace, requestId: id }) });
			const body = await response.json();
			if (!response.ok) {
				refused = true;
				sessionStorage.removeItem(lastRequest);
				throw new Error(body.error ?? "Falha ao iniciar a criação.");
			}
			setStatus(body);
			setRequestId(id);
		} catch (e) {
			if (refused) setError(e instanceof Error ? e.message : "Falha ao iniciar a criação.");
			else {
				setStatus({ state: "planning", done: 0, total: 0 });
				setRequestId(id);
				setError("Verificando se a criação começou…");
			}
		}
		finally { setBusy(false); submitting.current = false; }
	}

	async function showMap(domainId: string) {
		setBusy(true);
		try {
			const response = await fetch("/api/domains", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: domainId }) });
			if (!response.ok) throw new Error((await response.json()).error);
			sessionStorage.removeItem(lastRequest);
			window.location.assign("/mapa?dominio=" + encodeURIComponent(domainId));
		} catch (e) { setError(e instanceof Error ? e.message : "Não foi possível abrir a árvore."); }
		finally { setBusy(false); }
	}

	return <main className="h-dvh overflow-y-auto px-5 py-12">
		<div className="mx-auto max-w-xl space-y-6">
			<Link href="/" className="text-sm text-muted-foreground underline">Voltar aos estudos</Link>
			<h1 className="cel-display text-3xl">Criar domínio de estudo</h1>
			{status?.state === "ready" ? <section className="cel-card space-y-4 p-5">
				<h2 className="cel-display text-2xl">{status.title}</h2>
				{status.workload && <p>{status.workload.regions} regiões · {status.workload.skills} habilidades. Estimativa de {status.workload.lessonHours} h de aulas e {status.workload.practiceHours} h de prática distribuída.</p>}
				<button type="button" className="cel-button cel-button-primary px-4 py-2" disabled={busy} onClick={() => void showMap(status.domainId)}>Abrir minha árvore</button>
				<button type="button" className="block text-sm underline" onClick={() => { sessionStorage.removeItem(lastRequest); setRequestId(""); setStatus(undefined); setTopic(""); setError(""); }}>Criar outro domínio</button>
			</section> : <form className="cel-card space-y-5 p-5" onSubmit={event => { event.preventDefault(); void create(); }}>
				<label className="block space-y-2"><span className="font-semibold">O que você quer aprender a fazer?</span>
					<textarea className="block w-full rounded-lg border bg-background p-3" rows={4} value={topic} minLength={3} maxLength={1600} required disabled={working || busy}
						onChange={event => setTopic(event.target.value)} placeholder="Quero aprender astronomia do zero até interpretar dados de um telescópio." />
				</label>
				<label className="block space-y-2"><span className="font-semibold">Extensão da campanha</span>
					<select className="block w-full rounded-md border bg-background p-2" value={pace} disabled={working || busy} onChange={event => setPace(event.target.value as CampaignPace)}>
						{(Object.entries(campaignPaces) as [CampaignPace, typeof workload][]).map(([key, option]) => <option value={key} key={key}>{option.label} · {option.weeks} semanas</option>)}
					</select>
					<span className="block text-sm">{workload.days} dias por semana × {workload.minutes} min. Cerca de {campaignHours(pace)} h entre aulas e prática distribuída, com {workload.minRegions}–{workload.maxRegions} regiões e {workload.minRegions * workload.minSkills}–{workload.maxRegions * 14} habilidades.</span>
				</label>
				<label className="block space-y-2"><span className="text-sm font-semibold">Modelo para criar a árvore</span>
					<select className="block w-full rounded-md border bg-background p-2" value={selection} disabled={working || busy} onChange={event => {
						const item = models[Number(event.target.value)];
						if (item) setChosen({ provider: item.provider, id: item.id });
					}}>
						<option value={-1} disabled>Escolha um modelo</option>
						{models.map((entry,i) => <option key={entry.provider + "/" + entry.id} value={i}>{entry.name} · {entry.provider}</option>)}
					</select>
				</label>
				{!working && <button className="text-sm underline" type="button" onClick={() => open("keys")}>Configurar assinatura do ChatGPT</button>}
				{failed && <button type="button" className="block text-sm underline" onClick={refresh}>Recarregar modelos</button>}
				{working ? <div role="status" aria-live="polite" className="space-y-2">
					<p>{status.state === "materials" ? "Buscando livros e vídeos por região…" : "Organizando a árvore de habilidades…"} {status.total > 0 && `(${status.done}/${status.total})`}</p>
					<button type="button" className="text-sm underline" onClick={() => void fetch(endpoint + "?id=" + requestId, { method: "DELETE" }).then(r => { if (!r.ok) throw new Error(); }).catch(() => setError("Não foi possível cancelar."))}>Cancelar criação</button>
				</div> : <button className="cel-button cel-button-primary block px-4 py-2" disabled={busy || selection < 0 || topic.trim().length < 3} type="submit">Criar árvore</button>}
			</form>}
			{(error || status?.state === "failed") && <p role="alert" className="text-sm text-destructive">{error || (status?.state === "failed" && status.error)}</p>}
		</div>
	</main>;
}
