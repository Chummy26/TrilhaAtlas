/**
 * SVG PATH GEOMETRY for the cel icon compiler (estudos-sota M8 — SÍNTESE
 * §2.12; r9 §7.2 steps 1 and 7). Parses path data (every command of the SVG
 * 1.1 grammar, absolute and relative, implicit repeats, packed arc flags),
 * flattens it into dense polylines — one per subpath, `closed` when the
 * subpath ends in Z — and resamples a polyline at a fixed arc-length step
 * with smooth normals (central differences, so a corner's normal is the
 * bisector instead of a jump).
 *
 * r9 sampled with `svg-path-properties`; it is not a dependency here, so
 * this module replaces it. Subpaths are kept SEPARATE (r9 §7.2: sampling a
 * multi-M path as one curve bridges the end of one stroke to the start of
 * the next with a phantom segment).
 *
 * Pure and deterministic: no I/O, no randomness.
 */

export interface Pt {
	x: number;
	y: number;
}

/** One subpath, flattened. `closed` = the source subpath ended with Z
 *  (the first point is NOT repeated at the end). */
export interface Polyline {
	points: Pt[];
	closed: boolean;
}

/** A resampled point: position, unit normal and arc length from the start. */
export interface Sample {
	x: number;
	y: number;
	nx: number;
	ny: number;
	s: number;
}

type Cmd = { op: string; args: number[] };

const ARG_COUNT: Readonly<Record<string, number>> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** Tokenize + parse path data. Throws with the offending position on bad input. */
export function parsePath(d: string): Cmd[] {
	const cmds: Cmd[] = [];
	let i = 0;
	const n = d.length;
	const skipSep = () => {
		while (i < n && /[\s,]/.test(d[i]!)) i++;
	};
	const readNumber = (): number => {
		skipSep();
		const m = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(d.slice(i));
		if (!m) throw new Error(`path: expected a number at ${i} in "${d}"`);
		i += m[0].length;
		return Number(m[0]);
	};
	const readFlag = (): number => {
		skipSep();
		const c = d[i];
		if (c !== "0" && c !== "1") throw new Error(`path: expected an arc flag at ${i} in "${d}"`);
		i++;
		return c === "1" ? 1 : 0;
	};
	let op = "";
	while (true) {
		skipSep();
		if (i >= n) break;
		const c = d[i]!;
		if (/[a-zA-Z]/.test(c)) {
			if (ARG_COUNT[c.toUpperCase()] === undefined) throw new Error(`path: unknown command "${c}" in "${d}"`);
			op = c;
			i++;
		} else if (!op) {
			throw new Error(`path: data must start with a command in "${d}"`);
		}
		const count = ARG_COUNT[op.toUpperCase()]!;
		if (count === 0) {
			cmds.push({ op, args: [] });
			op = "";
			continue;
		}
		const args: number[] = [];
		for (let k = 0; k < count; k++) {
			args.push(op.toUpperCase() === "A" && (k === 3 || k === 4) ? readFlag() : readNumber());
		}
		cmds.push({ op, args });
		// An implicit repeat after M/m is a lineto (SVG 1.1 §8.3.2).
		if (op === "M") op = "L";
		else if (op === "m") op = "l";
	}
	return cmds;
}

function cubicAt(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
	const u = 1 - t;
	const a = u * u * u;
	const b = 3 * u * u * t;
	const c = 3 * u * t * t;
	const e = t * t * t;
	return { x: a * p0.x + b * p1.x + c * p2.x + e * p3.x, y: a * p0.y + b * p1.y + c * p2.y + e * p3.y };
}

function dist(a: Pt, b: Pt): number {
	return Math.hypot(b.x - a.x, b.y - a.y);
}

/** SVG arc (endpoint parameterization) → points after `from`, SVG 1.1 F.6.5. */
function arcPoints(from: Pt, rx: number, ry: number, rotDeg: number, large: number, sweep: number, to: Pt, tol: number): Pt[] {
	if (dist(from, to) < 1e-9) return [];
	rx = Math.abs(rx);
	ry = Math.abs(ry);
	if (rx < 1e-9 || ry < 1e-9) return [to];
	const phi = (rotDeg * Math.PI) / 180;
	const cos = Math.cos(phi);
	const sin = Math.sin(phi);
	const dx = (from.x - to.x) / 2;
	const dy = (from.y - to.y) / 2;
	const x1 = cos * dx + sin * dy;
	const y1 = -sin * dx + cos * dy;
	const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
	if (lambda > 1) {
		rx *= Math.sqrt(lambda);
		ry *= Math.sqrt(lambda);
	}
	const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
	const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
	const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
	const cx1 = (coef * rx * y1) / ry;
	const cy1 = (-coef * ry * x1) / rx;
	const cx = cos * cx1 - sin * cy1 + (from.x + to.x) / 2;
	const cy = sin * cx1 + cos * cy1 + (from.y + to.y) / 2;
	const angle = (ux: number, uy: number, vx: number, vy: number) => {
		const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
		return a;
	};
	const t1 = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
	let dt = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
	if (!sweep && dt > 0) dt -= 2 * Math.PI;
	else if (sweep && dt < 0) dt += 2 * Math.PI;
	const steps = Math.max(4, Math.ceil((Math.abs(dt) * Math.max(rx, ry)) / tol));
	const out: Pt[] = [];
	for (let k = 1; k <= steps; k++) {
		const t = t1 + (dt * k) / steps;
		const ex = rx * Math.cos(t);
		const ey = ry * Math.sin(t);
		out.push(k === steps ? { ...to } : { x: cos * ex - sin * ey + cx, y: sin * ex + cos * ey + cy });
	}
	return out;
}

/**
 * Flatten path data into one polyline per subpath. `tol` is the target
 * segment length for curves and arcs (grid units). Straight segments keep
 * their exact vertices — corners stay crisp.
 */
