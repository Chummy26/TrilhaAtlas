/**
 * Lesson protocol: phases, LessonPlan, KnowledgePoint, PracticeItem and the
 * separate AnswerKey (docs/research/00-SINTESE.md §1.3 "Protocolo de aula por
 * nó", §2.4(b)(c); r1 §6.3, §6.13; P7 "o gabarito fica congelado no servidor e
 * é escondido do cliente").
 *
 * Phases:  prepare → orient → (predict) → warmup → explain[1..3] → worked →
 *          faded → practice → (variation) → recap → cards → exit, with the
 *          `remediate` detour. The ORDER lives in ./orchestrator.ts; this file
 *          only defines the data the orchestrator walks.
 *
 * Authoring vs serving (commit-before-reveal):
 *   • The `tutor` role writes a LessonPlanDraft (src/agent/prompts/lesson/
 *     lesson-plan.md) where every item carries its answer INLINE (correct
 *     option flag, numeric value + unit, accepted answers, hints, solution).
 *     Writing the answer next to the stem keeps the model coherent.
 *   • compileLessonPlan() validates the draft (zod shape + semantic checks:
 *     counts, word budgets, cross references, units) and SPLITS it: items lose
 *     every answer-bearing field and the keys move to `plan.answerKeys`
 *     (server-only). Choice options are shuffled deterministically with a
 *     seed that includes server-only text (hints, solution) and re-labelled
 *     "a", "b", "c"… in display order, so neither the model's "correct
 *     answer first" habit nor a telling authored id ("certa") leaks.
 *   • Clients only ever receive toClientItem() / toClientLessonOutline()
 *     projections, built by WHITELIST (a field added later stays private until
 *     someone deliberately exposes it).
 *   • The cache stores the validated DRAFT; compile is deterministic, so the
 *     served plan is reproducible from it (no second schema to maintain).
 *
 * Validation messages are English on purpose: they go back to the model in
 * the corrective re-ask (one re-ask, SÍNTESE §2.4(b)), never to the learner.
 * Word budgets are enforced with a 10% tolerance (`PLAN_LIMITS.wordTolerance`):
 * an otherwise good 260-word segment is not worth a re-ask; 300 words is.
 *
 * Pure and browser-safe.
 */

import { z } from "zod";
import type { ItemFormat, ItemLevel } from "../learner/types.ts";
import { countWords } from "./text.ts";
import { parseUnitExpression, scaleByPowerOfTen, type SiUnit } from "./units.ts";

// ─── Vocabulary ─────────────────────────────────────────────────────────────

export const LESSON_PHASES = [
	"prepare",
	"orient",
	"predict",
	"warmup",
	"explain",
	"worked",
	"faded",
	"practice",
	"variation",
	"recap",
	"cards",
	"exit",
	"remediate",
] as const;
export type Phase = (typeof LESSON_PHASES)[number];

export const HOOK_KINDS = ["puzzle", "phenomenon", "story", "use_case", "contrast"] as const;
export type HookKind = (typeof HOOK_KINDS)[number];

export const PRACTICE_ITEM_KINDS = ["mcq", "numeric", "short", "explain", "dictation", "minimal_pair", "speak", "sim"] as const;
export type PracticeItemKind = (typeof PRACTICE_ITEM_KINDS)[number];

/** F7 menu (r1 §6.6): a format different from the last two nodes of the domain. */
export const VARIATION_FORMATS = [
	"simulation_poe",
	"find_the_error",
	"contrasting_cases",
	"shadowing",
	"speaking",
	"explain_two_sentences",
	"mini_project",
	"dictation",
	"video_clip",
] as const;
export type VariationFormat = (typeof VARIATION_FORMATS)[number];

export const VERIFIERS = ["solver", "simulator", "key", "judge"] as const;
export type Verifier = (typeof VERIFIERS)[number];

export const MEDIA_KINDS = ["svg", "circuit", "table", "audio", "image"] as const;

export type Difficulty = 1 | 2 | 3;

/**
 * Where an item sits in the lesson. CHECK roles are conversational
 * interactions (budgeted: ≤3 per node, never two in a row, ≤1 per 3 min);
 * the others are practice ("doing"), governed by the pass rule.
 */
export const ITEM_ROLES = ["predict", "warmup", "socratic", "self_explanation", "faded", "practice", "bridge", "variation", "closing"] as const;
export type ItemRole = (typeof ITEM_ROLES)[number];
export const CHECK_ROLES: ReadonlySet<ItemRole> = new Set<ItemRole>(["predict", "socratic", "self_explanation", "closing"]);

/** MA-like mastery of a KP (r1 §6.7): last 2 correct (hint ladder ≤ 2) AND ≥2 of the last 3; ≤5 items. */
export interface PassRule {
	lastNCorrect: number;
	window: number;
	minInWindow: number;
	maxItems: number;
}

export const DEFAULT_PASS_RULE: Readonly<PassRule> = Object.freeze({ lastNCorrect: 2, window: 3, minInWindow: 2, maxItems: 5 });

export const PLAN_LIMITS = Object.freeze({
	segments: { min: 1, max: 3 },
	segmentWords: { min: 120, max: 250 },
	knowledgePoints: { min: 2, max: 4 },
	itemsPerKp: { min: 2, max: 5 },
	hintWords: 35,
	orientWords: 90,
	hookSentences: 3,
	recapWords: 60,
	recapBullets: { min: 2, max: 3 },
	flashcards: { min: 2, max: 6 },
	options: { min: 2, max: 6 },
	predictionOptions: { max: 4 },
	/** Warm-up items per lesson (r1 §6.3 F2: "1–2 itens de pré-requisito devido e englobado"). */
	warmups: { max: 2 },
	estimatedMinutes: { min: 8, max: 30 },
	wordTolerance: 0.1,
	defaultRelTolerance: 0.01,
});

// ─── Served (public) item shapes — no answers in here ───────────────────────

export interface Media {
	kind: (typeof MEDIA_KINDS)[number];
	/** SVG markup, circuit netlist, Markdown table or audio reference. */
	spec: string;
	alt: string;
}

