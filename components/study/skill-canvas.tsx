"use client";

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useAppearance } from "@/components/settings/appearance";
import { useI18n } from "@/components/i18n";
import { Icon } from "@/components/icons/icon";
import {
	SKILL_MAP_STYLES,
	defaultSkillMapStyleForDomain,
	isSkillMapStyle,
	layoutSkillMap,
	type SkillMap,
	type SkillMapStyle,
	type SkillPoint,
} from "@/src/core";
import { MapStyleIcon } from "./map-style-icons.tsx";
import { drawSkillMap } from "./skill-canvas-draw.ts";
import {
	BOTTOM_GUTTER,
	MINIMAP_H,
	MINIMAP_PAD,
	MINIMAP_W,
	TOP_GUTTER,
	TextMetricsCache,
	buildMinimapCache,
	buildPalette,
	computeZoneStats,
	dotRadius,
	effectivePointY,
	fitZoom,
	type Camera,
	type CanvasStrings,
	type MinimapCache,
	type Pixel,
	type Viewport,
} from "./skill-canvas-palette.ts";

type MapControls = { scale: (factor: number) => void; reset: () => void; reveal: (id: string, focus?: boolean) => void };

interface AnchorZoomAnim {
	startLog: number;
	targetLog: number;
	anchorWX: number;
	anchorWY: number;
	anchorSX: number;
	anchorSY: number;
	t0: number;
	duration: number;
}

interface FlyAnim {
	startCenterX: number;
	startCenterY: number;
	startLog: number;
	targetCenterX: number;
	targetCenterY: number;
	targetLog: number;
	overviewAfter: boolean;
	t0: number;
	duration: number;
}

const STYLE_LABEL_KEY = {
	constellation: "map.canvas.styleConstellation",
	hextech: "map.canvas.styleHextech",
	citadel: "map.canvas.styleCitadel",
	atlas: "map.canvas.styleAtlas",
	clarity: "map.canvas.styleClarity",
} as const satisfies Record<SkillMapStyle, string>;

function is25DStyle(style: SkillMapStyle): boolean {
	return style === "constellation" || style === "hextech" || style === "citadel";
}

function storageKeyFor(domain: string): string {
	return `trilhaatlas:map-style:${domain}`;
}

