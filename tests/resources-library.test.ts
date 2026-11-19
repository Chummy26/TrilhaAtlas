/**
 * Resources — the learner's library: import of a tiny PDF (tests/helpers/
 * tiny-pdf.ts) and of an EPUB built here with node:zlib into
 * `<library>/<sha256>/` with meta.json, toc.json and chunks.jsonl (SÍNTESE
 * §2.8 "PDF que o usuário já possui", "Ingestão em camadas"; r6 §10–§12;
 * extra-unjs__unpdf §5). Temp directories only — never the repo's data/.
 */
import assert from "node:assert/strict";
import test, { after } from "node:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

import { ResourceError } from "../src/core/resources/types.ts";
import { createResourceFetch, type FetchLike } from "../src/server/resources/safe-fetch.ts";
import { createUserLibraryProvider, detectFormat, extractIsbn, importBookFile, importFromUrl, listLibrary, readLibraryChunks, removeLibraryItem, sha256Hex, textFromItems, writeBinaryAtomic } from "../src/server/resources/user-library.ts";
import { ZipReader, resolveZipPath } from "../src/server/resources/zip.ts";
import { tinyPdf } from "./helpers/tiny-pdf.ts";

const roots: string[] = [];
function tempLibrary(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-resources-lib-"));
	roots.push(dir);
	return dir;
}
after(async () => {
	// fs.promises.rm, not fs.rmSync: the sync one silently skips non-ASCII paths on Windows.
	for (const r of roots) await fs.promises.rm(r, { recursive: true, force: true });
});

const NOW = () => Date.parse("2026-11-18T12:00:00Z");

// ─── minimal ZIP writer (stored + deflate) for the EPUB fixture ──────────────

function zip(entries: Array<{ name: string; data: string; store?: boolean }>): Uint8Array {
	const enc = new TextEncoder();
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const e of entries) {
		const name = Buffer.from(enc.encode(e.name));
		const raw = Buffer.from(enc.encode(e.data));
		const data = e.store ? raw : deflateRawSync(raw);
		const crc = crc32(raw) >>> 0;
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(e.store ? 0 : 8, 8);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(raw.length, 22);
		local.writeUInt16LE(name.length, 26);
		locals.push(local, name, data);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(e.store ? 0 : 8, 10);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt32LE(raw.length, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt32LE(offset, 42);
		centrals.push(central, name);
		offset += 30 + name.length + data.length;
	}
	const cd = Buffer.concat(centrals);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(entries.length, 8);
	eocd.writeUInt16LE(entries.length, 10);
	eocd.writeUInt32LE(cd.length, 12);
	eocd.writeUInt32LE(offset, 16);
	return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
}

const XHTML = (title: string, body: string) => `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body>${body}</body></html>`;

