/**
 * POLYGON UTILITIES for the cel icon compiler (estudos-sota M8 — SÍNTESE
 * §2.12; r9 §7.2 steps 6–7): Ramer–Douglas–Peucker for open chains and
 * CLOSED rings (a naive RDP collapses a ring whose first and last points
 * coincide — r9 found it in the prototype; rings are split at the vertex
 * farthest from the start and each half simplified), polygon areas,
 * the 45° terminator clip (Sutherland–Hodgman, clipToShadow), ellipse
 * rings, point-in-area / distance-to-edge (the on-fill ink split in
 * compile.ts), and the compact path encoder.
 *
 * Encoding: coordinates are rounded to 2 decimals (r9) but written as
 * RELATIVE moves/lines with implicit linetos and minimal separators
 * (`m12.3 4.5.7-.2…z`). Deltas are computed in integer hundredths, so
 * rounding never accumulates. Typically 35–45% smaller than absolute "L".
 *
 * Pure and deterministic.
 */

import type { MultiPolygon, Pair, Ring } from "polygon-clipping";

/** Perpendicular distance from p to the line through a and b. */
function lineDistance(p: Pair, a: Pair, b: Pair): number {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const len = Math.hypot(dx, dy);
	if (len < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
	return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}

/** RDP on an open chain; keeps both endpoints. Iterative (no deep recursion). */
export function rdp(points: readonly Pair[], eps: number): Pair[] {
	if (points.length < 3) return points.map((p) => [p[0], p[1]]);
	const keep = new Uint8Array(points.length);
	keep[0] = 1;
	keep[points.length - 1] = 1;
	const stack: [number, number][] = [[0, points.length - 1]];
	while (stack.length) {
		const [lo, hi] = stack.pop()!;
		let max = -1;
		let idx = -1;
		for (let i = lo + 1; i < hi; i++) {
			const d = lineDistance(points[i]!, points[lo]!, points[hi]!);
			if (d > max) {
				max = d;
				idx = i;
			}
		}
		if (idx >= 0 && max > eps) {
			keep[idx] = 1;
			stack.push([lo, idx], [idx, hi]);
		}
	}
	return points.filter((_, i) => keep[i]).map((p) => [p[0], p[1]]);
}

/** RDP on a closed ring (input may or may not repeat its first point;
 *  output does not). Split at the vertex farthest from the first. */
export function rdpRing(ring: readonly Pair[], eps: number): Pair[] {
	let r = ring.slice();
	if (r.length > 1 && r[0]![0] === r[r.length - 1]![0] && r[0]![1] === r[r.length - 1]![1]) r = r.slice(0, -1);
	if (r.length < 4) return r.map((p) => [p[0], p[1]]);
	let far = 0;
	let best = -1;
	r.forEach((q, i) => {
		const d = Math.hypot(q[0] - r[0]![0], q[1] - r[0]![1]);
		if (d > best) {
			best = d;
			far = i;
		}
	});
	const a = rdp(r.slice(0, far + 1), eps);
	const b = rdp([...r.slice(far), r[0]!], eps);
	return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** Signed shoelace area of a ring (closing edge implied). */
export function ringArea(ring: readonly Pair[]): number {
	let a = 0;
	for (let i = 0; i < ring.length; i++) {
		const p = ring[i]!;
		const q = ring[(i + 1) % ring.length]!;
		a += p[0] * q[1] - q[0] * p[1];
	}
	return a / 2;
}

/** Area of a MultiPolygon: outer rings minus their holes. */
export function multiPolygonArea(mp: MultiPolygon): number {
	let total = 0;
	for (const poly of mp) {
		poly.forEach((ring, i) => {
			total += (i === 0 ? 1 : -1) * Math.abs(ringArea(ring));
		});
	}
	return total;
}

/** Even-odd point-in-polygon over EVERY ring of a MultiPolygon (outer rings
 *  and holes alike — polygon-clipping output never overlaps, so the parity
 *  of crossings is exactly "inside the area"). */
export function pointInMultiPolygon(mp: MultiPolygon, x: number, y: number): boolean {
	let inside = false;
	for (const poly of mp) {
		for (const ring of poly) {
			for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
				const [xi, yi] = ring[i]!;
				const [xj, yj] = ring[j]!;
				if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
			}
		}
	}
	return inside;
}

/** Distance from (x, y) to the nearest edge of any ring of a MultiPolygon. */
export function distanceToBoundary(mp: MultiPolygon, x: number, y: number): number {
	let best = Infinity;
	for (const poly of mp) {
		for (const ring of poly) {
			for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
				const [ax, ay] = ring[j]!;
				const [bx, by] = ring[i]!;
				const dx = bx - ax;
				const dy = by - ay;
				const len2 = dx * dx + dy * dy;
				const t = len2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
				const d = Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
				if (d < best) best = d;
			}
		}
	}
	return best;
}

/** Bounding box of every ring in a MultiPolygon. */
export function bbox(mp: MultiPolygon): { minX: number; minY: number; maxX: number; maxY: number } {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const poly of mp) {
		for (const ring of poly) {
			for (const [x, y] of ring) {
				if (x < minX) minX = x;
				if (y < minY) minY = y;
				if (x > maxX) maxX = x;
				if (y > maxY) maxY = y;
			}
		}
	}
	return { minX, minY, maxX, maxY };
}

