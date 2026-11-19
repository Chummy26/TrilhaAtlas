/**
 * Pure Monte Carlo learner simulator for calibrating levels and tiers
 * (docs/research/00-SINTESE.md §2.11 "Monte Carlo"; r7 §5.1, Appendix A).
 *
 * A TypeScript port of the r7 `sim.mjs` model, but pricing every credit with
 * the SAME pure functions the runtime ledger uses (`eventCredit` +
 * `softCapped` from ./xp.ts, `masteryPoints`/`structuralStage` from
 * ./tiers.ts), so calibration and runtime cannot diverge.
 *
 * Model (r7 §5.1):
 *   • domain: frozen core of 7 stages (40/90/150/200/230/210/190 = 1 110
 *     nodes), lesson minutes per node 25…85 × 0.82 (20.5…69.7); stage s+1
 *     unlocks when 70 % of stage s is learned; nodes are learned in order;
 *   • learner: minutes/day = H·60·LogN(mean 1, σ 0.3); a day is skipped with
 *     p_skip ~ U(0.05, 0.25); 14 vacation days a year; speed κ ~ LogN(1, 0.25)
 *     (or fixed); node time × LogN(1, 0.4); the lesson check passes with
 *     `checkPassRate` (0.9); every retry after a failed check costs 30 % of
 *     the node's FIRST attempt (r7 §5.1 prose; r7's sim.mjs compounded it to
 *     0.3^k of the time, which made low "taxa de acerto" profiles nearly
 *     free — a documented deviation from that script);
 *   • memory: ts-fsrs FSRS-7 — the model the runtime learner schedules
 *     with (src/core/learner/fsrs.ts: FSRS7Model, FSRS7_DEFAULT_WEIGHTS,
 *     maximum interval 1095 d) — through the pure `FSRS7Algorithm` (≈ 3 µs
 *     per review; the scheduler objects would be far too slow for
 *     10⁴ learners × 10³ days). A parity test drives the runtime's
 *     `reviewMemory` and this model side by side. r7's sim.mjs (and this
 *     module before the review) used FSRS-6, whose intervals are 2–2.5×
 *     shorter (2/11/46/163 d vs 5/27/94/298 d for straight Goods): the
 *     review load, the calendar and the tier thresholds were calibrated for
 *     a scheduler the app does not run. The FSRS-6 closed form stays
 *     available (`createMemoryModel` + `fsrs6Memory`, parity-tested against
 *     `FSRS6Algorithm`). DR 0.9, daily granularity; node review = 3 min,
 *     lapse +6 min that include the runtime's 20-minute relearning step (a
 *     Good re-review); recall ~ Bernoulli(R); grade on recall ≈ 80 % Good /
 *     10 % Easy / 10 % Hard; due reviews come first, the rest of the day
 *     goes to new nodes; a learned node starts from FSRS-7's first Good
 *     (with one 20-minute learning step a new card's Good graduates at
 *     once in the runtime too);
 *   • XP: lesson events carry `expectedMin = base·κ` (the personal median),
 *     so the 1.5× cap and the rush rule apply exactly as at runtime; reviews
 *     are node reviews priced by gReview(R); the daily soft cap runs on the
 *     credited minutes in chronological order;
 *   • evaluation every 7 days: retained = learned ∧ R ≥ 0.7 (tested as
 *     elapsed ≤ the model's time to reach R = 0.7, identical to R ≥ 0.7);
 *   • farmers (r7 §5.5): "early-reviews" spends a share of each day on early
 *     reviews of already-easy nodes; "skimmer" does lessons at 40 % of the
 *     time and passes the check with p = 0.35 (and keeps skimming retries).
 *   • naive rule for comparison: +50 XP per lesson attempt, +10 per review.
 *
 * Every learner draws from its own mulberry32 stream (./random.ts) seeded by
 * (seed, profile id, learner index): results are deterministic and do not
 * depend on evaluation order.
 *
 * Pure (no I/O, no clock): browser-safe; uses ts-fsrs's pure model classes only.
 */

