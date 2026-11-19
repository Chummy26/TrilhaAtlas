/**
 * Certificates and their independent checkers — the small "trusted core"
 * (docs/research/00-SINTESE.md §2.13 "certificados em runtime: ordem + checker
 * O(V+E) a cada apply"; r10 §2.1 certifying algorithms, §6.2 checadores,
 * §6.3 passo [5]).
 *
 *   computeCertificate — {order, hash}: Kahn order of the effective system
 *                        (./rank.ts) + stable hash of the canonical snapshot.
 *   checkTopoCertificate / checkRankCertificate / checkCycleWitness — tiny
 *                        checkers that share NO code with the producers
 *                        (Kahn, Pearce–Kelly): an order is accepted only if it
 *                        is a permutation of the live items and every
 *                        effective clause member comes strictly earlier (R2),
 *                        no clause mentions an unknown id (R3), and every item
 *                        has at least one alternative (R1).
 *   checkSnapshotCertificate — the full check of a stored snapshot (order +
 *                        hash), O(V+E) plus hashing.
 *
 * Hash: FNV-1a 64 (hex, 16 chars) in a two-level (Merkle-style) layout so a
 * patch only re-serialises the items it touched:
 *     itemHash(item)  = fnv1a64(canonicalJson(item))            (cached per object)
 *     snapshotHash    = fnv1a64(canonicalJson({schemaVersion, domainId, version,
 *                        items: [[id, itemHash] sorted by id], edges sorted}))
 * `certificate` and `updatedAt` are excluded (the first is derived, the second
 * is wall-clock), so replaying the ledger yields the same hash. Canonical JSON
 * = sorted object keys, `undefined` members dropped; UTF-8 bytes are hashed
 * without allocating (manual encoding of UTF-16 code units).
 *
 * Pure and browser-safe (no node:crypto).
 */

import { buildEffectiveSystem, type EffectiveSystem } from "./effective.ts";
import { effectiveKahn } from "./rank.ts";
import { CurriculumError, type CurriculumCertificate, type CurriculumEdge, type CurriculumItem, type CurriculumSnapshot } from "./types.ts";

export type Check = { ok: true } | { ok: false; reason: string };

// ─── Canonical JSON + FNV-1a 64 ─────────────────────────────────────────────

/** Deterministic JSON: object keys sorted (code-unit order), undefined members dropped. */
export function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") {
		const s = JSON.stringify(value);
		return s === undefined ? "null" : s;
	}
	if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj)
		.filter((k) => obj[k] !== undefined)
		.sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/** FNV-1a 64 over the UTF-8 bytes of `text`, as 16 lowercase hex chars. */
export function fnv1a64Hex(text: string): string {
	// 64-bit state in four 16-bit limbs (h0 least significant). Offset basis 0xcbf29ce484222325.
	let h0 = 0x2325;
	let h1 = 0x8422;
	let h2 = 0x9ce4;
	let h3 = 0xcbf2;
	const step = (byte: number) => {
		h0 ^= byte;
		// × prime 0x100000001b3 = 2^40 + 0x1b3: low limbs × 0x1b3, plus (h << 40) = limb shift 2 × 0x100.
		const t0 = h0 * 0x1b3;
		let t1 = h1 * 0x1b3;
		let t2 = h2 * 0x1b3 + h0 * 0x100;
		let t3 = h3 * 0x1b3 + h1 * 0x100;
		t1 += t0 >>> 16;
		h0 = t0 & 0xffff;
		t2 += t1 >>> 16;
		h1 = t1 & 0xffff;
		t3 += t2 >>> 16;
		h2 = t2 & 0xffff;
		h3 = t3 & 0xffff;
	};
	for (let i = 0; i < text.length; i++) {
		let c = text.charCodeAt(i);
		if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
			const d = text.charCodeAt(i + 1);
			if (d >= 0xdc00 && d <= 0xdfff) {
				c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
				i++;
			}
		}
		if (c < 0x80) step(c);
		else if (c < 0x800) {
			step(0xc0 | (c >> 6));
			step(0x80 | (c & 0x3f));
		} else if (c < 0x10000) {
			step(0xe0 | (c >> 12));
			step(0x80 | ((c >> 6) & 0x3f));
			step(0x80 | (c & 0x3f));
		} else {
			step(0xf0 | (c >> 18));
			step(0x80 | ((c >> 12) & 0x3f));
			step(0x80 | ((c >> 6) & 0x3f));
			step(0x80 | (c & 0x3f));
		}
	}
	const hex = (x: number) => x.toString(16).padStart(4, "0");
	return hex(h3) + hex(h2) + hex(h1) + hex(h0);
}

const itemHashCache = new WeakMap<CurriculumItem, string>();

/** Hash of one item's canonical JSON (cached per object: items are immutable once in a snapshot). */
export function itemHash(item: CurriculumItem): string {
	const cached = itemHashCache.get(item);
	if (cached !== undefined) return cached;
	const h = fnv1a64Hex(canonicalJson(item));
	itemHashCache.set(item, h);
	return h;
}

