"use client";

import { useEffect } from "react";
import { WORKSPACE_SCOPE, type ActivityKind } from "@/src/core";
import { startStudyHeartbeat } from "./heartbeat.ts";

export function StudyHeartbeat({ kind, domain }: { kind: ActivityKind; domain: string | null }) {
	useEffect(() => startStudyHeartbeat({
		document, window, now: Date.now, schedule(fn, delay) {
			const timer = window.setInterval(fn, delay);
			return () => window.clearInterval(timer);
		},
	}, domain ?? WORKSPACE_SCOPE, kind, event => {
		void fetch("/api/stats/activity", {
			method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify(event),
		}).then(res => {
			if (!res.ok) console.warn("[stats] activity rejected", res.status);
		}).catch(error => console.warn("[stats] activity unavailable", error));
	}), [domain, kind]);
	return null;
}
