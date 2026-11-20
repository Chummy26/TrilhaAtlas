import type { EffectiveSystem } from "./effective.ts";
import type { ValidationError } from "./types.ts";

export const campaignTag = "staged-campaign-v2";
export const regionExitTag = "region-exit";
export const foundationTag = "region-foundation";

/** Validate the generated campaign contract on the same effective routes that unlock lessons.
 * In topological order, AND takes the highest guaranteed stage and OR the lowest.
 * A container conveys accomplishments of its children without awarding an extra stage. */
export function campaignErrors(sys: EffectiveSystem, order: readonly number[]): ValidationError[] {
	if (!sys.roots.some(root => sys.items[root]!.tags?.includes(campaignTag))) return [];
	const errors: ValidationError[] = [];
	const stages = new Int32Array(sys.ids.length).fill(-1);
	const unit = new Int32Array(sys.ids.length).fill(-1);
	const area = new Int32Array(sys.ids.length).fill(-1);
	for (const x of sys.treeOrder) {
		const item = sys.items[x]!;
		const parent = sys.parent[x]!;
		unit[x] = item.kind === "unit" ? x : parent >= 0 ? unit[parent]! : -1;
		area[x] = item.kind === "area" ? x : parent >= 0 ? area[parent]! : -1;
	}
	const exits = new Map<number, number[]>();
	const foundations = new Map<number, number[]>();
	const requiredOnEveryRoute = new Map<number, Set<number>>();
	for (const x of order) {
		const item = sys.items[x]!;
		const clauses = sys.clauses[x]!;
		if (unit[x]! >= 0) {
			let common: Set<number> | undefined;
			for (const route of clauses) {
				const required = new Set<number>();
				for (const p of route) if (unit[p] === unit[x]) {
					for (const f of requiredOnEveryRoute.get(p) ?? []) required.add(f);
				}
				if (!common) common = required;
				else for (const f of common) if (!required.has(f)) common.delete(f);
			}
			common ??= new Set();
			if (item.tags?.includes(foundationTag)) {
				common.add(x);
				const entries = foundations.get(unit[x]!) ?? [];
				entries.push(x);
				foundations.set(unit[x]!, entries);
			}
			requiredOnEveryRoute.set(x, common);
		}
		const incoming = clauses.length ? Math.min(...clauses.map(route => route.reduce((best, p) => Math.max(best, stages[p]!), -1))) : -1;
		stages[x] = incoming;
		if (sys.children[x]!.length) continue;
		const stage = area[x]! >= 0 ? sys.items[area[x]!]!.level : undefined;
		if (stage?.scheme !== "generic" || item.level.scheme !== "generic" || item.level.band !== stage.band ||
			!Number.isSafeInteger(stage.band) || stage.band < 0 || unit[x]! < 0) {
			errors.push({ code: "hierarchy", message: item.id + " precisa pertencer à região e ao nível de sua etapa.", witness: [item.id] });
			continue;
		}
		if (stage.band > incoming + 1 || sys.prereqs[x]!.some(p => stages[p]! > stage.band)) {
			errors.push({ code: "no-route", message: item.id + " tem uma rota que pula ou inverte a etapa curricular.", witness: [item.id] });
		}
		stages[x] = Math.min(stage.band, incoming + 1);
		if (item.tags?.includes(regionExitTag)) {
			const ends = exits.get(unit[x]!) ?? [];
			ends.push(x);
			exits.set(unit[x]!, ends);
		}
		if (!item.reinforcementFor && sys.prereqs[x]!.some(p => sys.items[p]!.reinforcementFor)) {
			errors.push({ code: "hierarchy", message: item.id + " exige um reforço opcional.", witness: [item.id] });
		}
	}
	const covered = new Set<number>();
	const goal = Math.max(...Array.from(exits.values(), ends => Math.max(...ends.map(x => stages[x]!))));
	const goalPath = new Set<number>();
	const pendingGoals = [...exits.values()].flat().filter(x => stages[x] === goal);
	while (pendingGoals.length) {
		const x = pendingGoals.pop()!;
		if (goalPath.has(x)) continue;
		goalPath.add(x);
		for (const p of sys.prereqs[x]!) pendingGoals.push(p);
	}
	for (const [region, ends] of exits) {
		if (ends.length !== 1) errors.push({ code: "hierarchy", message: sys.ids[region] + " deve ter uma única saída regional.", witness: [sys.ids[region]!] });
		for (const end of ends) for (const f of foundations.get(region) ?? []) if (!requiredOnEveryRoute.get(end)?.has(f)) {
			errors.push({ code: "no-route", message: sys.ids[end] + " tem uma alternativa que pula o fundamento " + sys.ids[f] + ".", witness: [sys.ids[end]!, sys.ids[f]!] });
		}
		const pending = [...ends];
		while (pending.length) {
			const x = pending.pop()!;
			if (covered.has(x) || unit[x] !== region) continue;
			covered.add(x);
			for (const p of sys.prereqs[x]!) pending.push(p);
		}
	}
	for (const x of order) if (!sys.children[x]!.length && !sys.items[x]!.reinforcementFor && !covered.has(x)) {
		errors.push({ code: "no-route", message: sys.ids[x] + " não contribui para uma saída da região.", witness: [sys.ids[x]!] });
	}
	for (const ends of exits.values()) for (const x of ends) if (!goalPath.has(x)) {
		errors.push({ code: "no-route", message: sys.ids[x] + " não contribui para a etapa final da campanha.", witness: [sys.ids[x]!] });
	}
	return errors;
}
