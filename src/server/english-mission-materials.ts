import type { StudyMaterial } from "../core/study/map.ts";

type Section = [title: string, part: string, url: string];
function pair(nodes: string[], reading: Section, video: Section): StudyMaterial[] {
	return ([reading, video] as const).map(([title, part, url], index) => ({
		kind: index === 0 ? "book" : "video", title, part, url, lang: "en", nodes, linkOnly: true,
	}));
}

export const englishMissionMaterials: StudyMaterial[] = [
	...pair(["en.speaking.a1.greetings", "en.listening.a1.personal-info", "en.speaking.a1.about-me"],
		["Let's Learn English · VOA", "Lição 1, Conversation, página física 5. Compare a fala de Pete, “I am Pete”, com a apresentação de Anna, “I’m Anna”.", "https://docs.voanews.eu/en-us-learn/2019/11/28/a6b53eb2-060b-404f-88d7-f1b5c350c90d.pdf#page=5"],
		["Let's Learn English · Welcome!", "Diálogo de Anna e Pete. Ouça primeiro como confirmam os nomes e depois como Anna soletra o dela.", "https://learningenglish.voanews.com/a/lets-learn-english-lesson-one/3111026.html"]),
	...pair(["en.speaking.a2.past-events", "en.writing.a2.simple-narrative"],
		["Let's Learn English · VOA", "Lição 24, Conversation. Sublinhe as ações da carta de Anna.", "https://learningenglish.voanews.com/a/lets-learn-english-lesson-24-yesterday-was-amazing/3439164.html"],
		["Yesterday Was Amazing!", "Ouça a sequência de acontecimentos e reconte dois deles.", "https://learningenglish.voanews.com/a/5780940.html"]),
	...pair(["en.speaking.b1.opinions", "en.pragmatics.b1.polite-disagreement"],
		["British Council · Agreeing and disagreeing", "Ficha de estudo e transcrição. Identifique como suavizar uma discordância.", "https://learnenglish.britishcouncil.org/sites/podcasts/files/LearnEnglish-Speaking-B1-Agreeing-and-disagreeing.pdf"],
		["British Council · Agreeing and disagreeing", "Observe a resposta a uma opinião e reformule-a para outra conversa.", "https://learnenglish.britishcouncil.org/free-resources/speaking/b1/agreeing-disagreeing"]),
	...pair(["en.speaking.b2.argue", "en.speaking.b2.negotiation"],
		["British Council · Challenging someone's ideas", "Ficha de estudo. Separe a proposta da objeção levantada.", "https://learnenglish.britishcouncil.org/sites/podcasts/files/LearnEnglish-Speaking-B2-Challenging-someones-ideas.pdf"],
		["British Council · Challenging someone's ideas", "Ouça a proposta de Vanya e escolha como questionar uma premissa.", "https://learnenglish.britishcouncil.org/free-resources/speaking/b2/challenging-someones-ideas"]),
	...pair(["en.speaking.c1.handling-qa"],
		["Cambridge English · Pedro and Isabela", "Comentários do examinador, Interactive Communication. Relacione um critério a uma resposta.", "https://www.cambridgeenglish.org/Images/710739-c1-advanced-examiner-comments-pedro-and-isabela.pdf"],
		["Cambridge English · C1 Advanced Speaking", "Discussão de Pedro e Isabela. Observe como desenvolvem uma resposta.", "https://www.youtube.com/watch?v=ynr6gm5tCmY"]),
	...pair(["en.speaking.c2.advanced-debate", "en.speaking.c2.nuance"],
		["Cambridge English · Laura and Alejandro", "Comentários do examinador, Discourse Management. Compare como cada participante sustenta uma posição.", "https://www.cambridgeenglish.org/Images/710741-c2-proficiency-examiner-comments-laura-and-alejandro.pdf"],
		["Cambridge English · C2 Proficiency Speaking", "Discussão de Laura e Alejandro. Identifique uma afirmação e formule uma ressalva.", "https://www.youtube.com/watch?v=Oj44fyMvIRY"]),
	...pair(["en.speaking.a2.mini-presentation"],
		["Oxford Online English · Presentations in English", "Texto da aula. Escolha uma expressão de abertura e anuncie seu tema em uma frase.", "https://www.oxfordonlineenglish.com/presentations-in-english"],
		["Oxford Online English · How to Give a Presentation", "Veja apenas a abertura. Adapte a apresentação para contar algo que aconteceu com você.", "https://www.youtube.com/watch?v=fzIxD1jXn44"]),
	...pair(["en.writing.b1.opinion-paragraph"],
		["British Council · An opinion essay", "Texto-modelo B1. Encontre uma opinião, uma razão e um exemplo dentro de um parágrafo.", "https://learnenglishteens.britishcouncil.org/skills/writing/b1-writing/opinion-essay"],
		["British Council · Agreeing and disagreeing", "Da fala à escrita. Escolha uma opinião do diálogo e responda em um parágrafo próprio.", "https://learnenglish.britishcouncil.org/free-resources/speaking/b1/agreeing-disagreeing"]),
	...pair(["en.academic.paper-critique.referee-review"],
		["PLOS · Peer Review Template", "Separe o resumo do manuscrito, as questões principais e os comentários específicos.", "https://plos.org/wp-content/uploads/2020/02/PLOS-Peer-Review-Template.pdf"],
		["Elsevier Researcher Academy · Reviewer Webinar", "Parte sobre redigir um parecer construtivo. A plataforma pode solicitar login.", "https://researcheracademy.elsevier.com/navigating-peer-review/fundamentals-peer-review/practical-guide-navigating-peer-review-process"]),
	...pair(["en.writing.c2.editing-others"],
		["UNC Writing Center · Revising Drafts", "Use as perguntas sobre argumento e público para justificar uma mudança estrutural.", "https://writingcenter.unc.edu/tips-and-tools/revising-drafts/"],
		["Obert Skye · The Magic of Revision", "Identifique uma escolha de revisão e discuta se ela preserva a voz de outro autor.", "https://www.youtube.com/watch?v=xqK6-ePxPa8"]),
];
export function materialsForEnglishMission(id: string) {
	return englishMissionMaterials.filter(m => m.nodes.includes(id));
}
