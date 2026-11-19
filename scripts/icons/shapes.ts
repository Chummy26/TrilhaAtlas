/**
 * AUTHORING HELPERS for hand-drawn icon skeletons (estudos-sota M8 —
 * SÍNTESE §2.12; r9 §7.2, §8.1). Each helper returns SVG path data in grid
 * units, so a skeleton reads as geometry ("a circle of r 9 at the center")
 * instead of opaque path strings. Angles are in degrees, 0° = +x, growing
 * CLOCKWISE on screen (y points down). Closed shapes start where a hand
 * would start them (default top-left, −110°), which is where the compiler
 * places the overlap "pen lift".
 *
 * Pure: numbers in, strings out.
 */

import { flattenPath } from "./path.ts";

export type XY = readonly [number, number];

/** Round to 3 decimals for stable, short path strings. */
const r3 = (v: number) => String(Math.round(v * 1000) / 1000);
const pt = (x: number, y: number) => `${r3(x)} ${r3(y)}`;
const rad = (deg: number) => (deg * Math.PI) / 180;
const polar = (cx: number, cy: number, r: number, deg: number): XY => [cx + r * Math.cos(rad(deg)), cy + r * Math.sin(rad(deg))];

/** Concatenate path data (each part keeps its own M). */
export function join(...parts: string[]): string {
	return parts.filter(Boolean).join(" ");
}

/** A straight segment. */
export function line(x1: number, y1: number, x2: number, y2: number): string {
	return `M${pt(x1, y1)}L${pt(x2, y2)}`;
}

/** A polyline through `pts`; `close` adds Z. */
export function poly(pts: readonly XY[], close = false): string {
	if (pts.length < 2) throw new Error("poly needs at least 2 points");
	return `M${pts.map(([x, y]) => pt(x, y)).join("L")}${close ? "Z" : ""}`;
}

/** A closed circle starting at `startDeg`. */
export function circle(cx: number, cy: number, r: number, startDeg = -110): string {
	return ellipse(cx, cy, r, r, startDeg);
}

/** A closed axis-aligned ellipse starting at `startDeg`. */
export function ellipse(cx: number, cy: number, rx: number, ry: number, startDeg = -110): string {
	const a = [cx + rx * Math.cos(rad(startDeg)), cy + ry * Math.sin(rad(startDeg))] as const;
	const b = [cx + rx * Math.cos(rad(startDeg + 180)), cy + ry * Math.sin(rad(startDeg + 180))] as const;
	return `M${pt(a[0], a[1])}A${r3(rx)} ${r3(ry)} 0 1 1 ${pt(b[0], b[1])}A${r3(rx)} ${r3(ry)} 0 1 1 ${pt(a[0], a[1])}Z`;
}

/** An open circular arc from `fromDeg` to `toDeg` (clockwise when to > from). */
export function arc(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
	const sweep = toDeg > fromDeg ? 1 : 0;
	const span = Math.abs(toDeg - fromDeg);
	if (span >= 360) throw new Error("arc span must be < 360 (use circle)");
	const [x1, y1] = polar(cx, cy, r, fromDeg);
	const [x2, y2] = polar(cx, cy, r, toDeg);
	return `M${pt(x1, y1)}A${r3(r)} ${r3(r)} 0 ${span > 180 ? 1 : 0} ${sweep} ${pt(x2, y2)}`;
}

/** A point on a circle (for placing ticks, rays, dots). */
export function onCircle(cx: number, cy: number, r: number, deg: number): XY {
	return polar(cx, cy, r, deg);
}

/** A closed rounded rectangle, drawn clockwise from the top edge's start. */
export function rrect(x: number, y: number, w: number, h: number, r: number): string {
	const k = Math.min(r, w / 2, h / 2);
	if (k <= 0) return poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);
	return `M${pt(x + k, y)}H${r3(x + w - k)}A${r3(k)} ${r3(k)} 0 0 1 ${pt(x + w, y + k)}V${r3(y + h - k)}A${r3(k)} ${r3(k)} 0 0 1 ${pt(x + w - k, y + h)}H${r3(x + k)}A${r3(k)} ${r3(k)} 0 0 1 ${pt(x, y + h - k)}V${r3(y + k)}A${r3(k)} ${r3(k)} 0 0 1 ${pt(x + k, y)}Z`;
}

/**
 * A polyline/polygon whose corners are rounded with radius-like cut `r`
 * (quadratic fillets, the corner itself is the control point). `rs` may
 * give a per-corner cut (0 = sharp).
 */
export function roundPoly(pts: readonly XY[], r: number, close = true, rs?: readonly number[]): string {
	const n = pts.length;
	if (n < 3) return poly(pts, close);
	const cutAt = (i: number) => rs?.[i] ?? r;
	const toward = (a: XY, b: XY, d: number): XY => {
		const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
		const t = Math.min(d, len / 2) / len;
		return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
	};
	const segs: string[] = [];
	const first = close ? 0 : 1;
	const last = close ? n - 1 : n - 2;
	let start: XY;
	if (close) {
		const k = cutAt(0);
		start = k > 0 ? toward(pts[0]!, pts[1]!, k) : pts[0]!;
	} else {
		start = pts[0]!;
	}
	segs.push(`M${pt(start[0], start[1])}`);
	for (let i = close ? 1 : first; i <= last + (close ? 1 : 0); i++) {
		const idx = i % n;
		const c = pts[idx]!;
		const prev = pts[(idx - 1 + n) % n]!;
		const next = pts[(idx + 1) % n]!;
		const k = cutAt(idx);
		if (k <= 0) {
			segs.push(`L${pt(c[0], c[1])}`);
			continue;
		}
		const a = toward(c, prev, k);
		const b = toward(c, next, k);
		segs.push(`L${pt(a[0], a[1])}Q${pt(c[0], c[1])} ${pt(b[0], b[1])}`);
	}
	if (!close) {
		const end = pts[n - 1]!;
		segs.push(`L${pt(end[0], end[1])}`);
	}
	return segs.join("") + (close ? "Z" : "");
}

