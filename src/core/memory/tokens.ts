/**
 * Cheap token estimator for memory budgets (r4 §7.6.4 step 8, §7.7; SÍNTESE
 * §2.4(b) per-section budgets).
 *
 * Not a tokenizer: a deterministic BPE-ish approximation good to ~±15% on
 * pt/en prose. Each run of letters/digits costs ceil(len/4) (min 1), each
 * other non-space symbol costs 1, whitespace is free.
 *
 * Key property (relied on by the packers): the estimate is ADDITIVE over
 * whitespace-joined parts — estimate(a + "\n" + b) = estimate(a) + estimate(b) —
 * so budgets computed line by line are exact w.r.t. the rendered text.
 */

const TOKEN_RE = /[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu;

export function estimateTokens(text: string): number {
	if (!text) return 0;
	let n = 0;
	for (const m of text.matchAll(TOKEN_RE)) {
		const len = m[0].length;
		n += len <= 4 ? 1 : Math.ceil(len / 4);
	}
	return n;
}

const ELLIPSIS = "…";

/** Longest prefix of `text` (plus "…" when cut) whose estimate fits `maxTokens`. */
export function truncateToTokens(text: string, maxTokens: number): string {
	if (maxTokens <= 0) return "";
	if (estimateTokens(text) <= maxTokens) return text;
	// Binary search on character length; the estimate is monotone in the prefix length
	// up to the cost of a partially cut word, which the search tolerates.
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		const candidate = text.slice(0, mid).trimEnd() + ELLIPSIS;
		if (estimateTokens(candidate) <= maxTokens) lo = mid;
		else hi = mid - 1;
	}
	if (lo === 0) return maxTokens >= 1 ? ELLIPSIS : "";
	return text.slice(0, lo).trimEnd() + ELLIPSIS;
}

export interface FittedText {
	text: string;
	tokens: number;
	truncated: boolean;
}

/**
 * Keep whole lines within `maxTokens`. keep="head" keeps the first lines,
 * keep="tail" the last ones (chronological logs: newest matter most). The
 * first line kept on the "head" side may itself be cut with "…".
 */
export function fitLines(text: string, maxTokens: number, keep: "head" | "tail" = "head"): FittedText {
	const total = estimateTokens(text);
	if (total <= maxTokens) return { text, tokens: total, truncated: false };
	if (maxTokens <= 0) return { text: "", tokens: 0, truncated: total > 0 };
	const lines = text.split("\n");
	const ordered = keep === "head" ? lines : [...lines].reverse();
	const kept: string[] = [];
	let used = 0;
	for (const line of ordered) {
		const cost = estimateTokens(line);
		if (used + cost <= maxTokens) {
			kept.push(line);
			used += cost;
			continue;
		}
		if (kept.length === 0 || keep === "head") {
			const cut = truncateToTokens(line, maxTokens - used);
			if (cut) {
				kept.push(cut);
				used += estimateTokens(cut);
			}
		}
		break;
	}
	const out = keep === "head" ? kept : kept.reverse();
	return { text: out.join("\n"), tokens: used, truncated: true };
}
