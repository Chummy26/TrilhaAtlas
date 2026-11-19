/**
 * GLYPHS — UI chrome skeletons, ink only (estudos-sota M8 — SÍNTESE §2.12;
 * r9 §9.1 P0 navigation/chrome and §8.3 "glyph" family). Drawn by hand on
 * the 24 px grid: centerlines inside [2.5, 21.5], ≥2 units between distinct
 * strokes, ≤3 inner strokes. Glyphs never carry tones or specular; at
 * ≤16 px they render the heavier `micro` ink.
 */

import { arc, arrowHead, circle, clockwiseTangent, join, line, link, onCircle, poly, rotate, rotatePath, roundPoly, rrect, shift, star, type XY } from "../shapes.ts";
import type { IconSpec } from "../spec.ts";

const CHEVRON: XY[] = [[9, 5.5], [15.5, 12], [9, 18.5]];
const chevron = (deg: number): string => roundPoly(rotate(CHEVRON, deg, 12, 12), 0.7, false);

const arrowRight = (deg: number): string =>
	join(poly(rotate([[4, 12], [19.5, 12]], deg, 12, 12)), roundPoly(rotate([[13, 5.5], [19.5, 12], [13, 18.5]], deg, 12, 12), 0.6, false));

/** A gear outline: `teeth` teeth between radii rIn/rOut. */
function gear(teeth: number, rIn: number, rOut: number): string {
	const pts: XY[] = [];
	const step = 360 / teeth;
	for (let i = 0; i < teeth; i++) {
		const c = i * step - 90;
		pts.push(onCircle(12, 12, rIn, c - step * 0.42), onCircle(12, 12, rOut, c - step * 0.22), onCircle(12, 12, rOut, c + step * 0.22), onCircle(12, 12, rIn, c + step * 0.42));
	}
	return roundPoly(pts, 0.7);
}

/** A graph of linked nodes: circles + trimmed links. */
function nodes(list: readonly (readonly [number, number, number])[], links: readonly (readonly [number, number])[]): { circles: string; links: string } {
	return {
		circles: join(...list.map(([x, y, r]) => circle(x, y, r))),
		links: join(...links.map(([a, b]) => link([list[a]![0], list[a]![1]], [list[b]![0], list[b]![1]], list[a]![2], list[b]![2], 0.9))),
	};
}

const MAP = nodes([[6, 6.5, 2.6], [18, 9, 2.6], [9.5, 18, 2.6]], [[0, 1], [0, 2], [1, 2]]);
const GRAPH = nodes([[5.5, 5.5, 2.2], [18.5, 5.5, 2.2], [12, 12.5, 2.4], [5.5, 18.5, 2.2], [18.5, 18.5, 2.2]], [[0, 2], [1, 2], [2, 3], [2, 4], [1, 4]]);

/** A pencil along −45°: tip, cone shoulders, body end (local x-axis
 *  pencil rotated about the center, nudged toward the top-left). */
const PENCIL: XY[] = shift(rotate([[3, 12], [7.5, 9.6], [20.5, 9.6], [20.5, 14.4], [7.5, 14.4]], -45, 12, 12), -1.6, -1.6);

const sparkle = (cx: number, cy: number, R: number): string => roundPoly(star(cx, cy, R, R * 0.34, 4), 0.25);

