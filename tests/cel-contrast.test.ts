/**
 * CEL THEME — tokens and contrast (estudos-sota M8 — SÍNTESE §2.12; r9
 * §2.3 the seven laws, §4.2–§4.4 color, §10.1 tokens; WCAG 2.2 AA).
 *
 *   - the cel block of app/globals.css is pinned to celTokens() /
 *     celPrimitiveTokens() in src/core/themes.ts (paper, night, both
 *     domains, a nested domain swap) — the canvas and the CSS agree;
 *   - the block is gated: nothing in it can reach the eleven classic
 *     themes, and the Default literals are untouched;
 *   - every relevant token pair passes WCAG AA in both presets (text,
 *     muted, links, focus, field boundaries, ink on every colored fill);
 *   - the Cel Papel / Cel Noite 12-color presets pass the same bar and
 *     agree with the cel neutrals;
 *   - wcagContrast's algebra holds for arbitrary colors (fast-check).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import fc from "fast-check";
import { ICON_TONES } from "../components/icons/tones.ts";
import {
	BUILTIN_THEMES,
	CEL_METALS,
	CEL_NEUTRALS,
	CEL_RAMPS,
	celPrimitiveTokens,
	celTokens,
	DEFAULT_THEME,
	exportThemeFile,
	hexChannels,
	parseThemeFile,
	themeFamily,
	themeRootAttributes,
	themeVars,
	wcagContrast,
	type ThemeMode,
} from "../src/core/themes.ts";

/* ------------------------------------------------------------------ CSS */

const G = '[data-theme-family="cel"]';
const L = `${G}:is(.light, [data-theme-mode="light"])`;
const MODES: readonly ThemeMode[] = ["light", "dark"];

const rawCss = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const css = rawCss.replace(/\r\n/g, "\n");

