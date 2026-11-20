import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../../config.ts";
import { libraryDir, resourcesDir } from "../../core/domains/paths.ts";
import { tokenize } from "../../core/resources/match.ts";
import { openSqlDriver, type SqlDriver } from "../../store/memory/sql-driver.ts";
import { physicalPdfPages, readLibraryItem, readLibraryChunks, type LibraryItemMeta } from "./user-library.ts";

function indexPath(domain: string) {
	return path.join(resourcesDir(PATHS.data, domain), "regional-readings.sqlite");
}

/** The binary library is deduplicated workspace-wide. Only explicitly linked
 * books are indexed in the domain, and every excerpt query joins its region. */
export function linkRegionalReading(domain: string, region: string, meta: LibraryItemMeta) {
	const db = openSqlDriver(indexPath(domain));
	try {
		db.exec(`PRAGMA busy_timeout=5000;
			CREATE TABLE IF NOT EXISTS books (sha TEXT PRIMARY KEY, title TEXT NOT NULL, chunks INTEGER NOT NULL);
			CREATE TABLE IF NOT EXISTS links (region TEXT, sha TEXT, PRIMARY KEY(region, sha));
			CREATE VIRTUAL TABLE IF NOT EXISTS passages USING fts5(sha UNINDEXED, pages UNINDEXED, section, body);`);
		db.transaction(() => {
			if (!db.prepare("SELECT 1 FROM books WHERE sha=?").get(meta.sha256)) {
				const chunks = readLibraryChunks(libraryDir(PATHS.data), meta.sha256);
				const insert = db.prepare("INSERT INTO passages(sha, pages, section, body) VALUES(?,?,?,?)");
				for (const c of chunks) insert.run(meta.sha256, c.span?.pages ?? "", c.breadcrumb.join(" › "), c.text);
				db.prepare("INSERT INTO books VALUES(?,?,?)").run(meta.sha256, meta.title, chunks.length);
			}
			db.prepare("INSERT OR IGNORE INTO links VALUES(?,?)").run(region, meta.sha256);
		});
	} finally { db.close(); }
}

function readIndex<T>(domain: string, empty: T, fn: (db: SqlDriver) => T): T {
	const file = indexPath(domain);
	if (!fs.existsSync(file)) return empty;
	const db = openSqlDriver(file);
	try { return fn(db); } finally { db.close(); }
}

export function regionalReadingList(domain: string, region: string) {
	return readIndex(domain, [], db => db.prepare("SELECT books.sha, title, chunks FROM books JOIN links USING(sha) WHERE region=? ORDER BY title, sha")
		.all(region).map(row => ({ id: String(row.sha), title: String(row.title), readable: Number(row.chunks) > 0 })));
}

export function unlinkRegionalReading(domain: string, region: string, sha: string) {
	readIndex(domain, undefined, db => db.transaction(() => {
		db.prepare("DELETE FROM links WHERE region=? AND sha=?").run(region, sha);
		if (!db.prepare("SELECT 1 FROM links WHERE sha=?").get(sha)) {
			db.prepare("DELETE FROM passages WHERE sha=?").run(sha);
			db.prepare("DELETE FROM books WHERE sha=?").run(sha);
			if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='page_indexes'").get()) db.prepare("DELETE FROM page_indexes WHERE sha=?").run(sha);
		}
	}));
}

export function hasRegionalReadings(domain: string) {
	return fs.existsSync(indexPath(domain));
}

/** Without a focus (free question), search this domain's linked books. */
export async function recallRegionalReading(domain: string, regions: string[], query: string): Promise<string> {
	const terms = [...new Set(tokenize(query))].slice(0, 40);
	if (!terms.length) return "";
	const filter = regions.length ? " AND links.region IN (SELECT value FROM json_each(?))" : "";
	// Upgrade linked PDFs on first use. Old chapter spans cannot identify a physical page.
	const pending = readIndex(domain, [] as string[], db => {
		db.exec("CREATE TABLE IF NOT EXISTS page_indexes (sha TEXT PRIMARY KEY)");
		return db.prepare(`SELECT DISTINCT links.sha FROM links LEFT JOIN page_indexes USING(sha)
			WHERE page_indexes.sha IS NULL${filter}`).all(...(regions.length ? [JSON.stringify(regions)] : [])).map(r => String(r.sha));
	});
	const root = libraryDir(PATHS.data);
	for (const sha of pending) {
		const book = readLibraryItem(root, sha);
		if (!book) continue;
		const pages = book.meta.format === "pdf" ? await physicalPdfPages(root, sha) : undefined;
		readIndex(domain, undefined, db => db.transaction(() => {
			if (!db.prepare("SELECT 1 FROM books WHERE sha=?").get(sha) || db.prepare("SELECT 1 FROM page_indexes WHERE sha=?").get(sha)) return;
			if (pages) {
				db.prepare("DELETE FROM passages WHERE sha=?").run(sha);
				const insert = db.prepare("INSERT INTO passages(sha,pages,section,body) VALUES(?,?,?,?)");
				for (const [page, text] of pages) {
					const section = book.toc.findLast(e => (e.pageFrom ?? Infinity) <= page && (e.pageTo ?? -1) >= page);
					insert.run(sha, String(page), section?.title ?? "", text);
				}
			}
			db.prepare("INSERT INTO page_indexes VALUES(?)").run(sha);
		}));
	}
	return readIndex(domain, "", db => {
		const rows = db.prepare(`SELECT books.sha, books.title, pages, section, snippet(passages,3,'','',' … ',64) AS excerpt
			FROM passages JOIN books ON books.sha=passages.sha
			WHERE passages MATCH ? AND EXISTS (SELECT 1 FROM links WHERE links.sha=books.sha${filter})
			ORDER BY bm25(passages,0,0,2,1), passages.rowid LIMIT 2`)
			.all(terms.map(t => '"' + t + '"').join(" OR "), ...(regions.length ? [JSON.stringify(regions)] : []));
		if (!rows.length) return "";
		const excerpts = rows.map(r => [
			[String(r.title).replace(/\s+/gu, " ").slice(0, 160), String(r.section).replace(/\s+/gu, " ").slice(0, 200),
				r.pages && "página física " + r.pages].filter(Boolean).join(" · "),
			String(r.excerpt),
			...(r.pages && /^\d+$/.test(String(r.pages)) ? [`Citação: [página física ${r.pages}](#livro-${r.sha}-${r.pages})`] : []),
		].join("\n"));
		return "## Leitura da região\n" + excerpts.join("\n\n");
	});
}
