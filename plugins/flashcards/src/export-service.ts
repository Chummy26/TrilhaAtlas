/**
 * Export/sync service behind the plugin backend operations (SÍNTESE §2.4(d) item 5,
 * §2.2 `plugins/flashcards/… + sync-cursor.json`; r7 §8).
 *
 * Owns `<dataDirectory>/sync-cursor.json` (settings for vault/review mode/AnkiConnect,
 * the SyncCursor, ExternalLinks and the imported Anki revlog) and composes the pure
 * exporters with the review store:
 * - export-obsidian → one-way vault mirror (obsidian-export.ts);
 * - anki-push / anki-import-reviews → AnkiConnect v1/v6 (anki-connect.ts; a v1 call
 *   contract mismatch reruns the task on v6);
 * - export-apkg → offline package of every card (apkg-export.ts); export-anki = push, or,
 *   when Anki is closed, a package of only the cards Anki does not hold yet (notes made
 *   by AnkiConnect have Anki's own GUIDs: packaging them again would duplicate them);
 * - get-revlog → app reviews + Anki reviews as RevlogEntry (evidence weight 0.3).
 * With review mode "anki" the app queue and due counts skip Anki-linked propositions
 * and, after a revlog import, their schedule is rebuilt from the merged log (FSRS-7,
 * r7 §8.1 "state = replay(revlog)", §8.4), so a card reviewed only in Anki does not stay
 * New. Cards a push adopts after the cursor was set have their whole history imported
 * once (`revlogBackfill`).
 * Links and the cursor belong to one Anki profile: with another profile open, push and
 * import return `{ mode: "profile-mismatch" }` until a push confirms `switchProfile`
 * (r7 §8.3 "recusar push se o perfil ativo for outro").
 * Sync operations are serialized: a second one fails fast instead of interleaving.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { AnkiUnavailableError, connectAnki, importAnkiRevlog, pushToAnki, withV6Fallback, type AnkiApi, type AnkiConnectOptions } from "./anki-connect.ts";
import { writeApkg } from "./apkg-export.ts";
import { collectExportCards, type ExportCard, type ExportDomain, type ExportSource } from "./export-model.ts";
import { isFsrs7Schedule, replayMergedSchedule, type AnySchedule, type SchedulerSettings, type TimedRating } from "./fsrs7.ts";
import { writeFileAtomic } from "./fs-durable.ts";
import { exportToObsidian, resolveVault } from "./obsidian-export.ts";
import {
	ANKI_REVLOG_EVIDENCE_WEIGHT,
	applySyncSettingsPatch,
	createSyncState,
	DOMAIN_ID_PATTERN,
	parseSyncState,
	type ExternalLink,
	type ReviewClient,
	type RevlogEntry,
	type SyncSettings,
	type SyncState,
} from "./sync-types.ts";

export const SYNC_FILE = "sync-cursor.json";

export interface StoredReview {
	id: string;
	propositionId: string;
	cueId: string;
	rating: number;
	at: number;
	before?: { state?: unknown } | null;
}

export interface FlashcardsState extends ExportSource {
	reviews: readonly StoredReview[];
	propositions: ExportSource["propositions"] & Record<string, { schedule?: unknown }>;
	/** Review settings (retention, steps, study-day start) used when a merged log is replayed. */
	settings?: SchedulerSettings;
}

export interface ExportServiceOptions {
	dataDirectory: string;
	/** Absolute path of sql-wasm.wasm for .apkg export. */
	wasmPath: string;
	getState(): FlashcardsState;
	/** Propositions still present (graph nodes and local file/manual ones); others are archived. */
	liveIds(): ReadonlySet<string>;
	/** Applies a mutation to the review store (backend `change`). */
	changeState(update: (state: FlashcardsState) => void): void;
	fetch?: typeof fetch;
	now?: () => Date;
}

interface DomainManifestLike { title?: { pt?: unknown; en?: unknown }; reviewClient?: unknown }

/**
 * `…/domains/<id>/plugins/flashcards` → `…/domains/<id>` (SÍNTESE §2.2 per-domain plugin
 * data), using `path.dirname` so drive letters and UNC shares stay intact. Any other
 * layout → null.
 */