export interface ChoiceOption {
	id: string;
	text: string;
}

interface ItemCommon {
	id: string;
	stem: string;
	difficulty: Difficulty;
	/** ~Bloom level for Evidence (defaults by role in the orchestrator). */
	level?: ItemLevel;
	/** Evidence family (distinct families count toward mastery); default `${nodeId}#${kpId}#d${difficulty}`. */
	family?: string;
	media?: Media;
}

export interface McqItem extends ItemCommon {
	kind: "mcq";
	options: ChoiceOption[];
}

/** HVPT-style discrimination: hear one of two close words, pick it (r1 §8.3). */
export interface MinimalPairItem extends ItemCommon {
	kind: "minimal_pair";
	options: ChoiceOption[];
	/** Server-resolved TTS/recording of the correct option. */
	audioId: string;
	lang: string;
}

export interface NumericItem extends ItemCommon {
	kind: "numeric";
	/** Unit printed next to the input; a bare number is read in this unit. */
	answerUnit?: string;
	/** The learner must type a unit (no `answerUnit` shown). */
	requireUnit: boolean;
}

export interface ShortItem extends ItemCommon {
	kind: "short";
	maxWords: number;
}

export interface ExplainItem extends ItemCommon {
	kind: "explain";
	maxWords: number;
}

export interface DictationItem extends ItemCommon {
	kind: "dictation";
	/** Server-resolved TTS of the (secret) sentence. */
	audioId: string;
	lang: string;
}

export interface SpeakItem extends ItemCommon {
	kind: "speak";
	lang: string;
	/** Text to read aloud / shadow, when the task shows it. */
	display?: string;
}

export interface SimItem extends ItemCommon {
	kind: "sim";
	/** Circuit text for the embedded simulator. */
	circuit: string;
	/** What to measure, e.g. "V(out)". */
	probe: string;
	answerUnit?: string;
	requireUnit: boolean;
}

export type PracticeItem = McqItem | MinimalPairItem | NumericItem | ShortItem | ExplainItem | DictationItem | SpeakItem | SimItem;

// ─── Answer keys (SERVER-ONLY) ──────────────────────────────────────────────

export interface Tolerance {
	rel?: number;
	abs?: number;
}

export type AnswerSpec =
	| { kind: "choice"; correctOptionId: string; /** optionId → misconceptionId */ distractors: Record<string, string> }
	| {
			kind: "numeric";
			/** SI base units. */
			value: number;
			unit: SiUnit | null;
			tolerance: Tolerance;
			/** Buggy-rule answers (BUGGY/Eedi, r1 §9.1): what each misconception would produce. */
			buggy: Array<{ value: number; misconceptionId: string }>;
	  }
	| { kind: "text"; accepted: string[]; reference: string; rubric: string[] }
	| { kind: "transcript"; text: string; accepted: string[] };

export interface AnswerKey {
	itemId: string;
	answer: AnswerSpec;
	/** Ladder: [cue (pista), principle (princípio), next step (próximo passo)] — each ≤35 words. */
	hints: [string, string, string];
	/** Verified step-by-step solution (rung 4 of the ladder). */
	solution: string[];
	verifiedBy: Verifier;
	/** Extra key-side note (e.g. the phonemic contrast of a minimal pair). */
	note?: string;
}

// ─── Plan ───────────────────────────────────────────────────────────────────

export interface Hook {
	kind: HookKind;
	text: string;
}

export interface Analogy {
	source: string;
	mapping: string;
	/** Where the analogy stops working (Richland 2007, r1 §3.14). */
	breaksWhere: string;
}

export interface ExplanationSegment {
	id: string;
	/** The single idea of the segment. */
	idea: string;
	/** 120–250 words of discovery-narrative prose. */
	body: string;
	visual?: Media;
	analogy?: Analogy;
	/** At most one per lesson; posed as a card after the segment, ≤2 rounds. */
	socratic?: { item: PracticeItem; maxRounds: 1 | 2 };
	resolvesPrediction: boolean;
}

export interface WorkedStep {
	subgoal: string;
	text: string;
}

export interface WorkedExample {
	problem: string;
	steps: WorkedStep[];
}

/** Same kind of problem with the given steps shown and the last one left to the learner (Renkl fading). */
export interface FadedExample {
	problem: string;
	given: WorkedStep[];
	blankSubgoal: string;
	blank: PracticeItem;
}

export interface KnowledgePoint {
	id: string;
	title: string;
	/** The one assessable claim/skill of this KP. */
	statement: string;
	passRule: PassRule;
	workedExample: WorkedExample;
	fadedSteps: FadedExample;
	/** 2–5 practice items, isomorphic to the worked example, difficulty 1..3. */
	items: PracticeItem[];
}

export interface Misconception {
	id: string;
	statement: string;
	diagnosticSignal: string;
	repair: string;
	bridgeItem?: PracticeItem;
}

export interface FlashcardCandidate {
	proposition: string;
	cues: string[];
	type: "basic" | "cloze" | "reverse";
	kpId?: string;
	misconceptionId?: string;
}

export interface LessonSource {
	kind: "video" | "book" | "web";
	ref: string;
	start?: string;
	end?: string;
	preQuestions: string[];
}

export interface LessonPlan {
	schemaVersion: 1;
	nodeId: string;
	nodeVersion: number;
	domainId: string;
	/** Language of the explanations (BCP-47, default "pt-BR"). */
	lang: string;
	/** Target language when the domain is a language (English: "en"). */
	targetLang?: string;
	goal: string;
	estimatedMinutes: number;
	hook: Hook;
	prediction?: PracticeItem;
	segments: ExplanationSegment[];
	knowledgePoints: KnowledgePoint[];
	selfExplanation?: { kpId: string; stepIndex: number; item: PracticeItem };
	variation?: { format: VariationFormat; intro: string; item?: PracticeItem };
	recap: { bullets: string[]; unlocks: string[] };
	closing?: PracticeItem;
	misconceptions: Misconception[];
	flashcardCandidates: FlashcardCandidate[];
	encompasses: Array<{ nodeId: string; weight: number }>;
	sources: LessonSource[];
	/** SERVER-ONLY. Never serialized to a client: use toClientItem / toClientLessonOutline. */
	answerKeys: Record<string, AnswerKey>;
}

