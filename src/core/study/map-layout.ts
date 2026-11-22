import type { SkillNode } from "./map.ts";
import type { SkillMapStyle } from "./map-style.ts";

export interface SkillPoint {
	id: string;
	x: number;
	y: number;
	/** Structural 2.5D elevation (progress-independent; used by 2.5D styles). */
	z?: number;
	radius: number;
	color: number;
	kind: SkillNode["kind"];
}

interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface SkillZone extends Box {
	id: string;
	color: number;
	heading: "area" | "unit";
}

export interface SkillWheel {
	unitId: string;
	color: number;
	cx: number;
	cy: number;
	radius: number;
	angle: number;
}

export interface SkillRing {
	cx: number;
	cy: number;
	radius: number;
	label?: string;
}

export interface SkillGear {
	id: string;
	color: number;
	cx: number;
	cy: number;
	radius: number;
	teeth: number;
	direction: 1 | -1;
	isRoot?: boolean;
}

export interface SkillHexCluster {
	areaId: string;
	color: number;
	cx: number;
	cy: number;
	radius: number;
	tier: number;
}

export interface SkillLane {
	areaId: string;
	color: number;
	x: number;
	y: number;
	width: number;
	height: number;
	headerWidth: number;
}

export interface SkillEdge {
	from: SkillPoint;
	to: SkillPoint;
	kind: "hierarchy" | "prerequisite" | "related";
	crossesRegion: boolean;
}

interface OverviewLink {
	from: SkillPoint;
	to: SkillPoint;
	count: number;
}

const STEP = 40;
const ROW_STEP = 46;
const GAP = 26;
const LAYER_GAP = 64;
const PADDING = 24;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SQRT3 = Math.sqrt(3);

