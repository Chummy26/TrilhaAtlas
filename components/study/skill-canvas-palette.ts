import { CEL_RAMPS, shiftHex, type CelRamp, type SkillLayout, type SkillMapStyle, type SkillNode, type SkillPoint, type ThemeColors } from "@/src/core";

export const AREA_RAMPS: readonly CelRamp[] = Object.values(CEL_RAMPS);
export const TAU = Math.PI * 2;
export const TOP_GUTTER = 22;
export const BOTTOM_GUTTER = 76;
export const SIDE_GUTTER = 24;
export const MINIMAP_W = 164;
export const MINIMAP_H = 104;
export const MINIMAP_PAD = 12;
export const MINIMAP_SHADOW_PAD = 4;

export type Pixel = { x: number; y: number };
export type Viewport = { width: number; height: number; ratio: number };
export type Camera = Pixel & { zoom: number };
export type ZoneStats = Map<string, { completed: number; total: number }>;

export interface CanvasStrings {
	youAreHere: string;
	completed: string;
	inProgress: string;
	available: string;
	pending: string;
	inferred: string;
}

export interface AtlasPalette {
	dark: boolean;
	colors: ThemeColors;
	completedColor: string;
	inProgressColor: string;
	availableColor: string;
	beacon: string;
	beaconHalo: string;
	ink: string;
	progressTrack: string;
	elevationRail: string;
	overviewBranch: string;
	overviewTrunk: string;
	ambientPrePending: string;
	ambientOtherPending: string;
	ambientCompleted: string;
	preInColor: string;
	preOutColor: string;
	hierProminent: string;
	pendingDotFarFill: string;
	pendingDotStroke: string;
	landmarkShadow: string;
	fgShadow: string;
	completedHalo: string;
	inProgressHalo: string;
	closeSkillFill: string;
	closeSkillBorderDefault: string;
	closeSkillBorderCompleted: string;
	closeSkillBorderInProgress: string;
	minimapShadow: string;
	minimapBg: string;
	minimapBorder: string;
	minimapLensFill: string;
	badgeStroke: string;
	areaFillDone: string;
	areaStrokeDone: string;
	unitFillDone: string;
	unitStrokeDone: string;
	railGroove: string;
	railRim: string;
	metalBase: string;
	metalShade: string;
	metalHl: string;
	brassBase: string;
	brassShade: string;
	brassHl: string;
	clarityLaneBg: string;
	clarityLaneHeaderBg: string;
	clarityCardBg: string;
	clarityCardBorder: string;
	areaTints: string[];
	areaFillNormal: string[];
	areaStrokeNormal: string[];
	unitFillNormal: string[];
	unitStrokeNormal: string[];
	landmarkStroke: string[];
	minimapAreaFill: string[];
}

