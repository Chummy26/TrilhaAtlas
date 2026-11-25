/**
 * Pure, fast Portuguese/English accent-insensitive tokenizer, BM25-like
 * transcript passage scorer, timestamp formatter, and bounded AI-Tutor
 * window extractor.
 *
 * ZERO Node builtins, ZERO filesystem/network I/O.
 */

import type {
	IntensiveSearchHit,
	TranscriptChunk,
	TranscriptSegment,
} from "./types.ts";

const STOPWORDS = new Set([
	// Portuguese common glue words
	"a",
	"o",
	"e",
	"de",
	"da",
	"do",
	"das",
	"dos",
	"em",
	"no",
	"na",
	"nos",
	"nas",
	"um",
	"uma",
	"para",
	"por",
	"com",
	"sem",
	"que",
	"se",
	"ao",
	"os",
	"as",
	"ou",
	"como",
	"mais",
	"mas",
	"foi",
	"sao",
	"ser",
	"esta",
	"esse",
	"essa",
	"isso",
	"aqui",
	"entao",
	"voce",
	// English common glue words
	"the",
	"and",
	"for",
	"with",
	"that",
	"this",
	"from",
	"are",
	"was",
	"were",
	"have",
	"has",
	"not",
	"but",
	"into",
	"about",
	"can",
	"will",
]);

const BM25_K1 = 1.5;
const BM25_B = 0.75;
const DEFAULT_AVG_DOC_TOKENS = 90;
const TITLE_BOOST_WEIGHT = 2.5;

/**
 * Normalizes PT-BR/EN text while preserving electronics compound technical
 * tokens such as `4-20ma`, `op-amp`, `rs-485`, `usb-c`, `stm32`, `mosfet`,
 * `bga`, `smps`, `ceta`, `noc 22311`, `kicad`, `ipc-a-610`.
 */
export function normalizeSearchText(text: string): string {
	if (!text) return "";

	const stripped = text
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		// Normalize Unicode dashes (en-dash, em-dash, minus) to ASCII hyphen
		.replace(/[\u2010-\u2015\u2212]/g, "-")
		// Keep ASCII alphanumerics and hyphens; turn all other punctuation into spaces
		.replace(/[^a-z0-9-]+/g, " ")
		// Remove leading/trailing/repeated hyphens that are not connecting two alphanumerics
		.replace(/(^|\s)-+(?=\s|$)/g, " ")
		.replace(/(^|\s)-+(?=[a-z0-9])/g, " ")
		.replace(/(?<=[a-z0-9])-+(?=\s|$)/g, " ")
		.replace(/-{2,}/g, "-")
		.replace(/\s+/g, " ")
		.trim();

	return stripped;
}

/**
 * Tokenizes a query or document string into normalized searchable tokens.
 * Preserves compound hyphenated terms (e.g., `4-20ma`, `op-amp`).
 */
export function tokenizeSearchText(text: string): string[] {
	const normalized = normalizeSearchText(text);
	if (!normalized) return [];
	return normalized.split(" ").filter(Boolean);
}

/**
 * Builds term frequency map for a document text, indexing both exact tokens
 * and split sub-parts of hyphenated technical tokens (so `op amp` matches
 * `op-amp` and `20ma` matches `4-20ma`).
 */
function buildTermFrequencyMap(normalizedText: string): {
	tf: Map<string, number>;
	tokenCount: number;
} {
	const tf = new Map<string, number>();
	if (!normalizedText) return { tf, tokenCount: 0 };

	const rawTokens = normalizedText.split(" ").filter(Boolean);
	for (const token of rawTokens) {
		tf.set(token, (tf.get(token) ?? 0) + 1);
		if (token.includes("-")) {
			// Also index collapsed variant (opamp) and split parts (op, amp)
			const collapsed = token.replace(/-/g, "");
			if (collapsed && collapsed !== token) {
				tf.set(collapsed, (tf.get(collapsed) ?? 0) + 1);
			}
			const parts = token.split("-").filter(Boolean);
			for (const part of parts) {
				tf.set(part, (tf.get(part) ?? 0) + 1);
			}
		}
	}

	return { tf, tokenCount: rawTokens.length };
}