function compareNodes(a: SkillNode, b: SkillNode) {
	return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Pack boxes into neat horizontal rows growing from BOTTOM (foundations) to TOP (advanced). */
function packBottomUp(sizes: { width: number; height: number }[], ratio: number) {
	const area = sizes.reduce((sum, size) => sum + (size.width + GAP) * (size.height + GAP), 0);
	const limit = Math.max(Math.sqrt(area * ratio), ...sizes.map(size => size.width));
	const rows: { items: { index: number; width: number; height: number }[]; width: number; height: number }[] = [];
	let current: { index: number; width: number; height: number }[] = [];
	let rowW = 0;
	let rowH = 0;

	for (const [index, size] of sizes.entries()) {
		if (current.length > 0 && rowW + GAP + size.width > limit) {
			rows.push({ items: current, width: rowW, height: rowH });
			current = [];
			rowW = 0;
			rowH = 0;
		}
		rowW = current.length > 0 ? rowW + GAP + size.width : size.width;
		rowH = Math.max(rowH, size.height);
		current.push({ index, width: size.width, height: size.height });
	}
	if (current.length > 0) rows.push({ items: current, width: rowW, height: rowH });

	const maxWidth = Math.max(0, ...rows.map(r => r.width));
	const totalHeight = rows.reduce((sum, r) => sum + r.height, 0) + Math.max(0, rows.length - 1) * GAP;
	const boxes: Box[] = new Array(sizes.length);

	// Place row 0 (earliest foundations) at the BOTTOM and climb upward toward y = 0.
	let yBottom = totalHeight;
	for (const row of rows) {
		const yTop = yBottom - row.height;
		let x = (maxWidth - row.width) / 2;
		for (const item of row.items) {
			boxes[item.index] = { x, y: yTop, width: item.width, height: row.height };
			x += item.width + GAP;
		}
		yBottom = yTop - GAP;
	}
	return { boxes, width: maxWidth, height: totalHeight };
}

/** Split sorted areas (foundation → advanced) into tree tiers (bottom → canopy → crown). */
function tierSizes(count: number): number[] {
	if (count <= 3) return [count];
	if (count <= 6) {
		const base = Math.floor(count / 2);
		return [base, count - base];
	}
	if (count <= 12) {
		const base = Math.max(2, Math.floor(count * 0.3));
		const crown = Math.max(2, Math.floor(count * 0.3));
		return [base, count - base - crown, crown];
	}
	const base = Math.max(3, Math.round(count * 0.2));
	const crown = Math.max(3, Math.round(count * 0.22));
	const remaining = count - base - crown;
	const lowerMid = Math.floor(remaining / 2);
	const upperMid = remaining - lowerMid;
	return [base, lowerMid, upperMid, crown];
}

interface ParsedUnit {
	id: string;
	children: SkillNode[];
	positions: Map<string, { x: number; y: number }>;
	depth: number;
	width: number;
	height: number;
}

interface ParsedArea {
	id: string;
	units: ParsedUnit[];
	packed: ReturnType<typeof packBottomUp>;
	order: number;
	depth: number;
	width: number;
	height: number;
	totalCount: number;
}

interface ParsedCurriculum {
	nodes: SkillNode[];
	byId: Map<string, SkillNode>;
	prerequisites: Map<string, string[]>;
	rank: Map<string, number>;
	roots: SkillNode[];
	areaByNode: Map<string, string>;
	groups: ParsedArea[];
	progression: ParsedArea[];
	layers: ParsedArea[][];
}

const parsedCurriculumCache = new WeakMap<readonly SkillNode[], ParsedCurriculum>();

function parseCurriculum(input: readonly SkillNode[]): ParsedCurriculum {
	const cached = parsedCurriculumCache.get(input);
	if (cached) return cached;
	const nodes = [...input].sort(compareNodes);
	const byId = new Map(nodes.map(node => [node.id, node]));
	const prerequisites = new Map<string, string[]>();
	const successors = new Map<string, string[]>();
	const remaining = new Map<string, number>();
	const rank = new Map<string, number>();
	const queue: string[] = [];

	for (const node of nodes) {
		const ids = [...new Set(node.requires.flat())].filter(id => id !== node.id && byId.has(id));
		prerequisites.set(node.id, ids);
		remaining.set(node.id, ids.length);
		if (!ids.length) queue.push(node.id);
		for (const id of ids) {
			const dependents = successors.get(id) ?? [];
			dependents.push(node.id);
			successors.set(id, dependents);
		}
	}
	for (let i = 0; i < queue.length; i++) {
		const id = queue[i]!;
		for (const next of successors.get(id) ?? []) {
			rank.set(next, Math.max(rank.get(next) ?? 0, (rank.get(id) ?? 0) + 1));
			const pending = remaining.get(next)! - 1;
			remaining.set(next, pending);
			if (!pending) queue.push(next);
		}
	}

	const roots = nodes.filter(node => node.kind === "domain");
	const areas = new Map<string, Map<string, SkillNode[]>>();
	const areaByNode = new Map<string, string>();
	for (const node of nodes) {
		if (node.kind === "domain") continue;
		let area: SkillNode | undefined = node;
		while (area && area.kind !== "area" && area.kind !== "domain") {
			area = area.parent ? byId.get(area.parent) : undefined;
		}
		const areaKey = area?.kind === "area" ? area.id : "";
		if (areaKey) areaByNode.set(node.id, areaKey);
		const regions = areas.get(areaKey) ?? new Map<string, SkillNode[]>();
		areas.set(areaKey, regions);
		if (node.id === areaKey) continue;
		const group = node.region && byId.has(node.region) ? node.region : "";
		const members = regions.get(group) ?? [];
		members.push(node);
		regions.set(group, members);
	}

	const groups: ParsedArea[] = [...areas]
		.sort(([a], [b]) => a && b ? compareNodes(byId.get(a)!, byId.get(b)!) : Number(Boolean(b)) - Number(Boolean(a)))
		.map(([id, regions]) => {
			const units: ParsedUnit[] = [...regions]
				.sort(([a], [b]) => a && b ? compareNodes(byId.get(a)!, byId.get(b)!) : Number(Boolean(b)) - Number(Boolean(a)))
				.map(([region, members]) => {
					const children = members
						.filter(node => node.id !== region)
						.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0) || compareNodes(a, b));
					const memberIds = new Set(children.map(n => n.id));
					const branches = new Map<string, SkillNode[]>();
					for (const child of children) {
						const branch = child.parent && memberIds.has(child.parent) ? child.parent : child.id;
						const list = branches.get(branch) ?? [];
						list.push(child);
						branches.set(branch, list);
					}
					const orderedBranches = [...branches.values()].sort((a, b) => (rank.get(a[0]!.id) ?? 0) - (rank.get(b[0]!.id) ?? 0));
					const runs: SkillNode[][] = [];
					let sequence: SkillNode[] = [];
					for (const branch of orderedBranches) {
						if (branch.length === 1) sequence.push(branch[0]!);
						else {
							if (sequence.length) runs.push(sequence);
							runs.push(branch);
							sequence = [];
						}
					}
					if (sequence.length) runs.push(sequence);

					const totalRows = runs.reduce((sum, run) => sum + Math.ceil(run.length / 6), 0);
					const positions = new Map<string, { x: number; y: number }>();
					let row = 0;
					let columns = 1;
					for (const run of runs) {
						const ordered = run.sort(
							(a, b) => Number(b.kind === "topic") - Number(a.kind === "topic") || (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0) || compareNodes(a, b),
						);
						for (const [j, n] of ordered.entries()) {
							const turn = Math.floor(j / 6);
							const col = j % 6;
							const gridRow = row + turn;
							const invertedRow = Math.max(0, totalRows - 1 - gridRow);
							positions.set(n.id, { x: col * STEP, y: invertedRow * ROW_STEP });
						}
						row += Math.ceil(run.length / 6);
						columns = Math.max(columns, Math.min(run.length, 6));
					}
					const depths = children.map(n => rank.get(n.id) ?? 0);
					return {
						id: region,
						children,
						positions,
						depth: depths.length ? Math.min(...depths) : 0,
						width: Math.max(152, (columns - 1) * STEP + PADDING * 2),
						height: Math.max(92, totalRows * ROW_STEP + 50),
					};
				})
				.sort((a, b) => a.depth - b.depth);
			const packed = packBottomUp(units, 2.05);
			const depths = units.flatMap(u => u.children.filter(n => n.leaf).map(n => rank.get(n.id) ?? 0)).sort((a, b) => a - b);
			const order = id ? (byId.get(id)?.order ?? 0) : 0;
			const totalCount = (id ? 1 : 0) + units.reduce((sum, u) => sum + (u.id ? 1 : 0) + u.children.length, 0);
			return {
				id,
				units,
				packed,
				order,
				depth: depths[Math.floor(depths.length / 2)] ?? 0,
				width: Math.max(210, packed.width + PADDING * 2),
				height: packed.height + 78,
				totalCount,
			};
		});

	const maxDepth = Math.max(1, ...groups.map(g => g.depth));
	const maxOrder = Math.max(1, ...groups.map(g => g.order));
	const progression = [...groups].sort((a, b) => {
		const scoreA = (a.depth / maxDepth) * 0.55 + (a.order / maxOrder) * 0.45;
		const scoreB = (b.depth / maxDepth) * 0.55 + (b.order / maxOrder) * 0.45;
		return scoreA - scoreB || a.order - b.order;
	});

	const sizes = tierSizes(progression.length);
	const layers: ParsedArea[][] = [];
	let cursor = 0;
	for (const size of sizes) {
		const slice = progression.slice(cursor, cursor + size);
		if (slice.length) layers.push(slice);
		cursor += size;
	}

	const result: ParsedCurriculum = { nodes, byId, prerequisites, rank, roots, areaByNode, groups, progression, layers };
	parsedCurriculumCache.set(input, result);
	return result;
}

function radiusForKind(kind: SkillNode["kind"]): number {
	return { domain: 13, area: 10, unit: 8, topic: 6.5, atom: 5 }[kind];
}

