/**
 * Section text → retrieval chunks (SÍNTESE §2.8 "Chunks de 300–800 tokens com
 * breadcrumb e cabeçalho de contexto"; r6 §10.3).
 *
 *  - the unit is ONE section: chunks never cross sections;
 *  - paragraphs are packed greedily up to `maxTokens`; a paragraph longer
 *    than the budget is split by sentences, and a sentence longer than the
 *    budget is hard-split at word boundaries;
 *  - consecutive chunks overlap by ~12% of `maxTokens` (r6: 10–15%), carried
 *    as the tail words of the previous chunk; the packing budget of every
 *    non-first chunk is reduced by that overlap, so NO chunk exceeds
 *    `maxTokens` (property-tested);
 *  - a final chunk below `minTokens` is merged into the previous one when the
 *    merge still fits;
 *  - `contextHeader` = breadcrumb joined with " › " (the cheap alternative to
 *    per-chunk contextual retrieval: r6 §10.3).
 * Token estimate: ⌈characters / 4⌉ (good enough for budgeting; the real
 * tokenizer differs per model and is never needed here).
 *
 * Pure: browser-safe.
 */

import type { ContentChunk, Span } from "./types.ts";

export interface ChunkOptions {
	minTokens?: number;
	maxTokens?: number;
	overlapRatio?: number;
}

const DEFAULT_CHUNK = { minTokens: 300, maxTokens: 800, overlapRatio: 0.12 } as const;

export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

function splitSentences(paragraph: string): string[] {
	const parts = paragraph.match(/[^.!?。！？]+(?:[.!?。！？]+["')\]]*\s*|$)/g);
	return (parts ?? [paragraph]).map((s) => s.trim()).filter(Boolean);
}

function hardSplit(text: string, maxChars: number): string[] {
	const out: string[] = [];
	let rest = text.trim();
	while (rest.length > maxChars) {
		let cut = rest.lastIndexOf(" ", maxChars);
		if (cut <= 0) cut = maxChars;
		out.push(rest.slice(0, cut).trim());
		rest = rest.slice(cut).trim();
	}
	if (rest) out.push(rest);
	return out;
}

/** Pieces no larger than `maxChars`: paragraphs, else sentences, else word-split. */
function pieces(text: string, maxChars: number): string[] {
	const out: string[] = [];
	for (const para of text.split(/\n\s*\n/)) {
		const p = para.trim();
		if (!p) continue;
		if (p.length <= maxChars) {
			out.push(p);
			continue;
		}
		for (const sentence of splitSentences(p)) {
			if (sentence.length <= maxChars) out.push(sentence);
			else out.push(...hardSplit(sentence, maxChars));
		}
	}
	return out;
}

function tailWords(text: string, maxChars: number): string {
	if (maxChars <= 0) return "";
	if (text.length <= maxChars) return text;
	const slice = text.slice(text.length - maxChars);
	const space = slice.indexOf(" ");
	return (space >= 0 ? slice.slice(space + 1) : slice).trim();
}

/** Split one section's text into chunk texts (see header for the rules). */
export function chunkText(text: string, options: ChunkOptions = {}): string[] {
	const o = { ...DEFAULT_CHUNK, ...options };
	if (!(o.maxTokens > 0) || o.minTokens < 0 || o.minTokens > o.maxTokens) throw new Error("chunkText: limites de tokens inválidos.");
	const maxChars = o.maxTokens * 4;
	const overlapChars = Math.floor(Math.max(0, Math.min(0.5, o.overlapRatio)) * maxChars);
	// Overlap + the blank-line joint (2 chars) must still fit in maxChars.
	const budget = Math.max(1, maxChars - overlapChars - 2);
	const units = pieces(text, budget);
	const chunks: string[] = [];
	let current = "";
	let carried = "";
	for (const unit of units) {
		const candidate = current ? `${current}\n\n${unit}` : unit;
		const limit = chunks.length === 0 ? maxChars : budget;
		if (candidate.length <= limit || !current) {
			current = candidate;
			continue;
		}
		chunks.push(carried ? `${carried}\n\n${current}` : current);
		carried = tailWords(current, overlapChars);
		current = unit;
	}
	if (current) {
		const last = carried ? `${carried}\n\n${current}` : current;
		const prev = chunks[chunks.length - 1];
		if (prev !== undefined && estimateTokens(current) < o.minTokens && prev.length + 2 + current.length <= maxChars) {
			chunks[chunks.length - 1] = `${prev}\n\n${current}`;
		} else {
			chunks.push(last);
		}
	}
	return chunks;
}

export interface SectionInput {
	resourceId: string;
	sectionId?: string;
	breadcrumb: string[];
	text: string;
	span?: Span;
}

/** ContentChunks of one section, ids `<resourceId>|<sectionId>|<n>`. */
export function chunkSection(input: SectionInput, options: ChunkOptions = {}): ContentChunk[] {
	const header = input.breadcrumb.filter(Boolean).join(" › ");
	return chunkText(input.text, options).map((text, i) => ({
		id: `${input.resourceId}|${input.sectionId ?? ""}|${i}`,
		resourceId: input.resourceId,
		...(input.sectionId ? { sectionId: input.sectionId } : {}),
		breadcrumb: [...input.breadcrumb],
		text,
		tokens: estimateTokens(text),
		...(input.span ? { span: { ...input.span } } : {}),
		...(header ? { contextHeader: header } : {}),
	}));
}
