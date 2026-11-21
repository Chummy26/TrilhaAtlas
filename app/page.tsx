import { Home } from "@/components/home";
import { StudyHeartbeat } from "@/components/study/study-heartbeat";
import { listStudyDomains, studyAccountSummary, studyToday, readSettingsRecord } from "@/src/server";
import { resolveSettings, slotsConfigured, type StudyToday } from "@/src/core";

// Dynamic: the configured state is server-rendered into the page (the
// setup CTA's truth on the first frame), and every navigation re-reads
// the record (dynamic routes aren't cached client-side).
export const dynamic = "force-dynamic";

export default function HomePage() {
	// First-run gate (model-slots wave): chats cannot start until the user
	// has picked all three slots — the dock shows the CTA while the raw
	// record's models section lacks any slot pin.
	const record = readSettingsRecord();
	const domains = listStudyDomains();
	let initialToday: StudyToday | null = null;
	if (domains.active) {
		try {
			initialToday = studyToday();
		} catch {
			initialToday = null;
		}
	}
	// GRAPH RENDERING (owner, 2026-10-06): off = the home's main view is
	// the chains view. Resolved through the one core resolver (missing
	// section / absent key → factory default on); re-read per navigation.
	const rendering = resolveSettings(record ?? null).graph.rendering;
	return (
		<>
			<StudyHeartbeat domain={domains.active} kind="reading" />
			<Home
				domains={domains}
				account={studyAccountSummary(domains.domains)}
				initialToday={initialToday}
				initialConfigured={slotsConfigured(record?.models)}
				rendering={rendering}
			/>
		</>
	);
}
