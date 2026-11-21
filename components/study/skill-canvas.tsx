"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useAppearance } from "@/components/settings/appearance";
import { Icon } from "@/components/icons/icon";
import { CEL_RAMPS, shiftHex, type ThemeColors, layoutSkillMap, type SkillEdge, type SkillLayout, type SkillMap, type SkillNode, type SkillPoint } from "@/src/core";

const AREA_RAMPS = Object.values(CEL_RAMPS);

const TAU = Math.PI * 2;
const TOP_GUTTER = 52;
const BOTTOM_GUTTER = 82;
const SIDE_GUTTER = 24;
const MINIMAP_W = 164;
const MINIMAP_H = 104;
const MINIMAP_PAD = 12;

type Pixel = { x: number; y: number };
type Viewport = { width: number; height: number; ratio: number };
type Camera = Pixel & { zoom: number };
type MapControls = { scale: (factor: number) => void; reset: () => void; reveal: (id: string, focus?: boolean) => void };
type ZoneStats = Map<string, { completed: number; total: number }>;

const STATUS_LABEL: Record<string, string> = {
	completed: "Concluído",
	inProgress: "Em andamento",
	available: "Disponível",
	locked: "Pendente",
	known: "Inferido",
};

function tint(color: number, dark: boolean) {
	return AREA_RAMPS[color % AREA_RAMPS.length]![dark ? "lite" : "deep"];
}

function fitZoom(layout: SkillLayout, viewport: Viewport) {
	return Math.min(
		1,
		Math.max(1, viewport.width - SIDE_GUTTER * 2) / layout.width,
		Math.max(1, viewport.height - TOP_GUTTER - BOTTOM_GUTTER) / layout.height,
	);
}

function dotRadius(point: SkillPoint, zoom: number) {
	return Math.max(point.kind === "atom" ? 1.75 : 2.6, Math.min(16, point.radius * zoom));
}

function computeZoneStats(nodes: readonly SkillNode[]): ZoneStats {
	const byId = new Map(nodes.map(n => [n.id, n]));
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

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
	if (ctx.measureText(text).width <= maxWidth) return [text];
	const words = text.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let current = "";
	for (let i = 0; i < words.length; i++) {
		const word = words[i]!;
		const candidate = current ? `${current} ${word}` : word;
		if (ctx.measureText(candidate).width <= maxWidth) {
			current = candidate;
			continue;
		}
		if (lines.length === maxLines - 1) {
			let tail = current ? `${current} ${words.slice(i).join(" ")}` : words.slice(i).join(" ");
			while (tail.length > 1 && ctx.measureText(tail + "…").width > maxWidth) tail = tail.slice(0, -1);
			lines.push(tail + "…");
			return lines;
		}
		if (current) {
			lines.push(current);
			current = word;
		} else {
			let chunk = word;
			while (chunk.length > 1 && ctx.measureText(chunk + "…").width > maxWidth) chunk = chunk.slice(0, -1);
			lines.push(chunk + "…");
			current = "";
		}
	}
	if (current) lines.push(current);
	return lines;
}

function drawCheckGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, stroke: string) {
	ctx.save();
	ctx.beginPath();
	ctx.moveTo(x - r * 0.42, y + r * 0.02);
	ctx.lineTo(x - r * 0.1, y + r * 0.36);
	ctx.lineTo(x + r * 0.46, y - r * 0.34);
	ctx.strokeStyle = stroke;
	ctx.lineWidth = Math.max(1.5, r * 0.24);
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.stroke();
	ctx.restore();
}

function drawPlayGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
	ctx.save();
	ctx.beginPath();
	ctx.moveTo(x - r * 0.24, y - r * 0.34);
	ctx.lineTo(x + r * 0.42, y);
	ctx.lineTo(x - r * 0.24, y + r * 0.34);
	ctx.closePath();
	ctx.fillStyle = fill;
	ctx.fill();
	ctx.restore();
}

function drawLockGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
	ctx.save();
	ctx.strokeStyle = color;
	ctx.fillStyle = color;
	ctx.lineWidth = Math.max(1.1, r * 0.15);
	const bw = r * 0.68;
	const bh = r * 0.52;
	ctx.beginPath();
	ctx.arc(x, y - bh * 0.35, bw * 0.28, Math.PI, 0);
	ctx.stroke();
	ctx.beginPath();
	ctx.roundRect(x - bw / 2, y - bh * 0.35, bw, bh, 1.5);
	ctx.fill();
	ctx.restore();
}

