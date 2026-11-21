"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LOCALE, createTranslator, intlLocale, type Locale, type Translator } from "@/src/core";

interface I18nValue {
	locale: Locale;
	/** Translate a message key; English fallback, then the key itself. */
	t: Translator;
	/** BCP-47 tag for Intl.* / toLocaleString. */
	intl: string;
	/** Applies immediately; persisting it is the caller's job (settings → general.language). */
	setLocale: (locale: Locale) => void;
}

const FALLBACK: I18nValue = { locale: DEFAULT_LOCALE, t: createTranslator(DEFAULT_LOCALE), intl: intlLocale(DEFAULT_LOCALE), setLocale: () => {} };
const I18nContext = createContext<I18nValue>(FALLBACK);

/** The server reads the saved language, so the first paint is already in it. Without a provider (tests), English. */
export function I18nProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
	const [locale, apply] = useState<Locale>(initialLocale);
	const setLocale = useCallback((next: Locale) => {
		apply(next);
		if (typeof document !== "undefined") document.documentElement.lang = next;
	}, []);
	const value = useMemo<I18nValue>(() => ({ locale, t: createTranslator(locale), intl: intlLocale(locale), setLocale }), [locale, setLocale]);
	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
	return useContext(I18nContext);
}

/** Shorthand for components that only need the translator. */
export function useT(): Translator {
	return useContext(I18nContext).t;
}
