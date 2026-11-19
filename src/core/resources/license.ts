/**
 * License normalization for open resources (SÍNTESE §2.8 "Livros: abertos";
 * r6 §9.1 "guardar a licença por recurso" and §9.2 license column).
 *
 * Catalogs spell licenses in many ways: OpenStax CMS ("Creative Commons
 * Attribution-NonCommercial-ShareAlike License"), the OpenStax archive (a CC
 * URL), LibreTexts codes ("ccbyncsa", "gnufdl", "publicdomain"), OTL free text
 * ("CC BY-NC-SA"), Wikibooks ("CC BY-SA 4.0"). `parseLicense` maps all of them
 * to one `License` with the NC/SA/ND flags the app needs to decide whether a
 * text may be bundled (only non-NC) or must be fetched at runtime.
 *
 * Pure: browser-safe.
 */

import type { License } from "./types.ts";

interface CcFlags {
	nc: boolean;
	sa: boolean;
	nd: boolean;
}

function ccName(flags: CcFlags, version: string | undefined): string {
	const parts = ["BY"];
	if (flags.nc) parts.push("NC");
	if (flags.sa) parts.push("SA");
	if (flags.nd) parts.push("ND");
	return `CC ${parts.join("-")}${version ? ` ${version}` : ""}`;
}

function ccLicense(flags: CcFlags, version: string | undefined, url?: string): License {
	const code = ["by", flags.nc ? "nc" : "", flags.sa ? "sa" : "", flags.nd ? "nd" : ""].filter(Boolean).join("-");
	const v = version ?? "4.0";
	return {
		name: ccName(flags, version),
		spdx: `CC-${code.toUpperCase()}-${v}`,
		url: url ?? `https://creativecommons.org/licenses/${code}/${v}/`,
		nonCommercial: flags.nc,
		shareAlike: flags.sa,
		noDerivs: flags.nd,
	};
}

const UNKNOWN: License = { name: "Licença não informada (verificar na fonte)" };

/** Parse a free-form license string or URL into a License. Unknown input → a
 *  "not informed" license (callers must then treat the content as protected). */
export function parseLicense(raw: string | null | undefined, url?: string): License {
	const text = `${raw ?? ""} ${url ?? ""}`.trim();
	if (!text) return { ...UNKNOWN };
	const lower = text.toLowerCase();
	const version = lower.match(/(\d\.\d)/)?.[1];

	if (/publicdomain|public domain|domínio público|dominio publico|\bpd\b|cc0|zero\/1\.0/.test(lower)) {
		const isCc0 = /cc0|zero\/1\.0/.test(lower);
		return {
			name: isCc0 ? "CC0 1.0" : "Domínio público",
			...(isCc0 ? { spdx: "CC0-1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/" } : {}),
			publicDomain: true,
		};
	}
	if (/gnu ?fdl|gfdl|free documentation/.test(lower)) {
		return { name: "GNU FDL", spdx: "GFDL-1.3-or-later", shareAlike: true };
	}

	// URL form: creativecommons.org/licenses/by-nc-sa/4.0/
	const urlCode = lower.match(/creativecommons\.org\/licenses\/([a-z-]+)\/?(\d\.\d)?/);
	if (urlCode?.[1]) {
		const code = urlCode[1];
		return ccLicense({ nc: code.includes("nc"), sa: code.includes("sa"), nd: code.includes("nd") }, urlCode[2] ?? version, url);
	}

	// Compact codes: ccbyncsa, cc-by-nc-sa, CC BY-NC-SA
	const compact = lower.replace(/[\s_\-]+/g, "");
	const codeMatch = compact.match(/ccby((?:nc|sa|nd)*)/);
	if (codeMatch) {
		const rest = codeMatch[1] ?? "";
		return ccLicense({ nc: rest.includes("nc"), sa: rest.includes("sa"), nd: rest.includes("nd") }, version, url);
	}

	// Long names: "Creative Commons Attribution-NonCommercial-ShareAlike"
	if (lower.includes("creative commons") || lower.includes("attribution")) {
		return ccLicense(
			{
				nc: /non-?commercial/.test(lower),
				sa: /share-?alike/.test(lower),
				nd: /no-?deriv/.test(lower),
			},
			version,
			url,
		);
	}
	if (/all rights reserved|todos os direitos|copyright/.test(lower)) {
		return { name: "Todos os direitos reservados", proprietary: true };
	}
	return { name: (raw ?? url ?? "").trim() || UNKNOWN.name, ...(url ? { url } : {}) };
}

/** True when the license lets the text be shipped inside the app (open and
 *  commercial use allowed). NC content is fetched at runtime only (§2.8). */
export function isBundleable(license: License): boolean {
	if (license.proprietary) return false;
	if (license.publicDomain) return true;
	return Boolean(license.spdx?.startsWith("CC-BY")) && !license.nonCommercial;
}

/** True when the license is an open (CC/PD/GFDL) license at all. */
export function isOpenLicense(license: License): boolean {
	if (license.proprietary) return false;
	return Boolean(license.publicDomain || license.spdx?.startsWith("CC") || license.spdx?.startsWith("GFDL"));
}