/** Guarantees mathematically unique (x, y) coordinates across every node even in exotic graphs. */
function ensureUniqueCoordinates(points: Map<string, SkillPoint>) {
	const seen = new Set<string>();
	for (const pt of points.values()) {
		let key = `${pt.x},${pt.y}`;
		if (!seen.has(key)) {
			seen.add(key);
			continue;
		}
		let step = 1;
		while (seen.has(key)) {
			const angle = step * GOLDEN_ANGLE;
			const dist = 4 + step * 2.5;
			pt.x = Math.round((pt.x + Math.cos(angle) * dist) * 100) / 100;
			pt.y = Math.round((pt.y + Math.sin(angle) * dist) * 100) / 100;
			key = `${pt.x},${pt.y}`;
			step++;
		}
		seen.add(key);
	}
}

/** Translate arbitrary centered coordinates into positive canvas space [margin..width-margin]. */
function normalizeToCanvas(
	points: Map<string, SkillPoint>,
	margin: number,
	extra?: {
		zones?: SkillZone[];
		wheels?: SkillWheel[];
		rings?: SkillRing[];
		gears?: SkillGear[];
		hexClusters?: SkillHexCluster[];
		lanes?: SkillLane[];
	},
) {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;

	const include = (x: number, y: number, pad = 0) => {
		if (x - pad < minX) minX = x - pad;
		if (x + pad > maxX) maxX = x + pad;
		if (y - pad < minY) minY = y - pad;
		if (y + pad > maxY) maxY = y + pad;
	};

	for (const pt of points.values()) include(pt.x, pt.y, pt.radius + 8);
	for (const z of extra?.zones ?? []) {
		include(z.x, z.y, 0);
		include(z.x + z.width, z.y + z.height, 0);
	}
	for (const w of extra?.wheels ?? []) include(w.cx, w.cy, w.radius + 14);
	for (const r of extra?.rings ?? []) include(r.cx, r.cy, r.radius + 18);
	for (const g of extra?.gears ?? []) include(g.cx, g.cy, g.radius * 1.12);
	for (const h of extra?.hexClusters ?? []) include(h.cx, h.cy, h.radius + 16);
	for (const l of extra?.lanes ?? []) {
		include(l.x, l.y, 0);
		include(l.x + l.width, l.y + l.height, 0);
	}

	if (!Number.isFinite(minX)) {
		return { width: 480, height: 320 };
	}

	const dx = margin - minX;
	const dy = margin - minY;
	for (const pt of points.values()) {
		pt.x += dx;
		pt.y += dy;
	}
	for (const z of extra?.zones ?? []) {
		z.x += dx;
		z.y += dy;
	}
	for (const w of extra?.wheels ?? []) {
		w.cx += dx;
		w.cy += dy;
	}
	for (const r of extra?.rings ?? []) {
		r.cx += dx;
		r.cy += dy;
	}
	for (const g of extra?.gears ?? []) {
		g.cx += dx;
		g.cy += dy;
	}
	for (const h of extra?.hexClusters ?? []) {
		h.cx += dx;
		h.cy += dy;
	}
	for (const l of extra?.lanes ?? []) {
		l.x += dx;
		l.y += dy;
	}

	return {
		width: Math.max(480, maxX - minX + margin * 2),
		height: Math.max(320, maxY - minY + margin * 2),
	};
}

// ─── Layout 1: Default TrilhaAtlas ("atlas") ────────────────────────────────

function buildAtlasLayout(parsed: ParsedCurriculum) {
	const { byId, roots, groups, layers } = parsed;
	const layerMetrics = layers.map(layer => ({
		layer,
		width: layer.reduce((sum, g) => sum + g.width, 0) + Math.max(0, layer.length - 1) * GAP * 1.4,
		height: Math.max(...layer.map(g => g.height)),
	}));
	const canopyWidth = Math.max(440, ...layerMetrics.map(m => m.width));
	const canopyHeight = layerMetrics.reduce((sum, m) => sum + m.height, 0) + Math.max(0, layerMetrics.length - 1) * LAYER_GAP;

	const topMargin = PADDING + 22;
	const rootBand = 72 + Math.floor(Math.max(0, roots.length - 1) / 10) * STEP;
	const totalWidth = canopyWidth + PADDING * 2;
	const totalHeight = topMargin + canopyHeight + rootBand;

	const boxes = new Map<ParsedArea, Box>();
	let yBottom = topMargin + canopyHeight;
	for (const { layer, width: lw, height: lh } of layerMetrics) {
		const yTop = yBottom - lh;
		let x = PADDING + (canopyWidth - lw) / 2;
		for (const group of layer) {
			boxes.set(group, { x, y: yTop + (lh - group.height), width: group.width, height: group.height });
			x += group.width + GAP * 1.4;
		}
		yBottom = yTop - LAYER_GAP;
	}

	const points = new Map<string, SkillPoint>();
	const zones: SkillZone[] = [];
	const place = (node: SkillNode, x: number, y: number, color: number) => {
		points.set(node.id, { id: node.id, kind: node.kind, x, y, color, radius: radiusForKind(node.kind) });
	};

	const rootY = topMargin + canopyHeight + 38;
	const rootSpan = Math.min(roots.length, 10) * STEP;
	for (const [i, root] of roots.entries()) {
		const rx = totalWidth / 2 - (rootSpan - STEP) / 2 + (i % 10) * STEP;
		const ry = rootY + Math.floor(i / 10) * STEP;
		place(root, rx, ry, 0);
	}

	for (const [color, area] of groups.entries()) {
		const box = boxes.get(area)!;
		const { x, y } = box;
		if (area.id) {
			zones.push({ x, y, width: box.width, height: box.height, id: area.id, color, heading: "area" });
			place(byId.get(area.id)!, x + PADDING, y + 27, color);
		}
		for (const [i, unit] of area.units.entries()) {
			const inner = area.packed.boxes[i]!;
			const left = x + PADDING + inner.x;
			const upper = y + 55 + inner.y;
			if (unit.id) {
				zones.push({ x: left, y: upper, width: inner.width, height: inner.height, id: unit.id, color, heading: "unit" });
				const heading = byId.get(unit.id)!;
				if (!points.has(heading.id)) place(heading, left + PADDING, upper + 16, color);
			}
			for (const node of unit.children) {
				const offset = unit.positions.get(node.id)!;
				place(node, left + PADDING + offset.x, upper + 52 + offset.y, color);
			}
		}
	}

	const stretch = Math.max(1, Math.min(1.4, (1.35 * totalHeight) / totalWidth));
	for (const point of points.values()) point.x *= stretch;
	for (const zone of zones) {
		zone.x *= stretch;
		zone.width *= stretch;
	}

	return { points, zones, width: totalWidth * stretch, height: totalHeight };
}

