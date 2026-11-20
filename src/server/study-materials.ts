import { findRegionalSource } from "./domain-reading-list.ts";
import { englishMissionMaterials } from "./english-mission-materials.ts";
import { studyCampaign, campaignFinale } from "../core/study/campaign.ts";
import path from "node:path";
import { parseHTML } from "linkedom";
import { FormBodyLimitError, readBoundedFormData } from "../../lib/bounded-form-data.ts";
import { activeDomainId, PATHS } from "../../config.ts";
import sections from "../../content/resources/sections.json" with { type: "json" };
import type { CurriculumItem } from "../core/curriculum/types.ts";
import { libraryDir, resourcesDir } from "../core/domains/paths.ts";
import { LEARNER_CONSTANTS } from "../core/learner/params.ts";
import { booksForDomain, seedLicense } from "../core/resources/catalog.ts";
import { bestMatch, rankByMatch } from "../core/resources/match.ts";
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
import { curriculumSources, lessonRoute, loadCurriculum, studyDomains, StudyError } from "./study.ts";
import { readStudyEvents, studyLogRevision } from "./study-log.ts";
import { getChat } from "./chats.ts";
import { detectFormat, importBookFile, importFromUrl, listLibrary, readLibraryItem, readLibraryChunks, type ImportedBook } from "./resources/user-library.ts";
import { MAX_BOOK_BODY_BYTES, MAX_BOOK_BYTES } from "../../lib/book-import-limits.ts";
import { linkRegionalReading, regionalReadingList, unlinkRegionalReading } from "./resources/region-readings.ts";

const contents: Record<string, { part: string; url: string; nodes?: string[] }[]> = sections;
const videos: StudyMaterial[] = [
	{ kind: "video", title: "Khan Academy Brasil", part: "Introdução à notação científica", url: "https://www.youtube.com/watch?v=JExlrIMYIRE", lang: "pt", nodes: ["ee.math.algebra.sci-notation.powers-of-ten"] },
	{ kind: "video", title: "BBC Learning English", part: "Improve your pronunciation · Introduction", url: "https://www.youtube.com/watch?v=fdRmGvmeY1U", lang: "en", nodes: ["en.pron.foundations.ipa-intro"] },
	{ kind: "video", title: "Física III · Univesp", part: "Aula 19 · Circuitos elétricos e leis de Kirchhoff", url: "https://www.youtube.com/watch?v=ALvobeJOrr4", lang: "pt", nodes: ["ee.dc.laws.kcl", "ee.dc.laws.kvl"] },
	{ kind: "video", title: "Let’s Learn English · VOA", part: "Lesson 1 · Welcome!", url: "https://www.youtube.com/watch?v=WR9_nsLyaEY", lang: "en", nodes: ["en.speaking.a1.greetings"] },
];

