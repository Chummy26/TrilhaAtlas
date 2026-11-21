import type { ModelCatalogEntry } from "../contracts/models.ts";

export type RecencyComparableModel = Pick<ModelCatalogEntry, "id" | "name" | "releaseDate">;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse an embedded release date from a model ID (YYYY-MM-DD, YYYYMMDD, or MM-YYYY) into YYYYMMDD. */
export function extractEmbeddedDateScore(id: string): number {
	const iso = /(?:^|[^0-9])(20\d{2})[-_](\d{2})[-_](\d{2})(?:$|[^0-9])/.exec(id);
	if (iso) {
		const y = Number(iso[1]);
		const m = Number(iso[2]);
		const d = Number(iso[3]);
		if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return y * 10_000 + m * 100 + d;
	}
	const compact = /(?:^|[^0-9])(20\d{2})(\d{2})(\d{2})(?:$|[^0-9])/.exec(id);
	if (compact) {
		const y = Number(compact[1]);
		const m = Number(compact[2]);
		const d = Number(compact[3]);
		if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return y * 10_000 + m * 100 + d;
	}
	const monthYear = /(?:^|[^0-9])(\d{2})[-_](20\d{2})(?:$|[^0-9])/.exec(id);
	if (monthYear) {
		const m = Number(monthYear[1]);
		const y = Number(monthYear[2]);
		if (m >= 1 && m <= 12) return y * 10_000 + m * 100;
	}
	return 0;
}

/** Extract primary semantic version numbers (e.g. "gemini-3.8-flash" -> [3, 8], "gpt-6.2-sol" -> [6, 2]). */
export function extractModelVersion(id: string): number[] {
	const slug = (id.includes("/") ? id.slice(id.indexOf("/") + 1) : id).toLowerCase();
	// Strip known dates, parameter counts (e.g. 26b, 31b, 235b, 128k), and trailing revision codes.
	const cleaned = slug
		.replace(/20\d{2}[-_]?\d{2}(?:[-_]?\d{2})?/g, " ")
		.replace(/(?:^|[-_])\d{2}[-_]20\d{2}(?=$|[-_])/g, " ")
		.replace(/\b\d+(?:\.\d+)?[bmk]\b/g, " ")
		.replace(/(?:^|[-_])a\d+b(?=$|[-_])/g, " ")
		.replace(/(?:^|[-_])0\d{2,3}(?=$|[-_])/g, " ");

	// Match dotted version like 3.8 / 4.6 / 5.4 / 6.2 or family+digit like gemini-4 / claude-opus-4-6 / qwen3.
	const dotted = /(?:^|[-_a-z])(\d{1,2})\.(\d{1,2})(?:\.(\d{1,2}))?(?=$|[-_a-z])/.exec(cleaned);
	if (dotted) {
		const parts = [Number(dotted[1]), Number(dotted[2])];
		if (dotted[3] !== undefined) parts.push(Number(dotted[3]));
		return parts;
	}
	const hyphenMinor = /(?:^|[-_a-z])(\d{1,2})-(\d{1,2})(?=$|[-_a-z])/.exec(cleaned);
	if (hyphenMinor) {
		return [Number(hyphenMinor[1]), Number(hyphenMinor[2])];
	}
	const single = /(?:^|[-_a-z])(\d{1,2})(?=$|[-_a-z])/.exec(cleaned);
	if (single) {
		return [Number(single[1]), 0];
	}
	return [];
}

function compareVersionsDesc(a: readonly number[], b: readonly number[]): number {
	const len = Math.max(a.length, b.length);
	for (let i = 0; i < len; i++) {
		const av = a[i] ?? 0;
		const bv = b[i] ?? 0;
		if (av !== bv) return bv - av;
	}
	return 0;
}

/**
 * Sort models most-recent first:
 *  1. Known ISO release dates descending (when both entries carry one).
 *  2. Embedded date stamps in model IDs descending.
 *  3. Model generation/version tuple descending (e.g. 4 > 3.8 > 3.5 > 2.5).
 *  4. Presence of releaseDate (dated ahead of undated on equal version).
 *  5. Deterministic alphabetical tiebreaker.
 */
export function compareModelsByRecency(a: RecencyComparableModel, b: RecencyComparableModel): number {
	const aDate = a.releaseDate && ISO_DATE_RE.test(a.releaseDate) ? a.releaseDate : undefined;
	const bDate = b.releaseDate && ISO_DATE_RE.test(b.releaseDate) ? b.releaseDate : undefined;
	if (aDate && bDate && aDate !== bDate) {
		return bDate.localeCompare(aDate);
	}

	const aVersion = extractModelVersion(a.id);
	const bVersion = extractModelVersion(b.id);
	if (aVersion.length > 0 && bVersion.length > 0) {
		const verDelta = compareVersionsDesc(aVersion, bVersion);
		if (verDelta !== 0) return verDelta;
	}

	const aEmbedded = extractEmbeddedDateScore(a.id);
	const bEmbedded = extractEmbeddedDateScore(b.id);
	if (aEmbedded !== bEmbedded) return bEmbedded - aEmbedded;

	if (aDate && !bDate) return -1;
	if (!aDate && bDate) return 1;

	return a.id.localeCompare(b.id);
}
