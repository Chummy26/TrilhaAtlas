/**
 * Domain study notebook aggregator: groups learner mistakes (low-grade evidence
 * and reinforcement verdicts), misconception beliefs (Beta posterior), and
 * mastered/completed concept summaries per curriculum unit/module.
 *
 * Pure and browser-safe: no Node APIs, no I/O, no wall clock.
 */

import type { CurriculumItem, CurriculumSnapshot } from "../curriculum/types.ts";
import type { LearnerGraphView } from "../learner/graph-view.ts";
import type { Grade, ItemFormat, LearnerEvent, LearnerSnapshot } from "../learner/types.ts";

export interface NotebookMistake {
	id: string;
	kind: "evidence" | "reinforce";
	nodeId: string;
	nodeTitle: string;
	at: string;
	sessionId?: string;
	grade?: Grade;
	format?: ItemFormat;
	quizContext?: { question: string; answer: string; expected?: string };
	feedback?: string;
}

export interface NotebookMisconception {
	id: string;
	nodeId: string;
	nodeTitle: string;
	text: string;
	probability: number;
	status: "active" | "resolved";
	lastSeenAt: string;
}

export interface NotebookMasteredConcept {
	nodeId: string;
	title: string;
	summary: string;
	objectives: string[];
	mastered: boolean;
	durable: boolean;
	completedAt?: string;
}

export type NotebookNoteSource = "tutor" | "pdf" | "video" | "manual";

export interface NotebookSavedNote {
	id: string;
	domainId: string;
	moduleId: string;
	nodeId?: string;
	nodeTitle?: string;
	source: NotebookNoteSource;
	excerpt: string;
	comment?: string;
	locator?: string;
	sourceUrl?: string;
	sourceTitle?: string;
	createdAt: string;
}

export interface NotebookJobAidRef {
	kind: "book" | "video";
	title: string;
	part: string;
	url: string;
}

export interface NotebookJobAid {
	moduleId: string;
	moduleTitle: string;
	keyTakeaways: string[];
	watchOutFor: string[];
	referenceLinks: NotebookJobAidRef[];
	savedNotesCount: number;
}

export interface NotebookModuleArtifact {
	id: string;
	domainId: string;
	moduleId: string;
	title: string;
	summary: string;
	content: string;
	nodeId?: string;
	createdAt: string;
	updatedAt: string;
}

export interface NotebookModuleEntry {
	moduleId: string;
	moduleTitle: string;
	areaTitle?: string;
	mistakes: NotebookMistake[];
	misconceptions: NotebookMisconception[];
	masteredConcepts: NotebookMasteredConcept[];
	savedNotes: NotebookSavedNote[];
	jobAid: NotebookJobAid | null;
	artifacts: NotebookModuleArtifact[];
}

export interface DomainNotebook {
	domainId: string;
	at: string;
	totalMistakes: number;
	activeMisconceptions: number;
	resolvedMisconceptions: number;
	totalMasteredConcepts: number;
	totalSavedNotes: number;
	totalArtifacts: number;
	modules: NotebookModuleEntry[];
}

export interface BuildDomainNotebookInput {
	domainId: string;
	snapshot: CurriculumSnapshot;
	graph: LearnerGraphView;
	learner: LearnerSnapshot;
	events: readonly LearnerEvent[];
	at: string;
	savedNotes?: readonly NotebookSavedNote[];
	artifacts?: readonly NotebookModuleArtifact[];
	materialsByUnit?: ReadonlyMap<
		string,
		{
			books: readonly { title: string; part: string; url: string }[];
			videos: readonly { title: string; part: string; url: string }[];
		}
	>;
}

