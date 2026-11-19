/**
 * Region reading plan: a "spine book" per region + weighted greedy set cover
 * for the gaps (SÍNTESE §2.8 "Livro-espinha por região: escolhido por set
 * cover ponderado"; r6 §12.3).
 *
 * 1. Region R = nodes to study in the coming weeks, weights
 *    w(n) = estMinutes(n)·(1 − mastery(n))  (computed by the caller).
 * 2. For each book b:  C(b) = Σ_{n∈R} w(n)·max_{s∈b} cov(n,s).
 *    spineScore(b) = C(b)/W + 0,10·continuity + 0,05·levelFit − 0,05·pagesNorm
 *    - continuity: fraction of consecutive pairs (in book order) among the
 *      distinct best sections of the primary-covered nodes (gap ≤ 1);
 *    - levelFit: exp(−Δ²/2), Δ = |level(b) − level(R)| (0,5 when unknown);
 *    - pagesNorm: pages the region needs from b / max over books (the "λ·custo"
 *      with λ small). r6 gives no numbers for these bonuses: the values above
 *      are the simplest that keep coverage dominant; they are parameters.
 * 3. Gaps: nodes whose best spine coverage is < 0,6 ("primary" threshold)
 *    are covered by GREEDY weighted set cover over the other books' sections
 *    and long videos, maximizing gain/cost, until 90% of W is covered or no
 *    set adds coverage (classic ln-n approximation).
 * 4. Kendall τ between the graph's topological order and the spine's page
 *    order: τ < 0,5 → warning "o livro apresenta B antes de A; o app segue o
 *    grafo" (the reading order is ALWAYS the graph's). Nodes taught in the
 *    same section are ties and count neither way: τ over the comparable
 *    pairs, (C − D)/(C + D), i.e. Goodman–Kruskal γ (= τ without ties).
 *
 * Pure: browser-safe.
 */

export interface RegionNode {
	nodeId: string;
	/** estMinutes·(1 − mastery); ≤ 0 means nothing left to study. */
	weight: number;
}

export interface CoverSection {
	sectionId: string;
	/** Position in the book (pre-order). */
	order: number;
	pages?: number;
	/** cov(n, s) ∈ [0,1] per node id. */
	coverage: Readonly<Record<string, number>>;
}

export interface BookCandidate {
	bookId: string;
	/** Book level on the node scale, when known. */
	level?: number;
	sections: readonly CoverSection[];
}

/** A gap filler: a book section or a long video segment. */
export interface CoverSet {
	id: string;
	resourceId: string;
	/** Cost in the same unit across sets (pages, or minutes/3 for videos). Must be > 0. */
	cost: number;
	coverage: Readonly<Record<string, number>>;
}

export interface RegionPlanOptions {
	/** cov ≥ this makes a section "primary" for a node (r6 §10.5 step 4). */
	primaryThreshold?: number;
	/** Stop when this fraction of W is covered (r6 §12.3: 90%). */
	targetFraction?: number;
	continuityBonus?: number;
	levelBonus?: number;
	costLambda?: number;
	/** Mean level of the region (node scale). */
	regionLevel?: number;
	/** Topological order of the region's nodes (graph order). */
	topoOrder?: readonly string[];
}

export interface SpineEvaluation {
	bookId: string;
	/** Σ w·max cov. */
	coverageWeight: number;
	/** Σ w over nodes with max cov ≥ threshold. */
	primaryWeight: number;
	continuity: number;
	levelFit: number;
	pagesNeeded: number;
	score: number;
	/** Best section per node (only nodes with cov > 0). */
	best: Record<string, { sectionId: string; order: number; cov: number }>;
}

export interface ReadingAssignment {
	nodeId: string;
	resourceId: string;
	/** Section id (spine) or CoverSet id (supplement). */
	partId: string;
	cov: number;
	source: "spine" | "supplement";
}

