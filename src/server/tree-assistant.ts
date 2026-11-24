import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { normalizeContext } from "@earendil-works/pi-ai";
import { z } from "zod";
import { PATHS } from "../../config.ts";
import { writeFileAtomicSync } from "../store/atomic-write.ts";
import { applyPatch } from "../core/curriculum/patch.ts";
import { BloomLevelSchema } from "../core/curriculum/schema.ts";
import type { CurriculumSnapshot, PatchEnvelope } from "../core/curriculum/types.ts";
import { curriculumDir, libraryDir } from "../core/domains/paths.ts";
import { emit } from "../core/events.ts";
import { estimateTokens } from "../core/memory/tokens.ts";
import { domainAuthoringEngine } from "./domain-authoring-engine.ts";
import { extractJson } from "./memory/extractor.ts";
import { addManualMaterial } from "./resources/manual-materials.ts";
import { linkRegionalReading } from "./resources/region-readings.ts";
import { listLibrary } from "./resources/user-library.ts";
import { loadCurriculum, studyDomains, StudyError } from "./study.ts";
import { enrichRegionMaterials, readRegionMaterials } from "./study-materials.ts";

const historyEntrySchema = z.strictObject({
	role: z.enum(["user", "assistant"]),
	text: z.string().trim().min(1).max(2000),
});

const requestSchema = z.strictObject({
	domain: z.string().trim().min(1).max(120),
	selectedNodeId: z.string().trim().min(1).max(200).optional(),
	prompt: z.string().trim().min(2).max(4000),
	history: z.array(historyEntrySchema).max(12).optional(),
});

const updateNodeActionSchema = z.strictObject({
	type: z.literal("update_node"),
	nodeId: z.string().trim().min(1),
	titlePt: z.string().trim().min(2).max(120).optional(),
	titleEn: z.string().trim().min(2).max(120).optional(),
	summary: z.string().trim().min(10).max(500).optional(),
	objectives: z.array(z.string().trim().min(5).max(300)).min(1).max(6).optional(),
	assess: z.array(z.string().trim().min(5).max(300)).min(1).max(4).optional(),
	scope: z.string().trim().min(5).max(500).optional(),
	bloom: BloomLevelSchema.optional(),
	minutes: z.number().int().min(10).max(90).optional(),
});

const addSkillActionSchema = z.strictObject({
	type: z.literal("add_skill"),
	regionId: z.string().trim().min(1),
	titlePt: z.string().trim().min(2).max(120),
	titleEn: z.string().trim().min(2).max(120),
	summary: z.string().trim().min(10).max(500),
	objective: z.string().trim().min(10).max(400),
	assessment: z.string().trim().min(10).max(400),
	bloom: BloomLevelSchema.optional(),
	minutes: z.number().int().min(10).max(60).optional(),
	requires: z.array(z.string().trim().min(1)).max(4).optional(),
});

const addMaterialActionSchema = z.strictObject({
	type: z.literal("add_material"),
	nodeId: z.string().trim().min(1),
	kind: z.enum(["book", "video"]),
	title: z.string().trim().min(2).max(160),
	part: z.string().trim().min(2).max(200),
	url: z.string().trim().min(5).max(1000),
	lang: z.string().trim().max(12).optional(),
	notes: z.string().trim().max(300).optional(),
	libraryBookId: z.string().trim().regex(/^[a-f0-9]{64}$/i).optional(),
});

const linkLibraryPdfActionSchema = z.strictObject({
	type: z.literal("link_library_pdf"),
	regionId: z.string().trim().min(1),
	libraryBookId: z.string().trim().regex(/^[a-f0-9]{64}$/i),
});

const enrichRegionActionSchema = z.strictObject({
	type: z.literal("enrich_region"),
	regionId: z.string().trim().min(1),
});

const assistantActionSchema = z.discriminatedUnion("type", [
	updateNodeActionSchema,
	addSkillActionSchema,
	addMaterialActionSchema,
	linkLibraryPdfActionSchema,
	enrichRegionActionSchema,
]);

