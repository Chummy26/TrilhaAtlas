/**
 * SYSTEM GLYPHS — r9 §9.3 P2 (theme, keyboard, plugin, key, sync, download,
 * upload, trash, edit, copy, pin, cost, …) plus the file/folder family the
 * lucide migration needs (estudos-sota M8 — SÍNTESE §2.12; lh-ui-theme
 * §5.1 inventory). Hand-drawn on the 24 px grid; ink only except `cost`,
 * a coin (object).
 */

import { arc, arrowHead, circle, clockwiseTangent, join, line, onCircle, poly, rotatePath, roundPoly, rrect, type XY } from "../shapes.ts";
import type { IconSpec, InkStroke } from "../spec.ts";

/** The page outline shared by the file family (folded top-right corner). */
const PAGE = "M14 3H7A2.5 2.5 0 0 0 4.5 5.5V18.5A2.5 2.5 0 0 0 7 21H17A2.5 2.5 0 0 0 19.5 18.5V8.5Z";
const FOLD = "M14 3.4V7A1.5 1.5 0 0 0 15.5 8.5H19.1";

function file(label: string, inner: readonly InkStroke[] = [], dots: IconSpec["dots"] = undefined): IconSpec {
	return { label, family: "glyph", ink: [{ d: PAGE }, { d: FOLD, w: 0.8 }, ...inner], ...(dots ? { dots } : {}) };
}

const FOLDER = "M3 7A2 2 0 0 1 5 5H9.2L11.2 7.5H19A2 2 0 0 1 21 9.5V18A2 2 0 0 1 19 20H5A2 2 0 0 1 3 18Z";

/** A tray (download/upload/export) open at the top. */
const TRAY = "M4 15V18.5A2 2 0 0 0 6 20.5H18A2 2 0 0 0 20 18.5V15";

/** Pushpin (upright). */
const PIN_HEAD = line(8, 3, 16, 3);
const PIN_BODY = "M9.5 3V9.2L6 13.2V15.5H18V13.2L14.5 9.2V3";

