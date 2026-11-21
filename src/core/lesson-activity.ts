import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const lessonTitle = Type.String({ minLength: 1, maxLength: 100 });
const lessonSteps = Type.Array(Type.Object({
	illustration: Type.Optional(Type.Union([Type.Literal("listen"), Type.Literal("say"), Type.Literal("write"), Type.Literal("order"),
		Type.Literal("observe"), Type.Literal("measure"), Type.Literal("compare")])),
	label: Type.String({ minLength: 1, maxLength: 60 }),
	detail: Type.String({ minLength: 1, maxLength: 400 }),
}), { minItems: 2, maxItems: 6 });

export const comicScenes = ["reception", "cafe", "classroom", "home", "work", "street", "lab", "park"] as const;
export type ComicScene = (typeof comicScenes)[number];
export const comicMoods = ["friendly", "curious", "surprised", "thinking", "happy", "confused"] as const;
export type ComicMood = (typeof comicMoods)[number];

const comicPanelSchema = Type.Object({
	scene: Type.Optional(Type.Union([
		Type.Literal("reception"), Type.Literal("cafe"), Type.Literal("classroom"), Type.Literal("home"),
		Type.Literal("work"), Type.Literal("street"), Type.Literal("lab"), Type.Literal("park"),
	], { description: "Illustrated background setting for this comic panel." })),
	speaker: Type.String({ minLength: 1, maxLength: 40, description: "Short name or role of the main character speaking." }),
	mood: Type.Optional(Type.Union([
		Type.Literal("friendly"), Type.Literal("curious"), Type.Literal("surprised"),
		Type.Literal("thinking"), Type.Literal("happy"), Type.Literal("confused"),
	], { description: "Facial expression for the speaking character." })),
	speech: Type.String({ minLength: 1, maxLength: 180, description: "Short, natural line inside the comic speech bubble." }),
	reply: Type.Optional(Type.String({ minLength: 1, maxLength: 180, description: "Optional second character reply bubble in the same panel." })),
	replySpeaker: Type.Optional(Type.String({ minLength: 1, maxLength: 40, description: "Short name of the second character replying." })),
	cue: Type.Optional(Type.String({ minLength: 1, maxLength: 70, description: "Short visual clue sticker the learner should spot in this panel." })),
	caption: Type.String({ minLength: 1, maxLength: 260, description: "Narrator box below the panel explaining what to notice." }),
});
export type ComicPanel = Static<typeof comicPanelSchema>;

const comicPanels = Type.Array(comicPanelSchema, { minItems: 2, maxItems: 6 });
const speechLanguage = Type.Optional(Type.String({
	pattern: "^[a-z]{2,3}(-[A-Za-z]{2,8}){0,2}$",
	description: "Optional BCP-47 language tag (e.g. en-US) for reading comic speech bubbles aloud.",
}));
const lessonSource = Type.String({ minLength: 1, maxLength: 300, description: "Work and section, or a verified https URL from lesson materials." });
const presentation = Type.Optional(Type.Union([Type.Literal("inline"), Type.Literal("panel")], {
	description: "Use inline for a brief comparison or a few steps between paragraphs. Use panel for a longer exploration.",
}));

export const bookActivitySchema = Type.Object({
	kind: Type.Union([Type.Literal("comic"), Type.Literal("sequence"), Type.Literal("comparison"), Type.Literal("diagram")]),
	title: lessonTitle,
	steps: Type.Optional(lessonSteps),
	panels: Type.Optional(comicPanels),
	language: speechLanguage,
	source: lessonSource,
	presentation,
});

export const activitySchema = Type.Object({
	kind: Type.Union([
		Type.Literal("comic"),
		Type.Literal("circuit"), Type.Literal("divider"), Type.Literal("falstad"), Type.Literal("pronunciation"), Type.Literal("notation"), Type.Literal("timeline"),
		Type.Literal("sequence"), Type.Literal("comparison"), Type.Literal("diagram"),
	]),
	title: Type.Optional(lessonTitle),
	steps: Type.Optional(lessonSteps),
	panels: Type.Optional(comicPanels),
	language: speechLanguage,
	source: Type.Optional(lessonSource),
	presentation,
	voice: Type.Optional(Type.Object({
		language: Type.String({ pattern: "^[a-z]{2,3}(-[A-Za-z]{2,8}){0,2}$" }),
		sample: Type.String({ minLength: 1, maxLength: 260 }),
		mode: Type.Union([Type.Literal("phrase"), Type.Literal("spelling")]),
		hideText: Type.Optional(Type.Boolean({ description: "Set true for blind listening, dictation, or listening assessments so the spoken transcript is hidden on screen." })),
	})),
	divider: Type.Optional(Type.Object({ volts: Type.Number({ minimum: 0, maximum: 24 }),
		upperOhms: Type.Integer({ minimum: 1, maximum: 1e7 }), lowerOhms: Type.Integer({ minimum: 1, maximum: 1e7 }) })),
	experiment: Type.Optional(Type.Union([Type.Literal("rc-filter"), Type.Literal("rlc"), Type.Literal("rectifier")])),
});

