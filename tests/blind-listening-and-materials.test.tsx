import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseLessonActivity, shouldHideVoiceText } from "../src/core/lesson-activity.ts";
import { ActivityArtifact } from "../components/study/lesson-activity.tsx";
import type { CurriculumSeedFile } from "../src/core/curriculum/types.ts";

describe("blind listening mode (ouça sem ler)", () => {
	it("never displays the spoken transcript when hideText is true", () => {
		const activity = parseLessonActivity({
			kind: "pronunciation",
			title: "Escuta da recepção",
			voice: {
				language: "en-US",
				sample: "Do you have any sisters? Are you from Boston? What do you do?",
				mode: "phrase",
				hideText: true,
			},
		});
		assert.ok(activity);
		const html = renderToStaticMarkup(
			<ActivityArtifact
				part={{ type: "tool-study_activity", toolCallId: "blind-1", state: "output-available", input: activity, output: activity }}
			/>,
		);
		assert.match(html, /data-listening-mode="blind"/);
		assert.match(html, /Modo escuta sem leitura/);
		assert.match(html, /Ouvir mais devagar/);
		assert.ok(!html.includes("Do you have any sisters?"), "must not spoil spoken text in DOM");
		assert.ok(!html.includes("Boston"), "must not spoil any fragment of spoken text");
	});

	it("auto-hides the transcript when the title asks to listen without reading even if hideText was omitted", () => {
		const activity = parseLessonActivity({
			kind: "pronunciation",
			title: "Áudio da avaliação — ouça sem ler",
			voice: {
				language: "en-US",
				sample: "Do you have any sisters? Are you from Boston? What do you do?",
				mode: "phrase",
			},
		});
		assert.ok(activity?.voice);
		assert.equal(shouldHideVoiceText(activity.voice, activity.title), true);
		const html = renderToStaticMarkup(
			<ActivityArtifact
				part={{ type: "tool-study_activity", toolCallId: "blind-2", state: "output-available", input: activity, output: activity }}
			/>,
		);
		assert.match(html, /data-listening-mode="blind"/);
		assert.ok(!html.includes("Do you have any sisters?"), "title guard blocks transcript spoiler");
	});

	it("keeps normal pronunciation practice visible unless blind mode is requested", () => {
		const activity = parseLessonActivity({
			kind: "pronunciation",
			title: "Prática de pronúncia",
			voice: { language: "en-US", sample: "Nice to meet you!", mode: "phrase" },
		});
		assert.ok(activity?.voice);
		assert.equal(shouldHideVoiceText(activity.voice, activity.title), false);
		const html = renderToStaticMarkup(
			<ActivityArtifact
				part={{ type: "tool-study_activity", toolCallId: "guided-1", state: "output-available", input: activity, output: activity }}
			/>,
		);
		assert.match(html, /data-listening-mode="guided"/);
		assert.ok(html.includes("Nice to meet you!"));
	});
});

