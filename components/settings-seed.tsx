"use client";

import { createContext, useContext, useMemo, useState, useEffect, type ReactNode } from "react";
import type { UserSettings } from "@/src/core";
import { useSettingsSaved } from "@/components/settings-signal";

export interface SettingsSeedValue {
	/** Server-rendered initial settings (null when unavailable). */
	settings: UserSettings | null;
	/** Whether the server has a dictation (Deepgram) API key configured. */
	hasDictationKey?: boolean;
}

const SettingsSeedContext = createContext<SettingsSeedValue | null>(null);

export function SettingsSeedProvider({
	initialSettings = null,
	hasDictationKey,
	children,
}: {
	initialSettings?: UserSettings | null;
	hasDictationKey?: boolean;
	children: ReactNode;
}) {
	const [settings, setSettings] = useState<UserSettings | null>(initialSettings);

	// Keep the seeded snapshot synchronized if the user saves settings in-app.
	useSettingsSaved(() => {
		fetch("/api/settings")
			.then((r) => (r.ok ? r.json() : null))
			.then((d) => {
				if (d && typeof d === "object") {
					const rec = (d as { settings?: UserSettings | null }).settings ?? (d as UserSettings);
					setSettings(rec);
				}
			})
			.catch(() => {});
	});

	// Sync when SSR props refresh (e.g. router.refresh()).
	useEffect(() => {
		if (initialSettings !== undefined) setSettings(initialSettings);
	}, [initialSettings]);

	const value = useMemo<SettingsSeedValue>(
		() => ({ settings, hasDictationKey }),
		[settings, hasDictationKey],
	);

	return <SettingsSeedContext.Provider value={value}>{children}</SettingsSeedContext.Provider>;
}

export function useSettingsSeed(): SettingsSeedValue | null {
	return useContext(SettingsSeedContext);
}