export const falstadExperiments = {
	"rc-filter": { file: "filt-lopass.txt", title: "Filtro RC passa-baixas", task: "Observe a varredura de frequência. Compare as amplitudes de entrada e de saída em duas frequências. Repita após dobrar a capacitância." },
	rlc: { file: "lrc.txt", title: "Oscilação e amortecimento em RLC", task: "Acione a chave e observe os picos da tensão no capacitor. Aumente a resistência em série e reinicie. Compare o tempo que a oscilação leva para desaparecer." },
	rectifier: { file: "fullrectf.txt", title: "Ponte retificadora com filtro", task: "Observe a tensão sobre a carga durante dois ciclos. Dobre a capacitância e compare a diferença entre a tensão máxima e a mínima." },
} as const;

export type LessonActivity = Static<typeof activitySchema>;
export function parseLessonActivity(raw: unknown): LessonActivity | undefined {
	if (!Value.Check(activitySchema, raw)) return;
	if (raw.kind === "pronunciation") {
		if (!raw.voice?.sample.trim()) return;
		if (raw.voice.mode === "spelling") {
			const sample = raw.voice.sample.trim().normalize("NFC");
			const letters = sample.replace(/[\s,.;·–—-]+/gu, "");
			if (!/^\p{L}[\p{L}\p{M}]{0,19}$/u.test(letters)) return;
			return { ...raw, voice: { ...raw.voice, sample: letters } };
		}
	}
	if (raw.kind === "falstad" && !raw.experiment) return;
	if (raw.kind === "comic") {
		if (!raw.title?.trim() || !raw.source?.trim() || !raw.panels?.length) return;
		if (!raw.panels.every(panel => panel.speaker.trim() && panel.speech.trim() && panel.caption.trim())) return;
	}
	if (["sequence", "comparison", "diagram"].includes(raw.kind)) {
		if (!raw.title?.trim() || !raw.source?.trim() || !raw.steps?.length) return;
		if (!raw.steps.every(step => step.label.trim() && step.detail.trim())) return;
		if (raw.kind === "comparison" && new Set(raw.steps.map(step => step.label.trim())).size !== raw.steps.length) return;
	}
	return raw;
}

const BLIND_LISTENING_TITLE = /sem\s+ler|ou[cç]a\s+sem|sem\s+texto|escuta\s+(?:cega|sem|da\s+avalia)|avalia[cç][aã]o|ditado|dictation|blind|listen\s+only|n[aã]o\s+mostrar/i;

/** Hide spoken transcript on screen when explicitly requested or implied by a blind-listening / assessment title. */
export function shouldHideVoiceText(voice: NonNullable<LessonActivity["voice"]>, title?: string): boolean {
	if (voice.hideText === true) return true;
	if (voice.hideText === false) return false;
	return Boolean(title && BLIND_LISTENING_TITLE.test(title));
}

export function coversLessonActivity(output: unknown, preset: LessonActivity) {
	const shown = parseLessonActivity(output);
	if (!shown || shown.kind !== preset.kind) return false;
	if (preset.kind !== "pronunciation") return true;
	return shown.voice?.language === preset.voice?.language && shown.voice?.mode === preset.voice?.mode && shown.voice?.sample.toUpperCase() === preset.voice?.sample.toUpperCase();
}

