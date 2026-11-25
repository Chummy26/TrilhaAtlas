/**
 * Server-side persistence, auto-discovery, manifest/status normalization,
 * transcript cache, and secure media resolution for TrilhaAtlas INTENSIVA.
 *
 * All mutable runtime records are strictly anchored under `<PATHS.data>/intensive/`
 * (respecting LH_DATA_DIR isolation for desktop profiles and temporary tests).
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";
import {
	DEFAULT_INTENSIVE_TRACK_ID,
	getIntensiveTrack,
	listIntensiveTracks,
} from "../core/intensive/catalog-template.ts";
import {
	createDefaultCertificationState,
	createDefaultCourseState,
	createDefaultIntensiveState,
	createDefaultPortfolioState,
	getDefaultPacingSettings,
} from "../core/intensive/progress.ts";
import type {
	CertificationProgressState,
	CourseMaterialDoc,
	CourseMaterialSummary,
	CourseMediaBundle,
	CourseMediaSource,
	CourseProgressState,
	CourseTranscriptionStatus,
	IntensiveState,
	IntensiveTrackSpec,
	LessonTranscriptDoc,
	MaterialCategory,
	MaterialTextChunk,
	MediaLessonSummary,
	MediaTranscriptStatus,
	PacingMode,
	PortfolioProgressState,
	TranscriptChunk,
	TranscriptSegment,
	TranscriptionJobState,
} from "../core/intensive/types.ts";
import { writeFileAtomicSync } from "./atomic-write.ts";

const SAFE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,160}$/;

export const VIDEO_EXTENSIONS = new Set([".mp4", ".mkv", ".webm", ".mov", ".m4v"]);
export const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const VIDEO_CONTENT_TYPES: Record<string, string> = {
	".mp4": "video/mp4",
	".m4v": "video/mp4",
	".webm": "video/webm",
	".mov": "video/quicktime",
	".mkv": "video/x-matroska",
};

const IMAGE_CONTENT_TYPES: Record<string, string> = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".webp": "image/webp",
};

const MIN_COMPLETE_VIDEO_BYTES = 10 * 1024;

// Mirrors scripts/intensive-transcribe.py naming & natural-sort rules exactly.
const LEADING_NUMBER_RE = /^\s*(\d+)(?:[\s._\-)]|$)/;
const LESSON_PREFIX_NUMBER_RE =
	/^\s*(?:aula|lesson|class|epis[oó]dio|ep|cap[ií]tulo|cap|m[oó]dulo|mod|parte|pt|v[ií]deo|vid|lecture|lec|bloco|unit|unidade)[\s._#\-]*(\d+)(?=\D|$)/i;
const NATURAL_SPLIT_RE = /(\d+)/;
const TRAILING_BRACKET_ID_RE = /\s*\[[A-Za-z0-9_-]{6,15}\]\s*$/;
const TRAILING_UNDERSCORE_TOKEN_RE = /_([A-Za-z0-9-]{6,15})$/;
const REDUNDANT_LEADING_INDEX_RE =
	/^(\d+)[\s._-]+((?:aula|lesson|epis[oó]dio|cap[ií]tulo|m[oó]dulo|parte)\s+(\d+)\b.*)$/i;
const LESSON_DASH_RE =
	/^((?:aula|lesson|epis[oó]dio|cap[ií]tulo|m[oó]dulo|parte)\s+\d+)\s+(?![\-\u2013\u2014:])(.+)$/i;

export interface InternalMediaLessonRecord {
	summary: MediaLessonSummary;
	relativePath?: string;
	filePath?: string;
	thumbnailPath?: string;
}

export interface CourseMediaIndex {
	courseId: string;
	source: CourseMediaSource | null;
	status: CourseTranscriptionStatus | null;
	lessons: MediaLessonSummary[];
	recordsById: Map<string, InternalMediaLessonRecord>;
}

export interface ResolvedMediaFile {
	absPath: string;
	contentType: string;
	size: number;
	fileName: string;
}

// ─── Bounded In-Memory Transcript Cache ──────────────────────────────────────

interface TranscriptCacheEntry {
	stamp: string;
	doc: LessonTranscriptDoc;
}

const TRANSCRIPT_CACHE_KEY = Symbol.for("learnharness.store.intensiveTranscriptCache");
const MAX_TRANSCRIPT_CACHE_ENTRIES = 600;

function transcriptCache(): Map<string, TranscriptCacheEntry> {
	const g = globalThis as typeof globalThis & {
		[TRANSCRIPT_CACHE_KEY]?: Map<string, TranscriptCacheEntry>;
	};
	return (g[TRANSCRIPT_CACHE_KEY] ??= new Map());
}

// ─── Path & Security Helpers ─────────────────────────────────────────────────

export function isSafeIntensiveId(id: string): boolean {
	return typeof id === "string" && SAFE_ID_RE.test(id) && !id.includes("..");
}

export function assertSafeIntensiveId(id: string, label = "id"): string {
	if (!isSafeIntensiveId(id)) {
		throw new Error(`Invalid ${label}: ${id}`);
	}
	return id;
}

export function intensiveRootDir(): string {
	return path.join(/* turbopackIgnore: true */ PATHS.data, "intensive");
}

export function intensiveStatePath(): string {
	return path.join(/* turbopackIgnore: true */ intensiveRootDir(), "state.json");
}

export function intensiveCustomTrackPath(): string {
	return path.join(/* turbopackIgnore: true */ intensiveRootDir(), "track.json");
}

interface CustomTrackCacheEntry {
	filePath: string;
	stamp: string;
	track: IntensiveTrackSpec | null;
}

const CUSTOM_TRACK_CACHE_KEY = Symbol.for("learnharness.store.intensiveCustomTrackCache");

function isValidCustomTrack(raw: unknown): raw is IntensiveTrackSpec {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
	const obj = raw as Record<string, unknown>;
	return (
		typeof obj.id === "string" &&
		obj.id.trim().length > 0 &&
		typeof obj.title === "string" &&
		obj.title.trim().length > 0 &&
		Array.isArray(obj.tiers) &&
		obj.tiers.length > 0 &&
		Array.isArray(obj.courses) &&
		obj.courses.length > 0 &&
		Array.isArray(obj.certifications) &&
		Array.isArray(obj.portfolioProjects) &&
		Boolean(obj.pacingProfiles && typeof obj.pacingProfiles === "object") &&
		Array.isArray(obj.pacingRules)
	);
}

/**
 * Loads an optional personal intensive track from `<PATHS.data>/intensive/track.json`.
 * Keeps personal roadmaps completely outside Git while seamlessly overriding the public template.
 */
export function readCustomIntensiveTrack(): IntensiveTrackSpec | null {
	const filePath = intensiveCustomTrackPath();
	let stat: fs.Stats;
	try {
		stat = fs.statSync(filePath);
		if (!stat.isFile()) return null;
	} catch {
		return null;
	}

	const stamp = `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
	const g = globalThis as typeof globalThis & {
		[CUSTOM_TRACK_CACHE_KEY]?: CustomTrackCacheEntry;
	};
	if (g[CUSTOM_TRACK_CACHE_KEY]?.filePath === filePath && g[CUSTOM_TRACK_CACHE_KEY]?.stamp === stamp) {
		return g[CUSTOM_TRACK_CACHE_KEY]!.track;
	}

	try {
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
		const track = isValidCustomTrack(parsed) ? parsed : null;
		g[CUSTOM_TRACK_CACHE_KEY] = { filePath, stamp, track };
		return track;
	} catch {
		g[CUSTOM_TRACK_CACHE_KEY] = { filePath, stamp, track: null };
		return null;
	}
}

export function listEffectiveIntensiveTracks(): IntensiveTrackSpec[] {
	const custom = readCustomIntensiveTrack();
	const builtIn = listIntensiveTracks();
	if (!custom) return builtIn;
	return [custom, ...builtIn.filter((t) => t.id !== custom.id)];
}

export function resolveEffectiveIntensiveTrack(trackId?: string): IntensiveTrackSpec | null {
	const custom = readCustomIntensiveTrack();
	const requested = trackId?.trim();
	if (!requested) {
		return custom ?? getIntensiveTrack(DEFAULT_INTENSIVE_TRACK_ID);
	}
	if (custom && custom.id === requested) return custom;
	return getIntensiveTrack(requested) ?? custom ?? getIntensiveTrack(DEFAULT_INTENSIVE_TRACK_ID);
}

export function intensiveSourcesPath(): string {
	return path.join(/* turbopackIgnore: true */ intensiveRootDir(), "sources.json");
}

export function intensiveMediaRootDir(): string {
	return path.join(/* turbopackIgnore: true */ intensiveRootDir(), "media");
}

export function intensiveCourseMediaDir(courseId: string): string {
	assertSafeIntensiveId(courseId, "courseId");
	return path.join(/* turbopackIgnore: true */ intensiveMediaRootDir(), courseId);
}

export function intensiveCourseTranscriptsDir(courseId: string): string {
	return path.join(/* turbopackIgnore: true */ intensiveCourseMediaDir(courseId), "transcripts");
}

export function intensiveMaterialsRootDir(): string {
	return path.join(/* turbopackIgnore: true */ intensiveRootDir(), "materials");
}

export function intensiveCourseMaterialsDir(courseId: string): string {
	assertSafeIntensiveId(courseId, "courseId");
	return path.join(/* turbopackIgnore: true */ intensiveMaterialsRootDir(), courseId);
}

export function intensiveCourseMaterialsFilesDir(courseId: string): string {
	return path.join(/* turbopackIgnore: true */ intensiveCourseMaterialsDir(courseId), "files");
}

export function intensiveCourseMaterialsExtractedDir(courseId: string): string {
	return path.join(/* turbopackIgnore: true */ intensiveCourseMaterialsDir(courseId), "extracted");
}

function normalizeForContainment(p: string): string {
	const resolved = path.resolve(/* turbopackIgnore: true */ p);
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * Verifies `candidatePath` stays strictly inside `rootDir`, including symlink
 * realpath containment when both paths exist on disk.
 */
export function isPathWithinDir(candidatePath: string, rootDir: string): boolean {
	const normRoot = normalizeForContainment(rootDir);
	const normCandidate = normalizeForContainment(candidatePath);
	const rootPrefix = normRoot.endsWith(path.sep) ? normRoot : `${normRoot}${path.sep}`;
	if (normCandidate !== normRoot && !normCandidate.startsWith(rootPrefix)) {
		return false;
	}

	try {
		const realRoot = normalizeForContainment(fs.realpathSync(/* turbopackIgnore: true */ rootDir));
		const realCandidate = normalizeForContainment(
			fs.realpathSync(/* turbopackIgnore: true */ candidatePath),
		);
		const realPrefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`;
		return realCandidate === realRoot || realCandidate.startsWith(realPrefix);
	} catch {
		// If realpath cannot run (e.g. virtual/uncreated path), lexical check already passed.
		return true;
	}
}

