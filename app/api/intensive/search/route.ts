import { searchIntensiveCatalog } from "@/src/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	const params = new URL(request.url).searchParams;
	const query = (params.get("q") ?? params.get("query") ?? "").trim();
	const courseId = params.get("courseId")?.trim() || undefined;
	const trackId = params.get("trackId")?.trim() || undefined;
	const rawLimit = params.get("limit")?.trim();

	let limit: number | undefined;
	if (rawLimit) {
		const parsed = Number.parseInt(rawLimit, 10);
		if (!Number.isFinite(parsed) || parsed <= 0) {
			return Response.json({ error: "limit must be a positive integer." }, { status: 400 });
		}
		limit = Math.min(100, parsed);
	}

	const result = searchIntensiveCatalog({
		query,
		courseId,
		trackId,
		limit,
	});

	return Response.json(
		{ query, ...result },
		{ headers: { "Cache-Control": "private, no-store" } },
	);
}
