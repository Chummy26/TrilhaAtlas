/**
 * LearnHarness — the Electron shell (wrapper milestone, 2026-09-17).
 *
 * What this process is and is not:
 *   IS:  a thin launcher + security guard around the app's real server —
 *        `next build`'s standalone server.js (Next 16), spawned as a child
 *        on 127.0.0.1 with the BYOK auth file and the LH_DATA_DIR seam.
 *   NOT: a host for any app logic. Everything — teacher turns, extraction,
 *        the graph — runs in the Next server, unchanged.
 *
 * Pattern (fact-checked 2026-09-17 against current Electron 44 / Next 16
 * docs — see .memory release-strategy + electron-wrapper notes):
 *   - spawn via process.execPath + ELECTRON_RUN_AS_NODE=1 (Electron's
 *     bundled Node 24; the runAsNode fuse must stay enabled);
 *   - the server dir ships UNPACKED via extraResources (asar archives are
 *     read-only and native .node/dylib can't dlopen from one);
 *   - all mutable state under userData (never inside the .app bundle —
 *     translocated apps are read-only);
 *   - keys ride the child's ENV, never argv; auth.json (BYOK) is a flat
 *     {VAR: value} JSON map, plaintext, mode 0600 — server-managed since
 *     the auth-keys wave (2026-09-19): the child reads/writes it DIRECTLY
 *     (LH_AUTH_FILE below) and reflects values into its own env. The old
 *     spawn-time env injection retired with that wave — a copy made here
 *     would shadow every settings-page key change until restart.
 */

const { app, BrowserWindow, Menu, ipcMain, nativeTheme, session, shell, dialog } = require("electron");
const net = require("node:net");

// Mirrors SIDEBAR_AUTOCLOSE in components/sidebar.tsx — keep in sync (the
// renderer owns the number; this is the IPC widen target).
const SIDEBAR_AUTOCLOSE = 928;

// Top-level bindings initialized only on the GUI shell path (below) so
// --browser-service helper processes skip loading GUI/provider modules while
// keeping every binding visible to VM-based unit tests.
let pickAttachmentPath;
let createChatGPT, fileStore;
let attachChatGPTChild, trustedSender, chatGPTControl;
let createSubscriptions, loadSubscriptionSDK;
let attachSubscriptionChild, subscriptionControl;
let desktopAPIHeaders;
let cleanChromeUserAgent, embeddedSubframeResponseHeaders;
let startBrowserGateway;
let openWebSubscriptionBrowser;
let randomBytes, spawn, fs, http, path, NodeURL;
let normalizeAppearance, themeSourceFor, serverDataDir, readAppearance, chromeColors;
let isInstalledWindows = false;
let PRODUCT_NAME = "LearnHarness";
let appearance = null;
let serverProcess = null;
let chatgpt = null;
let chatgptChild = null;
let subscriptions = null;
let subscriptionChild = null;
// Per-launch request capability, never OAuth tokens and never renderer state.
let desktopAPISecret = null;
let reopenWindow = null;
const trustedAppWindows = new Set();
let trustedWindowsList = [];
const syncTrustedWindows = () => { trustedWindowsList = [...trustedAppWindows]; };
let logDirReady = false;
let logFilePath = null;
let logStream = null;
let sessionConfigured = false;

const AUTH_FILE = () => path.join(app.getPath("userData"), "auth.json");
const DATA_DIR = () => path.join(app.getPath("userData"), "data");

/** A free TCP port (listen(0) → the kernel assigns one). The close→spawn
 *  race is theoretical; localhost ports are rarely contended, and a failed
 *  spawn surfaces in the health check with the child's stderr in the log. */
function freePort() {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.listen(0, "127.0.0.1", () => {
			const { port } = srv.address();
			srv.close(() => resolve(port));
		});
		srv.on("error", reject);
	});
}

function applyChrome(win) {
	if (win.isDestroyed()) return;
	const colors = chromeColors(appearance);
	win.setBackgroundColor(colors.color);
	if (process.platform !== "darwin") win.setTitleBarOverlay(colors);
}

/** The packaged standalone server (extraResources → Resources/server).
 *  In dev LH_DEV_URL short-circuits everything: no spawn, no packaging —
 *  the window points at the running `next dev` server (full HMR). */
function serverEntry() {
	// extraResources ships the whole .next payload under server/standalone/
	// (copied from .next with an explicit filter — see electron-builder.yml).
	return path.join(process.resourcesPath, "server", "standalone", "server.js");
}

