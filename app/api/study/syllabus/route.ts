/**
 * GET /api/study/syllabus — full chapter -> module -> lesson syllabus,
 * completion schedule estimate, FSRS retention, exam scores, and curated materials.
 */

import { StudyError, studySyllabus } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	const domain = new URL(request.url).searchParams.get("domain")?.trim() || undefined;
	try {
		return Response.json(studySyllabus(domain));
	} catch (error) {
		if (error instanceof StudyError) return Response.json({ error: error.message }, { status: error.status });
		throw error;
	}
}
