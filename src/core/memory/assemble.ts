/**
 * Per-turn context assembly (r4 §7.7; SÍNTESE §2.4(b) "Contexto do turno, na
 * ordem estável → dinâmico, para prompt caching") and chronological recall
 * rendering (r4 §7.6.4 steps 8–9).
 *
 *   [perfil global ≤ 300]                       ┐
 *   [mental models + retomada do diário ≤ 1000] │ stable prefix (cacheable)
 *   [snapshot do learner, nós em foco ≤ 300]    │
 *   [observation log da sessão ≤ 8000]          ┘
 *   <!-- lh:cache-boundary -->
 *   [memória recuperada ≤ 2000]                   dynamic
 *   (the tutor system prompt goes before, the raw tail + current utterance after)
 *
 * Total ≤ 12 000 tokens. When custom budgets overflow the total, the
 * observation log is shrunk first (oldest lines dropped), then recall, then
 * the remaining sections, so the stable head stays as stable as possible.
 *
 * Budget accounting is exact w.r.t. `estimateTokens`: sections are joined by
 * whitespace and the estimator is additive over whitespace joins (tokens.ts).
 *
 * Recall rendering is CHRONOLOGICAL (oldest → newest; a later statement may
 * revise an earlier one), grouped by day with absolute + relative date, and
 * superseded facts are labelled with the date they were superseded.
 */

import { renderMentalModelsForPrompt } from "./ops.ts";
import { formatDay, relativeDayPt } from "./temporal.ts";
import { estimateTokens, fitLines, truncateToTokens } from "./tokens.ts";
import { MemoryError, type DiaryEntry, type FactKind, type MemoryItemKind, type MentalModelEntry, type MessageRole } from "./types.ts";
import type { LearnerPromptSnapshot } from "../learner/types.ts";

export interface ContextBudgets {
	profile: number;
	mentalModels: number;
	learner: number;
	observationLog: number;
	recall: number;
	total: number;
}

export const CONTEXT_BUDGETS: Readonly<ContextBudgets> = Object.freeze({
	profile: 300,
	mentalModels: 1000,
	learner: 300,
	observationLog: 8000,
	recall: 2000,
	total: 12_000,
});

export const CACHE_BOUNDARY = "<!-- lh:cache-boundary -->";

export type ContextSectionId = "profile" | "mentalModels" | "learner" | "observationLog" | "recall";

const SECTION_TITLES: Readonly<Record<Exclude<ContextSectionId, "recall">, string>> = {
	profile: "## Perfil do aluno",
	mentalModels: "## Modelo do aluno neste domínio",
	learner: "## Estado do aprendizado (nós em foco)",
	observationLog: "## Registro desta sessão",
};

const STABLE_ORDER: readonly Exclude<ContextSectionId, "recall">[] = ["profile", "mentalModels", "learner", "observationLog"];

export interface ContextParts {
	profile?: string | null;
	mentalModels?: string | null;
	learner?: string | null;
	observationLog?: string | null;
	/** Already rendered by `packRecall` (carries its own heading). */
	recall?: string | null;
}

export interface AssembledSection {
	id: ContextSectionId;
	text: string;
	tokens: number;
	budget: number;
	truncated: boolean;
}

export interface AssembledContext {
	/** Cacheable prefix (no boundary marker). */
	stable: string;
	stableTokens: number;
	/** Recalled memory (after the boundary). */
	dynamic: string;
	dynamicTokens: number;
	/** stable + CACHE_BOUNDARY + dynamic. */
	text: string;
	tokens: number;
	sections: AssembledSection[];
}

function fitSection(id: ContextSectionId, body: string | null | undefined, budget: number): AssembledSection {
	const content = (body ?? "").trim();
	if (!content || budget <= 0) return { id, text: "", tokens: 0, budget, truncated: content.length > 0 };
	if (id === "recall") {
		const fitted = fitLines(content, budget, "head");
		return { id, text: fitted.text, tokens: fitted.tokens, budget, truncated: fitted.truncated };
	}
	const title = SECTION_TITLES[id];
	const titleTokens = estimateTokens(title);
	if (budget <= titleTokens) return { id, text: "", tokens: 0, budget, truncated: true };
	const fitted = fitLines(content, budget - titleTokens, id === "observationLog" ? "tail" : "head");
	if (!fitted.text) return { id, text: "", tokens: 0, budget, truncated: true };
	return { id, text: `${title}\n${fitted.text}`, tokens: titleTokens + fitted.tokens, budget, truncated: fitted.truncated };
}

