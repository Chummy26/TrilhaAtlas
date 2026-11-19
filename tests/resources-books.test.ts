/**
 * Resources — open-book and metadata adapters with MOCKED network, from
 * small JSON/XML/HTML fixtures (SÍNTESE §2.8 "Livros"; r6 §9–§12): OpenStax
 * (CMS + release.json + archive tree), LibreTexts, OTL, Open Library (search
 * + printed TOC), Crossref (book-chapter TOC), arXiv (Atom), Wikibooks
 * (MediaWiki API) and Kuphaldt (ibiblio index). Every request goes through
 * the real allowlisted fetch, so the hosts each adapter uses are checked too.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { validateToc } from "../src/core/resources/index.ts";
import { ResourceError } from "../src/core/resources/types.ts";
import { createArxivProvider, parseArxivFeed } from "../src/server/resources/arxiv.ts";
import { MemoryTtlCache } from "../src/server/resources/cache.ts";
import { createCrossrefProvider } from "../src/server/resources/crossref.ts";
import { createKuphaldtProvider } from "../src/server/resources/kuphaldt.ts";
import { createLibretextsProvider } from "../src/server/resources/libretexts.ts";
import { createOpenLibraryProvider, openLibraryTocToRaw } from "../src/server/resources/openlibrary.ts";
import { createOpenstaxProvider } from "../src/server/resources/openstax.ts";
import { createOtlProvider } from "../src/server/resources/otl.ts";
import { createResourceFetch, type FetchLike } from "../src/server/resources/safe-fetch.ts";
import { createWikibooksProvider } from "../src/server/resources/wikibooks.ts";

const NOW = Date.parse("2026-11-18T12:00:00Z");

function mockNet(routes: Array<[string | RegExp, () => Response]>): { fetch: ReturnType<typeof createResourceFetch>; urls: string[] } {
	const urls: string[] = [];
	const base: FetchLike = async (raw) => {
		urls.push(raw);
		for (const [match, respond] of routes) if (typeof match === "string" ? raw.startsWith(match) : match.test(raw)) return respond();
		return new Response("not mocked", { status: 404 });
	};
	return { fetch: createResourceFetch({ baseFetch: base }), urls };
}

const deps = (fetch: ReturnType<typeof createResourceFetch>) => ({ fetch, cache: new MemoryTtlCache(() => NOW), now: () => NOW });

// ─── OpenStax ────────────────────────────────────────────────────────────────

const UP2 = "7a0f9770-1c44-4acd-9920-1cd9a99f2a1e";

test("OpenStax: CMS catalog → books with per-book license; release.json + archive tree → TOC; page HTML → chunks", async () => {
	const net = mockNet([
		[
			"https://openstax.org/apps/cms/api/v2/pages/",
			() =>
				Response.json({
					items: [
						{
							title: "University Physics Volume 2",
							book_state: "live",
							license_name: "Creative Commons Attribution-NonCommercial-ShareAlike License",
							license_url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
							cnx_id: UP2,
							webview_rex_link: "https://openstax.org/books/university-physics-volume-2/pages/1-introduction",
							high_resolution_pdf_url: "https://assets.openstax.org/oscms-prodcms/media/documents/UniversityPhysicsVolume2-WEB.pdf",
						},
						{ title: "Retired Book", book_state: "retired", cnx_id: "11111111-2222-3333-4444-555555555555" },
					],
				}),
		],
		["https://openstax.org/rex/release.json", () => Response.json({ archiveUrl: "/apps/archive/20260604.144757", books: { [UP2]: { defaultVersion: "a1b2c3d" } } })],
		[
			`https://openstax.org/apps/archive/20260604.144757/contents/${UP2}@a1b2c3d.json`,
			() =>
				Response.json({
					tree: {
						contents: [
							{ id: "preface@", title: "Preface" },
							{
								id: "chapter-5",
								title: '<span class="os-number">5</span><span class="os-divider"> </span><span class="os-text">Electric Charges and Fields</span>',
								contents: [
									{ id: "page-51@a1b2c3d", title: '<span class="os-number">5.1</span> Electric Charge' },
									{ id: "page-52@a1b2c3d", title: '<span class="os-number">5.2</span> Conductors, Insulators, and Charging by Induction' },
								],
							},
						],
					},
				}),
		],
		[
			`https://openstax.org/apps/archive/20260604.144757/contents/${UP2}@a1b2c3d:page-52.json`,
			() => Response.json({ content: "<h2>Conductors</h2><p>Electrons move freely in a <b>conductor</b>.</p><script>steal()</script><nav>menu</nav>" }),
		],
	]);
	const ox = createOpenstaxProvider(deps(net.fetch));
	const found = await ox.search({ domainId: "electronics", text: { en: "university physics" }, maxResults: 5 });
	assert.deepEqual(
		found.map((r) => r.id),
		[`openstax:${UP2}`],
	);
	const book = found[0]!;
	assert.equal(book.license.nonCommercial, true, "NC flag kept: fetched at runtime, never bundled");
	assert.equal(book.tos, "open_license");
	assert.equal(book.downloads?.[0]?.format, "pdf");
	const toc = await ox.toc(book.id);
	assert.deepEqual(
		toc.map((e) => [e.id, e.title, e.href ?? null]),
		[
			["1", "Preface", "preface"],
			["2", "5 Electric Charges and Fields", null],
			["2.1", "5.1 Electric Charge", "page-51"],
			["2.2", "5.2 Conductors, Insulators, and Charging by Induction", "page-52"],
		],
	);
	const chunks = await ox.content(`${book.id}#2.2`);
	assert.equal(chunks.length, 1);
	assert.match(chunks[0]!.text, /Electrons move freely/);
	assert.doesNotMatch(chunks[0]!.text, /steal|menu/, "scripts and navigation are stripped");
	assert.deepEqual(chunks[0]!.breadcrumb, ["5 Electric Charges and Fields", "5.2 Conductors, Insulators, and Charging by Induction"]);
	assert.equal(chunks[0]!.resourceId, `openstax:${UP2}#2.2`);
	const section = await ox.resolve(`${book.id}#2.1`);
	assert.equal(section.kind, "book_section");
	assert.equal(section.parentId, book.id);
	await assert.rejects(ox.content(`${book.id}#2`), (e: unknown) => e instanceof ResourceError && e.code === "invalid-input");
});

// ─── LibreTexts / OTL ────────────────────────────────────────────────────────

test("LibreTexts: catalog pages parsed defensively, filtered by the domain's libraries, downloads offered", async () => {
	const net = mockNet([
		[
			"https://commons.libretexts.org/api/v1/commons/catalog",
			() =>
				Response.json({
					numTotal: 3,
					books: [
						{ bookID: "eng-1234", title: "DC Electrical Circuit Analysis: A Practical Approach", author: "James M. Fiore", library: "eng", subject: "Electrical Engineering", license: "ccbyncsa", links: { online: "https://eng.libretexts.org/Bookshelves/x", pdf: "https://downloads.libretexts.org/api/v1/download/eng-1234/pdf" } },
						{ bookID: "human-99", title: "Circuit of Poetry", library: "human", license: "ccby" },
						{ bookID: "eng-5", title: "DC Circuits Workbook", library: "eng", license: "" },
					],
				}),
		],
	]);
	const lt = createLibretextsProvider(deps(net.fetch));
	const found = await lt.search({ domainId: "electronics", text: { en: "dc circuit analysis" }, maxResults: 5 });
	assert.equal(found[0]?.id, "libretexts:eng-1234");
	assert.ok(!found.some((r) => r.id === "libretexts:human-99"), "humanities library is not searched for Electronics");
	assert.equal(found[0]!.license.shareAlike, true);
	assert.deepEqual(found[0]!.creators, ["James M. Fiore"]);
	const unlicensed = found.find((r) => r.id === "libretexts:eng-5");
	assert.match(unlicensed!.license.name, /não informada/, "empty license is treated as protected");
	assert.equal(net.urls.length, 1, "a short page ends the paging");
});

test("OTL: domain subject pages (54 = EE), formats → downloads, stops on a page without new ids", async () => {
	const page = {
		data: [
			{
				id: 1001,
				title: "Fundamentals of Electrical Engineering I",
				description: "Signals, circuits and information.",
				license: "CC BY",
				language: "eng",
				copyright_year: 2012,
				contributors: [{ first_name: "Don", last_name: "Johnson", contribution: "Author" }],
				subjects: [{ id: 54, name: "Electrical Engineering" }],
				formats: [
					{ format: "PDF", url: "https://open.umn.edu/opentextbooks/formats/1.pdf" },
					{ format: "Online", url: "https://example.org/online" },
				],
			},
		],
	};
	const net = mockNet([[/^https:\/\/open\.umn\.edu\/opentextbooks\/subjects\/54\.json\?page=\d+$/, () => Response.json(page)]]);
	const otl = createOtlProvider(deps(net.fetch));
	const found = await otl.search({ domainId: "electronics", text: { en: "electrical engineering fundamentals" }, maxResults: 3 });
	assert.equal(found.length, 1);
	const b = found[0]!;
	assert.equal(b.id, "otl:1001");
	assert.equal(b.license.spdx, "CC-BY-4.0");
	assert.deepEqual(b.creators, ["Don Johnson"]);
	assert.deepEqual(
		b.downloads?.map((d) => d.format),
		["pdf", "html"],
	);
	assert.equal(net.urls.length, 2, "page 2 repeated page 1 → stop");
	assert.deepEqual(await otl.search({ domainId: "custom-x", text: { en: "anything" }, maxResults: 3 }), [], "unmapped domains are not crawled");
});

// ─── Open Library ────────────────────────────────────────────────────────────

test("Open Library: search fields → metadata-only work; printed TOC goes to pageLabel, never physical pages", async () => {
	const net = mockNet([
		[
			"https://openlibrary.org/search.json",
			() =>
				Response.json({
					numFound: 1,
					docs: [{ key: "/works/OL1234W", title: "The Art of Electronics", author_name: ["Paul Horowitz", "Winfield Hill"], first_publish_year: 1980, isbn: ["0521809266", "9780521809269"], language: ["eng"], ebook_access: "borrowable", number_of_pages_median: 1192 }],
				}),
		],
		[
			"https://openlibrary.org/works/OL1234W/editions.json",
			() =>
				Response.json({
					entries: [
						{ key: "/books/OL1M", title: "No TOC edition" },
						{
							key: "/books/OL2M",
							table_of_contents: [
								{ level: 0, label: "1", title: "Foundations", pagenum: "1" },
								{ level: 1, label: "1.1", title: "Introduction", pagenum: "1" },
								{ level: 1, label: "1.2", title: "Voltage, current, and resistance", pagenum: "1" },
								{ level: 0, label: "2", title: "Bipolar Transistors", pagenum: "71" },
							],
						},
					],
				}),
		],
	]);
	const ol = createOpenLibraryProvider(deps(net.fetch));
	const [work] = await ol.search({ domainId: "electronics", text: { en: "art of electronics" }, maxResults: 3 });
	assert.equal(work?.id, "ol:OL1234W");
	assert.equal(work?.tos, "metadata_only");
	assert.equal(work?.access, "borrow_link");
	assert.deepEqual(work?.isbn, ["9780521809269"]);
	assert.equal(work?.lang, "en");
	assert.equal(new URL(net.urls[0]!).searchParams.get("fields")?.includes("ebook_access"), true);
	const toc = await ol.toc("ol:OL1234W");
	assert.deepEqual(
		toc.map((e) => [e.id, e.title, e.pageLabel, e.pageFrom]),
		[
			["1", "1 Foundations", "1", undefined],
			["1.1", "1.1 Introduction", "1", undefined],
			["1.2", "1.2 Voltage, current, and resistance", "1", undefined],
			["2", "2 Bipolar Transistors", "71", undefined],
		],
	);
	assert.deepEqual(validateToc(toc), []);
	assert.deepEqual(
		openLibraryTocToRaw(["Prefácio", "Capítulo 1"]).map((n) => n.title),
		["Prefácio", "Capítulo 1"],
		"legacy string items",
	);
});

// ─── Crossref ────────────────────────────────────────────────────────────────

test("Crossref: book metadata (no mailto) and chapter TOC by ISBN sorted by first page", async () => {
	const net = mockNet([
		[
			"https://api.crossref.org/works/10.1007/978-3-032-30677-7",
			() => Response.json({ message: { DOI: "10.1007/978-3-032-30677-7", title: ["Power Electronics"], type: "monograph", ISBN: ["9783032306777"], published: { "date-parts": [[2026]] }, license: [{ URL: "https://creativecommons.org/licenses/by/4.0/" }], author: [{ given: "Ana", family: "Silva" }] } }),
		],
		[
			"https://api.crossref.org/works?",
			() =>
				Response.json({
					message: {
						items: [
							{ DOI: "10.1007/978-3-032-30677-7_2", title: ["Converters"], page: "93-175" },
							{ DOI: "10.1007/978-3-032-30677-7_1", title: ["Fundamentals"], page: "1-91" },
						],
					},
				}),
		],
	]);
	const cr = createCrossrefProvider(deps(net.fetch));
	const book = await cr.resolve("crossref:10.1007/978-3-032-30677-7");
	assert.equal(book.kind, "book");
	assert.equal(book.access, "open", "CC-licensed OA monograph");
	assert.deepEqual(book.creators, ["Ana Silva"]);
	const toc = await cr.toc(book.id);
	assert.deepEqual(
		toc.map((e) => [e.title, e.pageLabel, e.href]),
		[
			["Fundamentals", "1–91", "https://doi.org/10.1007/978-3-032-30677-7_1"],
			["Converters", "93–175", "https://doi.org/10.1007/978-3-032-30677-7_2"],
		],
	);
	const chapterQuery = new URL(net.urls.find((u) => u.includes("filter=isbn"))!);
	assert.equal(chapterQuery.searchParams.get("filter"), "isbn:9783032306777,type:book-chapter");
	assert.ok(net.urls.every((u) => !u.includes("mailto")), "no personal contact is sent");
});

// ─── arXiv ───────────────────────────────────────────────────────────────────

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <title>ArXiv Query</title>
  <entry>
    <id>http://arxiv.org/abs/2207.05872v2</id>
    <published>2022-07-12T23:00:00Z</published>
    <title>Exploring the relationship between surface features and explaining
      quality of YouTube explanatory videos</title>
    <summary>We analyse 60 videos.</summary>
    <author><name>P. Bitzenbauer</name></author>
    <author><name>S. Höfler</name></author>
    <category term="physics.ed-ph" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>`;

test("arXiv: Atom → metadata-only articles (version stripped, abstract link), 1 req / 3 s rate", async () => {
	const [a] = parseArxivFeed(ATOM, new Date(NOW).toISOString());
	assert.equal(a?.id, "arxiv:2207.05872");
	assert.equal(a?.title, "Exploring the relationship between surface features and explaining quality of YouTube explanatory videos");
	assert.deepEqual(a?.creators, ["P. Bitzenbauer", "S. Höfler"]);
	assert.equal(a?.url, "https://arxiv.org/abs/2207.05872");
	assert.equal(a?.tos, "metadata_only");
	const net = mockNet([["https://export.arxiv.org/api/query", () => new Response(ATOM, { headers: { "content-type": "application/atom+xml" } })]]);
	const ax = createArxivProvider(deps(net.fetch));
	assert.equal(ax.rate.minIntervalMs, 3000);
	const found = await ax.search({ domainId: "electronics", text: { en: "explaining quality videos" }, maxResults: 2 });
	assert.equal(found.length, 1);
	const q = new URL(net.urls[0]!).searchParams.get("search_query")!;
	assert.match(q, /all:explaining AND all:quality AND all:videos/);
	assert.match(q, /cat:eess\.SP OR cat:eess\.SY/);
});

test("arXiv (regression): resolve accepts a VERSIONED id and finds its version-less entry", async () => {
	const net = mockNet([["https://export.arxiv.org/api/query", () => new Response(ATOM, { headers: { "content-type": "application/atom+xml" } })]]);
	const ax = createArxivProvider(deps(net.fetch));
	const r = await ax.resolve("arxiv:2207.05872v2");
	assert.equal(r.id, "arxiv:2207.05872");
	assert.equal(new URL(net.urls[0]!).searchParams.get("id_list"), "2207.05872", "the query uses the normalized id");
	await assert.rejects(ax.resolve("arxiv:not-an-id"), (e: unknown) => e instanceof ResourceError && e.code === "invalid-input");
});

// ─── Wikibooks ───────────────────────────────────────────────────────────────

test("Wikibooks: search grouped by book; TOC from the book's subpage links; subpage content → chunks (CC BY-SA)", async () => {
	const net = mockNet([
		[/^https:\/\/en\.wikibooks\.org\/w\/api\.php\?action=query/, () => Response.json({ query: { search: [{ title: "Electronics/Resistors", snippet: 'A <span class="searchmatch">resistor</span> limits current' }, { title: "Electronics/Ohm's Law" }, { title: "Circuit Theory" }] } })],
		[
			/^https:\/\/en\.wikibooks\.org\/w\/api\.php\?action=parse&page=Electronics&/,
			() =>
				Response.json({
					parse: {
						title: "Electronics",
						text: '<div><ul><li><a href="/wiki/Electronics/Foreword">Foreword</a></li><li><a href="/wiki/Electronics/Resistors">Resistors</a><ul><li><a href="/wiki/Electronics/Resistors/Color_Code">Color code</a></li></ul></li><li><a href="/wiki/Electronics/Resistors#x">dup</a></li><li><a href="/wiki/Help:Contents">Help</a></li><li><a href="/wiki/Physics">Physics</a></li></ul></div>',
					},
				}),
		],
		[/^https:\/\/en\.wikibooks\.org\/w\/api\.php\?action=parse&page=Electronics%2FResistors&/, () => Response.json({ parse: { title: "Electronics/Resistors", text: "<p>A resistor obeys Ohm's law.</p>" } })],
	]);
	const wb = createWikibooksProvider(deps(net.fetch));
	const found = await wb.search({ domainId: "electronics", text: { en: "resistor" }, langs: ["en"], maxResults: 5 });
	assert.deepEqual(
		found.map((r) => r.id),
		["wikibooks:en:Electronics", "wikibooks:en:Circuit_Theory"],
	);
	assert.equal(found[0]!.description, "A resistor limits current");
	assert.equal(found[0]!.license.spdx, "CC-BY-SA-4.0");
	assert.match(found[0]!.license.attribution ?? "", /Wikibooks/);
	const toc = await wb.toc("wikibooks:en:Electronics");
	assert.deepEqual(
		toc.map((e) => [e.id, e.title, e.href]),
		[
			["1", "Foreword", "Electronics/Foreword"],
			["2", "Resistors", "Electronics/Resistors"],
			["2.1", "Color code", "Electronics/Resistors/Color_Code"],
		],
	);
	const chunks = await wb.content("wikibooks:en:Electronics#2");
	assert.match(chunks[0]!.text, /obeys Ohm's law/);
	assert.deepEqual(chunks[0]!.breadcrumb, ["Resistors"]);
});

// ─── Kuphaldt ────────────────────────────────────────────────────────────────

test("Kuphaldt (LIEC, CC BY 4.0): static catalog search, chapter TOC from the ibiblio index, HTML chapter content", async () => {
	const index = '<html><body><h1>DC</h1><a href="DC_1.html">Basic concepts of electricity</a> <a href="DC_1.html#sec2">same file</a> <a href="DC_2.html">Ohm\'s Law</a> <a href="../AC/index.html">AC volume</a> <a href="index.html">this</a> <a href="https://www.allaboutcircuits.com/x">mirror</a></body></html>';
	const net = mockNet([
		["https://www.ibiblio.org/kuphaldt/electricCircuits/DC/index.html", () => new Response(index, { headers: { "content-type": "text/html" } })],
		["https://www.ibiblio.org/kuphaldt/electricCircuits/DC/DC_2.html", () => new Response("<h1>Ohm's Law</h1><p>Voltage equals current times resistance.</p>", { headers: { "content-type": "text/html" } })],
	]);
	const k = createKuphaldtProvider(deps(net.fetch));
	const found = await k.search({ domainId: "electronics", text: { en: "ohm law resistance", pt: "lei de Ohm" }, level: 0, maxResults: 3 });
	assert.equal(found[0]?.id, "kuphaldt:liec-dc");
	assert.equal(found[0]?.license.spdx, "CC-BY-4.0");
	assert.deepEqual(await k.search({ domainId: "english", text: { en: "ohm" }, maxResults: 3 }), []);
	const toc = await k.toc("kuphaldt:liec-dc");
	assert.deepEqual(
		toc.map((e) => [e.id, e.title, e.href]),
		[
			["1", "Basic concepts of electricity", "DC_1.html"],
			["2", "Ohm's Law", "DC_2.html"],
		],
	);
	const chunks = await k.content("kuphaldt:liec-dc#2");
	assert.match(chunks[0]!.text, /current times resistance/);
	assert.ok(!net.urls.some((u) => u.includes("allaboutcircuits")), "the derivative mirror is never fetched");
});