function getEffectiveQueryTokens(queryTokens: string[]): string[] {
	const cleaned = queryTokens
		.map((t) => normalizeSearchText(t))
		.filter(Boolean);
	if (cleaned.length === 0) return [];

	// Drop stopwords only when meaningful content tokens remain.
	const nonStop = cleaned.filter((t) => !STOPWORDS.has(t) || t.length >= 4);
	return nonStop.length > 0 ? nonStop : cleaned;
}

function countTokenMatches(
	token: string,
	tf: Map<string, number>,
	normalizedText: string,
): number {
	const exact = tf.get(token);
	if (exact !== undefined && exact > 0) return exact;

	if (token.includes("-")) {
		const collapsed = tf.get(token.replace(/-/g, ""));
		if (collapsed !== undefined && collapsed > 0) return collapsed;
		const spaced = token.replace(/-/g, " ");
		if (normalizedText.includes(spaced)) return 1;
	}

	// Prefix/substring match for longer technical terms (e.g., "transist" -> "transistor", "osciloscop" -> "osciloscopio").
	if (token.length >= 4) {
		let prefixHits = 0;
		for (const [docToken, freq] of tf.entries()) {
			if (docToken.startsWith(token) || (token.length >= 5 && docToken.includes(token))) {
				prefixHits += freq * 0.75;
			}
		}
		if (prefixHits > 0) return prefixHits;
	}

	return 0;
}

/**
 * Pure BM25-like relevance scorer for a single passage, with optional title /
 * Telegram caption boost. Returns 0 when no query token matches.
 */
export function scoreTextMatch(
	queryTokens: string[],
	text: string,
	titleBoostText?: string,
	idfMap?: Map<string, number>,
	avgDocTokens: number = DEFAULT_AVG_DOC_TOKENS,
): number {
	const effectiveTokens = getEffectiveQueryTokens(queryTokens);
	if (effectiveTokens.length === 0) return 0;

	const uniqueTokens = Array.from(new Set(effectiveTokens));
	const normBody = normalizeSearchText(text);
	const normTitle = titleBoostText ? normalizeSearchText(titleBoostText) : "";
	if (!normBody && !normTitle) return 0;

	const bodyStats = buildTermFrequencyMap(normBody);
	const titleStats = buildTermFrequencyMap(normTitle);
	const safeAvgLen = Math.max(10, avgDocTokens);

	let score = 0;
	let matchedDistinct = 0;

	for (const token of uniqueTokens) {
		const idf = idfMap?.get(token) ?? (STOPWORDS.has(token) ? 0.4 : 1.5);
		const bodyFreq = countTokenMatches(token, bodyStats.tf, normBody);
		const titleFreq = normTitle
			? countTokenMatches(token, titleStats.tf, normTitle)
			: 0;

		if (bodyFreq <= 0 && titleFreq <= 0) continue;
		matchedDistinct += 1;

		if (bodyFreq > 0) {
			const normFactor =
				1 - BM25_B + BM25_B * (bodyStats.tokenCount / safeAvgLen);
			const bm25Term =
				(bodyFreq * (BM25_K1 + 1)) / (bodyFreq + BM25_K1 * normFactor);
			score += idf * bm25Term;
		}

		if (titleFreq > 0) {
			const titleTerm = (titleFreq * (BM25_K1 + 1)) / (titleFreq + BM25_K1);
			score += idf * titleTerm * TITLE_BOOST_WEIGHT;
		}
	}

	if (matchedDistinct === 0) return 0;

	// Coverage multiplier rewards passages covering more distinct query terms.
	const coverageRatio = matchedDistinct / uniqueTokens.length;
	score *= 0.65 + 0.85 * coverageRatio;

	// Exact contiguous phrase bonus for multi-word queries (e.g., "noc 22311", "fonte chaveada").
	if (effectiveTokens.length >= 2) {
		const phrase = effectiveTokens.join(" ");
		if (normTitle.includes(phrase)) {
			score += 3.5;
		} else if (normBody.includes(phrase)) {
			score += 2.0;
		}
	}

	return Math.round(score * 1000) / 1000;
}

export interface SearchableTranscriptDoc {
	courseId: string;
	courseTitle: string;
	lessonId: string;
	lessonTitle: string;
	order: number;
	chunks: TranscriptChunk[];
	telegramCaption?: string;
}

