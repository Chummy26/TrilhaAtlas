import { build } from 'esbuild';
import { mkdir, copyFile, lstat, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'dist');
const require = createRequire(path.join(root, 'package.json'));
try {
  if ((await lstat(out)).isSymbolicLink()) throw new Error('Refusing to build into a linked directory.');
  try { await lstat(path.join(out, 'data')); throw new Error('Refusing to build over plugin data. Move it to a safe location first.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// Every npm package esbuild bundles ships its license text in THIRD-PARTY-LICENSES.txt.
async function thirdPartyLicenses(metafiles) {
  const packages = new Map();
  for (const metafile of metafiles) for (const input of Object.keys(metafile.inputs)) {
    const match = input.replace(/\\/g, '/').match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
    if (match) packages.set(match[1], path.resolve(root, match[1]));
  }
  const sections = [];
  for (const directory of [...packages.values()].sort()) {
    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    const files = await readdir(directory);
    const license = files.find(name => /^(licen[cs]e|copying)([.-]|$)/i.test(name));
    let text = license ? await readFile(path.join(directory, license), 'utf8') : '';
    if (!license) {
      // Some small packages only state their license in the README's License section.
      const readme = files.find(name => /^readme/i.test(name));
      const section = readme ? (await readFile(path.join(directory, readme), 'utf8')).match(/^#+\s*licen[cs]e\b[\s\S]*/im) : null;
      if (!section) throw new Error(`No license text for bundled package ${manifest.name}.`);
      text = section[0];
    }
    sections.push(`${manifest.name}@${manifest.version} (${manifest.license ?? 'see text'})\n\n${text.trim()}\n`);
  }
  return sections.join(`\n${'-'.repeat(72)}\n\n`);
}

const [frontend, backend] = await Promise.all([
  build({ entryPoints: [path.join(root, 'src/main.js')], outfile: path.join(out, 'main.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', metafile: true }),
  build({ entryPoints: [path.join(root, 'src/backend.cjs')], outfile: path.join(out, 'backend.cjs'), bundle: true, format: 'cjs', platform: 'node', target: 'node22', metafile: true }),
  ...['manifest.json', 'LICENSE', 'FSRS-LICENSE.txt', 'README.md'].map(file => copyFile(path.join(root, file), path.join(out, file))),
  copyFile(path.join(root, 'src/styles.css'), path.join(out, 'styles.css')),
  // .apkg export loads sql.js WASM next to backend.cjs; it must match the bundled sql.js glue.
  copyFile(require.resolve('sql.js/dist/sql-wasm.wasm'), path.join(out, 'sql-wasm.wasm')),
]);
await writeFile(path.join(out, 'THIRD-PARTY-LICENSES.txt'), await thirdPartyLicenses([frontend.metafile, backend.metafile]));
console.log(`Built ${out}`);
