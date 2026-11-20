import { finishStudyLesson, isTurnRunning, StudyError } from "@/src/server";

export async function POST(request: Request) {
	const body = await request.json().catch(() => null);
	if (typeof body?.domainId !== "string" || typeof body?.sessionId !== "string" || ![0, 1, 2, 3].includes(body.grade))
		return Response.json({ error: "Avaliação da aula inválida." }, { status: 400 });
	try {
		if (isTurnRunning(body.sessionId)) throw new StudyError(409, "Aguarde o professor terminar a resposta.");
		return Response.json(finishStudyLesson(body.domainId, body.sessionId, body.grade));
	} catch (error) {
		if (error instanceof StudyError) return Response.json({ error: error.message }, { status: error.status });
		throw error;
	}
}
