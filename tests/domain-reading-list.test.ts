import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import type { CurriculumSeedFile } from "../src/core/curriculum/types.ts";

it("links catalog titles to their own region, keeps a region usable offline and shares the shelf with its lessons", async t => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "trilha-shelf-"));
	process.env.LH_DATA_DIR = root;
	process.env.LH_AUTH_FILE = path.join(root, "auth.json");
	delete process.env.YOUTUBE_API_KEY;
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const { attachRegionalSources } = await import("../src/server/domain-reading-list.ts");
	const { installStudyDomain } = await import("../src/server/install-study-domain.ts");
	const { switchStudyDomain } = await import("../src/server/study.ts");
	const { studyMapLesson } = await import("../src/server/study-materials.ts");
	const seed = JSON.parse(fs.readFileSync("examples/study-domain/map-reading/00-map.json", "utf8")) as CurriculumSeedFile;
	seed.sources = [];
	for (const item of seed.items) item.anchors = [];
	const unit = seed.items.find(item => item.kind === "unit")!;
	const region = { id: unit.id, title: "Curvas de nível", bookQuery: "topographic maps", videoQuery: "topographic maps" };
	const signal = new AbortController().signal;
	await attachRegionalSources(seed, [region], signal, undefined, async () => { throw new Error("offline"); });
	assert.equal(seed.sources.length, 0);
	await attachRegionalSources(seed, [region], signal, undefined, async url => {
		if (url.startsWith("https://openlibrary.org/search.json?")) return Response.json({ docs: [{ key: "/works/OL22W", title: "Topographic maps" }] });
		if (url.startsWith("https://openlibrary.org/works/OL22W/editions.json")) return Response.json({ entries: [{ table_of_contents: [{ title: "Reading topographic maps", pagenum: "17" }] }] });
		if (url.startsWith("https://www.youtube.com/results?")) return new Response('<script>var ytInitialData = {"contents":{"videoRenderer":{"videoId":"abcdefghijk","title":{"runs":[{"text":"Topographic maps for hikers"}]}}}};</script>');
		throw new Error("Unexpected URL");
	});
	assert.deepEqual(seed.sources.map(s => s.kind), ["book", "video"]);
	assert.equal(unit.anchors?.length, 2);
	assert.ok(unit.anchors?.some(a => a.ref === "Reading topographic maps · p. 17"));
	assert.ok(seed.sources.every(s => s.usage === "reference"));
	installStudyDomain([seed]);
	switchStudyDomain(seed.domainId);
	const lesson = await studyMapLesson(seed.domainId, "mp.terrain.contours.height", true);
	assert.equal(lesson.materials.length, 2);
	assert.equal(lesson.excerpt, "");
});

it("distinguishes contour intervals, map scale and elevation profiles on a previously empty regional shelf", async () => {
	const { findRegionalSource } = await import("../src/server/domain-reading-list.ts");
	const signal = new AbortController().signal;
	const offline = async () => { throw new Error("offline"); };
	for (const [title, expected] of [
		["Curvas de nível e equidistância", "Contour Lines"], ["Escala e distância", "Map Scale"],
		["Perfis e pontos críticos do percurso", "Topographic Profiles"],
	] as const) {
		const region = { id: "region", title, bookQuery: title, videoQuery: title };
		const book = await findRegionalSource("subject", region, "book", signal, offline, "Topographic maps");
		const video = await findRegionalSource("subject", region, "video", signal, offline, "Topographic maps");
		assert.equal(book?.ref, expected);
		assert.match(video?.source.url ?? "", /^https:\/\/www\.youtube\.com\/watch\?v=/u);
	}
	const measurement = { id: "measurement", title: "Medição de trechos na carta", objective: "Usar a escala para medir trechos.",
		bookQuery: "medição de trechos", videoQuery: "medição de trechos" };
	const section = await findRegionalSource("subject", measurement, "book", signal, offline, "Topographic maps");
	assert.equal(section?.ref, "Map Scale");
});
