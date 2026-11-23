"use client";

import { useState } from "react";
import { useT } from "@/components/i18n";
import { Icon } from "@/components/icons/icon";
import { parseStudyAttachments, type ArtifactPartProps, type StudyAttachmentItem } from "@/src/core";

const label = { book: "Livro completo", reading: "Leitura", video: "Vídeo" };

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function StudyMaterialsArtifact({ part }: ArtifactPartProps) {
	const t = useT();
	const [statusByKey, setStatusByKey] = useState<Record<string, SaveStatus>>({});

	if (part.state === "output-error") return <p role="status" className="text-sm text-destructive">A busca de materiais falhou.</p>;
	if (part.state !== "output-available") return <p role="status" className="text-sm text-muted-foreground">Buscando materiais para esta tarefa…</p>;
	const data = parseStudyAttachments(part.output);
	if (!data || !data.items.length) return <p role="status" className="text-sm text-muted-foreground">Nenhum material correspondente foi encontrado.</p>;

	async function saveMaterial(item: StudyAttachmentItem, itemKey: string) {
		if (statusByKey[itemKey] === "saving") return;
		setStatusByKey((prev) => ({ ...prev, [itemKey]: "saving" }));
		const excerpt = item.part ? `${item.title} — ${item.part}` : item.title;
		try {
			const res = await fetch("/api/study/notebook", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					action: "save-note",
					source: item.kind === "video" ? "video" : "pdf",
					excerpt,
					sourceTitle: item.title,
					sourceUrl: item.sectionUrl || item.url,
					...(item.part ? { locator: item.part } : {}),
				}),
			});
			setStatusByKey((prev) => ({ ...prev, [itemKey]: res.ok ? "saved" : "error" }));
		} catch {
			setStatusByKey((prev) => ({ ...prev, [itemKey]: "error" }));
		}
	}

	return <section aria-label="Materiais para esta tarefa" className="cel-card my-3 max-w-prose space-y-2.5 p-4">
		<div className="flex items-center gap-2 border-b border-border/50 pb-2">
			<Icon name="book" size={17} />
			<h3 className="cel-display text-base">Materiais para esta tarefa</h3>
		</div>
		<div className="space-y-2">
			{data.items.map((item) => {
				const itemKey = `${item.kind}:${item.url}:${item.part}`;
				const status = statusByKey[itemKey] ?? "idle";
				return (
					<div key={itemKey} className="flex items-start gap-2.5 rounded-lg p-1.5 transition-colors hover:bg-accent/60">
						<Icon name={item.kind === "video" ? "video" : "book"} size={17} />
						<div className="min-w-0 flex-1">
							<a href={item.url} target="_blank" rel="noreferrer" className="text-sm font-semibold underline decoration-border underline-offset-2 hover:decoration-foreground">
								{label[item.kind]} · {item.title}
							</a>
							<p className="mt-0.5 text-xs text-muted-foreground">
								{item.suggested && <span className="mr-1 font-semibold">Sugestão ·</span>}
								{item.sectionUrl && item.sectionUrl !== item.url
									? <a href={item.sectionUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">{item.part}</a>
									: item.part}
							</p>
						</div>
						<button
							type="button"
							data-testid={`save-material-${item.kind}`}
							aria-label={t("lesson.notebook.saveMaterial")}
							disabled={status === "saving"}
							onClick={() => void saveMaterial(item, itemKey)}
							className="cel-button cel-button-ghost min-h-7 shrink-0 px-2 py-0.5 text-xs"
						>
							<Icon name={status === "saved" ? "check" : "pin"} size={13} tone={false} />
							<span>
								{status === "saving"
									? t("lesson.notebook.saving")
									: status === "saved"
										? t("lesson.notebook.savedBadge")
										: status === "error"
											? t("lesson.notebook.saveError")
											: t("lesson.notebook.saveMaterial")}
							</span>
						</button>
					</div>
				);
			})}
		</div>
	</section>;
}
