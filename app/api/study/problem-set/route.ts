/**
 * GET  /api/study/problem-set?module=...&seed=...
 * POST /api/study/problem-set { moduleId, answers, labNotes?, seed? }
 */

import { getModuleProblemSet, StudyError, submitModuleProblemSet } from "@/src/server";

export const dynamic = "force-dynamic";

function parseStringMap(raw: unknown): Record<string, string> | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof v !== "string") return null;
		out[k] = v;
	}
	return out;
}

export async function GET(request: Request) {
	const params = new URL(request.url).searchParams;
	const moduleId = params.get("module")?.trim() ?? "";
	if (!moduleId) {
		return Response.json({ error: "Informe o módulo da lista de exercícios." }, { status: 400 });
	}
	const seed = params.get("seed")?.trim() || undefined;
	try {
		return Response.json(getModuleProblemSet(moduleId, seed));
	} catch (error) {
		if (error instanceof StudyError) return Response.json({ error: error.message }, { status: error.status });
		throw error;
	}
}

export async function POST(request: Request) {
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body !== "object") {
		return Response.json({ error: "Corpo da submissão inválido." }, { status: 400 });
	}
	const moduleId = typeof body.moduleId === "string" ? body.moduleId.trim() : "";
	if (!moduleId) {
		return Response.json({ error: "Identificador do módulo ausente." }, { status: 400 });
	}
	const answers = parseStringMap(body.answers);
	if (!answers) {
		return Response.json({ error: "Mapa de respostas inválido." }, { status: 400 });
	}
	let labNotes: Record<string, string> | undefined;
	if (body.labNotes !== undefined) {
		const parsed = parseStringMap(body.labNotes);
		if (!parsed) return Response.json({ error: "Notas de laboratório inválidas." }, { status: 400 });
		labNotes = parsed;
	}
	const seed = typeof body.seed === "string" && body.seed.trim() ? body.seed.trim() : undefined;

	try {
		return Response.json(submitModuleProblemSet(moduleId, answers, labNotes, seed));
	} catch (error) {
		if (error instanceof StudyError) return Response.json({ error: error.message }, { status: error.status });
		throw error;
	}
}
