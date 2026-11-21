"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useAppearance } from "@/components/settings/appearance";
import { Icon } from "@/components/icons/icon";
import { CEL_RAMPS, shiftHex, type ThemeColors, layoutSkillMap, type SkillEdge, type SkillLayout, type SkillMap, type SkillNode, type SkillPoint } from "@/src/core";

const AREA_RAMPS = Object.values(CEL_RAMPS);

const TAU = Math.PI * 2;
const TOP_GUTTER = 52;
const BOTTOM_GUTTER = 62;
const SIDE_GUTTER = 18;

type Pixel = { x: number; y: number };
type Viewport = { width: number; height: number; ratio: number };
type Camera = Pixel & { zoom: number };
type MapControls = { scale: (factor: number) => void; reset: () => void; reveal: (id: string, focus?: boolean) => void };

function tint(color: number, dark: boolean) {
	return AREA_RAMPS[color % AREA_RAMPS.length]![dark ? "lite" : "deep"];
}

function fitZoom(layout: SkillLayout, viewport: Viewport) {
	return Math.min(1, Math.max(1, viewport.width - SIDE_GUTTER * 2) / layout.width,
		Math.max(1, viewport.height - TOP_GUTTER - BOTTOM_GUTTER) / layout.height);
}

function dotRadius(point: SkillPoint, zoom: number) {
	return Math.max(point.kind === "atom" ? 1.65 : 2.5, Math.min(14, point.radius * zoom));
}