function validateBudgets(b: ContextBudgets): void {
	for (const [k, v] of Object.entries(b)) {
		if (!(typeof v === "number" && Number.isFinite(v) && v >= 0)) throw new MemoryError("invalid-input", `orçamento de contexto inválido: ${k} = ${v}`);
	}
}

const SHRINK_ORDER: readonly ContextSectionId[] = ["observationLog", "recall", "learner", "mentalModels", "profile"];

export function assembleContext(parts: ContextParts, budgets: ContextBudgets = CONTEXT_BUDGETS): AssembledContext {
	validateBudgets(budgets);
	const bodies: Record<ContextSectionId, string | null | undefined> = {
		profile: parts.profile,
		mentalModels: parts.mentalModels,
		learner: parts.learner,
		observationLog: parts.observationLog,
		recall: parts.recall,
	};
	const sections = new Map<ContextSectionId, AssembledSection>();
	for (const id of [...STABLE_ORDER, "recall"] as const) sections.set(id, fitSection(id, bodies[id], budgets[id]));

	const boundaryTokens = estimateTokens(CACHE_BOUNDARY);
	const sum = () => [...sections.values()].reduce((n, s) => n + s.tokens, 0) + boundaryTokens;
	for (const id of SHRINK_ORDER) {
		const overflow = sum() - budgets.total;
		if (overflow <= 0) break;
		const cur = sections.get(id) as AssembledSection;
		if (cur.tokens === 0) continue;
		sections.set(id, { ...fitSection(id, bodies[id], Math.max(0, cur.tokens - overflow)), budget: cur.budget, truncated: true });
	}

	const ordered = [...STABLE_ORDER, "recall" as const].map((id) => sections.get(id) as AssembledSection);
	const stableParts = ordered.filter((s) => s.id !== "recall" && s.text);
	const stable = stableParts.map((s) => s.text).join("\n\n");
	const dynamicSection = sections.get("recall") as AssembledSection;
	const dynamic = dynamicSection.text;
	const text = [stable, CACHE_BOUNDARY, dynamic].filter((s) => s.length > 0).join("\n\n");
	return {
		stable,
		stableTokens: stableParts.reduce((n, s) => n + s.tokens, 0),
		dynamic,
		dynamicTokens: dynamicSection.tokens,
		text,
		tokens: estimateTokens(text),
		sections: ordered,
	};
}

// ─── recall rendering ───────────────────────────────────────────────────────

export const RECALL_HEADER = "## Memória relevante (mais antiga → mais recente; uma afirmação posterior pode revisar uma anterior)";
export const MAX_RECALL_LINE_TOKENS = 200;
export const LOW_CONFIDENCE = 0.6;

export const FACT_KIND_LABELS_PT: Readonly<Record<FactKind, string>> = {
	world: "fato",
	experience: "experiência",
	learner: "sobre o aluno",
	preference: "preferência",
	misconception: "equívoco",
	goal: "meta",
	affect: "estado afetivo",
	plan: "plano",
};

const ROLE_LABELS_PT: Readonly<Record<MessageRole, string>> = { user: "aluno disse", assistant: "tutor disse", tool: "ferramenta" };

export interface RenderableItem {
	kind: MemoryItemKind;
	id: string;
	text: string;
	at: number;
	factKind?: FactKind;
	role?: MessageRole;
	superseded?: boolean;
	supersededAt?: number;
	validTo?: number;
	confidence?: number;
	quote?: string;
}

function itemLabel(item: RenderableItem): string {
	if (item.kind === "message") return ROLE_LABELS_PT[item.role ?? "user"];
	if (item.kind === "episode") return "episódio";
	if (item.kind === "observation") return "observação";
	const parts = [FACT_KIND_LABELS_PT[item.factKind ?? "world"]];
	if (item.superseded) {
		const when = item.supersededAt ?? item.validTo;
		parts.push(when === undefined ? "superado" : `superado em ${formatDay(when)}`);
	}
	if (item.confidence !== undefined && item.confidence < LOW_CONFIDENCE) parts.push("incerto");
	return parts.join(", ");
}

function oneLine(s: string): string {
	return s.replace(/\s+/g, " ").trim();
}

/** One bullet: `- [label] text` (+ ` — fonte: “quote”` for low-confidence facts). */
export function recallLine(item: RenderableItem, maxTokens = MAX_RECALL_LINE_TOKENS): string {
	let body = oneLine(item.text);
	if (item.kind === "fact" && item.quote && item.confidence !== undefined && item.confidence < LOW_CONFIDENCE) {
		body += ` — fonte: “${oneLine(item.quote)}”`;
	}
	const prefix = `- [${itemLabel(item)}] `;
	return prefix + truncateToTokens(body, Math.max(1, maxTokens - estimateTokens(prefix)));
}