function buildSnippet(rawText: string, queryTokens: string[], maxLen = 240): string {
	const cleaned = rawText.replace(/\s+/g, " ").trim();
	if (cleaned.length <= maxLen) return cleaned;

	const normLower = normalizeSearchText(cleaned);
	let bestIdx = -1;
	for (const token of queryTokens) {
		const pos = normLower.indexOf(token);
		if (pos !== -1 && (bestIdx === -1 || pos < bestIdx)) {
			bestIdx = pos;
		}
	}

	if (bestIdx < 0) {
		return `${cleaned.slice(0, maxLen - 1).trimEnd()}…`;
	}

	// Approximate index back onto cleaned text (same length modulo rare multi-codepoint chars).
	const approxOrigin = Math.min(cleaned.length - 1, bestIdx);
	const start = Math.max(0, approxOrigin - Math.floor(maxLen * 0.35));
	const end = Math.min(cleaned.length, start + maxLen);

	const prefix = start > 0 ? "…" : "";
	const suffix = end < cleaned.length ? "…" : "";
	return `${prefix}${cleaned.slice(start, end).trim()}${suffix}`;
}

export function searchTranscriptChunks(
	query: string,
	docs: SearchableTranscriptDoc[],
	limit: number = 20,
): IntensiveSearchHit[] {
	const rawTokens = tokenizeSearchText(query);
	const effectiveTokens = getEffectiveQueryTokens(rawTokens);
	if (effectiveTokens.length === 0 || docs.length === 0 || limit <= 0) {
		return [];
	}

	const uniqueTokens = Array.from(new Set(effectiveTokens));

	// Pass 1: compute corpus statistics (total chunks, average length, document frequency for IDF).
	let totalChunks = 0;
	let totalTokenLen = 0;
	const df = new Map<string, number>();

	interface PreparedChunk {
		doc: SearchableTranscriptDoc;
		chunk: TranscriptChunk;
		titleBoost: string;
		normBody: string;
		normTitle: string;
		bodyTf: Map<string, number>;
		titleTf: Map<string, number>;
	}

	const prepared: PreparedChunk[] = [];

	for (const doc of docs) {
		const titleBoost = doc.telegramCaption
			? `${doc.lessonTitle} ${doc.telegramCaption}`
			: doc.lessonTitle;
		const normTitle = normalizeSearchText(titleBoost);
		const titleStats = buildTermFrequencyMap(normTitle);

		for (const chunk of doc.chunks) {
			totalChunks += 1;
			const normBody = normalizeSearchText(chunk.text);
			const bodyStats = buildTermFrequencyMap(normBody);
			totalTokenLen += bodyStats.tokenCount;

			for (const token of uniqueTokens) {
				if (
					countTokenMatches(token, bodyStats.tf, normBody) > 0 ||
					countTokenMatches(token, titleStats.tf, normTitle) > 0
				) {
					df.set(token, (df.get(token) ?? 0) + 1);
				}
			}

			prepared.push({
				doc,
				chunk,
				titleBoost,
				normBody,
				normTitle,
				bodyTf: bodyStats.tf,
				titleTf: titleStats.tf,
			});
		}
	}

	if (totalChunks === 0) return [];

	const avgDocTokens = Math.max(10, totalTokenLen / totalChunks);
	const idfMap = new Map<string, number>();
	for (const token of uniqueTokens) {
		const docFreq = df.get(token) ?? 0;
		const idf = Math.log(1 + (totalChunks - docFreq + 0.5) / (docFreq + 0.5));
		idfMap.set(token, Math.max(0.25, idf));
	}

	// Pass 2: score and collect hits.
	const hits: IntensiveSearchHit[] = [];
	for (const item of prepared) {
		const score = scoreTextMatch(
			effectiveTokens,
			item.chunk.text,
			item.titleBoost,
			idfMap,
			avgDocTokens,
		);
		if (score <= 0) continue;

		const matchedTokens = uniqueTokens.filter(
			(token) =>
				countTokenMatches(token, item.bodyTf, item.normBody) > 0 ||
				countTokenMatches(token, item.titleTf, item.normTitle) > 0,
		);

		hits.push({
			courseId: item.doc.courseId,
			courseTitle: item.doc.courseTitle,
			lessonId: item.doc.lessonId,
			lessonTitle: item.doc.lessonTitle,
			order: item.doc.order,
			chunkIndex: item.chunk.index,
			startSec: item.chunk.start,
			endSec: item.chunk.end,
			timestampLabel: formatTimestamp(item.chunk.start),
			snippet: buildSnippet(item.chunk.text, matchedTokens),
			matchedText: item.chunk.text,
			score,
			matchedTokens,
			telegramCaption: item.doc.telegramCaption,
		});
	}

	hits.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		if (a.order !== b.order) return a.order - b.order;
		return a.startSec - b.startSec;
	});

	return hits.slice(0, limit);
}

