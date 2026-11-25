import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../components/i18n.tsx";
import {
	LanguageWelcomeBody,
	detectPreferredLocale,
	shouldShowLanguageWelcome,
} from "../components/language-welcome-dialog.tsx";
import { LOCALES, NAMESPACES, buildLocaleDictionary } from "../src/core/index.ts";

test("shouldShowLanguageWelcome only triggers on first launch when language is unset", () => {
	assert.equal(shouldShowLanguageWelcome(null), true);
	assert.equal(shouldShowLanguageWelcome({ version: 1 }), true);
	assert.equal(shouldShowLanguageWelcome({ version: 1, general: { autoUpdate: true } }), true);
	assert.equal(shouldShowLanguageWelcome({ version: 1, general: { language: "en" } }), false);
	assert.equal(shouldShowLanguageWelcome({ version: 1, general: { language: "pt-BR" } }), false);
	assert.equal(shouldShowLanguageWelcome(undefined), false);
});

test("detectPreferredLocale picks the first supported browser/OS language", () => {
	assert.equal(detectPreferredLocale(["pt-BR", "en-US"]), "pt-BR");
	assert.equal(detectPreferredLocale(["pt-PT", "en-US"]), "pt-BR");
	assert.equal(detectPreferredLocale(["ko-KR", "ja-JP"]), "ja");
	assert.equal(detectPreferredLocale(["ru-RU", "zh-CN"]), null);
	assert.equal(detectPreferredLocale([]), null);
	assert.equal(detectPreferredLocale(null), null);
});

test("LanguageWelcomeBody renders every supported locale in its native label and translates chrome", () => {
	const html = renderToStaticMarkup(
		<I18nProvider initialLocale="pt-BR" initialMessages={buildLocaleDictionary(NAMESPACES, "pt-BR")}>
			<LanguageWelcomeBody
				selected="pt-BR"
				saving={false}
				error={null}
				titleId="lang-title"
				descriptionId="lang-desc"
				onSelect={() => {}}
				onConfirm={() => {}}
			/>
		</I18nProvider>,
	);
	assert.match(html, /Escolha seu idioma/);
	assert.match(html, /Continuar/);
	for (const locale of LOCALES) {
		assert.ok(html.includes(locale.label), `missing native label for ${locale.code}`);
		assert.ok(html.includes(`data-testid="language-welcome-option-${locale.code}"`));
	}
	assert.match(html, /data-testid="language-welcome-option-pt-BR"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-testid="language-welcome-option-pt-BR"/);
});