function sampleEpub(): Uint8Array {
	return zip([
		{ name: "mimetype", data: "application/epub+zip", store: true },
		{ name: "META-INF/container.xml", data: '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
		{
			name: "OEBPS/content.opf",
			data: `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Eletrônica de Teste</dc:title><dc:creator>Autora Exemplo</dc:creator><dc:language>pt-BR</dc:language><dc:identifier>urn:isbn:9780306406157</dc:identifier></metadata>
			<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/><item id="c2b" href="text/ch2b.xhtml" media-type="application/xhtml+xml"/><item id="css" href="style.css" media-type="text/css"/></manifest>
			<spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c2b"/></spine></package>`,
		},
		{
			name: "OEBPS/nav.xhtml",
			data: XHTML("Sumário", '<nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><ol><li><a href="text/ch1.xhtml">Capítulo 1 — Carga</a></li><li><a href="text/ch2.xhtml">Capítulo 2 — Lei de Ohm</a><ol><li><a href="text/ch2.xhtml#s1">2.1 Resistência</a></li></ol></li></ol></nav>'),
		},
		{ name: "OEBPS/text/ch1.xhtml", data: XHTML("C1", "<h1>Carga elétrica</h1><p>A carga elétrica é uma propriedade da matéria.</p>") },
		{ name: "OEBPS/text/ch2.xhtml", data: XHTML("C2", '<h1>Lei de Ohm</h1><p>A tensão é o produto da corrente pela resistência.</p><h2 id="s1">Resistência</h2><p>Resistores limitam a corrente.</p>') },
		{ name: "OEBPS/text/ch2b.xhtml", data: XHTML("C2b", "<p>Continuação do capítulo 2 com exercícios.</p><script>alert(1)</script>") },
		{ name: "OEBPS/style.css", data: "p{}" },
	]);
}

function samplePdf(): Uint8Array {
	return tinyPdf([
		{
			runs: [
				{ text: "Capitulo 1 Lei de Ohm", x: 72, y: 720, size: 18 },
				{ text: "O valor da corrente que passa pela resistencia de um circuito com uma fonte", x: 72, y: 680 },
				{ text: "e dado pela lei de Ohm para os circuitos lineares.", x: 72, y: 666 },
			],
		},
		{ runs: [{ text: "ISBN 978-0-306-40615-7", x: 72, y: 700 }] },
	]);
}

/** 4-page PDF with an outline (explicit, mid-page XYZ and NAMED destinations) and /PageLabels (ii, then 1, 2). */
function outlinedPdf(): Uint8Array {
	const page = (contents: number) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 15 0 R >> >> /Contents ${contents} 0 R >>`;
	const stream = (text: string) => {
		const s = `BT /F1 12 Tf 72 700 Td (${text}) Tj ET`;
		return `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;
	};
	const objects: Record<number, string> = {
		1: "<< /Type /Catalog /Pages 2 0 R /Outlines 3 0 R /Dests << /cap2 [10 0 R /Fit] >> /PageLabels << /Nums [0 << /S /r >> 2 << /S /D >>] >> >>",
		2: "<< /Type /Pages /Count 4 /Kids [6 0 R 8 0 R 10 0 R 12 0 R] >>",
		3: "<< /Type /Outlines /First 4 0 R /Last 5 0 R /Count 3 >>",
		4: "<< /Title (Capitulo 1 Carga) /Parent 3 0 R /Next 5 0 R /First 14 0 R /Last 14 0 R /Count 1 /Dest [8 0 R /Fit] >>",
		5: "<< /Title (Capitulo 2 Ohm) /Parent 3 0 R /Prev 4 0 R /Dest /cap2 >>",
		6: page(7),
		7: stream("Prefacio do livro"),
		8: page(9),
		9: stream("Capitulo 1 texto sobre carga eletrica"),
		10: page(11),
		11: stream("Capitulo 2 texto sobre a lei de Ohm"),
		12: page(13),
		13: stream("Continuacao do capitulo 2"),
		14: "<< /Title (1.1 Conservacao da carga) /Parent 4 0 R /Dest [8 0 R /XYZ 0 400 0] >>",
		15: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
	};
	let pdf = "%PDF-1.4\n";
	const offsets: number[] = [];
	for (let n = 1; n <= 15; n++) {
		offsets.push(pdf.length);
		pdf += `${n} 0 obj\n${objects[n]}\nendobj\n`;
	}
	const xref = pdf.length;
	pdf += `xref\n0 16\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
	pdf += `trailer\n<< /Size 16 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Uint8Array.from(pdf, (ch) => ch.charCodeAt(0));
}

// ─── tests ───────────────────────────────────────────────────────────────────

test("PDF import with an outline: destinations → physical pages, mid-page start shared, page labels, front matter kept", async () => {
	const root = tempLibrary();
	const { meta, toc } = await importBookFile({ bytes: outlinedPdf(), fileName: "outlined.pdf", libraryRoot: root, now: NOW });
	assert.equal(meta.tocSource, "pdf-outline");
	assert.equal(meta.numPages, 4);
	assert.deepEqual(
		toc.map((e) => [e.id, e.title, e.pageFrom, e.pageTo, e.pageLabel]),
		[
			["1", "Capitulo 1 Carga", 2, 2, "ii"],
			["1.1", "1.1 Conservacao da carga", 2, 2, "ii"],
			["2", "Capitulo 2 Ohm", 3, 4, "1"],
		],
	);
	const chunks = readLibraryChunks(root, meta.sha256);
	const bySection = new Map(chunks.map((c) => [c.sectionId ?? "(livro)", c]));
	assert.match(bySection.get("(livro)")!.text, /Prefacio/, "pages outside every unit stay as book-level text");
	assert.match(bySection.get("1.1")!.text, /carga eletrica/);
	assert.deepEqual(bySection.get("2")!.span, { pages: "3-4", sectionId: "2" });
	assert.match(bySection.get("2")!.text, /lei de Ohm[\s\S]*Continuacao/);
	assert.deepEqual(bySection.get("1.1")!.breadcrumb, ["Capitulo 1 Carga", "1.1 Conservacao da carga"]);
	const lib = createUserLibraryProvider({ libraryRoot: root });
	const pages34 = await lib.content(`lib:${meta.sha256}`, { pages: "4" });
	assert.ok(pages34.length >= 1 && pages34.every((c) => c.span?.pages === "3-4"), "page filter keeps overlapping units");
});

