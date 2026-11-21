export type StudyAttachmentKind = "book" | "reading" | "video";

export interface StudyAttachmentItem {
	kind: StudyAttachmentKind;
	title: string;
	part: string;
	url: string;
	sectionUrl?: string;
	suggested?: boolean;
}

export interface StudyAttachments {
	items: StudyAttachmentItem[];
}

const LOCAL_READER_RE = /^\/ler\/[a-f0-9]{64}\?/;

function isHttpsUrl(value: unknown): value is string {
	if (typeof value !== "string" || !value) return false;
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}

function isAttachmentKind(value: unknown): value is StudyAttachmentKind {
	return value === "book" || value === "reading" || value === "video";
}

/** Pure TypeScript validator for attached study materials (zero Zod dependency in client bundles). */
export function parseStudyAttachments(value: unknown): StudyAttachments | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const rawItems = (value as { items?: unknown }).items;
	if (!Array.isArray(rawItems)) return null;
	const items: StudyAttachmentItem[] = [];
	for (const entry of rawItems) {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
		const item = entry as Record<string, unknown>;
		if (!isAttachmentKind(item.kind)) return null;
		if (typeof item.title !== "string" || item.title.length === 0) return null;
		if (typeof item.part !== "string") return null;
		if (typeof item.url !== "string" || (!isHttpsUrl(item.url) && !LOCAL_READER_RE.test(item.url))) return null;
		if (item.sectionUrl !== undefined && !isHttpsUrl(item.sectionUrl)) return null;
		if (item.suggested !== undefined && typeof item.suggested !== "boolean") return null;
		items.push({
			kind: item.kind,
			title: item.title,
			part: item.part,
			url: item.url,
			...(item.sectionUrl !== undefined ? { sectionUrl: item.sectionUrl } : {}),
			...(item.suggested !== undefined ? { suggested: item.suggested } : {}),
		});
	}
	return { items };
}
