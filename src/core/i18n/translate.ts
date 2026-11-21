import type { Locale } from "./locales.ts";

export type MessageParams = Record<string, string | number>;

const PLURAL = /\{(\w+),\s*plural,((?:\s*[=\w]+\s*\{(?:[^{}]|\{\w+\})*\})+)\s*\}/g;
const PLURAL_OPTION = /([=\w]+)\s*\{((?:[^{}]|\{\w+\})*)\}/g;
const PLACEHOLDER = /\{(\w+)\}/g;

const rules = new Map<Locale, Intl.PluralRules>();
const numbers = new Map<Locale, Intl.NumberFormat>();

function pluralRules(locale: Locale): Intl.PluralRules {
	let value = rules.get(locale);
	if (!value) rules.set(locale, value = new Intl.PluralRules(locale));
	return value;
}

function numberFormat(locale: Locale): Intl.NumberFormat {
	let value = numbers.get(locale);
	if (!value) numbers.set(locale, value = new Intl.NumberFormat(locale));
	return value;
}

/**
 * Small ICU subset, enough for an interface:
 *   "Hello {name}"                                  → placeholder
 *   "{count, plural, one {# file} other {# files}}" → plural (# = the number)
 *   "{count, plural, =0 {No files} one {# file} other {# files}}"
 * A placeholder without a matching param is left visible rather than lost.
 */
export function formatMessage(locale: Locale, template: string, params?: MessageParams): string {
	if (!params || !template.includes("{")) return template;
	const expanded = template.replace(PLURAL, (whole, name: string, options: string) => {
		const value = params[name];
		if (typeof value !== "number") return whole;
		const branches = new Map<string, string>();
		for (const match of options.matchAll(PLURAL_OPTION)) branches.set(match[1]!, match[2]!);
		const chosen = branches.get(`=${value}`) ?? branches.get(pluralRules(locale).select(value)) ?? branches.get("other") ?? "";
		return chosen.replaceAll("#", numberFormat(locale).format(value));
	});
	return expanded.replace(PLACEHOLDER, (whole, name: string) => {
		const value = params[name];
		return value === undefined ? whole : String(value);
	});
}

/** Names of every `{placeholder}` / plural variable a template uses, sorted. Used by the parity test. */
export function messageParamNames(template: string): string[] {
	const names = new Set<string>();
	for (const match of template.matchAll(PLURAL)) names.add(match[1]!);
	const withoutPlural = template.replace(PLURAL, (_whole, _name: string, options: string) =>
		[...options.matchAll(PLURAL_OPTION)].map(match => match[2]).join(" "));
	for (const match of withoutPlural.matchAll(/\{(\w+)\}/g)) names.add(match[1]!);
	return [...names].sort();
}