export function buildPalette(colors: ThemeColors, dark: boolean): AtlasPalette {
	const completedColor = dark ? CEL_RAMPS.mint.lite : CEL_RAMPS.mint.deep;
	const inProgressColor = dark ? CEL_RAMPS.amber.lite : CEL_RAMPS.amber.deep;
	const availableColor = dark ? CEL_RAMPS.sky.lite : CEL_RAMPS.sky.deep;
	const beacon = dark ? CEL_RAMPS.teal.lite : CEL_RAMPS.teal.deep;
	const borderHex = shiftHex(colors.border, 0);
	const mutedHex = shiftHex(colors.textMuted, 0);
	const surfaceHex = shiftHex(colors.surface, 0);
	const areaTints = AREA_RAMPS.map((ramp) => ramp[dark ? "lite" : "deep"]);

	return {
		dark,
		colors,
		completedColor,
		inProgressColor,
		availableColor,
		beacon,
		beaconHalo: beacon + "2a",
		ink: dark ? "#07070b" : colors.text,
		progressTrack: borderHex + (dark ? "38" : "2c"),
		elevationRail: borderHex + (dark ? "44" : "40"),
		overviewBranch: mutedHex + (dark ? "44" : "50"),
		overviewTrunk: mutedHex + (dark ? "72" : "78"),
		ambientPrePending: borderHex + "4e",
		ambientOtherPending: borderHex + "34",
		ambientCompleted: completedColor + (dark ? "72" : "66"),
		preInColor: dark ? CEL_RAMPS.sky.lite : CEL_RAMPS.sky.deep,
		preOutColor: dark ? CEL_RAMPS.mint.lite : CEL_RAMPS.mint.deep,
		hierProminent: dark ? CEL_RAMPS.volt.lite : CEL_RAMPS.volt.deep,
		pendingDotFarFill: borderHex + (dark ? "56" : "4e"),
		pendingDotStroke: borderHex + (dark ? "8c" : "7c"),
		landmarkShadow: dark ? "rgb(0 0 0 / 0.48)" : "rgb(30 27 46 / 0.16)",
		fgShadow: dark ? "rgb(0 0 0 / 0.56)" : "rgb(30 27 46 / 0.22)",
		completedHalo: completedColor + (dark ? "3c" : "2c"),
		inProgressHalo: inProgressColor + (dark ? "32" : "26"),
		closeSkillFill: surfaceHex + (dark ? "eb" : "f2"),
		closeSkillBorderDefault: borderHex + "62",
		closeSkillBorderCompleted: completedColor + "78",
		closeSkillBorderInProgress: inProgressColor + "78",
		minimapShadow: dark ? "rgb(0 0 0 / 0.45)" : "rgb(30 27 46 / 0.15)",
		minimapBg: surfaceHex + (dark ? "ec" : "f2"),
		minimapBorder: borderHex + "88",
		minimapLensFill: colors.accent + "1f",
		badgeStroke: completedColor + (dark ? "88" : "77"),
		areaFillDone: completedColor + (dark ? "15" : "10"),
		areaStrokeDone: completedColor + (dark ? "54" : "45"),
		unitFillDone: completedColor + (dark ? "1e" : "15"),
		unitStrokeDone: completedColor + (dark ? "66" : "55"),
		railGroove: dark ? "#070a0f" : "#d8cebb",
		railRim: dark ? "#2a3340" : "#f7f2e7",
		metalBase: dark ? "#262e39" : "#dfd7c7",
		metalShade: dark ? "#161b23" : "#bbb2a0",
		metalHl: dark ? "#404b5b" : "#f6f1e6",
		brassBase: dark ? "#8e7240" : "#c69948",
		brassShade: dark ? "#584423" : "#8d6726",
		brassHl: dark ? "#cfa968" : "#efd191",
		clarityLaneBg: dark ? "rgb(255 255 255 / 0.028)" : "rgb(30 27 46 / 0.026)",
		clarityLaneHeaderBg: dark ? "rgb(255 255 255 / 0.045)" : "rgb(30 27 46 / 0.042)",
		clarityCardBg: dark ? surfaceHex + "c8" : surfaceHex + "e6",
		clarityCardBorder: borderHex + (dark ? "52" : "4c"),
		areaTints,
		areaFillNormal: areaTints.map((c) => c + (dark ? "0a" : "07")),
		areaStrokeNormal: areaTints.map((c) => c + (dark ? "2e" : "26")),
		unitFillNormal: areaTints.map((c) => c + (dark ? "0c" : "08")),
		unitStrokeNormal: areaTints.map((c) => c + (dark ? "2c" : "24")),
		landmarkStroke: areaTints.map((c) => c + (dark ? "96" : "84")),
		minimapAreaFill: areaTints.map((c) => c + (dark ? "26" : "1d")),
	};
}

export class TextMetricsCache {
	private widths = new Map<string, number>();
	private truncated = new Map<string, string>();
	private wrapped = new Map<string, string[]>();

	clear() {
		this.widths.clear();
		this.truncated.clear();
		this.wrapped.clear();
	}

	measureWidth(ctx: CanvasRenderingContext2D, font: string, text: string): number {
		const key = `${font}\0${text}`;
		const cached = this.widths.get(key);
		if (cached !== undefined) return cached;
		if (ctx.font !== font) ctx.font = font;
		const w = ctx.measureText(text).width;
		if (this.widths.size > 4096) this.widths.clear();
		this.widths.set(key, w);
		return w;
	}

