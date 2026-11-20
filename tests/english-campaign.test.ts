import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { englishFinale } from "../src/core/study/english-campaign.ts";
import { lessonResources } from "../src/core/study/map.ts";

it("walks the six English chapters against the installed prerequisite graph and serves their lesson materials", async t => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-english-campaign-"));
	process.env.LH_DATA_DIR = root;
	process.env.LH_AUTH_FILE = path.join(root, "auth.json");
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const { switchStudyDomain, studyToday, studyMap, studyDomains, loadCurriculum } = await import("../src/server/study.ts");
	const { appendStudyEvent } = await import("../src/server/study-log.ts");
	const { studyMapLesson } = await import("../src/server/study-materials.ts");
	switchStudyDomain("english");
	const { view, snapshot } = loadCurriculum("english", studyDomains().readManifest("english")!)!;
	const chapters = studyToday().chapters!;
	assert.deepEqual(chapters.map(c => c.level), ["A1", "A2", "B1", "B2", "C1", "C2"]);
	const passed = new Set<string>();
	let seq = 0;
	const goal = chapters.at(-1)!.entry;
	studyDomains().updateProfile("english", p => ({ ...p, goal: { text: "Debater em inglês", targetNodeIds: [goal] } }));
	assert.equal(studyToday().next?.nodeId, goal);
	assert.equal(studyToday().campaignGoal, "Debater em inglês");
	studyDomains().updateProfile("english", p => ({ ...p, goal: { text: "", targetNodeIds: [] } }));
	for (const chapter of chapters) {
		const today = studyToday();
		assert.equal(today.next?.nodeId, chapter.entry);
		assert.equal(today.next?.estMinutes, chapter.entryMinutes);
		assert.equal(today.review, undefined);
		assert.ok(englishFinale(chapter.finale));
		for (const id of [chapter.entry, chapter.finale]) {
			const lesson = await studyMapLesson("english", id, true);
			if (id === chapter.entry) assert.deepEqual(lesson.missing, []);
			assert.deepEqual(lessonResources(lesson.materials).map(m => m.kind), ["book", "video"]);
			if (id === "en.speaking.a1.greetings") assert.ok(lessonResources(lesson.materials)[0]?.url.endsWith("#page=5"));
			for (const kind of ["book", "video"]) assert.ok(lesson.materials.some(m => m.kind === kind && m.nodes.includes(id) && m.part && m.url.startsWith("https://")));
		}
		const stageIds = view.ids.filter(id => {
			const level = snapshot.items[id]!.level;
			return view.nodes.get(id)!.isLeaf && level.scheme === "cefr" && level.cefr === chapter.level;
		});
		// Only earlier bands are credited. Evaluate every OR-of-AND requirement,
		// including container milestones. An impossible same-band route fails here.
		for (const id of view.ids) {
			const node = view.nodes.get(id)!;
			if (node.isLeaf && !stageIds.includes(id)) continue;
			if (!node.clauses.length || node.clauses.some(clause => clause.every(key => passed.has(key)))) passed.add(id);
		}
		assert.equal(stageIds.filter(id => passed.has(id)).length, chapter.total);
		assert.ok(stageIds.includes(chapter.finale));
		if (chapter.level === "A1") {
			appendStudyEvent("english", { kind: "exposure", id: "guided", seq: ++seq, domainId: "english", nodeId: chapter.entry,
				at: new Date().toISOString(), sessionId: "campaign", source: "ai_lesson", minutes: 15 });
			appendStudyEvent("english", { kind: "exposure", id: "detour", seq: ++seq, domainId: "english", nodeId: goal, exploratory: true,
				at: new Date().toISOString(), sessionId: "free", source: "ai_lesson", minutes: 15 });
			assert.equal(studyToday().next?.nodeId, "en.listening.a1.personal-info");
			assert.equal(studyMap().position, chapter.entry);
		}
		appendStudyEvent("english", { kind: "diagnostic", id: "fixture-" + chapter.level, seq: ++seq, domainId: "english",
			at: new Date().toISOString(), estimates: stageIds.map(nodeId => ({ nodeId, p: 0.9 })) });
	}
	const finished = studyToday();
	assert.equal(finished.chapters!.reduce((n, c) => n + c.known, 0), studyMap().nodes.filter(n => n.leaf).length);
	assert.equal(finished.progress.mastered, 0);
});