/** Warm-up item from another node (FIRe vehicle chosen by the scheduler), served with its key. */
export interface WarmupItem {
	nodeId: string;
	item: PracticeItem;
	key: AnswerKey;
	/** Minutes since the learner's last exposure to `nodeId` (Evidence.minutesSinceExposure); default 1440. */
	minutesSinceExposure?: number;
}

export interface PlanItemRef {
	item: PracticeItem;
	role: ItemRole;
	kpId?: string;
	segmentId?: string;
	misconceptionId?: string;
}

/** Every item of the plan with its role (practice items, blanks, checks, bridges). */
export function planItems(plan: LessonPlan): PlanItemRef[] {
	const refs: PlanItemRef[] = [];
	if (plan.prediction) refs.push({ item: plan.prediction, role: "predict" });
	for (const segment of plan.segments) {
		if (segment.socratic) refs.push({ item: segment.socratic.item, role: "socratic", segmentId: segment.id });
	}
	for (const kp of plan.knowledgePoints) {
		refs.push({ item: kp.fadedSteps.blank, role: "faded", kpId: kp.id });
		for (const item of kp.items) refs.push({ item, role: "practice", kpId: kp.id });
	}
	if (plan.selfExplanation) refs.push({ item: plan.selfExplanation.item, role: "self_explanation", kpId: plan.selfExplanation.kpId });
	if (plan.variation?.item) refs.push({ item: plan.variation.item, role: "variation" });
	if (plan.closing) refs.push({ item: plan.closing, role: "closing" });
	for (const m of plan.misconceptions) {
		if (m.bridgeItem) refs.push({ item: m.bridgeItem, role: "bridge", misconceptionId: m.id });
	}
	return refs;
}

export function findPlanItem(plan: LessonPlan, itemId: string): PlanItemRef | undefined {
	return planItems(plan).find((ref) => ref.item.id === itemId);
}

// ─── Pass rule ──────────────────────────────────────────────────────────────

/**
 * Ordered results of finished practice items (true = correct without rungs 3–4).
 * ✗✗✓✓ passes; ✓✓✗✗ does not (order matters, r1 §4.2).
 */
export function passRuleSatisfied(results: readonly boolean[], rule: PassRule): boolean {
	if (results.length < rule.lastNCorrect) return false;
	if (!results.slice(-rule.lastNCorrect).every(Boolean)) return false;
	// "≥ minInWindow of the last `window`" literally: a short history does not
	// lower the bar (with the default rule lastNCorrect = minInWindow, so this
	// only matters for authored rules such as {lastNCorrect:1, minInWindow:2}).
	return results.slice(-rule.window).filter(Boolean).length >= rule.minInWindow;
}

/**
 * Could the KP still pass if every remaining item were answered correctly?
 * `remaining` = items still allowed (min(maxItems, pool) − used).
 */
export function kpCanStillPass(results: readonly boolean[], remaining: number, rule: PassRule): boolean {
	if (passRuleSatisfied(results, rule)) return true;
	if (remaining <= 0) return false;
	return passRuleSatisfied([...results, ...Array.from({ length: remaining }, () => true)], rule);
}

/**
 * No way left to pass: the item budget is spent, the pool ran dry, or even
 * all-correct answers on the items left could no longer satisfy the rule
 * (✗✗✗ with one item left: posing it would only waste the learner's time).
 * Without `results` only the budget and the pool are checked.
 */
export function kpExhausted(usedItems: number, poolSize: number, rule: PassRule, results?: readonly boolean[]): boolean {
	const remaining = Math.min(rule.maxItems, poolSize) - usedItems;
	if (remaining <= 0) return true;
	return results !== undefined && !kpCanStillPass(results, remaining, rule);
}

export function itemFormatOf(kind: PracticeItemKind): ItemFormat {
	return kind === "minimal_pair" ? "mcq" : kind;
}

// ─── Client projections (whitelists) ────────────────────────────────────────

export type ClientItem =
	| { id: string; kind: "mcq"; stem: string; media?: Media; options: ChoiceOption[] }
	| { id: string; kind: "minimal_pair"; stem: string; media?: Media; options: ChoiceOption[]; audioId: string; lang: string }
	| { id: string; kind: "numeric"; stem: string; media?: Media; answerUnit?: string; requireUnit: boolean }
	| { id: string; kind: "short" | "explain"; stem: string; media?: Media; maxWords: number }
	| { id: string; kind: "dictation"; stem: string; media?: Media; audioId: string; lang: string }
	| { id: string; kind: "speak"; stem: string; media?: Media; lang: string; display?: string }
	| { id: string; kind: "sim"; stem: string; media?: Media; circuit: string; probe: string; answerUnit?: string; requireUnit: boolean };

function copyMedia(media: Media | undefined): { media?: Media } {
	return media ? { media: { kind: media.kind, spec: media.spec, alt: media.alt } } : {};
}

function copyOptions(options: readonly ChoiceOption[]): ChoiceOption[] {
	return options.map((o) => ({ id: o.id, text: o.text }));
}

/** What the learner's UI may see of an item (no difficulty, family, key or hints). */
export function toClientItem(item: PracticeItem): ClientItem {
	const base = { id: item.id, stem: item.stem, ...copyMedia(item.media) };
	switch (item.kind) {
		case "mcq":
			return { ...base, kind: "mcq", options: copyOptions(item.options) };
		case "minimal_pair":
			return { ...base, kind: "minimal_pair", options: copyOptions(item.options), audioId: item.audioId, lang: item.lang };
		case "numeric":
			return { ...base, kind: "numeric", requireUnit: item.requireUnit, ...(item.answerUnit ? { answerUnit: item.answerUnit } : {}) };
		case "short":
		case "explain":
			return { ...base, kind: item.kind, maxWords: item.maxWords };
		case "dictation":
			return { ...base, kind: "dictation", audioId: item.audioId, lang: item.lang };
		case "speak":
			return { ...base, kind: "speak", lang: item.lang, ...(item.display ? { display: item.display } : {}) };
		case "sim":
			return {
				...base,
				kind: "sim",
				circuit: item.circuit,
				probe: item.probe,
				requireUnit: item.requireUnit,
				...(item.answerUnit ? { answerUnit: item.answerUnit } : {}),
			};
	}
}

