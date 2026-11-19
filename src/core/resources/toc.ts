/**
 * Table-of-contents trees → flat `TocEntry[]` with physical page ranges
 * (SÍNTESE §2.8 "Sumário em cascata", "Ingestão em camadas T0"; r6 §10.2;
 * extra-unjs__unpdf §5.2–5.5).
 *
 * Input is a tree of raw entries whatever the source (PDF outline after the
 * server resolved destinations to pages, EPUB nav/NCX, OpenStax `tree`,
 * Open Library `table_of_contents`, Crossref chapters). Output is the flat
 * pre-order list used everywhere else, with ids "1", "1.2", "1.2.3".
 *
 * Page-range rule (unpdf §5.2, made order-robust):
 *   start(c)  = its own page, or — for a container without a destination
 *               ("Parte I") — the first resolved page among its descendants;
 *   end(c)    = min over every OTHER entry s with depth(s) ≤ depth(c) and
 *               start(s) > start(c) of  start(s) − 1  (or start(s) when s
 *               starts mid-page: the page is shared), else the last page;
 *   then each child range is clamped into its parent's range.
 * Using every entry (not just the next one in pre-order) keeps the invariants
 * even when an outline lists sections out of page order:
 *   I1 pageFrom ≤ pageTo;  I2 child ⊆ parent;
 *   I3 siblings with different starts overlap in at most one (shared) page.
 * Entries whose page cannot be resolved keep no range.
 *
 * Fallback without any structure: fixed page windows (`pageWindowToc`,
 * provenance "page-window" — unpdf §5.5 step 5).
 *
 * Pure: browser-safe.
 */

import type { TocEntry } from "./types.ts";

export interface RawTocNode {
	title: string;
	/** 1-based physical page; null/undefined = unresolved. */
	page?: number | null;
	/** The destination starts below the top of the page (shared page). */
	startsMidPage?: boolean;
	/** Address inside the source (EPUB href, page uuid, URL). */
	href?: string;
	/** Printed label of the page (from /PageLabels or the source). */
	pageLabel?: string;
	children?: RawTocNode[];
}

const CONTROL_OR_PUA = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ue000-\uf8ff]/g; // escapes, not literal PUA characters (invisible, easy to lose in an edit)