	truncate(ctx: CanvasRenderingContext2D, font: string, text: string, maxWidth: number): string {
		if (this.measureWidth(ctx, font, text) <= maxWidth) return text;
		const qWidth = Math.max(1, Math.floor(maxWidth / 4) * 4);
		const key = `${font}\0${qWidth}\0${text}`;
		const cached = this.truncated.get(key);
		if (cached !== undefined) return cached;

		if (ctx.font !== font) ctx.font = font;
		let lo = 1;
		let hi = text.length;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (ctx.measureText(text.slice(0, mid) + "…").width <= maxWidth) lo = mid;
			else hi = mid - 1;
		}
		const result = text.slice(0, lo) + "…";
		if (this.truncated.size > 2048) this.truncated.clear();
		this.truncated.set(key, result);
		return result;
	}

	wrapLines(ctx: CanvasRenderingContext2D, font: string, text: string, maxWidth: number, maxLines: number): string[] {
		if (this.measureWidth(ctx, font, text) <= maxWidth) return [text];
		const qWidth = Math.max(1, Math.floor(maxWidth / 4) * 4);
		const key = `${font}\0${qWidth}\0${maxLines}\0${text}`;
		const cached = this.wrapped.get(key);
		if (cached !== undefined) return cached;

		const words = text.split(/\s+/).filter(Boolean);
		const lines: string[] = [];
		let current = "";
		for (let i = 0; i < words.length; i++) {
			const word = words[i]!;
			const candidate = current ? `${current} ${word}` : word;
			if (this.measureWidth(ctx, font, candidate) <= maxWidth) {
				current = candidate;
				continue;
			}
			if (lines.length === maxLines - 1) {
				const tail = current ? `${current} ${words.slice(i).join(" ")}` : words.slice(i).join(" ");
				lines.push(this.truncate(ctx, font, tail, maxWidth));
				current = "";
				break;
			}
			if (current) {
				lines.push(current);
				current = word;
			} else {
				lines.push(this.truncate(ctx, font, word, maxWidth));
				current = "";
			}
		}
		if (current) lines.push(current);

		if (this.wrapped.size > 2048) this.wrapped.clear();
		this.wrapped.set(key, lines);
		return lines;
	}
}

export function effectivePointY(point: SkillPoint, style: SkillMapStyle, depth: number): number {
	if (style !== "constellation" && style !== "hextech" && style !== "citadel") return point.y;
	return point.y - (point.z ?? 0) * depth * 0.55;
}

export function fitZoom(layout: SkillLayout, viewport: Viewport) {
	return Math.min(
		1,
		Math.max(1, viewport.width - SIDE_GUTTER * 2) / Math.max(1, layout.width),
		Math.max(1, viewport.height - TOP_GUTTER - BOTTOM_GUTTER) / Math.max(1, layout.height),
	);
}

export function dotRadius(point: SkillPoint, zoom: number) {
	return Math.max(point.kind === "atom" ? 2.1 : 3.2, Math.min(18, point.radius * zoom));
}

export function computeZoneStats(nodes: readonly SkillNode[]): ZoneStats {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const stats: ZoneStats = new Map();
	const bump = (id: string, done: boolean) => {
		const entry = stats.get(id) ?? { completed: 0, total: 0 };
		entry.total++;
		if (done) entry.completed++;
		stats.set(id, entry);
	};
	for (const node of nodes) {
		if (!node.leaf || node.reinforcementFor) continue;
		if (node.region) bump(node.region, node.completed);
		let cur: SkillNode | undefined = node;
		while (cur && cur.kind !== "area" && cur.kind !== "domain") {
			cur = cur.parent ? byId.get(cur.parent) : undefined;
		}
		if (cur?.kind === "area") bump(cur.id, node.completed);
	}
	return stats;
}

export interface MinimapCache {
	canvas: HTMLCanvasElement;
	ratio: number;
	ms: number;
	ox: number;
	oy: number;
}

