import { placementOf, type SourceDirectory } from "./source-organization.ts";

export interface SourceEntrySelection { sources: ReadonlySet<string>; folders: ReadonlySet<string> }
export function folderEntries(directory: SourceDirectory, id: string): { sources: string[]; folders: string[] } {
	const folders = new Set([id]);
	for (const folder of directory.organization.folders) {
		let parent = folder.parentId;
		const seen = new Set<string>();
		while (parent !== null && !seen.has(parent)) {
			if (parent === id) { folders.add(folder.id); break; }
			seen.add(parent); parent = directory.organization.folders.find((f) => f.id === parent)?.parentId ?? null;
		}
	}
	return { folders: [...folders], sources: directory.sources.filter((s) => folders.has(placementOf(directory.organization, s.id)?.folderId ?? "")).map((s) => s.id) };
}
export function folderEntryCheck(directory: SourceDirectory, id: string, selected: SourceEntrySelection) {
	const entries = folderEntries(directory, id);
	const count = entries.sources.filter((id) => selected.sources.has(id)).length + entries.folders.filter((id) => selected.folders.has(id)).length;
	const total = entries.sources.length + entries.folders.length;
	return { checked: count === total, indeterminate: count > 0 && count < total };
}
/** One ordinary tree selection, independent of shared global graph-node IDs.
 * Empty entries count too; practice continues using its separate flat node set. */
export function toggleSourceEntries(directory: SourceDirectory, selected: SourceEntrySelection, kind: "source" | "folder", id: string, checked: boolean): SourceEntrySelection {
	const sources = new Set(selected.sources), folders = new Set(selected.folders);
	const apply = (set: Set<string>, ids: string[]) => { for (const id of ids) { if (checked) set.add(id); else set.delete(id); } };
	if (kind === "source") apply(sources, [id]);
	else { const entries = folderEntries(directory, id); apply(sources, entries.sources); apply(folders, entries.folders); }
	// Aggregate each direct child once. A child folder contributes its final
	// selection when processed, so parents still roll up from deepest to root.
	const parents = new Map(directory.organization.folders.map(folder => [folder.id, folder.parentId]));
	const childFolders = new Map<string, string[]>();
	const hasSources = new Set<string>();
	const unselectedSources = new Set<string>();
	for (const source of directory.sources) {
		const parent = placementOf(directory.organization, source.id)?.folderId;
		if (parent == null) continue;
		hasSources.add(parent);
		if (!sources.has(source.id)) unselectedSources.add(parent);
	}
	const ordered = directory.organization.folders.map(folder => {
		if (folder.parentId !== null) {
			const siblings = childFolders.get(folder.parentId);
			if (siblings) siblings.push(folder.id);
			else childFolders.set(folder.parentId, [folder.id]);
		}
		const seen = new Set<string>();
		let parent = folder.parentId;
		while (parent && !seen.has(parent)) { seen.add(parent); parent = parents.get(parent) ?? null; }
		return { folder, depth: seen.size };
	}).sort((a, b) => b.depth - a.depth);
	for (const { folder } of ordered) {
		const children = childFolders.get(folder.id);
		if (!children && !hasSources.has(folder.id)) continue;
		if (!unselectedSources.has(folder.id) && (!children || children.every(child => folders.has(child)))) folders.add(folder.id);
		else folders.delete(folder.id);
	}
	return { sources, folders };
}
