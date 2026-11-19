"use client";

import { useEffect, useId, useMemo, useRef } from "react";
import { layoutSkillMap, type SkillEdge, type SkillLayout, type SkillMap, type SkillNode, type SkillPoint } from "@/src/core";

const PALETTE = ["#88639b", "#327c72", "#a05548", "#426d90", "#817023", "#a35379", "#5e7639", "#6c65a5"];
const INK = "#2e293e";
const TAU = Math.PI * 2;
const TOP_GUTTER = 48;
const BOTTOM_GUTTER = 54;
const SIDE_GUTTER = 16;

type Pixel = { x: number; y: number };
type Viewport = { width: number; height: number; ratio: number };
type Camera = Pixel & { zoom: number };
type MapControls = { scale: (factor: number) => void; reset: () => void; reveal: (id: string) => void };

function tint(color: number) {
	return PALETTE[color % PALETTE.length]!;
}

function fitZoom(layout: SkillLayout, viewport: Viewport) {
	return Math.min(1, Math.max(1, viewport.width - SIDE_GUTTER * 2) / layout.width,
		Math.max(1, viewport.height - TOP_GUTTER - BOTTOM_GUTTER) / layout.height);
}

function dotRadius(point: SkillPoint, zoom: number) {
	return Math.max(point.kind === "atom" ? 1.35 : 2.2, Math.min(14, point.radius * zoom));
}

