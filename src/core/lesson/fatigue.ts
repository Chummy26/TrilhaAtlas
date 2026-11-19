/**
 * Fatigue tracking (docs/research/00-SINTESE.md §1.2 P11 "FatigueState
 * (latência / linha de base, erros fáceis nos últimos 5, pedidos de pular)
 * dispara troca de formato ou pausa"; §2.4(d) inactivity 20 min; r1 §0.14,
 * §6.8).
 *
 * Signals (per block):
 *   • latency: median of the last 5 item latencies ≥ 1.5 × baseline (the
 *     day's baseline when known, else the median of this lesson's first 3,
 *     frozen once derived so the capped sample window cannot drift it);
 *   • easy errors: ≥2 wrong items of difficulty 1 among the last 5;
 *   • give-ups: ≥2 "não sei" answers among the last 5 items (r1 §6.8
 *     "'não sei' frequente");
 *   • skips: ≥2 skip requests;
 *   • block time: suggest a break at 45 min, wrap up at 50 (blocks of
 *     25–50 min; < 20 min is wasted on context switching);
 *   • self-report "tired" → break; inactivity ≥ 20 min → wrap up.
 *
 * Escalation ladder (r1 §6.8, in order, one line, never moralizing):
 *   0 none → 1 switch_format → 2 skip_optional → 3 suggest_break → 4 wrap_up.
 * Level = number of active signals among latency / easy errors / give-ups /
 * skips (capped at 3), raised by block time, self-report and inactivity. The
 * orchestrator acts only when the level RISES, so the learner never sees the
 * same nudge twice; a self-report "ok" clears the counters (fresh start after
 * a break).
 *
 * Pure and browser-safe.
 */

import type { Difficulty } from "./protocol.ts";

export const FATIGUE_THRESHOLDS = Object.freeze({
	latencyRatio: 1.5,
	minLatencySamples: 3,
	recentWindow: 5,
	easyErrors: 2,
	dontKnows: 2,
	skipRequests: 2,
	suggestBreakMinutes: 45,
	wrapUpMinutes: 50,
	inactivityMinutes: 20,
	block: { min: 25, max: 50 },
	breakMinutes: { lo: 5, hi: 10 },
});

export const FATIGUE_LADDER = ["none", "switch_format", "skip_optional", "suggest_break", "wrap_up"] as const;
export type FatigueAction = (typeof FATIGUE_LADDER)[number];
export type FatigueLevel = 0 | 1 | 2 | 3 | 4;

export interface FatigueSample {
	at: number;
	latencyMs?: number;
	difficulty: Difficulty;
	correct: boolean;
	/** The learner answered "não sei" (give-up signal). */
	dontKnow?: boolean;
}

export interface FatigueState {
	/** Day baseline (ms); null → set (and frozen) by recordSample from this lesson's first 3 latencies. */
	baselineLatencyMs: number | null;
	samples: FatigueSample[];
	skipRequests: number;
	blockStartedAt: number;
	selfReport: "ok" | "tired" | null;
	lastActivityAt: number;
}

export interface FatigueSignals {
	latencyRatio: number | null;
	easyErrorsLast5: number;
	dontKnowLast5: number;
	skipRequests: number;
	minutesInBlock: number;
	inactiveMinutes: number;
	selfReport: "ok" | "tired" | null;
}

const SAMPLE_CAP = 20;
const MINUTE = 60_000;

export function createFatigueState(blockStartedAt: number, baselineLatencyMs: number | null = null): FatigueState {
	return { baselineLatencyMs, samples: [], skipRequests: 0, blockStartedAt, selfReport: null, lastActivityAt: blockStartedAt };
}

function isLatency(value: number | undefined): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Append a sample. Without a day baseline, the median of the lesson's first
 * three latencies becomes the baseline and is FROZEN here: the sample window
 * is capped (SAMPLE_CAP), so deriving it from "the first three kept samples"
 * on every read would let a slow drift slide into the baseline and hide the
 * very slowdown the signal exists to catch.
 */
export function recordSample(state: FatigueState, sample: FatigueSample): FatigueState {
	const samples = [...state.samples, sample];
	let baselineLatencyMs = state.baselineLatencyMs;
	if (baselineLatencyMs === null) {
		const latencies = samples.map((s) => s.latencyMs).filter(isLatency);
		if (latencies.length >= FATIGUE_THRESHOLDS.minLatencySamples) baselineLatencyMs = median(latencies.slice(0, FATIGUE_THRESHOLDS.minLatencySamples));
	}
	return {
		...state,
		baselineLatencyMs,
		samples: samples.length > SAMPLE_CAP ? samples.slice(-SAMPLE_CAP) : samples,
		lastActivityAt: Math.max(state.lastActivityAt, sample.at),
	};
}

