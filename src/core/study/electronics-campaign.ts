import type { CurriculumItem, CurriculumSnapshot } from "../curriculum/types.ts";
import type { LearnerGraphView } from "../learner/graph-view.ts";
import { LEARNER_CONSTANTS } from "../learner/params.ts";
import type { CampaignChapter, StudyCampaign } from "./campaign.ts";

interface ElectronicsStageSpec {
	band: 0 | 1 | 2 | 3 | 4;
	level: string;
	title: string;
	mission: string;
	preferredEntry: string;
	preferredFinale: string;
	preferredRoute: readonly string[];
	/** Preferred unit ordering inside this stage (units not listed keep topological order). */
	preferredUnits: readonly string[];
	entryMinutes: number;
	usualMinutes: number;
	finaleMinutes: number;
}

const ELECTRONICS_STAGES: readonly ElectronicsStageSpec[] = [
	{
		band: 0,
		level: "Etapa 1",
		title: "Primeiros circuitos e fundamentos",
		mission: "Entender carga, corrente, tensão e resistência e aplicar a Lei de Ohm para ler esquemáticos e escolher resistores em circuitos CC simples.",
		preferredEntry: "ee.physics.electrostatics.charge-coulomb.electric-charge",
		preferredFinale: "ee.dc.basics.power-energy-dc",
		preferredRoute: [
			"ee.physics.electrostatics.charge-coulomb.conductors-insulators-induction",
			"ee.math.algebra.linear-equations.isolate-variable",
			"ee.math.algebra.sci-notation.powers-of-ten",
			"ee.math.algebra.sci-notation.si-prefixes",
			"ee.physics.current.current-drift.current-definition",
			"ee.dc.basics.quantities",
			"ee.dc.basics.ohms-law",
			"ee.dc.basics.schematics",
			"ee.dc.basics.resistors-practical",
		],
		preferredUnits: [
			"ee.physics.electrostatics",
			"ee.math.algebra",
			"ee.physics.current",
			"ee.dc.basics",
			"ee.digital.numbers",
			"ee.digital.boolean",
		],
		entryMinutes: 20,
		usualMinutes: 30,
		finaleMinutes: 40,
	},
	{
		band: 1,
		level: "Etapa 2",
		title: "Circuitos, bancada e base técnica",
		mission: "Aplicar as leis de Kirchhoff, analisar redes CC e CA, operar instrumentos de bancada e construir blocos digitais e analógicos essenciais.",
		preferredEntry: "ee.dc.laws.kcl",
		preferredFinale: "ee.embedded.c.modular-c",
		preferredRoute: [
			"ee.dc.laws.kvl",
			"ee.dc.laws.series-parallel",
			"ee.dc.laws.dividers",
			"ee.instruments.safety.electrical-safety",
			"ee.dc.methods.nodal",
			"ee.dc.theorems.thevenin",
			"ee.instruments.bench.breadboard",
			"ee.instruments.bench.multimeter",
		],
		preferredUnits: [
			"ee.dc.laws",
			"ee.dc.practice",
			"ee.math.algebra",
			"ee.dc.methods",
			"ee.dc.theorems",
			"ee.dc.nonlinear",
			"ee.digital.numbers",
			"ee.digital.boolean",
			"ee.digital.comb",
			"ee.digital.seq",
			"ee.math.trig",
			"ee.instruments.safety",
			"ee.instruments.bench",
			"ee.instruments.measurement",
			"ee.math.complex",
			"ee.math.calc",
			"ee.physics.electrostatics",
			"ee.physics.current",
			"ee.physics.magnetism",
			"ee.dc.storage",
		],
		entryMinutes: 25,
		usualMinutes: 35,
		finaleMinutes: 45,
	},
	{
		band: 2,
		level: "Etapa 3",
		title: "Graduação em Engenharia Elétrica",
		mission: "Integrar domínio s, Fourier, eletrônica analógica e digital, controle, sinais e sistemas embarcados em projetos completos.",
		preferredEntry: "ee.math.calc.multiple-integrals",
		preferredFinale: "ee.research.professional.project-management",
		preferredRoute: [
			"ee.ac.transients2.rlc-natural",
			"ee.ac.sdomain.s-domain-circuits",
			"ee.analog.feedback.feedback-concepts",
		],
		preferredUnits: [
			"ee.dc.methods",
			"ee.dc.nonlinear",
			"ee.ac.transients2",
			"ee.ac.sdomain",
			"ee.math.calc",
			"ee.math.linalg",
			"ee.math.ode",
			"ee.math.transforms",
		],
		entryMinutes: 25,
		usualMinutes: 35,
		finaleMinutes: 45,
	},
	{
		band: 3,
		level: "Etapa 4",
		title: "Especialização avançada",
		mission: "Dominar física de dispositivos, projetos analógicos/RF/potência de alto desempenho, VLSI e arquiteturas embarcadas avançadas.",
		preferredEntry: "ee.semi.materials.continuity-eq",
		preferredFinale: "ee.research.tools.ml-for-ee",
		preferredRoute: [
			"ee.analog.noise.noise-analysis",
			"ee.signals.adv-dsp.wiener-filter",
			"ee.power.control.converter-modeling",
		],
		preferredUnits: [],
		entryMinutes: 25,
		usualMinutes: 35,
		finaleMinutes: 45,
	},
	{
		band: 4,
		level: "Etapa 5",
		title: "Fronteira e pesquisa",
		mission: "Formular perguntas originais, projetar sistemas de estado da arte e redigir uma contribuição técnica publicável.",
		preferredEntry: "ee.semi.advanced.finfet-gaa",
		preferredFinale: "ee.research.thesis.first-paper",
		preferredRoute: [
			"ee.research.thesis.research-question",
			"ee.research.thesis.research-proposal",
		],
		preferredUnits: [],
		entryMinutes: 30,
		usualMinutes: 40,
		finaleMinutes: 45,
	},
];