// ─── Single instance: two instances would fight over the data dir ─────────
// ─── Browser-service helper (Wave E stage 3, owner 2026-10-10) ────────
// The render engines for agent jobs: PDFs and SVGs rasterize natively
// (pdfjs+Skia, resvg — no browser); DEMOS execute JS and need one. The
// app's own Chromium serves that via this helper — the server spawns
//   <this binary> --browser-service
// and connects over CDP (system Chrome stays the fallback). Handshake:
// the helper prints "BROWSER_SERVICE_CDP <port>" on stdout once the CDP
// endpoint listens. Lifetime: parent IPC disconnect/death = quit.
// MUST run before loading GUI/provider modules, before the single-instance
// lock (a helper is a second instance of this binary), and before LH_DEV_URL
// (the helper owns no user data at all).
if (process.argv.includes("--browser-service")) {
	const { waitForBrowserService } = require("./browser-service-readiness.cjs");
	// Own the helper's entire startup lifetime, including the readiness wait.
	const lifetime = new AbortController();
	const parentClosed = () => {
		lifetime.abort(new Error("browser-service parent IPC disconnected"));
		app.quit();
	};
	(async () => {
		try {
			// Full Windows Electron replaces stdin with synthetic EOF. Use the
			// real Node IPC channel, and refuse to start an unowned helper.
			if (!process.channel || !process.connected) throw new Error("browser-service requires connected parent IPC");
			process.once("disconnect", parentClosed);
			app.dock?.hide();
			const port = await freePort();
			// Must land before app-ready for Chromium to pick it up.
			app.commandLine.appendSwitch("remote-debugging-port", String(port));
			await app.whenReady();
			// A hidden window keeps the app lifecycle ordinary on every
			// platform (no window-all-closed handler is installed here).
			const win = new BrowserWindow({ show: false });
			await win.loadURL("about:blank");
			// Window load is not a DevTools HTTP readiness barrier. Confirm the
			// endpoint before both production and smoke clients see the handshake.
			await waitForBrowserService(port, { signal: lifetime.signal });
			if (!lifetime.signal.aborted) console.log(`BROWSER_SERVICE_CDP ${port}`);
		} catch (err) {
			if (lifetime.signal.aborted) return; // Parent disconnect is normal.
			console.error("browser-service failed:", err);
			app.exit(1);
		}
	})();
} else {
	({ pickAttachmentPath } = require("./attachment-picker.cjs"));
	({ createChatGPT, fileStore } = require("./chatgpt.cjs"));
	({ attachChatGPTChild, trustedSender, chatGPTControl } = require("./chatgpt-ipc.cjs"));
	({ createSubscriptions, loadSubscriptionSDK } = require("./subscriptions.cjs"));
	({ attachSubscriptionChild, subscriptionControl } = require("./subscription-ipc.cjs"));
	({ desktopAPIHeaders } = require("./desktop-api.cjs"));
	({ cleanChromeUserAgent, embeddedSubframeResponseHeaders } = require("./embedded-browser-headers.cjs"));
	({ startBrowserGateway } = require("./browser-gateway.cjs"));
	({ openWebSubscriptionBrowser } = require("./web-subscription-browser.cjs"));
	({ randomBytes } = require("node:crypto"));
	({ spawn } = require("node:child_process"));
	fs = require("node:fs");
	http = require("node:http");
	path = require("node:path");
	({ URL: NodeURL } = require("node:url"));
	// Resolve the saved palette before window creation; renderer reports keep
	// it current after live saves. This helper needs no compiled server bundle.
	({ normalizeAppearance, themeSourceFor, serverDataDir, readAppearance, chromeColors } = require("./appearance-chrome.cjs"));

	isInstalledWindows = process.platform === "win32" && app.isPackaged;
	PRODUCT_NAME = isInstalledWindows ? "TrilhaAtlas" : "LearnHarness";

	// Set the name before resolving userData or applying the dev profile suffix.
	app.setName(PRODUCT_NAME);
	// Match the AUMID written by NSIS to the Start menu shortcut.
	if (isInstalledWindows) app.setAppUserModelId("com.learnharness.LearnHarness");
	appearance = normalizeAppearance(null);

	// A GUI shell must never die to a stray exception (EPIPE dialogs, a race
	// in an event handler): the window + child server are the product, and
	// anything main-side is recoverable by logging it. Log-and-continue.
	process.on("uncaughtException", (err) => {
		try {
			log(`uncaught: ${err?.stack ?? err}`, { sync: true });
		} catch {
			/* nothing left to write to */
		}
	});

	// Dev shell (LH_DEV_URL) runs BESIDE the packaged app, not instead of it:
	// its own userData so (a) the single-instance lock — checked below — doesn't
	// silently kill it, and (b) it never reads/writes the real app's
	// localStorage, auth.json, or logs. Must run before the lock check.
	if (process.env.LH_DEV_URL) {
		app.setPath("userData", `${app.getPath("userData")}-dev`);
	}

	// The whole normal boot — lock included — lives in this else: a helper is
	// a SECOND instance of this very binary on purpose (the running app owns
	// the lock), so it must never reach this check.
	if (!app.requestSingleInstanceLock()) {
		app.quit();
	} else {
		app.on("second-instance", () => {
			const win = BrowserWindow.getAllWindows()[0];
			if (win) {
				if (win.isMinimized()) win.restore();
				win.focus();
			}
		});
		main();
	}
}

/** BYOK keys: auth.json in userData, flat {VAR: value} map, 0600 —
 *  SERVER-MANAGED since the auth-keys wave (2026-09-19). This shell no
 *  longer reads or injects it: the child gets LH_AUTH_FILE below and does
 *  its own read/reflect/write, so a key saved in the settings page takes
 *  effect on the next model call — no restart. Real environment variables
 *  still win over the file inside the child (its documented rule). */

function ensureLogPath() {
	if (!logFilePath) {
		const dir = path.join(app.getPath("userData"), "logs");
		if (!logDirReady) {
			fs.mkdirSync(dir, { recursive: true });
			logDirReady = true;
		}
		logFilePath = path.join(dir, "main.log");
	}
	return logFilePath;
}

