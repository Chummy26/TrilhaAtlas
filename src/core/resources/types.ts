/**
 * Resource contracts: YouTube videos, open books, protected-book metadata and
 * the learner's own files attached to curriculum nodes
 * (docs/research/00-SINTESE.md §2.3 "src/core/resources/types.ts", §2.8;
 * r6-videos-livros.md §11).
 *
 * The SÍNTESE §2.3 names are canonical (Resource, ResourceKind, TosClass,
 * CoverageLink, ResourceProvider); every other field here is OPTIONAL and
 * comes from r6 §11.1 so that providers can carry what they know without
 * forcing the others to invent it.
 *
 * Legal model (SÍNTESE §2.8, r6 §9.1) — every Resource says how we may use it:
 *   tos = official_api   metadata from an official API under its developer
 *                        terms (YouTube Data API: ≤30 days storage, no derived
 *                        metrics; content is only ever embedded).
 *       = embed_only     viewable only through the publisher's embed/link
 *                        (a video known by id without API data).
 *       = open_license   open content (CC/PD) fetched from the OFFICIAL source;
 *                        NC licenses are fetched at runtime, never bundled.
 *       = user_owned     a file the learner imported; stays local.
 *       = metadata_only  protected work: title/ISBN/TOC only (Open Library,
 *                        Crossref, arXiv abstracts link-out).
 *       = opt_in_gray    unofficial client (InnerTube via youtubei.js), only
 *                        after explicit opt-in.
 *
 * Additions beyond §2.3 (documented per the engineering rules): ResourceKind
 * gains "book" (a whole book from a catalog; its sections come from toc());
 * Resource gains optional `audioTracks` (precise dubbing info — §2.3 folds
 * auto-dub into `captions[].kind = "auto-dub"`, which is kept and honored),
 * `titleLang` (title-language hint, kept apart from the spoken `lang`),
 * `downloads` (official PDF/EPUB links of open books) and `subjects`.
 *
 * Pure types: browser-safe (no node imports).
 */

import type { DomainId } from "../domains/types.ts";

/** Known providers; open string for future adapters. */
export type ProviderId =
	| "youtube-data"
	| "youtube-enriched"
	| "openstax"
	| "libretexts"
	| "otl"
	| "openlibrary"
	| "crossref"
	| "arxiv"
	| "wikibooks"
	| "kuphaldt"
	| "user-library"
	| "ai"
	| (string & {});

export type ResourceKind = "video" | "book" | "book_section" | "article" | "ai_lesson";

export type TosClass = "official_api" | "embed_only" | "open_license" | "user_owned" | "metadata_only" | "opt_in_gray";

/** What the app may do with the content itself. */
export type ResourceAccess =
	/** Open content: may be fetched from the official source and shown with attribution. */
	| "open"
	/** Only metadata (title, ISBN, TOC); the text never enters the app. */
	| "metadata_only"
	/** Learner's own file, local only, never redistributed. */
	| "user_owned"
	/** Watch through the official embed only (YouTube). */
	| "stream_only"
	/** Controlled digital lending: an outbound link, never a download. */
	| "borrow_link";

export interface License {
	/** Human name, e.g. "CC BY-NC-SA 4.0", "Licença padrão do YouTube". */
	name: string;
	spdx?: string;
	url?: string;
	/** Attribution line to display next to the content. */
	attribution?: string;
	nonCommercial?: boolean;
	shareAlike?: boolean;
	noDerivs?: boolean;
	publicDomain?: boolean;
	/** All rights reserved (protected work). */
	proprietary?: boolean;
}

/** Where a resource lives (stable address used by resolve/content). */
export type Locator =
	| { kind: "youtube"; videoId: string }
	| { kind: "url"; href: string }
	| { kind: "library"; sha256: string; format: "pdf" | "epub" }
	| { kind: "isbn"; isbn: string; href?: string }
	| { kind: "doi"; doi: string }
	| { kind: "arxiv"; arxivId: string };

/** A part of a resource: time range (video), page range or TOC section (book). */
export interface Span {
	startSec?: number;
	endSec?: number;
	/** Physical page range "12-18" (1-based, inclusive) or a single page "12". */
	pages?: string;
	/** TocEntry.id inside the resource. */
	sectionId?: string;
}

export type CaptionKind = "manual" | "asr" | "auto-dub";

export interface CaptionInfo {
	/** BCP-47 tag as reported ("pt-BR", "en"). */
	lang: string;
	/** manual = human captions; asr = speech recognition; auto-dub = an AI-dubbed audio track exists in `lang` (§2.3). */
	kind: CaptionKind;
	translatable?: boolean;
}

export type AudioTrackKind = "original" | "dubbed" | "dubbed-auto" | "descriptive" | "secondary" | "unknown";

export interface AudioTrackInfo {
	lang: string;
	kind: AudioTrackKind;
	isDefault: boolean;
	displayName?: string;
}

export interface ResourceDownload {
	format: "pdf" | "epub" | "zip" | "html";
	href: string;
}

