import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const lessonTitle = Type.String({ minLength: 1, maxLength: 100 });
const lessonSteps = Type.Array(Type.Object({
	illustration: Type.Optional(Type.Union([Type.Literal("listen"), Type.Literal("say"), Type.Literal("write"), Type.Literal("order"),
		Type.Literal("observe"), Type.Literal("measure"), Type.Literal("compare")])),
	label: Type.String({ minLength: 1, maxLength: 60 }),
	detail: Type.String({ minLength: 1, maxLength: 400 }),
}), { minItems: 2, maxItems: 6 });
const lessonSource = Type.String({ minLength: 1, maxLength: 300, description: "Work and section, or a verified https URL from lesson materials." });
const presentation = Type.Optional(Type.Union([Type.Literal("inline"), Type.Literal("panel")], {
	description: "Use inline for a brief comparison or a few steps between paragraphs. Use panel for a longer exploration.",
}));

export const bookActivitySchema = Type.Object({
	kind: Type.Union([Type.Literal("sequence"), Type.Literal("comparison"), Type.Literal("diagram")]),
	title: lessonTitle, steps: lessonSteps, source: lessonSource, presentation,
});

export const activitySchema = Type.Object({
	kind: Type.Union([
		Type.Literal("circuit"), Type.Literal("divider"), Type.Literal("falstad"), Type.Literal("pronunciation"), Type.Literal("notation"), Type.Literal("timeline"),
		Type.Literal("sequence"), Type.Literal("comparison"), Type.Literal("diagram"),
	]),
	title: Type.Optional(lessonTitle), steps: Type.Optional(lessonSteps), source: Type.Optional(lessonSource), presentation,
	voice: Type.Optional(Type.Object({
		language: Type.String({ pattern: "^[a-z]{2,3}(-[A-Za-z]{2,8}){0,2}$" }),
		sample: Type.String({ minLength: 1, maxLength: 160 }),
		mode: Type.Union([Type.Literal("phrase"), Type.Literal("spelling")]),
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
	if (["sequence", "comparison", "diagram"].includes(raw.kind)) {
		if (!raw.title?.trim() || !raw.source?.trim() || !raw.steps?.every(step => step.label.trim() && step.detail.trim())) return;
		if (raw.kind === "comparison" && new Set(raw.steps.map(step => step.label.trim())).size !== raw.steps.length) return;
	}
	return raw;
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
		kind: "sequence", presentation: "inline", title: "Sua vez no diálogo",
		source: "VOA · Let's Learn English, lição 1, Welcome! Diálogo de prática adaptado.",
		steps: [
			{ label: "Cumprimente", detail: "Hi! Abre a conversa. Em uma primeira reunião de trabalho, experimente Hello!" },
			{ label: "Apresente-se", detail: "I'm Jo. Troque Jo pelo nome que você quer usar." },
			{ label: "Passe a vez", detail: "And you? Ouça a apresentação da outra pessoa. Depois, tente o diálogo sem olhar." },
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