const ACTIVE_MISCONCEPTION_THRESHOLD = 0.35;
const VALID_NOTE_SOURCES: ReadonlySet<string> = new Set<NotebookNoteSource>(["tutor", "pdf", "video", "manual"]);
const LOCAL_SAFE_PATH_RE = /^\/(?:ler|chat)\/[^\s<>"'`\\]+$/;

function round4(value: number): number {
	return Math.round(value * 10_000) / 10_000;
}

function parseMs(iso: string): number {
	const ms = Date.parse(iso);
	return Number.isFinite(ms) ? ms : 0;
}

function collapseWhitespace(text: string): string {
	return text.trim().replace(/\s+/g, " ");
}

function trimSentence(text: string, maxChars: number): string {
	const clean = collapseWhitespace(text);
	if (clean.length <= maxChars) return clean;
	if (maxChars <= 1) return clean.slice(0, maxChars);
	return `${clean.slice(0, maxChars - 1).trimEnd()}…`;
}

function isSafeNotebookUrl(raw: string): boolean {
	if (LOCAL_SAFE_PATH_RE.test(raw) && !raw.startsWith("//")) return true;
	try {
		const parsed = new URL(raw);
		return parsed.protocol === "https:" || parsed.protocol === "http:";
	} catch {
		return false;
	}
}

export function sanitizeSavedNoteInput(raw: unknown):
	| {
		ok: true;
		value: {
			moduleId?: string;
			nodeId?: string;
			source: NotebookNoteSource;
			excerpt: string;
			comment?: string;
			locator?: string;
			sourceUrl?: string;
			sourceTitle?: string;
		};
	}
	| { ok: false; error: string } {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return { ok: false, error: "Dados da anotação inválidos." };
	}
	const rec = raw as Record<string, unknown>;

	let source: NotebookNoteSource = "manual";
	if (rec.source !== undefined) {
		if (typeof rec.source !== "string" || !VALID_NOTE_SOURCES.has(rec.source)) {
			return { ok: false, error: "Fonte da anotação inválida." };
		}
		source = rec.source as NotebookNoteSource;
	}

	if (typeof rec.excerpt !== "string") {
		return { ok: false, error: "O trecho da anotação é obrigatório." };
	}
	const excerpt = rec.excerpt.trim();
	if (excerpt.length === 0) {
		return { ok: false, error: "O trecho da anotação não pode ficar vazio." };
	}
	if (excerpt.length > 2000) {
		return { ok: false, error: "O trecho da anotação excede o limite de 2000 caracteres." };
	}

	let comment: string | undefined;
	if (rec.comment !== undefined && rec.comment !== null) {
		if (typeof rec.comment !== "string") {
			return { ok: false, error: "Comentário inválido." };
		}
		const trimmed = rec.comment.trim();
		if (trimmed.length > 1000) {
			return { ok: false, error: "O comentário excede o limite de 1000 caracteres." };
		}
		if (trimmed.length > 0) comment = trimmed;
	}

	let moduleId: string | undefined;
	if (rec.moduleId !== undefined && rec.moduleId !== null) {
		if (typeof rec.moduleId !== "string") {
			return { ok: false, error: "Identificador do módulo inválido." };
		}
		const trimmed = rec.moduleId.trim();
		if (trimmed.length > 200) {
			return { ok: false, error: "Identificador do módulo excede o limite permitido." };
		}
		if (trimmed.length > 0) moduleId = trimmed;
	}

	let nodeId: string | undefined;
	if (rec.nodeId !== undefined && rec.nodeId !== null) {
		if (typeof rec.nodeId !== "string") {
			return { ok: false, error: "Identificador da habilidade inválido." };
		}
		const trimmed = rec.nodeId.trim();
		if (trimmed.length > 200) {
			return { ok: false, error: "Identificador da habilidade excede o limite permitido." };
		}
		if (trimmed.length > 0) nodeId = trimmed;
	}

	let locator: string | undefined;
	if (rec.locator !== undefined && rec.locator !== null) {
		if (typeof rec.locator !== "string") {
			return { ok: false, error: "Localizador inválido." };
		}
		const trimmed = collapseWhitespace(rec.locator);
		if (trimmed.length > 0) locator = trimmed.slice(0, 200);
	}

	let sourceTitle: string | undefined;
	if (rec.sourceTitle !== undefined && rec.sourceTitle !== null) {
		if (typeof rec.sourceTitle !== "string") {
			return { ok: false, error: "Título da fonte inválido." };
		}
		const trimmed = collapseWhitespace(rec.sourceTitle);
		if (trimmed.length > 0) sourceTitle = trimmed.slice(0, 240);
	}

	let sourceUrl: string | undefined;
	if (rec.sourceUrl !== undefined && rec.sourceUrl !== null) {
		if (typeof rec.sourceUrl !== "string") {
			return { ok: false, error: "URL da fonte inválida." };
		}
		const trimmed = rec.sourceUrl.trim();
		if (trimmed.length > 0) {
			if (trimmed.length > 2000 || !isSafeNotebookUrl(trimmed)) {
				return { ok: false, error: "URL da fonte inválida ou não permitida." };
			}
			sourceUrl = trimmed;
		}
	}

	return {
		ok: true,
		value: {
			...(moduleId ? { moduleId } : {}),
			...(nodeId ? { nodeId } : {}),
			source,
			excerpt,
			...(comment ? { comment } : {}),
			...(locator ? { locator } : {}),
			...(sourceUrl ? { sourceUrl } : {}),
			...(sourceTitle ? { sourceTitle } : {}),
		},
	};
}

