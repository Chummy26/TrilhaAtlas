"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { MenuShell } from "@/components/menu-shell";
import { useModelCatalog } from "@/components/model-catalog";
import { ModelMenuList } from "@/components/settings/model-menu";
import { useSettingsDialog } from "@/components/settings/settings-dialog";
import { formatTokens } from "@/components/usage-format";
import { useT } from "@/components/i18n";
import {
	campaignHours,
	campaignPaces,
	cleanModelDisplayName,
	inferModelVendor,
	subscriptionLabel,
	type CampaignPace,
	type DomainCreationStatus,
	type PluginModelValue,
} from "@/src/core";

const endpoint = "/api/domains/create";
const lastRequest = "trilhaatlas.domain-creation";

interface SeedMaterialDraft {
	kind: "book" | "video";
	title: string;
	url: string;
	part: string;
	regionHint: string;
}

export function DomainCreator() {
	const t = useT();
	const { catalog, failed, refresh } = useModelCatalog();
	const { open } = useSettingsDialog();
	const [topic, setTopic] = useState("");
	const [pace, setPace] = useState<CampaignPace>("extended");
	const workload = campaignPaces[pace];
	const [chosen, setChosen] = useState<PluginModelValue>();
	const [materials, setMaterials] = useState<SeedMaterialDraft[]>([]);
	const [draftKind, setDraftKind] = useState<"book" | "video">("video");
	const [draftTitle, setDraftTitle] = useState("");
	const [draftUrl, setDraftUrl] = useState("");
	const [draftPart, setDraftPart] = useState("");
	const [draftHint, setDraftHint] = useState("");
	const [draftError, setDraftError] = useState("");
	const [requestId, setRequestId] = useState("");
	const [status, setStatus] = useState<DomainCreationStatus>();
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [modelMenuOpen, setModelMenuOpen] = useState(false);
	const modelAnchorRef = useRef<HTMLDivElement>(null);
	const submitting = useRef(false);
	const model = chosen ?? catalog?.defaults?.model;
	const models = catalog?.models ?? [];
	const selection = models.findIndex(entry => entry.provider === model?.provider && entry.id === model.id);
	const selectedEntry = selection >= 0 ? models[selection] : undefined;
	const selectedVendor = selectedEntry ? inferModelVendor(selectedEntry) : undefined;
	const modelUnavailable = Boolean(catalog && model && !selectedEntry);
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

	function addMaterial() {
		const title = draftTitle.trim();
		const url = draftUrl.trim();
		if (title.length < 2) { setDraftError(t("pages.creator.errTitle")); return; }
		if (!/^https:\/\//i.test(url)) { setDraftError(t("pages.creator.errUrl")); return; }
		if (materials.length >= 24) { setDraftError("Limite de 24 materiais iniciais atingido."); return; }
		setMaterials(prev => [...prev, { kind: draftKind, title, url, part: draftPart.trim(), regionHint: draftHint.trim() }]);
		setDraftTitle(""); setDraftUrl(""); setDraftPart(""); setDraftHint(""); setDraftError("");
	}

	async function create() {
		if (submitting.current || working || selection < 0) return;
		submitting.current = true;
		setBusy(true);
		setError("");
		const id = crypto.randomUUID();
		// A refresh or a lost POST response can still find the original job.
		sessionStorage.setItem(lastRequest, id);
		let refused = false;
		const initialMaterials = materials.map(m => ({
			kind: m.kind,
			title: m.title,
			url: m.url,
			...(m.part ? { part: m.part } : {}),
			...(m.regionHint ? { regionHint: m.regionHint } : {}),
		}));
		try {
			const response = await fetch(endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					topic,
					model,
					pace,
					requestId: id,
					...(initialMaterials.length ? { initialMaterials } : {}),
				}),
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
				<h1 className="cel-display text-3xl leading-tight">{t("pages.creator.title")}</h1>
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
						<span className="text-sm font-semibold">{t("pages.creator.goalLabel")}</span>
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

					<div className="space-y-2">
						<span className="block text-sm font-semibold">{t("pages.creator.modelLabel")}</span>
						<div ref={modelAnchorRef} className="relative">
							<button
								type="button"
								data-testid="creator-model-trigger"
								aria-expanded={modelMenuOpen}
								aria-haspopup="listbox"
								disabled={working || busy}
								onClick={() => {
									const next = !modelMenuOpen;
									setModelMenuOpen(next);
									if (next) refresh();
								}}
								className="cel-input flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:border-foreground/40 disabled:cursor-not-allowed disabled:opacity-60"
							>
								{selectedEntry && selectedVendor ? (
									<span className="flex min-w-0 flex-1 items-center gap-2.5">
										<span
											className="size-2 shrink-0 rounded-full"
											style={{ backgroundColor: selectedVendor.accent }}
											aria-hidden
										/>
										<span className="min-w-0 flex-1">
											<span className="block truncate font-medium text-foreground">
												{cleanModelDisplayName(selectedEntry, selectedVendor)}
											</span>
											<span className="block truncate text-xs text-muted-foreground">
												{selectedVendor.id === "other" ? t("settings.models.otherVendor") : selectedVendor.label}
												{" · "}
												{subscriptionLabel(`${selectedEntry.provider}:${selectedEntry.id}`) ?? selectedEntry.provider}
												{selectedEntry.contextWindow !== null ? ` · ${formatTokens(selectedEntry.contextWindow)}` : ""}
											</span>
										</span>
									</span>
								) : (
									<span className="min-w-0 flex-1 truncate text-muted-foreground">
										{modelUnavailable
											? `${model?.provider}:${model?.id}`
											: t("pages.creator.chooseModel")}
									</span>
								)}
								<Icon
									name="chevron-down"
									size={16}
									tone={false}
									className={`shrink-0 text-muted-foreground transition-transform ${modelMenuOpen ? "rotate-180" : ""}`}
								/>
							</button>
							{modelUnavailable && (
								<p className="mt-1.5 text-xs text-destructive">
									{t("settings.models.unavailableHint")}
								</p>
							)}
							{modelMenuOpen && !working && !busy && (
								<MenuShell
									anchorRef={modelAnchorRef}
									testid="creator-model-menu"
									preferredSide="down"
									align="left"
									onClose={() => { setModelMenuOpen(false); return "closed"; }}
									menuClass="flex w-[min(32rem,calc(100vw-2.5rem))] flex-col rounded-xl border border-border bg-card p-2 text-xs shadow-xl"
								>
									<ModelMenuList
										models={catalog?.models}
										effectiveId={selectedEntry?.id}
										effectiveProvider={selectedEntry?.provider}
										onPick={(entry) => {
											setChosen({ provider: entry.provider, id: entry.id });
											setModelMenuOpen(false);
											setError("");
										}}
										footer={
											catalog && catalog.models.length === 0
												? "No models — add a provider key in Providers"
												: undefined
										}
									/>
								</MenuShell>
							)}
						</div>
					</div>

					<details className="study-disclosure text-sm">
						<summary>Incluir seus próprios livros, PDFs ou vídeos iniciais{materials.length ? ` (${materials.length})` : " (opcional)"}</summary>
						<div className="study-disclosure-body space-y-3 pt-2">
							<p className="text-xs leading-relaxed text-muted-foreground">
								Cole links de aulas no YouTube, capítulos de livros ou PDFs. Ao montar a árvore, o sistema interliga cada fonte às regiões e habilidades compatíveis — e depois você também pode vincular PDFs locais e seções diretamente em cada nó no mapa.
							</p>
							<div className="grid gap-2 sm:grid-cols-2">
								<label className="space-y-1 text-xs font-semibold">
									Tipo
									<select className="cel-input block w-full px-2.5 py-1.5 text-sm font-normal" value={draftKind} disabled={working || busy} onChange={e => setDraftKind(e.target.value === "book" ? "book" : "video")}>
										<option value="video">Vídeo / aula (YouTube ou link)</option>
										<option value="book">Livro / PDF / apostila (link)</option>
									</select>
								</label>
								<label className="space-y-1 text-xs font-semibold">
									Título da obra ou aula
									<input type="text" className="cel-input block w-full px-2.5 py-1.5 text-sm font-normal" value={draftTitle} disabled={working || busy} onChange={e => setDraftTitle(e.target.value)} placeholder="Ex.: Curso de Astronomia · Aula 3" />
								</label>
								<label className="space-y-1 text-xs font-semibold sm:col-span-2">
									Link HTTPS
									<input type="url" className="cel-input block w-full px-2.5 py-1.5 text-sm font-normal" value={draftUrl} disabled={working || busy} onChange={e => setDraftUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=... ou https://.../capitulo.pdf" />
								</label>
								<label className="space-y-1 text-xs font-semibold">
									Seção / capítulo / minutagem (opcional)
									<input type="text" className="cel-input block w-full px-2.5 py-1.5 text-sm font-normal" value={draftPart} disabled={working || busy} onChange={e => setDraftPart(e.target.value)} placeholder="Ex.: Cap. 2 · p. 30–48 ou 05:20" />
								</label>
								<label className="space-y-1 text-xs font-semibold">
									Para qual assunto/região? (opcional)
									<input type="text" className="cel-input block w-full px-2.5 py-1.5 text-sm font-normal" value={draftHint} disabled={working || busy} onChange={e => setDraftHint(e.target.value)} placeholder="Ex.: telescópios, espectroscopia" />
								</label>
							</div>
							{draftError && <p role="alert" className="text-xs text-destructive">{draftError}</p>}
							<button type="button" className="cel-button min-h-8 px-3 py-1 text-xs" disabled={working || busy} onClick={addMaterial}>
								<Icon name="plus" size={14} tone={false} />
								Adicionar à lista inicial
							</button>
							{materials.length > 0 && (
								<ul className="space-y-1.5 pt-1">
									{materials.map((item, idx) => (
										<li key={item.url + idx} className="flex items-center justify-between gap-2 rounded-lg border border-border/55 bg-background/60 px-2.5 py-1.5 text-xs">
											<span className="min-w-0 truncate">
												<strong>{item.kind === "video" ? "Vídeo" : "Leitura"}:</strong> {item.title}
												{item.part ? ` · ${item.part}` : ""}
												{item.regionHint ? ` (${item.regionHint})` : ""}
											</span>
											<button type="button" className="shrink-0 font-semibold text-muted-foreground underline hover:text-foreground" onClick={() => setMaterials(prev => prev.filter((_, i) => i !== idx))}>
												Remover
											</button>
										</li>
									))}
								</ul>
							)}
						</div>
					</details>

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
								<span>{status.state === "materials" ? t("pages.creator.findingMaterials") : t("pages.creator.organizingTree")}</span>
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
