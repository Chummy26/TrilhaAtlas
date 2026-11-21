"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
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
			const response = await fetch(endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ topic, model, pace, requestId: id }),
			});
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
		} finally { setBusy(false); submitting.current = false; }
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

	return <main className="h-dvh overflow-y-auto px-5 py-10">
		<div className="mx-auto max-w-2xl space-y-5">
			<div className="space-y-1.5">
				<Link href="/" className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground hover:underline">
					<Icon name="chevron-left" size={16} tone={false} />
					Voltar aos estudos
				</Link>
				<h1 className="cel-display text-3xl leading-tight">Criar domínio de estudo</h1>
			</div>

			{status?.state === "ready" ? (
				<section className="cel-card space-y-5 p-6">
					<div className="flex items-start gap-3">
						<Icon name="check" size={26} />
						<div>
							<p className="text-xs font-semibold uppercase tracking-wider text-[var(--cel-success-text,var(--lh-success))]">Domínio pronto</p>
							<h2 className="cel-display text-2xl leading-snug">{status.title}</h2>
						</div>
					</div>
					{status.workload && (
						<dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
							<div className="rounded-xl border border-border/50 bg-background/60 p-3 text-center">
								<dt className="text-xs text-muted-foreground">Regiões</dt>
								<dd className="cel-display mt-0.5 text-xl tabular-nums">{status.workload.regions}</dd>
							</div>
							<div className="rounded-xl border border-border/50 bg-background/60 p-3 text-center">
								<dt className="text-xs text-muted-foreground">Habilidades</dt>
								<dd className="cel-display mt-0.5 text-xl tabular-nums">{status.workload.skills}</dd>
							</div>
							<div className="rounded-xl border border-border/50 bg-background/60 p-3 text-center">
								<dt className="text-xs text-muted-foreground">Aulas</dt>
								<dd className="cel-display mt-0.5 text-xl tabular-nums">{status.workload.lessonHours} h</dd>
							</div>
							<div className="rounded-xl border border-border/50 bg-background/60 p-3 text-center">
								<dt className="text-xs text-muted-foreground">Prática</dt>
								<dd className="cel-display mt-0.5 text-xl tabular-nums">{status.workload.practiceHours} h</dd>
							</div>
						</dl>
					)}
					<div className="flex flex-wrap items-center gap-3">
						<button type="button" className="cel-button cel-button-primary px-5 py-2 text-sm" disabled={busy} onClick={() => void showMap(status.domainId)}>
							<Icon name="map" size={16} tone={false} />
							Abrir minha árvore
						</button>
						<button type="button" className="cel-button cel-button-ghost px-3 py-2 text-sm" onClick={() => { sessionStorage.removeItem(lastRequest); setRequestId(""); setStatus(undefined); setTopic(""); setError(""); }}>
							Criar outro domínio
						</button>
					</div>
				</section>
			) : (
				<form className="cel-card space-y-5 p-6" onSubmit={event => { event.preventDefault(); void create(); }}>
					<label className="block space-y-2">
						<span className="text-sm font-semibold">O que você quer aprender a fazer?</span>
						<textarea
							className="cel-input block w-full resize-y p-3 text-[15px] leading-relaxed"
							rows={4}
							value={topic}
							minLength={3}
							maxLength={1600}
							required
							disabled={working || busy}
							onChange={event => setTopic(event.target.value)}
							placeholder="Ex.: Quero aprender astronomia do zero até interpretar dados de um telescópio."
						/>
					</label>

					<fieldset className="space-y-2.5" disabled={working || busy}>
						<legend className="text-sm font-semibold">Extensão da campanha</legend>
						<div className="grid gap-2 sm:grid-cols-3">
							{(Object.entries(campaignPaces) as [CampaignPace, typeof workload][]).map(([key, option]) => {
								const active = pace === key;
								return (
									<button
										key={key}
										type="button"
										aria-pressed={active}
										onClick={() => setPace(key)}
										className={
											"flex flex-col items-start rounded-xl border p-3 text-left transition-all cursor-pointer " +
											(active
												? "border-[var(--cel-accent,var(--foreground))] bg-[color-mix(in_srgb,var(--cel-accent,var(--primary))_10%,var(--card))] shadow-xs"
												: "border-border/55 bg-background/55 hover:border-foreground/40 hover:bg-accent/60")
										}
									>
										<span className="cel-display text-sm">{option.label}</span>
										<span className="mt-0.5 text-xs text-muted-foreground tabular-nums">{option.weeks} semanas · ~{campaignHours(key)} h</span>
									</button>
								);
							})}
						</div>
						<p className="text-xs leading-relaxed text-muted-foreground tabular-nums">
							{workload.days} dias por semana × {workload.minutes} min · {workload.minRegions}–{workload.maxRegions} regiões e {workload.minRegions * workload.minSkills}–{workload.maxRegions * 14} habilidades.
						</p>
					</fieldset>

					<label className="block space-y-2">
						<span className="text-sm font-semibold">Modelo para criar a árvore</span>
						<select
							className="cel-input block w-full px-3 py-2 text-sm"
							value={selection}
							disabled={working || busy}
							onChange={event => {
								const item = models[Number(event.target.value)];
								if (item) setChosen({ provider: item.provider, id: item.id });
							}}
						>
							<option value={-1} disabled>Escolha um modelo</option>
							{models.map((entry, i) => <option key={entry.provider + "/" + entry.id} value={i}>{entry.name} · {entry.provider}</option>)}
						</select>
					</label>

					{!working && (
						<div className="flex flex-wrap items-center gap-3 text-xs">
							<button className="font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground cursor-pointer" type="button" onClick={() => open("keys")}>
								Configurar assinatura ou provedores
							</button>
							{failed && (
								<button type="button" className="font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground cursor-pointer" onClick={refresh}>
									Recarregar modelos
								</button>
							)}
						</div>
					)}

					{working ? (
						<div role="status" aria-live="polite" className="space-y-3 rounded-xl border border-border/60 bg-background/70 p-4">
							<div className="flex items-center justify-between gap-2 text-sm font-semibold">
								<span>{status.state === "materials" ? "Buscando livros e vídeos por região…" : "Organizando a árvore de habilidades…"}</span>
								{status.total > 0 && <span className="font-mono text-xs text-muted-foreground tabular-nums">{status.done}/{status.total}</span>}
							</div>
							<progress className="study-progress block w-full" value={status.total > 0 ? status.done : undefined} max={status.total > 0 ? status.total : undefined} />
							<button type="button" className="text-xs font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground cursor-pointer" onClick={() => void fetch(endpoint + "?id=" + requestId, { method: "DELETE" }).then(r => { if (!r.ok) throw new Error(); }).catch(() => setError("Não foi possível cancelar."))}>
								Cancelar criação
							</button>
						</div>
					) : (
						<button className="cel-button cel-button-primary px-5 py-2 text-sm" disabled={busy || selection < 0 || topic.trim().length < 3} type="submit">
							<Icon name="plus" size={16} tone={false} />
							Criar árvore
						</button>
					)}
				</form>
			)}

			{(error || status?.state === "failed") && (
				<p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
					{error || (status?.state === "failed" && status.error)}
				</p>
			)}
		</div>
	</main>;
}
