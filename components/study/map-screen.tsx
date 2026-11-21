"use client";

import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useModelSetup, selectedModelUnavailable, openModelPicker } from "@/components/setup-cta";
import { OPENING_PROMPT_FAILURE } from "@/components/opening-prompt";
import type { SkillMap } from "@/src/core";
import { SessionStarter, studyLessonRequest } from "../start-session.ts";
import { SkillTree } from "./skill-tree.tsx";
import type { LessonStart } from "./today-card.tsx";

const SetupDialog = dynamic(() => import("../setup-dialog.tsx").then((m) => m.SetupDialog));

/** Dedicated /mapa client shell so the skill-tree route stays decoupled from
 *  Home's GraphView, MinimalHome, TodayCard, and dictation machinery. */
export function MapScreen({
	initialConfigured,
	map,
	initialNode,
}: {
	initialConfigured: boolean;
	map: SkillMap;
	initialNode?: string;
}) {
	const router = useRouter();
	const { catalog, configured, zeroKeys } = useModelSetup(initialConfigured);
	const [setupOpen, setSetupOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const [startError, setStartError] = useState(false);
	const startingRef = useRef(false);
	const starterRef = useRef<SessionStarter | null>(null);

	const closeSetup = useCallback(() => setSetupOpen(false), []);

	const begin = useCallback(
		async (lesson: LessonStart) => {
			const title = lesson.title.trim();
			if (!title || startingRef.current) return;
			if (!configured || zeroKeys) {
				setSetupOpen(true);
				return;
			}
			const strong = catalog?.slots.strong?.model;
			if (selectedModelUnavailable(catalog, strong ? `${strong.provider}:${strong.id}` : undefined)) {
				openModelPicker();
				return;
			}
			startingRef.current = true;
			setBusy(true);
			setStartError(false);
			try {
				starterRef.current ??= new SessionStarter();
				const target = await starterRef.current.start(
					studyLessonRequest(lesson),
					fetch,
					JSON.stringify(catalog?.slots.strong),
				);
				router.push(target);
			} catch {
				startingRef.current = false;
				setBusy(false);
				setStartError(true);
			}
		},
		[configured, zeroKeys, catalog, router],
	);

	return (
		<>
			<SkillTree map={map} initialNode={initialNode} busy={busy} onStart={begin} />
			{startError && <p role="alert" className="fixed bottom-4 right-4 cel-card p-3">{OPENING_PROMPT_FAILURE}</p>}
			{setupOpen && <SetupDialog open={setupOpen} onClose={closeSetup} onDone={closeSetup} />}
		</>
	);
}
