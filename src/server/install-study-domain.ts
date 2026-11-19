import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";
import { applySeedFiles } from "../core/curriculum/ledger.ts";
import type { CurriculumSeedFile } from "../core/curriculum/types.ts";
import { builtinManifests, customManifest } from "../core/domains/defaults.ts";
import { curriculumDir, domainDir, domainsDir } from "../core/domains/paths.ts";
import { withCurriculumLock } from "./curriculum-migration.ts";
import { createDomainsStore } from "../store/domains-store.ts";

export function installStudyDomain(files: CurriculumSeedFile[], authoring?: { topic: string; model: string; requestId: string; fingerprint: string }) {
	const createdAt = new Date().toISOString();
	const result = applySeedFiles(files, { createdAt, edgeMode: "strict", model: authoring?.model, promptVersion: authoring ? "domain-authoring-v1" : undefined });
	if (!result.ok) throw new Error(result.errors.map(error => error.message).slice(0, 6).join("\n"));
	const { snapshot, envelope } = result;
	const root = Object.values(snapshot.items).find(item => item.parentId === null)!;
	const manifest = customManifest({ id: snapshot.domainId, nodePrefix: root.id, title: root.title, createdAt });
	const sources = new Map<string, (typeof files)[number]["sources"][number]>();
	for (const source of files.flatMap(file => file.sources)) {
		const previous = sources.get(source.id);
		if (previous && JSON.stringify(previous) !== JSON.stringify(source)) throw new Error("Conflicting source ID: " + source.id);
		if (source.kind && (!source.url || new URL(source.url).protocol !== "https:")) throw new Error("Learning materials need an HTTPS URL: " + source.id);
		sources.set(source.id, source);
	}
	for (const item of Object.values(snapshot.items)) {
		for (const anchor of item.anchors) if (!sources.has(anchor.source)) throw new Error("Unknown source: " + anchor.source + " on " + item.id);
	}
	const store = createDomainsStore(PATHS.data);
	const dest = domainDir(PATHS.data, manifest.id);
	const parent = domainsDir(PATHS.data);
	withCurriculumLock(parent, () => {
		const existing = [...builtinManifests(createdAt), ...store.scanDomains().manifests];
		if (fs.existsSync(dest) || existing.some(other => other.id === manifest.id || other.nodePrefix === root.id))
			throw new Error("Domain ID or node prefix already in use. Existing study records were preserved.");
		const stage = fs.mkdtempSync(path.join(parent, ".import-"));
		try {
			const staging = createDomainsStore(stage);
			staging.ensureDomain(manifest.id, { manifest });
			if (authoring) {
				staging.updateProfile(manifest.id, profile => ({ ...profile, goal: { ...profile.goal, text: authoring.topic } }));
				fs.writeFileSync(path.join(curriculumDir(stage, manifest.id), "generation.json"), JSON.stringify({ requestId: authoring.requestId, fingerprint: authoring.fingerprint }));
			}
			const curriculum = curriculumDir(stage, manifest.id);
			fs.writeFileSync(path.join(curriculum, "sources.json"), JSON.stringify([...sources.values()]));
			fs.writeFileSync(path.join(curriculum, "ledger.jsonl"), JSON.stringify(envelope) + "\n");
			fs.writeFileSync(path.join(curriculum, "snapshot.json"), JSON.stringify(snapshot));
			fs.renameSync(domainDir(stage, manifest.id), dest);
		} finally {
			fs.rmSync(stage, { recursive: true, force: true });
		}
	});
	return manifest;
}
