/**
 * Obsidian one-way mirror (plugins/flashcards/src/obsidian-export.ts), SÍNTESE
 * §2.4(d) item 5 and M4 criteria: one note per region, Spaced Repetition syntax,
 * `<!--lh:id=…-->` anchors, never `<!--SR:-->`, staging + no-replace publish,
 * idempotent re-export (0 duplicates), user text outside the managed block preserved.
 * Regressions: SR separators hidden in `:::`/`===`/unbalanced code, cloze `=` next to
 * `==`, case-only region renames, duplicated blocks, folders created through a link that
 * leaves the vault, and notes of another domain with the same title.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import fc from "fast-check";
import { collectExportCards, type ExportCard, type ExportSource } from "../plugins/flashcards/src/export-model.ts";
import { anchorFor, BLOCK_END, exportToObsidian, noteDomain, renderCard, STAGING_FOLDER, type ObsidianExportResult } from "../plugins/flashcards/src/obsidian-export.ts";

const DOMAIN = { id: "eletronica", title: "Eletrônica" };
const REGION_A = "LearnHarness/Eletrônica/Verbos irregulares.md";
const REGION_B = "LearnHarness/Eletrônica/Circuitos básico.md";

function library(): ExportSource {
	return {
		decks: [
			{ id: "d1", name: "Verbos irregulares", propositionIds: ["p1", "p2"] },
			{ id: "d2", name: "Circuitos: básico", propositionIds: ["p3", "p1"] },
		],
		propositions: {
			p1: { id: "p1", name: "Past tense", cues: [
				{ id: "c1", question: "Qual o passado de *go*?\n\nPense em verbo irregular.", answer: "went" },
				{ id: "c2", question: "go", answer: "went", kind: "reverse" },
				{ id: "c-deleted", question: "apagado", answer: "x", deleted: true },
			] },
			p2: { id: "p2", name: "Cloze", cues: [{ id: "c3", question: "O passado de go é {{c1::went::verbo}}.", answer: "Irregular" }] },
			p3: { id: "p3", name: "Ohm", cues: [{ id: "c4", question: "Lei de Ohm?\n?\nstd::vector == x", answer: "V = R·I <!--SR:!2026-01-01,3,250-->" }] },
			p4: { id: "p4", name: "Arquivada", cues: [{ id: "c5", question: "velha", answer: "velha" }] },
		},
	};
}

const live = (id: string): boolean => id !== "p4";
const cardsOf = (source: ExportSource = library()): ExportCard[] => collectExportCards(source, DOMAIN, live);

const temporaryDirectories: string[] = [];
after(() => { for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

/** A fresh directory under the OS temp folder, removed after the suite (never the repo data/). */
function temporaryDirectory(prefix = "lh-obsidian-vault-"): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	temporaryDirectories.push(directory);
	return directory;
}

function vault(): string {
	return temporaryDirectory();
}

function read(root: string, relative: string): string {
	return fs.readFileSync(path.join(root, ...relative.split("/")), "utf8");
}

function exportAgain(root: string, cards: ExportCard[], previous: ObsidianExportResult): ObsidianExportResult {
	return exportToObsidian({ vaultPath: root, domain: DOMAIN, cards, previousFiles: previous.files, previousLinks: previous.links });
}

const count = (text: string, needle: string): number => text.split(needle).length - 1;

/**
 * The SR plugin parser's inline-card rule (`hasInlineMarker`), written independently of
 * the exporter: only the first occurrence counts, and it is not a separator when an odd
 * number of backticks lies on each side of it.
 */
