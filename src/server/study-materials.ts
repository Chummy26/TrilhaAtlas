import { enrichRegionalCatalog, findRegionalSource } from "./domain-reading-list.ts";
import { englishMissionMaterials } from "./english-mission-materials.ts";
import { studyCampaign, campaignFinale } from "../core/study/campaign.ts";
import fs from "node:fs";
import path from "node:path";
import { parseHTML } from "linkedom";
import { FormBodyLimitError, readBoundedFormData } from "../../lib/bounded-form-data.ts";
import { activeDomainId, PATHS } from "../../config.ts";
import sections from "../../content/resources/sections.json" with { type: "json" };
import type { CurriculumItem } from "../core/curriculum/types.ts";
import { chatsDir, libraryDir, resourcesDir } from "../core/domains/paths.ts";
import { LEARNER_CONSTANTS } from "../core/learner/params.ts";
import { booksForDomain, seedLicense } from "../core/resources/catalog.ts";
import { bestMatch, rankByMatch } from "../core/resources/match.ts";
import { scoreEducationalReputation } from "../core/resources/reputation.ts";
import { rankCandidates } from "../core/resources/playlist.ts";
import { parseDescriptionChapters } from "../core/resources/segments.ts";
import { planRegionReading, type BookCandidate } from "../core/resources/setcover.ts";
import { nodeBrief } from "../core/study/projection.ts";
import type { RegionMaterials, StudyMaterial } from "../core/study/map.ts";
import type { StudyAttachments } from "../core/study/attachments.ts";
import { keyValue } from "./keys.ts";
import { CATALOG_TTL_MS, FileTtlCache } from "./resources/cache.ts";
import { cachedText } from "./resources/provider-kit.ts";
import { createResourceFetch } from "./resources/safe-fetch.ts";
import { loadResourceSeeds } from "./resources/seeds.ts";
import { createDefaultRegistry } from "./resources/registry.ts";
import { curriculumSources, finishedExposures, lessonRoute, loadCurriculum, readLearnerHistory, studyDomains, StudyError } from "./study.ts";
import { readStudyEvents, studyLogRevision } from "./study-log.ts";
import { detectFormat, importBookFile, importFromUrl, listLibrary, readLibraryItem, readLibraryChunks, type ImportedBook, type LibraryItemMeta } from "./resources/user-library.ts";
import { MAX_BOOK_BODY_BYTES, MAX_BOOK_BYTES } from "../../lib/book-import-limits.ts";
import { linkRegionalReading, regionalReadingList, unlinkRegionalReading } from "./resources/region-readings.ts";
import { addManualMaterial, readManualMaterials, removeManualMaterial } from "./resources/manual-materials.ts";

const contents: Record<string, { part: string; url: string; nodes?: string[] }[]> = sections;
const videos: StudyMaterial[] = [
	{ kind: "video", title: "Khan Academy Brasil", part: "Introdução à notação científica", url: "https://www.youtube.com/watch?v=JExlrIMYIRE", lang: "pt", nodes: ["ee.math.algebra.sci-notation.powers-of-ten"] },
	{ kind: "video", title: "BBC Learning English", part: "Improve your pronunciation · Introduction", url: "https://www.youtube.com/watch?v=fdRmGvmeY1U", lang: "en", nodes: ["en.pron.foundations.ipa-intro"] },
	{ kind: "video", title: "Física III · Univesp", part: "Aula 19 · Circuitos elétricos e leis de Kirchhoff", url: "https://www.youtube.com/watch?v=ALvobeJOrr4", lang: "pt", nodes: ["ee.dc.laws.kcl", "ee.dc.laws.kvl"] },
	{ kind: "video", title: "Let’s Learn English · VOA", part: "Lesson 1 · Welcome!", url: "https://www.youtube.com/watch?v=WR9_nsLyaEY", lang: "en", nodes: ["en.speaking.a1.greetings"] },
];

function current(domain: string, id: string, overview = false, allowBackgroundDomain = false) {
	if (!domain || (!allowBackgroundDomain && domain !== activeDomainId())) throw new StudyError(409, "O domínio ativo mudou.");
	const manifest = studyDomains().readManifest(domain);
	const cur = manifest && loadCurriculum(domain, manifest);
	const item = cur?.view.nodes.has(id) && cur.snapshot.items[id];
	if (!item || !cur || !manifest) throw new StudyError(404, "Nó desconhecido neste domínio.");
	let region = item;
	while (region.kind !== "unit" && region.parentId) region = cur.snapshot.items[region.parentId]!;
	if (!overview && region.kind !== "unit") throw new StudyError(400, "Selecione uma região ou um de seus nós.");
	return { ...cur, manifest, item, region };
}

function catalog(domain: string) {
	const seeds = loadResourceSeeds(path.join(/* turbopackIgnore: true */ PATHS.root, "content", "resources"));
	return booksForDomain(seeds.books, domain);
}

function regionalReading(domain: string, nodes: CurriculumItem[], linked: Set<string>, savedLibrary?: readonly LibraryItemMeta[]) {
	const saved = savedLibrary ?? listLibrary(libraryDir(PATHS.data));
	const origins = new Set(saved.flatMap(b => b.origin.kind === "url" && linked.has(b.sha256) ? [b.origin.href] : []));
	const materials: StudyMaterial[] = [];
	const books: BookCandidate[] = [];
	for (const book of catalog(domain)) {

		const entries = (contents[book.key] ?? []).map((section, order) => {
			const coverage: Record<string, number> = {};
			const confirmed: string[] = [];
			const suggested: string[] = [];
			for (const n of nodes) {
				if (section.nodes?.includes(n.id)) {
					coverage[n.id] = 1;
					confirmed.push(n.id);
				} else {
					const score = bestMatch({ text: n.title }, section.part);
					if (score >= 0.65) {
						coverage[n.id] = score;
						suggested.push(n.id);
					}
				}
			}
			for (const [ids, provisional] of [[confirmed, false], [suggested, true]] as const) {
				if (ids.length) materials.push({ kind: "book", title: book.title, part: section.part, url: section.url, lang: book.lang, nodes: ids, suggested: provisional,
					fullBookUrl: book.downloadUrl ?? (book.provider === "wikibooks" && !book.urlUnverified ? book.url : undefined),
					...(book.downloadUrl ? { bookKey: book.key, saved: origins.has(book.downloadUrl) } : {}) });
			}
			return { sectionId: section.url, order, coverage };
		});
		if (entries.length) books.push({ bookId: book.key, sections: entries });
	}
	const plan = planRegionReading(nodes.map(n => ({ nodeId: n.id, weight: 1 })), books, [], { topoOrder: nodes.map(n => n.id) });
	const primary = new Set(plan.assignments.map(a => a.source === "spine" ? a.partId : a.partId.slice(a.resourceId.length + 1)));
	return materials.sort((a,b) => Number(!!a.suggested) - Number(!!b.suggested) || Number(primary.has(b.url)) - Number(primary.has(a.url)));
}