/** Vertices of a regular polygon (first vertex at `rotDeg`). */
export function regular(cx: number, cy: number, r: number, n: number, rotDeg = -90): XY[] {
	return Array.from({ length: n }, (_, i) => polar(cx, cy, r, rotDeg + (360 * i) / n));
}

/** Vertices of a star with `n` points (outer R, inner r). */
export function star(cx: number, cy: number, R: number, r: number, n: number, rotDeg = -90): XY[] {
	return Array.from({ length: 2 * n }, (_, i) => polar(cx, cy, i % 2 ? r : R, rotDeg + (180 * i) / n));
}

/** Rotate points about (cx, cy). */
export function rotate(pts: readonly XY[], deg: number, cx: number, cy: number): XY[] {
	const c = Math.cos(rad(deg));
	const s = Math.sin(rad(deg));
	return pts.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c] as const);
}

/** A smooth open curve through points (Catmull–Rom → cubic Bézier). */
export function curve(pts: readonly XY[], tension = 1): string {
	if (pts.length < 3) return poly(pts);
	let d = `M${pt(pts[0]![0], pts[0]![1])}`;
	for (let i = 0; i < pts.length - 1; i++) {
		const p0 = pts[Math.max(0, i - 1)]!;
		const p1 = pts[i]!;
		const p2 = pts[i + 1]!;
		const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
		const c1: XY = [p1[0] + ((p2[0] - p0[0]) / 6) * tension, p1[1] + ((p2[1] - p0[1]) / 6) * tension];
		const c2: XY = [p2[0] - ((p3[0] - p1[0]) / 6) * tension, p2[1] - ((p3[1] - p1[1]) / 6) * tension];
		d += `C${pt(c1[0], c1[1])} ${pt(c2[0], c2[1])} ${pt(p2[0], p2[1])}`;
	}
	return d;
}

/** A smooth CLOSED curve through points (periodic Catmull–Rom). */
export function closedCurve(pts: readonly XY[], tension = 1): string {
	const n = pts.length;
	if (n < 3) throw new Error("closedCurve needs at least 3 points");
	let d = `M${pt(pts[0]![0], pts[0]![1])}`;
	for (let i = 0; i < n; i++) {
		const p0 = pts[(i - 1 + n) % n]!;
		const p1 = pts[i]!;
		const p2 = pts[(i + 1) % n]!;
		const p3 = pts[(i + 2) % n]!;
		const c1: XY = [p1[0] + ((p2[0] - p0[0]) / 6) * tension, p1[1] + ((p2[1] - p0[1]) / 6) * tension];
		const c2: XY = [p2[0] - ((p3[0] - p1[0]) / 6) * tension, p2[1] - ((p3[1] - p1[1]) / 6) * tension];
		d += `C${pt(c1[0], c1[1])} ${pt(c2[0], c2[1])} ${pt(p2[0], p2[1])}`;
	}
	return `${d}Z`;
}

/** Scale + translate path-free point lists (for reusing a motif). */
export function place(pts: readonly XY[], dx: number, dy: number, s = 1): XY[] {
	return pts.map(([x, y]) => [x * s + dx, y * s + dy] as const);
}

/** An open arrowhead (a "V") whose tip sits at `tip`, pointing along
 *  `dirDeg`; each barb is `len` long at ±`spreadDeg` from the shaft. */
export function arrowHead(tip: XY, dirDeg: number, len = 4.2, spreadDeg = 42): string {
	const back = dirDeg + 180;
	const a = polar(tip[0], tip[1], len, back - spreadDeg);
	const b = polar(tip[0], tip[1], len, back + spreadDeg);
	return poly([a, tip, b]);
}

/** The tangent direction (degrees) of a clockwise circle at `deg`. */
export function clockwiseTangent(deg: number): number {
	return deg + 90;
}

/** A straight link between two circles (centers a, b; radii ra, rb),
 *  trimmed by `gap` past each rim so the pen never touches the nodes. */
export function link(a: XY, b: XY, ra: number, rb: number, gap = 1.2): string {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const len = Math.hypot(dx, dy) || 1;
	const ux = dx / len;
	const uy = dy / len;
	return line(a[0] + ux * (ra + gap), a[1] + uy * (ra + gap), b[0] - ux * (rb + gap), b[1] - uy * (rb + gap));
}

/** Mirror points across the vertical line x = cx. */
export function mirrorX(pts: readonly XY[], cx = 12): XY[] {
	return pts.map(([x, y]) => [2 * cx - x, y] as const);
}

/** Translate points by (dx, dy). */
export function shift(pts: readonly XY[], dx: number, dy: number): XY[] {
	return pts.map(([x, y]) => [x + dx, y + dy] as const);
}

/** Rotate (then translate) arbitrary path data about (cx, cy). The path is
 *  flattened first, so curves become dense polylines (the compiler
 *  resamples them anyway). */
export function rotatePath(d: string, deg: number, cx = 12, cy = 12, dx = 0, dy = 0): string {
	return join(...flattenPath(d, 0.25).map((l) => poly(shift(rotate(l.points.map((p) => [p.x, p.y] as const), deg, cx, cy), dx, dy), l.closed)));
}
