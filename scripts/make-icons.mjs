// Render every TrilhaAtlas icon from build/icon-flat.svg.
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const svg = readFileSync(path.join(root, "build", "icon-flat.svg"), "utf8");

const renderImage = (size) => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render();
const render = (size) => renderImage(size).asPng();

// Encode <=128px frames as 32-bit BGRA DIB + AND mask for maximum Windows Shell/Explorer/NSIS compatibility;
// keep 256px as PNG per Microsoft ICO guidelines.
function encodeIcoEntry(size) {
	const img = renderImage(size);
	if (size >= 256) return img.asPng();
	const pixels = img.pixels;
	const xorSize = size * size * 4;
	const andStride = Math.ceil(size / 32) * 4;
	const andSize = andStride * size;
	const dib = Buffer.alloc(40 + xorSize + andSize);
	dib.writeUInt32LE(40, 0); // biSize
	dib.writeInt32LE(size, 4); // biWidth
	dib.writeInt32LE(size * 2, 8); // biHeight (XOR + AND)
	dib.writeUInt16LE(1, 12); // biPlanes
	dib.writeUInt16LE(32, 14); // biBitCount
	dib.writeUInt32LE(0, 16); // biCompression (BI_RGB)
	dib.writeUInt32LE(xorSize + andSize, 20); // biSizeImage
	for (let y = 0; y < size; y++) {
		const dstRow = size - 1 - y;
		const xorRowOffset = 40 + dstRow * size * 4;
		const andRowOffset = 40 + xorSize + dstRow * andStride;
		for (let x = 0; x < size; x++) {
			const src = (y * size + x) * 4;
			const dst = xorRowOffset + x * 4;
			dib[dst] = pixels[src + 2]; // B
			dib[dst + 1] = pixels[src + 1]; // G
			dib[dst + 2] = pixels[src]; // R
			dib[dst + 3] = pixels[src + 3]; // A
			if (pixels[src + 3] === 0) {
				dib[andRowOffset + (x >> 3)] |= 0x80 >> (x & 7);
			}
		}
	}
	return dib;
}

// ---- build/icon.ico: ICONDIR + BMP (16..128) + PNG (256) entries --------
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const entries = ICO_SIZES.map(encodeIcoEntry);
// Header (6) + one 16-byte directory entry per image, then the entry payloads.
const header = Buffer.alloc(6 + ICO_SIZES.length * 16);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(ICO_SIZES.length, 4);
let offset = header.length;
ICO_SIZES.forEach((size, i) => {
	const e = 6 + i * 16;
	header.writeUInt8(size === 256 ? 0 : size, e); // 0 encodes 256
	header.writeUInt8(size === 256 ? 0 : size, e + 1);
	header.writeUInt8(0, e + 2); // colors
	header.writeUInt8(0, e + 3); // reserved
	header.writeUInt16LE(1, e + 4); // planes
	header.writeUInt16LE(32, e + 6); // bpp
	header.writeUInt32LE(entries[i].length, e + 8);
	header.writeUInt32LE(offset, e + 12);
	offset += entries[i].length;
});
const ico = Buffer.concat([header, ...entries]);
writeFileSync(path.join(root, "build", "icon.ico"), ico);
console.log(`build/icon.ico  ${ICO_SIZES.join("/")} — ${(ico.length / 1024).toFixed(1)} KB`);

// ---- build/icon.png: the Linux icon -------------------------------------
const png512 = render(512);
writeFileSync(path.join(root, "build", "icon.png"), png512);
console.log(`build/icon.png  512×512 — ${(png512.length / 1024).toFixed(1)} KB`);

const macTypes = [["icp4", 16], ["icp5", 32], ["icp6", 64], ["ic07", 128], ["ic08", 256], ["ic09", 512], ["ic10", 1024], ["ic11", 32], ["ic12", 64], ["ic13", 256], ["ic14", 512]];
const macChunks = macTypes.map(([type, size]) => {
	const png = render(size);
	const chunkHeader = Buffer.alloc(8);
	chunkHeader.write(type, 0);
	chunkHeader.writeUInt32BE(chunkHeader.length + png.length, 4);
	return Buffer.concat([chunkHeader, png]);
});
const macHeader = Buffer.alloc(8);
macHeader.write("icns");
macHeader.writeUInt32BE(macHeader.length + macChunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
writeFileSync(path.join(root, "build", "icon.icns"), Buffer.concat([macHeader, ...macChunks]));
writeFileSync(path.join(root, "build", "icon.icon", "Assets", "trilhaatlas.svg"), svg);
writeFileSync(path.join(root, "public", "trilhaatlas.svg"), svg);
writeFileSync(path.join(root, "app", "favicon.ico"), ico);
