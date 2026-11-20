import fs from "node:fs";

/** Keep only derived pages. A removed or replaced original cannot hit an old
 * entry, and concurrent requests for the same revision share their work. */
export function createBookPageCache<T>(maxBytes: number, bytesOf: (value: T) => number) {
	const pages = new Map<string, { value: T; bytes: number }>();
	const pending = new Map<string, Promise<T>>();
	let retained = 0;
	return async (file: string, unit: number, load: () => Promise<T>): Promise<T> => {
		const stat = await fs.promises.stat(file, { bigint: true });
		const key = [file, unit, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join("|");
		const stored = pages.get(key);
		if (stored) {
			pages.delete(key);
			pages.set(key, stored);
			return stored.value;
		}
		const existing = pending.get(key);
		if (existing) return existing;
		const request = load().then(value => {
			const bytes = bytesOf(value);
			if (bytes > maxBytes) return value;
			for (const [oldKey, old] of pages) {
				if (pages.size < 32 && retained + bytes <= maxBytes) break;
				retained -= old.bytes;
				pages.delete(oldKey);
			}
			pages.set(key, { value, bytes });
			retained += bytes;
			return value;
		}).finally(() => pending.delete(key));
		pending.set(key, request);
		return request;
	};
}