export interface ClientLessonOutline {
	nodeId: string;
	goal: string;
	hook: Hook;
	estimatedMinutes: number;
	segments: Array<{ id: string; idea: string }>;
	knowledgePoints: Array<{ id: string; title: string }>;
}

/** The lesson "map" a client may show (no bodies needed, no items, no keys). */
export function toClientLessonOutline(plan: LessonPlan): ClientLessonOutline {
	return {
		nodeId: plan.nodeId,
		goal: plan.goal,
		hook: { kind: plan.hook.kind, text: plan.hook.text },
		estimatedMinutes: plan.estimatedMinutes,
		segments: plan.segments.map((s) => ({ id: s.id, idea: s.idea })),
		knowledgePoints: plan.knowledgePoints.map((kp) => ({ id: kp.id, title: kp.title })),
	};
}

// ─── Draft (authored) schema ────────────────────────────────────────────────

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const IdSchema = z.string().regex(ID_PATTERN, "ids use 1–64 letters, digits, '_', '.', ':' or '-' and start alphanumeric");
const TextSchema = z.string().trim().min(1, "must be a non-empty string");
const DifficultySchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const ItemLevelSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
const MediaSchema = z.strictObject({ kind: z.enum(MEDIA_KINDS), spec: TextSchema, alt: TextSchema });
const ToleranceSchema = z.strictObject({
	rel: z.number().positive().max(0.5, "relative tolerance above 50% is not a check").optional(),
	abs: z.number().nonnegative().optional(),
});

const authoredCommon = {
	id: IdSchema,
	stem: TextSchema,
	difficulty: DifficultySchema,
	level: ItemLevelSchema.optional(),
	family: z.string().trim().min(1).max(80).optional(),
	media: MediaSchema.optional(),
	hints: z.tuple([TextSchema, TextSchema, TextSchema]),
	solution: z.array(TextSchema).min(1, "a solution needs at least one step").max(10),
	verifiedBy: z.enum(VERIFIERS).default("key"),
};

const AuthoredOptionSchema = z.strictObject({
	id: IdSchema,
	text: TextSchema,
	correct: z.boolean().default(false),
	misconceptionId: IdSchema.nullish(),
});

const NumericAnswerSchema = z.strictObject({
	value: z.number(),
	unit: z.string().trim().nullish(),
	tolerance: ToleranceSchema.optional(),
});

const BuggySchema = z.strictObject({ value: z.number(), unit: z.string().trim().nullish(), misconceptionId: IdSchema });

const optionsSchema = z.array(AuthoredOptionSchema).min(PLAN_LIMITS.options.min).max(PLAN_LIMITS.options.max);

export const AuthoredItemSchema = z.discriminatedUnion("kind", [
	z.strictObject({ kind: z.literal("mcq"), ...authoredCommon, options: optionsSchema }),
	z.strictObject({
		kind: z.literal("minimal_pair"),
		...authoredCommon,
		options: optionsSchema,
		lang: z.string().min(2).default("en"),
		contrast: TextSchema.optional(),
	}),
	z.strictObject({
		kind: z.literal("numeric"),
		...authoredCommon,
		answer: NumericAnswerSchema,
		answerUnit: TextSchema.optional(),
		requireUnit: z.boolean().optional(),
		buggy: z.array(BuggySchema).max(6).default([]),
	}),
	z.strictObject({
		kind: z.literal("short"),
		...authoredCommon,
		answer: z.strictObject({ accepted: z.array(TextSchema).max(12).default([]), reference: TextSchema, rubric: z.array(TextSchema).min(1).max(6) }),
		maxWords: z.number().int().min(1).max(80).default(25),
	}),
	z.strictObject({
		kind: z.literal("explain"),
		...authoredCommon,
		answer: z.strictObject({ reference: TextSchema, rubric: z.array(TextSchema).min(1).max(6) }),
		maxWords: z.number().int().min(10).max(200).default(60),
	}),
	z.strictObject({ kind: z.literal("dictation"), ...authoredCommon, text: TextSchema, lang: z.string().min(2).default("en") }),
	z.strictObject({
		kind: z.literal("speak"),
		...authoredCommon,
		target: TextSchema,
		accepted: z.array(TextSchema).max(8).default([]),
		display: TextSchema.optional(),
		lang: z.string().min(2).default("en"),
	}),
	z.strictObject({
		kind: z.literal("sim"),
		...authoredCommon,
		circuit: TextSchema,
		probe: TextSchema,
		answer: NumericAnswerSchema,
		answerUnit: TextSchema.optional(),
		requireUnit: z.boolean().optional(),
		buggy: z.array(BuggySchema).max(6).default([]),
	}),
]);
export type AuthoredItem = z.infer<typeof AuthoredItemSchema>;

const WorkedStepSchema = z.strictObject({ subgoal: TextSchema, text: TextSchema });

const PassRuleSchema = z.strictObject({
	lastNCorrect: z.number().int().min(1).max(5),
	window: z.number().int().min(1).max(8),
	minInWindow: z.number().int().min(1).max(8),
	maxItems: z.number().int().min(2).max(8),
});

const KnowledgePointDraftSchema = z.strictObject({
	id: IdSchema,
	title: TextSchema,
	statement: TextSchema,
	passRule: PassRuleSchema.optional(),
	workedExample: z.strictObject({ problem: TextSchema, steps: z.array(WorkedStepSchema).min(1).max(8) }),
	fadedSteps: z.strictObject({
		problem: TextSchema,
		given: z.array(WorkedStepSchema).max(7).default([]),
		blankSubgoal: TextSchema,
		blank: AuthoredItemSchema,
	}),
	items: z
		.array(AuthoredItemSchema)
		.min(PLAN_LIMITS.itemsPerKp.min, `each knowledge point needs ${PLAN_LIMITS.itemsPerKp.min}–${PLAN_LIMITS.itemsPerKp.max} items`)
		.max(PLAN_LIMITS.itemsPerKp.max, `each knowledge point needs ${PLAN_LIMITS.itemsPerKp.min}–${PLAN_LIMITS.itemsPerKp.max} items`),
});

