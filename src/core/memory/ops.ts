/**
 * Mental-model ops (DeepTutor `ops.py` [ref-deeptutor-core.md §3.2]; Hindsight
 * delta refresh "nunca substitui o documento por conteúdo parcial"
 * [extra-vectorize-io__hindsight.md §5.8]; SÍNTESE §2.3 MentalModelOp).
 *
 * A mental model is a list of short entries grouped in sections (the 4
 * canonical ones: Estado atual · Pontos fracos · Próximos passos ·
 * Preferências). The consolidator never rewrites it wholesale: it emits ops,
 * and a batch is ATOMIC — one invalid op rejects the whole batch and the
 * current document is returned unchanged.
 *
 * Validation (DeepTutor rules):
 *   - text: trimmed, single line, 1..240 chars;  section: single line, 1..80 chars
 *   - refs: non-empty, each `<type>:<id>` with type ∈ fact|obs|msg|episode|node|session,
 *     and accepted by the caller's `isValidRef` (refs must point to real rows)
 *   - edit/delete target an existing entry (not one deleted earlier in the batch)
 *   - delete reason ∈ contradicted|superseded|stale|low-signal
 * An `add` whose (section, folded text) already exists is skipped, not an error.
 *
 * Rendering: compact prompt form (no refs, saves tokens) and the Obsidian /
 * DeepTutor markdown form `- texto [^n] <!--m_ULID-->` + footnotes.
 */

import { foldText } from "./lexical.ts";
import { MENTAL_MODEL_ID_PATTERN, newId } from "./ids.ts";
import { fitLines } from "./tokens.ts";
import { MENTAL_MODEL_SECTIONS, type MentalModelDeleteReason, type MentalModelEntry, type MentalModelOp } from "./types.ts";

export const MAX_ENTRY_CHARS = 240;
export const MAX_SECTION_CHARS = 80;
export const DELETE_REASONS: readonly MentalModelDeleteReason[] = ["contradicted", "superseded", "stale", "low-signal"];
export const REF_PATTERN = /^(fact|obs|msg|episode|node|session):[\w.:-]{1,200}$/;

export interface OpError {
	index: number;
	message: string;
}

export interface ApplyOpsContext {
	now: number;
	/** Id factory for new entries (default `m_<ULID>`). */
	newId?: () => string;
	/** Refs must point to existing rows; default accepts any well-formed ref. */
	isValidRef?: (ref: string) => boolean;
	/** Restrict `add` to these sections (default: any well-formed section). */
	allowedSections?: readonly string[];
}

export type ApplyOpsResult =
	| { ok: true; entries: MentalModelEntry[]; changedIds: string[]; deleted: { id: string; reason: MentalModelDeleteReason }[]; skipped: number[] }
	| { ok: false; errors: OpError[] };

function singleLine(s: string): boolean {
	return !/[\r\n]/.test(s);
}

function checkText(text: unknown, label: string): string | null {
	if (typeof text !== "string") return `${label} ausente`;
	const t = text.trim();
	if (t.length === 0) return `${label} vazio`;
	if (!singleLine(t)) return `${label} deve ter uma única linha`;
	if (t.length > MAX_ENTRY_CHARS) return `${label} com ${t.length} caracteres (máximo ${MAX_ENTRY_CHARS})`;
	return null;
}

function checkRefs(refs: unknown, isValidRef: (ref: string) => boolean): string | null {
	if (!Array.isArray(refs) || refs.length === 0) return "refs vazias: toda entrada precisa citar a fonte";
	for (const ref of refs) {
		if (typeof ref !== "string" || !REF_PATTERN.test(ref)) return `ref malformada: ${JSON.stringify(ref)}`;
		if (!isValidRef(ref)) return `ref inexistente: ${ref}`;
	}
	return null;
}

function sectionRank(section: string): number {
	const i = (MENTAL_MODEL_SECTIONS as readonly string[]).indexOf(section);
	return i === -1 ? MENTAL_MODEL_SECTIONS.length : i;
}

