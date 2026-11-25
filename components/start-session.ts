import { clearOpeningPrompt, OPENING_PROMPT_FAILURE, stashOpeningPrompt } from "./opening-prompt.ts";

import type { LessonStart } from "./study/today-card.tsx";

export interface IntensiveSessionContextInput {
	trackId?: string;
	courseId?: string;
	moduleId?: string;
	lessonId?: string;
	materialId?: string;
	currentTimeSec?: number;
	certId?: string;
	projectId?: string;
	query?: string;
}

export interface SessionCreation {
	title: string;
	kind?: "practice";
	studyLesson?: { domainId: string; minutes: number; exploratory?: boolean };
	graphContext?: { propositions: readonly { id: string; name: string; statement: string }[] };
	readingSource?: { book: string; unit: number; original: boolean; screenshot?: string };
	intensiveContext?: IntensiveSessionContextInput;
}

export function studyLessonRequest(lesson: LessonStart): SessionCreation {
	return {
		title: lesson.title,
		graphContext: { propositions: [lesson.context] },
		studyLesson: { domainId: lesson.domainId, minutes: lesson.minutes, exploratory: lesson.exploratory },
	};
}

/** Per source-composer instance. Retain a successful creation if storage
 * fails, so an unchanged retry does not create another empty session.
 * Changed text/context/settings is a different start, not a stale title.
 */
export class SessionStarter {
	private created?: { identity: string; id: string };

	async start(body: SessionCreation, fetchLike: typeof fetch, settingsIdentity?: string, opening = body.title): Promise<string> {
		const identity = JSON.stringify([body, settingsIdentity, opening]);
		if (this.created?.identity !== identity) {
			if (this.created) clearOpeningPrompt(this.created.id);
			this.created = undefined;
			const res = await fetchLike("/api/chats", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			if (!res.ok) throw new Error(OPENING_PROMPT_FAILURE);
			const result = await res.json() as { id?: unknown };
			if (typeof result.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(result.id)) throw new Error(OPENING_PROMPT_FAILURE);
			this.created = { identity, id: result.id };
		}
		if (!stashOpeningPrompt(this.created.id, opening)) throw new Error(OPENING_PROMPT_FAILURE);
		return `/chat/${this.created.id}`;
	}
}