export const SkillCanvas = memo(function SkillCanvas({
	map,
	selected,
	locate,
	onPick,
}: {
	map: SkillMap;
	selected: string;
	locate: number;
	onPick: (id: string) => void;
}) {
	const { colors, resolvedMode } = useAppearance();
	const { t } = useI18n();
	const initialStyle: SkillMapStyle = map.mapStyle ?? defaultSkillMapStyleForDomain(map.domain);
	const [style, setStyle] = useState<SkillMapStyle>(initialStyle);
	const [depth, setDepth] = useState(0.62);
	const depthRef = useRef(depth);
	depthRef.current = depth;

	const canvas = useRef<HTMLCanvasElement>(null);
	const zoomLabelRef = useRef<HTMLSpanElement>(null);
	const controls = useRef<MapControls>(null);
	const camera = useRef<Camera | undefined>(undefined);
	const atOverview = useRef(true);
	const previousLayoutKey = useRef("");
	const lastLocate = useRef(locate);
	const active = useRef(selected);
	const pick = useRef(onPick);
	const hintId = useId();

	// Sync style when switching domains (server manifest wins; fallback to localStorage if unset)
	useEffect(() => {
		if (map.mapStyle && isSkillMapStyle(map.mapStyle)) {
			setStyle(map.mapStyle);
			return;
		}
		try {
			const cached = window.localStorage.getItem(storageKeyFor(map.domain));
			if (isSkillMapStyle(cached)) {
				setStyle(cached);
				return;
			}
		} catch {
			// Ignore storage errors in private contexts.
		}
		setStyle(defaultSkillMapStyleForDomain(map.domain));
	}, [map.domain, map.mapStyle]);

	const handleSelectStyle = useCallback(
		(next: SkillMapStyle) => {
			if (next === style) return;
			setStyle(next);
			try {
				window.localStorage.setItem(storageKeyFor(map.domain), next);
			} catch {
				// Ignore storage errors.
			}
			void fetch("/api/study/map-style", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ domain: map.domain, style: next }),
			}).catch(() => {
				// Keep optimistic local preference even if offline.
			});
		},
		[map.domain, style],
	);

	const layout = useMemo(() => layoutSkillMap(map.nodes, style), [map.nodes, style]);
	const nodes = useMemo(() => new Map(map.nodes.map((node) => [node.id, node])), [map.nodes]);
	const zoneStats = useMemo(() => computeZoneStats(map.nodes), [map.nodes]);
	const palette = useMemo(() => buildPalette(colors, resolvedMode === "dark"), [colors, resolvedMode]);
	const strings = useMemo<CanvasStrings>(
		() => ({
			youAreHere: t("map.canvas.youAreHere"),
			completed: t("map.canvas.legendCompleted"),
			inProgress: t("map.canvas.legendInProgress"),
			available: t("map.canvas.legendAvailable"),
			pending: t("map.canvas.legendPending"),
			inferred: t("map.tree.statusKnown"),
		}),
		[t],
	);
	const anchorId = map.position ?? map.next;

	useEffect(() => {
		pick.current = onPick;
	}, [onPick]);

	useEffect(() => {
		const surface = canvas.current;
		const ctx = surface?.getContext("2d");
		if (!surface || !ctx) return;

		const fontFamily = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
		const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const textCache = new TextMetricsCache();
		let minimapCache: MinimapCache | null = null;
		let canvasRect: DOMRect | null = null;
		let lastZoomPct = 100;
		let view: Viewport = { width: 0, height: 0, ratio: 1 };
		let frame = 0;
		let animFrame = 0;
		let zoomAnim: AnchorZoomAnim | null = null;
		let flyAnim: FlyAnim | null = null;
		let hovered: string | undefined;

		const layoutKey = `${map.domain}:${style}`;
		if (!camera.current || previousLayoutKey.current !== layoutKey) atOverview.current = true;
		previousLayoutKey.current = layoutKey;

		const pointers = new Map<number, Pixel>();
		let down: Pixel | undefined;
		let dragged = false;
		let draggingMinimap = false;
		let draggingDepth = false;

		function getMinimap(): MinimapCache {
			if (!minimapCache || minimapCache.ratio !== view.ratio) {
				minimapCache = buildMinimapCache(layout, nodes, palette, anchorId, view.ratio);
			}
			return minimapCache;
		}

		function cancelAnim() {
			zoomAnim = null;
			flyAnim = null;
			if (animFrame) {
				cancelAnimationFrame(animFrame);
				animFrame = 0;
			}
		}

		function zoomBounds() {
			const fit = fitZoom(layout, view);
			return {
				fit,
				minZoom: fit * 0.55,
				maxZoom: Math.max(4.5, fit * 9.5),
			};
		}

		function syncZoomLabel(forcePct?: number) {
			if (!camera.current || !view.width) return;
			const pct = forcePct ?? Math.round((camera.current.zoom / fitZoom(layout, view)) * 100);
			if (forcePct !== undefined || Math.abs(lastZoomPct - pct) >= 2) {
				lastZoomPct = pct;
				if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${pct}%`;
			}
		}

		function renderNow() {
			if (!camera.current) return;
			const visible = String(
				drawSkillMap({
					ctx: ctx!,
					layout,
					nodes,
					zoneStats,
					view,
					camera: camera.current,
					depth: depthRef.current,
					selected: active.current,
					hovered,
					current: anchorId,
					palette,
					strings,
					fontFamily,
					textCache,
					getMinimap,
				}),
			);
			if (surface!.dataset.visibleNodeCount !== visible) surface!.dataset.visibleNodeCount = visible;
			const mode = atOverview.current ? "overview" : "explore";
			if (surface!.dataset.cameraMode !== mode) surface!.dataset.cameraMode = mode;
			syncZoomLabel();
		}

		function redraw() {
			if (frame) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				renderNow();
			});
		}

		function runAnimationLoop() {
			if (animFrame) return;
			const tick = (now: number) => {
				animFrame = 0;
				if (!camera.current) return;

				if (zoomAnim) {
					const u = Math.min(1, (now - zoomAnim.t0) / zoomAnim.duration);
					const ease = 1 - (1 - u) ** 3;
					const nextZoom = Math.exp(zoomAnim.startLog + (zoomAnim.targetLog - zoomAnim.startLog) * ease);
					// Exact mathematical cursor-lock invariant: zero pixel drift on EVERY frame!
					camera.current = {
						x: zoomAnim.anchorSX - zoomAnim.anchorWX * nextZoom,
						y: zoomAnim.anchorSY - zoomAnim.anchorWY * nextZoom,
						zoom: nextZoom,
					};
					if (u >= 1) zoomAnim = null;
				} else if (flyAnim) {
					const u = Math.min(1, (now - flyAnim.t0) / flyAnim.duration);
					const ease = u < 0.5 ? 4 * u * u * u : 1 - ((-2 * u + 2) ** 3) / 2;
					const nextZoom = Math.exp(flyAnim.startLog + (flyAnim.targetLog - flyAnim.startLog) * ease);
					const cx = flyAnim.startCenterX + (flyAnim.targetCenterX - flyAnim.startCenterX) * ease;
					const cy = flyAnim.startCenterY + (flyAnim.targetCenterY - flyAnim.startCenterY) * ease;
					camera.current = {
						x: view.width / 2 - cx * nextZoom,
						y: view.height / 2 - cy * nextZoom,
						zoom: nextZoom,
					};
					if (u >= 1) {
						atOverview.current = flyAnim.overviewAfter;
						flyAnim = null;
					}
				}

				if (frame) {
					cancelAnimationFrame(frame);
					frame = 0;
				}
				renderNow();
				if (zoomAnim || flyAnim) {
					animFrame = requestAnimationFrame(tick);
				}
			};
			animFrame = requestAnimationFrame(tick);
		}

		function flyToCamera(target: Camera, overviewAfter = false) {
			cancelAnim();
			if (!camera.current || reducedMotion()) {
				camera.current = target;
				atOverview.current = overviewAfter;
				redraw();
				return;
			}
			const start = camera.current;
			flyAnim = {
				startCenterX: (view.width / 2 - start.x) / start.zoom,
				startCenterY: (view.height / 2 - start.y) / start.zoom,
				startLog: Math.log(Math.max(1e-4, start.zoom)),
				targetCenterX: (view.width / 2 - target.x) / target.zoom,
				targetCenterY: (view.height / 2 - target.y) / target.zoom,
				targetLog: Math.log(Math.max(1e-4, target.zoom)),
				overviewAfter,
				t0: performance.now(),
				duration: 280,
			};
			runAnimationLoop();
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
				flyToCamera(target, true);
			} else {
				cancelAnim();
				camera.current = target;
				atOverview.current = true;
				syncZoomLabel(100);
				redraw();
			}
		}

		function resize() {
			const width = surface!.clientWidth;
			const height = surface!.clientHeight;
			const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
			if (!width || !height) return;
			canvasRect = surface!.getBoundingClientRect();
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

		function invalidateRect() {
			canvasRect = null;
		}

		// Cursor-anchored log-zoom: pins the world coordinate under `anchor` with 0 px drift!
		function scaleAt(anchor: Pixel, factor: number, smooth = true) {
			const current = camera.current;
			if (!current) return;
			flyAnim = null;

			const { minZoom, maxZoom } = zoomBounds();
			const baseLog = zoomAnim ? zoomAnim.targetLog : Math.log(current.zoom);
			const nextLog = Math.max(Math.log(minZoom), Math.min(Math.log(maxZoom), baseLog + Math.log(factor)));
			if (Math.abs(nextLog - Math.log(current.zoom)) < 1e-4) return;

			const anchorWX = (anchor.x - current.x) / current.zoom;
			const anchorWY = (anchor.y - current.y) / current.zoom;
			atOverview.current = false;

			if (!smooth || reducedMotion()) {
				cancelAnim();
				const nextZoom = Math.exp(nextLog);
				camera.current = {
					x: anchor.x - anchorWX * nextZoom,
					y: anchor.y - anchorWY * nextZoom,
					zoom: nextZoom,
				};
				redraw();
				return;
			}

			zoomAnim = {
				startLog: Math.log(current.zoom),
				targetLog: nextLog,
				anchorWX,
				anchorWY,
				anchorSX: anchor.x,
				anchorSY: anchor.y,
				t0: performance.now(),
				duration: 90,
			};
			runAnimationLoop();
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
			if (relativeZoom <= 1.35) return null;
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
				if (!point || !current) {
					redraw();
					return;
				}
				const py = effectivePointY(point, style, depthRef.current);
				if (focus) {
					const zoom = Math.max(current.zoom, fitZoom(layout, view) * (style === "clarity" ? 2.6 : 3.8));
					flyToCamera({ x: view.width / 2 - point.x * zoom, y: view.height / 2 - py * zoom, zoom }, false);
				} else if (!atOverview.current) {
					const x = current.x + point.x * current.zoom;
					const y = current.y + py * current.zoom;
					if (x < 16 || x > view.width - 16 || y < 16 || y > view.height - 16) {
						flyToCamera({ x: current.x + (view.width / 2 - x), y: current.y + (view.height / 2 - y), zoom: current.zoom }, false);
					} else {
						redraw();
					}
				} else {
					redraw();
				}
			},
		};

		function location(event: MouseEvent): Pixel {
			const rect = canvasRect ?? (canvasRect = surface!.getBoundingClientRect());
			return {
				x: ((event.clientX - rect.left) * view.width) / Math.max(1, rect.width),
				y: ((event.clientY - rect.top) * view.height) / Math.max(1, rect.height),
			};
		}

		function hit(point: Pixel, touch = false) {
			const current = camera.current;
			if (!current) return;
			const minHit = touch ? 16 : 10;
			const maxScreenR = Math.max(minHit, 24);
			const searchWorldR = maxScreenR / current.zoom;
			// Account for max 2.5D Z lift so spatial grid lookup never misses elevated points
			const zLiftAllowance = is25DStyle(style) ? 45 * depthRef.current : 0;
			const wx = (point.x - current.x) / current.zoom;
			const wy = (point.y - current.y) / current.zoom;
			const { cellSize, cells } = layout.spatialGrid;
			const minCx = Math.floor((wx - searchWorldR) / cellSize);
			const maxCx = Math.floor((wx + searchWorldR) / cellSize);
			const minCy = Math.floor((wy - searchWorldR) / cellSize);
			const maxCy = Math.floor((wy + searchWorldR + zLiftAllowance) / cellSize);

			let closest: string | undefined;
			let bestSq = Infinity;
			const checkCandidate = (candidate: SkillPoint) => {
				const cy = effectivePointY(candidate, style, depthRef.current);
				const dx = current.x + candidate.x * current.zoom - point.x;
				const dy = current.y + cy * current.zoom - point.y;
				const distSq = dx * dx + dy * dy;
				if (distSq >= bestSq) return;
				const r = Math.max(minHit, dotRadius(candidate, current.zoom) + 6);
				if (distSq <= r * r) {
					bestSq = distSq;
					closest = candidate.id;
				}
			};

			const cellCount = (maxCx - minCx + 1) * (maxCy - minCy + 1);
			if (cellCount <= layout.points.size) {
				for (let cx = minCx; cx <= maxCx; cx++) {
					for (let cy = minCy; cy <= maxCy; cy++) {
						const ids = cells.get(`${cx},${cy}`);
						if (!ids) continue;
						for (const id of ids) {
							const candidate = layout.points.get(id);
							if (candidate) checkCandidate(candidate);
						}
					}
				}
			} else {
				for (const candidate of layout.points.values()) checkCandidate(candidate);
			}
			return closest;
		}

		function inMinimap(point: Pixel): boolean {
			const mm = minimapBounds();
			return Boolean(mm && point.x >= mm.mx && point.x <= mm.mx + MINIMAP_W && point.y >= mm.my && point.y <= mm.my + MINIMAP_H);
		}

		function onContextMenu(event: MouseEvent) {
			if (is25DStyle(style)) event.preventDefault();
		}

		function pointerDown(event: PointerEvent) {
			const point = location(event);
			if ((event.button === 2 || (event.button === 0 && event.shiftKey)) && is25DStyle(style)) {
				draggingDepth = true;
				down = point;
				surface!.setPointerCapture(event.pointerId);
				surface!.style.cursor = "ns-resize";
				return;
			}
			if (event.button !== 0) return;
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
			if (draggingDepth && down) {
				const dy = point.y - down.y;
				down = point;
				const next = Math.max(0, Math.min(1, depthRef.current - dy * 0.004));
				depthRef.current = next;
				setDepth(next);
				redraw();
				return;
			}
			if (draggingMinimap) {
				jumpMinimap(point);
				return;
			}
			const previous = pointers.get(event.pointerId);
			if (!previous) {
				if (event.pointerType !== "mouse" || pointers.size) return;
				if (inMinimap(point)) {
					if (hovered !== undefined) {
						hovered = undefined;
						redraw();
					}
					if (surface!.style.cursor !== "pointer") surface!.style.cursor = "pointer";
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
				if (distance >= 1) {
					scaleAt(
						{ x: (previous.x + other.x) / 2, y: (previous.y + other.y) / 2 },
						Math.hypot(point.x - other.x, point.y - other.y) / distance,
						false,
					);
				}
				move((point.x - previous.x) / 2, (point.y - previous.y) / 2);
			} else if (dragged || (down && Math.hypot(point.x - down.x, point.y - down.y) > 4)) {
				dragged = true;
				move(point.x - previous.x, point.y - previous.y);
			}
		}

		function pointerEnd(event: PointerEvent) {
			if (draggingDepth) {
				draggingDepth = false;
				down = undefined;
				surface!.style.cursor = hovered ? "pointer" : "grab";
				return;
			}
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
			const target = hit(point);
			if (target) {
				pick.current(target);
				controls.current?.reveal(target, true);
				return;
			}
			scaleAt(point, 1.9, true);
		}

		function clearHover() {
			if (hovered !== undefined) {
				hovered = undefined;
				redraw();
			}
		}

		function wheel(event: WheelEvent) {
			event.preventDefault();
			let dy = event.deltaY;
			if (event.deltaMode === 1) dy *= 26;
			else if (event.deltaMode === 2) dy *= view.height;
			dy = Math.max(-180, Math.min(180, dy));
			const sensitivity = event.ctrlKey ? 0.0085 : 0.0022;
			scaleAt(location(event), Math.exp(-dy * sensitivity), !event.ctrlKey);
		}

		function keyboard(event: KeyboardEvent) {
			switch (event.key) {
				case "+":
				case "=":
					scale(1.4);
					break;
				case "-":
					scale(1 / 1.4);
					break;
				case "Home":
				case "0":
					overview(true);
					break;
				case "ArrowLeft":
					move(64, 0);
					break;
				case "ArrowRight":
					move(-64, 0);
					break;
				case "ArrowUp":
					move(0, 64);
					break;
				case "ArrowDown":
					move(0, -64);
					break;
				default:
					return;
			}
			event.preventDefault();
		}

		const onFontsChanged = () => {
			textCache.clear();
			redraw();
		};

		resize();
		const observer = new ResizeObserver(resize);
		observer.observe(surface);
		window.addEventListener("scroll", invalidateRect, { capture: true, passive: true });
		document.fonts?.addEventListener("loadingdone", onFontsChanged);
		surface.addEventListener("contextmenu", onContextMenu);
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
			window.removeEventListener("scroll", invalidateRect, true);
			document.fonts?.removeEventListener("loadingdone", onFontsChanged);
			surface.removeEventListener("contextmenu", onContextMenu);
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
			textCache.clear();
		};
	}, [layout, nodes, zoneStats, map.domain, anchorId, palette, strings, style]);

	// Redraw smoothly when the 2.5D relief slider moves without resetting camera
	useEffect(() => {
		controls.current?.reveal(active.current, false);
	}, [depth]);

	useEffect(() => {
		active.current = selected;
		controls.current?.reveal(selected, locate !== lastLocate.current);
		lastLocate.current = locate;
	}, [selected, locate]);

	return (
		<div className="cel-card overflow-hidden">
			{/* Dedicated top toolbar: 5 visual styles with hand-drawn SVGs + camera & 2.5D controls */}
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/65 bg-card/95 px-3 py-2">
				<div
					role="group"
					aria-label={t("map.canvas.styleSelectorAria")}
					className="flex flex-wrap items-center gap-1"
				>
					{SKILL_MAP_STYLES.map((item) => {
						const activeStyle = item === style;
						const label = t(STYLE_LABEL_KEY[item]);
						return (
							<button
								key={item}
								type="button"
								aria-pressed={activeStyle}
								title={label}
								onClick={() => handleSelectStyle(item)}
								className={
									"inline-flex items-center gap-1.5 rounded-[9px] border px-2.5 py-1 text-xs font-semibold transition-colors " +
									(activeStyle
										? "border-transparent bg-[var(--cel-accent,var(--lh-accent))] text-[var(--cel-on-fill,#07070b)] shadow-xs"
										: "border-transparent text-muted-foreground hover:border-border/70 hover:bg-accent/70 hover:text-foreground")
								}
							>
								<MapStyleIcon style={item} size={15} className="shrink-0" />
								<span>{label}</span>
							</button>
						);
					})}
				</div>

				<div className="flex flex-wrap items-center justify-end gap-1.5">
					{is25DStyle(style) && (
						<label
							title={t("map.canvas.depthAria")}
							className="inline-flex items-center gap-1.5 rounded-[9px] border border-border/65 bg-background/60 px-2 py-1 text-[11px] font-semibold text-muted-foreground"
						>
							<span>{t("map.canvas.depthShort")}</span>
							<input
								type="range"
								min={0}
								max={1}
								step={0.05}
								value={depth}
								aria-label={t("map.canvas.depthAria")}
								onChange={(e) => setDepth(Number(e.target.value))}
								className="w-14 accent-[var(--cel-accent,var(--lh-accent))]"
							/>
						</label>
					)}
					{anchorId && (
						<button
							type="button"
							aria-label={t("map.canvas.centerCurrentAria")}
							className="cel-button min-h-8 px-2.5 py-1 text-xs"
							onClick={() => {
								pick.current(anchorId);
								controls.current?.reveal(anchorId, true);
							}}
						>
							<span aria-hidden="true" className="size-2 rounded-full bg-[var(--c-teal,#2ec4b6)]" />
							<span>{t("map.canvas.youAreHere")}</span>
						</button>
					)}
					<button
						type="button"
						aria-label={t("map.canvas.overviewAria")}
						className="cel-button min-h-8 px-2.5 py-1 text-xs"
						onClick={() => controls.current?.reset()}
					>
						<Icon name="maximize" size={14} tone={false} />
						<span>{t("map.canvas.overview")}</span>
					</button>
					<div className="flex items-center overflow-hidden rounded-[10px] border border-border/70 bg-card shadow-xs">
						<button
							type="button"
							aria-label={t("map.canvas.zoomOutAria")}
							className="flex size-8 items-center justify-center text-sm font-bold hover:bg-accent"
							onClick={() => controls.current?.scale(1 / 1.4)}
						>
							−
						</button>
						<span
							ref={zoomLabelRef}
							className="min-w-11 border-x border-border/50 px-1.5 text-center font-mono text-[11px] text-muted-foreground tabular-nums"
							aria-hidden="true"
						>
							100%
						</span>
						<button
							type="button"
							aria-label={t("map.canvas.zoomInAria")}
							className="flex size-8 items-center justify-center text-sm font-bold hover:bg-accent"
							onClick={() => controls.current?.scale(1.4)}
						>
							+
						</button>
					</div>
				</div>
			</div>

			{/* Canvas stage */}
			<div
				className="relative overflow-hidden"
				style={{
					backgroundImage: "radial-gradient(color-mix(in srgb, var(--border) 22%, transparent) 1px, transparent 1px)",
					backgroundSize: "16px 16px",
				}}
			>
				<canvas
					ref={canvas}
					tabIndex={0}
					aria-label={t("map.canvas.canvasAria", { title: map.title, count: layout.points.size })}
					aria-describedby={hintId}
					data-node-count={layout.points.size}
					data-edge-count={layout.edges.length}
					data-map-style={style}
					className="block h-[clamp(28rem,66vh,48rem)] w-full touch-none cursor-grab focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring"
				>
					{t("map.canvas.fallbackText")}
				</canvas>

				{/* Bottom-left: Compact status legend */}
				<div className="pointer-events-none absolute bottom-2.5 left-2.5 max-w-[calc(100%-1.25rem)] rounded-xl border border-border/60 bg-card/95 px-3 py-2 text-xs text-card-foreground shadow-sm">
					<p id={hintId} className="text-muted-foreground tabular-nums">
						{t("map.canvas.hint", { count: layout.points.size })}
					</p>
					<div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1">
						<span className="inline-flex items-center gap-1.5">
							<span aria-hidden="true" className="size-2.5 rounded-full bg-[var(--c-teal,#2ec4b6)] ring-2 ring-[var(--c-teal,#2ec4b6)]/35" />
							{t("map.canvas.youAreHere")}
						</span>
						<span className="inline-flex items-center gap-1.5">
							<span aria-hidden="true" className="size-2.5 rounded-full border border-foreground/60 bg-[var(--cel-success,var(--lh-success))] ring-2 ring-[var(--cel-success,var(--lh-success))]/30" />
							{t("map.canvas.legendCompleted")}
						</span>
						<span className="inline-flex items-center gap-1.5">
							<span aria-hidden="true" className="size-2.5 rounded-full border border-dashed border-[var(--cel-warning,var(--lh-warning))] bg-[var(--cel-warning,var(--lh-warning))]" />
							{t("map.canvas.legendInProgress")}
						</span>
						<span className="inline-flex items-center gap-1.5">
							<span aria-hidden="true" className="size-2.5 rounded-full border-2 border-foreground bg-card" />
							{t("map.canvas.legendAvailable")}
						</span>
						<span className="inline-flex items-center gap-1.5">
							<span aria-hidden="true" className="size-2 rounded-full bg-border/60" />
							{t("map.canvas.legendPending")}
						</span>
					</div>
				</div>
			</div>
		</div>
	);
});
