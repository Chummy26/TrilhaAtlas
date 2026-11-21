/**
 * Interface locales. ENGLISH IS THE SOURCE LANGUAGE: every message is written
 * in `en` first, and every other locale must carry exactly the same keys
 * (enforced by the types in ./define.ts and by tests/i18n.test.ts).
 *
 * To add a language: append it here. `npm run typecheck` then fails on every
 * message namespace that has not translated it yet, so nothing is forgotten.
 * Pure and browser-safe.
 */

export const LOCALES = [
	{ code: "en", label: "English", dir: "ltr" },
	{ code: "pt-BR", label: "Português (Brasil)", dir: "ltr" },
	{ code: "es", label: "Español", dir: "ltr" },
	{ code: "fr", label: "Français", dir: "ltr" },
	{ code: "de", label: "Deutsch", dir: "ltr" },
	{ code: "ja", label: "日本語", dir: "ltr" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];

/** The source language; also the fallback when a key is somehow missing. */
export const SOURCE_LOCALE = "en" satisfies Locale;
/** What an unset or invalid preference resolves to. */
export const DEFAULT_LOCALE: Locale = SOURCE_LOCALE;

/** Every locale except the source: the ones that are translations. */
export type TranslatedLocale = Exclude<Locale, typeof SOURCE_LOCALE>;
export const TRANSLATED_LOCALES: readonly TranslatedLocale[] = LOCALES
	.map(locale => locale.code)
	.filter((code): code is TranslatedLocale => code !== SOURCE_LOCALE);

export function isLocale(value: unknown): value is Locale {
	return LOCALES.some(locale => locale.code === value);
}

/** Invalid, missing or unsupported values fall back to the default. */
export function resolveLocale(value: unknown): Locale {
	return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** Best match for a browser/OS language tag such as "pt-PT" or "ja-JP". */
export function matchLocale(tag: string | null | undefined): Locale | null {
	if (!tag) return null;
	const lower = tag.toLowerCase();
	const exact = LOCALES.find(locale => locale.code.toLowerCase() === lower);
	if (exact) return exact.code;
	const base = lower.split("-")[0];
	return LOCALES.find(locale => locale.code.toLowerCase().split("-")[0] === base)?.code ?? null;
}

/** BCP-47 tag for Intl/Date formatting. */
export function intlLocale(locale: Locale): string {
	return locale;
}
