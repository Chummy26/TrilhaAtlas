/**
 * POST /api/study/flashcards/export { mode: "obsidian" | "anki" | "apkg" }
 */

import { exportDomainFlashcards, StudyError } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body !== "object") {
		return Response.json({ error: "Corpo de exportação inválido." }, { status: 400 });
	}
	const mode = body.mode;
	if (mode !== "obsidian" && mode !== "anki" && mode !== "apkg") {
		return Response.json({ error: "Modo inválido. Use 'obsidian', 'anki' ou 'apkg'." }, { status: 400 });
	}
	try {
		return Response.json(await exportDomainFlashcards(mode));
	} catch (error) {
		if (error instanceof StudyError) return Response.json({ error: error.message }, { status: error.status });
		throw error;
	}
}
