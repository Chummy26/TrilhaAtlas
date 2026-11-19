import { IDLE_TIMEOUT_SEC, STUDY_HEARTBEAT_SEC, type ActivityEvent, type ActivityKind } from "@/src/core";

interface HeartbeatClock {
	window: EventTarget;
	document: EventTarget & {
		visibilityState: string;
		hasFocus(): boolean;
		querySelectorAll(selector: "video"): ArrayLike<Pick<HTMLVideoElement, "paused" | "ended" | "readyState" | "seeking">>;
	};
	now(): number;
	schedule(tick: () => void, delay: number): () => void;
}

/** Emit actual [start,end) intervals. A late tick after idle uses the idle
 * deadline as its end so overlaps and local midnight are attributed correctly. */
export function startStudyHeartbeat(clock: HeartbeatClock, domain: string, kind: ActivityKind, emit: (event: ActivityEvent) => void) {
	const { document: doc, window: win } = clock;
	const focused = () => doc.visibilityState === "visible" && doc.hasFocus();
	const playing = () => Array.from(doc.querySelectorAll("video")).some(v => !v.paused && !v.ended && !v.seeking && v.readyState >= 3);
	const period = STUDY_HEARTBEAT_SEC * 1000;
	const idle = IDLE_TIMEOUT_SEC * 1000;
	let start: number | null = null;
	let lastInput = 0;
	let media = false;
	function flush(now: number) {
		if (start === null) return;
		const end = media ? now : Math.min(now, lastInput + idle);
		while (start < end) {
			const stop = Math.min(start + period, end);
			emit({ at: new Date(stop).toISOString(), domain, kind: media ? "media" : kind, activeSec: (stop - start) / 1000 });
			start = stop;
		}
		start = now;
	}
	function enter() {
		if (start !== null || !focused()) return;
		start = lastInput = clock.now();
		media = playing();
	}
	function leave() {
		flush(clock.now());
		start = null;
		media = false;
	}
	function visibility() {
		if (focused()) enter();
		else leave();
	}
	function interact() {
		if (!focused()) return;
		enter();
		const now = clock.now();
		if (!media && now > lastInput + idle) flush(now);
		lastInput = now;
	}
	function videoChanged() {
		if (start === null) return;
		const next = playing();
		if (media === next) return;
		flush(clock.now());
		media = next;
	}
	const listeners = new AbortController();
	const options = { signal: listeners.signal, passive: true, capture: true };
	for (const event of ["keydown", "pointerdown", "pointermove", "scroll", "touchstart"]) doc.addEventListener(event, interact, options);
	for (const event of ["playing", "pause", "ended", "waiting", "seeking", "emptied"]) doc.addEventListener(event, videoChanged, options);
	doc.addEventListener("visibilitychange", visibility, options);
	win.addEventListener("focus", enter, { signal: listeners.signal });
	win.addEventListener("blur", leave, { signal: listeners.signal });
	win.addEventListener("pagehide", leave, options);
	win.addEventListener("pageshow", enter, options);
	enter();
	const cancel = clock.schedule(() => {
		visibility();
		videoChanged();
		flush(clock.now());
	}, period);
	return () => { cancel(); listeners.abort(); leave(); };
}
