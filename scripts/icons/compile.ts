/**
 * THE CEL ICON COMPILER (estudos-sota M8 — SÍNTESE §2.12; r9 §7.2–§7.4, §8).
 * Turns hand-written skeletons (scripts/icons/defs/*.ts: pen centerlines on
 * the 24 px grid, 48 for insignias) into "hand-inked" cel art,
 * DETERMINISTICALLY — the same defs always produce byte-identical output:
 *
 *   1. every subpath is flattened and resampled every 0.3 grid units
 *      (path.ts; subpaths stay separate — no phantom "Z" bridges);
 *   2. low-frequency wobble: 1-D value noise along the arc length (knots
 *      every 7 units, cosine interpolation), 0.22 units along the normal;
 *   3. synthetic pressure 0.5 ± 0.12 from a second noise (wavelength 11.2);
 *   4. perfect-freehand: size 2.1 × w, thinning 0.32, smoothing 0.6,
 *      streamline 0.2, tapers 1.0 (start) / 1.8 (end), each capped by the
 *      stroke length (≤16 % / ≤24 %) so short bars keep their body. The
 *      stroke points are built here and handed to getStrokeOutlinePoints
 *      at ×16 scale: the library's live-input heuristics (it drops the
 *      first `size` px and the last 3 px of a stroke) would otherwise eat
 *      dashes and dots on a 24-unit grid. Closed loops close by OVERLAP
 *      (the pen runs 1.4 units past its start, like a hand);
 *   5. polygon-clipping union of every stroke → one ink layer with no
 *      self-intersections;
 *   6. closed-ring RDP, ε = 0.04, 2-decimal relative path encoding;
 *   7. tones: `fill` = the silhouette, `shade` = fill ∩ the half-plane past
 *      a 45° terminator (light from the top-left; Sutherland–Hodgman in
 *      geometry.ts clipToShadow, the cut bisected so the shade covers
 *      `area` of the fill, 0.38 by default), `hl` = specular ellipses
 *      (objects only, r9 law 5);
 *   8. seed = FNV-1a(name); each stroke draws from its own stream
 *      (seed + 0x9E3779B1·index) so editing one stroke never re-wobbles the
 *      others; "boil" frames use seed + k·7919 (k = 1, 2);
 *   9. ON-FILL SPLIT (SÍNTESE §2.12 "texto sobre cor é sempre tinta"): ink
 *      lying entirely over the tone silhouette — every centerline sample
 *      inside the fill and at least the stroke's half width from its edge;
 *      dots whose disc is inside — goes to its own `…OnFill` layer, painted
 *      with --cel-on-fill (components/icons/tones.ts). In Cel Noite the
 *      outline stays chalk (r9 §4.5: objects keep the giz contour on the
 *      night ground) while letters, check marks and clock hands drawn on a
 *      colored fill turn ink: chalk over volt/mint/amber measured 1.1–1.9:1,
 *      ink ≥ 3:1 on every base, shade and lit tone. The split is computed
 *      once per stroke, so micro and boil frames classify identically.
 *
 * LOD (r9 §7.2): the `micro` ink (≤16 px) drops `detail` strokes and inks
 * 15 % heavier. Insignias (grid 48) scale every length parameter by 2, so
 * at 48 px the silhouette is r9's 4 px display stroke.
 *
 * Run `npx tsx scripts/icons/compile.ts` to regenerate
 * components/icons/generated.ts and public/icons/sprite.svg (emit.ts).
 * `--check` exits 1 when the committed outputs are stale.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getStrokeOutlinePoints, type StrokePoint } from "perfect-freehand";
import pc from "polygon-clipping";
import type { MultiPolygon, Pair, Polygon } from "polygon-clipping";
import { flattenPath, polylineLength, resample, type Polyline, type Sample } from "./path.ts";
import { bbox, clipToShadow, distanceToBoundary, ellipseRing, encodeMultiPolygon, multiPolygonArea, pointInMultiPolygon } from "./geometry.ts";
import { writeFileAtomicSync } from "../../src/store/atomic-write.ts";
import type { IconSpec, InkStroke } from "./spec.ts";
import type { IconTone } from "../../components/icons/tones.ts";

/** r9 §7.2 ink parameters at grid 24 (scaled by grid/24). */
export const INK = {
	size: 2.1,
	thinning: 0.32,
	smoothing: 0.6,
	streamline: 0.2,
	amp: 0.22,
	wavelength: 7,
	pressureWavelength: 11.2,
	pressureSwing: 0.12,
	taperStart: 1.0,
	taperEnd: 1.8,
	step: 0.3,
	eps: 0.04,
	/** RDP ε for display art (grid 48), per 24 grid units: 0.12 units at
	 *  48 — still ~0.1 px at its native size, and keeps each insignia
	 *  inside the 2.4 KB budget. */
	displayEps: 0.06,
	overlap: 1.4,
	microWeight: 1.15,
	boilPrime: 7919,
	/** Default share of the fill that falls in shadow (r9: 35–45 %). */
	shadeArea: 0.38,
} as const;

