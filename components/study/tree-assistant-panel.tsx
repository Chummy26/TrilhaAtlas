"use client";

import { useRef, useState } from "react";
import { SparklesIcon } from "lucide-react";
import { Icon } from "@/components/icons/icon";
import { useT } from "@/components/i18n";

interface AppliedAction {
	type: string;
	label: string;
	ok: boolean;
	detail?: string;
}

interface ChatTurn {
	id: string;
	role: "user" | "assistant";
	text: string;
	applied?: AppliedAction[];
	error?: boolean;
}

export function TreeAssistantPanel({
	domain,
	selectedNodeId,
	selectedNodeTitle,
	onClose,
	onMapUpdated,
	onMaterialsUpdated,
	onFocusNode,
}: {
	domain: string;
	selectedNodeId: string;
	selectedNodeTitle: string;
	onClose: () => void;
	onMapUpdated: () => void;
	onMaterialsUpdated: () => void;
	onFocusNode: (nodeId: string) => void;
}) {
	const t = useT();
	const [turns, setTurns] = useState<ChatTurn[]>([]);
	const [input, setInput] = useState("");
	const [busy, setBusy] = useState(false);
	const listRef = useRef<HTMLDivElement>(null);

	async function sendPrompt(rawText: string) {
		const text = rawText.trim();
		if (text.length < 2 || busy) return;
		const userTurn: ChatTurn = { id: `u-${Date.now()}`, role: "user", text };
		const nextTurns = [...turns, userTurn];
		setTurns(nextTurns);
		setInput("");
		setBusy(true);
		queueMicrotask(() => {
			listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
		});

		try {
			const res = await fetch("/api/study/tree-assistant", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					domain,
					selectedNodeId,
					prompt: text,
					history: turns.slice(-8).map((item) => ({ role: item.role, text: item.text })),
				}),
			});
			const data = (await res.json().catch(() => ({}))) as {
				reply?: string;
				applied?: AppliedAction[];
				refreshedMap?: boolean;
				refreshedMaterials?: boolean;
				focusNodeId?: string;
				error?: string;
			};
			if (!res.ok) {
				throw new Error(data.error ?? "Não foi possível processar seu pedido.");
			}
			setTurns((prev) => [
				...prev,
				{
					id: `a-${Date.now()}`,
					role: "assistant",
					text: data.reply ?? "Pronto!",
					applied: data.applied,
				},
			]);
			if (data.refreshedMap) onMapUpdated();
			if (data.refreshedMaterials) onMaterialsUpdated();
			if (data.focusNodeId) onFocusNode(data.focusNodeId);
		} catch (err) {
			setTurns((prev) => [
				...prev,
				{
					id: `e-${Date.now()}`,
					role: "assistant",
					text: err instanceof Error ? err.message : "Erro ao processar o pedido.",
					error: true,
				},
			]);
		} finally {
			setBusy(false);
			queueMicrotask(() => {
				listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
			});
		}
	}

	return (
		<section
			aria-label={t("map.tree.assistantTitle")}
			className="cel-card mb-4 border-border/80 bg-card/95 p-4 shadow-sm"
		>
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div className="min-w-0 space-y-0.5">
					<div className="flex items-center gap-2">
						<SparklesIcon aria-hidden="true" className="size-4 shrink-0 text-[var(--cel-accent,var(--primary))]" />
						<h2 className="text-sm font-bold text-foreground">{t("map.tree.assistantTitle")}</h2>
						<span className="max-w-64 truncate rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
							{t("map.tree.assistantContext", { node: selectedNodeTitle })}
						</span>
					</div>
					<p className="text-xs text-muted-foreground">{t("map.tree.assistantSubtitle")}</p>
				</div>
				<div className="flex items-center gap-1.5">
					{turns.length > 0 && (
						<button
							type="button"
							disabled={busy}
							onClick={() => setTurns([])}
							className="rounded-lg px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
						>
							{t("map.tree.assistantClear")}
						</button>
					)}
					<button
						type="button"
						aria-label={t("map.tree.enrichDismiss")}
						onClick={onClose}
						className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
					>
						<Icon name="close" size={14} tone={false} />
					</button>
				</div>
			</div>

			{turns.length === 0 ? (
				<div className="mt-3 flex flex-wrap gap-1.5">
					<button
						type="button"
						disabled={busy}
						onClick={() =>
							void sendPrompt(
								`Melhore o nó selecionado ("${selectedNodeTitle}") com objetivo mais observável, atividade prática concreta e critério claro de verificação.`,
							)
						}
						className="cel-chip cursor-pointer py-1 text-xs hover:bg-accent"
					>
						{t("map.tree.assistantQuickImprove")}
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() =>
							void sendPrompt(
								`Adicione uma nova habilidade prática complementar na região do nó "${selectedNodeTitle}" com exercício aplicado e critério verificável.`,
							)
						}
						className="cel-chip cursor-pointer py-1 text-xs hover:bg-accent"
					>
						{t("map.tree.assistantQuickAddSkill")}
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => void sendPrompt(`Enriqueça o acervo de livros e vídeos da região do nó "${selectedNodeTitle}".`)}
						className="cel-chip cursor-pointer py-1 text-xs hover:bg-accent"
					>
						{t("map.tree.assistantQuickEnrich")}
					</button>
				</div>
			) : (
				<div ref={listRef} className="mt-3 max-h-60 space-y-2.5 overflow-y-auto rounded-xl border border-border/55 bg-background/60 p-3">
					{turns.map((turn) => (
						<div key={turn.id} className={turn.role === "user" ? "flex justify-end" : "space-y-1.5"}>
							<div
								className={
									turn.role === "user"
										? "max-w-[85%] rounded-xl bg-[var(--cel-accent,var(--primary))] px-3 py-1.5 text-xs font-medium text-[var(--cel-on-fill,#07070b)]"
										: turn.error
											? "rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
											: "rounded-xl border border-border/60 bg-card px-3 py-2 text-xs leading-relaxed text-foreground"
								}
							>
								<p className="whitespace-pre-wrap">{turn.text}</p>
								{turn.applied && turn.applied.length > 0 && (
									<ul className="mt-2 flex flex-wrap gap-1.5 border-t border-border/50 pt-2">
										{turn.applied.map((act, idx) => (
											<li
												key={idx}
												className={
													"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold " +
													(act.ok
														? "bg-[var(--cel-success,var(--lh-success))]/15 text-[var(--cel-success-text,var(--lh-success))]"
														: "bg-destructive/15 text-destructive")
												}
											>
												<span>{act.ok ? "✓" : "✕"}</span>
												<span>{act.label}</span>
												{act.detail && <span className="font-normal opacity-85">· {act.detail}</span>}
											</li>
										))}
									</ul>
								)}
							</div>
						</div>
					))}
					{busy && (
						<div className="flex items-center gap-2 text-xs text-muted-foreground">
							<span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-[var(--c-teal,#2ec4b6)]" />
							<span>{t("map.tree.assistantSending")}</span>
						</div>
					)}
				</div>
			)}

			<form
				className="mt-3 flex items-end gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					void sendPrompt(input);
				}}
			>
				<textarea
					rows={2}
					value={input}
					disabled={busy}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							void sendPrompt(input);
						}
					}}
					placeholder={t("map.tree.assistantPlaceholder")}
					className="cel-input block min-h-10 flex-1 resize-y px-3 py-2 text-xs leading-relaxed"
				/>
				<button
					type="submit"
					disabled={busy || input.trim().length < 2}
					className="cel-button cel-button-primary min-h-10 shrink-0 px-4 py-2 text-xs"
				>
					{busy ? t("map.tree.assistantSending") : t("map.tree.assistantSend")}
				</button>
			</form>
		</section>
	);
}