export function buildMinimapCache(
	layout: SkillLayout,
	nodes: Map<string, SkillNode>,
	palette: AtlasPalette,
	current: string | undefined,
	ratio: number,
): MinimapCache {
	const canvas = document.createElement("canvas");
	canvas.width = Math.round((MINIMAP_W + MINIMAP_SHADOW_PAD) * ratio);
	canvas.height = Math.round((MINIMAP_H + MINIMAP_SHADOW_PAD) * ratio);
	const mctx = canvas.getContext("2d")!;
	mctx.setTransform(ratio, 0, 0, ratio, 0, 0);

	const innerPad = 8;
	const scaleX = (MINIMAP_W - innerPad * 2) / Math.max(1, layout.width);
	const scaleY = (MINIMAP_H - innerPad * 2) / Math.max(1, layout.height);
	const ms = Math.min(scaleX, scaleY);
	const ox = (MINIMAP_W - layout.width * ms) / 2;
	const oy = (MINIMAP_H - layout.height * ms) / 2;

	mctx.beginPath();
	mctx.roundRect(2, 2, MINIMAP_W, MINIMAP_H, 12);
	mctx.fillStyle = palette.minimapShadow;
	mctx.fill();

	mctx.beginPath();
	mctx.roundRect(0, 0, MINIMAP_W, MINIMAP_H, 12);
	mctx.fillStyle = palette.minimapBg;
	mctx.fill();
	mctx.strokeStyle = palette.minimapBorder;
	mctx.lineWidth = 1.25;
	mctx.stroke();
	mctx.clip();

	// Style-aware minimap silhouettes
	for (const zone of layout.zones) {
		if (zone.heading !== "area") continue;
		mctx.fillStyle = palette.minimapAreaFill[zone.color % palette.minimapAreaFill.length]!;
		mctx.fillRect(ox + zone.x * ms, oy + zone.y * ms, Math.max(2, zone.width * ms), Math.max(2, zone.height * ms));
	}
	for (const gear of layout.gears) {
		mctx.beginPath();
		mctx.arc(ox + gear.cx * ms, oy + gear.cy * ms, Math.max(2, gear.radius * ms), 0, TAU);
		mctx.fillStyle = palette.minimapAreaFill[gear.color % palette.minimapAreaFill.length]!;
		mctx.fill();
	}
	for (const cluster of layout.hexClusters) {
		mctx.beginPath();
		mctx.arc(ox + cluster.cx * ms, oy + cluster.cy * ms, Math.max(2, cluster.radius * ms * 0.85), 0, TAU);
		mctx.fillStyle = palette.minimapAreaFill[cluster.color % palette.minimapAreaFill.length]!;
		mctx.fill();
	}
	for (const wheel of layout.wheels) {
		mctx.beginPath();
		mctx.arc(ox + wheel.cx * ms, oy + wheel.cy * ms, Math.max(1.5, wheel.radius * ms), 0, TAU);
		mctx.fillStyle = palette.minimapAreaFill[wheel.color % palette.minimapAreaFill.length]!;
		mctx.fill();
	}

	mctx.fillStyle = palette.completedColor;
	for (const point of layout.points.values()) {
		const node = nodes.get(point.id);
		if (!node || point.id === current || !node.completed) continue;
		const px = ox + point.x * ms;
		const py = oy + point.y * ms;
		mctx.fillRect(px - 1.1, py - 1.1, 2.2, 2.2);
	}
	mctx.fillStyle = palette.inProgressColor;
	for (const point of layout.points.values()) {
		const node = nodes.get(point.id);
		if (!node || point.id === current || node.completed || !node.inProgress) continue;
		const px = ox + point.x * ms;
		const py = oy + point.y * ms;
		mctx.fillRect(px - 1.2, py - 1.2, 2.4, 2.4);
	}
	if (current) {
		const pt = layout.points.get(current);
		if (pt) {
			mctx.fillStyle = palette.beacon;
			mctx.beginPath();
			mctx.arc(ox + pt.x * ms, oy + pt.y * ms, 3.2, 0, TAU);
			mctx.fill();
		}
	}

	return { canvas, ratio, ms, ox, oy };
}

// ─── Crisp Vector Glyphs & RPG Sockets ──────────────────────────────────────

export function drawCheckGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, stroke: string) {
	ctx.save();
	ctx.beginPath();
	ctx.moveTo(x - r * 0.42, y + r * 0.04);
	ctx.lineTo(x - r * 0.1, y + r * 0.36);
	ctx.lineTo(x + r * 0.46, y - r * 0.34);
	ctx.strokeStyle = stroke;
	ctx.lineWidth = Math.max(1.6, r * 0.25);
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.stroke();
	ctx.restore();
}

export function drawPlayGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
	ctx.save();
	ctx.beginPath();
	ctx.moveTo(x - r * 0.26, y - r * 0.38);
	ctx.lineTo(x + r * 0.44, y);
	ctx.lineTo(x - r * 0.26, y + r * 0.38);
	ctx.closePath();
	ctx.fillStyle = fill;
	ctx.fill();
	ctx.restore();
}

