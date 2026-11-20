/**
 * THE FIRST-PAINT THEME (theme wave, 2026-11-04): what app/layout.tsx puts
 * on <html> before any client code runs — the record's appearance, the
 * active theme (a preset or an imported file; Default when the id is gone)
 * and its color variables with every override applied. Read the record
 * and only the selected custom file (the layout calls connection()
 * first, so this never bakes into a prerender).
 */

import { FACTORY_SETTINGS, effectiveColors, isBuiltinThemeId, resolveTheme, themeVars, type AppearanceSettings, type Theme } from "../core/index.ts";
import { themeStore } from "../store/themes.ts";
import { readSettings } from "../store/settings.ts";

/** Everything the layout needs for a flash-free first paint. */
export interface ThemeBoot {
	settings: ReturnType<typeof readSettings>;
	appearance: AppearanceSettings | undefined;
	theme: Theme;
	/** The CSS variables for <html style>. */
	vars: Record<string, string>;
}

/** Read the record and selected custom file; resolve the active theme and its vars. */
export function readThemeBoot(): ThemeBoot {
	const settings = readSettings();
	const appearance = settings?.appearance;
	const id = appearance?.theme ?? FACTORY_SETTINGS.appearance.theme;
	const custom = id && !isBuiltinThemeId(id) ? themeStore.readTheme(id) : null;
	const theme = resolveTheme(id, custom ? [custom] : []);
	return { settings, appearance, theme, vars: { ...themeVars(effectiveColors(theme, appearance), theme.mode), "--lh-prose-size": (appearance?.proseFontSize ?? FACTORY_SETTINGS.appearance.proseFontSize) + "px" } };
}
