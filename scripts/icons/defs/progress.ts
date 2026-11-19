/**
 * PROGRESS — XP, levels, streaks, rankings and stats (estudos-sota M8 —
 * SÍNTESE §2.10–§2.12; r9 §9.1 P0 #32 and §9.2 P1 #45–#50, #54, #55, #58).
 * The XP gem and the level shields (rank badges, r9 §9.4) get the specular
 * pill — r9 law 5 allows it only on the primary CTA, the XP gem, insignias
 * and mastered nodes; the trophy is toned but matte; the stat glyphs stay
 * ink only.
 */

import { circle, join, line, poly, roundPoly, rrect } from "../shapes.ts";
import type { IconSpec } from "../spec.ts";

const GEM = roundPoly([[7, 4], [17, 4], [21, 9], [12, 20.5], [3, 9]], 0.8);
const SHIELD = "M12 2.8L19.8 5.6V11.4C19.8 16 16.6 19.4 12 21.2C7.4 19.4 4.2 16 4.2 11.4V5.6Z";
const FLAME = "M12 21.2C8 21.2 5.2 18.4 5.2 14.6C5.2 10.4 8.6 8.4 9.2 3.2C12.4 5.2 14 8 13.8 10.6C15 9.8 15.8 8.6 16 7.2C18 9.2 18.8 11.8 18.8 14.6C18.8 18.4 16 21.2 12 21.2Z";
const FLAME_CORE = "M12 21C10.2 21 9 19.7 9 18C9 15.9 10.6 14.9 11.4 12.6C13.4 14 15 15.8 15 18C15 19.7 13.8 21 12 21Z";
const CUP = "M7 3.5H17V9.5A5 5 0 0 1 7 9.5Z";
const CALENDAR = rrect(3, 5, 18, 16, 2.4);
const CALENDAR_RINGS = join(line(8, 3, 8, 7), line(16, 3, 16, 7));

/** A bell curve: two mirrored cubic shoulders meeting at the mean. */
const BELL = "M2.5 18.5C6.8 18.5 7.8 6.5 12 6.5C16.2 6.5 17.2 18.5 21.5 18.5";

/** The point of the bell's right shoulder at x (bisection on the cubic). */
function bellAt(x: number): readonly [number, number] {
	const P = [[12, 6.5], [16.2, 6.5], [17.2, 18.5], [21.5, 18.5]] as const;
	const at = (t: number, k: 0 | 1) => (1 - t) ** 3 * P[0][k] + 3 * (1 - t) ** 2 * t * P[1][k] + 3 * (1 - t) * t * t * P[2][k] + t ** 3 * P[3][k];
	let lo = 0;
	let hi = 1;
	for (let i = 0; i < 40; i++) {
		const mid = (lo + hi) / 2;
		if (at(mid, 0) < x) lo = mid;
		else hi = mid;
	}
	return [x, at((lo + hi) / 2, 1)];
}

/** "Você está aqui": the learner's marker on the right shoulder. */
const YOU = bellAt(16.4);

