/** Ideal unloaded two-resistor DC divider. Source points from ground to supply in CircuitJS. */
export function dividerLab(volts: number, upperOhms: number, lowerOhms: number) {
	if (![volts, upperOhms, lowerOhms].every(Number.isFinite) || volts < 0 || volts > 24 ||
		[upperOhms, lowerOhms].some(value => value < 1 || value > 1e7)) throw new RangeError("Parâmetros fora da faixa do laboratório.");
	const amps = volts / (upperOhms + lowerOhms);
	const circuit = [
		"$ 1 0.000005 10 50 5 50", "v 112 368 112 48 0 0 40 " + volts + " 0 0 0.5",
		"w 112 48 240 48 0", "r 240 48 240 208 0 " + upperOhms, "r 240 208 240 368 0 " + lowerOhms,
		"w 240 368 112 368 0", "g 112 368 112 400 0", "O 240 208 304 208 1",
	].join("\n");
	return { voltsOut: amps * lowerOhms, milliamps: amps * 1000,
		netlist: ["Divisor resistivo ideal", "V1 in 0 DC " + volts, "R1 in out " + upperOhms,
			"R2 out 0 " + lowerOhms, ".op", ".end", ""].join("\n"),
		falstad: "https://www.falstad.com/circuit/circuitjs.html?cct=" + encodeURIComponent(circuit) };
}
