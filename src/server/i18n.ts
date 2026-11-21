/**
 * Server-side interface language. The saved preference lives in the settings
 * record (general.language); English when unset. Read per call, not cached:
 * the file read is cheap and the user can change language at any moment.
 */

import {
	NAMESPACES,
	buildLocaleDictionary,
	createTranslator,
	resolveLocale,
	type Locale,
	type LocaleDictionary,
	type MessageKey,
	type MessageParams,
	type Translator,
} from "../core/index.ts";
import { readSettings } from "../store/settings.ts";

const DICT_CACHE_KEY = Symbol.for("lh.i18n.localeDictionaries");
const globalStore = globalThis as Record<symbol, Map<Locale, LocaleDictionary> | undefined>;

function dictCache(): Map<Locale, LocaleDictionary> {
	return (globalStore[DICT_CACHE_KEY] ??= new Map());
}

export function currentLocale(): Locale {
	return resolveLocale(readSettings()?.general?.language);
}

/** Flat message dictionary for ONE locale, cached per locale across route chunks. */
export function localeDictionary(locale: Locale = currentLocale()): LocaleDictionary {
	const resolved = resolveLocale(locale);
	const cache = dictCache();
	let dict = cache.get(resolved);
	if (!dict) {
		dict = Object.freeze(buildLocaleDictionary(NAMESPACES, resolved));
		cache.set(resolved, dict);
	}
	return dict;
}

/** Translator for the language chosen right now. */
export function serverTranslator(): Translator {
	return createTranslator(currentLocale());
}

/** One-shot translate for error messages and API payloads. */
export function serverT(key: MessageKey, params?: MessageParams): string {
	return serverTranslator()(key, params);
}