function log(line, { sync = false } = {}) {
	const stamp = new Date().toISOString();
	// The stdout write is guarded (EPIPE hardening, 2026-10-10): a packaged
	// app launched with a consumer-owned pipe (a launcher that exits, a
	// piped run) must not die on its next log line when the pipe breaks.
	// The file below stays the durable channel.
	try {
		console.log(`[lh ${stamp}] ${line}`);
	} catch {
		/* stdout gone — userData/logs/main.log still carries it */
	}
	// Belt and braces: also append to userData/logs so a misbehaving child
	// can be diagnosed after the window is gone. Best effort only.
	try {
		const target = ensureLogPath();
		const entry = `[${stamp}] ${line}\n`;
		if (!sync && typeof fs.createWriteStream === "function") {
			if (!logStream) {
				logStream = fs.createWriteStream(target, { flags: "a" });
				logStream.on("error", () => {
					logStream = null;
				});
			}
			logStream.write(entry);
		} else {
			fs.appendFileSync(target, entry);
		}
	} catch {
		/* best effort */
	}
}

function startServer(port) {
	return new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			// Only the macOS backend needs this: Next's native title setter
			// otherwise checks this Node-mode process in as a foreground app.
			process.platform === "darwin"
				? ["--require", path.join(process.resourcesPath, "server-title-guard.cjs"), serverEntry()]
				: [serverEntry()],
			{
				cwd: path.dirname(serverEntry()),
				env: {
					...process.env,
					ELECTRON_RUN_AS_NODE: "1",
					NODE_ENV: "production",
					PORT: String(port),
					HOSTNAME: "127.0.0.1", // the server defaults to 0.0.0.0 — never
					LH_DATA_DIR: DATA_DIR(),
					// The auth/keys store — the child reads AND writes this file itself
					// (no env injection anymore: a spawn-time copy would shadow every
					// settings-page key change until restart; env wins over file).
					LH_AUTH_FILE: AUTH_FILE(),
					LH_DESKTOP_SERVER: "1",
					LH_DESKTOP_API_SECRET: desktopAPISecret,
				},
				stdio: ["ignore", "pipe", "pipe", "ipc"],
			},
		);
		serverProcess = child;
		chatgptChild = attachChatGPTChild(child, chatgpt);
		subscriptionChild = attachSubscriptionChild(child, subscriptions);
		const fwd = (buf) => buf.toString().trimEnd().split("\n").forEach((l) => l && log(`server: ${l}`));
		child.stdout.on("data", fwd);
		child.stderr.on("data", fwd);
		child.on("exit", (code, signal) => {
			log(`server exited (code=${code} signal=${signal})`);
			serverProcess = null;
			chatgptChild?.dispose();
			chatgptChild = null;
			subscriptionChild?.dispose();
			subscriptionChild = null;
			chatgpt?.close();
			subscriptions?.close();
		});
		resolve(child);
	});
}

/** No "ready" event exists — poll /api/health (falling back cleanly to / on 404)
 *  with fast exponential backoff (25ms → 50ms → 100ms cap) and per-request timeout. */
function waitUntilUp(url, { timeoutMs = 30000, requestTimeoutMs = 1500 } = {}) {
	const healthUrl = new NodeURL("/api/health", url).toString();
	const headers = desktopAPISecret ? { "x-learnharness-desktop": desktopAPISecret } : undefined;
	return new Promise((resolve, reject) => {
		const deadline = Date.now() + timeoutMs;
		let target = healthUrl;
		let delayMs = 25;
		let settled = false;
		const attempt = () => {
			if (settled) return;
			const remaining = deadline - Date.now();
			if (remaining <= 0) {
				settled = true;
				reject(new Error(`server never answered on ${url}`));
				return;
			}
			let retryScheduled = false;
			const scheduleRetry = () => {
				if (settled || retryScheduled) return;
				retryScheduled = true;
				if (Date.now() >= deadline) {
					settled = true;
					reject(new Error(`server never answered on ${url}`));
					return;
				}
				const wait = Math.min(delayMs, Math.max(0, deadline - Date.now()));
				delayMs = Math.min(delayMs * 2, 100);
				setTimeout(attempt, wait);
			};
			const req = http.get(
				target,
				{ agent: false, ...(headers ? { headers } : {}), timeout: Math.min(requestTimeoutMs, remaining) },
				(res) => {
					res.on("error", () => {});
					res.resume();
					if (target === healthUrl && res.statusCode === 404) {
						target = url;
						attempt();
						return;
					}
					if (!settled) {
						settled = true;
						resolve(res.statusCode !== undefined);
					}
				},
			);
			req.on("timeout", () => req.destroy(new Error("health probe timeout")));
			req.on("error", scheduleRetry);
		};
		attempt();
	});
}

function killServer() {
	chatgpt?.close();
	subscriptions?.close();
	if (!serverProcess) return;
	const child = serverProcess;
	serverProcess = null;
	child.kill("SIGTERM");
	setTimeout(() => {
		try {
			child.kill("SIGKILL");
		} catch {
			/* already gone */
		}
	}, 3000);
}

/** Links leaving the app window may open only in a browser or mail client:
 *  the same schemes chat markdown makes clickable. Other schemes (smb:,
 *  file:, search-ms:, any app's custom handler) are dropped, and only the
 *  scheme is logged. */
const EXTERNAL_LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);
function openExternalLink(target) {
	let scheme = "unparseable";
	try {
		scheme = new NodeURL(target).protocol;
	} catch { /* logged below */ }
	if (EXTERNAL_LINK_SCHEMES.has(scheme)) {
		void shell.openExternal(target);
		return;
	}
	log(`external link blocked (scheme ${scheme.slice(0, 40)})`);
}

