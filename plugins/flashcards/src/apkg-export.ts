/**
 * Offline Anki export: a `.apkg` built with anki-apkg-export@5.0.0 (MIT, sql.js WASM)
 * for when Anki is closed (SÍNTESE §2.4(d) item 5; extra-repeat-space__anki-apkg-export.md).
 *
 * Stability: anki-apkg-export derives each note GUID from
 * sha1([topDeckId, modelId, ["id", noteId]]). Here `noteId` = LH_ID (cue id), the top
 * deck id is derived from the domain id and the model ids are fixed constants, so every
 * export of the same cue carries the same GUID and LH_ID and Anki updates the note on
 * import instead of duplicating it. Note types and field order match AnkiConnect's
 * (export-model.ts NOTE_TYPES), so both paths fill the same note types.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import AnkiExport, { type ModelDefinition } from "anki-apkg-export";
import { ankiDeckName, ankiNoteContent, ankiRootDeckName, NOTE_TEMPLATES, NOTE_TYPE_CSS, NOTE_TYPES, type CardKind, type ExportCard, type ExportDomain } from "./export-model.ts";
import { writeFileAtomic } from "./fs-durable.ts";

/** Fixed note-type ids (Anki model ids are epoch-ms-like integers). */
export const APKG_MODEL_IDS: Record<CardKind, number> = { basic: 1_731_800_000_101, reverse: 1_731_800_000_102, cloze: 1_731_800_000_103 };

export function stableDeckId(domainId: string): number {
	return 1_000_000_000_000 + parseInt(createHash("sha256").update(`lh-deck:${domainId}`).digest("hex").slice(0, 12), 16) % 8_000_000_000_000;
}

export function noteGuid(domainId: string, kind: CardKind, lhId: string): string {
	return createHash("sha1").update(JSON.stringify([stableDeckId(domainId), APKG_MODEL_IDS[kind], ["id", lhId]])).digest("hex");
}

export function apkgModel(kind: CardKind): ModelDefinition {
	const type = NOTE_TYPES[kind];
	return {
		id: APKG_MODEL_IDS[kind],
		name: type.name,
		fields: type.fields,
		type: type.kind === "cloze" ? "cloze" : "basic",
		sortField: type.sortField,
		css: NOTE_TYPE_CSS,
		templates: NOTE_TEMPLATES[kind].map((template) => ({ name: template.name, questionFormat: template.question, answerFormat: template.answer, requiredFields: template.requiredFields })),
	};
}

export interface ApkgOptions {
	domain: ExportDomain;
	/** Absolute path of sql-wasm.wasm (shipped next to the bundled backend). */
	wasmPath: string;
}

/** Builds the package bytes. Throws when there is nothing to export. */
export async function buildApkg(cards: readonly ExportCard[], options: ApkgOptions): Promise<Uint8Array> {
	if (!cards.length) throw new Error("Não há cartões para exportar.");
	if (!fs.existsSync(options.wasmPath)) throw new Error(`Arquivo sql-wasm.wasm não encontrado em ${options.wasmPath}.`);
	const exporter = await AnkiExport.create(ankiRootDeckName(options.domain.title), {
		deckId: stableDeckId(options.domain.id),
		model: apkgModel("basic"),
		locateFile: () => options.wasmPath,
	});
	try {
		for (const kind of new Set(cards.map((card) => card.kind))) if (kind !== "basic") exporter.addModel(apkgModel(kind));
		exporter.addNotes(cards.map((card) => {
			const content = ankiNoteContent(card);
			return { fields: content.fields, noteId: card.lhId, deck: ankiDeckName(card), tags: card.tags, modelId: APKG_MODEL_IDS[card.kind] };
		}));
		return await exporter.save();
	} finally {
		exporter.close();
	}
}

export function apkgFileName(domain: ExportDomain, now: Date): string {
	const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
	return `learnharness-${domain.id}-${stamp}.apkg`;
}

/** Writes the package atomically into `directory` and returns its path. */
export async function writeApkg(cards: readonly ExportCard[], options: ApkgOptions & { directory: string; now?: Date }): Promise<{ path: string; notes: number; bytes: number }> {
	const bytes = await buildApkg(cards, options);
	fs.mkdirSync(options.directory, { recursive: true });
	const file = path.join(options.directory, apkgFileName(options.domain, options.now ?? new Date()));
	writeFileAtomic(file, bytes);
	return { path: file, notes: cards.length, bytes: bytes.byteLength };
}
