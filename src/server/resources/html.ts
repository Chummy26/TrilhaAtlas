/**
 * HTML → Markdown and ordered link extraction for open HTML books (OpenStax
 * archive `content`, Wikibooks `action=parse`, Kuphaldt LIEC chapters, EPUB
 * XHTML) — SÍNTESE §2.8 "Ingestão em camadas" (T1 HTML: linkedom +
 * turndown, both already dependencies); r6 §10.1 "Preferir HTML estruturado
 * a PDF quando a fonte aberta oferece os dois".
 *
 * Scripts, styles, navigation chrome, forms and media players are removed
 * before conversion: the text is DATA for the lesson (never instructions) and
 * must not carry executable markup. MathML is reduced to its text (the
 * tutor rewrites formulas in its own notation).
 */

import { DOMParser as LinkedomDOMParser, parseHTML } from "linkedom";
import TurndownService from "turndown";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
turndown.remove(["script", "style", "noscript", "iframe", "object", "embed", "form", "button", "nav", "footer", "header", "aside", "audio", "video", "canvas", "svg"] as never);

const STRIP_SELECTORS = ["script", "style", "noscript", "nav", "footer", ".mw-editsection", ".navbox", ".noprint", "#toc", ".toc", "[role=navigation]"];

/** Body HTML → Markdown (empty string for empty input). */
export function htmlToMarkdown(html: string): string {
	if (!html.trim()) return "";
	const wrapped = /<html[\s>]/i.test(html) ? html : `<!doctype html><html><body>${html}</body></html>`;
	const { document } = parseHTML(wrapped);
	for (const sel of STRIP_SELECTORS) for (const el of [...document.querySelectorAll(sel)]) el.remove();
	for (const math of [...document.querySelectorAll("math")]) {
		const text = document.createTextNode(` ${math.textContent?.replace(/\s+/g, " ").trim() ?? ""} `);
		math.replaceWith(text);
	}
	const body = document.body ?? document.documentElement;
	const markdown = turndown.turndown(body as unknown as HTMLElement);
	return markdown.replace(/\n{3,}/g, "\n\n").trim();
}

/** Visible text of an HTML fragment (titles, link texts). */
export function htmlText(html: string): string {
	const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
	return (document.body?.textContent ?? "").replace(/\s+/g, " ").trim();
}

export interface HtmlLink {
	href: string;
	text: string;
}

/** `<a href>` in document order, resolved against `baseUrl` (fragments kept). */
export function extractLinks(html: string, baseUrl: string): HtmlLink[] {
	const { document } = parseHTML(/<html[\s>]/i.test(html) ? html : `<!doctype html><html><body>${html}</body></html>`);
	const out: HtmlLink[] = [];
	for (const a of [...document.querySelectorAll("a[href]")]) {
		const raw = a.getAttribute("href") ?? "";
		if (!raw || raw.startsWith("javascript:") || raw.startsWith("mailto:")) continue;
		let href: string;
		try {
			href = new URL(raw, baseUrl).toString();
		} catch {
			continue;
		}
		out.push({ href, text: (a.textContent ?? "").replace(/\s+/g, " ").trim() });
	}
	return out;
}

/** Parse XML (OPF, NCX, container.xml, Atom) with linkedom. */
export function parseXml(xml: string): Document {
	return new LinkedomDOMParser().parseFromString(xml, "text/xml") as unknown as Document;
}

/** Child elements by local name (namespace prefixes ignored: "dc:title" → "title"). */
export function elementsByLocalName(root: ParentNode, name: string): Element[] {
	const want = name.toLowerCase();
	const out: Element[] = [];
	const walk = (node: ParentNode) => {
		for (const child of Array.from(node.children ?? [])) {
			const local = (child.localName ?? child.tagName ?? "").toLowerCase().replace(/^.*:/, "");
			if (local === want) out.push(child);
			walk(child);
		}
	};
	walk(root);
	return out;
}

/** First descendant by local name, or undefined. */
export function firstByLocalName(root: ParentNode, name: string): Element | undefined {
	return elementsByLocalName(root, name)[0];
}

/** Direct children by local name. */
export function childrenByLocalName(el: Element, name: string): Element[] {
	const want = name.toLowerCase();
	return Array.from(el.children).filter((c) => (c.localName ?? c.tagName ?? "").toLowerCase().replace(/^.*:/, "") === want);
}