/**
 * Formats seconds as `MM:SS` (under 1 hour) or `HH:MM:SS` (1 hour and above).
 */
export function formatTimestamp(sec: number): string {
	const safeSec = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
	const hours = Math.floor(safeSec / 3600);
	const minutes = Math.floor((safeSec % 3600) / 60);
	const seconds = safeSec % 60;

	const mm = String(minutes).padStart(2, "0");
	const ss = String(seconds).padStart(2, "0");

	if (hours > 0) {
		const hh = String(hours).padStart(2, "0");
		return `${hh}:${mm}:${ss}`;
	}
	return `${mm}:${ss}`;
}

/**
 * Extracts a bounded, chronological transcript excerpt centered on `centerSec`
 * for AI Tutor injection when the learner pauses or asks a question at a video
 * moment. Prioritizes segments closest to `centerSec` so the paused moment is
 * never truncated out even under tight `maxChars` budgets.
 */
export function extractWindowAroundTimestamp(
	segments: TranscriptSegment[],
	centerSec: number,
	windowSec: number = 90,
	maxChars: number = 4000,
): string {
	if (!segments || segments.length === 0 || maxChars <= 0) return "";

	const safeCenter = Number.isFinite(centerSec) && centerSec > 0 ? centerSec : 0;
	const safeWindow = Number.isFinite(windowSec) && windowSec > 0 ? windowSec : 90;
	const minSec = Math.max(0, safeCenter - safeWindow);
	const maxSec = safeCenter + safeWindow;

	const ordered = [...segments].sort((a, b) =>
		a.start !== b.start ? a.start - b.start : a.id - b.id,
	);

	let candidates = ordered.filter(
		(seg) => seg.end >= minSec && seg.start <= maxSec && seg.text.trim().length > 0,
	);

	if (candidates.length === 0) {
		// Fallback to nearest non-empty segments if the timestamp falls in a silent gap.
		const nonEmpty = ordered.filter((seg) => seg.text.trim().length > 0);
		if (nonEmpty.length === 0) return "";
		candidates = nonEmpty;
	}

	const distToCenter = (seg: TranscriptSegment): number => {
		if (safeCenter >= seg.start && safeCenter <= seg.end) return 0;
		return Math.min(Math.abs(seg.start - safeCenter), Math.abs(seg.end - safeCenter));
	};

	// Sort candidates by proximity to the paused moment so we keep the closest context first.
	const byProximity = [...candidates].sort((a, b) => {
		const da = distToCenter(a);
		const db = distToCenter(b);
		return da !== db ? da - db : a.start - b.start;
	});

	const selected: Array<{ seg: TranscriptSegment; line: string }> = [];
	let currentChars = 0;

	for (const seg of byProximity) {
		const cleanText = seg.text.replace(/\s+/g, " ").trim();
		if (!cleanText) continue;
		const line = `[${formatTimestamp(seg.start)}] ${cleanText}`;
		const addedLen = selected.length === 0 ? line.length : line.length + 1;

		if (currentChars + addedLen > maxChars) {
			if (selected.length === 0) {
				// Always include at least the closest line truncated to maxChars.
				selected.push({
					seg,
					line:
						line.length > maxChars
							? `${line.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`
							: line,
				});
			}
			break;
		}

		selected.push({ seg, line });
		currentChars += addedLen;
	}

	selected.sort((a, b) =>
		a.seg.start !== b.seg.start ? a.seg.start - b.seg.start : a.seg.id - b.seg.id,
	);

	return selected.map((item) => item.line).join("\n");
}
