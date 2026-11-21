import { formatMessage, type MessageParams } from "./translate.ts";
import { DEFAULT_LOCALE, SOURCE_LOCALE, type Locale } from "./locales.ts";
import type { MessageKey, Translator } from "./registry.ts";

/** Flat `{ "namespace.key": translatedTemplate }` map for a single active locale. */
export type LocaleDictionary = Readonly<Record<string, string>>;

/**
 * Pure, tiny translator backed by a single-locale flat dictionary.
 * Does NOT import `registry.ts` or any `messages/*.ts` file, keeping all
 * inactive locales out of client bundles.
 */
export function createDictionaryTranslator(
	locale: Locale = DEFAULT_LOCALE,
	dict: LocaleDictionary = {},
): Translator {
	return (key: MessageKey, params?: MessageParams) => {
		const template = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key]! : key;
		return formatMessage(locale, template, params);
	};
}

/**
 * Build a flat `{ "namespace.key": template }` map for ONE locale from a
 * namespace table (passed in by server callers so this module stays leaf-only).
 */
export function buildLocaleDictionary(
	namespaces: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>>,
	locale: Locale,
	fallbackLocale: Locale = SOURCE_LOCALE,
): Record<string, string> {
	const flat: Record<string, string> = {};
	for (const [namespace, locales] of Object.entries(namespaces)) {
		const source = locales[fallbackLocale];
		const target = locales[locale];
		if (!source) continue;
		for (const key of Object.keys(source)) {
			flat[`${namespace}.${key}`] = target?.[key] ?? source[key]!;
		}
	}
	return flat;
}
