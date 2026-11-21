/**
 * CEL ICONS — the hand-inked icon compiler and its outputs (estudos-sota
 * M8 — SÍNTESE §2.12; r9 §7.2–§7.4 compiler, §8 icon rules, §9.3–§9.4
 * inventory and insignias).
 *
 *   - determinism: compiling twice (and emitting twice, to a temp dir)
 *     is byte-identical, and the committed components/icons/generated.ts
 *     and public/icons/sprite.svg equal a fresh emit (`compile.ts --check`);
 *     the output sync is atomic and CRLF-tolerant; degenerate skeletons
 *     fail with clear errors;
 *   - budget: every icon renders in ≤ 2.4 KB (all layers; micro and boil
 *     frames too);
 *   - inventory: the P0 set, the 7 × 3 insignias and every lucide-compat
 *     target exist; aliases resolve;
 *   - cel laws in the data: glyphs carry no tone layers, the shade covers
 *     ~38 % of the fill on the far side of the terminator, the specular
 *     only where law 5 allows it, every layer inside the 1-unit margin,
 *     ink over a colored fill split off as on-fill ink ("texto sobre cor é
 *     sempre tinta"), no literal colors (CSS variables + currentColor);
 *   - <Icon> (server-rendered): accessibility, LOD by size, tone pinning,
 *     on-fill ink, the boil, and the lucide-compat drop-ins.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import fc from "fast-check";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compileAll, compileIcon, fnv1a, renderedBytes, syncOutputs, type CompiledIcon } from "../scripts/icons/compile.ts";
import { ICON_ALIASES as DEF_ALIASES, ICON_DEFS } from "../scripts/icons/defs/index.ts";
import { emitGenerated, emitMeta, emitSprite, standaloneSvg } from "../scripts/icons/emit.ts";
import type { IconSpec } from "../scripts/icons/spec.ts";
import { ICON_ALIASES, ICON_NAMES, ICONS, isIconName, resolveIconName } from "../components/icons/generated.ts";
import { ICON_META } from "../components/icons/meta.ts";
import { Icon, sizeFromClassName } from "../components/icons/icon.tsx";
import * as compat from "../components/icons/lucide-compat.ts";
import { ICON_TONE_NAMES, isIconTone, layerPaint, METAL_TONES, toneVars } from "../components/icons/tones.ts";

const ROOT = new URL("../", import.meta.url);
const read = (rel: string) => fs.readFileSync(new URL(rel, ROOT), "utf8").replace(/\r\n/g, "\n");
const BUDGET = 2400;

const icons = compileAll(ICON_DEFS);
const byName = new Map(icons.map((i) => [i.name, i]));

/** Decode the compiler's path dialect (`m dx dy dx dy … z`, relative, ring
 *  start carried across `z`) into absolute rings. */
function decode(d: string): [number, number][][] {
	assert.match(d, /^(m[\d.\- ]+z)+$/, "path data is m…z rings of numbers only");
	const rings: [number, number][][] = [];
	let cx = 0;
	let cy = 0;
	for (const m of d.matchAll(/m([^z]*)z/g)) {
		const n = [...m[1]!.matchAll(/-?(?:\d+(?:\.\d*)?|\.\d+)/g)].map((x) => Number(x[0]));
		assert.equal(n.length % 2, 0, "coordinate pairs");
		let x = cx + n[0]!;
		let y = cy + n[1]!;
		const ring: [number, number][] = [[x, y]];
		for (let i = 2; i < n.length; i += 2) {
			x += n[i]!;
			y += n[i + 1]!;
			ring.push([x, y]);
		}
		rings.push(ring);
		[cx, cy] = ring[0]!;
	}
	return rings;
}

/** Net area of decoded rings (holes are wound opposite to their outers). */
function netArea(rings: [number, number][][]): number {
	let sum = 0;
	for (const r of rings) {
		for (let i = 0; i < r.length; i++) {
			const [x1, y1] = r[i]!;
			const [x2, y2] = r[(i + 1) % r.length]!;
			sum += x1 * y2 - x2 * y1;
		}
	}
	return Math.abs(sum / 2);
}

