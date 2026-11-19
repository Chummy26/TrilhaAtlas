/**
 * /api/domains — study worlds (estudos-sota; src/server/study.ts).
 *
 *   GET  → 200 StudyDomainList { domains, active } (built-ins created on first call)
 *   POST { active: string | null } → switch world (null = "Geral").
 *        409 while a turn or job runs; 404 unknown id; 400 bad body.
 */

import { listStudyDomains, StudyError, switchStudyDomain } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json(listStudyDomains());
}

export async function POST(request: Request) {
	const body = (await request.json().catch(() => undefined)) as { active?: unknown } | undefined;
	if (!body || !("active" in body) || (body.active !== null && typeof body.active !== "string")) {
		return Response.json({ error: "body must be { active: string | null }" }, { status: 400 });
	}
	try {
		return Response.json(switchStudyDomain(body.active as string | null));
	} catch (error) {
		if (error instanceof StudyError) return Response.json({ error: error.message }, { status: error.status });
		throw error;
	}
}