function compareStrings(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function edgeKey(e: CurriculumEdge): string {
	return `${e.from}\u0001${e.to}\u0001${e.kind}\u0001${e.w ?? ""}`;
}

/**
 * Stable hash of the canonical snapshot (excludes `certificate` and `updatedAt`).
 * `cache: false` re-serialises every item instead of trusting the per-object
 * cache — the checker uses it, so an item mutated in place after it was hashed
 * cannot slip through with its stale hash.
 */
export function hashSnapshot(
	snapshot: Pick<CurriculumSnapshot, "schemaVersion" | "domainId" | "version" | "items" | "edges">,
	opts: { cache?: boolean } = {},
): string {
	const ids = Object.keys(snapshot.items).sort(compareStrings);
	const hashItem = opts.cache === false ? (it: CurriculumItem) => fnv1a64Hex(canonicalJson(it)) : itemHash;
	const manifest = {
		schemaVersion: snapshot.schemaVersion,
		domainId: snapshot.domainId,
		version: snapshot.version,
		items: ids.map((id) => [id, hashItem(snapshot.items[id]!)]),
		edges: [...snapshot.edges].sort((a, b) => compareStrings(edgeKey(a), edgeKey(b))),
	};
	return fnv1a64Hex(canonicalJson(manifest));
}

// ─── Producer ───────────────────────────────────────────────────────────────

/** Certificate of a snapshot: Kahn order of its effective system + canonical hash. Throws on a cycle. */
export function computeCertificate(
	snapshot: Pick<CurriculumSnapshot, "schemaVersion" | "domainId" | "version" | "items" | "edges">,
	sys: EffectiveSystem = buildEffectiveSystem(snapshot.items),
	order?: readonly number[],
): CurriculumCertificate {
	let dense = order;
	if (!dense) {
		const res = effectiveKahn(sys);
		if (!res.ok) {
			const witness = res.cycle.map((x) => sys.ids[x]!);
			throw new CurriculumError([{ code: "cycle", message: `sem certificado: ciclo ${witness.join(" → ")}`, witness }]);
		}
		dense = res.order;
	}
	return { order: dense.map((x) => sys.ids[x]!), hash: hashSnapshot(snapshot) };
}

// ─── Checkers (independent of the producers) ────────────────────────────────

/** O(V+E): `order` is a permutation of `nodes` and every edge [u, v] (u before v) points forward. */
export function checkTopoCertificate(
	nodes: readonly string[],
	edges: readonly (readonly [string, string])[],
	order: readonly string[],
): Check {
	if (order.length !== nodes.length) return { ok: false, reason: `a ordem tem ${order.length} entradas; o grafo tem ${nodes.length} nós` };
	const pos = new Map<string, number>();
	order.forEach((v, i) => pos.set(v, i));
	if (pos.size !== order.length) return { ok: false, reason: "a ordem repete um nó" };
	for (const v of nodes) if (!pos.has(v)) return { ok: false, reason: `o nó ${v} não está na ordem` };
	for (const [u, v] of edges) {
		const pu = pos.get(u);
		const pv = pos.get(v);
		if (pu === undefined || pv === undefined) return { ok: false, reason: `a aresta ${u} → ${v} tem extremidade desconhecida` };
		if (!(pu < pv)) return { ok: false, reason: `a aresta ${u} → ${v} aponta para trás na ordem` };
	}
	return { ok: true };
}

/**
 * Rank certificate of a clause system (R1–R3, r10 §3.1). `clauses` maps every
 * item to its alternatives in the r10 convention: an entry item has one EMPTY
 * alternative (`[[]]`), and an item with NO alternative (`[]`) has no route.
 */
export function checkRankCertificate(clauses: ReadonlyMap<string, readonly (readonly string[])[]>, order: readonly string[]): Check {
	if (order.length !== clauses.size) return { ok: false, reason: `a ordem tem ${order.length} entradas; o sistema tem ${clauses.size} itens` };
	const pos = new Map<string, number>();
	order.forEach((v, i) => pos.set(v, i));
	if (pos.size !== order.length) return { ok: false, reason: "a ordem repete um item" };
	for (const [q, cs] of clauses) {
		const pq = pos.get(q);
		if (pq === undefined) return { ok: false, reason: `o item ${q} não está na ordem` };
		if (cs.length === 0) return { ok: false, reason: `o item ${q} não tem nenhuma alternativa (R1: sem rota)` };
		for (const c of cs)
			for (const p of c) {
				const pp = pos.get(p);
				if (pp === undefined) return { ok: false, reason: `uma cláusula de ${q} cita ${p}, desconhecido (R3)` };
				if (!(pp < pq)) return { ok: false, reason: `uma cláusula de ${q} usa ${p}, que não vem antes (R2)` };
			}
	}
	return { ok: true };
}

/** O(|cycle|): a closed walk [x, …, x] whose consecutive pairs are all edges. */
export function checkCycleWitness(hasEdge: (u: string, v: string) => boolean, cycle: readonly string[]): Check {
	if (cycle.length < 2 || cycle[0] !== cycle[cycle.length - 1]) return { ok: false, reason: "não é um passeio fechado" };
	for (let i = 0; i + 1 < cycle.length; i++)
		if (!hasEdge(cycle[i]!, cycle[i + 1]!)) return { ok: false, reason: `falta a aresta ${cycle[i]} → ${cycle[i + 1]}` };
	return { ok: true };
}

/** Effective clauses of every live item in the r10 convention (entry = `[[]]`), input of checkRankCertificate. */
export function effectiveClauseMap(sys: EffectiveSystem): Map<string, string[][]> {
	const m = new Map<string, string[][]>();
	for (let x = 0; x < sys.ids.length; x++) m.set(sys.ids[x]!, sys.clauses[x]!.map((a) => a.map((y) => sys.ids[y]!)));
	return m;
}

/** Full check of a stored snapshot: rank certificate over the effective system + hash match (fresh, uncached hashing). */
export function checkSnapshotCertificate(snapshot: CurriculumSnapshot): Check {
	const sys = buildEffectiveSystem(snapshot.items);
	const rank = checkRankCertificate(effectiveClauseMap(sys), snapshot.certificate.order);
	if (!rank.ok) return rank;
	const hash = hashSnapshot(snapshot, { cache: false });
	if (hash !== snapshot.certificate.hash) return { ok: false, reason: `hash divergente: certificado ${snapshot.certificate.hash}, recalculado ${hash}` };
	return { ok: true };
}
