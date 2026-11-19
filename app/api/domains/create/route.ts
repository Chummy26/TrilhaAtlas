import { after } from "next/server";
import { cancelDomainCreation, domainCreationStatus, startDomainCreation, StudyError } from "@/src/server";

function respond(run: () => unknown, status = 200) {
	try {
		return Response.json(run(), { status, headers: { "Cache-Control": "no-store" } });
	} catch (error) {
		if (error instanceof StudyError) return Response.json({ error: error.message }, { status: error.status });
		throw error;
	}
}

export async function POST(request: Request) {
	const body: unknown = await request.json().catch(() => null);
	return respond(() => startDomainCreation(body, after), 202);
}

export function GET(request: Request) {
	return respond(() => domainCreationStatus(new URL(request.url).searchParams.get("id") ?? ""));
}

export function DELETE(request: Request) {
	return respond(() => cancelDomainCreation(new URL(request.url).searchParams.get("id") ?? ""));
}
