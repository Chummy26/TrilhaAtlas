/**
 * Lexical helpers shared by recall, grounding and dedup (r4 §7.6.2-0 grounding
 * normalisation; §7.6.4 step 0 intent gate and the `fts` channel query).
 *
 * - `foldText`: lowercase, no diacritics, typographic quotes/dashes unified,
 *   whitespace collapsed. "Tensão" and "tensao" fold to the same string, the
 *   same equivalence FTS5 `unicode61 remove_diacritics 2` applies on the index.
 * - `buildFtsQuery`: content tokens (pt+en stopwords removed), each quoted, OR-
 *   joined, plus a light suffix-stripped prefix term (`"tens"*`) so plural /
 *   inflected forms still match. Always syntax-safe for FTS5 MATCH.
 * - Intent gate (decision documented in docs/impl/memory.md): r4 suggests
 *   skipping utterances with < 4 useful tokens; that drops legitimate short
 *   questions ("tensão?"), so we skip only pure acknowledgements or utterances
 *   with zero content tokens.
 */

const STOPWORDS_PT = [
	"a", "à", "ao", "aos", "as", "às", "o", "os", "um", "uma", "uns", "umas", "de", "da", "das", "do", "dos", "em", "na", "nas",
	"no", "nos", "num", "numa", "por", "pela", "pelas", "pelo", "pelos", "para", "pra", "pro", "com", "sem", "sob", "sobre", "e",
	"ou", "mas", "que", "se", "como", "quando", "onde", "qual", "quais", "quem", "porque", "pois", "já", "ja", "não", "nao", "sim",
	"eu", "tu", "ele", "ela", "nós", "nos", "vós", "eles", "elas", "me", "te", "lhe", "lhes", "meu", "minha", "meus", "minhas",
	"seu", "sua", "seus", "suas", "isso", "isto", "aquilo", "esse", "essa", "este", "esta", "aquele", "aquela", "é", "e", "foi",
	"era", "ser", "estar", "está", "esta", "estou", "tem", "têm", "ter", "tinha", "há", "ha", "vai", "vou", "fazer", "faz", "fiz",
	"muito", "mais", "menos", "também", "tambem", "só", "so", "lá", "la", "aqui", "então", "entao", "você", "voce", "vocês",
	"voces", "disse", "falei", "falou", "sobre", "coisa", "coisas", "algo", "tudo", "nada", "ainda", "agora", "dia",
];

const STOPWORDS_EN = [
	"a", "an", "the", "of", "to", "in", "on", "at", "for", "with", "by", "from", "and", "or", "but", "is", "are", "was", "were",
	"be", "been", "it", "its", "this", "that", "these", "those", "i", "you", "he", "she", "we", "they", "me", "my", "your",
	"our", "their", "do", "did", "does", "what", "which", "who", "when", "where", "why", "how", "not", "no", "yes", "so",
	"about", "said", "say", "tell", "told", "there", "here", "have", "has", "had", "can", "could", "would", "should", "will",
];

const ACKNOWLEDGEMENTS = [
	"ok", "okay", "sim", "nao", "beleza", "blz", "certo", "entendi", "entendido", "valeu", "obrigado", "obrigada", "continua",
	"continue", "segue", "pode", "seguir", "proximo", "proxima", "next", "yes", "no", "yep", "nope", "thanks", "thank", "sure",
	"got", "it", "go", "on", "ah", "ahh", "hum", "hmm", "uhum", "aham", "legal", "show", "isso", "claro", "perfeito", "otimo",
	"bom", "boa", "tranquilo", "vamos", "la", "manda", "vai", "fechou", "cool", "nice", "great", "fine", "right", "please",
];

export function foldText(text: string): string {
	return text
		.normalize("NFKD")
		.replace(/\p{M}+/gu, "")
		.toLowerCase()
		.replace(/[‘’‚‛′`´]/g, "'")
		.replace(/[“”„‟″«»]/g, '"')
		.replace(/[‐‑‒–—―−]/g, "-")
		.replace(/…/g, "...")
		.replace(/\s+/g, " ")
		.trim();
}

const STOP = new Set([...STOPWORDS_PT, ...STOPWORDS_EN].map(foldText));
const ACK = new Set(ACKNOWLEDGEMENTS.map(foldText));

const WORD_RE = /[\p{L}\p{N}]+/gu;

/** Folded word tokens, in order, duplicates kept. */
export function wordTokens(text: string): string[] {
	return foldText(text).match(WORD_RE) ?? [];
}

/** Folded content tokens (stopwords removed, ≥2 chars or digits), deduplicated in order. */
export function contentTokens(text: string): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const tok of wordTokens(text)) {
		if (STOP.has(tok)) continue;
		if (tok.length < 2 && !/\d/.test(tok)) continue;
		if (seen.has(tok)) continue;
		seen.add(tok);
		out.push(tok);
	}
	return out;
}

/** True when the utterance carries no recall-worthy content (r4 §7.6.4 step 0). */
export function isTrivialUtterance(text: string): boolean {
	const words = wordTokens(text);
	if (words.length === 0) return true;
	if (words.every((w) => ACK.has(w))) return true;
	return contentTokens(text).length === 0;
}

const SUFFIXES = ["oes", "aes", "ais", "eis", "ois", "ns", "es", "s"];

/** Light pt/en plural/inflection stripping for prefix queries ("tensoes" → "tens"). */
export function lightStem(token: string): string {
	for (const suffix of SUFFIXES) {
		if (token.length - suffix.length >= 4 && token.endsWith(suffix)) return token.slice(0, -suffix.length);
	}
	// Feminine/masculine endings and "-ao/-oes" families share the stem minus the last vowel(s).
	if (token.length >= 6 && /[aeo]o?$/.test(token)) return token.replace(/[aeo]o?$/, "");
	return token;
}

/**
 * Syntax-safe FTS5 MATCH expression: `"tok1" OR "stem"* OR "tok2"…`, or null
 * when the text has no content tokens. Tokens only contain letters/digits, so
 * quoting can never break the query.
 */
export function buildFtsQuery(text: string, maxTerms = 16): string | null {
	const tokens = contentTokens(text).slice(0, maxTerms);
	if (tokens.length === 0) return null;
	const terms: string[] = [];
	const seen = new Set<string>();
	for (const tok of tokens) {
		const exact = `"${tok}"`;
		if (!seen.has(exact)) {
			seen.add(exact);
			terms.push(exact);
		}
		if (tok.length >= 5) {
			const stem = lightStem(tok);
			const prefix = `"${stem}"*`;
			if (stem !== tok && stem.length >= 4 && !seen.has(prefix)) {
				seen.add(prefix);
				terms.push(prefix);
			}
		}
	}
	return terms.join(" OR ");
}

export function jaccard<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): number {
	if (a.size === 0 && b.size === 0) return 1;
	let inter = 0;
	const [small, large] = a.size <= b.size ? [a, b] : [b, a];
	for (const x of small) if (large.has(x)) inter += 1;
	return inter / (a.size + b.size - inter);
}

/** Canonical entity key: folded, single spaces, trivial plural stripped. */
export function canonicalEntity(name: string): string {
	const folded = wordTokens(name).join(" ");
	return folded.length > 4 && folded.endsWith("s") && !folded.endsWith("ss") ? folded.slice(0, -1) : folded;
}
