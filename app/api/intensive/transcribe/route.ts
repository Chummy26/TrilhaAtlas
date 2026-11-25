import {
	getIntensiveTranscriptionStatuses,
	startIntensiveTranscription,
	stopIntensiveTranscription,
} from "@/src/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	const courseId = new URL(request.url).searchParams.get("courseId")?.trim() || undefined;
	const statuses = getIntensiveTranscriptionStatuses();
	return Response.json(
		courseId ? { statuses, status: statuses[courseId] ?? null } : { statuses },
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
	const courseId = typeof body.courseId === "string" ? body.courseId.trim() : "";
	if (!courseId) {
		return Response.json({ error: "courseId is required." }, { status: 400 });
	}

	const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "start";
	if (action === "stop") {
		const res = stopIntensiveTranscription(courseId);
		return Response.json(
			{ ...res, statuses: getIntensiveTranscriptionStatuses() },
			{ status: res.ok ? 200 : 400, headers: { "Cache-Control": "private, no-store" } },
		);
	}

	if (action !== "start") {
		return Response.json(
			{ error: "Invalid action. Expected 'start' or 'stop'." },
			{ status: 400 },
		);
	}

	const mode =
		body.mode === "once" ? "once" : body.mode === "watch" || body.mode === undefined ? "watch" : null;
	if (!mode) {
		return Response.json(
			{ error: "Invalid mode. Expected 'watch' or 'once'." },
			{ status: 400 },
		);
	}

	const res = startIntensiveTranscription({
		courseId,
		sourceDir: typeof body.sourceDir === "string" ? body.sourceDir : undefined,
		mode,
		language: typeof body.language === "string" ? body.language : undefined,
		model: typeof body.model === "string" ? body.model : undefined,
	});

	if (!res.ok) {
		return Response.json(
			{ ok: false, error: res.error ?? "Failed to start transcription." },
			{ status: 400, headers: { "Cache-Control": "private, no-store" } },
		);
	}

	return Response.json(
		{ ...res, statuses: getIntensiveTranscriptionStatuses() },
		{ headers: { "Cache-Control": "private, no-store" } },
	);
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

	const res = stopIntensiveTranscription(courseId);
	return Response.json(
		{ ...res, statuses: getIntensiveTranscriptionStatuses() },
		{ status: res.ok ? 200 : 400, headers: { "Cache-Control": "private, no-store" } },
	);
}
