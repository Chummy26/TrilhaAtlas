import { Icon } from "@/components/icons/icon";
import { parseStudyAttachments, type ArtifactPartProps } from "@/src/core";

const label = { book: "Livro completo", reading: "Leitura", video: "Vídeo" };

export function StudyMaterialsArtifact({ part }: ArtifactPartProps) {
	if (part.state === "output-error") return <p role="status" className="text-sm text-destructive">A busca de materiais falhou.</p>;
	if (part.state !== "output-available") return <p role="status" className="text-sm text-muted-foreground">Buscando materiais para esta tarefa…</p>;
	const data = parseStudyAttachments(part.output);
	if (!data || !data.items.length) return <p role="status" className="text-sm text-muted-foreground">Nenhum material correspondente foi encontrado.</p>;
	return <section aria-label="Materiais para esta tarefa" className="cel-card my-3 max-w-prose space-y-2.5 p-4">
		<div className="flex items-center gap-2 border-b border-border/50 pb-2">
			<Icon name="book" size={17} />
			<h3 className="cel-display text-base">Materiais para esta tarefa</h3>
		</div>
		<div className="space-y-2">
			{data.items.map(item => (
				<div key={item.kind + item.url} className="flex items-start gap-2.5 rounded-lg p-1.5 transition-colors hover:bg-accent/60">
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
				</div>
			))}
		</div>
	</section>;
}