/** NFC, HTML tags and entities stripped, control/private-use chars removed, spaces collapsed. */
export function normalizeTocTitle(raw: string): string {
	return raw
		.replace(/<[^>]*>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'")
		.normalize("NFC")
		.replace(CONTROL_OR_PUA, "")
		.replace(/\s+/g, " ")
		.trim();
}

interface Work {
	entry: TocEntry;
	page: number | null;
	mid: boolean;
}

function validPage(page: number | null | undefined, numPages: number | undefined): number | null {
	if (page === null || page === undefined || !Number.isInteger(page) || page < 1) return null;
	if (numPages !== undefined && page > numPages) return null;
	return page;
}

/** Flatten a raw tree (pre-order) and compute page ranges. `numPages` bounds the last range. */
export function buildToc(nodes: readonly RawTocNode[], numPages?: number): TocEntry[] {
	const work: Work[] = [];
	const walk = (list: readonly RawTocNode[], depth: number, parentId: string | null, prefix: string): number | null => {
		let firstPage: number | null = null;
		list.forEach((node, i) => {
			const id = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
			const entry: TocEntry = { id, title: normalizeTocTitle(node.title) || `(sem título ${id})`, depth, parentId, order: work.length };
			if (node.href) entry.href = node.href;
			if (node.pageLabel) entry.pageLabel = node.pageLabel;
			const item: Work = { entry, page: validPage(node.page, numPages), mid: Boolean(node.startsMidPage) };
			work.push(item);
			const childFirst = walk(node.children ?? [], depth + 1, id, id);
			if (item.page === null && childFirst !== null) item.page = childFirst;
			if (firstPage === null && item.page !== null) firstPage = item.page;
		});
		return firstPage;
	};
	walk(nodes, 0, null, "");

	const resolved = work.filter((w) => w.page !== null);
	const lastPage = numPages ?? Math.max(0, ...resolved.map((w) => w.page!));
	const ends = new Map<string, number>();
	for (const c of resolved) {
		let end = lastPage;
		for (const s of resolved) {
			if (s === c || s.entry.depth > c.entry.depth || s.page! <= c.page!) continue;
			end = Math.min(end, s.mid ? s.page! : s.page! - 1);
		}
		ends.set(c.entry.id, Math.max(c.page!, end));
	}
	// Clamp into the parent's range (parents come first in pre-order).
	const byId = new Map(work.map((w) => [w.entry.id, w]));
	for (const w of work) {
		if (w.page === null) continue;
		let from = w.page;
		let to = ends.get(w.entry.id)!;
		const parent = w.entry.parentId ? byId.get(w.entry.parentId) : undefined;
		if (parent && parent.entry.pageFrom !== undefined && parent.entry.pageTo !== undefined) {
			from = Math.min(Math.max(from, parent.entry.pageFrom), parent.entry.pageTo);
			to = Math.min(Math.max(to, from), parent.entry.pageTo);
		}
		w.entry.pageFrom = from;
		w.entry.pageTo = Math.max(from, to);
	}
	return work.map((w) => w.entry);
}

/** Fixed windows of `size` pages when no structure exists. */
export function pageWindowToc(numPages: number, size = 10): TocEntry[] {
	if (!Number.isInteger(numPages) || numPages < 1) return [];
	const step = Math.max(1, Math.floor(size));
	const out: TocEntry[] = [];
	for (let from = 1, i = 1; from <= numPages; from += step, i++) {
		const to = Math.min(numPages, from + step - 1);
		out.push({ id: `${i}`, title: `Páginas ${from}–${to}`, depth: 0, parentId: null, order: i - 1, pageFrom: from, pageTo: to });
	}
	return out;
}

/** Titles from the root down to `id` (inclusive). */
export function tocBreadcrumb(entries: readonly TocEntry[], id: string): string[] {
	const byId = new Map(entries.map((e) => [e.id, e]));
	const out: string[] = [];
	let cur = byId.get(id);
	const seen = new Set<string>();
	while (cur && !seen.has(cur.id)) {
		seen.add(cur.id);
		out.unshift(cur.title);
		cur = cur.parentId ? byId.get(cur.parentId) : undefined;
	}
	return out;
}

/** Entries without children (the reading units). */
export function tocLeaves(entries: readonly TocEntry[]): TocEntry[] {
	const parents = new Set(entries.map((e) => e.parentId).filter((p): p is string => p !== null));
	return entries.filter((e) => !parents.has(e.id));
}

/**
 * Units to chunk: leaves, except that entries deeper than `maxDepth` are
 * folded into their ancestor at `maxDepth` (engineering books have 3–4
 * levels; sections at depth ≤ 1–2 are the linking unit — unpdf §5.3).
 */
export function tocUnits(entries: readonly TocEntry[], maxDepth = 2): TocEntry[] {
	const parents = new Set(entries.map((e) => e.parentId).filter((p): p is string => p !== null));
	return entries.filter((e) => e.depth <= maxDepth && (e.depth === maxDepth || !parents.has(e.id)));
}

/** Invariant check (I1–I3 + structure); returns pt-BR issues, empty when valid. */
export function validateToc(entries: readonly TocEntry[], numPages?: number): string[] {
	const issues: string[] = [];
	const byId = new Map(entries.map((e) => [e.id, e]));
	entries.forEach((e, i) => {
		if (e.order !== i) issues.push(`Entrada ${e.id}: ordem ${e.order} ≠ posição ${i}.`);
		if (e.parentId !== null && !byId.has(e.parentId)) issues.push(`Entrada ${e.id}: pai ${e.parentId} inexistente.`);
		const hasFrom = e.pageFrom !== undefined;
		if (hasFrom !== (e.pageTo !== undefined)) issues.push(`Entrada ${e.id}: intervalo de páginas incompleto.`);
		if (e.pageFrom !== undefined && e.pageTo !== undefined) {
			if (e.pageFrom > e.pageTo) issues.push(`Entrada ${e.id}: início ${e.pageFrom} > fim ${e.pageTo}.`);
			if (e.pageFrom < 1 || (numPages !== undefined && e.pageTo > numPages)) issues.push(`Entrada ${e.id}: páginas fora do documento.`);
			const p = e.parentId ? byId.get(e.parentId) : undefined;
			if (p?.pageFrom !== undefined && p.pageTo !== undefined && (e.pageFrom < p.pageFrom || e.pageTo > p.pageTo)) {
				issues.push(`Entrada ${e.id}: fora do intervalo do pai ${p.id}.`);
			}
		}
	});
	const siblings = new Map<string, TocEntry[]>();
	for (const e of entries) {
		if (e.pageFrom === undefined) continue;
		const key = e.parentId ?? "";
		siblings.set(key, [...(siblings.get(key) ?? []), e]);
	}
	for (const group of siblings.values()) {
		for (const a of group) {
			for (const b of group) {
				if (a === b || a.pageFrom! >= b.pageFrom!) continue;
				if (a.pageTo! > b.pageFrom!) issues.push(`Entradas ${a.id} e ${b.id}: irmãos sobrepostos em mais de uma página.`);
			}
		}
	}
	return issues;
}