function drawAtlas(
	ctx: CanvasRenderingContext2D,
	layout: SkillLayout,
	nodes: Map<string, SkillNode>,
	view: Viewport,
	camera: Camera,
	selected: string,
	hovered: string | undefined,
) {
	const { width, height, ratio } = view;
	const { zoom } = camera;
	const relativeZoom = zoom / fitZoom(layout, view);
	const project = (point: Pixel): Pixel => ({ x: camera.x + point.x * zoom, y: camera.y + point.y * zoom });
	const visible = (p: Pixel, margin = 18) => p.x >= -margin && p.y >= -margin && p.x <= width + margin && p.y <= height + margin;

	ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
	ctx.clearRect(0, 0, width, height);
	for (const zone of layout.zones) {
		const { x, y } = project(zone);
		const w = zone.width * zoom;
		const h = zone.height * zoom;
		if (x > width || y > height || x + w < 0 || y + h < 0) continue;
		const color = tint(zone.color);
		ctx.beginPath();
		if (zone.heading === "area") {
			ctx.roundRect(x, y, w, h, Math.min(24, w / 4, h / 4));
			ctx.fillStyle = color + "0c";
			ctx.fill();
		} else {
			ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2.4, 0, TAU);
			ctx.fillStyle = color + "13";
			ctx.fill();
		}
	}

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
			const bend = Math.min(30, length * 0.13);
			const tx = to.x - ux * (dotRadius(link.to, zoom) + 4);
			const ty = to.y - uy * (dotRadius(link.to, zoom) + 4);
			const controlX = tx - dx * 0.33 + uy * bend;
			const controlY = ty - dy * 0.33 - ux * bend;
			ctx.moveTo(from.x, from.y);
			ctx.bezierCurveTo(from.x + dx * 0.33 + uy * bend, from.y + dy * 0.33 - ux * bend, controlX, controlY, tx, ty);
			const tangent = Math.hypot(tx - controlX, ty - controlY);
			const vx = (tx - controlX) / tangent;
			const vy = (ty - controlY) / tangent;
			const wing = length > 32 ? 3.25 : 2.25;
			ctx.moveTo(tx - vx * wing * 1.5 - vy * wing, ty - vy * wing * 1.5 + vx * wing);
			ctx.lineTo(tx, ty);
			ctx.lineTo(tx - vx * wing * 1.5 + vy * wing, ty - vy * wing * 1.5 - vx * wing);
		}
		ctx.strokeStyle = "#684e827f";
		ctx.lineWidth = 1.35;
		ctx.stroke();
	}

	function drawEdges(kind: SkillEdge["kind"], prominent: boolean) {
		const isPre = kind === "prerequisite";
		ctx.beginPath();
		ctx.strokeStyle = isPre ? (prominent ? "#694c7a" : "#795a8d50") : kind === "related" ? (prominent ? "#477585" : "#4775853c") : (prominent ? "#797283" : "#79728340");
		ctx.lineWidth = prominent ? 1.65 : 0.75;
		ctx.setLineDash(kind === "related" ? [3, 4] : []);
		for (const edge of layout.edges) {
			if (kind !== edge.kind) continue;
			const rootEdge = edge.from.kind === "domain" || edge.to.kind === "domain";
			const touchesActive = (!rootEdge || relativeZoom >= 1.5) && (edge.from.id === selected || edge.to.id === selected || edge.from.id === hovered || edge.to.id === hovered);
			if (touchesActive !== prominent) continue;
			if (!prominent && edge.crossesRegion && relativeZoom < 2.25) continue;
			const from = project(edge.from);
			const to = project(edge.to);
			if (Math.max(from.x, to.x) < -12 || Math.max(from.y, to.y) < -12 || Math.min(from.x, to.x) > width + 12 || Math.min(from.y, to.y) > height + 12) continue;
			const length = Math.hypot(to.x - from.x, to.y - from.y);
			if (!prominent && edge.crossesRegion && length > Math.min(width, height) * (kind === "related" ? 0.35 : 0.75)) continue;
			const ux = (to.x - from.x) / length;
			const uy = (to.y - from.y) / length;
			const targetGap = dotRadius(edge.to, zoom) + 1;
			const sourceGap = dotRadius(edge.from, zoom);
			if (length < sourceGap + targetGap + 3) continue;
			const tx = to.x - ux * targetGap;
			const ty = to.y - uy * targetGap;
			ctx.moveTo(from.x + ux * sourceGap, from.y + uy * sourceGap);
			ctx.lineTo(tx, ty);
			if (isPre && (prominent || relativeZoom >= 1.9) && length >= 15) {
				const wing = prominent ? 4 : 3;
				const bx = tx - ux * wing * 1.7;
				const by = ty - uy * wing * 1.7;
				ctx.moveTo(bx - uy * wing, by + ux * wing);
				ctx.lineTo(tx, ty);
				ctx.lineTo(bx + uy * wing, by - ux * wing);
			}
		}
		ctx.stroke();
	}

	for (const prominent of [false, true]) {
		for (const kind of ["hierarchy", "related", "prerequisite"] as const) drawEdges(kind, prominent);
	}
	ctx.setLineDash([]);

	let visibleCount = 0;
	for (const point of layout.points.values()) {
		const screen = project(point);
		if (!visible(screen)) continue;
		if (visible(screen, 0)) visibleCount++;
		const node = nodes.get(point.id)!;
		const radius = dotRadius(point, zoom);
		const active = point.id === selected || point.id === hovered;
		const color = tint(point.color);
		if (active) {
			ctx.beginPath();
			ctx.arc(screen.x, screen.y, radius + 6.5, 0, TAU);
			ctx.fillStyle = "#fae394";
			ctx.fill();
			ctx.strokeStyle = INK;
			ctx.lineWidth = 1.5;
			ctx.stroke();
		}
		if (node.inProgress || node.completed) {
			ctx.beginPath();
			ctx.arc(screen.x, screen.y, radius + 2.8, 0, TAU);
			ctx.fillStyle = node.completed ? "#247e5a40" : "#f4cc8d";
			ctx.fill();
			ctx.strokeStyle = node.completed ? "#247e5a" : "#8c510d";
			ctx.lineWidth = 1.2;
			if (!node.completed) ctx.setLineDash([2, 1.8]);
			ctx.stroke();
			ctx.setLineDash([]);
		}
		ctx.beginPath();
		const landmark = point.kind === "domain" || point.kind === "area" || point.kind === "unit";
		if (landmark) {
			ctx.moveTo(screen.x, screen.y - radius);
			ctx.lineTo(screen.x + radius, screen.y);
			ctx.lineTo(screen.x, screen.y + radius);
			ctx.lineTo(screen.x - radius, screen.y);
			ctx.closePath();
		} else {
			ctx.arc(screen.x, screen.y, radius, 0, TAU);
		}
		ctx.fillStyle = node.completed ? "#247e5a" : node.inProgress ? "#b6701b" : active ? "#f6bf52" : landmark || node.state === "available" ? color : color + "cc";
		ctx.fill();
		if (landmark || active) {
			ctx.strokeStyle = INK;
			ctx.lineWidth = 1;
			ctx.stroke();
		}
	}

	const labels = [];
	for (const point of layout.points.values()) {
		const active = point.id === selected || point.id === hovered;
		const priority = active ? 5 : point.kind === "domain" ? 4 : point.kind === "area" ? 3 : point.kind === "unit" ? 2 : 1;
		if (!active && ((priority === 1 && relativeZoom < (point.kind === "topic" ? 2.6 : 4.6)) || (priority === 2 && relativeZoom < 1.6))) continue;
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
		ctx.font = `${priority >= 3 ? "700 13" : priority >= 2 ? "650 12" : "500 11"}px sans-serif`;
		const node = nodes.get(point.id)!;
		const x = Math.max(4, Math.min(screen.x + dotRadius(point, zoom) + 6, width - 55));
		const y = point.kind === "domain" && relativeZoom < 2.25
			? Math.max(12, screen.y - 11)
			: isHeading ? screen.y : Math.min(height - 13, screen.y + dotRadius(point, zoom) + 11);
		const zone = zoneById.get(point.id);
		const available = Math.min(width - x - 4, zone && !active ? project(zone).x + zone.width * zoom - x - 5 : 250);
		if (available < 24) continue;
		let label = node.title;
		if (ctx.measureText(label).width > available) {
			const maxChars = Math.min(label.length, Math.ceil(available / 5));
			label = label.slice(0, maxChars);
			while (label.length > 1 && ctx.measureText(label + "…").width > available) label = label.slice(0, -1);
			label += "…";
		}
		const bounds = { left: x - 3, right: x + ctx.measureText(label).width + 3, top: y - 8, bottom: y + 8 };
		if (occupied.some(b => b.left < bounds.right && b.right > bounds.left && b.top < bounds.bottom && b.bottom > bounds.top)) continue;
		occupied.push(bounds);
		ctx.lineWidth = 3;
		ctx.strokeStyle = "#fbf5e6";
		ctx.fillStyle = INK;
		ctx.strokeText(label, x, y);
		ctx.fillText(label, x, y);
	}
	return visibleCount;
}