/** Canonical order: the 4 sections first (in order), other sections alphabetically, then position. */
export function sortEntries(entries: readonly MentalModelEntry[]): MentalModelEntry[] {
	return [...entries].sort(
		(a, b) =>
			sectionRank(a.section) - sectionRank(b.section) ||
			(a.section < b.section ? -1 : a.section > b.section ? 1 : 0) ||
			a.position - b.position ||
			(a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
	);
}

export function applyMentalModelOps(current: readonly MentalModelEntry[], ops: readonly MentalModelOp[], ctx: ApplyOpsContext): ApplyOpsResult {
	const isValidRef = ctx.isValidRef ?? (() => true);
	const makeId = ctx.newId ?? (() => newId("m", ctx.now));
	const working = new Map(current.map((e) => [e.id, { ...e, refs: [...e.refs] }]));
	const errors: OpError[] = [];
	const changed = new Set<string>();
	const deleted: { id: string; reason: MentalModelDeleteReason }[] = [];
	const skipped: number[] = [];

	ops.forEach((op, index) => {
		const fail = (message: string) => errors.push({ index, message });
		if (!op || typeof op !== "object") return fail("op inválida");
		switch (op.op) {
			case "add": {
				const section = typeof op.section === "string" ? op.section.trim() : "";
				if (!section) return fail("seção vazia");
				if (!singleLine(section) || section.length > MAX_SECTION_CHARS) return fail(`seção inválida (≤ ${MAX_SECTION_CHARS} caracteres, uma linha)`);
				if (ctx.allowedSections && !ctx.allowedSections.includes(section)) return fail(`seção não permitida: ${section}`);
				const textError = checkText(op.text, "texto");
				if (textError) return fail(textError);
				const refsError = checkRefs(op.refs, isValidRef);
				if (refsError) return fail(refsError);
				const text = op.text.trim();
				const key = foldText(text);
				const dup = [...working.values()].some((e) => e.section === section && foldText(e.text) === key);
				if (dup) {
					skipped.push(index);
					return;
				}
				const position = Math.max(-1, ...[...working.values()].filter((e) => e.section === section).map((e) => e.position)) + 1;
				const id = makeId();
				if (!MENTAL_MODEL_ID_PATTERN.test(id) || working.has(id)) return fail(`id gerado inválido ou repetido: ${id}`);
				working.set(id, { id, section, text, refs: [...new Set(op.refs)], position, updatedAt: ctx.now });
				changed.add(id);
				return;
			}
			case "edit": {
				const target = working.get(op.targetId);
				if (!target) return fail(`entrada inexistente: ${op.targetId}`);
				const textError = checkText(op.newText, "novo texto");
				if (textError) return fail(textError);
				const refsError = checkRefs(op.newRefs, isValidRef);
				if (refsError) return fail(refsError);
				working.set(target.id, { ...target, text: op.newText.trim(), refs: [...new Set(op.newRefs)], updatedAt: ctx.now });
				changed.add(target.id);
				return;
			}
			case "delete": {
				if (!working.has(op.targetId)) return fail(`entrada inexistente: ${op.targetId}`);
				if (!DELETE_REASONS.includes(op.reason)) return fail(`motivo de remoção inválido: ${String(op.reason)}`);
				working.delete(op.targetId);
				changed.delete(op.targetId);
				deleted.push({ id: op.targetId, reason: op.reason });
				return;
			}
			default:
				return fail(`op desconhecida: ${String((op as { op?: unknown }).op)}`);
		}
	});

	if (errors.length > 0) return { ok: false, errors };
	return { ok: true, entries: sortEntries([...working.values()]), changedIds: [...changed], deleted, skipped };
}

/** Compact prompt rendering (`### Seção` + bullets, no refs), fitted to `maxTokens`. */
export function renderMentalModelsForPrompt(entries: readonly MentalModelEntry[], maxTokens: number): string {
	if (entries.length === 0) return "";
	const lines: string[] = [];
	let section: string | null = null;
	for (const e of sortEntries(entries)) {
		if (e.section !== section) {
			section = e.section;
			lines.push(`### ${section}`);
		}
		lines.push(`- ${e.text}`);
	}
	return fitLines(lines.join("\n"), maxTokens, "head").text;
}

/** Obsidian/DeepTutor markdown: `- texto [^1] <!--m_…-->` per entry, footnotes at the end. */
export function renderMentalModelsMarkdown(entries: readonly MentalModelEntry[], title: string): string {
	const footnotes = new Map<string, number>();
	const note = (ref: string) => {
		let n = footnotes.get(ref);
		if (n === undefined) {
			n = footnotes.size + 1;
			footnotes.set(ref, n);
		}
		return `[^${n}]`;
	};
	const out: string[] = [`# ${title}`, ""];
	const sorted = sortEntries(entries);
	const sections = [...new Set([...MENTAL_MODEL_SECTIONS, ...sorted.map((e) => e.section)])];
	for (const section of sections) {
		out.push(`## ${section}`);
		const items = sorted.filter((e) => e.section === section);
		if (items.length === 0) out.push("- _(vazio)_");
		for (const e of items) out.push(`- ${e.text} ${e.refs.map(note).join(", ")} <!--${e.id}-->`);
		out.push("");
	}
	for (const [ref, n] of footnotes) out.push(`[^${n}]: ${ref}`);
	return `${out.join("\n").trimEnd()}\n`;
}
