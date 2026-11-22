import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";

const temp = mkdtempSync(path.join(os.tmpdir(), "lh-study-map-"));
process.env.LH_DATA_DIR = temp;
process.env.LH_AUTH_FILE = path.join(temp, "auth.json");
process.env.YOUTUBE_API_KEY = "fixture-key-for-discovery";
const { switchStudyDomain, studyMap, setStudyMapStyle } = await import("../src/server/study.ts");
const { attachStudyMaterials, downloadRegionalBook, readRegionMaterials, studyMapLesson } = await import("../src/server/study-materials.ts");
const { mapVideoItem, YoutubeDataProvider } = await import("../src/server/resources/youtube-data.ts");
const { layoutSkillMap } = await import("../src/core/study/map-layout.ts");
const { SKILL_MAP_STYLES, isSkillMapStyle, pickRandomSkillMapStyle } = await import("../src/core/study/map-style.ts");
const { appendStudyEvent } = await import("../src/server/study-log.ts");
after(() => rmSync(temp, { recursive: true, force: true }));

it("projects all regions and reuses chapter-specific material across regions in the same domain", async t => {
	switchStudyDomain("electronics");
	const map = studyMap();
	const nodes = new Map(map.nodes.map(n => [n.id,n]));
	assert.equal(map.nodes.filter(n => n.kind === "unit").length, 131);
	assert.ok(map.nodes.filter(n => n.leaf).every(n => n.region && nodes.get(n.region)?.kind === "unit"));
	assert.equal(nodes.get(map.next!)?.state, "available");
	const first = "ee.math.algebra.sci-notation.powers-of-ten";
	assert.ok((await readRegionMaterials("electronics",first)).references.some(ref => ref.title.includes("OpenStax")));
	const law = "ee.dc.basics.ohms-law";
	const dc = (await studyMapLesson("electronics",law)).materials.find(m => m.bookKey === "liec-dc" && !m.suggested)!;
	const math = (await studyMapLesson("electronics",first)).materials.find(m => m.bookKey === dc.bookKey && !m.suggested)!;
	assert.notEqual(dc.url,math.url);
	await assert.rejects(downloadRegionalBook("electronics",first,"unrelated"),/indisponível/);
	const { items } = await attachStudyMaterials("electronics", "ee.dc.laws.kcl", "Lei de Kirchhoff", new AbortController().signal);
	const complete = items.find(item => item.kind === "book");
	assert.ok(complete && complete.url.endsWith(".pdf"));
	assert.ok(complete.sectionUrl && complete.sectionUrl !== complete.url);
	assert.ok(items.some(item => item.kind === "video" && item.url.includes("ALvobeJOrr4")));

	const result = mapVideoItem({ id: "AbCdEfG1234", snippet: { title: nodes.get(law)!.title, defaultAudioLanguage: "pt", description:
		`0:00 Introdução\n1:15 ${nodes.get(first)!.title}\n3:20 ${nodes.get(law)!.title}` }, contentDetails: { duration: "PT12M" } }, new Date().toISOString())!;
	const search = t.mock.method(YoutubeDataProvider.prototype,"search", async () => [result]);
	const same = await Promise.all([readRegionMaterials("electronics",law,"video"),readRegionMaterials("electronics",law,"video")]);
	assert.ok(same.every(r => r.materials.some(m => m.url.endsWith("&t=200"))));
	assert.equal(search.mock.callCount(),1);
	assert.ok((await studyMapLesson("electronics",first)).materials.some(m => m.url.endsWith("&t=75") && m.suggested));
	await readRegionMaterials("electronics",law,"video");
	assert.equal(search.mock.callCount(),1);

	switchStudyDomain("english");
	const english = studyMap();
	assert.equal(english.nodes.filter(n => n.kind === "unit").length,71);
	const ipa = (await studyMapLesson("english","en.pron.foundations.ipa-intro")).materials;
	assert.ok(ipa.some(m => m.url.includes("/essentialsoflinguistics2/")));
	assert.ok(ipa.every(m => !m.url.includes("ibiblio") && !m.url.includes("AbCdEfG1234")));
	await assert.rejects(readRegionMaterials("electronics",law), /domínio ativo mudou/);
});