function stripBom(raw: string): string {
	return raw.replace(/^\uFEFF/, "");
}

function readJsonFileSync<T = Record<string, unknown>>(filePath: string): T | null {
	try {
		const raw = fs.readFileSync(/* turbopackIgnore: true */ filePath, "utf8");
		const parsed = JSON.parse(stripBom(raw)) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		return parsed as T;
	} catch {
		return null;
	}
}

function writeJsonAtomic(filePath: string, payload: unknown): void {
	const dir = path.dirname(filePath);
	fs.mkdirSync(/* turbopackIgnore: true */ dir, { recursive: true });
	writeFileAtomicSync(filePath, `${JSON.stringify(payload, null, "\t")}\n`, {
		allowInPlaceFallback: true,
	});
}

// ─── Parity with scripts/intensive-transcribe.py (Titles, IDs, Sorting) ─────

function stripAccents(text: string): string {
	return text.normalize("NFKD").replace(/\p{M}/gu, "");
}

function looksLikeVideoId(token: string): boolean {
	if (token.length < 6 || token.length > 15) return false;
	let hasUpper = false;
	let hasLower = false;
	let hasDigit = false;
	const letters: string[] = [];

	for (const ch of token) {
		if (ch >= "A" && ch <= "Z") {
			hasUpper = true;
			letters.push(ch);
		} else if (ch >= "a" && ch <= "z") {
			hasLower = true;
			letters.push(ch);
		} else if (ch >= "0" && ch <= "9") {
			hasDigit = true;
		}
	}

	if (!hasUpper || !hasLower) return false;

	let transitions = 0;
	for (let i = 0; i < letters.length - 1; i += 1) {
		const aUpper = letters[i]! >= "A" && letters[i]! <= "Z";
		const bUpper = letters[i + 1]! >= "A" && letters[i + 1]! <= "Z";
		if (aUpper !== bUpper) transitions += 1;
	}
	if (transitions >= 2) return true;
	if (hasDigit && token.length >= 8) return true;
	return false;
}

export function cleanHumanVideoTitle(fileName: string): string {
	const ext = path.extname(fileName);
	const originalStem = ext ? fileName.slice(0, -ext.length) : fileName;
	let stem = originalStem.replace(TRAILING_BRACKET_ID_RE, "");

	const trailingMatch = TRAILING_UNDERSCORE_TOKEN_RE.exec(stem);
	if (trailingMatch && trailingMatch[1] && looksLikeVideoId(trailingMatch[1])) {
		stem = stem.slice(0, trailingMatch.index);
	}

	let title = stem
		.replace(/_/g, " ")
		.replace(/\s+/g, " ")
		.replace(/^[ -.]+|[ -.]+$/g, "");

	const dupMatch = REDUNDANT_LEADING_INDEX_RE.exec(title);
	if (dupMatch && dupMatch[1] && dupMatch[2] && dupMatch[3]) {
		const n1 = Number.parseInt(dupMatch[1], 10);
		const n2 = Number.parseInt(dupMatch[3], 10);
		if (Number.isFinite(n1) && n1 === n2) {
			title = dupMatch[2].trim();
		}
	}

	const dashMatch = LESSON_DASH_RE.exec(title);
	if (dashMatch && dashMatch[1] && dashMatch[2]) {
		title = `${dashMatch[1]} - ${dashMatch[2]}`;
	}

	title = title.replace(/\s*-\s*/g, " - ").replace(/\s+/g, " ").trim();
	return title || originalStem;
}

/**
 * Deterministic URL-safe lessonId matching `scripts/intensive-transcribe.py`:
 * `<ascii-slug-max48>-<sha1(relativePosixPath)[:8]>`
 */
export function makeDeterministicLessonId(relativePosixPath: string): string {
	const baseName = path.posix.basename(relativePosixPath);
	const clean = cleanHumanVideoTitle(baseName);
	const asciiClean = stripAccents(clean).toLowerCase();
	let slug = asciiClean.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
	if (slug.length > 48) {
		slug = slug.slice(0, 48).replace(/-+$/, "");
	}
	if (!slug) slug = "lesson";
	const digest = createHash("sha1").update(relativePosixPath, "utf8").digest("hex").slice(0, 8);
	return `${slug}-${digest}`;
}

type NaturalToken = [0, number] | [1, string];
type ComponentSortKey = [number, number, NaturalToken[]];

function naturalTokens(text: string): NaturalToken[] {
	const norm = stripAccents(text).toLowerCase();
	const parts = norm.split(NATURAL_SPLIT_RE);
	const tokens: NaturalToken[] = [];
	for (const part of parts) {
		if (!part) continue;
		if (/^\d+$/.test(part)) {
			tokens.push([0, Number.parseInt(part, 10)]);
		} else {
			tokens.push([1, part]);
		}
	}
	return tokens;
}

function componentSortKey(name: string): ComponentSortKey {
	const ext = path.extname(name);
	const stem = ext ? name.slice(0, -ext.length) : name;
	const norm = stripAccents(stem).trim();

	const lead = LEADING_NUMBER_RE.exec(norm);
	if (lead && lead[1]) {
		return [0, Number.parseInt(lead[1], 10), naturalTokens(stem)];
	}

	const pref = LESSON_PREFIX_NUMBER_RE.exec(norm);
	if (pref && pref[1]) {
		return [0, Number.parseInt(pref[1], 10), naturalTokens(stem)];
	}

	return [1, 0, naturalTokens(stem)];
}

function compareNaturalTokens(a: NaturalToken[], b: NaturalToken[]): number {
	const len = Math.min(a.length, b.length);
	for (let i = 0; i < len; i += 1) {
		const ta = a[i]!;
		const tb = b[i]!;
		if (ta[0] !== tb[0]) return ta[0] - tb[0];
		if (ta[0] === 0 && tb[0] === 0) {
			if (ta[1] !== tb[1]) return ta[1] - tb[1];
		} else if (ta[0] === 1 && tb[0] === 1) {
			if (ta[1] < tb[1]) return -1;
			if (ta[1] > tb[1]) return 1;
		}
	}
	return a.length - b.length;
}

export function compareNaturalVideoPaths(aRelPosix: string, bRelPosix: string): number {
	const aParts = aRelPosix.split("/").filter(Boolean);
	const bParts = bRelPosix.split("/").filter(Boolean);
	const len = Math.min(aParts.length, bParts.length);

	for (let i = 0; i < len; i += 1) {
		const ka = componentSortKey(aParts[i]!);
		const kb = componentSortKey(bParts[i]!);
		if (ka[0] !== kb[0]) return ka[0] - kb[0];
		if (ka[1] !== kb[1]) return ka[1] - kb[1];
		const tokCmp = compareNaturalTokens(ka[2], kb[2]);
		if (tokCmp !== 0) return tokCmp;
	}
	return aParts.length - bParts.length;
}

// ─── Process Liveness ────────────────────────────────────────────────────────

