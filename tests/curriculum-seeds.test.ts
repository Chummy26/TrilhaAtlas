/**
 * The real seed data (content/curricula/<domain>/*.json, read-only) through
 * the curriculum core: seed files → initial patch → certified version-1
 * snapshot in strict mode (docs/research/00-SINTESE.md §2.4(e) "Seed (fase
 * 1)", §2.7, §2.13). Also checks that the ledger replays to the same hash and
 * that a learner can walk the whole domain fringe by fringe (LS-rank (d) on
 * real data). Skipped for domains whose directory is not present.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
	allLeaves,
	applySeedFiles,
	checkSnapshotCertificate,
	curriculumIndex,
	outerFringe,
	replayLedger,
	validate,
	validateReport,
} from "../src/core/curriculum/index.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "content", "curricula");

function loadDomain(domain: string): unknown[] {
	const dir = path.join(ROOT, domain);
	return fs
		.readdirSync(dir)
		.filter((f) => f.endsWith(".json"))
		.sort()
		.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as unknown);
}

for (const domain of ["electronics", "english"]) {
	const present = fs.existsSync(path.join(ROOT, domain));
	describe(`seed real: ${domain}`, { skip: present ? false : `content/curricula/${domain} ausente` }, () => {
		it("loads as a certified version-1 snapshot without errors (strict mode)", (t) => {
			const res = applySeedFiles(loadDomain(domain), { createdAt: "2026-01-01T00:00:00.000Z", edgeMode: "strict" });
			if (!res.ok) assert.fail(`seed de ${domain} inválido: ${JSON.stringify(res.errors.slice(0, 5))}`);
			const snap = res.snapshot;
			assert.equal(snap.version, 1);
			assert.deepEqual(validate(snap, { edgeMode: "strict" }), []);
			assert.deepEqual(checkSnapshotCertificate(snap), { ok: true });
			const report = validateReport(snap);
			t.diagnostic(`${domain}: ${report.stats.live} itens, ${report.stats.leaves} folhas, ${report.warnings.length} aviso(s), validate ${report.stats.ms.toFixed(1)} ms`);

			const replay = replayLedger([JSON.parse(JSON.stringify(res.envelope)) as unknown]);
			assert.ok(replay.ok);
			assert.equal(replay.snapshot.certificate.hash, snap.certificate.hash);
		});

		it("a learner reaches every leaf by taking the outer fringe round after round", () => {
			const res = applySeedFiles(loadDomain(domain), { createdAt: "2026-01-01T00:00:00.000Z" });
			assert.ok(res.ok);
			const idx = curriculumIndex(res.snapshot);
			const leaves = allLeaves(idx.sys);
			const attained = new Set<string>();
			for (let round = 0; attained.size < leaves.length; round++) {
				const fringe = outerFringe(idx, attained);
				assert.ok(fringe.length > 0, `fronteira vazia na rodada ${round} com ${attained.size}/${leaves.length} folhas`);
				for (const id of fringe) attained.add(id);
			}
			assert.deepEqual(outerFringe(idx, attained), []);
		});
	});
}
