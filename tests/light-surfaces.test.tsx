/**
 * The surfaces that hardcoded dark (light-mode wave, 2026-10-29): each now
 * reads the active palette or the rendered mode.
 */

import React from "react";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { confidenceRailStyle } from "../components/confidence-rail.tsx";
import { mermaidConfig } from "../components/mermaid-render.ts";
import { CLUSTER_LIGHTNESS } from "../components/graph-canvas.ts";
import { TrilhaAtlasMark } from "../components/lh-mark.tsx";

describe("confidence rail", () => {
	it("sits on the page background, ticks in the foreground ink", () => {
		const style = confidenceRailStyle(50);
		assert.equal(style.backgroundColor, "var(--background)");
		const tick = "color-mix(in oklab, var(--foreground) 35%, transparent)";
		assert.ok(String(style.backgroundImage).includes(`linear-gradient(90deg, ${tick}, ${tick})`));
		assert.ok(!String(style.backgroundImage).includes("rgba(230,230,230"));
	});
});

describe("mermaid", () => {
	it("dark mode renders mermaid's dark theme, light its default", () => {
		assert.equal(mermaidConfig("dark").theme, "dark");
		assert.equal(mermaidConfig("light").theme, "default");
		assert.equal(mermaidConfig("light").securityLevel, "strict");
	});
});

describe("graph clusters", () => {
	it("dark keeps today's lightness; light darkens rings and labels", () => {
		assert.deepEqual(CLUSTER_LIGHTNESS.dark, { ring: 60, label: 78 });
		assert.ok(CLUSTER_LIGHTNESS.light.ring < CLUSTER_LIGHTNESS.dark.ring);
		assert.ok(CLUSTER_LIGHTNESS.light.label < CLUSTER_LIGHTNESS.dark.label);
	});
});

describe("TrilhaAtlas mark", () => {
	it("uses the same artwork in the sidebar, desktop and browser tab", () => {
		assert.match(renderToStaticMarkup(<TrilhaAtlasMark />), /src="\/trilhaatlas\.svg"/);
		assert.deepEqual(readFileSync("public/trilhaatlas.svg"), readFileSync("build/icon-flat.svg"));
		assert.deepEqual(readFileSync("app/favicon.ico"), readFileSync("build/icon.ico"));
	});
});