export function isProcessAlive(pid: number | undefined): boolean {
	if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

// ─── State Persistence (`state.json`) ────────────────────────────────────────

function hydrateIntensiveState(raw: Record<string, unknown>, trackId?: string): IntensiveState {
	const track = resolveEffectiveIntensiveTrack(trackId);
	const effectiveTrackId = track?.id ?? trackId ?? DEFAULT_INTENSIVE_TRACK_ID;
	const fallback = createDefaultIntensiveState(effectiveTrackId);

	const rawPacing =
		raw.pacing && typeof raw.pacing === "object" && !Array.isArray(raw.pacing)
			? (raw.pacing as Record<string, unknown>)
			: {};
	const mode: PacingMode =
		rawPacing.mode === "with-clt" || rawPacing.mode === "full-time-home"
			? rawPacing.mode
			: fallback.pacing.mode;
	const modeDefaults = getDefaultPacingSettings(mode, track);

	const numOr = (val: unknown, def: number): number =>
		typeof val === "number" && Number.isFinite(val) && val >= 0 ? Math.round(val) : def;

	const courses: Record<string, CourseProgressState> = { ...fallback.courses };
	if (raw.courses && typeof raw.courses === "object" && !Array.isArray(raw.courses)) {
		for (const [cid, val] of Object.entries(raw.courses as Record<string, unknown>)) {
			if (!val || typeof val !== "object" || Array.isArray(val)) continue;
			const c = val as Partial<CourseProgressState>;
			const base = courses[cid] ?? createDefaultCourseState(cid);
			courses[cid] = {
				courseId: cid,
				optedIn: typeof c.optedIn === "boolean" ? c.optedIn : base.optedIn,
				manualStatus:
					c.manualStatus === "auto" ||
					c.manualStatus === "in-progress" ||
					c.manualStatus === "completed" ||
					c.manualStatus === "paused"
						? c.manualStatus
						: base.manualStatus,
				courseNotes: typeof c.courseNotes === "string" ? c.courseNotes : base.courseNotes,
				customLinks: Array.isArray(c.customLinks) ? c.customLinks : base.customLinks,
				modules:
					c.modules && typeof c.modules === "object" && !Array.isArray(c.modules)
						? c.modules
						: base.modules,
				videos:
					c.videos && typeof c.videos === "object" && !Array.isArray(c.videos)
						? c.videos
						: base.videos,
				lastStudiedAt: typeof c.lastStudiedAt === "string" ? c.lastStudiedAt : base.lastStudiedAt,
			};
		}
	}

	const certifications: Record<string, CertificationProgressState> = {
		...fallback.certifications,
	};
	if (
		raw.certifications &&
		typeof raw.certifications === "object" &&
		!Array.isArray(raw.certifications)
	) {
		for (const [certId, val] of Object.entries(raw.certifications as Record<string, unknown>)) {
			if (!val || typeof val !== "object" || Array.isArray(val)) continue;
			const c = val as Partial<CertificationProgressState>;
			const spec = track?.certifications.find((s) => s.id === certId);
			const base =
				certifications[certId] ??
				(spec
					? createDefaultCertificationState(spec)
					: {
							certId,
							status: "locked" as const,
							completedCheckpoints: {},
							notes: "",
						});
			certifications[certId] = {
				...base,
				...c,
				certId,
				completedCheckpoints:
					c.completedCheckpoints &&
					typeof c.completedCheckpoints === "object" &&
					!Array.isArray(c.completedCheckpoints)
						? c.completedCheckpoints
						: base.completedCheckpoints,
				notes: typeof c.notes === "string" ? c.notes : base.notes,
			};
		}
	}

	const portfolio: Record<string, PortfolioProgressState> = { ...fallback.portfolio };
	if (raw.portfolio && typeof raw.portfolio === "object" && !Array.isArray(raw.portfolio)) {
		for (const [projectId, val] of Object.entries(raw.portfolio as Record<string, unknown>)) {
			if (!val || typeof val !== "object" || Array.isArray(val)) continue;
			const p = val as Partial<PortfolioProgressState>;
			const base = portfolio[projectId] ?? createDefaultPortfolioState(projectId);
			portfolio[projectId] = {
				...base,
				...p,
				projectId,
				completedDeliverables:
					p.completedDeliverables &&
					typeof p.completedDeliverables === "object" &&
					!Array.isArray(p.completedDeliverables)
						? p.completedDeliverables
						: base.completedDeliverables,
				notes: typeof p.notes === "string" ? p.notes : base.notes,
			};
		}
	}

	const benchInterviewChecked: Record<string, boolean> =
		raw.benchInterviewChecked &&
		typeof raw.benchInterviewChecked === "object" &&
		!Array.isArray(raw.benchInterviewChecked)
			? (raw.benchInterviewChecked as Record<string, boolean>)
			: {};

	const benchKitOwned: Record<string, boolean> =
		raw.benchKitOwned &&
		typeof raw.benchKitOwned === "object" &&
		!Array.isArray(raw.benchKitOwned)
			? (raw.benchKitOwned as Record<string, boolean>)
			: {};

	const studyLog = Array.isArray(raw.studyLog) ? (raw.studyLog as IntensiveState["studyLog"]) : [];

	return {
		schemaVersion: 1,
		trackId: typeof raw.trackId === "string" && raw.trackId ? raw.trackId : effectiveTrackId,
		createdAt: typeof raw.createdAt === "string" ? raw.createdAt : fallback.createdAt,
		updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : fallback.updatedAt,
		pacing: {
			mode,
			dailyElectronicsMinutes: numOr(
				rawPacing.dailyElectronicsMinutes,
				modeDefaults.dailyElectronicsMinutes,
			),
			dailyLanguageMinutes: numOr(
				rawPacing.dailyLanguageMinutes,
				modeDefaults.dailyLanguageMinutes,
			),
			dailyCtaMinutes: numOr(rawPacing.dailyCtaMinutes, modeDefaults.dailyCtaMinutes),
			passiveVideoCapMinutes: numOr(
				rawPacing.passiveVideoCapMinutes,
				modeDefaults.passiveVideoCapMinutes,
			),
			startDate:
				typeof rawPacing.startDate === "string" ? rawPacing.startDate : fallback.pacing.startDate,
		},
		courses,
		certifications,
		portfolio,
		benchInterviewChecked,
		benchKitOwned,
		studyLog,
	};
}

export function readIntensiveState(
	trackId?: string,
): IntensiveState {
	const resolvedTrackId = resolveEffectiveIntensiveTrack(trackId)?.id ?? trackId ?? DEFAULT_INTENSIVE_TRACK_ID;
	const raw = readJsonFileSync<Record<string, unknown>>(intensiveStatePath());
	if (!raw) {
		return createDefaultIntensiveState(resolvedTrackId);
	}
	return hydrateIntensiveState(raw, resolvedTrackId);
}

export function writeIntensiveState(state: IntensiveState): IntensiveState {
	const next: IntensiveState = {
		...state,
		schemaVersion: 1,
		updatedAt: new Date().toISOString(),
	};
	writeJsonAtomic(intensiveStatePath(), next);
	return next;
}

// ─── Media Sources & Auto-Discovery (`sources.json` + `media/<id>/manifest.json`) ─

function parseCourseMediaSource(
	courseId: string,
	raw: unknown,
): CourseMediaSource | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const obj = raw as Record<string, unknown>;
	if (typeof obj.sourceDir !== "string" || !obj.sourceDir.trim()) return null;
	const expected =
		typeof obj.expectedTotalVideos === "number" &&
		Number.isFinite(obj.expectedTotalVideos) &&
		obj.expectedTotalVideos > 0
			? Math.floor(obj.expectedTotalVideos)
			: undefined;
	return {
		courseId,
		sourceDir: obj.sourceDir.trim(),
		label: typeof obj.label === "string" && obj.label.trim() ? obj.label.trim() : undefined,
		language: typeof obj.language === "string" && obj.language.trim() ? obj.language.trim() : "pt",
		configuredAt:
			typeof obj.configuredAt === "string" && obj.configuredAt
				? obj.configuredAt
				: new Date().toISOString(),
		expectedTotalVideos: expected,
	};
}

export function readExplicitMediaSources(): Record<string, CourseMediaSource> {
	const raw = readJsonFileSync<Record<string, unknown>>(intensiveSourcesPath());
	if (!raw) return {};
	const out: Record<string, CourseMediaSource> = {};
	for (const [cid, entry] of Object.entries(raw)) {
		if (!isSafeIntensiveId(cid)) continue;
		const parsed = parseCourseMediaSource(cid, entry);
		if (parsed) out[cid] = parsed;
	}
	return out;
}

export function writeExplicitMediaSources(sources: Record<string, CourseMediaSource>): void {
	writeJsonAtomic(intensiveSourcesPath(), sources);
}

function listMediaSubdirCourseIds(): string[] {
	const root = intensiveMediaRootDir();
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(/* turbopackIgnore: true */ root, { withFileTypes: true });
	} catch {
		return [];
	}
	const ids: string[] = [];
	for (const entry of entries) {
		if (entry.isDirectory() && isSafeIntensiveId(entry.name)) {
			ids.push(entry.name);
		}
	}
	return ids;
}

function readRawManifest(courseId: string): Record<string, unknown> | null {
	if (!isSafeIntensiveId(courseId)) return null;
	const filePath = path.join(/* turbopackIgnore: true */ intensiveCourseMediaDir(courseId), "manifest.json");
	return readJsonFileSync<Record<string, unknown>>(filePath);
}

export function readRawCourseStatus(courseId: string): Record<string, unknown> | null {
	if (!isSafeIntensiveId(courseId)) return null;
	const filePath = path.join(/* turbopackIgnore: true */ intensiveCourseMediaDir(courseId), "status.json");
	return readJsonFileSync<Record<string, unknown>>(filePath);
}

export function writeRawCourseStatus(courseId: string, payload: Record<string, unknown>): void {
	const filePath = path.join(/* turbopackIgnore: true */ intensiveCourseMediaDir(courseId), "status.json");
	writeJsonAtomic(filePath, payload);
}

/**
 * Merges configured `sources.json` entries with auto-discovered
 * `<PATHS.data>/intensive/media/<courseId>/manifest.json` (and `status.json`)
 * directories so pre-transcribed courses appear immediately without manual config.
 */
export function listEffectiveMediaSources(): Record<string, CourseMediaSource> {
	const sources = readExplicitMediaSources();

	for (const courseId of listMediaSubdirCourseIds()) {
		if (sources[courseId]) continue;
		const manifest = readRawManifest(courseId);
		const status = manifest ? null : readRawCourseStatus(courseId);
		const meta = manifest ?? status;
		if (!meta) continue;
		const sourceDir = typeof meta.sourceDir === "string" ? meta.sourceDir.trim() : "";
		if (!sourceDir) continue;
		const courseName =
			typeof meta.courseName === "string" && meta.courseName.trim() && meta.courseName !== courseId
				? meta.courseName.trim()
				: undefined;
		const language =
			typeof meta.language === "string" && meta.language.trim() ? meta.language.trim() : "pt";
		const configuredAt =
			typeof meta.updatedAt === "string"
				? meta.updatedAt
				: typeof meta.lastUpdatedAt === "string"
					? meta.lastUpdatedAt
					: new Date().toISOString();

		sources[courseId] = {
			courseId,
			sourceDir,
			label: courseName,
			language,
			configuredAt,
		};
	}

	return sources;
}

export function listKnownMediaCourseIds(): string[] {
	const set = new Set<string>(Object.keys(readExplicitMediaSources()));
	for (const id of listMediaSubdirCourseIds()) {
		set.add(id);
	}
	return Array.from(set);
}

// ─── Manifest & Status Normalization + Direct Source Scan ────────────────────

