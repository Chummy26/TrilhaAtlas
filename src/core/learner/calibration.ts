/**
 * Calibration of the learner model's predictions (r2 §9.12; srs-benchmark
 * metrics). Before each observation the integration records
 * `predicted = P(ŷ ≥ 2)` (elo.ts `predictCorrect`); afterwards the outcome is
 * y = 1[ŷ ≥ 2]. Per time window we report:
 *   • log loss  −mean[y·ln p + (1−y)·ln(1−p)]  (p clipped to [1e-6, 1−1e-6]);
 *   • AUC       Mann–Whitney with average ranks for ties (null when a window
 *               has a single class);
 *   • RMSE(bins) equal-width bins of p, weighted by bin size;
 *   • baselines AVG (mean outcome of everything BEFORE the window) and
 *               MOVING-AVG (running mean of past outcomes, point in time),
 *               both as log loss — the model must beat them to be trusted.
 * Pure: windows are aligned to the first point (or `from`) and use `windowDays`.
 */

import { DAY_MS, toMs } from "./math.ts";
import type { LearnerEvent } from "./types.ts";

export interface CalibrationPoint {
	at: string;
	predicted: number;
	outcome: 0 | 1;
}

export interface CalibrationWindow {
	start: string;
	end: string;
	n: number;
	positives: number;
	logLoss: number | null;
	auc: number | null;
	rmseBins: number | null;
	/** Log loss of predicting the mean outcome observed before the window. */
	avgBaselineLogLoss: number | null;
	/** Log loss of predicting the running mean of past outcomes. */
	movingAvgLogLoss: number | null;
}

const EPS = 1e-6;

function clipP(p: number): number {
	return Math.min(1 - EPS, Math.max(EPS, p));
}

/** Evidence with a recorded prediction → calibration points (time order). */
export function calibrationPoints(events: readonly LearnerEvent[]): CalibrationPoint[] {
	const out: CalibrationPoint[] = [];
	for (const ev of events) {
		if (ev.kind !== "evidence") continue;
		const e = ev.evidence;
		if (e.predicted === undefined || !Number.isFinite(e.predicted)) continue;
		out.push({ at: e.at, predicted: e.predicted, outcome: e.grade >= 2 ? 1 : 0 });
	}
	return out.sort((a, b) => toMs(a.at) - toMs(b.at));
}

export function logLoss(points: readonly { predicted: number; outcome: 0 | 1 }[]): number | null {
	if (points.length === 0) return null;
	let sum = 0;
	for (const p of points) {
		const q = clipP(p.predicted);
		sum += p.outcome === 1 ? -Math.log(q) : -Math.log(1 - q);
	}
	return sum / points.length;
}

/** Mann–Whitney AUC with average ranks; null without both classes. */
export function auc(points: readonly { predicted: number; outcome: 0 | 1 }[]): number | null {
	const pos = points.filter((p) => p.outcome === 1).length;
	const neg = points.length - pos;
	if (pos === 0 || neg === 0) return null;
	const sorted = [...points].sort((a, b) => a.predicted - b.predicted);
	let rankSumPos = 0;
	let i = 0;
	while (i < sorted.length) {
		let j = i;
		while (j + 1 < sorted.length && (sorted[j + 1] as CalibrationPoint).predicted === (sorted[i] as CalibrationPoint).predicted) j++;
		const avgRank = (i + j + 2) / 2;
		for (let k = i; k <= j; k++) if ((sorted[k] as CalibrationPoint).outcome === 1) rankSumPos += avgRank;
		i = j + 1;
	}
	return (rankSumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}

/** RMSE over equal-width probability bins, weighted by bin counts. */
export function rmseBins(points: readonly { predicted: number; outcome: 0 | 1 }[], bins = 10): number | null {
	if (points.length === 0) return null;
	const sumP = new Array<number>(bins).fill(0);
	const sumY = new Array<number>(bins).fill(0);
	const count = new Array<number>(bins).fill(0);
	for (const p of points) {
		const b = Math.min(bins - 1, Math.max(0, Math.floor(p.predicted * bins)));
		sumP[b] = (sumP[b] as number) + p.predicted;
		sumY[b] = (sumY[b] as number) + p.outcome;
		count[b] = (count[b] as number) + 1;
	}
	let se = 0;
	for (let b = 0; b < bins; b++) {
		const c = count[b] as number;
		if (c === 0) continue;
		se += c * (((sumP[b] as number) - (sumY[b] as number)) / c) ** 2;
	}
	return Math.sqrt(se / points.length);
}

/** Calibration metrics per consecutive window of `windowDays`. */
export function calibrationByWindow(points: readonly CalibrationPoint[], opts: { windowDays: number; from?: string }): CalibrationWindow[] {
	if (!(opts.windowDays > 0)) throw new RangeError(`windowDays deve ser > 0: ${opts.windowDays}`);
	const sorted = [...points].sort((a, b) => toMs(a.at) - toMs(b.at));
	const first = sorted[0];
	if (!first) return [];
	const startMs = opts.from ? toMs(opts.from) : toMs(first.at);
	const span = opts.windowDays * DAY_MS;
	const windows: CalibrationWindow[] = [];
	let pastSum = 0;
	let pastN = 0;
	let i = 0;
	while (i < sorted.length && toMs((sorted[i] as CalibrationPoint).at) < startMs) {
		pastSum += (sorted[i] as CalibrationPoint).outcome;
		pastN++;
		i++;
	}
	for (let w = 0; i < sorted.length; w++) {
		const lo = startMs + w * span;
		const hi = lo + span;
		const inWindow: CalibrationPoint[] = [];
		while (i < sorted.length && toMs((sorted[i] as CalibrationPoint).at) < hi) inWindow.push(sorted[i++] as CalibrationPoint);
		if (inWindow.length === 0) continue;
		const avgPrior = pastN > 0 ? pastSum / pastN : null;
		const moving: { predicted: number; outcome: 0 | 1 }[] = [];
		let runSum = pastSum;
		let runN = pastN;
		for (const p of inWindow) {
			if (runN > 0) moving.push({ predicted: runSum / runN, outcome: p.outcome });
			runSum += p.outcome;
			runN++;
		}
		windows.push({
			start: new Date(lo).toISOString(),
			end: new Date(hi).toISOString(),
			n: inWindow.length,
			positives: inWindow.filter((p) => p.outcome === 1).length,
			logLoss: logLoss(inWindow),
			auc: auc(inWindow),
			rmseBins: rmseBins(inWindow),
			avgBaselineLogLoss: avgPrior === null ? null : logLoss(inWindow.map((p) => ({ predicted: avgPrior, outcome: p.outcome }))),
			movingAvgLogLoss: logLoss(moving),
		});
		pastSum = runSum;
		pastN = runN;
	}
	return windows;
}