function drawAtlas(
	ctx: CanvasRenderingContext2D,
	layout: SkillLayout,
	nodes: Map<string, SkillNode>,
	zoneStats: ZoneStats,
	view: Viewport,
	camera: Camera,
	selected: string,
	hovered: string | undefined,
	current: string | undefined,
	colors: ThemeColors,
	dark: boolean,
	fontFamily: string,
) {
	const { width, height, ratio } = view;
	const { zoom } = camera;
	const fit = fitZoom(layout, view);
	const relativeZoom = zoom / fit;
	const project = (point: Pixel): Pixel => ({ x: camera.x + point.x * zoom, y: camera.y + point.y * zoom });
	const visible = (p: Pixel, margin = 24) => p.x >= -margin && p.y >= -margin && p.x <= width + margin && p.y <= height + margin;
	const focusId = hovered ?? selected;

	const completedColor = dark ? CEL_RAMPS.mint.lite : CEL_RAMPS.mint.deep;
	const inProgressColor = dark ? CEL_RAMPS.amber.lite : CEL_RAMPS.amber.deep;
	const beacon = dark ? CEL_RAMPS.teal.lite : CEL_RAMPS.teal.deep;
	const ink = dark ? "#07070b" : colors.text;

	ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
	ctx.clearRect(0, 0, width, height);

	// 1. Area and unit zones — crisp cartographic regions with embedded progress meters
	for (const zone of layout.zones) {
		const { x, y } = project(zone);
		const w = zone.width * zoom;
		const h = zone.height * zoom;
		if (x > width || y > height || x + w < 0 || y + h < 0) continue;
		const areaColor = tint(zone.color, dark);
		const zStat = zoneStats.get(zone.id);
		const fraction = zStat && zStat.total > 0 ? zStat.completed / zStat.total : 0;
		const zoneDone = fraction >= 1;
		const hasProgress = fraction > 0;

		ctx.beginPath();
		if (zone.heading === "area") {
			const rad = Math.min(20, w / 4, h / 4);
			ctx.roundRect(x, y, w, h, rad);
			ctx.fillStyle = (zoneDone ? completedColor : areaColor) + (zoneDone ? (dark ? "15" : "10") : (dark ? "08" : "06"));
			ctx.fill();
			ctx.strokeStyle = (zoneDone ? completedColor : areaColor) + (zoneDone ? (dark ? "54" : "45") : (dark ? "28" : "22"));
			ctx.lineWidth = relativeZoom >= 1.8 ? 1.5 : 1.15;
			ctx.stroke();

			// Progress bar along top edge of area when progress > 0
			if (hasProgress && w > 54) {
				const barW = Math.max(8, Math.min(w - 24, (w - 24) * fraction));
				ctx.beginPath();
				ctx.roundRect(x + 12, y - 1.5, w - 24, 3, 2);
				ctx.fillStyle = shiftHex(colors.border, 0) + (dark ? "38" : "2c");
				ctx.fill();
				ctx.beginPath();
				ctx.roundRect(x + 12, y - 1.5, barW, 3, 2);
				ctx.fillStyle = completedColor;
				ctx.fill();
			}

			// Area progress pill in top-right corner when there is room
			if (hasProgress && zStat && w >= 120) {
				const badge = `${zStat.completed}/${zStat.total}`;
				ctx.font = `700 ${relativeZoom >= 1.8 ? 11 : 10}px ${fontFamily}`;
				const bw = ctx.measureText(badge).width + 12;
				const bx = x + w - bw - 8;
				const by = y + 6;
				if (bx > x + 60 && by > 2 && by < height - 18) {
					ctx.beginPath();
					ctx.roundRect(bx, by, bw, 17, 999);
					ctx.fillStyle = colors.surface;
					ctx.fill();
					ctx.strokeStyle = completedColor + (dark ? "88" : "77");
					ctx.lineWidth = 1;
					ctx.stroke();
					ctx.textBaseline = "middle";
					ctx.fillStyle = completedColor;
					ctx.fillText(badge, bx + 6, by + 9);
				}
			}
		} else {
			const rad = Math.min(12, w / 4, h / 4);
			ctx.roundRect(x, y, w, h, rad);
			ctx.fillStyle = zoneDone
				? completedColor + (dark ? "1e" : "15")
				: areaColor + (dark ? "0a" : "07");
			ctx.fill();
			if (zoneDone || relativeZoom >= 1.25) {
				ctx.strokeStyle = zoneDone ? completedColor + (dark ? "66" : "55") : areaColor + (dark ? "28" : "22");
				ctx.lineWidth = zoneDone ? 1.25 : 0.9;
				ctx.stroke();
			}
			// Unit header bar and progress counter when zoomed in
			if (relativeZoom >= 1.65 && w >= 92 && h >= 44) {
				const unitNode = nodes.get(zone.id);
				if (unitNode) {
					const unitPt = layout.points.get(zone.id);
					const leftInset = unitPt ? Math.max(12, project(unitPt).x - x + dotRadius(unitPt, zoom) + 8) : 10;
					ctx.font = `600 11px ${fontFamily}`;
					ctx.textBaseline = "top";
					const countText = zStat && zStat.total > 0 ? `${zStat.completed}/${zStat.total}` : "";
					const countW = countText ? ctx.measureText(countText).width + 10 : 0;
					const maxTitleW = Math.max(24, w - leftInset - 8 - countW);
					let title = unitNode.title;
					if (ctx.measureText(title).width > maxTitleW) {
						while (title.length > 1 && ctx.measureText(title + "…").width > maxTitleW) title = title.slice(0, -1);
						title += "…";
					}
					ctx.fillStyle = zoneDone ? completedColor : areaColor;
					ctx.fillText(title, x + leftInset, y + 6);
					if (countText) {
						ctx.fillStyle = hasProgress ? completedColor : colors.textMuted;
						ctx.fillText(countText, x + w - countW + 2, y + 6);
					}
				}
			}
		}
	}

	// 1b. Subtle vertical elevation cue at overview zoom (Foundations at base → Advanced at crown)
	if (relativeZoom < 1.5 && width >= 540 && height >= 320) {
		ctx.save();
		ctx.font = `600 10.5px ${fontFamily}`;
		ctx.textBaseline = "middle";
		const railX = 16;
		const topY = 24;
		const botY = height - 74;
		ctx.strokeStyle = shiftHex(colors.border, 0) + (dark ? "44" : "40");
		ctx.lineWidth = 1;
		ctx.setLineDash([3, 4]);
		ctx.beginPath();
		ctx.moveTo(railX, botY - 12);
		ctx.lineTo(railX, topY + 12);
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.fillStyle = colors.textMuted;
		ctx.fillText("↑ Avançado", railX - 4, topY);
		ctx.fillText("Base · Fundamentos", railX - 4, botY);
		ctx.restore();
	}

	// 2. Overview prerequisite links & root trunk branches flowing upward (base → crown)
	if (relativeZoom < 2.25) {
		const trunkPath = new Path2D();
		const branchPath = new Path2D();
		for (const link of layout.overviewLinks) {
			const from = project(link.from);
			const to = project(link.to);
			const dx = to.x - from.x;
			const dy = to.y - from.y;
			const length = Math.hypot(dx, dy);
			if (length < 12) continue;
			const isTrunk = link.from.kind === "domain";
			const target = isTrunk ? trunkPath : branchPath;
			if (isTrunk) {
				const midY = (from.y + to.y) / 2;
				target.moveTo(from.x, from.y - dotRadius(link.from, zoom));
				target.bezierCurveTo(from.x, midY, to.x, midY, to.x, to.y + dotRadius(link.to, zoom) + 2);
				continue;
			}
			const ux = dx / length;
			const uy = dy / length;
			const bend = Math.min(28, length * 0.12);
			const tx = to.x - ux * (dotRadius(link.to, zoom) + 4);
			const ty = to.y - uy * (dotRadius(link.to, zoom) + 4);
			const controlX = tx - dx * 0.33 + uy * bend;
			const controlY = ty - dy * 0.33 - ux * bend;
			target.moveTo(from.x, from.y);
			target.bezierCurveTo(from.x + dx * 0.33 + uy * bend, from.y + dy * 0.33 - ux * bend, controlX, controlY, tx, ty);
			const tangent = Math.hypot(tx - controlX, ty - controlY) || 1;
			const vx = (tx - controlX) / tangent;
			const vy = (ty - controlY) / tangent;
			const wing = length > 32 ? 3.2 : 2.2;
			target.moveTo(tx - vx * wing * 1.5 - vy * wing, ty - vy * wing * 1.5 + vx * wing);
			target.lineTo(tx, ty);
			target.lineTo(tx - vx * wing * 1.5 + vy * wing, ty - vy * wing * 1.5 - vx * wing);
		}
		ctx.strokeStyle = shiftHex(colors.textMuted, 0) + (dark ? "44" : "50");
		ctx.lineWidth = 1.1;
		ctx.stroke(branchPath);

		ctx.strokeStyle = shiftHex(colors.textMuted, 0) + (dark ? "72" : "78");
		ctx.lineWidth = 1.85;
		ctx.stroke(trunkPath);
	}

	// 3. Detailed edges (ambient vs prominent semantic dependencies)
	const preInColor = dark ? CEL_RAMPS.amber.lite : CEL_RAMPS.amber.deep;
	const preOutColor = dark ? CEL_RAMPS.mint.lite : CEL_RAMPS.mint.deep;
	const hierProminent = dark ? CEL_RAMPS.sky.lite : CEL_RAMPS.sky.deep;

	function drawEdgePath(from: Pixel, to: Pixel, sourceGap: number, targetGap: number, curved: boolean, arrow: boolean, prominent: boolean) {
		const dx = to.x - from.x;
		const dy = to.y - from.y;
		const length = Math.hypot(dx, dy);
		if (length < sourceGap + targetGap + 3) return;
		const ux = dx / length;
		const uy = dy / length;
		const sx = from.x + ux * sourceGap;
		const sy = from.y + uy * sourceGap;
		const tx = to.x - ux * targetGap;
		const ty = to.y - uy * targetGap;
		let vx = ux;
		let vy = uy;
		if (curved && length > 26) {
			const bend = Math.min(24, length * 0.13);
			const cx = (sx + tx) / 2 + uy * bend;
			const cy = (sy + ty) / 2 - ux * bend;
			ctx.moveTo(sx, sy);
			ctx.quadraticCurveTo(cx, cy, tx, ty);
			const tanLen = Math.hypot(tx - cx, ty - cy) || 1;
			vx = (tx - cx) / tanLen;
			vy = (ty - cy) / tanLen;
		} else {
			ctx.moveTo(sx, sy);
			ctx.lineTo(tx, ty);
		}
		if (arrow && length >= 15) {
			const wing = prominent ? 4.8 : 3.2;
			const bx = tx - vx * wing * 1.7;
			const by = ty - vy * wing * 1.7;
			ctx.moveTo(bx - vy * wing, by + vx * wing);
			ctx.lineTo(tx, ty);
			ctx.lineTo(bx + vy * wing, by - vx * wing);
		}
	}

	function drawAmbientEdges(kind: SkillEdge["kind"]) {
		const isPre = kind === "prerequisite";
		const completedPath = new Path2D();
		const pendingPath = new Path2D();
		for (const edge of layout.edges) {
			if (kind !== edge.kind) continue;
			const rootEdge = edge.from.kind === "domain" || edge.to.kind === "domain";
			const touchesActive = (!rootEdge || relativeZoom >= 1.5) && (edge.from.id === selected || edge.to.id === selected || edge.from.id === hovered || edge.to.id === hovered);
			if (touchesActive) continue;
			if (edge.crossesRegion && relativeZoom < 2.25) continue;
			const from = project(edge.from);
			const to = project(edge.to);
			if (Math.max(from.x, to.x) < -12 || Math.max(from.y, to.y) < -12 || Math.min(from.x, to.x) > width + 12 || Math.min(from.y, to.y) > height + 12) continue;
			const length = Math.hypot(to.x - from.x, to.y - from.y);
			if (edge.crossesRegion && length > Math.min(width, height) * (kind === "related" ? 0.35 : 0.75)) continue;
			const fromNode = nodes.get(edge.from.id);
			const toNode = nodes.get(edge.to.id);
			const bothDone = Boolean(fromNode?.completed && toNode?.completed);
			const target = bothDone ? completedPath : pendingPath;
			const sourceGap = dotRadius(edge.from, zoom);
			const targetGap = dotRadius(edge.to, zoom) + 1.5;
			const dx = to.x - from.x;
			const dy = to.y - from.y;
			if (length < sourceGap + targetGap + 3) continue;
			const ux = dx / length;
			const uy = dy / length;
			const sx = from.x + ux * sourceGap;
			const sy = from.y + uy * sourceGap;
			const tx = to.x - ux * targetGap;
			const ty = to.y - uy * targetGap;
			let vx = ux;
			let vy = uy;
			if (isPre && edge.crossesRegion && length > 26) {
				const bend = Math.min(22, length * 0.12);
				const cx = (sx + tx) / 2 + uy * bend;
				const cy = (sy + ty) / 2 - ux * bend;
				target.moveTo(sx, sy);
				target.quadraticCurveTo(cx, cy, tx, ty);
				const tanLen = Math.hypot(tx - cx, ty - cy) || 1;
				vx = (tx - cx) / tanLen;
				vy = (ty - cy) / tanLen;
			} else {
				target.moveTo(sx, sy);
				target.lineTo(tx, ty);
			}
			if (isPre && relativeZoom >= 1.9 && length >= 15) {
				const wing = 3.1;
				const bx = tx - vx * wing * 1.7;
				const by = ty - vy * wing * 1.7;
				target.moveTo(bx - vy * wing, by + vx * wing);
				target.lineTo(tx, ty);
				target.lineTo(bx + vy * wing, by - vx * wing);
			}
		}
		ctx.setLineDash(kind === "related" ? [3, 4] : []);
		ctx.strokeStyle = shiftHex(colors.border, 0) + (isPre ? "4e" : "34");
		ctx.lineWidth = isPre ? 0.85 : 0.7;
		ctx.stroke(pendingPath);

		ctx.strokeStyle = completedColor + (dark ? "72" : "66");
		ctx.lineWidth = relativeZoom >= 2 ? 1.5 : 1.1;
		ctx.stroke(completedPath);
	}

	function drawProminentEdges() {
		const buckets: { color: string; dash: number[]; width: number; list: SkillEdge[] }[] = [
			{ color: hierProminent, dash: [], width: 1.6, list: [] },
			{ color: colors.textMuted, dash: [4, 4], width: 1.5, list: [] },
			{ color: preInColor, dash: [], width: 2.2, list: [] },
			{ color: preOutColor, dash: [], width: 2.2, list: [] },
		];
		for (const edge of layout.edges) {
			const rootEdge = edge.from.kind === "domain" || edge.to.kind === "domain";
			const touchesActive = (!rootEdge || relativeZoom >= 1.5) && (edge.from.id === selected || edge.to.id === selected || edge.from.id === hovered || edge.to.id === hovered);
			if (!touchesActive) continue;
			if (edge.kind === "hierarchy") buckets[0]!.list.push(edge);
			else if (edge.kind === "related") buckets[1]!.list.push(edge);
			else if (edge.to.id === focusId) buckets[2]!.list.push(edge);
			else buckets[3]!.list.push(edge);
		}
		for (const bucket of buckets) {
			if (!bucket.list.length) continue;
			ctx.beginPath();
			ctx.strokeStyle = bucket.color;
			ctx.lineWidth = bucket.width;
			ctx.setLineDash(bucket.dash);
			for (const edge of bucket.list) {
				const from = project(edge.from);
				const to = project(edge.to);
				if (Math.max(from.x, to.x) < -24 || Math.max(from.y, to.y) < -24 || Math.min(from.x, to.x) > width + 24 || Math.min(from.y, to.y) > height + 24) continue;
				const isPre = edge.kind === "prerequisite";
				drawEdgePath(from, to, dotRadius(edge.from, zoom) + 1.5, dotRadius(edge.to, zoom) + 2.8, isPre, isPre, true);
			}
			ctx.stroke();
		}
	}

	for (const kind of ["hierarchy", "related", "prerequisite"] as const) drawAmbientEdges(kind);
	drawProminentEdges();
	ctx.setLineDash([]);

	// 4. Nodes — Multi-LOD rendering (distant overview contrast + crisp close-up cel-shading with icons)
	let visibleCount = 0;
	const foregroundPoints: { point: SkillPoint; screen: Pixel; node: SkillNode }[] = [];

	function drawShape(x: number, y: number, r: number, landmark: boolean) {
		ctx.beginPath();
		if (landmark) {
			const lr = r * 1.08;
			ctx.moveTo(x, y - lr);
			ctx.lineTo(x + lr, y);
			ctx.lineTo(x, y + lr);
			ctx.lineTo(x - lr, y);
			ctx.closePath();
		} else {
			ctx.arc(x, y, r, 0, TAU);
		}
	}

	// Pass A: pending / locked nodes and non-completed landmarks (calm recessed layer)
	for (const point of layout.points.values()) {
		const screen = project(point);
		if (!visible(screen)) continue;
		if (visible(screen, 0)) visibleCount++;
		const node = nodes.get(point.id)!;
		const active = point.id === selected || point.id === hovered || point.id === current;
		const highlight = active || node.completed || node.inProgress || (node.leaf && node.state === "available");
		if (highlight) {
			foregroundPoints.push({ point, screen, node });
			continue;
		}
		const radius = dotRadius(point, zoom);
		const landmark = point.kind === "domain" || point.kind === "area" || point.kind === "unit";
		if (landmark) {
			const areaColor = tint(point.color, dark);
			if (radius >= 6) {
				drawShape(screen.x + 1.5, screen.y + 1.5, radius, true);
				ctx.fillStyle = dark ? "rgb(0 0 0 / 0.45)" : "rgb(30 27 46 / 0.16)";
				ctx.fill();
			}
			drawShape(screen.x, screen.y, radius, true);
			ctx.fillStyle = colors.surface;
			ctx.fill();
			ctx.strokeStyle = areaColor + (dark ? "88" : "7c");
			ctx.lineWidth = radius >= 6 ? 1.6 : 1.15;
			ctx.stroke();
		} else {
			const r = relativeZoom < 1.8 ? Math.max(1.35, radius * 0.84) : radius * 0.92;
			drawShape(screen.x, screen.y, r, false);
			ctx.fillStyle = relativeZoom >= 2.6 ? colors.surface : shiftHex(colors.border, 0) + (dark ? "54" : "50");
			ctx.fill();
			if (relativeZoom >= 2.6) {
				ctx.strokeStyle = shiftHex(colors.border, 0) + (dark ? "8c" : "7c");
				ctx.lineWidth = 1.25;
				ctx.stroke();
				if (r >= 8.5) drawLockGlyph(ctx, screen.x, screen.y, r * 0.72, colors.textMuted);
			}
		}
	}

	// Pass B: completed, in-progress, available frontier, and active nodes (high-contrast foreground)
	for (const { point, screen, node } of foregroundPoints) {
		const baseRadius = dotRadius(point, zoom);
		const isSelected = point.id === selected;
		const isHovered = point.id === hovered;
		const active = isSelected || isHovered;
		const landmark = point.kind === "domain" || point.kind === "area" || point.kind === "unit";
		const radius = node.completed || node.inProgress
			? baseRadius + (relativeZoom < 1.8 && !landmark ? 0.95 : 0.45)
			: node.state === "available" && !landmark
				? baseRadius + (relativeZoom < 1.8 ? 0.6 : 0.25)
				: baseRadius;

		if (active || point.id === current) {
			ctx.beginPath();
			ctx.arc(screen.x, screen.y, radius + (isSelected ? 8 : 6.5), 0, TAU);
			ctx.fillStyle = colors.surface;
			ctx.fill();
			ctx.strokeStyle = isSelected ? colors.accent : colors.text;
			ctx.lineWidth = isSelected ? 2.4 : 1.6;
			ctx.stroke();
		}

		if (node.completed) {
			ctx.beginPath();
			ctx.arc(screen.x, screen.y, radius + (relativeZoom < 1.6 ? 2.2 : 3.4), 0, TAU);
			ctx.fillStyle = completedColor + (dark ? "3c" : "2c");
			ctx.fill();
		} else if (node.inProgress) {
			ctx.beginPath();
			ctx.arc(screen.x, screen.y, radius + (relativeZoom < 1.6 ? 2.5 : 4), 0, TAU);
			ctx.fillStyle = inProgressColor + (dark ? "32" : "26");
			ctx.fill();
			ctx.strokeStyle = inProgressColor;
			ctx.lineWidth = 1.5;
			ctx.setLineDash([2.8, 2.2]);
			ctx.stroke();
			ctx.setLineDash([]);
		}

		// Cel-shading hard offset shadow when zoomed in
		if (radius >= 6) {
			drawShape(screen.x + 1.8, screen.y + 1.8, radius, landmark);
			ctx.fillStyle = dark ? "rgb(0 0 0 / 0.55)" : "rgb(30 27 46 / 0.22)";
			ctx.fill();
		}

		drawShape(screen.x, screen.y, radius, landmark);
		if (node.completed) {
			ctx.fillStyle = completedColor;
		} else if (node.inProgress) {
			ctx.fillStyle = inProgressColor;
		} else if (node.state === "available") {
			ctx.fillStyle = colors.surface;
		} else if (landmark) {
			ctx.fillStyle = tint(point.color, dark);
		} else {
			ctx.fillStyle = colors.text;
		}
		ctx.fill();

		// Close-up interior glyphs (Multi-LOD)
		if (radius >= 6.8 && !landmark) {
			if (node.completed) {
				drawCheckGlyph(ctx, screen.x, screen.y, radius, dark ? "#07070b" : "#ffffff");
			} else if (node.inProgress) {
				ctx.beginPath();
				ctx.arc(screen.x, screen.y, radius * 0.34, 0, TAU);
				ctx.fillStyle = dark ? "#07070b" : "#ffffff";
				ctx.fill();
			} else if (node.state === "available") {
				drawPlayGlyph(ctx, screen.x, screen.y, radius * 0.72, colors.text);
			}
		} else if (node.completed && radius >= 4) {
			// Crisp specular highlight at mid zoom
			ctx.beginPath();
			ctx.arc(screen.x - radius * 0.28, screen.y - radius * 0.28, Math.max(1, radius * 0.24), 0, TAU);
			ctx.fillStyle = "rgb(255 255 255 / 0.6)";
			ctx.fill();
		}

		drawShape(screen.x, screen.y, radius, landmark);
		if (active) {
			ctx.strokeStyle = colors.text;
			ctx.lineWidth = 1.8;
		} else if (node.state === "available" && !node.completed && !node.inProgress) {
			ctx.strokeStyle = colors.text;
			ctx.lineWidth = relativeZoom < 1.8 ? 1.5 : 1.9;
		} else {
			ctx.strokeStyle = ink;
			ctx.lineWidth = radius >= 6 ? 1.5 : 1;
		}
		ctx.stroke();
	}

	// 5. Paint the learner position beacon last so crowded neighbors cannot cover it
	const position = current && layout.points.get(current);
	if (position) {
		const { x, y } = project(position);
		if (visible({ x, y })) {
			const radius = Math.max(4.8, dotRadius(position, zoom));
			ctx.save();
			ctx.beginPath();
			ctx.arc(x, y, radius + 7, 0, TAU);
			ctx.fillStyle = beacon + "26";
			ctx.fill();
			ctx.strokeStyle = beacon;
			ctx.lineWidth = 2;
			ctx.stroke();

			ctx.beginPath();
			ctx.arc(x, y, radius + 1.2, 0, TAU);
			ctx.fillStyle = beacon;
			ctx.fill();
			ctx.strokeStyle = colors.surface;
			ctx.lineWidth = 2;
			ctx.stroke();
			ctx.restore();
		}
	}

	// 6. Multi-LOD Labels (single-line area headings at overview; crisp 2-line skill cards up close; collision-safe pills)
	const labels = [];
	for (const point of layout.points.values()) {
		const active = point.id === selected || point.id === hovered;
		const priority = point.id === current ? 6 : active ? 5 : point.kind === "domain" ? 4 : point.kind === "area" ? 3 : point.kind === "unit" ? 2 : 1;
		// Unit titles are drawn directly inside unit zone headers once zoomed in >= 1.65
		if (!active && priority === 2 && relativeZoom >= 1.65) continue;
		if (!active && ((priority === 1 && relativeZoom < (point.kind === "topic" ? 2.15 : 3.2)) || (priority === 2 && relativeZoom < 1.45))) continue;
		const screen = project(point);
		if (visible(screen, 28)) labels.push({ point, screen, priority, active });
	}
	labels.sort((a, b) => b.priority - a.priority);
	const occupied: { left: number; right: number; top: number; bottom: number }[] = [];
	const zoneById = new Map(layout.zones.map(zone => [zone.id, zone]));
	ctx.textBaseline = "middle";
	ctx.lineJoin = "round";

	for (const { point, screen, priority, active } of labels) {
		const isHeading = priority > 1 && point.kind !== "topic" && point.kind !== "atom";
		const node = nodes.get(point.id)!;
		const pill = point.id === current || active;
		const closeSkill = !pill && priority === 1 && relativeZoom >= 3.2;

		if (closeSkill) {
			ctx.font = `600 11.5px ${fontFamily}`;
			const maxW = Math.min(148, Math.max(92, zoom * 62));
			const lines = wrapLines(ctx, node.title, maxW, 2);
			const lineH = 14;
			const boxW = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12;
			const boxH = lines.length * lineH + 6;
			const cx = Math.max(boxW / 2 + 6, Math.min(width - boxW / 2 - 6, screen.x));
			const topY = Math.min(height - boxH - 8, screen.y + dotRadius(point, zoom) + 7);
			const bounds = { left: cx - boxW / 2 - 3, right: cx + boxW / 2 + 3, top: topY - 2, bottom: topY + boxH + 2 };
			if (occupied.some(b => b.left < bounds.right && b.right > bounds.left && b.top < bounds.bottom && b.bottom > bounds.top)) continue;
			occupied.push(bounds);

			ctx.beginPath();
			ctx.roundRect(cx - boxW / 2, topY, boxW, boxH, 7);
			ctx.fillStyle = shiftHex(colors.surface, 0) + (dark ? "e0" : "eb");
			ctx.fill();
			ctx.strokeStyle = node.completed
				? completedColor + "70"
				: node.inProgress
					? inProgressColor + "70"
					: shiftHex(colors.border, 0) + "55";
			ctx.lineWidth = 1;
			ctx.stroke();

			ctx.textAlign = "center";
			ctx.fillStyle = node.completed || node.inProgress || node.state === "available" ? colors.text : colors.textMuted;
			for (const [idx, line] of lines.entries()) {
				ctx.fillText(line, cx, topY + 3 + lineH * (idx + 0.5));
			}
			ctx.textAlign = "left";
			continue;
		}

		const fontSize = priority >= 4 ? 13 : priority >= 3 ? 12.5 : priority >= 2 ? 12 : 11.5;
		const fontWeight = priority >= 3 ? "700" : priority >= 2 ? "600" : "500";
		ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
		const padX = pill ? 8 : 0;
		const isDomainRoot = point.kind === "domain" && relativeZoom < 2.25;
		const x = isDomainRoot
			? Math.max(8, Math.min(screen.x - ctx.measureText(node.title).width / 2, width - 84))
			: Math.max(8, Math.min(screen.x + dotRadius(point, zoom) + 9, width - 84));
		const y = isDomainRoot
			? Math.min(height - 16, screen.y + dotRadius(point, zoom) + 15)
			: isHeading ? screen.y : Math.min(height - 16, screen.y + dotRadius(point, zoom) + 12);
		const zone = zoneById.get(point.id);
		const zoneHasBadge = Boolean(zone && zone.heading === "area" && (zoneStats.get(zone.id)?.completed ?? 0) > 0 && zone.width * zoom >= 120);
		const available = Math.min(width - x - padX - 8, zone && !pill ? project(zone).x + zone.width * zoom - x - (zoneHasBadge ? 56 : 8) : 290);
		if (available < 28) continue;

		const stateKey = node.completed ? "completed" : node.inProgress ? "inProgress" : node.state;
		const suffix = point.id === hovered && node.leaf ? ` · ${STATUS_LABEL[stateKey] ?? ""}` : "";
		let label = (point.id === current ? "Você está aqui · " : "") + node.title + suffix;
		if (ctx.measureText(label).width > available) {
			const maxChars = Math.min(label.length, Math.ceil(available / 5));
			label = label.slice(0, maxChars);
			while (label.length > 1 && ctx.measureText(label + "…").width > available) label = label.slice(0, -1);
			label += "…";
		}
		const textWidth = ctx.measureText(label).width;
		let textY = y;
		const overlaps = (topY: number) => {
			const b = { left: x - padX - 3, right: x + textWidth + padX + 3, top: topY - (pill ? 13 : 8), bottom: topY + (pill ? 13 : 8) };
			return occupied.some(o => o.left < b.right && o.right > b.left && o.top < b.bottom && o.bottom > b.top);
		};
		if (pill && overlaps(textY)) {
			for (const dy of [-26, 26, -50, 50]) {
				const candidateY = Math.max(18, Math.min(height - 18, y + dy));
				if (!overlaps(candidateY)) { textY = candidateY; break; }
			}
		}
		const bounds = {
			left: x - padX - 3,
			right: x + textWidth + padX + 3,
			top: textY - (pill ? 13 : 8),
			bottom: textY + (pill ? 13 : 8),
		};
		if (!pill && occupied.some(b => b.left < bounds.right && b.right > bounds.left && b.top < bounds.bottom && b.bottom > bounds.top)) continue;
		occupied.push(bounds);

		if (pill) {
			const rx = x - padX;
			const ry = textY - 12;
			const rw = textWidth + padX * 2;
			const rh = 24;
			ctx.beginPath();
			ctx.roundRect(rx + 1.5, ry + 1.5, rw, rh, 999);
			ctx.fillStyle = dark ? "rgb(0 0 0 / 0.45)" : "rgb(30 27 46 / 0.16)";
			ctx.fill();

			ctx.beginPath();
			ctx.roundRect(rx, ry, rw, rh, 999);
			ctx.fillStyle = colors.surface;
			ctx.fill();
			ctx.strokeStyle = point.id === current ? beacon : colors.accent;
			ctx.lineWidth = 1.6;
			ctx.stroke();
			ctx.fillStyle = point.id === current ? beacon : colors.text;
			ctx.fillText(label, x, textY + 0.5);
		} else {
			ctx.lineWidth = 3.5;
			ctx.strokeStyle = colors.surface;
			ctx.fillStyle = priority === 3 ? tint(point.color, dark) : colors.text;
			ctx.strokeText(label, x, textY);
			ctx.fillText(label, x, textY);
		}
	}

	// 7. Interactive Minimap when zoomed in (relativeZoom > 1.45)
	if (relativeZoom > 1.45 && width >= 460 && height >= 280) {
		const mx = width - MINIMAP_W - MINIMAP_PAD;
		const my = height - MINIMAP_H - MINIMAP_PAD;
		const innerPad = 8;
		const scaleX = (MINIMAP_W - innerPad * 2) / Math.max(1, layout.width);
		const scaleY = (MINIMAP_H - innerPad * 2) / Math.max(1, layout.height);
		const ms = Math.min(scaleX, scaleY);
		const ox = mx + (MINIMAP_W - layout.width * ms) / 2;
		const oy = my + (MINIMAP_H - layout.height * ms) / 2;

		ctx.save();
		ctx.beginPath();
		ctx.roundRect(mx + 2, my + 2, MINIMAP_W, MINIMAP_H, 12);
		ctx.fillStyle = dark ? "rgb(0 0 0 / 0.45)" : "rgb(30 27 46 / 0.15)";
		ctx.fill();

		ctx.beginPath();
		ctx.roundRect(mx, my, MINIMAP_W, MINIMAP_H, 12);
		ctx.fillStyle = shiftHex(colors.surface, 0) + (dark ? "ec" : "f2");
		ctx.fill();
		ctx.strokeStyle = shiftHex(colors.border, 0) + "88";
		ctx.lineWidth = 1.25;
		ctx.stroke();
		ctx.clip();

		for (const zone of layout.zones) {
			if (zone.heading !== "area") continue;
			ctx.fillStyle = tint(zone.color, dark) + (dark ? "24" : "1c");
			ctx.fillRect(ox + zone.x * ms, oy + zone.y * ms, Math.max(2, zone.width * ms), Math.max(2, zone.height * ms));
		}
		for (const point of layout.points.values()) {
			const node = nodes.get(point.id);
			if (!node) continue;
			const px = ox + point.x * ms;
			const py = oy + point.y * ms;
			if (point.id === current) {
				ctx.fillStyle = beacon;
				ctx.beginPath();
				ctx.arc(px, py, 3, 0, TAU);
				ctx.fill();
			} else if (node.completed) {
				ctx.fillStyle = completedColor;
				ctx.fillRect(px - 1.1, py - 1.1, 2.2, 2.2);
			} else if (node.inProgress) {
				ctx.fillStyle = inProgressColor;
				ctx.fillRect(px - 1.2, py - 1.2, 2.4, 2.4);
			}
		}

		// Viewport lens rectangle
		const vx = ox + (-camera.x / zoom) * ms;
		const vy = oy + (-camera.y / zoom) * ms;
		const vw = (width / zoom) * ms;
		const vh = (height / zoom) * ms;
		ctx.fillStyle = colors.accent + "1f";
		ctx.fillRect(vx, vy, vw, vh);
		ctx.strokeStyle = colors.accent;
		ctx.lineWidth = 1.5;
		ctx.strokeRect(vx, vy, vw, vh);
		ctx.restore();
	}

	return visibleCount;
}