export interface Resource {
	/** Stable id: `<provider-prefix>:<external id>` (e.g. "yt:dQw4w9WgXcQ", "openstax:<uuid>"). */
	id: string;
	provider: ProviderId;
	kind: ResourceKind;
	title: string;
	/** BCP-47 of the main content (spoken audio for videos, text for books). "und" when unknown. */
	lang: string;
	/** Default/original spoken audio language (videos). */
	audioLang?: string;
	/**
	 * Language of the title/metadata only (Data API `snippet.defaultLanguage`).
	 * A WEAK hint, never proof of the spoken language: dub-tolerant domains
	 * may use it when the audio language is unknown; original-audio domains
	 * (English) never do.
	 */
	titleLang?: string;
	captions?: CaptionInfo[];
	/** Known audio tracks (enriched mode). Absent = unknown. */
	audioTracks?: AudioTrackInfo[];
	/** YouTube Data API `contentDetails.caption`: human captions exist, languages unknown. */
	hasManualCaptions?: boolean;
	durationSec?: number;
	license: License;
	access: ResourceAccess;
	tos: TosClass;
	locator: Locator;
	channelId?: string;
	channelTitle?: string;
	creators?: string[];
	/** Human page to open (official landing, abstract page, watch page). */
	url?: string;
	description?: string;
	/** Estimated level 0–5 (r3 Level scale), when known. */
	level?: number;
	/** For book sections: the book resource id. */
	parentId?: string;
	/** For book sections: the TocEntry id. */
	sectionId?: string;
	isbn?: string[];
	doi?: string;
	pages?: number;
	year?: number;
	embeddable?: boolean;
	/** Official download links of open content (imported into the library on demand). */
	downloads?: ResourceDownload[];
	/** Catalog subject/area labels ("Electrical Engineering", "Languages"). */
	subjects?: string[];
	fetchedAt: string;
	/** Storage limit (YouTube API data: 30). Refresh or drop after fetchedAt + ttlDays. */
	ttlDays?: number;
}

/** Edge `covered_by` between a curriculum node and (a span of) a resource. */
export interface CoverageLink {
	resourceId: string;
	nodeId: string;
	span?: { startSec?: number; endSec?: number; pages?: string; sectionId?: string };
	/** Coverage × confidence in [0,1]. */
	score: number;
	method: "embed+bm25+rrf+llm" | "toc" | "manual";
	/** Not yet confirmed (LLM-proposed / heuristic). */
	provisional: boolean;
	domainId?: DomainId;
	role?: "primary" | "supplement" | "reference" | "exercise";
	depth?: "intro" | "core" | "advanced";
	objectivesCovered?: number[];
	/** ≤25 words, paraphrased. */
	evidence?: string;
	model?: string;
	promptVersion?: string;
	status?: "proposed" | "accepted" | "rejected";
	createdAt?: string;
}

/** One table-of-contents entry, flat pre-order list (parentId links the tree). */
export interface TocEntry {
	id: string;
	title: string;
	/** 0 = top level. */
	depth: number;
	parentId: string | null;
	/** Pre-order position (0-based). */
	order: number;
	/** Physical pages, 1-based inclusive. */
	pageFrom?: number;
	pageTo?: number;
	/** Printed page label of pageFrom ("xii", "37"). */
	pageLabel?: string;
	/** Section address inside the source (EPUB href, OpenStax page uuid, chapter URL). */
	href?: string;
}

export type TocSource =
	| "pdf-outline"
	| "epub-nav"
	| "epub-ncx"
	| "openstax-archive"
	| "crossref"
	| "openlibrary"
	| "html-index"
	| "page-window"
	| "spine";

export interface ContentChunk {
	id: string;
	resourceId: string;
	sectionId?: string;
	breadcrumb: string[];
	text: string;
	/** Estimated tokens (≈ chars/4). */
	tokens: number;
	span?: Span;
	contextHeader?: string;
}

/** Search request built from a curriculum node (r6 §11.1). */
export interface ResourceQuery {
	domainId: DomainId;
	nodeId?: string;
	text: { pt?: string; en?: string };
	aliases?: string[];
	/** Node level on the 0–5 scale. */
	level?: number;
	kinds?: ResourceKind[];
	/** Content languages in preference order (primary tags). */
	langs?: string[];
	/** YouTube `videoDuration` bucket: short < 4 min, medium 4–20, long > 20. */
	videoDuration?: "any" | "short" | "medium" | "long";
	/** Only videos with human captions (`videoCaption=closedCaption`). */
	captionsRequired?: boolean;
	/** Search inside these curated channels first. */
	channelIds?: string[];
	maxResults: number;
	signal?: AbortSignal;
}

export interface RateSpec {
	/** Minimum spacing between requests (OL 1000, arXiv 3000, Crossref 1000). */
	minIntervalMs: number;
	/** Daily budget for metered APIs (YouTube search bucket). */
	dailyBudget?: { bucket: string; calls: number };
}

/** Honest provider status: unavailable providers say why (pt-BR, user-visible). */
export interface ProviderStatus {
	available: boolean;
	reason: string;
	/** Remaining calls in the scarcest daily bucket, when metered. */
	budgetLeft?: number;
	/** Requires an explicit user opt-in before use. */
	optIn?: boolean;
}

export interface ResourceProvider {
	id: ProviderId;
	/** pt-BR label for settings/status. */
	label: string;
	tos: TosClass;
	kinds: ResourceKind[];
	rate: RateSpec;
	status(): Promise<ProviderStatus>;
	search(q: ResourceQuery): Promise<Resource[]>;
	resolve(id: string): Promise<Resource>;
	toc?(id: string): Promise<TocEntry[]>;
	content?(id: string, span?: Span): Promise<ContentChunk[]>;
}

/** Raised by providers/registry with a user-presentable (pt-BR) message. */
export class ResourceError extends Error {
	readonly provider: ProviderId;
	readonly code: "unavailable" | "not-found" | "quota" | "blocked" | "bad-response" | "invalid-input" | "too-large";
	constructor(provider: ProviderId, code: ResourceError["code"], message: string) {
		super(message);
		this.name = "ResourceError";
		this.provider = provider;
		this.code = code;
	}
}

/** Learner-facing slots of a node playlist (SÍNTESE §2.8, r6 §7.5). */
export type PlaylistSlot = "ai-explanation" | "intuition-video" | "primary-reading" | "deep-dive";