function normalizeTranscriptStatus(rawStatus: unknown): MediaTranscriptStatus {
	if (rawStatus === "completed" || rawStatus === "ready") return "ready";
	if (rawStatus === "failed" || rawStatus === "error") return "error";
	if (rawStatus === "transcribing") return "transcribing";
	if (rawStatus === "downloading") return "downloading";
	return "pending";
}

function sectionFromRelativePath(relPosix: string | undefined): string | undefined {
	if (!relPosix) return undefined;
	const dir = path.posix.dirname(relPosix.replace(/\\/g, "/"));
	if (!dir || dir === ".") return undefined;
	return dir;
}

function findSidecarThumbnail(videoAbsPath: string): string | undefined {
	const telegramThumb = `${videoAbsPath}_thumb.jpg`;
	try {
		const st = fs.statSync(/* turbopackIgnore: true */ telegramThumb, { throwIfNoEntry: false });
		if (st && st.isFile() && st.size > 0) return telegramThumb;
	} catch {
		// ignore
	}
	const ext = path.extname(videoAbsPath);
	const stem = ext ? videoAbsPath.slice(0, -ext.length) : videoAbsPath;
	for (const suffix of ["_thumb.jpg", "_thumb.jpeg", "_thumb.png", "_thumb.webp", ".jpg", ".png", ".webp"]) {
		const candidate = `${stem}${suffix}`;
		try {
			const st = fs.statSync(/* turbopackIgnore: true */ candidate, { throwIfNoEntry: false });
			if (st && st.isFile() && st.size > 0) return candidate;
		} catch {
			// ignore
		}
	}
	return undefined;
}

function scanVideosInSourceDir(
	courseId: string,
	sourceDir: string,
): InternalMediaLessonRecord[] {
	const resolvedRoot = path.resolve(/* turbopackIgnore: true */ sourceDir);
	let rootStat: fs.Stats | undefined;
	try {
		rootStat = fs.statSync(/* turbopackIgnore: true */ resolvedRoot, { throwIfNoEntry: false });
	} catch {
		return [];
	}
	if (!rootStat || !rootStat.isDirectory()) return [];

	const discovered: Array<{ fullPath: string; relPosix: string; fileName: string }> = [];

	const walk = (currentDir: string, relPrefix: string) => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(/* turbopackIgnore: true */ currentDir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			const fullPath = path.join(/* turbopackIgnore: true */ currentDir, entry.name);
			const relPosix = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				walk(fullPath, relPosix);
			} else if (entry.isFile()) {
				const ext = path.extname(entry.name).toLowerCase();
				if (VIDEO_EXTENSIONS.has(ext)) {
					discovered.push({ fullPath, relPosix, fileName: entry.name });
				}
			}
		}
	};

	walk(resolvedRoot, "");
	discovered.sort((a, b) => compareNaturalVideoPaths(a.relPosix, b.relPosix));

	const transcriptsDir = intensiveCourseTranscriptsDir(courseId);
	const records: InternalMediaLessonRecord[] = [];

	for (let i = 0; i < discovered.length; i += 1) {
		const item = discovered[i]!;
		const lessonId = makeDeterministicLessonId(item.relPosix);
		let fileSize = 0;
		let fileMtimeMs = 0;
		try {
			const st = fs.statSync(/* turbopackIgnore: true */ item.fullPath);
			fileSize = st.size;
			fileMtimeMs = Math.round(st.mtimeMs);
		} catch {
			// unreadable or currently locked
		}

		// Check if a transcript JSON already exists on disk for this lessonId.
		let transcriptStatus: MediaTranscriptStatus =
			fileSize <= MIN_COMPLETE_VIDEO_BYTES ? "downloading" : "pending";
		let durationSec = 0;
		let wordCount: number | undefined;
		let chunkCount: number | undefined;
		let transcribedAt: string | undefined;
		let telegramCaption: string | undefined;

		const tJsonPath = path.join(/* turbopackIgnore: true */ transcriptsDir, `${lessonId}.json`);
		if (fs.existsSync(/* turbopackIgnore: true */ tJsonPath)) {
			const doc = readLessonTranscript(courseId, lessonId);
			if (doc) {
				transcriptStatus = "ready";
				durationSec = doc.durationSec;
				wordCount = doc.wordCount;
				chunkCount = doc.chunks.length;
				transcribedAt = doc.transcribedAt;
				telegramCaption = doc.telegramCaption;
			}
		}

		const summary: MediaLessonSummary = {
			lessonId,
			fileName: item.fileName,
			title: cleanHumanVideoTitle(item.fileName),
			order: i + 1,
			durationSec,
			fileSize,
			fileMtimeMs,
			section: sectionFromRelativePath(item.relPosix),
			telegramCaption: telegramCaption || undefined,
			transcriptStatus,
			wordCount,
			chunkCount,
			transcribedAt,
		};

		records.push({
			summary,
			relativePath: item.relPosix,
			filePath: item.fullPath,
			thumbnailPath: findSidecarThumbnail(item.fullPath),
		});
	}

	return records;
}

function parseManifestLessons(manifest: Record<string, unknown>): InternalMediaLessonRecord[] {
	const rawLessons = Array.isArray(manifest.lessons) ? manifest.lessons : [];
	const records: InternalMediaLessonRecord[] = [];

	for (let i = 0; i < rawLessons.length; i += 1) {
		const raw = rawLessons[i];
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
		const item = raw as Record<string, unknown>;
		const lessonId = typeof item.lessonId === "string" ? item.lessonId.trim() : "";
		if (!lessonId || !isSafeIntensiveId(lessonId)) continue;

		const fileName =
			typeof item.fileName === "string" && item.fileName
				? item.fileName
				: typeof item.relativePath === "string"
					? path.posix.basename(item.relativePath.replace(/\\/g, "/"))
					: `${lessonId}.mp4`;
		const relativePath =
			typeof item.relativePath === "string" && item.relativePath.trim()
				? item.relativePath.replace(/\\/g, "/")
				: undefined;
		const filePath =
			typeof item.filePath === "string" && item.filePath.trim() ? item.filePath.trim() : undefined;
		const thumbnailPath =
			typeof item.thumbnailPath === "string" && item.thumbnailPath.trim()
				? item.thumbnailPath.trim()
				: undefined;

		const order =
			typeof item.order === "number" && Number.isFinite(item.order) && item.order > 0
				? Math.floor(item.order)
				: i + 1;
		const durationSec =
			typeof item.durationSec === "number" && Number.isFinite(item.durationSec) && item.durationSec >= 0
				? item.durationSec
				: 0;
		const fileSize =
			typeof item.fileSize === "number" && Number.isFinite(item.fileSize) && item.fileSize >= 0
				? item.fileSize
				: 0;
		const fileMtimeMs =
			typeof item.fileMtimeMs === "number" && Number.isFinite(item.fileMtimeMs)
				? item.fileMtimeMs
				: 0;
		const section =
			typeof item.section === "string" && item.section.trim()
				? item.section.trim()
				: sectionFromRelativePath(relativePath);
		const telegramCaption =
			typeof item.telegramCaption === "string" && item.telegramCaption.trim()
				? item.telegramCaption.trim()
				: undefined;
		const transcriptStatus = normalizeTranscriptStatus(item.transcriptStatus ?? item.status);
		const wordCount =
			typeof item.wordCount === "number" && Number.isFinite(item.wordCount)
				? item.wordCount
				: undefined;
		const chunkCount =
			typeof item.chunkCount === "number" && Number.isFinite(item.chunkCount)
				? item.chunkCount
				: undefined;
		const transcribedAt =
			typeof item.transcribedAt === "string" && item.transcribedAt
				? item.transcribedAt
				: undefined;
		const error =
			typeof item.error === "string" && item.error.trim() ? item.error.trim() : undefined;

		const summary: MediaLessonSummary = {
			lessonId,
			fileName,
			title:
				typeof item.title === "string" && item.title.trim()
					? item.title.trim()
					: cleanHumanVideoTitle(fileName),
			order,
			durationSec,
			fileSize,
			fileMtimeMs,
			section,
			telegramCaption,
			transcriptStatus,
			wordCount,
			chunkCount,
			transcribedAt,
			error,
		};

		records.push({
			summary,
			relativePath,
			filePath,
			thumbnailPath,
		});
	}

	records.sort((a, b) =>
		a.summary.order !== b.summary.order
			? a.summary.order - b.summary.order
			: a.summary.fileName.localeCompare(b.summary.fileName),
	);
	return records;
}

function summarizeLessonsCounts(lessons: MediaLessonSummary[]): {
	discoveredCount: number;
	readyCount: number;
	pendingCount: number;
	downloadingCount: number;
	errorCount: number;
} {
	let readyCount = 0;
	let pendingCount = 0;
	let downloadingCount = 0;
	let errorCount = 0;

	for (const l of lessons) {
		if (l.transcriptStatus === "ready") readyCount += 1;
		else if (l.transcriptStatus === "downloading") downloadingCount += 1;
		else if (l.transcriptStatus === "error") errorCount += 1;
		else pendingCount += 1;
	}

	return {
		discoveredCount: lessons.length,
		readyCount,
		pendingCount,
		downloadingCount,
		errorCount,
	};
}

