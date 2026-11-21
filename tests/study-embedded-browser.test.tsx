import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { MessageResponse } from "../components/ai-elements/message.tsx";
import { StudyBrowserProvider } from "../components/study/embedded-browser.tsx";
import {
	STUDY_BROWSER_NEWTAB_URL,
	classifyStudyBrowserTarget,
	normalizeBrowserAddressInput,
	parseExternalStudyUrl,
	parseYoutubeStartSeconds,
} from "../src/core/study/browser.ts";
import {
	StudyBrowserError,
	assertSafeBrowserUrl,
	extractStudyBrowserReader,
	rewriteHtmlForEmbeddedFrame,
} from "../src/server/study-browser.ts";

const require = createRequire(import.meta.url);
const {
	allowCookieInHttpsSubframe,
	cleanChromeUserAgent,
	embeddedSubframeResponseHeaders,
} = require("../electron/embedded-browser-headers.cjs");

describe("study embedded browser — pure URL classification & address normalization", () => {
	it("parses external http/https URLs while rejecting same-origin, localhost and non-web schemes", () => {
		const origin = "http://127.0.0.1:3000";
		assert.equal(
			parseExternalStudyUrl("https://learningenglish.voanews.com/a/lets-learn-english-lesson-one/3111026.html", origin),
			"https://learningenglish.voanews.com/a/lets-learn-english-lesson-one/3111026.html",
		);
		assert.equal(parseExternalStudyUrl("/mapa?dominio=english", origin), null);
		assert.equal(parseExternalStudyUrl("http://127.0.0.1:3000/chat/123", origin), null);
		assert.equal(parseExternalStudyUrl("http://localhost:8080/test", origin), null);
		assert.equal(parseExternalStudyUrl("mailto:tutor@example.com", origin), null);
		assert.equal(parseExternalStudyUrl("javascript:alert(1)", origin), null);
		assert.equal(parseExternalStudyUrl("#section-2", origin), null);
	});

	it("classifies new-tab, YouTube videos, YouTube searches, PDFs, Falstad simulations and general web pages", () => {
		const newTab = classifyStudyBrowserTarget(STUDY_BROWSER_NEWTAB_URL);
		assert.equal(newTab.kind, "new-tab");

		const yt = classifyStudyBrowserTarget("https://www.youtube.com/watch?v=WR9_nsLyaEY&t=1m30s");
		assert.equal(yt.kind, "youtube-video");
		if (yt.kind === "youtube-video") {
			assert.equal(yt.videoId, "WR9_nsLyaEY");
			assert.equal(yt.startSec, 90);
			assert.match(yt.embedUrl, /youtube-nocookie\.com\/embed\/WR9_nsLyaEY/);
			assert.match(yt.embedUrl, /start=90/);
		}

		const search = classifyStudyBrowserTarget("https://www.youtube.com/results?search_query=lei+de+ohm");
		assert.equal(search.kind, "youtube-search");
		if (search.kind === "youtube-search") {
			assert.equal(search.query, "lei de ohm");
		}

		const pdf = classifyStudyBrowserTarget("https://docs.voanews.eu/en-us-learn/2019/11/28/lesson1.pdf#page=5");
		assert.equal(pdf.kind, "pdf");
		if (pdf.kind === "pdf") {
			assert.equal(pdf.hash, "#page=5");
		}

		const falstad = classifyStudyBrowserTarget("https://www.falstad.com/circuit/circuitjs.html?startCircuit=lrc.txt");
		assert.equal(falstad.kind, "direct-embed");

		const voa = classifyStudyBrowserTarget("https://learningenglish.voanews.com/a/lets-learn-english-lesson-one/3111026.html");
		assert.equal(voa.kind, "web-page");
		assert.equal(voa.host, "learningenglish.voanews.com");
	});

	it("parses YouTube timestamp formats and normalizes address bar input", () => {
		assert.equal(parseYoutubeStartSeconds("45"), 45);
		assert.equal(parseYoutubeStartSeconds("2m15s"), 135);
		assert.equal(parseYoutubeStartSeconds("1h02m03s"), 3723);
		assert.equal(normalizeBrowserAddressInput("openstax.org/books/college-physics-2e"), "https://openstax.org/books/college-physics-2e");
		assert.equal(normalizeBrowserAddressInput("yt: kirchhoff law"), "https://www.youtube.com/results?search_query=kirchhoff+law");
		assert.equal(normalizeBrowserAddressInput("lei de ohm", "duckduckgo"), "https://duckduckgo.com/?q=lei+de+ohm");
	});
});

