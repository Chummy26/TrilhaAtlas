import type { CampaignReview } from "../core/study/campaign-review.ts";

// A decision within the mission. Speaking and writing still require independent production.
const cases: [nodeId: string, prompt: string, answers: string[], explanation: string][] = [
	["en.speaking.a1.greetings", "No crachá de uma colega está escrito Kim. Apresente-se a ela com o nome fictício Alex. Use I e o verbo be, por extenso ou contraído: Hi Kim, ___ Alex.", ["I'm", "I’m", "i'm", "i’m", "I am", "i am"], "I'm Alex apresenta quem está falando. Kim é a pessoa que você cumprimenta."],
	["en.speaking.a2.past-events", "Ontem Lee perdeu o ônibus. Complete com o passado de miss: Yesterday Lee ___ the bus.", ["missed", "Missed"], "Miss é regular. Missed marca a ação concluída ontem."],
	["en.speaking.b1.opinions", "Uma colega sugere cancelar o passeio. Você quer discordar com tato. Escolha see ou look: I ___ your point, but we could change the date.", ["see", "See"], "I see your point reconhece o argumento antes de apresentar outra opção."],
	["en.speaking.b2.argue", "Você questiona um orçamento sem atacar a pessoa. Use considered ou considering: Have you ___ the maintenance costs?", ["considered", "Considered"], "Have you considered…? põe a premissa em discussão e pede uma resposta."],
	["en.speaking.c1.handling-qa", "Na banca, há correlação e a causalidade continua incerta. Escolha suggests ou proves: This association ___ a possible explanation.", ["suggests", "Suggests"], "Suggests limita a força da inferência ao que os dados permitem."],
	["en.speaking.c2.advanced-debate", "Em uma réplica, você aceita a premissa, mas contesta a conclusão. Complete com granted ou therefore: ___, the sample was small. That alone does not invalidate the result.", ["Granted", "granted"], "Granted introduz uma concessão antes de delimitar seu alcance."],
];
export const englishMissionReviews: CampaignReview[] = cases.map(([nodeId, prompt, answers, explanation], i) => ({
	id: nodeId + ":mission:v1", nodeId, nodeVersion: 1, prompt, answers, explanation, format: i < 2 ? "short" : "mcq", level: i < 2 ? 2 : 1,
}));
