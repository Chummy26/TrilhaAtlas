/**
 * Platform · model registry (docs/research/00-SINTESE.md §2.9; r5 §5.3–5.4):
 *
 *  1. Metadata cascade native → models.dev → litellm → openrouter → pi →
 *     estimated, field by field, invalid values ignored, cost atomic.
 *  2. resolveRole with SYNTHETIC entries and metadata only (no real model
 *     id anywhere): every preference, require filters, connection
 *     preferences, lifecycle, pins and their migration, clear errors.
 *  3. Determinism: any permutation of the entries resolves the same model.
 *  4. Anti-ID lint (§2.9 "Lint de teste"): no `gpt-|claude-|gemini-` in this
 *     module's production files.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import fc from "fast-check";
import {
	buildCatalog,
	DEFAULT_ROLE_SPECS,
	effectiveRoleSpec,
	entryKey,
	ESTIMATED_CONTEXT_WINDOW,
	ESTIMATED_MAX_OUTPUT,
	isSelectable,
	mergeMetadata,
	metadataIndex,
	ModelResolveError,
	presetFallback,
	rankForPreference,
	resolveRole,
	type EntitlementEntry,
	type MetadataLayers,
	type ModelMetadata,
	type RolePreference,
	type RoleSpec,
} from "../src/core/models/index.ts";

// ─── synthetic fixtures ──────────────────────────────────────────────────────

function entry(id: string, overrides: Partial<EntitlementEntry> = {}): EntitlementEntry {
	return { connection: "conn-api", provider: "vendor-a", id, billing: "api", ...overrides };
}

function meta(overrides: Partial<ModelMetadata> = {}): ModelMetadata {
	return { contextWindow: 200_000, maxOutput: 32_000, input: ["text"], source: "models.dev", ...overrides };
}

/** A small universe of synthetic models across three connections. */
function universe(): { entries: EntitlementEntry[]; metadata: Map<string, ModelMetadata> } {
	const rows: [EntitlementEntry, ModelMetadata][] = [
		[entry("alpha-max"), meta({ reasoning: true, cost: { input: 15, output: 75 }, releaseDate: "2026-09-01", input: ["text", "image"], throughputTps: 40 })],
		[entry("alpha-mid"), meta({ reasoning: true, cost: { input: 3, output: 15 }, releaseDate: "2026-08-01", input: ["text", "image"], throughputTps: 90 })],
		[entry("alpha-mini"), meta({ reasoning: false, cost: { input: 0.25, output: 1.25 }, releaseDate: "2026-07-01", contextWindow: 64_000, throughputTps: 200 })],
		[entry("plan-first", { connection: "conn-plan", provider: "vendor-b", billing: "subscription", order: 0 }), meta({ reasoning: true, cost: { input: 1.25, output: 10 }, releaseDate: "2026-10-01" })],
		[entry("plan-second", { connection: "conn-plan", provider: "vendor-b", billing: "subscription", order: 1 }), meta({ reasoning: true, cost: { input: 5, output: 40 }, releaseDate: "2026-06-01" })],
		[entry("local-small", { connection: "conn-local", provider: "runtime", billing: "local" }), meta({ reasoning: false, contextWindow: 32_000, source: "estimated" })],
	];
	return { entries: rows.map(([e]) => e), metadata: new Map(rows.map(([e, m]) => [entryKey(e), m])) };
}

function pick(spec: RoleSpec, data = universe(), options = {}): string {
	return resolveRole(spec, data.entries, data.metadata, options).entry.id;
}

const auto = (prefer: RolePreference, extra: Omit<Extract<RoleSpec, { kind: "auto" }>, "kind" | "prefer"> = {}): RoleSpec => ({ kind: "auto", prefer, ...extra });

// ─── cascade ─────────────────────────────────────────────────────────────────

