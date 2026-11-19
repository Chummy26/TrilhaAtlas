/**
 * Transcript cues → 20–90 s segments for the synced transcript panel and for
 * video RAG (SÍNTESE §2.8 "transcrição sincronizada … segmentos de 20–90 s
 * (port de build_segments do [dt])"; r6 §4.2, §8.1; extra-LuanRT §6.6).
 *
 * Port of DeepTutor `video_learning/service.py` (Apache-2.0):
 *   normalize_cues — entity-decoded, whitespace-collapsed cues, capped at
 *                    20 000 cues / 2 MiB of text;
 *   build_segments — merge the next cue into the current segment while the
 *                    merged length stays < 90 s AND the gap ≤ 4 s AND NOT
 *                    (the current segment alone is ≥ 20 s and ends a
 *                    sentence).
 * Addition (documented): a final pass folds a segment shorter than 20 s into
 * its predecessor when the gap ≤ 4 s and the merged span stays ≤ 90 s, so
 * short tails do not become separate panel rows. A single cue longer than
 * 90 s stays alone (never split mid-cue).
 *
 * Also here: timedtext parsers (json3 — the path that works since Dec/2025;
 * srv3 and legacy XML as fallbacks) and chapter timestamps from a video
 * description (`^(h:)?m:ss title$`, r6 §8.1 step 2).
 *
 * Pure: browser-safe.
 */

export const MIN_SEGMENT_SECONDS = 20;
export const MAX_SEGMENT_SECONDS = 90;
export const MAX_GAP_SECONDS = 4;
export const MAX_TRANSCRIPT_CUES = 20_000;
export const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024;

export interface Cue {
	/** Seconds. */
	start: number;
	end: number;
	text: string;
}

export interface TranscriptSegment extends Cue {
	/** 1-based position (DeepTutor `locator`). */
	locator: number;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = Object.freeze({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" });

/** Decode the HTML entities timedtext emits (&amp; &#39; &#NNN; &#xHH;). */
export function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (match, body: string) => {
		const lower = body.toLowerCase();
		if (lower.startsWith("#x")) {
			const code = Number.parseInt(lower.slice(2), 16);
			return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match;
		}
		if (lower.startsWith("#")) {
			const code = Number.parseInt(lower.slice(1), 10);
			return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match;
		}
		return NAMED_ENTITIES[lower] ?? match;
	});
}

/** DeepTutor clean_transcript_text: entities decoded, whitespace collapsed. */
export function cleanTranscriptText(value: unknown): string {
	return decodeEntities(String(value ?? ""))
		.replace(/\s+/g, " ")
		.trim();
}

export interface RawCue {
	start?: number | string;
	end?: number | string;
	duration?: number | string;
	from?: number | string;
	to?: number | string;
	text?: string;
	content?: string;
}

function num(x: unknown): number {
	const n = typeof x === "number" ? x : typeof x === "string" ? Number.parseFloat(x) : Number.NaN;
	return Number.isFinite(n) ? n : 0;
}

/** Port of normalize_cues: drops empty text, fixes end ≤ start, caps size. */
export function normalizeCues(rows: readonly RawCue[]): Cue[] {
	const out: Cue[] = [];
	let totalBytes = 0;
	const encoder = new TextEncoder();
	for (const row of rows.slice(0, MAX_TRANSCRIPT_CUES)) {
		const text = cleanTranscriptText(row.text ?? row.content ?? "");
		if (!text) continue;
		const bytes = encoder.encode(text).length;
		if (totalBytes + bytes > MAX_TRANSCRIPT_BYTES) break;
		const start = Math.max(0, num(row.start ?? row.from));
		let end = num(row.end ?? row.to);
		if (end <= start) end = start + Math.max(0, num(row.duration));
		out.push({ start, end: Math.max(start, end), text });
		totalBytes += bytes;
	}
	return out;
}

const SENTENCE_END = /[.!?。！？]$/;

/** Port of build_segments + the short-tail fold (see header). Input must be time-ordered. */
export function buildSegments(cues: readonly Cue[]): TranscriptSegment[] {
	const segments: Cue[] = [];
	let current: Cue | null = null;
	for (const cue of cues) {
		if (current === null) {
			current = { ...cue };
			continue;
		}
		const gap = Math.max(0, cue.start - current.end);
		const merged = cue.end - current.start;
		// The 20 s floor is about the CURRENT segment: a sentence end only closes
		// a segment that is already ≥ 20 s (checking the merged length instead
		// cut 15-s segments whenever the next cue crossed 20 s).
		const currentLength = current.end - current.start;
		const sentenceEnd = SENTENCE_END.test(current.text.trimEnd());
		if (merged < MAX_SEGMENT_SECONDS && gap <= MAX_GAP_SECONDS && !(currentLength >= MIN_SEGMENT_SECONDS && sentenceEnd)) {
			current.end = Math.max(current.end, cue.end);
			current.text = `${current.text} ${cue.text}`.trim();
		} else {
			segments.push(current);
			current = { ...cue };
		}
	}
	if (current !== null) segments.push(current);

	const folded: Cue[] = [];
	for (const seg of segments) {
		const prev = folded[folded.length - 1];
		if (prev && seg.end - seg.start < MIN_SEGMENT_SECONDS && seg.start - prev.end <= MAX_GAP_SECONDS && seg.end - prev.start <= MAX_SEGMENT_SECONDS) {
			prev.end = Math.max(prev.end, seg.end);
			prev.text = `${prev.text} ${seg.text}`.trim();
		} else {
			folded.push({ ...seg });
		}
	}
	return folded.map((s, i) => ({ ...s, locator: i + 1 }));
}

/** The segment playing at time t (binary search; null outside every segment). */
export function segmentAt(segments: readonly TranscriptSegment[], t: number): TranscriptSegment | null {
	let lo = 0;
	let hi = segments.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const s = segments[mid]!;
		if (t < s.start) hi = mid - 1;
		else if (t >= s.end && !(t === s.end && mid === segments.length - 1)) lo = mid + 1;
		else return s;
	}
	return null;
}

