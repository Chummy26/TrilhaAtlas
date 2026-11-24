import { runTreeAssistant, StudyError } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	const origin = request.headers.get("origin");
	if (origin && origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
	const body: unknown = await request.json().catch(() => null);
	try {
		const result = await runTreeAssistant(body);
		return Response.json(result, { headers: { "Cache-Control": "no-store" } });
	} catch (error) {
		if (error instanceof StudyError) return Response.json({ error: error.message }, { status: error.status });
		return Response.json(
			{ error: error instanceof Error ? error.message.slice(0, 320) : "Não foi possível executar o pedido na árvore." },
			{ status: 500 },
		);
	}
}
