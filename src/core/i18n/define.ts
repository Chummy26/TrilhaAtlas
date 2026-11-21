import type { TranslatedLocale } from "./locales.ts";

/**
 * One message namespace = ONE FILE holding every locale side by side.
 *
 *   export default defineMessages({
 *     en:      { "save": "Save", "files": "{count, plural, one {# file} other {# files}}" },
 *     "pt-BR": { "save": "Salvar", "files": "{count, plural, one {# arquivo} other {# arquivos}}" },
 *     ...
 *   });
 *
 * English (`en`) is written first and fixes the key set. Each translated
 * locale must provide EXACTLY those keys: a missing key, an extra key or a
 * missing locale is a compile error, and a new entry in LOCALES breaks the
 * build of every namespace until it is translated.
 */
export type NamespaceMessages<E extends Record<string, string>> =
	{ en: E } & { [L in TranslatedLocale]: { [K in keyof NoInfer<E>]: string } };

export function defineMessages<const E extends Record<string, string>>(messages: NamespaceMessages<E>): NamespaceMessages<E> {
	return messages;
}
