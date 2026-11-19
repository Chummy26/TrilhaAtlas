import { StudyHeartbeat } from "@/components/study/study-heartbeat";
import { activeDomainId } from "@/src/server";
import { PluginViewScreen } from "@/components/plugin-view";

export default async function PluginPage({ params }: { params: Promise<{ pluginId: string; viewId: string }> }) {
	const { pluginId, viewId } = await params;
	return <>
		{pluginId === "flashcards" && viewId === "library" && <StudyHeartbeat domain={activeDomainId()} kind="review" />}
		<PluginViewScreen pluginId={pluginId} viewId={viewId} />
	</>;
}
