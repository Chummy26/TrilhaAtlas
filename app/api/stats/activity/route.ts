import { recordStudyActivity } from "@/src/server";

export async function POST(request: Request) {
	const body: unknown = await request.json().catch(() => null);
	if (!recordStudyActivity(body)) return Response.json({ error: "Atividade inválida." }, { status: 400 });
	return new Response(null, { status: 204 });
}