export function drawLockGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
	ctx.save();
	ctx.strokeStyle = color;
	ctx.fillStyle = color;
	ctx.lineWidth = Math.max(1.1, r * 0.16);
	const bw = r * 0.72;
	const bh = r * 0.54;
	ctx.beginPath();
	ctx.arc(x, y - bh * 0.32, bw * 0.28, Math.PI, 0);
	ctx.stroke();
	ctx.beginPath();
	ctx.roundRect(x - bw / 2, y - bh * 0.32, bw, bh, 1.8);
	ctx.fill();
	ctx.restore();
}

export function drawStarGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
	ctx.save();
	ctx.beginPath();
	for (let i = 0; i < 8; i++) {
		const a = (i / 8) * TAU - Math.PI / 2;
		const rad = i % 2 === 0 ? r * 0.58 : r * 0.24;
		const px = x + Math.cos(a) * rad;
		const py = y + Math.sin(a) * rad;
		if (i === 0) ctx.moveTo(px, py);
		else ctx.lineTo(px, py);
	}
	ctx.closePath();
	ctx.fillStyle = fill;
	ctx.fill();
	ctx.restore();
}

export function drawKeystoneSocket(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	r: number,
	ramp: CelRamp,
	progress: number,
	palette: AtlasPalette,
	isFocus: boolean,
	isRoot: boolean,
) {
	const coreRamp = isRoot ? CEL_RAMPS.teal : ramp;

	// Ambient cel halo
	if (r >= 6) {
		ctx.beginPath();
		ctx.arc(x, y, r * 1.48, 0, TAU);
		ctx.fillStyle = coreRamp.base + (palette.dark ? "24" : "1c");
		ctx.fill();
	}

	// Hard offset shadow
	ctx.beginPath();
	for (let i = 0; i < 8; i++) {
		const a = (i / 8) * TAU + Math.PI / 8;
		const rad = i % 2 === 0 ? r * 1.16 : r * 0.94;
		const px = x + 1.8 + Math.cos(a) * rad;
		const py = y + 2.2 + Math.sin(a) * rad;
		if (i === 0) ctx.moveTo(px, py);
		else ctx.lineTo(px, py);
	}
	ctx.closePath();
	ctx.fillStyle = palette.fgShadow;
	ctx.fill();

	// Ornate octagonal brass bezel
	ctx.beginPath();
	for (let i = 0; i < 8; i++) {
		const a = (i / 8) * TAU + Math.PI / 8;
		const rad = i % 2 === 0 ? r * 1.16 : r * 0.94;
		const px = x + Math.cos(a) * rad;
		const py = y + Math.sin(a) * rad;
		if (i === 0) ctx.moveTo(px, py);
		else ctx.lineTo(px, py);
	}
	ctx.closePath();
	ctx.fillStyle = palette.brassBase;
	ctx.fill();
	ctx.strokeStyle = isFocus ? CEL_RAMPS.volt.base : palette.ink;
	ctx.lineWidth = isFocus ? 2.2 : 1.5;
	ctx.stroke();

	if (progress > 0) {
		ctx.beginPath();
		ctx.arc(x, y, r * 1.32, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, progress));
		ctx.strokeStyle = palette.completedColor;
		ctx.lineWidth = 2.4;
		ctx.lineCap = "round";
		ctx.stroke();
	}

	// Inner 3-tone cel jewel
	ctx.beginPath();
	ctx.arc(x, y, r * 0.76, 0, TAU);
	ctx.fillStyle = coreRamp.base;
	ctx.fill();
	if (r >= 5.5) {
		ctx.beginPath();
		ctx.arc(x - r * 0.22, y - r * 0.22, r * 0.3, 0, TAU);
		ctx.fillStyle = coreRamp.hl;
		ctx.fill();
	}
	ctx.beginPath();
	ctx.arc(x, y, r * 0.76, 0, TAU);
	ctx.strokeStyle = palette.ink;
	ctx.lineWidth = 1.2;
	ctx.stroke();

	if (r >= 9.5) {
		drawStarGlyph(ctx, x, y, r * 0.72, palette.dark ? "#07070b" : "#ffffff");
	}
}

