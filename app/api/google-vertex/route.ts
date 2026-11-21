import { googleVertexStatusResponse } from "@/src/server";

export const dynamic = "force-dynamic";

/** Local ADC + project/location status only; never makes a remote call. */
export async function GET(request: Request) {
	return googleVertexStatusResponse(request);
}
