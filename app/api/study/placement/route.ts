/**
 * GET    /api/study/placement
 * POST   /api/study/placement { action: "start" | "beginner" | "answer" | "back" | "finish", nodeId?, correct?, seed?, hint? }
 * DELETE /api/study/placement
 */

import { isPlacementHint } from "@/src/core";
import {
	answerDomainPlacement,
	cancelDomainPlacement,
	declareDomainBeginner,
	finishDomainPlacement,
	getDomainPlacement,
	startDomainPlacement,
	StudyError,
	undoDomainPlacement,
} from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	try {
		return Response.json(getDomainPlacement());
	} catch (error) {
		if (error instanceof StudyError) return Response.json({ error: error.message }, { status: error.status });
		throw error;
	}
}

export async function POST(request: Request) {
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body !== "object") {
		return Response.json({ error: "Ação de nivelamento inválida." }, { status: 400 });
	}
	const action = body.action;
	try {
		if (action === "start") {
			const seed = typeof body.seed === "string" && body.seed.trim() ? body.seed.trim() : undefined;
			const hint = isPlacementHint(body.hint) ? body.hint : undefined;
			return Response.json(startDomainPlacement(seed, hint));
		}
		if (action === "beginner") {
			return Response.json(declareDomainBeginner());
		}
		if (action === "answer") {
			const nodeId = typeof body.nodeId === "string" ? body.nodeId.trim() : "";
			if (!nodeId || typeof body.correct !== "boolean") {
				return Response.json({ error: "Informe nodeId e correct (booleano) para responder." }, { status: 400 });
			}
			return Response.json(answerDomainPlacement(nodeId, body.correct));
		}
		if (action === "back") {
			return Response.json(undoDomainPlacement());
		}
		if (action === "finish") {
			return Response.json(finishDomainPlacement());
		}
		return Response.json({ error: "Ação inválida. Use 'start', 'beginner', 'answer', 'back' ou 'finish'." }, { status: 400 });
	} catch (error) {
		if (error instanceof StudyError) return Response.json({ error: error.message }, { status: error.status });
		throw error;
	}
}

export async function DELETE() {
	try {
		return Response.json(cancelDomainPlacement());
	} catch (error) {
		if (error instanceof StudyError) return Response.json({ error: error.message }, { status: error.status });
		throw error;
	}
}
