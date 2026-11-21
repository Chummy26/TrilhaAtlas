"use client";
/**
 * THE SETTINGS DIALOG host provider: keeps the always-mounted shell lightweight
 * and loads the heavy dialog modal + settings sections on demand when opened.
 */

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import { useInteractionLayers, type CloseOutcome } from "@/components/interaction-layers";
import { CURRENT_SETTINGS_VERSION, type UserSettings } from "@/src/core";
import { ChatGPTUIProvider } from "./chatgpt-connection.tsx";
import { NativeSubscriptionUIProvider } from "./subscription-connections.tsx";

export { SettingsDialogBody } from "./settings-dialog-modal.tsx";

const SettingsDialogModal = dynamic(() =>
	import("./settings-dialog-modal.tsx").then((m) => m.SettingsDialogModal),
);

export type SectionId = "keys" | "agent" | "appearance" | "graph" | "keyboard" | "general" | "plugins" | "core-plugins" | `plugin:${string}`;

/** `open(section?, row?)` — the optional ROW deep-links into the Keys
 *  section with that row unfolded (`row` is the env-var key ID). */
const DialogContext = createContext<{ open: (section?: string, row?: string) => void }>({ open: () => {} });

// Authority belongs to the persistent Settings host, not a particular field or
// open/close lifetime: a delayed response must not roll back a newer ACK.
export interface SettingsWriteOrder {
	issued: number;
	acknowledged: number;
	record?: UserSettings;
	fileAccessError?: string | null;
	listeners: Set<(record: UserSettings, fileAccessError: string | null) => void>;
}

/** AppShell-level mount: the sidebar row and the mod+, chord call this.
 *  `open(section)` lands the dialog on a specific section. */
export function SettingsDialogProvider({
	children, initialSettings,
}: {
	children: ReactNode; initialSettings?: UserSettings | null;
}) {
	const interactions = useInteractionLayers();
	const layerId = useId();
	const writeOrder = useRef<SettingsWriteOrder>({ issued: 0, acknowledged: 0, listeners: new Set(), record: initialSettings === null ? { version: CURRENT_SETTINGS_VERSION } : initialSettings });
	const [show, setShow] = useState(false);
	const [landOn, setLandOn] = useState<SectionId>("keys");
	const [landOnRow, setLandOnRow] = useState<string | null>(null);
	const [navigationRequest, setNavigationRequest] = useState(0);
	const open = useCallback((section?: string, row?: string) => {
		// Returning to this singleton is a bounded request, not a forced pop.
		// Controlled layers may accept closure before React commits it.
		if (interactions.getLayer(layerId) && interactions.popTo(layerId) !== "closed") return;
		interactions.invalidateOpening();
		setNavigationRequest(request => request + 1);
		setLandOn(section ? section as SectionId : "keys");
		setLandOnRow(row ?? null);
		setShow(true);
	}, [interactions, layerId]);
	const close = useCallback((): CloseOutcome => { setShow(false); return "closed"; }, []);
	useEffect(() => window.lh?.onOpenSettings?.((section) => open(section)), [open]);
	useEffect(() => {
		const onPluginSettings = (event: Event) => {
			const pluginId: unknown = (event as CustomEvent<unknown>).detail;
			if (typeof pluginId === "string") open(`plugin:${pluginId}`);
		};
		window.addEventListener("lh:open-plugin-settings", onPluginSettings);
		return () => window.removeEventListener("lh:open-plugin-settings", onPluginSettings);
	}, [open]);
	const dialogContextValue = useMemo(() => ({ open }), [open]);
	return (
		<ChatGPTUIProvider><NativeSubscriptionUIProvider><DialogContext.Provider value={dialogContextValue}>
			{children}
			{show && (
				<SettingsDialogModal onClose={close} initialSection={landOn} initialRow={landOnRow} navigationRequest={navigationRequest} layerId={layerId} writeOrder={writeOrder} />
			)}
		</DialogContext.Provider></NativeSubscriptionUIProvider></ChatGPTUIProvider>
	);
}

export function useSettingsDialog() {
	return useContext(DialogContext);
}