/** One compiled icon: path data per cel layer, in its own grid units. */
export interface CompiledIcon {
	name: string;
	label: string;
	family: IconSpec["family"];
	grid: 24 | 48;
	/** Default tone ramp of the fill/shade layers (objects and display). */
	tone?: IconTone;
	/** Ink on the ground: the outline and every stroke not entirely over the tone. */
	ink: string;
	/** Ink entirely over the tone (letters, check marks, hands): --cel-on-fill. */
	inkOnFill?: string;
	fill?: string;
	shade?: string;
	hl?: string;
	/** Ink for ≤16 px renders (detail dropped, heavier pen). */
	micro?: string;
	/** The on-fill part of the micro ink. */
	microOnFill?: string;
	/** Two extra ink frames for the 3-frame boil loop. */
	boil?: readonly [string, string];
	/** The on-fill part of the two boil frames. */
	boilOnFill?: readonly [string, string];
}

/** One ink variant, split by what it is drawn over. */
export interface InkLayers {
	/** Over the ground (or straddling the silhouette): currentColor. */
	line: MultiPolygon;
	/** Entirely over the tone silhouette: --cel-on-fill. */
	onFill: MultiPolygon;
}

/** 32-bit FNV-1a over UTF-16 code units. */
export function fnv1a(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/** mulberry32: a tiny, fast, well-mixed 32-bit PRNG → [0, 1). */
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** 1-D value noise in [−1, 1] over [0, length], knots every `wavelength`,
 *  cosine-interpolated (smooth, low frequency: a steady hand, not a tremor). */
export function valueNoise1d(rng: () => number, length: number, wavelength: number): (s: number) => number {
	const n = Math.max(2, Math.ceil(length / wavelength) + 2);
	const knots = Array.from({ length: n }, () => rng() * 2 - 1);
	return (s: number) => {
		const x = Math.max(0, s) / wavelength;
		const i = Math.min(Math.floor(x), n - 1);
		const f = (1 - Math.cos((x - i) * Math.PI)) / 2;
		return knots[i]! * (1 - f) + knots[Math.min(i + 1, n - 1)]! * f;
	};
}

/** Round to 1e-4 so the boolean ops see clean, reproducible coordinates. */
const q4 = (v: number) => Math.round(v * 1e4) / 1e4;

function toPolygon(points: readonly (readonly number[])[]): Polygon {
	const ring: Pair[] = points.map((p) => [q4(p[0]!), q4(p[1]!)]);
	return [ring];
}

function safeUnion(label: string, geoms: Polygon[] | MultiPolygon[]): MultiPolygon {
	if (!geoms.length) return [];
	try {
		const [first, ...rest] = geoms as Polygon[];
		return pc.union(first!, ...rest);
	} catch (err) {
		throw new Error(`icon compiler: polygon union failed for ${label}: ${(err as Error).message}`);
	}
}

interface PenContext {
	/** Grid scale: 1 at grid 24, 2 at grid 48. */
	k: number;
	/** Width multiplier on top of the stroke's own `w`. */
	weight: number;
	label: string;
}

/** Split resampled points into dash pieces of `on` length every `on+off`. */
function dashPieces(samples: Sample[], on: number, off: number): Sample[][] {
	const pieces: Sample[][] = [];
	const period = on + off;
	let cur: Sample[] = [];
	for (const p of samples) {
		const phase = p.s % period;
		if (phase <= on) cur.push(p);
		else if (cur.length) {
			pieces.push(cur);
			cur = [];
		}
	}
	if (cur.length) pieces.push(cur);
	return pieces.filter((piece) => piece.length >= 2);
}

/** perfect-freehand works in screen pixels; its live-input heuristics
 *  (skip the first `size` px of a stroke, drop points in the last 3 px)
 *  exist for pointer jitter and would swallow short skeleton strokes —
 *  dashes, crossbars. We build the stroke points ourselves (same streamline
 *  lerp as getStrokePoints, without the skip) and run the outline at ×16,
 *  where "3 px" is under one sample. */
const FREEHAND_SCALE = 16;

function freehandOutline(input: readonly (readonly number[])[], o: { size: number; taperStart: number; taperEnd: number }): number[][] {
	const S = FREEHAND_SCALE;
	const t = 0.15 + (1 - INK.streamline) * 0.85;
	const first = input[0]!;
	const points: StrokePoint[] = [{ point: [first[0]! * S, first[1]! * S], pressure: first[2]!, vector: [1, 1], distance: 0, runningLength: 0 }];
	let prev = points[0]!;
	for (let i = 1; i < input.length; i++) {
		const raw = input[i]!;
		const rx = raw[0]! * S;
		const ry = raw[1]! * S;
		const last = i === input.length - 1;
		const x = last ? rx : prev.point[0] + (rx - prev.point[0]) * t;
		const y = last ? ry : prev.point[1] + (ry - prev.point[1]) * t;
		const dx = prev.point[0] - x;
		const dy = prev.point[1] - y;
		const distance = Math.hypot(dx, dy);
		if (distance < 1e-9) continue;
		prev = { point: [x, y], pressure: raw[2]!, vector: [dx / distance, dy / distance], distance, runningLength: prev.runningLength + distance };
		points.push(prev);
	}
	if (points.length < 2) return [];
	points[0]!.vector = points[1]!.vector;
	const outline = getStrokeOutlinePoints(points, {
		size: o.size * S,
		thinning: INK.thinning,
		smoothing: INK.smoothing,
		streamline: INK.streamline,
		simulatePressure: false,
		last: true,
		start: { taper: o.taperStart * S, cap: true },
		end: { taper: o.taperEnd * S, cap: true },
	});
	return outline.map(([x, y]) => [x! / S, y! / S]);
}

/** One pen pass over a resampled centerline → its ink polygon(s). */
function penStroke(
	samples: Sample[],
	closed: boolean,
	w: number,
	rng: () => number,
	ctx: PenContext,
	taper: { start: number; end: number },
): MultiPolygon {
	const L = samples[samples.length - 1]!.s - samples[0]!.s || 1e-6;
	const s0 = samples[0]!.s;
	const wob = valueNoise1d(rng, L, INK.wavelength * ctx.k);
	const pr = valueNoise1d(rng, L, INK.pressureWavelength * ctx.k);
	let input = samples.map((p) => {
		const o = wob(p.s - s0) * INK.amp * ctx.k;
		return [p.x + p.nx * o, p.y + p.ny * o, 0.5 + INK.pressureSwing * pr(p.s - s0)];
	});
	if (closed) {
		// Close by overlap: retrace the first `overlap` units of the SAME
		// wobbled points, so the seam is invisible but the pen still lifts.
		const extra = samples.findIndex((p) => p.s - s0 > INK.overlap * ctx.k);
		input = input.concat(input.slice(1, extra < 0 ? 2 : extra + 1));
	}
	const outline = freehandOutline(input, {
		size: INK.size * w * ctx.weight * ctx.k,
		// Short strokes keep their body: tapers never eat more than ~40 % of
		// the length (a 2.8-unit crossbar would otherwise vanish).
		taperStart: closed ? 0 : Math.min(taper.start * ctx.k, L * 0.16),
		taperEnd: closed ? INK.overlap * ctx.k : Math.min(taper.end * ctx.k, L * 0.24),
	});
	if (outline.length < 3) return [];
	return safeUnion(ctx.label, [toPolygon(outline)]);
}

/** All pen passes of one InkStroke (every subpath; dashes split further). */
function inkStroke(stroke: InkStroke, rng: () => number, ctx: PenContext): MultiPolygon[] {
	const out: MultiPolygon[] = [];
	const w = stroke.w ?? 1;
	for (const line of flattenPath(stroke.d, 0.15 * ctx.k)) {
		if (polylineLength(line) < 1e-6) continue;
		const samples = resample(line, INK.step * ctx.k);
		if (stroke.dash) {
			const [on, off] = stroke.dash;
			for (const piece of dashPieces(samples, on * ctx.k, off * ctx.k)) {
				out.push(penStroke(piece, false, w, rng, ctx, { start: 0.35, end: 0.6 }));
			}
		} else {
			out.push(penStroke(samples, line.closed, w, rng, ctx, { start: INK.taperStart, end: INK.taperEnd }));
		}
	}
	return out;
}

/** An ink dot: a slightly irregular disc (radius ±4 %). */
function inkDot(cx: number, cy: number, r: number, rng: () => number): Polygon {
	const n = 18;
	const ring: Pair[] = [];
	const phase = rng() * Math.PI * 2;
	for (let i = 0; i < n; i++) {
		const t = (i / n) * Math.PI * 2;
		const rr = r * (1 + 0.04 * Math.sin(2 * t + phase));
		ring.push([q4(cx + rr * Math.cos(t)), q4(cy + rr * Math.sin(t))]);
	}
	return [ring];
}

const STROKE_MIX = 0x9e3779b1;

/** Which strokes and dots lie ENTIRELY over the tone silhouette `fill`.
 *  A stroke qualifies when every centerline sample is inside the fill and
 *  at least its own half width (INK.size · w / 2) from the fill's edge, so
 *  its ink never leaves the tone; a dot when its whole disc is inside.
 *  Classified once per icon (regular weight), so every LOD and boil frame
 *  splits the same way. No fill → nothing is on-fill. */
export function onFillMask(spec: IconSpec, fill: MultiPolygon): { strokes: boolean[]; dots: boolean[] } {
	const k = (spec.grid ?? 24) / 24;
	const over = (x: number, y: number, margin: number) => pointInMultiPolygon(fill, x, y) && distanceToBoundary(fill, x, y) >= margin;
	const strokes = spec.ink.map((stroke) => {
		if (!fill.length) return false;
		const margin = (INK.size * (stroke.w ?? 1) * k) / 2;
		const lines = flattenPath(stroke.d, 0.15 * k).filter((l) => polylineLength(l) >= 1e-6);
		return lines.length > 0 && lines.every((l) => resample(l, INK.step * k).every((p) => over(p.x, p.y, margin)));
	});
	const dots = (spec.dots ?? []).map(([cx, cy, r]) => fill.length > 0 && over(cx, cy, r));
	return { strokes, dots };
}

/** The ink of one frame / LOD, split into ground ink and on-fill ink
 *  (`mask`: onFillMask of the icon; omitted = everything on the ground). */
export function compileInk(name: string, spec: IconSpec, frame = 0, micro = false, mask?: { strokes: boolean[]; dots: boolean[] }): InkLayers {
	const k = (spec.grid ?? 24) / 24;
	const ctx: PenContext = { k, weight: micro ? INK.microWeight : 1, label: name };
	const seed = (fnv1a(name) + frame * INK.boilPrime) >>> 0;
	const line: MultiPolygon[] = [];
	const onFill: MultiPolygon[] = [];
	spec.ink.forEach((stroke, i) => {
		if (micro && stroke.detail) return;
		const rng = mulberry32((seed + Math.imul(i + 1, STROKE_MIX)) >>> 0);
		(mask?.strokes[i] ? onFill : line).push(...inkStroke(stroke, rng, ctx));
	});
	const dotRng = mulberry32((seed ^ 0x5bd1e995) >>> 0);
	(spec.dots ?? []).forEach(([cx, cy, r], i) => {
		(mask?.dots[i] ? onFill : line).push([inkDot(cx, cy, r * (micro ? 1.1 : 1), dotRng)]);
	});
	const lineParts = line.filter((p) => p.length);
	const onFillParts = onFill.filter((p) => p.length);
	if (!lineParts.length && !onFillParts.length) throw new Error(`icon compiler: "${name}" has no ink`);
	return { line: safeUnion(name, lineParts), onFill: safeUnion(name, onFillParts) };
}

function polylineRing(line: Polyline): Pair[] {
	return line.points.map((p) => [q4(p.x), q4(p.y)]);
}

/** The tone silhouette: closed fill subpaths, unioned (nonzero) or XORed (evenodd). */
export function compileFill(name: string, spec: IconSpec): MultiPolygon {
	if (!spec.fill) return [];
	const k = (spec.grid ?? 24) / 24;
	const lines = flattenPath(spec.fill, 0.1 * k).filter((l) => l.points.length >= 3);
	if (!lines.length) throw new Error(`icon compiler: "${name}" fill has no closed area`);
	const polys: Polygon[] = lines.map((l) => [polylineRing(l)]);
	try {
		const [first, ...rest] = polys;
		return spec.fillRule === "evenodd" ? pc.xor(first!, ...rest) : pc.union(first!, ...rest);
	} catch (err) {
		throw new Error(`icon compiler: fill boolean failed for ${name}: ${(err as Error).message}`);
	}
}

/** Fill ∩ the shadow half-plane of a 45° terminator. With no explicit
 *  `cut`, bisect for the cut whose shade covers `area` of the fill. */
export function compileShade(name: string, spec: IconSpec, fill: MultiPolygon): MultiPolygon {
	if (!fill.length || spec.light === false) return [];
	const total = multiPolygonArea(fill);
	if (total <= 0) throw new Error(`icon compiler: "${name}" fill has zero area`);
	const light = spec.light ?? {};
	const box = bbox(fill);
	const cx = light.cx ?? (box.minX + box.maxX) / 2;
	const cy = light.cy ?? (box.minY + box.maxY) / 2;
	const grid = spec.grid ?? 24;
	const shadeAt = (cut: number) => clipToShadow(fill, cx, cy, cut);
	let cut = light.cut;
	if (cut === undefined) {
		const target = light.area ?? INK.shadeArea;
		let lo: number = -grid;
		let hi: number = grid;
		for (let i = 0; i < 32; i++) {
			const mid = (lo + hi) / 2;
			if (multiPolygonArea(shadeAt(mid)) / total > target) lo = mid;
			else hi = mid;
		}
		cut = Math.round(((lo + hi) / 2) * 100) / 100;
	}
	return shadeAt(cut);
}

/** Specular pills (objects and display only — r9 law 5). */
export function compileHighlights(name: string, spec: IconSpec): MultiPolygon {
	if (!spec.hl?.length) return [];
	if (spec.family === "glyph") throw new Error(`icon compiler: "${name}" is a glyph; glyphs carry no specular`);
	const polys: Polygon[] = spec.hl.map(([cx, cy, rx, ry, rot = -35]) => [ellipseRing(cx, cy, rx, ry, rot, 20)]);
	return safeUnion(name, polys);
}

/** Compile one skeleton into its cel layers. */
export function compileIcon(name: string, spec: IconSpec): CompiledIcon {
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error(`icon compiler: name "${name}" must be kebab-case`);
	const grid = spec.grid ?? 24;
	const eps = (grid === 48 ? INK.displayEps : INK.eps) * (grid / 24);
	const enc = (mp: MultiPolygon) => encodeMultiPolygon(mp, eps, 0.004 * (grid / 24) ** 2);
	if (spec.fill && spec.family === "glyph") throw new Error(`icon compiler: "${name}" is a glyph; glyphs are ink only`);
	const fill = compileFill(name, spec);
	const mask = onFillMask(spec, fill);
	const regular = compileInk(name, spec, 0, false, mask);
	const out: CompiledIcon = { name, label: spec.label, family: spec.family, grid, ink: enc(regular.line) };
	const inkOnFill = enc(regular.onFill);
	if (inkOnFill) out.inkOnFill = inkOnFill;
	if (spec.fill) {
		out.tone = spec.tone ?? "accent";
		out.fill = enc(fill);
		const shade = enc(compileShade(name, spec, fill));
		if (shade) out.shade = shade;
	}
	const hl = enc(compileHighlights(name, spec));
	if (hl) out.hl = hl;
	const wantsMicro = spec.micro ?? (spec.family === "glyph" || spec.ink.some((s) => s.detail));
	if (wantsMicro && grid === 24) {
		const micro = compileInk(name, spec, 0, true, mask);
		out.micro = enc(micro.line);
		const microOnFill = enc(micro.onFill);
		if (microOnFill) out.microOnFill = microOnFill;
	}
	if (spec.boil) {
		const frames = [compileInk(name, spec, 1, false, mask), compileInk(name, spec, 2, false, mask)] as const;
		out.boil = [enc(frames[0].line), enc(frames[1].line)];
		const onFill = [enc(frames[0].onFill), enc(frames[1].onFill)] as const;
		if (onFill[0] || onFill[1]) out.boilOnFill = onFill;
	}
	return out;
}

/** Compile every skeleton, sorted by name (stable output order). */
export function compileAll(defs: Readonly<Record<string, IconSpec>>): CompiledIcon[] {
	return Object.keys(defs)
		.sort()
		.map((name) => compileIcon(name, defs[name]!));
}

/** Bytes of what one render paints at ≥20 px (fill + shade + ink, both
 *  halves, + hl). */
export function renderedBytes(icon: CompiledIcon): number {
	return [icon.fill, icon.shade, icon.inkOnFill, icon.ink, icon.hl].reduce((n, d) => n + (d ? Buffer.byteLength(d) : 0), 0);
}

/* ------------------------------------------------------------------ CLI */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
/** Output files, relative to the repo root. */
export const OUTPUTS = {
	generated: "components/icons/generated.ts",
	meta: "components/icons/meta.ts",
	sprite: "public/icons/sprite.svg",
} as const;

/**
 * Bring the output files under `root` in line with `files` (relative path →
 * content, LF). A file whose bytes differ only by CRLF line ends (a Windows
 * checkout with core.autocrlf) counts as fresh. With `check`, nothing is
 * written and the differing paths come back as `stale`; otherwise each is
 * replaced atomically (temp + rename, src/store/atomic-write.ts), so an
 * interrupted run never leaves a truncated generated.ts behind.
 */
export function syncOutputs(root: string, files: Readonly<Record<string, string>>, check: boolean): { written: string[]; stale: string[] } {
	const written: string[] = [];
	const stale: string[] = [];
	for (const [rel, content] of Object.entries(files)) {
		const abs = path.join(root, rel);
		const current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n") : null;
		if (current === content) continue;
		if (check) {
			stale.push(rel);
			continue;
		}
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		// A dev server or editor may hold the file open on Windows: fall back
		// to an in-place write rather than failing the build.
		writeFileAtomicSync(abs, content, { allowInPlaceFallback: true });
		written.push(rel);
	}
	return { written, stale };
}

async function main(argv: string[]): Promise<number> {
	const { ICON_ALIASES, ICON_DEFS } = await import("./defs/index.ts");
	const { emitGenerated, emitMeta, emitSprite } = await import("./emit.ts");
	const t0 = Date.now();
	const icons = compileAll(ICON_DEFS);
	const files: Record<string, string> = {
		[OUTPUTS.generated]: emitGenerated(icons, ICON_ALIASES),
		[OUTPUTS.meta]: emitMeta(icons, ICON_ALIASES),
		[OUTPUTS.sprite]: emitSprite(icons),
	};
	const { written, stale } = syncOutputs(ROOT, files, argv.includes("--check"));
	for (const rel of stale) console.error(`desatualizado: ${rel} (rode npx tsx scripts/icons/compile.ts)`);
	for (const rel of written) console.log(`escrito ${rel} (${(Buffer.byteLength(files[rel]!) / 1024).toFixed(1)} KB)`);
	const heaviest = icons.reduce((a, b) => (renderedBytes(b) > renderedBytes(a) ? b : a));
	console.log(`${icons.length} ícones em ${Date.now() - t0} ms; maior: ${heaviest.name} (${renderedBytes(heaviest)} B)`);
	return stale.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main(process.argv.slice(2)).then(
		(code) => process.exit(code),
		(err: unknown) => {
			console.error(err instanceof Error ? err.message : err);
			process.exit(1);
		},
	);
}