export const SYSTEM: Record<string, IconSpec> = {
	file: file("Arquivo"),
	"file-text": file("Documento", [{ d: join(line(8, 12.5, 16, 12.5), line(8, 16, 13.5, 16)), w: 0.75, detail: true }]),
	"file-code": file("Código", [{ d: join(roundPoly([[10, 11.5], [8, 13.75], [10, 16]], 0.3, false), roundPoly([[14, 11.5], [16, 13.75], [14, 16]], 0.3, false)), w: 0.75 }]),
	"file-image": file("Imagem", [{ d: roundPoly([[7.5, 17.5], [10.5, 13.5], [12.5, 15.5], [14, 14], [16.5, 17.5]], 0.4, false), w: 0.75 }], [[9.5, 11, 1.1]]),
	"file-audio": file("Áudio", [{ d: "M11.5 16.6V10.5L15.5 9.6V12", w: 0.75 }], [[10.2, 16.6, 1.5]]),
	"file-video": file("Vídeo", [{ d: roundPoly([[10, 11.2], [15, 14], [10, 16.8]], 0.4), w: 0.75 }]),
	"file-archive": file("Arquivo compactado", [{ d: join(line(9.5, 6, 9.5, 7.5), line(9.5, 10, 9.5, 11.5), line(9.5, 14, 9.5, 15.5)), w: 0.75 }]),
	"file-sheet": file("Planilha", [{ d: join(rrect(7.5, 11, 9, 7, 0.8), line(12, 11, 12, 18), line(7.5, 14.5, 16.5, 14.5)), w: 0.7 }]),
	"file-link": file("Atalho de arquivo", [{ d: join("M8 17.5V16A3 3 0 0 1 11 13H15.5", roundPoly([[13.5, 11], [15.5, 13], [13.5, 15]], 0.3, false)), w: 0.75 }]),
	folder: { label: "Pasta", family: "glyph", ink: [{ d: FOLDER }] },
	"folder-open": {
		label: "Pasta aberta",
		family: "glyph",
		ink: [
			{ d: "M3 18V7A2 2 0 0 1 5 5H9.2L11.2 7.5H17A2 2 0 0 1 19 9.5V11" },
			{ d: "M3.2 18.4L6.1 12.2A2 2 0 0 1 7.9 11H20.4A1.2 1.2 0 0 1 21.5 12.6L19.2 18.7A2 2 0 0 1 17.3 20H4.6A1.5 1.5 0 0 1 3.2 18.4Z" },
		],
	},
	"folder-plus": {
		label: "Nova pasta",
		family: "glyph",
		ink: [{ d: FOLDER }, { d: join(line(12, 10.8, 12, 16.8), line(9, 13.8, 15, 13.8)), w: 0.8 }],
	},
	download: {
		label: "Baixar",
		family: "glyph",
		ink: [{ d: TRAY }, { d: line(12, 3.5, 12, 14.5), w: 0.95 }, { d: roundPoly([[7.5, 10], [12, 14.5], [16.5, 10]], 0.5, false), w: 0.95 }],
	},
	upload: {
		label: "Enviar arquivo",
		family: "glyph",
		ink: [{ d: TRAY }, { d: line(12, 15, 12, 4), w: 0.95 }, { d: roundPoly([[7.5, 8.5], [12, 4], [16.5, 8.5]], 0.5, false), w: 0.95 }],
	},
	"export-cards": {
		label: "Exportar cartões",
		family: "glyph",
		ink: [{ d: rrect(3, 8, 11, 13, 1.8) }, { d: line(11, 13, 19.5, 4.5), w: 0.9 }, { d: roundPoly([[13.8, 4.5], [19.5, 4.5], [19.5, 10.2]], 0.4, false), w: 0.9 }],
	},
	"export-notes": {
		label: "Exportar notas",
		family: "glyph",
		ink: [
			{ d: "M13 3H6.5A2 2 0 0 0 4.5 5V19A2 2 0 0 0 6.5 21H15.5A2 2 0 0 0 17.5 19V16.5" },
			{ d: join(line(9.5, 12, 20.5, 12), roundPoly([[17, 8.5], [20.5, 12], [17, 15.5]], 0.4, false)), w: 0.9 },
			{ d: line(8, 7.5, 12, 7.5), w: 0.75, detail: true },
		],
	},
	trash: {
		label: "Apagar",
		family: "glyph",
		ink: [
			{ d: line(3.5, 6.5, 20.5, 6.5) },
			{ d: join("M9 6.5V4.8A1.3 1.3 0 0 1 10.3 3.5H13.7A1.3 1.3 0 0 1 15 4.8V6.5", "M5.6 6.8L6.6 18.9A2 2 0 0 0 8.6 20.7H15.4A2 2 0 0 0 17.4 18.9L18.4 6.8") },
			{ d: join(line(10, 10.5, 10, 16.8), line(14, 10.5, 14, 16.8)), w: 0.75, detail: true },
		],
	},
	edit: {
		label: "Editar",
		family: "glyph",
		ink: [
			{ d: rotatePath("M3.6 12L7.6 9.6H20.2A1.4 1.4 0 0 1 20.2 14.4H7.6Z", -45, 12, 12, -0.4, 0.4) },
			{ d: rotatePath("M7.6 9.8V14.2M16.6 9.8V14.2", -45, 12, 12, -0.4, 0.4), w: 0.75 },
		],
	},
	copy: {
		label: "Copiar",
		family: "glyph",
		ink: [{ d: rrect(8.5, 8.5, 12.5, 12.5, 2) }, { d: "M15.5 5.5V5A2 2 0 0 0 13.5 3H5A2 2 0 0 0 3 5V13.5A2 2 0 0 0 5 15.5H5.5", w: 0.9 }],
	},
	pin: { label: "Fixar", family: "glyph", ink: [{ d: PIN_HEAD }, { d: PIN_BODY }, { d: line(12, 15.5, 12, 21), w: 0.9 }] },
	"pin-off": {
		label: "Desafixar",
		family: "glyph",
		ink: [{ d: PIN_HEAD }, { d: PIN_BODY }, { d: line(12, 15.5, 12, 21), w: 0.9 }, { d: line(3.5, 3.5, 20.5, 20.5), w: 0.9 }],
	},
	sync: {
		label: "Sincronizar",
		family: "glyph",
		ink: [
			{ d: join(arc(12, 12, 8, 195, 330), arrowHead(onCircle(12, 12, 8, 330), clockwiseTangent(330), 3.2, 40)) },
			{ d: join(arc(12, 12, 8, 15, 150), arrowHead(onCircle(12, 12, 8, 150), clockwiseTangent(150), 3.2, 40)) },
		],
	},
	theme: {
		label: "Tema",
		family: "glyph",
		ink: [{ d: "M12 3C6.8 3 3 6.9 3 11.6C3 16.6 7 20.6 12 20.6C13.4 20.6 14.1 19.7 14.1 18.7C14.1 17.5 13.1 17 13.1 15.9C13.1 14.7 14.1 14 15.3 14H17C19.5 14 21 12.4 21 10.2C21 6.1 17.1 3 12 3Z" }],
		dots: [[7.6, 11.8, 1.3], [9.4, 7.6, 1.3], [14.2, 6.9, 1.3], [17.4, 9.9, 1.2]],
	},
	keyboard: {
		label: "Teclado",
		family: "glyph",
		ink: [{ d: rrect(2.5, 6, 19, 12, 2.2) }, { d: line(7, 14.4, 17, 14.4), w: 0.8 }],
		dots: [[6.4, 10.1, 0.95], [10.1, 10.1, 0.95], [13.9, 10.1, 0.95], [17.6, 10.1, 0.95]],
	},
	plugin: {
		label: "Plugin",
		family: "glyph",
		ink: [{ d: "M5 8H8.8A2.3 2.3 0 1 1 13.2 8H17V11.8A2.3 2.3 0 1 1 17 16.2V20H5Z" }],
	},
	plug: {
		label: "Conectar",
		family: "glyph",
		ink: [
			{ d: "M6.5 8.5H17.5V11.5A5.5 5.5 0 0 1 6.5 11.5Z" },
			{ d: join(line(9.5, 3.5, 9.5, 8.5), line(14.5, 3.5, 14.5, 8.5)), w: 0.9 },
			{ d: line(12, 17, 12, 21), w: 0.9 },
		],
	},
	key: {
		label: "Chave",
		family: "glyph",
		ink: [{ d: circle(8, 16, 4.5) }, { d: line(11.3, 12.7, 20, 4) }, { d: join(line(15.6, 8.4, 18, 10.8), line(18.2, 5.8, 20.3, 7.9)), w: 0.85 }],
	},
	cost: {
		label: "Custo",
		family: "object",
		tone: "gold",
		fill: circle(12, 12, 8.8),
		ink: [{ d: circle(12, 12, 8.8) }, { d: circle(12, 12, 5.6), w: 0.65, detail: true }, { d: line(12, 9.2, 12, 14.8), w: 0.85 }],
	},
};

/** The dial points of a clock hand set (exported for review-due/clock). */
export const CLOCK_HANDS = (cx: number, cy: number, h = 4.5, m = 3.2): string => poly([[cx, cy - h], [cx, cy], [cx + m, cy + m * 0.55]] as XY[]);
