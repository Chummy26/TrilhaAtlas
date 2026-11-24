import { createHash } from "node:crypto";
import path from "node:path";
import { PATHS } from "../../config.ts";
import type { CurriculumSeedFile } from "../core/curriculum/types.ts";
import { libraryDir } from "../core/domains/paths.ts";
import { bestMatch, rankByMatch } from "../core/resources/match.ts";
import { scoreEducationalReputation } from "../core/resources/reputation.ts";
import { parseDescriptionChapters } from "../core/resources/segments.ts";
import { isYoutubeVideoId, youtubeWatchUrl } from "../core/resources/youtube.ts";
import { keyValue } from "./keys.ts";
import { createDefaultRegistry } from "./resources/registry.ts";
import { createResourceFetch, type ResourceFetch } from "./resources/safe-fetch.ts";

export type RegionSkillRef = { id: string; title: string; titleEn?: string; query?: string };
type Region = {
	id: string;
	title: string;
	titleEn?: string;
	objective?: string;
	bookQuery: string;
	videoQuery: string;
	youtubeId?: string;
	skills?: RegionSkillRef[];
};
export interface UserSeedMaterial {
	kind: "book" | "video";
	title: string;
	url: string;
	part?: string;
	lang?: string;
	regionHint?: string;
}
type Source = CurriculumSeedFile["sources"][number];
type Hit = { title: string; url: string; license: string; lang?: string };
const metadataFetch = createResourceFetch({ timeoutMs: 4500 });

async function videoWithoutKey(region: Region, signal: AbortSignal, fetchMetadata: ResourceFetch): Promise<Hit[]> {
	if (region.youtubeId && isYoutubeVideoId(region.youtubeId)) {
		const url = youtubeWatchUrl(region.youtubeId);
		const response = await fetchMetadata("https://www.youtube.com/oembed?" + new URLSearchParams({ url, format: "json" }), { signal }).catch(() => null);
		if (response?.ok) {
			const data = await response.json();
			if (typeof data.title === "string" && rankByMatch([{ title: data.title }], { text: { en: region.videoQuery, pt: region.title } }, r => r).length)
				return [{ title: data.title, url, license: "YouTube · link only" }];
		}
	}
	const url = "https://www.youtube.com/results?" + new URLSearchParams({ search_query: region.videoQuery + " aula tutorial" });
	const response = await fetchMetadata(url, { signal });
	if (!response.ok) return [];
	const html = await response.text();
	const data = /(?:var ytInitialData|window\["ytInitialData"\])\s*=\s*(\{[^\n]*?\});\s*<\/script>/u.exec(html)?.[1];
	if (!data) return [];
	const hits: Hit[] = [];
	// Only regular video search results. Skip ads, shorts shelves and recommendations.
	function collect(node: unknown) {
		if (!node || typeof node !== "object" || hits.length >= 15) return;
		if (Array.isArray(node)) { node.forEach(collect); return; }
		const row = node as Record<string, unknown>;
		if (row.videoRenderer) {
			const v = row.videoRenderer as { videoId?: string; title?: { runs?: { text: string }[]; simpleText?: string } };
			const title = v.title?.runs?.map(r => r.text).join("") || v.title?.simpleText;
			if (v.videoId && isYoutubeVideoId(v.videoId) && title) hits.push({ title, url: youtubeWatchUrl(v.videoId), license: "YouTube · link only" });
			return;
		}
		for (const key of ["contents", "twoColumnSearchResultsRenderer", "primaryContents", "sectionListRenderer", "itemSectionRenderer"])
			if (row[key]) collect(row[key]);
	}
	collect(JSON.parse(data));
	return hits;
}

type RegionalSource = {
	source: Source;
	ref: string;
	skillAnchors?: Array<{ skillId: string; ref: string; url?: string }>;
};

