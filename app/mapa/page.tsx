import { redirect } from "next/navigation";
import { Home } from "@/components/home";
import { StudyHeartbeat } from "@/components/study/study-heartbeat";
import { activeDomainId, readSettingsRecord, StudyError, studyMap } from "@/src/server";
import { slotsConfigured } from "@/src/core";

export const dynamic = "force-dynamic";

export default async function MapPage({ searchParams }: { searchParams: Promise<{ no?: string; dominio?: string }> }) {
	const query = await searchParams;
	const domain = activeDomainId();
	if (!domain || (query.dominio && query.dominio !== domain)) redirect("/");
	let map;
	try {
		map = studyMap();
	} catch (error) {
		if (error instanceof StudyError && error.status === 404) redirect("/");
		throw error;
	}
	return <>
		<StudyHeartbeat domain={domain} kind="reading" />
		<Home key={domain} initialConfigured={slotsConfigured(readSettingsRecord()?.models)} map={map} initialNode={query.no} />
	</>;
}