// Textbooks, courseware and learner-facing reference works used by the shipped curricula.
const learningReferences = new Set([
	"agarwal-lang", "astrom-murray-fbs", "baker-cmos", "bogatin-spi", "ellingson-electromagnetics", "erickson-maksimovic",
	"fonstad-mdc", "franklin-powell-feedback", "gray-hurst-lewis-meyer", "harris-harris-riscv", "horowitz-hill-aoe3",
	"kicad-docs", "liec-kuphaldt", "model-kuphaldt", "neets", "oppenheim-willsky-ss", "ott-emc", "pozar-microwave",
	"razavi-analog-cmos-2e", "sedra-smith-8e", "white-making-embedded", "pierret-sdf", "sze-ng-physics", "weste-harris-vlsi",
	"riscv-isa-manual", "oppenheim-schafer-dtsp", "kernighan-ritchie-c", "lee-cmos-rf", "razavi-rf-2e",
	"ipa-chart", "ngsl-1.2", "nawl-1.2", "awl-coxhead-2000", "academic-phrasebank", "voa-learning-english",
]);

function readingReferences(domain: string, nodes: CurriculumItem[]): RegionMaterials["references"] {
	const catalog = curriculumSources(domain);
	const shelf = new Map<string, RegionMaterials["references"][number]>();
	for (const node of nodes) {
		for (const anchor of node.anchors) {
			if (!learningReferences.has(anchor.source) && !anchor.source.startsWith("mit-ocw-") && !anchor.source.startsWith("openstax-")) continue;
			const source = catalog.get(anchor.source);
			if (!source) continue;
			const entry = shelf.get(source.id) ?? { title: source.title, url: source.url, parts: [] as string[] };
			const part = anchor.ref.startsWith("toc:") ? anchor.ref.slice(4).replaceAll("-", " ") : anchor.ref;
			if (!["toc", "syllabus"].includes(part) && !entry.parts.includes(part)) entry.parts.push(part);
			shelf.set(source.id, entry);
		}
	}
	return [...shelf.values()];
}

const registries = new Map<string, ReturnType<typeof createDefaultRegistry>>();
function registry(domain: string) {
	const stateDir = resourcesDir(PATHS.data, domain);
	let reg = registries.get(stateDir);
	if (!reg) {
		reg = createDefaultRegistry({ stateDir, libraryRoot: libraryDir(PATHS.data), youtubeApiKey: () => keyValue("YOUTUBE_API_KEY"), youtubeEnrichedOptIn: () => false });
		registries.set(stateDir, reg);
	}
	return reg;
}

type Discovery = "video" | "book";
type SearchResult = { materials: StudyMaterial[]; complete: boolean };

async function discoverVideos(domain: string, item: CurriculumItem, allNodes: CurriculumItem[], manifest: ReturnType<typeof current>["manifest"]): Promise<SearchResult> {
	const id = item.id;
	const outcome = await registry(domain).search({ domainId: domain, nodeId: id, text: item.title, langs: manifest.resourcePolicy.videoAudioLangs, kinds: ["video"], maxResults: 8 }, { providers: ["youtube-data"] });
	const ranked = rankCandidates(outcome.results.map(resource => ({
		resource, link: { resourceId: resource.id, nodeId: id, method: "toc", score: bestMatch({ text: item.title }, resource.title, resource.description), provisional: true },
	})), { policy: manifest.resourcePolicy, nodeLevel: item.level.scheme === "cefr" ? Math.max(0, ["A1","A2","B1","B2","C1","C2"].indexOf(item.level.cefr)) : item.level.band,
		langFit: { englishCefr: item.level.scheme === "cefr" ? item.level.cefr : undefined } }).ranked;
	const results: StudyMaterial[] = [];
	for (const { resource } of ranked.slice(0, 5)) {
		if (!resource.url) continue;
		const chapters = parseDescriptionChapters(resource.description ?? "");
		const matches = chapters.map(ch => ({ ch, nodes: allNodes.filter(n => bestMatch({ text: n.title }, ch.title) >= 0.65).map(n => n.id) })).filter(m => m.nodes.length);
		for (const { ch, nodes } of matches) results.push({ kind: "video", title: resource.title, part: ch.title, lang: resource.lang, url: resource.url + "&t=" + ch.startSec, nodes, suggested: true });
		if (!matches.some(m => m.nodes.includes(id))) results.push({ kind: "video", title: resource.title, part: resource.channelTitle ?? "YouTube", lang: resource.lang, url: resource.url, nodes: [id], suggested: true });
	}
	return { materials: results, complete: !outcome.errors.length && outcome.asked.length > 0 };
}

async function discoverBooks(domain: string, item: CurriculumItem, allNodes: CurriculumItem[]): Promise<SearchResult> {
	const reg = registry(domain);
	const query = { domainId: domain, text: item.title, maxResults: 3, langs: domain === "english" ? ["en"] : ["pt", "en"] };
	const outcome = await reg.search({ ...query, kinds: ["book"] }, { providers: ["wikibooks"] });
	const materials: StudyMaterial[] = [];
	let complete = outcome.asked.length > 0 && !outcome.errors.length;
	for (const book of outcome.results.slice(0, 2)) {
		try {
			const toc = await reg.toc(book.id);
			const ranked = toc.map(section => ({ section, relevance: bestMatch(query, section.title) })).filter(r => r.relevance >= 0.5).sort((a,b) => b.relevance - a.relevance);
			for (const { section } of ranked.slice(0,3)) {
				const part = await reg.resolve(book.id + "#" + section.id);
				if (!part.url || !section.href) continue;
				const matches = allNodes.filter(n => bestMatch({ text: n.title }, section.title) >= 0.65).map(n => n.id);
				materials.push({ kind: "book", title: book.title, part: section.title, lang: book.lang, nodes: [...new Set([item.id, ...matches])], url: part.url, fullBookUrl: book.url, suggested: true });
			}
		} catch { complete = false; }
	}
	return { materials, complete };
}

type StudyMaterialsGlobalState = {
	searches: Map<string, Promise<SearchResult>>;
	downloads: Map<string, Promise<ImportedBook>>;
	lessonIndex: Map<string, { revision: string; nodes: Map<string, string> }>;
};

