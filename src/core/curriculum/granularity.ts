/**
 * Granularity rules (docs/research/00-SINTESE.md §2.7 "o átomo tem 10–45 min",
 * §2.13 "folhas hi ≤ 4 h"; r3 §4.1 table + atom rules, §7.4(c); r10 §3.6
 * "folhas com hi ≤ 4 h; acima disso, dispara refine", §4.2 gatilho 2).
 *
 *   • atom (a KC): mid hours in [10, 45] min is on target; outside the HARD
 *     band [8, 60] min (r3 §7.4(c): "split (>60) ou merge com irmão (<8)") it
 *     is an invariant error (code "budget", the r10 §3.6 family of hour
 *     invariants); in between it is a warning. Regime-like atoms
 *     (practice_regime, design_project, checkpoint, lab) are exempt from the
 *     KC band: they follow the leaf rule below (practice_regime: no cap — its
 *     size is `practice.targetHours`).
 *   • unrefined leaf (stub or any non-atom leaf): hi ≤ 4 h preferred; above
 *     it is a "refine" candidate (warning, never an error).
 *   • children per parent (r3 §4.1 cardinality) and atom fan-in ≤ 5 (r3 I7)
 *     are health-panel findings.
 *
 * Pure and browser-safe.
 */

import type { EffectiveSystem } from "./effective.ts";
import { hoursMid } from "./hours.ts";
import { asIndex, type CurriculumIndex } from "./rank.ts";
import type { AtomType, CurriculumItem, CurriculumSnapshot, Hours, NodeKind } from "./types.ts";

export const ATOM_MIN_HOURS = 10 / 60;
export const ATOM_MAX_HOURS = 45 / 60;
export const ATOM_HARD_MIN_HOURS = 8 / 60;
export const ATOM_HARD_MAX_HOURS = 60 / 60;
/** Unrefined leaves above this `hi` are refine candidates. */
export const LEAF_MAX_HOURS = 4;
/** r3 I7: an atom with more distinct hard prerequisites than this is too coarse. */
export const ATOM_MAX_FAN_IN = 5;

/** Atom types that are regimes/projects/evaluations, not 10–45 min knowledge components. */
export const REGIME_ATOM_TYPES: readonly AtomType[] = ["practice_regime", "design_project", "checkpoint", "lab"];

/** r3 §4.1: expected number of children per parent kind. */
export const CHILDREN_BANDS: Readonly<Partial<Record<NodeKind, { lo: number; hi: number }>>> = {
	domain: { lo: 10, hi: 16 },
	area: { lo: 6, hi: 15 },
	unit: { lo: 4, hi: 12 },
	topic: { lo: 2, hi: 6 },
};

export type AtomHoursVerdict = "ok" | "exempt" | "warn-small" | "warn-large" | "error-small" | "error-large";

/** Classify an atom's hours against the KC band (non-atoms and regime atoms are "exempt"). */
export function atomHoursVerdict(item: Pick<CurriculumItem, "kind" | "atomType" | "hours">): AtomHoursVerdict {
	if (item.kind !== "atom") return "exempt";
	if (item.atomType && REGIME_ATOM_TYPES.includes(item.atomType)) return "exempt";
	const mid = hoursMid(item.hours);
	const eps = 1e-9;
	if (mid < ATOM_HARD_MIN_HOURS - eps) return "error-small";
	if (mid > ATOM_HARD_MAX_HOURS + eps) return "error-large";
	if (mid < ATOM_MIN_HOURS - eps) return "warn-small";
	if (mid > ATOM_MAX_HOURS + eps) return "warn-large";
	return "ok";
}

export function formatMinutes(hours: number): string {
	return `${Math.round(hours * 60)} min`;
}

export type GranularityAction = "refine" | "split" | "merge" | "cardinality" | "fan-in";

export interface GranularityFinding {
	id: string;
	action: GranularityAction;
	/** Larger = more urgent (hours above the cap, or distance outside the band). */
	severity: number;
	message: string;
	hours?: Hours;
}

