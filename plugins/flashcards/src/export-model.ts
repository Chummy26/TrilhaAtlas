/**
 * Export model: turns the Flashcards store into stable, target-neutral cards for
 * the Obsidian mirror, AnkiConnect and .apkg exporters (SÍNTESE §2.4(d) item 5;
 * r7 §8.2–8.3). Pure: no I/O.
 *
 * Decisions (simplest choice that satisfies the invariants):
 * - Identity: `LH_ID` = cue id (a UUID minted once per cue), so every target updates
 *   the same card instead of duplicating it.
 * - Region = the proposition's first deck in library order (cards in several decks are
 *   exported once; the other decks become `lh::deck::*` tags). Propositions without a
 *   deck go to "Sem baralho". Archived (not live) propositions and deleted cues are
 *   not exported.
 * - Kind: an explicit `cue.kind` ("basic" | "reverse" | "cloze") wins; otherwise a
 *   question with Anki cloze markup (`{{c1::…}}`) is a cloze; everything else is basic.
 *   A "cloze" without a usable deletion (empty, unclosed or numbered above 500) is
 *   exported as basic: Anki would generate no card and anki-apkg-export would reject
 *   the whole package.
 * - Text: C0 control characters (except tab/newline) are removed before hashing and
 *   rendering, since `\u001f` is Anki's field separator and aborts an .apkg build.
 * - Anki fields are HTML rendered from the cue Markdown by a small, escaping converter
 *   (code, bold/italic, line breaks, TeX `$…$`/`$$…$$` → MathJax `\(…\)`/`\[…\]`).
 */

import { createHash } from "node:crypto";

export type CardKind = "basic" | "reverse" | "cloze";

export interface ExportCard {
	lhId: string;
	cueId: string;
	propositionId: string;
	propositionName: string;
	domainId: string;
	domainTitle: string;
	region: string;
	regionKey: string;
	kind: CardKind;
	question: string;
	answer: string;
	/** Anki tags: `lh::dom::<id>` plus `lh::deck::<deck id>` for secondary memberships. */
	tags: string[];
	contentHash: string;
}

export interface ExportCue {
	id: string;
	question: string;
	answer: string;
	deleted?: boolean;
	kind?: unknown;
}

export interface ExportProposition {
	id: string;
	name?: string;
	cues: readonly ExportCue[];
}

export interface ExportDeck {
	id: string;
	name: string;
	propositionIds: readonly string[];
}

export interface ExportSource {
	decks: readonly ExportDeck[];
	propositions: Record<string, ExportProposition>;
}

export interface ExportDomain {
	id: string;
	title: string;
}