function current(domain: string, id: string, overview = false) {
	if (!domain || domain !== activeDomainId()) throw new StudyError(409, "O domínio ativo mudou.");
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

function regionalReading(domain: string, nodes: CurriculumItem[], linked: Set<string>) {
	const saved = listLibrary(libraryDir(PATHS.data));
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

const searches = new Map<string, Promise<SearchResult>>();
export async function readRegionMaterials(domain: string, id: string, search?: Discovery): Promise<RegionMaterials> {
	const { item, region, snapshot, view, manifest } = current(domain, id);
	const ids = new Set<string>();
	function collect(key: string) {
		ids.add(key);
		for (const child of view.nodes.get(key)!.children) collect(child);
	}
	collect(region.id);
	const allNodes = view.ids.map(key => snapshot.items[key]!);
	const members = allNodes.filter(n => ids.has(n.id));
	const localReadings = regionalReadingList(domain, region.id);
	const materials = regionalReading(domain, members, new Set(localReadings.map(r => r.id)));
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

	const [discovered, books, lessons] = await Promise.all([
		cache.valuesWithPrefix<StudyMaterial[]>(prefix, CATALOG_TTL_MS, key => key.startsWith(prefix + "book:") || key.startsWith(prefix + "video:")),
		shelves.get<StudyMaterial[]>(prefix + "book:" + region.id, CATALOG_TTL_MS),
		shelves.get<StudyMaterial[]>(prefix + "video:" + region.id, CATALOG_TTL_MS),
	]);
	const discoveries = [...discovered, books ?? [], lessons ?? []];
	for (const match of discoveries.flat()) {
		const within = match.nodes.filter(key => ids.has(key));
		if (!within.length) continue;
		const same = materials.find(m => m.url === match.url && m.suggested === match.suggested);
		if (same) same.nodes = [...new Set([...same.nodes, ...within])];
		else materials.push({ ...match, nodes: within });
	}
	if (activeDomainId() !== domain) throw new StudyError(409, "O domínio ativo mudou.");
	const positions = new Map(members.map((m,i) => [m.id,i]));
	const firstNode = (m: StudyMaterial) => Math.min(...m.nodes.map(k => positions.get(k) ?? Infinity));
	materials.sort((a,b) => firstNode(a)-firstNode(b) || Number(!!a.suggested)-Number(!!b.suggested));
	return { region: region.id, materials, localReadings, references: readingReferences(domain, members), videoSearch, message };
}

export async function updateRegionalReading(domain: string, id: string, request: Request) {
	const { region } = current(domain, id);
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
	}
	return readRegionMaterials(domain, id);
}

const downloads = new Map<string, Promise<ImportedBook>>();
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

let lessonIndex: { revision: string; nodes: Map<string, string> } | undefined;

export function lessonNodeOfChat(domain: string | null, chat: string) {
	if (!domain) return null;
	const revision = studyLogRevision(domain);
	if (revision !== undefined && lessonIndex?.revision === revision) return lessonIndex.nodes.get(chat) ?? null;
	const nodes = new Map<string, string>();
	for (const ev of readStudyEvents(domain)) {
		if (ev.kind === "exposure" && ev.source === "ai_lesson" && ev.sessionId && !nodes.has(ev.sessionId))
			nodes.set(ev.sessionId, ev.nodeId);
	}
	// A pending chat event may have been recovered while reading the log.
	lessonIndex = revision === undefined ? undefined : { revision, nodes };
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
		.sort((a, b) => Number(b.nodes.includes(node)) - Number(a.nodes.includes(node)) || Number(!!a.suggested) - Number(!!b.suggested));
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
	const reading = materials.find(m => m.kind === "book");
	const whole = materials.find(m => m.kind === "book" && m.fullBookUrl?.startsWith("https://"));
	if (!items.length && whole?.fullBookUrl) items.push({ kind: "book", title: whole.title, url: whole.fullBookUrl,
		part: whole.part, sectionUrl: whole.url, suggested: whole.suggested });
	if (reading && reading.url !== items[0]?.sectionUrl && reading.title !== items[0]?.title) {
		items.push({ kind: "reading", title: reading.title, url: reading.url, part: reading.part, suggested: reading.suggested });
	}
	const video = materials.find(m => m.kind === "video");
	const query = { domainId: domain ?? "general", text: { pt: topic, en: topic }, langs: ["pt", "en"], maxResults: 5, signal: deadline };
	const [openBook, foundVideo] = await Promise.all([
		items.some(item => item.kind === "book") ? undefined : (async () => {
			const fetch = createResourceFetch({ timeoutMs: 5000 });
			const reg = createDefaultRegistry({ stateDir: path.join(PATHS.data, "catalog-cache"), libraryRoot: libraryDir(PATHS.data),
				youtubeApiKey: () => undefined, youtubeEnrichedOptIn: () => false, fetch: (url, init) => fetch(url, { ...init, signal: deadline }) });
			const result = await reg.search({ ...query, kinds: ["book"] }, { providers: ["wikibooks"] });
			return rankByMatch(result.results.filter(r => r.url?.startsWith("https://")), query, r => ({ title: r.title, body: r.description }))[0];
		})().catch(() => undefined),
		video ? undefined : findRegionalSource(domain ?? "general", { id: "topic", title: topic, bookQuery: topic, videoQuery: topic }, "video", deadline).catch(() => undefined),
	]);
	checkScope();
	if (openBook?.url) items.unshift({ kind: "book", title: openBook.title, url: openBook.url, part: "Livro aberto no Wikibooks", suggested: true });
	if (video) items.push({ kind: "video", title: video.title, url: video.url, part: video.part, suggested: video.suggested });
	else if (foundVideo?.source.url) items.push({ kind: "video", title: foundVideo.source.title, url: foundVideo.source.url, part: foundVideo.ref, suggested: true });
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
	const events = readStudyEvents(domain);
	const previous = (exploratory: boolean) => events.findLast(e => e.kind === "exposure" && !!e.exploratory === exploratory && e.source === "ai_lesson" && e.nodeId === id && e.sessionId && getChat(e.sessionId));
	const main = previous(false);
	const side = previous(true);
	const regionMaterials: RegionMaterials = region.kind === "unit" ? await readRegionMaterials(domain, id) : { region: id, materials: [], references: [], videoSearch: false };
	const materials = relevantMaterials(regionMaterials, id);
	let excerpt = "";
	const book = materials.find(m => m.kind === "book");
	if (withReading && book && !book.linkOnly) excerpt = await excerptFor(domain, book).catch(() => "");
	if (activeDomainId() !== domain) throw new StudyError(409, "O domínio ativo mudou.");
	const { route, missing } = node.isLeaf ? lessonRoute(domain,view,events,id) : { route: [], missing: [] };
	return { brief, minutes, finale: campaignFinale(snapshot, campaign, id), sessionId: main?.kind === "exposure" ? main.sessionId : undefined, explorationId: side?.kind === "exposure" ? side.sessionId : undefined, regionMaterials, materials, excerpt, route, missing };
}