export function SkillCanvas({ map, selected, onPick }: { map: SkillMap; selected: string; onPick: (id: string) => void }) {
	const canvas = useRef<HTMLCanvasElement>(null);
	const controls = useRef<MapControls>(null);
	const camera = useRef<Camera | undefined>(undefined);
	const atOverview = useRef(true);
	const previousDomain = useRef("");
	const active = useRef(selected);
	const pick = useRef(onPick);
	const hintId = useId();
	const layout = useMemo(() => layoutSkillMap(map.nodes), [map.nodes]);
	const nodes = useMemo(() => new Map(map.nodes.map(node => [node.id, node])), [map.nodes]);

	useEffect(() => { pick.current = onPick; }, [onPick]);
	useEffect(() => {
		const surface = canvas.current;
		const ctx = surface?.getContext("2d");
		if (!surface || !ctx) return;
		let view: Viewport = { width: 0, height: 0, ratio: 1 };
		let frame = 0;
		let hovered: string | undefined;
		if (!camera.current || previousDomain.current !== map.domain) atOverview.current = true;
		const pointers = new Map<number, Pixel>();
		let down: Pixel | undefined;
		let dragged = false;
		previousDomain.current = map.domain;

		function redraw() {
			if (frame) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				if (camera.current) {
					const visible = String(drawAtlas(ctx!, layout, nodes, view, camera.current, active.current, hovered));
					if (surface!.dataset.visibleNodeCount !== visible) surface!.dataset.visibleNodeCount = visible;
					const mode = atOverview.current ? "overview" : "explore";
					if (surface!.dataset.cameraMode !== mode) surface!.dataset.cameraMode = mode;
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
			reveal(id) {
				const point = layout.points.get(id);
				const current = camera.current;
				if (point && current && !atOverview.current) {
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
				if (distance < best && distance <= Math.max(touch ? 15 : 8, dotRadius(candidate, current.zoom) + 4)) {
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
	}, [layout, nodes, map.domain]);

	useEffect(() => {
		active.current = selected;
		controls.current?.reveal(selected);
	}, [selected]);

	return (
		<div className="relative overflow-hidden rounded-2xl border-2 border-[#29243c] bg-[#f8f2df] shadow-[3px_4px_0_#282433]"
			style={{ backgroundImage: "radial-gradient(#dcd5c5 1px, transparent 1px)", backgroundSize: "15px 15px" }}>
			<canvas ref={canvas} tabIndex={0} aria-label={`Mapa de ${map.title}. ${layout.points.size} nós.`} aria-describedby={hintId}
				data-node-count={layout.points.size} data-edge-count={layout.edges.length}
				className="block h-[clamp(25rem,64vh,46rem)] w-full touch-none cursor-grab focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[#604d77]">
				Use a busca ou a lista de habilidades para navegar pelos nós do mapa.
			</canvas>
			<div className="absolute right-2 top-2 flex flex-wrap justify-end gap-1">
				<button type="button" aria-label="Visão geral do mapa" className="cel-button px-2 text-xs" onClick={() => controls.current?.reset()}>Visão geral</button>
				<button type="button" aria-label="Aproximar mapa" className="cel-button size-8" onClick={() => controls.current?.scale(1.4)}>+</button>
				<button type="button" aria-label="Afastar mapa" className="cel-button size-8" onClick={() => controls.current?.scale(1 / 1.4)}>−</button>
			</div>
			<div className="pointer-events-none absolute bottom-2 left-2 max-w-[calc(100%-1rem)] rounded-md bg-[#fffaf0] px-2 py-1 text-xs text-[#42394a]">
				<p id={hintId}>{layout.points.size} nós · Arraste ou use as setas · Zoom com + e −</p>
				<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
					<span className="inline-flex items-center gap-1"><span aria-hidden="true" className="size-3 rounded-full border border-dashed border-[#8c510d] bg-[#f4cc8d]" />Em andamento</span>
					<span className="inline-flex items-center gap-1"><span aria-hidden="true" className="size-3 rounded-full border border-[#247e5a] bg-[#b9ddc7]" />Concluído</span>
				</div>
			</div>
		</div>
	);
}
