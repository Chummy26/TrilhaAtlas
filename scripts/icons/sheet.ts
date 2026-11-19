/**
 * CONTACT SHEET for the cel icons (estudos-sota M8 — SÍNTESE §2.12; r9 §7.4
 * and §13 phase 7: "revisão visual da folha de contato"). Compiles the
 * defs and rasterizes every icon with @resvg/resvg-js on Papel (light) and
 * Noite (dark) at 48 / 24 / 16 px (16 px uses the micro ink), with the real
 * tone hexes from src/core/themes.ts — the review artifact a human (or
 * the reviewing agent) looks at before a skeleton is accepted.
 *
 *   npx tsx scripts/icons/sheet.ts [--out sheet.png] [--only a,b] [--big] [--soft] [--boil]
 *
 * Writes to the OS temp dir by default, never into the repo.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { CEL_DOMAIN_RAMPS, CEL_METALS, CEL_NEUTRALS, CEL_RAMPS, CEL_STATUS_RAMPS, type ThemeMode } from "../../src/core/themes.ts";
import type { IconTone } from "../../components/icons/tones.ts";
import { compileIcon, type CompiledIcon } from "./compile.ts";
import { ICON_DEFS } from "./defs/index.ts";
import { inkVariant } from "./emit.ts";

type Paint = { base: string; shade: string; hl: string };

/** The hex ramp a tone resolves to in `mode` (default domain: electronics). */
export function toneHex(tone: IconTone, mode: ThemeMode): Paint {
	const n = CEL_NEUTRALS[mode];
	if (tone === "neutral") return { base: n.surface1, shade: n.surface1Shade, hl: n.surface1 };
	if (tone === "accent") return CEL_RAMPS[CEL_DOMAIN_RAMPS.electronics];
	if (tone in CEL_STATUS_RAMPS) return CEL_RAMPS[CEL_STATUS_RAMPS[tone as keyof typeof CEL_STATUS_RAMPS]];
	if (tone in CEL_RAMPS) return CEL_RAMPS[tone as keyof typeof CEL_RAMPS];
	return CEL_METALS[tone as keyof typeof CEL_METALS];
}

function nested(icon: CompiledIcon, x: number, y: number, size: number, paint: { ink: string; onFill: string; fill: string; shade: string; hl: string }, micro: boolean, frame = 0): string {
	const [ink, onFill] = inkVariant(icon, micro ? "micro" : frame === 1 ? "boil1" : frame === 2 ? "boil2" : "regular");
	const g = icon.grid;
	return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 ${g} ${g}">${icon.fill ? `<path d="${icon.fill}" fill="${paint.fill}"/>` : ""}${icon.shade ? `<path d="${icon.shade}" fill="${paint.shade}"/>` : ""}${onFill ? `<path d="${onFill}" fill="${paint.onFill}"/>` : ""}<path d="${ink}" fill="${paint.ink}"/>${icon.hl && size >= 20 ? `<path d="${icon.hl}" fill="${paint.hl}"/>` : ""}</svg>`;
}

function main(argv: string[]): void {
	const arg = (flag: string) => {
		const i = argv.indexOf(flag);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	const only = arg("--only")?.split(",").map((s) => s.trim()).filter(Boolean);
	const big = argv.includes("--big");
	const soft = argv.includes("--soft");
	const boil = argv.includes("--boil");
	const out = arg("--out") ?? path.join(os.tmpdir(), "cel-icons-sheet.png");
	const names = (only ?? Object.keys(ICON_DEFS).sort()).filter((n) => {
		if (!ICON_DEFS[n]) throw new Error(`ícone desconhecido: ${n}`);
		return true;
	});
	const icons = names.map((n) => ({ icon: compileIcon(n, ICON_DEFS[n]!), tone: ICON_DEFS[n]!.tone ?? "accent" }));
	const L = big ? 96 : 48;
	const cellW = big ? L * 2 + 40 : 150;
	const half = big ? L + 16 : 60;
	const cellH = half * 2 + 18;
	const cols = Math.max(1, Math.min(big ? 5 : 9, icons.length));
	const rows = Math.ceil(icons.length / cols);
	const W = cols * cellW;
	const H = rows * cellH;
	const parts: string[] = [`<rect width="${W}" height="${H}" fill="#d8d4ca"/>`];
	icons.forEach(({ icon, tone }, i) => {
		const x0 = (i % cols) * cellW;
		const y0 = Math.floor(i / cols) * cellH;
		(["light", "dark"] as const).forEach((mode, m) => {
			const n = CEL_NEUTRALS[mode];
			const t = toneHex(tone, mode);
			// Ink over a colored tone is --cel-on-fill; over the neutral surface it stays the text color.
			const onFill = tone === "neutral" ? n.text : n.onFill;
			const paint = { ink: n.text, onFill, fill: soft ? t.hl : t.base, shade: t.shade, hl: mode === "light" ? "#ffffff" : "#ffffffd9" };
			const y = y0 + m * half;
			parts.push(`<rect x="${x0 + 1}" y="${y + 1}" width="${cellW - 2}" height="${half - 2}" fill="${n.bg}"/>`);
			if (big) {
				parts.push(nested(icon, x0 + 8, y + 8, L, paint, false, 0));
				parts.push(nested(icon, x0 + 16 + L, y + 8 + L / 4, L / 2, paint, false, 0));
				parts.push(nested(icon, x0 + 24 + L + L / 2, y + 8 + L / 3, 16, paint, true));
			} else {
				parts.push(nested(icon, x0 + 6, y + 6, 48, paint, false, 0));
				parts.push(nested(icon, x0 + 62, y + 18, 24, paint, false, boil ? 1 : 0));
				parts.push(nested(icon, x0 + 94, y + 18, 24, paint, false, boil ? 2 : 0));
				parts.push(nested(icon, x0 + 124, y + 22, 16, paint, true));
			}
		});
		parts.push(`<text x="${x0 + 6}" y="${y0 + cellH - 5}" font-family="Arial" font-size="11" fill="#1e1b2e">${icon.name}</text>`);
	});
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
	const png = new Resvg(svg, { font: { loadSystemFonts: true }, fitTo: { mode: "original" } }).render().asPng();
	fs.writeFileSync(out, png);
	console.log(`folha: ${out} (${icons.length} ícones, ${W}×${H})`);
}

main(process.argv.slice(2));
