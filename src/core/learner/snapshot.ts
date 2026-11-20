/**
 * ~300-token learner snapshot for the tutor prompt (r2 §9.14; SÍNTESE §2.6
 * "Snapshot para o prompt", §2.4(b) context slot 4 "snapshot do learner").
 *
 *   frontier     top-5 frontier leaves by readiness × importance;
 *   topMastered  top-5 leaves of the inner fringe of K* (through containers) ("você domina (topo)"),
 *                most recently mastered first;
 *   weak         top-3 by the weak score, with the strongest active
 *                misconception as short text;
 *   dueReviews   cards due now;
 *   todayPlan    ≤ 6 one-liners from the day plan.
 * Titles are clipped (48 chars) so the rendered text stays near 300 tokens.
 * `renderPromptSnapshot` produces the pt-BR text block the tutor sees.
 */

import type { LearnerGraphView } from "./graph-view.ts";
import { topLeaves } from "./kst.ts";
import { compareIds, toMs } from "./math.ts";
import { computeSignals, type SignalsResult } from "./signals.ts";
import type { LearnerParams, LearnerPromptSnapshot, LearnerSnapshot, NodeId, PlanItem, StudyPlan } from "./types.ts";

const TITLE_MAX = 48;
const MISCONCEPTION_MAX = 80;

function clip(text: string, max: number): string {
	const t = text.trim().replace(/\s+/g, " ");
	return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function titleOf(graph: LearnerGraphView, id: NodeId): string {
	return clip(graph.nodes.get(id)?.title ?? id, TITLE_MAX);
}

/** Show the observed choices with their source sessions. Keep solution keys out of recall. */
export function recentQuizErrorLines(snapshot: LearnerPromptSnapshot): string[] {
	const group = snapshot.recentErrors;
	if (!group) return [];
	return [
		`Erros recentes em questões distintas — ${clip(group.title, TITLE_MAX)}`,
		...group.checks.map(check => `- ${clip(check.question, 120)} · resposta: ${clip(check.answer, 60)} ([aula de ${check.at.slice(0, 10)}](/chat/${encodeURIComponent(check.sessionId)}))`),
	];
}

const KIND_LABEL: Record<PlanItem["kind"], string> = {
	review: "Revisar",
	vehicle: "Revisão combinada",
	new: "Aprender",
	remediate: "Reforçar",
	probe: "Sondar",
};

export interface PromptSnapshotOptions {
	nodes?: ReadonlySet<NodeId>;
	at: string;
	plan?: StudyPlan | null;
	signals?: SignalsResult;
}

export function buildPromptSnapshot(
	snapshot: LearnerSnapshot,
	graph: LearnerGraphView,
	params: LearnerParams,
	opts: PromptSnapshotOptions,
): LearnerPromptSnapshot {
	const sig = opts.signals ?? computeSignals(snapshot, graph, params, opts.at);
	const get = (id: NodeId) => sig.signals.get(id);
	const relevant = (id: NodeId) => !opts.nodes || opts.nodes.has(id);

	const frontier = sig.structure.frontier
		.filter(relevant)
		.map((id) => ({ id, readiness: get(id)?.readiness ?? 0, score: (get(id)?.readiness ?? 0) * (get(id)?.importance ?? 1) }))
		.sort((a, b) => b.score - a.score || compareIds(a.id, b.id))
		.slice(0, 5)
		.map((f) => ({ nodeId: f.id, title: titleOf(graph, f.id), readiness: Math.round(f.readiness * 100) / 100 }));

	const masteredAtOf = (id: NodeId) => {
		const m = snapshot.nodes[id]?.masteredAt;
		return m ? toMs(m) : 0;
	};
	const topMastered = topLeaves(graph, sig.crisp)
		.filter(relevant)
		.sort((a, b) => masteredAtOf(b) - masteredAtOf(a) || compareIds(a, b))
		.slice(0, 5)
		.map((id) => ({ nodeId: id, title: titleOf(graph, id) }));

	const weak = [...sig.signals.values()]
		.filter((s) => s.status === "weak" && relevant(s.nodeId))
		.sort((a, b) => b.weakScore - a.weakScore || compareIds(a.nodeId, b.nodeId))
		.slice(0, 3)
		.map((s) => ({
			nodeId: s.nodeId,
			title: titleOf(graph, s.nodeId),
			...(s.misconception ? { misconception: clip(s.misconception, MISCONCEPTION_MAX) } : {}),
		}));

	let dueReviews = 0;
	for (const s of sig.signals.values()) if (s.reviewDue && relevant(s.nodeId)) dueReviews++;

	const todayPlan = (opts.plan?.items ?? []).filter(item => relevant(item.nodeId)).slice(0, 6).map((item) => `${KIND_LABEL[item.kind]}: ${titleOf(graph, item.nodeId)} (${item.estMinutes} min)`);

	return { frontier, topMastered, weak, dueReviews, todayPlan };
}

/** Compact pt-BR rendering for the prompt (stable order → prompt-cache friendly). */
export function renderPromptSnapshot(s: LearnerPromptSnapshot): string {
	const lines: string[] = ["## Estado do aluno", ...recentQuizErrorLines(s)];
	lines.push(
		s.frontier.length > 0
			? `Pronto para aprender: ${s.frontier.map((f) => `${f.title} (prontidão ${Math.round(f.readiness * 100)}%)`).join("; ")}.`
			: "Pronto para aprender: nada no momento.",
	);
	lines.push(s.topMastered.length > 0 ? `Domina (topo): ${s.topMastered.map((m) => m.title).join("; ")}.` : "Domina (topo): ainda nada consolidado.");
	if (s.weak.length > 0) {
		lines.push(`Pontos fracos: ${s.weak.map((w) => (w.misconception ? `${w.title} — ${w.misconception}` : w.title)).join("; ")}.`);
	}
	lines.push(`Revisões vencidas: ${s.dueReviews}.`);
	if (s.todayPlan.length > 0) lines.push(`Plano de hoje: ${s.todayPlan.join("; ")}.`);
	return lines.join("\n");
}
