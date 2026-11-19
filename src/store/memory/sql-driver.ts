/**
 * SqlDriver — the thin synchronous SQLite adapter the memory store talks to
 * (r4 §7.2 "isole atrás de um adapter SqlDriver com fallback para
 * better-sqlite3"; SÍNTESE §2.5 Stack; §8 risk 1).
 *
 * The interface is the intersection of `node:sqlite` (DatabaseSync) and
 * better-sqlite3: positional `?` parameters only, `run/get/all` on prepared
 * statements, explicit transactions. A future better-sqlite3 adapter only has
 * to implement `SqlDriver` (its `Database#prepare/exec/close` map 1:1;
 * BLOBs come back as Buffer, which is a Uint8Array).
 *
 * node:sqlite still emits an ExperimentalWarning on Node 24 / Electron 44.
 * The module is loaded lazily through `process.getBuiltinModule` (no static
 * import, so bundlers never touch it) with that single warning filtered out;
 * every other warning passes through untouched.
 */

import type { DatabaseSync, StatementSync } from "node:sqlite";

export type SqlValue = null | number | bigint | string | Uint8Array;
export type SqlRow = Record<string, SqlValue>;

export interface SqlRunResult {
	changes: number;
	lastInsertRowid: number;
}

export interface SqlStatement {
	run(...params: SqlValue[]): SqlRunResult;
	get(...params: SqlValue[]): SqlRow | undefined;
	all(...params: SqlValue[]): SqlRow[];
}

export interface SqlDriver {
	readonly path: string;
	readonly name: "node:sqlite" | "better-sqlite3";
	exec(sql: string): void;
	/** Prepared statements are cached per SQL text. */
	prepare(sql: string): SqlStatement;
	/** Run `fn` inside BEGIN IMMEDIATE … COMMIT (ROLLBACK on throw). Nested calls join the outer transaction. */
	transaction<T>(fn: () => T): T;
	close(): void;
	readonly open: boolean;
}

type SqliteModule = typeof import("node:sqlite");

let cachedModule: SqliteModule | null = null;

function isSqliteExperimentalWarning(warning: unknown, rest: unknown[]): boolean {
	const message = typeof warning === "string" ? warning : warning instanceof Error ? warning.message : "";
	const first = rest[0];
	const type =
		typeof first === "string"
			? first
			: first && typeof first === "object" && "type" in first
				? String((first as { type?: unknown }).type)
				: warning instanceof Error
					? warning.name
					: "";
	return type === "ExperimentalWarning" && /sqlite/i.test(message);
}

/** Load node:sqlite once, swallowing only its ExperimentalWarning. */
export function loadNodeSqlite(): SqliteModule {
	if (cachedModule) return cachedModule;
	const original = process.emitWarning;
	process.emitWarning = function patched(this: unknown, warning: unknown, ...rest: unknown[]) {
		if (isSqliteExperimentalWarning(warning, rest)) return;
		return (original as (...args: unknown[]) => void).call(process, warning, ...rest);
	} as typeof process.emitWarning;
	try {
		const mod = process.getBuiltinModule("node:sqlite");
		if (!mod?.DatabaseSync) throw new Error("node:sqlite indisponível neste runtime (requer Node ≥ 22.5)");
		cachedModule = mod;
		return mod;
	} finally {
		process.emitWarning = original;
	}
}

function toNumber(v: number | bigint): number {
	return typeof v === "bigint" ? Number(v) : v;
}

class NodeSqliteStatement implements SqlStatement {
	constructor(private readonly stmt: StatementSync) {}

	run(...params: SqlValue[]): SqlRunResult {
		const r = this.stmt.run(...params);
		return { changes: toNumber(r.changes), lastInsertRowid: toNumber(r.lastInsertRowid) };
	}

	get(...params: SqlValue[]): SqlRow | undefined {
		return this.stmt.get(...params) as SqlRow | undefined;
	}

	all(...params: SqlValue[]): SqlRow[] {
		return this.stmt.all(...params) as SqlRow[];
	}
}

class NodeSqliteDriver implements SqlDriver {
	readonly name = "node:sqlite" as const;
	private readonly db: DatabaseSync;
	private readonly statements = new Map<string, NodeSqliteStatement>();
	private depth = 0;
	private closed = false;

	constructor(readonly path: string) {
		const { DatabaseSync } = loadNodeSqlite();
		this.db = new DatabaseSync(path);
	}

	get open(): boolean {
		return !this.closed;
	}

	exec(sql: string): void {
		this.assertOpen();
		this.db.exec(sql);
	}

	prepare(sql: string): SqlStatement {
		this.assertOpen();
		let stmt = this.statements.get(sql);
		if (!stmt) {
			stmt = new NodeSqliteStatement(this.db.prepare(sql));
			this.statements.set(sql, stmt);
		}
		return stmt;
	}

	transaction<T>(fn: () => T): T {
		this.assertOpen();
		if (this.depth > 0) {
			this.depth += 1;
			try {
				return fn();
			} finally {
				this.depth -= 1;
			}
		}
		this.db.exec("BEGIN IMMEDIATE");
		this.depth = 1;
		try {
			const result = fn();
			this.db.exec("COMMIT");
			return result;
		} catch (error) {
			if (this.db.isTransaction) this.db.exec("ROLLBACK");
			throw error;
		} finally {
			this.depth = 0;
		}
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.statements.clear();
		this.db.close();
	}

	private assertOpen(): void {
		if (this.closed) throw new Error(`banco de memória já fechado: ${this.path}`);
	}
}

/** Open (creating if needed) a SQLite file with the built-in node:sqlite driver. */
export function openSqlDriver(path: string): SqlDriver {
	return new NodeSqliteDriver(path);
}