const SegmentDraftSchema = z.strictObject({
	id: IdSchema,
	idea: TextSchema,
	body: TextSchema,
	visual: MediaSchema.optional(),
	analogy: z.strictObject({ source: TextSchema, mapping: TextSchema, breaksWhere: TextSchema }).optional(),
	socratic: z.strictObject({ item: AuthoredItemSchema, maxRounds: z.union([z.literal(1), z.literal(2)]).default(1) }).optional(),
	resolvesPrediction: z.boolean().default(false),
});

const MisconceptionDraftSchema = z.strictObject({
	id: IdSchema,
	statement: TextSchema,
	diagnosticSignal: TextSchema,
	repair: TextSchema,
	bridgeItem: AuthoredItemSchema.optional(),
});

const FlashcardCandidateSchema = z.strictObject({
	proposition: TextSchema,
	cues: z.array(TextSchema).min(1).max(2),
	type: z.enum(["basic", "cloze", "reverse"]).default("basic"),
	kpId: IdSchema.optional(),
	misconceptionId: IdSchema.optional(),
});

const SourceSchema = z.strictObject({
	kind: z.enum(["video", "book", "web"]),
	ref: TextSchema,
	start: z.string().optional(),
	end: z.string().optional(),
	preQuestions: z.array(TextSchema).max(2).default([]),
});

export const LessonPlanDraftSchema = z.strictObject({
	nodeId: TextSchema,
	nodeVersion: z.number().int().min(1).optional(),
	domainId: TextSchema.optional(),
	lang: z.string().min(2).default("pt-BR"),
	targetLang: z.string().min(2).optional(),
	goal: TextSchema,
	estimatedMinutes: z.number().min(PLAN_LIMITS.estimatedMinutes.min).max(PLAN_LIMITS.estimatedMinutes.max),
	hook: z.strictObject({ kind: z.enum(HOOK_KINDS), text: TextSchema }),
	prediction: AuthoredItemSchema.optional(),
	segments: z.array(SegmentDraftSchema).min(PLAN_LIMITS.segments.min).max(PLAN_LIMITS.segments.max, "1–3 explanation segments"),
	knowledgePoints: z
		.array(KnowledgePointDraftSchema)
		.min(PLAN_LIMITS.knowledgePoints.min, "2–4 knowledge points")
		.max(PLAN_LIMITS.knowledgePoints.max, "2–4 knowledge points"),
	selfExplanation: z.strictObject({ kpId: IdSchema, stepIndex: z.number().int().min(0), item: AuthoredItemSchema }).optional(),
	variation: z.strictObject({ format: z.enum(VARIATION_FORMATS), intro: TextSchema, item: AuthoredItemSchema.optional() }).optional(),
	recap: z.strictObject({
		bullets: z.array(TextSchema).min(PLAN_LIMITS.recapBullets.min, "2–3 recap bullets").max(PLAN_LIMITS.recapBullets.max, "2–3 recap bullets"),
		unlocks: z.array(TextSchema).max(6).default([]),
	}),
	closing: AuthoredItemSchema.optional(),
	misconceptions: z.array(MisconceptionDraftSchema).max(8).default([]),
	flashcardCandidates: z
		.array(FlashcardCandidateSchema)
		.min(PLAN_LIMITS.flashcards.min, "2–6 flashcard candidates")
		.max(PLAN_LIMITS.flashcards.max, "2–6 flashcard candidates"),
	encompasses: z.array(z.strictObject({ nodeId: TextSchema, weight: z.number().min(0).max(1) })).max(12).default([]),
	sources: z.array(SourceSchema).max(4).default([]),
});
export type LessonPlanDraft = z.infer<typeof LessonPlanDraftSchema>;

// ─── Compile: validate + split keys ─────────────────────────────────────────

export interface PlanIssue {
	path: string;
	message: string;
}

export type CompileResult = { ok: true; plan: LessonPlan; warnings: PlanIssue[] } | { ok: false; issues: PlanIssue[] };

export interface CompileContext {
	/** Expected node (the plan must be for it). */
	nodeId?: string;
	nodeVersion?: number;
	domainId?: string;
}

/** Max words allowed for a budget, with the plan tolerance. */
export function withWordTolerance(limit: number): number {
	return Math.floor(limit * (1 + PLAN_LIMITS.wordTolerance));
}

function countSentences(text: string): number {
	return text
		.split(/(?<=[.!?…])\s+/u)
		.map((s) => s.trim())
		.filter((s) => /[\p{L}\p{N}]/u.test(s)).length;
}

/** FNV-1a 32-bit — stable seed for the option shuffle. */
function fnv1a(text: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/** Deterministic Fisher–Yates driven by mulberry32(seed). */
export function stableShuffle<T>(values: readonly T[], seedText: string): T[] {
	const out = [...values];
	let state = fnv1a(seedText);
	const next = (): number => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(next() * (i + 1));
		const a = out[i] as T;
		out[i] = out[j] as T;
		out[j] = a;
	}
	return out;
}

interface CompileScope {
	issues: PlanIssue[];
	warnings: PlanIssue[];
	misconceptionIds: ReadonlySet<string>;
	itemIds: Set<string>;
	keys: Record<string, AnswerKey>;
}

function commonFields(a: AuthoredItem): ItemCommon {
	return {
		id: a.id,
		stem: a.stem,
		difficulty: a.difficulty,
		...(a.level ? { level: a.level } : {}),
		...(a.family ? { family: a.family } : {}),
		...(a.media ? { media: a.media } : {}),
	};
}

function checkMisconceptionRef(id: string | null | undefined, path: string, scope: CompileScope): string | undefined {
	if (!id) return undefined;
	if (!scope.misconceptionIds.has(id)) {
		scope.issues.push({ path, message: `misconception "${id}" is not declared in plan.misconceptions` });
		return undefined;
	}
	return id;
}

