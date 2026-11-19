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
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
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
			const radius = STEP * 0.58 * Math.sqrt(children.length);
			const diameter = Math.max(88, 2 * radius + 2 * PADDING);
			return { id: region, children, width: diameter, height: diameter };
		});
		const packed = pack(units, 1.8);
		return { id, units, packed, width: Math.max(170, packed.width + PADDING * 2), height: packed.height + 78 };
	});
	const packed = pack(groups, 2.5);
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
				if (!points.has(heading.id)) place(heading, left + inner.width / 2, upper + inner.height / 2, color);
			}
			for (const [index, node] of unit.children.entries()) {
				const angle = index * GOLDEN_ANGLE + i * GOLDEN_ANGLE;
				const distance = STEP * 0.58 * Math.sqrt(index + 1);
				place(node, left + inner.width / 2 + Math.cos(angle) * distance, upper + inner.height / 2 + Math.sin(angle) * distance, color);
			}
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
	return { points, edges, overviewLinks, zones, width, height };
}

export type SkillLayout = ReturnType<typeof layoutSkillMap>;
