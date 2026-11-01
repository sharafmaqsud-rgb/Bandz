// Encryption, sync and the offline app. All data here is invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BACKUP_FORMAT, ITERATIONS, LOCK_FORMAT, createKey, seal, unseal } from '../src/core/crypto.js';
import { mergeStates, syncFrom, validateState } from '../src/core/merge.js';
import { classify } from '../src/core/analysis.js';
import { addAccount, addTransactions, applySeed, createState, migrate, removeAccount, setBalance, setRule } from '../src/core/model.js';
import { applyRules, setManualCategory } from '../src/core/categorise.js';
import { appFiles, buildBlock, currentBlock } from '../tools/update-sw.mjs';

const PASS = 'correct horse battery staple';
const secret = { note: 'EXAMPLE SECRET TEXT', pence: 12345 };

test('sealed data opens with the passphrase and hides its contents', async () => {
  const env = await seal(await createKey(PASS), BACKUP_FORMAT, secret);
  assert.equal(env.iterations, ITERATIONS);
  assert.ok(!JSON.stringify(env).includes('EXAMPLE SECRET'));
  assert.deepEqual((await unseal(JSON.parse(JSON.stringify(env)), PASS, BACKUP_FORMAT)).data, secret);
});

test('a wrong passphrase fails', async () => {
  const env = await seal(await createKey(PASS), BACKUP_FORMAT, secret);
  await assert.rejects(unseal(env, 'wrong passphrase here', BACKUP_FORMAT), /Wrong passphrase/);
});

test('any change to the file is detected', async () => {
  const env = await seal(await createKey(PASS), BACKUP_FORMAT, secret);
  const flipped = { ...env, ciphertext: (env.ciphertext[0] === 'A' ? 'B' : 'A') + env.ciphertext.slice(1) };
  await assert.rejects(unseal(flipped, PASS, BACKUP_FORMAT), /Wrong passphrase|damaged/);
  await assert.rejects(unseal({ ...env, iterations: env.iterations + 1 }, PASS, BACKUP_FORMAT), /Wrong passphrase|damaged/);
});

test('a lock record cannot be passed off as a backup, or the reverse', async () => {
  const handle = await createKey(PASS);
  const lock = await seal(handle, LOCK_FORMAT, secret);
  await assert.rejects(unseal(lock, PASS, BACKUP_FORMAT), /not a backup/);
  await assert.rejects(unseal({ ...lock, format: BACKUP_FORMAT }, PASS, BACKUP_FORMAT), /Wrong passphrase|damaged/);
});

test('unsafe encryption settings are refused before any work is done', async () => {
  const env = await seal(await createKey(PASS), BACKUP_FORMAT, secret);
  for (const iterations of [1, 1e12, 'x']) {
    await assert.rejects(unseal({ ...env, iterations }, PASS, BACKUP_FORMAT), /unsafe/);
  }
});

test('every seal uses a new random value, and short passphrases are refused', async () => {
  const h = await createKey(PASS);
  assert.notEqual((await seal(h, BACKUP_FORMAT, secret)).iv, (await seal(h, BACKUP_FORMAT, secret)).iv);
  await assert.rejects(createKey('too short'), /at least 12/);
});

test('the key cannot be read back out', async () => {
  const { key } = await createKey(PASS);
  assert.equal(key.extractable, false);
});

// ---------- Sync ----------

const tx = (over = {}) => ({ account: 'lloyds-club', date: '2026-10-01', description: 'WIDGETCO', amountPence: -1000, currency: 'GBP', ...over });
const clone = (s) => JSON.parse(JSON.stringify(s));
const first = (s) => Object.values(s.transactions)[0];

test('work from both devices survives a sync, in either direction', () => {
  const laptop = createState(1);
  addTransactions(laptop, [tx()], 100);
  const phone = createState(1);
  setBalance(phone, '2026-11-01', 'revolut', '50', 200);
  for (const [a, b] of [[laptop, phone], [phone, laptop]]) {
    const { state } = mergeStates(a, clone(b));
    assert.equal(Object.keys(state.transactions).length, 1);
    assert.equal(state.balances['2026-11-01|revolut'].balancePence, 5000);
  }
});

