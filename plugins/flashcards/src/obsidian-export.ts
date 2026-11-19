/**
 * One-way mirror of the Flashcards library into an Obsidian vault
 * (SÍNTESE §2.4(d) item 5; r7 §8.2; clew ADR-0008 for the write protocol).
 *
 * Layout and format:
 * - one note per region: `<vault>/LearnHarness/<Domínio>/<Região>.md`;
 * - Obsidian Spaced Repetition syntax: multiline question / `?` / answer, reversed
 *   `a:::b` (single line) or `??` (multiline), cloze `==x==` (`^[hint]`, `[^N]` when a
 *   cloze number groups several deletions); frontmatter tag `flashcards/<dom>/<região>`;
 * - every card ends with the anchor `<!--lh:id=<cue id>-->`;
 * - this module NEVER writes `<!--SR:…-->`: content that contains one is defused, and
 *   the only SR comments that can survive are the ones the SR plugin itself appended
 *   to an unchanged card (kept so a re-export does not wipe the user's Obsidian schedule);
 * - card text never forms an SR separator: every run of `:`/`=` is broken with `\`
 *   (`:::` → `:\:\:`), and inline code is kept verbatim only where SR's own rule
 *   (`srSeesInlineMarker`: first occurrence, odd backticks on both sides) calls it code;
 *   a `=` right before a deletion's closing or opening `==` is written `&#61;`.
 *
 * Ownership: cards live between `<!-- lh:begin cards … -->` and `<!-- lh:end cards -->`;
 * text outside the block (frontmatter, user notes) is never rewritten. A note with a
 * begin marker but no end marker, or with two blocks, is refused rather than guessed.
 * A note created by another domain (`lh_domain` in its frontmatter, same title in the
 * same vault) is never merged into. Folders are created only after their nearest
 * existing ancestor resolved inside the vault.
 *
 * Write protocol: every changed note is first written and fsynced in
 * `<vault>/.learnharness-staging/<uuid>/`, then published — new notes with a no-replace
 * hard link, existing notes with an atomic rename after checking they did not change
 * since they were read. Unchanged notes are not touched, so re-exporting is idempotent.
 * Notes of regions that disappeared are deleted only when byte-identical to the last
 * export (otherwise their block is emptied). A previous note that is the same file as a
 * planned one (region renamed only in letter case on a case-insensitive file system) is
 * not stale.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { sha256, type ExportCard, type ExportDomain } from "./export-model.ts";
import { commitNew, commitReplace, writeDurably } from "./fs-durable.ts";
import type { ExternalLink } from "./sync-types.ts";

export const ROOT_FOLDER = "LearnHarness";
export const STAGING_FOLDER = ".learnharness-staging";
export const BLOCK_BEGIN = "<!-- lh:begin cards · gerado pelo LearnHarness; o que estiver dentro deste bloco é substituído a cada exportação -->";
export const BLOCK_END = "<!-- lh:end cards -->";
const BEGIN_PREFIX = "<!-- lh:begin cards";
const SR_COMMENT = /<!--SR:[^>]*-->/;
const CLOZE = /\{\{c([1-9]\d*)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export type ObsidianLink = NonNullable<ExternalLink["obsidian"]>;

export interface ObsidianFilePlan {
	/** POSIX path relative to the vault. */
	relativePath: string;
	region: string;
	regionKey: string;
	cards: ExportCard[];
}

export interface ObsidianExportOptions {
	vaultPath: string;
	domain: ExportDomain;
	cards: readonly ExportCard[];
	/** Hash of each note body this exporter last wrote (relative path → sha256), same vault only. */
	previousFiles?: Readonly<Record<string, string>>;
	previousLinks?: Readonly<Record<string, ObsidianLink | undefined>>;
	now?: Date;
}

export interface ObsidianExportResult {
	vaultPath: string;
	written: string[];
	unchanged: string[];
	removed: string[];
	emptied: string[];
	cards: number;
	links: Record<string, ObsidianLink>;
	files: Record<string, string>;
}

/**
 * Anchor value: the cue id with anything that could close an HTML comment or form an
 * SR separator (`::`) percent-encoded.
 */
export function anchorFor(lhId: string): string {
	const value = lhId.replace(/[^A-Za-z0-9_./-]/g, (character) => encodeURIComponent(character)).replace(/-(?=-)/g, "%2D");
	return `<!--lh:id=${value}-->`;
}

