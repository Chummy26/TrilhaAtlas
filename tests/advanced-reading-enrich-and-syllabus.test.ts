import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
	buildMissionPedagogyDirective,
	isAdvancedReadingRequiredNode,
} from "../src/core/study/tutor-pedagogy.ts";
import { scoreEducationalReputation } from "../src/core/resources/reputation.ts";
import { buildStudySyllabus } from "../src/core/study/syllabus.ts";
import { studyCampaign } from "../src/core/study/campaign.ts";
import { structuralState } from "../src/core/learner/kst.ts";
import type { CurriculumSeedFile } from "../src/core/curriculum/types.ts";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "trilha-adv-ementa-"));
process.env.LH_DATA_DIR = sandbox;
process.env.LH_AUTH_FILE = path.join(sandbox, "auth.json");
delete process.env.YOUTUBE_API_KEY;
after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

describe("mandatory quality reading strictly in advanced nodes", () => {
	it("requires textbook reading on advanced/research nodes but keeps beginner/routine lessons lightweight", () => {
		assert.equal(isAdvancedReadingRequiredNode({ level: { scheme: "cefr", cefr: "A1" } }), false);
		assert.equal(isAdvancedReadingRequiredNode({ level: { scheme: "cefr", cefr: "B1" } }), false);
		assert.equal(isAdvancedReadingRequiredNode({ level: { scheme: "ee", band: 0 } }), false);
		assert.equal(isAdvancedReadingRequiredNode({ level: { scheme: "ee", band: 1 } }), false);

		assert.equal(isAdvancedReadingRequiredNode({ level: { scheme: "cefr", cefr: "C1" } }), true);
		assert.equal(isAdvancedReadingRequiredNode({ level: { scheme: "cefr", cefr: "C2" } }), true);
		assert.equal(isAdvancedReadingRequiredNode({ level: { scheme: "ee", band: 3 } }), true);
		assert.equal(isAdvancedReadingRequiredNode({ level: { scheme: "generic", band: 2 }, tags: ["capstone"] }), true);

		const routineDir = buildMissionPedagogyDirective([], {
			title: "Cumprimentos A1",
			objectives: ["Apresentar-se em inglês."],
			requiresQualityReading: false,
		});
		assert.ok(!routineDir.includes("MANDATORY ADVANCED READING"), "never forces textbook reading on routine A1 lessons");

		const advDir = buildMissionPedagogyDirective([], {
			title: "Projeto de amplificador CMOS em banda larga",
			objectives: ["Dimensionar compensação Miller e defender margem de fase."],
			isAdvancedDefense: true,
			requiresQualityReading: true,
			levelLabel: "Avançado",
		});
		assert.match(advDir, /MANDATORY ADVANCED READING/);
		assert.match(advDir, /attach_study_materials/);
	});
});

describe("educational reputation scoring and tree/region enrichment", () => {
	it("ranks authoritative open textbooks and university sources above generic links", () => {
		const openstax = scoreEducationalReputation({
			title: "OpenStax College Physics 2e",
			url: "https://openstax.org/books/college-physics-2e/pages/20-2-ohms-law",
			fullBookUrl: "https://openstax.org/downloads/college-physics-2e.pdf",
		});
		const mit = scoreEducationalReputation({
			title: "MIT OCW 6.002 Circuits and Electronics Lecture 1",
			url: "https://ocw.mit.edu/courses/6-002-circuits-and-electronics-spring-2007/",
		});
		const generic = scoreEducationalReputation({
			title: "Random blog notes on circuits",
			url: "https://example.org/my-notes",
		});
		assert.equal(openstax.tier, "reference");
		assert.ok(openstax.badge?.includes("OpenStax"));
		assert.equal(mit.tier, "reference");
		assert.ok(openstax.score > generic.score);
		assert.ok(mit.score > generic.score);
		assert.equal(generic.tier, "standard");
	});

	it("expands and upgrades region materials via enrichRegionMaterials and persists them", async () => {
		const { installStudyDomain } = await import("../src/server/install-study-domain.ts");
		const { switchStudyDomain } = await import("../src/server/study.ts");
		const { enrichRegionMaterials, readRegionMaterials } = await import("../src/server/study-materials.ts");

		const seed = JSON.parse(fs.readFileSync("examples/study-domain/map-reading/00-map.json", "utf8")) as CurriculumSeedFile;
		seed.domainId = "physics-optics";
		seed.sources = [];
		for (const item of seed.items) {
			item.anchors = [];
			if (item.kind === "domain") item.title = { pt: "Óptica Física", en: "Wave Optics" };
			if (item.kind === "unit") item.title = { pt: "Interferência e Difração", en: "Interference and Diffraction" };
		}
		installStudyDomain([seed]);
		switchStudyDomain(seed.domainId);
		const unit = seed.items.find(item => item.kind === "unit")!;

		const enriched = await enrichRegionMaterials(seed.domainId, unit.id, async url => {
			if (url.startsWith("https://openlibrary.org/search.json?")) {
				return Response.json({
					docs: [
						{ key: "/works/OL1W", title: "Random Wave Notes" },
						{ key: "/works/OL2W", title: "MIT OpenCourseWare Interference and Diffraction Textbook" },
					],
				});
			}
			if (url.startsWith("https://openlibrary.org/works/OL2W/editions.json")) {
				return Response.json({ entries: [{ table_of_contents: [{ title: "Interference and Diffraction", pagenum: "14" }] }] });
			}
			if (url.startsWith("https://www.youtube.com/results?")) {
				return new Response('<script>var ytInitialData = {"contents":{"itemSectionRenderer":{"contents":[{"videoRenderer":{"videoId":"univesp1234","title":{"runs":[{"text":"Univesp Aula 01 Interferência e Difração Óptica"}]}}},{"videoRenderer":{"videoId":"khanacad567","title":{"runs":[{"text":"Khan Academy Interference and Diffraction"}]}}}]}}};</script>');
			}
			throw new Error("offline mock");
		});

		assert.match(enriched.message ?? "", /Acervo ampliado e qualificado/);
		assert.ok(enriched.materials.some(m => m.kind === "book" && m.title.includes("MIT OpenCourseWare")));
		assert.ok(enriched.materials.some(m => m.kind === "video" && m.title.includes("Univesp")));
		const topVideo = enriched.materials.find(m => m.kind === "video");
		assert.ok(topVideo?.reputationBadge, "attaches educational reputation badge to university lectures");

		// Enriched items stay persisted on subsequent reads.
		const reread = await readRegionMaterials(seed.domainId, unit.id);
		assert.ok(reread.materials.some(m => m.title.includes("MIT OpenCourseWare")));
	});
});

