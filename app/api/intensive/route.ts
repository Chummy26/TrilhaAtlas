import {
	IntensiveValidationError,
	getIntensiveDashboard,
	mutateIntensiveState,
	parseIntensiveMutation,
} from "@/src/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	const trackId = new URL(request.url).searchParams.get("trackId")?.trim() || undefined;
	try {
		const dashboard = getIntensiveDashboard(trackId);
		return Response.json(dashboard, {
			headers: { "Cache-Control": "private, no-store" },
		});
	} catch (error) {
		if (error instanceof IntensiveValidationError) {
			return Response.json({ error: error.message }, { status: error.status });
		}
		throw error;
	}
}

async function handleMutation(request: Request) {
	let rawBody: unknown;
	try {
		rawBody = await request.json();
	} catch {
		return Response.json({ error: "Invalid JSON request body." }, { status: 400 });
	}

	const urlTrackId = new URL(request.url).searchParams.get("trackId")?.trim() || undefined;
	const bodyTrackId =
		rawBody &&
		typeof rawBody === "object" &&
		!Array.isArray(rawBody) &&
		typeof (rawBody as Record<string, unknown>).trackId === "string"
			? ((rawBody as Record<string, unknown>).trackId as string).trim() || undefined
			: undefined;

	try {
		const patch = parseIntensiveMutation(rawBody);
		const dashboard = mutateIntensiveState(patch, urlTrackId ?? bodyTrackId);
		return Response.json(dashboard, {
			headers: { "Cache-Control": "private, no-store" },
		});
	} catch (error) {
		if (error instanceof IntensiveValidationError) {
			return Response.json({ error: error.message }, { status: error.status });
		}
		throw error;
	}
}

export async function PATCH(request: Request) {
	return handleMutation(request);
}

export async function POST(request: Request) {
	return handleMutation(request);
}