import { default_w } from "ts-fsrs";
import { FSRS7_DEFAULT_WEIGHTS, FSRS7_MODEL_BOUNDS, FSRS7Algorithm } from "ts-fsrs/models/fsrs-7";
import { deriveSeed, SimRng } from "./random.ts";
import { RULES, type XpRules } from "./rules.ts";
import { MAX_EVENT_MINUTES } from "./schema.ts";
import { DEFAULT_RETAINED_R, DEFAULT_STAGE_QUOTA, masteryPoints, structuralStage } from "./tiers.ts";
import type { ProgressEventBody } from "./types.ts";
import { eventCredit, softCapped } from "./xp.ts";

// ─── FSRS-6 closed form (r7's model; comparison runs) ────────────────────────

/** 1 Again · 2 Hard · 3 Good · 4 Easy (memory-model input only — never an XP input). */
export type MemoryGrade = 1 | 2 | 3 | 4;

export interface MemoryModel {
	readonly weights: readonly number[];
	readonly decay: number;
	readonly factor: number;
	retrievability(elapsedDays: number, stability: number): number;
	initialStability(grade: MemoryGrade): number;
	initialDifficulty(grade: MemoryGrade): number;
	nextDifficulty(difficulty: number, grade: MemoryGrade): number;
	stabilityAfterRecall(difficulty: number, stability: number, R: number, grade: MemoryGrade): number;
	stabilityAfterLapse(difficulty: number, stability: number, R: number): number;
	/** Days until R falls to `desiredRetention` (≥ 1). */
	intervalDays(stability: number, desiredRetention: number): number;
	/** Largest elapsed time (days) with R ≥ r. */
	maxElapsedFor(stability: number, r: number): number;
}

const clampNumber = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
/** ts-fsrs FSRS6_MODEL_BOUNDS. */
const S_MIN = 0.001;
const S_MAX = 36_500;

/** FSRS-6 (21 weights). Defaults to ts-fsrs `default_w`. */
export function createMemoryModel(weights: readonly number[] = default_w): MemoryModel {
	if (weights.length < 21 || weights.some((w) => !Number.isFinite(w))) {
		throw new RangeError(`Pesos FSRS-6 inválidos: esperado 21 números finitos, recebido ${weights.length}.`);
	}
	const w = (i: number): number => weights[i] as number;
	const decay = -w(20);
	const factor = 0.9 ** (1 / decay) - 1;
	const rawInitialDifficulty = (grade: MemoryGrade): number => w(4) - Math.exp(w(5) * (grade - 1)) + 1;
	const initialDifficulty = (grade: MemoryGrade): number => clampNumber(rawInitialDifficulty(grade), 1, 10);
	// FSRS-6 mean-reverts toward D₀(Easy) WITHOUT clamping it (ts-fsrs, py-fsrs).
	const easyInit = rawInitialDifficulty(4);
	const clampStability = (s: number): number => clampNumber(s, S_MIN, S_MAX);
	const lapseFloorDivisor = Math.exp(w(17) * w(18));
	return {
		weights,
		decay,
		factor,
		retrievability: (elapsedDays, stability) => (1 + (factor * Math.max(0, elapsedDays)) / stability) ** decay,
		initialStability: (grade) => clampStability(w(grade - 1)),
		initialDifficulty,
		nextDifficulty: (difficulty, grade) => {
			const delta = -w(6) * (grade - 3);
			const damped = difficulty + (delta * (10 - difficulty)) / 9;
			return clampNumber(w(7) * easyInit + (1 - w(7)) * damped, 1, 10);
		},
		stabilityAfterRecall: (difficulty, stability, R, grade) =>
			clampStability(
				stability *
					(1 +
						Math.exp(w(8)) *
							(11 - difficulty) *
							stability ** -w(9) *
							(Math.exp(w(10) * (1 - R)) - 1) *
							(grade === 2 ? w(15) : 1) *
							(grade === 4 ? w(16) : 1)),
			),
		stabilityAfterLapse: (difficulty, stability, R) => {
			const forgotten = clampStability(w(11) * difficulty ** -w(12) * ((stability + 1) ** w(13) - 1) * Math.exp(w(14) * (1 - R)));
			return Math.min(forgotten, Math.max(S_MIN, stability / lapseFloorDivisor));
		},
		intervalDays: (stability, desiredRetention) => Math.max(1, Math.round((stability / factor) * (desiredRetention ** (1 / decay) - 1))),
		maxElapsedFor: (stability, r) => (stability * (r ** (1 / decay) - 1)) / factor,
	};
}

