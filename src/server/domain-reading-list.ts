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

type Region = { id: string; title: string; bookQuery: string; videoQuery: string; youtubeId?: string };
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
	const keywords = region.videoQuery.match(/[\p{L}\p{N}]+/gu)?.slice(0, 8);
	if (!keywords?.length) return [];
	const query = new URLSearchParams({ q: 'mediatype:movies AND (collection:opensource_education OR collection:education OR collection:MITOpenCourseWare) AND ' + keywords.map(word => '"' + word + '"').join(" AND "), rows: "4", output: "json" });
	query.append("fl[]", "identifier");
	query.append("fl[]", "title");
	const response = await fetchMetadata("https://archive.org/advancedsearch.php?" + query, { signal });
	if (!response.ok) return [];
	const data = await response.json();
	const hits: Hit[] = [];
	for (const row of data?.response?.docs ?? []) {
		if (typeof row.identifier === "string" && /^[\w.-]+$/.test(row.identifier) && typeof row.title === "string")
			hits.push({ title: row.title, url: "https://archive.org/details/" + row.identifier, license: "See the item's rights statement · link only" });
	}
	return hits;
}

/** The model supplies topics. The catalog supplies the actual titles and destinations. */
export async function attachRegionalSources(seed: CurriculumSeedFile, regions: Region[], signal: AbortSignal, progress?: (done: number) => void, fetchMetadata = metadataFetch) {
	const registry = createDefaultRegistry({ stateDir: path.join(PATHS.data, "catalog-cache"), libraryRoot: libraryDir(PATHS.data),
		youtubeApiKey: () => keyValue("YOUTUBE_API_KEY"), youtubeEnrichedOptIn: () => false,
		fetch: (url, init) => fetchMetadata(url, { ...init, signal }) });
	for (const [index, region] of regions.entries()) {
		signal.throwIfAborted();
		const unit = seed.items.find(item => item.kind === "unit" && item.id === region.id);
		if (!unit) throw new Error("Região de materiais ausente no currículo.");
		const search = async (kind: "book" | "video"): Promise<{ source: Source; ref: string } | undefined> => {
			const query = { text: { en: kind === "book" ? region.bookQuery : region.videoQuery, pt: region.title }, kinds: [kind], maxResults: 4, langs: ["pt", "en"], domainId: seed.domainId, signal };
			const outcome = await registry.search(query, { providers: [kind === "book" ? "openlibrary" : "youtube-data"] });
			const entries: Hit[] = outcome.results.flatMap(r => r.url?.startsWith("https://") && (!r.lang || ["en", "pt", "und"].includes(r.lang.split("-")[0]!)) ?
				[{ title: r.title, url: r.url, lang: r.lang, license: r.license.name }] : []);
			let hit = rankByMatch(entries, query, r => r)[0];
			if (!hit && kind === "video") hit = rankByMatch(await videoWithoutKey(region, signal, fetchMetadata), query, r => r)[0];
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
		};
		const results = await Promise.allSettled([search("book"), search("video")]);
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
