import type { SkillNode } from "./map.ts";

export interface SkillPoint {
	id: string;
	x: number;
	y: number;
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
	// 4 balanced strata: solid foundation base → wide mid canopy → crown at the top
	const base = Math.max(3, Math.round(count * 0.2));
	const crown = Math.max(3, Math.round(count * 0.22));
	const remaining = count - base - crown;
	const lowerMid = Math.floor(remaining / 2);
	const upperMid = remaining - lowerMid;
	return [base, lowerMid, upperMid, crown];
}

function compareNodes(a: SkillNode, b: SkillNode) {
	return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function layoutSkillMap(input: readonly SkillNode[]) {
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

	const groups = [...areas].sort(([a], [b]) => a && b ? compareNodes(byId.get(a)!, byId.get(b)!) : Number(Boolean(b)) - Number(Boolean(a))).map(([id, regions]) => {
		const units = [...regions].sort(([a], [b]) => a && b ? compareNodes(byId.get(a)!, byId.get(b)!) : Number(Boolean(b)) - Number(Boolean(a))).map(([region, members]) => {
			const children = members.filter(node => node.id !== region)
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

			// Total grid rows inside this unit; climb upward from bottom row (row 0) to top row
			const totalRows = runs.reduce((sum, run) => sum + Math.ceil(run.length / 6), 0);
			const positions = new Map<string, { x: number; y: number }>();
			let row = 0;
			let columns = 1;
			for (const run of runs) {
				const ordered = run.sort((a, b) => Number(b.kind === "topic") - Number(a.kind === "topic") || (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0) || compareNodes(a, b));
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
		}).sort((a, b) => a.depth - b.depth);
		const packed = packBottomUp(units, 2.05);
		const depths = units.flatMap(u => u.children.filter(n => n.leaf).map(n => rank.get(n.id) ?? 0)).sort((a, b) => a - b);
		const order = id ? (byId.get(id)?.order ?? 0) : 0;
		return {
			id,
			units,
			packed,
			order,
			depth: depths[Math.floor(depths.length / 2)] ?? 0,
			width: Math.max(210, packed.width + PADDING * 2),
			height: packed.height + 78,
		};
	});

	// Order areas from foundations (bottom) to advanced/research (top) using prerequisite depth + authored order
	const maxDepth = Math.max(1, ...groups.map(g => g.depth));
	const maxOrder = Math.max(1, ...groups.map(g => g.order));
	const progression = [...groups].sort((a, b) => {
		const scoreA = (a.depth / maxDepth) * 0.55 + (a.order / maxOrder) * 0.45;
		const scoreB = (b.depth / maxDepth) * 0.55 + (b.order / maxOrder) * 0.45;
		return scoreA - scoreB || a.order - b.order;
	});

	const sizes = tierSizes(progression.length);
	const layers: typeof groups[] = [];
	let cursor = 0;
	for (const size of sizes) {
		const slice = progression.slice(cursor, cursor + size);
		if (slice.length) layers.push(slice);
		cursor += size;
	}

	// Compute centered horizontal strata stacked bottom-to-top (layer 0 = bottom foundation, last layer = top crown)
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

	const boxes = new Map<typeof groups[number], Box>();
	let yBottom = topMargin + canopyHeight;
	for (const { layer, width: lw, height: lh } of layerMetrics) {
		const yTop = yBottom - lh;
		let x = PADDING + (canopyWidth - lw) / 2;
		for (const group of layer) {
			// Bottom-align boxes inside each stratum so the trunk flows upward cleanly
			boxes.set(group, { x, y: yTop + (lh - group.height), width: group.width, height: group.height });
			x += group.width + GAP * 1.4;
		}
		yBottom = yTop - LAYER_GAP;
	}

	const points = new Map<string, SkillPoint>();
	const zones: SkillZone[] = [];
	function place(node: SkillNode, x: number, y: number, color: number) {
		const radius = { domain: 13, area: 10, unit: 8, topic: 6.5, atom: 5 }[node.kind];
		points.set(node.id, { id: node.id, kind: node.kind, x, y, color, radius });
	}

	// Place the domain root(s) centered at the BASE of the tree (roots → trunk → canopy)
	const rootY = topMargin + canopyHeight + 38;
	const rootSpan = Math.min(roots.length, 10) * STEP;
	for (const [i, root] of roots.entries()) {
		const rx = totalWidth / 2 - (rootSpan - STEP) / 2 + (i % 10) * STEP;
		const ry = rootY + Math.floor(i / 10) * STEP;
		place(root, rx, ry, 0);
	}

	for (const [color, area] of groups.entries()) {
		const box = boxes.get(area)!;
		const x = box.x;
		const y = box.y;
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

	// Gentle horizontal balance so wide screens frame the whole tree cleanly without squishing
	const stretch = Math.max(1, Math.min(1.4, 1.35 * totalHeight / totalWidth));
	for (const point of points.values()) point.x *= stretch;
	for (const zone of zones) {
		zone.x *= stretch;
		zone.width *= stretch;
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
	// Connect domain root at the base upward into each foundation-layer area like tree roots/trunk
	const mainRoot = roots[0] ? points.get(roots[0].id) : undefined;
	if (mainRoot && layers[0]) {
		for (const area of layers[0]) {
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

	return { points, edges, overviewLinks, zones, width: totalWidth * stretch, height: totalHeight };
}

export type SkillLayout = ReturnType<typeof layoutSkillMap>;