export function flattenPath(d: string, tol = 0.2): Polyline[] {
	const out: Polyline[] = [];
	let cur: Pt = { x: 0, y: 0 };
	let start: Pt = { x: 0, y: 0 };
	let pts: Pt[] = [];
	let lastCtrl: Pt | null = null;
	let lastOp = "";
	const flush = (closed: boolean) => {
		const clean: Pt[] = [];
		for (const p of pts) {
			const prev = clean[clean.length - 1];
			if (!prev || dist(prev, p) > 1e-9) clean.push(p);
		}
		if (closed && clean.length > 1 && dist(clean[0]!, clean[clean.length - 1]!) < 1e-9) clean.pop();
		if (clean.length >= 2) out.push({ points: clean, closed });
		pts = [];
	};
	const curve = (p1: Pt, p2: Pt, p3: Pt) => {
		const approx = dist(cur, p1) + dist(p1, p2) + dist(p2, p3);
		const steps = Math.max(4, Math.ceil(approx / tol));
		for (let k = 1; k <= steps; k++) pts.push(k === steps ? { ...p3 } : cubicAt(cur, p1, p2, p3, k / steps));
	};
	for (const { op, args } of parsePath(d)) {
		const rel = op === op.toLowerCase();
		const O = op.toUpperCase();
		const ax = (v: number) => (rel ? cur.x + v : v);
		const ay = (v: number) => (rel ? cur.y + v : v);
		let ctrl: Pt | null = null;
		switch (O) {
			case "M": {
				if (pts.length) flush(false);
				cur = { x: ax(args[0]!), y: ay(args[1]!) };
				start = { ...cur };
				pts = [{ ...cur }];
				break;
			}
			case "L":
			case "H":
			case "V": {
				const next = O === "L" ? { x: ax(args[0]!), y: ay(args[1]!) } : O === "H" ? { x: ax(args[0]!), y: cur.y } : { x: cur.x, y: ay(args[0]!) };
				if (!pts.length) pts = [{ ...cur }];
				pts.push(next);
				cur = next;
				break;
			}
			case "C":
			case "S": {
				const p1: Pt = O === "C"
					? { x: ax(args[0]!), y: ay(args[1]!) }
					: lastCtrl && (lastOp === "C" || lastOp === "S") ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : { ...cur };
				const o = O === "C" ? 2 : 0;
				const p2 = { x: ax(args[o]!), y: ay(args[o + 1]!) };
				const p3 = { x: ax(args[o + 2]!), y: ay(args[o + 3]!) };
				if (!pts.length) pts = [{ ...cur }];
				curve(p1, p2, p3);
				cur = p3;
				ctrl = p2;
				break;
			}
			case "Q":
			case "T": {
				const q: Pt = O === "Q"
					? { x: ax(args[0]!), y: ay(args[1]!) }
					: lastCtrl && (lastOp === "Q" || lastOp === "T") ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : { ...cur };
				const o = O === "Q" ? 2 : 0;
				const p3 = { x: ax(args[o]!), y: ay(args[o + 1]!) };
				const p1 = { x: cur.x + (2 / 3) * (q.x - cur.x), y: cur.y + (2 / 3) * (q.y - cur.y) };
				const p2 = { x: p3.x + (2 / 3) * (q.x - p3.x), y: p3.y + (2 / 3) * (q.y - p3.y) };
				if (!pts.length) pts = [{ ...cur }];
				curve(p1, p2, p3);
				cur = p3;
				ctrl = q;
				break;
			}
			case "A": {
				const to = { x: ax(args[5]!), y: ay(args[6]!) };
				if (!pts.length) pts = [{ ...cur }];
				pts.push(...arcPoints(cur, args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, to, tol));
				cur = to;
				break;
			}
			case "Z": {
				flush(true);
				cur = { ...start };
				break;
			}
		}
		lastCtrl = ctrl;
		lastOp = O;
	}
	if (pts.length) flush(false);
	return out;
}

/** Total length of a polyline (closing segment included when closed). */
export function polylineLength(line: Polyline): number {
	let L = 0;
	const p = line.points;
	for (let i = 1; i < p.length; i++) L += dist(p[i - 1]!, p[i]!);
	if (line.closed && p.length > 1) L += dist(p[p.length - 1]!, p[0]!);
	return L;
}

/**
 * Resample at ~`step` arc length, keeping every source vertex (each
 * segment is split evenly), with unit normals from central differences.
 * Closed lines end back on their first point (s = total length).
 */
export function resample(line: Polyline, step: number): Sample[] {
	const src = line.closed ? [...line.points, line.points[0]!] : line.points;
	const pts: { x: number; y: number; s: number }[] = [{ x: src[0]!.x, y: src[0]!.y, s: 0 }];
	let s = 0;
	for (let i = 1; i < src.length; i++) {
		const a = src[i - 1]!;
		const b = src[i]!;
		const len = dist(a, b);
		const n = Math.max(1, Math.ceil(len / step));
		for (let k = 1; k <= n; k++) {
			const t = k / n;
			pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, s: s + len * t });
		}
		s += len;
	}
	const last = pts.length - 1;
	return pts.map((p, i) => {
		// Closed: wrap around the seam so the start/end normal is smooth too.
		const prev = i > 0 ? pts[i - 1]! : line.closed ? pts[last - 1]! : p;
		const next = i < last ? pts[i + 1]! : line.closed ? pts[1]! : p;
		let tx = next.x - prev.x;
		let ty = next.y - prev.y;
		const tl = Math.hypot(tx, ty) || 1;
		tx /= tl;
		ty /= tl;
		return { x: p.x, y: p.y, nx: -ty, ny: tx, s: p.s };
	});
}
