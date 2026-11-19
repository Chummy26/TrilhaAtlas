/**
 * <Icon> — the hand-inked cel icon set (estudos-sota M8 — SÍNTESE §2.12;
 * r9 §7.4 and §8). Renders the compiled layers of components/icons/
 * generated.ts bottom to top: fill → shade (flat tones, hard 45°
 * terminator) → on-fill ink (strokes drawn over the tone: --cel-on-fill,
 * "texto sobre cor é sempre tinta") → ink (the hand-drawn outline,
 * currentColor) → hl (specular, only ≥20 px and only on objects that carry
 * one). Without tones (`tone={false}`, classic themes) the on-fill strokes
 * are plain ink.
 *
 *   <Icon name="xp" size={24} />                 its own tone (XP grape)
 *   <Icon name="book" tone="coral" soft />       a pinned, pale tone
 *   <Icon name="search" className="size-4" />    16 px → the micro ink
 *   <Icon name="mic" live />                     3-frame boil (recording)
 *   <Icon name="warning" title="Atenção" />      informative: role="img"
 *
 * Color comes only from currentColor and CSS custom properties
 * (`--icon-fill/-shade/-ink/-hl`, components/icons/tones.ts), so the icon
 * follows the theme: in a cel theme it is toned; in the classic themes the
 * tone tokens are undefined and it degrades to a clean line icon.
 *
 * Accessibility (r9 §8.4): decorative by default (`aria-hidden`); pass
 * `title` for a standalone informative icon (role="img" + <title>); an
 * icon-only button labels the BUTTON, not the icon.
 *
 * No hooks, no state: a server- and client-safe function component.
 */

import type { CSSProperties, SVGProps } from "react";
import { ICONS, resolveIconName, type IconAlias, type IconName } from "./generated.ts";
import { layerPaint, toneVars, type IconTone } from "./tones.ts";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name" | "children" | "fill" | "stroke" | "title"> {
	/** Icon (or alias) to draw. */
	name: IconName | IconAlias;
	/** Rendered size in px (also picks the LOD: ≤16 → micro ink, <20 → no
	 *  specular). Default: the `size-N` Tailwind class when present, else 24. */
	size?: number;
	/** `false` = ink only; a tone name pins the ramp; default: the icon's own tone. */
	tone?: IconTone | boolean;
	/** Paint the fill with the pale `hl` tone instead of the base (selected/inactive chrome). */
	soft?: boolean;
	/** Accessible name; when set the icon is announced (role="img"). */
	title?: string;
	/** Force (true) or forbid (false) the micro ink; default: by size. */
	micro?: boolean;
	/** Live state (thinking, recording): the 3-frame boil, when the icon has frames. */
	live?: boolean;
}

/** `size-4` → 16, `size-3.5` → 14 (Tailwind's 4 px spacing unit). */
export function sizeFromClassName(className: string | undefined): number | undefined {
	const m = className ? /(?:^|\s)size-(\d+(?:\.\d+)?)(?:\s|$)/.exec(className) : null;
	return m ? Number(m[1]) * 4 : undefined;
}

/** The drawing behind a name or alias; throws on an unknown name. */
export function iconLayers(name: string) {
	const resolved = resolveIconName(name);
	if (!resolved) throw new Error(`Ícone desconhecido: "${name}"`);
	return ICONS[resolved];
}

export function Icon({ name, size, tone = true, soft = false, title, micro, live = false, className, style, ...rest }: IconProps) {
	const icon = iconLayers(name);
	const px = size ?? sizeFromClassName(className) ?? 24;
	const useMicro = icon.micro !== undefined && (micro ?? px <= 16);
	const ink = useMicro ? icon.micro! : icon.ink;
	const inkOnFill = useMicro ? icon.microOnFill : icon.inkOnFill;
	const toned = tone !== false && icon.fill !== undefined;
	const ownTone = icon.tone ?? "accent";
	const pinned: IconTone | null = typeof tone === "string" ? tone : soft ? ownTone : null;
	const vars = toned && pinned ? (toneVars(pinned, soft) as CSSProperties) : undefined;
	const paint = (layer: "fill" | "shade" | "ink" | "hl") => ({ fill: layerPaint(layer, ownTone) });
	// Over a colored tone the on-fill strokes are ink; with no tone under
	// them (tone={false}) they are ordinary ink. A pinned tone decides too
	// (the neutral surface keeps currentColor).
	const onFillPaint = { fill: toned ? layerPaint("onFill", pinned ?? ownTone) : layerPaint("ink") };
	const boil = live && icon.boil && !useMicro ? icon.boil : null;
	const frames = boil ? [ink, boil[0], boil[1]] : null;
	const onFillFrames = boil && inkOnFill ? [inkOnFill, icon.boilOnFill?.[0] || inkOnFill, icon.boilOnFill?.[1] || inkOnFill] : null;
	const g = icon.grid;
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox={`0 0 ${g} ${g}`}
			width={px}
			height={px}
			className={className}
			style={vars ? { ...vars, ...style } : style}
			focusable="false"
			data-icon={name}
			{...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
			{...rest}
		>
			{title ? <title>{title}</title> : null}
			{toned && icon.fill ? <path d={icon.fill} style={paint("fill")} /> : null}
			{toned && icon.shade ? <path d={icon.shade} style={paint("shade")} /> : null}
			{onFillFrames ? (
				<g className="cel-boil">
					{onFillFrames.map((d, i) => (
						<path key={i} d={d} style={onFillPaint} />
					))}
				</g>
			) : inkOnFill ? (
				<path d={inkOnFill} style={onFillPaint} />
			) : null}
			{frames ? (
				<g className="cel-boil">
					{frames.map((d, i) => (
						<path key={i} d={d} style={paint("ink")} />
					))}
				</g>
			) : ink ? (
				<path d={ink} style={paint("ink")} />
			) : null}
			{toned && icon.hl && px >= 20 ? <path d={icon.hl} style={paint("hl")} /> : null}
		</svg>
	);
}
