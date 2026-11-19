/**
 * Language fit `lang ∈ [0,1]` of a resource for a domain
 * (SÍNTESE §2.8 "Ajuste de idioma", §1.2 P15; r6 §4.3, §5.3, §7.4).
 *
 * Driven by the domain's `DomainResourcePolicy` (src/core/domains/types.ts).
 *
 * Dub-tolerant policy (no `requireOriginalAudio` — Electronics):
 *   audio in lessonLang (PT original)                      1,00
 *   foreign audio + human dub in lessonLang                0,85
 *   foreign audio + manual caption in lessonLang           0,85
 *   foreign audio + AUTO dub in lessonLang                 0,75   (only if allowAutoDub)
 *   foreign audio + manual caption in the original lang    0,65   (0,85 when English ≥ B2: CLIL)
 *   foreign audio with ASR captions only                   0,50
 *   audio outside videoAudioLangs                          0,05   (or a dub value, if higher)
 *   A caption is usable when its language is in `captionLangs`, OR when the
 *   lesson language is in `captionLangs` and the caption can be translated
 *   into it (the official player auto-translates captions and the synced
 *   transcript panel shows our own translation below the player — r6 §4.3
 *   item 3). Decision: this is how "EN com legenda PT" is honoured in the
 *   default (Data API) mode, where caption languages are unknown; the r6 §7.4
 *   values above are kept as the numbers.
 *
 * Original-audio policy (`requireOriginalAudio: "en"` — English; dubbing
 * excluded, P15 "Inglês começa por input"):
 *   by learner CEFR band            A1–A2   B1–B2   C1+
 *   EN original + manual EN caption  0,60    1,00    1,00
 *   EN original + manual PT caption  0,70    0,40    0,20
 *   EN original, ASR only            0,30    0,80    1,00
 *   PT original (explanation only)   0,80    0,30    0,05
 *   anything dubbed / other audio    0
 *   With purpose "input" (the default) a PT-audio video scores 0; purpose
 *   "explanation" (a PT-BR teacher explaining grammar) uses the PT row.
 *   EN-original videos that ALSO carry a lesson-language dub track get ×0,9:
 *   the embedded player may pick the dub (r6 §5.3 mitigation).
 *
 * Unknowns (documented decisions):
 *   - captions unknown (Data API mode: `captions` absent) → the original
 *     language is assumed to have ASR captions (YouTube auto-captions EN/PT);
 *     `hasManualCaptions` (Data API `contentDetails.caption`) is read as a
 *     manual caption in the original audio language;
 *   - unknown audio language ("und") → 0 under requireOriginalAudio (cannot
 *     prove original EN audio), 0,3 otherwise (neither excluded nor favoured);
 *     audio tracks tagged "und" never decide the original language (they fall
 *     through to `audioLang`/`lang`); the title language (`titleLang`, Data
 *     API `defaultLanguage`) is a fallback hint for dub-tolerant domains
 *     ONLY — under requireOriginalAudio it never counts as original audio;
 *   - "≥ B2" covers B2, B2+ and C*, matching cefrBand's prefix reading;
 *   - unknown CEFR → band A (conservative: favours captions);
 *   - text resources (books/articles) = "original audio = text language with
 *     a manual caption in it"; AI lessons are generated in lessonLang: 1,0.
 *
 * Pure: browser-safe.
 */

import type { DomainResourcePolicy } from "../domains/types.ts";
import type { Resource } from "./types.ts";

export type LangPurpose = "input" | "explanation";

export interface LangFitContext {
	/** Learner's English CEFR level ("A2", "B1"…), from the English domain snapshot. */
	englishCefr?: string;
	/** Why the resource is used; defaults to "input" under requireOriginalAudio. */
	purpose?: LangPurpose;
}

export type CefrBand = "A" | "B" | "C";

/** Primary language subtag, lowercase ("pt-BR" → "pt"). */
export function primaryLang(tag: string | undefined | null): string {
	return (tag ?? "").trim().toLowerCase().split(/[-_]/)[0] ?? "";
}

export function cefrBand(cefr: string | undefined): CefrBand {
	const c = (cefr ?? "").trim().toUpperCase();
	if (c.startsWith("C")) return "C";
	if (c.startsWith("B")) return "B";
	return "A";
}

function atLeastB2(cefr: string | undefined): boolean {
	const c = (cefr ?? "").trim().toUpperCase();
	return c.startsWith("B2") || c.startsWith("C");
}

/** A primary tag that names a language ("und"/empty = unknown). */
function isKnownLang(primary: string): boolean {
	return primary !== "" && primary !== "und";
}

