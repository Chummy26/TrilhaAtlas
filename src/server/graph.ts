import * as fs from "node:fs";
import * as path from "node:path";
import { LEDGER_FILES, GRAPH_FILES, PATHS } from "../../config.ts";
import type { GraphSnapshot } from "../core/contracts.ts";
import type { GraphCostSummary } from "../core/cost-summary.ts";
import { graphCostSummary } from "../core/cost-summary.ts";
import { graphSnapshot } from "../core/graph.ts";
import {
	deleteNodeTraces,
	type NodeDeletionStats,
} from "../core/graph-deletion.ts";
import { extractionStatuses } from "../agent/subagents/extraction.ts";
import { listChatsWithExtractions } from "../store/chats.ts";
import { stores } from "./stores.ts";
import { createCallPricer } from "./pricing.ts";

const GRAPH_VIEW_CACHE_KEY = Symbol.for("learnharness.server.graphView");
const MAX_GRAPH_VIEW_ENTRIES = 16;

function graphViewCache(): Map<string, { stamp: string; snapshot: GraphSnapshot }> {
	const g = globalThis as typeof globalThis & { [GRAPH_VIEW_CACHE_KEY]?: Map<string, { stamp: string; snapshot: GraphSnapshot }> };
	return (g[GRAPH_VIEW_CACHE_KEY] ??= new Map());
}

function graphFileStamp(file: string): string {
	const stat = fs.statSync(/* turbopackIgnore: true */ file, { bigint: true, throwIfNoEntry: false });
	return stat ? `${stat.dev}|${stat.ino}|${stat.ctimeNs}|${stat.mtimeNs}|${stat.size}` : "-";
}

/**
 * Server-side graph entry for the home view (GET /api/graph). A PURE READ:
 * the extraction pipeline (the sole graph writer) is triggered by quiz
 * answers in sessions (turn-service), never from here — the home view
 * reflects whatever the pipeline has merged so far.
 */
export function graphView(): GraphSnapshot {
	const graphDir = path.resolve(PATHS.graph);
	const filesStamp = [
		LEDGER_FILES.nodes,
		LEDGER_FILES.chains,
		LEDGER_FILES.sessions,
		LEDGER_FILES.coverage,
		GRAPH_FILES.positions,
		GRAPH_FILES.sources,
		GRAPH_FILES.format,
		GRAPH_FILES.sourceOrganization,
	].map(graphFileStamp).join(";");
	const chatsStamp = stores.chatStore
		.listChats()
		.map((c) => `${c.id}\x00${c.title}`)
		.join("\x01");
	const stamp = `${filesStamp}#${chatsStamp}`;
	const cache = graphViewCache();
	const cached = cache.get(graphDir);
	if (cached && cached.stamp === stamp) {
		return structuredClone(cached.snapshot);
	}
	const organization = stores.sourceOrganizationStore.read();
	const names = Object.fromEntries(Object.entries(organization.placements).flatMap(([id, p]) => p.name === undefined ? [] : [[id, p.name]]));
	const snapshot = graphSnapshot(stores, names);
	if (cache.size >= MAX_GRAPH_VIEW_ENTRIES && !cache.has(graphDir)) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	cache.set(graphDir, { stamp, snapshot });
	return structuredClone(snapshot);
}

/** The graph view's cost surface (GET /api/graph/costs — the 2026-09 cost
 *  pill): fold every usage channel into stage totals + recent runs. A pure
 *  read over the chat records (chat-front-door runs), the notes sources
 *  (notes-front-door runs), and the naming ledger (graph-global runs);
 *  dollars are inferred by the pure core fold (core/cost-summary.ts +
 *  prices.ts) — nothing here stores or caches money. */
export function graphCosts(): GraphCostSummary {
	const chats = listChatsWithExtractions()
		.flatMap((summary) => {
			const record = stores.chatStore.getChat(summary.id);
			return record?.extractions?.length
				? [{ title: record.title ?? summary.id, extractions: record.extractions }]
				: [];
		});
	const sources = stores.graphStore
		.readSources()
		.filter((s) => s.extractions?.length)
		.map((s) => ({ filePath: s.filePath, extractions: s.extractions! }));
	return graphCostSummary({ chats, sources }, createCallPricer());
}

/** The graph's version stamp (session-deletion wave 6): the max mtime
 * across every graph data file — ledgers, positions. Moves on ANY
 * graph write (merge append, settle, or a deletion's atomic rewrite),
 * never moves on reads, and needs no bookkeeping of its own: the fs
 * IS the counter. Consumers poll it (the activity feed
 *  carries it; the DELETE response returns it) to know clusters/layout
 *  must refetch — the "graph changed underneath me" signal. */
export function graphRevision(): number {
	let revision = 0;
	for (const file of [
		LEDGER_FILES.nodes,
		LEDGER_FILES.chains,
		LEDGER_FILES.sessions,
		LEDGER_FILES.coverage,
		GRAPH_FILES.positions,
	]) {
		try {
			revision = Math.max(revision, fs.statSync(file).mtimeMs);
		} catch {
			/* absent — nothing has ever written it */
		}
	}
	return revision;
}

// ─── single-node deletion (node interlude, owner-locked full-death) ──────────

/** What deleteGraphNode did — the route maps it straight to HTTP. */
export type NodeDeleteOutcome =
	| { ok: false; status: 404; code: "not_found"; error: string }
	| { ok: false; status: 409; code: "extraction_running"; error: string }
	| { ok: true; stats: NodeDeletionStats; graphRevision: number };

/**
 * Delete one node by id — FULL DEATH (core/graph-deletion.ts for the
 * ledger semantics). The guard family is deliberately NOT the chat
 * one, and the reasoning is worth writing down:
 *
 *   - No turn/jobs gates. Turns and background jobs never write the
 *     graph ledgers; a turn's follow-up extraction registers as a run,
 *     and every code path here is synchronous — nothing can register
 *     or merge between the gate and the ledger rewrite (the event loop
 *     never yields inside this function).
 *   - THE EXTRACTION GATE — 409 while ANY pipeline run is registered,
 *     anywhere. A mid-flight run holds findings extracted from
 *     transcripts that predate the deletion; its merges could re-add
 *     aliases, provenance, or events to the dying node (the
 *     re-reference risk the dispatch flags). Unlike chat deletion we
 *     do NOT abort the run: it belongs to some session, and killing
 *     that session's spend is outside this deletion's blast radius —
 *     the UI retries once the dock drains. A run that starts AFTER
 *     the deletion is legitimate re-learning: it reads post-deletion
 *     ledgers, mints a fresh node for a re-taught topic, and
 *     mergeFindings ignores linkTo ids that no longer exist (the
 *     existingIds guard) — no dangling edges, no resurrection.
 */
export function deleteGraphNode(nodeId: string): NodeDeleteOutcome {
	if (extractionStatuses().length > 0) {
		return {
			ok: false,
			status: 409,
			code: "extraction_running",
			error: "An extraction is running — try again when it finishes",
		};
	}
	// THE SYNC BLOCK — no awaits below (the doc above): the gate and the
	// rewrite are one atomic stretch of the event loop.
	const stats = deleteNodeTraces(stores.graphStore, nodeId);
	if (stats === null) {
		return { ok: false, status: 404, code: "not_found", error: "No such node" };
	}
	return { ok: true, stats, graphRevision: graphRevision() };
}

