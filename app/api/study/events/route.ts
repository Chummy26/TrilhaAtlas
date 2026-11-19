/**
 * POST /api/study/events — append one learner event to the active domain:
 *   { kind: "exposure", nodeId, minutes? }   a lesson on the node started
 *   { kind: "self-check", nodeId, grade }   0 não entendi · 1 parcial · 2 com ajuda · 3 domino
 *   { kind: "known", nodeId }               "Já domino" (diagnostic placement)
 * → 200 StudyToday (refreshed). 400 bad body / unknown node; 409 no domain.
 */

import { parseStudyEvent, recordStudyEvent, StudyError } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	const event = parseStudyEvent(await request.json().catch(() => undefined));
	if (!event) return Response.json({ error: "invalid study event" }, { status: 400 });
	try {
		return Response.json(recordStudyEvent(event));
	} catch (error) {
		if (error instanceof StudyError) return Response.json({ error: error.message }, { status: error.status });
		throw error;
	}
}