export function recordSkip(state: FatigueState, at: number): FatigueState {
	return { ...state, skipRequests: state.skipRequests + 1, lastActivityAt: Math.max(state.lastActivityAt, at) };
}

export function recordActivity(state: FatigueState, at: number): FatigueState {
	return at > state.lastActivityAt ? { ...state, lastActivityAt: at } : state;
}

/** "ok" after a break clears the counters; "tired" is remembered. */
export function recordSelfReport(state: FatigueState, value: "ok" | "tired", at: number): FatigueState {
	if (value === "tired") return { ...state, selfReport: "tired", lastActivityAt: Math.max(state.lastActivityAt, at) };
	return { ...state, selfReport: "ok", samples: [], skipRequests: 0, lastActivityAt: Math.max(state.lastActivityAt, at) };
}

function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function latencyRatio(state: FatigueState): number | null {
	const latencies = state.samples.map((s) => s.latencyMs).filter(isLatency);
	const baseline = state.baselineLatencyMs ?? (latencies.length >= FATIGUE_THRESHOLDS.minLatencySamples ? median(latencies.slice(0, FATIGUE_THRESHOLDS.minLatencySamples)) : null);
	const recent = latencies.slice(-FATIGUE_THRESHOLDS.recentWindow);
	if (!baseline || recent.length < FATIGUE_THRESHOLDS.minLatencySamples) return null;
	return median(recent) / baseline;
}

export function fatigueSignals(state: FatigueState, now: number): FatigueSignals {
	const recent = state.samples.slice(-FATIGUE_THRESHOLDS.recentWindow);
	return {
		latencyRatio: latencyRatio(state),
		easyErrorsLast5: recent.filter((s) => s.difficulty === 1 && !s.correct).length,
		dontKnowLast5: recent.filter((s) => s.dontKnow === true).length,
		skipRequests: state.skipRequests,
		minutesInBlock: Math.max(0, (now - state.blockStartedAt) / MINUTE),
		inactiveMinutes: Math.max(0, (now - state.lastActivityAt) / MINUTE),
		selfReport: state.selfReport,
	};
}

export function fatigueLevel(signals: FatigueSignals): FatigueLevel {
	if (signals.inactiveMinutes >= FATIGUE_THRESHOLDS.inactivityMinutes || signals.minutesInBlock >= FATIGUE_THRESHOLDS.wrapUpMinutes) return 4;
	const active = [
		signals.latencyRatio !== null && signals.latencyRatio >= FATIGUE_THRESHOLDS.latencyRatio,
		signals.easyErrorsLast5 >= FATIGUE_THRESHOLDS.easyErrors,
		signals.dontKnowLast5 >= FATIGUE_THRESHOLDS.dontKnows,
		signals.skipRequests >= FATIGUE_THRESHOLDS.skipRequests,
	].filter(Boolean).length;
	let level = Math.min(3, active);
	if (signals.minutesInBlock >= FATIGUE_THRESHOLDS.suggestBreakMinutes || signals.selfReport === "tired") level = Math.max(level, 3);
	return level as FatigueLevel;
}

export function decideFatigueAction(state: FatigueState, now: number): FatigueAction {
	return FATIGUE_LADDER[fatigueLevel(fatigueSignals(state, now))];
}

/** One sober pt-BR line per action (shown as a dismissible notice, never a lecture). */
export function fatigueMessage(action: FatigueAction): string {
	switch (action) {
		case "none":
			return "";
		case "switch_format":
			return "Vamos variar o formato dos próximos exercícios.";
		case "skip_optional":
			return "Vou pular as partes opcionais e manter só o essencial deste nó.";
		case "suggest_break":
			return `Bom momento para uma pausa de ${FATIGUE_THRESHOLDS.breakMinutes.lo}–${FATIGUE_THRESHOLDS.breakMinutes.hi} min; a aula continua daqui quando você voltar.`;
		case "wrap_up":
			return "Vamos fechar este bloco aqui: resumo, cartões e o resto fica para a próxima sessão.";
	}
}
