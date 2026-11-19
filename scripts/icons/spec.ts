/**
 * ICON SKELETON CONTRACT for the cel icon compiler (estudos-sota M8 —
 * SÍNTESE §2.12; r9 §7.2, §8). A skeleton is what a human (or a reviewed
 * LLM draft) writes by hand: pen CENTERLINES on the 24 px grid (48 for
 * display insignias) plus the closed silhouette that receives the flat
 * tones. The compiler turns it into the four cel layers:
 *
 *   fill   silhouette, base tone             (--icon-fill)
 *   shade  fill ∩ 45° terminator half-plane  (--icon-shade), bottom-right
 *   ink    perfect-freehand outline of every stroke + dots (currentColor);
 *          strokes entirely over the fill split off as on-fill ink
 *          (--cel-on-fill: text on color is always ink)
 *   hl     specular pills — ONLY on the XP gem, rank insignias / level
 *          badges and mastered nodes (r9 law 5; tests pin the set)
 *
 * Grid rules (r9 §8.1): live area 20×20 (2 px margin), ≥2 px between
 * distinct elements, ≤3 inner strokes, half-unit coordinates when possible.
 */

import type { IconTone } from "../../components/icons/tones.ts";

/** glyph = UI chrome, ink only; object = ink + tones; display = insignias (grid 48). */
export type IconFamily = "glyph" | "object" | "display";

/** One pen stroke set: every subpath of `d` is drawn as its own stroke;
 *  a subpath ending in Z is a closed loop (closed by overlap, r9 §7.2). */
export interface InkStroke {
	d: string;
	/** Width multiplier on the silhouette weight (2.1 at grid 24):
	 *  1 = silhouette, 0.75–0.85 = inner lines, 0.7 = detail. */
	w?: number;
	/** Dropped from the micro (≤16 px) variant (r9 §7.2 LOD rule). */
	detail?: boolean;
	/** Dash pattern [on, off] in grid units (e.g. the provisional node). */
	dash?: readonly [number, number];
}

/** A specular pill: center, radii, rotation in degrees (default −35). */
export type HighlightSpec = readonly [cx: number, cy: number, rx: number, ry: number, rot?: number];

/** An ink dot: center and radius (for "…", "!", "i", pips). */
export type DotSpec = readonly [cx: number, cy: number, r: number];

/** The terminator: a 45° line at signed distance `cut` from (cx, cy)
 *  (defaults: the silhouette's bbox center, and the cut that shades
 *  `area` of the silhouette — default 0.38, inside r9's 35–45 %). */
export interface LightSpec {
	cx?: number;
	cy?: number;
	cut?: number;
	area?: number;
}

export interface IconSpec {
	/** Accessible name in Brazilian Portuguese (the `title` default). */
	label: string;
	family: IconFamily;
	/** Default tone ramp of the fill/shade layers (components/icons/tones.ts);
	 *  absent = "accent" (the active domain's accent). */
	tone?: IconTone;
	/** Authoring grid; 48 for display insignias. Default 24. */
	grid?: 24 | 48;
	ink: readonly InkStroke[];
	dots?: readonly DotSpec[];
	/** Tone silhouette (closed subpaths). Objects only. */
	fill?: string;
	/** "evenodd" XORs the fill subpaths (rings, donuts). Default "nonzero" (union). */
	fillRule?: "nonzero" | "evenodd";
	/** Terminator placement; `false` = a flat single tone (no shade layer). */
	light?: LightSpec | false;
	hl?: readonly HighlightSpec[];
	/** Also emit two "boil" ink frames (seed + k·7919) for live states. */
	boil?: boolean;
	/** Emit a micro (≤16 px) ink variant even without detail strokes. */
	micro?: boolean;
}