const STUDY_MATERIALS_STATE_KEY = Symbol.for("learnharness.server.studyMaterials");

function materialsState(): StudyMaterialsGlobalState {
	const g = globalThis as typeof globalThis & { [STUDY_MATERIALS_STATE_KEY]?: StudyMaterialsGlobalState };
	return (g[STUDY_MATERIALS_STATE_KEY] ??= {
		searches: new Map(),
		downloads: new Map(),
		lessonIndex: new Map(),
	});
}

export async function readRegionMaterials(domain: string, id: string, search?: Discovery, allowBackgroundDomain = false): Promise<RegionMaterials> {
	const { item, region, snapshot, view, manifest } = current(domain, id, false, allowBackgroundDomain);
	const ids = new Set<string>();
	function collect(key: string) {
		ids.add(key);
		for (const child of view.nodes.get(key)!.children) collect(child);
	}
	collect(region.id);
	const allNodes = view.ids.map(key => snapshot.items[key]!);
	const members = allNodes.filter(n => ids.has(n.id));
	const localReadings = regionalReadingList(domain, region.id);
	const savedLibrary = listLibrary(libraryDir(PATHS.data));
	const libraryBooks = savedLibrary.map(b => ({ id: b.sha256, title: b.title, format: b.format, ...(b.numPages ? { pages: b.numPages } : {}) }));
	const regionNodes = members.map(n => ({ id: n.id, title: n.title.pt, kind: n.kind }));
	const materials = regionalReading(domain, members, new Set(localReadings.map(r => r.id)), savedLibrary);
	// Manual user-curated node/section materials take highest priority.
	for (const entry of readManualMaterials(domain)) {
		const matched = entry.nodes.filter(key => ids.has(key));
		if (!matched.length && entry.regionId !== region.id) continue;
		materials.unshift({
			kind: entry.kind,
			title: entry.title,
			part: entry.part,
			url: entry.url,
			lang: entry.lang,
			nodes: matched.length ? matched : [region.id],
			suggested: false,
			manual: true,
			manualId: entry.id,
			...(entry.libraryBookId ? { libraryBookId: entry.libraryBookId } : {}),
			...(entry.notes ? { notes: entry.notes } : {}),
		});
	}
	if (domain === "english") {
		for (const source of englishMissionMaterials) {
			const nodes = source.nodes.filter(key => ids.has(key));
			if (nodes.length) materials.unshift({ ...source, nodes });
		}
	}
	const sources = curriculumSources(domain);
	const authored = new Map<string, StudyMaterial>();
	for (const node of members) {
		for (const anchor of node.anchors) {
			const source = sources.get(anchor.source);
			if (!source?.kind || !source.url || !/^https:\/\//i.test(source.url)) continue;
			const key = JSON.stringify([source.id, anchor.ref]);
			const material = authored.get(key) ?? { kind: source.kind, title: source.title, part: anchor.ref,
				url: source.url, lang: source.lang ?? "", nodes: [], suggested: anchor.ref.startsWith("Sugestão"), linkOnly: true };
			if (!material.nodes.includes(node.id)) material.nodes.push(node.id);
			authored.set(key, material);
		}
	}
	materials.push(...authored.values());
	materials.push(...videos.filter(v => v.nodes.some(key => ids.has(key))).map(m => ({ ...m, nodes: [...m.nodes] })));
	const subject = manifest.title.en + " " + manifest.title.pt;
	const videoSearch = true;
	const dir = resourcesDir(PATHS.data, domain);
	const cache = new FileTtlCache(path.join(dir, "discoveries"));
	const shelves = new FileTtlCache(path.join(dir, "region-shelves-v1"));
	const prefix = `v${snapshot.version}:`;
	let message: string | undefined;
	const missing = (["book", "video"] as const).filter(kind => !materials.some(m => m.kind === kind &&
		(m.nodes.includes(region.id) || m.nodes.includes(item.id))));
	const requests = search ? [search] : missing;
	const searches = materialsState().searches;
	await Promise.all(requests.map(async kind => {
		const precise = search && (kind === "book" || keyValue("YOUTUBE_API_KEY"));
		const target = precise ? item : region;
		const key = `${prefix}${kind}:${target.id}`;
		const store = precise ? cache : shelves;
		const flight = store.dir + key;
		let job = searches.get(flight);
		if (!job) {
			job = (async () => {
				const previous = await store.get<StudyMaterial[]>(key, CATALOG_TTL_MS);
				if (previous?.length) return { complete: true, materials: previous };
				if (!search && await store.get<boolean>("miss:" + key, 10 * 60_000)) return { complete: true, materials: [] };
				if (precise) {
					const matches = kind === "book" ? await discoverBooks(domain,item,allNodes) : await discoverVideos(domain,item,allNodes,manifest);
					if (matches.materials.length) {
						await store.set(key, matches.materials);
						return matches;
					}
				}
				const result = await findRegionalSource(domain, { id: region.id, title: region.title.pt, titleEn: region.title.en, objective: region.summary,
					bookQuery: region.title.en, videoQuery: region.title.pt }, kind, AbortSignal.timeout(18000), undefined, subject).catch(() => undefined);
				const found: SearchResult = { complete: !!result, materials: result ? [{ kind, title: result.source.title, url: result.source.url!,
					part: result.ref, lang: result.source.lang ?? "", nodes: [region.id], suggested: result.ref.startsWith("Sugestão"), linkOnly: true }] : [] };
				if (found.materials.length) await store.set(key,found.materials);
				else await store.set("miss:" + key,true);
				return found;
			})().finally(() => searches.delete(flight));
			searches.set(flight,job);
		}
		const result = await job;
		if (search && !result.materials.length) message = "Nenhum material compatível retornou desta busca. Você pode tentar novamente.";
	}));

	const enrichedStore = new FileTtlCache(path.join(dir, "region-enriched-v1"));
	const [discovered, books, lessons, enriched] = await Promise.all([
		cache.valuesWithPrefix<StudyMaterial[]>(prefix, CATALOG_TTL_MS, key => key.startsWith(prefix + "book:") || key.startsWith(prefix + "video:")),
		shelves.get<StudyMaterial[]>(prefix + "book:" + region.id, CATALOG_TTL_MS),
		shelves.get<StudyMaterial[]>(prefix + "video:" + region.id, CATALOG_TTL_MS),
		enrichedStore.get<StudyMaterial[]>(prefix + "enriched:" + region.id, CATALOG_TTL_MS),
	]);
	const discoveries = [...discovered, books ?? [], lessons ?? [], enriched ?? []];
	const dedupeBySuggestedUrl = new Map<string, StudyMaterial>();
	const dedupeKey = (url: string, suggested: boolean | undefined) => `${suggested === undefined ? "u" : suggested ? "1" : "0"}:${url}`;
	for (const mat of materials) {
		const key = dedupeKey(mat.url, mat.suggested);
		if (!dedupeBySuggestedUrl.has(key)) dedupeBySuggestedUrl.set(key, mat);
	}
	for (const match of discoveries.flat()) {
		const within = match.nodes.filter(key => ids.has(key));
		if (!within.length) continue;
		const key = dedupeKey(match.url, match.suggested);
		const same = dedupeBySuggestedUrl.get(key);
		if (same) same.nodes = [...new Set([...same.nodes, ...within])];
		else {
			const entry = { ...match, nodes: within };
			materials.push(entry);
			dedupeBySuggestedUrl.set(key, entry);
		}
	}
	for (const mat of materials) {
		const rep = scoreEducationalReputation({ title: mat.title, url: mat.url, part: mat.part, fullBookUrl: mat.fullBookUrl });
		mat.reputationScore = rep.score;
		if (rep.badge) mat.reputationBadge = rep.badge;
	}
	if (!allowBackgroundDomain && activeDomainId() !== domain) throw new StudyError(409, "O domínio ativo mudou.");
	const positions = new Map(members.map((m, i) => [m.id, i]));
	const firstPos = new Map<StudyMaterial, number>();
	for (const m of materials) {
		let min = Infinity;
		for (const k of m.nodes) {
			const pos = positions.get(k);
			if (pos !== undefined && pos < min) min = pos;
		}
		firstPos.set(m, min);
	}
	materials.sort((a, b) =>
		Number(!!b.manual) - Number(!!a.manual)
		|| (firstPos.get(a) ?? Infinity) - (firstPos.get(b) ?? Infinity)
		|| Number(!!a.suggested) - Number(!!b.suggested)
		|| (b.reputationScore ?? 0) - (a.reputationScore ?? 0),
	);
	return { region: region.id, materials, localReadings, regionNodes, libraryBooks, references: readingReferences(domain, members), videoSearch, message };
}

export const MAX_MATERIALS_PER_NODE = 10;
export const QUALITY_UPGRADE_THRESHOLD = 0.7;

function qualityRank(mat: Pick<StudyMaterial, "title" | "url" | "part" | "fullBookUrl" | "suggested">): number {
	const rep = scoreEducationalReputation({ title: mat.title, url: mat.url, part: mat.part, fullBookUrl: mat.fullBookUrl });
	return rep.score + (mat.suggested ? 0 : 8);
}

/**
 * Enforces a hard ceiling of `cap` (default 10) materials per node.
 * Once a node reaches `upgradeRatio` (default 70% = 7 items), new candidates are
 * admitted only if they improve quality, replacing lower-ranked enriched entries
 * when at the cap while never removing manual or fixed curriculum anchors.
 */
export function mergeEnrichedMaterialsWithCap(
	baseFixed: readonly StudyMaterial[],
	existingCached: readonly StudyMaterial[],
	candidates: readonly StudyMaterial[],
	cap = MAX_MATERIALS_PER_NODE,
	upgradeRatio = QUALITY_UPGRADE_THRESHOLD,
): { merged: StudyMaterial[]; upgraded: number; atCap: boolean } {
	const upgradeThreshold = Math.ceil(cap * upgradeRatio);
	const fixedByNode = new Map<string, number>();
	const fixedUrls = new Set<string>();
	for (const mat of baseFixed) {
		fixedUrls.add(mat.url);
		for (const nid of mat.nodes) fixedByNode.set(nid, (fixedByNode.get(nid) ?? 0) + 1);
	}

	const pool: StudyMaterial[] = existingCached
		.filter(m => !fixedUrls.has(m.url))
		.map(m => ({ ...m, nodes: [...new Set(m.nodes)] }));

	const countForNode = (nid: string) => {
		let count = fixedByNode.get(nid) ?? 0;
		for (const item of pool) if (item.nodes.includes(nid)) count++;
		return count;
	};

	const rankedCandidates = [...candidates]
		.filter(c => !fixedUrls.has(c.url))
		.sort((a, b) => qualityRank(b) - qualityRank(a));

	let upgraded = 0;

	for (const candidate of rankedCandidates) {
		const candScore = qualityRank(candidate);
		const existing = pool.find(m => m.url === candidate.url);
		const acceptedNodes: string[] = [];

		for (const nid of candidate.nodes) {
			if (existing?.nodes.includes(nid)) continue;
			const currentCount = countForNode(nid);
			if (currentCount < upgradeThreshold) {
				acceptedNodes.push(nid);
				continue;
			}
			// Quality upgrade mode (>= 70% of cap)
			const nodeItems = pool.filter(m => m.nodes.includes(nid));
			let worstItem: StudyMaterial | undefined;
			let worstScore = Infinity;
			for (const item of nodeItems) {
				const s = qualityRank(item);
				if (s < worstScore) {
					worstScore = s;
					worstItem = item;
				}
			}
			if (currentCount < cap) {
				// Between 70% and 100%: only add if quality is at least as good as the current floor or strong (>= 55)
				if (candScore >= Math.min(55, worstScore)) {
					acceptedNodes.push(nid);
				}
			} else if (worstItem && candScore > worstScore) {
				// At cap (10/10): replace the weakest enriched entry on this node with the higher-reputation source
				worstItem.nodes = worstItem.nodes.filter(k => k !== nid);
				if (!worstItem.nodes.length) {
					const idx = pool.indexOf(worstItem);
					if (idx >= 0) pool.splice(idx, 1);
				}
				acceptedNodes.push(nid);
				upgraded++;
			}
		}

		if (!acceptedNodes.length) continue;
		if (existing) {
			existing.nodes = [...new Set([...existing.nodes, ...acceptedNodes])];
		} else {
			pool.push({ ...candidate, nodes: acceptedNodes });
		}
	}

	// Final safety trim: ensure no node exceeds `cap` enriched+fixed items (drop weakest enriched entries first).
	const touchedNodes = new Set<string>();
	for (const item of pool) for (const nid of item.nodes) touchedNodes.add(nid);
	let atCap = false;
	for (const nid of touchedNodes) {
		const fixedCount = fixedByNode.get(nid) ?? 0;
		const allowed = Math.max(0, cap - fixedCount);
		const nodeItems = pool.filter(m => m.nodes.includes(nid));
		if (fixedCount + nodeItems.length >= cap) atCap = true;
		if (nodeItems.length > allowed) {
			nodeItems.sort((a, b) => qualityRank(b) - qualityRank(a));
			const toDrop = nodeItems.slice(allowed);
			for (const drop of toDrop) {
				drop.nodes = drop.nodes.filter(k => k !== nid);
			}
		}
	}
	const finalPool = pool.filter(m => m.nodes.length > 0);
	if (!atCap) {
		for (const [nid, cnt] of fixedByNode) {
			if (cnt >= cap) { atCap = true; break; }
		}
	}
	return { merged: finalPool, upgraded, atCap };
}

export interface EnrichRegionResult extends RegionMaterials {
	addedBooks: number;
	addedVideos: number;
	upgraded: number;
	atCap: boolean;
}

/**
 * Expand and upgrade a region/node's materials with higher-reputation academic
 * textbooks, open PDFs, and university lectures, cross-linked to matching skills.
 * Enforces MAX_MATERIALS_PER_NODE (10) and switches to quality-upgrade mode at >= 70%.
 */
export async function enrichRegionMaterials(
	domain: string,
	id: string,
	fetchMetadata?: Parameters<typeof enrichRegionalCatalog>[3],
	options?: { allowBackgroundDomain?: boolean; signal?: AbortSignal },
): Promise<EnrichRegionResult> {
	const allowBg = Boolean(options?.allowBackgroundDomain);
	const { item, region, snapshot, view, manifest } = current(domain, id, false, allowBg);
	const ids = new Set<string>();
	function collect(key: string) {
		ids.add(key);
		for (const child of view.nodes.get(key)!.children) collect(child);
	}
	collect(region.id);
	const members = view.ids.map(key => snapshot.items[key]!).filter(n => ids.has(n.id));
	const childSkills = members.filter(n => n.id !== region.id).map(n => ({ id: n.id, title: n.title.pt, titleEn: n.title.en }));

	const before = await readRegionMaterials(domain, id, undefined, allowBg);
	const beforeUrls = new Set(before.materials.map(m => m.url));

	const dir = resourcesDir(PATHS.data, domain);
	const enrichedStore = new FileTtlCache(path.join(dir, "region-enriched-v1"));
	const prefix = `v${snapshot.version}:`;
	const cacheKey = prefix + "enriched:" + region.id;
	const existingCached = (await enrichedStore.get<StudyMaterial[]>(cacheKey, CATALOG_TTL_MS)) ?? [];
	const existingCachedUrls = new Set(existingCached.map(m => m.url));
	const baseFixed = before.materials.filter(m => !existingCachedUrls.has(m.url));

	const subject = manifest.title.en + " " + manifest.title.pt;
	const focusQueryEn = item.id !== region.id ? `${region.title.en} ${item.title.en}` : region.title.en;
	const focusQueryPt = item.id !== region.id ? `${region.title.pt} ${item.title.pt}` : region.title.pt;
	const timeoutSignal = AbortSignal.timeout(25000);
	const fetchSignal = options?.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;

	const found = await enrichRegionalCatalog(
		domain,
		{
			id: region.id,
			title: region.title.pt,
			titleEn: region.title.en,
			objective: region.summary,
			bookQuery: focusQueryEn,
			videoQuery: focusQueryPt,
			skills: childSkills,
		},
		fetchSignal,
		fetchMetadata,
		subject,
	).catch(() => []);

	const nextItems: StudyMaterial[] = [];
	const pushEntry = (entry: StudyMaterial) => {
		const existing = nextItems.find(m => m.url === entry.url);
		if (existing) existing.nodes = [...new Set([...existing.nodes, ...entry.nodes])];
		else nextItems.push(entry);
	};

	for (const row of found) {
		const url = row.source.url;
		if (!url || !row.source.kind) continue;
		const matchedSkillIds = (row.skillAnchors ?? []).map(a => a.skillId).filter(k => ids.has(k));
		const nodes = [...new Set([region.id, ...(item.id !== region.id ? [item.id] : []), ...matchedSkillIds])];
		pushEntry({
			kind: row.source.kind,
			title: row.source.title,
			part: row.ref,
			url,
			lang: row.source.lang ?? "",
			nodes,
			suggested: row.ref.startsWith("Sugestão"),
			linkOnly: true,
		});
		for (const anchor of row.skillAnchors ?? []) {
			if (!anchor.url || anchor.url === url || !ids.has(anchor.skillId)) continue;
			pushEntry({
				kind: row.source.kind,
				title: row.source.title,
				part: anchor.ref,
				url: anchor.url,
				lang: row.source.lang ?? "",
				nodes: [anchor.skillId],
				suggested: false,
				linkOnly: true,
			});
		}
	}

	// Also match any high-reputation open PDFs/books from the shipped catalog for this domain.
	for (const book of catalog(domain)) {
		if (!book.downloadUrl && !book.url) continue;
		const targetUrl = book.downloadUrl ?? book.url;
		if (!targetUrl || !/^https:\/\//i.test(targetUrl)) continue;
		const matchedNodes = members
			.filter(n => bestMatch({ text: n.title }, book.title) >= 0.5)
			.map(n => n.id);
		if (!matchedNodes.length) continue;
		pushEntry({
			kind: "book",
			title: book.title,
			part: book.downloadUrl ? "Livro completo em PDF aberto" : "Livro-texto de referência",
			url: book.url ?? targetUrl,
			fullBookUrl: book.downloadUrl ?? book.url,
			bookKey: book.downloadUrl ? book.key : undefined,
			lang: book.lang,
			nodes: matchedNodes,
			suggested: false,
		});
	}

	const { merged, upgraded, atCap } = mergeEnrichedMaterialsWithCap(baseFixed, existingCached, nextItems);
	if (merged.length) await enrichedStore.set(cacheKey, merged);

	const after = await readRegionMaterials(domain, id, undefined, allowBg);
	const addedBooks = after.materials.filter(m => m.kind === "book" && !beforeUrls.has(m.url)).length;
	const addedVideos = after.materials.filter(m => m.kind === "video" && !beforeUrls.has(m.url)).length;
	const addedTotal = addedBooks + addedVideos;
	const summary = upgraded > 0
		? `Acervo qualificado: +${addedBooks} leitura(s) e +${addedVideos} vídeo(s) (${upgraded} substituído(s) por fontes melhores; limite ${MAX_MATERIALS_PER_NODE}/nó).`
		: addedTotal > 0
			? `Acervo ampliado e qualificado: +${addedBooks} leitura(s) e +${addedVideos} vídeo(s) vinculados (limite ${MAX_MATERIALS_PER_NODE}/nó).`
			: atCap
				? `Acervo no limite de qualidade (${MAX_MATERIALS_PER_NODE}/nó): nenhuma fonte superior encontrada.`
				: "Acervo verificado: as fontes de referência disponíveis já estão vinculadas nesta região.";
	return { ...after, message: summary, addedBooks, addedVideos, upgraded, atCap };
}

export async function updateRegionalReading(domain: string, id: string, request: Request) {
	const { region, snapshot, view } = current(domain, id);
	if (request.method === "DELETE") {
		unlinkRegionalReading(domain, region.id, new URL(request.url).searchParams.get("pdf") ?? "");
	} else {
		let form: FormData;
		try { form = await readBoundedFormData(request, MAX_BOOK_BODY_BYTES, request.signal); }
		catch (e) { throw new StudyError(e instanceof FormBodyLimitError ? 413 : 400, "Selecione um PDF ou EPUB de até 64 MiB."); }
		const file = form.get("file");
		if (!file || typeof file === "string" || !file.size || file.size > MAX_BOOK_BYTES) throw new StudyError(400, "Selecione um PDF ou EPUB de até 64 MiB.");
		const bytes = new Uint8Array(await file.arrayBuffer());
		if (!detectFormat(bytes)) throw new StudyError(400, "Formato inválido. Selecione um PDF ou EPUB.");
		let book: ImportedBook;
		try { book = await importBookFile({ libraryRoot: libraryDir(PATHS.data), bytes, fileName: file.name, signal: request.signal }); }
		catch { throw new StudyError(422, "Não foi possível ler o livro. Confira se ele abre sem senha."); }
		current(domain, id);
		linkRegionalReading(domain, region.id, book.meta);
		const sectionPart = typeof form.get("part") === "string" ? String(form.get("part")).trim() : "";
		const rawNodes = typeof form.get("nodes") === "string" ? String(form.get("nodes")).trim() : "";
		let targetNodes: string[] = [];
		if (rawNodes) {
			try {
				const parsed = JSON.parse(rawNodes);
				if (Array.isArray(parsed)) targetNodes = parsed.filter((n): n is string => typeof n === "string" && view.nodes.has(n));
			} catch { /* ignore malformed optional nodes */ }
		}
		// Link to every region touched by selected nodes so the reader and tutor can recall passages everywhere.
		for (const nodeId of targetNodes) {
			let r = snapshot.items[nodeId];
			while (r && r.kind !== "unit" && r.parentId) r = snapshot.items[r.parentId];
			if (r?.kind === "unit" && r.id !== region.id) linkRegionalReading(domain, r.id, book.meta);
		}
		if (sectionPart || targetNodes.length) {
			const nodes = targetNodes.length ? targetNodes : [id];
			const readerUrl = "/ler/" + encodeURIComponent(book.meta.sha256) + "?" + new URLSearchParams({ domain, region: region.id, node: id });
			addManualMaterial(domain, {
				kind: "book",
				title: book.meta.title,
				part: sectionPart || "Livro completo · leitura no app",
				url: readerUrl,
				lang: "pt",
				nodes,
				regionId: region.id,
				libraryBookId: book.meta.sha256,
			});
		}
	}
	return readRegionMaterials(domain, id);
}

export async function updateManualNodeMaterial(domain: string, id: string, request: Request) {
	const { region, snapshot, view } = current(domain, id);
	if (request.method === "DELETE") {
		const materialId = new URL(request.url).searchParams.get("id") ?? "";
		if (!materialId) throw new StudyError(400, "Informe o identificador do material.");
		removeManualMaterial(domain, materialId);
		return readRegionMaterials(domain, id);
	}
	let body: unknown;
	try { body = await request.json(); }
	catch { throw new StudyError(400, "Corpo JSON inválido."); }
	if (!body || typeof body !== "object") throw new StudyError(400, "Dados do material inválidos.");
	const data = body as Record<string, unknown>;
	const kind = data.kind === "book" || data.kind === "video" ? data.kind : undefined;
	if (!kind) throw new StudyError(400, "Escolha o tipo: livro/PDF ou vídeo.");
	const requestedNodes = Array.isArray(data.nodes)
		? data.nodes.filter((n): n is string => typeof n === "string" && view.nodes.has(n))
		: [];
	const targetNodes = requestedNodes.length ? [...new Set(requestedNodes)] : [id];
	const libraryBookId = typeof data.libraryBookId === "string" && /^[a-f0-9]{64}$/i.test(data.libraryBookId.trim())
		? data.libraryBookId.trim()
		: undefined;
	let title = typeof data.title === "string" ? data.title.trim() : "";
	let url = typeof data.url === "string" ? data.url.trim() : "";
	const part = typeof data.part === "string" ? data.part.trim() : "";
	const lang = typeof data.lang === "string" ? data.lang.trim() : "pt";
	const notes = typeof data.notes === "string" ? data.notes.trim() : undefined;

	if (libraryBookId) {
		const saved = listLibrary(libraryDir(PATHS.data)).find(b => b.sha256 === libraryBookId);
		if (!saved) throw new StudyError(404, "Livro da biblioteca não encontrado.");
		title = title || saved.title;
		url = "/ler/" + encodeURIComponent(saved.sha256) + "?" + new URLSearchParams({ domain, region: region.id, node: id });
		// Ensure the PDF is indexed in every region covered by the selected nodes.
		const touchedRegions = new Set<string>([region.id]);
		for (const nodeId of targetNodes) {
			let r = snapshot.items[nodeId];
			while (r && r.kind !== "unit" && r.parentId) r = snapshot.items[r.parentId];
			if (r?.kind === "unit") touchedRegions.add(r.id);
		}
		for (const regId of touchedRegions) linkRegionalReading(domain, regId, saved);
	}
	try {
		addManualMaterial(domain, {
			kind: libraryBookId ? "book" : kind,
			title,
			part: part || (libraryBookId ? "Seção vinculada · leitura no app" : title),
			url,
			lang: lang || "pt",
			nodes: targetNodes,
			regionId: region.id,
			...(libraryBookId ? { libraryBookId } : {}),
			...(notes ? { notes } : {}),
		});
	} catch (error) {
		throw new StudyError(400, error instanceof Error ? error.message : "Não foi possível salvar o material.");
	}
	return readRegionMaterials(domain, id);
}

export async function downloadRegionalBook(domain: string, id: string, key: string) {
	const region = await readRegionMaterials(domain,id);
	const book = catalog(domain).find(b => b.key === key);
	if (!book?.downloadUrl || !region.materials.some(m => m.bookKey === key)) throw new StudyError(404,"Livro indisponível nesta região.");
	if (region.materials.some(m => m.bookKey === key && m.saved)) return region;
	const libraryRoot = libraryDir(PATHS.data);
	const existing = listLibrary(libraryRoot).find(b => b.origin.kind === "url" && b.origin.href === book.downloadUrl);
	if (existing) {
		linkRegionalReading(domain, region.region, existing);
		return readRegionMaterials(domain, id);
	}
	const downloads = materialsState().downloads;
	const flight = libraryRoot + "/" + key;
	let download = downloads.get(flight);
	if (!download) {
		download = importFromUrl({ url: book.downloadUrl, fetch: createResourceFetch(),
			fileName: book.key + ".pdf", libraryRoot, license: seedLicense(book), title: book.title })
			.finally(() => downloads.delete(flight));
		downloads.set(flight,download);
	}
	let imported: ImportedBook;
	try { imported = await download; }
	catch { throw new StudyError(502,"Não foi possível importar o PDF da editora. O link de leitura continua disponível."); }
	current(domain, id);
	linkRegionalReading(domain, region.region, imported.meta);
	return readRegionMaterials(domain,id);
}

export function lessonNodeOfChat(domain: string | null, chat: string) {
	if (!domain) return null;
	const revision = studyLogRevision(domain);
	const indexMap = materialsState().lessonIndex;
	const key = `${PATHS.data}|${domain}`;
	const cached = indexMap.get(key);
	if (revision !== undefined && cached?.revision === revision) return cached.nodes.get(chat) ?? null;
	const nodes = new Map<string, string>();
	for (const ev of readStudyEvents(domain)) {
		if (ev.kind === "exposure" && ev.source === "ai_lesson" && ev.sessionId && !nodes.has(ev.sessionId))
			nodes.set(ev.sessionId, ev.nodeId);
	}
	// A pending chat event may have been recovered while reading the log.
	if (revision === undefined) indexMap.delete(key);
	else indexMap.set(key, { revision, nodes });
	return nodes.get(chat) ?? null;
}

export function lessonBooks(domain: string, chatId: string) {
	const nodeId = lessonNodeOfChat(domain, chatId);
	if (!nodeId) return [];
	return booksForLessonNode(domain, nodeId);
}

function booksForLessonNode(domain: string, nodeId: string) {
	const { region } = current(domain, nodeId, true);
	return regionalReadingList(domain, region.id).map(book => ({ region: region.id, book: book.id, title: book.title }));
}

function relevantMaterials(shelf: RegionMaterials, node: string) {
	return shelf.materials.filter(m => m.nodes.includes(node) || m.nodes.includes(shelf.region))
		.sort((a, b) => Number(!!b.manual) - Number(!!a.manual)
			|| Number(b.nodes.includes(node)) - Number(a.nodes.includes(node))
			|| Number(!!a.suggested) - Number(!!b.suggested));
}

/** Resolve attachments on demand. Only links and locators enter the teacher's context. */
export async function attachStudyMaterials(domain: string | null, node: string | null, topic: string, signal: AbortSignal = AbortSignal.timeout(26000), readingBook?: string): Promise<StudyAttachments> {
	const items: StudyAttachments["items"] = [];
	const deadline = AbortSignal.any([signal, AbortSignal.timeout(25000)]);
	const checkScope = () => {
		signal.throwIfAborted();
		if (activeDomainId() !== domain) throw new StudyError(409, "O domínio ativo mudou.");
	};
	checkScope();
	let materials: StudyMaterial[] = [];
	if (domain && node && current(domain, node, true).region.kind === "unit") {
		const shelf = await readRegionMaterials(domain, node);
		checkScope();
		materials = relevantMaterials(shelf, node);
		const local = shelf.localReadings?.filter(b => b.readable) ?? [];
		const book = local.find(b => b.id === readingBook) ?? rankByMatch(local, { text: { pt: topic } }, b => b, 0.6)[0];
		if (book) items.push({ kind: "book", title: book.title, part: "Livro da biblioteca desta região",
			url: "/ler/" + encodeURIComponent(book.id) + "?" + new URLSearchParams({ domain, region: shelf.region, node }) });
	}
	const readings = materials.filter(m => m.kind === "book");
	const whole = readings.find(m => m.fullBookUrl?.startsWith("https://"));
	if (!items.length && whole?.fullBookUrl) items.push({ kind: "book", title: whole.title, url: whole.fullBookUrl,
		part: whole.part, sectionUrl: whole.url, suggested: whole.suggested });
	for (const reading of readings.slice(0, 2)) {
		if (items.some(i => i.url === reading.url || i.sectionUrl === reading.url || (i.title === reading.title && i.part === reading.part))) continue;
		items.push({ kind: "reading", title: reading.title, url: reading.url, part: reading.part, suggested: reading.suggested });
	}
	const matchedVideos = materials.filter(m => m.kind === "video").slice(0, 2);
	const query = { domainId: domain ?? "general", text: { pt: topic, en: topic }, langs: ["pt", "en"], maxResults: 5, signal: deadline };
	const [openBook, foundVideo] = await Promise.all([
		items.some(item => item.kind === "book" || item.kind === "reading") ? undefined : (async () => {
			const fetch = createResourceFetch({ timeoutMs: 5000 });
			const reg = createDefaultRegistry({ stateDir: path.join(PATHS.data, "catalog-cache"), libraryRoot: libraryDir(PATHS.data),
				youtubeApiKey: () => undefined, youtubeEnrichedOptIn: () => false, fetch: (url, init) => fetch(url, { ...init, signal: deadline }) });
			const result = await reg.search({ ...query, kinds: ["book"] }, { providers: ["wikibooks"] });
			return rankByMatch(result.results.filter(r => r.url?.startsWith("https://")), query, r => ({ title: r.title, body: r.description }))[0];
		})().catch(() => undefined),
		matchedVideos.length ? undefined : findRegionalSource(domain ?? "general", { id: "topic", title: topic, bookQuery: topic, videoQuery: topic }, "video", deadline).catch(() => undefined),
	]);
	checkScope();
	if (openBook?.url) items.unshift({ kind: "book", title: openBook.title, url: openBook.url, part: "Livro aberto no Wikibooks", suggested: true });
	for (const video of matchedVideos) {
		if (!items.some(i => i.url === video.url)) {
			items.push({ kind: "video", title: video.title, url: video.url, part: video.part, suggested: video.suggested });
		}
	}
	if (!matchedVideos.length && foundVideo?.source.url) items.push({ kind: "video", title: foundVideo.source.title, url: foundVideo.source.url, part: foundVideo.ref, suggested: true });
	return { items };
}

export function lessonPdfShelf(domain: string, chat: string, node = lessonNodeOfChat(domain, chat)) {
	if (!node) return [];
	const root = libraryDir(PATHS.data);
	return booksForLessonNode(domain, node).flatMap(entry => {
		const meta = readLibraryItem(root, entry.book)?.meta;
		if (!meta?.numPages || meta.format !== "pdf") return [];
		const fileTitle = path.parse(meta.fileName).name;
		const title = /^untitled$/i.test(entry.title) ? fileTitle : entry.title;
		return [{ ...entry, fileTitle, title, pages: meta.numPages }];
	});
}

async function excerptFor(domain: string, material: StudyMaterial): Promise<string> {
	if (material.libraryBookId) {
		const library = libraryDir(PATHS.data);
		const chunks = readLibraryChunks(library, material.libraryBookId);
		const match = chunks.map(c => ({ c, score: bestMatch({ text: { pt: material.part, en: material.part } }, c.breadcrumb.join(" "), c.text) }))
			.sort((a, b) => b.score - a.score)[0];
		if (match?.c.text) return match.c.text.slice(0, 1600);
		return "";
	}
	if (material.saved && material.bookKey) {
		const book = catalog(domain).find(b => b.key === material.bookKey);
		const library = libraryDir(PATHS.data);
		const copy = listLibrary(library).find(b => b.origin.kind === "url" && b.origin.href === book?.downloadUrl);
		if (copy) {
			const chunks = readLibraryChunks(library,copy.sha256);
			const match = chunks.map(c => ({ c, score: bestMatch({ text: { en: material.part } },c.breadcrumb.join(" "), c.text) }))
				.sort((a,b) => b.score-a.score)[0];
			if (match && match.score >= 0.65) return match.c.text.slice(0,1600);
		}
	}
	if (!/^https:\/\//i.test(material.url)) return "";
	const address = new URL(material.url);
	const anchor = address.hash.slice(1);
	address.hash = "";
	const cache = new FileTtlCache(path.join(resourcesDir(PATHS.data, domain), "readings"));
	const fetch = createResourceFetch({ timeoutMs: 4500 });
	const html = await cachedText({ fetch, cache }, address.href, "study-reading", CATALOG_TTL_MS);
	const { document } = parseHTML(html);
	if (anchor) {
		const marker = document.getElementById(anchor) ?? document.querySelector(`a[name="${anchor}"]`);
		if (!marker) return "";
		const heading = marker.closest("h1,h2,h3") ?? marker;
		const chunks: string[] = [];
		for (let p = heading.nextElementSibling; p && !/^H[1-3]$/.test(p.tagName) && chunks.join(" ").length < 1600; p = p.nextElementSibling) {
			if (p.matches("p,ul,ol,blockquote")) chunks.push(p.textContent?.trim() ?? "");
		}
		return chunks.join(" ").slice(0, 1600);
	}
	const article = document.querySelector(".entry-content,.chapter,article,main") ?? document.body;
	return [...article.querySelectorAll("p")].map(p => p.textContent?.trim()).filter(s => s && s.length > 50).join(" ").slice(0, 1600);
}

export async function studyMapLesson(domain: string, id: string, withReading = false) {
	const { item, region, snapshot, view } = current(domain, id, true);
	const node = view.nodes.get(item.id)!;
	const brief = nodeBrief(snapshot, id)!;
	const { minNewMinutes, maxNewMinutes } = LEARNER_CONSTANTS.planner;
	const campaign = studyCampaign(snapshot, view, new Set());
	const limit = campaign.lessonMinutes.get(id) ?? maxNewMinutes;
	const minutes = Math.round(Math.min(limit, maxNewMinutes, Math.max(minNewMinutes, node.hoursMid * 60)));
	const { events } = readLearnerHistory(domain, snapshot, view, new Date().toISOString());
	const finished = finishedExposures(events);
	const closedForReinforcement = new Set(events.flatMap(e => e.kind === "lesson-finished" && e.outcome === "reinforce" ? [e.exposureId] : []));
	const domainChatsDir = chatsDir(PATHS.data, domain);
	const chatExists = (sessionId: string) => /^[A-Za-z0-9_-]+$/.test(sessionId) && fs.existsSync(path.join(domainChatsDir, `${sessionId}.json`));
	const activeMain = events.findLast(
		e => e.kind === "exposure"
			&& !finished.has(e.id)
			&& !e.exploratory
			&& e.source === "ai_lesson"
			&& e.nodeId === id
			&& e.sessionId
			&& chatExists(e.sessionId),
	);
	const completedMain = events.findLast(
		e => e.kind === "exposure"
			&& finished.has(e.id)
			&& !closedForReinforcement.has(e.id)
			&& !e.exploratory
			&& e.source === "ai_lesson"
			&& e.nodeId === id
			&& e.sessionId
			&& chatExists(e.sessionId),
	);
	const side = events.findLast(
		e => e.kind === "exposure"
			&& !closedForReinforcement.has(e.id)
			&& !!e.exploratory
			&& e.source === "ai_lesson"
			&& e.nodeId === id
			&& e.sessionId
			&& chatExists(e.sessionId),
	);
	const regionMaterials: RegionMaterials = region.kind === "unit" ? await readRegionMaterials(domain, id) : { region: id, materials: [], references: [], videoSearch: false };
	const materials = relevantMaterials(regionMaterials, id);
	let excerpt = "";
	const book = materials.find(m => m.kind === "book");
	if (withReading && book && !book.linkOnly) excerpt = await excerptFor(domain, book).catch(() => "");
	if (activeDomainId() !== domain) throw new StudyError(409, "O domínio ativo mudou.");
	const { route, missing } = node.isLeaf ? lessonRoute(domain, view, events, id, snapshot) : { route: [], missing: [] };
	const activeSessionId = activeMain?.kind === "exposure" ? activeMain.sessionId : undefined;
	const completedSessionId = completedMain?.kind === "exposure" ? completedMain.sessionId : undefined;
	return {
		brief,
		minutes,
		finale: campaignFinale(snapshot, campaign, id),
		sessionId: activeSessionId,
		...(activeSessionId ? { activeSessionId } : {}),
		...(completedSessionId ? { completedSessionId } : {}),
		explorationId: side?.kind === "exposure" ? side.sessionId : undefined,
		regionMaterials,
		materials,
		excerpt,
		route,
		missing,
	};
}
