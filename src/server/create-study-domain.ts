import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { PATHS } from "../../config.ts";
import { curriculumDir } from "../core/domains/paths.ts";
import type { DomainCreationStatus } from "../core/study/creation.ts";
import { generateDomainCurriculum } from "./domain-generation.ts";
import { attachRegionalSources } from "./domain-reading-list.ts";
import { installStudyDomain } from "./install-study-domain.ts";
import { StudyError, studyDomains } from "./study.ts";

const userMaterialSchema = z.strictObject({
	kind: z.enum(["book", "video"]),
	title: z.string().trim().min(2).max(160),
	url: z.string().trim().url().refine(u => /^https:\/\//i.test(u), "Use um link HTTPS válido."),
	part: z.string().trim().max(200).optional(),
	lang: z.string().trim().max(12).optional(),
	regionHint: z.string().trim().max(160).optional(),
});

const inputSchema = z.strictObject({
	requestId: z.uuid(),
	topic: z.string().trim().min(3).max(12_000),
	pace: z.enum(["focused", "semester", "extended"]).optional(),
	model: z.strictObject({ provider: z.string().min(1).max(160), id: z.string().min(1).max(256) }).optional(),
	initialMaterials: z.array(userMaterialSchema).max(24).optional(),
});
type Job = { status: DomainCreationStatus; fingerprint: string; controller: AbortController };
// Route bundles and hot reloads share the local server's single active generation.
const shared = globalThis as typeof globalThis & { __trilhaCreation?: Map<string, Job> };
const jobs = shared.__trilhaCreation ??= new Map();

function ids(requestId: string) {
	if (!z.uuid().safeParse(requestId).success) throw new StudyError(400, "Identificador de criação inválido.");
	return { domainId: "study-" + requestId.replaceAll("-", ""), key: PATHS.data + "/" + requestId };
}

function saved(requestId: string, fingerprint?: string): DomainCreationStatus | undefined {
	const { domainId } = ids(requestId);
	const manifest = studyDomains().readManifest(domainId);
	if (!manifest) return;
	const receipt = path.join(curriculumDir(PATHS.data, domainId), "generation.json");
	if (!fs.existsSync(receipt)) throw new StudyError(409, "Já existe um domínio com esse identificador.");
	const record = JSON.parse(fs.readFileSync(receipt, "utf8"));
	if (record.requestId !== requestId || (fingerprint && fingerprint !== record.fingerprint)) throw new StudyError(409, "Esse pedido pertence a outro domínio.");
	return { state: "ready", domainId, title: manifest.title.pt, ...(record.workload && { workload: record.workload }) };
}

export function domainCreationStatus(requestId: string) {
	const status = jobs.get(ids(requestId).key)?.status ?? saved(requestId);
	if (!status) throw new StudyError(404, "A criação foi interrompida. Você pode tentar novamente.");
	return status;
}

export function cancelDomainCreation(requestId: string) {
	jobs.get(ids(requestId).key)?.controller.abort();
	return domainCreationStatus(requestId);
}

function availablePrefix(requestId: string) {
	const used = new Set(studyDomains().scanDomains().manifests.map(m => m.nodePrefix));
	for (let i = 0; ; i++) {
		const bytes = createHash("sha256").update(requestId + i).digest();
		const prefix = Array.from(bytes.subarray(0, 4), b => String.fromCharCode(97 + b % 26)).join("");
		if (!used.has(prefix)) return prefix;
	}
}

export function startDomainCreation(body: unknown, schedule: (run: () => Promise<void>) => void): DomainCreationStatus {
	const input = inputSchema.safeParse(body);
	if (!input.success) throw new StudyError(400, "Descreva o que quer estudar em 3 a 12.000 caracteres e selecione um modelo válido.");
	const { requestId, topic, model, pace, initialMaterials } = input.data;
	const { domainId, key } = ids(requestId);
	const fingerprint = createHash("sha256").update(JSON.stringify([topic, model, ...(pace ? [pace] : []), ...(initialMaterials?.length ? [initialMaterials] : [])])).digest("hex");
	const existing = saved(requestId, fingerprint);
	if (existing) return existing;
	const previous = jobs.get(key);
	if (previous) {
		if (previous.fingerprint !== fingerprint) throw new StudyError(409, "Este pedido de criação já tem outro tema ou modelo.");
		return previous.status;
	}
	for (const [id, job] of jobs) {
		if (job.status.state === "planning" || job.status.state === "materials") throw new StudyError(409, "Já há uma árvore em criação. Aguarde o término.");
		if (jobs.size >= 32) jobs.delete(id);
	}
	const job: Job = { fingerprint, status: { state: "planning", done: 0, total: 0 }, controller: new AbortController() };
	jobs.set(key, job);
	schedule(async () => {
		const signal = AbortSignal.any([job.controller.signal, AbortSignal.timeout((pace === "extended" ? 120 : 45) * 60_000)]);
		try {
			const result = await generateDomainCurriculum({ topic, model, pace, domainId, prefix: availablePrefix(requestId), signal,
				onProgress: (done, total) => { job.status = { state: "planning", done, total }; } });
			job.status = { state: "materials", done: 0, total: result.regions.length };
			await attachRegionalSources(
				result.seed,
				result.regions,
				signal,
				done => { job.status = { state: "materials", done, total: result.regions.length }; },
				undefined,
				initialMaterials,
			);
			signal.throwIfAborted();
			const manifest = installStudyDomain([result.seed], { requestId, fingerprint, topic, model: result.model, reviews: result.reviews, pace });
			job.status = saved(requestId, fingerprint) ?? { state: "ready", domainId, title: manifest.title.pt };
		} catch (error) {
			job.status = { state: "failed", error: signal.aborted ? "Criação interrompida. Você pode tentar novamente." :
				error instanceof Error ? error.message.slice(0, 480) : "Não foi possível criar o domínio." };
		}
	});
	return job.status;
}
