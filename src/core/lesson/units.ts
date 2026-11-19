/**
 * SI quantities for electronics answers (docs/research/00-SINTESE.md §1.3
 * "Eletrônica: NumericTemplate com tolerância", §2.4(c) "correção
 * determinística … numeric (tolerância rel/abs, unidade)"; r1 §9.1 "Parser de
 * unidades: aceitar 4.7k, 4,7 kΩ, 4700, 4k7 (notação RKM), µ/u; exigir unidade
 * quando o item pede").
 *
 * Units:    V · A · Ω (also "ohm", "ohms", U+2126) · F · H · Hz · W · s
 * Prefixes: p n µ/μ/u m k (K accepted) M G — CASE-SENSITIVE: "mA" is milli,
 *           "MA" is mega. Electronics punishes a wrong prefix, so the parser
 *           never "fixes" one (the grader reports it as `prefix_error`).
 * Numbers:  "4.7", "4,7" (pt-BR decimal comma), "1.000.000" / "1,000,000"
 *           (≥2 thousand groups), "4 700" (space-grouped), "4.7e3",
 *           "4,7×10^3", "4,7·10⁻³", RKM "4k7" / "2R2" / "1M5".
 * Spelled:  "quilo-ohms", "kiloohm", "kilohm", "megohm", "miliampères",
 *           "microfarad", "megahertz", "volts", "segundos" … (accent/case-
 *           insensitive). A leading decimal mark (".5 V", ",5 A") is read.
 *
 * Ambiguity policy (documented choice, pt-BR first): a LONE separator is the
 * decimal point — "4,700" = "4.700" = 4.7. Only two or more thousand groups
 * ("1.000.000", "1,000,000") or mixed separators ("4.700,5", "4,700.5") are
 * read as thousands grouping.
 *
 * Pure and browser-safe.
 */

export const SI_UNITS = ["V", "A", "Ω", "F", "H", "Hz", "W", "s"] as const;
export type SiUnit = (typeof SI_UNITS)[number];

/** Engineering prefixes, exponent of ten (formatting order). */
export const SI_PREFIX_EXPONENTS: Readonly<Record<string, number>> = Object.freeze({
	p: -12,
	n: -9,
	µ: -6,
	m: -3,
	"": 0,
	k: 3,
	M: 6,
	G: 9,
});

export interface Quantity {
	/** Value in SI base units (prefix and ×10^n applied). */
	value: number;
	/** Recognized unit, or null for a bare / prefix-only number. */
	unit: SiUnit | null;
	/** Whether an SI prefix (or RKM multiplier) scaled the number. */
	prefixed: boolean;
}

export interface UnitExpression {
	unit: SiUnit | null;
	/** Power of ten from the prefix (0 when none): "k" → 3, "µ" → −6. */
	exponent: number;
}

/** Symbol prefixes → power of ten (after NFKC, the micro sign is U+03BC). */
const PREFIX_EXPONENTS: Readonly<Record<string, number>> = Object.freeze({
	p: -12,
	n: -9,
	μ: -6,
	u: -6,
	m: -3,
	k: 3,
	K: 3,
	M: 6,
	G: 9,
});

/** Unit spellings recognized after an optional symbol prefix (case-sensitive table). */
const UNIT_SYMBOLS: Readonly<Record<string, SiUnit>> = Object.freeze({
	V: "V",
	v: "V",
	A: "A",
	a: "A",
	Ω: "Ω",
	ohm: "Ω",
	ohms: "Ω",
	Ohm: "Ω",
	Ohms: "Ω",
	F: "F",
	f: "F",
	H: "H",
	h: "H",
	Hz: "Hz",
	hz: "Hz",
	HZ: "Hz",
	W: "W",
	w: "W",
	s: "s",
});

const SPELLED_PREFIXES: ReadonlyArray<readonly [string, number]> = [
	["pico", -12],
	["nano", -9],
	["micro", -6],
	["milli", -3],
	["mili", -3],
	["quilo", 3],
	["kilo", 3],
	["mega", 6],
	// "megohm" (IEC spelling) drops the "a" of "mega".
	["meg", 6],
	["giga", 9],
];

const SPELLED_UNITS: ReadonlyArray<readonly [RegExp, SiUnit]> = [
	[/^volts?$/, "V"],
	[/^(amperes?|amps?)$/, "A"],
	[/^ohms?$/, "Ω"],
	[/^farads?$/, "F"],
	[/^(henrys?|henries)$/, "H"],
	[/^hertz$/, "Hz"],
	[/^watts?$/, "W"],
	[/^(segundos?|seconds?|secs?)$/, "s"],
];