// Publisher chapters and lessons reviewed against these cartography objectives.
function reviewedCartography(subject: string, region: Region, kind: "book" | "video"): RegionalSource | undefined {
	if (!/topograph|cartograph|contour lines|topogr[aá]fic|curvas de n[ií]vel/i.test(subject)) return;
	const sections = [
		[/\b(?:escala|scale|distances?|dist[aâ]ncias?)\b/i, "Map Scale", "OJ3x7xdNzTA", "Escala cartográfica · escalas gráfica e numérica", "pt"],
		[/perfil|perfis|profile/i, "Topographic Profiles", "B6Suq_41ysg", "Constructing a Profile from a Topographic Map", "en"],
		[/escolha|planejamento|route selection|route planning|route comparison|compar.*percursos|rotas|routes/i, "Interpreting the Landscape", "PRPFM_j6RmQ", "OS Maps · Route planning", "en"],
		[/declive|slope|gradiente|steep/i, "Deriving Slope Gradients from Maps", "4i_6eToM3X8", "Understanding contour lines · Ordnance Survey", "en"],
		[/vales|cristas|cumes|selas|landform|relevo|terrain|valley/i, "Interpreting Contour Lines", "4i_6eToM3X8", "Understanding contour lines · Ordnance Survey", "en"],
		[/contour|curva|altitude|eleva/i, "Contour Lines", "jWj9GtssBbs", "Curvas de nível (altimetria) · como interpretar", "pt"],
	] as const;
	const topics = [region.title, region.titleEn, kind === "book" ? region.bookQuery : region.videoQuery, region.objective];
	const match = topics.map(topic => topic && sections.find(([concept]) => concept.test(topic))).find(row => row);
	if (!match) return;
	const [, section, video, videoTitle, language] = match;
	const scale = section === "Map Scale";
	const url = kind === "video" ? youtubeWatchUrl(video) : scale ? "https://pressbooks.bccampus.ca/geolmanualed2/chapter/overview-of-topographic-maps/" : "https://opentextbc.ca/geoglabmanualv2/chapter/map-skills-ii/";
	const title = kind === "video" ? videoTitle : scale ? "Laboratory Manual for Earth Science (2Ed)" : "Laboratory Manual for Introduction to Physical Geography (2nd ed.)";
	const id = kind + "-" + createHash("sha256").update(url).digest("hex").slice(0, 16);
	return {
		source: { id, title, url, kind, usage: "reference", license: "Link only", lang: kind === "video" ? language : "en" },
		ref: kind === "book" ? section : videoTitle,
	};
}

function sourceId(kind: "book" | "video", url: string): string {
	return kind + "-" + createHash("sha256").update(url).digest("hex").slice(0, 16);
}