/** Served option id of display position `i`: "a", "b", "c"… (≤ PLAN_LIMITS.options.max). */
export function optionLabel(position: number): string {
	return String.fromCharCode(97 + position);
}

/**
 * Seed of the option shuffle: the item id plus SERVER-ONLY text (hints and
 * solution). A seed made of public fields alone would let anyone holding this
 * (AGPL) source recompute the permutation from what the card shows and undo
 * it, recovering the authored order — where models habitually put the
 * correct option first.
 */
function choiceShuffleSeed(a: AuthoredItem): string {
	return [a.id, ...a.hints, ...a.solution].join("\u0000");
}

/**
 * Options are shuffled and RE-LABELLED "a", "b", "c"… in display order: the
 * authored ids never reach the client (an id such as "correct"/"certa", or a
 * habitual "a" for the right answer, would give the key away), and the label
 * carries no information beyond the (secretly seeded) position.
 */
function compileChoice(a: Extract<AuthoredItem, { kind: "mcq" | "minimal_pair" }>, path: string, scope: CompileScope) {
	const correctIndexes = a.options.flatMap((o, i) => (o.correct ? [i] : []));
	if (correctIndexes.length !== 1) scope.issues.push({ path: `${path}.options`, message: `exactly one option must have "correct": true (found ${correctIndexes.length})` });
	const ids = new Set<string>();
	a.options.forEach((o, i) => {
		if (ids.has(o.id)) scope.issues.push({ path: `${path}.options.${i}.id`, message: `duplicate option id "${o.id}"` });
		ids.add(o.id);
		if (o.correct && o.misconceptionId) scope.issues.push({ path: `${path}.options.${i}`, message: "the correct option cannot carry a misconceptionId" });
	});
	const order = stableShuffle(
		a.options.map((_, i) => i),
		choiceShuffleSeed(a),
	);
	const servedId = (authoredIndex: number): string => optionLabel(order.indexOf(authoredIndex));
	const options: ChoiceOption[] = order.map((authoredIndex, position) => ({ id: optionLabel(position), text: a.options[authoredIndex]?.text ?? "" }));
	const distractors: Record<string, string> = {};
	a.options.forEach((o, i) => {
		const mis = o.correct ? undefined : checkMisconceptionRef(o.misconceptionId, `${path}.options.${i}.misconceptionId`, scope);
		if (mis) distractors[servedId(i)] = mis;
	});
	const correctIndex = correctIndexes[0];
	return { options, answer: { kind: "choice" as const, correctOptionId: correctIndex === undefined ? "" : servedId(correctIndex), distractors } };
}

function normalizeNumeric(
	a: Extract<AuthoredItem, { kind: "numeric" | "sim" }>,
	path: string,
	scope: CompileScope,
): { answer: AnswerSpec; answerUnit?: string; requireUnit: boolean } {
	const unitExpr = parseUnitExpression(a.answer.unit ?? "");
	if (!unitExpr) scope.issues.push({ path: `${path}.answer.unit`, message: `unrecognized unit "${a.answer.unit}" (use V, A, Ω/ohm, F, H, Hz, W, s with p n µ m k M G)` });
	const exponent = unitExpr?.exponent ?? 0;
	const unit = unitExpr?.unit ?? null;
	const value = scaleByPowerOfTen(a.answer.value, exponent);
	const tolerance: Tolerance = a.answer.tolerance && (a.answer.tolerance.rel !== undefined || a.answer.tolerance.abs !== undefined)
		? { ...a.answer.tolerance }
		: { rel: PLAN_LIMITS.defaultRelTolerance };
	if (value === 0 && !tolerance.abs) {
		scope.issues.push({ path: `${path}.answer.tolerance`, message: "a zero target needs an absolute tolerance (abs)" });
	}
	let answerUnit: string | undefined;
	if (a.answerUnit) {
		const display = parseUnitExpression(a.answerUnit);
		if (!display || display.unit !== unit) {
			scope.issues.push({ path: `${path}.answerUnit`, message: `answerUnit "${a.answerUnit}" must be a prefix of the answer unit (${unit ?? "dimensionless"})` });
		} else {
			answerUnit = a.answerUnit;
		}
	}
	const buggy: Array<{ value: number; misconceptionId: string }> = [];
	a.buggy.forEach((b, i) => {
		const bUnit = b.unit === undefined || b.unit === null ? unitExpr : parseUnitExpression(b.unit);
		const mis = checkMisconceptionRef(b.misconceptionId, `${path}.buggy.${i}.misconceptionId`, scope);
		if (!bUnit || bUnit.unit !== unit) {
			scope.issues.push({ path: `${path}.buggy.${i}.unit`, message: "buggy value must use the same unit as the answer" });
			return;
		}
		if (mis) buggy.push({ value: scaleByPowerOfTen(b.value, bUnit.exponent), misconceptionId: mis });
	});
	const requireUnit = a.requireUnit ?? (unit !== null && answerUnit === undefined);
	return { answer: { kind: "numeric", value, unit, tolerance, buggy }, ...(answerUnit ? { answerUnit } : {}), requireUnit };
}

