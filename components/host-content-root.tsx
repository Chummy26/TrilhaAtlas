"use client";

import { createContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** The host's content column, excluding the sidebar. Portals retain app contexts. */
export const HostContentRootContext = createContext<HTMLElement | null>(null);

/** Private host route instance, shared with widgets portaled outside page trees.
 * Cleanup expires an opening even when Next retains its source in Activity. */
export interface HostRouteLifetime { pathname: string; signal: AbortSignal }
export const HostRouteLifetimeContext = createContext<HostRouteLifetime | null>(null);

interface ActiveRouteLifetime {
	pathname: string;
	controller: AbortController;
	value: HostRouteLifetime;
	mounted: boolean;
}

export function HostRouteLifetimeProvider({ pathname, children }: { pathname: string; children: ReactNode }) {
	const [, forceRefresh] = useState(0);
	const activeRef = useRef<ActiveRouteLifetime | null>(null);
	if (!activeRef.current || activeRef.current.pathname !== pathname || activeRef.current.controller.signal.aborted) {
		const controller = new AbortController();
		activeRef.current = {
			pathname,
			controller,
			value: { pathname, signal: controller.signal },
			mounted: false,
		};
	}
	const current = activeRef.current;
	useLayoutEffect(() => {
		if (current.controller.signal.aborted) {
			forceRefresh((n) => n + 1);
			return;
		}
		current.mounted = true;
		return () => {
			current.mounted = false;
			if (activeRef.current !== current) {
				// Pathname transitioned: expire the previous route lifetime synchronously.
				current.controller.abort();
			} else {
				// Defer unmount/Activity-hide abort by a microtask so StrictMode's
				// synchronous effect replay re-marks `mounted = true` without aborting.
				queueMicrotask(() => {
					if (!current.mounted) current.controller.abort();
				});
			}
		};
	}, [current]);
	return <HostRouteLifetimeContext.Provider value={current.value}>{children}</HostRouteLifetimeContext.Provider>;
}
