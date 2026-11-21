import { redirect } from "next/navigation";
import { StudyHeartbeat } from "@/components/study/study-heartbeat";
import { SyllabusView, type SyllabusTab } from "@/components/study/syllabus-view";
import { activeDomainId, listStudyDomains, StudyError, studyNotebook, studySyllabus } from "@/src/server";

export const dynamic = "force-dynamic";

function parseTab(raw: string | undefined): SyllabusTab {
	if (raw === "caderno" || raw === "nivelamento") return raw;
	return "ementa";
}

function parseAction(raw: string | undefined): "prova" | "lista" | undefined {
	if (raw === "prova" || raw === "lista") return raw;
	return undefined;
}

export default async function SyllabusPage({
	searchParams,
}: {
	searchParams: Promise<{ dominio?: string; aba?: string; modulo?: string; acao?: string }>;
}) {
	const query = await searchParams;
	const domain = activeDomainId();
	if (!domain || (query.dominio && query.dominio !== domain)) redirect("/");

	let syllabus;
	let notebook;
	try {
		syllabus = studySyllabus();
		notebook = studyNotebook();
	} catch (error) {
		if (error instanceof StudyError && (error.status === 404 || error.status === 409)) redirect("/");
		throw error;
	}

	const domainInfo = listStudyDomains().domains.find((d) => d.id === domain);
	const domainTitle = domainInfo?.title.pt ?? domain;

	return (
		<>
			<StudyHeartbeat domain={domain} kind="reading" />
			<SyllabusView
				key={domain}
				initialSyllabus={syllabus}
				initialNotebook={notebook}
				domainTitle={domainTitle}
				initialTab={parseTab(query.aba)}
				initialModule={query.modulo}
				initialAction={parseAction(query.acao)}
			/>
		</>
	);
}