export function drawNotableSocket(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	r: number,
	node: SkillNode,
	ramp: CelRamp,
	progress: number,
	palette: AtlasPalette,
	isFocus: boolean,
) {
	const active = node.completed || node.inProgress || node.state === "available" || progress > 0;
	const fill = node.completed ? CEL_RAMPS.mint.base : node.inProgress ? CEL_RAMPS.amber.base : active ? ramp.base : palette.colors.surface;
	const hl = node.completed ? CEL_RAMPS.mint.hl : node.inProgress ? CEL_RAMPS.amber.hl : ramp.hl;

	if (active && r >= 5) {
		ctx.beginPath();
		ctx.arc(x + 1.5, y + 1.9, r * 1.02, 0, TAU);
		ctx.fillStyle = palette.landmarkShadow;
		ctx.fill();
	}

	// Hexagonal RPG frame
	ctx.beginPath();
	for (let i = 0; i < 6; i++) {
		const a = (i / 6) * TAU - Math.PI / 6;
		const px = x + Math.cos(a) * r * 1.08;
		const py = y + Math.sin(a) * r * 1.08;
		if (i === 0) ctx.moveTo(px, py);
		else ctx.lineTo(px, py);
	}
	ctx.closePath();
	ctx.fillStyle = active ? palette.brassBase : palette.metalShade;
	ctx.fill();
	ctx.strokeStyle = isFocus ? CEL_RAMPS.volt.base : active ? palette.ink : palette.pendingDotStroke;
	ctx.lineWidth = isFocus ? 2 : 1.25;
	ctx.stroke();

	// Inner hex gem
	ctx.beginPath();
	for (let i = 0; i < 6; i++) {
		const a = (i / 6) * TAU - Math.PI / 6;
		const px = x + Math.cos(a) * r * 0.72;
		const py = y + Math.sin(a) * r * 0.72;
		if (i === 0) ctx.moveTo(px, py);
		else ctx.lineTo(px, py);
	}
	ctx.closePath();
	ctx.fillStyle = fill;
	ctx.fill();

	if (active && r >= 5.5) {
		ctx.beginPath();
		ctx.arc(x - r * 0.2, y - r * 0.2, r * 0.24, 0, TAU);
		ctx.fillStyle = hl;
		ctx.fill();
	}
	if (node.completed && r >= 7.5) {
		drawCheckGlyph(ctx, x, y, r * 0.74, palette.dark ? "#07070b" : "#ffffff");
	}
	if (progress > 0 && r >= 5) {
		ctx.beginPath();
		ctx.arc(x, y, r * 1.32, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, progress));
		ctx.strokeStyle = palette.completedColor;
		ctx.lineWidth = 1.9;
		ctx.stroke();
	}
}

export function drawSkillRail(
	ctx: CanvasRenderingContext2D,
	ax: number,
	ay: number,
	bx: number,
	by: number,
	lit: boolean,
	color: string,
	width: number,
	palette: AtlasPalette,
) {
	ctx.lineCap = "round";
	ctx.beginPath();
	ctx.moveTo(ax, ay);
	ctx.lineTo(bx, by);
	ctx.strokeStyle = palette.railGroove;
	ctx.lineWidth = width + 2;
	ctx.stroke();

	ctx.beginPath();
	ctx.moveTo(ax, ay);
	ctx.lineTo(bx, by);
	ctx.strokeStyle = lit ? color : palette.railRim;
	ctx.lineWidth = lit ? width : Math.max(0.85, width * 0.55);
	ctx.stroke();
}

