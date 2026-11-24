import { z } from "zod";
import { PATHS } from "../../config.ts";
import { emit } from "../core/events.ts";
import type { TreeEnrichmentStatus } from "../core/study/creation.ts";
import { loadCurriculum, studyDomains, StudyError } from "./study.ts";
import { enrichRegionMaterials, MAX_MATERIALS_PER_NODE } from "./study-materials.ts";

const startSchema = z.strictObject({
	domain: z.string().trim().min(1).max(120),
	focusRegionId: z.string().trim().min(1).max(200).optional(),
	limit: z.number().int().min(1).max(200).optional(),
});

interface EnrichmentJob {
	status: TreeEnrichmentStatus;
	controller: AbortController;
}

const shared = globalThis as typeof globalThis & { __trilhaTreeEnrich?: Map<string, EnrichmentJob> };
const jobs = (shared.__trilhaTreeEnrich ??= new Map());

function jobKey(domain: string) {
	return `${PATHS.data}::${domain}`;
}

export function treeEnrichmentStatus(domain: string): TreeEnrichmentStatus | null {
	const found = jobs.get(jobKey(domain));
	return found ? { ...found.status } : null;
}

export function activeTreeEnrichments(): TreeEnrichmentStatus[] {
	const prefix = `${PATHS.data}::`;
	const now = Date.now();
	const list: TreeEnrichmentStatus[] = [];
	for (const [key, job] of jobs) {
		if (!key.startsWith(prefix)) continue;
		const st = job.status;
		// Keep running jobs and recently finished jobs (5 min) visible for the global status pill
		if (st.state === "running" || (st.finishedAt && now - st.finishedAt < 5 * 60_000)) {
			list.push({ ...st });
		}
	}
	return list;
}

export function cancelTreeEnrichment(domain: string): TreeEnrichmentStatus | null {
	const found = jobs.get(jobKey(domain));
	if (!found) return null;
	if (found.status.state === "running") {
		found.controller.abort();
		found.status = { ...found.status, state: "cancelled", finishedAt: Date.now() };
		emit("activity-changed", {});
	}
	return { ...found.status };
}

export function startTreeEnrichment(
	body: unknown,
	schedule: (run: () => Promise<void>) => void,
): TreeEnrichmentStatus {
	const parsed = startSchema.safeParse(body);
	if (!parsed.success) throw new StudyError(400, "Informe um domínio válido para enriquecer o acervo.");
	const { domain, focusRegionId, limit } = parsed.data;
	const key = jobKey(domain);
	const existing = jobs.get(key);
	if (existing && existing.status.state === "running") {
		return { ...existing.status };
	}

	const manifest = studyDomains().readManifest(domain);
	if (!manifest) throw new StudyError(404, "Domínio não encontrado.");
	const loaded = loadCurriculum(domain, manifest);
	if (!loaded) throw new StudyError(400, "Este domínio ainda não tem currículo instalado.");
	const { snapshot, view } = loaded;
	const units = view.ids
		.map(key => snapshot.items[key]!)
		.filter(n => n.kind === "unit")
		.map(n => ({ id: n.id, title: n.title.pt }));
	if (!units.length) throw new StudyError(400, "Este domínio ainda não tem regiões para enriquecer.");

	const ordered = focusRegionId
		? [units.find(u => u.id === focusRegionId), ...units.filter(u => u.id !== focusRegionId)].filter((u): u is (typeof units)[number] => Boolean(u))
		: units;
	const batch = ordered.slice(0, Math.min(limit ?? 12, ordered.length));

	const controller = new AbortController();
	const job: EnrichmentJob = {
		controller,
		status: {
			state: "running",
			domain,
			domainTitle: manifest.title.pt,
			done: 0,
			total: batch.length,
			currentRegionTitle: batch[0]?.title,
			addedBooks: 0,
			addedVideos: 0,
			upgraded: 0,
			skippedAtCap: 0,
			maxPerNode: MAX_MATERIALS_PER_NODE,
			startedAt: Date.now(),
		},
	};
	jobs.set(key, job);
	emit("activity-changed", {});

	schedule(async () => {
		const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15 * 60_000)]);
		try {
			const concurrency = Math.min(3, batch.length);
			let nextIdx = 0;
			const runWorker = async () => {
				while (nextIdx < batch.length) {
					if (signal.aborted) return;
					const unit = batch[nextIdx++]!;
					job.status = { ...job.status, currentRegionTitle: unit.title };
					emit("activity-changed", {});
					try {
						const res = await enrichRegionMaterials(domain, unit.id, undefined, {
							allowBackgroundDomain: true,
							signal,
						});
						if (signal.aborted) return;
						job.status = {
							...job.status,
							done: job.status.done + 1,
							addedBooks: job.status.addedBooks + res.addedBooks,
							addedVideos: job.status.addedVideos + res.addedVideos,
							upgraded: job.status.upgraded + res.upgraded,
							skippedAtCap: job.status.skippedAtCap + (res.atCap && res.addedBooks === 0 && res.addedVideos === 0 && res.upgraded === 0 ? 1 : 0),
						};
					} catch {
						if (signal.aborted) return;
						job.status = { ...job.status, done: job.status.done + 1 };
					}
					emit("activity-changed", {});
				}
			};
			await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
			if (signal.aborted) {
				job.status = { ...job.status, state: "cancelled", finishedAt: Date.now() };
			} else {
				job.status = { ...job.status, state: "done", currentRegionTitle: undefined, finishedAt: Date.now() };
			}
		} catch (error) {
			job.status = {
				...job.status,
				state: signal.aborted ? "cancelled" : "failed",
				error: signal.aborted ? undefined : (error instanceof Error ? error.message.slice(0, 300) : "Falha ao enriquecer o acervo."),
				finishedAt: Date.now(),
			};
		} finally {
			emit("activity-changed", {});
		}
	});

	return { ...job.status };
}