describe("study embedded browser — Electron headers & cookie helper", () => {
	it("strips Electron and app tokens from User-Agent while preserving standard Chrome", () => {
		const raw =
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) TrilhaAtlas/0.6.1 Chrome/152.0.0.0 Electron/44.9.3 Safari/537.36";
		assert.equal(
			cleanChromeUserAgent(raw),
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
		);
	});

	it("removes X-Frame-Options, strips CSP frame-ancestors, and upgrades HTTPS subframe cookies to SameSite=None; Secure", () => {
		assert.equal(
			allowCookieInHttpsSubframe("session_id=abc123; Path=/; HttpOnly; SameSite=Lax"),
			"session_id=abc123; Path=/; HttpOnly; Secure; SameSite=None",
		);

		const headers = embeddedSubframeResponseHeaders(
			{
				url: "https://openlibrary.org/works/OL21W",
				resourceType: "subFrame",
				responseHeaders: {
					"X-Frame-Options": ["SAMEORIGIN"],
					"Content-Security-Policy": ["default-src 'self'; frame-ancestors 'self' https://archive.org; script-src 'self'"],
					"Set-Cookie": ["ol_sess=xyz; Path=/; SameSite=Lax"],
				},
			},
			"http://127.0.0.1:9000",
		);

		assert.equal(headers["X-Frame-Options"], undefined);
		assert.deepEqual(headers["Content-Security-Policy"], ["default-src 'self'; script-src 'self'"]);
		assert.deepEqual(headers["Set-Cookie"], ["ol_sess=xyz; Path=/; Secure; SameSite=None"]);
	});
});

