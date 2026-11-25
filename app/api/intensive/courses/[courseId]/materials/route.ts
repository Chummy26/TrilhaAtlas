import { IntensiveValidationError, listIntensiveCourseMaterials } from "@/src/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ courseId: string }> },
) {
	const { courseId } = await params;
	const categoryFilter = new URL(request.url).searchParams.get("category")?.trim().toLowerCase() || "";

	try {
		const index = listIntensiveCourseMaterials(courseId);
		if (!index) {
			return Response.json({ error: "Invalid courseId." }, { status: 404 });
		}

		const materials = categoryFilter
			? index.materials.filter((m) => m.category === categoryFilter)
			: index.materials;

		return Response.json(
			{
				...index,
				materials,
			},
			{
				headers: { "Cache-Control": "private, no-store" },
			},
		);
	} catch (error) {
		if (error instanceof IntensiveValidationError) {
			return Response.json({ error: error.message }, { status: error.status });
		}
		throw error;
	}
}