test('the newest edit wins, whichever device it came from', () => {
  const a = createState(1), b = createState(1);
  setBalance(a, '2026-11-01', 'revolut', '50', 100);
  setBalance(b, '2026-11-01', 'revolut', '70', 200);
  assert.equal(mergeStates(a, clone(b)).state.balances['2026-11-01|revolut'].balancePence, 7000);
  assert.equal(mergeStates(b, clone(a)).state.balances['2026-11-01|revolut'].balancePence, 7000);
});

test('syncing the same backup twice changes nothing', () => {
  const a = createState(1), b = createState(1);
  addTransactions(b, [tx()], 100);
  const once = mergeStates(a, clone(b));
  const twice = mergeStates(once.state, clone(b));
  assert.equal(twice.counts.added, 0);
  assert.equal(twice.counts.updated, 0);
  assert.deepEqual(twice.state.transactions, once.state.transactions);
});

test('a hand-chosen category beats a newer rule from the other device', () => {
  const a = createState(1);
  addTransactions(a, [tx()], 100);
  const b = clone(a);
  setManualCategory(a, first(a).key, 'Shopping', 150);
  setRule(b, 'WIDGETCO', 'Gifts & charity', 300);
  applyRules(b, 300);
  const { state } = syncFrom(a, clone(b), 400);
  assert.equal(first(state).category, 'Shopping');
  assert.equal(first(syncFrom(b, clone(a), 400).state).category, 'Shopping');
});

test('a rule made on one device reaches rows on the other', () => {
  const a = createState(1);
  addTransactions(a, [tx()], 100);
  const b = createState(1);
  setRule(b, 'WIDGETCO', 'Shopping', 200);
  assert.equal(first(syncFrom(a, clone(b), 300).state).category, 'Shopping');
});

test('a removed pension stays removed, unless edited afterwards', () => {
  const a = createState(1);
  const key = addAccount(a, 'Provider One', 'pension', 100);
  setBalance(a, '2026-10-01', key, '10', 100);
  const b = clone(a);
  removeAccount(a, key, 200);
  assert.equal(mergeStates(b, clone(a)).state.accounts[key], undefined);
  assert.equal(mergeStates(a, clone(b)).state.accounts[key], undefined);
  assert.equal(Object.keys(mergeStates(b, clone(a)).state.balances).length, 0);
  b.accounts[key].updatedAt = 300;
  assert.ok(mergeStates(a, clone(b)).state.accounts[key]);
});

test('newer targets are synced, and this device keeps its own backup date', () => {
  const a = createState(1), b = createState(1);
  a.meta.lastBackupAt = 999;
  b.goals.monthlyIsaTargetPence = 150000;
  b.goalsUpdatedAt = 500;
  const { state } = mergeStates(a, clone(b));
  assert.equal(state.goals.monthlyIsaTargetPence, 150000);
  assert.equal(state.meta.lastBackupAt, 999);
});

test('a failed sync leaves this device untouched', () => {
  const a = createState(1);
  addTransactions(a, [tx()], 100);
  const before = clone(a);
  const bad = clone(a);
  bad.transactions.bad = { key: 'bad', account: 'nope', date: 'x', description: 'x', amountPence: 1.5, currency: 'GBP', category: null };
  assert.throws(() => syncFrom(a, bad), /not valid/);
  assert.deepEqual(clone(a), before);
});

