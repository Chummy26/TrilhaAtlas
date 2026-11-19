/**
 * Tunable memory parameters (`settings.memory.*`; r4 §7.6.4 "os parâmetros
 * ficam em settings.memory.*, com defaults acima, e devem ser calibrados no
 * harness"). Defaults are the r4 §7.6 / SÍNTESE §2.5 values:
 *
 *   recall:  K = 50 per channel · RRF k = 60 (or RSF) · weights vec 1, fts 1,
 *            graph 1, time 1.2 (only when the query has a time range),
 *            learner 0.8 · relative cut 0.4 · ≤ 40 candidates · MMR λ = 0.7 ·
 *            budget 2000 tokens (deep: 4000)
 *   ingest:  extract every 6000 pending tokens · observe every 12 000
 *            unobserved tokens · reflect the log above 8000 tokens
 *   judge:   supersession candidates cos ≥ 0.75, top 8 · dedup cos ≥ 0.92 ·
 *            semantic edges cos ≥ 0.80 (top 5)
 *
 * Not implemented on purpose: r4 L11 "cold start" (inject up to 40k raw
 * tokens while the domain is young). It contradicts the 12k total context
 * ceiling of SÍNTESE §2.4(b), which this module guarantees.
 */

import { MemoryError, RECALL_CHANNELS, type RecallChannel } from "./types.ts";

export type FusionMethod = "rrf" | "rsf";

export interface MemorySettings {
	fusion: FusionMethod;
	rrfK: number;
	channelTopK: number;
	channelWeights: Record<RecallChannel, number>;
	mmrLambda: number;
	relativeCut: number;
	maxCandidates: number;
	recallBudgetTokens: number;
	deepBudgetTokens: number;
	extractBatchTokens: number;
	observeTokens: number;
	reflectTokens: number;
	supersedeMinCosine: number;
	supersedeTopK: number;
	dedupMinCosine: number;
	semanticEdgeMinCosine: number;
	consolidateBudgetTokens: number;
	/** Run extraction/observation automatically from ingestTurn thresholds. */
	autoExtract: boolean;
}

export const DEFAULT_MEMORY_SETTINGS: Readonly<MemorySettings> = Object.freeze({
	fusion: "rrf",
	rrfK: 60,
	channelTopK: 50,
	channelWeights: Object.freeze({ vec: 1, fts: 1, graph: 1, time: 1.2, learner: 0.8 }),
	mmrLambda: 0.7,
	relativeCut: 0.4,
	maxCandidates: 40,
	recallBudgetTokens: 2000,
	deepBudgetTokens: 4000,
	extractBatchTokens: 6000,
	observeTokens: 12_000,
	reflectTokens: 8000,
	supersedeMinCosine: 0.75,
	supersedeTopK: 8,
	dedupMinCosine: 0.92,
	semanticEdgeMinCosine: 0.8,
	consolidateBudgetTokens: 8000,
	autoExtract: true,
}) as Readonly<MemorySettings>;

function assertRange(name: string, value: number, lo: number, hi: number): void {
	if (!(typeof value === "number" && Number.isFinite(value) && value >= lo && value <= hi)) {
		throw new MemoryError("invalid-input", `settings.memory.${name} fora de [${lo}, ${hi}]: ${value}`);
	}
}

/** Merge a partial override onto the defaults and validate every range. */
export function resolveMemorySettings(partial: Partial<MemorySettings> = {}): MemorySettings {
	const weights = { ...DEFAULT_MEMORY_SETTINGS.channelWeights, ...(partial.channelWeights ?? {}) };
	const s: MemorySettings = { ...DEFAULT_MEMORY_SETTINGS, ...partial, channelWeights: weights };
	if (s.fusion !== "rrf" && s.fusion !== "rsf") throw new MemoryError("invalid-input", `settings.memory.fusion inválido: ${String(s.fusion)}`);
	assertRange("rrfK", s.rrfK, 1, 10_000);
	assertRange("channelTopK", s.channelTopK, 1, 1000);
	for (const c of RECALL_CHANNELS) assertRange(`channelWeights.${c}`, weights[c], 0, 10);
	assertRange("mmrLambda", s.mmrLambda, 0, 1);
	assertRange("relativeCut", s.relativeCut, 0, 1);
	assertRange("maxCandidates", s.maxCandidates, 1, 500);
	assertRange("recallBudgetTokens", s.recallBudgetTokens, 50, 50_000);
	assertRange("deepBudgetTokens", s.deepBudgetTokens, 50, 100_000);
	assertRange("extractBatchTokens", s.extractBatchTokens, 100, 200_000);
	assertRange("observeTokens", s.observeTokens, 100, 500_000);
	assertRange("reflectTokens", s.reflectTokens, 100, 500_000);
	assertRange("supersedeMinCosine", s.supersedeMinCosine, -1, 1);
	assertRange("supersedeTopK", s.supersedeTopK, 1, 100);
	assertRange("dedupMinCosine", s.dedupMinCosine, -1, 1);
	assertRange("semanticEdgeMinCosine", s.semanticEdgeMinCosine, -1, 1);
	assertRange("consolidateBudgetTokens", s.consolidateBudgetTokens, 100, 500_000);
	return s;
}
