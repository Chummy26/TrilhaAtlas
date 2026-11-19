import Link from "next/link";
import { notFound } from "next/navigation";
import { Chat } from "@/components/chat";
import { slotsConfigured } from "@/src/core";
import { StudyHeartbeat } from "@/components/study/study-heartbeat";
import { activeDomainId, compactionInFlight, getChat, isTurnRunning, lessonNodeOfChat, readSettingsRecord, turnFailure } from "@/src/server";

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
	return (
		<>
			<StudyHeartbeat key={chat.id + "-activity"} domain={activeDomainId()} kind={chat.kind === "practice" ? "practice" : "lesson"} />
			{domain && node && <Link className="lh-no-drag absolute right-4 top-14 z-20 cel-button px-3 py-1 text-xs" href={`/mapa?dominio=${encodeURIComponent(domain)}&no=${encodeURIComponent(node)}`}>Materiais da aula</Link>}
			<Chat
				key={chat.id}
				chatId={chat.id}
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
		</>
	);
}
