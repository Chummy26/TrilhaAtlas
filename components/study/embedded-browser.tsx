"use client";

import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import {
	STUDY_BROWSER_NEWTAB_URL,
	normalizeBrowserAddressInput,
	parseExternalStudyUrl,
	type StudyBrowserViewMode,
} from "@/src/core";

// Mounted strictly on demand when the learner opens the embedded study browser.
const EmbeddedBrowserSidebar = dynamic(() =>
	import("./embedded-browser-sidebar").then((m) => m.EmbeddedBrowserSidebar),
);

export interface BrowserHistoryEntry {
	url: string;
	title?: string;
	mode?: StudyBrowserViewMode;
}

export interface BrowserTab {
	id: string;
	history: BrowserHistoryEntry[];
	index: number;
}

export interface StudyBrowserContextValue {
	isOpen: boolean;
	currentUrl: string | null;
	openBrowser: (url: string, title?: string, preferredMode?: StudyBrowserViewMode) => void;
	openNewTab: (url?: string, title?: string) => void;
	closeBrowser: () => void;
}

const StudyBrowserContext = createContext<StudyBrowserContextValue>({
	isOpen: false,
	currentUrl: null,
	openBrowser: () => {},
	openNewTab: () => {},
	closeBrowser: () => {},
});

export function useStudyBrowser() {
	return useContext(StudyBrowserContext);
}

export function formatDisplayHost(rawUrl: string): string {
	if (rawUrl === STUDY_BROWSER_NEWTAB_URL) return "nova-aba";
	try {
		return new URL(rawUrl).hostname.replace(/^www\./i, "");
	} catch {
		return rawUrl;
	}
}

let nextTabCounter = 1;
function createTabId(): string {
	return `tab-${nextTabCounter++}`;
}

export function activeEntryOf(tab: BrowserTab): BrowserHistoryEntry {
	return tab.history[tab.index] ?? tab.history[0] ?? { url: STUDY_BROWSER_NEWTAB_URL, title: "Nova aba" };
}

