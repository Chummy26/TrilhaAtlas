/**
 * Pure educational reputation scorer for books, open PDFs, and video lectures.
 * Used to rank high-reputation university textbooks, open-education repositories,
 * and established teaching channels ahead of generic catalog hits.
 */

export interface EducationalReputation {
	score: number;
	tier: "reference" | "standard";
	badge?: string;
}

const HIGH_REP_DOMAINS: readonly [RegExp, number, string][] = [
	[/(?:^|\.)openstax\.org$/i, 45, "Referência acadêmica · OpenStax"],
	[/(?:^|\.)ocw\.mit\.edu$/i, 45, "Referência acadêmica · MIT OCW"],
	[/(?:^|\.)libretexts\.org$/i, 40, "Referência acadêmica · LibreTexts"],
	[/(?:^|\.)opentextbc\.ca$|(?:^|\.)pressbooks\.bccampus\.ca$/i, 40, "Referência acadêmica · BCcampus"],
	[/(?:^|\.)open\.umn\.edu$/i, 40, "Referência acadêmica · Open Textbook"],
	[/(?:^|\.)cambridge\.org$|(?:^|\.)cambridgeenglish\.org$/i, 42, "Referência acadêmica · Cambridge"],
	[/(?:^|\.)ox\.ac\.uk$|(?:^|\.)oup\.com$/i, 42, "Referência acadêmica · Oxford"],
	[/(?:^|\.)britishcouncil\.org$/i, 38, "Referência educacional · British Council"],
	[/(?:^|\.)bbc\.co\.uk$|(?:^|\.)bbc\.com$/i, 36, "Referência educacional · BBC"],
	[/(?:^|\.)voanews\.com$|(?:^|\.)voanews\.eu$/i, 34, "Referência educacional · VOA"],
	[/(?:^|\.)khanacademy\.org$/i, 38, "Referência educacional · Khan Academy"],
	[/(?:^|\.)univesp\.br$|(?:^|\.)usp\.br$|(?:^|\.)unicamp\.br$/i, 42, "Referência universitária"],
	[/(?:^|\.)stanford\.edu$|(?:^|\.)berkeley\.edu$|(?:^|\.)harvard\.edu$|(?:^|\.)cmu\.edu$|(?:^|\.)caltech\.edu$/i, 44, "Referência universitária"],
	[/(?:^|\.)nptel\.ac\.in$/i, 40, "Referência universitária · NPTEL"],
	[/(?:^|\.)allaboutcircuits\.com$/i, 36, "Referência técnica"],
	[/(?:^|\.)bipm\.org$|(?:^|\.)ieee\.org$|(?:^|\.)springer\.com$|(?:^|\.)arxiv\.org$/i, 38, "Referência científica"],
	[/(?:^|\.)wikibooks\.org$/i, 30, "Livro aberto · Wikibooks"],
	[/(?:^|\.)oercommons\.org$|(?:^|\.)gutenberg\.org$/i, 30, "Acervo aberto"],
	[/(?:^|\.)phrasebank\.manchester\.ac\.uk$/i, 40, "Referência acadêmica · Manchester"],
];

const HIGH_REP_TEXT_PATTERNS: readonly [RegExp, number, string][] = [
	[/\b(mit\s+ocw|mit\s+opencourseware|openstax|univesp|nptel|stanford|harvard|berkeley|oxford|cambridge)\b/i, 36, "Referência acadêmica"],
	[/\b(khan\s+academy|bbc\s+learning\s+english|british\s+council|voa\s+learning|let['’]s\s+learn\s+english|3blue1brown|crash\s*course)\b/i, 32, "Referência educacional"],
	[/\b(horowitz|sedra|smith|razavi|oppenheim|kuphaldt|astrom|murray|harris|kernighan|ritchie|pierret|pozar)\b/i, 38, "Livro-texto clássico"],
	[/\b(textbook|laboratory\s+manual|university\s+course|lecture\s+\d+|aula\s+\d+|f[ií]sica\s+iii|manual\s+t[eé]cnico)\b/i, 16, "Material universitário"],
];

export function scoreEducationalReputation(input: {
	title: string;
	url: string;
	part?: string;
	fullBookUrl?: string;
	channel?: string;
}): EducationalReputation {
	let score = 0;
	let badge: string | undefined;

	const checkUrl = (raw?: string) => {
		if (!raw) return;
		if (raw.startsWith("/ler/")) {
			score = Math.max(score, 26);
			return;
		}
		try {
			const host = new URL(raw).hostname;
			for (const [pattern, pts, label] of HIGH_REP_DOMAINS) {
				if (pattern.test(host)) {
					if (pts > score) {
						score = pts;
						badge = label;
					}
					break;
				}
			}
			if (/\.edu(?:\.[a-z]{2})?$/i.test(host) && score < 36) {
				score = 36;
				badge = "Referência universitária";
			}
			if (/\.pdf(?:[?#]|$)/i.test(raw)) score += 10;
		} catch {
			// Ignore non-URL strings.
		}
	};

	checkUrl(input.url);
	checkUrl(input.fullBookUrl);

	const combined = [input.title, input.part, input.channel].filter(Boolean).join(" ");
	for (const [pattern, pts, label] of HIGH_REP_TEXT_PATTERNS) {
		if (pattern.test(combined)) {
			if (pts > score) {
				score = pts;
				if (!badge) badge = label;
			} else {
				score += Math.min(8, Math.floor(pts / 4));
			}
		}
	}

	if (input.fullBookUrl && /^https:\/\//i.test(input.fullBookUrl)) score += 6;

	const tier: EducationalReputation["tier"] = score >= 30 ? "reference" : "standard";
	return {
		score,
		tier,
		...(tier === "reference" ? { badge: badge ?? "Referência acadêmica" } : {}),
	};
}
