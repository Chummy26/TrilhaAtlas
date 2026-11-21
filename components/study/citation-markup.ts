import type { Element, ElementContent, Root } from "hast";
import type { PdfCitationBook } from "@/src/core";

const pagePattern = /\b(?:p[áa]ginas?|p[áa]gs?\.|pp?\.|pages?)\s*(?:f[íi]sicas?\s*)?(\d+)(?:\s*[-–—]\s*\d+)?/giu;
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function plain(node: ElementContent): string {
	return node.type === "text" ? node.value : node.type === "element" ? node.children.map(plain).join("") : "";
}

function button(book: PdfCitationBook, page: number, label: string): Element {
	return { type: "element", tagName: "button", properties: { type: "button", dataPdfBook: book.book, dataPdfPage: page,
		className: ["pdf-citation"], ariaHasPopup: "dialog", ariaLabel: book.title + ", página " + page }, children: [{ type: "text", value: label }] };
}

/** Run after Markdown sanitization. Buttons only reference a PDF from the session shelf. */
export function linkPdfCitations(books: readonly PdfCitationBook[]) {
	const booksById = new Map<string, PdfCitationBook>(books.map((book) => [book.book, book]));
	const foldedBooks = books.map((book) => ({
		book,
		aliases: [book.title, book.fileTitle].filter(Boolean).map(fold),
	}));
	return (root: Root) => {
		function paragraph(el: Element) {
			const paragraphText = fold(plain(el));
			let presentBooks: typeof foldedBooks | null = null;
			let preceding = "";
			function visit(node: Element) {
				const children: ElementContent[] = [];
				for (const child of node.children) {
					if (child.type === "element") {
						const link = child.tagName === "a" && /^#livro-([a-f0-9]{64})-(\d+)$/u.exec(String(child.properties.href));
						const book = link ? booksById.get(link[1]!) : undefined;
						const page = link ? Number(link[2]) : 0;
						if (book && page >= 1 && page <= book.pages) children.push(button(book, page, plain(child)));
						else {
							if (!["a", "code", "pre", "math", "svg", "button"].includes(child.tagName)) visit(child);
							else preceding += plain(child);
							children.push(child);
						}
					} else if (child.type === "text") {
						let end = 0;
						for (const match of child.value.matchAll(pagePattern)) {
							const page = Number(match[1]);
							if (/[-–—]/u.test(match[0])) continue;
							if (presentBooks === null) {
								presentBooks = foldedBooks.filter(({ aliases }) => aliases.some((a) => paragraphText.includes(a)));
							}
							const before = fold(preceding + child.value.slice(0, match.index));
							const named = presentBooks
								.map(({ book, aliases }) => ({ book, last: Math.max(...aliases.map((a) => before.lastIndexOf(a))) }))
								.sort((a, b) => b.last - a.last);
							const source = named.length === 1 || (named.length > 1 && named[0]!.last > named[1]!.last) ? named[0]!.book : books.length === 1 ? books[0] : undefined;
							if (!source || page < 1 || page > source.pages) continue;
							children.push({ type: "text", value: child.value.slice(end, match.index) }, button(source, page, match[0]));
							end = match.index + match[0].length;
						}
						children.push({ type: "text", value: child.value.slice(end) });
						preceding += child.value;
					} else children.push(child);
				}
				node.children = children;
			}
			visit(el);
		}
		function walk(node: Root | Element) {
			for (const c of node.children) if (c.type === "element") {
				if (["p", "li", "td", "h3", "h4"].includes(c.tagName)) paragraph(c);
				else if (!["pre", "code", "a"].includes(c.tagName)) walk(c);
			}
		}
		walk(root);
	};
}
