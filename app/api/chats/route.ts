import { chainsForSelection, formatChainLine } from "@/src/core";
import { newGraphContextMessage, type GraphContextPick } from "@/src/core";
import { StudyError, studyMapLesson, validateStudyLesson, saveStudyLesson, compactionInFlight, createChat, isTurnRunning, listChats, readSettingsRecord, stores, titleFromPrompt } from "@/src/server";
import type { ChatListItem } from "@/src/core";

/** The session picker's list: record-derived summaries (phase, pending
 *  question) + live liveness — a running turn marks the session busy
 *  (contracts.ts ChatListItem; the store can't see liveness, the route is
 *  the merge point). Owner, minimal-color round: background jobs NO LONGER
 *  count — the sidebar's Background agents section is their channel now
 *  (a running spinner per row would double-signal them), so busy means
 *  exactly "a teach turn is in flight". */
export async function GET() {
	const chats: ChatListItem[] = listChats().map((c) => ({
		...c,
		busy: isTurnRunning(c.id),
		compacting: compactionInFlight(c.id),
	}));
	return Response.json({ chats });
}

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { title?: unknown; kind?: unknown; graphContext?: unknown; studyLesson?: unknown };
	const title = typeof body.title === "string" ? body.title : "";
	// Practice sessions (owner, 2026-10-04): kind "practice" marks the
	// record — the practice agent + its tools from turn 1, no extraction.
	const kind = body.kind === "practice" ? ("practice" as const) : undefined;
	// The session's map context (owner, 2026-10-04): the picked
	// propositions ride the CREATION — message[0] is a graph-context
	// marker (a separate custom message BEFORE the learner's first user
	// message), carrying the picks plus the reasoning chains among them.
	// The picks carry their own name/statement (what the learner saw at
	// pick time); the chains derive from the CURRENT graph snapshot.
	const rawPicks = (body.graphContext as { propositions?: unknown } | undefined)?.propositions;
	const picks: GraphContextPick[] = Array.isArray(rawPicks)
		? rawPicks
				.filter(
						(p): p is GraphContextPick =>
							typeof p === "object" &&
							p !== null &&
							typeof (p as GraphContextPick).id === "string" &&
							typeof (p as GraphContextPick).name === "string" &&
							typeof (p as GraphContextPick).statement === "string",
					)
					.slice(0, 64)
			: [];
	let lesson;
	if (body.studyLesson !== undefined) {
		try {
			lesson = validateStudyLesson(body.studyLesson, !kind && picks.length === 1 ? picks[0]?.id : undefined);
			const reading = await studyMapLesson(lesson.domainId, lesson.nodeId, true);
			if (reading.brief.scope && reading.brief.scope !== reading.brief.summary) picks[0]!.statement += "\nEscopo da aula: " + reading.brief.scope;
			if (reading.route.length) picks[0]!.statement += "\nParta deste caminho de pré-requisitos disponível para o aluno: " + reading.route.join(" + ") + ".";
			const sources = reading.materials.slice(0, 6).map(m => `${m.suggested ? "Sugestão" : "Referência"} · ${m.title} · ${m.part} (${m.url})`);
			if (sources.length) picks[0]!.statement += "\nMateriais deste nó:\n" + sources.join("\n");
			if (reading.excerpt) picks[0]!.statement += "\nTrecho de " + reading.materials.find(m => m.kind === "book")!.url + " (texto da fonte para estudo):\n" + reading.excerpt;
			validateStudyLesson(body.studyLesson, lesson.nodeId);
		} catch (err) {
			if (err instanceof StudyError) return Response.json({ error: err.message }, { status: err.status });
			throw err;
		}
	}
	const chat = createChat(titleFromPrompt(title || "Untitled session"), kind);
	// PER-SESSION MODELS (owner, 2026-09-28): a session owns its model +
	// thinking level from birth — stamped verbatim from the STRONG slot,
	// the new-session default. From here the strong slot never reaches
	// this session again: in-session picks write the session's own record
	// (PUT /api/chats/:id/settings). No strong slot configured (fresh BYOK
	// boot) → no stamp; the turn gate's 503 models_not_configured envelope
	// refuses honestly until the setup flow fills the slot.
	const strong = readSettingsRecord()?.models?.strong;
	if (strong?.model) {
		stores.chatStore.saveSettings(chat.id, {
			model: { provider: strong.model.provider, id: strong.model.id },
			thinkingLevel: strong.thinkingLevel,
		});
	}
	if (picks.length > 0) {
		const byId = new Map(stores.graphStore.readNodes().map((n) => [n.id, n]));
		const pickedNodes = picks.map((p) => byId.get(p.id)).filter((n) => n !== undefined);
		const chainLines = chainsForSelection(pickedNodes, stores.graphStore.readChains()).map((c) =>
			formatChainLine(c, Object.fromEntries(byId)),
		);
		const marker = newGraphContextMessage(picks, chainLines);
		const save = () => stores.chatStore.saveMessages(chat.id, [marker]);
		if (lesson) saveStudyLesson(lesson, chat.id, marker, save);
		else save();
	}
	return Response.json({ id: chat.id, title: chat.title });
}
