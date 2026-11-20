import assert from "node:assert/strict";
import { it } from "node:test";
import type { Root } from "hast";
import { linkPdfCitations } from "../components/study/citation-markup.ts";

it("links named physical pages across emphasis, leaving ambiguous, ranged and out-of-bounds citations alone", () => {
	const books = ["Atlas Jacaranda", "Carta Horizonte"].map((title, i) => ({ book: String(i + 1).repeat(64), region: "r", title, fileTitle: title, pages: 2 }));
	const root: Root = { type: "root", children: [{ type: "element", tagName: "p", properties: {}, children: [
		{ type: "element", tagName: "em", properties: {}, children: [{ type: "text", value: "Carta Horizonte" }] },
		{ type: "text", value: ", página física 2, página 9 e páginas 1–2." },
	] }, { type: "element", tagName: "p", properties: {}, children: [{ type: "text", value: "página 1" }] }] };
	linkPdfCitations(books)(root);
	const text = JSON.stringify(root);
	assert.equal(text.match(/"tagName":"button"/g)?.length, 1);
	assert.ok(text.includes(books[1]!.book));
});