export function activityForSkill(id?: string | null): LessonActivity | undefined {
	if (!id) return;
	if (id === "en.listening.a1.personal-info") return {
		kind: "pronunciation", title: "Ouvir e soletrar um nome",
		voice: { language: "en-US", sample: "Anna", mode: "spelling" },
	};
	if (id === "en.speaking.a1.greetings") return {
		kind: "comic", title: "Primeiro encontro na recepção", language: "en-US",
		source: "VOA · Let's Learn English, lição 1, Welcome! Diálogo de prática adaptado.",
		panels: [
			{
				scene: "reception", speaker: "Atendente", mood: "friendly",
				speech: "Hi! Welcome!", reply: "Hello!", replySpeaker: "Você",
				cue: "Hi / Hello → abre a conversa",
				caption: "Um cumprimento curto já quebra o gelo. Em contextos mais formais, experimente Hello!",
			},
			{
				scene: "reception", speaker: "Você", mood: "happy",
				speech: "I'm Jo.", cue: "I'm + nome",
				caption: "Diga seu nome logo depois do cumprimento. Troque Jo pelo nome que você quer usar.",
			},
			{
				scene: "reception", speaker: "Você", mood: "curious",
				speech: "And you?", reply: "I'm Anna. Nice to meet you!", replySpeaker: "Atendente",
				cue: "And you? → passa a vez",
				caption: "Devolva a pergunta para ouvir o nome da outra pessoa. Depois, tente o diálogo sem olhar.",
			},
		],
	};
	if (id === "en.speaking.a1.personal-questions") return {
		kind: "comic", title: "Na recepção: qual dado ela pediu?", language: "en-US",
		source: "VOA · Let's Learn English, lição 1–2. Situação de ficha de inscrição adaptada.",
		panels: [
			{
				scene: "reception", speaker: "Atendente", mood: "friendly",
				speech: "What's your name?", reply: "I'm Lucas.", replySpeaker: "Você",
				cue: "name → pedido de nome",
				caption: "Quando ouvir «name», a ficha precisa do seu nome — basta responder «I'm …».",
			},
			{
				scene: "reception", speaker: "Atendente", mood: "curious",
				speech: "Where are you from?", reply: "I'm from Brazil.", replySpeaker: "Você",
				cue: "Where … from → origem",
				caption: "«Where» + «from» pede país ou cidade. Repare que a resposta também começa com «I'm», mas traz «from»!",
			},
			{
				scene: "work", speaker: "Atendente", mood: "thinking",
				speech: "What do you do?", reply: "I'm a student.", replySpeaker: "Você",
				cue: "do you do → trabalho/ocupação",
				caption: "«What do you do?» pergunta com o que você trabalha ou estuda no dia a dia.",
			},
			{
				scene: "home", speaker: "Atendente", mood: "happy",
				speech: "Do you have a big family?", reply: "Yes, I have two sisters!", replySpeaker: "Você",
				cue: "family → pergunta sobre família",
				caption: "A pista «family» muda o assunto para parentes. Um «Yes» ou «No» curto já ajuda a responder.",
			},
		],
	};
	if (id === "en.writing.a1.forms") return {
		kind: "comic", title: "Preenchendo sua ficha no curso", language: "en-US",
		source: "British Council · A1 Writing: Filling in a form (adaptado).",
		panels: [
			{
				scene: "reception", speaker: "Atendente", mood: "friendly",
				speech: "First name and last name, please.",
				cue: "First name = nome · Last name = sobrenome",
				caption: "Na ficha em inglês, o primeiro nome e o sobrenome ficam em campos separados.",
			},
			{
				scene: "reception", speaker: "Você", mood: "thinking",
				speech: "Country: Brazil. City: Recife.",
				cue: "Country = país · City = cidade",
				caption: "Escreva o país e a cidade sem precisar formar uma frase inteira — formulários pedem dados diretos.",
			},
			{
				scene: "classroom", speaker: "Atendente", mood: "happy",
				speech: "Great! You're all set for class!",
				cue: "Conferência final dos dados",
				caption: "Antes de entregar, confira a grafia do nome, e-mail e telefone letra por letra.",
			},
		],
	};
	if (id === "ee.dc.laws.dividers") return { kind: "divider" };
	if (id === "ee.ac.transients2.rlc-series-natural") return { kind: "falstad", experiment: "rlc" };
	if (id === "ee.analog.diodes.rectifiers") return { kind: "falstad", experiment: "rectifier" };
	if (id === "ee.dc.basics.ohms-law" || id.startsWith("ee.dc.basics.ohms-law.")) return { kind: "circuit" };
	if (["ee.math.algebra.sci-notation", "ee.math.algebra.sci-notation.powers-of-ten", "ee.math.algebra.sci-notation.si-prefixes"].includes(id)) return { kind: "notation" };
	if (id === "en.grammar.a2.past-continuous" || id.startsWith("en.grammar.a2.past-continuous.")) return { kind: "timeline" };
}

const number = new Intl.NumberFormat("pt-BR", { maximumSignificantDigits: 4 });
const superscript = "⁰¹²³⁴⁵⁶⁷⁸⁹";
export function currentReadings(volts: number, kiloOhms: number, closed: boolean) {
	const milliamps = closed ? volts / kiloOhms : 0;
	const amps = milliamps / 1000;
	const [coefficient, exponent] = amps.toExponential(3).split("e");
	const power = String(Number(exponent)).replace(/[-0-9]/g, c => c === "-" ? "⁻" : superscript[Number(c)]!);
	return {
		decimal: number.format(amps) + " A",
		scientific: amps ? number.format(Number(coefficient)) + " × 10" + power + " A" : "0 A",
		si: number.format(milliamps) + " mA",
	};
}
