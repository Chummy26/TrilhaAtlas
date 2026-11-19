/**
 * Elo on the 400 ("chess") scale for learner × item (docs/research/
 * 00-SINTESE.md §2.11; r7 §2.1–§2.3, Pelánek 2016).
 *
 *   E = 1 / (1 + 10^((b − θ)/400))          expected score of θ against b
 *   K(n) = (400/ln 10) · a / (1 + s·n)      Pelánek uncertainty function,
 *                                           a = 1, s = 0.05 (logit → 400 scale)
 *   θ ← θ + K(n_student)·(y − E),  b ← b − K(n_item)·(y − E)
 *
 * The expected score feeds the XP difficulty multiplier mDif(E) in ./xp.ts;
 * item priors come from the node stage: b₀ = 1000 + 200·(s − 1) + 60·z.
 * Glicko-2 / openskill stay out of the MVP (only needed if leagues are on).
 *
 * Pure: browser-safe.
 */

/** Points per logit unit: 400 / ln 10 ≈ 173.72. */
export const ELO_PER_LOGIT = 400 / Math.LN10;

/** Expected score of a learner rated `theta` on an item of difficulty `b`. */
export function expectedScore(theta: number, b: number): number {
	if (!Number.isFinite(theta) || !Number.isFinite(b)) {
		throw new RangeError(`expectedScore: θ e b precisam ser finitos (θ=${theta}, b=${b}).`);
	}
	return 1 / (1 + 10 ** ((b - theta) / 400));
}

/** Pelánek's uncertainty function on the 400 scale: K(n) = 173.7·a / (1 + s·n). */
export function eloK(answers: number, a = 1, slope = 0.05): number {
	if (!Number.isFinite(answers) || answers < 0) throw new RangeError(`eloK: número de respostas inválido (${answers}).`);
	return (ELO_PER_LOGIT * a) / (1 + slope * answers);
}

export interface ItemEloUpdate {
	theta: number;
	b: number;
	/** Expected score BEFORE the answer (what the XP multiplier uses). */
	expected: number;
}

/** One rated answer: y = 1 correct, 0 wrong. Zero-sum only when both K are equal. */
export function eloUpdate(input: { theta: number; b: number; correct: boolean; studentAnswers: number; itemAnswers: number }): ItemEloUpdate {
	const expected = expectedScore(input.theta, input.b);
	const surprise = (input.correct ? 1 : 0) - expected;
	return {
		theta: input.theta + eloK(input.studentAnswers) * surprise,
		b: input.b - eloK(input.itemAnswers) * surprise,
		expected,
	};
}

/** Prior difficulty of an item from its node stage (1..7) and relative difficulty z ∈ [−1, 1]. */
export function itemPriorB(stage: number, z = 0): number {
	if (!Number.isInteger(stage) || stage < 1 || stage > 7) throw new RangeError(`itemPriorB: estágio deve ser inteiro 1–7 (recebido ${stage}).`);
	const clampedZ = Math.max(-1, Math.min(1, Number.isFinite(z) ? z : 0));
	return 1000 + 200 * (stage - 1) + 60 * clampedZ;
}
