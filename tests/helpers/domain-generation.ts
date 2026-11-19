const title = (pt: string) => ({ pt, en: pt });
const labels = ["Curvas de nível", "Traçar perfis", "Avaliar um itinerário"];
export const outline = {
	title: title("Topografia"), goal: "Justificar uma rota a pé com dados de uma carta.",
	areas: labels.map((label, i) => ({
		title: title("Etapa de " + label), goal: "Demonstrar a competência de " + label,
		regions: [{ title: title(label), exit: "Aplicar ao terreno a competência " + label,
			requires: i ? [i] : [], bookQuery: "topografia " + label, videoQuery: "topografia " + label }],
	})),
};
export const lessons = (region: number) => ({
	skills: ["Identificar", "Comparar", "Justificar"].map((verb, i) => ({
		title: title(verb + " " + labels[region]), objective: verb + " uma diferença de cotas na carta",
		activity: "Desenhar e comparar trajetos em duas cartas com escalas distintas.",
		assessment: "Justifica a rota indicando a diferença de cotas.", bloom: "apply",
		minutes: 20, requires: i ? [i] : [],
		...(i === 2 && region === 2 ? { practice: { targetHours: 12, exitCriterion: "Justificar rotas em três cartas desconhecidas." } } : {}),
	})),
});
