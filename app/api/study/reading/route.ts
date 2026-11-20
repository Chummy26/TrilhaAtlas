import { regionalBookImage, regionalBookUnit, StudyError } from "@/src/server";

export async function GET(request: Request) {
	const params = new URL(request.url).searchParams;
	const args = [params.get("domain") ?? "", params.get("region") ?? "", params.get("book") ?? "", Number(params.get("unit"))] as const;
	const headers = { "Cache-Control": "private, no-store" };
	try {
		if (params.has("image")) {
			const png = await regionalBookImage(...args);
			return new Response(new Uint8Array(png), { headers: { ...headers, "Content-Type": "image/png" } });
		}
		return Response.json(await regionalBookUnit(...args), { headers });
	} catch (error) {
		return Response.json({ error: error instanceof StudyError ? error.message : "Não foi possível abrir esta leitura." },
			{ status: error instanceof StudyError ? error.status : 422, headers });
	}
}
