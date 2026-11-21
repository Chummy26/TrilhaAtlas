"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
	DEFAULT_LOCALE,
	createDictionaryTranslator,
	createTranslator,
	intlLocale,
	type Locale,
	type LocaleDictionary,
	type Translator,
} from "@/src/core";

interface I18nValue {
	locale: Locale;
	/** Translate a message key; English fallback, then the key itself. */
	t: Translator;
	/** BCP-47 tag for Intl.* / toLocaleString. */
	intl: string;
	/** Applies immediately when cached, otherwise fetches the active locale dictionary. */
	setLocale: (locale: Locale) => void;
}

const clientDictionaryCache = new Map<Locale, LocaleDictionary>();

function fallbackTranslator(locale: Locale): Translator {
	// Next.js folds `process.env.NODE_ENV === "test"` to `false` in dev/prod
	// bundles so `createTranslator` and all 6 locale tables are tree-shaken out
	// of client JS while Node/SSR unit tests retain synchronous translations.
	if (process.env.NODE_ENV === "test") {
		return createTranslator(locale);
	}
	return createDictionaryTranslator(locale, {});
}

const FALLBACK: I18nValue = {
	locale: DEFAULT_LOCALE,
	t: fallbackTranslator(DEFAULT_LOCALE),
	intl: intlLocale(DEFAULT_LOCALE),
	setLocale: () => {},
};
const I18nContext = createContext<I18nValue>(FALLBACK);

async function fetchLocaleDictionary(locale: Locale): Promise<LocaleDictionary | null> {
	const cached = clientDictionaryCache.get(locale);
	if (cached) return cached;
	try {
		const response = await fetch(`/api/i18n?locale=${encodeURIComponent(locale)}`);
		if (!response.ok) return null;
		const payload = (await response.json()) as { messages?: unknown };
		if (!payload?.messages || typeof payload.messages !== "object" || Array.isArray(payload.messages)) return null;
		const dict = payload.messages as LocaleDictionary;
		clientDictionaryCache.set(locale, dict);
		return dict;
	} catch {
		return null;
	}
}

/** The server reads the saved language and supplies only that locale's flat
 *  dictionary, so first paint has zero flash and client chunks carry zero
 *  inactive locale tables. Without a provider (tests), English. */
export function I18nProvider({
	initialLocale,
	initialMessages,
	children,
}: {
	initialLocale: Locale;
	initialMessages?: LocaleDictionary;
	children: ReactNode;
}) {
	if (initialMessages && !clientDictionaryCache.has(initialLocale)) {
		clientDictionaryCache.set(initialLocale, initialMessages);
	}
	const [state, setState] = useState<{ locale: Locale; messages?: LocaleDictionary }>(() => ({
		locale: initialLocale,
		messages: initialMessages ?? clientDictionaryCache.get(initialLocale),
	}));
	const requestSeq = useRef(0);

	// Self-heal if mounted in the browser without SSR-injected initialMessages.
	useEffect(() => {
		if (process.env.NODE_ENV === "test") return;
		if (state.messages) return;
		const ticket = ++requestSeq.current;
		let alive = true;
		void fetchLocaleDictionary(state.locale).then((dict) => {
			if (!alive || !dict || requestSeq.current !== ticket) return;
			setState((prev) => (prev.locale === state.locale ? { locale: prev.locale, messages: dict } : prev));
		});
		return () => { alive = false; };
	}, [state.locale, state.messages]);

	const setLocale = useCallback((next: Locale) => {
		if (typeof document !== "undefined") document.documentElement.lang = next;
		const cached = clientDictionaryCache.get(next);
		if (cached || process.env.NODE_ENV === "test") {
			requestSeq.current++;
			setState({ locale: next, messages: cached });
			return;
		}
		const ticket = ++requestSeq.current;
		void fetchLocaleDictionary(next).then((dict) => {
			if (requestSeq.current !== ticket) return;
			setState({ locale: next, messages: dict ?? undefined });
		});
	}, []);

	const value = useMemo<I18nValue>(() => {
		const t = state.messages
			? createDictionaryTranslator(state.locale, state.messages)
			: fallbackTranslator(state.locale);
		return { locale: state.locale, t, intl: intlLocale(state.locale), setLocale };
	}, [state.locale, state.messages, setLocale]);

	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
	return useContext(I18nContext);
}

/** Shorthand for components that only need the translator. */
export function useT(): Translator {
	return useContext(I18nContext).t;
}