function drawAtlas(
	ctx: CanvasRenderingContext2D,
	layout: SkillLayout,
	nodes: Map<string, SkillNode>,
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
	const visible = (p: Pixel, margin = 18) => p.x >= -margin && p.y >= -margin && p.x <= width + margin && p.y <= height + margin;
	const focusId = hovered ?? selected;

	ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
	ctx.clearRect(0, 0, width, height);

	// 1. Area and unit zones tinted by their area ramp
	for (const zone of layout.zones) {
		const { x, y } = project(zone);
		const w = zone.width * zoom;
		const h = zone.height * zoom;
		if (x > width || y > height || x + w < 0 || y + h < 0) continue;
		const areaColor = tint(zone.color, dark);
		ctx.beginPath();
		if (zone.heading === "area") {
			ctx.roundRect(x, y, w, h, Math.min(20, w / 4, h / 4));
			ctx.fillStyle = areaColor + (dark ? "10" : "0d");
			ctx.fill();
			ctx.strokeStyle = areaColor + (dark ? "36" : "2c");
			ctx.lineWidth = 1.2;
			ctx.stroke();
		} else {
			ctx.roundRect(x, y, w, h, Math.min(12, w / 4, h / 4));
			ctx.fillStyle = areaColor + (dark ? "14" : "11");
			ctx.fill();
			if (relativeZoom >= 1.2) {
				ctx.strokeStyle = areaColor + (dark ? "2b" : "24");
				ctx.lineWidth = 0.85;
				ctx.stroke();
			}
		}
	}

	// 2. Overview prerequisite links between groups
	if (relativeZoom < 2.25) {
		ctx.beginPath();
		for (const link of layout.overviewLinks) {
			const from = project(link.from);
			const to = project(link.to);
			const dx = to.x - from.x;
			const dy = to.y - from.y;
			const length = Math.hypot(dx, dy);
			if (length < 12) continue;
			const ux = dx / length;
			const uy = dy / length;
			const bend = Math.min(30, length * 0.14);
			const tx = to.x - ux * (dotRadius(link.to, zoom) + 4);
			const ty = to.y - uy * (dotRadius(link.to, zoom) + 4);
			const controlX = tx - dx * 0.33 + uy * bend;
			const controlY = ty - dy * 0.33 - ux * bend;
			ctx.moveTo(from.x, from.y);
			ctx.bezierCurveTo(from.x + dx * 0.33 + uy * bend, from.y + dy * 0.33 - ux * bend, controlX, controlY, tx, ty);
			const tangent = Math.hypot(tx - controlX, ty - controlY);
			const vx = (tx - controlX) / tangent;
			const vy = (ty - controlY) / tangent;
			const wing = length > 32 ? 3.5 : 2.5;
			ctx.moveTo(tx - vx * wing * 1.5 - vy * wing, ty - vy * wing * 1.5 + vx * wing);
			ctx.lineTo(tx, ty);
			ctx.lineTo(tx - vx * wing * 1.5 + vy * wing, ty - vy * wing * 1.5 - vx * wing);
		}
		ctx.strokeStyle = shiftHex(colors.textMuted, 0) + (dark ? "6e" : "78");
		ctx.lineWidth = 1.3;
		ctx.stroke();
	}

	// 3. Detailed edges (ambient first, then prominent semantic edges)
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
			const bend = Math.min(22, length * 0.12);
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
			const wing = prominent ? 4.4 : 3;
			const bx = tx - vx * wing * 1.7;
			const by = ty - vy * wing * 1.7;
			ctx.moveTo(bx - vy * wing, by + vx * wing);
			ctx.lineTo(tx, ty);
			ctx.lineTo(bx + vy * wing, by - vx * wing);
		}
	}

	function drawAmbientEdges(kind: SkillEdge["kind"]) {
		const isPre = kind === "prerequisite";
		ctx.beginPath();
		ctx.strokeStyle = shiftHex(colors.border, 0) + (isPre ? "68" : "44");
		ctx.lineWidth = isPre ? 0.85 : 0.7;
		ctx.setLineDash(kind === "related" ? [3, 4] : []);
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
			drawEdgePath(from, to, dotRadius(edge.from, zoom), dotRadius(edge.to, zoom) + 1.5, isPre && edge.crossesRegion, isPre && relativeZoom >= 1.9, false);
		}
		ctx.stroke();
	}

	function drawProminentEdges() {
		const buckets: { color: string; dash: number[]; width: number; list: SkillEdge[] }[] = [
			{ color: hierProminent, dash: [], width: 1.5, list: [] },
			{ color: colors.textMuted, dash: [4, 4], width: 1.4, list: [] },
			{ color: preInColor, dash: [], width: 2, list: [] },
			{ color: preOutColor, dash: [], width: 2, list: [] },
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
				drawEdgePath(from, to, dotRadius(edge.from, zoom) + 1, dotRadius(edge.to, zoom) + 2.5, isPre, isPre, true);
			}
			ctx.stroke();
		}
	}

	for (const kind of ["hierarchy", "related", "prerequisite"] as const) drawAmbientEdges(kind);
	drawProminentEdges();
	ctx.setLineDash([]);

	// 4. Nodes
	let visibleCount = 0;
	for (const point of layout.points.values()) {
		const screen = project(point);
		if (!visible(screen)) continue;
		if (visible(screen, 0)) visibleCount++;
		const node = nodes.get(point.id)!;
		const radius = dotRadius(point, zoom);
		const isSelected = point.id === selected;
		const isHovered = point.id === hovered;
		const active = isSelected || isHovered;
		const areaColor = tint(point.color, dark);
		const nodeColor = node.completed ? areaColor : colors.textMuted;

		if (active || point.id === current) {
			ctx.beginPath();
			ctx.arc(screen.x, screen.y, radius + (isSelected ? 7.5 : 6), 0, TAU);
			ctx.fillStyle = colors.surface;
			ctx.fill();
			ctx.strokeStyle = isSelected ? colors.accent : colors.text;
			ctx.lineWidth = isSelected ? 2.2 : 1.5;
			ctx.stroke();
		}

		if (node.inProgress || node.completed) {
			ctx.beginPath();
			ctx.arc(screen.x, screen.y, radius + (relativeZoom < 1.6 ? 1.8 : 3), 0, TAU);
			ctx.fillStyle = node.completed ? areaColor + "34" : colors.surface;
			ctx.fill();
			ctx.strokeStyle = node.completed ? areaColor : colors.textMuted;
			ctx.lineWidth = 1.3;
			if (!node.completed) ctx.setLineDash([2.5, 2]);
			ctx.stroke();
			ctx.setLineDash([]);
		}

		ctx.beginPath();
		const landmark = point.kind === "domain" || point.kind === "area" || point.kind === "unit";
		if (landmark) {
			const r = radius * 1.05;
			ctx.moveTo(screen.x, screen.y - r);
			ctx.lineTo(screen.x + r, screen.y);
			ctx.lineTo(screen.x, screen.y + r);
			ctx.lineTo(screen.x - r, screen.y);
			ctx.closePath();
		} else {
			ctx.arc(screen.x, screen.y, radius, 0, TAU);
		}

		if (node.completed) {
			ctx.fillStyle = areaColor;
		} else if (landmark) {
			ctx.fillStyle = active ? areaColor : shiftHex(areaColor, dark ? -18 : 18) + "cc";
		} else if (node.state === "available" || active) {
			ctx.fillStyle = active ? colors.text : nodeColor;
		} else {
			ctx.fillStyle = shiftHex(colors.border, 0) + (dark ? "b8" : "96");
		}
		ctx.fill();

		// Subtle cel-shading specular highlight on larger completed or landmark nodes
		if ((node.completed || landmark) && radius >= 4.2) {
			ctx.beginPath();
			ctx.arc(screen.x - radius * 0.3, screen.y - radius * 0.3, Math.max(1, radius * 0.24), 0, TAU);
			ctx.fillStyle = "rgb(255 255 255 / 0.55)";
			ctx.fill();
		}

		if (landmark || active || node.state === "available" || node.completed) {
			ctx.beginPath();
			if (landmark) {
				const r = radius * 1.05;
				ctx.moveTo(screen.x, screen.y - r);
				ctx.lineTo(screen.x + r, screen.y);
				ctx.lineTo(screen.x, screen.y + r);
				ctx.lineTo(screen.x - r, screen.y);
				ctx.closePath();
			} else {
				ctx.arc(screen.x, screen.y, radius, 0, TAU);
			}
			ctx.strokeStyle = active ? colors.text : (dark ? "#07070b" : colors.text);
			ctx.lineWidth = active ? 1.5 : 1;
			ctx.stroke();
		}
	}

	// 5. Paint the learner position beacon last so crowded neighbors cannot cover it
	const position = current && layout.points.get(current);
	const beacon = dark ? CEL_RAMPS.teal.lite : CEL_RAMPS.teal.deep;
	if (position) {
		const { x, y } = project(position);
		if (visible({ x, y })) {
			const radius = Math.max(4.5, dotRadius(position, zoom));
			ctx.save();
			ctx.beginPath();
			ctx.arc(x, y, radius + 6.5, 0, TAU);
			ctx.fillStyle = beacon + "24";
			ctx.fill();
			ctx.strokeStyle = beacon;
			ctx.lineWidth = 1.8;
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

	// 6. Labels with collision avoidance and pill backdrop for high-priority labels
	const labels = [];
	for (const point of layout.points.values()) {
		const active = point.id === selected || point.id === hovered;
		const priority = point.id === current ? 6 : active ? 5 : point.kind === "domain" ? 4 : point.kind === "area" ? 3 : point.kind === "unit" ? 2 : 1;
		if (!active && ((priority === 1 && relativeZoom < (point.kind === "topic" ? 2.4 : 4.2)) || (priority === 2 && relativeZoom < 1.5))) continue;
		const screen = project(point);
		if (visible(screen, 4)) labels.push({ point, screen, priority, active });
	}
	labels.sort((a, b) => b.priority - a.priority);
	const occupied: { left: number; right: number; top: number; bottom: number }[] = [];
	const zoneById = new Map(layout.zones.map(zone => [zone.id, zone]));
	ctx.textBaseline = "middle";
	ctx.lineJoin = "round";

	for (const { point, screen, priority, active } of labels) {
		const isHeading = priority > 1 && point.kind !== "topic" && point.kind !== "atom";
		const fontSize = priority >= 4 ? 13 : priority >= 3 ? 12.5 : priority >= 2 ? 12 : 11.5;
		const fontWeight = priority >= 3 ? "700" : priority >= 2 ? "600" : "500";
		ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
		const node = nodes.get(point.id)!;
		const pill = point.id === current || active;
		const padX = pill ? 7 : 0;
		const x = Math.max(8, Math.min(screen.x + dotRadius(point, zoom) + 8, width - 72));
		const y = point.kind === "domain" && relativeZoom < 2.25
			? Math.max(18, screen.y - 14)
			: isHeading ? screen.y : Math.min(height - 16, screen.y + dotRadius(point, zoom) + 12);
		const zone = zoneById.get(point.id);
		const available = Math.min(width - x - padX - 8, zone && !pill ? project(zone).x + zone.width * zoom - x - 6 : 260);
		if (available < 28) continue;
		let label = point.id === current ? "Você está aqui · " + node.title : node.title;
		if (ctx.measureText(label).width > available) {
			const maxChars = Math.min(label.length, Math.ceil(available / 5));
			label = label.slice(0, maxChars);
			while (label.length > 1 && ctx.measureText(label + "…").width > available) label = label.slice(0, -1);
			label += "…";
		}
		const textWidth = ctx.measureText(label).width;
		let textY = y;
		const overlaps = (topY: number) => {
			const b = { left: x - padX - 3, right: x + textWidth + padX + 3, top: topY - (pill ? 12 : 8), bottom: topY + (pill ? 12 : 8) };
			return occupied.some(o => o.left < b.right && o.right > b.left && o.top < b.bottom && o.bottom > b.top);
		};
		if (pill && overlaps(textY)) {
			for (const dy of [-25, 25, -48, 48]) {
				const candidateY = Math.max(18, Math.min(height - 18, y + dy));
				if (!overlaps(candidateY)) { textY = candidateY; break; }
			}
		}
		const bounds = {
			left: x - padX - 3,
			right: x + textWidth + padX + 3,
			top: textY - (pill ? 12 : 8),
			bottom: textY + (pill ? 12 : 8),
		};
		if (!pill && occupied.some(b => b.left < bounds.right && b.right > bounds.left && b.top < bounds.bottom && b.bottom > bounds.top)) continue;
		occupied.push(bounds);

		if (pill) {
			const rx = x - padX;
			const ry = textY - 11;
			const rw = textWidth + padX * 2;
			const rh = 22;
			ctx.beginPath();
			ctx.roundRect(rx, ry, rw, rh, 999);
			ctx.fillStyle = colors.surface;
			ctx.fill();
			ctx.strokeStyle = point.id === current ? beacon : colors.accent;
			ctx.lineWidth = 1.5;
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
	const anchorId = map.position ?? map.next;

	useEffect(() => { pick.current = onPick; }, [onPick]);
	useEffect(() => {
		const surface = canvas.current;
		const ctx = surface?.getContext("2d");
		if (!surface || !ctx) return;
		const fontFamily = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
		let view: Viewport = { width: 0, height: 0, ratio: 1 };
		let frame = 0;
		let hovered: string | undefined;
		if (!camera.current || previousDomain.current !== map.domain) atOverview.current = true;
		const pointers = new Map<number, Pixel>();
		let down: Pixel | undefined;
		let dragged = false;
		previousDomain.current = map.domain;

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
					const visible = String(drawAtlas(ctx!, layout, nodes, view, camera.current, active.current, hovered, anchorId, colors, resolvedMode === "dark", fontFamily));
					if (surface!.dataset.visibleNodeCount !== visible) surface!.dataset.visibleNodeCount = visible;
					const mode = atOverview.current ? "overview" : "explore";
					if (surface!.dataset.cameraMode !== mode) surface!.dataset.cameraMode = mode;
					syncZoomLabel();
				}
			});
		}
		function overview() {
			const zoom = fitZoom(layout, view);
			camera.current = {
				x: (view.width - layout.width * zoom) / 2,
				y: TOP_GUTTER + (view.height - TOP_GUTTER - BOTTOM_GUTTER - layout.height * zoom) / 2,
				zoom,
			};
			atOverview.current = true;
			setZoomPct(100);
			redraw();
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
			if (atOverview.current) overview();
			else if (camera.current && lastView.width > 0) {
				camera.current.x += (view.width - lastView.width) / 2;
				camera.current.y += (view.height - lastView.height) / 2;
			}
			redraw();
		}
		function scaleAt(anchor: Pixel, factor: number) {
			const current = camera.current;
			if (!current) return;
			const fit = fitZoom(layout, view);
			const next = Math.max(fit * 0.7, Math.min(Math.max(3, fit * 8), current.zoom * factor));
			if (next === current.zoom) return;
			const change = next / current.zoom;
			camera.current = { x: anchor.x - (anchor.x - current.x) * change, y: anchor.y - (anchor.y - current.y) * change, zoom: next };
			atOverview.current = false;
			redraw();
		}
		function move(dx: number, dy: number) {
			if (!camera.current) return;
			camera.current.x += dx;
			camera.current.y += dy;
			atOverview.current = false;
			redraw();
		}
		function scale(factor: number) {
			scaleAt({ x: view.width / 2, y: view.height / 2 }, factor);
		}
		controls.current = {
			reset: overview,
			scale,
			reveal(id, focus) {
				const point = layout.points.get(id);
				const current = camera.current;
				if (point && current && focus) {
					const zoom = Math.max(current.zoom, fitZoom(layout, view) * 4);
					camera.current = { x: view.width / 2 - point.x * zoom, y: view.height / 2 - point.y * zoom, zoom };
					atOverview.current = false;
				} else if (point && current && !atOverview.current) {
					const x = current.x + point.x * current.zoom;
					const y = current.y + point.y * current.zoom;
					if (x < 12 || x > view.width - 12 || y < 12 || y > view.height - 12) {
						move(view.width / 2 - x, view.height / 2 - y);
					}
				}
				redraw();
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
		function pointerDown(event: PointerEvent) {
			if (event.button !== 0) return;
			const point = location(event);
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
			const previous = pointers.get(event.pointerId);
			if (!previous) {
				if (event.pointerType !== "mouse" || pointers.size) return;
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
			if (!pointers.delete(event.pointerId)) return;
			if (pointers.size) return;
			if (event.type === "pointerup" && !dragged) {
				const target = hit(location(event), event.pointerType === "touch");
				if (target) pick.current(target);
			}
			down = undefined;
			surface!.style.cursor = hovered ? "pointer" : "grab";
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
				case "Home": case "0": overview(); break;
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
			surface.removeEventListener("keydown", keyboard);
			cancelAnimationFrame(frame);
			controls.current = null;
		};
	}, [layout, nodes, map.domain, anchorId, colors, resolvedMode]);

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
				<p id={hintId} className="text-muted-foreground tabular-nums">{layout.points.size} nós · Arraste ou use as setas · Zoom com + e −</p>
				<div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1">
					<span className="inline-flex items-center gap-1.5">
						<span aria-hidden="true" className="size-2.5 rounded-full bg-[var(--c-teal,#2ec4b6)] ring-2 ring-[var(--c-teal,#2ec4b6)]/35" />
						Você está aqui
					</span>
					<span className="inline-flex items-center gap-1.5">
						<span aria-hidden="true" className="size-2.5 rounded-full border border-foreground/70 bg-muted-foreground" />
						Disponível
					</span>
					<span className="inline-flex items-center gap-1.5">
						<span aria-hidden="true" className="size-2.5 rounded-full border border-dashed border-muted-foreground bg-card" />
						Em andamento
					</span>
					<span className="inline-flex items-center gap-1.5">
						<span aria-hidden="true" className="size-2.5 rounded-full border border-foreground/60 bg-[var(--cel-success,var(--lh-success))]" />
						Concluído
					</span>
				</div>
			</div>
		</div>
	);
}