const ELECTRONICS_FINALE_ASSIGNMENTS = new Map<string, string>([
	[
		"ee.dc.basics.power-energy-dc",
		"Projete no papel um circuito CC simples com fonte, resistor e carga: leia o esquemático, calcule corrente e queda de tensão pela Lei de Ohm, escolha um resistor comercial com margem de potência e verifique o rendimento.",
	],
]);

const CHAPTER_PLACED_OUT_RATIO = 0.8;

function unitOf(snapshot: CurriculumSnapshot, item: CurriculumItem): CurriculumItem {
	let cur = item;
	const seen = new Set<string>([cur.id]);
	while (cur.parentId && cur.kind !== "unit" && !seen.has(cur.parentId)) {
		const next = snapshot.items[cur.parentId];
		if (!next) break;
		seen.add(next.id);
		cur = next;
	}
	return cur;
}

export function electronicsFinale(id: string): string | undefined {
	return ELECTRONICS_FINALE_ASSIGNMENTS.get(id);
}

/**
 * Partition electronics leaves by band in authored didactic unit order.
 * Shared by electronicsCampaign() and campaign.ts chapterPartitionOf().
 */
export function electronicsStageLeaves(
	snapshot: CurriculumSnapshot,
	graph: LearnerGraphView,
): { spec: ElectronicsStageSpec; leafIds: string[]; units: Map<string, number> }[] {
	const byBand = new Map<number, string[]>();
	for (const id of graph.ids) {
		if (!graph.nodes.get(id)?.isLeaf) continue;
		const item = snapshot.items[id];
		if (!item || item.reinforcementFor || item.level.scheme !== "ee") continue;
		const list = byBand.get(item.level.band) ?? [];
		list.push(id);
		byBand.set(item.level.band, list);
	}
	return ELECTRONICS_STAGES.flatMap((spec) => {
		const raw = byBand.get(spec.band) ?? [];
		if (raw.length === 0) return [];
		const unitOrder = new Map<string, number>();
		spec.preferredUnits.forEach((uid, i) => unitOrder.set(uid, i));
		const topoIndex = new Map<string, number>();
		raw.forEach((id, i) => topoIndex.set(id, i));
		// Within ee.math.algebra (band 0), place linear-equations (isolate-variable) right before sci-notation
		// or keep sci-notation accessible right alongside it; sorting by preferred unit keeps every module
		// self-contained and in valid prerequisite order.
		const sorted = [...raw].sort((a, b) => {
			const ua = unitOf(snapshot, snapshot.items[a]!).id;
			const ub = unitOf(snapshot, snapshot.items[b]!).id;
			const oa = unitOrder.get(ua) ?? (1000 + (topoIndex.get(a) ?? 0));
			const ob = unitOrder.get(ub) ?? (1000 + (topoIndex.get(b) ?? 0));
			if (oa !== ob) return oa - ob;
			return (topoIndex.get(a) ?? 0) - (topoIndex.get(b) ?? 0);
		});
		const units = new Map<string, number>();
		for (const id of sorted) {
			const uid = unitOf(snapshot, snapshot.items[id]!).id;
			if (!units.has(uid)) units.set(uid, units.size);
		}
		return [{ spec, leafIds: sorted, units }];
	});
}

