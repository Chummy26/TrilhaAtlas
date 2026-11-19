/**
 * NODE STATES — the knowledge-graph node vocabulary (estudos-sota M8 —
 * SÍNTESE §2.12 "os estados de nó no canvas são formas", §2.14; r3 §10;
 * r9 §9.1 P0 #23–#27, §9.2 P1 #41–#44, §11). Law 6, shape before color:
 * every state has its own silhouette, so the legend reads in grayscale and
 * for color-blind learners:
 *
 *   locked        padlock
 *   available     ring with a center dot (open, empty)
 *   learning      ring half filled (progress)
 *   review-due    clock with a looping arrow
 *   mastered      solid disc + check + specular (the only shiny state)
 *   frontier      solid disc inside a halo ring (recommended next)
 *   stub          a node sinking into fog banks (not explored yet)
 *   provisional   dashed ring (proposed, not validated)
 *   rusty         cracked disc with rust specks (mastered, decaying)
 *   new           four-point sparkle (just unlocked)
 */

import { arc, arrowHead, circle, clockwiseTangent, curve, join, line, onCircle, poly, roundPoly, rrect, star } from "../shapes.ts";
import type { IconSpec } from "../spec.ts";

const NODE = circle(12, 12, 8.6);
const LOCK_BODY = rrect(5, 10.5, 14, 10, 2.2);

