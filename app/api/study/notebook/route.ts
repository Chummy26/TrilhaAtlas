/**
 * GET / POST / DELETE /api/study/notebook — domain study notebook grouping mistakes,
 * misconception beliefs, mastered concept notes, saved notes, job aids, and module artifacts.
 */

import {
	StudyError,
	deleteStudyModuleArtifact,
	deleteStudyNotebookNote,
	saveStudyModuleArtifact,
	saveStudyNotebookNote,
	studyNotebook,
} from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	const domain = new URL(request.url).searchParams.get("domain")?.trim() || undefined;
	try {
		return Response.json(studyNotebook(domain));
	} catch (error) {
		if (error instanceof StudyError) return Response.json({ error: error.message }, { status: error.status });
		throw error;
	}
}

export async function POST(request: Request) {
	let body: Record<string, unknown>;
	try {
		const raw = (await request.json()) as unknown;
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			return Response.json({ error: "Corpo da requisição inválido." }, { status: 400 });
		}
		body = raw as Record<string, unknown>;
	} catch {
		return Response.json({ error: "JSON inválido." }, { status: 400 });
	}

	const domain = typeof body.domain === "string" && body.domain.trim() ? body.domain.trim() : undefined;
	const action =
		typeof body.action === "string"
			? body.action.trim()
			: body.action === undefined && typeof body.excerpt === "string"
				? "save-note"
				: "";

	try {
		if (action === "save-note") {
			const note = await saveStudyNotebookNote(body, domain);
			return Response.json({ note }, { status: 201 });
		}
		if (action === "save-artifact") {
			const artifact = await saveStudyModuleArtifact(body, domain);
			return Response.json({ artifact }, { status: 201 });
		}
		return Response.json({ error: "Ação desconhecida." }, { status: 400 });
	} catch (error) {
		if (error instanceof StudyError) return Response.json({ error: error.message }, { status: error.status });
		throw error;
	}
}

export async function DELETE(request: Request) {
	const params = new URL(request.url).searchParams;
	const domain = params.get("domain")?.trim() || undefined;
	const kind = params.get("kind")?.trim();
	const id = params.get("id")?.trim();

	if (!id || (kind !== "note" && kind !== "artifact")) {
		return Response.json({ error: "Parâmetros obrigatórios ausentes ou inválidos (kind, id)." }, { status: 400 });
	}

	try {
		if (kind === "note") {
			return Response.json(await deleteStudyNotebookNote(id, domain));
		}
		return Response.json(await deleteStudyModuleArtifact(id, domain));
	} catch (error) {
		if (error instanceof StudyError) return Response.json({ error: error.message }, { status: error.status });
		throw error;
	}
}
