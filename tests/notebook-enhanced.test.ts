import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { foldEvents } from "../src/core/learner/fold.ts";
import { DEFAULT_LEARNER_PARAMS } from "../src/core/learner/params.ts";
import type { LearnerEvent } from "../src/core/learner/types.ts";
import {
	buildDomainNotebook,
	formatJobAidMarkdown,
	sanitizeModuleArtifactInput,
	sanitizeSavedNoteInput,
	type NotebookModuleArtifact,
	type NotebookSavedNote,
} from "../src/core/study/notebook.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-notebook-enhanced-"));
process.env.LH_DATA_DIR = root;
process.env.LH_AUTH_FILE = path.join(root, "auth.json");

const { loadCurriculum, studyDomains, switchStudyDomain, StudyError } = await import("../src/server/study.ts");
const {
	deleteStudyModuleArtifact,
	deleteStudyNotebookNote,
	saveStudyModuleArtifact,
	saveStudyNotebookNote,
	studyNotebook,
} = await import("../src/server/course.ts");

after(() => fs.rmSync(root, { recursive: true, force: true }));

describe("notebook pure core: sanitizers, job aids, saved notes, and module artifacts", () => {
	it("validates and sanitizes saved note inputs including safe URL checks", () => {
		const validManual = sanitizeSavedNoteInput({
			moduleId: "  mod.dc  ",
			excerpt: "  A soma das correntes num nó é zero.  ",
			comment: "  Revisar sinais de entrada e saída. ",
			locator: "p. 42",
			sourceTitle: "Fundamentos de Circuitos",
			sourceUrl: "/ler/book123?dominio=electronics&p=42",
		});
		assert.equal(validManual.ok, true);
		if (validManual.ok) {
			assert.equal(validManual.value.source, "manual");
			assert.equal(validManual.value.moduleId, "mod.dc");
			assert.equal(validManual.value.excerpt, "A soma das correntes num nó é zero.");
			assert.equal(validManual.value.comment, "Revisar sinais de entrada e saída.");
			assert.equal(validManual.value.sourceUrl, "/ler/book123?dominio=electronics&p=42");
		}

		const validHttps = sanitizeSavedNoteInput({
			source: "video",
			excerpt: "Lei das malhas aplicada em dois laços.",
			sourceUrl: "https://www.youtube.com/watch?v=ALvobeJOrr4",
		});
		assert.equal(validHttps.ok, true);

		const validChatLink = sanitizeSavedNoteInput({
			source: "tutor",
			excerpt: "Resumo do tutor sobre divisor de tensão.",
			sourceUrl: "/chat/session-abc",
		});
		assert.equal(validChatLink.ok, true);

		assert.equal(sanitizeSavedNoteInput(null).ok, false);
		assert.equal(sanitizeSavedNoteInput({ excerpt: "   " }).ok, false);
		assert.equal(sanitizeSavedNoteInput({ excerpt: "x".repeat(2001) }).ok, false);
		assert.equal(sanitizeSavedNoteInput({ excerpt: "ok", comment: "c".repeat(1001) }).ok, false);
		assert.equal(sanitizeSavedNoteInput({ excerpt: "ok", source: "unknown" }).ok, false);
		assert.equal(sanitizeSavedNoteInput({ excerpt: "ok", sourceUrl: "javascript:alert(1)" }).ok, false);
		assert.equal(sanitizeSavedNoteInput({ excerpt: "ok", sourceUrl: "data:text/html,<script>" }).ok, false);
		assert.equal(sanitizeSavedNoteInput({ excerpt: "ok", sourceUrl: "//evil.example/path" }).ok, false);
	});

	it("validates and sanitizes module artifact inputs", () => {
		const ok = sanitizeModuleArtifactInput({
			moduleId: "  ee.dc.laws  ",
			title: "  Relatório de bancada · Kirchhoff  ",
			summary: "  Comparação entre cálculo teórico e medição no Falstad. ",
			content: "  Medições obtidas em três malhas com erro relativo < 1,5%.  ",
		});
		assert.equal(ok.ok, true);
		if (ok.ok) {
			assert.equal(ok.value.moduleId, "ee.dc.laws");
			assert.equal(ok.value.title, "Relatório de bancada · Kirchhoff");
			assert.equal(ok.value.summary, "Comparação entre cálculo teórico e medição no Falstad.");
			assert.equal(ok.value.content, "Medições obtidas em três malhas com erro relativo < 1,5%.");
		}

		const okNoSummary = sanitizeModuleArtifactInput({
			moduleId: "ee.dc.laws",
			title: "Checklist",
			content: "Passo 1: escolher nó de referência.",
		});
		assert.equal(okNoSummary.ok, true);
		if (okNoSummary.ok) assert.equal(okNoSummary.value.summary, "");

		assert.equal(sanitizeModuleArtifactInput({ moduleId: "", title: "T", content: "C" }).ok, false);
		assert.equal(sanitizeModuleArtifactInput({ moduleId: "m1", title: " ", content: "C" }).ok, false);
		assert.equal(sanitizeModuleArtifactInput({ moduleId: "m1", title: "a".repeat(161), content: "C" }).ok, false);
		assert.equal(sanitizeModuleArtifactInput({ moduleId: "m1", title: "T", summary: "s".repeat(301), content: "C" }).ok, false);
		assert.equal(sanitizeModuleArtifactInput({ moduleId: "m1", title: "T", content: "" }).ok, false);
		assert.equal(sanitizeModuleArtifactInput({ moduleId: "m1", title: "T", content: "x".repeat(8001) }).ok, false);
	});

	it("aggregates saved notes, module artifacts, and deterministic job aids in buildDomainNotebook", () => {
		switchStudyDomain("electronics");
		const manifest = studyDomains().readManifest("electronics")!;
		const cur = loadCurriculum("electronics", manifest)!;

		const leafA = "ee.dc.laws.kcl";
		const leafB = "ee.dc.laws.kvl";
		const unitId = cur.snapshot.items[leafA]!.parentId!;

		const events: LearnerEvent[] = [
			{ kind: "exposure", id: "e1", seq: 1, at: "2026-10-01T10:00:00Z", domainId: "electronics", sessionId: "s1", nodeId: leafA, source: "ai_lesson", minutes: 20 },
			{
				kind: "evidence",
				evidence: {
					id: "ev-pass", seq: 2, at: "2026-10-01T10:20:00Z", domainId: "electronics", sessionId: "s1",
					itemId: "i1", itemFamily: `${leafA}#teacher`,
					nodes: [{ nodeId: leafA, q: 1, primary: true }],
					format: "explain", level: 3, grade: 3, graderConfidence: 0.9, hints: 0, minutesSinceExposure: 15,
				},
			},
			{
				kind: "lesson-finished",
				id: "fin-reinf",
				seq: 3,
				at: "2026-10-01T11:00:00Z",
				domainId: "electronics",
				nodeId: leafB,
				exposureId: "e2",
				assessedBy: "teacher",
				outcome: "reinforce",
				feedback: "Verifique a convenção de sinais ao percorrer a malha fechada.",
			},
		];
		const snap = foldEvents(null, events, cur.view, DEFAULT_LEARNER_PARAMS);

		// Also pick a second unrelated unit that has ONLY a saved note and an artifact (no events/mastered concepts).
		const otherUnit = Object.values(cur.snapshot.items).find((item) => item.kind === "unit" && item.id !== unitId)!;

		const savedNotes: NotebookSavedNote[] = [
			{
				id: "n-old",
				domainId: "electronics",
				moduleId: unitId,
				nodeId: leafA,
				source: "pdf",
				excerpt: "Anotação mais antiga sobre conservação de carga.",
				locator: "p. 18",
				createdAt: "2026-10-01T09:00:00Z",
			},
			{
				id: "n-new",
				domainId: "electronics",
				moduleId: unitId,
				nodeId: leafA,
				source: "tutor",
				excerpt: "Anotação mais recente: soma algébrica das correntes = 0.",
				comment: "Lembrar de definir direção antes de equacionar.",
				createdAt: "2026-10-02T09:00:00Z",
			},
			// Duplicate ID should be deduplicated
			{
				id: "n-new",
				domainId: "electronics",
				moduleId: unitId,
				nodeId: leafA,
				source: "tutor",
				excerpt: "Anotação mais recente: soma algébrica das correntes = 0.",
				createdAt: "2026-10-02T09:00:00Z",
			},
			// Note in another module with no learner events yet
			{
				id: "n-other-unit",
				domainId: "electronics",
				moduleId: otherUnit.id,
				source: "manual",
				excerpt: "Resumo inicial da segunda unidade.",
				createdAt: "2026-10-03T10:00:00Z",
			},
			// Different domain must be excluded
			{
				id: "n-foreign",
				domainId: "english",
				moduleId: unitId,
				source: "manual",
				excerpt: "Should not appear in electronics notebook",
				createdAt: "2026-10-03T11:00:00Z",
			},
		];

		const artifacts: NotebookModuleArtifact[] = [
			{
				id: "art-1",
				domainId: "electronics",
				moduleId: otherUnit.id,
				title: "Síntese de laboratório",
				summary: "Roteiro experimental validado",
				content: "Passo 1: calibrar fonte. Passo 2: medir queda em cada resistor.",
				createdAt: "2026-10-03T12:00:00Z",
				updatedAt: "2026-10-03T12:00:00Z",
			},
		];

		const materialsByUnit = new Map([
			[
				unitId,
				{
					books: [
						{ title: "Livro 1", part: "Cap. 2", url: "https://example.org/b1" },
						{ title: "Livro 2", part: "Cap. 3", url: "https://example.org/b2" },
						{ title: "Livro 3", part: "Cap. 4", url: "https://example.org/b3" },
						{ title: "Livro 4", part: "Cap. 5", url: "https://example.org/b4" },
						{ title: "Livro 5 (excede limite)", part: "Cap. 6", url: "https://example.org/b5" },
					],
					videos: [
						{ title: "Vídeo 1", part: "Aula 1", url: "https://example.org/v1" },
						{ title: "Vídeo 2", part: "Aula 2", url: "https://example.org/v2" },
						{ title: "Vídeo 3", part: "Aula 3", url: "https://example.org/v3" },
						{ title: "Vídeo 4 (excede limite)", part: "Aula 4", url: "https://example.org/v4" },
					],
				},
			],
		]);

		const nb = buildDomainNotebook({
			domainId: "electronics",
			snapshot: cur.snapshot,
			graph: cur.view,
			learner: snap,
			events,
			at: "2026-10-04T00:00:00Z",
			savedNotes,
			artifacts,
			materialsByUnit,
		});

		assert.equal(nb.totalSavedNotes, 3);
		assert.equal(nb.totalArtifacts, 1);

		const primaryMod = nb.modules.find((m) => m.moduleId === unitId)!;
		assert.ok(primaryMod, "primary module present");
		assert.equal(primaryMod.savedNotes.length, 2, "duplicate note ID deduplicated");
		assert.equal(primaryMod.savedNotes[0]!.id, "n-new", "sorted newest-first");
		assert.equal(primaryMod.savedNotes[1]!.id, "n-old");

		assert.ok(primaryMod.jobAid, "jobAid generated for primary module");
		assert.ok(primaryMod.jobAid.keyTakeaways.length >= 2);
		assert.ok(primaryMod.jobAid.watchOutFor.some((w) => w.includes("convenção de sinais")));
		assert.equal(primaryMod.jobAid.referenceLinks.filter((r) => r.kind === "book").length, 4, "books capped at 4");
		assert.equal(primaryMod.jobAid.referenceLinks.filter((r) => r.kind === "video").length, 3, "videos capped at 3");
		assert.equal(primaryMod.jobAid.savedNotesCount, 2);

		const markdown = formatJobAidMarkdown(primaryMod.jobAid);
		assert.match(markdown, new RegExp(`^# ${primaryMod.moduleTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
		assert.match(markdown, /## Pontos-chave/);
		assert.match(markdown, /## Pontos de atenção/);
		assert.match(markdown, /## Referências/);
		assert.match(markdown, /https:\/\/example\.org\/b1/);

		const secondMod = nb.modules.find((m) => m.moduleId === otherUnit.id)!;
		assert.ok(secondMod, "module with only savedNotes/artifacts is still included");
		assert.equal(secondMod.savedNotes.length, 1);
		assert.equal(secondMod.artifacts.length, 1);
		assert.equal(secondMod.artifacts[0]!.title, "Síntese de laboratório");
		assert.ok(secondMod.jobAid, "jobAid built from saved notes");
	});
});

describe("notebook server persistence round-trip", () => {
	it("saves, reads via studyNotebook, and deletes notes and module artifacts atomically", async () => {
		switchStudyDomain("electronics");

		// Save note with only nodeId: server must infer moduleId and nodeTitle from curriculum.
		const savedNote = await saveStudyNotebookNote(
			{
				nodeId: "ee.dc.laws.kcl",
				source: "pdf",
				excerpt: "Em qualquer nó elétrico, a soma algébrica das correntes é nula.",
				comment: "Base para análise nodal.",
				locator: "p. 55",
				sourceTitle: "Circuitos Elétricos",
				sourceUrl: "/ler/abc?dominio=electronics&p=55",
			},
			"electronics",
		);
		assert.ok(savedNote.id.startsWith("note_"));
		assert.equal(savedNote.domainId, "electronics");
		assert.equal(savedNote.moduleId, "ee.dc.laws");
		assert.ok(savedNote.nodeTitle && savedNote.nodeTitle.length > 0);

		// Invalid input raises StudyError(400).
		await assert.rejects(
			() => saveStudyNotebookNote({ excerpt: "   " }, "electronics"),
			(err: unknown) => err instanceof StudyError && err.status === 400,
		);

		// Save module artifact under same module.
		const savedArtifact = await saveStudyModuleArtifact(
			{
				moduleId: "ee.dc.laws",
				title: "Folha de verificação KCL/KVL",
				summary: "Procedimento de 4 etapas para montar equações nodais",
				content: "1. Escolher nó de referência.\n2. Rotular tensões nodais.\n3. Escrever KCL.\n4. Conferir potência.",
			},
			"electronics",
		);
		assert.ok(savedArtifact.id.startsWith("artifact_"));
		assert.equal(savedArtifact.moduleId, "ee.dc.laws");

		// Read back through studyNotebook: both note, artifact, and jobAid should be present.
		const nb1 = studyNotebook("electronics");
		assert.equal(nb1.totalSavedNotes, 1);
		assert.equal(nb1.totalArtifacts, 1);
		const lawsMod = nb1.modules.find((m) => m.moduleId === "ee.dc.laws");
		assert.ok(lawsMod, "module ee.dc.laws appears in notebook");
		assert.equal(lawsMod.savedNotes[0]!.id, savedNote.id);
		assert.equal(lawsMod.artifacts[0]!.id, savedArtifact.id);
		assert.ok(lawsMod.jobAid && lawsMod.jobAid.savedNotesCount === 1);

		// Delete note and verify idempotency.
		const delNote1 = await deleteStudyNotebookNote(savedNote.id, "electronics");
		assert.equal(delNote1.deleted, true);
		const delNote2 = await deleteStudyNotebookNote(savedNote.id, "electronics");
		assert.equal(delNote2.deleted, false);

		// Delete artifact and verify idempotency.
		const delArt1 = await deleteStudyModuleArtifact(savedArtifact.id, "electronics");
		assert.equal(delArt1.deleted, true);
		const delArt2 = await deleteStudyModuleArtifact(savedArtifact.id, "electronics");
		assert.equal(delArt2.deleted, false);

		// Notebook reflects clean removal.
		const nb2 = studyNotebook("electronics");
		assert.equal(nb2.totalSavedNotes, 0);
		assert.equal(nb2.totalArtifacts, 0);
	});
});
