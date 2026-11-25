import fs from "node:fs";
import {
	getIntensiveMaterialDoc,
	resolveIntensiveMaterialFilePath,
} from "@/src/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ByteRangeParseResult =
	| { ok: true; start: number; end: number }
	| { ok: false };

function parseByteRange(rangeHeader: string, totalSize: number): ByteRangeParseResult {
	if (totalSize <= 0) return { ok: false };
	const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
	if (!match) return { ok: false };

	const [, startStr = "", endStr = ""] = match;
	if (!startStr && !endStr) return { ok: false };

	if (!startStr) {
		const suffixLength = Number.parseInt(endStr, 10);
		if (!Number.isFinite(suffixLength) || suffixLength <= 0) return { ok: false };
		const start = Math.max(0, totalSize - suffixLength);
		return { ok: true, start, end: totalSize - 1 };
	}

	const start = Number.parseInt(startStr, 10);
	const rawEnd = endStr ? Number.parseInt(endStr, 10) : totalSize - 1;
	if (!Number.isFinite(start) || !Number.isFinite(rawEnd)) return { ok: false };
	if (start < 0 || start >= totalSize || rawEnd < start) return { ok: false };

	return {
		ok: true,
		start,
		end: Math.min(rawEnd, totalSize - 1),
	};
}

function createSafeFileStream(
	absPath: string,
	start: number,
	end: number,
	signal?: AbortSignal,
): ReadableStream<Uint8Array> {
	let nodeStream: fs.ReadStream | null = null;
	let closed = false;

	const cleanup = () => {
		if (closed) return;
		closed = true;
		if (signal) {
			signal.removeEventListener("abort", onAbort);
		}
		if (nodeStream && !nodeStream.destroyed) {
			nodeStream.destroy();
		}
		nodeStream = null;
	};

	const onAbort = () => {
		cleanup();
	};

	return new ReadableStream<Uint8Array>({
		start(controller) {
			if (signal?.aborted) {
				closed = true;
				try {
					controller.close();
				} catch {
					// already closed
				}
				return;
			}
			if (signal) {
				signal.addEventListener("abort", onAbort, { once: true });
			}

			nodeStream = fs.createReadStream(/* turbopackIgnore: true */ absPath, {
				start,
				end,
				highWaterMark: 256 * 1024,
			});

			nodeStream.on("data", (chunk: string | Buffer) => {
				if (closed) return;
				try {
					const bytes =
						typeof chunk === "string"
							? Buffer.from(chunk)
							: new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
					controller.enqueue(bytes);
					if (controller.desiredSize !== null && controller.desiredSize <= 0) {
						nodeStream?.pause();
					}
				} catch {
					cleanup();
				}
			});

			nodeStream.on("end", () => {
				if (closed) return;
				cleanup();
				try {
					controller.close();
				} catch {
					// ignore
				}
			});

			nodeStream.on("error", (err) => {
				if (closed) return;
				cleanup();
				try {
					controller.error(err);
				} catch {
					// ignore
				}
			});
		},
		pull() {
			if (!closed && nodeStream && nodeStream.isPaused()) {
				nodeStream.resume();
			}
		},
		cancel() {
			cleanup();
		},
	});
}

function buildInlineDisposition(fileName: string): string {
	const asciiSafe = fileName
		.replace(/[\r\n"\\]/g, "_")
		.replace(/[^\x20-\x7e]/g, "_")
		.trim() || "material";
	const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) =>
		`%${c.charCodeAt(0).toString(16).toUpperCase()}`,
	);
	return `inline; filename="${asciiSafe}"; filename*=UTF-8''${encoded}`;
}

async function handleMaterialRequest(
	request: Request,
	paramsPromise: Promise<{ courseId: string; materialId: string }>,
	headOnly: boolean,
): Promise<Response> {
	const { courseId, materialId } = await paramsPromise;
	const format = (new URL(request.url).searchParams.get("format")?.trim() || "").toLowerCase();

	if (format && format !== "file" && format !== "text" && format !== "json") {
		return Response.json(
			{ error: "Invalid format parameter. Expected 'file', 'text', or 'json'." },
			{ status: 400 },
		);
	}

	if (format === "text" || format === "json") {
		const doc = getIntensiveMaterialDoc(courseId, materialId);
		if (!doc) {
			return Response.json({ error: "Material text not found." }, { status: 404 });
		}
		if (headOnly) {
			return new Response(null, {
				status: 200,
				headers: {
					"Content-Type": "application/json; charset=utf-8",
					"Cache-Control": "private, no-store",
				},
			});
		}
		return Response.json(doc, {
			headers: { "Cache-Control": "private, no-store" },
		});
	}

	const file = resolveIntensiveMaterialFilePath(courseId, materialId);
	if (!file) {
		return Response.json({ error: "Material file not found." }, { status: 404 });
	}

	const totalSize = file.size;
	const disposition = buildInlineDisposition(file.fileName);
	const rangeHeader = request.headers.get("range");

	if (rangeHeader) {
		const parsed = parseByteRange(rangeHeader, totalSize);
		if (!parsed.ok) {
			return new Response(null, {
				status: 416,
				headers: {
					"Content-Range": `bytes */${totalSize}`,
					"Accept-Ranges": "bytes",
					"Cache-Control": "private, no-store",
				},
			});
		}

		const { start, end } = parsed;
		const chunkSize = end - start + 1;
		const headers = new Headers({
			"Content-Type": file.contentType,
			"Content-Disposition": disposition,
			"Content-Range": `bytes ${start}-${end}/${totalSize}`,
			"Content-Length": String(chunkSize),
			"Accept-Ranges": "bytes",
			"X-Content-Type-Options": "nosniff",
			"Cache-Control": "private, no-store",
		});

		if (headOnly) {
			return new Response(null, { status: 206, headers });
		}

		const stream = createSafeFileStream(file.absPath, start, end, request.signal);
		return new Response(stream, { status: 206, headers });
	}

	const headers = new Headers({
		"Content-Type": file.contentType,
		"Content-Disposition": disposition,
		"Content-Length": String(totalSize),
		"Accept-Ranges": "bytes",
		"X-Content-Type-Options": "nosniff",
		"Cache-Control": "private, no-store",
	});

	if (headOnly || totalSize === 0) {
		return new Response(null, { status: 200, headers });
	}

	const stream = createSafeFileStream(file.absPath, 0, totalSize - 1, request.signal);
	return new Response(stream, { status: 200, headers });
}

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ courseId: string; materialId: string }> },
) {
	return handleMaterialRequest(request, params, false);
}

export async function HEAD(
	request: Request,
	{ params }: { params: Promise<{ courseId: string; materialId: string }> },
) {
	return handleMaterialRequest(request, params, true);
}
