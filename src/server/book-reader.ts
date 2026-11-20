import { processImage, detectSupportedImageMimeType } from "../agent/image-processing/index.ts";
import path from "node:path";
import { activeDomainId, PATHS } from "../../config.ts";
import { libraryDir } from "../core/domains/paths.ts";
import { getHeadless } from "../agent/subagents/headless.ts";
import { regionalReadingList } from "./resources/region-readings.ts";
import { createBookPageCache } from "./resources/book-page-cache.ts";
import { libraryItemDir, readBookUnit, readLibraryItem } from "./resources/user-library.ts";
import { StudyError } from "./study.ts";

export async function prepareReadingScreenshot(input: unknown) {
	const prefix = "data:image/jpeg;base64,";
	if (typeof input !== "string" || input.length > 4_500_000 || !input.startsWith(prefix))
		throw new StudyError(400, "Print inválido.");
	const bytes = Buffer.from(input.slice(prefix.length), "base64");
	if (detectSupportedImageMimeType(bytes) !== "image/jpeg") throw new StudyError(400, "Print inválido.");
	const normalized = await processImage(bytes, "image/jpeg");
	if (!normalized.ok) throw new StudyError(400, "Não foi possível ler o print.");
	return { type: "image" as const, data: normalized.data, mimeType: normalized.mimeType };
}

function checkLink(domain: string, region: string, sha: string) {
	if (!domain || activeDomainId() !== domain) throw new StudyError(409, "O domínio ativo mudou.");
	if (!/^[a-f0-9]{64}$/.test(sha) || !regionalReadingList(domain, region).some(book => book.id === sha))
		throw new StudyError(404, "Livro indisponível nesta região.");
}

export async function regionalBookUnit(domain: string, region: string, sha: string, unit: number, withLayout = false) {
	checkLink(domain, region, sha);
	const result = await readBookUnit(libraryDir(PATHS.data), sha, unit, withLayout);
	if (!result) throw new StudyError(404, "Página ou seção indisponível.");
	checkLink(domain, region, sha);
	return result;
}

const cachedPdfImage = createBookPageCache<Buffer>(24 * 1024 * 1024, png => png.byteLength);

export async function regionalBookImage(domain: string, region: string, sha: string, unit: number) {
	checkLink(domain, region, sha);
	const root = libraryDir(PATHS.data);
	const book = readLibraryItem(root, sha);
	if (book?.meta.format !== "pdf" || !Number.isSafeInteger(unit) || unit < 1 || unit > (book.meta.numPages ?? 0))
		throw new StudyError(404, "Página indisponível.");
	const file = path.join(libraryItemDir(root, sha), "original.pdf");
	const png = await cachedPdfImage(file, unit, async () => {
		const [image] = await getHeadless().renderPdfPages(file, [unit], { dpi: 115 });
		if (!image) throw new StudyError(422, "Não foi possível exibir a página original.");
		return image.png;
	});
	checkLink(domain, region, sha);
	return Buffer.from(png);
}