const assistantResponseSchema = z.strictObject({
	reply: z.string().trim().min(1).max(3000),
	actions: z.array(assistantActionSchema).max(6).default([]),
});

export interface TreeAssistantAppliedAction {
	type: z.infer<typeof assistantActionSchema>["type"];
	label: string;
	ok: boolean;
	detail?: string;
}

export interface TreeAssistantResult {
	reply: string;
	applied: TreeAssistantAppliedAction[];
	refreshedMap: boolean;
	refreshedMaterials: boolean;
	focusNodeId?: string;
}

const SYSTEM_PROMPT = `Você é o Assistente da Árvore de Habilidades do TrilhaAtlas.
O aluno pode pedir livremente melhorias em nós da árvore, criação de novas habilidades em uma região, adição de PDFs/livros/vídeos (por link HTTPS ou livro já importado na biblioteca), enriquecimento de acervo ou tirar dúvidas sobre a trilha.

Responda SEMPRE em JSON estrito no formato:
{"reply":"mensagem curta e clara em português do Brasil explicando o que você fez ou respondendo à pergunta","actions":[...]}

Ações disponíveis em "actions" (use [] se for apenas uma dúvida sem alterações):
1. {"type":"update_node","nodeId":"id-existente","titlePt?":"...","titleEn?":"...","summary?":"atividade concreta","objectives?":["..."],"assess?":["..."],"scope?":"...","bloom?":"apply","minutes?":25}
   - Melhora ou edita um nó existente preservando seu ID e histórico.
2. {"type":"add_skill","regionId":"id-de-uma-unit","titlePt":"...","titleEn":"...","summary":"atividade concreta 10-500 chars","objective":"objetivo avaliável","assessment":"critério de verificação","bloom?":"apply","minutes?":25,"requires?":["id-de-habilidade-existente"]}
   - Cria uma nova habilidade (atom) dentro de uma região (kind="unit") existente.
3. {"type":"add_material","nodeId":"id-do-no","kind":"book"|"video","title":"título da obra/vídeo","part":"capítulo, páginas ou trecho","url":"https://... ou /ler/<hash64>","lang?":"pt","notes?":"...","libraryBookId?":"<hash64>"}
   - Vincula um PDF/livro/vídeo externo (HTTPS) ou da biblioteca local ao nó.
4. {"type":"link_library_pdf","regionId":"id-de-uma-unit","libraryBookId":"<hash64>"}
   - Vincula um PDF já existente na biblioteca do aluno à região.
5. {"type":"enrich_region","regionId":"id-de-uma-unit"}
   - Busca e qualifica livros abertos e videoaulas para a região (limite de 10 materiais/nó).

Regras:
- Use EXCLUSIVAMENTE IDs reais presentes no contexto fornecido (nunca invente nodeId, regionId ou libraryBookId).
- Nunca invente URLs externas falsas: use URLs fornecidas pelo aluno ou use "enrich_region" para buscar fontes reais.
- Para melhorar um nó, escreva objetivos observáveis, atividade específica e avaliação verificável em português do Brasil.
- Retorne apenas o objeto JSON, sem texto fora dele.`;

function slugifyId(text: string): string {
	const cleaned = text
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 28);
	return cleaned || "skill";
}

function regionOfNode(snapshot: CurriculumSnapshot, nodeId: string): string | null {
	let cur = snapshot.items[nodeId];
	while (cur) {
		if (cur.kind === "unit") return cur.id;
		cur = cur.parentId ? snapshot.items[cur.parentId] : undefined;
	}
	return null;
}