function compileItem(a: AuthoredItem, path: string, scope: CompileScope): PracticeItem {
	if (scope.itemIds.has(a.id)) scope.issues.push({ path: `${path}.id`, message: `duplicate item id "${a.id}"` });
	scope.itemIds.add(a.id);
	a.hints.forEach((hint, i) => {
		const words = countWords(hint);
		if (words > withWordTolerance(PLAN_LIMITS.hintWords)) {
			scope.issues.push({ path: `${path}.hints.${i}`, message: `hint has ${words} words; the limit is ${PLAN_LIMITS.hintWords}` });
		}
	});
	const base = commonFields(a);
	const keyBase = { itemId: a.id, hints: [...a.hints] as [string, string, string], solution: [...a.solution], verifiedBy: a.verifiedBy };
	switch (a.kind) {
		case "mcq": {
			const { options, answer } = compileChoice(a, path, scope);
			scope.keys[a.id] = { ...keyBase, answer };
			return { ...base, kind: "mcq", options };
		}
		case "minimal_pair": {
			const { options, answer } = compileChoice(a, path, scope);
			scope.keys[a.id] = { ...keyBase, answer, ...(a.contrast ? { note: a.contrast } : {}) };
			return { ...base, kind: "minimal_pair", options, audioId: `tts:${a.id}`, lang: a.lang };
		}
		case "numeric":
		case "sim": {
			const { answer, answerUnit, requireUnit } = normalizeNumeric(a, path, scope);
			scope.keys[a.id] = { ...keyBase, answer };
			const unitFields = { requireUnit, ...(answerUnit ? { answerUnit } : {}) };
			return a.kind === "numeric"
				? { ...base, kind: "numeric", ...unitFields }
				: { ...base, kind: "sim", circuit: a.circuit, probe: a.probe, ...unitFields };
		}
		case "short":
			scope.keys[a.id] = { ...keyBase, answer: { kind: "text", accepted: [...a.answer.accepted], reference: a.answer.reference, rubric: [...a.answer.rubric] } };
			return { ...base, kind: "short", maxWords: a.maxWords };
		case "explain":
			scope.keys[a.id] = { ...keyBase, answer: { kind: "text", accepted: [], reference: a.answer.reference, rubric: [...a.answer.rubric] } };
			return { ...base, kind: "explain", maxWords: a.maxWords };
		case "dictation":
			scope.keys[a.id] = { ...keyBase, answer: { kind: "transcript", text: a.text, accepted: [] } };
			return { ...base, kind: "dictation", audioId: `tts:${a.id}`, lang: a.lang };
		case "speak":
			scope.keys[a.id] = { ...keyBase, answer: { kind: "transcript", text: a.target, accepted: [...a.accepted] } };
			return { ...base, kind: "speak", lang: a.lang, ...(a.display ? { display: a.display } : {}) };
	}
}

function checkUnique(ids: readonly string[], path: string, what: string, issues: PlanIssue[]): void {
	const seen = new Set<string>();
	ids.forEach((id, i) => {
		if (seen.has(id)) issues.push({ path: `${path}.${i}.id`, message: `duplicate ${what} id "${id}"` });
		seen.add(id);
	});
}

function checkWords(text: string, max: number, path: string, what: string, issues: PlanIssue[], min = 0): void {
	const words = countWords(text);
	if (words > withWordTolerance(max)) issues.push({ path, message: `${what} has ${words} words; the limit is ${max}` });
	if (min > 0 && words < Math.ceil(min * (1 - PLAN_LIMITS.wordTolerance))) issues.push({ path, message: `${what} has ${words} words; write at least ${min}` });
}

function checkPassRule(rule: PassRule, poolSize: number, path: string, issues: PlanIssue[]): void {
	if (rule.lastNCorrect > rule.window) issues.push({ path, message: "passRule.lastNCorrect cannot exceed passRule.window" });
	if (rule.minInWindow > rule.window) issues.push({ path, message: "passRule.minInWindow cannot exceed passRule.window" });
	// Fewest items that can ever satisfy the rule: lastNCorrect in a row AND minInWindow correct.
	const needed = Math.max(rule.lastNCorrect, rule.minInWindow);
	if (rule.maxItems < needed) issues.push({ path, message: `passRule.maxItems must allow ${needed} items (lastNCorrect and minInWindow)` });
	if (poolSize < needed) issues.push({ path, message: `the item pool (${poolSize}) is smaller than the ${needed} items the passRule needs` });
}

function zodIssues(error: z.ZodError): PlanIssue[] {
	return error.issues.map((issue) => ({ path: issue.path.map(String).join(".") || "(root)", message: issue.message }));
}