export function normalizeRawCourseStatus(
	courseId: string,
	raw: Record<string, unknown>,
	fallbackLessons?: MediaLessonSummary[],
): CourseTranscriptionStatus {
	const countsFallback = fallbackLessons ? summarizeLessonsCounts(fallbackLessons) : null;

	const pickNum = (keys: string[], def: number): number => {
		for (const k of keys) {
			const val = raw[k];
			if (typeof val === "number" && Number.isFinite(val) && val >= 0) {
				return Math.floor(val);
			}
		}
		return def;
	};

	const discoveredCount = pickNum(
		["discoveredCount", "totalDiscovered"],
		countsFallback?.discoveredCount ?? 0,
	);
	const readyCount = pickNum(["readyCount", "completed"], countsFallback?.readyCount ?? 0);
	const pendingCount = pickNum(["pendingCount", "pending"], countsFallback?.pendingCount ?? 0);
	const downloadingCount = pickNum(
		["downloadingCount", "downloading"],
		countsFallback?.downloadingCount ?? 0,
	);
	const errorCount = pickNum(["errorCount", "failed"], countsFallback?.errorCount ?? 0);

	const rawPid =
		typeof raw.pid === "number" && Number.isInteger(raw.pid) && raw.pid > 0 ? raw.pid : undefined;
	const rawState = typeof raw.state === "string" ? raw.state.toLowerCase() : "idle";

	let state: TranscriptionJobState;
	if (
		rawState === "starting" ||
		rawState === "scanning" ||
		rawState === "transcribing" ||
		rawState === "running"
	) {
		state = "running";
	} else if (rawState === "watching") {
		state = "watching";
	} else if (rawState === "completed") {
		state = "completed";
	} else if (rawState === "error") {
		state = "error";
	} else {
		state = "idle";
	}

	let effectivePid = rawPid;
	let currentFile: string | null =
		typeof raw.currentFile === "string"
			? raw.currentFile
			: typeof raw.currentFileName === "string"
				? raw.currentFileName
				: null;

	// Verify actual OS process liveness whenever status claims an active worker.
	if (state === "running" || state === "watching") {
		if (!isProcessAlive(rawPid)) {
			state = pendingCount === 0 && downloadingCount === 0 && readyCount > 0 ? "completed" : "idle";
			effectivePid = undefined;
			currentFile = null;
		}
	}

	const avgRealtimeFactor =
		typeof raw.avgRealtimeFactor === "number" && Number.isFinite(raw.avgRealtimeFactor)
			? raw.avgRealtimeFactor
			: typeof raw.avgRealtimeSpeedup === "number" && Number.isFinite(raw.avgRealtimeSpeedup)
				? raw.avgRealtimeSpeedup
				: null;

	let lastError: string | null =
		typeof raw.lastError === "string" && raw.lastError.trim() ? raw.lastError.trim() : null;
	if (!lastError && Array.isArray(raw.recentErrors) && raw.recentErrors.length > 0) {
		const lastEntry = raw.recentErrors[raw.recentErrors.length - 1];
		if (lastEntry && typeof lastEntry === "object" && !Array.isArray(lastEntry)) {
			const errField = (lastEntry as Record<string, unknown>).error;
			if (typeof errField === "string" && errField.trim()) {
				lastError = errField.trim();
			}
		}
	}

	return {
		courseId,
		state,
		pid: effectivePid,
		model: typeof raw.model === "string" && raw.model ? raw.model : undefined,
		device: typeof raw.device === "string" && raw.device ? raw.device : undefined,
		discoveredCount,
		readyCount,
		pendingCount,
		downloadingCount,
		errorCount,
		currentFile,
		avgRealtimeFactor,
		startedAt: typeof raw.startedAt === "string" ? raw.startedAt : undefined,
		lastUpdatedAt: typeof raw.lastUpdatedAt === "string" ? raw.lastUpdatedAt : undefined,
		lastError,
	};
}

export function loadCourseMediaIndex(courseId: string): CourseMediaIndex {
	if (!isSafeIntensiveId(courseId)) {
		return {
			courseId,
			source: null,
			status: null,
			lessons: [],
			recordsById: new Map(),
		};
	}

	const effectiveSources = listEffectiveMediaSources();
	const source = effectiveSources[courseId] ?? null;
	const manifest = readRawManifest(courseId);
	const rawStatus = readRawCourseStatus(courseId);

	const manifestRecords = manifest ? parseManifestLessons(manifest) : [];
	const recordsById = new Map<string, InternalMediaLessonRecord>();
	const mergedRecords: InternalMediaLessonRecord[] = [];

	for (const rec of manifestRecords) {
		recordsById.set(rec.summary.lessonId, rec);
		mergedRecords.push(rec);
	}

	// Direct scan of sourceDir so newly linked folders or newly downloaded videos
	// are immediately playable even before manifest.json exists or updates.
	const effectiveSourceDir =
		source?.sourceDir ??
		(manifest && typeof manifest.sourceDir === "string" ? manifest.sourceDir.trim() : "");

	if (effectiveSourceDir) {
		const scanned = scanVideosInSourceDir(courseId, effectiveSourceDir);
		if (mergedRecords.length === 0) {
			for (const rec of scanned) {
				recordsById.set(rec.summary.lessonId, rec);
				mergedRecords.push(rec);
			}
		} else {
			let nextOrder =
				mergedRecords.reduce((max, r) => Math.max(max, r.summary.order), 0) + 1;
			for (const rec of scanned) {
				const existing = recordsById.get(rec.summary.lessonId);
				if (!existing) {
					rec.summary.order = nextOrder;
					nextOrder += 1;
					recordsById.set(rec.summary.lessonId, rec);
					mergedRecords.push(rec);
				} else {
					// Backfill relativePath/thumbnailPath if manifest omitted them.
					if (!existing.relativePath && rec.relativePath) existing.relativePath = rec.relativePath;
					if (!existing.filePath && rec.filePath) existing.filePath = rec.filePath;
					if (!existing.thumbnailPath && rec.thumbnailPath) existing.thumbnailPath = rec.thumbnailPath;
				}
			}
		}
	}

	const lessons = mergedRecords.map((r) => r.summary);

	let status: CourseTranscriptionStatus | null = null;
	if (rawStatus) {
		status = normalizeRawCourseStatus(courseId, rawStatus, lessons);
		// Keep discovered count fresh when direct scan found videos before status.json caught up.
		if (lessons.length > status.discoveredCount) {
			const freshCounts = summarizeLessonsCounts(lessons);
			status = {
				...status,
				discoveredCount: freshCounts.discoveredCount,
				readyCount: Math.max(status.readyCount, freshCounts.readyCount),
				pendingCount: Math.max(status.pendingCount, freshCounts.pendingCount),
				downloadingCount: Math.max(status.downloadingCount, freshCounts.downloadingCount),
			};
		}
	} else if (source || lessons.length > 0) {
		const counts = summarizeLessonsCounts(lessons);
		status = {
			courseId,
			state:
				counts.discoveredCount > 0 &&
				counts.readyCount === counts.discoveredCount &&
				counts.pendingCount === 0 &&
				counts.downloadingCount === 0
					? "completed"
					: "idle",
			...counts,
			currentFile: null,
			avgRealtimeFactor: null,
			lastError: null,
		};
	}

	return {
		courseId,
		source,
		status,
		lessons,
		recordsById,
	};
}

export function loadAllCourseMediaBundles(): Record<string, CourseMediaBundle> {
	const bundles: Record<string, CourseMediaBundle> = {};
	for (const courseId of listKnownMediaCourseIds()) {
		const idx = loadCourseMediaIndex(courseId);
		if (idx.source || idx.lessons.length > 0 || idx.status) {
			bundles[courseId] = {
				lessons: idx.lessons,
				status: idx.status,
				source: idx.source,
			};
		}
	}
	return bundles;
}

// ─── Transcript Loading & Caching ────────────────────────────────────────────

function normalizeSegments(raw: unknown): TranscriptSegment[] {
	if (!Array.isArray(raw)) return [];
	const out: TranscriptSegment[] = [];
	for (let i = 0; i < raw.length; i += 1) {
		const s = raw[i];
		if (!s || typeof s !== "object" || Array.isArray(s)) continue;
		const obj = s as Record<string, unknown>;
		const start = typeof obj.start === "number" && Number.isFinite(obj.start) ? obj.start : 0;
		const end = typeof obj.end === "number" && Number.isFinite(obj.end) ? obj.end : start;
		const text = typeof obj.text === "string" ? obj.text.trim() : "";
		if (!text) continue;
		out.push({
			id: typeof obj.id === "number" && Number.isFinite(obj.id) ? obj.id : i,
			start,
			end,
			text,
		});
	}
	return out;
}

function normalizeChunks(raw: unknown): TranscriptChunk[] {
	if (!Array.isArray(raw)) return [];
	const out: TranscriptChunk[] = [];
	for (let i = 0; i < raw.length; i += 1) {
		const c = raw[i];
		if (!c || typeof c !== "object" || Array.isArray(c)) continue;
		const obj = c as Record<string, unknown>;
		const start = typeof obj.start === "number" && Number.isFinite(obj.start) ? obj.start : 0;
		const end = typeof obj.end === "number" && Number.isFinite(obj.end) ? obj.end : start;
		const text = typeof obj.text === "string" ? obj.text.trim() : "";
		if (!text) continue;
		out.push({
			index: typeof obj.index === "number" && Number.isFinite(obj.index) ? obj.index : i,
			start,
			end,
			text,
		});
	}
	return out;
}