// ─── simulator memory: FSRS-7 (the runtime model) or the FSRS-6 closed form ─

/** Memory state of one node (the FSRS-6 adapter ignores `stabilityFast`). */
export interface SimMemoryState {
	stability: number;
	stabilityFast: number;
	difficulty: number;
}

/** Day-scale memory model the simulator runs on. */
export interface SimMemory {
	readonly name: "fsrs-7" | "fsrs-6";
	initial(grade: MemoryGrade): SimMemoryState;
	retrievability(elapsedDays: number, state: Readonly<SimMemoryState>): number;
	next(state: Readonly<SimMemoryState>, elapsedDays: number, R: number, grade: MemoryGrade): SimMemoryState;
	/** Whole days until the next review at `desiredRetention`: 1 … maximum interval. */
	intervalDays(state: Readonly<SimMemoryState>, desiredRetention: number): number;
	/** Largest elapsed time (fractional days) with R ≥ r. */
	retainedDays(state: Readonly<SimMemoryState>, r: number): number;
}

/** Longest review interval of the runtime scheduler (LEARNER_CONSTANTS.fsrs.maximumInterval in src/core/learner/params.ts; a test pins the parity). */
export const SIM_MAXIMUM_INTERVAL_DAYS = 1095;

function requireMaximumInterval(days: number): number {
	if (!Number.isInteger(days) || days < 1) throw new RangeError(`Intervalo máximo de revisão inválido: ${days} (inteiro ≥ 1).`);
	return days;
}

/**
 * ts-fsrs FSRS-7 (dual trace) with the learner runtime's default weights
 * (src/core/learner/fsrs.ts uses FSRS7_DEFAULT_WEIGHTS unless the domain
 * optimised its own): the pure `FSRS7Algorithm`, not the scheduler objects
 * (≈ 3 µs per review). Day-scale: the runtime's 20-minute learning and
 * relearning steps are folded into the lesson and relearning minutes.
 */
export function fsrs7Memory(weights: readonly number[] = FSRS7_DEFAULT_WEIGHTS, maximumIntervalDays: number = SIM_MAXIMUM_INTERVAL_DAYS): SimMemory {
	if (weights.length !== FSRS7_DEFAULT_WEIGHTS.length || weights.some((w) => !Number.isFinite(w))) {
		throw new RangeError(`Pesos FSRS-7 inválidos: esperado ${FSRS7_DEFAULT_WEIGHTS.length} números finitos, recebido ${weights.length}.`);
	}
	const maxInterval = requireMaximumInterval(maximumIntervalDays);
	const algorithm = new FSRS7Algorithm([...weights], FSRS7_MODEL_BOUNDS);
	// next_state refuses R outside the open interval (0, 1); the curve already stays inside it.
	const openUnit = (R: number): number => clampNumber(R, 1e-9, 1 - 1e-9);
	return {
		name: "fsrs-7",
		initial: (grade) => algorithm.next_state(null, 0, grade),
		retrievability: (elapsedDays, state) => algorithm.curve(Math.max(0, elapsedDays), state).retrievability,
		next: (state, elapsedDays, R, grade) => algorithm.next_state(state, Math.max(0, elapsedDays), grade, openUnit(R)),
		intervalDays: (state, desiredRetention) => clampNumber(Math.round(algorithm.next_interval(state, desiredRetention)), 1, maxInterval),
		retainedDays: (state, r) => algorithm.next_interval(state, r),
	};
}

let cachedDefaultMemory: SimMemory | null = null;
/** The default simulator memory (FSRS-7 default weights), built once: the model is stateless. */
function defaultMemory(): SimMemory {
	cachedDefaultMemory ??= fsrs7Memory();
	return cachedDefaultMemory;
}

/**
 * The FSRS-6 closed form behind the same interface (r7's model; kept for
 * comparison runs — r7 had no relearning step, so pair it with
 * `params.relearnStepDays: 0` to reproduce r7).
 */
