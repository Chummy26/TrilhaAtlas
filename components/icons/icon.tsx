/**
 * <Icon> — the hand-inked cel icon set (estudos-sota M8 — SÍNTESE §2.12;
 * r9 §7.4 and §8). References compiled `<symbol>` definitions in
 * `public/icons/sprite.svg` via `<use href>` and lightweight metadata in
 * `components/icons/meta.ts`, keeping ~171 KB of SVG path geometry out of JS
 * bundles while preserving exact cel layer order, LOD (`--micro`), live 3-frame
 * boil (`--boil`), tone pinning, specular gating (<20 px), and `tone={false}`
 * parity via CSS custom properties (`--icon-fill/-shade/-ink/-ink-on-fill/-hl`).
 *
 * Accessibility (r9 §8.4): decorative by default (`aria-hidden`); pass
 * `title` for a standalone informative icon (role="img" + <title>); an
 * icon-only button labels the BUTTON, not the icon.
 *
 * No hooks, no state: a server- and client-safe function component.
 */

import type { CSSProperties, SVGProps } from "react";
import { ICON_META, resolveIconName, type IconAlias, type IconMeta, type IconName } from "./meta.ts";
import { toneVars, type IconTone } from "./tones.ts";

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

/** Resolve an icon name or alias to its canonical name and metadata; throws on an unknown name. */
export function resolveIconMeta(name: string): { id: IconName; meta: IconMeta } {
	const id = resolveIconName(name);
	if (!id) throw new Error(`Ícone desconhecido: "${name}"`);
	return { id, meta: ICON_META[id] };
}

export function Icon({ name, size, tone = true, soft = false, title, micro, live = false, className, style, ...rest }: IconProps) {
	const { id, meta } = resolveIconMeta(name);
	const px = size ?? sizeFromClassName(className) ?? 24;
	const useMicro = Boolean(meta.hasMicro) && (micro ?? px <= 16);
	const useBoil = Boolean(live && meta.hasBoil && !useMicro);
	const symbolId = useMicro ? `${id}--micro` : useBoil ? `${id}--boil` : id;
	const ownTone = meta.tone ?? "accent";
	const toned = tone !== false && Boolean(meta.hasFill);
	const pinned: IconTone | null = typeof tone === "string" ? tone : soft ? ownTone : null;

	let vars: Record<string, string> | undefined;
	const setVar = (key: string, value: string) => {
		(vars ??= {})[key] = value;
	};

	if (tone === false && meta.hasFill) {
		setVar("--icon-fill", "transparent");
		setVar("--icon-shade", "transparent");
		setVar("--icon-ink-on-fill", "var(--icon-ink, currentColor)");
		if (meta.hasHl) setVar("--icon-hl", "transparent");
	} else if (toned) {
		if (pinned) {
			const ramp = toneVars(pinned, soft);
			setVar("--icon-fill", ramp["--icon-fill"]);
			setVar("--icon-shade", ramp["--icon-shade"]);
			if (pinned === "neutral") {
				setVar("--icon-ink-on-fill", "var(--icon-ink, currentColor)");
			}
		}
		if (meta.hasHl && px < 20) {
			setVar("--icon-hl", "transparent");
		}
	}

	const g = meta.grid;
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox={`0 0 ${g} ${g}`}
			width={px}
			height={px}
			className={className}
			style={vars ? { ...(vars as CSSProperties), ...style } : style}
			focusable="false"
			data-icon={name}
			{...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
			{...rest}
		>
			{title ? <title>{title}</title> : null}
			<use href={`/icons/sprite.svg#${symbolId}`} />
		</svg>
	);
}
