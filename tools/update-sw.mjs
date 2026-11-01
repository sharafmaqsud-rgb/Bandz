// Regenerates the file list and version inside sw.js. Run this after changing any app file.
// The version is a hash of the files, so any change makes a new version. A test fails if
// this has been forgotten.
//
//   node tools/update-sw.mjs
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function walk(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
    (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

export function appFiles() {
  return ['index.html', 'manifest.webmanifest', ...walk('src'), ...walk('icons'), ...walk('vendor')]
    .filter((f) => !f.endsWith('.DS_Store'))
    .map((f) => relative('.', f).split('\\').join('/'))
    .sort();
}

export function buildBlock() {
  const files = appFiles();
  const hash = createHash('sha256');
  for (const f of files) hash.update(f).update(readFileSync(join(root, f)));
  return `// BEGIN GENERATED\nconst VERSION = '${hash.digest('hex').slice(0, 16)}';\nconst FILES = ${JSON.stringify(['./', ...files], null, 2)};\n// END GENERATED`;
}

const BLOCK = /\/\/ BEGIN GENERATED[\s\S]*\/\/ END GENERATED/;

export function currentBlock() {
  return BLOCK.exec(readFileSync(join(root, 'sw.js'), 'utf8'))?.[0];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = join(root, 'sw.js');
  writeFileSync(path, readFileSync(path, 'utf8').replace(BLOCK, buildBlock()));
  console.log('sw.js updated');
}
