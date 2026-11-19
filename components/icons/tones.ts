/**
 * ICON TONES (estudos-sota M8 — SÍNTESE §2.12; r9 §4.3–§4.4, §8.2–§8.3):
 * the named ramps an icon's flat tone layers can take. Each tone names the
 * three cel CSS tokens of its ramp (base fill, self-shadow, lit tone) as
 * defined by the cel block of app/globals.css. <Icon tone> turns a tone
 * into the `--icon-fill` / `--icon-shade` custom properties every layer
 * paints with (layerPaint below, shared by <Icon> and the sprite).
 *
 * Ink drawn OVER a colored tone (the `…OnFill` layers: letters, check
 * marks, clock hands) paints with --cel-on-fill — "texto sobre cor é
 * sempre tinta" (SÍNTESE §2.12) — so in Cel Noite it is dark ink on the
 * color while the outline stays chalk (currentColor) on the night ground.
 * Over the `neutral` tone (a night-dark surface) it stays currentColor.
 *
 * Three kinds of tone:
 *   - semantic: `accent` follows the active domain (`data-domain` swaps
 *     it: volt for Eletrônica, coral for Inglês); status and `xp` never
 *     follow the domain (r9 §4.4); `neutral` is the raised surface;
 *   - raw ramps (volt, coral, sky, mint, grape, rose, amber, teal): fixed
 *     colors for icons whose color IS their meaning (the domain emblems,
 *     the flame, the bulb);
 *   - metals (bronze … ruby): the rank insignias, one per tier (r9 §9.4).
 *
 * Outside a cel theme these tokens are undefined, so the tone layers
 * resolve to transparent: classic themes keep clean line icons.
 *
 * Pure and browser-safe (no React).
 */

/** The semantic tones. */
export const SEMANTIC_TONES = ["accent", "xp", "success", "warning", "danger", "info", "neutral"] as const;
/** The raw accent ramps (r9 §4.3). */
export const RAMP_TONES = ["volt", "coral", "sky", "mint", "grape", "rose", "amber", "teal"] as const;
/** The insignia metals, in tier order T1 … T7 (r9 §9.4). */
export const METAL_TONES = ["bronze", "silver", "gold", "jade", "sapphire", "amethyst", "ruby"] as const;

/** Every tone an icon can take. */
export const ICON_TONE_NAMES = [...SEMANTIC_TONES, ...RAMP_TONES, ...METAL_TONES] as const;

/** A tone name. */
export type IconTone = (typeof ICON_TONE_NAMES)[number];

/** The three CSS tokens of a tone's ramp. */
export interface ToneTokens {
	/** Base fill (the lit side of the terminator). */
	base: string;
	/** Self-shadow past the 45° terminator. */
	shade: string;
	/** Pale lit tone (selected chips, soft fills). */
	hl: string;
}

const ramp = (prefix: string): ToneTokens => ({ base: prefix, shade: `${prefix}-shade`, hl: `${prefix}-hl` });

function buildTones(): Readonly<Record<IconTone, ToneTokens>> {
	const out = {} as Record<IconTone, ToneTokens>;
	for (const t of SEMANTIC_TONES) out[t] = ramp(`--cel-${t}`);
	out.neutral = { base: "--cel-surface-1", shade: "--cel-surface-1-shade", hl: "--cel-surface-1" };
	for (const t of RAMP_TONES) out[t] = ramp(`--c-${t}`);
	for (const t of METAL_TONES) out[t] = ramp(`--c-${t}`);
	return out;
}

/** Tone → CSS custom property names (all defined in the cel block). */
export const ICON_TONES: Readonly<Record<IconTone, ToneTokens>> = buildTones();

/** Narrow an arbitrary value to a tone name. */
export function isIconTone(value: unknown): value is IconTone {
	return typeof value === "string" && (ICON_TONE_NAMES as readonly string[]).includes(value);
}

/**
 * The custom properties that paint an icon in `tone`: the base ramp color
 * fills the lit side and the ramp's shade fills the shadow side (r9 law 3:
 * two flat tones with a hard terminator). `soft` swaps the base for the
 * pale `hl` tone — for selected/inactive chrome where a full-strength fill
 * would compete with the content (r9 §8.3).
 */
export function toneVars(tone: IconTone, soft = false): Record<"--icon-fill" | "--icon-shade", string> {
	const t = ICON_TONES[tone];
	return { "--icon-fill": `var(${soft ? t.hl : t.base})`, "--icon-shade": `var(${t.shade})` };
}

/** The cel layers an icon paints, bottom to top (`onFill` = ink over the tone). */
export type IconLayer = "fill" | "shade" | "onFill" | "ink" | "hl";

/**
 * The CSS `fill` of one layer. A container (or <Icon tone>) may override
 * any layer through `--icon-fill/-shade/-ink/-ink-on-fill/-hl`; otherwise
 * the icon's default tone applies; outside a cel theme every tone token is
 * undefined and the layer falls back to transparent (ink and on-fill ink:
 * currentColor). Shared by <Icon> and public/icons/sprite.svg so both paint
 * identically. A container that repaints `--icon-fill` dark should also set
 * `--icon-ink-on-fill`.
 */
export function layerPaint(layer: IconLayer, tone: IconTone = "accent"): string {
	const t = ICON_TONES[tone];
	switch (layer) {
		case "fill":
			return `var(--icon-fill, var(${t.base}, transparent))`;
		case "shade":
			return `var(--icon-shade, var(${t.shade}, transparent))`;
		case "onFill":
			// The neutral tone is a surface (dark at night): ink stays ink there.
			return tone === "neutral" ? layerPaint("ink") : "var(--icon-ink-on-fill, var(--cel-on-fill, var(--icon-ink, currentColor)))";
		case "ink":
			return "var(--icon-ink, currentColor)";
		case "hl":
			return "var(--icon-hl, var(--cel-hl, transparent))";
	}
}