export function readLessonTranscript(
	courseId: string,
	lessonId: string,
): LessonTranscriptDoc | null {
	if (!isSafeIntensiveId(courseId) || !isSafeIntensiveId(lessonId)) return null;
	const transcriptsDir = intensiveCourseTranscriptsDir(courseId);
	const absPath = path.join(/* turbopackIgnore: true */ transcriptsDir, `${lessonId}.json`);
	if (!isPathWithinDir(absPath, transcriptsDir)) return null;

	let stat: fs.Stats | undefined;
	try {
		stat = fs.statSync(/* turbopackIgnore: true */ absPath, { throwIfNoEntry: false });
	} catch {
		return null;
	}
	if (!stat || !stat.isFile()) return null;

	const stamp = `${stat.mtimeMs}|${stat.size}`;
	const cache = transcriptCache();
	const cached = cache.get(absPath);
	if (cached && cached.stamp === stamp) {
		return cached.doc;
	}

	const raw = readJsonFileSync<Record<string, unknown>>(absPath);
	if (!raw) return null;

	const segments = normalizeSegments(raw.segments);
	const chunks = normalizeChunks(raw.chunks);
	const fullText =
		typeof raw.fullText === "string"
			? raw.fullText
			: segments.map((s) => s.text).join(" ").trim();
	const wordCount =
		typeof raw.wordCount === "number" && Number.isFinite(raw.wordCount)
			? raw.wordCount
			: fullText
				? fullText.split(/\s+/).filter(Boolean).length
				: 0;
	const fileName =
		typeof raw.fileName === "string" && raw.fileName ? raw.fileName : `${lessonId}.mp4`;

	const doc: LessonTranscriptDoc = {
		schemaVersion: 1,
		courseId: typeof raw.courseId === "string" && raw.courseId ? raw.courseId : courseId,
		lessonId: typeof raw.lessonId === "string" && raw.lessonId ? raw.lessonId : lessonId,
		fileName,
		filePath: typeof raw.filePath === "string" ? raw.filePath : undefined,
		fileSize: typeof raw.fileSize === "number" && Number.isFinite(raw.fileSize) ? raw.fileSize : 0,
		fileMtimeMs:
			typeof raw.fileMtimeMs === "number" && Number.isFinite(raw.fileMtimeMs) ? raw.fileMtimeMs : 0,
		title:
			typeof raw.title === "string" && raw.title.trim()
				? raw.title.trim()
				: cleanHumanVideoTitle(fileName),
		order: typeof raw.order === "number" && Number.isFinite(raw.order) ? raw.order : 0,
		durationSec:
			typeof raw.durationSec === "number" && Number.isFinite(raw.durationSec) ? raw.durationSec : 0,
		language: typeof raw.language === "string" && raw.language ? raw.language : "pt",
		model: typeof raw.model === "string" ? raw.model : "",
		transcribedAt: typeof raw.transcribedAt === "string" ? raw.transcribedAt : "",
		telegramCaption:
			typeof raw.telegramCaption === "string" && raw.telegramCaption.trim()
				? raw.telegramCaption.trim()
				: undefined,
		wordCount,
		fullText,
		segments,
		chunks,
	};

	if (cache.size >= MAX_TRANSCRIPT_CACHE_ENTRIES && !cache.has(absPath)) {
		const oldestKey = cache.keys().next().value;
		if (oldestKey !== undefined) cache.delete(oldestKey);
	}
	cache.set(absPath, { stamp, doc });
	return doc;
}

function formatVttTime(seconds: number): string {
	const totalMs = Math.max(0, Math.round(seconds * 1000));
	const ms = totalMs % 1000;
	const totalS = Math.floor(totalMs / 1000);
	const s = totalS % 60;
	const totalM = Math.floor(totalS / 60);
	const m = totalM % 60;
	const h = Math.floor(totalM / 60);
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function formatTxtTime(seconds: number): string {
	const totalS = Math.max(0, Math.floor(seconds));
	const s = totalS % 60;
	const totalM = Math.floor(totalS / 60);
	const m = totalM % 60;
	const h = Math.floor(totalM / 60);
	if (h > 0) return `[${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}]`;
	return `[${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}]`;
}

export function readLessonTranscriptFile(
	courseId: string,
	lessonId: string,
	format: "vtt" | "txt",
): { content: string; contentType: string } | null {
	if (!isSafeIntensiveId(courseId) || !isSafeIntensiveId(lessonId)) return null;
	const transcriptsDir = intensiveCourseTranscriptsDir(courseId);
	const ext = format === "vtt" ? ".vtt" : ".txt";
	const absPath = path.join(/* turbopackIgnore: true */ transcriptsDir, `${lessonId}${ext}`);
	if (!isPathWithinDir(absPath, transcriptsDir)) return null;

	const contentType =
		format === "vtt" ? "text/vtt; charset=utf-8" : "text/plain; charset=utf-8";

	try {
		const raw = fs.readFileSync(/* turbopackIgnore: true */ absPath, "utf8");
		return { content: stripBom(raw), contentType };
	} catch {
		// Fallback: synthesize VTT/TXT from transcript JSON if the JSON exists.
		const doc = readLessonTranscript(courseId, lessonId);
		if (!doc || doc.segments.length === 0) return null;
		if (format === "vtt") {
			const lines = ["WEBVTT", ""];
			let idx = 1;
			for (const seg of doc.segments) {
				const text = seg.text.replace(/-->/g, "->").trim();
				if (!text) continue;
				const start = Math.max(0, seg.start);
				const end = Math.max(start + 0.05, seg.end);
				lines.push(String(idx), `${formatVttTime(start)} --> ${formatVttTime(end)}`, text, "");
				idx += 1;
			}
			return { content: lines.join("\n"), contentType };
		}
		const txt = doc.segments
			.map((seg) => `${formatTxtTime(seg.start)} ${seg.text}`)
			.join("\n");
		return { content: `${txt}\n`, contentType };
	}
}

export function loadAllCourseTranscripts(courseId: string): LessonTranscriptDoc[] {
	if (!isSafeIntensiveId(courseId)) return [];
	const transcriptsDir = intensiveCourseTranscriptsDir(courseId);
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(/* turbopackIgnore: true */ transcriptsDir, { withFileTypes: true });
	} catch {
		return [];
	}

	const docs: LessonTranscriptDoc[] = [];
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.startsWith(".")) continue;
		const lessonId = entry.name.slice(0, -".json".length);
		if (!isSafeIntensiveId(lessonId)) continue;
		const doc = readLessonTranscript(courseId, lessonId);
		if (doc) docs.push(doc);
	}

	docs.sort((a, b) =>
		a.order !== b.order ? a.order - b.order : a.fileName.localeCompare(b.fileName),
	);
	return docs;
}

// ─── Secure Media File Resolution (No Raw Paths Ever Accepted) ───────────────

export function resolveCourseLessonMedia(
	courseId: string,
	lessonId: string,
	kind: "video" | "thumb",
): ResolvedMediaFile | null {
	if (!isSafeIntensiveId(courseId) || !isSafeIntensiveId(lessonId)) return null;

	const idx = loadCourseMediaIndex(courseId);
	const record = idx.recordsById.get(lessonId);
	if (!record) return null;

	const sourceDir = idx.source?.sourceDir;
	if (!sourceDir) return null;
	const resolvedSourceDir = path.resolve(/* turbopackIgnore: true */ sourceDir);

	if (kind === "video") {
		const candidates: string[] = [];
		if (record.relativePath) {
			candidates.push(path.resolve(/* turbopackIgnore: true */ resolvedSourceDir, record.relativePath));
		}
		if (record.filePath) {
			candidates.push(path.resolve(/* turbopackIgnore: true */ record.filePath));
		}

		for (const candidate of candidates) {
			if (!isPathWithinDir(candidate, resolvedSourceDir)) continue;
			const ext = path.extname(candidate).toLowerCase();
			if (!VIDEO_EXTENSIONS.has(ext)) continue;
			const contentType = VIDEO_CONTENT_TYPES[ext];
			if (!contentType) continue;

			try {
				const st = fs.statSync(/* turbopackIgnore: true */ candidate, { throwIfNoEntry: false });
				if (!st || !st.isFile()) continue;
				return {
					absPath: candidate,
					contentType,
					size: st.size,
					fileName: path.basename(candidate),
				};
			} catch {
				continue;
			}
		}
		return null;
	}

	// kind === "thumb"
	const courseMediaDir = intensiveCourseMediaDir(courseId);
	const thumbCandidates: string[] = [];
	if (record.thumbnailPath) {
		thumbCandidates.push(path.resolve(/* turbopackIgnore: true */ record.thumbnailPath));
	}

	const videoCandidate = record.relativePath
		? path.resolve(/* turbopackIgnore: true */ resolvedSourceDir, record.relativePath)
		: record.filePath
			? path.resolve(/* turbopackIgnore: true */ record.filePath)
			: null;

	if (videoCandidate && isPathWithinDir(videoCandidate, resolvedSourceDir)) {
		const autoThumb = findSidecarThumbnail(videoCandidate);
		if (autoThumb) thumbCandidates.push(path.resolve(/* turbopackIgnore: true */ autoThumb));
	}

	for (const candidate of thumbCandidates) {
		const insideSource = isPathWithinDir(candidate, resolvedSourceDir);
		const insideMedia = isPathWithinDir(candidate, courseMediaDir);
		if (!insideSource && !insideMedia) continue;

		const ext = path.extname(candidate).toLowerCase();
		if (!IMAGE_EXTENSIONS.has(ext)) continue;
		const contentType = IMAGE_CONTENT_TYPES[ext];
		if (!contentType) continue;

		try {
			const st = fs.statSync(/* turbopackIgnore: true */ candidate, { throwIfNoEntry: false });
			if (!st || !st.isFile() || st.size <= 0) continue;
			return {
				absPath: candidate,
				contentType,
				size: st.size,
				fileName: path.basename(candidate),
			};
		} catch {
			continue;
		}
	}

	return null;
}

// ─── Course Materials (PDFs, Apostilas, Exercises, Schematics) ───────────────

export interface InternalMaterialRecord {
	summary: CourseMaterialSummary;
	extractedJson?: string;
}

export interface CourseMaterialsIndex {
	courseId: string;
	sourceDir?: string;
	updatedAt?: string;
	totalFiles: number;
	indexedTextFiles: number;
	totalPages: number;
	totalWordCount: number;
	materials: CourseMaterialSummary[];
	recordsById: Map<string, InternalMaterialRecord>;
}

interface MaterialCacheEntry {
	stamp: string;
	doc: CourseMaterialDoc;
}

const MATERIAL_CACHE_KEY = Symbol.for("learnharness.store.intensiveMaterialCache");
const MAX_MATERIAL_CACHE_ENTRIES = 400;

