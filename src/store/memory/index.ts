/**
 * Memory store barrel (I/O side of SÍNTESE §2.3 MemoryService; r4 §7).
 * `MemoryDb` = one domain's `<dir>/memory.db`; `DomainMemoryService` = the
 * per-domain router the app talks to.
 */

export { openSqlDriver, type SqlDriver, type SqlRow, type SqlRunResult, type SqlStatement, type SqlValue } from "./sql-driver.ts";
export { MEMORY_DDL, MEMORY_PRAGMAS, MEMORY_SCHEMA_VERSION, MemorySchemaError, applyMemorySchema, readMeta, writeMeta } from "./schema.ts";
export {
	MemoryRowError,
	itemKey,
	parseItemKey,
	toEpisode,
	toFact,
	toMessage,
	toObservation,
	type EpisodeRecord,
	type FactRecord,
	type MessageRecord,
	type ObservationRecord,
} from "./rows.ts";
export { MemoryCatalog, loadCatalog, type EligibilityOptions, type ItemMeta } from "./catalog.ts";
export { EXPORT_FILES, GENERATED_NOTICE, diaryMarkdown, mentalModelMarkdown, observationsMarkdown } from "./export-md.ts";
export { MEMORY_DB_FILE, MemoryDb, openMemoryDb, type FlashcardCandidateRecord, type MemoryDbOptions, type MemoryHealth } from "./memory-db.ts";
export { DomainMemoryService, type DomainMemoryServiceOptions } from "./service.ts";