const layersOf = (i: CompiledIcon) =>
	[i.fill, i.shade, i.inkOnFill, i.ink, i.hl, i.micro, i.microOnFill, ...(i.boil ?? []), ...(i.boilOnFill ?? [])].filter((d): d is string => !!d);

/** Even-odd point-in-area over decoded rings. */
function inside(rings: [number, number][][], x: number, y: number): boolean {
	let hit = false;
	for (const r of rings) {
		for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
			const [xi, yi] = r[i]!;
			const [xj, yj] = r[j]!;
			if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
		}
	}
	return hit;
}

/** Distance from a point to the nearest edge of decoded rings. */
function edgeDistance(rings: [number, number][][], x: number, y: number): number {
	let best = Infinity;
	for (const r of rings) {
		for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
			const [ax, ay] = r[j]!;
			const [bx, by] = r[i]!;
			const dx = bx - ax;
			const dy = by - ay;
			const t = dx * dx + dy * dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0;
			best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t));
		}
	}
	return best;
}

/** r9 law 5: the specular pill only on the XP gem, rank badges/insignias and mastered nodes. */
const SPECULAR_ALLOWED = (name: string) => ["xp", "node-mastered", "level", "level-up"].includes(name) || name.startsWith("insignia-");

describe("compiler — determinism", () => {
	it("compiling the defs twice is identical, icon by icon", () => {
		assert.deepEqual(compileAll(ICON_DEFS), icons);
	});

	it("emitting twice writes byte-identical files", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cel-icons-"));
		try {
			for (const run of ["a", "b"]) {
				const fresh = compileAll(ICON_DEFS);
				fs.writeFileSync(path.join(dir, `${run}.ts`), emitGenerated(fresh, DEF_ALIASES));
				fs.writeFileSync(path.join(dir, `${run}.svg`), emitSprite(fresh));
			}
			assert.ok(fs.readFileSync(path.join(dir, "a.ts")).equals(fs.readFileSync(path.join(dir, "b.ts"))));
			assert.ok(fs.readFileSync(path.join(dir, "a.svg")).equals(fs.readFileSync(path.join(dir, "b.svg"))));
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("syncOutputs writes atomically, treats CRLF checkouts as fresh, and --check never writes", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cel-icons-sync-"));
		try {
			const files = { "components/icons/generated.ts": "a\nb\n", "public/icons/sprite.svg": "<svg/>\n" };
			assert.deepEqual(syncOutputs(dir, files, true), { written: [], stale: Object.keys(files) }, "missing files are stale");
			assert.equal(fs.existsSync(path.join(dir, "components")), false, "--check wrote nothing");
			assert.deepEqual(syncOutputs(dir, files, false).written, Object.keys(files));
			assert.deepEqual(syncOutputs(dir, files, false), { written: [], stale: [] }, "second run is a no-op");
			// A Windows checkout with core.autocrlf rewrites LF as CRLF: still fresh.
			fs.writeFileSync(path.join(dir, "components/icons/generated.ts"), "a\r\nb\r\n");
			assert.deepEqual(syncOutputs(dir, files, true).stale, []);
			fs.writeFileSync(path.join(dir, "public/icons/sprite.svg"), "<svg></svg>\n");
			assert.deepEqual(syncOutputs(dir, files, true).stale, ["public/icons/sprite.svg"]);
			syncOutputs(dir, files, false);
			assert.equal(fs.readFileSync(path.join(dir, "public/icons/sprite.svg"), "utf8"), "<svg/>\n");
			for (const sub of ["components/icons", "public/icons"]) {
				assert.deepEqual(fs.readdirSync(path.join(dir, sub)).filter((n) => n.includes(".tmp-")), [], "no temp files left behind");
			}
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("degenerate skeletons fail with clear errors instead of emitting broken art", () => {
		const glyph = (ink: IconSpec["ink"], extra: Partial<IconSpec> = {}): IconSpec => ({ label: "Teste", family: "glyph", ink, ...extra });
		assert.throws(() => compileIcon("zero", glyph([{ d: "M5 5L5 5" }])), /"zero" has no ink/);
		assert.throws(() => compileIcon("Not Kebab", glyph([{ d: "M5 5L9 9" }])), /kebab-case/);
		assert.throws(() => compileIcon("g-fill", glyph([{ d: "M5 5L9 9" }], { fill: "M4 4H20V20H4Z" })), /glyphs are ink only/);
		assert.throws(() => compileIcon("g-hl", glyph([{ d: "M5 5L9 9" }], { hl: [[8, 8, 1, 0.5]] })), /glyphs carry no specular/);
		assert.throws(
			() => compileIcon("flat", { label: "Teste", family: "object", fill: "M5 5L10 10", ink: [{ d: "M5 5L10 10" }] }),
			/fill has no closed area/,
		);
		assert.throws(() => compileIcon("bad-path", glyph([{ d: "M5 5Q" }])), /path: expected a number/);
		// Only dots, no strokes: still a valid glyph.
		assert.ok(compileIcon("dots-only", glyph([], { dots: [[12, 12, 1.5]] })).ink.length > 0);
	});

	it("the committed outputs are fresh (npx tsx scripts/icons/compile.ts --check)", () => {
		assert.equal(read("components/icons/generated.ts"), emitGenerated(icons, DEF_ALIASES), "generated.ts is stale");
		assert.equal(read("components/icons/meta.ts"), emitMeta(icons, DEF_ALIASES), "meta.ts is stale");
		assert.equal(read("public/icons/sprite.svg"), emitSprite(icons), "sprite.svg is stale");
	});

	it("the seed is FNV-1a of the name: renaming re-inks, re-ordering does not", () => {
		assert.equal(fnv1a(""), 0x811c9dc5);
		assert.equal(fnv1a("a"), 0xe40c292c);
		const spec = ICON_DEFS["check"]!;
		assert.deepEqual(compileIcon("check", spec), byName.get("check"));
		assert.notEqual(compileIcon("check-copy", spec).ink, byName.get("check")!.ink);
	});

	it("random skeletons compile deterministically and stay on the grid (fast-check)", () => {
		const pt = fc.tuple(fc.double({ min: 3, max: 21, noNaN: true }), fc.double({ min: 3, max: 21, noNaN: true }));
		fc.assert(
			fc.property(fc.array(pt, { minLength: 2, maxLength: 5 }), fc.boolean(), (pts, closed) => {
				const d = `M${pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L")}${closed ? "Z" : ""}`;
				const spec: IconSpec = { label: "Teste", family: "glyph", ink: [{ d }] };
				const a = compileIcon("prop-test", spec);
				assert.deepEqual(compileIcon("prop-test", spec), a);
				for (const ring of decode(a.ink)) for (const [x, y] of ring) assert.ok(x > -0.5 && x < 24.5 && y > -0.5 && y < 24.5);
			}),
			{ numRuns: 30 },
		);
	});
});

describe("compiler — budget and structure", () => {
	it(`every icon renders in ≤ ${BUDGET} B (all layers), micro and boil frames too`, () => {
		const bytes = (d: string | undefined) => (d ? Buffer.byteLength(d) : 0);
		for (const icon of icons) {
			assert.ok(renderedBytes(icon) <= BUDGET, `${icon.name}: ${renderedBytes(icon)} B`);
			const base = renderedBytes(icon) - bytes(icon.ink) - bytes(icon.inkOnFill);
			const alts: [string | undefined, string | undefined][] = [
				[icon.micro, icon.microOnFill],
				[icon.boil?.[0], icon.boilOnFill?.[0]],
				[icon.boil?.[1], icon.boilOnFill?.[1]],
			];
			for (const [ink, onFill] of alts) {
				if (ink === undefined) continue;
				const total = base + bytes(ink) + bytes(onFill);
				assert.ok(total <= BUDGET, `${icon.name} (alt ink): ${total} B`);
			}
		}
	});

	it("renderedBytes counts both halves of the ink", () => {
		const icon = byName.get("domain-english")!;
		assert.ok(icon.inkOnFill);
		const sum = [icon.fill, icon.shade, icon.inkOnFill, icon.ink].reduce((n, d) => n + Buffer.byteLength(d ?? ""), 0);
		assert.equal(renderedBytes(icon), sum);
	});

	it("names are kebab-case, labels pt-BR non-empty, grids 24/48, ink always present", () => {
		for (const icon of icons) {
			assert.match(icon.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
			assert.ok(icon.label.trim().length > 1, icon.name);
			assert.ok(icon.grid === 24 || icon.grid === 48, icon.name);
			assert.ok(icon.ink.length > 0, icon.name);
		}
	});

	it("every layer stays inside the 1-unit margin of its viewBox (r9 §8.1 / §13: bbox within [1, 23])", () => {
		// 24-grid icons: r9's [1, 23]. Display insignias (grid 48) are drawn to
		// the edge of their live area and keep 1 px of air at their native 48 px.
		for (const icon of icons) {
			const lo = 1;
			const hi = icon.grid - lo;
			for (const d of layersOf(icon)) {
				for (const ring of decode(d)) {
					for (const [x, y] of ring) {
						assert.ok(x >= lo && x <= hi && y >= lo && y <= hi, `${icon.name}: (${x.toFixed(2)}, ${y.toFixed(2)}) outside [${lo}, ${hi}]`);
					}
				}
			}
		}
	});

	it("glyphs are ink only; tone layers only on objects, with a valid tone", () => {
		for (const icon of icons) {
			if (icon.family === "glyph") {
				assert.equal(icon.fill ?? icon.shade ?? icon.hl ?? icon.inkOnFill ?? icon.microOnFill, undefined, `${icon.name}: a glyph carries tones`);
			}
			if (icon.fill) assert.ok(icon.tone && isIconTone(icon.tone), `${icon.name}: tone`);
			if (icon.hl) assert.ok(icon.fill, `${icon.name}: specular without a fill`);
			if (icon.inkOnFill || icon.microOnFill || icon.boilOnFill) assert.ok(icon.fill, `${icon.name}: on-fill ink without a fill`);
		}
	});

	it("the specular is a condiment (r9 law 5): only the XP gem, rank badges/insignias and mastered nodes", () => {
		const shiny = icons.filter((i) => i.hl).map((i) => i.name);
		for (const name of shiny) assert.ok(SPECULAR_ALLOWED(name), `${name} carries a specular`);
		for (const name of ["xp", "node-mastered", "insignia-1-1", "insignia-7-3"]) assert.ok(shiny.includes(name), `${name} lost its specular`);
		assert.equal(byName.get("trophy")!.hl, undefined);
	});

	it("text on color is ink: strokes drawn over the tone split off as on-fill ink (SÍNTESE §2.12)", () => {
		// The marks that carry meaning on a colored fill are on-fill…
		for (const name of ["domain-english", "node-mastered", "review-due", "exercise", "level-up", "goal", "video", "insignia-1-1"]) {
			const icon = byName.get(name)!;
			assert.ok(icon.inkOnFill, `${name}: no on-fill ink`);
			assert.ok(icon.ink.length > 0, `${name}: the outline must stay ground ink`);
		}
		// …the outline, and strokes that straddle the silhouette, are not.
		for (const name of ["domain-electronics", "streak", "trophy", "frontier", "node-learning"]) {
			assert.equal(byName.get(name)!.inkOnFill, undefined, `${name}: straddling ink classified on-fill`);
		}
		// Every on-fill ring lies over the fill (wobble and pressure may graze its edge).
		for (const icon of icons) {
			if (!icon.fill) continue;
			const fill = decode(icon.fill);
			const slack = 0.35 * (icon.grid / 24);
			for (const d of [icon.inkOnFill, icon.microOnFill, ...(icon.boilOnFill ?? [])]) {
				if (!d) continue;
				for (const ring of decode(d)) {
					for (const [x, y] of ring) {
						assert.ok(inside(fill, x, y) || edgeDistance(fill, x, y) <= slack, `${icon.name}: on-fill ink at (${x.toFixed(2)}, ${y.toFixed(2)}) leaves the fill`);
					}
				}
			}
		}
	});

	it("the on-fill split is per stroke and identical across LODs; it needs a fill", () => {
		const fill = "M4 4H20V20H4Z";
		const spec: IconSpec = {
			label: "Teste",
			family: "object",
			fill,
			ink: [{ d: fill }, { d: "M8 10H16" }, { d: "M12 2V8" }, { d: "M7 13.5H17", detail: true }],
			dots: [[12, 17, 1], [4, 12, 1]],
		};
		const icon = compileIcon("split-test", spec);
		const onFill = decode(icon.inkOnFill!);
		const ground = decode(icon.ink);
		assert.ok(inside(onFill, 12, 10), "inner bar is on-fill");
		assert.ok(inside(onFill, 12, 13.5), "inner detail bar is on-fill");
		assert.ok(inside(onFill, 12, 17), "inner dot is on-fill");
		assert.ok(!inside(ground, 12, 10) && !inside(ground, 12, 17), "on-fill strokes leave the ground ink");
		assert.ok(inside(ground, 12, 4), "the outline is ground ink");
		assert.ok(inside(ground, 12, 2.6) && inside(ground, 12, 7), "a stroke crossing the silhouette is ground ink, all of it");
		assert.ok(!inside(onFill, 12, 7) && !inside(onFill, 4, 12), "straddling strokes and edge dots are never on-fill");
		// micro drops the detail bar but keeps the inner bar on-fill.
		const micro = decode(icon.microOnFill!);
		assert.ok(inside(micro, 12, 10) && !inside(micro, 12, 13.5));
		assert.equal(inside(decode(icon.micro!), 12, 13.5), false, "the dropped detail does not move to the ground ink");
		// Without a fill nothing is on-fill (glyphs, line art).
		assert.equal(compileIcon("split-glyph", { label: "Teste", family: "glyph", ink: [{ d: "M8 12H16" }] }).inkOnFill, undefined);
		// All ink over the tone is fine (no outline at all).
		const bare = compileIcon("split-bare", { label: "Teste", family: "object", fill, ink: [{ d: "M8 12H16" }] });
		assert.equal(bare.ink, "");
		assert.ok(bare.inkOnFill);
	});

	it("the self-shade covers about 38 % of the fill, on the far side of a 45° terminator", () => {
		for (const icon of icons) {
			if (!icon.fill || !icon.shade) continue;
			const fill = decode(icon.fill);
			const shade = decode(icon.shade);
			const ratio = netArea(shade) / netArea(fill);
			assert.ok(ratio > 0.2 && ratio < 0.55, `${icon.name}: shade/fill = ${ratio.toFixed(2)}`);
			// Light from the top-left: the shade's centroid sits below-right of the fill's.
			const centroid = (rings: [number, number][][]) => {
				const pts = rings.flat();
				return pts.reduce((s, [x, y]) => s + x + y, 0) / pts.length;
			};
			assert.ok(centroid(shade) > centroid(fill), `${icon.name}: shade is not on the shadow side`);
		}
	});

	it("the micro ink exists exactly for glyphs and detail-bearing icons, and is not the regular ink", () => {
		for (const icon of icons) {
			const spec = ICON_DEFS[icon.name]!;
			const expected = icon.grid === 24 && (spec.micro ?? (spec.family === "glyph" || spec.ink.some((s) => s.detail)));
			assert.equal(!!icon.micro, expected, icon.name);
			if (icon.micro) assert.notEqual(icon.micro, icon.ink, icon.name);
		}
	});
});

describe("inventory", () => {
	it("covers the P0 set (domains, node states, progress, media, system) by name or alias", () => {
		const required = [
			"domain-electronics", "domain-english", "node-mastered", "node-frontier", "node-stub", "node-provisional", "node-rusty",
			"node-locked", "node-available", "node-learning", "review-due", "xp", "level", "level-up", "streak", "trophy", "book",
			"chapter", "video", "flashcard", "memory", "profile", "stats", "hours", "tokens", "settings", "play", "pause", "next",
			"hint", "check", "x", "search", "graph", "today", "home", "map", "lesson", "practice", "review", "send", "mic", "loader",
		];
		for (const name of required) assert.ok(resolveIconName(name), `missing icon: ${name}`);
		assert.ok(icons.length >= 100, `only ${icons.length} icons`);
	});

	it("the insignias: 7 shapes × 3 pips, display art on the 48 grid, one metal per tier", () => {
		for (let tier = 1; tier <= 7; tier++) {
			for (let div = 1; div <= 3; div++) {
				const icon = byName.get(`insignia-${tier}-${div}`);
				assert.ok(icon, `insignia-${tier}-${div}`);
				assert.equal(icon.grid, 48);
				assert.equal(icon.family, "display");
				assert.equal(icon.tone, METAL_TONES[tier - 1]);
				assert.ok(icon.hl, "insignias carry the specular");
				// The division pips are the only ink rings entirely below the emblem.
				const pips = decode(icon.ink).filter((ring) => Math.min(...ring.map(([, y]) => y)) > 39.5);
				assert.equal(pips.length, div, `insignia-${tier}-${div}: ${pips.length} pips`);
			}
		}
	});

	it("aliases resolve to drawings and never shadow one", () => {
		for (const [alias, target] of Object.entries(ICON_ALIASES)) {
			assert.ok(!isIconName(alias), alias);
			assert.equal(resolveIconName(alias), target);
		}
		assert.equal(resolveIconName("nope"), null);
		assert.deepEqual([...ICON_NAMES], [...ICON_NAMES].sort());
	});

	it("every lucide-compat name maps to an existing icon and is exported as a component", () => {
		const exports = compat as unknown as Record<string, unknown>;
		for (const [lucide, target] of Object.entries(compat.LUCIDE_COMPAT)) {
			assert.ok(isIconName(target), `${lucide} → ${target}`);
			assert.equal(compat.compatIconName(lucide as compat.LucideCompatName), target);
			const C = exports[lucide] as { displayName?: string } | undefined;
			assert.equal(typeof C, "function", `${lucide} is not exported`);
			assert.equal(C!.displayName, lucide);
		}
		assert.ok(Object.keys(compat.LUCIDE_COMPAT).length >= 70);
	});
});

describe("outputs — colors come only from the theme", () => {
	const sprite = read("public/icons/sprite.svg");
	const generated = read("components/icons/generated.ts");

	it("the sprite has titled <symbol> entries per icon (+ --micro / --boil variants) with its viewBox, and no stroke", () => {
		let expectedSymbols = 0;
		for (const icon of icons) {
			expectedSymbols++;
			assert.ok(sprite.includes(`<symbol id="${icon.name}" viewBox="0 0 ${icon.grid} ${icon.grid}"><title>`), icon.name);
			if (icon.micro !== undefined) {
				expectedSymbols++;
				assert.ok(sprite.includes(`<symbol id="${icon.name}--micro" viewBox="0 0 ${icon.grid} ${icon.grid}"><title>`), `${icon.name}--micro`);
			}
			if (icon.boil) {
				expectedSymbols++;
				const start = sprite.indexOf(`<symbol id="${icon.name}--boil"`);
				assert.ok(start >= 0, `${icon.name}--boil`);
				const body = sprite.slice(start, sprite.indexOf("</symbol>", start));
				assert.ok(body.includes('<g class="cel-boil">'), `${icon.name}--boil wraps boil frames in .cel-boil`);
			}
		}
		assert.equal(sprite.match(/<symbol /g)?.length, expectedSymbols);
		assert.doesNotMatch(sprite, /\bstroke[=:-]/);
	});

	it("no literal colors: tones are CSS variables, the ink is currentColor", () => {
		assert.doesNotMatch(sprite, /#[0-9a-f]{3,8}\b|rgb\(/i);
		assert.doesNotMatch(generated, /#[0-9a-f]{6}\b|rgb\(/i);
		assert.equal(layerPaint("ink"), "var(--icon-ink, currentColor)");
		assert.equal(layerPaint("fill", "xp"), "var(--icon-fill, var(--cel-xp, transparent))");
		assert.equal(layerPaint("shade", "gold"), "var(--icon-shade, var(--c-gold-shade, transparent))");
		assert.deepEqual(toneVars("coral", true), { "--icon-fill": "var(--c-coral-hl)", "--icon-shade": "var(--c-coral-shade)" });
	});

	it("on-fill ink paints --cel-on-fill over every colored tone, currentColor over the neutral surface and outside cel", () => {
		for (const tone of ICON_TONE_NAMES) {
			const paint = layerPaint("onFill", tone);
			if (tone === "neutral") assert.equal(paint, layerPaint("ink"));
			// The innermost fallback is the ink paint: classic themes (no --cel-on-fill) draw plain ink.
			else assert.equal(paint, "var(--icon-ink-on-fill, var(--cel-on-fill, var(--icon-ink, currentColor)))", tone);
		}
	});

	it("the sprite draws on-fill ink under the outline with the on-fill paint", () => {
		const symbol = (name: string) => {
			const start = sprite.indexOf(`<symbol id="${name}"`);
			return sprite.slice(start, sprite.indexOf("</symbol>", start));
		};
		const english = symbol("domain-english");
		const onFillAt = english.indexOf('class="icon-ink-on-fill"');
		assert.ok(onFillAt > 0 && onFillAt < english.indexOf('class="icon-ink"'), "on-fill path precedes the ink path");
		assert.match(english, /class="icon-ink-on-fill" d="[^"]+" style="fill:var\(--icon-ink-on-fill, var\(--cel-on-fill/);
		assert.match(symbol("node-locked"), /class="icon-ink-on-fill" d="[^"]+" style="fill:var\(--icon-ink, currentColor\)"/, "neutral tone keeps ink");
	});

	it("standalone previews paint on-fill ink only when the tone is drawn", () => {
		const icon = byName.get("node-mastered")!;
		const colors = { ink: "#e9e4d6", onFill: "#07070b", fill: "#3dd68c", shade: "#0fa785", hl: "#ffffff" };
		assert.ok(standaloneSvg(icon, colors, 24).includes(`<path d="${icon.inkOnFill}" fill="#07070b"/>`));
		assert.ok(standaloneSvg(icon, colors, 24, "regular", false).includes(`<path d="${icon.inkOnFill}" fill="#e9e4d6"/>`));
	});
});

describe("<Icon> — server-rendered", () => {
	const html = (props: Parameters<typeof Icon>[0]) => renderToStaticMarkup(createElement(Icon, props));
	const sprite = read("public/icons/sprite.svg");
	const useHref = (markup: string) => {
		const m = /<use href="([^"]+)"/.exec(markup);
		assert.ok(m, `missing <use href> in: ${markup}`);
		return m[1]!;
	};
	const symbolMarkup = (id: string) => {
		const start = sprite.indexOf(`<symbol id="${id}"`);
		assert.ok(start >= 0, `missing symbol #${id} in sprite.svg`);
		return sprite.slice(start, sprite.indexOf("</symbol>", start));
	};
	const symbolPaths = (id: string) => [...symbolMarkup(id).matchAll(/\bd="([^"]+)"/g)].map((m) => m[1]!);

	it("renders via sprite <use> without importing generated.ts paths into JS", () => {
		assert.doesNotMatch(read("components/icons/icon.tsx"), /generated\.ts/);
		assert.equal(Object.keys(ICON_META).length, icons.length);
		const markup = html({ name: "xp" });
		assert.equal(useHref(markup), "/icons/sprite.svg#xp");
		assert.doesNotMatch(markup, /<path\b/);
	});

	it("is decorative by default and announced with a title", () => {
		const deco = html({ name: "search" });
		assert.match(deco, /aria-hidden="true"/);
		assert.doesNotMatch(deco, /role=/);
		const named = html({ name: "warning", title: "Atenção" });
		assert.match(named, /role="img"/);
		assert.match(named, /aria-label="Atenção"/);
		assert.match(named, /<title>Atenção<\/title>/);
	});

	it("picks the LOD by size: micro symbol at ≤ 16 px (size-N class or prop), --icon-hl:transparent below 20 px", () => {
		assert.equal(sizeFromClassName("flex size-4 text-muted"), 16);
		assert.equal(sizeFromClassName("size-3.5"), 14);
		assert.equal(sizeFromClassName(undefined), undefined);
		const small = html({ name: "search", className: "size-4" });
		assert.match(small, /width="16"/);
		assert.equal(useHref(small), "/icons/sprite.svg#search--micro");
		assert.deepEqual(symbolPaths("search--micro"), [ICONS.search.micro]);
		assert.equal(useHref(html({ name: "search" })), "/icons/sprite.svg#search");
		assert.deepEqual(symbolPaths("search"), [ICONS.search.ink]);
		const xp = ICONS.xp;
		const xp24 = html({ name: "xp", size: 24 });
		assert.equal(useHref(xp24), "/icons/sprite.svg#xp");
		assert.doesNotMatch(xp24, /--icon-hl:transparent/);
		assert.deepEqual(symbolPaths("xp"), [xp.fill, xp.shade, xp.ink, xp.hl]);
		const xp18 = html({ name: "xp", size: 18 });
		assert.equal(useHref(xp18), "/icons/sprite.svg#xp");
		assert.match(xp18, /--icon-hl:transparent/);
	});

	it("tone={false} zeroes fills/hl and restores plain ink for on-fill; a pinned tone sets the --icon-* variables", () => {
		const bareXp = html({ name: "xp", tone: false });
		assert.equal(useHref(bareXp), "/icons/sprite.svg#xp");
		assert.match(bareXp, /--icon-fill:transparent/);
		assert.match(bareXp, /--icon-shade:transparent/);
		assert.match(bareXp, /--icon-hl:transparent/);
		assert.match(bareXp, /--icon-ink-on-fill:var\(--icon-ink, currentColor\)/);
		const coral = html({ name: "book", tone: "coral" });
		assert.match(coral, /--icon-fill:var\(--c-coral\)/);
		assert.match(coral, /--icon-shade:var\(--c-coral-shade\)/);
		assert.match(symbolMarkup("xp"), /fill:var\(--icon-fill, var\(--cel-xp, transparent\)\)/);
	});

	it("draws on-fill ink between the tones and the outline; without tones or on neutral it is plain ink", () => {
		const en = ICONS["domain-english"];
		assert.equal(useHref(html({ name: "domain-english" })), "/icons/sprite.svg#domain-english");
		assert.deepEqual(symbolPaths("domain-english"), [en.fill, en.shade, en.inkOnFill, en.ink]);
		const bare = html({ name: "domain-english", tone: false });
		assert.match(bare, /--icon-fill:transparent/);
		assert.match(bare, /--icon-ink-on-fill:var\(--icon-ink, currentColor\)/);
		// A pinned neutral tone is a surface, not a color: the strokes stay ink.
		const neutral = html({ name: "domain-english", tone: "neutral" });
		assert.match(neutral, /--icon-fill:var\(--cel-surface-1\)/);
		assert.match(neutral, /--icon-ink-on-fill:var\(--icon-ink, currentColor\)/);
		const lock = ICONS["node-locked"];
		assert.equal(useHref(html({ name: "node-locked" })), "/icons/sprite.svg#node-locked");
		assert.deepEqual(symbolPaths("node-locked"), [lock.fill, lock.inkOnFill, lock.ink]);
		// ≤ 16 px: the micro symbol pair (cost keeps its non-detail inner stroke).
		const cost = ICONS.cost;
		assert.ok(cost.micro && cost.microOnFill);
		assert.equal(useHref(html({ name: "cost", size: 16 })), "/icons/sprite.svg#cost--micro");
		assert.deepEqual(symbolPaths("cost--micro"), [cost.fill, cost.shade, cost.microOnFill, cost.micro]);
	});

	it("live icons reference the --boil symbol containing three stacked ink frames", () => {
		const mic = html({ name: "mic", live: true });
		assert.equal(useHref(mic), "/icons/sprite.svg#mic--boil");
		assert.match(symbolMarkup("mic--boil"), /<g class="cel-boil">/);
		assert.deepEqual(symbolPaths("mic--boil"), [ICONS.mic.ink, ...ICONS.mic.boil!]);
		assert.equal(useHref(html({ name: "mic" })), "/icons/sprite.svg#mic");
	});

	it("resolves aliases and refuses unknown names", () => {
		assert.equal(useHref(html({ name: "x" })), "/icons/sprite.svg#close");
		assert.match(html({ name: "x" }), /data-icon="x"/);
		assert.throws(() => html({ name: "nope" as "x" }), /Ícone desconhecido/);
	});

	it("lucide-compat components accept lucide's props and render the cel icon", () => {
		const markup = renderToStaticMarkup(createElement(compat.XIcon, { className: "size-4", strokeWidth: 3, absoluteStrokeWidth: true, color: "red" }));
		assert.match(markup, /data-icon="close"/);
		assert.match(markup, /color:red/);
		assert.doesNotMatch(markup, /stroke/i);
		assert.equal(useHref(markup), "/icons/sprite.svg#close--micro");
	});
});