/** Segments overlapping [startSec, endSec). */
export function segmentsInRange(segments: readonly TranscriptSegment[], startSec: number, endSec: number): TranscriptSegment[] {
	return segments.filter((s) => s.end > startSec && s.start < endSec);
}

// ─── timedtext parsers ───────────────────────────────────────────────────────

export interface Json3Transcript {
	events?: Array<{ tStartMs?: number; dDurationMs?: number; aAppend?: number; segs?: Array<{ utf8?: string; tOffsetMs?: number }> }>;
}

/** json3 → cues. "\n"-only ASR events (aAppend) are line breaks and dropped. */
export function parseJson3(data: Json3Transcript): Cue[] {
	const rows: RawCue[] = [];
	for (const e of data.events ?? []) {
		const text = (e.segs ?? []).map((s) => s.utf8 ?? "").join("");
		if (!text.trim()) continue;
		const startMs = e.tStartMs ?? 0;
		rows.push({ start: startMs / 1000, end: (startMs + (e.dDurationMs ?? 0)) / 1000, text });
	}
	return normalizeCues(rows);
}

/** srv3 XML (`<p t="ms" d="ms">…<s>word</s></p>`) → cues. */
export function parseSrv3(xml: string): Cue[] {
	const rows: RawCue[] = [];
	const re = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
	for (const m of xml.matchAll(re)) {
		const attrs = m[1] ?? "";
		const t = Number(attrs.match(/\bt="(\d+)"/)?.[1] ?? Number.NaN);
		const d = Number(attrs.match(/\bd="(\d+)"/)?.[1] ?? 0);
		if (!Number.isFinite(t)) continue;
		rows.push({ start: t / 1000, end: (t + d) / 1000, text: (m[2] ?? "").replace(/<[^>]+>/g, "") });
	}
	return normalizeCues(rows);
}

/** Legacy `<transcript><text start="s" dur="s">` → cues. */
export function parseLegacyTimedText(xml: string): Cue[] {
	const rows: RawCue[] = [];
	for (const m of xml.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
		const attrs = m[1] ?? "";
		const start = Number(attrs.match(/\bstart="([\d.]+)"/)?.[1] ?? Number.NaN);
		const dur = Number(attrs.match(/\bdur="([\d.]+)"/)?.[1] ?? 0);
		if (!Number.isFinite(start)) continue;
		rows.push({ start, duration: dur, text: (m[2] ?? "").replace(/<[^>]+>/g, "") });
	}
	return normalizeCues(rows);
}

/** Dispatch on body shape: JSON → json3, `<timedtext` → srv3, `<transcript` → legacy. */
export function parseTimedText(body: string): Cue[] {
	const trimmed = body.trimStart();
	if (!trimmed) return [];
	if (trimmed.startsWith("{")) {
		try {
			return parseJson3(JSON.parse(trimmed) as Json3Transcript);
		} catch {
			throw new Error("Transcrição em json3 inválida (JSON malformado).");
		}
	}
	if (/<timedtext\b/.test(trimmed) || /<p\b[^>]*\bt="/.test(trimmed)) return parseSrv3(trimmed);
	if (/<transcript\b/.test(trimmed) || /<text\b[^>]*\bstart="/.test(trimmed)) return parseLegacyTimedText(trimmed);
	throw new Error("Formato de transcrição não reconhecido.");
}

// ─── chapters ────────────────────────────────────────────────────────────────

export interface Chapter {
	startSec: number;
	title: string;
}

/** "1:02:03" | "12:34" → seconds; NaN when malformed. */
export function timestampToSeconds(ts: string): number {
	const parts = ts.split(":").map((p) => Number(p));
	if (parts.length < 2 || parts.length > 3 || parts.some((p) => !Number.isInteger(p) || p < 0)) return Number.NaN;
	return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/**
 * Chapters from description lines `^(h:)?m:ss title$`. YouTube only treats a
 * list as chapters when it starts at 0:00 and has ≥3 ascending entries; the
 * same rule is applied here so random timestamps are ignored.
 */
export function parseDescriptionChapters(description: string): Chapter[] {
	const out: Chapter[] = [];
	for (const line of description.split(/\r?\n/)) {
		const m = line.trim().match(/^((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[-–—:|]?\s+(.+)$/);
		if (!m?.[1] || !m[2]) continue;
		const startSec = timestampToSeconds(m[1]);
		if (!Number.isFinite(startSec)) continue;
		out.push({ startSec, title: m[2].trim() });
	}
	if (out.length < 3 || out[0]!.startSec !== 0) return [];
	for (let i = 1; i < out.length; i++) if (out[i]!.startSec <= out[i - 1]!.startSec) return [];
	return out;
}

/** Group segments under chapters (each segment goes to the chapter containing its start). */
export function segmentsByChapter(segments: readonly TranscriptSegment[], chapters: readonly Chapter[]): Array<{ chapter: Chapter; endSec: number; segments: TranscriptSegment[] }> {
	if (chapters.length === 0) return [];
	const lastEnd = segments.length ? segments[segments.length - 1]!.end : chapters[chapters.length - 1]!.startSec;
	return chapters.map((chapter, i) => {
		const endSec = chapters[i + 1]?.startSec ?? Math.max(lastEnd, chapter.startSec);
		return { chapter, endSec, segments: segments.filter((s) => s.start >= chapter.startSec && s.start < endSec) };
	});
}