export function StudyBrowserProvider({ children }: { children: ReactNode }) {
	const [state, setState] = useState<{
		tabs: BrowserTab[];
		activeTabId: string | null;
		isOpen: boolean;
		recent: { url: string; title: string }[];
	}>({
		tabs: [],
		activeTabId: null,
		isOpen: false,
		recent: [],
	});

	const activeTab = useMemo(
		() => state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[0] ?? null,
		[state.tabs, state.activeTabId],
	);
	const currentEntry = activeTab ? activeEntryOf(activeTab) : null;

	const recordRecent = (
		recent: { url: string; title: string }[],
		url: string,
		title?: string,
	): { url: string; title: string }[] => {
		if (!url || url === STUDY_BROWSER_NEWTAB_URL) return recent;
		const label = title?.trim() || formatDisplayHost(url);
		return [{ url, title: label }, ...recent.filter((r) => r.url !== url)].slice(0, 8);
	};

	const navigateActiveTab = useCallback(
		(rawUrl: string, title?: string, preferredMode?: StudyBrowserViewMode) => {
			const valid =
				rawUrl === STUDY_BROWSER_NEWTAB_URL
					? STUDY_BROWSER_NEWTAB_URL
					: (parseExternalStudyUrl(rawUrl, typeof window !== "undefined" ? window.location.origin : undefined) ??
						normalizeBrowserAddressInput(rawUrl));
			if (!valid) return;

			setState((prev) => {
				const targetTab = prev.tabs.find((t) => t.id === prev.activeTabId) ?? prev.tabs[0];
				if (!targetTab) {
					const id = createTabId();
					const entry: BrowserHistoryEntry = {
						url: valid,
						...(title ? { title } : {}),
						...(preferredMode ? { mode: preferredMode } : {}),
					};
					return {
						tabs: [{ id, history: [entry], index: 0 }],
						activeTabId: id,
						isOpen: true,
						recent: recordRecent(prev.recent, valid, title),
					};
				}

				const current = activeEntryOf(targetTab);
				if (current.url === valid) {
					const updatedHistory = [...targetTab.history];
					updatedHistory[targetTab.index] = {
						...current,
						...(title ? { title } : {}),
						...(preferredMode ? { mode: preferredMode } : {}),
					};
					return {
						...prev,
						isOpen: true,
						tabs: prev.tabs.map((t) => (t.id === targetTab.id ? { ...t, history: updatedHistory } : t)),
						recent: recordRecent(prev.recent, valid, title ?? current.title),
					};
				}

				const sliced = targetTab.history.slice(0, targetTab.index + 1);
				const nextEntry: BrowserHistoryEntry = {
					url: valid,
					...(title ? { title } : {}),
					...(preferredMode ? { mode: preferredMode } : {}),
				};
				const nextHistory = [...sliced, nextEntry];
				return {
					...prev,
					isOpen: true,
					tabs: prev.tabs.map((t) =>
						t.id === targetTab.id ? { ...t, history: nextHistory, index: nextHistory.length - 1 } : t,
					),
					recent: recordRecent(prev.recent, valid, title),
				};
			});
		},
		[],
	);

	const openNewTab = useCallback((rawUrl?: string, title?: string) => {
		const valid =
			!rawUrl || rawUrl === STUDY_BROWSER_NEWTAB_URL
				? STUDY_BROWSER_NEWTAB_URL
				: (parseExternalStudyUrl(rawUrl, typeof window !== "undefined" ? window.location.origin : undefined) ??
					normalizeBrowserAddressInput(rawUrl) ??
					STUDY_BROWSER_NEWTAB_URL);

		setState((prev) => {
			const id = createTabId();
			const entry: BrowserHistoryEntry = {
				url: valid,
				title: title ?? (valid === STUDY_BROWSER_NEWTAB_URL ? "Nova aba" : undefined),
			};
			return {
				...prev,
				isOpen: true,
				tabs: [...prev.tabs, { id, history: [entry], index: 0 }],
				activeTabId: id,
				recent: recordRecent(prev.recent, valid, title),
			};
		});
	}, []);

	// Clicking an external link in the lesson/app opens in the current tab if it is a new-tab or closed,
	// reuses an existing tab if the URL is already open, or opens a new tab alongside existing tabs.
	const openBrowser = useCallback(
		(rawUrl: string, title?: string, preferredMode?: StudyBrowserViewMode) => {
			const valid =
				parseExternalStudyUrl(rawUrl, typeof window !== "undefined" ? window.location.origin : undefined) ??
				normalizeBrowserAddressInput(rawUrl);
			if (!valid) return;

			setState((prev) => {
				// 1. Check if any open tab already has this active URL
				const existing = prev.tabs.find((t) => activeEntryOf(t).url === valid);
				if (existing) {
					return {
						...prev,
						isOpen: true,
						activeTabId: existing.id,
						recent: recordRecent(prev.recent, valid, title),
					};
				}

				// 2. If the active tab is a blank new-tab, navigate inside it
				const currentTab = prev.tabs.find((t) => t.id === prev.activeTabId) ?? prev.tabs[0];
				if (currentTab && activeEntryOf(currentTab).url === STUDY_BROWSER_NEWTAB_URL) {
					const entry: BrowserHistoryEntry = {
						url: valid,
						...(title ? { title } : {}),
						...(preferredMode ? { mode: preferredMode } : {}),
					};
					return {
						...prev,
						isOpen: true,
						activeTabId: currentTab.id,
						tabs: prev.tabs.map((t) => (t.id === currentTab.id ? { ...t, history: [entry], index: 0 } : t)),
						recent: recordRecent(prev.recent, valid, title),
					};
				}

				// 3. Otherwise open a fresh tab so the learner never loses their open reference page
				const id = createTabId();
				const entry: BrowserHistoryEntry = {
					url: valid,
					...(title ? { title } : {}),
					...(preferredMode ? { mode: preferredMode } : {}),
				};
				return {
					...prev,
					isOpen: true,
					tabs: [...prev.tabs, { id, history: [entry], index: 0 }],
					activeTabId: id,
					recent: recordRecent(prev.recent, valid, title),
				};
			});
		},
		[],
	);

	const selectTab = useCallback((tabId: string) => {
		setState((prev) => (prev.tabs.some((t) => t.id === tabId) ? { ...prev, activeTabId: tabId } : prev));
	}, []);

	const closeTab = useCallback((tabId: string) => {
		setState((prev) => {
			const idx = prev.tabs.findIndex((t) => t.id === tabId);
			if (idx === -1) return prev;
			const remaining = prev.tabs.filter((t) => t.id !== tabId);
			if (remaining.length === 0) {
				return { ...prev, tabs: [], activeTabId: null, isOpen: false };
			}
			const nextActiveId =
				prev.activeTabId === tabId
					? (remaining[Math.min(idx, remaining.length - 1)]?.id ?? remaining[0]!.id)
					: prev.activeTabId;
			return {
				...prev,
				tabs: remaining,
				activeTabId: nextActiveId,
			};
		});
	}, []);

	const updateTabTitle = useCallback((tabId: string, title: string) => {
		if (!title.trim()) return;
		setState((prev) => ({
			...prev,
			tabs: prev.tabs.map((tab) => {
				if (tab.id !== tabId) return tab;
				const current = activeEntryOf(tab);
				if (current.title === title.trim()) return tab;
				const nextHistory = [...tab.history];
				nextHistory[tab.index] = { ...current, title: title.trim() };
				return { ...tab, history: nextHistory };
			}),
		}));
	}, []);

	const closeBrowser = useCallback(() => {
		setState((prev) => (prev.isOpen ? { ...prev, isOpen: false } : prev));
	}, []);

	const goBack = useCallback(() => {
		setState((prev) => {
			const tab = prev.tabs.find((t) => t.id === prev.activeTabId);
			if (!tab || tab.index <= 0) return prev;
			return {
				...prev,
				tabs: prev.tabs.map((t) => (t.id === tab.id ? { ...t, index: t.index - 1 } : t)),
			};
		});
	}, []);

	const goForward = useCallback(() => {
		setState((prev) => {
			const tab = prev.tabs.find((t) => t.id === prev.activeTabId);
			if (!tab || tab.index >= tab.history.length - 1) return prev;
			return {
				...prev,
				tabs: prev.tabs.map((t) => (t.id === tab.id ? { ...t, index: t.index + 1 } : t)),
			};
		});
	}, []);

	const handleContainerClickCapture = useCallback(
		(event: ReactMouseEvent<HTMLDivElement>) => {
			if (event.defaultPrevented || (typeof event.button === "number" && event.button !== 0)) return;
			if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
			const target = event.target;
			if (!(target instanceof Element)) return;
			const anchor = target.closest<HTMLAnchorElement>("a[href]");
			if (!anchor) return;
			if (
				anchor.dataset?.browserExternal === "true" ||
				anchor.getAttribute("data-browser-external") === "true" ||
				anchor.hasAttribute("download")
			) {
				return;
			}

			const rawHref = anchor.getAttribute("href");
			const externalUrl = parseExternalStudyUrl(rawHref, window.location.origin);
			if (!externalUrl) return;

			event.preventDefault();
			event.stopPropagation();

			// Close transient dropdowns such as "Materiais da aula" so they do not cover the session.
			anchor.closest("details.mission-shelf")?.removeAttribute("open");

			const label =
				anchor.getAttribute("aria-label")?.trim() ||
				anchor.getAttribute("title")?.trim() ||
				anchor.textContent?.replace(/\s+/g, " ").trim() ||
				undefined;
			openBrowser(externalUrl, label);
		},
		[openBrowser],
	);

	const contextValue = useMemo<StudyBrowserContextValue>(
		() => ({
			isOpen: state.isOpen,
			currentUrl: currentEntry?.url ?? null,
			openBrowser,
			openNewTab,
			closeBrowser,
		}),
		[state.isOpen, currentEntry?.url, openBrowser, openNewTab, closeBrowser],
	);

	return (
		<StudyBrowserContext.Provider value={contextValue}>
			<div className="flex min-h-0 min-w-0 flex-1 overflow-hidden" onClickCapture={handleContainerClickCapture}>
				{children}
				{state.isOpen && activeTab && currentEntry && (
					<EmbeddedBrowserSidebar
						tabs={state.tabs}
						activeTab={activeTab}
						entry={currentEntry}
						recent={state.recent}
						canGoBack={activeTab.index > 0}
						canGoForward={activeTab.index < activeTab.history.length - 1}
						onBack={goBack}
						onForward={goForward}
						onNavigate={navigateActiveTab}
						onNewTab={openNewTab}
						onSelectTab={selectTab}
						onCloseTab={closeTab}
						onUpdateTabTitle={updateTabTitle}
						onClose={closeBrowser}
					/>
				)}
			</div>
		</StudyBrowserContext.Provider>
	);
}
