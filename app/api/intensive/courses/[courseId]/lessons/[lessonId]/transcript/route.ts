import {
	getIntensiveLessonTranscript,
	getIntensiveLessonTranscriptFile,
} from "@/src/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ courseId: string; lessonId: string }> },
) {
	const { courseId, lessonId } = await params;
	const format = (new URL(request.url).searchParams.get("format")?.trim() || "json").toLowerCase();

	if (format === "vtt" || format === "txt") {
		const file = getIntensiveLessonTranscriptFile(courseId, lessonId, format);
		if (!file) {
			return Response.json({ error: "Transcript not found." }, { status: 404 });
		}
		return new Response(file.content, {
			status: 200,
			headers: {
				"Content-Type": file.contentType,
				"Content-Length": String(Buffer.byteLength(file.content, "utf8")),
				"Cache-Control": "private, no-store",
			},
		});
	}

	if (format === "json") {
		const doc = getIntensiveLessonTranscript(courseId, lessonId);
		if (!doc) {
			return Response.json({ error: "Transcript not found." }, { status: 404 });
		}
		return Response.json(doc, {
			headers: { "Cache-Control": "private, no-store" },
		});
	}

	return Response.json(
		{ error: "Invalid format parameter. Expected 'json', 'vtt', or 'txt'." },
		{ status: 400 },
	);
}
