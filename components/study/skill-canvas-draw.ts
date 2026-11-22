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
	getRadialGlowSprite,
	traceHexTopPath,
	type AtlasPalette,
	type Camera,
	type CanvasStrings,
	type MinimapCache,
	type StaticLayerCache,
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
	getStaticLayer?: () => StaticLayerCache | null;
	isInteracting?: boolean;
	isDraggingDepth?: boolean;
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

function resolveCitadelHexStyle(
	point: SkillPoint,
	node: SkillNode,
	isCurrent: boolean,
	depth: number,
	zoom: number,
	palette: AtlasPalette,
) {
	const rampLen = AREA_RAMPS.length;
	const ramp = AREA_RAMPS[point.color % rampLen]!;
	const stateLift = isCurrent ? 22 : node.completed ? 14 : node.inProgress ? 10 : node.state === "available" ? 6 : 0;
	const extrudeH = Math.max(1.8, ((point.z ?? 4) * 0.48 + stateLift) * Math.max(0.18, depth) * zoom);
	if (isCurrent) {
		return { extrudeH, topC: CEL_RAMPS.teal.hl, leftC: CEL_RAMPS.teal.base, rightC: CEL_RAMPS.teal.shade, inkC: palette.ink };
	}
	if (node.completed) {
		return { extrudeH, topC: CEL_RAMPS.mint.hl, leftC: CEL_RAMPS.mint.base, rightC: CEL_RAMPS.mint.shade, inkC: palette.ink };
	}
	if (node.inProgress) {
		return { extrudeH, topC: CEL_RAMPS.amber.hl, leftC: CEL_RAMPS.amber.base, rightC: CEL_RAMPS.amber.shade, inkC: palette.ink };
	}
	if (node.leaf && node.state === "available") {
		return { extrudeH, topC: CEL_RAMPS.sky.hl, leftC: CEL_RAMPS.sky.base, rightC: CEL_RAMPS.sky.shade, inkC: palette.ink };
	}
	if (point.kind === "domain" || point.kind === "area" || point.kind === "unit") {
		return {
			extrudeH,
			topC: ramp.base + (palette.dark ? "88" : "99"),
			leftC: ramp.shade + "aa",
			rightC: palette.metalShade,
			inkC: palette.ink,
		};
	}
	return {
		extrudeH,
		topC: palette.colors.surface,
		leftC: palette.metalBase,
		rightC: palette.metalShade,
		inkC: palette.pendingDotStroke,
	};
}

function drawBatchedPendingDiamonds(
	ctx: CanvasRenderingContext2D,
	pendingLandmarks: { point: SkillPoint; sx: number; sy: number; radius: number }[],
	palette: AtlasPalette,
	rampLen: number,
) {
	if (!pendingLandmarks.length) return;
	const shadowPath = new Path2D();
	const fillPath = new Path2D();
	const strokeBuckets: (Path2D | null)[] = new Array(rampLen).fill(null);
	let hasShadow = false;
	let thickStroke = false;

	for (const { point, sx, sy, radius } of pendingLandmarks) {
		const lr = radius * 1.08;
		if (radius >= 6) {
			hasShadow = true;
			thickStroke = true;
			shadowPath.moveTo(sx + 1.5, sy - lr + 1.5);
			shadowPath.lineTo(sx + lr + 1.5, sy + 1.5);
			shadowPath.lineTo(sx + 1.5, sy + lr + 1.5);
			shadowPath.lineTo(sx - lr + 1.5, sy + 1.5);
			shadowPath.closePath();
		}
		fillPath.moveTo(sx, sy - lr);
		fillPath.lineTo(sx + lr, sy);
		fillPath.lineTo(sx, sy + lr);
		fillPath.lineTo(sx - lr, sy);
		fillPath.closePath();

		const ci = point.color % rampLen;
		let sp = strokeBuckets[ci];
		if (!sp) {
			sp = new Path2D();
			strokeBuckets[ci] = sp;
		}
		sp.moveTo(sx, sy - lr);
		sp.lineTo(sx + lr, sy);
		sp.lineTo(sx, sy + lr);
		sp.lineTo(sx - lr, sy);
		sp.closePath();
	}

	if (hasShadow) {
		ctx.fillStyle = palette.landmarkShadow;
		ctx.fill(shadowPath);
	}
	ctx.fillStyle = palette.colors.surface;
	ctx.fill(fillPath);
	ctx.lineWidth = thickStroke ? 1.5 : 1.15;
	for (let ci = 0; ci < rampLen; ci++) {
		const sp = strokeBuckets[ci];
		if (!sp) continue;
		ctx.strokeStyle = palette.landmarkStroke[ci]!;
		ctx.stroke(sp);
	}
}

