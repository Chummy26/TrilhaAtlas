import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../../config.ts";
import { libraryDir, resourcesDir } from "../../core/domains/paths.ts";
import { tokenize } from "../../core/resources/match.ts";
import { openSqlDriver, type SqlDriver } from "../../store/memory/sql-driver.ts";
import { readLibraryChunks, type LibraryItemMeta } from "./user-library.ts";

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
		}
	}));
}

export function hasRegionalReadings(domain: string) {
	return fs.existsSync(indexPath(domain));
}

/** Without a focus (free question), search this domain's linked books. */
export function recallRegionalReading(domain: string, regions: string[], query: string): string {
	const terms = [...new Set(tokenize(query))].slice(0, 40);
	if (!terms.length) return "";
	const filter = regions.length ? " AND links.region IN (SELECT value FROM json_each(?))" : "";
	return readIndex(domain, "", db => {
		const rows = db.prepare(`SELECT books.title, pages, section, snippet(passages,3,'','',' … ',64) AS excerpt
			FROM passages JOIN books ON books.sha=passages.sha
			WHERE passages MATCH ? AND EXISTS (SELECT 1 FROM links WHERE links.sha=books.sha${filter})
			ORDER BY bm25(passages,0,0,2,1), passages.rowid LIMIT 2`)
			.all(terms.map(t => '"' + t + '"').join(" OR "), ...(regions.length ? [JSON.stringify(regions)] : []));
		if (!rows.length) return "";
		const excerpts = rows.map(r => [
			[String(r.title).replace(/\s+/gu, " ").slice(0, 160), String(r.section).replace(/\s+/gu, " ").slice(0, 200),
				r.pages && "páginas físicas " + r.pages].filter(Boolean).join(" · "),
			String(r.excerpt),
		].join("\n"));
		return "## Leitura da região\n" + excerpts.join("\n\n");
	});
}
