import { NextResponse } from "next/server";
import { StudyBrowserError, readStudyBrowserFrame, readStudyBrowserReader } from "@/src/server";

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const targetUrl = searchParams.get("url")?.trim() ?? "";
	const mode = searchParams.get("mode") === "reader" ? "reader" : "frame";
	if (!targetUrl) {
		return NextResponse.json({ error: "Informe a URL a ser carregada." }, { status: 400 });
	}
	try {
		if (mode === "reader") {
			const payload = await readStudyBrowserReader(targetUrl, request.signal);
			return NextResponse.json(payload, {
				headers: {
					"Cache-Control": "private, max-age=300",
				},
			});
		}

		const frame = await readStudyBrowserFrame(targetUrl, request.signal);
		if (frame.kind === "pdf") {
			return new Response(frame.bytes as Uint8Array<ArrayBuffer>, {
				status: 200,
				headers: {
					"Content-Type": "application/pdf",
					"Content-Disposition": "inline",
					"Cache-Control": "private, max-age=600",
				},
			});
		}
		return new Response(frame.html, {
			status: 200,
			headers: {
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "private, max-age=300",
			},
		});
	} catch (error) {
		const status = error instanceof StudyBrowserError ? error.status : 502;
		const message =
			error instanceof StudyBrowserError
				? error.message
				: "Não foi possível carregar o endereço solicitado no navegador embutido.";
		if (mode === "reader") {
			return NextResponse.json({ error: message }, { status });
		}
		const errorHtml = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
			body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 2rem 1.5rem; background: #18191b; color: #f4f1ea; }
			.card { border: 1.5px solid rgba(255,255,255,0.16); border-radius: 12px; padding: 1.25rem; background: #212226; max-width: 34rem; }
			h1 { font-size: 1.05rem; margin: 0 0 0.5rem; }
			p { font-size: 0.9rem; line-height: 1.5; color: #b7b3a8; margin: 0; }
		</style></head><body><div class="card"><h1>Não foi possível exibir esta página no modo Site</h1><p>${message.replace(/[<>&]/g, "")}</p></div></body></html>`;
		return new Response(errorHtml, {
			status,
			headers: { "Content-Type": "text/html; charset=utf-8" },
		});
	}
}