export const UNASSIGNED_REGION = "Sem baralho";
export const UNASSIGNED_REGION_KEY = "unassigned";
const CLOZE_DELETION = /\{\{c(\d+)::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g;
/** anki-apkg-export rejects cloze numbers above this (and Anki has no use for them). */
export const MAX_CLOZE_NUMBER = 500;
/** C0 controls except tab/LF/CR, and DEL: `\u001f` is Anki's field separator, `\u0000` breaks SQLite text. */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

export function domainTag(domainId: string): string {
	return `lh::dom::${domainId}`;
}

/** Card text as every target receives it: control characters removed. */
export function cleanText(text: string): string {
	return text.replace(CONTROL_CHARACTERS, "");
}

/**
 * True when the text has a deletion Anki turns into a card: a closed `{{cN::text}}`
 * with non-blank text and N in 1..500 (a larger N makes the whole .apkg fail).
 */
export function hasClozeDeletion(text: string): boolean {
	const deletions = [...text.matchAll(CLOZE_DELETION)].map((match) => ({ number: Number(match[1]), text: match[2] ?? "" }));
	return deletions.every((deletion) => deletion.number <= MAX_CLOZE_NUMBER)
		&& deletions.some((deletion) => deletion.number >= 1 && deletion.text.trim() !== "");
}

/** Explicit `cue.kind` wins, except a cloze without a usable deletion, which would produce no card. */
export function cardKind(cue: Pick<ExportCue, "question" | "kind">): CardKind {
	if (cue.kind === "basic" || cue.kind === "reverse") return cue.kind;
	return hasClozeDeletion(cue.question) ? "cloze" : "basic";
}

function tagSafe(value: string): string {
	return value.replace(/[\s\u0000-\u001f"]+/g, "_");
}

/** Cards in library order (deck order, then proposition order, then cue order). */
export function collectExportCards(source: ExportSource, domain: ExportDomain, isLive: (propositionId: string) => boolean): ExportCard[] {
	const primary = new Map<string, ExportDeck>();
	const memberships = new Map<string, ExportDeck[]>();
	const order: string[] = [];
	for (const deck of source.decks) for (const id of deck.propositionIds) {
		if (!primary.has(id)) { primary.set(id, deck); order.push(id); }
		memberships.set(id, [...memberships.get(id) ?? [], deck]);
	}
	for (const id of Object.keys(source.propositions)) if (!primary.has(id)) order.push(id);
	const cards: ExportCard[] = [];
	const seen = new Set<string>();
	for (const propositionId of order) {
		const proposition = Object.hasOwn(source.propositions, propositionId) ? source.propositions[propositionId] : undefined;
		if (!proposition || !isLive(propositionId)) continue;
		const deck = primary.get(propositionId);
		const region = cleanText(deck?.name ?? "").trim() || (deck ? "Sem título" : UNASSIGNED_REGION);
		const regionKey = deck?.id ?? UNASSIGNED_REGION_KEY;
		const tags = [domainTag(domain.id), ...(memberships.get(propositionId) ?? []).filter((other) => other !== deck).map((other) => `lh::deck::${tagSafe(other.id)}`)];
		for (const cue of proposition.cues) {
			const question = cleanText(cue.question);
			if (cue.deleted || seen.has(cue.id) || !question.trim()) continue;
			seen.add(cue.id);
			const kind = cardKind({ question, kind: cue.kind });
			const card = { lhId: cue.id, cueId: cue.id, propositionId, propositionName: cleanText(proposition.name ?? ""), domainId: domain.id, domainTitle: cleanText(domain.title), region, regionKey, kind, question, answer: cleanText(cue.answer), tags };
			cards.push({ ...card, contentHash: sha256(JSON.stringify([kind, card.question, card.answer, region, domain.id, tags, card.propositionName])) });
		}
	}
	return cards;
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

/**
 * Markdown subset → Anki HTML. Code and TeX are protected first so their content is
 * escaped but never reformatted; `\$` stays a literal dollar sign.
 */
export function markdownToAnkiHtml(markdown: string): string {
	const protectedParts: string[] = [];
	const hold = (html: string): string => `\u0000${protectedParts.push(html) - 1}\u0000`;
	let text = markdown.replace(/\u0000/g, "").replace(/\r\n?/g, "\n");
	text = text.replace(/```[^\n]*\n([\s\S]*?)```/g, (_, code: string) => hold(`<pre><code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`));
	text = text.replace(/`([^`\n]+)`/g, (_, code: string) => hold(`<code>${escapeHtml(code)}</code>`));
	text = text.replace(/\\\$/g, () => hold("$"));
	text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => hold(`\\[${escapeHtml(tex.trim())}\\]`));
	text = text.replace(/\$([^\s$](?:[^$\n]*[^\s$])?)\$/g, (_, tex: string) => hold(`\\(${escapeHtml(tex)}\\)`));
	text = escapeHtml(text)
		.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
		.replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, "$1<i>$2</i>")
		.replace(/\n/g, "<br>");
	return text.replace(/\u0000(\d+)\u0000/g, (_, index: string) => protectedParts[Number(index)] ?? "");
}

export interface AnkiNoteContent {
	noteType: "basic" | "reverse" | "cloze";
	/** Field values in note-type order, starting with LH_ID. */
	fields: Record<string, string>;
}

/** Note type definitions shared by AnkiConnect and .apkg (first field LH_ID: v1 has no GUID). */
export const NOTE_TYPES = {
	basic: { name: "LearnHarness Basic v1", fields: ["LH_ID", "Front", "Back", "Source"], kind: "normal" as const, sortField: "Front" },
	reverse: { name: "LearnHarness Reverse v1", fields: ["LH_ID", "Front", "Back", "Source"], kind: "normal" as const, sortField: "Front" },
	cloze: { name: "LearnHarness Cloze v1", fields: ["LH_ID", "Text", "Extra", "Source"], kind: "cloze" as const, sortField: "Text" },
} satisfies Record<CardKind, { name: string; fields: readonly string[]; kind: "normal" | "cloze"; sortField: string }>;

export const NOTE_TYPE_CSS = ".card { font-family: system-ui, sans-serif; font-size: 20px; text-align: left; color: #1f1f1f; background: #fff; }\n.nightMode.card { color: #eee; background: #1f1f1f; }\n.lh-source { margin-top: 1em; font-size: 13px; opacity: .6; }";

export const NOTE_TEMPLATES: Record<CardKind, ReadonlyArray<{ name: string; question: string; answer: string; requiredFields: readonly string[] }>> = {
	basic: [{ name: "Frente → Verso", question: "{{Front}}", answer: "{{FrontSide}}<hr id=answer>{{Back}}<div class=lh-source>{{Source}}</div>", requiredFields: ["Front"] }],
	reverse: [
		{ name: "Frente → Verso", question: "{{Front}}", answer: "{{FrontSide}}<hr id=answer>{{Back}}<div class=lh-source>{{Source}}</div>", requiredFields: ["Front"] },
		{ name: "Verso → Frente", question: "{{Back}}", answer: "{{FrontSide}}<hr id=answer>{{Front}}<div class=lh-source>{{Source}}</div>", requiredFields: ["Back"] },
	],
	cloze: [{ name: "Cloze", question: "{{cloze:Text}}", answer: "{{cloze:Text}}<br>{{Extra}}<div class=lh-source>{{Source}}</div>", requiredFields: ["Text"] }],
};

export function ankiNoteContent(card: ExportCard): AnkiNoteContent {
	const source = escapeHtml([card.region, card.propositionName].filter(Boolean).join(" · "));
	if (card.kind === "cloze") {
		return { noteType: "cloze", fields: { LH_ID: card.lhId, Text: markdownToAnkiHtml(card.question), Extra: markdownToAnkiHtml(card.answer), Source: source } };
	}
	return { noteType: card.kind, fields: { LH_ID: card.lhId, Front: markdownToAnkiHtml(card.question), Back: markdownToAnkiHtml(card.answer), Source: source } };
}

/** Anki deck names use "::" as hierarchy separator; titles must not inject levels. */
export function deckSegment(title: string): string {
	const clean = title.replace(/[\u0000-\u001f]/g, " ").replace(/:{2,}/g, ":").replace(/\s+/g, " ").trim();
	return clean || "Sem título";
}

export function ankiDeckName(card: Pick<ExportCard, "domainTitle" | "region">): string {
	return `LearnHarness::${deckSegment(card.domainTitle)}::${deckSegment(card.region)}`;
}

export function ankiRootDeckName(domainTitle: string): string {
	return `LearnHarness::${deckSegment(domainTitle)}`;
}