/** Security posture (all defaults asserted explicitly; the guards are the
 *  checklist's own recommendations for localhost-app shells):
 *  - deny-by-default permission handler allowing only our loopback origin
 *    (groundwork for the mic/STT milestone — Electron auto-approves by
 *    default, we do not);
 *  - will-navigate pinned to the app origin; window.open always denied —
 *    external links go to the real browser via shell.openExternal, for
 *    http, https and mailto only (openExternalLink). */
function windowIconPath() {
	if (process.platform === "darwin" || typeof fs.existsSync !== "function") return undefined;
	const filename = process.platform === "win32" ? "icon.ico" : "icon.png";
	const candidates = [
		app.isPackaged && typeof process.resourcesPath === "string"
			? path.join(process.resourcesPath, filename)
			: null,
		path.join(__dirname, "..", "build", filename),
	];
	return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function configureSession(ownedOrigin) {
	if (sessionConfigured) return;
	sessionConfigured = true;
	// Deny-by-default; the ONLY grants are media (mic/STT groundwork),
	// clipboard-sanitized-write, and local-fonts — loopback-origin only.
	const allowedPermissions = new Set(["media", "clipboard-sanitized-write", "local-fonts"]);
	const fromOwnOrigin = (origin, permission) =>
		origin === ownedOrigin && allowedPermissions.has(permission);
	session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
		let requestOrigin = null;
		try {
			requestOrigin = details.requestingUrl ? new NodeURL(details.requestingUrl).origin : null;
		} catch { /* malformed requestingUrl denied */ }
		callback(fromOwnOrigin(requestOrigin, permission));
	});
	session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => {
		return fromOwnOrigin(origin, permission);
	});
	if (typeof session.defaultSession.getUserAgent === "function" && typeof session.defaultSession.setUserAgent === "function") {
		const cleanUa = cleanChromeUserAgent(session.defaultSession.getUserAgent());
		if (cleanUa) session.defaultSession.setUserAgent(cleanUa);
	}
	session.defaultSession.webRequest?.onHeadersReceived?.({ urls: ["<all_urls>"] }, (details, callback) => {
		callback({ responseHeaders: embeddedSubframeResponseHeaders(details, ownedOrigin) });
	});
}

function createWindow(url, { deferLoad = false } = {}) {
	const icon = windowIconPath();
	const win = new BrowserWindow({
		width: 1440,
		height: 900,
		title: PRODUCT_NAME,
		...(icon ? { icon } : {}),
		// Merged chrome (owner, 2026-09-17): the system title bar is gone;
		// the app's own 60px header bands ARE the title bar. The traffic
		// lights float over the sidebar's LH wordmark band, vertically
		// Aligned to the PHASE PILL's drawn box, not the band's geometric
		// center (owner ask, 2026-09-17): macOS centers each 12px circle at
		// y+6.75, and the pill box center measures 29.25 in the running app
		// (band 0–59.5, pill box 19–39.5) — y 22.5 lands the circles at
		// 29.25, exactly on the pill. Wordmark gutter: components/sidebar.tsx.
		// Dragging comes from the renderer's .lh-drag bands (app/globals.css).
		...(process.platform === "darwin"
			? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: 22.5 } }
			: {
				titleBarStyle: "hidden",
				// Native min/max/close on the right, at the OS's compact default
				// height. Do not force the zoom-invariant native overlay to match
				// the renderer's 60 CSS px bar: zooming out would cover its border.
				// The renderer reserves the actual width via env(titlebar-area-*).
				titleBarOverlay: chromeColors(appearance),
				// Keep the custom bar alone; Alt reveals the native menu.
				autoHideMenuBar: true,
			}),
		webPreferences: {
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			...(process.env.LH_DEV_URL ? { additionalArguments: ["--lh-web-subscriptions"] } : {}),
			preload: path.join(__dirname, "preload.cjs"),
		},
		// Live-resize + first-paint flash (owner, 2026-09-17): during a resize
		// the native window surface changes size before Chromium's compositor
		// has a frame at the new size, and the gap shows the window's NATIVE
		// background — Electron's default is white, glaring on a dark app.
		// The app's background for the rendered mode fills the lag instead
		// (chromeColors). `show: false` + ready-to-show is the same treatment
		// for first paint: the window appears only once the page has
		// actually rendered.
		backgroundColor: chromeColors(appearance).color,
		show: false,
		// Narrow-window behavior (owner, 2026-09-17): 640px is the floor —
		// below it even a wrapped chrome row gets cramped and the chat header
		// (lights gutter 92 + toggle + title) runs out of room. The sidebar
		// auto-closes below 928 = 640 + 288 (sidebar) in the renderer
		// (components/sidebar.tsx, SIDEBAR_AUTOCLOSE); its "lh:expand-window"
		// IPC widens the window back to that threshold.
		minWidth: 640,
		minHeight: 600,
	});

	trustedAppWindows.add(win);
	syncTrustedWindows();
	win.once("closed", () => {
		trustedAppWindows.delete(win);
		syncTrustedWindows();
	});
	const winOrigin = new NodeURL(url).origin;

	win.webContents.on("will-navigate", (event, target) => {
		if (new NodeURL(target).origin !== winOrigin) {
			event.preventDefault();
			openExternalLink(target);
		}
	});
	win.webContents.setWindowOpenHandler(({ url: target }) => {
		openExternalLink(target);
		return { action: "deny" };
	});

	if (!deferLoad) void win.loadURL(url);
	// Zoom truth reaches the renderer for EVERY load (reload, nav): the
	// renderer's --lh-zoom must never go stale. The fallback catcher below
	// covers ⌘= / layout variants the menu's ⌘Plus may not claim — menu-
	// claimed keys never reach before-input-event, so exactly one of the
	// two applies any given zoom keypress.
	win.webContents.on("did-finish-load", () => {
		win.webContents.send("lh:zoom", win.webContents.getZoomFactor());
	});
	win.webContents.on("before-input-event", (event, input) => {
		if (input.type !== "keyDown" || !(input.meta || input.control)) return;
		if (input.key === "=" || input.key === "+") zoomStep(win, +1);
		else if (input.key === "-") zoomStep(win, -1);
		else if (input.key === "0") applyZoom(win, 1);
		else return;
		event.preventDefault();
	});

	win.once("ready-to-show", () => win.show());
	return win;
}