function pickActiveStageIndex(
	chapters: readonly { known: number; total: number }[],
): number {
	// If the learner already has substantial progress in a later stage (e.g. via adaptive placement),
	// treat earlier stages at >= 80% as placed-out so stray unplaced leaves do not drag them backwards.
	let highestStageWithProgress = -1;
	for (let i = chapters.length - 1; i >= 0; i--) {
		if (chapters[i]!.known > 0) {
			highestStageWithProgress = i;
			break;
		}
	}
	for (let i = 0; i < chapters.length; i++) {
		const c = chapters[i]!;
		if (c.total === 0) continue;
		if (c.known >= c.total) continue;
		if (i < highestStageWithProgress && c.known / c.total >= CHAPTER_PLACED_OUT_RATIO) {
			continue;
		}
		return i;
	}
	return -1;
}

export function electronicsCampaign(
	snapshot: CurriculumSnapshot,
	graph: LearnerGraphView,
	known: ReadonlySet<string>,
): StudyCampaign | null {
	const stages = electronicsStageLeaves(snapshot, graph);
	if (stages.length === 0) return null;
	// Require the core v3 entry anchor to exist; otherwise fall back cleanly to generic campaign.
	const hasAuthoredEntry = graph.nodes.get(ELECTRONICS_STAGES[0]!.preferredEntry)?.isLeaf;
	if (!hasAuthoredEntry) return null;

	const { minNewMinutes, maxNewMinutes } = LEARNER_CONSTANTS.planner;
	const lessonMinutes = new Map<string, number>();
	const priorities = new Map<string, number>();

	const prelim = stages.map(({ spec, leafIds, units }) => {
		const leafSet = new Set(leafIds);
		const entry = leafSet.has(spec.preferredEntry) ? spec.preferredEntry : leafIds[0]!;
		const finale = leafSet.has(spec.preferredFinale) ? spec.preferredFinale : leafIds.at(-1)!;
		const count = leafIds.reduce((n, id) => n + Number(known.has(id)), 0);
		return { spec, leafIds, leafSet, units, entry, finale, known: count, total: leafIds.length };
	});

	const activeIdx = pickActiveStageIndex(prelim);

	const journey: CampaignChapter[] = prelim.map((stage, idx) => {
		const { spec, leafIds, leafSet, units, entry, finale, known: count, total } = stage;
		const active = idx === activeIdx;

		const landmarkIds: string[] = [entry];
		for (const rid of spec.preferredRoute) {
			if (rid !== entry && rid !== finale && leafSet.has(rid) && !landmarkIds.includes(rid)) {
				landmarkIds.push(rid);
			}
		}
		if (landmarkIds.length < 4 && leafIds.length > 2) {
			const middle = leafIds.slice(1, -1);
			const stops = Math.min(3, middle.length);
			for (let i = 0; i < stops; i++) {
				const cand = middle[Math.floor(((i + 0.5) * middle.length) / stops)]!;
				if (!landmarkIds.includes(cand) && cand !== finale) landmarkIds.push(cand);
			}
		}
		if (!landmarkIds.includes(finale)) landmarkIds.push(finale);

		let activeUnitId: string | undefined;
		if (active) {
			const unitProgress = new Map<string, { known: number; total: number }>();
			for (const id of leafIds) {
				const uid = unitOf(snapshot, snapshot.items[id]!).id;
				const stat = unitProgress.get(uid) ?? { known: 0, total: 0 };
				stat.total++;
				if (known.has(id)) stat.known++;
				unitProgress.set(uid, stat);
			}
			for (const [uid, stat] of unitProgress) {
				if (stat.known > 0 && stat.known < stat.total) {
					activeUnitId = uid;
					break;
				}
			}
		}

		for (const id of leafIds) {
			const rawMin = Math.max(minNewMinutes, Math.round(graph.nodes.get(id)!.hoursMid * 60));
			const cap = id === entry ? spec.entryMinutes : id === finale ? spec.finaleMinutes : spec.usualMinutes;
			lessonMinutes.set(id, Math.min(rawMin, maxNewMinutes, cap));
			if (active) {
				const uid = unitOf(snapshot, snapshot.items[id]!).id;
				const region = units.get(uid) ?? 0;
				const inActiveUnit = activeUnitId && uid === activeUnitId ? 2 * units.size + 4 : 0;
				const urgency = inActiveUnit + 2 * (units.size - region);
				priorities.set(id, id === entry ? 4 * units.size + 10 : id === finale ? 1 : urgency);
			}
		}

		return {
			level: spec.level,
			title: spec.title,
			mission: spec.mission,
			entry,
			finale,
			entryMinutes: lessonMinutes.get(entry)!,
			known: count,
			total,
			landmarks: landmarkIds.slice(0, 5).map((id) => ({
				id,
				title: graph.nodes.get(id)?.title ?? snapshot.items[id]?.title.pt ?? id,
				known: known.has(id),
			})),
		};
	});

	return {
		journey,
		lessonMinutes,
		priority: (id) => priorities.get(id) ?? 0,
	};
}