function drawStaticBackdropAndNodes(
	ctx: CanvasRenderingContext2D,
	layout: SkillLayout,
	nodes: Map<string, SkillNode>,
	zoneStats: ZoneStats,
	width: number,
	height: number,
	camX: number,
	camY: number,
	zoom: number,
	relativeZoom: number,
	depth: number,
	palette: AtlasPalette,
	selected: string | undefined,
	hovered: string | undefined,
	current: string | undefined,
	skipFocusEdges: boolean,
	isBake = false,
): number {
	const { colors, dark, completedColor } = palette;
	const style = layout.style;
	const rampLen = AREA_RAMPS.length;
	const is25D = style === "constellation" || style === "hextech" || style === "citadel";
	const zLiftScale = is25D ? depth * 0.55 : 0;

	const pxOf = (pt: SkillPoint) => camX + pt.x * zoom;
	const pyOf = (pt: SkillPoint) => camY + (zLiftScale ? pt.y - (pt.z ?? 0) * zLiftScale : pt.y) * zoom;

	// World-space viewport bounds for fast culling
	const padW = 48 / zoom;
	const wMinX = -camX / zoom - padW;
	const wMaxX = (width - camX) / zoom + padW;
	const wMinY = -camY / zoom - padW;
	const wMaxY = (height - camY) / zoom + padW + (is25D ? 60 * depth : 0);

	// ── 1. Architectural Backdrop ────────────────────────────────────────────
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
			if (i > 0) ctx.setLineDash([]);
		}
		// Group constellation wheels by color to minimize fillStyle/strokeStyle churn
		const innerRingPath = new Path2D();
		let hasInnerRings = false;
		const wheelLineW = Math.max(0.9, Math.min(2, zoom * 1.4));
		for (const wheel of layout.wheels) {
			if (wheel.cx + wheel.radius * 1.3 < wMinX || wheel.cx - wheel.radius * 1.3 > wMaxX || wheel.cy + wheel.radius * 1.3 < wMinY || wheel.cy - wheel.radius * 1.3 > wMaxY) continue;
			const wx = camX + wheel.cx * zoom;
			const wy = camY + wheel.cy * zoom;
			const wr = wheel.radius * zoom;
			const ramp = AREA_RAMPS[wheel.color % rampLen]!;
			const zStat = zoneStats.get(wheel.unitId);
			const done = Boolean(zStat && zStat.total > 0 && zStat.completed >= zStat.total);
			const rOuter = wr * 1.06;
			ctx.beginPath();
			ctx.arc(wx, wy, rOuter, 0, TAU);
			ctx.fillStyle = (done ? completedColor : ramp.base) + (dark ? "12" : "0e");
			ctx.fill();
			ctx.strokeStyle = (done ? completedColor : ramp.base) + (dark ? "42" : "36");
			ctx.lineWidth = wheelLineW;
			ctx.stroke();
			if (wr >= 22) {
				const rIn = wr * 0.6;
				innerRingPath.moveTo(wx + rIn, wy);
				innerRingPath.arc(wx, wy, rIn, 0, TAU);
				hasInnerRings = true;
			}
		}
		if (hasInnerRings) {
			ctx.strokeStyle = palette.progressTrack;
			ctx.lineWidth = 0.85;
			ctx.stroke(innerRingPath);
		}
	} else if (style === "hextech") {
		const depthPx = 9 * depth * zoom;
		for (const gear of layout.gears) {
			if (gear.cx + gear.radius * 1.2 < wMinX || gear.cx - gear.radius * 1.2 > wMaxX || gear.cy + gear.radius * 1.2 < wMinY || gear.cy - gear.radius * 1.2 > wMaxY) continue;
			const gx = camX + gear.cx * zoom;
			const gy = camY + gear.cy * zoom;
			const gr = gear.radius * zoom;
			const ramp = gear.isRoot ? CEL_RAMPS.teal : AREA_RAMPS[gear.color % rampLen]!;
			const zStat = zoneStats.get(gear.id);
			const active = Boolean(gear.isRoot || (zStat && zStat.completed > 0));
			drawGearWheel(ctx, gx, gy, gr, gear.teeth, gear.color * 0.35, ramp, active, palette, depthPx);
		}
	} else if (style === "citadel") {
		for (const cluster of layout.hexClusters) {
			const rx = cluster.radius * zoom;
			const ry = cluster.radius * 0.72 * zoom;
			const cx = camX + cluster.cx * zoom;
			const cy = camY + cluster.cy * zoom;
			if (cx + rx < -20 || cx - rx > width + 20 || cy + ry < -20 || cy - ry > height + 20) continue;
			const ramp = AREA_RAMPS[cluster.color % rampLen]!;
			const sprite = getRadialGlowSprite(ramp.base, dark);
			if (sprite) {
				ctx.drawImage(sprite, cx - rx * 1.05, cy - ry * 1.08, rx * 2.1, ry * 2.16);
			}
		}
	} else if (style === "clarity") {
		for (const lane of layout.lanes) {
			if (lane.x > wMaxX || lane.y > wMaxY || lane.x + lane.width < wMinX || lane.y + lane.height < wMinY) continue;
			const x = camX + lane.x * zoom;
			const y = camY + lane.y * zoom;
			const w = lane.width * zoom;
			const h = lane.height * zoom;
			const colorIdx = lane.color % rampLen;
			const tint = palette.areaTints[colorIdx]!;
			const zStat = zoneStats.get(lane.areaId);
			const done = Boolean(zStat && zStat.total > 0 && zStat.completed >= zStat.total);
			const headW = Math.min(w * 0.45, lane.headerWidth * zoom);
			const rad = Math.min(16, h / 4);

			ctx.beginPath();
			ctx.roundRect(x, y, w, h, rad);
			ctx.fillStyle = palette.clarityLaneBg;
			ctx.fill();
			ctx.strokeStyle = done ? palette.areaStrokeDone : palette.clarityCardBorder;
			ctx.lineWidth = 1.15;
			ctx.stroke();

			if (headW >= 32) {
				ctx.beginPath();
				ctx.roundRect(x, y, headW, h, [rad, 0, 0, rad]);
				ctx.fillStyle = palette.clarityLaneHeaderBg;
				ctx.fill();
				ctx.fillStyle = done ? completedColor : tint;
				ctx.fillRect(x, y + 10, Math.max(3, 4 * Math.min(1.5, zoom)), Math.max(8, h - 20));
			}
		}

		// Batch all normal clarity unit cards into ONE fill + stroke path!
		const normalCardPath = new Path2D();
		const doneCardPath = new Path2D();
		let hasNormalCards = false;
		let hasDoneCards = false;
		for (const zone of layout.zones) {
			if (zone.heading !== "unit") continue;
			if (zone.x > wMaxX || zone.y > wMaxY || zone.x + zone.width < wMinX || zone.y + zone.height < wMinY) continue;
			const x = camX + zone.x * zoom;
			const y = camY + zone.y * zoom;
			const w = zone.width * zoom;
			const h = zone.height * zoom;
			const zStat = zoneStats.get(zone.id);
			const done = Boolean(zStat && zStat.total > 0 && zStat.completed >= zStat.total);
			const target = done ? doneCardPath : normalCardPath;
			target.roundRect(x, y, w, h, Math.min(12, w / 5, h / 5));
			if (done) hasDoneCards = true;
			else hasNormalCards = true;
		}
		if (hasNormalCards) {
			ctx.fillStyle = palette.clarityCardBg;
			ctx.fill(normalCardPath);
			ctx.strokeStyle = palette.clarityCardBorder;
			ctx.lineWidth = 1;
			ctx.stroke(normalCardPath);
		}
		if (hasDoneCards) {
			ctx.fillStyle = palette.unitFillDone;
			ctx.fill(doneCardPath);
			ctx.strokeStyle = palette.unitStrokeDone;
			ctx.lineWidth = 1.35;
			ctx.stroke(doneCardPath);
		}
	} else {
		// "atlas" cartographic zones — batched shadows & grouped fills/strokes by color!
		const areaShadowPath = new Path2D();
		let hasAreaShadow = false;
		const areaNormalPaths: (Path2D | null)[] = new Array(rampLen).fill(null);
		const areaDonePath = new Path2D();
		let hasAreaDone = false;
		const unitNormalPaths: (Path2D | null)[] = new Array(rampLen).fill(null);
		const unitDonePath = new Path2D();
		let hasUnitDone = false;
		const progressTracks: { x: number; y: number; w: number; barW: number }[] = [];

		for (const zone of layout.zones) {
			if (zone.x > wMaxX || zone.y > wMaxY || zone.x + zone.width < wMinX || zone.y + zone.height < wMinY) continue;
			const x = camX + zone.x * zoom;
			const y = camY + zone.y * zoom;
			const w = zone.width * zoom;
			const h = zone.height * zoom;
			const colorIdx = zone.color % rampLen;
			const zStat = zoneStats.get(zone.id);
			const fraction = zStat && zStat.total > 0 ? zStat.completed / zStat.total : 0;
			const zoneDone = fraction >= 1;

			if (zone.heading === "area") {
				const rad = Math.min(20, w / 4, h / 4);
				areaShadowPath.roundRect(x + 2, y + 3, w, h, rad);
				hasAreaShadow = true;
				if (zoneDone) {
					areaDonePath.roundRect(x, y, w, h, rad);
					hasAreaDone = true;
				} else {
					let p = areaNormalPaths[colorIdx];
					if (!p) {
						p = new Path2D();
						areaNormalPaths[colorIdx] = p;
					}
					p.roundRect(x, y, w, h, rad);
				}
				if (fraction > 0 && w > 54) {
					progressTracks.push({ x: x + 12, y: y - 1.5, w: w - 24, barW: Math.max(8, Math.min(w - 24, (w - 24) * fraction)) });
				}
			} else {
				const rad = Math.min(12, w / 4, h / 4);
				if (zoneDone) {
					unitDonePath.roundRect(x, y, w, h, rad);
					hasUnitDone = true;
				} else {
					let p = unitNormalPaths[colorIdx];
					if (!p) {
						p = new Path2D();
						unitNormalPaths[colorIdx] = p;
					}
					p.roundRect(x, y, w, h, rad);
				}
			}
		}

		if (hasAreaShadow) {
			ctx.fillStyle = dark ? "rgb(0 0 0 / 0.24)" : "rgb(30 27 46 / 0.06)";
			ctx.fill(areaShadowPath);
		}
		ctx.lineWidth = relativeZoom >= 1.8 ? 1.55 : 1.2;
		for (let ci = 0; ci < rampLen; ci++) {
			const p = areaNormalPaths[ci];
			if (!p) continue;
			ctx.fillStyle = palette.areaFillNormal[ci]!;
			ctx.fill(p);
			ctx.strokeStyle = palette.areaStrokeNormal[ci]!;
			ctx.stroke(p);
		}
		if (hasAreaDone) {
			ctx.fillStyle = palette.areaFillDone;
			ctx.fill(areaDonePath);
			ctx.strokeStyle = palette.areaStrokeDone;
			ctx.stroke(areaDonePath);
		}
		const strokeUnits = relativeZoom >= 1.25;
		ctx.lineWidth = 0.9;
		for (let ci = 0; ci < rampLen; ci++) {
			const p = unitNormalPaths[ci];
			if (!p) continue;
			ctx.fillStyle = palette.unitFillNormal[ci]!;
			ctx.fill(p);
			if (strokeUnits) {
				ctx.strokeStyle = palette.unitStrokeNormal[ci]!;
				ctx.stroke(p);
			}
		}
		if (hasUnitDone) {
			ctx.fillStyle = palette.unitFillDone;
			ctx.fill(unitDonePath);
			ctx.strokeStyle = palette.unitStrokeDone;
			ctx.lineWidth = 1.25;
			ctx.stroke(unitDonePath);
		}
		if (progressTracks.length) {
			const trackPath = new Path2D();
			const fillBarPath = new Path2D();
			for (const tr of progressTracks) {
				trackPath.roundRect(tr.x, tr.y, tr.w, 3, 2);
				fillBarPath.roundRect(tr.x, tr.y, tr.barW, 3, 2);
			}
			ctx.fillStyle = palette.progressTrack;
			ctx.fill(trackPath);
			ctx.fillStyle = completedColor;
			ctx.fill(fillBarPath);
		}
	}

	// ── 2. Overview links & structural rails ─────────────────────────────────
	if (style === "constellation" || style === "hextech") {
		const branchPath = new Path2D();
		let hasBranch = false;
		for (const link of layout.overviewLinks) {
			const fx = pxOf(link.from);
			const fy = pyOf(link.from);
			const tx = pxOf(link.to);
			const ty = pyOf(link.to);
			if (Math.max(fx, tx) < -32 || Math.max(fy, ty) < -32 || Math.min(fx, tx) > width + 32 || Math.min(fy, ty) > height + 32) continue;
			const fromNode = nodes.get(link.from.id);
			const toNode = nodes.get(link.to.id);
			const lit = Boolean((fromNode?.completed || fromNode?.inProgress) && (toNode?.completed || toNode?.inProgress || toNode?.state === "available"));
			if (link.from.kind === "domain") {
				drawSkillRail(ctx, fx, fy, tx, ty, lit || style === "hextech", style === "hextech" ? palette.brassHl : CEL_RAMPS.volt.base, 2.4, palette);
			} else if (relativeZoom < 2.4) {
				const mx = (fx + tx) * 0.5;
				const my = (fy + ty) * 0.5 - Math.min(40, Math.hypot(tx - fx, ty - fy) * 0.14);
				branchPath.moveTo(fx, fy);
				branchPath.quadraticCurveTo(mx, my, tx, ty);
				hasBranch = true;
			}
		}
		if (hasBranch) {
			ctx.strokeStyle = style === "hextech" ? palette.brassShade + "88" : palette.overviewBranch;
			ctx.lineWidth = style === "hextech" ? 2.2 : 1.15;
			ctx.setLineDash(style === "hextech" ? [] : [5, 5]);
			ctx.stroke(branchPath);
			ctx.setLineDash([]);
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

	// ── 3. Ambient Edges (world-bounds culled) ───────────────────────────────
	const drawAmbientEdges = (kind: SkillEdge["kind"]) => {
		if (style === "citadel" && kind !== "prerequisite") return;
		const list = layout.edgesByKind[kind];
		if (!list.length) return;
		const isPre = kind === "prerequisite";
		const maxCrossLen = Math.min(width, height) * (kind === "related" ? 0.35 : 0.72);
		const completedPath = new Path2D();
		const pendingPath = new Path2D();
		let hasCompleted = false;
		let hasPending = false;

		for (let i = 0; i < list.length; i++) {
			const edge = list[i]!;
			if (style === "clarity" && edge.crossesRegion) continue;
			if (style === "citadel" && !edge.crossesRegion) continue;
			if (edge.crossesRegion && relativeZoom < 2.2 && style !== "citadel") continue;
			if ((style === "constellation" || style === "hextech") && kind === "hierarchy" && edge.from.kind === "unit" && relativeZoom < 1.15) continue;

			// Fast world-space AABB rejection before screen transform
			const eFrom = edge.from;
			const eTo = edge.to;
			if (
				(eFrom.x < wMinX && eTo.x < wMinX) ||
				(eFrom.x > wMaxX && eTo.x > wMaxX) ||
				(eFrom.y < wMinY && eTo.y < wMinY) ||
				(eFrom.y > wMaxY && eTo.y > wMaxY)
			) {
				continue;
			}

			if (skipFocusEdges) {
				const rootEdge = eFrom.kind === "domain" || eTo.kind === "domain";
				const touchesActive =
					(!rootEdge || relativeZoom >= 1.5) &&
					(eFrom.id === selected || eTo.id === selected || eFrom.id === hovered || eTo.id === hovered);
				if (touchesActive) continue;
			}

			const fx = pxOf(eFrom);
			const fy = pyOf(eFrom);
			const tx0 = pxOf(eTo);
			const ty0 = pyOf(eTo);
			if (Math.max(fx, tx0) < -16 || Math.max(fy, ty0) < -16 || Math.min(fx, tx0) > width + 16 || Math.min(fy, ty0) > height + 16) continue;

			const dx = tx0 - fx;
			const dy = ty0 - fy;
			const length = Math.hypot(dx, dy);
			if (edge.crossesRegion && length > maxCrossLen && style !== "citadel") continue;
			const sourceGap = dotRadius(eFrom, zoom);
			const targetGap = dotRadius(eTo, zoom) + 1.5;
			if (length < sourceGap + targetGap + 3) continue;

			const fromNode = nodes.get(eFrom.id);
			const toNode = nodes.get(eTo.id);
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
	};

	if (style !== "citadel") {
		drawAmbientEdges("hierarchy");
		drawAmbientEdges("related");
		drawAmbientEdges("prerequisite");
		ctx.setLineDash([]);
	}

	// ── 4. Nodes ─────────────────────────────────────────────────────────────
	let visibleCount = 0;

	if (style === "citadel") {
		// Pre-sorted pointsSortedByY eliminates O(N log N) sort & 1,010 wrapper allocations per frame!
		const baseHexR = layout.hexTileRadius * 0.92 * zoom;
		// During static bitmap bake, draw crisp 3D prisms down to r >= 3.2; during live interactive frames batch below 5.2
		const lowDetailBatch = baseHexR < (isBake ? 3.2 : 5.2);
		const pendingTopPath = lowDetailBatch ? new Path2D() : null;
		const pendingShadowPath = lowDetailBatch ? new Path2D() : null;
		let hasBatchedPending = false;

		for (let i = 0; i < layout.pointsSortedByY.length; i++) {
			const point = layout.pointsSortedByY[i]!;
			if (point.x < wMinX || point.x > wMaxX || point.y < wMinY || point.y > wMaxY) continue;
			const sx = pxOf(point);
			const sy = pyOf(point);
			if (sx < -36 || sy < -44 || sx > width + 36 || sy > height + 36) continue;
			if (sx >= 0 && sy >= 0 && sx <= width && sy <= height) visibleCount++;
			const node = nodes.get(point.id)!;
			const isFocus = point.id === selected || point.id === hovered;
			const isCurrent = point.id === current;
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

			// Fast LOD batching for tiny pending hexes when zoomed out (~800 draw calls → 2!)
			const isPlainPending =
				lowDetailBatch &&
				!isFocus &&
				!isCurrent &&
				!node.completed &&
				!node.inProgress &&
				!(node.leaf && node.state === "available") &&
				point.kind !== "domain" &&
				point.kind !== "area" &&
				point.kind !== "unit";
			if (isPlainPending && pendingTopPath && pendingShadowPath) {
				const extrude = Math.max(1.5, (point.z ?? 4) * 0.48 * Math.max(0.18, depth) * zoom);
				traceHexTopPath(pendingShadowPath, sx, sy + extrude, tileR);
				traceHexTopPath(pendingTopPath, sx, sy, tileR);
				hasBatchedPending = true;
				continue;
			}

			const { extrudeH, topC, leftC, rightC, inkC } = resolveCitadelHexStyle(point, node, isCurrent, depth, zoom, palette);
			drawHexPrism(ctx, sx, sy, tileR, extrudeH, topC, leftC, rightC, inkC, isFocus);

			if (tileR >= 9) {
				if (node.completed) drawCheckGlyph(ctx, sx, sy, tileR * 0.56, dark ? "#07070b" : "#ffffff");
				else if (node.leaf && node.state === "available" && !node.inProgress) drawPlayGlyph(ctx, sx, sy, tileR * 0.48, dark ? "#07070b" : "#ffffff");
			}
		}

		if (hasBatchedPending && pendingTopPath && pendingShadowPath) {
			ctx.fillStyle = palette.metalShade;
			ctx.fill(pendingShadowPath);
			ctx.fillStyle = colors.surface;
			ctx.fill(pendingTopPath);
			ctx.strokeStyle = palette.pendingDotStroke;
			ctx.lineWidth = 0.7;
			ctx.stroke(pendingTopPath);
		}

		drawAmbientEdges("prerequisite");
		ctx.setLineDash([]);
	} else {
		const isGameTree = style === "constellation" || style === "hextech";
		const foregroundPoints: { point: SkillPoint; sx: number; sy: number; node: SkillNode }[] = [];
		const pendingDotPath = new Path2D();
		let hasPendingDots = false;
		const lockGlyphs: { x: number; y: number; r: number }[] = [];
		const pendingLandmarks: { point: SkillPoint; sx: number; sy: number; radius: number; node: SkillNode }[] = [];
		const closePending = relativeZoom >= (style === "clarity" ? 1.95 : 2.5);
		const dotScale = relativeZoom < 1.8 ? 0.86 : 0.94;

		const visitPoint = (point: SkillPoint) => {
			if (point.x < wMinX || point.x > wMaxX || point.y < wMinY || point.y > wMaxY) return;
			const sx = pxOf(point);
			const sy = pyOf(point);
			if (sx < -28 || sy < -28 || sx > width + 28 || sy > height + 28) return;
			if (sx >= 0 && sy >= 0 && sx <= width && sy <= height) visibleCount++;
			const node = nodes.get(point.id)!;
			const active = point.id === selected || point.id === hovered || point.id === current;
			const highlight = active || node.completed || node.inProgress || (node.leaf && node.state === "available");
			if (highlight) {
				foregroundPoints.push({ point, sx, sy, node });
				return;
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
		};

		// Use spatial grid viewport query when zoomed in deeply so offscreen 95% isn't scanned!
		const { cellSize, cells } = layout.spatialGrid;
		const minCx = Math.floor(wMinX / cellSize);
		const maxCx = Math.floor(wMaxX / cellSize);
		const minCy = Math.floor(wMinY / cellSize);
		const maxCy = Math.floor(wMaxY / cellSize);
		const cellCount = (maxCx - minCx + 1) * (maxCy - minCy + 1);
		if (cellCount > 0 && cellCount < layout.points.size * 0.45) {
			for (let cx = minCx; cx <= maxCx; cx++) {
				for (let cy = minCy; cy <= maxCy; cy++) {
					const ids = cells.get(`${cx},${cy}`);
					if (!ids) continue;
					for (let k = 0; k < ids.length; k++) {
						const pt = layout.points.get(ids[k]!);
						if (pt) visitPoint(pt);
					}
				}
			}
		} else {
			for (const point of layout.points.values()) visitPoint(point);
		}

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

		if (isGameTree) {
			for (const { point, sx, sy, radius, node } of pendingLandmarks) {
				const ramp = AREA_RAMPS[point.color % rampLen]!;
				const zStat = zoneStats.get(point.id);
				const frac = zStat && zStat.total > 0 ? zStat.completed / zStat.total : 0;
				if (point.kind === "domain" || point.kind === "area") {
					drawKeystoneSocket(ctx, sx, sy, Math.max(6.5, radius * 1.15), ramp, frac, palette, false, point.kind === "domain");
				} else {
					drawNotableSocket(ctx, sx, sy, Math.max(4.8, radius * 1.05), node, ramp, frac, palette, false);
				}
			}
		} else {
			drawBatchedPendingDiamonds(ctx, pendingLandmarks, palette, rampLen);
		}

		for (const { point, sx, sy, node } of foregroundPoints) {
			drawForegroundNode(ctx, point, sx, sy, node, zoom, relativeZoom, style, selected, hovered, current, zoneStats, palette);
		}
	}

	return visibleCount;
}

function drawForegroundNode(
	ctx: CanvasRenderingContext2D,
	point: SkillPoint,
	sx: number,
	sy: number,
	node: SkillNode,
	zoom: number,
	relativeZoom: number,
	style: SkillLayout["style"],
	selected: string | undefined,
	hovered: string | undefined,
	current: string | undefined,
	zoneStats: ZoneStats,
	palette: AtlasPalette,
) {
	const { colors, dark, completedColor, inProgressColor, ink } = palette;
	const rampLen = AREA_RAMPS.length;
	const isGameTree = style === "constellation" || style === "hextech";
	const baseRadius = dotRadius(point, zoom);
	const isSelected = point.id === selected;
	const isHovered = point.id === hovered;
	const active = isSelected || isHovered;
	const ramp = AREA_RAMPS[point.color % rampLen]!;
	const zStat = zoneStats.get(point.id);
	const frac = zStat && zStat.total > 0 ? zStat.completed / zStat.total : 0;

	if (isGameTree && (point.kind === "domain" || point.kind === "area")) {
		drawKeystoneSocket(ctx, sx, sy, Math.max(7, baseRadius * 1.18), ramp, frac, palette, active, point.kind === "domain");
		return;
	}
	if (isGameTree && point.kind === "unit") {
		drawNotableSocket(ctx, sx, sy, Math.max(5.4, baseRadius * 1.08), node, ramp, frac, palette, active);
		return;
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
	else if (node.state === "available") ctx.fillStyle = colors.surface;
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

/** Pre-renders the entire static architectural backdrop + ambient edges + base nodes ONCE into an offscreen GPU bitmap. */
export function buildStaticLayerCache(
	layout: SkillLayout,
	nodes: Map<string, SkillNode>,
	zoneStats: ZoneStats,
	palette: AtlasPalette,
	depth: number,
	ratio = 1,
): StaticLayerCache | null {
	if (typeof document === "undefined") return null;
	const is25D = layout.style === "constellation" || layout.style === "hextech" || layout.style === "citadel";
	const padLeft = 48;
	const padRight = 48;
	const padTop = is25D ? 72 : 48;
	const padBottom = 48;
	const worldW = layout.width + padLeft + padRight;
	const worldH = layout.height + padTop + padBottom;
	const bakeRatio = Math.max(1, Math.min(2, ratio));

	// Cap total backing pixels (~20 MB max) and max dimension (3600px) so GPU upload stays instant on every style
	const MAX_PIXELS = 5_200_000;
	const MAX_DIM = 3600;
	const scale = Math.max(
		0.32,
		Math.min(1.4 * bakeRatio, Math.sqrt(MAX_PIXELS / Math.max(1, worldW * worldH)), MAX_DIM / Math.max(worldW, worldH)),
	);
	const pxW = Math.max(1, Math.round(worldW * scale));
	const pxH = Math.max(1, Math.round(worldH * scale));
	const canvas = document.createElement("canvas");
	canvas.width = pxW;
	canvas.height = pxH;
	const sctx = canvas.getContext("2d");
	if (!sctx) return null;

	// Bake in Retina CSS-pixel coordinates so dot radii, line widths, and shadows match live vector rendering 1:1
	const bakeZoom = scale / bakeRatio;
	const logicalW = pxW / bakeRatio;
	const logicalH = pxH / bakeRatio;
	sctx.setTransform(bakeRatio, 0, 0, bakeRatio, 0, 0);

	const originX = -padLeft;
	const originY = -padTop;
	drawStaticBackdropAndNodes(
		sctx,
		layout,
		nodes,
		zoneStats,
		logicalW,
		logicalH,
		-originX * bakeZoom,
		-originY * bakeZoom,
		bakeZoom,
		1.35, // balanced overview-to-mid LOD baked into static layer
		depth,
		palette,
		undefined,
		undefined,
		undefined,
		false,
		true,
	);

	return {
		canvas,
		scale,
		ratio: bakeRatio,
		originX,
		originY,
		worldW,
		worldH,
		depthKey: is25D ? Math.round(depth * 20) : 0,
	};
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
	getStaticLayer,
	isInteracting = false,
	isDraggingDepth = false,
}: DrawSkillMapArgs): number {
	const { width, height, ratio } = view;
	const { zoom, x: camX, y: camY } = camera;
	const { colors, dark, completedColor, beacon } = palette;
	const style = layout.style;
	const fit = fitZoom(layout, view);
	const relativeZoom = zoom / fit;
	const focusId = hovered ?? selected;
	const rampLen = AREA_RAMPS.length;
	const is25D = style === "constellation" || style === "hextech" || style === "citadel";
	const zLiftScale = is25D ? depth * 0.55 : 0;

	const pxOf = (pt: SkillPoint) => camX + pt.x * zoom;
	const pyOf = (pt: SkillPoint) => camY + (zLiftScale ? pt.y - (pt.z ?? 0) * zLiftScale : pt.y) * zoom;

	ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
	ctx.clearRect(0, 0, width, height);

	// Decide between GPU single-blit static cache vs crisp frustum-culled vector pass
	const staticLayer = !isDraggingDepth && getStaticLayer ? getStaticLayer() : null;
	const neededScale = zoom * ratio;
	const useStaticBlit = Boolean(
		staticLayer &&
			(neededScale <= staticLayer.scale * 1.45 || (isInteracting && neededScale <= staticLayer.scale * 2.6)),
	);

	let visibleCount = 0;

	if (useStaticBlit && staticLayer) {
		// 1 single GPU drawImage blits the entire 1,010-node tree backdrop + edges + static nodes in < 0.3 ms!
		ctx.drawImage(
			staticLayer.canvas,
			camX + staticLayer.originX * zoom,
			camY + staticLayer.originY * zoom,
			staticLayer.worldW * zoom,
			staticLayer.worldH * zoom,
		);
		// Count visible nodes fast only when settled (not needed during active pan/zoom frames)
		if (!isInteracting) {
			const wMinX = -camX / zoom;
			const wMaxX = (width - camX) / zoom;
			const wMinY = -camY / zoom;
			const wMaxY = (height - camY) / zoom + (is25D ? 60 * depth : 0);
			for (const pt of layout.points.values()) {
				if (pt.x < wMinX || pt.x > wMaxX || pt.y < wMinY || pt.y > wMaxY) continue;
				const sx = pxOf(pt);
				const sy = pyOf(pt);
				if (sx >= 0 && sy >= 0 && sx <= width && sy <= height) visibleCount++;
			}
		}
	} else {
		visibleCount = drawStaticBackdropAndNodes(
			ctx,
			layout,
			nodes,
			zoneStats,
			width,
			height,
			camX,
			camY,
			zoom,
			relativeZoom,
			depth,
			palette,
			selected,
			hovered,
			current,
			true,
		);
	}

	// ── Crisp screen-space zone headers (clarity swimlanes & atlas unit titles) ─
	if (style === "clarity") {
		const laneTitleFont = `700 ${relativeZoom >= 1.5 ? 13 : 12}px ${fontFamily}`;
		const laneMetaFont = `600 10.5px ${fontFamily}`;
		const unitHeaderFont = `700 ${relativeZoom >= 1.8 ? 12 : 11}px ${fontFamily}`;

		for (const lane of layout.lanes) {
			const x = camX + lane.x * zoom;
			const y = camY + lane.y * zoom;
			const w = lane.width * zoom;
			const h = lane.height * zoom;
			if (x > width || y > height || x + w < 0 || y + h < 0) continue;
			const headW = Math.min(w * 0.45, lane.headerWidth * zoom);
			if (headW < 70) continue;
			const areaNode = nodes.get(lane.areaId);
			if (!areaNode) continue;
			const colorIdx = lane.color % rampLen;
			const tint = palette.areaTints[colorIdx]!;
			const zStat = zoneStats.get(lane.areaId);
			const frac = zStat && zStat.total > 0 ? zStat.completed / zStat.total : 0;
			const done = frac >= 1;

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

		if (relativeZoom >= 1.1) {
			ctx.font = unitHeaderFont;
			ctx.textAlign = "left";
			ctx.textBaseline = "top";
			for (const zone of layout.zones) {
				if (zone.heading !== "unit") continue;
				const x = camX + zone.x * zoom;
				const y = camY + zone.y * zoom;
				const w = zone.width * zoom;
				const h = zone.height * zoom;
				if (w < 86 || h < 36 || x > width || y > height || x + w < 0 || y + h < 0) continue;
				const unitNode = nodes.get(zone.id);
				if (!unitNode) continue;
				const colorIdx = zone.color % rampLen;
				const zStat = zoneStats.get(zone.id);
				const frac = zStat && zStat.total > 0 ? zStat.completed / zStat.total : 0;
				const done = frac >= 1;
				const countText = zStat && zStat.total > 0 ? `${zStat.completed}/${zStat.total}` : "";
				const countW = countText ? textCache.measureWidth(ctx, unitHeaderFont, countText) + 10 : 0;
				const leftInset = Math.max(12, 26 * Math.min(1.2, zoom));
				const maxTitleW = Math.max(24, w - leftInset - 10 - countW);
				const title = textCache.truncate(ctx, unitHeaderFont, unitNode.title, maxTitleW);
				ctx.font = unitHeaderFont;
				ctx.fillStyle = done ? completedColor : palette.areaTints[colorIdx]!;
				ctx.fillText(title, x + leftInset, y + 8);
				if (countText) {
					ctx.fillStyle = frac > 0 ? completedColor : colors.textMuted;
					ctx.fillText(countText, x + w - countW + 2, y + 8);
				}
			}
		}
	} else if (style === "atlas") {
		const badgeFont = `700 ${relativeZoom >= 1.8 ? 11 : 10}px ${fontFamily}`;
		const unitTitleFont = `600 11px ${fontFamily}`;
		const showUnitTitles = relativeZoom >= 1.65;
		for (const zone of layout.zones) {
			const x = camX + zone.x * zoom;
			const y = camY + zone.y * zoom;
			const w = zone.width * zoom;
			const h = zone.height * zoom;
			if (x > width || y > height || x + w < 0 || y + h < 0) continue;
			const colorIdx = zone.color % rampLen;
			const zStat = zoneStats.get(zone.id);
			const fraction = zStat && zStat.total > 0 ? zStat.completed / zStat.total : 0;
			const hasProgress = fraction > 0;

			if (zone.heading === "area") {
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
						ctx.textAlign = "left";
						ctx.textBaseline = "middle";
						ctx.fillStyle = completedColor;
						ctx.fillText(badge, bx + 6, by + 9);
					}
				}
			} else if (showUnitTitles && w >= 92 && h >= 44) {
				const unitNode = nodes.get(zone.id);
				if (!unitNode) continue;
				const unitPt = layout.points.get(zone.id);
				const leftInset = unitPt ? Math.max(12, pxOf(unitPt) - x + dotRadius(unitPt, zoom) + 8) : 10;
				const countText = zStat && zStat.total > 0 ? `${zStat.completed}/${zStat.total}` : "";
				const countW = countText ? textCache.measureWidth(ctx, unitTitleFont, countText) + 10 : 0;
				const maxTitleW = Math.max(24, w - leftInset - 8 - countW);
				const title = textCache.truncate(ctx, unitTitleFont, unitNode.title, maxTitleW);
				ctx.font = unitTitleFont;
				ctx.textAlign = "left";
				ctx.textBaseline = "top";
				ctx.fillStyle = fraction >= 1 ? completedColor : palette.areaTints[colorIdx]!;
				ctx.fillText(title, x + leftInset, y + 6);
				if (countText) {
					ctx.fillStyle = hasProgress ? completedColor : colors.textMuted;
					ctx.fillText(countText, x + w - countW + 2, y + 6);
				}
			}
		}
	}

	// ── Prominent Edges for Selected / Hovered Node (O(1) incident lookup) ───
	const drawEdgePath = (fx: number, fy: number, tx0: number, ty0: number, sourceGap: number, targetGap: number, curved: boolean, arrow: boolean) => {
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
			const wing = 4.8;
			const bx = tx - vx * wing * 1.7;
			const by = ty - vy * wing * 1.7;
			ctx.moveTo(bx - vy * wing, by + vx * wing);
			ctx.lineTo(tx, ty);
			ctx.lineTo(bx + vy * wing, by - vx * wing);
		}
	};

	const buckets: { color: string; dash: number[]; width: number; list: SkillEdge[] }[] = [
		{ color: palette.hierProminent, dash: [], width: 1.7, list: [] },
		{ color: colors.textMuted, dash: [4, 4], width: 1.5, list: [] },
		{ color: palette.preInColor, dash: [], width: 2.4, list: [] },
		{ color: palette.preOutColor, dash: [], width: 2.4, list: [] },
	];
	const seenIncident = hovered && hovered !== selected ? new Set<SkillEdge>() : null;
	const pushIncident = (incident: SkillEdge[] | undefined) => {
		if (!incident) return;
		for (const edge of incident) {
			if (seenIncident) {
				if (seenIncident.has(edge)) continue;
				seenIncident.add(edge);
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
			drawEdgePath(fx, fy, tx0, ty0, dotRadius(edge.from, zoom) + 1.5, dotRadius(edge.to, zoom) + 3, isPre, isPre);
		}
		ctx.stroke();
	}
	ctx.setLineDash([]);

	// When using static blit, redraw crisp focus rings/nodes for ONLY selected & hovered (2 nodes!)
	if (useStaticBlit) {
		const focusIds = hovered && hovered !== selected ? [selected, hovered] : [selected];
		for (const fid of focusIds) {
			const pt = layout.points.get(fid);
			const node = pt ? nodes.get(fid) : undefined;
			if (!pt || !node) continue;
			const sx = pxOf(pt);
			const sy = pyOf(pt);
			if (sx < -36 || sy < -36 || sx > width + 36 || sy > height + 36) continue;
			if (style === "citadel") {
				const baseHexR = layout.hexTileRadius * 0.92 * zoom;
				const tileR = Math.max(
					2.4,
					pt.kind === "domain" ? baseHexR * 1.45 : pt.kind === "area" ? baseHexR * 1.18 : pt.kind === "unit" ? baseHexR * 1.05 : baseHexR * 0.94,
				);
				const { extrudeH, topC, leftC, rightC, inkC } = resolveCitadelHexStyle(pt, node, fid === current, depth, zoom, palette);
				drawHexPrism(ctx, sx, sy, tileR, extrudeH, topC, leftC, rightC, inkC, true);
				if (tileR >= 9) {
					if (node.completed) drawCheckGlyph(ctx, sx, sy, tileR * 0.56, dark ? "#07070b" : "#ffffff");
					else if (node.leaf && node.state === "available" && !node.inProgress) drawPlayGlyph(ctx, sx, sy, tileR * 0.48, dark ? "#07070b" : "#ffffff");
				}
			} else {
				drawForegroundNode(ctx, pt, sx, sy, node, zoom, relativeZoom, style, selected, hovered, current, zoneStats, palette);
			}
		}
	}

	// ── 5. Learner position beacon ───────────────────────────────────────────
	const position = current && layout.points.get(current);
	if (position) {
		const x = pxOf(position);
		const y = pyOf(position);
		if (x >= -24 && y >= -24 && x <= width + 24 && y <= height + 24) {
			if (style === "citadel") {
				const baseHexR = layout.hexTileRadius * 0.92 * zoom;
				const tileR = Math.max(4, baseHexR * 1.05);
				ctx.beginPath();
				ctx.ellipse(x, y - 4 * zoom, tileR * 1.32, tileR * 0.85, 0, 0, TAU);
				ctx.strokeStyle = beacon;
				ctx.lineWidth = 2.2;
				ctx.stroke();
			} else {
				const radius = Math.max(5.2, dotRadius(position, zoom));
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
			}
		}
	}

	// ── 6. Multi-LOD Collision-Free Labels (NEVER scans all 1,010 nodes!) ────
	const labels: { point: SkillPoint; sx: number; sy: number; priority: number; active: boolean }[] = [];
	const skillCardThreshold = style === "clarity" ? 1.85 : 3.0;
	const topicThreshold = style === "clarity" ? 1.45 : 2.1;
	const unitThreshold = style === "clarity" ? 1.05 : 1.45;
	const seenLabelIds = new Set<string>();

	const considerLabel = (point: SkillPoint) => {
		if (seenLabelIds.has(point.id)) return;
		const active = point.id === selected || point.id === hovered;
		const priority = point.id === current ? 6 : active ? 5 : point.kind === "domain" ? 4 : point.kind === "area" ? 3 : point.kind === "unit" ? 2 : 1;
		if (!active && style === "clarity" && (priority === 3 || (priority === 2 && relativeZoom >= 1.1))) return;
		if (!active && style === "atlas" && priority === 2 && relativeZoom >= 1.65) return;
		if (!active && ((priority === 1 && relativeZoom < (point.kind === "topic" ? topicThreshold : skillCardThreshold)) || (priority === 2 && relativeZoom < unitThreshold))) return;
		const sx = pxOf(point);
		const sy = pyOf(point);
		if (sx >= -36 && sy >= -36 && sx <= width + 36 && sy <= height + 36) {
			seenLabelIds.add(point.id);
			labels.push({ point, sx, sy, priority, active });
		}
	};

	// Always include priority points (current, selected, hovered)
	if (current) {
		const p = layout.points.get(current);
		if (p) considerLabel(p);
	}
	const selPt = layout.points.get(selected);
	if (selPt) considerLabel(selPt);
	if (hovered) {
		const hovPt = layout.points.get(hovered);
		if (hovPt) considerLabel(hovPt);
	}

	if (relativeZoom >= skillCardThreshold) {
		// Deep zoom: query ONLY visible spatial grid cells!
		const { cellSize, cells } = layout.spatialGrid;
		const minCx = Math.floor((-camX / zoom - 40 / zoom) / cellSize);
		const maxCx = Math.floor(((width - camX) / zoom + 40 / zoom) / cellSize);
		const minCy = Math.floor((-camY / zoom - 40 / zoom) / cellSize);
		const maxCy = Math.floor(((height - camY) / zoom + 40 / zoom + (is25D ? 60 * depth : 0)) / cellSize);
		for (let cx = minCx; cx <= maxCx; cx++) {
			for (let cy = minCy; cy <= maxCy; cy++) {
				const ids = cells.get(`${cx},${cy}`);
				if (!ids) continue;
				for (let k = 0; k < ids.length; k++) {
					const pt = layout.points.get(ids[k]!);
					if (pt) considerLabel(pt);
				}
			}
		}
	} else {
		// Overview / mid zoom: scan ONLY the ~200 landmarks (never the ~809 atoms!)
		for (let i = 0; i < layout.landmarks.length; i++) {
			considerLabel(layout.landmarks[i]!);
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
			for (let idx = 0; idx < lines.length; idx++) {
				ctx.fillText(lines[idx]!, cx, topY + 3.5 + lineH * (idx + 0.5));
			}
			ctx.textAlign = "left";
			continue;
		}

		const fontSize = priority >= 4 ? 13 : priority >= 3 ? 12 : 11.5;
		const fontWeight = priority >= 3 ? "700" : priority >= 2 ? "600" : "500";
		const font = `${fontWeight} ${fontSize}px ${fontFamily}`;
		const padX = pill ? 9 : 4;

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
			const b = { left: x - padX - 3, right: x + textWidth + padX + 3, top: topY - (pill ? 13 : 9), bottom: topY + (pill ? 13 : 9) };
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
			top: textY - (pill ? 13 : 9),
			bottom: textY + (pill ? 13 : 9),
		};
		if (!pill && occupied.some((b) => b.left < bounds.right && b.right > bounds.left && b.top < bounds.bottom && b.bottom > bounds.top)) continue;
		occupied.push(bounds);

		ctx.font = font;
		ctx.textAlign = "left";
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
			// Crisp surface chip instead of CPU-heavy ctx.strokeText() (8x faster in Skia + cleaner readability)
			ctx.fillStyle = palette.closeSkillFill;
			ctx.fillRect(x - 3, textY - 8, textWidth + 6, 16);
			ctx.fillStyle = priority === 3 ? palette.areaTints[point.color % rampLen]! : colors.text;
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