/* ── Zoom (owner round 7, 2026-10-05): ⌘±/⌘0 as an OWNED ladder ──────────
 * The stock zoomIn/zoomOut roles change zoomLevel silently — the renderer
 * never learns the factor, and the native traffic lights (physical-fixed,
 * hiddenInset) drift out of relation to the scaled chrome: the graph
 * button rides away from them zoomed in, content slides under them
 * zoomed out. Here zoom is explicit: a factor ladder, applied through
 * setZoomFactor, and broadcast to the renderer ("lh:zoom" — it publishes
 * --lh-zoom so gutter lengths can divide by it and stay PHYSICAL-
 * constant). The traffic lights themselves stay at their construction
 * position ({x:16, y:22.5} — Electron 44 has NO runtime setter, only
 * the BrowserWindow option), which is HIG-correct anyway: native lights
 * hug the window corner while the web chrome compensates around them.
 * Vertical note: at large factors the taller bands' content centers
 * drift below the fixed lights — accepted (the alternative, moving the
 * lights, is impossible without rebuilding the window). */
const ZOOM_LADDER = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

/* ── Auto-update (Wave C, owner 2026-10-10: silent download + restart ─────
 * banner; checks at startup + every 24h) ─────────────────────────────────
 *
 * Feed: GitHub Releases (electron-builder.yml publish → app-update.yml,
 * baked + signed into the bundle). macOS needs the app signed (it is —
 * Developer ID) and updates ride the zip target (Squirrel.Mac); blockmaps
 * give differential downloads for free. Windows uses NSIS; Linux uses
 * AppImage or DebUpdater (6.8.9 supports deb; installation can request
 * administrator permission via the package manager — owner 2026-10-11).
 *
 * Hard rules:
 *  - DEV NEVER UPDATES: !app.isPackaged skips the updater entirely — the
 *    dev world runs `next dev` and has no signed bundle.
 *  - THE UPDATER CAN NEVER TAKE THE APP DOWN: every event and check is
 *    caught and logged (feed down, disk full, bad signature — all just
 *    log lines; the app keeps working, update or no update).
 *  - LH_UPDATE_FEED (env): overrides the baked GitHub feed with a generic
 *    local server — the pre-release verification drill (serve
 *    latest-mac.yml + zip + blockmap from any localhost HTTP dir and
 *    watch a real installed copy find/download/restart). Test-only seam.
 *
 * Install path: the downloaded update applies on quit (autoInstallOnAppQuit
 * — Squirrel.Mac stages natively and swaps on relaunch). The renderer
 * banner asks for an immediate restart via "lh:update-install"; we kill
 * the child server FIRST — deterministic ordering: the server lives
 * inside the .app bundle Squirrel is about to replace (extraResources),
 * and before-quit alone would race the swap. */
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
let autoUpdater = null; // electron-updater's, packaged builds only
let autoUpdaterInitialized = false;
let autoUpdaterStarted = false;
// Observational only: this snapshot NEVER gates a check, download or install.
// The revision lets late subscribers reject an older in-flight IPC snapshot.
let updateState = { status: "idle", version: null, revision: 0 };

function reportUpdateStatus(status, version = null) {
	try {
		// A later check/error must not hide an update already staged for quit.
		if (updateState.status === "downloaded" && status !== "downloaded") return;
		updateState = { status, version: typeof version === "string" ? version : null, revision: updateState.revision + 1 };
		for (const win of BrowserWindow.getAllWindows()) {
			try {
				win.webContents.send("lh:update-status", updateState);
			} catch {
				/* window mid-teardown — snapshot retrieval covers a later load */
			}
		}
	} catch {
		/* Status reporting must never interrupt the updater. */
	}
}

/** Read the SAME data directory passed to the packaged server. Only an
 * explicit false opts out; absent/corrupt/unreadable settings keep updates ON.
 * Re-read for each automatic check so saving the toggle needs no restart. */
function automaticUpdatesEnabled() {
	try {
		const settings = JSON.parse(fs.readFileSync(path.join(DATA_DIR(), "settings.json"), "utf8"));
		return settings?.general?.autoUpdate !== false;
	} catch {
		return true;
	}
}

function ensureAutoUpdater() {
	if (!autoUpdaterInitialized) setupAutoUpdater();
}

