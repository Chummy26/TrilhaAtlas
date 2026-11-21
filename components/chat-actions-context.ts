"use client";

import { createContext } from "react";

/**
 * Server-sync channel for artifact renderers, extracted to a leaf module so
 * RootLayout / plugin renderers never pull the full Chat component into every route.
 */
export interface ChatActionsValue {
	chatId: string;
	syncFromServer: () => Promise<void>;
	/** Send a user message into the session (demo error-fix loop, W6). */
	sendText: (text: string) => void;
	askActivity?: (text: string) => Promise<boolean>;
	/** Legacy optional fields kept for compatibility when tests provide them directly. */
	activeExamId?: string;
	examBusy?: boolean;
	submitExam?: (examCallId: string, text: string, onAccepted: () => void) => Promise<boolean>;
	/** Opens the model setup dialog (BYOK, 2026-09-22). */
	openSetup: () => void;
}

export const ChatActionsContext = createContext<ChatActionsValue | null>(null);

/** Volatile lesson-exam state split out so changing examBusy/activeExamId does not re-render non-exam cards. */
export interface LessonExamStateValue {
	activeExamId?: string;
	examBusy?: boolean;
}

export const LessonExamStateContext = createContext<LessonExamStateValue | null>(null);