const SUPERSCRIPTS: Readonly<Record<string, string>> = Object.freeze({
	"⁰": "0",
	"¹": "1",
	"²": "2",
	"³": "3",
	"⁴": "4",
	"⁵": "5",
	"⁶": "6",
	"⁷": "7",
	"⁸": "8",
	"⁹": "9",
	"⁻": "-",
	"⁺": "+",
});

const SUPERSCRIPT_RUN = /[⁻⁺]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g;
const RKM = /^([+-]?)(\d+)([pnμumkKMGR])(\d+)(.*)$/s;
/** A number at the head of the text; a leading decimal mark (".5", ",5") included. */
const NUMBER_HEAD = /^([+-]?(?:\d[\d.,\u0020]*\d|\d|[.,]\d+)(?:[eE][+-]?\d+)?)(.*)$/s;
const TIMES_TEN = /^\s*[x×*·]\s*10\s*\^\s*\(?\s*([+-]?\d+)\s*\)?(.*)$/s;
const TRAILING_PUNCTUATION = /[\s.;:!?)\]]+$/;

/** Pre-normalization: superscript exponents → "^n", NFKC (Ω sign, micro sign, NBSP), Unicode minus. */
function normalizeInput(input: string): string {
	const withCarets = input.replace(SUPERSCRIPT_RUN, (run) => `^${[...run].map((c) => SUPERSCRIPTS[c] ?? c).join("")}`);
	return withCarets
		.normalize("NFKC")
		.replace(/[\u2212\u2012\u2013]/g, "-")
		.replace(/[\u00A0\u202F\u2009]/g, " ")
		.trim();
}

/**
 * Parse a plain number with pt-BR/EN separators (no unit). Returns null when
 * the text is not exactly one number.
 */
export function parseNumber(text: string): number | null {
	let token = normalizeInput(text);
	if (!token) return null;
	const exponentMatch = /^(.*?)([eE][+-]?\d+)$/.exec(token);
	const exponent = exponentMatch?.[2] ?? "";
	token = exponentMatch?.[1] ?? token;
	const sign = token.startsWith("-") ? "-" : "";
	if (token.startsWith("-") || token.startsWith("+")) token = token.slice(1);
	if (!/^[\d.,\u0020]+$/.test(token) || !/\d/.test(token)) return null;

	let digits: string;
	if (token.includes(" ")) {
		const m = /^(\d{1,3}(?: \d{3})+)([.,]\d+)?$/.exec(token);
		if (!m) return null;
		digits = (m[1] ?? "").replace(/ /g, "") + (m[2] ? `.${m[2].slice(1)}` : "");
	} else if (token.includes(",") && token.includes(".")) {
		const decimal = token.lastIndexOf(",") > token.lastIndexOf(".") ? "," : ".";
		const thousands = decimal === "," ? "." : ",";
		const [intPart, fracPart, ...rest] = token.split(decimal);
		if (rest.length > 0 || intPart === undefined || fracPart === undefined || !/^\d+$/.test(fracPart)) return null;
		const groups = intPart.split(thousands);
		if (!/^\d{1,3}$/.test(groups[0] ?? "") || groups.slice(1).some((g) => !/^\d{3}$/.test(g))) return null;
		digits = `${groups.join("")}.${fracPart}`;
	} else {
		const separator = token.includes(",") ? "," : token.includes(".") ? "." : "";
		if (!separator) {
			digits = token;
		} else {
			const groups = token.split(separator);
			const thousandsGrouped = groups.length >= 3 && /^\d{1,3}$/.test(groups[0] ?? "") && groups.slice(1).every((g) => /^\d{3}$/.test(g));
			if (thousandsGrouped) digits = groups.join("");
			else if (groups.length === 2 && /^\d*$/.test(groups[0] ?? "") && /^\d+$/.test(groups[1] ?? "")) digits = `${groups[0] || "0"}.${groups[1]}`;
			else return null;
		}
	}
	const value = Number(`${sign}${digits}${exponent}`);
	return Number.isFinite(value) ? value : null;
}

/** x·10^e without the binary drift of multiplying by 1e-6 (10·1e-6 ≠ 1e-5; 10/1e6 = 1e-5). */
export function scaleByPowerOfTen(x: number, exponent: number): number {
	if (exponent === 0) return x;
	return exponent > 0 ? x * 10 ** exponent : x / 10 ** -exponent;
}

/** Parse a unit expression such as "kΩ", "mA", "MHz", "uF", "kohms", "quilo-ohm", "k" (prefix only) or "". */
export function parseUnitExpression(text: string): UnitExpression | null {
	const raw = normalizeInput(text).replace(TRAILING_PUNCTUATION, "");
	if (raw === "") return { unit: null, exponent: 0 };
	const compact = raw.replace(/\s+/g, "");
	const direct = UNIT_SYMBOLS[compact];
	if (direct) return { unit: direct, exponent: 0 };
	const prefixExponent = PREFIX_EXPONENTS[compact.slice(0, 1)];
	if (prefixExponent !== undefined) {
		const rest = compact.slice(1);
		if (rest === "") return { unit: null, exponent: prefixExponent };
		const unit = UNIT_SYMBOLS[rest];
		if (unit) return { unit, exponent: prefixExponent };
	}
	return parseSpelledUnit(raw);
}