export function fsrs6Memory(model: MemoryModel = createMemoryModel(), maximumIntervalDays: number = SIM_MAXIMUM_INTERVAL_DAYS): SimMemory {
	const maxInterval = requireMaximumInterval(maximumIntervalDays);
	return {
		name: "fsrs-6",
		initial: (grade) => ({ stability: model.initialStability(grade), stabilityFast: 0, difficulty: model.initialDifficulty(grade) }),
		retrievability: (elapsedDays, state) => model.retrievability(elapsedDays, state.stability),
		next: (state, _elapsedDays, R, grade) => ({
			stability: grade === 1 ? model.stabilityAfterLapse(state.difficulty, state.stability, R) : model.stabilityAfterRecall(state.difficulty, state.stability, R, grade),
			stabilityFast: 0,
			difficulty: model.nextDifficulty(state.difficulty, grade),
		}),
		intervalDays: (state, desiredRetention) => Math.min(maxInterval, model.intervalDays(state.stability, desiredRetention)),
		retainedDays: (state, r) => model.maxElapsedFor(state.stability, r),
	};
}

// ─── domain and profiles ────────────────────────────────────────────────────

export interface SimStage {
	nodes: number;
	/** Mean lesson minutes of a node of this stage. */
	lessonMin: number;
}

export interface SimDomain {
	stages: readonly SimStage[];
	/** Fraction of stage s that must be learned before stage s+1 opens. */
	unlockFraction: number;
}

/** r7 §5.1 reference core: 1 110 nodes, 940 h of lessons. */
export const REFERENCE_CORE: Readonly<SimDomain> = Object.freeze({
	stages: Object.freeze(
		[
			[40, 25],
			[90, 35],
			[150, 45],
			[200, 55],
			[230, 65],
			[210, 75],
			[190, 85],
		].map(([nodes, minutes]) => Object.freeze({ nodes: nodes as number, lessonMin: (minutes as number) * 0.82 })),
	),
	unlockFraction: 0.7,
});

export type FarmerStrategy = { kind: "early-reviews"; share: number } | { kind: "skimmer"; timeFraction: number; passRate: number };

export interface LearnerProfile {
	id: string;
	/** pt-BR label for reports. */
	label: string;
	hoursPerDay: number;
	/** Probability of passing a lesson comprehension check ("taxa de acerto"). */
	checkPassRate: number;
	/** κ, multiplies every lesson time (> 1 = slower learner); omitted = sampled LogN(1, speedSigma) per learner. */
	speed?: number;
	speedSigma: number;
	farmer?: FarmerStrategy;
}

export function honestProfile(hoursPerDay: number, overrides: Partial<LearnerProfile> = {}): LearnerProfile {
	return { id: `${hoursPerDay}h`, label: `${hoursPerDay} h/dia`, hoursPerDay, checkPassRate: 0.9, speedSigma: 0.25, ...overrides };
}

export interface SimParams {
	days: number;
	desiredRetention: number;
	retainedR: number;
	stageQuota: number;
	reviewMin: number;
	relearnMin: number;
	/**
	 * The runtime's relearning step (LEARNER_CONSTANTS.fsrs.relearningSteps
	 * ['20m']): a lapse is followed, inside `relearnMin`, by a Good re-review
	 * this many days later. 0 = no step.
	 */
	relearnStepDays: number;
	/** Each retry of a failed honest check costs this × the node's FIRST attempt time (never compounding). */
	retryFraction: number;
	dailyMinutesSigma: number;
	nodeTimeSigma: number;
	skipProbability: { lo: number; hi: number };
	vacationDaysPerYear: number;
	rules: XpRules;
	naive: { perLesson: number; perReview: number };
}

export const DEFAULT_SIM_PARAMS: Readonly<SimParams> = Object.freeze({
	days: 1100,
	desiredRetention: 0.9,
	retainedR: DEFAULT_RETAINED_R,
	stageQuota: DEFAULT_STAGE_QUOTA,
	reviewMin: 3,
	relearnMin: 6,
	relearnStepDays: 20 / 1440,
	retryFraction: 0.3,
	dailyMinutesSigma: 0.3,
	nodeTimeSigma: 0.4,
	skipProbability: Object.freeze({ lo: 0.05, hi: 0.25 }),
	vacationDaysPerYear: 14,
	rules: RULES,
	naive: Object.freeze({ perLesson: 50, perReview: 10 }),
});

