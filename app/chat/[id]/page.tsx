import Link from "next/link";
import { notFound } from "next/navigation";
import { CitationShelf } from "@/components/study/cited-response";
import { MissionShelf } from "@/components/study/mission-shelf";
import { Chat } from "@/components/chat";
import { activityForSkill, lessonResources, slotsConfigured, type LessonResource } from "@/src/core";
import { StudyHeartbeat } from "@/components/study/study-heartbeat";
import { activeDomainId, compactionInFlight, getChat, isTurnRunning, lessonCompletionState, lessonPdfShelf, lessonNodeOfChat, materialsForEnglishMission, readSettingsRecord, turnFailure } from "@/src/server";

export const dynamic = "force-dynamic";

export default async function ChatPage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ prompt?: string }>;
}) {
	const [{ id }, { prompt }] = await Promise.all([params, searchParams]);
	const chat = getChat(id);
	if (!chat) notFound();
	// The persistent setup CTA's seed (BYOK, owner 2026-09-22): slotsConfigured
	// over the settings record, server-read — the same gate home/new read. The
	// server's 503 stays the truth; this only decides whether the pill rides.
	const record = readSettingsRecord();
	const domain = activeDomainId();
	const node = lessonNodeOfChat(domain, chat.id);
	const first = chat.messages[0];
	const details = first?.role === "custom" && first.customType === "graph-context"
		? first.details as { resources?: LessonResource[]; readingSource?: { book: string; region: string; unit: number } } | undefined : undefined;
	const reading = details?.readingSource;
	const aids = details?.resources ?? (domain === "english" && node ? lessonResources(materialsForEnglishMission(node)) : []);
	const returnHref = domain && node && (reading
		? "/ler/" + encodeURIComponent(reading.book) + "?" + new URLSearchParams({ domain, region: reading.region, node, unit: String(reading.unit) })
		: "/mapa?" + new URLSearchParams({ dominio: domain, no: node }));
	return (
		<>
			<StudyHeartbeat key={chat.id + "-activity"} domain={domain} kind={chat.kind === "practice" ? "practice" : "lesson"} />
			{returnHref && (!reading && aids.length > 0 ? <MissionShelf aids={aids} mapHref={returnHref}/> :
				<Link className="lh-no-drag absolute right-4 top-14 z-20 cel-button px-3 py-1 text-xs" href={returnHref}>{reading ? "Voltar à leitura" : "Materiais da aula"}</Link>)}
			<CitationShelf domain={domain ?? ""} books={domain && node ? lessonPdfShelf(domain, chat.id, node) : []}>
			<Chat
				key={chat.id}
				chatId={chat.id}
				lessonCompletion={domain && node && !reading ? lessonCompletionState(domain, chat.id) : null}
				lessonActivity={reading ? undefined : activityForSkill(node)}
				title={chat.title}
				kind={chat.kind ?? "teach"}
				// Wave D: the record IS native agent history — the client view is
					// derived app-side (core/view.ts projectView; GET serves the same
					// native messages).
					initialMessages={chat.messages}
				initialError={turnFailure(chat.id)}
				initialConfigured={slotsConfigured(record?.models)}
				initialPrompt={prompt}
				// A teacher turn that outlived its client: the remounted view must
				// attach (busy shimmer + poll), never resurrect the stale record.
				initiallyInFlight={isTurnRunning(chat.id)}
				initiallyCompacting={compactionInFlight(chat.id)}
			/>
			</CitationShelf>
		</>
	);
}