function checkForUpdates({ manual = false } = {}) {
	ensureAutoUpdater();
	if (!autoUpdater) return;
	if (!manual && !automaticUpdatesEnabled()) {
		log("auto-update: automatic check skipped (turned off in Settings)");
		return;
	}
	// Do not gate on display state: a stale spinner/error must never disable
	// future background checks. electron-updater owns its in-flight work.
	autoUpdater
		.checkForUpdates()
		.then((result) => {
			// A declined check (e.g. an unsupported package) establishes no
			// latest-version claim. Real results arrive through updater events.
			if (!result) reportUpdateStatus("idle");
		})
		.catch((err) => {
			log(`update check failed: ${err?.message ?? err}`);
			reportUpdateStatus("error");
		});
}

function installUpdateNow() {
	// Kill the server BEFORE the quit-and-install (see block comment).
	try {
		killServer();
	} catch {
		/* already dead */
	}
	autoUpdater?.quitAndInstall();
}

function setupAutoUpdater() {
	autoUpdaterInitialized = true;
	if (!app.isPackaged) {
		log("auto-update: dev build — updater disabled");
		reportUpdateStatus("disabled");
		return;
	}
	try {
		autoUpdater = require("electron-updater").autoUpdater;
	} catch (err) {
		log(`auto-update: electron-updater unavailable (${err?.message ?? err}) — updates disabled`);
		reportUpdateStatus("disabled");
		return;
	}
	const feed = process.env.LH_UPDATE_FEED;
	if (feed) {
		autoUpdater.setFeedURL({ provider: "generic", url: feed });
		log(`auto-update: LH_UPDATE_FEED override → ${feed}`);
	}
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;
	// Route every updater log line through the shell's own log (userData/
	// logs/main.log) — feed failures must be diagnosable after the fact.
	autoUpdater.logger = {
		info: (m) => log(`updater: ${m}`),
		warn: (m) => log(`updater warn: ${m}`),
		debug: (m) => {}, // too chatty for the persistent log
		error: (m) => log(`updater error: ${m}`),
	};
	autoUpdater.on("checking-for-update", () => reportUpdateStatus("checking"));
	autoUpdater.on("update-available", (info) => reportUpdateStatus("downloading", info?.version));
	autoUpdater.on("update-not-available", () => reportUpdateStatus("up-to-date"));
	autoUpdater.on("update-downloaded", (info) => {
		log(`update downloaded: ${info?.version} — banner shown`);
		reportUpdateStatus("downloaded", info?.version);
	});
	autoUpdater.on("error", (err) => {
		log(`updater error: ${err?.message ?? err}`);
		reportUpdateStatus("error");
	});
}

function startAutoUpdater() {
	if (autoUpdaterStarted) return;
	autoUpdaterStarted = true;
	ensureAutoUpdater();
	if (autoUpdater) {
		checkForUpdates();
		setInterval(() => checkForUpdates(), UPDATE_CHECK_INTERVAL_MS);
	}
}

/** One result surface for manual checks. Preload buffers the navigation
 * request until React subscribes, including when all macOS windows closed. */
function checkForUpdatesFromMenu() {
	try {
		const win = BrowserWindow.getAllWindows()[0] ?? reopenWindow?.();
		if (win) {
			if (win.isMinimized()) win.restore();
			win.focus();
			const openSettings = () => {
				try { win.webContents.send("lh:open-settings", "general"); } catch { /* window closed */ }
			};
			if (win.webContents.isLoadingMainFrame()) win.webContents.once("did-finish-load", openSettings);
			else openSettings();
		}
	} catch {
		/* Navigation failure must not prevent the manual check. */
	}
	checkForUpdates({ manual: true });
}

function zoomStep(win, dir) {
	const current = win.webContents.getZoomFactor();
	const next =
		dir > 0
			? ZOOM_LADDER.find((f) => f > current + 0.001) ?? ZOOM_LADDER[ZOOM_LADDER.length - 1]
			: [...ZOOM_LADDER].reverse().find((f) => f < current - 0.001) ?? ZOOM_LADDER[0];
	applyZoom(win, next);
}

function applyZoom(win, factor) {
	factor = Math.min(2, Math.max(0.75, factor)); // ladder clamps; ⌘0 = 1
	win.webContents.setZoomFactor(factor);
	win.webContents.send("lh:zoom", factor);
}

/** macOS needs an application menu with the Edit roles — without one,
 *  Cmd+C/V/A do nothing in the renderer. Everything else stays minimal. */
