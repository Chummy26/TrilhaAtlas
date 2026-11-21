/**
 * GET /api/study/transcript — honest academic transcript separating attained,
 * durable, and mastered skills, plus FSRS cooling-module alerts.
 */

import { StudyError, studyTranscript } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	const domain = new URL(request.url).searchParams.get("domain")?.trim() || undefined;
	try {
		return Response.json(studyTranscript(domain));
	} catch (error) {
		if (error instanceof StudyError) return Response.json({ error: error.message }, { status: error.status });
		throw error;
	}
}