describe("study embedded browser — server sanitizer, frame rewriter and reader extractor", () => {
	it("blocks localhost and shadow libraries while allowing official educational sites", () => {
		assert.equal(
			assertSafeBrowserUrl("https://learningenglish.voanews.com/a/lets-learn-english-lesson-one/3111026.html").hostname,
			"learningenglish.voanews.com",
		);
		assert.throws(() => assertSafeBrowserUrl("http://127.0.0.1:4000/secret"), StudyBrowserError);
		assert.throws(() => assertSafeBrowserUrl("https://annas-archive.org/md5/123"), StudyBrowserError);
		assert.throws(() => assertSafeBrowserUrl("https://libgen.rs/book/index.php"), StudyBrowserError);
	});

	it("rewrites frame HTML with a base tag, strips CSP/X-Frame-Options meta tags and injects the navigation bridge", () => {
		const raw = `<!doctype html><html><head><meta http-equiv="X-Frame-Options" content="SAMEORIGIN"><meta http-equiv="Content-Security-Policy" content="frame-ancestors 'none'"><title>VOA Lesson 1</title></head><body><a href="/a/lesson-two/2.html">Lesson 2</a></body></html>`;
		const out = rewriteHtmlForEmbeddedFrame(raw, "https://learningenglish.voanews.com/a/lets-learn-english-lesson-one/3111026.html");
		assert.ok(!/http-equiv=["']?X-Frame-Options/i.test(out));
		assert.ok(!/http-equiv=["']?Content-Security-Policy/i.test(out));
		assert.ok(out.includes('<base href="https://learningenglish.voanews.com/a/lets-learn-english-lesson-one/3111026.html">'));
		assert.ok(out.includes("lh:embedded-browser-navigate"));
	});

	it("extracts reader Markdown, playable MP3 audio and clean links from an educational page", () => {
		const raw = `<!doctype html><html><head><title>Let's Learn English - Lesson 1</title><meta name="description" content="Anna moves to Washington, D.C."></head><body>
			<nav><a href="/nav">Skip</a></nav>
			<article>
				<h1>Lesson 1: Welcome!</h1>
				<audio src="https://voa-audio.voanews.eu/vle/2016/02/08/49485bf8-4277-47f6-9abe-617ee2473f8c.mp3" title="Diálogo de Anna e Pete"></audio>
				<p><strong>Pete:</strong> Hi! Are you Anna? Yes, I am Pete.</p>
				<p><strong>Anna:</strong> Nice to meet you! Let's try that again.</p>
				<a href="/a/lesson-two/3111027.html">Go to Lesson 2</a>
			</article>
		</body></html>`;
		const payload = extractStudyBrowserReader(
			raw,
			"https://learningenglish.voanews.com/a/lets-learn-english-lesson-one/3111026.html",
		);
		assert.equal(payload.title, "Lesson 1: Welcome!");
		assert.equal(payload.description, "Anna moves to Washington, D.C.");
		assert.equal(payload.media.length, 1);
		assert.equal(payload.media[0]?.kind, "audio");
		assert.equal(payload.media[0]?.url, "https://voa-audio.voanews.eu/vle/2016/02/08/49485bf8-4277-47f6-9abe-617ee2473f8c.mp3");
		assert.match(payload.markdown, /Are you Anna\?/);
		assert.ok(payload.links.some((l) => l.url === "https://learningenglish.voanews.com/a/lesson-two/3111027.html"));
	});
});

describe("study embedded browser — UI click interception, native iframe & multiple tabs", () => {
	it("intercepts external links in MessageResponse, mounts real origin iframe, and supports creating/switching tabs", async () => {
		const dom = parseHTML("<!doctype html><html><head></head><body><div id='root'></div></body></html>");
		Object.defineProperty(dom.window, "location", {
			value: new URL("http://127.0.0.1:3000/chat/test"),
			configurable: true,
		});
		const globals: Record<string, unknown> = {
			window: dom.window,
			self: dom.window,
			document: dom.document,
			HTMLElement: dom.window.HTMLElement,
			HTMLAnchorElement: dom.window.HTMLAnchorElement,
			Element: dom.window.Element,
			Node: dom.window.Node,
			IS_REACT_ACT_ENVIRONMENT: true,
		};
		const saved = new Map(Object.keys(globals).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
		const originalFetch = globalThis.fetch;
		Object.assign(globalThis, globals);
		globalThis.fetch = (async () =>
			Response.json({
				url: "https://learningenglish.voanews.com/a/lets-learn-english-lesson-one/3111026.html",
				host: "learningenglish.voanews.com",
				title: "Lesson 1: Welcome!",
				markdown: "**Pete:** Hi! Are you Anna?",
				media: [
					{
						kind: "audio",
						url: "https://voa-audio.voanews.eu/vle/2016/02/08/dialogue.mp3",
						label: "Diálogo VOA",
					},
				],
				links: [],
			})) as typeof fetch;

		const root = createRoot(dom.document.querySelector("#root")!);
		try {
			await act(async () => {
				root.render(
					<StudyBrowserProvider>
						<MessageResponse mode="static">
							{"Abra a [Lição 1 da VOA](https://learningenglish.voanews.com/a/lets-learn-english-lesson-one/3111026.html) para ouvir."}
						</MessageResponse>
					</StudyBrowserProvider>,
				);
			});

			assert.equal(dom.document.querySelector("[data-testid='study-embedded-browser']"), null);
			const link = dom.document.querySelector("a[href*='voanews.com']")!;
			assert.ok(link, "external link renders in markdown");

			const click = new dom.window.Event("click", { bubbles: true, cancelable: true });
			await act(async () => {
				link.dispatchEvent(click);
			});

			assert.equal(click.defaultPrevented, true, "click is intercepted by the embedded browser provider");
			assert.equal(
				dom.document.querySelector("[data-streamdown='link-safety-modal']"),
				null,
				"Streamdown external link modal never opens",
			);

			const sidebar = dom.document.querySelector("[data-testid='study-embedded-browser']") as Element | null;
			assert.ok(sidebar, "right-hand embedded browser sidebar opens");
			assert.ok(sidebar.textContent?.includes("learningenglish.voanews.com"));
			assert.ok(sidebar.textContent?.includes("Mídia (1)"), "detected lesson audio is surfaced in the sidebar header");

			// Verify iframe loads the real external URL directly (no about:srcdoc)
			const iframe = sidebar.querySelector("iframe") as Element | null;
			assert.ok(iframe);
			assert.equal(
				iframe.getAttribute("src"),
				"https://learningenglish.voanews.com/a/lets-learn-english-lesson-one/3111026.html",
			);

			for (const iconName of ["plus", "chevron-left", "chevron-right", "sync", "copy", "maximize", "arrow-up-right", "close"]) {
				const svg: Element | null = sidebar.querySelector(`.study-browser-icon-btn svg[data-icon='${iconName}']`);
				assert.ok(svg, `hand-drawn icon "${iconName}" renders inside its icon button`);
			}

			// Test creating a new tab via the "+" button
			const newTabBtn = sidebar.querySelector("[data-testid='study-browser-new-tab']") as Element | null;
			assert.ok(newTabBtn, "new tab button exists in the tab strip");
			await act(async () => {
				newTabBtn.dispatchEvent(new dom.window.Event("click", { bubbles: true, cancelable: true }));
			});

			const tabs = sidebar.querySelectorAll("[role='tab']");
			assert.equal(tabs.length, 2, "second tab is created in the tab strip");
			assert.ok(sidebar.textContent?.includes("Fontes rápidas de estudo"), "new tab page renders quick study shortcuts");
		} finally {
			await act(async () => root.unmount());
			globalThis.fetch = originalFetch;
			for (const [k, desc] of saved) {
				if (desc) Object.defineProperty(globalThis, k, desc);
				else Reflect.deleteProperty(globalThis, k);
			}
		}
	});
});