export function domainDirectory(dataDirectory: string): string | null {
	const plugins = path.dirname(path.resolve(dataDirectory));
	const domain = path.dirname(plugins);
	const domains = path.dirname(domain);
	if (path.basename(plugins) !== "plugins" || path.basename(domains) !== "domains" || domain === domains) return null;
	return domain;
}

export function inferDomainId(dataDirectory: string): string | null {
	const directory = domainDirectory(dataDirectory);
	const id = directory ? path.basename(directory) : null;
	return id && DOMAIN_ID_PATTERN.test(id) ? id : null;
}

function readDomainManifest(dataDirectory: string): DomainManifestLike | null {
	const directory = domainDirectory(dataDirectory);
	if (!directory) return null;
	const file = path.join(directory, "domain.json");
	try {
		const value = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
		return typeof value === "object" && value !== null ? value as DomainManifestLike : null;
	} catch {
		return null;
	}
}

export function resolveDomain(settings: SyncSettings, dataDirectory: string): ExportDomain {
	const inferred = inferDomainId(dataDirectory);
	const id = settings.domainId ?? inferred ?? "default";
	const manifest = id === inferred ? readDomainManifest(dataDirectory) : null;
	const manifestTitle = typeof manifest?.title?.pt === "string" ? manifest.title.pt : typeof manifest?.title?.en === "string" ? manifest.title.en : null;
	return { id, title: settings.domainTitle ?? manifestTitle ?? id };
}

function loadSyncState(file: string, dataDirectory: string): SyncState {
	let raw: string;
	try { raw = fs.readFileSync(file, "utf8"); } catch (error) {
		if ((error as { code?: string }).code !== "ENOENT") throw new Error(`Não foi possível ler ${SYNC_FILE}: ${(error as Error).message}`);
		const manifest = readDomainManifest(dataDirectory);
		const reviewClient: ReviewClient = manifest?.reviewClient === "anki" ? "anki" : "app";
		return createSyncState({ reviewClient });
	}
	let value: unknown;
	try { value = JSON.parse(raw); } catch { throw new Error(`${SYNC_FILE} está corrompido. Nenhum dado foi alterado.`); }
	return parseSyncState(value);
}

/** App reviews as RevlogEntry (the app does not time answers: durationMs 0). */
export function appRevlog(reviews: readonly StoredReview[]): RevlogEntry[] {
	return reviews.filter((review) => [1, 2, 3, 4].includes(review.rating) && Number.isFinite(review.at)).map((review) => ({
		id: `app:${review.id}` as const,
		propositionId: review.propositionId,
		cueId: review.cueId,
		at: new Date(review.at).toISOString(),
		rating: review.rating as RevlogEntry["rating"],
		durationMs: 0,
		origin: "app" as const,
	}));
}

/** Merged history of one proposition: app reviews since its last fresh start + Anki reviews. */
export function mergedHistory(propositionId: string, reviews: readonly StoredReview[], revlog: readonly RevlogEntry[]): TimedRating[] {
	const own = reviews.filter((review) => review.propositionId === propositionId).sort((a, b) => a.at - b.at);
	let start = 0;
	own.forEach((review, index) => { if (review.before?.state === 0) start = index; });
	const app = own.slice(start).filter((review) => [1, 2, 3, 4].includes(review.rating)).map((review) => ({ rating: review.rating as TimedRating["rating"], at: review.at }));
	const anki = revlog.filter((entry) => entry.origin === "anki" && entry.propositionId === propositionId).map((entry) => ({ rating: entry.rating, at: Date.parse(entry.at) }));
	return [...app, ...anki].sort((a, b) => a.at - b.at);
}

