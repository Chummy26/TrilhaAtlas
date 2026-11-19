/**
 * Progress / gamification contracts (docs/research/00-SINTESE.md §2.3, §2.11,
 * §1.4; r7 §4.1–§4.7).
 *
 * Four layers, each measuring ONE thing:
 *   • XP (+ level)      — verified productive effort: 1 XP ≈ 1 focused minute,
 *                         scaled by mDif(E) (items) or gReview(R) (reviews).
 *                         Append-only ledger, idempotent by `eventId`, never
 *                         negative, never dependent on Again/Hard/Good/Easy.
 *   • Region badges     — local mastery from learner-model signals
 *                         (Explorada → Familiar → Proficiente → Dominada,
 *                         plus the "Enferrujada" overlay).
 *   • Domain tier       — RETAINED mastery of the frozen canonical core
 *                         (Bronze … Doutor, divisions III/II/I) via
 *                         PM = Σ_s s·|retained(core[s])| / |core[s]|.
 *   • Weekly streak     — habit only (5/7 default), freezes, 48 h repair,
 *                         travel mode. Gives no XP.
 *
 * `ProgressEvent` is the SÍNTESE §2.3 union plus the envelope every ledger row
 * needs (`eventId`, `at`, `domainId`) and the OPTIONAL r7 §4.3 refinements
 * (expected time, check result, hints…). `XpLedgerEntry` is the SÍNTESE row
 * plus the bookkeeping the daily soft cap needs (`day`, `minutes`,
 * `multiplier`, `kind`). There is deliberately NO rating / grade field on any
 * event: XP cannot depend on self-assessment by construction (invariant I7).
 *
 * Pure types: browser-safe.
 */

import type { DomainId } from "../domains/types.ts";

/** Version tag written on every ledger row. "2026-11-r1" is the current rule set. */
export type RulesVersion = "2026-11-r1" | (string & {});

/** Fields every progress event carries (ledger idempotency + day bucketing). */
export interface ProgressEventEnvelope {
	/** Globally unique, stable id (ULID/UUID or `anki:<revlogId>`). Re-sending it never pays twice. */
	eventId: string;
	/** ISO-8601 instant of the credit (end of the activity). */
	at: string;
	domainId: DomainId;
}

/** Where a review happened (Anki time is capped tighter, r7 §4.3). */
export type ReviewOrigin = "app" | "anki" | "obsidian";

export type ProgressEventBody =
	| {
			kind: "lesson";
			nodeId: string;
			/** Active (focused) minutes: idle > 90 s, unfocused window and paused media excluded. */
			focusedMin: number;
			/** Expected minutes for this attempt; credited time is capped at 1.5× this. */
			expectedMin?: number;
			/** Comprehension check outcome; omitted = unverified (effort credit only). */
			checkPassed?: boolean;
	  }
	| {
			kind: "media";
			resourceId: string;
			focusedMin: number;
			/** Media length; credited time = min(focused, media). */
			mediaMin?: number;
			/** Retrieval questions after the chapter/video; omitted = passive consumption. */
			checkPassed?: boolean;
	  }
	| {
			kind: "item";
			itemId: string;
			/** Learner Elo rating BEFORE answering (400 scale). */
			theta: number;
			/** Item Elo difficulty (400 scale). */
			b: number;
			correct: boolean;
			focusedMin: number;
			hints?: number;
			/** Personal/item median solve time: enables the guess rule and the 1.5× cap. */
			medianMin?: number;
	  }
	| {
			kind: "review";
			/** Reviewed unit (node, proposition or card group). */
			nodeId: string;
			/** FSRS retrievability at review time, in [0, 1]. */
			R: number;
			focusedMin: number;
			/** Number of flashcards in this review (card cap applies); omitted = node review. */
			cards?: number;
			origin?: ReviewOrigin;
			/** Desired retention the schedule targeted (default RULES.desiredRetention). */
			desiredRetention?: number;
	  }
	| {
			kind: "diagnostic";
			items: number;
			/** Measured active minutes; omitted = items × RULES.diagnosticMinPerItem. */
			focusedMin?: number;
	  };

