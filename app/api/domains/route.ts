/**
 * /api/domains — study worlds (estudos-sota; src/server/study.ts).
 *
 *   GET    → 200 StudyDomainList { domains, active } (built-ins created on first call)
 *   POST   { active: string | null } → switch world (null = "Geral").
 *          409 while a turn or job runs; 404 unknown id; 400 bad body.
 *   DELETE { id: string } (or ?id=...) → move a domain to the local trash.
 *          Switches to a remaining domain (or "Geral") if removing the active one.
 */

import { listStudyDomains, removeStudyDomain, StudyError, switchStudyDomain } from "@/src/server";

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

export async function DELETE(request: Request) {
	const queryId = new URL(request.url).searchParams.get("id");
	const body = queryId ? undefined : ((await request.json().catch(() => undefined)) as { id?: unknown } | undefined);
	const id = queryId ?? (typeof body?.id === "string" ? body.id : undefined);
	if (!id) {
		return Response.json({ error: "body must be { id: string }" }, { status: 400 });
	}
	try {
		return Response.json(removeStudyDomain(id));
	} catch (error) {
		if (error instanceof StudyError) return Response.json({ error: error.message }, { status: error.status });
		throw error;
	}
}
