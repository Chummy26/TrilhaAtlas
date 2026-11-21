/**
 * Server-side interface language. The saved preference lives in the settings
 * record (general.language); English when unset. Read per call, not cached:
 * the file read is cheap and the user can change language at any moment.
 */

import { createTranslator, resolveLocale, type Locale, type MessageKey, type MessageParams, type Translator } from "../core/index.ts";
import { readSettings } from "../store/settings.ts";

export function currentLocale(): Locale {
	return resolveLocale(readSettings()?.general?.language);
}

/** Translator for the language chosen right now. */
export function serverTranslator(): Translator {
	return createTranslator(currentLocale());
}

/** One-shot translate for error messages and API payloads. */
export function serverT(key: MessageKey, params?: MessageParams): string {
	return serverTranslator()(key, params);
}
