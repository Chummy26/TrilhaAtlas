/**
 * Ordinal emission tables and the grader confusion model (r2 §9.4, §9.11;
 * docs/research/00-SINTESE.md §2.6 "Emissões ordinais").
 *
 * A grade ŷ ∈ {0,1,2,3} is emitted by the latent K = L ∧ M ("knows now"):
 *   e1(y) = P(y | K=1), e0(y) = P(y | K=0).
 * Three regimes:
 *   • delayed open answer      — e1 / e0 (default tables of §9.4);
 *   • immediate open answer    — e1 / e0Immediate, when the check comes
 *     ≤ immediateMinutes after the lesson ("checagem logo após explicar
 *     quase não conta": LR(3) = 2.6 instead of 8.1);
 *   • MCQ with k options       — e1 = [0.08,0,0,0.92], e0 = [1−1/k,0,0,1/k];
 *     grades collapse to 0 (wrong) / 3 (right) for the lookup.
 *
 * Grader noise: κ = 0.6 + 0.35·confidence (κ = 1 when deterministic: MCQ,
 * numeric or confidence = 1). C(ŷ | y) = κ on the diagonal, (1−κ) split
 * evenly between the neighbours (all of it to the single neighbour at the
 * edges), and ẽ_k(ŷ) = Σ_y e_k(y)·C(ŷ | y).
 *
 * Non-degeneracy (r10 §3.5; Baker, Corbett & Aleven 2008): with the binary
 * collapse S = P(ŷ ≤ 1 | K=1), G = P(ŷ ≥ 2 | K=0) we require G + S ≤ 1, and the
 * likelihood ratio ẽ1/ẽ0 must be non-decreasing in ŷ (a better grade is never
 * weaker evidence). `assertEmissionValid` enforces both.
 */

import type { EmissionParams, Grade, ItemFormat } from "./types.ts";

export type Emission4 = readonly [number, number, number, number];

export const DEFAULT_EMISSION: EmissionParams = {
	e1: [0.07, 0.08, 0.2, 0.65],
	e0: [0.55, 0.25, 0.12, 0.08],
	e0Immediate: [0.35, 0.2, 0.2, 0.25],
	immediateMinutes: 20,
};

/** P(wrong | knows) for MCQ (r2 §9.4 table). */
export const MCQ_SLIP = 0.08;
export const DEFAULT_MCQ_OPTIONS = 4;

/** Formats graded deterministically (κ = 1). */
const DETERMINISTIC_FORMATS: ReadonlySet<ItemFormat> = new Set<ItemFormat>(["mcq", "numeric"]);

export class EmissionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EmissionError";
	}
}

/** κ = 0.6 + 0.35·conf, or 1 for deterministic grading. */
export function graderKappa(confidence: number, deterministic: boolean): number {
	if (deterministic || confidence >= 1) return 1;
	const c = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0;
	return 0.6 + 0.35 * c;
}

export function isDeterministicFormat(format: ItemFormat): boolean {
	return DETERMINISTIC_FORMATS.has(format);
}

/** Row-stochastic confusion C[y][ŷ] = P(ŷ | y). */
export function confusionMatrix(kappa: number): number[][] {
	if (!(kappa >= 0 && kappa <= 1)) throw new EmissionError(`κ fora de [0,1]: ${kappa}`);
	const off = 1 - kappa;
	const rows: number[][] = [];
	for (let y = 0; y < 4; y++) {
		const row = [0, 0, 0, 0];
		row[y] = kappa;
		if (y === 0) row[1] = off;
		else if (y === 3) row[2] = off;
		else {
			row[y - 1] = off / 2;
			row[y + 1] = off / 2;
		}
		rows.push(row);
	}
	return rows;
}

/** ẽ(ŷ) = Σ_y e(y)·C(ŷ | y). */
export function noisyEmission(e: Emission4, kappa: number): Emission4 {
	if (kappa === 1) return e;
	const c = confusionMatrix(kappa);
	const out = [0, 0, 0, 0];
	for (let y = 0; y < 4; y++) {
		const row = c[y] as number[];
		for (let yh = 0; yh < 4; yh++) out[yh] = (out[yh] as number) + (e[y] as number) * (row[yh] as number);
	}
	return out as unknown as Emission4;
}

