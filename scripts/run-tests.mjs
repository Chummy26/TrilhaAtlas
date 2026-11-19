/** Portable test runner (Windows/macOS/Linux): sets NODE_ENV=test and runs the
 * Node test runner through tsx over the given globs (default: every test file).
 * Usage: node scripts/run-tests.mjs [glob ...] */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli", { paths: [root] });
const patterns = process.argv.slice(2);
const globs = patterns.length ? patterns : ["tests/*.test.ts", "tests/*.test.tsx"];
const result = spawnSync(process.execPath, [tsxCli, "--test", ...globs], {
	cwd: root,
	stdio: "inherit",
	env: { ...process.env, NODE_ENV: "test" },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
