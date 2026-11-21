import { CEL_RAMPS, type SkillEdge, type SkillLayout, type SkillNode, type SkillPoint } from "@/src/core";
import {
	AREA_RAMPS,
	MINIMAP_H,
	MINIMAP_PAD,
	MINIMAP_SHADOW_PAD,
	MINIMAP_W,
	TAU,
	dotRadius,
	drawCheckGlyph,
	drawGearWheel,
	drawHexPrism,
	drawKeystoneSocket,
	drawLockGlyph,
	drawNotableSocket,
	drawPlayGlyph,
	drawSkillRail,
	effectivePointY,
	fitZoom,
	type AtlasPalette,
	type Camera,
	type CanvasStrings,
	type MinimapCache,
	type TextMetricsCache,
	type Viewport,
	type ZoneStats,
} from "./skill-canvas-palette.ts";

export interface DrawSkillMapArgs {
	ctx: CanvasRenderingContext2D;
	layout: SkillLayout;
	nodes: Map<string, SkillNode>;
	zoneStats: ZoneStats;
	view: Viewport;
	camera: Camera;
	depth: number;
	selected: string;
	hovered: string | undefined;
	current: string | undefined;
	palette: AtlasPalette;
	strings: CanvasStrings;
	fontFamily: string;
	textCache: TextMetricsCache;
	getMinimap: () => MinimapCache;
}

function statusLabelOf(node: SkillNode, strings: CanvasStrings): string {
	if (node.completed) return strings.completed;
	if (node.inProgress) return strings.inProgress;
	switch (node.state) {
		case "available":
			return strings.available;
		case "known":
			return strings.inferred;
		default:
			return strings.pending;
	}
}