test("format detection, ISBN checksum and the PDF text-line rebuild", () => {
	assert.equal(detectFormat(samplePdf()), "pdf");
	assert.equal(detectFormat(sampleEpub()), "epub");
	assert.equal(detectFormat(new TextEncoder().encode("hello")), undefined);
	assert.equal(extractIsbn("ISBN 978-0-306-40615-7"), "9780306406157");
	assert.equal(extractIsbn("ISBN 978-0-306-40615-8"), undefined, "bad checksum is ignored");
	assert.equal(extractIsbn("ISBN-10: 0-306-40615-2"), "0306406152");
	assert.equal(
		textFromItems([
			{ str: "Linha", transform: [10, 0, 0, 10, 72, 700] },
			{ str: " um", transform: [10, 0, 0, 10, 100, 700] },
			{ str: "Linha dois", transform: [10, 0, 0, 10, 72, 688] },
			{ str: "Novo parágrafo", transform: [10, 0, 0, 10, 72, 600] },
		]),
		"Linha um\nLinha dois\n\nNovo parágrafo",
	);
});

test("PDF import: <library>/<sha256>/ with original, meta.json, toc.json, chunks.jsonl; page-window TOC without outline", async () => {
	const root = tempLibrary();
	const bytes = samplePdf();
	const imported = await importBookFile({ bytes, fileName: "Meu livro de circuitos.pdf", libraryRoot: root, now: NOW });
	const sha = sha256Hex(bytes);
	assert.equal(imported.meta.sha256, sha);
	assert.equal(imported.deduplicated, false);
	const dir = path.join(root, sha);
	assert.deepEqual(fs.readdirSync(dir).sort(), ["chunks.jsonl", "meta.json", "original.pdf", "toc.json"]);
	assert.deepEqual(new Uint8Array(fs.readFileSync(path.join(dir, "original.pdf"))), bytes, "the file is stored byte-for-byte");
	const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf-8"));
	assert.equal(meta.format, "pdf");
	assert.equal(meta.numPages, 2);
	assert.equal(meta.title, "Meu livro de circuitos");
	assert.equal(meta.isbn, "9780306406157");
	assert.equal(meta.lang, "pt");
	assert.equal(meta.tocSource, "page-window");
	assert.equal(meta.license.proprietary, true, "a personal copy is protected by default");
	assert.match(meta.warnings.join(" "), /sumário/);
	const toc = JSON.parse(fs.readFileSync(path.join(dir, "toc.json"), "utf-8"));
	assert.deepEqual(
		toc.entries.map((e: { id: string; pageFrom: number; pageTo: number }) => [e.id, e.pageFrom, e.pageTo]),
		[["1", 1, 2]],
	);
	const chunks = readLibraryChunks(root, sha);
	assert.equal(chunks.length, imported.meta.chunkCount);
	assert.ok(chunks.length >= 1);
	assert.match(chunks[0]!.text, /lei de Ohm para os circuitos/);
	assert.equal(chunks[0]!.resourceId, `lib:${sha}#1`);
	assert.deepEqual(chunks[0]!.span, { pages: "1-2", sectionId: "1" });

	const again = await importBookFile({ bytes, fileName: "outro nome.pdf", libraryRoot: root, now: NOW });
	assert.equal(again.deduplicated, true, "same bytes → same item");
	assert.equal(listLibrary(root).length, 1);
});

test("PDF import: the caller's buffer is not detached by pdfjs", async () => {
	const root = tempLibrary();
	const bytes = samplePdf();
	await importBookFile({ bytes, fileName: "x.pdf", libraryRoot: root, now: NOW });
	assert.ok(bytes.byteLength > 0);
	assert.equal(detectFormat(bytes), "pdf");
});

