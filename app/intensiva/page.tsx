import { IntensiveWorkspace } from "@/components/intensive/intensive-workspace.tsx";
import type { IntensiveTab } from "@/components/intensive/tutor-launch.ts";
import { getIntensiveDashboard } from "@/src/server";

// Dynamic: every visit reads the latest local progress, certifications, and media discovery.
export const dynamic = "force-dynamic";

function parseTab(
	raw: string | undefined,
	hints: { hasCourseOrLesson: boolean; hasCert: boolean; hasProject: boolean },
): IntensiveTab {
	switch (raw?.trim().toLowerCase()) {
		case "quests":
		case "trilha":
			return "quests";
		case "watch":
		case "assistir":
		case "course":
		case "curso":
			return "watch";
		case "certs":
		case "certificacoes":
		case "certifications":
			return "certs";
		case "portfolio":
		case "bancada":
		case "bench":
			return "portfolio";
		case "pacing":
		case "ritmo":
			return "pacing";
		default:
			if (hints.hasCourseOrLesson) return "watch";
			if (hints.hasCert) return "certs";
			if (hints.hasProject) return "portfolio";
			return "quests";
	}
}

function parseTimeSec(raw: string | undefined): number | undefined {
	if (!raw) return undefined;
	const n = Number(raw);
	return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

export default async function IntensivePage({
	searchParams,
}: {
	searchParams: Promise<{
		course?: string;
		lesson?: string;
		t?: string;
		tab?: string;
		cert?: string;
		project?: string;
	}>;
}) {
	const query = await searchParams;
	const initialDashboard = await getIntensiveDashboard();

	const initialCourseId = query.course?.trim() || undefined;
	const initialLessonId = query.lesson?.trim() || undefined;
	const initialTimeSec = parseTimeSec(query.t);
	const initialCertId = query.cert?.trim() || undefined;
	const initialProjectId = query.project?.trim() || undefined;

	const initialTab = parseTab(query.tab, {
		hasCourseOrLesson: Boolean(initialCourseId || initialLessonId),
		hasCert: Boolean(initialCertId),
		hasProject: Boolean(initialProjectId),
	});

	return (
		<IntensiveWorkspace
			initialDashboard={initialDashboard}
			initialTab={initialTab}
			initialCourseId={initialCourseId}
			initialLessonId={initialLessonId}
			initialTimeSec={initialTimeSec}
			initialCertId={initialCertId}
			initialProjectId={initialProjectId}
		/>
	);
}