export const NODES: Record<string, IconSpec> = {
	"node-locked": {
		label: "Nó bloqueado",
		family: "object",
		tone: "neutral",
		fill: LOCK_BODY,
		light: false,
		ink: [{ d: LOCK_BODY }, { d: "M8 10.5V7.5A4 4 0 0 1 16 7.5V10.5", w: 0.95 }, { d: line(12, 15.2, 12, 17.4), w: 0.8 }],
		dots: [[12, 14.8, 1.25]],
	},
	"node-available": {
		label: "Nó disponível",
		family: "object",
		tone: "neutral",
		fill: NODE,
		light: false,
		ink: [{ d: NODE }],
		dots: [[12, 12, 2.3]],
	},
	"node-learning": {
		label: "Nó em estudo",
		family: "object",
		fill: "M12 3.4A8.6 8.6 0 0 1 12 20.6Z",
		light: false,
		ink: [{ d: NODE }, { d: line(12, 4, 12, 20), w: 0.75 }],
	},
	"review-due": {
		label: "Revisão pendente",
		family: "object",
		tone: "warning",
		fill: circle(12, 12, 8.6),
		ink: [
			{ d: join(arc(12, 12, 8.6, -95, 205), arrowHead(onCircle(12, 12, 8.6, 205), clockwiseTangent(205), 3.4, 42)) },
			{ d: poly([[12, 7.4], [12, 12], [15.2, 13.8]]), w: 0.85 },
		],
	},
	"node-mastered": {
		label: "Nó dominado",
		family: "object",
		tone: "success",
		fill: NODE,
		ink: [{ d: NODE }, { d: roundPoly([[8, 12.3], [10.7, 15], [16.2, 9.4]], 0.6, false), w: 1.05 }],
		hl: [[8.2, 7.7, 1.6, 0.85]],
	},
	"node-frontier": {
		label: "Nó de fronteira",
		family: "object",
		fill: circle(12, 12, 5.4),
		ink: [{ d: circle(12, 12, 5.4) }, { d: circle(12, 12, 9.3, -60), w: 0.72 }],
	},
	"node-stub": {
		label: "Nó inexplorado",
		family: "object",
		ink: [
			{ d: arc(12, 11, 7.2, 192, 348), w: 0.9 },
			{ d: join(curve([[3, 13.4], [6.5, 12.4], [10, 13.6], [13.5, 12.4], [17, 13.6], [21, 12.6]], 1), curve([[5, 17], [8.5, 16], [12, 17.2], [15.5, 16], [19, 17]], 1)), w: 0.8 },
			{ d: curve([[8, 20.5], [11, 19.7], [14, 20.6], [16.5, 19.9]], 1), w: 0.7, detail: true },
		],
	},
	"node-provisional": {
		label: "Nó provisório",
		family: "object",
		tone: "neutral",
		fill: NODE,
		light: false,
		ink: [{ d: NODE, dash: [3.1, 2.3] }],
		dots: [[12, 12, 1.5]],
	},
	"node-rusty": {
		label: "Nó enferrujado",
		family: "object",
		tone: "bronze",
		fill: NODE,
		ink: [{ d: NODE }, { d: roundPoly([[11.2, 3.6], [12.6, 7.4], [10.6, 10.2], [12.8, 13.4]], 0.4, false), w: 0.72 }],
		dots: [[15.6, 15.4, 0.95], [8.4, 15.8, 0.8], [16.2, 9.6, 0.7]],
	},
	"node-new": {
		label: "Nó novo",
		family: "object",
		fill: roundPoly(star(12, 12, 9.6, 3.4, 4), 0.6),
		ink: [{ d: roundPoly(star(12, 12, 9.6, 3.4, 4), 0.6) }],
	},
	prerequisite: {
		label: "Pré-requisito",
		family: "glyph",
		ink: [
			{ d: join(circle(5.8, 17.8, 2.6), circle(18.2, 6.2, 2.6)) },
			{ d: join(curve([[8.2, 15.6], [10.8, 10.2], [14.4, 8.4]], 1), arrowHead([14.6, 8.3], -20, 2.8, 40)), w: 0.85 },
		],
	},
	"expand-graph": {
		label: "Expandir grafo",
		family: "object",
		tone: "mint",
		fill: join("M11.6 13.2C8.1 13.6 5.2 11.6 4.7 7.6C8.5 7.3 11.2 9.4 11.6 13.2Z", "M12.4 11.2C12.7 7.6 15.4 5.2 19.3 5.2C19.5 9.2 16.6 11.6 12.4 11.2Z"),
		ink: [
			{ d: join("M11.6 13.2C8.1 13.6 5.2 11.6 4.7 7.6C8.5 7.3 11.2 9.4 11.6 13.2Z", "M12.4 11.2C12.7 7.6 15.4 5.2 19.3 5.2C19.5 9.2 16.6 11.6 12.4 11.2Z") },
			{ d: "M12 21V12.2", w: 0.9 },
			{ d: join(line(17.6, 15.2, 17.6, 20.8), line(14.8, 18, 20.4, 18)), w: 0.8 },
		],
	},
	frontier: {
		label: "Próximo recomendado",
		family: "object",
		fill: "M6 4H18L15.2 8.2L18 12.4H6Z",
		ink: [{ d: line(6, 3.2, 6, 21) }, { d: roundPoly([[6, 4], [18, 4], [15.2, 8.2], [18, 12.4], [6, 12.4]], 0.5, false) }],
	},
	"weak-spot": {
		label: "Ponto fraco",
		family: "object",
		tone: "coral",
		fill: "M4.2 14.9L14.9 4.2A2.9 2.9 0 0 1 19.8 9.1L9.1 19.8A2.9 2.9 0 0 1 4.2 14.9Z",
		ink: [
			{ d: "M4.2 14.9L14.9 4.2A2.9 2.9 0 0 1 19.8 9.1L9.1 19.8A2.9 2.9 0 0 1 4.2 14.9Z" },
			{ d: roundPoly([[12, 8.9], [15.1, 12], [12, 15.1], [8.9, 12]], 0.5), w: 0.7 },
			{ d: roundPoly([[3.2, 6.4], [5.5, 7], [5.9, 9.3], [7.8, 9.9]], 0.3, false), w: 0.65 },
		],
		dots: [[7.6, 15, 0.6], [15, 7.6, 0.6]],
	},
};
