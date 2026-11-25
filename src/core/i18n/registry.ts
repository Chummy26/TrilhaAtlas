import { formatMessage, type MessageParams } from "./translate.ts";
import { DEFAULT_LOCALE, SOURCE_LOCALE, type Locale } from "./locales.ts";
import common from "./messages/common.ts";
import shell from "./messages/shell.ts";
import chat from "./messages/chat.ts";
import session from "./messages/session.ts";
import composer from "./messages/composer.ts";
import dialogs from "./messages/dialogs.ts";
import plugins from "./messages/plugins.ts";
import settings from "./messages/settings.ts";
import map from "./messages/map.ts";
import course from "./messages/course.ts";
import lesson from "./messages/lesson.ts";
import pages from "./messages/pages.ts";
import server from "./messages/server.ts";
import core from "./messages/core.ts";
import intensive from "./messages/intensive.ts";

/**
 * Every message namespace. A new area adds ONE file under ./messages and ONE
 * line here; the types below then derive `MessageKey` from the English source.
 */
export const NAMESPACES = { common, shell, chat, session, composer, dialogs, plugins, settings, map, course, lesson, pages, server, core, intensive } as const;

export type Namespace = keyof typeof NAMESPACES;
type SourceMessages<N extends Namespace> = (typeof NAMESPACES)[N]["en"];

/** "namespace.key", derived from the English source: a typo is a compile error. */
export type MessageKey = { [N in Namespace]: `${N}.${Extract<keyof SourceMessages<N>, string>}` }[Namespace];

export type Translator = (key: MessageKey, params?: MessageParams) => string;

type Dictionary = Record<string, Record<string, string> | undefined>;

function lookup(locale: Locale, key: string): string | undefined {
	const dot = key.indexOf(".");
	if (dot < 1) return undefined;
	const namespace = (NAMESPACES as Record<string, Record<string, unknown>>)[key.slice(0, dot)] as Dictionary | undefined;
	return namespace?.[locale]?.[key.slice(dot + 1)] ?? namespace?.[SOURCE_LOCALE]?.[key.slice(dot + 1)];
}

const translators = new Map<Locale, Translator>();

/** Cached translator for a locale. Falls back to English, then to the key itself, never throws. */
export function createTranslator(locale: Locale = DEFAULT_LOCALE): Translator {
	let translator = translators.get(locale);
	if (!translator) {
		translator = (key, params) => formatMessage(locale, lookup(locale, key) ?? key, params);
		translators.set(locale, translator);
	}
	return translator;
}

/** Whether a runtime string is a known message key (for keys stored in data, e.g. error codes). */
export function isMessageKey(value: string): value is MessageKey {
	return lookup(SOURCE_LOCALE, value) !== undefined;
}
