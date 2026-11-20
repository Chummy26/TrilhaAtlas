/** Structural differential test + a year of event-sourced study, using only public seeds. */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { applySeedFiles, curriculumIndex, outerFringe } from "../src/core/curriculum/index.ts";
import { emptySnapshot, foldEvents } from "../src/core/learner/fold.ts";
import { structuralState } from "../src/core/learner/kst.ts";
import { DEFAULT_LEARNER_PARAMS as params } from "../src/core/learner/params.ts";
import { planDay } from "../src/core/learner/planner.ts";
import type { LearnerEvent, PlanItemKind } from "../src/core/learner/types.ts";
import { seededRandom } from "../src/core/question-core.ts";
import { learnerViewOf } from "../src/core/study/projection.ts";
import { studyCampaign, guidedLessonOptions } from "../src/core/study/campaign.ts";

const start = Date.UTC(2025, 0, 1, 9);
const origin = new Date(start).toISOString();
for (const domain of ["electronics", "english"]) {
	const dir = path.resolve(import.meta.dirname, "../content/curricula", domain);
	const files = readdirSync(dir).filter(f => f.endsWith(".json")).sort().map(f => JSON.parse(readFileSync(path.join(dir, f), "utf8")));
	const result = applySeedFiles(files, { createdAt: origin, edgeMode: "strict" });
	assert.ok(result.ok);
	const idx = curriculumIndex(result.snapshot);
	const view = learnerViewOf(result.snapshot);
	const leaves = [...view.nodes].filter(([, n]) => n.isLeaf);
	const random = seededRandom(domain + "-marathon-v1");
	const attained = new Set<string>();
	const known = new Set<string>();
	let frontiers = 0;
	// Independent incremental milestone roll-up from direct children. Compare
	// every eligible AND/OR leaf, then take a single random legal step.
	while (attained.size < leaves.length) {
		const expected = leaves.filter(([id, n]) => !attained.has(id) &&
			(!n.clauses.length || n.clauses.some(c => c.every(p => known.has(p))))).map(([id]) => id);
		const frontier = outerFringe(idx, attained);
		assert.deepEqual(new Set(frontier), new Set(expected));
		assert.ok(frontier.length);
		const campaign = studyCampaign(result.snapshot, view, known);
		const current = campaign.journey.find(c => c.known < c.total)!;
		assert.equal(campaign.journey.reduce((n,c) => n + c.total, 0), leaves.length);
		const guided = frontier.filter(id => campaign.priority(id) > 0);
		assert.ok(guided.length, "stranded chapter: " + current.level);
		const pick = guided[Math.floor(random() * guided.length)]!;
		attained.add(pick);
		known.add(pick);
		let parent = view.nodes.get(pick)!.parentId;
		while (parent) {
			const node = view.nodes.get(parent)!;
			if (!node.children.every(c => known.has(c) || view.nodes.get(c)!.reinforcementFor)) break;
			known.add(parent);
			parent = node.parentId;
		}
		frontiers++;
	}
	assert.deepEqual(outerFringe(idx, attained), []);
	assert.ok(studyCampaign(result.snapshot, view, known).journey.every(c => c.total === c.known));
	let state = emptySnapshot(domain, origin);
	const log: LearnerEvent[] = [];
	const counts: Record<PlanItemKind, number> = { new: 0, review: 0, remediate: 0, probe: 0, vehicle: 0 };
	const durations: number[] = [];
	let failures = 0, restarts = 0, idle = 0, minutes = 0, delayed = 0;
	function record(event: LearnerEvent) {
		log.push(event);
		state = foldEvents(state, [event], view, params);
	}
	for (let day = 0; day < 365; day++) {
		// Alternate domains. Take one week off each quarter and resume from disk-shaped JSON.
		if (day % 2 !== Number(domain === "english") || day % 91 >= 84) continue;
		const t = start + day * 86_400_000;
		const at = new Date(t).toISOString();
		const budget = [120, 180, 240][day % 3]!;
		const before = performance.now();
		const structure = structuralState(state, view);
		const campaign = studyCampaign(result.snapshot, view, structure.known);
		const plan = planDay(state, view, params, { at, budgetMin: budget, ...guidedLessonOptions(campaign, log, at) });
		durations.push(performance.now() - before);
		const elapsed = plan.items.reduce((sum, item) => sum + item.estMinutes, 0);
		assert.ok(elapsed <= budget);
		assert.equal(new Set(plan.items.map(p => p.nodeId)).size, plan.items.length);
		const initialFrontier = new Set(structure.frontier);
		if (!plan.items.length) idle++;
		let offset = 0;
		for (const item of plan.items) {
			counts[item.kind]++;
			const id = item.nodeId;
			const sessionId = domain + "-" + day;
			const timestamp = (m: number) => new Date(t + m * 60000).toISOString();
			if (item.kind === "new") {
				assert.ok(initialFrontier.has(id), "locked lesson: " + id);
				assert.ok(campaign.priority(id) > 0, "chapter skipped: " + id);
				record({ kind: "exposure", id: "x" + log.length, seq: log.length + 1, at: timestamp(offset),
					domainId: domain, sessionId, nodeId: id, source: "ai_lesson", minutes: item.estMinutes });
			}
			offset += item.estMinutes;
			const last = state.nodes[id]?.lastExposureAt;
			const since = last ? (t + offset * 60000 - Date.parse(last)) / 60000 : 1440;
			const grade = random() < (item.kind === "new" ? .24 : .16) ? 0 : 3;
			if (grade === 0) failures++;
			if (since >= 1440) delayed++;
			record({ kind: "evidence", evidence: { id: "e" + log.length, seq: log.length + 1, at: timestamp(offset), domainId: domain,
				sessionId, itemId: "q" + log.length, itemFamily: id + "#" + (day % 3), nodes: [{ nodeId: id, q: 1, primary: true }],
				format: "short", level: 2, grade, graderConfidence: 1, hints: 0, minutesSinceExposure: since } });
		}
		minutes += offset;
		if (durations.length % 30 === 0) {
			const replay = foldEvents(null, JSON.parse(JSON.stringify(log)), view, params);
			assert.deepEqual(replay, state);
			state = replay;
			restarts++;
		}
	}
	assert.deepEqual(foldEvents(null, log, view, params), state);
	assert.ok(failures && delayed && restarts && counts.new && counts.review);
	durations.sort((a, b) => a - b);
	console.log(JSON.stringify({ domain, nodes: view.nodes.size, frontiers, calendarDays: 365, sessions: durations.length,
		minutes, idleSessions: idle, counts, errors: failures, delayedChecks: delayed, events: log.length, restarts,
		attained: Object.values(state.nodes).filter(n => n.attainedAt).length,
		planP50ms: +durations[Math.ceil(durations.length * .5) - 1]!.toFixed(2),
		planP95ms: +durations[Math.ceil(durations.length * .95) - 1]!.toFixed(2) }));
}
