import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	DEFAULT_LOCALE, LOCALES, NAMESPACES, SOURCE_LOCALE, TRANSLATED_LOCALES,
	createTranslator, formatMessage, matchLocale, messageParamNames, resolveLocale,
	type Locale,
} from "../src/core/index.ts";

const records = (locale: Locale): Array<[string, Record<string, string>]> =>
	Object.entries(NAMESPACES).map(([name, namespace]) => [name, (namespace as Record<Locale, Record<string, string>>)[locale]]);

describe("interface languages", () => {
	it("English is the source and the default", () => {
		assert.equal(SOURCE_LOCALE, "en");
		assert.equal(DEFAULT_LOCALE, "en");
		assert.equal(LOCALES[0].code, "en");
		assert.equal(new Set(LOCALES.map(locale => locale.code)).size, LOCALES.length);
		assert.deepEqual(TRANSLATED_LOCALES, LOCALES.map(locale => locale.code).filter(code => code !== "en"));
	});

	it("resolves preferences defensively", () => {
		assert.equal(resolveLocale("ja"), "ja");
		assert.equal(resolveLocale("xx"), "en");
		assert.equal(resolveLocale(undefined), "en");
		assert.equal(matchLocale("pt-PT"), "pt-BR");
		assert.equal(matchLocale("de-AT"), "de");
		assert.equal(matchLocale("zz"), null);
	});

	for (const [name, namespace] of Object.entries(NAMESPACES)) {
		describe(`namespace ${name}`, () => {
			const source = (namespace as Record<Locale, Record<string, string>>).en;
			for (const locale of TRANSLATED_LOCALES) {
				it(`${locale} has exactly the English keys, placeholders and no blanks`, () => {
					const translated = (namespace as Record<Locale, Record<string, string>>)[locale];
					assert.deepEqual(Object.keys(translated).sort(), Object.keys(source).sort(), `${name}.${locale} key set differs from English`);
					for (const [key, english] of Object.entries(source)) {
						const value = translated[key]!;
						assert.ok(value.trim().length > 0, `${name}.${key} is empty in ${locale}`);
						assert.deepEqual(messageParamNames(value), messageParamNames(english), `${name}.${key} placeholders differ in ${locale}`);
					}
				});
			}
			it("English messages are not blank", () => {
				for (const [key, value] of Object.entries(source)) assert.ok(value.trim().length > 0, `${name}.${key} is empty`);
			});
		});
	}

	it("every locale of every namespace is registered", () => {
		for (const locale of LOCALES) for (const [name, values] of records(locale.code)) assert.ok(values, `${name} lacks ${locale.code}`);
	});

	it("formats placeholders and plurals per locale", () => {
		assert.equal(formatMessage("en", "Hello {name}", { name: "Ana" }), "Hello Ana");
		const files = "{count, plural, =0 {No files} one {# file} other {# files}}";
		assert.equal(formatMessage("en", files, { count: 0 }), "No files");
		assert.equal(formatMessage("en", files, { count: 1 }), "1 file");
		assert.equal(formatMessage("en", files, { count: 1200 }), "1,200 files");
		assert.equal(formatMessage("ja", "{count, plural, other {#件}}", { count: 3 }), "3件");
		assert.equal(formatMessage("en", "Hi {missing}", {}), "Hi {missing}");
		assert.deepEqual(messageParamNames("{a} {n, plural, one {# of {b}} other {#}}"), ["a", "b", "n"]);
	});

	it("falls back to the key instead of throwing", () => {
		const t = createTranslator("de");
		assert.equal(t("common.action.save"), "Speichern");
		assert.equal(t("nope.nothing" as never), "nope.nothing");
		assert.equal(createTranslator("en")("common.action.save"), "Save");
	});
});