export function SkillCanvas({ map, selected, locate, onPick }: { map: SkillMap; selected: string; locate: number; onPick: (id: string) => void }) {
	const { colors, resolvedMode } = useAppearance();
	const canvas = useRef<HTMLCanvasElement>(null);
	const controls = useRef<MapControls>(null);
	const camera = useRef<Camera | undefined>(undefined);
	const atOverview = useRef(true);
	const previousDomain = useRef("");
	const lastLocate = useRef(locate);
	const active = useRef(selected);
	const pick = useRef(onPick);
	const hintId = useId();
	const [zoomPct, setZoomPct] = useState(100);
	const layout = useMemo(() => layoutSkillMap(map.nodes), [map.nodes]);
	const nodes = useMemo(() => new Map(map.nodes.map(node => [node.id, node])), [map.nodes]);
	const zoneStats = useMemo(() => computeZoneStats(map.nodes), [map.nodes]);
	const anchorId = map.position ?? map.next;

	useEffect(() => { pick.current = onPick; }, [onPick]);
	useEffect(() => {
		const surface = canvas.current;
		const ctx = surface?.getContext("2d");
		if (!surface || !ctx) return;
		const fontFamily = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
		const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		let view: Viewport = { width: 0, height: 0, ratio: 1 };
		let frame = 0;
		let animFrame = 0;
		let hovered: string | undefined;
		if (!camera.current || previousDomain.current !== map.domain) atOverview.current = true;
		const pointers = new Map<number, Pixel>();
		let down: Pixel | undefined;
		let dragged = false;
		let draggingMinimap = false;
		previousDomain.current = map.domain;

		function cancelAnim() {
			if (animFrame) {
				cancelAnimationFrame(animFrame);
				animFrame = 0;
			}
		}

		function syncZoomLabel() {
			if (!camera.current || !view.width) return;
			const fit = fitZoom(layout, view);
			const pct = Math.round((camera.current.zoom / fit) * 100);
			setZoomPct(prev => (Math.abs(prev - pct) >= 5 ? pct : prev));
		}

		function redraw() {
			if (frame) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				if (camera.current) {
					const visible = String(drawAtlas(ctx!, layout, nodes, zoneStats, view, camera.current, active.current, hovered, anchorId, colors, resolvedMode === "dark", fontFamily));
					if (surface!.dataset.visibleNodeCount !== visible) surface!.dataset.visibleNodeCount = visible;
					const mode = atOverview.current ? "overview" : "explore";
					if (surface!.dataset.cameraMode !== mode) surface!.dataset.cameraMode = mode;
					syncZoomLabel();
				}
			});
		}

		function animateTo(target: Camera, overviewAfter = false) {
			cancelAnim();
			if (!camera.current || reducedMotion()) {
				camera.current = target;
				atOverview.current = overviewAfter;
				redraw();
				return;
			}
			const start: Camera = { ...camera.current };
			const t0 = performance.now();
			const duration = 260;
			function step(now: number) {
				const raw = Math.min(1, (now - t0) / duration);
				const ease = 1 - (1 - raw) ** 3;
				camera.current = {
					x: start.x + (target.x - start.x) * ease,
					y: start.y + (target.y - start.y) * ease,
					zoom: start.zoom + (target.zoom - start.zoom) * ease,
				};
				if (raw < 1) {
					redraw();
					animFrame = requestAnimationFrame(step);
				} else {
					animFrame = 0;
					camera.current = target;
					atOverview.current = overviewAfter;
					redraw();
				}
			}
			animFrame = requestAnimationFrame(step);
		}

		function overviewCamera(): Camera {
			const zoom = fitZoom(layout, view);
			return {
				x: (view.width - layout.width * zoom) / 2,
				y: TOP_GUTTER + (view.height - TOP_GUTTER - BOTTOM_GUTTER - layout.height * zoom) / 2,
				zoom,
			};
		}

		function overview(animate = false) {
			const target = overviewCamera();
			if (animate && camera.current) {
				animateTo(target, true);
			} else {
				cancelAnim();
				camera.current = target;
				atOverview.current = true;
				setZoomPct(100);
				redraw();
			}
		}

		function resize() {
			const width = surface!.clientWidth;
			const height = surface!.clientHeight;
			const ratio = Math.max(1, window.devicePixelRatio || 1);
			if (!width || !height) return;
			const lastView = view;
			view = { width, height, ratio };
			const pixelsWide = Math.round(width * ratio);
			const pixelsHigh = Math.round(height * ratio);
			if (surface!.width !== pixelsWide) surface!.width = pixelsWide;
			if (surface!.height !== pixelsHigh) surface!.height = pixelsHigh;
			if (atOverview.current) overview(false);
			else if (camera.current && lastView.width > 0) {
				camera.current.x += (view.width - lastView.width) / 2;
				camera.current.y += (view.height - lastView.height) / 2;
			}
			redraw();
		}

		function scaleAt(anchor: Pixel, factor: number, animate = false) {
			const current = camera.current;
			if (!current) return;
			const fit = fitZoom(layout, view);
			const next = Math.max(fit * 0.7, Math.min(Math.max(3.5, fit * 8.5), current.zoom * factor));
			if (next === current.zoom) return;
			const change = next / current.zoom;
			const target: Camera = {
				x: anchor.x - (anchor.x - current.x) * change,
				y: anchor.y - (anchor.y - current.y) * change,
				zoom: next,
			};
			atOverview.current = false;
			if (animate) animateTo(target, false);
			else {
				cancelAnim();
				camera.current = target;
				redraw();
			}
		}

		function move(dx: number, dy: number) {
			if (!camera.current) return;
			cancelAnim();
			camera.current.x += dx;
			camera.current.y += dy;
			atOverview.current = false;
			redraw();
		}

		function scale(factor: number) {
			scaleAt({ x: view.width / 2, y: view.height / 2 }, factor, true);
		}

		function minimapBounds() {
			if (!camera.current || view.width < 460 || view.height < 280) return null;
			const relativeZoom = camera.current.zoom / fitZoom(layout, view);
			if (relativeZoom <= 1.45) return null;
			const mx = view.width - MINIMAP_W - MINIMAP_PAD;
			const my = view.height - MINIMAP_H - MINIMAP_PAD;
			const innerPad = 8;
			const ms = Math.min((MINIMAP_W - innerPad * 2) / Math.max(1, layout.width), (MINIMAP_H - innerPad * 2) / Math.max(1, layout.height));
			const ox = mx + (MINIMAP_W - layout.width * ms) / 2;
			const oy = my + (MINIMAP_H - layout.height * ms) / 2;
			return { mx, my, ms, ox, oy };
		}

		function jumpMinimap(point: Pixel) {
			const mm = minimapBounds();
			if (!mm || !camera.current) return;
			const worldX = (point.x - mm.ox) / mm.ms;
			const worldY = (point.y - mm.oy) / mm.ms;
			cancelAnim();
			camera.current = {
				x: view.width / 2 - worldX * camera.current.zoom,
				y: view.height / 2 - worldY * camera.current.zoom,
				zoom: camera.current.zoom,
			};
			atOverview.current = false;
			redraw();
		}

		controls.current = {
			reset: () => overview(true),
			scale,
			reveal(id, focus) {
				const point = layout.points.get(id);
				const current = camera.current;
				if (point && current && focus) {
					const zoom = Math.max(current.zoom, fitZoom(layout, view) * 4);
					animateTo({ x: view.width / 2 - point.x * zoom, y: view.height / 2 - point.y * zoom, zoom }, false);
				} else if (point && current && !atOverview.current) {
					const x = current.x + point.x * current.zoom;
					const y = current.y + point.y * current.zoom;
					if (x < 16 || x > view.width - 16 || y < 16 || y > view.height - 16) {
						animateTo({ x: current.x + (view.width / 2 - x), y: current.y + (view.height / 2 - y), zoom: current.zoom }, false);
					} else {
						redraw();
					}
				} else {
					redraw();
				}
			},
		};

		function location(event: MouseEvent): Pixel {
			const rect = surface!.getBoundingClientRect();
			return { x: (event.clientX - rect.left) * view.width / rect.width, y: (event.clientY - rect.top) * view.height / rect.height };
		}
		function hit(point: Pixel, touch = false) {
			const current = camera.current;
			if (!current) return;
			let closest: string | undefined;
			let best = Infinity;
			for (const candidate of layout.points.values()) {
				const distance = Math.hypot(current.x + candidate.x * current.zoom - point.x, current.y + candidate.y * current.zoom - point.y);
				if (distance < best && distance <= Math.max(touch ? 15 : 9, dotRadius(candidate, current.zoom) + 5)) {
					best = distance;
					closest = candidate.id;
				}
			}
			return closest;
		}
		function inMinimap(point: Pixel): boolean {
			const mm = minimapBounds();
			return Boolean(mm && point.x >= mm.mx && point.x <= mm.mx + MINIMAP_W && point.y >= mm.my && point.y <= mm.my + MINIMAP_H);
		}
		function pointerDown(event: PointerEvent) {
			if (event.button !== 0) return;
			const point = location(event);
			if (inMinimap(point)) {
				draggingMinimap = true;
				surface!.setPointerCapture(event.pointerId);
				jumpMinimap(point);
				return;
			}
			if (!pointers.size) {
				down = point;
				dragged = false;
			}
			pointers.set(event.pointerId, point);
			if (pointers.size > 1) dragged = true;
			surface!.setPointerCapture(event.pointerId);
			surface!.style.cursor = "grabbing";
		}
		function pointerMove(event: PointerEvent) {
			const point = location(event);
			if (draggingMinimap) {
				jumpMinimap(point);
				return;
			}
			const previous = pointers.get(event.pointerId);
			if (!previous) {
				if (event.pointerType !== "mouse" || pointers.size) return;
				if (inMinimap(point)) {
					if (hovered !== undefined) { hovered = undefined; redraw(); }
					surface!.style.cursor = "pointer";
					return;
				}
				const target = hit(point);
				if (hovered !== target) {
					hovered = target;
					surface!.style.cursor = target ? "pointer" : "grab";
					redraw();
				}
				return;
			}
			const other = [...pointers].find(([id]) => id !== event.pointerId)?.[1];
			pointers.set(event.pointerId, point);
			if (other) {
				const distance = Math.hypot(previous.x - other.x, previous.y - other.y);
				if (distance >= 1) scaleAt({ x: (previous.x + other.x) / 2, y: (previous.y + other.y) / 2 }, Math.hypot(point.x - other.x, point.y - other.y) / distance);
				move((point.x - previous.x) / 2, (point.y - previous.y) / 2);
			} else if (dragged || (down && Math.hypot(point.x - down.x, point.y - down.y) > 4)) {
				dragged = true;
				move(point.x - previous.x, point.y - previous.y);
			}
		}
		function pointerEnd(event: PointerEvent) {
			if (draggingMinimap) {
				draggingMinimap = false;
				return;
			}
			if (!pointers.delete(event.pointerId)) return;
			if (pointers.size) return;
			if (event.type === "pointerup" && !dragged) {
				const target = hit(location(event), event.pointerType === "touch");
				if (target) pick.current(target);
			}
			down = undefined;
			surface!.style.cursor = hovered ? "pointer" : "grab";
		}
		function doubleClick(event: MouseEvent) {
			const point = location(event);
			if (inMinimap(point)) return;
			scaleAt(point, 1.85, true);
		}
		function clearHover() {
			hovered = undefined;
			redraw();
		}
		function wheel(event: WheelEvent) {
			event.preventDefault();
			const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view.height : 1;
			scaleAt(location(event), Math.exp(-event.deltaY * unit * 0.002));
		}
		function keyboard(event: KeyboardEvent) {
			switch (event.key) {
				case "+": case "=": scale(1.4); break;
				case "-": scale(1 / 1.4); break;
				case "Home": case "0": overview(true); break;
				case "ArrowLeft": move(64, 0); break;
				case "ArrowRight": move(-64, 0); break;
				case "ArrowUp": move(0, 64); break;
				case "ArrowDown": move(0, -64); break;
				default: return;
			}
			event.preventDefault();
		}

		resize();
		const observer = new ResizeObserver(resize);
		observer.observe(surface);
		window.addEventListener("resize", resize);
		surface.addEventListener("wheel", wheel, { passive: false });
		surface.addEventListener("pointerdown", pointerDown);
		surface.addEventListener("pointermove", pointerMove);
		surface.addEventListener("pointerup", pointerEnd);
		surface.addEventListener("pointercancel", pointerEnd);
		surface.addEventListener("lostpointercapture", pointerEnd);
		surface.addEventListener("pointerleave", clearHover);
		surface.addEventListener("dblclick", doubleClick);
		surface.addEventListener("keydown", keyboard);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", resize);
			surface.removeEventListener("wheel", wheel);
			surface.removeEventListener("pointerdown", pointerDown);
			surface.removeEventListener("pointermove", pointerMove);
			surface.removeEventListener("pointerup", pointerEnd);
			surface.removeEventListener("pointercancel", pointerEnd);
			surface.removeEventListener("lostpointercapture", pointerEnd);
			surface.removeEventListener("pointerleave", clearHover);
			surface.removeEventListener("dblclick", doubleClick);
			surface.removeEventListener("keydown", keyboard);
			cancelAnimationFrame(frame);
			cancelAnim();
			controls.current = null;
		};
	}, [layout, nodes, zoneStats, map.domain, anchorId, colors, resolvedMode]);

	useEffect(() => {
		active.current = selected;
		controls.current?.reveal(selected, locate !== lastLocate.current);
		lastLocate.current = locate;
	}, [selected, locate]);

	return (
		<div className="cel-card relative overflow-hidden"
			style={{ backgroundImage: "radial-gradient(color-mix(in srgb, var(--border) 24%, transparent) 1px, transparent 1px)", backgroundSize: "16px 16px" }}>
			<canvas ref={canvas} tabIndex={0} aria-label={`Mapa de ${map.title}. ${layout.points.size} nós.`} aria-describedby={hintId}
				data-node-count={layout.points.size} data-edge-count={layout.edges.length}
				className="block h-[clamp(26rem,64vh,46rem)] w-full touch-none cursor-grab focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring">
				Use a busca ou a lista de habilidades para navegar pelos nós do mapa.
			</canvas>
			<div className="absolute right-2.5 top-2.5 flex flex-wrap items-center justify-end gap-1.5">
				{anchorId && (
					<button type="button" aria-label="Centralizar na posição atual" className="cel-button min-h-8 px-2.5 py-1 text-xs"
						onClick={() => { pick.current(anchorId); controls.current?.reveal(anchorId, true); }}>
						<span aria-hidden="true" className="size-2 rounded-full bg-[var(--c-teal,#2ec4b6)]" />
						Você está aqui
					</button>
				)}
				<button type="button" aria-label="Visão geral do mapa" className="cel-button min-h-8 px-2.5 py-1 text-xs" onClick={() => controls.current?.reset()}>
					<Icon name="maximize" size={14} tone={false} />
					Visão geral
				</button>
				<div className="flex items-center overflow-hidden rounded-[10px] border border-border/70 bg-card shadow-xs">
					<button type="button" aria-label="Afastar mapa" className="flex size-8 items-center justify-center text-sm font-bold hover:bg-accent" onClick={() => controls.current?.scale(1 / 1.4)}>−</button>
					<span className="min-w-11 border-x border-border/50 px-1.5 text-center font-mono text-[11px] text-muted-foreground tabular-nums" aria-hidden="true">{zoomPct}%</span>
					<button type="button" aria-label="Aproximar mapa" className="flex size-8 items-center justify-center text-sm font-bold hover:bg-accent" onClick={() => controls.current?.scale(1.4)}>+</button>
				</div>
			</div>
			<div className="pointer-events-none absolute bottom-2.5 left-2.5 max-w-[calc(100%-1.25rem)] rounded-xl border border-border/60 bg-card/95 px-3 py-2 text-xs text-card-foreground shadow-sm">
				<p id={hintId} className="text-muted-foreground tabular-nums">{layout.points.size} nós · Arraste, clique duplo ou use + e −</p>
				<div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1">
					<span className="inline-flex items-center gap-1.5">
						<span aria-hidden="true" className="size-2.5 rounded-full bg-[var(--c-teal,#2ec4b6)] ring-2 ring-[var(--c-teal,#2ec4b6)]/35" />
						Você está aqui
					</span>
					<span className="inline-flex items-center gap-1.5">
						<span aria-hidden="true" className="size-2.5 rounded-full border border-foreground/60 bg-[var(--cel-success,var(--lh-success))] ring-2 ring-[var(--cel-success,var(--lh-success))]/30" />
						Concluído
					</span>
					<span className="inline-flex items-center gap-1.5">
						<span aria-hidden="true" className="size-2.5 rounded-full border border-dashed border-[var(--cel-warning,var(--lh-warning))] bg-[var(--cel-warning,var(--lh-warning))]" />
						Em andamento
					</span>
					<span className="inline-flex items-center gap-1.5">
						<span aria-hidden="true" className="size-2.5 rounded-full border-2 border-foreground bg-card" />
						Disponível
					</span>
					<span className="inline-flex items-center gap-1.5">
						<span aria-hidden="true" className="size-2 rounded-full bg-border/60" />
						Pendente
					</span>
				</div>
			</div>
		</div>
	);
}
