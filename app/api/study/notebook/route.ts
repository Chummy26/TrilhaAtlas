/**
 * GET /api/study/notebook — domain study notebook grouping mistakes,
 * misconception beliefs, and mastered concept notes per module.
 */

import { StudyError, studyNotebook } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	const domain = new URL(request.url).searchParams.get("domain")?.trim() || undefined;
	try {
		return Response.json(studyNotebook(domain));
	} catch (error) {
		if (error instanceof StudyError) return Response.json({ error: error.message }, { status: error.status });
		throw error;
	}
}
