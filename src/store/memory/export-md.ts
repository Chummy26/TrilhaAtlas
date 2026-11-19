/**
 * Markdown renderers for the Obsidian mirror of a domain's memory (r4
 * §7.6.5-8 "mental models e observations → <vault>/learnharness/<domínio>/*.md
 * no formato do DeepTutor"; SÍNTESE §2.3 exportMarkdown).
 *
 * One-way mirror: files carry an html comment saying edits are overwritten.
 * Entries keep their ids in `<!--id-->` anchors so a later import/diff can
 * match blocks.
 */

import { renderMentalModelsMarkdown } from "../../core/memory/ops.ts";
import { formatDay } from "../../core/memory/temporal.ts";
import type { DiaryEntry, MentalModelEntry } from "../../core/memory/types.ts";
import type { ObservationRecord } from "./rows.ts";

export const GENERATED_NOTICE = "<!-- gerado pelo learnharness: espelho somente leitura; edições aqui serão sobrescritas -->";

export const EXPORT_FILES = {
	mentalModel: "Modelo do aluno.md",
	observations: "Observações.md",
	diary: "Diário.md",
} as const;

function withNotice(body: string): string {
	return `${GENERATED_NOTICE}\n\n${body.trimEnd()}\n`;
}

export function mentalModelMarkdown(entries: readonly MentalModelEntry[], domainTitle: string): string {
	return withNotice(renderMentalModelsMarkdown(entries, `Modelo do aluno — ${domainTitle}`));
}

function subjectLabel(o: ObservationRecord): string {
	if (o.subjectType === "learner") return "Aluno";
	if (o.subjectType === "node") return `Nó ${o.subjectId}`;
	return `Entidade ${o.subjectId}`;
}

export function observationsMarkdown(observations: readonly ObservationRecord[], domainTitle: string): string {
	const out: string[] = [`# Observações — ${domainTitle}`, ""];
	const active = observations.filter((o) => o.endedAt === null);
	const ended = observations.filter((o) => o.endedAt !== null);
	const groups = new Map<string, ObservationRecord[]>();
	for (const o of active) {
		const label = subjectLabel(o);
		groups.set(label, [...(groups.get(label) ?? []), o]);
	}
	if (groups.size === 0) out.push("_(nenhuma observação ativa)_", "");
	for (const [label, items] of [...groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
		out.push(`## ${label}`);
		for (const o of items) out.push(`- ${o.text} (provas: ${o.proofCount}; atualizada em ${formatDay(o.updatedAt)}) <!--${o.id}-->`);
		out.push("");
	}
	if (ended.length > 0) {
		out.push("## Encerradas");
		for (const o of ended) out.push(`- ~~${o.text}~~ (encerrada em ${formatDay(o.endedAt as number)}) <!--${o.id}-->`);
		out.push("");
	}
	return withNotice(out.join("\n"));
}

export function diaryMarkdown(entries: readonly DiaryEntry[], domainTitle: string): string {
	const out: string[] = [`# Diário de estudo — ${domainTitle}`, ""];
	if (entries.length === 0) out.push("_(nenhuma sessão registrada)_");
	for (const e of [...entries].sort((a, b) => b.createdAt - a.createdAt)) {
		out.push(`## ${formatDay(e.createdAt)} <!--${e.sessionId}-->`);
		if (e.mission) out.push(`**Missão:** ${e.mission}`, "");
		out.push(`**Resumo:** ${e.summary}`, "", `**Próximo foco:** ${e.nextFocus}`, "");
	}
	return withNotice(out.join("\n"));
}
