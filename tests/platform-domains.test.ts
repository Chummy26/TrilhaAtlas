/**
 * Platform · domains (docs/research/00-SINTESE.md §2.2–2.3, M1 criteria):
 *
 *  1. Canonical layout (src/core/domains/paths.ts): every path builder,
 *     separators, and rejection of ids/segments that could climb out.
 *  2. Manifest/profile schemas and the built-in defaults (english,
 *     electronics) with their resource policies.
 *  3. Store (src/store/domains-store.ts) in a temp dir: two domains get
 *     separate trees, writing one never changes a byte of the other,
 *     active domain pointer, listing, prefix collisions, trash removal.
 */

import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import fc from "fast-check";
import {
	activityLogFile,
	BUILTIN_DOMAIN_IDS,
	chatsDir,
	credentialsFile,
	curriculumDir,
	customManifest,
	defaultDomainProfile,
	DOMAIN_SUBDIRS,
	domainDir,
	DomainManifestError,
	DomainPathError,
	domainPath,
	domainTree,
	electronicsManifest,
	englishManifest,
	flashcardsDir,
	isWindowsDeviceName,
	learnerDir,
	libraryDir,
	libraryItemDir,
	memoryDir,
	parseDomainManifest,
	parseDomainProfile,
	profileDir,
	progressDir,
	resourcesDir,
	statsDir,
	usageLogFile,
} from "../src/core/domains/index.ts";
import { createDomainsStore, DomainStoreError } from "../src/store/domains-store.ts";

const NOW = "2026-11-18T12:00:00.000Z";
const tmpRoots: string[] = [];

function tmpRoot(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-platform-domains-"));
	tmpRoots.push(dir);
	return dir;
}

after(() => {
	for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true });
});

/** sha256 of every file under `dir` (relative path → hash), plus empty dirs. */
function snapshotTree(dir: string): Map<string, string> {
	const out = new Map<string, string>();
	const walk = (current: string) => {
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const full = path.join(current, entry.name);
			const rel = path.relative(dir, full).split(path.sep).join("/");
			if (entry.isDirectory()) {
				out.set(`${rel}/`, "dir");
				walk(full);
			} else out.set(rel, crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex"));
		}
	};
	walk(dir);
	return out;
}