describe("cross-section and manual per-node materials", () => {
	it("links user-supplied initial materials and book/video chapters directly onto matching child skills during tree creation", async t => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "trilha-rich-tree-"));
		process.env.LH_DATA_DIR = root;
		process.env.LH_AUTH_FILE = path.join(root, "auth.json");
		delete process.env.YOUTUBE_API_KEY;
		t.after(() => fs.rmSync(root, { recursive: true, force: true }));

		const { attachRegionalSources } = await import("../src/server/domain-reading-list.ts");
		const seed = JSON.parse(fs.readFileSync("examples/study-domain/map-reading/00-map.json", "utf8")) as CurriculumSeedFile;
		seed.sources = [];
		for (const item of seed.items) item.anchors = [];
		const unit = seed.items.find(item => item.kind === "unit")!;
		const leaves = seed.items.filter(item => item.parentId === unit.id);
		assert.ok(leaves.length >= 2);

		const region = {
			id: unit.id,
			title: unit.title.pt,
			titleEn: unit.title.en,
			bookQuery: "topographic contour maps",
			videoQuery: "topographic contour maps",
			skills: leaves.map(leaf => ({ id: leaf.id, title: leaf.title.pt, titleEn: leaf.title.en })),
		};
		const signal = new AbortController().signal;
		await attachRegionalSources(
			seed,
			[region],
			signal,
			undefined,
			async url => {
				if (url.startsWith("https://openlibrary.org/search.json?")) {
					return Response.json({ docs: [{ key: "/works/OL22W", title: "Topographic Contour Maps Complete" }] });
				}
				if (url.startsWith("https://openlibrary.org/works/OL22W/editions.json")) {
					return Response.json({
						entries: [{
							table_of_contents: [
								{ title: leaves[0]!.title.en, pagenum: "12" },
								{ title: leaves[1]!.title.en, pagenum: "24" },
							],
						}],
					});
				}
				if (url.startsWith("https://www.youtube.com/results?")) {
					return new Response('<script>var ytInitialData = {"contents":{"itemSectionRenderer":{"contents":[{"videoRenderer":{"videoId":"abcdefghijk","title":{"runs":[{"text":"Topographic Contour Maps Lesson 1"}]}}},{"videoRenderer":{"videoId":"lmnopqrstuv","title":{"runs":[{"text":"Topographic Contour Maps Practice 2"}]}}}]}}};</script>');
				}
				throw new Error("offline mock");
			},
			[
				{
					kind: "video",
					title: "Aula escolhida pelo aluno sobre " + leaves[0]!.title.pt,
					url: "https://www.youtube.com/watch?v=uservid1234",
					part: "02:30 – " + leaves[0]!.title.pt,
					regionHint: leaves[0]!.title.pt,
				},
				{
					kind: "book",
					title: "Apostila PDF do aluno",
					url: "https://example.org/apostila-curvas.pdf",
					part: "Cap. 1 · p. 5–14",
					regionHint: unit.title.pt,
				},
			],
		);

		assert.ok(seed.sources.some(s => s.url === "https://www.youtube.com/watch?v=uservid1234"), "user video preserved");
		assert.ok(seed.sources.some(s => s.url === "https://example.org/apostila-curvas.pdf"), "user PDF link preserved");
		assert.ok(seed.sources.filter(s => s.kind === "video").length >= 3, "attaches multiple complementary videos");
		assert.ok((leaves[0]!.anchors?.length ?? 0) >= 2, "child skill receives direct TOC + user anchors");
		assert.ok((leaves[1]!.anchors?.length ?? 0) >= 1, "second child skill receives its own matched TOC chapter");
	});

	it("adds, interlinks across multiple nodes, surfaces to the tutor, and removes manual node materials", async t => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "trilha-manual-mat-"));
		process.env.LH_DATA_DIR = root;
		process.env.LH_AUTH_FILE = path.join(root, "auth.json");
		t.after(() => fs.rmSync(root, { recursive: true, force: true }));

		const { installStudyDomain } = await import("../src/server/install-study-domain.ts");
		const { switchStudyDomain } = await import("../src/server/study.ts");
		const { readRegionMaterials, updateManualNodeMaterial } = await import("../src/server/study-materials.ts");

		const seed = JSON.parse(fs.readFileSync("examples/study-domain/map-reading/00-map.json", "utf8")) as CurriculumSeedFile;
		installStudyDomain([seed]);
		switchStudyDomain(seed.domainId);
		const unit = seed.items.find(item => item.kind === "unit")!;
		const leaves = seed.items.filter(item => item.parentId === unit.id);
		const nodeA = leaves[0]!.id;
		const nodeB = leaves[1]!.id;

		const addReq = new Request(`http://localhost/api/study/materials?domain=${seed.domainId}&node=${nodeA}&manual=1`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				kind: "video",
				title: "Vídeo detalhado de leitura de curvas",
				part: "04:10 – Como ler cotas e inclinação",
				url: "https://www.youtube.com/watch?v=manual12345&t=250",
				lang: "pt",
				nodes: [nodeA, nodeB],
			}),
		});
		const afterAdd = await updateManualNodeMaterial(seed.domainId, nodeA, addReq);
		const added = afterAdd.materials.find(m => m.url === "https://www.youtube.com/watch?v=manual12345&t=250");
		assert.ok(added, "manual video appears in region materials");
		assert.equal(added.manual, true);
		assert.deepEqual(added.nodes.sort(), [nodeA, nodeB].sort());
		assert.ok((afterAdd.regionNodes?.length ?? 0) >= 3, "exposes regionNodes for cross-linking UI");

		// Visible when querying the second interlinked node too.
		const fromNodeB = await readRegionMaterials(seed.domainId, nodeB);
		assert.ok(fromNodeB.materials.some(m => m.manualId === added.manualId && m.nodes.includes(nodeB)));

		// Rejects unsafe non-HTTPS URLs.
		const badReq = new Request(`http://localhost/api/study/materials?domain=${seed.domainId}&node=${nodeA}&manual=1`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				kind: "book",
				title: "Link inválido",
				part: "Cap. 1",
				url: "javascript:alert(1)",
				nodes: [nodeA],
			}),
		});
		await assert.rejects(() => updateManualNodeMaterial(seed.domainId, nodeA, badReq), /HTTPS/i);

		// Cleanly removes via DELETE.
		const delReq = new Request(
			`http://localhost/api/study/materials?domain=${seed.domainId}&node=${nodeA}&manual=1&id=${encodeURIComponent(added.manualId!)}`,
			{ method: "DELETE" },
		);
		const afterDel = await updateManualNodeMaterial(seed.domainId, nodeA, delReq);
		assert.ok(!afterDel.materials.some(m => m.manualId === added.manualId));
	});
});