/** Find multiple complementary books or videos for a region and match TOC / video chapters to child skills. */
export async function findRegionalSources(
	domainId: string,
	region: Region,
	kind: "book" | "video",
	signal: AbortSignal,
	fetchMetadata = metadataFetch,
	subject = "",
	maxItems = 2,
): Promise<RegionalSource[]> {
	const reviewed = reviewedCartography(subject, region, kind);
	if (reviewed) return [reviewed];
	const registry = createDefaultRegistry({
		stateDir: path.join(PATHS.data, "catalog-cache"), libraryRoot: libraryDir(PATHS.data),
		youtubeApiKey: () => keyValue("YOUTUBE_API_KEY"), youtubeEnrichedOptIn: () => false,
		fetch: (url, init) => fetchMetadata(url, { ...init, signal }),
	});
	const query = { text: { en: kind === "book" ? region.bookQuery : region.videoQuery, pt: region.title }, kinds: [kind], maxResults: 6, langs: ["pt", "en"], domainId, signal };
	let outcome = await registry.search(query, { providers: [kind === "book" ? "openlibrary" : "youtube-data"] });
	const allResults = [...outcome.results];

	// Complement openlibrary with Wikibooks (real open chapters) when searching books, ignoring failures offline/mocked.
	if (kind === "book" && maxItems > 1) {
		const wiki = await registry.search({ ...query, maxResults: 3 }, { providers: ["wikibooks"] }).catch(() => undefined);
		if (wiki?.results.length) allResults.push(...wiki.results);
	}

	const toCandidates = (rows: typeof allResults) => rows.flatMap(r =>
		r.url?.startsWith("https://") && ["en", "pt", "und"].includes(r.lang || "und")
			? [{ title: r.title, url: r.url, lang: r.lang, license: r.license.name }]
			: [],
	);
	const rankWithReputation = (rows: Hit[], q: { text: { en?: string; pt?: string } }, minScore?: number): Hit[] =>
		rankByMatch(rows, q, r => r, minScore)
			.map((hit, idx) => ({ hit, idx, rep: scoreEducationalReputation({ title: hit.title, url: hit.url }).score }))
			.sort((a, b) => (b.rep - a.rep) || (a.idx - b.idx))
			.map(entry => entry.hit);

	let hits: Hit[] = rankWithReputation(toCandidates(allResults), query).slice(0, maxItems);

	if (!hits.length && kind === "book") {
		// Bibliographic catalogs search whole books. Retry with shorter subject headings.
		for (const heading of new Set([region.titleEn, region.title, region.bookQuery.split(/\s+/).slice(0, 3).join(" ")])) {
			if (!heading || heading === query.text.en) continue;
			outcome = await registry.search({ ...query, text: { en: heading } }, { providers: ["openlibrary"] });
			allResults.push(...outcome.results);
			const retry = rankWithReputation(toCandidates(outcome.results), { text: { en: heading, pt: region.title } }, 0.5);
			if (retry.length) { hits = retry.slice(0, maxItems); break; }
		}
	}
	if (hits.length < maxItems && kind === "video") {
		const fallbackHits = await videoWithoutKey(
			{ ...region, videoQuery: [region.videoQuery, subject.split(" ").slice(0, 5).join(" ")].filter(Boolean).join(" ") },
			signal,
			fetchMetadata,
		).catch(() => []);
		const rankedFallback = rankWithReputation(fallbackHits, query);
		const seenUrls = new Set(hits.map(h => h.url));
		for (const fh of rankedFallback) {
			if (hits.length >= maxItems) break;
			if (!seenUrls.has(fh.url)) {
				seenUrls.add(fh.url);
				hits.push(fh);
			}
		}
	}
	if (!hits.length) return [];

	const resolved: RegionalSource[] = [];
	const seen = new Set<string>();
	for (const hit of hits) {
		if (seen.has(hit.url)) continue;
		seen.add(hit.url);
		let ref = "Sugestão para " + region.title;
		const skillAnchors: Array<{ skillId: string; ref: string; url?: string }> = [];
		const item = allResults.find(r => r.url === hit.url);
		if (item && kind === "book") {
			const contents = await registry.toc(item.id).catch(() => []);
			const section = rankByMatch(contents, query, r => r, 0.5)[0];
			if (section) ref = section.title + (section.pageLabel ? " · p. " + section.pageLabel : "");
			// Cross-link individual TOC chapters directly to matching skills in this region!
			if (contents.length && region.skills?.length) {
				for (const skill of region.skills) {
					const matched = rankByMatch(contents, { text: { pt: skill.title, en: skill.titleEn ?? skill.query } }, r => r, 0.55)[0];
					if (matched) {
						skillAnchors.push({
							skillId: skill.id,
							ref: matched.title + (matched.pageLabel ? " · p. " + matched.pageLabel : ""),
						});
					}
				}
			}
		} else if (item?.description && item.locator.kind === "youtube") {
			const chapters = parseDescriptionChapters(item.description);
			const chapter = rankByMatch(chapters, query, ch => ch, 0.5)[0];
			if (chapter) {
				hit.url = youtubeWatchUrl(item.locator.videoId, chapter.startSec);
				ref = chapter.title;
			}
			// Cross-link YouTube timestamp chapters directly to matching skills in this region!
			if (chapters.length && region.skills?.length) {
				for (const skill of region.skills) {
					const matched = rankByMatch(chapters, { text: { pt: skill.title, en: skill.titleEn ?? skill.query } }, ch => ch, 0.55)[0];
					if (matched) {
						skillAnchors.push({
							skillId: skill.id,
							ref: matched.title,
							url: youtubeWatchUrl(item.locator.videoId, matched.startSec),
						});
					}
				}
			}
		} else if (region.skills?.length) {
			// Match complementary videos directly to the best-fitting skill inside the region.
			const bestSkill = region.skills
				.map(skill => ({ skill, score: bestMatch({ text: { pt: skill.title, en: skill.titleEn ?? skill.query } }, hit.title) }))
				.filter(entry => entry.score >= 0.55)
				.sort((a, b) => b.score - a.score)[0];
			if (bestSkill) {
				skillAnchors.push({ skillId: bestSkill.skill.id, ref: hit.title });
			}
		}
		const id = sourceId(kind, hit.url);
		resolved.push({
			source: { ...hit, id, usage: "reference", kind },
			ref,
			...(skillAnchors.length ? { skillAnchors } : {}),
		});
	}
	return resolved;
}