export function drawSkillMap({
	ctx,
	layout,
	nodes,
	zoneStats,
	view,
	camera,
	depth,
	selected,
	hovered,
	current,
	palette,
	strings,
	fontFamily,
	textCache,
	getMinimap,
}: DrawSkillMapArgs): number {
	const { width, height, ratio } = view;
	const { zoom, x: camX, y: camY } = camera;
	const { colors, dark, completedColor, inProgressColor, beacon, ink } = palette;
	const style = layout.style;
	const fit = fitZoom(layout, view);
	const relativeZoom = zoom / fit;
	const focusId = hovered ?? selected;
	const rampLen = AREA_RAMPS.length;

	const pxOf = (pt: SkillPoint) => camX + pt.x * zoom;
	const pyOf = (pt: SkillPoint) => camY + effectivePointY(pt, style, depth) * zoom;

	ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
	ctx.clearRect(0, 0, width, height);

	// ── 1. Style-specific architectural backdrop ───────────────────────────────
	if (style === "constellation") {
		for (let i = 0; i < layout.rings.length; i++) {
			const ring = layout.rings[i]!;
			const rx = camX + ring.cx * zoom;
			const ry = camY + ring.cy * zoom;
			const rr = ring.radius * zoom;
			if (rx + rr < -20 || rx - rr > width + 20 || ry + rr < -20 || ry - rr > height + 20) continue;
			ctx.beginPath();
			ctx.arc(rx, ry, rr, 0, TAU);
			ctx.strokeStyle = i === 0 ? palette.brassBase + "66" : palette.elevationRail;
			ctx.lineWidth = i === 0 ? 2 : 1.05;
			if (i > 0) ctx.setLineDash([6, 8]);
			ctx.stroke();
			ctx.setLineDash([]);
		}
		for (const wheel of layout.wheels) {
			const wx = camX + wheel.cx * zoom;
			const wy = camY + wheel.cy * zoom;
			const wr = wheel.radius * zoom;
			if (wx + wr * 1.3 < 0 || wx - wr * 1.3 > width || wy + wr * 1.3 < 0 || wy - wr * 1.3 > height) continue;
			const ramp = AREA_RAMPS[wheel.color % rampLen]!;
			const zStat = zoneStats.get(wheel.unitId);
			const done = Boolean(zStat && zStat.total > 0 && zStat.completed >= zStat.total);
			ctx.beginPath();
			ctx.arc(wx, wy, wr * 1.06, 0, TAU);
			ctx.fillStyle = (done ? completedColor : ramp.base) + (dark ? "12" : "0e");
			ctx.fill();
			ctx.strokeStyle = (done ? completedColor : ramp.base) + (dark ? "42" : "36");
			ctx.lineWidth = Math.max(0.9, Math.min(2, zoom * 1.4));
			ctx.stroke();

			if (wr >= 22) {
				ctx.beginPath();
				ctx.arc(wx, wy, wr * 0.6, 0, TAU);
				ctx.strokeStyle = palette.progressTrack;
				ctx.lineWidth = 0.85;
				ctx.stroke();
			}
		}
	} else if (style === "hextech") {
		const depthPx = 9 * depth * zoom;
		for (const gear of layout.gears) {
			const gx = camX + gear.cx * zoom;
			const gy = camY + gear.cy * zoom;
			const gr = gear.radius * zoom;
			if (gx + gr * 1.2 < 0 || gx - gr * 1.2 > width || gy + gr * 1.2 < 0 || gy - gr * 1.2 > height) continue;
			const ramp = gear.isRoot ? CEL_RAMPS.teal : AREA_RAMPS[gear.color % rampLen]!;
			const zStat = zoneStats.get(gear.id);
			const active = Boolean(gear.isRoot || (zStat && zStat.completed > 0));
			drawGearWheel(ctx, gx, gy, gr, gear.teeth, gear.color * 0.35, ramp, active, palette, depthPx);
		}
	} else if (style === "citadel") {
		for (const cluster of layout.hexClusters) {
			const cx = camX + cluster.cx * zoom;
			const cy = camY + cluster.cy * zoom;
			const rx = cluster.radius * zoom;
			const ry = cluster.radius * 0.72 * zoom;
			if (cx + rx < -20 || cx - rx > width + 20 || cy + ry < -20 || cy - ry > height + 20) continue;
			const ramp = AREA_RAMPS[cluster.color % rampLen]!;
			const grad = ctx.createRadialGradient(cx, cy, Math.max(4, rx * 0.1), cx, cy, rx * 1.05);
			grad.addColorStop(0, ramp.base + (dark ? "22" : "18"));
			grad.addColorStop(1, ramp.base + "00");
			ctx.fillStyle = grad;
			ctx.beginPath();
			ctx.ellipse(cx, cy, rx * 1.05, ry * 1.08, 0, 0, TAU);
			ctx.fill();
		}
	} else if (style === "clarity") {
		const laneTitleFont = `700 ${relativeZoom >= 1.5 ? 13 : 12}px ${fontFamily}`;
		const laneMetaFont = `600 10.5px ${fontFamily}`;
		const unitHeaderFont = `700 ${relativeZoom >= 1.8 ? 12 : 11}px ${fontFamily}`;

		// Swimlane bands with dedicated full-width readable left header column
		for (const lane of layout.lanes) {
			const x = camX + lane.x * zoom;
			const y = camY + lane.y * zoom;
			const w = lane.width * zoom;
			const h = lane.height * zoom;
			if (x > width || y > height || x + w < 0 || y + h < 0) continue;
			const colorIdx = lane.color % rampLen;
			const tint = palette.areaTints[colorIdx]!;
			const zStat = zoneStats.get(lane.areaId);
			const frac = zStat && zStat.total > 0 ? zStat.completed / zStat.total : 0;
			const done = frac >= 1;
			const headW = Math.min(w * 0.45, lane.headerWidth * zoom);

			ctx.beginPath();
			ctx.roundRect(x, y, w, h, Math.min(16, h / 4));
			ctx.fillStyle = palette.clarityLaneBg;
			ctx.fill();
			ctx.strokeStyle = done ? palette.areaStrokeDone : palette.clarityCardBorder;
			ctx.lineWidth = 1.15;
			ctx.stroke();

			// Left editorial header panel
			if (headW >= 42) {
				ctx.save();
				ctx.beginPath();
				ctx.roundRect(x, y, headW, h, [Math.min(16, h / 4), 0, 0, Math.min(16, h / 4)]);
				ctx.fillStyle = palette.clarityLaneHeaderBg;
				ctx.fill();
				// Vertical color accent bar
				ctx.fillStyle = done ? completedColor : tint;
				ctx.fillRect(x, y + 10, Math.max(3, 4 * Math.min(1.5, zoom)), Math.max(8, h - 20));
				ctx.restore();

				const areaNode = nodes.get(lane.areaId);
				if (areaNode && headW >= 70) {
					const textPadX = Math.max(12, 16 * Math.min(1.3, zoom));
					const maxTextW = Math.max(36, headW - textPadX - 10);
					const lines = textCache.wrapLines(ctx, laneTitleFont, areaNode.title, maxTextW, 3);
					ctx.font = laneTitleFont;
					ctx.textAlign = "left";
					ctx.textBaseline = "top";
					ctx.fillStyle = done ? completedColor : tint;
					const lineH = relativeZoom >= 1.5 ? 16 : 15;
					const startY = y + Math.max(10, 14 * Math.min(1.2, zoom));
					for (let i = 0; i < lines.length; i++) {
						ctx.fillText(lines[i]!, x + textPadX, startY + i * lineH);
					}
					if (zStat && zStat.total > 0 && h >= 64) {
						const metaY = startY + lines.length * lineH + 6;
						const pct = Math.round(frac * 100);
						ctx.font = laneMetaFont;
						ctx.fillStyle = frac > 0 ? completedColor : colors.textMuted;
						ctx.fillText(`${zStat.completed}/${zStat.total} · ${pct}%`, x + textPadX, metaY);
						// Clean horizontal progress bar
						const barW = Math.min(maxTextW, 132);
						const barY = metaY + 16;
						if (barY + 5 < y + h - 6) {
							ctx.beginPath();
							ctx.roundRect(x + textPadX, barY, barW, 4, 2);
							ctx.fillStyle = palette.progressTrack;
							ctx.fill();
							if (frac > 0) {
								ctx.beginPath();
								ctx.roundRect(x + textPadX, barY, Math.max(4, barW * frac), 4, 2);
								ctx.fillStyle = completedColor;
								ctx.fill();
							}
						}
					}
				}
			}
		}

		// Clean unit cards inside swimlanes
		for (const zone of layout.zones) {
			if (zone.heading !== "unit") continue;
			const x = camX + zone.x * zoom;
			const y = camY + zone.y * zoom;
			const w = zone.width * zoom;
			const h = zone.height * zoom;
			if (x > width || y > height || x + w < 0 || y + h < 0) continue;
			const colorIdx = zone.color % rampLen;
			const zStat = zoneStats.get(zone.id);
			const frac = zStat && zStat.total > 0 ? zStat.completed / zStat.total : 0;
			const done = frac >= 1;

			ctx.beginPath();
			ctx.roundRect(x, y, w, h, Math.min(12, w / 5, h / 5));
			ctx.fillStyle = done ? palette.unitFillDone : palette.clarityCardBg;
			ctx.fill();
			ctx.strokeStyle = done ? palette.unitStrokeDone : palette.clarityCardBorder;
			ctx.lineWidth = done ? 1.35 : 1;
			ctx.stroke();

			if (relativeZoom >= 1.1 && w >= 86 && h >= 36) {
				const unitNode = nodes.get(zone.id);
				if (unitNode) {
					const countText = zStat && zStat.total > 0 ? `${zStat.completed}/${zStat.total}` : "";
					const countW = countText ? textCache.measureWidth(ctx, unitHeaderFont, countText) + 10 : 0;
					const leftInset = Math.max(12, 26 * Math.min(1.2, zoom));
					const maxTitleW = Math.max(24, w - leftInset - 10 - countW);
					const title = textCache.truncate(ctx, unitHeaderFont, unitNode.title, maxTitleW);
					ctx.font = unitHeaderFont;
					ctx.textAlign = "left";
					ctx.textBaseline = "top";
					ctx.fillStyle = done ? completedColor : palette.areaTints[colorIdx]!;
					ctx.fillText(title, x + leftInset, y + 8);
					if (countText) {
						ctx.fillStyle = frac > 0 ? completedColor : colors.textMuted;
						ctx.fillText(countText, x + w - countW + 2, y + 8);
					}
				}
			}
		}
	} else {
		// Default "atlas" cartographic zones (improved cel-shading crispness)
		const badgeFont = `700 ${relativeZoom >= 1.8 ? 11 : 10}px ${fontFamily}`;
		const unitTitleFont = `600 11px ${fontFamily}`;

		for (const zone of layout.zones) {
			const x = camX + zone.x * zoom;
			const y = camY + zone.y * zoom;
			const w = zone.width * zoom;
			const h = zone.height * zoom;
			if (x > width || y > height || x + w < 0 || y + h < 0) continue;
			const colorIdx = zone.color % rampLen;
			const zStat = zoneStats.get(zone.id);
			const fraction = zStat && zStat.total > 0 ? zStat.completed / zStat.total : 0;
			const zoneDone = fraction >= 1;
			const hasProgress = fraction > 0;

			if (zone.heading === "area") {
				const rad = Math.min(20, w / 4, h / 4);
				// Subtle hard cel shadow under area cards
				ctx.beginPath();
				ctx.roundRect(x + 2, y + 3, w, h, rad);
				ctx.fillStyle = dark ? "rgb(0 0 0 / 0.24)" : "rgb(30 27 46 / 0.06)";
				ctx.fill();

				ctx.beginPath();
				ctx.roundRect(x, y, w, h, rad);
				ctx.fillStyle = zoneDone ? palette.areaFillDone : palette.areaFillNormal[colorIdx]!;
				ctx.fill();
				ctx.strokeStyle = zoneDone ? palette.areaStrokeDone : palette.areaStrokeNormal[colorIdx]!;
				ctx.lineWidth = relativeZoom >= 1.8 ? 1.55 : 1.2;
				ctx.stroke();

				if (hasProgress && w > 54) {
					const barW = Math.max(8, Math.min(w - 24, (w - 24) * fraction));
					ctx.beginPath();
					ctx.roundRect(x + 12, y - 1.5, w - 24, 3, 2);
					ctx.fillStyle = palette.progressTrack;
					ctx.fill();
					ctx.beginPath();
					ctx.roundRect(x + 12, y - 1.5, barW, 3, 2);
					ctx.fillStyle = completedColor;
					ctx.fill();
				}

				if (hasProgress && zStat && w >= 120) {
					const badge = `${zStat.completed}/${zStat.total}`;
					const bw = textCache.measureWidth(ctx, badgeFont, badge) + 12;
					const bx = x + w - bw - 8;
					const by = y + 6;
					if (bx > x + 60 && by > 2 && by < height - 18) {
						ctx.beginPath();
						ctx.roundRect(bx, by, bw, 17, 999);
						ctx.fillStyle = colors.surface;
						ctx.fill();
						ctx.strokeStyle = palette.badgeStroke;
						ctx.lineWidth = 1;
						ctx.stroke();
						ctx.font = badgeFont;
						ctx.textBaseline = "middle";
						ctx.fillStyle = completedColor;
						ctx.fillText(badge, bx + 6, by + 9);
					}
				}
			} else {
				const rad = Math.min(12, w / 4, h / 4);
				ctx.beginPath();
				ctx.roundRect(x, y, w, h, rad);
				ctx.fillStyle = zoneDone ? palette.unitFillDone : palette.unitFillNormal[colorIdx]!;
				ctx.fill();
				if (zoneDone || relativeZoom >= 1.25) {
					ctx.strokeStyle = zoneDone ? palette.unitStrokeDone : palette.unitStrokeNormal[colorIdx]!;
					ctx.lineWidth = zoneDone ? 1.25 : 0.9;
					ctx.stroke();
				}
				if (relativeZoom >= 1.65 && w >= 92 && h >= 44) {
					const unitNode = nodes.get(zone.id);
					if (unitNode) {
						const unitPt = layout.points.get(zone.id);
						const leftInset = unitPt ? Math.max(12, pxOf(unitPt) - x + dotRadius(unitPt, zoom) + 8) : 10;
						const countText = zStat && zStat.total > 0 ? `${zStat.completed}/${zStat.total}` : "";
						const countW = countText ? textCache.measureWidth(ctx, unitTitleFont, countText) + 10 : 0;
						const maxTitleW = Math.max(24, w - leftInset - 8 - countW);
						const title = textCache.truncate(ctx, unitTitleFont, unitNode.title, maxTitleW);
						ctx.font = unitTitleFont;
						ctx.textBaseline = "top";
						ctx.fillStyle = zoneDone ? completedColor : palette.areaTints[colorIdx]!;
						ctx.fillText(title, x + leftInset, y + 6);
						if (countText) {
							ctx.fillStyle = hasProgress ? completedColor : colors.textMuted;
							ctx.fillText(countText, x + w - countW + 2, y + 6);
						}
					}
				}
			}
		}
	}

	// ── 2. Overview links & structural rails ─────────────────────────────────
	if (style === "constellation" || style === "hextech") {
		for (const link of layout.overviewLinks) {
			const fx = pxOf(link.from);
			const fy = pyOf(link.from);
			const tx = pxOf(link.to);
			const ty = pyOf(link.to);
			if (Math.max(fx, tx) < -32 || Math.max(fy, ty) < -32 || Math.min(fx, tx) > width + 32 || Math.min(fy, ty) > height + 32) continue;
			const fromNode = nodes.get(link.from.id);
			const toNode = nodes.get(link.to.id);
			const lit = Boolean((fromNode?.completed || fromNode?.inProgress) && (toNode?.completed || toNode?.inProgress || toNode?.state === "available"));
			const isTrunk = link.from.kind === "domain";
			if (isTrunk) {
				drawSkillRail(ctx, fx, fy, tx, ty, lit || style === "hextech", style === "hextech" ? palette.brassHl : CEL_RAMPS.volt.base, 2.4, palette);
			} else if (relativeZoom < 2.4) {
				ctx.beginPath();
				const mx = (fx + tx) * 0.5;
				const my = (fy + ty) * 0.5 - Math.min(40, Math.hypot(tx - fx, ty - fy) * 0.14);
				ctx.moveTo(fx, fy);
				ctx.quadraticCurveTo(mx, my, tx, ty);
				ctx.strokeStyle = style === "hextech" ? palette.brassShade + "88" : palette.overviewBranch;
				ctx.lineWidth = style === "hextech" ? 2.2 : 1.15;
				ctx.setLineDash(style === "hextech" ? [] : [5, 5]);
				ctx.stroke();
				ctx.setLineDash([]);
			}
		}
	} else if (style === "atlas" && relativeZoom < 2.25) {
		const trunkPath = new Path2D();
		const branchPath = new Path2D();
		for (const link of layout.overviewLinks) {
			const fx = pxOf(link.from);
			const fy = pyOf(link.from);
			const tx0 = pxOf(link.to);
			const ty0 = pyOf(link.to);
			if (Math.max(fx, tx0) < -32 || Math.max(fy, ty0) < -32 || Math.min(fx, tx0) > width + 32 || Math.min(fy, ty0) > height + 32) continue;
			const dx = tx0 - fx;
			const dy = ty0 - fy;
			const length = Math.hypot(dx, dy);
			if (length < 12) continue;
			const isTrunk = link.from.kind === "domain";
			const target = isTrunk ? trunkPath : branchPath;
			if (isTrunk) {
				const midY = (fy + ty0) / 2;
				target.moveTo(fx, fy - dotRadius(link.from, zoom));
				target.bezierCurveTo(fx, midY, tx0, midY, tx0, ty0 + dotRadius(link.to, zoom) + 2);
				continue;
			}
			const ux = dx / length;
			const uy = dy / length;
			const bend = Math.min(28, length * 0.12);
			const toGap = dotRadius(link.to, zoom) + 4;
			const tx = tx0 - ux * toGap;
			const ty = ty0 - uy * toGap;
			const controlX = tx - dx * 0.33 + uy * bend;
			const controlY = ty - dy * 0.33 - ux * bend;
			target.moveTo(fx, fy);
			target.bezierCurveTo(fx + dx * 0.33 + uy * bend, fy + dy * 0.33 - ux * bend, controlX, controlY, tx, ty);
		}
		ctx.strokeStyle = palette.overviewBranch;
		ctx.lineWidth = 1.1;
		ctx.stroke(branchPath);
		ctx.strokeStyle = palette.overviewTrunk;
		ctx.lineWidth = 1.85;
		ctx.stroke(trunkPath);
	}

	// ── 3. Ambient & Prominent Dependency Edges ──────────────────────────────
	function drawEdgePath(fx: number, fy: number, tx0: number, ty0: number, sourceGap: number, targetGap: number, curved: boolean, arrow: boolean, prominent: boolean) {
		const dx = tx0 - fx;
		const dy = ty0 - fy;
		const length = Math.hypot(dx, dy);
		if (length < sourceGap + targetGap + 3) return;
		const ux = dx / length;
		const uy = dy / length;
		const sx = fx + ux * sourceGap;
		const sy = fy + uy * sourceGap;
		const tx = tx0 - ux * targetGap;
		const ty = ty0 - uy * targetGap;
		let vx = ux;
		let vy = uy;
		if (curved && length > 24) {
			const bend = Math.min(28, length * 0.14);
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
		if (style === "citadel" && kind !== "prerequisite") return;
		const list = layout.edgesByKind[kind];
		if (!list.length) return;
		const isPre = kind === "prerequisite";
		const maxCrossLen = Math.min(width, height) * (kind === "related" ? 0.35 : 0.72);
		const completedPath = new Path2D();
		const pendingPath = new Path2D();
		let hasCompleted = false;
		let hasPending = false;

		for (const edge of list) {
			const rootEdge = edge.from.kind === "domain" || edge.to.kind === "domain";
			const touchesActive = (!rootEdge || relativeZoom >= 1.5) && (edge.from.id === selected || edge.to.id === selected || edge.from.id === hovered || edge.to.id === hovered);
			if (touchesActive) continue;
			if (style === "clarity" && edge.crossesRegion) continue;
			if (style === "citadel" && !edge.crossesRegion) continue;
			if (edge.crossesRegion && relativeZoom < 2.2 && style !== "citadel") continue;
			if ((style === "constellation" || style === "hextech") && kind === "hierarchy" && edge.from.kind === "unit" && relativeZoom < 1.15) continue;

			const fx = pxOf(edge.from);
			const fy = pyOf(edge.from);
			const tx0 = pxOf(edge.to);
			const ty0 = pyOf(edge.to);
			if (Math.max(fx, tx0) < -16 || Math.max(fy, ty0) < -16 || Math.min(fx, tx0) > width + 16 || Math.min(fy, ty0) > height + 16) continue;

			const dx = tx0 - fx;
			const dy = ty0 - fy;
			const length = Math.hypot(dx, dy);
			if (edge.crossesRegion && length > maxCrossLen && style !== "citadel") continue;
			const sourceGap = dotRadius(edge.from, zoom);
			const targetGap = dotRadius(edge.to, zoom) + 1.5;
			if (length < sourceGap + targetGap + 3) continue;

			const fromNode = nodes.get(edge.from.id);
			const toNode = nodes.get(edge.to.id);
			const bothDone = Boolean(fromNode?.completed && toNode?.completed);
			const target = bothDone ? completedPath : pendingPath;
			if (bothDone) hasCompleted = true;
			else hasPending = true;

			const ux = dx / length;
			const uy = dy / length;
			const sx = fx + ux * sourceGap;
			const sy = fy + uy * sourceGap;
			const tx = tx0 - ux * targetGap;
			const ty = ty0 - uy * targetGap;
			let vx = ux;
			let vy = uy;

			if (style === "clarity" && Math.abs(dx) > 6 && Math.abs(dy) > 6) {
				// Clean smooth orthogonal S-curve for effortless technical reading
				const midX = (sx + tx) * 0.5;
				target.moveTo(sx, sy);
				target.bezierCurveTo(midX, sy, midX, ty, tx, ty);
				vx = dx >= 0 ? 1 : -1;
				vy = 0;
			} else if ((isPre && edge.crossesRegion && length > 26) || style === "citadel") {
				const bend = Math.min(30, length * 0.15);
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

			if (isPre && relativeZoom >= 1.85 && length >= 16) {
				const wing = 3.1;
				const bx = tx - vx * wing * 1.7;
				const by = ty - vy * wing * 1.7;
				target.moveTo(bx - vy * wing, by + vx * wing);
				target.lineTo(tx, ty);
				target.lineTo(bx + vy * wing, by - vx * wing);
			}
		}

		if (!hasPending && !hasCompleted) return;
		ctx.setLineDash(kind === "related" || style === "citadel" ? [4, 5] : []);
		if (hasPending) {
			ctx.strokeStyle = isPre ? palette.ambientPrePending : palette.ambientOtherPending;
			ctx.lineWidth = isPre ? 0.95 : 0.75;
			ctx.stroke(pendingPath);
		}
		if (hasCompleted) {
			ctx.strokeStyle = style === "constellation" ? CEL_RAMPS.volt.base + "99" : palette.ambientCompleted;
			ctx.lineWidth = relativeZoom >= 2 ? 1.7 : 1.2;
			ctx.stroke(completedPath);
		}
	}

	function drawProminentEdges() {
		const buckets: { color: string; dash: number[]; width: number; list: SkillEdge[] }[] = [
			{ color: palette.hierProminent, dash: [], width: 1.7, list: [] },
			{ color: colors.textMuted, dash: [4, 4], width: 1.5, list: [] },
			{ color: palette.preInColor, dash: [], width: 2.4, list: [] },
			{ color: palette.preOutColor, dash: [], width: 2.4, list: [] },
		];
		const seen = hovered && hovered !== selected ? new Set<SkillEdge>() : null;
		const pushIncident = (incident: SkillEdge[] | undefined) => {
			if (!incident) return;
			for (const edge of incident) {
				if (seen) {
					if (seen.has(edge)) continue;
					seen.add(edge);
				}
				const rootEdge = edge.from.kind === "domain" || edge.to.kind === "domain";
				if (rootEdge && relativeZoom < 1.35) continue;
				if (edge.kind === "hierarchy") buckets[0]!.list.push(edge);
				else if (edge.kind === "related") buckets[1]!.list.push(edge);
				else if (edge.to.id === focusId) buckets[2]!.list.push(edge);
				else buckets[3]!.list.push(edge);
			}
		};
		pushIncident(layout.edgesByNode.get(selected));
		if (hovered && hovered !== selected) pushIncident(layout.edgesByNode.get(hovered));

		for (const bucket of buckets) {
			if (!bucket.list.length) continue;
			ctx.beginPath();
			ctx.strokeStyle = bucket.color;
			ctx.lineWidth = bucket.width;
			ctx.setLineDash(bucket.dash);
			for (const edge of bucket.list) {
				const fx = pxOf(edge.from);
				const fy = pyOf(edge.from);
				const tx0 = pxOf(edge.to);
				const ty0 = pyOf(edge.to);
				if (Math.max(fx, tx0) < -24 || Math.max(fy, ty0) < -24 || Math.min(fx, tx0) > width + 24 || Math.min(fy, ty0) > height + 24) continue;
				const isPre = edge.kind === "prerequisite";
				drawEdgePath(fx, fy, tx0, ty0, dotRadius(edge.from, zoom) + 1.5, dotRadius(edge.to, zoom) + 3, isPre, isPre, true);
			}
			ctx.stroke();
		}
	}

	if (style !== "citadel") {
		drawAmbientEdges("hierarchy");
		drawAmbientEdges("related");
		drawAmbientEdges("prerequisite");
		drawProminentEdges();
		ctx.setLineDash([]);
	}

	// ── 4. Nodes (Style-aware Multi-LOD rendering) ───────────────────────────
	let visibleCount = 0;

	if (style === "citadel") {
		// Painter's sort back-to-front by Y so isometric hex blocks stack cleanly in 2.5D
		const visibleHexes: { point: SkillPoint; sx: number; sy: number; node: SkillNode }[] = [];
		for (const point of layout.points.values()) {
			const sx = pxOf(point);
			const sy = pyOf(point);
			if (sx < -36 || sy < -44 || sx > width + 36 || sy > height + 36) continue;
			if (sx >= 0 && sy >= 0 && sx <= width && sy <= height) visibleCount++;
			visibleHexes.push({ point, sx, sy, node: nodes.get(point.id)! });
		}
		visibleHexes.sort((a, b) => a.point.y - b.point.y || (a.point.z ?? 0) - (b.point.z ?? 0));

		const baseHexR = layout.hexTileRadius * 0.92 * zoom;
		for (const { point, sx, sy, node } of visibleHexes) {
			const isFocus = point.id === selected || point.id === hovered;
			const isCurrent = point.id === current;
			const ramp = AREA_RAMPS[point.color % rampLen]!;
			const tileR = Math.max(
				2.4,
				point.kind === "domain"
					? baseHexR * 1.45
					: point.kind === "area"
						? baseHexR * 1.18
						: point.kind === "unit"
							? baseHexR * 1.05
							: baseHexR * 0.94,
			);
			const stateLift = isCurrent ? 22 : node.completed ? 14 : node.inProgress ? 10 : node.state === "available" ? 6 : 0;
			const extrudeH = Math.max(1.8, ((point.z ?? 4) * 0.48 + stateLift) * Math.max(0.18, depth) * zoom);

			let topC: string;
			let leftC: string;
			let rightC: string;
			let inkC: string;
			if (isCurrent) {
				topC = CEL_RAMPS.teal.hl;
				leftC = CEL_RAMPS.teal.base;
				rightC = CEL_RAMPS.teal.shade;
				inkC = ink;
			} else if (node.completed) {
				topC = CEL_RAMPS.mint.hl;
				leftC = CEL_RAMPS.mint.base;
				rightC = CEL_RAMPS.mint.shade;
				inkC = ink;
			} else if (node.inProgress) {
				topC = CEL_RAMPS.amber.hl;
				leftC = CEL_RAMPS.amber.base;
				rightC = CEL_RAMPS.amber.shade;
				inkC = ink;
			} else if (node.leaf && node.state === "available") {
				topC = CEL_RAMPS.sky.hl;
				leftC = CEL_RAMPS.sky.base;
				rightC = CEL_RAMPS.sky.shade;
				inkC = ink;
			} else if (point.kind === "domain" || point.kind === "area" || point.kind === "unit") {
				topC = ramp.base + (dark ? "88" : "99");
				leftC = ramp.shade + "aa";
				rightC = palette.metalShade;
				inkC = ink;
			} else {
				topC = colors.surface;
				leftC = palette.metalBase;
				rightC = palette.metalShade;
				inkC = palette.pendingDotStroke;
			}

			drawHexPrism(ctx, sx, sy, tileR, extrudeH, topC, leftC, rightC, inkC, isFocus);

			if (tileR >= 9) {
				if (node.completed) drawCheckGlyph(ctx, sx, sy, tileR * 0.56, dark ? "#07070b" : "#ffffff");
				else if (node.leaf && node.state === "available" && !node.inProgress) drawPlayGlyph(ctx, sx, sy, tileR * 0.48, dark ? "#07070b" : "#ffffff");
			}
			if (isCurrent) {
				ctx.beginPath();
				ctx.ellipse(sx, sy - 4 * zoom, tileR * 1.32, tileR * 0.85, 0, 0, TAU);
				ctx.strokeStyle = beacon;
				ctx.lineWidth = 2.2;
				ctx.stroke();
			}
		}

		// Bridges & active dependencies drawn above isometric blocks
		drawAmbientEdges("prerequisite");
		drawProminentEdges();
		ctx.setLineDash([]);
	} else {
		// Constellation, Hextech, Atlas & Clarity node passes (RPG sockets for game styles, crisp cel nodes for atlas/clarity)
		const isGameTree = style === "constellation" || style === "hextech";
		const foregroundPoints: { point: SkillPoint; sx: number; sy: number; node: SkillNode }[] = [];
		const pendingDotPath = new Path2D();
		let hasPendingDots = false;
		const lockGlyphs: { x: number; y: number; r: number }[] = [];
		const pendingLandmarks: { point: SkillPoint; sx: number; sy: number; radius: number; node: SkillNode }[] = [];
		const closePending = relativeZoom >= (style === "clarity" ? 1.95 : 2.5);
		const dotScale = relativeZoom < 1.8 ? 0.86 : 0.94;

		for (const point of layout.points.values()) {
			const sx = pxOf(point);
			const sy = pyOf(point);
			if (sx < -28 || sy < -28 || sx > width + 28 || sy > height + 28) continue;
			if (sx >= 0 && sy >= 0 && sx <= width && sy <= height) visibleCount++;
			const node = nodes.get(point.id)!;
			const active = point.id === selected || point.id === hovered || point.id === current;
			const highlight = active || node.completed || node.inProgress || (node.leaf && node.state === "available");
			if (highlight) {
				foregroundPoints.push({ point, sx, sy, node });
				continue;
			}
			const radius = dotRadius(point, zoom);
			if (point.kind === "domain" || point.kind === "area" || point.kind === "unit") {
				pendingLandmarks.push({ point, sx, sy, radius, node });
			} else {
				const r = relativeZoom < 1.8 ? Math.max(1.6, radius * dotScale) : radius * dotScale;
				pendingDotPath.moveTo(sx + r, sy);
				pendingDotPath.arc(sx, sy, r, 0, TAU);
				hasPendingDots = true;
				if (closePending && r >= 8.2) lockGlyphs.push({ x: sx, y: sy, r: r * 0.72 });
			}
		}

		// Batched pending sockets (~800 nodes in 1–2 draw calls)
		if (hasPendingDots) {
			ctx.fillStyle = closePending || style === "clarity" ? colors.surface : palette.pendingDotFarFill;
			ctx.fill(pendingDotPath);
			if (closePending || style === "clarity") {
				ctx.strokeStyle = palette.pendingDotStroke;
				ctx.lineWidth = style === "clarity" ? 1.35 : 1.2;
				ctx.stroke(pendingDotPath);
				for (const g of lockGlyphs) drawLockGlyph(ctx, g.x, g.y, g.r, colors.textMuted);
			}
		}

		// Pending landmarks (Keystones & Notables)
		for (const { point, sx, sy, radius, node } of pendingLandmarks) {
			const ramp = AREA_RAMPS[point.color % rampLen]!;
			const zStat = zoneStats.get(point.id);
			const frac = zStat && zStat.total > 0 ? zStat.completed / zStat.total : 0;
			if (isGameTree && (point.kind === "domain" || point.kind === "area")) {
				drawKeystoneSocket(ctx, sx, sy, Math.max(6.5, radius * 1.15), ramp, frac, palette, false, point.kind === "domain");
			} else if (isGameTree && point.kind === "unit") {
				drawNotableSocket(ctx, sx, sy, Math.max(4.8, radius * 1.05), node, ramp, frac, palette, false);
			} else {
				if (radius >= 6) {
					ctx.beginPath();
					const lr = radius * 1.08;
					ctx.moveTo(sx + 1.5, sy - lr + 1.5);
					ctx.lineTo(sx + lr + 1.5, sy + 1.5);
					ctx.lineTo(sx + 1.5, sy + lr + 1.5);
					ctx.lineTo(sx - lr + 1.5, sy + 1.5);
					ctx.closePath();
					ctx.fillStyle = palette.landmarkShadow;
					ctx.fill();
				}
				ctx.beginPath();
				const lr = radius * 1.08;
				ctx.moveTo(sx, sy - lr);
				ctx.lineTo(sx + lr, sy);
				ctx.lineTo(sx, sy + lr);
				ctx.lineTo(sx - lr, sy);
				ctx.closePath();
				ctx.fillStyle = colors.surface;
				ctx.fill();
				ctx.strokeStyle = palette.landmarkStroke[point.color % rampLen]!;
				ctx.lineWidth = radius >= 6 ? 1.6 : 1.15;
				ctx.stroke();
			}
		}

		// Foreground active / completed / available nodes
		for (const { point, sx, sy, node } of foregroundPoints) {
			const baseRadius = dotRadius(point, zoom);
			const isSelected = point.id === selected;
			const isHovered = point.id === hovered;
			const active = isSelected || isHovered;
			const ramp = AREA_RAMPS[point.color % rampLen]!;
			const zStat = zoneStats.get(point.id);
			const frac = zStat && zStat.total > 0 ? zStat.completed / zStat.total : 0;

			if (isGameTree && (point.kind === "domain" || point.kind === "area")) {
				drawKeystoneSocket(ctx, sx, sy, Math.max(7, baseRadius * 1.18), ramp, frac, palette, active, point.kind === "domain");
				continue;
			}
			if (isGameTree && point.kind === "unit") {
				drawNotableSocket(ctx, sx, sy, Math.max(5.4, baseRadius * 1.08), node, ramp, frac, palette, active);
				continue;
			}

			const landmark = point.kind === "domain" || point.kind === "area" || point.kind === "unit";
			const radius = node.completed || node.inProgress
				? baseRadius + (relativeZoom < 1.8 && !landmark ? 0.95 : 0.45)
				: node.state === "available" && !landmark
					? baseRadius + (relativeZoom < 1.8 ? 0.6 : 0.25)
					: baseRadius;

			if (active || point.id === current) {
				ctx.beginPath();
				ctx.arc(sx, sy, radius + (isSelected ? 7.5 : 6), 0, TAU);
				ctx.fillStyle = colors.surface;
				ctx.fill();
				ctx.strokeStyle = isSelected ? colors.accent : colors.text;
				ctx.lineWidth = isSelected ? 2.3 : 1.6;
				ctx.stroke();
			}

			if (node.completed) {
				ctx.beginPath();
				ctx.arc(sx, sy, radius + (relativeZoom < 1.6 ? 2.2 : 3.4), 0, TAU);
				ctx.fillStyle = palette.completedHalo;
				ctx.fill();
			} else if (node.inProgress) {
				ctx.beginPath();
				ctx.arc(sx, sy, radius + (relativeZoom < 1.6 ? 2.5 : 4), 0, TAU);
				ctx.fillStyle = palette.inProgressHalo;
				ctx.fill();
				ctx.strokeStyle = inProgressColor;
				ctx.lineWidth = 1.5;
				ctx.setLineDash([2.8, 2.2]);
				ctx.stroke();
				ctx.setLineDash([]);
			}

			const traceNodeShape = (ox: number, oy: number) => {
				ctx.beginPath();
				if (landmark || point.kind === "topic") {
					const lr = radius * (landmark ? 1.08 : 1.04);
					ctx.moveTo(ox, oy - lr);
					ctx.lineTo(ox + lr, oy);
					ctx.lineTo(ox, oy + lr);
					ctx.lineTo(ox - lr, oy);
					ctx.closePath();
				} else {
					ctx.arc(ox, oy, radius, 0, TAU);
				}
			};

			if (radius >= 5.5) {
				traceNodeShape(sx + 1.6, sy + 1.8);
				ctx.fillStyle = palette.fgShadow;
				ctx.fill();
			}

			traceNodeShape(sx, sy);
			if (node.completed) ctx.fillStyle = completedColor;
			else if (node.inProgress) ctx.fillStyle = inProgressColor;
			else if (node.state === "available") ctx.fillStyle = style === "clarity" ? colors.surface : colors.surface;
			else if (landmark) ctx.fillStyle = palette.areaTints[point.color % rampLen]!;
			else ctx.fillStyle = colors.text;
			ctx.fill();

			if (radius >= 6.4 && !landmark) {
				if (node.completed) {
					drawCheckGlyph(ctx, sx, sy, radius, dark ? "#07070b" : "#ffffff");
				} else if (node.inProgress) {
					ctx.beginPath();
					ctx.arc(sx, sy, radius * 0.34, 0, TAU);
					ctx.fillStyle = dark ? "#07070b" : "#ffffff";
					ctx.fill();
				} else if (node.state === "available") {
					drawPlayGlyph(ctx, sx, sy, radius * 0.72, style === "clarity" ? palette.availableColor : colors.text);
				}
			} else if (node.completed && radius >= 4) {
				ctx.beginPath();
				ctx.arc(sx - radius * 0.28, sy - radius * 0.28, Math.max(1, radius * 0.24), 0, TAU);
				ctx.fillStyle = "rgb(255 255 255 / 0.65)";
				ctx.fill();
			}

			traceNodeShape(sx, sy);
			if (active) {
				ctx.strokeStyle = colors.text;
				ctx.lineWidth = 1.8;
			} else if (node.state === "available" && !node.completed && !node.inProgress) {
				ctx.strokeStyle = style === "clarity" ? palette.availableColor : colors.text;
				ctx.lineWidth = relativeZoom < 1.8 ? 1.6 : 2;
			} else {
				ctx.strokeStyle = ink;
				ctx.lineWidth = radius >= 6 ? 1.5 : 1;
			}
			ctx.stroke();
		}
	}

	// ── 5. Learner position beacon (always visible above crowded neighbors) ──
	const position = current && layout.points.get(current);
	if (position) {
		const x = pxOf(position);
		const y = pyOf(position);
		if (x >= -24 && y >= -24 && x <= width + 24 && y <= height + 24) {
			const radius = Math.max(5.2, dotRadius(position, zoom));
			ctx.save();
			ctx.beginPath();
			ctx.arc(x, y, radius + 7.5, 0, TAU);
			ctx.fillStyle = palette.beaconHalo;
			ctx.fill();
			ctx.strokeStyle = beacon;
			ctx.lineWidth = 2.1;
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

	// ── 6. Multi-LOD Collision-Free Labels ───────────────────────────────────
	const labels: { point: SkillPoint; sx: number; sy: number; priority: number; active: boolean }[] = [];
	const skillCardThreshold = style === "clarity" ? 1.85 : 3.0;
	const topicThreshold = style === "clarity" ? 1.45 : 2.1;
	const unitThreshold = style === "clarity" ? 1.05 : 1.45;

	for (const point of layout.points.values()) {
		const active = point.id === selected || point.id === hovered;
		const priority = point.id === current ? 6 : active ? 5 : point.kind === "domain" ? 4 : point.kind === "area" ? 3 : point.kind === "unit" ? 2 : 1;
		// Clarity renders area headers in swimlane columns & unit titles in unit cards
		if (!active && style === "clarity" && (priority === 3 || (priority === 2 && relativeZoom >= 1.1))) continue;
		if (!active && style === "atlas" && priority === 2 && relativeZoom >= 1.65) continue;
		if (!active && ((priority === 1 && relativeZoom < (point.kind === "topic" ? topicThreshold : skillCardThreshold)) || (priority === 2 && relativeZoom < unitThreshold))) continue;
		const sx = pxOf(point);
		const sy = pyOf(point);
		if (sx >= -36 && sy >= -36 && sx <= width + 36 && sy <= height + 36) {
			labels.push({ point, sx, sy, priority, active });
		}
	}
	labels.sort((a, b) => b.priority - a.priority);

	const occupied: { left: number; right: number; top: number; bottom: number }[] = [];
	const closeSkillFont = `600 ${style === "clarity" ? 12 : 11.5}px ${fontFamily}`;
	ctx.textBaseline = "middle";
	ctx.lineJoin = "round";

	for (const { point, sx, sy, priority, active } of labels) {
		const node = nodes.get(point.id)!;
		const pill = point.id === current || active || ((style === "constellation" || style === "hextech" || style === "citadel") && priority === 3);
		const closeSkill = !pill && priority === 1 && relativeZoom >= skillCardThreshold;

		if (closeSkill) {
			const maxW = style === "clarity" ? Math.min(170, Math.max(108, zoom * 68)) : Math.min(148, Math.max(92, zoom * 62));
			const lines = textCache.wrapLines(ctx, closeSkillFont, node.title, maxW, 2);
			const lineH = style === "clarity" ? 15 : 14;
			let widest = 0;
			for (const l of lines) {
				const lw = textCache.measureWidth(ctx, closeSkillFont, l);
				if (lw > widest) widest = lw;
			}
			const boxW = widest + 14;
			const boxH = lines.length * lineH + 7;
			const cx = Math.max(boxW / 2 + 6, Math.min(width - boxW / 2 - 6, sx));
			const topY = Math.min(height - boxH - 8, sy + dotRadius(point, zoom) + 7);
			const bounds = { left: cx - boxW / 2 - 3, right: cx + boxW / 2 + 3, top: topY - 2, bottom: topY + boxH + 2 };
			if (occupied.some((b) => b.left < bounds.right && b.right > bounds.left && b.top < bounds.bottom && b.bottom > bounds.top)) continue;
			occupied.push(bounds);

			ctx.beginPath();
			ctx.roundRect(cx - boxW / 2, topY, boxW, boxH, 7);
			ctx.fillStyle = palette.closeSkillFill;
			ctx.fill();
			ctx.strokeStyle = node.completed
				? palette.closeSkillBorderCompleted
				: node.inProgress
					? palette.closeSkillBorderInProgress
					: palette.closeSkillBorderDefault;
			ctx.lineWidth = style === "clarity" ? 1.15 : 1;
			ctx.stroke();

			ctx.font = closeSkillFont;
			ctx.textAlign = "center";
			ctx.fillStyle = node.completed || node.inProgress || node.state === "available" || style === "clarity" ? colors.text : colors.textMuted;
			for (const [idx, line] of lines.entries()) {
				ctx.fillText(line, cx, topY + 3.5 + lineH * (idx + 0.5));
			}
			ctx.textAlign = "left";
			continue;
		}

		const fontSize = priority >= 4 ? 13 : priority >= 3 ? 12 : priority >= 2 ? 11.5 : 11.5;
		const fontWeight = priority >= 3 ? "700" : priority >= 2 ? "600" : "500";
		const font = `${fontWeight} ${fontSize}px ${fontFamily}`;
		const padX = pill ? 9 : 0;

		const isAreaPill = pill && priority === 3 && point.id !== current && !active;
		const zStat = isAreaPill ? zoneStats.get(point.id) : undefined;
		const pctSuffix = zStat && zStat.total > 0 && zStat.completed > 0 ? ` · ${Math.round((zStat.completed / zStat.total) * 100)}%` : "";
		const stateSuffix = point.id === hovered && node.leaf ? ` · ${statusLabelOf(node, strings)}` : "";
		const rawLabel = (point.id === current ? `${strings.youAreHere} · ` : "") + node.title + pctSuffix + stateSuffix;

		const zone = layout.zoneById.get(point.id);
		const zoneHasBadge = Boolean(zone && zone.heading === "area" && (zoneStats.get(zone.id)?.completed ?? 0) > 0 && zone.width * zoom >= 120);
		const centeredPill = isAreaPill || point.id === current || (point.kind === "domain" && relativeZoom < 2.25);

		const maxAvail = centeredPill
			? Math.min(270, width - 32)
			: Math.min(width - (sx + dotRadius(point, zoom) + 9) - padX - 8, zone && !pill ? camX + (zone.x + zone.width) * zoom - (sx + dotRadius(point, zoom) + 9) - (zoneHasBadge ? 56 : 8) : 280);
		if (maxAvail < 28) continue;

		const label = textCache.truncate(ctx, font, rawLabel, maxAvail);
		const textWidth = textCache.measureWidth(ctx, font, label);

		const x = centeredPill
			? Math.max(padX + 8, Math.min(sx - textWidth / 2, width - textWidth - padX - 8))
			: Math.max(8, Math.min(sx + dotRadius(point, zoom) + 9, width - textWidth - padX - 8));
		const y = point.id === current
			? Math.max(22, sy - dotRadius(point, zoom) - 22)
			: isAreaPill
				? Math.max(20, sy - dotRadius(point, zoom) - 18)
				: point.kind === "domain" && relativeZoom < 2.25
					? Math.min(height - 18, sy + dotRadius(point, zoom) + 18)
					: priority > 1 && point.kind !== "topic" && point.kind !== "atom"
						? sy
						: Math.min(height - 18, sy + dotRadius(point, zoom) + 14);

		let textY = y;
		const overlaps = (topY: number) => {
			const b = { left: x - padX - 3, right: x + textWidth + padX + 3, top: topY - (pill ? 13 : 8), bottom: topY + (pill ? 13 : 8) };
			return occupied.some((o) => o.left < b.right && o.right > b.left && o.top < b.bottom && o.bottom > b.top);
		};
		if (pill && overlaps(textY)) {
			for (const dy of [-26, 26, -50, 50]) {
				const candidateY = Math.max(18, Math.min(height - 18, y + dy));
				if (!overlaps(candidateY)) {
					textY = candidateY;
					break;
				}
			}
		}
		const bounds = {
			left: x - padX - 3,
			right: x + textWidth + padX + 3,
			top: textY - (pill ? 13 : 8),
			bottom: textY + (pill ? 13 : 8),
		};
		if (!pill && occupied.some((b) => b.left < bounds.right && b.right > bounds.left && b.top < bounds.bottom && b.bottom > bounds.top)) continue;
		occupied.push(bounds);

		ctx.font = font;
		if (pill) {
			const rx = x - padX;
			const ry = textY - 12;
			const rw = textWidth + padX * 2;
			const rh = 24;
			ctx.beginPath();
			ctx.roundRect(rx + 1.5, ry + 2, rw, rh, 999);
			ctx.fillStyle = palette.landmarkShadow;
			ctx.fill();

			ctx.beginPath();
			ctx.roundRect(rx, ry, rw, rh, 999);
			ctx.fillStyle = colors.surface;
			ctx.fill();
			ctx.strokeStyle = point.id === current ? beacon : isAreaPill ? palette.areaTints[point.color % rampLen]! : colors.accent;
			ctx.lineWidth = point.id === current ? 1.85 : 1.4;
			ctx.stroke();
			ctx.fillStyle = point.id === current ? beacon : colors.text;
			ctx.fillText(label, x, textY + 0.5);
		} else {
			ctx.lineWidth = 3.5;
			ctx.strokeStyle = colors.surface;
			ctx.fillStyle = priority === 3 ? palette.areaTints[point.color % rampLen]! : colors.text;
			ctx.strokeText(label, x, textY);
			ctx.fillText(label, x, textY);
		}
	}

	// ── 7. Interactive Minimap when zoomed in ────────────────────────────────
	if (relativeZoom > 1.35 && width >= 460 && height >= 280) {
		const mx = width - MINIMAP_W - MINIMAP_PAD;
		const my = height - MINIMAP_H - MINIMAP_PAD;
		const mm = getMinimap();

		ctx.save();
		ctx.drawImage(mm.canvas, mx, my, MINIMAP_W + MINIMAP_SHADOW_PAD, MINIMAP_H + MINIMAP_SHADOW_PAD);
		ctx.beginPath();
		ctx.roundRect(mx, my, MINIMAP_W, MINIMAP_H, 12);
		ctx.clip();

		const vx = mx + mm.ox + (-camX / zoom) * mm.ms;
		const vy = my + mm.oy + (-camY / zoom) * mm.ms;
		const vw = (width / zoom) * mm.ms;
		const vh = (height / zoom) * mm.ms;
		ctx.fillStyle = palette.minimapLensFill;
		ctx.fillRect(vx, vy, vw, vh);
		ctx.strokeStyle = colors.accent;
		ctx.lineWidth = 1.5;
		ctx.strokeRect(vx, vy, vw, vh);
		ctx.restore();
	}

	return visibleCount;
}
