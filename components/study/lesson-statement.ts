import type { StudyNodeBrief } from "@/src/core";

export function lessonStatement(brief: StudyNodeBrief, minutes: number, priorGap?: string): string {
	const parts = [
		brief.path.length > 0 ? `Trilha: ${brief.path.join(" › ")}.` : "",
		brief.summary ? `Resumo: ${brief.summary}` : "",
		brief.objectives.length > 0 ? `Objetivos: ${brief.objectives.join("; ")}.` : "",
		brief.scope && brief.scope !== brief.summary ? `Escopo: ${brief.scope}` : "",
		brief.assessment?.length ? `Evidência esperada: ${brief.assessment.join("; ")}.` : "",
		brief.regionExit ? "Fechamento de região. Ofereça um exemplo resolvido ou um trecho das fontes antes do desafio; permita seguir direto. Peça uma aplicação independente em situação nova." : "",
		brief.misconceptions.length > 0 ? `Confusões comuns: ${brief.misconceptions.join("; ")}.` : "",
		priorGap ? `Retomada após reforço: ataque diretamente esta lacuna da tentativa anterior — ${priorGap}` : "",
		`Aula de ~${minutes} min do currículo do domínio.`,
	];
	return parts.filter(Boolean).join(" ");
}