test('malformed backups are refused', () => {
  const good = () => clone(createState(1));
  const cases = [
    (s) => { s.transactions = JSON.parse('{"__proto__": {"polluted": true}}'); },
    (s) => { s.accounts = JSON.parse('{"constructor": {"name": "x", "class": "cash"}}'); },
    (s) => { s.rules = 'nope'; },
    (s) => { s.rules = [{ pattern: 'X', category: '__proto__' }]; },
    (s) => { s.accounts['lloyds-club'].class = 'nope'; },
    (s) => { s.rules = [{ pattern: '  ', category: 'Shopping' }]; },
    (s) => { s.balances.x = { date: '2026-13-45', account: 'revolut', balancePence: 1 }; },
    (s) => { s.balances.x = { date: '2026-01-01', account: 'constructor', balancePence: 1 }; },
    (s) => { s.statements.x = { date: 'soon', account: 'revolut' }; },
    (s) => { s.goals.monthlyIsaTargetPence = 'a lot'; },
    (s) => { s.settings.isaAllowancePence = 'lots'; },
    (s) => { s.settings.isaPaidBeforeImportByTaxYear = JSON.parse('{"__proto__": 1}'); },
    (s) => { s.deleted = { 'accounts/x': 'whenever' }; },
    (s) => { s.transactions.a = { key: 'b', account: 'revolut', date: '2026-01-01', description: 'x', amountPence: 1, currency: 'GBP', category: null }; },
    (s) => { s.transactions.x = { key: 'x', account: 'revolut', date: '2026-01-01', description: 'x', amountPence: 1, currency: 'GBP', category: 'constructor' }; },
  ];
  for (const change of cases) {
    const s = good();
    change(s);
    assert.throws(() => validateState(s), /not valid/);
  }
  assert.equal({}.polluted, undefined);
  assert.throws(() => validateState({ ...good(), schemaVersion: 99 }), /newer version/);
  assert.throws(() => validateState([]), /not valid/);
});

test('data saved before this version gains the sync fields', () => {
  const old = createState(1);
  delete old.deleted; delete old.goalsUpdatedAt; delete old.meta;
  const s = migrate(old);
  assert.deepEqual(s.deleted, {});
  assert.equal(s.goalsUpdatedAt, 0);
  assert.equal(s.meta.lastBackupAt, null);
});

// ---------- The offline app ----------

test('the offline file list matches the app, so a forgotten update fails here', () => {
  assert.equal(currentBlock(), buildBlock(), 'Run: node tools/update-sw.mjs');
  const list = appFiles();
  for (const f of ['index.html', 'src/app.js', 'src/ui/styles.css', 'vendor/pdfjs/pdf.worker.min.mjs', 'icons/icon-512.png', 'manifest.webmanifest']) {
    assert.ok(list.includes(f), f);
  }
  for (const f of list) assert.ok(!/^(local|reference|tests|tools|\.tools)\//.test(f), f);
});

test('the service worker only handles this app\'s own files', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /url\.origin !== self\.location\.origin/);
  assert.ok(!/\bfetch\(/.test(sw), 'it must not make its own network calls');
  assert.ok(!/indexedDB/.test(sw), 'it must not touch your data');
});

test('the manifest is valid, with its paths relative so it works under any folder', () => {
  const m = JSON.parse(readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.ok(m.start_url.startsWith('./') && m.scope === './');
  for (const icon of m.icons) readFileSync(new URL(`../${icon.src}`, import.meta.url));
});

test('names that every JavaScript object answers to are not accepted as real', () => {
  const s = createState(1);
  for (const name of ['constructor', '__proto__', 'toString']) {
    assert.throws(() => setBalance(s, '2026-10-01', name, '1'), /Unknown account/);
    assert.throws(() => setRule(s, 'X', name), /Unknown category/);
    assert.throws(() => addTransactions(s, [tx({ account: name })]), /Unknown account/);
    assert.throws(() => applySeed(s, { goals: JSON.parse(`{"${name}": 1}`) }), /Unknown goal/);
  }
  assert.throws(() => applySeed(s, { goals: { monthlyIsaTargetPence: 'lots' } }), /must be a number/);
  assert.throws(() => setBalance(s, '2026-13-45', 'revolut', '1'), /not ISO/);
  assert.equal({}.polluted, undefined);
});

test('a transaction with an odd category name is treated as uncategorised', () => {
  assert.equal(classify({ category: 'constructor', amountPence: -1 }, createState(1).categories).name, 'Uncategorised');
});
