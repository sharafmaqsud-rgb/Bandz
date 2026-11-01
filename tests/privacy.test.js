// Guards the "never commit personal data" rule. Words to look for come from the
// git-ignored local/banned-terms.txt, one per line, so this file does not reveal them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
// Everything committed, or that a `git add .` would pick up.
const publishable = git('ls-files', '--cached', '--others', '--exclude-standard').split('\n').filter(Boolean);
const termsFile = join(root, 'local/banned-terms.txt');

test('private folders are ignored by git', () => {
  for (const p of ['local/seed.json', 'reference/finance-tool.zip', '.tools/node', 'backup.finbackup']) {
    assert.equal(git('check-ignore', p).trim(), p);
  }
  for (const f of publishable) assert.ok(!/^(local|reference|\.tools)\//.test(f), f);
});

test('no bank data files are publishable, other than invented test fixtures', () => {
  for (const f of publishable) {
    if (f.endsWith('.csv')) assert.ok(f.startsWith('tests/fixtures/'), f);
  }
});

test('no personal terms appear in publishable files', { skip: !existsSync(termsFile) && 'no local/banned-terms.txt on this machine' }, () => {
  const terms = readFileSync(termsFile, 'utf8').split('\n').map((t) => t.trim().toLowerCase()).filter(Boolean);
  assert.ok(terms.length > 0);
  for (const f of publishable) {
    const text = readFileSync(join(root, f), 'utf8').toLowerCase();
    for (const term of terms) assert.ok(!text.includes(term), `A personal term appears in ${f}`);
  }
});