export function sanitizeModuleArtifactInput(raw: unknown):
	| {
		ok: true;
		value: {
			moduleId: string;
			nodeId?: string;
			title: string;
			summary: string;
			content: string;
		};
	}
	| { ok: false; error: string } {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return { ok: false, error: "Dados do artefato inválidos." };
	}
	const rec = raw as Record<string, unknown>;

	if (typeof rec.moduleId !== "string") {
		return { ok: false, error: "O módulo do artefato é obrigatório." };
	}
	const moduleId = rec.moduleId.trim();
	if (moduleId.length === 0 || moduleId.length > 200) {
		return { ok: false, error: "Identificador do módulo inválido." };
	}

	let nodeId: string | undefined;
	if (rec.nodeId !== undefined && rec.nodeId !== null) {
		if (typeof rec.nodeId !== "string") {
			return { ok: false, error: "Identificador da habilidade inválido." };
		}
		const trimmed = rec.nodeId.trim();
		if (trimmed.length > 200) {
			return { ok: false, error: "Identificador da habilidade excede o limite permitido." };
		}
		if (trimmed.length > 0) nodeId = trimmed;
	}

	if (typeof rec.title !== "string") {
		return { ok: false, error: "O título do artefato é obrigatório." };
	}
	const title = collapseWhitespace(rec.title);
	if (title.length === 0) {
		return { ok: false, error: "O título do artefato não pode ficar vazio." };
	}
	if (title.length > 160) {
		return { ok: false, error: "O título do artefato excede o limite de 160 caracteres." };
	}

	let summary = "";
	if (rec.summary !== undefined && rec.summary !== null) {
		if (typeof rec.summary !== "string") {
			return { ok: false, error: "Resumo do artefato inválido." };
		}
		summary = collapseWhitespace(rec.summary);
		if (summary.length > 300) {
			return { ok: false, error: "O resumo do artefato excede o limite de 300 caracteres." };
		}
	}

	if (typeof rec.content !== "string") {
		return { ok: false, error: "O conteúdo do artefato é obrigatório." };
	}
	const content = rec.content.trim();
	if (content.length === 0) {
		return { ok: false, error: "O conteúdo do artefato não pode ficar vazio." };
	}
	if (content.length > 8000) {
		return { ok: false, error: "O conteúdo do artefato excede o limite de 8000 caracteres." };
	}

	return {
		ok: true,
		value: {
			moduleId,
			...(nodeId ? { nodeId } : {}),
			title,
			summary,
			content,
		},
	};
}

/** Render a module's quick reference sheet (Job Aid) as clean Markdown. */
export function formatJobAidMarkdown(aid: NotebookJobAid): string {
	const lines: string[] = [`# ${aid.moduleTitle}`];
	if (aid.keyTakeaways.length > 0) {
		lines.push("", "## Pontos-chave");
		for (const item of aid.keyTakeaways) {
			lines.push(`- ${item}`);
		}
	}
	if (aid.watchOutFor.length > 0) {
		lines.push("", "## Pontos de atenção");
		for (const item of aid.watchOutFor) {
			lines.push(`- ${item}`);
		}
	}
	if (aid.referenceLinks.length > 0) {
		lines.push("", "## Referências");
		for (const ref of aid.referenceLinks) {
			const kindLabel = ref.kind === "video" ? "Vídeo" : "Livro";
			const label = ref.part ? `${ref.title} — ${ref.part}` : ref.title;
			lines.push(`- [${kindLabel}: ${label}](${ref.url})`);
		}
	}
	return lines.join("\n");
}

