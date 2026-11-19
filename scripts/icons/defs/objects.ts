/**
 * OBJECTS — domains and study resources (estudos-sota M8 — SÍNTESE §2.12;
 * r9 §9.1 P0 #20–#22, #28–#31 and §9.2 P1 #34–#38, #51, #53, #56, #57).
 * Ink + flat tones (fill = silhouette, shade = past the 45° terminator,
 * light from the top-left). No specular here: r9 law 5 keeps it for the
 * XP gem, rank badges and mastered nodes (progress.ts, nodes.ts,
 * insignias.ts).
 *
 * Domain emblems use fixed ramps (volt = Eletrônica, coral = Inglês, r9
 * §4.4) so they keep their color wherever they appear; resources follow
 * the active domain's accent.
 */

import { circle, curve, join, line, onCircle, poly, regular, roundPoly, rrect, star } from "../shapes.ts";
import type { IconSpec } from "../spec.ts";

const BOLT = roundPoly([[13.5, 2.5], [5, 13.5], [11, 13.5], [9.5, 21.5], [18, 10.5], [12, 10.5]], 0.6);
const BALLOON = "M7 3.5H17A4 4 0 0 1 21 7.5V13A4 4 0 0 1 17 17H10.8L6 20.8V16.8A4 4 0 0 1 3 13V7.5A4 4 0 0 1 7 3.5Z";
const BOOK = "M6.5 3H20V21H6.5A2.5 2.5 0 0 1 4 18.5V5.5A2.5 2.5 0 0 1 6.5 3Z";
const OPEN_BOOK = "M12 7.2C10 5.8 6.8 5.4 3.5 5.9V17.9C6.8 17.4 10 17.8 12 19.2C14 17.8 17.2 17.4 20.5 17.9V5.9C17.2 5.4 14 5.8 12 7.2Z";
const SCREEN = "M5 4H19A2.5 2.5 0 0 1 21.5 6.5V14.5A2.5 2.5 0 0 1 19 17H5A2.5 2.5 0 0 1 2.5 14.5V6.5A2.5 2.5 0 0 1 5 4Z";
const NOTE_PAGE = "M5.5 8.5H11.5L15 12V19A2 2 0 0 1 13 21H5.5A2 2 0 0 1 3.5 19V10.5A2 2 0 0 1 5.5 8.5Z";
const BULB = "M9.2 16.5C9.2 14.6 6.5 13.3 6.5 9.6A5.5 5.5 0 0 1 17.5 9.6C17.5 13.3 14.8 14.6 14.8 16.5Z";
const CLIPBOARD = rrect(4.5, 4.5, 15, 17, 2);
const LAYER_TOP = roundPoly([[12, 3], [21, 7.8], [12, 12.6], [3, 7.8]], 0.9);

const sparkle = (cx: number, cy: number, R: number) => roundPoly(star(cx, cy, R, R * 0.36, 4), 0.3);

/** Chip pins: two per side, outside the body (x/y 6 … 18). */
const CHIP_PINS = join(
	...[9.5, 14.5].flatMap((v) => [line(v, 2.8, v, 5.6), line(v, 18.4, v, 21.2), line(2.8, v, 5.6, v), line(18.4, v, 21.2, v)]),
);