describe("metadata cascade (merge.ts)", () => {
	it("takes each field from the first source that has a valid value", () => {
		const e = entry("x", { native: { contextWindow: 400_000, reasoningLevels: ["low", "high"], input: ["text", "image"] } });
		const layers: MetadataLayers = {
			"models.dev": { contextWindow: 999, maxOutput: 0, cost: { input: 2, output: 8 }, family: "fam" },
			litellm: { maxOutput: 64_000, cost: { input: 1, output: 1 }, toolCall: true },
			openrouter: { knowledge: "2026-01", releaseDate: "2026-05-05" },
			pi: { throughputTps: Number.NaN },
		};
		const merged = mergeMetadata(e, layers);
		assert.equal(merged.contextWindow, 400_000, "native beats catalogs");
		assert.equal(merged.maxOutput, 64_000, "an invalid 0 in models.dev is skipped");
		assert.deepEqual(merged.cost, { input: 2, output: 8 }, "cost comes whole from one source");
		assert.equal(merged.reasoning, true);
		assert.equal(merged.toolCall, true);
		assert.equal(merged.throughputTps, undefined);
		assert.equal(merged.fieldSources.contextWindow, "native");
		assert.equal(merged.fieldSources.maxOutput, "litellm");
		assert.equal(merged.fieldSources.knowledge, "openrouter");
		assert.equal(merged.source, "native");
		assert.equal(merged.estimated, false);
	});

	it("an unknown model stays usable with conservative estimates", () => {
		const merged = mergeMetadata(entry("brand-new"), {});
		assert.equal(merged.contextWindow, ESTIMATED_CONTEXT_WINDOW);
		assert.equal(merged.maxOutput, ESTIMATED_MAX_OUTPUT);
		assert.equal(merged.cost, undefined, "price stays unknown, never guessed");
		assert.equal(merged.estimated, true);
		assert.equal(merged.source, "estimated");
	});

	it("buildCatalog borrows the smallest known window of the same family", () => {
		const known1 = entry("fam-big");
		const known2 = entry("fam-small");
		const unknown = entry("fam-new");
		const catalog = buildCatalog([known1, known2, unknown], (e) => {
			if (e.id === "fam-big") return { "models.dev": { contextWindow: 1_000_000, maxOutput: 64_000, family: "fam" } };
			if (e.id === "fam-small") return { litellm: { contextWindow: 256_000, family: "fam" } };
			return { pi: { family: "fam" } };
		});
		const byId = new Map(catalog.map((m) => [m.entry.id, m.meta]));
		assert.equal(byId.get("fam-new")?.contextWindow, 256_000);
		assert.equal(byId.get("fam-new")?.estimated, true);
		assert.equal(byId.get("fam-small")?.maxOutput, ESTIMATED_MAX_OUTPUT);
		assert.equal(metadataIndex(catalog).size, 3);
	});
});

// ─── resolution ──────────────────────────────────────────────────────────────