/** Leaf-size finding for one live leaf, or null when on target. */
export function leafGranularityFinding(item: CurriculumItem): GranularityFinding | null {
	const verdict = atomHoursVerdict(item);
	const mid = hoursMid(item.hours);
	if (verdict === "warn-large" || verdict === "error-large")
		return {
			id: item.id,
			action: "split",
			severity: mid - ATOM_MAX_HOURS,
			hours: item.hours,
			message: `átomo ${item.id} estimado em ${formatMinutes(mid)} (alvo 10–45 min): dividir em átomos menores`,
		};
	if (verdict === "warn-small" || verdict === "error-small")
		return {
			id: item.id,
			action: "merge",
			severity: ATOM_MIN_HOURS - mid,
			hours: item.hours,
			message: `átomo ${item.id} estimado em ${formatMinutes(mid)} (alvo 10–45 min): fundir com um irmão`,
		};
	if (verdict === "exempt" && item.atomType === "practice_regime") return null;
	if (verdict === "exempt" && item.hours.hi > LEAF_MAX_HOURS) {
		const isAtom = item.kind === "atom";
		return {
			id: item.id,
			action: isAtom ? "split" : "refine",
			severity: item.hours.hi - LEAF_MAX_HOURS,
			hours: item.hours,
			message: isAtom
				? `átomo ${item.id} (${item.atomType}) com até ${item.hours.hi} h (> ${LEAF_MAX_HOURS} h): dividir em partes menores`
				: `folha ${item.id} com até ${item.hours.hi} h (> ${LEAF_MAX_HOURS} h): candidata a refine`,
		};
	}
	return null;
}

function denseLeafFindings(sys: EffectiveSystem): GranularityFinding[] {
	const out: GranularityFinding[] = [];
	for (let x = 0; x < sys.ids.length; x++) {
		if (sys.children[x]!.length > 0) continue;
		const f = leafGranularityFinding(sys.items[x]!);
		if (f) out.push(f);
	}
	return out;
}

/**
 * All granularity findings of a valid snapshot: leaf sizes, children per
 * parent (r3 §4.1) and atom fan-in (r3 I7). Sorted by severity (desc), then id.
 */
export function granularityFindings(source: CurriculumSnapshot | CurriculumIndex): GranularityFinding[] {
	const { sys } = asIndex(source);
	const out = denseLeafFindings(sys);
	for (let x = 0; x < sys.ids.length; x++) {
		const kids = sys.children[x]!.length;
		const item = sys.items[x]!;
		const band = CHILDREN_BANDS[item.kind];
		if (kids > 0 && band && (kids < band.lo || kids > band.hi))
			out.push({
				id: item.id,
				action: "cardinality",
				severity: (kids < band.lo ? band.lo - kids : kids - band.hi) / band.hi,
				message: `${item.id} (${item.kind}) tem ${kids} filhos; o esperado é ${band.lo}–${band.hi}`,
			});
		if (item.kind === "atom") {
			const fanIn = new Set(item.clauses.flat()).size;
			if (fanIn > ATOM_MAX_FAN_IN)
				out.push({
					id: item.id,
					action: "fan-in",
					severity: fanIn - ATOM_MAX_FAN_IN,
					message: `átomo ${item.id} depende de ${fanIn} itens (máx. ${ATOM_MAX_FAN_IN}): grosso demais ou pré-requisitos redundantes`,
				});
		}
	}
	return out.sort((a, b) => b.severity - a.severity || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Unrefined leaves (non-atoms) above LEAF_MAX_HOURS, largest first: the refine queue (r10 §4.2 gatilho 2). */
export function refineCandidates(source: CurriculumSnapshot | CurriculumIndex): string[] {
	const { sys } = asIndex(source);
	return denseLeafFindings(sys)
		.filter((f) => f.action === "refine")
		.sort((a, b) => b.severity - a.severity || (a.id < b.id ? -1 : 1))
		.map((f) => f.id);
}