test("EPUB import: OPF metadata, nav TOC with fragments, spine documents grouped under their TOC entry", async () => {
	const root = tempLibrary();
	const bytes = sampleEpub();
	const { meta, toc } = await importBookFile({ bytes, fileName: "ebook.epub", libraryRoot: root, now: NOW });
	assert.equal(meta.format, "epub");
	assert.equal(meta.title, "Eletrônica de Teste");
	assert.deepEqual(meta.creators, ["Autora Exemplo"]);
	assert.equal(meta.lang, "pt");
	assert.equal(meta.isbn, "9780306406157");
	assert.equal(meta.tocSource, "epub-nav");
	assert.deepEqual(
		toc.map((e) => [e.id, e.title, e.href]),
		[
			["1", "Capítulo 1 — Carga", "OEBPS/text/ch1.xhtml"],
			["2", "Capítulo 2 — Lei de Ohm", "OEBPS/text/ch2.xhtml"],
			["2.1", "2.1 Resistência", "OEBPS/text/ch2.xhtml#s1"],
		],
	);
	const chunks = readLibraryChunks(root, meta.sha256);
	const bySection = new Map(chunks.map((c) => [c.sectionId, c.text]));
	assert.match(bySection.get("1")!, /propriedade da matéria/);
	assert.match(bySection.get("2")!, /produto da corrente/);
	assert.match(bySection.get("2")!, /Continuação do capítulo 2/, "an unreferenced spine document continues the previous entry");
	assert.doesNotMatch(chunks.map((c) => c.text).join(" "), /alert/);
	assert.deepEqual(chunks.find((c) => c.sectionId === "2")!.breadcrumb, ["Capítulo 2 — Lei de Ohm"]);
});

test("library provider: search, resolve sections, TOC and content filtered by section/pages; remove", async () => {
	const root = tempLibrary();
	const { meta } = await importBookFile({ bytes: sampleEpub(), fileName: "ebook.epub", libraryRoot: root, now: NOW });
	const lib = createUserLibraryProvider({ libraryRoot: root });
	assert.match((await lib.status()).reason, /1 livro/);
	const found = await lib.search({ domainId: "electronics", text: { pt: "lei de ohm resistência" }, maxResults: 5 });
	assert.equal(found[0]?.id, `lib:${meta.sha256}`);
	assert.equal(found[0]?.tos, "user_owned");
	assert.equal(found[0]?.access, "user_owned");
	const section = await lib.resolve(`lib:${meta.sha256}#2`);
	assert.equal(section.kind, "book_section");
	assert.equal(section.title, "Eletrônica de Teste — Capítulo 2 — Lei de Ohm");
	assert.equal((await lib.toc(`lib:${meta.sha256}`)).length, 3);
	const c2 = await lib.content(`lib:${meta.sha256}#2`);
	assert.ok(c2.length >= 1 && c2.every((c) => c.sectionId === "2" || c.sectionId?.startsWith("2.")));
	await assert.rejects(lib.resolve("lib:abc"), (e: unknown) => e instanceof ResourceError && e.code === "invalid-input");
	await assert.rejects(lib.resolve(`lib:${"0".repeat(64)}`), (e: unknown) => e instanceof ResourceError && e.code === "not-found");
	assert.equal(removeLibraryItem(root, meta.sha256), true);
	assert.equal(listLibrary(root).length, 0);
	assert.throws(() => removeLibraryItem(root, "../../etc"), ResourceError, "ids never escape the library root");
});

test("import rejects unknown formats; importFromUrl only downloads from allowlisted hosts", async () => {
	const root = tempLibrary();
	await assert.rejects(importBookFile({ bytes: new TextEncoder().encode("not a book"), fileName: "x.txt", libraryRoot: root }), (e: unknown) => e instanceof ResourceError && e.code === "invalid-input");
	const pdf = samplePdf();
	const seen: string[] = [];
	const base: FetchLike = async (url) => {
		seen.push(url);
		return new Response(pdf.slice(), { status: 200, headers: { "content-type": "application/pdf" } });
	};
	const fetch = createResourceFetch({ baseFetch: base });
	const ok = await importFromUrl({ url: "https://www.ibiblio.org/kuphaldt/socratic/model/mod_ohm.pdf", fetch, libraryRoot: root, now: NOW, license: { name: "CC BY 4.0", spdx: "CC-BY-4.0" } });
	assert.equal(ok.meta.origin.kind, "url");
	assert.equal(ok.meta.fileName, "mod_ohm.pdf");
	assert.equal(ok.meta.license.spdx, "CC-BY-4.0");
	await assert.rejects(importFromUrl({ url: "https://libgen.is/get.php?md5=abc", fetch, libraryRoot: root }), (e: unknown) => e instanceof ResourceError && e.code === "blocked");
	assert.equal(seen.length, 1);
});

