/**
 * GET  /api/study/module-exam?scope=module|chapter&target=...&seed=...
 * POST /api/study/module-exam { scope, targetId, answers, seed? }
 */

import { getModuleExam, StudyError, submitModuleExam } from "@/src/server";

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
	const rawScope = params.get("scope") ?? "module";
	if (rawScope !== "module" && rawScope !== "chapter") {
		return Response.json({ error: "Escopo de prova inválido. Use 'module' ou 'chapter'." }, { status: 400 });
	}
	const target = params.get("target")?.trim() ?? "";
	if (!target) {
		return Response.json({ error: "Informe o módulo ou capítulo da prova." }, { status: 400 });
	}
	const seed = params.get("seed")?.trim() || undefined;
	try {
		return Response.json(getModuleExam(rawScope, target, seed));
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
	const scope = body.scope;
	if (scope !== "module" && scope !== "chapter") {
		return Response.json({ error: "Escopo de prova inválido. Use 'module' ou 'chapter'." }, { status: 400 });
	}
	const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
	if (!targetId) {
		return Response.json({ error: "Identificador do módulo ou capítulo ausente." }, { status: 400 });
	}
	const answers = parseStringMap(body.answers);
	if (!answers) {
		return Response.json({ error: "Mapa de respostas inválido." }, { status: 400 });
	}
	const seed = typeof body.seed === "string" && body.seed.trim() ? body.seed.trim() : undefined;

	try {
		return Response.json(submitModuleExam(scope, targetId, answers, seed));
	} catch (error) {
		if (error instanceof StudyError) return Response.json({ error: error.message }, { status: error.status });
		throw error;
	}
}