function materialDocCache(): Map<string, MaterialCacheEntry> {
	const g = globalThis as typeof globalThis & {
		[MATERIAL_CACHE_KEY]?: Map<string, MaterialCacheEntry>;
	};
	return (g[MATERIAL_CACHE_KEY] ??= new Map());
}

const VALID_MATERIAL_CATEGORIES = new Set<MaterialCategory>([
	"pdf",
	"doc",
	"text",
	"image",
	"spreadsheet",
	"archive",
	"other",
]);

const MATERIAL_CONTENT_TYPES: Record<string, string> = {
	".pdf": "application/pdf",
	".doc": "application/msword",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".rtf": "application/rtf",
	".odt": "application/vnd.oasis.opendocument.text",
	".ppt": "application/vnd.ms-powerpoint",
	".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".xls": "application/vnd.ms-excel",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".ods": "application/vnd.oasis.opendocument.spreadsheet",
	".csv": "text/csv; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".md": "text/plain; charset=utf-8",
	".log": "text/plain; charset=utf-8",
	".asc": "text/plain; charset=utf-8",
	".cir": "text/plain; charset=utf-8",
	".net": "text/plain; charset=utf-8",
	".sub": "text/plain; charset=utf-8",
	".lib": "text/plain; charset=utf-8",
	".html": "text/plain; charset=utf-8",
	".htm": "text/plain; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".webp": "image/webp",
	".gif": "image/gif",
	".bmp": "image/bmp",
	".zip": "application/zip",
	".rar": "application/vnd.rar",
	".7z": "application/x-7z-compressed",
};

function inferMaterialCategory(fileName: string): MaterialCategory {
	const ext = path.extname(fileName).toLowerCase();
	if (ext === ".pdf") return "pdf";
	if ([".doc", ".docx", ".rtf", ".odt", ".ppt", ".pptx"].includes(ext)) return "doc";
	if ([".txt", ".md", ".log", ".asc", ".cir", ".net", ".sub", ".lib", ".json", ".html", ".htm"].includes(ext)) {
		return "text";
	}
	if ([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".svg"].includes(ext)) return "image";
	if ([".xls", ".xlsx", ".ods", ".csv"].includes(ext)) return "spreadsheet";
	if ([".zip", ".rar", ".7z", ".tar", ".gz"].includes(ext)) return "archive";
	return "other";
}

function normalizeMaterialCategory(raw: unknown, fileName: string): MaterialCategory {
	if (typeof raw === "string" && VALID_MATERIAL_CATEGORIES.has(raw as MaterialCategory)) {
		return raw as MaterialCategory;
	}
	return inferMaterialCategory(fileName);
}

function normalizeRelativeMaterialPath(raw: unknown, fallbackFileName: string): string {
	const val = typeof raw === "string" && raw.trim() ? raw.trim() : fallbackFileName;
	return val.replace(/\\/g, "/");
}

function isSafeRelativeMaterialPath(relPath: string): boolean {
	if (!relPath || relPath.includes("\0")) return false;
	if (path.isAbsolute(relPath) || /^[a-zA-Z]:/.test(relPath) || relPath.startsWith("/") || relPath.startsWith("\\")) {
		return false;
	}
	return true;
}

function listMaterialsSubdirCourseIds(): string[] {
	const root = intensiveMaterialsRootDir();
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(/* turbopackIgnore: true */ root, { withFileTypes: true });
	} catch {
		return [];
	}
	const ids: string[] = [];
	for (const entry of entries) {
		if (entry.isDirectory() && isSafeIntensiveId(entry.name)) {
			ids.push(entry.name);
		}
	}
	return ids;
}

export function listKnownMaterialCourseIds(): string[] {
	return listMaterialsSubdirCourseIds();
}

export function courseHasTranscribedVideos(courseId: string): boolean {
	if (!isSafeIntensiveId(courseId)) return false;
	const transcriptsDir = intensiveCourseTranscriptsDir(courseId);
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(/* turbopackIgnore: true */ transcriptsDir, { withFileTypes: true });
	} catch {
		return false;
	}
	for (const entry of entries) {
		if (entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith(".")) {
			const lessonId = entry.name.slice(0, -".json".length);
			if (isSafeIntensiveId(lessonId)) return true;
		}
	}
	return false;
}

export function courseHasIndexedMaterials(courseId: string): boolean {
	if (!isSafeIntensiveId(courseId)) return false;
	const materialsDir = intensiveCourseMaterialsDir(courseId);
	const manifestPath = path.join(/* turbopackIgnore: true */ materialsDir, "manifest.json");
	const manifest = readJsonFileSync<Record<string, unknown>>(manifestPath);
	if (manifest && Array.isArray(manifest.materials) && manifest.materials.length > 0) {
		return true;
	}
	const extractedDir = intensiveCourseMaterialsExtractedDir(courseId);
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(/* turbopackIgnore: true */ extractedDir, { withFileTypes: true });
	} catch {
		return false;
	}
	for (const entry of entries) {
		if (entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith(".")) {
			const materialId = entry.name.slice(0, -".json".length);
			if (isSafeIntensiveId(materialId)) return true;
		}
	}
	return false;
}

function normalizeMaterialChunks(raw: unknown): MaterialTextChunk[] {
	if (!Array.isArray(raw)) return [];
	const out: MaterialTextChunk[] = [];
	for (let i = 0; i < raw.length; i += 1) {
		const item = raw[i];
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const obj = item as Record<string, unknown>;
		const text = typeof obj.text === "string" ? obj.text.trim() : "";
		if (!text) continue;
		const index =
			typeof obj.index === "number" && Number.isFinite(obj.index) && obj.index >= 0
				? Math.floor(obj.index)
				: i;
		const page =
			typeof obj.page === "number" && Number.isFinite(obj.page) && obj.page > 0
				? Math.floor(obj.page)
				: undefined;
		out.push({
			index,
			...(page !== undefined ? { page } : {}),
			text,
		});
	}
	return out;
}

function readMaterialManifestRaw(courseId: string): Record<string, unknown> | null {
	if (!isSafeIntensiveId(courseId)) return null;
	const filePath = path.join(
		/* turbopackIgnore: true */ intensiveCourseMaterialsDir(courseId),
		"manifest.json",
	);
	return readJsonFileSync<Record<string, unknown>>(filePath);
}

export function loadCourseMaterialsIndex(courseId: string): CourseMaterialsIndex {
	const empty: CourseMaterialsIndex = {
		courseId,
		totalFiles: 0,
		indexedTextFiles: 0,
		totalPages: 0,
		totalWordCount: 0,
		materials: [],
		recordsById: new Map(),
	};
	if (!isSafeIntensiveId(courseId)) return empty;

	const manifest = readMaterialManifestRaw(courseId);
	const recordsById = new Map<string, InternalMaterialRecord>();
	const materials: CourseMaterialSummary[] = [];

	if (manifest) {
		const rawMaterials = Array.isArray(manifest.materials) ? manifest.materials : [];
		for (const raw of rawMaterials) {
			if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
			const item = raw as Record<string, unknown>;
			const materialId = typeof item.materialId === "string" ? item.materialId.trim() : "";
			if (!materialId || !isSafeIntensiveId(materialId) || recordsById.has(materialId)) continue;

			const fileName =
				typeof item.fileName === "string" && item.fileName.trim()
					? item.fileName.trim()
					: typeof item.relativePath === "string" && item.relativePath.trim()
						? path.posix.basename(item.relativePath.replace(/\\/g, "/"))
						: materialId;
			const relativePath = normalizeRelativeMaterialPath(item.relativePath, fileName);
			const section =
				typeof item.section === "string" && item.section.trim()
					? item.section.trim()
					: (sectionFromRelativePath(relativePath) ?? "");
			const category = normalizeMaterialCategory(item.category, fileName);
			const title =
				typeof item.title === "string" && item.title.trim()
					? item.title.trim()
					: cleanHumanVideoTitle(fileName);
			const sizeBytes =
				typeof item.sizeBytes === "number" && Number.isFinite(item.sizeBytes) && item.sizeBytes >= 0
					? Math.floor(item.sizeBytes)
					: 0;
			const mtimeMs =
				typeof item.mtimeMs === "number" && Number.isFinite(item.mtimeMs) && item.mtimeMs >= 0
					? item.mtimeMs
					: 0;
			const pageCount =
				typeof item.pageCount === "number" && Number.isFinite(item.pageCount) && item.pageCount > 0
					? Math.floor(item.pageCount)
					: undefined;
			const wordCount =
				typeof item.wordCount === "number" && Number.isFinite(item.wordCount) && item.wordCount >= 0
					? Math.floor(item.wordCount)
					: undefined;
			const chunkCount =
				typeof item.chunkCount === "number" && Number.isFinite(item.chunkCount) && item.chunkCount >= 0
					? Math.floor(item.chunkCount)
					: undefined;
			const hasText =
				typeof item.hasText === "boolean"
					? item.hasText
					: (chunkCount !== undefined && chunkCount > 0) || (wordCount !== undefined && wordCount > 0);
			const extractedJson =
				typeof item.extractedJson === "string" && item.extractedJson.trim()
					? item.extractedJson.trim()
					: undefined;

			const summary: CourseMaterialSummary = {
				materialId,
				title,
				fileName,
				relativePath,
				section,
				category,
				sizeBytes,
				mtimeMs,
				...(pageCount !== undefined ? { pageCount } : {}),
				...(wordCount !== undefined ? { wordCount } : {}),
				...(chunkCount !== undefined ? { chunkCount } : {}),
				hasText,
			};

			recordsById.set(materialId, { summary, extractedJson });
			materials.push(summary);
		}

		const sourceDir =
			typeof manifest.sourceDir === "string" && manifest.sourceDir.trim()
				? manifest.sourceDir.trim()
				: undefined;
		const updatedAt =
			typeof manifest.updatedAt === "string" && manifest.updatedAt.trim()
				? manifest.updatedAt.trim()
				: undefined;

		const numOr = (val: unknown, def: number): number =>
			typeof val === "number" && Number.isFinite(val) && val >= 0 ? Math.floor(val) : def;

		const computedIndexed = materials.filter((m) => m.hasText).length;
		const computedPages = materials.reduce((sum, m) => sum + (m.pageCount ?? 0), 0);
		const computedWords = materials.reduce((sum, m) => sum + (m.wordCount ?? 0), 0);

		return {
			courseId,
			sourceDir,
			updatedAt,
			totalFiles: numOr(manifest.totalFiles, materials.length),
			indexedTextFiles: numOr(manifest.indexedTextFiles, computedIndexed),
			totalPages: numOr(manifest.totalPages, computedPages),
			totalWordCount: numOr(manifest.totalWordCount, computedWords),
			materials,
			recordsById,
		};
	}

	// Fallback if extracted/*.json exists without a manifest.json yet.
	const extractedDir = intensiveCourseMaterialsExtractedDir(courseId);
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(/* turbopackIgnore: true */ extractedDir, { withFileTypes: true });
	} catch {
		return empty;
	}

	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.startsWith(".")) continue;
		const materialId = entry.name.slice(0, -".json".length);
		if (!isSafeIntensiveId(materialId) || recordsById.has(materialId)) continue;
		const doc = readCourseMaterialDoc(courseId, materialId);
		if (!doc) continue;

		const summary: CourseMaterialSummary = {
			materialId: doc.materialId,
			title: doc.title,
			fileName: doc.fileName,
			relativePath: doc.relativePath,
			section: doc.section,
			category: doc.category,
			sizeBytes: doc.sizeBytes,
			mtimeMs: 0,
			...(doc.pageCount !== undefined ? { pageCount: doc.pageCount } : {}),
			wordCount: doc.wordCount,
			chunkCount: doc.chunks.length,
			hasText: doc.chunks.length > 0,
		};
		recordsById.set(materialId, { summary });
		materials.push(summary);
	}

	materials.sort((a, b) =>
		a.section !== b.section ? a.section.localeCompare(b.section) : a.title.localeCompare(b.title),
	);

	return {
		courseId,
		totalFiles: materials.length,
		indexedTextFiles: materials.filter((m) => m.hasText).length,
		totalPages: materials.reduce((sum, m) => sum + (m.pageCount ?? 0), 0),
		totalWordCount: materials.reduce((sum, m) => sum + (m.wordCount ?? 0), 0),
		materials,
		recordsById,
	};
}

