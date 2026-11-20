import { answerCampaignReview, StudyError } from "@/src/server";

export async function POST(request: Request) {
	const body = await request.json().catch(() => null);
	if (!body || typeof body.domain !== "string" || typeof body.id !== "string" || typeof body.answer !== "string" ||
		!body.answer.trim() || body.answer.length > 150) return Response.json({ error: "Resposta inválida." }, { status: 400 });
	try {
		return Response.json(answerCampaignReview(body.domain, body.id, body.answer));
	} catch (error) {
		if (error instanceof StudyError) return Response.json({ error: error.message }, { status: error.status });
		throw error;
	}
}