function inheritedGroup(snapshot: CurriculumSnapshot, item: CurriculumItem, kind: "area" | "unit"): CurriculumItem {
	let parent = item;
	let area: CurriculumItem | undefined;
	const visited = new Set<string>([item.id]);
	while (parent.parentId && parent.kind !== kind && !visited.has(parent.parentId)) {
		if (parent.kind === "area") area = parent;
		const next = snapshot.items[parent.parentId];
		if (!next) break;
		visited.add(next.id);
		parent = next;
	}
	return parent.kind === kind ? parent : area ?? parent;
}

function moduleOfNode(snapshot: CurriculumSnapshot, nodeId: string): { id: string; title: string; areaTitle?: string } | null {
	const raw = snapshot.items[nodeId];
	if (!raw) return null;
	const target = raw.reinforcementFor ? (snapshot.items[raw.reinforcementFor] ?? raw) : raw;
	const unit = inheritedGroup(snapshot, target, "unit");
	const area = inheritedGroup(snapshot, target, "area");
	return {
		id: unit.id,
		title: unit.title.pt,
		...(area.id !== unit.id ? { areaTitle: area.title.pt } : {}),
	};
}

function normalizeKey(text: string): string {
	return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function buildModuleJobAid(params: {
	moduleId: string;
	moduleTitle: string;
	masteredConcepts: readonly NotebookMasteredConcept[];
	savedNotes: readonly NotebookSavedNote[];
	misconceptions: readonly NotebookMisconception[];
	mistakes: readonly NotebookMistake[];
	materials?: {
		books: readonly { title: string; part: string; url: string }[];
		videos: readonly { title: string; part: string; url: string }[];
	};
}): NotebookJobAid | null {
	const { moduleId, moduleTitle, masteredConcepts, savedNotes, misconceptions, mistakes, materials } = params;

	const keyTakeaways: string[] = [];
	const seenTakeaways = new Set<string>();
	const pushTakeaway = (text: string): void => {
		if (keyTakeaways.length >= 6) return;
		const trimmed = trimSentence(text, 180);
		if (!trimmed) return;
		const key = normalizeKey(trimmed);
		if (seenTakeaways.has(key)) return;
		seenTakeaways.add(key);
		keyTakeaways.push(trimmed);
	};

	for (const concept of masteredConcepts) {
		const detail = concept.objectives[0] || concept.summary;
		pushTakeaway(detail ? `${concept.title}: ${detail}` : concept.title);
		if (keyTakeaways.length >= 6) break;
	}
	for (const note of savedNotes) {
		pushTakeaway(note.excerpt);
		if (keyTakeaways.length >= 6) break;
	}

	const watchOutFor: string[] = [];
	const seenWatch = new Set<string>();
	const pushWatch = (text: string): void => {
		if (watchOutFor.length >= 5) return;
		const trimmed = trimSentence(text, 180);
		if (!trimmed) return;
		const key = normalizeKey(trimmed);
		if (seenWatch.has(key)) return;
		seenWatch.add(key);
		watchOutFor.push(trimmed);
	};

	for (const m of misconceptions) {
		if (m.status !== "active") continue;
		pushWatch(`${m.nodeTitle}: ${m.text}`);
		if (watchOutFor.length >= 5) break;
	}
	for (const mistake of mistakes) {
		if (mistake.feedback) {
			pushWatch(`${mistake.nodeTitle}: ${mistake.feedback}`);
		} else if (mistake.quizContext?.expected) {
			pushWatch(`${mistake.nodeTitle}: ${mistake.quizContext.expected}`);
		} else if (mistake.quizContext?.question) {
			pushWatch(`${mistake.nodeTitle}: ${mistake.quizContext.question}`);
		}
		if (watchOutFor.length >= 5) break;
	}

	const referenceLinks: NotebookJobAidRef[] = [];
	if (materials) {
		const seenUrls = new Set<string>();
		let bookCount = 0;
		for (const book of materials.books) {
			if (bookCount >= 4) break;
			const key = `book:${book.url}`;
			if (seenUrls.has(key)) continue;
			seenUrls.add(key);
			referenceLinks.push({ kind: "book", title: book.title, part: book.part, url: book.url });
			bookCount++;
		}
		let videoCount = 0;
		for (const video of materials.videos) {
			if (videoCount >= 3) break;
			const key = `video:${video.url}`;
			if (seenUrls.has(key)) continue;
			seenUrls.add(key);
			referenceLinks.push({ kind: "video", title: video.title, part: video.part, url: video.url });
			videoCount++;
		}
	}

	if (
		keyTakeaways.length === 0
		&& watchOutFor.length === 0
		&& referenceLinks.length === 0
		&& savedNotes.length === 0
	) {
		return null;
	}

	return {
		moduleId,
		moduleTitle,
		keyTakeaways,
		watchOutFor,
		referenceLinks,
		savedNotesCount: savedNotes.length,
	};
}

/** Build the per-module study notebook (mistakes, misconceptions, mastered notes, saved notes, job aids, and artifacts). */
export function buildDomainNotebook(input: BuildDomainNotebookInput): DomainNotebook {
	const { domainId, snapshot, graph, learner, events, at, savedNotes: rawSavedNotes, artifacts: rawArtifacts, materialsByUnit } = input;

	// Establish didactic module ordering from the projected graph.
	const moduleOrder = new Map<string, number>();
	const moduleMeta = new Map<string, { id: string; title: string; areaTitle?: string }>();
	const ensureModule = (nodeId: string): string | null => {
		const mod = moduleOfNode(snapshot, nodeId);
		if (!mod) return null;
		if (!moduleMeta.has(mod.id)) {
			moduleOrder.set(mod.id, moduleOrder.size);
			moduleMeta.set(mod.id, mod);
		}
		return mod.id;
	};
	const ensureModuleById = (moduleId: string, nodeId?: string): string => {
		if (moduleMeta.has(moduleId)) return moduleId;
		if (snapshot.items[moduleId]) {
			const resolved = ensureModule(moduleId);
			if (resolved) return resolved;
		}
		if (nodeId) {
			const resolved = ensureModule(nodeId);
			if (resolved) return resolved;
		}
		const fallbackTitle = moduleId === "general" ? "Geral" : moduleId;
		moduleOrder.set(moduleId, moduleOrder.size);
		moduleMeta.set(moduleId, { id: moduleId, title: fallbackTitle });
		return moduleId;
	};

	for (const id of graph.ids) {
		if (!graph.nodes.get(id)?.isLeaf) continue;
		ensureModule(id);
	}

	const mistakesByModule = new Map<string, { entry: NotebookMistake; seq: number }[]>();
	const pushMistake = (moduleId: string, entry: NotebookMistake, seq: number): void => {
		const list = mistakesByModule.get(moduleId) ?? [];
		list.push({ entry, seq });
		mistakesByModule.set(moduleId, list);
	};

	for (const event of events) {
		if (event.kind === "evidence") {
			const ev = event.evidence;
			if (ev.domainId !== domainId || ev.grade >= 2) continue;
			const nodeId = ev.nodes.find((n) => n.primary)?.nodeId ?? ev.nodes[0]?.nodeId;
			if (!nodeId) continue;
			const moduleId = ensureModule(nodeId);
			if (!moduleId) continue;
			const nodeTitle = graph.nodes.get(nodeId)?.title ?? snapshot.items[nodeId]?.title.pt ?? nodeId;
			const entry: NotebookMistake = {
				id: ev.id,
				kind: "evidence",
				nodeId,
				nodeTitle,
				at: ev.at,
				sessionId: ev.sessionId,
				grade: ev.grade,
				format: ev.format,
				...(ev.quizContext ? { quizContext: { ...ev.quizContext } } : {}),
			};
			pushMistake(moduleId, entry, ev.seq);
		} else if (event.kind === "lesson-finished") {
			if (event.domainId !== domainId || event.outcome !== "reinforce") continue;
			const moduleId = ensureModule(event.nodeId);
			if (!moduleId) continue;
			const nodeTitle = graph.nodes.get(event.nodeId)?.title ?? snapshot.items[event.nodeId]?.title.pt ?? event.nodeId;
			const entry: NotebookMistake = {
				id: event.id,
				kind: "reinforce",
				nodeId: event.nodeId,
				nodeTitle,
				at: event.at,
				feedback: event.feedback ?? "Retome este tópico para consolidar os objetivos pendentes.",
			};
			pushMistake(moduleId, entry, event.seq);
		}
	}

	const misconceptionsByModule = new Map<string, NotebookMisconception[]>();
	for (const [nodeId, st] of Object.entries(learner.nodes)) {
		const entries = Object.entries(st.misconceptions ?? {});
		if (entries.length === 0) continue;
		const moduleId = ensureModule(nodeId);
		if (!moduleId) continue;
		const nodeTitle = graph.nodes.get(nodeId)?.title ?? snapshot.items[nodeId]?.title.pt ?? nodeId;
		const list = misconceptionsByModule.get(moduleId) ?? [];
		for (const [misconceptionId, belief] of entries) {
			const denom = belief.a + belief.b;
			const probability = denom > 0 ? round4(belief.a / denom) : 0;
			list.push({
				id: misconceptionId,
				nodeId,
				nodeTitle,
				text: belief.text,
				probability,
				status: probability >= ACTIVE_MISCONCEPTION_THRESHOLD ? "active" : "resolved",
				lastSeenAt: belief.lastSeenAt,
			});
		}
		misconceptionsByModule.set(moduleId, list);
	}

	const masteredByModule = new Map<string, NotebookMasteredConcept[]>();
	const seenConceptNodes = new Set<string>();
	const recordConcept = (nodeId: string): void => {
		if (seenConceptNodes.has(nodeId)) return;
		const item = snapshot.items[nodeId];
		if (!item || item.reinforcementFor) return;
		const st = learner.nodes[nodeId];
		if (!st || !(st.masteredAt || st.lessonCompletedAt || st.attainedAt || st.placedAt)) return;
		const moduleId = ensureModule(nodeId);
		if (!moduleId) return;
		seenConceptNodes.add(nodeId);
		const completedAt = st.masteredAt ?? st.lessonCompletedAt ?? st.attainedAt ?? st.placedAt;
		const list = masteredByModule.get(moduleId) ?? [];
		list.push({
			nodeId,
			title: graph.nodes.get(nodeId)?.title ?? item.title.pt,
			summary: item.summary,
			objectives: [...item.objectives],
			mastered: Boolean(st.masteredAt),
			durable: Boolean(st.independentRecallAt || (st.delayedSuccesses ?? 0) >= 1),
			...(completedAt ? { completedAt } : {}),
		});
		masteredByModule.set(moduleId, list);
	};

	for (const id of graph.ids) {
		if (!graph.nodes.get(id)?.isLeaf) continue;
		recordConcept(id);
	}
	for (const nodeId of Object.keys(learner.nodes)) {
		if (graph.nodes.get(nodeId)?.isLeaf) recordConcept(nodeId);
	}

	// Group saved notes by module (deduplicated by id, newest-first).
	const savedNotesByModule = new Map<string, Map<string, NotebookSavedNote>>();
	if (rawSavedNotes) {
		for (const note of rawSavedNotes) {
			if (note.domainId !== domainId) continue;
			const targetModuleId = ensureModuleById(note.moduleId, note.nodeId);
			let byId = savedNotesByModule.get(targetModuleId);
			if (!byId) {
				byId = new Map();
				savedNotesByModule.set(targetModuleId, byId);
			}
			byId.set(note.id, { ...note, moduleId: targetModuleId });
		}
	}

	// Group module deliverables/artifacts by module (deduplicated by id, newest-first).
	const artifactsByModule = new Map<string, Map<string, NotebookModuleArtifact>>();
	if (rawArtifacts) {
		for (const artifact of rawArtifacts) {
			if (artifact.domainId !== domainId) continue;
			const targetModuleId = ensureModuleById(artifact.moduleId, artifact.nodeId);
			let byId = artifactsByModule.get(targetModuleId);
			if (!byId) {
				byId = new Map();
				artifactsByModule.set(targetModuleId, byId);
			}
			byId.set(artifact.id, { ...artifact, moduleId: targetModuleId });
		}
	}

	let totalMistakes = 0;
	let activeMisconceptions = 0;
	let resolvedMisconceptions = 0;
	let totalMasteredConcepts = 0;
	let totalSavedNotes = 0;
	let totalArtifacts = 0;

	const modules: NotebookModuleEntry[] = [];
	const orderedIds = [...moduleMeta.keys()].sort((a, b) => (moduleOrder.get(a) ?? 0) - (moduleOrder.get(b) ?? 0));

	for (const moduleId of orderedIds) {
		const meta = moduleMeta.get(moduleId)!;
		const rawMistakes = mistakesByModule.get(moduleId) ?? [];
		rawMistakes.sort((a, b) => parseMs(b.entry.at) - parseMs(a.entry.at) || b.seq - a.seq);

		const seenIds = new Set<string>();
		const seenFingerprints = new Set<string>();
		const mistakes: NotebookMistake[] = [];
		for (const { entry } of rawMistakes) {
			if (seenIds.has(entry.id)) continue;
			const fingerprint = entry.kind === "reinforce" && entry.feedback
				? `reinforce:${entry.nodeId}:${normalizeKey(entry.feedback)}`
				: entry.quizContext
					? `quiz:${entry.nodeId}:${normalizeKey(entry.quizContext.question)}|${normalizeKey(entry.quizContext.answer)}`
					: null;
			if (fingerprint && seenFingerprints.has(fingerprint)) continue;
			seenIds.add(entry.id);
			if (fingerprint) seenFingerprints.add(fingerprint);
			mistakes.push(entry);
		}

		const misconceptions = (misconceptionsByModule.get(moduleId) ?? []).slice().sort((a, b) => {
			if (a.status !== b.status) return a.status === "active" ? -1 : 1;
			if (b.probability !== a.probability) return b.probability - a.probability;
			return parseMs(b.lastSeenAt) - parseMs(a.lastSeenAt);
		});

		const masteredConcepts = masteredByModule.get(moduleId) ?? [];

		const savedNotes = [...(savedNotesByModule.get(moduleId)?.values() ?? [])].sort(
			(a, b) => parseMs(b.createdAt) - parseMs(a.createdAt),
		);

		const artifacts = [...(artifactsByModule.get(moduleId)?.values() ?? [])].sort(
			(a, b) => parseMs(b.createdAt) - parseMs(a.createdAt),
		);

		if (
			mistakes.length === 0
			&& misconceptions.length === 0
			&& masteredConcepts.length === 0
			&& savedNotes.length === 0
			&& artifacts.length === 0
		) {
			continue;
		}

		const jobAid = buildModuleJobAid({
			moduleId: meta.id,
			moduleTitle: meta.title,
			masteredConcepts,
			savedNotes,
			misconceptions,
			mistakes,
			materials: materialsByUnit?.get(meta.id),
		});

		totalMistakes += mistakes.length;
		for (const m of misconceptions) {
			if (m.status === "active") activeMisconceptions++;
			else resolvedMisconceptions++;
		}
		totalMasteredConcepts += masteredConcepts.length;
		totalSavedNotes += savedNotes.length;
		totalArtifacts += artifacts.length;

		modules.push({
			moduleId: meta.id,
			moduleTitle: meta.title,
			...(meta.areaTitle ? { areaTitle: meta.areaTitle } : {}),
			mistakes,
			misconceptions,
			masteredConcepts,
			savedNotes,
			jobAid,
			artifacts,
		});
	}

	return {
		domainId,
		at,
		totalMistakes,
		activeMisconceptions,
		resolvedMisconceptions,
		totalMasteredConcepts,
		totalSavedNotes,
		totalArtifacts,
		modules,
	};
}