export async function findRegionalSource(domainId: string, region: Region, kind: "book" | "video", signal: AbortSignal, fetchMetadata = metadataFetch, subject = ""): Promise<RegionalSource | undefined> {
	const results = await findRegionalSources(domainId, region, kind, signal, fetchMetadata, subject, 1);
	return results[0];
}

/**
 * Deep enrichment pass that expands a region's shelf with higher-reputation
 * textbooks, open books, and university video lectures (up to 4 books + 4 videos),
 * cross-linking TOC chapters and YouTube timestamps onto matching child skills.
 */
export async function enrichRegionalCatalog(
	domainId: string,
	region: Region,
	signal: AbortSignal,
	fetchMetadata = metadataFetch,
	subject = "",
): Promise<RegionalSource[]> {
	const academicBookRegion: Region = {
		...region,
		bookQuery: `${region.bookQuery} textbook`.trim(),
	};
	const academicVideoRegion: Region = {
		...region,
		videoQuery: `${region.videoQuery} university lecture course`.trim(),
	};
	const [booksBase, booksAcademic, videosBase, videosAcademic] = await Promise.allSettled([
		findRegionalSources(domainId, region, "book", signal, fetchMetadata, subject, 3),
		findRegionalSources(domainId, academicBookRegion, "book", signal, fetchMetadata, subject, 3),
		findRegionalSources(domainId, region, "video", signal, fetchMetadata, subject, 3),
		findRegionalSources(domainId, academicVideoRegion, "video", signal, fetchMetadata, subject, 3),
	]);
	const dedup = (lists: Array<PromiseSettledResult<RegionalSource[]>>, limit: number): RegionalSource[] => {
		const byUrl = new Map<string, RegionalSource>();
		for (const res of lists) {
			if (res.status !== "fulfilled") continue;
			for (const entry of res.value) {
				const url = entry.source.url ?? "";
				if (!url || byUrl.has(url)) continue;
				byUrl.set(url, entry);
			}
		}
		return [...byUrl.values()]
			.sort((a, b) =>
				scoreEducationalReputation({ title: b.source.title, url: b.source.url ?? "", part: b.ref }).score
				- scoreEducationalReputation({ title: a.source.title, url: a.source.url ?? "", part: a.ref }).score,
			)
			.slice(0, limit);
	};
	return [
		...dedup([booksBase, booksAcademic], 4),
		...dedup([videosBase, videosAcademic], 4),
	];
}

function addSeedAnchor(seed: CurriculumSeedFile, item: CurriculumSeedFile["items"][number], source: Source, ref: string) {
	if (!seed.sources.some(s => s.id === source.id)) seed.sources.push(source);
	const anchors = (item.anchors ??= []);
	if (!anchors.some(a => a.source === source.id && a.ref === ref)) {
		anchors.push({ source: source.id, ref, embeddable: false });
	}
}