// ─── Layout 2: Roda das Constelações ("constellation" · PoE × FFX) ──────────

function buildConstellationLayout(parsed: ParsedCurriculum) {
	const { byId, roots, groups } = parsed;
	const points = new Map<string, SkillPoint>();
	const wheels: SkillWheel[] = [];
	const rings: SkillRing[] = [];

	const place = (node: SkillNode, x: number, y: number, z: number, color: number) => {
		points.set(node.id, { id: node.id, kind: node.kind, x, y, z, color, radius: radiusForKind(node.kind) });
	};

	// Place domain root(s) at orbital center
	for (const [i, root] of roots.entries()) {
		const a = (i / Math.max(1, roots.length)) * Math.PI * 2;
		const r = roots.length > 1 ? 34 : 0;
		place(root, Math.cos(a) * r, Math.sin(a) * r, 22, 0);
	}

	const weights = groups.map(g => Math.sqrt(Math.max(4, g.totalCount)) + 2.8);
	const totalWeight = weights.reduce((s, w) => s + w, 0) || 1;
	const innerRingR = Math.max(185, 130 + groups.length * 14);
	let maxExtentR = innerRingR + 120;

	let cursorAngle = -Math.PI / 2;
	for (const [color, area] of groups.entries()) {
		const span = (weights[color]! / totalWeight) * Math.PI * 2;
		const padAngle = Math.min(0.06, span * 0.08);
		const startA = cursorAngle + padAngle;
		const endA = cursorAngle + span - padAngle;
		const midA = (startA + endA) / 2;
		const usableSpan = Math.max(0.08, endA - startA);
		cursorAngle += span;

		if (area.id) {
			place(byId.get(area.id)!, Math.cos(midA) * innerRingR, Math.sin(midA) * innerRingR, 16, color);
		}

		// Arrange each unit as a Notable Wheel expanding radially outward without colliding
		let radialCursor = innerRingR + 110;
		const unitCount = area.units.length;
		for (let uIdx = 0; uIdx < unitCount; uIdx++) {
			const unit = area.units[uIdx]!;
			const childCount = unit.children.length;
			const outerRings = Math.max(1, Math.ceil(childCount / 12));
			const wheelBaseR = 28 + Math.min(24, Math.sqrt(Math.max(1, childCount)) * 4.8);
			const wheelOuterR = wheelBaseR + (outerRings - 1) * 19 + 14;

			// Decide whether this wheel can sit side-by-side in an alternating 2-lane zig-zag inside the sector
			const arcWidthAtR = usableSpan * radialCursor;
			const canZigZag = unitCount > 2 && arcWidthAtR >= wheelOuterR * 3.4;
			const laneShift = canZigZag ? (uIdx % 2 === 0 ? -0.25 : 0.25) : 0;
			const unitAngle = midA + usableSpan * laneShift;

			// Advance radial cursor cleanly
			const radialR = radialCursor + wheelOuterR * 0.45;
			const ux = Math.cos(unitAngle) * radialR;
			const uy = Math.sin(unitAngle) * radialR;

			if (unit.id) {
				const heading = byId.get(unit.id)!;
				if (!points.has(heading.id)) place(heading, ux, uy, 10, color);
				wheels.push({ unitId: unit.id, color, cx: ux, cy: uy, radius: wheelOuterR - 6, angle: unitAngle });
			}

			// Place skills along 1..N concentric PoE-style arcs around the Notable wheel
			for (let k = 0; k < childCount; k++) {
				const child = unit.children[k]!;
				const ringIdx = Math.floor(k / 12);
				const idxInRing = k % 12;
				const inRingCount = Math.min(12, childCount - ringIdx * 12);
				const spread = Math.min(Math.PI * 1.56, 0.5 + inRingCount * 0.23);
				const frac = inRingCount > 1 ? idxInRing / (inRingCount - 1) - 0.5 : 0;
				const a = unitAngle + Math.PI + frac * spread;
				const r = wheelBaseR + ringIdx * 19;
				place(child, ux + Math.cos(a) * r, uy + Math.sin(a) * r, child.kind === "topic" ? 7 : 3, color);
			}

			maxExtentR = Math.max(maxExtentR, radialR + wheelOuterR + 18);
			// Step outward: smaller step if zigzagging side-by-side, full diameter if stacked radially
			radialCursor += canZigZag ? Math.max(62, wheelOuterR * 1.05) : Math.max(96, wheelOuterR * 2.08);
		}
	}

	// Concentric structural astrolabe rings
	rings.push({ cx: 0, cy: 0, radius: innerRingR });
	const bandCount = 3;
	for (let b = 1; b <= bandCount; b++) {
		rings.push({ cx: 0, cy: 0, radius: innerRingR + ((maxExtentR - innerRingR) * b) / bandCount });
	}

	ensureUniqueCoordinates(points);
	const { width, height } = normalizeToCanvas(points, 80, { wheels, rings });
	return { points, zones: [] as SkillZone[], wheels, rings, width, height };
}

// ─── Layout 3: Relojoaria Hextech ("hextech" · Interlocking 2.5D Gears) ─────