export function readCourseMaterialDoc(
	courseId: string,
	materialId: string,
): CourseMaterialDoc | null {
	if (!isSafeIntensiveId(courseId) || !isSafeIntensiveId(materialId)) return null;

	const materialsDir = intensiveCourseMaterialsDir(courseId);
	const extractedDir = intensiveCourseMaterialsExtractedDir(courseId);
	const defaultPath = path.join(/* turbopackIgnore: true */ extractedDir, `${materialId}.json`);
	if (!isPathWithinDir(defaultPath, extractedDir)) return null;

	let absPath = defaultPath;
	let stat: fs.Stats | undefined;
	try {
		stat = fs.statSync(/* turbopackIgnore: true */ absPath, { throwIfNoEntry: false });
	} catch {
		stat = undefined;
	}

	if (!stat || !stat.isFile()) {
		// Check manifest's extractedJson field if present, strictly contained inside materialsDir.
		const manifest = readMaterialManifestRaw(courseId);
		const rawMaterials = manifest && Array.isArray(manifest.materials) ? manifest.materials : [];
		const match = rawMaterials.find(
			(item): item is Record<string, unknown> =>
				Boolean(item) &&
				typeof item === "object" &&
				!Array.isArray(item) &&
				(item as Record<string, unknown>).materialId === materialId,
		);
		const relExtracted =
			match && typeof match.extractedJson === "string" ? match.extractedJson.trim() : "";
		if (!relExtracted || !isSafeRelativeMaterialPath(relExtracted) || !relExtracted.endsWith(".json")) {
			return null;
		}
		const altPath = path.resolve(/* turbopackIgnore: true */ materialsDir, relExtracted);
		if (!isPathWithinDir(altPath, materialsDir)) return null;
		try {
			stat = fs.statSync(/* turbopackIgnore: true */ altPath, { throwIfNoEntry: false });
		} catch {
			return null;
		}
		if (!stat || !stat.isFile()) return null;
		absPath = altPath;
	}

	const stamp = `${stat.mtimeMs}|${stat.size}`;
	const cache = materialDocCache();
	const cached = cache.get(absPath);
	if (cached && cached.stamp === stamp) {
		return cached.doc;
	}

	const raw = readJsonFileSync<Record<string, unknown>>(absPath);
	if (!raw) return null;

	const chunks = normalizeMaterialChunks(raw.chunks);
	const fileName =
		typeof raw.fileName === "string" && raw.fileName.trim()
			? raw.fileName.trim()
			: typeof raw.relativePath === "string" && raw.relativePath.trim()
				? path.posix.basename(raw.relativePath.replace(/\\/g, "/"))
				: `${materialId}.pdf`;
	const relativePath = normalizeRelativeMaterialPath(raw.relativePath, fileName);
	const section =
		typeof raw.section === "string" && raw.section.trim()
			? raw.section.trim()
			: (sectionFromRelativePath(relativePath) ?? "");
	const category = normalizeMaterialCategory(raw.category, fileName);
	const pageCount =
		typeof raw.pageCount === "number" && Number.isFinite(raw.pageCount) && raw.pageCount > 0
			? Math.floor(raw.pageCount)
			: undefined;
	const wordCount =
		typeof raw.wordCount === "number" && Number.isFinite(raw.wordCount) && raw.wordCount >= 0
			? Math.floor(raw.wordCount)
			: chunks.reduce((sum, c) => sum + c.text.split(/\s+/).filter(Boolean).length, 0);

	const doc: CourseMaterialDoc = {
		schemaVersion: 1,
		courseId: typeof raw.courseId === "string" && raw.courseId.trim() ? raw.courseId.trim() : courseId,
		materialId:
			typeof raw.materialId === "string" && raw.materialId.trim()
				? raw.materialId.trim()
				: materialId,
		title:
			typeof raw.title === "string" && raw.title.trim()
				? raw.title.trim()
				: cleanHumanVideoTitle(fileName),
		fileName,
		relativePath,
		section,
		category,
		sizeBytes:
			typeof raw.sizeBytes === "number" && Number.isFinite(raw.sizeBytes) && raw.sizeBytes >= 0
				? Math.floor(raw.sizeBytes)
				: 0,
		...(pageCount !== undefined ? { pageCount } : {}),
		wordCount,
		extractedAt: typeof raw.extractedAt === "string" ? raw.extractedAt : "",
		chunks,
	};

	if (cache.size >= MAX_MATERIAL_CACHE_ENTRIES && !cache.has(absPath)) {
		const oldestKey = cache.keys().next().value;
		if (oldestKey !== undefined) cache.delete(oldestKey);
	}
	cache.set(absPath, { stamp, doc });
	return doc;
}

export function loadAllCourseMaterialDocs(courseId: string): CourseMaterialDoc[] {
	if (!isSafeIntensiveId(courseId)) return [];

	const seen = new Set<string>();
	const docs: CourseMaterialDoc[] = [];

	const idx = loadCourseMaterialsIndex(courseId);
	for (const mat of idx.materials) {
		if (seen.has(mat.materialId)) continue;
		const doc = readCourseMaterialDoc(courseId, mat.materialId);
		if (doc) {
			seen.add(mat.materialId);
			docs.push(doc);
		}
	}

	const extractedDir = intensiveCourseMaterialsExtractedDir(courseId);
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(/* turbopackIgnore: true */ extractedDir, { withFileTypes: true });
	} catch {
		return docs;
	}

	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.startsWith(".")) continue;
		const materialId = entry.name.slice(0, -".json".length);
		if (!isSafeIntensiveId(materialId) || seen.has(materialId)) continue;
		const doc = readCourseMaterialDoc(courseId, materialId);
		if (doc) {
			seen.add(materialId);
			docs.push(doc);
		}
	}

	return docs;
}

/**
 * Safely resolves the raw on-disk material file (PDF/image/doc/etc.) for a course.
 * Never accepts raw paths from callers; verifies `isPathWithinDir` against BOTH
 * `<PATHS.data>/intensive/materials/<courseId>/files` and `manifest.sourceDir`.
 */
export function resolveCourseMaterialFile(
	courseId: string,
	materialId: string,
): ResolvedMediaFile | null {
	if (!isSafeIntensiveId(courseId) || !isSafeIntensiveId(materialId)) return null;

	const idx = loadCourseMaterialsIndex(courseId);
	const record = idx.recordsById.get(materialId);
	if (!record) return null;

	const relPath = record.summary.relativePath;
	if (!isSafeRelativeMaterialPath(relPath)) return null;

	const roots: string[] = [intensiveCourseMaterialsFilesDir(courseId)];
	if (idx.sourceDir) {
		roots.push(path.resolve(/* turbopackIgnore: true */ idx.sourceDir));
	}

	for (const rootDir of roots) {
		const candidate = path.resolve(/* turbopackIgnore: true */ rootDir, relPath);
		if (!isPathWithinDir(candidate, rootDir)) continue;

		try {
			const st = fs.statSync(/* turbopackIgnore: true */ candidate, { throwIfNoEntry: false });
			if (!st || !st.isFile()) continue;
			const ext = path.extname(candidate).toLowerCase();
			const contentType = MATERIAL_CONTENT_TYPES[ext] ?? "application/octet-stream";
			return {
				absPath: candidate,
				contentType,
				size: st.size,
				fileName: path.basename(candidate),
			};
		} catch {
			continue;
		}
	}

	return null;
}