/** Match user-supplied books/PDFs/videos directly onto the best-fitting regions and skills. */
function attachUserSeedMaterials(seed: CurriculumSeedFile, regions: Region[], userMaterials: readonly UserSeedMaterial[]) {
	for (const entry of userMaterials) {
		const url = entry.url.trim();
		const title = entry.title.trim();
		if (!title || !/^https:\/\//i.test(url)) continue;
		const ref = entry.part?.trim() || title;
		const source: Source = {
			id: sourceId(entry.kind, url),
			title,
			url,
			kind: entry.kind,
			usage: "reference",
			license: "Manual · link do aluno",
			lang: entry.lang?.trim() || "pt",
		};
		const hintText = [entry.regionHint, entry.title, entry.part].filter(Boolean).join(" ");
		let attachedCount = 0;
		for (const region of regions) {
			const unit = seed.items.find(item => item.kind === "unit" && item.id === region.id);
			if (!unit) continue;
			const regionScore = bestMatch({ text: { pt: region.title, en: region.titleEn ?? region.bookQuery } }, hintText);
			const matchedSkills = (region.skills ?? []).filter(skill =>
				bestMatch({ text: { pt: skill.title, en: skill.titleEn ?? skill.query } }, hintText) >= 0.45,
			);
			for (const skill of matchedSkills) {
				const item = seed.items.find(i => i.id === skill.id);
				if (item) {
					addSeedAnchor(seed, item, source, ref);
					attachedCount++;
				}
			}
			if (regionScore >= 0.45 || matchedSkills.length > 0) {
				addSeedAnchor(seed, unit, source, ref);
				attachedCount++;
			}
		}
		// Never silently drop a user-provided source: if no specific keyword matched, attach it to the first region.
		if (!attachedCount && regions[0]) {
			const firstUnit = seed.items.find(item => item.kind === "unit" && item.id === regions[0]!.id);
			if (firstUnit) addSeedAnchor(seed, firstUnit, source, ref);
		}
	}
}

/** The model supplies topics. The catalog supplies the actual titles and destinations. */
export async function attachRegionalSources(
	seed: CurriculumSeedFile,
	regions: Region[],
	signal: AbortSignal,
	progress?: (done: number) => void,
	fetchMetadata = metadataFetch,
	userMaterials?: readonly UserSeedMaterial[],
) {
	if (userMaterials?.length) attachUserSeedMaterials(seed, regions, userMaterials);
	const domainSubject = seed.items.find(i => i.kind === "domain")?.title.en ?? "";
	for (const region of regions) {
		if (!seed.items.some(item => item.kind === "unit" && item.id === region.id)) {
			throw new Error("Região de materiais ausente no currículo.");
		}
	}

	type RegionFetchResult = {
		region: Region;
		entries: RegionalSource[];
		targeted: { skillId: string; entries: RegionalSource[] }[];
	};
	const results = new Array<RegionFetchResult>(regions.length);
	const concurrency = Math.max(1, Math.min(4, regions.length));
	let nextIdx = 0;
	let completed = 0;

	async function runWorker() {
		while (nextIdx < regions.length) {
			signal.throwIfAborted();
			const idx = nextIdx++;
			const region = regions[idx]!;
			const [bookRes, videoRes] = await Promise.allSettled([
				findRegionalSources(seed.domainId, region, "book", signal, fetchMetadata, domainSubject, 2),
				findRegionalSources(seed.domainId, region, "video", signal, fetchMetadata, domainSubject, 3),
			]);
			signal.throwIfAborted();
			const entries: RegionalSource[] = [];
			const anchoredSkills = new Set<string>();
			for (const res of [bookRes, videoRes]) {
				if (res.status !== "fulfilled") continue;
				for (const entry of res.value) {
					entries.push(entry);
					for (const link of entry.skillAnchors ?? []) anchoredSkills.add(link.skillId);
				}
			}
			const targeted: { skillId: string; entries: RegionalSource[] }[] = [];
			const specialized = (region.skills ?? []).filter(s => s.query && !anchoredSkills.has(s.id)).slice(0, 3);
			for (const skill of specialized) {
				signal.throwIfAborted();
				const found = await findRegionalSources(
					seed.domainId,
					{ id: skill.id, title: skill.title, titleEn: skill.titleEn, bookQuery: skill.query!, videoQuery: skill.query! },
					"video",
					signal,
					fetchMetadata,
					domainSubject,
					1,
				).catch(() => []);
				if (found.length) targeted.push({ skillId: skill.id, entries: found });
			}
			results[idx] = { region, entries, targeted };
			completed++;
			progress?.(completed);
		}
	}

	await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
	signal.throwIfAborted();

	for (const { region, entries, targeted } of results) {
		const unit = seed.items.find(item => item.kind === "unit" && item.id === region.id)!;
		for (const entry of entries) {
			addSeedAnchor(seed, unit, entry.source, entry.ref);
			for (const link of entry.skillAnchors ?? []) {
				const skillItem = seed.items.find(item => item.id === link.skillId);
				if (!skillItem) continue;
				const targetSource: Source = link.url && link.url !== entry.source.url
					? { ...entry.source, id: sourceId(entry.source.kind ?? "video", link.url), url: link.url }
					: entry.source;
				addSeedAnchor(seed, skillItem, targetSource, link.ref);
			}
		}
		for (const item of targeted) {
			const skillItem = seed.items.find(i => i.id === item.skillId);
			if (!skillItem) continue;
			for (const entry of item.entries) addSeedAnchor(seed, skillItem, entry.source, entry.ref);
		}
	}
}