export interface RegionPlan {
	spine: SpineEvaluation | null;
	supplements: CoverSet[];
	assignments: ReadingAssignment[];
	coveredWeight: number;
	totalWeight: number;
	coveredFraction: number;
	uncovered: string[];
	/** Kendall τ (graph order vs spine order), when computable. */
	orderAgreement?: number;
	warnings: string[];
}

const DEFAULTS = {
	primaryThreshold: 0.6,
	targetFraction: 0.9,
	continuityBonus: 0.1,
	levelBonus: 0.05,
	costLambda: 0.05,
} as const;

function positiveWeight(n: RegionNode): number {
	return Number.isFinite(n.weight) && n.weight > 0 ? n.weight : 0;
}

function clampCov(x: number | undefined): number {
	if (x === undefined || !Number.isFinite(x)) return 0;
	return x < 0 ? 0 : x > 1 ? 1 : x;
}

function bestSections(book: BookCandidate, nodes: readonly RegionNode[]): SpineEvaluation["best"] {
	const best: SpineEvaluation["best"] = {};
	for (const n of nodes) {
		for (const s of book.sections) {
			const cov = clampCov(s.coverage[n.nodeId]);
			const cur = best[n.nodeId];
			if (cov > 0 && (!cur || cov > cur.cov || (cov === cur.cov && s.order < cur.order))) {
				best[n.nodeId] = { sectionId: s.sectionId, order: s.order, cov };
			}
		}
	}
	return best;
}

function continuityOf(orders: number[]): number {
	const distinct = [...new Set(orders)].sort((a, b) => a - b);
	if (distinct.length === 0) return 0;
	if (distinct.length === 1) return 1;
	let adjacent = 0;
	for (let i = 1; i < distinct.length; i++) if (distinct[i]! - distinct[i - 1]! <= 1) adjacent++;
	return adjacent / (distinct.length - 1);
}

/** Evaluate every book as a spine candidate (unsorted, input order). */
export function evaluateSpines(books: readonly BookCandidate[], nodes: readonly RegionNode[], options: RegionPlanOptions = {}): SpineEvaluation[] {
	const o = { ...DEFAULTS, ...options };
	const W = nodes.reduce((acc, n) => acc + positiveWeight(n), 0);
	const partial = books.map((book) => {
		const best = bestSections(book, nodes);
		let coverageWeight = 0;
		let primaryWeight = 0;
		const primaryOrders: number[] = [];
		const usedSections = new Set<string>();
		for (const n of nodes) {
			const b = best[n.nodeId];
			if (!b) continue;
			const w = positiveWeight(n);
			coverageWeight += w * b.cov;
			if (b.cov >= o.primaryThreshold) {
				primaryWeight += w;
				primaryOrders.push(b.order);
				usedSections.add(b.sectionId);
			}
		}
		const pagesNeeded = book.sections.filter((s) => usedSections.has(s.sectionId)).reduce((acc, s) => acc + (s.pages ?? 1), 0);
		const levelFit = book.level !== undefined && o.regionLevel !== undefined ? Math.exp(-((book.level - o.regionLevel) ** 2) / 2) : 0.5;
		return { bookId: book.bookId, coverageWeight, primaryWeight, continuity: continuityOf(primaryOrders), levelFit, pagesNeeded, best };
	});
	const maxPages = Math.max(1, ...partial.map((p) => p.pagesNeeded));
	return partial.map((p) => ({
		...p,
		score: (W > 0 ? p.coverageWeight / W : 0) + o.continuityBonus * p.continuity + o.levelBonus * p.levelFit - o.costLambda * (p.pagesNeeded / maxPages),
	}));
}

/** The spine: best spineScore among books that cover anything (ties → input order). */
export function chooseSpine(books: readonly BookCandidate[], nodes: readonly RegionNode[], options: RegionPlanOptions = {}): SpineEvaluation | null {
	let best: SpineEvaluation | null = null;
	for (const e of evaluateSpines(books, nodes, options)) {
		if (e.coverageWeight <= 0) continue;
		if (!best || e.score > best.score) best = e;
	}
	return best;
}

