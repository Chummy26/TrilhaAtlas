/**
 * Default learner-model parameters (r2 §9.11; docs/research/00-SINTESE.md
 * §2.6) plus the fixed constants the research pins but the LearnerParams
 * contract does not carry (FSRS policy, Elo, BLIM, FIRe ledger, planner
 * costs). Everything here is data: no I/O, browser-safe.
 *
 * Choices where the research is silent (documented in docs/impl/learner.md):
 *   • planner costs — review 5 min, vehicle 6 min, probe 4 min, remediation
 *     15 min (r2 only says "custo esperado em minutos");
 *   • per-attempt FIRe cap = 3 repetitions (= MaxBank): a vehicle may knock
 *     out up to three full reviews before largest-remainder scaling;
 *   • prior for an unseen node p0 = 0.15 with nEff 0.5 (r2 §9.6d).
 */

import { assertEmissionValid, DEFAULT_EMISSION } from "./emission.ts";
import type { FireMode, LearnerParams } from "./types.ts";

export const DEFAULT_LEARNER_PARAMS: LearnerParams = {
	emission: DEFAULT_EMISSION,
	tLesson: 0.25,
	tPractice: 0.15,
	attainThreshold: 0.85,
	masteryThreshold: 0.95,
	readinessThreshold: 0.85,
	retainedR: 0.7,
	consistencyEps: 0.05,
	llmAttributionLambda: 1.5,
	blameHalfLifeDays: 14,
	propagationHops: 3,
	fireMinWeight: 0.1,
	desiredRetention: { frontierPrereq: 0.93, default: 0.9, distantLeaf: 0.85 },
	planner: { reviewShare: 0.5, maxNewPerDay: 4, gamma: 0.6, alphaGoal: 1, betaDesc: 0.5, avgNewMinutes: 30 },
	fireMode: "active",
};

/** Fixed constants (research-pinned; not tuned per domain). */
export const LEARNER_CONSTANTS = {
	/** Prior of a node never touched (r2 §9.6d). */
	priorP: 0.15,
	priorNEff: 0.5,
	/** Upper clamp of the practice transition T (r2 §9.4). */
	maxTransition: 0.6,
	/** Delayed retrieval for mastery: ≥ 24 h (SÍNTESE §2.6). */
	delayedMinutes: 24 * 60,
	/** Distinct correct item families required for mastery. */
	masteryFamilies: 2,
	/** Delayed hint-free successes required for mastery. */
	masteryDelayed: 1,
	/** q ≥ this marks a Q-vector node as directly verified. */
	verifyMinQ: 0.5,
	/** Default weight of a `flashcard` evidence without an explicit weight (r2 §9.3: the card is narrower than the node). */
	flashcardWeight: 0.3,
	/** Version of a node state never touched by a `node-version` event (curriculum items are born at version 1). */
	initialNodeVersion: 1,
	/** Diagnostic estimates count as this much evidence. */
	diagnosticNEff: 1,
	/** Blame above this schedules a probe / flags "weak" (r2 §9.6c). */
	probeBlame: 0.3,
	/** Local consistency sweeps after an update (r2 §9.6a: 2–3). */
	localPasses: 3,
	/** Global projection: stop when every violation ≤ tol. */
	globalTolerance: 1e-9,
	globalMaxPasses: 500,
	/** FSRS-7 policy (r2 §9.11; ts-fsrs research §14.1). */
	fsrs: {
		learningSteps: ["20m"] as `${number}${"m" | "h" | "d"}`[],
		relearningSteps: ["20m"] as `${number}${"m" | "h" | "d"}`[],
		enableFuzz: true,
		maximumInterval: 1095,
		allowModelOverride: true,
		graduatingInterval: 1,
		enableShortTerm: true,
	},
	/** Easy rating: needs at least this many latency samples for a median proxy. */
	easyMinLatencySamples: 3,
	easyMinLevel: 4,
	/** Elo (Pelánek 2016): U(n) = 1 / (1 + 0.05·n). */
	eloDecay: 0.05,
	/** Slip per item level 1..5 (r2 §9.9). */
	slipByLevel: [0.05, 0.1, 0.15, 0.25, 0.35] as readonly number[],
	/** Guess for open answers = P(ŷ ≥ 2 | K=0) of the delayed table. */
	guessOpen: 0.2,
	/** Practice target band and probe target (r2 §9.9). */
	practiceTarget: { lo: 0.7, mid: 0.75, hi: 0.85 },
	probeTarget: 0.5,
	/** BLIM for the particle diagnostic (r2 §9.7). */
	blim: { beta: 0.1, etaOpen: 0.05 },
	particles: { count: 2000, maxQuestions: 25, minQuestions: 8, stopLo: 0.2, stopHi: 0.8, thresholdNoise: 0.5, mcmcSteps: 2 },
	/** Misconceptions: Beta(1,4) prior; active ≥ 0.5; resolved < 0.2 (r2 §9.10). */
	misconception: { priorA: 1, priorB: 4, active: 0.5, resolved: 0.2 },
	/** FIRe ledger (mathua §7.1, §14.2). */
	fire: {
		micro: 1_000_000,
		maxBank: 3,
		maxCandidates: 1024,
		attemptCapReps: 3,
		/** Eligibility (r2 §9.6b): target pL ≥ 0.9, D ≤ 7, lapses ≤ 2; source pL ≥ 0.9. */
		minTargetP: 0.9,
		maxTargetDifficulty: 7,
		maxTargetLapses: 2,
		minSourceP: 0.9,
	},
	/** Planner (r2 §9.9). */
	planner: {
		reviewMinutes: 5,
		vehicleMinutes: 6,
		probeMinutes: 4,
		remediateMinutes: 15,
		mandatoryMargin: 0.1,
		atRiskMargin: 0.03,
		loadHorizonDays: 30,
		minNewMinutes: 10,
		maxNewMinutes: 90,
	},
} as const;

