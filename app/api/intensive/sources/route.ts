import {
	IntensiveValidationError,
	linkIntensiveMediaSource,
	listIntensiveMediaSources,
	unlinkIntensiveMediaSource,
} from "@/src/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json(
		{ sources: listIntensiveMediaSources() },
		{ headers: { "Cache-Control": "private, no-store" } },
	);
}

export async function POST(request: Request) {
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON request body." }, { status: 400 });
	}

	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return Response.json({ error: "Request body must be a JSON object." }, { status: 400 });
	}

	const body = raw as Record<string, unknown>;
	if (typeof body.courseId !== "string" || !body.courseId.trim()) {
		return Response.json({ error: "courseId is required." }, { status: 400 });
	}
	if (typeof body.sourceDir !== "string" || !body.sourceDir.trim()) {
		return Response.json({ error: "sourceDir is required." }, { status: 400 });
	}

	try {
		const source = linkIntensiveMediaSource({
			courseId: body.courseId.trim(),
			sourceDir: body.sourceDir.trim(),
			label: typeof body.label === "string" ? body.label : undefined,
			language: typeof body.language === "string" ? body.language : undefined,
			expectedTotalVideos:
				typeof body.expectedTotalVideos === "number" ? body.expectedTotalVideos : undefined,
		});
		return Response.json(
			{ ok: true, source, sources: listIntensiveMediaSources() },
			{ headers: { "Cache-Control": "private, no-store" } },
		);
	} catch (error) {
		if (error instanceof IntensiveValidationError) {
			return Response.json({ error: error.message }, { status: error.status });
		}
		throw error;
	}
}

export async function DELETE(request: Request) {
	const urlCourseId = new URL(request.url).searchParams.get("courseId")?.trim() || "";
	let courseId = urlCourseId;

	if (!courseId) {
		try {
			const raw = (await request.json()) as unknown;
			if (
				raw &&
				typeof raw === "object" &&
				!Array.isArray(raw) &&
				typeof (raw as Record<string, unknown>).courseId === "string"
			) {
				courseId = ((raw as Record<string, unknown>).courseId as string).trim();
			}
		} catch {
			// no body
		}
	}

	if (!courseId) {
		return Response.json({ error: "courseId is required." }, { status: 400 });
	}

	const removed = unlinkIntensiveMediaSource(courseId);
	return Response.json(
		{ ok: true, removed, sources: listIntensiveMediaSources() },
		{ headers: { "Cache-Control": "private, no-store" } },
	);
}
