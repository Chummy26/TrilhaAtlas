"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	GOOGLE_VERTEX_COMMON_LOCATIONS,
	GOOGLE_VERTEX_DEFAULT_LOCATION,
	type GoogleVertexSettings,
	type GoogleVertexStatus,
	type UserSettings,
} from "@/src/core";
import { useT } from "@/components/i18n";
import { notifySettingsSaved, useSettingsSaved } from "@/components/settings-signal";
import { Button } from "@/components/ui/button";
import { Toggle } from "./controls.tsx";

export function GoogleVertexStatusPanel() {
	const t = useT();
	const [enabled, setEnabled] = useState(false);
	const [project, setProject] = useState("");
	const [location, setLocation] = useState("");
	const [loaded, setLoaded] = useState(false);
	const [saving, setSaving] = useState(false);
	const [savedNote, setSavedNote] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState<GoogleVertexStatus | null>(null);
	const [busy, setBusy] = useState(false);
	const statusReq = useRef<AbortController | null>(null);
	const settingsRead = useRef<AbortController | null>(null);
	const settingsWrite = useRef<AbortController | null>(null);

	const refreshStatus = useCallback(async () => {
		statusReq.current?.abort();
		const controller = new AbortController();
		statusReq.current = controller;
		setBusy(true);
		try {
			const response = await fetch("/api/google-vertex", {
				cache: "no-store",
				signal: controller.signal,
				headers: { "x-learnharness-google-vertex": "1" },
			});
			if (!response.ok) throw new Error("status unavailable");
			const value = (await response.json()) as GoogleVertexStatus;
			if (!controller.signal.aborted) setStatus(value);
		} catch {
			if (!controller.signal.aborted) setStatus(null);
		} finally {
			if (!controller.signal.aborted) setBusy(false);
		}
	}, []);

	const read = useCallback(async () => {
		settingsRead.current?.abort();
		const controller = new AbortController();
		settingsRead.current = controller;
		setLoaded(false);
		try {
			const response = await fetch("/api/settings", { cache: "no-store", signal: controller.signal });
			if (!response.ok) throw new Error("settings unavailable");
			const body = (await response.json()) as { settings: UserSettings | null };
			if (!controller.signal.aborted) {
				const gv = body.settings?.googleVertex;
				setEnabled(gv?.enabled === true);
				setProject(gv?.project ?? "");
				setLocation(gv?.location ?? "");
				setLoaded(true);
				setError(null);
			}
		} catch {
			if (!controller.signal.aborted) setError(t("settings.vertex.loadError"));
		}
	}, [t]);

	useEffect(() => {
		void read();
		return () => {
			settingsRead.current?.abort();
			settingsWrite.current?.abort();
			statusReq.current?.abort();
		};
	}, [read]);

	useSettingsSaved((section) => {
		if (section === "googleVertex") void read();
	});

	useEffect(() => {
		if (enabled) void refreshStatus();
		else {
			statusReq.current?.abort();
			setStatus(null);
			setBusy(false);
		}
	}, [enabled, refreshStatus]);

	const persist = async (next: GoogleVertexSettings) => {
		settingsWrite.current?.abort();
		const controller = new AbortController();
		settingsWrite.current = controller;
		settingsRead.current?.abort();
		setSaving(true);
		setSavedNote(false);
		setError(null);
		try {
			const response = await fetch("/api/settings/googleVertex", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(next),
				signal: controller.signal,
			});
			if (!response.ok) {
				const body = (await response.json().catch(() => ({}))) as { error?: string };
				throw new Error(body.error ?? t("settings.vertex.saveError"));
			}
			const body = (await response.json()) as { settings: UserSettings };
			if (!controller.signal.aborted) {
				const gv = body.settings?.googleVertex;
				setEnabled(gv?.enabled === true);
				setProject(gv?.project ?? "");
				setLocation(gv?.location ?? "");
				setSavedNote(true);
				notifySettingsSaved("googleVertex");
				if (gv?.enabled) void refreshStatus();
			}
		} catch (err) {
			if (!controller.signal.aborted) {
				setError(err instanceof Error && err.message ? err.message : t("settings.vertex.saveError"));
			}
		} finally {
			if (!controller.signal.aborted) setSaving(false);
		}
	};

	const statusLine = (() => {
		if (busy) return t("settings.vertex.checking");
		if (!status) return t("settings.vertex.statusUnavailable");
		if (!status.adcPresent) return t("settings.vertex.statusMissingAdc");
		if (!status.project) return t("settings.vertex.statusMissingProject");
		return t("settings.vertex.statusReady", { project: status.project, location: status.location });
	})();

	const autoProjectPlaceholder =
		status?.project && status.projectSource !== "settings"
			? t("settings.vertex.projectAutoPlaceholder", { project: status.project })
			: t("settings.vertex.projectPlaceholder");

	return (
		<div className="space-y-2.5" data-testid="google-vertex-settings">
			<div className="flex items-center gap-3">
				<span className="font-prose text-(length:--lh-prose-size) text-foreground">
					{t("settings.vertex.title")}
				</span>
				<Toggle
					label={t("settings.vertex.title")}
					checked={enabled}
					disabled={!loaded || saving}
					onChange={(next) =>
						void persist({
							enabled: next,
							...(project.trim() ? { project: project.trim() } : {}),
							...(location.trim() ? { location: location.trim() } : {}),
						})
					}
				/>
			</div>
			{error && (
				<p role="alert" className="text-xs text-error" data-testid="google-vertex-error">
					{error}
				</p>
			)}
			{enabled && (
				<>
					<div className="flex flex-wrap items-center gap-3">
						<span role="status" className="text-xs text-muted-foreground" data-testid="google-vertex-status">
							{statusLine}
						</span>
						<Button
							type="button"
							size="xs"
							variant="outline"
							className="cursor-pointer disabled:cursor-not-allowed"
							disabled={busy}
							onClick={() => void refreshStatus()}
							data-testid="google-vertex-check-again"
						>
							{t("settings.vertex.checkAgain")}
						</Button>
					</div>

					<form
						className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
						onSubmit={(e) => {
							e.preventDefault();
							void persist({
								enabled: true,
								project: project.trim(),
								location: location.trim(),
							});
						}}
					>
						<label className="flex flex-col gap-1">
							<span className="text-xs text-muted-foreground">{t("settings.vertex.projectLabel")}</span>
							<input
								type="text"
								value={project}
								onChange={(e) => {
									setProject(e.target.value);
									setSavedNote(false);
								}}
								placeholder={autoProjectPlaceholder}
								data-testid="google-vertex-project"
								disabled={saving}
								className="h-7 rounded-sm border border-border bg-background px-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-muted-foreground/50"
							/>
						</label>

						<label className="flex flex-col gap-1">
							<span className="text-xs text-muted-foreground">{t("settings.vertex.locationLabel")}</span>
							<input
								type="text"
								list="google-vertex-locations"
								value={location}
								onChange={(e) => {
									setLocation(e.target.value);
									setSavedNote(false);
								}}
								placeholder={GOOGLE_VERTEX_DEFAULT_LOCATION}
								data-testid="google-vertex-location"
								disabled={saving}
								className="h-7 rounded-sm border border-border bg-background px-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-muted-foreground/50"
							/>
							<datalist id="google-vertex-locations">
								{GOOGLE_VERTEX_COMMON_LOCATIONS.map((loc) => (
									<option key={loc} value={loc} />
								))}
							</datalist>
						</label>

						<div className="flex items-center gap-2">
							<Button
								type="submit"
								size="xs"
								variant="outline"
								disabled={saving}
								className="cursor-pointer disabled:cursor-not-allowed"
								data-testid="google-vertex-save"
							>
								{t("settings.vertex.save")}
							</Button>
							{savedNote && (
								<span className="text-xs text-muted-foreground" data-testid="google-vertex-saved">
									{t("settings.vertex.saved")}
								</span>
							)}
						</div>
					</form>

					<p className="text-xs leading-relaxed text-muted-foreground">
						{t("settings.vertex.hint")}{" "}
						<a
							href="https://cloud.google.com/docs/authentication/provide-credentials-adc"
							target="_blank"
							rel="noreferrer"
							className="underline underline-offset-2 hover:text-foreground"
						>
							{t("settings.vertex.docsLink")}
						</a>
					</p>
				</>
			)}
		</div>
	);
}
