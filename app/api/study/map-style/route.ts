/**
 * /api/study/map-style — persist the visual skill tree style per domain.
 *
 *   POST { domain?: string; style: SkillMapStyle } → 200 { domain, mapStyle }
 */

import { setStudyMapStyle, StudyError } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	const body = (await request.json().catch(() => undefined)) as { domain?: unknown; style?: unknown } | undefined;
	if (!body || typeof body !== "object") {
		return Response.json({ error: "Invalid request body." }, { status: 400 });
	}
	const domain = typeof body.domain === "string" ? body.domain : undefined;
	try {
		return Response.json(setStudyMapStyle(domain, body.style), {
			headers: { "Cache-Control": "no-store" },
		});
	} catch (error) {
		if (error instanceof StudyError) return Response.json({ error: error.message }, { status: error.status });
		throw error;
	}
}