describe("resolveRole (synthetic metadata)", () => {
	it("cheapest = lowest input+output price, unknown price last", () => {
		assert.equal(pick(auto("cheapest")), "alpha-mini");
		const data = universe();
		data.entries = data.entries.filter((e) => e.id !== "alpha-mini");
		assert.equal(pick(auto("cheapest"), data), "plan-first");
	});

	it("strongest: the server's order decides inside a connection, metadata across connections", () => {
		assert.equal(pick(auto("strongest")), "alpha-max");
		assert.equal(pick(auto("strongest", { connection: "conn-plan" })), "plan-first", "priority 0 beats a pricier sibling");
		const ranked = rankForPreference(
			universe().entries.map((e) => ({ entry: e, meta: universe().metadata.get(entryKey(e)) as ModelMetadata })),
			"strongest",
		).map((c) => c.entry.id);
		assert.deepEqual(ranked, ["alpha-max", "alpha-mid", "alpha-mini", "plan-first", "plan-second", "local-small"]);
	});

	it("strongest honours an editable line rank inside a connection", () => {
		const data = universe();
		const lined: [EntitlementEntry, ModelMetadata][] = [
			[entry("l-top-old", { connection: "conn-lines", native: { line: "top", createdAt: "2026-01-01" } }), meta({ reasoning: true, cost: { input: 1, output: 2 } })],
			[entry("l-top-new", { connection: "conn-lines", native: { line: "top", createdAt: "2026-09-01" } }), meta({ reasoning: true, cost: { input: 1, output: 2 } })],
			[entry("l-low", { connection: "conn-lines", native: { line: "low", createdAt: "2026-10-01" } }), meta({ reasoning: true, cost: { input: 9, output: 99 } })],
		];
		for (const [e, m] of lined) {
			data.entries.push(e);
			data.metadata.set(entryKey(e), m);
		}
		assert.equal(pick(auto("strongest", { connection: "conn-lines" }), data, { lineRank: ["top", "low"] }), "l-top-new");
		assert.equal(pick(auto("strongest", { connection: "conn-lines" }), data, { lineRank: ["low", "top"] }), "l-low");
	});

	it("fastest = highest throughput; balanced = the upper median of priced models", () => {
		assert.equal(pick(auto("fastest")), "alpha-mini");
		// priced strength order: alpha-max(75) plan-second(40) alpha-mid(15) plan-first(10) alpha-mini(1.25 non-reasoning)
		assert.equal(pick(auto("balanced")), "alpha-mid");
	});

	it("require filters: reasoning, input modality, minimum context, billing", () => {
		assert.equal(pick(auto("cheapest", { require: { reasoning: true } })), "plan-first");
		assert.equal(pick(auto("cheapest", { require: { input: ["image"] } })), "alpha-mid");
		assert.equal(pick(auto("cheapest", { require: { minContext: 100_000 } })), "plan-first");
		assert.equal(pick(auto("strongest", { require: { billing: ["local"] } })), "local-small");
		// vision preset: balanced among image models (alpha-max, alpha-mid) → the upper median
		assert.equal(pick(DEFAULT_ROLE_SPECS.vision), "alpha-max");
	});

	it("fails with every elimination listed when nothing satisfies the spec", () => {
		try {
			pick(auto("strongest", { require: { input: ["audio"], minContext: 1_000_000 } }));
			assert.fail("expected ModelResolveError");
		} catch (error) {
			assert.ok(error instanceof ModelResolveError);
			assert.equal(error.code, "no-match");
			assert.match(error.message, /entrada "audio"/);
			assert.ok(error.details.length >= 1);
		}
		assert.throws(
			() => resolveRole(auto("cheapest"), [], new Map()),
			(e: unknown) => e instanceof ModelResolveError && e.code === "no-entitlements",
		);
	});

	it("connection is a preference and avoidConnection keeps critics diverse", () => {
		assert.equal(pick(auto("strongest", { connection: "conn-local" })), "local-small");
		assert.equal(pick(auto("strongest", { connection: "conn-missing" })), "alpha-max", "an absent preferred connection falls back to all");
		assert.equal(pick(auto("strongest", { avoidConnection: "conn-api" })), "plan-first");
		const onlyApi = universe();
		onlyApi.entries = onlyApi.entries.filter((e) => e.connection === "conn-api");
		assert.equal(pick(auto("strongest", { avoidConnection: "conn-api" }), onlyApi), "alpha-max", "avoiding the only connection still resolves");
	});

	it("hidden, unsupported and retired entries are never chosen; deprecated ones rank last", () => {
		const data = universe();
		const [max, mid] = data.entries;
		assert.ok(max && mid);
		max.hidden = true;
		assert.equal(isSelectable(max), false);
		assert.equal(pick(auto("strongest"), data), "alpha-mid");
		const apiOnly = auto("strongest", { connection: "conn-api" });
		mid.native = { lifecycle: "deprecated" };
		assert.equal(pick(apiOnly, data), "alpha-mini", "deprecated ranks after an active, weaker sibling");
		assert.equal(pick(auto("strongest"), data), "plan-first", "a deprecated model never champions its connection");
		mid.native = { lifecycle: "retired" };
		const unsupported = entry("alpha-noapi", { native: { supportedInApi: false } });
		data.entries.push(unsupported);
		data.metadata.set(entryKey(unsupported), meta({ reasoning: true, cost: { input: 100, output: 1000 } }));
		assert.equal(pick(apiOnly, data), "alpha-mini");
		assert.deepEqual(
			rankForPreference(
				data.entries.filter(isSelectable).map((e) => ({ entry: e, meta: data.metadata.get(entryKey(e)) as ModelMetadata })),
				"cheapest",
			).map((c) => c.entry.id),
			["alpha-mini", "plan-first", "plan-second", "local-small"],
		);
	});

	it("unknown metadata falls back to native + estimated instead of dropping the model", () => {
		const fresh = entry("fresh-model", { connection: "conn-new", native: { reasoningLevels: ["high"] } });
		const resolved = resolveRole(auto("strongest", { connection: "conn-new", require: { reasoning: true } }), [fresh], new Map());
		assert.equal(resolved.entry.id, "fresh-model");
		assert.equal(resolved.meta.contextWindow, ESTIMATED_CONTEXT_WINDOW);
	});

	it("pins: exact, alias, migration by upgradeTo or line, fallback, error", () => {
		const data = universe();
		const pinned = resolveRole({ kind: "pinned", provider: "vendor-a", id: "alpha-mid", thinkingLevel: "high" }, data.entries, data.metadata);
		assert.equal(pinned.entry.id, "alpha-mid");
		assert.equal(pinned.via, "pinned");
		assert.equal(pinned.thinkingLevel, "high");

		const alias = entry("alias-latest", { connection: "conn-cli", provider: "vendor-c", native: { resolvedModel: "concrete-2026" } });
		assert.equal(resolveRole({ kind: "pinned", provider: "vendor-c", id: "concrete-2026" }, [alias], new Map()).entry.id, "alias-latest");

		const old = entry("old-gen", { hidden: true, native: { upgradeTo: "alpha-max" } });
		const migrated = resolveRole({ kind: "pinned", provider: "vendor-a", id: "old-gen" }, [...data.entries, old], data.metadata);
		assert.equal(migrated.entry.id, "alpha-max");
		assert.equal(migrated.via, "pinned-migrated");
		assert.deepEqual(migrated.replacedPin, { provider: "vendor-a", id: "old-gen" });

		const lineOld = entry("ln-1", { native: { line: "solo", lifecycle: "retired", createdAt: "2025-01-01" } });
		const lineNew = entry("ln-2", { native: { line: "solo", createdAt: "2026-01-01" } });
		assert.equal(resolveRole({ kind: "pinned", provider: "vendor-a", id: "ln-1" }, [lineOld, lineNew], new Map()).entry.id, "ln-2");

		const gone: RoleSpec = { kind: "pinned", provider: "vendor-z", id: "vanished" };
		const fallback = resolveRole(gone, data.entries, data.metadata, { fallback: presetFallback("grader"), role: "grader" });
		assert.equal(fallback.entry.id, "alpha-mini");
		assert.equal(fallback.via, "fallback:cheapest");
		assert.throws(
			() => resolveRole(gone, data.entries, data.metadata, { role: "tutor" }),
			(e: unknown) => e instanceof ModelResolveError && e.code === "pinned-unavailable" && /tutor/.test(e.message),
		);
	});

	it("pin migration follows an upgrade chain and only lands on an ACTIVE model of the same line", () => {
		const data = universe();
		const gen1 = entry("gen-1", { hidden: true, native: { upgradeTo: "gen-2" } });
		const gen2 = entry("gen-2", { native: { lifecycle: "retired", upgradeTo: "gen-3" } });
		const gen3 = entry("gen-3", { native: { upgradeTo: "gen-1" } }); // cycle back: must not loop
		const chained = resolveRole({ kind: "pinned", provider: "vendor-a", id: "gen-1" }, [...data.entries, gen1, gen2, gen3], data.metadata);
		assert.equal(chained.entry.id, "gen-3");
		assert.equal(chained.via, "pinned-migrated");
		const loop = [entry("x-1", { hidden: true, native: { upgradeTo: "x-2" } }), entry("x-2", { hidden: true, native: { upgradeTo: "x-1" } })];
		assert.throws(
			() => resolveRole({ kind: "pinned", provider: "vendor-a", id: "x-1" }, loop, new Map()),
			(e: unknown) => e instanceof ModelResolveError && e.code === "pinned-unavailable",
		);

		const lineOld = entry("ln-old", { native: { line: "solo", lifecycle: "retired", createdAt: "2025-01-01" } });
		const lineDeprecated = entry("ln-dep", { native: { line: "solo", lifecycle: "deprecated", createdAt: "2026-06-01" } });
		const viaFallback = resolveRole({ kind: "pinned", provider: "vendor-a", id: "ln-old" }, [lineOld, lineDeprecated, ...data.entries], data.metadata, { fallback: presetFallback("grader") });
		assert.equal(viaFallback.via, "fallback:cheapest", "a deprecated sibling is not a migration target");
		const lineActive = entry("ln-new", { native: { line: "solo", createdAt: "2026-01-01" } });
		assert.equal(resolveRole({ kind: "pinned", provider: "vendor-a", id: "ln-old" }, [lineOld, lineDeprecated, lineActive], new Map()).entry.id, "ln-new");
	});

	it("non-finite metadata never makes the choice depend on the entry order", () => {
		const entries = ["n-a", "n-b", "n-c", "n-d"].map((id) => entry(id));
		const metadata = new Map<string, ModelMetadata>([
			[entryKey(entries[0] as EntitlementEntry), meta({ cost: { input: 1, output: Number.NaN }, throughputTps: Number.NaN, contextWindow: Number.NaN })],
			[entryKey(entries[1] as EntitlementEntry), meta({ cost: { input: 1, output: 5 }, throughputTps: 50 })],
			[entryKey(entries[2] as EntitlementEntry), meta({ cost: { input: Number.POSITIVE_INFINITY, output: 3 }, throughputTps: 20 })],
			[entryKey(entries[3] as EntitlementEntry), meta({ cost: { input: 1, output: 3 } })],
		]);
		const withOrder = entries.map((e, i) => ({ ...e, order: i === 0 ? Number.NaN : i }));
		for (const list of [entries, withOrder]) {
			for (const prefer of ["strongest", "cheapest", "fastest", "balanced"] as const) {
				const expected = resolveRole(auto(prefer), list, metadata).entry.id;
				fc.assert(
					fc.property(fc.shuffledSubarray(list, { minLength: list.length, maxLength: list.length }), (shuffled) => {
						assert.equal(resolveRole(auto(prefer), shuffled, metadata).entry.id, expected, prefer);
					}),
					{ numRuns: 60 },
				);
			}
		}
		assert.equal(resolveRole(auto("cheapest"), entries, metadata).entry.id, "n-d", "NaN/Infinity prices count as unknown");
		assert.equal(resolveRole(auto("cheapest", { require: { minContext: 100_000 } }), entries, metadata).entry.id, "n-d", "a NaN context never satisfies minContext");
	});

	it("balanced never picks a deprecated median while an active model qualifies", () => {
		const active = entry("b-active");
		const dep1 = entry("b-dep-1", { native: { lifecycle: "deprecated" } });
		const dep2 = entry("b-dep-2", { native: { lifecycle: "deprecated" } });
		const metadata = new Map<string, ModelMetadata>([
			[entryKey(active), meta({ cost: { input: 1, output: 2 } })],
			[entryKey(dep1), meta({ cost: { input: 5, output: 20 } })],
			[entryKey(dep2), meta({ cost: { input: 9, output: 40 } })],
		]);
		assert.equal(resolveRole(auto("balanced"), [active, dep1, dep2], metadata).entry.id, "b-active");
		assert.equal(resolveRole(auto("balanced"), [dep1, dep2], metadata).entry.id, "b-dep-2", "only deprecated left: still resolves");
	});

	it("presets are handed out as copies: mutating one never changes the global defaults", () => {
		const vision = effectiveRoleSpec("vision");
		assert.ok(vision.kind === "auto" && vision.require?.input);
		vision.require.input.push("audio");
		const fallback = presetFallback("vision");
		assert.ok(fallback.require?.input);
		fallback.require.input.push("video");
		assert.deepEqual(DEFAULT_ROLE_SPECS.vision, { kind: "auto", prefer: "balanced", require: { input: ["image"] } });
		assert.deepEqual(effectiveRoleSpec("vision"), { kind: "auto", prefer: "balanced", require: { input: ["image"] } });
	});

	it("domain overrides beat global overrides, which beat presets", () => {
		const domain: Partial<Record<"tutor", RoleSpec>> = { tutor: auto("cheapest") };
		const global: Partial<Record<"tutor" | "grader", RoleSpec>> = { tutor: auto("fastest"), grader: auto("balanced") };
		assert.deepEqual(effectiveRoleSpec("tutor", { domain, global }), auto("cheapest"));
		assert.deepEqual(effectiveRoleSpec("grader", { domain, global }), auto("balanced"));
		assert.deepEqual(effectiveRoleSpec("planner", { domain, global }), DEFAULT_ROLE_SPECS.planner);
	});

	it("property: the choice never depends on the order of the entries", () => {
		const data = universe();
		const specs: RoleSpec[] = [
			auto("strongest"),
			auto("cheapest"),
			auto("fastest"),
			auto("balanced"),
			auto("strongest", { avoidConnection: "conn-api" }),
			auto("cheapest", { require: { reasoning: true } }),
		];
		const expected = specs.map((spec) => pick(spec, data));
		fc.assert(
			fc.property(fc.shuffledSubarray(data.entries, { minLength: data.entries.length, maxLength: data.entries.length }), (shuffled) => {
				const permuted = { entries: shuffled, metadata: data.metadata };
				assert.deepEqual(
					specs.map((spec) => pick(spec, permuted)),
					expected,
				);
			}),
			{ numRuns: 200 },
		);
	});

	it("property: random synthetic catalogs resolve deterministically to a satisfying entry", () => {
		const modelArb = fc.record({
			id: fc.stringMatching(/^m-[a-z0-9]{1,6}$/),
			connection: fc.constantFrom("c1", "c2", "c3"),
			order: fc.option(fc.integer({ min: 0, max: 5 }), { nil: undefined }),
			reasoning: fc.boolean(),
			price: fc.option(fc.record({ input: fc.double({ min: 0, max: 50, noNaN: true }), output: fc.double({ min: 0, max: 200, noNaN: true }) }), { nil: undefined }),
			context: fc.integer({ min: 8_000, max: 2_000_000 }),
			tps: fc.option(fc.integer({ min: 1, max: 500 }), { nil: undefined }),
		});
		fc.assert(
			fc.property(fc.uniqueArray(modelArb, { minLength: 1, maxLength: 12, selector: (m) => `${m.connection}/${m.id}` }), fc.constantFrom<RolePreference>("strongest", "cheapest", "fastest", "balanced"), (models, prefer) => {
				const entries = models.map((m) => entry(m.id, { connection: m.connection, ...(m.order !== undefined ? { order: m.order } : {}) }));
				const metadata = new Map(
					models.map((m, i) => [
						entryKey(entries[i] as EntitlementEntry),
						meta({ reasoning: m.reasoning, contextWindow: m.context, ...(m.price ? { cost: m.price } : {}), ...(m.tps ? { throughputTps: m.tps } : {}) }),
					]),
				);
				const spec = auto(prefer, { require: { minContext: 100_000 } });
				const eligible = models.filter((m) => m.context >= 100_000);
				let first: EntitlementEntry;
				try {
					first = resolveRole(spec, entries, metadata).entry;
				} catch (error) {
					assert.ok(error instanceof ModelResolveError);
					assert.equal(eligible.length, 0);
					return;
				}
				const chosen = models.find((m) => m.id === first.id && m.connection === first.connection);
				assert.ok(chosen && chosen.context >= 100_000);
				assert.equal(entryKey(resolveRole(spec, [...entries].reverse(), metadata).entry), entryKey(first));
			}),
			{ numRuns: 200 },
		);
	});
});

// ─── anti-ID lint ────────────────────────────────────────────────────────────

describe("no literal model ids in production code (§2.9 lint)", () => {
	it("src/core/{models,stats,domains} and the platform stores are clean", () => {
		const root = path.resolve(import.meta.dirname, "..");
		const files = [
			...["src/core/models", "src/core/stats", "src/core/domains"].flatMap((dir) =>
				fs
					.readdirSync(path.join(root, dir))
					.filter((name) => name.endsWith(".ts"))
					.map((name) => path.join(dir, name)),
			),
			"src/store/stats-store.ts",
			"src/store/domains-store.ts",
			"src/store/credential-store.ts",
		];
		const hits = files.flatMap((file) =>
			fs
				.readFileSync(path.join(root, file), "utf-8")
				.split("\n")
				.flatMap((line, i) => (/gpt-|claude-|gemini-/i.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [])),
		);
		assert.deepEqual(hits, []);
	});
});