it("keeps the whole domain in the atlas as real evidence changes the learner's path", () => {
	switchStudyDomain("electronics");
	const intro = "ee.digital.numbers.number-systems";
	const logic = "ee.digital.boolean.boolean-algebra";
	const first = studyMap();
	const at = new Date().toISOString();
	assert.equal(first.nodes.find(n => n.id === logic)?.state, "locked");
	appendStudyEvent("electronics", { kind: "exposure", id: "bits-lesson", seq: 1, at, domainId: "electronics",
		sessionId: "map-test", nodeId: intro, source: "ai_lesson", minutes: 15 });
	assert.ok(studyMap().nodes.find(n => n.id === intro)?.inProgress);
	appendStudyEvent("electronics", { kind: "evidence", evidence: { id: "bits-quiz", seq: 2, at, domainId: "electronics",
		sessionId: "map-test", itemId: "bits-1", itemFamily: "bits", nodes: [{ nodeId: intro, primary: true, q: 1 }],
		format: "numeric", level: 3, grade: 3, summative: true, hints: 0, graderConfidence: 1, minutesSinceExposure: 60 } });
	const after = studyMap();
	const bits = after.nodes.find(n => n.id === intro)!;
	assert.ok(bits.completed && !bits.inProgress);
	assert.ok(after.nodes.find(n => n.id === bits.parent)?.inProgress);
	const original = layoutSkillMap(first.nodes);
	const layout = layoutSkillMap(after.nodes);
	assert.equal(layout.points.size, 1010);
	assert.equal(new Set([...layout.points.values()].map(p => p.x + "," + p.y)).size, layout.points.size);
	assert.deepEqual(layout.points, original.points);
	assert.ok(layout.edges.some(e => e.kind === "prerequisite" && e.from.id === intro && e.to.id === logic));
	switchStudyDomain("english");
	const english = studyMap();
	assert.equal(layoutSkillMap(english.nodes).points.size, 925);
	assert.ok(english.nodes.every(n => !n.completed && !n.inProgress));
});

it("lays out all 5 tree styles cleanly without overlaps and defaults new domains to atlas", () => {
	switchStudyDomain("english");
	const english = studyMap();
	assert.equal(english.mapStyle, "atlas", "new domain defaults to atlas map style");
	assert.ok(isSkillMapStyle(english.mapStyle), "new domain receives a valid default map style");
	assert.equal(studyMap().mapStyle, english.mapStyle, "default style stays stable across reads");

	for (const style of SKILL_MAP_STYLES) {
		const layout = layoutSkillMap(english.nodes, style);
		assert.equal(layout.style, style);
		assert.equal(layout.points.size, 925, `${style} keeps all 925 nodes`);
		assert.equal(new Set([...layout.points.values()].map(p => p.x + "," + p.y)).size, 925, `${style} has unique coordinates`);
		assert.ok(layout.width > 400 && layout.height > 300, `${style} has positive canvas bounds`);
		for (const pt of layout.points.values()) {
			assert.ok(Number.isFinite(pt.x) && Number.isFinite(pt.y), `${style} finite coords for ${pt.id}`);
		}
		if (style === "constellation") {
			assert.ok(layout.wheels.length >= 60 && layout.rings.length >= 3);
		} else if (style === "hextech") {
			assert.ok(layout.gears.length >= 10);
		} else if (style === "citadel") {
			assert.ok(layout.hexClusters.length >= 9);
		} else if (style === "clarity") {
			assert.ok(layout.lanes.length >= 9);
		}
	}

	// Deterministic random picker covers every style
	const picked = new Set([0, 0.25, 0.45, 0.65, 0.9].map(v => pickRandomSkillMapStyle(() => v)));
	assert.equal(picked.size, SKILL_MAP_STYLES.length);

	// Switching style persists per domain without affecting electronics
	const updated = setStudyMapStyle("english", "clarity");
	assert.equal(updated.mapStyle, "clarity");
	assert.equal(studyMap().mapStyle, "clarity");
	assert.throws(() => setStudyMapStyle("english", "invalid-style"));

	switchStudyDomain("electronics");
	const electronics = studyMap();
	assert.equal(electronics.mapStyle, "atlas");
	assert.ok(isSkillMapStyle(electronics.mapStyle));
	for (const style of SKILL_MAP_STYLES) {
		const layout = layoutSkillMap(electronics.nodes, style);
		assert.equal(layout.points.size, 1010, `${style} keeps all 1010 electronics nodes`);
		assert.equal(new Set([...layout.points.values()].map(p => p.x + "," + p.y)).size, 1010, `${style} electronics unique coords`);
	}
});