export interface SetCoverResult {
	chosen: CoverSet[];
	covered: Set<string>;
	coveredWeight: number;
	totalWeight: number;
}

/**
 * Weighted greedy set cover. A node counts as covered when some chosen set has
 * cov ≥ threshold. Each step takes the set maximizing (newly covered weight) /
 * cost; stops at `targetFraction`·W or when no set adds coverage.
 */
export function greedySetCover(
	nodes: readonly RegionNode[],
	sets: readonly CoverSet[],
	options: { threshold?: number; targetFraction?: number; alreadyCovered?: Iterable<string> } = {},
): SetCoverResult {
	const threshold = options.threshold ?? DEFAULTS.primaryThreshold;
	const target = options.targetFraction ?? DEFAULTS.targetFraction;
	const weight = new Map(nodes.map((n) => [n.nodeId, positiveWeight(n)]));
	const totalWeight = [...weight.values()].reduce((a, b) => a + b, 0);
	const covered = new Set<string>([...(options.alreadyCovered ?? [])].filter((id) => weight.has(id)));
	let coveredWeight = [...covered].reduce((acc, id) => acc + (weight.get(id) ?? 0), 0);
	const chosen: CoverSet[] = [];
	for (const s of sets) if (!(Number.isFinite(s.cost) && s.cost > 0)) throw new Error(`greedySetCover: custo inválido no conjunto ${s.id} (${s.cost})`);
	const pool = [...sets];
	while (totalWeight > 0 && coveredWeight < target * totalWeight - 1e-12) {
		let bestIdx = -1;
		let bestRatio = 0;
		let bestGain = 0;
		for (let i = 0; i < pool.length; i++) {
			const s = pool[i]!;
			let gain = 0;
			for (const [nodeId, cov] of Object.entries(s.coverage)) {
				if (covered.has(nodeId) || clampCov(cov) < threshold) continue;
				gain += weight.get(nodeId) ?? 0;
			}
			const ratio = gain / s.cost;
			if (gain > 0 && ratio > bestRatio) {
				bestRatio = ratio;
				bestIdx = i;
				bestGain = gain;
			}
		}
		if (bestIdx < 0) break;
		const [picked] = pool.splice(bestIdx, 1);
		if (!picked) break;
		chosen.push(picked);
		for (const [nodeId, cov] of Object.entries(picked.coverage)) {
			if (!covered.has(nodeId) && clampCov(cov) >= threshold && weight.has(nodeId)) covered.add(nodeId);
		}
		coveredWeight += bestGain;
	}
	return { chosen, covered, coveredWeight, totalWeight };
}

/** Kendall τ between two strict orderings over their common elements (no ties: plain τ-a; 1 when < 2 common). */
export function kendallTau(a: readonly string[], b: readonly string[]): number {
	return kendallTauByRank(a, new Map(b.map((id, i) => [id, i])));
}

/**
 * Kendall-type agreement of the ordering `a` with a rank per element (e.g.
 * the page order of each node's section), over the COMPARABLE pairs only:
 * (C − D) / (C + D) — Goodman–Kruskal γ, which equals Kendall τ when nothing
 * is tied. Equal ranks — nodes taught in the SAME section — say nothing about
 * order, so they count neither way. (τ-a/τ-b keep ties in the denominator:
 * a book whose sections each teach several nodes could never reach 0,5 even
 * in perfect agreement, firing the "other order" warning; two nodes of one
 * section gave τ-a = 0.) Elements without a rank are ignored; 1 when no pair
 * is comparable.
 */