export type ProgressEvent = ProgressEventEnvelope & ProgressEventBody;

export type ProgressEventKind = ProgressEventBody["kind"];

/** One granted credit. Append-only; the stored `capped` value is final (grandfathered). */
export interface XpLedgerEntry {
	/** Deterministic row id: `xp:<eventId>`. */
	id: string;
	eventId: string;
	at: string;
	domainId: DomainId;
	/** XP before the daily soft cap (minutes × multiplier). */
	raw: number;
	/** XP actually granted. 0 ≤ capped ≤ raw. */
	capped: number;
	rulesVersion: RulesVersion;
	/** Short pt-BR explanation shown to the learner (uses the APPLIED value). */
	reason: string;
	// ── additions to the SÍNTESE §2.3 row (needed for the soft cap / audit) ──
	kind: ProgressEventKind;
	/** Study-day key (YYYY-MM-DD) the soft cap was accounted in. */
	day: string;
	/** Credited minutes (after the per-kind time caps), counted toward the daily soft cap. */
	minutes: number;
	/** mDif · gReview · check/hint/guess factors. */
	multiplier: number;
}

/** Credited minutes and multiplier for one event, before the soft cap. */
export interface XpCredit {
	minutes: number;
	multiplier: number;
	/** pt-BR label of the rule that applied. */
	label: string;
}

/** XP_total(L) = a · L^p (levels ≥ 2; level 1 starts at 0 XP). */
export interface LevelCurve {
	a: number;
	p: number;
}

export interface LevelProgress {
	level: number;
	xp: number;
	/** XP at which the current level started. */
	levelStartXp: number;
	/** XP at which the next level starts. */
	nextLevelXp: number;
	xpIntoLevel: number;
	xpToNext: number;
	/** 0..1 progress inside the current level. */
	fraction: number;
}

// ─── tiers ──────────────────────────────────────────────────────────────────

export type TierId = "bronze" | "silver" | "gold" | "platinum" | "diamond" | "master" | "doctor";

/** 0 = Novato (no tier yet), 1 = Bronze … 7 = Doutor. */
export type TierIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** III → II → I inside a tier (I is closest to the next tier). */
export type TierDivision = "III" | "II" | "I";

/** One of the seven domain tiers; tier k certifies stage k of the canonical core. */
export interface Tier {
	index: Exclude<TierIndex, 0>;
	id: TierId;
	/** pt-BR display name: Bronze, Prata, Ouro, Platina, Diamante, Mestre, Doutor. */
	label: string;
	/** Core stage (1..7) this tier certifies. */
	stage: number;
}

/** Frozen canonical core of a domain: one id list per stage 1..7 (r7 §4.2). */
export interface TierCore {
	/** Changes only through an explicit, versioned "core review". */
	coreVersion: string;
	stages: readonly (readonly string[])[];
}

/** nodeId → current FSRS retrievability, for ATTAINED nodes only (absent = not learned). */
export type RetentionSnapshot = ReadonlyMap<string, number>;

export interface TierStanding {
	tier: TierIndex;
	tierId: TierId | null;
	/** pt-BR label, e.g. "Ouro II" or "Novato". */
	label: string;
	division: TierDivision | null;
	/** Mastery points, 0..28. */
	pm: number;
	/** Retained fraction of each stage's core (index 0 = stage 1). */
	fractions: number[];
	/** Health of retention: retained / learned over the whole core (1 when nothing learned). */
	form: number;
	/** PM needed for the next tier (null at Doutor). */
	nextThreshold: number | null;
	/** 0..1 progress from the current tier threshold to the next. */
	progressToNext: number;
}

// ─── region badges ──────────────────────────────────────────────────────────

export type RegionBadgeLevel = "none" | "explored" | "familiar" | "proficient" | "mastered";

export interface RegionNodeSignal {
	nodeId: string;
	/** Node weight w_n inside the region (default 1). */
	weight?: number;
	/** Learner model `attainedAt` is set (monotonic). */
	attained: boolean;
	/** Current FSRS retrievability; undefined = no memory state yet (counts as not retained). */
	R?: number;
}