export function drawGearWheel(
	ctx: CanvasRenderingContext2D,
	sx: number,
	sy: number,
	r: number,
	teeth: number,
	rot: number,
	ramp: CelRamp,
	active: boolean,
	palette: AtlasPalette,
	depthPx: number,
) {
	const outerR = r * 1.07;
	const innerR = r * 0.96;

	const traceGear = (ox: number, oy: number) => {
		ctx.beginPath();
		const step = TAU / teeth;
		for (let i = 0; i < teeth; i++) {
			const a0 = rot + i * step;
			const a1 = a0 + step * 0.22;
			const a2 = a0 + step * 0.48;
			const a3 = a0 + step * 0.7;
			const p0x = ox + Math.cos(a0) * innerR;
			const p0y = oy + Math.sin(a0) * innerR;
			if (i === 0) ctx.moveTo(p0x, p0y);
			else ctx.lineTo(p0x, p0y);
			ctx.lineTo(ox + Math.cos(a1) * outerR, oy + Math.sin(a1) * outerR);
			ctx.lineTo(ox + Math.cos(a2) * outerR, oy + Math.sin(a2) * outerR);
			ctx.lineTo(ox + Math.cos(a3) * innerR, oy + Math.sin(a3) * innerR);
		}
		ctx.closePath();
	};

	if (depthPx > 1) {
		traceGear(sx, sy + depthPx);
		ctx.fillStyle = palette.metalShade;
		ctx.fill();
		ctx.strokeStyle = palette.ink;
		ctx.lineWidth = 1.1;
		ctx.stroke();
	}

	traceGear(sx, sy);
	ctx.fillStyle = palette.metalBase;
	ctx.fill();
	ctx.strokeStyle = active ? palette.brassHl : palette.ink;
	ctx.lineWidth = active ? 1.6 : 1.2;
	ctx.stroke();

	ctx.beginPath();
	ctx.arc(sx, sy, r * 0.85, 0, TAU);
	ctx.fillStyle = palette.dark ? "#131820" : "#efe8d8";
	ctx.fill();
	ctx.strokeStyle = ramp.base + (active ? "9e" : "44");
	ctx.lineWidth = 1.8;
	ctx.stroke();

	if (r >= 24) {
		ctx.save();
		ctx.strokeStyle = palette.brassShade + "7a";
		ctx.lineWidth = Math.max(1.1, r * 0.04);
		for (let k = 0; k < 6; k++) {
			const a = rot + (k / 6) * TAU;
			ctx.beginPath();
			ctx.moveTo(sx + Math.cos(a) * r * 0.16, sy + Math.sin(a) * r * 0.16);
			ctx.lineTo(sx + Math.cos(a) * r * 0.83, sy + Math.sin(a) * r * 0.83);
			ctx.stroke();
		}
		ctx.restore();

		ctx.beginPath();
		ctx.arc(sx, sy, r * 0.58, 0, TAU);
		ctx.strokeStyle = active ? ramp.base + "72" : palette.progressTrack;
		ctx.lineWidth = 2;
		ctx.stroke();
	}
}

export function drawHexPrism(
	ctx: CanvasRenderingContext2D,
	sx: number,
	sy: number,
	r: number,
	extrudeH: number,
	topColor: string,
	leftColor: string,
	rightColor: string,
	ink: string,
	highlight: boolean,
) {
	const squash = 0.72;
	const px: number[] = [];
	const py: number[] = [];
	for (let i = 0; i < 6; i++) {
		const a = (i / 6) * TAU + Math.PI / 6;
		px.push(sx + Math.cos(a) * r);
		py.push(sy + Math.sin(a) * r * squash);
	}

	if (extrudeH > 1.2) {
		// Left-front wall (1 -> 2)
		ctx.beginPath();
		ctx.moveTo(px[1]!, py[1]!);
		ctx.lineTo(px[2]!, py[2]!);
		ctx.lineTo(px[2]!, py[2]! + extrudeH);
		ctx.lineTo(px[1]!, py[1]! + extrudeH);
		ctx.closePath();
		ctx.fillStyle = leftColor;
		ctx.fill();
		ctx.strokeStyle = ink;
		ctx.lineWidth = 0.8;
		ctx.stroke();

		// Right-front wall (0 -> 1)
		ctx.beginPath();
		ctx.moveTo(px[0]!, py[0]!);
		ctx.lineTo(px[1]!, py[1]!);
		ctx.lineTo(px[1]!, py[1]! + extrudeH);
		ctx.lineTo(px[0]!, py[0]! + extrudeH);
		ctx.closePath();
		ctx.fillStyle = rightColor;
		ctx.fill();
		ctx.strokeStyle = ink;
		ctx.lineWidth = 0.8;
		ctx.stroke();

		// Far-left side wall (2 -> 3)
		ctx.beginPath();
		ctx.moveTo(px[2]!, py[2]!);
		ctx.lineTo(px[3]!, py[3]!);
		ctx.lineTo(px[3]!, py[3]! + extrudeH);
		ctx.lineTo(px[2]!, py[2]! + extrudeH);
		ctx.closePath();
		ctx.fillStyle = leftColor;
		ctx.fill();
		ctx.strokeStyle = ink;
		ctx.lineWidth = 0.8;
		ctx.stroke();
	}

	ctx.beginPath();
	ctx.moveTo(px[0]!, py[0]!);
	for (let i = 1; i < 6; i++) ctx.lineTo(px[i]!, py[i]!);
	ctx.closePath();
	ctx.fillStyle = topColor;
	ctx.fill();
	ctx.strokeStyle = highlight ? CEL_RAMPS.volt.base : ink;
	ctx.lineWidth = highlight ? 2 : 0.95;
	ctx.stroke();
}