export class LearnerParamsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LearnerParamsError";
	}
}

function inUnit(name: string, v: number, open = false): void {
	const ok = open ? v > 0 && v < 1 : v >= 0 && v <= 1;
	if (!ok) throw new LearnerParamsError(`${name} fora de ${open ? "(0,1)" : "[0,1]"}: ${v}`);
}

/** Throw a clear error when the parameters violate a model invariant. */
export function validateLearnerParams(params: LearnerParams): void {
	assertEmissionValid(params.emission);
	inUnit("tLesson", params.tLesson);
	inUnit("tPractice", params.tPractice);
	inUnit("attainThreshold", params.attainThreshold, true);
	inUnit("masteryThreshold", params.masteryThreshold, true);
	inUnit("readinessThreshold", params.readinessThreshold, true);
	inUnit("retainedR", params.retainedR, true);
	inUnit("consistencyEps", params.consistencyEps);
	if (params.masteryThreshold < params.attainThreshold) throw new LearnerParamsError("masteryThreshold deve ser ≥ attainThreshold.");
	if (!(params.llmAttributionLambda >= 0)) throw new LearnerParamsError(`llmAttributionLambda negativo: ${params.llmAttributionLambda}`);
	if (!(params.blameHalfLifeDays > 0)) throw new LearnerParamsError(`blameHalfLifeDays deve ser > 0: ${params.blameHalfLifeDays}`);
	if (!(Number.isInteger(params.propagationHops) && params.propagationHops >= 0 && params.propagationHops <= 3)) {
		throw new LearnerParamsError(`propagationHops deve ser inteiro em [0,3]: ${params.propagationHops}`);
	}
	inUnit("fireMinWeight", params.fireMinWeight);
	const dr = params.desiredRetention;
	inUnit("desiredRetention.frontierPrereq", dr.frontierPrereq, true);
	inUnit("desiredRetention.default", dr.default, true);
	inUnit("desiredRetention.distantLeaf", dr.distantLeaf, true);
	const p = params.planner;
	inUnit("planner.reviewShare", p.reviewShare);
	inUnit("planner.gamma", p.gamma);
	if (!(Number.isInteger(p.maxNewPerDay) && p.maxNewPerDay >= 0)) throw new LearnerParamsError(`planner.maxNewPerDay inválido: ${p.maxNewPerDay}`);
	if (!(p.avgNewMinutes > 0)) throw new LearnerParamsError(`planner.avgNewMinutes deve ser > 0: ${p.avgNewMinutes}`);
	if (!(p.alphaGoal >= 0 && p.betaDesc >= 0)) throw new LearnerParamsError("planner.alphaGoal/betaDesc devem ser ≥ 0.");
	if (params.fsrsWeights !== undefined && params.fsrsWeights.length !== 34) {
		throw new LearnerParamsError(`fsrsWeights do FSRS-7 exigem 34 pesos (recebido ${params.fsrsWeights.length}).`);
	}
	const slips = LEARNER_CONSTANTS.slipByLevel;
	for (let i = 0; i < slips.length; i++) {
		if ((slips[i] as number) + LEARNER_CONSTANTS.guessOpen > 1) throw new LearnerParamsError(`Nível ${i + 1}: G + S > 1.`);
	}
}

/** Fail-closed parse of a FIRe mode from config (mathua §7.3): unknown → "shadow". */
export function parseFireMode(raw: unknown): FireMode {
	return raw === "off" || raw === "active" || raw === "shadow" ? raw : "shadow";
}

/** Effective FIRe mode of a parameter set (missing → "active", the product default). */
export function fireModeOf(params: LearnerParams): FireMode {
	return params.fireMode === undefined ? "active" : parseFireMode(params.fireMode);
}
