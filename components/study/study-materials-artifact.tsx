import { studyAttachmentsSchema, type ArtifactPartProps } from "@/src/core";

const label = { book: "Livro completo", reading: "Leitura", video: "Vídeo" };

export function StudyMaterialsArtifact({ part }: ArtifactPartProps) {
	if (part.state === "output-error") return <p role="status">A busca de materiais falhou.</p>;
	if (part.state !== "output-available") return <p role="status">Buscando materiais para esta tarefa…</p>;
	const result = studyAttachmentsSchema.safeParse(part.output);
	if (!result.success || !result.data.items.length) return <p role="status">Nenhum material correspondente foi encontrado.</p>;
	return <section aria-label="Materiais para esta tarefa" className="cel-card my-3 max-w-prose space-y-3 p-4">
		<h3 className="cel-display">Materiais para esta tarefa</h3>
		{result.data.items.map(item => <div key={item.kind + item.url}>
			<a href={item.url} target="_blank" rel="noreferrer" className="font-semibold underline">{label[item.kind]} · {item.title}</a>
			<p className="text-sm">{item.suggested && "Sugestão · "}{item.sectionUrl && item.sectionUrl !== item.url
				? <a href={item.sectionUrl} target="_blank" rel="noreferrer" className="underline">{item.part}</a> : item.part}</p>
		</div>)}
	</section>;
}