export const GLYPHS: Record<string, IconSpec> = {
	home: {
		label: "Início",
		family: "glyph",
		ink: [
			{ d: roundPoly([[3, 11], [12, 3.5], [21, 11]], 1.2, false) },
			{ d: "M5.5 9.8V18.5a2 2 0 0 0 2 2H16.5a2 2 0 0 0 2-2V9.8" },
			{ d: "M10 20.5V16a2 2 0 0 1 4 0v4.5", w: 0.8 },
		],
	},
	map: { label: "Mapa", family: "glyph", ink: [{ d: MAP.circles }, { d: MAP.links, w: 0.85 }] },
	graph: { label: "Grafo", family: "glyph", ink: [{ d: GRAPH.circles }, { d: GRAPH.links, w: 0.8 }] },
	lesson: {
		label: "Aula",
		family: "glyph",
		ink: [
			{ d: "M12 10.2C10 8.8 6.8 8.4 3.5 8.9V19.4C6.8 18.9 10 19.3 12 20.7C14 19.3 17.2 18.9 20.5 19.4V8.9C17.2 8.4 14 8.8 12 10.2Z" },
			{ d: line(12, 10.6, 12, 20), w: 0.75 },
			{ d: sparkle(12, 4.2, 2.4), w: 0.7 },
		],
	},
	practice: {
		label: "Praticar",
		family: "glyph",
		ink: [
			{ d: roundPoly(PENCIL, 0.6) },
			{ d: poly([PENCIL[1]!, PENCIL[4]!]), w: 0.75 },
			{ d: roundPoly([[13.5, 18], [15.6, 20.1], [20.3, 15.4]], 0.5, false), w: 0.95 },
		],
	},
	review: {
		label: "Revisar",
		family: "glyph",
		ink: [
			{ d: rrect(3.5, 6.5, 13.5, 14.5, 2) },
			{ d: "M7.5 3.5H18.5A2 2 0 0 1 20.5 5.5V16.5", w: 0.85 },
			{ d: join(arc(10.25, 13.75, 3.3, -40, 215), arrowHead(onCircle(10.25, 13.75, 3.3, 215), clockwiseTangent(215), 2.2, 45)), w: 0.75 },
		],
	},
	search: { label: "Buscar", family: "glyph", ink: [{ d: circle(10.5, 10.5, 6.5) }, { d: line(15.4, 15.4, 20.5, 20.5) }] },
	settings: { label: "Configurações", family: "glyph", ink: [{ d: gear(6, 7.1, 9.4) }, { d: circle(12, 12, 3) }] },
	profile: {
		label: "Perfil",
		family: "glyph",
		ink: [{ d: circle(12, 8, 4.3) }, { d: "M4.5 20.5V19.5A5.5 5.5 0 0 1 10 14H14A5.5 5.5 0 0 1 19.5 19.5V20.5" }],
	},
	stats: {
		label: "Estatísticas",
		family: "glyph",
		ink: [{ d: "M3.5 3.5V18.5A2 2 0 0 0 5.5 20.5H20.5" }, { d: join(line(8.5, 16.5, 8.5, 12), line(13, 16.5, 13, 7), line(17.5, 16.5, 17.5, 10)), w: 1.15 }],
	},
	close: { label: "Fechar", family: "glyph", ink: [{ d: line(6, 6, 18, 18) }, { d: line(18, 6, 6, 18) }] },
	"chevron-right": { label: "Avançar", family: "glyph", ink: [{ d: chevron(0) }] },
	"chevron-down": { label: "Expandir", family: "glyph", ink: [{ d: chevron(90) }] },
	"chevron-left": { label: "Voltar", family: "glyph", ink: [{ d: chevron(180) }] },
	"chevron-up": { label: "Recolher", family: "glyph", ink: [{ d: chevron(270) }] },
	plus: { label: "Adicionar", family: "glyph", ink: [{ d: line(12, 4.5, 12, 19.5) }, { d: line(4.5, 12, 19.5, 12) }] },
	minus: { label: "Remover", family: "glyph", ink: [{ d: line(4.5, 12, 19.5, 12) }] },
	check: { label: "Feito", family: "glyph", ink: [{ d: roundPoly([[4.5, 12.5], [9.5, 17.5], [19.5, 6.5]], 0.8, false) }] },
	more: { label: "Mais opções", family: "glyph", ink: [], dots: [[5.5, 12, 1.7], [12, 12, 1.7], [18.5, 12, 1.7]] },
	send: { label: "Enviar", family: "glyph", ink: [{ d: line(12, 19.5, 12, 5) }, { d: roundPoly([[5.5, 11.5], [12, 5], [18.5, 11.5]], 0.7, false) }] },
	enter: {
		label: "Confirmar",
		family: "glyph",
		ink: [{ d: "M19.5 4.5V11A4 4 0 0 1 15.5 15H5" }, { d: roundPoly([[9.5, 10.5], [5, 15], [9.5, 19.5]], 0.6, false) }],
	},
	attach: {
		label: "Anexar",
		family: "glyph",
		ink: [{ d: rotatePath("M13.6 8.2V16A1.8 1.8 0 0 1 10 16V5.8A3.2 3.2 0 0 1 16.4 5.8V16.6A4.4 4.4 0 0 1 7.6 16.6V9", 40) }],
	},
	mic: {
		label: "Microfone",
		family: "glyph",
		boil: true,
		ink: [{ d: rrect(8.8, 3, 6.4, 11.5, 3.2) }, { d: "M5.5 11.5A6.5 6.5 0 0 0 18.5 11.5", w: 0.9 }, { d: line(12, 18, 12, 21), w: 0.9 }],
	},
	sidebar: { label: "Painel lateral", family: "glyph", ink: [{ d: rrect(3, 4, 18, 16, 2.5) }, { d: line(9, 4.5, 9, 19.5), w: 0.85 }] },
	"sidebar-open": {
		label: "Abrir painel",
		family: "glyph",
		ink: [{ d: rrect(3, 4, 18, 16, 2.5) }, { d: line(9, 4.5, 9, 19.5), w: 0.85 }, { d: roundPoly([[13, 9], [16, 12], [13, 15]], 0.4, false), w: 0.8, detail: true }],
	},
	"sidebar-close": {
		label: "Fechar painel",
		family: "glyph",
		ink: [{ d: rrect(3, 4, 18, 16, 2.5) }, { d: line(9, 4.5, 9, 19.5), w: 0.85 }, { d: roundPoly([[16, 9], [13, 12], [16, 15]], 0.4, false), w: 0.8, detail: true }],
	},
	"domain-switch": {
		label: "Trocar domínio",
		family: "glyph",
		ink: [
			{ d: join(line(4, 8, 19, 8), roundPoly([[15, 4], [19, 8], [15, 12]], 0.5, false)) },
			{ d: join(line(20, 16, 5, 16), roundPoly([[9, 12], [5, 16], [9, 20]], 0.5, false)) },
		],
	},
	warning: {
		label: "Atenção",
		family: "glyph",
		ink: [{ d: roundPoly([[12, 3.5], [21.5, 20], [2.5, 20]], 1.8) }, { d: line(12, 9.5, 12, 13.8), w: 0.95 }],
		dots: [[12, 16.8, 1.25]],
	},
	error: {
		label: "Erro",
		family: "glyph",
		ink: [{ d: circle(12, 12, 9) }, { d: join(line(9, 9, 15, 15), line(15, 9, 9, 15)), w: 0.9 }],
	},
	info: { label: "Informação", family: "glyph", ink: [{ d: circle(12, 12, 9) }, { d: line(12, 11, 12, 16.5), w: 0.95 }], dots: [[12, 7.8, 1.25]] },
	help: {
		label: "Ajuda",
		family: "glyph",
		ink: [{ d: circle(12, 12, 9) }, { d: "M9.4 9.6A2.7 2.7 0 1 1 13 12.1C12.4 12.4 12 12.9 12 13.7V14", w: 0.9 }],
		dots: [[12, 17, 1.2]],
	},
	play: { label: "Reproduzir", family: "glyph", ink: [{ d: roundPoly([[7, 4.5], [19.5, 12], [7, 19.5]], 1.6) }] },
	pause: { label: "Pausar", family: "glyph", ink: [{ d: join(line(8.5, 5, 8.5, 19), line(15.5, 5, 15.5, 19)), w: 1.2 }] },
	next: { label: "Próximo", family: "glyph", ink: [{ d: roundPoly([[5, 5], [15, 12], [5, 19]], 1.3) }, { d: line(19, 5, 19, 19) }] },
	stop: { label: "Parar", family: "glyph", ink: [{ d: rrect(5.5, 5.5, 13, 13, 2.5) }] },
	maximize: {
		label: "Maximizar",
		family: "glyph",
		ink: [
			{ d: join(poly([[3.5, 9], [3.5, 3.5], [9, 3.5]]), poly([[15, 3.5], [20.5, 3.5], [20.5, 9]])) },
			{ d: join(poly([[20.5, 15], [20.5, 20.5], [15, 20.5]]), poly([[9, 20.5], [3.5, 20.5], [3.5, 15]])) },
		],
	},
	loader: { label: "Carregando", family: "glyph", boil: true, ink: [{ d: arc(12, 12, 8, -80, 200) }] },
	"arrow-right": { label: "Seta para a direita", family: "glyph", ink: [{ d: arrowRight(0) }] },
	"arrow-down": { label: "Seta para baixo", family: "glyph", ink: [{ d: arrowRight(90) }] },
	"arrow-up-right": {
		label: "Abrir fora",
		family: "glyph",
		ink: [{ d: line(6, 18, 18, 6) }, { d: roundPoly([[8.5, 6], [18, 6], [18, 15.5]], 0.6, false) }],
	},
	"list-tree": {
		label: "Cadeias",
		family: "glyph",
		ink: [
			{ d: join(line(9, 5.5, 20.5, 5.5), line(13, 12, 20.5, 12), line(13, 18.5, 20.5, 18.5)), w: 0.9 },
			{ d: "M4 3.5V16.5A2 2 0 0 0 6 18.5H9M4 10A2 2 0 0 0 6 12H9", w: 0.85 },
		],
	},
	activity: {
		label: "Atividade",
		family: "glyph",
		ink: [{ d: roundPoly([[2.5, 12], [6.5, 12], [9, 5], [14.5, 19], [17, 12], [21.5, 12]], 0.6, false) }],
	},
	quote: {
		label: "Citação",
		family: "glyph",
		ink: [{ d: join("M8.6 10.2C8.9 13.6 7.6 16.2 4.8 17.8", "M17.4 10.2C17.7 13.6 16.4 16.2 13.6 17.8"), w: 0.95 }],
		dots: [[6.6, 9.6, 2.4], [15.4, 9.6, 2.4]],
	},
	bot: {
		label: "Agente",
		family: "glyph",
		ink: [{ d: rrect(4, 8.5, 16, 12, 3.5) }, { d: line(12, 8.5, 12, 5.5), w: 0.85 }],
		dots: [[12, 4.3, 1.3], [9, 14.2, 1.3], [15, 14.2, 1.3]],
	},
	"drag-handle": {
		label: "Arrastar",
		family: "glyph",
		ink: [],
		dots: [[9, 5.5, 1.5], [15, 5.5, 1.5], [9, 12, 1.5], [15, 12, 1.5], [9, 18.5, 1.5], [15, 18.5, 1.5]],
	},
};
