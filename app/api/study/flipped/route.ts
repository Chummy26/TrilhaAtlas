/**
 * GET  /api/study/flipped?node=...
 * POST /api/study/flipped { nodeId, note }
 */

import type { FlippedPrepNote } from "@/src/core";
import { getFlippedGuide, saveFlippedPrepNote, StudyError } from "@/src/server";

export const dynamic = "force-dynamic";

function parsePrepNote(raw: unknown): FlippedPrepNote | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const obj = raw as Record<string, unknown>;
	const out: FlippedPrepNote = {};
	if (obj.answers !== undefined) {
		if (!obj.answers || typeof obj.answers !== "object" || Array.isArray(obj.answers)) return null;
		const answers: Record<string, string> = {};
		for (const [k, v] of Object.entries(obj.answers as Record<string, unknown>)) {
			if (v === undefined) continue;
			if (typeof v !== "string") return null;
			answers[k] = v;
		}
		out.answers = answers;
	}
	if (obj.doubt !== undefined) {
		if (typeof obj.doubt !== "string") return null;
		out.doubt = obj.doubt;
	}
	if (obj.completedMaterials !== undefined) {
		if (!Array.isArray(obj.completedMaterials)) return null;
		const completed: ("book" | "video")[] = [];
		for (const item of obj.completedMaterials) {
			if (item !== "book" && item !== "video") return null;
			completed.push(item);
		}
		out.completedMaterials = completed;
	}
	return out;
}

export async function GET(request: Request) {
	const nodeId = new URL(request.url).searchParams.get("node")?.trim() ?? "";
	if (!nodeId) {
		return Response.json({ error: "Informe o nó da aula para o guia de pré-leitura." }, { status: 400 });
	}
	try {
		return Response.json(getFlippedGuide(nodeId));
	} catch (error) {
		if (error instanceof StudyError) return Response.json({ error: error.message }, { status: error.status });
		throw error;
	}
}

export async function POST(request: Request) {
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body || typeof body !== "object") {
		return Response.json({ error: "Corpo de pré-leitura inválido." }, { status: 400 });
	}
	const nodeId = typeof body.nodeId === "string" ? body.nodeId.trim() : "";
	if (!nodeId) {
		return Response.json({ error: "Identificador do nó ausente." }, { status: 400 });
	}
	const note = parsePrepNote(body.note);
	if (!note) {
		return Response.json({ error: "Anotação de pré-leitura inválida." }, { status: 400 });
	}
	try {
		return Response.json(saveFlippedPrepNote(nodeId, note));
	} catch (error) {
		if (error instanceof StudyError) return Response.json({ error: error.message }, { status: error.status });
		throw error;
	}
}