function persistCurriculumPatch(domain: string, snapshot: CurriculumSnapshot, envelope: PatchEnvelope): CurriculumSnapshot {
	const result = applyPatch(snapshot, envelope, { edgeMode: "strict" });
	if (!result.ok) {
		const msg = result.errors.slice(0, 2).map(e => e.message).join(" · ");
		throw new Error(msg || "Patch rejeitado pela validação do currículo.");
	}
	const dir = curriculumDir(PATHS.data, domain);
	const ledgerFile = path.join(dir, "ledger.jsonl");
	const snapshotFile = path.join(dir, "snapshot.json");
	const metaFile = path.join(dir, "snapshot.meta.json");

	const existingLedger = fs.existsSync(ledgerFile) ? fs.readFileSync(ledgerFile, "utf8") : "";
	const nextLedger = (existingLedger.trimEnd() ? existingLedger.trimEnd() + "\n" : "") + JSON.stringify(envelope) + "\n";
	writeFileAtomicSync(ledgerFile, nextLedger);
	writeFileAtomicSync(snapshotFile, JSON.stringify(result.next));
	// Remove stale snapshot.meta.json so loadCurriculum refreshes cleanly on next read.
	try {
		if (fs.existsSync(metaFile)) fs.unlinkSync(metaFile);
	} catch {
		// Best effort.
	}
	return result.next;
}

