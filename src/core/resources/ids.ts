/**
 * Resource id grammar (SÍNTESE §2.3 `Resource.id`; r6 §11.1 `ResourceRef`).
 *
 *   <prefix>:<externalId>[#<sectionId>]
 *
 *   yt:dQw4w9WgXcQ                     YouTube video (Data API or enriched)
 *   openstax:<bookUuid>#2.1            OpenStax book / TOC section
 *   libretexts:<bookID>                LibreTexts Commons book
 *   otl:<id>                           Open Textbook Library
 *   ol:OL123W | ol:isbn:978…           Open Library work/edition/ISBN
 *   crossref:10.1007/978-…             Crossref DOI
 *   arxiv:2207.05872                   arXiv e-print (metadata only)
 *   wikibooks:en:Electronics#2.1       Wikibooks book / subpage
 *   kuphaldt:liec-dc#2                 Kuphaldt LIEC / ModEL chapter
 *   lib:<sha256>#<tocId>               learner's own file in the library
 *
 * The prefix routes `resolve/toc/content` in the registry. Only the FIRST "#"
 * separates the section, so section ids may not contain "#" (they never do:
 * every provider uses the dotted TOC ids from `buildToc`, e.g. "2.1").
 *
 * Pure: browser-safe.
 */

export interface ParsedResourceId {
	prefix: string;
	/** Everything between the prefix and the section separator. */
	externalId: string;
	sectionId?: string;
	/** The id without its section (the book/video itself). */
	baseId: string;
}

const PREFIX_PATTERN = /^[a-z][a-z0-9-]{0,23}$/;

export class ResourceIdError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ResourceIdError";
	}
}

/** Build `<prefix>:<externalId>`; rejects empty parts and "#" in the external id. */
export function makeResourceId(prefix: string, externalId: string): string {
	if (!PREFIX_PATTERN.test(prefix)) throw new ResourceIdError(`Prefixo de recurso inválido: "${prefix}".`);
	if (!externalId || externalId.includes("#")) throw new ResourceIdError(`Id externo inválido para "${prefix}": "${externalId}".`);
	return `${prefix}:${externalId}`;
}

/** Append a section id: `<bookId>#<sectionId>`. */
export function sectionResourceId(bookId: string, sectionId: string): string {
	if (!sectionId || sectionId.includes("#")) throw new ResourceIdError(`Id de seção inválido: "${sectionId}".`);
	return `${parseResourceId(bookId).baseId}#${sectionId}`;
}

/** Split an id into prefix, external id and optional section. */
export function parseResourceId(id: string): ParsedResourceId {
	const colon = id.indexOf(":");
	if (colon <= 0) throw new ResourceIdError(`Id de recurso sem prefixo: "${id}".`);
	const prefix = id.slice(0, colon);
	if (!PREFIX_PATTERN.test(prefix)) throw new ResourceIdError(`Prefixo de recurso inválido: "${prefix}".`);
	const rest = id.slice(colon + 1);
	const hash = rest.indexOf("#");
	const externalId = hash >= 0 ? rest.slice(0, hash) : rest;
	const sectionId = hash >= 0 ? rest.slice(hash + 1) : undefined;
	if (!externalId) throw new ResourceIdError(`Id de recurso vazio: "${id}".`);
	if (sectionId !== undefined && !sectionId) throw new ResourceIdError(`Seção vazia no id: "${id}".`);
	return { prefix, externalId, ...(sectionId ? { sectionId } : {}), baseId: `${prefix}:${externalId}` };
}

/** Non-throwing variant: undefined for malformed ids. */
export function tryParseResourceId(id: string): ParsedResourceId | undefined {
	try {
		return parseResourceId(id);
	} catch {
		return undefined;
	}
}