/** One simulated learner. Arrays are indexed by day (0-based) or by evaluated week. */
export interface LearnerTrajectory {
	/** Cumulative XP at the end of each day. */
	cumXp: Float64Array;
	/** Cumulative study minutes at the end of each day. */
	cumMinutes: Float64Array;
	/** Cumulative XP under the naive rule (+50/lesson, +10/review). */
	cumNaiveXp: Float64Array;
	/** PM at the end of each week (day 7w + 6). */
	pmByWeek: Float64Array;
	/** Structural stage (0..7) at the end of each week. */
	stageByWeek: Uint8Array;
	reviewMinutes: number;
	lessonMinutes: number;
	reviews: number;
	lapses: number;
	learnedNodes: number;
	speed: number;
	skipProbability: number;
}

/** A credited event as seen by the simulator (for ledger-parity tests). */
export interface SimCreditEvent {
	day: number;
	/** Order of the credit inside the day. */
	seq: number;
	body: ProgressEventBody;
	/** XP the simulator granted (soft cap applied). */
	xp: number;
}

export interface SimulateOptions {
	params?: Partial<SimParams>;
	/** Default: `fsrs7Memory()` (the runtime learner model). */
	memory?: SimMemory;
	onCredit?: (event: SimCreditEvent) => void;
}

function resolveParams(partial: Partial<SimParams> | undefined): SimParams {
	const params: SimParams = { ...DEFAULT_SIM_PARAMS, ...partial };
	if (!Number.isInteger(params.days) || params.days < 1) throw new RangeError(`Simulação: dias inválidos (${params.days}).`);
	if (!(params.desiredRetention > 0 && params.desiredRetention < 1)) throw new RangeError(`Simulação: retenção desejada inválida (${params.desiredRetention}).`);
	if (!(params.retainedR > 0 && params.retainedR < 1)) throw new RangeError(`Simulação: R de retenção inválido (${params.retainedR}).`);
	if (!(params.relearnStepDays >= 0 && params.relearnStepDays < 1)) throw new RangeError(`Simulação: passo de reaprendizagem inválido (${params.relearnStepDays} dia; entre 0 e 1).`);
	return params;
}

function validateProfile(profile: LearnerProfile): void {
	if (!(profile.hoursPerDay >= 0 && profile.hoursPerDay <= 24)) throw new RangeError(`Perfil ${profile.id}: horas/dia inválidas (${profile.hoursPerDay}).`);
	if (!(profile.checkPassRate > 0 && profile.checkPassRate <= 1)) throw new RangeError(`Perfil ${profile.id}: taxa de acerto inválida (${profile.checkPassRate}).`);
	if (profile.speed !== undefined && !(profile.speed > 0 && Number.isFinite(profile.speed))) throw new RangeError(`Perfil ${profile.id}: velocidade inválida (${profile.speed}).`);
	if (!(profile.speedSigma >= 0 && Number.isFinite(profile.speedSigma))) throw new RangeError(`Perfil ${profile.id}: dispersão de velocidade inválida (${profile.speedSigma}).`);
	const farmer = profile.farmer;
	if (farmer?.kind === "early-reviews" && !(farmer.share >= 0 && farmer.share <= 1)) {
		throw new RangeError(`Perfil ${profile.id}: fração de revisões antecipadas inválida (${farmer.share}; entre 0 e 1).`);
	}
	if (farmer?.kind === "skimmer" && !(farmer.timeFraction > 0 && farmer.timeFraction <= 1 && farmer.passRate > 0 && farmer.passRate <= 1)) {
		throw new RangeError(`Perfil ${profile.id}: skimmer inválido (fração de tempo ${farmer.timeFraction}, taxa de acerto ${farmer.passRate}; ambas em (0, 1]).`);
	}
}