function buildHextechLayout(parsed: ParsedCurriculum) {
	const { byId, roots, groups, progression } = parsed;
	const points = new Map<string, SkillPoint>();
	const gears: SkillGear[] = [];

	const place = (node: SkillNode, x: number, y: number, z: number, color: number) => {
		points.set(node.id, { id: node.id, kind: node.kind, x, y, z, color, radius: radiusForKind(node.kind) });
	};

	const rootGearR = 92;
	gears.push({
		id: roots[0]?.id ?? "root",
		color: 0,
		cx: 0,
		cy: 0,
		radius: rootGearR,
		teeth: 16,
		direction: 1,
		isRoot: true,
	});
	for (const [i, root] of roots.entries()) {
		const a = (i / Math.max(1, roots.length)) * Math.PI * 2;
		const r = roots.length > 1 ? 26 : 0;
		place(root, Math.cos(a) * r, Math.sin(a) * r, 20, 0);
	}

	const colorByArea = new Map<string, number>();
	for (const [color, g] of groups.entries()) colorByArea.set(g.id, color);

	// Initial radial crown placement for every area gear
	const areaCircles = progression.map((area, idx) => {
		const radius = Math.max(115, 62 + Math.sqrt(Math.max(4, area.totalCount)) * 16.5);
		const ring = progression.length > 7 && idx >= Math.ceil(progression.length * 0.45) ? 1 : 0;
		const inRingCount = ring === 0 ? Math.min(progression.length, Math.ceil(progression.length * 0.45)) : progression.length - Math.ceil(progression.length * 0.45);
		const inRingIdx = ring === 0 ? idx : idx - Math.ceil(progression.length * 0.45);
		const baseDist = ring === 0 ? rootGearR + radius + 54 : rootGearR + radius + 310;
		const angle = -Math.PI / 2 + (inRingIdx / Math.max(1, inRingCount)) * Math.PI * 2 + ring * 0.38;
		return {
			area,
			color: colorByArea.get(area.id) ?? idx,
			x: Math.cos(angle) * baseDist,
			y: Math.sin(angle) * baseDist,
			r: radius,
			dir: (idx % 2 === 0 ? 1 : -1) as 1 | -1,
		};
	});

	// Deterministic circle relaxation so NO two gears ever overlap while staying tightly meshed
	for (let iter = 0; iter < 55; iter++) {
		for (let i = 0; i < areaCircles.length; i++) {
			const a = areaCircles[i]!;
			// Keep clear of central root gear
			const dRoot = Math.hypot(a.x, a.y) || 0.001;
			const minRoot = rootGearR + a.r + 36;
			if (dRoot < minRoot) {
				const push = minRoot - dRoot;
				a.x += (a.x / dRoot) * push;
				a.y += (a.y / dRoot) * push;
			}
			// Gentle pull toward center so the clockwork feels cohesive
			a.x *= 0.992;
			a.y *= 0.992;

			for (let j = i + 1; j < areaCircles.length; j++) {
				const b = areaCircles[j]!;
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const dist = Math.hypot(dx, dy) || 0.001;
				const minDist = a.r + b.r + 42;
				if (dist < minDist) {
					const overlap = (minDist - dist) * 0.52;
					const ux = dx / dist;
					const uy = dy / dist;
					a.x -= ux * overlap;
					a.y -= uy * overlap;
					b.x += ux * overlap;
					b.y += uy * overlap;
				}
			}
		}
	}

	for (const c of areaCircles) {
		const teeth = Math.max(12, Math.min(36, Math.round(c.r / 9.5)));
		gears.push({
			id: c.area.id || `gear-${c.color}`,
			color: c.color,
			cx: c.x,
			cy: c.y,
			radius: c.r,
			teeth,
			direction: c.dir,
		});
		if (c.area.id) {
			place(byId.get(c.area.id)!, c.x, c.y, 16, c.color);
		}

		// Distribute unit valves along 1 or 2 concentric tracks inside the gear
		const units = c.area.units;
		const useTwoRings = units.length > 9;
		const innerUnits = useTwoRings ? Math.floor(units.length * 0.36) : 0;
		const outerUnits = units.length - innerUnits;

		for (let uIdx = 0; uIdx < units.length; uIdx++) {
			const unit = units[uIdx]!;
			const isInner = useTwoRings && uIdx < innerUnits;
			const trackR = isInner ? c.r * 0.34 : c.r * (useTwoRings ? 0.68 : 0.56);
			const slot = isInner ? uIdx : uIdx - innerUnits;
			const count = isInner ? innerUnits : outerUnits;
			const angle = -Math.PI / 2 + (slot / Math.max(1, count)) * Math.PI * 2 + (isInner ? 0.25 : 0);
			const ux = c.x + Math.cos(angle) * trackR;
			const uy = c.y + Math.sin(angle) * trackR;

			if (unit.id) {
				const heading = byId.get(unit.id)!;
				if (!points.has(heading.id)) place(heading, ux, uy, 10, c.color);
			}

			// Arrange unit skills in a clean phyllotaxis cluster clamped inside the gear housing
			const maxInnerR = c.r * 0.89;
			const spreadStep = Math.max(9.5, Math.min(15, c.r / (Math.sqrt(Math.max(4, unit.children.length)) * 3.1)));
			for (let k = 0; k < unit.children.length; k++) {
				const child = unit.children[k]!;
				const a = k * GOLDEN_ANGLE + uIdx * 0.9;
				const r = 13 + Math.sqrt(k + 1) * spreadStep;
				let px = ux + Math.cos(a) * r;
				let py = uy + Math.sin(a) * r;
				const dFromCenter = Math.hypot(px - c.x, py - c.y);
				if (dFromCenter > maxInnerR) {
					const ratio = maxInnerR / dFromCenter;
					px = c.x + (px - c.x) * ratio;
					py = c.y + (py - c.y) * ratio;
				}
				place(child, px, py, child.kind === "topic" ? 6 : 3, c.color);
			}
		}
	}

	ensureUniqueCoordinates(points);
	const { width, height } = normalizeToCanvas(points, 86, { gears });
	return { points, zones: [] as SkillZone[], gears, width, height };
}

// ─── Layout 4: Cidadela Hexagonal ("citadel" · Isometric 2.5D Hex Board) ────