export function createExportService(options: ExportServiceOptions) {
	const file = path.join(options.dataDirectory, SYNC_FILE);
	let state = loadSyncState(file, options.dataDirectory);
	let busy = false;
	const now = (): Date => options.now?.() ?? new Date();

	function save(next: SyncState): void {
		fs.mkdirSync(options.dataDirectory, { recursive: true });
		writeFileAtomic(file, `${JSON.stringify(next, null, "\t")}\n`);
		state = next;
	}

	async function exclusive<T>(run: () => Promise<T> | T): Promise<T> {
		if (busy) throw new Error("Outra exportação ou sincronização está em andamento. Aguarde terminar.");
		busy = true;
		try { return await run(); } finally { busy = false; }
	}

	const domain = (): ExportDomain => resolveDomain(state.settings, options.dataDirectory);
	const cards = (): ExportCard[] => {
		const live = options.liveIds();
		return collectExportCards(options.getState(), domain(), (id) => live.has(id));
	};
	const ankiOptions = (): AnkiConnectOptions => ({ url: state.settings.ankiConnectUrl, apiKey: state.settings.ankiApiKey, ...(options.fetch ? { fetch: options.fetch } : {}) });
	const connect = (): Promise<AnkiApi> => connectAnki(ankiOptions());
	/** Runs an Anki task on the connected API, rerunning it on v6 when v1 rejects the call contract. */
	const onAnki = <T>(api: AnkiApi, task: (api: AnkiApi) => Promise<T>): Promise<T> => withV6Fallback(api, ankiOptions(), task);

	function withLinks(next: SyncState, update: (links: Record<string, ExternalLink>) => void): SyncState {
		const links = structuredClone(next.links);
		update(links);
		for (const [cueId, link] of Object.entries(links)) if (!link.anki && !link.obsidian) delete links[cueId];
		return { ...next, links };
	}

	function linkFor(links: Record<string, ExternalLink>, card: ExportCard): ExternalLink {
		const link = links[card.cueId] ?? { cueId: card.cueId, propositionId: card.propositionId, domainId: card.domainId };
		link.propositionId = card.propositionId;
		link.domainId = card.domainId;
		links[card.cueId] = link;
		return link;
	}

	function view() {
		const links = Object.values(state.links);
		const { ankiApiKey, ...settings } = state.settings;
		return {
			settings: { ...settings, ankiApiKeySet: !!ankiApiKey },
			domain: domain(),
			cursor: state.cursor,
			linked: { obsidian: links.filter((link) => link.obsidian).length, anki: links.filter((link) => link.anki).length },
			ankiReviews: state.revlog.length,
			lastApkg: state.lastApkg,
			evidenceWeight: ANKI_REVLOG_EVIDENCE_WEIGHT,
		};
	}

	function saveSettings(patch: Record<string, unknown>) {
		const settings = applySyncSettingsPatch(state.settings, patch);
		if (settings.obsidianVaultPath !== null && settings.obsidianVaultPath !== state.settings.obsidianVaultPath) resolveVault(settings.obsidianVaultPath);
		save({ ...state, settings });
		return view();
	}

	function exportObsidian() {
		return exclusive(() => {
			const vaultPath = state.settings.obsidianVaultPath;
			if (!vaultPath) throw new Error("Configure a pasta do cofre do Obsidian antes de exportar.");
			const vault = resolveVault(vaultPath);
			const exported = cards();
			const previousLinks = Object.fromEntries(Object.entries(state.links).map(([cueId, link]) => [cueId, link.obsidian]));
			const result = exportToObsidian({
				vaultPath: vault,
				domain: domain(),
				cards: exported,
				previousFiles: state.obsidian?.vaultPath === vault ? state.obsidian.files : {},
				previousLinks,
				now: now(),
			});
			let next = withLinks(state, (links) => {
				for (const link of Object.values(links)) delete link.obsidian;
				for (const card of exported) {
					const obsidian = result.links[card.cueId];
					if (obsidian) linkFor(links, card).obsidian = obsidian;
				}
			});
			next = { ...next, obsidian: { vaultPath: vault, files: result.files } };
			save(next);
			return { vaultPath: vault, cards: result.cards, written: result.written, unchanged: result.unchanged, removed: result.removed, emptied: result.emptied };
		});
	}

	async function ankiStatus() {
		try {
			return await onAnki(await connect(), async (api) => ({ available: true as const, flavor: api.flavor, profile: await api.profile() }));
		} catch (error) {
			if (error instanceof AnkiUnavailableError) return { available: false as const, message: error.message };
			throw error;
		}
	}

	/**
	 * Links and the revlog cursor belong to one Anki profile (r7 §8.3): with another
	 * profile open, sync stops and reports both names until the user confirms a switch.
	 */
	function profileMismatch(active: string, switchProfile: boolean) {
		const expected = state.cursor?.ankiProfile;
		if (switchProfile || !expected || expected === active) return null;
		return {
			mode: "profile-mismatch" as const,
			active,
			expected,
			message: `O Anki está com o perfil “${active}” aberto, mas este domínio sincroniza com “${expected}”. Abra “${expected}” no Anki ou confirme a troca de perfil.`,
		};
	}

	function switchFlag(input: { switchProfile?: unknown }): boolean {
		if (input.switchProfile !== undefined && typeof input.switchProfile !== "boolean") throw new Error("switchProfile deve ser verdadeiro ou falso.");
		return input.switchProfile === true;
	}

	async function push(api: AnkiApi, switchProfile: boolean) {
		const exported = cards();
		if (!exported.length) throw new Error("Não há cartões para enviar ao Anki.");
		const previous = Object.fromEntries(Object.entries(state.links).map(([cueId, link]) => [cueId, link.anki]));
		const outcome = await onAnki(api, async (client) => {
			const active = await client.profile();
			const mismatch = profileMismatch(active, switchProfile);
			if (mismatch) return mismatch;
			// Links of another profile point at notes this collection does not have.
			const switching = state.cursor !== null && state.cursor.ankiProfile !== active;
			return pushToAnki(client, exported, switching ? {} : previous, now());
		});
		if ("mode" in outcome) return outcome;
		const result = outcome;
		const switched = state.cursor !== null && state.cursor.ankiProfile !== result.profile;
		const exportedIds = new Set(exported.map((card) => card.cueId));
		let next = withLinks(state, (links) => {
			for (const link of Object.values(links)) if (switched || !exportedIds.has(link.cueId)) delete link.anki;
			for (const card of exported) {
				const anki = result.links[card.cueId];
				if (anki) linkFor(links, card).anki = anki;
			}
		});
		const sameProfile = state.cursor?.ankiProfile === result.profile;
		const latest = sameProfile && state.cursor ? state.cursor.ankiLatestRevlogId : 0;
		// With a cursor in place, adopted notes need their older reviews read once; a fresh cursor (0) reads everything anyway.
		const backfill = latest > 0 ? [...new Set([...next.revlogBackfill, ...result.adoptedCardIds])] : [];
		next = { ...next, revlogBackfill: backfill, cursor: { ankiLatestRevlogId: latest, ankiProfile: result.profile, apiFlavor: result.flavor } };
		save(next);
		return {
			mode: "ankiconnect" as const,
			flavor: result.flavor,
			profile: result.profile,
			created: result.created,
			updated: result.updated,
			unchanged: result.unchanged,
			moved: result.moved,
			failed: result.failed,
			orphans: result.orphans,
			duplicates: result.duplicates,
		};
	}

	function pushAnki(input: { switchProfile?: unknown } = {}) {
		const switchProfile = switchFlag(input);
		return exclusive(async () => push(await connect(), switchProfile));
	}

	async function writePackage(exported: readonly ExportCard[]) {
		const written = await writeApkg(exported, { domain: domain(), wasmPath: options.wasmPath, directory: path.join(options.dataDirectory, "exports"), now: now() });
		save({ ...state, lastApkg: { path: written.path, at: now().toISOString(), notes: written.notes } });
		return written;
	}

	/** Every card: a full package for a new profile or device (explicit `export-apkg`). */
	function exportApkg() {
		return exclusive(async () => ({ mode: "apkg" as const, ...await writePackage(cards()) }));
	}

	/**
	 * Anki closed: only the cards Anki does not hold yet. Notes AnkiConnect created carry
	 * Anki's own GUIDs, so packaging them again would import duplicates; their content
	 * changes wait for the next push (`alreadyInAnki`). Nothing new → no file.
	 */
	async function fallbackPackage(reason: string) {
		const all = cards();
		const fresh = all.filter((card) => !state.links[card.cueId]?.anki);
		const alreadyInAnki = all.length - fresh.length;
		if (!fresh.length) return { mode: "apkg" as const, path: null, notes: 0, bytes: 0, alreadyInAnki, reason };
		return { mode: "apkg" as const, ...await writePackage(fresh), alreadyInAnki, reason };
	}

	/** AnkiConnect when Anki is open; otherwise the offline .apkg. */
	function exportAnki(input: { switchProfile?: unknown } = {}) {
		const switchProfile = switchFlag(input);
		return exclusive(async () => {
			let api: AnkiApi;
			try { api = await connect(); } catch (error) {
				if (!(error instanceof AnkiUnavailableError)) throw error;
				return fallbackPackage(error.message);
			}
			return push(api, switchProfile);
		});
	}

	/**
	 * Review mode "anki": rebuilds each affected schedule from its merged log. FSRS-7
	 * schedules and never-graded legacy ones (no memory to lose) are rebuilt; a reviewed
	 * FSRS-6 schedule whose history could not be migrated stays as it is.
	 */
	function replayAnkiScheduled(propositionIds: ReadonlySet<string>): number {
		if (state.settings.reviewClient !== "anki" || !propositionIds.size) return 0;
		let replayed = 0;
		options.changeState((store) => {
			for (const id of propositionIds) {
				const proposition = Object.hasOwn(store.propositions, id) ? store.propositions[id] : undefined;
				const schedule = proposition?.schedule as AnySchedule | undefined;
				if (!proposition || !schedule || (!isFsrs7Schedule(schedule) && schedule.state !== 0)) continue;
				const history = mergedHistory(id, store.reviews, state.revlog);
				if (!history.length) continue;
				proposition.schedule = replayMergedSchedule(schedule, history, store.settings ?? {});
				replayed++;
			}
		});
		return replayed;
	}

	function importAnkiReviews() {
		return exclusive(async () => {
			const outcome = await onAnki(await connect(), async (api) => {
				const active = await api.profile();
				const mismatch = profileMismatch(active, false);
				if (mismatch) return mismatch;
				return { profile: active, flavor: api.flavor, imported: await importAnkiRevlog(api, state.links, state.cursor, active, state.revlogBackfill) };
			});
			if ("mode" in outcome) return outcome;
			const { profile, flavor, imported } = outcome;
			const known = new Set(state.revlog.map((entry) => entry.id));
			const fresh = imported.entries.filter((entry) => !known.has(entry.id));
			const revlog = [...state.revlog, ...fresh].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
			save({ ...state, revlog, revlogBackfill: [], cursor: { ankiLatestRevlogId: imported.latestId, ankiProfile: profile, apiFlavor: flavor } });
			const replayed = replayAnkiScheduled(new Set(fresh.map((entry) => entry.propositionId)));
			return { imported: fresh.length, skipped: imported.skipped, latestId: imported.latestId, replayed, evidenceWeight: ANKI_REVLOG_EVIDENCE_WEIGHT };
		});
	}

	function revlog(input: { propositionId?: unknown; origin?: unknown }) {
		if (input.propositionId !== undefined && typeof input.propositionId !== "string") throw new Error("propositionId inválido.");
		if (input.origin !== undefined && input.origin !== "app" && input.origin !== "anki") throw new Error('origin deve ser "app" ou "anki".');
		const entries = [...appRevlog(options.getState().reviews), ...state.revlog]
			.filter((entry) => (input.propositionId === undefined || entry.propositionId === input.propositionId) && (input.origin === undefined || entry.origin === input.origin))
			.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
		return { entries, evidenceWeight: ANKI_REVLOG_EVIDENCE_WEIGHT };
	}

	/** Propositions Anki schedules (review mode "anki" + at least one Anki-linked cue); null in app mode. */
	function ankiScheduled(): ReadonlySet<string> | null {
		if (state.settings.reviewClient !== "anki") return null;
		return new Set(Object.values(state.links).filter((link) => link.anki).map((link) => link.propositionId));
	}

	return { view, saveSettings, exportObsidian, ankiStatus, pushAnki, importAnkiReviews, exportApkg, exportAnki, revlog, ankiScheduled };
}

export type ExportService = ReturnType<typeof createExportService>;