/** A lesson of 0 minutes would let a learner finish the core in no time (or throw deep inside the XP rules). */
function validateDomain(domain: SimDomain): void {
	if (domain.stages.length === 0) throw new RangeError("Simulação: o domínio precisa de pelo menos um estágio.");
	for (const [index, stage] of domain.stages.entries()) {
		if (!Number.isInteger(stage.nodes) || stage.nodes < 0) throw new RangeError(`Simulação: estágio ${index + 1} com número de nós inválido (${stage.nodes}).`);
		if (!(stage.lessonMin > 0 && stage.lessonMin <= 600)) throw new RangeError(`Simulação: estágio ${index + 1} com minutos de aula inválidos (${stage.lessonMin}; entre 0 e 600).`);
	}
	if (!(domain.unlockFraction >= 0 && domain.unlockFraction <= 1)) throw new RangeError(`Simulação: fração de desbloqueio inválida (${domain.unlockFraction}).`);
}

/** Simulate one learner with its own deterministic stream `seed`. */
export function simulateLearner(profile: LearnerProfile, domain: SimDomain, seed: number, options: SimulateOptions = {}): LearnerTrajectory {
	validateProfile(profile);
	validateDomain(domain);
	const params = resolveParams(options.params);
	const memory = options.memory ?? defaultMemory();
	const rng = SimRng.seeded(seed);
	const { days, rules } = params;
	const weeks = Math.floor(days / 7);

	// Static node layout (learned strictly in order).
	const stageOf: number[] = [];
	const baseMin: number[] = [];
	const stageStart: number[] = [];
	for (const [s, stage] of domain.stages.entries()) {
		stageStart.push(stageOf.length);
		for (let i = 0; i < stage.nodes; i++) {
			stageOf.push(s);
			baseMin.push(stage.lessonMin);
		}
	}
	const nodeCount = stageOf.length;
	const stageSizes = domain.stages.map((stage) => stage.nodes);

	// Per-learner draws.
	const skip = rng.between(params.skipProbability.lo, params.skipProbability.hi);
	const speed = profile.speed ?? rng.lognormalMean1(profile.speedSigma);
	const vacationStart = Math.floor(rng.next() * (365 - params.vacationDaysPerYear - 21));
	const farmer = profile.farmer;
	const skimming = farmer?.kind === "skimmer";
	const passRate = skimming ? farmer.passRate : profile.checkPassRate;

	// Memory state (one SimMemoryState per node, unpacked into typed arrays).
	const stability = new Float64Array(nodeCount);
	const stabilityFast = new Float64Array(nodeCount);
	const difficulty = new Float64Array(nodeCount);
	const lastReview = new Int32Array(nodeCount);
	const retainedUntil = new Float64Array(nodeCount);
	const learnedPerStage = new Int32Array(domain.stages.length);
	const buckets: (number[] | undefined)[] = new Array(days);
	let backlog: number[] = [];
	const stateOf = (node: number): SimMemoryState => ({
		stability: stability[node] as number,
		stabilityFast: stabilityFast[node] as number,
		difficulty: difficulty[node] as number,
	});
	const store = (node: number, state: SimMemoryState): void => {
		stability[node] = state.stability;
		stabilityFast[node] = state.stabilityFast;
		difficulty[node] = state.difficulty;
	};
	const retrievabilityOf = (node: number, day: number): number => memory.retrievability(day - (lastReview[node] as number), stateOf(node));
	/** A day-scale review of `node` with grade `grade`; a lapse is followed by the runtime's relearning step (Good). */
	const review = (node: number, day: number, R: number, grade: MemoryGrade): void => {
		let state = memory.next(stateOf(node), day - (lastReview[node] as number), R, grade);
		if (grade === 1 && params.relearnStepDays > 0) {
			state = memory.next(state, params.relearnStepDays, memory.retrievability(params.relearnStepDays, state), 3);
		}
		store(node, state);
	};
	const schedule = (node: number, day: number): void => {
		const due = day + memory.intervalDays(stateOf(node), params.desiredRetention);
		if (due >= days) return;
		(buckets[due] ??= []).push(node);
	};
	const remember = (node: number, day: number): void => {
		lastReview[node] = day;
		retainedUntil[node] = day + memory.retainedDays(stateOf(node), params.retainedR);
	};

	const trajectory: LearnerTrajectory = {
		cumXp: new Float64Array(days),
		cumMinutes: new Float64Array(days),
		cumNaiveXp: new Float64Array(days),
		pmByWeek: new Float64Array(weeks),
		stageByWeek: new Uint8Array(weeks),
		reviewMinutes: 0,
		lessonMinutes: 0,
		reviews: 0,
		lapses: 0,
		learnedNodes: 0,
		speed,
		skipProbability: skip,
	};

	let nextNode = 0;
	let attemptMin = 0;
	let attemptExpected = 0;
	let attemptDone = 0;
	/** First attempt of the current node: every honest retry costs `retryFraction` of THIS, not of the previous retry. */
	let firstAttemptMin = 0;
	let firstAttemptExpected = 0;
	let xp = 0;
	let naive = 0;
	let minutes = 0;

	const available = (): boolean => {
		if (nextNode >= nodeCount) return false;
		const s = stageOf[nextNode] as number;
		return s === 0 || (learnedPerStage[s - 1] as number) >= domain.unlockFraction * (stageSizes[s - 1] as number);
	};

	for (let day = 0; day < days; day++) {
		const dayOfYear = day % 365;
		const onVacation = dayOfYear >= vacationStart && dayOfYear < vacationStart + params.vacationDaysPerYear;
		let budget = onVacation || rng.next() < skip ? 0 : profile.hoursPerDay * 60 * rng.lognormalMean1(params.dailyMinutesSigma);
		let creditedToday = 0;
		let seq = 0;
		const credit = (body: ProgressEventBody): void => {
			const priced = eventCredit(body, rules);
			const granted = softCapped(priced.minutes, priced.multiplier, creditedToday, rules);
			creditedToday += priced.minutes;
			xp += granted;
			options.onCredit?.({ day, seq: seq++, body, xp: granted });
		};

		// 1) due reviews, oldest first.
		const due = buckets[day];
		buckets[day] = undefined;
		const queue = due ? backlog.concat(due) : backlog;
		const remaining: number[] = [];
		for (const node of queue) {
			if (budget < params.reviewMin) {
				remaining.push(node);
				continue;
			}
			const R = retrievabilityOf(node, day);
			const recalled = rng.next() < R;
			const cost = params.reviewMin + (recalled ? 0 : params.relearnMin);
			budget -= cost;
			minutes += cost;
			trajectory.reviewMinutes += cost;
			trajectory.reviews += 1;
			credit({ kind: "review", nodeId: `n${node}`, R, focusedMin: cost });
			naive += params.naive.perReview;
			const grade: MemoryGrade = recalled ? (rng.next() < 0.1 ? 4 : rng.next() < 0.11 ? 2 : 3) : 1;
			if (!recalled) trajectory.lapses += 1;
			review(node, day, R, grade);
			remember(node, day);
			schedule(node, day);
		}
		backlog = remaining;

		// 1b) farmer: early reviews of already-easy nodes (schedule untouched, as in r7).
		if (farmer?.kind === "early-reviews" && budget > 0 && nextNode > 0) {
			let farmBudget = budget * farmer.share;
			budget -= farmBudget;
			for (let tries = 0; farmBudget >= params.reviewMin && tries < 200; tries++) {
				const node = Math.floor(rng.next() * nextNode);
				const elapsed = day - (lastReview[node] as number);
				if (elapsed < 1) continue;
				const R = retrievabilityOf(node, day);
				farmBudget -= params.reviewMin;
				minutes += params.reviewMin;
				trajectory.reviewMinutes += params.reviewMin;
				trajectory.reviews += 1;
				credit({ kind: "review", nodeId: `n${node}`, R, focusedMin: params.reviewMin });
				naive += params.naive.perReview;
				const recalled = rng.next() < R;
				review(node, day, R, recalled ? 3 : 1);
				remember(node, day);
			}
		}

		// 2) new nodes from the frontier; a lesson is credited at its check.
		while (budget > 1 && available()) {
			if (attemptMin === 0) {
				// One lesson event carries at most a day of focused time (ledger bound); the clamp never binds in practice.
				attemptExpected = Math.min(MAX_EVENT_MINUTES, (baseMin[nextNode] as number) * speed);
				attemptMin = Math.min(MAX_EVENT_MINUTES, attemptExpected * rng.lognormalMean1(params.nodeTimeSigma) * (skimming ? farmer.timeFraction : 1));
				firstAttemptMin = attemptMin;
				firstAttemptExpected = attemptExpected;
			}
			const use = Math.min(attemptMin - attemptDone, budget);
			attemptDone += use;
			budget -= use;
			minutes += use;
			trajectory.lessonMinutes += use;
			if (attemptDone < attemptMin - 1e-9) break;
			const passed = rng.next() < passRate;
			credit({ kind: "lesson", nodeId: `n${nextNode}`, focusedMin: attemptMin, expectedMin: attemptExpected, checkPassed: passed });
			naive += params.naive.perLesson;
			attemptDone = 0;
			if (passed) {
				const node = nextNode++;
				learnedPerStage[stageOf[node] as number] = (learnedPerStage[stageOf[node] as number] as number) + 1;
				store(node, memory.initial(skimming ? 2 : 3));
				remember(node, day);
				schedule(node, day);
				attemptMin = 0;
			} else if (!skimming) {
				// Non-compounding (r7 §5.1 "refaz +30% do tempo"): sim.mjs multiplied the PREVIOUS attempt, so the
				// k-th retry cost 0.3^k and a learner failing most checks learned almost for free.
				attemptMin = firstAttemptMin * params.retryFraction;
				attemptExpected = firstAttemptExpected * params.retryFraction;
			}
		}

		trajectory.cumXp[day] = xp;
		trajectory.cumMinutes[day] = minutes;
		trajectory.cumNaiveXp[day] = naive;

		// 3) weekly evaluation of retained mastery.
		if (day % 7 === 6) {
			const week = (day - 6) / 7;
			const fractions = stageSizes.map((size, s) => {
				const start = stageStart[s] as number;
				const end = Math.min(start + size, nextNode);
				let retained = 0;
				for (let node = start; node < end; node++) if (day <= (retainedUntil[node] as number)) retained += 1;
				return size > 0 ? retained / size : 0;
			});
			trajectory.pmByWeek[week] = masteryPoints(fractions);
			trajectory.stageByWeek[week] = structuralStage(fractions, params.stageQuota);
		}
	}
	trajectory.learnedNodes = nextNode;
	return trajectory;
}

