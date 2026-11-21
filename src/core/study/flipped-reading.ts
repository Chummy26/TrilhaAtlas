/**
 * Flipped-classroom pre-reading guide and compact lesson-opener formatter.
 * Generates 3 objective pre-class questions grounded in a node's objectives,
 * scope, misconceptions, and priority book/video materials, and condenses the
 * learner's pre-reading answers and doubts into a <= 450-char tutor injection.
 *
 * Pure and browser-safe: no Node APIs, no I/O, no wall clock.
 */

import type { StudyNodeBrief } from "./projection.ts";

export interface FlippedMaterialRef {
	kind: "book" | "video";
	title: string;
	part: string;
	url: string;
}

export interface FlippedGuideQuestion {
	id: "mechanism" | "example" | "trap";
	focus: "mecanismo" | "exemplo" | "armadilha";
	prompt: string;
	hint: string;
}

export interface FlippedReadingGuide {
	nodeId: string;
	title: string;
	primaryBook: FlippedMaterialRef | null;
	primaryVideo: FlippedMaterialRef | null;
	questions: [FlippedGuideQuestion, FlippedGuideQuestion, FlippedGuideQuestion];
}

export interface FlippedPrepNote {
	/** Short answers keyed by question id ("mechanism" | "example" | "trap"). */
	answers?: Partial<Record<FlippedGuideQuestion["id"], string>> & Record<string, string | undefined>;
	/** Main question or sticking point to bring to the lesson opening. */
	doubt?: string;
	/** Optional material formats already consulted by the learner. */
	completedMaterials?: readonly ("book" | "video")[];
}

const MAX_PREP_CHARS = 450;

function cleanText(raw: string): string {
	return raw.trim().replace(/\s+/g, " ");
}

function stripTrailingPeriod(text: string): string {
	return text.replace(/[.。]+$/u, "");
}

function clip(text: string, max: number): string {
	const clean = cleanText(text);
	if (clean.length <= max) return clean;
	if (max <= 1) return clean.slice(0, max);
	return `${clean.slice(0, max - 1).trimEnd()}…`;
}

function lowercaseInitial(text: string): string {
	if (!text) return text;
	// Preserve acronyms like "CA", "FSRS", "MOSFET".
	if (text.length >= 2 && text[0] === text[0]!.toUpperCase() && text[1] === text[1]!.toUpperCase()) {
		return text;
	}
	return text[0]!.toLowerCase() + text.slice(1);
}

function formatMaterialLabel(mat: FlippedMaterialRef): string {
	const title = cleanText(mat.title);
	const part = cleanText(mat.part);
	return part ? `${title} (${part})` : title;
}

/** Generate 3 objective pre-reading guide questions linked to the priority book and video. */
export function buildFlippedGuide(
	brief: StudyNodeBrief,
	materials: readonly { kind: "book" | "video"; title: string; part: string; url: string }[],
): FlippedReadingGuide {
	const primaryBookRaw = materials.find((m) => m.kind === "book") ?? null;
	const primaryVideoRaw = materials.find((m) => m.kind === "video") ?? null;
	const primaryBook: FlippedMaterialRef | null = primaryBookRaw ? { ...primaryBookRaw } : null;
	const primaryVideo: FlippedMaterialRef | null = primaryVideoRaw ? { ...primaryVideoRaw } : null;

	const title = cleanText(brief.title);
	const obj0 = brief.objectives[0] ? stripTrailingPeriod(clip(brief.objectives[0], 130)) : "";
	const obj1 = brief.objectives[1] ? stripTrailingPeriod(clip(brief.objectives[1], 130)) : "";
	const scope = brief.scope ? stripTrailingPeriod(clip(brief.scope, 130)) : "";
	const summary = brief.summary ? stripTrailingPeriod(clip(brief.summary, 130)) : "";
	const trap0 = brief.misconceptions[0] ? stripTrailingPeriod(clip(brief.misconceptions[0], 130)) : "";
	const trap1 = brief.misconceptions[1] ? stripTrailingPeriod(clip(brief.misconceptions[1], 110)) : "";

	const readingSource = primaryBook
		? formatMaterialLabel(primaryBook)
		: primaryVideo
			? formatMaterialLabel(primaryVideo)
			: "o material de apoio";

	// 1. Core mechanism / governing principle.
	const q1Prompt = obj0
		? `Qual é o princípio central de "${title}" que permite ${lowercaseInitial(obj0)}?`
		: summary
			? `Qual é o mecanismo central de "${title}" (${lowercaseInitial(summary)}) e por que ele se sustenta?`
			: `Qual é o princípio central de "${title}" e qual relação de causa e efeito o governa?`;
	const q1Hint = primaryBook
		? `Busque a ideia-chave em ${formatMaterialLabel(primaryBook)}.`
		: primaryVideo
			? `Observe a explicação central em ${formatMaterialLabel(primaryVideo)}.`
			: "Identifique a regra principal e o que muda quando seus parâmetros variam.";

	// 2. Concrete example, figure, or contrast from the reading/video.
	const q2Prompt = obj1
		? `Em ${readingSource}, qual exemplo, figura ou contraste mostra como ${lowercaseInitial(obj1)}?`
		: scope
			? `Em ${readingSource}, qual exemplo ou figura ilustra na prática este escopo: ${lowercaseInitial(scope)}?`
			: `Em ${readingSource}, qual exemplo ou contraste concretiza "${title}" passo a passo?`;
	const q2Hint = primaryVideo && primaryBook
		? `Compare o exemplo da leitura com a demonstração em ${formatMaterialLabel(primaryVideo)}.`
		: "Anote os dados de entrada, o passo decisivo e o resultado observável do exemplo.";

	// 3. Common trap / boundary case to verify.
	const q3Prompt = trap0
		? `Ao estudar "${title}", como evitar esta armadilha frequente: "${trap0}"?`
		: scope
			? `Qual hipótese ou caso-limite delimita "${title}" (${lowercaseInitial(scope)}) e onde a aplicação ingênua falha?`
			: `Qual caso-limite ou erro comum faz a aplicação direta de "${title}" falhar?`;
	const q3Hint = trap1
		? `Verifique também esta confusão comum: ${trap1}.`
		: "Teste um caso extremo e anote em qual condição a regra deixa de valer.";

	return {
		nodeId: brief.id,
		title,
		primaryBook,
		primaryVideo,
		questions: [
			{ id: "mechanism", focus: "mecanismo", prompt: q1Prompt, hint: q1Hint },
			{ id: "example", focus: "exemplo", prompt: q2Prompt, hint: q2Hint },
			{ id: "trap", focus: "armadilha", prompt: q3Prompt, hint: q3Hint },
		],
	};
}