function installMenu(openBrowser) {
	const template = [
		{
			label: app.name,
			submenu: [
				{ role: "about" },
				// Manual checks report their result in Settings → General.
				{ label: "Check for Updates…", click: () => checkForUpdatesFromMenu() },
				{ type: "separator" },
				{ role: "hide" },
				{ role: "hideOthers" },
				{ type: "separator" },
				{ role: "quit" },
			],
		},
		{ label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
		{
			label: "Exibir",
			submenu: [
				...(openBrowser ? [{ label: "Abrir no navegador", accelerator: "CommandOrControl+Shift+B", click: openBrowser }, { type: "separator" }] : []),
				{ role: "reload" },
				{ role: "toggleDevTools" },
				{ type: "separator" },
				// OWNED zoom (see applyZoom): the roles change zoomLevel
				// silently; these broadcast the factor and re-seat the
				// traffic lights. The renderer's --lh-zoom depends on
				// hearing every change.
				{
					label: "Actual Size",
					accelerator: "CommandOrControl+0",
					click: () => applyZoom(BrowserWindow.getAllWindows()[0], 1),
				},
				{
					label: "Zoom In",
					accelerator: "CommandOrControl+Plus",
					click: () => zoomStep(BrowserWindow.getAllWindows()[0], +1),
				},
				{
					label: "Zoom Out",
					accelerator: "CommandOrControl+-",
					click: () => zoomStep(BrowserWindow.getAllWindows()[0], -1),
				},
				{ type: "separator" },
				{ role: "togglefullscreen" },
			],
		},
		{ role: "windowMenu" },
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function main() {
	let browserGateway;
	app.on("window-all-closed", () => {
		chatgpt?.pause();
		subscriptions?.pause();
		// macOS convention: the app stays resident, reactivated from the Dock.
		if (process.platform !== "darwin") app.quit();
	});

	// The child must not outlive us — cover every quit path.
	app.on("before-quit", () => {
		void browserGateway?.then((gateway) => gateway.close(), () => {});
		killServer();
		logStream?.end();
		logStream = null;
	});
	process.on("exit", killServer);
	process.on("SIGHUP", killServer);

	await app.whenReady();

	// Read the same record/custom theme the server uses before constructing
	// any native window, including the external development shell.
	appearance = readAppearance(serverDataDir({
		devUrl: process.env.LH_DEV_URL, env: process.env,
		packagedDataDir: DATA_DIR(), repoRoot: path.join(__dirname, ".."),
	}));
	nativeTheme.themeSource = themeSourceFor(appearance.mode);

	// Dev mode: point at a running `next dev` server (LH_DEV_URL) — no
	// spawn, no packaging, full HMR. The rest of this shell still applies
	// (guards, menu, single instance).
	const devUrl = process.env.LH_DEV_URL;
	const url = devUrl ?? `http://127.0.0.1:${await freePort()}`;
	const ownedOrigin = new NodeURL(url).origin;
	configureSession(ownedOrigin);

	let serverReady = null;
	if (!devUrl) {
		desktopAPISecret = randomBytes(32).toString("hex");
		const apiPrefix = `${ownedOrigin}/api`;
		const DESKTOP_HEADER = "x-learnharness-desktop";
		// All URLs, not only /api: strip the secret on external redirects, while
		// fast-pathing static/non-API requests with zero URL/array allocations.
		session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ["<all_urls>"] }, (details, callback) => {
			const targetUrl = details.url;
			const nextChar = targetUrl.charCodeAt(apiPrefix.length);
			const isApi = targetUrl.startsWith(apiPrefix) && (
				targetUrl.length === apiPrefix.length || nextChar === 47 || nextChar === 63 || nextChar === 35
			);
			if (!isApi) {
				const reqHeaders = details.requestHeaders;
				let hasDesktopHeader = false;
				if (reqHeaders) {
					for (const name in reqHeaders) {
						if (name.toLowerCase() === DESKTOP_HEADER) {
							hasDesktopHeader = true;
							break;
						}
					}
				}
				if (!hasDesktopHeader) {
					callback({});
					return;
				}
			}
			callback({ requestHeaders: desktopAPIHeaders(details, ownedOrigin, desktopAPISecret, trustedWindowsList) });
		});
		chatgpt = createChatGPT({
			store: fileStore(path.join(app.getPath("userData"), "chatgpt-credentials.json")),
			openExternal: (target) => shell.openExternal(target),
			onChange: (value) => {
				chatgptChild?.send(value);
				for (const win of BrowserWindow.getAllWindows()) win.webContents.send("lh:chatgpt:changed");
			},
		});
		// Subscriptions warm up in parallel without blocking server spawn;
		// subscriptions.cjs awaits `ready` internally on demand and pushes `changed`.
		subscriptions = createSubscriptions({
			directory: app.getPath("userData"),
			loadSDK: () => loadSubscriptionSDK(path.dirname(serverEntry())),
			openExternal: (target) => shell.openExternal(target),
			onChange: (snapshot) => {
				subscriptionChild?.send(snapshot);
				for (const win of BrowserWindow.getAllWindows()) win.webContents.send("lh:subscriptions:changed");
			},
		});
		log(`starting server: ${serverEntry()}`);
		await startServer(new NodeURL(url).port);
		serverReady = waitUntilUp(url);
		log(`data dir: ${DATA_DIR()}${fs.existsSync(AUTH_FILE()) ? " · auth.json: present" : " · auth.json: ABSENT (no BYOK keys yet)"}`);
	} else {
		log(`dev mode: ${devUrl} — waiting for server`);
		const { waitForDevServer } = require("./dev-server-readiness.cjs");
		const startup = new AbortController();
		const cancelStartup = () => startup.abort(new Error("Development startup cancelled by application quit"));
		app.once("before-quit", cancelStartup);
		try {
			await waitForDevServer(devUrl, { signal: startup.signal });
			if (startup.signal.aborted) return;
			log(`dev server ready: ${devUrl}`);
		} catch (error) {
			if (!startup.signal.aborted) {
				log(`dev server startup failed: ${error?.message ?? error}`);
				app.exit(1);
			}
			return;
		} finally {
			app.removeListener("before-quit", cancelStartup);
		}
	}

	// Renderer controls contain no token/URL/code operation. The separate server
	// child is the only recipient of credential leases over inherited IPC.
	ipcMain.handle("lh:chatgpt:control", async (event, command) => {
		if (!trustedAppWindows.has(BrowserWindow.fromWebContents(event.sender)) || !trustedSender(event, ownedOrigin, BrowserWindow)) return { error: "Untrusted desktop request." };
		if (!chatgpt || !serverProcess?.connected) return { available: false, pending: false, activeId: null, accounts: [], error: "ChatGPT sign-in requires the desktop app's private server connection. Browser-only and externally launched development servers keep API-key connections." };
		return chatGPTControl(command, chatgpt);
	});

	ipcMain.handle("lh:subscriptions:control", async (event, command) => {
		if (!trustedAppWindows.has(BrowserWindow.fromWebContents(event.sender)) || !trustedSender(event, ownedOrigin, BrowserWindow)) throw new Error("Untrusted desktop request.");
		if (!subscriptions || !serverProcess?.connected) {
			if (command?.op === "status") return [];
			throw new Error("Subscription sign-in requires the desktop app's private server connection.");
		}
		return subscriptionControl(command, subscriptions);
	});

	// The dev shell has no browser tabs. Only a one-use action on its own
	// Next server may be resolved here; never accept an arbitrary external URL.
	ipcMain.handle("lh:subscriptions:web-browser", async (event, action) => {
		if (!devUrl || !trustedAppWindows.has(BrowserWindow.fromWebContents(event.sender)) || !trustedSender(event, ownedOrigin, BrowserWindow)) throw new Error("Untrusted development request.");
		await openWebSubscriptionBrowser(action, ownedOrigin, { openExternal: (target) => shell.openExternal(target) });
	});

	ipcMain.handle("lh:attachment:pick", (event, mode) => pickAttachmentPath(event, mode, {
		BrowserWindow, dialog, trustedAppWindows, origin: new URL(url).origin,
	}));

	installMenu(!devUrl && (() => {
		browserGateway ??= startBrowserGateway({ upstreamPort: Number(new NodeURL(url).port), secret: desktopAPISecret });
		void browserGateway.then(
			(gateway) => shell.openExternal(gateway.pairingUrl()),
			(error) => {
				browserGateway = undefined;
				throw error;
			},
		).catch((error) => {
			log(`browser access failed: ${error.message}`);
			dialog.showErrorBox("TrilhaAtlas", `Não foi possível abrir no navegador. ${error.code === "EADDRINUSE" ? "A porta local 43387 já está em uso." : "Tente novamente pelo menu Exibir."}`);
		});
	}));

	// Auto-update IPC handlers are wired upfront so the banner channel and
	// manual checks are live from first paint; in packaged boot electron-updater
	// is lazily initialized after ready-to-show (or on early manual check).
	ipcMain.on("lh:update-install", () => installUpdateNow());
	ipcMain.handle("lh:update:get", (event) => {
		if (!trustedAppWindows.has(BrowserWindow.fromWebContents(event.sender)) || !trustedSender(event, ownedOrigin, BrowserWindow)) throw new Error("Untrusted desktop request.");
		return updateState;
	});
	ipcMain.handle("lh:update:check", (event) => {
		if (!trustedAppWindows.has(BrowserWindow.fromWebContents(event.sender)) || !trustedSender(event, ownedOrigin, BrowserWindow)) throw new Error("Untrusted desktop request.");
		checkForUpdates({ manual: true });
	});

	// Sidebar-at-narrow-window (owner, 2026-09-17): the renderer auto-closes
	// the sidebar below SIDEBAR_AUTOCLOSE (928px); opening it again at that
	// width asks the window to widen instead — the layout never has to
	// accommodate a narrow window + open sidebar. Top-left stays fixed, the
	// window grows right. No-op when already wide.
	// The renderer's first paint can race did-finish-load — it asks for
	// the current factor itself (mirrors "lh:zoom" pushes).
	ipcMain.handle("lh:zoom:get", (event) => BrowserWindow.fromWebContents(event.sender)?.webContents.getZoomFactor() ?? 1);
	ipcMain.on("lh:expand-window", (event) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		if (!win) return;
		const { x, y, width, height } = win.getBounds();
		const target = SIDEBAR_AUTOCLOSE;
		if (width < target) win.setBounds({ x, y, width: target, height });
	});
	// The renderer reports every appearance write: the chrome follows without a restart.
	ipcMain.on("lh:appearance", (event, next) => {
		if (!trustedAppWindows.has(BrowserWindow.fromWebContents(event.sender)) || !trustedSender(event, ownedOrigin, BrowserWindow)) return;
		appearance = normalizeAppearance(next);
		nativeTheme.themeSource = themeSourceFor(appearance.mode);
		for (const win of BrowserWindow.getAllWindows()) applyChrome(win);
	});
	reopenWindow = () => { chatgpt?.resume(); subscriptions?.resume(); return createWindow(url); };
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) reopenWindow();
	});

	if (!devUrl) {
		// Construct the hidden BrowserWindow in parallel while the standalone
		// server finishes booting, then navigate the instant it responds.
		const win = createWindow(url, { deferLoad: true });
		win.once("ready-to-show", () => {
			setTimeout(startAutoUpdater, 2500);
		});
		try {
			await serverReady;
		} catch (error) {
			if (!win.isDestroyed()) win.destroy();
			throw error;
		}
		log(`server up: ${url}`);
		if (!win.isDestroyed()) {
			void win.loadURL(url);
			log(`window open: ${url}`);
		}
	} else {
		createWindow(url);
		log(`window open: ${url}`);
		if (app.isPackaged) {
			startAutoUpdater();
		} else {
			setupAutoUpdater();
		}
	}
}