function srInline(line: string, marker: string): boolean {
	const at = line.indexOf(marker);
	if (at < 0) return false;
	const ticks = (text: string): number => (text.match(/`/g) ?? []).length;
	return !(ticks(line.slice(0, at)) % 2 === 1 && ticks(line.slice(at + marker.length)) % 2 === 1);
}

/** SR's highlight cloze (`==…==`, lazy) as it reads raw note text, decoded back to plain text. */
const srDeletions = (text: string): string[] => [...text.matchAll(/==(.*?)==/g)].map((match) => (match[1] ?? "").replace(/&#61;/g, "=").replace(/\\([=:])/g, "$1"));

const CARD: ExportCard = { lhId: "cue-1", cueId: "cue-1", propositionId: "p", propositionName: "", domainId: DOMAIN.id, domainTitle: DOMAIN.title, region: "R", regionKey: "r", kind: "basic", question: "", answer: "", tags: [], contentHash: "" };
const render = (kind: ExportCard["kind"], question: string, answer: string): string => renderCard({ ...CARD, kind, question, answer });

describe("flashcards Obsidian export", () => {
	it("writes one Spaced Repetition note per region with anchors and no SR scheduling", () => {
		const root = vault();
		const result = exportToObsidian({ vaultPath: root, domain: DOMAIN, cards: cardsOf() });
		assert.deepEqual(result.written.sort(), [REGION_B, REGION_A].sort());
		assert.equal(result.cards, 4, "deleted cues and archived propositions are not exported");
		const a = read(root, REGION_A);
		const b = read(root, REGION_B);
		for (const text of [a, b]) assert.equal(text.includes("<!--SR:"), false);
		assert.match(a, /^---\ntags:\n {2}- flashcards\/eletrônica\/verbos-irregulares\n/);
		assert.ok(a.includes("Qual o passado de *go*?\nPense em verbo irregular.\n?\nwent <!--lh:id=c1-->"), "multiline question, blank line removed");
		assert.ok(a.includes("go:::went <!--lh:id=c2-->"), "single-line reverse card");
		assert.ok(a.includes("O passado de go é ==went==^[verbo].\nIrregular <!--lh:id=c3-->"), "cloze with hint and extra");
		assert.ok(b.includes("Lei de Ohm?\n\\?\nstd:\\:vector =\\= x\n?\nV = R·I &lt;!--SR:!2026-01-01,3,250--> <!--lh:id=c4-->"), "separators and comments inside content are defused");
		for (const id of ["c1", "c2", "c3"]) assert.equal(count(a, anchorFor(id)), 1);
		assert.equal(count(b, anchorFor("c4")), 1);
		assert.equal(count(a + b, "<!--lh:id=c5-->"), 0);
		assert.equal(fs.existsSync(path.join(root, STAGING_FOLDER)), false, "staging is cleaned up");
		assert.deepEqual(Object.keys(result.links).sort(), ["c1", "c2", "c3", "c4"]);
		assert.equal(result.links.c4?.path, REGION_B);
	});

	it("re-exporting is idempotent: nothing rewritten, no duplicated anchors", () => {
		const root = vault();
		const first = exportToObsidian({ vaultPath: root, domain: DOMAIN, cards: cardsOf() });
		const before = [read(root, REGION_A), read(root, REGION_B)];
		const mtimes = [REGION_A, REGION_B].map((relative) => fs.statSync(path.join(root, ...relative.split("/"))).mtimeMs);
		const second = exportAgain(root, cardsOf(), first);
		assert.deepEqual(second.written, []);
		assert.deepEqual(second.unchanged.sort(), [REGION_A, REGION_B].sort());
		assert.deepEqual([read(root, REGION_A), read(root, REGION_B)], before);
		assert.deepEqual([REGION_A, REGION_B].map((relative) => fs.statSync(path.join(root, ...relative.split("/"))).mtimeMs), mtimes);
		assert.deepEqual(second.links, first.links, "unchanged cards keep their writtenAt");
		const third = exportAgain(root, cardsOf(), second);
		assert.equal(count(read(root, REGION_A), anchorFor("c1")), 1);
		assert.deepEqual(third.files, first.files);
	});

	it("updates cards in place and preserves user text outside the managed block", () => {
		const root = vault();
		const first = exportToObsidian({ vaultPath: root, domain: DOMAIN, cards: cardsOf() });
		const file = path.join(root, ...REGION_A.split("/"));
		const edited = read(root, REGION_A).replace("# Verbos irregulares\n", "# Verbos irregulares\n\nMinhas anotações antes.\n") + "\nMinhas anotações depois.\n";
		fs.writeFileSync(file, edited);
		const source = library();
		const cue = source.propositions.p1?.cues[0];
		assert.ok(cue);
		(cue as { answer: string }).answer = "went (irregular)";
		const second = exportAgain(root, cardsOf(source), first);
		assert.deepEqual(second.written, [REGION_A]);
		const text = read(root, REGION_A);
		assert.ok(text.includes("Minhas anotações antes.") && text.endsWith("Minhas anotações depois.\n"));
		assert.ok(text.includes("went (irregular) <!--lh:id=c1-->"));
		assert.equal(count(text, anchorFor("c1")), 1);
		assert.equal(count(text, "<!-- lh:begin cards"), 1);
		assert.notEqual(second.links.c1?.contentHash, first.links.c1?.contentHash);
	});

	it("keeps scheduling comments the SR plugin appended to unchanged cards, never creating any", () => {
		const root = vault();
		const first = exportToObsidian({ vaultPath: root, domain: DOMAIN, cards: cardsOf() });
		const file = path.join(root, ...REGION_A.split("/"));
		const reviewed = read(root, REGION_A)
			.replace("went <!--lh:id=c1-->", "went <!--lh:id=c1-->\n<!--SR:!2026-02-01,3,250-->")
			.replace("go:::went <!--lh:id=c2-->", "go:::went <!--lh:id=c2--> <!--SR:!2026-02-02,4,270!2026-02-03,5,270-->");
		fs.writeFileSync(file, reviewed);
		const source = library();
		(source.propositions.p2?.cues[0] as { answer: string }).answer = "Verbo irregular";
		exportAgain(root, cardsOf(source), first);
		let text = read(root, REGION_A);
		assert.ok(text.includes("went <!--lh:id=c1-->\n<!--SR:!2026-02-01,3,250-->"));
		assert.ok(text.includes("go:::went <!--lh:id=c2--> <!--SR:!2026-02-02,4,270!2026-02-03,5,270-->"));
		(source.propositions.p1?.cues[0] as { answer: string }).answer = "went!";
		exportToObsidian({ vaultPath: root, domain: DOMAIN, cards: cardsOf(source) });
		text = read(root, REGION_A);
		assert.equal(text.includes("<!--SR:!2026-02-01"), false, "a changed card is a new card for SR");
		const fresh = vault();
		exportToObsidian({ vaultPath: fresh, domain: DOMAIN, cards: cardsOf(source) });
		assert.equal(read(fresh, REGION_A).includes("<!--SR:"), false);
	});

	it("removes notes of vanished regions only when untouched, otherwise empties their block", () => {
		const root = vault();
		const first = exportToObsidian({ vaultPath: root, domain: DOMAIN, cards: cardsOf() });
		const source = library();
		source.decks = source.decks.filter((deck) => deck.id !== "d2");
		delete source.propositions.p3;
		const second = exportAgain(root, cardsOf(source), first);
		assert.deepEqual(second.removed, [REGION_B]);
		assert.equal(fs.existsSync(path.join(root, ...REGION_B.split("/"))), false);

		const other = vault();
		const initial = exportToObsidian({ vaultPath: other, domain: DOMAIN, cards: cardsOf() });
		const file = path.join(other, ...REGION_B.split("/"));
		fs.appendFileSync(file, "\nNota pessoal.\n");
		const after = exportAgain(other, cardsOf(source), initial);
		assert.deepEqual(after.emptied, [REGION_B]);
		const text = read(other, REGION_B);
		assert.ok(text.includes("Nota pessoal."));
		assert.equal(text.includes("<!--lh:id="), false);
		assert.equal(after.files[REGION_B], undefined, "an emptied note is no longer tracked");
	});

	it("refuses a note whose managed block lost its end marker and leaves it untouched", () => {
		const root = vault();
		exportToObsidian({ vaultPath: root, domain: DOMAIN, cards: cardsOf() });
		const file = path.join(root, ...REGION_A.split("/"));
		const broken = read(root, REGION_A).replace(BLOCK_END, "");
		fs.writeFileSync(file, broken);
		assert.throws(() => exportToObsidian({ vaultPath: root, domain: DOMAIN, cards: cardsOf() }), /sem o final/);
		assert.equal(read(root, REGION_A), broken);
		assert.equal(fs.existsSync(path.join(root, STAGING_FOLDER)), false);
	});

	it("rejects a missing or relative vault path", () => {
		assert.throws(() => exportToObsidian({ vaultPath: "relativo/cofre", domain: DOMAIN, cards: cardsOf() }), /absoluto/);
		assert.throws(() => exportToObsidian({ vaultPath: path.join(os.tmpdir(), "lh-no-such-vault-xyz"), domain: DOMAIN, cards: cardsOf() }), /não encontrado/);
	});

	it("never lets card text form an SR separator: runs of : and =, unbalanced code, reverse split", () => {
		const anchor = anchorFor("cue-1");
		assert.equal(render("basic", "a:::b", "c===d"), `a:\\:\\:b\n?\nc=\\=\\=d ${anchor}`);
		assert.equal(render("basic", "`a::b` e ::", "z"), `\`a::b\` e :\\:\n?\nz ${anchor}`, "code SR treats as code is kept");
		assert.equal(render("basic", "`a::b", "z"), `\`a:\\:b\n?\nz ${anchor}`, "an unbalanced backtick is not code for SR");
		assert.equal(render("reverse", "x:", "y"), `x:\n??\ny ${anchor}`, "x: + ::: would split at the first ::");
		assert.equal(render("reverse", "go", "went"), `go:::went ${anchor}`);
		assert.equal(render("cloze", "x={{c1::y}}", ""), `x&#61;==y== ${anchor}`);
		assert.equal(render("cloze", "{{c1::a=}}={{c2::b}}", ""), `==a&#61;==&#61;==b== ${anchor}`);
		assert.equal(anchorFor("a::b"), "<!--lh:id=a%3A%3Ab-->");
	});

	it("property: SR sees no separator in card text, only our own single-line `:::`", () => {
		const text = fc.string({ unit: fc.constantFrom(":", "=", "`", "a", " ", "?", "\n"), maxLength: 24 });
		const kind = fc.constantFrom("basic" as const, "reverse" as const);
		fc.assert(fc.property(text, text, kind, (question, answer, cardKind) => {
			const lines = render(cardKind, `${question}x`, answer).split("\n");
			if (lines.length === 1) {
				const line = lines[0] ?? "";
				assert.equal(cardKind, "reverse");
				assert.ok(line.indexOf("::") === line.indexOf(":::") && srInline(line, ":::"), line);
			} else {
				for (const line of lines) assert.ok(!srInline(line, "::") && !srInline(line, ":::"), line);
			}
		}), { numRuns: 1000 });
	});

	it("property: SR reads every cloze deletion back exactly", () => {
		const plain = fc.string({ unit: fc.constantFrom("=", ":", "a", " "), maxLength: 6 });
		const deletion = fc.string({ unit: fc.constantFrom("=", "a", " ", "b"), minLength: 1, maxLength: 5 }).filter((value) => value.trim() !== "");
		fc.assert(fc.property(plain, deletion, plain, deletion, plain, (before, first, middle, second, rest) => {
			const rendered = render("cloze", `${before}{{c1::${first}}}${middle}{{c2::${second}}}${rest}x`, "");
			assert.deepEqual(srDeletions(rendered), [first, second], rendered);
			for (const line of rendered.split("\n")) assert.ok(!srInline(line, "::"), line);
		}), { numRuns: 1000 });
	});

	it("a region renamed only in letter case keeps its note", () => {
		const root = vault();
		fs.writeFileSync(path.join(root, "probe.md"), "");
		const caseInsensitive = fs.existsSync(path.join(root, "PROBE.md"));
		fs.rmSync(path.join(root, "probe.md"));
		const source = library();
		const first = exportToObsidian({ vaultPath: root, domain: DOMAIN, cards: cardsOf(source) });
		(source.decks[0] as { name: string }).name = "VERBOS IRREGULARES";
		const renamed = "LearnHarness/Eletrônica/VERBOS IRREGULARES.md";
		const second = exportAgain(root, cardsOf(source), first);
		const text = read(root, renamed);
		for (const id of ["c1", "c2", "c3"]) assert.equal(count(text, anchorFor(id)), 1);
		assert.ok(second.files[renamed]);
		assert.equal(second.files[REGION_A], undefined);
		assert.deepEqual(second.removed, caseInsensitive ? [] : [REGION_A], "the live note is never deleted as stale");
		const third = exportAgain(root, cardsOf(source), second);
		assert.deepEqual([third.written, third.removed], [[], []]);
		assert.equal(count(read(root, renamed), anchorFor("c1")), 1);
	});

	it("refuses a note with two managed blocks and leaves it untouched", () => {
		const root = vault();
		exportToObsidian({ vaultPath: root, domain: DOMAIN, cards: cardsOf() });
		const text = read(root, REGION_A);
		const block = text.slice(text.indexOf("<!-- lh:begin cards"), text.indexOf(BLOCK_END) + BLOCK_END.length);
		const doubled = `${text}\nCópia do bloco:\n\n${block}\n`;
		fs.writeFileSync(path.join(root, ...REGION_A.split("/")), doubled);
		assert.throws(() => exportToObsidian({ vaultPath: root, domain: DOMAIN, cards: cardsOf() }), /mais de um bloco/);
		assert.equal(read(root, REGION_A), doubled);
	});

	it("never creates folders through a link that leaves the vault", () => {
		const root = vault();
		const outside = temporaryDirectory("lh-obsidian-outside-");
		fs.symlinkSync(outside, path.join(root, "LearnHarness"), process.platform === "win32" ? "junction" : "dir");
		assert.throws(() => exportToObsidian({ vaultPath: root, domain: DOMAIN, cards: cardsOf() }), /saiu do cofre/);
		assert.deepEqual(fs.readdirSync(outside), [], "nothing is created outside the vault");
		assert.equal(fs.existsSync(path.join(root, STAGING_FOLDER)), false);
	});

	it("never merges into a note that another domain with the same title created", () => {
		const root = vault();
		exportToObsidian({ vaultPath: root, domain: DOMAIN, cards: cardsOf() });
		const before = read(root, REGION_A);
		assert.equal(noteDomain(before), DOMAIN.id);
		assert.equal(noteDomain("---\r\nlh_domain: \"outro\"\r\n---\r\n# x"), "outro");
		assert.equal(noteDomain("# sem frontmatter\nlh_domain: x"), null);
		const other = { id: "eletronica-2", title: DOMAIN.title };
		const otherSource: ExportSource = { decks: [{ id: "x1", name: "Verbos irregulares", propositionIds: ["q1"] }], propositions: { q1: { id: "q1", name: "Q", cues: [{ id: "z1", question: "Outro?", answer: "sim" }] } } };
		assert.throws(() => exportToObsidian({ vaultPath: root, domain: other, cards: collectExportCards(otherSource, other, () => true) }), /pertence ao domínio "eletronica"/);
		assert.equal(read(root, REGION_A), before);
		assert.equal(fs.existsSync(path.join(root, STAGING_FOLDER)), false);
	});

	it("property: any card text renders as one SR card with one anchor and no SR comment", () => {
		const text = fc.string({ unit: "grapheme", maxLength: 80 });
		const kind = fc.constantFrom("basic" as const, "reverse" as const, "cloze" as const);
		fc.assert(fc.property(text, text, kind, (question, answer, cardKind) => {
			const card: ExportCard = { lhId: "cue-1", cueId: "cue-1", propositionId: "p", propositionName: "", domainId: DOMAIN.id, domainTitle: DOMAIN.title, region: "R", regionKey: "r", kind: cardKind, question: `${question}x`, answer, tags: [], contentHash: "" };
			const rendered = renderCard(card);
			assert.equal(/\n\s*\n/.test(rendered), false, "no blank line inside a card");
			assert.equal(rendered.includes("<!--SR:"), false);
			assert.equal(count(rendered, "<!--lh:id="), 1);
			assert.ok(rendered.endsWith(anchorFor("cue-1")));
			const separators = rendered.split("\n").filter((line) => line.trim() === "?" || line.trim() === "??").length;
			assert.equal(separators, cardKind === "cloze" || (cardKind === "reverse" && rendered.includes(":::")) ? 0 : 1);
		}), { numRuns: 300 });
	});
});