const LABELS: Record<FlippedGuideQuestion["id"], string> = {
	mechanism: "Mecanismo",
	example: "Exemplo",
	trap: "Armadilha",
};

/** Format pre-reading answers and doubts into a concise (<= 450 chars) block for the lesson opener. */
export function formatFlippedPrepForLesson(guide: FlippedReadingGuide, note: FlippedPrepNote): string {
	const answersMap = note.answers ?? {};
	const answered = guide.questions
		.map((q) => ({ id: q.id, label: LABELS[q.id], text: cleanText(answersMap[q.id] ?? "") }))
		.filter((item) => item.text.length > 0);
	const doubt = cleanText(note.doubt ?? "");
	const doneSet = new Set(note.completedMaterials ?? []);
	const doneTags: string[] = [];
	if (doneSet.has("book")) doneTags.push("livro");
	if (doneSet.has("video")) doneTags.push("vídeo");

	if (answered.length === 0 && !doubt && doneTags.length === 0) {
		return "";
	}

	const headerBase = `Pré-leitura (${clip(guide.title, 44)})`;
	const header = doneTags.length > 0 ? `${headerBase} [${doneTags.join("+")}]:` : `${headerBase}:`;

	if (answered.length === 0 && !doubt) {
		return clip(`${header} material consultado antes da aula.`, MAX_PREP_CHARS);
	}

	const lines: string[] = [header];
	const remainingAfterHeader = MAX_PREP_CHARS - header.length - 1;

	// Reserve space for the learner's doubt first, since it directly guides the teacher's opening.
	const doubtPrefix = "- Dúvida: ";
	const doubtBudget = doubt
		? Math.min(130, answered.length > 0 ? Math.floor(remainingAfterHeader * 0.36) : remainingAfterHeader - doubtPrefix.length)
		: 0;
	const doubtLine = doubt ? `${doubtPrefix}${clip(doubt, Math.max(24, doubtBudget))}` : "";

	const budgetForAnswers = remainingAfterHeader - (doubtLine ? doubtLine.length + 1 : 0);
	if (answered.length > 0 && budgetForAnswers > 20) {
		const perAnswer = Math.floor((budgetForAnswers - answered.length) / answered.length);
		for (const item of answered) {
			const prefix = `- ${item.label}: `;
			const textBudget = Math.max(16, perAnswer - prefix.length);
			lines.push(`${prefix}${clip(item.text, textBudget)}`);
		}
	}

	if (doubtLine) {
		lines.push(doubtLine);
	}

	const result = lines.join("\n");
	if (result.length <= MAX_PREP_CHARS) return result;
	return `${result.slice(0, MAX_PREP_CHARS - 1).trimEnd()}…`;
}