/** `count` learners of one profile; learner i uses seed deriveSeed(seed, profile.id, i). */
export function simulateCohort(profile: LearnerProfile, domain: SimDomain, count: number, seed: number, options: Omit<SimulateOptions, "onCredit"> = {}): LearnerTrajectory[] {
	if (!Number.isInteger(count) || count < 1) throw new RangeError(`Simulação: número de alunos inválido (${count}).`);
	return Array.from({ length: count }, (_, i) => simulateLearner(profile, domain, deriveSeed(seed, profile.id, i), options));
}

// ─── statistics helpers ─────────────────────────────────────────────────────

/** Linear-interpolated quantile of an ascending array (Infinity entries allowed: "never reached"). */
export function quantileSorted(sorted: ArrayLike<number>, q: number): number {
	if (sorted.length === 0) return Number.NaN;
	const position = (sorted.length - 1) * Math.min(1, Math.max(0, q));
	const lo = Math.floor(position);
	const hi = Math.ceil(position);
	const a = sorted[lo] as number;
	const b = sorted[hi] as number;
	if (lo === hi || a === b) return a;
	if (!Number.isFinite(a) || !Number.isFinite(b)) return position - lo < 0.5 ? a : b;
	return a + (b - a) * (position - lo);
}

export function quantile(values: ArrayLike<number>, q: number): number {
	return quantileSorted(Float64Array.from(values).sort(), q);
}

/** First evaluated day (7w + 6) whose weekly value satisfies `reached`; Infinity if never. */
export function firstWeekDay(byWeek: ArrayLike<number>, reached: (value: number) => boolean): number {
	for (let week = 0; week < byWeek.length; week++) if (reached(byWeek[week] as number)) return week * 7 + 6;
	return Number.POSITIVE_INFINITY;
}