describe("domain layout (paths.ts)", () => {
	const root = "/data";

	it("builds the canonical §2.2 tree from the root", () => {
		assert.equal(profileDir(root), "/data/profile");
		assert.equal(statsDir(root), "/data/profile/stats");
		assert.equal(credentialsFile(root), "/data/profile/credentials.enc");
		assert.equal(libraryDir(root), "/data/library");
		assert.equal(domainDir(root, "english"), "/data/domains/english");
		assert.equal(chatsDir(root, "english"), "/data/domains/english/chats");
		assert.equal(curriculumDir(root, "electronics"), "/data/domains/electronics/curriculum");
		assert.equal(learnerDir(root, "electronics"), "/data/domains/electronics/learner");
		assert.equal(memoryDir(root, "english"), "/data/domains/english/memory");
		assert.equal(resourcesDir(root, "english"), "/data/domains/english/resources");
		assert.equal(progressDir(root, "english"), "/data/domains/english/progress");
		assert.equal(flashcardsDir(root, "english"), "/data/domains/english/plugins/flashcards");
		assert.equal(usageLogFile(root, "2026-11"), "/data/profile/stats/usage-2026-11.jsonl");
		assert.equal(activityLogFile(root, "2026-01"), "/data/profile/stats/activity-2026-01.jsonl");
	});

	it("follows the root's separator (Windows roots join with backslashes)", () => {
		assert.equal(chatsDir("C:\\Users\\Usuário Teste\\data", "english"), "C:\\Users\\Usuário Teste\\data\\domains\\english\\chats");
		assert.equal(flashcardsDir("C:\\data\\", "electronics"), "C:\\data\\domains\\electronics\\plugins\\flashcards");
		assert.equal(domainDir("/data/", "english"), "/data/domains/english");
	});

	it("two domains never share a folder", () => {
		const a = new Set(domainTree(root, "english"));
		for (const dir of domainTree(root, "electronics")) assert.ok(!a.has(dir), `${dir} is shared`);
		for (const dir of domainTree(root, "english")) assert.ok(dir.startsWith("/data/domains/english"));
	});

	it("rejects ids and segments that could escape domains/<id>", () => {
		for (const bad of ["..", ".", "", "English", "en glish", "a", "../x", "x/..", "x\\y", "1abc", "/etc"]) {
			assert.throws(() => domainDir(root, bad), DomainPathError, `accepted ${JSON.stringify(bad)}`);
		}
		assert.throws(() => domainPath(root, "english", "../electronics"), DomainPathError);
		assert.throws(() => domainPath(root, "english", "chats/../../x"), DomainPathError);
		assert.throws(() => usageLogFile(root, "2026-13"), DomainPathError);
		assert.throws(() => libraryItemDir(root, "not-a-hash"), DomainPathError);
		assert.throws(() => profileDir("  "), DomainPathError);
	});

	it("refuses names Windows cannot hold: device ids, ':' (alternate data streams), trailing dots/spaces", () => {
		for (const device of ["con", "nul", "aux", "prn", "com1", "lpt9"]) {
			assert.throws(() => domainDir(root, device), DomainPathError, `accepted device name ${device}`);
			assert.throws(() => parseDomainManifest(customManifest({ id: device, nodePrefix: "zz", title: { pt: "X", en: "X" }, createdAt: NOW })), DomainManifestError);
			assert.throws(() => parseDomainProfile(defaultDomainProfile(device, NOW)), DomainManifestError);
		}
		assert.equal(domainDir(root, "console"), "/data/domains/console", "only exact device names are reserved");
		assert.equal(domainDir(root, "com-ee"), "/data/domains/com-ee");
		for (const segment of ["chats/a:b", "chats.", "chats ", "x/nul.json", "x/a|b", "x/a?b", "x/a*b", 'x/a"b', "x/a<b", "x/\u0001"]) {
			assert.throws(() => domainPath(root, "english", segment), DomainPathError, `accepted ${JSON.stringify(segment)}`);
		}
		assert.equal(domainPath(root, "english", "resources/transcripts/abc.en.json"), "/data/domains/english/resources/transcripts/abc.en.json");
	});

	it("property: every valid id stays inside domains/<id>, every built path is distinct per id", () => {
		const idArb = fc.stringMatching(/^[a-z][a-z0-9-]{1,39}$/).filter((id) => !isWindowsDeviceName(id));
		fc.assert(
			fc.property(idArb, idArb, (a, b) => {
				const dirA = domainDir(root, a);
				assert.equal(dirA, `/data/domains/${a}`);
				for (const sub of DOMAIN_SUBDIRS) assert.ok(domainPath(root, a, sub).startsWith(`${dirA}/`));
				if (a !== b) assert.notEqual(chatsDir(root, a), chatsDir(root, b));
			}),
		);
	});
});