export const PROGRESS: Record<string, IconSpec> = {
	xp: {
		label: "XP",
		family: "object",
		tone: "xp",
		fill: GEM,
		ink: [
			{ d: GEM },
			{ d: line(3.4, 9, 20.6, 9), w: 0.8 },
			{ d: join(poly([[10.2, 4.3], [8.6, 9], [12, 20]]), poly([[13.8, 4.3], [15.4, 9], [12, 20]])), w: 0.68, detail: true },
		],
		hl: [[7.8, 6.6, 1.4, 0.6, -35]],
	},
	level: {
		label: "Nível",
		family: "object",
		tone: "xp",
		fill: SHIELD,
		ink: [{ d: SHIELD }, { d: "M12 5.6L17.2 7.5V11.4C17.2 14.6 15.2 17 12 18.4C8.8 17 6.8 14.6 6.8 11.4V7.5Z", w: 0.62, detail: true }],
		hl: [[8.2, 7.4, 1.3, 0.55, -40]],
	},
	"level-up": {
		label: "Subiu de nível",
		family: "object",
		tone: "xp",
		fill: SHIELD,
		ink: [{ d: SHIELD }, { d: line(12, 16.4, 12, 8.4), w: 0.9 }, { d: roundPoly([[8.6, 11.4], [12, 8], [15.4, 11.4]], 0.4, false), w: 0.9 }],
		hl: [[8.2, 7.4, 1.3, 0.55, -40]],
	},
	streak: {
		label: "Sequência de dias",
		family: "object",
		tone: "amber",
		boil: true,
		fill: FLAME,
		ink: [{ d: FLAME }, { d: FLAME_CORE, w: 0.75 }],
	},
	trophy: {
		label: "Troféu",
		family: "object",
		tone: "gold",
		fill: join(CUP, "M9.5 21H14.5L13.6 17.6H10.4Z"),
		ink: [
			{ d: CUP },
			{ d: join("M7 6.2H5.2A2 2 0 0 0 5.4 10.2C6 10.8 7 11.4 8 11.8", "M17 6.2H18.8A2 2 0 0 1 18.6 10.2C18 10.8 17 11.4 16 11.8"), w: 0.8 },
			{ d: join(line(12, 14.5, 12, 17.6), roundPoly([[10.4, 17.6], [13.6, 17.6], [14.6, 21], [9.4, 21]], 0.4)), w: 0.85 },
		],
		// No specular: r9 law 5 keeps it for the XP gem, rank badges and
		// mastered nodes only ("especular em tudo vira clip-art", §12.2).
	},
	leaderboard: {
		label: "Ranking",
		family: "glyph",
		ink: [{ d: "M3 20.5V14.5H8.5V20.5M8.5 20.5V8.5H15.5V20.5M15.5 20.5V11.5H21V20.5" }, { d: line(2.5, 20.5, 21.5, 20.5), w: 0.9 }],
		dots: [[12, 4.6, 1.3]],
	},
	percentile: {
		label: "Percentil",
		family: "glyph",
		ink: [{ d: BELL }, { d: line(2.5, 21, 21.5, 21), w: 0.85 }, { d: line(YOU[0], 20.3, YOU[0], YOU[1] + 2.2), w: 0.62 }],
		dots: [[YOU[0], YOU[1], 1.55]],
	},
	goal: {
		label: "Meta",
		family: "object",
		tone: "rose",
		fill: circle(12, 12, 9),
		ink: [{ d: circle(12, 12, 9) }, { d: circle(12, 12, 5.2), w: 0.8 }],
		dots: [[12, 12, 1.7]],
	},
	clock: {
		label: "Horas de estudo",
		family: "glyph",
		ink: [{ d: circle(12, 12, 9) }, { d: poly([[12, 6.8], [12, 12], [15.6, 14]]), w: 0.9 }],
	},
	calendar: {
		label: "Hoje",
		family: "glyph",
		ink: [{ d: CALENDAR }, { d: CALENDAR_RINGS, w: 0.9 }, { d: line(3.5, 10, 20.5, 10), w: 0.75 }],
		dots: [[12, 15.4, 2.2]],
	},
	"calendar-heat": {
		label: "Calendário de estudo",
		family: "glyph",
		ink: [{ d: CALENDAR }, { d: CALENDAR_RINGS, w: 0.9 }, { d: line(3.5, 10, 20.5, 10), w: 0.75 }],
		dots: [[7.6, 13.8, 1.05], [12, 13.8, 1.05], [16.4, 13.8, 1.05], [7.6, 17.4, 1.05], [12, 17.4, 1.05]],
	},
	"trend-up": {
		label: "Em alta",
		family: "glyph",
		ink: [{ d: roundPoly([[3, 17.5], [9, 11.5], [13, 15], [20, 8]], 0.8, false) }, { d: roundPoly([[14.5, 8], [20, 8], [20, 13.5]], 0.5, false) }],
	},
};
