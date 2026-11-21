"use client";

import { LOCALES, isLocale, type Locale } from "@/src/core";
import { useT } from "@/components/i18n";
import { SettingsRow, ThinSelect } from "./controls.tsx";

/** Interface language. Names are shown in their own language so a lost user can always find theirs. */
export function LanguageSetting({ value, onChange }: { value: Locale; onChange: (next: Locale) => void }) {
	const t = useT();
	return (
		<SettingsRow label={t("common.language.label")} hint={t("common.language.hint")} testid="row-language">
			<ThinSelect value={value} ariaLabel={t("common.language.label")} testid="language-select" onChange={(next) => { if (isLocale(next)) onChange(next); }}>
				{LOCALES.map((locale) => <option key={locale.code} value={locale.code} lang={locale.code}>{locale.label}</option>)}
			</ThinSelect>
		</SettingsRow>
	);
}