function generateHexSpiral(needed: number): { q: number; r: number }[] {
	const result: { q: number; r: number }[] = [{ q: 0, r: 0 }];
	const dirs = [
		[1, 0],
		[0, 1],
		[-1, 1],
		[-1, 0],
		[0, -1],
		[1, -1],
	] as const;
	let ring = 1;
	while (result.length < needed) {
		let q = -ring;
		let r = ring;
		for (let d = 0; d < 6; d++) {
			for (let step = 0; step < ring; step++) {
				result.push({ q, r });
				q += dirs[d]![0];
				r += dirs[d]![1];
			}
		}
		ring++;
	}
	return result;
}

function buildCitadelLayout(parsed: ParsedCurriculum) {
	const { byId, roots, groups, layers } = parsed;
	const points = new Map<string, SkillPoint>();
	const hexClusters: SkillHexCluster[] = [];

	const HEX_R = 16.5;
	const ISO_SQUASH = 0.72;
	const axialToIso = (q: number, r: number) => ({
		x: HEX_R * SQRT3 * (q + r * 0.5),
		y: HEX_R * 1.5 * r * ISO_SQUASH,
	});

	const colorByArea = new Map<string, number>();
	for (const [color, g] of groups.entries()) colorByArea.set(g.id, color);

	// Measure each area citadel footprint directly from its hex ring count so citadels NEVER overlap
	const maxItems = Math.max(1, ...groups.map(g => g.totalCount + 2));
	const spiral = generateHexSpiral(maxItems);

	const clusterMetrics = new Map<ParsedArea, { rx: number; ry: number; radius: number }>();
	for (const area of groups) {
		const rings = Math.max(1, Math.ceil((-3 + Math.sqrt(9 + 12 * Math.max(1, area.totalCount))) / 6));
		const rx = (rings + 1.35) * HEX_R * SQRT3;
		const ry = (rings + 1.35) * HEX_R * 1.5 * ISO_SQUASH + 16;
		clusterMetrics.set(area, { rx, ry, radius: Math.max(rx, ry) });
	}

	const CLUSTER_GAP_X = 76;
	const CLUSTER_GAP_Y = 72;

	// Stack strata from bottom (foundations) to top (advanced crown)
	const layerSpecs = layers.map(layer => {
		const totalW = layer.reduce((sum, a) => sum + clusterMetrics.get(a)!.rx * 2, 0) + Math.max(0, layer.length - 1) * CLUSTER_GAP_X;
		const maxH = Math.max(...layer.map(a => clusterMetrics.get(a)!.ry * 2));
		return { layer, totalW, maxH };
	});

	let yCursor = 0;
	for (let tierIdx = 0; tierIdx < layerSpecs.length; tierIdx++) {
		const { layer, totalW, maxH } = layerSpecs[tierIdx]!;
		const cy = yCursor - maxH * 0.5;
		let xCursor = -totalW * 0.5;
		for (const area of layer) {
			const m = clusterMetrics.get(area)!;
			const cx = xCursor + m.rx;
			const color = colorByArea.get(area.id) ?? 0;
			const baseZ = tierIdx * 18 + 8;

			hexClusters.push({ areaId: area.id, color, cx, cy, radius: m.radius, tier: tierIdx });

			// Area keystone sits in the center hex (slot 0)
			let slot = 0;
			if (area.id) {
				const areaNode = byId.get(area.id)!;
				points.set(areaNode.id, {
					id: areaNode.id,
					kind: areaNode.kind,
					x: cx,
					y: cy,
					z: baseZ + 22,
					color,
					radius: radiusForKind(areaNode.kind),
				});
				slot = 1;
			}

			// Units + skills pack contiguously along the axial hex spiral (0 collisions!)
			for (const unit of area.units) {
				if (unit.id) {
					const heading = byId.get(unit.id)!;
					if (!points.has(heading.id)) {
						const off = spiral[slot++]!;
						const p = axialToIso(off.q, off.r);
						points.set(heading.id, {
							id: heading.id,
							kind: heading.kind,
							x: cx + p.x,
							y: cy + p.y,
							z: baseZ + 12,
							color,
							radius: radiusForKind(heading.kind),
						});
					}
				}
				for (const child of unit.children) {
					const off = spiral[slot++]!;
					const p = axialToIso(off.q, off.r);
					points.set(child.id, {
						id: child.id,
						kind: child.kind,
						x: cx + p.x,
						y: cy + p.y,
						z: baseZ + (child.kind === "topic" ? 7 : 3),
						color,
						radius: radiusForKind(child.kind),
					});
				}
			}
			xCursor += m.rx * 2 + CLUSTER_GAP_X;
		}
		yCursor -= maxH + CLUSTER_GAP_Y;
	}

	// Place domain root pedestal centered below the foundation tier
	const rootSpan = Math.min(roots.length, 8) * (HEX_R * 2.4);
	for (const [i, root] of roots.entries()) {
		const rx = -rootSpan * 0.5 + HEX_R * 1.2 + (i % 8) * (HEX_R * 2.4);
		const ry = 62 + Math.floor(i / 8) * (HEX_R * 2);
		points.set(root.id, { id: root.id, kind: root.kind, x: rx, y: ry, z: 18, color: 0, radius: radiusForKind(root.kind) });
	}

	ensureUniqueCoordinates(points);
	const { width, height } = normalizeToCanvas(points, 86, { hexClusters });
	return { points, zones: [] as SkillZone[], hexClusters, hexTileRadius: HEX_R, width, height };
}

// ─── Layout 5: Trilha Nítida ("clarity" · Clean Editorial Swimlane Reading) ─