/** First argument whose primary tag is a known language, else "". */
function firstKnownLang(...tags: Array<string | undefined>): string {
	for (const t of tags) {
		const p = primaryLang(t);
		if (isKnownLang(p)) return p;
	}
	return "";
}

/** What a resource offers, by primary language. */
export interface LanguageOffer {
	original: string;
	manualCaptions: Set<string>;
	asrCaptions: Set<string>;
	humanDubs: Set<string>;
	autoDubs: Set<string>;
	/** Caption information is known (enriched mode or a text resource). */
	captionsKnown: boolean;
	/** Some caption can be machine-translated (unknown → assumed true for captioned videos). */
	translatable: boolean;
}

/**
 * Summarize audio/caption availability of a video resource. The original
 * language is the first KNOWN one among: the original audio track, the
 * default non-dubbed track, `audioLang`, `lang` and — only with
 * `allowTitleHint` — `titleLang`. Tracks tagged "und" are skipped: InnerTube
 * leaves single-track videos without a language tag, and such a track says
 * nothing about the spoken language. "" when nothing is known.
 */
export function languageOffer(r: Resource, options: { allowTitleHint?: boolean } = {}): LanguageOffer {
	const known = (t: { lang: string }) => isKnownLang(primaryLang(t.lang));
	const originalTrack =
		r.audioTracks?.find((t) => t.kind === "original" && known(t)) ??
		r.audioTracks?.find((t) => t.isDefault && t.kind !== "dubbed" && t.kind !== "dubbed-auto" && known(t));
	const original = firstKnownLang(originalTrack?.lang, r.audioLang, r.lang, options.allowTitleHint ? r.titleLang : undefined);
	const offer: LanguageOffer = {
		original,
		manualCaptions: new Set(),
		asrCaptions: new Set(),
		humanDubs: new Set(),
		autoDubs: new Set(),
		captionsKnown: r.captions !== undefined,
		translatable: true,
	};
	let anyTranslatable = false;
	let anyTranslatableInfo = false;
	for (const c of r.captions ?? []) {
		const l = primaryLang(c.lang);
		if (!l) continue;
		if (c.kind === "manual") offer.manualCaptions.add(l);
		else if (c.kind === "asr") offer.asrCaptions.add(l);
		else if (c.kind === "auto-dub") offer.autoDubs.add(l);
		if (c.kind !== "auto-dub" && c.translatable !== undefined) {
			anyTranslatableInfo = true;
			anyTranslatable ||= c.translatable;
		}
	}
	if (anyTranslatableInfo) offer.translatable = anyTranslatable;
	for (const t of r.audioTracks ?? []) {
		const l = primaryLang(t.lang);
		if (!l || l === original) continue;
		if (t.kind === "dubbed-auto") offer.autoDubs.add(l);
		else if (t.kind === "dubbed") offer.humanDubs.add(l);
	}
	if (r.hasManualCaptions && original) offer.manualCaptions.add(original);
	if (!offer.captionsKnown && original) offer.asrCaptions.add(original);
	return offer;
}

function textOffer(r: Resource): LanguageOffer {
	const l = primaryLang(r.lang);
	return {
		original: l,
		manualCaptions: new Set(l ? [l] : []),
		asrCaptions: new Set(),
		humanDubs: new Set(),
		autoDubs: new Set(),
		captionsKnown: true,
		translatable: false,
	};
}

type EnglishRow = "manualTarget" | "manualLesson" | "asrOnly" | "lessonAudio";

export const ENGLISH_LANG_TABLE: Readonly<Record<EnglishRow, Readonly<Record<CefrBand, number>>>> = Object.freeze({
	manualTarget: Object.freeze({ A: 0.6, B: 1, C: 1 }),
	manualLesson: Object.freeze({ A: 0.7, B: 0.4, C: 0.2 }),
	asrOnly: Object.freeze({ A: 0.3, B: 0.8, C: 1 }),
	lessonAudio: Object.freeze({ A: 0.8, B: 0.3, C: 0.05 }),
});

/** Values of the dub-tolerant table (r6 §7.4, Electronics column). */
export const LESSON_LANG_VALUES = Object.freeze({
	lessonAudio: 1,
	humanDub: 0.85,
	manualLessonCaption: 0.85,
	autoDub: 0.75,
	manualOriginalCaption: 0.65,
	manualOriginalCaptionB2: 0.85,
	asrOnly: 0.5,
	otherLanguage: 0.05,
	unknownLanguage: 0.3,
});