export async function runTreeAssistant(
	rawBody: unknown,
	engineFor = domainAuthoringEngine,
): Promise<TreeAssistantResult> {
	const parsed = requestSchema.safeParse(rawBody);
	if (!parsed.success) {
		throw new StudyError(400, "Descreva o que deseja alterar ou perguntar sobre a árvore (2 a 4.000 caracteres).");
	}
	const { domain, selectedNodeId, prompt, history = [] } = parsed.data;
	const manifest = studyDomains().readManifest(domain);
	if (!manifest) throw new StudyError(404, "Domínio não encontrado.");
	const loaded = loadCurriculum(domain, manifest);
	if (!loaded) throw new StudyError(400, "Este domínio ainda não possui currículo carregado.");

	let snapshot = loaded.snapshot;
	const allItems = Object.values(snapshot.items).filter(i => i.status !== "deprecated");
	const units = allItems.filter(i => i.kind === "unit");
	const selected = (selectedNodeId && snapshot.items[selectedNodeId]) || units[0] || allItems[0];
	const selectedRegionId = selected ? regionOfNode(snapshot, selected.id) : null;
	const regionItems = selectedRegionId
		? allItems.filter(i => i.id === selectedRegionId || regionOfNode(snapshot, i.id) === selectedRegionId)
		: [];

	const shelf = selectedRegionId
		? await readRegionMaterials(domain, selectedRegionId, undefined, true).catch(() => null)
		: null;
	const libraryItems = listLibrary(libraryDir(PATHS.data));
	const library = libraryItems.slice(0, 20).map(b => ({ id: b.sha256, title: b.title, format: b.format }));

	const contextPayload = {
		domain: { id: domain, title: manifest.title.pt },
		selectedNode: selected
			? {
				id: selected.id,
				kind: selected.kind,
				parentId: selected.parentId,
				regionId: selectedRegionId,
				title: selected.title,
				summary: selected.summary,
				objectives: selected.objectives,
				assess: selected.assess,
				scope: selected.scope,
				bloom: selected.bloom,
				hours: selected.hours,
				clauses: selected.clauses,
			}
			: null,
		regionNodes: regionItems.slice(0, 24).map(n => ({
			id: n.id,
			kind: n.kind,
			title: n.title.pt,
			clauses: n.clauses,
		})),
		allRegions: units.slice(0, 40).map(u => ({ id: u.id, title: u.title.pt })),
		currentRegionMaterials: (shelf?.materials ?? []).slice(0, 12).map(m => ({
			kind: m.kind,
			title: m.title,
			part: m.part,
			url: m.url,
			manual: Boolean(m.manual),
		})),
		userLibraryBooks: library,
	};

	const engine = await engineFor(domain);
	const modelTag = `${engine.model.provider}:${engine.model.id}`;
	const userContent = JSON.stringify({
		context: contextPayload,
		conversationHistory: history.slice(-6),
		learnerRequest: prompt,
	});
	const maxTokens = Math.min(4096, engine.model.maxTokens, engine.model.contextWindow - estimateTokens(SYSTEM_PROMPT + userContent) - 128);
	if (maxTokens < 256) throw new StudyError(400, "Contexto insuficiente no modelo selecionado para processar este pedido.");

	const ctx = normalizeContext({
		systemPrompt: SYSTEM_PROMPT,
		messages: [{ role: "user", content: userContent, timestamp: Date.now() }],
	});
	const replyMsg = await engine.streamFn(engine.model, ctx, { maxTokens, maxRetries: 0 }).result();
	if (replyMsg.stopReason === "error" || replyMsg.stopReason === "aborted") {
		throw new StudyError(502, replyMsg.errorMessage ?? "Não foi possível obter resposta do modelo.");
	}
	const rawText = replyMsg.content.flatMap(b => (b.type === "text" ? [b.text] : [])).join("");
	let plan: z.infer<typeof assistantResponseSchema>;
	try {
		plan = assistantResponseSchema.parse(extractJson(rawText));
	} catch {
		// Graceful fallback if the model answered in plain prose without actions.
		const plain = rawText.trim().slice(0, 2000);
		if (!plain) throw new StudyError(502, "O modelo retornou uma resposta vazia.");
		return { reply: plain, applied: [], refreshedMap: false, refreshedMaterials: false };
	}

	const applied: TreeAssistantAppliedAction[] = [];
	let refreshedMap = false;
	let refreshedMaterials = false;
	let focusNodeId: string | undefined;

	for (const action of plan.actions) {
		try {
			if (action.type === "update_node") {
				const target = snapshot.items[action.nodeId];
				if (!target || target.status === "deprecated") {
					applied.push({ type: action.type, label: action.nodeId, ok: false, detail: "Nó não encontrado." });
					continue;
				}
				const fields: Record<string, unknown> = {};
				if (action.titlePt || action.titleEn) {
					fields.title = {
						pt: action.titlePt ?? target.title.pt,
						en: action.titleEn ?? target.title.en,
					};
				}
				if (action.summary) fields.summary = action.summary;
				if (action.objectives) fields.objectives = action.objectives;
				if (action.assess) fields.assess = action.assess;
				if (action.scope) fields.scope = action.scope;
				if (action.bloom) fields.bloom = action.bloom;

				const ops: PatchEnvelope["ops"] = [];
				if (Object.keys(fields).length > 0) {
					ops.push({ op: "updateItem", item: target.id, fields: fields as never });
				}
				if (action.minutes !== undefined) {
					const h = Number((action.minutes / 60).toFixed(2));
					ops.push({ op: "setHours", item: target.id, hours: { lo: h, hi: h } });
				}
				if (!ops.length) continue;

				const envelope: PatchEnvelope = {
					patchId: `tree-chat-${randomUUID().slice(0, 8)}`,
					domainId: domain,
					baseVersion: snapshot.version,
					trigger: { kind: "request", nodeId: target.id, reason: prompt.slice(0, 180), priority: 1 },
					ops,
					itemPayloads: {},
					risk: "low",
					provenance: { model: modelTag, promptVersion: "tree-assistant-v1", samples: 1 },
					createdAt: new Date().toISOString(),
				};
				snapshot = persistCurriculumPatch(domain, snapshot, envelope);
				refreshedMap = true;
				focusNodeId = target.id;
				applied.push({ type: action.type, label: action.titlePt ?? target.title.pt, ok: true, detail: "Nó atualizado no currículo" });
			} else if (action.type === "add_skill") {
				const region = snapshot.items[action.regionId];
				if (!region || region.kind !== "unit" || region.status === "deprecated") {
					applied.push({ type: action.type, label: action.titlePt, ok: false, detail: "Região inválida para nova habilidade." });
					continue;
				}
				const baseSlug = slugifyId(action.titleEn || action.titlePt);
				let newId = `${region.id}.${baseSlug}`;
				for (let n = 2; snapshot.items[newId]; n++) newId = `${region.id}.${baseSlug}-${n}`;

				const validReqs = (action.requires ?? []).filter(reqId => Boolean(snapshot.items[reqId] && snapshot.items[reqId]!.status !== "deprecated"));
				const clauses: string[][] = validReqs.length ? [validReqs] : [];
				const hoursVal = Number(((action.minutes ?? 25) / 60).toFixed(2));

				const envelope: PatchEnvelope = {
					patchId: `tree-chat-${randomUUID().slice(0, 8)}`,
					domainId: domain,
					baseVersion: snapshot.version,
					trigger: { kind: "request", nodeId: region.id, reason: prompt.slice(0, 180), priority: 1 },
					ops: [{
						op: "addItem",
						id: newId,
						parentId: region.id,
						kind: "atom",
						title: { pt: action.titlePt, en: action.titleEn },
						hours: { lo: hoursVal, hi: hoursVal },
						clauses,
					}],
					itemPayloads: {
						[newId]: {
							summary: action.summary,
							objectives: [action.objective],
							assess: [action.assessment],
							bloom: action.bloom ?? "apply",
							level: region.level,
						},
					},
					risk: "low",
					provenance: { model: modelTag, promptVersion: "tree-assistant-v1", samples: 1 },
					createdAt: new Date().toISOString(),
				};
				snapshot = persistCurriculumPatch(domain, snapshot, envelope);
				refreshedMap = true;
				focusNodeId = newId;
				applied.push({ type: action.type, label: action.titlePt, ok: true, detail: `Adicionada em ${region.title.pt}` });
			} else if (action.type === "add_material") {
				const target = snapshot.items[action.nodeId];
				const regId = target ? regionOfNode(snapshot, target.id) : null;
				if (!target || !regId) {
					applied.push({ type: action.type, label: action.title, ok: false, detail: "Nó não encontrado para vincular material." });
					continue;
				}
				const url = action.libraryBookId && !action.url.startsWith("/ler/")
					? `/ler/${action.libraryBookId}`
					: action.url;
				addManualMaterial(domain, {
					kind: action.kind,
					title: action.title,
					part: action.part,
					url,
					lang: action.lang ?? "pt",
					nodes: [target.id],
					regionId: regId,
					libraryBookId: action.libraryBookId,
					notes: action.notes,
				});
				refreshedMaterials = true;
				focusNodeId = target.id;
				applied.push({ type: action.type, label: action.title, ok: true, detail: `Vinculado a ${target.title.pt}` });
			} else if (action.type === "link_library_pdf") {
				const region = snapshot.items[action.regionId];
				const bookMeta = libraryItems.find(b => b.sha256 === action.libraryBookId);
				if (!region || region.kind !== "unit" || !bookMeta) {
					applied.push({ type: action.type, label: action.libraryBookId.slice(0, 8), ok: false, detail: "Região ou PDF da biblioteca não encontrado." });
					continue;
				}
				linkRegionalReading(domain, region.id, bookMeta);
				refreshedMaterials = true;
				applied.push({ type: action.type, label: bookMeta.title, ok: true, detail: `PDF vinculado à região ${region.title.pt}` });
			} else if (action.type === "enrich_region") {
				const region = snapshot.items[action.regionId];
				if (!region || region.kind !== "unit") {
					applied.push({ type: action.type, label: action.regionId, ok: false, detail: "Região não encontrada." });
					continue;
				}
				const res = await enrichRegionMaterials(domain, region.id, undefined, { allowBackgroundDomain: true });
				refreshedMaterials = true;
				applied.push({
					type: action.type,
					label: region.title.pt,
					ok: true,
					detail: `+${res.addedBooks} leituras · +${res.addedVideos} vídeos${res.upgraded > 0 ? ` · ${res.upgraded} qualificados` : ""}`,
				});
			}
		} catch (err) {
			applied.push({
				type: action.type,
				label: "title" in action ? action.title : "titlePt" in action ? (action.titlePt ?? action.type) : action.type,
				ok: false,
				detail: err instanceof Error ? err.message.slice(0, 180) : "Erro ao aplicar alteração.",
			});
		}
	}

	if (refreshedMap || refreshedMaterials) {
		emit("activity-changed", {});
	}

	return {
		reply: plan.reply,
		applied,
		refreshedMap,
		refreshedMaterials,
		focusNodeId,
	};
}