describe("manifest schema and defaults", () => {
	it("built-in manifests validate and carry the §2.2 policies", () => {
		const en = parseDomainManifest(englishManifest(NOW));
		assert.equal(en.nodePrefix, "en");
		assert.equal(en.accent, "coral");
		assert.equal(en.icon, "domain-english");
		assert.equal(en.levelScheme, "cefr");
		assert.equal(en.reviewClient, "app");
		assert.deepEqual(en.targetHours, { lo: 1000, hi: 1500 });
		assert.deepEqual(en.backgroundBudget, { enabled: true, tokensPerDay: 300_000 });
		assert.equal(en.resourcePolicy.requireOriginalAudio, "en");
		assert.equal(en.resourcePolicy.allowAutoDub, false);
		assert.deepEqual(en.resourcePolicy.captionLangs, ["en", "pt"]);
		assert.equal(en.resourcePolicy.lessonLang, "pt-BR");

		const ee = parseDomainManifest(electronicsManifest(NOW));
		assert.equal(ee.nodePrefix, "ee");
		assert.equal(ee.accent, "volt");
		assert.equal(ee.icon, "domain-electronics");
		assert.equal(ee.levelScheme, "ee");
		assert.deepEqual(ee.resourcePolicy.videoAudioLangs, ["pt", "en"]);
		assert.equal(ee.resourcePolicy.allowAutoDub, true);
		assert.deepEqual(ee.resourcePolicy.captionLangs, ["pt"]);
		assert.equal(ee.resourcePolicy.requireOriginalAudio, undefined);
	});

	it("custom manifests and default profiles validate", () => {
		const m = parseDomainManifest(customManifest({ id: "music", nodePrefix: "mu", title: { pt: "Música", en: "Music" }, createdAt: NOW }));
		assert.equal(m.levelScheme, "generic");
		const p = parseDomainProfile(defaultDomainProfile("music", NOW));
		assert.equal(p.dailyBudgetMin, 180);
	});

	it("rejects broken manifests with every issue listed", () => {
		const broken = { ...englishManifest(NOW), schemaVersion: 2, nodePrefix: "EN!", targetHours: { lo: 1500, hi: 1000 } };
		try {
			parseDomainManifest(broken);
			assert.fail("expected DomainManifestError");
		} catch (error) {
			assert.ok(error instanceof DomainManifestError);
			assert.ok(error.issues.length >= 3, error.message);
			assert.match(error.message, /schemaVersion/);
			assert.match(error.message, /nodePrefix/);
		}
	});

	it("keeps unknown keys from newer builds (loose objects)", () => {
		const m = parseDomainManifest({ ...englishManifest(NOW), futureField: 42 }) as unknown as Record<string, unknown>;
		assert.equal(m.futureField, 42);
	});

	it("validates role overrides", () => {
		const ok = parseDomainManifest({ ...englishManifest(NOW), roles: { tutor: { kind: "auto", prefer: "strongest", require: { reasoning: true } } } });
		assert.equal(ok.roles?.tutor?.kind, "auto");
		assert.throws(() => parseDomainManifest({ ...englishManifest(NOW), roles: { tutor: { kind: "auto", prefer: "smartest" } } }), DomainManifestError);
		assert.throws(() => parseDomainManifest({ ...englishManifest(NOW), roles: { wizard: { kind: "auto", prefer: "cheapest" } } }), DomainManifestError);
	});
});

