import { AudioLines, BookOpen, Ear, Eye, Flag, Gauge, GitCompareArrows, GitMerge, ListOrdered, NotebookPen, Route, Speech } from "lucide-react";

const illustrations = { listen: Ear, say: Speech, write: NotebookPen, order: ListOrdered, observe: Eye, measure: Gauge, compare: GitCompareArrows };
export function lessonDrawing(title: string, incoming: number, outgoing: boolean, illustration?: keyof typeof illustrations) {
	if (illustration) return illustrations[illustration];
	const subject = title.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
	if (/ouvir|escut|reconhecer o pedido|listen/.test(subject)) return Ear;
	if (/anotar|escrev|escrit|write/.test(subject)) return NotebookPen;
	if (/ordem|ordenar|order/.test(subject)) return ListOrdered;
	if (/dizer|falar|pronunc|speak/.test(subject)) return Speech;
	if (/medir|measur/.test(subject)) return Gauge;
	if (/compar/.test(subject)) return GitCompareArrows;
	if (/som|audio/.test(subject)) return AudioLines;
	return !outgoing ? Flag : incoming > 1 ? GitMerge : incoming ? Route : BookOpen;
}