/**
 * The SR plugin's inline-card test (`hasInlineMarker` in its parser): only the FIRST
 * occurrence of the separator counts, and it is ignored when an odd number of
 * backticks lies on each side of it (inline code).
 */
export function srSeesInlineMarker(line: string, marker: string): boolean {
	const index = line.indexOf(marker);
	if (index < 0) return false;
	const backticks = (text: string): number => text.split("`").length - 1;
	return !(backticks(line.slice(0, index)) % 2 === 1 && backticks(line.slice(index + marker.length)) % 2 === 1);
}

const hasSrSeparator = (line: string): boolean => srSeesInlineMarker(line, ":::") || srSeesInlineMarker(line, "::");

/** Breaks every run of `:`/`=` (so `:::` and `===` cannot keep a separator) and defuses comments. */
function defuse(text: string): string {
	return text
		.replace(/<!--/g, "&lt;!--")
		.replace(/:(?=:)/g, ":\\")
		.replace(/=(?==)/g, "=\\");
}

/**
 * Escapes one line of card text so SR never sees a stray separator or comment. Inline
 * code is kept verbatim only when SR itself would treat it as code; otherwise the whole
 * line is escaped (a backslash in code is better than a broken card).
 */
export function escapeCardLine(line: string): string {
	const trimmed = line.trim();
	if (trimmed === "?" || trimmed === "??") return line.replace("?", "\\?");
	const escaped = line.split(/(`+[^`]*`+)/).map((part, index) => index % 2 ? part : defuse(part)).join("");
	return hasSrSeparator(escaped) ? defuse(line) : escaped;
}

function escapeText(text: string): string {
	return text.split("\n").map(escapeCardLine).join("\n");
}

/** Card text never contains blank lines: SR ends a card at the first blank line. */
function contentLines(text: string): string[] {
	return text.replace(/\r\n?/g, "\n").split("\n").filter((line) => line.trim() !== "").map((line) => line.replace(/\s+$/, ""));
}

/** Anki-style `{{cN::text::hint}}` → SR `==text==`, `==text==^[hint]`, `==text==[^N]`. */
export function clozeToObsidian(question: string): string {
	question = question.replace(/\r\n?/g, "\n");
	const counts = new Map<string, number>();
	for (const match of question.matchAll(CLOZE)) counts.set(match[1] ?? "", (counts.get(match[1] ?? "") ?? 0) + 1);
	const grouped = [...counts.values()].some((count) => count > 1);
	// A `=` touching a deletion's `==` shifts SR's lazy `==…==` match (`x={{c1::y}}` would
	// read as the deletion "=y"); it is written as an entity, which renders as `=`.
	const guardEquals = (text: string): string => text.endsWith("=") ? `${text.slice(0, -1)}&#61;` : text;
	let output = "";
	let last = 0;
	for (const match of question.matchAll(CLOZE)) {
		const index = match.index ?? 0;
		output += guardEquals(escapeText(question.slice(last, index)));
		const answer = guardEquals(escapeText(match[2] ?? "").replace(/\n/g, " "));
		const hint = match[3] ? `^[${escapeCardLine(match[3]).replace(/[[\]]/g, "\\$&")}]` : "";
		output += `==${answer}==${hint}${grouped ? `[^${match[1]}]` : ""}`;
		last = index + match[0].length;
	}
	return output + escapeText(question.slice(last));
}

/**
 * `question:::answer` when SR is guaranteed to split it at our separator (its first
 * `:::`, not inside code, with no `::` before it); null → use the multiline `??` form.
 */
function singleLineReverse(question: string, answer: string): string | null {
	const front = escapeCardLine(question);
	const line = `${front}:::${escapeCardLine(answer)}`;
	const at = front.length;
	return line.indexOf("::") === at && line.indexOf(":::") === at && srSeesInlineMarker(line, ":::") ? line : null;
}

/** Renders one card (without SR scheduling) ending with its anchor. */
export function renderCard(card: ExportCard): string {
	const anchor = anchorFor(card.lhId);
	const question = contentLines(card.question);
	const answer = contentLines(card.answer);
	let lines: string[];
	const single = card.kind === "reverse" && question.length === 1 && answer.length === 1 ? singleLineReverse(question[0] ?? "", answer[0] ?? "") : null;
	if (card.kind === "cloze") {
		// Segments are escaped separately around the deletions; re-check the assembled line.
		const cloze = contentLines(clozeToObsidian(card.question)).map((line) => hasSrSeparator(line) ? line.replace(/:(?=:)/g, ":\\") : line);
		lines = [...cloze, ...answer.map(escapeCardLine)];
	} else if (single !== null) {
		lines = [single];
	} else {
		const separator = card.kind === "reverse" ? "??" : "?";
		lines = [...question.map(escapeCardLine), separator, ...(answer.length ? answer.map(escapeCardLine) : ["—"])];
	}
	if (!lines.length) lines = ["—"];
	lines[lines.length - 1] = `${lines[lines.length - 1]} ${anchor}`;
	return lines.join("\n");
}

/** Folder/file name safe on Windows, macOS, Linux and inside Obsidian links. */
export function safeFileName(title: string): string {
	let name = title.normalize("NFC").replace(/[\u0000-\u001f<>:"/\\|?*#^[\]]+/g, " ").replace(/\s+/g, " ").trim().replace(/^[.\s]+|[.\s]+$/g, "");
	if (name.length > 80) name = name.slice(0, 80).trim();
	if (!name) name = "Sem título";
	return RESERVED_WINDOWS_NAME.test(name) ? `${name}_` : name;
}

export function tagSlug(title: string): string {
	const slug = title.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
	if (!slug) return "geral";
	return /^\d+$/.test(slug) ? `n${slug}` : slug;
}

/** One note per region; colliding names (case-insensitive) get " (2)", " (3)" in first-seen order. */
export function planRegionFiles(cards: readonly ExportCard[], domain: ExportDomain): ObsidianFilePlan[] {
	const folder = `${ROOT_FOLDER}/${safeFileName(domain.title)}`;
	const plans = new Map<string, ObsidianFilePlan>();
	const used = new Set<string>();
	for (const card of cards) {
		let plan = plans.get(card.regionKey);
		if (!plan) {
			const base = safeFileName(card.region);
			let name = base;
			for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n})`;
			used.add(name.toLowerCase());
			plan = { relativePath: `${folder}/${name}.md`, region: card.region, regionKey: card.regionKey, cards: [] };
			plans.set(card.regionKey, plan);
		}
		plan.cards.push(card);
	}
	return [...plans.values()];
}

function yamlString(value: string): string {
	return JSON.stringify(value);
}

export function newRegionNote(plan: Pick<ObsidianFilePlan, "region" | "regionKey">, domain: ExportDomain, block: string): string {
	return [
		"---",
		"tags:",
		`  - flashcards/${tagSlug(domain.title)}/${tagSlug(plan.region)}`,
		`lh_domain: ${yamlString(domain.id)}`,
		`lh_region: ${yamlString(plan.regionKey)}`,
		"---",
		"",
		`# ${plan.region.replace(/[\r\n]+/g, " ")}`,
		"",
		block,
		"",
	].join("\n");
}

interface ScheduledComment {
	comment: string;
	inline: boolean;
}

/** SR comments the Obsidian plugin appended to cards of the previous block, keyed by anchor and card text. */
function previousSchedules(block: string): Map<string, ScheduledComment> {
	const result = new Map<string, ScheduledComment>();
	for (const chunk of block.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
		const lines = chunk.split("\n").filter((line) => line.trim() !== "");
		const anchorLine = lines.findIndex((line) => line.includes("<!--lh:id="));
		if (anchorLine < 0) continue;
		let comment: ScheduledComment | null = null;
		const next = lines[anchorLine + 1]?.trim();
		if (next && SR_COMMENT.test(next) && next.replace(SR_COMMENT, "").trim() === "") {
			comment = { comment: next, inline: false };
			lines.splice(anchorLine + 1, 1);
		} else {
			const inline = lines[anchorLine]?.match(/\s*(<!--SR:[^>]*-->)\s*$/);
			if (inline?.[1]) {
				comment = { comment: inline[1], inline: true };
				lines[anchorLine] = (lines[anchorLine] ?? "").slice(0, inline.index);
			}
		}
		if (comment) result.set(lines.join("\n"), comment);
	}
	return result;
}

function renderBlock(cards: readonly string[], previous: Map<string, ScheduledComment>, eol: string): string {
	const rendered = cards.map((text) => {
		const scheduled = previous.get(text);
		if (!scheduled) return text;
		return scheduled.inline ? `${text} ${scheduled.comment}` : `${text}\n${scheduled.comment}`;
	});
	return [BLOCK_BEGIN, "", ...rendered.flatMap((text) => [text, ""]), BLOCK_END].join("\n").replace(/\n/g, eol);
}

/** Inserts or replaces the managed block; null `existing` creates the note. */
export function upsertManagedBlock(existing: string | null, cards: readonly string[], plan: Pick<ObsidianFilePlan, "region" | "regionKey" | "relativePath">, domain: ExportDomain): string {
	if (existing === null) return newRegionNote(plan, domain, renderBlock(cards, new Map(), "\n"));
	const eol = existing.includes("\r\n") ? "\r\n" : "\n";
	const lines = existing.split(/\r?\n/);
	const begin = lines.findIndex((line) => line.trim().startsWith(BEGIN_PREFIX));
	const end = lines.findIndex((line, index) => index > begin && line.trim() === BLOCK_END);
	if (begin < 0) {
		if (lines.some((line) => line.trim() === BLOCK_END)) throw new Error(`A nota ${plan.relativePath} tem o marcador final do LearnHarness sem o inicial. Corrija a nota e exporte de novo.`);
		const base = existing.replace(/\s+$/, "");
		return `${base}${eol}${eol}${renderBlock(cards, new Map(), eol)}${eol}`;
	}
	if (end < 0) throw new Error(`A nota ${plan.relativePath} tem o marcador inicial do LearnHarness sem o final. Corrija a nota e exporte de novo.`);
	// A second block (copy/paste, sync conflict) would keep stale cards and duplicate anchors.
	if (lines.some((line, index) => index !== begin && index !== end && (line.trim().startsWith(BEGIN_PREFIX) || line.trim() === BLOCK_END))) {
		throw new Error(`A nota ${plan.relativePath} tem mais de um bloco de cartões do LearnHarness. Apague o bloco repetido e exporte de novo.`);
	}
	const previous = previousSchedules(lines.slice(begin + 1, end).join("\n"));
	return [...lines.slice(0, begin), renderBlock(cards, previous, eol), ...lines.slice(end + 1)].join(eol);
}

function ensureInside(root: string, candidate: string): void {
	const relative = path.relative(root, candidate);
	if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("O destino da exportação saiu do cofre do Obsidian (link simbólico?). Nada foi gravado.");
}

/** Creates `directory` only after its nearest existing ancestor resolved inside the vault (no mkdir through a link). */
function ensureDirectoryInside(vault: string, directory: string): void {
	let existing = directory;
	while (!fs.existsSync(existing) && path.dirname(existing) !== existing) existing = path.dirname(existing);
	ensureInside(vault, fs.realpathSync(existing));
	fs.mkdirSync(directory, { recursive: true });
	ensureInside(vault, fs.realpathSync(directory));
}

/** True when both paths name the same existing file (e.g. differing only in letter case on Windows/macOS). */
function sameFile(a: string, b: string): boolean {
	try {
		const left = fs.statSync(a, { bigint: true });
		const right = fs.statSync(b, { bigint: true });
		return left.dev === right.dev && left.ino === right.ino;
	} catch {
		return false;
	}
}

/** `lh_domain` of a note this exporter created (leading frontmatter), or null. */
export function noteDomain(text: string): string | null {
	const frontmatter = text.replace(/^﻿/, "").match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	const line = frontmatter?.[1]?.match(/^lh_domain:\s*(.+?)\s*$/m)?.[1];
	if (line === undefined) return null;
	try { const value = JSON.parse(line) as unknown; return typeof value === "string" ? value : line; } catch { return line; }
}

function readIfFile(file: string): string | null {
	let stat: fs.Stats;
	try { stat = fs.lstatSync(file); } catch (error) {
		if ((error as { code?: string }).code === "ENOENT") return null;
		throw error;
	}
	if (!stat.isFile()) throw new Error(`${file} não é um arquivo comum (link simbólico ou pasta). Nada foi gravado.`);
	return fs.readFileSync(file, "utf8");
}

/** Resolves the vault (must be an existing directory) to its real path. */
export function resolveVault(vaultPath: string): string {
	if (!path.isAbsolute(vaultPath)) throw new Error("Informe o caminho absoluto do cofre do Obsidian.");
	let real: string;
	try { real = fs.realpathSync(vaultPath); } catch { throw new Error(`Cofre do Obsidian não encontrado: ${vaultPath}`); }
	if (!fs.statSync(real).isDirectory()) throw new Error(`O caminho do cofre não é uma pasta: ${vaultPath}`);
	return real;
}

interface PendingWrite { relativePath: string; target: string; staged: string; existing: string | null; content: string }
interface PendingDelete { relativePath: string; target: string; expected: string }

export function exportToObsidian(options: ObsidianExportOptions): ObsidianExportResult {
	const vault = resolveVault(options.vaultPath);
	const now = (options.now ?? new Date()).toISOString();
	const plans = planRegionFiles(options.cards, options.domain);
	const previousFiles = options.previousFiles ?? {};
	const result: ObsidianExportResult = { vaultPath: vault, written: [], unchanged: [], removed: [], emptied: [], cards: 0, links: {}, files: {} };
	const absolute = (relativePath: string): string => path.join(vault, ...relativePath.split("/"));
	const stagingRoot = path.join(vault, STAGING_FOLDER);
	const staging = path.join(stagingRoot, randomUUID());
	const writes: PendingWrite[] = [];
	const deletes: PendingDelete[] = [];
	fs.mkdirSync(staging, { recursive: true });
	try {
		const stage = (relativePath: string, existing: string | null, content: string): void => {
			const target = absolute(relativePath);
			if (existing === content) { result.unchanged.push(relativePath); result.files[relativePath] = sha256(content); return; }
			const staged = path.join(staging, `${writes.length}.md`);
			writeDurably(staged, content);
			writes.push({ relativePath, target, staged, existing, content });
		};
		for (const plan of plans) {
			const target = absolute(plan.relativePath);
			ensureDirectoryInside(vault, path.dirname(target));
			const texts = plan.cards.map(renderCard);
			plan.cards.forEach((card, index) => {
				const text = texts[index] ?? "";
				const hash = sha256(text);
				const previous = options.previousLinks?.[card.cueId];
				const unchanged = previous?.path === plan.relativePath && previous.contentHash === hash;
				result.links[card.cueId] = { path: plan.relativePath, anchor: anchorFor(card.lhId), contentHash: hash, writtenAt: unchanged ? previous.writtenAt : now };
			});
			result.cards += plan.cards.length;
			const existing = readIfFile(target);
			// Notes this domain already tracks are its own; another domain's note (same title) is never merged into.
			const owner = existing === null || Object.hasOwn(previousFiles, plan.relativePath) ? null : noteDomain(existing);
			if (owner !== null && owner !== options.domain.id) {
				throw new Error(`A nota ${plan.relativePath} pertence ao domínio "${owner}". Dê títulos diferentes aos domínios que exportam para o mesmo cofre. Nada foi gravado.`);
			}
			stage(plan.relativePath, existing, upsertManagedBlock(existing, texts, plan, options.domain));
		}
		const planned = new Set(plans.map((plan) => plan.relativePath));
		const plannedTargets = plans.map((plan) => absolute(plan.relativePath));
		for (const [relativePath, hash] of Object.entries(previousFiles)) {
			if (planned.has(relativePath) || !relativePath.startsWith(`${ROOT_FOLDER}/`)) continue;
			const target = absolute(relativePath);
			ensureInside(vault, target);
			if (!fs.existsSync(path.dirname(target))) continue;
			ensureInside(vault, fs.realpathSync(path.dirname(target)));
			// A region renamed only in letter case is the same note on Windows/macOS: it is planned, not stale.
			if (plannedTargets.some((plannedTarget) => sameFile(plannedTarget, target))) continue;
			const existing = readIfFile(target);
			if (existing === null) continue;
			if (sha256(existing) === hash) deletes.push({ relativePath, target, expected: existing });
			else {
				const emptied = upsertManagedBlock(existing, [], { relativePath, region: "", regionKey: "" }, options.domain);
				if (emptied !== existing) result.emptied.push(relativePath);
				stage(relativePath, existing, emptied);
				delete result.files[relativePath];
			}
		}
		for (const write of writes) {
			if (write.existing === null) commitNew(write.staged, write.target);
			else commitReplace(write.staged, write.target, write.existing);
			if (planned.has(write.relativePath)) {
				result.written.push(write.relativePath);
				result.files[write.relativePath] = sha256(write.content);
			}
		}
		for (const pending of deletes) {
			if (readIfFile(pending.target) !== pending.expected) throw new Error(`A nota ${pending.relativePath} mudou durante a exportação. Exporte de novo.`);
			fs.unlinkSync(pending.target);
			result.removed.push(pending.relativePath);
			try { fs.rmdirSync(path.dirname(pending.target)); } catch { /* folder still holds other notes */ }
		}
	} finally {
		fs.rmSync(staging, { recursive: true, force: true });
		try { fs.rmdirSync(stagingRoot); } catch { /* another export is staging, or the folder is not empty */ }
	}
	return result;
}
