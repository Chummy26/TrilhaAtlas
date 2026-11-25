import { IntensiveValidationError, getIntensiveCourseDetail } from "@/src/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ courseId: string }> },
) {
	const { courseId } = await params;
	const trackId = new URL(request.url).searchParams.get("trackId")?.trim() || undefined;

	try {
		const detail = getIntensiveCourseDetail(courseId, trackId);
		if (!detail) {
			return Response.json({ error: "Course not found." }, { status: 404 });
		}
		return Response.json(detail, {
			headers: { "Cache-Control": "private, no-store" },
		});
	} catch (error) {
		if (error instanceof IntensiveValidationError) {
			return Response.json({ error: error.message }, { status: error.status });
		}
		throw error;
	}
}
