/**
 * THE ICON SET — every hand-drawn skeleton, merged (estudos-sota M8 —
 * SÍNTESE §2.12; r9 §9). Groups: glyphs (UI chrome), system (P2 + the
 * file family), objects (domains, resources), nodes (graph states),
 * progress (XP, levels, stats) and insignias (7 tiers × 3 divisions).
 * A name defined twice is a build error, never a silent override.
 *
 * ICON_ALIASES name the same drawing under the words the product uses
 * ("dica", "hoje", "horas"): <Icon> resolves them, so no path is emitted
 * twice.
 */

import type { IconSpec } from "../spec.ts";
import { GLYPHS } from "./glyphs.ts";
import { INSIGNIAS } from "./insignias.ts";
import { NODES } from "./nodes.ts";
import { OBJECTS } from "./objects.ts";
import { PROGRESS } from "./progress.ts";
import { SYSTEM } from "./system.ts";

function merge(groups: Readonly<Record<string, Readonly<Record<string, IconSpec>>>>): Record<string, IconSpec> {
	const out: Record<string, IconSpec> = {};
	const owner: Record<string, string> = {};
	for (const [group, defs] of Object.entries(groups)) {
		for (const [name, spec] of Object.entries(defs)) {
			if (owner[name]) throw new Error(`ícone "${name}" definido em ${owner[name]} e em ${group}`);
			owner[name] = group;
			out[name] = spec;
		}
	}
	return out;
}

export const ICON_DEFS: Readonly<Record<string, IconSpec>> = merge({
	glyphs: GLYPHS,
	system: SYSTEM,
	objects: OBJECTS,
	nodes: NODES,
	progress: PROGRESS,
	insignias: INSIGNIAS,
});

/** Product words → the drawing that already says them. */
export const ICON_ALIASES: Readonly<Record<string, string>> = {
	hint: "insight",
	today: "calendar",
	hours: "clock",
	"node-review": "review-due",
	gem: "xp",
	x: "close",
	"chevron": "chevron-right",
	question: "help",
	"external-link": "arrow-up-right",
};