describe("accurate /ementa lesson hours and day-1 pace forecast guard", () => {
	it("computes realistic lesson hours for 2 completed English A1 skills (~0.7 h, never 5.5 h) and guards 1-day pace", async () => {
		const { listStudyDomains, loadCurriculum, studyDomains, switchStudyDomain } = await import("../src/server/study.ts");
		listStudyDomains();
		switchStudyDomain("english");
		const manifest = studyDomains().readManifest("english")!;
		const cur = loadCurriculum("english", manifest)!;
		const completed = new Set(["en.speaking.a1.greetings", "en.listening.a1.personal-info"]);
		const st = structuralState({ nodes: {} }, cur.view);
		const campaign = studyCampaign(cur.snapshot, cur.view, completed);

		// Day 1: learner spent 45 min active today (1 active day in 14d), completing 2 A1 lessons.
		const day1Syllabus = buildStudySyllabus({
			snapshot: cur.snapshot,
			graph: cur.view,
			learner: { schemaVersion: 1, domainId: "english", seq: 0, nodes: {}, theta: 0, thetaN: 0, speed: 1, updatedAt: "2026-11-21T00:00:00Z" },
			campaign,
			known: completed,
			available: new Set(st.frontier),
			at: "2026-11-21T00:00:00Z",
			recentMinutes14d: 150, // 1.25 h/wk if naively divided by 2 weeks
			activeDays14d: 1,
			totalStudiedMinutes: 45,
			dailyBudgetMin: 120,
		});

		assert.equal(day1Syllabus.completedLessons, 2);
		assert.ok(
			day1Syllabus.completedLessonHours >= 0.5 && day1Syllabus.completedLessonHours <= 1.0,
			`Expected ~0.67h for 2 A1 lessons, got ${day1Syllabus.completedLessonHours}h`,
		);
		assert.equal(day1Syllabus.studiedHours, 0.75, "records 45 min real studied time accurately");
		assert.equal(day1Syllabus.schedule.paceSource, "planned", "does not dilute 1 active day across 14 days");

		// After 5 active days with real steady study, observed pace takes over.
		const steadySyllabus = buildStudySyllabus({
			snapshot: cur.snapshot,
			graph: cur.view,
			learner: { schemaVersion: 1, domainId: "english", seq: 0, nodes: {}, theta: 0, thetaN: 0, speed: 1, updatedAt: "2026-11-21T00:00:00Z" },
			campaign,
			known: completed,
			available: new Set(st.frontier),
			at: "2026-11-21T00:00:00Z",
			recentMinutes14d: 600,
			activeDays14d: 5,
			totalStudiedMinutes: 600,
			dailyBudgetMin: 120,
		});
		assert.equal(steadySyllabus.schedule.paceSource, "observed");
		assert.equal(steadySyllabus.studiedHours, 10);
	});
});