export const OBJECTS: Record<string, IconSpec> = {
	"domain-electronics": {
		label: "Eletrônica",
		family: "object",
		tone: "volt",
		fill: BOLT,
		ink: [{ d: BOLT }],
	},
	"domain-english": {
		label: "Inglês",
		family: "object",
		tone: "coral",
		fill: BALLOON,
		ink: [
			{ d: BALLOON },
			{ d: join(poly([[6.4, 13.9], [8.85, 7.2], [11.3, 13.9]]), line(7.35, 11.6, 10.35, 11.6)), w: 0.66 },
			{ d: join(circle(15.1, 11.75, 1.95, 200), line(17.05, 9.6, 17.05, 13.9)), w: 0.66 },
		],
	},
	"domain-generic": {
		label: "Domínio",
		family: "object",
		fill: circle(12, 12, 9),
		ink: [{ d: circle(12, 12, 9) }, { d: roundPoly([[16, 8], [13.4, 13.4], [8, 16], [10.6, 10.6]], 0.4), w: 0.85 }],
		dots: [[12, 12, 0.9]],
	},
	resistor: {
		label: "Resistor",
		family: "glyph",
		ink: [{ d: roundPoly([[2.5, 12], [5.8, 12], [7.3, 8], [9.8, 16], [12.3, 8], [14.8, 16], [16.7, 8], [18.2, 12], [21.5, 12]], 0.35, false) }],
	},
	wave: {
		label: "Onda",
		family: "glyph",
		ink: [{ d: curve([[2.5, 12], [5.2, 6.8], [9.6, 6.8], [12, 12], [14.4, 17.2], [18.8, 17.2], [21.5, 12]], 1) }],
	},
	book: {
		label: "Livro",
		family: "object",
		fill: BOOK,
		ink: [
			{ d: BOOK },
			{ d: "M20 16.5H6.5A2.25 2.25 0 0 0 4.2 18.6", w: 0.8 },
			{ d: join(line(9, 7.5, 15.5, 7.5), line(9, 10.5, 13.5, 10.5)), w: 0.72, detail: true },
		],
	},
	chapter: {
		label: "Capítulo",
		family: "object",
		fill: OPEN_BOOK,
		ink: [{ d: OPEN_BOOK }, { d: line(12, 7.8, 12, 18.6), w: 0.75 }, { d: "M15.2 6.6V12.6L16.7 11.4L18.2 12.6V6.3", w: 0.72 }],
	},
	video: {
		label: "Vídeo",
		family: "object",
		tone: "sky",
		fill: SCREEN,
		ink: [{ d: SCREEN }, { d: line(8.5, 20.5, 15.5, 20.5), w: 0.9 }, { d: roundPoly([[10, 7.6], [15, 10.5], [10, 13.4]], 0.5), w: 0.8 }],
	},
	"ai-explain": {
		label: "Explicação da IA",
		family: "object",
		tone: "sky",
		fill: join(NOTE_PAGE, sparkle(17.6, 6.2, 3.9)),
		ink: [
			{ d: NOTE_PAGE },
			{ d: sparkle(17.6, 6.2, 3.9), w: 0.85 },
			{ d: join(line(6.2, 14, 11.8, 14), line(6.2, 17.2, 10, 17.2)), w: 0.7, detail: true },
		],
	},
	flashcard: {
		label: "Flashcard",
		family: "object",
		fill: rrect(4, 7, 14, 13, 1.5),
		ink: [
			{ d: rrect(4, 7, 14, 13, 1.5) },
			{ d: "M7.5 4H18.5A1.5 1.5 0 0 1 20 5.5V16", w: 0.85 },
			{ d: join(line(7.5, 12, 14.5, 12), line(7.5, 15, 11.5, 15)), w: 0.72, detail: true },
		],
	},
	deck: {
		label: "Baralho",
		family: "object",
		fill: rrect(3, 9.5, 13, 11.5, 1.6),
		ink: [
			{ d: rrect(3, 9.5, 13, 11.5, 1.6) },
			{ d: "M6.2 6.5H17.4A1.6 1.6 0 0 1 19 8.1V17.5", w: 0.82 },
			{ d: "M9.4 3.5H19.4A1.6 1.6 0 0 1 21 5.1V14", w: 0.72 },
		],
	},
	exercise: {
		label: "Exercício",
		family: "object",
		fill: CLIPBOARD,
		ink: [
			{ d: CLIPBOARD },
			{ d: rrect(8.5, 2.5, 7, 4, 1.3), w: 0.85 },
			{ d: roundPoly([[8.5, 13.6], [11, 16.1], [15.6, 11.4]], 0.4, false), w: 0.9 },
		],
	},
	subtitles: {
		label: "Legendas",
		family: "glyph",
		ink: [{ d: rrect(2.5, 5, 19, 14, 2.5) }, { d: join(line(6.5, 10.6, 17.5, 10.6), line(6.5, 14.4, 13.5, 14.4)), w: 0.8 }],
	},
	"audio-dub": {
		label: "Dublagem",
		family: "glyph",
		ink: [
			{ d: roundPoly([[3.5, 9.5], [7, 9.5], [11.5, 5.5], [11.5, 18.5], [7, 14.5], [3.5, 14.5]], 0.6) },
			{ d: join("M15 9.2A4 4 0 0 1 15 14.8", "M17.8 6.4A8 8 0 0 1 17.8 17.6"), w: 0.85 },
		],
	},
	memory: {
		label: "Memória",
		family: "object",
		tone: "teal",
		fill: LAYER_TOP,
		ink: [{ d: LAYER_TOP }, { d: join(poly([[3, 12.2], [12, 17], [21, 12.2]]), poly([[3, 16.4], [12, 21.2], [21, 16.4]])), w: 0.85 }],
		dots: [[12, 7.8, 1.15]],
	},
	insight: {
		label: "Dica",
		family: "object",
		tone: "volt",
		fill: BULB,
		ink: [
			{ d: BULB },
			{ d: join(line(9.4, 18.9, 14.6, 18.9), line(10.4, 21.2, 13.6, 21.2)), w: 0.85 },
			{ d: poly([[10.4, 13], [12, 11.2], [13.6, 13]]), w: 0.62, detail: true },
		],
	},
	model: {
		label: "Modelo",
		family: "object",
		tone: "sky",
		fill: rrect(6, 6, 12, 12, 2),
		ink: [{ d: rrect(6, 6, 12, 12, 2) }, { d: CHIP_PINS, w: 0.75 }, { d: sparkle(12, 12, 3.2), w: 0.6 }],
	},
	tokens: {
		label: "Tokens",
		family: "object",
		tone: "teal",
		fill: roundPoly(regular(12, 12, 9.2, 6, -90), 1.2),
		ink: [
			{ d: roundPoly(regular(12, 12, 9.2, 6, -90), 1.2) },
			{ d: roundPoly(regular(12, 12, 4.6, 6, -90), 0.6), w: 0.7 },
			{ d: join(...[-60, 60, 180].map((a) => line(...onCircle(12, 12, 6.2, a), ...onCircle(12, 12, 7.9, a)))), w: 0.6, detail: true },
		],
	},
};
