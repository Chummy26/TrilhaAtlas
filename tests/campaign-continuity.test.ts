import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-campaign-continuity-"));
process.env.LH_DATA_DIR = root;
process.env.LH_AUTH_FILE = path.join(root, "auth.json");

const { POST: createChat } = await import("../app/api/chats/route.ts");
const { chatStore } = await import("../src/store/chats.ts");
const {
	finishStudyLesson,
	lessonCompletionState,
	loadCurriculum,
	studyDomains,
	studyMap,
	studyToday,
	switchStudyDomain,
} = await import("../src/server/study.ts");

after(() => fs.rmSync(root, { recursive: true, force: true }));

async function openLesson(domainId: string, nodeId: string, minutes = 20) {
	const res = await createChat(new Request("http://local/api/chats", {
		method: "POST",
		body: JSON.stringify({
			title: "Aula " + nodeId,
			studyLesson: { domainId, minutes },
			graphContext: { propositions: [{ id: nodeId, name: nodeId, statement: "Aula da campanha." }] },
		}),
	}));
	assert.equal(res.status, 200);
	return (await res.json()) as { id: string };
}

it("clears orphaned pendingCheck when an in-progress campaign chat is deleted", async () => {
	switchStudyDomain("electronics");
	const firstNode = studyToday().next!.nodeId;
	const created = await openLesson("electronics", firstNode, 20);
	assert.equal(studyToday().pendingCheck?.sessionId, created.id);
	assert.ok(chatStore.deleteChat(created.id));
	assert.equal(studyToday().pendingCheck, null, "deleting an unfinished lesson chat must not strand Hoje on a 404 link");
});

it("keeps the campaign moving smoothly after reinforcement without awarding XP or locking the learner out for 20 hours", async () => {
	switchStudyDomain("electronics");
	const firstNode = studyToday().next!.nodeId;
	const first = await openLesson("electronics", firstNode, 20);
	const feedback = "Faltou converter expoente negativo para fração decimal.";
	const receipt = finishStudyLesson("electronics", first.id, 1, { feedback });

	assert.equal(receipt.before, receipt.after);
	assert.equal(receipt.next, null);
	assert.equal(receipt.retry?.nodeId, firstNode);
	assert.equal(receipt.retry?.feedback, feedback);
	assert.ok(receipt.course && receipt.course.moduleTotal > 0);
	assert.equal(studyMap().nodes.find(n => n.id === firstNode)?.completed, false);

	// Reloaded completion state preserves retry info.
	const reloaded = lessonCompletionState("electronics", first.id);
	assert.equal(reloaded?.completed, true);
	assert.equal(reloaded?.reinforcement, feedback);
	assert.equal(reloaded?.retry?.nodeId, firstNode);

	// Hoje must NOT hide this reinforced node for 20 hours; it surfaces it for remediation.
	const todayAfterReinforce = studyToday();
	assert.equal(todayAfterReinforce.pendingCheck, null);
	assert.ok(todayAfterReinforce.next, "campaign must remain actionable right after reinforcement");
	assert.equal(todayAfterReinforce.next!.nodeId, firstNode);
	assert.equal(todayAfterReinforce.next!.kind, "remediate");
	assert.equal(todayAfterReinforce.reinforceHint?.feedback, feedback);
});

it("provides online-course module progress, up-next queue, persistent next-lesson handoff, and detects module completion", async () => {
	switchStudyDomain("electronics");
	const manifest = studyDomains().readManifest("electronics")!;
	const cur = loadCurriculum("electronics", manifest)!;
	const initial = studyToday();
	assert.ok(initial.currentModule, "Hoje exposes the active unit/module");
	assert.ok(initial.currentModule!.lessons.length > 0);
	assert.ok(initial.queue && initial.queue.length > 0, "Hoje exposes an ordered upcoming queue");

	// Complete every lesson in the first module sequentially like an online course.
	const targetModule = initial.currentModule!;
	let lastReceipt: ReturnType<typeof finishStudyLesson> | undefined;
	let lastChatId = "";
	for (const lesson of targetModule.lessons) {
		const chat = await openLesson("electronics", lesson.id, lesson.minutes);
		lastChatId = chat.id;
		lastReceipt = finishStudyLesson("electronics", chat.id, 3);
	}

	assert.ok(lastReceipt);
	assert.ok(lastReceipt!.after > lastReceipt!.before);
	assert.ok(lastReceipt!.course?.moduleJustCompleted, "completing the final lesson of a module flags module completion");
	assert.ok(lastReceipt!.next && lastReceipt!.next.nodeId !== targetModule.lessons.at(-1)!.id, "next lesson advances immediately to the following module");

	// Reloading the completed lesson preserves next-lesson handoff and course position.
	const stateAfterReload = lessonCompletionState("electronics", lastChatId);
	assert.equal(stateAfterReload?.completed, true);
	assert.ok(stateAfterReload?.course);
	assert.equal(stateAfterReload?.course?.moduleCompleted, targetModule.total);
	assert.equal(stateAfterReload?.next?.nodeId, lastReceipt!.next!.nodeId);

	// The active module on Hoje has moved to the next module.
	const afterModule = studyToday();
	assert.ok(afterModule.currentModule);
	assert.notEqual(afterModule.currentModule!.id, targetModule.id);
	assert.ok(cur.view.nodes.has(afterModule.next!.nodeId));
});
