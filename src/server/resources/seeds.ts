/**
 * Loader of the curated seeds in content/resources/ (SÍNTESE §2.8 "Canais
 * curados (seed)"; r6 §7.8 channel lists and §9.3 open-book ladder):
 *   channels.json    trusted YouTube channels per domain (Beta(4,1) prior in
 *                    core score.ts; `channelId` null/unverified until the
 *                    Data API resolves the handle);
 *   open-books.json  open books per domain with license and official URL.
 * Validation is the core zod schemas (catalog.ts); a malformed file fails
 * loudly with the path in the message. Files are read once per process.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseChannelCatalog, parseOpenBookCatalog, type ChannelCatalog, type OpenBookCatalog } from "../../core/resources/catalog.ts";

export interface ResourceSeeds {
	channels: ChannelCatalog;
	books: OpenBookCatalog;
}

/** content/resources relative to this module (repo layout). */
export function defaultSeedsDir(): string {
	return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "content", "resources");
}

function readJsonFile(file: string): unknown {
	try {
		return JSON.parse(fs.readFileSync(file, "utf-8"));
	} catch (err) {
		throw new Error(`Não consegui ler ${file}: ${err instanceof Error ? err.message : String(err)}`);
	}
}

const loaded = new Map<string, ResourceSeeds>();

/** Parse and validate both seed files (memoized per directory). */
export function loadResourceSeeds(dir: string = defaultSeedsDir()): ResourceSeeds {
	const hit = loaded.get(dir);
	if (hit) return hit;
	const channelsFile = path.join(dir, "channels.json");
	const booksFile = path.join(dir, "open-books.json");
	let seeds: ResourceSeeds;
	try {
		seeds = { channels: parseChannelCatalog(readJsonFile(channelsFile)), books: parseOpenBookCatalog(readJsonFile(booksFile)) };
	} catch (err) {
		throw new Error(`Sementes de recursos inválidas em ${dir}: ${err instanceof Error ? err.message : String(err)}`);
	}
	loaded.set(dir, seeds);
	return seeds;
}