function parseSpelledUnit(raw: string): UnitExpression | null {
	const folded = raw
		.normalize("NFKD")
		.replace(/\p{M}+/gu, "")
		.toLowerCase()
		.replace(/[\s-]+/g, "");
	for (const [word, exponent] of SPELLED_PREFIXES) {
		if (folded.startsWith(word)) {
			const rest = folded.slice(word.length);
			// Elided "o": "kilohm", "quilohm", "microhm" (a prefix ending in "o" + "hm").
			const unit = matchSpelledUnit(rest) ?? (word.endsWith("o") && /^hms?$/.test(rest) ? "Ω" : null);
			if (unit) return { unit, exponent };
		}
	}
	const unit = matchSpelledUnit(folded);
	return unit ? { unit, exponent: 0 } : null;
}

function matchSpelledUnit(word: string): SiUnit | null {
	for (const [pattern, unit] of SPELLED_UNITS) if (pattern.test(word)) return unit;
	return null;
}

/**
 * Parse a learner's quantity ("4,7 kΩ", "2,2mA", "4k7", "4.7e3 ohm",
 * "10 µF", "1,5 × 10³ Hz"). Returns null when no number + recognizable unit
 * can be read.
 */
export function parseQuantity(input: string): Quantity | null {
	const text = normalizeInput(input);
	if (!text) return null;

	const rkm = RKM.exec(text);
	if (rkm) {
		const [, sign = "", whole = "", mult = "", frac = "", rest = ""] = rkm;
		const unitExpr = parseUnitExpression(rest);
		const exponent = mult === "R" ? 0 : PREFIX_EXPONENTS[mult];
		if (unitExpr && unitExpr.exponent === 0 && exponent !== undefined) {
			const mantissa = Number(`${sign}${whole}.${frac}`);
			if (Number.isFinite(mantissa)) return { value: scaleByPowerOfTen(mantissa, exponent), unit: unitExpr.unit, prefixed: mult !== "R" };
		}
	}

	// NUMBER_HEAD ends on a digit, so "4 700 Ω" keeps the grouped number whole
	// while "4 kΩ" leaves the space on the unit side.
	const head = NUMBER_HEAD.exec(text);
	if (!head) return null;
	const mantissa = parseNumber(head[1] ?? "");
	if (mantissa === null) return null;
	let rest = head[2] ?? "";
	let scientific = 0;
	const timesTen = TIMES_TEN.exec(rest);
	if (timesTen) {
		scientific = Number(timesTen[1]);
		rest = timesTen[2] ?? "";
	}
	const unitExpr = parseUnitExpression(rest);
	if (!unitExpr) return null;
	const value = scaleByPowerOfTen(mantissa, scientific + unitExpr.exponent);
	if (!Number.isFinite(value)) return null;
	return { value, unit: unitExpr.unit, prefixed: unitExpr.exponent !== 0 };
}

export interface FormatOptions {
	/** "pt-BR" (decimal comma, default) or "en". */
	locale?: "pt-BR" | "en";
	/** Significant digits (default 3). */
	digits?: number;
}

/** Engineering notation with an SI prefix: formatQuantity(4700, "Ω") → "4,7 kΩ". */
export function formatQuantity(value: number, unit: SiUnit | null, options: FormatOptions = {}): string {
	const { locale = "pt-BR", digits = 3 } = options;
	const suffix = unit ?? "";
	if (!Number.isFinite(value)) return `${value}${suffix ? ` ${suffix}` : ""}`;
	if (value === 0) return `0${suffix ? ` ${suffix}` : ""}`;
	let exponent = Math.floor(Math.log10(Math.abs(value)) / 3) * 3;
	exponent = Math.max(-12, Math.min(9, exponent));
	let mantissa = Number(scaleByPowerOfTen(value, -exponent).toPrecision(digits));
	if (Math.abs(mantissa) >= 1000 && exponent < 9) {
		exponent += 3;
		mantissa = Number(scaleByPowerOfTen(value, -exponent).toPrecision(digits));
	}
	const prefix = Object.entries(SI_PREFIX_EXPONENTS).find(([, e]) => e === exponent)?.[0] ?? "";
	const number = String(mantissa).replace(".", locale === "pt-BR" ? "," : ".");
	if (!unit) return exponent === 0 ? number : `${number}${prefix}`;
	return `${number} ${prefix}${unit}`;
}
