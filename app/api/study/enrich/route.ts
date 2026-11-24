import { after } from "next/server";
import { activeTreeEnrichments, cancelTreeEnrichment, startTreeEnrichment, StudyError, treeEnrichmentStatus } from "@/src/server";

export const dynamic = "force-dynamic";

function respond(run: () => unknown, status = 200) {
	try {
		return Response.json(run(), { status, headers: { "Cache-Control": "no-store" } });
	} catch (error) {
		if (error instanceof StudyError) return Response.json({ error: error.message }, { status: error.status });
		throw error;
	}
}

export async function POST(request: Request) {
	const origin = request.headers.get("origin");
	if (origin && origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
	const body: unknown = await request.json().catch(() => null);
	return respond(() => startTreeEnrichment(body, after), 202);
}

export function GET(request: Request) {
	const domain = new URL(request.url).searchParams.get("domain");
	if (domain) return respond(() => ({ status: treeEnrichmentStatus(domain) }));
	return respond(() => ({ active: activeTreeEnrichments() }));
}

export function DELETE(request: Request) {
	const origin = request.headers.get("origin");
	if (origin && origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
	const domain = new URL(request.url).searchParams.get("domain") ?? "";
	return respond(() => ({ status: cancelTreeEnrichment(domain) }));
}