export interface RegionSignals {
	regionId: string;
	nodes: readonly RegionNodeSignal[];
	/** Region "boss" (5–8 integrative items, spaced ≥ 7 days after the last new node) passed. */
	bossPassed: boolean;
}

export interface RegionBadgeState {
	regionId: string;
	/** Level the signals support right now. */
	current: RegionBadgeLevel;
	/** Highest level ever reached — the badge shown (never taken away). */
	peak: RegionBadgeLevel;
	/** Peak ≥ Proficiente but the retained fraction fell below 70 %: "Enferrujada" overlay + "Restaurar". */
	rusty: boolean;
	learnedFraction: number;
	retainedFraction: number;
	/** pt-BR label of the displayed badge, e.g. "Dominada · Enferrujada". */
	label: string;
}

// ─── streak ─────────────────────────────────────────────────────────────────

export interface StreakConfig {
	/** Valid days required per week, 3..7 (default 5). */
	weeklyTarget: number;
	/** Active minutes that make a day valid (default 10). */
	validDayMinutes: number;
	/** Freezes that can be held at once (default 2). */
	maxFreezes: number;
	/** Completed weeks that earn one freeze (default 2). */
	weeksPerFreeze: number;
	/** Days after a missed week in which a repair session restores the streak (2 = 48 h). */
	repairWindowDays: number;
	/** A repair session needs this × validDayMinutes in one day (default 2). */
	repairMinutesMultiplier: number;
	/** Travel-mode days honoured per calendar year (default 14). */
	travelDaysPerYear: number;
}

export interface DayActivity {
	/** Study-day key YYYY-MM-DD (local study day, see xp.ts `studyDay`). */
	day: string;
	activeMinutes: number;
	/** The due-review queue reached zero that day. */
	reviewQueueCleared?: boolean;
	/** Learner marked this day as travel (pauses the streak). */
	travel?: boolean;
}

export type WeekOutcome = "completed" | "frozen" | "repaired" | "paused" | "broken";

export interface WeekRecord {
	/** Monday of the week (YYYY-MM-DD). */
	weekStart: string;
	target: number;
	validDays: number;
	travelDays: number;
	outcome: WeekOutcome;
}

export interface StreakRepairOffer {
	/** Streak that will be restored. */
	lostStreak: number;
	/** Last study day (inclusive) on which the repair session counts. */
	lastDay: string;
	/** Minutes the repair session needs in a single day. */
	minutesNeeded: number;
}

export interface StreakState {
	asOf: string;
	weeklyTarget: number;
	/** Monday of the current week. */
	weekStart: string;
	currentWeekValidDays: number;
	/** Days left in the current week after `asOf` (0 on Sunday). */
	daysLeftInWeek: number;
	/** The current week can still reach the target. */
	targetReachable: boolean;
	/** Consecutive completed (or frozen/repaired/paused-through) weeks. */
	weeksStreak: number;
	bestWeeksStreak: number;
	freezes: number;
	/** Completed weeks accumulated toward the next freeze. */
	weeksTowardFreeze: number;
	/** Informative only: consecutive valid days ending today (or yesterday if today is not valid yet). */
	dayRun: number;
	travelDaysLeft: number;
	/** Pending repair offer (no guilt copy; just a button). */
	repair: StreakRepairOffer | null;
	/** Closed weeks, oldest first. */
	history: WeekRecord[];
}

// ─── standing ───────────────────────────────────────────────────────────────

/** Everything the UI shows for a domain, derived (never stored except the two peaks). */
export interface Standing {
	domainId: DomainId;
	rulesVersion: RulesVersion;
	xp: number;
	level: LevelProgress;
	/** Highest level ever shown (a level-curve recalibration never lowers it). */
	levelPeak: number;
	tier: TierStanding;
	/** Highest tier ever reached — the title shown (never demoted, r7 P8). */
	tierPeak: TierIndex;
	/** pt-BR label of the peak tier (e.g. "Ouro"). */
	tierPeakLabel: string;
}
