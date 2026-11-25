import fs from "node:fs";
import {
	getIntensiveLessonTranscriptFile,
	resolveIntensiveLessonMediaPath,
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
		// Suffix byte range: bytes=-N
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

/**
 * Wraps a Node ReadStream in a Web ReadableStream with backpressure and
 * guaranteed `.destroy()` cleanup on cancel, error, or client disconnect so
 * rapid <video> scrubbing never leaks file handles on Windows.
 */
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

async function handleMediaRequest(
	request: Request,
	paramsPromise: Promise<{ courseId: string; lessonId: string }>,
	headOnly: boolean,
): Promise<Response> {
	const { courseId, lessonId } = await paramsPromise;
	const kind = (new URL(request.url).searchParams.get("kind")?.trim() || "video").toLowerCase();

	if (kind !== "video" && kind !== "thumb" && kind !== "vtt") {
		return Response.json(
			{ error: "Invalid kind parameter. Expected 'video', 'thumb', or 'vtt'." },
			{ status: 400 },
		);
	}

	if (kind === "vtt") {
		const vtt = getIntensiveLessonTranscriptFile(courseId, lessonId, "vtt");
		if (!vtt) {
			return Response.json({ error: "Subtitles not found." }, { status: 404 });
		}
		const byteLen = Buffer.byteLength(vtt.content, "utf8");
		const headers = new Headers({
			"Content-Type": vtt.contentType,
			"Content-Length": String(byteLen),
			"Cache-Control": "private, no-store",
		});
		return new Response(headOnly ? null : vtt.content, { status: 200, headers });
	}

	if (kind === "thumb") {
		const thumb = resolveIntensiveLessonMediaPath(courseId, lessonId, "thumb");
		if (!thumb) {
			return Response.json({ error: "Thumbnail not found." }, { status: 404 });
		}
		const headers = new Headers({
			"Content-Type": thumb.contentType,
			"Content-Length": String(thumb.size),
			"Cache-Control": "private, max-age=300",
		});
		if (headOnly || thumb.size === 0) {
			return new Response(null, { status: 200, headers });
		}
		const stream = createSafeFileStream(thumb.absPath, 0, thumb.size - 1, request.signal);
		return new Response(stream, { status: 200, headers });
	}

	// kind === "video"
	const media = resolveIntensiveLessonMediaPath(courseId, lessonId, "video");
	if (!media) {
		return Response.json({ error: "Video not found." }, { status: 404 });
	}

	const totalSize = media.size;
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
			"Content-Type": media.contentType,
			"Content-Range": `bytes ${start}-${end}/${totalSize}`,
			"Content-Length": String(chunkSize),
			"Accept-Ranges": "bytes",
			"Cache-Control": "private, no-store",
		});

		if (headOnly) {
			return new Response(null, { status: 206, headers });
		}

		const stream = createSafeFileStream(media.absPath, start, end, request.signal);
		return new Response(stream, { status: 206, headers });
	}

	const headers = new Headers({
		"Content-Type": media.contentType,
		"Content-Length": String(totalSize),
		"Accept-Ranges": "bytes",
		"Cache-Control": "private, no-store",
	});

	if (headOnly || totalSize === 0) {
		return new Response(null, { status: 200, headers });
	}

	const stream = createSafeFileStream(media.absPath, 0, totalSize - 1, request.signal);
	return new Response(stream, { status: 200, headers });
}

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ courseId: string; lessonId: string }> },
) {
	return handleMediaRequest(request, params, false);
}

export async function HEAD(
	request: Request,
	{ params }: { params: Promise<{ courseId: string; lessonId: string }> },
) {
	return handleMediaRequest(request, params, true);
}