export function mcqTables(options: number = DEFAULT_MCQ_OPTIONS): { e1: Emission4; e0: Emission4 } {
	const k = Number.isInteger(options) && options >= 2 ? options : DEFAULT_MCQ_OPTIONS;
	return { e1: [MCQ_SLIP, 0, 0, 1 - MCQ_SLIP], e0: [1 - 1 / k, 0, 0, 1 / k] };
}

export interface EmissionContext {
	format: ItemFormat;
	minutesSinceExposure: number;
	graderConfidence: number;
	/** MCQ option count. */
	options?: number;
}

export interface ResolvedEmission {
	/** Noisy tables ẽ1, ẽ0. */
	e1: Emission4;
	e0: Emission4;
	kappa: number;
	immediate: boolean;
	/** Index into the tables for a grade (MCQ collapses to 0/3). */
	index: (grade: Grade) => number;
}

/** Pick the regime for an observation and apply the grader confusion. */
export function resolveEmission(params: EmissionParams, ctx: EmissionContext): ResolvedEmission {
	const deterministic = isDeterministicFormat(ctx.format);
	const kappa = graderKappa(ctx.graderConfidence, deterministic);
	if (ctx.format === "mcq") {
		const t = mcqTables(ctx.options);
		return { e1: t.e1, e0: t.e0, kappa: 1, immediate: false, index: (g) => (g >= 2 ? 3 : 0) };
	}
	const immediate = ctx.minutesSinceExposure <= params.immediateMinutes;
	const e1 = noisyEmission(params.e1, kappa);
	const e0 = noisyEmission(immediate ? params.e0Immediate : params.e0, kappa);
	return { e1, e0, kappa, immediate, index: (g) => g };
}

/** Binary collapse: S = P(ŷ ≤ 1 | K=1), G = P(ŷ ≥ 2 | K=0). */
export function slipGuess(e1: Emission4, e0: Emission4): { slip: number; guess: number } {
	return { slip: e1[0] + e1[1], guess: e0[2] + e0[3] };
}

function assertDistribution(name: string, e: Emission4): void {
	let sum = 0;
	for (const v of e) {
		if (!(v >= 0 && v <= 1)) throw new EmissionError(`${name}: probabilidade fora de [0,1] (${v}).`);
		sum += v;
	}
	if (Math.abs(sum - 1) > 1e-9) throw new EmissionError(`${name}: soma ${sum} ≠ 1.`);
}

/** Monotone likelihood ratio (cross-multiplied, zero-safe): ẽ1(j)·ẽ0(i) ≥ ẽ1(i)·ẽ0(j) for all i < j. */
function assertMonotoneRatio(name: string, e1: Emission4, e0: Emission4): void {
	for (let i = 0; i < 4; i++) {
		for (let j = i + 1; j < 4; j++) {
			const lhs = (e1[j] as number) * (e0[i] as number);
			const rhs = (e1[i] as number) * (e0[j] as number);
			if (lhs + 1e-12 < rhs) throw new EmissionError(`${name}: razão de verossimilhança decresce entre as notas ${i} e ${j}.`);
		}
	}
}

/** Validate a pair of tables: distributions, MLRP and G + S ≤ 1. */
export function assertTablesValid(name: string, e1: Emission4, e0: Emission4): void {
	assertDistribution(`${name}.e1`, e1);
	assertDistribution(`${name}.e0`, e0);
	assertMonotoneRatio(name, e1, e0);
	const { slip, guess } = slipGuess(e1, e0);
	if (guess + slip > 1 + 1e-12) throw new EmissionError(`${name}: degenerado (G + S = ${(guess + slip).toFixed(4)} > 1).`);
}

/** Validate all regimes of an EmissionParams (delayed, immediate, MCQ). */
export function assertEmissionValid(params: EmissionParams): void {
	assertTablesValid("emissão atrasada", params.e1, params.e0);
	assertTablesValid("emissão imediata", params.e1, params.e0Immediate);
	const mcq = mcqTables();
	assertTablesValid("emissão MCQ", mcq.e1, mcq.e0);
	if (!(params.immediateMinutes >= 0)) throw new EmissionError(`immediateMinutes inválido: ${params.immediateMinutes}`);
}