export function dayHeader(at: number, now: number): string {
	return `### ${formatDay(at)} · ${relativeDayPt(at, now)}`;
}

export interface PackedRecall<T> {
	items: T[];
	rendered: string;
	tokens: number;
}

/**
 * Greedy budget packing in RANK order (best first), then chronological
 * rendering. Items that do not fit are skipped (a smaller one may still fit);
 * the best item is always kept, cut to the budget if needed.
 */
export function packRecall<T extends RenderableItem>(ranked: readonly T[], budget: number, now: number): PackedRecall<T> {
	const headerTokens = estimateTokens(RECALL_HEADER);
	if (ranked.length === 0 || budget <= headerTokens) return { items: [], rendered: "", tokens: 0 };
	let used = headerTokens;
	const days = new Set<string>();
	const kept: { item: T; line: string }[] = [];
	for (const item of ranked) {
		const day = formatDay(item.at);
		const dayTokens = days.has(day) ? 0 : estimateTokens(dayHeader(item.at, now));
		let line = recallLine(item);
		let cost = estimateTokens(line);
		if (used + dayTokens + cost > budget) {
			if (kept.length > 0) continue;
			const room = budget - used - dayTokens;
			if (room < 4) break;
			line = recallLine(item, room);
			cost = estimateTokens(line);
			if (used + dayTokens + cost > budget) break;
		}
		kept.push({ item, line });
		days.add(day);
		used += dayTokens + cost;
	}
	if (kept.length === 0) return { items: [], rendered: "", tokens: 0 };
	const chronological = [...kept].sort((a, b) => a.item.at - b.item.at || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0));
	const lines: string[] = [RECALL_HEADER];
	let currentDay: string | null = null;
	for (const { item, line } of chronological) {
		const day = formatDay(item.at);
		if (day !== currentDay) {
			currentDay = day;
			lines.push(dayHeader(item.at, now));
		}
		lines.push(line);
	}
	const rendered = lines.join("\n");
	return { items: chronological.map((k) => k.item), rendered, tokens: estimateTokens(rendered) };
}

// ─── stable-prefix renderers ────────────────────────────────────────────────

/** ~300-token learner snapshot (r2 §9.14) as pt-BR lines. */
export function renderLearnerSnapshot(s: LearnerPromptSnapshot | null | undefined): string {
	if (!s) return "";
	const lines: string[] = [];
	if (s.frontier.length > 0) lines.push(`Fronteira: ${s.frontier.map((f) => `${f.title} (prontidão ${Math.round(f.readiness * 100)}%)`).join("; ")}`);
	if (s.topMastered.length > 0) lines.push(`Dominados: ${s.topMastered.map((m) => m.title).join("; ")}`);
	if (s.weak.length > 0) lines.push(`Pontos fracos: ${s.weak.map((w) => (w.misconception ? `${w.title} (equívoco: ${w.misconception})` : w.title)).join("; ")}`);
	lines.push(`Revisões pendentes: ${s.dueReviews}`);
	if (s.todayPlan.length > 0) lines.push(`Plano de hoje: ${s.todayPlan.join("; ")}`);
	return lines.join("\n");
}

/** DeepTutor learning_journal hand-off: Mission / Last session / next_focus (pt-BR). */
export function renderDiary(entry: DiaryEntry | null | undefined, now: number): string {
	if (!entry) return "";
	const lines: string[] = [];
	if (entry.mission) lines.push(`Missão: ${oneLine(entry.mission)}`);
	lines.push(`Última sessão (${formatDay(entry.createdAt)} · ${relativeDayPt(entry.createdAt, now)}): ${oneLine(entry.summary)}`);
	lines.push(`Próximo foco: ${oneLine(entry.nextFocus)}`);
	return lines.join("\n");
}

/** Body of the mental-model section: diary hand-off first, then the 4 sections. */
export function composeMentalModelSection(diary: DiaryEntry | null | undefined, entries: readonly MentalModelEntry[], now: number, maxTokens: number): string {
	const parts: string[] = [];
	const diaryText = renderDiary(diary, now);
	if (diaryText) parts.push(`### Retomada\n${diaryText}`);
	const used = estimateTokens(parts.join("\n"));
	const models = renderMentalModelsForPrompt(entries, Math.max(0, maxTokens - used));
	if (models) parts.push(models);
	return fitLines(parts.join("\n"), maxTokens, "head").text;
}