function celSection(): string {
	const start = css.indexOf("/* ═══ CEL ═══");
	const end = css.indexOf("/* ═══ /CEL ═══ */");
	assert.ok(start >= 0 && end > start, "app/globals.css carries the cel section markers");
	return css.slice(start, end);
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");

/** The custom properties declared by the rule whose selector is exactly `selector`. */
function block(source: string, selector: string): Record<string, string> {
	const text = stripComments(source);
	const start = text.indexOf(`\n${selector} {`);
	assert.ok(start >= 0, `missing rule: ${selector}`);
	const body = text.slice(text.indexOf("{", start + 1) + 1, text.indexOf("}", start));
	const out: Record<string, string> = {};
	for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
	return out;
}

const section = celSection();
const base = block(section, G);
const light = block(section, L);
const englishDark = block(section, `${G}[data-domain="english"],\n${G} [data-domain="english"]`);
const englishLight = block(section, `${L}[data-domain="english"],\n${L} [data-domain="english"]`);
const electronicsDark = block(section, `${G} [data-domain="electronics"]`);
const electronicsLight = block(section, `${L} [data-domain="electronics"]`);

/** The tokens an element resolves in `mode`, inside `domain` (cascade order of the CSS). */
function resolved(mode: ThemeMode, domain: "electronics" | "english", nestedBack = false): Record<string, string> {
	let out: Record<string, string> = { ...base, ...(mode === "light" ? light : {}) };
	if (domain === "english" || nestedBack) out = { ...out, ...englishDark, ...(mode === "light" ? englishLight : {}) };
	if (nestedBack) out = { ...out, ...electronicsDark, ...(mode === "light" ? electronicsLight : {}) };
	return out;
}

function assertSubset(actual: Record<string, string>, expected: Record<string, string>, what: string) {
	for (const [token, value] of Object.entries(expected)) assert.equal(actual[token], value, `${what}: ${token}`);
}

describe("cel tokens — app/globals.css pinned to src/core/themes.ts", () => {
	it("adding the cel section kept the file's LF line ends (tests/themes.test.ts reads `:root,\\n.dark`)", () => {
		assert.equal(rawCss.includes("\r"), false, "app/globals.css was rewritten with CRLF");
	});

	it("the primitives (8 ramps × 5, 7 metals × 3) are declared verbatim", () => {
		const prim = celPrimitiveTokens();
		assert.equal(Object.keys(prim).length, 8 * 5 + 7 * 3);
		assertSubset(base, prim, "primitives");
	});

	it("night is the default variant and paper overrides only what differs", () => {
		assertSubset(resolved("dark", "electronics"), celTokens("dark"), "night");
		assertSubset(resolved("light", "electronics"), celTokens("light"), "paper");
		for (const token of Object.keys(light)) assert.notEqual(light[token], base[token], `paper repeats ${token}`);
	});

	it("data-domain swaps the accent (volt ↔ coral) and nothing else", () => {
		for (const mode of MODES) {
			assertSubset(resolved(mode, "english"), celTokens(mode, "english"), `${mode}/english`);
			assertSubset(resolved(mode, "electronics", true), celTokens(mode, "electronics"), `${mode}/nested electronics`);
		}
		for (const token of [...Object.keys(englishDark), ...Object.keys(englishLight), ...Object.keys(electronicsDark)]) {
			assert.match(token, /^--cel-accent(-shade|-hl|-text)?$/, `a domain block touched ${token}`);
		}
		assert.equal(celTokens("dark", "english")["--cel-accent"], CEL_RAMPS.coral.base);
		assert.equal(celTokens("dark")["--cel-xp"], celTokens("dark", "english")["--cel-xp"], "XP never follows the domain");
	});

	it("every icon tone resolves to a declared token (fill, shade, lit tone)", () => {
		for (const [tone, t] of Object.entries(ICON_TONES)) {
			for (const v of [t.base, t.shade, t.hl]) assert.ok(v in base, `tone ${tone}: ${v} undeclared`);
		}
	});

	it("ink weights 1.5/2/3/4 px; shadows are hard offsets 2/3/4/6/8 px with zero blur", () => {
		assert.deepEqual([1, 2, 3, 4].map((i) => base[`--cel-ink-w-${i}`]), ["1.5px", "2px", "3px", "4px"]);
		const offsets = [1, 2, 3, 4, 5].map((i) => {
			const m = /^(\d+)px (\d+)px 0 0 var\(--cel-shadow-color\)$/.exec(base[`--cel-shadow-${i}`] ?? "");
			assert.ok(m, `--cel-shadow-${i} must be a hard (0 blur, 0 spread) offset`);
			assert.equal(m[1], m[2], "light from the top-left: the shadow falls diagonally right/down");
			return Number(m[1]);
		});
		assert.deepEqual(offsets, [2, 3, 4, 6, 8]);
		assert.match(base["--cel-radius"] ?? "", /^\d+px$/);
	});

	it("no blur, no gradient anywhere in the cel section (law 3)", () => {
		const text = stripComments(section);
		assert.doesNotMatch(text, /gradient\(|blur\(|backdrop-filter|drop-shadow\(/);
		for (const m of text.matchAll(/box-shadow:\s*([^;]+);/g)) {
			for (const layer of m[1]!.split(/,(?![^(]*\))/)) {
				const lengths = layer.replace(/var\([^)]*\)\)?/g, "").match(/-?\d+(?:\.\d+)?px|\b0\b/g) ?? [];
				if (lengths.length >= 3) assert.match(lengths[2]!, /^0(px)?$/, `blurred shadow layer: ${layer.trim()}`);
			}
		}
	});

	it("is gated: classic themes resolve none of it, and the Default literals are untouched", () => {
		const text = stripComments(section);
		for (const m of text.matchAll(/(?:^|[;{}])\s*([^;{}@]+?)\s*\{/g)) {
			const selector = m[1]!.trim();
			if (/^\d+(\.\d+)?%$/.test(selector) || selector === "from" || selector === "to") continue;
			for (const part of selector.split(/,(?![^(]*\))/).map((p) => p.trim())) {
				assert.ok(part.startsWith(G) || part.startsWith(".cel-"), `ungated selector in the cel section: ${part}`);
			}
		}
		for (const m of text.matchAll(/(--[\w-]+)\s*:/g)) {
			assert.match(m[1]!, /^--(cel|c)-/, `the cel section redeclares a classic token: ${m[1]}`);
		}
		// The Default block keeps the literals themeVars(DEFAULT_THEME) produces.
		const def = block(css, ":root,\n.dark");
		assertSubset(def, themeVars(DEFAULT_THEME.colors, "dark"), "Default");
	});

	it("utilities degrade to the classic tokens outside a cel theme", () => {
		const text = stripComments(section);
		for (const m of text.matchAll(/\n\.cel-[\w-]+[^{]*\{([^}]*)\}/g)) {
			for (const ref of m[1]!.matchAll(/var\((--cel-[\w-]+)(\s*\)|,)/g)) {
				assert.equal(ref[2], ",", `utility reads ${ref[1]} without a classic fallback`);
			}
		}
	});
});

/* -------------------------------------------------------------- contrast */

const AA_TEXT = 4.5;
const AA_UI = 3;

describe("cel contrast — WCAG AA in Cel Papel and Cel Noite", () => {
	for (const mode of MODES) {
		const t = celTokens(mode);
		const n = CEL_NEUTRALS[mode];
		const grounds = { bg: n.bg, "surface-1": n.surface1, "surface-2": n.surface2, "surface-3": n.surface3 };
		const each = (fg: string, min: number, what: string) => {
			for (const [g, hex] of Object.entries(grounds)) {
				const ratio = wcagContrast(fg, hex);
				assert.ok(ratio >= min, `${mode}: ${what} on ${g} = ${ratio.toFixed(2)} < ${min}`);
			}
		};

		it(`${mode}: body text ≥ 7 (AAA), muted ≥ 4.5, faint ≥ 3 on every ground`, () => {
			each(n.text, 7, "text");
			each(n.textMuted, AA_TEXT, "text-muted");
			each(n.textFaint, AA_UI, "text-faint");
		});

		it(`${mode}: links ≥ 4.5; focus, field edges and object outlines ≥ 3 (1.4.11)`, () => {
			each(n.link, AA_TEXT, "link");
			each(n.focus, AA_UI, "focus");
			each(n.edge, AA_UI, "edge");
			each(n.lineObject, AA_UI, "line-object");
		});

		it(`${mode}: every colored -text token (accent, status, XP, both domains) ≥ 4.5`, () => {
			const english = celTokens(mode, "english");
			for (const token of Object.keys(t).filter((k) => k.endsWith("-text") && k !== "--cel-text")) each(t[token]!, AA_TEXT, token);
			each(english["--cel-accent-text"]!, AA_TEXT, "english --cel-accent-text");
		});

		it(`${mode}: text on any colored fill is ink, ≥ 4.5 on every ramp and metal (base and lit tone)`, () => {
			for (const [name, r] of Object.entries(CEL_RAMPS)) {
				for (const fill of [r.base, r.hl]) {
					const ratio = wcagContrast(n.onFill, fill);
					assert.ok(ratio >= AA_TEXT, `${mode}: ink on ${name} ${fill} = ${ratio.toFixed(2)}`);
				}
			}
			for (const [name, m] of Object.entries(CEL_METALS)) {
				for (const fill of [m.base, m.hl]) {
					const ratio = wcagContrast(n.onFill, fill);
					assert.ok(ratio >= AA_TEXT, `${mode}: ink on ${name} ${fill} = ${ratio.toFixed(2)}`);
				}
			}
		});

		it(`${mode}: icon ink — marks drawn over a colored fill (on-fill ink) read on its base, shade and lit tone`, () => {
			// <Icon> paints those marks with --cel-on-fill (layerPaint "onFill"):
			// ≥ 3 on all three tones (1.4.11 graphics), ≥ 4.5 on base and lit tone (text-like "Aa").
			assert.equal(t["--cel-on-fill"], n.onFill);
			const tones = [...Object.entries(CEL_RAMPS), ...Object.entries(CEL_METALS)] as [string, { base: string; shade: string; hl: string }][];
			for (const [name, r] of tones) {
				for (const [part, fill, min] of [["base", r.base, AA_TEXT], ["hl", r.hl, AA_TEXT], ["shade", r.shade, AA_UI]] as const) {
					const ratio = wcagContrast(n.onFill, fill);
					assert.ok(ratio >= min, `${mode}: on-fill ink on ${name} ${part} ${fill} = ${ratio.toFixed(2)} < ${min}`);
				}
			}
			// Over the neutral tone (a surface) the marks stay the text color.
			assert.ok(wcagContrast(n.text, n.surface1) >= AA_TEXT);
		});

		it(`${mode}: the icon outline (currentColor = text, object line) separates every colored fill from the ground`, () => {
			// The outline sits between the fill and the ground (r9 §4.5: chalk at night), so
			// it is what must stand out from every ground — base colors alone do not (1.35–2.8:1 on paper).
			for (const ground of Object.values(grounds)) {
				assert.ok(wcagContrast(n.lineObject, ground) >= AA_UI && wcagContrast(n.text, ground) >= AA_UI, `${mode}: outline on ${ground}`);
			}
			if (mode === "dark") {
				// Why on-fill ink exists: night chalk over the brightest fills is
				// unreadable (volt 1.1:1, mint 1.4:1) — letters and checks there must be ink.
				const worst = Math.min(...Object.values(CEL_RAMPS).map((r) => wcagContrast(n.text, r.base)));
				assert.ok(worst < AA_UI, "chalk-on-color became readable: revisit the on-fill split");
			}
		});
	}

	it("the classic 12-color presets of the cel family pass AA and match the cel neutrals", () => {
		for (const [id, mode] of [["cel-papel", "light"], ["cel-noite", "dark"]] as const) {
			const theme = BUILTIN_THEMES.find((x) => x.id === id);
			assert.ok(theme, `preset ${id}`);
			assert.equal(theme.mode, mode);
			assert.equal(themeFamily(theme), "cel");
			const c = theme.colors;
			for (const ink of [c.text, c.bold, c.italic, c.code]) {
				assert.ok(Math.min(wcagContrast(ink, c.background), wcagContrast(ink, c.surface)) >= 7,
					`${id}: tutor prose and its emphasis must remain legible on the page and in activities`);
			}
			for (const key of ["text", "textMuted", "bold", "italic", "code", "error", "success", "warning"] as const) {
				for (const ground of [c.background, c.surface]) {
					const ratio = wcagContrast(c[key], ground);
					assert.ok(ratio >= AA_TEXT, `${id}: ${key} ${c[key]} on ${ground} = ${ratio.toFixed(2)}`);
				}
			}
			for (const key of ["accent", "border"] as const) {
				const ratio = wcagContrast(c[key], c.background);
				assert.ok(ratio >= AA_UI, `${id}: ${key} vs background = ${ratio.toFixed(2)}`);
			}
			const n = CEL_NEUTRALS[mode];
			assert.deepEqual(
				[c.background, c.surface, c.text, c.textMuted, c.border],
				[n.bg, n.surface1, n.text, n.textMuted, n.edge],
				`${id} agrees with the cel neutrals`,
			);
		}
		assert.equal(BUILTIN_THEMES.filter((x) => themeFamily(x) === "cel").length, 2);
	});
});

/* ----------------------------------------------------------- the family */

describe("theme family — file format and root attributes", () => {
	const noite = BUILTIN_THEMES.find((x) => x.id === "cel-noite")!;

	it("classic is the default; the attribute is always present", () => {
		assert.equal(themeFamily(DEFAULT_THEME), "classic");
		assert.deepEqual(themeRootAttributes(DEFAULT_THEME), { "data-theme-family": "classic" });
		assert.deepEqual(themeRootAttributes(noite), { "data-theme-family": "cel" });
	});

	it("parse keeps cel, normalizes classic to absent, rejects anything else", () => {
		const file = { name: "Minha Cel", mode: "dark", colors: { ...noite.colors } };
		const cel = parseThemeFile({ ...file, family: "cel" });
		assert.ok(cel.ok && cel.theme.family === "cel");
		const classic = parseThemeFile({ ...file, family: "classic" });
		assert.ok(classic.ok && !("family" in classic.theme));
		const bad = parseThemeFile({ ...file, family: "anime" });
		assert.ok(!bad.ok && /family/.test(bad.error));
	});

	it("export keeps the family, so a cel theme re-imports as cel", () => {
		const exported = exportThemeFile(noite, undefined);
		assert.equal(exported.family, "cel");
		const back = parseThemeFile(JSON.parse(JSON.stringify(exported)));
		assert.ok(back.ok && back.theme.family === "cel");
		assert.equal(exportThemeFile(DEFAULT_THEME, undefined).family, undefined);
	});
});

/* ------------------------------------------------------------ properties */

describe("wcagContrast — algebra (fast-check)", () => {
	const hex = fc
		.tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }))
		.map(([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`);

	it("is symmetric, bounded by [1, 21] and 1 against itself", () => {
		fc.assert(
			fc.property(hex, hex, (a, b) => {
				const ab = wcagContrast(a, b);
				assert.equal(ab, wcagContrast(b, a));
				assert.ok(ab >= 1 && ab <= 21 + 1e-9);
				assert.equal(wcagContrast(a, a), 1);
			}),
		);
	});

	it("any color reaches ≥ 4.5 against black or white (ink choice always exists)", () => {
		fc.assert(fc.property(hex, (a) => Math.max(wcagContrast(a, "#000000"), wcagContrast(a, "#ffffff")) >= 4.5));
	});

	it("#rgb expands like #rrggbb", () => {
		fc.assert(
			fc.property(fc.constantFrom(..."0123456789abcdef"), fc.constantFrom(..."0123456789abcdef"), fc.constantFrom(..."0123456789abcdef"), (r, g, b) => {
				assert.deepEqual(hexChannels(`#${r}${g}${b}`), hexChannels(`#${r}${r}${g}${g}${b}${b}`));
			}),
		);
		assert.throws(() => hexChannels("rgb(0 0 0)"));
	});
});
