import { createHash } from "node:crypto";
import path from "node:path";
import { PATHS } from "../../config.ts";
import type { CurriculumSeedFile } from "../core/curriculum/types.ts";
import { libraryDir } from "../core/domains/paths.ts";
import { rankByMatch } from "../core/resources/match.ts";
import { parseDescriptionChapters } from "../core/resources/segments.ts";
import { isYoutubeVideoId, youtubeWatchUrl } from "../core/resources/youtube.ts";
import { keyValue } from "./keys.ts";
import { createDefaultRegistry } from "./resources/registry.ts";
import { createResourceFetch, type ResourceFetch } from "./resources/safe-fetch.ts";

type Region = { id: string; title: string; titleEn?: string; objective?: string; bookQuery: string; videoQuery: string; youtubeId?: string };
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
		for (const key of ["contents","twoColumnSearchResultsRenderer","primaryContents","sectionListRenderer","itemSectionRenderer"])
			if (row[key]) collect(row[key]);
	}
	collect(JSON.parse(data));
	return hits;
}

type RegionalSource = { source: Source; ref: string };

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
	return { source: { id, title, url, kind, usage: "reference", license: "Link only", lang: kind === "video" ? language : "en" },
		ref: kind === "book" ? section : videoTitle };
}

export async function findRegionalSource(domainId: string, region: Region, kind: "book" | "video", signal: AbortSignal, fetchMetadata = metadataFetch, subject = ""): Promise<RegionalSource | undefined> {
	const reviewed = reviewedCartography(subject, region, kind);
	if (reviewed) return reviewed;
	const registry = createDefaultRegistry({ stateDir: path.join(PATHS.data, "catalog-cache"), libraryRoot: libraryDir(PATHS.data),
		youtubeApiKey: () => keyValue("YOUTUBE_API_KEY"), youtubeEnrichedOptIn: () => false,
		fetch: (url, init) => fetchMetadata(url, { ...init, signal }) });
	const query = { text: { en: kind === "book" ? region.bookQuery : region.videoQuery, pt: region.title }, kinds: [kind], maxResults: 4, langs: ["pt", "en"], domainId: domainId, signal };
	let outcome = await registry.search(query, { providers: [kind === "book" ? "openlibrary" : "youtube-data"] });
	const candidates = () => outcome.results.flatMap(r => r.url?.startsWith("https://") && ["en","pt","und"].includes(r.lang || "und")
		? [{ title: r.title, url: r.url, lang: r.lang, license: r.license.name }] : []);
	let hit: Hit | undefined = rankByMatch(candidates(), query, r => r)[0];
	if (!hit && kind === "book") {
		// Bibliographic catalogs search whole books. Retry with shorter subject headings.
		for (const subject of new Set([region.titleEn, region.title, region.bookQuery.split(/\s+/).slice(0, 3).join(" ")])) {
			if (!subject || subject === query.text.en) continue;
			outcome = await registry.search({ ...query, text: { en: subject } }, { providers: ["openlibrary"] });
			hit = rankByMatch(candidates(), { text: { en: subject, pt: region.title } }, r => r, 0.5)[0];
			if (hit) break;
		}
	}
	if (!hit && kind === "video") hit = rankByMatch(await videoWithoutKey({ ...region, videoQuery: [region.videoQuery, subject.split(" ").slice(0, 5).join(" ")].filter(Boolean).join(" ") }, signal, fetchMetadata), query, r => r)[0];
	if (!hit) return;
	let ref = "Sugestão para " + region.title;
	const item = outcome.results.find(r => r.url === hit.url);
	if (item && kind === "book") {
		const contents = await registry.toc(item.id).catch(() => []);
		const section = rankByMatch(contents, query, r => r, 0.5)[0];
		if (section) ref = section.title + (section.pageLabel ? " · p. " + section.pageLabel : "");
	} else if (item?.description && item.locator.kind === "youtube") {
		const chapter = rankByMatch(parseDescriptionChapters(item.description), query, ch => ch, 0.5)[0];
		if (chapter) {
			hit.url = youtubeWatchUrl(item.locator.videoId, chapter.startSec);
			ref = chapter.title;
		}
	}
	const id = kind + "-" + createHash("sha256").update(hit.url).digest("hex").slice(0, 16);
	return { source: { ...hit, id, usage: "reference", kind }, ref };
}

/** The model supplies topics. The catalog supplies the actual titles and destinations. */
export async function attachRegionalSources(seed: CurriculumSeedFile, regions: Region[], signal: AbortSignal, progress?: (done: number) => void, fetchMetadata = metadataFetch) {
	for (const [index, region] of regions.entries()) {
		signal.throwIfAborted();
		const unit = seed.items.find(item => item.kind === "unit" && item.id === region.id);
		if (!unit) throw new Error("Região de materiais ausente no currículo.");

		const results = await Promise.allSettled((["book", "video"] as const).map(kind => findRegionalSource(seed.domainId, region, kind, signal, fetchMetadata, seed.items.find(i => i.kind === "domain")?.title.en)));
		signal.throwIfAborted();
		for (const result of results) {
			if (result.status !== "fulfilled" || !result.value) continue;
			const { source, ref } = result.value;
			if (!seed.sources.some(s => s.id === source.id)) seed.sources.push(source);
			(unit.anchors ??= []).push({ source: source.id, ref, embeddable: false });
		}
		progress?.(index + 1);
	}
}
