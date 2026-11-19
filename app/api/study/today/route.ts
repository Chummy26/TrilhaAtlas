/**
 * GET /api/study/today — the active domain's single next suggestion, the
 * pending post-lesson self-check and a light progress summary
 * (StudyToday). 409 when "Geral" is open (no study domain).
 */

import { StudyError, studyToday } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	try {
		return Response.json(studyToday());
	} catch (error) {
		if (error instanceof StudyError) return Response.json({ error: error.message }, { status: error.status });
		throw error;
	}
}