export function kendallTauByRank(a: readonly string[], rank: ReadonlyMap<string, number>): number {
	const common = a.filter((id) => rank.has(id));
	let concordant = 0;
	let discordant = 0;
	for (let i = 0; i < common.length; i++) {
		for (let j = i + 1; j < common.length; j++) {
			const d = rank.get(common[j]!)! - rank.get(common[i]!)!;
			if (d > 0) concordant++;
			else if (d < 0) discordant++;
		}
	}
	const comparable = concordant + discordant;
	return comparable === 0 ? 1 : (concordant - discordant) / comparable;
}

/** Full region plan: spine + gap cover + per-node assignment in graph order. */
export function planRegionReading(nodes: readonly RegionNode[], books: readonly BookCandidate[], extraSets: readonly CoverSet[] = [], options: RegionPlanOptions = {}): RegionPlan {
	const o = { ...DEFAULTS, ...options };
	const spine = chooseSpine(books, nodes, o);
	const spineCovered = new Set<string>();
	if (spine) for (const [nodeId, b] of Object.entries(spine.best)) if (b.cov >= o.primaryThreshold) spineCovered.add(nodeId);

	const gapSets: CoverSet[] = [];
	for (const book of books) {
		if (book.bookId === spine?.bookId) continue;
		for (const s of book.sections) gapSets.push({ id: `${book.bookId}#${s.sectionId}`, resourceId: book.bookId, cost: Math.max(1, s.pages ?? 1), coverage: s.coverage });
	}
	gapSets.push(...extraSets);
	const cover = greedySetCover(nodes, gapSets, { threshold: o.primaryThreshold, targetFraction: o.targetFraction, alreadyCovered: spineCovered });

	const order = o.topoOrder?.length ? [...o.topoOrder.filter((id) => nodes.some((n) => n.nodeId === id)), ...nodes.map((n) => n.nodeId).filter((id) => !o.topoOrder!.includes(id))] : nodes.map((n) => n.nodeId);
	const assignments: ReadingAssignment[] = [];
	for (const nodeId of order) {
		const b = spine?.best[nodeId];
		if (spine && b && b.cov >= o.primaryThreshold) {
			assignments.push({ nodeId, resourceId: spine.bookId, partId: b.sectionId, cov: b.cov, source: "spine" });
			continue;
		}
		let bestSet: CoverSet | undefined;
		for (const s of cover.chosen) if (clampCov(s.coverage[nodeId]) >= o.primaryThreshold && (!bestSet || clampCov(s.coverage[nodeId]) > clampCov(bestSet.coverage[nodeId]))) bestSet = s;
		if (bestSet) assignments.push({ nodeId, resourceId: bestSet.resourceId, partId: bestSet.id, cov: clampCov(bestSet.coverage[nodeId]), source: "supplement" });
	}

	const warnings: string[] = [];
	let orderAgreement: number | undefined;
	if (spine && o.topoOrder?.length) {
		// Rank = position of the node's best section in the book (ties allowed).
		const sectionRank = new Map(
			Object.entries(spine.best)
				.filter(([, b]) => b.cov >= o.primaryThreshold)
				.map(([id, b]) => [id, b.order] as const),
		);
		const graphOrder = o.topoOrder.filter((id) => spineCovered.has(id));
		if (graphOrder.length >= 2) {
			orderAgreement = kendallTauByRank(graphOrder, sectionRank);
			if (orderAgreement < 0.5) warnings.push("O livro-guia apresenta os tópicos em outra ordem; o app segue a ordem do grafo.");
		}
	}
	const totalWeight = cover.totalWeight;
	const uncovered = nodes.filter((n) => positiveWeight(n) > 0 && !cover.covered.has(n.nodeId)).map((n) => n.nodeId);
	return {
		spine,
		supplements: cover.chosen,
		assignments,
		coveredWeight: cover.coveredWeight,
		totalWeight,
		coveredFraction: totalWeight > 0 ? cover.coveredWeight / totalWeight : 1,
		uncovered,
		...(orderAgreement !== undefined ? { orderAgreement } : {}),
		warnings,
	};
}
