import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../../config.ts";
import { resourcesDir } from "../../core/domains/paths.ts";

export interface ManualMaterialEntry {
	id: string;
	kind: "book" | "video";
	title: string;
	part: string;
	url: string;
	lang: string;
	nodes: string[];
	regionId: string;
	libraryBookId?: string;
	notes?: string;
	createdAt: string;
}

function storePath(domain: string) {
	return path.join(resourcesDir(PATHS.data, domain), "manual-materials.json");
}

function writeAtomic(file: string, items: ManualMaterialEntry[]) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(items, null, "\t") + "\n", "utf8");
	fs.renameSync(tmp, file);
}

export function readManualMaterials(domain: string): ManualMaterialEntry[] {
	const file = storePath(domain);
	if (!fs.existsSync(file)) return [];
	try {
		const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((row): row is ManualMaterialEntry =>
			Boolean(row && typeof row === "object" && typeof row.id === "string" && (row.kind === "book" || row.kind === "video")
				&& typeof row.title === "string" && typeof row.part === "string" && typeof row.url === "string" && Array.isArray(row.nodes)),
		);
	} catch {
		return [];
	}
}

export function isAllowedMaterialUrl(url: string, allowLibraryPath = false): boolean {
	const trimmed = url.trim();
	if (allowLibraryPath && /^\/ler\/[a-f0-9]{64}(\?[^\s]*)?$/i.test(trimmed)) return true;
	try {
		const parsed = new URL(trimmed);
		return parsed.protocol === "https:";
	} catch {
		return false;
	}
}

export function addManualMaterial(
	domain: string,
	input: Omit<ManualMaterialEntry, "id" | "createdAt">,
): ManualMaterialEntry {
	const title = input.title.trim().slice(0, 160);
	const part = input.part.trim().slice(0, 200);
	const url = input.url.trim();
	const lang = (input.lang.trim() || "pt").slice(0, 12);
	const nodes = [...new Set(input.nodes.map(n => n.trim()).filter(Boolean))];
	const notes = input.notes?.trim().slice(0, 300) || undefined;
	if (!title || !part || !nodes.length) throw new Error("Informe título, seção/trecho e pelo menos um nó.");
	if (!isAllowedMaterialUrl(url, Boolean(input.libraryBookId))) {
		throw new Error("Use um link HTTPS válido (ex.: YouTube, artigo ou PDF).");
	}
	const list = readManualMaterials(domain);
	const entry: ManualMaterialEntry = {
		id: "man_" + randomUUID().replaceAll("-", "").slice(0, 12),
		kind: input.kind,
		title,
		part,
		url,
		lang,
		nodes,
		regionId: input.regionId,
		...(input.libraryBookId ? { libraryBookId: input.libraryBookId } : {}),
		...(notes ? { notes } : {}),
		createdAt: new Date().toISOString(),
	};
	list.push(entry);
	writeAtomic(storePath(domain), list);
	return entry;
}

export function removeManualMaterial(domain: string, id: string): boolean {
	const list = readManualMaterials(domain);
	const next = list.filter(entry => entry.id !== id);
	if (next.length === list.length) return false;
	writeAtomic(storePath(domain), next);
	return true;
}