/** Fit for an original-audio-required domain (English). */
function requiredOriginalFit(offer: LanguageOffer, policy: DomainResourcePolicy, ctx: LangFitContext): number {
	const required = primaryLang(policy.requireOriginalAudio);
	const lesson = primaryLang(policy.lessonLang);
	const band = cefrBand(ctx.englishCefr);
	const purpose = ctx.purpose ?? "input";
	if (offer.original === required) {
		const captionLangs = new Set(policy.captionLangs.map(primaryLang));
		let fit = ENGLISH_LANG_TABLE.asrOnly[band];
		if (offer.manualCaptions.has(required) && captionLangs.has(required)) fit = Math.max(fit, ENGLISH_LANG_TABLE.manualTarget[band]);
		if (offer.manualCaptions.has(lesson) && captionLangs.has(lesson)) fit = Math.max(fit, ENGLISH_LANG_TABLE.manualLesson[band]);
		if (offer.autoDubs.has(lesson) || offer.humanDubs.has(lesson)) fit *= 0.9;
		return fit;
	}
	if (offer.original === lesson && purpose === "explanation") return ENGLISH_LANG_TABLE.lessonAudio[band];
	return 0;
}

/** Fit for a dub-tolerant domain (Electronics). */
function lessonLanguageFit(offer: LanguageOffer, policy: DomainResourcePolicy, ctx: LangFitContext): number {
	const v = LESSON_LANG_VALUES;
	const lesson = primaryLang(policy.lessonLang);
	if (offer.original === lesson) return v.lessonAudio;
	const captionLangs = new Set(policy.captionLangs.map(primaryLang));
	const accepted = new Set(policy.videoAudioLangs.map(primaryLang));
	/** A caption in `lang` can be shown: directly, or translated into the lesson language. */
	const usable = (lang: string, manual: boolean) => captionLangs.has(lang) || (captionLangs.has(lesson) && (manual || offer.translatable));
	const candidates: number[] = [];
	if (offer.humanDubs.has(lesson)) candidates.push(v.humanDub);
	if (offer.autoDubs.has(lesson) && policy.allowAutoDub) candidates.push(v.autoDub);
	if (accepted.has(offer.original)) {
		if (offer.manualCaptions.has(lesson) && captionLangs.has(lesson)) candidates.push(v.manualLessonCaption);
		if (offer.manualCaptions.has(offer.original) && usable(offer.original, true)) {
			candidates.push(atLeastB2(ctx.englishCefr) && offer.original === "en" ? v.manualOriginalCaptionB2 : v.manualOriginalCaption);
		}
		if (offer.asrCaptions.has(offer.original) && usable(offer.original, false)) candidates.push(v.asrOnly);
	} else {
		candidates.push(v.otherLanguage);
	}
	return candidates.length ? Math.max(...candidates) : 0;
}

/** `lang` component of the score for one resource under a domain policy. */
export function languageFit(resource: Resource, policy: DomainResourcePolicy, ctx: LangFitContext = {}): number {
	if (resource.kind === "ai_lesson") return 1;
	// The title language is never evidence of ORIGINAL audio (English, P15).
	const offer = resource.kind === "video" ? languageOffer(resource, { allowTitleHint: !policy.requireOriginalAudio }) : textOffer(resource);
	if (!isKnownLang(offer.original)) {
		return policy.requireOriginalAudio ? 0 : LESSON_LANG_VALUES.unknownLanguage;
	}
	return policy.requireOriginalAudio ? requiredOriginalFit(offer, policy, ctx) : lessonLanguageFit(offer, policy, ctx);
}

/** True when the domain requires original audio (dubbing excluded). */
export function excludesDubbing(policy: DomainResourcePolicy): boolean {
	return Boolean(policy.requireOriginalAudio) || !policy.allowAutoDub;
}

/** Policy presets matching SÍNTESE §2.8 (manifests in src/core/domains/defaults.ts are canonical). */
export const ELECTRONICS_RESOURCE_POLICY: Readonly<DomainResourcePolicy> = Object.freeze({
	videoAudioLangs: ["pt", "en"],
	captionLangs: ["pt"],
	allowAutoDub: true,
	lessonLang: "pt-BR",
	videoMinutes: { lo: 6, hi: 12 },
});

export const ENGLISH_RESOURCE_POLICY: Readonly<DomainResourcePolicy> = Object.freeze({
	videoAudioLangs: ["en"],
	captionLangs: ["en", "pt"],
	allowAutoDub: false,
	requireOriginalAudio: "en",
	lessonLang: "pt-BR",
	videoMinutes: { lo: 5, hi: 15 },
});