test("zip reader: paths resolve relative to the base entry; unsafe names are ignored", () => {
	assert.equal(resolveZipPath("OEBPS/nav.xhtml", "text/ch1.xhtml#a"), "OEBPS/text/ch1.xhtml");
	assert.equal(resolveZipPath("OEBPS/text/ch1.xhtml", "../images/a%20b.png"), "OEBPS/images/a b.png");
	const evil = new ZipReader(zip([{ name: "../../evil.txt", data: "x" }, { name: "ok.txt", data: "fine" }]));
	assert.deepEqual([...evil.entries.keys()], ["ok.txt"]);
	assert.equal(evil.readText("ok.txt"), "fine");
});

// ─── review regressions ──────────────────────────────────────────────────────

test("PDF import (regression): a Node Buffer (Electron/IPC, fs.readFileSync) imports, and neither it nor the Buffer pool is touched", async () => {
	const root = tempLibrary();
	const neighbour = Buffer.from("vizinho no mesmo pool");
	// Small Buffers share one pooled ArrayBuffer: Buffer#slice() is a VIEW of
	// it, and pdfjs rejects Buffer data (and detaches what it receives).
	const bytes = Buffer.from(samplePdf());
	const { meta } = await importBookFile({ bytes, fileName: "buffer.pdf", libraryRoot: root, now: NOW });
	assert.equal(meta.numPages, 2);
	assert.ok(meta.chunkCount >= 1);
	assert.equal(bytes.byteLength, samplePdf().byteLength, "the caller's Buffer is intact");
	assert.equal(detectFormat(bytes), "pdf");
	assert.equal(neighbour.toString(), "vizinho no mesmo pool");
});

test("library content (regression): a section without its own chunks is served from the unit that holds its text", async () => {
	const root = tempLibrary();
	const { meta, toc } = await importBookFile({ bytes: sampleEpub(), fileName: "ebook.epub", libraryRoot: root, now: NOW });
	assert.ok(toc.some((e) => e.id === "2.1"), "fixture: 2.1 points into ch2.xhtml, owned by entry 2");
	const lib = createUserLibraryProvider({ libraryRoot: root });
	const deep = await lib.content(`lib:${meta.sha256}#2.1`);
	assert.ok(deep.length >= 1, "used to be empty: chunks exist only per TOC unit");
	assert.match(deep.map((c) => c.text).join(" "), /Resistores limitam a corrente/);
	assert.ok(deep.every((c) => c.sectionId === "2"));
	assert.deepEqual(await lib.content(`lib:${meta.sha256}#9.9`), [], "an unknown section is still empty");
});

test("library remove (regression): works under a non-ASCII path (fs.rmSync skips those silently on Windows)", async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-bibliotéca-ção-"));
	roots.push(root);
	const { meta } = await importBookFile({ bytes: sampleEpub(), fileName: "livro.epub", libraryRoot: root, now: NOW });
	const dir = path.join(root, meta.sha256);
	assert.ok(fs.existsSync(dir));
	assert.equal(removeLibraryItem(root, meta.sha256), true);
	assert.equal(fs.existsSync(dir), false, "the item directory is really gone");
	assert.equal(listLibrary(root).length, 0);
	assert.equal(removeLibraryItem(root, meta.sha256), false);
});

test("binary atomic write (regression): identical bytes are not rewritten; new bytes replace without temp leftovers", () => {
	const dir = tempLibrary();
	const file = path.join(dir, "original.pdf");
	const a = samplePdf();
	writeBinaryAtomic(file, a);
	const past = new Date("2020-01-01T00:00:00Z");
	fs.utimesSync(file, past, past);
	writeBinaryAtomic(file, Buffer.from(a));
	assert.equal(fs.statSync(file).mtimeMs, past.getTime(), "same content: left untouched (no rename over a file a viewer may hold)");
	const b = new TextEncoder().encode("%PDF-1.4 outro conteúdo");
	writeBinaryAtomic(file, b);
	assert.deepEqual(new Uint8Array(fs.readFileSync(file)), b);
	assert.deepEqual(fs.readdirSync(dir), ["original.pdf"]);
});
