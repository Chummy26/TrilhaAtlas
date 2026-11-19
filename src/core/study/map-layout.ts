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

const STEP = 38;

const GAP = 26;
const PADDING = 22;

function pack(sizes: { width: number; height: number }[], ratio: number) {
	const area = sizes.reduce((sum, size) => sum + (size.width + GAP) * (size.height + GAP), 0);
	const limit = Math.max(Math.sqrt(area * ratio), ...sizes.map(size => size.width));
	let x = 0;
	let y = 0;
	let rowHeight = 0;
	let width = 0;
	const boxes: Box[] = [];
	for (const size of sizes) {
		if (x > 0 && x + size.width > limit) {
			y += rowHeight + GAP;
			x = 0;
			rowHeight = 0;
		}
		boxes.push({ ...size, x, y });
		width = Math.max(width, x + size.width);
		rowHeight = Math.max(rowHeight, size.height);
		x += size.width + GAP;
	}
	return { boxes, width, height: y + rowHeight };
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
			const positions = new Map<string, { x: number; y: number }>();
			let row = 0;
			let columns = 1;
			for (const run of runs) {
				const ordered = run.sort((a, b) => Number(b.kind === "topic") - Number(a.kind === "topic") || (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0) || compareNodes(a,b));
				for (const [j, n] of ordered.entries()) {
					const turn = Math.floor(j / 6);
					const col = turn % 2 === 0 ? j % 6 : 5 - j % 6;
					positions.set(n.id, { x: col * STEP, y: (row + turn) * STEP + Math.sin(col * Math.PI / 3) * STEP * 0.2 });
				}
				row += Math.ceil(run.length / 6);
				columns = Math.max(columns, Math.min(run.length, 6));
			}
			const depths = children.map(n => rank.get(n.id) ?? 0);
			return { id: region, children, positions, depth: Math.min(...depths),
				width: Math.max(145, (columns - 1) * STEP + PADDING * 2), height: Math.max(85, row * STEP + 44) };
		}).sort((a, b) => a.depth - b.depth);
		const packed = pack(units, 1.65);
		const depths = units.flatMap(u => u.children.filter(n => n.leaf).map(n => rank.get(n.id) ?? 0)).sort((a,b) => a-b);
		return { id, units, packed, depth: depths[Math.floor(depths.length / 2)] ?? 0,
			width: Math.max(200, packed.width + PADDING * 2), height: packed.height + 78 };
	});
	// Place regions of similar prerequisite depth together. Fold each column vertically
	// so the whole domain still fits at overview zoom.
	const columnCount = Math.max(1, Math.ceil(Math.sqrt(groups.length)));
	const perColumn = Math.ceil(groups.length / columnCount);
	let left = 0;
	let tallest = 0;
	const boxes: Box[] = [];
	for (let start = 0; start < groups.length; start += perColumn) {
		let y = 0;
		const column = groups.slice(start, start + perColumn);
		// Preserve the authored foundation at the top of its column, then cluster by dependency depth.
		const ordered = [column[0]!, ...column.slice(1).sort((a,b) => a.depth - b.depth)];
		for (const group of ordered) {
			boxes[groups.indexOf(group)] = { x: left, y, width: group.width, height: group.height };
			y += group.height + GAP;
		}
		tallest = Math.max(tallest, y - GAP);
		left += Math.max(...column.map(g => g.width)) + GAP * 2;
	}
	const packed = { boxes, width: Math.max(0, left - GAP * 2), height: tallest };
	const top = 92 + Math.floor(Math.max(0, roots.length - 1) / 10) * STEP;
	const width = Math.max(440, packed.width + PADDING * 2);
	const height = Math.max(200, packed.height + top + PADDING);
	const points = new Map<string, SkillPoint>();
	const zones: SkillZone[] = [];
	function place(node: SkillNode, x: number, y: number, color: number) {
		const radius = { domain: 12, area: 10, unit: 8, topic: 6.5, atom: 5 }[node.kind];
		points.set(node.id, { id: node.id, kind: node.kind, x, y, color, radius });
	}
	for (const [i, root] of roots.entries()) place(root, PADDING * 2 + (i % 10) * STEP, 44 + Math.floor(i / 10) * STEP, 0);
	for (const [color, area] of groups.entries()) {
		const box = packed.boxes[color]!;
		const x = box.x + PADDING;
		const y = box.y + top;
		if (area.id) {
			zones.push({ ...box, x, y, id: area.id, color, heading: "area" });
			place(byId.get(area.id)!, x + PADDING, y + 27, color);
		}
		for (const [i, unit] of area.units.entries()) {
			const inner = area.packed.boxes[i]!;
			const left = x + PADDING + inner.x;
			const upper = y + 55 + inner.y;
			if (unit.id) {
				zones.push({ ...inner, x: left, y: upper, id: unit.id, color, heading: "unit" });
				const heading = byId.get(unit.id)!;
				if (!points.has(heading.id)) place(heading, left + PADDING, upper + 16, color);
			}
			for (const node of unit.children) {
				const offset = unit.positions.get(node.id)!;
				place(node, left + PADDING + offset.x, upper + 50 + offset.y, color);
			}
		}
	}

	// Make room for regional titles in the overview while keeping coordinates
	// independent of screen size, zoom and learner state.
	const stretch = Math.max(1, Math.min(1.7, 1.55 * height / width));
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
	return { points, edges, overviewLinks, zones, width: width * stretch, height };
}

export type SkillLayout = ReturnType<typeof layoutSkillMap>;
