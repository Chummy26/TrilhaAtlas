import type { CurriculumItem, CurriculumSnapshot } from "../curriculum/types.ts";
import type { LearnerGraphView } from "../learner/graph-view.ts";
import type { CampaignChapter } from "./campaign.ts";

// Entry and finale are existing, permanent curriculum IDs. The middle of each
// chapter follows the learner's available prerequisite frontier and day budget.
interface ChapterPlan {
	level: string;
	title: string;
	mission: string;
	entry: string;
	route: string[];
	finale: string;
	entryMinutes: number;
	usual: number;
}

// Session caps pace a visit. Curriculum hours cover the entire skill.
const chapters: ChapterPlan[] = [
	{
		level: "A1", title: "Primeiros encontros", mission: "Apresente-se e descubra algo sobre outra pessoa.",
		entry: "en.speaking.a1.greetings", route: ["en.listening.a1.personal-info", "en.speaking.a1.personal-questions", "en.writing.a1.forms"],
		finale: "en.speaking.a1.about-me", entryMinutes: 15, usual: 25,
	},
	{
		level: "A2", title: "Histórias do cotidiano", mission: "Conte um episódio e responda a uma pergunta sobre ele.",
		entry: "en.speaking.a2.past-events", route: ["en.listening.a2.voice-messages", "en.writing.a2.connecting-sentences", "en.writing.a2.simple-narrative"],
		finale: "en.speaking.a2.mini-presentation", entryMinutes: 20, usual: 25,
	},
	{
		level: "B1", title: "Sua voz na conversa", mission: "Defenda uma preferência e responda a quem discorda.",
		entry: "en.speaking.b1.opinions", route: ["en.listening.b1.gist-detail", "en.pragmatics.b1.polite-disagreement", "en.speaking.b1.group-chat"],
		finale: "en.writing.b1.opinion-paragraph", entryMinutes: 20, usual: 30,
	},
	{
		level: "B2", title: "À mesa de negociação", mission: "Compare propostas e negocie uma solução com restrições.",
		entry: "en.speaking.b2.argue", route: ["en.listening.b2.discussions", "en.pragmatics.b2.softening", "en.writing.b2.argumentative-essay"],
		finale: "en.speaking.b2.negotiation", entryMinutes: 25, usual: 35,
	},
	{
		level: "C1", title: "Na banca de pesquisa", mission: "Sustente uma conclusão e delimite o que a evidência permite afirmar.",
		entry: "en.speaking.c1.handling-qa", route: ["en.listening.c1.panels-qa", "en.academic.paper-critique.claims", "en.academic.academic-writing.hedging"],
		finale: "en.academic.paper-critique.referee-review", entryMinutes: 30, usual: 40,
	},
	{
		level: "C2", title: "Debate e edição", mission: "Responda a uma objeção forte e revise um argumento para outro público.",
		entry: "en.speaking.c2.advanced-debate", route: ["en.speaking.c2.nuance", "en.speaking.c2.rhetoric", "en.writing.c2.critical-reviews"],
		finale: "en.writing.c2.editing-others", entryMinutes: 30, usual: 45,
	},
];
const levelSessions = new Map(chapters.map(c => [c.level, c]));

const finaleAssignments = new Map<string, string>([
	["en.speaking.a1.about-me", "Você chega a um clube de leitura. Diga quem é, conte algo sobre você e devolva uma pergunta ao colega. Observe se o interlocutor consegue identificar as duas pessoas."],
	["en.speaking.a2.mini-presentation", "Apresente um episódio de fim de semana, ligue três acontecimentos no tempo e responda a uma pergunta imprevista sobre um deles."],
	["en.writing.b1.opinion-paragraph", "Escreva ao jornal de sua escola sobre uma proposta local. Sustente uma posição com uma razão e um exemplo. Depois adapte o parágrafo a um leitor que discorda."],
	["en.speaking.b2.negotiation", "Negocie um cronograma entre duas equipes com exigências incompatíveis. Retome a objeção da outra parte, faça uma concessão e feche um acordo verificável."],
	["en.academic.paper-critique.referee-review", "Use um resumo de pesquisa curto. Redija um parecer em inglês, distinga conclusão e evidência e justifique uma revisão principal com tom profissional."],
	["en.writing.c2.editing-others", "Revise um argumento escrito por outra pessoa para um público diferente. Preserve a posição e a voz do autor. Justifique duas decisões de estrutura, precisão ou registro."],
]);
export function englishFinale(id: string) {
	return finaleAssignments.get(id);
}

export function englishSessionMinutes(item: CurriculumItem) {
	if (item.level.scheme !== "cefr") return;
	const band = levelSessions.get(item.level.cefr === "pre-A1" ? "A1" : item.level.cefr);
	if (band) return item.id === band.entry ? band.entryMinutes : item.id === band.finale ? band.usual + 10 : band.usual;
}

export function englishCampaign(snapshot: CurriculumSnapshot, graph: LearnerGraphView, known: ReadonlySet<string>) {
	const journey: CampaignChapter[] = chapters.map(({ level, title, mission, entry, route, finale, entryMinutes }) => ({
		level, title, mission, entry, finale, entryMinutes, total: 0, known: 0,
		landmarks: [entry, ...route, finale].flatMap(id => {
			const node = graph.nodes.get(id);
			return node?.isLeaf ? [{ id, title: node.title, known: known.has(id) }] : [];
		}),
	}));
	const byLevel = new Map(journey.map(c => [c.level, c]));
	const stages = new Map<string, CampaignChapter>();
	const lessonMinutes = new Map<string, number>();
	for (const id of graph.ids) {
		const item = snapshot.items[id]!;
		if (!graph.nodes.get(id)?.isLeaf || item.reinforcementFor || item.level.scheme !== "cefr") continue;
		const stage = byLevel.get(item.level.cefr === "pre-A1" ? "A1" : item.level.cefr);
		if (!stage) continue;
		stage.total++;
		if (known.has(id)) stage.known++;
		stages.set(id, stage);
		lessonMinutes.set(id, englishSessionMinutes(item)!);
	}
	const current = journey.find(c => c.known < c.total);
	// A finale that is itself required to unlock another skill remains reachable.
	const priority = (id: string) => {
		if (!current || stages.get(id) !== current) return 0;
		if (id === current.entry) return 10;
		const step = levelSessions.get(current.level)!.route.indexOf(id);
		return step >= 0 ? 8 - step : id === current.finale ? 1 : 2;
	};
	return { journey, priority, lessonMinutes };
}
