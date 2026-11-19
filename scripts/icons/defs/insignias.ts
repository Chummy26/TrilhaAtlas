/**
 * RANK INSIGNIAS — 7 tier shapes × 3 division pips (estudos-sota M8 —
 * SÍNTESE §2.11–§2.12; r9 §9.4). Display family on the 48 grid (the
 * compiler doubles every pen length, so at 48 px the silhouette is r9's
 * 4 px display stroke). SHAPE is the primary cue (law 6) — T1 circle, T2
 * rounded diamond, T3 shield, T4 winged shield, T5 hexagon, T6 star, T7
 * star with laurels — and the metal (bronze … ruby, ink ≥5.6:1 on every
 * base) is the redundant secondary cue. The division is 1–3 ink pips under
 * the shape. Tier names are the owner's call (r9 §14 q5), so labels say
 * only "tier N · divisão D".
 */

import { arc, circle, join, mirrorX, onCircle, roundPoly, regular, star, type XY } from "../shapes.ts";
import type { IconSpec, InkStroke, HighlightSpec } from "../spec.ts";
import { METAL_TONES } from "../../../components/icons/tones.ts";

interface TierShape {
	fill: string;
	ink: InkStroke[];
	hl: HighlightSpec;
}

const SHIELD = "M24 3.5L39.5 9V19.5C39.5 28.2 33.2 33.8 24 37C14.8 33.8 8.5 28.2 8.5 19.5V9Z";
const SMALL_SHIELD = "M24 6.5L32.5 9.8V19C32.5 25.5 29 29.8 24 32.4C19 29.8 15.5 25.5 15.5 19V9.8Z";
const WING: XY[] = [[15.8, 11.2], [4.5, 8.4], [6, 14.2], [9.6, 15.2], [7.6, 19.6], [11.8, 20.2], [10.8, 24.2], [15.8, 23.6]];

/** Laurel leaves: thick tapered dabs off the wreath arc, leaning up it
 *  (the pen's taper turns each dab into an almond). */
function laurelLeaves(leaves: readonly number[], lean: number): string {
	return join(
		...leaves.map((a) => {
			const [x1, y1] = onCircle(24, 19, 16.2, a);
			const [x2, y2] = onCircle(24, 19, 19.8, a + lean);
			return `M${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}`;
		}),
	);
}

const SHAPES: readonly TierShape[] = [
	{
		fill: circle(24, 20, 15.5),
		ink: [{ d: circle(24, 20, 15.5) }, { d: circle(24, 20, 10.4, -60), w: 0.55 }],
		hl: [16, 11.6, 3, 1.3, -40],
	},
	{
		fill: roundPoly([[24, 3.5], [40.5, 20], [24, 36.5], [7.5, 20]], 3.5),
		ink: [{ d: roundPoly([[24, 3.5], [40.5, 20], [24, 36.5], [7.5, 20]], 3.5) }, { d: roundPoly([[24, 10.5], [33.5, 20], [24, 29.5], [14.5, 20]], 2), w: 0.55 }],
		hl: [18.4, 12.6, 2.6, 1.1, -45],
	},
	{
		fill: SHIELD,
		ink: [{ d: SHIELD }, { d: roundPoly([[15.5, 17], [24, 22.6], [32.5, 17]], 1, false), w: 0.7 }],
		hl: [14.8, 11.4, 2.8, 1.2, -40],
	},
	{
		fill: join(SMALL_SHIELD, roundPoly(WING, 1.2), roundPoly(mirrorX(WING, 24), 1.2)),
		ink: [
			{ d: SMALL_SHIELD },
			{ d: join(roundPoly(WING, 1.2, false), roundPoly(mirrorX(WING, 24), 1.2, false)), w: 0.85 },
			{ d: roundPoly([[19.5, 16.5], [24, 19.6], [28.5, 16.5]], 0.6, false), w: 0.6 },
		],
		hl: [19.8, 11.6, 2.2, 1, -40],
	},
	{
		fill: roundPoly(regular(24, 20, 17, 6, -90), 3),
		ink: [{ d: roundPoly(regular(24, 20, 17, 6, -90), 3) }, { d: roundPoly(regular(24, 20, 10.8, 6, -90), 1.6), w: 0.55 }],
		hl: [15.4, 11.8, 2.8, 1.2, -32],
	},
	{
		fill: roundPoly(star(24, 21, 18, 8.4, 5, -90), 2),
		ink: [{ d: roundPoly(star(24, 21, 18, 8.4, 5, -90), 2) }],
		hl: [20.6, 13.2, 2.2, 1, -55],
	},
	{
		fill: roundPoly(star(24, 17.5, 12.5, 5.9, 5, -90), 1.6),
		ink: [
			{ d: roundPoly(star(24, 17.5, 12.5, 5.9, 5, -90), 1.6) },
			{ d: join(arc(24, 19, 16, 118, 222), arc(24, 19, 16, -42, 62)), w: 0.6 },
			{ d: join(laurelLeaves([126, 150, 174, 198], 20), laurelLeaves([54, 30, 6, -18], -20)), w: 0.95 },
		],
		hl: [21.2, 11.8, 1.7, 0.8, -55],
	},
];

/** Pip centers for a division (1–3), centered under the shape. */
function pips(division: number): [number, number, number][] {
	return Array.from({ length: division }, (_, i) => [24 + (i - (division - 1) / 2) * 7.5, 42.6, 2.3]);
}

function insignias(): Record<string, IconSpec> {
	const out: Record<string, IconSpec> = {};
	SHAPES.forEach((shape, t) => {
		for (let d = 1; d <= 3; d++) {
			out[`insignia-${t + 1}-${d}`] = {
				label: `Insígnia tier ${t + 1} · divisão ${d}`,
				family: "display",
				grid: 48,
				tone: METAL_TONES[t]!,
				fill: shape.fill,
				ink: shape.ink,
				dots: pips(d),
				hl: [shape.hl],
			};
		}
	});
	return out;
}

export const INSIGNIAS: Record<string, IconSpec> = insignias();