describe("domains store (temp dir)", () => {
	const clock = () => new Date(NOW);

	it("seeds english and electronics with separate trees, manifests and profiles", () => {
		const root = tmpRoot();
		const store = createDomainsStore(root, { now: clock });
		store.ensureWorkspace();
		const seeded = store.seedBuiltinDomains();
		assert.deepEqual(
			seeded.map((m) => m.id),
			[...BUILTIN_DOMAIN_IDS],
		);
		for (const id of BUILTIN_DOMAIN_IDS) {
			for (const dir of domainTree(root, id)) assert.ok(fs.statSync(dir).isDirectory(), `${dir} missing`);
			assert.equal(store.readManifest(id)?.id, id);
			assert.equal(store.readProfile(id)?.domainId, id);
		}
		assert.ok(fs.statSync(statsDir(root)).isDirectory());
		assert.deepEqual(
			store.listDomains().map((d) => d.id),
			["english", "electronics"],
		);
	});

	it("ensureDomain is idempotent and never rewrites an existing manifest", () => {
		const root = tmpRoot();
		const store = createDomainsStore(root, { now: clock });
		store.ensureDomain("english");
		const before = snapshotTree(domainDir(root, "english"));
		const again = createDomainsStore(root, { now: () => new Date("2030-01-01T00:00:00Z") }).ensureDomain("english");
		assert.equal(again.createdAt, NOW);
		assert.deepEqual(snapshotTree(domainDir(root, "english")), before);
	});

	it("isolation: every write to one domain leaves the other byte-identical", () => {
		const root = tmpRoot();
		const store = createDomainsStore(root, { now: clock });
		store.seedBuiltinDomains();
		fs.writeFileSync(path.join(chatsDir(root, "electronics"), "chat-1.json"), '{"title":"op-amp"}');
		const electronicsBefore = snapshotTree(domainDir(root, "electronics"));

		store.updateManifest("english", (m) => ({ ...m, backgroundBudget: { enabled: false, tokensPerDay: 0 } }));
		store.updateProfile("english", (p) => ({ ...p, dailyBudgetMin: 240, goal: { text: "C1", targetNodeIds: [] } }));
		store.writeProfile({ ...defaultDomainProfile("english", NOW), specialization: "listening" });
		fs.writeFileSync(path.join(chatsDir(root, "english"), "chat-2.json"), '{"title":"phrasal verbs"}');
		store.setActiveDomain("english");

		assert.deepEqual(snapshotTree(domainDir(root, "electronics")), electronicsBefore);
		assert.equal(store.readManifest("electronics")?.backgroundBudget.enabled, true);
		assert.equal(store.readManifest("english")?.backgroundBudget.enabled, false);
		assert.deepEqual(fs.readdirSync(chatsDir(root, "electronics")), ["chat-1.json"]);
		assert.deepEqual(fs.readdirSync(chatsDir(root, "english")), ["chat-2.json"]);
	});

	it("tracks the active domain in profile/active-domain.json", () => {
		const root = tmpRoot();
		const store = createDomainsStore(root, { now: clock });
		store.seedBuiltinDomains();
		assert.equal(store.getActiveDomain(), null);
		store.setActiveDomain("electronics");
		assert.equal(store.getActiveDomain(), "electronics");
		assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "profile", "active-domain.json"), "utf-8")), { domainId: "electronics", updatedAt: NOW });
		assert.deepEqual(
			store.listDomains().map((d) => [d.id, d.active]),
			[
				["english", false],
				["electronics", true],
			],
		);
		assert.throws(() => store.setActiveDomain("music"), (e: unknown) => e instanceof DomainStoreError && e.code === "not-found");
		fs.writeFileSync(path.join(root, "profile", "active-domain.json"), "{ broken");
		assert.equal(store.getActiveDomain(), null);
	});

	it("creates custom domains only with a manifest, and refuses a taken node prefix", () => {
		const root = tmpRoot();
		const store = createDomainsStore(root, { now: clock });
		store.seedBuiltinDomains();
		assert.throws(() => store.ensureDomain("music"), (e: unknown) => e instanceof DomainStoreError && e.code === "no-manifest");
		const clash = customManifest({ id: "music", nodePrefix: "en", title: { pt: "Música", en: "Music" }, createdAt: NOW });
		assert.throws(() => store.ensureDomain("music", { manifest: clash }), (e: unknown) => e instanceof DomainStoreError && e.code === "prefix-taken");
		assert.equal(fs.existsSync(domainDir(root, "music")), false, "a refused domain leaves no folder");
		const mismatch = customManifest({ id: "art", nodePrefix: "ar", title: { pt: "Arte", en: "Art" }, createdAt: NOW });
		assert.throws(() => store.ensureDomain("music", { manifest: mismatch }), (e: unknown) => e instanceof DomainStoreError && e.code === "id-mismatch");
		store.ensureDomain("music", { manifest: { ...clash, nodePrefix: "mu" } });
		assert.deepEqual(
			store.listDomains().map((d) => d.id),
			["english", "electronics", "music"],
		);
	});

	it("reports broken manifests as problems without failing the listing", () => {
		const root = tmpRoot();
		const store = createDomainsStore(root, { now: clock });
		store.seedBuiltinDomains();
		fs.writeFileSync(path.join(domainDir(root, "electronics"), "domain.json"), '{"schemaVersion": 1');
		fs.mkdirSync(path.join(root, "domains", "orphan"));
		fs.mkdirSync(path.join(root, "domains", ".hidden"));
		const scan = store.scanDomains();
		assert.deepEqual(
			scan.manifests.map((m) => m.id),
			["english"],
		);
		assert.deepEqual(
			scan.problems.map((p) => p.id),
			["electronics", "orphan"],
		);
		assert.throws(() => store.readManifest("electronics"), DomainManifestError);
		assert.deepEqual(
			store.listDomains().map((d) => d.id),
			["english"],
		);
	});

	it("a refused profile leaves no half-created domain behind", () => {
		const root = tmpRoot();
		const store = createDomainsStore(root, { now: clock });
		const manifest = customManifest({ id: "music", nodePrefix: "mu", title: { pt: "Música", en: "Music" }, createdAt: NOW });
		assert.throws(
			() => store.ensureDomain("music", { manifest, profile: defaultDomainProfile("art", NOW) }),
			(e: unknown) => e instanceof DomainStoreError && e.code === "id-mismatch",
		);
		assert.equal(fs.existsSync(domainDir(root, "music")), false);
		assert.throws(() => store.ensureDomain("music", { manifest, profile: { ...defaultDomainProfile("music", NOW), dailyBudgetMin: 0 } }), DomainManifestError);
		assert.equal(fs.existsSync(domainDir(root, "music")), false);
		assert.equal(store.hasDomain("music"), false);
	});

	it("reads JSON saved with a UTF-8 BOM (Windows Notepad) and lists custom domains chronologically", () => {
		const root = tmpRoot();
		const store = createDomainsStore(root, { now: clock });
		store.ensureWorkspace();
		store.seedBuiltinDomains();
		const manifestFile = path.join(domainDir(root, "english"), "domain.json");
		fs.writeFileSync(manifestFile, `﻿${fs.readFileSync(manifestFile, "utf-8")}`);
		fs.writeFileSync(path.join(root, "profile", "active-domain.json"), `﻿${JSON.stringify({ domainId: "english", updatedAt: NOW })}`);
		assert.equal(store.readManifest("english")?.id, "english");
		assert.equal(store.getActiveDomain(), "english");
		assert.deepEqual(store.scanDomains().problems, []);

		// 10:00 at UTC−03:00 is 13:00Z: later than 12:00Z although it sorts earlier as text.
		store.ensureDomain("zeta", { manifest: customManifest({ id: "zeta", nodePrefix: "ze", title: { pt: "Zeta", en: "Zeta" }, createdAt: "2026-11-18T12:00:00Z" }) });
		store.ensureDomain("alpha", { manifest: customManifest({ id: "alpha", nodePrefix: "al", title: { pt: "Alfa", en: "Alpha" }, createdAt: "2026-11-18T10:00:00-03:00" }) });
		assert.deepEqual(
			store.listDomains().map((d) => d.id),
			["english", "electronics", "zeta", "alpha"],
		);
	});

	it("rejects manifests whose id differs from the folder", () => {
		const root = tmpRoot();
		const store = createDomainsStore(root, { now: clock });
		store.seedBuiltinDomains();
		assert.throws(() => store.updateManifest("english", (m) => ({ ...m, id: "electronics" })), (e: unknown) => e instanceof DomainStoreError && e.code === "id-mismatch");
		fs.writeFileSync(path.join(domainDir(root, "english"), "domain.json"), JSON.stringify(electronicsManifest(NOW)));
		assert.throws(() => store.readManifest("english"), (e: unknown) => e instanceof DomainStoreError && e.code === "id-mismatch");
	});

	it("removeDomain moves the domain to the trash and refuses the active one", () => {
		const root = tmpRoot();
		const store = createDomainsStore(root, { now: clock });
		store.seedBuiltinDomains();
		store.setActiveDomain("english");
		assert.throws(() => store.removeDomain("english"), (e: unknown) => e instanceof DomainStoreError && e.code === "active");
		const englishBefore = snapshotTree(domainDir(root, "english"));
		const trashed = store.removeDomain("electronics");
		assert.ok(fs.existsSync(path.join(trashed, "domain.json")));
		assert.equal(store.hasDomain("electronics"), false);
		assert.deepEqual(
			store.listDomains().map((d) => d.id),
			["english"],
		);
		assert.deepEqual(snapshotTree(domainDir(root, "english")), englishBefore);
		store.ensureDomain("electronics");
		const second = store.removeDomain("electronics");
		assert.notEqual(second, trashed, "a second removal never overwrites the first");
	});
});