function buildClarityLayout(parsed: ParsedCurriculum) {
	const { byId, roots, groups, progression } = parsed;
	const points = new Map<string, SkillPoint>();
	const zones: SkillZone[] = [];
	const lanes: SkillLane[] = [];

	const colorByArea = new Map<string, number>();
	for (const [color, g] of groups.entries()) colorByArea.set(g.id, color);

	// Generous spacing designed explicitly for crisp labels & effortless scanning
	const NODE_STEP_X = 64;
	const NODE_STEP_Y = 58;
	const COLS_PER_UNIT = 5;
	const UNIT_PAD_X = 24;
	const UNIT_HEAD_H = 44;
	const UNIT_PAD_B = 26;
	const UNIT_GAP_X = 28;
	const UNIT_GAP_Y = 24;
	const HEADER_W = 228;
	const LANE_PAD = 22;
	const LANE_GAP = 28;
	const MAX_ROW_W = 1480;

	const place = (node: SkillNode, x: number, y: number, color: number) => {
		points.set(node.id, { id: node.id, kind: node.kind, x, y, color, radius: radiusForKind(node.kind) });
	};

	let yCursor = PADDING + 74;

	// Domain header banner at top-left (natural top-to-bottom, left-to-right reading flow)
	for (const [i, root] of roots.entries()) {
		place(root, PADDING + 28 + i * 48, PADDING + 28, 0);
	}

	let maxLaneRight = 640;

	for (const area of progression) {
		const color = colorByArea.get(area.id) ?? 0;

		// Measure every unit card in this area
		const unitBoxes = area.units.map(unit => {
			const count = unit.children.length;
			const cols = Math.max(1, Math.min(COLS_PER_UNIT, count));
			const rows = Math.max(1, Math.ceil(count / COLS_PER_UNIT));
			const width = Math.max(210, UNIT_PAD_X * 2 + (cols - 1) * NODE_STEP_X + 24);
			const height = UNIT_HEAD_H + (rows - 1) * NODE_STEP_Y + UNIT_PAD_B + 14;
			return { unit, width, height, cols, rows };
		});

		// Wrap unit cards cleanly into 1..N horizontal rows inside the area's swimlane
		const rows: { items: typeof unitBoxes; width: number; height: number }[] = [];
		let curRow: typeof unitBoxes = [];
		let rowW = 0;
		let rowH = 0;
		for (const ub of unitBoxes) {
			if (curRow.length > 0 && rowW + UNIT_GAP_X + ub.width > MAX_ROW_W) {
				rows.push({ items: curRow, width: rowW, height: rowH });
				curRow = [];
				rowW = 0;
				rowH = 0;
			}
			rowW = curRow.length > 0 ? rowW + UNIT_GAP_X + ub.width : ub.width;
			rowH = Math.max(rowH, ub.height);
			curRow.push(ub);
		}
		if (curRow.length > 0) rows.push({ items: curRow, width: rowW, height: rowH });

		const contentW = Math.max(240, ...rows.map(r => r.width));
		const contentH = rows.reduce((sum, r) => sum + r.height, 0) + Math.max(0, rows.length - 1) * UNIT_GAP_Y;
		const laneW = HEADER_W + LANE_PAD * 2 + contentW;
		const laneH = Math.max(120, contentH + LANE_PAD * 2);
		const laneX = PADDING;
		const laneY = yCursor;

		if (area.id) {
			lanes.push({ areaId: area.id, color, x: laneX, y: laneY, width: laneW, height: laneH, headerWidth: HEADER_W });
			zones.push({ x: laneX, y: laneY, width: laneW, height: laneH, id: area.id, color, heading: "area" });
			place(byId.get(area.id)!, laneX + 26, laneY + 34, color);
		}

		let innerY = laneY + LANE_PAD;
		for (const row of rows) {
			let innerX = laneX + HEADER_W + LANE_PAD;
			for (const ub of row.items) {
				const ux = innerX;
				const uy = innerY;
				if (ub.unit.id) {
					zones.push({ x: ux, y: uy, width: ub.width, height: row.height, id: ub.unit.id, color, heading: "unit" });
					const heading = byId.get(ub.unit.id)!;
					if (!points.has(heading.id)) place(heading, ux + 20, uy + 20, color);
				}
				for (const [k, child] of ub.unit.children.entries()) {
					const rIdx = Math.floor(k / COLS_PER_UNIT);
					const cIdx = k % COLS_PER_UNIT;
					place(child, ux + UNIT_PAD_X + cIdx * NODE_STEP_X, uy + UNIT_HEAD_H + rIdx * NODE_STEP_Y, color);
				}
				innerX += ub.width + UNIT_GAP_X;
			}
			innerY += row.height + UNIT_GAP_Y;
		}

		maxLaneRight = Math.max(maxLaneRight, laneX + laneW);
		yCursor += laneH + LANE_GAP;
	}

	ensureUniqueCoordinates(points);
	return {
		points,
		zones,
		lanes,
		width: maxLaneRight + PADDING,
		height: Math.max(360, yCursor + PADDING),
	};
}

// ─── Unified Entry Point ────────────────────────────────────────────────────

