/**
 * SI quantity parsing/formatting for numeric grading (docs/impl/lesson.md;
 * SÍNTESE §1.3 numeric items with units; r1 §9.1 prefix errors).
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fc from "fast-check";
import { formatQuantity, parseNumber, parseQuantity, parseUnitExpression, scaleByPowerOfTen, SI_UNITS, type SiUnit } from "../src/core/lesson/units.ts";

function approx(actual: number, expected: number, rel = 1e-12): void {
	assert.ok(Math.abs(actual - expected) <= rel * Math.max(1e-300, Math.abs(expected)), `${actual} ≉ ${expected}`);
}

describe("parseQuantity", () => {
	const cases: Array<[string, number, SiUnit | null]> = [
		["4.7 kΩ", 4700, "Ω"],
		["4,7 kΩ", 4700, "Ω"],
		["4700 ohm", 4700, "Ω"],
		["4700ohms", 4700, "Ω"],
		["5 kohm", 5000, "Ω"],
		["4,7 quilo-ohms", 4700, "Ω"],
		["2,2mA", 0.0022, "A"],
		["2.2 mA", 0.0022, "A"],
		["3 miliampères", 0.003, "A"],
		["10 µF", 0.00001, "F"],
		["10 μF", 0.00001, "F"],
		["10 uF", 0.00001, "F"],
		["47 pF", 4.7e-11, "F"],
		["10 mH", 0.01, "H"],
		["1 kHz", 1000, "Hz"],
		["10 MHz", 1e7, "Hz"],
		["5 W", 5, "W"],
		["3 µs", 3e-6, "s"],
		["  12V ", 12, "V"],
		["-3,3 V", -3.3, "V"],
		["1,5 × 10³ Hz", 1500, "Hz"],
		["4,7·10⁻³ F", 0.0047, "F"],
		["10 x 10^3 Hz", 10000, "Hz"],
		["1,2e-3 A", 0.0012, "A"],
		["4 700 Ω", 4700, "Ω"],
		["1.000.000 Ω", 1e6, "Ω"],
		["4.700,5 V", 4700.5, "V"],
		["1,000.5", 1000.5, null],
		["4k7", 4700, null],
		["1M5", 1.5e6, null],
		["3", 3, null],
		// Review additions: leading decimal mark and the IEC "kilohm"/"megohm" spellings.
		[".5 V", 0.5, "V"],
		[",5 A", 0.5, "A"],
		["4,7 kilohms", 4700, "Ω"],
		["2,2 quilohm", 2200, "Ω"],
		["1 megohm", 1e6, "Ω"],
		["470 microhms", 470e-6, "Ω"],
	];
	for (const [input, value, unit] of cases) {
		test(JSON.stringify(input), () => {
			const q = parseQuantity(input);
			assert.ok(q, `could not parse ${input}`);
			approx(q.value, value);
			assert.equal(q.unit, unit);
		});
	}

	test("4.7 kΩ and 4700 ohm are the same quantity", () => {
		const a = parseQuantity("4.7 kΩ");
		const b = parseQuantity("4700 ohm");
		assert.ok(a && b);
		assert.equal(a.unit, b.unit);
		approx(a.value, b.value);
	});

	test("10 µF is exact (no float drift from 10 × 1e-6)", () => {
		assert.equal(parseQuantity("10 µF")?.value, 0.00001);
		assert.equal(scaleByPowerOfTen(10, -6), 0.00001);
	});

	test("a lone separator is the decimal mark", () => {
		assert.equal(parseQuantity("4,700")?.value, 4.7);
		assert.equal(parseNumber("2,5"), 2.5);
	});

	test("prefix case matters: m is milli, M is mega; unknown units are rejected", () => {
		assert.equal(parseQuantity("10 mhz")?.value, 0.01);
		for (const bad of ["", "abc", "4,7 kX", "10 mS", "1/2 V", "4.7.1 V", "k"]) assert.equal(parseQuantity(bad), null, bad);
	});

	test("parseUnitExpression", () => {
		assert.deepEqual(parseUnitExpression("kΩ"), { unit: "Ω", exponent: 3 });
		assert.deepEqual(parseUnitExpression("mA"), { unit: "A", exponent: -3 });
		assert.deepEqual(parseUnitExpression(""), { unit: null, exponent: 0 });
	});
});

describe("formatQuantity", () => {
	test("engineering notation with SI prefixes", () => {
		assert.equal(formatQuantity(4700, "Ω"), "4,7 kΩ");
		assert.equal(formatQuantity(4700, "Ω", { locale: "en" }), "4.7 kΩ");
		assert.equal(formatQuantity(0.0022, "A"), "2,2 mA");
		assert.equal(formatQuantity(1e-5, "F"), "10 µF");
		assert.equal(formatQuantity(3670, "Ω", { digits: 4 }), "3,67 kΩ");
		assert.equal(formatQuantity(0, "V"), "0 V");
	});

	test("property: parse(format(x)) recovers x in both locales", () => {
		const exponents = [-12, -9, -6, -3, 0, 3, 6];
		fc.assert(
			fc.property(
				fc.integer({ min: 100, max: 99_999 }),
				fc.constantFrom(...exponents),
				fc.constantFrom(...SI_UNITS),
				fc.constantFrom("pt-BR" as const, "en" as const),
				(mantissa, exponent, unit, locale) => {
					const value = scaleByPowerOfTen(mantissa, exponent - 2);
					const text = formatQuantity(value, unit, { locale, digits: 6 });
					const back = parseQuantity(text);
					assert.ok(back, text);
					assert.equal(back.unit, unit);
					approx(back.value, value, 1e-9);
				},
			),
			{ numRuns: 300 },
		);
	});
});