/** Validate a LessonPlanDraft and split it into a served LessonPlan + server-only answer keys. */
export function compileLessonPlan(input: unknown, ctx: CompileContext = {}): CompileResult {
	const parsed = LessonPlanDraftSchema.safeParse(input);
	if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error) };
	const draft = parsed.data;
	const issues: PlanIssue[] = [];
	const warnings: PlanIssue[] = [];

	if (ctx.nodeId && draft.nodeId !== ctx.nodeId) issues.push({ path: "nodeId", message: `plan is for "${draft.nodeId}", expected "${ctx.nodeId}"` });

	checkUnique(draft.segments.map((s) => s.id), "segments", "segment", issues);
	checkUnique(draft.knowledgePoints.map((k) => k.id), "knowledgePoints", "knowledge point", issues);
	checkUnique(draft.misconceptions.map((m) => m.id), "misconceptions", "misconception", issues);

	const scope: CompileScope = {
		issues,
		warnings,
		misconceptionIds: new Set(draft.misconceptions.map((m) => m.id)),
		itemIds: new Set(),
		keys: {},
	};

	const orientWords = countWords(draft.goal) + countWords(draft.hook.text);
	if (orientWords > withWordTolerance(PLAN_LIMITS.orientWords)) {
		issues.push({ path: "hook.text", message: `goal + hook have ${orientWords} words; the orient budget is ${PLAN_LIMITS.orientWords}` });
	}
	if (countSentences(draft.hook.text) > PLAN_LIMITS.hookSentences) issues.push({ path: "hook.text", message: "the hook must be at most 3 sentences" });

	let prediction: PracticeItem | undefined;
	if (draft.prediction) {
		if (draft.prediction.kind !== "mcq" && draft.prediction.kind !== "minimal_pair") {
			issues.push({ path: "prediction.kind", message: "a prediction is a one-tap choice (mcq)" });
		} else if (draft.prediction.options.length > PLAN_LIMITS.predictionOptions.max) {
			// r1 §6.3 F1b: "previsão 1-toque (2–4 opções + 'não sei')".
			issues.push({ path: "prediction.options", message: `a prediction offers at most ${PLAN_LIMITS.predictionOptions.max} options (the app adds "não sei")` });
		}
		prediction = compileItem(draft.prediction, "prediction", scope);
	}

	const socraticCount = draft.segments.filter((s) => s.socratic).length;
	if (socraticCount > 1) issues.push({ path: "segments", message: "at most one segment may carry a socratic step" });
	if (!draft.prediction && draft.segments.some((s) => s.resolvesPrediction)) {
		issues.push({ path: "segments", message: "resolvesPrediction is set but the plan has no prediction" });
	}
	const segments: ExplanationSegment[] = draft.segments.map((s, i) => {
		checkWords(s.body, PLAN_LIMITS.segmentWords.max, `segments.${i}.body`, "segment body", issues, PLAN_LIMITS.segmentWords.min);
		return {
			id: s.id,
			idea: s.idea,
			body: s.body,
			...(s.visual ? { visual: s.visual } : {}),
			...(s.analogy ? { analogy: { ...s.analogy } } : {}),
			...(s.socratic ? { socratic: { item: compileItem(s.socratic.item, `segments.${i}.socratic.item`, scope), maxRounds: s.socratic.maxRounds } } : {}),
			resolvesPrediction: s.resolvesPrediction,
		};
	});
	const firstSegment = segments[0];
	if (prediction && !segments.some((s) => s.resolvesPrediction) && firstSegment) {
		firstSegment.resolvesPrediction = true;
		warnings.push({ path: "segments.0.resolvesPrediction", message: "no segment resolved the prediction; the first one will" });
	}

	const knowledgePoints: KnowledgePoint[] = draft.knowledgePoints.map((kp, k) => {
		const passRule: PassRule = kp.passRule ? { ...kp.passRule } : { ...DEFAULT_PASS_RULE };
		checkPassRule(passRule, kp.items.length, `knowledgePoints.${k}.passRule`, issues);
		return {
			id: kp.id,
			title: kp.title,
			statement: kp.statement,
			passRule,
			workedExample: { problem: kp.workedExample.problem, steps: kp.workedExample.steps.map((s) => ({ ...s })) },
			fadedSteps: {
				problem: kp.fadedSteps.problem,
				given: kp.fadedSteps.given.map((s) => ({ ...s })),
				blankSubgoal: kp.fadedSteps.blankSubgoal,
				blank: compileItem(kp.fadedSteps.blank, `knowledgePoints.${k}.fadedSteps.blank`, scope),
			},
			items: kp.items.map((item, i) => compileItem(item, `knowledgePoints.${k}.items.${i}`, scope)),
		};
	});

	let selfExplanation: LessonPlan["selfExplanation"];
	if (draft.selfExplanation) {
		const target = knowledgePoints.find((kp) => kp.id === draft.selfExplanation?.kpId);
		if (!target) issues.push({ path: "selfExplanation.kpId", message: `unknown knowledge point "${draft.selfExplanation.kpId}"` });
		else if (draft.selfExplanation.stepIndex >= target.workedExample.steps.length) {
			issues.push({ path: "selfExplanation.stepIndex", message: "stepIndex is outside the worked example" });
		}
		selfExplanation = {
			kpId: draft.selfExplanation.kpId,
			stepIndex: draft.selfExplanation.stepIndex,
			item: compileItem(draft.selfExplanation.item, "selfExplanation.item", scope),
		};
	}

	const variation: LessonPlan["variation"] = draft.variation
		? {
				format: draft.variation.format,
				intro: draft.variation.intro,
				...(draft.variation.item ? { item: compileItem(draft.variation.item, "variation.item", scope) } : {}),
			}
		: undefined;

	const recapText = draft.recap.bullets.join(" ");
	checkWords(recapText, PLAN_LIMITS.recapWords, "recap.bullets", "the recap", issues);

	const closing = draft.closing ? compileItem(draft.closing, "closing", scope) : undefined;

	const misconceptions: Misconception[] = draft.misconceptions.map((m, i) => ({
		id: m.id,
		statement: m.statement,
		diagnosticSignal: m.diagnosticSignal,
		repair: m.repair,
		...(m.bridgeItem ? { bridgeItem: compileItem(m.bridgeItem, `misconceptions.${i}.bridgeItem`, scope) } : {}),
	}));

	const kpIds = new Set(knowledgePoints.map((kp) => kp.id));
	const flashcardCandidates: FlashcardCandidate[] = draft.flashcardCandidates.map((c, i) => {
		if (c.kpId && !kpIds.has(c.kpId)) issues.push({ path: `flashcardCandidates.${i}.kpId`, message: `unknown knowledge point "${c.kpId}"` });
		const mis = checkMisconceptionRef(c.misconceptionId, `flashcardCandidates.${i}.misconceptionId`, scope);
		return {
			proposition: c.proposition,
			cues: [...c.cues],
			type: c.type,
			...(c.kpId ? { kpId: c.kpId } : {}),
			...(mis ? { misconceptionId: mis } : {}),
		};
	});

	if (issues.length > 0) return { ok: false, issues };

	const plan: LessonPlan = {
		schemaVersion: 1,
		nodeId: draft.nodeId,
		nodeVersion: ctx.nodeVersion ?? draft.nodeVersion ?? 1,
		domainId: ctx.domainId ?? draft.domainId ?? "",
		lang: draft.lang,
		...(draft.targetLang ? { targetLang: draft.targetLang } : {}),
		goal: draft.goal,
		estimatedMinutes: draft.estimatedMinutes,
		hook: { kind: draft.hook.kind, text: draft.hook.text },
		...(prediction ? { prediction } : {}),
		segments,
		knowledgePoints,
		...(selfExplanation ? { selfExplanation } : {}),
		...(variation ? { variation } : {}),
		recap: { bullets: [...draft.recap.bullets], unlocks: [...draft.recap.unlocks] },
		...(closing ? { closing } : {}),
		misconceptions,
		flashcardCandidates,
		encompasses: draft.encompasses.map((e) => ({ ...e })),
		sources: draft.sources.map((s) => ({ ...s, preQuestions: [...s.preQuestions] })),
		answerKeys: scope.keys,
	};
	return { ok: true, plan, warnings };
}

/** Issues as a compact English list for the corrective re-ask. */
export function formatPlanIssues(issues: readonly PlanIssue[]): string {
	return issues.map((i) => `- ${i.path}: ${i.message}`).join("\n");
}
