import { downloadRegionalBook, readRegionMaterials, StudyError, studyMapLesson } from "@/src/server";

export const dynamic = "force-dynamic";

async function respond(req: Request, search: boolean) {
	const params = new URL(req.url).searchParams;
	const domain = params.get("domain") ?? "";
	const node = params.get("node") ?? "";
	try {
		if (search && params.has("download")) return Response.json(await downloadRegionalBook(domain,node,params.get("download")!));
		const discovery = search ? (params.get("kind") === "book" ? "book" : "video") : undefined;
		const result = !search && params.has("lesson") ? await studyMapLesson(domain, node) : await readRegionMaterials(domain, node, discovery);
		return Response.json(result);
	} catch (error) {
		if (error instanceof StudyError) return Response.json({ error: error.message }, { status: error.status });
		throw error;
	}
}

export function GET(req: Request) { return respond(req, false); }
export function POST(req: Request) {
	const origin = req.headers.get("origin");
	if (origin && origin !== new URL(req.url).origin) return new Response(null, { status: 403 });
	return respond(req, true);
}