function computeSkillMapLayout(input: readonly SkillNode[], style: SkillMapStyle) {
	const parsed = parseCurriculum(input);
	const { nodes, byId, prerequisites, roots, areaByNode, layers } = parsed;

	let points: Map<string, SkillPoint>;
	let zones: SkillZone[] = [];
	let wheels: SkillWheel[] = [];
	let rings: SkillRing[] = [];
	let gears: SkillGear[] = [];
	let hexClusters: SkillHexCluster[] = [];
	let hexTileRadius = 16.5;
	let lanes: SkillLane[] = [];
	let width = 800;
	let height = 600;

	switch (style) {
		case "constellation": {
			const built = buildConstellationLayout(parsed);
			points = built.points;
			zones = built.zones;
			wheels = built.wheels;
			rings = built.rings;
			width = built.width;
			height = built.height;
			break;
		}
		case "hextech": {
			const built = buildHextechLayout(parsed);
			points = built.points;
			zones = built.zones;
			gears = built.gears;
			width = built.width;
			height = built.height;
			break;
		}
		case "citadel": {
			const built = buildCitadelLayout(parsed);
			points = built.points;
			zones = built.zones;
			hexClusters = built.hexClusters;
			hexTileRadius = built.hexTileRadius;
			width = built.width;
			height = built.height;
			break;
		}
		case "clarity": {
			const built = buildClarityLayout(parsed);
			points = built.points;
			zones = built.zones;
			lanes = built.lanes;
			width = built.width;
			height = built.height;
			break;
		}
		case "atlas":
		default: {
			const built = buildAtlasLayout(parsed);
			points = built.points;
			zones = built.zones;
			width = built.width;
			height = built.height;
			break;
		}
	}

	const edges: SkillEdge[] = [];
	const areaSources = new Map<string, Map<string, number>>();
	const regionSources = new Map<string, Map<string, number>>();
	const related = new Map<string, Set<string>>();

	function connect(source: string, target: string, kind: SkillEdge["kind"]) {
		const from = points.get(source);
		const to = points.get(target);
		if (!from || !to || from === to) return;
		const sourceRegion = byId.get(source)?.region;
		const targetRegion = byId.get(target)?.region;
		edges.push({ from, to, kind, crossesRegion: !sourceRegion || sourceRegion !== targetRegion });
	}
	function registerIncoming(sourcesByTarget: Map<string, Map<string, number>>, target: string | null | undefined, entryAreas: Set<string>) {
		if (!target || !entryAreas.size) return;
		const sources = sourcesByTarget.get(target) ?? new Map<string, number>();
		for (const source of entryAreas) sources.set(source, (sources.get(source) ?? 0) + 1);
		sourcesByTarget.set(target, sources);
	}

	for (const node of nodes) {
		if (node.parent) connect(node.parent, node.id, "hierarchy");
		const entryAreas = new Set<string>();
		const entryRegions = new Set<string>();
		const targetArea = areaByNode.get(node.id);
		for (const id of prerequisites.get(node.id) ?? []) {
			connect(id, node.id, "prerequisite");
			const sourceArea = areaByNode.get(id);
			if (node.leaf && targetArea && sourceArea && sourceArea !== targetArea) entryAreas.add(sourceArea);
			const sourceRegion = byId.get(id)?.region;
			if (node.leaf && sourceRegion && node.region && sourceRegion !== node.region) entryRegions.add(sourceRegion);
		}
		registerIncoming(areaSources, targetArea, entryAreas);
		registerIncoming(regionSources, node.region, entryRegions);
		for (const id of new Set(node.related)) {
			if (related.get(id)?.has(node.id)) continue;
			const neighbors = related.get(node.id) ?? new Set();
			neighbors.add(id);
			related.set(node.id, neighbors);
			connect(node.id, id, "related");
		}
	}

	const overviewLinks: OverviewLink[] = [];
	const mainRoot = roots[0] ? points.get(roots[0].id) : undefined;
	if (mainRoot) {
		const initialAreas = style === "constellation" || style === "hextech" ? parsed.groups : (layers[0] ?? []);
		for (const area of initialAreas) {
			const pt = area.id ? points.get(area.id) : undefined;
			if (pt) overviewLinks.push({ from: mainRoot, to: pt, count: 10 });
		}
	}

	const sourcesByTarget = areaSources.size ? areaSources : regionSources;
	for (const [target, sources] of sourcesByTarget) {
		const entries = [...sources].sort(([left, a], [right, b]) => b - a || compareNodes(byId.get(left)!, byId.get(right)!));
		const strongest = entries[0]![1];
		for (const [source, count] of entries.slice(0, 2)) {
			if (count === strongest || count >= Math.max(3, strongest * 0.55)) {
				overviewLinks.push({ from: points.get(source)!, to: points.get(target)!, count });
			}
		}
	}

	const edgesByKind: Record<SkillEdge["kind"], SkillEdge[]> = {
		hierarchy: [],
		prerequisite: [],
		related: [],
	};
	const edgesByNode = new Map<string, SkillEdge[]>();
	for (const edge of edges) {
		edgesByKind[edge.kind].push(edge);
		let fromList = edgesByNode.get(edge.from.id);
		if (!fromList) {
			fromList = [];
			edgesByNode.set(edge.from.id, fromList);
		}
		fromList.push(edge);
		let toList = edgesByNode.get(edge.to.id);
		if (!toList) {
			toList = [];
			edgesByNode.set(edge.to.id, toList);
		}
		toList.push(edge);
	}

	const zoneById = new Map<string, SkillZone>();
	for (const zone of zones) zoneById.set(zone.id, zone);

	const cellSize = 80;
	const cells = new Map<string, string[]>();
	const pointsSortedByY: SkillPoint[] = [];
	const landmarks: SkillPoint[] = [];
	for (const point of points.values()) {
		pointsSortedByY.push(point);
		if (point.kind !== "atom") landmarks.push(point);
		const key = `${Math.floor(point.x / cellSize)},${Math.floor(point.y / cellSize)}`;
		let bucket = cells.get(key);
		if (!bucket) {
			bucket = [];
			cells.set(key, bucket);
		}
		bucket.push(point.id);
	}
	pointsSortedByY.sort((a, b) => a.y - b.y || (a.z ?? 0) - (b.z ?? 0));
	const spatialGrid = { cellSize, cells };

	const builtLayout = {
		style,
		points,
		pointsSortedByY,
		landmarks,
		edges,
		edgesByKind,
		edgesByNode,
		overviewLinks,
		zones,
		zoneById,
		wheels,
		rings,
		gears,
		hexClusters,
		hexTileRadius,
		lanes,
		spatialGrid,
		width,
		height,
	};
	return builtLayout;
}

export type SkillLayout = ReturnType<typeof computeSkillMapLayout>;

const layoutCache = new WeakMap<readonly SkillNode[], Map<SkillMapStyle, SkillLayout>>();

export function layoutSkillMap(input: readonly SkillNode[], style: SkillMapStyle = "atlas"): SkillLayout {
	let mapForInput = layoutCache.get(input);
	const cached = mapForInput?.get(style);
	if (cached) return cached;
	const builtLayout = computeSkillMapLayout(input, style);
	if (!mapForInput) {
		mapForInput = new Map();
		layoutCache.set(input, mapForInput);
	}
	mapForInput.set(style, builtLayout);
	return builtLayout;
}
