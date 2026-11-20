/** Deterministic integration benchmark. The scripted author supplies known DAGs and allocations. */
import assert from "node:assert/strict";
import { createAssistantMessageEventStream, createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { campaignHours, campaignPaces, type CampaignPace } from "../src/core/study/creation.ts";
import { validate } from "../src/core/curriculum/invariants.ts";
import { applySeedFiles } from "../src/core/curriculum/ledger.ts";
import { generateDomainCurriculum } from "../src/server/domain-generation.ts";
import { dividerLab } from "../src/core/divider-lab.ts";
import { foldEvents } from "../src/core/learner/fold.ts";
import { DEFAULT_LEARNER_PARAMS } from "../src/core/learner/params.ts";
import { chain, day, evidence } from "../tests/learner-fixtures.ts";

const title = (label: string) => ({ pt: label, en: label });
async function measure(pace: CampaignPace, stages: number, width: number, skills: number) {
	const n = stages * width;
	const regions = Array.from({ length: n }, (_, i) => ({ title: title("Região " + (i + 1)), exit: "Resolver um problema novo na região " + i,
		requires: i < width ? [] : [i - width + 1], bookQuery: "map reading", videoQuery: "terrain profile" }));
	const areas = Array.from({ length: stages }, (_, i) => ({ title: title("Etapa " + i), goal: "Comparar trajetos na etapa " + i,
		regions: regions.slice(i * width, (i + 1) * width) }));
	const work = Math.round((campaignHours(pace) / n - skills / 3) * 2);
	const outputs: unknown[] = [{ title: title("Topografia"), goal: "Avaliar trajetos em terreno desconhecido.", areas }];
	for (const r of regions) outputs.push({
		skills: Array.from({ length: skills }, (_, i) => ({ title: title("Competência " + i), objective: "Comparar dois perfis de terreno.", assessment: "Acertar o sentido do desnível.",
			activity: "Calcular a diferença entre cotas.", bloom: "apply", minutes: 20, requires: i < 2 ? [] : i === 2 ? [1, 2] : [i],
			...(i === skills - 1 && work >= 2 && { practice: { targetHours: work / 2, sessions: work, minutesPerSession: 30,
				variation: "Alterne cartas e justifique a escala usada em cada representação.", exitCriterion: "Comparar duas rotas de forma independente." } }) })),
		reviews: [1, 2].map(i => ({ prompt: `Na carta de ${r.title.pt}, a trilha sobe de 100 a ${100 + 12 * i} m. Responda apenas com o ganho em metros.`,
			answers: [String(12 * i)], explanation: `Subtraindo a cota inicial da final, o ganho é ${12 * i} m.` })),
	}, { issues: [] });
	const start = performance.now();
	const authored = await generateDomainCurriculum({ topic: "Traçar trajetos", domainId: "campaign", prefix: "cp", pace }, async () => ({
		model: createFauxCore({}).getModel(), streamFn: () => {
			assert.ok(outputs.length);
			const reply = createAssistantMessageEventStream();
			reply.end(fauxAssistantMessage(JSON.stringify(outputs.shift())));
			return reply;
		},
	}));
	const built = applySeedFiles([authored.seed], { createdAt: "2026-01-01" });
	assert.ok(built.ok);
	assert.equal(outputs.length, 0);
	assert.equal(authored.reviews.length, n * 2);
	const { snapshot } = built;
	const controlErrors = validate(snapshot);
	assert.deepEqual(controlErrors, []);
	const constructionMs = Math.round(performance.now() - start);
	let detected = 0;
	let baseline = 0;
	let mutations = 0;
	let validAlternatives = 0;
	function evaluate(id: string, route: string[][]) {
		const altered = structuredClone(snapshot);
		altered.items[id]!.clauses = route;
		if (validate(altered).length) detected++;
		altered.items.cp!.tags = [];
		if (validate(altered).length) baseline++;
		mutations++;
	}
	for (const [i, r] of authored.regions.entries()) {
		evaluate(r.id + ".s" + skills, [[r.id + ".s1"]]);
		evaluate(r.id + ".s4", [[r.id + ".s3"], [r.id + ".s1"]]);
		if (i >= width * 2) {
			const original = snapshot.items[r.id]!.clauses;
			evaluate(r.id, [...original, [authored.regions[i % width]!.id + ".s" + skills]]);
		}
		if (i >= width) {
			const valid = structuredClone(snapshot);
			const neighbor = Math.floor(i / width - 1) * width + (i + 1) % width;
			valid.items[r.id]!.clauses.push([authored.regions[neighbor]!.id + ".s" + skills]);
			assert.deepEqual(validate(valid), []);
			validAlternatives++;
		}
	}
	assert.equal(detected, mutations);
	assert.equal(baseline, 0);
	console.log(JSON.stringify({ pace, stages, regions: n, skills: n * skills, totalNodes: authored.seed.items.length,
		estimatedHours: +(n * (skills / 3 + Math.max(0, work / 2))).toFixed(1), heldOut: authored.reviews.length,
		validAlternatives, validRejected: controlErrors.length, mutations, detected, baseline, constructionMs }));
}

await measure("focused", 4, 2, campaignPaces.focused.minSkills);
await measure("semester", 4, 4, 8);
await measure("extended", 8, 4, 14);
let cases = 0;
for (const v of [0, 0.1, 3.3, 12, 24]) for (const r1 of [1, 11, 4700, 1e7]) for (const r2 of [1, 39, 2200, 1e7]) {
	const { milliamps, voltsOut } = dividerLab(v, r1, r2);
	assert.ok(Math.abs((v - voltsOut) / r1 - milliamps / 1000) <= 1e-12);
	assert.ok(Math.abs(voltsOut / r2 - milliamps / 1000) <= 1e-12);
	cases++;
}
console.log(JSON.stringify({ currentBalanceCases: cases }));

// Matched traces vary one condition at a time. Each ends with six correct answers.
// The positive control is independent spaced production in two task families.
const graph = chain(1);
for (const cohort of ["spaced", "crammed", "hinted", "recognition", "self", "same-family"]) {
	let mastered = 0;
	for (let k = 0; k < 24; k++) {
		const events = Array.from({ length: 6 }, (_, i) => evidence({ nodeId: "n0", seq: i + 1, grade: 3,
			at: day(k + i * (cohort === "crammed" ? 1 / 1440 : 1 + k / 24)), hints: cohort === "hinted" ? 1 : 0,
			format: cohort === "recognition" ? "mcq" : "short",
			family: cohort === "self" ? "n0#self" : "task-" + (cohort === "same-family" ? 0 : i % 2),
			minutes: cohort === "crammed" || i === 0 ? 1 : 1440 }));
		if (foldEvents(null, events, graph, DEFAULT_LEARNER_PARAMS).nodes.n0?.masteredAt) mastered++;
	}
	assert.equal(mastered, cohort === "spaced" ? 24 : 0);
	console.log(JSON.stringify({ cohort, traces: 24, mastered }));
}