/** A rotated ellipse as a ring of `n` vertices (rotation in degrees). */
export function ellipseRing(cx: number, cy: number, rx: number, ry: number, rotDeg: number, n = 20): Ring {
	const r = (rotDeg * Math.PI) / 180;
	const ring: Ring = [];
	for (let i = 0; i < n; i++) {
		const t = (i / n) * 2 * Math.PI;
		const x = rx * Math.cos(t);
		const y = ry * Math.sin(t);
		ring.push([cx + x * Math.cos(r) - y * Math.sin(r), cy + x * Math.sin(r) + y * Math.cos(r)]);
	}
	ring.push([...ring[0]!] as Pair);
	return ring;
}

/** Integer hundredths → shortest decimal string ("-0.5" → "-.5", "3.10" → "3.1"). */
function fmtHundredths(v: number): string {
	const neg = v < 0;
	const a = Math.abs(v);
	const int = Math.floor(a / 100);
	const frac = a % 100;
	let s = frac === 0 ? String(int) : `${int === 0 ? "" : int}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
	if (s === "") s = "0";
	return neg ? `-${s}` : s;
}

/** Join numbers with the fewest separators a path parser still splits. */
function joinNumbers(nums: string[]): string {
	let out = "";
	let prev = "";
	for (const n of nums) {
		if (!out) out = n;
		else if (n.startsWith("-")) out += n;
		// "1.5" followed by ".5" reads back as two numbers; "3" + ".5" would not.
		else if (n.startsWith(".") && prev.includes(".")) out += n;
		else out += ` ${n}`;
		prev = n;
	}
	return out;
}

/**
 * Encode a MultiPolygon as compact relative path data: each ring is
 * simplified (rdpRing, `eps`), rounded to hundredths, emitted as
 * `m dx dy dx dy … z`. Rings that collapse below 3 vertices or `minArea`
 * are dropped. Paint with the nonzero OR evenodd rule — polygon-clipping
 * output has holes wound opposite to their outer ring.
 */
export function encodeMultiPolygon(mp: MultiPolygon, eps: number, minArea = 0.004): string {
	let cx = 0;
	let cy = 0;
	const parts: string[] = [];
	for (const poly of mp) {
		for (const ring of poly) {
			const simple = rdpRing(ring, eps);
			const ints = simple.map(([x, y]) => [Math.round(x * 100), Math.round(y * 100)] as [number, number]);
			const dedup: [number, number][] = [];
			for (const p of ints) {
				const prev = dedup[dedup.length - 1];
				if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) dedup.push(p);
			}
			while (dedup.length > 1 && dedup[0]![0] === dedup[dedup.length - 1]![0] && dedup[0]![1] === dedup[dedup.length - 1]![1]) dedup.pop();
			if (dedup.length < 3) continue;
			if (Math.abs(ringArea(dedup.map(([x, y]) => [x / 100, y / 100] as Pair))) < minArea) continue;
			const nums: string[] = [];
			const [x0, y0] = dedup[0]!;
			nums.push(fmtHundredths(x0 - cx), fmtHundredths(y0 - cy));
			let px = x0;
			let py = y0;
			for (let i = 1; i < dedup.length; i++) {
				const [x, y] = dedup[i]!;
				nums.push(fmtHundredths(x - px), fmtHundredths(y - py));
				px = x;
				py = y;
			}
			parts.push(`m${joinNumbers(nums)}z`);
			// After z the current point returns to the ring's first vertex.
			cx = x0;
			cy = y0;
		}
	}
	return parts.join("");
}

/**
 * Clip a MultiPolygon to the shadow side of a 45° terminator — the points
 * p with ((p.x − cx) + (p.y − cy)) / √2 ≥ cut — ring by ring
 * (Sutherland–Hodgman against one half-plane). A half-plane is convex, so
 * clipping each ring independently is exact, and hole rings keep their
 * opposite winding (nonzero fill stays correct). Pure arithmetic: immune
 * to the boolean-op robustness failures of general clippers.
 */
export function clipToShadow(mp: MultiPolygon, cx: number, cy: number, cut: number): MultiPolygon {
	const f = (p: Pair) => (p[0] - cx + (p[1] - cy)) * Math.SQRT1_2 - cut;
	const out: MultiPolygon = [];
	const clipRing = (ring: Ring): Ring | null => {
		const closedTwice = ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1];
		const src = closedTwice ? ring.slice(0, -1) : ring;
		const clipped: Ring = [];
		for (let k = 0; k < src.length; k++) {
			const a = src[k]!;
			const b = src[(k + 1) % src.length]!;
			const fa = f(a);
			const fb = f(b);
			if (fa >= 0) clipped.push([a[0], a[1]]);
			if ((fa >= 0) !== (fb >= 0)) {
				const t = fa / (fa - fb);
				clipped.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
			}
		}
		return clipped.length >= 3 && Math.abs(ringArea(clipped)) > 1e-6 ? clipped : null;
	};
	for (const poly of mp) {
		const outer = poly[0] ? clipRing(poly[0]) : null;
		// No outer ring on the shadow side → its holes are gone too.
		if (!outer) continue;
		const holes = poly.slice(1).map(clipRing).filter((r): r is Ring => r !== null);
		out.push([outer, ...holes]);
	}
	return out;
}
