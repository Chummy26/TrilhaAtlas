"use client";

import { memo, useEffect, useRef, type PointerEvent } from "react";

export interface PdfLayout {
	width: number;
	height: number;
	lines: { text: string; transform: string; width: number }[];
}

type CropRect = { x: number; y: number; w: number; h: number };

function snapshot(image: CanvasImageSource, x: number, y: number, width: number, height: number) {
	const scale = Math.min(1, 1600 / Math.max(width, height));
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(width * scale));
	canvas.height = Math.max(1, Math.round(height * scale));
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Não foi possível preparar o print.");
	ctx.fillStyle = "white";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height);
	return canvas.toDataURL("image/jpeg", .94);
}

export async function captureFile(file: File) {
	if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 16 * 1024 * 1024)
		throw new Error("Escolha um print PNG, JPEG ou WebP de até 16 MiB.");
	const image = await createImageBitmap(file);
	try { return snapshot(image, 0, 0, image.width, image.height); }
	finally { image.close(); }
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const PdfSheet = memo(function PdfSheet({ src, label, layout, cropping, onCapture, onError }: {
	src: string; label: string; layout?: PdfLayout; cropping: boolean;
	onCapture: (src: string) => void; onError: () => void;
}) {
	const image = useRef<HTMLImageElement>(null);
	const cropBoxRef = useRef<HTMLDivElement>(null);
	const start = useRef<{ x: number; y: number; id: number; rect: DOMRect } | null>(null);
	const pendingBox = useRef<CropRect | null>(null);
	const rafId = useRef(0);

	function applyCropBox(area: CropRect | null) {
		const el = cropBoxRef.current;
		if (!el) return;
		if (!area) {
			el.style.display = "none";
			return;
		}
		el.style.display = "block";
		el.style.left = `${area.x * 100}%`;
		el.style.top = `${area.y * 100}%`;
		el.style.width = `${area.w * 100}%`;
		el.style.height = `${area.h * 100}%`;
	}

	function cancelCropDrag() {
		if (rafId.current) {
			cancelAnimationFrame(rafId.current);
			rafId.current = 0;
		}
		start.current = null;
		pendingBox.current = null;
		applyCropBox(null);
	}

	useEffect(() => {
		if (!cropping) cancelCropDrag();
		return () => {
			if (rafId.current) {
				cancelAnimationFrame(rafId.current);
				rafId.current = 0;
			}
		};
	}, [cropping]);

	function pointFromRect(e: PointerEvent<HTMLDivElement>, rect: DOMRect) {
		return {
			x: clamp01((e.clientX - rect.left) / rect.width),
			y: clamp01((e.clientY - rect.top) / rect.height),
		};
	}

	function bounds(e: PointerEvent<HTMLDivElement>): CropRect | null {
		if (!start.current || start.current.id !== e.pointerId) return null;
		const p = pointFromRect(e, start.current.rect);
		return {
			x: Math.min(p.x, start.current.x),
			y: Math.min(p.y, start.current.y),
			w: Math.abs(p.x - start.current.x),
			h: Math.abs(p.y - start.current.y),
		};
	}

	return <div className={"pdf-sheet" + (cropping ? " pdf-cropping" : "")} onPointerDown={e => {
		if (!cropping || !image.current?.naturalWidth || e.button !== 0 || !e.isPrimary) return;
		e.currentTarget.setPointerCapture(e.pointerId);
		const rect = e.currentTarget.getBoundingClientRect();
		start.current = { ...pointFromRect(e, rect), id: e.pointerId, rect };
		pendingBox.current = null;
		applyCropBox(null);
	}} onPointerMove={e => {
		if (!cropping || !start.current) return;
		pendingBox.current = bounds(e);
		if (!rafId.current) {
			rafId.current = requestAnimationFrame(() => {
				rafId.current = 0;
				applyCropBox(pendingBox.current);
			});
		}
	}}
	onPointerCancel={cancelCropDrag}
	onPointerUp={e => {
		const area = bounds(e);
		cancelCropDrag();
		const img = image.current;
		if (!cropping || !area || !img || area.w * img.naturalWidth < 6 || area.h * img.naturalHeight < 6) return;
		onCapture(snapshot(img, area.x * img.naturalWidth, area.y * img.naturalHeight, area.w * img.naturalWidth, area.h * img.naturalHeight));
	}}>
		{/* The server rasterizes the original PDF page with its intrinsic aspect ratio. */}
		{/* eslint-disable-next-line @next/next/no-img-element */}
		<img ref={image} src={src} alt={label} draggable={false} onError={onError} />
		{layout && !cropping && <svg className="pdf-text-layer" viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label="Texto selecionável da página">
			{layout.lines.map((line, i) => <text key={i} transform={line.transform} textLength={line.width} lengthAdjust="spacingAndGlyphs" fontSize="1">{line.text}</text>)}
		</svg>}
		{cropping && <div ref={cropBoxRef} className="pdf-crop-box" style={{ display: "none" }} />}
	</div>;
});
